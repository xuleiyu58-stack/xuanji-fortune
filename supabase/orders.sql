-- 订单表与状态机。
--
-- 与 schema.sql / redeem.sql 分开放，理由同 redeem.sql 开头那段：
-- 那些已经在线上执行过，往里面追加会让人不确定该重跑哪一段。

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  plan            text not null,                    -- bazi | member_month | member_year
  amount          numeric(10,2) not null,           -- 服务端按 pricing.ts 快照，绝不信客户端
  status          text not null default 'pending',  -- pending | paid | expired
  provider        text,                             -- 用户声称的渠道：alipay | wechat
  payer_ref       text,                             -- 用户提交的交易单号
  device_id       uuid,                             -- 下单设备，自动到账靠它
  granted         jsonb,                            -- 交付时的权益快照，见 claim_order_delivery
  delivered_at    timestamptz,                      -- 权益已落设备（幂等闸）
  code_issued_at  timestamptz,                      -- 已发过激活码（幂等闸）
  paid_at         timestamptz,
  confirmed_by    text,                             -- 谁确认的，对账用
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists orders_device_idx on public.orders (device_id);

-- ── 状态机 ────────────────────────────────────────────────
--
-- 全部转换是单条 UPDATE ... WHERE status = ...，靠数据库原子性而不是
-- 应用层判断。这样"确认到账"与"过期清理"同时跑到也不冲突：先到的赢，
-- 后到的是空操作。

create or replace function public.expire_stale_orders()
returns int
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.orders
       set status = 'expired'
     where status = 'pending'
       and expires_at < now()
    returning 1
  )
  select count(*)::int from expired;
$$;

-- 允许 pending 与 expired 两种来源：真实坏情况是用户下了单、页面开着、
-- 半小时后才付款 —— 单已过期但钱真付了。允许确认"复活"它才不会丢单。
create or replace function public.confirm_order(p_id uuid, p_by text, p_provider text)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  update public.orders
     set status = 'paid',
         paid_at = now(),
         confirmed_by = p_by,
         provider = coalesce(p_provider, provider)
   where id = p_id
     and status in ('pending', 'expired')
  returning *;
$$;

create or replace function public.create_order(
  p_plan text,
  p_amount numeric,
  p_device uuid,
  p_ttl_minutes int
)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.expire_stale_orders();
  return query
    insert into public.orders (plan, amount, device_id, expires_at)
    values (p_plan, p_amount, p_device, now() + make_interval(mins => p_ttl_minutes))
    returning *;
end;
$$;

-- 原子抢占交付权。并发双击轮询、或用户开两个标签页时，两个请求都会读到
-- delivered_at is null 并各签一份权益 —— 只有拿到行的那个请求有权签发。
--
-- granted 由调用方算好传进来（它依赖请求里现有的 cookie 权益，SQL 算不了）。
-- 万一响应在网络上丢了，这份快照就是重发的依据。
create or replace function public.claim_order_delivery(
  p_id uuid,
  p_device uuid,
  p_granted jsonb
)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  update public.orders
     set delivered_at = now(),
         granted = p_granted
   where id = p_id
     and status = 'paid'
     and delivered_at is null
     and device_id = p_device
  returning *;
$$;

create or replace function public.mark_code_issued(p_id uuid, p_device uuid)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  update public.orders
     set code_issued_at = now()
   where id = p_id
     and status = 'paid'
     and code_issued_at is null
     and device_id = p_device
  returning *;
$$;

-- 只在用户什么都还没拿到时可撤。一旦权益发出去了就不许回头 ——
-- "撤销了但权益还在"是比"确认错了"更难查的状态。
create or replace function public.unconfirm_order(p_id uuid)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  update public.orders
     set status = 'pending',
         paid_at = null,
         confirmed_by = null
   where id = p_id
     and status = 'paid'
     and delivered_at is null
     and code_issued_at is null
  returning *;
$$;

revoke all on function public.expire_stale_orders() from anon, authenticated;
revoke all on function public.confirm_order(uuid, text, text) from anon, authenticated;
revoke all on function public.create_order(text, numeric, uuid, int) from anon, authenticated;
revoke all on function public.claim_order_delivery(uuid, uuid, jsonb) from anon, authenticated;
revoke all on function public.mark_code_issued(uuid, uuid) from anon, authenticated;
revoke all on function public.unconfirm_order(uuid) from anon, authenticated;

-- ⚠️ 上面这一组不够 —— 函数还从 `public` 角色继承着 EXECUTE。收口在 supabase/security.sql。
