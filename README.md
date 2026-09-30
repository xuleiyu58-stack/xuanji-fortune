# 玄机 · AI 命理解读

Next.js 14 + TypeScript + Tailwind。解读由 DeepSeek 提供，账号与用量存 Supabase。

## 核心设计原则

**能算的归代码，能解的归模型。**

八字排盘、塔罗抽牌、每日起卦、灵签摇签、合婚评分 —— 这些是确定性计算或随机抽样，
全部由代码完成；模型只负责解读已经算好的结果。

这不是洁癖。让模型"心算"排盘，日柱基本必错；让它"抽"牌，它会按叙事需要挑吉签。
收费产品经不起这种错误 —— 而且错了看不出来，卦名照样像真的。

对应模块：`src/lib/bazi.ts`、`tarot.ts`、`daily.ts`、`oracle.ts`、`love.ts`。

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入真实值
npm run dev
```

打开 http://localhost:3000

未配 Supabase 时也能跑：限流会退化为进程内内存计数并打印警告，**仅供本地开发**。

## 环境变量

见 `.env.example`。`DEEPSEEK_API_KEY` 与 `SUPABASE_SERVICE_ROLE_KEY` 仅服务端使用。

## 数据库初始化

在 Supabase 控制台的 SQL Editor 里执行 `supabase/schema.sql`。它会建 `usage` 表、
开启 RLS、并创建原子自增函数 `bump_usage`。

## 测试

```bash
npm test          # node --test，直接跑 TypeScript
npx tsc --noEmit
```

测试里有若干**外部可交叉验证的锚点**，改算法前先看它们：

| 锚点 | 位置 |
|---|---|
| 2005-02-09 = 乙酉年正月初一 / 甲子日 / 属鸡 | `tests/bazi.test.mts` |
| 2005-07-18 = 癸卯日（距锚点 159 日） | `tests/bazi.test.mts` |
| 水雷屯(3)、山水蒙(4)、地天泰(11)、天地否(12)、水火既济(63)、火水未济(64) | `tests/daily.test.mts` |
| 乾三连 / 坤六断 / 震仰盂 / 艮覆碗等取象歌 | `tests/daily.test.mts` |

`tests/no-hardcoded-prices.test.mts` 是回归守卫：全站价格只能来自 `src/lib/pricing.ts`，
免费判定只能来自 `isFreeMode`。它会先剥掉注释与 SVG 路径数据再扫，避免误报。

## 部署到 Vercel

1. 推到 GitHub
2. Vercel 导入该仓库
3. Settings → Environment Variables 填入 `.env.example` 里全部五个变量
4. 在 Supabase 执行 `supabase/schema.sql`
5. 部署

**上线前务必：**

- 在 DeepSeek 控制台另设消费上限 —— 代码里的熔断防滥用，控制台的上限才防得住代码出错
- 确认 `SUPABASE_SERVICE_ROLE_KEY` 没被加 `NEXT_PUBLIC_` 前缀
- 收款码放到 `public/qrcode.jpg`（缺失时支付弹窗显示"暂未就绪"，不会裂图）

## 已知待办

- 用户账号体系与订单上云（现为浏览器本地，会员开通需手动改数据库）
- 法律页：用户协议、隐私政策、免责声明
- 管理后台（订单确认目前靠手动改库）
