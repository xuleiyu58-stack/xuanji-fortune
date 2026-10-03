/**
 * 权益合并。
 *
 * 纯函数、零 I/O —— 之所以单独成一个模块，是因为这条规则有**三个实现**，
 * 而它们必须逐字一致：
 *
 *   1. `lib/entitlement.ts` 的 grantMember / grantPass（签发与消耗，客户端路径）
 *   2. 这里（内存兜底与账户合并）
 *   3. `supabase/accounts.sql` 的 merge_entitlement / claim_device_entitlement（线上）
 *
 * 三份实现如果不一致，表现是"本地跑通、线上算错"或者反过来 ——
 * 这类 bug 不会报错，只会让某个用户的会员少几天，极难发现。
 * 所以把能共用的那一份提出来，并给它单独写测试。
 *
 * 合并规则只有两条，但两条都有反直觉之处：
 *   · 会员取**较晚**的到期时间，而不是相加 —— 相加会把同一份权益算两遍
 *   · 券按模式分别合并：次数相加，到期取较晚者
 */
import type { Entitlement, Pass } from "./entitlement.ts";

/**
 * 把 `b` 并入 `a`，返回新对象（不改动入参）。
 *
 * 顺序无关：会员取 max、券次数相加、到期取 max，都是可交换的。
 */
export function mergeEntitlements(a: Entitlement, b: Entitlement): Entitlement {
  // null 表示"不是会员"，与 0 不同（0 是 1970 年，也是过期）
  const member =
    a.member === null ? b.member : b.member === null ? a.member : Math.max(a.member, b.member);

  const byMode = new Map<string, Pass>();
  for (const p of [...a.passes, ...b.passes]) {
    const prev = byMode.get(p.m);
    byMode.set(p.m, prev ? { m: p.m, n: prev.n + p.n, e: Math.max(prev.e, p.e) } : { ...p });
  }

  return { v: 1, member, passes: [...byMode.values()] };
}

/**
 * 把"天数"换算成本次应增加的秒数之后，接到现有到期时间上。
 *
 * 与 lib/entitlement.ts 的 grantMember 同口径：**已在有效期内则从到期时间往后接**，
 * 否则从此刻起算。提前续费不会亏掉剩余天数。
 */
export function memberAfterRenewal(
  current: Entitlement,
  days: number,
  nowSec: number
): number {
  const base = current.member !== null && current.member > nowSec ? current.member : nowSec;
  return base + days * 86400;
}
