import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';

const STEP_KILL_GRACE_MS = 5000;

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
  let timedOut = false;
  let cleanupParentListeners = () => {};
  try {
    for (const directory of directories) {
      mkdirSync(directory, { recursive: true });
      logs.push(openSync(path.join(directory, `${name}.log`), 'w'));
    }
    console.log(JSON.stringify({ step: name, status: 'START', timeoutMs, log }));
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...extraEnvironment },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const signalGroup = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const killGroup = (onError) => {
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => {
        try {
          signalGroup('SIGKILL');
        } catch (error) {
          onError(error);
        }
      }, options.killGraceMs ?? STEP_KILL_GRACE_MS);
    };
    const killGroupImmediately = () => {
      signalGroup('SIGTERM');
      signalGroup('SIGKILL');
    };
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
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        clearTimeout(killTimer);
        resolve({ code, signal });
      });
      timer = setTimeout(() => {
        timedOut = true;
        try {
          killGroup(reject);
        } catch (error) {
          reject(error);
        }
      }, timeoutMs);
    });
    const exitCode = timedOut ? 1 : typeof result.code === 'number' ? result.code : 1;
    const entry = {
      step: name,
      status: timedOut ? 'TIMEOUT' : exitCode === 0 ? 'PASS' : 'FAIL',
      exitCode,
      log,
      ...(options.details ?? {}),
    };
    summary.push(entry);
    console.log(JSON.stringify(entry));
    return exitCode;
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    cleanupParentListeners();
    for (const descriptor of logs) closeSync(descriptor);
  }
}
