import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boundedM6ProbeBudget,
  attachM6BrowserNetworkDiagnostics,
  cleanGateCandidateMatches,
  classifyM6ProductionProof,
  classifyM6ReadinessFaviconDisposition,
  classifyM6LifecycleFaviconDisposition,
  classifyMutationReceipt,
  compareM6DiagnosticEvidence,
  createM6OperationTimeout,
  createM6ReadinessProof,
  executeFrozenSaveControl,
  fetchM6BuildInventory,
  finalizeM6ReadinessProof,
  finalizeM6AuxiliaryDisposition,
  findM6IconReferences,
  qualifyM6AssetInventory,
  recordM6ConsoleError,
  reconcileHostedProductEvidence,
  requireCleanAcceptance,
  validateAuthorizedCandidate,
} from '../scripts/run-save-closure-mutations.mjs';
import { readCommittedSourceIdentities } from '../scripts/runner-source-identity.mjs';

const currentCases = [
  'A-Date-only-normal-Save-fresh-reopen', 'B-same-table-Date-summary-refusal',
  'C-unrelated-Date-summary-refusal', 'C-empty-unrelated-Date-schema-refusal',
  'D-canonical-opaque-complete-copy-controls', 'E-CSV64-row-control', 'E-CSV16-column-control',
  'E-profile-refusal-rows-65.csv', 'E-profile-refusal-fields-17.csv',
  'F-existing-read-fault-no-publication-recovery', 'R-unchanged-private-reader-Date-fixture',
];

test('all runner identities hash complete committed blobs and fail closed on truncated output', async () => {
  const sourceBytes = Buffer.alloc(79_339, 0x61);
  const prefixOnlyChange = Buffer.from(sourceBytes);
  prefixOnlyChange[0] = 0x62;
  assert.deepEqual(prefixOnlyChange.subarray(65_536), sourceBytes.subarray(65_536));

  function gitReader(bytes, { truncate = false } = {}) {
    return async (args, options) => {
      if (args[0] === 'cat-file' && args[1] === '-s') {
        return { outcome: 'EXITED', code: 0, output: `${bytes.length}\n`, bytes: Buffer.from(`${bytes.length}\n`) };
      }
      assert.deepEqual(args, ['show', 'candidate:scripts/large-source.mjs']);
      assert.equal(options.maxOutputBytes, bytes.length + 1);
      const captured = truncate ? bytes.subarray(0, 65_536) : bytes;
      return { outcome: 'EXITED', code: 0, output: '', bytes: captured };
    };
  }
  const original = (await readCommittedSourceIdentities({
    head: 'candidate', files: ['scripts/large-source.mjs'], cwd: '/repo', runGit: gitReader(sourceBytes),
  }))[0];
  const changed = (await readCommittedSourceIdentities({
    head: 'candidate', files: ['scripts/large-source.mjs'], cwd: '/repo', runGit: gitReader(prefixOnlyChange),
  }))[0];
  assert.equal(original.byteCount, 79_339);
  assert.equal(original.capturedByteCount, 79_339);
  assert.equal(changed.byteCount, 79_339);
  assert.equal(changed.capturedByteCount, 79_339);
  assert.equal(original.path, 'scripts/large-source.mjs');
  assert.equal(original.sha256.length, 64);
  assert.notEqual(original.sha256, changed.sha256);
  for (const runner of [
    '../scripts/run-save-closure-mutations.mjs',
    '../scripts/run-save-closure-acceptance.mjs',
    '../scripts/run-production-lifecycle.mjs',
  ]) {
    const source = await readFile(new URL(runner, import.meta.url), 'utf8');
    assert.match(source, /import \{ readCommittedSourceIdentities \} from '\.\/runner-source-identity\.mjs';/);
    assert.match(source, /await readCommittedSourceIdentities\(/);
  }
  await assert.rejects(
    readCommittedSourceIdentities({
      head: 'candidate', files: ['scripts/large-source.mjs'], cwd: '/repo',
      runGit: gitReader(sourceBytes, { truncate: true }),
    }),
    /expected 79339 bytes, captured 65536; refusing candidate identity/,
  );
});

test('PR admission accepts the exact seven tooling paths and rejects added product or frozen-driver paths', async () => {
  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const checkoutHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, stdio: 'pipe' }).toString().trim();
  const requestedHead = process.env.TACHIKO_MUTATION_PR_HEAD || checkoutHead;
  const priorRequestedHead = process.env.TACHIKO_MUTATION_PR_HEAD;
  const expectedPaths = [
    '.github/workflows/product.yml', 'docs/TEST-WIRING.md',
    'scripts/run-production-lifecycle.mjs', 'scripts/run-save-closure-acceptance.mjs',
    'scripts/run-save-closure-mutations.mjs', 'scripts/runner-source-identity.mjs',
    'tests/save-closure-mutations.test.mjs',
  ];
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tachiko-sheet-146-admission-'));
  process.env.TACHIKO_MUTATION_PR_HEAD = requestedHead;
  try {
    const admission = await validateAuthorizedCandidate(repoRoot, checkoutHead);
    assert.deepEqual(admission.implementationPaths, expectedPaths);

    const mergeWorktree = path.join(temporary, 'expected-merge');
    let mergeAdded = false;
    try {
      execFileSync('git', ['worktree', 'add', '--detach', mergeWorktree, '375d25ea12262bec32e2303b3c63662f0b69322f'], { cwd: repoRoot, stdio: 'pipe' });
      mergeAdded = true;
      execFileSync('git', [
        '-c', 'user.name=qualification-test', '-c', 'user.email=qualification-test@example.invalid',
        'merge', '--no-ff', '--no-commit', requestedHead,
      ], { cwd: mergeWorktree, stdio: 'pipe' });
      execFileSync('git', [
        '-c', 'user.name=qualification-test', '-c', 'user.email=qualification-test@example.invalid',
        'commit', '--quiet', '-m', 'test: create expected admission merge parents',
      ], { cwd: mergeWorktree, stdio: 'pipe' });
      const mergeHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: mergeWorktree, stdio: 'pipe' }).toString().trim();
      assert.deepEqual((await validateAuthorizedCandidate(mergeWorktree, mergeHead)).implementationPaths, expectedPaths);
    } finally {
      if (mergeAdded) execFileSync('git', ['worktree', 'remove', '--force', mergeWorktree], { cwd: repoRoot, stdio: 'pipe' });
    }

    async function rejectExtraPath(file, label) {
      const worktree = path.join(temporary, label);
      let added = false;
      try {
        execFileSync('git', ['worktree', 'add', '--detach', worktree, requestedHead], { cwd: repoRoot, stdio: 'pipe' });
        added = true;
        const target = path.join(worktree, file);
        const original = await readFile(target);
        await writeFile(target, Buffer.concat([original, Buffer.from('\n// temporary admission-test change\n')]));
        execFileSync('git', ['add', '--', file], { cwd: worktree, stdio: 'pipe' });
        execFileSync('git', [
          '-c', 'user.name=qualification-test', '-c', 'user.email=qualification-test@example.invalid',
          'commit', '--quiet', '-m', `test: reject extra ${label} admission path`,
        ], { cwd: worktree, stdio: 'pipe' });
        const extraHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, stdio: 'pipe' }).toString().trim();
        process.env.TACHIKO_MUTATION_PR_HEAD = extraHead;
        await assert.rejects(
          validateAuthorizedCandidate(worktree, extraHead),
          /exactly the seven admitted implementation paths/,
        );
      } finally {
        process.env.TACHIKO_MUTATION_PR_HEAD = requestedHead;
        if (added) execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repoRoot, stdio: 'pipe' });
      }
    }

    await rejectExtraPath('src/App.tsx', 'product-source');
    await rejectExtraPath('tests/product/web-save-closure-current.mjs', 'frozen-driver');
  } finally {
    if (priorRequestedHead === undefined) delete process.env.TACHIKO_MUTATION_PR_HEAD;
    else process.env.TACHIKO_MUTATION_PR_HEAD = priorRequestedHead;
    await rm(temporary, { recursive: true, force: true });
  }
});

