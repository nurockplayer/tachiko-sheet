// Serial, fail-closed #146 acceptance wiring. This orchestrates the frozen
// current-entry/prerequisite seeds and the separate production lifecycle seed.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = '375d25ea12262bec32e2303b3c63662f0b69322f';
const expectedPrerequisites = [
  'KIT-date-only-csv', 'KIT-unrelated-populated-date-xlsx', 'KIT-unrelated-empty-date-schema-xlsx',
  'ADAPTER-stale-witness', 'ADAPTER-stale-bootstrap', 'ADAPTER-stale-table',
  'ADAPTER-unavailable-unrelated-table',
];
const expectedCurrent = [
  'A-Date-only-normal-Save-fresh-reopen', 'B-same-table-Date-summary-refusal',
  'C-unrelated-Date-summary-refusal', 'C-empty-unrelated-Date-schema-refusal',
  'D-canonical-opaque-complete-copy-controls', 'E-CSV64-row-control', 'E-CSV16-column-control',
  'E-profile-refusal-rows-65.csv', 'E-profile-refusal-fields-17.csv',
  'F-existing-read-fault-no-publication-recovery', 'R-unchanged-private-reader-Date-fixture',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evidenceRoot = path.resolve(process.env.TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR ?? path.join(os.tmpdir(), `tachiko-sheet-146-${Date.now()}-${process.pid}`));
const gateDir = path.join(evidenceRoot, 'save-closure');
const port = Number(process.env.TACHIKO_SAVE_CLOSURE_PORT ?? '4786');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('BLOCKED: acceptance port must be an integer in 1024..65535');
  process.exit(78);
}
await rm(gateDir, { recursive: true, force: true });
await rm(path.join(evidenceRoot, 'summary.json'), { force: true });
await rm(path.join(evidenceRoot, 'production-build.json'), { force: true });
await mkdir(gateDir, { recursive: true });

