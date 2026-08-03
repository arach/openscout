// Scout iOS — theme tokens + scoped CSS for the study surfaces.
//
// The iOS app renders on Hudson's single `HudPalette` dark palette (emerald
// accent, pure-neutral near-black) plus a thin Scout decoration layer
// (`ScoutCanvas` wash + `scoutCard` depth). It is dark-locked — no presets, no
// light mode, no accent switching, unlike macOS's ScoutThemeColors.
//
// The `--i-*` vars are the exact native values:
//   - HudPalette / HudHairline  (~/dev/hudson/.../HudsonUI/Tokens/HudPalette.swift)
//   - Scout card + canvas tones  (apps/ios/Scout/Theme.swift)
//
// `data-v` selects the palette (shipped vs higher-contrast). `data-density`
// and `data-layout` are treatment hooks the per-surface labs flip — everything
// reads only from these vars + class hooks, so a treatment is a thin delta.

import type { GlyphKind } from "./Glyph";

/** Palette variant — shipped native HudPalette, the higher-contrast proposal,
 *  or the warm-light Paper study (the "less dark" comparison palette). */
export type Variant = "shipped" | "hc" | "paper";
/**
 * The study surfaces. The first four are top-level tab content; the rest are
 * detail/sheet surfaces (custom header, often no tab bar) reached by push or
 * from the gear.
 */
export type Surface =
  | "home" | "comms" | "agents" | "ops" | "tail"
  | "terminal" | "new" | "conversation" | "connect" | "settings"
  | "notification";

// The docked tab bar: Home · Comms · Agents · Ops — four destinations, the
// places you *go*. New is NOT here: it's a contextual action (a compose "+" per
// surface), since "new" means something different in each place — a new
// conversation in Comms, a new session in Agents. Comms and Agents are distinct
// (the Slack "chats vs contacts" split): Comms is the conversations; Agents is
// the directory/inventory tree of who exists. Ops folds Tail + Terminal into
// one "raw truth" destination — it opens on Tail (the live firehose) with a
// Terminal toggle. Home leads with the needs-you band over the ambient swarm.
export type PhoneTab = { label: string; kind: GlyphKind; activeFor?: Surface[] };

export const TABS: PhoneTab[] = [
  // The notification detail PUSHES over whatever tab you were on; in the study
  // it is authored against Home, so Home stays lit behind it.
  { label: "Home", kind: "home", activeFor: ["home", "notification"] },
  { label: "Comms", kind: "comms", activeFor: ["comms", "conversation"] },
  { label: "Agents", kind: "agent", activeFor: ["agents"] },
  { label: "Ops", kind: "pulse", activeFor: ["ops", "tail", "terminal"] },
];

/** The current six-seat phone order in RootView.Surface. Kept separate from
 *  TABS because the older iOS studies intentionally preserve the four-seat
 *  Comms / Agents / Ops IA they were built to evaluate. */
export const CURRENT_PHONE_TABS: PhoneTab[] = [
  { label: "Home", kind: "home", activeFor: ["home", "notification"] },
  { label: "Agents", kind: "agent", activeFor: ["agents"] },
  { label: "Tail", kind: "pulse", activeFor: ["tail", "ops"] },
  { label: "Comms", kind: "comms", activeFor: ["comms", "conversation"] },
  { label: "Terminal", kind: "terminal", activeFor: ["terminal"] },
  { label: "New", kind: "plus", activeFor: ["new"] },
];

