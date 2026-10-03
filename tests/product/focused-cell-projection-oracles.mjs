// Disclosed public-projection contract cases. These do not claim real core
// calculation failures. The actual context component must be rendered by the
// implementation's unit adapter; pure selector output alone is insufficient.
import {observeCellContext} from './focused-cell-dom-observation.mjs';
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

function requireContract(condition,message) {
  if(!condition)throw new Error(message);
}
export function assertProjectionRoot(root,c) {
  const actual=observeCellContext(root);
  const label=`${c.name}: `;
  requireContract(actual.connected&&actual.exposed,label+'connected visible actual component root');
  requireContract(actual.name==='Cell context'&&['region','group'].includes(actual.role),label+'accessible Cell context region/group');
  const exact=(key,expected)=>{
    const node=actual.fields[key];
    requireContract(node.count===1&&node.exposed,label+key+' is unique, visible and accessibility-exposed');
    requireContract(node.text===expected,label+key+' exact displayed text');
  };
  exact('value',c.value);
  if(c.source!==null) {
    exact('source',c.source);
    exact('value-heading','Calculated value');
  } else {
    requireContract(actual.fields.source.count===0,label+'no formula implied');
    if(c.field)exact('value-heading','Value');
    else requireContract(actual.fields['value-heading'].count===0||actual.fields['value-heading'].text!=='Calculated value',label+'neutral value is not calculated');
  }
  if(c.diagnostic) {
    const node=actual.fields.diagnostic;
    requireContract(node.count===1&&node.exposed&&node.text.includes(c.diagnostic),label+'visible diagnostic');
  }
  requireContract(actual.editableSourceCount===0,label+'source is read-only, including inherited editing');
  if(c.forbidden)requireContract(!actual.allVisibleText.includes(c.forbidden),label+'no successful stored fallback');
  return actual;
}
export async function assertRenderedProjectionCases(renderActualContext) {
  const cases=[];
  for(const c of PROJECTION_CASES) {
    // Adapter source/execution must import and mount the actual production
    // component. A test ID alone cannot establish component provenance.
    const root=await renderActualContext(c.field);
    assertProjectionRoot(root,c);
    cases.push({name:c.name,status:'PASS'});
  }
  return {projectionContractCases:cases.length,cases,status:'PASS',scope:'actual connected browser component; not real-core calculation failure evidence'};
}

export function falsifyHiddenProjectionContent(root,c) {
  const mechanisms=['hidden','aria-hidden','display:none','visibility:hidden','visibility:collapse'];
  const results=[];
  for(const mechanism of mechanisms) {
    const clone=root.cloneNode(true);root.parentElement.append(clone);
    const value=clone.querySelector('[data-testid="cell-context-value"]');
    requireContract(value,'falsifier requires the actual rendered value node');
    value.textContent='WRONG VISIBLE CONTENT';
    const hidden=clone.ownerDocument.createElement('span');hidden.textContent=c.value;
    if(mechanism==='hidden')hidden.hidden=true;
    else if(mechanism==='aria-hidden')hidden.setAttribute('aria-hidden','true');
    else {const [key,value]=mechanism.split(':');hidden.style.setProperty(key,value);}
    value.append(hidden);
    let rejected=false;try{assertProjectionRoot(clone,c);}catch{rejected=true;}finally{clone.remove();}
    requireContract(rejected,mechanism+' expected hidden text must not earn PASS');
    results.push({mechanism,rejected});
  }
  return results;
}
