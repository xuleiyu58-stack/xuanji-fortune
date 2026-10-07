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
        // /admin 是站长的内部工具页，不是内容页 —— 与 /api/ 同理，不该被爬。
        // 注意这条只是"请别爬"的君子协定，真正的门是 ADMIN_KEY；
        // 爬虫不看 robots.txt 时，它遇到的也只是一个 404。
        disallow: ["/api/", "/admin"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
