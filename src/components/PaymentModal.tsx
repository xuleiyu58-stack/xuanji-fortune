"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  price: string;
  onConfirm: () => void;
}

export default function PaymentModal({ open, onClose, title, price, onConfirm }: Props) {
  const [step, setStep] = useState<"pay" | "confirm">("pay");

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
                <div className="text-3xl mb-3">🔮</div>
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

                <div className="bg-white rounded-lg p-4 mb-4 w-48 h-48 mx-auto flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-gray-800 text-xs mb-2">微信扫码支付</p>
                    <div className="w-32 h-32 mx-auto bg-gray-100 rounded flex items-center justify-center">
                      <span className="text-gray-400 text-xs">
                        上传收款码
                        <br />
                        即可收钱
                      </span>
                    </div>
                  </div>
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
                <div className="text-5xl mb-4">✨</div>
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
