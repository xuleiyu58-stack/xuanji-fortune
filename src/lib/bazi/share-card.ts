/**
 * 分享图的布局。
 *
 * 拆成「纯布局 + 薄渲染」两层：本文件只算出「在哪儿画什么」，
 * 交给 canvas 去画。这样布局能在 node --test 里直接验证 ——
 * canvas 是没法单测的，但「四柱有没有画上去」「有没有画出边界」可以。
 *
 * 生成路线是 canvas 2D 直接绘制，而不是「拼 SVG 再转图片」：
 * SVG 经 Image 载入时会脱离当前文档，页面加载的 webfont 用不上，
 * 中文会掉回系统默认字形，跟站内风格对不上。
 */

import { GAN_ELEMENT, ZHI_ELEMENT, type WuXing } from "./constants.ts";
import type { BaziChart } from "./index.ts";

export type ShareOp =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; radius?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string; strokeWidth?: number }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      color: string;
      align: "left" | "center" | "right";
      /** serif = 标题与干支；sans = 正文 */
      face?: "serif" | "sans";
      weight?: "normal" | "bold";
      /** 字距（canvas 的 letterSpacing 支持面窄，靠调用方逐字排版时用） */
      tracking?: number;
    };

/** 五行用色，与站内一致（去饱和后落在墨色底上）。 */
const EL: Record<WuXing, string> = {
  木: "#7fb08e",
  火: "#c9745a",
  土: "#c2a061",
  金: "#c3c9d4",
  水: "#7aa0c0",
};

const INK = "#0a0a12";
const GOLD = "#c9963a";
const GOLD_SOFT = "#e8cf8d";
const PAPER = "#e8e4dc";
const PAPER_DIM = "rgba(232,228,220,0.55)";
const PAPER_FAINT = "rgba(232,228,220,0.3)";

export const CARD_W = 750;
export const CARD_H = 1180;

function elementOf(gan: string, zhi: string, kind: "gan" | "zhi"): WuXing {
  return (kind === "gan" ? GAN_ELEMENT[gan] : ZHI_ELEMENT[zhi]) ?? "土";
}

