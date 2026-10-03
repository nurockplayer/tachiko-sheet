// Hosted ordinary product gate. Local browser work uses exported journeys
// through Ego. Importing the helpers never launches another browser.
import {runReleaseContextJourneys} from './focused-cell-context-journeys.mjs';
import {runSalesContextJourneys} from './focused-cell-sales-journeys.mjs';
import {installDistRoutes,LOCAL_ORIGIN} from './dist-routes.mjs';
const url=process.env.WORK_CLIENT_URL??(process.env.WORK_DIST?LOCAL_ORIGIN:undefined);
if(!url){console.error('BLOCKED: WORK_CLIENT_URL or WORK_DIST is required.');process.exit(78);}
const {chromium}=await import(process.env.WORK_PLAYWRIGHT_MODULE??'playwright-core');
const browser=await chromium.launch({headless:true,
  ...(process.env.WORK_CHROMIUM?{executablePath:process.env.WORK_CHROMIUM}:{}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS==='1'?{args:['--single-process']}:{})});
try {
  const context=await browser.newContext();
  if(process.env.WORK_DIST)await installDistRoutes(context,process.env.WORK_DIST);
  const page=await context.newPage();await page.setViewportSize({width:1440,height:900});
  console.log(JSON.stringify(await runReleaseContextJourneys(page,{url,acceptanceFaults:true})));
  const salesContext=await browser.newContext();
  if(process.env.WORK_DIST)await installDistRoutes(salesContext,process.env.WORK_DIST);
  const salesPage=await salesContext.newPage();await salesPage.setViewportSize({width:1440,height:900});
  console.log(JSON.stringify(await runSalesContextJourneys(salesPage,{url,setViewport:(width,height)=>salesPage.setViewportSize({width,height})})));
} finally {await browser.close();}
