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

/** Palette variant — shipped native HudPalette vs the higher-contrast proposal. */
export type Variant = "shipped" | "hc";
/**
 * The study surfaces. The first four are top-level tab content; the rest are
 * detail/sheet surfaces (custom header, often no tab bar) reached by push or
 * from the gear.
 */
export type Surface =
  | "home" | "comms" | "agents" | "ops" | "tail"
  | "terminal" | "new" | "conversation" | "connect" | "settings";

// The docked tab bar: Home · Comms · Agents · Ops — four destinations, the
// places you *go*. New is NOT here: it's a contextual action (a compose "+" per
// surface), since "new" means something different in each place — a new
// conversation in Comms, a new session in Agents. Comms and Agents are distinct
// (the Slack "chats vs contacts" split): Comms is the conversations; Agents is
// the directory/inventory tree of who exists. Ops folds Tail + Terminal into
// one "raw truth" destination — it opens on Tail (the live firehose) with a
// Terminal toggle. Home leads with the needs-you band over the ambient swarm.
export const TABS: { label: string; kind: GlyphKind; activeFor?: Surface[] }[] = [
  { label: "Home", kind: "home", activeFor: ["home"] },
  { label: "Comms", kind: "comms", activeFor: ["comms", "conversation"] },
  { label: "Agents", kind: "agent", activeFor: ["agents"] },
  { label: "Ops", kind: "pulse", activeFor: ["ops", "tail", "terminal"] },
];

