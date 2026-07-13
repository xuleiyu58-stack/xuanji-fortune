import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        mystic: {
          950: "#050508",
          900: "#0a0a12",
          800: "#111122",
          700: "#1a1a30",
          600: "#2a2a45",
        },
        gold: {
          200: "#f5e6c8",
          300: "#e8cf8d",
          400: "#d4a84b",
          500: "#c9963a",
          600: "#b8832e",
          700: "#8a5c1f",
          800: "#5c3d15",
        },
        vermillion: {
          300: "#f0a0a8",
          400: "#e8505c",
          500: "#c41e3a",
          600: "#a0182e",
          700: "#7a0f20",
        },
        jade: {
          400: "#5a9e7c",
          500: "#3d7356",
          600: "#2f5f3a",
          700: "#1f4026",
        },
        paper: {
          50: "#fdfaf3",
          100: "#f5f0e8",
          200: "#e8dcc8",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
        calligraphy: ["var(--font-calligraphy)", "cursive"],
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        glow: "glow 2s ease-in-out infinite alternate",
        "ink-spread": "inkSpreads 1.5s ease-out forwards",
        "fade-up": "fadeUp 0.8s ease-out forwards",
        "pulse-gold": "pulseGold 2s ease-in-out infinite",
        "scroll-down": "scrollDown 2s ease-in-out infinite",
        particle: "particle 3s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
        glow: {
          "0%": { boxShadow: "0 0 20px rgba(201, 150, 58, 0.3)" },
          "100%": { boxShadow: "0 0 40px rgba(201, 150, 58, 0.6)" },
        },
        inkSpreads: {
          "0%": { clipPath: "circle(0% at 50% 50%)", opacity: "0" },
          "100%": { clipPath: "circle(100% at 50% 50%)", opacity: "1" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(30px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseGold: {
          "0%, 100%": { borderColor: "rgba(201, 150, 58, 0.3)" },
          "50%": { borderColor: "rgba(201, 150, 58, 0.8)" },
        },
        scrollDown: {
          "0%, 100%": { transform: "translateY(0)", opacity: "1" },
          "50%": { transform: "translateY(8px)", opacity: "0.3" },
        },
        particle: {
          "0%, 100%": { transform: "translateY(0) scale(1)", opacity: "1" },
          "50%": { transform: "translateY(-100px) scale(0.5)", opacity: "0.3" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
