import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * robots.txt。
 *
 * 只放行公开页面，接口一律不许爬 —— 那些接口要么花钱（/api/fortune 会调用
 * 付费模型）、要么是核销入口（/api/redeem），被爬虫扫一遍就是实打实的损失。
 * 注意 4 条 /api 规则里没有 /api/entitlement 之外的必要豁免：
 * 权益查询对爬虫没有意义，也没有公开价值。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
