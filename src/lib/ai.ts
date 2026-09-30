import OpenAI from "openai";
import { buildBaziChart, chartToPrompt, type BaziChart } from "./bazi";
import { drawTarot, tarotToPrompt, type TarotDraw } from "./tarot";
import {
  castDailyHexagram,
  hexagramToPrompt,
  parseDailyReading,
  type DailyReading,
  type Hexagram,
} from "./daily";

// 不再用 "sk-placeholder" 兜底：缺 key 时应当明确报"未配置"，
// 而不是拿一个假 key 去请求、最后以 401 的形式糊弄用户。
let _client: OpenAI | null = null;
function client(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 DEEPSEEK_API_KEY 环境变量");
  }
  if (!_client) {
    _client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" });
  }
  return _client;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  daily: `你是一位精通易经与五行的命理师，风格儒雅但不故弄玄虚。

今日的卦**已由程序起定**，你不必也不得另行起卦或改动卦名。请依这一卦，结合用户填写的当下心情与关注方向，给出一份可读的今日指引。

**必须严格按下面的格式输出**，每个方括号标记独占一行，不要增删标记，不要使用 Markdown 井号：

【卦象解读】
（一段话说明今日气机，80 字内）

【宜】三件事，用顿号分隔
【忌】三件事，用顿号分隔
【幸运指南】颜色：X｜数字：N｜方位：Y

【大师寄语】
（一句话鼓励或提醒）

要求：
- 【宜】【忌】各恰好三项，每项 2-6 个字（如"签约""动土""远行"），切忌写成长句
- 方位只能从这八个里取：东、东南、南、西南、西、西北、北、东北
- 颜色用单字或双字（青、赤、黄、白、黑、紫、金、橙、蓝）
- 不做健康、疾病、生死的断言，不推荐投资标的
- 开头单独一行加上"命理之说，信则有不信则无，仅供参考娱乐"`,

  bazi: `你是一位精通子平八字与五行生克的命理师。你的风格：以五行生克制化说理，旁征博引，不故弄玄虚。

用户会提供一份**已经排好的命盘**——四柱、五行分布、大运均由程序精确推算，你不必也不得自行推算或改动其中任何数字。你的职责只有一件事：解读。

请按以下结构输出：
1. 【命局总评】综合格局与气势（120 字内）
2. 【日主强弱】日主在月令与全局中的强弱，喜用与忌讳
3. 【事业财运】适合的方向与聚财方式
4. 【感情婚姻】感情模式与相处要点
5. 【大运走势】结合已给出的大运，说明当前所处阶段与下一步转折
6. 【大师寄语】一条可落地的建议

要求：
- 不要复述排盘数据（盘已单独呈现给用户），直接给解读
- 术语要解释，让不懂八字的人也能读懂
- 不做健康、疾病、生死的断言，不推荐投资标的
- 开头加上"命理之说，信则有不信则无，仅供参考娱乐"`,

  love: `你是一位精通姻缘命理的月老传人，擅长合婚算命。你的风格：温暖细腻，既有命理依据又充满人情味。

用户会提供两人的出生信息。请生成以下内容：
1. 【命盘匹配】分析两人八字五行匹配度
2. 【性格互补】两人性格的互补与冲突分析
3. 【缘分深浅】前世今生的缘分解读
4. 【相处建议】给双方的实用相处建议（3条）
5. 【未来发展】关系走向展望
6. 【月老寄语】对这段关系的祝福与提醒

请用温暖但客观的语气，既不过分吹捧也不过分唱衰。`,

  tarot: `你是一位精通塔罗的占卜师，能把西方象征体系讲得让人听得懂，不故弄玄虚。

三张牌**已由用户抽定**（过去 / 现在 / 未来），正逆位已固定，你不必也不得另行抽牌或改动。你的职责是把这三张牌与用户所问之事连起来。

请按以下结构输出：
1. 【过去之牌】这张牌如何解释了问题的根源
2. 【现在之牌】当下处境的真实面貌
3. 【未来之牌】若维持现状，趋势会走向何处
4. 【综合解读】把三张牌串成一条线（150 字内）
5. 【塔罗启示】一条具体可执行的建议

要求：
- 不要复述牌名与正逆位（牌面已单独呈现给用户），直接讲它对用户意味着什么
- 逆位不等于凶，要说清它改变了这张牌的哪一层含义
- 不做健康、疾病、生死的断言，不推荐投资标的`,

  oracle: `你是一位德高望重的得道高僧/道长，在寺庙中为人解签已有数十年。你的风格：慈悲为怀，以典故说理，深入浅出。

请为用户模拟一次灵签求签，生成以下内容：
1. 【签号】生成一支灵签编号（如：第×签 上上签/中平签/下下签等）
2. 【签文】四句七言诗，古典雅致
3. 【典故】引用一个历史典故或佛教/道教故事来解签
4. 【解曰】用白话文解释签文的含义（100字内）
5. 【人生启示】这个签给当代人的启示
6. 【大师开示】一句佛语或道家智慧，配合签文给用户指引

签文要写得有古韵，典故要真实，解签要有深度。`,
};

