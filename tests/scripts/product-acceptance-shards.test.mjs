import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignShards, selectSteps, verifyShardSummaries } from '../../scripts/product-acceptance-shards.mjs';

const runner = fileURLToPath(new URL('../../scripts/run-product-acceptance.mjs', import.meta.url));
const verifier = fileURLToPath(new URL('../../scripts/verify-product-acceptance-shards.mjs', import.meta.url));
const names = JSON.parse(execFileSync(process.execPath, [runner, '--list'], {
  encoding: 'utf8', env: { ...process.env, TACHIKO_ACCEPTANCE_SHARD: '' },
}));
const steps = names.map((name) => ({ name }));
const durations = JSON.parse(await readFile(new URL('../../scripts/product-acceptance-durations.json', import.meta.url)));
const needs = Object.fromEntries(['checks', 'acceptance', 'save-closure'].map((name) => [name, { result: 'success' }]));
const summaries = () => assignShards(steps, durations, 4).map((selected, i) => ({
  shard: `${i + 1}/4`, status: 'PASS', selectedSteps: selected.map(({ name }) => name),
  summary: selected.map(({ name }) => ({ step: name, status: 'PASS', exitCode: 0 })),
}));

test('--list exposes all 49 steps in the original runner order without setup', () => {
  assert.equal(names.length, 49);
  assert.deepEqual(names, Object.keys(durations));
  assert.equal(names[0], 'workbook-tabs-local');
  assert.equal(names.at(-1), 'dialog-operation-recovery-local-transport');
});

test('greedy assignment is deterministic with name and shard-index ties', () => {
  const input = ['z', 'b', 'a', 'c'].map((name) => ({ name }));
  assert.deepEqual(assignShards(input, { z: 40, a: 20, b: 20, c: 10 }, 2)
    .map((shard) => shard.map(({ name }) => name)), [['z', 'c'], ['b', 'a']]);
  for (let count = 1; count <= 6; count++) {
    const assigned = assignShards(steps, durations, count);
    assert.deepEqual(assigned, assignShards([...steps].reverse(), durations, count)
      .map((shard) => steps.filter((step) => shard.includes(step))));
    assert.deepEqual(assigned.flat().map(({ name }) => name).sort(), [...names].sort());
    for (let i = 0; i < count; i++) {
      assert.deepEqual(selectSteps(steps, durations, `${i + 1}/${count}`).steps, assigned[i]);
      assert.deepEqual(assigned[i], steps.filter((step) => assigned[i].includes(step)));
    }
  }
});

test('unknown steps receive 30 seconds and are never dropped', () => {
  const input = ['long', 'unknown', 'short'].map((name) => ({ name }));
  assert.deepEqual(assignShards(input, { long: 31, short: 29 }, 2)
    .map((shard) => shard.map(({ name }) => name)), [['long'], ['unknown', 'short']]);
});

test('unset shard selects everything; malformed shard fails closed', () => {
  assert.deepEqual(selectSteps(steps, durations, undefined), { shard: '1/1', steps });
  for (const shard of ['', '0/4', '5/4', '1/0', '1.5/4', '1/4x', '1/9007199254740992']) {
    assert.throws(() => selectSteps(steps, durations, shard), /TACHIKO_ACCEPTANCE_SHARD/);
  }
});

test('verifier CLI accepts complete real runner coverage and lists each name once', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sheet-product-shards-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const summary of summaries()) {
    const shardDirectory = path.join(directory, `product-acceptance-shard-${summary.shard[0]}-123-1`);
    await mkdir(shardDirectory);
    await writeFile(path.join(shardDirectory, 'summary.json'), JSON.stringify(summary));
  }
  const result = spawnSync(process.execPath, [verifier, directory], {
    encoding: 'utf8', env: { ...process.env, TACHIKO_ACCEPTANCE_NEEDS: JSON.stringify(needs) },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').slice(0, -1), names);
  await rm(path.join(directory, 'product-acceptance-shard-1-123-1', 'summary.json'));
  const missing = spawnSync(process.execPath, [verifier, directory], {
    encoding: 'utf8', env: { ...process.env, TACHIKO_ACCEPTANCE_NEEDS: JSON.stringify(needs) },
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /summary.json/);
});

test('partial reruns reuse earlier successes and require the latest evidence for each shard', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sheet-product-rerun-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const all = summaries();
  for (const summary of all) {
    const artifact = path.join(directory, `product-acceptance-shard-${summary.shard[0]}-123-1`);
    await mkdir(artifact);
    await writeFile(path.join(artifact, 'summary.json'), JSON.stringify(summary));
  }
  const verify = () => spawnSync(process.execPath, [verifier, directory], {
    encoding: 'utf8', env: { ...process.env, TACHIKO_ACCEPTANCE_NEEDS: JSON.stringify(needs) },
  });
  // Only save-closure reruns: all four artifacts still belong to attempt 1.
  assert.equal(verify().status, 0);
  const retry = path.join(directory, 'product-acceptance-shard-1-123-2');
  await mkdir(retry);
  const retrySummary = path.join(retry, 'summary.json');
  await writeFile(retrySummary, JSON.stringify({ ...all[0], status: 'FAIL' }));
  assert.equal(verify().status, 1, 'latest failure must override earlier PASS');
  await writeFile(retrySummary, JSON.stringify(all[0]));
  await writeFile(path.join(directory, 'product-acceptance-shard-1-123-1', 'summary.json'),
    JSON.stringify({ ...all[0], status: 'FAIL' }));
  const recovered = verify();
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(recovered.stdout.trim().split('\n').slice(0, -1), names);
  await rm(retrySummary);
  assert.equal(verify().status, 1, 'missing latest summary must not fall back');
});

for (const [name, change, error] of [
  ['missing shard', (all) => all.pop(), /Expected 4/],
  ['duplicate shard', (all) => { all[1].shard = all[0].shard; }, /duplicate shard/],
  ['duplicate step', (all) => all[1].selectedSteps.push(all[0].selectedSteps[0]), /Duplicate step/],
  ['missing step', (all) => all[0].selectedSteps.pop(), /Missing step/],
  ['FAIL summary', (all) => { all[0].status = 'FAIL'; }, /did not PASS/],
  ['missing result', (all) => { all[0].summary = []; }, /step result/],
  ['failed result', (all) => { all[0].summary[0].exitCode = 1; }, /step result/],
]) {
  test(`verifier rejects ${name}`, () => {
    const all = summaries();
    change(all);
    assert.throws(() => verifyShardSummaries(names, all, needs), error);
  });
}

for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
  test(`verifier rejects non-success need: ${result}`, () => {
    for (const name of Object.keys(needs)) {
      const failedNeeds = { ...needs, [name]: { result } };
      assert.throws(() => verifyShardSummaries(names, summaries(), failedNeeds), /did not succeed/);
    }
  });
}
