"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect, useCallback } from "react";
import { Seal } from "./Glyph";
import { useDialog } from "./useDialog";
import { CONTACT_EMAIL } from "@/lib/contact";
import { PLANS, type PlanId } from "@/lib/pricing";
import { refreshEntitlement } from "@/lib/entitlements";
import type { PayInstruction } from "@/lib/pay";

/** 收款码指令。redirect（将来的聚合支付）那一支接缝留着，弹窗暂不处理。 */
type QrInstruction = Extract<PayInstruction, { kind: "qr" }>;

interface Order {
  orderId: string;
  /** 金额由服务端从 PLANS 取出后回传 —— **前端一个字都不算**，见 /api/order。 */
  amount: number;
  instruction: QrInstruction;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 买哪个计划。金额不从这里传 —— 由服务端按 PLANS 决定。 */
  plan: PlanId;
  /**
   * 兑换激活码。返回 null 表示成功，否则返回给用户看的错误文案。
   *
   * 刻意由调用方注入而不是在这里 fetch：兑换成功后会员页与排盘表单要做的
   * 善后不同（一个留在本页、一个直接开算），把善后留在调用方更清楚。
   */
  onRedeem: (code: string) => Promise<string | null>;
  /** 已解锁时打开这个弹窗，直接展示状态而不是再要一次码 */
  alreadyUnlocked?: boolean;
}

/** 弹窗内的可聚焦元素。与 useDialog 里那份同一形状。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 付费与解锁。
 *
 * 这里**没有任何「我已付款」的按钮**。原先有一个，点一下就 setMember(true)
 * 写进 localStorage —— 那等于把解锁权交给了用户自己的浏览器。现在唯一的
 * 前进方式是服务端认可的两条路：订单到账（本页自动开通），或一枚服务端
 * 能核销的激活码。
 *
 * 付款这一侧刻意做成"金额由服务端锁定"：收款码是**带固定金额**的，扫码后
 * 金额已填好。用户不需要（也无法）手输金额，页面标多少就付多少。
 */
