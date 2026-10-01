import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  captureRunnerCommand,
  finalizeProductionLifecycleServer,
  startRunnerServer,
} from '../scripts/runner-process-lifecycle.mjs';

const skipProcessGroups = process.platform === 'win32';
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sheet-runner-lifecycle-'));
const helperUrl = pathToFileURL(path.resolve('scripts/runner-process-lifecycle.mjs')).href;
const ownedGroups = new Map();
const knownSentinels = new Set();

function treeSource(pidFile, readyText = '', { exitCode, ignoreTerm = false } = {}) {
  const descendantCode = `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}setInterval(() => {}, 1000);`;
  const parentTail = Number.isInteger(exitCode) ? `setTimeout(() => process.exit(${exitCode}), 100);` : 'setInterval(() => {}, 1000);';
  return `import { spawn } from 'node:child_process';
import net from 'node:net';
import { writeFile } from 'node:fs/promises';
const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantCode)}], { stdio: 'ignore' });
const server = net.createServer(() => {});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await writeFile(${JSON.stringify(pidFile)}, JSON.stringify({ parent: process.pid, descendant: descendant.pid, port: server.address().port }));
console.log(${JSON.stringify(readyText)} + ' owned-process-tree-started');
process.stdout.write('x'.repeat(12000) + 'TAIL-MARKER');
${parentTail}`;
}

function registerOwned(pids) {
  ownedGroups.set(pids.parent, new Set([pids.parent, pids.descendant]));
}

async function waitForFile(file, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function pidIsRunnable(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const statLine = await readFile(`/proc/${pid}/stat`, 'utf8');
      const state = statLine.slice(statLine.lastIndexOf(')') + 2).split(' ')[0];
      return state !== 'Z' && state !== 'X';
    }
    return true;
  } catch (error) { return error.code !== 'ESRCH' && error.code !== 'ENOENT'; }
}

async function waitForGone(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await pidIsRunnable(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`process ${pid} remained runnable`);
}

async function anyRunnable(pids) {
  for (const pid of pids) if (await pidIsRunnable(pid)) return true;
  return false;
}

