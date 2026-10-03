import assert from 'node:assert/strict';
export async function runGeometryRedteamControls(page,{baseline=false,setViewport}) {
 const dir=baseline?new URL('../../acceptance/focused-cell-context/redteam/old-source/tests/product/',import.meta.url):new URL('./',import.meta.url);
 const {assertResponsiveContext}=await import(new URL('focused-cell-sales-journeys.mjs',dir));
 const html=`<style>body{margin:0;font:16px/24px Arial}.ts-table-composition{height:700px}.ts-grid-scroll{position:absolute;top:270px;left:0;width:300px;height:200px}[data-testid="results-pane"]{position:absolute;top:270px;right:0;width:360px;height:200px}[data-testid="cell-context"]{position:absolute;left:0;top:50px;width:300px;height:140px;background:white;z-index:3}@media(max-width:1199px){[data-testid="results-pane"]{width:320px}}@media(max-width:1023px){[data-testid="results-pane"]{top:480px}[data-testid="cell-context"]{height:190px}}[data-context-overflow]{width:290px;min-height:24px}</style><nav>${['Table','Cross-table summary','Report','Brief','Import & export'].map(n=>'<button role="tab">'+n+'</button>').join('')}</nav><div class="ts-table-composition"><div class="ts-grid-scroll">Grid</div><div data-testid="results-pane">Results</div><section data-testid="cell-context" role="region" aria-label="Cell context"><div data-context-overflow="value" data-testid="cell-context-value">10</div><div data-testid="cell-context-value-heading">Calculated value</div><div data-context-overflow="source" data-testid="cell-context-source">([release_scope.impact] + [release_scope.friction])</div></section></div>`;
 const cases=[];
 for(const [id,css] of [['geometry.overlap','top:270px'],['geometry.offscreen','top:5000px'],['geometry.zero-height','height:0;overflow:hidden'],['geometry.unmarked-ellipsis','']]){
  await page.evaluate(h=>{document.head.innerHTML='';document.body.innerHTML=h;},html);
  await assertResponsiveContext(page,{setViewport});
  await page.evaluate(({css,id})=>{const c=document.querySelector('[data-testid="cell-context"]');c.style.cssText=css;if(id==='geometry.unmarked-ellipsis'){const d=document.createElement('div');d.style.cssText='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:15px';d.textContent='([release_scope.impact] + [release_scope.friction])';c.append(d)}},{css,id});
  let reason=null;try{await assertResponsiveContext(page,{setViewport})}catch(e){reason=e.message}
  assert.equal(reason===null,baseline,id+': '+reason);
  if(reason)assert.match(reason,/context height|viewport|overlap|clipped text/,id);
  cases.push({id,validControl:'PASS (140px desktop / 190px compact)',oldPass:baseline,rejected:!!reason,reason});
 }
 assert.deepEqual(cases.map(c=>c.id),['geometry.overlap','geometry.offscreen','geometry.zero-height','geometry.unmarked-ellipsis']);
 return {status:'PASS',baseline,cases,scope:'synthetic geometry oracle controls; no product/native/input PASS'};
}
