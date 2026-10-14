import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { Readable } from 'node:stream';
import { handle } from '../server/app.mjs';
import { build } from './build.mjs';
await build();
const port=Number(process.env.PORT||3000);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
const root=resolve('public'),built=resolve('dist');
const aliases={'/':'/index.html','/admin':'/admin.html','/admin/':'/admin.html','/qr':'/qr.html','/qr/':'/qr.html'};
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host}`);
    if(url.pathname.startsWith('/api/')){
      const headers=new Headers(req.headers);headers.set('x-local-client-ip',req.socket.remoteAddress||'local');
      const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const response=await handle(request);res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const path=aliases[url.pathname]||decodeURIComponent(url.pathname);let file;
    for(const parent of [root,built]){
      const candidate=resolve(parent,`.${path}`);if(!candidate.startsWith(`${parent}/`))continue;
      try{if((await stat(candidate)).isFile()){file=candidate;break;}}catch{}
    }
    if(!file){res.writeHead(404);res.end('Not found');return;}
    const payload=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:payload);
  }catch{res.writeHead(500);res.end('Request failed');}
}).listen(port,'127.0.0.1',()=>console.log(`Safa: http://localhost:${port} | Sample preview: http://localhost:${port}/?demo=1`));
