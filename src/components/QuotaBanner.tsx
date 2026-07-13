"use client";

import { getFreeQuota, isMember, getReferralCode, getReferralCount } from "@/lib/store";
import { useState, useEffect } from "react";
import Link from "next/link";

export default function QuotaBanner() {
  const [quota, setQuota] = useState(3);
  const [member, setMember] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refCount, setRefCount] = useState(0);

  useEffect(() => {
    setQuota(getFreeQuota());
    setMember(isMember());
    setRefCount(getReferralCount());
  }, []);

  const handleCopyRef = () => {
    const code = getReferralCode();
    const link = `${window.location.origin}?ref=${code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (member) {
    return (
      <div className="glass rounded-lg px-4 py-2 flex items-center justify-between">
        <span className="text-gold-300 text-sm">👑 会员专享 · 无限次解读</span>
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
          /3
        </span>
        <span className="text-paper-100/20 text-xs">每日重置</span>
      </div>

      {quota === 0 && (
        <div className="space-y-2">
          <p className="text-vermillion-400/70 text-xs mb-2">
            今日免费次数已用完，开通会员或邀请好友获取更多机会
          </p>
          <div className="flex gap-2">
            <Link href="/member" className="btn-primary !py-1.5 !px-4 !text-xs flex-1 text-center">
              开通会员 ¥28.8
            </Link>
            <button
              onClick={handleCopyRef}
              className="btn-mystic !py-1.5 !px-4 !text-xs flex-1"
            >
              {copied ? "✓ 已复制" : "邀请好友 +1次"}
            </button>
          </div>
          {refCount > 0 && (
            <p className="text-paper-100/20 text-xs text-center">
              已邀请 {refCount} 人 · 每邀3人送1天会员
            </p>
          )}
        </div>
      )}
    </div>
  );
}
