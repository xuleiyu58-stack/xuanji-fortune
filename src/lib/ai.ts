import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || "sk-placeholder",
  baseURL: "https://api.deepseek.com/v1",
});

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

  bazi: `你是一位精通八字命理的玄学大师，擅长紫微斗数和子平八字。你的风格：旁征博引，用五行生克制化解说命局。

用户会提供出生年月日时信息。请根据八字排盘原理，生成以下内容：
1. 【八字排盘】列出年柱、月柱、日柱、时柱的天干地支
2. 【五行分析】分析日主五行强弱，喜神忌神
3. 【命局总评】综合评价命局格局（100字内）
4. 【事业财运】事业方向和财运分析
5. 【感情婚姻】感情运势分析
6. 【大运走势】当前所处大运及未来趋势
7. 【大师寄语】总结性的人生建议

注意：开头加上免责声明"命理之说，信则有不信则无，仅供参考娱乐"。`,

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

export async function getFortune(
  mode: string,
  userInput: Record<string, string>
) {
  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.daily;

  let userMessage = "";
  switch (mode) {
    case "daily":
      userMessage = "请为我生成今日运势解读。";
      break;
    case "bazi":
      userMessage = `请根据以下信息排八字命盘：
出生日期：${userInput.birthDate || "未提供"}
出生时间：${userInput.birthTime || "未知"}
性别：${userInput.gender || "未知"}`;
      break;
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
    const response = await client.chat.completions.create({
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
      content: response.choices[0].message.content,
    };
  } catch (error) {
    console.error("AI API error:", error);
    return {
      success: false,
      error: "天机不可泄露，请稍后再试",
    };
  }
}
