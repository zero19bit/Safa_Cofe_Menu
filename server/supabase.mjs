export class HttpError extends Error {
  constructor(status, message, code = 'request_failed', extra = {}) {
    super(message); Object.assign(this, { status, code, extra });
  }
}

export function configuration(env = process.env) {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  if (!url || !key || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || /REPLACE|YOUR-PROJECT/.test(`${url}${key}${env.SESSION_SECRET}`)) {
    throw new HttpError(503, 'اتصال منو هنوز راه‌اندازی نشده است.', 'not_configured');
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
    throw new HttpError(503, 'نشانی Supabase در تنظیمات سرور صحیح نیست.', 'invalid_configuration');
  }
  let origin;
  if (env.APP_ORIGIN) {
    try { origin = new URL(env.APP_ORIGIN).origin; } catch { throw new HttpError(503, 'نشانی سایت در تنظیمات سرور صحیح نیست.', 'invalid_configuration'); }
  }
  return { url, key, secret: env.SESSION_SECRET, origin, production: env.NODE_ENV === 'production' || Boolean(env.VERCEL) };
}

export function gateway(config, transport = fetch) {
  return async (path, { method = 'GET', body, headers = {}, raw = false, allowFailure = false } = {}) => {
    const h = { apikey: config.key, ...headers };
    // sb_secret_* is not a JWT. Never put it in an Authorization bearer header.
    if (!config.key.startsWith('sb_secret_')) h.Authorization = `Bearer ${config.key}`;
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    let response;
    try {
      response = await transport(`${config.url}${path}`, {
        method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(12000)
      });
    } catch {
      throw new HttpError(503, 'ارتباط با سرویس منو برقرار نشد. دوباره تلاش کنید.', 'database_unavailable');
    }
    const txt = await response.text();
    let data; try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
    if (!response.ok && !allowFailure) {
      const code = data?.code;
      if (code === '23503' || code === '23001') throw new HttpError(409, 'این مورد در منو استفاده می‌شود. ابتدا وابستگی آن را بردارید.', 'record_in_use');
      if (code === '23505') throw new HttpError(409, 'نام یا اطلاعات تکراری است.', 'duplicate');
      if (code === '22023') throw new HttpError(409, 'فهرست دسته‌ها تغییر کرده است. صفحه را تازه کنید.', 'conflict');
      if (code === '23514' || code === '22P02') throw new HttpError(400, 'اطلاعات واردشده معتبر نیست.', 'validation');
      throw new HttpError(503, 'سرویس منو پاسخ معتبر نداد. تنظیمات سرور را بررسی کنید.', 'upstream_error');
    }
    return allowFailure ? { ok: response.ok, status: response.status, data } : data;
  };
}

export const query = (values) => new URLSearchParams(values).toString();
export const rest = (table, filters = {}) => `/rest/v1/${table}?${query(filters)}`;
export const representation = { Prefer: 'return=representation' };
