import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function source(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/**
 * 只留代码，剥掉注释。
 *
 * 断言"代码里没有某种写法"时，注释里往往正引用着那个被删掉的旧写法 ——
 * 直接对原文匹配，测的就成了注释。
 *
 * 用字符级扫描而不是按行过滤：JSX 的块注释 `{/* … *\/}` 中间那几行既不以
 * `*` 开头、也不含 `//`，按行过滤会漏掉它们（这条以前栽过）。
 */
function codeOnly(src: string): string {
  let out = "";
  let i = 0;
  let inLine = false;
  let inBlock = false;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (inLine) {
      if (src[i] === "\n") {
        inLine = false;
        out += "\n";
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (two === "*/") {
        inBlock = false;
        i += 2;
        continue;
      }
      // 保留换行，否则剥完注释整段结构塌成一行
      if (src[i] === "\n") out += "\n";
      i += 1;
      continue;
    }
    if (two === "//") {
      inLine = true;
      i += 2;
      continue;
    }
    if (two === "/*") {
      inBlock = true;
      i += 2;
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

const FORM = "src/components/FortuneForm.tsx";
const BIRTH_FORM = "src/components/BirthForm.tsx";

test("出生表单只写了一份，首页与结果页共用", () => {
  assert.ok(existsSync(join(root, BIRTH_FORM)), "应当存在共用的 BirthForm 组件");

  const code = codeOnly(source(FORM));
  const birthForm = codeOnly(source(BIRTH_FORM));

  // 首页那支和「改生辰重测」那支都必须用共用组件
  const uses = (code.match(/<BirthForm\b/g) ?? []).length;
  assert.ok(uses >= 2, `FortuneForm 里应当有两处用 BirthForm，实际 ${uses} 处`);

  // 出生信息表单本体（BirthInput）只允许在 BirthForm 里出现一次。
  // 各写一套的话，将来加字段只会改到其中一处 —— 而漏掉的那处，
  // 通常正是用户已经在看的那个页面。
  assert.ok(
    !/<BirthInput\b/.test(code),
    "FortuneForm 不该直接渲染 BirthInput，应当经由 BirthForm"
  );
  assert.equal(
    (birthForm.match(/<BirthInput\b/g) ?? []).length,
    1,
    "BirthForm 里应当恰好渲染一次 BirthInput"
  );
});

test("结果页有「改生辰重测」入口，且不用滚回页首", () => {
  const code = codeOnly(source(FORM));

  assert.match(code, /改生辰重测/, "结果视图里应当有「改生辰重测」按钮");

  // 入口必须在解读面板**之前** —— 也就是紧跟在命盘之后。
  // 放在页面最底部就等于没加：用户发现时辰填错时人在盘旁边。
  //
  // 注意：要**先切出结果页那一支**再比位置。
  //
  // 两个坑都踩过：①文件前面还有一个 <ReadingPanel>（「历史回看」那一支的），
  // 拿全文第一次出现的位置去比，比的是别处的代码；②编辑面板那一支写在
  // 结果页那一支**前面**，所以结尾不能用 indexOf 往后找，得从它的开头往前收。
  const resultStart = code.search(/\{!viewing && result && !loading && !draft && \(/);
  const editStart = code.search(/\{!viewing && draft && !loading && \(/);
  assert.ok(resultStart >= 0, "应当能定位结果页那一支");
  assert.ok(editStart >= 0 && editStart < resultStart, "编辑面板那一支应当写在结果页之前");

  // 取出结果页那一支一直到文件末尾 —— 拿"位置先后"做断言时不需要精确闭合，
  // 多带进来的只是后面那些分支，而它们都在更靠后的位置，不影响谁先谁后。
  const resultBranch = code.slice(resultStart);

  const entryAt = resultBranch.indexOf('onClick={() => { setDraft({ ...formData });');
  const panelAt = resultBranch.indexOf("<ReadingPanel");
  assert.ok(entryAt > 0, "结果页里应当有打开编辑面板的按钮");
  assert.ok(panelAt > 0, "结果页里应当有解读面板");
  assert.ok(
    entryAt < panelAt,
    "「改生辰重测」应当排在解读面板之前（也就是命盘正下方）"
  );

  // 顺带钉住：命盘也在它前面 —— 用户是在看盘的时候发现时辰填错的
  const chartAt = resultBranch.indexOf("<BaziChart");
  assert.ok(chartAt > 0 && chartAt < entryAt, "命盘应当在「改生辰重测」之前");
});

test("编辑改的是草稿，取消不污染已提交的生辰", () => {
  const code = codeOnly(source(FORM));

  // 必须有独立的 draft 状态
  assert.match(code, /const \[draft, setDraft\] = useState/, "应当有独立的草稿状态");

  // 打开编辑面板时把当前输入**复制**进草稿，而不是引用同一份
  assert.match(
    code,
    /setDraft\(\{ \.\.\.formData \}\)/,
    "打开编辑时应当复制一份草稿，直接改 formData 会让「取消」无从恢复"
  );

  // 取消只丢草稿
  assert.match(code, /onCancel=\{\(\) => \{ setDraft\(null\); \}\}/, "取消应当只清空草稿");

  // onChange 写的是 draft，不是 formData
  assert.match(
    code,
    /setDraft\(\(prev\) => \(\{ \.\.\.\(prev \?\? \{\}\), \[name\]: value \}\)\)/,
    "编辑面板的输入应当写进草稿"
  );
});

test("追问与分享拿到的是已提交的那份生辰", () => {
  const code = codeOnly(source(FORM));

  // FollowUp 的 birth 必须来自 formData（服务端真的用过的那份），
  // 不能来自 draft —— 否则用户改了日期但没提交，追问会拿着新日期去找旧解读对账
  assert.match(
    code,
    /<FollowUp birth=\{formData\}/,
    "FollowUp 应当用已提交的 formData，而不是草稿"
  );
});

test("提交的是草稿，成功后才收起编辑面板", () => {
  const code = codeOnly(source(FORM));

  // submitDraft 必须把草稿交给接口，而不是 formData
  assert.match(code, /await callFortuneAPI\(draft\)/, "提交的应当是草稿");
  // 提交前先把它落成"已提交的那份"，这样命盘、追问、分享都指向新输入
  assert.match(code, /setFormData\(draft\)/, "提交时应当把草稿落成已提交值");

  // 成功（result 出现）才收起。失败时留着 —— 草稿不能跟着错误一起丢
  assert.match(
    code,
    /useEffect\(\(\) => \{\s*if \(result\) setDraft\(null\);\s*\}, \[result\]\)/,
    "应当只在拿到结果后收起编辑面板"
  );
});

test("接口调用收的是入参，不再偷读 formData", () => {
  const code = codeOnly(source(FORM));

  // 这是关键的一处解耦：callFortuneAPI 只认参数。
  // 若它在内部读 formData，那么"用草稿算"这件事永远做不到 ——
  // setFormData 是异步生效的，函数里读到的还是旧值。
  assert.match(
    code,
    /const callFortuneAPI = async \(input: Record<string, string>\)/,
    "callFortuneAPI 应当接收入参"
  );
  assert.match(
    code,
    /JSON\.stringify\(\{ mode, \.\.\.input \}\)/,
    "请求体应当用入参拼装"
  );
});

test("两个输入面板不会同时出现", () => {
  const code = codeOnly(source(FORM));

  // 首页那支（没结果、没草稿时显示）
  assert.match(code, /\{!viewing && !result && \(/, "首页表单的条件应当排除已有结果的情况");
  // 编辑面板那支
  assert.match(code, /\{!viewing && draft && !loading && \(/, "编辑面板应当由草稿驱动");
});
