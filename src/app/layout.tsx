import type { Metadata } from "next";
import "./globals.css";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  // 没有它，相对 URL（canonical、og:image）会解析成 localhost，
  // 分享出去的链接就可能带着一个别人打不开的域名
  metadataBase: new URL(SITE_URL),
  title: {
    default: "玄机 · 八字命理 | 程序排盘，AI 解读",
    // 子页面若只给 title 字符串，会自动补上站名
    template: "%s | 玄机 · 八字命理",
  },
  description:
    "子平八字在线排盘。四柱、藏干、十神、神煞、五行、大运由程序精确推算，AI 只负责解读已排好的盘。不替你决定命运，只把此刻的命局讲清楚。",
  keywords: "八字,四柱,排盘,子平,命理,十神,五行,大运,日主,AI算命,在线排盘",
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    title: "玄机 · 八字命理",
    description: "程序排盘，AI 解读。知其所来，明其所往。",
    type: "website",
    locale: "zh_CN",
    siteName: SITE_NAME,
    url: "/",
    // og:image 由 app/opengraph-image.png 约定式提供，这里不写 ——
    // 手写 images 会覆盖掉那份自动生成的 1200×630 图
  },
  twitter: {
    card: "summary_large_image",
    title: "玄机 · 八字命理",
    description: "程序排盘，AI 解读。知其所来，明其所往。",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className="antialiased"
        style={{
          fontFamily: "'Noto Sans SC', sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
