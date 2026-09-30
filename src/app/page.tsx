"use client";

import { motion } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneCard from "@/components/FortuneCard";
import { MODE_TRIGRAM, Seal } from "@/components/Glyph";
import { MODES, MEMBER_PLANS, FREE_DAILY_QUOTA, formatPrice, type Mode } from "@/lib/pricing";
import Link from "next/link";

// 副标题是文案，不属于价格，因此留在页面里
const SUBTITLES: Record<Mode, string> = {
  daily: "每日免费，AI 解读当日吉凶宜忌",
  oracle: "古刹灵签免费求，AI 解签指点迷津",
  bazi: "子平八字，紫微斗数。深度排盘解析命局格局、事业财运、感情婚姻",
  tarot: "三张牌阵，AI 解牌。融合东西方占卜智慧，解答心中困惑",
  love: "月老牵线，命盘合婚。看两人前世今生缘分，获相处锦囊",
};

// 沿用原文件已有的标识符名 FORTUNE_MODES —— 它在渲染处被引用，改名要多动一处
const FORTUNE_MODES = (Object.keys(MODES) as Mode[]).map((mode, i) => ({
  mode,
  trigram: MODE_TRIGRAM[mode],
  title: MODES[mode].title,
  subtitle: SUBTITLES[mode],
  price: MODES[mode].price === 0 ? "免费" : formatPrice(MODES[mode].price),
  // 只有八字带角标。给多数卡片都挂"热门"，等于没有推荐 ——
  // 免费与否已经由价格区自己说明了，不需要再加一枚"免费"角标。
  tag: mode === "bazi" ? "热门" : undefined,
  href: `/fortune/${mode}`,
  delay: 0.1 * (i + 1),
}));

// 单次测算最低价，用于"随缘"卡片的"¥X 起"
const PAID_PRICES = (Object.keys(MODES) as Mode[])
  .map((m) => MODES[m].price)
  .filter((p) => p > 0);
const MIN_PRICE = formatPrice(Math.min(...PAID_PRICES));

const monthPlan = MEMBER_PLANS[0];
const yearPlan = MEMBER_PLANS[1];

const yuan = (n: number) => `¥${formatPrice(n)}`;

// 三步走的是「问 → 推 → 解」。用单字而不是 01/02/03 —— 这三步本身有先后语义，不是装饰性编号。
const STEPS = [
  { char: "问", title: "说出困惑", text: "选一种测算方式，填几项必要信息。运势与灵签当场可看，无需注册。" },
  { char: "推", title: "起盘推演", text: "AI 结合五行生克与卦象，推演你此刻的处境与可能的走向。" },
  { char: "解", title: "得到指引", text: "不是判决，是把你眼下这团困惑，梳理成一份读得懂的参照。" },
];

// 提问按真实疑虑排序：准不准 → 隐私 → 门槛 → 钱。前两个不答清楚，后面两个没人看。
const FAQ = [
  {
    q: "算得准吗？",
    a: "命理是一套理解自己的框架，不是预言。我们不承诺预测未来，只把传统的推演逻辑讲清楚，供你参照。",
  },
  {
    q: "我的出生信息会被存下来吗？",
    a: "免费测算的记录只保存在你自己浏览器的本地存储里，不会上传，我们也看不到。清空浏览器数据即彻底删除。",
  },
  {
    q: "要注册才能用吗？",
    a: `不用。今日运势与灵签求签每天共 ${FREE_DAILY_QUOTA} 次免费，填完信息直接出结果。`,
  },
  {
    q: "怎么收费？",
    a: `八字命理 ${yuan(MODES.bazi.price)}、AI 塔罗 ${yuan(MODES.tarot.price)}、姻缘配对 ${yuan(MODES.love.price)}，按次支付，不做自动续费。会员 ${yuan(monthPlan.price)}/月，全模式无限次。`,
  },
];

