import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function files(dir){const all=[];for(const e of await readdir(dir,{withFileTypes:true})){const path=`${dir}/${e.name}`;if(e.isDirectory())all.push(...await files(path));else all.push(path);}return all;}
const code=[...(await files('server')),...(await files('api')),...(await files('scripts')),...(await files('public'))].filter(f=>/\.(mjs|js)$/.test(f));
for(const file of code){execFileSync(process.execPath,['--check',file],{stdio:'pipe'});if(file.startsWith('public/')){const source=await readFile(file,'utf8');if(/\b(?:localStorage|sessionStorage|indexedDB|serviceWorker)\b/.test(source))throw new Error(`Unexpected browser data storage in ${file}`);}}
JSON.parse(await readFile('vercel.json','utf8'));console.log(`Syntax valid for ${code.length} JavaScript modules; no browser data persistence in customer or admin code.`);
