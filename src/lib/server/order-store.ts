import { randomUUID } from "node:crypto";
import { admin, isSupabaseConfigured } from "@/lib/server/runtime";

/**
 * 订单数据层。
 *
 * 状态的每一次转换都交给数据库函数做原子 UPDATE，本文件只负责取参数、
 * 调 RPC、把行翻译成 camelCase。理由与 codes.ts 一致：并发下
 * "先读后写"会双花，只有 `UPDATE ... WHERE 前置条件 RETURNING` 能保证唯一。
 *
 * 未配 Supabase 时走内存兜底（照 usage-store 的既有范式），本地能跑通；
 * 生产环境由运行时直接 503。
 */

export interface OrderRow {
  id: string;
  plan: string;
  amount: number;
  status: "pending" | "paid" | "expired";
  provider: string | null;
  payerRef: string | null;
  deviceId: string | null;
  granted: unknown;
  deliveredAt: string | null;
  codeIssuedAt: string | null;
  paidAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

function allowMemory(): boolean {
  return !isSupabaseConfigured() && process.env.NODE_ENV !== "production";
}

/** 内存兜底下的订单表。键是订单 id。 */
const memoryOrders = new Map<string, OrderRow>();

/** 把数据库返回的 snake_case 行翻译成 OrderRow。 */
function toRow(raw: Record<string, unknown>): OrderRow {
  return {
    id: raw.id as string,
    plan: raw.plan as string,
    amount: Number(raw.amount),
    status: raw.status as OrderRow["status"],
    provider: (raw.provider ?? null) as string | null,
    payerRef: (raw.payer_ref ?? null) as string | null,
    deviceId: (raw.device_id ?? null) as string | null,
    granted: raw.granted ?? null,
    deliveredAt: (raw.delivered_at ?? null) as string | null,
    codeIssuedAt: (raw.code_issued_at ?? null) as string | null,
    paidAt: (raw.paid_at ?? null) as string | null,
    confirmedBy: (raw.confirmed_by ?? null) as string | null,
    createdAt: raw.created_at as string,
    expiresAt: raw.expires_at as string,
  };
}

/**
 * 内存兜底下的过期清理，语义与 expire_stale_orders() 一致。
 *
 * **只在 create_order 调用它的那一处调用它** —— 与 SQL 完全对齐：
 * 库里只有 create_order() 会 `perform expire_stale_orders()`，别的函数
 * 与普通查询都不清扫。若在读取路径上也清扫，内存里的过期单会变成 expired，
 * 而库里还是 pending，两条路径就对不上了（过期单必须仍能被 confirm 复活，
 * 见下面的测试）。
 */
function expireMemory(): void {
  const now = Date.now();
  for (const o of memoryOrders.values()) {
    if (o.status === "pending" && new Date(o.expiresAt).getTime() < now) {
      o.status = "expired";
    }
  }
}

/** 调一个返回 setof orders 的函数，取第一行或 null。 */
async function rpcOne(fn: string, args: Record<string, unknown>): Promise<OrderRow | null> {
  const { data, error } = await admin().rpc(fn, args);
  if (error) throw new Error(`调用 ${fn} 失败: ${error.message}`);
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return row ? toRow(row) : null;
}

export async function createOrder(input: {
  plan: string;
  amount: number;
  deviceId: string;
  ttlMinutes: number;
}): Promise<OrderRow> {
  if (allowMemory()) {
    expireMemory();
    const now = Date.now();
    const row: OrderRow = {
      id: randomUUID(),
      plan: input.plan,
      amount: input.amount,
      status: "pending",
      provider: null,
      payerRef: null,
      deviceId: input.deviceId,
      granted: null,
      deliveredAt: null,
      codeIssuedAt: null,
      paidAt: null,
      confirmedBy: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.ttlMinutes * 60_000).toISOString(),
    };
    memoryOrders.set(row.id, row);
    return row;
  }

