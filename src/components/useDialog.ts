"use client";

import { useEffect, useRef } from "react";

/**
 * 弹层/抽屉的键盘与焦点行为。
 *
 * 抽出来是因为站内有两个覆盖层（支付弹窗、历史抽屉），而它们此前各自
 * 都缺同一套东西：Esc 关不掉、Tab 会跑到背后的页面上去、关闭后焦点丢在
 * body 上。`aria-modal="true"` 一旦写上就是在向读屏软件承诺"焦点被锁在里面"，
 * 没有 trap 的 aria-modal 是一句空话 —— 比不写更糟，因为它会让辅助技术
 * 主动忽略背后的内容，而键盘其实还能走进去。
 *
 * 返回的 ref 挂到弹层最外层的可聚焦容器上。
 */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // 打开前的焦点位置，关闭后还回去
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] => {
      const root = ref.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    };

    // 打开后把焦点移进来，否则 Tab 的起点还在背后的页面上
    const first = focusables()[0];
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;

      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;

      // 首尾相接，Tab 不会漏到背后去
      if (e.shiftKey && (active === firstEl || !ref.current?.contains(active))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    // 弹层打开时锁住背后页面的滚动
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}
