/**
 * talkie-ref.ts — canonical Talkie design tokens ported into our studio.
 *
 * Canonical reference (READ-ONLY): /Users/art/dev/Talkie
 *   - design/studio  → components/studies/PhoneFrame.tsx,
 *                      components/studies/primitives/StatusBar.tsx,
 *                      components/studies/Complications.tsx,
 *                      lib/themes.ts, app/globals.css
 *   - apps/ios/Talkie iOS/Resources/DesignSystem.swift (ScopeMobile palette)
 *     + ThemeManager.swift
 *
 * Standing owner directive: "use ../Talkie for studio + iPhone ref".
 * Every value below carries a `// src:` comment citing the Talkie file it
 * was lifted from. When Talkie changes, change it HERE, not at call sites.
 *
 * Plain exported const objects — no dependencies, safe to import anywhere.
 */

/* ── Scope palette (light) ──────────────────────────────────────────── */

export const SCOPE = {
  canvas: "#FBFAF7", // src: Talkie apps/ios DesignSystem.swift:206 (ScopeMobile.canvas); studio app/globals.css:77
  canvasAlt: "#F5F3EE", // src: Talkie apps/ios DesignSystem.swift:207 (ScopeMobile.canvasAlt); app/globals.css:78
  paper: "#F8F6F1", // src: Talkie design/studio app/globals.css:79 (--theme-paper)
  sheet: "#F2F0EA", // src: Talkie design/studio app/globals.css:80 (--theme-sheet)
  panel: "#ECE9E1", // src: Talkie design/studio app/globals.css:93 (--theme-panel)
  panelAlt: "#F1EEE8", // src: Talkie design/studio app/globals.css:94 (--theme-panel-alt)
  rec: "#C43A1C", // src: Talkie design/studio app/globals.css:106 (--theme-rec)
  recGlow: "rgba(196, 58, 28, 0.50)", // src: Talkie design/studio app/globals.css:107 (--theme-rec-glow)
} as const;

/* ── Ink ladder ─────────────────────────────────────────────────────── */

export const INK = {
  ink: "#1A1612", // src: Talkie apps/ios DesignSystem.swift:212 (ScopeMobile.ink); app/globals.css:81
  dim: "#2A2620", // src: Talkie design/studio app/globals.css:82 (--theme-ink-dim)
  muted: "#463B32", // src: Talkie design/studio app/globals.css:83 (--theme-ink-muted)
  faint: "#5A5045", // src: Talkie apps/ios DesignSystem.swift:214 (inkMuted); app/globals.css:84 (--theme-ink-faint)
  subtle: "#A39989", // src: Talkie apps/ios DesignSystem.swift:216 (inkSubtle); app/globals.css:85
} as const;

/* ── Amber (brass → phosphor) ───────────────────────────────────────── */

export const AMBER = {
  brass: "#B5823A", // src: Talkie apps/ios DesignSystem.swift:228 (ScopeMobile.amber light); app/globals.css:86
  phosphor: "#E89A3C", // src: Talkie apps/ios DesignSystem.swift:228 (amber darkHex); app/globals.css:104 (--theme-screen-trace)
  soft: "rgba(181, 130, 58, 0.34)", // src: Talkie design/studio app/globals.css:90 (--theme-amber-soft)
  glow: "rgba(181, 130, 58, 0.14)", // src: Talkie design/studio app/globals.css:91 (--theme-amber-glow)
  faint: "rgba(181, 130, 58, 0.08)", // src: Talkie design/studio app/globals.css:92 (--theme-amber-faint)
  phosphorGlow: "rgba(232, 154, 60, 0.55)", // src: Talkie design/studio app/globals.css:105 (--theme-screen-trace-glow)
} as const;

/* ── Edges (ink @ opacity ladder) ───────────────────────────────────── */

export const EDGES = {
  edge: "rgba(26, 22, 18, 0.30)", // src: Talkie design/studio app/globals.css:99 (--theme-edge)
  dim: "rgba(26, 22, 18, 0.20)", // src: Talkie design/studio app/globals.css:100 (--theme-edge-dim)
  faint: "rgba(26, 22, 18, 0.10)", // src: Talkie design/studio app/globals.css:101 (--theme-edge-faint)
  subtle: "rgba(26, 22, 18, 0.06)", // src: Talkie design/studio app/globals.css:102 (--theme-edge-subtle)
} as const;

/* ── Type ramp ──────────────────────────────────────────────────────── */

export const TYPE = {
  fontDisplay: 'Newsreader, "Iowan Old Style", Georgia, serif', // src: Talkie design/studio app/globals.css:118 (--theme-font-display)
  fontBody: 'Inter, -apple-system, "SF Pro Text", sans-serif', // src: Talkie design/studio app/globals.css:119 (--theme-font-body)
  fontMono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace', // src: Talkie design/studio app/globals.css:120 (--theme-font-mono)
  displayWeight: 500, // src: Talkie design/studio app/globals.css:121 (--theme-display-weight); lib/themes.ts:64 (scope)
  displayTracking: "-0.018em", // src: Talkie design/studio app/globals.css:122 (--theme-display-tracking)
  eyebrow: {
    fontSizeMin: 9, // src: Talkie design/studio components/studies/Complications.tsx:400 (SummonIdle hint, 9px)
    fontSizeMax: 10, // src: Talkie design/studio components/studies/Complications.tsx:99 (ContentBackdrop eyebrow, 10px)
    weight: 600, // src: Talkie design/studio components/studies/Complications.tsx:99 (font-semibold)
    trackingMin: "0.18em", // src: Talkie design/studio components/studies/Complications.tsx:401
    trackingMax: "0.22em", // src: Talkie design/studio components/studies/Complications.tsx:99
  },
} as const;

