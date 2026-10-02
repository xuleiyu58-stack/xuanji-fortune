"use client";

import { motion } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneForm from "@/components/FortuneForm";
import { Seal } from "@/components/Glyph";
import { MODES, MEMBER_PLANS, formatPrice } from "@/lib/pricing";
import Link from "next/link";

const monthPlan = MEMBER_PLANS[0];
const yearPlan = MEMBER_PLANS[1];
const yuan = (n: number) => `¥${formatPrice(n)}`;

// 三步走的是「问 → 排 → 解」。用单字而不是 01/02/03 —— 这三步本身有先后语义，不是装饰性编号。
const STEPS = [
  { char: "问", title: "报上生辰", text: "出生日期与时辰。时辰决定时柱，差一个时辰就是差四分之一的盘。" },
  { char: "排", title: "起盘", text: "四柱、藏干、十神、五行、大运 —— 全部由程序精确推算，不经模型之手。" },
  { char: "解", title: "读盘", text: "AI 只做一件事：解读已经排准的盘。不推算，不编造。" },
];

// 提问按真实疑虑排序：准不准 → 会不会编 → 隐私 → 钱。前两个不答清楚，后面两个没人看。
const FAQ = [
  {
    q: "排盘是程序算的，还是 AI 算的？",
    a: "程序算。四柱、藏干、十神、五行、大运全部由确定性算法推算，AI 拿到的是已经排好的结果，只负责解读。日柱靠大模型心算基本必错，而这是命理最不该出错的地方。",
  },
  {
    q: "算得准吗？",
    a: "排盘本身是精确的历法推算，可核验。解读部分是一套理解自己的框架，不是预言 —— 我们把传统命理的推演逻辑讲清楚，供你参照。",
  },
  {
    q: "我的出生信息会被存下来吗？",
    a: "排盘记录只保存在你自己浏览器的本地存储里，不会上传，我们也看不到。清空浏览器数据即彻底删除。",
  },
  {
    q: "怎么收费？",
    a: `单次排盘解读 ${yuan(MODES.bazi.price)}，按次支付、不自动续费。会员 ${yuan(monthPlan.price)}/月 或 ${yuan(yearPlan.price)}/年，无限次。`,
  },
];

