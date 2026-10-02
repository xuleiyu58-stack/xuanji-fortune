"use client";

import { motion, AnimatePresence } from "framer-motion";
import { getHistory, deleteReading, clearHistory, Reading } from "@/lib/store";
import { useState, useEffect } from "react";
import Glyph, { CHART_TRIGRAM } from "./Glyph";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (reading: Reading) => void;
}

export default function HistoryDrawer({ open, onClose, onSelect }: Props) {
  const [readings, setReadings] = useState<Reading[]>([]);

  useEffect(() => {
    if (open) {
      setReadings(getHistory());
    }
  }, [open]);

  const handleDelete = (id: string) => {
    deleteReading(id);
    setReadings((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClear = () => {
    if (window.confirm("确定清空所有历史记录？")) {
      clearHistory();
      setReadings([]);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 z-[100] w-full sm:w-96 glass border-l border-gold-300/10 overflow-y-auto"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3
                  className="text-lg text-gold"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  排盘历史
                </h3>
                <button
                  onClick={onClose}
                  className="text-paper-100/40 hover:text-paper-100/80 transition-colors text-xl"
                >
                  ✕
                </button>
              </div>

              {readings.length === 0 ? (
                <div className="text-center py-12">
                  <div className="flex justify-center mb-4 text-gold-400/25"><Glyph trigram={CHART_TRIGRAM} size={40} /></div>
                  <p className="text-paper-100/45 text-sm">暂无排盘记录</p>
                  <p className="text-paper-100/20 text-xs mt-1">
                    完成一次排盘后，记录将显示在这里
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-3 mb-6">
                    {readings.map((r) => (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="mystic-card rounded-lg p-4 cursor-pointer group"
                        onClick={() => {
                          onSelect(r);
                          onClose();
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Glyph trigram={CHART_TRIGRAM} size={22} />
                              {/* 用存下来的 title，而不是按 mode 查表 ——
                                  模式删到只剩一个之后，查表只剩一条，且会让转换前存下的旧记录显示错名 */}
                              <span className="text-paper-100/60 text-xs">
                                {r.title || "八字命理"}
                              </span>
                              <span className="text-paper-100/20 text-xs">
                                {new Date(r.createdAt).toLocaleDateString("zh-CN")}
                              </span>
                            </div>
                            <p className="text-paper-100/40 text-xs line-clamp-2">
                              {r.result?.slice(0, 80)}...
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(r.id);
                            }}
                            className="text-paper-100/20 hover:text-vermillion-400 transition-colors text-xs ml-2 opacity-0 group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  <button
                    onClick={handleClear}
                    className="text-paper-100/20 hover:text-vermillion-400 transition-colors text-xs w-full text-center py-2"
                  >
                    清空所有记录
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
