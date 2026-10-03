import { MODES, MEMBER_PLANS, formatPrice } from "@/lib/pricing";

/**
 * 首页常见问题。
 *
 * 提出来单独一处，是因为它有两个消费者：页面上的 FAQ 列表，以及
 * 给搜索引擎看的 FAQPage 结构化数据。两处各写一份的话，
 * 改了一处忘了另一处，结构化数据就会和页面上真正展示的内容对不上 ——
 * 那是会被搜索引擎判为作弊的。
 *
 * 提问按真实疑虑排序：准不准 → 会不会编 → 隐私 → 钱。
 * 前两个不答清楚，后面两个没人看。
 */

const Yuan = (n: number) => `¥${formatPrice(n)}`;

export const FAQ: { q: string; a: string }[] = [
  {
    q: "排盘是程序算的，还是 AI 算的？",
    a: "程序算。四柱、藏干、十神、五行、大运全部由确定性算法推算，AI 拿到的是已经排好的结果，只负责解读。日柱靠大模型心算基本必错，而这是命理最不该出错的地方。",
  },
  {
    q: "算得准吗？",
    a: "排盘本身是精确的历法推算，可核验。解读部分是一套理解自己的框架，不是预言 —— 我们把传统命理的推演逻辑讲清楚，供你参照。",
  },
  {
    q: "我的出生信息会被存下来吗？",
    a: "排盘记录只保存在你自己浏览器的本地存储里，不会上传，我们也看不到。清空浏览器数据即彻底删除。",
  },
  {
    q: "怎么收费？",
    a: `单次排盘解读 ${Yuan(MODES.bazi.price)}，按次支付、不自动续费。会员 ${Yuan(MEMBER_PLANS[0].price)}/月 或 ${Yuan(MEMBER_PLANS[1].price)}/年，无限次。`,
  },
];

/** FAQPage 结构化数据。内容与页面上展示的完全一致 —— 见本文件顶部说明。 */
export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}
