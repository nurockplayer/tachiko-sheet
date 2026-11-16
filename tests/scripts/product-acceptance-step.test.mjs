import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { runStep } from '../../scripts/product-acceptance-step.mjs';

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

test('passing step keeps its output, details and zero exit code', async (t) => {
  const fixture = await setup(t, 5000);
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

test('SIGTERM-resistant step times out, escalates after grace and keeps partial logs', { timeout: 60000 }, async (t) => {
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

test('timeout lets the step reap a detached grandchild before closing', { timeout: 60000 }, async (t) => {
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

test('timeout escalates for a resistant detached grandchild after the direct child closes', { timeout: 60000 }, async (t) => {
  const fixture = await setup(t, 1500);
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
  assert.ok(performance.now() - started >= 1500 + killGraceMs, 'returned before group escalation');
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

test('successful step cleans a detached grandchild after its parent exits', { timeout: 60000 }, async t => {
  const fixture = await setup(t, 5000);
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
  test(`successful step cleans ${label} detached child without waiting for pipe close`, { timeout: 60000 }, async t => {
    const fixture = await setup(t, 800);
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
  const fixture = await setup(t, 5000);
  assert.equal(await runStep('fail', ['-e', 'console.log("before failure"); process.exitCode = 7;'], {}, fixture.options), 7);
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'FAIL']);
  assert.deepEqual(await fixture.logs('fail'), ['before failure\n', 'before failure\n']);
});

for (const cancellation of ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit']) {
  test(`parent ${cancellation} kills the active step and detached descendant`, { timeout: 60000 }, async (t) => {
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
