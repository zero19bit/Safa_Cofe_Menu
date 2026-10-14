import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const adminID='10000000-0000-4000-8000-000000000001';
export const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_key_server_only',SESSION_SECRET:'test-secret-that-is-longer-than-thirty-two-characters',APP_ORIGIN:'https://safa.example',NODE_ENV:'production'};
export const password='Provider-mock-password-123';
export async function harness(){
  const db=new PGlite();await db.waitReady;
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  const schema=await readFile('supabase/schema.sql','utf8');await db.exec(schema);
  await db.query('insert into auth.users(id) values($1)',[adminID]);
  await db.query('insert into public.admins(id,username,email) values($1,$2,$3)',[adminID,'safa_admin','admin@example.test']);
  const objects=new Map();const calls=[];
  const transport=async(url,options={})=>{
    const u=new URL(url);calls.push({path:u.pathname,method:options.method||'GET',headers:options.headers});
    if(options.headers?.apikey!==env.SUPABASE_SECRET_KEY)throw new Error('Missing API key');
    if(options.headers?.Authorization)throw new Error('New secret keys must not be used as bearer JWTs');
    const method=options.method||'GET';
    const b=options.body===undefined?{}:Buffer.isBuffer(options.body)?options.body:JSON.parse(options.body);
    const reply=(data,status=200)=>Response.json(data,{status});
    try{
      if(u.pathname==='/auth/v1/token')return b.email==='admin@example.test'&&b.password===password?reply({user:{id:adminID},access_token:'provider-access-token-not-to-be-exposed',refresh_token:'provider-refresh-token-not-to-be-exposed'}):reply({error_code:'invalid_credentials'},400);
      if(u.pathname.startsWith('/storage/v1/object/safa-images/')){const path=u.pathname.split('/safa-images/')[1];if(method==='POST'){objects.set(path,b);return reply({Key:path});}}
      if(u.pathname==='/storage/v1/object/safa-images'&&method==='DELETE'){for(const path of b.prefixes)objects.delete(path);return reply([]);}
      if(u.pathname.startsWith('/rest/v1/rpc/')){
        const name=u.pathname.split('/').pop();let result;
        if(name==='safa_public_menu'||name==='safa_admin_menu')result=await db.query(`select public.${name}() as data`);
        else if(name==='safa_take_login_attempt')result=await db.query('select public.safa_take_login_attempt($1,$2,$3) as data',[b.p_bucket,b.p_limit,b.p_seconds]);
        else if(name==='safa_reorder_categories')result=await db.query('select public.safa_reorder_categories($1::uuid[]) as data',[b.p_ids]);
        else if(name==='safa_import_menu')result=await db.query('select public.safa_import_menu($1::jsonb,$2::jsonb) as data',[JSON.stringify(b.p_categories),JSON.stringify(b.p_products)]);
        else throw new Error('Unknown RPC');
        return reply(result.rows[0]?.data??null);
      }
      const table=u.pathname.split('/').pop();
      if(!['categories','products','settings','admins','admin_sessions','media','login_rate_limits'].includes(table))throw new Error('Unknown table');
      const params=[];const where=[];
      const ident=s=>{if(!/^[a-z_]+$/.test(s))throw new Error('Unsafe identifier');return `"${s}"`;};
      const value=(key,val)=>key==='variants'?JSON.stringify(val):val;
      let sql;
      if(method==='POST'){
        const entries=Object.entries(b);const names=entries.map(([k])=>ident(k));const placeholders=entries.map(([k,x])=>{params.push(value(k,x));return `$${params.length}`;});
        sql=`insert into public.${table} as t(${names.join(',')}) values(${placeholders.join(',')}) returning to_jsonb(t) as record`;
      }else{
        let sets=[];
        if(method==='PATCH')sets=Object.entries(b).map(([k,x])=>{params.push(value(k,x));return `${ident(k)}=$${params.length}`;});
        for(const [key,x] of u.searchParams){if(['select','limit','offset','order'].includes(key))continue;const split=x.indexOf('.');const op=x.slice(0,split),val=x.slice(split+1);const operations={eq:'=',gt:'>',gte:'>=',lt:'<',lte:'<=',neq:'<>'};if(!operations[op])throw new Error('Unsupported filter');params.push(val);where.push(`t.${ident(key)}${operations[op]}$${params.length}`);}
        const predicate=where.length?` where ${where.join(' and ')}`:'';
        if(method==='GET')sql=`select to_jsonb(t) as record from public.${table} t${predicate}${u.searchParams.has('limit')?` limit ${Number(u.searchParams.get('limit'))}`:''}`;
        else if(method==='PATCH')sql=`update public.${table} as t set ${sets.join(',')}${predicate} returning to_jsonb(t) as record`;
        else if(method==='DELETE')sql=`delete from public.${table} as t${predicate} returning to_jsonb(t) as record`;
        else throw new Error('Unknown method');
      }
      const result=await db.query(sql,params);return reply(result.rows.map(r=>r.record),method==='POST'?201:200);
    }catch(e){return reply({code:e.code||'mock_error',message:e.message},400);}
  };
  async function reset(){
    await db.exec("delete from public.products; update public.settings set menu_published=false,cafe_name='کافه صفا',logo='/assets/logo.jpg',phone='',address='',instagram='',working_hours=''; delete from public.media; delete from public.categories; delete from public.admin_sessions; delete from public.login_rate_limits; update public.admins set active=true;");
    objects.clear();calls.length=0;
  }
  return {db,schema,transport,objects,calls,reset};
}