/** 把一段长文本按每行最多 n 个字折行。中文按字宽算，够用。 */
export function wrapCJK(text: string, perLine: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, "");
  const lines: string[] = [];
  for (let i = 0; i < clean.length && lines.length < maxLines; i += perLine) {
    lines.push(clean.slice(i, i + perLine));
  }
  if (lines.length === maxLines && clean.length > perLine * maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, perLine - 1)}…`;
  }
  return lines;
}

/**
 * 算出整张分享图的绘制指令。
 *
 * 版式自上而下：品牌 → 四柱 → 一句结论 → 用神 → 强弱依据 → 出生信息 → 落款。
 * 先给「你是谁」（四柱），再给「结论」（强弱格局），最后才是依据 ——
 * 分享图是给人扫一眼的，顺序反了就没人看第二行。
 */
export function buildShareCard(chart: BaziChart): ShareOp[] {
  const ops: ShareOp[] = [];
  const W = CARD_W;
  const M = 56; // 左右留白
  const cx = W / 2;

  // 底色与描边
  ops.push({ kind: "rect", x: 0, y: 0, w: W, h: CARD_H, fill: INK });
  ops.push({ kind: "rect", x: 20, y: 20, w: W - 40, h: CARD_H - 40, fill: "transparent", radius: 18 });
  ops.push({ kind: "line", x1: M, y1: 96, x2: W - M, y2: 96, color: "rgba(201,150,58,0.35)", width: 1 });

  let y = 72;
  ops.push({ kind: "text", x: cx, y, text: "玄机 · 八字命理", size: 26, color: GOLD, align: "center", face: "serif", tracking: 4 });

  // ── 四柱 ──
  y = 190;
  const colW = (W - M * 2) / 4;
  chart.pillars.forEach((p, i) => {
    const px = M + colW * i + colW / 2;
    // 柱名与宫位
    ops.push({ kind: "text", x: px, y: y - 52, text: p.label, size: 17, color: PAPER_FAINT, align: "center", tracking: 3 });
    // 十神压在天干上方 —— 与站内一致，它描述的是天干
    ops.push({ kind: "text", x: px, y: y - 20, text: p.shiShen, size: 19, color: PAPER_DIM, align: "center" });
    // 天干 / 地支
    ops.push({ kind: "text", x: px, y: y + 34, text: p.gan, size: 58, color: EL[elementOf(p.gan, p.zhi, "gan")], align: "center", face: "serif" });
    ops.push({ kind: "text", x: px, y: y + 100, text: p.zhi, size: 58, color: EL[elementOf(p.gan, p.zhi, "zhi")], align: "center", face: "serif" });
  });

  ops.push({ kind: "line", x1: M, y1: 340, x2: W - M, y2: 340, color: "rgba(201,150,58,0.25)", width: 1 });

  // ── 结论 ──
  y = 412;
  const { strength, pattern } = chart;
  const headline = `${chart.dayMaster}${chart.dayMasterElement} · ${strength.verdict}${pattern ? ` · ${pattern.name}` : ""}`;
  ops.push({ kind: "text", x: cx, y, text: headline, size: 36, color: GOLD_SOFT, align: "center", face: "serif", tracking: 2 });

  // ── 用神喜忌 ──
  y = 500;
  const trio: { label: string; el: WuXing }[] = [
    { label: "用神", el: strength.yongShen },
    { label: "喜神", el: strength.xiShen },
    { label: "忌神", el: strength.jiShen },
  ];
  trio.forEach((t, i) => {
    const px = cx + (i - 1) * 170;
    ops.push({ kind: "text", x: px, y, text: t.label, size: 16, color: PAPER_FAINT, align: "center" });
    ops.push({ kind: "text", x: px, y: y + 54, text: t.el, size: 42, color: EL[t.el], align: "center", face: "serif" });
  });

  ops.push({ kind: "line", x1: M, y1: 610, x2: W - M, y2: 610, color: "rgba(201,150,58,0.2)", width: 1 });

  // ── 一句判断 ──
  y = 672;
  for (const line of wrapCJK(strength.summary, 22, 3)) {
    ops.push({ kind: "text", x: cx, y, text: line, size: 22, color: PAPER_DIM, align: "center" });
    y += 38;
  }

  // ── 十神最旺的那一组 ──
  const top = strength.groupPower[0];
  if (top) {
    y += 16;
    ops.push({ kind: "text", x: cx, y, text: `十神以「${top.group}」最重 · 占 ${top.percent}%`, size: 19, color: PAPER_FAINT, align: "center" });
  }

  // ── 出生信息 ──
  y = CARD_H - 190;
  ops.push({ kind: "line", x1: M, y1: y - 44, x2: W - M, y2: y - 44, color: "rgba(201,150,58,0.2)", width: 1 });
  ops.push({
    kind: "text", x: cx, y,
    text: `${chart.solarDate}　${chart.clockTime}　属${chart.zodiac}`,
    size: 19, color: PAPER_DIM, align: "center",
  });
  if (chart.trueSolarTime) {
    ops.push({
      kind: "text", x: cx, y: y + 30,
      text: `已按${chart.birthPlace ?? ""}校正真太阳时 ${chart.trueSolarTime}`,
      size: 16, color: PAPER_FAINT, align: "center",
    });
  }

  // ── 落款 ──
  ops.push({ kind: "text", x: cx, y: CARD_H - 78, text: "程序排盘 · AI 只做解读", size: 16, color: PAPER_FAINT, align: "center" });
  ops.push({ kind: "circle", cx: cx, cy: CARD_H - 128, r: 26, stroke: "rgba(201,150,58,0.45)", strokeWidth: 1 });
  ops.push({ kind: "text", x: cx, y: CARD_H - 118, text: "命", size: 26, color: GOLD, align: "center", face: "serif" });

  return ops;
}

/** 供界面判断这张图值不值得生成：没盘就没有分享图。 */
export function canShare(chart: BaziChart | null | undefined): chart is BaziChart {
  return Boolean(chart && chart.pillars?.length === 4);
}
