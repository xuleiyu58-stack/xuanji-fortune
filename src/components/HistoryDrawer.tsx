"use client";

import { motion, AnimatePresence } from "framer-motion";
import { getHistory, deleteReading, clearHistory, Reading } from "@/lib/store";
import { useState, useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (reading: Reading) => void;
}

const MODE_LABELS: Record<string, string> = {
  daily: "今日运势",
  bazi: "八字命理",
  love: "姻缘配对",
  tarot: "AI 塔罗",
  oracle: "灵签求签",
};

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
                  📜 测算历史
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
                  <span className="text-4xl block mb-3">🔮</span>
                  <p className="text-paper-100/30 text-sm">暂无测算记录</p>
                  <p className="text-paper-100/20 text-xs mt-1">
                    完成一次测算后，记录将显示在这里
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
                              <span className="text-lg">{r.icon}</span>
                              <span className="text-paper-100/60 text-xs">
                                {MODE_LABELS[r.mode] || r.mode}
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
