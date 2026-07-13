"use client";

import Link from "next/link";
import { motion } from "framer-motion";

interface Props {
  icon: string;
  title: string;
  subtitle: string;
  price: string;
  tag?: string;
  href: string;
  delay: number;
}

export default function FortuneCard({ icon, title, subtitle, price, tag, href, delay }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.6, delay }}
    >
      <Link href={href} className="block">
        <div className="mystic-card rounded-lg p-6 h-full flex flex-col items-center text-center group cursor-pointer relative overflow-hidden">
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
            style={{
              background: "radial-gradient(circle at 50% 0%, rgba(201, 150, 58, 0.08) 0%, transparent 60%)",
            }}
          />

          {tag && (
            <span className="badge-hot absolute top-3 right-3">{tag}</span>
          )}

          <span className="text-4xl mb-4 relative z-10 group-hover:scale-110 transition-transform duration-300">
            {icon}
          </span>

          <h3
            className="text-xl mb-2 text-gold relative z-10"
            style={{ fontFamily: "'Noto Serif SC', serif" }}
          >
            {title}
          </h3>

          <p className="text-paper-100/50 text-sm mb-4 leading-relaxed relative z-10">
            {subtitle}
          </p>

          <div className="mt-auto relative z-10">
            <div className="price-tag">
              <span className="symbol">¥</span>
              <span className="amount">{price}</span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
