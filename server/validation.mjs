import { HttpError } from './supabase.mjs';
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uploadPattern = /^uploads\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
export function fail(message) { throw new HttpError(400, message, 'validation'); }
export function uuid(value) { if (typeof value !== 'string' || !uuidPattern.test(value)) fail('شناسه معتبر نیست.'); return value; }
export function text(value, max, required = false) {
  if (typeof value !== 'string') fail('مقدار متنی معتبر نیست.');
  const s = value.trim();
  if (s.length > max || (required && !s) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) fail('طول یا قالب متن معتبر نیست.');
  return s;
}
export function number(value, nullable = false) {
  if (nullable && (value === null || value === '')) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) fail('قیمت باید یک عدد صحیح و مثبت یا صفر باشد.');
  return value;
}
export function bool(value) { if (typeof value !== 'boolean') fail('وضعیت معتبر نیست.'); return value; }
export function order(value) { const n = number(value); if (n > 10000) fail('ترتیب معتبر نیست.'); return n; }
export function imagePath(value, logo = false) {
  if (value === null || value === '') return logo ? '/assets/logo.jpg' : null;
  if (logo && value === '/assets/logo.jpg') return value;
  if (typeof value !== 'string' || !uploadPattern.test(value)) fail('مسیر تصویر معتبر نیست.');
  uuid(value.slice(8,44)); return value;
}
export function version(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new HttpError(428, 'برای ویرایش، نسخه تازه اطلاعات را دریافت کنید.', 'version_required');
  }
  return value;
}
export function product(input) {
  const out = {
    name: text(input.name,150,true), category_id: uuid(input.category_id), description: text(input.description ?? '',1000),
    price_type: input.price_type ?? 'fixed', price: number(input.price ?? null,true), special_price: number(input.special_price ?? null,true),
    image_path: imagePath(input.image_path ?? null), status: bool(input.status ?? true), featured: bool(input.featured ?? false),
    is_new: bool(input.is_new ?? false), sort_order: order(input.sort_order ?? 0), variants: []
  };
  if (!['fixed','daily','unpriced'].includes(out.price_type)) fail('نوع قیمت معتبر نیست.');
  if (!Array.isArray(input.variants ?? []) || (input.variants?.length ?? 0) > 10) fail('حداکثر ۱۰ قیمت متفاوت وارد کنید.');
  out.variants = (input.variants ?? []).map(v => {
    if (!v || typeof v !== 'object') fail('قیمت گزینه معتبر نیست.');
    const row = { label:text(v.label,80,true), price:number(v.price), special_price:number(v.special_price ?? null,true) };
    if (row.special_price !== null && row.special_price >= row.price) fail('قیمت ویژه باید کمتر از قیمت عادی باشد.');
    return row;
  });
  if (new Set(out.variants.map(v=>v.label)).size !== out.variants.length) fail('نام گزینه‌های قیمت نباید تکراری باشد.');
  if (out.special_price !== null && (out.price === null || out.special_price >= out.price)) fail('قیمت ویژه باید کمتر از قیمت عادی باشد.');
  if (out.price_type === 'fixed') {
    if (out.variants.length) { if (out.price !== null || out.special_price !== null) fail('برای محصول چندقیمتی، قیمت هر گزینه را جدا وارد کنید.'); }
    else if (out.price === null) fail('قیمت محصول را وارد کنید.');
  } else if (out.price !== null || out.special_price !== null || out.variants.length) fail('محصول با قیمت روز یا بدون قیمت نباید قیمت عددی داشته باشد.');
  return out;
}
export function category(input) {
  return { name:text(input.name,100,true), icon:text(input.icon ?? '☕',12), sort_order:order(input.sort_order ?? 0), active:bool(input.active ?? true) };
}
export function settings(input) {
  const out = { cafe_name:text(input.cafe_name,100,true), tagline:text(input.tagline ?? '',200), logo:imagePath(input.logo ?? '/assets/logo.jpg',true),
    phone:text(input.phone ?? '',30), address:text(input.address ?? '',500), instagram:text(input.instagram ?? '',100).replace(/^@/,''),
    working_hours:text(input.working_hours ?? '',500), menu_published:bool(input.menu_published ?? false) };
  if (out.phone && !/^[+\d۰-۹٠-٩\s()-]+$/.test(out.phone)) fail('شماره تماس معتبر نیست.');
  if (out.instagram && !/^[a-zA-Z0-9_.]{1,30}$/.test(out.instagram)) fail('فقط نام کاربری اینستاگرام را وارد کنید.');
  return out;
}
export function upload(input) {
  if (!input || typeof input.base64 !== 'string' || input.base64.length > 2796204 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) fail('فایل تصویر معتبر نیست یا بیش از ۲ مگابایت است.');
  const bytes = Buffer.from(input.base64,'base64');
  if (!bytes.length || bytes.length > 2097152 || bytes.toString('base64') !== input.base64) fail('تصویر باید حداکثر ۲ مگابایت باشد.');
  let mime, ext;
  if (bytes.length > 12 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) { mime='image/png';ext='png'; }
  else if (bytes.length > 4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) { mime='image/jpeg';ext='jpg'; }
  else if (bytes.length > 16 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') { mime='image/webp';ext='webp'; }
  else fail('فقط عکس JPG، PNG و WebP پذیرفته می‌شود.');
  if (mime !== input.mime_type) fail('نوع واقعی فایل با پسوند تصویر هم‌خوان نیست.');
  return { bytes, mime, ext };
}
