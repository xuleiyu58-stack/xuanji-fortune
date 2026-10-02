/**
 * 八字神煞。
 *
 * 神煞是命盘上最容易讲、也最容易被讲坏的一块 —— 江湖上常拿它吓人或哄人。
 * 这里的取舍是：只收有明确查法、且在命理界公认度高的十一種，每一种都给一句
 * 平实说明，并在明处注明它只是「倾向」而非定论。
 *
 * **不要与 lunar-typescript 的 `getDayJiShen()` / `getDayXiongSha()` 混淆** ——
 * 那是黄历的吉神凶煞（宜忌用的），与八字的取法完全是两套东西，不能拿来充数。
 *
 * 查法所依据的支，注明在每条规则的 `basis` 上：
 *   日干 / 年干 —— 天乙贵人、文昌、禄神、羊刃
 *   年支或日支 —— 桃花、驿马、华盖、将星（取"年支为主、日支为辅"，两支皆查）
 *   月支 —— 月德
 *   年支 —— 孤辰、寡宿
 */

export interface ShenShaPillar {
  label: string;
  gan: string;
  zhi: string;
}

export interface ShenShaInput {
  dayGan: string;
  pillars: readonly ShenShaPillar[];
}

export type ShenShaTone = "吉" | "凶" | "中性";

export interface ShenShaHit {
  name: string;
  /** 命中的那一个字（地支或天干） */
  hitOn: string;
  /** 落在哪一柱 */
  position: string;
  tone: ShenShaTone;
  /** 一句平实说明，界面直接显示 */
  plain: string;
}

/** 天乙贵人：日干或年干 → 所见之支 */
const TIAN_YI: Record<string, readonly string[]> = {
  甲: ["丑", "未"], 戊: ["丑", "未"], 庚: ["丑", "未"],
  乙: ["子", "申"], 己: ["子", "申"],
  丙: ["亥", "酉"], 丁: ["亥", "酉"],
  壬: ["卯", "巳"], 癸: ["卯", "巳"],
  辛: ["寅", "午"],
};

/** 文昌贵人：日干 → 所喜之支（即食神的临官位） */
const WEN_CHANG: Record<string, string> = {
  甲: "巳", 乙: "午", 丙: "申", 丁: "酉", 戊: "申",
  己: "酉", 庚: "亥", 辛: "子", 壬: "寅", 癸: "卯",
};

/** 禄神：日干 → 临官之支 */
const LU_SHEN: Record<string, string> = {
  甲: "寅", 乙: "卯", 丙: "巳", 丁: "午", 戊: "巳",
  己: "午", 庚: "申", 辛: "酉", 壬: "亥", 癸: "子",
};

/**
 * 羊刃：日干 → 帝旺之支。
 * 只论阳干 —— 阴干的羊刃各家分歧大（有说在临官、有说在帝旺前一位），
 * 与其混着用不如不收，界面上也不至于给人一个假精确。
 */
const YANG_REN: Record<string, string> = {
  甲: "卯", 丙: "午", 戊: "午", 庚: "酉", 壬: "子",
};

/** 三合局的组 → 桃花 / 驿马 / 华盖 / 将星 */
const GROUP_OF: Record<string, string> = {
  申: "水", 子: "水", 辰: "水",
  寅: "火", 午: "火", 戌: "火",
  巳: "金", 酉: "金", 丑: "金",
  亥: "木", 卯: "木", 未: "木",
};

const TAO_HUA: Record<string, string> = { 水: "酉", 火: "卯", 金: "午", 木: "子" };
const YI_MA: Record<string, string> = { 水: "寅", 火: "申", 金: "亥", 木: "巳" };
const HUA_GAI: Record<string, string> = { 水: "辰", 火: "戌", 金: "丑", 木: "未" };
const JIANG_XING: Record<string, string> = { 水: "子", 火: "午", 金: "酉", 木: "卯" };

