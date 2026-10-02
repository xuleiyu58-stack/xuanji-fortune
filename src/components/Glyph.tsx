/**
 * 卦象爻线 —— 全站唯一的图标语言。
 *
 * 用《易经》的爻线取代 emoji：爻线是这个主题自己的字母表，
 * 单色、可缩放、跨平台渲染一致，且能被 currentColor 驱动。
 *
 * 每条爻自下而上读，这里按 上→下 的绘制顺序存放。
 */

export type Trigram = "qian" | "kun" | "li" | "dui" | "zhen";

/** true = 阳爻（实线），false = 阴爻（断线）。数组顺序为 上、中、下。 */
const BARS: Record<Trigram, readonly [boolean, boolean, boolean]> = {
  qian: [true, true, true], // 乾 ☰ 天
  kun: [false, false, false], // 坤 ☷ 地
  li: [true, false, true], // 离 ☲ 火
  dui: [false, true, true], // 兑 ☱ 泽
  zhen: [false, false, true], // 震 ☳ 雷
};

/**
 * 全站只做八字，命盘取坤 ——「地势坤，君子以厚德载物」，与命局之基相称。
 *
 * 曾有一张 MODE_TRIGRAM 把五种测算各配一卦；模式删到只剩一个之后，
 * 那张表就只剩一行，是纯粹的多余间接层，一并去掉。
 */
export const CHART_TRIGRAM: Trigram = "kun";

interface GlyphProps {
  trigram: Trigram;
  /** 渲染宽度（像素）。高度按 24:20 自动推导。 */
  size?: number;
  className?: string;
}

const BAR_W = 20;
const BAR_H = 3;
const BROKEN_GAP = 6;
const SEG_W = (BAR_W - BROKEN_GAP) / 2;

export default function Glyph({ trigram, size = 24, className }: GlyphProps) {
  const bars = BARS[trigram];

  return (
    <svg
      width={size}
      height={size * 0.8333}
      viewBox="0 0 24 20"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((solid, i) => {
        const y = 0.5 + i * 8;
        return solid ? (
          <rect key={i} x={2} y={y} width={BAR_W} height={BAR_H} rx={1.2} fill="currentColor" />
        ) : (
          <g key={i}>
            <rect x={2} y={y} width={SEG_W} height={BAR_H} rx={1.2} fill="currentColor" />
            <rect
              x={2 + SEG_W + BROKEN_GAP}
              y={y}
              width={SEG_W}
              height={BAR_H}
              rx={1.2}
              fill="currentColor"
            />
          </g>
        );
      })}
    </svg>
  );
}

interface SealProps {
  /** 单字或双字，建议不超过两字 */
  char: string;
  size?: number;
  className?: string;
}

/** 印章 —— 用于会员等级、状态一类需要"钤记"感的标记。 */
export function Seal({ char, size = 40, className }: SealProps) {
  return (
    <span
      className={`glyph-seal ${className ?? ""}`}
      style={{ width: size, height: size, fontSize: size * 0.44 }}
      aria-hidden="true"
    >
      {char}
    </span>
  );
}
