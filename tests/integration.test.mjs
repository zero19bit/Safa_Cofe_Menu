import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/app.mjs';
import { hash } from '../server/auth.mjs';
import { harness,env,adminID,password } from './harness.mjs';

test('Database and API behavior with PostgreSQL; Auth and Storage use controlled test doubles',async t=>{
  const h=await harness();t.after(()=>h.db.close());t.beforeEach(()=>h.reset());
  let cookie='',csrf='';
  const request=async(path,method='GET',body,extra={})=>{
    const response=await handle(new Request(`https://safa.example${path}`,{method,headers:{origin:'https://safa.example',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})}),{env,transport:h.transport});
    return {status:response.status,headers:response.headers,data:await response.json()};
  };
  const login=async()=>{cookie='';csrf='';const result=await request('/api/auth/login','POST',{username:'safa_admin',password});assert.equal(result.status,200);cookie=result.headers.get('set-cookie').split(';')[0];csrf=result.data.csrf_token;return result;};
  const category=async(name='نوشیدنی‌ها')=>{const r=await request('/api/category','POST',{name,icon:'☕'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const product=async(c,overrides={})=>{const r=await request('/api/product','POST',{name:'لاته',category_id:c.id,description:'شیر و اسپرسو',price_type:'fixed',price:130000,...overrides});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};

  await t.test('Schema reruns safely; public/authenticated roles cannot access data or management RPCs',async()=>{
    await h.db.exec(h.schema);
    for(const role of ['anon','authenticated']){
      await h.db.exec(`set role ${role}`);
      for(const table of ['products','categories','settings','admins','admin_sessions','media','login_rate_limits'])await assert.rejects(()=>h.db.query(`select * from public.${table}`),/permission denied/);
      await assert.rejects(()=>h.db.query('select public.safa_admin_menu()'),/permission denied/);
      await assert.rejects(()=>h.db.query('select public.safa_public_menu()'),/permission denied/);
      await assert.rejects(()=>h.db.query("select public.safa_take_login_attempt('x',5,600)"),/permission denied/);
      await h.db.exec('reset role');
    }
  });
  await t.test('Missing configuration fails closed without publishing sample data or credentials',async()=>{
    const response=await handle(new Request('https://safa.example/api/menu'),{env:{}});assert.equal(response.status,503);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).error.code,'not_configured');
  });
  await t.test('Every management API denies anonymous access',async()=>{
    cookie='';csrf='';for(const [path,method] of [['/api/admin','GET'],['/api/product','POST'],['/api/product','PUT'],['/api/product','DELETE'],['/api/category','POST'],['/api/settings','PUT'],['/api/image','POST'],['/api/auth/session','GET']])assert.equal((await request(path,method,method==='GET'?undefined:{})).status,401,path);
  });
  await t.test('Login uses managed Auth, only returns an opaque HttpOnly cookie, and never exposes provider tokens',async()=>{
    const result=await login();const c=result.headers.get('set-cookie');for(const part of ['__Host-safa_session','Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(c.includes(part));
    assert.ok(!JSON.stringify(result.data).includes('provider-'));assert.equal(result.data.username,'safa_admin');
    const stored=await h.db.query('select token_hash from public.admin_sessions');assert.equal(stored.rows[0].token_hash,hash(cookie.split('=')[1]));assert.ok(!JSON.stringify(stored.rows).includes(cookie.split('=')[1]));
  });
  await t.test('Cross-origin and forged-CSRF edits are rejected before data changes',async()=>{
    await login();assert.equal((await request('/api/category','POST',{name:'Bad'},{origin:'https://attacker.example'})).status,403);
    assert.equal((await request('/api/category','POST',{name:'Bad'},{'x-csrf-token':'forged'})).status,403);
    assert.equal((await h.db.query('select count(*)::int as n from public.categories')).rows[0].n,0);
  });
  await t.test('Invalid credentials and unregistered usernames share the same response',async()=>{
    cookie='';csrf='';const wrong=await request('/api/auth/login','POST',{username:'safa_admin',password:'wrong'});const missing=await request('/api/auth/login','POST',{username:'unknown',password:'wrong'});assert.equal(wrong.status,401);assert.deepEqual(wrong.data,missing.data);
  });
  await t.test('Category/product CRUD persists globally; unpublished, inactive and disabled-category products stay hidden',async()=>{
    await login();const c=await category();let p=await product(c);assert.equal((await request('/api/menu')).data.products.length,0);
    let snapshot=(await request('/api/admin')).data;const settings=snapshot.settings;
    assert.equal((await request('/api/settings','PUT',{...settings,menu_published:true,if_match:settings.updated_at})).status,200);
    assert.equal((await request('/api/menu')).data.products[0].price,130000);
    const edit=await request('/api/product','PUT',{id:p.id,if_match:p.updated_at,price:145000,special_price:125000});assert.equal(edit.status,200,JSON.stringify(edit.data));p=edit.data;
    assert.equal((await request('/api/menu')).data.products[0].special_price,125000);
    const publicRequest=await handle(new Request('https://safa.example/api/menu'),{env,transport:h.transport});assert.equal((await publicRequest.json()).products[0].price,145000);
    let change=await request('/api/product','PUT',{id:p.id,if_match:p.updated_at,status:false});assert.equal(change.status,200);p=change.data;assert.equal((await request('/api/menu')).data.products.length,0);
    change=await request('/api/product','PUT',{id:p.id,if_match:p.updated_at,status:true});assert.equal(change.status,200);p=change.data;
    const disabled=await request('/api/category','PUT',{id:c.id,if_match:c.updated_at,active:false});assert.equal(disabled.status,200);assert.equal((await request('/api/menu')).data.products.length,0);
    assert.equal((await request('/api/product','DELETE',{id:p.id,if_match:p.updated_at})).status,200);
    assert.equal((await request('/api/category','DELETE',{id:c.id,if_match:disabled.data.updated_at})).status,200);
  });
  await t.test('Stale edits cannot overwrite newer prices; categories in use cannot be deleted',async()=>{
    await login();const c=await category();const p=await product(c);
    assert.equal((await request('/api/product','PUT',{id:p.id,if_match:p.updated_at,price:150000})).status,200);
    assert.equal((await request('/api/product','PUT',{id:p.id,if_match:p.updated_at,price:1000})).status,409);
    assert.equal((await request('/api/category','DELETE',{id:c.id,if_match:c.updated_at})).status,409);
    assert.equal((await request('/api/product','PUT',{id:p.id,price:1})).status,428);
  });
  await t.test('Single, zero, special, daily, unpriced and multi-variant prices are supported and validated',async()=>{
    await login();const c=await category();
    await product(c,{price:0});await product(c,{price:100,special_price:90});await product(c,{price_type:'daily',price:null});await product(c,{price_type:'unpriced',price:null});
    await product(c,{price:null,variants:[{label:'سینگل',price:100,special_price:90},{label:'دبل',price:200}]});
    for(const extra of [{price:-1},{price:1.5},{price:100,special_price:110},{price_type:'daily',price:100},{price:null,variants:[{label:'دبل',price:100},{label:'دبل',price:200}]}])assert.equal((await request('/api/product','POST',{name:'invalid',category_id:c.id,...extra})).status,400);
  });
  await t.test('Category reordering is atomic and rejects stale/incomplete/duplicate lists',async()=>{
    await login();const a=await category('الف'),b=await category('ب');
    assert.equal((await request('/api/category','PUT',{order:[b.id,a.id]})).status,200);
    assert.equal((await request('/api/admin')).data.categories[0].id,b.id);
    assert.equal((await request('/api/category','PUT',{order:[a.id]})).status,409);
    assert.equal((await request('/api/category','PUT',{order:[a.id,a.id]})).status,400);
    assert.equal((await request('/api/admin')).data.categories[0].id,b.id);
  });
  await t.test('Opaque sessions are revoked on logout; expired/idle sessions and disabled admins fail',async()=>{
    await login();const old=cookie;
    assert.equal((await request('/api/auth/logout','POST',{})).status,200);cookie=old;assert.equal((await request('/api/admin')).status,401);
    await login();await h.db.exec("update public.admin_sessions set expires_at=now()-interval '1 second'");assert.equal((await request('/api/admin')).status,401);
    await login();await h.db.exec("update public.admin_sessions set last_seen_at=now()-interval '31 minutes'");assert.equal((await request('/api/admin')).status,401);
    await login();await h.db.exec('update public.admins set active=false');assert.equal((await request('/api/admin')).status,403);
  });
  await t.test('Parallel failed logins share a persisted limiter and cannot exceed five account attempts',async()=>{
    cookie='';csrf='';const results=await Promise.all(Array.from({length:12},(_,i)=>request('/api/auth/login','POST',{username:'safa_admin',password:'wrong'},{'x-vercel-forwarded-for':`192.0.2.${i}`})));
    assert.equal(results.filter(r=>r.status===401).length,5);assert.equal(results.filter(r=>r.status===429).length,7);assert.ok(results.filter(r=>r.status===429).every(r=>r.headers.get('retry-after')));
  });
  await t.test('Image upload validates signatures/size; linked files cannot be deleted; removal clears Storage and database',async()=>{
    await login();const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5mUAAAAASUVORK5CYII=';
    const image=await request('/api/image','POST',{base64:png,mime_type:'image/png'});assert.equal(image.status,201);assert.ok(h.objects.has(image.data.path));const c=await category();let p=await product(c,{image_path:image.data.path});
    assert.equal((await request('/api/image','DELETE',{path:image.data.path})).status,409);
    const change=await request('/api/product','PUT',{id:p.id,if_match:p.updated_at,image_path:null});assert.equal(change.status,200);
    assert.equal((await request('/api/image','DELETE',{path:image.data.path})).status,200);assert.equal(h.objects.size,0);
    assert.equal((await h.db.query('select count(*)::int as n from public.media')).rows[0].n,0);
    assert.equal((await request('/api/image','POST',{base64:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),mime_type:'image/png'})).status,400);
    assert.equal((await request('/api/image','POST',{base64:png,mime_type:'image/jpeg'})).status,400);
    assert.equal((await request('/api/image','DELETE',{path:'../other-bucket/file.jpg'})).status,400);
    assert.equal((await request('/api/image','POST',{base64:png,mime_type:'image/png'},{'content-length':'3000001'})).status,413);
  });
  await t.test('Settings update and original logo reset persist without invented contact information',async()=>{
    await login();const s=(await request('/api/admin')).data.settings;
    const r=await request('/api/settings','PUT',{...s,cafe_name:'کافه صفا',phone:'09123456789',instagram:'safa.cafe',working_hours:'۹ تا ۲۳',address:'نشانی تأییدشده',if_match:s.updated_at});assert.equal(r.status,200);
    const publicData=(await request('/api/menu')).data;assert.equal(publicData.settings.phone,'09123456789');assert.equal(publicData.settings.logo_url,'/assets/logo.jpg');
    assert.ok(!JSON.stringify(publicData).includes('admin@example.test'));assert.ok(!JSON.stringify(publicData).includes(env.SUPABASE_SECRET_KEY));
  });
  await t.test('Concurrent new image references block deletion at the database boundary',async()=>{
    await login();const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5mUAAAAASUVORK5CYII=';
    const image=(await request('/api/image','POST',{base64:png,mime_type:'image/png'})).data;const c=await category();const p=await product(c);
    const transport=async(url,options)=>{if(new URL(url).pathname==='/rest/v1/media'&&options.method==='DELETE')await h.db.query('update public.products set image_path=$1 where id=$2',[image.path,p.id]);return h.transport(url,options);};
    const response=await handle(new Request('https://safa.example/api/image',{method:'DELETE',headers:{origin:'https://safa.example',cookie,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify({path:image.path})}),{env,transport});
    assert.equal(response.status,409);assert.ok(h.objects.has(image.path));
    assert.equal((await h.db.query('select count(*)::int as n from public.media')).rows[0].n,1);
  });
  await t.test('Storage outages preserve a retryable media registry instead of losing image metadata',async()=>{
    await login();const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5mUAAAAASUVORK5CYII=';
    const image=(await request('/api/image','POST',{base64:png,mime_type:'image/png'})).data;
    const transport=async(url,options)=>new URL(url).pathname==='/storage/v1/object/safa-images'&&options.method==='DELETE'?Response.json({error:'unavailable'},{status:503}):h.transport(url,options);
    const response=await handle(new Request('https://safa.example/api/image',{method:'DELETE',headers:{origin:'https://safa.example',cookie,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify({path:image.path})}),{env,transport});
    assert.equal(response.status,503);assert.ok(h.objects.has(image.path));assert.equal((await h.db.query('select count(*)::int as n from public.media')).rows[0].n,1);
  });
  await t.test('Bulk import rolls back categories and products together after an invalid product',async()=>{
    const id='20000000-0000-4000-8000-000000000001';
    await assert.rejects(()=>h.db.query('select public.safa_import_menu($1::jsonb,$2::jsonb)',[JSON.stringify([{id,name:'imported',icon:'☕',sort_order:0,active:true}]),JSON.stringify([{id:adminID,category_id:'30000000-0000-4000-8000-000000000001',name:'Invalid FK',description:'',price_type:'fixed',price:1,special_price:null,variants:[],image_path:null,status:false,featured:false,is_new:false,sort_order:0}])]),/foreign key/);
    assert.equal((await h.db.query('select count(*)::int as n from public.categories')).rows[0].n,0);
  });
});
