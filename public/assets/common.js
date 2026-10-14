export const $ = s=>document.querySelector(s);
export const $$ = s=>[...document.querySelectorAll(s)];
export const esc = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fa = n=>Number(n).toLocaleString('fa-IR');
export const digits = s=>String(s).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c));
export const normalize = s=>digits(s).replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[\u064b-\u065f\u200c\s-]/g,'').toLowerCase();
let csrfToken='';
export const setCsrf=t=>{csrfToken=t||'';};
export async function api(path,method='GET',body) {
  let response;
  try {response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
  catch {throw new Error('ارتباط برقرار نشد. اتصال اینترنت را بررسی کنید.');}
  let data;try{data=await response.json();}catch{throw new Error('پاسخ سرور معتبر نیست. دوباره تلاش کنید.');}
  if(!response.ok){const e=new Error(data.error?.message||'عملیات انجام نشد.');e.code=data.error?.code;e.status=response.status;e.retry_after=data.error?.retry_after;
    if(response.status===401&&!path.includes('/auth/'))window.dispatchEvent(new CustomEvent('session-expired'));throw e;}
  if(data.csrf_token)setCsrf(data.csrf_token);return data;
}
let timer;
export function toast(message,error=false){const el=$('#toast');if(!el)return;clearTimeout(timer);el.textContent=message;el.classList.toggle('error',error);el.hidden=false;timer=setTimeout(()=>{el.hidden=true;},4500);}
export function priceHTML(product){
  if(product.price_type==='daily')return '<span class="price-note">قیمت روز</span>';
  if(product.price_type==='unpriced')return '<span class="price-note">پرسش از کافه</span>';
  const one=row=>`${row.special_price!==null&&row.special_price!==undefined?`<del>${fa(row.price)}</del><strong>${fa(row.special_price)}</strong>`:`<strong>${fa(row.price)}</strong>`}<small>تومان</small>`;
  if(product.variants?.length)return product.variants.map(v=>`<div class="variant-price"><span>${esc(v.label)}</span><span class="price">${one(v)}</span></div>`).join('');
  return `<span class="price">${one(product)}</span>`;
}
export function bindImageFallback(root=document){root.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.src='/assets/logo.jpg';},{once:true}));}
export function applyBrand(settings){
  $$('[data-cafe-name]').forEach(el=>el.textContent=settings.cafe_name);
  const logo=settings.logo_url||'/assets/logo.jpg';
  ['#hero-logo','#footer-logo','#landing-logo','#admin-logo'].forEach(s=>{const img=$(s);if(img){img.src=logo;img.alt=settings.cafe_name;}});
  $$('.brand-logo').forEach(img=>img.src=logo);
  const icon=document.querySelector('link[rel="icon"]');if(icon)icon.href=logo;
  const touch=document.querySelector('link[rel="apple-touch-icon"]');if(touch)touch.href=logo;
  bindImageFallback();
}
export async function uploadFile(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('عکس JPG، PNG یا WebP انتخاب کنید.');
  if(file.size>2097152)throw new Error('حجم عکس باید حداکثر ۲ مگابایت باشد.');
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('خواندن عکس ناموفق بود.'));reader.readAsDataURL(file);});
  return api('/api/image','POST',{base64,mime_type:file.type});
}
