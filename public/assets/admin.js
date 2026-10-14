import {$,$$,esc,fa,digits,api,setCsrf,toast,priceHTML,applyBrand,uploadFile,bindImageFallback} from './common.js';

let state=null,tab='products',busy=false,epoch=0,productQuery='',productCategory='';
let temporaryImages=[],pendingLogo=null,editorGeneration=0,savingEditor=false,lastActivity=Date.now(),lastSessionCheck=Date.now();
const editor=$('#editor');
const error=(e)=>toast(e.message||'عملیات انجام نشد.',true);
const checked=value=>value?' checked':'';
const selected=value=>value?' selected':'';
const n=value=>{const s=digits(value).replace(/[,،٬\s]/g,'');if(!s)return null;const x=Number(s);if(!Number.isSafeInteger(x)||x<0)throw new Error('قیمت را به‌صورت عدد صحیح وارد کنید.');return x;};
function gate(message=''){
  epoch++;state=null;setCsrf('');$('#admin-view').hidden=true;$('#login-view').hidden=false;
  $('#login-error').textContent=message;$('#login-form').elements.password.value='';
  if(editor.open)editor.close();editorGeneration++;savingEditor=false;if($('#confirmation').open)$('#confirmation').close();temporaryImages=[];
}
async function refresh(){
  const current=epoch;const next=await api('/api/admin');if(current!==epoch)return;
  state=next;$('#login-view').hidden=true;$('#admin-view').hidden=false;
  applyBrand(next.settings);document.title=`مدیریت ${next.settings.cafe_name}`;
  $('#admin-name').innerHTML=`${esc(next.settings.cafe_name)}<small>پنل مدیریت</small>`;
  $('#publish-status').textContent=next.settings.menu_published?'منو منتشر شده':'منو در حال آماده‌سازی';
  $('#publish-status').classList.toggle('draft',!next.settings.menu_published);
  $('#stats').innerHTML=[[next.products.length,'محصول'],[next.products.filter(p=>p.status).length,'محصول فعال'],[next.categories.length,'دسته'],[next.products.filter(p=>p.featured).length,'پیشنهاد صفا']].map(([v,t])=>`<div class="stat"><strong>${fa(v)}</strong><span>${t}</span></div>`).join('');
  render();
}
async function perform(action,message='تغییرات ذخیره شد'){
  if(busy)return false;busy=true;
  $$('#admin-view button').forEach(b=>b.disabled=true);
  try{await action();await refresh();toast(message);return true;}
  catch(e){error(e);if(e.code==='conflict')try{await refresh();}catch{}return false;}
  finally{busy=false;$$('#admin-view button').forEach(b=>{b.disabled=b.dataset.disabled==='true';});}
}
function render(){
  if(!state)return;
  $$('.admin-tabs button').forEach(b=>{const active=b.dataset.tab===tab;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});
  const root=$('#admin-content');
  if(tab==='products')renderProducts(root);
  if(tab==='categories')renderCategories(root);
  if(tab==='settings')renderSettings(root);
  if(tab==='media')renderMedia(root);
  if(tab==='qr')renderQR(root);
  bindImageFallback(root);
}
function renderProducts(root){
  root.innerHTML=`<div class="panel"><div class="panel-heading"><h2>محصولات منو</h2><div class="row-actions"><button id="add-product" class="button primary">＋ افزودن محصول</button><button id="export-menu" class="button secondary small-button">دریافت نسخه پشتیبان</button></div></div><div class="admin-filters"><label class="sr-only" for="product-search">جست‌وجوی محصول</label><input id="product-search" type="search" maxlength="100" placeholder="جست‌وجوی محصول…" value="${esc(productQuery)}"><label class="sr-only" for="product-category">دسته محصول</label><select id="product-category"><option value="">همه دسته‌ها</option>${state.categories.map(c=>`<option value="${c.id}"${selected(c.id===productCategory)}>${esc(c.name)}</option>`).join('')}</select></div><div id="product-list"></div></div>`;
  $('#add-product').onclick=()=>editProduct();$('#export-menu').onclick=exportMenu;
  $('#product-search').addEventListener('input',()=>{productQuery=$('#product-search').value;renderProductRows();});
  $('#product-category').addEventListener('change',()=>{productCategory=$('#product-category').value;renderProductRows();});
  renderProductRows();
}
function renderProductRows(){
  if(!state)return;const q=digits(productQuery).replace(/ي/g,'ی').replace(/ك/g,'ک').toLowerCase();
  const list=state.products.filter(p=>(!productCategory||p.category_id===productCategory)&&`${p.name} ${p.description}`.toLowerCase().replace(/ي/g,'ی').replace(/ك/g,'ک').includes(q));
  $('#product-list').innerHTML=list.length?list.map(p=>`<div class="admin-row"><div><div class="admin-row-name">${esc(p.name)} ${p.featured?'<span class="badge">پیشنهاد</span>':''}</div><div class="admin-row-desc">${esc(state.categories.find(c=>c.id===p.category_id)?.name||'')} ${p.is_new?'· جدید':''}</div></div><div class="admin-price">${priceHTML(p)}</div><div class="row-actions"><button class="toggle-button${p.status?'':' off'}" data-product-toggle="${p.id}" aria-label="${p.status?'غیرفعال کردن':'فعال کردن'} ${esc(p.name)}">${p.status?'فعال':'غیرفعال'}</button><button class="text-button" data-product-edit="${p.id}">ویرایش</button><button class="text-button destructive" data-product-delete="${p.id}">حذف</button></div></div>`).join(''):'<div class="empty-state"><p>محصولی پیدا نشد. اولین محصول را اضافه کنید.</p></div>';
  $$('[data-product-edit]').forEach(b=>b.onclick=()=>editProduct(state.products.find(p=>p.id===b.dataset.productEdit)));
  $$('[data-product-toggle]').forEach(b=>b.onclick=()=>{const p=state.products.find(p=>p.id===b.dataset.productToggle);perform(()=>api('/api/product','PUT',{id:p.id,if_match:p.updated_at,status:!p.status}));});
  $$('[data-product-delete]').forEach(b=>b.onclick=async()=>{const p=state.products.find(p=>p.id===b.dataset.productDelete);if(await confirm(`«${p.name}» از منو حذف شود؟`))perform(()=>api('/api/product','DELETE',{id:p.id,if_match:p.updated_at}),'محصول حذف شد');});
}
function renderCategories(root){
  root.innerHTML=`<div class="panel"><div class="panel-heading"><h2>دسته‌بندی منو</h2><button id="add-category" class="button primary">＋ افزودن دسته</button></div><p class="help">با پیکان‌ها ترتیب نمایش دسته‌ها را تغییر دهید. دسته‌ای که محصول دارد قابل حذف نیست.</p>${state.categories.length?state.categories.map((c,i)=>`<div class="category-row"><div class="category-label"><span class="category-icon" aria-hidden="true">${esc(c.icon)}</span><div><strong>${esc(c.name)}</strong><p class="help">${fa(state.products.filter(p=>p.category_id===c.id).length)} محصول ${c.active?'':'· غیرفعال'}</p></div></div><div class="category-controls"><button class="text-button" data-move="${c.id}" data-direction="-1"${i===0?' disabled data-disabled="true"':''} aria-label="انتقال ${esc(c.name)} به بالا">↑</button><button class="text-button" data-move="${c.id}" data-direction="1"${i===state.categories.length-1?' disabled data-disabled="true"':''} aria-label="انتقال ${esc(c.name)} به پایین">↓</button><button class="text-button" data-category-edit="${c.id}">ویرایش</button><button class="text-button destructive" data-category-delete="${c.id}">حذف</button></div></div>`).join(''):'<div class="empty-state"><p>اولین دسته منو را اضافه کنید.</p></div>'}</div>`;
  $('#add-category').onclick=()=>editCategory();
  $$('[data-category-edit]').forEach(b=>b.onclick=()=>editCategory(state.categories.find(c=>c.id===b.dataset.categoryEdit)));
  $$('[data-category-delete]').forEach(b=>b.onclick=async()=>{const c=state.categories.find(c=>c.id===b.dataset.categoryDelete);if(state.products.some(p=>p.category_id===c.id)){toast('ابتدا محصولات این دسته را منتقل یا حذف کنید.',true);return;}if(await confirm(`دسته «${c.name}» حذف شود؟`))perform(()=>api('/api/category','DELETE',{id:c.id,if_match:c.updated_at}),'دسته حذف شد');});
  $$('[data-move]').forEach(b=>b.onclick=()=>{const order=state.categories.map(c=>c.id),i=order.indexOf(b.dataset.move),j=i+Number(b.dataset.direction);if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];perform(()=>api('/api/category','PUT',{order}),'ترتیب دسته‌ها ذخیره شد');});
}
function openEditor(title,html){editorGeneration++;savingEditor=false;temporaryImages=[];$('#editor-title').textContent=title;$('#editor-body').innerHTML=html;editor.showModal();}
async function deleteUnused(paths){for(const path of paths)try{await api('/api/image','DELETE',{path});}catch{}}
function closeEditor(){if(savingEditor)return;editorGeneration++;const paths=[...temporaryImages];temporaryImages=[];editor.close();if(paths.length)deleteUnused(paths);}
$('#editor-close').onclick=closeEditor;editor.addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
function editCategory(c){
  openEditor(c?'ویرایش دسته':'دسته جدید',`<form id="category-form"><div class="form-grid"><label>نام دسته<input name="name" maxlength="100" required value="${esc(c?.name||'')}"></label><label>نماد دسته<input name="icon" maxlength="12" value="${esc(c?.icon||'☕')}"></label><label class="check-label span-2"><input name="active" type="checkbox"${checked(c?.active??true)}>این دسته در منو نمایش داده شود</label></div><p class="form-error" id="editor-error" role="alert"></p><div class="form-actions"><button type="button" id="cancel-editor" class="button secondary">انصراف</button><button class="button primary" type="submit">ذخیره دسته</button></div></form>`);
  $('#cancel-editor').onclick=closeEditor;
  $('#category-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const input={name:f.elements.name.value,icon:f.elements.icon.value,active:f.elements.active.checked,sort_order:c?.sort_order??state.categories.length,...(c?{id:c.id,if_match:c.updated_at}:{})};f.querySelector('button[type=submit]').disabled=true;try{await api('/api/category',c?'PUT':'POST',input);closeEditor();await refresh();toast('دسته ذخیره شد');}catch(e){$('#editor-error').textContent=e.message;}finally{f.querySelector('button[type=submit]').disabled=false;}};
}
function variantRow(row={label:'',price:'',special_price:null}){
  return `<div class="variant-row"><label>نام گزینه<input data-variant-label maxlength="80" required value="${esc(row.label)}" placeholder="مثلاً دبل"></label><label>قیمت عادی<input data-variant-price inputmode="numeric" required value="${esc(row.price)}" placeholder="تومان"></label><label>قیمت ویژه<input data-variant-special inputmode="numeric" value="${esc(row.special_price??'')}" placeholder="اختیاری"></label><button type="button" class="icon-button remove-variant" aria-label="حذف این گزینه">×</button></div>`;
}
function bindVariantRemoval(){ $$('.remove-variant').forEach(b=>b.onclick=()=>{if($$('.variant-row').length===1){toast('حداقل یک گزینه قیمت لازم است.',true);return;}b.closest('.variant-row').remove();}); }
function editProduct(p){
  if(!state.categories.length){tab='categories';render();toast('ابتدا یک دسته برای محصولات بسازید.');return;}
  let imagePath=p?.image_path||null,imageUrl=p?.image_url||null,uploading=false;
  const mode=p?.variants?.length?'multi':p?.price_type||'fixed';
  openEditor(p?'ویرایش محصول':'محصول جدید',`<form id="product-form"><div class="form-grid"><label>نام محصول<input name="name" maxlength="150" required value="${esc(p?.name||'')}"></label><label>دسته<select name="category_id" required>${state.categories.map(c=>`<option value="${c.id}"${selected(p?.category_id===c.id)}>${esc(c.name)}${c.active?'':' (غیرفعال)'}</option>`).join('')}</select></label><label class="span-2">توضیح محصول<textarea name="description" maxlength="1000">${esc(p?.description||'')}</textarea></label><label>نوع قیمت<select id="price-mode" name="mode"><option value="fixed"${selected(mode==='fixed')}>تک‌قیمتی</option><option value="multi"${selected(mode==='multi')}>چندقیمتی</option><option value="daily"${selected(mode==='daily')}>قیمت روز</option><option value="unpriced"${selected(mode==='unpriced')}>بدون قیمت</option></select></label><label>ترتیب نمایش<input name="sort_order" type="number" min="0" max="10000" required value="${p?.sort_order??state.products.length}"></label><div id="single-prices" class="span-2 form-grid"><label>قیمت عادی (تومان)<input name="price" inputmode="numeric" value="${esc(p?.price??'')}"></label><label>قیمت ویژه (تومان)<input name="special_price" inputmode="numeric" value="${esc(p?.special_price??'')}" placeholder="اختیاری"></label></div><div id="multiple-prices" class="span-2 variant-editor"><div id="variant-rows">${(p?.variants?.length?p.variants:[{label:'',price:'',special_price:null}]).map(variantRow).join('')}</div><button type="button" id="add-variant" class="text-button">＋ یک قیمت دیگر</button><p class="help">قیمت ویژه اختیاری است و باید از قیمت عادی کمتر باشد.</p></div><div class="span-2 upload-box"><label>تصویر محصول<input id="product-image" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="help">JPG، PNG یا WebP · حداکثر ۲ مگابایت</p><div id="product-image-preview" class="image-preview"></div><p id="upload-status" class="help" role="status"></p></div><div class="span-2 checkboxes"><label class="check-label"><input name="status" type="checkbox"${checked(p?.status??true)}>فعال</label><label class="check-label"><input name="featured" type="checkbox"${checked(p?.featured)}>پیشنهاد صفا</label><label class="check-label"><input name="is_new" type="checkbox"${checked(p?.is_new)}>جدید</label></div></div><p class="form-error" id="editor-error" role="alert"></p><div class="form-actions"><button type="button" id="cancel-editor" class="button secondary">انصراف</button><button id="save-product" class="button primary" type="submit">ذخیره محصول</button></div></form>`);
  const f=$('#product-form'),generation=editorGeneration;
  function modeChanged(){const mode=f.elements.mode.value;$('#single-prices').hidden=mode!=='fixed';$('#multiple-prices').hidden=mode!=='multi';f.elements.price.required=mode==='fixed';$$('#single-prices input').forEach(i=>i.disabled=mode!=='fixed');$$('#multiple-prices input').forEach(i=>i.disabled=mode!=='multi');}
  function preview(){const box=$('#product-image-preview');box.innerHTML=imagePath?`<img src="${esc(imageUrl)}" alt="تصویر محصول"><button type="button" class="text-button destructive" id="remove-product-image">حذف تصویر از محصول</button>`:'<p class="help">تصویری انتخاب نشده است.</p>';if(imagePath)$('#remove-product-image').onclick=()=>{imagePath=null;imageUrl=null;preview();};bindImageFallback(box);}
  $('#price-mode').onchange=modeChanged;modeChanged();preview();bindVariantRemoval();
  $('#add-variant').onclick=()=>{if($$('.variant-row').length>=10){toast('حداکثر ۱۰ گزینه قیمت قابل ثبت است.',true);return;}$('#variant-rows').insertAdjacentHTML('beforeend',variantRow());bindVariantRemoval();modeChanged();};
  $('#cancel-editor').onclick=closeEditor;
  $('#product-image').onchange=async e=>{const file=e.target.files[0];if(!file)return;uploading=true;e.target.disabled=true;$('#save-product').disabled=true;$('#upload-status').textContent='در حال آپلود تصویر…';const currentEpoch=epoch;try{const result=await uploadFile(file);if(!editor.open||currentEpoch!==epoch||generation!==editorGeneration){deleteUnused([result.path]);return;}temporaryImages.push(result.path);imagePath=result.path;imageUrl=result.url;preview();$('#upload-status').textContent='تصویر آپلود شد. برای ثبت روی ذخیره بزنید.';}catch(e){if(editor.open&&generation===editorGeneration)$('#upload-status').textContent=e.message;}finally{uploading=false;e.target.disabled=false;if(editor.open&&generation===editorGeneration)$('#save-product').disabled=false;}};
  f.onsubmit=async e=>{e.preventDefault();if(uploading||savingEditor)return;savingEditor=true;$('#save-product').disabled=true;$('#editor-error').textContent='';try{
    const mode=f.elements.mode.value;
    const input={name:f.elements.name.value,category_id:f.elements.category_id.value,description:f.elements.description.value,price_type:mode==='multi'?'fixed':mode,
      price:mode==='fixed'?n(f.elements.price.value):null,special_price:mode==='fixed'?n(f.elements.special_price.value):null,
      variants:mode==='multi'?$$('.variant-row').map(row=>({label:row.querySelector('[data-variant-label]').value,price:n(row.querySelector('[data-variant-price]').value),special_price:n(row.querySelector('[data-variant-special]').value)})):[],
      sort_order:Number(f.elements.sort_order.value),image_path:imagePath,status:f.elements.status.checked,featured:f.elements.featured.checked,is_new:f.elements.is_new.checked,...(p?{id:p.id,if_match:p.updated_at}:{})};
    await api('/api/product',p?'PUT':'POST',input);
    const unused=temporaryImages.filter(path=>path!==imagePath);if(p?.image_path&&p.image_path!==imagePath)unused.push(p.image_path);temporaryImages=[];editor.close();editorGeneration++;await refresh();toast('محصول ذخیره شد');deleteUnused(unused);
  }catch(e){if(editor.open&&generation===editorGeneration)$('#editor-error').textContent=e.message;}finally{savingEditor=false;if(editor.open&&generation===editorGeneration)$('#save-product').disabled=false;}};
}
function renderSettings(root){
  const s=state.settings;pendingLogo=null;let image=s.logo,imageUrl=s.logo_url,uploading=false;
  root.innerHTML=`<div class="panel"><div class="panel-heading"><h2>اطلاعات کافه</h2></div><form id="settings-form"><div class="form-grid"><label>نام کافه<input name="cafe_name" maxlength="100" required value="${esc(s.cafe_name)}"></label><label>جمله خوش‌آمدگویی<input name="tagline" maxlength="200" value="${esc(s.tagline)}"></label><label>شماره تماس<input name="phone" type="tel" dir="ltr" maxlength="30" value="${esc(s.phone)}"></label><label>نام کاربری اینستاگرام<input name="instagram" dir="ltr" maxlength="30" value="${esc(s.instagram)}" placeholder="بدون @ یا لینک"></label><label class="span-2">نشانی<textarea name="address" maxlength="500">${esc(s.address)}</textarea></label><label class="span-2">ساعت کاری<textarea name="working_hours" maxlength="500" placeholder="روزها و ساعت فعالیت کافه">${esc(s.working_hours)}</textarea></label><div class="span-2 upload-box"><label>لوگوی کافه<input id="logo-file" type="file" accept="image/jpeg,image/png,image/webp"></label><div id="logo-preview" class="image-preview"><img src="${esc(imageUrl)}" alt="لوگوی کافه"><button type="button" id="reset-logo" class="text-button">لوگوی اصلی صفا</button></div><p class="help" id="logo-status">حداکثر ۲ مگابایت</p></div><div class="span-2"><label class="check-label"><input name="menu_published" type="checkbox"${checked(s.menu_published)}>منو برای مشتریان منتشر شود</label><p class="help">پیش از انتشار، نام‌ها و قیمت‌های محصولات را بررسی کنید. با برداشتن این گزینه، محصولات موقتاً از صفحه مشتری پنهان می‌شوند.</p></div></div><p class="form-error" id="settings-error" role="alert"></p><div class="form-actions"><button id="save-settings" class="button primary" type="submit">ذخیره اطلاعات</button></div></form></div>`;
  $('#reset-logo').onclick=()=>{image='/assets/logo.jpg';imageUrl='/assets/logo.jpg';$('#logo-preview img').src=imageUrl;};
  $('#logo-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;uploading=true;$('#save-settings').disabled=true;$('#logo-status').textContent='در حال آپلود…';const current=epoch;try{const result=await uploadFile(file);if(current!==epoch||tab!=='settings'){deleteUnused([result.path]);return;}if(pendingLogo)deleteUnused([pendingLogo]);pendingLogo=result.path;image=result.path;imageUrl=result.url;$('#logo-preview img').src=imageUrl;$('#logo-status').textContent='برای ثبت لوگو، اطلاعات را ذخیره کنید.';}catch(e){if(tab==='settings')$('#logo-status').textContent=e.message;}finally{uploading=false;if(tab==='settings'&&$('#save-settings'))$('#save-settings').disabled=false;}};
  $('#settings-form').onsubmit=async e=>{e.preventDefault();if(uploading)return;const f=e.target;$('#save-settings').disabled=true;$('#settings-error').textContent='';try{const input=Object.fromEntries(new FormData(f));input.menu_published=f.elements.menu_published.checked;input.logo=image;input.if_match=s.updated_at;await api('/api/settings','PUT',input);const unused=[];if(s.logo.startsWith('uploads/')&&s.logo!==image)unused.push(s.logo);if(pendingLogo&&pendingLogo!==image)unused.push(pendingLogo);pendingLogo=null;await refresh();toast('اطلاعات کافه ذخیره شد');deleteUnused(unused);}catch(e){if($('#settings-error'))$('#settings-error').textContent=e.message;}finally{if($('#save-settings'))$('#save-settings').disabled=false;}};
}
function renderMedia(root){
  root.innerHTML=`<div class="panel"><div class="panel-heading"><h2>تصاویر آپلودشده</h2></div><p class="help">تصویرهای استفاده‌شده پس از تغییر عکس محصول یا لوگو قابل حذف‌اند.</p><div class="media-grid">${state.media.length?state.media.map(m=>{const used=state.products.some(p=>p.image_path===m.path)||state.settings.logo===m.path;return `<div class="media-card"><img src="${esc(m.url)}" alt="تصویر آپلودشده" loading="lazy"><p>${used?'در حال استفاده':'بدون استفاده'} · ${fa(Math.round(m.size/1024))} کیلوبایت</p><button class="text-button destructive wide" data-image-delete="${esc(m.path)}"${used?' disabled data-disabled="true"':''}>حذف تصویر</button></div>`;}).join(''):'<div class="empty-state"><p>هنوز تصویری آپلود نشده است.</p></div>'}</div></div>`;
  $$('[data-image-delete]').forEach(b=>b.onclick=async()=>{if(await confirm('این تصویر بدون استفاده حذف شود؟'))perform(()=>api('/api/image','DELETE',{path:b.dataset.imageDelete}),'تصویر حذف شد');});
}
async function renderQR(root){
  const url=`${location.origin}/qr`;const current=epoch;
  root.innerHTML=`<div class="panel"><div class="panel-heading"><h2>کد QR منوی صفا</h2></div><div class="qr-layout"><div><p>این کد، مشتری را به صفحه خوش‌آمدگویی و منوی کافه می‌رساند.</p><p class="qr-link">${esc(url)}</p><p class="help">پس از انتشار سایت، QR را از روی دامنه نهایی بسازید و با دوربین گوشی اسکن کنید. اگر نشانی سایت تغییر کند، QR نیز باید دوباره چاپ شود.</p><div class="qr-options"><button id="download-qr" class="button primary" disabled>دریافت PNG</button><button id="print-qr" class="button secondary" disabled>چاپ QR</button><button id="copy-link" class="button secondary">کپی لینک</button></div></div><div class="qr-preview"><img class="qr-logo" src="${esc(state.settings.logo_url)}" alt="لوگوی کافه"><h3>${esc(state.settings.cafe_name)}</h3><img id="qr-image" alt="کد QR منوی کافه" hidden><p id="qr-message" class="small muted">در حال ساخت کد QR…</p><p class="small muted">برای دیدن منو اسکن کنید</p></div></div></div>`;
  $('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('لینک کپی شد');}catch{toast('کپی لینک ممکن نشد. نشانی نمایش‌داده‌شده را انتخاب کنید.',true);}};
  try{const {createQR}=await import('/assets/qr.js');const image=await createQR(url);if(tab!=='qr'||current!==epoch)return;$('#qr-image').src=image;$('#qr-image').hidden=false;$('#qr-message').hidden=true;$('#download-qr').disabled=false;$('#print-qr').disabled=false;$('#download-qr').onclick=()=>download(image,'safa-menu-qr.png');$('#print-qr').onclick=()=>window.print();}
  catch{if(tab==='qr'&&$('#qr-message'))$('#qr-message').textContent='ساخت QR ناموفق بود. صفحه را تازه کنید.';}
}
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();}
function exportMenu(){const data={settings:state.settings,categories:state.categories,products:state.products};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));download(url,'safa-menu-backup.json');setTimeout(()=>URL.revokeObjectURL(url),1000);}
function confirm(message){return new Promise(resolve=>{const dialog=$('#confirmation');$('#confirm-message').textContent=message;let done=false;const finish=value=>{if(done)return;done=true;dialog.close();resolve(value);};$('#confirm-ok').onclick=()=>finish(true);$('#confirm-cancel').onclick=()=>finish(false);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.showModal();});}
$$('.admin-tabs button').forEach(b=>b.onclick=()=>{if(busy)return;if(pendingLogo){deleteUnused([pendingLogo]);pendingLogo=null;}tab=b.dataset.tab;render();});
$('#login-form').onsubmit=async e=>{e.preventDefault();const f=e.target,button=f.querySelector('button[type=submit]');button.disabled=true;$('#login-error').textContent='';try{await api('/api/auth/login','POST',{username:f.elements.username.value,password:f.elements.password.value});f.elements.password.value='';lastActivity=Date.now();await refresh();}catch(e){$('#login-error').textContent=e.message;}finally{button.disabled=false;}};
$('#logout').onclick=async()=>{if(busy)return;try{await api('/api/auth/logout','POST',{});gate();}catch(e){error(e);}};
window.addEventListener('session-expired',()=>gate('نشست مدیریت پایان یافته است. دوباره وارد شوید.'));
['pointerdown','keydown'].forEach(event=>window.addEventListener(event,()=>{lastActivity=Date.now();}));
setInterval(async()=>{if(!state)return;if(Date.now()-lastActivity>1800000){try{await api('/api/auth/logout','POST',{});}catch{}gate('نشست به دلیل عدم فعالیت پایان یافت.');return;}if(Date.now()-lastSessionCheck>240000&&Date.now()-lastActivity<120000){lastSessionCheck=Date.now();try{await api('/api/auth/session');}catch(e){if(e.status===401)gate(e.message);}}},60000);
api('/api/auth/session').then(()=>refresh()).catch(e=>{if(e.status!==401)$('#login-error').textContent=e.message;});
