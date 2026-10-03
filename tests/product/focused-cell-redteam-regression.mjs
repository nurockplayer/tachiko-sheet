import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runRenderedRedteamControls} from './focused-cell-redteam-controls.mjs';
import {runFreshnessRedteamControls} from './focused-cell-redteam-freshness.mjs';
import {runGeometryRedteamControls} from './focused-cell-redteam-geometry.mjs';
import {runContextOracleFalsifiers} from './focused-cell-context-falsification.mjs';
export async function verifyFrozenOracleSources() {
 const folder=new URL('../../acceptance/focused-cell-context/redteam/',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('old-source-manifest.json',folder),'utf8'));
 assert.equal(manifest.baselineTree,'63b133400ec168c5afbda60ac9bf43e3d4f87ed6');assert.equal(manifest.files.length,9);
 for(const file of manifest.files){
  const bytes=await readFile(new URL('old-source/'+file.path,folder));assert.equal(bytes.length,file.bytes,file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),file.gitBlob,file.path);
 }
 return manifest;
}
export async function runFocusedCellRedteamRegression(page,{setViewport}) {
 const source=await verifyFrozenOracleSources();
 const node=runContextOracleFalsifiers();
 assert.equal(node.status,'PASS');assert.equal(node.cases.length,17);assert.equal(node.pendingPositiveControls.length,2);assert.equal(node.pendingCases.length,14);
 assert.equal(new Set(node.cases.map(c=>c.name)).size,17);assert.equal(new Set(node.pendingCases.map(c=>c.name)).size,14);
 const receipts=[];
 for(const baseline of [true,false]){
  await page.goto('about:blank');await setViewport(1440,900);
  const rendered=await runRenderedRedteamControls(page,{baseline});
  const freshness=await runFreshnessRedteamControls(page,{baseline});
  const geometry=await runGeometryRedteamControls(page,{baseline,setViewport});
  assert.equal(rendered.cases.length,21);assert.equal(freshness.cases.length,2);assert.equal(geometry.cases.length,4);
  receipts.push({baseline,rendered,freshness,geometry});
 }
 return {status:'PASS',oldTree:source.baselineTree,verifiedOldSources:source.files.length,nodeCounts:[17,2,14],receipts,scope:'27 old-PASS / new-rejection synthetic controls, not component or product acceptance'};
}
