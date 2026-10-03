/**
 * AI 输出的渲染净化。
 *
 * 解读正文里含用户输入（生日、姓名、心事），提示注入可以把标签塞回来，
 * 而这段文本要经 dangerouslySetInnerHTML 渲染。所以先整体转义，再套用白名单内的排版标签。
 *
 * 零 import，便于 node --test 直接跑。
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/**
 * 顺序不能反：先转义，后套排版。
 * 反过来的话，`**<img onerror=...>**` 会被先变成 <strong> 再转义，标签照样活着。
 */
export function renderFortuneHtml(raw: string): string {
  return inlineHtml(raw)
    .replace(/【(.+?)】/g, '<strong class="text-gold-300 block mt-4 mb-2 text-base">【$1】</strong>');
}

/**
 * 段落内的行内排版：只转义 + 粗体 + 换行，**不**把【】当标题。
 *
 * 给分节渲染用 —— 那里小节标题已经由卡片自己承担了，正文里再冒出几个
 * 金色块级标题只会打架。同理，这是渲染 AI 文本的入口，转义一步都不能省。
 */
export function inlineHtml(raw: string): string {
  return (
    escapeHtml(raw)
      // 模型偶尔会自带 Markdown 标题（`### 事业财运`）；不剥掉的话井号会原样显示。
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-gold-300">$1</strong>')
      .replace(/\n{2,}/g, "<br/><br/>")
      .replace(/\n/g, "<br/>")
  );
}
