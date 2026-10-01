import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  boundedM6ProbeBudget,
  attachM6BrowserNetworkDiagnostics,
  cleanGateCandidateMatches,
  classifyM6ProductionProof,
  classifyMutationReceipt,
  createM6ReadinessProof,
  executeFrozenSaveControl,
  finalizeM6ReadinessProof,
  recordM6ConsoleError,
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

test('M6 requires the frozen lifecycle Home/Open assertion plus clean independent HTTP/CDP readiness', () => {
  const identity = { candidateSha256: 'a'.repeat(64), patchSha256: 'b'.repeat(64), loaderSha256: 'c'.repeat(64) };
  const readiness = createM6ReadinessProof(identity);
  Object.assign(readiness, {
    httpIndexStatus: 200, productionAssetStatus: 200, browserNavigationStatus: 200,
    cdpReady: true, browserVersion: 'Chrome/136.0.0.0', coldHomeReady: true,
  });
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
    processEvidence: [{ launch: 1, pid: 1234, remoteDebuggingPort: 9222, profile: '/tmp/profile', endpointReady: true, browserVersion: 'Chrome/136.0.0.0' }],
    networkEvidence: [{ path: '/index.html', status: 200 }, { path: '/assets/index-app.js', status: 200 }],
    diagnostics: { pageErrors: [], consoleErrors: [], requestFailures: [], responseErrors: [] },
  };
  assert.equal(classifyM6ProductionProof(readiness, lifecycle, identity).status, 'BEHAVIORAL_RED');
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
