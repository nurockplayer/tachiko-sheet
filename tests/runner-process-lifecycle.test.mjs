import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureRunnerCommand, startRunnerServer } from '../scripts/runner-process-lifecycle.mjs';

const skipProcessGroups = process.platform === 'win32';
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sheet-runner-lifecycle-'));
const helperUrl = pathToFileURL(path.resolve('scripts/runner-process-lifecycle.mjs')).href;

function treeSource(pidFile, readyText = '') {
  return `import { spawn } from 'node:child_process';
import net from 'node:net';
import { writeFile } from 'node:fs/promises';
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
const server = net.createServer(() => {});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await writeFile(${JSON.stringify(pidFile)}, JSON.stringify({ parent: process.pid, descendant: descendant.pid, port: server.address().port }));
console.log(${JSON.stringify(readyText)} + ' owned-process-tree-started');
process.stdout.write('x'.repeat(12000) + 'TAIL-MARKER');
setInterval(() => {}, 1000);`;
}

async function waitForFile(file, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function waitForGone(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      if (process.platform === 'linux') {
        const statLine = await readFile(`/proc/${pid}/stat`, 'utf8');
        const state = statLine.slice(statLine.lastIndexOf(')') + 2).split(' ')[0];
        if (state === 'Z') return;
      }
    } catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') return; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`process ${pid} remained alive`);
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
  return child;
}

test('startup timeout retains bounded logs and reaps only its owned server tree', { skip: skipProcessGroups }, async () => {
  const pidFile = path.join(tempRoot, 'startup-timeout-pids.json');
  const startupLogPath = path.join(tempRoot, 'startup-timeout.log');
  const serverLogPath = path.join(tempRoot, 'startup-server.log');
  const sentinel = launchSentinel();
  try {
    await assert.rejects(startRunnerServer({
      command: process.execPath,
      args: ['--input-type=module', '-e', treeSource(pidFile)],
      cwd: tempRoot,
      readyText: 'NEVER-READY',
      stopGraceMs: 100,
      maxOutputBytes: 4096,
      startupLogPath,
      serverLogPath,
    }), (error) => error.code === 'TIMEOUT' && /15000ms/.test(error.message));
    const pids = await waitForFile(pidFile);
    await waitForGone(pids.parent);
    await waitForGone(pids.descendant);
    await assertPortClosed(pids.port);
    const startup = await readFile(startupLogPath);
    assert.ok(startup.length <= 4096);
    assert.ok(startup.toString().includes('TAIL-MARKER'));
    assert.ok((await stat(serverLogPath)).size <= 4096);
    process.kill(sentinel.pid, 0);
  } finally {
    sentinel.kill('SIGKILL');
  }
});

test('spawn failure and startup-log failure retain diagnostics and clean up', { skip: skipProcessGroups }, async () => {
  const failedStartupLog = path.join(tempRoot, 'spawn-failed.log');
  await assert.rejects(startRunnerServer({
    command: path.join(tempRoot, 'missing-runner-command'), args: [], cwd: tempRoot,
    readyText: 'READY', startupTimeoutMs: 300, startupLogPath: failedStartupLog,
    serverLogPath: path.join(tempRoot, 'spawn-failed-server.log'),
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
    startupLogPath: startupLogDirectory,
    serverLogPath,
  }), /could not write startup log/);
  const pids = await waitForFile(pidFile);
  await waitForGone(pids.parent);
  await waitForGone(pids.descendant);
  await assertPortClosed(pids.port);
  assert.match(await readFile(serverLogPath, 'utf8'), /owned-process-tree-started/);
});

