"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
}

/**
 * 背景星尘。
 *
 * 两层降级，各自针对不同的人：
 *
 *  1. **prefers-reduced-motion** —— framer-motion 默认不看这个媒体查询，
 *     40 个 repeat: Infinity 的动画会一直挂在合成器上。对前庭功能敏感的人
 *     来说，这不是"更好看"，是会引发不适。开启这个偏好时只画静态的点。
 *  2. 动画本身只影响装饰，不承载任何信息，所以关掉它不影响可用性。
 *
 * 注意 globals.css 里的 prefers-reduced-motion 规则只管 CSS 动画，
 * 管不到 framer-motion 用 JS 驱动的这一层 —— 两边都要处理。
 */
export default function Particles() {
  const [particles, setParticles] = useState<Particle[]>([]);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const p: Particle[] = [];
    for (let i = 0; i < 40; i++) {
      p.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 1,
        duration: Math.random() * 4 + 3,
        delay: Math.random() * 5,
        opacity: Math.random() * 0.5 + 0.1,
      });
    }
    setParticles(p);
  }, []);

  return (
    <div className="particles-container" aria-hidden="true">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: p.id % 3 === 0 ? "#c9963a" : p.id % 3 === 1 ? "#c41e3a" : "#e8cf8d",
            opacity: p.opacity,
          }}
          // 偏好人静的访客：不传 animate，星点就停在原地
          animate={
            reduceMotion
              ? undefined
              : {
                  y: [-20, -120, -20],
                  x: [0, p.id % 2 === 0 ? 30 : -30, 0],
                  opacity: [p.opacity, p.opacity * 0.3, p.opacity],
                }
          }
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: p.duration,
                  delay: p.delay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        />
      ))}
    </div>
  );
}
