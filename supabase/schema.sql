-- 用量计数表：设备 / IP / 全局三个维度共用一张表
--
-- 在 Supabase 控制台的 SQL Editor 里执行一次。
-- 若提示 bump_usage 已存在，先 drop function public.bump_usage(text);

create table if not exists public.usage (
  key   text not null,   -- 'dev:<设备ID>' | 'ip:<IP哈希>' | 'global'
  day   date not null,
  count int  not null default 0,
  primary key (key, day)
);

-- 只允许服务端 service_role 读写，客户端一律无权
alter table public.usage enable row level security;
revoke all on public.usage from anon, authenticated;

-- 原子自增。并发下先 select 再 update 会丢计数，必须由数据库保证
create or replace function public.bump_usage(k text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage (key, day, count)
  values (k, (now() at time zone 'Asia/Shanghai')::date, 1)
  on conflict (key, day) do update set count = public.usage.count + 1;
$$;

revoke all on function public.bump_usage(text) from anon, authenticated;

-- 便于按日清理历史用量
create index if not exists usage_day_idx on public.usage (day);
