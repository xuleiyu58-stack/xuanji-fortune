import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * sitemap.xml。
 *
 * 全站只有 6 个公开页面（首页 + 会员 + 登录 + 三个法律页），所以是一份写死的清单，
 * 不动态生成 —— 页面少的时候，手写清单比扫描文件系统更不容易出错。
 *
 * 刻意**不收录 /api/**：接口不该出现在站点地图里。
 *
 * /login 收录但优先级低：它是功能页不是内容页，让搜索引擎知道它存在
 * （避免用户搜"玄机 登录"时找不到），但不指望它带流量。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/member`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    // 法律页几乎不变，优先级最低 —— 收录它们是为了合规可见，不是为了流量
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/disclaimer`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
