import type { Config } from "tailwindcss";
import { colors, spacing, radius, fontSize } from "./tokens";

const preset: Partial<Config> = {
  content: ["./node_modules/@zaroda/ui/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: colors.primary,
        secondary: colors.secondary,
        accent: colors.accent,
        success: colors.success,
        warning: colors.warning,
        error: colors.error,
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        border: "var(--border)",
      },
      spacing: { ...spacing, touch: "44px" },
      borderRadius: radius,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fontSize: fontSize as any,
    },
  },
};

export default preset;
