// Steward fixed user oracles over normal UI and actual Worker/WASM.
// Existing acceptance APIs below are read-only observations or bounded transport faults.
const fs=await import('node:fs/promises');const assert=(await import('node:assert/strict')).default;
const task=await taskSpace(SAVE_CLOSURE_CONFIG.space);const page=task.page('p1');
const origin=SAVE_CLOSURE_CONFIG.origin;const prefix='save-closure-'+Date.now();const results=[];
async function read(){return page.evaluate(()=>({cells:[...document.querySelectorAll('table[aria-label="Table"] tbody tr')].map(r=>[...r.querySelectorAll('td')].map(c=>c.textContent)),witness:[...document.querySelectorAll('[data-work-occurrence]')].slice(0,1).map(e=>({occurrence:e.getAttribute('data-work-occurrence'),revision:e.getAttribute('data-work-revision')}))[0],currentness:document.querySelector('[data-testid="currentness"]')?.getAttribute('data-currentness'),save:document.querySelector('[data-testid="save-status"]')?.textContent,body:document.body.innerText}));}
async function snapshot(){return page.evaluate(()=>window.__tachikoAcceptance.runtimeSnapshot());}
async function counts(){return page.evaluate(()=>window.__tachikoAcceptance.workMethodCounts());}
async function home(){
 if(await page.evaluate(()=>!!document.querySelector('.ts-modal--save')))await page.click('.ts-modal--save button:text-is("Cancel")');
 if(await page.evaluate(()=>!!document.querySelector('.ts-modal--import')))await page.click('.ts-modal--import button:text-is("Cancel")');
 if(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Close project')))await page.click('loc=role:button[name="Close project"]');
 if(await page.evaluate(()=>!!document.querySelector('.ts-modal--close')))await page.click('text="Close without saving"');
}
async function start(){await page.goto(origin);await page.waitForSelector('[data-testid="project-ready"]');await home();}
async function imported(name,types){
 await page.setInputFiles('input[type="file"][accept*=".csv"]',SAVE_CLOSURE_CONFIG.prep+'/fixtures/'+name);
 await page.waitForSelector('.ts-modal--import');
 for(let i=0;i<types.length;i++)await page.selectOption('.ts-import-column select >> nth='+i,types[i]);
 await page.click('text="Import candidate"');await page.waitForSelector('[data-testid="project-ready"]');
}
async function editDateUi(value){const before=await counts();await page.dblclick('table[aria-label="Table"] tbody tr:first-child td:nth-of-type(5)');await page.fill('input[aria-label="Edit cell"]',value);await page.press('input[aria-label="Edit cell"]','Enter');await page.waitForFunction(value=>document.querySelector('table tbody tr td:nth-of-type(5)')?.textContent===value,value);assert.equal((await counts()).editDate??0,(before.editDate??0)+1,'Date kind must reach the real producer editDate operation');}
async function createCopy(name){await page.click('text="Save a copy"');await page.fill('.ts-modal--save input',name);await page.click('text="Create copy"');await page.waitForFunction(()=>{const s=document.querySelector('[data-testid="save-status"]')?.textContent;return s?.includes('Saved on this device')||s?.includes('Save failed');});assert.match((await read()).save,/Saved on this device/,'ordinary Create copy must durably acknowledge this supported work');}
async function reopen(name,reload=false){await home();if(reload){await page.reload();await page.waitForSelector('[data-testid="project-ready"]');await home();}await page.click('text="Open saved '+name+'"');await page.waitForSelector('[data-testid="project-ready"]');}
async function record(name){return page.evaluate(async name=>{
 const db=await new Promise((r,j)=>{const q=indexedDB.open('tachiko-sheet-local-copies');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
 const rows=[];for(const store of ['copies','opaque-copies']){const row=await new Promise((r,j)=>{const q=db.transaction(store,'readonly').objectStore(store).get(name);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});if(row)rows.push({store,row});}db.close();if(rows.length!==1)throw Error('Expected exactly one owned record');
 const {store,row}=rows[0];const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
 return {store,kind:row.kind,savedAt:row.savedAt,revision:row.revision,coreHash:row.bytes?await hash(row.bytes):null,source:row.importedSource?{...row.importedSource,bytes:undefined,sha256:await hash(row.importedSource.bytes)}:null,presentation:row.presentation??null};
 },name);}
async function verifyDateSavedSource(name,firstDate='2026-09-26'){
 const expected=JSON.parse(await fs.readFile(SAVE_CLOSURE_CONFIG.prep+'/fixtures/date-only-private.json','utf8'));
 const actual=await record(name);const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['schema_id','field_id','entity_id'].includes(k)).map(([k,v])=>[k,normalize(v)])):v;
 assert.deepEqual(normalize(actual.source.metadata),normalize(expected.metadata));assert.deepEqual(actual.source.ledger,expected.ledger);
 // Real producer validates the specific saved core + retained metadata, independently of the UI reader.
 const core=await page.evaluate(async name=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('tachiko-sheet-local-copies');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});const row=await new Promise((r,j)=>{const q=db.transaction('opaque-copies','readonly').objectStore('opaque-copies').get(name);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});db.close();const kit=await import('/core-kit/experimental-client.js');const c=kit.createExperimentalDesignerClient();try{await c.inspectImportedProject(row.bytes.slice(0),row.importedSource.metadata);await c.openProject(row.bytes.slice(0));const tables=[];for(const collection of(await c.bootstrap()).collections){const t=await c.queryTable(collection.key);tables.push({types:t.columns.map(f=>f.field_type),rows:t.rows.map(r=>r.fields.map(f=>f.stored))});}return tables;}finally{c.close();}},name);
 assert.deepEqual(core.map(t=>t.types),[['text','text','number','number','date']]);assert.deepEqual(core.map(t=>t.rows.map(r=>r.map(f=>f.value))),[[['PEN','Stationery',4,200,firstDate],['NOTE','Paper',5,200,'2026-09-27']]]);assert.deepEqual(core[0].rows.map(r=>r.map(f=>f.kind)),[['text','text','number','number','date'],['text','text','number','number','date']]);
}
async function summaryBinding(mixed=false){
 await page.click('loc=role:tab[name="Cross-table summary"]');await page.click('text="Choose tables and fields"');await page.waitForSelector('.ts-card select');
 const values=mixed?['sheet_1','column_1','column_2','sheet_2','column_1','column_2','column_3']:['sheet_1','column_1','column_3','sheet_1','column_1','column_2','column_4'];
 for(let i=0;i<values.length;i++)await page.selectOption('[aria-label="Cross-table summary binding"] select >> nth='+i,values[i]);
}
async function createSummary(){await page.click('text="Create cross-table summary"');await page.waitForFunction(()=>document.querySelector('[data-testid="currentness"]')?.getAttribute('data-currentness')!=='pending'&&!document.body.innerText.includes('An operation is in progress'));}
async function caseRun(id,fn){try{await start();const evidence=await fn();results.push({id,result:'PASS',evidence});}catch(e){const productAssertion=e.code==='ERR_ASSERTION';results.push({id,result:productAssertion?'BEHAVIORAL_RED':'SETUP_OR_EXECUTION_ERROR',message:e.message,observed:await read()});}finally{await home();}}
await caseRun('A-Date-only-normal-Save-fresh-reopen',async()=>{
 await imported('date-only.csv',['text','text','number','number','date']);
 await editDateUi('2026-09-28');
 const before=await read();assert.deepEqual(before.cells,[['PEN','Stationery','4','200','2026-09-28'],['NOTE','Paper','5','200','2026-09-27']]);const name=prefix+'-Date';await createCopy(name);const saved=await record(name);assert.equal(saved.kind,'opaque');await verifyDateSavedSource(name,'2026-09-28');assert.equal(saved.source.sha256,'7be5f6fad559bc4f70acab457bb34ee82161b47c30767343cc317e96663440e5');
 await reopen(name,true);const after=await read();assert.deepEqual(after.cells,before.cells);assert.notEqual(after.witness.occurrence,before.witness.occurrence);assert.equal(after.currentness,'current');assert.match(after.save,/Saved/);
 assert.deepEqual(await record(name),saved);await page.click('text="Import & export"');assert.match((await read()).body,/original source remains available/);await page.click('loc=role:tab[name="Table"]');
 // Type retention: the producer still takes Date scalar edits after reopening.
 await editDateUi('2026-09-29');
 return {before,after,saved};
});
for(const [id,name,types,mixed] of [
 ['B-same-table-Date-summary-refusal','date-only.csv',['text','text','number','number','date'],false],
 ['C-unrelated-Date-summary-refusal','unrelated-date.xlsx',['text','number','text','text','number','date'],true],
 ['C-empty-unrelated-Date-schema-refusal','unrelated-date-empty.xlsx',['text','number','text','text','number','date'],true]])await caseRun(id,async()=>{
 await imported(name,types);const before=await read();const runtimeBefore=await snapshot();await summaryBinding(mixed);const countBefore=await counts();await createSummary();const countAfter=await counts();const refusal=await page.evaluate(()=>[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent).join(' '));
 assert.equal(countAfter.createKeyedGroupedSum??0,countBefore.createKeyedGroupedSum??0,'unsupported Date combination must refuse BEFORE producer Create dispatch');
 await page.click('loc=role:tab[name="Table"]');const after=await read();assert.deepEqual(after.cells,before.cells);assert.deepEqual(after.witness,before.witness);assert.equal(after.currentness,before.currentness);assert.deepEqual(await snapshot(),runtimeBefore);
 assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-testid^="j4-result-"]').length),0);assert.match(refusal,/date/i,'Date-specific visible refusal alert required');assert.match(refusal,/unsupported|cannot|not supported|save|support/i,'refusal must explain the fixed-pin combination');
 const copyName=prefix+'-'+id;await createCopy(copyName);const copied=await record(copyName);assert.equal(copied.kind,'opaque');assert.equal(copied.coreHash,runtimeBefore.opaqueBytesHash,'copy must retain all collections, including unrelated/empty Date schema');await reopen(copyName,true);assert.equal((await snapshot()).opaqueBytesHash,copied.coreHash);const reopened=await read();assert.deepEqual(reopened.cells,before.cells);assert.notEqual(reopened.witness.occurrence,before.witness.occurrence);return {before,after,countBefore,countAfter};
});
await caseRun('D-canonical-opaque-complete-copy-controls',async()=>{
 await imported('date-only.csv',['text','text','number','number','text']);const before=await read();const canonical=prefix+'-canonical';await createCopy(canonical);const canonicalRecord=await record(canonical);assert.equal(canonicalRecord.kind,'canonical');await reopen(canonical);assert.deepEqual((await read()).cells,before.cells);
 await summaryBinding();await createSummary();assert.match((await read()).body,/Paper\s*:\s*1000/);assert.match((await read()).body,/Stationery\s*:\s*800/);await page.click('text="Create bar report"');
 const boundary=['A'.repeat(119)+'😀','界'.repeat(79)+'😀','V'.repeat(79)+'😀'];const fields=['#report-title','#report-category-label','#report-value-label'];
 for(let i=0;i<3;i++)await page.fill(fields[i],boundary[i]);
 await page.waitForSelector('canvas[data-report-ready="true"]');
 const renderedBefore=await page.evaluate(()=>document.querySelector('canvas').toDataURL());
 for(let i=0;i<3;i++){
  await page.fill(fields[i],boundary[i]+'x');assert.match(await page.evaluate(i=>document.querySelector(['#report-title-error','#report-category-label-error','#report-value-label-error'][i])?.textContent,i),/has not been applied/);
  assert.equal(await page.evaluate(()=>document.querySelector('canvas').toDataURL()),renderedBefore,'invalid draft must leave applied report pixels unchanged');
  await page.click('text="Save a copy"');await page.fill('.ts-modal--save input',prefix+'-invalid-'+i);assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.ts-modal--save button')].find(b=>b.textContent==='Create copy')?.disabled),true);await page.click('.ts-modal--save button:text-is("Cancel")');await page.fill(fields[i],boundary[i]);
 }
 for(let i=0;i<3;i++)await page.fill(fields[i],boundary[i]);await page.click('input[type="checkbox"]');
 const opaque=prefix+'-complete';await createCopy(opaque);const saved=await record(opaque);assert.equal(saved.kind,'opaque');assert.equal(saved.source.sha256,canonicalRecord.source.sha256);assert.deepEqual(saved.source.metadata,canonicalRecord.source.metadata);assert.deepEqual(saved.source.ledger,canonicalRecord.source.ledger);assert.equal(saved.presentation.snapshotDigest,saved.coreHash);assert.equal(saved.presentation.snapshotRevision,saved.revision);assert.equal(saved.presentation.report.legendVisible,false);assert.equal(saved.presentation.report.type,'bar');
 await page.click('loc=role:tab[name="Table"]');const savedView=await read();await reopen(opaque,true);const after=await read();assert.deepEqual(after.cells,savedView.cells);assert.notEqual(after.witness.occurrence,savedView.witness.occurrence);await page.click('loc=role:tab[name="Report"]');const report=await page.evaluate(()=>({text:['report-title','report-category-label','report-value-label'].map(id=>document.getElementById(id)?.value),legend:document.querySelector('input[type="checkbox"]')?.checked,body:document.body.innerText}));assert.match(report.body,/This bar report/);assert.deepEqual(report.text,boundary);assert.equal(report.legend,false);assert.match(report.body,/Paper\s+1000/);assert.match(report.body,/Stationery\s+800/);assert.deepEqual(await record(opaque),saved);
 await page.click('text="Save a copy"');await page.fill('.ts-modal--save input',canonical);await page.click('text="Create copy"');await page.waitForFunction(()=>document.querySelector('[data-testid="save-status"]')?.textContent.includes('Save failed'));assert.deepEqual(await record(canonical),canonicalRecord);assert.deepEqual(await record(opaque),saved);
 return {canonicalRecord,saved,savedView,after,report};
});
for(const [id,file,size] of [['E-CSV64-row-control','rows-64.csv',64],['E-CSV16-column-control','fields-16.csv',16]])await caseRun(id,async()=>{
 await imported(file,[]);const before=await read();assert.deepEqual(before.cells,file.startsWith('rows')?Array.from({length:size},(_,i)=>['row'+i]):[Array(size).fill('x')]);const name=prefix+'-'+id;await createCopy(name);await reopen(name,true);const after=await read();assert.deepEqual(after.cells,before.cells);assert.notEqual(after.witness.occurrence,before.witness.occurrence);return {before,after};
});
for(const file of ['rows-65.csv','fields-17.csv'])await caseRun('E-profile-refusal-'+file,async()=>{
 await page.click('text="Try example"');await page.waitForSelector('[data-testid="project-ready"]');await home();const countBefore=await counts();
 await page.setInputFiles('input[type="file"][accept*=".csv"]',SAVE_CLOSURE_CONFIG.prep+'/fixtures/'+file);await page.waitForSelector('[role="alert"]');assert.equal(await page.evaluate(()=>!!document.querySelector('.ts-modal--import')),false);assert.match((await read()).body,/CSV exceeds/);const countAfter=await counts();assert.equal(countAfter.importSpreadsheet??0,countBefore.importSpreadsheet??0);assert.equal(await page.evaluate(()=>!!document.querySelector('[data-testid="project-ready"]')),false);return {countBefore,countAfter,publication:false};
});
await caseRun('F-existing-read-fault-no-publication-recovery',async()=>{
 await imported('date-only.csv',['text','text','number','number','text']);await summaryBinding();await createSummary();await page.click('text="Create bar report"');await page.fill('#report-title','Prior authored report');await createCopy(prefix+'-prior');const saved=await record(prefix+'-prior');const runtimeBefore=await snapshot();
 await summaryBinding();const before=await counts();await page.evaluate(()=>window.__tachikoAcceptance.failNextOpenProjection());await createSummary();const after=await counts();assert.equal(after.createKeyedGroupedSum??0,before.createKeyedGroupedSum??0);await page.click('loc=role:button[name="Refresh"]');await page.waitForSelector('[data-testid="project-ready"]');assert.deepEqual(await snapshot(),runtimeBefore);await page.click('loc=role:tab[name="Report"]');assert.equal(await page.evaluate(()=>document.querySelector('#report-title')?.value),'Prior authored report');assert.deepEqual(await record(prefix+'-prior'),saved);return {before,after,saved};
});
await caseRun('R-unchanged-private-reader-Date-fixture',async()=>{
 // Reader-only fixture setup on this isolated test origin. No ordinary Save PASS inferred.
 const meta=JSON.parse(await fs.readFile(SAVE_CLOSURE_CONFIG.prep+'/fixtures/date-only-private.json','utf8'));const bytes=Array.from(await fs.readFile(SAVE_CLOSURE_CONFIG.prep+'/fixtures/date-only-private.bin'));const source=Array.from(await fs.readFile(SAVE_CLOSURE_CONFIG.prep+'/fixtures/date-only.csv'));const name=prefix+'-old-reader';
 await page.evaluate(async({name,meta,bytes,source})=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('tachiko-sheet-local-copies');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});const tx=db.transaction('opaque-copies','readwrite');tx.objectStore('opaque-copies').add({kind:'opaque',formatVersion:2,name,savedAt:'2026-09-26T00:00:00.000Z',revision:meta.revision,bytes:new Uint8Array(bytes).buffer,importedSource:{name:'date-only.csv',format:'csv',bytes:new Uint8Array(source).buffer,metadata:meta.metadata,ledger:meta.ledger}});await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error);tx.onabort=()=>j(tx.error);});db.close();},{name,meta,bytes,source});
 await page.reload();await page.waitForSelector('[data-testid="project-ready"]');await home();await page.click('text="Open saved '+name+'"');await page.waitForSelector('[data-testid="project-ready"]');const reopened=await read();assert.deepEqual(reopened.cells,[['PEN','Stationery','4','200','2026-09-26'],['NOTE','Paper','5','200','2026-09-27']]);assert.match(reopened.save,/Saved/);assert.equal((await record(name)).coreHash,meta.coreSha256);await verifyDateSavedSource(name);await editDateUi('2026-09-29');await page.click('text="Import & export"');assert.match((await read()).body,/original source remains available/);return {reopened,record:await record(name)};
});
await fs.writeFile(SAVE_CLOSURE_CONFIG.receipt,JSON.stringify({mode:SAVE_CLOSURE_CONFIG.mode,origin,prefix,results},null,2)+'\n');
console.log(results.map(r=>({id:r.id,result:r.result,message:r.message})));console.log(await page.snapshot());
if(results.some(r=>r.result==='SETUP_OR_EXECUTION_ERROR'))throw Error('SETUP_OR_EXECUTION_ERROR is not behavioral RED; diagnose the recorded boundary.');
// Behavioral RED is expected only on the unchanged pre-repair baseline. Receipt is never a product PASS.

const reds=results.filter(r=>r.result==='BEHAVIORAL_RED').map(r=>r.id);
if(SAVE_CLOSURE_CONFIG.mode==='baseline')assert.deepEqual(reds,['A-Date-only-normal-Save-fresh-reopen','B-same-table-Date-summary-refusal','C-unrelated-Date-summary-refusal','C-empty-unrelated-Date-schema-refusal'],'Baseline must reproduce exactly the four target failures, and all controls must PASS.');
else assert.deepEqual(reds,[],'Candidate requires every scenario PASS; baseline reproduction is not product qualification.');
