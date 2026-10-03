import assert from 'node:assert/strict';
import {assertSelectedContext,assertNeutralContext,assertStableGrid,RELEASE_ROWS,RELEASE_FIELDS} from './focused-cell-context-oracles.mjs';

// Assertion controls only. These are not workbook or component PASS evidence.
export function runContextOracleFalsifiers() {
  const row=RELEASE_ROWS[0];
  const expected={entity:row.entity,field:RELEASE_FIELDS.priority,column:'priority',row:1,value:'8',source:row.source};
  const actual={name:'Cell context',role:'region',exposed:true,
    context:{occurrence:'occ-current',revision:'rev-current',currentness:'current',entity:row.entity,field:RELEASE_FIELDS.priority},
    selected:[{entity:row.entity,field:RELEASE_FIELDS.priority,occurrence:'occ-current',revision:'rev-current'}],selectedRowCount:0,
    table:'release_items',column:'priority',row:'Row 1',type:'Number',value:'8',source:row.source,valueHeading:'Calculated value',editableSourceCount:0,observationErrors:[]};
  assertSelectedContext(actual,expected);
  const mutations=[['misleading name',{name:'cellulose panel'}],['negated table',{table:'not-release_items'}],['negated column',{column:'not-priority'}],['wrong row',{row:'Row 2'}],['misleading type',{type:'not-a-numberish-type'}],['stale recovered value under current metadata',{value:'10'}],['selected row alongside one cell',{selectedRowCount:1}]];
  const cases=mutations.map(([name,change])=>{assert.throws(()=>assertSelectedContext({...actual,...change},expected));return {name,rejected:true};});
  assert.throws(()=>assertNeutralContext({...actual,source:null}));
  cases.push({name:'stale neutral identity/value with null source',rejected:true});
  const grid={x:10,y:10,width:200};assertStableGrid({grid},{grid});
  assert.throws(()=>assertStableGrid({grid},{grid:{...grid,x:12}}));
  cases.push({name:'horizontal grid origin shift',rejected:true});
  return {status:'PASS',cases,scope:'assertion falsifiers only; no product/component acceptance'};
}
