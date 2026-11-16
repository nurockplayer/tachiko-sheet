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
import { runStep as runAcceptanceStep } from './product-acceptance-step.mjs';
import { selectSteps } from './product-acceptance-shards.mjs';
import durations from './product-acceptance-durations.json' with { type: 'json' };

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

const summary = [];

async function runStep(name, args, extraEnvironment = {}, options = {}) {
  return runAcceptanceStep(name, args, extraEnvironment, {
    cwd: root,
    evidenceDir,
    summary,
    ...options,
  });
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

function productSteps({ singleProcessEnv = {}, chromiumSupport = {}, serving = {}, homeVisualOut } = {}) {
  return [
    { name: 'workbook-tabs-local',
      args: [path.join(root, 'tests', 'product', 'workbook-tabs-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'mutation-completion-local',
      args: [path.join(root, 'tests', 'product', 'mutation-completion-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'new-table-rows-local',
      args: [path.join(root, 'tests', 'product', 'new-table-rows-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'selection-statistics-local',
      args: [path.join(root, 'tests', 'product', 'selection-statistics-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'clipboard-local',
      args: [path.join(root, 'tests', 'product', 'clipboard-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'editing-basics-local',
      args: [path.join(root, 'tests', 'product', 'editing-basics-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'find-replace-local',
      args: [path.join(root, 'tests', 'product', 'find-replace-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'filter-local',
      args: [path.join(root, 'tests', 'product', 'filter-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'columns-local',
      args: [path.join(root, 'tests', 'product', 'columns-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'calculated-row-local',
      args: [path.join(root, 'tests', 'product', 'calculated-row-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'working-size-bounds-local',
      args: [path.join(root, 'tests', 'product', 'working-size-bounds-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'presentation-roundtrip-local',
      args: [path.join(root, 'tests', 'product', 'presentation-roundtrip-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'column-alignment-local',
      args: [path.join(root, 'tests', 'product', 'column-alignment-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'column-date-display-local',
      args: [path.join(root, 'tests', 'product', 'column-date-display-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'working-size-entries-local',
      args: [path.join(root, 'tests', 'product', 'working-size-entries-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'j1-tracker-local',
      args: [path.join(root, 'tests', 'product', 'j1-tracker-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'work-file-local',
      args: [path.join(root, 'tests', 'product', 'work-file-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'work-file-save-local',
      args: [path.join(root, 'tests', 'product', 'work-file-save-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'v3-folder-save-local',
      args: [path.join(root, 'tests', 'product', 'v3-folder-save-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'save-close-local',
      args: [path.join(root, 'tests', 'product', 'save-close-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'save-update-local',
      args: [path.join(root, 'tests', 'product', 'save-update-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'j4-normal-ui-local-transport',
      args: [path.join(root, 'tests', 'product', 'j4-normal-ui-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'native-export-local',
      args: [path.join(root, 'tests', 'product', 'native-export-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'templates-local',
      args: [path.join(root, 'tests', 'product', 'templates-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'bank-statement-local',
      args: [path.join(root, 'tests', 'product', 'bank-statement-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'j4-imported-attachment-local-transport',
      args: [path.join(root, 'tests', 'product', 'j4-imported-attachment-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'result-composition-local',
      args: [path.join(root, 'tests', 'product', 'result-composition-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'results-chart-redraw', server: true,
      args: [path.join(root, 'tests', 'product', 'results-chart-redraw.mjs')],
      env: { ...(serving.ready ? { WORK_CLIENT_URL: baseUrl } : {}), WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'j5-report-local-transport',
      args: [path.join(root, 'tests', 'product', 'j5-report-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'save-read-fault-regression-local-transport',
      args: [path.join(root, 'tests', 'product', 'save-read-fault-regression.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'interface-profile-local-transport',
      args: [path.join(root, 'tests', 'product', 'interface-profile-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'appearance-selector-local',
      args: [path.join(root, 'tests', 'product', 'appearance-selector-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'appearance-visual-local',
      args: [path.join(root, 'tests', 'product', 'appearance-visual-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'home-visual-local',
      args: [path.join(root, 'tests', 'product', 'home-visual-local.mjs')],
      env: { WORK_DIST: acceptanceDir, HOME_VISUAL_OUT: homeVisualOut, ...singleProcessEnv },
      options: { details: { evidenceDirectory: homeVisualOut } },
    },
    { name: 'interface-profile-interchange-local',
      args: [path.join(root, 'tests', 'product', 'interface-profile-interchange-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'primary-actions-forced-colors-local-transport',
      args: [path.join(root, 'tests', 'product', 'primary-actions-forced-colors-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'initial-launch-local-transport',
      args: [path.join(root, 'tests', 'product', 'initial-launch-regression.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'undo-redo-local',
      args: [path.join(root, 'tests', 'product', 'undo-redo-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'cell-editing-regression', server: true,
      args: [path.join(root, 'tests', 'product', 'cell-editing-regression.mjs')],
      env: { ...(serving.ready ? { WORK_CLIENT_URL: baseUrl } : { WORK_DIST: acceptanceDir }), ...singleProcessEnv,
      ...(chromiumSupport.executablePath ? { WORK_CHROMIUM: chromiumSupport.executablePath } : {}) },
    },
    { name: 'j3-normal-ui-local-transport',
      args: [path.join(root, 'tests', 'product', 'j3-normal-ui-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'grid-window-local',
      args: [path.join(root, 'tests', 'product', 'grid-window-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'import-recognizable-local',
      args: [path.join(root, 'tests', 'product', 'import-recognizable-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'capacity-8406-local',
      args: [path.join(root, 'tests', 'product', 'capacity-8406-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'mixed-import-local',
      args: [path.join(root, 'tests', 'product', 'mixed-import-local.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
    { name: 'browser-m1', server: true,
      args: [path.join(root, 'tests', 'browser.mjs')],
      env: {
      WORK_CLIENT_URL: baseUrl,
      WORK_PLAYWRIGHT_MODULE: 'playwright-core',
      ...(chromiumSupport.executablePath
        ? { WORK_CHROMIUM: chromiumSupport.executablePath, TACHIKO_TEST_SINGLE_PROCESS: '1' }
        : {}),
    },
      fallback: { name: 'browser-m1-local-transport', args: [path.join(root, 'tests', 'product', 'm1-local.mjs')], env: { WORK_DIST: acceptanceDir, ...singleProcessEnv } },
    },
    { name: 'browser-recovery-regression', server: true,
      args: [path.join(root, 'tests', 'product', 'recovery-regression.mjs')],
      env: {
      WORK_CLIENT_URL: baseUrl,
      WORK_PLAYWRIGHT_MODULE: 'playwright-core',
      ...(chromiumSupport.executablePath
        ? { WORK_CHROMIUM: chromiumSupport.executablePath, TACHIKO_TEST_SINGLE_PROCESS: '1' }
        : {}),
    },
    },
    { name: 'browser-initial-launch-regression', server: true,
      args: [path.join(root, 'tests', 'product', 'initial-launch-regression.mjs')],
      env: {
      WORK_CLIENT_URL: baseUrl,
      WORK_DIST: acceptanceDir,
      WORK_PLAYWRIGHT_MODULE: 'playwright-core',
      ...(chromiumSupport.executablePath
        ? { WORK_CHROMIUM: chromiumSupport.executablePath, TACHIKO_TEST_SINGLE_PROCESS: '1' }
        : {}),
    },
    },
    { name: 'product-focus', server: true,
      args: [path.join(root, 'tests', 'product', 'focus-regression.mjs')],
      env: {
      WORK_CLIENT_URL: baseUrl,
      WORK_PLAYWRIGHT_MODULE: 'playwright-core',
      ...(chromiumSupport.executablePath
        ? { WORK_CHROMIUM: chromiumSupport.executablePath, TACHIKO_TEST_SINGLE_PROCESS: '1' }
        : {}),
    },
      fallback: { name: 'product-focus-local-transport', args: [path.join(root, 'tests', 'product', 'focus-regression.mjs')], env: { WORK_DIST: acceptanceDir, ...singleProcessEnv } },
    },
    { name: 'dialog-operation-recovery-local-transport',
      args: [path.join(root, 'tests', 'product', 'dialog-operation-recovery.mjs')],
      env: { WORK_DIST: acceptanceDir, ...singleProcessEnv },
    },
  ];
}

if (process.argv.includes('--list')) {
  console.log(JSON.stringify(productSteps().map(({ name }) => name)));
  process.exit(0);
}
const selection = selectSteps(productSteps(), durations, process.env.TACHIKO_ACCEPTANCE_SHARD);
const selectedSteps = selection.steps.map(({ name }) => name);
await mkdir(evidenceDir, { recursive: true });
const writeSummary = (result) => writeFile(
  path.join(evidenceDir, 'summary.json'),
  JSON.stringify({ ...result, shard: selection.shard, selectedSteps }, null, 2),
);

let exitCode = 0;
let status = "PASS";
const copyStep = await runStep('copy-example-fixture', [path.join(root, 'scripts', 'copy-example-fixture.mjs')]);
const buildStep =
  copyStep === 0
    ? await runStep('build-acceptance', [vite, 'build', '--mode', 'acceptance'])
    : 1;

if (buildStep !== 0) {
  console.error('BLOCKED: the acceptance build did not complete; no behavioral result is reported.');
  await writeSummary({ status: 'BLOCKED', summary });
  process.exit(78);
}

const needsServer = selection.steps.some((step) => step.server);
const serving = needsServer ? await startServer() : null;
const chromiumSupport = await resolveChromium();
console.log(
  JSON.stringify({ step: 'chromium-probe', status: 'PASS', singleProcess: chromiumSupport.singleProcess }),
);
const singleProcessEnv = chromiumSupport.singleProcess ? { TACHIKO_TEST_SINGLE_PROCESS: '1' } : {};
try {
  const homeVisualOut = selectedSteps.includes('home-visual-local')
    ? await mkdtemp(path.join(tmpdir(), 'tachiko-sheet-home-visual-')) : undefined;
  const steps = productSteps({ singleProcessEnv, chromiumSupport, serving: serving ?? {}, homeVisualOut });
  const canonicalBlocked = needsServer && !serving.ready;
  const results = [];
  for (const step of steps.filter(({ name }) => selectedSteps.includes(name))) {
    if (canonicalBlocked && step.server && !step.env.WORK_DIST) {
      if (step.fallback) {
        const fallback = step.fallback;
        results.push(await runStep(fallback.name, fallback.args, fallback.env));
      }
      continue;
    }
    // The initial-launch canonical regression has WORK_DIST as well as the URL.
    if (canonicalBlocked && step.name === 'browser-initial-launch-regression') continue;
    results.push(await runStep(step.name, step.args, step.env, step.options));
  }
  const localOk = results.every((code) => code === 0);
  if (canonicalBlocked) {
    console.error(`BLOCKED: the canonical acceptance server did not start.\n${Buffer.concat(serving.output).toString()}`);
    exitCode = localOk ? 79 : 1;
    status = `BLOCKED-CANONICAL; local-transport ${localOk ? 'PASS' : 'FAIL'}`;
  } else {
    exitCode = localOk ? 0 : 1;
    status = exitCode === 0 ? 'PASS' : 'FAIL';
  }
} finally {
  await serving?.stop();
}

await writeSummary({ status, baseUrl, summary });
process.exit(exitCode);