  const row = await rpcOne("create_order", {
    p_plan: input.plan,
    p_amount: input.amount,
    p_device: input.deviceId,
    p_ttl_minutes: input.ttlMinutes,
  });
  if (!row) throw new Error("建单失败：数据库未返回行");
  return row;
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  if (allowMemory()) {
    // 不清扫过期单：库里这一步就是普通 SELECT，status 该是什么就是什么。
    // 清扫只发生在建单时（create_order 内部），见 expireMemory 的注释。
    return memoryOrders.get(id) ?? null;
  }

  const { data, error } = await admin()
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`读取订单失败: ${error.message}`);
  return data ? toRow(data as Record<string, unknown>) : null;
}

export async function confirmOrder(
  id: string,
  by: string,
  provider: string | null
): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    // 接受 pending 与 expired 两种来源，与 confirm_order 的
    // `where status in ('pending','expired')` 一致：用户超时后才付款，
    // 单已过期但钱真付了，允许确认"复活"它才不会丢单。
    if (!o || (o.status !== "pending" && o.status !== "expired")) return null;
    o.status = "paid";
    o.paidAt = new Date().toISOString();
    o.confirmedBy = by;
    if (provider) o.provider = provider;
    return o;
  }

  return rpcOne("confirm_order", { p_id: id, p_by: by, p_provider: provider });
}

export async function claimOrderDelivery(
  id: string,
  deviceId: string,
  granted: unknown
): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    if (!o || o.status !== "paid" || o.deliveredAt !== null || o.deviceId !== deviceId) {
      return null;
    }
    o.deliveredAt = new Date().toISOString();
    o.granted = granted;
    return o;
  }

  return rpcOne("claim_order_delivery", {
    p_id: id,
    p_device: deviceId,
    p_granted: granted,
  });
}

export async function markCodeIssued(id: string, deviceId: string): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    if (!o || o.status !== "paid" || o.codeIssuedAt !== null || o.deviceId !== deviceId) {
      return null;
    }
    o.codeIssuedAt = new Date().toISOString();
    return o;
  }

  return rpcOne("mark_code_issued", { p_id: id, p_device: deviceId });
}

export async function unconfirmOrder(id: string): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    if (!o || o.status !== "paid" || o.deliveredAt !== null || o.codeIssuedAt !== null) {
      return null;
    }
    o.status = "pending";
    o.paidAt = null;
    o.confirmedBy = null;
    return o;
  }

  return rpcOne("unconfirm_order", { p_id: id });
}

export async function setPayerRef(
  id: string,
  deviceId: string,
  payerRef: string,
  provider: string | null
): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    if (!o || o.deviceId !== deviceId) return null;
    o.payerRef = payerRef;
    if (provider) o.provider = provider;
    return o;
  }

  // provider 为空时不写这一列，而不是写 NULL —— 与内存路径同口径，也与
  // confirm_order 的 `coalesce(p_provider, provider)` 同一取向：不拿空值
  // 覆盖用户先前声明过的渠道。两条路径若在这里分叉，测试全绿而线上行为不同。
  const patch: Record<string, unknown> = { payer_ref: payerRef };
  if (provider) patch.provider = provider;

  const { data, error } = await admin()
    .from("orders")
    .update(patch)
    .eq("id", id)
    .eq("device_id", deviceId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`提交交易单号失败: ${error.message}`);
  return data ? toRow(data as Record<string, unknown>) : null;
}

/** 最近 N 毫秒内的订单，按创建时间倒序。对账脚本用。 */
export async function listRecentOrders(sinceMs: number): Promise<OrderRow[]> {
  const since = new Date(Date.now() - sinceMs).toISOString();

  if (allowMemory()) {
    // 同样不清扫 —— 库里就是一条普通 SELECT，对账脚本看到的应是库里的真状态。
    return [...memoryOrders.values()]
      .filter((o) => o.createdAt >= since)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const { data, error } = await admin()
    .from("orders")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`读取订单列表失败: ${error.message}`);
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}
