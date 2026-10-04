import type { UsageCounts } from "@/lib/access";
import { admin, allowMemoryFallback, envValue } from "@/lib/server/runtime";
import { createHash } from "node:crypto";

/**
 * 用量计数。
 *
 * 三个维度共用一张表：dev:<设备>、ip:<IP哈希>、global。
 *
 * Vercel 的 serverless 函数是无状态的，计数必须落在函数之外 —— 放内存里
 * 每次冷启动就归零，那等于没限流。所以生产走 Supabase。
 *
 * 环境装配（admin 客户端、内存兜底开关）在 runtime.ts 里，与激活码核销共用。
 */

const GLOBAL_KEY = "global";
const DEVICE_PREFIX = "dev:";
const IP_PREFIX = "ip:";

/**
 * 试读的计数键前缀。
 *
 * 试读必须与正式解读**分开计数**。合在一起会有个很坏的后果：
 * 新用户先试读一次，就等于把自己当天的正式额度也花掉了 ——
 * 他刚看完样品、正想付钱，却发现"次数已用完"。
 *
 * 前缀加在维度和设备号之间（`preview:dev:xxx`），这样一张表就能同时
 * 放两类计数，不必为此多建一张表。
 */
const PREVIEW_PREFIX = "preview:";

export const deviceKey = (deviceId: string) => `${DEVICE_PREFIX}${deviceId}`;
export const ipKey = (ipHash: string) => `${IP_PREFIX}${ipHash}`;

/** 试读的全局键。与正式解读的 `global` 分开，但**读的时候一起算**。 */
export const previewGlobalKey = () => `${PREVIEW_PREFIX}global`;
export const previewDeviceKey = (deviceId: string) => `${PREVIEW_PREFIX}${deviceKey(deviceId)}`;
export const previewIpKey = (ipHash: string) => `${PREVIEW_PREFIX}${ipKey(ipHash)}`;

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export function dailyGlobalBudget(): number {
  const raw = envValue("DEEPSEEK_DAILY_BUDGET");
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

export async function readCount(key: string): Promise<number> {
  if (allowMemoryFallback()) return memoryBucket().get(key) ?? 0;

  const { data, error } = await admin()
    .from("usage")
    .select("count")
    .eq("key", key)
    .eq("day", today())
    .maybeSingle();

  if (error) throw new Error(`读取用量失败: ${error.message}`);
  return (data?.count as number | undefined) ?? 0;
}

export async function bumpCount(key: string): Promise<void> {
  if (allowMemoryFallback()) {
    const b = memoryBucket();
    b.set(key, (b.get(key) ?? 0) + 1);
    return;
  }

  // 走 rpc 做原子自增：并发下 select-then-update 会丢计数
  const { error } = await admin().rpc("bump_usage", { k: key });
  if (error) throw new Error(`写入用量失败: ${error.message}`);
}

export async function readUsage(deviceId: string, ipHash: string): Promise<UsageCounts> {
  const keys = [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY];

  if (allowMemoryFallback()) {
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
  if (allowMemoryFallback()) {
    const b = memoryBucket();
    for (const k of [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY]) {
      b.set(k, (b.get(k) ?? 0) + 1);
    }
    return;
  }

  await Promise.all(
    [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY].map((k) => bumpCount(k))
  );
}

/**
 * 试读的用量。
 *
 * `global` 取的是**两类计数之和** —— 试读与正式解读各有自己的全局键，
 * 而 DEEPSEEK_DAILY_BUDGET 这个熔断必须管住它们的总和。只算其中一类的话，
 * 攻击者只要把请求在两条路径之间来回切，就能把当日预算翻倍。
 */
export async function readPreviewUsage(
  deviceId: string,
  ipHash: string
): Promise<UsageCounts> {
  const devK = previewDeviceKey(deviceId);
  const ipK = previewIpKey(ipHash);
  const gK = previewGlobalKey();

  if (allowMemoryFallback()) {
    const b = memoryBucket();
    return {
      device: b.get(devK) ?? 0,
      ip: b.get(ipK) ?? 0,
      global: (b.get(gK) ?? 0) + (b.get(GLOBAL_KEY) ?? 0),
    };
  }

  const { data, error } = await admin()
    .from("usage")
    .select("key, count")
    .in("key", [devK, ipK, gK, GLOBAL_KEY])
    .eq("day", today());

  if (error) throw new Error(`读取试读用量失败: ${error.message}`);

  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.count as number]));
  return {
    device: byKey.get(devK) ?? 0,
    ip: byKey.get(ipK) ?? 0,
    global: (byKey.get(gK) ?? 0) + (byKey.get(GLOBAL_KEY) ?? 0),
  };
}

/** 试读记账。设备、IP、以及试读专属的全局键各加一。 */
export async function bumpPreviewUsage(deviceId: string, ipHash: string): Promise<void> {
  if (allowMemoryFallback()) {
    const b = memoryBucket();
    for (const k of [previewDeviceKey(deviceId), previewIpKey(ipHash), previewGlobalKey()]) {
      b.set(k, (b.get(k) ?? 0) + 1);
    }
    return;
  }

  await Promise.all(
    [previewDeviceKey(deviceId), previewIpKey(ipHash), previewGlobalKey()].map((k) =>
      bumpCount(k)
    )
  );
}
