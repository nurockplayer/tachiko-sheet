import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { installPublishedTablePatcher } from "./published-table-patcher.mjs";

async function recorder() {
  const window = {};
  await installPublishedTablePatcher({
    addInitScript: script => runInNewContext(`(${script})()`, { window, structuredClone }),
  });
  return window;
}

function table(revision, collection = "sales", includeChangedRow = true) {
  return {
    revision: `resident/${revision}`,
    collection: { id: collection },
    columns: [{ id: "amount" }],
    rows: includeChangedRow ? [{ id: "new-row", fields: [
      { target: { entity: "new-row", field: "amount" }, stored: { kind: "number", value: 42 } },
    ] }] : [],
  };
}

function openGap(window, record, revision) {
  window.__trackPublished(record, {
    base_revision: `resident/${revision - 1}`,
    resulting_revision: `resident/${revision}`,
    changed: table(revision).rows[0].fields,
  });
  assert.equal(record.stale, true);
}

for (const [label, reply] of [
  ["unrelated collection at the resulting revision", table(10, "other")],
  ["unrelated collection at a later revision", table(11, "other")],
  ["older revision with the changed target present", table(9)],
]) {
  test(`${label} cannot clear an open gap`, async () => {
    const window = await recorder();
    const record = {};
    window.__trackObservedTable(record, table(9, "sales", false));
    openGap(window, record, 10);
    window.__trackObservedTable(record, reply);
    assert.equal(record.stale, true);
    assert.equal(record.gaps[0].resolved, false);
    assert.equal(window.__observerGaps, 1);
    assert.throws(() => window.__readObservedTable(record), /observer stale: resident\/10/);
  });
}

for (const revision of [10, 11]) {
  test(`same collection at revision ${revision} covers the gap`, async () => {
    const window = await recorder();
    const record = {};
    window.__trackObservedTable(record, table(9, "sales", false));
    openGap(window, record, 10);
    const reply = table(revision);
    window.__trackObservedTable(record, reply);
    assert.equal(record.stale, false);
    assert.equal(record.gaps[0].resolved, true);
    assert.equal(window.__observerGaps, 0);
    assert.equal(window.__readObservedTable(record), reply);
    window.__trackObservedTable(record, reply);
    assert.equal(window.__observerGaps, 0);
  });
}

test("every open gap must be covered before the table can be read", async () => {
  const window = await recorder();
  const record = {};
  window.__trackObservedTable(record, table(8, "sales", false));
  openGap(window, record, 9);
  openGap(window, record, 10);
  window.__trackObservedTable(record, table(9));
  assert.equal(record.gaps[0].resolved, true);
  assert.equal(record.gaps[1].resolved, false);
  assert.equal(record.stale, true);
  assert.equal(window.__observerGaps, 1);
  assert.throws(() => window.__readObservedTable(record), /observer stale: resident\/10/);
  const reply = table(11);
  window.__trackObservedTable(record, reply);
  assert.equal(record.stale, false);
  assert.equal(window.__observerGaps, 0);
  assert.equal(window.__readObservedTable(record), reply);
});
