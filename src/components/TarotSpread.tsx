"use client";

import { motion } from "framer-motion";
import type { TarotDraw, DrawnCard, Suit } from "@/lib/tarot";

/**
 * 三张牌阵。
 *
 * 78 张牌的插画画不出来，也不该硬凑；这里用花色符号 + 罗马数字做牌面，
 * 与站点既有的爻线语言是一路的 —— 符号驱动，不依赖任何图片资源。
 * 逆位时把符号倒转，牌名保持正读（可读性优先于形式）。
 */
const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

function SuitMark({ suit, arcana, size = 40 }: { suit?: Suit; arcana: "major" | "minor"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none" as const, "aria-hidden": true as const };

  if (arcana === "major") {
    // 大阿卡纳：八角星
    return (
      <svg {...common}>
        <path d="M12 2l2.6 6.4L21 11l-6.4 2.6L12 20l-2.6-6.4L3 11l6.4-2.6z" fill="currentColor" opacity=".9" />
        <path d="M12 6.5l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5L7 11l3.5-1.5z" fill="#0a0a12" />
      </svg>
    );
  }

  switch (suit) {
    case "权杖":
      return (
        <svg {...common}>
          <path d="M12 5v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="4.5" r="2.8" fill="currentColor" />
          <path d="M7 20h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "圣杯":
      return (
        <svg {...common}>
          <path d="M6 4h12l-1.4 6.2A4.8 4.8 0 0 1 12 14a4.8 4.8 0 0 1-4.6-3.8z" fill="currentColor" />
          <path d="M12 14v5M8.5 20h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "宝剑":
      return (
        <svg {...common}>
          <path d="M12 2l2.4 11H9.6z" fill="currentColor" />
          <path d="M6 14.5h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12 14.5V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "星币":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

function CardFace({ card, index }: { card: DrawnCard; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, rotateY: 90 }}
      animate={{ opacity: 1, rotateY: 0 }}
      transition={{ duration: 0.55, delay: 0.15 + index * 0.28, ease: "easeOut" }}
      className="flex-1 min-w-0"
    >
      <p className="text-center text-[11px] tracking-[0.25em] text-paper-100/45 mb-3">{card.position}</p>

      <div
        className={`rounded-lg border px-3 py-5 h-full flex flex-col items-center ${
          card.upright ? "border-gold-300/25 bg-mystic-800/50" : "border-paper-100/15 bg-mystic-900/60"
        }`}
      >
        <span className="text-[11px] tracking-widest text-gold-400/70 tabular-nums">{card.numeral}</span>

        <div
          className="my-4 text-gold-300"
          style={{ transform: card.upright ? "none" : "rotate(180deg)" }}
        >
          <SuitMark suit={card.suit} arcana={card.arcana} size={40} />
        </div>

        <p className="text-base text-gold text-center leading-snug" style={SERIF}>
          {card.name}
        </p>
        <p className="text-[10px] text-paper-100/30 text-center mt-1 tracking-wide">{card.nameEn}</p>

        <p className="text-[11px] text-paper-100/55 text-center mt-3 leading-relaxed">{card.keyword}</p>

        {!card.upright && (
          <span className="mt-3 text-[10px] tracking-[0.2em] text-paper-100/40 border border-paper-100/15 rounded px-2 py-0.5">
            逆位
          </span>
        )}
      </div>
    </motion.div>
  );
}

export default function TarotSpread({ draw }: { draw: TarotDraw }) {
  return (
    <section className="mystic-card rounded-xl p-6 sm:p-8" aria-label="塔罗牌阵">
      <header className="flex items-baseline justify-between mb-7">
        <h3 className="text-lg text-gold" style={SERIF}>
          牌阵
        </h3>
        <p className="text-paper-100/40 text-xs tracking-wider">过去 · 现在 · 未来</p>
      </header>

      <div className="flex gap-3 sm:gap-4">
        {draw.cards.map((card, i) => (
          <CardFace key={`${card.position}-${card.name}`} card={card} index={i} />
        ))}
      </div>
    </section>
  );
}
