import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/product.yml', root), 'utf8');

function workflowStep(name) {
  const marker = `      - name: "${name}"`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const next = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, next === -1 ? undefined : next);
}

function matchesAuthorizedCandidate(event) {
  return event.name === 'pull_request' && event.pullRequestNumber === 147;
}

test('candidate mutation qualification stays on PR 147 and ordinary clean gates remain general', async () => {
  const step = workflowStep('Run serial Sheet #146 save-closure mutation qualification');
  const condition = step.match(/^\s+if:\s*(.+)$/m)?.[1];
  assert.equal(condition, "github.event_name == 'pull_request' && github.event.pull_request.number == 147");

  assert.equal(matchesAuthorizedCandidate({ name: 'pull_request', pullRequestNumber: 147 }), true);
  assert.equal(matchesAuthorizedCandidate({ name: 'pull_request', pullRequestNumber: 148 }), false);
  assert.equal(matchesAuthorizedCandidate({ name: 'push', branch: 'main' }), false);
  assert.equal(matchesAuthorizedCandidate({ name: 'workflow_dispatch' }), false);

  for (const name of [
    'Run Sheet #146 Save closure acceptance',
    'Run Sheet #146 production lifecycle acceptance',
    'Check Sheet #146 mutation workflow scope',
  ]) {
    assert.doesNotMatch(workflowStep(name), /^\s+if:/m, `${name} must remain on the general route`);
  }
  assert.match(workflow, /pull_request:\n  push:\n    branches:\n      - main/);
});
