import type { Config } from "tailwindcss";

/**
 * Studio Tailwind config.
 *
 * Colors are CSS var references (`var(--studio-*)`). Values resolve through
 * Hudsonkit `--hud-*` tokens (via `app/theme-aliases.css`) and flip when
 * `data-hudson-theme` changes on <html>.
 *
 * Display + body: Inter Tight. Chrome: JetBrains Mono. No display/futuristic
 * face — the studio reads as a work surface, not a landing page.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./views/**/*.{ts,tsx}",
    // Hudsonkit chrome ships full Tailwind class strings in compiled JS —
    // scan those chunks so SidePanel / StatusBar / Frame utilities emit.
    "./node_modules/hudsonkit/dist/chunk-F64WBZGR.js",
    "./node_modules/hudsonkit/dist/chunk-7P3MMITW.js",
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
        // Hudsonkit chrome vocabulary (bg-background, text-muted-foreground, …).
        // Channel form so opacity modifiers (`bg-card/95`) work under TW3.
        background: "oklch(var(--background) / <alpha-value>)",
        foreground: "oklch(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "oklch(var(--card) / <alpha-value>)",
          foreground: "oklch(var(--card-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "oklch(var(--muted) / <alpha-value>)",
          foreground: "oklch(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "oklch(var(--accent) / <alpha-value>)",
          foreground: "oklch(var(--accent-foreground) / <alpha-value>)",
        },
        border: "oklch(var(--border) / <alpha-value>)",
        input: "oklch(var(--input) / <alpha-value>)",
        ring: "oklch(var(--ring) / <alpha-value>)",
        success: "oklch(var(--success) / <alpha-value>)",
        warning: "oklch(var(--warning) / <alpha-value>)",
        destructive: {
          DEFAULT: "oklch(var(--destructive) / <alpha-value>)",
          foreground: "oklch(var(--destructive-foreground) / <alpha-value>)",
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
          "Inter Tight",
          "Inter",
          "-apple-system",
          '"SF Pro Text"',
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
      /**
       * Type ladder — whole pixels only.
       *
       * The studio had no fontSize scale at all: every size was an arbitrary
       * `text-[Npx]` value, 25 distinct sizes across the chrome, eight of them
       * fractional (7.5 / 8.5 / 9.5 / 10.5 / 11.5 / 12.5 / 13.5 / 14.5). Half-
       * pixels do not survive rounding at these sizes — 9.5px and 10.5px render
       * as the same glyphs on a 2x display, so the ladder had rungs that were
       * not visually distinct while the code implied they were.
       *
       * These steps mirror the Scout web scale in `docs/design/tokens.md`, so
       * the studio and the product it designs share one ladder rather than two
       * dialects. Snapping, per that same doc: fractional → nearest, ties down
       * (9.5→9, 10.5→11, 12.5→12, 13.5→13).
       *
       * NOTE: these override Tailwind's defaults, so `text-sm` is 11px here,
       * not 14px. That is deliberate — the studio is a closed system and the
       * names should mean the Scout ladder. Sizes carry no line-height; set
       * leading explicitly (`leading-none` for eyebrows, `leading-relaxed` for
       * prose) so a size change never silently drags leading with it.
       */
      fontSize: {
        "2xs": "9px",
        xs: "10px",
        sm: "11px",
        md: "12px",
        lg: "13px",
        xl: "14px",
        "2xl": "16px",
        "3xl": "18px",
        "4xl": "20px",
        "5xl": "24px",
        "6xl": "28px",
      },
      letterSpacing: {
        // `eyebrow` is the studio's signature wide label tracking (278 call
        // sites) and stays put. `label` and `caps` exist so the ad-hoc
        // `tracking-[0.12em]` / `[0.14em]` / `[0.20em]` values have somewhere
        // to land instead of multiplying.
        //
        // Deliberately NOT named `tight` / `wide` / `wider`: those are Tailwind
        // defaults, and `tracking-tight` alone has 212 call sites here. Adding
        // them under `extend` would silently flip that class from -0.025em to a
        // positive value and loosen every display heading in the studio.
        label: "0.08em",
        caps: "0.12em",
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
