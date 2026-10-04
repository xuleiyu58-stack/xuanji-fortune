"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect, useCallback } from "react";
import { Seal } from "./Glyph";
import { useDialog } from "./useDialog";
import { CONTACT_EMAIL, CONTACT_LABEL } from "@/lib/contact";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  price: string;
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

/**
 * 付费与解锁。
 *
 * 这里**没有任何「我已付款」的按钮**。原先有一个，点一下就 setMember(true)
 * 写进 localStorage —— 那等于把解锁权交给了用户自己的浏览器。
 * 现在唯一的前进方式是输入服务端能核销的激活码。
 */
export default function PaymentModal({
  open,
  onClose,
  title,
  price,
  onRedeem,
  alreadyUnlocked = false,
}: Props) {
  const [step, setStep] = useState<"pay" | "code" | "done">("pay");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 收款码是站长的外部资源，缺失时给出可读的占位，而不是一个碎图标
  const [qrFailed, setQrFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    setStep("pay");
    setError(null);
    onClose();
  }, [onClose]);

  // Esc 关闭、Tab 锁在弹窗内、关闭后把焦点还回去
  const dialogRef = useDialog(open, handleClose);

  // 打开时若已是会员/持券，直接显示状态 —— 再要一次码是纯粹的自找麻烦
  useEffect(() => {
    if (open && alreadyUnlocked) setStep("done");
  }, [open, alreadyUnlocked]);

  useEffect(() => {
    if (step === "code") inputRef.current?.focus();
  }, [step]);

  const handleRedeem = async () => {
    setError(null);
    setBusy(true);
    try {
      const message = await onRedeem(code);
      if (message) {
        setError(message);
      } else {
        setCode("");
        setStep("done");
      }
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
            {step === "pay" && (
              <>
                <div className="flex justify-center mb-4"><Seal char="缘" size={48} /></div>
                <h3
                  className="text-xl text-gold mb-2"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  {title}
                </h3>
                <div className="price-tag mb-4 justify-center">
                  <span className="symbol">¥</span>
                  <span className="amount">{price}</span>
                </div>

                <div className="bg-white rounded-lg p-3 mb-4 mx-auto flex flex-col items-center">
                  <p className="text-gray-800 text-xs mb-2 font-semibold">
                    请用「支付宝」扫一扫
                  </p>
                  {qrFailed ? (
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
                        收款码是纯二维码方图（600×600）。

                        此前用的是支付宝导出的整张竖版海报（1260×1890），里面
                        二维码只占一块，缩到 208px 宽之后二维码实际只有约 180px ——
                        拿手机对着电脑屏幕扫很勉强。裁成方图之后，同样的宽度下
                        二维码变成约 260px，大了 44%。

                        裁图还顺带去掉两样东西：海报下方印的收款人真名与地区
                        （写在这里等于向所有访客公开），以及那句"推荐使用支付宝"
                        —— 它反而让用户以为微信也能扫。
                      */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/qrcode.jpg"
                        alt="支付宝收款码"
                        className="w-60 h-60 sm:w-64 sm:h-64 rounded"
                        onError={() => setQrFailed(true)}
                      />
                      <p className="text-gray-500 text-[11px] mt-2 font-medium">
                        金额请手动输入 ¥{price}
                      </p>
                    </>
                  )}
                </div>

                {/* 微信扫不了支付宝的码，而多数人第一反应是打开微信 ——
                    不讲清楚的话，用户扫完什么都没发生，就卡在这里了。 */}
                <p className="text-paper-100/45 text-[11px] leading-relaxed mb-4">
                  微信无法识别支付宝收款码，请务必用支付宝扫
                </p>

                {/*
                  交付说明。
                  
                  这一段是整个付费流程里**最容易让用户卡住**的地方：他付完钱之后
                  手上什么都没有，得先找站长拿激活码。此前这里只有两行浅灰小字，
                  用户很可能直接点下面的按钮、然后对着一个空输入框发呆。
                  
                  所以改成编号步骤，并把两件事明确指出来：
                  1. 需要用户主动发邮件 —— 支付宝个人收款码不带用户信息，
                     站长无法主动联系付款人，只能由用户来联系
                  2. 金额要手动输入 —— 个人收款码不带金额，用户可能输错或忘输
                */}
                <div className="text-left rounded-lg border border-gold-300/20 bg-mystic-900/40 px-4 py-3.5 mb-5">
                  <p className="text-paper-100/70 text-xs mb-2.5 tracking-wider">
                    付款后如何拿到解读
                  </p>
                  <ol className="space-y-2">
                    {[
                      "用支付宝扫上方收款码",
                      `手动输入金额 ¥${price}，完成支付`,
                      "把付款截图发到下面这个邮箱",
                      "收到激活码后，点下方按钮输入",
                    ].map((text, i) => (
                      <li key={text} className="flex items-start gap-2.5">
                        <span className="mt-px shrink-0 w-4 h-4 rounded-full bg-gold-400/15 text-gold-300 text-[10px] leading-4 text-center">
                          {i + 1}
                        </span>
                        <span className="text-paper-100/65 text-xs leading-relaxed">{text}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 pt-3 border-t border-gold-300/12 text-center">
                    <span className="block text-paper-100/45 text-[10px] mb-1">
                      {CONTACT_LABEL}
                    </span>
                    <span className="text-gold-300 text-sm tracking-wide select-all break-all">
                      {CONTACT_EMAIL}
                    </span>
                  </p>
                </div>

                <div className="flex gap-3">
                  <button onClick={handleClose} className="btn-mystic flex-1 !py-2 !text-sm">
                    取消
                  </button>
                  <button
                    onClick={() => setStep("code")}
                    className="btn-primary flex-1 !py-2 !text-sm"
                  >
                    我已付款，输入激活码
                  </button>
                </div>
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
                  16 位字母数字，不区分大小写，连字符可省略。
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
                    onClick={() => { setStep("pay"); setError(null); }}
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

                <p className="text-paper-100/55 text-[11px] mt-4 leading-relaxed">
                  还没拿到码？把付款截图发到{" "}
                  <span className="text-gold-300/80 select-all">{CONTACT_EMAIL}</span>
                </p>
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
                  换个浏览器或清了 cookie 需要用激活码重新解锁。
                </p>
                <button onClick={handleClose} className="btn-primary w-full">
                  开始解读
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
