/**
 * 站点自身的地址。
 *
 * 单独一处，因为 layout 的 metadataBase、robots.txt 与 sitemap.xml 都要用它 ——
 * 三处各写一遍的话，换域名时必然会漏掉一两处，而漏掉的表现是搜索结果里
 * 出现 localhost 或 Vercel 预览域名，这种错误在本地完全看不出来。
 *
 * 解析顺序：显式配置 → Vercel 提供的部署域名 → 本地开发。
 * 上线时建议显式设置 NEXT_PUBLIC_SITE_URL（自定义域名），
 * 否则 canonical 与 sitemap 会指向 *.vercel.app。
 */

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit && explicit.trim()) {
    return explicit.trim().replace(/\/+$/, "");
  }

  // Vercel 会自动注入；预览部署也拿得到，所以只作兜底
  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;
  if (vercel && vercel.trim()) {
    return `https://${vercel.trim().replace(/\/+$/, "")}`;
  }

  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();

export const SITE_NAME = "玄机";
