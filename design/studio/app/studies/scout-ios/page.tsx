"use client";

import { useState, useEffect } from "react";

/**
 * Scout iOS — theme study.
 *
 * The iOS app renders on Hudson's single `HudPalette` dark palette (emerald
 * accent, pure-neutral near-black) plus a thin Scout decoration layer
 * (`ScoutCanvas` wash + `scoutCard` depth). It is dark-locked — no presets, no
 * light mode, no accent switching, unlike macOS's ScoutThemeColors.
 *
 * This study rebuilds that theme in an iPhone frame so it can be seen and
 * iterated. The `--i-*` vars below are the exact native values:
 *   - HudPalette / HudHairline  (~/dev/hudson/.../HudsonUI/Tokens/HudPalette.swift)
 *   - Scout card + canvas tones  (apps/ios/Scout/Theme.swift)
 *
 * The variant toggle flips between the SHIPPED palette and a HIGHER-CONTRAST
 * proposal that mirrors the macOS contrast port: raise `dim` to clear WCAG AA,
 * lift `surface`/card off the canvas, strengthen hairlines. Everything reads
 * only from `--i-*`, so the toggle is the whole theme delta.
 */

type Variant = "shipped" | "hc";
type Surface = "home" | "comms" | "agents" | "tail";

const CSS = `
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
  border: 1px solid color-mix(in oklab, var(--i-accent) 30%, transparent);
  box-shadow: 0 0 12px color-mix(in oklab, var(--i-accent) 14%, transparent); }
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

/* ── Tab bar ─────────────────────────────────────────────────────────── */
.iTabs { flex: none; height: 52px; display: flex; padding: 7px 8px 0;
  border-top: 1.5px solid var(--i-card-edge-top); background: var(--i-chrome);
  position: relative; z-index: 2; box-shadow: 0 -6px 11px rgba(0,0,0,0.6); }
.iTab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
  color: var(--i-muted); padding-top: 2px; }
.iTab[data-on="true"] { color: var(--i-accent); }
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
`;

// ── Data ────────────────────────────────────────────────────────────────
//
// Faithful to the real app fixtures (HomeSurface.seedDemoActivity, the
// AgentsSurface tree, CommsSurface.demoConversations, Tail's TailEvent feed)
// and the recurring fleet vocabulary across the repo (openscout / hudson /
// lattices / talkie; claude / codex; relay agents; feat/* branches).

type AgentState = "live" | "idle" | "offline" | "unknown";

interface Agent {
  id: string;
  title: string;
  project: string;
  harness: string;      // claude | codex
  branch?: string;
  dirty?: number;       // git dirty count
  action?: string;      // statusLabel (current action) — drives the working card
  state: AgentState;
  age?: string;         // relative last-active
}

// The fleet roster — mirrors the demo seeds plus the recurring repo vocabulary.
// Live agents come first in their groups (sortAgents), newest first.
const FLEET: Agent[] = [
  { id: "a1", title: "broker-smith", project: "openscout", harness: "claude",
    branch: "feat/in-app-session", dirty: 3, action: "editing HomeSurface.swift",
    state: "live", age: "now" },
  { id: "a2", title: "session initiation", project: "openscout", harness: "codex",
    branch: "feat/repo-watch-web-converge", dirty: 6, action: "wiring ScoutSessionService.swift",
    state: "live", age: "now" },
  { id: "a3", title: "theme port", project: "openscout", harness: "claude",
    branch: "master", state: "idle", age: "41m" },
  { id: "a4", title: "tail-tuner", project: "hudson", harness: "codex",
    branch: "feat/tail-tokens", dirty: 0, action: "streaming tail tokens",
    state: "live", age: "now" },
  { id: "a5", title: "relay-hudson-claude", project: "hudson", harness: "claude",
    branch: "main", state: "idle", age: "2h" },
  { id: "a6", title: "lattices", project: "lattices", harness: "claude",
    branch: "feat/grid-solver", state: "idle", age: "13h 6m" },
  { id: "a7", title: "voice tray", project: "talkie", harness: "codex",
    branch: "feat/dictation", state: "idle", age: "3h" },
  { id: "a8", title: "iOS capture pass", project: "talkie", harness: "claude",
    branch: "feat/capture", state: "offline", age: "1d" },
  { id: "a9", title: "landing polish", project: "talkie", harness: "claude",
    state: "offline", age: "1d" },
];

// Paired base machines (Home machine rail). Multiple may be online; one focused.
const MACHINES: { name: string; state: "connected" | "idle" }[] = [
  { name: "studio", state: "connected" },
  { name: "mini", state: "idle" },
];

