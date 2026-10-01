// Small process-lifetime helpers for the two #146 acceptance runners.
// Keep output bounded and every spawned command/server owned by its runner.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_GRACE_MS = 1000;
const CLEANUP_DEADLINE_MS = 5000;
const DEFAULT_OUTPUT_BYTES = 64 * 1024;

function boundedCollector(limit) {
  let chunks = [];
  let size = 0;
  return {
    push(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(bytes);
      size += bytes.length;
      while (size > limit && chunks.length) {
        const excess = size - limit;
        if (chunks[0].length <= excess) {
          size -= chunks[0].length;
          chunks.shift();
        } else {
          chunks[0] = chunks[0].subarray(excess);
          size -= excess;
        }
      }
    },
    bytes() { return Buffer.concat(chunks, size); },
  };
}

function launch(command, args, options, collector) {
  let child;
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    collector.push(error.message);
    return { child: undefined, error, closed: Promise.resolve({ code: 127, signal: null, error }) };
  }
  let spawnError;
  child.stdout?.on('data', (chunk) => collector.push(chunk));
  child.stderr?.on('data', (chunk) => collector.push(chunk));
  child.once('error', (error) => { spawnError = error; collector.push(error.message); });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({
    code: typeof code === 'number' ? code : spawnError ? 127 : 1,
    signal,
    error: spawnError,
  })));
  return { child, closed };
}

function signalOwned(child, signal) {
  if (!child?.pid) return false;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (process.platform !== 'win32' && error?.code === 'EPERM') return false;
    throw error;
  }
}

function ownedGroupExists(child) {
  if (!child?.pid) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

async function terminateOwned(child, closed, graceMs) {
  if (!child?.pid || !ownedGroupExists(child)) return await waitForClose(closed);
  signalOwned(child, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (ownedGroupExists(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (ownedGroupExists(child)) signalOwned(child, 'SIGKILL');
  return await waitForClose(closed);
}

async function waitForClose(closed) {
  let timer;
  const result = await Promise.race([
    closed,
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), CLEANUP_DEADLINE_MS); }),
  ]);
  clearTimeout(timer);
  if (!result) throw new Error('owned child did not close within cleanup deadline');
  return result;
}

function waitForCancellation(signal) {
  if (!signal) return { promise: new Promise(() => {}), dispose() {} };
  if (signal.aborted) return { promise: Promise.resolve(signal.reason ?? new Error('runner cancelled')), dispose() {} };
  let listener;
  const promise = new Promise((resolve) => {
    listener = () => resolve(signal.reason ?? new Error('runner cancelled'));
    signal.addEventListener('abort', listener, { once: true });
  });
  return { promise, dispose() { signal.removeEventListener('abort', listener); } };
}

export function createRunnerCancellation() {
  const controller = new AbortController();
  let receivedSignal;
  const onSignal = (name) => {
    receivedSignal = name;
    controller.abort(new Error(`runner cancelled by ${name}`));
  };
  const onTerm = () => onSignal('SIGTERM');
  const onInt = () => onSignal('SIGINT');
  process.once('SIGTERM', onTerm);
  process.once('SIGINT', onInt);
  return {
    signal: controller.signal,
    get receivedSignal() { return receivedSignal; },
    dispose() { process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt); },
  };
}

export async function captureRunnerCommand(command, args, options = {}) {
  const collector = boundedCollector(options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES);
  const launched = launch(command, args, options, collector);
  if (!launched.child) {
    const bytes = collector.bytes();
    return { code: 127, signal: null, outcome: 'SPAWN_ERROR', bytes, output: bytes.toString(), error: launched.error.message };
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer;
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs); });
  const cancellation = waitForCancellation(options.signal);
  const cancelled = cancellation.promise.then((reason) => ({ kind: 'cancelled', reason }));
  const completed = launched.closed.then((result) => ({ kind: 'closed', result }));
  const outcome = await Promise.race([completed, timedOut, cancelled]);
  clearTimeout(timer);
  cancellation.dispose();
  if (outcome.kind === 'closed') {
    const bytes = collector.bytes();
    const error = outcome.result.error?.message;
    return { code: outcome.result.code, signal: outcome.result.signal, outcome: error ? 'SPAWN_ERROR' : 'EXITED', bytes, output: bytes.toString(), ...(error ? { error } : {}) };
  }
  const result = await terminateOwned(launched.child, launched.closed, options.stopGraceMs ?? DEFAULT_GRACE_MS);
  const bytes = collector.bytes();
  const error = outcome.kind === 'timeout'
    ? `command exceeded ${timeoutMs}ms deadline`
    : outcome.reason?.message ?? 'runner cancelled';
  return {
    code: outcome.kind === 'timeout' ? 124 : 130,
    signal: result.signal,
    outcome: outcome.kind === 'timeout' ? 'TIMEOUT' : 'CANCELLED',
    bytes,
    output: bytes.toString(),
    error,
  };
}

