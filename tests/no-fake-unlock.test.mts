import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * 回归守卫：**解锁权不许回到浏览器里**。
 *
 * 这个站曾经是这样解锁的：点「已完成支付」→ `setMember(true)` → 写 localStorage，
 * 于是控制台敲一行 `localStorage.setItem('xuanji_member','true')` 就是终身会员；
 * 付费模式在服务端也不认人，谁都能每天白拿 3 次 ¥6.6 的解读。
 *
 * 现在权益只存在于服务端签发的 HMAC 凭证里，前端那点状态纯粹是显示用的缓存。
 * 这一组断言钉住的就是这件事 —— 它防的是"以后有人为了省事又把本地布尔值加回来"。
 */

function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // JSX 注释
    .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line)) // 整行行注释
    .map((line) => line.replace(/(^|\s)\/\/\s.*$/, "$1")) // 行尾注释
    .join("\n");
}

const ROOT = new URL("../src/", import.meta.url);

function walk(dir: URL, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(new URL(`${entry.name}/`, dir), `${rel}/`));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const TARGETS = walk(ROOT, "").sort();
const source = (rel: string) => stripComments(readFileSync(new URL(rel, ROOT), "utf8"));

test("监视范围覆盖 src 下的全部 ts/tsx", () => {
  assert.ok(TARGETS.includes("components/FortuneForm.tsx"), "排盘表单必须在监视范围内");
  assert.ok(TARGETS.includes("app/member/page.tsx"), "会员页必须在监视范围内");
  assert.ok(TARGETS.includes("lib/store.ts"), "本地存储模块必须在监视范围内");
  assert.ok(TARGETS.length >= 20, `监视范围疑似塌缩，只扫到 ${TARGETS.length} 个文件`);
});

test("全站不得再出现本地会员标记", () => {
  // xuanji_member 是当年那个布尔值的键名。它一旦回来，解锁权就回到了用户手里。
  for (const rel of TARGETS) {
    assert.doesNotMatch(
      source(rel),
      /xuanji_member/,
      `${rel} 又出现了本地会员标记 —— 解锁权必须只属于服务端签发的凭证`
    );
  }
});

