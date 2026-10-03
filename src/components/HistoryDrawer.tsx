"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  getHistory,
  deleteReading,
  clearHistory,
  fetchCloudReadings,
  mergeReadings,
  Reading,
} from "@/lib/store";
import { useState, useEffect } from "react";
import Glyph, { CHART_TRIGRAM } from "./Glyph";
import { useDialog } from "./useDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (reading: Reading) => void;
}

export default function HistoryDrawer({ open, onClose, onSelect }: Props) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [cloudCount, setCloudCount] = useState(0);

  useEffect(() => {
    if (!open) return;

    // 先给本地那份（同步、立刻可见），再去拉云端那份补上 ——
    // 打开抽屉时不该先转圈等一次网络。未登录时云端那次会自己返回空数组。
    const local = getHistory();
    setReadings(local);

    let alive = true;
    void fetchCloudReadings().then((cloud) => {
      if (!alive || cloud.length === 0) return;
      setCloudCount(cloud.length);
      setReadings(mergeReadings(local, cloud));
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // Esc 关闭、Tab 锁在抽屉内、关闭后焦点归还
  const drawerRef = useDialog(open, onClose);

  const handleDelete = (id: string) => {
    deleteReading(id);
    setReadings((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClear = () => {
    if (window.confirm("确定清空所有历史记录？")) {
      clearHistory();
      setReadings([]);
      setCloudCount(0);
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
            aria-hidden="true"
          />

          <motion.div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="排盘历史"
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
                  aria-label="关闭历史记录"
                  className="text-paper-100/55 hover:text-paper-100/90 transition-colors text-xl leading-none px-1"
                >
                  ✕
                </button>
              </div>

              {readings.length === 0 ? (
                <div className="text-center py-12">
                  <div className="flex justify-center mb-4 text-gold-400/25"><Glyph trigram={CHART_TRIGRAM} size={40} /></div>
                  <p className="text-paper-100/60 text-sm">暂无排盘记录</p>
                  <p className="text-paper-100/55 text-xs mt-1">
                    完成一次排盘后，记录将显示在这里
                  </p>
                  {cloudCount === 0 && (
                    <p className="text-paper-100/45 text-xs mt-3 leading-relaxed">
                      记录存在本机浏览器里。<br />登录账号可跨设备查看。
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-3 mb-6">
                    {readings.map((r) => (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="mystic-card rounded-lg p-4 group relative focus-within:ring-1 focus-within:ring-gold-400/40"
                      >
                        {/* 整行可点，但用真正的 button 承载 —— 原先是个 motion.div，
                            键盘根本聚焦不到，鼠标用户能用、键盘用户用不了 */}
                        <button
                          onClick={() => {
                            onSelect(r);
                            onClose();
                          }}
                          className="w-full text-left"
                        >
                          <div className="flex items-center gap-2 mb-1 pr-8">
                            <Glyph trigram={CHART_TRIGRAM} size={22} />
                            {/* 用存下来的 title，而不是按 mode 查表 ——
                                模式删到只剩一个之后，查表只剩一条，且会让转换前存下的旧记录显示错名 */}
                            <span className="text-paper-100/75 text-xs">
                              {r.title || "八字命理"}
                            </span>
                            <span className="text-paper-100/55 text-xs">
                              {new Date(r.createdAt).toLocaleDateString("zh-CN")}
                            </span>
                          </div>
                          <p className="text-paper-100/60 text-xs line-clamp-2">
                            {r.result?.slice(0, 80)}...
                          </p>
                        </button>
                        {/* 删除键只在 hover 出现的话，键盘用户会聚焦到一个看不见的控件上，
                            所以补上 group-focus-within 与 focus 两条 */}
                        <button
                          onClick={() => handleDelete(r.id)}
                          aria-label={`删除 ${new Date(r.createdAt).toLocaleDateString("zh-CN")} 的记录`}
                          className="absolute top-3 right-3 text-paper-100/55 hover:text-vermillion-400 focus:text-vermillion-400 transition-colors text-xs opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
                        >
                          ✕
                        </button>
                      </motion.div>
                    ))}
                  </div>

                  <button
                    onClick={handleClear}
                    className="text-paper-100/55 hover:text-vermillion-400 transition-colors text-xs w-full text-center py-2"
                  >
                    清空所有记录
                  </button>
                  {cloudCount > 0 && (
                    <p className="text-paper-100/45 text-[11px] text-center leading-relaxed">
                      已同步账户记录。清空只影响本机，云端那份仍在。
                    </p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