/**
 * 三会方的分组 —— **与上面的三合局不是同一套，别混用**。
 *
 * 三合：申子辰(水) 寅午戌(火) 巳酉丑(金) 亥卯未(木)
 * 三会：亥子丑(水) 寅卯辰(木) 巳午未(火) 申酉戌(金)
 *
 * 同一个支在两套里归属不同（申在三合属水、在三会属金），
 * 神煞各有各的口径：桃花驿马华盖将星取三合，孤辰寡宿取三会。
 */
const HUI_GROUP: Record<string, string> = {
  亥: "水", 子: "水", 丑: "水",
  寅: "木", 卯: "木", 辰: "木",
  巳: "火", 午: "火", 未: "火",
  申: "金", 酉: "金", 戌: "金",
};

/** 孤辰寡宿：按年支所属的三会方 */
const GU_GUA: Record<string, { 孤辰: string; 寡宿: string }> = {
  水: { 孤辰: "寅", 寡宿: "戌" }, // 亥子丑
  木: { 孤辰: "巳", 寡宿: "丑" }, // 寅卯辰
  火: { 孤辰: "申", 寡宿: "辰" }, // 巳午未
  金: { 孤辰: "亥", 寡宿: "未" }, // 申酉戌
};

/** 月德贵人：月支所属三合局 → 所喜之天干 */
const YUE_DE: Record<string, string> = { 火: "丙", 水: "壬", 木: "甲", 金: "庚" };

interface Rule {
  name: string;
  tone: ShenShaTone;
  plain: string;
  /** 返回该神煞落在哪些支（或干）上 */
  targets: (input: ShenShaInput) => readonly string[];
  basis: "日干" | "年干" | "年支" | "日支" | "月支";
  /** 只在日干为阳干时才算 */
  yangOnly?: boolean;
}

const RULES: Rule[] = [
  {
    name: "天乙贵人",
    tone: "吉",
    basis: "日干",
    plain: "命中第一等的吉神。主逢凶化吉、遇难有人搭手，一生多遇贵人。",
    targets: (i) => TIAN_YI[i.dayGan] ?? [],
  },
  {
    name: "文昌贵人",
    tone: "吉",
    basis: "日干",
    plain: "主聪明好学、文思敏捷，读书与考试上常有优势。",
    targets: (i) => (WEN_CHANG[i.dayGan] ? [WEN_CHANG[i.dayGan]] : []),
  },
  {
    name: "禄神",
    tone: "吉",
    basis: "日干",
    plain: "主衣食丰足、身体康健，也主有稳当的进项。",
    targets: (i) => (LU_SHEN[i.dayGan] ? [LU_SHEN[i.dayGan]] : []),
  },
  {
    name: "羊刃",
    tone: "凶",
    basis: "日干",
    yangOnly: true,
    plain: "主性情刚烈、行事果决。宜以专业与魄力成事，不宜争强斗狠。",
    targets: (i) => (YANG_REN[i.dayGan] ? [YANG_REN[i.dayGan]] : []),
  },
  {
    name: "桃花",
    tone: "中性",
    basis: "年支",
    plain: "主人缘与异性缘。用在正处是魅力与亲和力，用在偏处则易生感情纠葛。",
    targets: (i) => {
      const out = new Set<string>();
      for (const p of i.pillars) {
        if (p.label !== "年柱" && p.label !== "日柱") continue;
        const g = GROUP_OF[p.zhi];
        if (g && TAO_HUA[g]) out.add(TAO_HUA[g]);
      }
      return [...out];
    },
  },
  {
    name: "驿马",
    tone: "中性",
    basis: "日支",
    plain: "主奔波与变动。多半是离乡发展、常出差、工作常换，动中求财。",
    targets: (i) => {
      const out = new Set<string>();
      for (const p of i.pillars) {
        if (p.label !== "年柱" && p.label !== "日柱") continue;
        const g = GROUP_OF[p.zhi];
        if (g && YI_MA[g]) out.add(YI_MA[g]);
      }
      return [...out];
    },
  },
  {
    name: "华盖",
    tone: "中性",
    basis: "日支",
    plain: "主孤高与艺术气质。喜独处、有才艺或信仰倾向，但容易觉得旁人不理解自己。",
    targets: (i) => {
      const out = new Set<string>();
      for (const p of i.pillars) {
        if (p.label !== "年柱" && p.label !== "日柱") continue;
        const g = GROUP_OF[p.zhi];
        if (g && HUA_GAI[g]) out.add(HUA_GAI[g]);
      }
      return [...out];
    },
  },
  {
    name: "将星",
    tone: "吉",
    basis: "日支",
    plain: "主领导与掌控力。在团队里容易担纲，适合做需要拍板的事。",
    targets: (i) => {
      const out = new Set<string>();
      for (const p of i.pillars) {
        if (p.label !== "年柱" && p.label !== "日柱") continue;
        const g = GROUP_OF[p.zhi];
        if (g && JIANG_XING[g]) out.add(JIANG_XING[g]);
      }
      return [...out];
    },
  },
  {
    name: "月德贵人",
    tone: "吉",
    basis: "月支",
    plain: "主心地宽厚、逢凶化吉，一生少遇大灾大难。",
    targets: (i) => {
      const month = i.pillars.find((p) => p.label === "月柱");
      if (!month) return [];
      const g = GROUP_OF[month.zhi];
      return g && YUE_DE[g] ? [YUE_DE[g]] : [];
    },
  },
  {
    name: "孤辰",
    tone: "凶",
    basis: "年支",
    plain: "主性情独立、不喜依附。常见于独来独往或晚婚的人，不是坏事，只是需要留意别把自己关起来。",
    targets: (i) => {
      const year = i.pillars.find((p) => p.label === "年柱");
      if (!year) return [];
      const g = HUI_GROUP[year.zhi];
      return g ? [GU_GUA[g].孤辰] : [];
    },
  },
  {
    name: "寡宿",
    tone: "凶",
    basis: "年支",
    plain: "主感情上容易有距离感。与孤辰同见时更明显，宜主动经营亲近关系。",
    targets: (i) => {
      const year = i.pillars.find((p) => p.label === "年柱");
      if (!year) return [];
      const g = HUI_GROUP[year.zhi];
      return g ? [GU_GUA[g].寡宿] : [];
    },
  },
];

