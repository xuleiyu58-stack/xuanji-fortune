"use client";

import { getFreeQuota, isMember } from "@/lib/store";
import { MEMBER_PLANS, formatPrice, FREE_DAILY_QUOTA } from "@/lib/pricing";
import { useState, useEffect } from "react";
import Link from "next/link";

/**
 * `remaining` 由服务端在每次响应里回传 —— 限流的真实依据在服务端，
 * 本地计数只是个估算。两者不一致时以服务端为准，否则会出现
 * "界面说还剩 3 次、请求却被拒"的矛盾。
 */
export default function QuotaBanner({ remaining }: { remaining?: number }) {
  const [localQuota, setLocalQuota] = useState(FREE_DAILY_QUOTA);
  const [member, setMember] = useState(false);

  useEffect(() => {
    setLocalQuota(getFreeQuota());
    setMember(isMember());
  }, []);

  const quota = typeof remaining === "number" ? remaining : localQuota;

  if (member) {
    return (
      <div className="glass rounded-lg px-4 py-2 flex items-center justify-between">
        <span className="text-gold-300 text-sm">会员专享 · 无限次解读</span>
        <Link href="/member" className="text-gold-400/60 text-xs hover:text-gold-300 transition-colors">
          管理 →
        </Link>
      </div>
    );
  }

  return (
    <div className="glass rounded-lg px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-paper-100/60 text-sm">
          今日免费次数：
          <span className={quota > 0 ? "text-gold-300" : "text-vermillion-400"}>
            {quota}
          </span>
          /{FREE_DAILY_QUOTA}
        </span>
        <span className="text-paper-100/20 text-xs">每日重置</span>
      </div>

      {quota === 0 && (
        <div className="space-y-2">
          <p className="text-vermillion-400/70 text-xs mb-2">
            今日免费次数已用完，开通会员可无限次解读
          </p>
          <div className="flex gap-2">
            <Link href="/member" className="btn-primary !py-1.5 !px-4 !text-xs flex-1 text-center">
              开通会员 ¥{formatPrice(MEMBER_PLANS[0].price)}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
