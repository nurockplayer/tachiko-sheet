import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const oldDir=new URL('../../acceptance/focused-cell-context/redteam/old-source/tests/product/',import.meta.url);
export async function runFreshnessRedteamControls(page,{baseline=false}={}) {
 const old=await import(new URL('focused-cell-context-journeys.mjs',oldDir));
 const oracle=await import(new URL('focused-cell-context-oracles.mjs',oldDir));
 const source=await readFile(new URL('focused-cell-context-journeys.mjs',oldDir),'utf8');
 const selectSource=source.slice(source.indexOf('async function select('),source.indexOf('async function edit('));
 const start=source.indexOf(`  await page.click('button.ts-history-command:has-text("Undo")'); await waitCurrent(page);`);
 const end=source.indexOf(`  await page.click('button.ts-history-command:has-text("Redo")');`,start);
 assert.ok(start>0&&end>start);const historySource=source.slice(start,end);
 const select=Function('cell','contextSnapshot','assertSelectedContext',selectSource+';return select;')(old.cell,old.contextSnapshot,oracle.assertSelectedContext);
 const executeHistory=Object.getPrototypeOf(async function(){}).constructor('page','row','RELEASE_FIELDS','waitCurrent','select',historySource);
 const row=oracle.RELEASE_ROWS[0],field=oracle.RELEASE_FIELDS.priority,expected={...row,field,column:'priority'};
 const current=baseline?null:await import('./focused-cell-context-journeys.mjs');
 const cases=[];
 for(const mode of ['reclick','delayed']){
  async function setup(bad){await page.evaluate(({row,field,mode,bad})=>{
   document.head.innerHTML='<style>body{font:16px/24px Arial;margin:20px;color:black;background:white}section{width:650px;background:white}</style>';
   const fields={location:'release_items › priority · Row 1',table:'release_items',column:'priority',row:'Row 1',type:'Number',value:'10','value-heading':'Calculated value',source:row.source};
   document.body.innerHTML=`<section data-testid="cell-context" role="region" aria-label="Cell context" data-work-currentness="current" data-work-occurrence="occ" data-work-revision="rev" data-work-entity="${row.entity}" data-work-field="${field}">${Object.entries(fields).map(([k,v])=>`<div data-testid="cell-context-${k}">${v}</div>`).join('')}</section><button data-testid="cell:${row.entity}:${field}" data-work-occurrence="occ" data-work-revision="rev" aria-selected="true">10</button><button class="ts-history-command">Undo</button><div data-testid="project-ready" aria-busy="false"></div><div data-testid="currentness" data-currentness="current"></div>`;
   const value=document.querySelector('[data-testid="cell-context-value"]');
   let done;window.__redteamSettled=Promise.resolve();window.__releaseRedteamReply=()=>{};
   document.querySelector('.ts-history-command').onclick=()=>{value.textContent=bad&&mode==='reclick'?'8':'10';if(bad&&mode==='delayed'){window.__redteamSettled=new Promise(r=>{done=r});window.__releaseRedteamReply=()=>{value.textContent='8';done()}}};
   document.querySelector('[data-testid^="cell:"]').onclick=()=>{value.textContent='10'};
  },{row,field,mode,bad});}
  const check=async()=>{
   if(baseline)await executeHistory(page,row,oracle.RELEASE_FIELDS,old.waitCurrent,select);
   else {await page.click('button.ts-history-command:has-text("Undo")');await current.waitCurrent(page);await current.assertFreshSelectedContext(page,expected,{settle:()=>page.evaluate(()=>{window.__releaseRedteamReply();return window.__redteamSettled})});}
  };
  await setup(false);await check();await setup(true);let reason=null;try{await check()}catch(e){reason=e.message}
  assert.equal(reason===null,baseline,mode+': '+reason);if(reason)assert.match(reason,/exact rendered value/);
  if(baseline){await page.evaluate(()=>{window.__releaseRedteamReply();return window.__redteamSettled});if(mode==='delayed')assert.equal((await old.contextSnapshot(page)).value,'8','late bad state actually arrived');}
  cases.push({id:'freshness.'+mode,validControl:'PASS',oldPass:baseline,rejected:!!reason,reason});
 }
 assert.deepEqual(cases.map(c=>c.id),['freshness.reclick','freshness.delayed']);
 return {status:'PASS',baseline,cases,oldHistorySlice:historySource,oldHistorySliceSHA256:createHash('sha256').update(historySource).digest('hex'),scope:'actual frozen journey sequence on manufactured DOM; no product PASS'};
}
