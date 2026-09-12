// Self-contained Sheet product acceptance runner.
//
// It builds the acceptance distributable, serves it on this origin, runs the
// unchanged six M1 journeys in tests/browser.mjs with WORK_CLIENT_URL, runs the
// focused product regression, always tears the server down and preserves logs.
// Assertions are never modified to pass; infrastructure failures are reported
// separately from behavioral failures.
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const server = path.join(root, 'scripts', 'serve-dist.mjs');
const acceptanceDir = path.join(root, 'dist-acceptance');
const evidenceDir = path.join(root, 'evidence', 'product-acceptance');
const port = Number(process.env.TACHIKO_PRODUCT_PORT ?? '4197');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('TACHIKO_PRODUCT_PORT must be 1024..65535');
}
const baseUrl = `http://127.0.0.1:${port}`;
await mkdir(evidenceDir, { recursive: true });

const summary = [];

async function runStep(name, args, extraEnvironment = {}, options = {}) {
  const output = [];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...extraEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => {
    output.push(chunk);
    (options.quiet ? process.stderr : process.stdout).write(chunk);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const exitCode = typeof result.code === 'number' ? result.code : 1;
  const log = path.join(evidenceDir, `${name}.log`);
  await writeFile(log, Buffer.concat(output));
  const entry = { step: name, status: exitCode === 0 ? 'PASS' : 'FAIL', exitCode, log };
  summary.push(entry);
  console.log(JSON.stringify(entry));
  return exitCode;
}

async function startServer() {
  const output = [];
  const child = spawn(process.execPath, [server, acceptanceDir], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  let exited = false;
  const exit = new Promise((resolve) => child.once('exit', () => { exited = true; resolve(); }));
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output.push(chunk);
      if (output.join('').includes(`Sheet product server: ${baseUrl}`)) ready = true;
    });
  }
  const deadline = Date.now() + 15000;
  while (!ready && !exited && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    child,
    exit,
    ready: ready && !exited,
    output,
    async stop() {
      await writeFile(path.join(evidenceDir, 'server.log'), Buffer.concat(output));
      if (exited || !child.pid) return;
      child.kill('SIGTERM');
      const stopped = await Promise.race([
        exit.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);
      if (!stopped && !exited) {
        child.kill('SIGKILL');
        await exit;
      }
    },
  };
}

/**
 * tests/browser.mjs is unchanged acceptance and only accepts an executable
 * path. A confined macOS sandbox denies Chromium's mach-port rendezvous, so
 * this runner probes a normal launch and, only when that infrastructure is
 * unavailable, supplies a wrapper executable that re-adds `--single-process`.
 */
async function resolveChromium() {
  const { chromium } = await import('playwright-core');
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return { singleProcess: false, executablePath: null };
  } catch {
    const real = process.env.WORK_CHROMIUM ?? chromium.executablePath();
    if (!real) return { singleProcess: true, executablePath: null };
    const dir = await mkdtemp(path.join(tmpdir(), 'tachiko-sheet-chromium-'));
    const wrapper = path.join(dir, 'chromium-single-process');
    await writeFile(wrapper, `#!/bin/sh\nexec "${real}" --single-process "$@"\n`);
    await chmod(wrapper, 0o755);
    return { singleProcess: true, executablePath: wrapper };
  }
}

let exitCode = 0;
let status = "PASS";
const copyStep = await runStep('copy-example-fixture', [path.join(root, 'scripts', 'copy-example-fixture.mjs')]);
const buildStep =
  copyStep === 0
    ? await runStep('build-acceptance', [vite, 'build', '--mode', 'acceptance'])
    : 1;

if (buildStep !== 0) {
  console.error('BLOCKED: the acceptance build did not complete; no behavioral result is reported.');
  await writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify({ status: 'BLOCKED', summary }, null, 2));
  process.exit(78);
}

const serving = await startServer();
const chromiumSupport = await resolveChromium();
console.log(
  JSON.stringify({ step: 'chromium-probe', status: 'PASS', singleProcess: chromiumSupport.singleProcess }),
);
const singleProcessEnv = chromiumSupport.singleProcess ? { TACHIKO_TEST_SINGLE_PROCESS: '1' } : {};
try {
  if (!serving.ready) {
    console.error(`BLOCKED: the canonical acceptance server did not start.\n${Buffer.concat(serving.output).toString()}`);
    // Supporting evidence only: the same six product outcomes over a disk-routed
    // transport. This is NOT the unchanged tests/browser.mjs acceptance.
    const localM1 = await runStep(
      'browser-m1-local-transport',
      [path.join(root, 'tests', 'product', 'm1-local.mjs')],
      { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    );
    const localFocus = await runStep(
      'product-focus-local-transport',
      [path.join(root, 'tests', 'product', 'focus-regression.mjs')],
      { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    );
    const localOk = localM1 === 0 && localFocus === 0;
    exitCode = localOk ? 79 : 1;
    status = `BLOCKED-CANONICAL; local-transport ${localOk ? 'PASS' : 'FAIL'}`;
  } else {
    const browser = await runStep('browser-m1', [path.join(root, 'tests', 'browser.mjs')], {
      WORK_CLIENT_URL: baseUrl,
      WORK_PLAYWRIGHT_MODULE: 'playwright-core',
      ...(chromiumSupport.executablePath
        ? { WORK_CHROMIUM: chromiumSupport.executablePath, TACHIKO_TEST_SINGLE_PROCESS: '1' }
        : {}),
    });
    const recovery = await runStep('browser-recovery-regression', [path.join(root, 'tests', 'product', 'recovery-regression.mjs')], {
      WORK_CLIENT_URL: baseUrl,
      WORK_PLAYWRIGHT_MODULE: 'playwright-core',
      ...(chromiumSupport.executablePath
        ? { WORK_CHROMIUM: chromiumSupport.executablePath, TACHIKO_TEST_SINGLE_PROCESS: '1' }
        : {}),
    });
    const focus = await runStep('product-focus', [path.join(root, 'tests', 'product', 'focus-regression.mjs')], {
      WORK_CLIENT_URL: baseUrl,
      WORK_PLAYWRIGHT_MODULE: 'playwright-core',
      ...(chromiumSupport.executablePath
        ? { WORK_CHROMIUM: chromiumSupport.executablePath, TACHIKO_TEST_SINGLE_PROCESS: '1' }
        : {}),
    });
    exitCode = browser === 0 && recovery === 0 && focus === 0 ? 0 : 1;
    status = exitCode === 0 ? 'PASS' : 'FAIL';
  }
} finally {
  await serving.stop();
}

await writeFile(
  path.join(evidenceDir, 'summary.json'),
  JSON.stringify({ status, baseUrl, summary }, null, 2),
);
process.exit(exitCode);