/* ── Status bar spec (iPhone) ───────────────────────────────────────── */

export const STATUS_BAR = {
  height: 38, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:14
  time: "9:41", // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:7
  timeFontSize: 12, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:10 (text-[12px])
  timeWeight: 600, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:10 (font-semibold)
  paddingX: 20, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:10 (px-5)
  island: {
    width: 88, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:20
    height: 22, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:20
    radius: 14, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:19 (rounded-[14px])
    top: 4, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:19 (top-1)
    background: "#000", // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:20
  },
  battery: {
    width: 22, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:70
    height: 11, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:71
    radius: 3, // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:67 (rounded-[3px])
    fill: "#5fc97a", // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:77
    fillLevel: "76%", // src: Talkie design/studio components/studies/primitives/StatusBar.tsx:77
  },
} as const;

/* ── Complications geometry (corner pills + center FAB) ─────────────── */

export const COMPLICATIONS = {
  cornerSize: 40, // src: Talkie design/studio components/studies/Complications.tsx:177-178 (CornerSlot 40×40)
  offsetTop: 50, // src: Talkie design/studio components/studies/Complications.tsx:171 (STATUS_BAR_OFFSET)
  offsetSide: 20, // src: Talkie design/studio components/studies/Complications.tsx:172 (SAFE_INSET)
  offsetBottom: 28, // src: Talkie design/studio components/studies/Complications.tsx:173 (FAB_INSET)
  fab: {
    size: 56, // src: Talkie design/studio components/studies/Complications.tsx:217-218 (CenterFAB 56×56)
    bottom: 24, // src: Talkie design/studio components/studies/Complications.tsx:215
    border: `1px solid ${AMBER.soft}`, // src: Talkie design/studio components/studies/Complications.tsx:222
    shadow: `0 6px 16px -6px ${AMBER.glow}, inset 0 0.5px 0 rgba(255,255,255,0.30)`, // src: Talkie design/studio components/studies/Complications.tsx:226-227
  },
} as const;

/* ── Phone frame (Talkie's own chassis — reference only) ──────────────
 * Our studio keeps its own realistic sizing (iPhone 390×844 screen,
 * titanium bezel) in components/DeviceShell.tsx; these are Talkie's
 * simpler flat-black numbers, kept here so the two frames stay
 * comparable. The SHADOW recipe below IS adopted by DeviceShell. */

export const FRAME = {
  width: 380, // src: Talkie design/studio components/studies/PhoneFrame.tsx:25
  aspectRatio: "9 / 19.5", // src: Talkie design/studio components/studies/PhoneFrame.tsx:26
  bezel: 8, // src: Talkie design/studio components/studies/PhoneFrame.tsx:29 (padding)
  chassis: "#0a0a0a", // src: Talkie design/studio components/studies/PhoneFrame.tsx:27
  chassisRadius: 44, // src: Talkie design/studio components/studies/PhoneFrame.tsx:28
  // screen radius = chassis radius − bezel (44 − 8 = 36) — the enforced math
  screenRadius: 36, // src: Talkie design/studio components/studies/PhoneFrame.tsx:38
  shadow:
    "0 0 0 1px rgba(0,0,0,0.2), 0 14px 36px -10px rgba(20,16,12,0.22), 0 30px 80px -20px rgba(20,16,12,0.10)", // src: Talkie design/studio components/studies/PhoneFrame.tsx:30-31
  island: {
    width: 96, // src: Talkie design/studio components/studies/PhoneFrame.tsx:52
    height: 24, // src: Talkie design/studio components/studies/PhoneFrame.tsx:53
    top: 14, // src: Talkie design/studio components/studies/PhoneFrame.tsx:48
    background: "#000", // src: Talkie design/studio components/studies/PhoneFrame.tsx:54
  },
} as const;

/* ── Machined-metal shadow recipes (CSS strings) ────────────────────── */

export const METAL = {
  /** Top sheen — light catching a machined edge. */
  topSheen: "inset 0 0.5px 0 rgba(255, 255, 255, 0.45)", // src: Talkie design/studio app/globals.css:112-113 (--theme-card-shadow)
  /** Shade pair over a metal surface. */
  shadeTop: "rgba(255, 255, 255, 0.04)", // src: Talkie design/studio app/globals.css:95 (--theme-metal-top)
  shadeBottom: "rgba(26, 22, 18, 0.09)", // src: Talkie design/studio app/globals.css:96 (--theme-metal-bottom)
  /** Lifted card on paper. */
  cardShadowStrong:
    "0 1px 0 rgba(255, 255, 255, 0.5), 0 4px 12px -6px rgba(20, 16, 12, 0.10), inset 0 0.5px 0 rgba(255, 255, 255, 0.55)", // src: Talkie design/studio app/globals.css:114-117 (--theme-card-shadow-strong)
  /** Recessed bay — hairline rim + inner shadow. */
  recessedBay: `inset 0 0 0 1px ${EDGES.faint}, inset 0 2px 6px rgba(26, 22, 18, 0.08)`, // src: Talkie design/studio app/globals.css:101 (edge-faint) + machined-recess recipe
  /** Recess lip color. */
  recessLip: "rgba(26, 22, 18, 0.16)", // src: Talkie design/studio app/globals.css:97 (--theme-recess-lip)
} as const;
