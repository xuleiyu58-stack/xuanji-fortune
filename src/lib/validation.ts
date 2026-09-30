export const MAX_SHORT_FIELD = 200;
export const MAX_LONG_FIELD = 500;

/** 每个模式接受的字段。白名单之外的一律丢弃，防止脏数据进入 prompt。 */
export const MODE_FIELDS: Record<string, readonly string[]> = {
  daily: [],
  oracle: ["concern"],
  bazi: ["birthDate", "birthTime", "gender"],
  tarot: ["question"],
  love: ["person1", "person2"],
};

const LONG_FIELDS: readonly string[] = ["question", "concern"];

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
