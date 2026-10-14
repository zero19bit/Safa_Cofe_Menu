import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir,stat } from 'node:fs/promises';
import { esc,normalize,priceHTML } from '../public/assets/common.js';
import QRCode from 'qrcode';

test('Persian search normalization and safe HTML escaping',()=>{
  assert.equal(normalize('آيس‌ لاته'),normalize('آیس لاته'));
  assert.equal(normalize('كاپوچينو ۱۲'),normalize('کاپوچینو 12'));
  assert.ok(!esc('<img src=x onerror="alert(1)">').includes('<img'));
});
test('Prices render zero, specials, daily/unpriced and independent variants correctly',()=>{
  assert.ok(priceHTML({price_type:'fixed',price:0}).includes('۰'));
  assert.ok(priceHTML({price_type:'fixed',price:100,special_price:90}).includes('<del>'));
  assert.match(priceHTML({price_type:'daily'}),/قیمت روز/);
  assert.match(priceHTML({price_type:'unpriced'}),/پرسش از کافه/);
  const html=priceHTML({price_type:'fixed',variants:[{label:'<script>',price:100},{label:'دبل',price:200,special_price:150}]});assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('NaN'));
});
test('Customer and management pages have brand, RTL, metadata, accessibility and safe CSP-compatible scripts',async()=>{
  for(const name of ['index','admin','qr']){
    const html=await readFile(`public/${name}.html`,'utf8');assert.match(html,/lang="fa" dir="rtl"/);assert.match(html,/کافه صفا/);assert.match(html,/viewport/);assert.match(html,/rel="icon"/);assert.ok(!/\son\w+=/i.test(html));assert.ok(!/<script(?![^>]*src=)[^>]*>\s*[^<]/.test(html));
  }
  const html=await readFile('public/admin.html','utf8');assert.match(html,/noindex/);assert.match(html,/autocomplete="current-password"/);assert.match(html,/<dialog/);
  const names=(await readdir('public/assets')).filter(x=>x.endsWith('.js'));
  for(const name of names){const js=await readFile(`public/assets/${name}`,'utf8');assert.ok(!/localStorage|sessionStorage|indexedDB|serviceWorker/.test(js));assert.ok(!/sb_secret_|service_role|SUPABASE_SECRET_KEY/.test(js));}
});
test('Build includes local fonts, compiled QR, all pages and original logo',async()=>{
  for(const path of ['index.html','admin.html','qr.html','assets/qr.js','assets/logo.jpg','assets/fonts/vazirmatn-arabic-400-normal.woff2','assets/fonts/vazirmatn-arabic-700-normal.woff2','assets/fonts/vazirmatn-latin-400-normal.woff2','robots.txt'])assert.ok((await stat(`dist/${path}`)).size>0,path);
  assert.ok((await readFile('public/assets/logo.jpg')).equals(await readFile('dist/assets/logo.jpg')));
});
test('QR encoder supports the actual landing-page URL with a quiet zone',async()=>{
  const svg=await QRCode.toString('https://safa.example/qr',{type:'svg',margin:4,errorCorrectionLevel:'M'});assert.match(svg,/<svg/);assert.match(svg,/viewBox/);assert.ok(svg.length>500);
});
