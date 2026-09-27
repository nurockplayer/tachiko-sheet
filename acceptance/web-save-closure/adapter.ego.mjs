// Actual source adapter + real pinned Worker/WASM. Faults only corrupt/read replies.
const fs=await import('node:fs/promises');const assert=(await import('node:assert/strict')).default;
const task=await taskSpace(SAVE_CLOSURE_CONFIG.space);const page=task.page('p1');await page.goto(SAVE_CLOSURE_CONFIG.origin+'/qualification.html');
const result=await page.evaluate(async()=>{
 const kit=await import('/core-kit/experimental-client.js');const {createSheetRuntime}=await import('/prep/.generated/runtime/session.js');
 const sources=await(await fetch('/prep/.generated/sources.json')).json();const receipts=[];
 for(const fault of ['stale-witness','stale-bootstrap','stale-table','unavailable-unrelated-table']){
  const client=kit.createExperimentalDesignerClient();let armed=false;let creates=0;
  const proxy=new Proxy(client,{get(target,key){const value=target[key];if(typeof value!=='function')return value;
   return async(...args)=>{if(key==='createKeyedGroupedSum')creates++;
    const reply=await value.apply(target,args);
    if(armed&&key==='bootstrap'&&fault==='stale-bootstrap')return {...reply,revision:'unrelated-stale-revision'};
    if(armed&&key==='queryTable'&&args[0]==='sheet_3'&&fault==='unavailable-unrelated-table')throw Error('Bounded transport read unavailable: unrelated Date collection');
    if(armed&&key==='queryTable'&&fault==='stale-table')return {...reply,revision:'unrelated-stale-revision'};
    return reply;};}});
  const runtime=createSheetRuntime(async()=>({...kit,createExperimentalDesignerClient:()=>proxy}));
  try{
   const bytes=await(await fetch('/prep/fixtures/unrelated-date.xlsx')).arrayBuffer();
   const imported=await runtime.importSpreadsheet(bytes,'xlsx',{delimiter:',',header:true},{column_types:[['text','number'],['text','text','number'],['date']],extra_columns:[[],[],[]]});
   const witness={occurrence:imported.view.occurrence,revision:imported.view.revision};
   // A prior coherent UI catalog must never substitute for invocation-time facts.
   const catalog=await runtime.listKeyedGroupedSumBindings(witness);
   const before=await runtime.exportOpaque(witness);armed=true;let error=null;
   try{await runtime.createKeyedGroupedSum(fault==='stale-witness'?{...witness,occurrence:'not-live'}:witness,{ordersCollection:'sheet_1',orderLookupKeyField:'column_1',orderQuantityField:'column_2',productsCollection:'sheet_2',productKeyField:'column_1',productCategoryField:'column_2',productPriceField:'column_3'});}catch(e){error={name:e.name,message:e.message};}
   armed=false;const after=await runtime.exportOpaque(witness);const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
   receipts.push({fault,error,creates,catalog,beforeHash:await hash(before.bytes),afterHash:await hash(after.bytes),beforeRevision:before.revision,afterRevision:after.revision});
  }finally{await runtime.close();client.close();}
 }
 return {sources,receipts};
});
for(const r of result.receipts){assert.ok(r.error,'Failed facts must refuse');assert.equal(r.creates,0,'No producer Create dispatch');assert.equal(r.beforeHash,r.afterHash);assert.equal(r.beforeRevision,r.afterRevision);assert.ok(r.catalog.collections.some(c=>c.fields.some(f=>f.fieldType==='date')));}
await fs.writeFile(SAVE_CLOSURE_CONFIG.receipt,JSON.stringify({status:'PASS',boundary:'Exact source adapter, real pinned WASM, bounded read-reply faults; not normal UI save proof',...result},null,2)+'\n');console.log(result.receipts.map(({fault,error,creates})=>({fault,error,creates})));console.log(await page.snapshot());
