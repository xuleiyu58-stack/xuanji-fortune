import Link from "next/link";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";

/**
 * 页脚。
 *
 * 这里原有三个 href="#" 的死链（关于我们 / 免责声明 / 联系客服）——
 * 点了只是跳回页顶，比没有链接更糟：用户以为有条款可看，点下去什么也没有。
 * 现在三个法律页都真实存在了，链接才挂回来；联系方式也从 lib/contact.ts 取，
 * 与付款弹窗里那个是同一个值。
 */

const LEGAL_LINKS = [
  { href: "/terms", label: "用户协议" },
  { href: "/privacy", label: "隐私政策" },
  { href: "/disclaimer", label: "免责声明" },
];

export default function Footer() {
  return (
    <footer className="border-t border-gold-300/10 py-8 px-6">
      <div className="max-w-6xl mx-auto flex flex-col gap-5">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl" style={{ fontFamily: "'Ma Shan Zheng', cursive" }}>
              玄机
            </span>
            <span className="text-paper-100/55 text-xs tracking-wider">| AI 命理解读</span>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label="条款与联系">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-paper-100/55 hover:text-gold-300 transition-colors text-xs tracking-wider"
              >
                {l.label}
              </Link>
            ))}
            <a
              href={CONTACT_MAILTO}
              className="text-paper-100/55 hover:text-gold-300 transition-colors text-xs tracking-wider"
            >
              联系客服
            </a>
          </nav>
        </div>

        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-paper-100/55 text-xs tracking-wider">
            本网站内容仅供娱乐参考，命运掌握在自己手中
          </p>
          <p className="text-paper-100/45 text-xs tracking-wider select-all">
            {CONTACT_EMAIL}
          </p>
        </div>
      </div>
    </footer>
  );
}
