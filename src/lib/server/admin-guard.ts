/**
 * 确认页的准入判定。
 *
 * 页面（app/admin/page.tsx）与它的接口（app/api/admin/confirm/route.ts）共用这一处 ——
 * 抄一份到第二处，两份迟早会因为只改了一处而漂移，而漂移的那份就是敞着的口子。
 * 理由与 quota-guard 相同（那句话就是从那边借来的）。
 *
 * **为什么这个页面值得单独一套准入：**它是全站**唯一**新开的对外管理面。
 * README 当初砍掉管理后台的理由正是"多一个暴露面"，所以这里每一条都要能回答
 * "为什么这样就不算敞着"，而不能只说"它有密钥保护"：
 *
 *   · 缺 ADMIN_KEY 一律停用 —— 部署漏配一个变量，整个订单确认面就敞开，
 *     这是最容易发生也最严重的一种失败模式，所以它必须是**第一件**判的事
 *   · 密钥用常量时间比较（lib/entitlement.ts 的 verify() 同款）
 *   · 失败按 IP 限次 —— 32 字节随机本就穷举不了，这道闸门防的是噪声与告警疲劳
 *   · 一律不放行时调用方回 404 而不是 403 —— 403 等于确认"这个页面存在，只是你没钥匙"
 *
 * **本模块只 import node:crypto 与 usage-store**，不 import next/server：判定是纯的，
 * 能被 node --test 直接跑到（同 lib/entitlement.ts、lib/order-flow.ts 的取向）。
 * "不放行该怎么表达成 HTTP"（页面 notFound() / 接口空体 404）留在调用方。
 */
import { timingSafeEqual } from "node:crypto";
import { envValue } from "@/lib/server/runtime";
import { clientIp, type HeadersLike } from "@/lib/server/client-ip";
import { bumpCount, hashIp, readCount } from "@/lib/server/usage-store";

/**
 * 环境变量名。
 *
 * **绝不能加 NEXT_PUBLIC_ 前缀** —— 带了前缀的值会被内联进浏览器包，
 * 那这把钥匙就等于公开挂在页面上，这一整套防护会一起归零。
 */
const ADMIN_KEY_ENV = "ADMIN_KEY";

/**
 * 每个 IP 每日允许的失败次数。
 *
 * 密钥是 32 字节（256 bit）随机，爆破在数学上就不可能；这道闸门真正防的是
 * **噪声与告警疲劳**：没有它，一台扫描器就能把日志刷满、把 CPU 花在常量时间比较上，
 * 而站长在真实的失败里再也看不出异常。
 *
 * 10 是经验值：站长自己看错几次够用，攻击者需要 2^255 次。计数与其它限流共用
 * usage 表，按北京时间的自然日重置（见 usage-store 的 today()）。
 */
export const ADMIN_FAIL_LIMIT = 10;

/**
 * 确认动作的审计标识，交给 confirmOrder 的 `by`。
 *
 * 与 scripts/confirm-order.mjs 传的 "cli" 刻意区分开：日后对账时要能一眼看出
 * 这一单是「页面上点的」还是「命令行确认的」—— 两条路径出问题时的排查方向不同
 * （页面确认查网络与误触，脚本确认查命令与时间窗）。
 */
export const ADMIN_CONFIRM_BY = "admin-page";

/** 本次部署到底配没配密钥。未配置时一切请求都必须被拒。 */
export function adminKey(): string | null {
  return envValue(ADMIN_KEY_ENV) ?? null;
}

export type AdminDenyReason =
  | "unconfigured" // 没配 ADMIN_KEY —— 部署漏配，页面与接口都该当作不存在
  | "bad-key" // 密钥不对（或压根没带）
  | "rate-limited" // 这个 IP 今天失败太多次
  | "unavailable"; // 限流设施读不到 / 用不了，宁可拒绝服务

export type AdminOutcome = { ok: true } | { ok: false; reason: AdminDenyReason };

/**
 * 限流键。
 *
 * 前缀 `admin:` 与 usage-store 的 `dev:` / `ip:` / `global` / `preview:` 同表不同域，
 * 互不干扰 —— 确认页的失败次数不该占掉用户的解读额度，反过来也一样。
 */
