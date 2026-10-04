"use client";

import { useState } from "react";
import { inlineHtml } from "@/lib/sanitize";
import { DISCLAIMER } from "@/lib/disclaimer";
import { SECTION_TITLES } from "@/lib/reading";

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

/**
 * 首页样张。
 *
 * 为什么要有它：新访客打开首页，看到的只是一个空白表单和一句 ¥6.6。
 * 他既不知道会得到什么，也没法判断质量 —— 让他掏钱等于让他赌。
 * 这里放一节**真实生成过的**解读（只脱去生辰，文字一字未改），
 * 让他先看到东西，再决定付不付。
 *
 * 刻意的几个选择：
 *   · 只展示一节 —— 与免费试读同一节。展示整份等于把产品白送，
 *     展示太少又看不出口径，一节刚好够判断"这个 AI 讲得有没有道理"
 *   · 用 READING 的真实渲染样式（结论/依据/展开三层），不是另写一套排版 ——
 *     样张必须代表真实交付的样子，两套渲染迟早会不一致
 *   · 生辰已隐去，只留四柱：四柱是从生辰推出来的，留着能让人对上「依据」
 *     里引用的干支，这让样张可核验 —— 而这正是产品的卖点
 */
const SAMPLE = {
  /** 四柱。留它是为了让下面的「依据」可以被对照核验。 */
  pillars: "庚戌 · 辛未 · 庚辰 · 辛巳",
  title: "命局总评",
  verdict:
    "此造为庚金身强、正印格，全局金土厚重而木火微弱，一生关键在能否把过旺的金气疏导出去。",
  basis:
    "日主庚金坐戌，年、月、时三柱天干皆见辛金或庚金帮身，地支未、丑、戌、辰四土又源源生金，而全局木仅 7%、火仅 7%，五行虽全却严重失衡。",
  detail:
    "八字讲究的是「平衡」二字，金太旺好比一把刀淬得太硬，锋利是锋利，却容易崩口。此局土金成势，最需要的是一条出口——火来炼金成器，木来疏土泄秀。偏偏火木最弱，所以命主的课题不是「不够强」，而是「力气往哪儿使」。",
};

export default function HomepageSample() {
  const [open, setOpen] = useState(false);
  const locked = SECTION_TITLES.length - 1;

  return (
    <section className="max-w-3xl mx-auto mt-16" id="sample">
      <div className="text-center mb-6">
        <h2 className="text-xl text-gold mb-2" style={SERIF}>会得到什么</h2>
        <p className="text-paper-100/55 text-sm">
          下面是一份真实生成的解读的其中一节，生辰已隐去
        </p>
      </div>

      <div className="mystic-card rounded-lg overflow-hidden">
        {/* 折叠头。默认收起 —— 首页的主角是表单，样张不该把表单挤到屏幕外。 */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="sample-body"
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-gold-300/[0.04] transition-colors"
        >
          <span className="min-w-0">
            <span className="block text-paper-100/85 text-sm mb-1" style={SERIF}>
              【{SAMPLE.title}】
            </span>
            <span className="block text-paper-100/50 text-xs truncate">
              {SAMPLE.verdict}
            </span>
          </span>
          <span className="shrink-0 text-gold-400/60 text-xs">
            {open ? "收起" : "展开看详例"}
          </span>
        </button>

        {/* 正文**始终渲染**，收起只是视觉上的 —— 用 hidden 属性而不是
            `{open && …}` 条件渲染。

            原因是 SEO：这段样张是首页最有价值的原创内容，而条件渲染的话
            它根本不在服务端产出的 HTML 里，搜索引擎抓不到。这个折叠面板
            本来就是给搜索引擎和犹豫的用户看的，抓不到就等于白做。

            hidden 属性会同时隐藏内容与无障碍树，读屏软件不会念出收起的内容。 */}
        <div
          id="sample-body"
          hidden={!open}
          className="border-t border-gold-300/10 px-5 py-5 space-y-4"
        >
          <p className="text-paper-100/45 text-xs">
            四柱：{SAMPLE.pillars}
            <span className="text-paper-100/30"> · 生辰已隐去</span>
          </p>

          <div className="rounded border border-gold-300/10 bg-mystic-900/40 px-3 py-2 flex items-start gap-2">
            <span className="shrink-0 text-[10px] tracking-widest text-gold-400/60 mt-0.5">
              结论
            </span>
            <span className="text-paper-100/80 text-sm leading-relaxed">
              {SAMPLE.verdict}
            </span>
          </div>

          {/* 「依据」是这份产品的核心：它点明盘上哪一柱、哪个十神。
              用户据此能自己核验 —— 这是「代码排盘、AI 只解读」
              这条线在界面上的落点，所以样张里必须展示它。 */}
          <div className="rounded border border-gold-300/10 bg-mystic-900/40 px-3 py-2 flex items-start gap-2">
            <span className="shrink-0 text-[10px] tracking-widest text-gold-400/60 mt-0.5">
              依据
            </span>
            <span className="text-paper-100/50 text-xs leading-relaxed">
              {SAMPLE.basis}
            </span>
          </div>

          <p
            className="text-paper-100/70 text-sm leading-loose"
            dangerouslySetInnerHTML={{ __html: inlineHtml(SAMPLE.detail) }}
          />

          <p className="text-paper-100/45 text-xs leading-relaxed pt-1 border-t border-gold-300/10">
            完整解读含 {SECTION_TITLES.length} 节：{SECTION_TITLES.join("、")}。
            未激活可先免费试读「命局总评」一节，其余 {locked} 节需激活后查看。
          </p>

          <p className="text-paper-100/40 text-xs leading-relaxed">{DISCLAIMER}</p>
        </div>
      </div>
    </section>
  );
}
