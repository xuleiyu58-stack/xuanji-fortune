"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-2xl" style={{ fontFamily: "'Ma Shan Zheng', cursive" }}>
            玄
          </span>
          <span
            className="text-lg font-semibold text-gold hidden sm:inline"
            style={{ fontFamily: "'Noto Serif SC', serif" }}
          >
            机
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <Link href="/fortune/daily" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">
            今日运势
          </Link>
          <Link href="/fortune/bazi" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">
            八字命理
          </Link>
          <Link href="/fortune/love" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">
            姻缘配对
          </Link>
          <Link href="/fortune/tarot" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">
            AI 塔罗
          </Link>
          <Link href="/fortune/oracle" className="text-paper-100/70 hover:text-gold-300 transition-colors text-sm tracking-wider">
            灵签求签
          </Link>
          <Link href="/" className="btn-mystic !py-2 !px-6 !text-sm">
            开始测算
          </Link>
        </div>

        <button
          className="md:hidden flex flex-col gap-1.5 p-2"
          onClick={() => setOpen(!open)}
          aria-label="Menu"
        >
          <motion.span
            animate={open ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
            className="w-5 h-0.5 bg-gold-300 block"
          />
          <motion.span
            animate={open ? { opacity: 0 } : { opacity: 1 }}
            className="w-5 h-0.5 bg-gold-300 block"
          />
          <motion.span
            animate={open ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
            className="w-5 h-0.5 bg-gold-300 block"
          />
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden glass border-t border-gold-300/10 overflow-hidden"
          >
            <div className="px-6 py-4 flex flex-col gap-3">
              <Link href="/fortune/daily" onClick={() => setOpen(false)} className="text-paper-100/80 hover:text-gold-300 transition-colors py-2 text-sm tracking-wider">
                今日运势
              </Link>
              <Link href="/fortune/bazi" onClick={() => setOpen(false)} className="text-paper-100/80 hover:text-gold-300 transition-colors py-2 text-sm tracking-wider">
                八字命理
              </Link>
              <Link href="/fortune/love" onClick={() => setOpen(false)} className="text-paper-100/80 hover:text-gold-300 transition-colors py-2 text-sm tracking-wider">
                姻缘配对
              </Link>
              <Link href="/fortune/tarot" onClick={() => setOpen(false)} className="text-paper-100/80 hover:text-gold-300 transition-colors py-2 text-sm tracking-wider">
                AI 塔罗
              </Link>
              <Link href="/fortune/oracle" onClick={() => setOpen(false)} className="text-paper-100/80 hover:text-gold-300 transition-colors py-2 text-sm tracking-wider">
                灵签求签
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
