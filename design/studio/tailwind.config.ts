import type { Config } from "tailwindcss";

/**
 * Studio Tailwind config.
 *
 * Colors are CSS var references so a single `data-theme="dark|light"`
 * flip on <html> recolors every Tailwind class. Var values live in
 * `app/globals.css` and mirror scout's oklch HUD bundles from
 * `packages/web/client/scout/Provider.tsx`.
 *
 * Display is Play — the studio's HUD-flavored title face. Body stays
 * Inter Tight, chrome stays JetBrains Mono (those mirror scout). All
 * three loaded from Google Fonts in `app/layout.tsx`.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    // Shared studio package source (bun workspace sibling) — so Tailwind
    // emits classes that only appear inside studio's components.
    "../../../studio/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        studio: {
          canvas: "var(--studio-canvas)",
          "canvas-alt": "var(--studio-canvas-alt)",
          surface: "var(--studio-surface)",
          ink: "var(--studio-ink)",
          "ink-muted": "var(--studio-ink-muted)",
          "ink-faint": "var(--studio-ink-faint)",
          edge: "var(--studio-edge)",
          "edge-strong": "var(--studio-edge-strong)",
        },
        scout: {
          accent: "var(--scout-accent)",
          "accent-soft": "var(--scout-accent-soft)",
        },
        status: {
          "ok-fg": "var(--status-ok-fg)",
          "ok-bg": "var(--status-ok-bg)",
          "warn-fg": "var(--status-warn-fg)",
          "warn-bg": "var(--status-warn-bg)",
          "error-fg": "var(--status-error-fg)",
          "error-bg": "var(--status-error-bg)",
          "info-fg": "var(--status-info-fg)",
          "info-bg": "var(--status-info-bg)",
          "neutral-fg": "var(--status-neutral-fg)",
          "neutral-bg": "var(--status-neutral-bg)",
        },
      },
      // Tailwind 3's divide-COLOR plugin doesn't auto-derive from
      // nested custom palettes the way border-COLOR does. Without this
      // block, `divide-studio-edge/60` would silently fall back to
      // currentColor (= near-white ink on dark surfaces), which is
      // exactly the "thick white line" failure mode we hit. Mirroring
      // the dividers we actually use here keeps them token-driven.
      divideColor: {
        "studio-edge": "var(--studio-edge)",
        "studio-edge-strong": "var(--studio-edge-strong)",
        "scout-accent": "var(--scout-accent)",
      },
      fontFamily: {
        display: [
          "Play",
          "Inter Tight",
          "-apple-system",
          '"SF Pro Display"',
          "sans-serif",
        ],
        sans: [
          "Inter Tight",
          "Inter",
          "-apple-system",
          '"SF Pro Text"',
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          '"SF Mono"',
          "Menlo",
          "monospace",
        ],
      },
      letterSpacing: {
        eyebrow: "0.22em",
        ch: "0.18em",
        status: "0.28em",
      },
      maxWidth: {
        page: "1680px",
        prose: "720px",
      },
    },
  },
  plugins: [],
};

export default config;