export default function Home() {
  return (
    <div className="min-h-screen relative">
      <Particles /><Header /><div className="ink-bg" />

      <section className="relative z-10 pt-28 pb-4 px-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, ease: "easeOut" }} className="hero-constellation pointer-events-none" aria-hidden="true">
          <svg viewBox="0 0 480 480" className="h-full w-full">
            <circle cx="240" cy="240" r="205" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 10" />
            <circle cx="240" cy="240" r="150" fill="none" stroke="currentColor" strokeWidth="1" opacity=".65" />
            <circle cx="240" cy="240" r="82" fill="none" stroke="currentColor" strokeWidth="1" opacity=".75" />
            <path d="M240 34v412M34 240h412M95 95l290 290M385 95L95 385" stroke="currentColor" strokeWidth=".6" opacity=".45" />
            <path d="M240 157c46 0 83 37 83 83s-37 83-83 83-83-37-83-83 37-83 83-83Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="240" cy="240" r="11" fill="currentColor" opacity=".8" />
          </svg>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: "easeOut" }} className="hero-content text-center relative">
          <p className="hero-kicker">子平八字 · 程序排盘 · AI 解读</p>
          <h1 className="hero-title" style={{ fontFamily: "'Ma Shan Zheng', cursive" }}><span className="text-gold">玄机</span></h1>
          <div className="hero-rule"><span>知其所来，明其所往</span></div>
          <p className="hero-lede">四柱由程序精确推算，AI 只负责读懂它。<br className="hidden sm:block" />不替你决定命运，只把此刻的命局讲清楚。</p>
        </motion.div>
      </section>

      <section className="relative z-10 pb-20 px-6">
        <FortuneForm
          mode="bazi"
          title="八字命理"
          description="填写出生信息。四柱、藏干、十神、神煞、五行、大运由程序排定，AI 据此解读命局格局、性情禀赋、事业财运与感情婚姻。"
        />
      </section>

      <section className="relative z-10 py-20 px-6 bg-mystic-900/50">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-16">
            <p className="section-eyebrow">三步</p>
            <h2 className="text-3xl md:text-4xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>怎么排，怎么解</h2>
            <p className="text-paper-100/45 text-sm tracking-wider">能算的归代码，能解的归模型。</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
            {STEPS.map((step, i) => (
              <motion.div key={step.char} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.55, delay: i * 0.12 }} className="text-center">
                <div className="flex justify-center mb-5"><Seal char={step.char} size={56} /></div>
                <h3 className="text-lg text-gold mb-3" style={{ fontFamily: "'Noto Serif SC', serif" }}>{step.title}</h3>
                <p className="text-paper-100/55 text-sm leading-loose max-w-xs mx-auto">{step.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-6 bg-mystic-900/50">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>随缘布施，心诚则灵</h2>
            <p className="text-paper-100/40 text-sm tracking-wider">量力而行，随心随缘</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1 }} className="mystic-card rounded-lg p-8 text-center">
              <h3 className="text-lg text-paper-100/70 mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>单次</h3>
              <div className="price-tag mb-4 justify-center"><span className="symbol">¥</span><span className="amount">{formatPrice(MODES.bazi.price)}</span><span className="text-xs text-paper-100/40">/次</span></div>
              <ul className="text-paper-100/50 text-sm space-y-2 mb-6"><li>四柱命盘 + 五行分布</li><li>AI 深度解读</li><li className="text-paper-100/40">按次支付，不自动续费</li></ul>
              <Link href="#top" className="btn-mystic block text-center">开始排盘</Link>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }} className="rounded-lg p-8 text-center relative" style={{ background: "linear-gradient(135deg, rgba(201, 150, 58, 0.1) 0%, rgba(10, 10, 18, 0.95) 100%)", border: "1px solid rgba(201, 150, 58, 0.4)", boxShadow: "0 0 40px rgba(201, 150, 58, 0.1)" }}>
              <span className="badge-hot absolute top-3 right-3">推荐</span>
              <h3 className="text-lg text-gold mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>问道 · 会员</h3>
              <div className="price-tag mb-4 justify-center"><span className="symbol">¥</span><span className="amount">{formatPrice(monthPlan.price)}</span><span className="text-xs text-paper-100/40">/月</span></div>
              <ul className="text-paper-100/50 text-sm space-y-2 mb-6"><li className="text-gold-300">✓ 无限次排盘解读</li><li className="text-gold-300">✓ 专属大师寄语</li><li className="text-gold-300">✓ 排盘记录随时回看</li></ul>
              <Link href="/member" className="btn-primary block text-center">立即开通</Link>
              <p className="text-paper-100/45 text-xs mt-3">年付 {yuan(yearPlan.price)} 更划算</p>
            </motion.div>
          </div>
        </div>
      </section>

      <section id="faq" className="relative z-10 py-20 px-6 bg-mystic-900/50">
        <div className="max-w-3xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-14">
            <p className="section-eyebrow">常见问题</p>
            <h2 className="text-3xl md:text-4xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>你可能想问的</h2>
          </motion.div>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <motion.div key={item.q} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.08 }} className="mystic-card rounded-lg px-6 py-5">
                <h3 className="text-gold text-base mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>{item.q}</h3>
                <p className="text-paper-100/60 text-sm leading-loose">{item.a}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
            <div className="seal mx-auto mb-6">命</div>
            <h2 className="text-3xl md:text-4xl text-gold mb-6" style={{ fontFamily: "'Noto Serif SC', serif" }}>知己命，方能掌人生</h2>
            <p className="text-paper-100/40 text-sm leading-relaxed mb-8">古人云：&ldquo;不知命，无以为君子也。&rdquo;<br />了解自己的命理，不是迷信，而是更好地认识自己、规划人生。</p>
            <Link href="#top" className="btn-primary text-lg">开启命理探索</Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
