import assert from 'node:assert/strict';
import {contextSnapshot,waitCurrent,fillCopyName} from './focused-cell-context-journeys.mjs';

import {assertSelectedContext,assertNeutralContext} from './focused-cell-context-oracles.mjs';
function assertSalesContext(actual,{entity,field,row,value}) {
  assertSelectedContext(actual,{entity,field,row,value,table:'catalog',column:'price',source:null});
}
async function penTarget(page) {
  return page.evaluate(()=>{
    const t=document.querySelector('table[aria-label="Table"]');
    const headers=[...t.querySelectorAll('thead th')].map(e=>e.textContent.trim());
    const rows=[...t.querySelectorAll('tbody tr')];const ri=rows.findIndex(r=>[...r.querySelectorAll('td')].some(c=>c.textContent.trim()==='PEN'));
    const td=rows[ri]?.querySelectorAll('td')[headers.indexOf('price')-1];
    const [,entity,field]=td?.dataset.testid?.split(':')??[];
    return {entity,field,row:ri+1,selector:td?`[data-testid="${td.dataset.testid}"]`:null};
  });
}
export async function runSalesContextJourneys(page,{url,setViewport,capture}) {
  await page.goto(url);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Open sales example'&&!e.disabled),undefined,{timeout:30000});
  await page.click('button:has-text("Open sales example")');await waitCurrent(page);
  const target=await penTarget(page);assert.ok(target.entity&&target.field&&target.selector);
  await page.click(target.selector);assertSalesContext(await contextSnapshot(page),{...target,value:'200'});
  await page.click(target.selector,{clickCount:2});await page.fill('[data-testid="cell-editor"]','250');
  await page.press('[data-testid="cell-editor"]','Enter');await waitCurrent(page);
  const edited=await contextSnapshot(page);assertSalesContext(edited,{...target,value:'250'});
  const groups=await page.evaluate(()=>[...document.querySelectorAll('[data-testid="results-pane"] tbody tr')].map(r=>r.textContent.replace(/\s/g,'')));
  assert.ok(groups.some(r=>r.includes('NOTE')&&r.includes('1000'))&&groups.some(r=>r.includes('PEN')&&r.includes('1000')),'real automatic Results match price250');
  await page.click('button:has-text("Hide results")');assertSalesContext(await contextSnapshot(page),{...target,value:'250'});
  await page.click('button:has-text("Show results")');assertSalesContext(await contextSnapshot(page),{...target,value:'250'});
  await page.click('button.ts-history-command:has-text("Undo")');await waitCurrent(page);assertSalesContext(await contextSnapshot(page),{...target,value:'200'});
  await page.click('button.ts-history-command:has-text("Redo")');await waitCurrent(page);assertSalesContext(await contextSnapshot(page),{...target,value:'250'});
  for(const name of ['Cross-table summary','Report','Brief','Import & export']) {
    await page.click(`[role="tab"]:has-text("${name}")`);await page.click('[role="tab"]:has-text("Table")');
    assertSalesContext(await contextSnapshot(page),{...target,value:'250'});
  }
  const responsive=setViewport?await assertResponsiveContext(page,{setViewport,capture}):null;
  await page.selectOption('#ts-active-table','sales');await waitCurrent(page);
  const changedTable=await contextSnapshot(page);
  assertNeutralContext(changedTable);
  await page.selectOption('#ts-active-table','catalog');await waitCurrent(page);
  await page.click(target.selector);assertSalesContext(await contextSnapshot(page),{...target,value:'250'});
  await page.click('button:has-text("Save a copy")');await fillCopyName(page,'cell-context-sales');
  await page.click('button:has-text("Create copy")');await waitCurrent(page);
  const oldOccurrence=(await contextSnapshot(page)).context.occurrence;
  await page.click('button:has-text("Close project")');await page.waitForSelector('button[aria-label="Open saved cell-context-sales"]');
  assertNeutralContext(await contextSnapshot(page),{root:'home'});
  await page.click('button[aria-label="Open saved cell-context-sales"]');await waitCurrent(page);
  await page.selectOption('#ts-active-table','catalog');await waitCurrent(page);
  assertNeutralContext(await contextSnapshot(page));
  const freshTarget=await penTarget(page);assert.equal(freshTarget.entity,target.entity);assert.equal(freshTarget.field,target.field);
  await page.click(freshTarget.selector);const reopened=await contextSnapshot(page);
  assertSalesContext(reopened,{...freshTarget,value:'250'});assert.notEqual(reopened.context.occurrence,oldOccurrence);
  return {status:'PASS',target:freshTarget,responsive,cases:['real Sales scalar and automatic Results','Hide/Show retains field','Undo/Redo retains authoritative target/revision','all five Views','confirmed table switch clears old target','SaveCopy/Close/reopen revalidates fresh occurrence'],scope:'normal browser-local copy lifecycle; no full process restart or selected-directory claim'};
}

export async function assertResponsiveContext(page,{setViewport,capture}) {
  const receipts=[];
  for(const [width,height] of [[1440,900],[1100,900],[390,844],[320,844]]) {
    await setViewport(width,height);
    await page.waitForFunction(()=>document.fonts.status==='loaded');
    const r=await page.evaluate(()=>{
      const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
      const ctx=document.querySelector('[data-testid="cell-context"]'),grid=document.querySelector('.ts-grid-scroll'),results=document.querySelector('[data-testid="results-pane"]');
      return {viewport:{width:innerWidth,height:innerHeight},context:box(ctx),grid:box(grid),results:box(results),body:box(document.querySelector('.ts-table-composition')),views:[...document.querySelectorAll('[role="tab"]')].map(e=>e.textContent.trim()),regions:[...ctx.querySelectorAll('[data-context-overflow]')].map(e=>({kind:e.dataset.contextOverflow,clientWidth:e.clientWidth,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight,tabIndex:e.tabIndex,hint:e.getAttribute('aria-describedby')}))};
    });
    assert.ok(r.context&&r.grid&&r.results);
    assert.ok(r.context.right<=width+1&&r.context.x>=-1,'context stays inside workspace');
    assert.ok(r.grid.height>=167,'compact grid retains approved168px minimum');
    if(width>=1200)assert.ok(Math.abs(r.results.width-360)<=1);
    else if(width>=1024)assert.ok(Math.abs(r.results.width-320)<=1);
    else {assert.ok(r.results.y>=r.grid.y+r.grid.height-1,'compact Results stack below grid');assert.ok(r.grid.height<=r.body.height*.55+1,'compact grid55% body cap');}
    assert.deepEqual(r.views,['Table','Cross-table summary','Report','Brief','Import & export']);
    for(const o of r.regions) {
      const overflowing=o.scrollWidth>o.clientWidth||o.scrollHeight>o.clientHeight;
      assert.equal(o.tabIndex===0,overflowing,`${o.kind}: Tab stop iff real overflow`);
      assert.equal(!!o.hint,overflowing,`${o.kind}: cue relationship iff real overflow`);
    }
    assert.ok(r.regions.length>=2,'measured context regions were observed');
    if(capture)await capture(width,height);receipts.push(r);
  }
  await setViewport(1440,900);return {status:'PASS',receipts,scope:'actual candidate browser responsive geometry; not physical device evidence'};
}
