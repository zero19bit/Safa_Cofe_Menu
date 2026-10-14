import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as bundle } from 'esbuild';

export async function build(){
  await rm('dist',{recursive:true,force:true});await mkdir('dist/assets/fonts',{recursive:true});
  await cp('public','dist',{recursive:true});await rm('dist/assets/qr-entry.js',{force:true});
  for(const subset of ['arabic','latin'])for(const weight of [400,700]){
    const name=`vazirmatn-${subset}-${weight}-normal.woff2`;
    await cp(`node_modules/@fontsource/vazirmatn/files/${name}`,`dist/assets/fonts/${name}`);
  }
  await cp('node_modules/@fontsource/vazirmatn/LICENSE','dist/assets/fonts/LICENSE.txt');
  await bundle({entryPoints:['public/assets/qr-entry.js'],bundle:true,minify:true,format:'esm',platform:'browser',target:['safari15.4','chrome100'],outfile:'dist/assets/qr.js',legalComments:'eof'});
  const origin=process.env.APP_ORIGIN;
  if(origin&&/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(origin)&&!origin.includes('YOUR-PROJECT')){
    for(const [page,path] of [['index.html','/'],['qr.html','/qr']]){
      let html=await readFile(`dist/${page}`,'utf8');html=html.replace('</head>',`<link rel="canonical" href="${origin}${path}"><meta property="og:url" content="${origin}${path}"><meta property="og:image" content="${origin}/assets/logo.jpg"></head>`);
      await writeFile(`dist/${page}`,html);
    }
    await writeFile('dist/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/qr</loc></url></urlset>`);
  }
  await writeFile('dist/robots.txt',`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${origin&&!origin.includes('YOUR-PROJECT')?`Sitemap: ${origin}/sitemap.xml\n`:''}`);
  console.log('Built customer menu, admin panel, QR page, local fonts and QR encoder.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await build();
