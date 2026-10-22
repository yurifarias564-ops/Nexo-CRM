import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#03050a", 900: "#060a14", 850: "#0a1020", 800: "#0d1528", 700: "#13203d", 600: "#1b2c52" },
        navy: { 500: "#1e3a8a", 400: "#2547a8" },
        brand: { 600: "#1d4ed8", 500: "#2563eb", 400: "#3b82f6", 300: "#60a5fa" },
        line: "rgba(96,165,250,0.12)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(59,130,246,.25), 0 8px 30px -8px rgba(37,99,235,.45)",
        card: "0 1px 0 0 rgba(255,255,255,.03) inset, 0 8px 24px -12px rgba(0,0,0,.8)",
      },
      keyframes: {
        pulseRing: { "0%": { transform: "scale(1)", opacity: ".6" }, "100%": { transform: "scale(1.9)", opacity: "0" } },
        fadeIn: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { pulseRing: "pulseRing 1.4s ease-out infinite", fadeIn: "fadeIn .18s ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