async function cleanupKnownGroups() {
  const errors = [];
  for (const [group, pids] of ownedGroups) {
    try {
      if (await anyRunnable(pids)) {
        try { process.kill(-group, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        const deadline = Date.now() + 250;
        while (await anyRunnable(pids) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
        if (await anyRunnable(pids)) {
          try { process.kill(-group, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        for (const pid of pids) await waitForGone(pid);
      }
    } catch (error) { errors.push(error); }
  }
  ownedGroups.clear();
  for (const pid of knownSentinels) {
    if (await pidIsRunnable(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') errors.push(error); }
      try { await waitForGone(pid); } catch (error) { errors.push(error); }
    }
  }
  knownSentinels.clear();
  if (errors.length) throw new AggregateError(errors, 'owned process cleanup failed');
}

async function withWatchdog(timeoutMs, run) {
  const controller = new AbortController();
  const work = Promise.resolve().then(() => run(controller.signal));
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`outer test watchdog expired after ${timeoutMs}ms`));
      reject(new Error(`outer test watchdog expired after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  let result;
  let failure;
  try { result = await Promise.race([work, watchdog]); }
  catch (error) { failure = error; controller.abort(error); }
  clearTimeout(timer);
  if (failure) await Promise.race([work.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 6000))]);
  let cleanupFailure;
  try { await cleanupKnownGroups(); } catch (error) { cleanupFailure = error; }
  if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'test failed and owned process cleanup failed');
  if (failure) throw failure;
  if (cleanupFailure) throw cleanupFailure;
  return result;
}

async function assertPortClosed(port) {
  const result = await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve('open'); });
    socket.once('error', () => resolve('closed'));
    socket.setTimeout(500, () => { socket.destroy(); resolve('timeout'); });
  });
  assert.equal(result, 'closed');
}

function launchSentinel() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  knownSentinels.add(child.pid);
  return child;
}

function guardedTest(name, timeoutMs, run) {
  test(name, { skip: skipProcessGroups }, () => withWatchdog(timeoutMs, run));
}

guardedTest('the 15-second startup timeout retains logs and reaps only its owned server tree', 22000, async (signal) => {
  const pidFile = path.join(tempRoot, 'startup-timeout-pids.json');
  const startupLogPath = path.join(tempRoot, 'startup-timeout.log');
  const serverLogPath = path.join(tempRoot, 'startup-server.log');
  const sentinel = launchSentinel();
  await assert.rejects(startRunnerServer({
    command: process.execPath,
    args: ['--input-type=module', '-e', treeSource(pidFile)],
    cwd: tempRoot,
    readyText: 'NEVER-READY',
    stopGraceMs: 100,
    maxOutputBytes: 4096,
    startupLogPath,
    serverLogPath,
    signal,
  }), (error) => error.code === 'TIMEOUT' && /15000ms/.test(error.message));
  const pids = await waitForFile(pidFile);
  registerOwned(pids);
  await waitForGone(pids.parent);
  await waitForGone(pids.descendant);
  await assertPortClosed(pids.port);
  const startup = await readFile(startupLogPath);
  assert.ok(startup.length <= 4096);
  assert.ok(startup.toString().includes('TAIL-MARKER'));
  assert.ok((await stat(serverLogPath)).size <= 4096);
  process.kill(sentinel.pid, 0);
});

guardedTest('spawn failure and startup-log failure retain diagnostics and clean up', 8000, async (signal) => {
  const failedStartupLog = path.join(tempRoot, 'spawn-failed.log');
  await assert.rejects(startRunnerServer({
    command: path.join(tempRoot, 'missing-runner-command'), args: [], cwd: tempRoot,
    readyText: 'READY', startupTimeoutMs: 300, startupLogPath: failedStartupLog,
    serverLogPath: path.join(tempRoot, 'spawn-failed-server.log'), signal,
  }), /spawn failed/);
  assert.match(await readFile(failedStartupLog, 'utf8'), /missing-runner-command/);

  const pidFile = path.join(tempRoot, 'log-failure-pids.json');
  const startupLogDirectory = path.join(tempRoot, 'startup-log-is-a-directory');
  const serverLogPath = path.join(tempRoot, 'log-failure-server.log');
  await mkdir(startupLogDirectory);
  await assert.rejects(startRunnerServer({
    command: process.execPath,
    args: ['--input-type=module', '-e', treeSource(pidFile, 'READY')],
    cwd: tempRoot,
    readyText: 'READY', startupTimeoutMs: 1000, stopGraceMs: 100,
    startupLogPath: startupLogDirectory, serverLogPath, signal,
  }), /could not write startup log/);
  const pids = await waitForFile(pidFile);
  registerOwned(pids);
  await waitForGone(pids.parent);
  await waitForGone(pids.descendant);
  await assertPortClosed(pids.port);
  assert.match(await readFile(serverLogPath, 'utf8'), /owned-process-tree-started/);
});

guardedTest('hung command deadline returns BLOCKED evidence, bounded output, and reaps descendants', 8000, async (signal) => {
  const pidFile = path.join(tempRoot, 'command-timeout-pids.json');
  const sentinel = launchSentinel();
  const result = await captureRunnerCommand(process.execPath, ['--input-type=module', '-e', treeSource(pidFile)], {
    cwd: tempRoot, timeoutMs: 300, stopGraceMs: 100, maxOutputBytes: 2048, signal,
  });
  const pids = await waitForFile(pidFile);
  registerOwned(pids);
  assert.equal(result.outcome, 'TIMEOUT');
  assert.notEqual(result.code, 0);
  assert.match(result.error, /deadline/);
  assert.ok(Buffer.byteLength(result.output) <= 2048);
  assert.ok(result.output.includes('TAIL-MARKER'));
  await waitForGone(pids.parent);
  await waitForGone(pids.descendant);
  await assertPortClosed(pids.port);
  process.kill(sentinel.pid, 0);
});

guardedTest('delivered SIGTERM cancels a hung seed child before the runner writes BLOCKED receipt', 8000, async () => {
  const pidFile = path.join(tempRoot, 'sigterm-pids.json');
  const receiptPath = path.join(tempRoot, 'sigterm-receipt.json');
  const sentinel = launchSentinel();
  const source = `import { writeFile } from 'node:fs/promises';
import { captureRunnerCommand, createRunnerCancellation } from ${JSON.stringify(helperUrl)};
const cancellation = createRunnerCancellation();
try {
  const result = await captureRunnerCommand(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(treeSource(pidFile))}], { timeoutMs: 5000, stopGraceMs: 100, maxOutputBytes: 2048, signal: cancellation.signal });
  await writeFile(${JSON.stringify(receiptPath)}, JSON.stringify({ status: result.code === 0 ? 'PASS' : 'BLOCKED', outcome: result.outcome, exitCode: result.code, error: result.error, output: result.output }));
  process.exitCode = result.code === 0 ? 0 : 78;
} finally { cancellation.dispose(); }`;
  const runner = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: 'ignore' });
  try {
    const pids = await waitForFile(pidFile);
    registerOwned(pids);
    runner.kill('SIGTERM');
    let timeoutId;
    const closed = new Promise((resolve) => runner.once('close', (code, childSignal) => resolve({ code, childSignal })));
    const result = await Promise.race([closed, new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('runner did not finish after SIGTERM')), 4000); })]);
    clearTimeout(timeoutId);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.equal(receipt.status, 'BLOCKED');
    assert.equal(receipt.outcome, 'CANCELLED');
    assert.notEqual(receipt.exitCode, 0);
    assert.ok(Buffer.byteLength(receipt.output) <= 2048);
    assert.equal(result.code, 78);
    await waitForGone(pids.parent);
    await waitForGone(pids.descendant);
    await assertPortClosed(pids.port);
    process.kill(sentinel.pid, 0);
  } finally {
    if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
  }
});

guardedTest('normal parent exit reaps surviving descendants and preserves the parent status', 8000, async (signal) => {
  const sentinel = launchSentinel();
  for (const exitCode of [0, 9]) {
    const pidFile = path.join(tempRoot, `normal-exit-${exitCode}-pids.json`);
    const result = await captureRunnerCommand(process.execPath, ['--input-type=module', '-e', treeSource(pidFile, '', { exitCode, ignoreTerm: exitCode === 0 })], {
      cwd: tempRoot, timeoutMs: 3000, stopGraceMs: 100, maxOutputBytes: 2048, signal,
    });
    const pids = await waitForFile(pidFile);
    registerOwned(pids);
    assert.equal(result.outcome, 'EXITED');
    assert.equal(result.code, exitCode);
    await waitForGone(pids.parent);
    await waitForGone(pids.descendant);
    await assertPortClosed(pids.port);
    process.kill(sentinel.pid, 0);
  }
});

guardedTest('successful and early-exit child outcomes stay unchanged', 8000, async (signal) => {
  const success = await captureRunnerCommand(process.execPath, ['-e', "process.stdout.write('ok')"], { timeoutMs: 1000, signal });
  assert.equal(success.code, 0);
  assert.equal(success.outcome, 'EXITED');
  assert.equal(success.output, 'ok');

  const failed = await captureRunnerCommand(process.execPath, ['-e', 'process.exit(9)'], { timeoutMs: 1000, signal });
  assert.equal(failed.code, 9);
  assert.equal(failed.outcome, 'EXITED');
});

guardedTest('production finalizer converts cleanup and log failures to BLOCKED', 8000, async (signal) => {
  const cleanupSummary = {
    status: 'PASS', lifecycle: 'PASS', diagnostics: [{ status: 'BLOCKED', phase: 'primary', message: 'preserved primary failure' }],
  };
  await finalizeProductionLifecycleServer({ stop: async () => { throw new Error('injected cleanup failure'); } }, cleanupSummary, ['case-cleanup']);
  assert.equal(cleanupSummary.status, 'BLOCKED');
  assert.equal(cleanupSummary.lifecycle, 'BLOCKED');
  assert.equal(cleanupSummary.diagnostics[0].message, 'preserved primary failure');
  assert.match(cleanupSummary.diagnostics[1].message, /injected cleanup failure/);
  assert.deepEqual(cleanupSummary.caseOutcomes, [{ id: 'case-cleanup', status: 'BLOCKED' }]);

  const logPathDirectory = path.join(tempRoot, 'production-server-log-is-a-directory');
  const startupLogPath = path.join(tempRoot, 'production-server-startup.log');
  await mkdir(logPathDirectory);
  const server = await startRunnerServer({
    command: process.execPath,
    args: ['-e', "console.log('READY-FINALIZER'); setInterval(() => {}, 1000)"],
    cwd: tempRoot,
    readyText: 'READY-FINALIZER',
    startupLogPath,
    serverLogPath: logPathDirectory,
    signal,
  });
  ownedGroups.set(server.child.pid, new Set([server.child.pid]));
  const logSummary = { status: 'PASS', lifecycle: 'PASS', diagnostics: [] };
  await finalizeProductionLifecycleServer(server, logSummary, ['case-log']);
  assert.equal(logSummary.status, 'BLOCKED');
  assert.equal(logSummary.lifecycle, 'BLOCKED');
  assert.match(logSummary.diagnostics[0].message, /EISDIR|directory/);
  assert.deepEqual(logSummary.caseOutcomes, [{ id: 'case-log', status: 'BLOCKED' }]);
  await waitForGone(server.child.pid);
});

test.after(async () => {
  await cleanupKnownGroups();
  await rm(tempRoot, { recursive: true, force: true });
});
