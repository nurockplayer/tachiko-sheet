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
  assert.ok(actual.context, 'active cell exposes a context region');
  assert.equal(actual.name,'Cell context','exact accessible context name');
  assert.ok(['region','group'].includes(actual.role),'context has admitted region/group semantics');
  assert.equal(actual.exposed,true,'context details are visually and accessibility exposed');
  assert.equal(actual.selected.length, 1, 'only the active cell is aria-selected');
  assert.equal(actual.selectedRowCount,0,'row is only a quiet visual cue, not a selected object');
  assert.equal(actual.selected[0].entity, expected.entity);
  assert.equal(actual.selected[0].field, expected.field);
  assert.equal(actual.context.entity,expected.entity,'context is the exact selected entity');
  assert.equal(actual.context.field,expected.field,'context is the exact selected field');
  assert.ok(typeof actual.context.occurrence==='string'&&actual.context.occurrence.length>0);
  assert.ok(typeof actual.context.revision==='string'&&actual.context.revision.length>0);
  assert.equal(actual.context.occurrence, actual.selected[0].occurrence, 'context follows admitted occurrence');
  assert.equal(actual.context.revision, actual.selected[0].revision, 'context follows the current projected revision');
  assert.equal(actual.context.currentness, 'current');
  assert.equal(actual.table,expected.table??'release_items');
  assert.equal(actual.column,expected.column);
  assert.equal(actual.row,`Row ${expected.row}`);
  assert.equal(actual.type,'Number');
  assert.equal(actual.value, expected.value);
  assert.equal(actual.source, expected.source ?? null, 'only exact per-instance source is shown');
  assert.equal(actual.valueHeading,expected.source!=null?'Calculated value':'Value');
  assert.equal(actual.editableSourceCount, 0, 'source is read-only');
  assert.deepEqual(actual.observationErrors,[],'unique exposed displayed semantic fields');
}

export function assertNeutralContext(actual) {
  assert.equal(actual.selected.length,0,'neutral state has no prior selected cell');
  assert.equal(actual.selectedRowCount,0);
  assert.equal(actual.source,null,'neutral state has no prior source');
  for(const key of ['location','table','column','row','type'])assert.equal(actual[key]??'','',`neutral state withholds prior ${key}`);
  assert.ok([null,'','No field selected'].includes(actual.value),'neutral state has no prior successful value');
  assert.ok(!actual.context?.entity&&!actual.context?.field,'neutral state has no target identity');
}

export function assertWithheldContext(actual, prior) {
  assert.equal(actual.source, null, 'unconfirmed context withholds prior exact source');
  assert.ok([null,'','Awaiting confirmation','Unavailable','Refresh to confirm current values'].includes(actual.value), 'no stale successful value');
  for(const key of ['location','table','column','row','type'])assert.equal(actual[key]??'','',`unknown context withholds old ${key}`);
  assert.ok(!actual.context?.entity&&!actual.context?.field,'unknown context withholds prior target identity');
  assert.ok(!actual.context || actual.context.currentness !== 'current');
  assert.ok(!actual.allContextText.includes(prior.source));
}

export function assertStableGrid(a,b) {
  assert.ok(a.grid&&b.grid);
  assert.ok(Math.abs(a.grid.x-b.grid.x)<=1,'changing cell context preserves horizontal grid origin');
  assert.ok(Math.abs(a.grid.y-b.grid.y)<=1,'changing cell context preserves vertical grid origin');
  assert.ok(Math.abs(a.grid.width-b.grid.width)<=1,'changing context preserves grid width');
}
