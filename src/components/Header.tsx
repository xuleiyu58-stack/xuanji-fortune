"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import HistoryDrawer from "./HistoryDrawer";
import { getHistory, isMember } from "@/lib/store";

export default function Header() {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hasReadings, setHasReadings] = useState(false);
  const [member, setMember] = useState(false);

  useEffect(() => {
    setHasReadings(getHistory().length > 0);
    setMember(isMember());
    const onStorage = () => {
      setHasReadings(getHistory().length > 0);
      setMember(isMember());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 glass">
        <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <span className="text-2xl" style={{ fontFamily: "'Ma Shan Zheng', cursive" }}>玄</span>
            <span className="text-lg font-semibold text-gold hidden sm:inline" style={{ fontFamily: "'Noto Serif SC', serif" }}>机</span>
          </Link>
          <div className="hidden md:flex items-center gap-6">
            <Link href="/fortune/daily" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">今日运势</Link>
            <Link href="/fortune/bazi" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">八字命理</Link>
            <Link href="/fortune/love" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">姻缘配对</Link>
            <Link href="/fortune/tarot" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">AI 塔罗</Link>
            <Link href="/fortune/oracle" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">灵签求签</Link>
          </div>
          <div className="flex items-center gap-3">
            {member && <Link href="/member" className="hidden sm:inline text-xs text-gold-400 bg-gold-400/10 rounded-full px-2.5 py-0.5 border border-gold-400/20">👑 会员</Link>}
            <button onClick={() => setHistoryOpen(true)} className="relative text-paper-100/50 hover:text-gold-300 transition-colors text-sm" title="测算历史">📜{hasReadings && <span className="absolute -top-1 -right-1 w-2 h-2 bg-vermillion-400 rounded-full" />}</button>
            <Link href="/fortune/daily" className="hidden md:inline-block btn-mystic !py-2 !px-5 !text-sm">开始测算</Link>
          </div>
          <button className="md:hidden flex flex-col gap-1.5 p-2" onClick={() => setOpen(!open)} aria-label="Menu">
            <motion.span animate={open ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }} className="w-5 h-0.5 bg-gold-300 block" />
            <motion.span animate={open ? { opacity: 0 } : { opacity: 1 }} className="w-5 h-0.5 bg-gold-300 block" />
            <motion.span animate={open ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }} className="w-5 h-0.5 bg-gold-300 block" />
          </button>
        </nav>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="md:hidden glass border-t border-gold-300/10 overflow-hidden">
              <div className="px-6 py-4 flex flex-col gap-3">
                {[["🎯 今日运势","/fortune/daily"],["📅 八字命理","/fortune/bazi"],["💑 姻缘配对","/fortune/love"],["🃏 AI 塔罗","/fortune/tarot"],["🏮 灵签求签","/fortune/oracle"]].map(([l,h]) => <Link key={h} href={h} onClick={() => setOpen(false)} className="text-paper-100/80 hover:text-gold-300 transition-colors py-2 text-sm tracking-wider">{l}</Link>)}
                <div className="border-t border-gold-300/10 pt-3 mt-1">
                  <button onClick={() => { setOpen(false); setHistoryOpen(true); }} className="text-paper-100/60 hover:text-gold-300 transition-colors py-2 text-sm tracking-wider w-full text-left">📜 测算历史{hasReadings && <span className="ml-2 text-xs text-vermillion-400">●</span>}</button>
                  {member && <Link href="/member" className="inline-block mt-2 text-xs text-gold-400 bg-gold-400/10 rounded-full px-2.5 py-0.5 border border-gold-400/20">👑 会员专享</Link>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} onSelect={() => {}} />
    </>
  );
}
