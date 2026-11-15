import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';

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
  let timedOut = false;
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
    const collect = (chunk) => {
      for (const descriptor of logs) writeSync(descriptor, chunk);
      (options.quiet ? process.stderr : process.stdout).write(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
      timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') reject(error);
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
    for (const descriptor of logs) closeSync(descriptor);
  }
}
