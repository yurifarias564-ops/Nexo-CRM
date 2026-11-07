import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0a0a0c", 900: "#111214", 850: "#151619", 800: "#1b1c20", 700: "#232429", 600: "#2e3036" },
        // Cores da marca vêm de variáveis CSS: cada empresa pode ter as suas (personalização)
        navy: { 500: "rgb(var(--navy-500) / <alpha-value>)", 400: "rgb(var(--navy-400) / <alpha-value>)" },
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)", 100: "rgb(var(--brand-100) / <alpha-value>)", 200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)", 400: "rgb(var(--brand-400) / <alpha-value>)", 500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)", 700: "rgb(var(--brand-700) / <alpha-value>)",
        },
        line: "rgba(255,255,255,0.07)",
      },
      fontFamily: {
        sans: ["\"Plus Jakarta Sans Variable\"", "var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 6px 20px -8px rgb(var(--brand-500) / .55)",
        card: "0 1px 0 0 rgba(255,255,255,.025) inset",
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
