"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import HistoryDrawer from "./HistoryDrawer";
import { hasUnseenHistory, markHistorySeen } from "@/lib/store";
import { useEntitlement, formatExpiry } from "@/lib/entitlements";
import { viewReading } from "@/lib/viewing";
import { accountsEnabled, currentEmail, subscribeAuth } from "@/lib/auth-client";

/**
 * 全站只有一个页面了（首页即排盘工具），导航项随之消失。
 *
 * 原先这里是六项 NAV，桌面端与移动端各渲染一遍、还要一套汉堡菜单来装它 ——
 * 模式删到一个之后，那套东西就没有存在理由了。留下品牌、历史、会员、账号四样。
 *
 * 会员徽章读服务端权益，不再读 localStorage —— 那个布尔值谁都能自己写。
 *
 * 账号入口只在**账号服务已配置**时出现。没配 Supabase 时把一个"登录"
 * 按钮摆在首页，点进去看到"尚未开通"，比不显示更让人困惑。
 */
export default function Header() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);
  const entitlement = useEntitlement();

  useEffect(() => {
    // 红点的语义是「有新的没看」，不是「有记录」。
    // 此前判的是 history.length > 0 —— 那样只要排过一次盘它就永远亮着。
    const sync = () => setHasUnseen(hasUnseenHistory());
    sync();
    // 排盘完成后会派发 storage 事件（见 FortuneForm），据此重算
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const openHistory = () => {
    setHistoryOpen(true);
    // 打开即视为看过 —— 红点立刻熄灭
    markHistorySeen();
    setHasUnseen(false);
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 glass">
        <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="brand-mark flex items-center gap-2 group shrink-0" aria-label="玄机首页">
            <span className="text-2xl" style={{ fontFamily: "'Ma Shan Zheng', cursive" }}>玄</span>
            <span className="text-lg font-semibold text-gold hidden sm:inline" style={{ fontFamily: "'Noto Serif SC', serif" }}>机</span>
          </Link>
          <div className="flex items-center gap-3 sm:gap-5">
            {entitlement.member && (
              <Link
                href="/member"
                className="hidden sm:inline text-xs text-gold-400 bg-gold-400/10 rounded-full px-2.5 py-0.5 border border-gold-400/20"
                title={entitlement.expiresAt ? `${formatExpiry(entitlement.expiresAt)} 到期` : undefined}
              >
                会员
              </Link>
            )}
            <button
              onClick={openHistory}
              className="relative text-paper-100/60 hover:text-gold-300 transition-colors text-sm tracking-wider"
              title={hasUnseen ? "排盘历史（有新的记录）" : "排盘历史"}
            >
              历史
              {hasUnseen && (
                <span
                  className="absolute -top-1 -right-1 w-2 h-2 bg-vermillion-400 rounded-full"
                  aria-label="有新的记录"
                />
              )}
            </button>

            {/* 账号入口：只在账号服务已配置时出现（accountsEnabled 在挂载后才为真，
                所以这里用一个 state 而不是直接调用，避免服务端渲染与客户端不一致） */}
            <AccountEntry />

            <Link href="/" className="btn-mystic !py-2 !px-5 !text-sm">开始排盘</Link>
          </div>
        </nav>
      </header>
      {/* 历史记录点开之后交给首页的排盘区渲染。此前这里是个空函数
          （onSelect={() => {}}），条目能点、有手型、键盘也聚焦得到，
          但点下去什么都不发生 —— 那比不能点更让人困惑。 */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(r) => {
          viewReading(r);
          // 回到页顶，否则用户看不到刚打开的那条记录
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </>
  );
}

/**
 * 账号入口。单独一个小组件，是为了让 accountsEnabled() 的取值只发生在这里 ——
 * 它读的是 NEXT_PUBLIC_* 环境变量，服务端渲染时可能为空，
 * 直接在 Header 里条件渲染会导致 hydration 前后两套 DOM。
 */
function AccountEntry() {
  const [state, setState] = useState<"loading" | "off" | "guest" | "in">("loading");

  useEffect(() => {
    if (!accountsEnabled()) {
      setState("off");
      return;
    }
    let alive = true;
    const sync = () => {
      void currentEmail().then((e) => {
        if (alive) setState(e ? "in" : "guest");
      });
    };
    sync();
    // 用户在 /login 登录或登出后，页头必须跟着变 ——
    // 否则会出现"已经登录了，页头还写着登录"这种看起来就是坏了的界面
    const unsubscribe = subscribeAuth(sync);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (state === "loading" || state === "off") return null;

  return (
    <Link
      href="/login"
      className="text-paper-100/60 hover:text-gold-300 transition-colors text-sm tracking-wider"
      title={state === "in" ? "账号" : "登录"}
    >
      {state === "in" ? "账号" : "登录"}
    </Link>
  );
}