test('M1 controls execute the exact frozen wait predicate and Saved assertion', async () => {
  const source = await readFile(new URL('../tests/product/web-save-closure-current.mjs', import.meta.url), 'utf8');
  assert.deepEqual(executeFrozenSaveControl(source, { observations: [{ status: 'Saved on this device', saveDialogOpen: false }] }).status, 'PASS');
  const failed = executeFrozenSaveControl(source, { observations: [{ status: 'Save failed', saveDialogOpen: true }] });
  assert.equal(failed.status, 'BEHAVIORAL_RED');
  assert.match(failed.assertion, /Save a copy must succeed and close the current Save dialog/);
  for (const observations of [
    [{ status: 'Saved on this device', saveDialogOpen: true }],
    [{ status: null, saveDialogOpen: false }],
    [{ status: 'Saving…', saveDialogOpen: false }, { status: 'Saving…', saveDialogOpen: true }],
  ]) assert.equal(executeFrozenSaveControl(source, { observations }).status, 'BLOCKED');
  assert.equal(executeFrozenSaveControl(source, { infrastructureError: new Error('NavigationError') }).status, 'BLOCKED');
  assert.equal(executeFrozenSaveControl(source, { infrastructureError: new Error('TransportError') }).status, 'BLOCKED');
});

test('a missing restored-clean summary is BLOCKED rather than crashing', () => {
  const expectedCandidate = { sha256: 'a'.repeat(64) };
  assert.deepEqual(requireCleanAcceptance(undefined, expectedCandidate, 'candidate-head'), {
    status: 'BLOCKED', reason: 'Restored clean acceptance produced no readable summary.',
  });
  assert.deepEqual(requireCleanAcceptance(null, expectedCandidate, 'candidate-head'), {
    status: 'BLOCKED', reason: 'Restored clean acceptance produced no readable summary.',
  });
});

test('a mutation only earns RED for the complete registered suite and its owned assertion', () => {
  const mutation = { id: 'M1', expectedCases: [currentCases[0]], assertionPattern: /Save a copy must succeed and close the current Save dialog/ };
  const receipt = { status: 'BEHAVIORAL_RED', results: currentCases.map((id, index) => ({
    id, result: index === 0 ? 'BEHAVIORAL_RED' : 'PASS',
    message: index === 0 ? 'AssertionError: Save a copy must succeed and close the current Save dialog' : '',
    observed: index === 0 ? { save: 'Save failed' } : undefined,
  })) };
  assert.equal(classifyMutationReceipt(receipt, mutation).status, 'BEHAVIORAL_RED');
  assert.equal(classifyMutationReceipt({ ...receipt, results: receipt.results.slice(1) }, mutation).status, 'BLOCKED');
  assert.equal(classifyMutationReceipt({ ...receipt, results: receipt.results.map((item, index) => index ? item : { ...item, result: 'BLOCKED', message: 'navigation timeout' }) }, mutation).status, 'BLOCKED');
  assert.equal(classifyMutationReceipt({ ...receipt, results: receipt.results.map((item, index) => index ? item : { ...item, message: 'setup failed' }) }, mutation).status, 'BLOCKED');
  assert.equal(classifyMutationReceipt({ ...receipt, results: receipt.results.map((item, index) => index ? item : { ...item, observed: { save: 'Saved on this device' } }) }, mutation).status, 'BLOCKED');
  assert.equal(classifyMutationReceipt({ ...receipt, results: receipt.results.map((item, index) => index ? item : { ...item, observed: { save: 'Save failed' }, message: 'NavigationError: transport unavailable' }) }, mutation).status, 'BLOCKED');
});

test('Date refusal mutants accept the existing explicit zero-summary refusal oracle, not a generic assertion', () => {
  const m2 = { id: 'M2', expectedCases: [currentCases[1]], assertionPattern: /Date refusal occurs before producer Create dispatch|No current cross-table result is available|rendered Summary has zero existing or missing definition cards/ };
  const receipt = { status: 'BEHAVIORAL_RED', results: currentCases.map((id) => ({ id, result: 'PASS', message: '' })) };
  const row = currentCases.indexOf(currentCases[1]);
  receipt.results[row] = { id: currentCases[1], result: 'BEHAVIORAL_RED', message: 'The input did not match /No current cross-table result is available/i.' };
  assert.equal(classifyMutationReceipt(receipt, m2).status, 'BEHAVIORAL_RED');
  receipt.results[row] = { ...receipt.results[row], message: 'AssertionError: expected something to happen' };
  assert.equal(classifyMutationReceipt(receipt, m2).status, 'BLOCKED');
});

test('M5b attributes the earliest existing source-name preservation assertion', () => {
  const mutation = { id: 'M5b', expectedCases: [currentCases[0]], assertionPattern: /Expected values to be strictly equal:[\s\S]*\+ undefined[\s\S]*- 'date-only\.csv'/ };
  const receipt = { status: 'BEHAVIORAL_RED', results: currentCases.map((id) => ({ id, result: 'PASS', message: '' })) };
  const row = currentCases.indexOf(currentCases[0]);
  let sourceNameAssertion;
  try { assert.equal(undefined, 'date-only.csv'); } catch (error) { sourceNameAssertion = error.message; }
  receipt.results[row] = { id: currentCases[0], result: 'BEHAVIORAL_RED', message: sourceNameAssertion };
  assert.equal(classifyMutationReceipt(receipt, mutation).status, 'BEHAVIORAL_RED');
  receipt.results[row] = { ...receipt.results[row], message: 'AssertionError: unrelated source hash mismatch' };
  assert.equal(classifyMutationReceipt(receipt, mutation).status, 'BLOCKED');
});

