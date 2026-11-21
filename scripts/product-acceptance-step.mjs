import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STEP_KILL_GRACE_MS = 5000;
const PROCESS_SCAN_TIMEOUT_MS = 10_000;

export function signalableOwnedPids(owned, current) {
  // Ownership persists even if a process drops its marker or closes its output.
  // Recheck start time before signalling so a reused PID is never targeted.
  return [...owned].filter(([pid, started]) => {
    const info = current.get(pid);
    return info?.started === started;
  }).map(([pid]) => pid);
}

export async function runStep(name, args, extraEnvironment = {}, options = {}) {
  const { cwd, evidenceDir, summary } = options;
  const timeoutMs = Number(process.env.PRODUCT_ACCEPTANCE_STEP_TIMEOUT_MS ?? 600_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error('PRODUCT_ACCEPTANCE_STEP_TIMEOUT_MS must be a positive integer <= 2147483647');
  }
  const log = path.join(evidenceDir, `${name}.log`);
  const directories = new Set([evidenceDir]);
  if (process.env.TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR) {
    directories.add(path.resolve(process.env.TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR, 'product-acceptance'));
  }
  const logs = [];
  let timer;
  let killTimer;
  let closeTimer;
  let descendantTimer;
  let groupCleanup;
  let processScannerDirectory;
  let timedOut = false;
  let cleanupParentListeners = () => {};
  let cleanupOwned = () => {};
  try {
    for (const directory of directories) {
      mkdirSync(directory, { recursive: true });
      logs.push(openSync(path.join(directory, `${name}.log`), 'w'));
    }
    console.log(JSON.stringify({ step: name, status: 'START', timeoutMs, log }));
    const owner = randomUUID();
    const ownership = `TACHIKO_ACCEPTANCE_STEP_OWNER=${owner}`;
    const outputPipes = new Set();
    let processScanner;
    if (process.platform === 'darwin') {
      processScannerDirectory = mkdtempSync(path.join(tmpdir(), 'sheet-process-table-'));
      processScanner = path.join(processScannerDirectory, 'process-table');
      const compiled = spawnSync('/usr/bin/clang', ['-O2', '-o', processScanner,
        fileURLToPath(new URL('./product-acceptance-process-table.c', import.meta.url))], {
        encoding: 'utf8', timeout: PROCESS_SCAN_TIMEOUT_MS,
      });
      if (compiled.error || compiled.status !== 0) {
        throw new Error(`cannot build process scanner: ${compiled.error?.code ?? compiled.status}: ${compiled.stderr}`);
      }
    }
    let baseline;
    const processTable = () => {
      if (process.platform === 'linux') {
        // Minimal Linux acceptance images need no external ps dependency.
        const table = new Map();
        for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
          let stat;
          try { stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
            throw error;
          }
          // comm is parenthesized and can itself contain spaces or parentheses.
          const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
          let marked = false;
          try {
            marked = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(ownership);
          } catch (error) {
            if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
          }
          let holdsOutput = false;
          if (outputPipes.size && Number(pid) !== process.pid) {
            try {
              holdsOutput = readdirSync(`/proc/${pid}/fd`).some(fd => {
                try { return outputPipes.has(readlinkSync(`/proc/${pid}/fd/${fd}`)); } catch (error) {
                  if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
                  return false;
                }
              });
            } catch (error) {
              if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
            }
          }
          table.set(Number(pid), { parent: Number(fields[1]), group: Number(fields[2]), started: fields[19], marked, holdsOutput });
        }
        return table;
      }
      // Darwin's lstart is rounded to a second. The native scanner preserves
      // kernel microseconds, including after markers and output are discarded.
      const table = spawnSync(processScanner, [], {
        encoding: 'utf8', timeout: PROCESS_SCAN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
      });
      if (table.error || table.status !== 0) throw new Error(`cannot inspect process ownership: ${table.error?.code ?? table.status}`);
      const processes = new Map(table.stdout.trim().split('\n').map(line => {
        const [, pid, parent, group, started] = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
        return [Number(pid), { parent: Number(parent), group: Number(group), started }];
      }));
      // Only processes created since the step started can have inherited its marker.
      // This also finds a child reparented before its ancestry could be sampled.
      const candidates = baseline && [...processes].filter(([pid, info]) => baseline.get(pid)?.started !== info.started).map(([pid]) => pid);
      if (candidates?.length) {
        const marked = spawnSync('ps', ['-wwE', '-p', candidates.join(','), '-o', 'pid=,command='], {
          encoding: 'utf8', timeout: PROCESS_SCAN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024,
        });
        // A candidate may have exited; ps returns 1 when none remain.
        if (marked.error || (marked.status !== 0 && marked.status !== 1)) throw new Error(`cannot inspect process ownership: ${marked.error?.code ?? marked.status}`);
        for (const line of marked.stdout.split('\n')) {
          const match = line.trim().match(/^(\d+)\s+(.*)$/);
          if (match && match[2].split(/\s+/).includes(ownership)) {
            const info = processes.get(Number(match[1]));
            if (info) info.marked = true;
          }
        }
      }
      return processes;
    };
    // Fail before launching a step when its process table cannot be inspected.
    baseline = processTable();
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...extraEnvironment, TACHIKO_ACCEPTANCE_STEP_OWNER: owner },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (process.platform === 'linux' && options.detectOutputHolders !== false) {
      for (const [index, stream] of [[1, child.stdout], [2, child.stderr]]) {
        const fd = stream?._handle?.fd;
        if (!Number.isInteger(fd) || fd < 0) continue;
        try {
          const pipe = readlinkSync(`/proc/self/fd/${fd}`);
          if (/^pipe:\[\d+\]$/.test(pipe)) outputPipes.add(pipe);
          // Node uses socket pairs on Linux: the inherited write end has its own inode.
          else if (/^socket:\[\d+\]$/.test(pipe)) {
            const writer = readlinkSync(`/proc/${child.pid}/fd/${index}`);
            if (/^socket:\[\d+\]$/.test(writer)) outputPipes.add(writer);
          }
        } catch (error) {
          if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
        }
      }
    }
    // Remember ancestry while parents are alive: detached children can later be
    // reparented. Start times prevent signalling a reused PID from an old sample.
    const owned = new Map();
    const descendants = () => {
      const current = processTable();
      for (const [pid, started] of owned) {
        if (current.get(pid)?.started !== started) owned.delete(pid);
      }
      // The original process group remains ours even after its leader exits.
      for (const [pid, info] of current) {
        if (info.group === child.pid || info.marked || info.holdsOutput) owned.set(pid, info.started);
      }
      let added;
      do {
        added = false;
        for (const [pid, info] of current) {
          if (!owned.has(pid) && owned.has(info.parent)) {
            owned.set(pid, info.started);
            added = true;
          }
        }
      } while (added);
      return signalableOwnedPids(owned, current);
    };
    const signalGroup = (signal) => {
      if (!child.pid) return;
      // Signal descendants before their parent, including separate sessions.
      const pids = descendants();
      const root = pids.indexOf(child.pid);
      if (root !== -1) pids.push(...pids.splice(root, 1));
      for (const pid of pids) {
        try {
          process.kill(pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    };
    const killGroup = () => {
      signalGroup('SIGTERM');
      return new Promise((resolve, reject) => {
        killTimer = setTimeout(() => {
          try {
            signalGroup('SIGKILL');
            resolve();
          } catch (error) {
            reject(error);
          }
        }, options.killGraceMs ?? STEP_KILL_GRACE_MS);
      });
    };
    const killGroupImmediately = () => {
      signalGroup('SIGTERM');
      signalGroup('SIGKILL');
    };
    cleanupOwned = killGroupImmediately;
    const signalHandlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => {
      const handler = () => {
        killGroupImmediately();
        process.removeListener(signal, handler);
        process.kill(process.pid, signal);
      };
      process.once(signal, handler);
      return [signal, handler];
    });
    process.once('exit', killGroupImmediately);
    cleanupParentListeners = () => {
      process.removeListener('exit', killGroupImmediately);
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    };
    const collect = (chunk) => {
      for (const descriptor of logs) writeSync(descriptor, chunk);
      (options.quiet ? process.stderr : process.stdout).write(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const closed = new Promise(resolve => child.once('close', () => resolve(true)));
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      // A detached descendant may hold these pipes open after the step exits.
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
      descendantTimer = setInterval(() => {
        try { descendants(); } catch (error) { reject(error); }
      }, 100);
      timer = setTimeout(() => {
        timedOut = true;
        try {
          groupCleanup = killGroup();
          groupCleanup.catch(reject);
        } catch (error) {
          reject(error);
        }
      }, timeoutMs);
    });
    // A successful direct child can also leave detached descendants behind.
    if (!groupCleanup && descendants().length) groupCleanup = killGroup();
    await groupCleanup;
    const escapedOutput = !await Promise.race([
      closed,
      new Promise(resolve => {
        closeTimer = setTimeout(() => resolve(false), options.closeGraceMs ?? STEP_KILL_GRACE_MS);
      }),
    ]);
    clearTimeout(closeTimer);
    if (escapedOutput) {
      try { killGroupImmediately(); } finally {
        child.stdout.destroy();
        child.stderr.destroy();
      }
      collect(Buffer.from('escaped descendant held step output open after exit; failing step\n'));
    }
    const exitCode = timedOut || escapedOutput ? 1 : typeof result.code === 'number' ? result.code : 1;
    const entry = {
      step: name,
      status: timedOut ? 'TIMEOUT' : exitCode === 0 ? 'PASS' : 'FAIL',
      exitCode,
      log,
      ...(options.details ?? {}),
      ...(escapedOutput ? { escapedOutput: true } : {}),
    };
    summary.push(entry);
    console.log(JSON.stringify(entry));
    return exitCode;
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    clearTimeout(closeTimer);
    clearInterval(descendantTimer);
    cleanupParentListeners();
    try { cleanupOwned(); } finally {
      for (const descriptor of logs) closeSync(descriptor);
      if (processScannerDirectory) rmSync(processScannerDirectory, { recursive: true });
    }
  }
}
