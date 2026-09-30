import OpenAI from "openai";
import { buildBaziChart, chartToPrompt, type BaziChart } from "./bazi";

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
  daily: `你是一位精通中国传统命理的玄学大师，拥有三十年的算命经验。你的风格是：儒雅深邃，引经据典，既有易理根基又通俗易懂。

请为用户生成今日运势解读，必须包含以下结构：
1. 【今日卦象】给出一个今日对应的卦名，并简要解释
2. 【整体运势】用一段话概述今日运势吉凶（50字以内）
3. 【宜】列出3件今日适宜做的事
4. 【忌】列出3件今日不宜做的事
5. 【幸运指南】幸运颜色、幸运数字、幸运方位
6. 【大师寄语】一句人生感悟或古语，给用户鼓励或提醒

请确保回复有仪式感，使用一些恰当的易经术语但不要晦涩。`,

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

  tarot: `你是一位精通塔罗牌的占卜师，将西方塔罗智慧与东方哲学融合。你的风格：神秘而富有洞察力。

用户心中默想一个问题后进行抽牌。请模拟三张牌的塔罗占卜：
1. 【过去之牌】代表问题的根源或过去的影响
2. 【现在之牌】代表当前状况
3. 【未来之牌】代表发展趋势
4. 【综合解读】将三张牌串联起来，给出一段综合性的解读（150字内）
5. 【塔罗启示】给用户一个行动建议

请选择经典的塔罗牌进行解读，每张牌说明牌名和正逆位。`,

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
}

export async function getFortune(
  mode: string,
  userInput: Record<string, string>
): Promise<FortuneResult> {
  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.daily;

  let userMessage = "";
  let chart: BaziChart | undefined;

  switch (mode) {
    case "daily":
      userMessage = "请为我生成今日运势解读。";
      break;
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
    case "tarot":
      userMessage = `用户心中所想的问题：${userInput.question || "未说明"}
请为用户进行三张牌的塔罗占卜。`;
      break;
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

    return {
      success: true,
      content: response.choices[0].message.content ?? undefined,
      chart,
    };
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
