import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
import childProcess, { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runStep, signalableOwnedPids } from '../../scripts/product-acceptance-step.mjs';

test('cleanup retains recorded ownership after the marker and output disappear', () => {
  const owned = new Map([[123, 'same'], [456, 'same']]);
  const current = new Map([
    [123, { started: 'same', marked: false, holdsOutput: false }],
    [456, { started: 'same', marked: true }],
  ]);
  const signalled = [];
  for (const pid of signalableOwnedPids(owned, current)) signalled.push(pid);
  assert.deepEqual(signalled, [123, 456]);
});

test('output ownership still requires the recorded process start time', () => {
  const owned = new Map([[123, 'old'], [456, 'same']]);
  const current = new Map([
    [123, { started: 'new', marked: false, holdsOutput: true }],
    [456, { started: 'same', marked: false, holdsOutput: true }],
  ]);
  assert.deepEqual(signalableOwnedPids(owned, current), [456]);
});

async function setup(t, timeoutMs) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sheet-step-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const previous = {
    PRODUCT_ACCEPTANCE_STEP_TIMEOUT_MS: process.env.PRODUCT_ACCEPTANCE_STEP_TIMEOUT_MS,
    TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR: process.env.TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR,
  };
  process.env.PRODUCT_ACCEPTANCE_STEP_TIMEOUT_MS = String(timeoutMs);
  process.env.TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR = path.join(directory, 'upload');
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const entries = [];
  t.mock.method(console, 'log', (line) => entries.push(JSON.parse(line)));
  return {
    directory,
    entries,
    options: { cwd: directory, evidenceDir: path.join(directory, 'local'), summary: [] },
    async logs(name) {
      return Promise.all([
        readFile(path.join(directory, 'local', `${name}.log`), 'utf8'),
        readFile(path.join(directory, 'upload', 'product-acceptance', `${name}.log`), 'utf8'),
      ]);
    },
  };
}

test('macOS process scanner reports native process identity and start time',
  { skip: process.platform !== 'darwin' && 'requires macOS libproc' }, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sheet-scanner-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const scanner = path.join(directory, 'process-table');
    const source = fileURLToPath(new URL('../../scripts/product-acceptance-process-table.c', import.meta.url));
    const compiled = childProcess.spawnSync('/usr/bin/clang', ['-O2', '-lproc', '-o', scanner, source], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));

    const before = Date.now();
    const child = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'],
      { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    t.after(async () => {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    });
    await once(child.stdout, 'data');
    const after = Date.now();
    const snapshot = childProcess.spawnSync(scanner, [], { encoding: 'utf8' });
    assert.equal(snapshot.status, 0, snapshot.stderr || String(snapshot.error));
    const row = snapshot.stdout.trim().split('\n').find(line => line.startsWith(`${child.pid} `));
    assert.ok(row, 'scanner must report the child');
    const [, pid, parent, group, seconds, micros] = row.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\.(\d{6})$/);
    assert.equal(Number(pid), child.pid);
    assert.equal(Number(parent), process.pid);
    assert.equal(Number(group), child.pid);
    assert.notEqual(Number(micros), 0, 'start timestamp must retain sub-second precision');
    const started = Number(seconds) * 1000 + Number(micros) / 1000;
    assert.ok(started >= before - 1 && started <= after, `start time ${started} outside ${before}–${after}`);
  });

test('macOS cleanup rejects PID reuse within the same start second', async t => {
  const fixture = await setup(t, 60000);
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalSpawn = childProcess.spawn;
  const originalKill = process.kill;
  const reusedPid = 987654321;
  const signals = [];
  let owner;
  let scans = 0;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(childProcess, 'spawn', (...args) => {
    owner = args[2].env.TACHIKO_ACCEPTANCE_STEP_OWNER;
    return originalSpawn(...args);
  });
  t.mock.method(childProcess, 'spawnSync', (command, args) => {
    const result = { status: 0, stdout: '', stderr: '' };
    if (command === '/usr/bin/clang') return result;
    if (command === 'ps' && args[0] === '-wwE') {
      result.stdout = scans === 2 ? `${reusedPid} node TACHIKO_ACCEPTANCE_STEP_OWNER=${owner}\n` : '';
      return result;
    }
    // Native snapshots distinguish microseconds; the old ps scanner sees the
    // same second for both instances and would signal the unrelated replacement.
    assert.ok(command.endsWith('/process-table') || (command === 'ps' && args[0] === '-axo'));
    scans++;
    const started = command === 'ps' ? 'same second' : `1700000000.${scans === 2 ? '100000' : '900000'}`;
    result.stdout = `${process.pid} 1 1 ${started}\n`;
    if (scans >= 2) result.stdout += `${reusedPid} 1 999 ${started}\n`;
    return result;
  });
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid === reusedPid) { signals.push(signal); return true; }
    return originalKill(pid, signal);
  });
  syncBuiltinESMExports();
  assert.equal(await runStep('same-second-reuse', ['-e', ''], {}, { ...fixture.options, killGraceMs: 1 }), 0);
  assert.ok(scans >= 3, 'must observe both owned and replacement process instances');
  assert.deepEqual(signals, [], 'unrelated same-second replacement was signalled');
});

