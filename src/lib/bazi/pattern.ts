/**
 * 格局 —— 月令取格。
 *
 * 八字看命，先看月令。月令是一个人出生时天地之气的主气，所以「格」从月支上取。
 * 取法（透明化，界面会把过程写出来）：
 *
 *   1. 先看月支**本气**（藏干第一位）对日主的十神；
 *   2. 本气是 官杀 / 财 / 印 / 食伤 → 即以为格（正官格、正财格…）；
 *   3. 本气是比劫 → 不再往下看中气余气，直接判 建禄格 / 羊刃格 / 比劫格。
 *      **这一步是关键**：甲日生寅月，寅藏甲丙戊，若让循环落到中气丙就会取成
 *      「食神格」，而寅正是甲的禄位 —— 那应当是建禄格。月令本气为比劫时，
 *      中余气不参与取格，这是子平法的通行口径。
 *   4. 本气若在天干上出现，称为「透」，格更清更有力 —— 单独标出来。
 *
 * 各家对取格的分歧很大（有专取本气的，有以透干为先的，有另论外格的）。
 * 这里取最容易讲清楚的一套，并把「为什么取到这个格」一并输出，
 * 让用户能自己对着盘核验，而不是只能听结论。
 */

import {
  CHANG_SHENG_START, ZHI, ZHI_HIDE_GAN, ganIsYang,
  type ShiShen,
} from "./constants.ts";
import { shiShenOf, SHI_SHEN_MEANING } from "./relations.ts";

export interface PatternPillar {
  label: string;
  gan: string;
  zhi: string;
}

export interface PatternInput {
  dayGan: string;
  pillars: readonly PatternPillar[];
}

export interface PatternResult {
  /** 格名，如「正官格」「建禄格」 */
  name: string;
  /** 取格所依的十神；建禄 / 羊刃 / 比劫格为 null */
  shiShen: ShiShen | null;
  /** 取格依据，如「月支本气」 */
  basis: string;
  /** 该藏干是否透出天干 */
  transparent: boolean;
  /** 一句人话 */
  plain: string;
  /** 取格的推理过程，界面摊开给用户看 */
  note: string;
}

const PATTERN_PLAIN: Record<string, string> = {
  正官格: "重规矩、讲责任，做事有分寸。适合体制内、大机构，或需要长期积累信誉的行当。",
  七杀格: "有魄力、能扛压，越是难啃的局越出成绩。适合竞争激烈或需要拍板的领域。",
  正财格: "务实、攒得住。适合稳定经营与按部就班的积累，不喜投机。",
  偏财格: "善抓机会、人脉广，财路活。适合贸易、投资、多元经营，但需防财来财去太快。",
  正印格: "重学识、有长辈缘。适合学术、教育、文化一类靠积累与口碑的路径。",
  偏印格: "直觉强、路子偏，喜欢钻研冷门。适合技术、艺术、玄学等专门领域。",
  食神格: "性情温和、有才艺与口福。适合文化、创作、餐饮、服务一类与人打交道的事。",
  伤官格: "才华外露、表达力强，不服管。适合创作、表演、技术，宜找容得下个性的地方。",
  建禄格: "月令正是日主的禄位，主自立自强。靠自己的本事吃饭，多白手起家。",
  羊刃格: "月令为日主的帝旺之地，性刚而果决。宜以专业立身，忌争强斗狠。",
  比劫格: "月令之气与日主同类，主自立与竞争。凡事靠自己，也容易与人相争。",
};

const PLAIN_FALLBACK = "此格较为少见，宜结合全局与大运参看。";

/** 日干在某个地支上是十二长生的第几位（长生=0…养=11）。取不到返回 -1。 */
function changShengStep(gan: string, zhi: string): number {
  const start = CHANG_SHENG_START[gan];
  if (!start) return -1;
  const startIdx = (ZHI as readonly string[]).indexOf(start);
  const zhiIdx = (ZHI as readonly string[]).indexOf(zhi);
  if (startIdx < 0 || zhiIdx < 0) return -1;
  return ganIsYang(gan)
    ? (zhiIdx - startIdx + 12) % 12
    : (startIdx - zhiIdx + 12) % 12;
}

const isLu = (gan: string, zhi: string) => changShengStep(gan, zhi) === 3; // 临官
const isDiWang = (gan: string, zhi: string) => changShengStep(gan, zhi) === 4; // 帝旺

export function analyzePattern(input: PatternInput): PatternResult | null {
  const month = input.pillars.find((p) => p.label === "月柱");
  if (!month) return null;

  const hides = ZHI_HIDE_GAN[month.zhi] ?? [];
  if (hides.length === 0) return null;

  const benGan = hides[0]; // 本气
  const benShen = shiShenOf(input.dayGan, benGan);
  const transparent = input.pillars.map((p) => p.gan).includes(benGan);

  // 本气为比劫 —— 中余气不参与取格，走建禄 / 羊刃 / 比劫
  if (benShen === "比肩" || benShen === "劫财") {
    if (isLu(input.dayGan, month.zhi)) {
      return {
        name: "建禄格",
        shiShen: null,
        basis: "月支为日主禄位",
        transparent: false,
        plain: PATTERN_PLAIN["建禄格"],
        note: `月支${month.zhi}正是日主${input.dayGan}的临官（禄）之位。月令本气${benGan}与日主同类，不论中余气，故取建禄格。`,
      };
    }
    if (isDiWang(input.dayGan, month.zhi) && ganIsYang(input.dayGan)) {
      return {
        name: "羊刃格",
        shiShen: null,
        basis: "月支为日主帝旺之地",
        transparent: false,
        plain: PATTERN_PLAIN["羊刃格"],
        note: `月支${month.zhi}是日主${input.dayGan}的帝旺之地（羊刃）。月令本气${benGan}与日主同类，故取羊刃格。`,
      };
    }
    return {
      name: "比劫格",
      shiShen: null,
      basis: "月支本气与日主同类",
      transparent: false,
      plain: PATTERN_PLAIN["比劫格"],
      note: `月支${month.zhi}本气${benGan}与日主${input.dayGan}同类，既非禄亦非刃，故以比劫论。`,
    };
  }

  // 本气为 官杀 / 财 / 印 / 食伤
  const name = `${benShen}格`;
  return {
    name,
    shiShen: benShen,
    basis: "月支本气",
    transparent,
    plain: PATTERN_PLAIN[name] ?? PLAIN_FALLBACK,
    // 措辞上刻意不让天干字紧挨着「未透」二字 —— 「丁未透天干」会被读成干支「丁未」，
    // 而这里说的是「丁 没有 透出天干」。换成「本气…」起头就不歧义了。
    note:
      `月支为${month.zhi}，本气藏${benGan}，${benGan}对日主${input.dayGan}为「${benShen}」，故取${name}。` +
      (transparent ? "本气透出天干，格局较清。" : "本气藏而不透，格局稍隐。"),
  };
}

/** 把格局的一句话说明单独取出来，供卡片式展示。 */
export function patternPlain(name: string): string {
  return PATTERN_PLAIN[name] ?? PLAIN_FALLBACK;
}

/** 十神解释的统一出口，界面不必再 import 两处。 */
export { SHI_SHEN_MEANING };
