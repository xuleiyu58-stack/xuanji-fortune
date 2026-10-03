export const MAX_SHORT_FIELD = 200;
export const MAX_LONG_FIELD = 500;

/**
 * 每个模式接受的字段。白名单之外的一律丢弃，防止脏数据进入 prompt。
 *
 * `question` 是「想了解的方向」。它此前不在这份白名单里 —— 表单收了，服务端却把它丢掉，
 * 用户选了「事业」和选「全面分析」拿到的解读一模一样。补上。
 */
export const MODE_FIELDS: Record<string, readonly string[]> = {
  // calendar / lunarLeap / place 都是「出生信息的表述方式」，不是自由文本：
  // 它们同样要过白名单，否则用户可以塞任意值把排盘带偏。
  bazi: [
    "birthDate", "birthTime", "gender", "question",
    "calendar", "lunarLeap", "province", "city",
  ],
};

const LONG_FIELDS: readonly string[] = ["question"];

export type ValidationOutcome =
  | { ok: true; mode: string; input: Record<string, string> }
  | { ok: false; error: string };

function limitFor(key: string): number {
  return LONG_FIELDS.includes(key) ? MAX_LONG_FIELD : MAX_SHORT_FIELD;
}

export function validateFortuneRequest(
  body: unknown,
  allowedModes: readonly string[]
): ValidationOutcome {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "请求格式不正确" };
  }

  const raw = body as Record<string, unknown>;
  const mode = raw.mode;

  if (typeof mode !== "string" || !allowedModes.includes(mode)) {
    return { ok: false, error: "请选择测算模式" };
  }

  const allowedFields = MODE_FIELDS[mode] ?? [];
  const input: Record<string, string> = {};

  for (const key of allowedFields) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    if (value.length > limitFor(key)) {
      return { ok: false, error: "输入内容过长，请精简后重试" };
    }
    input[key] = value;
  }

  return { ok: true, mode, input };
}

/** 上云的解读正文上限。与首次解读的 max_tokens 相称，留足余量。 */
export const MAX_READING_RESULT = 20000;
/** 标题（模式名）很短，但别让客户端塞一整篇文章进来 */
const MAX_READING_TITLE = 40;

export type ReadingPayloadOutcome =
  | { ok: true; value: { mode: string; title: string; result: string; input: Record<string, string> } }
  | { ok: false; error: string };

/**
 * 上云记录的校验。
 *
 * 与排盘请求分开写，因为两者的形状与风险都不同：
 *   · 排盘请求的 input 要过 **MODE_FIELDS 白名单**（它会被拼进 prompt）
 *   · 记录的 input 只是原样存档，不再进模型，所以整体限长即可，
 *     但仍要挡掉"用一个超大对象撑爆一行"这种滥用
 *
 * result 是模型生成的正文，长度上限给得比较宽，但必须有 —— 没有上限的话，
 * 一个循环就能往数据库里灌任意大的文本。
 */
export function validateReadingPayload(body: unknown): ReadingPayloadOutcome {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "请求格式不正确" };
  }

  const raw = body as Record<string, unknown>;

  const mode = typeof raw.mode === "string" ? raw.mode.trim() : "";
  if (!mode || mode.length > MAX_READING_TITLE) {
    return { ok: false, error: "缺少模式" };
  }

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title || title.length > MAX_READING_TITLE) {
    return { ok: false, error: "缺少标题" };
  }

  const result = typeof raw.result === "string" ? raw.result : "";
  if (!result.trim()) {
    return { ok: false, error: "解读内容为空" };
  }
  if (result.length > MAX_READING_RESULT) {
    return { ok: false, error: "解读内容过长" };
  }

  // input 只留字符串值，且逐项限长。刻意不套 MODE_FIELDS 白名单：
  // 历史记录可能来自旧版本的字段集合，用今天的白名单去卡会把老记录判为非法。
  const input: Record<string, string> = {};
  if (typeof raw.input === "object" && raw.input !== null && !Array.isArray(raw.input)) {
    for (const [k, v] of Object.entries(raw.input as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      if (k.length > 40 || v.length > MAX_LONG_FIELD) continue;
      input[k] = v;
    }
  }

  return { ok: true, value: { mode, title, result, input } };
}