// Latest activity — Home's curated log (HomeSurface.seedDemoActivity).
type ActKind = "assistant" | "tool" | "toolResult" | "user" | "system";
interface ActEvent { id: string; kind: ActKind; summary: string; source: string; age: string; }
const ACTIVITY: ActEvent[] = [
  { id: "ev1", kind: "tool", summary: "Ran swift build — 0 errors, 0 warnings", source: "claude", age: "now" },
  { id: "ev2", kind: "assistant", summary: "Wired HudCodeHighlighter into the message renderer", source: "codex", age: "2m" },
  { id: "ev3", kind: "toolResult", summary: "Edited ConversationSurface.swift (+14 −6)", source: "claude", age: "5m" },
  { id: "ev4", kind: "tool", summary: "git commit — projects-first Home + machine rail", source: "codex", age: "14m" },
  { id: "ev5", kind: "user", summary: "ship the v0-2 ttf to hero/output", source: "claude", age: "25m" },
];
const ACT_COLOR: Record<ActKind, string> = {
  assistant: "var(--i-accent)",
  tool: "var(--i-warn)",
  toolResult: "var(--i-warn)",
  user: "var(--i-muted)",
  system: "var(--i-dim)",
};

// Comms — interleaved channels + DMs (CommsSurface.demoConversations), recency.
type CommsKind = "channel" | "group" | "system" | "direct";
type CommsStatus = "ask" | "working" | "awaiting" | "idle";
interface Convo {
  id: string; kind: CommsKind; name: string;
  preview: string; status: CommsStatus; age: string; unread?: number;
}
const COMMS: Convo[] = [
  { id: "c1", kind: "channel", name: "shared", status: "working",
    preview: "broker-smith: shipping the projects-first Home now — machine rail looks great",
    age: "2m", unread: 3 },
  { id: "c2", kind: "direct", name: "broker-smith", status: "ask",
    preview: "can you confirm the in-app session route lands on the operator DM?",
    age: "5m", unread: 1 },
  { id: "c3", kind: "direct", name: "tail-tuner", status: "working",
    preview: "Parakeet warm-up no longer cancels on thread exit", age: "12m" },
  { id: "c4", kind: "channel", name: "voice", status: "idle",
    preview: "tail-tuner: TTS + dictation pass landed in both mirrors", age: "25m" },
  { id: "c5", kind: "group", name: "openscout-ship", status: "idle",
    preview: "broker-smith: web launch flags — slice 1 is in", age: "57m" },
  { id: "c6", kind: "direct", name: "relay-hudson-claude", status: "awaiting",
    preview: "You: can you confirm the firehose still streams?", age: "1h" },
  { id: "c7", kind: "system", name: "system", status: "idle",
    preview: "bridge handshake completed · studio", age: "2h" },
];

// Tail — the live firehose (TailSurface rows). Attribution = scout/hudson/unattributed.
type Attribution = "scout" | "hudson" | "unattributed";
type TailKind = "tool" | "assistant" | "toolResult" | "user" | "system";
interface TailRow { id: string; attr: Attribution; source: string; kind: TailKind; time: string; summary: string; }
const TAIL: TailRow[] = [
  { id: "t1", attr: "scout", source: "claude", kind: "tool", time: "09:41:17",
    summary: "Ran swift build — 0 errors, 0 warnings" },
  { id: "t2", attr: "hudson", source: "codex", kind: "assistant", time: "09:41:12",
    summary: "Wired HudCodeHighlighter into the message renderer" },
  { id: "t3", attr: "scout", source: "claude", kind: "toolResult", time: "09:41:09",
    summary: "Edited ConversationSurface.swift (+14 −6)" },
  { id: "t4", attr: "scout", source: "claude", kind: "tool", time: "09:41:06",
    summary: "Read ScoutTheme.swift" },
  { id: "t5", attr: "hudson", source: "codex", kind: "tool", time: "09:41:04",
    summary: "git commit — projects-first Home + machine rail" },
  { id: "t6", attr: "unattributed", source: "system", kind: "system", time: "09:41:02",
    summary: "session.start · claude · openscout · feat/repo-watch-web-converge" },
  { id: "t7", attr: "scout", source: "claude", kind: "user", time: "09:40:55",
    summary: "ship the v0-2 ttf to hero/output" },
];
const ATTR_COLOR: Record<Attribution, string> = {
  scout: "var(--i-accent)",
  hudson: "var(--i-muted)",
  unattributed: "var(--i-dim)",
};

