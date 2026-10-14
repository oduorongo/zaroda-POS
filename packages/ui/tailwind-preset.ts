import type { Config } from "tailwindcss";
import { colors, spacing, radius, fontSize } from "./tokens";

// The brand navy is almost the same colour as the dark theme's page background, so primary buttons,
// links and focus rings vanish in dark mode. These shades therefore read a CSS variable that each app's
// globals.css sets to a lighter blue ONLY in dark mode; the fallback is the original navy, so light mode
// (and any app that doesn't set the variable) is unchanged. The "<alpha-value>" keeps bg-primary-600/20 working.
const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
const themed = (shade: 500 | 600 | 700 | 800) => `rgb(var(--primary-${shade}-rgb, ${hexToRgb(colors.primary[shade])}) / <alpha-value>)`;

const preset: Partial<Config> = {
  content: ["./node_modules/@zaroda/ui/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { ...colors.primary, 500: themed(500), 600: themed(600), 700: themed(700), 800: themed(800) },
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
