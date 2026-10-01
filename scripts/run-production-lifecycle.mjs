// Build and qualify the hook-free production artifact over HTTP, including a
// full owned Chromium process restart and downloaded PNG artifact oracle.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureRunnerCommand, createRunnerCancellation, finalizeProductionLifecycleServer, startRunnerServer } from './runner-process-lifecycle.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cancellation = createRunnerCancellation();
const lifecycleChildTimeoutMs = 5 * 60 * 1000;
const base = '375d25ea12262bec32e2303b3c63662f0b69322f';
const expectedPrerequisites = [
  'KIT-date-only-csv', 'KIT-unrelated-populated-date-xlsx', 'KIT-unrelated-empty-date-schema-xlsx',
  'ADAPTER-stale-witness', 'ADAPTER-stale-bootstrap', 'ADAPTER-stale-table', 'ADAPTER-unavailable-unrelated-table',
];
const expectedCurrent = [
  'A-Date-only-normal-Save-fresh-reopen', 'B-same-table-Date-summary-refusal',
  'C-unrelated-Date-summary-refusal', 'C-empty-unrelated-Date-schema-refusal',
  'D-canonical-opaque-complete-copy-controls', 'E-CSV64-row-control', 'E-CSV16-column-control',
  'E-profile-refusal-rows-65.csv', 'E-profile-refusal-fields-17.csv',
  'F-existing-read-fault-no-publication-recovery', 'R-unchanged-private-reader-Date-fixture',
];
const expectedProduction = ['production-sales-edit-save-process-restart-reopen-edit-png'];
const evidenceRoot = path.resolve(process.env.TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR ?? process.env.TACHIKO_PRODUCTION_LIFECYCLE_EVIDENCE_DIR ?? path.join(os.tmpdir(), `tachiko-sheet-146-production-${Date.now()}-${process.pid}`));
const port = Number(process.env.TACHIKO_SAVE_CLOSURE_PRODUCTION_PORT ?? '4197');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const gateDir = path.join(evidenceRoot, 'save-closure');
const lifecycleDir = path.join(evidenceRoot, 'production-lifecycle');
const buildReceiptPath = path.join(evidenceRoot, 'production-build.json');
const childReceipt = path.join(lifecycleDir, 'production-lifecycle.seed.json');
const summary = { status: 'NOT RUN', base, evidenceRoot, expectedCaseIds: expectedProduction, build: 'NOT RUN', lifecycle: 'NOT RUN', candidate: {}, receipt: childReceipt, log: path.join(lifecycleDir, 'production-lifecycle.log') };
await mkdir(evidenceRoot, { recursive: true });
await rm(lifecycleDir, { recursive: true, force: true });
await mkdir(lifecycleDir, { recursive: true });
function run(command, args, env = {}, options = {}) {
  return captureRunnerCommand(command, args, { cwd: root, env, signal: cancellation.signal, ...options });
}
const nulPaths = (value) => value.split('\0').filter(Boolean).sort();
async function candidateIdentity() {
  const headResult = await run('git', ['rev-parse', 'HEAD']);
  if (headResult.code !== 0) throw new Error(`BLOCKED: cannot resolve candidate HEAD: ${headResult.output}`);
  const head = headResult.output.trim();
  const ancestor = await run('git', ['merge-base', '--is-ancestor', base, head]);
  if (ancestor.code !== 0) throw new Error(`BLOCKED: candidate HEAD ${head} is not descended from exact base ${base}`);
  const committed = nulPaths((await run('git', ['diff', '--name-only', '-z', `${base}..${head}`])).output);
  const trackedDirty = nulPaths((await run('git', ['diff', '--name-only', '-z', 'HEAD'])).output);
  const untracked = nulPaths((await run('git', ['ls-files', '--others', '--exclude-standard', '-z'])).output);
  const dirty = [...new Set([...trackedDirty, ...untracked])].sort();
  const committedFiles = [];
  for (const file of committed) {
    const blob = await run('git', ['show', `HEAD:${file}`]);
    if (blob.code !== 0) throw new Error(`BLOCKED: cannot hash committed candidate path ${file}`);
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
async function inventory(directory) {
  const files = [];
  async function walk(relative = '') {
    const entries = await (await import('node:fs/promises')).readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error(`BLOCKED: unsupported production artifact entry ${child}`);
    }
  }
  await walk();
  const sorted = await Promise.all(files.sort().map(async (file) => [file, sha256(await readFile(path.join(directory, file)))]));
  return { files: sorted, digest: sha256(JSON.stringify(sorted)) };
}
async function startServer() {
  return startRunnerServer({
    command: process.execPath,
    args: [path.join(root, 'scripts/serve-dist.mjs'), path.join(root, 'dist')],
    cwd: root,
    env: { PORT: String(port) },
    readyText: `http://127.0.0.1:${port}`,
    startupLogPath: path.join(evidenceRoot, 'production-server-startup.log'),
    serverLogPath: path.join(evidenceRoot, 'production-server.log'),
    signal: cancellation.signal,
  });
}

if (process.argv[2] === '--clear-build-receipt') {
  await rm(buildReceiptPath, { force: true });
  console.log(JSON.stringify({ status: 'PASS', action: 'cleared-production-build-receipt', path: buildReceiptPath }));
  process.exit(0);
}
if (process.argv[2] === '--record-build') {
  const candidate = await candidateIdentity();
  try { await readFile(buildReceiptPath); throw new Error('BLOCKED: clear the prior build receipt before recording a fresh build'); }
  catch (error) { if (error.message.startsWith('BLOCKED:')) throw error; }
  const aggregate = JSON.parse(await readFile(path.join(evidenceRoot, 'summary.json'), 'utf8'));
  if (aggregate.gates?.saveClosure !== 'PASS' || JSON.stringify(aggregate.candidateIdentity) !== JSON.stringify(candidate)) throw new Error('BLOCKED: a matching PASS save-closure aggregate is required before recording the production build');
  const frozenSeedHashes = {
    'tests/product/web-save-closure-current.mjs': '9723a8163a8ac8bb336a4534e4cf92278e32604e6f98d5a87c857e0156379a36',
    'tests/product/web-save-closure-prerequisites.mjs': 'b3e0f9a99b64db9d8bc0caa35e78fc7973f96896bd84f4d77eb5cec08bd9e704',
    'tests/product/production-lifecycle.mjs': 'eb9cb264f1d7e561e506810a5ae4bb1be086102977b3a786d8f9488a452eb77d',
  };
  for (const [file, expected] of Object.entries(frozenSeedHashes)) if (sha256(await readFile(path.join(root, file))) !== expected) throw new Error(`BLOCKED: frozen seed drift: ${file}`);
  if (JSON.stringify(aggregate.acceptanceArtifact) !== JSON.stringify(await inventory(path.join(root, 'dist-acceptance')))) throw new Error('BLOCKED: current acceptance artifact does not match the qualified save-closure build');
  const artifact = await inventory(path.join(root, 'dist'));
  if (!artifact.files.some(([file]) => file === 'index.html') || artifact.files.length === 0) throw new Error('BLOCKED: production dist inventory is absent or incomplete');
  const receipt = { status: 'PASS', builtAt: new Date().toISOString(), base, candidate, frozenSeedHashes, artifact };
  await writeFile(buildReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'PASS', action: 'recorded-fresh-production-build', candidateIdentity: candidate.sha256, artifactManifestSha256: artifact.digest, receipt: buildReceiptPath }));
  process.exit(0);
}
let server;
try {
  summary.candidate = await candidateIdentity();
  const frozen = {
    'tests/product/web-save-closure-current.mjs': '9723a8163a8ac8bb336a4534e4cf92278e32604e6f98d5a87c857e0156379a36',
    'tests/product/web-save-closure-prerequisites.mjs': 'b3e0f9a99b64db9d8bc0caa35e78fc7973f96896bd84f4d77eb5cec08bd9e704',
    'tests/product/production-lifecycle.mjs': 'eb9cb264f1d7e561e506810a5ae4bb1be086102977b3a786d8f9488a452eb77d',
  };
  for (const [file, expected] of Object.entries(frozen)) if (sha256(await readFile(path.join(root, file))) !== expected) throw new Error(`BLOCKED: frozen seed drift: ${file}`);
  const prerequisitePath = path.join(gateDir, 'prerequisites.json');
  const currentPath = path.join(gateDir, 'current-save-closure.json');
  const prerequisites = JSON.parse(await readFile(prerequisitePath, 'utf8'));
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  for (const [name, receipt] of [['prerequisites', prerequisites], ['currentSaveClosure', current]]) {
    if (receipt.status !== 'PASS' || receipt.base !== base || receipt.head !== summary.candidate.head || receipt.candidateIdentity !== summary.candidate.sha256) {
      throw new Error(`BLOCKED: ${name} receipt is not a PASS for this exact candidate identity`);
    }
    if (JSON.stringify(receipt.candidate) !== JSON.stringify(summary.candidate)) throw new Error(`BLOCKED: ${name} candidate HEAD/committed/dirty identity differs from this checkout`);
  }
  const validateEnvelope = async (name, envelope, expectedIds) => {
    const outcomes = envelope.caseOutcomes;
    const ids = outcomes?.map((entry) => entry.id) ?? [];
    if (envelope.expectedCaseIds?.length !== expectedIds.length || JSON.stringify(envelope.expectedCaseIds) !== JSON.stringify(expectedIds)
      || ids.length !== expectedIds.length || new Set(ids).size !== expectedIds.length || JSON.stringify(ids) !== JSON.stringify(expectedIds)
      || outcomes.some((entry) => entry.status !== 'PASS')) throw new Error(`BLOCKED: ${name} receipt has missing, duplicate, reordered, unknown, or non-PASS case outcomes`);
    if (!envelope.seedReceipt || !envelope.seedReceiptSha256) throw new Error(`BLOCKED: ${name} receipt is missing its seed receipt identity`);
    const seedBytes = await readFile(envelope.seedReceipt);
    if (sha256(seedBytes) !== envelope.seedReceiptSha256) throw new Error(`BLOCKED: ${name} seed receipt hash does not match its envelope`);
    const seed = JSON.parse(seedBytes);
    if (seed.status !== 'PASS' || seed.base !== base) throw new Error(`BLOCKED: ${name} raw seed receipt is not a PASS for base ${base}`);
    return { path: envelope.seedReceipt, sha256: envelope.seedReceiptSha256 };
  };
  summary.prerequisiteReceipts = {
    prerequisites: await validateEnvelope('prerequisites', prerequisites, expectedPrerequisites),
    currentSaveClosure: await validateEnvelope('currentSaveClosure', current, expectedCurrent),
  };
  const expectedFrozen = {
    'tests/product/web-save-closure-current.mjs': frozen['tests/product/web-save-closure-current.mjs'],
    'tests/product/web-save-closure-prerequisites.mjs': frozen['tests/product/web-save-closure-prerequisites.mjs'],
    'tests/product/production-lifecycle.mjs': frozen['tests/product/production-lifecycle.mjs'],
  };
  for (const [name, receipt] of [['prerequisites', prerequisites], ['currentSaveClosure', current]]) {
    if (JSON.stringify(receipt.frozenSeedHashes) !== JSON.stringify(expectedFrozen)) throw new Error(`BLOCKED: ${name} receipt frozen-seed hashes do not match`);
  }
  const rawPrerequisites = JSON.parse(await readFile(summary.prerequisiteReceipts.prerequisites.path, 'utf8'));
  const rawCurrent = JSON.parse(await readFile(summary.prerequisiteReceipts.currentSaveClosure.path, 'utf8'));
  if (JSON.stringify(rawPrerequisites.cases) !== JSON.stringify(expectedPrerequisites)
    || JSON.stringify([...(rawPrerequisites.result?.kit ?? []).map((item) => item.id), ...(rawPrerequisites.result?.adapter ?? []).map((item) => item.id)]) !== JSON.stringify(expectedPrerequisites)) {
    throw new Error('BLOCKED: raw prerequisites receipt has a mismatched exact case registry');
  }
  const currentPairs = rawCurrent.results?.map((item) => [item.id, item.result]) ?? [];
  if (JSON.stringify(currentPairs) !== JSON.stringify(expectedCurrent.map((id) => [id, 'PASS']))) throw new Error('BLOCKED: raw current receipt must contain eleven ordered, unique PASS cases');
  const buildReceipt = JSON.parse(await readFile(buildReceiptPath, 'utf8'));
  if (buildReceipt.status !== 'PASS' || buildReceipt.base !== base || JSON.stringify(buildReceipt.candidate) !== JSON.stringify(summary.candidate)
    || JSON.stringify(buildReceipt.frozenSeedHashes) !== JSON.stringify(expectedFrozen)) throw new Error('BLOCKED: missing or stale exact-candidate production build receipt');
  const actualProductionArtifact = await inventory(path.join(root, 'dist'));
  if (JSON.stringify(actualProductionArtifact) !== JSON.stringify(buildReceipt.artifact)) throw new Error('BLOCKED: production dist differs from the freshly recorded build artifact');
  const aggregateBeforeRun = JSON.parse(await readFile(path.join(evidenceRoot, 'summary.json'), 'utf8'));
  if (aggregateBeforeRun.gates?.saveClosure !== 'PASS'
    || JSON.stringify(aggregateBeforeRun.candidateIdentity) !== JSON.stringify(summary.candidate)) throw new Error('BLOCKED: shared aggregate does not contain a passing save-closure receipt for this candidate');
  const actualAcceptanceArtifact = await inventory(path.join(root, 'dist-acceptance'));
  if (JSON.stringify(actualAcceptanceArtifact) !== JSON.stringify(aggregateBeforeRun.acceptanceArtifact)) throw new Error('BLOCKED: acceptance dist differs from the artifact qualified by the save-closure gate');
  summary.build = 'PASS';
  summary.buildEvidence = { path: buildReceiptPath, sha256: sha256(await readFile(buildReceiptPath)), artifact: actualProductionArtifact };
  summary.acceptanceArtifact = actualAcceptanceArtifact;
  server = await startServer();
  await rm(childReceipt, { force: true });
  const result = await run(process.execPath, [path.join(root, 'tests/product/production-lifecycle.mjs')], {
    SAVE_CLOSURE_DIST: path.join(root, 'dist'), SAVE_CLOSURE_ACCEPTANCE_DIST: path.join(root, 'dist-acceptance'),
    SAVE_CLOSURE_ORIGIN: `http://127.0.0.1:${port}`, SAVE_CLOSURE_RECEIPT: childReceipt,
    SAVE_CLOSURE_ARTIFACT_DIR: path.join(lifecycleDir, 'artifacts'),
  }, { timeoutMs: lifecycleChildTimeoutMs });
  summary.command = { outcome: result.outcome, exitCode: result.code, signal: result.signal, error: result.error };
  await writeFile(summary.log, result.output);
  let receipt;
  try { receipt = JSON.parse(await readFile(childReceipt, 'utf8')); } catch {}
  summary.lifecycle = receipt?.status ?? 'BLOCKED';
  if (summary.lifecycle === 'BLOCKED_OR_FAIL') summary.lifecycle = receipt.error?.name === 'AssertionError' && !/^BLOCKED:/i.test(receipt.error.message ?? '') ? 'BEHAVIORAL_RED' : 'BLOCKED';
  if (receipt?.status === 'PASS') {
    const ids = receipt.caseIds ?? [];
    const expectedIds = receipt.expectedCaseIds ?? [];
    if (JSON.stringify(ids) !== JSON.stringify(expectedProduction) || JSON.stringify(expectedIds) !== JSON.stringify(expectedProduction)
      || new Set(ids).size !== expectedProduction.length || receipt.artifacts?.productionManifestSha256 !== receipt.artifacts?.production?.digest
      || receipt.artifacts?.acceptanceManifestSha256 !== receipt.artifacts?.acceptance?.digest) {
      summary.lifecycle = 'BLOCKED';
    }
  }
  summary.caseOutcomes = expectedProduction.map((id) => ({ id, status: summary.lifecycle === 'PASS' && receipt?.caseIds?.includes(id) && receipt?.expectedCaseIds?.includes(id) ? 'PASS' : summary.lifecycle }));
  summary.receiptEvidence = receipt ? { status: receipt.status, caseIds: receipt.caseIds, expectedCaseIds: receipt.expectedCaseIds, caseOutcomes: summary.caseOutcomes, phase: receipt.phase, artifacts: receipt.artifacts, processEvidence: receipt.processEvidence, diagnostics: receipt.diagnostics, error: receipt.error } : { status: 'BLOCKED', reason: result.error ?? 'seed receipt missing or invalid JSON', commandOutcome: result.outcome };
  if (result.outcome !== 'EXITED') {
    summary.lifecycle = 'BLOCKED';
    summary.caseOutcomes = expectedProduction.map((id) => ({ id, status: 'BLOCKED' }));
    summary.receiptEvidence = { ...summary.receiptEvidence, status: 'BLOCKED', reason: result.error ?? result.outcome, commandOutcome: result.outcome };
  }
  if (result.code !== 0 && summary.lifecycle === 'PASS') summary.lifecycle = 'BLOCKED';
  if (summary.lifecycle !== summary.caseOutcomes[0]?.status) summary.caseOutcomes = expectedProduction.map((id) => ({ id, status: summary.lifecycle }));
} catch (error) {
  summary.diagnostics = [{ status: 'BLOCKED', message: error.message, stack: error.stack }];
} finally {
  await finalizeProductionLifecycleServer(server, summary, expectedProduction);
  if (!summary.caseOutcomes) summary.caseOutcomes = expectedProduction.map((id) => ({ id, status: summary.lifecycle === 'NOT RUN' ? 'BLOCKED' : summary.lifecycle }));
  summary.status = cancellation.signal.aborted || summary.diagnostics?.length ? 'BLOCKED' : summary.lifecycle === 'PASS' && summary.build === 'PASS' ? 'PASS' : summary.lifecycle === 'BEHAVIORAL_RED' ? 'BEHAVIORAL_RED' : 'BLOCKED';
  await writeFile(path.join(lifecycleDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  let aggregate;
  try { aggregate = JSON.parse(await readFile(path.join(evidenceRoot, 'summary.json'), 'utf8')); } catch {}
  if (!aggregate) {
    aggregate = { base, evidenceRoot, candidateIdentity: summary.candidate, gates: { saveClosure: 'BLOCKED', productionLifecycle: summary.status }, status: 'BLOCKED', diagnostics: [] };
  }
  if (aggregate.candidateIdentity?.sha256 !== summary.candidate.sha256) {
    aggregate.gates ??= { saveClosure: 'BLOCKED' };
    aggregate.gates.productionLifecycle = 'BLOCKED';
    aggregate.status = 'BLOCKED';
    aggregate.diagnostics ??= [];
    aggregate.diagnostics.push({ status: 'BLOCKED', message: 'production candidate differs from the save-closure aggregate candidate' });
  } else {
    aggregate.gates.productionLifecycle = summary.status;
    aggregate.productionLifecycleReceipt = path.join(lifecycleDir, 'summary.json');
    aggregate.productionArtifacts = summary.receiptEvidence?.artifacts ?? null;
    aggregate.productionCaseOutcomes = summary.caseOutcomes;
    aggregate.productionDiagnostics = summary.diagnostics ?? [];
    const gateStatuses = Object.values(aggregate.gates);
    aggregate.status = gateStatuses.includes('BLOCKED') ? 'BLOCKED'
      : gateStatuses.includes('BEHAVIORAL_RED') ? 'BEHAVIORAL_RED'
        : gateStatuses.every((status) => status === 'PASS') ? 'PASS' : 'NOT RUN';
  }
  await writeFile(path.join(evidenceRoot, 'summary.json'), `${JSON.stringify(aggregate, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (aggregate.status !== 'PASS' || summary.status !== 'PASS') process.exitCode = aggregate.status === 'BEHAVIORAL_RED' ? 1 : 78;
  cancellation.dispose();
}
