"use client";

import { useMemo } from "react";
import { parseReading, hasBasis, type ReadingSection } from "@/lib/reading";
import { inlineHtml, renderFortuneHtml } from "@/lib/sanitize";
import { DISCLAIMER } from "@/lib/disclaimer";

/**
 * 解读面板。
 *
 * 每节拆成「结论 / 依据 / 展开」三层来呈现，而不是糊成一段：
 *   · 结论——最想让你记住的那一句，字号大一点，先看到；
 *   · 依据——盘上哪一柱哪个十神，字号小、颜色淡，但**必须显示出来**。
 *     它存在的意义是让人能自己核验，藏起来就等于没有；
 *   · 展开——白话解释，正文排版。
 *
 * 模型没按格式走时退回整块渲染。宁可少一点结构，也不能让人看不到解读。
 */

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

/** 这几节的语气与前几节不同，单独给一点区别，但不喧宾夺主。 */
const CLOSING_TITLES = new Set(["大师寄语", "月老寄语", "塔罗启示"]);

function SectionCard({ section }: { section: ReadingSection }) {
  const { title, part } = section;
  const closing = CLOSING_TITLES.has(title);

  return (
    <section
      className={`rounded-lg p-5 sm:p-6 ${
        closing ? "border border-gold-500/30 bg-gold-500/[0.05]" : "border border-gold-300/10 bg-mystic-800/40"
      }`}
    >
      <h4 className={`text-base mb-4 ${closing ? "text-gold-300" : "text-gold-400/85"}`} style={SERIF}>
        {title}
      </h4>

      {part.verdict && (
        <p
          className="text-paper-100/85 text-sm sm:text-[15px] leading-relaxed mb-4"
          dangerouslySetInnerHTML={{ __html: inlineHtml(part.verdict) }}
        />
      )}

      {hasBasis(section) && (
        <div className="flex items-start gap-2 mb-4 rounded border border-gold-300/10 bg-mystic-900/40 px-3 py-2">
          <span className="shrink-0 text-[10px] tracking-widest text-gold-400/60 mt-0.5">依据</span>
          <span
            className="text-paper-100/50 text-xs leading-relaxed"
            dangerouslySetInnerHTML={{ __html: inlineHtml(part.basis!) }}
          />
        </div>
      )}

      {part.detail && (
        <div
          className="text-paper-100/70 text-sm leading-loose"
          dangerouslySetInnerHTML={{ __html: inlineHtml(part.detail) }}
        />
      )}
    </section>
  );
}

export default function ReadingPanel({
  content,
  locked = 0,
}: {
  content: string;
  /**
   * 还有多少节没解锁（免费试读时为正数）。
   *
   * 面板只负责显示"下面还有东西"，**不管怎么解锁** —— 付费入口由调用方
   * 决定放在哪里。解读组件不该知道自己卖多少钱。
   */
  locked?: number;
}) {
  const parsed = useMemo(() => parseReading(content), [content]);

  // 免责声明由 parseReading 从正文里剥掉（它不该混进任何一节的「依据」），
  // 但剥掉之后必须在这里补回来 —— 否则合规文案就凭空消失了。
  // 用代码里的常量而不是模型写的那一句：模型漏写、改写都不该影响它出现。
  const disclaimer = (
    <p className="text-paper-100/60 text-xs leading-relaxed border-l-2 border-gold-300/25 pl-3">
      {DISCLAIMER}
    </p>
  );

  // 解析不出小节时退回整块渲染 —— 模型没按格式走，也不能让人看不到解读
  if (parsed.sections.length === 0) {
    return (
      <div className="mystic-card rounded-lg p-8 border-gold-glow">
        <h3 className="text-lg text-gold mb-5" style={SERIF}>大师解读</h3>
        <div
          className="fortune-text text-paper-100/80 text-sm leading-loose"
          dangerouslySetInnerHTML={{ __html: renderFortuneHtml(parsed.fallback ?? content) }}
        />
        <div className="mt-6">{disclaimer}</div>
      </div>
    );
  }

  const withBasis = parsed.sections.filter(hasBasis).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg text-gold" style={SERIF}>
          {locked > 0 ? "命局总评 · 试读" : "大师解读"}
        </h3>
        <p className="text-paper-100/55 text-xs">
          {locked > 0 ? (
            <>已显示 1 节，还有 {locked} 节待解锁</>
          ) : (
            <>
              共 {parsed.sections.length} 节
              {withBasis > 0 && `，其中 ${withBasis} 节给出了盘面依据`}
            </>
          )}
        </p>
      </div>
      {parsed.sections.map((s) => (
        <SectionCard key={s.title} section={s} />
      ))}

      {/* 未解锁部分的"影子"。
          用灰条而不是把小节名直接列出来：列出名字等于把目录白送出去，
          而灰条传达的是"这里还有内容"——既让人知道有多少，又不透露是什么。 */}
      {locked > 0 && (
        <div className="rounded-lg border border-gold-300/10 bg-mystic-800/20 p-5 space-y-3" aria-hidden>
          {Array.from({ length: Math.min(locked, 6) }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-paper-100/10" />
              <div className="h-2.5 w-full rounded bg-paper-100/[0.07]" />
              <div className="h-2.5 w-4/5 rounded bg-paper-100/[0.07]" />
            </div>
          ))}
        </div>
      )}

      {disclaimer}
    </div>
  );
}
