/**
 * 解读/追问成功后，该把哪一份权益凭证写回响应。
 *
 * 单独一个纯函数，是因为两个原因：
 *
 *  1. **两个路由必须用同一套判断。** 它们此前各写了一遍 if/else，结果
 *     /api/ask 在"消耗单次券"的分支里忽略了补签的凭证 —— 用户清了 cookie
 *     之后每问一次都要多查一次库。功能没错，但那个不一致迟早会变成真 bug。
 *
 *  2. **这里有一个容易漏的情况**：凭证可能是**从账户侧补签**的（用户清了
 *     cookie 但账号还在）。此时请求里没有 cookie，补签的那份才是有权益的那份，
 *     扣减必须扣在它上面。
 *
 * 返回 null 表示整份凭证已空，调用方应当**清除** cookie 而不是写个空壳。
 */
import { consumePass, type Entitlement } from "./entitlement.ts";

export interface WriteBackInput {
  /** 放行前请求携带的权益（清了 cookie 时为 null） */
  entitlement: Entitlement | null;
  /** 从账户侧补签的权益（未补签时为 null） */
  reissued: Entitlement | null;
  /** 放行结论里的消耗方式 */
  consume: "none" | "quota" | { mode: string; passIndex: number; remaining: number };
  nowSec: number;
}

export function passWriteBack(input: WriteBackInput): Entitlement | null {
  const { entitlement, reissued, consume, nowSec } = input;

  if (typeof consume === "object") {
    // 消耗了某张券：在"当前有效的那一份"上扣一次。
    // 补签时 entitlement 已经是补签的那份（见 ensurePassCookie），
    // 但这里仍然兜一层，避免调用方顺序变化时静默丢权益。
    const base = entitlement ?? reissued;
    return base ? consumePass(base, consume.passIndex, nowSec) : null;
  }

  // 没有消耗：只处理"补签"这一种情况，把新凭证写回去，免得下次请求再查一次库。
  // 会员（consume === "none"）走的就是这条路。
  return reissued ?? null;
}
