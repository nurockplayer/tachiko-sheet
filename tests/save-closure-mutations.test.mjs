import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyM6OpenProof,
  classifyMutationReceipt,
  classifySaveTerminalObservation,
} from '../scripts/run-save-closure-mutations.mjs';

const currentCases = [
  'A-Date-only-normal-Save-fresh-reopen', 'B-same-table-Date-summary-refusal',
  'C-unrelated-Date-summary-refusal', 'C-empty-unrelated-Date-schema-refusal',
  'D-canonical-opaque-complete-copy-controls', 'E-CSV64-row-control', 'E-CSV16-column-control',
  'E-profile-refusal-rows-65.csv', 'E-profile-refusal-fields-17.csv',
  'F-existing-read-fault-no-publication-recovery', 'R-unchanged-private-reader-Date-fixture',
];

test('Save terminal observation requires a fresh closed-dialog Saved state', () => {
  assert.equal(classifySaveTerminalObservation('Saved on this device', false), 'SAVED');
  assert.equal(classifySaveTerminalObservation('Save failed', true), 'SAVE_FAILED');
  assert.equal(classifySaveTerminalObservation('Saved on this device', true), 'PENDING');
  assert.equal(classifySaveTerminalObservation(null, false), 'PENDING');
  assert.equal(classifySaveTerminalObservation('Saving…', false), 'PENDING');
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

test('M6 is RED only after HTTP, CDP, browser, cold Home, Open and loader-specific refusal qualify', () => {
  const qualified = {
    httpIndexStatus: 200, productionAssetStatus: 200, browserNavigationStatus: 200, cdpReady: true,
    browserVersion: 'Chrome/136.0.0.0', coldHomeReady: true, openClicked: true,
    mutantCandidateIdentity: 'a'.repeat(64), mutationPatchSha256: 'b'.repeat(64), mutatedLoaderSha256: 'c'.repeat(64),
    openOutcome: 'refused', alertText: 'Couldn’t open the sales example. Nothing was changed.',
  };
  assert.equal(classifyM6OpenProof(qualified).status, 'BEHAVIORAL_RED');
  assert.equal(classifyM6OpenProof({ ...qualified, productionAssetStatus: 403 }).status, 'BLOCKED');
  assert.equal(classifyM6OpenProof({ ...qualified, openOutcome: 'timeout' }).status, 'BLOCKED');
  assert.equal(classifyM6OpenProof({ ...qualified, alertText: 'A different Open failure' }).status, 'BLOCKED');
  assert.equal(classifyM6OpenProof({ ...qualified, openOutcome: 'ready' }).status, 'BLOCKED');
  assert.equal(classifyM6OpenProof({ ...qualified, mutatedLoaderSha256: null }).status, 'BLOCKED');
});
