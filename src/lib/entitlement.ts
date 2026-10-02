/**
 * 权益凭证。
 *
 * 兑换激活码后，服务端签发一张签名 cookie。此后判定权益只验签、不查库 ——
 * 权益就在这张凭证里。密钥由调用方注入（从环境变量读是 server 层的事），
 * 本模块只 import 内置的 node:crypto，因此能被 node --test 直接跑。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ENTITLEMENT_VERSION = 1;

export interface Pass {
  /** 模式：bazi / tarot / love */
  m: string;
  /** 剩余次数 */
  n: number;
  /** 失效 unix 秒 */
  e: number;
}

export interface Entitlement {
  v: 1;
  /** 会员到期 unix 秒；非会员为 null */
  member: number | null;
  passes: Pass[];
}

export interface EntitlementSummary {
  member: boolean;
  expiresAt?: number;
  passes: { mode: string; remaining: number }[];
}

export const EMPTY_ENTITLEMENT: Entitlement = { v: 1, member: null, passes: [] };

const DAY_SECONDS = 86400;

function encodePayload(ent: Entitlement): string {
  return Buffer.from(JSON.stringify(ent), "utf8").toString("base64url");
}

function macOf(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function sign(ent: Entitlement, secret: string): string {
  const payload = encodePayload(ent);
  return `${payload}.${macOf(payload, secret)}`;
}

export function isMemberActive(ent: Entitlement, nowSec: number): boolean {
  return ent.member !== null && ent.member > nowSec;
}

/**
 * 剔除过期项。整份凭证空掉时返回 null —— 调用方据此清除 cookie，
 * 而不是写一个空壳回去。
 */
export function prune(ent: Entitlement, nowSec: number): Entitlement | null {
  const member = ent.member !== null && ent.member > nowSec ? ent.member : null;
  const passes = ent.passes.filter((p) => p.n > 0 && p.e > nowSec);
  if (member === null && passes.length === 0) return null;
  return { v: ENTITLEMENT_VERSION, member, passes };
}

function parseEntitlement(raw: unknown, nowSec: number): Entitlement | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== ENTITLEMENT_VERSION) return null;

  const member =
    typeof o.member === "number" && Number.isFinite(o.member) ? o.member : null;

  const passes: Pass[] = [];
  if (Array.isArray(o.passes)) {
    for (const item of o.passes) {
      if (typeof item !== "object" || item === null) continue;
      const p = item as Record<string, unknown>;
      if (typeof p.m !== "string") continue;
      if (typeof p.n !== "number" || !Number.isInteger(p.n) || p.n <= 0) continue;
      if (typeof p.e !== "number" || !Number.isFinite(p.e)) continue;
      passes.push({ m: p.m, n: p.n, e: p.e });
    }
  }

  return prune({ v: ENTITLEMENT_VERSION, member, passes }, nowSec);
}

export function verify(
  token: string | undefined | null,
  secret: string,
  nowSec: number
): Entitlement | null {
  if (typeof token !== "string" || token.length === 0) return null;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  // 必须先比长度：timingSafeEqual 对不等长的 buffer 直接抛异常
  const expected = Buffer.from(macOf(payload, secret), "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  return parseEntitlement(raw, nowSec);
}

/** 续期时从现有到期时间往后接，而不是从今天重算 —— 否则提前续费会亏掉剩余天数。 */
export function grantMember(ent: Entitlement, days: number, nowSec: number): Entitlement {
  const base = isMemberActive(ent, nowSec) ? (ent.member as number) : nowSec;
  return { v: ENTITLEMENT_VERSION, member: base + days * DAY_SECONDS, passes: ent.passes };
}

/** 同模式的券合并：次数相加，到期取较晚者。 */
export function grantPass(
  ent: Entitlement,
  mode: string,
  n: number,
  days: number,
  nowSec: number
): Entitlement {
  const e = nowSec + days * DAY_SECONDS;
  const existing = ent.passes.find((p) => p.m === mode);
  const passes = existing
    ? ent.passes.map((p) => (p.m === mode ? { m: mode, n: p.n + n, e: Math.max(p.e, e) } : p))
    : [...ent.passes, { m: mode, n, e }];
  return { v: ENTITLEMENT_VERSION, member: ent.member, passes };
}

/** 用掉一次该模式的券。返回 null 表示整份凭证已空，调用方应清除 cookie。 */
export function consumePass(
  ent: Entitlement,
  mode: string,
  nowSec: number
): Entitlement | null {
  const passes = ent.passes
    .map((p) => (p.m === mode ? { ...p, n: p.n - 1 } : p))
    .filter((p) => p.n > 0 && p.e > nowSec);
  return prune({ ...ent, passes }, nowSec);
}

export function toSummary(ent: Entitlement | null, nowSec: number): EntitlementSummary {
  const alive = ent ? prune(ent, nowSec) : null;
  if (!alive) return { member: false, passes: [] };
  const summary: EntitlementSummary = {
    member: isMemberActive(alive, nowSec),
    passes: alive.passes.map((p) => ({ mode: p.m, remaining: p.n })),
  };
  if (summary.member && alive.member !== null) summary.expiresAt = alive.member;
  return summary;
}