async function git(args) {
  const result = await capture('git', args, { cwd: root, quiet: true });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.output}`);
  return result.output.trim();
}
async function inventory(directory) {
  const files = [];
  async function walk(relative = '') {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error(`BLOCKED: unsupported acceptance artifact entry ${child}`);
    }
  }
  await walk();
  const sorted = await Promise.all(files.sort().map(async (file) => [file, sha256(await readFile(path.join(directory, file)))]));
  return { files: sorted, digest: sha256(JSON.stringify(sorted)) };
}
function capture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd ?? root, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.once('error', (error) => { const bytes = Buffer.concat(chunks); resolve({ code: 127, signal: null, bytes, output: bytes.toString() + error.message }); });
    child.once('exit', (code, signal) => { const bytes = Buffer.concat(chunks); resolve({ code: typeof code === 'number' ? code : 1, signal, bytes, output: bytes.toString() }); });
  });
}
const nulPaths = (value) => value.split('\0').filter(Boolean).sort();
async function candidateIdentity() {
  const head = await git(['rev-parse', 'HEAD']);
  const ancestor = await capture('git', ['merge-base', '--is-ancestor', base, head], { cwd: root });
  if (ancestor.code !== 0) throw new Error(`candidate HEAD ${head} is not descended from exact base ${base}`);
  const committed = nulPaths((await capture('git', ['diff', '--name-only', '-z', `${base}..${head}`], { cwd: root })).output);
  const trackedDirty = nulPaths((await capture('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: root })).output);
  const untracked = nulPaths((await capture('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root })).output);
  const dirty = [...new Set([...trackedDirty, ...untracked])].sort();
  const committedFiles = [];
  for (const file of committed) {
    const blob = await capture('git', ['show', `HEAD:${file}`], { cwd: root });
    if (blob.code !== 0) throw new Error(`cannot hash committed candidate path ${file}`);
    committedFiles.push([file, sha256(blob.bytes)]);
  }
  const dirtyFiles = [];
  for (const file of dirty) {
    try { dirtyFiles.push([file, sha256(await readFile(path.join(root, file)))]); }
    catch { dirtyFiles.push([file, 'DELETED']); }
  }
  const identity = { base, head, committedFiles, dirtyFiles };
  identity.sha256 = sha256(JSON.stringify(identity));
  return identity;
}
const summary = { base, evidenceRoot, gate: { status: 'NOT RUN' }, aggregateStatus: 'NOT RUN', expectedCases: { prerequisites: expectedPrerequisites, currentSaveClosure: expectedCurrent }, identity: {}, suites: [], diagnostics: [], mutations: Object.fromEntries(['M1', 'M2', 'M3', 'M4', 'M5a', 'M5b', 'M6'].map((id) => [id, 'NOT RUN'])) };
const receiptPaths = {
  prerequisites: path.join(gateDir, 'prerequisites.json'),
  currentSaveClosure: path.join(gateDir, 'current-save-closure.json'),
  prerequisitesSeed: path.join(gateDir, 'prerequisites.seed.json'),
  currentSaveClosureSeed: path.join(gateDir, 'current-save-closure.seed.json'),
};
const logPaths = { prerequisites: path.join(gateDir, 'prerequisites.log'), currentSaveClosure: path.join(gateDir, 'current-save-closure.log') };

async function recordRun(name, seedName, expectedIds, command, args, env = {}) {
  const seedPath = receiptPaths[seedName];
  await rm(seedPath, { force: true });
  const run = await capture(command, args, { env });
  await writeFile(logPaths[name], run.output);
  let receipt;
  try { receipt = JSON.parse(await readFile(seedPath, 'utf8')); } catch {}
  let status = receipt?.status ?? 'BLOCKED';
  if (status === 'BLOCKED_OR_FAIL') {
    const error = receipt.error;
    status = error?.name === 'AssertionError' && !/^BLOCKED:/i.test(error.message ?? '') ? 'BEHAVIORAL_RED' : 'BLOCKED';
  }
  if (!['PASS', 'BEHAVIORAL_RED', 'BLOCKED', 'NOT RUN'].includes(status)) status = 'BLOCKED';
  let ids = [];
  if (name === 'prerequisites') ids = receipt?.cases ?? [];
  else ids = receipt?.results?.map((item) => item.id) ?? [];
  const unique = new Set(ids);
  const registryValid = ids.length === expectedIds.length && unique.size === expectedIds.length && JSON.stringify(ids) === JSON.stringify(expectedIds);
  if (!registryValid) status = 'BLOCKED';
  if (receipt && receipt.base !== base) status = 'BLOCKED';
  if (status === 'PASS' && (run.code !== 0 || (name === 'currentSaveClosure' && (!Array.isArray(receipt.results) || receipt.results.some((item) => item.result !== 'PASS'))))) status = 'BLOCKED';
  if (name === 'prerequisites' && status === 'PASS') {
    const actual = [...(receipt.result?.kit ?? []).map((item) => item.id), ...(receipt.result?.adapter ?? []).map((item) => item.id)];
    if (JSON.stringify(actual) !== JSON.stringify(expectedIds)) status = 'BLOCKED';
  }
  const caseOutcomes = expectedIds.map((id, index) => ({
    id,
    status: status === 'PASS' ? 'PASS'
      : registryValid && name === 'currentSaveClosure' ? (receipt?.results?.[index]?.result ?? 'NOT RUN')
        : 'BLOCKED',
  }));
  const seedHash = receipt ? sha256(await readFile(seedPath)) : null;
  const envelope = { status, candidate: summary.identity.candidate, candidateIdentity: summary.identity.candidate.sha256, base, head: summary.identity.candidate.head, frozenSeedHashes: summary.identity.frozenSeedHashes, expectedCaseIds: expectedIds, caseOutcomes, seedReceipt: seedPath, seedReceiptSha256: seedHash, error: receipt?.error };
  await writeFile(receiptPaths[name], `${JSON.stringify(envelope, null, 2)}\n`);
  const entry = { name, status, exitCode: run.code, signal: run.signal, receipt: receiptPaths[name], seedReceipt: seedPath, log: logPaths[name], cases: caseOutcomes, error: receipt?.error };
  summary.suites.push(entry);
  return { ...entry, receipt, envelope };
}

let acceptanceServer;
async function startServer(name, command, args, env, readyText) {
  const output = [];
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  let ready = false;
  const collect = (chunk) => { output.push(chunk); if (Buffer.concat(output).toString().includes(readyText)) ready = true; };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const exit = new Promise((resolve) => child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); }));
  const deadline = Date.now() + 15000;
  while (!ready && !exited && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  await writeFile(path.join(evidenceRoot, `${name}-startup.log`), Buffer.concat(output));
  if (!ready || exited) throw new Error(`${name} did not report its exact ready URL; exit=${JSON.stringify(await Promise.race([exit, Promise.resolve(null)]))}`);
  return { child, exit, output, async stop() {
    if (!exited) child.kill('SIGTERM');
    const stopped = await Promise.race([exit.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5000))]);
    if (!stopped) { child.kill('SIGKILL'); await exit; }
    await writeFile(path.join(evidenceRoot, `${name}-server.log`), Buffer.concat(output));
  } };
}

try {
  const currentBranch = await git(['branch', '--show-current']);
  summary.identity.candidate = await candidateIdentity();
  const seedHashes = {
    'tests/product/web-save-closure-current.mjs': '9723a8163a8ac8bb336a4534e4cf92278e32604e6f98d5a87c857e0156379a36',
    'tests/product/web-save-closure-prerequisites.mjs': 'b3e0f9a99b64db9d8bc0caa35e78fc7973f96896bd84f4d77eb5cec08bd9e704',
    'tests/product/production-lifecycle.mjs': 'eb9cb264f1d7e561e506810a5ae4bb1be086102977b3a786d8f9488a452eb77d',
  };
  for (const [file, expected] of Object.entries(seedHashes)) {
    const actual = sha256(await readFile(path.join(root, file)));
    if (actual !== expected) throw new Error(`frozen seed drift: ${file} expected ${expected}, found ${actual}`);
  }
  const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
  summary.identity = {
    ...summary.identity, branch: currentBranch || '(detached)',
    frozenSeedHashes: seedHashes,
    producer: { sourceRepository: lock.sourceRepository, sourceCommit: lock.sourceCommit, artifactManifestSha256: lock.artifactManifestSha256 },
    adapterAndSources: {
      'acceptance/web-save-closure/product.ego.mjs': sha256(await readFile(path.join(root, 'acceptance/web-save-closure/product.ego.mjs'))),
      'acceptance/web-save-closure/qualify-kit.ego.mjs': sha256(await readFile(path.join(root, 'acceptance/web-save-closure/qualify-kit.ego.mjs'))),
      'acceptance/web-save-closure/adapter.ego.mjs': sha256(await readFile(path.join(root, 'acceptance/web-save-closure/adapter.ego.mjs'))),
    },
    mutationProbes: summary.mutations,
  };

  let run;
  // Build and run are explicit stages, recorded before any browser suite starts.
  const acceptanceBuild = await capture('pnpm', ['build:acceptance']);
  await writeFile(path.join(evidenceRoot, 'build-acceptance.log'), acceptanceBuild.output);
  summary.suites.push({ name: 'build:acceptance', status: acceptanceBuild.code === 0 ? 'PASS' : 'BLOCKED', exitCode: acceptanceBuild.code, log: path.join(evidenceRoot, 'build-acceptance.log') });
  if (acceptanceBuild.code !== 0) throw new Error('acceptance build failed; browser suites are BLOCKED and NOT RUN');
  summary.acceptanceArtifact = await inventory(path.join(root, 'dist-acceptance'));
  acceptanceServer = await startServer('acceptance', process.execPath, [path.join(root, 'acceptance/web-save-closure/serve.mjs')], {
    SAVE_CLOSURE_DIST: path.join(root, 'dist-acceptance'), SAVE_CLOSURE_PORT: String(port),
  }, `http://127.0.0.1:${port}`);
  const adapterBuild = await capture(process.execPath, [path.join(root, 'acceptance/web-save-closure/prepare-adapter.mjs')]);
  await writeFile(path.join(evidenceRoot, 'prepare-adapter.log'), adapterBuild.output);
  summary.suites.push({ name: 'prepare-exact-source-adapter', status: adapterBuild.code === 0 ? 'PASS' : 'BLOCKED', exitCode: adapterBuild.code, log: path.join(evidenceRoot, 'prepare-adapter.log') });
  if (adapterBuild.code !== 0) throw new Error('exact-source adapter generation failed; producer prerequisites are BLOCKED and NOT RUN');
  summary.identity.adapter = {
    exactAdapterSha256: sha256(await readFile(path.join(root, 'acceptance/web-save-closure/adapter.ego.mjs'))),
    generatedRuntimeSha256: sha256(await readFile(path.join(root, 'acceptance/web-save-closure/.generated/runtime/session.js'))),
    generatedSourceReceiptSha256: sha256(await readFile(path.join(root, 'acceptance/web-save-closure/.generated/sources.json'))),
    sourceContractsSha256: sha256(await readFile(path.join(root, 'src/contracts.ts'))),
    sourceSessionSha256: sha256(await readFile(path.join(root, 'src/runtime/session.ts'))),
  };
  run = await recordRun('prerequisites', 'prerequisitesSeed', expectedPrerequisites, process.execPath, [path.join(root, 'tests/product/web-save-closure-prerequisites.mjs')], {
    SAVE_CLOSURE_PREP: path.join(root, 'acceptance/web-save-closure'), SAVE_CLOSURE_ORIGIN: `http://127.0.0.1:${port}`,
    SAVE_CLOSURE_RECEIPT: receiptPaths.prerequisitesSeed,
  });
  if (run.status === 'PASS' && run.exitCode === 0) {
    run = await recordRun('currentSaveClosure', 'currentSaveClosureSeed', expectedCurrent, process.execPath, [path.join(root, 'tests/product/web-save-closure-current.mjs')], {
      SAVE_CLOSURE_PREP: path.join(root, 'acceptance/web-save-closure'), SAVE_CLOSURE_ORIGIN: `http://127.0.0.1:${port}`,
      SAVE_CLOSURE_RECEIPT: receiptPaths.currentSaveClosureSeed, SAVE_CLOSURE_MODE: 'candidate',
    });
  } else {
    summary.suites.push({ name: 'currentSaveClosure', status: 'NOT RUN', cases: expectedCurrent.map((id) => ({ id, status: 'NOT RUN' })), reason: 'real producer/adapter prerequisites did not PASS' });
  }
  await acceptanceServer.stop(); acceptanceServer = undefined;

} catch (error) {
  summary.diagnostics.push({ status: 'BLOCKED', message: error.message, stack: error.stack });
} finally {
  if (acceptanceServer) await acceptanceServer.stop().catch(() => {});
  if (!summary.suites.some((entry) => entry.name === 'prerequisites')) summary.suites.push({ name: 'prerequisites', status: 'NOT RUN', cases: expectedPrerequisites.map((id) => ({ id, status: 'NOT RUN' })) });
  if (!summary.suites.some((entry) => entry.name === 'currentSaveClosure')) summary.suites.push({ name: 'currentSaveClosure', status: 'NOT RUN', cases: expectedCurrent.map((id) => ({ id, status: 'NOT RUN' })) });
  const required = ['build:acceptance', 'prepare-exact-source-adapter', 'prerequisites', 'currentSaveClosure'].map((name) => summary.suites.find((entry) => entry.name === name)?.status ?? 'NOT RUN');
  summary.gate.status = summary.diagnostics.length || required.includes('BLOCKED') ? 'BLOCKED'
    : required.includes('BEHAVIORAL_RED') ? 'BEHAVIORAL_RED'
      : required.every((status) => status === 'PASS') ? 'PASS' : 'NOT RUN';
  summary.aggregateStatus = 'NOT RUN';
  summary.status = summary.gate.status;
  summary.caseOutcomes = [...(summary.suites.find((entry) => entry.name === 'prerequisites')?.cases ?? []), ...(summary.suites.find((entry) => entry.name === 'currentSaveClosure')?.cases ?? [])];
  summary.identity.mutationProbes = summary.mutations;
  summary.receipts = receiptPaths;
  await writeFile(path.join(evidenceRoot, 'save-closure-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const saveClosureSummary = path.join(evidenceRoot, 'save-closure-summary.json');
  const aggregate = {
    base, evidenceRoot, status: 'NOT RUN', gates: { saveClosure: summary.gate.status, productionLifecycle: 'NOT RUN' },
    candidateIdentity: summary.identity.candidate, identity: summary.identity, acceptanceArtifact: summary.acceptanceArtifact ?? null,
    saveClosureReceipt: saveClosureSummary, saveClosureReceiptSha256: sha256(await readFile(saveClosureSummary)),
    caseOutcomes: summary.caseOutcomes, diagnostics: summary.diagnostics,
  };
  await writeFile(path.join(evidenceRoot, 'summary.json'), `${JSON.stringify(aggregate, null, 2)}\n`);
  console.log(JSON.stringify({ status: summary.status, identity: summary.identity, suites: summary.suites, caseOutcomes: summary.caseOutcomes, receipts: summary.receipts, evidenceRoot }, null, 2));
  if (summary.status !== 'PASS') process.exitCode = summary.status === 'BEHAVIORAL_RED' ? 1 : 78;
}
