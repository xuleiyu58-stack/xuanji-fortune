-- 安全收口：把 public 里的函数从匿名角色手里拿回来
--
-- 执行顺序：schema.sql → redeem.sql → ledger.sql →（可选）accounts.sql → orders.sql → **本文件**
-- 本文件幂等，可以反复跑。
--
-- ⚠️ 为什么需要它
--
-- 前面几个文件里，每一处 revoke 都写成了
--     revoke all on function public.xxx(...) from anon, authenticated;
-- 这个写法**挡不住匿名调用**。
--
-- Postgres 建函数时会自动执行
--     grant execute on function ... to public;
-- 这里的 `public` 是**一个角色**，而且是所有角色的祖先 ——
-- `anon` 与 `authenticated` 都属于它。所以上面那行只砍掉了这两个角色
-- 自己名下的直接授权，**从 public 继承来的那份还在**。
--
-- 结果：函数在 PostgREST 里照样匿名可调。
--
-- 为什么这很严重
--
-- accounts / ledger / redeem / schema 里那七张表都开了 RLS 且没有任何 policy，
-- 所以"直接读表"这条路是堵死的 —— 但从 `/rest/v1/rpc/<函数名>` 进来的调用
-- 根本不经过 RLS，而这些函数是 `security definer`（以属主身份运行，
-- 属主能绕过 RLS）。绕过的正是那道防线：
--
--   * merge_entitlement(uuid, bigint, jsonb, timestamptz)
--       → 任何人可以给自己写一份会员或一把单次券
--   * claim_device_entitlement(uuid, text, timestamptz)
--       → 同上，而且可以劫持别人的设备权益
--   * claim_link_code(text, timestamptz)
--       → 认领码只有 6 位上下（见 accounts.sql），可被暴力试出来
--   * redeem_code(text, text)
--       → 兑换码可被暴力试出来
--   * bump_usage(text)
--       → 可把当日全局计数打满。而全局熔断（src/lib/server/quota-guard.ts）
--         拦在付费凭证判断**之前**，所以这一下会把付过钱的用户一起挡回 503 ——
--         既是白嫖入口，也是一键打垮全站的开关
--
-- 前提是 anon key 进了部署环境。它是 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，
-- 按设计就是给浏览器看的（src/lib/auth-client.ts 在客户端用它），
-- 所以必须当作"已经公开"来防范。
--
-- 修法
--
-- revoke ... from public，一处收全部。用 `on all functions in schema` 而不是
-- 逐个点名，是为了让**以后新增的函数**也自动被覆盖 —— 逐条列举的东西，
-- 下一个人一定会漏。代价是它只作用于执行那一刻已存在的函数，所以
-- 以后往 public 里加函数时，仍要顺手 revoke 一次（照 redeem.sql 的写法）。
--
-- 至于 service_role：它是服务端那把钥匙（src/lib/server/runtime.ts），
-- 走的是 JWT 里的 role 声明，不是这两个角色。即便是，它作为
-- `service_role` 也能绕过 RLS，不受本文件影响。

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all functions in schema public from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all functions in schema public from anon;
  end if;
end $$;

-- ── 核对结果 ────────────────────────────────────────────────
--
-- 跑完上面那段后，执行这一句看看还有谁留着 EXECUTE。
-- 期望：**一行都不返回**（除了下面注释里说的那两个扩展自带函数）。
--
--   select p.proname as 函数,
--          coalesce(array_to_string(p.proacl, E'\n'), '（acl 为空 = 仍继承默认的 PUBLIC）') as 权限
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--    order by 1;
--
-- 判读要点：
--   * `proacl` 为 null 表示这个函数**从未被单独授权过**，它仍然带着建函数时
--     默认的 `=X/owner`（即 PUBLIC 有 EXECUTE）。所以"acl 为空"是坏消息，不是好消息。
--   * 期望看到的是形如 `{owner=X/owner,service_role=X/owner}` 的列表 ——
--     只有属主，没有 `=X/` 开头那一项（`=` 前面没有角色名，就是 PUBLIC）。
--
-- 若还有函数带着 PUBLIC 的 EXECUTE，多半是它的属主不是 postgres 而是别的角色，
-- 用 `alter function public.xxx(...) owner to postgres;` 之后再跑本文件。

-- ── 订单函数的收口（supabase/orders.sql）────────────────────
--
-- 上面那段 `on all functions in schema` 只覆盖它**执行那一刻已存在**的函数 ——
-- 这是那个写法唯一的代价，也是最容易忘的一步。orders.sql 后加进来的六个函数
-- 必须在这里点名再收一次，否则它们会带着 Postgres 建函数时默认的那句
-- `grant execute on function ... to public` 上线，在 PostgREST 里匿名可调：
--
--   * create_order(text…)        → 凭空给自己造一张订单
--   * confirm_order(…)           → 把任意订单标成已付款。这是白嫖入口：
--                                  确认后 claim_order_delivery 就签得出权益
--   * claim_order_delivery(…)    → granted 由调用方自己传，等于可以给自己
--                                  签发任意会员或单次券
--   * mark_code_issued(…)        → 把别人的兜底取码闸提前关掉，让他拿不到激活码
--   * unconfirm_order(…)         → 把已确认的单打回 pending
--   * expire_stale_orders()      → 危害最小（它只动已超时的单）。列在这里
--                                  是为了说明：这一整套函数此前都没上锁
--
-- 收口的角色写三个：`public` 才是关键那个（anon 与 authenticated 都属于它，
-- 砍它一个就等于砍了所有角色），另外两个一并写上是防将来有人单独给它们授过权。
-- 三个一起写不冲突。
--
-- 为什么包一层 do / to_regprocedure：`revoke` 一个**还不存在的函数**会直接报错，
-- 而 orders.sql 可能还没跑 —— 本文件承诺过"可以反复跑"（见开头），
-- 那就不该挑执行顺序。多了这道判断，先跑本文件也安全。
do $$
begin
  if to_regprocedure('public.create_order(text, numeric, uuid, int)') is not null then
    revoke all on function public.create_order(text, numeric, uuid, int) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.confirm_order(uuid, text, text)') is not null then
    revoke all on function public.confirm_order(uuid, text, text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.expire_stale_orders()') is not null then
    revoke all on function public.expire_stale_orders() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.claim_order_delivery(uuid, uuid, jsonb)') is not null then
    revoke all on function public.claim_order_delivery(uuid, uuid, jsonb) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.mark_code_issued(uuid, uuid)') is not null then
    revoke all on function public.mark_code_issued(uuid, uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.unconfirm_order(uuid)') is not null then
    revoke all on function public.unconfirm_order(uuid) from public, anon, authenticated;
  end if;
end $$;