export const SCOUT_IOS_CSS = `
.scoutios { --i-font: "Inter Tight", ui-sans-serif, system-ui, sans-serif;
  --i-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace; }

/* ── Token bridge — studio atoms on phone tokens ─────────────────────── */
/* The kit renders shared studio atoms as-is (today: MessageComposer +
   MessageComposerSelect). Those are styled in Tailwind studio-* / scout-*
   classes, which resolve to the --studio-* / --scout-* vars declared on :root
   in app/globals.css. Rebinding the whole registered set here from the --i-*
   palette makes any such atom follow Paper / Shipped / Higher-contrast
   automatically — and the override is inert outside .scoutios.
   --studio-edge deliberately takes --i-hairline-strong, not --i-hairline: the
   kit reserves --i-hairline for row separators, and a control border at that
   value is invisible on the Shipped surface. --studio-edge-strong has no kit
   equivalent that is reliably stronger (--i-border is LIGHTER than
   --i-hairline-strong on Paper), so it is mixed from ink — it carries focus
   and hover, which have to read as a lift in every palette. */
.scoutios {
  --studio-canvas: var(--i-bg);
  --studio-canvas-alt: var(--i-chrome);
  --studio-surface: var(--i-surface);
  --studio-ink: var(--i-ink);
  --studio-ink-muted: var(--i-muted);
  --studio-ink-faint: var(--i-dim);
  --studio-edge: var(--i-hairline-strong);
  --studio-edge-strong: color-mix(in oklab, var(--i-ink) 24%, var(--i-hairline-strong));
  --scout-accent: var(--i-accent);
  --scout-accent-soft: var(--i-accent-soft);
}

/* ── Shipped — exact native HudPalette + Scout layer ─────────────────── */
.scoutios[data-v="shipped"] {
  --i-bg: #0a0a0a; --i-surface: #171717; --i-chrome: #060606;
  --i-ink: #e5e5e5; --i-muted: #a3a3a3; --i-dim: #737373;
  --i-border: #272727; --i-hairline: #181818; --i-hairline-strong: #262626;
  --i-accent: #10b981; --i-accent-2: #0bc5a5; --i-accent-soft: rgba(16,185,129,0.10);
  --i-ok: #22c55e; --i-warn: #f59e0b; --i-error: #dc2626; --i-info: #3b82f6;
  --i-card-top: #1b1b1e; --i-card-bottom: #131315;
  --i-card-edge-top: #383a3f; --i-card-edge-bottom: #272727;
  --i-wash-top: #0c0c0d; --i-wash-bottom: #040405; --i-keylight: rgba(255,255,255,0.05);
}

/* ── Higher-contrast — proposed, mirrors the macOS dark port ─────────── */
.scoutios[data-v="hc"] {
  --i-bg: #0a0a0a; --i-surface: #1e1e1e; --i-chrome: #060606;
  --i-ink: #f0f0f0; --i-muted: #b0b0b0; --i-dim: #808080;
  --i-border: #303030; --i-hairline: #1c1c1c; --i-hairline-strong: #2e2e2e;
  --i-accent: #10b981; --i-accent-2: #0bc5a5; --i-accent-soft: rgba(16,185,129,0.12);
  --i-ok: #22c55e; --i-warn: #f59e0b; --i-error: #dc2626; --i-info: #3b82f6;
  --i-card-top: #202024; --i-card-bottom: #161618;
  --i-card-edge-top: #46484f; --i-card-edge-bottom: #303030;
  --i-wash-top: #0c0c0d; --i-wash-bottom: #040405; --i-keylight: rgba(255,255,255,0.055);
}

/* ── Paper — warm light study palette (the "less dark" comparison) ────── */
/* Warm grays (R>G>B, per the macOS Paper preset direction), emerald-600
   accent for contrast on light. Additive: shipped/hc stay the baseline.
   Tuned for hairline legibility + soft ink-tinted lift (not black glass). */
.scoutios[data-v="paper"] {
  --i-bg: #f1efe9; --i-surface: #fbfaf7; --i-chrome: #ebe8e2;
  --i-ink: #1f1d19; --i-muted: #6a6660; --i-dim: #968f85;
  --i-border: #d6d1c7; --i-hairline: #e2ddd4; --i-hairline-strong: #cdc7bc;
  --i-accent: #059669; --i-accent-2: #10b981; --i-accent-soft: rgba(5,150,105,0.09);
  --i-ok: #16a34a; --i-warn: #b45309; --i-error: #b91c1c; --i-info: #2563eb;
  --i-card-top: #fffcf8; --i-card-bottom: #f5f3ee;
  --i-card-edge-top: #ffffff; --i-card-edge-bottom: #d2cdc3;
  --i-wash-top: #f7f5f0; --i-wash-bottom: #e7e3db; --i-keylight: rgba(255,255,255,0.92);
}
/* paper: layered ink-tinted shadows, hairline tab edge — warm, not sooty */
.scoutios[data-v="paper"] .iCard { box-shadow: inset 0 1px 0 var(--i-card-edge-top),
  0 1px 2px rgba(62,56,44,0.05), 0 6px 14px -6px rgba(62,56,44,0.09); }
.scoutios[data-v="paper"] .iTabs { border-top-color: var(--i-hairline-strong);
  box-shadow: 0 -3px 10px rgba(62,56,44,0.04); }
.scoutios[data-v="paper"] .iStatusBar { border-top-color: var(--i-hairline-strong); }
.scoutios[data-v="paper"] .iFleetAskWell { box-shadow: inset 0 1px 2px rgba(62,56,44,0.06); }
.scoutios[data-v="paper"] .iHomeBar { background: #55524b; }
/* paper mic/send: soft keylit face instead of dark-glass inset */
.scoutios[data-v="paper"] .iMic, .scoutios[data-v="paper"] .iSend {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.75), 0 1px 2px rgba(62,56,44,0.05); }

/* ── Phone frame ─────────────────────────────────────────────────────── */
/* iPhone 17 Pro — screen 402×874pt, display corner radius 55, Dynamic Island */
.iPhone { width: 418px; border-radius: 62px; padding: 8px;
  background: #000; border: 1px solid #2a2a2a;
  box-shadow: 0 30px 70px -28px rgba(0,0,0,0.85); }
.iScreen { position: relative; height: 874px; border-radius: 55px; overflow: hidden;
  font-family: var(--i-font); color: var(--i-ink); display: flex; flex-direction: column;
  background:
    radial-gradient(130% 55% at 50% 0%, var(--i-keylight), rgba(255,255,255,0) 62%),
    linear-gradient(180deg, var(--i-wash-top) 0%, var(--i-bg) 36%, var(--i-wash-bottom) 100%); }

/* status bar + notch */
.iStatus { height: 54px; flex: none; display: flex; align-items: center;
  justify-content: space-between; padding: 0 30px; font-size: var(--text-2xl); font-weight: 600;
  letter-spacing: 0.02em; position: relative; z-index: 2; }
/* Dynamic Island — 125×37pt, ~11pt from top */
.iNotch { position: absolute; top: 11px; left: 50%; transform: translateX(-50%);
  width: 125px; height: 37px; border-radius: 19px; background: #000; z-index: 3; }
.iStatusGlyphs { display: flex; align-items: center; gap: 6px; }
.iBars { display: flex; align-items: flex-end; gap: 2px; height: 11px; }
.iBars i { width: 3px; background: var(--i-ink); border-radius: 1px; }
.iBatt { width: 24px; height: 12px; border: 1px solid var(--i-muted); border-radius: 3px;
  position: relative; padding: 1.5px; }
.iBatt::after { content: ""; position: absolute; right: -3px; top: 3px; width: 2px; height: 6px;
  background: var(--i-muted); border-radius: 0 1px 1px 0; }
.iBattFill { height: 100%; width: 72%; background: var(--i-ink); border-radius: 1px; }

/* masthead — "Scout" wordmark + gear over a hairline (RootView titleBar) */
.iHead { flex: none; padding: 7px 16px 6px; }
.iMast { display: flex; align-items: center; gap: 10px; }
.iWordmark { flex: none; color: var(--i-ink); font-size: var(--text-4xl); font-weight: 600; letter-spacing: -0.01em; }
.iMastGap { min-width: 0; flex: 1 1 auto; }
.iMastHostWrap { position: relative; z-index: 12; min-width: 0; flex: 0 1 auto; }
.iMastHostButton { position: relative; display: flex; min-width: 0; height: 30px; align-items: center; gap: 6px;
  padding: 0; border: 0; color: var(--i-muted); background: transparent; cursor: pointer; }
.iMastHostButton::before { position: absolute; content: ""; inset: -7px -4px; }
.iScoutWireHexWrap { position: relative; display: grid; width: 20px; height: 22px; flex: none; place-items: center; }
.iScoutWireHex { width: 100%; height: 100%; overflow: visible; fill: none; stroke: currentColor;
  stroke-linecap: round; stroke-linejoin: round; }
.iScoutWireHex .outer { stroke-width: 10; }
.iScoutWireHex .rays { stroke-width: 8; }
.iScoutWireHex .inner { opacity: 0.68; stroke-width: 7; }
.iScoutWireHex .iScoutHostDot { fill: var(--i-bg); stroke: var(--i-dim); stroke-width: 9;
  transition: fill 90ms ease-out, stroke 90ms ease-out; }
.iScoutWireHex .iScoutHostDot[data-online="true"] { stroke: var(--i-accent); }
.iScoutWireHex .iScoutHostDot[data-selected="true"] { fill: var(--i-dim); }
.iScoutWireHex .iScoutHostDot[data-selected="true"][data-online="true"] { fill: var(--i-accent); }
.iMastHostLabel { max-width: 84px; overflow: hidden; color: var(--i-ink); font-family: var(--i-mono);
  font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.iMastHostLabelWide { display: none; }
.iMastHostButton > svg { flex: none; color: var(--i-dim); }
.iMastHostMenu { position: absolute; top: calc(100% + 8px); left: -4px; z-index: 20; display: grid;
  width: 218px; overflow: hidden; border: 1px solid var(--i-hairline-strong); border-radius: 12px;
  background: var(--i-surface); box-shadow: 0 10px 28px rgba(0,0,0,0.34); }
.iMastHostMenuHead { display: flex; min-height: 42px; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 8px 6px 10px; border-bottom: 1px solid var(--i-hairline); }
.iMastHostMenuTitle { display: grid; gap: 1px; }
.iMastHostMenuTitle strong { color: var(--i-ink); font-size: 11px; font-weight: 600; }
.iMastHostMenuTitle small { color: var(--i-muted); font-family: var(--i-mono); font-size: var(--text-2xs); }
.iMastHostMenuActions { display: flex; align-items: center; gap: 2px; }
.iMastHostMenuActions button { min-width: 36px; height: 28px; padding: 0 7px; border: 0; border-radius: 7px;
  color: var(--i-ink); background: transparent; font-size: 10px; font-weight: 600; cursor: pointer; }
.iMastHostMenuActions button:last-child { background: var(--i-accent-soft); }
.iMastHostMenuActions button:disabled { color: var(--i-dim); background: transparent; cursor: default; }
.iMastHostMenu > button { display: flex; min-height: 44px; align-items: center; gap: 9px; padding: 6px 10px;
  border: 0; border-bottom: 1px solid var(--i-hairline); color: var(--i-muted); background: transparent;
  cursor: pointer; text-align: left; }
.iMastHostMenu > button:last-child { border-bottom: 0; }
.iMastHostMenu > button[aria-pressed="true"] { background: var(--i-accent-soft); }
.iMastHostMenu > button[aria-disabled="true"] { cursor: default; }
.iMastHostMenuDot { width: 7px; height: 7px; margin: 0 5px; flex: none; border: 1px solid var(--i-dim);
  border-radius: 50%; background: transparent; }
.iMastHostMenuDot[data-online="true"] { border-color: var(--i-accent); }
.iMastHostMenuDot[data-selected="true"] { background: var(--i-dim); }
.iMastHostMenuDot[data-selected="true"][data-online="true"] { background: var(--i-accent); }
.iMastHostMenuCopy { display: grid; min-width: 0; flex: 1; gap: 1px; }
.iMastHostMenuCopy strong { overflow: hidden; color: var(--i-ink); font-size: 11px; font-weight: 600;
  text-overflow: ellipsis; white-space: nowrap; }
.iMastHostMenuCopy small { color: var(--i-muted); font-family: var(--i-mono); font-size: var(--text-2xs); }
.iMastHostButton:focus-visible, .iMastHostMenu button:focus-visible { outline: 2px solid var(--i-accent); outline-offset: -2px; }
.iMastHostButton:hover { color: var(--i-ink); }
.iMastHostMenu > button:hover:not([aria-disabled="true"]) { background: color-mix(in oklab, var(--i-ink) 5%, transparent); }
.iPad .iScoutWireHexWrap { width: 22px; height: 24px; }
.iPad .iMastHostLabel { max-width: 180px; }
.iPad .iMastHostLabelCompact { display: none; }
.iPad .iMastHostLabelWide { display: inline; }
.iGear { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
  background: var(--i-surface); color: var(--i-muted);
  border: 1px solid var(--i-hairline-strong); }
/* Persistent compose — always the same spot (masthead, before the gear), but
   only rendered on surfaces where starting something new makes sense. */
.iCompose { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
  background: var(--i-accent-soft); color: var(--i-accent);
  border: 1px solid color-mix(in oklab, var(--i-accent) 35%, transparent); }
.iMastRule { height: 1px; background: var(--i-hairline-strong); margin-top: 5px; }

/* scroll body */
.iBody { flex: 1; overflow: hidden; padding: 0 14px 6px; position: relative; z-index: 1; }

/* section header (HudSectionLabel) — caps mono micro, optional pulsing dot + All */
.iSec { display: flex; align-items: center; gap: 7px; padding: 10px 4px 6px; }
.iSecLabel { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  color: var(--i-muted); font-family: var(--i-mono); }
.iSecAll { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  color: var(--i-accent); font-family: var(--i-mono); margin-left: auto; }
.iPulse { width: 6px; height: 6px; border-radius: 50%; background: var(--i-accent); flex: none;
  box-shadow: 0 0 0 0 var(--i-accent); animation: iPulse 1.6s ease-out infinite; }
@keyframes iPulse { 0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--i-accent) 55%,transparent)}
  70%{box-shadow:0 0 0 5px transparent} 100%{box-shadow:0 0 0 0 transparent} }

/* scoutCard depth — top edge highlight + drop shadow do the separation */
.iCard { border-radius: 16px; border: 1px solid var(--i-card-edge-bottom);
  background: linear-gradient(180deg, var(--i-card-top), var(--i-card-bottom));
  box-shadow: inset 0 1px 0 var(--i-card-edge-top), 0 3px 9px rgba(0,0,0,0.33); }

/* dots */
.iDot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.iDotLive { box-shadow: 0 0 0 0 var(--i-accent); animation: iPulse 1.6s ease-out infinite; }
.iRing { width: 5px; height: 5px; border-radius: 50%; flex: none;
  border: 1px solid var(--i-dim); box-sizing: border-box; }
.iCaret { display: inline-block; width: 2px; height: 13px; vertical-align: -2px;
  margin-left: 2px; background: var(--i-accent); animation: iBlink 1.2s ease-in-out infinite; }
@keyframes iBlink { 0%,100%{opacity:1} 50%{opacity:0} }

/* ── Machine rail ──────────────────────────────────────────────────────── */
.iRail { display: flex; align-items: center; gap: 9px; padding: 4px 4px 0; }
.iRailCap { font-size: var(--text-2xs); font-weight: 600; letter-spacing: 0.08em; color: var(--i-muted);
  font-family: var(--i-mono); flex: none; }
.iRailScroll { display: flex; gap: 7px; overflow: hidden; }
.iChip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 999px;
  background: var(--i-surface); border: 1px solid var(--i-hairline-strong); white-space: nowrap; }
.iChip.on { border-color: color-mix(in oklab, var(--i-accent) 40%, transparent);
  box-shadow: 0 0 7px color-mix(in oklab, var(--i-accent) 12%, transparent); }
.iChipName { font-size: var(--text-sm); font-weight: 500; color: var(--i-ink); }
.iChip.off .iChipName { color: var(--i-muted); }
.iChipAdd .iChipName { color: var(--i-muted); }

/* ── Search field (HudField) ───────────────────────────────────────────── */
.iField { display: flex; align-items: center; gap: 8px; margin: 7px 0 2px; padding: 8px 12px;
  border-radius: 11px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.iField span { font-size: var(--text-lg); color: var(--i-muted); }
.iField svg { color: var(--i-dim); flex: none; }

/* ── Currently working strip ───────────────────────────────────────────── */
.iWorkScroll { display: flex; gap: 11px; overflow: hidden; padding: 2px 0; }
.iWorkCard { position: relative; width: 188px; flex: none; padding: 10px;
  border-radius: 14px; background: var(--i-surface);
  border: 1px solid color-mix(in oklab, var(--i-accent) 20%, var(--i-hairline-strong)); }
.iWorkTop { display: flex; align-items: center; gap: 6px; }
.iWorkName { font-size: var(--text-lg); font-weight: 600; color: var(--i-ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iWorkAction { font-size: var(--text-sm); color: var(--i-muted); font-family: var(--i-mono); margin-top: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.iWorkMeta { font-size: var(--text-xs); color: var(--i-dim); font-family: var(--i-mono); margin-top: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iCorner { position: absolute; width: 9px; height: 9px; opacity: 0.55; }
.iCorner::before, .iCorner::after { content: ""; position: absolute; background: var(--i-accent); }
.iCorner.tl { top: 7px; left: 7px; }
.iCorner.tr { top: 7px; right: 7px; }
.iCorner::before { width: 9px; height: 1.5px; top: 0; }
.iCorner.tl::after { width: 1.5px; height: 9px; left: 0; }
.iCorner.tr::after { width: 1.5px; height: 9px; right: 0; }

/* ── Project / agent list rows (inside scoutCard) ──────────────────────── */
.iRow { display: flex; align-items: center; gap: 9px; padding: 9px 13px; }
.iRowSep { height: 1px; background: var(--i-hairline); margin-left: 22px; }
.iRowSep.inset { margin-left: 40px; }
.iFolder { color: var(--i-muted); flex: none; width: 16px; display: grid; place-items: center; }
.iProjName { font-size: var(--text-xl); font-weight: 500; color: var(--i-ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iSlash { font-size: var(--text-md); color: var(--i-dim); font-family: var(--i-mono); flex: none; }
.iLeaf { font-size: var(--text-lg); color: var(--i-muted); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; display: inline-flex; align-items: center; gap: 4px; }
.iLeaf .glyf { color: var(--i-dim); flex: none; }
.iPill { font-size: var(--text-2xs); font-family: var(--i-mono); color: var(--i-dim); padding: 1px 5px;
  border-radius: 999px; background: var(--i-surface); border: 1px solid var(--i-hairline);
  flex: none; }
.iSpacer { flex: 1; min-width: 8px; }
.iAge { font-size: var(--text-sm); color: var(--i-muted); font-family: var(--i-mono); flex: none;
  text-align: right; }
.iAge.live { color: var(--i-accent); }
.iChev { color: var(--i-dim); flex: none; }
/* nested agent leaf with tree connector */
.iLeafRow { display: flex; align-items: center; gap: 8px; padding: 7px 13px;
  background: color-mix(in oklab, var(--i-surface) 50%, transparent); }
.iTree { width: 18px; flex: none; align-self: stretch; color: var(--i-dim); }
.iAgentName { font-size: var(--text-md); color: var(--i-ink); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.iAgentName.dim { color: var(--i-muted); }
.iAgentTok { font-size: var(--text-2xs); color: var(--i-dim); font-family: var(--i-mono); flex: none; }
.iHarness { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-muted); flex: none; }

/* ── Activity rows (inside scoutCard) ──────────────────────────────────── */
.iActRow { display: flex; align-items: flex-start; gap: 9px; padding: 7px 13px; }
.iActDot { margin-top: 5px; }
.iActBody { flex: 1; min-width: 0; }
.iActSummary { font-size: var(--text-lg); color: var(--i-ink); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.iActMeta { font-size: var(--text-xs); color: var(--i-muted); font-family: var(--i-mono); margin-top: 2px; }

/* ── Agents surface ────────────────────────────────────────────────────── */
.iSummary { display: flex; align-items: center; padding: 4px 4px 8px; }
.iSort { display: flex; gap: 2px; margin-left: auto; }
.iSortBtn { font-size: var(--text-2xs); font-family: var(--i-mono); letter-spacing: 0.06em; padding: 3px 8px;
  border: 0; border-radius: 999px; color: var(--i-muted); background: transparent; cursor: pointer; }
.iSortBtn.on { color: var(--i-accent); font-weight: 700;
  background: color-mix(in oklab, var(--i-accent) 12%, transparent); }
.iSortBtn:focus-visible { outline: 2px solid var(--i-accent); outline-offset: 1px; }
.iProjHead { display: flex; align-items: center; gap: 9px; padding: 9px 13px 4px; }
.iProjGlyph { display: grid; grid-template-columns: 3px 3px; gap: 3px; flex: none; }
.iProjGlyph i { width: 3px; height: 3px; border-radius: 50%; background: var(--i-muted); }
.iProjHeadName { font-size: var(--text-xl); font-weight: 600; color: var(--i-ink); }
.iCount { font-size: var(--text-sm); color: var(--i-muted); font-family: var(--i-mono); flex: none; }
.iAgentMain { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.iSessionLine { font-size: var(--text-xs); color: var(--i-muted); font-family: var(--i-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iADivider { height: 1px; background: color-mix(in oklab, var(--i-ink) 6%, transparent);
  margin-left: 14px; }
.iAgentChangeDot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--i-accent); }

/* ── Unified overview · hosts + unread changes ───────────────────────── */
.iUnifiedAgents { container-type: inline-size; }
.iUnifiedLane { width: 100%; }
.iAgentScope { display: grid; grid-template-columns: 1fr 1fr; margin: 1px 0 5px;
  border-bottom: 1px solid var(--i-hairline-strong); }
.iAgentScope button { display: flex; min-height: 34px; align-items: center; justify-content: center; gap: 7px;
  padding: 0 8px; border: 0; border-bottom: 1px solid transparent; color: var(--i-muted);
  background: transparent; cursor: pointer; font-family: var(--i-mono); font-size: var(--text-xs); font-weight: 600;
  letter-spacing: 0.07em; text-transform: uppercase; }
.iAgentScope button[data-selected="true"] { border-bottom-color: var(--i-accent); color: var(--i-ink); }
.iAgentScope em { min-width: 16px; color: var(--i-dim); font-size: var(--text-2xs); font-style: normal; text-align: center; }
.iAgentScope button[data-selected="true"] em { color: var(--i-accent); }
.iAgentScope button:focus-visible {
  outline: 2px solid var(--i-accent); outline-offset: 1px; }
.iUnifiedEmpty { padding: 28px 4px; color: var(--i-muted); font-size: var(--text-md); text-align: center; }

@container (min-width: 600px) {
  .iUnifiedLane { max-width: 700px; margin: 0 auto; }
}

/* ── Comms surface ─────────────────────────────────────────────────────── */
.iCommsRow { display: flex; align-items: center; gap: 9px; padding: 12px 6px; position: relative; }
.iCommsRow.unread { background: color-mix(in oklab, var(--i-ink) 5%, transparent); }
.iCommsRail { position: absolute; left: 1px; top: 9px; bottom: 9px; width: 3px; border-radius: 2px;
  background: var(--i-accent); }
.iCommsType { width: 15px; flex: none; color: var(--i-muted); display: grid; place-items: center; }
.iCommsName { font-size: var(--text-xl); color: var(--i-ink); width: 116px; flex: none; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iCommsName.unread { font-weight: 600; }
.iCommsStatus { width: 16px; flex: none; display: grid; place-items: center; font-family: var(--i-mono);
  font-size: var(--text-lg); font-weight: 700; }
.iCommsPreview { font-size: var(--text-md); color: var(--i-muted); flex: 1; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iCommsAge { font-size: var(--text-sm); color: var(--i-muted); font-family: var(--i-mono); flex: none; }
.iUnread { font-size: var(--text-2xs); font-weight: 700; font-family: var(--i-mono); color: var(--i-bg);
  background: var(--i-accent); border-radius: 999px; padding: 1px 5px; flex: none; }
.iCommsSep { height: 1px; background: color-mix(in oklab, var(--i-ink) 6%, transparent);
  margin-left: 30px; }
.iGroupDots { display: flex; gap: 2px; }
.iGroupDots i { width: 3.5px; height: 3.5px; border-radius: 50%; background: currentColor; }
.iBraille { font-family: var(--i-mono); color: var(--i-accent); font-size: var(--text-lg); }

/* ── Tail surface ──────────────────────────────────────────────────────── */
.iTailHead { display: flex; align-items: center; padding: 4px 4px 10px; }
.iLiveInd { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; padding: 3px 9px;
  border-radius: 999px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.iLiveInd span { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.1em; font-family: var(--i-mono);
  color: var(--i-accent); text-transform: uppercase; }
.iEv { padding: 10px 11px; border-radius: 11px; background: var(--i-surface);
  border: 1px solid var(--i-hairline); margin-bottom: 7px; }
.iEvTop { display: flex; align-items: center; gap: 7px; }
.iBadge { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.04em; font-family: var(--i-mono); }
.iBadge i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.iEvSource { font-size: var(--text-xs); font-weight: 600; color: var(--i-dim); font-family: var(--i-mono); }
.iEvKind { font-size: var(--text-xs); color: var(--i-muted); font-family: var(--i-mono); }
.iEvTime { font-size: var(--text-xs); color: var(--i-dim); font-family: var(--i-mono); margin-left: auto; }
.iEvText { font-size: var(--text-sm); color: var(--i-ink); font-family: var(--i-mono); margin-top: 6px;
  line-height: 1.45; }

/* ── Inbox surface ─────────────────────────────────────────────────────── */
/* "Needs you" header — warmer than the muted section caps; ink label + a count
   capsule, so the queue size reads at a glance. */
.iNeedHead { display: flex; align-items: center; gap: 7px; padding: 9px 4px 7px; }
.iNeedHeadLabel { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-ink); }
.iNeedCount { font-size: var(--text-2xs); font-weight: 700; font-family: var(--i-mono); color: var(--i-bg);
  background: var(--i-accent); border-radius: 999px; padding: 1px 6px; }
.iNeedClear { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-muted); margin-left: auto; }
/* One inbox item — tone dot · agent·project · KIND · age, then the demand and
   any inline decision (approve/deny, option chips, the awaiting command). */
.iNeedRow { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; }
.iNeedDot { width: 7px; height: 7px; border-radius: 50%; flex: none; margin-top: 5px; }
.iNeedBody { flex: 1; min-width: 0; }
.iNeedTop { display: flex; align-items: center; gap: 7px; }
.iNeedAgent { font-size: var(--text-lg); font-weight: 600; color: var(--i-ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iNeedProj { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iNeedKind { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.07em; font-family: var(--i-mono);
  color: var(--i-dim); flex: none; margin-left: auto; }
.iNeedAge { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-muted); flex: none; }
.iNeedSummary { font-size: var(--text-md); line-height: 1.45; color: var(--i-muted); margin-top: 3px; }
.iNeedCmd { display: flex; align-items: center; gap: 8px; margin-top: 7px; padding: 5px 9px;
  border-radius: 8px; background: var(--i-bg); border: 1px solid var(--i-hairline);
  font-size: var(--text-sm); font-family: var(--i-mono); color: var(--i-ink); }
.iNeedCmdText { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iNeedRisk { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  font-family: var(--i-mono); flex: none; }
.iNeedActions { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
.iNeedBtn { font-size: var(--text-sm); font-weight: 600; padding: 5px 13px; border-radius: 8px;
  border: 1px solid transparent; cursor: pointer; font-family: var(--i-font); }
.iNeedBtn.deny { background: transparent; color: var(--i-muted); border-color: var(--i-hairline-strong); }
.iNeedBtn.approve { background: var(--i-accent); color: #04130d; }
.iNeedOpt { font-size: var(--text-sm); font-weight: 600; padding: 5px 13px; border-radius: 8px; cursor: pointer;
  font-family: var(--i-font); background: var(--i-surface); color: var(--i-ink);
  border: 1px solid var(--i-hairline-strong); }
/* All-clear beat — the empty inbox, the moment the app should feel calm. */
.iAllClear { display: flex; flex-direction: column; align-items: center; gap: 7px; text-align: center;
  padding: 26px 22px 20px; }
.iAllClearMark { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
  color: var(--i-accent); background: var(--i-accent-soft);
  border: 1px solid color-mix(in oklab, var(--i-accent) 40%, transparent); }
.iAllClearTitle { font-size: var(--text-xl); font-weight: 600; color: var(--i-ink); }
.iAllClearSub { font-size: var(--text-sm); font-family: var(--i-mono); color: var(--i-muted); }

/* ── Tab bar ─────────────────────────────────────────────────────────── */
.iTabs { flex: none; height: 52px; display: flex; padding: 7px 8px 0;
  border-top: 1.5px solid var(--i-card-edge-top); background: var(--i-chrome);
  position: relative; z-index: 2; box-shadow: 0 -6px 11px rgba(0,0,0,0.6); }
.iTab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
  color: var(--i-muted); padding-top: 2px; }
.iTab[data-on="true"] { color: var(--i-accent); }
.iTabIcon { position: relative; display: grid; place-items: center; }
.iTabBadge { position: absolute; top: -5px; right: -10px; min-width: 14px; height: 14px; padding: 0 4px;
  box-sizing: border-box; border-radius: 999px; background: var(--i-accent); color: var(--i-bg);
  font-size: var(--text-2xs); font-weight: 700; font-family: var(--i-mono); display: grid; place-items: center;
  box-shadow: 0 0 0 2px var(--i-chrome); }
.iTabLabel { font-size: var(--text-2xs); font-weight: 500; font-family: var(--i-mono); letter-spacing: 0.02em; }

/* ── Bottom cockpit status bar (ScoutStatusBar) ──────────────────────── */
.iStatusBar { flex: none; display: flex; align-items: center; justify-content: space-between;
  padding: 4px 18px 0; min-height: 20px; background: var(--i-chrome);
  border-top: 1px solid var(--i-hairline); position: relative; z-index: 2; }
.iSbRun { display: flex; align-items: center; gap: 6px; }
.iSbCell { display: inline-flex; align-items: center; gap: 4px; color: var(--i-muted); }
.iSbCell svg { color: var(--i-accent); }
.iSbLabel { font-size: var(--text-2xs); font-weight: 500; letter-spacing: 0.04em; font-family: var(--i-mono);
  color: var(--i-muted); white-space: nowrap; }
.iSbDot { font-size: var(--text-2xs); color: var(--i-dim); font-family: var(--i-mono); }
.iHomeBar { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
  width: 139px; height: 5px; border-radius: 3px; background: var(--i-muted); opacity: 0.5; z-index: 4; }

/* ── Fleet home (responsive) ───────────────────────────────────────────── */
/* One component, two formats via container queries: the phone default keeps
   EVERY element to a single line (inline stat run + mini sparkline, one-line
   lane rows, a one-line ask strip); the wide stage (≥600px container — the
   iPad frame) opens into the dashboard: big numerals, lanes beside an
   Ask-the-fleet rail with the live fleet log. Same markup, no forks. */
.iFleet { container-type: inline-size; }

/* stat band — phone: one inline run + mini sparkline */
.iFleetStats { display: flex; align-items: center; gap: 10px; padding: 8px 4px 4px; }
.iFleetStat { display: inline-flex; align-items: baseline; gap: 5px; flex: none; }
.iFleetNum { font-size: var(--text-2xl); font-weight: 700; font-family: var(--i-mono); color: var(--i-ink);
  letter-spacing: -0.02em; }
.iFleetStat.hot .iFleetNum { color: var(--i-accent); }
.iFleetStatCap { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-dim); white-space: nowrap; }
.iFleetSpark { flex: 1; min-width: 40px; height: 20px; }
/* Stat separators — inert by default; crisp language turns them on for the
   phone inline run (wide hides them again once numerals stack). */
.iFleetStatSep { display: none; }

/* lane headers */
.iFleetLaneHead { display: flex; align-items: center; gap: 7px; padding: 9px 4px 5px; }
.iFleetLaneLabel { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-muted); }
.iFleetLaneCount { font-size: var(--text-2xs); font-weight: 700; font-family: var(--i-mono); color: var(--i-dim); }
.iFleetCard.hot { border-color: color-mix(in oklab, var(--i-accent) 26%, var(--i-card-edge-bottom)); }

/* one row = one line, always */
.iFleetRow { display: flex; align-items: center; gap: 8px; padding: 8px 12px; min-width: 0; }
.iFleetName { font-size: var(--text-md); font-weight: 600; color: var(--i-ink); flex: none; max-width: 104px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iFleetName.dim { color: var(--i-muted); font-weight: 500; }
.iFleetDetail { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--i-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iFleetDetail.mono { font-size: var(--text-xs); font-family: var(--i-mono); }
.iFleetRow.dim .iFleetDetail { color: var(--i-dim); }
.iFleetTok { display: none; font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.07em;
  font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iFleetAge { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iFleetAge.live { color: var(--i-accent); }

/* ask-the-fleet — phone: folded to a one-line docked strip */
.iFleetAsk { margin-top: 10px; }
.iFleetAskHead, .iFleetAskPickers, .iFleetAskWell { display: none; }
.iFleetAskRow { display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 13px;
  background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.iFleetAskHint { flex: 1; font-size: var(--text-md); color: var(--i-dim); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iFleetLog { display: none; }

/* wide — the iPad stage: numerals, two columns, full ask rail + fleet log */
@container (min-width: 600px) {
  .iFleetStats { gap: 26px; padding: 12px 6px 8px; }
  .iFleetStat { flex-direction: column; align-items: flex-start; gap: 3px; }
  .iFleetNum { font-size: var(--text-6xl); line-height: 1; }
  .iFleetSpark { height: 40px; max-width: 260px; flex: 1; margin-left: auto; align-self: flex-end; }
  .iFleetGrid { display: grid; grid-template-columns: 1fr 250px; gap: 16px; align-items: start; }
  .iFleetTok { display: inline; }
  .iFleetName { max-width: 150px; font-size: var(--text-lg); }
  .iFleetDetail { font-size: var(--text-md); }
  .iFleetRow { padding: 9px 13px; }
  .iFleetAsk { margin-top: 9px; padding: 12px; border-radius: 14px; background: var(--i-surface);
    border: 1px solid var(--i-hairline-strong); }
  .iFleetAskHead { display: flex; padding: 0 0 8px; }
  .iFleetAskPickers { display: flex; gap: 6px; padding-bottom: 8px; }
  .iFleetPicker { font-size: var(--text-xs); font-weight: 700; font-family: var(--i-mono); letter-spacing: 0.05em;
    color: var(--i-muted); padding: 4px 9px; border-radius: 7px; border: 1px solid var(--i-hairline-strong);
    display: inline-flex; align-items: center; gap: 5px; }
  .iFleetPicker i { font-style: normal; font-size: var(--text-3xs); color: var(--i-dim); }
  .iFleetPicker.on { color: var(--i-accent); background: var(--i-accent-soft);
    border-color: color-mix(in oklab, var(--i-accent) 40%, transparent); }
  .iFleetAskWell { display: block; font-size: var(--text-md); color: var(--i-dim); line-height: 1.45;
    min-height: 62px; padding: 9px 11px; border-radius: 10px; background: var(--i-bg);
    border: 1px solid var(--i-hairline); box-shadow: inset 0 1px 2px rgba(0,0,0,0.3); margin-bottom: 9px; }
  .iFleetAskRow { padding: 0; border: none; background: transparent; border-radius: 0; }
  .iFleetAskHint { display: none; }
  .iFleetAskRow .iMic { margin-right: auto; }
  .iFleetLog { display: block; margin-top: 14px; }
  .iFleetLogRow { display: flex; align-items: baseline; gap: 7px; padding: 4px 2px; font-family: var(--i-mono); }
  .iFleetLogTime { font-size: var(--text-2xs); color: var(--i-dim); flex: none; }
  .iFleetLogSrc { font-size: var(--text-2xs); font-weight: 700; color: var(--i-muted); flex: none; }
  .iFleetLogText { font-size: var(--text-xs); color: var(--i-muted); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
}

/* ── Fleet home · Log (chart + quota strip, one flat activity log) ──────── */
/* A calmer Home. The top is a compact strip of the two glance-values that
   help — a mini activity chart and each subscription's spent windows (short 5h
   + long weekly) — and the whole body is ONE flat log: no cards, no lanes, no
   dividing sections. Responsive via the same container-query idiom: the phone
   fits three strip segments across; the iPad stage gives them more air (bigger
   chart, per-window resets) and the flat log full width. */
/* fixed top (strip + notifications) · scrolling activity log · fixed bottom
   (terminals) — a proper app column so both shelves stay put and the log flexes */
.iLog { container-type: inline-size; padding-top: 4px; height: 100%;
  display: flex; flex-direction: column; }

/* top strip — activity · Claude · Codex, split by hairlines, closed with a
   single hairline before the log */
.iStrip { flex: none; display: flex; align-items: stretch; padding: 8px 2px 12px;
  border-bottom: 1px solid var(--i-hairline); }
.iStripSeg { flex: 1.1; min-width: 0; display: flex; flex-direction: column;
  padding: 1px 10px; border-left: 1px solid var(--i-hairline); }
.iStripSeg:first-child { padding-left: 2px; border-left: none; }
.iStripSeg--chart { flex: 0.85; }
.iStripHead { display: flex; align-items: baseline; gap: 5px; margin-bottom: 7px; min-width: 0; }
.iStripLabel { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-muted); flex: none; }
.iStripPlan { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-dim); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }

/* mini activity chart — fills the segment height under its label */
.iChartSpark { width: 100%; flex: 1; min-height: 30px; display: block; }

/* subscription windows — short (5h) + long (weekly), thin meters, single accent,
   amber once a window is nearly spent (≥80%). Reset hidden on the tight phone. */
.iWins { display: flex; flex-direction: column; gap: 6px; }
.iWin { display: flex; align-items: center; gap: 6px; min-width: 0; }
.iWinLabel { font-size: var(--text-3xs); font-weight: 700; font-family: var(--i-mono); color: var(--i-dim);
  flex: none; width: 14px; }
.iWinTrack { flex: 1; min-width: 12px; height: 3px; border-radius: 999px;
  background: var(--i-hairline-strong); overflow: hidden; }
.iWinFill { height: 100%; border-radius: 999px; background: var(--i-accent); }
.iWinFill[data-hot] { background: var(--i-warn); }
.iWinPct { font-size: var(--text-2xs); font-weight: 700; font-family: var(--i-mono); color: var(--i-accent);
  flex: none; min-width: 24px; text-align: right; }
.iWinPct[data-hot] { color: var(--i-warn); }
.iWinReset { display: none; font-size: var(--text-3xs); font-family: var(--i-mono); color: var(--i-dim);
  flex: none; min-width: 22px; text-align: right; }

/* ── Home shelves — recent notifications (top) + terminals (bottom) ─────── */
/* Two horizontal shelves that bracket the flat log: notifications just under
   the strip, terminals docked at the bottom. Each is a labelled header + a
   horizontal scroller of fixed-width tiles. */
.iShelf { flex: none; }
.iShelf--notifs { padding: 9px 0 4px; border-bottom: 1px solid var(--i-hairline); }
.iShelf--terms { padding: 7px 0 2px; border-top: 1px solid var(--i-hairline); }
.iShelfHead { display: flex; align-items: center; gap: 6px; padding: 0 2px 6px; color: var(--i-dim); }
.iShelfLabel { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-muted); }
.iShelfCount { font-size: var(--text-2xs); font-weight: 700; font-family: var(--i-mono); color: var(--i-dim); }
.iShelfRow { display: flex; gap: 8px; overflow-x: auto; padding: 1px 2px 4px;
  scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.iShelfRow::-webkit-scrollbar { display: none; }

/* notification chip */
.iNotif { flex: none; width: 186px; position: relative; padding: 7px 10px 8px 11px;
  border-radius: 11px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.iNotif::before { content: ""; position: absolute; left: 0; top: 9px; bottom: 9px; width: 2px;
  border-radius: 999px; background: transparent; }
.iNotif[data-fresh]::before { background: var(--i-accent); }
.iNotifTop { display: flex; align-items: baseline; gap: 7px; margin-bottom: 3px; }
.iNotifAgent { flex: 1; min-width: 0; font-size: var(--text-sm); font-weight: 600; color: var(--i-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iNotifAge { font-size: var(--text-2xs); font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iNotifAge.live { color: var(--i-accent); }
.iNotifBody { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.iNotifKind { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iNotifKind[data-hot] { color: var(--i-warn); }
.iNotifText { flex: 1; min-width: 0; font-size: var(--text-xs); color: var(--i-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* terminal tile — mono, a darker well; a running session reads live */
.iTerm { flex: none; width: 208px; padding: 7px 10px 8px; border-radius: 10px;
  background: var(--i-bg); border: 1px solid var(--i-hairline-strong); }
.iTerm[data-run] { border-color: color-mix(in oklab, var(--i-accent) 26%, var(--i-hairline-strong)); }
.iTermTop { display: flex; align-items: baseline; gap: 7px; margin-bottom: 4px; }
.iTermCwd { flex: 1; min-width: 0; font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; font-family: var(--i-mono); color: var(--i-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iTermAge { font-size: var(--text-2xs); font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iTermAge.live { color: var(--i-accent); }
.iTermCmd { font-size: var(--text-sm); font-family: var(--i-mono); color: var(--i-ink); margin-bottom: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iTermCaret { color: var(--i-accent); margin-right: 5px; }
.iTermLast { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* flat activity log — no cards, no lane dividers; one continuous stream */
.iLogHead { flex: none; display: flex; align-items: center; gap: 7px; padding: 11px 2px 3px; }
.iLogList { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none; }
.iLogList::-webkit-scrollbar { display: none; }
.iLogRow { display: flex; align-items: center; gap: 9px; padding: 8px 4px 8px 8px; position: relative;
  border-bottom: 1px solid var(--i-hairline); }
.iLogRow:last-child { border-bottom: none; }
.iLogRow::before { content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
  border-radius: 999px; background: transparent; }
.iLogRow[data-now]::before { background: var(--i-accent); }
.iLogText { flex: 1; min-width: 0; font-size: var(--text-md); color: var(--i-muted); line-height: 1.35;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iLogRow[data-now] .iLogText { color: var(--i-ink); }
.iLogSrc { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iLogAge { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim); flex: none;
  min-width: 30px; text-align: right; }
.iLogAge.live { color: var(--i-accent); }

/* wide — the iPad stage: the strip gets air (bigger chart, per-window resets),
   the flat log runs full width */
@container (min-width: 600px) {
  .iStrip { padding: 12px 4px 16px; }
  .iStripSeg { padding: 1px 20px; }
  .iStripSeg--chart { flex: 1; }
  .iStripHead { margin-bottom: 10px; }
  .iChartSpark { min-height: 56px; }
  .iWins { gap: 9px; }
  .iWinLabel { font-size: var(--text-2xs); width: 16px; }
  .iWinTrack { height: 4px; }
  .iWinPct { font-size: var(--text-xs); min-width: 28px; }
  .iWinReset { display: block; }
  .iLogRow { padding: 10px 6px 10px 10px; }
  .iLogText { font-size: var(--text-md); }
}

/* ── Entry — composer-first Home ────────────────────────────────────────── */
/* The front door inverted: the pulse greeting up top, the Ask well at thumb
   height, instruments demoted to Ops/the Mac. The treatment renders its own
   bottom chrome (Steering Loop grammar): dock + tabs, no cockpit ticker. */
.iEntry { display: flex; flex-direction: column; overflow: hidden; }
.iEntryPulse { padding: 44px 6px 0; }
.iEntryHeadline { font-size: var(--text-6xl); font-weight: 600; letter-spacing: -0.02em; line-height: 1.15;
  color: var(--i-ink); }
.iEntrySub { margin-top: 8px; font-size: var(--text-lg); color: var(--i-muted); }
.iEntryAir { flex: 1 1 auto; min-height: 18px; }
.iEntryMore { padding: 8px 6px 0; font-size: var(--text-sm); color: var(--i-dim); }
/* recents are a WHISPER — the composer is the page; recency is just the
   shortest path back. Names muted, previews dim, nothing bold. */
.iEntryRecents { flex: none; }
.iEntryRecent { display: flex; align-items: baseline; gap: 8px; padding: 7px 14px; }
.iEntryConvName { font-size: var(--text-md); font-weight: 500; color: var(--i-muted); flex: none; }
.iEntryConvPrev { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--i-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iEntryConvAge { font-size: var(--text-2xs); font-family: var(--i-mono); color: var(--i-dim); flex: none; }
/* The composer inside is the MessageComposer atom in its pill appearance —
   phone shape comes from params, not from CSS here (see the token bridge at
   the top of this sheet). */
.iEntryDock { flex: none; padding: 10px 14px 12px; position: relative; z-index: 2; }
/* first run */
.iEntryWelcome { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center;
  padding: 0 10px 44px; }
.iEntryHeadline.big { font-size: var(--text-6xl); letter-spacing: -0.025em; }
.iEntryPromise { margin: 13px 0 0; font-size: var(--text-xl); line-height: 1.55; color: var(--i-muted);
  max-width: 330px; }
.iEntryConnect { margin-top: 28px; height: 50px; border-radius: 15px; display: grid;
  place-items: center; font-size: var(--text-2xl); font-weight: 600; color: #04130d;
  background: linear-gradient(180deg, var(--i-accent-2), var(--i-accent));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25),
    0 5px 16px -5px color-mix(in oklab, var(--i-accent) 55%, transparent); }
.iEntryHint { margin-top: 13px; font-size: var(--text-md); color: var(--i-dim); }
/* Liquid-glass tab bar — the Apple-shaped bottom chrome the Entry home wears
   (iOS 26 glassEffect natively; backdrop-filter is the honest CSS
   analogue). A capsule floating inset from every edge, over content rather
   than docked to it, carrying the same top rim light + hairline the machined
   complications wear — glass rail, graphite instruments. No cockpit status
   strip under it: a floating bar wants clear air, and what the strip alone
   could tell you (connection dropped / data gone stale) returns as one dim
   line above the bar, and only while it is true. */
/* The rail owns the home-indicator safe area itself (no cockpit strip below
   to absorb it), so the capsule floats clear of the indicator. */
.iGlassRail { flex: none; padding: 6px 20px 18px; display: flex; flex-direction: column;
  align-items: center; gap: 4px; }
.iGlassNote { font-size: var(--text-2xs); font-family: var(--i-mono); font-weight: 500;
  letter-spacing: 0.06em; color: var(--i-dim); }
.iGlassBar { width: 100%; display: flex; border-radius: 999px; padding: 6px;
  background: rgba(233,240,241,0.07);
  -webkit-backdrop-filter: blur(26px) saturate(180%); backdrop-filter: blur(26px) saturate(180%);
  box-shadow: inset 0 1px 0 rgba(190,198,199,0.4), 0 0 0 1px rgba(58,62,63,0.35),
    0 10px 22px -8px rgba(0,0,0,0.65); }
.scoutios[data-v="paper"] .iGlassBar { background: rgba(255,255,255,0.55);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 1px var(--i-hairline-strong),
    0 10px 22px -10px rgba(62,56,44,0.28); }
.iGlassTab { flex: 1; display: flex; justify-content: center; }
/* The seat HUGS its tab (Apple's shape) instead of filling the column, and it
   is the masthead complication's plate in capsule form. */
.iGlassSeat { display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 5px 12px; border-radius: 999px; color: var(--i-muted); }
.iGlassTab[data-on="true"] .iGlassSeat { color: var(--i-accent);
  background: linear-gradient(180deg, #131516, #0b0d0e);
  box-shadow: inset 0 1px 0 rgba(190,198,199,0.42), 0 0 0 1px rgba(58,62,63,0.35); }
.scoutios[data-v="paper"] .iGlassTab[data-on="true"] .iGlassSeat {
  background: linear-gradient(180deg, #fdfcfa, #efece4);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 1px var(--i-hairline-strong); }
.iGlassLabel { font-size: var(--text-2xs); font-weight: 500; font-family: var(--i-mono); letter-spacing: 0.02em; }
/* entry masthead — places leads, the host chip sits beside it, gear trails
   (no wordmark: the front door's row carries only what you'd act on) */
.iMastEntry { justify-content: flex-start; position: relative; }
.iMastGap { flex: 1 1 auto; }
/* Host chip — an indicator, not a filter: which Mac you're steering. Crisp
   plate + hairline, never a stadium (the chrome is plates and hairlines). */
.iHostChip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
  border-radius: 5px; font-family: var(--i-mono); font-size: var(--text-xs); font-weight: 500;
  color: var(--i-muted); background: var(--i-surface);
  border: 1px solid var(--i-hairline-strong); }
.iHostDot { width: 5px; height: 5px; border-radius: 999px; background: var(--i-accent); }
/* Masthead complication family — places leading, gear trailing, both cut from
   the crown study's machined plate at the crown's own SEAT scale (36px), so
   the top row reads as instruments rather than outlined icons. Calmer than the
   crown only where the masthead demands it: one contact shadow instead of the
   crown's floating pair. Never the accent (the crown study banned green on
   complications). The bottom glass bar seats its current tab on this same
   plate — that pairing is what makes top-left and bottom one system. */
.iComplication { width: 36px; height: 36px; border-radius: 999px; display: grid;
  place-items: center; color: var(--i-muted);
  background: linear-gradient(180deg, #131516, #0b0d0e);
  box-shadow: inset 0 1px 0 rgba(190,198,199,0.34), 0 0 0 1px rgba(58,62,63,0.35),
    0 1.5px 3px rgba(0,0,0,0.45); }
.scoutios[data-v="paper"] .iComplication { background: linear-gradient(180deg, #fdfcfa, #efece4);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 0 0 1px var(--i-hairline-strong),
    0 1.5px 3px rgba(62,56,44,0.16); }
/* Places sheet — the map the disc opens: every important destination with the
   one line that says what you'd do there. Rows only, no tiles: a name and a
   verb read faster than a grid of glyphs. */
.iPlacesScrim { position: absolute; inset: 0; z-index: 5; display: flex;
  align-items: flex-end; background: rgba(3,4,3,0.5); }
.iPlacesSheet { width: 100%; max-height: 68%; overflow: auto; padding: 8px 14px 20px;
  border-radius: 14px 14px 0 0; background: var(--i-bg);
  border-top: 1px solid var(--i-hairline-strong); }
.iPlacesGrab { width: 36px; height: 4px; border-radius: 2px; margin: 0 auto 10px;
  background: var(--i-hairline-strong); }
.iPlacesTitle { text-align: center; font-size: var(--text-2xl); font-weight: 600; color: var(--i-ink);
  padding-bottom: 10px; }
.iPlacesList { display: flex; flex-direction: column; }
.iPlaceRow { display: flex; align-items: center; gap: 14px; padding: 12px 0;
  border-bottom: 1px solid var(--i-hairline); }
.iPlaceRow:last-child { border-bottom: 0; }
.iPlaceGlyph { flex: none; width: 34px; height: 34px; border-radius: 999px; display: grid;
  place-items: center; color: var(--i-muted); background: var(--i-surface);
  border: 1px solid var(--i-hairline); }
.iPlaceText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.iPlaceName { font-size: var(--text-xl); font-weight: 500; color: var(--i-ink); }
.iPlaceBlurb { font-size: var(--text-md); color: var(--i-dim); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.iPlaceCaret { flex: none; color: var(--i-dim); }
/* accessory line — OUR line where the system QuickType strip used to be.
   The composer declares predictions:false, so the system bar is gone; this
   row takes its place. Smart-action PILLS scroll on the left (fading out
   before the pinned slot so nothing clips raw), the keyboard TOGGLE is
   pinned right behind a hairline. Persistent in both keyboard states — it is
   how the keyboard comes back. One left rail: the first pill starts where
   the composer's draft line and attach control do (14px). */
.iAcc { flex: none; display: flex; align-items: center; height: 44px;
  padding: 0 14px; border-top: 1px solid var(--i-hairline); }
.iAccScroll { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 86%, transparent 100%);
  mask-image: linear-gradient(90deg, #000 0, #000 86%, transparent 100%); }
.iAccScroll::-webkit-scrollbar { display: none; }
.iAccPills { display: flex; align-items: center; gap: 8px; padding-left: 14px; padding-right: 8px; }
.iAccPill { flex: none; height: 28px; display: inline-flex; align-items: center;
  padding: 0 14px; border-radius: 999px; white-space: nowrap;
  font-size: var(--text-md); font-weight: 500; color: var(--i-muted);
  background: var(--i-card-top); border: 1px solid var(--i-hairline); }
.iAccToggle { flex: none; width: 44px; height: 44px; display: grid; place-items: center;
  color: var(--i-muted); border-left: 1px solid var(--i-hairline-strong); }

/* keyboard slab — realistic iOS geometry: uniform flexing letter keys,
   half-key indent on the home row, wide shift/delete with the double gap,
   123 · space · return base. The entry's resting state is keyboard-up
   (messenger posture); the slab owns the home-indicator safe area while
   raised, and it COVERS the tab bar (standard iOS) rather than pushing it up
   a row. */
.iKb { flex: none; margin-top: 2px; padding: 0 3px 18px; background: var(--i-chrome);
  border-top: 1px solid var(--i-hairline); display: flex; flex-direction: column; gap: 10px; }
.iKb > .iKbRow:first-child { margin-top: 8px; }
.iKbRow { display: flex; gap: 6px; padding: 0 3px; }
.iKbRow.indent { padding: 0 22px; }
.iKey { flex: 1 1 0; min-width: 0; height: 42px; display: grid; place-items: center;
  border-radius: 5.5px; font-size: var(--text-3xl); color: var(--i-ink); font-family: var(--i-font);
  background: linear-gradient(180deg, color-mix(in oklab, #fff 6%, var(--i-surface)), var(--i-surface));
  border: 1px solid var(--i-hairline-strong); box-shadow: 0 1px 0 rgba(0,0,0,0.4); }
.iKeyMod { background: var(--i-bg); color: var(--i-muted); font-size: var(--text-xl); }
.iKeyShift, .iKeyBksp { flex: 0 0 45px; }
.iKeyShift { margin-right: 6px; }
.iKeyBksp { margin-left: 6px; }
.iKey123 { flex: 0 0 88px; font-size: var(--text-md); }
.iKeySpace { flex: 1 1 auto; font-size: var(--text-md); color: var(--i-muted); }
.iKeyGo { flex: 0 0 88px; font-size: var(--text-md); font-weight: 600;
  background: var(--i-accent); color: #04130d; border-color: var(--i-accent); }
.scoutios[data-v="paper"] .iKey { background: #fdfcfa; border-color: var(--i-hairline-strong);
  box-shadow: 0 1px 0 rgba(62,56,44,0.28); }
.scoutios[data-v="paper"] .iKeyMod { background: #e6e3dc; }
.scoutios[data-v="paper"] .iKeySpace { background: #fdfcfa; }
.scoutios[data-v="paper"] .iKeyGo { background: linear-gradient(180deg, var(--i-accent-2), var(--i-accent));
  color: #04130d; border-color: var(--i-accent); box-shadow: 0 1px 0 rgba(62,56,44,0.2); }

/* ── Tablet frame (wide exhibit) ───────────────────────────────────────── */
/* iPad landscape-ish stage for responsive treatments — same palette wash. */
.iPad { width: 100%; max-width: 1060px; border-radius: 34px; padding: 10px;
  background: #000; border: 1px solid #2a2a2a;
  box-shadow: 0 30px 70px -28px rgba(0,0,0,0.85); }
.iPadScreen { position: relative; height: 820px; border-radius: 24px; overflow: hidden;
  font-family: var(--i-font); color: var(--i-ink); display: flex; flex-direction: column;
  background:
    radial-gradient(130% 55% at 50% 0%, var(--i-keylight), rgba(255,255,255,0) 62%),
    linear-gradient(180deg, var(--i-wash-top) 0%, var(--i-bg) 36%, var(--i-wash-bottom) 100%); }
.iPadScreen .iStatus { height: 34px; padding: 0 20px; font-size: var(--text-md); }
.iPadScreen .iBody { padding: 0 20px 10px; }

/* ── Token board ─────────────────────────────────────────────────────── */
.iBoardGroup { margin-bottom: 16px; }
.iBoardLabel { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: #7a7f88; margin-bottom: 8px; }
.iSwatchRow { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.iSwatch { width: 26px; height: 26px; border-radius: 6px; flex: none;
  border: 1px solid rgba(255,255,255,0.12); }
.iSwName { font-size: var(--text-md); color: #d8dbe0; width: 118px; }
.iSwHex { font-family: var(--i-mono); font-size: var(--text-sm); color: #9aa0aa; }
.iSwRatio { font-family: var(--i-mono); font-size: var(--text-xs); margin-left: auto; }

/* ── Treatment overrides (driven by data-* on .scoutios) ───────────────── */
/* Compact density — tighten list rows + section headers (Home / Agents). */
.scoutios[data-density="compact"] .iSec { padding: 7px 4px 4px; }
.scoutios[data-density="compact"] .iField { margin: 5px 0 2px; padding: 6px 11px; }
.scoutios[data-density="compact"] .iRow { padding-top: 6px; padding-bottom: 6px; }
.scoutios[data-density="compact"] .iLeafRow { padding-top: 5px; padding-bottom: 5px; }
.scoutios[data-density="compact"] .iActRow { padding-top: 5px; padding-bottom: 5px; }
.scoutios[data-density="compact"] .iCommsRow { padding-top: 8px; padding-bottom: 8px; }
.scoutios[data-density="compact"] .iRail { padding-top: 2px; }
.scoutios[data-density="compact"] .iNeedHead { padding: 6px 4px 4px; }
.scoutios[data-density="compact"] .iNeedRow { padding-top: 8px; padding-bottom: 8px; }
.scoutios[data-density="compact"] .iWorkCard { padding: 8px; }

/* Hairline list — Comms as a continuous list (vs today's tint-per-unread). */
.scoutios[data-layout="hairline"] .iCommsRow { padding: 9px 6px; }
.scoutios[data-layout="hairline"] .iCommsRow.unread { background: transparent; }
.scoutios[data-layout="hairline"] .iCommsRail { display: none; }
.scoutios[data-layout="hairline"] .iCommsName.unread { font-weight: 700; }
.scoutios[data-layout="hairline"] .iCommsSep { margin-left: 0; }
/* Hairline stream — Tail as a flat feed (vs inset cards). */
.scoutios[data-layout="hairline"] .iEv { background: transparent; border: none;
  border-radius: 0; border-bottom: 1px solid var(--i-hairline); margin-bottom: 0; padding: 9px 4px; }

/* ── Detail / pushed header (Conversation · Connect · Settings) ─────────── */
.iDetailHead { flex: none; display: flex; align-items: center; gap: 10px;
  padding: 9px 14px; border-bottom: 1px solid var(--i-hairline-strong); position: relative; z-index: 2; }
.iBackBtn { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: var(--i-surface); color: var(--i-muted); border: 1px solid var(--i-hairline-strong); }
.iDetailTitleBlock { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.iDetailTitleRow { display: flex; align-items: center; gap: 7px; }
.iDetailTitle { font-size: var(--text-2xl); font-weight: 600; color: var(--i-ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iDetailSub { font-size: var(--text-sm); color: var(--i-muted); font-family: var(--i-mono); }
.iGearSm { width: 28px; height: 28px; }
.iStreamBadge { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-3xs); font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; font-family: var(--i-mono); color: var(--i-accent);
  padding: 2px 6px; border-radius: 999px; background: var(--i-accent-soft); }

/* ── Conversation transcript ───────────────────────────────────────────── */
.iConv { padding-top: 4px; }
.iTurn { margin-bottom: 12px; }
.iTurnLabel { display: flex; align-items: center; gap: 6px; margin: 10px 0 6px; }
.iTurnLabel span:not(.iDot) { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.15em; font-family: var(--i-mono); }
.iTurnLabel[data-role="user"] span:not(.iDot) { color: var(--i-muted); }
.iTurnLabel[data-role="agent"] span:not(.iDot) { color: var(--i-accent); }
.iMsg { font-size: var(--text-lg); line-height: 1.5; color: var(--i-ink); padding: 9px 12px; border-radius: 12px;
  background: linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 5%, var(--i-surface)), var(--i-surface));
  border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 0 var(--i-keylight), 0 1px 2px rgba(0,0,0,0.18); margin-bottom: 6px; }
.iMdP + .iMdP, .iMdLi { margin-top: 3px; }
.iMsg strong { color: var(--i-ink); font-weight: 700; }
.iReason { font-size: var(--text-md); font-style: italic; color: var(--i-muted); line-height: 1.5;
  border-left: 2px solid var(--i-hairline-strong); padding: 2px 0 2px 10px; margin: 0 0 6px 2px; }
.iAct { border-radius: 12px;
  background: linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 5%, var(--i-surface)), var(--i-surface));
  border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 0 var(--i-keylight), 0 1px 2px rgba(0,0,0,0.18);
  padding: 9px 11px; margin-bottom: 6px; }
.iActHead { display: flex; align-items: center; gap: 7px; }
.iActIcon { color: var(--i-muted); flex: none; display: grid; place-items: center; }
.iActTitle { font-size: var(--text-sm); font-weight: 600; font-family: var(--i-mono); color: var(--i-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iActStatus { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  font-family: var(--i-mono); flex: none; }
.iActStatus[data-s="ok"] { color: var(--i-ok); }
.iActStatus[data-s="error"] { color: var(--i-error); }
.iActStatus[data-s="running"] { color: var(--i-accent); }
.iActOut { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-muted); margin-top: 6px;
  line-height: 1.4; white-space: pre-wrap; }
.iApproval { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--i-hairline); }
.iApprovalDesc { font-size: var(--text-sm); color: var(--i-muted); line-height: 1.45; }
.iApprovalRow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.iRiskBadge { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  font-family: var(--i-mono); padding: 2px 6px; border-radius: 999px; }
.iRiskBadge[data-r="low"] { color: var(--i-ok); background: color-mix(in oklab, var(--i-ok) 14%, transparent); }
.iRiskBadge[data-r="med"] { color: var(--i-warn); background: color-mix(in oklab, var(--i-warn) 16%, transparent); }
.iRiskBadge[data-r="high"] { color: var(--i-error); background: color-mix(in oklab, var(--i-error) 16%, transparent); }
.iBtn { font-size: var(--text-md); font-weight: 600; padding: 6px 14px; border-radius: 9px; border: 1px solid transparent;
  cursor: pointer; font-family: var(--i-font); }
.iBtnDeny { background: transparent; color: var(--i-muted); border-color: var(--i-hairline-strong); }
.iBtnApprove { background: var(--i-accent); color: #04130d; }
.iQuestion { border-radius: 12px; padding: 10px 12px; margin-bottom: 6px;
  background: color-mix(in oklab, var(--i-warn) 8%, var(--i-surface));
  border: 1px solid color-mix(in oklab, var(--i-warn) 30%, transparent); }
.iQHead { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.12em; font-family: var(--i-mono); color: var(--i-warn); }
.iQText { font-size: var(--text-lg); color: var(--i-ink); margin: 6px 0 9px; line-height: 1.4; }
.iQOpts { display: flex; gap: 7px; }
.iQOpt { font-size: var(--text-md); font-weight: 600; padding: 6px 14px; border-radius: 9px; cursor: pointer;
  background: var(--i-warn); color: #1a1205; border: none; }
.iQOpt.on { background: var(--i-surface); color: var(--i-muted); border: 1px solid var(--i-hairline-strong); }
/* Composer dock — lifts off the transcript: a top keylight edge + a soft
   upward shadow read it as the input layer, not just a bordered strip. */
.iComposer { flex: none; display: flex; align-items: center; gap: 9px; padding: 9px 12px 16px;
  border-top: 1px solid var(--i-hairline-strong);
  background: linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 3%, var(--i-chrome)), var(--i-chrome));
  box-shadow: inset 0 1px 0 var(--i-keylight), 0 -10px 20px -14px rgba(0,0,0,0.7);
  position: relative; z-index: 2; }
/* Mic / send share a tactile button face: subtle top-lit fill + keylight edge. */
.iMic { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 6%, var(--i-surface)), var(--i-surface));
  color: var(--i-muted); border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 0 var(--i-keylight); }
/* Field is a recessed well (inner shadow); focus lights an accent ring. */
.iComposerField { flex: 1; font-size: var(--text-lg); color: var(--i-dim); padding: 9px 13px; border-radius: 11px;
  background: var(--i-bg); border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.32);
  transition: border-color 0.13s, box-shadow 0.13s, color 0.13s; }
.iComposerField.focus { color: var(--i-ink);
  border-color: color-mix(in oklab, var(--i-accent) 55%, transparent);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.28), 0 0 0 3px color-mix(in oklab, var(--i-accent) 13%, transparent); }
.iComposerCaret { display: inline-block; width: 2px; height: 15px; vertical-align: -3px; margin-left: 1px;
  background: var(--i-accent); animation: iBlink 1.2s ease-in-out infinite; }
.iSend { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 6%, var(--i-surface)), var(--i-surface));
  color: var(--i-dim); border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 0 var(--i-keylight);
  transition: background 0.13s, color 0.13s, border-color 0.13s, box-shadow 0.13s; }
/* Armed — a draft is present: the send becomes a lit accent pill. */
.iSend.armed { background: linear-gradient(180deg, var(--i-accent-2), var(--i-accent));
  color: #04130d; border-color: color-mix(in oklab, var(--i-accent) 60%, #000);
  box-shadow: inset 0 1px 0 color-mix(in oklab, #fff 22%, transparent),
    0 2px 9px color-mix(in oklab, var(--i-accent) 32%, transparent); }

/* ── Terminal ──────────────────────────────────────────────────────────── */
.iTermHead { display: flex; align-items: center; gap: 8px; }
.iTermGlyph { color: var(--i-ok); flex: none; }
.iTermTitle { font-size: var(--text-2xl); font-weight: 600; color: var(--i-ink); }
.iTermEndpoint { font-size: var(--text-sm); color: var(--i-muted); font-family: var(--i-mono); }
.iTermBody { display: flex; flex-direction: column; padding: 8px 10px 6px; }
.iTermScreen { flex: 1; overflow: hidden; border-radius: 12px; background: #050505;
  border: 1px solid var(--i-hairline-strong); padding: 11px 12px; font-family: var(--i-mono);
  font-size: var(--text-sm); line-height: 1.6; }
.iTermLine { white-space: pre-wrap; word-break: break-all; color: var(--i-ink); }
.iTermLine-out { color: var(--i-muted); }
.iTermLine-dim { color: var(--i-dim); }
.iTermSigil { color: var(--i-ok); }
.iTermCursor { display: inline-block; width: 7px; height: 14px; vertical-align: -2px;
  background: var(--i-ok); animation: iBlink 1.1s steps(1) infinite; }
.iTermTray { flex: none; display: flex; align-items: center; gap: 6px; padding: 9px 2px 4px; overflow: hidden; }
.iTermKey { font-size: var(--text-sm); font-family: var(--i-mono); color: var(--i-muted); padding: 5px 9px;
  border-radius: 7px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); flex: none; }
.iTermMic { color: var(--i-accent); }
.iTermStatusPanel { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; text-align: center; padding: 0 30px; }
.iTermStatusSpin { font-size: var(--text-5xl); }
.iTermStatusTitle { font-size: var(--text-2xl); font-weight: 600; color: var(--i-ink); }
.iTermStatusSub { font-size: var(--text-md); color: var(--i-muted); line-height: 1.4; }

/* ── New Session ───────────────────────────────────────────────────────── */
.iNew { padding-top: 4px; }
.iNewSection { margin-bottom: 14px; }
.iNewLabel { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-muted); padding: 8px 2px 6px; }
.iNewCard { border-radius: 14px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); padding: 12px; }
.iNewProject { display: flex; align-items: center; gap: 11px; }
.iNewProjText { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.iNewProjName { font-size: var(--text-xl); font-weight: 500; color: var(--i-ink); }
.iNewProjPath { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim); }
.iNewAgent { display: flex; align-items: center; gap: 9px; }
.iChoice { font-size: var(--text-lg); font-weight: 500; color: var(--i-ink); display: inline-flex; align-items: center; gap: 4px; }
.iCaret2 { color: var(--i-dim); font-size: var(--text-md); }
.iNewDot { color: var(--i-dim); }
.iTargetTok { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-sm); font-family: var(--i-mono);
  color: var(--i-muted); padding: 4px 9px; border-radius: 999px; background: var(--i-bg); border: 1px solid var(--i-hairline); }
.iNewPrompt { position: relative; min-height: 96px; }
.iNewPromptText { font-size: var(--text-lg); line-height: 1.5; color: var(--i-ink); font-family: var(--i-mono); padding-right: 44px; }
.iMicFloat { position: absolute; right: 10px; bottom: 10px; width: 38px; height: 38px; }
.iResultCard { border-radius: 14px; padding: 12px; background: color-mix(in oklab, var(--i-ok) 8%, var(--i-surface));
  border: 1px solid color-mix(in oklab, var(--i-ok) 28%, transparent); }
.iResultHead { display: flex; align-items: center; gap: 7px; font-size: var(--text-lg); font-weight: 600; color: var(--i-ink); margin-bottom: 8px; }
.iResultRow { display: flex; align-items: baseline; gap: 10px; padding: 2px 0; }
.iResultKey { font-size: var(--text-2xs); font-family: var(--i-mono); color: var(--i-dim); text-transform: uppercase;
  letter-spacing: 0.06em; width: 92px; flex: none; }
.iResultVal { font-size: var(--text-md); font-family: var(--i-mono); color: var(--i-ink); }
.iNewFooter { flex: none; padding: 8px 14px 16px; border-top: 1px solid var(--i-hairline-strong);
  background: var(--i-chrome); position: relative; z-index: 2; }
.iStartBtn { width: 100%; font-size: var(--text-xl); font-weight: 600; padding: 12px; border-radius: 12px;
  background: var(--i-accent); color: #04130d; border: none; cursor: pointer; }

/* ── New session · DESTINATION picker ───────────────────────────────────── */
/* Which Mac the work lands on, and which project it runs in — the two
   decisions that gate Start, on a phone, above a composer.
   THE CONSTRAINT: the composer is a filled rounded PILL. Nothing else on this
   screen may be a filled rounded box, or the eye cannot tell which one you type
   the task into. So every treatment here builds structure out of hairlines,
   eyebrows and flat rows — Instrument language — and the only rounded filled
   thing on the glass is the composer. The one exception is treatment 3's search
   field, which is a real HudField (.iField) and is legal precisely because it
   only exists while the composer is off-screen behind a sheet. */

/* the surface column: body scrolls, dock is pinned */
.iDest { height: 100%; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.iDestScroll { flex: 1; min-height: 0; overflow: hidden; }

/* eyebrow — the Instrument label. Mono caps micro, dim, generously tracked. */
.iDestEyebrow { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--i-dim); flex: none; }
.iDestRule { height: 1px; background: var(--i-hairline-strong); flex: none; }
.iDestRule[data-soft] { background: var(--i-hairline); }

/* HOST — one Mac is a readout, several are plates. Never a stadium. */
.iDestHost { display: flex; align-items: center; gap: 12px; min-height: 34px;
  padding: 4px 0 8px; }
.iDestHostRead { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.iDestHostName { font-size: var(--text-lg); font-weight: 500; color: var(--i-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iDestHostTag { font-family: var(--i-mono); font-size: var(--text-3xs); font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--i-dim); flex: none; }
.iDestHostChips { display: flex; align-items: center; gap: 6px; min-width: 0;
  overflow-x: auto; scrollbar-width: none; }
.iDestHostChips::-webkit-scrollbar { display: none; }
.iDestHostChip { flex: none; display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 9px; border-radius: 5px; cursor: pointer;
  font-family: var(--i-mono); font-size: var(--text-xs); font-weight: 500;
  color: var(--i-dim); background: var(--i-bg); border: 1px solid var(--i-hairline); }
.iDestHostChip[data-on] { color: var(--i-ink); background: var(--i-surface);
  border-color: var(--i-border); }
.iDestHostChip[data-off] { opacity: 0.55; cursor: default; }

/* QUERY — a bare line on a rule, NOT a field. A glyph, the text you type, and
   the count of what is left. It has no box of its own, so it can never be
   mistaken for the pill at the foot of the screen. */
.iDestQuery { display: flex; align-items: center; gap: 11px; height: 44px; flex: none; }
.iDestQuery > svg { color: var(--i-dim); flex: none; }
.iDestQuery input { flex: 1; min-width: 0; background: none; border: none; outline: none;
  padding: 0; font-family: var(--i-font); font-size: var(--text-lg); color: var(--i-ink); }
.iDestQuery input::placeholder { color: var(--i-dim); }
.iDestQueryCount { font-family: var(--i-mono); font-size: var(--text-xs); color: var(--i-dim);
  font-variant-numeric: tabular-nums; flex: none; }
.iDestQueryClear { flex: none; width: 28px; height: 28px; display: grid; place-items: center;
  color: var(--i-dim); background: none; border: none; cursor: pointer;
  font-family: var(--i-mono); font-size: var(--text-lg); }

/* BAND / GROUP heads — the structure hairlines carry */
.iDestBand { display: flex; align-items: center; gap: 8px; padding: 13px 0 6px; flex: none; }
.iDestBandRule { flex: 1; height: 1px; background: var(--i-hairline); }
.iDestGroup { display: flex; align-items: center; gap: 8px; padding: 12px 0 4px; }
.iDestGroupPath { font-family: var(--i-mono); font-size: var(--text-xs); color: var(--i-dim);
  letter-spacing: 0.02em; }
.iDestGroupCount { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim);
  font-variant-numeric: tabular-nums; margin-left: auto; }

/* ONE PROJECT — a flat full-width row, which is the one shape the house rules
   let an edge marker sit on. The travelling 2px bar is the pick. */
.iDestRow { display: flex; align-items: center; gap: 11px; min-height: 44px;
  padding: 0 2px 0 14px; position: relative; cursor: pointer; width: 100%;
  background: none; border: none; text-align: left; font-family: var(--i-font); }
.iDestRow::before { content: ""; position: absolute; left: 0; top: 50%;
  transform: translateY(-50%); width: 2px; height: 18px; border-radius: 999px;
  background: transparent; }
.iDestRow[data-on]::before { background: var(--i-accent); }
.iDestMark { flex: none; width: 15px; display: grid; place-items: center; color: var(--i-dim); }
.iDestRow[data-on] .iDestMark { color: var(--i-accent); }
.iDestName { font-size: var(--text-lg); font-weight: 500; color: var(--i-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iDestRow[data-on] .iDestName { font-weight: 600; color: var(--i-ink); }
.iDestSpacer { flex: 1; min-width: 10px; }
.iDestMeta { font-family: var(--i-mono); font-size: var(--text-xs); color: var(--i-dim); flex: none;
  font-variant-numeric: tabular-nums; }
.iDestMeta[data-live] { color: var(--i-accent); }
/* The head is cut in JS (see tailPath): CSS can only ellipsize the tail, and
   the direction:rtl trick that fakes a head-cut reorders the neutrals —
   "~/dev" renders as "dev/~". */
.iDestTail { font-family: var(--i-mono); font-size: var(--text-xs); color: var(--i-dim); flex: none;
  max-width: 132px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the path escape hatch — a query that IS a path no workspace answers */
.iDestUse { font-family: var(--i-mono); font-size: var(--text-3xs); font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--i-accent); flex: none; }

.iDestNotice { font-family: var(--i-mono); font-size: var(--text-sm); line-height: 1.6;
  color: var(--i-dim); padding: 22px 14px 0; max-width: 300px; }
.iDestNotice b { color: var(--i-muted); font-weight: 600; }

/* ── Treatment 2 · READOUT ──────────────────────────────────────────────── */
/* The destination is ONE line above the composer, and that same line is the
   search field — so there is never a second box competing with the pill. While
   the line holds the keyboard the composer visibly stands down. */
.iDestReadout { display: flex; align-items: center; gap: 10px; height: 44px; flex: none;
  padding: 0 14px; border-top: 1px solid var(--i-hairline-strong); cursor: text;
  background: none; border-left: none; border-right: none; border-bottom: none;
  width: 100%; text-align: left; font-family: var(--i-font); }
.iDestReadoutCaret { flex: none; font-family: var(--i-mono); font-size: var(--text-sm);
  color: var(--i-dim); }
.iDestReadout[data-live] .iDestReadoutCaret { color: var(--i-accent); }
.iDestReadoutText { flex: 1; min-width: 0; font-family: var(--i-mono); font-size: var(--text-md);
  color: var(--i-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iDestReadoutText em { font-style: normal; color: var(--i-dim); }
.iDestReadout[data-live] .iDestReadoutText { color: var(--i-ink); }
.iDestReadout input { flex: 1; min-width: 0; background: none; border: none; outline: none;
  padding: 0; font-family: var(--i-mono); font-size: var(--text-md); color: var(--i-ink); }
.iDestReadout input::placeholder { color: var(--i-dim); }
.iDestReadoutHint { flex: none; font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--i-dim); }
/* results rise BETWEEN the line and the composer, freshest match first */
.iDestResults { flex: none; max-height: 232px; overflow: hidden;
  border-top: 1px solid var(--i-hairline); }
.iDestResults .iDestRow { min-height: 40px; padding-left: 14px; }
.iDestResultsFoot { font-family: var(--i-mono); font-size: var(--text-2xs); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--i-dim); padding: 7px 14px 3px; }
/* the composer stands down while the line is live — one live field, always */
.iDestStandby { opacity: 0.34; pointer-events: none; filter: saturate(0.35); }

/* ── Treatment 3 · SHEET ────────────────────────────────────────────────── */
/* The destination rides in the composer's own header slot — an attribute OF the
   message, not a control beside it — and opens a page that owns the screen. */
.iDestHeaderLine { display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 0 2px 2px; background: none; border: none; cursor: pointer;
  font-family: var(--i-mono); font-size: var(--text-sm); color: var(--i-muted); text-align: left; }
.iDestHeaderLine .iDot, .iDestHeaderLine .iRing { flex: none; }
.iDestHeaderPath { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.iDestHeaderPath em { font-style: normal; color: var(--i-dim); }
.iDestHeaderChev { flex: none; color: var(--i-dim); display: flex; }
.iDestRest { flex: 1; min-height: 0; display: flex; flex-direction: column;
  justify-content: flex-end; }
.iDestRecents { flex: none; padding-bottom: 4px; }
.iDestRecentsHead { display: flex; align-items: center; gap: 8px; padding: 0 2px 4px; }

/* the picker page — a sheet that owns the screen, so the search control can be
   a real field (.iField) without a pill anywhere near it */
.iDestSheetScrim { position: absolute; inset: 0; z-index: 6; display: flex;
  align-items: flex-end; background: rgba(3,4,3,0.55); }
.scoutios[data-v="paper"] .iDestSheetScrim { background: rgba(62,56,44,0.28); }
/* keyboard up: the sheet gives the keyboard its half and keeps the rest */
.iDestSheetScrim[data-kb] { bottom: 226px; }
.iDestSheetScrim[data-kb] .iDestSheet { height: 100%; }
.iDestSheet { width: 100%; height: 88%; display: flex; flex-direction: column;
  padding: 8px 14px 0; border-radius: 16px 16px 0 0; background: var(--i-bg);
  border-top: 1px solid var(--i-hairline-strong); }
.iDestSheetGrab { width: 36px; height: 4px; border-radius: 2px; margin: 0 auto 8px;
  background: var(--i-hairline-strong); flex: none; }
.iDestSheetHead { display: flex; align-items: baseline; gap: 9px; padding: 2px 0 8px; flex: none; }
.iDestSheetTitle { font-size: var(--text-2xl); font-weight: 600; color: var(--i-ink); }
.iDestSheetSub { font-family: var(--i-mono); font-size: var(--text-xs); color: var(--i-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iDestSheetDone { margin-left: auto; font-size: var(--text-lg); font-weight: 600; color: var(--i-accent);
  background: none; border: none; cursor: pointer; font-family: var(--i-font); }
.iDestSheetHost { display: flex; align-items: center; gap: 10px; padding: 2px 0 9px; flex: none; }
.iDestSheet .iField { margin: 0 0 2px; flex: none; }
.iDestSheet .iField input { flex: 1; min-width: 0; background: none; border: none; outline: none;
  padding: 0; font-family: var(--i-font); font-size: var(--text-lg); color: var(--i-ink); }
.iDestSheet .iField input::placeholder { color: var(--i-dim); }
.iDestSheetList { flex: 1; min-height: 0; overflow: hidden; }

/* ── Treatment 4 · CALM — the Home-shaped front door ────────────────────── */
/* Same room as the Entry home, different furniture. Air on top, ONE quiet lane
   hugging the composer, the composer docked, the keyboard toggle on its own
   thin line BELOW it. The lane is the two decisions that gate Start — host,
   then project — three rows deep, not thirty. */
.iCalm { display: flex; flex-direction: column; padding-bottom: 0; }
/* The air IS the design: it absorbs whatever the lane doesn't need, so a short
   list hugs the composer and a grown one simply takes the room. */
.iCalmAir { flex: 1 1 auto; min-height: 0; }
.iCalmSection { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; }
.iCalm[data-grown] .iCalmSection { flex: 1 1 auto; }

/* ① HOST — one line, and in the common case (one Mac) that is all it costs.
   No eyebrow row of its own, no rule above it, no band. */
.iCalmHost { display: flex; align-items: center; gap: 8px; height: 30px; flex: none; padding: 0 2px; }
.iCalmLabel { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--i-dim); flex: none;
  width: 46px; }
.iCalmHostName { font-size: var(--text-lg); font-weight: 500; color: var(--i-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iCalmHostName[data-none] { color: var(--i-dim); }
.iCalmHostChips { display: flex; align-items: center; gap: 6px; min-width: 0;
  overflow-x: auto; scrollbar-width: none; }
.iCalmHostChips::-webkit-scrollbar { display: none; }
.iCalmRule { height: 1px; background: var(--i-hairline); flex: none; margin: 2px 0 0; }

/* the bare query line — never a box, so the pill below stays the only pill */
.iCalmQuery { display: flex; align-items: center; gap: 10px; height: 40px; flex: none;
  padding: 0 2px; }
.iCalmQuery > svg { color: var(--i-dim); flex: none; }
.iCalmQuery input { flex: 1; min-width: 0; background: none; border: none; outline: none;
  padding: 0; font-family: var(--i-font); font-size: var(--text-lg); color: var(--i-ink); }
.iCalmQuery input::placeholder { color: var(--i-dim); }

/* ② PROJECT — three rows. The name holds a floor width and the PATH is the
   side that gives: it shrinks, truncates from the head, and at the tightest
   disappears. On the shipped surface the two collided outright. */
.iCalmList { flex: 0 1 auto; min-height: 0; overflow: hidden; }
.iCalm[data-grown] .iCalmList { flex: 1 1 auto; }
.iCalmRow { display: flex; align-items: center; gap: 11px; height: 38px; width: 100%;
  padding: 0 2px 0 14px; position: relative; cursor: pointer;
  background: none; border: none; text-align: left; font-family: var(--i-font); }
.iCalmRow::before { content: ""; position: absolute; left: 0; top: 50%;
  transform: translateY(-50%); width: 2px; height: 16px; border-radius: 999px;
  background: transparent; }
.iCalmRow[data-on]::before { background: var(--i-accent); }
.iCalmMark { flex: none; width: 15px; display: grid; place-items: center; color: var(--i-dim); }
.iCalmRow[data-on] .iCalmMark { color: var(--i-accent); }
.iCalmName { flex: 1 1 auto; min-width: 84px; font-size: var(--text-lg); font-weight: 500;
  color: var(--i-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iCalmRow[data-on] .iCalmName { font-weight: 600; color: var(--i-ink); }
.iCalmPath { flex: 0 1 auto; min-width: 0; margin-left: auto; padding-left: 12px;
  font-family: var(--i-mono); font-size: var(--text-xs); color: var(--i-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 44%; }
/* what a demoted row IS, said once on the row rather than inferred from a path */
.iCalmKind { flex: none; font-family: var(--i-mono); font-size: var(--text-3xs); font-weight: 700;
  letter-spacing: 0.09em; text-transform: uppercase; color: var(--i-dim);
  padding: 1px 5px; border-radius: 3px; border: 1px solid var(--i-hairline); }

/* the foot — the way to everything else, carrying the count so no eyebrow row
   has to, and naming what is being held back */
.iCalmMore { display: flex; align-items: center; gap: 8px; height: 34px; width: 100%;
  flex: none; padding: 0 2px 0 14px; cursor: pointer; background: none; border: none;
  border-top: 1px solid var(--i-hairline); text-align: left; font-family: var(--i-font); }
.iCalmMoreText { font-size: var(--text-md); font-weight: 500; color: var(--i-muted); flex: none; }
.iCalmMoreSub { flex: 1; min-width: 0; font-family: var(--i-mono); font-size: var(--text-2xs);
  color: var(--i-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iCalmMoreChev { flex: none; margin-left: auto; color: var(--i-dim); display: flex; }

/* the keyboard toggle line, BELOW the composer — the seat the operator drew.
   Nothing keeps it company: New has no honest smart actions to put beside it. */
/* Keyboard DOWN the bar owns the home-indicator safe area, the way the glass
   rail does on Home; keyboard UP the slab owns it instead, so the bar tightens
   to sit right on top of the keys. */
.iCalmKbBar { flex: none; display: flex; justify-content: flex-end; align-items: center;
  padding: 2px 16px 20px; }
.iCalmKbBar[data-kb] { padding-bottom: 2px; }
.iCalmKbToggle { display: grid; place-items: center; width: 34px; height: 28px;
  color: var(--i-dim); }

/* the picker PAGE (take · picker) — owns the screen, so its search can be a
   real field without a pill anywhere near it */
/* A page, not a sheet: it owns everything BELOW the status bar. The status bar
   is the one thing that never belongs to an app screen. */
.iCalmPageScrim { position: absolute; inset: 52px 0 0; z-index: 6; display: flex;
  align-items: stretch; background: var(--i-bg); }
.iCalmPageScrim[data-kb] { bottom: 226px; }
.iCalmPage { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 10px 14px 0; }
.iCalmPageHead { display: flex; align-items: baseline; gap: 9px; padding: 2px 0 8px; flex: none; }
.iCalmPageTitle { font-size: var(--text-2xl); font-weight: 600; color: var(--i-ink); }
.iCalmPageList { flex: 1; min-height: 0; overflow: hidden; }
.iCalmPageBand { display: flex; align-items: center; gap: 8px; padding: 14px 0 4px; }

/* ── Connect / route inspector + pairing ───────────────────────────────── */
.iConn { padding-top: 6px; padding-bottom: 24px; }
.iConnStatus { padding: 8px 2px 10px; }
.iConnStatusMain { display: flex; align-items: center; gap: 8px; font-size: var(--text-2xl); color: var(--i-ink); }
.iConnStatusMain strong { font-weight: 600; }
.iConnStatusSub { font-size: var(--text-sm); font-family: var(--i-mono); color: var(--i-muted); margin-top: 4px; padding-left: 14px; }
.iRouteLegend { display: flex; align-items: center; padding: 6px 2px 12px; }
.iRouteChip { font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.08em; font-family: var(--i-mono);
  color: var(--i-dim); padding: 4px 10px; border-radius: 7px; border: 1px solid var(--i-hairline-strong); }
.iRouteChip.on { color: var(--i-accent); border-color: color-mix(in oklab, var(--i-accent) 45%, transparent);
  background: var(--i-accent-soft); }
.iRouteArrow { color: var(--i-dim); padding: 0 7px; font-family: var(--i-mono); }
.iConnActions { display: flex; gap: 9px; padding: 4px 0 8px; }
.iBtnGhost { flex: 1; background: var(--i-surface); color: var(--i-ink); border: 1px solid var(--i-hairline-strong); }
.iBtnPrimary { flex: 1; background: var(--i-accent); color: #04130d; border: none; }
.iConnLogRow { display: flex; align-items: baseline; gap: 9px; padding: 7px 13px; font-family: var(--i-mono); }
.iConnRoute { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.06em; color: var(--i-dim); width: 30px; flex: none; }
.iConnEvent { font-size: var(--text-xs); font-weight: 600; width: 74px; flex: none; }
.iConnMsg { font-size: var(--text-xs); color: var(--i-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iPair { padding-top: 10px; padding-bottom: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.iPairInstruction { font-size: var(--text-lg); line-height: 1.5; color: var(--i-muted); text-align: center; padding: 4px 14px 0; }
.iPairFrame { position: relative; width: 232px; height: 232px; border-radius: 20px; margin-top: 4px;
  border: 1px solid color-mix(in oklab, var(--i-accent) 45%, transparent); overflow: hidden; background: var(--i-surface); }
.iPairQR { position: absolute; inset: 26px; border-radius: 6px;
  background-image: radial-gradient(var(--i-ink) 38%, transparent 40%); background-size: 13px 13px; opacity: 0.85; }
.iPairFinder { position: absolute; width: 44px; height: 44px; border: 4px solid var(--i-ink); border-radius: 9px;
  background: var(--i-surface); }
.iPairFinder.tl { top: 26px; left: 26px; }
.iPairFinder.tr { top: 26px; right: 26px; }
.iPairFinder.bl { bottom: 26px; left: 26px; }
.iPairPaste { width: auto; }
.iPairStatus { display: flex; align-items: center; font-size: var(--text-md); color: var(--i-muted); font-family: var(--i-mono); }

/* ── Settings inspector ────────────────────────────────────────────────── */
.iSet { padding-top: 8px; padding-bottom: 24px; }
.iSetTabs { display: flex; gap: 4px; overflow: hidden; padding: 0 0 12px; }
.iSetTab { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.06em; font-family: var(--i-mono);
  color: var(--i-dim); padding: 5px 9px; border-radius: 7px; cursor: pointer; flex: none; border: 1px solid transparent; }
.iSetTab.on { color: var(--i-accent); background: var(--i-accent-soft);
  border-color: color-mix(in oklab, var(--i-accent) 35%, transparent); }
.iSetSection { margin-bottom: 16px; }
.iSetRow { display: flex; align-items: center; gap: 9px; padding: 10px 13px; }
.iSetRowLabel { font-size: var(--text-lg); color: var(--i-ink); }
.iSetRowVal { font-size: var(--text-md); font-family: var(--i-mono); color: var(--i-muted); }
.iForget { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.06em; font-family: var(--i-mono);
  color: var(--i-error); margin-left: 9px; }
.iToggle { width: 38px; height: 22px; border-radius: 999px; background: var(--i-hairline-strong);
  position: relative; flex: none; transition: background 0.15s; }
.iToggle.on { background: var(--i-accent); }
.iToggleKnob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; transition: left 0.15s; }
.iToggle.on .iToggleKnob { left: 18px; }
.iDoneBtn { font-size: var(--text-lg); font-weight: 600; color: var(--i-accent); }
.iSetNote { font-size: var(--text-sm); line-height: 1.5; color: var(--i-dim); padding: 0 4px; }

/* ════ Treatment layers (additive — Source is never touched) ═════════════ */

/* Tail · Kind-tone — the KIND token becomes a crisp colored chip per type, so
   the firehose is scannable by kind (mirrors the macOS Tail tone vocabulary). */
.scoutios[data-tone="kind"] .iEvKind { padding: 1px 7px; border-radius: 999px; font-weight: 700;
  font-size: var(--text-3xs); letter-spacing: 0.05em; text-transform: uppercase; }
.scoutios[data-tone="kind"] .iEvKind[data-kind="tool"],
.scoutios[data-tone="kind"] .iEvKind[data-kind="toolResult"] {
  color: var(--i-warn); background: color-mix(in oklab, var(--i-warn) 16%, transparent); }
.scoutios[data-tone="kind"] .iEvKind[data-kind="assistant"] {
  color: var(--i-accent); background: var(--i-accent-soft); }
.scoutios[data-tone="kind"] .iEvKind[data-kind="user"] {
  color: var(--i-muted); background: color-mix(in oklab, var(--i-muted) 14%, transparent); }
.scoutios[data-tone="kind"] .iEvKind[data-kind="system"] {
  color: var(--i-info); background: color-mix(in oklab, var(--i-info) 16%, transparent); }

/* Comms · Marks — a geometric identity tile per row (DMs read as people). */
.iCommsMark { width: 25px; height: 25px; border-radius: 8px; flex: none; display: grid; place-items: center;
  font-size: var(--text-sm); font-weight: 700; font-family: var(--i-mono); color: var(--i-muted);
  background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }

/* Conversation · Compact — tighten blocks for a long session. */
.scoutios[data-density="compact"] .iConv .iTurn { margin-bottom: 8px; }
.scoutios[data-density="compact"] .iConv .iTurnLabel { margin: 6px 0 4px; }
.scoutios[data-density="compact"] .iMsg { padding: 7px 10px; margin-bottom: 4px; }
.scoutios[data-density="compact"] .iAct { padding: 7px 9px; margin-bottom: 4px; }
.scoutios[data-density="compact"] .iReason { margin-bottom: 4px; }
.scoutios[data-density="compact"] .iQuestion { padding: 8px 10px; margin-bottom: 4px; }

/* Conversation · Collapsed reasoning — fold each reasoning block to a chip. */
.iReasonChip { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-xs); font-family: var(--i-mono);
  color: var(--i-dim); padding: 3px 9px; border-radius: 999px; background: var(--i-surface);
  border: 1px solid var(--i-hairline-strong); margin: 0 0 6px 2px; }
.iReasonChipDot { width: 4px; height: 4px; border-radius: 50%; background: var(--i-dim); }
.iReasonChipCaret { color: var(--i-dim); font-family: var(--i-mono); }

/* ── Notifications destination (the ledger) ─────────────────────────────── */
/* Filter: Open (the triage queue) vs All (the history). A quiet inset track,
   the active segment lifted — the same plate language as the host chips, so it
   reads as a scope, not a set of buttons. */
.iLedFilter { display: flex; gap: 4px; padding: 8px 0 9px; }
.iLedFilterBtn { display: flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 6px;
  font-family: var(--i-mono); font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; cursor: pointer;
  background: var(--i-bg); color: var(--i-dim); border: 1px solid var(--i-hairline); }
.iLedFilterBtn[data-on] { background: var(--i-surface); color: var(--i-ink); border-color: var(--i-border); }
.iLedFilterCount { font-size: var(--text-2xs); font-weight: 700; color: var(--i-dim); }
.iLedFilterBtn[data-on] .iLedFilterCount { color: var(--i-accent); }

.iLedList { overflow: hidden; }
/* One entry. Open entries hold ink weight; settled ones recede a step so the
   queue leads and the history reads as a log underneath it. */
.iLedRow { display: flex; gap: 9px; padding: 11px 13px 12px; }
.iLedTick { width: 3px; border-radius: 2px; flex: none; margin: 2px 0 2px;
  background: var(--i-hairline); }
.iLedTick[data-unseen] { background: var(--i-accent); }
.iLedBody { flex: 1; min-width: 0; }
.iLedTop { display: flex; align-items: baseline; gap: 7px; }
.iLedKind { font-size: var(--text-3xs); font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iLedRow[data-open] .iLedKind { color: var(--i-muted); }
.iLedSession { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iLedAge { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim);
  flex: none; margin-left: auto; }
.iLedTitle { font-size: var(--text-lg); font-weight: 600; color: var(--i-muted); margin-top: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iLedRow[data-open] .iLedTitle { color: var(--i-ink); }
.iLedSummary { font-size: var(--text-md); line-height: 1.45; color: var(--i-dim); margin-top: 2px; }
.iLedRow[data-open] .iLedSummary { color: var(--i-muted); }
/* The payload the push withheld — command, path, or the first error line. */
.iLedPayload { display: flex; align-items: center; gap: 8px; margin-top: 7px;
  padding: 5px 9px; border-radius: 8px; background: var(--i-bg);
  border: 1px solid var(--i-hairline); font-size: var(--text-sm); font-family: var(--i-mono);
  color: var(--i-dim); }
.iLedRow[data-open] .iLedPayload { color: var(--i-ink); }
.iLedPayloadText { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iLedRisk { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  font-family: var(--i-mono); flex: none; color: var(--i-dim); }
.iLedRisk[data-high] { color: var(--i-ink); }
.iLedActions { display: flex; align-items: center; gap: 8px; margin-top: 9px; flex-wrap: wrap; }
/* Third-rank control: a real action with a real effect, but never competing
   with Approve for the thumb. Text-weight, no fill, no border. */
.iLedGhostBtn { font-size: var(--text-sm); font-weight: 600; padding: 5px 4px; border: none; cursor: pointer;
  background: transparent; color: var(--i-dim); font-family: var(--i-font); margin-left: auto; }
/* PREVIEW row (All / Archived) — two lines, no payload, no decisions. */
.iLedRow--preview { align-items: center; padding: 9px 11px 10px 13px; }
.iLedPreviewLine { display: flex; align-items: baseline; gap: 8px; margin-top: 2px; }
.iLedPreviewLine .iLedTitle { flex: 1; min-width: 0; margin-top: 0; }
.iLedPreviewLine .iLedStateTag { flex: none; }
/* File-away control at the trailing edge — one glyph, dim at rest. */
.iLedFileBtn { flex: none; width: 28px; height: 28px; border-radius: 6px; display: grid;
  place-items: center; cursor: pointer; align-self: center;
  background: transparent; color: var(--i-dim); border: 1px solid transparent; }
.iLedFileBtn:hover { background: var(--i-bg); border-color: var(--i-hairline); color: var(--i-muted); }
/* Detail triage pair — set apart from the decision row so Dismiss/Archive is
   never a mis-tap on Approve, with the consequence spelled out beside it. */
.iLedTriage { display: flex; align-items: center; gap: 10px; margin-top: 14px;
  padding-top: 10px; border-top: 1px solid var(--i-hairline); }
.iLedTriage .iLedGhostBtn { margin-left: 0; padding: 4px 10px; border: 1px solid var(--i-hairline-strong);
  border-radius: 8px; color: var(--i-muted); }
.iLedTriageNote { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim); }
/* How it ended. Ours (decided on this device) gets the ink; anything that
   merely stopped being pending stays dim and is never named as a decision. */
.iLedState { display: flex; align-items: baseline; gap: 7px; margin-top: 7px; }
.iLedStateTag { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-dim); padding: 1px 6px; border-radius: 4px;
  background: var(--i-bg); border: 1px solid var(--i-hairline); }
.iLedStateTag[data-ours] { color: var(--i-muted); border-color: var(--i-hairline-strong); }
.iLedStateBy, .iLedStateAge { font-size: var(--text-xs); font-family: var(--i-mono); color: var(--i-dim); }
.iLedStateAge { margin-left: auto; }
.iLedFoot { font-size: var(--text-2xs); font-family: var(--i-mono); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--i-dim); text-align: center; padding: 12px 0 4px; }

/* Detail — the opened notification. */
.iLedDetail { padding: 12px 2px; }
.iLedDetailTitle { font-size: var(--text-3xl); font-weight: 600; color: var(--i-ink); margin-top: 8px;
  line-height: 1.3; }
.iLedDetailSummary { font-size: var(--text-lg); line-height: 1.5; color: var(--i-muted); margin-top: 6px; }
.iLedDetailWell { margin-top: 11px; padding: 9px 11px; border-radius: 9px; background: var(--i-bg);
  border: 1px solid var(--i-hairline); font-size: var(--text-sm); font-family: var(--i-mono);
  color: var(--i-ink); line-height: 1.55; white-space: pre-wrap; }
.iLedDetailRisk { margin-top: 6px; }
.iLedAnswer { padding: 10px 0 0; }
/* Provenance — which Mac, which conversation, when, and how it ended. A stat
   readout in the Instrument voice: dot-led key on the left, value on the right. */
.iLedProv { margin-top: 14px; border-top: 1px solid var(--i-hairline); padding-top: 10px; }
.iLedProvRow { display: flex; align-items: baseline; gap: 10px; padding: 3px 0;
  font-family: var(--i-mono); font-size: var(--text-xs); color: var(--i-dim); }
.iLedProvRow > span:first-child { text-transform: uppercase; letter-spacing: 0.09em; font-size: var(--text-2xs);
  font-weight: 700; min-width: 92px; }
.iLedProvVal { color: var(--i-muted); margin-left: auto; text-align: right;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iLedProvVal[data-open] { color: var(--i-accent); }
.iLedOpenConv { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%;
  margin-top: 14px; padding: 9px 0; border-radius: 9px; cursor: pointer;
  font-family: var(--i-font); font-size: var(--text-md); font-weight: 600;
  background: var(--i-surface); color: var(--i-ink); border: 1px solid var(--i-hairline-strong); }

/* Masthead bell — the destination's entry point, with an unread count. */
.iBell { position: relative; width: 30px; height: 30px; border-radius: 50%; display: grid;
  place-items: center; flex: none; background: var(--i-surface); color: var(--i-muted);
  border: 1px solid var(--i-hairline-strong); }
.iBellCount { position: absolute; top: -3px; right: -3px; min-width: 14px; height: 14px;
  padding: 0 3px; border-radius: 999px; background: var(--i-accent); color: var(--i-bg);
  font-family: var(--i-mono); font-size: var(--text-3xs); font-weight: 700; display: grid; place-items: center;
  border: 1.5px solid var(--i-bg); box-sizing: content-box; }

/* ── Crisp language (data-lang) — squarer · lighter-weight · quieter ───── */
/* A comparison design language, additive over any palette: radii step down
   (cards 16→6, fields 11→6, round chrome buttons → soft squares, pills →
   square tags), weights drop one stop (bold numerals go light, bold names go
   medium), and gradient card depth quiets to a single surface + 1px hairline
   with a whisper of lift — not merely flattened. Type keeps the lighter
   weight and recovers presence via tracking + size rhythm. Pair with Paper
   for the warm read; flip palette to Shipped to judge geometry on dark. */
.scoutios[data-lang="crisp"] .iCard { border-radius: 6px; background: var(--i-card-top);
  border: 1px solid var(--i-hairline-strong);
  box-shadow: 0 1px 2px rgba(0,0,0,0.10), 0 4px 12px -6px rgba(0,0,0,0.14); }
.scoutios[data-lang="crisp"] .iFleetCard.hot {
  border-color: color-mix(in oklab, var(--i-accent) 28%, var(--i-hairline-strong));
  box-shadow: 0 1px 2px rgba(0,0,0,0.08),
    0 0 0 1px color-mix(in oklab, var(--i-accent) 8%, transparent); }
.scoutios[data-lang="crisp"] .iField, .scoutios[data-lang="crisp"] .iFleetAskRow,
.scoutios[data-lang="crisp"] .iFleetAsk, .scoutios[data-lang="crisp"] .iEv,
.scoutios[data-lang="crisp"] .iWorkCard, .scoutios[data-lang="crisp"] .iNewCard { border-radius: 6px; }
.scoutios[data-lang="crisp"] .iFleetAskWell, .scoutios[data-lang="crisp"] .iNeedCmd { border-radius: 5px; }
.scoutios[data-lang="crisp"] .iFleetPicker, .scoutios[data-lang="crisp"] .iNeedBtn,
.scoutios[data-lang="crisp"] .iNeedOpt, .scoutios[data-lang="crisp"] .iSortBtn { border-radius: 4px; }
.scoutios[data-lang="crisp"] .iCompose, .scoutios[data-lang="crisp"] .iGear,
.scoutios[data-lang="crisp"] .iBackBtn, .scoutios[data-lang="crisp"] .iMic,
.scoutios[data-lang="crisp"] .iSend { border-radius: 7px; }
.scoutios[data-lang="crisp"] .iChip { border-radius: 5px; }
.scoutios[data-lang="crisp"] .iPill, .scoutios[data-lang="crisp"] .iUnread,
.scoutios[data-lang="crisp"] .iNeedCount, .scoutios[data-lang="crisp"] .iLiveInd,
.scoutios[data-lang="crisp"] .iTabBadge { border-radius: 4px; }

/* Paper × Crisp — warm hairline + ink-tinted lift (no sooty glass) */
.scoutios[data-v="paper"][data-lang="crisp"] .iCard {
  border-color: var(--i-hairline-strong);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.72),
    0 1px 2px rgba(62,56,44,0.045), 0 8px 18px -10px rgba(62,56,44,0.11); }
.scoutios[data-v="paper"][data-lang="crisp"] .iFleetCard.hot {
  border-color: color-mix(in oklab, var(--i-accent) 26%, var(--i-hairline-strong));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.72),
    0 1px 2px rgba(62,56,44,0.04),
    0 0 0 1px color-mix(in oklab, var(--i-accent) 7%, transparent); }
.scoutios[data-v="paper"][data-lang="crisp"] .iFleetAsk {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 2px rgba(62,56,44,0.04); }
.scoutios[data-v="paper"][data-lang="crisp"] .iFleetAskRow {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 2px rgba(62,56,44,0.04); }
.scoutios[data-v="paper"][data-lang="crisp"] .iRowSep {
  background: color-mix(in oklab, var(--i-ink) 7%, transparent); }

/* one weight-stop lighter — recover presence with tracking, not weight */
.scoutios[data-lang="crisp"] .iWordmark { font-weight: 500; letter-spacing: -0.015em; }
.scoutios[data-lang="crisp"] .iSecLabel, .scoutios[data-lang="crisp"] .iSecAll {
  font-weight: 500; letter-spacing: 0.15em; }
/* CLARITY — micro-type contrast floor. Under ~10px, tracked caps on Paper at
   --i-dim fell below a comfortable read; lift such labels to --i-muted and hold
   size at/above 9px so lane labels and stat captions actually resolve. */
.scoutios[data-lang="crisp"] .iFleetLaneLabel { font-weight: 600; letter-spacing: 0.14em;
  font-size: var(--text-2xs); color: var(--i-muted); }
.scoutios[data-lang="crisp"] .iFleetStatCap { font-weight: 600; letter-spacing: 0.1em;
  font-size: var(--text-2xs); color: var(--i-muted); }
.scoutios[data-lang="crisp"] .iFleetLaneCount { font-weight: 600; font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em; font-size: var(--text-2xs); color: var(--i-muted); }
.scoutios[data-lang="crisp"] .iFleetName { font-weight: 500; letter-spacing: -0.01em;
  font-size: var(--text-md); }
.scoutios[data-lang="crisp"] .iFleetName.dim { font-weight: 400; }
.scoutios[data-lang="crisp"] .iFleetNum { font-weight: 400; font-family: var(--i-font);
  letter-spacing: -0.03em; font-variant-numeric: tabular-nums; font-size: var(--text-2xl); }
.scoutios[data-lang="crisp"] .iFleetDetail { font-size: var(--text-sm); letter-spacing: 0.005em; }
.scoutios[data-lang="crisp"] .iFleetDetail.mono { font-size: var(--text-xs); letter-spacing: 0; }
.scoutios[data-lang="crisp"] .iFleetAge { font-size: var(--text-xs); letter-spacing: 0.01em;
  color: var(--i-muted); }
.scoutios[data-lang="crisp"] .iFleetPicker { font-weight: 600; letter-spacing: 0.06em; }
.scoutios[data-lang="crisp"] .iFleetLogSrc { font-weight: 500; letter-spacing: 0.02em; }
.scoutios[data-lang="crisp"] .iFleetLogTime { letter-spacing: 0.02em; }
.scoutios[data-lang="crisp"] .iFleetLogText { font-size: var(--text-2xs); }

/* CLARITY — the KIND token. At --i-dim/8px it was effectively invisible even
   on the wide stage, so the "what does it want from me" signal was lost. Give
   it a legible square tag voice; the needs-you kinds (see .kind) get a hairline
   tag box, blocking ones (approval/question) read ink-bright. */
.scoutios[data-lang="crisp"] .iFleetTok { font-weight: 600; letter-spacing: 0.06em;
  font-size: var(--text-3xs); color: var(--i-muted); }
.scoutios[data-lang="crisp"] .iFleetTok.kind { color: var(--i-muted); padding: 1.5px 5px;
  border: 1px solid var(--i-hairline-strong); border-radius: 4px; line-height: 1;
  font-size: var(--text-3xs); letter-spacing: 0.07em; }
.scoutios[data-lang="crisp"] .iFleetTok.kind.blocking { color: var(--i-ink);
  border-color: color-mix(in oklab, var(--i-ink) 30%, var(--i-hairline-strong)); }
/* the KIND token rides on the phone for the attention lane (single-line safe —
   it is flex:none, the summary keeps ellipsizing beside it). Working/detected
   harness tokens stay wide-only so their rows don't crowd on the phone. */
.scoutios[data-lang="crisp"] .iFleetTok.kind { display: inline; }

/* Fleet cadence under crisp — stat band · lanes · rail as clear beats */
.scoutios[data-lang="crisp"] .iFleetStats { gap: 12px; padding: 10px 2px 11px;
  border-bottom: 1px solid var(--i-hairline); margin-bottom: 2px; }
.scoutios[data-lang="crisp"] .iFleetStat { gap: 6px; }
.scoutios[data-lang="crisp"] .iFleetStatSep { display: block; width: 1px; height: 12px;
  flex: none; background: var(--i-hairline-strong); opacity: 0.85; align-self: center; }
.scoutios[data-lang="crisp"] .iFleetSpark { height: 18px; opacity: 0.95; }
.scoutios[data-lang="crisp"] .iFleetLaneHead { padding: 11px 2px 5px; gap: 8px; }
.scoutios[data-lang="crisp"] .iFleetLanes > .iFleetLaneHead:first-child { padding-top: 8px; }
.scoutios[data-lang="crisp"] .iFleetRow { gap: 9px; padding: 7px 11px; }
.scoutios[data-lang="crisp"] .iRowSep { margin-left: 11px; }

/* CLARITY — attention hierarchy: needs-you ≫ working > detected, without color.
   The hot lane label reads bigger + ink; the quiet (Detected) label steps to
   dim; and the working/detected heads get extra air above so the needs-you card
   sits apart as the first thing the eye lands on. */
.scoutios[data-lang="crisp"] .iCard + .iFleetLaneHead { padding-top: 15px; }
/* the hot (needs-you) label carries an inline color:ink — key off that inline
   style to also bump its size/tracking so it clearly outranks the others. */
.scoutios[data-lang="crisp"] .iFleetLaneLabel[style] { font-size: var(--text-xs); letter-spacing: 0.15em; }
.scoutios[data-lang="crisp"] .iFleetLaneHead.tone-quiet .iFleetLaneLabel { color: var(--i-dim); }
.scoutios[data-lang="crisp"] .iFleetLaneHead.tone-quiet .iFleetLaneCount { color: var(--i-dim); }
/* the working lane's mono is a live action (present tense + caret); the detected
   lane's mono is quiet location metadata — push it dim + a hair smaller so the
   two mono voices don't compete. */
.scoutios[data-lang="crisp"] .iFleetRow.dim .iFleetDetail.mono { color: var(--i-dim);
  font-size: var(--text-2xs); letter-spacing: 0.01em; }
.scoutios[data-lang="crisp"] .iFleetAsk { margin-top: 12px; }
.scoutios[data-lang="crisp"] .iFleetAskRow { padding: 7px 9px; border-radius: 6px; }
.scoutios[data-lang="crisp"] .iFleetAskHint { font-size: var(--text-md); letter-spacing: 0.005em; }

/* sparkline — thin stroke, soft fade fill, end mark (see fleet-surface Sparkline) */
.scoutios[data-lang="crisp"] .iFleetSpark .iFleetSparkBase { stroke: var(--i-hairline-strong); }
.scoutios[data-lang="crisp"] .iFleetSpark .iFleetSparkLine { stroke-width: 1.15; }
.scoutios[data-lang="crisp"] .iFleetSpark .iFleetSparkEnd { r: 1.7; }

/* wide stage — open the numbers, air out the grid, keep phone single-line intact */
@container (min-width: 600px) {
  .scoutios[data-lang="crisp"] .iFleetStats { gap: 28px; padding: 14px 4px 16px;
    border-bottom-color: var(--i-hairline); }
  .scoutios[data-lang="crisp"] .iFleetStat { gap: 5px; }
  .scoutios[data-lang="crisp"] .iFleetStatSep { display: none; }
  .scoutios[data-lang="crisp"] .iFleetNum { font-size: var(--text-6xl); letter-spacing: -0.04em;
    line-height: 0.95; }
  .scoutios[data-lang="crisp"] .iFleetStatCap { font-size: var(--text-3xs); letter-spacing: 0.13em; }
  .scoutios[data-lang="crisp"] .iFleetSpark { height: 44px; max-width: 280px; }
  .scoutios[data-lang="crisp"] .iFleetGrid { gap: 20px; margin-top: 2px; }
  .scoutios[data-lang="crisp"] .iFleetName { max-width: 148px; font-size: var(--text-md); }
  .scoutios[data-lang="crisp"] .iFleetDetail { font-size: var(--text-sm); }
  .scoutios[data-lang="crisp"] .iFleetRow { padding: 8px 12px; }
  .scoutios[data-lang="crisp"] .iFleetAsk { margin-top: 11px; padding: 13px 14px; }
  .scoutios[data-lang="crisp"] .iFleetAskHead { padding-bottom: 9px; }
  .scoutios[data-lang="crisp"] .iFleetAskPickers { gap: 6px; padding-bottom: 9px; }
  .scoutios[data-lang="crisp"] .iFleetAskWell { min-height: 68px; padding: 10px 12px;
    margin-bottom: 10px; font-size: var(--text-md); line-height: 1.5; }
  .scoutios[data-lang="crisp"] .iFleetLog { margin-top: 16px; }
  .scoutios[data-lang="crisp"] .iFleetLogRow { gap: 8px; padding: 5px 2px; }
}

/* ── Home · simplified ──────────────────────────────────────────────────── */
/* Three zones, no toggles: NEEDS YOU (only when non-empty) · one flat ACTIVITY
   log (absorbs the Working lane; the live count is the lane header's only
   glance-value) · the Ask dock. Kind reads from a mono TEXT tag, never a color
   chip; a single amber marks BLOCKING (an agent is literally paused). */
/* iBody already supplies the 14px side gutter + is the flex:1 scroll region;
   these two fill it and own their own internal stacking. */
.iHomeS { height: 100%; display: flex; flex-direction: column; min-height: 0;
  padding-bottom: 4px; overflow: hidden; }

/* zone head — caps label · count · rule · optional trailing action */
.iZone { display: flex; align-items: center; gap: 8px; padding: 12px 0 7px; flex: none; }
.iZoneLabel { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--i-dim); }
.iZoneLabel[data-attn] { color: var(--i-warn); }
.iZoneCount { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 600;
  color: var(--i-warn); border: 1px solid rgba(245,158,11,0.35); border-radius: 999px;
  padding: 1px 6px; line-height: 1.4; }
.iZoneRule { flex: 1; height: 1px; background: var(--i-hairline); }
.iZoneMeta { font-family: var(--i-mono); font-size: var(--text-2xs); letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--i-dim); }
.iZoneMeta[data-live] { color: var(--i-accent); }

/* needs-you row — the triage unit. Vertical (never a horizontal card rail:
   triage must show its whole queue at a glance). Unread = ink; read recedes. */
.iNeed2 { display: flex; align-items: flex-start; gap: 9px; padding: 9px 2px;
  border-bottom: 1px solid var(--i-hairline); min-height: 44px; }
.iNeed2:last-child { border-bottom: none; }
.iNeed2Bar { flex: none; width: 2px; align-self: stretch; border-radius: 1px;
  background: var(--i-warn); margin-right: 1px; }
.iNeed2[data-read] .iNeed2Bar { background: transparent; }
.iNeed2Body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.iNeed2Top { display: flex; align-items: baseline; gap: 7px; }
.iNeed2Agent { font-size: var(--text-md); font-weight: 600; color: var(--i-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iNeed2[data-read] .iNeed2Agent { font-weight: 500; color: var(--i-muted); }
.iNeed2Proj { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim);
  white-space: nowrap; }
.iNeed2Kind { font-family: var(--i-mono); font-size: var(--text-3xs); font-weight: 700;
  letter-spacing: 0.09em; text-transform: uppercase; color: var(--i-dim); }
.iNeed2Kind[data-block] { color: var(--i-warn); }
.iNeed2Age { margin-left: auto; font-family: var(--i-mono); font-size: var(--text-2xs);
  color: var(--i-dim); font-variant-numeric: tabular-nums; }
.iNeed2Text { font-size: var(--text-md); line-height: 1.35; color: var(--i-muted);
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.iNeed2[data-read] .iNeed2Text { color: var(--i-dim); }
.iNeed2Chev { flex: none; color: var(--i-dim); align-self: center; display: flex; }
.iNeedMore { font-family: var(--i-mono); font-size: var(--text-xs); color: var(--i-dim);
  padding: 8px 2px 0; }

/* activity — the flat log, freshest first; live rows carry the accent edge */
.iHomeLog { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.iHomeLogList { flex: 1; min-height: 0; overflow: hidden; }
.iHomeLogRow { display: flex; align-items: baseline; gap: 8px; padding: 6px 2px 6px 8px;
  border-left: 2px solid transparent; }
.iHomeLogRow[data-now] { border-left-color: var(--i-accent); }
.iHomeLogText { flex: 1; min-width: 0; font-size: var(--text-sm); line-height: 1.35;
  color: var(--i-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iHomeLogRow[data-now] .iHomeLogText { color: var(--i-ink); }
.iHomeLogSrc { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.iHomeLogAge { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim);
  font-variant-numeric: tabular-nums; }
.iHomeLogAge.live { color: var(--i-accent); }

/* ask dock — unchanged grammar: a recessed well + a lit send */
.iAskDock { flex: none; display: flex; align-items: center; gap: 8px; margin-top: 10px;
  padding: 7px 7px 7px 13px; border-radius: 20px; background: var(--i-chrome);
  border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.65); }
.iAskDockText { flex: 1; font-size: var(--text-md); color: var(--i-dim); }
.iAskDockSend { flex: none; width: 28px; height: 28px; border-radius: 999px;
  background: var(--i-hairline-strong); color: var(--i-bg);
  display: flex; align-items: center; justify-content: center; font-size: var(--text-lg); font-weight: 700; }

/* the quiet fleet — kept from the shipped Home; it earns its place */
.iQuiet { flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 14px; padding: 56px 0; }
.iQuietRule { display: flex; align-items: center; gap: 5px; }
.iQuietRule i { display: block; width: 46px; height: 1.5px; background: var(--i-accent); }
.iQuietRule b { display: block; width: 3px; height: 3px; border-radius: 999px; background: var(--i-accent); }
.iQuietLabel { font-family: var(--i-mono); font-size: var(--text-xs); font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--i-dim); }

/* ── Notification detail (pushed page) ──────────────────────────────────── */
/* The destination of a push. A PAGE, not a sheet: it pushes onto whatever tab
   you were on, and Back returns you exactly there. Nothing about opening it
   forces the conversation open. */
/* The triage bar is chrome — it bleeds to the screen edges, so the page cancels
   iBody's side gutter and re-applies it inside the scroll region only. */
.iND { height: 100%; display: flex; flex-direction: column; min-height: 0;
  overflow: hidden; margin: 0 -14px -6px; }
.iNDScroll { flex: 1; min-height: 0; overflow: hidden; padding: 12px 16px 14px;
  display: flex; flex-direction: column; gap: 13px; }

/* identity line — who / where, mono, before the demand */
.iNDWho { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
.iNDKind { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.11em; text-transform: uppercase; color: var(--i-dim); }
.iNDKind[data-block] { color: var(--i-warn); }
.iNDAgent { font-size: var(--text-md); font-weight: 600; color: var(--i-ink); }
.iNDMeta { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.iNDAge { margin-left: auto; font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }

/* the demand */
.iNDTitle { font-size: var(--text-3xl); font-weight: 600; line-height: 1.25; color: var(--i-ink);
  letter-spacing: -0.01em; }
.iNDSummary { font-size: var(--text-lg); line-height: 1.5; color: var(--i-muted); }

/* evidence — the command / the failure, in a recessed mono well */
.iNDEvidence { font-family: var(--i-mono); font-size: var(--text-sm); line-height: 1.55;
  color: var(--i-ink); white-space: pre-wrap; padding: 10px 12px; border-radius: 8px;
  background: var(--i-chrome); border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.55); }
.iNDRisk { display: flex; align-items: center; gap: 7px; }
.iNDRiskLabel { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--i-dim); }
.iNDRiskVal { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--i-dim); }
.iNDRiskVal[data-high] { color: var(--i-ink); }

/* ACT — the primary move, resolved here without ever opening the transcript */
.iNDAct { display: flex; flex-direction: column; gap: 8px; }
.iNDActLabel { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--i-dim); }
.iNDBtnRow { display: flex; gap: 8px; }
.iNDBtn { flex: 1; min-height: 44px; display: flex; align-items: center;
  justify-content: center; border-radius: 10px; font-size: var(--text-lg); font-weight: 600;
  border: 1px solid var(--i-hairline-strong); color: var(--i-ink); background: var(--i-surface); }
.iNDBtn[data-primary] { background: var(--i-accent); border-color: var(--i-accent); color: #04130d; }
.iNDBtn[data-off] { opacity: 0.4; }
.iNDOpts { display: flex; gap: 8px; flex-wrap: wrap; }
.iNDOpt { min-height: 40px; display: flex; align-items: center; padding: 0 14px;
  border-radius: 10px; font-size: var(--text-lg); font-weight: 600; color: var(--i-ink);
  background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.iNDAnswer { min-height: 40px; display: flex; align-items: center; padding: 0 12px;
  border-radius: 10px; font-size: var(--text-md); color: var(--i-dim);
  background: var(--i-chrome); border: 1px solid var(--i-hairline-strong); }

/* receipt / notice strips — after acting, or when the item resolved elsewhere */
.iNDNotice { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px;
  border-radius: 9px; font-size: var(--text-md); line-height: 1.45; color: var(--i-muted);
  background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.iNDNotice[data-ok] { color: var(--i-ink); border-color: rgba(16,185,129,0.35); }
.iNDNotice[data-warn] { border-color: rgba(245,158,11,0.32); }
.iNDNotice[data-err] { border-color: rgba(220,38,38,0.38); }
.iNDNoticeMark { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--i-dim); padding-top: 2px; }
.iNDNotice[data-ok] .iNDNoticeMark { color: var(--i-accent); }
.iNDNotice[data-warn] .iNDNoticeMark { color: var(--i-warn); }
.iNDNotice[data-err] .iNDNoticeMark { color: var(--i-error); }
.iNDUndo { padding-left: 8px; font-size: var(--text-md); font-weight: 600; color: var(--i-accent);
  white-space: nowrap; }

/* provenance — where this was resolved from, and how to refresh it */
.iNDProv { display: flex; align-items: center; gap: 6px; font-family: var(--i-mono);
  font-size: var(--text-2xs); letter-spacing: 0.05em; color: var(--i-dim); }
.iNDProvAct { margin-left: auto; color: var(--i-accent); font-weight: 600; }

/* empty / resolving states */
.iNDState { flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 9px; padding: 40px 20px; text-align: center; }
.iNDStateTitle { font-size: var(--text-xl); font-weight: 600; color: var(--i-ink); }
.iNDStateBody { font-size: var(--text-md); line-height: 1.5; color: var(--i-muted); max-width: 260px; }
.iNDSkel { width: 100%; border-radius: 6px; background: var(--i-surface); opacity: 0.5; }

/* TRIAGE bar — pinned, always available, and deliberately SEPARATE from Act.
   Mark read / Dismiss never touch the agent; Open is the only thing that
   navigates, and only when you ask for it. */
.iNDTriage { flex: none; display: flex; align-items: stretch; gap: 6px;
  padding: 9px 12px calc(9px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--i-hairline-strong); background: var(--i-chrome); }
.iNDTri { flex: 1; min-height: 44px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px; border-radius: 9px;
  background: transparent; }
.iNDTriLabel { font-size: var(--text-sm); font-weight: 600; color: var(--i-muted); }
.iNDTri[data-on] .iNDTriLabel { color: var(--i-accent); }
.iNDTri[data-off] { opacity: 0.4; }
.iNDTriSub { font-family: var(--i-mono); font-size: var(--text-3xs); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--i-dim); }
.iNDTriSep { flex: none; width: 1px; background: var(--i-hairline); margin: 6px 0; }

/* ── Banner / lock-screen exhibit (OS-level triage) ─────────────────────── */
/* The strongest form of "don't force the destination open": resolve the
   notification from the banner and never launch the app. Needs aps.category
   through the relay + a UNNotificationCategory registration. */
.iBanner { border-radius: 18px; background: rgba(28,28,30,0.94); overflow: hidden;
  border: 1px solid rgba(255,255,255,0.10); }
.scoutios[data-v="paper"] .iBanner { background: rgba(255,255,255,0.92);
  border-color: rgba(0,0,0,0.10); }
.iBannerTop { display: flex; align-items: flex-start; gap: 9px; padding: 11px 13px; }
.iBannerIcon { flex: none; width: 22px; height: 22px; border-radius: 6px;
  background: var(--i-accent); color: #04130d; display: flex; align-items: center;
  justify-content: center; font-size: var(--text-sm); font-weight: 800; }
.iBannerBody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.iBannerTitle { font-size: var(--text-md); font-weight: 700; color: var(--i-ink); }
.iBannerText { font-size: var(--text-md); color: var(--i-muted); }
.iBannerAge { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.iBannerActs { display: flex; border-top: 1px solid rgba(255,255,255,0.08); }
.scoutios[data-v="paper"] .iBannerActs { border-top-color: rgba(0,0,0,0.08); }
.iBannerAct { flex: 1; min-height: 40px; display: flex; align-items: center;
  justify-content: center; font-size: var(--text-md); font-weight: 600; color: var(--i-ink); }
.iBannerAct + .iBannerAct { border-left: 1px solid rgba(255,255,255,0.08); }
.scoutios[data-v="paper"] .iBannerAct + .iBannerAct { border-left-color: rgba(0,0,0,0.08); }

/* ── Flow map — the state machine, rendered as an exhibit ───────────────── */
.iFlow { display: grid; gap: 10px; }
.iFlowStep { display: flex; gap: 10px; align-items: flex-start; }
.iFlowMark { flex: none; width: 20px; height: 20px; border-radius: 999px;
  border: 1px solid var(--i-hairline-strong); color: var(--i-dim);
  font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  display: flex; align-items: center; justify-content: center; }
.iFlowBody { flex: 1; min-width: 0; }
.iFlowTitle { font-size: var(--text-md); font-weight: 600; color: var(--i-ink); }
.iFlowNote { font-size: var(--text-md); line-height: 1.45; color: var(--i-muted); }

/* density treatment — the compact Home (mods.density = "compact") */
.scoutios[data-density="compact"] .iNeed2 { padding: 7px 2px; }
.scoutios[data-density="compact"] .iZone { padding: 9px 0 6px; }
.scoutios[data-density="compact"] .iHomeLogRow { padding: 4px 2px 4px 8px; }
`;
