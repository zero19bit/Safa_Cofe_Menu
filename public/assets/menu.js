import {$,$$,esc,fa,normalize,digits,api,priceHTML,applyBrand,bindImageFallback,toast} from './common.js';
const demo=new URLSearchParams(location.search).get('demo')==='1';
let snapshot=null,featuredOnly=false,loading=false,spy;
function contact(settings){
  const parts=[];
  if(settings.working_hours)parts.push(`<div><span class="footer-label">ساعت کاری</span><p>${esc(settings.working_hours)}</p></div>`);
  if(settings.address)parts.push(`<div><span class="footer-label">نشانی کافه</span><p>${esc(settings.address)}</p></div>`);
  if(settings.phone||settings.instagram)parts.push(`<div><span class="footer-label">در ارتباط باشیم</span>${settings.phone?`<a dir="ltr" href="tel:${esc(digits(settings.phone).replace(/[^+0-9]/g,''))}">${esc(settings.phone)}</a>`:''}${settings.instagram?`<a dir="ltr" href="https://instagram.com/${esc(settings.instagram)}" target="_blank" rel="noopener noreferrer">@${esc(settings.instagram)}</a>`:''}</div>`);
  $('#footer-info').innerHTML=parts.join('');
  $('#hero-details').innerHTML=[settings.working_hours?`<span>◷ ${esc(settings.working_hours)}</span>`:'',settings.address?`<span>⌖ ${esc(settings.address)}</span>`:''].join('');
}
function productHTML(p){
  return `<article class="product-card"><div class="product-main">${p.image_url?`<img class="product-photo" src="${esc(p.image_url)}" alt="${esc(p.name)}" width="80" height="80" loading="lazy" decoding="async">`:''}<div class="product-copy"><div class="product-title"><h3>${esc(p.name)}</h3>${p.featured?'<span class="badge">پیشنهاد صفا</span>':''}${p.is_new?'<span class="badge new">جدید</span>':''}</div>${p.description?`<p>${esc(p.description)}</p>`:''}</div></div><div class="product-prices">${priceHTML(p)}</div></article>`;
}
function render(){
  if(!snapshot)return;
  const s=snapshot.settings;applyBrand(s);contact(s);
  document.title=`${s.cafe_name} | منوی دیجیتال`;
  $('#tagline').textContent=s.tagline||'به صفا خوش آمدید';
  const q=normalize($('#search').value);
  const products=snapshot.products.filter(p=>(!featuredOnly||p.featured)&&(!q||normalize(`${p.name} ${p.description} ${snapshot.categories.find(c=>c.id===p.category_id)?.name||''}`).includes(q)));
  const cats=snapshot.categories.filter(c=>products.some(p=>p.category_id===c.id));
  $('#result-count').textContent=products.length?`${fa(products.length)} انتخاب · قیمت‌ها به تومان`:'قیمت‌ها به تومان';
  $('#clear-search').hidden=!$('#search').value;
  $('#categories').innerHTML=cats.map((c,i)=>`<a href="#category-${esc(c.id)}" class="category-chip${i===0?' active':''}"><span aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}<small>${fa(products.filter(p=>p.category_id===c.id).length)}</small></a>`).join('');
  $('#menu-sections').innerHTML=cats.map((c,i)=>`<section class="menu-section" id="category-${esc(c.id)}"><div class="section-heading"><span class="section-number">${fa(i+1).padStart(2,'۰')}</span><h2>${esc(c.name)}</h2><span class="section-line"></span><span class="category-symbol" aria-hidden="true">${esc(c.icon)}</span></div><div class="product-grid">${products.filter(p=>p.category_id===c.id).map(productHTML).join('')}</div></section>`).join('');
  $('#menu-status').hidden=Boolean(products.length);
  if(!products.length)$('#menu-status').innerHTML=`<span class="empty-mark" aria-hidden="true">☕</span><h3>${!s.menu_published?'منوی صفا در حال آماده‌سازی است':q||featuredOnly?'انتخابی پیدا نشد':'منو به‌زودی آماده می‌شود'}</h3><p>${!s.menu_published?'به‌زودی انتخاب‌های کافه را همین‌جا خواهید دید.':q||featuredOnly?'عبارت دیگری جست‌وجو کنید یا فیلتر پیشنهادها را بردارید.':'برای اطلاع از انتخاب‌های امروز، از همکاران کافه بپرسید.'}</p>`;
  $('#menu-footnote').hidden=!products.length;
  $('#retry').hidden=true;
  bindImageFallback($('#menu-sections'));
  spy?.disconnect();
  if('IntersectionObserver' in window){spy=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)$$('.category-chip').forEach(a=>{const active=a.getAttribute('href')===`#${e.target.id}`;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});}),{rootMargin:'-20% 0px -65% 0px'});$$('.menu-section').forEach(s=>spy.observe(s));}
}
async function load(quiet=false){
  if(loading)return;loading=true;
  try{
    const next=demo?await fetch('/assets/demo-menu.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('پیش‌نمایش نمونه در دسترس نیست.');return r.json();}):await api('/api/menu');
    if(JSON.stringify(next)!==JSON.stringify(snapshot)){snapshot=next;render();}
  }catch(e){
    if(!snapshot){$('#menu-status').hidden=false;$('#menu-status').innerHTML='<span class="empty-mark" aria-hidden="true">☕</span><h3>منو فعلاً در دسترس نیست</h3><p></p>';$('#menu-status p').textContent=e.code==='not_configured'?'منوی آنلاین کافه هنوز راه‌اندازی نشده است.':e.message;$('#retry').hidden=false;}
    else if(!quiet)toast('به‌روزرسانی منو انجام نشد. دوباره تلاش کنید.',true);
  }finally{loading=false;}
}
$('#demo-banner').hidden=!demo;
$('#search').addEventListener('input',render);
$('#clear-search').addEventListener('click',()=>{$('#search').value='';render();$('#search').focus();});
$('#featured').addEventListener('click',()=>{featuredOnly=!featuredOnly;$('#featured').setAttribute('aria-pressed',String(featuredOnly));render();});
$('#retry').addEventListener('click',()=>load());
if(!demo){setInterval(()=>{if(document.visibilityState==='visible')load(true);},30000);window.addEventListener('focus',()=>load(true));}
load();
