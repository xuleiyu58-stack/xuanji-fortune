"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import PaymentModal from "@/components/PaymentModal";
import { redeemActivationCode } from "@/lib/redeem-client";
import { useEntitlement, formatExpiry } from "@/lib/entitlements";
import { MEMBER_PLANS, formatPrice } from "@/lib/pricing";
import { CONTACT_EMAIL, CONTACT_LABEL } from "@/lib/contact";
import { Seal } from "@/components/Glyph";
import Link from "next/link";

const PLANS = MEMBER_PLANS.map((p) => ({
  ...p,
  duration: `${p.days}天`,
  // 印章取自套餐本身的时间单位，而不是通用的皇冠/月亮 emoji
  seal: p.id === "member_year" ? "年" : "月",
  recommend: p.id === "member_year",
  // 文案里不能出现具体金额 —— 否则会被本任务的 no-hardcoded-prices 测试判为硬编码价格
  desc: p.id === "member_year" ? "全年畅享，超值之选" : "按月订阅，灵活便捷",
}));

export default function MemberPage() {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(PLANS[1]);
  const entitlement = useEntitlement();

  const handleBuy = (plan: typeof PLANS[0]) => {
    setSelectedPlan(plan);
    setPaymentOpen(true);
  };

  return (
    <div className="min-h-screen relative">
      <Particles /><Header /><div className="ink-bg" />
      <main className="relative z-10 pt-24 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-14">
            <div className="flex justify-center mb-5"><Seal char={entitlement.member ? "会" : "道"} size={64} /></div>
            <h1 className="text-3xl md:text-5xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>
              {entitlement.member ? "会员生效中" : "问道 · 会员"}
            </h1>
            <p className="text-paper-100/55 text-sm max-w-md mx-auto leading-relaxed">
              {entitlement.member && entitlement.expiresAt
                ? <>会员权益有效至 <span className="text-gold-300">{formatExpiry(entitlement.expiresAt)}</span>，期间不限次解读。</>
                : <>解锁全部 AI 命理解读功能，无限次使用。<br />知命、改运、掌人生，从今天开始。</>}
            </p>
          </motion.div>

          {/* 已持有的单次通行证 —— 买了券又兑了会员的人，得看得见自己的券还在 */}
          {entitlement.passes.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mystic-card rounded-xl p-5 max-w-2xl mx-auto mb-10">
              <p className="text-paper-100/55 text-xs mb-3">通行证余额</p>
              <div className="flex flex-wrap gap-3">
                {entitlement.passes.map((p) => (
                  <span key={p.mode} className="text-xs text-gold-300 bg-gold-400/10 border border-gold-400/20 rounded-full px-3 py-1">
                    {p.mode === "bazi" ? "八字排盘" : p.mode} · 剩余 {p.remaining} 次
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10 max-w-2xl mx-auto">
            {PLANS.map((plan, i) => (
              <motion.div key={plan.name} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className={`rounded-xl p-8 text-center relative ${plan.recommend ? "border-gold-glow" : "mystic-card"}`} style={plan.recommend ? { background: "linear-gradient(135deg, rgba(201, 150, 58, 0.12) 0%, rgba(10, 10, 18, 0.95) 100%)", border: "1px solid rgba(201, 150, 58, 0.4)", boxShadow: "0 0 40px rgba(201, 150, 58, 0.1)" } : undefined}>
                {plan.recommend && <span className="badge-hot absolute top-3 right-3">最值</span>}
                <div className="flex justify-center mb-4"><Seal char={plan.seal} size={46} /></div>
                <h3 className="text-xl text-gold mb-1" style={{ fontFamily: "'Noto Serif SC', serif" }}>{plan.name}</h3>
                <p className="text-paper-100/55 text-xs mb-4">{plan.duration} · {plan.desc}</p>
                <div className="price-tag mb-6 justify-center"><span className="symbol">¥</span><span className="amount">{formatPrice(plan.price)}</span></div>
                <button onClick={() => handleBuy(plan)} className={plan.recommend ? "btn-primary w-full" : "btn-mystic w-full"}>
                  {entitlement.member ? "续费" : "立即开通"}
                </button>
              </motion.div>
            ))}
          </div>

          {/* 兑换入口独立成一屏 —— 付款与拿码是两步，付完钱回来要有个明确的地方输入 */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mystic-card rounded-xl p-8 max-w-2xl mx-auto mb-10 text-center">
            <h3 className="text-lg text-gold mb-3" style={{ fontFamily: "'Noto Serif SC', serif" }}>
              {entitlement.member ? "兑换更多权益" : "已有激活码？"}
            </h3>
            <p className="text-paper-100/55 text-sm leading-relaxed mb-5">
              付款后请联系 <span className="text-gold-300">{CONTACT_LABEL}</span>{" "}
              <span className="text-paper-100/70 select-all">{CONTACT_EMAIL}</span> 获取激活码，
              在此处输入即可解锁。一码一用。
            </p>
            <button onClick={() => setPaymentOpen(true)} className="btn-mystic">
              输入激活码
            </button>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mystic-card rounded-xl p-8 max-w-2xl mx-auto">
            <h3 className="text-lg text-gold mb-6 text-center" style={{ fontFamily: "'Noto Serif SC', serif" }}>会员专属权益</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {["全模式无限次解读", "AI 深度命理分析", "专属大师寄语", "优先体验新功能", "测算记录随时回看"].map((text) => (<div key={text} className="flex items-start gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-gold-400/70 shrink-0" aria-hidden="true" /><span className="text-paper-100/70 text-sm">{text}</span></div>))}
            </div>
            <p className="text-paper-100/55 text-xs text-center mt-6 leading-relaxed">
              权益写在本机凭证里，换设备或清除浏览器数据后需用激活码重新解锁。<br />
              遇到问题请联系 {CONTACT_EMAIL}
            </p>
          </motion.div>

          <div className="text-center mt-10">
            <Link href="/" className="btn-primary">开始排盘</Link>
          </div>
        </div>
      </main>

      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title={`${selectedPlan.name} · 开通`}
        price={formatPrice(selectedPlan.price)}
        onRedeem={redeemActivationCode}
      />
      <Footer />
    </div>
  );
}
