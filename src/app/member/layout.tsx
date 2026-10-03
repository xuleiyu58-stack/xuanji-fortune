import type { Metadata } from "next";

/**
 * member/page.tsx 是客户端组件，客户端组件不能导出 metadata ——
 * 少了这一层，/member 会继承首页的标题与描述，搜索结果里两个页面长得一模一样。
 * 这个只有十几行的服务端 layout 就是为这一件事存在的。
 */
export const metadata: Metadata = {
  title: "开通会员",
  description:
    "玄机会员：不限次八字排盘解读，月卡与年卡两种选择。付款后获取激活码，站内输入即刻解锁。",
  alternates: { canonical: "/member" },
};

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
