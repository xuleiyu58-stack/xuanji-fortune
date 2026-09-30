/**
 * 灵签摇签。
 *
 * 摇签是随机的，由代码来摇 —— 与塔罗抽牌、每日起卦同一个原则。让模型"摇"，
 * 它会按叙事需要挑一个吉签，十次有八次是上上签，那就不叫求签了。
 *
 * 关于签文，这里有个必须说清楚的地方：
 * 传统灵签的签文是**固定**的（第 38 签永远就是那首诗）。本项目没有那一百支签的原始文本，
 * 也不打算编一百首诗冒充古签谱。所以本模块只负责摇出**签号与签等**（这两样是真实的随机结果），
 * 签文由模型为这支签**创作**，界面上也如实呈现为 AI 所拟，不声称出自某套具体签谱。
 */

export type OracleGrade = "上上" | "上吉" | "中吉" | "中平" | "中下" | "下下";

export interface GradeBand {
  grade: OracleGrade;
  note: string;
  from: number;
  to: number;
}

/**
 * 签等分布：上上稀少、中平居多。
 * 这是按常见灵签的"好签少、平签多"的总体倾向划定的概率带，
 * **不是**某套具体签谱的原始签序，代码与界面都不作此声称。
 */
export const GRADE_BANDS: readonly GradeBand[] = [
  { grade: "上上", note: "大吉", from: 1, to: 5 },
  { grade: "上吉", note: "吉", from: 6, to: 15 },
  { grade: "中吉", note: "偏吉", from: 16, to: 35 },
  { grade: "中平", note: "平", from: 36, to: 70 },
  { grade: "中下", note: "偏阻", from: 71, to: 90 },
  { grade: "下下", note: "多阻", from: 91, to: 100 },
];

export const ORACLE_COUNT = 100;

export interface OracleDraw {
  /** 1-100 */
  number: number;
  grade: OracleGrade;
  note: string;
}

export function gradeOf(number: number): GradeBand | null {
  if (!Number.isInteger(number) || number < 1 || number > ORACLE_COUNT) return null;
  return GRADE_BANDS.find((b) => number >= b.from && number <= b.to) ?? null;
}

export function drawOracle(rand: () => number = Math.random): OracleDraw {
  const number = Math.floor(rand() * ORACLE_COUNT) + 1;
  const band = gradeOf(number);
  // GRADE_BANDS 覆盖 1-100 全域，理论上取不到 null；退化为中平而不是抛错
  return { number, grade: band?.grade ?? "中平", note: band?.note ?? "平" };
}

export function oracleToPrompt(draw: OracleDraw): string {
  return [
    `已摇得第 ${draw.number} 签，签等：${draw.grade}（${draw.note}）。`,
    "签号与签等已由程序摇定，不得改动、不得另摇。请为这一签拟写签文并解签。",
  ].join("\n");
}

export interface OracleReading {
  draw: OracleDraw;
  /** 四句签文，每句一行 */
  verse: string[];
  allusion: string;
  explanation: string;
  message: string;
}

const clean = (s: string) => s.replace(/^[\s　]+|[\s　]+$/g, "").replace(/[，。；！？、,.;!?]+$/, "");

/**
 * 从模型输出里抽出签文四句与其余各段。
 * 抽不到四句就返回 null —— 界面退回只展示原文，不会因为格式没跟上就白屏。
 */
export function parseOracle(text: string, draw: OracleDraw): OracleReading | null {
  const section = (label: string): string | null => {
    const re = new RegExp(`【${label}】\\s*\\n?([\\s\\S]*?)(?=\\n\\s*【|$)`);
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };

  const verseRaw = section("签文");
  if (!verseRaw) return null;

  const verse = verseRaw
    .split("\n")
    .map(clean)
    .filter((line) => line.length > 0);

  if (verse.length !== 4) return null;

  const message = section("大师开示") ?? section("大师寄语");
  if (!message) return null;

  return {
    draw,
    verse,
    allusion: section("典故") ?? "",
    explanation: section("解曰") ?? "",
    message,
  };
}