export async function startRunnerServer(options) {
  const collector = boundedCollector(options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES);
  const launched = launch(options.command, options.args, options, collector);
  const child = launched.child;
  let stopPromise;
  const exit = launched.closed;
  const stop = () => {
    stopPromise ??= terminateOwned(child, exit, options.stopGraceMs ?? DEFAULT_GRACE_MS);
    return stopPromise;
  };
  const persist = async (file) => { if (file) await writeFile(file, collector.bytes()); };
  const cleanupAndPersist = async () => {
    await stop();
    try { await persist(options.serverLogPath); } catch {}
  };

  let failure;
  if (!child) {
    failure = { kind: 'spawn', error: launched.error };
  } else {
    let ready = false;
    const readyBytes = Buffer.from(options.readyText);
    let readyTail = Buffer.alloc(0);
    const readyPromise = new Promise((resolve) => {
      const markReady = (chunk) => {
        if (ready) return;
        const combined = Buffer.concat([readyTail, chunk]);
        readyTail = combined.subarray(Math.max(0, combined.length - Math.max(0, readyBytes.length - 1)));
        if (combined.includes(readyBytes)) {
          ready = true;
          resolve({ kind: 'ready' });
        }
      };
      // launch owns stream collection; attach only a readiness observer here.
      child.stdout?.on('data', markReady);
      child.stderr?.on('data', markReady);
    });
    const timeoutMs = options.startupTimeoutMs ?? 15000;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs); });
    const closed = exit.then((result) => ({ kind: 'closed', result }));
    const cancellation = waitForCancellation(options.signal);
    const cancelled = cancellation.promise.then((reason) => ({ kind: 'cancelled', reason }));
    const startup = await Promise.race([readyPromise, closed, timeout, cancelled]);
    clearTimeout(timer);
    cancellation.dispose();
    if (startup.kind !== 'ready' || (await Promise.race([closed, Promise.resolve(null)]))) {
      if (startup.kind === 'ready') failure = { kind: 'exit', result: await exit };
      else if (startup.kind === 'closed' && startup.result.error) failure = { kind: 'spawn', error: startup.result.error };
      else failure = startup;
    }
  }

  let logError;
  try { await persist(options.startupLogPath); } catch (error) { logError = error; }
  if (failure || logError) {
    await cleanupAndPersist();
    const message = logError
      ? `could not write startup log: ${logError.message}`
      : failure.kind === 'timeout' ? `server did not report readiness within ${options.startupTimeoutMs ?? 15000}ms`
        : failure.kind === 'cancelled' ? (failure.reason?.message ?? 'runner cancelled')
          : failure.kind === 'spawn' ? `server spawn failed: ${failure.error.message}`
            : `server exited before readiness: ${JSON.stringify(failure.result ?? failure)}`;
    const error = new Error(message);
    error.code = failure?.kind === 'timeout' ? 'TIMEOUT' : failure?.kind === 'cancelled' ? 'CANCELLED' : 'BLOCKED';
    error.exit = failure?.result;
    throw error;
  }

  const onAbort = () => { void cleanupAndPersist().catch(() => {}); };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  return {
    child,
    exit,
    get output() { return collector.bytes(); },
    async stop() {
      options.signal?.removeEventListener('abort', onAbort);
      await stop();
      await persist(options.serverLogPath);
    },
  };
}
