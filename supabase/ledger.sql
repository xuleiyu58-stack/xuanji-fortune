-- 单次券消费台账。
--
-- ⚠️ 这个文件属于**收费闭环**，不是账号功能。开通付费解读就必须执行它。
--    （原先它被放在 accounts.sql 里 —— 那是个分层错误：单次券的防重放
--      与账号体系无关，只做最小上线的人跑不到它，结果是付了钱的用户
--      排不了盘，因为服务端拿不到"这张券用过了"的凭据而拒绝放行。）
--
-- 为什么必须有这张表：
--   权益是一张**自包含的签名 cookie**，客户端手里那份是它自己的副本。
--   如果"这张券已经用过了"只体现在服务端回写的新 cookie 里，那么任何
--   保留旧 cookie 的人（抄走凭证的、不执行 cookie 清除的客户端、手工
--   重放请求的）都能把同一张券无限次用下去。签名能防伪造，防不住重放。
--
-- 键是 `tid:下标:次数`，三段都必要：
--   · tid    凭证每次签发时的唯一编号（见 lib/entitlement.ts 的 newTokenId）
--   · 下标   这一份凭证里的第几张券（同模式可能有多张）
--   · 次数   这张券的第几次使用（n>1 的券要能用多次）
--
-- 第三段容易被漏掉：一张 2 次的券，两次使用记的应该是 `tid:0:2` 与 `tid:0:1`，
-- 而不是同一个 `tid:0` —— 后者会让第二次使用被误判成重放。
-- 次数是递减的，所以每次使用天然不同；同一次使用重放则三段完全相同。
-- 主键冲突 = 这次消费已经发生过 → 拒绝。
--
-- 并发语义：先 insert 成功的那一次才算消费成功，因此两个并发请求不会同时通过。
create table if not exists public.pass_consumptions (
  pass_id     text primary key,          -- `<tid>:<下标>:<消费前次数>`
  consumed_at timestamptz not null default now()
);

alter table public.pass_consumptions enable row level security;
revoke all on public.pass_consumptions from anon, authenticated;

-- 便于按日清理历史（凭证最长 400 天，台账留 400 天以上即可）
create index if not exists pass_consumptions_consumed_idx
  on public.pass_consumptions (consumed_at);
