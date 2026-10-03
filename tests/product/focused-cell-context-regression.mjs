// Hosted ordinary product gate. Local browser work uses exported journeys
// through Ego. Importing the helpers never launches another browser.
import {runReleaseContextJourneys} from './focused-cell-context-journeys.mjs';
import {runSalesContextJourneys} from './focused-cell-sales-journeys.mjs';
import {installDistRoutes,LOCAL_ORIGIN} from './dist-routes.mjs';
import {runContextOracleFalsifiers} from './focused-cell-context-falsification.mjs';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const url=process.env.WORK_CLIENT_URL??(process.env.WORK_DIST?LOCAL_ORIGIN:undefined);
if(!url){console.error('BLOCKED: WORK_CLIENT_URL or WORK_DIST is required.');process.exit(78);}
const {chromium}=await import(process.env.WORK_PLAYWRIGHT_MODULE??'playwright-core');
const browser=await chromium.launch({headless:true,
  ...(process.env.WORK_CHROMIUM?{executablePath:process.env.WORK_CHROMIUM}:{}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS==='1'?{args:['--single-process']}:{})});
let componentServer;
try {
  console.log(JSON.stringify(runContextOracleFalsifiers()));
  const context=await browser.newContext();
  if(process.env.WORK_DIST)await installDistRoutes(context,process.env.WORK_DIST);
  const page=await context.newPage();await page.setViewportSize({width:1440,height:900});
  console.log(JSON.stringify(await runReleaseContextJourneys(page,{url,acceptanceFaults:true})));
  const salesContext=await browser.newContext();
  if(process.env.WORK_DIST)await installDistRoutes(salesContext,process.env.WORK_DIST);
  const salesPage=await salesContext.newPage();await salesPage.setViewportSize({width:1440,height:900});
  console.log(JSON.stringify(await runSalesContextJourneys(salesPage,{url,setViewport:(width,height)=>salesPage.setViewportSize({width,height})})));
  // Separate isolated actual-component gate, without App/runtime/state hooks.
  componentServer=await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'error'});
  await componentServer.listen();
  const port=componentServer.httpServer.address().port;
  const componentContext=await browser.newContext();const componentPage=await componentContext.newPage();
  await componentPage.goto(`http://127.0.0.1:${port}/tests/qualification/focused-cell-context.html`);
  await componentPage.waitForFunction(()=>window.__focusedCellContextContract?.status!=='RUNNING'&&!!window.__focusedCellContextContract,{timeout:30000});
  const receipt=await componentPage.evaluate(()=>window.__focusedCellContextContract);
  assert.equal(receipt.status,'PASS',receipt.message??'actual connected component contract');
  assert.equal(receipt.projectionContractCases,9);assert.equal(receipt.falsifiers.length,5);
  console.log(JSON.stringify(receipt));
} finally {try{await browser.close();}finally{await componentServer?.close();}}
