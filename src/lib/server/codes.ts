import { randomBytes } from "node:crypto";
import { admin, allowMemoryFallback, envValue } from "@/lib/server/runtime";

/**
 * 激活码：**发码**与核销。
 *
 * 发码只有 `mintCode()` 一处实现（订单自动发码与 `scripts/gen-codes.mjs` 共用）——
 * 生成与核销各写一份字符集，任何一份被改动，都会让"生成的码核销不了"只在线上出现。
 *
 * 核销的原子性由数据库保证（supabase/redeem.sql 的 redeem_code 函数），
 * 这里只负责取参数、调函数、翻译结果。
 *
 * 没配 Supabase 时退化为进程内内存：码从 DEV_REDEEM_CODES 显式播种，
 * 格式 `码:kind:mode:days` 逗号分隔，例如：
 *   DEV_REDEEM_CODES=XMEMBER30:member::30,XTAROT1:single:tarot:1
 * 刻意不做"任意码都放行"的魔术 —— 那种兜底一旦漏到生产就是灾难。
 */

export interface RedeemOutcome {
  ok: boolean;
  kind?: "member" | "single";
  mode?: string | null;
  days?: number;
}

/** Crockford base32：去掉易混的 I L O U。32 整除 256，取模无偏。 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 激活码长度。16 位 Crockford base32 ≈ 80 bit 熵。 */
const CODE_LENGTH = 16;

/**
 * 发码。**生成逻辑只此一处。**
 *
 * 此前它只存在于 scripts/gen-codes.mjs 里，而 ALPHABET 在本文件与那个脚本
 * 各写了一遍。订单自动发码（/api/order/code）如果就地再写一遍，就是第三份 ——
 * 三份里任何一份的字符集被改动，都会让"生成的码核销不了"这种错误只在线上出现。
 */
export function mintCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function isValidCodeFormat(code: string): boolean {
  // Array.from 与 [...code] 都按码点迭代，判定结果一致 —— 保留前者只是历史选择。
  // （早先说 tsconfig 未设 target、展开会触发 TS2802 已不成立：target 显式设了 ES2020。）
  // 长度读 CODE_LENGTH 而不是硬写 16：两者一旦不同步，mintCode() 会产出
  // 校验器拒绝的码 —— 正是上面注释里担心的"生成的码核销不了"。
  return code.length === CODE_LENGTH && Array.from(code).every((ch) => ALPHABET.includes(ch));
}

const memoryCodes = new Map<string, { kind: string; mode: string | null; days: number }>();
let memorySeeded = false;

function seedMemory(): void {
  if (memorySeeded) return;
  memorySeeded = true;
  for (const entry of (envValue("DEV_REDEEM_CODES") ?? "").split(",")) {
    const [code, kind, mode, days] = entry.split(":");
    if (!code || !kind) continue;
    memoryCodes.set(normalizeCode(code), {
      kind,
      mode: mode || null,
      days: Number.parseInt(days ?? "0", 10) || 0,
    });
  }
}

export async function redeemCode(code: string, who: string): Promise<RedeemOutcome> {
  if (allowMemoryFallback()) {
    seedMemory();
    const hit = memoryCodes.get(code);
    if (!hit) return { ok: false };
    memoryCodes.delete(code); // 只能核销一次
    return { ok: true, kind: hit.kind as "member" | "single", mode: hit.mode, days: hit.days };
  }

  const { data, error } = await admin().rpc("redeem_code", { c: code, who });
  if (error) throw new Error(`核销失败: ${error.message}`);

  const row = (data as { kind: string; mode: string | null; days: number }[] | null)?.[0];
  if (!row) return { ok: false };

  return { ok: true, kind: row.kind as "member" | "single", mode: row.mode, days: row.days };
}
