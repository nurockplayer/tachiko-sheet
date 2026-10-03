// Invoked by run-ego.mjs with explicit repository/space/receipt configuration.
const {pathToFileURL}=await import('node:url');
const {writeFile}=await import('node:fs/promises');
const {runFocusedCellRedteamRegression}=await import(pathToFileURL(redteamConfig.root+'/tests/product/focused-cell-redteam-regression.mjs'));
const owned=!redteamConfig.space;
const task=await taskSpace(owned?'Sheet context oracle controls':Number(redteamConfig.space));
const page=task.page('p1');
// Existing browser zoom can change CSS workspace dimensions. Verify actual
// dimensions without changing the user's browser-wide zoom preference.
const setViewport=async(width,height)=>{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 if(actual.width!==width||actual.height!==height)await page.cdp('Emulation.setDeviceMetricsOverride',{width:Math.round(width*width/actual.width),height:Math.round(height*height/actual.height),deviceScaleFactor:1,mobile:false});
 await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
};
const receipt=await runFocusedCellRedteamRegression(page,{setViewport});
if(redteamConfig.receipt)await writeFile(redteamConfig.receipt,JSON.stringify(receipt,null,2)+'\n');
console.log({spaceId:task.spaceId,status:receipt.status,nodeCounts:receipt.nodeCounts,oldPass:27,repairedRejection:27,scope:receipt.scope});
if(owned)await task.finish({keep:[]});
