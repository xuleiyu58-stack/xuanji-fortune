"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Seal } from "./Glyph";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  price: string;
  onConfirm: () => void;
}

export default function PaymentModal({ open, onClose, title, price, onConfirm }: Props) {
  const [step, setStep] = useState<"pay" | "confirm">("pay");
  // 收款码是站长的外部资源，缺失时给出可读的占位，而不是一个碎图标
  const [qrFailed, setQrFailed] = useState(false);

  const handleClose = () => {
    setStep("pay");
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative mystic-card rounded-xl p-8 max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {step === "pay" ? (
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
                  <p className="text-gray-700 text-xs mb-2 font-medium">微信扫码支付</p>
                  {qrFailed ? (
                    <div className="w-44 h-44 flex items-center justify-center rounded border border-dashed border-gray-300 px-4 text-center">
                      <span className="text-gray-400 text-xs leading-relaxed">
                        收款码暂未就绪
                        <br />
                        请稍后再试
                      </span>
                    </div>
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/qrcode.jpg"
                        alt="微信收款码"
                        className="w-44 h-44 object-contain rounded"
                        onError={() => setQrFailed(true)}
                      />
                      <p className="text-gray-400 text-[10px] mt-1">长按识别或截图扫描</p>
                    </>
                  )}
                </div>

                <p className="text-paper-100/40 text-xs mb-2">
                  请使用微信或支付宝扫码支付
                </p>
                <p className="text-paper-100/30 text-xs mb-6">
                  支付完成后，点击下方按钮确认
                </p>

                <div className="flex gap-3">
                  <button onClick={handleClose} className="btn-mystic flex-1 !py-2 !text-sm">
                    取消
                  </button>
                  <button
                    onClick={() => setStep("confirm")}
                    className="btn-primary flex-1 !py-2 !text-sm"
                  >
                    已完成支付
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-center mb-5"><Seal char="圆" size={64} /></div>
                <h3
                  className="text-xl text-gold mb-3"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  功德圆满
                </h3>
                <p className="text-paper-100/50 text-sm mb-6 leading-relaxed">
                  感谢您的布施，愿玄机智慧为您指引前路。
                  <br />
                  点击确认，立即开启命理解读。
                </p>
                <button
                  onClick={() => {
                    onConfirm();
                    setStep("pay");
                  }}
                  className="btn-primary w-full"
                >
                  开启命理解读
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
