// Fixed user oracles from accepted #129 comment5913767841 and unchanged fixture.
// No expected source is read from the implementation or reconstructed by tests.
import assert from 'node:assert/strict';

export const RELEASE_FIELDS = Object.freeze({
  impact: '52a0f7e9-4d6b-4628-ad7d-6b649f8c8a77',
  priority: '75f3d634-452c-4838-925b-8c52e54fc972',
});
export const RELEASE_ROWS = Object.freeze([
  Object.freeze({entity:'1d37df46-01f6-4b05-8fd9-064718dc91ea',row:1,value:'10',source:'([release_scope.impact] + [release_scope.friction])'}),
  Object.freeze({entity:'2a80fa52-df19-4e75-992c-ed92b7194970',row:2,value:'9',source:'([playtest_notes.impact] + [playtest_notes.friction])'}),
  Object.freeze({entity:'3c7d2a33-66b4-4f02-b590-8c6f2d9ecdf1',row:3,value:'8',source:'([import_bridge.impact] + [import_bridge.friction])'}),
]);

export function assertSelectedContext(actual, expected) {
  assert.ok(actual.context, 'active cell exposes an accessible context region');
  assert.match(actual.name, /cell/i, 'context has a screen-reader name');
  assert.equal(actual.selected.length, 1, 'only the active cell is aria-selected');
  assert.equal(actual.selected[0].entity, expected.entity);
  assert.equal(actual.selected[0].field, expected.field);
  assert.equal(actual.context.occurrence, actual.selected[0].occurrence, 'context follows admitted occurrence');
  assert.equal(actual.context.revision, actual.selected[0].revision, 'context follows the current projected revision');
  assert.equal(actual.context.currentness, 'current');
  assert.ok(actual.location.includes('release_items'));
  assert.ok(actual.location.includes(expected.column));
  assert.match(actual.location, new RegExp(`Row\\s+${expected.row}(?:\\D|$)`));
  assert.match(actual.type, /number/i);
  assert.equal(actual.value, expected.value);
  assert.equal(actual.source, expected.source ?? null, 'only exact per-instance source is shown');
  if (expected.source != null) assert.match(actual.valueHeading, /Calculated value/);
  else assert.doesNotMatch(actual.valueHeading, /Calculated value/);
  assert.equal(actual.editableSourceCount, 0, 'source is read-only');
}

export function assertWithheldContext(actual, prior) {
  assert.equal(actual.source, null, 'unconfirmed context withholds prior exact source');
  assert.ok(actual.value === null || actual.value === '' || /awaiting confirmation|unavailable|refresh to confirm current values/i.test(actual.value), 'no stale successful value');
  assert.doesNotMatch(actual.location, /release_items|priority|impact/, 'unknown context withholds old identity');
  assert.ok(!actual.context || actual.context.currentness !== 'current');
  assert.ok(!actual.allContextText.includes(prior.source));
}
