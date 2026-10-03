"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 浏览器端 Supabase 会话。
 *
 * 为什么前端也要一个 SDK：邮箱验证码登录会返回一个**需要定期刷新的会话**，
 * 这段逻辑（存 token、到期前自动续期、跨标签页同步）自己写在 cookie 里
 * 就是重新实现一遍 Supabase 的认证客户端。交给官方 SDK，我们只消费它的
 * access_token，把它放进 Authorization 头发给自己的接口。
 *
 * 注意 anon key 是**公开的**，本来就该出现在浏览器里 —— 它的权限由 RLS 与
 * 服务端的 service_role 边界限制。真正的密钥（SERVICE_ROLE / PASS_SECRET）
 * 一个都不在这里。
 */

let _client: SupabaseClient | null = null;

/**
 * 未配置 Supabase 时返回 null，界面据此隐藏账号入口。
 * 不做"本地假登录"—— 那正是这个项目已经删掉一次的那类东西。
 */
export function authClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  if (!_client) {
    _client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // 邮箱验证码走的是站内输入，不需要从 URL 里解析回调
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}

export function accountsEnabled(): boolean {
  return authClient() !== null;
}

/** 当前 access_token；未登录返回 null。 */
export async function accessToken(): Promise<string | null> {
  const sb = authClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** 带登录态的 fetch 头。未登录时就退化成普通请求。 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function currentEmail(): Promise<string | null> {
  const sb = authClient();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.email ?? null;
}

/**
 * 登录态的前端广播。
 *
 * 为什么需要它：页头的账号入口只在挂载时查过一次登录态。用户在 /login
 * 登录成功之后，页头并不会重新检查 —— 于是出现"已经登录了，页头还写着登录"
 * 这种明显不对的状态。它不报错、功能也没坏，但看起来就是坏了。
 *
 * 与 lib/entitlements.ts 用同一套模式（模块级订阅 + 刷新函数）：
 * 登录/登出时广播一次，所有关心登录态的组件自己重新取。
 */
type AuthListener = () => void;
const authListeners = new Set<AuthListener>();

export function subscribeAuth(fn: AuthListener): () => void {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
}

/** 登录态变化后调用，通知所有订阅者重新取。 */
export function notifyAuthChanged(): void {
  for (const fn of authListeners) fn();
}

export async function signOut(): Promise<void> {
  const sb = authClient();
  if (!sb) return;
  await sb.auth.signOut();
}

/**
 * 把本机（未登录时）兑换到的权益迁到刚登录的账户上。
 *
 * 两段式，因为权益凭证 xj_pass 是 httpOnly 的 —— 页面脚本读不到它，
 * 这正是它的价值。所以：
 *   1. 后端凭设备 cookie 签发一张 10 分钟、一次性的短码
 *   2. 后端凭短码查出设备号，把权益**搬**进账户（并从设备侧删除，防复制）
 *
 * 返回 null 表示没有需要迁移的权益 —— 新用户第一次登录就是这种情况，
 * 不是错误，界面不该报错。
 *
 * 迁移失败**不阻断登录**：用户已经登录成功了，权益留在本机也照常能用，
 * 只是暂时跨不了设备。为一次迁移失败把整个登录判为失败是本末倒置。
 */
export async function linkDeviceCredential(): Promise<LinkResult> {
  try {
    const headers = await authHeaders();

    // 第一步：申请认领码
    const issued = await fetch("/api/account/link", { method: "POST", headers });
    if (issued.status === 503) return { status: "unconfigured" };
    if (!issued.ok) return { status: "failed" };

    const issuedBody = await issued.json().catch(() => null);
    const code: string | null = issuedBody?.code ?? null;
    if (!code) return { status: "nothing_to_link" };

    // 第二步：核销并迁移
    const claimed = await fetch("/api/account/claim", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!claimed.ok) return { status: "failed" };

    const claimedBody = await claimed.json().catch(() => null);
    return { status: "linked", summary: claimedBody?.entitlement ?? null };
  } catch {
    return { status: "failed" };
  }
}

export type LinkResult =
  | { status: "linked"; summary: unknown }
  | { status: "nothing_to_link" }
  | { status: "unconfigured" }
  | { status: "failed" };
