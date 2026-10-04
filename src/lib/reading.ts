/**
 * 解读文本的结构化解析。
 *
 * 为什么要有这个：盘已经做厚了（藏干、十神、格局、用神、神煞），但模型的输出
 * 曾经是一整块文本 —— 它可以挑着说、也可以漏说，用户无从核验。
 *
 * 现在要求模型每节写成三段：
 *
 *   【事业财运】
 *   结论：适合做与金属、机械相关的行当
 *   依据：月支酉藏辛，辛为日主之正官，且透出年干
 *   展开：正官主规矩与名位，透干说明这份约束来得早……
 *
 * 「依据」这一段是重点 —— 它必须点到盘上的具体位置。有了它，用户能自己对盘核验，
 * 也该能看出模型是不是在胡说。「代码排盘、AI 只解读」这条线，落点就在这里。
 *
 * 解析刻意宽容：模型偶尔不按格式走时，缺的那段留空、整节退化成纯正文，
 * 而不是让整份解读崩掉。
 */

export interface ReadingPart {
  /** 一句话结论 */
  verdict?: string;
  /** 盘上的依据：哪一柱、哪个十神、哪种五行关系 */
  basis?: string;
  /** 展开的白话 */
  detail?: string;
}

export interface ReadingSection {
  title: string;
  part: ReadingPart;
}

export interface ParsedReading {
  sections: ReadingSection[];
  /**
   * 第一个【小节】之前的引子。
   * 模型偶尔会在正文前先来一段总起 —— 丢掉它等于删了正文，所以单独留着。
   */
  preamble?: string;
  /**
   * 一个【小节】都没解析出来时的原文。
   * 界面据此退回整块渲染 —— 模型没按格式走也得让用户看到解读，不能白屏。
   */
  fallback?: string;
}

/**
 * 小节标题：**整行**只有一个【…】才算。
 *
 * 必须锚定行首行尾 —— 否则正文里出现的【月令司权】这类强调会被误当成新小节，
 * 把一节正文劈成两半。这条规则同时也是给模型的格式约定：标题单独占一行。
 */
const SECTION_RE = /^[ \t]*【\s*([^】\n]{2,14})\s*】[ \t]*$/;

const PREFIX_RE = /^(结论|依据|展开)\s*[:：]\s*/;

/** 开头那句免责声明单独拎出来，界面上固定在顶部显示，不混进任何一节。 */
export const DISCLAIMER_RE = /命理之说[，,]\s*信则有不信则无[，,]\s*仅供参考娱乐[。.！!]?/;

export function parseReading(raw: string): ParsedReading {
  if (!raw || !raw.trim()) return { sections: [], fallback: raw ?? "" };

  const text = raw.replace(DISCLAIMER_RE, "").trim();

  // 按行扫描：整行是【标题】就开新的一节，其余行归入当前节。
  // 第一个标题之前的行是引子，单独留着 —— 丢掉它等于删了正文。
  const chunks: { title: string; body: string }[] = [];
  const pre: string[] = [];
  let cur: { title: string; lines: string[] } | null = null;

  for (const line of text.split("\n")) {
    const head = SECTION_RE.exec(line);
    if (head) {
      if (cur) chunks.push({ title: cur.title, body: cur.lines.join("\n") });
      cur = { title: head[1], lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
    else pre.push(line);
  }
  if (cur) chunks.push({ title: cur.title, body: cur.lines.join("\n") });

  const preamble = pre.join("\n").trim();

  if (chunks.length === 0) return { sections: [], fallback: text };

  const sections: ReadingSection[] = chunks.map((c) => ({
    title: c.title,
    part: parseBody(c.body),
  }));

  // 全部小节都是空的（模型只给了标题没给内容）也算解析失败
  const hasContent = sections.some(
    (s) => s.part.verdict || s.part.basis || s.part.detail
  );
  if (!hasContent) return { sections: [], fallback: text };

  return { sections, preamble: preamble || undefined };
}

function parseBody(body: string): ReadingPart {
  const part: ReadingPart = {};
  const loose: string[] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const hit = PREFIX_RE.exec(line);
    if (!hit) {
      loose.push(line);
      continue;
    }

    const value = line.slice(hit[0].length).trim();
    if (!value) continue;

    if (hit[1] === "结论") part.verdict = append(part.verdict, value);
    else if (hit[1] === "依据") part.basis = append(part.basis, value);
    else part.detail = append(part.detail, value);
  }

  // 没有标前缀的行接到「展开」上；连展开也没有时，它们就是正文
  if (loose.length) {
    const glue = loose.join("\n");
    part.detail = part.detail ? `${part.detail}\n${glue}` : glue;
  }

  return part;
}

function append(existing: string | undefined, next: string): string {
  return existing ? `${existing}${next}` : next;
}

/** 供界面判断：这一节有没有真正的依据可展示。 */
export function hasBasis(section: ReadingSection): boolean {
  return Boolean(section.part.basis && section.part.basis.trim().length > 0);
}

/**
 * 完整解读固定包含的小节。
 *
 * 顺序与标题由 SYSTEM_PROMPT（lib/ai.ts）规定，模型必须原样使用。
 * 写在这里是因为**界面需要知道"总共几节"**：免费试读只回第一节，
 * 客户端手里没有完整解读，光看内容推不出总数。
 *
 * 硬编码一个 6 也能用，但那样两处终究会漂移 —— 改提示词的人不会
 * 记得去改界面上的数字。这里放一份，两边都引它。
 */
export const SECTION_TITLES = [
  "命局总评",
  "日主强弱",
  "性格禀赋",
  "事业财运",
  "感情婚姻",
  "大运走势",
  "大师寄语",
] as const;

/** 试读解锁后还能看到几节。 */
export const LOCKED_SECTION_COUNT = SECTION_TITLES.length - 1;
