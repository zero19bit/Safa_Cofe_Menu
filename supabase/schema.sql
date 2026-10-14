-- Run once in the Supabase SQL Editor. Safe to run again.
begin;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 100),
  icon text not null default '☕' check (char_length(icon) <= 12),
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 150),
  description text not null default '' check (char_length(description) <= 1000),
  price_type text not null default 'fixed' check (price_type in ('fixed','daily','unpriced')),
  price bigint check (price between 0 and 1000000000),
  special_price bigint check (special_price between 0 and 1000000000),
  variants jsonb not null default '[]' check (jsonb_typeof(variants) = 'array' and jsonb_array_length(variants) <= 10),
  image_path text,
  status boolean not null default true,
  featured boolean not null default false,
  is_new boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (special_price is null or (price is not null and special_price < price)),
  check ((price_type = 'fixed' and ((price is not null and jsonb_array_length(variants) = 0) or (price is null and special_price is null and jsonb_array_length(variants) > 0)))
    or (price_type in ('daily','unpriced') and price is null and special_price is null and jsonb_array_length(variants) = 0))
);

create table if not exists public.settings (
  id boolean primary key default true check (id = true),
  cafe_name text not null default 'کافه صفا' check (char_length(cafe_name) between 1 and 100),
  tagline text not null default 'به صفا خوش آمدید' check (char_length(tagline) <= 200),
  logo text not null default '/assets/logo.jpg',
  phone text not null default '' check (char_length(phone) <= 30),
  address text not null default '' check (char_length(address) <= 500),
  instagram text not null default '' check (char_length(instagram) <= 100),
  working_hours text not null default '' check (char_length(working_hours) <= 500),
  menu_published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.-]{3,64}$'),
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token_hash text primary key check (char_length(token_hash) = 64),
  admin_id uuid not null references public.admins(id) on delete cascade,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.login_rate_limits (
  bucket text primary key,
  attempts integer not null default 1,
  window_started_at timestamptz not null default now()
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  uploaded_by uuid not null references public.admins(id) on delete restrict,
  size integer not null check (size between 1 and 2097152),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  created_at timestamptz not null default now()
);

-- Foreign keys also protect media under concurrent API requests.
alter table public.settings add column if not exists logo_media_path text
  generated always as (case when logo like 'uploads/%' then logo else null end) stored;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='safa_product_image_fkey' and conrelid='public.products'::regclass) then
    alter table public.products add constraint safa_product_image_fkey foreign key(image_path) references public.media(path) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='safa_logo_image_fkey' and conrelid='public.settings'::regclass) then
    alter table public.settings add constraint safa_logo_image_fkey foreign key(logo_media_path) references public.media(path) on delete restrict;
  end if;
end $$;

create index if not exists products_category_order_idx on public.products(category_id, sort_order, created_at);
create index if not exists sessions_expiry_idx on public.admin_sessions(expires_at);

create or replace function public.safa_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end;
$$;

drop trigger if exists safa_categories_updated on public.categories;
create trigger safa_categories_updated before update on public.categories for each row execute function public.safa_updated_at();
drop trigger if exists safa_products_updated on public.products;
create trigger safa_products_updated before update on public.products for each row execute function public.safa_updated_at();
drop trigger if exists safa_settings_updated on public.settings;
create trigger safa_settings_updated before update on public.settings for each row execute function public.safa_updated_at();

-- One atomic statement returns a consistent public snapshot; draft menus stay private.
create or replace function public.safa_public_menu() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.settings s where id = true),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order, c.created_at) from public.categories c where c.active), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order, p.created_at)
      from public.products p join public.categories c on c.id = p.category_id
      where p.status and c.active and exists(select 1 from public.settings where id = true and menu_published)), '[]'::jsonb)
  );
$$;

create or replace function public.safa_admin_menu() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from public.settings s where id = true),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order, c.created_at) from public.categories c), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order, p.created_at) from public.products p), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from public.media m), '[]'::jsonb)
  );
$$;

