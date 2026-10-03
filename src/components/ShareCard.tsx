"use client";

import { useState } from "react";
import { buildShareCard, CARD_H, CARD_W, type ShareOp } from "@/lib/bazi/share-card";
import type { BaziChart as Chart } from "@/lib/bazi";

/**
 * 生成分享图。
 *
 * 布局在 `lib/bazi/share-card.ts`（纯函数，可单测），这里只负责把它画到 canvas 上。
 *
 * 用 canvas 2D 直接绘制、而不是「拼 SVG 再转图片」：SVG 经 Image 载入时会脱离当前文档，
 * 页面加载的 webfont 用不上，中文会掉回系统默认字形 —— 那跟站内的墨金调完全对不上。
 * 直接画就能用上 `Noto Serif SC`，但**必须先等 `document.fonts.ready`**，
 * 否则字体还没下载完，第一张图画出来的还是默认宋体。
 */

const SERIF = "'Noto Serif SC', serif";
const SANS = "'Noto Sans SC', sans-serif";

/** 两倍分辨率，发出去在手机上看才不糊。 */
const DPR = 2;

function paint(canvas: HTMLCanvasElement, ops: ShareOp[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  canvas.width = CARD_W * DPR;
  canvas.height = CARD_H * DPR;
  ctx.scale(DPR, DPR);
  ctx.textBaseline = "alphabetic";

  for (const op of ops) {
    switch (op.kind) {
      case "rect": {
        if (op.fill === "transparent") {
          ctx.strokeStyle = "rgba(201,150,58,0.3)";
          ctx.lineWidth = 1;
          if (op.radius) {
            ctx.beginPath();
            ctx.roundRect(op.x, op.y, op.w, op.h, op.radius);
            ctx.stroke();
          } else {
            ctx.strokeRect(op.x, op.y, op.w, op.h);
          }
          break;
        }
        ctx.fillStyle = op.fill;
        if (op.radius) {
          ctx.beginPath();
          ctx.roundRect(op.x, op.y, op.w, op.h, op.radius);
          ctx.fill();
        } else {
          ctx.fillRect(op.x, op.y, op.w, op.h);
        }
        break;
      }
      case "line": {
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
        break;
      }
      case "circle": {
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        if (op.fill && op.fill !== "transparent") {
          ctx.fillStyle = op.fill;
          ctx.fill();
        }
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.strokeWidth ?? 1;
          ctx.stroke();
        }
        break;
      }
      case "text": {
        const face = op.face === "sans" ? SANS : SERIF;
        ctx.font = `${op.weight === "bold" ? "700" : "400"} ${op.size}px ${face}`;
        ctx.fillStyle = op.color;
        ctx.textAlign = op.align;
        // letterSpacing 的支持面不广，不支持时静默退化为正常字距，不影响可读性
        if (op.tracking && "letterSpacing" in ctx) {
          (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
            `${op.tracking}px`;
        }
        ctx.fillText(op.text, op.x, op.y);
        if (op.tracking && "letterSpacing" in ctx) {
          (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
        }
        break;
      }
    }
  }
}

export default function ShareCard({ chart }: { chart: Chart }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 必须等字体就绪 —— 否则第一次画出来的是默认宋体，跟站内风格对不上
      if (document.fonts?.ready) await document.fonts.ready;

      const canvas = document.createElement("canvas");
      paint(canvas, buildShareCard(chart));

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) throw new Error("生成失败");

      const filename = `玄机八字-${chart.solarDate.replace(/\s/g, "")}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      // 手机上优先走系统分享（能直接发微信），桌面端退回下载
      const nav = navigator as Navigator & {
        canShare?: (d: { files: File[] }) => boolean;
        share?: (d: { files: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: "玄机 · 八字命理" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }

      setState("done");
      setTimeout(() => setState("idle"), 2200);
    } catch (err) {
      // 用户主动取消系统分享会走到这里，不该报成失败
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted) {
        console.error("生成分享图失败:", err);
        setState("fail");
        setTimeout(() => setState("idle"), 2600);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={handleClick} disabled={busy} className="btn-mystic disabled:opacity-50">
      {busy ? "正在出图…" : state === "done" ? "✓ 已生成" : state === "fail" ? "出图失败，请重试" : "生成分享图"}
    </button>
  );
}