test('passing step keeps its output, details and zero exit code', async (t) => {
  const fixture = await setup(t, 60000);
  const events = ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'];
  const listenersBefore = events.map((event) => process.listenerCount(event));
  const code = await runStep('pass', ['-e', 'console.log(process.env.STEP_VALUE); console.error("stderr");'],
    { STEP_VALUE: 'stdout' }, { ...fixture.options, details: { fixture: true } });
  assert.equal(code, 0);
  assert.deepEqual(events.map((event) => process.listenerCount(event)), listenersBefore);
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'PASS']);
  assert.equal(fixture.entries[1].fixture, true);
  assert.deepEqual(fixture.options.summary, [fixture.entries[1]]);
  const [local, upload] = await fixture.logs('pass');
  assert.equal(local, upload);
  assert.deepEqual(local.trim().split('\n').sort(), ['stderr', 'stdout']);
});

test('SIGTERM-resistant step times out, escalates after grace and keeps partial logs', { timeout: 180000 }, async (t) => {
  const fixture = await setup(t, 1500);
  const descendant = `
    const net = require('node:net');
    process.on('SIGTERM', () => {});
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
  `;
  const source = `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    console.log(JSON.stringify({ parent: process.pid }));
    spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] });
    setInterval(() => {}, 1000);
  `;
  const killGraceMs = 150;
  const started = performance.now();
  const pending = runStep('hang', ['-e', source], {}, { ...fixture.options, killGraceMs });
  assert.equal(fixture.entries[0].status, 'START');
  assert.equal(await pending, 1);
  assert.ok(performance.now() - started >= 1500 + killGraceMs, 'SIGKILL preceded the grace deadline');
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'TIMEOUT']);
  assert.equal(fixture.options.summary[0].status, 'TIMEOUT');
  const [local, upload] = await fixture.logs('hang');
  assert.equal(local, upload);
  const [{ parent }, { port }] = local.trim().split('\n').map(JSON.parse);
  assert.throws(() => process.kill(parent, 0), { code: 'ESRCH' });
  await new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); reject(new Error('descendant survived timeout')); });
    socket.once('error', (error) => {
      try { assert.equal(error.code, 'ECONNREFUSED'); resolve(); } catch (failure) { reject(failure); }
    });
  });
});