interface TokenRow { name: string; cssVar: string; shipped: string; hc: string; ratio?: [string, string]; }
interface TokenGroup { label: string; rows: TokenRow[]; }
const BOARD: TokenGroup[] = [
  {
    label: "Surfaces",
    rows: [
      { name: "bg", cssVar: "--i-bg", shipped: "#0a0a0a", hc: "#0a0a0a" },
      { name: "surface", cssVar: "--i-surface", shipped: "#171717", hc: "#1e1e1e" },
      { name: "chrome", cssVar: "--i-chrome", shipped: "#060606", hc: "#060606" },
    ],
  },
  {
    label: "Text (ratio on bg)",
    rows: [
      { name: "ink", cssVar: "--i-ink", shipped: "#e5e5e5", hc: "#f0f0f0", ratio: ["15.7:1", "17.4:1"] },
      { name: "muted", cssVar: "--i-muted", shipped: "#a3a3a3", hc: "#b0b0b0", ratio: ["7.9:1", "9.2:1"] },
      { name: "dim", cssVar: "--i-dim", shipped: "#737373", hc: "#808080", ratio: ["4.2:1", "5.0:1"] },
    ],
  },
  {
    label: "Structure",
    rows: [
      { name: "border", cssVar: "--i-border", shipped: "#272727", hc: "#303030" },
      { name: "hairline", cssVar: "--i-hairline", shipped: "#181818", hc: "#1c1c1c" },
      { name: "hairlineStrong", cssVar: "--i-hairline-strong", shipped: "#262626", hc: "#2e2e2e" },
    ],
  },
  {
    label: "Accent · Status",
    rows: [
      { name: "accent (emerald)", cssVar: "--i-accent", shipped: "#10b981", hc: "#10b981" },
      { name: "ok", cssVar: "--i-ok", shipped: "#22c55e", hc: "#22c55e" },
      { name: "warn", cssVar: "--i-warn", shipped: "#f59e0b", hc: "#f59e0b" },
      { name: "error", cssVar: "--i-error", shipped: "#dc2626", hc: "#dc2626" },
      { name: "info", cssVar: "--i-info", shipped: "#3b82f6", hc: "#3b82f6" },
    ],
  },
  {
    label: "Scout card depth",
    rows: [
      { name: "cardTop", cssVar: "--i-card-top", shipped: "#1b1b1e", hc: "#202024" },
      { name: "cardEdgeTop", cssVar: "--i-card-edge-top", shipped: "#383a3f", hc: "#46484f" },
      { name: "cardBottom", cssVar: "--i-card-bottom", shipped: "#131315", hc: "#161618" },
    ],
  },
];

// ── Glyphs ────────────────────────────────────────────────────────────────
//
// Hand-drawn, thin-line, single-weight marks on a 0…24 grid — recreating the
// app's unified `GlyphShape` set (Glyphs.swift). No SF Symbols, no emoji.

type GlyphKind =
  | "home" | "agent" | "agents" | "comms" | "terminal" | "plus"
  | "chevron" | "arrow" | "gear" | "folder" | "check" | "signal" | "search";

function Glyph({ kind, size = 18, rotate = 0 }: { kind: GlyphKind; size?: number; rotate?: number }) {
  const sw = Math.max(1, size * (1.5 / 24));
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: sw, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: rotate ? { transform: `rotate(${rotate}deg)` } : undefined,
  };
  switch (kind) {
    case "home": // four rounded tiles — a 2×2 dashboard
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.75" height="7.75" rx="1.9" />
          <rect x="13.25" y="3" width="7.75" height="7.75" rx="1.9" />
          <rect x="3" y="13.25" width="7.75" height="7.75" rx="1.9" />
          <rect x="13.25" y="13.25" width="7.75" height="7.75" rx="1.9" />
        </svg>
      );
    case "agent": // one figure: head + shoulder arc
      return (
        <svg {...common}>
          <ellipse cx="12" cy="7.9" rx="3.2" ry="3.2" />
          <path d="M5.3 19.3Q12 12.4 18.7 19.3" />
        </svg>
      );
    case "agents": // two figures
      return (
        <svg {...common}>
          <ellipse cx="8.6" cy="7.8" rx="2.4" ry="2.4" />
          <path d="M3.6 18.2Q8.6 11.4 13.6 18.2" />
          <ellipse cx="15.6" cy="10" rx="2.6" ry="2.6" />
          <path d="M10.4 20.4Q15.9 13 21.4 20.4" />
        </svg>
      );
    case "comms": // single speech bubble + short tail
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="11.5" rx="3.4" />
          <path d="M8.5 16L7 20l5.5-4" />
        </svg>
      );
    case "terminal": // window + ›_ prompt
      return (
        <svg {...common}>
          <rect x="2.5" y="4" width="19" height="16" rx="3" />
          <path d="M6.5 10l3 3-3 3M11.5 16h4" />
        </svg>
      );
    case "plus": // rounded square + plus
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3.6" />
          <path d="M12 9v6M9 12h6" />
        </svg>
      );
    case "chevron": // canonical ›
      return <svg {...common}><path d="M9.5 6l6 6-6 6" /></svg>;
    case "arrow": // canonical →
      return <svg {...common}><path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5" /></svg>;
    case "gear":
      return (
        <svg {...common}>
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V20a2 2 0 11-4 0v-.1A1.6 1.6 0 005 18.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H1a2 2 0 110-4h.1A1.6 1.6 0 002.7 5l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H8a1.6 1.6 0 001-1.5V1a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V8a1.6 1.6 0 001.5 1H23a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 8.5v-2h5.5l2 2" />
          <rect x="3" y="8.5" width="18" height="10.5" rx="2.2" />
        </svg>
      );
    case "check":
      return <svg {...common}><path d="M5 12.8l5 5 9-11.2" /></svg>;
    case "signal": // wi-fi / connection
      return (
        <svg {...common}>
          <circle cx="12" cy="18" r="1" />
          <path d="M9.4 16.4Q12 12.4 14.6 16.4M6.8 15.2Q12 8.4 17.2 15.2M4.3 14Q12 4.6 19.7 14" />
        </svg>
      );
    case "search":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l4.5 4.5" /></svg>;
  }
}

