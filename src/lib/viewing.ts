"use client";

import { useEffect, useState } from "react";
import type { Reading } from "@/lib/store";

/**
 * 「正在查看的历史记录」这一份共享状态。
 *
 * 为什么需要一个模块级的存储：查看动作发生在**页头**的历史抽屉里，
 * 而要显示解读的是**首页**的排盘区 —— 两者是兄弟节点，没有共同的父级
 * 可以传 state（首页是客户端组件，Header 也是各自独立渲染的）。
 *
 * 此前这里是一个空函数 `onSelect={() => {}}`：历史条目能点、有鼠标手型、
 * 键盘也聚焦得到，但点下去什么都不会发生。那比不能点更糟 ——
 * 用户会以为是自己点错了。
 *
 * 与 lib/entitlements.ts、auth-client.ts 用同一套模式（模块级订阅）。
 */

type Listener = () => void;

let current: Reading | null = null;
const listeners = new Set<Listener>();

function publish(next: Reading | null) {
  current = next;
  for (const fn of listeners) fn();
}

export function getViewingReading(): Reading | null {
  return current;
}

export function subscribeViewing(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 打开一条历史记录。首页的排盘区会据此把它渲染出来。 */
export function viewReading(reading: Reading): void {
  publish(reading);
}

/** 关掉历史回看，回到正常的「填写出生信息」状态。 */
export function clearViewingReading(): void {
  publish(null);
}

export function useViewingReading() {
  const [reading, setReading] = useState<Reading | null>(current);

  useEffect(() => {
    const sync = () => setReading(getViewingReading());
    const unsubscribe = subscribeViewing(sync);
    sync();
    return unsubscribe;
  }, []);

  return reading;
}