export interface FortuneResult {
  success: boolean;
  content?: string;
  error?: string;
  /** 八字模式随结果附带排好的命盘，交由前端单独呈现 */
  chart?: BaziChart;
  /** 塔罗模式随结果附带抽定的三张牌 */
  tarot?: TarotDraw;
  /** 运势模式附带起好的卦与解析出的宜忌 —— 解析失败时为 undefined，界面退回只展示原文 */
  daily?: DailyReading;
}

export async function getFortune(
  mode: string,
  userInput: Record<string, string>
): Promise<FortuneResult> {
  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.daily;

  let userMessage = "";
  let chart: BaziChart | undefined;
  let tarot: TarotDraw | undefined;
  let dailyHex: Hexagram | undefined;

  switch (mode) {
    case "daily": {
      // 起卦同样是确定性的，不让模型"编一个卦名" —— 同一天全站同卦
      dailyHex = castDailyHexagram();
      userMessage =
        `今日卦象已由程序起定，请依此解读，不要另行起卦：\n\n${hexagramToPrompt(dailyHex)}\n\n` +
        `用户当下心情：${userInput.feeling || "未说明"}\n用户关注方向：${userInput.focus || "未说明"}`;
      break;
    }
    case "bazi": {
      // 排盘是确定性计算，交给模型等于让它编；这里先算准，再让它只做解读
      const built = buildBaziChart({
        birthDate: userInput.birthDate ?? "",
        birthTime: userInput.birthTime ?? "",
        gender: userInput.gender ?? "",
      });
      if (!built) {
        return { success: false, error: "出生信息不完整，无法排盘，请返回检查日期与时辰" };
      }
      chart = built;
      userMessage = `以下命盘已由程序精确排定，请直接解读，不要自行推算或改动：\n\n${chartToPrompt(built)}`;
      break;
    }
    case "love":
      userMessage = `请分析以下两人的姻缘：
甲方：${userInput.person1 || "未提供"}
乙方：${userInput.person2 || "未提供"}`;
      break;
    case "tarot": {
      // 牌由代码抽，不让模型"挑" —— 否则它倾向挑好解的牌，且每次给的牌阵高度相似
      const drawn = drawTarot();
      tarot = drawn;
      userMessage = `${tarotToPrompt(drawn)}\n\n用户心中所想的问题：${userInput.question || "未说明"}`;
      break;
    }
    case "oracle":
      userMessage = `用户当前的心事或困惑：${userInput.concern || "未说明"}
请为用户抽取灵签并解签。`;
      break;
    default:
      userMessage = "请为我生成运势解读。";
  }

  try {
    const response = await client().chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.9,
      max_tokens: 2000,
    });

    const content = response.choices[0].message.content ?? undefined;

    // 宜忌的解析是尽力而为：模型没按格式走就返回 undefined，界面退回只展示原文，不会白屏
    const daily =
      dailyHex && content ? (parseDailyReading(content, dailyHex) ?? undefined) : undefined;

    return { success: true, content, chart, tarot, daily };
  } catch (error) {
    console.error("AI API error:", error);

    // 光说"天机不可泄露"，用户重试一百次也没用。先说清楚是什么问题。
    const detail = error instanceof Error ? error.message : "";
    if (detail.includes("DEEPSEEK_API_KEY")) {
      return { success: false, error: "解读服务尚未配置完成，请稍后再来" };
    }
    return { success: false, error: "解读生成失败，请稍后重试" };
  }
}
