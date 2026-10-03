// Manufactured DOM controls only. Both versions use their real source modules.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const current=new URL('./',import.meta.url);
const frozen=new URL('../../acceptance/focused-cell-context/redteam/old-source/tests/product/',import.meta.url);
export async function runRenderedRedteamControls(page,{baseline=false}={}) {
 const base=baseline?frozen:current;
 const observer=await import(new URL('focused-cell-dom-observation.mjs',base));
 const selected=await import(new URL('focused-cell-context-oracles.mjs',base));
 const states=await import(new URL('focused-cell-observation-oracles.mjs',base));
 const obsSource=await readFile(new URL('focused-cell-dom-observation.mjs',base),'utf8');
 const projSource=await readFile(new URL('focused-cell-projection-oracles.mjs',base),'utf8');
 const stateSource=await readFile(new URL('focused-cell-observation-oracles.mjs',base),'utf8');
 const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 const projectionURL=data(projSource.replace("'./focused-cell-dom-observation.mjs'",JSON.stringify(data(obsSource))).replace("'./focused-cell-observation-oracles.mjs'",JSON.stringify(data(stateSource))));
 const row=selected.RELEASE_ROWS[0],field=selected.RELEASE_FIELDS.priority;
 const expected={...row,field,column:'priority'};
 const node=(k,v)=>`<div data-testid="cell-context-${k}">${v}</div>`;
 const root=(body,state='current',identity=true)=>`<section data-testid="cell-context" role="region" aria-label="Cell context" data-work-currentness="${state}" data-work-occurrence="occ" data-work-revision="rev" ${identity?`data-work-entity="${row.entity}" data-work-field="${field}"`:''}>${body}</section>`;
 const normal=root(Object.entries({location:'release_items › priority · Row 1',table:'release_items',column:'priority',row:'Row 1',type:'Number',value:'10','value-heading':'Calculated value',source:row.source}).map(([k,v])=>node(k,v)).join(''))+`<button data-testid="cell:${row.entity}:${field}" aria-selected="true" data-work-occurrence="occ" data-work-revision="rev">10</button>`;
 const pending=root(node('value','Awaiting confirmation'),'pending');
 const neutral=root(node('value','No field selected'),'current',false);
 const unknown=root(node('value','Refresh to confirm current values'),'unknown',false);
 const snapshot=async()=>observer.contextSnapshotFromObservation(await page.evaluate(observer.observeCellContext));
 const setup=async(html,mutation='')=>{
  await page.evaluate(`(()=>{document.head.innerHTML='<style>body{font:16px/24px Arial;margin:20px;background:white;color:black}section{width:650px;background:white;color:black}div{min-height:24px}</style>';document.body.innerHTML=${JSON.stringify(html)};${mutation}})()`);
 };
 const results=[];
 const cases=[
  ['visual.stale-aria-hidden',normal,a=>selected.assertSelectedContext(a,expected),`document.querySelector('[data-testid="cell-context-value"]').innerHTML='<span aria-hidden="true">8</span><span style="position:absolute;left:-9999px">10</span>';`],
  ['visual.stale-source-aria-hidden',normal,a=>selected.assertSelectedContext(a,expected),`document.querySelector('[data-testid="cell-context-source"]').innerHTML=${JSON.stringify('<span aria-hidden="true">'+selected.RELEASE_ROWS[1].source+'</span><span style="position:absolute;left:-9999px">'+row.source+'</span>')}`],
  ...[['zero-height','height:0;overflow:hidden'],['offscreen','position:fixed;top:5000px'],['opacity','opacity:0.02'],['clip-path','clip-path:inset(100%)'],['scale','transform:scale(0)'],['font','font-size:0'],['transparent','color:transparent']].map(([name,css])=>['visual.'+name,normal,a=>selected.assertSelectedContext(a,expected),`document.querySelector('section').style.cssText=${JSON.stringify(css)}`]),
  ['visual.cover',normal,a=>selected.assertSelectedContext(a,expected),`document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;inset:0;background:white;z-index:999"></div>')`],
  ['location.composition',normal,a=>selected.assertSelectedContext(a,expected),`document.querySelector('[data-testid="cell-context-location"]').textContent='release_items › impact · Row 3'`],
  ['pending.untagged',pending,states.assertPendingContext,`document.querySelector('section').insertAdjacentHTML('beforeend',${JSON.stringify('<div>8 '+row.source+'</div>')})`],
  ['neutral.untagged',neutral,states.assertNeutralContext,`document.querySelector('section').insertAdjacentHTML('beforeend',${JSON.stringify('<div>release_items › priority · Row 1 10 '+row.source+'</div>')})`],
  ['unknown.untagged',unknown,a=>states.assertWithheldContext(a,{source:null}),`document.querySelector('section').insertAdjacentHTML('beforeend','<div>impact · Row 1 5 → 3</div>')`],
  ['recovery.untagged','<h1>Refresh required</h1><p>Needs refresh</p>',a=>states.assertWithheldContext(a,row,{root:'home',surface:'Refresh requiredNeeds refresh'}),`document.body.insertAdjacentHTML('beforeend',${JSON.stringify('<aside>release_items › priority · Row 1 10 '+row.source+'</aside>')})`],
  ['home.untagged','<h1>Home</h1>',a=>states.assertNeutralContext(a,{root:'home',surface:'Home'}),`document.body.insertAdjacentHTML('beforeend',${JSON.stringify('<aside>release_items › priority · Row 1 10 '+row.source+'</aside>')})`],
 ];
 for(const [id,html,check,mutation] of cases){
  await setup(html);check(await snapshot());await setup(html,mutation);let reason=null;
  try{check(await snapshot())}catch(e){reason=e.message}
  assert.equal(reason===null,baseline,`${id}: ${reason??'false PASS'}`);
  if(reason)assert.match(reason,/visible|visual|composition|rendered|raw observation|composed location|unexposed|context root is connected/,id);
  results.push({id,validControl:'PASS',oldPass:baseline,rejected:!!reason,reason});
 }
 // Valid repeated old text outside the context is not stale context.
 await setup(neutral+`<aside>10 ${row.source}</aside>`);states.assertNeutralContext(await snapshot());
 await setup('<h1>Home</h1><p>Saved copy 10</p>');states.assertNeutralContext(await snapshot(),{root:'home',surface:'HomeSaved copy 10'});
 // Exact full source in a reachable viewport; use actual keyboard input.
 await setup(normal,`const s=document.querySelector('[data-testid="cell-context-source"]');s.style.cssText='width:110px;white-space:nowrap;overflow:auto';s.tabIndex=0;s.setAttribute('aria-describedby','scroll-hint');document.body.insertAdjacentHTML('beforeend','<p id="scroll-hint">Scroll to read</p><button id="exit">Exit</button>')`);
 selected.assertSelectedContext(await snapshot(),expected);
 // The visibility positive proves a usable viewport and exact full bytes.
 // Keyboard/touch reachability remains the separate fixed actual-layout gate.
 assert.ok(await page.evaluate(()=>{const e=document.querySelector('[data-testid="cell-context-source"]');return e.scrollWidth>e.clientWidth&&e.tabIndex===0&&!!document.getElementById(e.getAttribute('aria-describedby'));}));
 for(const index of [1,2,4,5]){
  await setup('');
  const r=await page.evaluate(async ({url,index})=>{
   const {PROJECTION_CASES,assertProjectionRoot}=await import(url),c=PROJECTION_CASES[index];
   const root=document.createElement('section');root.dataset.testid='cell-context';root.setAttribute('role','region');root.setAttribute('aria-label','Cell context');document.body.append(root);
   for(const [k,v] of [['value',c.value],['source',c.source],['value-heading','Calculated value'],...(c.diagnostic?[['diagnostic',c.diagnostic]]:[])]){const n=document.createElement('div');n.dataset.testid='cell-context-'+k;n.textContent=v;root.append(n);}
   assertProjectionRoot(root,c);const extra=document.createElement('div');extra.textContent='Last result: 6';root.append(extra);
   let reason=null;try{assertProjectionRoot(root,c)}catch(e){reason=e.message}return {id:'projection.residual-'+index,reason};
  },{url:projectionURL,index});assert.equal(r.reason===null,baseline,r.id+': '+r.reason);results.push({...r,validControl:'PASS',oldPass:baseline,rejected:!!r.reason});
 }
 // Failure text is correct in the DOM but hidden, while stored fallback is visible.
 await setup('');
 const fallback=await page.evaluate(async url=>{
  const {PROJECTION_CASES,assertProjectionRoot}=await import(url),c=PROJECTION_CASES[4];
  const root=document.createElement('section');root.dataset.testid='cell-context';root.setAttribute('role','region');root.setAttribute('aria-label','Cell context');document.body.append(root);
  for(const [k,v] of [['value',c.value],['source',c.source],['value-heading','Calculated value'],['diagnostic',c.diagnostic]]){const n=document.createElement('div');n.dataset.testid='cell-context-'+k;n.textContent=v;root.append(n);}
  assertProjectionRoot(root,c);root.querySelector('[data-testid="cell-context-value"]').innerHTML='<span aria-hidden="true">123</span><span style="position:absolute;left:-9999px">Calculation failed</span>';
  try{assertProjectionRoot(root,c);return null}catch(e){return e.message}
 },projectionURL);assert.equal(fallback===null,baseline,'projection hidden fallback');results.push({id:'projection.hidden-fallback',validControl:'PASS',oldPass:baseline,rejected:!!fallback,reason:fallback});
 const required=['visual.stale-aria-hidden','visual.stale-source-aria-hidden','visual.zero-height','visual.offscreen','visual.opacity','visual.clip-path','visual.scale','visual.font','visual.transparent','visual.cover','location.composition','pending.untagged','neutral.untagged','unknown.untagged','recovery.untagged','home.untagged','projection.residual-1','projection.residual-2','projection.residual-4','projection.residual-5','projection.hidden-fallback'];
 assert.deepEqual(results.map(r=>r.id),required);
 return {status:'PASS',baseline,sourceSHA256:createHash('sha256').update(obsSource).digest('hex'),cases:results,positiveControls:['each unchanged case','old content outside context','numeric saved-copy name','long scroll viewport (input reachability not credited)'],scope:'synthetic oracle controls only'};
}
