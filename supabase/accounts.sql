-- 账号体系：权益绑定到账户，排盘记录上云
--
-- 与 schema.sql / redeem.sql 分开放，同样是因为前两个已经在线上执行过，
-- 往里面追加会让人不确定该重跑哪一段。这一段单独执行一次即可。
--
-- 前置：Supabase 控制台 → Authentication → Providers → Email 打开，
--       并把 Email OTP 模板里的 {{ .Token }} 显示出来（默认只发链接）。
--       见 README「账号体系」一节。

-- ── 账户权益 ────────────────────────────────────────────────
--
-- 结构刻意与 lib/entitlement.ts 的 Entitlement 保持一致：
--   member  = 会员到期 unix 秒，非会员为 null
--   passes  = [{ m: 模式, n: 剩余次数, e: 失效 unix 秒 }]
-- 放 JSONB 而不是拆成两张表，是因为这块数据总是整份读写（合并、消耗、
-- 签发凭证），拆开只会让每次操作都变成多表事务，收益为零。
create table if not exists public.account_entitlements (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  member      bigint,
  passes      jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.account_entitlements enable row level security;
revoke all on public.account_entitlements from anon, authenticated;

-- ── 排盘记录上云 ────────────────────────────────────────────
--
-- 只存解读正文与当次输入。出生信息属于个人敏感信息，但它是这条记录
-- 不可分割的一部分 —— 没有它，用户回看时无法知道这份解读对应哪个盘。
-- 隐私政策里已如实说明这一点，用户也可随时删除单条记录。
create table if not exists public.readings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  mode        text not null,
  title       text not null,
  result      text not null,
  input       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.readings enable row level security;
revoke all on public.readings from anon, authenticated;

-- 回看列表按时间倒序，这个索引是必须的
create index if not exists readings_user_created_idx
  on public.readings (user_id, created_at desc);

-- ── 设备权益镜像 ────────────────────────────────────────────
--
-- 权益的主副本仍在签名 cookie（xj_pass）里，热路径只验签、不查这张表。
-- 这张表是**迁移用的中转站**，它的一生分三步（注意三步发生在不同时刻）：
--
--   ① 兑换时（/api/redeem）：权益写进 cookie，同时也写一份到这里
--   ② 登录认领时（/api/account/claim）：把这里的记录**搬到**账户，并删除该行；
--      同时清掉本机 cookie，此后权益只属于账户
--   ③ 之后每次请求：cookie 缺失才回退读账户补签，热路径不碰任何表
--
-- 「搬」而不是「抄」是关键：抄一份的话，用户在同一台设备重新兑换一次，
-- 就能把同一份权益再认领到另一个账户上 —— 那是权益复制漏洞。
-- 搬走并删除，则一份权益在任何时刻只存在于一个地方。
create table if not exists public.device_entitlements (
  device_id   text primary key,
  member      bigint,
  passes      jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.device_entitlements enable row level security;
revoke all on public.device_entitlements from anon, authenticated;

-- ── 认领码 ──────────────────────────────────────────────────
--
-- 这是整套设计里唯一一处「把匿名权益接上账户」的地方。
--
-- 为什么要走这个中转，而不让客户端直接把 xj_pass 交给服务端？
--   因为 xj_pass 是 httpOnly 的 —— 页面脚本读不到它，这正是它的价值所在。
--   如果为了迁移权益就在前端暴露凭证，那这层保护就白做了。
-- 所以：客户端调 /api/account/link 拿一个一次性短码（服务端自己知道
-- 当前设备有哪些权益），登录后凭这个码把权益并入账户。
--
-- 一次性 + 10 分钟有效期：短码只有 32 bit 可见字符空间，
-- 若不过期、可重复使用，就成了一个可被暴力枚举的权益转移通道。
create table if not exists public.link_codes (
  code        text primary key,
  device_id   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

alter table public.link_codes enable row level security;
revoke all on public.link_codes from anon, authenticated;

create index if not exists link_codes_expires_idx on public.link_codes (expires_at);

-- ── 原子认领 ────────────────────────────────────────────────
--
-- 只有把 used_at 从 null 改成 now 的那一次调用会返回 device_id，
-- 并发下不会被重复认领 —— 与 redeem_code 同一个套路。
create or replace function public.claim_link_code(c text, now_ts timestamptz)
returns table (device_id text)
language sql
security definer
set search_path = public
as $$
  update public.link_codes
     set used_at = now_ts
   where code = c
     and used_at is null
     and expires_at > now_ts
  returning link_codes.device_id;
$$;

revoke all on function public.claim_link_code(text, timestamptz) from anon, authenticated;

-- ── 单次券消费台账 ──────────────────────────────────────────
--
-- ⚠️ 这张表**不在本文件里**，已挪到 `supabase/ledger.sql`。
--
-- 原因：它属于收费闭环，不是账号功能。放在这里会造成一个真实的故障 ——
-- 只做最小上线（不跑本文件）的人，单次券找不到消费台账，服务端按
-- "宁可拒绝也不放行"处理，结果是付了钱的用户排不了盘。
--
-- 完整执行顺序：schema.sql → redeem.sql → ledger.sql →（可选）accounts.sql


-- ── 权益合并函数 ────────────────────────────────────────────
--
-- 合并规则与 lib/entitlement.ts 的 grantMember / grantPass 完全一致：
--   · 会员续期从「现有到期时间」往后接，提前续费不亏剩余天数
--   · 同模式的券次数相加、到期取较晚者
--
-- 放在数据库里做，是因为「读 → 合并 → 写」这三步必须原子。
-- 放在应用层，两次并发登录就会丢掉一份权益。

-- 迁移设备权益到账户：一次调用完成「读取设备行 → 合并进账户 → 删除设备行」。
-- 三步必须在同一个事务里，否则并发认领会把同一份权益加两次。
create or replace function public.claim_device_entitlement(
  uid uuid,
  dev text,
  now_ts timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  dev_member bigint;
  dev_passes jsonb;
  cur_member bigint;
  cur_passes jsonb;
begin
  -- 锁住设备行再取走。取不到说明已被认领过或本就没有权益。
  delete from public.device_entitlements
   where device_id = dev
  returning member, passes into dev_member, dev_passes;

  if not found then
    return false;
  end if;

  select member, passes into cur_member, cur_passes
    from public.account_entitlements
   where user_id = uid
     for update;

  if not found then
    cur_member := null;
    cur_passes := '[]'::jsonb;
  end if;

  if dev_member is not null then
    -- 两边都是绝对到期时间，取较晚者即可。
    -- 不把它当"增量"去加：那会让权益随着迁移次数变多而变长。
    cur_member := greatest(coalesce(cur_member, 0), dev_member);
  end if;

  cur_passes := (
    select coalesce(jsonb_agg(merged), '[]'::jsonb)
      from (
        select jsonb_build_object('m', m, 'n', sum(n), 'e', max(e)) as merged
          from (
            select (p->>'m') as m, (p->>'n')::int as n, (p->>'e')::bigint as e
              from jsonb_array_elements(
                     coalesce(cur_passes, '[]'::jsonb) || coalesce(dev_passes, '[]'::jsonb)
                   ) as p
          ) flat
         group by m
      ) grouped
  );

  insert into public.account_entitlements (user_id, member, passes, updated_at)
  values (uid, cur_member, coalesce(cur_passes, '[]'::jsonb), now_ts)
  on conflict (user_id) do update
    set member = excluded.member,
        passes = excluded.passes,
        updated_at = excluded.updated_at;

  return true;
end;
$$;

revoke all on function public.claim_device_entitlement(uuid, text, timestamptz) from anon, authenticated;

create or replace function public.merge_entitlement(
  uid uuid,
  add_member bigint,
  add_passes jsonb,
  now_ts timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_member bigint;
  cur_passes jsonb;
  base       bigint;
begin
  select member, passes into cur_member, cur_passes
    from public.account_entitlements
   where user_id = uid
     for update;

  if not found then
    cur_member := null;
    cur_passes := '[]'::jsonb;
  end if;

  -- 已在有效期内则从到期时间续，否则从现在起算
  if add_member is not null and add_member > 0 then
    base := greatest(coalesce(cur_member, 0), extract(epoch from now_ts)::bigint);
    cur_member := base + add_member;
  end if;

  -- 逐张合并传入的券
  if add_passes is not null then
    cur_passes := (
      select coalesce(jsonb_agg(merged), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'm', m,
                   'n', sum(n),
                   'e', max(e)
                 ) as merged
            from (
              select (p->>'m') as m,
                     (p->>'n')::int as n,
                     (p->>'e')::bigint as e
                from jsonb_array_elements(coalesce(cur_passes, '[]'::jsonb) || add_passes) as p
            ) flat
           group by m
        ) grouped
    );
  end if;

  insert into public.account_entitlements (user_id, member, passes, updated_at)
  values (uid, cur_member, coalesce(cur_passes, '[]'::jsonb), now_ts)
  on conflict (user_id) do update
    set member = excluded.member,
        passes = excluded.passes,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.merge_entitlement(uuid, bigint, jsonb, timestamptz) from anon, authenticated;

-- ── 清理过期的认领码 ────────────────────────────────────────
-- 可选。挂在 pg_cron 上按日执行，或手动跑。
-- select cron.schedule('clean-link-codes', '0 4 * * *',
--   $$delete from public.link_codes where expires_at < now() - interval '1 day'$$);