export default function Home() {

  return (
    <div className="min-h-screen relative">
      <Particles /><Header /><div className="ink-bg" />

      <section className="hero-stage relative z-10 min-h-screen flex flex-col items-center justify-center px-6 pt-20">
        <motion.div initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, ease: "easeOut" }} className="hero-constellation pointer-events-none" aria-hidden="true">
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
          <p className="hero-kicker">东方命理 · AI 解读 · 为当下而问</p>
          <h1 className="hero-title" style={{ fontFamily: "'Ma Shan Zheng', cursive" }}><span className="text-gold">玄机</span></h1>
          <div className="hero-rule"><span>知其所来，明其所往</span></div>
          <p className="hero-lede">不替你决定命运，只为你把此刻的困惑<br className="hidden sm:block" />梳理成一份可以理解的指引。</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/fortune/daily" aria-label="前往今日运势" className="btn-primary">立即看今日运势 <span aria-hidden="true">→</span></Link>
            <Link href="#modes" className="btn-mystic">探索全部测算</Link>
          </div>
          <p className="hero-note">今日运势与灵签可免费体验 · 无需注册</p>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2, duration: 0.8 }} className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <span className="text-paper-100/20 text-xs tracking-widest">选择一种方式，开始提问</span>
          <div className="w-4 h-6 border border-gold-300/20 rounded-full flex justify-center"><motion.div className="w-1 h-1.5 bg-gold-400/50 rounded-full mt-1" animate={{ y: [0, 4, 0] }} transition={{ duration: 2, repeat: Infinity }} /></div>
        </motion.div>
      </section>

      <section id="modes" className="relative z-10 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-16">
            <p className="section-eyebrow">从一个问题开始</p>
            <h2 className="text-3xl md:text-4xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>择一法，看见心中答案</h2>
            <p className="text-paper-100/45 text-sm tracking-wider">五种方式，各有一问。先选最贴近你此刻心事的那一种。</p>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{FORTUNE_MODES.map((mode) => (<FortuneCard key={mode.title} {...mode} />))}</div>
        </div>
      </section>

      <section className="relative z-10 py-24 px-6 bg-mystic-900/50">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-16">
            <p className="section-eyebrow">三步</p>
            <h2 className="text-3xl md:text-4xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>怎么问，怎么解</h2>
            <p className="text-paper-100/45 text-sm tracking-wider">填几项信息，等一会儿，读一份能看懂的解读。</p>
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

      <section className="relative z-10 py-24 px-6 bg-mystic-900/50">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl text-gold mb-4" style={{ fontFamily: "'Noto Serif SC', serif" }}>随缘布施，心诚则灵</h2>
            <p className="text-paper-100/40 text-sm tracking-wider">量力而行，随心随缘</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1 }} className="mystic-card rounded-lg p-8 text-center">
              <h3 className="text-lg text-paper-100/70 mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>结缘</h3>
              <div className="price-tag mb-4 justify-center"><span className="amount" style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e8cf8d" }}>免费</span></div>
              <ul className="text-paper-100/40 text-sm space-y-2 mb-6"><li className="text-gold-300">✓ 今日运势 · AI 解读</li><li className="text-gold-300">✓ 灵签求签 · AI 解签</li><li>每日共 {FREE_DAILY_QUOTA} 次</li><li>无需付费，永久免费</li></ul>
              <Link href="/fortune/daily" className="btn-mystic block text-center">免费体验</Link>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }} className="rounded-lg p-8 text-center relative" style={{ background: "linear-gradient(135deg, rgba(201, 150, 58, 0.1) 0%, rgba(10, 10, 18, 0.95) 100%)", border: "1px solid rgba(201, 150, 58, 0.4)", boxShadow: "0 0 40px rgba(201, 150, 58, 0.1)" }}>
              <span className="badge-hot absolute top-3 right-3">推荐</span>
              <h3 className="text-lg text-gold mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>问道 · 会员</h3>
              <div className="price-tag mb-4 justify-center"><span className="symbol">¥</span><span className="amount">{formatPrice(monthPlan.price)}</span><span className="text-xs text-paper-100/40">/月</span></div>
              <ul className="text-paper-100/50 text-sm space-y-2 mb-6"><li className="text-gold-300">✓ 全模式无限次解读</li><li className="text-gold-300">✓ 八字 · 塔罗 · 姻缘全解锁</li><li className="text-gold-300">✓ 专属大师寄语</li><li className="text-gold-300">✓ 测算记录随时回看</li></ul>
              <Link href="/member" className="btn-primary block text-center">立即开通</Link>
              <p className="text-paper-100/45 text-xs mt-3">一杯奶茶钱，无限次算命 · 年付 {yuan(yearPlan.price)} 更划算</p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.3 }} className="mystic-card rounded-lg p-8 text-center">
              <h3 className="text-lg text-paper-100/70 mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>随缘</h3>
              <div className="price-tag mb-4 justify-center"><span className="symbol">¥</span><span className="amount">{MIN_PRICE}</span><span className="text-xs text-paper-100/40">起</span></div>
              <ul className="text-paper-100/50 text-sm space-y-2 mb-6"><li>八字 · 塔罗 · 姻缘</li><li>单次付费，用完即走</li><li>无自动续费</li></ul>
              <Link href="#modes" className="btn-mystic block text-center">按次购买</Link>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 px-6 bg-mystic-900/50">
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

      <section className="relative z-10 py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
            <div className="seal mx-auto mb-6">命</div>
            <h2 className="text-3xl md:text-4xl text-gold mb-6" style={{ fontFamily: "'Noto Serif SC', serif" }}>知己命，方能掌人生</h2>
            <p className="text-paper-100/40 text-sm leading-relaxed mb-8">古人云：&ldquo;不知命，无以为君子也。&rdquo;<br />了解自己的命理，不是迷信，而是更好地认识自己、规划人生。</p>
            <Link href="/fortune/bazi" className="btn-primary text-lg">开启命理探索</Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
