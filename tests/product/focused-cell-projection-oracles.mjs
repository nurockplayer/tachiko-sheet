// Disclosed public-projection contract cases. These do not claim real core
// calculation failures. The actual context component must be rendered by the
// implementation's unit adapter; pure selector output alone is insufficient.
import assert from 'node:assert/strict';
const source='[playtest_notes.impact] + 1';
const base={target:{entity:'entity-a',field:'c-priority'},address:'tables/release_items/entity-a/c-priority',stored:null,formula:{source},calculated:null,diagnostics:[],editable_scalar:null};
export const PROJECTION_CASES=Object.freeze([
  {name:'successful calculation',field:{...base,calculated:{status:'value',value:6}},value:'6',source},
  {name:'calculation failure',field:{...base,calculated:{status:'failure',code:'div0',message:'division by zero'},diagnostics:[{code:'div0',message:'division by zero',path:'c-priority'}]},value:'Calculation failed',source,diagnostic:'division by zero'},
  {name:'explicit unavailable',field:{...base,calculated:{status:'unavailable'}},value:'No confirmed result',source},
  {name:'source without current result',field:{...base},value:'No confirmed result',source},
  {name:'failure cannot fall back to stored success',field:{...base,stored:{kind:'number',value:123},calculated:{status:'failure',code:'div0',message:'division by zero'}},value:'Calculation failed',source,forbidden:'123'},
  {name:'unavailable cannot fall back to stored success',field:{...base,stored:{kind:'number',value:123},calculated:{status:'unavailable'}},value:'No confirmed result',source,forbidden:'123'},
  {name:'ordinary scalar zero',field:{...base,stored:{kind:'number',value:0},formula:null},value:'0',source:null},
  {name:'empty scalar',field:{...base,stored:{kind:'text',value:''},formula:null,editable_scalar:'text'},value:'Empty',source:null},
  {name:'missing field projection',field:null,value:'No field selected',source:null},
]);

export async function assertRenderedProjectionCases(renderActualContext) {
  for(const c of PROJECTION_CASES) {
    const html=await renderActualContext(c.field);
    assert.ok(typeof html==='string'&&html.includes('cell-context'),'actual context component was rendered');
    assert.ok(html.includes(c.value),`${c.name}: visible truthful status/value`);
    if(c.source!==null)assert.ok(html.includes(c.source),`${c.name}: exact projected source`);
    else assert.ok(!html.includes(source),`${c.name}: no formula implied`);
    if(c.diagnostic)assert.ok(html.includes(c.diagnostic));
    if(c.forbidden)assert.ok(!html.includes(c.forbidden),`${c.name}: no successful stored fallback`);
    assert.match(html,/aria-label="[^"]*cell[^"]*"/i,`${c.name}: accessible context name`);
  }
  return {projectionContractCases:PROJECTION_CASES.length,status:'PASS',scope:'actual rendered component; not real-core/browser failure evidence'};
}
