"use client";

import { refreshEntitlement } from "@/lib/entitlements";

/**
 * 兑换激活码。成功返回 null，失败返回给用户看的文案。
 *
 * 放在这里而不是某个组件里，是因为排盘表单与会员页都要用 ——
 * 让会员页去 import 一个组件文件只为拿一个函数，会把两个页面的
 * 加载边界绑在一起。
 *
 * 注意它只负责"去兑换"，不管兑换成功之后界面该做什么：
 * 那件事两个页面的答案不同（一个继续排盘、一个留在本页看权益）。
 */
export async function redeemActivationCode(code: string): Promise<string | null> {
  try {
    const res = await fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => null);

    if (res.ok && data?.success) {
      // 服务端已把新凭证写进 cookie，这里同步前端缓存
      await refreshEntitlement();
      return null;
    }
    return data?.error ?? "兑换失败，请稍后重试";
  } catch {
    return "网络连接失败，请稍后重试";
  }
}
