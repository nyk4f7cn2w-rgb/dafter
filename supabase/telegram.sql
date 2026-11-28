-- ===== تقارير تليكرام: ربط المحلات ببوت @DafterGoldBot =====
create table if not exists public.tg_links (
  chat_id    bigint not null,
  shop_id    text   not null references public.shops(id) on delete cascade,
  name       text,
  created_at timestamptz not null default now(),
  primary key (chat_id, shop_id)
);
create table if not exists public.tg_tokens (
  token      text primary key,
  shop_id    text not null references public.shops(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists public.tg_log (
  shop_id text not null,
  day     date not null,
  kind    text not null,
  sent_at timestamptz not null default now(),
  primary key (shop_id, day, kind)
);

alter table public.tg_links  enable row level security;
alter table public.tg_tokens enable row level security;
alter table public.tg_log    enable row level security;
revoke all on public.tg_links, public.tg_tokens, public.tg_log from anon, authenticated, public;
-- ما أكو policies: الجداول تنقرا وتنكتب بس من السيرفر (service role) أو من الدوال تحت

-- صاحب المحل ياخذ كود ربط صالح ٣٠ دقيقة
create or replace function public.tg_link_token() returns text
language plpgsql security definer set search_path = public as $$
declare sid text; t text;
begin
  select id into sid from public.shops where owner = auth.uid();
  if sid is null then raise exception 'no_shop'; end if;
  delete from public.tg_tokens where expires_at < now() or shop_id = sid;
  t := replace(gen_random_uuid()::text, '-', '');
  insert into public.tg_tokens(token, shop_id, expires_at) values (t, sid, now() + interval '30 minutes');
  return t;
end $$;

-- كم حساب تليكرام مربوط بمحلي
create or replace function public.tg_status() returns int
language sql security definer set search_path = public stable as $$
  select count(*)::int from public.tg_links l join public.shops s on s.id = l.shop_id where s.owner = auth.uid();
$$;

-- إيقاف التقارير لمحلي
create or replace function public.tg_unlink() returns void
language sql security definer set search_path = public as $$
  delete from public.tg_links where shop_id in (select id from public.shops where owner = auth.uid());
$$;

revoke execute on function public.tg_link_token(), public.tg_status(), public.tg_unlink() from public, anon;
grant  execute on function public.tg_link_token(), public.tg_status(), public.tg_unlink() to authenticated;

-- Supabase الجديد ما يعطي service_role صلاحيات تلقائياً: البوت والإرسال الليلي يحتاجوها
grant select, insert, update, delete on public.tg_links, public.tg_tokens, public.tg_log to service_role;
grant select on public.shops, public.clients to service_role;
