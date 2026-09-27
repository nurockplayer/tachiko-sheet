// Prerequisite qualification, not product UI PASS. Run with ego-browser nodejs < file.
const fs=await import('node:fs/promises');const assert=(await import('node:assert/strict')).default;
const task=await taskSpace(SAVE_CLOSURE_CONFIG.space);const page=task.page('p1');
const origin=SAVE_CLOSURE_CONFIG.origin;
await page.goto(origin+'/qualification.html');
const result=await page.evaluate(async()=>{
 const kit=await import('/core-kit/experimental-client.js');
 const rows=t=>t.rows.map(r=>({key:r.key,fields:r.fields.map(f=>({field:f.target.field,stored:f.stored}))}));
 const normalized=t=>({columns:t.columns.map(c=>({id:c.id,key:c.key,type:c.field_type})),rows:rows(t)});
 const receipts=[];
 for(const [name,format,types] of [
 ['date-only.csv','csv',[['text','text','number','number','date']]],
 ['unrelated-date.xlsx','xlsx',[['text','number'],['text','text','number'],['date']]],
 ['unrelated-date-empty.xlsx','xlsx',[['text','number'],['text','text','number'],['date']]]]){
 const c=kit.createExperimentalDesignerClient();
 try{const bytes=await (await fetch('/prep/fixtures/'+name)).arrayBuffer();
 const inspected=await c.inspectSpreadsheet(bytes,format,{delimiter:',',header:true});
 const imported=await c.importSpreadsheet(bytes,format,{delimiter:',',header:true},{column_types:types,extra_columns:types.map(()=>[])});
 const beforeOccurrence=await c.observeOccurrence();const boot=await c.bootstrap();const before=[];
 for(const collection of boot.collections) before.push({key:collection.key,table:normalized(await c.queryTable(collection.key))});
 const exported=await c.exportProject(boot.revision);
 // The precise metadata check used by production openOpaque must accept these bytes.
 await c.inspectImportedProject(exported.bytes.slice(0),imported.metadata);
 await c.closeProject();await c.openProject(exported.bytes.slice(0));
 const afterOccurrence=await c.observeOccurrence();const after=[];
 for(const collection of (await c.bootstrap()).collections) after.push({key:collection.key,table:normalized(await c.queryTable(collection.key))});
 const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',exported.bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 receipts.push({name,sourceSheets:inspected.sheets.map(s=>({name:s.name,columns:s.columns.length,rows:s.rows.length})),beforeOccurrence,afterOccurrence,before,after,metadata:imported.metadata,ledger:imported.ledger,fixtureBytes:Array.from(new Uint8Array(exported.bytes)),exportBytes:exported.bytes.byteLength,sha256:h});
 }finally{c.close();}}
 return receipts;
});
// Independent literal source/type/value oracles, not merely before/after equality.
for(const r of result){
 const dateOnly=r.name==='date-only.csv';
 const types=dateOnly?[['text','text','number','number','date']]:[['text','number'],['text','text','number'],['date']];
 const values=dateOnly?[[['PEN','Stationery',4,200,'2026-09-26'],['NOTE','Paper',5,200,'2026-09-27']]]:[[['PEN',4],['NOTE',5]],[['PEN','Stationery',200],['NOTE','Paper',200]],r.name.includes('empty')?[]:[['2026-09-26']]];
 assert.deepEqual(r.before.map(c=>c.table.columns.map(f=>f.type)),types);
 assert.deepEqual(r.before.map(c=>c.table.rows.map(row=>row.fields.map(f=>f.stored.value))),values);
 assert.deepEqual(r.sourceSheets.map(c=>[c.name,c.columns,c.rows]),dateOnly?[['Imported table',5,2]]:[['sales',2,2],['catalog',3,2],['dates',1,r.name.includes('empty')?0:1]]);
}
for(const r of result){assert.deepEqual(r.after,r.before);assert.equal(typeof r.beforeOccurrence.scope,"string");assert.notEqual(r.afterOccurrence.scope,r.beforeOccurrence.scope);assert.ok(r.before.some(c=>c.table.columns.some(f=>f.type==='date')));if(r.name.includes('empty')) assert.equal(r.before.at(-1).table.rows.length,0);}
// Frozen reader fixture is never overwritten by qualification reruns.
for(const r of result)delete r.fixtureBytes;
await fs.writeFile(SAVE_CLOSURE_CONFIG.receipt,JSON.stringify({status:'PASS',boundary:'real pinned public Worker/WASM export + imported metadata inspection + fresh reopen; not product UI',result},null,2)+'\n');
console.log(result.map(r=>({name:r.name,exportBytes:r.exportBytes,before:r.beforeOccurrence,after:r.afterOccurrence})));console.log(await page.snapshot());
