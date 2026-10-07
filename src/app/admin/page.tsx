import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Seal } from "@/components/Glyph";
import { payInstructionFor } from "@/lib/pay";
import { isPlanId, PLANS } from "@/lib/pricing";
import { checkAdmin } from "@/lib/server/admin-guard";
import { listRecentOrders, type OrderRow } from "@/lib/server/order-store";

/**
 * 订单确认页 —— 站长（非技术人员）在**手机上**打开的那一页。
 *
 * ## 为什么有这个页面
 *
 * 付费是"零支付资质"方案：扫个人微信收款码、**没有回调**，所以"确认到账"是
 * 整条链路上唯一的人工环节。原先这件事由 scripts/confirm-order.mjs 做，但站长的
 * 电脑连不上 Supabase（实测 fetch failed），命令行脚本他跑不了。
 * 于是这个页面存在的全部理由就是：**手机浏览器打开、点一下、用户几秒后开通**。
 *
 * ## 形态
 *
 * 服务端组件 + 原生表单 POST（不是 Server Action）。选它有两个硬理由：
 *   · 手机上没有 JS 也要能用。`<form method="post">` 是浏览器原生能力，
 *     不经过任何客户端脚本 —— 弱网、省电模式、脚本被拦，都还能确认到账。
 *   · 确认这一步用 curl 就能完整复现（POST 一个表单体），验证不依赖
 *     复刻 Next 的 Server Action 协议（那玩意儿换个版本就变）。
 *
 * ## 密钥怎么传（`?key=`）
 *
 * 密钥走 query string，因为站长的使用场景是**把它存成书签、点一下就用** ——
 * 每次在手机键盘上敲 43 位 base64url 是不现实的，而"存进 localStorage 再自动带上"
 * 会让密钥落进浏览器里任何脚本都能读到的地方。
 *
 * query string 的唯一代价是 Referer 可能把它带给第三方。本页的应对是三层的：
 *   1. 下面的 `metadata.referrer = "no-referrer"`（本页会加载站点的样式表，
 *      样式表里有一条 Google Fonts 的 @import —— 少了它，拉字体时浏览器可能把
 *      `Referer: …/admin?key=…` 发给 fonts.googleapis.com）
 *   2. next.config.mjs 里给 /admin 补的 `Referrer-Policy: no-referrer` 响应头
 *      （响应头比 meta 更强，且覆盖导航本身）
 *   3. 本页**不引用任何外部资源**，所有跳转/表单都是同源的
 *
 * 密钥只以两种形式离开服务端：写进确认表单的 hidden input（同源 POST），
 * 以及"刷新"链接。两处都带 `rel="noreferrer"`。
 *
 * ## 它不签发权益
 *
 * 权益唯一载体是 HMAC 签名的 `xj_pass` cookie，且只能由"服务端的原子授权"签发
 * （redeem 凭核销掉的激活码、/api/order/status 凭抢占到的交付权）。
 * 本页只把订单状态改成 paid —— 改完之后，用户页面自己轮询到账并领取。
 * 换句话说：**这个页面没有任何"造权益"的能力**，最坏情况是把某一单标成已付。
 */

// 永远不静态化：订单状态每次都要现读，而且密钥在 URL 里，任何一层缓存
// 都可能把别人的订单（甚至带密钥的响应）端给下一个人。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "订单确认",
  // 索引类的约定：内部工具页，不进搜索引擎，也不缓存
  robots: { index: false, follow: false },
  // 见上方"密钥怎么传"——这一行是"密钥放 URL"这个设计能被接受的前提
  referrer: "no-referrer",
};

