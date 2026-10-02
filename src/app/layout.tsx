import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "玄机 · 八字命理 | 程序排盘，AI 解读",
  description:
    "子平八字在线排盘。四柱、藏干、十神、神煞、五行、大运由程序精确推算，AI 只负责解读已排好的盘。不替你决定命运，只把此刻的命局讲清楚。",
  keywords: "八字,四柱,排盘,子平,命理,十神,五行,大运,日主,AI算命,在线排盘",
  openGraph: {
    title: "玄机 · 八字命理",
    description: "程序排盘，AI 解读。知其所来，明其所往。",
    type: "website",
    locale: "zh_CN",
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