-- Shared, atomic rate limiting across all Vercel instances. Failed attempts cannot bypass it.
create or replace function public.safa_take_login_attempt(p_bucket text, p_limit integer, p_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.login_rate_limits; v_now timestamptz := clock_timestamp();
begin
  if p_limit < 1 or p_seconds < 1 or char_length(p_bucket) > 128 then raise exception 'Invalid limiter'; end if;
  insert into public.login_rate_limits as l (bucket, attempts, window_started_at) values (p_bucket, 1, v_now)
  on conflict (bucket) do update set
    attempts = case when l.window_started_at + make_interval(secs => p_seconds) <= v_now then 1 else l.attempts + 1 end,
    window_started_at = case when l.window_started_at + make_interval(secs => p_seconds) <= v_now then v_now else l.window_started_at end
  returning * into v;
  delete from public.login_rate_limits where window_started_at < v_now - interval '1 day';
  delete from public.admin_sessions where expires_at <= v_now or last_seen_at < v_now - interval '30 minutes';
  return jsonb_build_object('allowed', v.attempts <= p_limit,
    'retry_after', greatest(1, ceil(extract(epoch from v.window_started_at + make_interval(secs => p_seconds) - v_now))::integer));
end;
$$;

create or replace function public.safa_reorder_categories(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  lock table public.categories in share row exclusive mode;
  select count(*) into v_count from public.categories;
  if cardinality(p_ids) <> v_count or (select count(distinct x) from unnest(p_ids) x) <> v_count
    or exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.categories c where c.id=x))
  then raise exception using errcode = '22023', message = 'Category list changed'; end if;
  update public.categories c set sort_order = u.n - 1
    from unnest(p_ids) with ordinality as u(id, n) where c.id = u.id;
end;
$$;

-- Imports are a single transaction. A malformed item rolls back the entire batch.
create or replace function public.safa_import_menu(p_categories jsonb, p_products jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb; p jsonb; v_categories integer := 0; v_products integer := 0;
begin
  if jsonb_typeof(p_categories) <> 'array' or jsonb_typeof(p_products) <> 'array'
    or jsonb_array_length(p_categories) > 1000 or jsonb_array_length(p_products) > 10000
  then raise exception using errcode='22023', message='Invalid import'; end if;
  for c in select value from jsonb_array_elements(p_categories) loop
    insert into public.categories(id,name,icon,sort_order,active)
    values((c->>'id')::uuid,c->>'name',c->>'icon',(c->>'sort_order')::integer,(c->>'active')::boolean)
    on conflict(id) do update set name=excluded.name,icon=excluded.icon,sort_order=excluded.sort_order,active=excluded.active;
    v_categories := v_categories+1;
  end loop;
  for p in select value from jsonb_array_elements(p_products) loop
    insert into public.products(id,category_id,name,description,price_type,price,special_price,variants,image_path,status,featured,is_new,sort_order)
    values((p->>'id')::uuid,(p->>'category_id')::uuid,p->>'name',p->>'description',p->>'price_type',
      (p->>'price')::bigint,(p->>'special_price')::bigint,p->'variants',p->>'image_path',
      (p->>'status')::boolean,(p->>'featured')::boolean,(p->>'is_new')::boolean,(p->>'sort_order')::integer)
    on conflict(id) do update set category_id=excluded.category_id,name=excluded.name,description=excluded.description,
      price_type=excluded.price_type,price=excluded.price,special_price=excluded.special_price,variants=excluded.variants,
      image_path=excluded.image_path,status=excluded.status,featured=excluded.featured,is_new=excluded.is_new,sort_order=excluded.sort_order;
    v_products := v_products+1;
  end loop;
  return jsonb_build_object('categories',v_categories,'products',v_products);
end;
$$;

-- There is no direct browser access to any app table or RPC, including Auth users.
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.settings enable row level security;
alter table public.admins enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.login_rate_limits enable row level security;
alter table public.media enable row level security;
revoke all on public.categories, public.products, public.settings, public.admins,
  public.admin_sessions, public.login_rate_limits, public.media from anon, authenticated;
grant all on public.categories, public.products, public.settings, public.admins,
  public.admin_sessions, public.login_rate_limits, public.media to service_role;
revoke all on function public.safa_updated_at(), public.safa_public_menu(), public.safa_admin_menu(),
  public.safa_take_login_attempt(text,integer,integer), public.safa_reorder_categories(uuid[]), public.safa_import_menu(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.safa_public_menu(), public.safa_admin_menu(), public.safa_take_login_attempt(text,integer,integer),
  public.safa_reorder_categories(uuid[]), public.safa_import_menu(jsonb,jsonb) to service_role;

insert into public.settings(id) values (true) on conflict do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('safa-images','safa-images',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true, file_size_limit=2097152, allowed_mime_types=excluded.allowed_mime_types;
-- No public Storage write policy is created. Only the server uploads and deletes.
commit;
