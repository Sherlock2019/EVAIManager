/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // cockpit surfaces
        abyss: "#05080D",
        panel: "#0A0F17",
        raised: "#0F1621",
        line: "#18212F",
        "line-strong": "#263347",
        // ink
        ink: "#E8EEF7",
        "ink-2": "#A3B2C7",
        "ink-3": "#64748B",
        // signal colours (status only)
        accent: "#3BC9F5",
        good: "#22C55E",
        warn: "#FAB219",
        serious: "#EC835A",
        crit: "#EF4444",
        info: "#3987E5",
        idle: "#6B7A90",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        "3xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
      },
      keyframes: {
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        slideIn: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "pulse-dot": "pulseDot 1.6s ease-in-out infinite",
        "slide-in": "slideIn 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