// The real docked tab bar (RootView): Home · Agents · Comms · Terminal · New,
// hand-drawn glyphs, accent-on-active / muted-inactive. Tail folds into Home's
// activity preview in the app, so the study's Tail surface lights the Home tab.
// Terminal + New are out of scope for this study (rendered inert in the bar).
const TABS: { label: string; kind: GlyphKind; activeFor?: Surface[] }[] = [
  { label: "Home", kind: "home", activeFor: ["home", "tail"] },
  { label: "Agents", kind: "agent", activeFor: ["agents"] },
  { label: "Comms", kind: "comms", activeFor: ["comms"] },
  { label: "Terminal", kind: "terminal" },
  { label: "New", kind: "plus" },
];

// ── Shared surface bits ───────────────────────────────────────────────────

/** Per-state dot: live = pulsing accent, idle = muted filled, offline/unknown = hollow ring. */
function StateDot({ state }: { state: AgentState }) {
  if (state === "live") return <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />;
  if (state === "idle") return <span className="iDot" style={{ background: "var(--i-muted)" }} />;
  return <span className="iRing" />;
}

/** Section header — HudSectionLabel: caps mono micro, optional pulsing dot + trailing "All". */
function SectionHeader({ label, live, all }: { label: string; live?: boolean; all?: boolean }) {
  return (
    <div className="iSec">
      {live && <span className="iPulse" />}
      <span className="iSecLabel">{label}</span>
      {all && <span className="iSecAll">All</span>}
    </div>
  );
}

