import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  boundedM6ProbeBudget,
  cleanGateCandidateMatches,
  classifyM6ProductionProof,
  classifyMutationReceipt,
  executeFrozenSaveControl,
  reconcileHostedProductEvidence,
} from '../scripts/run-save-closure-mutations.mjs';

const currentCases = [
  'A-Date-only-normal-Save-fresh-reopen', 'B-same-table-Date-summary-refusal',
  'C-unrelated-Date-summary-refusal', 'C-empty-unrelated-Date-schema-refusal',
  'D-canonical-opaque-complete-copy-controls', 'E-CSV64-row-control', 'E-CSV16-column-control',
  'E-profile-refusal-rows-65.csv', 'E-profile-refusal-fields-17.csv',
  'F-existing-read-fault-no-publication-recovery', 'R-unchanged-private-reader-Date-fixture',
];

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

test('M6 requires the frozen lifecycle Home/Open assertion plus clean independent HTTP/CDP readiness', () => {
  const readiness = {
    status: 'READINESS_PASS', httpIndexStatus: 200, productionAssetStatus: 200, browserNavigationStatus: 200,
    cdpReady: true, browserVersion: 'Chrome/136.0.0.0', coldHomeReady: true,
    diagnostics: { pageErrors: [], consoleErrors: [], requestFailures: [], responseErrors: [], responses: [{ status: 200 }, { status: 200 }] },
  };
  const lifecycle = {
    status: 'BLOCKED_OR_FAIL', phase: 'cold-Home-and-production-runtime',
    error: { name: 'AssertionError', message: 'AssertionError [ERR_ASSERTION]: normal Home Sales Open is enabled when the production runtime is ready' },
    processEvidence: [{ endpointReady: true, browserVersion: 'Chrome/136.0.0.0' }],
    networkEvidence: [{ path: '/index.html', status: 200 }, { path: '/assets/index-app.js', status: 200 }],
    diagnostics: { pageErrors: [], consoleErrors: [], requestFailures: [], responseErrors: [] },
  };
  const identity = { candidateSha256: 'a'.repeat(64), patchSha256: 'b'.repeat(64), loaderSha256: 'c'.repeat(64) };
  assert.equal(classifyM6ProductionProof(readiness, lifecycle, identity).status, 'BEHAVIORAL_RED');
  assert.equal(classifyM6ProductionProof({ ...readiness, httpIndexStatus: 404 }, lifecycle, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof({ ...readiness, diagnostics: { ...readiness.diagnostics, requestFailures: [{ url: '/unrelated' }] } }, lifecycle, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof({ ...readiness, diagnostics: { ...readiness.diagnostics, responses: [...readiness.diagnostics.responses, { status: 404 }] } }, lifecycle, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof({ ...readiness, diagnostics: { ...readiness.diagnostics, pageErrors: [{ message: 'unrelated' }] } }, lifecycle, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof(readiness, { ...lifecycle, error: { name: 'TimeoutError', message: 'Open timed out' } }, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof(readiness, { ...lifecycle, phase: 'served-artifact-identity' }, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof(readiness, { ...lifecycle, networkEvidence: [{ path: '/index.html', status: 404 }] }, identity).status, 'BLOCKED');
  assert.equal(classifyM6ProductionProof(readiness, lifecycle, { ...identity, loaderSha256: null }).status, 'BLOCKED');
});