/** 阳干判定，与 constants 的口径一致；此处内联是为了本模块零依赖。 */
const YANG_GAN = new Set(["甲", "丙", "戊", "庚", "壬"]);
const YANG_ZHI = new Set(["子", "寅", "辰", "午", "申", "戌"]);

/**
 * 查全盘神煞。
 *
 * 查法统一为「取依据柱上的字，得到目标字，再在四柱里找它落在哪里」。
 * 天乙贵人与孤辰寡宿的目标可以是天干以外的字，所以这里同时扫天干与地支。
 */
export function findShenSha(input: ShenShaInput): ShenShaHit[] {
  const hits: ShenShaHit[] = [];

  for (const rule of RULES) {
    if (rule.yangOnly && !YANG_GAN.has(input.dayGan)) continue;

    const targets = new Set(rule.targets(input));
    if (targets.size === 0) continue;

    for (const pillar of input.pillars) {
      // 同时扫天干与地支：月德贵人的目标是天干，其余的目标是地支。
      // 两支同名不会撞车（干支两套名字不重叠），所以不必区分。
      for (const ch of [pillar.gan, pillar.zhi]) {
        if (!targets.has(ch)) continue;
        hits.push({
          name: rule.name,
          hitOn: ch,
          position: pillar.label,
          tone: rule.tone,
          plain: rule.plain,
        });
      }
    }
  }

  return hits;
}

/** 供界面分组显示用。 */
export function groupShenSha(hits: readonly ShenShaHit[]): Record<ShenShaTone, ShenShaHit[]> {
  return {
    吉: hits.filter((h) => h.tone === "吉"),
    凶: hits.filter((h) => h.tone === "凶"),
    中性: hits.filter((h) => h.tone === "中性"),
  };
}

/** 神煞只是倾向，不是定论 —— 界面上要把这句话原样显示出来。 */
export const SHEN_SHA_CAVEAT =
  "神煞取的是倾向，不是断言。同一位神煞落在哪一柱、有没有被冲克，含义都会变。这里只列出现象，供你对照自己的经历去印证。";

export { YANG_ZHI };
