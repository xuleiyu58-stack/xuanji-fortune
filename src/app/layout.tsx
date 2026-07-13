import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "玄机 - AI 命理解读 | 八字 · 运势 · 塔罗 · 姻缘",
  description: "融合千年玄学智慧与人工智能，为您提供精准的八字命理、每日运势、姻缘配对、塔罗占卜等命理解读服务。知天命，掌人生。",
  keywords: "算命,八字,运势,塔罗,姻缘,命理,占卜,AI算命,在线算命,免费算命",
  openGraph: {
    title: "玄机 - AI 命理解读",
    description: "融合千年玄学智慧与人工智能，知天命，掌人生。",
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
