-- 激活码表。
--
-- 与 schema.sql 分开放，是因为 schema.sql 已经在线上执行过，
-- 往里面追加会让人不确定该重跑哪一段。这一段单独执行一次即可。

create table if not exists public.redeem_codes (
  code        text primary key,          -- 16 位 Crockford base32（去 I L O U），80 bit 熵
  kind        text not null,             -- 'member' | 'single'
  mode        text,                      -- kind='single' 时必填
  days        int  not null default 0,   -- kind='member' 时的有效天数
  batch       text,                      -- 批次号，便于按批发放与对账
  created_at  timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by text                       -- 兑换时的设备指纹，排查纠纷用
);

alter table public.redeem_codes enable row level security;
revoke all on public.redeem_codes from anon, authenticated;

-- 原子核销：只有把 redeemed_at 从 null 改成 now 的那一次调用会返回行。
-- 并发下不会双花 —— 这正是把这件事放在数据库而不是应用层做的理由。
create or replace function public.redeem_code(c text, who text)
returns table (kind text, mode text, days int)
language sql
security definer
set search_path = public
as $$
  update public.redeem_codes
     set redeemed_at = now(), redeemed_by = who
   where code = c and redeemed_at is null
  returning redeem_codes.kind, redeem_codes.mode, redeem_codes.days;
$$;

revoke all on function public.redeem_code(text, text) from anon, authenticated;

create index if not exists redeem_codes_batch_idx on public.redeem_codes (batch);