test("全站不得再出现本地会员读写函数", () => {
  for (const rel of TARGETS) {
    assert.doesNotMatch(
      source(rel),
      /\b(setMember|isMember|setMemberExpiry|isMemberExpired)\s*\(/,
      `${rel} 又出现了本地会员读写函数`
    );
  }
});

test("界面里不得再有「点一下就解锁」的付款状态", () => {
  // hasPaid 是当年那个 React state：勾上它就等于付过钱了。
  for (const rel of TARGETS) {
    assert.doesNotMatch(
      source(rel),
      /\bhasPaid\b/,
      `${rel} 又出现了 hasPaid —— 付款状态不能由前端自己宣布`
    );
  }
});

test("localStorage 只用于排盘历史，不得承载权限", () => {
  // 法律页（尤其隐私政策）需要**用文字说明**哪些数据存在 localStorage —
  // 那是在告诉用户真相，不是在用本地存储存权限。所以按"是否真的调用"区分：
  // 提到 localStorage 这个词不算，出现 localStorage.xxx( 才算。
  const PROSE_ALLOWED = new Set([
    "lib/store.ts",
    "components/HistoryDrawer.tsx",
    "app/privacy/page.tsx",
  ]);
  const CALLS_STORAGE = /\blocalStorage\s*\.\s*\w+\s*\(/;

  for (const rel of TARGETS) {
    const src = source(rel);
    if (!CALLS_STORAGE.test(src)) continue;
    assert.ok(
      PROSE_ALLOWED.has(rel),
      `${rel} 调用了 localStorage —— 这里只允许保存排盘历史，权限状态一律走服务端`
    );
  }
});

test("提到 localStorage 但不调用的文件，只能是法律页", () => {
  // 反向确认上一条不是被放得太宽：若某个组件只是"提到"却没在允许名单里，
  // 说明它可能通过别的路径碰了本地存储，值得人看一眼。
  const MENTIONS_ONLY = TARGETS.filter((rel) => {
    const src = source(rel);
    return /\blocalStorage\b/.test(src) && !/\blocalStorage\s*\.\s*\w+\s*\(/.test(src);
  }).sort();

  assert.deepEqual(
    MENTIONS_ONLY,
    ["app/privacy/page.tsx"],
    `只提到 localStorage 的文件应只有隐私政策，实际：${MENTIONS_ONLY.join(", ")}`
  );
});

test("本地存储里不许再出现会员相关的键", () => {
  // 原来的写法是数 store.ts 里 `键: "值",` 的行数，太依赖排版 ——
  // 它把 saveReadingToCloud 里的 `method: "POST",` 也数了进去，
  // 于是"只剩一个键"这条断言在功能完全正确的情况下变红。
  //
  // 真正要守的不变量是：本地存储里不许有承载**权限**的键。
  // 所有 xuanji_* 键名必须在这个白名单内。
  //
  // 白名单里每一项都必须能回答"它凭什么不是权限"：
  //   · xuanji_history       排盘记录本身，纯客户端数据
  //   · xuanji_history_seen  只是"我看过历史了"的界面标记，用来熄灭红点。
  //                          改它最多让红点亮或不亮，**不含任何权益信息**，
  //                          也不能让任何人解锁任何东西。
  const ALLOWED = ["xuanji_history", "xuanji_history_seen"];
  const seen = new Set<string>();

  for (const rel of TARGETS) {
    for (const m of source(rel).matchAll(/"(xuanji_[a-z_]+)"/g)) seen.add(m[1]);
  }

  const unexpected = [...seen].filter((k) => !ALLOWED.includes(k)).sort();
  assert.deepEqual(
    unexpected,
    [],
    `本地存储出现了白名单外的键：${unexpected.join(", ")} —— 权限状态一律走服务端`
  );
  assert.ok(seen.has("xuanji_history"), "历史记录的键应当还在");

  // 反向确认：任何 xuanji_* 键都不得与会员/权益语义沾边
  for (const k of seen) {
    assert.doesNotMatch(
      k,
      /member|pass|vip|premium|entitle|unlock/,
      `本地键 "${k}" 的名字带了权益语义 —— 权益不许落在本地存储里`
    );
  }
});

test("凭证 cookie 必须是 httpOnly", () => {
  // 不是 httpOnly 的话，页面里任意脚本都能读到并外传这张凭证。
  const cookie = source("lib/server/pass-cookie.ts");
  assert.match(cookie, /httpOnly:\s*true/, "权益凭证必须 httpOnly");
  assert.match(cookie, /xj_pass/, "凭证 cookie 名应为 xj_pass");
  assert.match(cookie, /sameSite/, "必须声明 sameSite");
});

test("未配置签名密钥时视为无凭证，而不是放行", () => {
  const cookie = source("lib/server/pass-cookie.ts");
  // passSecret() 返回 null 时直接 return null —— 宁可让用户重新兑换，
  // 也不能因为密钥缺失就把所有人当会员
  assert.match(
    cookie,
    /if \(!secret\) return null;/,
    "缺 PASS_SECRET 时必须视为无凭证"
  );
});

test("写凭证的位置是封闭的一份名单", () => {
  // withPassCookie 的写入点必须是**已知且有限的**：
  //   · redeem          兑换后签发新权益
  //   · fortune / ask   消耗单次券后回写 n-1
  //   · entitlement     顺带清理过期凭证
  //   · chart           只读排盘的接口，把"从账户补签"的凭证写回
  //   · order/status    订单到账后就地签发权益
  //   · pass-cookie     定义处本身
  //
  // 多出来的写入点意味着多一条能凭空造权益的路径，所以这条断言必须逐个点名。
  //
  // `order/status` 凭什么在前几类之外还成立：它与 `redeem` 是**同一性质**的写入点 ——
  // 都不是"凭请求里的东西现算一份权益"，而是凭一次**服务端的原子授权**签发：
  // redeem 凭数据库原子核销掉的激活码（一码一次），order/status 凭数据库原子抢占到的
  // 订单交付权（`claim_order_delivery` 要求 `status='paid'` + 设备匹配 + 首次交付）。
  // 两者都只把这份授权翻译成 cookie，本身没有"要不要放行"的裁量权。
  const KNOWN = [
    "app/api/ask/route.ts",
    "app/api/chart/route.ts",
    "app/api/entitlement/route.ts",
    "app/api/fortune/route.ts",
    "app/api/order/status/route.ts",
    "app/api/redeem/route.ts",
    "lib/server/pass-cookie.ts",
  ].sort();

  const writers = TARGETS.filter((rel) => /withPassCookie\(/.test(source(rel))).sort();
  assert.deepEqual(writers, KNOWN, `写凭证的位置变了：${writers.join(", ")}`);
});

test("新增的写入点只能回写已验签的凭证，不得自行构造权益", () => {
  // 名单本身不足以说明安全 —— 还要确认每一处的第二个参数都是
  // "已经存在的那份权益"，而不是现场算一个 ent 出来。
  //
  // `ent` 与 `entitlement` 是同一个东西的两个本地名：前者是 `withPassCookie`
  // 定义处的形参名，后者是路由里 `ensurePassCookie(req)` 解构出来的变量名。
  // 两个都得在名单里，否则改个变量名就会误报（真发生过）。
  //
  // ## `snapshot` 为什么也在名单里（这一条与名单里其它项性质不同，必须写清理由）
  //
  // 它是 `order/status` 在**响应丢失后重签**时用的那份权益，来自订单行上的
  // `orders.granted` —— 不是现场构造的，是**恢复一份已经被正当授予过的权益**。
  //
  // 凭什么说它"已经被正当授予过"：`granted` 那一列**只可能由 `claim_order_delivery`
  // 写入**（见 supabase/orders.sql），而那个函数带三个前置条件 ——
  // `status = 'paid'`、`device_id = p_device`、`delivered_at is null`。
  // 也就是说：写进去的那份权益，必然是在"这单确实付过钱、而且是这个设备"的前提下，
  // 由服务端在抢占成功的那一刻算出来的。它躺在库里，不在用户手里。
  //
  // 为什么非要恢复不可：交付成功、cookie 也签好了，但响应在网络上丢了 ——
  // 用户手里什么都没有，而订单已标记交付（`delivered_at` 非空，不会再交付第二次）。
  // 不重签，用户就是钱付了、权益没有、重试也没用。
  //
  // 为什么不会变成"复活已用掉的券"：路由**只在请求完全不带权益 cookie 时**
  // 才用快照重签；带着 cookie 就什么都不做（cookie 可能是"刚消费过"的那一份，
  // 拿快照盖上去等于把用掉的券还回来）。判断在 `lib/order-flow.ts` 的分支 3/4，
  // 由 `tests/order-flow.test.mts` 钉住。
  //
  // 换句话说：允许的是"把一处**库里已授权的**权益搬回浏览器"，不是"在路由里造权益"。
  // 若将来有人把 `snapshot` 换成一个现算的 ent，这条守卫看不见 —— 所以上面这段
  // 就是它唯一的防线，改这块之前先读这里。
  const ALLOWED_ARGS = [
    "next",
    "ent",
    "entitlement",
    "reissued",
    "guard.reissued",
    "snapshot",
    "null",
  ];
  const PARAM_DECL = /ent:\s*Entitlement/; // 定义处（pass-cookie.ts）的参数声明

  // 调用点只允许传"已经存在的那份权益"，补编号由 `withPassCookie` 内部统一做 ——
  // 所以这里**不该**再看到调用点自己套一层 withTid()。真出现了要想想是不是
  // 有人把编号逻辑又搬回路由里了（那正是三处各写一遍、漏一处的由来）。
  const unwrapTid = (arg: string): string => {
    const m = arg.match(/^withTid\((.+)\)$/);
    return (m ? m[1] : arg).trim();
  };

  // `a ?? b` 也是允许的：两个分支各自都必须是"已存在的权益"。
  // 拆开分别判，而不是把 `x ?? y` 整串塞进白名单 —— 后者等于开了个后门，
  // `凭空造的 ent ?? null` 会被整串匹配放过去。
  const splitFallback = (arg: string): string[] =>
    arg.split("??").map((s) => unwrapTid(s.trim()));

  for (const rel of TARGETS) {
    const src = source(rel);
    if (!src.includes("withPassCookie(")) continue;
    if (PARAM_DECL.test(src)) continue; // 定义处本身

    const calls = [...src.matchAll(/withPassCookie\(\s*[^,]+,\s*([^,]+),/g)].map((m) => m[1].trim());
    assert.ok(calls.length > 0, `${rel} 未解析出调用`);
    for (const arg of calls) {
      for (const inner of splitFallback(arg)) {
        assert.ok(
          ALLOWED_ARGS.includes(inner),
          `${rel} 把 "${arg}" 写成了凭证 —— 只允许回写已存在的权益（${ALLOWED_ARGS.join(" / ")}）`
        );
      }
    }
  }
});

test("兑换必须由服务端核销，前端不得自行判定码是否有效", () => {
  // 前端唯一允许的兑换入口是 lib/redeem-client.ts，而它只做一次 POST。
  const client = source("lib/redeem-client.ts");
  assert.match(client, /fetch\("\/api\/redeem"/, "前端应把码交给 /api/redeem");
  assert.doesNotMatch(client, /localStorage/, "兑换结果不得落在 localStorage");

  // 全站只应有这一个 /api/redeem 调用点
  const callers = TARGETS.filter((rel) => /"\/api\/redeem"/.test(source(rel)));
  assert.deepEqual(callers, ["lib/redeem-client.ts"], `兑换调用点应只有一处：${callers.join(", ")}`);
});
