// Configuration is passed as literal code input: ego's service does not inherit shell env.
import {readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
const prep=path.dirname(fileURLToPath(import.meta.url));
await import('./verify-fixtures.mjs');
const [suite,space,receipt,origin='http://127.0.0.1:4786',mode='candidate']=process.argv.slice(2);
if(!['qualify-kit','product','adapter'].includes(suite)||!Number.isInteger(Number(space))||!receipt)throw Error('Usage: node run.mjs qualify-kit|product|adapter SPACE RECEIPT [ORIGIN] [baseline|candidate]');
if(!['baseline','candidate'].includes(mode))throw Error('Mode must explicitly be baseline or candidate');
const config={space:Number(space),receipt:path.resolve(receipt),origin,prep,mode};
const source=await readFile(path.join(prep,suite+'.ego.mjs'),'utf8');
execFileSync('ego-browser',['nodejs'],{input:'const SAVE_CLOSURE_CONFIG='+JSON.stringify(config)+';\n'+source,stdio:['pipe','inherit','inherit'],maxBuffer:16*1024*1024});
