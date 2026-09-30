import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, renderFortuneHtml } from "../src/lib/sanitize.ts";

test("转义 HTML 元字符", () => {
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(escapeHtml(`a & b "c" 'd'`), "a &amp; b &quot;c&quot; &#39;d&#39;");
});

test("注入的标签不会存活", () => {
  const out = renderFortuneHtml('<img src=x onerror="alert(1)">');
  // 要断言的是"没有形成标签"，而不是"没有这几个字" ——
  // 转义后 onerror= 会作为无害的纯文本保留下来，这是对的。
  assert.doesNotMatch(out, /<img/);
  assert.doesNotMatch(out, /<[a-zA-Z][^>]*onerror/);
  assert.match(out, /&lt;img/);
});

test("保留 **粗体** 的排版", () => {
  assert.match(renderFortuneHtml("这是**重点**内容"), /<strong[^>]*>重点<\/strong>/);
});

test("保留 【小标题】 的排版", () => {
  assert.match(renderFortuneHtml("【今日卦象】乾为天"), /<strong[^>]*>【今日卦象】<\/strong>/);
});

test("换行转成 br", () => {
  const out = renderFortuneHtml("第一行\n第二行\n\n第三段");
  assert.match(out, /第一行<br\/?>第二行/);
});

test("先转义再套排版：标签里的尖括号不会被当成语法", () => {
  const out = renderFortuneHtml("**<script>x</script>**");
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});

test("粗体与标题标记本身仍可用，不被当成注入清掉", () => {
  const out = renderFortuneHtml("【命局总评】日主**偏弱**，宜扶助");
  assert.match(out, /【命局总评】/);
  assert.match(out, /<strong[^>]*>偏弱<\/strong>/);
});
