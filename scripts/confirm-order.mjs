/**
 * 对账与人工确认 —— 站长每天唯一要用的脚本。
 *
 * 用法（在仓库根目录）：
 *   node --import ./scripts/ts-loader.mjs --env-file=.env.local scripts/confirm-order.mjs
 *   node --import ./scripts/ts-loader.mjs --env-file=.env.local scripts/confirm-order.mjs --hours 8
 *   node --import ./scripts/ts-loader.mjs --env-file=.env.local scripts/confirm-order.mjs --id 8f3a
 *   node --import ./scripts/ts-loader.mjs --env-file=.env.local scripts/confirm-order.mjs --undo 8f3a
 *
 * 线上在服务器上跑时把 --env-file 换成 deploy/.env.production。
 *
 * --import 是必需的：本脚本复用 src/lib/server/order-store.ts，而它的 import
 * 链上有 `@/` 别名（`@/lib/server/runtime`），只有 ts-loader 认得
 * （裸 node 会 ERR_MODULE_NOT_FOUND）。Task 2 在 gen-codes.mjs 上踩过同一个坑。
 *
 * 为什么这个脚本值得写得啰嗦：用户扫码付款后，页面正停在「等待到账…」上轮询，
 * **他等多久完全取决于这个脚本好不好用**。所以它只做三件事，但每件的输出都要能
 * 一眼看懂：列出待确认的单、确认一单、撤销一次误确认；外加一条主动告警
 * 「已付款但未领取」—— 那是差评与退款的来源，不该等用户来问。
 *
 * 价格与套餐名一律从 src/lib/pricing.ts 取，渠道名从 src/lib/pay.ts 取：
 * 这里再抄一份就是第三份真相，而价格的每一处不一致最终都只有用户能发现。
 */
import { PLANS } from "../src/lib/pricing.ts";
import { payInstructionFor } from "../src/lib/pay.ts";
import {
  listRecentOrders,
  confirmOrder,
  unconfirmOrder,
  getOrder,
} from "../src/lib/server/order-store.ts";

const DEFAULT_HOURS = 2;
const KNOWN_FLAGS = ["hours", "id", "undo", "help"];

/**
 * 渠道 id → 中文名。
 *
 * 从 pay.ts 的收款指令里反推，而不是在本脚本写一份 { wechat: "微信" }：
 * 那份映射与收款码图片名（`wechat-6.60.png`）绑在一起，将来加回支付宝时
 * 只改 pay.ts 一处，这里自动跟上。
 */
const PROVIDER_LABELS = Object.fromEntries(
  Object.keys(PLANS)
    .map((id) => payInstructionFor(id))
    .flatMap((inst) => (Array.isArray(inst.channels) ? inst.channels : []))
    .map((c) => [c.id, c.label])
);

class UsageError extends Error {}

/**
 * 终止信号，带退出码。
 *
 * **不用 `process.exit(1)`**：本脚本在 Windows 上实测过，只要先发过 HTTP 请求
 * （order-store 读库）再 `process.exit()`，libuv 会在退出时撞上
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，退出码变成 127 ——
 * 拒绝撤销的那次调用原本该是 1，却报 127，脚本里 `&&` 串联的逻辑会全部误判。
 * 改成设 exitCode 让事件循环自己收敛，实测干净退出且不到 0.2s。
 */
class Stop extends Error {
  constructor(code = 1) {
    super("stop");
    this.code = code;
  }
}

/**
 * 参数解析。与 gen-codes.mjs 同形（`--k v` 成对读），只多两件事：
 *   · 认无值开关（`--help`），否则 `--help` 会被当成"值缺失"而报错
 *   · 未知参数直接报错并打用法 —— 站长手滑打错一个字母时，
 *     静默忽略参数会让他以为"确认成功了"，而其实什么都没发生
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      throw new UsageError(`看不懂的参数「${key}」（参数都要以 -- 开头）`);
    }
    const name = key.slice(2);
    if (!KNOWN_FLAGS.includes(name)) {
      throw new UsageError(`未知参数「${key}」`);
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[name] = true; // 无值开关
      continue;
    }
    out[name] = next;
    i += 1;
  }
  return out;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`缺少环境变量 ${name}。请确认 .env.local 已配好 Supabase。`);
    throw new Stop(1);
  }
  return v;
}

// ── 显示工具 ────────────────────────────────────────────────

/**
 * 终端里中日韩字符占两格。不按它算宽度，"八字命理"与"月卡"后面的列就对不齐，
 * 而列表每天要看十几遍 —— 对齐本身就是可读性。
 * 范围就是常见的几个全角块：谚文、CJK 部首与汉字、CJK 兼容汉字、CJK 标点、
 * 全角字母数字。不引第三方 width 库：几十行的脚本不值得多一个依赖。
 */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

