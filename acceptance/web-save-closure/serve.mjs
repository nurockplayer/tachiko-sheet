// Isolated acceptance asset server. No product source, host data or kit mutation.
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const prep=path.dirname(fileURLToPath(import.meta.url));
const dist=path.resolve(process.env.SAVE_CLOSURE_DIST ?? 'dist-acceptance');
const port=Number(process.env.SAVE_CLOSURE_PORT ?? 4786);
const mime={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(req.method!=='GET') throw Error('read-only');
 if(url.pathname==='/qualification.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Save closure kit prerequisite qualification</title>');return;}
 const base=url.pathname.startsWith('/prep/')?prep:dist;
 const rel=url.pathname.startsWith('/prep/')?url.pathname.slice(6):url.pathname.slice(1);
 let file=path.resolve(base,decodeURIComponent(rel||'index.html'));
 if(!file.startsWith(base+path.sep)) throw Error('path boundary');
 try{await stat(file);}catch{file=path.join(dist,'index.html');}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Unavailable acceptance asset');}});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({origin:`http://127.0.0.1:${port}`,dist,prep})));
