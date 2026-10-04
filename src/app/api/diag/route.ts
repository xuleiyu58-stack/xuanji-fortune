import { NextResponse } from "next/server";

/**
 * 临时诊断端点 —— 用完即删。
 *
 * 线上 /api/fortune 稳定 3 秒失败，而本地（同一个库、同一个 key）9.4 秒成功。
 * 差别只能在 Vercel 的环境。但线上代码把上游报错吞成了一句通用文案，
 * 看不到真实原因。
 *
 * ⚠️ 这个端点是**公开可访问**的（Vercel 上任何路由都是）。所以它绝对不许
 * 返回密钥本身，也不返回可被离线爆破比对的指纹 —— 只返回长度与空白状态，
 * 那已足够判断"配的是不是同一个值"。
 *
 * 只做两件事：
 *   1. 报告各环境变量是否存在、长度对不对、有没有混入空白
 *   2. 实测 Vercel 能否连上 DeepSeek，把真实状态码带回来
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const key = process.env.DEEPSEEK_API_KEY;

  const env = {
    DEEPSEEK_API_KEY: key
      ? {
          已设置: true,
          长度: key.length,
          // 本地那份是 35 字符。长度不符即可确诊配错了值。
          长度是否符合预期: key.length === 35 ? "是" : `否（预期 35，实际 ${key.length}）`,
          前后空白: key !== key.trim() ? "【有空白字符！】" : "无",
        }
      : { 已设置: false },
    DEEPSEEK_DAILY_BUDGET: process.env.DEEPSEEK_DAILY_BUDGET ?? "(未设置)",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `已设置（${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host}）`
      : "(未设置)",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? `已设置，长度 ${process.env.SUPABASE_SERVICE_ROLE_KEY.length}`
      : "(未设置)",
    PASS_SECRET: process.env.PASS_SECRET
      ? `已设置，长度 ${process.env.PASS_SECRET.length}（预期 43）`
      : "(未设置)",
    VERCEL_REGION: process.env.VERCEL_REGION ?? "(未知)",
    VERCEL_ENV: process.env.VERCEL_ENV ?? "(未知)",
    NODE_VERSION: process.version,
  };

  // 实测上游：一个极小的请求，看 Vercel 能否连上 DeepSeek。
  // 这是关键 —— 如果这里也失败，说明 Vercel 根本连不上上游；
  // 如果这里成功，说明连通性没问题，问题在生成耗时或别的环节。
  let upstream: Record<string, unknown> = {};
  if (key) {
    const t = Date.now();
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: "说一个字" }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      const text = await r.text();
      upstream = {
        状态码: r.status,
        耗时: `${((Date.now() - t) / 1000).toFixed(1)}s`,
        // 出错时上游会返回 JSON 错误说明，那正是我们要看的；成功时只报长度
        响应: r.ok ? `（成功，${text.length} 字节）` : text.slice(0, 300),
      };
    } catch (e) {
      upstream = {
        异常: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        耗时: `${((Date.now() - t) / 1000).toFixed(1)}s`,
        // 底层原因常常藏在 cause 里（DNS / TLS / 连接被拒）
        底层: e instanceof Error && e.cause ? String((e.cause as Error).message ?? e.cause) : "(无)",
      };
    }
  }

  return NextResponse.json({ env, upstream });
}
