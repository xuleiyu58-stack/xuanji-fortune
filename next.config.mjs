/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * 只给确认页这一条路径加响应头 —— 是全站唯一一处 per-route 配置，
   * 因为它也是全站唯一一个"密钥会出现在 URL 里"的页面。
   *
   * Referrer-Policy: 页面自己也写了 <meta name="referrer" content="no-referrer">
   * （见 app/admin/page.tsx），但**两层都留着**，它们不是重复的：
   *   · 响应头更强，且管住导航本身（meta 只管从该文档发起的请求）
   *   · meta 是页面级的事实声明，将来有人把这页挪到别的路径、或改了 source
   *     匹配不上（比如挪到 /admin/orders），meta 还在
   * 少了任何一层，浏览器在拉全局样式表里那条 Google Fonts @import 时，
   * 都可能把 `Referer: …/admin?key=…` 发给 fonts.googleapis.com。
   *
   * Cache-Control：这一页带着订单数据与密钥，任何一层中间缓存把它端给
   * 下一个人都是事故。页面那边还有 force-dynamic，两道都留着。
   *
   * X-Robots-Tag 与页面 metadata 里的 robots 同样是两层：
   * robots.txt 的 disallow 只是"别爬"的请求，响应头才是硬约束。
   */
  async headers() {
    const privateHeaders = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/admin", headers: privateHeaders },
      // 确认接口的响应同样不该被缓存（它带着 303 + Location，Location 里有密钥）
      { source: "/api/admin/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
