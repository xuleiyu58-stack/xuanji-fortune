"use client";

import { motion } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneCard from "@/components/FortuneCard";
import Link from "next/link";

const FORTUNE_MODES = [
  {
    icon: "🎯",
    title: "今日运势",
    subtitle: "每日一签，洞悉天机。AI 解读当日吉凶宜忌，助你趋吉避凶",
    price: "6.6",
    href: "/fortune/daily",
    delay: 0.1,
  },
  {
    icon: "📅",
    title: "八字命理",
    subtitle: "子平八字，紫微斗数。深度排盘解析命局格局、事业财运、感情婚姻",
    price: "18.8",
    tag: "热门",
    href: "/fortune/bazi",
    delay: 0.2,
  },
  {
    icon: "💑",
    title: "姻缘配对",
    subtitle: "月老牵线，命盘合婚。看两人前世今生缘分，获相处锦囊",
    price: "36.9",
    href: "/fortune/love",
    delay: 0.3,
  },
  {
    icon: "🃏",
    title: "AI 塔罗",
    subtitle: "三张牌阵，AI 解牌。融合东西方占卜智慧，解答心中困惑",
    price: "8.8",
    href: "/fortune/tarot",
    delay: 0.4,
  },
  {
    icon: "🏮",
    title: "灵签求签",
    subtitle: "千年古刹，AI 解签。典故为引，智慧为舟，指点迷津",
    price: "5.8",
    href: "/fortune/oracle",
    delay: 0.5,
  },
];

const TESTIMONIALS = [
  { name: "林*月", text: "太准了！说我这个月有贵人运，结果真的遇到了事业上的贵人", rating: 5 },
  { name: "张*明", text: "八字分析特别详细，比线下找的师傅还专业，性价比超高", rating: 5 },
  { name: "王*琪", text: "塔罗占卜帮我走出了感情困惑，AI 解牌的角度很新鲜", rating: 5 },
  { name: "陈*宇", text: "每日运势已经成了我的晨间仪式感，时不时还有惊喜", rating: 4 },
];

