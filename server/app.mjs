import { randomUUID } from 'node:crypto';
import { configuration, gateway, HttpError, rest, representation } from './supabase.mjs';
import * as v from './validation.mjs';
import { signIn, requireSession, readCookie, sessionCookie, sameOrigin, hash } from './auth.mjs';

const MAX_BODY=3000000;
export const imageURL=(path,config)=> !path ? null : path.startsWith('/assets/') ? path : `${config.url}/storage/v1/object/public/safa-images/${path}`;
function decorate(snapshot,config) {
  if (!snapshot?.settings) throw new HttpError(503,'ساختار دیتابیس منو هنوز آماده نیست.','schema_missing');
  return {...snapshot,settings:{...snapshot.settings,logo_url:imageURL(snapshot.settings.logo,config)},
    products:(snapshot.products||[]).map(p=>({...p,image_url:imageURL(p.image_path,config)})),
    ...(snapshot.media?{media:snapshot.media.map(m=>({...m,url:imageURL(m.path,config)}))}:{})};
}
async function body(req) {
  if (!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json')) throw new HttpError(415,'درخواست باید JSON باشد.','unsupported_content_type');
  if (Number(req.headers.get('content-length')||0)>MAX_BODY) throw new HttpError(413,'حجم درخواست بیش از حد مجاز است.','body_too_large');
  const reader=req.body?.getReader(); let size=0;const chunks=[];
  if (reader) while(true) {
    const {done,value}=await reader.read(); if(done)break;
    size+=value.byteLength; if(size>MAX_BODY){await reader.cancel();throw new HttpError(413,'حجم درخواست بیش از حد مجاز است.','body_too_large');}
    chunks.push(Buffer.from(value));
  }
  let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'قالب JSON معتبر نیست.','invalid_json');}
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new HttpError(400,'اطلاعات درخواست معتبر نیست.','invalid_json');
  return parsed;
}
function method(req,allowed) { if(!allowed.includes(req.method))throw new HttpError(405,'این روش درخواست پشتیبانی نمی‌شود.','method_not_allowed',{allow:allowed.join(', ')}); }
async function existing(db,table,id) {
  const rows=await db(rest(table,{id:`eq.${id}`,select:'*',limit:'1'}));
  if(!rows?.[0])throw new HttpError(404,'مورد انتخاب‌شده پیدا نشد.','not_found');
  return rows[0];
}
async function imageExists(db,path) {
  if (!path || path==='/assets/logo.jpg') return;
  const rows=await db(rest('media',{path:`eq.${path}`,select:'id',limit:'1'}));
  if(!rows?.length)v.fail('تصویر انتخاب‌شده در فضای آپلود موجود نیست.');
}
function changed(rows) {
  if(!rows?.length)throw new HttpError(409,'این اطلاعات هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.','conflict');
  return rows[0];
}