export const SCOUT_IOS_CSS = `
.scoutios { --i-font: "Inter Tight", ui-sans-serif, system-ui, sans-serif;
  --i-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace; }

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
  justify-content: space-between; padding: 0 30px; font-size: 15px; font-weight: 600;
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
.iWordmark { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; color: var(--i-ink);
  flex: 1; }
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
.iSecLabel { font-size: 9.5px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  color: var(--i-muted); font-family: var(--i-mono); }
.iSecAll { font-size: 9.5px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
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
.iRailCap { font-size: 9px; font-weight: 600; letter-spacing: 0.08em; color: var(--i-muted);
  font-family: var(--i-mono); flex: none; }
.iRailScroll { display: flex; gap: 7px; overflow: hidden; }
.iChip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 999px;
  background: var(--i-surface); border: 1px solid var(--i-hairline-strong); white-space: nowrap; }
.iChip.on { border-color: color-mix(in oklab, var(--i-accent) 40%, transparent);
  box-shadow: 0 0 7px color-mix(in oklab, var(--i-accent) 12%, transparent); }
.iChipName { font-size: 11px; font-weight: 500; color: var(--i-ink); }
.iChip.off .iChipName { color: var(--i-muted); }
.iChipAdd .iChipName { color: var(--i-muted); }

/* ── Search field (HudField) ───────────────────────────────────────────── */
.iField { display: flex; align-items: center; gap: 8px; margin: 7px 0 2px; padding: 8px 12px;
  border-radius: 11px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.iField span { font-size: 13px; color: var(--i-dim); }
.iField svg { color: var(--i-dim); flex: none; }

/* ── Currently working strip ───────────────────────────────────────────── */
.iWorkScroll { display: flex; gap: 11px; overflow: hidden; padding: 2px 0; }
.iWorkCard { position: relative; width: 188px; flex: none; padding: 10px;
  border-radius: 14px; background: var(--i-surface);
  border: 1px solid color-mix(in oklab, var(--i-accent) 20%, var(--i-hairline-strong)); }
.iWorkTop { display: flex; align-items: center; gap: 6px; }
.iWorkName { font-size: 13px; font-weight: 600; color: var(--i-ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iWorkAction { font-size: 11px; color: var(--i-muted); font-family: var(--i-mono); margin-top: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.iWorkMeta { font-size: 10px; color: var(--i-dim); font-family: var(--i-mono); margin-top: 4px;
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
.iProjName { font-size: 14px; font-weight: 500; color: var(--i-ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iSlash { font-size: 12px; color: var(--i-dim); font-family: var(--i-mono); flex: none; }
.iLeaf { font-size: 13px; color: var(--i-muted); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; display: inline-flex; align-items: center; gap: 4px; }
.iLeaf .glyf { color: var(--i-dim); flex: none; }
.iPill { font-size: 9.5px; font-family: var(--i-mono); color: var(--i-dim); padding: 1px 5px;
  border-radius: 999px; background: var(--i-surface); border: 1px solid var(--i-hairline);
  flex: none; }
.iSpacer { flex: 1; min-width: 8px; }
.iAge { font-size: 11px; color: var(--i-muted); font-family: var(--i-mono); flex: none;
  text-align: right; }
.iAge.live { color: var(--i-accent); }
.iChev { color: var(--i-dim); flex: none; }
/* nested agent leaf with tree connector */
.iLeafRow { display: flex; align-items: center; gap: 8px; padding: 7px 13px;
  background: color-mix(in oklab, var(--i-surface) 50%, transparent); }
.iTree { width: 18px; flex: none; align-self: stretch; color: var(--i-dim); }
.iAgentName { font-size: 12.5px; color: var(--i-ink); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.iAgentName.dim { color: var(--i-muted); }
.iAgentTok { font-size: 9.5px; color: var(--i-dim); font-family: var(--i-mono); flex: none; }
.iHarness { font-size: 10px; font-family: var(--i-mono); color: var(--i-muted); flex: none; }

/* ── Activity rows (inside scoutCard) ──────────────────────────────────── */
.iActRow { display: flex; align-items: flex-start; gap: 9px; padding: 7px 13px; }
.iActDot { margin-top: 5px; }
.iActBody { flex: 1; min-width: 0; }
.iActSummary { font-size: 13px; color: var(--i-ink); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.iActMeta { font-size: 10px; color: var(--i-muted); font-family: var(--i-mono); margin-top: 2px; }

/* ── Agents surface ────────────────────────────────────────────────────── */
.iSummary { display: flex; align-items: center; padding: 4px 4px 8px; }
.iSort { display: flex; gap: 2px; margin-left: auto; }
.iSortBtn { font-size: 9.5px; font-family: var(--i-mono); letter-spacing: 0.06em; padding: 3px 8px;
  border-radius: 999px; color: var(--i-muted); cursor: pointer; }
.iSortBtn.on { color: var(--i-accent); font-weight: 700;
  background: color-mix(in oklab, var(--i-accent) 12%, transparent); }
.iProjHead { display: flex; align-items: center; gap: 9px; padding: 9px 13px 4px; }
.iProjGlyph { display: grid; grid-template-columns: 3px 3px; gap: 3px; flex: none; }
.iProjGlyph i { width: 3px; height: 3px; border-radius: 50%; background: var(--i-muted); }
.iProjHeadName { font-size: 14px; font-weight: 600; color: var(--i-ink); }
.iCount { font-size: 11px; color: var(--i-muted); font-family: var(--i-mono); flex: none; }
.iAgentMain { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.iSessionLine { font-size: 10px; color: var(--i-muted); font-family: var(--i-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iADivider { height: 1px; background: color-mix(in oklab, var(--i-ink) 6%, transparent);
  margin-left: 14px; }

/* ── Comms surface ─────────────────────────────────────────────────────── */
.iCommsRow { display: flex; align-items: center; gap: 9px; padding: 12px 6px; position: relative; }
.iCommsRow.unread { background: color-mix(in oklab, var(--i-ink) 5%, transparent); }
.iCommsRail { position: absolute; left: 1px; top: 9px; bottom: 9px; width: 3px; border-radius: 2px;
  background: var(--i-accent); }
.iCommsType { width: 15px; flex: none; color: var(--i-muted); display: grid; place-items: center; }
.iCommsName { font-size: 14px; color: var(--i-ink); width: 116px; flex: none; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iCommsName.unread { font-weight: 600; }
.iCommsStatus { width: 16px; flex: none; display: grid; place-items: center; font-family: var(--i-mono);
  font-size: 13px; font-weight: 700; }
.iCommsPreview { font-size: 12.5px; color: var(--i-muted); flex: 1; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iCommsAge { font-size: 11px; color: var(--i-muted); font-family: var(--i-mono); flex: none; }
.iUnread { font-size: 9px; font-weight: 700; font-family: var(--i-mono); color: var(--i-bg);
  background: var(--i-accent); border-radius: 999px; padding: 1px 5px; flex: none; }
.iCommsSep { height: 1px; background: color-mix(in oklab, var(--i-ink) 6%, transparent);
  margin-left: 30px; }
.iGroupDots { display: flex; gap: 2px; }
.iGroupDots i { width: 3.5px; height: 3.5px; border-radius: 50%; background: currentColor; }
.iBraille { font-family: var(--i-mono); color: var(--i-accent); font-size: 13px; }

/* ── Tail surface ──────────────────────────────────────────────────────── */
.iTailHead { display: flex; align-items: center; padding: 4px 4px 10px; }
.iLiveInd { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; padding: 3px 9px;
  border-radius: 999px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.iLiveInd span { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; font-family: var(--i-mono);
  color: var(--i-accent); text-transform: uppercase; }
.iEv { padding: 10px 11px; border-radius: 11px; background: var(--i-surface);
  border: 1px solid var(--i-hairline); margin-bottom: 7px; }
.iEvTop { display: flex; align-items: center; gap: 7px; }
.iBadge { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 700;
  letter-spacing: 0.04em; font-family: var(--i-mono); }
.iBadge i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.iEvSource { font-size: 10px; font-weight: 600; color: var(--i-dim); font-family: var(--i-mono); }
.iEvKind { font-size: 10px; color: var(--i-muted); font-family: var(--i-mono); }
.iEvTime { font-size: 10px; color: var(--i-dim); font-family: var(--i-mono); margin-left: auto; }
.iEvText { font-size: 11.5px; color: var(--i-ink); font-family: var(--i-mono); margin-top: 6px;
  line-height: 1.45; }

/* ── Inbox surface ─────────────────────────────────────────────────────── */
/* "Needs you" header — warmer than the muted section caps; ink label + a count
   capsule, so the queue size reads at a glance. */
.iNeedHead { display: flex; align-items: center; gap: 7px; padding: 9px 4px 7px; }
.iNeedHeadLabel { font-size: 9.5px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-ink); }
.iNeedCount { font-size: 9px; font-weight: 700; font-family: var(--i-mono); color: var(--i-bg);
  background: var(--i-accent); border-radius: 999px; padding: 1px 6px; }
.iNeedClear { font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-muted); margin-left: auto; }
/* One inbox item — tone dot · agent·project · KIND · age, then the demand and
   any inline decision (approve/deny, option chips, the awaiting command). */
.iNeedRow { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; }
.iNeedDot { width: 7px; height: 7px; border-radius: 50%; flex: none; margin-top: 5px; }
.iNeedBody { flex: 1; min-width: 0; }
.iNeedTop { display: flex; align-items: center; gap: 7px; }
.iNeedAgent { font-size: 13px; font-weight: 600; color: var(--i-ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iNeedProj { font-size: 10.5px; font-family: var(--i-mono); color: var(--i-dim); flex: none; }
.iNeedKind { font-size: 8.5px; font-weight: 700; letter-spacing: 0.07em; font-family: var(--i-mono);
  color: var(--i-dim); flex: none; margin-left: auto; }
.iNeedAge { font-size: 10.5px; font-family: var(--i-mono); color: var(--i-muted); flex: none; }
.iNeedSummary { font-size: 12.5px; line-height: 1.45; color: var(--i-muted); margin-top: 3px; }
.iNeedCmd { display: flex; align-items: center; gap: 8px; margin-top: 7px; padding: 5px 9px;
  border-radius: 8px; background: var(--i-bg); border: 1px solid var(--i-hairline);
  font-size: 11px; font-family: var(--i-mono); color: var(--i-ink); }
.iNeedCmdText { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iNeedRisk { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  font-family: var(--i-mono); flex: none; }
.iNeedActions { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
.iNeedBtn { font-size: 11.5px; font-weight: 600; padding: 5px 13px; border-radius: 8px;
  border: 1px solid transparent; cursor: pointer; font-family: var(--i-font); }
.iNeedBtn.deny { background: transparent; color: var(--i-muted); border-color: var(--i-hairline-strong); }
.iNeedBtn.approve { background: var(--i-accent); color: #04130d; }
.iNeedOpt { font-size: 11.5px; font-weight: 600; padding: 5px 13px; border-radius: 8px; cursor: pointer;
  font-family: var(--i-font); background: var(--i-surface); color: var(--i-ink);
  border: 1px solid var(--i-hairline-strong); }
/* All-clear beat — the empty inbox, the moment the app should feel calm. */
.iAllClear { display: flex; flex-direction: column; align-items: center; gap: 7px; text-align: center;
  padding: 26px 22px 20px; }
.iAllClearMark { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
  color: var(--i-accent); background: var(--i-accent-soft);
  border: 1px solid color-mix(in oklab, var(--i-accent) 40%, transparent); }
.iAllClearTitle { font-size: 14px; font-weight: 600; color: var(--i-ink); }
.iAllClearSub { font-size: 11.5px; font-family: var(--i-mono); color: var(--i-muted); }

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
  font-size: 9px; font-weight: 700; font-family: var(--i-mono); display: grid; place-items: center;
  box-shadow: 0 0 0 2px var(--i-chrome); }
.iTabLabel { font-size: 9px; font-weight: 500; font-family: var(--i-mono); letter-spacing: 0.02em; }

/* ── Bottom cockpit status bar (ScoutStatusBar) ──────────────────────── */
.iStatusBar { flex: none; display: flex; align-items: center; justify-content: space-between;
  padding: 4px 18px 0; min-height: 20px; background: var(--i-chrome);
  border-top: 1px solid var(--i-hairline); position: relative; z-index: 2; }
.iSbRun { display: flex; align-items: center; gap: 6px; }
.iSbCell { display: inline-flex; align-items: center; gap: 4px; color: var(--i-muted); }
.iSbCell svg { color: var(--i-accent); }
.iSbLabel { font-size: 9px; font-weight: 500; letter-spacing: 0.04em; font-family: var(--i-mono);
  color: var(--i-muted); white-space: nowrap; }
.iSbDot { font-size: 9px; color: var(--i-dim); font-family: var(--i-mono); }
.iHomeBar { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
  width: 139px; height: 5px; border-radius: 3px; background: var(--i-muted); opacity: 0.5; z-index: 4; }

/* ── Token board ─────────────────────────────────────────────────────── */
.iBoardGroup { margin-bottom: 16px; }
.iBoardLabel { font-family: var(--i-mono); font-size: 9px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: #7a7f88; margin-bottom: 8px; }
.iSwatchRow { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.iSwatch { width: 26px; height: 26px; border-radius: 6px; flex: none;
  border: 1px solid rgba(255,255,255,0.12); }
.iSwName { font-size: 12px; color: #d8dbe0; width: 118px; }
.iSwHex { font-family: var(--i-mono); font-size: 11px; color: #9aa0aa; }
.iSwRatio { font-family: var(--i-mono); font-size: 10.5px; margin-left: auto; }

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
.iDetailTitle { font-size: 16px; font-weight: 600; color: var(--i-ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.iDetailSub { font-size: 11px; color: var(--i-muted); font-family: var(--i-mono); }
.iGearSm { width: 28px; height: 28px; }
.iStreamBadge { display: inline-flex; align-items: center; gap: 4px; font-size: 8.5px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; font-family: var(--i-mono); color: var(--i-accent);
  padding: 2px 6px; border-radius: 999px; background: var(--i-accent-soft); }

/* ── Conversation transcript ───────────────────────────────────────────── */
.iConv { padding-top: 4px; }
.iTurn { margin-bottom: 12px; }
.iTurnLabel { display: flex; align-items: center; gap: 6px; margin: 10px 0 6px; }
.iTurnLabel span:not(.iDot) { font-size: 9px; font-weight: 700; letter-spacing: 0.15em; font-family: var(--i-mono); }
.iTurnLabel[data-role="user"] span:not(.iDot) { color: var(--i-muted); }
.iTurnLabel[data-role="agent"] span:not(.iDot) { color: var(--i-accent); }
.iMsg { font-size: 13.5px; line-height: 1.5; color: var(--i-ink); padding: 9px 12px; border-radius: 12px;
  background: linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 5%, var(--i-surface)), var(--i-surface));
  border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 0 var(--i-keylight), 0 1px 2px rgba(0,0,0,0.18); margin-bottom: 6px; }
.iMdP + .iMdP, .iMdLi { margin-top: 3px; }
.iMsg strong { color: var(--i-ink); font-weight: 700; }
.iReason { font-size: 12px; font-style: italic; color: var(--i-muted); line-height: 1.5;
  border-left: 2px solid var(--i-hairline-strong); padding: 2px 0 2px 10px; margin: 0 0 6px 2px; }
.iAct { border-radius: 12px;
  background: linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 5%, var(--i-surface)), var(--i-surface));
  border: 1px solid var(--i-hairline-strong);
  box-shadow: inset 0 1px 0 var(--i-keylight), 0 1px 2px rgba(0,0,0,0.18);
  padding: 9px 11px; margin-bottom: 6px; }
.iActHead { display: flex; align-items: center; gap: 7px; }
.iActIcon { color: var(--i-muted); flex: none; display: grid; place-items: center; }
.iActTitle { font-size: 11.5px; font-weight: 600; font-family: var(--i-mono); color: var(--i-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iActStatus { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  font-family: var(--i-mono); flex: none; }
.iActStatus[data-s="ok"] { color: var(--i-ok); }
.iActStatus[data-s="error"] { color: var(--i-error); }
.iActStatus[data-s="running"] { color: var(--i-accent); }
.iActOut { font-size: 10.5px; font-family: var(--i-mono); color: var(--i-muted); margin-top: 6px;
  line-height: 1.4; white-space: pre-wrap; }
.iApproval { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--i-hairline); }
.iApprovalDesc { font-size: 11.5px; color: var(--i-muted); line-height: 1.45; }
.iApprovalRow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.iRiskBadge { font-size: 8.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  font-family: var(--i-mono); padding: 2px 6px; border-radius: 999px; }
.iRiskBadge[data-r="low"] { color: var(--i-ok); background: color-mix(in oklab, var(--i-ok) 14%, transparent); }
.iRiskBadge[data-r="med"] { color: var(--i-warn); background: color-mix(in oklab, var(--i-warn) 16%, transparent); }
.iRiskBadge[data-r="high"] { color: var(--i-error); background: color-mix(in oklab, var(--i-error) 16%, transparent); }
.iBtn { font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 9px; border: 1px solid transparent;
  cursor: pointer; font-family: var(--i-font); }
.iBtnDeny { background: transparent; color: var(--i-muted); border-color: var(--i-hairline-strong); }
.iBtnApprove { background: var(--i-accent); color: #04130d; }
.iQuestion { border-radius: 12px; padding: 10px 12px; margin-bottom: 6px;
  background: color-mix(in oklab, var(--i-warn) 8%, var(--i-surface));
  border: 1px solid color-mix(in oklab, var(--i-warn) 30%, transparent); }
.iQHead { font-size: 8.5px; font-weight: 700; letter-spacing: 0.12em; font-family: var(--i-mono); color: var(--i-warn); }
.iQText { font-size: 13.5px; color: var(--i-ink); margin: 6px 0 9px; line-height: 1.4; }
.iQOpts { display: flex; gap: 7px; }
.iQOpt { font-size: 12.5px; font-weight: 600; padding: 6px 14px; border-radius: 9px; cursor: pointer;
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
.iComposerField { flex: 1; font-size: 13px; color: var(--i-dim); padding: 9px 13px; border-radius: 11px;
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
.iTermTitle { font-size: 16px; font-weight: 600; color: var(--i-ink); }
.iTermEndpoint { font-size: 11px; color: var(--i-muted); font-family: var(--i-mono); }
.iTermBody { display: flex; flex-direction: column; padding: 8px 10px 6px; }
.iTermScreen { flex: 1; overflow: hidden; border-radius: 12px; background: #050505;
  border: 1px solid var(--i-hairline-strong); padding: 11px 12px; font-family: var(--i-mono);
  font-size: 11.5px; line-height: 1.6; }
.iTermLine { white-space: pre-wrap; word-break: break-all; color: var(--i-ink); }
.iTermLine-out { color: var(--i-muted); }
.iTermLine-dim { color: var(--i-dim); }
.iTermSigil { color: var(--i-ok); }
.iTermCursor { display: inline-block; width: 7px; height: 14px; vertical-align: -2px;
  background: var(--i-ok); animation: iBlink 1.1s steps(1) infinite; }
.iTermTray { flex: none; display: flex; align-items: center; gap: 6px; padding: 9px 2px 4px; overflow: hidden; }
.iTermKey { font-size: 11px; font-family: var(--i-mono); color: var(--i-muted); padding: 5px 9px;
  border-radius: 7px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); flex: none; }
.iTermMic { color: var(--i-accent); }
.iTermStatusPanel { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; text-align: center; padding: 0 30px; }
.iTermStatusSpin { font-size: 22px; }
.iTermStatusTitle { font-size: 15px; font-weight: 600; color: var(--i-ink); }
.iTermStatusSub { font-size: 12px; color: var(--i-muted); line-height: 1.4; }

/* ── New Session ───────────────────────────────────────────────────────── */
.iNew { padding-top: 4px; }
.iNewSection { margin-bottom: 14px; }
.iNewLabel { font-size: 9.5px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  font-family: var(--i-mono); color: var(--i-muted); padding: 8px 2px 6px; }
.iNewCard { border-radius: 14px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); padding: 12px; }
.iNewProject { display: flex; align-items: center; gap: 11px; }
.iNewProjText { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.iNewProjName { font-size: 14px; font-weight: 500; color: var(--i-ink); }
.iNewProjPath { font-size: 10.5px; font-family: var(--i-mono); color: var(--i-dim); }
.iNewAgent { display: flex; align-items: center; gap: 9px; }
.iChoice { font-size: 13px; font-weight: 500; color: var(--i-ink); display: inline-flex; align-items: center; gap: 4px; }
.iCaret2 { color: var(--i-dim); font-size: 12px; }
.iNewDot { color: var(--i-dim); }
.iTargetTok { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-family: var(--i-mono);
  color: var(--i-muted); padding: 4px 9px; border-radius: 999px; background: var(--i-bg); border: 1px solid var(--i-hairline); }
.iNewPrompt { position: relative; min-height: 96px; }
.iNewPromptText { font-size: 13.5px; line-height: 1.5; color: var(--i-ink); font-family: var(--i-mono); padding-right: 44px; }
.iMicFloat { position: absolute; right: 10px; bottom: 10px; width: 38px; height: 38px; }
.iResultCard { border-radius: 14px; padding: 12px; background: color-mix(in oklab, var(--i-ok) 8%, var(--i-surface));
  border: 1px solid color-mix(in oklab, var(--i-ok) 28%, transparent); }
.iResultHead { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--i-ink); margin-bottom: 8px; }
.iResultRow { display: flex; align-items: baseline; gap: 10px; padding: 2px 0; }
.iResultKey { font-size: 9.5px; font-family: var(--i-mono); color: var(--i-dim); text-transform: uppercase;
  letter-spacing: 0.06em; width: 92px; flex: none; }
.iResultVal { font-size: 12px; font-family: var(--i-mono); color: var(--i-ink); }
.iNewFooter { flex: none; padding: 8px 14px 16px; border-top: 1px solid var(--i-hairline-strong);
  background: var(--i-chrome); position: relative; z-index: 2; }
.iStartBtn { width: 100%; font-size: 14px; font-weight: 600; padding: 12px; border-radius: 12px;
  background: var(--i-accent); color: #04130d; border: none; cursor: pointer; }

/* ── Connect / route inspector + pairing ───────────────────────────────── */
.iConn { padding-top: 6px; padding-bottom: 24px; }
.iConnStatus { padding: 8px 2px 10px; }
.iConnStatusMain { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--i-ink); }
.iConnStatusMain strong { font-weight: 600; }
.iConnStatusSub { font-size: 11px; font-family: var(--i-mono); color: var(--i-muted); margin-top: 4px; padding-left: 14px; }
.iRouteLegend { display: flex; align-items: center; padding: 6px 2px 12px; }
.iRouteChip { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; font-family: var(--i-mono);
  color: var(--i-dim); padding: 4px 10px; border-radius: 7px; border: 1px solid var(--i-hairline-strong); }
.iRouteChip.on { color: var(--i-accent); border-color: color-mix(in oklab, var(--i-accent) 45%, transparent);
  background: var(--i-accent-soft); }
.iRouteArrow { color: var(--i-dim); padding: 0 7px; font-family: var(--i-mono); }
.iConnActions { display: flex; gap: 9px; padding: 4px 0 8px; }
.iBtnGhost { flex: 1; background: var(--i-surface); color: var(--i-ink); border: 1px solid var(--i-hairline-strong); }
.iBtnPrimary { flex: 1; background: var(--i-accent); color: #04130d; border: none; }
.iConnLogRow { display: flex; align-items: baseline; gap: 9px; padding: 7px 13px; font-family: var(--i-mono); }
.iConnRoute { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; color: var(--i-dim); width: 30px; flex: none; }
.iConnEvent { font-size: 10.5px; font-weight: 600; width: 74px; flex: none; }
.iConnMsg { font-size: 10.5px; color: var(--i-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iPair { padding-top: 10px; padding-bottom: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.iPairInstruction { font-size: 13px; line-height: 1.5; color: var(--i-muted); text-align: center; padding: 4px 14px 0; }
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
.iPairStatus { display: flex; align-items: center; font-size: 12px; color: var(--i-muted); font-family: var(--i-mono); }

/* ── Settings inspector ────────────────────────────────────────────────── */
.iSet { padding-top: 8px; padding-bottom: 24px; }
.iSetTabs { display: flex; gap: 4px; overflow: hidden; padding: 0 0 12px; }
.iSetTab { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; font-family: var(--i-mono);
  color: var(--i-dim); padding: 5px 9px; border-radius: 7px; cursor: pointer; flex: none; border: 1px solid transparent; }
.iSetTab.on { color: var(--i-accent); background: var(--i-accent-soft);
  border-color: color-mix(in oklab, var(--i-accent) 35%, transparent); }
.iSetSection { margin-bottom: 16px; }
.iSetRow { display: flex; align-items: center; gap: 9px; padding: 10px 13px; }
.iSetRowLabel { font-size: 13.5px; color: var(--i-ink); }
.iSetRowVal { font-size: 12px; font-family: var(--i-mono); color: var(--i-muted); }
.iForget { font-size: 8.5px; font-weight: 700; letter-spacing: 0.06em; font-family: var(--i-mono);
  color: var(--i-error); margin-left: 9px; }
.iToggle { width: 38px; height: 22px; border-radius: 999px; background: var(--i-hairline-strong);
  position: relative; flex: none; transition: background 0.15s; }
.iToggle.on { background: var(--i-accent); }
.iToggleKnob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; transition: left 0.15s; }
.iToggle.on .iToggleKnob { left: 18px; }
.iDoneBtn { font-size: 13px; font-weight: 600; color: var(--i-accent); }
.iSetNote { font-size: 11.5px; line-height: 1.5; color: var(--i-dim); padding: 0 4px; }

/* ════ Treatment layers (additive — Source is never touched) ═════════════ */

/* Tail · Kind-tone — the KIND token becomes a crisp colored chip per type, so
   the firehose is scannable by kind (mirrors the macOS Tail tone vocabulary). */
.scoutios[data-tone="kind"] .iEvKind { padding: 1px 7px; border-radius: 999px; font-weight: 700;
  font-size: 8.5px; letter-spacing: 0.05em; text-transform: uppercase; }
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
  font-size: 11px; font-weight: 700; font-family: var(--i-mono); color: var(--i-muted);
  background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }

/* Conversation · Compact — tighten blocks for a long session. */
.scoutios[data-density="compact"] .iConv .iTurn { margin-bottom: 8px; }
.scoutios[data-density="compact"] .iConv .iTurnLabel { margin: 6px 0 4px; }
.scoutios[data-density="compact"] .iMsg { padding: 7px 10px; margin-bottom: 4px; }
.scoutios[data-density="compact"] .iAct { padding: 7px 9px; margin-bottom: 4px; }
.scoutios[data-density="compact"] .iReason { margin-bottom: 4px; }
.scoutios[data-density="compact"] .iQuestion { padding: 8px 10px; margin-bottom: 4px; }

/* Conversation · Collapsed reasoning — fold each reasoning block to a chip. */
.iReasonChip { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-family: var(--i-mono);
  color: var(--i-dim); padding: 3px 9px; border-radius: 999px; background: var(--i-surface);
  border: 1px solid var(--i-hairline-strong); margin: 0 0 6px 2px; }
.iReasonChipDot { width: 4px; height: 4px; border-radius: 50%; background: var(--i-dim); }
.iReasonChipCaret { color: var(--i-dim); font-family: var(--i-mono); }
`;