export default function PaymentModal({
  open,
  onClose,
  title,
  plan,
  onRedeem,
  alreadyUnlocked = false,
}: Props) {
  const [step, setStep] = useState<"loading" | "pay" | "code" | "done">("loading");
  const [order, setOrder] = useState<Order | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  // 建单失败后的重试计数。它只是给下面那条 effect 一个"再跑一次"的信号。
  const [attempt, setAttempt] = useState(0);
  const [claimOpen, setClaimOpen] = useState(false);
  const [payerRef, setPayerRef] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [fetchCodeError, setFetchCodeError] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  // 收款码是站长的外部资源，缺失时给出可读的占位，而不是一个碎图标。
  // 按渠道记：渠道集合是可变的，一个渠道裂图不该把别的渠道也一起抹掉。
  const [qrFailed, setQrFailed] = useState<Record<string, boolean>>({});
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * 这一次「已解锁」是不是靠订单到账自动开出来的。
   *
   *   · true  —— 轮询看到 paid，权益由服务端就地签发。此时订单**一定**已付款，
   *              所以"换设备点获取激活码"这条路走得通，"本机已自动开通"也是真的。
   *   · false —— 靠激活码（可能是别的设备上买的那枚）兑换进来的，或者本来就已经是
   *              会员。这两种情况下手里那个订单压根没付款，取码只会回"尚未到账"。
   *
   * 不区分这两者，文案就会对着一个没付款的订单说"本机已自动开通"，并且摆出一个
   * 按下去必然报错的按钮 —— 那正是这一步最该避免的误导。
   */
  const [autoUnlocked, setAutoUnlocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 从哪一步进的激活码页 —— 「返回」要退回去，而不是一律退回付款页
  const codeFromRef = useRef<"pay" | "done">("pay");

  const handleClose = useCallback(() => {
    setStep("loading");
    setError(null);
    onClose();
  }, [onClose]);

  // Esc 关闭、Tab 锁在弹窗内、关闭后把焦点还回去
  const dialogRef = useDialog(open, handleClose);

  // 打开时建单。金额、收款渠道、二维码地址全部来自服务端这一条响应。
  useEffect(() => {
    if (!open) return;
    if (alreadyUnlocked) {
      setStep("done");
      return;
    }
    let cancelled = false;
    setStep("loading");
    setPayError(null);
    setOrder(null);
    setClaimNotice(null);
    setClaimError(null);
    setFetchCodeError(null);
    setQrFailed({});
    setCode("");
    setError(null);
    setPayerRef("");
    setProvider(null);
    setAutoUnlocked(false);

    (async () => {
      try {
        const res = await fetch("/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.success) {
          setPayError(data?.error ?? "下单失败，请稍后重试");
          setStep("pay");
          return;
        }
        if (data.instruction?.kind !== "qr") {
          setPayError("支付方式暂不可用，请联系站长");
          setStep("pay");
          return;
        }
        setOrder({
          orderId: data.orderId,
          amount: data.amount,
          instruction: data.instruction,
        });
        setStep("pay");
      } catch {
        if (cancelled) return;
        setPayError("网络连接失败，请稍后重试");
        setStep("pay");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, alreadyUnlocked, plan, attempt]);

  /*
   * 轮询到账。
   *
   * 只在弹窗开着、已建单、且还没到期(done)时跑。到账即停 —— 权益由服务端
   * 在那次响应里签发 cookie，这里只负责把界面翻到"已解锁"并刷新一次前端缓存。
   *
   * 用户切到激活码页时不抢走他：那种情况下订单早已到账（否则取不到码），
   * 再翻页只会把他正在复制的码盖掉。
   */
  useEffect(() => {
    if (!open || !order || step === "done") return;
    let stopped = false;

    const timer = setInterval(async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/order/status?id=${encodeURIComponent(order.orderId)}`);
        const data = await res.json().catch(() => null);
        if (stopped || !res.ok || !data?.success) return;
        if (data.status === "paid") {
          stopped = true;
          clearInterval(timer);
          setAutoUnlocked(true);
          // 上一步可能留了一条取码失败的提示（"该订单尚未到账"）。那时候确实没到账，
          // 现在到账了，那条提示就成了假话，必须撤掉。
          setFetchCodeError(null);
          if (step === "pay") setStep("done");
          await refreshEntitlement();
        }
      } catch {
        // 轮询失败静默重试 —— 弹错误只会打扰正在付款的人
      }
    }, 4000);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, order, step]);

  /*
   * 换步之后把焦点收回弹窗。
   *
   * useDialog 只在**打开那一刻**把焦点移进来。而 loading → pay 这一步是自动的
   * （建单返回即翻页），它会卸载掉刚刚拿到焦点的那个按钮，焦点随即掉回 body ——
   * 此时 aria-modal="true" 承诺的"焦点锁在里面"就是空话了，Tab 能直接溜到背后
   * 的页面上。所以每次换步都重新聚焦弹窗内的第一个可聚焦元素。
   *
   * 激活码页除外：那一页要的是输入框，由下面那条 effect 负责。
   */
  useEffect(() => {
    if (!open || step === "code") return;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open, step]);

  useEffect(() => {
    if (step === "code") inputRef.current?.focus();
  }, [step]);

  const channels = order?.instruction.channels ?? [];
  // 渠道集合当前只有一个（微信），但**不写死个数也不写死名字** ——
  // 每项都用 c.label 显示，加回支付宝时这里一行都不用改。
  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? channels[0] ?? null;
  const qrLabel = activeChannel?.label ?? "收款";
  // 只有一个收款渠道时不摆任何切换 UI，也不摆渠道选择按钮：他没有别的渠道可付
  const claimProvider = provider ?? (channels.length === 1 ? channels[0]?.id ?? null : null);

  const handleRedeem = async () => {
    setError(null);
    setBusy(true);
    try {
      const message = await onRedeem(code);
      if (message) {
        setError(message);
      } else {
        setCode("");
        // 这一条不是订单到账开的，不许说"本机已自动开通"
        setAutoUnlocked(false);
        setFetchCodeError(null);
        setStep("done");
      }
    } finally {
      setBusy(false);
    }
  };

  /** 跨设备兜底：把已到账的订单换成一枚激活码，拿去另一台设备用。 */
  const handleFetchCode = async (from: "pay" | "done") => {
    if (!order) return;
    codeFromRef.current = from;
    setFetchCodeError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/order/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setFetchCodeError(data?.error ?? "获取失败，请稍后重试");
        return;
      }
      setCode(data.code);
      setStep("code");
    } catch {
      setFetchCodeError("网络连接失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 提交交易单号。
   *
   * 它**不会**开通任何东西 —— 个人收款码没有可查询的接口，服务端无从判断这串
   * 数字真假。它的作用是给站长对账时一个锚点。文案必须说清楚这一点。
   */
  const handleClaim = async () => {
    if (!order) return;
    setBusy(true);
    setClaimError(null);
    setClaimNotice(null);
    try {
      const res = await fetch("/api/order/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          payerRef: payerRef.trim(),
          provider: claimProvider,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setClaimError(data?.error ?? "提交失败，请稍后重试");
        return;
      }
      setClaimNotice(data.notice ?? "已提交");
    } catch {
      setClaimError("网络连接失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative mystic-card rounded-xl p-8 max-w-md w-full text-center my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {step === "loading" && (
              <>
                <div className="flex justify-center mb-4"><Seal char="缘" size={48} /></div>
                <h3
                  className="text-xl text-gold mb-3"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  {title}
                </h3>
                <p className="text-paper-100/55 text-sm mb-6">正在准备收款码…</p>
                <button
                  onClick={handleClose}
                  className="text-paper-100/45 hover:text-paper-100 text-xs transition-colors"
                >
                  取消
                </button>
              </>
            )}

            {step === "pay" && (
              <>
                <div className="flex justify-center mb-4"><Seal char="缘" size={48} /></div>
                <h3
                  className="text-xl text-gold mb-2"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  {title}
                </h3>

                {order ? (
                  <>
                    <div className="price-tag justify-center">
                      <span className="symbol">¥</span>
                      <span className="amount">{order.amount.toFixed(2)}</span>
                    </div>
                    <p className="text-paper-100/45 text-[11px] mb-4">{PLANS[plan].name}</p>

                    <div className="bg-white rounded-lg p-3 mb-3 mx-auto flex flex-col items-center">
                      {/* 多个渠道才需要切换；只有一个时这一段整个不渲染 */}
                      {channels.length > 1 && (
                        <div className="flex gap-1.5 mb-2">
                          {channels.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => setActiveChannelId(c.id)}
                              className={`px-3 py-1 rounded text-xs transition-colors ${
                                c.id === activeChannel?.id
                                  ? "bg-gray-800 text-white"
                                  : "text-gray-600 border border-gray-300"
                              }`}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {activeChannel ? (
                        <>
                          <p className="text-gray-800 text-xs mb-2 font-semibold">
                            请用「{activeChannel.label}」扫一扫
                          </p>
                          {qrFailed[activeChannel.id] ? (
                            <div className="w-60 h-60 flex items-center justify-center rounded border border-dashed border-gray-300 px-4 text-center">
                              <span className="text-gray-400 text-xs leading-relaxed">
                                收款码暂未就绪
                                <br />
                                请稍后再试
                              </span>
                            </div>
                          ) : (
                            <>
                              {/*
                                收款码是纯二维码方图，不是整张竖版海报。

                                海报缩到 208px 宽之后二维码实际只有约 180px，拿手机
                                对着电脑屏幕扫很勉强；裁成方图之后同样的宽度下二维码
                                大了 44%。裁图还顺带去掉海报上印的收款人显示名与地区
                                —— 那等于向所有访客公开。

                                微信收款码可以设固定金额，所以**金额直接印在码里**，
                                用户不需要手输。金额不匹配时宁可显示"暂未就绪"，
                                也不要出现"页面标 6.6、扫码付出 6.9"。
                              */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={activeChannel.qrSrc}
                                alt={`${activeChannel.label}收款码`}
                                className="w-60 h-60 sm:w-64 sm:h-64 rounded"
                                onError={() =>
                                  setQrFailed((m) => ({ ...m, [activeChannel.id]: true }))
                                }
                              />
                              {/* 金额已印在码里，所以这里不再是"请手动输入 ¥X" */}
                              <p className="text-gray-500 text-[11px] mt-2 font-medium">
                                扫码即可，金额已为你填好 ¥{order.amount.toFixed(2)}
                              </p>
                            </>
                          )}
                        </>
                      ) : (
                        <div className="w-60 h-60 flex items-center justify-center rounded border border-dashed border-gray-300 px-4 text-center">
                          <span className="text-gray-400 text-xs leading-relaxed">
                            收款码暂未就绪
                            <br />
                            请稍后再试
                          </span>
                        </div>
                      )}
                    </div>

                    <p className="text-paper-100/45 text-[11px] leading-relaxed mb-4">
                      手机端：长按图片 → 识别图中二维码
                    </p>

                    {/*
                      交付说明。

                      这一段是整个付费流程里**最容易让用户卡住**的地方。此前是
                      "付款 → 截图 → 发邮件 → 等激活码"，一共四步、且每一步都要用户
                      做事；现在付款之后本页就会自己开通，用户什么都不用做。

                      所以只留三步，并明确写出金额是**已经填好的**：固定金额的收款码
                      扫码即带上钱数，手改反而会与页面对不上。
                    */}
                    <div className="text-left rounded-lg border border-gold-300/20 bg-mystic-900/40 px-4 py-3.5 mb-4">
                      <p className="text-paper-100/70 text-xs mb-2.5 tracking-wider">
                        付款后如何拿到解读
                      </p>
                      <ol className="space-y-2">
                        {[
                          `用「${qrLabel}」扫码付款，金额已填好，勿修改`,
                          "到账后本页自动开通，无需截图、无需发邮件",
                          "换了设备才需要点下方「获取激活码」",
                        ].map((text, i) => (
                          <li key={text} className="flex items-start gap-2.5">
                            <span className="mt-px shrink-0 w-4 h-4 rounded-full bg-gold-400/15 text-gold-300 text-[10px] leading-4 text-center">
                              {i + 1}
                            </span>
                            <span className="text-paper-100/65 text-xs leading-relaxed">{text}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    {/* 交易单号是**对账线索**，不是开通手段。所以折叠在最下面，
                        且文案直说"提交不会立刻开通" —— 说成"稍后开通"会让用户
                        以为付完就完事了。 */}
                    <div className="text-left rounded-lg border border-gold-300/20 bg-mystic-900/40 px-4 py-2.5 mb-5">
                      <button
                        type="button"
                        onClick={() => setClaimOpen((v) => !v)}
                        aria-expanded={claimOpen}
                        className="w-full flex items-center justify-between gap-2 text-paper-100/70 hover:text-paper-100 text-xs transition-colors"
                      >
                        <span>我已付款，提交交易单号（选填）</span>
                        <span className="text-paper-100/45 shrink-0">
                          {claimOpen ? "收起" : "展开"}
                        </span>
                      </button>

                      {claimOpen && (
                        <div className="mt-3 space-y-2.5">
                          <input
                            value={payerRef}
                            onChange={(e) => {
                              setPayerRef(e.target.value);
                              setClaimError(null);
                            }}
                            placeholder="交易单号"
                            aria-label="交易单号"
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full bg-mystic-950/60 border border-gold-300/25 rounded-lg px-3 py-2 text-sm text-paper-100/90 placeholder:text-paper-100/45 focus:border-gold-400/60 focus:outline-none focus:ring-1 focus:ring-gold-400/30 transition-colors"
                          />

                          {/* 渠道选项跟着收款渠道走：他没有别的渠道可以付 */}
                          {channels.length > 1 && (
                            <div className="flex gap-2">
                              {channels.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => setProvider(c.id)}
                                  aria-pressed={claimProvider === c.id}
                                  className={`flex-1 !py-1.5 !text-xs ${
                                    claimProvider === c.id ? "btn-mystic" : "btn-mystic opacity-45"
                                  }`}
                                >
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => void handleClaim()}
                              disabled={busy || payerRef.trim().length === 0}
                              className="btn-mystic !py-1.5 !px-4 !text-xs disabled:opacity-40"
                            >
                              提交
                            </button>
                            {claimNotice && (
                              <p className="text-gold-300 text-[11px] leading-relaxed">{claimNotice}</p>
                            )}
                          </div>

                          {claimError && (
                            <p role="alert" className="text-vermillion-400 text-[11px]">{claimError}</p>
                          )}

                          <p className="text-paper-100/45 text-[11px] leading-relaxed">
                            提交不会立刻开通，我们核对到账后会为你开通。
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleClose}
                        className="text-paper-100/45 hover:text-paper-100 text-xs transition-colors px-1 py-2 shrink-0"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => void handleFetchCode("pay")}
                        disabled={busy}
                        className="btn-mystic flex-1 !py-2 !text-sm disabled:opacity-40"
                      >
                        {busy ? "获取中..." : "获取激活码"}
                      </button>
                    </div>

                    {fetchCodeError && (
                      <p role="alert" className="text-vermillion-400 text-xs mt-3">{fetchCodeError}</p>
                    )}

                    <button
                      onClick={() => {
                        codeFromRef.current = "pay";
                        setCode("");
                        setError(null);
                        setStep("code");
                      }}
                      className="text-paper-100/45 hover:text-gold-300 text-[11px] mt-4 transition-colors"
                    >
                      已有激活码？点此输入
                    </button>

                    <p className="text-paper-100/45 text-[11px] mt-3">
                      付款遇到问题，请联系 {CONTACT_EMAIL}
                    </p>
                  </>
                ) : (
                  <>
                    <p role="alert" className="text-paper-100/60 text-sm mb-6 leading-relaxed">
                      {payError ?? "下单失败，请稍后重试"}
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleClose}
                        className="text-paper-100/45 hover:text-paper-100 text-xs transition-colors px-1 py-2 shrink-0"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => setAttempt((n) => n + 1)}
                        className="btn-mystic flex-1 !py-2 !text-sm"
                      >
                        重试
                      </button>
                    </div>
                    <p className="text-paper-100/45 text-[11px] mt-4">
                      付款遇到问题，请联系 {CONTACT_EMAIL}
                    </p>
                  </>
                )}
              </>
            )}

            {step === "code" && (
              <>
                <div className="flex justify-center mb-4"><Seal char="钥" size={48} /></div>
                <h3
                  className="text-xl text-gold mb-2"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  输入激活码
                </h3>
                <p className="text-paper-100/55 text-xs mb-6 leading-relaxed">
                  {code
                    ? "这是本单的激活码。复制它，在另一台设备上输入即可。"
                    : "16 位字母数字，不区分大小写，连字符可省略。"}
                </p>

                <input
                  ref={inputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && code.trim() && !busy) void handleRedeem();
                  }}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  aria-label="激活码"
                  aria-invalid={error !== null}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="w-full bg-mystic-950/60 border border-gold-300/25 rounded-lg px-4 py-3 text-center tracking-[0.2em] text-gold-200 placeholder:text-paper-100/45 focus:border-gold-400/60 focus:outline-none focus:ring-1 focus:ring-gold-400/30 transition-colors font-mono"
                />

                {error && (
                  <p role="alert" className="text-vermillion-400 text-xs mt-3">{error}</p>
                )}

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => { setStep(codeFromRef.current); setError(null); }}
                    className="btn-mystic flex-1 !py-2 !text-sm"
                  >
                    返回
                  </button>
                  <button
                    onClick={() => void handleRedeem()}
                    disabled={busy || code.trim().length === 0}
                    className="btn-primary flex-1 !py-2 !text-sm disabled:opacity-50"
                  >
                    {busy ? "核销中..." : "确认兑换"}
                  </button>
                </div>

                {!code && (
                  <p className="text-paper-100/45 text-[11px] mt-4 leading-relaxed">
                    还没拿到码？联系 {CONTACT_EMAIL}
                  </p>
                )}
              </>
            )}

            {step === "done" && (
              <>
                <div className="flex justify-center mb-5"><Seal char="圆" size={64} /></div>
                <h3
                  className="text-xl text-gold mb-3"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  已解锁
                </h3>
                <p className="text-paper-100/60 text-sm mb-6 leading-relaxed">
                  权益已写入本机凭证，即刻生效。
                  <br />
                  {autoUnlocked
                    ? "本机已自动开通；换设备时点下方「获取激活码」，在新设备上输入即可。"
                    : "换设备或清了浏览器数据，需要用激活码重新解锁。"}
                </p>

                {fetchCodeError && (
                  <p role="alert" className="text-vermillion-400 text-xs mb-4">{fetchCodeError}</p>
                )}

                <button onClick={handleClose} className="btn-primary w-full">
                  开始解读
                </button>

                {/* 只有确认已到账的订单才摆这个按钮 —— 别的来源下订单还是 pending，
                    点下去只会得到"尚未到账"，摆出来就是个死路 */}
                {autoUnlocked && (
                  <button
                    onClick={() => void handleFetchCode("done")}
                    disabled={busy}
                    className="btn-mystic w-full mt-3 !py-2 !text-sm disabled:opacity-40"
                  >
                    {busy ? "获取中..." : "获取激活码"}
                  </button>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
