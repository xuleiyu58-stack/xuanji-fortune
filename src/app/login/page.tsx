"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import { Seal } from "@/components/Glyph";
import {
  accountsEnabled,
  authClient,
  currentEmail,
  linkDeviceCredential,
  notifyAuthChanged,
  signOut,
} from "@/lib/auth-client";
import { refreshEntitlement, useEntitlement, formatExpiry } from "@/lib/entitlements";
import { CONTACT_EMAIL } from "@/lib/contact";
import Link from "next/link";

/**
 * 登录。
 *
 * 用邮箱验证码而不是密码：这个站没有"账户"这个概念需要用户维护，
 * 一次性验证码把注册与登录合成一步，少一个"忘记密码"的分支 ——
 * 而忘记密码是消费类产品里流失率最高的一个环节。
 *
 * 登录之后会自动做一件事：把本机（未登录时）兑换到的权益迁到账户上。
 * 这正是账号体系存在的理由 —— 清了浏览器数据、换了设备，会员还在。
 */

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

export default function LoginPage() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const entitlement = useEntitlement();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const on = accountsEnabled();
      if (!alive) return;
      setEnabled(on);
      if (!on) return;

      // 已登录就直接展示状态，不必再走一遍流程
      const signedIn = await currentEmail();
      if (alive && signedIn) {
        setEmail(signedIn);
        setStep("done");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const sendCode = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/account/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error ?? "验证码发送失败，请稍后重试");
        return;
      }
      setStep("code");
      setNotice(`验证码已发往 ${email}，10 分钟内有效`);
    } catch {
      setError("网络连接失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const sb = authClient();
      if (!sb) {
        setError("账号服务尚未配置");
        return;
      }

      const { error: verifyError } = await sb.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });
      if (verifyError) {
        setError("验证码不正确或已过期，请重新获取");
        return;
      }

      // 登录成功，把本机权益迁到账户上
      const link = await linkDeviceCredential();
      if (link.status === "linked") {
        setNotice("登录成功，本机的会员权益已同步到账户，换设备也能用了");
      } else if (link.status === "nothing_to_link") {
        setNotice("登录成功");
      } else if (link.status === "failed") {
        // 迁移失败不阻断登录 —— 权益仍在本机可用，只是暂时跨不了设备
        setNotice("登录成功。本机权益暂未同步到账户，稍后可在本页重试");
      } else {
        setNotice("登录成功");
      }

      // 权益可能已从账户重新签发，刷新前端缓存
      await refreshEntitlement();
      // 通知页头等订阅者：登录态变了。少了这一步页头会一直显示"登录"，
      // 用户会以为自己没登进去。
      notifyAuthChanged();
      setStep("done");
    } catch {
      setError("网络连接失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
      await refreshEntitlement();
      notifyAuthChanged();
      setStep("email");
      setCode("");
      setNotice("已退出登录");
      setError(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen relative">
      <Particles /><Header /><div className="ink-bg" />

      <main className="relative z-10 pt-28 pb-20 px-6">
        <div className="max-w-md mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
            <div className="flex justify-center mb-5"><Seal char="钥" size={60} /></div>
            <h1 className="text-3xl md:text-4xl text-gold mb-4" style={SERIF}>
              {step === "done" ? "已登录" : "登录账号"}
            </h1>
            <p className="text-paper-100/70 text-sm leading-relaxed">
              {step === "done"
                ? "权益已绑定到账户。换设备或清除浏览器数据后，重新登录即可恢复。"
                : "用邮箱验证码登录，无需密码。登录后本机已解锁的权益会同步到账户。"}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mystic-card rounded-xl p-8"
          >
            {enabled === null && (
              <p className="text-center text-paper-100/55 text-sm">正在检查账号服务…</p>
            )}

            {enabled === false && (
              <div className="text-center">
                <p className="text-paper-100/70 text-sm leading-relaxed mb-3">
                  账号服务尚未开通。
                </p>
                <p className="text-paper-100/55 text-xs leading-relaxed mb-6">
                  这不影响使用 —— 用激活码解锁的权益目前保存在本机浏览器里。
                  启用账号功能需要先在服务器配置数据库。若你已有激活码却无法使用，请联系 {CONTACT_EMAIL}。
                </p>
                <Link href="/member" className="btn-mystic">去兑换激活码</Link>
              </div>
            )}

            {enabled === true && step === "email" && (
              <div className="space-y-4">
                <label htmlFor="login-email" className="block text-paper-100/70 text-sm">
                  邮箱地址
                </label>
                <input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && email.trim() && !busy) void sendCode();
                  }}
                  placeholder="you@example.com"
                  className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/85 placeholder:text-paper-100/45 focus:border-gold-300/50 focus:outline-none transition-colors text-sm"
                />
                <button
                  onClick={() => void sendCode()}
                  disabled={busy || !email.trim()}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {busy ? "发送中…" : "发送验证码"}
                </button>
                <p className="text-paper-100/55 text-xs leading-relaxed">
                  首次登录会自动创建账号，不需要单独注册。
                </p>
              </div>
            )}

            {enabled === true && step === "code" && (
              <div className="space-y-4">
                <label htmlFor="login-code" className="block text-paper-100/70 text-sm">
                  6 位验证码
                </label>
                <input
                  id="login-code"
                  ref={codeRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && code.trim() && !busy) void verify();
                  }}
                  placeholder="000000"
                  className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-center tracking-[0.4em] text-gold-200 placeholder:text-paper-100/35 focus:border-gold-300/50 focus:outline-none transition-colors text-lg font-mono"
                />
                <button
                  onClick={() => void verify()}
                  disabled={busy || code.trim().length < 4}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {busy ? "验证中…" : "登录"}
                </button>
                <div className="flex justify-between text-xs">
                  <button
                    onClick={() => { setStep("email"); setCode(""); setError(null); setNotice(null); }}
                    className="text-paper-100/60 hover:text-gold-300 transition-colors"
                  >
                    换个邮箱
                  </button>
                  <button
                    onClick={() => void sendCode()}
                    disabled={busy}
                    className="text-gold-400/70 hover:text-gold-300 transition-colors disabled:opacity-50"
                  >
                    重新发送
                  </button>
                </div>
              </div>
            )}

            {enabled === true && step === "done" && (
              <div className="space-y-5 text-center">
                <p className="text-paper-100/85 text-sm break-all">{email}</p>

                {entitlement.member ? (
                  <p className="text-gold-300 text-sm">
                    会员权益生效中
                    {entitlement.expiresAt ? `，有效至 ${formatExpiry(entitlement.expiresAt)}` : ""}
                  </p>
                ) : entitlement.passes.length > 0 ? (
                  <div className="flex flex-wrap gap-2 justify-center">
                    {entitlement.passes.map((p) => (
                      <span key={p.mode} className="text-xs text-gold-300 bg-gold-400/10 border border-gold-400/20 rounded-full px-3 py-1">
                        剩余 {p.remaining} 次
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-paper-100/60 text-sm">当前还没有已解锁的权益</p>
                )}

                <div className="flex flex-col gap-3 pt-2">
                  <Link href="/" className="btn-primary">去排盘</Link>
                  <Link href="/member" className="btn-mystic">兑换激活码</Link>
                  <button
                    onClick={() => void handleSignOut()}
                    disabled={busy}
                    className="text-paper-100/55 hover:text-paper-100/85 transition-colors text-xs disabled:opacity-50"
                  >
                    退出登录
                  </button>
                </div>
              </div>
            )}

            {notice && (
              <p className="text-gold-300/85 text-xs mt-5 leading-relaxed text-center">{notice}</p>
            )}
            {error && (
              <p role="alert" className="text-vermillion-400 text-xs mt-4 text-center">{error}</p>
            )}
          </motion.div>

          {step !== "done" && (
            <p className="text-center text-paper-100/55 text-xs mt-6 leading-relaxed">
              不想注册也完全可以：<Link href="/member" className="text-gold-400/70 hover:text-gold-300 underline transition-colors">用激活码解锁</Link>，
              权益会保存在本机浏览器里。
            </p>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
