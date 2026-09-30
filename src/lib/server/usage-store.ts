import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { UsageCounts } from "@/lib/quota-policy";

/**
 * 用量计数。
 *
 * 三个维度共用一张表：dev:<设备>、ip:<IP哈希>、global。
 *
 * Vercel 的 serverless 函数是无状态的，计数必须落在函数之外 —— 放内存里
 * 每次冷启动就归零，那等于没限流。所以生产走 Supabase。
 *
 * 但没配 Supabase 时不能直接把站点打死，也不能默默放行：
 *   开发环境 → 退化为进程内内存计数，并打印醒目警告（本地单人调试够用）
 *   生产环境 → 抛错拒绝服务。宁可返回 503，也不能敞着口子烧 API 余额
 */

const GLOBAL_KEY = "global";
const DEVICE_PREFIX = "dev:";
const IP_PREFIX = "ip:";

export const deviceKey = (deviceId: string) => `${DEVICE_PREFIX}${deviceId}`;
export const ipKey = (ipHash: string) => `${IP_PREFIX}${ipHash}`;

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export function dailyGlobalBudget(): number {
  const raw = process.env.DEEPSEEK_DAILY_BUDGET;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 300;
}

/**
 * 以北京时间的自然日为界。
 * 受众在国内，而 Vercel 跑在 UTC —— 直接用 UTC 日期的话，用户会在下午 8 点"跨天"重置。
 */
export function today(): string {
  const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function envValue(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    envValue("NEXT_PUBLIC_SUPABASE_URL") && envValue("SUPABASE_SERVICE_ROLE_KEY")
  );
}

let _admin: SupabaseClient | null = null;

function admin(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "用量存储未配置：缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  if (!_admin) {
    _admin = createClient(
      envValue("NEXT_PUBLIC_SUPABASE_URL")!,
      envValue("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
  }
  return _admin;
}

/** 开发环境的内存兜底。仅进程内有效，多实例部署下不成立。 */
const memory: { day: string; bucket: Map<string, number>; warned: boolean } = {
  day: "",
  bucket: new Map(),
  warned: false,
};

function memoryBucket(): Map<string, number> {
  const d = today();
  if (memory.day !== d) {
    memory.day = d;
    memory.bucket = new Map();
  }
  if (!memory.warned) {
    memory.warned = true;
    console.warn(
      "[usage-store] 未配置 Supabase，限流退化为进程内内存计数。仅供本地开发，切勿用于生产。"
    );
  }
  return memory.bucket;
}

function useMemory(): boolean {
  if (isSupabaseConfigured()) return false;
  if (process.env.NODE_ENV === "production") {
    // 生产环境没有共享计数 → 拒绝服务，而不是敞开
    throw new Error(
      "用量存储未配置且运行于生产环境：无法限流，拒绝提供服务。请配置 Supabase。"
    );
  }
  return true;
}

export async function readUsage(deviceId: string, ipHash: string): Promise<UsageCounts> {
  const keys = [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY];

  if (useMemory()) {
    const b = memoryBucket();
    return {
      device: b.get(keys[0]) ?? 0,
      ip: b.get(keys[1]) ?? 0,
      global: b.get(keys[2]) ?? 0,
    };
  }

  const { data, error } = await admin()
    .from("usage")
    .select("key, count")
    .in("key", keys)
    .eq("day", today());

  if (error) throw new Error(`读取用量失败: ${error.message}`);

  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.count as number]));
  return {
    device: byKey.get(keys[0]) ?? 0,
    ip: byKey.get(keys[1]) ?? 0,
    global: byKey.get(keys[2]) ?? 0,
  };
}

export async function bumpUsage(deviceId: string, ipHash: string): Promise<void> {
  const keys = [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY];

  if (useMemory()) {
    const b = memoryBucket();
    for (const k of keys) b.set(k, (b.get(k) ?? 0) + 1);
    return;
  }

  // 走 rpc 做原子自增：并发下 select-then-update 会丢计数
  const db = admin();
  const results = await Promise.all(keys.map((k) => db.rpc("bump_usage", { k })));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`写入用量失败: ${failed.error.message}`);
}
