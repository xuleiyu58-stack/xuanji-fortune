import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";

/**
 * 法律页的外壳。
 *
 * 三个页面（用户协议 / 隐私政策 / 免责声明）的骨架完全一样，只有正文不同 ——
 * 各自抄一份的话，「最后更新日期」和联系方式迟早会漂移，
 * 而法律页上写着一个错的日期或一个失效的邮箱，比没有这一页更糟。
 *
 * 刻意**不做动效**：这几页是给人查条款的，不是给人看的。
 * 也刻意是服务端组件 —— 三页都能静态渲染，没必要往浏览器发 JS。
 */

export interface LegalSection {
  heading: string;
  /** 段落。字符串数组里每一项是一段。 */
  paragraphs?: string[];
  /** 无序列表项。 */
  bullets?: string[];
}

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

interface Props {
  title: string;
  /** 一句话说清这一页管什么 */
  summary: string;
  updatedAt: string;
  sections: LegalSection[];
}

export default function LegalPage({ title, summary, updatedAt, sections }: Props) {
  return (
    <div className="min-h-screen relative">
      <Header />
      <div className="ink-bg" />

      <main className="relative z-10 pt-28 pb-20 px-6">
        <article className="max-w-2xl mx-auto">
          <header className="mb-12">
            <p className="section-eyebrow">法律条款</p>
            <h1
              className="text-3xl md:text-4xl text-gold mb-4"
              style={SERIF}
            >
              {title}
            </h1>
            <p className="text-paper-100/70 text-sm leading-relaxed">{summary}</p>
            <p className="text-paper-100/55 text-xs mt-3">最后更新：{updatedAt}</p>
          </header>

          <div className="space-y-9">
            {sections.map((s, i) => (
              <section key={s.heading}>
                <h2 className="text-gold-300 text-lg mb-3" style={SERIF}>
                  <span className="text-gold-400/50 mr-2 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.heading}
                </h2>

                {s.paragraphs?.map((p) => (
                  <p key={p} className="text-paper-100/75 text-sm leading-loose mb-3">
                    {p}
                  </p>
                ))}

                {s.bullets && (
                  <ul className="space-y-2 mt-1">
                    {s.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-3">
                        <span
                          className="mt-2 h-1.5 w-1.5 rounded-full bg-gold-400/60 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="text-paper-100/75 text-sm leading-loose">{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            <section className="mystic-card rounded-lg p-6 mt-12">
              <h2 className="text-gold text-base mb-3" style={SERIF}>
                联系我们
              </h2>
              <p className="text-paper-100/75 text-sm leading-loose">
                对本页内容有疑问，或需要行使上述任何一项权利，请发邮件至{" "}
                <a
                  href={CONTACT_MAILTO}
                  className="text-gold-300 hover:text-gold-200 underline transition-colors select-all"
                >
                  {CONTACT_EMAIL}
                </a>
                。我们会在收到后尽快回复。
              </p>
            </section>
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
