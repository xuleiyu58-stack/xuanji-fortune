import OpenAI from "openai";
import { buildBaziChart, chartToPrompt, validateLunarDate, type BaziChart } from "./bazi";

// 不再用 "sk-placeholder" 兜底：缺 key 时应当明确报"未配置"，
// 而不是拿一个假 key 去请求、最后以 401 的形式糊弄用户。
let _client: OpenAI | null = null;
function client(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 DEEPSEEK_API_KEY 环境变量");
  }
  if (!_client) {
    _client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com/v1",
      // SDK 默认超时是 10 分钟、失败重试 2 次 —— 上游卡住时一次请求能挂 30 分钟，
      // 而用户的浏览器早就放弃了。解读是交互式操作，等不起，宁可早点报错让他重试。
      timeout: 60_000,
      maxRetries: 1,
    });
  }
  return _client;
}

/**
 * 免责声明在 `lib/disclaimer.ts` 里 —— 客户端也要用，
 * 留在这个模块会让 `openai` SDK 被打进浏览器包。
 */
export { DISCLAIMER } from "./disclaimer";

const SYSTEM_PROMPT = `你是一位精通子平八字与五行生克的命理师。你的风格：以五行生克制化说理，旁征博引，不故弄玄虚。

用户会提供一份**已经排好的命盘**——四柱、藏干、十神、神煞、五行分布、大运、格局、用神均由程序精确推算，你不必也不得自行推算或改动其中任何数字。你的职责只有一件事：解读。

**输出格式必须严格遵守。** 每一节都写成下面这样的三段，三段一个都不能少，也不要多加别的行：

【小节名】
结论：一句话说清这一节的核心判断
依据：盘上哪一柱、哪个十神、哪种五行关系支撑了这个判断
展开：两三句白话，把道理讲给不懂八字的人听

要写的小节，标题必须原样使用、顺序不变：
【命局总评】
【日主强弱】
【性格禀赋】
【事业财运】
【感情婚姻】
【大运走势】
【大师寄语】

要求：
- **「依据」是这一节最重要的部分。** 必须点到具体位置，例如「月支酉藏辛，辛为日主甲木之正官，且透出年干」。写不出依据的判断，就不要写。
- 不要复述整份排盘数据（盘已单独呈现给用户），只引用支撑你判断的那一两处。
- 术语第一次出现时要解释，让不懂八字的人也能读懂。
- 用户若指定了关注方向，该方向那一节要写得更细。
- 不做健康、疾病、生死的断言，不推荐投资标的，不预测具体事件。
- 第一行单独写「命理之说，信则有不信则无，仅供参考娱乐」，然后直接开始【命局总评】，不要在它前后加别的说明。`;

const FOCUS_LABEL: Record<string, string> = {
  综合: "全面分析",
  事业: "事业发展",
  财运: "财富运势",
  感情: "感情婚姻",
  健康: "健康运势",
};

export interface BaziResult {
  success: boolean;
  content?: string;
  error?: string;
  /**
   * 排好的命盘。
   *
   * **失败时也要带上它。** 排盘是确定性计算，不花一分钱、也不依赖模型 ——
   * 没有理由因为解读服务出问题就让用户连盘都看不到。这也正是
   * 「免费排盘 + 付费解读」这条产品线的分界：盘是白给的，解才是收费的。
   */
  chart?: BaziChart;
}

