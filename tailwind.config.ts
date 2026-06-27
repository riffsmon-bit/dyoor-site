import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./providers/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dyoor: {
          bg: "#03030a",
          panel: "#0d1020",
          line: "#2f255c",
          cyan: "#39ffe2",
          magenta: "#ff4fe3",
          purple: "#836ef9",
          violet: "#5d38ff",
          monad: "#a78bfa",
        },
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
