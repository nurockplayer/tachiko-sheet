// Normal product actions; works with the supported Ego Page or Playwright Page.
// DOM evaluation observes public rendered state. Existing acceptance-only faults
// model lost replies, never a fabricated success or injected semantic projection.
import assert from 'node:assert/strict';
import { RELEASE_FIELDS, RELEASE_ROWS, assertSelectedContext, assertWithheldContext, assertNeutralContext, assertStableGrid } from './focused-cell-context-oracles.mjs';

export const cell = (entity, field) => `[data-testid="cell:${entity}:${field}"]`;
import {observeCellContext,contextSnapshotFromObservation} from './focused-cell-dom-observation.mjs';
import {assertPendingContext} from './focused-cell-observation-oracles.mjs';
const contextSelector = '[data-testid="cell-context"]';
const editorSelector = '[data-testid="cell-editor"]';
export async function contextSnapshot(page) {
  return contextSnapshotFromObservation(await page.evaluate(observeCellContext));
}
export async function waitCurrent(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute('aria-busy')==='false' && document.querySelector('[data-testid="currentness"]')?.getAttribute('data-currentness')==='current',undefined,{timeout:30000});
}
export async function openReleaseExample(page,url) {
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Open release plan example"]')?.disabled && !!document.querySelector('button[aria-label="Open release plan example"]'),undefined,{timeout:30000});
  await page.click('button[aria-label="Open release plan example"]'); await waitCurrent(page);
}
async function select(page,row,field,column,value,source=null) {
  await page.click(cell(row.entity,field));
  await page.waitForFunction(({entity,field}) => document.querySelector(`[data-testid="cell:${entity}:${field}"]`)?.getAttribute('aria-selected')==='true',{entity:row.entity,field},{timeout:5000});
  const snapshot=await contextSnapshot(page);
  assertSelectedContext(snapshot,{entity:row.entity,field,column,row:row.row,value,source});
  return snapshot;
}
async function edit(page,entity,field,input,commit=true) {
  await page.click(cell(entity,field),{clickCount:2});
  await page.fill(editorSelector,input);
  await page.press(editorSelector,commit?'Enter':'Escape'); await waitCurrent(page);
}
export async function fillCopyName(page,name) {
  const id=await page.evaluate(()=>[...document.querySelectorAll('label')].find(e=>e.textContent?.trim()==='Copy name')?.htmlFor??null);
  assert.ok(id,'normal Save dialog exposes Copy name');
  await page.fill(`input[id="${id}"]`,name);
}
export async function runReleaseContextJourneys(page,{url,acceptanceFaults=false}) {
  const cases=[]; const record=(name,details={})=>cases.push({name,status:'PASS',...details});
  await openReleaseExample(page,url);
  const row=RELEASE_ROWS[0];
  const scalar=await select(page,row,RELEASE_FIELDS.impact,'impact','5');
  record('scalar exact table/column/human row/type/value and no formula');
  for (const r of RELEASE_ROWS) {
    const next=await select(page,r,RELEASE_FIELDS.priority,'priority',r.value,r.source);assertStableGrid(scalar,next);
  }
  record('three real same-column cells retain their distinct exact projected sources');
  const prior=await select(page,row,RELEASE_FIELDS.priority,'priority','10',row.source);
  await page.press('button.ts-refresh-command','Shift');
  const command=await contextSnapshot(page);
  assertSelectedContext(command,{entity:row.entity,field:RELEASE_FIELDS.priority,column:'priority',row:1,value:'10',source:row.source});
  assert.equal(command.selected[0].focused,false,'command focus does not remain on cell');
  assert.equal(command.activeElement.text,'Refresh'); assertStableGrid(prior,command);
  record('command keyboard focus retains the selected field');
  await select(page,row,RELEASE_FIELDS.impact,'impact','5');
  await edit(page,row.entity,RELEASE_FIELDS.impact,'7',false);
  assertSelectedContext(await contextSnapshot(page),{entity:row.entity,field:RELEASE_FIELDS.impact,column:'impact',row:1,value:'5'});
  record('cancelled draft keeps confirmed field and value');
  await edit(page,row.entity,RELEASE_FIELDS.impact,'3');
  await select(page,row,RELEASE_FIELDS.priority,'priority','8',row.source);
  await page.click('button.ts-history-command:has-text("Undo")'); await waitCurrent(page);
  await select(page,row,RELEASE_FIELDS.priority,'priority','10',row.source);
  await page.click('button.ts-history-command:has-text("Redo")'); await waitCurrent(page);
  await select(page,row,RELEASE_FIELDS.priority,'priority','8',row.source);
  record('commit/Undo/Redo expose only the admitted revision of exact field');
  const beforeView=await contextSnapshot(page);
  await page.click('[role="tab"]:has-text("Brief")');
  await page.click('[role="tab"]:has-text("Table")');
  const afterView=await contextSnapshot(page);
  assertSelectedContext(afterView,{entity:row.entity,field:RELEASE_FIELDS.priority,column:'priority',row:1,value:'8',source:row.source});
  assert.equal(afterView.context.occurrence,beforeView.context.occurrence);
  record('ordinary View navigation preserves a valid selected field');
  if (acceptanceFaults) {
    await page.evaluate(()=>window.__tachikoAcceptance.deferNextTrackerReply());
    try {
      await page.click('button.ts-history-command:has-text("Undo")');
      await page.waitForFunction(()=>document.querySelector('[data-testid="currentness"]')?.getAttribute('data-currentness')==='pending',undefined,{timeout:10000});
      const pending=await contextSnapshot(page);
      assertPendingContext(pending);
      record('real pending history publication withholds the previously confirmed value/source');
    } finally { await page.evaluate(()=>window.__tachikoAcceptance.releaseTrackerReply()); }
    await waitCurrent(page);
    await select(page,row,RELEASE_FIELDS.priority,'priority','10',row.source);
    await page.evaluate(()=>window.__tachikoAcceptance.deferNextCopyWrite());
    try {
      await page.click('button:has-text("Save a copy")');
      await fillCopyName(page,'cell-context-copy');
      await page.click('button:has-text("Create copy")');
      await page.waitForFunction(()=>document.querySelector('[data-testid="project-ready"]')?.getAttribute('aria-busy')==='true',undefined,{timeout:10000});
      assertSelectedContext(await contextSnapshot(page),{entity:row.entity,field:RELEASE_FIELDS.priority,column:'priority',row:1,value:'10',source:row.source});
      record('unrelated real durable-copy busy operation retains confirmed context');
    } finally { await page.evaluate(()=>window.__tachikoAcceptance.releaseCopyWrite()); }
    await waitCurrent(page);
    const oldOccurrence=(await contextSnapshot(page)).context.occurrence;
    await page.click('button:has-text("Close project")');
    await page.waitForSelector('button[aria-label="Open release plan example"]');
    assertNeutralContext(await contextSnapshot(page),{root:'home'});
    await page.click('button[aria-label="Open saved cell-context-copy"]'); await waitCurrent(page);
    const beforeSelect=await contextSnapshot(page);
    assertNeutralContext(beforeSelect);
    const reopened=await select(page,row,RELEASE_FIELDS.priority,'priority','10',row.source);
    assert.notEqual(reopened.context.occurrence,oldOccurrence);
    record('same-document reopen creates a new occurrence and clears the old selected target');
    await page.click('button:has-text("Close project")');
    await page.waitForSelector('button[aria-label="Open release plan example"]');
    await page.evaluate(()=>window.__tachikoAcceptance.loseNextOpenReply());
    await page.click('button[aria-label="Open saved cell-context-copy"]');
    await page.waitForFunction(()=>!document.querySelector('[data-testid="project-ready"]')&&document.body.innerText.includes('Refresh required'),undefined,{timeout:30000});
    assertWithheldContext(await contextSnapshot(page),row,{root:'home'});
    await page.evaluate(()=>window.__tachikoAcceptance.settleFaultWindow());
    await page.click('button:has-text("Refresh")');
    assertWithheldContext(await contextSnapshot(page),row,{root:'home'});
    assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-testid^="cell:"]').length),0);
    await page.click('button:has-text("Close and abandon recovery")');
    await page.click('[role="dialog"] button:has-text("Close without saving")');
    await page.waitForSelector('button[aria-label="Open release plan example"]');
    await page.click('button[aria-label="Open saved cell-context-copy"]'); await waitCurrent(page);
    await select(page,row,RELEASE_FIELDS.priority,'priority','10',row.source);
    record('no-current-view unknown Open withholds stale details; explicit abandonment and fresh open recover truthfully');
    await page.evaluate(()=>window.__tachikoAcceptance.loseNextExecuteReply());
    await page.click(cell(row.entity,RELEASE_FIELDS.impact),{clickCount:2});
    await page.fill(editorSelector,'3'); await page.press(editorSelector,'Enter');
    await page.waitForFunction(()=>document.querySelector('[data-testid="currentness"]')?.getAttribute('data-currentness')==='unknown',undefined,{timeout:30000});
    assertWithheldContext(await contextSnapshot(page),row);
    record('lost real Execute reply withholds prior identity/value/source');
    await page.evaluate(()=>window.__tachikoAcceptance.settleFaultWindow());
    await page.click('button.ts-refresh-command'); await waitCurrent(page);
    // Recovery may keep the unconfirmed draft; this test never deletes/replays it.
    await select(page,row,RELEASE_FIELDS.priority,'priority','8',row.source);
    record('Refresh resolves context from the recovered current projection');
  }
  return {status:'PASS',cases,scope:'real release-plan UI; no folder-entry/physical-device or full-process-restart claim'};
}
