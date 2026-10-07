import { NextRequest, NextResponse } from "next/server";
import { ADMIN_CONFIRM_BY, checkAdmin } from "@/lib/server/admin-guard";
import { confirmOrder } from "@/lib/server/order-store";

/**
 * 确认到账。站长在 /admin 上点一下「确认到账」，打的就是这里。
 *
 * ## 为什么是一个路由 + 原生表单 POST，而不是 Server Action
 *
 *   1. **没有 JS 也要能用。** 表单是浏览器原生能力，弱网、省电模式、
 *      脚本被拦都还能确认到账 —— 而这台手机要干的事就是把钱认下来。
 *   2. **能用 curl 完整复现。** 服务端动作要复刻 Next 的 `Next-Action` 协议，
 *      而那个协议换个版本就变；表单体不会。
 *
 * ## 安全上有四条必须一起看，缺一条这套就不成立
 *
 *   · **不放行一律 404，不是 403。** 403 等于确认"这个接口存在，只是你没钥匙"，
 *     那就把它变成了一个可以反复试探的靶子。仓库里已有同样的约定
 *     （见 app/api/order/status/route.ts 的设备不匹配分支）。
 *   · **判定在 admin-guard 里，与页面共用同一份**（缺密钥 / 密钥错 / 失败超限都在那边）。
 *   · **本文件不打印任何请求内容。** 密钥就躺在表单体里，
 *     一句 `console.error(req)` 或带上 URL 的日志就能把它漏出去。
 *   · **它只改订单状态，不签发权益。** 权益唯一载体仍是 HMAC 签名的 xj_pass cookie，
 *     由用户自己的页面轮询到账后领取 —— 这里没有"造权益"的能力。
 */

// 用了 node:crypto（常量时间比较）；且绝不能静态化
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 「页面不存在」的响应。
 *
 * 空体 + 404：连一个字都不回，避免任何"这个路径有点名堂"的线索。
 * 路由自己会带上 x-robots-tag: noindex（见 next.config.mjs 的 /admin 段）。
 */
function notFoundResponse(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

/**
 * 表单体上限。
 *
 * 这个接口的真实请求体只有两个短字段（密钥 ~43 字节 + 订单 id 36 字节）。
 * 而 `formData()` 会把整个请求体读进内存 —— 在密钥被验证之前就读。
 * 也就是说，没有这道检查的话，一个连密钥都没有的人也能让我们为它分配内存。
 *
 * 它能挡住的是"声明了大 body"的请求；**chunked 传输没有 content-length**，
 * 真正的上限仍要靠反向代理或平台。这里只是把最省事的那种滥用先挡在门外。
 */
const MAX_BODY_BYTES = 4096;

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return notFoundResponse();
  }

  // 表单体解析失败（不是表单、被截断）时也走"不存在"：能到这个页面的只有
  // 浏览器表单，解析不了说明这不是一次正常的确认动作。
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return notFoundResponse();
  }

  const rawKey = form.get("key");
  const key = typeof rawKey === "string" ? rawKey : null;

  // 准入：缺 ADMIN_KEY / 密钥不对 / 该 IP 今日失败超限 —— 全部在这里拦下。
  // **注意它发生在解析订单号之前**，也是唯一会被记入失败计数的地方。
  const verdict = await checkAdmin({ headers: req.headers }, key);
  if (!verdict.ok) return notFoundResponse();

  const rawId = form.get("id");
  if (typeof rawId !== "string" || rawId.length === 0) {
    return redirectBack(req, key as string, { err: "badid" });
  }

  let updated;
  try {
    // `by` 传固定标识而不是 "admin" 之类：日后对账时，"页面点的"与
    // 命令行 `--id` 确认的（confirm-order.mjs 传 "cli"）必须能区分开 ——
    // 两条路径出问题时的排查方向完全不同。
    //
    // provider 传 null：这一列是**用户声称的渠道**（见 order-store.setPayerRef），
    // 页面确认不改变它。confirm_order 的 coalesce 也保证了空值不会覆盖已有渠道。
    updated = await confirmOrder(rawId, ADMIN_CONFIRM_BY, null);
  } catch (err) {
    // 异常里可能带数据库的报错文本，但绝不会带密钥 —— confirmOrder 只收到订单号。
    // 与下面的 `!updated` 分开报：一个是"库连不上"，一个是"这一单现在确认不了"，
    // 站长要采取的动作不同（等一等 vs 刷新看一眼），文案必须说得出是哪一种。
    console.error("[admin] 确认订单失败:", err);
    return redirectBack(req, key as string, { err: "unavailable" });
  }

  if (!updated) {
    // 拿不到行的两种含义在这里合流了（订单不存在 / 状态不允许），
    // 页面文案也照同一个口径写：让它刷新看最新状态，而不是猜是哪一种。
    // 多半是并发双击：第一次已经把它改成 paid 了。
    return redirectBack(req, key as string, { err: "notfound" });
  }

  // PRG：POST 之后重定向回页面（303），否则用户一刷新就会重发一次确认。
  // 目标 URL 带密钥 —— 这是同源的 GET，且全站对 /admin 关掉了 referrer。
  return redirectBack(req, key as string, { ok: updated.id.slice(0, 8) });
}

/**
 * 回到确认页，带一条结果。
 *
 * 用 303（See Other）而不是 302/307：303 明确要求浏览器改用 GET ——
 * 这正是 PRG 想要的，也避免某些客户端把 POST 原样重放到 /admin。
 */
function redirectBack(
  req: NextRequest,
  key: string,
  params: { ok?: string; err?: string }
): NextResponse {
  const back = req.nextUrl.clone();
  back.pathname = "/admin";
  back.search = "";
  back.searchParams.set("key", key);
  if (params.ok) back.searchParams.set("ok", params.ok);
  if (params.err) back.searchParams.set("err", params.err);
  return NextResponse.redirect(back, 303);
}
