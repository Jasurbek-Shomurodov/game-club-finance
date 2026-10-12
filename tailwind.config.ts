import type { Config } from "tailwindcss";

/**
 * Design tokens. One cobalt accent for actions and the current page; slate
 * neutrals with a slight blue tint; green/red/amber reserved for meaning
 * (money in, money out, needs attention).
 *
 * Every colour resolves through a CSS variable declared in globals.css, where
 * the dark set is swapped in under `prefers-color-scheme: dark`. `<alpha-value>`
 * keeps opacity modifiers like `bg-gray-950/40` working.
 */
function scale(name: string, shades: number[]) {
  return Object.fromEntries(shades.map((shade) => [shade, `rgb(var(--c-${name}-${shade}) / <alpha-value>)`]));
}

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Matches globals.css: the OS setting unless <html data-theme> forces a theme.
  darkMode: [
    "variant",
    [
      '@media (prefers-color-scheme: dark) { &:not([data-theme="light"], [data-theme="light"] *) }',
      '&:is([data-theme="dark"], [data-theme="dark"] *)',
    ],
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        // Card / panel background: white in light mode, a raised dark slate in dark mode.
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        // Text on a filled accent (primary/success/danger buttons): white in light mode,
        // dark ink in dark mode where the accent fills are light.
        "on-accent": "rgb(var(--c-on-accent) / <alpha-value>)",
        // Slate-tinted neutrals replace Tailwind's pure greys everywhere.
        gray: scale("gray", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        primary: scale("primary", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        success: scale("success", [50, 100, 500, 600, 700]),
        danger: scale("danger", [50, 100, 400, 500, 600, 700]),
        warning: scale("warning", [50, 100, 500, 600, 700]),
        orange: scale("orange", [50, 100, 500, 600, 700]),
        purple: scale("purple", [50, 100, 500, 600, 700]),
        sidebar: "rgb(var(--c-surface) / <alpha-value>)",
      },
      ringOffsetColor: {
        DEFAULT: "rgb(var(--c-gray-50))",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(11, 16, 24, 0.04)",
        card: "0 1px 2px rgba(11, 16, 24, 0.04), 0 2px 8px rgba(11, 16, 24, 0.04)",
        pop: "0 4px 12px rgba(11, 16, 24, 0.08), 0 12px 40px rgba(11, 16, 24, 0.10)",
      },
    },
  },
  plugins: [],
};

export default config;
