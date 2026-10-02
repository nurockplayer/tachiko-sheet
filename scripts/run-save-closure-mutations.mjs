// Serial, disposable #146 mutation qualification. Product faults exist only in
// short-lived Git worktrees and are restored before a clean rerun.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureRunnerCommand, createRunnerCancellation, startRunnerServer } from './runner-process-lifecycle.mjs';
import { readCommittedSourceIdentities } from './runner-source-identity.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = '375d25ea12262bec32e2303b3c63662f0b69322f';
const expectedHead = 'f6121d5bb5990b8cb9004062642aa2937fcfab4f';
const implementationPaths = [
  '.github/workflows/product.yml', 'docs/TEST-WIRING.md',
  'scripts/run-production-lifecycle.mjs', 'scripts/run-save-closure-acceptance.mjs',
  'scripts/run-save-closure-mutations.mjs', 'scripts/runner-source-identity.mjs',
  'tests/save-closure-mutations.test.mjs',
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
    assertionPattern: /Expected values to be strictly equal:[\s\S]*\+ undefined[\s\S]*- 'date-only\.csv'/,
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

export function executeFrozenSaveControl(source, { observations = [], infrastructureError = null } = {}) {
  if (infrastructureError) return { status: 'BLOCKED', reason: 'browser navigation or transport failed before the frozen Save observation resolved.', error: String(infrastructureError.message ?? infrastructureError) };
  const predicateMatch = source.match(/await activePage\.waitForFunction\(((?:\(\) => \{)[\s\S]*?\n  \})\);/);
  const assertionMatch = source.match(/assert\.equal\(save, "Saved on this device", "Save a copy must succeed and close the current Save dialog"\);/);
  if (!predicateMatch || !assertionMatch) return { status: 'BLOCKED', reason: 'the pinned amended M1 wait predicate or explicit Saved assertion was not found in the frozen source.' };
  let terminal = null;
  try {
    for (const observation of observations) {
      const document = { querySelector(selector) {
        if (selector === '[data-testid="save-status"]') return observation.status == null ? null : { textContent: observation.status };
        if (selector === '.ts-modal--save') return observation.saveDialogOpen ? {} : null;
        return null;
      } };
      if (vm.runInNewContext(`(${predicateMatch[1]})()`, { document })) { terminal = observation; break; }
    }
  } catch (error) {
    return { status: 'BLOCKED', reason: 'the frozen Save observation failed before terminal state.', error: `${error.name}: ${error.message}` };
  }
  if (!terminal) return { status: 'BLOCKED', reason: 'the frozen Save wait predicate remained nonterminal through its bounded observation window.' };
  const save = terminal.status;
  try {
    vm.runInNewContext(`(() => { const save = ${JSON.stringify(save)}; ${assertionMatch[0]} })()`, { assert });
    return { status: 'PASS', observed: save, saveDialogOpen: Boolean(terminal.saveDialogOpen), assertion: assertionMatch[0] };
  } catch (error) {
    if (save === 'Save failed' && error.code === 'ERR_ASSERTION') {
      return { status: 'BEHAVIORAL_RED', observed: save, saveDialogOpen: Boolean(terminal.saveDialogOpen), assertion: error.message };
    }
    return { status: 'BLOCKED', reason: 'the frozen Saved assertion failed for an observation other than its intended Save failed control.', error: `${error.name}: ${error.message}` };
  }
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

export function classifyM6ProductionProof(readiness, lifecycleReceipt, identity, auxiliaryContext = null) {
  const diagnostics = readiness?.diagnostics ?? {};
  const readinessHasFailures = (diagnostics.pageErrors?.length ?? 0) > 0
    || (diagnostics.requestFailures?.length ?? 0) > 0
    || (diagnostics.responseErrors?.length ?? 0) > 0
    || (diagnostics.consoleErrors?.length ?? 0) > 0
    || (diagnostics.responses ?? []).some((response) => response.status < 200 || response.status >= 400);
  const strictReadinessPass = readiness?.status === 'READINESS_PASS' && readiness.httpIndexStatus === 200
    && readiness.productionAssetStatus === 200 && readiness.browserNavigationStatus === 200
    && readiness.cdpReady === true && typeof readiness.browserVersion === 'string' && readiness.browserVersion.length > 0
    && readiness.coldHomeReady === true && !readinessHasFailures
    && /^[a-f0-9]{64}$/.test(identity?.candidateSha256 ?? '')
    && /^[a-f0-9]{64}$/.test(identity?.patchSha256 ?? '')
    && /^[a-f0-9]{64}$/.test(identity?.loaderSha256 ?? '');
  const disposition = auxiliaryContext?.disposition;
  const mutantReadyDisposition = classifyM6ReadinessFaviconDisposition(readiness, identity, auxiliaryContext?.mutantBuildReceipt);
  const mutantLifecycleDisposition = classifyM6LifecycleFaviconDisposition(lifecycleReceipt, auxiliaryContext?.mutantLifecycleSummary,
    auxiliaryContext?.mutantBuildReceipt, auxiliaryContext?.mutantLifecycleFaviconProbe, identity?.candidateSha256, readiness,
    'BEHAVIORAL_RED', auxiliaryContext?.mutantLifecycleBrowserProvenance);
  const auxiliaryAuthorized = disposition?.status === 'AUXILIARY_DEFAULT_FAVICON_404'
    && disposition.readinessRuleChanged === false && disposition.rawErrorsPreserved === true
    && disposition.mutantCandidateIdentity === identity?.candidateSha256
    && /^[a-f0-9]{64}$/.test(disposition.cleanCandidateIdentity ?? '')
    && disposition.mutantBuildDigest === auxiliaryContext?.mutantBuildReceipt?.artifact?.digest
    && /^[a-f0-9]{64}$/.test(disposition.cleanBuildDigest ?? '')
    && disposition.mutantReadiness?.status === 'AUXILIARY_CANDIDATE'
    && disposition.cleanReadiness?.status === 'AUXILIARY_CANDIDATE'
    && disposition.mutantLifecycle?.status === 'AUXILIARY_CANDIDATE'
    && disposition.cleanLifecycle?.status === 'AUXILIARY_CANDIDATE'
    && disposition.faviconParity === true
    && disposition.receipts?.mutantReadinessSha256 === auxiliaryContext?.mutantReadinessSha256
    && disposition.receipts?.mutantLifecycleReceiptSha256 === auxiliaryContext?.mutantLifecycleReceiptSha256
    && /^[a-f0-9]{64}$/.test(disposition.receipts?.cleanReadinessSha256 ?? '')
    && /^[a-f0-9]{64}$/.test(disposition.receipts?.cleanLifecycleReceiptSha256 ?? '')
    && /^[a-f0-9]{64}$/.test(auxiliaryContext?.mutantReadinessSha256 ?? '')
    && /^[a-f0-9]{64}$/.test(auxiliaryContext?.mutantLifecycleReceiptSha256 ?? '')
    && mutantReadyDisposition.status === 'AUXILIARY_CANDIDATE'
    && mutantLifecycleDisposition.status === 'AUXILIARY_CANDIDATE'
    && disposition.comparison?.auxiliaryEvidenceParity === true;
  const qualified = (strictReadinessPass || auxiliaryAuthorized)
    && /^[a-f0-9]{64}$/.test(identity?.candidateSha256 ?? '')
    && /^[a-f0-9]{64}$/.test(identity?.patchSha256 ?? '')
    && /^[a-f0-9]{64}$/.test(identity?.loaderSha256 ?? '');
  if (!qualified) return { status: 'BLOCKED', reason: 'Independent production HTTP, managed-browser, CDP and cold-Home readiness did not all qualify.' };
  const lifecycleDiagnostics = lifecycleReceipt?.diagnostics ?? {};
  const networkEvidence = lifecycleReceipt?.networkEvidence ?? [];
  const lifecycleHasErrors = (lifecycleDiagnostics.pageErrors?.length ?? 0) > 0
    || (lifecycleDiagnostics.requestFailures?.length ?? 0) > 0
    || (lifecycleDiagnostics.responseErrors?.length ?? 0) > 0
    || (lifecycleDiagnostics.consoleErrors?.length ?? 0) > 0
    || networkEvidence.some((response) => response.status !== 200);
  const lifecycleAuxiliaryAuthorized = auxiliaryAuthorized && lifecycleHasErrors
    && mutantLifecycleDisposition.status === 'AUXILIARY_CANDIDATE';
  if ((lifecycleHasErrors && !lifecycleAuxiliaryAuthorized) || networkEvidence.some((response) => response.status !== 200)) {
    return { status: 'BLOCKED', reason: 'Frozen lifecycle raw evidence includes an HTTP/request/page error.' };
  }
  const expectedAssertion = 'normal Home Sales Open is enabled when the production runtime is ready';
  if (lifecycleReceipt?.status !== 'BEHAVIORAL_RED' || lifecycleReceipt?.phase !== 'cold-Home-and-production-runtime'
    || lifecycleReceipt?.base !== base || lifecycleReceipt?.boundary !== 'production lifecycle seed; setup/HTTP/browser errors are never mutant credit'
    || !Array.isArray(lifecycleReceipt.caseIds) || lifecycleReceipt.caseIds.length !== 0
    || JSON.stringify(lifecycleReceipt.expectedCaseIds) !== JSON.stringify([productionCase])
    || lifecycleReceipt?.error?.name !== 'AssertionError' || !lifecycleReceipt.error.message?.includes(expectedAssertion)) {
    return { status: 'BLOCKED', reason: 'The frozen production lifecycle did not fail at its exact Home/Open runtime assertion.' };
  }
  const processEvidenceValid = Array.isArray(lifecycleReceipt.processEvidence) && lifecycleReceipt.processEvidence.length === 1
    && lifecycleReceipt.processEvidence[0]?.launch === 1
    && lifecycleReceipt.processEvidence[0].endpointReady === true && Boolean(lifecycleReceipt.processEvidence[0].browserVersion)
    && !Object.hasOwn(lifecycleReceipt.processEvidence[0], 'exit');
  if (!processEvidenceValid) return { status: 'BLOCKED', reason: 'The frozen lifecycle raw receipt does not match its qualified status-specific browser process shape.' };
  return { status: 'BEHAVIORAL_RED', assertion: expectedAssertion, phase: lifecycleReceipt.phase, error: lifecycleReceipt.error };
}

export function boundedM6ProbeBudget(remainingMs, reserveMs = 90_000, maximumMs = 45_000, minimumMs = 10_000) {
  const budgetMs = Math.min(maximumMs, remainingMs - reserveMs);
  return budgetMs >= minimumMs ? budgetMs : null;
}

export function createM6OperationTimeout(deadlineMs, now = () => Date.now()) {
  return (maximumMs) => {
    if (!Number.isFinite(maximumMs) || maximumMs < 1) {
      throw new TypeError('M6 operation timeout requires a finite positive maximum.');
    }
    const remaining = Math.min(maximumMs, deadlineMs - now());
    if (remaining < 1) throw new Error('BLOCKED: M6 readiness probe exhausted its absolute budget.');
    return remaining;
  };
}

export function cleanGateCandidateMatches(candidate, expected, archivedProductEvidence = []) {
  if (!candidate || candidate.base !== expected?.base || candidate.head !== expected?.head
    || JSON.stringify(candidate.committedFiles) !== JSON.stringify(expected?.committedFiles)) return false;
  if (candidate.sha256 === expected.sha256) return true;
  const dirty = candidate.dirtyFiles;
  if (!Array.isArray(dirty) || !dirty.length || !Array.isArray(archivedProductEvidence)) return false;
  const archived = new Map(archivedProductEvidence);
  return dirty.every(([file, hash]) => file.startsWith('evidence/product-acceptance/')
    && archived.get(file.slice('evidence/product-acceptance/'.length)) === hash);
}

export function createM6ReadinessProof(mutationIdentity, { candidateKind = 'mutant', buildDigest = null } = {}) {
  return {
    status: 'BLOCKED', startedAt: nowIso(), httpIndexStatus: null, productionAssetStatus: null,
    cdpReady: false, browserVersion: null, coldHomeReady: false, browserNavigationStatus: null,
    candidateKind, candidateIdentity: mutationIdentity.candidateSha256, buildDigest,
    mutantCandidateIdentity: candidateKind === 'mutant' ? mutationIdentity.candidateSha256 : null,
    mutationPatchSha256: mutationIdentity.patchSha256 ?? null,
    mutatedLoaderSha256: mutationIdentity.loaderSha256 ?? null,
    independentHttpGets: [], assetInventoryVerification: null, sourceIconAudit: null,
    emittedHtmlAudit: null, hookFreeControl: null,
    diagnostics: { requests: [], pageErrors: [], consoleErrors: [], requestFailures: [], responseErrors: [], responses: [], captureErrors: [], droppedEvents: 0 },
  };
}

const M6_ICON_TEXT_PATTERNS = [
  { name: 'favicon-literal', expression: /favicon/gi },
  { name: 'ico-literal', expression: /\.ico(?:[?#"'`\s]|$)/gi },
  { name: 'icon-link', expression: /<link\b[^>]*\brel\s*=\s*["'][^"']*\bicon\b/gi },
];

export function findM6IconReferences(text, source) {
  const matches = [];
  for (const { name, expression } of M6_ICON_TEXT_PATTERNS) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      const start = Math.max(0, match.index - 60);
      const end = Math.min(text.length, match.index + match[0].length + 60);
      matches.push({ source, kind: name, text: text.slice(start, end) });
      if (matches.length >= 50) return matches;
    }
  }
  return matches;
}

export function qualifyM6AssetInventory(receipt, observedRows) {
  const files = receipt?.artifact?.files;
  const digest = Array.isArray(files) ? bytesHash(Buffer.from(JSON.stringify(files))) : null;
  const errors = [];
  if (receipt?.status !== 'PASS' || !Array.isArray(files) || digest !== receipt?.artifact?.digest) {
    errors.push({ kind: 'recorded-build-inventory-invalid', expectedDigest: receipt?.artifact?.digest ?? null, recomputedDigest: digest });
  }
  const expected = new Map();
  for (const row of Array.isArray(files) ? files : []) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !/^[a-f0-9]{64}$/.test(row[1]) || expected.has(row[0])) {
      errors.push({ kind: 'recorded-build-inventory-row-invalid', row });
      continue;
    }
    expected.set(row[0], row[1]);
  }
  const observed = new Map();
  for (const row of Array.isArray(observedRows) ? observedRows : []) {
    if (!row || typeof row.path !== 'string' || observed.has(row.path)) {
      errors.push({ kind: 'observed-asset-row-invalid-or-duplicate', path: row?.path ?? null });
      continue;
    }
    observed.set(row.path, row);
  }
  for (const [file, sha256] of expected) {
    const row = observed.get(file);
    if (!row) errors.push({ kind: 'asset-not-fetched', path: file });
    else if (row.status !== 200 || row.bodySha256 !== sha256) {
      errors.push({ kind: 'served-asset-differs-from-recorded-build', path: file, status: row.status, expectedSha256: sha256, observedSha256: row.bodySha256 ?? null });
    }
  }
  for (const file of observed.keys()) if (!expected.has(file)) errors.push({ kind: 'unrecorded-asset-fetched', path: file });
  return {
    status: errors.length === 0 && expected.size > 0 ? 'PASS' : 'BLOCKED',
    recordedArtifactDigest: receipt?.artifact?.digest ?? null,
    recomputedArtifactDigest: digest,
    expectedFileCount: expected.size,
    observedFileCount: observed.size,
    expectedFiles: [...expected].map(([path, sha256]) => ({ path, sha256 })),
    observedRows,
    errors,
  };
}

function m6FaviconTuple(proof) {
  const row = (proof?.independentHttpGets ?? []).find((item) => item.name === 'production-favicon');
  return row && { requestedPath: new URL(row.requestedUrl).pathname, responsePath: new URL(row.url).pathname, sameOrigin: row.sameOrigin,
    method: row.method, status: row.status, redirected: row.redirected ?? null, contentType: row.contentType ?? null,
    bodyByteCount: row.bodyByteCount, bodySha256: row.bodySha256, bodyText: row.bodyText };
}

function m6BlankControlTuple(proof) {
  const control = proof?.hookFreeControl;
  const diagnostics = control?.diagnostics ?? {};
  const pathOf = (url) => {
    if (!url) return url ?? null;
    try { return new URL(url).pathname; } catch { return url; }
  };
  return control && {
    status: control.status,
    browserVersion: control.browserVersion,
    outerHtml: control.domAudit?.outerHtml ?? null,
    htmlByteCount: control.domAudit?.htmlByteCount ?? null,
    htmlSha256: control.domAudit?.htmlSha256 ?? null,
    scriptCount: control.domAudit?.scriptCount ?? null,
    links: control.domAudit?.links ?? null,
    serverRequests: (control.serverRequests ?? []).map((row) => ({ method: row.method, path: row.path, status: row.status,
      contentType: row.contentType, bodyByteCount: row.bodyByteCount, bodySha256: row.bodySha256, bodyText: row.bodyText })),
    diagnostics: {
      requests: (diagnostics.requests ?? []).map((row) => ({ path: pathOf(row.url), method: row.method, resourceType: row.resourceType, source: row.source })),
      requestFailures: (diagnostics.requestFailures ?? []).map((row) => ({ path: pathOf(row.url), method: row.method, resourceType: row.resourceType, source: row.source, error: row.error })),
      responses: (diagnostics.responses ?? []).map((row) => ({ path: pathOf(row.url), status: row.status, resourceType: row.resourceType, method: row.method, contentType: row.contentType, source: row.source })),
      responseErrors: (diagnostics.responseErrors ?? []).map((row) => ({ ...row, url: undefined, path: pathOf(row.url) })),
      consoleErrors: (diagnostics.consoleErrors ?? []).map((row) => ({ type: row.type, message: row.message, path: pathOf(row.location?.url), lineNumber: row.location?.lineNumber ?? null, columnNumber: row.location?.columnNumber ?? null })),
      pageErrors: (diagnostics.pageErrors ?? []).map((row) => ({ message: row.message })),
      captureErrors: diagnostics.captureErrors ?? [], droppedEvents: diagnostics.droppedEvents ?? 0,
    },
  };
}

export function compareM6DiagnosticEvidence(mutant, clean) {
  const mutantFavicon = m6FaviconTuple(mutant);
  const cleanFavicon = m6FaviconTuple(clean);
  const mutantControl = m6BlankControlTuple(mutant);
  const cleanControl = m6BlankControlTuple(clean);
  const mutantAssets = mutant?.assetInventoryVerification;
  const cleanAssets = clean?.assetInventoryVerification;
  const mutantRows = new Map((mutantAssets?.expectedFiles ?? []).map((row) => [row.path, row.sha256]));
  const cleanRows = new Map((cleanAssets?.expectedFiles ?? []).map((row) => [row.path, row.sha256]));
  const mutantEntry = mutant?.productionEntryAssetPath ?? null;
  const cleanEntry = clean?.productionEntryAssetPath ?? null;
  const ignored = new Set([mutantEntry?.replace(/^\//, ''), cleanEntry?.replace(/^\//, '')].filter(Boolean));
  const shared = [...mutantRows.keys()].filter((file) => cleanRows.has(file) && !ignored.has(file) && file !== 'index.html');
  const assetDifferences = [];
  for (const file of shared) if (mutantRows.get(file) !== cleanRows.get(file)) assetDifferences.push(file);
  const nonEntryOnlyMutant = [...mutantRows.keys()].filter((file) => !cleanRows.has(file) && !ignored.has(file));
  const nonEntryOnlyClean = [...cleanRows.keys()].filter((file) => !mutantRows.has(file) && !ignored.has(file));
  const requiredCoreAssets = shared.filter((file) => file.startsWith('core-kit/'));
  const sourceClean = (proof) => proof?.sourceIconAudit?.status === 'PASS'
    && (proof.sourceIconAudit.references ?? []).length === 0;
  const emittedClean = (proof) => proof?.emittedHtmlAudit?.status === 'PASS'
    && (proof.emittedHtmlAudit.references ?? []).length === 0
    && (proof.emittedHtmlAudit.domAudit?.iconLinks ?? []).length === 0;
  const controlComplete = (control) => control?.status === 'CONTROL_OBSERVED'
    && control.browserVersion && control.domAudit?.scriptCount === 0
    && Array.isArray(control.domAudit.links) && control.domAudit.links.length === 0
    && (control.serverRequests ?? []).some((row) => row.method === 'GET' && row.path === '/favicon.ico' && row.status === 404);
  const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const faviconParity = Boolean(mutantFavicon && cleanFavicon && sameJson(mutantFavicon, cleanFavicon));
  const controlParity = Boolean(mutantControl && cleanControl && sameJson(mutantControl, cleanControl));
  const browserParity = Boolean(mutant?.browserVersion && mutant.browserVersion === clean?.browserVersion);
  const exactIndex = (proof, entryPath) => {
    const row = proof?.independentHttpGets?.find((item) => item.name === 'production-index');
    const origin = m6ReadinessOrigin(proof);
    const entry = normalizedLifecycleAssetPath(entryPath);
    if (!row || !origin || !entry || row.url !== `${origin}/` || row.method !== 'GET' || row.status !== 200
      || typeof row.bodyText !== 'string' || Buffer.byteLength(row.bodyText, 'utf8') !== row.bodyByteCount
      || bytesHash(Buffer.from(row.bodyText, 'utf8')) !== row.bodySha256
      || row.bodyByteCount !== proof.emittedHtmlAudit?.byteCount || row.bodySha256 !== proof.emittedHtmlAudit?.sha256) return null;
    const scriptTags = [...row.bodyText.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>\s*<\/script\s*>/gi)];
    if (scriptTags.length !== 1 || scriptTags[0][2] !== entryPath) return null;
    const normalized = row.bodyText.replace(scriptTags[0][0], scriptTags[0][0].replace(scriptTags[0][2], '<QUALIFIED-PRODUCTION-ENTRY>'));
    return { normalized, sha256: row.bodySha256, byteCount: row.bodyByteCount, entryPath };
  };
  const mutantIndex = exactIndex(mutant, mutantEntry);
  const cleanIndex = exactIndex(clean, cleanEntry);
  const indexHtmlParity = Boolean(mutantIndex && cleanIndex && mutantRows.get('index.html') === mutantIndex.sha256
    && cleanRows.get('index.html') === cleanIndex.sha256 && mutantIndex.normalized === cleanIndex.normalized);
  const normalizePath = (url, entryPath) => {
    if (!url) return url ?? null;
    try {
      const parsed = new URL(url);
      return parsed.pathname === entryPath ? '<production-entry>' : parsed.pathname;
    } catch { return url; }
  };
  const normalizeDiagnostics = (proof) => {
    const entry = proof?.productionEntryAssetPath ?? null;
    const diagnostics = proof?.diagnostics ?? {};
    return {
      requests: (diagnostics.requests ?? []).map((row) => ({ path: normalizePath(row.url, entry), method: row.method, resourceType: row.resourceType, source: row.source })),
      requestFailures: (diagnostics.requestFailures ?? []).map((row) => ({ path: normalizePath(row.url, entry), method: row.method, resourceType: row.resourceType, source: row.source, error: row.error })),
      responses: (diagnostics.responses ?? []).map((row) => ({ path: normalizePath(row.url, entry), status: row.status, resourceType: row.resourceType, method: row.method, contentType: row.contentType, source: row.source })),
      responseErrors: (diagnostics.responseErrors ?? []).map((row) => ({ ...row, url: undefined, path: normalizePath(row.url, entry) })),
      consoleErrors: (diagnostics.consoleErrors ?? []).map((row) => ({ message: row.message, path: normalizePath(row.location?.url, entry), lineNumber: row.location?.lineNumber ?? null, columnNumber: row.location?.columnNumber ?? null })),
      pageErrors: (diagnostics.pageErrors ?? []).map((row) => ({ message: row.message })),
      captureErrors: diagnostics.captureErrors ?? [], droppedEvents: diagnostics.droppedEvents ?? 0,
    };
  };
  const mutantDiagnostics = normalizeDiagnostics(mutant);
  const cleanDiagnostics = normalizeDiagnostics(clean);
  const productDiagnosticsParity = sameJson(mutantDiagnostics, cleanDiagnostics);
  const artifactParity = mutantAssets?.status === 'PASS' && cleanAssets?.status === 'PASS' && indexHtmlParity
    && assetDifferences.length === 0 && nonEntryOnlyMutant.length === 0 && nonEntryOnlyClean.length === 0;
  const auxiliaryEvidenceParity = faviconParity && controlParity && browserParity && artifactParity
    && sourceClean(mutant) && sourceClean(clean) && emittedClean(mutant) && emittedClean(clean)
    && controlComplete(mutant?.hookFreeControl) && controlComplete(clean?.hookFreeControl);
  const complete = faviconParity && controlParity && browserParity && productDiagnosticsParity && artifactParity
    && sourceClean(mutant) && sourceClean(clean) && emittedClean(mutant) && emittedClean(clean)
    && controlComplete(mutant?.hookFreeControl) && controlComplete(clean?.hookFreeControl);
  return {
    status: complete ? 'OBSERVED_PARITY' : 'INCOMPLETE_OR_DIFFERENT',
    readinessRuleChanged: false,
    mutantCandidateIdentity: mutant?.candidateIdentity ?? null,
    cleanCandidateIdentity: clean?.candidateIdentity ?? null,
    browserParity,
    productDiagnosticsParity,
    auxiliaryEvidenceParity,
    normalizedProductDiagnostics: { mutant: mutantDiagnostics, clean: cleanDiagnostics },
    faviconParity,
    favicon: { mutant: mutantFavicon, clean: cleanFavicon },
    hookFreeControl: { mutant: mutantControl, clean: cleanControl, parity: controlParity },
    sourceAudit: { mutant: mutant?.sourceIconAudit ?? null, clean: clean?.sourceIconAudit ?? null },
    emittedDomAudit: { mutant: mutant?.emittedHtmlAudit ?? null, clean: clean?.emittedHtmlAudit ?? null },
    artifactParity: {
      matchedSharedAssetCount: shared.length,
      requiredCoreKitAssetCount: requiredCoreAssets.length,
      changedSharedAssets: assetDifferences,
      indexHtmlParity,
      mutantIndexHtmlSha256: mutantIndex?.sha256 ?? null,
      cleanIndexHtmlSha256: cleanIndex?.sha256 ?? null,
      mutantOnlyAssets: nonEntryOnlyMutant,
      cleanOnlyAssets: nonEntryOnlyClean,
      mutantBuildDigest: mutantAssets?.recordedArtifactDigest ?? null,
      cleanBuildDigest: cleanAssets?.recordedArtifactDigest ?? null,
    },
  };
}

const MAX_M6_DIAGNOSTIC_ENTRIES = 200;

function appendM6Diagnostic(proof, collection, entry) {
  const rows = proof?.diagnostics?.[collection];
  if (!Array.isArray(rows)) {
    if (proof?.diagnostics) proof.diagnostics.captureErrors = [...(proof.diagnostics.captureErrors ?? []), { collection, message: 'diagnostic collection is unavailable' }];
    return false;
  }
  if (rows.length >= MAX_M6_DIAGNOSTIC_ENTRIES) {
    proof.diagnostics.droppedEvents = (proof.diagnostics.droppedEvents ?? 0) + 1;
    return false;
  }
  rows.push(entry);
  return true;
}

function callOrValue(object, key) {
  const value = object?.[key];
  return typeof value === 'function' ? value.call(object) : value;
}

function m6RequestDetails(request) {
  return {
    url: callOrValue(request, 'url') ?? null,
    method: callOrValue(request, 'method') ?? null,
    resourceType: callOrValue(request, 'resourceType') ?? null,
  };
}

export function recordM6RequestDiagnostic(proof, request, { source = 'browser-context' } = {}) {
  try {
    const details = m6RequestDetails(request);
    appendM6Diagnostic(proof, 'requests', { ...details, source });
    if (!details.url || !details.method || !details.resourceType) {
      appendM6Diagnostic(proof, 'captureErrors', { kind: 'request-attribution-incomplete', ...details });
    }
    return details;
  } catch (error) {
    appendM6Diagnostic(proof, 'captureErrors', { kind: 'request-capture-error', message: error.message });
    return null;
  }
}

export function recordM6RequestFailure(proof, request, { source = 'browser-context' } = {}) {
  try {
    const details = m6RequestDetails(request);
    appendM6Diagnostic(proof, 'requestFailures', {
      ...details,
      source,
      error: callOrValue(request, 'failure')?.errorText ?? callOrValue(request, 'failure') ?? null,
    });
    if (!details.url || !details.method || !details.resourceType) {
      appendM6Diagnostic(proof, 'captureErrors', { kind: 'failed-request-attribution-incomplete', ...details });
    }
  } catch (error) {
    appendM6Diagnostic(proof, 'captureErrors', { kind: 'request-failure-capture-error', message: error.message });
  }
}

export function attachM6BrowserNetworkDiagnostics(context, proof) {
  context.on('request', (request) => { recordM6RequestDiagnostic(proof, request); });
  context.on('requestfailed', (request) => { recordM6RequestFailure(proof, request); });
  context.on('response', (response) => { recordM6ResponseDiagnostic(proof, response); });
}

export function recordM6PageError(proof, error) {
  appendM6Diagnostic(proof, 'pageErrors', {
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  });
}

export function recordM6ResponseDiagnostic(proof, response, { source = 'browser-context', resourceType = null, method = null } = {}) {
  let entry;
  try {
    const request = callOrValue(response, 'request');
    const headers = callOrValue(response, 'headers');
    const contentType = typeof headers?.get === 'function' ? headers.get('content-type')
      : headers?.['content-type'] ?? headers?.['Content-Type'] ?? null;
    entry = {
      url: callOrValue(response, 'url') ?? null,
      status: Number(callOrValue(response, 'status')),
      resourceType: callOrValue(request, 'resourceType') ?? resourceType,
      method: callOrValue(request, 'method') ?? method,
      contentType,
      source,
    };
    appendM6Diagnostic(proof, 'responses', entry);
    if (!entry.url || !Number.isInteger(entry.status) || !entry.resourceType) {
      appendM6Diagnostic(proof, 'captureErrors', { kind: 'response-attribution-incomplete', ...entry });
    }
    if (Number.isInteger(entry.status) && (entry.status < 200 || entry.status >= 400)) {
      appendM6Diagnostic(proof, 'responseErrors', { kind: 'http-status', ...entry });
    }
    return entry;
  } catch (error) {
    appendM6Diagnostic(proof, 'responseErrors', { kind: 'response-capture-error', source, message: error.message });
    return null;
  }
}

export function recordM6ConsoleError(proof, message) {
  try {
    if (callOrValue(message, 'type') !== 'error') return null;
    const location = callOrValue(message, 'location') ?? {};
    const entry = {
      message: callOrValue(message, 'text') ?? '',
      location: {
        url: location.url ?? null,
        lineNumber: Number.isInteger(location.lineNumber) ? location.lineNumber : null,
        columnNumber: Number.isInteger(location.columnNumber) ? location.columnNumber : null,
      },
    };
    appendM6Diagnostic(proof, 'consoleErrors', entry);
    if (!entry.message) appendM6Diagnostic(proof, 'captureErrors', { kind: 'console-attribution-incomplete', location: entry.location });
    return entry;
  } catch (error) {
    appendM6Diagnostic(proof, 'captureErrors', { kind: 'console-capture-error', message: error.message });
    return null;
  }
}

export function finalizeM6ReadinessProof(proof) {
  const diagnostics = proof?.diagnostics ?? {};
  const independentHttpErrors = (proof?.independentHttpGets ?? []).some((row) => row.status < 200 || row.status >= 400);
  const faviconGet = (proof?.independentHttpGets ?? []).find((row) => row.name === 'production-favicon');
  const faviconCaptureIncomplete = !faviconGet || faviconGet.sameOrigin !== true || faviconGet.method !== 'GET'
    || faviconGet.redirected !== false || !Number.isSafeInteger(faviconGet.bodyByteCount)
    || !/^[a-f0-9]{64}$/.test(faviconGet.bodySha256 ?? '') || typeof faviconGet.bodyText !== 'string';
  const assetInventoryInvalid = proof?.assetInventoryVerification?.status !== 'PASS';
  const failure = proof?.httpIndexStatus !== 200 || proof?.productionAssetStatus !== 200 || proof?.browserNavigationStatus !== 200
    || proof?.cdpReady !== true || !proof?.browserVersion || proof?.coldHomeReady !== true
    || independentHttpErrors || faviconCaptureIncomplete || assetInventoryInvalid
    || (diagnostics.pageErrors?.length ?? 0) > 0 || (diagnostics.consoleErrors?.length ?? 0) > 0
    || (diagnostics.requestFailures?.length ?? 0) > 0 || (diagnostics.responseErrors?.length ?? 0) > 0
    || (diagnostics.captureErrors?.length ?? 0) > 0 || (diagnostics.droppedEvents ?? 0) > 0
    || !(diagnostics.responses ?? []).length
    || (diagnostics.responses ?? []).some((response) => !response.url || !Number.isInteger(response.status)
      || !response.resourceType || response.status < 200 || response.status >= 400);
  return failure
    ? { status: 'BLOCKED', reason: 'Independent cold-Home readiness contained an HTTP, request, response, console, page or CDP error.' }
    : { status: 'READINESS_PASS', reason: null };
}

const M6_FAVICON_404_CONSOLE_MESSAGE = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

function exactM6LocalOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port
      && !parsed.username && !parsed.password && parsed.origin === value ? parsed.origin : null;
  } catch { return null; }
}

function exactM6FaviconUrl(value, origin) {
  try {
    const parsed = new URL(value);
    return parsed.origin === origin && parsed.pathname === '/favicon.ico' && parsed.search === '' && parsed.hash === ''
      && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

function validM6FaviconFetch(row, origin) {
  const target = `${origin}/favicon.ico`;
  return Boolean(row && row.method === 'GET' && row.requestedUrl === target && row.url === target
    && exactM6FaviconUrl(row.requestedUrl, origin) === target && exactM6FaviconUrl(row.url, origin) === target
    && row.sameOrigin === true && row.redirected === false
    && (typeof row.status === 'number' ? row.status : row.statusCode) === 404
    && Number.isSafeInteger(row.bodyByteCount) && row.bodyByteCount > 0 && row.bodyByteCount <= 64 * 1024
    && /^[a-f0-9]{64}$/.test(row.bodySha256 ?? '') && typeof row.bodyText === 'string'
    && row.bodyText.length <= 64 * 1024 && Buffer.byteLength(row.bodyText, 'utf8') === row.bodyByteCount
    && bytesHash(Buffer.from(row.bodyText, 'utf8')) === row.bodySha256);
}

function onlyM6FaviconConsoleError(rows, target, { launches = null } = {}) {
  return Array.isArray(rows) && rows.length > 0 && rows.every((row) => row.message === M6_FAVICON_404_CONSOLE_MESSAGE
    && row.location?.url === target && row.location?.lineNumber === 0 && row.location?.columnNumber === 0
    && (!launches || launches.includes(row.launch)))
    && (!launches || JSON.stringify([...new Set(rows.map((row) => row.launch))].sort()) === JSON.stringify([...launches].sort()));
}

function noM6OtherDiagnostics(diagnostics, { allowedConsole = false } = {}) {
  return ['pageErrors', 'requestFailures', 'responseErrors', 'captureErrors', 'consoleErrors'].every((key) =>
    Array.isArray(diagnostics?.[key]))
    && diagnostics.pageErrors.length === 0 && diagnostics.requestFailures.length === 0
    && diagnostics.responseErrors.length === 0 && diagnostics.captureErrors.length === 0
    && Number.isSafeInteger(diagnostics.droppedEvents) && diagnostics.droppedEvents === 0
    && (allowedConsole || diagnostics.consoleErrors.length === 0);
}

function inventoryRowsMatch(receipt, observed, origin) {
  const files = receipt?.artifact?.files;
  if (receipt?.status !== 'PASS' || !Array.isArray(files) || !files.every((row) => Array.isArray(row) && row.length === 2
    && typeof row[0] === 'string' && /^[a-f0-9]{64}$/.test(row[1])) || !Array.isArray(observed)
    || receipt.artifact.digest !== bytesHash(Buffer.from(JSON.stringify(files)))) return false;
  const expected = new Map(files);
  if (expected.size !== files.length || expected.size < 1 || expected.size > 200) return false;
  if (!observed.every((item) => item && typeof item.path === 'string' && item.method === 'GET'
    && item.url === new URL(`/${item.path.split('/').map(encodeURIComponent).join('/')}`, origin).href
    && Number.isInteger(item.status) && /^[a-f0-9]{64}$/.test(item.bodySha256 ?? ''))) return false;
  const rows = new Map(observed.map((item) => [item.path, item]));
  if (rows.size !== observed.length || rows.size !== expected.size) return false;
  return [...expected].every(([file, sha256]) => rows.get(file)?.status === 200 && rows.get(file)?.bodySha256 === sha256)
    && ![...expected.keys()].some((file) => /(?:^|\/)(?:favicon(?:\.[^/]*)?|[^/]+\.ico)$/i.test(file));
}

function m6ReadinessOrigin(proof) {
  const index = (proof?.independentHttpGets ?? []).find((row) => row.name === 'production-index');
  try { return index ? exactM6LocalOrigin(new URL(index.url).origin) : null; } catch { return null; }
}

export function classifyM6ReadinessFaviconDisposition(proof, identity, buildReceipt) {
  const origin = m6ReadinessOrigin(proof);
  const target = origin && `${origin}/favicon.ico`;
  const gets = proof?.independentHttpGets ?? [];
  const favicon = gets.find((row) => row.name === 'production-favicon');
  const control = proof?.hookFreeControl;
  let controlOrigin = null;
  try { if (control?.domAudit?.url) controlOrigin = exactM6LocalOrigin(new URL(control.domAudit.url).origin); } catch {}
  const controlFavicon = controlOrigin && `${controlOrigin}/favicon.ico`;
  const controlRoot = (control?.serverRequests ?? []).find((row) => row.method === 'GET' && row.path === '/');
  const controlIcon = (control?.serverRequests ?? []).filter((row) => row.path?.split('?')[0] === '/favicon.ico');
  const sourceClear = proof?.sourceIconAudit?.status === 'PASS' && Array.isArray(proof.sourceIconAudit.references)
    && proof.sourceIconAudit.references.length === 0 && Array.isArray(proof.sourceIconAudit.sourceFiles)
    && proof.sourceIconAudit.sourceFiles.length > 0;
  const emitted = proof?.emittedHtmlAudit;
  const recordedFiles = buildReceipt?.artifact?.files;
  const expectedScripts = Array.isArray(recordedFiles) ? recordedFiles.filter((row) => Array.isArray(row)
    && typeof row[0] === 'string' && /\.m?js$/i.test(row[0])) : [];
  const emittedScripts = emitted?.scriptAssets ?? [];
  const expectedScriptMap = new Map(expectedScripts);
  const emittedScriptMap = new Map(Array.isArray(emittedScripts) ? emittedScripts.filter((row) => row && typeof row.path === 'string').map((row) => [row.path, row]) : []);
  const emittedScriptsBound = expectedScripts.length > 0 && Array.isArray(emittedScripts) && emittedScriptMap.size === expectedScripts.length
    && emittedScripts.length === expectedScripts.length && [...expectedScriptMap].every(([file, sha256]) => {
      const row = emittedScriptMap.get(file);
      return row?.sha256 === sha256 && row.expectedSha256 === sha256 && Array.isArray(row.references);
    })
    && emitted?.entryScriptAudit?.path === proof?.productionEntryAssetPath?.replace(/^\//, '')
    && emitted.entryScriptAudit.sha256 === expectedScriptMap.get(proof.productionEntryAssetPath?.replace(/^\//, ''))
    && emitted.entryScriptAudit.expectedSha256 === emitted.entryScriptAudit.sha256
    && Array.isArray(emitted.entryScriptAudit.references)
    && emitted.byteCount === (proof.independentHttpGets ?? []).find((row) => row.name === 'production-index')?.bodyByteCount
    && emitted.sha256 === (proof.independentHttpGets ?? []).find((row) => row.name === 'production-index')?.bodySha256;
  const emittedClear = emitted?.status === 'PASS' && Array.isArray(emitted.references) && emitted.references.length === 0
    && emittedScriptsBound && Array.isArray(emitted.scriptAssets)
    && emitted.scriptAssets.every((row) => Array.isArray(row.references) && row.references.length === 0)
    && Array.isArray(emitted.domAudit?.references) && Array.isArray(emitted.domAudit?.iconLinks)
    && emittedScriptsBound
    && emitted.domAudit.references.length === 0 && emitted.domAudit.iconLinks.length === 0;
  const expectedConsole = onlyM6FaviconConsoleError(proof?.diagnostics?.consoleErrors, target)
    && proof.diagnostics.consoleErrors.length === 1
    && noM6OtherDiagnostics(proof?.diagnostics, { allowedConsole: true });
  const controlConsole = onlyM6FaviconConsoleError(control?.diagnostics?.consoleErrors, controlFavicon)
    && control.diagnostics.consoleErrors.length === 1
    && noM6OtherDiagnostics(control?.diagnostics, { allowedConsole: true });
  const controlNetwork = Array.isArray(control?.diagnostics?.requests) && control.diagnostics.requests.length === 1
    && control.diagnostics.requests[0].url === `${controlOrigin}/` && control.diagnostics.requests[0].method === 'GET'
    && control.diagnostics.requests[0].resourceType === 'document'
    && Array.isArray(control?.diagnostics?.responses) && control.diagnostics.responses.length === 1
    && control.diagnostics.responses[0].url === `${controlOrigin}/` && control.diagnostics.responses[0].status === 200
    && control.diagnostics.responses[0].method === 'GET' && control.diagnostics.responses[0].resourceType === 'document';
  const controlValid = control?.status === 'CONTROL_OBSERVED' && control.browserVersion === proof?.browserVersion
    && !control.closeError && !control.serverCloseError
    && control.browserFaviconRequestObserved === true
    && control.navigationStatus === 200
    && controlNetwork
    && control.domAudit?.scriptCount === 0 && Array.isArray(control.domAudit?.links) && control.domAudit.links.length === 0
    && Array.isArray(control.domAudit?.iconLinks) && control.domAudit.iconLinks.length === 0
    && Array.isArray(control.domAudit?.references) && control.domAudit.references.length === 0
    && typeof control.domAudit?.outerHtml === 'string' && Buffer.byteLength(control.domAudit.outerHtml) === control.domAudit.htmlByteCount
    && bytesHash(Buffer.from(control.domAudit.outerHtml)) === control.domAudit.htmlSha256
    && (control.serverRequests ?? []).length === 2
    && controlRoot?.status === 200 && controlRoot.bodyText === M6_BLANK_CONTROL_HTML
    && controlIcon.length === 1 && controlIcon[0].method === 'GET' && controlIcon[0].path === '/favicon.ico' && controlIcon[0].status === 404
    && typeof controlIcon[0].bodyText === 'string' && Buffer.byteLength(controlIcon[0].bodyText, 'utf8') === controlIcon[0].bodyByteCount
    && bytesHash(Buffer.from(controlIcon[0].bodyText, 'utf8')) === controlIcon[0].bodySha256
    && controlIcon[0].bodyByteCount === favicon?.bodyByteCount && controlIcon[0].bodySha256 === favicon?.bodySha256
    && controlIcon[0].bodyText === favicon?.bodyText && controlConsole;
  const responsesClean = Array.isArray(proof?.diagnostics?.responses) && proof.diagnostics.responses.length > 0
    && proof.diagnostics.responses.every((row) => row.status === 200 && row.url && row.resourceType)
    && proof.diagnostics.responses.every((row) => { try { return new URL(row.url).origin === origin; } catch { return false; } });
  const requestsClean = Array.isArray(proof?.diagnostics?.requests) && proof.diagnostics.requests.length > 0
    && proof.diagnostics.requests.every((row) => {
      try {
        const parsed = new URL(row.url);
        return parsed.origin === origin && parsed.pathname !== '/favicon.ico' && row.method === 'GET';
      } catch { return false; }
    });
  const getsComplete = gets.length === 3 && ['production-index', 'production-entry', 'production-favicon'].every((name) => gets.filter((row) => row.name === name).length === 1)
    && typeof gets.find((row) => row.name === 'production-index')?.bodyText === 'string'
    && Buffer.byteLength(gets.find((row) => row.name === 'production-index').bodyText, 'utf8') === gets.find((row) => row.name === 'production-index').bodyByteCount
    && bytesHash(Buffer.from(gets.find((row) => row.name === 'production-index').bodyText, 'utf8')) === gets.find((row) => row.name === 'production-index').bodySha256
    && gets.filter((row) => row.name !== 'production-favicon').every((row) => {
      try { return row.status === 200 && new URL(row.url).origin === origin; } catch { return false; }
    });
  const productionEntry = gets.find((row) => row.name === 'production-entry');
  const productionEntryPath = proof?.productionEntryAssetPath?.replace(/^\//, '');
  const productionEntryRows = proof?.assetInventoryVerification?.observedRows;
  const productionEntryInventory = Array.isArray(productionEntryRows)
    ? productionEntryRows.find((row) => row?.path === productionEntryPath) : null;
  const productionEntryExpected = Array.isArray(buildReceipt?.artifact?.files)
    ? buildReceipt.artifact.files.find((row) => Array.isArray(row) && row[0] === productionEntryPath) : null;
  const productionEntryBound = typeof productionEntryPath === 'string'
    && Number.isSafeInteger(productionEntry?.bodyByteCount) && productionEntry.bodyByteCount > 0
    && /^[a-f0-9]{64}$/.test(productionEntry?.bodySha256 ?? '')
    && productionEntry?.bodySha256 === productionEntryExpected?.[1]
    && productionEntryInventory?.status === 200 && productionEntryInventory?.method === 'GET'
    && productionEntryInventory?.url === productionEntry?.url
    && productionEntryInventory?.bodySha256 === productionEntry.bodySha256
    && productionEntryInventory?.bodyByteCount === productionEntry.bodyByteCount;
  const buildBound = buildReceipt?.status === 'PASS' && buildReceipt?.candidate?.sha256 === identity?.candidateSha256
    && buildReceipt?.artifact?.digest === proof?.buildDigest
    && proof?.candidateIdentity === identity?.candidateSha256
    && (proof?.candidateKind !== 'mutant' || proof?.mutantCandidateIdentity === identity?.candidateSha256)
    && proof?.assetInventoryVerification?.status === 'PASS'
    && proof.assetInventoryVerification.recordedArtifactDigest === buildReceipt.artifact.digest
    && proof.assetInventoryVerification.expectedFileCount === buildReceipt.artifact.files?.length
    && JSON.stringify((proof.assetInventoryVerification.expectedFiles ?? []).map((row) => [row.path, row.sha256])) === JSON.stringify(buildReceipt.artifact.files)
    && inventoryRowsMatch(buildReceipt, proof.assetInventoryVerification.observedRows, origin);
  const cleanProcess = (proof?.stopErrors ?? []).length === 0 && Array.isArray(proof?.ownedProcesses)
    && proof.ownedProcesses.length === 2 && proof.ownedProcesses.every((item) => validM6OwnedProcessExit(item.exit))
    && proof.ownedProcesses.some((item) => item.role === 'managed-chromium' && typeof item.command === 'string' && item.command.includes('ms-playwright'));
  const frozenReadiness = finalizeM6ReadinessProof(proof);
  const valid = proof?.status === 'BLOCKED' && frozenReadiness.status === 'BLOCKED'
    && proof.reason === frozenReadiness.reason && !proof.error
    && ['mutant', 'clean'].includes(proof?.candidateKind) && /^[a-f0-9]{64}$/.test(identity?.candidateSha256 ?? '')
    && origin && target && proof.httpIndexStatus === 200 && proof.productionAssetStatus === 200
    && gets.find((row) => row.name === 'production-index')?.url === `${origin}/`
    && gets.find((row) => row.name === 'production-entry')?.url === `${origin}${proof.productionEntryAssetPath}`
    && /^\/(?:[^?#]+\.m?js)$/i.test(proof.productionEntryAssetPath ?? '')
    && proof.emittedHtmlAudit?.domAudit?.url === `${origin}/`
    && proof.browserNavigationStatus === 200 && proof.cdpReady === true && proof.coldHomeReady === true
    && proof.playwrightVersion === '1.62.1' && typeof proof.browserVersion === 'string' && proof.browserVersion.startsWith('Chrome/')
    && getsComplete && productionEntryBound && validM6FaviconFetch(favicon, origin) && expectedConsole && requestsClean && responsesClean
    && buildBound && sourceClear && emittedClear && controlValid && cleanProcess;
  return valid ? { status: 'AUXILIARY_CANDIDATE', origin, target, candidateIdentity: identity.candidateSha256,
    buildDigest: buildReceipt.artifact.digest, browserVersion: proof.browserVersion, faviconStatus: favicon.status,
    faviconBodySha256: favicon.bodySha256, sourceAudit: 'PASS', emittedAudit: 'PASS', hookFreeControl: 'PASS',
    assetCount: proof.assetInventoryVerification.expectedFileCount, strictReadinessStatus: frozenReadiness.status }
    : { status: 'BLOCKED', origin, target, reason: 'Readiness proof did not satisfy every exact-origin default favicon provenance condition.' };
}

function sameM6Inventory(left, right) {
  return left?.digest === right?.digest && JSON.stringify(left?.files) === JSON.stringify(right?.files);
}

function browserVersionValue(value) {
  return typeof value === 'string' ? value.replace(/^Chrome\//, '') : null;
}

function validM6OwnedProcessExit(exit) {
  return (exit?.code === 0 && exit.signal == null)
    || (exit?.signal === 'SIGTERM'
      && (exit.code === null || (Number.isInteger(exit.code) && exit.code !== 0)));
}

function normalizedLifecycleAssetPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[?#\\]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value.slice(1));
    if (!decoded || decoded.split('/').some((part) => !part || part === '.' || part === '..')) return null;
    return decoded;
  } catch { return null; }
}

export function classifyM6LifecycleFaviconDisposition(lifecycleReceipt, lifecycleSummary, buildReceipt,
  faviconProbe, expectedCandidateSha, readinessProof, expectedLifecycleStatus = 'BEHAVIORAL_RED', browserProvenance = null) {
  const rawOrigin = expectedLifecycleStatus === 'BEHAVIORAL_RED' ? lifecycleReceipt?.origin : lifecycleReceipt?.environment?.origin;
  const origin = exactM6LocalOrigin(rawOrigin);
  const target = origin && `${origin}/favicon.ico`;
  const lifecycleErrors = lifecycleReceipt?.diagnostics?.consoleErrors;
  const processRows = lifecycleReceipt?.processEvidence;
  const productionInventory = expectedLifecycleStatus === 'BEHAVIORAL_RED'
    ? lifecycleReceipt?.productionInventory : lifecycleReceipt?.artifacts?.production;
  const served = expectedLifecycleStatus === 'BEHAVIORAL_RED'
    ? lifecycleReceipt?.networkEvidence : lifecycleReceipt?.artifacts?.servedResponses;
  const lifecycleReadinessOrigin = m6ReadinessOrigin(readinessProof);
  const lifecycleReadinessFavicon = (readinessProof?.independentHttpGets ?? []).find((row) => row.name === 'production-favicon');
  const readinessDisposition = classifyM6ReadinessFaviconDisposition(readinessProof,
    { candidateSha256: expectedCandidateSha }, buildReceipt);
  const expectedCase = expectedLifecycleStatus === 'BEHAVIORAL_RED' ? [] : [productionCase];
  const exactAssertion = expectedLifecycleStatus !== 'BEHAVIORAL_RED'
    || (lifecycleReceipt?.phase === 'cold-Home-and-production-runtime'
      && lifecycleReceipt?.error?.name === 'AssertionError'
      && lifecycleReceipt.error.message?.includes('normal Home Sales Open is enabled when the production runtime is ready'));
  const browserRows = expectedLifecycleStatus === 'BEHAVIORAL_RED'
    ? Array.isArray(processRows) && processRows.length === 1 && processRows[0]?.launch === 1
      && processRows[0].endpointReady === true && !Object.hasOwn(processRows[0], 'exit')
      && browserVersionValue(processRows[0].browserVersion) === browserVersionValue(readinessProof?.browserVersion)
    : Array.isArray(processRows) && processRows.length === 2
      && JSON.stringify(processRows.map((row) => row.launch).sort()) === JSON.stringify([1, 2])
      && processRows.every((row) => row.endpointReady === true && row.exit?.observed === true
        && row.exit.signal === null && row.exit.code === 0
        && browserVersionValue(row.browserVersion) === browserVersionValue(readinessProof?.browserVersion));
  const executable = browserProvenance?.executable;
  const browserProvenanceBound = browserProvenance?.status === 'PASS'
    && browserProvenance.candidateSha256 === expectedCandidateSha
    && browserProvenance.buildDigest === buildReceipt?.artifact?.digest
    && browserProvenance.playwrightTestVersion === '1.62.1' && browserProvenance.playwrightCoreVersion === '1.62.1'
    && browserProvenance.frozenSeedSha256 === expectedSeeds['tests/product/production-lifecycle.mjs']
    && typeof executable === 'string' && path.isAbsolute(executable)
    && browserProvenance.executableIsFile === true && Number.isSafeInteger(browserProvenance.executableBytes) && browserProvenance.executableBytes > 0
    && (expectedLifecycleStatus === 'BEHAVIORAL_RED'
      ? !Object.hasOwn(lifecycleReceipt ?? {}, 'environment') && !Object.hasOwn(lifecycleReceipt ?? {}, 'artifacts')
      : lifecycleReceipt?.environment?.playwrightVersion === browserProvenance.playwrightTestVersion
        && lifecycleReceipt.environment.executable === executable)
    && browserVersionValue(lifecycleReceipt?.environment?.browserVersion ?? processRows?.[0]?.browserVersion)
      === browserVersionValue(readinessProof?.browserVersion);
  const expectedLaunches = expectedLifecycleStatus === 'BEHAVIORAL_RED' ? [1] : [1, 2];
  const exactConsole = Array.isArray(lifecycleErrors) && lifecycleErrors.length === expectedLaunches.length
    && lifecycleErrors.every((row) => row && row.message === M6_FAVICON_404_CONSOLE_MESSAGE
      && row.url === target && expectedLaunches.includes(row.launch))
    && JSON.stringify(lifecycleErrors.map((row) => row.launch).sort()) === JSON.stringify(expectedLaunches);
  const inventoryBound = buildReceipt?.status === 'PASS' && buildReceipt.candidate?.sha256 === expectedCandidateSha
    && lifecycleSummary?.candidate?.sha256 === expectedCandidateSha
    && lifecycleSummary?.status === expectedLifecycleStatus
    && lifecycleSummary?.lifecycle === expectedLifecycleStatus
    && lifecycleSummary?.command?.outcome === 'EXITED'
    && lifecycleSummary?.command?.exitCode === (expectedLifecycleStatus === 'BEHAVIORAL_RED' ? 1 : 0)
    && lifecycleSummary?.buildEvidence?.artifact?.digest === buildReceipt.artifact?.digest
    && sameM6Inventory(buildReceipt.artifact, lifecycleSummary?.buildEvidence?.artifact)
    && productionInventory?.digest === buildReceipt.artifact.digest
    && JSON.stringify(productionInventory?.files) === JSON.stringify(buildReceipt.artifact.files)
    && Array.isArray(served) && served.length > 0 && served.every((row) => {
      const file = normalizedLifecycleAssetPath(row?.path);
      return file && row.status === 200 && buildReceipt.artifact.files.some(([asset, sha256]) => asset === file && sha256 === row.sha256);
    });
  const lifecycleDiagnosticArraysPresent = ['pageErrors', 'consoleErrors', 'requestFailures', 'responseErrors']
    .every((key) => Array.isArray(lifecycleReceipt?.diagnostics?.[key]));
  const directGetBound = faviconProbe?.status === 'PASS' && faviconProbe.origin === origin
    && validM6FaviconFetch(faviconProbe, origin)
    && faviconProbe.bodySha256 === lifecycleReadinessFavicon?.bodySha256
    && faviconProbe.bodyByteCount === lifecycleReadinessFavicon?.bodyByteCount
    && lifecycleFaviconGetSameOrigin(lifecycleReadinessFavicon, lifecycleReadinessOrigin);
  const normalStatus = lifecycleReceipt?.status === expectedLifecycleStatus
    && JSON.stringify(lifecycleReceipt?.caseIds) === JSON.stringify(expectedCase)
    && JSON.stringify(lifecycleReceipt?.expectedCaseIds) === JSON.stringify([productionCase]);
  const noOtherErrors = lifecycleDiagnosticArraysPresent
    && lifecycleReceipt.diagnostics.pageErrors.length === 0
    && lifecycleReceipt.diagnostics.requestFailures.length === 0
    && lifecycleReceipt.diagnostics.responseErrors.length === 0
    && (!Array.isArray(lifecycleReceipt?.diagnostics?.captureErrors) || lifecycleReceipt.diagnostics.captureErrors.length === 0)
    && (!Number.isSafeInteger(lifecycleReceipt?.diagnostics?.droppedEvents) || lifecycleReceipt.diagnostics.droppedEvents === 0)
    && Array.isArray(served) && served.every((row) => row.status === 200)
    && exactConsole && Array.isArray(faviconProbe?.cleanupErrors) && faviconProbe.cleanupErrors.length === 0
    && faviconProbe.serverExit?.observed === true
    && validM6OwnedProcessExit(faviconProbe.serverExit)
    && !readinessProof?.hookFreeControl?.closeError && !readinessProof?.hookFreeControl?.serverCloseError;
  return origin && target && readinessDisposition.status === 'AUXILIARY_CANDIDATE' && normalStatus && exactAssertion
    && browserRows && browserProvenanceBound && inventoryBound && directGetBound && noOtherErrors
    ? { status: 'AUXILIARY_CANDIDATE', origin, target, candidateIdentity: expectedCandidateSha,
      buildDigest: buildReceipt.artifact.digest, browserVersion: lifecycleReceipt?.environment?.browserVersion ?? processRows[0].browserVersion,
      lifecycleStatus: lifecycleReceipt.status, lifecycleConsoleErrorCount: lifecycleErrors.length,
      lifecycleLaunchCount: processRows.length, faviconBodySha256: faviconProbe.bodySha256, servedAssetCount: served.length,
      processExitRecordedInFrozenReceipt: processRows.every((row) => row.exit?.observed === true) }
    : { status: 'BLOCKED', origin, target, reason: 'Frozen lifecycle receipt did not satisfy its status-specific schema or candidate/build/browser/error/cleanup provenance.' };
}

function lifecycleFaviconGetSameOrigin(row, origin) {
  return Boolean(origin && validM6FaviconFetch(row, origin));
}

export function finalizeM6AuxiliaryDisposition({ mutantReadiness, cleanReadiness, mutantIdentity, cleanIdentity,
  mutantBuildReceipt, cleanBuildReceipt, mutantLifecycle, cleanLifecycle, comparison,
  mutantReadinessSha256, cleanReadinessSha256, mutantLifecycleReceiptSha256, cleanLifecycleReceiptSha256 }) {
  const mutantReady = classifyM6ReadinessFaviconDisposition(mutantReadiness, mutantIdentity, mutantBuildReceipt);
  const cleanReady = classifyM6ReadinessFaviconDisposition(cleanReadiness, cleanIdentity, cleanBuildReceipt);
  const mutantLifecycleDisposition = classifyM6LifecycleFaviconDisposition(mutantLifecycle?.receipt, mutantLifecycle?.summary,
    mutantLifecycle?.buildReceipt, mutantLifecycle?.faviconProbe, mutantIdentity?.candidateSha256, mutantReadiness,
    'BEHAVIORAL_RED', mutantLifecycle?.browserProvenance);
  const cleanLifecycleDisposition = classifyM6LifecycleFaviconDisposition(cleanLifecycle?.receipt, cleanLifecycle?.summary,
    cleanLifecycle?.buildReceipt, cleanLifecycle?.faviconProbe, cleanIdentity?.candidateSha256, cleanReadiness,
    'PASS', cleanLifecycle?.browserProvenance);
  const mutantFavicon = m6FaviconTuple(mutantReadiness);
  const cleanFavicon = m6FaviconTuple(cleanReadiness);
  const mutantLifecycleGet = mutantLifecycle?.faviconProbe;
  const cleanLifecycleGet = cleanLifecycle?.faviconProbe;
  const pairedFavicon = Boolean(mutantFavicon && cleanFavicon && JSON.stringify(mutantFavicon) === JSON.stringify(cleanFavicon)
    && mutantLifecycleGet?.status === 'PASS' && cleanLifecycleGet?.status === 'PASS'
    && mutantLifecycleGet.origin === cleanLifecycleGet.origin
    && mutantLifecycleGet.bodySha256 === cleanLifecycleGet.bodySha256
    && mutantLifecycleGet.bodyByteCount === cleanLifecycleGet.bodyByteCount
    && mutantLifecycleGet.bodyText === cleanLifecycleGet.bodyText
    && mutantLifecycleGet.bodySha256 === mutantFavicon.bodySha256
    && cleanLifecycleGet.bodySha256 === cleanFavicon.bodySha256);
  const receiptHashes = [mutantReadinessSha256, cleanReadinessSha256, mutantLifecycleReceiptSha256, cleanLifecycleReceiptSha256];
  const provenance = receiptHashes.every((value) => /^[a-f0-9]{64}$/.test(value ?? ''))
    && comparison?.mutantCandidateIdentity === mutantIdentity?.candidateSha256
    && comparison?.cleanCandidateIdentity === cleanIdentity?.candidateSha256;
  const status = mutantReady.status === 'AUXILIARY_CANDIDATE' && cleanReady.status === 'AUXILIARY_CANDIDATE'
    && mutantLifecycleDisposition.status === 'AUXILIARY_CANDIDATE' && cleanLifecycleDisposition.status === 'AUXILIARY_CANDIDATE'
    && comparison?.auxiliaryEvidenceParity === true && pairedFavicon && provenance
    ? 'AUXILIARY_DEFAULT_FAVICON_404' : 'BLOCKED';
  return {
    status, type: status === 'AUXILIARY_DEFAULT_FAVICON_404' ? 'browser-default same-origin favicon 404' : null,
    readinessRuleChanged: false, rawErrorsPreserved: true,
    mutantCandidateIdentity: mutantIdentity?.candidateSha256 ?? null, cleanCandidateIdentity: cleanIdentity?.candidateSha256 ?? null,
    mutantBuildDigest: mutantBuildReceipt?.artifact?.digest ?? null, cleanBuildDigest: cleanBuildReceipt?.artifact?.digest ?? null,
    mutantReadiness: mutantReady, cleanReadiness: cleanReady,
    mutantLifecycle: mutantLifecycleDisposition, cleanLifecycle: cleanLifecycleDisposition,
    comparison: { status: comparison?.status ?? 'MISSING', productDiagnosticsParity: comparison?.productDiagnosticsParity ?? false,
      auxiliaryEvidenceParity: comparison?.auxiliaryEvidenceParity === true, artifactParity: comparison?.artifactParity ?? null },
    faviconParity: pairedFavicon,
    receipts: { mutantReadinessSha256, cleanReadinessSha256, mutantLifecycleReceiptSha256, cleanLifecycleReceiptSha256 },
    reason: status === 'AUXILIARY_DEFAULT_FAVICON_404' ? null : 'One or more readiness, lifecycle, raw evidence, or clean/mutant parity bindings did not qualify.',
  };
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
    maxOutputBytes: options.maxOutputBytes ?? 64 * 1024,
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
  const committedFiles = await readCommittedSourceIdentities({
    head,
    files: committedRun.output.split(/\r?\n/).filter(Boolean),
    cwd,
    runGit: (args, options) => git(args, { cwd, ...options }),
  });
  const identity = { base, head, committedFiles, dirtyFiles };
  return { ...identity, sha256: jsonHash(identity) };
}

export async function validateAuthorizedCandidate(cwd, head) {
  const requested = process.env.TACHIKO_MUTATION_PR_HEAD;
  if (requested) {
    const anchor = await git(['merge-base', '--is-ancestor', expectedHead, requested], { cwd });
    if (anchor.code !== 0) throw new Error(`workflow PR head ${requested} is not based on the authorized clean candidate ${expectedHead}`);
    const delta = await git(['diff', '--name-only', `${expectedHead}..${requested}`], { cwd });
    if (delta.code !== 0) throw new Error(`cannot enumerate the implementation delta from the authorized candidate: ${delta.output}`);
    const paths = delta.output.split(/\r?\n/).filter(Boolean).sort();
    if (JSON.stringify(paths) !== JSON.stringify(implementationPaths)) {
      throw new Error(`PR head delta from authorized candidate must contain exactly the seven admitted implementation paths; got ${paths.join(', ')}`);
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

export function requireCleanAcceptance(summary, expectedCandidate, expectedHead) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { status: 'BLOCKED', reason: 'Restored clean acceptance produced no readable summary.' };
  }
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

async function inventoryTree(directory) {
  const rows = [];
  async function walk(relative = '') {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) rows.push([child, await pathHash(path.join(directory, child))]);
      else throw new Error(`unexpected generated-evidence entry: ${child}`);
    }
  }
  await walk();
  return rows.sort(([a], [b]) => a.localeCompare(b));
}

async function archiveAndRestoreProductAcceptanceEvidence(worktree, archivePath) {
  const generated = path.join(worktree, 'evidence/product-acceptance');
  const before = await inventoryTree(generated).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!before) throw new Error('old product acceptance evidence directory is missing before archival.');
  const rawOutput = path.join(archivePath, 'raw-product-acceptance');
  await copyRawEvidence(generated, rawOutput);
  const raw = await inventoryTree(rawOutput);
  const tracked = await git(['ls-files', '-z', '--', 'evidence/product-acceptance'], { cwd: worktree });
  if (tracked.code !== 0) throw new Error(`cannot inventory prior tracked product acceptance evidence: ${tracked.output}`);
  const trackedPaths = tracked.output.split('\0').filter(Boolean);
  const expectedTracked = {};
  await rm(generated, { recursive: true, force: true });
  for (const file of trackedPaths) {
    const original = await git(['show', `HEAD:${file}`], { cwd: worktree });
    if (original.code !== 0) throw new Error(`cannot restore committed generated-evidence preimage ${file}`);
    const destination = path.join(worktree, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, original.bytes);
    expectedTracked[path.posix.relative('evidence/product-acceptance', file)] = bytesHash(original.bytes);
  }
  const restored = await inventoryTree(generated);
  const restoredTracked = Object.fromEntries(restored);
  const verified = trackedPaths.every((file) => restoredTracked[path.posix.relative('evidence/product-acceptance', file)] === expectedTracked[path.posix.relative('evidence/product-acceptance', file)]);
  if (!verified) throw new Error('product acceptance tracked evidence did not restore byte-for-byte.');
  return { archived: true, generatedBefore: before, generatedOutput: raw, archivePath: rawOutput,
    restoredTrackedPaths: trackedPaths, restoredTrackedHashes: expectedTracked, generatedEvidenceRestored: verified };
}

export async function reconcileHostedProductEvidence(cwd, archiveRoot = rootEvidence()) {
  const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd });
  if (status.code !== 0) throw new Error(`cannot inspect hosted generated-evidence changes: ${status.output}`);
  const rows = status.output.split('\0').filter(Boolean);
  const paths = rows.map((row) => row.slice(3));
  if (!paths.length) return { status: 'PASS', changedPaths: [], reconciled: false };
  if (paths.some((file) => !file.startsWith('evidence/product-acceptance/'))) {
    throw new Error(`checkout has dirty paths outside generated product-acceptance evidence: ${paths.filter((file) => !file.startsWith('evidence/product-acceptance/')).join(', ')}`);
  }
  const oldGateSummary = await readJson(path.join(cwd, 'evidence/product-acceptance/summary.json')).catch(() => null);
  if (oldGateSummary?.status !== 'PASS' || !Array.isArray(oldGateSummary.summary) || oldGateSummary.summary.some((entry) => entry.status !== 'PASS')) {
    throw new Error('the preceding unchanged acceptance:product gate did not leave a complete PASS evidence summary.');
  }
  const archive = path.join(archiveRoot, 'mutations', 'preflight-product-acceptance-output');
  await mkdir(archive, { recursive: true });
  const rawRoot = path.join(archive, 'raw-checkout-output');
  await copyRawEvidence(path.join(cwd, 'evidence/product-acceptance'), rawRoot);
  const generated = await inventoryTree(rawRoot);
  await writeMutationJson(path.join(archive, 'archive-manifest.json'), { changedPaths: paths, generated, archivedAt: nowIso() });
  for (const file of paths) {
    const tracked = await git(['ls-files', '--error-unmatch', '--', file], { cwd });
    const destination = path.join(cwd, file);
    if (tracked.code === 0) {
      const original = await git(['show', `HEAD:${file}`], { cwd });
      if (original.code !== 0) throw new Error(`cannot restore HEAD version of generated evidence ${file}`);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, original.bytes);
    } else {
      await rm(destination, { force: true, recursive: true });
    }
  }
  const after = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd });
  if (after.code !== 0 || after.output) throw new Error(`generated-evidence reconciliation did not restore a clean checkout: ${after.output}`);
  return { status: 'PASS', oldGateSummary: oldGateSummary.status, changedPaths: paths, reconciled: true, archive: path.relative(archiveRoot, rawRoot).split(path.sep).join('/'), generated };
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

async function runOldProductAcceptance(ctx, worktree, evidenceDir) {
  const legacyEvidence = path.join(worktree, 'evidence/product-acceptance');
  const before = await captureCandidateIdentity(worktree);
  const run = await commandRunner(ctx, 'm6-old-pnpm-acceptance-product', 'pnpm', ['acceptance:product'], worktree, evidenceDir, {
    timeoutMs: 300_000, minimumMs: 45_000,
  });
  const summary = await readJson(path.join(legacyEvidence, 'summary.json')).catch(() => null);
  const archived = await archiveAndRestoreProductAcceptanceEvidence(worktree, path.join(evidenceDir, 'old-gate-archive'));
  const after = await captureCandidateIdentity(worktree);
  return { status: run.result.outcome === 'EXITED' && run.result.code === 0 && summary?.status === 'PASS'
    && Array.isArray(summary.summary) && summary.summary.every((entry) => entry.status === 'PASS')
    && archived.generatedEvidenceRestored && after.sha256 === before.sha256 ? 'PASS' : 'BLOCKED',
    command: run.command, outputDir: legacyEvidence, summary, beforeIdentity: before.sha256,
    candidateIdentity: after.sha256, archiveAndEvidenceRestore: archived, commandOutcome: run.result.outcome, exitCode: run.result.code };
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

async function settleBefore(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

const M6_MAX_SINGLE_ASSET_BYTES = 32 * 1024 * 1024;
const M6_MAX_TOTAL_ASSET_BYTES = 128 * 1024 * 1024;
const M6_BLANK_CONTROL_HTML = '<!doctype html><html><head><title>M6 blank control</title></head><body>blank control</body></html>';

async function readM6ResponseBody(response, maximumBytes, label) {
  const chunks = [];
  let byteCount = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        byteCount += value.byteLength;
        if (byteCount > maximumBytes) {
          await reader.cancel(`${label} exceeded ${maximumBytes} bytes`).catch(() => {});
          throw new Error(`BLOCKED: ${label} exceeded its ${maximumBytes}-byte evidence bound.`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks, byteCount);
}

export async function fetchM6BuildInventory(worktree, evidenceDir, origin, timeoutMs, fetchImpl = fetch) {
  const receiptPath = path.join(evidenceDir, 'production-build.json');
  const receipt = await readJson(receiptPath);
  const expectedRows = receipt?.artifact?.files;
  if (!Array.isArray(expectedRows) || expectedRows.length < 1 || expectedRows.length > 200) {
    throw new Error('BLOCKED: M6 recorded production asset inventory is missing or outside its 1–200 file bound.');
  }
  const rows = [];
  let totalBytes = 0;
  for (const item of expectedRows) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string'
      || item[0].startsWith('/') || item[0].split('/').includes('..') || !/^[a-f0-9]{64}$/.test(item[1])) {
      throw new Error('BLOCKED: M6 production build inventory contains an unsafe or malformed file row.');
    }
    const file = item[0];
    const url = new URL(`/${file.split('/').map(encodeURIComponent).join('/')}`, origin);
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs(5_000)) });
    const body = await readM6ResponseBody(response, M6_MAX_SINGLE_ASSET_BYTES, `M6 asset ${file}`);
    totalBytes += body.byteLength;
    if (totalBytes > M6_MAX_TOTAL_ASSET_BYTES) throw new Error(`BLOCKED: M6 served asset inventory exceeded ${M6_MAX_TOTAL_ASSET_BYTES} bytes.`);
    rows.push({ path: file, url: response.url, method: 'GET', status: response.status,
      contentType: response.headers.get('content-type'), bodyByteCount: body.byteLength,
      bodySha256: bytesHash(body), expectedSha256: item[1] });
  }
  const verification = qualifyM6AssetInventory(receipt, rows);
  return { ...verification, totalBodyByteCount: totalBytes };
}

async function auditM6SourceAndBuild(worktree, buildInventory, entryPath, emittedHtml) {
  const tracked = await git(['ls-files', '-z', '--', 'index.html', 'src', 'public'], { cwd: worktree, maxOutputBytes: 128 * 1024 });
  if (tracked.outcome !== 'EXITED' || tracked.code !== 0) throw new Error('BLOCKED: M6 source icon audit could not enumerate tracked application sources.');
  const paths = tracked.output.split('\0').filter(Boolean);
  if (paths.length < 1 || paths.length > 2000) throw new Error(`BLOCKED: M6 source icon audit file count ${paths.length} is outside its bound.`);
  const sourceFiles = [];
  const references = [];
  let scannedBytes = 0;
  const textFile = /\.(?:html|[cm]?js|jsx|ts|tsx|css|json|svg)$/i;
  for (const file of paths) {
    if (/\.(?:ico)$/i.test(file) || /(?:^|\/)favicon(?:\.|$)/i.test(file)) references.push({ source: file, kind: 'icon-file-path', text: file });
    if (!textFile.test(file)) continue;
    const bytes = await readFile(path.join(worktree, file));
    scannedBytes += bytes.byteLength;
    if (scannedBytes > 32 * 1024 * 1024 || bytes.byteLength > 4 * 1024 * 1024) throw new Error('BLOCKED: M6 source icon audit exceeded its byte bound.');
    sourceFiles.push({ path: file, byteCount: bytes.byteLength, sha256: bytesHash(bytes) });
    references.push(...findM6IconReferences(bytes.toString('utf8'), file));
  }
  const sourceIconAudit = { status: references.length === 0 && sourceFiles.some((item) => item.path === 'index.html') ? 'PASS' : 'BLOCKED',
    filesScanned: sourceFiles.length, byteCount: scannedBytes, sourceFiles, references };
  const assetMap = new Map((buildInventory.expectedFiles ?? []).map((row) => [row.path, row.sha256]));
  const entryAsset = entryPath.replace(/^\//, '');
  const entryExpectedSha = assetMap.get(entryAsset);
  if (!entryExpectedSha) throw new Error('BLOCKED: emitted production entry is absent from the recorded build inventory.');
  const scriptAssets = [];
  for (const [file, expectedSha256] of buildInventory.expectedFiles.filter((row) => /\.m?js$/i.test(row.path)).map((row) => [row.path, row.sha256])) {
    const bytes = await readFile(path.join(worktree, 'dist', file));
    const row = { path: file, byteCount: bytes.byteLength, sha256: bytesHash(bytes), expectedSha256,
      references: findM6IconReferences(bytes.toString('utf8'), `dist/${file}`) };
    if (row.sha256 !== expectedSha256) throw new Error(`BLOCKED: emitted production script ${file} differs from the recorded build inventory.`);
    scriptAssets.push(row);
  }
  if (scriptAssets.length > 128) throw new Error('BLOCKED: emitted production script audit exceeded its 128-file bound.');
  const entryScriptAudit = scriptAssets.find((row) => row.path === entryAsset);
  if (!entryScriptAudit || entryScriptAudit.sha256 !== entryExpectedSha) throw new Error('BLOCKED: emitted production entry differs from the recorded build inventory.');
  const htmlReferences = findM6IconReferences(emittedHtml, 'served-dist/index.html');
  const scriptReferences = scriptAssets.flatMap((row) => row.references);
  const emittedHtmlAudit = { status: htmlReferences.length === 0 && scriptReferences.length === 0 ? 'PASS' : 'BLOCKED',
    byteCount: Buffer.byteLength(emittedHtml), sha256: bytesHash(Buffer.from(emittedHtml)),
    references: [...htmlReferences, ...scriptReferences], entryScriptAudit, scriptAssets, domAudit: null };
  return { sourceIconAudit, emittedHtmlAudit };
}

async function startM6HookFreeControlServer() {
  const serverRequests = [];
  let observeIconRequest;
  const faviconObserved = new Promise((resolve) => { observeIconRequest = resolve; });
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const startedAt = nowIso();
    const isRootGet = request.method === 'GET' && pathname === '/';
    const isFaviconGet = request.method === 'GET' && pathname === '/favicon.ico';
    const status = isRootGet ? 200 : 404;
    const body = Buffer.from(isRootGet ? M6_BLANK_CONTROL_HTML : 'Not found');
    response.writeHead(status, { 'content-type': isRootGet ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end(body, () => {
      const row = { method: request.method, path: pathname, startedAt, completedAt: nowIso(), status,
        contentType: isRootGet ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
        bodyByteCount: body.byteLength, bodySha256: bytesHash(body), bodyText: body.toString('utf8') };
      serverRequests.push(row);
      if (isFaviconGet) observeIconRequest(row);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, serverRequests, faviconObserved, origin: `http://127.0.0.1:${address.port}`, html: M6_BLANK_CONTROL_HTML };
}

async function runM6HookFreeBrowserControl(browser, parentProof, timeoutMs) {
  const control = { status: 'BLOCKED', startedAt: nowIso(), browserVersion: parentProof.browserVersion,
    htmlByteCount: Buffer.byteLength(M6_BLANK_CONTROL_HTML), htmlSha256: bytesHash(Buffer.from(M6_BLANK_CONTROL_HTML)),
    diagnostics: { requests: [], pageErrors: [], consoleErrors: [], requestFailures: [], responseErrors: [], responses: [], captureErrors: [], droppedEvents: 0 } };
  let serverBundle;
  let context;
  let page;
  try {
    serverBundle = await startM6HookFreeControlServer();
    context = await browser.newContext();
    attachM6BrowserNetworkDiagnostics(context, { diagnostics: control.diagnostics });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs(5_000));
    page.setDefaultNavigationTimeout(timeoutMs(5_000));
    page.on('pageerror', (error) => { control.diagnostics.pageErrors.push({ message: error.message, stack: error.stack ?? null }); });
    page.on('console', (message) => {
      const entry = { type: message.type(), message: message.text(), location: message.location() };
      if (entry.type === 'error') control.diagnostics.consoleErrors.push(entry);
    });
    const response = await page.goto(serverBundle.origin, { waitUntil: 'domcontentloaded', timeout: timeoutMs(5_000) });
    control.navigationStatus = response?.status() ?? null;
    control.domAudit = await page.evaluate(() => {
      const html = document.documentElement?.outerHTML ?? '';
      const links = [...document.querySelectorAll('link')].map((item) => ({ rel: item.rel, href: item.href }));
      const iconLinks = links.filter((item) => /(?:^|\s)icon(?:\s|$)/i.test(item.rel) || /\.ico(?:[?#]|$)/i.test(item.href));
      return { url: location.href, title: document.title, outerHtml: html, htmlByteCount: new TextEncoder().encode(html).byteLength,
        htmlSha256: null, scriptCount: document.scripts.length, scripts: [...document.scripts].map((item) => item.src || item.textContent || ''), links, iconLinks };
    });
    control.domAudit.htmlSha256 = bytesHash(Buffer.from(control.domAudit.outerHtml));
    control.domAudit.references = findM6IconReferences(control.domAudit.outerHtml, 'blank-control-dom');
    const waitMs = timeoutMs(2_000);
    const sawBrowserRequest = await Promise.race([
      serverBundle.faviconObserved.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), waitMs)),
    ]);
    control.serverRequests = serverBundle.serverRequests;
    control.browserFaviconRequestObserved = sawBrowserRequest;
    control.status = control.navigationStatus === 200 && control.domAudit.scriptCount === 0
      && control.domAudit.links.length === 0 && control.domAudit.iconLinks.length === 0
      && control.domAudit.references.length === 0 && sawBrowserRequest ? 'CONTROL_OBSERVED' : 'BLOCKED';
  } catch (error) {
    control.error = { name: error.name, code: error.code ?? null, message: error.message, stack: error.stack ?? null };
    if (serverBundle) control.serverRequests = serverBundle.serverRequests;
  } finally {
    if (context) await settleBefore(context.close(), 3_000, 'M6 control browser-context close').catch((error) => { control.closeError = error.message; });
    if (serverBundle) {
      serverBundle.server.closeAllConnections();
      await settleBefore(new Promise((resolve, reject) => serverBundle.server.close((error) => error ? reject(error) : resolve())),
        3_000, 'M6 control HTTP server close').catch((error) => { control.serverCloseError = error.message; });
    }
  }
  if (control.closeError || control.serverCloseError) control.status = 'BLOCKED';
  control.completedAt = nowIso();
  return control;
}

async function runM6ProductionReadinessProbe(ctx, worktree, evidenceDir, mutationIdentity, { candidateKind = 'mutant', buildEvidenceDir = evidenceDir } = {}) {
  await mkdir(evidenceDir, { recursive: true });
  const proof = createM6ReadinessProof(mutationIdentity, { candidateKind });
  const probeBudgetMs = boundedM6ProbeBudget(ctx.remainingMs());
  if (probeBudgetMs === null) {
    proof.reason = `remaining job budget ${ctx.remainingMs()}ms is below the bounded M6 readiness probe plus restore/upload reserve.`;
    await writeMutationJson(path.join(evidenceDir, 'm6-production-readiness.json'), proof);
    return proof;
  }
  const deadline = Date.now() + probeBudgetMs;
  const opTimeout = createM6OperationTimeout(deadline);
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') {
    proof.reason = 'M6 production CDP probe runs only on the approved hosted Ubuntu locked-Playwright job.';
    await writeMutationJson(path.join(evidenceDir, 'm6-production-readiness.json'), proof);
    return proof;
  }
  let chromium;
  try { ({ chromium } = await settleBefore(import('playwright-core'), opTimeout(5_000), 'locked Playwright module load')); }
  catch (error) {
    proof.reason = `BLOCKED: hosted locked Playwright could not load: ${error.message}`;
    await writeMutationJson(path.join(evidenceDir, 'm6-production-readiness.json'), proof);
    return proof;
  }
  let playwrightVersion;
  try { playwrightVersion = JSON.parse(await settleBefore(readFile(path.join(worktree, 'node_modules/playwright-core/package.json'), 'utf8'), opTimeout(2_000), 'locked Playwright identity read')).version; }
  catch (error) {
    proof.reason = `BLOCKED: locked Playwright package identity unavailable: ${error.message}`;
    await writeMutationJson(path.join(evidenceDir, 'm6-production-readiness.json'), proof);
    return proof;
  }
  if (playwrightVersion !== '1.62.1') {
    proof.reason = `locked Playwright version mismatch: ${playwrightVersion}`;
    proof.playwrightVersion = playwrightVersion;
    await writeMutationJson(path.join(evidenceDir, 'm6-production-readiness.json'), proof);
    return proof;
  }
  proof.playwrightVersion = playwrightVersion;
  let serverPort;
  let browserPort;
  let profile;
  let staticServer;
  let browserProcess;
  let browser;
  let stopErrors = [];
  try {
    const buildReceipt = await readJson(path.join(buildEvidenceDir, 'production-build.json'));
    if (buildReceipt?.status !== 'PASS' || buildReceipt?.candidate?.sha256 !== mutationIdentity.candidateSha256) {
      throw new Error('BLOCKED: M6 readiness probe does not have a matching recorded production build receipt.');
    }
    proof.buildDigest = buildReceipt.artifact?.digest ?? null;
    serverPort = await settleBefore(freePort(), opTimeout(2_000), 'production HTTP port allocation');
    browserPort = await settleBefore(freePort(), opTimeout(2_000), 'managed-browser CDP port allocation');
    profile = await settleBefore(mkdtemp(path.join(os.tmpdir(), 'tachiko-sheet-146-m6-profile-')), opTimeout(2_000), 'managed-browser profile allocation');
    staticServer = await startRunnerServer({
      name: 'm6-production-http', command: process.execPath,
      args: [path.join(worktree, 'scripts/serve-dist.mjs'), path.join(worktree, 'dist')],
      cwd: worktree, env: { PORT: String(serverPort) }, readyText: 'Sheet product server:', signal: ctx.cancellation.signal,
      startupTimeoutMs: opTimeout(10_000), maxOutputBytes: 64 * 1024,
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
      startupTimeoutMs: opTimeout(12_000), maxOutputBytes: 64 * 1024,
      startupLogPath: path.join(evidenceDir, 'm6-chromium-startup.log'), serverLogPath: path.join(evidenceDir, 'm6-chromium-server.log'),
    });
    ctx.serverPids.push({ role: 'managed-chromium', pid: browserProcess.child?.pid ?? null });
    const versionResponse = await fetch(`http://127.0.0.1:${browserPort}/json/version`, { signal: AbortSignal.timeout(opTimeout(5_000)) });
    if (!versionResponse.ok) throw new Error(`BLOCKED: Chrome DevTools HTTP endpoint returned ${versionResponse.status}`);
    const cdpVersion = await settleBefore(versionResponse.json(), opTimeout(3_000), 'CDP version response body');
    proof.cdpReady = true;
    proof.cdpProtocolVersion = cdpVersion['Protocol-Version'] ?? null;
    proof.browserVersion = cdpVersion.Browser ?? null;
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`, { timeout: opTimeout(8_000) });
    const context = browser.contexts()[0] ?? await browser.newContext();
    const instrumentedPages = new WeakSet();
    const instrumentPage = (targetPage) => {
      if (instrumentedPages.has(targetPage)) return;
      instrumentedPages.add(targetPage);
      targetPage.on('pageerror', (error) => { recordM6PageError(proof, error); });
      targetPage.on('console', (message) => { recordM6ConsoleError(proof, message); });
    };
    context.on('page', instrumentPage);
    attachM6BrowserNetworkDiagnostics(context, proof);
    const page = context.pages()[0] ?? await context.newPage();
    for (const existingPage of context.pages()) instrumentPage(existingPage);
    instrumentPage(page);
    page.setDefaultTimeout(opTimeout(5_000));
    page.setDefaultNavigationTimeout(opTimeout(8_000));
    await page.setViewportSize({ width: 1280, height: 900 });
    const origin = `http://127.0.0.1:${serverPort}`;
    const indexUrl = `${origin}/`;
    const indexRequest = { url: indexUrl, method: 'GET', resourceType: 'document' };
    recordM6RequestDiagnostic(proof, indexRequest, { source: 'node-preflight' });
    let index;
    try { index = await fetch(indexUrl, { signal: AbortSignal.timeout(opTimeout(5_000)) }); }
    catch (error) {
      recordM6RequestFailure(proof, { ...indexRequest, failure: () => ({ errorText: error.message }) }, { source: 'node-preflight' });
      throw error;
    }
    recordM6ResponseDiagnostic(proof, index, { source: 'node-preflight', resourceType: 'document', method: 'GET' });
    proof.httpIndexStatus = index.status;
    const indexBody = await settleBefore(readM6ResponseBody(index, 2 * 1024 * 1024, 'M6 production index'), opTimeout(3_000), 'production HTTP index body');
    const html = indexBody.toString('utf8');
    const entryPath = html.match(/<script[^>]+src=["']([^"']+\.js)["']/i)?.[1];
    proof.productionEntryAssetPath = entryPath ?? null;
    if (index.status !== 200 || !entryPath) throw new Error('BLOCKED: independent production HTTP index/entry discovery did not qualify.');
    const entryUrl = new URL(entryPath, origin);
    if (entryUrl.origin !== origin) throw new Error('BLOCKED: production entry asset escaped the same-origin boundary.');
    const assetRequest = { url: entryUrl.href, method: 'GET', resourceType: 'script' };
    recordM6RequestDiagnostic(proof, assetRequest, { source: 'node-preflight' });
    let assetResponse;
    try { assetResponse = await fetch(entryUrl, { signal: AbortSignal.timeout(opTimeout(5_000)) }); }
    catch (error) {
      recordM6RequestFailure(proof, { ...assetRequest, failure: () => ({ errorText: error.message }) }, { source: 'node-preflight' });
      throw error;
    }
    recordM6ResponseDiagnostic(proof, assetResponse, { source: 'node-preflight', resourceType: 'script', method: 'GET' });
    proof.productionAssetStatus = assetResponse.status;
    if (assetResponse.status !== 200) throw new Error(`BLOCKED: production JavaScript entry returned HTTP ${assetResponse.status}.`);
    const entryBody = await settleBefore(readM6ResponseBody(assetResponse, M6_MAX_SINGLE_ASSET_BYTES, 'M6 production entry script'), opTimeout(5_000), 'production entry script body');
    proof.independentHttpGets.push({ name: 'production-index', url: index.url, method: 'GET', status: index.status,
      contentType: index.headers.get('content-type'), bodyByteCount: indexBody.byteLength, bodySha256: bytesHash(indexBody),
      bodyText: indexBody.toString('utf8') });
    proof.independentHttpGets.push({ name: 'production-entry', url: assetResponse.url, method: 'GET', status: assetResponse.status,
      contentType: assetResponse.headers.get('content-type'), bodyByteCount: entryBody.byteLength, bodySha256: bytesHash(entryBody) });

    const faviconUrl = new URL('/favicon.ico', origin);
    const favicon = await fetch(faviconUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(opTimeout(5_000)) });
    const faviconBody = await settleBefore(readM6ResponseBody(favicon, 64 * 1024, 'M6 independent favicon GET'), opTimeout(3_000), 'independent favicon response body');
    const faviconResponseUrl = new URL(favicon.url);
    proof.independentHttpGets.push({ name: 'production-favicon', requestedUrl: faviconUrl.href, url: favicon.url,
      sameOrigin: faviconResponseUrl.origin === faviconUrl.origin && faviconResponseUrl.pathname === faviconUrl.pathname && !favicon.redirected,
      method: 'GET', status: favicon.status,
      redirected: favicon.redirected, contentType: favicon.headers.get('content-type'), bodyByteCount: faviconBody.byteLength,
      bodySha256: bytesHash(faviconBody), bodyText: faviconBody.toString('utf8') });

    const artifactInventory = await fetchM6BuildInventory(worktree, buildEvidenceDir, origin, opTimeout);
    proof.assetInventoryVerification = artifactInventory;
    const audits = await settleBefore(auditM6SourceAndBuild(worktree, artifactInventory, entryPath, html), opTimeout(10_000), 'M6 source/emitted icon audit');
    proof.sourceIconAudit = audits.sourceIconAudit;
    proof.emittedHtmlAudit = audits.emittedHtmlAudit;
    if (proof.assetInventoryVerification.status !== 'PASS') throw new Error('BLOCKED: served production assets differ from the exact recorded build inventory.');

    const control = await runM6HookFreeBrowserControl(browser, proof, opTimeout);
    proof.hookFreeControl = control;

    const response = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: opTimeout(8_000) });
    proof.browserNavigationStatus = response?.status() ?? null;
    await page.getByRole('heading', { name: 'Tachiko Sheet', exact: true }).waitFor({ state: 'visible', timeout: opTimeout(5_000) });
    const open = page.getByRole('button', { name: 'Open sales example', exact: true });
    await open.waitFor({ state: 'visible', timeout: opTimeout(5_000) });
    proof.coldHomeReady = true;
    const dom = await page.evaluate(() => {
      const html = document.documentElement?.outerHTML ?? '';
      const links = [...document.querySelectorAll('link')].map((item) => ({ rel: item.rel, href: item.href }));
      const iconLinks = links.filter((item) => /(?:^|\s)icon(?:\s|$)/i.test(item.rel) || /\.ico(?:[?#]|$)/i.test(item.href));
      return { url: location.href, title: document.title, outerHtml: html, scriptCount: document.scripts.length,
        scripts: [...document.scripts].map((item) => item.src || item.textContent || ''), links, iconLinks };
    });
    proof.emittedHtmlAudit.domAudit = { url: dom.url, title: dom.title, scriptCount: dom.scriptCount,
      scripts: dom.scripts, links: dom.links, iconLinks: dom.iconLinks,
      byteCount: Buffer.byteLength(dom.outerHtml), sha256: bytesHash(Buffer.from(dom.outerHtml)),
      references: findM6IconReferences(dom.outerHtml, 'production-cold-home-dom') };
    proof.emittedHtmlAudit.status = proof.emittedHtmlAudit.references.length === 0
      && proof.emittedHtmlAudit.entryScriptAudit.references.length === 0
      && proof.emittedHtmlAudit.domAudit.references.length === 0 && proof.emittedHtmlAudit.domAudit.iconLinks.length === 0 ? 'PASS' : 'BLOCKED';
    Object.assign(proof, finalizeM6ReadinessProof(proof));
  } catch (error) {
    proof.status = 'BLOCKED';
    proof.reason = error.message;
    proof.error = { name: error.name, code: error.code ?? null, message: error.message, stack: error.stack };
  } finally {
    try { if (browser) await settleBefore(browser.close(), 5_000, 'CDP client close'); }
    catch (error) { stopErrors.push({ role: 'cdp-client', message: error.message }); }
    proof.ownedProcesses = [];
    for (const [role, server] of [['managed-chromium', browserProcess], ['production-http', staticServer]]) {
      if (!server) continue;
      try { await server.stop(); } catch (error) { stopErrors.push({ role, message: error.message }); }
      let exit = null;
      try { exit = await settleBefore(server.exit, 8_000, `${role} exit`); }
      catch (error) { stopErrors.push({ role: `${role}-exit`, message: error.message }); }
      if (!exit) stopErrors.push({ role: `${role}-exit`, message: 'owned process exit was not observed within the 8-second cleanup bound' });
      proof.ownedProcesses.push({ role, pid: server.child?.pid ?? null, command: role === 'managed-chromium' ? chromium.executablePath() : process.execPath,
        args: role === 'managed-chromium' ? ['--headless=new', '--no-sandbox', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${browserPort}`, `--user-data-dir=${profile}`, 'about:blank'] : [path.join(worktree, 'scripts/serve-dist.mjs'), path.join(worktree, 'dist')],
        exit: exit ? { code: exit.code, signal: exit.signal, outcome: exit.outcome ?? null } : null,
        log: role === 'managed-chromium' ? 'm6-chromium-server.log' : 'm6-http-server.log' });
    }
    if (profile) {
      try { await settleBefore(rm(profile, { recursive: true, force: true }), 5_000, 'managed-browser profile cleanup'); }
      catch (error) { stopErrors.push({ role: 'profile-cleanup', message: error.message }); }
    }
  }
  proof.completedAt = nowIso();
  proof.stopErrors = stopErrors;
  if (stopErrors.length) proof.status = 'BLOCKED';
  await writeMutationJson(path.join(evidenceDir, 'm6-production-readiness.json'), proof);
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

async function probeM6LifecycleOriginFavicon(ctx, worktree, evidenceDir, label, lifecycleReceipt) {
  await mkdir(evidenceDir, { recursive: true });
  const proof = { status: 'BLOCKED', label, startedAt: nowIso(), origin: exactM6LocalOrigin(lifecycleReceipt?.environment?.origin ?? lifecycleReceipt?.origin),
    method: 'GET', requestedUrl: null, url: null, sameOrigin: false, redirected: null, statusCode: null,
    contentType: null, bodyByteCount: null, bodySha256: null, bodyText: null, cleanupErrors: [], serverExit: null };
  const remaining = ctx.remainingMs() - 90_000;
  if (!proof.origin || remaining < 1) {
    proof.reason = !proof.origin ? 'Frozen lifecycle receipt has no exact local origin.' : 'Qualification budget cannot retain the cleanup/upload reserve.';
    await writeMutationJson(path.join(evidenceDir, 'lifecycle-favicon-get.json'), proof);
    return proof;
  }
  const deadline = Date.now() + Math.min(10_000, remaining);
  const timeout = createM6OperationTimeout(deadline);
  const serverPort = Number(new URL(proof.origin).port);
  let server;
  try {
    server = await startRunnerServer({
      name: `${label}-lifecycle-origin-favicon-http`, command: process.execPath,
      args: [path.join(worktree, 'scripts/serve-dist.mjs'), path.join(worktree, 'dist')], cwd: worktree,
      env: { PORT: String(serverPort) }, readyText: proof.origin,
      startupTimeoutMs: timeout(5_000), maxOutputBytes: 32 * 1024, signal: ctx.cancellation.signal,
      startupLogPath: path.join(evidenceDir, 'lifecycle-favicon-server-startup.log'),
      serverLogPath: path.join(evidenceDir, 'lifecycle-favicon-server.log'),
    });
    ctx.serverPids.push({ role: `${label}-lifecycle-favicon-http`, pid: server.child?.pid ?? null });
    const requestedUrl = `${proof.origin}/favicon.ico`;
    proof.requestedUrl = requestedUrl;
    const response = await fetch(requestedUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeout(5_000)) });
    const body = await settleBefore(readM6ResponseBody(response, 64 * 1024, 'M6 lifecycle-origin favicon GET'), timeout(3_000), 'M6 lifecycle-origin favicon response body');
    proof.url = response.url;
    proof.sameOrigin = response.url === requestedUrl && exactM6FaviconUrl(response.url, proof.origin) === requestedUrl && !response.redirected;
    proof.redirected = response.redirected;
    proof.statusCode = response.status;
    proof.contentType = response.headers.get('content-type');
    proof.bodyByteCount = body.byteLength;
    proof.bodySha256 = bytesHash(body);
    proof.bodyText = body.toString('utf8');
  } catch (error) {
    proof.error = { name: error.name, code: error.code ?? null, message: error.message, stack: error.stack ?? null };
  } finally {
    if (server) {
      try { await server.stop(); }
      catch (error) { proof.cleanupErrors.push({ phase: 'stop', message: error.message }); }
      try {
        const exit = await settleBefore(server.exit, 5_000, `${label} lifecycle favicon server exit`);
        proof.serverExit = { observed: Boolean(exit), code: exit?.code ?? null, signal: exit?.signal ?? null };
        if (!exit || !validM6OwnedProcessExit(exit)) {
          proof.cleanupErrors.push({ phase: 'exit', message: 'owned lifecycle favicon server exit was unsuccessful', exit: exit ?? null });
        }
      } catch (error) { proof.cleanupErrors.push({ phase: 'exit', message: error.message }); }
    }
  }
  proof.status = proof.statusCode === 404 && validM6FaviconFetch({ ...proof, url: proof.url }, proof.origin) && !proof.cleanupErrors.length
    && proof.serverExit?.observed === true
    && validM6OwnedProcessExit(proof.serverExit) ? 'PASS' : 'BLOCKED';
  proof.completedAt = nowIso();
  await writeMutationJson(path.join(evidenceDir, 'lifecycle-favicon-get.json'), proof);
  return proof;
}

async function captureM6LifecycleBrowserProvenance(worktree, candidateSha256, buildReceipt) {
  const proof = { status: 'BLOCKED', candidateSha256, buildDigest: buildReceipt?.artifact?.digest ?? null,
    frozenSeedSha256: null, playwrightTestVersion: null, playwrightCoreVersion: null, executable: null };
  try {
    const testPackage = JSON.parse(await readFile(path.join(worktree, 'node_modules/@playwright/test/package.json'), 'utf8'));
    const corePackage = JSON.parse(await readFile(path.join(worktree, 'node_modules/playwright-core/package.json'), 'utf8'));
    const requireFromWorktree = createRequire(path.join(worktree, 'package.json'));
    const chromium = requireFromWorktree('playwright-core').chromium;
    proof.playwrightTestVersion = testPackage.version;
    proof.playwrightCoreVersion = corePackage.version;
    proof.executable = path.resolve(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath());
    proof.frozenSeedSha256 = await pathHash(path.join(worktree, 'tests/product/production-lifecycle.mjs'));
    const stat = await (await import('node:fs/promises')).stat(proof.executable);
    proof.executableIsFile = stat.isFile();
    proof.executableBytes = stat.size;
    proof.status = candidateSha256 === buildReceipt?.candidate?.sha256
      && proof.playwrightTestVersion === '1.62.1' && proof.playwrightCoreVersion === '1.62.1'
      && proof.frozenSeedSha256 === expectedSeeds['tests/product/production-lifecycle.mjs']
      && path.isAbsolute(proof.executable) && proof.executableIsFile ? 'PASS' : 'BLOCKED';
  } catch (error) { proof.error = { name: error.name, code: error.code ?? null, message: error.message }; }
  return proof;
}

async function runCleanProductionGate(ctx, worktree, evidenceDir, label, expectedCandidateSha) {
  const build = await runBuildAndCleanProduction(ctx, worktree, evidenceDir, label);
  if (build.status !== 'PASS') return build;
  let lifecycleBuildReceipt = null;
  let lifecycleBrowserProvenance = null;
  let readinessProofPath = null;
  if (label === 'm6-restored-clean') {
    lifecycleBuildReceipt = await readJson(path.join(evidenceDir, 'production-build.json')).catch(() => null);
    const readinessEvidenceDir = path.join(evidenceDir, 'm6-restored-clean-production-probe');
    const readiness = await runM6ProductionReadinessProbe(ctx, worktree, readinessEvidenceDir, {
      candidateSha256: expectedCandidateSha, patchSha256: null, loaderSha256: await pathHash(path.join(worktree, 'src/core-loader.ts')),
    }, { candidateKind: 'clean', buildEvidenceDir: evidenceDir });
    readinessProofPath = path.relative(rootEvidence(), path.join(readinessEvidenceDir, 'm6-production-readiness.json')).split(path.sep).join('/');
    lifecycleBrowserProvenance = await captureM6LifecycleBrowserProvenance(worktree, expectedCandidateSha, lifecycleBuildReceipt);
  }
  const gate = await commandRunner(ctx, `${label}-pnpm-acceptance-production-lifecycle`, 'pnpm', ['acceptance:production-lifecycle'], worktree, evidenceDir, {
    timeoutMs: 180_000, minimumMs: 45_000, env: { TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR: evidenceDir },
  });
  const summary = await readJson(path.join(evidenceDir, 'summary.json')).catch(() => null);
  const candidate = summary?.candidateIdentity ?? summary?.identity?.candidate;
  let lifecycleAuxiliaryEvidence = null;
  if (label === 'm6-restored-clean') {
    const lifecycleReceiptPath = path.join(evidenceDir, 'production-lifecycle', 'production-lifecycle.seed.json');
    const lifecycleReceipt = await readJson(lifecycleReceiptPath).catch(() => null);
    const lifecycleSummaryPath = path.join(evidenceDir, 'production-lifecycle', 'summary.json');
    const lifecycleSummary = await readJson(lifecycleSummaryPath).catch(() => null);
    const buildReceiptPath = path.join(evidenceDir, 'production-build.json');
    const buildReceipt = lifecycleBuildReceipt ?? await readJson(buildReceiptPath).catch(() => null);
    const faviconProbe = await probeM6LifecycleOriginFavicon(ctx, worktree,
      path.join(evidenceDir, 'm6-restored-clean-lifecycle-favicon-probe'), 'm6-restored-clean', lifecycleReceipt);
    lifecycleAuxiliaryEvidence = { lifecycleReceiptPath, lifecycleReceipt, lifecycleSummaryPath, lifecycleSummary, browserProvenance: lifecycleBrowserProvenance,
      lifecycleReceiptSha256: lifecycleReceipt ? await pathHash(lifecycleReceiptPath) : null,
      buildReceiptPath, buildReceipt, buildReceiptSha256: buildReceipt ? await pathHash(buildReceiptPath) : null, faviconProbe };
  }
  if (gate.result.code !== 0 || summary?.gates?.productionLifecycle !== 'PASS' || candidate?.sha256 !== expectedCandidateSha) {
    return { status: 'BLOCKED', step: 'clean production lifecycle', gate: gate.command, summaryStatus: summary?.status ?? 'MISSING', readinessProofPath, lifecycleAuxiliaryEvidence };
  }
  return { status: 'PASS', build, gate: gate.command, candidateIdentity: candidate.sha256, caseId: productionCase, readinessProofPath, lifecycleAuxiliaryEvidence };
}

async function runM6ProductionLifecycle(ctx, worktree, evidenceDir, expectedCandidateSha) {
  const buildReceiptPath = path.join(evidenceDir, 'production-build.json');
  const buildReceipt = await readJson(buildReceiptPath).catch(() => null);
  const browserProvenance = await captureM6LifecycleBrowserProvenance(worktree, expectedCandidateSha, buildReceipt);
  const run = await commandRunner(ctx, 'm6-frozen-pnpm-acceptance-production-lifecycle', 'pnpm', ['acceptance:production-lifecycle'], worktree, evidenceDir, {
    timeoutMs: 180_000, minimumMs: 45_000, env: { TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR: evidenceDir },
  });
  const summary = await readJson(path.join(evidenceDir, 'production-lifecycle', 'summary.json')).catch(() => null);
  const receiptPath = path.join(evidenceDir, 'production-lifecycle', 'production-lifecycle.seed.json');
  const receipt = await readJson(receiptPath).catch(() => null);
  const candidate = summary?.candidate?.sha256;
  const status = summary?.status === 'BEHAVIORAL_RED' && run.result.outcome === 'EXITED' && run.result.code === 1
    && candidate === expectedCandidateSha ? 'BEHAVIORAL_RED' : 'BLOCKED';
  const faviconProbe = await probeM6LifecycleOriginFavicon(ctx, worktree, path.join(evidenceDir, 'm6-lifecycle-favicon-probe'),
    'm6-mutant', receipt);
  return { status,
    command: run.command, outcome: run.result.outcome, exitCode: run.result.code, candidateIdentity: candidate ?? null,
    summary, receipt, receiptPath, receiptSha256: receipt ? await pathHash(receiptPath) : null,
    buildReceipt, buildReceiptSha256: buildReceipt ? await pathHash(buildReceiptPath) : null, browserProvenance,
    faviconProbe };
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
      const old = await runOldProductAcceptance(ctx, worktree, evidenceDir);
      record.oldGate = { ...old, sameMutantCandidate: old.candidateIdentity === record.mutantIdentity.sha256 };
      if (old.status !== 'PASS' || old.candidateIdentity !== record.mutantIdentity.sha256) throw new Error('M6 unchanged pnpm acceptance:product old gate was not GREEN on the same mutant identity after generated evidence restoration.');
      const fresh = await runAcceptance(ctx, worktree, evidenceDir, 'm6-gate');
      const freshCandidate = fresh.summary?.identity?.candidate;
      record.freshSaveClosure = { status: fresh.status === 'PASS' && fresh.exitCode === 0 && fresh.commandOutcome === 'EXITED' ? 'PASS' : 'BLOCKED', command: fresh.command, candidateIdentity: freshCandidate?.sha256 ?? null };
      if (record.freshSaveClosure.status !== 'PASS' || freshCandidate?.sha256 !== record.mutantIdentity.sha256) throw new Error('M6 fresh save-closure prerequisites/current receipts are not PASS for the unchanged mutant identity.');
      const built = await runBuildAndCleanProduction(ctx, worktree, fresh.outputDir, 'm6-mutant');
      record.productionBuild = built;
      if (built.status !== 'PASS') throw new Error(`M6 fresh production build did not qualify: ${built.step}`);
      const beforeProbe = await captureCandidateIdentity(worktree);
      if (beforeProbe.sha256 !== record.mutantIdentity.sha256) throw new Error('M6 product patch identity changed before the production lifecycle assertion.');
      const probe = await runM6ProductionReadinessProbe(ctx, worktree, path.join(evidenceDir, 'm6-production-probe'), {
        candidateSha256: record.mutantIdentity.sha256, patchSha256: record.fault.patchSha256,
        loaderSha256: record.fault.sourceHashesAfterPatch?.['src/core-loader.ts'],
      }, { candidateKind: 'mutant', buildEvidenceDir: fresh.outputDir });
      const mutantBuildReceipt = await readJson(path.join(fresh.outputDir, 'production-build.json')).catch(() => null);
      const readinessDisposition = probe.status === 'READINESS_PASS' ? { status: 'STRICT_PASS' }
        : classifyM6ReadinessFaviconDisposition(probe, { candidateSha256: record.mutantIdentity.sha256,
          patchSha256: record.fault.patchSha256, loaderSha256: record.fault.sourceHashesAfterPatch?.['src/core-loader.ts'] }, mutantBuildReceipt);
      record.productionReadiness = { status: probe.status,
        disposition: readinessDisposition,
        proof: path.relative(rootEvidence(), path.join(evidenceDir, 'm6-production-probe', 'm6-production-readiness.json')).split(path.sep).join('/'),
        httpIndexStatus: probe.httpIndexStatus, productionAssetStatus: probe.productionAssetStatus,
        browserNavigationStatus: probe.browserNavigationStatus, cdpReady: probe.cdpReady, browserVersion: probe.browserVersion,
        diagnostics: probe.diagnostics, reason: probe.reason ?? null };
      if (probe.status !== 'READINESS_PASS' && readinessDisposition.status !== 'AUXILIARY_CANDIDATE') {
        throw new Error(`M6 independent production HTTP/browser readiness did not qualify: ${probe.reason ?? readinessDisposition.reason ?? probe.status}`);
      }
      const lifecycle = await runM6ProductionLifecycle(ctx, worktree, fresh.outputDir, record.mutantIdentity.sha256);
      const lifecycleDisposition = classifyM6LifecycleFaviconDisposition(lifecycle.receipt, lifecycle.summary,
        lifecycle.buildReceipt, lifecycle.faviconProbe, record.mutantIdentity.sha256, probe, 'BEHAVIORAL_RED', lifecycle.browserProvenance);
      record.m6MutantLifecycleEvidence = { receipt: lifecycle.receipt, receiptPath: lifecycle.receiptPath,
        receiptSha256: lifecycle.receiptSha256, summary: lifecycle.summary, buildReceipt: lifecycle.buildReceipt,
        buildReceiptSha256: lifecycle.buildReceiptSha256, faviconProbe: lifecycle.faviconProbe,
        browserProvenance: lifecycle.browserProvenance,
        disposition: lifecycleDisposition };
      if (lifecycle.status !== 'BEHAVIORAL_RED') throw new Error(`M6 frozen production lifecycle did not reach its intended assertion: ${lifecycle.summary?.status ?? lifecycle.status}`);
      if (probe.status !== 'READINESS_PASS' && lifecycleDisposition.status !== 'AUXILIARY_CANDIDATE') {
        throw new Error(`M6 frozen production lifecycle favicon provenance did not qualify: ${lifecycleDisposition.reason ?? lifecycleDisposition.status}`);
      }
      record.productionAssertion = { status: 'PENDING_CLEAN_PARITY', command: lifecycle.command,
        receipt: path.relative(rootEvidence(), lifecycle.receiptPath).split(path.sep).join('/'),
        receiptSha256: lifecycle.receiptSha256, lifecycleStatus: lifecycle.summary?.status ?? 'MISSING',
        lifecyclePhase: lifecycle.receipt?.phase ?? null,
        assertion: lifecycle.receipt?.error?.message ?? null, browserVersion: lifecycle.receipt?.processEvidence?.[0]?.browserVersion ?? probe.browserVersion,
        disposition: lifecycleDisposition };
      const afterProbe = await captureCandidateIdentity(worktree);
      if (afterProbe.sha256 !== record.mutantIdentity.sha256) throw new Error('M6 product patch identity changed during readiness qualification or the frozen production assertion.');
      record.status = 'NOT RUN';
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
    const clean = await runAcceptance(ctx, root, cleanDir, `${definition.id.toLowerCase()}-restored-clean`);
    record.cleanAfterRestore = requireCleanAcceptance(clean.summary, cleanCandidate, cleanCandidate.head);
    record.cleanAfterRestore.command = clean.command;
    record.cleanAfterRestore.commandOutcome = clean.commandOutcome;
    record.cleanAfterRestore.exitCode = clean.exitCode;
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
      if (prod.readinessProofPath) {
        const mutantProof = await readJson(path.join(evidenceDir, 'm6-production-probe', 'm6-production-readiness.json')).catch(() => null);
        const cleanProof = await readJson(path.join(rootEvidence(), prod.readinessProofPath)).catch(() => null);
        record.diagnosticComparison = compareM6DiagnosticEvidence(mutantProof, cleanProof);
      }
      const mutantLifecycle = record.m6MutantLifecycleEvidence;
      const cleanLifecycle = prod.lifecycleAuxiliaryEvidence;
      if (prod.status === 'PASS' && mutantLifecycle && cleanLifecycle && record.diagnosticComparison) {
        const mutantProofPath = path.join(evidenceDir, 'm6-production-probe', 'm6-production-readiness.json');
        const cleanProofPath = path.join(rootEvidence(), prod.readinessProofPath);
        const mutantProof = await readJson(mutantProofPath).catch(() => null);
        const cleanProof = await readJson(cleanProofPath).catch(() => null);
        const mutantBuildReceipt = mutantLifecycle.buildReceipt;
        const cleanBuildReceipt = cleanLifecycle.buildReceipt;
        const disposition = finalizeM6AuxiliaryDisposition({
          mutantReadiness: mutantProof,
          cleanReadiness: cleanProof,
          mutantIdentity: { candidateSha256: record.mutantIdentity.sha256 },
          cleanIdentity: { candidateSha256: cleanCandidate.sha256 },
          mutantBuildReceipt,
          cleanBuildReceipt,
          mutantLifecycle: { receipt: mutantLifecycle.receipt, summary: mutantLifecycle.summary,
            buildReceipt: mutantBuildReceipt, faviconProbe: mutantLifecycle.faviconProbe,
            browserProvenance: mutantLifecycle.browserProvenance },
          cleanLifecycle: { receipt: cleanLifecycle.lifecycleReceipt, summary: cleanLifecycle.lifecycleSummary,
            buildReceipt: cleanBuildReceipt, faviconProbe: cleanLifecycle.faviconProbe,
            browserProvenance: cleanLifecycle.browserProvenance },
          comparison: record.diagnosticComparison,
          mutantReadinessSha256: await pathHash(mutantProofPath).catch(() => null),
          cleanReadinessSha256: await pathHash(cleanProofPath).catch(() => null),
          mutantLifecycleReceiptSha256: mutantLifecycle.receiptSha256,
          cleanLifecycleReceiptSha256: cleanLifecycle.lifecycleReceiptSha256,
        });
        record.auxiliaryDisposition = disposition;
        await writeMutationJson(path.join(evidenceDir, 'm6-auxiliary-disposition.json'), disposition);
        const productionAssertion = classifyM6ProductionProof(mutantProof, mutantLifecycle.receipt,
          { candidateSha256: record.mutantIdentity.sha256, patchSha256: record.fault.patchSha256,
            loaderSha256: record.fault.sourceHashesAfterPatch?.['src/core-loader.ts'] }, {
            disposition,
            mutantBuildReceipt,
            mutantLifecycleSummary: mutantLifecycle.summary,
            mutantLifecycleFaviconProbe: mutantLifecycle.faviconProbe,
            mutantLifecycleBrowserProvenance: mutantLifecycle.browserProvenance,
            mutantReadinessSha256: disposition.receipts.mutantReadinessSha256,
            mutantLifecycleReceiptSha256: disposition.receipts.mutantLifecycleReceiptSha256,
          });
        record.productionAssertion = { ...record.productionAssertion, ...productionAssertion,
          assertion: mutantLifecycle.receipt?.error?.message ?? null,
          auxiliaryDisposition: path.relative(rootEvidence(), path.join(evidenceDir, 'm6-auxiliary-disposition.json')).split(path.sep).join('/') };
        record.status = productionAssertion.status;
        if (record.status !== 'BEHAVIORAL_RED') ctx.stopAfterMutation = true;
      } else {
        record.status = 'BLOCKED';
        record.productionAssertion = { ...record.productionAssertion, status: 'BLOCKED',
          reason: 'M6 mutant and restored-clean readiness/lifecycle receipts plus parity comparison are required before final classification.' };
        ctx.stopAfterMutation = true;
      }
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
  const cases = [
    { name: 'immediate-clean-saved-closed', result: executeFrozenSaveControl(driver, { observations: [{ status: 'Saved on this device', saveDialogOpen: false }] }), expected: 'PASS' },
    { name: 'actual-save-failed-reaches-explicit-saved-assertion', result: executeFrozenSaveControl(driver, { observations: [{ status: 'Save failed', saveDialogOpen: true }] }), expected: 'BEHAVIORAL_RED' },
    { name: 'stale-saved-current-dialog-open', result: executeFrozenSaveControl(driver, { observations: [{ status: 'Saved on this device', saveDialogOpen: true }] }), expected: 'BLOCKED' },
    { name: 'missing-status', result: executeFrozenSaveControl(driver, { observations: [{ status: null, saveDialogOpen: true }] }), expected: 'BLOCKED' },
    { name: 'indefinitely-saving-no-terminal', result: executeFrozenSaveControl(driver, { observations: [{ status: 'Saving…', saveDialogOpen: true }, { status: 'Saving…', saveDialogOpen: true }] }), expected: 'BLOCKED' },
    { name: 'navigation-failure', result: executeFrozenSaveControl(driver, { infrastructureError: new Error('NavigationError: navigation failed') }), expected: 'BLOCKED' },
    { name: 'transport-failure', result: executeFrozenSaveControl(driver, { infrastructureError: new Error('TransportError: CDP connection closed') }), expected: 'BLOCKED' },
  ];
  const passed = cases.every((item) => item.result.status === item.expected)
    && baselineHashes['tests/product/web-save-closure-current.mjs'] === expectedSeeds['tests/product/web-save-closure-current.mjs'];
  const result = {
    status: passed ? 'PASS' : 'BLOCKED', cases,
    sourceDriverSha256: baselineHashes['tests/product/web-save-closure-current.mjs'],
    sourceAssertionExecution: 'the exact waitForFunction predicate and explicit Saved assertion are extracted from the frozen driver and executed for these separate controls',
    note: 'Synthetic control receipts remain separate; they do not replace actual M1 or clean preservation/reopen runs.',
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
    ctx.summary.hostedProductEvidenceReconciliation = await reconcileHostedProductEvidence(root);
    ctx.candidate = await captureCandidateIdentity(root);
    ctx.summary.candidate = ctx.candidate;
    ctx.summary.prIdentity = await validateAuthorizedCandidate(root, ctx.candidate.head);
    if (ctx.candidate.dirtyFiles.length) throw new Error(`clean qualification checkout is dirty before mutations: ${ctx.candidate.dirtyFiles.map(([file]) => file).join(', ')}`);
    const baseStatus = await git(['status', '--porcelain=v1', '-z'], { cwd: root });
    if (baseStatus.code !== 0 || baseStatus.output) throw new Error('candidate checkout is not clean before mutations.');
    const cleanEvidence = await readCleanGate(evidenceDir);
    if (cleanEvidence.save !== 'PASS' || cleanEvidence.prod !== 'PASS'
      || !cleanGateCandidateMatches(cleanEvidence.candidate, ctx.candidate, ctx.summary.hostedProductEvidenceReconciliation.generated)) {
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
      await runOneMutation(ctx, definition, baselineHashes, ctx.candidate);
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