test('timeout lets the step reap a detached grandchild before closing', { timeout: 180000 }, async (t) => {
  const fixture = await setup(t, 1500);
  const source = `
    const { spawn } = require('node:child_process');
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { detached: true, stdio: 'ignore' });
    process.on('SIGTERM', () => {
      grandchild.once('exit', () => process.exit(1));
      process.kill(grandchild.pid);
    });
    console.log(JSON.stringify({ parent: process.pid, grandchild: grandchild.pid }));
    setInterval(() => {}, 1000);
  `;
  let grandchild;
  t.after(async () => {
    if (!grandchild) {
      const [log] = await fixture.logs('detached');
      grandchild = JSON.parse(log.trim()).grandchild;
    }
    try { process.kill(grandchild, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  assert.equal(await runStep('detached', ['-e', source], {}, fixture.options), 1);
  const [local, upload] = await fixture.logs('detached');
  assert.equal(local, upload);
  const receipt = JSON.parse(local.trim());
  grandchild = receipt.grandchild;
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'TIMEOUT']);
  assert.equal(fixture.options.summary[0].status, 'TIMEOUT');
  assert.throws(() => process.kill(receipt.parent, 0), { code: 'ESRCH' });
  assert.throws(() => process.kill(grandchild, 0), { code: 'ESRCH' });
});

test('timeout escalates for a resistant detached grandchild after the direct child closes', { timeout: 180000 }, async (t) => {
  const timeoutMs = 30000;
  const fixture = await setup(t, timeoutMs);
  const descendant = `
    process.on('SIGTERM', () => {});
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => {
      require('node:fs').writeFileSync('grandchild.json', JSON.stringify({ pid: process.pid, port: server.address().port }));
    });
  `;
  const source = `
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { detached: true, stdio: 'ignore' });
    console.log(JSON.stringify({ parent: process.pid }));
    setInterval(() => {}, 1000);
  `;
  const killGraceMs = 300;
  let grandchild;
  t.after(() => {
    if (!grandchild) return;
    try { process.kill(grandchild, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  const started = performance.now();
  const code = await runStep('early-close', ['-e', source], {}, { ...fixture.options, killGraceMs });
  const { pid, port } = JSON.parse(await readFile(path.join(fixture.directory, 'grandchild.json'), 'utf8'));
  grandchild = pid;
  const [local] = await fixture.logs('early-close');
  const { parent } = JSON.parse(local.trim());
  t.after(() => {
    try { process.kill(-parent, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  assert.equal(code, 1);
  assert.ok(performance.now() - started >= timeoutMs + killGraceMs, 'returned before group escalation');
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'TIMEOUT']);
  assert.throws(() => process.kill(parent, 0), { code: 'ESRCH' });
  const deadline = Date.now() + 3000;
  while (true) {
    const closed = await new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(false); });
      socket.once('error', (error) => {
        if (error.code === 'ECONNREFUSED') resolve(true);
        else if (error.code === 'ECONNRESET') resolve(false);
        else reject(error);
      });
    });
    if (closed) break;
    assert.ok(Date.now() < deadline, 'grandchild survived after the direct child closed');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
});

test('successful step cleans a detached grandchild after its parent exits', { timeout: 180000 }, async t => {
  const fixture = await setup(t, 60000);
  const descendant = `
    process.on('SIGTERM', () => {});
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => {
      console.log(JSON.stringify({ pid: process.pid, port: server.address().port }));
    });
  `;
  const source = `
    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}],
      { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', data => {
      console.log(data.toString().trim());
      setTimeout(() => process.exit(0), 300);
    });
  `;
  let grandchild;
  t.after(() => {
    if (!grandchild) return;
    try { process.kill(grandchild, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  const code = await runStep('detached-success', ['-e', source], {}, { ...fixture.options, killGraceMs: 150 });
  const [log] = await fixture.logs('detached-success');
  const { pid, port } = JSON.parse(log.trim());
  grandchild = pid;
  assert.equal(code, 0);
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'PASS']);
  await new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); reject(new Error('detached grandchild survived successful step')); });
    socket.once('error', error => {
      try { assert.equal(error.code, 'ECONNREFUSED'); resolve(); } catch (failure) { reject(failure); }
    });
  });
});

for (const [label, stdio, delay] of [
  ['inherited-pipes', ['ignore', 'inherit', 'inherit'], 300],
  ['immediate-ignored', 'ignore', 0],
  ['immediate-inherited', ['ignore', 'inherit', 'inherit'], 0],
]) {
  test(`successful step cleans ${label} detached child without waiting for pipe close`, { timeout: 180000 }, async t => {
    const fixture = await setup(t, 60000);
    const heartbeat = path.join(fixture.directory, 'heartbeat');
    const descendant = `
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      setInterval(() => fs.writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())), 20);
    `;
    const source = `
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}],
        { detached: true, stdio: ${JSON.stringify(stdio)} });
      child.unref();
      console.log(JSON.stringify({ pid: child.pid }));
      ${delay ? `setTimeout(() => process.exit(0), ${delay});` : 'process.exit(0);'}
    `;
    // This process is outside the step's ownership and must survive cleanup.
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    let grandchild;
    t.after(() => {
      unrelated.kill('SIGKILL');
      if (grandchild) {
        try { process.kill(grandchild, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    });
    const code = await runStep(label, ['-e', source], {}, { ...fixture.options, killGraceMs: 100 });
    const [log] = await fixture.logs(label);
    grandchild = JSON.parse(log.trim()).pid;
    assert.equal(code, 0);
    assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'PASS']);
    const readHeartbeat = () => readFile(heartbeat, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    // A killed orphan can remain a zombie under container PID 1; its heartbeat
    // distinguishes a dead process from a runnable escaped descendant.
    await new Promise(resolve => setTimeout(resolve, 100));
    const stopped = await readHeartbeat();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await readHeartbeat(), stopped, 'detached descendant remained runnable');
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  });
}

test('nonzero step remains FAIL and retains its output in the upload directory', async (t) => {
  const fixture = await setup(t, 60000);
  assert.equal(await runStep('fail', ['-e', 'console.log("before failure"); process.exitCode = 7;'], {}, fixture.options), 7);
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'FAIL']);
  assert.deepEqual(await fixture.logs('fail'), ['before failure\n', 'before failure\n']);
});

for (const [label, detectOutputHolders, hangs, fd] of [
  ['owned-stdout', true, false, 1],
  ['owned-stderr', true, false, 2],
  ['escaped-exit', false, false, 1],
  ['ancestry-timeout', false, true, 1],
]) {
  test(`bounded output wait: ${label}`, { skip: detectOutputHolders && process.platform !== 'linux', timeout: 10000 }, async t => {
    let fixture;
    // Register before setup's directory removal, including assertion/error paths.
    t.after(async () => {
      if (!fixture) return;
      const receipt = await readFile(path.join(fixture.directory, 'pids.json'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '{}';
        throw error;
      });
      for (const pid of Object.values(JSON.parse(receipt))) {
        try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    });
    const timeoutMs = 300;
    const killGraceMs = 100;
    const closeGraceMs = 300;
    fixture = await setup(t, timeoutMs);
    const holder = `
      const fs = require('node:fs');
      setInterval(() => fs.writeFileSync('holder-heartbeat', String(Date.now())), 20);
      setTimeout(() => process.exit(0), 3000);
    `;
    const source = `
      const fs = require('node:fs');
      fs.writeFileSync('pids.json', JSON.stringify({ parent: process.pid }));
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(holder)}], {
        detached: true, env: {}, stdio: ['ignore', ${fd === 1 ? "'inherit', 'ignore'" : "'ignore', 'inherit'"}],
      });
      fs.writeFileSync('pids.json', JSON.stringify({ parent: process.pid, holder: child.pid }));
      child.unref();
      ${hangs ? 'setInterval(() => {}, 1000);' : 'process.exit(0);'}
    `;
    const started = performance.now();
    const code = await runStep(label, ['-e', source], {}, {
      ...fixture.options, killGraceMs, closeGraceMs, detectOutputHolders,
    });
    const elapsed = performance.now() - started;
    assert.ok(elapsed < timeoutMs + killGraceMs + closeGraceMs + 1000, `output wait took ${elapsed} ms`);
    const expectedStatus = hangs ? 'TIMEOUT' : detectOutputHolders ? 'PASS' : 'FAIL';
    assert.equal(code, detectOutputHolders ? 0 : 1);
    assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', expectedStatus]);
    // A live parent lets ancestry discovery record the holder before timeout,
    // even with output-holder detection disabled. That ownership now persists.
    const ownsHolder = detectOutputHolders || hangs;
    assert.equal(fixture.options.summary[0].escapedOutput, ownsHolder ? undefined : true);
    const [local, upload] = await fixture.logs(label);
    assert.equal(local, upload);
    assert.equal(local, ownsHolder ? '' : 'escaped descendant held step output open after exit; failing step\n');
    const { holder: pid } = JSON.parse(await readFile(path.join(fixture.directory, 'pids.json'), 'utf8'));
    if (ownsHolder) {
      // A dead orphan may remain a zombie; its heartbeat must stop on all hosts.
      const heartbeat = () => readFile(path.join(fixture.directory, 'holder-heartbeat'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      const stopped = await heartbeat();
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await heartbeat(), stopped, 'output holder survived cleanup');
    } else {
      assert.doesNotThrow(() => process.kill(pid, 0), 'test must exercise a surviving escaped holder');
      assert.ok(elapsed >= closeGraceMs + (hangs ? timeoutMs + killGraceMs : 0));
    }
  });
}

test('cleanup kills an output holder that closes stdout and stderr on SIGTERM', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  let fixture;
  t.after(async () => {
    if (!fixture) return;
    const { pid } = JSON.parse(await readFile(path.join(fixture.directory, 'holder.json'), 'utf8'));
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  fixture = await setup(t, 60000);
  const holder = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {
      fs.closeSync(1);
      fs.closeSync(2);
      fs.writeFileSync('term-seen', 'closed');
    });
    fs.writeFileSync('heartbeat', 'started');
    setInterval(() => fs.writeFileSync('heartbeat', String(Date.now())), 20);
    fs.writeFileSync('holder.json', JSON.stringify({ pid: process.pid }));
  `;
  const source = `
    const fs = require('node:fs');
    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(holder)}], {
      detached: true, env: {}, stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.unref();
    const ready = setInterval(() => {
      if (fs.existsSync('holder.json')) { clearInterval(ready); process.exit(0); }
    }, 10);
  `;
  const code = await runStep('closing-output', ['-e', source], {}, { ...fixture.options, killGraceMs: 150 });
  assert.equal(await readFile(path.join(fixture.directory, 'term-seen'), 'utf8'), 'closed');
  assert.equal(code, 0);
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'PASS']);
  // Allow SIGKILL delivery; an orphan can remain as a zombie under container PID 1.
  await new Promise(resolve => setTimeout(resolve, 100));
  const stopped = await readFile(path.join(fixture.directory, 'heartbeat'), 'utf8');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await readFile(path.join(fixture.directory, 'heartbeat'), 'utf8'), stopped, 'output holder survived cleanup');
  const { pid } = JSON.parse(await readFile(path.join(fixture.directory, 'holder.json'), 'utf8'));
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(error => {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  });
  assert.ok(stat === null || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z '), 'output holder survived cleanup');
});

for (const cancellation of ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit']) {
  test(`parent ${cancellation} kills the active step and detached descendant`, { timeout: 180000 }, async (t) => {
    const fixture = await setup(t, 60000);
    const descendant = `
      const server = require('node:net').createServer();
      process.on('SIGINT', () => {});
      process.on('SIGTERM', () => {});
      server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ descendant: process.pid, port: server.address().port })));
    `;
    const step = `
      console.log(JSON.stringify({ group: process.pid }));
      require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}],
        { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
      setInterval(() => {}, 1000);
    `;
    const source = `
      import { runStep } from ${JSON.stringify(new URL('../../scripts/product-acceptance-step.mjs', import.meta.url).href)};
      process.stdin.once('data', () => process.exit(9));
      await runStep('cancel', ['-e', ${JSON.stringify(step)}], {}, ${JSON.stringify(fixture.options)});
    `;
    const runner = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: fixture.directory, stdio: ['pipe', 'pipe', 'inherit'],
    });
    let group;
    let descendantPid;
    t.after(() => {
      runner.kill('SIGKILL');
      if (descendantPid) {
        try { process.kill(descendantPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      if (group) {
        try { process.kill(-group, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    });
    const exited = new Promise((resolve, reject) => {
      runner.once('error', reject);
      runner.once('exit', (code, signal) => resolve({ code, signal }));
    });
    const lines = createInterface({ input: runner.stdout });
    let port;
    for await (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.group) group = entry.group;
      if (entry.port) { port = entry.port; descendantPid = entry.descendant; break; }
    }
    assert.ok(group);
    assert.ok(port);
    if (cancellation === 'exit') runner.stdin.end('exit');
    else runner.kill(cancellation);
    assert.deepEqual(await exited, cancellation === 'exit' ? { code: 9, signal: null } : { code: null, signal: cancellation });
    const [local, upload] = await fixture.logs('cancel');
    assert.equal(local, upload);
    assert.ok(local.includes(`"port":${port}`));
    // Killing a process group is asynchronous; allow its socket to finish closing.
    const deadline = Date.now() + 3000;
    while (true) {
      const closed = await new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(false); });
        socket.once('error', (error) => {
          if (error.code === 'ECONNREFUSED') resolve(true);
          else if (error.code === 'ECONNRESET') resolve(false);
          else reject(error);
        });
      });
      if (closed) break;
      assert.ok(Date.now() < deadline, 'descendant survived parent cancellation');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
}
