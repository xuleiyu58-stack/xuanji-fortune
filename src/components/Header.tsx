"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import HistoryDrawer from "./HistoryDrawer";
import { getHistory, isMember } from "@/lib/store";

/**
 * 全站只有一个页面了（首页即排盘工具），导航项随之消失。
 *
 * 原先这里是六项 NAV，桌面端与移动端各渲染一遍、还要一套汉堡菜单来装它 ——
 * 模式删到一个之后，那套东西就没有存在理由了。留下品牌、历史、会员三样。
 */
export default function Header() {
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
          <Link href="/" className="brand-mark flex items-center gap-2 group shrink-0" aria-label="玄机首页">
            <span className="text-2xl" style={{ fontFamily: "'Ma Shan Zheng', cursive" }}>玄</span>
            <span className="text-lg font-semibold text-gold hidden sm:inline" style={{ fontFamily: "'Noto Serif SC', serif" }}>机</span>
          </Link>
          <div className="flex items-center gap-4 sm:gap-5">
            {member && <Link href="/member" className="hidden sm:inline text-xs text-gold-400 bg-gold-400/10 rounded-full px-2.5 py-0.5 border border-gold-400/20">会员</Link>}
            <button onClick={() => setHistoryOpen(true)} className="relative text-paper-100/50 hover:text-gold-300 transition-colors text-sm tracking-wider" title="排盘历史">历史{hasReadings && <span className="absolute -top-1 -right-1 w-2 h-2 bg-vermillion-400 rounded-full" />}</button>
            <Link href="/" className="btn-mystic !py-2 !px-5 !text-sm">开始排盘</Link>
          </div>
        </nav>
      </header>
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} onSelect={() => {}} />
    </>
  );
}
