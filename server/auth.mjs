import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, rest, representation } from './supabase.mjs';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
const hmac = (value,secret) => createHmac('sha256',secret).update(value).digest('base64url');
export const csrf = (sessionToken,config) => hmac(`csrf:${sessionToken}`,config.secret);
export const cookieName = config => config.production ? '__Host-safa_session' : 'safa_session';
export function sessionCookie(value,config,clear=false) {
  return `${cookieName(config)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:28800}${config.production?'; Secure':''}`;
}
export function readCookie(req,config) {
  const part=(req.headers.get('cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName(config)}=`));
  const value=part?.slice(cookieName(config).length+1);
  return value && /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : null;
}
export function sameOrigin(req,config) {
  const origin=req.headers.get('origin');
  // APP_ORIGIN is mandatory in production: never trust a caller-provided Host as an authorization boundary.
  const expected=config.origin || (!config.production ? new URL(req.url).origin : null);
  if (!origin || !expected || origin!==expected || req.headers.get('sec-fetch-site')==='cross-site') {
    throw new HttpError(403,'درخواست از مبدأ مجاز ارسال نشده است.','origin_rejected');
  }
}
export async function requireSession(req,config,db,mutating=false) {
  const raw=readCookie(req,config);
  if (!raw) throw new HttpError(401,'برای ادامه وارد پنل مدیریت شوید.','unauthorized');
  const now=new Date();
  const rows=await db(rest('admin_sessions',{token_hash:`eq.${hash(raw)}`,expires_at:`gt.${now.toISOString()}`,last_seen_at:`gt.${new Date(now-1800000).toISOString()}`,select:'*',limit:'1'}));
  const session=rows?.[0];
  if (!session) throw new HttpError(401,'نشست مدیریت پایان یافته است. دوباره وارد شوید.','session_expired');
  const admins=await db(rest('admins',{id:`eq.${session.admin_id}`,active:'eq.true',select:'id,username,email',limit:'1'}));
  if (!admins?.[0]) throw new HttpError(403,'دسترسی مدیریت فعال نیست.','forbidden');
  if (mutating) {
    sameOrigin(req,config);
    const a=Buffer.from(req.headers.get('x-csrf-token')||'');const b=Buffer.from(csrf(raw,config));
    if (a.length!==b.length || !timingSafeEqual(a,b)) throw new HttpError(403,'درخواست تأیید نشد. صفحه را تازه کنید.','csrf_rejected');
  }
  await db(rest('admin_sessions',{token_hash:`eq.${hash(raw)}`}),{method:'PATCH',body:{last_seen_at:now.toISOString()}});
  return { ...admins[0], raw, session, csrf_token:csrf(raw,config) };
}
export async function consumeLoginAttempts(req,username,config,db) {
  const ip = config.production
    ? (req.headers.get('x-vercel-forwarded-for')||'unknown').split(',')[0].trim()
    : (req.headers.get('x-local-client-ip')||'local');
  for (const [kind,value,limit] of [['ip',ip,30],['user',username,5]]) {
    const result=await db('/rest/v1/rpc/safa_take_login_attempt',{method:'POST',body:{p_bucket:hash(hmac(`${kind}:${value}`,config.secret)),p_limit:limit,p_seconds:600}});
    if (!result?.allowed) throw new HttpError(429,'تعداد تلاش‌های ورود زیاد است. چند دقیقه بعد دوباره تلاش کنید.','rate_limited',{retry_after:result?.retry_after??600});
  }
}
export async function signIn(req,input,config,db) {
  sameOrigin(req,config);
  const username=typeof input.username==='string'?input.username.trim().toLowerCase():'';
  const password=input.password;
  if (!/^[a-z0-9_.-]{3,64}$/.test(username) || typeof password!=='string' || !password.length || Buffer.byteLength(password)>256) {
    throw new HttpError(400,'نام کاربری یا رمز عبور معتبر نیست.','validation');
  }
  await consumeLoginAttempts(req,username,config,db);
  const rows=await db(rest('admins',{username:`eq.${username}`,active:'eq.true',select:'id,username,email',limit:'1'}));
  const admin=rows?.[0];
  // The same provider call and error response are used for unknown usernames.
  const auth=await db('/auth/v1/token?grant_type=password',{method:'POST',body:{email:admin?.email??`unknown-${hash(username).slice(0,16)}@example.invalid`,password},allowFailure:true});
  if (!auth.ok || !admin || auth.data?.user?.id!==admin.id) {
    if (auth.status===429) throw new HttpError(429,'سرویس ورود موقتاً محدود شده است. دوباره تلاش کنید.','rate_limited',{retry_after:60});
    if (auth.status>=500) throw new HttpError(503,'سرویس ورود در دسترس نیست.','auth_unavailable');
    throw new HttpError(401,'نام کاربری یا رمز عبور اشتباه است.','invalid_credentials');
  }
  const raw=token();const expires=new Date(Date.now()+28800000).toISOString();
  await db('/rest/v1/admin_sessions',{method:'POST',body:{token_hash:hash(raw),admin_id:admin.id,expires_at:expires},headers:representation});
  return { cookie:sessionCookie(raw,config), data:{username:admin.username,csrf_token:csrf(raw,config),expires_at:expires} };
}
