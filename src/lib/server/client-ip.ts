/**
 * 请求来源 IP。
 *
 * 抽出来是因为**不止一处要它**：解读的限流（quota-guard 按设备 / IP / 全局三档计数）
 * 与确认页的失败次数（admin-guard 按 IP 记）都拿它当分桶键。
 * 两份实现迟早会因为只改了一处而漂移 —— 而漂移的那一份就是绕过限流的入口。
 * 这与 quota-guard 自己那条注释同一个理由（"限流是安全代码，抄一份就是敞着的口子"）。
 *
 * 收 `Headers` 而不是 NextRequest：不依赖 next/server，本模块就能被 node --test
 * 直接跑到，也能被不 import next/* 的纯判定模块引用。
 */
export interface HeadersLike {
  get(name: string): string | null;
}

export function clientIp(headers: HeadersLike): string {
  // Vercel 会在 x-forwarded-for 里给出真实来源，取第一段（后面那些是链路里的代理）
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  // 本机直连（自建服务器走 Caddy 反代时也常见）拿不到 x-forwarded-for，退到这一条。
  // "0.0.0.0" 是**一个**桶而不是"不限额"：认不出来源时所有请求共用同一个桶，
  // 那只会让限流更早触发（更严），不会更松。
  return headers.get("x-real-ip") ?? "0.0.0.0";
}