export async function readBazi(userInput: Record<string, string>): Promise<BaziResult> {
  const calendar = userInput.calendar === "lunar" ? "lunar" : "solar";
  const lunarLeap = userInput.lunarLeap === "true";

  // 农历日期先单独校验一遍，好给出具体原因。
  // 直接交给排盘的话，不存在的闰月与超出的日数都只会得到一句"信息不完整"，
  // 用户根本不知道错在哪 —— 而这是他填的生日，最该说清楚。
  if (calendar === "lunar") {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((userInput.birthDate ?? "").trim());
    if (m) {
      const reason = validateLunarDate(
        Number.parseInt(m[1], 10),
        Number.parseInt(m[2], 10),
        Number.parseInt(m[3], 10),
        lunarLeap
      );
      if (reason) return { success: false, error: reason };
    }
  }

  // 排盘是确定性计算，交给模型等于让它编；这里先算准，再让它只做解读
  const chart = buildBaziChart({
    birthDate: userInput.birthDate ?? "",
    birthTime: userInput.birthTime ?? "",
    gender: userInput.gender ?? "",
    calendar,
    lunarLeap,
    // 出生地留空就不做真太阳时校正 —— 见 bazi/solar-time.ts
    province: userInput.province || undefined,
    city: userInput.city || undefined,
  });

  if (!chart) {
    return { success: false, error: "出生信息不完整，无法排盘，请返回检查日期与时辰" };
  }

  const focus = FOCUS_LABEL[userInput.question ?? ""] ?? "";
  const userMessage =
    `以下命盘已由程序精确排定，请直接解读，不要自行推算或改动：\n\n${chartToPrompt(chart)}` +
    (focus ? `\n\n用户最关心的方向：${focus}` : "");

  try {
    const response = await client().chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.9,
      max_tokens: 2200,
    });

    const choice = response.choices[0];
    const content = choice?.message?.content?.trim();

    // 空回复必须当成失败。此前返回 success:true + content:undefined，
    // 前端 setResult(undefined) 之后什么都不显示、也不报错 ——
    // 刚兑完码的用户看到的是一个静默复位的表单，比报错还费解。
    if (!content) {
      console.error("AI 返回空内容:", JSON.stringify(choice?.finish_reason));
      return { success: false, error: "解读生成失败，请稍后重试", chart };
    }

    // 被 max_tokens 截断时明说：用户宁可知道"只出来一半"，
    // 也不该把断在半句的解读当成完整的。
    if (choice?.finish_reason === "length") {
      return {
        success: true,
        content: `${content}\n\n（本篇解读因长度上限在此收束，若需展开可针对具体一节追问。）`,
        chart,
      };
    }

    return { success: true, content, chart };
  } catch (error) {
    console.error("AI API error:", error);

    // 光说"天机不可泄露"，用户重试一百次也没用。先说清楚是什么问题。
    // 盘已经排好了，一并带回去 —— 解读失败不该让人连盘都看不见。
    const detail = error instanceof Error ? error.message : "";
    if (detail.includes("DEEPSEEK_API_KEY")) {
      return { success: false, error: "解读服务尚未配置完成，请稍后再来", chart };
    }
    return { success: false, error: "解读生成失败，请稍后重试", chart };
  }
}

const ASK_PROMPT = `你是一位精通子平八字与五行生克的命理师。用户会提供一份**已由程序排好的命盘**，并针对它继续提问。

要求：
- 直接回答问题本身，不要复述已经讲过的整段内容
- 用到的每一个判断都要点明盘上的依据（哪一柱、哪个十神、哪种五行关系）
- 术语第一次出现时要解释，让不懂八字的人也能读懂
- 不做健康、疾病、生死的断言，不推荐投资标的，不预测具体事件
- 控制在 250 字以内，分两到三段即可。不要写小标题，不要用【】`;

export interface AskResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * 追问。
 *
 * 与首次解读共用同一份排好的盘 —— 追问不重新排盘，也不允许模型自行推算。
 * `previous` 是首轮解读的节选，给它提供上下文，但刻意截断：
 * 全文喂回去既贵又会让模型倾向于复述。
 */
export async function askFollowUp(
  chart: BaziChart,
  question: string,
  previous?: string
): Promise<AskResult> {
  const context = previous
    ? `\n\n（此前你已经给出的解读节选，供衔接，不必重复：\n${previous.slice(0, 600)}）`
    : "";

  const userMessage =
    `以下命盘已由程序精确排定，请直接据此回答，不要自行推算或改动：\n\n${chartToPrompt(chart)}` +
    context +
    `\n\n用户追问：${question}`;

  try {
    const response = await client().chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: ASK_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.8,
      max_tokens: 900,
    });

    const choice = response.choices[0];
    const content = choice?.message?.content?.trim();
    // 与首次解读同口径：空回复是失败，不是"成功的空回答"
    if (!content) {
      console.error("AI 追问返回空内容:", JSON.stringify(choice?.finish_reason));
      return { success: false, error: "回答生成失败，请稍后重试" };
    }
    return { success: true, content };
  } catch (error) {
    console.error("AI ask error:", error);
    const detail = error instanceof Error ? error.message : "";
    if (detail.includes("DEEPSEEK_API_KEY")) {
      return { success: false, error: "解读服务尚未配置完成，请稍后再来" };
    }
    return { success: false, error: "回答生成失败，请稍后重试" };
  }
}
