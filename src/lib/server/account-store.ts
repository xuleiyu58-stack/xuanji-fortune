import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { admin, isSupabaseConfigured } from "@/lib/server/runtime";
import type { Entitlement, Pass } from "@/lib/entitlement";
import { mergeEntitlements } from "@/lib/entitlement-merge";

/**
 * 账号数据层。
 *
 * 三条纪律，都是为了同一件事：**放行热路径不查库**。
 *
 *  1. 权益的权威副本在 `account_entitlements` 一张表里，结构与
 *     `lib/entitlement.ts` 的 Entitlement 一致，不拆表。
 *  2. 登录时把账户权益**合并进签名 cookie**（xj_pass）。此后
 *     `/api/fortune` 与 `/api/ask` 仍然只验签、不查库 —— 每次解读都多一次
 *     数据库往返，是最容易在"加功能"时被悄悄引入的性能退化。
 *  3. 合并只发生在登录、认领、兑换这三个人为动作上，都是低频操作，
 *     多一次往返无所谓。
 *
 * 未配置 Supabase 时全部走内存兜底（照 usage-store 的既有范式），
 * 本地能跑通；生产环境由 allowMemoryFallback 直接拒绝。
 */

/** 认领码有效期。短，因为它是把匿名权益接到账户上的凭证。 */
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/** 认领码长度。8 位 Crockford base32 ≈ 40 bit，配合 10 分钟有效期足够。 */
const LINK_CODE_LENGTH = 8;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function accountsConfigured(): boolean {
  return isSupabaseConfigured();
}

/**
 * 内存兜底的开关。
 *
 * 与 usage-store 共用同一套判定：生产环境未配 Supabase 时**不**兜底，
 * 让调用方拿到的错误暴露出来，而不是悄悄用一个只在单进程内有效的假存储。
 */
function allowMemory(): boolean {
  return !isSupabaseConfigured() && process.env.NODE_ENV !== "production";
}

/** 内存兜底下的账户权益。键是 user_id。 */
const memoryAccount = new Map<string, Entitlement>();

/**
 * 内存兜底用设备权益镜像（键是 device_id）。
 *
 * 与数据库里的 device_entitlements 表对应，语义也一致：兑换时写入，
 * 认领时**搬走并删除**。
 */
const memoryDeviceMirror = new Map<string, Entitlement>();

function makeLinkCode(): string {
  const bytes = randomBytes(LINK_CODE_LENGTH);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * 从 Authorization: Bearer <access_token> 解析出用户。
 *
 * 用 admin().auth.getUser(token) 而不是自己解 JWT：
 * 它会真正向 Supabase 校验签名与有效期，也会识别已被吊销的会话。
 * 自己解 JWT 就得自己管密钥与吊销名单，那是安全代码，不该手写。
 */
export async function userFromRequest(
  req: NextRequest
): Promise<{ id: string; email: string | null } | null> {
  if (!accountsConfigured()) return null;

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const { data, error } = await admin().auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch (err) {
    console.error("校验登录态失败:", err);
    return null;
  }
}

/** 账户权益。没记录过就是空权益 —— 不是错误。 */
export async function readAccountEntitlement(userId: string): Promise<Entitlement> {
  if (allowMemory()) {
    return memoryAccount.get(userId) ?? { v: 1, member: null, passes: [] };
  }

  const { data, error } = await admin()
    .from("account_entitlements")
    .select("member, passes")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`读取账户权益失败: ${error.message}`);
  if (!data) return { v: 1, member: null, passes: [] };

  return {
    v: 1,
    member: typeof data.member === "number" ? data.member : null,
    passes: Array.isArray(data.passes) ? (data.passes as Pass[]) : [],
  };
}

/**
 * 把一份权益并入账户。
 *
 * 合并本身交给数据库函数 merge_entitlement 做 —— 「读→合并→写」三步必须原子，
 * 放在这里两次并发调用就会丢掉一份权益。
 *
 * `addMember` 传的是**增量秒数**而不是绝对到期时间：续期要从现有到期时间
 * 往后接，把绝对时间交给数据库就没法做这件事。
 */
export async function mergeIntoAccount(
  userId: string,
  addMemberSeconds: number,
  addPasses: Pass[]
): Promise<void> {
  if (allowMemory()) {
    const current = memoryAccount.get(userId) ?? { v: 1 as const, member: null, passes: [] };
    const now = Math.floor(Date.now() / 1000);
    // 与库里的 merge_entitlement 同口径：续期从现在起算，券逐张合并
    const member =
      addMemberSeconds > 0 ? Math.max(current.member ?? 0, now) + addMemberSeconds : current.member;
    memoryAccount.set(userId, mergeEntitlements({ ...current, member }, { v: 1, member: null, passes: addPasses }));
    return;
  }

  const { error } = await admin().rpc("merge_entitlement", {
    uid: userId,
    add_member: addMemberSeconds > 0 ? addMemberSeconds : null,
    add_passes: addPasses,
    now_ts: new Date().toISOString(),
  });
  if (error) throw new Error(`合并账户权益失败: ${error.message}`);
}

