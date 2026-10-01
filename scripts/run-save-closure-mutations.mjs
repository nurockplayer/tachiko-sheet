// Serial, disposable #146 mutation qualification. Product faults exist only in
// short-lived Git worktrees and are restored before a clean rerun.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureRunnerCommand, createRunnerCancellation, startRunnerServer } from './runner-process-lifecycle.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = '375d25ea12262bec32e2303b3c63662f0b69322f';
const expectedHead = 'f6121d5bb5990b8cb9004062642aa2937fcfab4f';
const implementationPaths = [
  '.github/workflows/product.yml', 'docs/TEST-WIRING.md',
  'scripts/run-save-closure-mutations.mjs', 'tests/save-closure-mutations.test.mjs',
];
const expectedSeeds = {
  'tests/product/web-save-closure-current.mjs': 'f0da11bca23206789c1ad0d4c2db771febfd37cb8343fd7c1f07c45758cbd3a8',
  'tests/product/web-save-closure-prerequisites.mjs': 'b3e0f9a99b64db9d8bc0caa35e78fc7973f96896bd84f4d77eb5cec08bd9e704',
  'tests/product/production-lifecycle.mjs': 'eb9cb264f1d7e561e506810a5ae4bb1be086102977b3a786d8f9488a452eb77d',
};
const workPin = '518aaa55e046a4e4676b4d5e05d8189c4c6343fe';
const kitManifest = 'ae82d68592b73ac5da4f72fe9242833f2e9ba15e93480fac01d5d7751b86125b';
const currentCases = [
  'A-Date-only-normal-Save-fresh-reopen', 'B-same-table-Date-summary-refusal',
  'C-unrelated-Date-summary-refusal', 'C-empty-unrelated-Date-schema-refusal',
  'D-canonical-opaque-complete-copy-controls', 'E-CSV64-row-control', 'E-CSV16-column-control',
  'E-profile-refusal-rows-65.csv', 'E-profile-refusal-fields-17.csv',
  'F-existing-read-fault-no-publication-recovery', 'R-unchanged-private-reader-Date-fixture',
];
const prerequisiteCases = [
  'KIT-date-only-csv', 'KIT-unrelated-populated-date-xlsx', 'KIT-unrelated-empty-date-schema-xlsx',
  'ADAPTER-stale-witness', 'ADAPTER-stale-bootstrap', 'ADAPTER-stale-table',
  'ADAPTER-unavailable-unrelated-table',
];
const productionCase = 'production-sales-edit-save-process-restart-reopen-edit-png';
const productFiles = ['src/App.tsx', 'src/runtime/session.ts', 'src/ui/SheetShell.tsx', 'src/core-loader.ts'];
const fixtureFiles = [
  'acceptance/web-save-closure/fixtures/date-only.csv',
  'acceptance/web-save-closure/fixtures/unrelated-date.xlsx',
  'acceptance/web-save-closure/fixtures/unrelated-date-empty.xlsx',
  'acceptance/web-save-closure/fixtures/date-only-private.bin',
  'acceptance/web-save-closure/fixtures/date-only-private.json',
];
const immutableFiles = [
  ...Object.keys(expectedSeeds), 'core-kit.lock.json', ...fixtureFiles,
  'src/App.tsx', 'src/runtime/session.ts', 'src/ui/SheetShell.tsx', 'src/core-loader.ts',
];
const mutationCases = [
  {
    id: 'M1', expectedCases: ['A-Date-only-normal-Save-fresh-reopen'],
    assertionPattern: /Save a copy must succeed and close the current Save dialog/,
    patches: [{ path: 'src/App.tsx', before: ': bindingCatalogContainsDate(await runtime.listKeyedGroupedSumBindings(witnessOf(live)));', after: ': false;' }],
  },
  {
    id: 'M2', expectedCases: [
      'B-same-table-Date-summary-refusal', 'C-unrelated-Date-summary-refusal', 'C-empty-unrelated-Date-schema-refusal',
    ],
    assertionPattern: /Date refusal occurs before producer Create dispatch|No current cross-table result is available|rendered Summary has zero existing or missing definition cards|visible source fidelity ledger is unchanged by refusal|whole runtime snapshot remains unchanged/,
    patches: [
      { path: 'src/App.tsx', before: `      if (bindingCatalogContainsDate(catalog)) {\n        setMessage(DATE_SUMMARY_UNSUPPORTED_MESSAGE);\n        setOutcome("idle");\n        return false;\n      }\n      creationStarted = true;`, after: `      if (false && bindingCatalogContainsDate(catalog)) {\n        setMessage(DATE_SUMMARY_UNSUPPORTED_MESSAGE);\n        setOutcome("idle");\n        return false;\n      }\n      creationStarted = true;` },
      { path: 'src/runtime/session.ts', before: `      if (bindingCatalogContainsDate(catalog)) {\n        throw new Error(DATE_SUMMARY_UNSUPPORTED_MESSAGE);\n      }\n      const orders = selectedTable(tables, binding.ordersCollection);`, after: `      if (false && bindingCatalogContainsDate(catalog)) {\n        throw new Error(DATE_SUMMARY_UNSUPPORTED_MESSAGE);\n      }\n      const orders = selectedTable(tables, binding.ordersCollection);` },
    ],
  },
  {
    id: 'M3', expectedCases: ['C-unrelated-Date-summary-refusal'],
    assertionPattern: /Date refusal occurs before producer Create dispatch|No current cross-table result is available|rendered Summary has zero existing or missing definition cards|visible source fidelity ledger is unchanged by refusal|whole runtime snapshot remains unchanged/,
    patches: [
      { path: 'src/App.tsx', before: `      if (bindingCatalogContainsDate(catalog)) {\n        setMessage(DATE_SUMMARY_UNSUPPORTED_MESSAGE);\n        setOutcome("idle");\n        return false;\n      }\n      creationStarted = true;`, after: `      if (bindingCatalogContainsDate({ collections: catalog.collections.filter((collection) => collection.key === binding.ordersCollection || collection.key === binding.productsCollection) })) {\n        setMessage(DATE_SUMMARY_UNSUPPORTED_MESSAGE);\n        setOutcome("idle");\n        return false;\n      }\n      creationStarted = true;` },
      { path: 'src/runtime/session.ts', before: `      if (bindingCatalogContainsDate(catalog)) {\n        throw new Error(DATE_SUMMARY_UNSUPPORTED_MESSAGE);\n      }\n      const orders = selectedTable(tables, binding.ordersCollection);`, after: `      if (bindingCatalogContainsDate({ collections: catalog.collections.filter((collection) => collection.key === binding.ordersCollection || collection.key === binding.productsCollection) })) {\n        throw new Error(DATE_SUMMARY_UNSUPPORTED_MESSAGE);\n      }\n      const orders = selectedTable(tables, binding.ordersCollection);` },
    ],
  },
  {
    id: 'M4', expectedCases: ['C-empty-unrelated-Date-schema-refusal'],
    assertionPattern: /Date refusal occurs before producer Create dispatch|No current cross-table result is available|rendered Summary has zero existing or missing definition cards|visible source fidelity ledger is unchanged by refusal|whole runtime snapshot remains unchanged/,
    patches: [{ path: 'src/runtime/session.ts', before: 'fields: table.columns.map((column) => ({ key: column.key, fieldType: column.field_type })),', after: 'fields: table.columns.filter((column) => table.rows.length > 0 || column.field_type !== "date").map((column) => ({ key: column.key, fieldType: column.field_type })),' }],
  },
  {
    id: 'M5a', expectedCases: ['A-Date-only-normal-Save-fresh-reopen'],
    assertionPattern: /Date edit must reach real producer editDate exactly once/,
    patches: [{ path: 'src/ui/SheetShell.tsx', before: 'column_types: importTypes as ImportSelection["column_types"],', after: 'column_types: importTypes.map((types) => types.map((type) => type === "date" ? "text" : type)) as ImportSelection["column_types"],' }],
  },
  {
    id: 'M5b', expectedCases: ['A-Date-only-normal-Save-fresh-reopen'],
    assertionPattern: /7be5f6fad559bc4f70acab457bb34ee82161b47c30767343cc317e96663440e5/,
    patches: [{ path: 'src/App.tsx', before: `        receipt = await copies.createOpaque(name, {\n          ...snapshot,\n          importedSource: importedSourceRef.current ?? undefined,\n          presentation,`, after: `        receipt = await copies.createOpaque(name, {\n          ...snapshot,\n          importedSource: hasDateColumn ? undefined : (importedSourceRef.current ?? undefined),\n          presentation,` }],
  },
  {
    id: 'M6', expectedCases: [],
    patches: [{ path: 'src/core-loader.ts', before: '  const entry = PUBLIC_CLIENT_ENTRY;', after: '  if (import.meta.env.MODE === "production") throw new Error("M6 production kit loader mutant: rejected by design.");\n  const entry = PUBLIC_CLIENT_ENTRY;' }],
  },
];

const bytesHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonHash = (value) => bytesHash(Buffer.from(JSON.stringify(value)));
const nowIso = () => new Date().toISOString();
const safeName = (value) => value.replace(/[^A-Za-z0-9._-]+/g, '-');
const currentSeedPath = (dir) => path.join(dir, 'save-closure', 'current-save-closure.seed.json');

export function classifySaveTerminalObservation(status, saveDialogOpen) {
  if (status === 'Save failed') return 'SAVE_FAILED';
  if (status === 'Saved on this device' && saveDialogOpen === false) return 'SAVED';
  return 'PENDING';
}

export function classifyMutationReceipt(receipt, mutation) {
  if (!receipt || receipt.status !== 'BEHAVIORAL_RED' || !Array.isArray(receipt.results)) {
    return { status: 'BLOCKED', reason: 'Current seed did not produce an attributable behavioral-red receipt.' };
  }
  if (JSON.stringify(receipt.results.map((item) => item.id)) !== JSON.stringify(currentCases)) {
    return { status: 'BLOCKED', reason: 'Current seed case registry is missing, duplicated, reordered, or unexpected.' };
  }
  const targeted = mutation.expectedCases.map((id) => receipt.results.find((item) => item.id === id));
  if (targeted.some((item) => !item)) return { status: 'BLOCKED', reason: 'A mutation-owned oracle row is absent.' };
  if (mutation.id === 'M1' && targeted.some((item) => item.observed?.save?.trim() !== 'Save failed')) {
    return { status: 'BLOCKED', reason: 'M1 did not observe the actual Save failed terminal state before the explicit Saved assertion.' };
  }
  const unrelatedBlocked = receipt.results.some((item) => item.result === 'BLOCKED');
  if (unrelatedBlocked) return { status: 'BLOCKED', reason: 'At least one current case was blocked; setup or transport failure earns no mutation credit.' };
  if (targeted.some((item) => item.result !== 'BEHAVIORAL_RED' || !mutation.assertionPattern.test(item.message ?? ''))) {
    return { status: 'BLOCKED', reason: `Expected assertion(s) were not the source of RED for ${mutation.id}.` };
  }
  return { status: 'BEHAVIORAL_RED', assertionMessages: targeted.map((item) => ({ id: item.id, message: item.message })) };
}

export function classifyM6OpenProof(proof) {
  const qualified = proof?.httpIndexStatus === 200 && proof?.productionAssetStatus === 200
    && proof?.browserNavigationStatus === 200
    && proof?.cdpReady === true && typeof proof?.browserVersion === 'string' && proof.browserVersion.length > 0
    && proof?.coldHomeReady === true && proof?.openClicked === true
    && /^[a-f0-9]{64}$/.test(proof?.mutantCandidateIdentity ?? '')
    && /^[a-f0-9]{64}$/.test(proof?.mutationPatchSha256 ?? '')
    && /^[a-f0-9]{64}$/.test(proof?.mutatedLoaderSha256 ?? '');
  if (!qualified) return { status: 'BLOCKED', reason: 'HTTP/browser/CDP/Home/Open preconditions did not all qualify.' };
  if (proof.openOutcome === 'ready') return { status: 'BLOCKED', reason: 'M6 production loader mutant survived the normal Open assertion.', mutantSurvived: true };
  if (proof.openOutcome !== 'refused' || !proof.alertText?.includes('Couldn’t open the sales example.')) {
    return { status: 'BLOCKED', reason: 'The normal Open refusal alert was not observed after the exact M6 mutant and production preconditions qualified.' };
  }
  return { status: 'BEHAVIORAL_RED', assertion: 'normal production Home Open must reach project-ready after HTTP and CDP qualify', alertText: proof.alertText };
}

function rootEvidence() {
  return path.resolve(process.env.TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR ?? path.join(os.tmpdir(), `tachiko-sheet-146-mutations-${process.pid}`));
}

function readJson(file) { return readFile(file, 'utf8').then((text) => JSON.parse(text)); }

async function pathHash(file) { return bytesHash(await readFile(file)); }

async function hashSnapshot(cwd) {
  const out = {};
  for (const file of immutableFiles) out[file] = await pathHash(path.join(cwd, file));
  return out;
}

async function git(commandArgs, options = {}) {
  return captureRunnerCommand('git', commandArgs, {
    cwd: options.cwd ?? root,
    timeoutMs: options.timeoutMs ?? 20_000,
    maxOutputBytes: 64 * 1024,
    signal: options.signal,
  });
}

function serializeCommand(label, command, args, cwd, started, result, logFile) {
  return {
    label, command, args, cwd, startedAt: started, completedAt: nowIso(),
    durationMs: Date.now() - Date.parse(started), outcome: result.outcome,
    exitCode: result.code, signal: result.signal, error: result.error ?? null,
    log: logFile, logSha256: bytesHash(result.bytes),
  };
}

async function commandRunner(ctx, label, command, args, cwd, evidenceDir, options = {}) {
  const remaining = ctx.remainingMs();
  const reserve = options.reserveMs ?? 90_000;
  const timeoutMs = Math.min(options.timeoutMs ?? 180_000, remaining - reserve);
  if (timeoutMs < (options.minimumMs ?? 10_000)) {
    return { result: { code: 124, signal: null, outcome: 'SOFT_STOP', error: 'insufficient job budget; reserved time for restore, receipt write and artifact upload', bytes: Buffer.alloc(0), output: '' }, command: null };
  }
  const logName = `${String(ctx.commandCounter++).padStart(2, '0')}-${safeName(label)}.log`;
  const logPath = path.join(evidenceDir, 'commands', logName);
  await mkdir(path.dirname(logPath), { recursive: true });
  const started = nowIso();
  const result = await captureRunnerCommand(command, args, {
    cwd,
    env: { TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR: process.env.TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR, ...(options.env ?? {}) },
    timeoutMs,
    maxOutputBytes: 128 * 1024,
    signal: ctx.cancellation.signal,
  });
  await writeFile(logPath, result.bytes);
  const relLog = path.relative(rootEvidence(), logPath).split(path.sep).join('/');
  const commandReceipt = serializeCommand(label, command, args, cwd, started, result, relLog);
  ctx.commands.push(commandReceipt);
  await writeFile(path.join(rootEvidence(), 'mutations', 'commands.json'), `${JSON.stringify(ctx.commands, null, 2)}\n`);
  return { result, command: commandReceipt };
}