test('hung command deadline returns BLOCKED evidence, bounded output, and reaps its descendants', { skip: skipProcessGroups }, async () => {
  const pidFile = path.join(tempRoot, 'command-timeout-pids.json');
  const result = await captureRunnerCommand(process.execPath, ['--input-type=module', '-e', treeSource(pidFile)], {
    cwd: tempRoot, timeoutMs: 300, stopGraceMs: 100, maxOutputBytes: 2048,
  });
  assert.equal(result.outcome, 'TIMEOUT');
  assert.notEqual(result.code, 0);
  assert.match(result.error, /deadline/);
  assert.ok(Buffer.byteLength(result.output) <= 2048);
  assert.ok(result.output.includes('TAIL-MARKER'));
  const pids = await waitForFile(pidFile);
  await waitForGone(pids.parent);
  await waitForGone(pids.descendant);
  await assertPortClosed(pids.port);
});

test('delivered SIGTERM cancels a hung seed child before the runner writes a BLOCKED receipt', { skip: skipProcessGroups }, async () => {
  const pidFile = path.join(tempRoot, 'sigterm-pids.json');
  const receiptPath = path.join(tempRoot, 'sigterm-receipt.json');
  const source = `import { writeFile } from 'node:fs/promises';
import { captureRunnerCommand, createRunnerCancellation } from ${JSON.stringify(helperUrl)};
const cancellation = createRunnerCancellation();
try {
  const result = await captureRunnerCommand(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(treeSource(pidFile))}], { timeoutMs: 5000, stopGraceMs: 100, maxOutputBytes: 2048, signal: cancellation.signal });
  await writeFile(${JSON.stringify(receiptPath)}, JSON.stringify({ status: result.code === 0 ? 'PASS' : 'BLOCKED', outcome: result.outcome, exitCode: result.code, error: result.error, output: result.output }));
  process.exitCode = result.code === 0 ? 0 : 78;
} finally { cancellation.dispose(); }`;
  const runner = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: 'ignore' });
  const closed = new Promise((resolve) => runner.once('close', (code, signal) => resolve({ code, signal })));
  try {
    const pids = await waitForFile(pidFile);
    runner.kill('SIGTERM');
    let timeoutId;
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
  } finally {
    if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
  }
});

test('successful and early-exit child outcomes stay unchanged', { skip: skipProcessGroups }, async () => {
  const success = await captureRunnerCommand(process.execPath, ['-e', "process.stdout.write('ok')"], { timeoutMs: 1000 });
  assert.equal(success.code, 0);
  assert.equal(success.outcome, 'EXITED');
  assert.equal(success.output, 'ok');

  const failed = await captureRunnerCommand(process.execPath, ['-e', 'process.exit(9)'], { timeoutMs: 1000 });
  assert.equal(failed.code, 9);
  assert.equal(failed.outcome, 'EXITED');
});

test('server ready and early-exit outcomes stay unchanged', { skip: skipProcessGroups }, async () => {
  const serverLogPath = path.join(tempRoot, 'normal-server.log');
  const startupLogPath = path.join(tempRoot, 'normal-server-startup.log');
  const server = await startRunnerServer({
    command: process.execPath,
    args: ['-e', "console.log('READY-URL'); setInterval(() => {}, 1000)"],
    cwd: tempRoot,
    readyText: 'READY-URL',
    startupLogPath,
    serverLogPath,
    startupTimeoutMs: 1000,
    stopGraceMs: 100,
  });
  await server.stop();
  assert.match(await readFile(startupLogPath, 'utf8'), /READY-URL/);
  assert.match(await readFile(serverLogPath, 'utf8'), /READY-URL/);

  const earlyExitLog = path.join(tempRoot, 'early-exit-startup.log');
  await assert.rejects(startRunnerServer({
    command: process.execPath,
    args: ['-e', "console.log('EARLY-EXIT'); process.exit(9)"],
    cwd: tempRoot,
    readyText: 'NEVER-READY',
    startupTimeoutMs: 1000,
    startupLogPath: earlyExitLog,
    serverLogPath: path.join(tempRoot, 'early-exit-server.log'),
  }), /server exited before readiness/);
  assert.match(await readFile(earlyExitLog, 'utf8'), /EARLY-EXIT/);
});

test.after(async () => rm(tempRoot, { recursive: true, force: true }));
