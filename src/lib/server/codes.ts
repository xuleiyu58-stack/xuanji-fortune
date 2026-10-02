import { admin, allowMemoryFallback, envValue } from "@/lib/server/runtime";

/**
 * 激活码核销。
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

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function isValidCodeFormat(code: string): boolean {
  // 用 Array.from 而非 [...code]：tsconfig 未设 target（默认 ES5），字符串展开会触发 TS2802。
  // 两者都按码点迭代，判定结果一致。
  return code.length === 16 && Array.from(code).every((ch) => ALPHABET.includes(ch));
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