test('hosted preflight archives and restores only generated product-acceptance evidence', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tachiko-sheet-146-evidence-reconcile-'));
  const repo = path.join(temporary, 'repo');
  const evidence = path.join(repo, 'evidence/product-acceptance');
  const source = path.join(repo, 'src');
  const archiveRoot = path.join(temporary, 'archive-root');
  await mkdir(evidence, { recursive: true });
  await mkdir(source, { recursive: true });
  const originalSummary = `${JSON.stringify({ status: 'PASS', summary: [{ status: 'PASS' }] })}\n`;
  const originalLog = 'committed historical log\n';
  await writeFile(path.join(evidence, 'summary.json'), originalSummary);
  await writeFile(path.join(evidence, 'browser-m1.log'), originalLog);
  await writeFile(path.join(source, 'App.tsx'), 'unchanged source\n');
  const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  try {
    git(['init', '--quiet']);
    git(['add', '.']);
    git(['-c', 'user.name=qualification-test', '-c', 'user.email=qualification-test@example.invalid', 'commit', '--quiet', '-m', 'baseline']);
    await writeFile(path.join(evidence, 'summary.json'), `${JSON.stringify({ status: 'PASS', summary: [{ status: 'PASS' }], run: 2 })}\n`);
    await writeFile(path.join(evidence, 'browser-m1.log'), 'current hosted output\n');
    await writeFile(path.join(evidence, 'new-step.log'), 'additional generated output\n');
    const result = await reconcileHostedProductEvidence(repo, archiveRoot);
    assert.equal(result.status, 'PASS');
    assert.equal(result.reconciled, true);
    assert.deepEqual(await readFile(path.join(evidence, 'summary.json'), 'utf8'), originalSummary);
    assert.deepEqual(await readFile(path.join(evidence, 'browser-m1.log'), 'utf8'), originalLog);
    await assert.rejects(readFile(path.join(evidence, 'new-step.log')), { code: 'ENOENT' });
    assert.equal(git(['status', '--porcelain']).toString(), '');
    const archived = path.join(archiveRoot, result.archive);
    assert.equal(await readFile(path.join(archived, 'summary.json'), 'utf8'), `${JSON.stringify({ status: 'PASS', summary: [{ status: 'PASS' }], run: 2 })}\n`);
    assert.equal(await readFile(path.join(archived, 'new-step.log'), 'utf8'), 'additional generated output\n');
    await writeFile(path.join(source, 'App.tsx'), 'product source edit\n');
    await assert.rejects(reconcileHostedProductEvidence(repo, archiveRoot), /dirty paths outside generated product-acceptance evidence/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('clean gate receipts may bind archived product evidence while committed candidate identity stays exact', () => {
  const committedFiles = [['src/App.tsx', 'a'.repeat(64)]];
  const clean = { base: 'b'.repeat(40), head: 'c'.repeat(40), committedFiles, dirtyFiles: [], sha256: 'd'.repeat(64) };
  const gate = { ...clean, dirtyFiles: [['evidence/product-acceptance/summary.json', 'e'.repeat(64)]], sha256: 'f'.repeat(64) };
  assert.equal(cleanGateCandidateMatches(clean, clean), true);
  assert.equal(cleanGateCandidateMatches(gate, clean, [['summary.json', 'e'.repeat(64)]]), true);
  assert.equal(cleanGateCandidateMatches({ ...gate, dirtyFiles: [['src/App.tsx', 'e'.repeat(64)]] }, clean, [['summary.json', 'e'.repeat(64)]]), false);
  assert.equal(cleanGateCandidateMatches({ ...gate, committedFiles: [['src/App.tsx', '9'.repeat(64)]] }, clean, [['summary.json', 'e'.repeat(64)]]), false);
  assert.equal(cleanGateCandidateMatches(gate, clean, [['summary.json', '0'.repeat(64)]]), false);
});

test('M6 readiness budget leaves restoration and upload reserve untouched', () => {
  assert.equal(boundedM6ProbeBudget(180_000), 45_000);
  assert.equal(boundedM6ProbeBudget(130_000), 40_000);
  assert.equal(boundedM6ProbeBudget(99_999), null);
});

test('M6 inventory execution uses finite caps through the real absolute-deadline callback', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tachiko-sheet-146-m6-budget-'));
  try {
    const files = [['index.html', 'index bytes'], ['core-kit/runtime.wasm', 'wasm bytes']]
      .map(([file, body]) => [file, createHash('sha256').update(body).digest('hex')]);
    await writeFile(path.join(temporary, 'production-build.json'), JSON.stringify({ status: 'PASS',
      artifact: { files, digest: createHash('sha256').update(JSON.stringify(files)).digest('hex') } }));
    let now = 1_000;
    const timeout = createM6OperationTimeout(3_400, () => now);
    const timeoutRequests = [];
    const boundedTimeout = (maximum) => { timeoutRequests.push(maximum); return timeout(maximum); };
    const bodies = new Map([['index.html', 'index bytes'], ['core-kit/runtime.wasm', 'wasm bytes']]);
    const inventory = await fetchM6BuildInventory('.', temporary, 'https://sheet.test', boundedTimeout, async (url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.signal.aborted, false);
      return new Response(bodies.get(new URL(url).pathname.slice(1)), { status: 200 });
    });
    assert.deepEqual(timeoutRequests, [5_000, 5_000]);
    assert.equal(timeout(5_000), 2_400);
    assert.equal(inventory.status, 'PASS');
    now = 3_400;
    assert.throws(() => timeout(5_000), /exhausted its absolute budget/);
    assert.throws(() => timeout(undefined), /finite positive maximum/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('M6 icon audit finds explicit source and emitted icon references without matching ordinary stylesheet links', () => {
  assert.equal(findM6IconReferences('<link rel="stylesheet" href="/assets/app.css">', 'index.html').length, 0);
  assert.deepEqual(findM6IconReferences('<link rel="icon" href="/favicon.ico"><script>fetch("/favicon.ico")</script>', 'built.html')
    .map((row) => row.kind).sort(), ['favicon-literal', 'favicon-literal', 'icon-link', 'ico-literal', 'ico-literal'].sort());
});

test('M6 served build inventory requires every recorded file status and full-body hash to match', () => {
  const files = [
    ['index.html', 'a'.repeat(64)],
    ['assets/index-app.js', 'b'.repeat(64)],
    ['core-kit/experimental-client.worker.js', 'c'.repeat(64)],
    ['core-kit/designer_runtime.wasm', 'd'.repeat(64)],
  ];
  const receipt = { status: 'PASS', artifact: { digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files } };
  const observed = files.map(([file, hash]) => ({ path: file, status: 200, bodySha256: hash }));
  assert.equal(qualifyM6AssetInventory(receipt, observed).status, 'PASS');
  assert.equal(qualifyM6AssetInventory(receipt, observed.slice(0, -1)).status, 'BLOCKED');
  assert.equal(qualifyM6AssetInventory(receipt, observed.map((row) => row.path.endsWith('.wasm') ? { ...row, bodySha256: 'e'.repeat(64) } : row)).status, 'BLOCKED');
  assert.equal(qualifyM6AssetInventory(receipt, observed.map((row) => row.path.endsWith('.worker.js') ? { ...row, status: 404 } : row)).status, 'BLOCKED');
});

test('M6 clean/mutant favicon parity remains diagnostic and every observed 404 still blocks readiness', () => {
  const faviconHash = createHash('sha256').update('Not found').digest('hex');
  const build = (candidateKind, entryPath, entryHash, port) => {
    const proof = createM6ReadinessProof({ candidateSha256: (candidateKind === 'mutant' ? 'a' : 'f').repeat(64), patchSha256: 'b'.repeat(64), loaderSha256: 'c'.repeat(64) }, { candidateKind });
    proof.browserVersion = 'Chrome/151.0.7922.34';
    proof.productionEntryAssetPath = entryPath;
    const indexHtml = `<html><head></head><body><script type="module" src="${entryPath}"></script></body></html>`;
    const indexHash = createHash('sha256').update(indexHtml).digest('hex');
    proof.independentHttpGets.push({ name: 'production-index', url: `http://127.0.0.1:${port}/`, method: 'GET', status: 200,
      bodyText: indexHtml, bodyByteCount: Buffer.byteLength(indexHtml), bodySha256: indexHash });
    proof.independentHttpGets.push({ name: 'production-favicon', requestedUrl: `http://127.0.0.1:${port}/favicon.ico`,
      url: `http://127.0.0.1:${port}/favicon.ico`, sameOrigin: true, method: 'GET', status: 404, bodyByteCount: 9, bodySha256: faviconHash, bodyText: 'Not found' });
    proof.sourceIconAudit = { status: 'PASS', references: [] };
    proof.emittedHtmlAudit = { status: 'PASS', byteCount: Buffer.byteLength(indexHtml), sha256: indexHash,
      references: [], domAudit: { iconLinks: [], references: [] } };
    const blankDom = '<html><head></head><body>blank control</body></html>';
    proof.hookFreeControl = { status: 'CONTROL_OBSERVED', browserVersion: proof.browserVersion,
      domAudit: { outerHtml: blankDom, htmlByteCount: Buffer.byteLength(blankDom), htmlSha256: createHash('sha256').update(blankDom).digest('hex'), scriptCount: 0, links: [] },
      serverRequests: [{ method: 'GET', path: '/favicon.ico', status: 404, bodyByteCount: 9, bodySha256: faviconHash, bodyText: 'Not found' }] };
    const files = [['index.html', indexHash], [entryPath.slice(1), entryHash],
      ['core-kit/experimental-client.worker.js', '2'.repeat(64)], ['core-kit/designer_runtime.wasm', '3'.repeat(64)]];
    proof.assetInventoryVerification = { status: 'PASS', recordedArtifactDigest: candidateKind, expectedFiles: files.map(([path, sha256]) => ({ path, sha256 })) };
    return proof;
  };
  const mutant = build('mutant', '/assets/index-mutant.js', '4'.repeat(64), 3101);
  const clean = build('clean', '/assets/index-clean.js', '5'.repeat(64), 3102);
  const comparison = compareM6DiagnosticEvidence(mutant, clean);
  assert.equal(comparison.status, 'OBSERVED_PARITY');
  assert.equal(comparison.readinessRuleChanged, false);
  assert.equal(comparison.artifactParity.requiredCoreKitAssetCount, 2);
  clean.hookFreeControl.domAudit.outerHtml = '<html><head></head><body>changed control</body></html>';
  assert.equal(compareM6DiagnosticEvidence(mutant, clean).status, 'INCOMPLETE_OR_DIFFERENT');
  Object.assign(mutant, { httpIndexStatus: 200, productionAssetStatus: 200, browserNavigationStatus: 200, cdpReady: true, coldHomeReady: true });
  mutant.diagnostics.responses.push({ url: 'http://127.0.0.1:3101/', status: 200, resourceType: 'document' });
  assert.equal(finalizeM6ReadinessProof(mutant).status, 'BLOCKED');
});

test('M6 diagnostics attribute a real HTTP 404 by URL, status, resource type, and console location', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('missing test resource');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/missing.css`;
  const readiness = createM6ReadinessProof({ candidateSha256: 'a'.repeat(64), patchSha256: 'b'.repeat(64), loaderSha256: 'c'.repeat(64) });
  try {
    const context = new EventEmitter();
    attachM6BrowserNetworkDiagnostics(context, readiness);
    const request = { url: () => url, method: () => 'GET', resourceType: () => 'stylesheet', failure: () => null };
    context.emit('request', request);
    const response = await fetch(url);
    assert.equal(response.status, 404);
    const responseEvent = {
      url: () => response.url,
      status: () => response.status,
      request: () => request,
      headers: () => ({ 'content-type': response.headers.get('content-type') }),
    };
    context.emit('response', responseEvent);
    const attributed = readiness.diagnostics.responses[0];
    assert.deepEqual(attributed, {
      url, status: 404, resourceType: 'stylesheet', method: 'GET',
      contentType: 'text/plain; charset=utf-8', source: 'browser-context',
    });
    assert.deepEqual(readiness.diagnostics.responseErrors, [{ kind: 'http-status', ...attributed }]);
    assert.deepEqual(readiness.diagnostics.requests, [{ url, method: 'GET', resourceType: 'stylesheet', source: 'browser-context' }]);
    const consoleError = recordM6ConsoleError(readiness, {
      type: () => 'error',
      text: () => 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      location: () => ({ url, lineNumber: 0, columnNumber: 0 }),
    });
    assert.deepEqual(consoleError, {
      message: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      location: { url, lineNumber: 0, columnNumber: 0 },
    });
    assert.equal(finalizeM6ReadinessProof({
      ...readiness, httpIndexStatus: 200, productionAssetStatus: 200, browserNavigationStatus: 200,
      cdpReady: true, browserVersion: 'Chrome/151.0.0.0', coldHomeReady: true,
    }).status, 'BLOCKED');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function m6AuxiliaryFixture(kind, port) {
  const candidateSha = kind === 'mutant' ? 'a'.repeat(64) : 'f'.repeat(64);
  const origin = `http://127.0.0.1:${port}`;
  const faviconBody = 'Not found';
  const faviconHash = createHash('sha256').update(faviconBody).digest('hex');
  const entry = `assets/index-${kind}.js`;
  const indexHtml = `<html><head></head><body><script type="module" src="/${entry}"></script></body></html>`;
  const files = [
    ['index.html', createHash('sha256').update(indexHtml).digest('hex')], [entry, kind === 'mutant' ? '2'.repeat(64) : '3'.repeat(64)],
    ['assets/index.css', '4'.repeat(64)], ['core-kit/experimental-client.worker.js', '5'.repeat(64)],
    ['core-kit/designer_runtime.wasm', '6'.repeat(64)],
  ];
  const artifact = { digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
  const buildReceipt = { status: 'PASS', candidate: { sha256: candidateSha }, artifact };
  const faviconConsole = (url) => ({ message: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
    location: { url, lineNumber: 0, columnNumber: 0 } });
  const outerHtml = '<html><head><title>M6 blank control</title></head><body>blank control</body></html>';
  const control = {
    status: 'CONTROL_OBSERVED', browserVersion: 'Chrome/151.0.7922.34', browserFaviconRequestObserved: true, navigationStatus: 200,
    domAudit: { url: `${origin}/`, outerHtml, htmlByteCount: Buffer.byteLength(outerHtml),
      htmlSha256: createHash('sha256').update(outerHtml).digest('hex'), scriptCount: 0, links: [], iconLinks: [], references: [] },
    serverRequests: [
      { method: 'GET', path: '/', status: 200, bodyText: '<!doctype html><html><head><title>M6 blank control</title></head><body>blank control</body></html>' },
      { method: 'GET', path: '/favicon.ico', status: 404, bodyText: faviconBody,
        bodyByteCount: Buffer.byteLength(faviconBody), bodySha256: faviconHash },
    ],
    diagnostics: { requests: [{ url: `${origin}/`, method: 'GET', resourceType: 'document' }],
      responses: [{ url: `${origin}/`, status: 200, method: 'GET', resourceType: 'document' }],
      consoleErrors: [faviconConsole(`${origin}/favicon.ico`)], pageErrors: [], requestFailures: [], responseErrors: [], captureErrors: [], droppedEvents: 0 },
  };
  const requests = files.map(([file]) => ({ url: `${origin}/${file}`, method: 'GET', resourceType:
    file.endsWith('.css') ? 'stylesheet' : file.endsWith('.wasm') ? 'fetch' : file.endsWith('index.html') ? 'document' : 'script' }));
  const proof = {
    status: 'BLOCKED', reason: 'Independent cold-Home readiness contained an HTTP, request, response, console, page or CDP error.', candidateKind: kind, candidateIdentity: candidateSha,
    mutantCandidateIdentity: kind === 'mutant' ? candidateSha : null,
    httpIndexStatus: 200, productionAssetStatus: 200, browserNavigationStatus: 200, cdpReady: true, coldHomeReady: true,
    browserVersion: 'Chrome/151.0.7922.34', playwrightVersion: '1.62.1', buildDigest: artifact.digest,
    productionEntryAssetPath: `/${entry}`,
    independentHttpGets: [
      { name: 'production-index', url: `${origin}/`, method: 'GET', status: 200,
        bodyByteCount: Buffer.byteLength(indexHtml), bodySha256: createHash('sha256').update(indexHtml).digest('hex'), bodyText: indexHtml },
      { name: 'production-entry', url: `${origin}/${entry}`, method: 'GET', status: 200 },
      { name: 'production-favicon', requestedUrl: `${origin}/favicon.ico`, url: `${origin}/favicon.ico`,
        sameOrigin: true, method: 'GET', status: 404, redirected: false, bodyByteCount: Buffer.byteLength(faviconBody),
        bodySha256: faviconHash, bodyText: faviconBody },
    ],
    diagnostics: { requests, responses: requests.map((row) => ({ ...row, status: 200 })),
      consoleErrors: [faviconConsole(`${origin}/favicon.ico`)], pageErrors: [], requestFailures: [], responseErrors: [], captureErrors: [], droppedEvents: 0 },
    sourceIconAudit: { status: 'PASS', references: [], sourceFiles: [{ path: 'index.html', sha256: 'a'.repeat(64) }] },
    emittedHtmlAudit: { status: 'PASS', byteCount: Buffer.byteLength(indexHtml), sha256: createHash('sha256').update(indexHtml).digest('hex'), references: [],
      entryScriptAudit: { path: entry, sha256: files.find(([file]) => file === entry)[1],
        expectedSha256: files.find(([file]) => file === entry)[1], references: [] },
      scriptAssets: files.filter(([file]) => /\.m?js$/i.test(file)).map(([path, sha256]) =>
        ({ path, sha256, expectedSha256: sha256, references: [] })),
      domAudit: { url: `${origin}/`, references: [], iconLinks: [] } },
    assetInventoryVerification: { status: 'PASS', recordedArtifactDigest: artifact.digest,
      expectedFileCount: files.length, expectedFiles: files.map(([path, sha256]) => ({ path, sha256 })),
      observedRows: files.map(([path, bodySha256]) => ({ path, url: new URL(`/${path.split('/').map(encodeURIComponent).join('/')}`, origin).href,
        method: 'GET', status: 200, bodySha256 })) },
    hookFreeControl: control, stopErrors: [], ownedProcesses: [
      { role: 'production-http', command: 'node scripts/serve-dist.mjs', exit: { code: 0 } },
      { role: 'managed-chromium', command: '/root/.cache/ms-playwright/chromium-1510/chrome-linux/chrome', exit: { code: 0 } },
    ],
  };
  return { candidateSha, origin, faviconBody, faviconHash, files, artifact, buildReceipt, proof };
}

function m6LifecycleFixture(fixture, readiness, expectedStatus) {
  const origin = readiness.independentHttpGets.find((row) => row.name === 'production-index').url.replace(/\/$/, '');
  const target = `${origin}/favicon.ico`;
  const launches = expectedStatus === 'BEHAVIORAL_RED' ? [1] : [1, 2];
  const errors = launches.map((launch) => ({ launch,
    message: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: target }));
  const processEvidence = launches.map((launch) => ({ launch, endpointReady: true,
    browserVersion: 'Chrome/151.0.7922.34', ...(expectedStatus === 'PASS' ? { exit: { observed: true, signal: null, code: 0 } } : {}) }));
  const inventory = fixture.artifact;
  const served = fixture.files.map(([path, sha256]) => ({ path: `/${path}`, sha256, status: 200 }));
  const receipt = {
    status: expectedStatus, base: '375d25ea12262bec32e2303b3c63662f0b69322f',
    boundary: 'production lifecycle seed; setup/HTTP/browser errors are never mutant credit',
    phase: 'cold-Home-and-production-runtime', caseIds: expectedStatus === 'PASS' ? ['production-sales-edit-save-process-restart-reopen-edit-png'] : [],
    expectedCaseIds: ['production-sales-edit-save-process-restart-reopen-edit-png'],
    ...(expectedStatus === 'BEHAVIORAL_RED' ? {
      origin,
      productionInventory: inventory,
      acceptanceInventory: fixture.acceptanceArtifact ?? inventory,
      networkEvidence: served.map((row) => ({ ...row, pid: 42, launch: 1 })),
      error: { name: 'AssertionError', message: 'normal Home Sales Open is enabled when the production runtime is ready', stack: 'AssertionError: Home/Open\n    at frozen lifecycle' },
    } : {
      error: null,
      environment: { node: 'v24.15.0', platform: 'linux', arch: 'x64', origin, playwrightVersion: '1.62.1',
        executable: '/root/.cache/ms-playwright/chromium-1510/chrome-linux/chrome', browserVersion: 'Chrome/151.0.7922.34',
        profile: '/tmp/profile', copyName: 'fixture-copy' },
      artifacts: { production: inventory, acceptance: fixture.acceptanceArtifact ?? inventory,
        productionManifestSha256: inventory.digest, acceptanceManifestSha256: (fixture.acceptanceArtifact ?? inventory).digest,
        servedResponses: served, png: { path: '/tmp/result.png', sha256: 'a'.repeat(64), bytes: 10, facts: { status: 'PASS' },
          blankPngControl: 'REJECTED_AS_EXPECTED' } },
    }),
    processEvidence,
    diagnostics: { consoleErrors: errors, pageErrors: [], requestFailures: [], responseErrors: [], captureErrors: [], droppedEvents: 0 },
  };
  const summary = { status: expectedStatus, lifecycle: expectedStatus, candidate: { sha256: fixture.candidateSha },
    command: { outcome: 'EXITED', exitCode: expectedStatus === 'BEHAVIORAL_RED' ? 1 : 0 },
    buildEvidence: { artifact: fixture.artifact } };
  const faviconProbe = { status: 'PASS', origin, method: 'GET', requestedUrl: target, url: target, sameOrigin: true,
    redirected: false, statusCode: 404, bodyByteCount: fixture.faviconBody.length,
    bodySha256: fixture.faviconHash, bodyText: fixture.faviconBody, cleanupErrors: [], serverExit: { observed: true, code: 0 } };
  const browserProvenance = { status: 'PASS', candidateSha256: fixture.candidateSha, buildDigest: fixture.artifact.digest,
    frozenSeedSha256: 'eb9cb264f1d7e561e506810a5ae4bb1be086102977b3a786d8f9488a452eb77d',
    playwrightTestVersion: '1.62.1', playwrightCoreVersion: '1.62.1',
    executable: '/root/.cache/ms-playwright/chromium-1510/chrome-linux/chrome', executableIsFile: true, executableBytes: 100 };
  return { receipt: JSON.parse(JSON.stringify(receipt)), summary, buildReceipt: fixture.buildReceipt, faviconProbe, browserProvenance };
}

test('M6 auxiliary default-favicon disposition requires paired readiness and frozen lifecycle provenance', () => {
  const mutant = m6AuxiliaryFixture('mutant', 3101);
  const clean = m6AuxiliaryFixture('clean', 3101);
  const mutantLifecycle = m6LifecycleFixture(mutant, mutant.proof, 'BEHAVIORAL_RED');
  const cleanLifecycle = m6LifecycleFixture(clean, clean.proof, 'PASS');
  assert.equal(Object.hasOwn(mutantLifecycle.receipt, 'environment'), false);
  assert.equal(Object.hasOwn(mutantLifecycle.receipt, 'artifacts'), false);
  assert.equal(mutantLifecycle.receipt.processEvidence.length, 1);
  assert.equal(Object.hasOwn(mutantLifecycle.receipt.processEvidence[0], 'exit'), false);
  assert.equal(cleanLifecycle.receipt.processEvidence.length, 2);
  assert.equal(cleanLifecycle.receipt.processEvidence.every((row) => row.exit?.observed === true), true);
  cleanLifecycle.receipt.caseIds = ['production-sales-edit-save-process-restart-reopen-edit-png'];
  cleanLifecycle.receipt.error = null;
  const comparison = compareM6DiagnosticEvidence(mutant.proof, clean.proof);
  assert.equal(comparison.auxiliaryEvidenceParity, true);
  const changedHtml = structuredClone(clean.proof);
  changedHtml.assetInventoryVerification.expectedFiles[0].sha256 = 'e'.repeat(64);
  assert.equal(compareM6DiagnosticEvidence(mutant.proof, changedHtml).auxiliaryEvidenceParity, false,
    'the clean/mutant parity check includes emitted index.html');
  const unexpectedHtml = structuredClone(clean.proof);
  const indexBody = unexpectedHtml.independentHttpGets.find((row) => row.name === 'production-index');
  indexBody.bodyText = indexBody.bodyText.replace('</head>', '<meta name="unexpected-change"> </head>');
  indexBody.bodyByteCount = Buffer.byteLength(indexBody.bodyText);
  indexBody.bodySha256 = createHash('sha256').update(indexBody.bodyText).digest('hex');
  unexpectedHtml.emittedHtmlAudit.byteCount = indexBody.bodyByteCount;
  unexpectedHtml.emittedHtmlAudit.sha256 = indexBody.bodySha256;
  unexpectedHtml.assetInventoryVerification.expectedFiles.find((row) => row.path === 'index.html').sha256 = indexBody.bodySha256;
  unexpectedHtml.assetInventoryVerification.observedRows.find((row) => row.path === 'index.html').bodySha256 = indexBody.bodySha256;
  const unexpectedParity = compareM6DiagnosticEvidence(mutant.proof, unexpectedHtml);
  assert.equal(unexpectedParity.artifactParity.indexHtmlParity, false,
    'only the exact candidate-specific production script reference is normalized in index.html');
  assert.equal(unexpectedParity.auxiliaryEvidenceParity, false);
  assert.equal(classifyM6ReadinessFaviconDisposition(mutant.proof,
    { candidateSha256: mutant.candidateSha }, mutant.buildReceipt).status, 'AUXILIARY_CANDIDATE');
  assert.equal(classifyM6LifecycleFaviconDisposition(mutantLifecycle.receipt, mutantLifecycle.summary,
    mutant.buildReceipt, mutantLifecycle.faviconProbe, mutant.candidateSha, mutant.proof, 'BEHAVIORAL_RED', mutantLifecycle.browserProvenance).status, 'AUXILIARY_CANDIDATE');
  assert.equal(classifyM6LifecycleFaviconDisposition(cleanLifecycle.receipt, cleanLifecycle.summary,
    clean.buildReceipt, cleanLifecycle.faviconProbe, clean.candidateSha, clean.proof, 'PASS', cleanLifecycle.browserProvenance).status, 'AUXILIARY_CANDIDATE');
  const termStoppedServer = structuredClone(mutantLifecycle.faviconProbe);
  termStoppedServer.serverExit = { observed: true, code: 1, signal: 'SIGTERM' };
  assert.equal(classifyM6LifecycleFaviconDisposition(mutantLifecycle.receipt, mutantLifecycle.summary,
    mutant.buildReceipt, termStoppedServer, mutant.candidateSha, mutant.proof, 'BEHAVIORAL_RED', mutantLifecycle.browserProvenance).status,
  'AUXILIARY_CANDIDATE', 'the owned process helper reports expected SIGTERM shutdown as code 1 plus signal');
  const disposition = finalizeM6AuxiliaryDisposition({
    mutantReadiness: mutant.proof, cleanReadiness: clean.proof,
    mutantIdentity: { candidateSha256: mutant.candidateSha }, cleanIdentity: { candidateSha256: clean.candidateSha },
    mutantBuildReceipt: mutant.buildReceipt, cleanBuildReceipt: clean.buildReceipt,
    mutantLifecycle: { ...mutantLifecycle, buildReceipt: mutant.buildReceipt },
    cleanLifecycle: { ...cleanLifecycle, buildReceipt: clean.buildReceipt }, comparison,
    mutantReadinessSha256: '7'.repeat(64), cleanReadinessSha256: '8'.repeat(64),
    mutantLifecycleReceiptSha256: '9'.repeat(64), cleanLifecycleReceiptSha256: '0'.repeat(64),
  });
  assert.equal(disposition.status, 'AUXILIARY_DEFAULT_FAVICON_404', JSON.stringify(disposition));
  assert.equal(classifyM6ProductionProof(mutant.proof, mutantLifecycle.receipt,
    { candidateSha256: mutant.candidateSha, patchSha256: 'b'.repeat(64), loaderSha256: 'c'.repeat(64) }, {
      disposition, mutantBuildReceipt: mutant.buildReceipt, mutantLifecycleSummary: mutantLifecycle.summary,
      mutantLifecycleFaviconProbe: mutantLifecycle.faviconProbe,
      mutantLifecycleBrowserProvenance: mutantLifecycle.browserProvenance,
      mutantReadinessSha256: disposition.receipts.mutantReadinessSha256,
      mutantLifecycleReceiptSha256: disposition.receipts.mutantLifecycleReceiptSha256,
    }).status, 'BEHAVIORAL_RED');
});

test('M6 readiness and lifecycle validators reject unsafe error, attribution, identity, and cleanup controls', () => {
  const mutant = m6AuxiliaryFixture('mutant', 3201);
  const clean = m6AuxiliaryFixture('clean', 3202);
  const lifecycle = m6LifecycleFixture(mutant, mutant.proof, 'BEHAVIORAL_RED');
  const missingAssets = [
    ['missing-js', '/assets/missing.js', 'script'], ['missing-css', '/assets/missing.css', 'stylesheet'],
    ['missing-worker', '/core-kit/missing.worker.js', 'worker'], ['missing-wasm', '/core-kit/missing.wasm', 'fetch'],
    ['missing-chunk', '/assets/chunk-missing.js', 'script'], ['missing-home', '/', 'document'],
  ];
  const cases = [
    ...missingAssets.map(([name, path, resourceType]) => [name, (p) => { p.diagnostics.responses.push({ url: `${mutant.origin}${path}`, status: 404, resourceType }); }]),
    ['explicit-source-or-shipped-icon', (p) => { p.sourceIconAudit.references.push({ path: 'src/App.tsx', value: 'icon link' }); }],
    ['explicit-emitted-icon', (p) => { p.emittedHtmlAudit.domAudit.iconLinks.push({ href: '/icon.svg' }); }],
    ['query', (p) => { p.independentHttpGets[2].requestedUrl += '?cache=1'; }],
    ['redirect', (p) => { p.independentHttpGets[2].redirected = true; }],
    ['cross-origin', (p) => { p.independentHttpGets[2].url = 'http://example.test/favicon.ico'; }],
    ['favicon-500', (p) => { p.independentHttpGets[2].status = 500; }],
    ['get-mismatch', (p) => { p.independentHttpGets[2].method = 'POST'; }],
    ['generic-or-second-error', (p) => { p.diagnostics.consoleErrors.push({ message: 'Unrelated error', location: { url: `${mutant.origin}/`, lineNumber: 1, columnNumber: 1 } }); }],
    ['missing-attribution', (p) => { delete p.diagnostics.consoleErrors[0].location; }],
    ['capture-overflow-or-exception', (p) => { p.diagnostics.droppedEvents = 1; }],
    ['timeout-or-cleanup-failure', (p) => { p.stopErrors.push({ message: 'timeout or cleanup failure' }); }],
    ['explicit-icon-fetch-request', (p) => { p.diagnostics.requests.push({ url: `${mutant.origin}/favicon.ico`, method: 'GET', resourceType: 'fetch' }); }],
    ['wrong-candidate', (p) => { p.candidateIdentity = 'e'.repeat(64); }],
    ['wrong-build', (p) => { p.buildDigest = 'e'.repeat(64); }],
    ['missing-required-array', (p) => { delete p.diagnostics.captureErrors; }],
    ['missing-dropped-event-count', (p) => { delete p.diagnostics.droppedEvents; }],
    ['missing-source-audit-arrays', (p) => { delete p.sourceIconAudit.references; }],
    ['duplicate-script-replaces-worker', (p) => { p.emittedHtmlAudit.scriptAssets[1].path = p.emittedHtmlAudit.scriptAssets[0].path; }],
    ['wrong-production-index-url', (p) => { p.independentHttpGets[0].url = `${mutant.origin}/other`; }],
    ['wrong-emitted-html-hash', (p) => { p.emittedHtmlAudit.sha256 = 'e'.repeat(64); }],
    ['explicit-readiness-timeout', (p) => { p.reason = 'TimeoutError: readiness probe timed out'; }],
    ['control-close-error', (p) => { p.hookFreeControl.closeError = 'context close failed'; }],
    ['control-server-close-error', (p) => { p.hookFreeControl.serverCloseError = 'server close failed'; }],
  ];
  for (const [name, mutateReadiness] of cases) {
    const bad = structuredClone(mutant.proof);
    mutateReadiness(bad);
    const readinessResult = classifyM6ReadinessFaviconDisposition(bad,
      { candidateSha256: mutant.candidateSha }, mutant.buildReceipt);
    assert.equal(readinessResult.status, 'BLOCKED', `${name}: readiness`);
    const lifecycleResult = classifyM6LifecycleFaviconDisposition(lifecycle.receipt, lifecycle.summary,
      mutant.buildReceipt, lifecycle.faviconProbe, mutant.candidateSha, bad);
    assert.equal(lifecycleResult.status, 'BLOCKED', `${name}: lifecycle`);
  }
  const badLifecycleCases = [
    ['missing-required-asset-404', (l) => { l.receipt.networkEvidence.push({ status: 404, url: `${mutant.origin}/core-kit/missing.js` }); }],
    ['explicit-icon-request', (l) => { l.receipt.diagnostics.requestFailures.push({ url: `${mutant.origin}/favicon.ico?x=1` }); }],
    ['query', (l) => { l.faviconProbe.requestedUrl += '?cache=1'; }],
    ['redirect', (l) => { l.faviconProbe.redirected = true; }],
    ['cross-origin', (l) => { l.faviconProbe.url = 'https://example.test/favicon.ico'; }],
    ['favicon-500', (l) => { l.faviconProbe.statusCode = 500; }],
    ['get-mismatch', (l) => { l.faviconProbe.method = 'POST'; }],
    ['generic-second-console', (l) => { l.receipt.diagnostics.consoleErrors.push({ launch: 2, message: 'Unrelated', url: `${mutant.origin}/` }); }],
    ['missing-console-attribution', (l) => { delete l.receipt.diagnostics.consoleErrors[0].url; }],
    ['capture-overflow-or-exception', (l) => { l.receipt.diagnostics.captureErrors.push({ message: 'capture failed' }); }],
    ['timeout-or-cleanup-failure', (l) => { l.faviconProbe.cleanupErrors.push({ message: 'cleanup failed' }); }],
    ['wrong-candidate', (l) => { l.summary.candidate.sha256 = 'e'.repeat(64); }],
    ['wrong-build', (l) => { l.summary.buildEvidence.artifact.digest = 'e'.repeat(64); }],
    ['wrong-body-identity', (l) => { l.faviconProbe.bodySha256 = 'e'.repeat(64); }],
    ['wrong-body-byte-count', (l) => { l.faviconProbe.bodyByteCount = 10; }],
    ['owned-server-kill', (l) => { l.faviconProbe.serverExit.code = 1; l.faviconProbe.serverExit.signal = 'SIGKILL'; }],
    ['unexplained-nonzero-exit', (l) => { l.faviconProbe.serverExit.code = 1; l.faviconProbe.serverExit.signal = null; }],
    ['browser-exit-unobserved', (l) => { l.receipt.processEvidence[0].endpointReady = false; }],
  ];
  for (const [name, mutateLifecycle] of badLifecycleCases) {
    const bad = structuredClone(lifecycle);
    mutateLifecycle(bad);
    const result = classifyM6LifecycleFaviconDisposition(bad.receipt, bad.summary,
      bad.buildReceipt, bad.faviconProbe, mutant.candidateSha, mutant.proof, 'BEHAVIORAL_RED', bad.browserProvenance);
    assert.equal(result.status, 'BLOCKED', name);
  }
  const comparison = compareM6DiagnosticEvidence(mutant.proof, clean.proof);
  assert.equal(comparison.auxiliaryEvidenceParity, true);
});

test('M6 requires the frozen lifecycle Home/Open assertion plus clean independent HTTP/CDP readiness', () => {
  const identity = { candidateSha256: 'a'.repeat(64), patchSha256: 'b'.repeat(64), loaderSha256: 'c'.repeat(64) };
  const readiness = createM6ReadinessProof(identity);
  Object.assign(readiness, {
    httpIndexStatus: 200, productionAssetStatus: 200, browserNavigationStatus: 200,
    cdpReady: true, browserVersion: 'Chrome/136.0.0.0', coldHomeReady: true,
    assetInventoryVerification: { status: 'PASS' },
  });
  readiness.independentHttpGets.push({ name: 'production-favicon', requestedUrl: 'http://127.0.0.1:34701/favicon.ico',
    url: 'http://127.0.0.1:34701/favicon.ico', sameOrigin: true, method: 'GET', status: 200, redirected: false,
    bodyByteCount: 2, bodySha256: createHash('sha256').update('ok').digest('hex'), bodyText: 'ok' });
  readiness.diagnostics.responses.push(
    { url: 'http://127.0.0.1:34701/', status: 200, resourceType: 'document' },
    { url: 'http://127.0.0.1:34701/assets/index-app.js', status: 200, resourceType: 'script' },
  );
  assert.deepEqual(readiness.diagnostics.responseErrors, []);
  Object.assign(readiness, finalizeM6ReadinessProof(readiness));
  assert.equal(readiness.status, 'READINESS_PASS');
  const lifecycle = {
    status: 'BEHAVIORAL_RED', caseIds: [], expectedCaseIds: ['production-sales-edit-save-process-restart-reopen-edit-png'],
    base: '375d25ea12262bec32e2303b3c63662f0b69322f', phase: 'cold-Home-and-production-runtime',
    boundary: 'production lifecycle seed; setup/HTTP/browser errors are never mutant credit',
    error: { name: 'AssertionError', message: 'AssertionError [ERR_ASSERTION]: normal Home Sales Open is enabled when the production runtime is ready', stack: 'AssertionError [ERR_ASSERTION]: normal Home Sales Open is enabled when the production runtime is ready\n    at frozen lifecycle seed' },
    processEvidence: [{ launch: 1, pid: 1234, remoteDebuggingPort: 9222,
      profile: '/tmp/profile', endpointReady: true, browserVersion: 'Chrome/136.0.0.0' }],
    networkEvidence: [{ path: '/index.html', status: 200 }, { path: '/assets/index-app.js', status: 200 }],
    diagnostics: { pageErrors: [], consoleErrors: [], requestFailures: [], responseErrors: [] },
  };
  assert.equal(classifyM6ProductionProof(readiness, lifecycle, identity).status, 'BEHAVIORAL_RED');
  const cleanProcessShape = structuredClone(lifecycle);
  cleanProcessShape.processEvidence = [1, 2].map((launch) => ({ launch, endpointReady: true,
    browserVersion: 'Chrome/136.0.0.0', exit: { observed: true, code: 0, signal: null } }));
  assert.equal(classifyM6ProductionProof(readiness, cleanProcessShape, identity).status, 'BLOCKED',
    'a clean PASS process shape cannot stand in for the frozen early RED receipt');
  assert.equal(classifyM6ProductionProof({ ...readiness, httpIndexStatus: 404 }, lifecycle, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof({ ...readiness, diagnostics: { ...readiness.diagnostics, requestFailures: [{ url: '/unrelated' }] } }, lifecycle, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof({ ...readiness, diagnostics: { ...readiness.diagnostics, responses: [...readiness.diagnostics.responses, { status: 404 }] } }, lifecycle, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof({ ...readiness, diagnostics: { ...readiness.diagnostics, pageErrors: [{ message: 'unrelated' }] } }, lifecycle, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof(readiness, { ...lifecycle, error: { name: 'TimeoutError', message: 'Open timed out' } }, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof(readiness, { ...lifecycle, status: 'BLOCKED' }, identity).status, 'BLOCKED');
  assert.equal(Object.hasOwn(lifecycle.error, 'code'), false, 'frozen lifecycle serializes name/message/stack without an Error code field');
  assert.equal(classifyM6ProductionProof(readiness, { ...lifecycle, phase: 'served-artifact-identity' }, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof(readiness, { ...lifecycle, networkEvidence: [{ path: '/index.html', status: 404 }] }, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof(readiness, lifecycle, { ...identity, loaderSha256: null }).status, 'BLOCKED');
});