export function adminRateKey(ipHash: string): string {
  return `admin:${ipHash}`;
}

/**
 * 常量时间比较。理由同 lib/entitlement.ts 的 verify()：用 `===` 比较密钥时，
 * 比较耗时会随"前几位对上了"增长，理论上能一个字节一个字节地把密钥量出来。
 * 密钥是整个页面唯一的东西，这里省下的那点代码换不回这个风险。
 *
 * **必须先比长度**：timingSafeEqual 对不等长的 buffer 直接抛异常（不是返回 false），
 * 漏了这一步就成了"换个长度的密钥就能让服务端 500"的崩法。
 * 长度本身不是秘密（由站长生成时决定），所以提前返回不算泄漏 —— 与 verify() 同款写法。
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const actual = Buffer.from(a, "utf8");
  const expected = Buffer.from(b, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * 判定这次请求能不能用确认页。
 *
 * `provided` 由调用方从 query string（页面）或表单体（确认接口）里取。
 * 两条入口共用它，正是为了"少一处判定"。
 *
 * 全程**不打印 provided** —— 密钥一旦进了日志（或含密钥的完整 URL），
 * 就等于从一个受保护的通道漏到一个不受保护的通道，而这套防护的全部价值都在那把钥匙上。
 */
export async function checkAdmin(
  req: { headers: HeadersLike },
  provided: string | null | undefined
): Promise<AdminOutcome> {
  const configured = adminKey();

  if (!configured) {
    // 第一件事就是它。没配密钥 = 这个页面不存在，**绝不能放行**：
    // 部署时漏配一个变量就把整个订单确认面敞开，是这套设计里唯一
    // "不设防也不报错"的失败方式，所以它必须显式拒绝而不是默默通过。
    // 这里只打一条说明部署有问题的日志（不含任何密钥 —— 此时也没有密钥可含）。
    console.error("[admin] 未配置 ADMIN_KEY：确认页与它的接口一律停用（一律 404）");
    return { ok: false, reason: "unconfigured" };
  }

  // 限流用的 IP 哈希。缺盐时 hashIp 会抛（生产环境没配 PASS_SECRET/IP_HASH_SALT）——
  // 那是部署少配了环境变量，不该变成一个带堆栈的 500，按"服务端故障"处理。
  let ipHash: string;
  try {
    ipHash = hashIp(clientIp(req.headers));
  } catch (err) {
    console.error("[admin] IP 哈希失败，确认页拒绝服务:", err);
    return { ok: false, reason: "unavailable" };
  }

  const rateKey = adminRateKey(ipHash);

  // 先看失败计数。**读不到就拒绝服务**：限流失效时宁可不可用，
  // 也不能让"暴力试密钥"变成一个没有代价的操作（同 quota-guard 的原则）。
  let fails: number;
  try {
    fails = await readCount(rateKey);
  } catch (err) {
    console.error("[admin] 读取失败计数失败，确认页拒绝服务:", err);
    return { ok: false, reason: "unavailable" };
  }

  if (fails >= ADMIN_FAIL_LIMIT) {
    // 只记哈希的前 8 位，够站长在日志里认出"是同一台机器在试"，
    // 又不会把可反查的完整指纹写进日志。密钥本身永远不出现在任何一行日志里。
    console.error(
      `[admin] 该来源今日失败已达 ${ADMIN_FAIL_LIMIT} 次，今日不再受理：${ipHash.slice(0, 8)}…`
    );
    return { ok: false, reason: "rate-limited" };
  }

  if (typeof provided !== "string" || !constantTimeEqual(provided, configured)) {
    // 只有**失败**才计数：站长自己正常使用不该消耗这条额度。
    try {
      await bumpCount(rateKey);
    } catch (err) {
      // 记不上失败次数 = 限流形同虚设，这一次的"错"已经判出来了，但下一次
      // 可能就不再受控。按服务端故障拒绝，宁可不服务。
      console.error("[admin] 写入失败计数失败，确认页拒绝服务:", err);
      return { ok: false, reason: "unavailable" };
    }
    return { ok: false, reason: "bad-key" };
  }

  return { ok: true };
}