export async function handle(req,{env=process.env,transport=fetch}={}) {
  let config;
  const headers={'Cache-Control':'no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
  const reply=(data,status=200)=>Response.json(data,{status,headers});
  try {
    const path=new URL(req.url).pathname.replace(/\/$/,'');
    const routes=['/api/menu','/api/admin','/api/auth/login','/api/auth/session','/api/auth/logout','/api/product','/api/category','/api/settings','/api/image'];
    if(!routes.includes(path))throw new HttpError(404,'این مسیر پیدا نشد.','not_found');
    config=configuration(env);const db=gateway(config,transport);
    if(path==='/api/menu') {
      method(req,['GET']);return reply(decorate(await db('/rest/v1/rpc/safa_public_menu',{method:'POST',body:{}}),config));
    }
    if(path==='/api/auth/login') {
      method(req,['POST']);const signed=await signIn(req,await body(req),config,db);
      headers['Set-Cookie']=signed.cookie;return reply(signed.data);
    }
    if(path==='/api/auth/logout') {
      method(req,['POST']);sameOrigin(req,config);
      const raw=readCookie(req,config);
      // Clearing an expired session remains possible; for a live session enforce CSRF.
      try { await requireSession(req,config,db,true); } catch(e) { if(e.status!==401)throw e; }
      if(raw)await db(rest('admin_sessions',{token_hash:`eq.${hash(raw)}`}),{method:'DELETE'});
      headers['Set-Cookie']=sessionCookie('',config,true);return reply({ok:true});
    }
    const admin=await requireSession(req,config,db,!['GET','HEAD'].includes(req.method));
    if(path==='/api/auth/session') {
      method(req,['GET']);return reply({username:admin.username,csrf_token:admin.csrf_token,expires_at:admin.session.expires_at});
    }
    if(path==='/api/admin') {
      method(req,['GET']);return reply({...decorate(await db('/rest/v1/rpc/safa_admin_menu',{method:'POST',body:{}}),config),username:admin.username,csrf_token:admin.csrf_token});
    }
    if(path==='/api/product') {
      method(req,['POST','PUT','DELETE']);const input=await body(req);
      if(req.method==='POST') {
        const data=v.product(input);await imageExists(db,data.image_path);
        const rows=await db('/rest/v1/products',{method:'POST',body:data,headers:representation});return reply(rows[0],201);
      }
      const id=v.uuid(input.id),revision=v.version(input.if_match);
      const filters={id:`eq.${id}`,updated_at:`eq.${revision}`};
      if(req.method==='DELETE') {
        changed(await db(rest('products',filters),{method:'DELETE',headers:representation}));return reply({ok:true});
      }
      const current=await existing(db,'products',id);const data=v.product({...current,...input});await imageExists(db,data.image_path);
      return reply(changed(await db(rest('products',filters),{method:'PATCH',body:data,headers:representation})));
    }
    if(path==='/api/category') {
      method(req,['POST','PUT','DELETE']);const input=await body(req);
      if(req.method==='PUT' && Array.isArray(input.order)) {
        if(input.order.length>1000 || new Set(input.order).size!==input.order.length)v.fail('ترتیب دسته‌ها معتبر نیست.');
        const ids=input.order.map(v.uuid);await db('/rest/v1/rpc/safa_reorder_categories',{method:'POST',body:{p_ids:ids}});return reply({ok:true});
      }
      if(req.method==='POST')return reply((await db('/rest/v1/categories',{method:'POST',body:v.category(input),headers:representation}))[0],201);
      const id=v.uuid(input.id),revision=v.version(input.if_match);const filters={id:`eq.${id}`,updated_at:`eq.${revision}`};
      if(req.method==='DELETE') {changed(await db(rest('categories',filters),{method:'DELETE',headers:representation}));return reply({ok:true});}
      const current=await existing(db,'categories',id);
      return reply(changed(await db(rest('categories',filters),{method:'PATCH',body:v.category({...current,...input}),headers:representation})));
    }
    if(path==='/api/settings') {
      method(req,['PUT']);const input=await body(req);const revision=v.version(input.if_match);
      const data=v.settings(input);await imageExists(db,data.logo);
      return reply(changed(await db(rest('settings',{id:'eq.true',updated_at:`eq.${revision}`}),{method:'PATCH',body:data,headers:representation})));
    }
    if(path==='/api/image') {
      method(req,['POST','DELETE']);const input=await body(req);
      if(req.method==='POST') {
        const file=v.upload(input);const path=`uploads/${randomUUID()}.${file.ext}`;
        await db(`/storage/v1/object/safa-images/${path}`,{method:'POST',body:file.bytes,raw:true,headers:{'Content-Type':file.mime,'x-upsert':'false'}});
        try {
          await db('/rest/v1/media',{method:'POST',body:{path,size:file.bytes.length,mime_type:file.mime,uploaded_by:admin.id}});
        } catch(e) {
          await db('/storage/v1/object/safa-images',{method:'DELETE',body:{prefixes:[path]},allowFailure:true});throw e;
        }
        return reply({path,url:imageURL(path,config)},201);
      }
      const path=v.imagePath(input.path);if(!path)v.fail('مسار تصویر الزامی است.');
      await imageExists(db,path);
      const refs=await db(rest('products',{image_path:`eq.${path}`,select:'id',limit:'1'}));
      const settings=await db(rest('settings',{logo:`eq.${path}`,select:'id',limit:'1'}));
      if(refs.length || settings.length)throw new HttpError(409,'این تصویر هنوز در منو استفاده می‌شود. ابتدا تصویر محصول یا لوگو را تغییر دهید.','image_in_use');
      // Delete the registry first: FK constraints block concurrent new references.
      const removed=changed(await db(rest('media',{path:`eq.${path}`}),{method:'DELETE',headers:representation}));
      try { await db('/storage/v1/object/safa-images',{method:'DELETE',body:{prefixes:[path]}}); }
      catch(e) { await db('/rest/v1/media',{method:'POST',body:removed});throw e; }
      return reply({ok:true});
    }
  } catch(error) {
    const expected=error instanceof HttpError;
    const status=expected?error.status:500;
    if(status===401 && config)headers['Set-Cookie']=sessionCookie('',config,true);
    if(error.extra?.retry_after)headers['Retry-After']=String(error.extra.retry_after);
    if(error.extra?.allow)headers.Allow=error.extra.allow;
    // Never serialize exception details, provider responses, keys or request bodies.
    if(!expected)console.error('Safa API unexpected failure');
    return reply({error:{code:expected?error.code:'internal_error',message:expected?error.message:'خطایی رخ داد. دوباره تلاش کنید.',...(error.extra?.retry_after?{retry_after:error.extra.retry_after}:{})}},status);
  }
}