/** 时间窗：最近 24 小时。与 `confirm-order.mjs --hours 24` 同口径。 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 渠道 id → 中文名。从 pay.ts 的收款指令里反推，**不在本页写一份 { wechat: "微信" }**：
 * 那份映射与收款码图片名（`wechat-6.60.png`）绑在一起，将来加回支付宝时只改 pay.ts 一处。
 * 与 scripts/confirm-order.mjs 同一取向。
 */
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(PLANS)
    .map((p) => payInstructionFor(p.id))
    .flatMap((inst) => (inst.kind === "qr" ? inst.channels : []))
    .map((c) => [c.id, c.label])
);

/**
 * 套餐中文名一律取自 pricing.ts 的 PLANS，本页不另写一份 ——
 * 另写一份就是第二份真相，改价或改名时它会先烂掉，而页面上的名字与价格
 * 正是站长对账时唯一能跟用户对得上的东西。
 */
function planName(id: string): string {
  return isPlanId(id) ? PLANS[id].name : id;
}

const money = (n: number) => `¥${Number(n).toFixed(2)}`;

/**
 * 时间按**北京时间**显式渲染，不靠服务器的本地时区。
 *
 * 容器默认是 UTC（deploy/Dockerfile 没设 TZ），用 getHours() 会把 14:32 显示成
 * 06:32 —— 而站长看这一列是为了跟微信的到账时间对上，差 8 小时的对账表比没有更坏。
 * 先加 8 小时再读 UTC 字段，就是北京墙上那个钟；usage-store 的 today() 同取向。
 */
function clock(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 渠道 + 用户提交的交易单号。没提交过就明说"未提交"，别让人以为那一栏是空的。 */
function channelText(o: OrderRow): string {
  const label = o.provider ? PROVIDER_LABELS[o.provider] ?? o.provider : "未选择渠道";
  const ref = o.payerRef ? o.payerRef : "未提交交易单号";
  return `${label} · ${ref}`;
}

function statusText(o: OrderRow): string {
  if (o.status === "paid") {
    if (o.deliveredAt) return "已到账 · 已交付";
    if (o.codeIssuedAt) return "已到账 · 已发码";
    return "已到账 · 未领取";
  }
  if (o.status === "expired") return "已过期";
  return "待确认";
}

function statusClass(o: OrderRow): string {
  if (o.status === "paid") {
    return o.deliveredAt || o.codeIssuedAt ? "text-jade-400" : "text-vermillion-300";
  }
  if (o.status === "expired") return "text-paper-100/55";
  return "text-gold-300";
}

/**
 * 「已付款但未领取」：付了钱，既没自动领到、也没来取码。
 *
 * 判据严格照 brief：paid 且 deliveredAt 与 codeIssuedAt **都**为空。
 * 已自动到账的单这两个时间戳必有一个，所以不会误报进来。
 * 这一块是整页最该被看见的东西 —— 它的人正在以为"付了钱没反应"，
 * 而等他自己来问的时候，差评已经写好了。
 */
function isUnclaimed(o: OrderRow): boolean {
  return o.status === "paid" && o.deliveredAt === null && o.codeIssuedAt === null;
}

/** 状态只读展示用的那几行（id 前 8 位 + 渠道单号 + 套餐）。 */
function OrderMeta({ order }: { order: OrderRow }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-base tabular-nums text-paper-100/90">{clock(order.createdAt)}</span>
        <span className="text-lg font-semibold text-gold-300">{money(order.amount)}</span>
        <span className={`ml-auto text-[13px] ${statusClass(order)}`}>{statusText(order)}</span>
      </div>
      <div className="mt-1 text-[15px] text-paper-100/85">{planName(order.plan)}</div>
      <div className="mt-0.5 break-all text-[13px] text-paper-100/60">
        {channelText(order)}
      </div>
      {/* id 只给前 8 位：站长手上要的是"能对上命令行 / 能报给用户"的那个短号 */}
      <div className="mt-0.5 font-mono text-[12px] text-paper-100/50">{order.id.slice(0, 8)}</div>
    </>
  );
}

/**
 * 一单：信息 + 大按钮。
 *
 * 按钮是**整行宽**的（`.btn-primary` 自带 14px 纵向内边距，够高），
 * 因为这一页主要在手机上用，而"点歪"的代价是把权益发给错的单。
 */
