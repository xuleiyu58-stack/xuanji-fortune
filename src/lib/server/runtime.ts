import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 服务端环境装配。
 *
 * usage-store 与 codes 都要一个 Supabase admin 客户端、都要判断"没配 Supabase 时怎么办"，
 * 所以这两件事集中在这里，而不是各写一份。
 */

export function envValue(...names: string[]): string | undefined {
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

export function admin(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "数据层未配置：缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY"
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

/**
 * 没配 Supabase 时能不能退化为进程内内存。
 * 开发环境可以（单人调试够用），生产环境必须拒绝服务 —— 宁可 503，也不能敞着口子。
 */
export function allowMemoryFallback(): boolean {
  if (isSupabaseConfigured()) return false;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "数据层未配置且运行于生产环境：无法限流与核销，拒绝提供服务。请配置 Supabase。"
    );
  }
  return true;
}

/** 凭证签名密钥。未配置时返回 null，调用方据此把凭证视为不存在。 */
export function passSecret(): string | null {
  return envValue("PASS_SECRET") ?? null;
}