// ── 设备权益镜像 ────────────────────────────────────────────
//
// 权益的主副本是签名 cookie（热路径只验签、不查库）。这一份是**迁移中转站**：
// 兑换时把与 cookie 完全相同的那份权益也写到这里；认领时整行搬到账户并删除。
//
// 「搬」而不是「抄」是这套设计的关键 —— 抄一份的话，用户在同一台设备
// 重新兑换一次，就能把同一份权益再认领到另一个账户，那是权益复制漏洞。

const memoryDevice: Map<string, Entitlement> = memoryDeviceMirror;

/** 把一份权益镜像到设备维度。传入的应是写入 cookie 的同一份对象。 */
export async function putDeviceEntitlement(
  deviceId: string,
  ent: Entitlement
): Promise<void> {
  if (allowMemory()) {
    memoryDevice.set(deviceId, ent);
    return;
  }

  const { error } = await admin()
    .from("device_entitlements")
    .upsert(
      {
        device_id: deviceId,
        member: ent.member,
        passes: ent.passes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "device_id" }
    );
  if (error) throw new Error(`写入设备权益失败: ${error.message}`);
}

/**
 * 把设备权益搬进账户。
 *
 * 整个「读取 → 合并 → 删除」在数据库函数里一步完成，并发认领不会加两次。
 * 返回 false 表示该设备没有可搬的权益（已被搬走，或本就没有）——
 * 这不是错误：新用户第一次登录走的就是这条路。
 */
export async function claimDeviceEntitlement(userId: string, deviceId: string): Promise<boolean> {
  if (allowMemory()) {
    const held = memoryDevice.get(deviceId);
    if (!held) return false;
    memoryDevice.delete(deviceId);

    const current = memoryAccount.get(userId) ?? { v: 1 as const, member: null, passes: [] };
    memoryAccount.set(userId, mergeEntitlements(current, held));
    return true;
  }

  const { data, error } = await admin().rpc("claim_device_entitlement", {
    uid: userId,
    dev: deviceId,
    now_ts: new Date().toISOString(),
  });
  if (error) throw new Error(`迁移设备权益失败: ${error.message}`);
  return data === true;
}

// ── 单次券消费台账 ──────────────────────────────────────────
//
// 见 supabase/accounts.sql 里 pass_consumptions 的说明。要点是：
// 权益 cookie 是自包含的，客户端手里那份是副本，所以"用过了"必须记在服务端，
// 否则保留旧 cookie 就能无限重放同一张券。

const memoryConsumed = new Set<string>();

/**
 * passId 的构造只此一处 —— 台账的键必须与读的地方完全一致。
 *
 * 键是 `tid:下标:消费前次数`，三段都必要：
 *   · tid    区分"哪一份凭证授权"
 *   · 下标   区分"这一份里的哪张券"（同模式可能有多张）
 *   · 次数   区分"这张券的第几次使用"（n>1 的券要能用多次）
 *
 * 次数是**递减**的，所以每次使用天然不同；同一次使用重放时三段完全相同，
 * 主键冲突即被挡住。少了第三段，一张 2 次的券第二次就会被误判成重放。
 */
export function passIdOf(tid: string, passIndex: number, remaining: number): string {
  return `${tid}:${passIndex}:${remaining}`;
}

/** 这次消费是否已经发生过。 */
export async function isPassConsumed(passId: string): Promise<boolean> {
  if (allowMemory()) return memoryConsumed.has(passId);

  const { data, error } = await admin()
    .from("pass_consumptions")
    .select("pass_id")
    .eq("pass_id", passId)
    .maybeSingle();

  if (error) throw new Error(`读取消费台账失败: ${error.message}`);
  return data !== null;
}

/**
 * 认领一次消费。返回 true 表示这次是首次消费（放行），
 * false 表示已经消费过（拒绝）。
 *
 * 用「插入成功与否」而不是「先查再写」：并发下两个请求都会查到"没消费过"，
 * 只有主键冲突能保证只有一个赢。
 */
export async function claimPassConsumption(passId: string): Promise<boolean> {
  if (allowMemory()) {
    if (memoryConsumed.has(passId)) return false;
    memoryConsumed.add(passId);
    return true;
  }

  const { error } = await admin().from("pass_consumptions").insert({ pass_id: passId });

  if (!error) return true;
  // 23505 = 主键冲突，即这张券已经用过了。这是预期内的正常分支，不是异常。
  if (error.code === "23505") return false;
  throw new Error(`写入消费台账失败: ${error.message}`);
}

