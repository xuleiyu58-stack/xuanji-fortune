"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import PaymentModal from "@/components/PaymentModal";
import { isMember, setMember, setMemberExpiry } from "@/lib/store";
import Link from "next/link";

const PLANS = [
  { name: "月卡", price: "28.8", duration: "30天", original: "38.8", recommend: false, icon: "🌙", desc: "按月订阅，灵活便捷", days: 30 },
  { name: "年卡", price: "88", duration: "365天", original: "465.6", recommend: true, icon: "👑", desc: "日均 ¥0.24，超值之选", days: 365 },
  { name: "终身", price: "188", duration: "永久", original: "999", recommend: false, icon: "💎", desc: "一次购买，终身无忧", days: 3650 },
];

export default function MemberPage() {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(PLANS[1]);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [purchased, setPurchased] = useState(false);

  useEffect(() => { setAlreadyMember(isMember()); }, []);

  const handleBuy = (plan: typeof PLANS[0]) => { setSelectedPlan(plan); setPaymentOpen(true); };

  const handleConfirm = () => {
    setMember(true);
    setMemberExpiry(selectedPlan.days);
    setAlreadyMember(true);
    setPurchased(true);
    window.dispatchEvent(new Event("storage"));
  };

  if (purchased || alreadyMember) {
    return (
      <div className="min-h-screen relative">
        <Particles /><Header /><div className="ink-bg" />
        <main className="relative z-10 pt-24 pb-16 px-6">
          <div className="max-w-lg mx-auto text-center">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mystic-card rounded-xl p-12 border-gold-glow">
              <span className="text-6xl block mb-6">👑</span>
              <h1 className="text-3xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>{purchased ? "功德圆满！" : "已是会员"}</h1>
              <p className="text-paper-100/50 text-sm mb-8 leading-relaxed">{purchased ? `您已成功开通${selectedPlan.name}，感谢您的信赖与布施。` : "您已是玄机会员，全模式无限次解读。"}</p>
              <div className="flex flex-col gap-3">
                <Link href="/fortune/bazi" className="btn-primary">立即体验八字命理</Link>
                <Link href="/fortune/daily" className="btn-mystic">查看今日运势</Link>
              </div>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <Particles /><Header /><div className="ink-bg" />
      <main className="relative z-10 pt-24 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
            <span className="text-5xl block mb-4">👑</span>
            <h1 className="text-3xl md:text-5xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>问道 · 会员</h1>
            <p className="text-paper-100/50 text-sm max-w-md mx-auto leading-relaxed">解锁全部 AI 命理解读功能，无限次使用。<br />知命、改运、掌人生，从今天开始。</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {PLANS.map((plan, i) => (
              <motion.div key={plan.name} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className={`rounded-xl p-8 text-center relative ${plan.recommend ? "border-gold-glow" : "mystic-card"}`} style={plan.recommend ? { background: "linear-gradient(135deg, rgba(201, 150, 58, 0.12) 0%, rgba(10, 10, 18, 0.95) 100%)", border: "1px solid rgba(201, 150, 58, 0.4)", boxShadow: "0 0 40px rgba(201, 150, 58, 0.1)" } : undefined}>
                {plan.recommend && <span className="badge-hot absolute top-3 right-3">最值</span>}
                <span className="text-3xl block mb-3">{plan.icon}</span>
                <h3 className="text-xl text-gold mb-1" style={{ fontFamily: "'Noto Serif SC', serif" }}>{plan.name}</h3>
                <p className="text-paper-100/30 text-xs mb-4">{plan.duration} · {plan.desc}</p>
                <div className="price-tag mb-1 justify-center"><span className="symbol">¥</span><span className="amount">{plan.price}</span></div>
                <p className="text-paper-100/20 text-xs line-through mb-6">¥{plan.original}</p>
                <button onClick={() => handleBuy(plan)} className={plan.recommend ? "btn-primary w-full" : "btn-mystic w-full"}>立即开通</button>
              </motion.div>
            ))}
          </div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mystic-card rounded-xl p-8 max-w-2xl mx-auto">
            <h3 className="text-lg text-gold mb-6 text-center" style={{ fontFamily: "'Noto Serif SC', serif" }}>会员专属权益</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[["♾️","全模式无限次解读"],["🧠","AI 深度命理分析"],["💬","专属大师寄语"],["🌟","优先体验新功能"],["📜","永久保存测算记录"],["🎁","分享好友双方得会员"]].map(([icon, text]) => (<div key={text} className="flex items-center gap-3"><span className="text-xl">{icon}</span><span className="text-paper-100/60 text-sm">{text}</span></div>))}
            </div>
          </motion.div>
        </div>
      </main>
      <PaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={`开通${selectedPlan.name}`} price={selectedPlan.price} onConfirm={handleConfirm} />
      <Footer />
    </div>
  );
}