/** Tree connector for a nested agent leaf (vertical rail + tick; last = elbow). */
function TreeRail({ last }: { last: boolean }) {
  return (
    <svg className="iTree" viewBox="0 0 18 40" fill="none" stroke="currentColor"
      strokeWidth={1} strokeLinecap="round" preserveAspectRatio="none">
      <path d={`M1 0V${last ? 20 : 40}M1 20H17`} />
    </svg>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────
//
// Projects-first fleet landing (HomeSurface.swift): machine rail · search ·
// currently working · projects (one-child compression + tree leaves) ·
// latest activity.

function HomeSurface() {
  const live = FLEET.filter((a) => a.state === "live");
  // group by project, sorted: live projects first
  const groups = groupByProject(FLEET);

  return (
    <div className="iBody">
      {/* Machine rail */}
      <div className="iRail">
        <span className="iRailCap">MACHINES</span>
        <div className="iRailScroll">
          {MACHINES.map((m) => (
            <span key={m.name} className={`iChip ${m.state === "connected" ? "on" : "off"}`}>
              {m.state === "connected"
                ? <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />
                : <span className="iDot" style={{ background: "var(--i-dim)" }} />}
              <span className="iChipName">{m.name}</span>
            </span>
          ))}
          <span className="iChip off iChipAdd">
            <Glyph kind="plus" size={9} /><span className="iChipName">Add</span>
          </span>
        </div>
      </div>

      {/* Search the fleet */}
      <div className="iField">
        <Glyph kind="search" size={15} /><span>Search the fleet</span>
      </div>

      {/* Currently working */}
      <SectionHeader label={`Currently working · ${live.length} live`} live />
      <div className="iWorkScroll">
        {live.map((a) => (
          <div className="iWorkCard" key={a.id}>
            <span className="iCorner tl" /><span className="iCorner tr" />
            <div className="iWorkTop">
              <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />
              <span className="iWorkName">{a.title}</span>
            </div>
            <div className="iWorkAction">{a.action ?? "working"}<span className="iCaret" /></div>
            <div className="iWorkMeta">{workingMeta(a)}</div>
          </div>
        ))}
      </div>

      {/* Projects — inside a scoutCard, one-child compression + tree leaves */}
      <SectionHeader label="Projects" all />
      <div className="iCard">
        {groups.map((g, gi) => {
          const solo = g.agents.length === 1 ? g.agents[0] : null;
          const liveCount = g.agents.filter((a) => a.state === "live").length;
          return (
            <div key={g.name}>
              {gi > 0 && <div className="iRowSep" />}
              <div className="iRow">
                <span className="iFolder"><Glyph kind="folder" size={15} /></span>
                <span className="iProjName">{g.name}</span>
                <span className="iSlash">/</span>
                {solo ? (
                  <span className="iLeaf">
                    <span className="glyf"><Glyph kind="agent" size={12} /></span>
                    {soloLabel(solo)}
                    {solo.harness && <span className="iPill">{solo.harness}</span>}
                  </span>
                ) : (
                  <span className="iLeaf">
                    <span className="glyf"><Glyph kind="agents" size={13} /></span>
                    {g.agents.length} agents
                  </span>
                )}
                {liveCount > 0 && <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />}
                <span className="iSpacer" />
                <span className="iAge">{g.age}</span>
                {solo
                  ? <span className="iChev"><Glyph kind="arrow" size={13} /></span>
                  : <span className="iChev"><Glyph kind="chevron" size={13} /></span>}
              </div>
              {/* multi-agent projects expand to leaves */}
              {!solo && g.agents.map((a, ai) => (
                <div key={a.id}>
                  <div className="iRowSep inset" />
                  <div className="iLeafRow">
                    <TreeRail last={ai === g.agents.length - 1} />
                    <span className="iFolder" style={{ color: a.state === "live" ? "var(--i-accent)" : "var(--i-dim)" }}>
                      <Glyph kind="agent" size={13} />
                    </span>
                    <span className={`iAgentName ${a.state === "live" ? "" : "dim"}`}>{leafTitle(a, g.name)}</span>
                    {a.state === "live" && <span className="iCaret" />}
                    {a.harness && <><span className="iAgentTok">·</span><span className="iAgentTok">{a.harness}</span></>}
                    <span className="iSpacer" />
                    <span className={`iAge ${a.state === "live" ? "live" : ""}`}>{a.age}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Latest activity — inside a scoutCard */}
      <SectionHeader label="Latest activity" all />
      <div className="iCard">
        {ACTIVITY.map((e, i) => (
          <div key={e.id}>
            {i > 0 && <div className="iRowSep" />}
            <div className="iActRow">
              <span className="iDot iActDot" style={{ background: ACT_COLOR[e.kind] }} />
              <div className="iActBody">
                <div className="iActSummary">{e.summary}</div>
                <div className="iActMeta">{e.source} · {e.kind} · {e.age}</div>
              </div>
              <span className="iChev" style={{ marginTop: 3 }}><Glyph kind="chevron" size={13} /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agents ──────────────────────────────────────────────────────────────────
//
// Bridge directory as a project navigator (AgentsSurface.swift): search · a
// summary bar with a PROJECT|RECENT sort toggle · project sections (tree) or a
// flat most-recent list.

function AgentsSurface({ sort, onSort }: { sort: "project" | "recent"; onSort: (s: "project" | "recent") => void }) {
  const liveCount = FLEET.filter((a) => a.state === "live").length;
  const groups = groupByProject(FLEET);
  const summary = liveCount > 0
    ? `${FLEET.length} agents · ${liveCount} live`
    : `${FLEET.length} agents · ${groups.length} projects`;
  const recents = [...FLEET].sort((a, b) =>
    (a.state === "live" ? 0 : 1) - (b.state === "live" ? 0 : 1) || ageRank(a.age) - ageRank(b.age));

  return (
    <div className="iBody">
      <div className="iField">
        <Glyph kind="search" size={15} /><span>Search agents</span>
      </div>

      <div className="iSummary">
        <span className="iSecLabel">{summary.toUpperCase()}</span>
        <div className="iSort">
          <span className={`iSortBtn ${sort === "project" ? "on" : ""}`} onClick={() => onSort("project")}>PROJECT</span>
          <span className={`iSortBtn ${sort === "recent" ? "on" : ""}`} onClick={() => onSort("recent")}>RECENT</span>
        </div>
      </div>

      {sort === "project" ? (
        groups.map((g) => {
          const solo = g.agents.length === 1 ? g.agents[0] : null;
          const liveN = g.agents.filter((a) => a.state === "live").length;
          if (solo) {
            return (
              <div key={g.name}>
                <AgentLeaf agent={solo} showProject />
                <div className="iADivider" />
              </div>
            );
          }
          return (
            <div key={g.name}>
              <div className="iProjHead">
                <span className="iProjGlyph"><i /><i /><i /><i /></span>
                <span className="iProjHeadName">{g.name}</span>
                <span className="iSpacer" />
                {liveN > 0 && <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />}
                <span className="iCount">{g.agents.length}</span>
                <span className="iChev"><Glyph kind="chevron" size={13} /></span>
              </div>
              {g.agents.map((a, ai) => (
                <AgentLeaf key={a.id} agent={a} tree={{ last: ai === g.agents.length - 1 }} />
              ))}
              <div className="iADivider" />
            </div>
          );
        })
      ) : (
        recents.map((a, i) => (
          <div key={a.id}>
            <AgentLeaf agent={a} />
            {i < recents.length - 1 && <div className="iADivider" />}
          </div>
        ))
      )}
    </div>
  );
}

/** One AgentRow: optional tree rail, state dot, name, session line (project · branch), age, harness. */
function AgentLeaf({ agent, tree, showProject }: { agent: Agent; tree?: { last: boolean }; showProject?: boolean }) {
  const parts = [showProject ? agent.project : null, agent.branch].filter(Boolean);
  const sessionLine = parts.length ? parts.join(" · ") : null;
  return (
    <div className="iLeafRow" style={{ background: "transparent", paddingLeft: tree ? 13 : 16 }}>
      {tree && <TreeRail last={tree.last} />}
      <StateDot state={agent.state} />
      <div className="iAgentMain">
        <span className="iAgentName" style={{ fontWeight: tree ? 400 : 500 }}>{agent.title}</span>
        {sessionLine && <span className="iSessionLine">{sessionLine}</span>}
      </div>
      <span className="iSpacer" />
      {agent.age && <span className="iAge" style={{ color: "var(--i-dim)" }}>{agent.age}</span>}
      {agent.harness && <span className="iHarness">{agent.harness}</span>}
    </div>
  );
}

// ── Comms ───────────────────────────────────────────────────────────────────
//
// Operator's window into the mesh (CommsSurface.swift): search · one interleaved
// list of channels + DMs, each: type glyph · name (fixed col) · status separator
// · preview · age · unread capsule. Unread rows get a neutral tint + accent rail.

function CommsSurface() {
  return (
    <div className="iBody">
      <div className="iField">
        <Glyph kind="search" size={15} /><span>Search conversations</span>
      </div>
      {COMMS.map((c, i) => (
        <div key={c.id}>
          <div className={`iCommsRow ${c.unread ? "unread" : ""}`}>
            {c.unread && <span className="iCommsRail" />}
            <span className="iCommsType"><CommsTypeGlyph kind={c.kind} /></span>
            <span className={`iCommsName ${c.unread ? "unread" : ""}`}>{c.name}</span>
            <span className="iCommsStatus"><CommsStatusGlyph status={c.status} /></span>
            <span className="iCommsPreview">{c.preview}</span>
            <span className="iCommsAge">{c.age}</span>
            {c.unread ? <span className="iUnread">{c.unread}</span> : null}
          </div>
          {i < COMMS.length - 1 && <div className="iCommsSep" />}
        </div>
      ))}
    </div>
  );
}

/** Conversation-type glyph: `#` channel · `•••` group · system asterisk · DM blank. */
function CommsTypeGlyph({ kind }: { kind: CommsKind }) {
  if (kind === "channel") {
    return (
      <svg width={15} height={15} viewBox="0 0 15 15" fill="none" stroke="currentColor"
        strokeWidth={1.4} strokeLinecap="round">
        <path d="M6.3 2.4L5.1 12.6M10.5 2.4L9.3 12.6M2.7 6h9.9M2.4 9.3h9.9" />
      </svg>
    );
  }
  if (kind === "group") return <span className="iGroupDots"><i /><i /><i /></span>;
  if (kind === "system") {
    return (
      <svg width={15} height={15} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
        <path d="M7.5 2.5v10M3.2 5l8.6 5M11.8 5l-8.6 5" />
      </svg>
    );
  }
  return null; // direct: blank
}

/** The status separator: `?` ask (accent) · braille spinner working (accent) · `›` awaiting · `·` idle. */
function CommsStatusGlyph({ status }: { status: CommsStatus }) {
  if (status === "ask") return <span style={{ color: "var(--i-accent)" }}>?</span>;
  if (status === "working") return <BrailleSpinner />;
  if (status === "awaiting") return <span style={{ color: "var(--i-muted)" }}>›</span>;
  return <span style={{ color: "var(--i-dim)" }}>·</span>;
}

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function BrailleSpinner() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF((x) => (x + 1) % BRAILLE.length), 90);
    return () => clearInterval(id);
  }, []);
  return <span className="iBraille">{BRAILLE[f]}</span>;
}

// ── Tail ────────────────────────────────────────────────────────────────────
//
// The live firehose (TailSurface.swift): a "Tail" header + a live indicator
// pill; event rows in inset cards — attribution badge · source · kind · time,
// then the summary line.

function TailSurface() {
  return (
    <div className="iBody">
      <div className="iTailHead">
        <span className="iSecLabel">TAIL</span>
        <span className="iLiveInd">
          <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />
          <span>live</span>
        </span>
      </div>
      {TAIL.map((e) => (
        <div className="iEv" key={e.id}>
          <div className="iEvTop">
            <span className="iBadge" style={{ color: ATTR_COLOR[e.attr] }}><i />{e.attr}</span>
            <span className="iEvSource">{e.source}</span>
            <span className="iEvKind">{e.kind}</span>
            <span className="iEvTime">{e.time}</span>
          </div>
          <div className="iEvText">{e.summary}</div>
        </div>
      ))}
    </div>
  );
}

// ── Surface data helpers ──────────────────────────────────────────────────

interface Group { name: string; agents: Agent[]; age: string; }
function groupByProject(list: Agent[]): Group[] {
  const map = new Map<string, Agent[]>();
  for (const a of list) {
    const arr = map.get(a.project) ?? [];
    arr.push(a);
    map.set(a.project, arr);
  }
  const groups: Group[] = [];
  for (const [name, agents] of map) {
    const sorted = [...agents].sort((x, y) =>
      stateRank(x.state) - stateRank(y.state) || ageRank(x.age) - ageRank(y.age));
    groups.push({ name, agents: sorted, age: sorted[0]?.age ?? "" });
  }
  // live projects first, then by recency of their freshest agent
  return groups.sort((a, b) => {
    const la = a.agents.some((x) => x.state === "live") ? 0 : 1;
    const lb = b.agents.some((x) => x.state === "live") ? 0 : 1;
    return la - lb || ageRank(a.age) - ageRank(b.age);
  });
}
function stateRank(s: AgentState) { return s === "live" ? 0 : s === "idle" ? 1 : s === "unknown" ? 2 : 3; }
function ageRank(age?: string) {
  if (!age) return 9999;
  if (age === "now") return 0;
  const m = age.match(/(\d+)\s*m/); if (m && !age.includes("h")) return parseInt(m[1]);
  const h = age.match(/(\d+)\s*h/); if (h) return parseInt(h[1]) * 60;
  const d = age.match(/(\d+)\s*d/); if (d) return parseInt(d[1]) * 1440;
  return 9999;
}
/** Working-card meta: project · +dirty · ⎇branch (the live strip omits the age). */
function workingMeta(a: Agent) {
  const parts: string[] = [a.project];
  if (a.dirty && a.dirty > 0) parts.push(`+${a.dirty}`);
  if (a.branch) parts.push(`⎇ ${a.branch}`);
  return parts.join(" · ");
}
/** A solo project's compressed agent label — drop the agent title when it just
 * restates the project (homeAgentDisplayTitle), falling back to the harness/branch. */
function soloLabel(a: Agent) {
  if (sameIdentity(a.title, a.project)) return a.harness ?? a.branch ?? "agent";
  return a.title;
}
function leafTitle(a: Agent, project: string) {
  if (sameIdentity(a.title, project)) return a.harness ?? a.branch ?? "agent";
  return a.title;
}
function sameIdentity(x: string, y: string) {
  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return k(x) === k(y);
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function ScoutIOSStudy() {
  const [variant, setVariant] = useState<Variant>("shipped");
  const [surface, setSurface] = useState<Surface>("home");
  const [agentSort, setAgentSort] = useState<"project" | "recent">("project");

  return (
    <div style={{ minHeight: "100%", background: "#0b0c0e", color: "#e7e9ee", padding: "28px 32px 64px" }}>
      <style>{CSS}</style>

      <header style={{ maxWidth: 980, margin: "0 auto 22px" }}>
        <div style={{ fontFamily: "var(--i-mono, monospace)", fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#10b981" }}>
          Studies · iOS
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: "6px 0 6px" }}>
          Scout iOS — theme study
        </h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#9aa0aa", maxWidth: 620 }}>
          The iOS app renders on Hudson&rsquo;s <code style={{ fontFamily: "var(--i-mono,monospace)", color: "#cdd2db" }}>HudPalette</code> dark
          palette (emerald accent, dark-locked — no presets or light mode) plus a thin Scout layer
          (<code style={{ fontFamily: "var(--i-mono,monospace)", color: "#cdd2db" }}>ScoutCanvas</code> wash + <code style={{ fontFamily: "var(--i-mono,monospace)", color: "#cdd2db" }}>scoutCard</code> depth).
          Toggle the proposed higher-contrast palette — it mirrors the macOS dark port: raise <code style={{ fontFamily: "var(--i-mono,monospace)", color: "#cdd2db" }}>dim</code> past
          WCAG AA, lift surface/card off the canvas, strengthen hairlines.
        </p>
      </header>

      {/* controls */}
      <div style={{ maxWidth: 980, margin: "0 auto 20px", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <Seg label="Palette" value={variant} onChange={(v) => setVariant(v as Variant)}
          options={[{ id: "shipped", label: "Shipped" }, { id: "hc", label: "Higher-contrast" }]} />
        <Seg label="Surface" value={surface} onChange={(v) => setSurface(v as Surface)}
          options={[{ id: "home", label: "Home" }, { id: "comms", label: "Comms" }, { id: "agents", label: "Agents" }, { id: "tail", label: "Tail" }]} />
      </div>

      {/* stage */}
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gridTemplateColumns: "418px 1fr", gap: 40, alignItems: "start" }}>
        <div className="scoutios" data-v={variant}>
          <div className="iPhone">
            <div className="iScreen">
              <div className="iNotch" />
              <div className="iStatus">
                <span>9:41</span>
                <div className="iStatusGlyphs">
                  <div className="iBars"><i style={{ height: 4 }} /><i style={{ height: 6 }} /><i style={{ height: 8 }} /><i style={{ height: 11 }} /></div>
                  <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="var(--i-ink)" strokeWidth="1.4">
                    <path d="M1 4.5a10 10 0 0114 0M3.5 7a6 6 0 019 0M8 9.5h.01" strokeLinecap="round" />
                  </svg>
                  <div className="iBatt"><div className="iBattFill" /></div>
                </div>
              </div>
              {/* Masthead — "Scout" wordmark + gear over a hairline (RootView) */}
              <div className="iHead">
                <div className="iMast">
                  <span className="iWordmark">Scout</span>
                  <span className="iGear"><Glyph kind="gear" size={20} /></span>
                </div>
                <div className="iMastRule" />
              </div>

              {surface === "home" && <HomeSurface />}
              {surface === "comms" && <CommsSurface />}
              {surface === "agents" && <AgentsSurface sort={agentSort} onSort={setAgentSort} />}
              {surface === "tail" && <TailSurface />}

              {/* Docked tab bar — Home · Agents · Comms · Terminal · New */}
              <div className="iTabs">
                {TABS.map((t) => (
                  <div className="iTab" key={t.label} data-on={t.activeFor?.includes(surface) ?? false}>
                    <Glyph kind={t.kind} size={19} />
                    <span className="iTabLabel">{t.label}</span>
                  </div>
                ))}
              </div>

              {/* Bottom cockpit status bar (ScoutStatusBar) */}
              <div className="iStatusBar">
                <div className="iSbRun">
                  <span className="iSbCell"><Glyph kind="signal" size={11} /><span className="iSbLabel" style={{ color: "var(--i-accent)" }}>LAN</span></span>
                  <span className="iSbDot">·</span>
                  <span className="iSbCell"><span className="iDot" style={{ background: "var(--i-accent)" }} /><span className="iSbLabel">studio</span></span>
                </div>
                <div className="iSbRun">
                  <span className="iSbCell"><span className="iSbLabel">9 agents</span></span>
                  <span className="iSbDot">·</span>
                  <span className="iSbCell"><span className="iSbLabel" style={{ color: "var(--i-accent)" }}>3 active</span></span>
                  <span className="iSbDot">·</span>
                  <span className="iSbCell"><span className="iSbLabel" style={{ color: "var(--i-accent)" }}>1/2 online</span></span>
                </div>
              </div>
              <div className="iHomeBar" />
            </div>
          </div>
        </div>

        {/* token board */}
        <div className="scoutios" data-v={variant}>
          <div style={{ fontFamily: "var(--i-mono,monospace)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7f88", marginBottom: 14 }}>
            Tokens — {variant === "shipped" ? "shipped (native HudPalette)" : "higher-contrast (proposed)"}
          </div>
          {BOARD.map((g) => (
            <div className="iBoardGroup" key={g.label}>
              <div className="iBoardLabel">{g.label}</div>
              {g.rows.map((r) => {
                const hex = variant === "shipped" ? r.shipped : r.hc;
                const ratio = r.ratio ? (variant === "shipped" ? r.ratio[0] : r.ratio[1]) : null;
                const sub = ratio && parseFloat(ratio) < 4.5;
                return (
                  <div className="iSwatchRow" key={r.name}>
                    <span className="iSwatch" style={{ background: hex }} />
                    <span className="iSwName">{r.name}</span>
                    <span className="iSwHex">{hex}</span>
                    {ratio && (
                      <span className="iSwRatio" style={{ color: sub ? "#f08" : "#5fb98a" }}>
                        {ratio}{sub ? " ⚠" : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "#7a7f88", marginTop: 4, maxWidth: 360 }}>
            <strong style={{ color: "#9aa0aa" }}>Note.</strong> <code style={{ fontFamily: "var(--i-mono,monospace)" }}>HudPalette</code> is
            shared across all Hudson apps — raising <code style={{ fontFamily: "var(--i-mono,monospace)" }}>dim</code> there is a Hudson
            decision (it&rsquo;s a sub-AA correctness fix), or Scout overrides it app-side. Card separation rides the
            edge-highlight + shadow, not fill delta. Accent is Hudson emerald, not Scout indigo — a brand-parity
            call to make on purpose.
          </p>
        </div>
      </div>
    </div>
  );
}

function Seg({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontFamily: "var(--i-mono,monospace)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a7f88" }}>{label}</span>
      <div style={{ display: "inline-flex", padding: 3, borderRadius: 9, background: "#15171a", border: "1px solid #24272c" }}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button key={o.id} onClick={() => onChange(o.id)}
              style={{
                fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 7, border: "none",
                cursor: "pointer", color: on ? "#04130d" : "#aab0ba",
                background: on ? "#10b981" : "transparent", transition: "background 0.12s",
              }}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