/**
 * 撤销一次消费认领（退还）。
 *
 * 用在"已经占好坑、但解读最终失败了"的路径上。占坑必须在调用模型**之前**
 * （否则并发请求会白嫖同一张券），但用户不该为一次服务端故障付费 ——
 * 所以失败时把坑撤掉。
 *
 * 撤不掉也不影响正确性：最坏情况是用户损失一张券，而不是被无限重放。
 */
export async function releasePassConsumption(passId: string): Promise<void> {
  if (allowMemory()) {
    memoryConsumed.delete(passId);
    return;
  }

  const { error } = await admin().from("pass_consumptions").delete().eq("pass_id", passId);
  if (error) throw new Error(`撤销消费台账失败: ${error.message}`);
}

// ── 认领码 ──────────────────────────────────────────────────

const memoryLinks = new Map<string, { deviceId: string; expiresAt: number; usedAt: number | null }>();

/** 为某台设备签一张认领码。 */
export async function issueLinkCode(deviceId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);

  if (allowMemory()) {
    // 内存兜底下不可能撞码（同进程内可见），直接生成即可
    let code = makeLinkCode();
    while (memoryLinks.has(code)) code = makeLinkCode();
    memoryLinks.set(code, { deviceId, expiresAt: expiresAt.getTime(), usedAt: null });
    return code;
  }

  // 撞码概率极低，但主键冲突会让整次请求失败，所以重试几次
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeLinkCode();
    const { error } = await admin()
      .from("link_codes")
      .insert({ code, device_id: deviceId, expires_at: expiresAt.toISOString() });
    if (!error) return code;
    if (error.code !== "23505") throw new Error(`签发认领码失败: ${error.message}`);
  }
  throw new Error("签发认领码失败：连续撞码");
}

/**
 * 核销认领码，返回它绑定的 device_id。
 * 无效、过期、已用过一律返回 null —— 调用方不需要区分，区分了就是给爆破者进度条。
 */
export async function claimLinkCode(code: string): Promise<string | null> {
  const now = new Date();

  if (allowMemory()) {
    const hit = memoryLinks.get(code);
    if (!hit) return null;
    if (hit.usedAt !== null || hit.expiresAt <= now.getTime()) return null;
    hit.usedAt = now.getTime();
    return hit.deviceId;
  }

  const { data, error } = await admin().rpc("claim_link_code", {
    c: code,
    now_ts: now.toISOString(),
  });
  if (error) throw new Error(`核销认领码失败: ${error.message}`);

  const row = (data as { device_id: string }[] | null)?.[0];
  return row?.device_id ?? null;
}

// ── 排盘记录 ────────────────────────────────────────────────

export interface StoredReading {
  id: string;
  mode: string;
  title: string;
  result: string;
  input: Record<string, string>;
  createdAt: string;
}

const memoryReadings = new Map<string, StoredReading[]>();

export async function listReadings(userId: string, limit = 50): Promise<StoredReading[]> {
  if (allowMemory()) return (memoryReadings.get(userId) ?? []).slice(0, limit);

  const { data, error } = await admin()
    .from("readings")
    .select("id, mode, title, result, input, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`读取记录失败: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    mode: r.mode as string,
    title: r.title as string,
    result: r.result as string,
    input: (r.input ?? {}) as Record<string, string>,
    createdAt: r.created_at as string,
  }));
}

export async function saveReadingForUser(
  userId: string,
  reading: { mode: string; title: string; result: string; input: Record<string, string> }
): Promise<StoredReading> {
  if (allowMemory()) {
    const entry: StoredReading = {
      id: randomBytes(8).toString("hex"),
      ...reading,
      createdAt: new Date().toISOString(),
    };
    const list = memoryReadings.get(userId) ?? [];
    memoryReadings.set(userId, [entry, ...list].slice(0, 50));
    return entry;
  }

  const { data, error } = await admin()
    .from("readings")
    .insert({
      user_id: userId,
      mode: reading.mode,
      title: reading.title,
      result: reading.result,
      input: reading.input,
    })
    .select("id, created_at")
    .single();

  if (error) throw new Error(`保存记录失败: ${error.message}`);
  return { ...reading, id: data.id as string, createdAt: data.created_at as string };
}

export async function deleteReadingForUser(userId: string, id: string): Promise<void> {
  if (allowMemory()) {
    memoryReadings.set(userId, (memoryReadings.get(userId) ?? []).filter((r) => r.id !== id));
    return;
  }

  // 带上 user_id 条件：即便 id 被人猜到，也删不掉别人的记录
  const { error } = await admin().from("readings").delete().eq("user_id", userId).eq("id", id);
  if (error) throw new Error(`删除记录失败: ${error.message}`);
}