export default function Home() {
  return (
    <div className="min-h-screen relative">
      <Particles />
      <Header />
      <div className="ink-bg" />

      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 pt-16">
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 0.06, scale: 1 }}
          transition={{ duration: 2, ease: "easeOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        >
          <svg width="500" height="500" viewBox="0 0 100 100" className="bagua-spin">
            <circle cx="50" cy="50" r="48" fill="none" stroke="#c9963a" strokeWidth="0.3" />
            <circle cx="50" cy="50" r="24" fill="none" stroke="#c9963a" strokeWidth="0.3" />
            <path d="M50 2 A48 48 0 0 1 50 98 A24 24 0 0 0 50 2" fill="rgba(201,150,58,0.15)" />
            <circle cx="50" cy="26" r="5" fill="#c9963a" opacity="0.4" />
            <circle cx="50" cy="74" r="5" fill="#c9963a" opacity="0.4" />
            <circle cx="26" cy="50" r="2" fill="#c9963a" opacity="0.3" />
            <circle cx="74" cy="50" r="2" fill="#c9963a" opacity="0.3" />
          </svg>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="text-center relative"
        >
          <h1
            className="text-7xl sm:text-8xl md:text-9xl mb-4"
            style={{ fontFamily: "'Ma Shan Zheng', cursive" }}
          >
            <span className="text-gold">玄机</span>
          </h1>
          <p
            className="text-paper-100/40 text-sm sm:text-base tracking-[0.3em] mb-8"
            style={{ fontFamily: "'Noto Serif SC', serif" }}
          >
            千年玄学智慧 · 人工智能解读
          </p>
          <p className="text-paper-100/50 text-sm leading-relaxed max-w-md mx-auto mb-10">
            融合易经八卦、子平八字、塔罗占卜等东西方玄学体系
            <br />
            以 AI 之力，为你拨开命运迷雾
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="#modes" className="btn-primary">
              开始测算
            </Link>
            <Link href="/fortune/daily" className="btn-mystic">
              免费体验今日运势
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 0.8 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className="text-paper-100/20 text-xs tracking-widest">向下探索</span>
          <div className="w-4 h-6 border border-gold-300/20 rounded-full flex justify-center">
            <motion.div
              className="w-1 h-1.5 bg-gold-400/50 rounded-full mt-1"
              animate={{ y: [0, 4, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>
        </motion.div>
      </section>

      <section id="modes" className="relative z-10 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2
              className="text-3xl md:text-4xl text-gold mb-4"
              style={{ fontFamily: "'Noto Serif SC', serif" }}
            >
              择一法，窥天机
            </h2>
            <p className="text-paper-100/40 text-sm tracking-wider">
              五种测算方式，总有一款适合你的困惑
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FORTUNE_MODES.map((mode) => (
              <FortuneCard key={mode.title} {...mode} />
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 px-6 bg-mystic-900/50">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2
              className="text-3xl md:text-4xl text-gold mb-4"
              style={{ fontFamily: "'Noto Serif SC', serif" }}
            >
              随缘布施，心诚则灵
            </h2>
            <p className="text-paper-100/40 text-sm tracking-wider">
              量力而行，随心随缘
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mystic-card rounded-lg p-8 text-center"
            >
              <h3 className="text-lg text-paper-100/70 mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                结缘
              </h3>
              <div className="price-tag mb-4 justify-center">
                <span className="symbol">¥</span>
                <span className="amount">0</span>
              </div>
              <ul className="text-paper-100/40 text-sm space-y-2 mb-6">
                <li>每日运势一句话</li>
                <li>基础签文速览</li>
                <li className="text-paper-100/20 line-through">AI 深度解读</li>
                <li className="text-paper-100/20 line-through">详细命理分析</li>
              </ul>
              <Link href="/fortune/daily" className="btn-mystic block text-center">
                免费体验
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="rounded-lg p-8 text-center relative"
              style={{
                background: "linear-gradient(135deg, rgba(201, 150, 58, 0.1) 0%, rgba(10, 10, 18, 0.95) 100%)",
                border: "1px solid rgba(201, 150, 58, 0.4)",
                boxShadow: "0 0 40px rgba(201, 150, 58, 0.1)",
              }}
            >
              <span className="badge-hot absolute top-3 right-3">推荐</span>
              <h3 className="text-lg text-gold mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                问道 · 会员
              </h3>
              <div className="price-tag mb-4 justify-center">
                <span className="symbol">¥</span>
                <span className="amount">28.8</span>
                <span className="text-xs text-paper-100/40">/月</span>
              </div>
              <ul className="text-paper-100/50 text-sm space-y-2 mb-6">
                <li className="text-gold-300">✓ 全模式无限次解读</li>
                <li className="text-gold-300">✓ AI 深度命理分析</li>
                <li className="text-gold-300">✓ 专属大师寄语</li>
                <li className="text-gold-300">✓ 优先体验新功能</li>
              </ul>
              <Link href="/fortune/bazi" className="btn-primary block text-center">
                立即开通
              </Link>
              <p className="text-paper-100/20 text-xs mt-3">
                年付 ¥88（省 ¥257）· 算 3 次就回本
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mystic-card rounded-lg p-8 text-center"
            >
              <h3 className="text-lg text-paper-100/70 mb-2" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                随缘
              </h3>
              <div className="price-tag mb-4 justify-center">
                <span className="symbol">¥</span>
                <span className="amount">5.8</span>
                <span className="text-xs text-paper-100/40">起</span>
              </div>
              <ul className="text-paper-100/40 text-sm space-y-2 mb-6">
                <li>单次深度解读</li>
                <li>按需付费，用完即走</li>
                <li>支持所有测算模式</li>
                <li>无自动续费</li>
              </ul>
              <Link href="#modes" className="btn-mystic block text-center">
                按次购买
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h2
              className="text-2xl md:text-3xl text-gold mb-3"
              style={{ fontFamily: "'Noto Serif SC', serif" }}
            >
              善信反馈
            </h2>
            <p className="text-paper-100/30 text-sm tracking-wider">
              已有 10,000+ 人通过玄机获得了命运指引
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TESTIMONIALS.map((t, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="mystic-card rounded-lg p-6"
              >
                <div className="flex items-center gap-1 mb-3">
                  {[...Array(t.rating)].map((_, j) => (
                    <span key={j} className="text-gold-400 text-sm">★</span>
                  ))}
                </div>
                <p className="text-paper-100/60 text-sm leading-relaxed mb-3">
                  &ldquo;{t.text}&rdquo;
                </p>
                <span className="text-paper-100/30 text-xs">{t.name}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="seal mx-auto mb-6">命</div>
            <h2
              className="text-3xl md:text-4xl text-gold mb-6"
              style={{ fontFamily: "'Noto Serif SC', serif" }}
            >
              知己命，方能掌人生
            </h2>
            <p className="text-paper-100/40 text-sm leading-relaxed mb-8">
              古人云：&ldquo;不知命，无以为君子也。&rdquo;
              <br />
              了解自己的命理，不是迷信，而是更好地认识自己、规划人生。
            </p>
            <Link href="/fortune/bazi" className="btn-primary text-lg">
              开启命理探索
            </Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