function displayWidth(s) {
  let n = 0;
  for (const ch of s) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

function pad(s, width) {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

/** 金额一律两位小数：`¥6.60` 与 `¥6.6` 在对账时看着像两回事。 */
const money = (n) => `¥${Number(n).toFixed(2)}`;

const shortId = (id) => id.slice(0, 8);

/** 本地时间 HH:MM。站长看的是墙上的钟，不是 UTC。 */
function clock(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const planName = (id) => PLANS[id]?.name ?? id;

const providerName = (id) => (id ? PROVIDER_LABELS[id] ?? id : "—");

/** 交易单号常是 28 位，全打出来会把后面的列挤没。 */
function shortRef(ref) {
  if (!ref) return "—";
  return ref.length > 16 ? `${ref.slice(0, 16)}…` : ref;
}

/** 状态列：既保留原始状态词（好 grep），又用中文标出下一步该干什么。 */
function statusLabel(o) {
  if (o.status === "paid") {
    if (o.deliveredAt) return "paid ·已交付";
    if (o.codeIssuedAt) return "paid ·已发码";
    return "paid ⚠未领取";
  }
  return o.status;
}

/** 「已付款但未领取」：付了钱，既没自动领到，也没来取码。 */
function isUnclaimed(o) {
  return o.status === "paid" && o.deliveredAt === null && o.codeIssuedAt === null;
}

const hoursText = (h) => String(Number(h.toFixed(2)));

function usage() {
  console.log(`用法（在仓库根目录）：
  node --import ./scripts/ts-loader.mjs --env-file=.env.local scripts/confirm-order.mjs
      列出最近 ${DEFAULT_HOURS} 小时的订单（默认）
  ... --hours 8
      改时间窗为最近 8 小时
  ... --id 8f3a
      确认到账。id 只要前缀够区分就行，通常 4 位就够
  ... --undo 8f3a
      撤销一次误确认（已交付/已发码的单会被拒绝）
  ... --help
      打这段用法

线上（服务器）把 --env-file 换成 deploy/.env.production。`);
}

// ── 前缀解析：宁可让站长多打两位，也不能替他猜 ────────────────

/**
 * 在前缀命中的候选里收敛到唯一一条。
 *
 * 匹配到多条时**必须停下来**：这一支确认下去，用户几秒后就开通了，
 * 而另一个人还在等 —— 猜错的代价是把权益发给错的设备。
 */
function resolvePrefix(orders, prefix) {
  const p = prefix.toLowerCase();
  const hits = orders.filter((o) => o.id.toLowerCase().startsWith(p));

  if (hits.length === 0) {
    console.error(`没找到以「${prefix}」开头的订单。`);
    console.error("可能已超出 --hours 范围，试试加大它（例如 --hours 24）。");
    throw new Stop(1);
  }

  if (hits.length > 1) {
    console.error(`「${prefix}」命中了 ${hits.length} 单，打更多位再来：\n`);
    for (const o of hits) {
      console.error(
        `  ${shortId(o.id)}  ${money(o.amount)}  ${pad(planName(o.plan), 10)}  ` +
          `${pad(statusLabel(o), 13)}  ${clock(o.createdAt)}`
      );
    }
    console.error(`\n（完整 id：${hits.map((o) => o.id).join(" / ")}）`);
    throw new Stop(1);
  }

  return hits[0];
}

// ── 三个动作 ────────────────────────────────────────────────

/** 列出最近订单，并主动告警「已付款但未领取」。 */
function list(orders, hours) {
  console.log(`最近 ${hoursText(hours)} 小时`);

  if (orders.length === 0) {
    console.log("  暂无订单");
  } else {
    for (const o of orders) {
      const channel = o.provider ? `${providerName(o.provider)} ${shortRef(o.payerRef)}` : "—";
      console.log(
        "  " +
          [
            clock(o.createdAt),
            pad(money(o.amount), 7),
            pad(planName(o.plan), 10),
            pad(channel, 20),
            pad(statusLabel(o), 13),
            shortId(o.id),
          ].join("  ")
      );
    }
  }

  // 这是告警不是统计：有人付了钱、既没自动领到也没来取码，很可能以为没成功就走了。
  // 判据严格照 brief：paid 且 deliveredAt 与 codeIssuedAt 都为空 ——
  // 已自动到账的单这两个时间戳必有一个，所以不会被误报进来。
  const unclaimed = orders.filter(isUnclaimed);
  if (unclaimed.length > 0) {
    console.log(`\n⚠ ${unclaimed.length} 笔已付款但未领取——用户付了钱没拿到东西，建议主动发码`);
    for (const o of unclaimed) {
      console.log(`  ${shortId(o.id)}  ${money(o.amount)}  ${planName(o.plan)}`);
    }
  }

  console.log("");
}

/** 确认到账。打印确认的是哪一单，让误操作立刻能被发现。 */
async function confirm(target) {
  const updated = await confirmOrder(target.id, "cli", null);
  if (!updated) {
    // 拿不到更新时**重新读一次**，而不是拿列表里的快照说事：
    // 快照是几百毫秒前读的，期间这单可能已被另一次确认（或用户自己领到了码）变成 paid，
    // 照着旧快照说"当前状态是 pending，确认不了"会把站长指向一个不存在的问题。
    const current = (await getOrder(target.id)) ?? target;
    if (current.status === "paid") {
      console.log(
        `该单已经是已确认状态，无需重复确认：\n` +
          `  ${shortId(current.id)}  ${money(current.amount)}  ${planName(current.plan)}  ${clock(current.createdAt)}`
      );
    } else {
      console.error(`确认失败：订单 ${shortId(current.id)} 当前状态是 ${current.status}，确认不了。`);
      throw new Stop(1);
    }
    return;
  }

  console.log(`已确认 ${shortId(updated.id)}`);
  console.log(
    `  ${money(updated.amount)}  ${planName(updated.plan)}  ` +
      `设备 ${(updated.deviceId ?? "—").slice(0, 8)}`
  );
  const channel = updated.provider
    ? `${providerName(updated.provider)} ${shortRef(updated.payerRef)}`
    : "—";
  console.log(`  ${channel}`);
  console.log("用户页面会在几秒内自动开通。若他早已关掉页面，让他在同一浏览器重新打开即可。");
}

/** 撤销确认。命中已交付/已发码时，说清楚为什么拒绝。 */
async function undo(target) {
  const updated = await unconfirmOrder(target.id);
  if (!updated) {
    // unconfirmOrder 返回 null 有两种含义，必须分清 —— 否则站长会以为"已经撤了"。
    const current = await getOrder(target.id);
    if (!current) {
      console.error(`撤销失败：库里已经没有订单 ${shortId(target.id)} 了。`);
      throw new Stop(1);
    }
    if (current.status !== "paid") {
      console.log(
        `无需撤销：该单当前是 ${current.status}，本来就没有可撤销的确认。\n` +
          `  ${shortId(current.id)}  ${money(current.amount)}  ${planName(current.plan)}`
      );
      return;
    }
    const why = current.deliveredAt
      ? `它已在 ${clock(current.deliveredAt)} 交付给用户，撤销会让用户正在用的权益凭空消失。`
      : `它已在 ${clock(current.codeIssuedAt)} 发出激活码，撤销会被那张已发出去的码打脸。`;
    console.error(
      `撤销被拒绝：\n  ${shortId(current.id)}  ${money(current.amount)}  ${planName(current.plan)}\n${why}`
    );
    console.error("确实要收回，只能去库里手工处理（并同步通知用户）。");
    throw new Stop(1);
  }

  console.log(`已撤销 ${shortId(updated.id)} 的确认`);
  console.log(
    `  ${money(updated.amount)}  ${planName(updated.plan)}  ` +
      `设备 ${(updated.deviceId ?? "—").slice(0, 8)}`
  );
  console.log("状态回到 pending。若是误撤，重新 --id 一次即可。");
}

// ── 入口 ────────────────────────────────────────────────────

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n`);
      usage();
      throw new Stop(1);
    }
    throw e;
  }

  // --help 必须在环境变量检查之前：他只是想看用法，不该因为没配库就被拦住。
  if (args.help) {
    usage();
    return;
  }

  if (args.id !== undefined && args.undo !== undefined) {
    console.error("--id 与 --undo 只能给一个。\n");
    usage();
    throw new Stop(1);
  }

  const hours = args.hours === undefined ? DEFAULT_HOURS : Number(args.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error(`--hours 必须是大于 0 的数（收到「${args.hours}」）`);
    throw new Stop(1);
  }

  // 别让空着的前缀掉进"命中一切"的分支里：那会打出一整屏候选。
  const raw = args.id !== undefined ? args.id : args.undo;
  const prefix = typeof raw === "string" ? raw.trim() : "";
  if (raw !== undefined && prefix.length < 2) {
    console.error("订单号前缀至少要 2 位（通常打 4 位就够区分了）");
    throw new Stop(1);
  }

  // 环境变量要先检查：order-store 在没配 Supabase 时会静默走内存兜底，
  // 那样列表永远是"暂无订单"、确认永远失败，而错误信息一个字都不会提配置。
  requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  // 只查一次：三个动作都在这同一个时间窗里找单，查两遍可能落在不同的窗口边界上。
  const orders = await listRecentOrders(hours * 3600_000);

  if (args.id !== undefined) return confirm(resolvePrefix(orders, prefix));
  if (args.undo !== undefined) return undo(resolvePrefix(orders, prefix));
  return list(orders, hours);
}

main().catch((e) => {
  if (e instanceof Stop) {
    // 报错文案早就在各自的分支里打过了，这里只负责退出码。
    process.exitCode = e.code;
    return;
  }
  console.error(`出错：${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