function OrderCard({ order, adminKeyValue }: { order: OrderRow; adminKeyValue: string }) {
  const confirmable = order.status === "pending" || order.status === "expired";
  return (
    <li className="rounded border border-gold-500/20 bg-mystic-900/60 p-3">
      <OrderMeta order={order} />
      {confirmable && (
        <form action="/api/admin/confirm" method="post" className="mt-3">
          {/* 密钥走表单体，不走 URL —— POST 的地址栏里不会留下它 */}
          <input type="hidden" name="key" value={adminKeyValue} />
          <input type="hidden" name="id" value={order.id} />
          <button type="submit" className="btn-primary w-full">
            确认到账
          </button>
        </form>
      )}
    </li>
  );
}

/** 确认结果 / 失败原因的回显文案。文案要能把"下一步该干什么"说清楚。 */
function notice(ok: string | undefined, err: string | undefined): { text: string; tone: string } | null {
  const bad = "border-vermillion-500/45 bg-vermillion-700/15 text-paper-100/85";

  // ok / err 都是 URL 参数，等于**可被外部指定的一段文本**。
  // 虽然 React 会把它们当纯文本渲染（没有 XSS），但把任意文本回显成系统提示，
  // 是给"伪造一条看起来像系统说的话"留了口子 —— 而这条横幅是说给站长听的。
  // 所以只认自己发的形状：ok 是本页回传的订单 id 前 8 位（小写十六进制 + 连字符）。
  if (ok !== undefined && /^[0-9a-f-]{1,8}$/.test(ok)) {
    return {
      text: `已确认 ${ok}。用户页面通常几秒内自动开通；若他早已关掉页面，让他在同一浏览器重新打开即可。`,
      tone: "border-jade-400/40 bg-jade-700/15 text-paper-100/85",
    };
  }
  if (err === "notfound") {
    return {
      text: "确认失败：没找到这一单，或它当前的状态不允许确认（只接受待确认与已过期）。刷新看看最新状态。",
      tone: bad,
    };
  }
  if (err === "unavailable") {
    return {
      text: "确认失败：数据层暂时不可用，这一单没有被改动。稍后重试。",
      tone: bad,
    };
  }
  if (err === "badid") {
    return {
      text: "确认失败：这次请求没带对订单号。刷新后重新点一次。",
      tone: bad,
    };
  }
  return null;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rawKey = searchParams?.key;
  const key = typeof rawKey === "string" ? rawKey : null;

  // 准入判定在**读任何订单之前**。判定不过就当这个页面不存在（404）——
  // 403 等于确认"页面在这儿，只是你没钥匙"，那正是 brief 里点名要避免的。
  const verdict = await checkAdmin({ headers: headers() }, key);
  if (!verdict.ok) notFound();

  // 到这里 key 一定是正确的密钥（verdict 已经比过），可以放进表单里。
  const adminKeyValue = key as string;
  const okParam = typeof searchParams?.ok === "string" ? searchParams.ok : undefined;
  const errParam = typeof searchParams?.err === "string" ? searchParams.err : undefined;
  const banner = notice(okParam, errParam);

  let orders: OrderRow[];
  try {
    orders = await listRecentOrders(WINDOW_MS);
  } catch (err) {
    // 读库失败不该长成一个带堆栈的 500：站长看不懂 500，而"稍后重试"是他能做的全部。
    console.error("[admin] 读取订单列表失败:", err);
    return (
      <Shell>
        <p className="rounded border border-vermillion-500/45 bg-vermillion-700/15 p-4 text-[15px] text-paper-100/85">
          读取订单失败：数据层暂时不可用。稍后下拉刷新重试；若一直如此，检查服务器的
          Supabase 配置。
        </p>
      </Shell>
    );
  }

  // 默认视图：24 小时内 pending / paid（照 brief）。已过期的单单独放最后一段 ——
  // 见下方"为什么过期的单也要列出来"。
  const active = orders.filter((o) => o.status === "pending" || o.status === "paid");
  const expired = orders.filter((o) => o.status === "expired");
  const unclaimed = active.filter(isUnclaimed);

  return (
    <Shell>
      <header className="mb-5 flex items-center gap-3">
        <Seal char="确" size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl text-gold" style={{ fontFamily: "var(--font-display)" }}>
            订单确认
          </h1>
          <p className="mt-0.5 text-[13px] text-paper-100/55">
            最近 24 小时 · 待确认与已到账共 {active.length} 单
          </p>
        </div>
        {/* 刷新是同一页的导航。带 noreferrer，别让浏览器顺手把密钥放进 Referer */}
        <a
          href={`/admin?key=${encodeURIComponent(adminKeyValue)}`}
          rel="noreferrer"
          className="btn-mystic"
        >
          刷新
        </a>
      </header>

      {banner && (
        <p className={`mb-5 rounded border p-3 text-[14px] leading-relaxed ${banner.tone}`}>
          {banner.text}
        </p>
      )}

      {unclaimed.length > 0 && (
        <section className="mb-6 rounded border border-vermillion-500/45 bg-vermillion-700/15 p-4">
          <div className="flex items-start gap-3">
            <Seal char="未领" size={44} />
            <div className="min-w-0">
              <h2 className="text-base text-vermillion-300">
                已付款但未领取 · {unclaimed.length} 笔
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-paper-100/70">
                钱已经到账，用户却没有拿到解读或激活码。他很可能以为付款失败了 ——
                这是差评与退款的来源，建议主动发码或联系。
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {unclaimed.map((o) => (
              <li
                key={o.id}
                className="rounded border border-vermillion-500/25 bg-mystic-950/50 p-3"
              >
                <OrderMeta order={o} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[15px] text-paper-100/70">待确认与已到账</h2>
        {active.length === 0 ? (
          <p className="rounded border border-gold-500/15 bg-mystic-900/40 p-4 text-[14px] text-paper-100/55">
            最近 24 小时没有订单。
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((o) => (
              <OrderCard key={o.id} order={o} adminKeyValue={adminKeyValue} />
            ))}
          </ul>
        )}
      </section>

      {/*
        * 为什么过期的单也要列出来（这一段是 brief"默认显示 pending 或 paid"之外的补充）：
        *
        * 订单 30 分钟过期（ORDER_TTL_MINUTES），而"用户看到收款码、打开微信、付款"
        * 完全可能超过 30 分钟。那笔钱是真付了，但单已经变成 expired ——
        * 若不列出来，站长在这一页上永远看不到它，只能靠用户来找他。
        * 而 confirm_order 本来就接受 expired（数据库函数里就是
        * `where status in ('pending','expired')`，脚本的 --id 也一样），
        * 不列出来等于把这条已有的能力藏掉。
        *
        * 放在最后、且与上面的列表分开，是为了不把"待确认"的事混进一锅 ——
        * 默认要看的东西仍在最上面。
        */}
      {expired.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-[15px] text-paper-100/70">已过期 · {expired.length} 单</h2>
          <p className="mb-3 text-[13px] text-paper-100/55">
            超过 30 分钟未确认的单。用户超时后才付款是真实情况，核对流水后同样可以确认到账。
          </p>
          <ul className="space-y-3">
            {expired.map((o) => (
              <OrderCard key={o.id} order={o} adminKeyValue={adminKeyValue} />
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

/**
 * 页面外壳。
 *
 * 刻意**不带页头 / 页脚**：这是内部工具，不是站点内容页；少一次导航就少一次
 * 把 `?key=` 带出去的机会，手机上也能少划一屏。
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div className="ink-bg" />
      <main className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-16 pt-8">{children}</main>
    </div>
  );
}
