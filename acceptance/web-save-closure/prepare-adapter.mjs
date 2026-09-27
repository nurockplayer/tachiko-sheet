// Erase types only from the exact production adapter, for real-kit fault qualification.
import {stripTypeScriptTypes} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const prep=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(prep,'../..');const files=['src/contracts.ts','src/runtime/session.ts'];const sources=[];
for(const file of files){const source=await readFile(path.join(root,file),'utf8');const target=path.join(prep,'.generated',file.replace('src/','').replace('.ts','.js'));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,stripTypeScriptTypes(source,{mode:'strip'}));sources.push({file,sha256:createHash('sha256').update(source).digest('hex')});}
await writeFile(path.join(prep,'.generated/sources.json'),JSON.stringify(sources,null,2)+'\n');
