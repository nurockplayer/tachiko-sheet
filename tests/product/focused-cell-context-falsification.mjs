import assert from 'node:assert/strict';
import {assertSelectedContext,assertNeutralContext,assertWithheldContext,assertStableGrid,RELEASE_ROWS,RELEASE_FIELDS} from './focused-cell-context-oracles.mjs';
import {contextSnapshotFromObservation} from './focused-cell-dom-observation.mjs';

// Assertion controls only. These are not workbook or component PASS evidence.
export function runContextOracleFalsifiers() {
  const row=RELEASE_ROWS[0];
  const expected={entity:row.entity,field:RELEASE_FIELDS.priority,column:'priority',row:1,value:'8',source:row.source};
  const empty=()=>Object.fromEntries(['location','table','column','row','type','value','value-heading','source','diagnostic'].map(key=>[key,{count:0,exposed:false,text:null}]));
  const fields=empty();for(const [key,text] of Object.entries({location:'release_items › priority · Row 1',table:'release_items',column:'priority',row:'Row 1',type:'Number',value:'8','value-heading':'Calculated value',source:row.source}))fields[key]={count:1,exposed:true,text};
  const observation={rootCount:1,connected:true,name:'Cell context',role:'region',exposed:true,
    context:{occurrence:'occ-current',revision:'rev-current',currentness:'current',entity:row.entity,field:RELEASE_FIELDS.priority},
    selected:[{entity:row.entity,field:RELEASE_FIELDS.priority,occurrence:'occ-current',revision:'rev-current'}],selectedRowCount:0,
    fields,allVisibleText:'release_items › priority · Row 1 8 '+row.source,editableSourceCount:0};
  const actual=contextSnapshotFromObservation(observation);assertSelectedContext(actual,expected);
  const mutations=[['misleading name','name','cellulose panel'],['negated table','table','not-release_items'],['negated column','column','not-priority'],['wrong row','row','Row 2'],['misleading type','type','not-a-numberish-type'],['stale recovered value under current metadata','value','10'],['selected row alongside one cell','selectedRowCount',1]];
  const cases=mutations.map(([name,key,value])=>{
    const changed=structuredClone(observation);if(changed.fields[key])changed.fields[key].text=value;else changed[key]=value;
    assert.throws(()=>assertSelectedContext(contextSnapshotFromObservation(changed),expected));return {name,rejected:true};
  });
  assert.throws(()=>assertNeutralContext({...actual,source:null}));cases.push({name:'stale neutral identity/value with null source',rejected:true});
  const grid={x:10,y:10,width:200};assertStableGrid({grid},{grid});assert.throws(()=>assertStableGrid({grid},{grid:{...grid,x:12}}));cases.push({name:'horizontal grid origin shift',rejected:true});
  for(const state of ['neutral','unknown']) {
    const raw={...observation,context:{currentness:state==='neutral'?'current':'unknown'},selected:[],fields:empty(),allVisibleText:state==='neutral'?'No field selected':'Refresh to confirm current values'};
    raw.fields.value={count:1,exposed:true,text:raw.allVisibleText};
    const check=state==='neutral'?assertNeutralContext:a=>assertWithheldContext(a,row);
    const good=contextSnapshotFromObservation(raw);check(good);
    for(const [name,change] of [
      ['duplicate stale semantic node',a=>{a.fields.value={count:2,exposed:false,text:null};a.allVisibleText+=' 10';}],
      ['unexposed stale source',a=>{a.fields.source={count:1,exposed:false,text:''};}],
      ['duplicate context roots',a=>{a.rootCount=2;}],
    ]) {const changed=structuredClone(raw);change(changed);assert.throws(()=>check(contextSnapshotFromObservation(changed)));cases.push({name:state+' '+name,rejected:true});}
    assert.throws(()=>check({...good,observationErrors:['source']}));cases.push({name:state+' raw errors despite absent entity metadata',rejected:true});
  }
  const home={...observation,rootCount:0,context:null,connected:false,exposed:false,name:'',role:'',selected:[],fields:empty(),allVisibleText:''};
  assertNeutralContext(contextSnapshotFromObservation(home),{root:'home'});
  return {status:'PASS',cases,scope:'raw-observation assertion falsifiers only; no product/component acceptance'};
}
