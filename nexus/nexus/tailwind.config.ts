import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { nx: {
    bg: "rgb(var(--nx-bg) / <alpha-value>)", panel: "rgb(var(--nx-panel) / <alpha-value>)", line: "rgb(var(--nx-line) / <alpha-value>)",
    violet: "rgb(var(--nx-violet) / <alpha-value>)", blue: "rgb(var(--nx-blue) / <alpha-value>)" } } } },
} satisfies Config;
