import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
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
  const code = await runStep('pass', ['-e', 'console.log(process.env.STEP_VALUE); console.error("stderr");'],
    { STEP_VALUE: 'stdout' }, { ...fixture.options, details: { fixture: true } });
  assert.equal(code, 0);
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'PASS']);
  assert.equal(fixture.entries[1].fixture, true);
  assert.deepEqual(fixture.options.summary, [fixture.entries[1]]);
  const [local, upload] = await fixture.logs('pass');
  assert.equal(local, upload);
  assert.deepEqual(local.trim().split('\n').sort(), ['stderr', 'stdout']);
});

test('hanging child times out, kills its process group and keeps partial logs', { timeout: 10000 }, async (t) => {
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
  const pending = runStep('hang', ['-e', source], {}, fixture.options);
  assert.equal(fixture.entries[0].status, 'START');
  assert.equal(await pending, 1);
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

test('nonzero step remains FAIL and retains its output in the upload directory', async (t) => {
  const fixture = await setup(t, 5000);
  assert.equal(await runStep('fail', ['-e', 'console.log("before failure"); process.exitCode = 7;'], {}, fixture.options), 7);
  assert.deepEqual(fixture.entries.map(({ status }) => status), ['START', 'FAIL']);
  assert.deepEqual(await fixture.logs('fail'), ['before failure\n', 'before failure\n']);
});
