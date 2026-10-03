"use client";

import { useEffect, useState } from "react";
import type { EntitlementSummary } from "@/lib/entitlement";

/**
 * 前端权益状态。
 *
 * 权益的真相**只在服务端** —— 这里存的是一份缓存，用来决定界面显示什么。
 * 它不参与任何放行判定：把会员标记写进 localStorage 不会让你变成会员，
 * 只是让页面显示成会员而已（然后请求照样 403）。
 *
 * 用模块级的订阅而不是每处各 fetch 一次，是因为 Header（会员徽章）、
 * FortuneForm（会员免费标签）、member 页（是否已开通）都要读它。
 * 各拉各的迟早会显示不一致：兑完码 Header 变了、表单还写着要付款。
 */

type Listener = () => void;

const EMPTY: EntitlementSummary = { member: false, passes: [] };

let cache: EntitlementSummary = EMPTY;
let loaded = false;
let inflight: Promise<EntitlementSummary> | null = null;
const listeners = new Set<Listener>();

/** 服务端渲染与首帧一律按"无权益"渲染，避免 hydration 前后两套 DOM。 */
export function getEntitlement(): EntitlementSummary {
  return cache;
}

export function isEntitlementLoaded(): boolean {
  return loaded;
}

export function subscribeEntitlement(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function publish(next: EntitlementSummary) {
  cache = next;
  loaded = true;
  for (const fn of listeners) fn();
}

/**
 * 拉取一次权益。并发调用会合并成同一个请求 ——
 * 首屏 Header 与表单同时挂载时不该打两次。
 */
export function refreshEntitlement(): Promise<EntitlementSummary> {
  if (inflight) return inflight;

  inflight = fetch("/api/entitlement", { method: "GET", cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const summary: EntitlementSummary =
        data && data.entitlement ? (data.entitlement as EntitlementSummary) : EMPTY;
      publish(summary);
      return summary;
    })
    .catch(() => {
      // 网络失败不该把界面卡在"加载中"，也不该谎称是会员
      publish(EMPTY);
      return EMPTY;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** 兑换成功后由调用方直接写入，省掉一次往返。 */
export function setEntitlement(summary: EntitlementSummary) {
  publish(summary);
}

/**
 * 组件里订阅权益。首挂载时自动拉一次（全局只真拉一次）。
 */
export function useEntitlement() {
  const [summary, setSummary] = useState<EntitlementSummary>(cache);

  useEffect(() => {
    const sync = () => setSummary(getEntitlement());
    const unsubscribe = subscribeEntitlement(sync);
    void refreshEntitlement().then(sync);
    return () => {
      unsubscribe();
    };
  }, []);

  return summary;
}

/** 把 unix 秒格式化成「2026年3月1日」。 */
export function formatExpiry(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