async function writeSummary(ctx) {
  ctx.summary.updatedAt = nowIso();
  await mkdir(path.join(rootEvidence(), 'mutations'), { recursive: true });
  const target = path.join(rootEvidence(), 'mutations', 'mutation-summary.json');
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ctx.summary, null, 2)}\n`);
  await rm(target, { force: true });
  await (await import('node:fs/promises')).rename(temporary, target);
}

async function captureCandidateIdentity(cwd) {
  const headRun = await git(['rev-parse', 'HEAD'], { cwd });
  if (headRun.code !== 0) throw new Error(`cannot resolve candidate HEAD: ${headRun.output}`);
  const head = headRun.output.trim();
  const baseRun = await git(['merge-base', '--is-ancestor', base, head], { cwd });
  if (baseRun.code !== 0) throw new Error(`candidate HEAD ${head} is not descended from base ${base}`);
  const dirtyRun = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd });
  if (dirtyRun.code !== 0) throw new Error(`cannot enumerate candidate working tree: ${dirtyRun.output}`);
  const dirtyPaths = [...new Set(dirtyRun.output.split('\0').filter(Boolean).map((row) => row.slice(3)))].sort();
  const dirtyFiles = [];
  for (const file of dirtyPaths) {
    const bytes = await readFile(path.join(cwd, file)).catch(() => null);
    dirtyFiles.push([file, bytes ? bytesHash(bytes) : 'DELETED']);
  }
  const committedRun = await git(['diff', '--name-only', `${base}..${head}`], { cwd });
  if (committedRun.code !== 0) throw new Error(`cannot enumerate candidate committed paths: ${committedRun.output}`);
  const committedFiles = [];
  for (const file of committedRun.output.split(/\r?\n/).filter(Boolean).sort()) {
    const blob = await git(['show', `${head}:${file}`], { cwd });
    if (blob.code !== 0) throw new Error(`cannot read committed path ${file}`);
    committedFiles.push([file, bytesHash(blob.bytes)]);
  }
  const identity = { base, head, committedFiles, dirtyFiles };
  return { ...identity, sha256: jsonHash(identity) };
}

async function validateAuthorizedCandidate(cwd, head) {
  const requested = process.env.TACHIKO_MUTATION_PR_HEAD;
  if (requested) {
    const anchor = await git(['merge-base', '--is-ancestor', expectedHead, requested], { cwd });
    if (anchor.code !== 0) throw new Error(`workflow PR head ${requested} is not based on the authorized clean candidate ${expectedHead}`);
    const delta = await git(['diff', '--name-only', `${expectedHead}..${requested}`], { cwd });
    if (delta.code !== 0) throw new Error(`cannot enumerate the implementation delta from the authorized candidate: ${delta.output}`);
    const paths = delta.output.split(/\r?\n/).filter(Boolean).sort();
    if (JSON.stringify(paths) !== JSON.stringify(implementationPaths)) {
      throw new Error(`PR head delta from authorized candidate must contain exactly the four admitted implementation paths; got ${paths.join(', ')}`);
    }
    if (head !== requested) {
      const parents = await git(['rev-list', '--parents', '-n', '1', head], { cwd });
      const [, first, second, ...extra] = parents.output.trim().split(/\s+/);
      if (parents.code !== 0 || first !== base || second !== requested || extra.length) {
        throw new Error(`workflow checkout ${head} is not the expected merge of base ${base} and authorized PR head ${requested}`);
      }
    }
    return { anchorHead: expectedHead, pullRequestHead: requested, checkoutHead: head, implementationPaths: paths };
  }
  if (head !== expectedHead) throw new Error(`mutation script requires exact candidate ${expectedHead}; got ${head}`);
  return { pullRequestHead: expectedHead, checkoutHead: head };
}

async function applyPatchSet(worktree, definition, preimages) {
  for (const patch of definition.patches) {
    const fileBytes = preimages.get(patch.path);
    if (!fileBytes) throw new Error(`mutation ${definition.id} has no frozen preimage for ${patch.path}`);
    const original = fileBytes.toString('utf8');
    const hits = original.split(patch.before).length - 1;
    if (hits !== 1) throw new Error(`mutation ${definition.id} preimage matched ${hits} times in ${patch.path}; expected exactly one`);
    await writeFile(path.join(worktree, patch.path), original.replace(patch.before, patch.after));
  }
}

async function exactChangedPaths(worktree) {
  const result = await git(['diff', '--name-only'], { cwd: worktree });
  if (result.code !== 0) throw new Error(`cannot enumerate mutated source files: ${result.output}`);
  return result.output.split(/\r?\n/).filter(Boolean).sort();
}

async function archiveFileEvidence(worktree, definition, evidenceDir, preimages) {
  const beforeDir = path.join(evidenceDir, 'preimages');
  await mkdir(beforeDir, { recursive: true });
  const preimageManifest = {};
  for (const [file, bytes] of preimages) {
    const dest = path.join(beforeDir, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    preimageManifest[file] = bytesHash(bytes);
  }
  await writeFile(path.join(evidenceDir, 'preimages.json'), `${JSON.stringify(preimageManifest, null, 2)}\n`);
  const diff = await git(['diff', '--binary', '--', ...[...new Set(definition.patches.map((patch) => patch.path))]], { cwd: worktree });
  if (diff.code !== 0 || !diff.output) throw new Error(`mutation ${definition.id} did not produce its expected raw patch: ${diff.output}`);
  const rawPatch = Buffer.from(diff.output);
  await writeFile(path.join(evidenceDir, 'mutation.patch'), rawPatch);
  return {
    changedPaths: await exactChangedPaths(worktree),
    patchSha256: bytesHash(rawPatch),
    patch: path.relative(rootEvidence(), path.join(evidenceDir, 'mutation.patch')).split(path.sep).join('/'),
    preimages: preimageManifest,
  };
}

async function readCleanGate(evidenceDir) {
  const summary = await readJson(path.join(evidenceDir, 'summary.json'));
  const save = summary.gates?.saveClosure ?? summary.gate?.status;
  const prod = summary.gates?.productionLifecycle ?? 'NOT RUN';
  const candidate = summary.candidateIdentity ?? summary.identity?.candidate;
  return { summary, save, prod, candidate };
}

function requireCleanAcceptance(summary, expectedCandidate, expectedHead) {
  if ((summary.gates?.saveClosure ?? summary.gate?.status) !== 'PASS') {
    return { status: 'BLOCKED', reason: 'Restored clean save-closure gate did not PASS.' };
  }
  const candidate = summary.candidateIdentity ?? summary.identity?.candidate;
  if (!candidate || candidate.head !== expectedHead || candidate.sha256 !== expectedCandidate.sha256) {
    return { status: 'BLOCKED', reason: 'Restored clean gate candidate identity differs from the original clean candidate.' };
  }
  const all = [...(summary.caseOutcomes ?? [])];
  const prerequisites = all.filter((entry) => entry.id?.startsWith('KIT-') || entry.id?.startsWith('ADAPTER-'));
  const current = all.filter((entry) => currentCases.includes(entry.id));
  if (prerequisites.length !== prerequisiteCases.length || prerequisites.some((entry) => entry.status !== 'PASS')
    || current.length !== currentCases.length || current.some((entry) => entry.status !== 'PASS')) {
    return { status: 'BLOCKED', reason: 'Restored clean gate did not prove all seven prerequisites and eleven current cases.' };
  }
  return { status: 'PASS', candidateIdentity: candidate.sha256, prerequisites: '7/7 PASS', current: '11/11 PASS' };
}

async function verifyBaselineInvariants(worktree, baselineHashes, stage) {
  const mismatches = [];
  for (const [file, expected] of Object.entries(baselineHashes)) {
    const actual = await pathHash(path.join(worktree, file)).catch(() => 'MISSING');
    if (actual !== expected) mismatches.push({ file, expected, actual });
  }
  if (mismatches.length) return { status: 'BLOCKED', stage, mismatches };
  const changed = await exactChangedPaths(worktree);
  if (changed.length) return { status: 'BLOCKED', stage, changedPathsAfterRestore: changed };
  return { status: 'PASS', stage, verifiedFiles: Object.keys(baselineHashes) };
}

async function createWorktree(ctx, definition, evidenceDir) {
  const tempBase = await mkdtemp(path.join(os.tmpdir(), 'tachiko-sheet-146-mutation-'));
  const worktree = path.join(tempBase, definition.id);
  const result = await commandRunner(ctx, `${definition.id}-create-worktree`, 'git', ['worktree', 'add', '--detach', worktree, ctx.candidate.head], root, evidenceDir, { timeoutMs: 20_000, minimumMs: 2_000 });
  if (result.result.code !== 0) throw new Error(`could not create disposable worktree: ${result.result.error ?? result.result.output}`);
  try {
    const depPath = path.join(root, 'node_modules');
    const depStat = await (await import('node:fs/promises')).stat(depPath).catch(() => null);
    if (!depStat) throw new Error('pinned dependencies are unavailable: root node_modules is absent');
    await symlink(depPath, path.join(worktree, 'node_modules'), 'dir');
  } catch (error) {
    await git(['worktree', 'remove', '--force', worktree], { cwd: root, timeoutMs: 30_000 }).catch(() => {});
    await rm(tempBase, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  ctx.worktree = worktree;
  ctx.worktreeTempRoot = tempBase;
  return worktree;
}

async function removeWorktree(ctx, worktree, evidenceDir, definitionId) {
  if (!worktree) return { status: 'PASS', skipped: true };
  let result;
  let loggingFailure = null;
  try {
    result = await commandRunner(ctx, `${definitionId}-remove-worktree`, 'git', ['worktree', 'remove', '--force', worktree], root, evidenceDir, { timeoutMs: 30_000, minimumMs: 2_000, reserveMs: 45_000 });
  } catch (error) {
    loggingFailure = error.message;
    result = await git(['worktree', 'remove', '--force', worktree], { cwd: root, timeoutMs: 30_000 }).then((fallback) => ({ result: fallback })).catch((fallbackError) => ({ result: { code: 127, outcome: 'SPAWN_ERROR', error: fallbackError.message } }));
  }
  const removeStatus = result.result.code === 0 && !loggingFailure ? 'PASS' : 'BLOCKED';
  if (result.result.code === 0) {
    await rm(ctx.worktreeTempRoot, { recursive: true, force: true }).catch(() => {});
    ctx.worktree = null;
    ctx.worktreeTempRoot = null;
  }
  return { status: removeStatus, exitCode: result.result.code, outcome: result.result.outcome ?? 'EXITED', error: loggingFailure ?? result.result.error ?? null,
    pathRetainedForInspection: result.result.code !== 0 };
}

async function copyRawEvidence(source, destination) {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true, errorOnExist: false });
}

async function runAcceptance(ctx, worktree, evidenceDir, label) {
  const outputDir = path.join(evidenceDir, label);
  await mkdir(outputDir, { recursive: true });
  const run = await commandRunner(ctx, `${label}-pnpm-acceptance-save-closure`, 'pnpm', ['acceptance:save-closure'], worktree, outputDir, {
    timeoutMs: 180_000, minimumMs: 45_000, env: { TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR: outputDir },
  });
  let summary;
  try { summary = await readJson(path.join(outputDir, 'summary.json')); }
  catch (error) { return { status: 'BLOCKED', reason: `save-closure summary missing: ${error.message}`, command: run.command, outputDir }; }
  return { status: summary.gates?.saveClosure ?? summary.gate?.status ?? 'BLOCKED', command: run.command, outputDir, summary, commandOutcome: run.result.outcome, exitCode: run.result.code };
}

async function inspectMutationGate(run, mutation) {
  let seed;
  try { seed = await readJson(currentSeedPath(run.outputDir)); }
  catch (error) { return { status: 'BLOCKED', reason: `raw current seed receipt missing: ${error.message}` }; }
  const commandResult = { outcome: run.commandOutcome, code: run.exitCode };
  if (commandResult.outcome !== 'EXITED') return { status: 'BLOCKED', reason: `seed command outcome ${commandResult.outcome} is not behavioral evidence` };
  return classifyMutationReceipt(seed, mutation);
}

async function writeMutationJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForEitherOpenOutcome(page, timeoutMs) {
  try {
    const handle = await page.waitForFunction(() => {
      if (document.querySelector('[data-testid="project-ready"][aria-busy="false"]')) return 'ready';
      if (document.querySelector('.ts-home-example-error[role="alert"]')) return 'refused';
      return false;
    }, null, { timeout: timeoutMs });
    return await handle.jsonValue();
  } catch (error) {
    if (/Timeout/.test(error.name ?? '') || /Timeout/.test(error.message ?? '')) return 'timeout';
    throw error;
  }
}

async function runM6ProductionBootProbe(ctx, worktree, evidenceDir, mutationIdentity) {
  await mkdir(evidenceDir, { recursive: true });
  const proof = {
    status: 'BLOCKED', startedAt: nowIso(), httpIndexStatus: null, productionAssetStatus: null,
    cdpReady: false, browserVersion: null, coldHomeReady: false, openClicked: false,
    mutantCandidateIdentity: mutationIdentity.candidateSha256, mutationPatchSha256: mutationIdentity.patchSha256,
    mutatedLoaderSha256: mutationIdentity.loaderSha256,
    openOutcome: 'NOT RUN', alertText: null, diagnostics: { pageErrors: [], consoleErrors: [], requestFailures: [], responses: [] },
  };
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') {
    proof.reason = 'M6 production CDP probe runs only on the approved hosted Ubuntu locked-Playwright job.';
    return proof;
  }
  const { chromium } = await import('playwright-core');
  const playwrightVersion = JSON.parse(await readFile(path.join(worktree, 'node_modules/playwright-core/package.json'), 'utf8')).version;
  if (playwrightVersion !== '1.62.1') {
    proof.reason = `locked Playwright version mismatch: ${playwrightVersion}`;
    proof.playwrightVersion = playwrightVersion;
    return proof;
  }
  proof.playwrightVersion = playwrightVersion;
  const serverPort = await freePort();
  const browserPort = await freePort();
  const profile = await mkdtemp(path.join(os.tmpdir(), 'tachiko-sheet-146-m6-profile-'));
  let staticServer;
  let browserProcess;
  let browser;
  let stopErrors = [];
  try {
    staticServer = await startRunnerServer({
      name: 'm6-production-http', command: process.execPath,
      args: [path.join(worktree, 'scripts/serve-dist.mjs'), path.join(worktree, 'dist')],
      cwd: worktree, env: { PORT: String(serverPort) }, readyText: 'Sheet product server:', signal: ctx.cancellation.signal,
      startupTimeoutMs: 15_000, maxOutputBytes: 64 * 1024,
      startupLogPath: path.join(evidenceDir, 'm6-http-startup.log'), serverLogPath: path.join(evidenceDir, 'm6-http-server.log'),
    });
    ctx.serverPids.push({ role: 'production-http', pid: staticServer.child?.pid ?? null });
    browserProcess = await startRunnerServer({
      name: 'm6-managed-chromium-cdp', command: chromium.executablePath(),
      args: [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
        '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${browserPort}`,
        `--user-data-dir=${profile}`, 'about:blank',
      ],
      cwd: worktree, env: {}, readyText: 'DevTools listening on ws://', signal: ctx.cancellation.signal,
      startupTimeoutMs: 20_000, maxOutputBytes: 64 * 1024,
      startupLogPath: path.join(evidenceDir, 'm6-chromium-startup.log'), serverLogPath: path.join(evidenceDir, 'm6-chromium-server.log'),
    });
    ctx.serverPids.push({ role: 'managed-chromium', pid: browserProcess.child?.pid ?? null });
    const versionResponse = await fetch(`http://127.0.0.1:${browserPort}/json/version`);
    if (!versionResponse.ok) throw new Error(`BLOCKED: Chrome DevTools HTTP endpoint returned ${versionResponse.status}`);
    const cdpVersion = await versionResponse.json();
    proof.cdpReady = true;
    proof.cdpProtocolVersion = cdpVersion['Protocol-Version'] ?? null;
    proof.browserVersion = cdpVersion.Browser ?? null;
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`, { timeout: 10_000 });
    const origin = `http://127.0.0.1:${serverPort}`;
    const index = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5000) });
    proof.httpIndexStatus = index.status;
    const html = await index.text();
    const entryPath = html.match(/<script[^>]+src=["']([^"']+\.js)["']/i)?.[1];
    proof.productionEntryAssetPath = entryPath ?? null;
    if (index.status !== 200 || !entryPath) throw new Error('BLOCKED: independent production HTTP index/entry discovery did not qualify.');
    const entryUrl = new URL(entryPath, origin);
    if (entryUrl.origin !== origin) throw new Error('BLOCKED: production entry asset escaped the same-origin boundary.');
    const assetResponse = await fetch(entryUrl, { signal: AbortSignal.timeout(5000) });
    proof.productionAssetStatus = assetResponse.status;
    if (assetResponse.status !== 200) throw new Error(`BLOCKED: production JavaScript entry returned HTTP ${assetResponse.status}.`);
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = context.pages()[0] ?? await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    page.on('pageerror', (error) => proof.diagnostics.pageErrors.push({ message: error.message }));
    page.on('console', (message) => { if (message.type() === 'error') proof.diagnostics.consoleErrors.push({ message: message.text() }); });
    page.on('requestfailed', (request) => proof.diagnostics.requestFailures.push({ url: request.url(), error: request.failure()?.errorText ?? null }));
    page.on('response', async (response) => {
      const url = new URL(response.url());
      if (url.origin !== `http://127.0.0.1:${serverPort}`) return;
      proof.diagnostics.responses.push({ path: url.pathname, status: response.status() });
      if (url.pathname === '/index.html') proof.httpIndexStatus = response.status();
      if (/^\/assets\/index-.*\.js$/.test(url.pathname)) proof.productionAssetStatus = response.status();
    });
    const response = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    proof.browserNavigationStatus = response?.status() ?? null;
    await page.getByRole('heading', { name: 'Tachiko Sheet', exact: true }).waitFor({ state: 'visible', timeout: 5000 });
    const open = page.getByRole('button', { name: 'Open sales example', exact: true });
    await open.waitFor({ state: 'visible', timeout: 5000 });
    proof.coldHomeReady = true;
    await open.click();
    proof.openClicked = true;
    proof.openOutcome = await waitForEitherOpenOutcome(page, 10_000);
    if (proof.openOutcome === 'refused') {
      proof.alertText = await page.locator('.ts-home-example-error[role="alert"]').innerText();
    }
    const classified = classifyM6OpenProof(proof);
    proof.status = classified.status;
    proof.classification = classified;
    if (proof.status === 'BEHAVIORAL_RED') {
      try { assert.equal(proof.openOutcome, 'ready', classified.assertion); }
      catch (error) { proof.assertion = { name: error.name, code: error.code ?? null, message: error.message, stack: error.stack }; }
    }
    if (proof.openOutcome === 'timeout') proof.reason = 'normal production Open did not reach ready or the explicit refusal alert before its observation deadline';
  } catch (error) {
    proof.status = 'BLOCKED';
    proof.reason = error.message;
    proof.error = { name: error.name, code: error.code ?? null, message: error.message, stack: error.stack };
  } finally {
    try { await browser?.close(); } catch (error) { stopErrors.push({ role: 'cdp-client', message: error.message }); }
    proof.ownedProcesses = [];
    for (const [role, server] of [['managed-chromium', browserProcess], ['production-http', staticServer]]) {
      if (!server) continue;
      try { await server.stop(); } catch (error) { stopErrors.push({ role, message: error.message }); }
      let exit = null;
      try { exit = await server.exit; } catch (error) { stopErrors.push({ role: `${role}-exit`, message: error.message }); }
      proof.ownedProcesses.push({ role, pid: server.child?.pid ?? null, command: role === 'managed-chromium' ? chromium.executablePath() : process.execPath,
        args: role === 'managed-chromium' ? ['--headless=new', '--no-sandbox', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${browserPort}`, `--user-data-dir=${profile}`, 'about:blank'] : [path.join(worktree, 'scripts/serve-dist.mjs'), path.join(worktree, 'dist')],
        exit: exit ? { code: exit.code, signal: exit.signal, outcome: exit.outcome ?? null } : null,
        log: role === 'managed-chromium' ? 'm6-chromium-server.log' : 'm6-http-server.log' });
    }
    await rm(profile, { recursive: true, force: true }).catch((error) => stopErrors.push({ role: 'profile-cleanup', message: error.message }));
  }
  proof.completedAt = nowIso();
  proof.stopErrors = stopErrors;
  if (stopErrors.length) proof.status = 'BLOCKED';
  await writeMutationJson(path.join(evidenceDir, 'm6-production-open-proof.json'), proof);
  return proof;
}

async function runBuildAndCleanProduction(ctx, worktree, evidenceDir, label) {
  const candidateBeforeBuild = await captureCandidateIdentity(worktree);
  const env = { TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR: evidenceDir };
  const clear = await commandRunner(ctx, `${label}-clear-build-receipt`, process.execPath, [path.join(worktree, 'scripts/run-production-lifecycle.mjs'), '--clear-build-receipt'], worktree, evidenceDir, { timeoutMs: 30_000, minimumMs: 3_000, env });
  if (clear.result.code !== 0) return { status: 'BLOCKED', step: 'clear-build-receipt', command: clear.command };
  const build = await commandRunner(ctx, `${label}-pnpm-build`, 'pnpm', ['build'], worktree, evidenceDir, { timeoutMs: 180_000, minimumMs: 30_000, env });
  if (build.result.code !== 0) return { status: 'BLOCKED', step: 'pnpm build', command: build.command };
  const record = await commandRunner(ctx, `${label}-record-build`, process.execPath, [path.join(worktree, 'scripts/run-production-lifecycle.mjs'), '--record-build'], worktree, evidenceDir, { timeoutMs: 30_000, minimumMs: 5_000, env });
  if (record.result.code !== 0) return { status: 'BLOCKED', step: 'record production build', command: record.command };
  const receipt = await readJson(path.join(evidenceDir, 'production-build.json')).catch(() => null);
  const candidateAfterBuild = await captureCandidateIdentity(worktree);
  if (receipt?.status !== 'PASS' || receipt.candidate?.sha256 !== candidateBeforeBuild.sha256
    || candidateAfterBuild.sha256 !== candidateBeforeBuild.sha256) {
    return { status: 'BLOCKED', step: 'production build candidate binding', candidateBefore: candidateBeforeBuild.sha256,
      candidateReceipt: receipt?.candidate?.sha256 ?? null, candidateAfter: candidateAfterBuild.sha256 };
  }
  return { status: 'PASS', clear: clear.command, build: build.command, record: record.command,
    receipt: path.relative(rootEvidence(), path.join(evidenceDir, 'production-build.json')).split(path.sep).join('/'),
    candidateIdentity: candidateBeforeBuild.sha256, artifactManifestSha256: receipt.artifact?.digest ?? null };
}

async function runCleanProductionGate(ctx, worktree, evidenceDir, label, expectedCandidateSha) {
  const build = await runBuildAndCleanProduction(ctx, worktree, evidenceDir, label);
  if (build.status !== 'PASS') return build;
  const gate = await commandRunner(ctx, `${label}-pnpm-acceptance-production-lifecycle`, 'pnpm', ['acceptance:production-lifecycle'], worktree, evidenceDir, {
    timeoutMs: 180_000, minimumMs: 45_000, env: { TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR: evidenceDir },
  });
  const summary = await readJson(path.join(evidenceDir, 'summary.json')).catch(() => null);
  const candidate = summary?.candidateIdentity ?? summary?.identity?.candidate;
  if (gate.result.code !== 0 || summary?.gates?.productionLifecycle !== 'PASS' || candidate?.sha256 !== expectedCandidateSha) {
    return { status: 'BLOCKED', step: 'clean production lifecycle', gate: gate.command, summaryStatus: summary?.status ?? 'MISSING' };
  }
  return { status: 'PASS', build, gate: gate.command, candidateIdentity: candidate.sha256, caseId: productionCase };
}

async function clearGeneratedEvidence(evidencePath, archivePath) {
  const entries = await readdir(evidencePath, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (!names.length) throw new Error('M6 old-gate evidence archive was unexpectedly empty.');
  await copyRawEvidence(evidencePath, archivePath);
  for (const name of names) await rm(path.join(evidencePath, name), { recursive: true, force: true });
  const remaining = await readdir(evidencePath);
  return { archived: true, archivedPaths: names, archivePath, clearedOnlyGeneratedEvidence: remaining.length === 0, remainingPaths: remaining };
}

async function runOneMutation(ctx, definition, baselineHashes, cleanCandidate) {
  const evidenceDir = path.join(rootEvidence(), 'mutations', definition.id);
  await mkdir(evidenceDir, { recursive: true });
  const record = { id: definition.id, startedAt: nowIso(), status: 'NOT RUN', workspace: null, fault: null, oldGate: null, cleanAfterRestore: null, diagnostics: [] };
  ctx.summary.mutations.push(record);
  await writeSummary(ctx);
  let worktree = null;
  let preimages = new Map();
  let mutated = false;
  try {
    worktree = await createWorktree(ctx, definition, evidenceDir);
    record.workspace = worktree;
    record.candidateBeforeMutation = await captureCandidateIdentity(worktree);
    if (record.candidateBeforeMutation.head !== cleanCandidate.head) throw new Error('disposable mutation worktree HEAD differs from the qualified candidate');
    for (const file of new Set(definition.patches.map((patch) => patch.path))) preimages.set(file, await readFile(path.join(worktree, file)));
    const expectedChanged = [...new Set(definition.patches.map((patch) => patch.path))].sort();
    await applyPatchSet(worktree, definition, preimages);
    mutated = true;
    record.fault = await archiveFileEvidence(worktree, definition, evidenceDir, preimages);
    if (JSON.stringify(record.fault.changedPaths) !== JSON.stringify(expectedChanged)) throw new Error(`mutant changed paths differ from its fixed patch: ${record.fault.changedPaths.join(', ')}`);
    const actualChanged = await exactChangedPaths(worktree);
    if (JSON.stringify(actualChanged) !== JSON.stringify(expectedChanged)) throw new Error(`mutant changed paths differ after patch application: ${actualChanged.join(', ')}`);
    record.mutantIdentity = await captureCandidateIdentity(worktree);
    record.fault.sourceHashesAfterPatch = Object.fromEntries(await Promise.all(expectedChanged.map(async (file) => [file, await pathHash(path.join(worktree, file))])));
    await writeSummary(ctx);

    if (definition.id === 'M6') {
      const oldEvidence = path.join(evidenceDir, 'old-gate-generated');
      const old = await runAcceptance(ctx, worktree, evidenceDir, 'm6-gate');
      const oldCandidate = old.summary?.identity?.candidate;
      const oldSeed = await readJson(currentSeedPath(old.outputDir)).catch(() => null);
      record.oldGate = {
        status: old.status === 'PASS' && old.commandOutcome === 'EXITED' && old.exitCode === 0 ? 'PASS' : 'BLOCKED',
        command: old.command, candidateIdentity: oldCandidate?.sha256 ?? null,
        caseCounts: { prerequisites: old.summary?.caseOutcomes?.filter((item) => prerequisiteCases.includes(item.id) && item.status === 'PASS').length ?? 0,
          current: old.summary?.caseOutcomes?.filter((item) => currentCases.includes(item.id) && item.status === 'PASS').length ?? 0 },
        rawReceiptPaths: oldSeed ? ['prerequisites.seed.json', 'current-save-closure.seed.json'] : [],
      };
      if (record.oldGate.status !== 'PASS' || oldCandidate?.sha256 !== record.mutantIdentity.sha256) throw new Error('M6 unchanged old acceptance gate was not GREEN on the same mutant identity.');
      const archived = await clearGeneratedEvidence(old.outputDir, path.join(evidenceDir, 'old-gate-archive'));
      record.oldGate.archiveAndEvidenceRestore = archived;
      if (!archived.clearedOnlyGeneratedEvidence) throw new Error('M6 could not restore only the generated evidence paths before fresh mutant receipts.');
      const fresh = await runAcceptance(ctx, worktree, evidenceDir, 'm6-gate');
      const freshCandidate = fresh.summary?.identity?.candidate;
      record.freshSaveClosure = { status: fresh.status === 'PASS' && fresh.exitCode === 0 && fresh.commandOutcome === 'EXITED' ? 'PASS' : 'BLOCKED', command: fresh.command, candidateIdentity: freshCandidate?.sha256 ?? null };
      if (record.freshSaveClosure.status !== 'PASS' || freshCandidate?.sha256 !== record.mutantIdentity.sha256) throw new Error('M6 fresh save-closure prerequisites/current receipts are not PASS for the unchanged mutant identity.');
      const built = await runBuildAndCleanProduction(ctx, worktree, fresh.outputDir, 'm6-mutant');
      record.productionBuild = built;
      if (built.status !== 'PASS') throw new Error(`M6 fresh production build did not qualify: ${built.step}`);
      const beforeProbe = await captureCandidateIdentity(worktree);
      if (beforeProbe.sha256 !== record.mutantIdentity.sha256) throw new Error('M6 product patch identity changed between old gate and production assertion.');
      const postArchiveIdentity = await captureCandidateIdentity(worktree);
      record.mutationIdentityAfterEvidenceReset = postArchiveIdentity.sha256;
      if (postArchiveIdentity.sha256 !== record.mutantIdentity.sha256) throw new Error('M6 archive/evidence reset changed the production mutant candidate identity.');
      const probe = await runM6ProductionBootProbe(ctx, worktree, path.join(evidenceDir, 'm6-production-probe'), {
        candidateSha256: record.mutantIdentity.sha256, patchSha256: record.fault.patchSha256,
        loaderSha256: record.fault.sourceHashesAfterPatch?.['src/core-loader.ts'],
      });
      record.productionAssertion = { status: probe.status, proof: path.relative(rootEvidence(), path.join(evidenceDir, 'm6-production-probe', 'm6-production-open-proof.json')).split(path.sep).join('/'), assertion: probe.assertion ?? null, reason: probe.reason ?? null, browserVersion: probe.browserVersion ?? null, cdpProtocolVersion: probe.cdpProtocolVersion ?? null };
      if (probe.status !== 'BEHAVIORAL_RED') throw new Error(`M6 intended production boot/Open assertion did not RED: ${probe.reason ?? probe.status}`);
      const afterProbe = await captureCandidateIdentity(worktree);
      if (afterProbe.sha256 !== record.mutantIdentity.sha256) throw new Error('M6 product patch identity changed during the production assertion.');
      record.status = 'BEHAVIORAL_RED';
    } else {
      const mutationRun = await runAcceptance(ctx, worktree, evidenceDir, `${definition.id.toLowerCase()}-mutated-gate`);
      record.mutationGate = { command: mutationRun.command, gateStatus: mutationRun.status, candidateIdentity: mutationRun.summary?.identity?.candidate?.sha256 ?? null };
      const seed = await readJson(currentSeedPath(mutationRun.outputDir)).catch(() => null);
      const prerequisiteRows = (mutationRun.summary?.caseOutcomes ?? []).filter((item) => prerequisiteCases.includes(item.id));
      record.mutationPrerequisites = {
        status: prerequisiteRows.length === prerequisiteCases.length && prerequisiteRows.every((item) => item.status === 'PASS') ? 'PASS' : 'BLOCKED',
        caseOutcomes: prerequisiteRows,
      };
      record.faultResult = record.mutationPrerequisites.status === 'PASS'
        ? classifyMutationReceipt(seed, definition)
        : { status: 'BLOCKED', reason: 'All seven real prerequisites did not PASS before current mutation-case credit.' };
      record.faultResult.commandOutcome = mutationRun.commandOutcome;
      if (mutationRun.summary?.identity?.candidate?.sha256 !== record.mutantIdentity.sha256) {
        record.faultResult = { status: 'BLOCKED', reason: 'Mutation receipt candidate identity differs from the exact mutant patch.' };
      }
      if (mutationRun.commandOutcome !== 'EXITED') record.faultResult = { status: 'BLOCKED', reason: `Mutation command ended as ${mutationRun.commandOutcome}.` };
      if (record.faultResult.status !== 'BEHAVIORAL_RED') throw new Error(`${definition.id} expected oracle RED was not proven: ${record.faultResult.reason}`);
      record.status = 'BEHAVIORAL_RED';
    }
  } catch (error) {
    record.status = record.status === 'BEHAVIORAL_RED' ? record.status : 'BLOCKED';
    record.diagnostics.push({ status: 'BLOCKED', message: error.message, stack: error.stack });
    ctx.stopAfterMutation = true;
  } finally {
    if (worktree && preimages.size) {
      const restoreManifest = {};
      for (const [file, bytes] of preimages) {
        try { await writeFile(path.join(worktree, file), bytes); restoreManifest[file] = { sha256: bytesHash(await readFile(path.join(worktree, file))), expectedSha256: bytesHash(bytes) }; }
        catch (error) { restoreManifest[file] = { error: error.message }; }
      }
      record.restore = { productSourceFiles: restoreManifest, verified: Object.values(restoreManifest).every((item) => item.sha256 && item.sha256 === item.expectedSha256) };
      record.restoredInvariants = await verifyBaselineInvariants(worktree, baselineHashes, `${definition.id}-restore`).catch((error) => ({ status: 'BLOCKED', reason: error.message }));
      if (!record.restore.verified || record.restoredInvariants.status !== 'PASS') {
        record.status = 'BLOCKED';
        ctx.stopAfterMutation = true;
      }
      await writeMutationJson(path.join(evidenceDir, 'restore-proof.json'), { restore: record.restore, invariants: record.restoredInvariants, changedPathsAfterRestore: await exactChangedPaths(worktree).catch((error) => [`ERROR:${error.message}`]) })
        .catch((error) => { record.status = 'BLOCKED'; ctx.stopAfterMutation = true; record.diagnostics.push({ status: 'BLOCKED', message: `restoration receipt write failed: ${error.message}` }); });
    }
    const removed = await removeWorktree(ctx, worktree, evidenceDir, definition.id).catch((error) => ({ status: 'BLOCKED', error: error.message }));
    record.workspaceCleanup = removed;
    if (removed.status !== 'PASS') { record.status = 'BLOCKED'; ctx.stopAfterMutation = true; }
    record.completedAt = nowIso();
    await writeSummary(ctx);
  }

  if (record.restore?.verified && record.restoredInvariants?.status === 'PASS' && record.workspaceCleanup?.status === 'PASS') {
    const cleanDir = path.join(evidenceDir, 'clean-rerun');
    const clean = await runAcceptance(ctx, worktree ?? root, cleanDir, `${definition.id.toLowerCase()}-restored-clean`);
    record.cleanAfterRestore = requireCleanAcceptance(clean.summary, cleanCandidate, cleanCandidate.head);
    record.cleanAfterRestore.command = clean.command;
    if (record.cleanAfterRestore.status !== 'PASS' || clean.commandOutcome !== 'EXITED' || clean.exitCode !== 0) {
      record.status = 'BLOCKED';
      ctx.stopAfterMutation = true;
    }
    record.cleanAfterRestore.acceptanceArtifact = clean.summary?.acceptanceArtifact ?? null;
    if (!record.cleanAfterRestore.acceptanceArtifact?.digest) {
      record.cleanAfterRestore.status = 'BLOCKED';
      record.cleanAfterRestore.reason = 'Restored clean acceptance artifact inventory was not recorded for the candidate.';
      ctx.stopAfterMutation = true;
    }
    if (definition.id === 'M6' && record.cleanAfterRestore.status === 'PASS') {
      const prod = await runCleanProductionGate(ctx, root, clean.outputDir, 'm6-restored-clean', cleanCandidate.sha256);
      record.cleanProductionAfterRestore = prod;
      if (prod.status !== 'PASS') { record.status = 'BLOCKED'; ctx.stopAfterMutation = true; }
    }
  } else {
    record.cleanAfterRestore = { status: 'NOT RUN', reason: 'restoration or owned worktree cleanup did not verify.' };
  }
  record.completedAt = nowIso();
  await writeSummary(ctx);
  return record;
}

function mutationReceiptSummary(ctx) {
  const allRun = ctx.summary.mutations.length === mutationCases.length;
  const allDetected = ctx.summary.mutations.every((item) => item.status === 'BEHAVIORAL_RED' && item.cleanAfterRestore?.status === 'PASS');
  const m6 = ctx.summary.mutations.find((item) => item.id === 'M6');
  const m6RestoredProduction = m6?.cleanProductionAfterRestore?.status === 'PASS';
  return allRun && allDetected && m6RestoredProduction && ctx.summary.controls?.status === 'PASS' ? 'PASS' : 'BLOCKED';
}

async function runControls(ctx, baselineHashes) {
  const driver = await readFile(path.join(root, 'tests/product/web-save-closure-current.mjs'), 'utf8');
  const requiredFragments = [
    'return save === "Save failed" || (save === "Saved on this device" && !document.querySelector(".ts-modal--save"));',
    'assert.equal(save, "Saved on this device", "Save a copy must succeed and close the current Save dialog");',
  ];
  const missing = requiredFragments.filter((fragment) => !driver.includes(fragment));
  const cases = [
    { name: 'immediate-clean-saved-closed', status: classifySaveTerminalObservation('Saved on this device', false), expected: 'SAVED' },
    { name: 'actual-save-failed', status: classifySaveTerminalObservation('Save failed', true), expected: 'SAVE_FAILED' },
    { name: 'stale-saved-current-dialog-open', status: classifySaveTerminalObservation('Saved on this device', true), expected: 'PENDING' },
    { name: 'missing-status', status: classifySaveTerminalObservation(null, true), expected: 'PENDING' },
    { name: 'indefinitely-saving', status: classifySaveTerminalObservation('Saving…', true), expected: 'PENDING' },
  ];
  const passed = !missing.length && cases.every((item) => item.status === item.expected)
    && baselineHashes['tests/product/web-save-closure-current.mjs'] === expectedSeeds['tests/product/web-save-closure-current.mjs'];
  const result = {
    status: passed ? 'PASS' : 'BLOCKED', cases,
    sourceAssertionFragmentsPresent: missing.length === 0,
    missingFragments: missing,
    note: 'Synthetic terminal observations are a separate unit-control receipt; they do not replace actual M1 or clean preservation/reopen runs.',
  };
  await writeMutationJson(path.join(rootEvidence(), 'mutations', 'm1-controls.json'), result);
  ctx.summary.controls = result;
  await writeSummary(ctx);
  return result;
}

export async function executeMutationQualification() {
  const evidenceDir = rootEvidence();
  await mkdir(path.join(evidenceDir, 'mutations'), { recursive: true });
  const cancellation = createRunnerCancellation();
  const ctx = {
    cancellation,
    commands: [],
    commandCounter: 0,
    serverPids: [],
    worktree: null,
    worktreeTempRoot: null,
    stopAfterMutation: false,
    startedAt: Date.now(),
    remainingMs() {
      const jobStart = Number(process.env.TACHIKO_QUALIFICATION_STARTED_AT ?? 0) * 1000;
      const start = jobStart > 0 ? jobStart : this.startedAt;
      return 20 * 60 * 1000 - (Date.now() - start);
    },
    summary: {
      status: 'NOT RUN', base, expectedHead, startedAt: nowIso(), environment: { platform: process.platform, arch: process.arch, node: process.version, os: os.release() },
      frozenSeedHashes: expectedSeeds, workPin, kitManifest, mutations: [], commands: [], diagnostics: [], controls: { status: 'NOT RUN' },
      limits: { serial: true, mutationsPerWorkspace: 1, jobTimeoutMinutes: 20, uploadReserveMs: 90_000, browser: 'hosted Ubuntu locked Playwright 1.62.1 only for M6; no Mac Chrome/Brave browser launch' },
    },
  };
  ctx.summary.evidenceRoot = evidenceDir;
  const baselineHashes = {};
  try {
    ctx.candidate = await captureCandidateIdentity(root);
    ctx.summary.candidate = ctx.candidate;
    ctx.summary.prIdentity = await validateAuthorizedCandidate(root, ctx.candidate.head);
    if (ctx.candidate.dirtyFiles.length) throw new Error(`clean qualification checkout is dirty before mutations: ${ctx.candidate.dirtyFiles.map(([file]) => file).join(', ')}`);
    const baseStatus = await git(['status', '--porcelain=v1', '-z'], { cwd: root });
    if (baseStatus.code !== 0 || baseStatus.output) throw new Error('candidate checkout is not clean before mutations.');
    const cleanEvidence = await readCleanGate(evidenceDir);
    if (cleanEvidence.save !== 'PASS' || cleanEvidence.prod !== 'PASS' || cleanEvidence.candidate?.sha256 !== ctx.candidate.sha256) {
      throw new Error('the exact-candidate clean 7/11 and production lifecycle receipts are required before mutations.');
    }
    for (const [file, expected] of Object.entries(expectedSeeds)) {
      const actual = await pathHash(path.join(root, file));
      if (actual !== expected) throw new Error(`frozen seed hash mismatch: ${file}`);
    }
    const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
    const lockText = JSON.stringify(lock);
    if (!lockText.includes(workPin) || !lockText.includes(kitManifest)) throw new Error('qualified Work pin or manifest hash differs from the fixed mutation contract.');
    Object.assign(baselineHashes, await hashSnapshot(root));
    ctx.summary.cleanCandidateIdentity = cleanEvidence.candidate.sha256;
    ctx.summary.invariantsBefore = baselineHashes;
    const controls = await runControls(ctx, baselineHashes);
    if (controls.status !== 'PASS') throw new Error('M1 terminal observation controls did not pass.');
    await writeSummary(ctx);

    for (const definition of mutationCases) {
      if (ctx.stopAfterMutation || ctx.cancellation.signal.aborted) {
        ctx.summary.mutations.push({ id: definition.id, status: 'NOT RUN', reason: 'A prior mutation stage was blocked or runner cancellation was received.' });
        await writeSummary(ctx);
        continue;
      }
      if (ctx.remainingMs() < 4 * 60 * 1000) {
        ctx.stopAfterMutation = true;
        ctx.summary.mutations.push({ id: definition.id, status: 'NOT RUN', reason: '20-minute job budget soft stop; cleanup and artifact upload reserve retained.' });
        await writeSummary(ctx);
        continue;
      }
      await runOneMutation(ctx, definition, baselineHashes, cleanEvidence.candidate);
    }
    ctx.summary.status = mutationReceiptSummary(ctx);
    ctx.summary.completedAt = nowIso();
  } catch (error) {
    ctx.summary.status = 'BLOCKED';
    ctx.summary.diagnostics.push({ status: 'BLOCKED', message: error.message, stack: error.stack });
    if (ctx.worktree) {
      const existing = ctx.summary.mutations.at(-1);
      if (existing) existing.status = 'BLOCKED';
    }
    const recorded = new Set(ctx.summary.mutations.map((item) => item.id));
    for (const definition of mutationCases) {
      if (!recorded.has(definition.id)) ctx.summary.mutations.push({ id: definition.id, status: 'NOT RUN', reason: 'A prior setup, cleanup, or evidence write failed; remaining mutation stages were not run.' });
    }
  } finally {
    ctx.summary.commands = ctx.commands;
    ctx.summary.ownedProcessGroups = ctx.serverPids;
    ctx.summary.cancelled = cancellation.receivedSignal ?? null;
    ctx.summary.completedAt ??= nowIso();
    await writeSummary(ctx).catch(() => {});
    cancellation.dispose();
  }
  return ctx.summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await executeMutationQualification();
  console.log(JSON.stringify({ status: result.status, candidate: result.candidate?.head ?? null, mutations: result.mutations.map(({ id, status, cleanAfterRestore, diagnostics }) => ({ id, status, cleanAfterRestore: cleanAfterRestore?.status ?? 'NOT RUN', diagnostics })), evidence: path.join(rootEvidence(), 'mutations', 'mutation-summary.json') }, null, 2));
  if (result.status !== 'PASS') process.exitCode = 78;
}
