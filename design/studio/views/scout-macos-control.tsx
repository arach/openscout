/**
 * Scout macOS · Control — the existing style, reconstructed.
 *
 * The macOS refresh has been iterating on a "more elevated" direction
 * (/studies/scout-macos): frosted glass, ambient glow, corner ticks, bracketed
 * controls, hand-drawn glyphs, bubbles. Those renders read as a big leap — but
 * a chunk of the leap is plating the studio hands you for free. Its default skin
 * is dark with a neon-chartreuse accent, so the elevated windows inherited dark
 * canvas + glow + green before one deliberate decision was made.
 *
 * This study is the *control*, and it is built to be an honest test. Two things
 * are held as independent axes:
 *
 *   • MODE       — Light (Juniper) ⇄ Dark (Juniper). The shipping app has both.
 *   • TREATMENT  — Existing (flat hairlines · SF Symbols · sender-led transcript)
 *                  ⇄ Elevated (frosted glass · corner ticks · hand-drawn glyphs
 *                  · bubbles).
 *
 * The before/after is the TREATMENT, always within a single mode — so a dark↔
 * light swap never masquerades as the improvement (the earlier mistake). Both
 * treatments use the app's real INDIGO accent, never the studio's green; the
 * elevated side no longer cheats with green-on-black. Content is identical
 * across all four cells (the full refreshed Comms — recency list, pinned ask,
 * reply-context backlink, signed-off inspector blocks), so the only variable in
 * the before/after is the treatment language itself.
 *
 * Palettes lifted from apps/macos/Sources/Scout/ScoutTheme.swift (Juniper Light
 * + Dark, Indigo accent); layout from ScoutCommsView.swift / ScoutRootView.swift.
 * Static reference only. Status: concept.
 */

"use client";

import { useState } from "react";
import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ════════════════════════════════════════════════════════════════════
   Palettes — the DEFAULT shipped Juniper skins (light + dark), Indigo
   accent, hardcoded so the reconstruction is faithful regardless of the
   studio's own theme. Source: ScoutTheme.swift providers.
   ════════════════════════════════════════════════════════════════════ */

type Pal = {
  mode: "light" | "dark";
  bg: string; chrome: string; surface: string;
  ink: string; ink2: string; muted: string; dim: string;
  border: string; hairline: string; hairlineStrong: string;
  accent: string; accentSoft: string; accentOn: string; accentShadow: string;
  okFg: string; okBg: string; warnFg: string; warnBg: string; errFg: string;
  // glass derivations (elevated treatment)
  glassFill: string; glassRaised: string; glassBorder: string;
  glassInset: string; glassShadow: string; windowShadow: string;
  meBubbleShadow: string; bubbleShadow: string;
};

const LIGHT: Pal = {
  mode: "light",
  bg: "#F3F6F8", chrome: "#E7E8EE", surface: "#FDFDFF",
  ink: "#121428", ink2: "#2A2E40", muted: "#58606B", dim: "#828A95",
  border: "#CDD2DB", hairline: "#DFE2E9", hairlineStrong: "#BBC2CD",
  accent: "#3E66CC", accentSoft: "#E4EAF9", accentOn: "#FFFFFF",
  accentShadow: "0 1px 3px rgba(62,102,204,.12)",
  okFg: "#2F7D55", okBg: "#E4F0E9", warnFg: "#A66012", warnBg: "#F4EBDA", errFg: "#B83A45",
  glassFill: "rgba(253,253,255,0.55)", glassRaised: "rgba(255,255,255,0.88)", glassBorder: "#BBC2CD",
  glassInset: "rgba(255,255,255,0.7)",
  glassShadow: "0 8px 20px -12px rgba(20,20,40,.30)",
  windowShadow: "0 24px 60px -30px rgba(20,20,40,.45), 0 2px 6px -3px rgba(20,20,40,.25)",
  meBubbleShadow: "0 6px 16px -8px rgba(62,102,204,.45)",
  bubbleShadow: "0 1px 2px rgba(20,20,40,.05), 0 6px 16px -8px rgba(20,20,40,.16)",
};

const DARK: Pal = {
  mode: "dark",
  bg: "#191919", chrome: "#0F0F0F", surface: "#292929",
  ink: "#F5F5F5", ink2: "#DADADA", muted: "#B6B6B6", dim: "#868686",
  border: "rgba(180,180,180,0.22)", hairline: "rgba(180,180,180,0.12)", hairlineStrong: "rgba(180,180,180,0.28)",
  accent: "#5585E6", accentSoft: "rgba(85,133,230,0.22)", accentOn: "#FFFFFF",
  accentShadow: "0 1px 6px rgba(85,133,230,.22)",
  okFg: "#54C98E", okBg: "rgba(84,201,142,0.16)", warnFg: "#EFA044", warnBg: "rgba(239,160,68,0.16)", errFg: "#F15A60",
  glassFill: "rgba(41,41,41,0.55)", glassRaised: "rgba(48,48,48,0.92)", glassBorder: "rgba(180,180,180,0.28)",
  glassInset: "rgba(255,255,255,0.10)",
  glassShadow: "0 8px 22px -10px rgba(0,0,0,.6)",
  windowShadow: "0 30px 70px -34px rgba(0,0,0,.8), 0 2px 6px -2px rgba(0,0,0,.5)",
  meBubbleShadow: "0 6px 16px -8px rgba(85,133,230,.55)",
  bubbleShadow: "0 1px 2px rgba(0,0,0,.35), 0 6px 16px -8px rgba(0,0,0,.55)",
};

const UI = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

const glassWindow = (p: Pal): React.CSSProperties => ({
  background: p.glassFill,
  backdropFilter: "blur(28px) saturate(140%)",
  WebkitBackdropFilter: "blur(28px) saturate(140%)",
  border: `1px solid ${p.glassBorder}`,
  boxShadow: `inset 0 1px 0 0 ${p.glassInset}, ${p.windowShadow}`,
});
const glassPanel = (p: Pal): React.CSSProperties => ({
  background: p.glassFill,
  border: `1px solid ${p.glassBorder}`,
  boxShadow: `inset 0 1px 0 0 ${p.glassInset}`,
});
const glassRaised = (p: Pal): React.CSSProperties => ({
  background: p.glassRaised,
  border: `1px solid ${p.glassBorder}`,
  boxShadow: `inset 0 1px 0 0 ${p.glassInset}, ${p.glassShadow}`,
});

const pipColor = (p: Pal, state: Conv["state"]) =>
  // green eliminated: available reads neutral; indigo = active, amber = needs you only
  ({ working: p.accent, available: p.dim, "needs-attention": p.warnFg, idle: p.dim, offline: p.dim }[state]);

/* ════════════════════════════════════════════════════════════════════
   Shared content — one Comms surface, rendered by both treatments in
   both modes. Holding this constant is the point: the only variable in
   the before/after is the treatment.
   ════════════════════════════════════════════════════════════════════ */

type Group = "now" | "today" | "earlier";
type Ask = "pending" | "answered" | null;
type Conv = {
  name: string; monogram: string; preview: string; time: string;
  unread: number; state: "working" | "available" | "needs-attention" | "idle" | "offline";
  ask: Ask; group: Group;
};

const CONVS: Conv[] = [
  { name: "Dewey", monogram: "D", preview: "On it. Moved resolveStartupTheme() ahead of the composer mount; the inspector shows the resolved skin badge now.", time: "2m", unread: 2, state: "working", ask: "answered", group: "now" },
  { name: "Hudson", monogram: "H", preview: "Reviewed — talkie-overlay-settings polished, moved the no-fly list inline.", time: "8m", unread: 0, state: "available", ask: null, group: "now" },
  { name: "Scout · iOS pairing", monogram: "S", preview: "QR handoff from iOS. Awaiting the second-device scan.", time: "11m", unread: 1, state: "needs-attention", ask: "pending", group: "now" },
  { name: "Atlas", monogram: "A", preview: "Dropped the iconography study. Want to walk through it?", time: "22m", unread: 0, state: "available", ask: null, group: "today" },
  { name: "Preframe", monogram: "P", preview: "Standup is in 5m — I'll bring up the worktree map.", time: "1h", unread: 0, state: "idle", ask: null, group: "today" },
  { name: "Lattices", monogram: "L", preview: "Pushed a fix for the new-conversation footer button.", time: "1d", unread: 0, state: "offline", ask: null, group: "earlier" },
];

type Turn = {
  me: boolean; author: string; monogram: string; time: string; body: string;
  replyTo?: { title: string; from: string; status: "working" | "done" };
  card?: { head: string; body: string };
};

const TURNS: Turn[] = [
  { me: false, author: "Dewey", monogram: "D", time: "2:15 PM", replyTo: { title: "surface the active theme in the inspector", from: "Art", status: "done" }, body: "Three changes, highest-impact first: make Library a full-height pane, rebuild Overview around now (not inventory), and kill the date-parse hot path in the sort comparators. Items 1–2 are view-layer; 3 is store-layer." },
  { me: true, author: "Art", monogram: "A", time: "2:17 PM", body: "Great breakdown. Take both — and surface the active theme in the inspector while you're in the view layer, so I can see which skin a session opened with." },
  { me: false, author: "Dewey", monogram: "D", time: "2:18 PM", body: "On it. Moved resolveStartupTheme() ahead of the composer mount, and the inspector now shows the resolved skin badge. Pushed to main.", card: { head: "Dewey/AgentHomeShellView.swift", body: "Applies overlay settings on appear, before the first send — no skin flash on cold open." } },
];

const PINNED_ASK = { state: "answered" as const, from: "Art", text: "Should overlay settings render before the first send, or stay deferred? Surface the resolved skin while you're in there." };
const SELECTED = "Dewey";

const NAV: { id: string; label: string }[] = [
  { id: "comms", label: "Comms" }, { id: "agents", label: "Agents" }, { id: "tail", label: "Tail" }, { id: "repos", label: "Repos" },
];
const GROUPS: { id: Group; label: string }[] = [
  { id: "now", label: "NOW" }, { id: "today", label: "TODAY" }, { id: "earlier", label: "EARLIER" },
];

/* ════════════════════════════════════════════════════════════════════
   Agent ↔ agent (observer-first) — the operator is WATCHING two agents,
   not a participant. No turn is "me", so NO bubble takes the accent fill;
   the accent is reserved for the operator's own injected turn (the jump-in
   send). Identity moves to the node (sprite + a desaturated identity ring)
   and the name; the agent-to-agent affordances become first-class — a
   seen/ack receipt before the slow reply, a live "composing" node, and
   handoff provenance on every turn.
   ════════════════════════════════════════════════════════════════════ */

// Desaturated per-agent identity hues — deliberately NOT the brand indigo and
// NOT the pared green/amber; just enough to tell two speakers apart on the node.
const IDENT: Record<string, string> = { Dewey: "#7C8AA5", Hudson: "#B0896E", Atlas: "#8A9C7C", Preframe: "#A58BA0", Lattices: "#9C8A7C", Scout: "#7C8AA5" };

type A2ATurn = { author: string; monogram: string; time: string; body?: string; custody?: string; receipt?: string; working?: boolean };
const A2A_TURNS: A2ATurn[] = [
  { author: "Dewey", monogram: "D", time: "2:31 PM", custody: "delegated to Hudson",
    body: "Hudson — take the talkie-overlay-settings polish? Pull the no-fly list inline and tighten the mic-permission copy to match iOS. Branch off main.",
    receipt: "seen by Hudson · 2m" },
  { author: "Hudson", monogram: "H", time: "2:33 PM", custody: "reply to Dewey · re: overlay-settings",
    body: "On it. Folding the no-fly list into the settings sheet now, and I'll rewrite the permission line against the iOS copy.",
    receipt: "seen by Dewey · 1m" },
  { author: "Hudson", monogram: "H", time: "", working: true },
];
const A2A_THREADS = [
  { a: "Dewey", b: "Hudson", preview: "On it. Folding the no-fly list into the settings sheet…", time: "now", sel: true },
  { a: "Atlas", b: "Preframe", preview: "LGTM on the worktree map — ship it.", time: "12m", sel: false },
  { a: "Lattices", b: "Scout", preview: "Handed the pairing flow back to you.", time: "1h", sel: false },
];

/* ════════════════════════════════════════════════════════════════════
   EXISTING treatment — SF-Symbol-shaped icons (filled / rounded).
   ════════════════════════════════════════════════════════════════════ */

function SfBubbles({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="currentColor" aria-hidden>
      <path d="M3 4.4C3 3.1 4 2 5.4 2h7.2C14 2 15 3.1 15 4.4v3.9c0 1.3-1 2.4-2.4 2.4H8l-3.1 2.4c-.4.3-1 0-1-.5v-1.9H5.4C4 10.7 3 9.6 3 8.3z" />
      <path d="M16.4 8.1c1.5.1 2.6 1.1 2.6 2.5v3.1c0 1.1-.8 2-1.9 2.1v1.6c0 .5-.5.7-.9.4l-2.5-2H10c-1.2 0-2.2-.7-2.5-1.8h4.9c1.9 0 3.4-1.5 3.4-3.4z" opacity="0.5" />
    </svg>
  );
}
function SfPeople({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="currentColor" aria-hidden>
      <circle cx="8" cy="6.5" r="3.2" />
      <path d="M2.2 17.4c0-3.3 2.6-5.4 5.8-5.4s5.8 2.1 5.8 5.4c0 .6-.5 1-1.1 1H3.3c-.6 0-1.1-.4-1.1-1z" />
      <circle cx="15.6" cy="7.6" r="2.4" opacity="0.5" />
      <path d="M14 12.2c.5-.15 1.05-.2 1.6-.2 2.7 0 4.6 1.8 4.6 4.4 0 .6-.4 1-1 1h-3.1c.2-1.9-.6-3.8-2.1-5.2z" opacity="0.5" />
    </svg>
  );
}
function SfBranch({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="5" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="6" cy="17" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="7" r="2.2" fill="currentColor" stroke="none" />
      <path d="M6 7.2v7.6" />
      <path d="M16 9.2c0 4-4.2 3.3-6.4 5.2" />
    </svg>
  );
}
function SfWaveform({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 11h3.2l2-6 3 13 2.2-8.5 1.6 3.5H20" />
    </svg>
  );
}
function SfGear({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="currentColor" aria-hidden>
      <path d="M11 7.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zm0 2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z" />
      <path d="M9.7 1.8h2.6l.5 2.2 1.9.8 1.9-1.2 1.8 1.8-1.2 1.9.8 1.9 2.2.5v2.6l-2.2.5-.8 1.9 1.2 1.9-1.8 1.8-1.9-1.2-1.9.8-.5 2.2H9.7l-.5-2.2-1.9-.8-1.9 1.2-1.8-1.8 1.2-1.9-.8-1.9L1.8 12.3V9.7l2.2-.5.8-1.9-1.2-1.9 1.8-1.8 1.9 1.2 1.9-.8z" opacity="0.92" />
    </svg>
  );
}
const SF_NAV = [SfBubbles, SfPeople, SfWaveform, SfBranch];

function CurrentComms({ p }: { p: Pal }) {
  const kv = (k: string, v: string, c?: string) => (
    <div className="grid items-baseline gap-x-2" style={{ gridTemplateColumns: "62px 1fr" }}>
      <span className="text-[9px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.08em", color: p.dim }}>{k}</span>
      <span className="truncate text-right text-[10px]" style={{ fontFamily: MONO, color: c ?? p.muted }}>{v}</span>
    </div>
  );
  const section = (label: string, rule: string, body: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <div>
        <div aria-hidden className="mb-1.5 h-px w-3.5" style={{ background: rule }} />
        <div className="text-[9px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.1em", color: p.dim }}>{label}</div>
      </div>
      {body}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-[10px]" style={{ background: p.bg, border: `1px solid ${p.border}`, boxShadow: p.windowShadow, fontFamily: UI, color: p.ink }}>
      {/* titlebar */}
      <div className="flex items-center gap-2 px-3.5" style={{ height: 38, background: p.chrome, borderBottom: `1px solid ${p.hairline}` }}>
        <span className="block h-[11px] w-[11px] rounded-full" style={{ background: "#FF5F57" }} />
        <span className="block h-[11px] w-[11px] rounded-full" style={{ background: "#FEBC2E" }} />
        <span className="block h-[11px] w-[11px] rounded-full" style={{ background: "#28C840" }} />
        <span className="ml-2 text-[12px] font-semibold tracking-tight" style={{ color: p.ink }}>Scout</span>
        <span className="text-[12px]" style={{ color: p.dim }}>— Comms</span>
      </div>

      <div className="flex" style={{ height: 532 }}>
        {/* nav rail — SF Symbols */}
        <div className="flex flex-col items-center gap-1 py-2.5 shrink-0" style={{ width: 52, background: p.chrome, borderRight: `1px solid ${p.hairline}` }}>
          <div className="mb-1.5 grid place-items-center rounded-[8px] font-semibold" style={{ height: 28, width: 28, background: p.accent, color: p.accentOn, fontSize: 13 }}>S</div>
          {SF_NAV.map((Icon, i) => {
            const on = i === 0;
            return (
              <div key={i} title={NAV[i].label} className="grid place-items-center rounded-[8px]" style={{ height: 34, width: 34, background: on ? p.accentSoft : "transparent", color: on ? p.accent : p.dim }}>
                <Icon />
              </div>
            );
          })}
          <div className="mt-auto grid place-items-center rounded-[8px]" style={{ height: 34, width: 34, color: p.dim }} title="Settings"><SfGear /></div>
        </div>

        {/* list */}
        <div className="flex flex-col shrink-0" style={{ width: 248, borderRight: `1px solid ${p.hairline}`, background: p.bg }}>
          <div className="flex items-center px-3.5 shrink-0" style={{ height: 44, borderBottom: `1px solid ${p.hairline}` }}>
            <span className="text-[13px] font-semibold tracking-tight" style={{ color: p.ink }}>Chats</span>
            <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: p.accent }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M8 3.5v9M3.5 8h9" /></svg>New
            </span>
          </div>
          <div className="flex items-center gap-1 px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${p.hairline}` }}>
            {["All", "Direct", "Shared"].map((f, i) => (
              <span key={f} className="rounded-[5px] px-2 py-[3px] text-[10.5px] font-medium" style={i === 0 ? { background: p.surface, color: p.ink, border: `1px solid ${p.hairlineStrong}` } : { color: p.muted }}>{f}</span>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {GROUPS.map((grp) => {
              const rows = CONVS.filter((c) => c.group === grp.id);
              if (!rows.length) return null;
              return (
                <div key={grp.id}>
                  <div className="px-3.5 pt-2.5 pb-1 text-[9px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.12em", color: p.dim }}>{grp.label}</div>
                  {rows.map((c) => {
                    const sel = c.name === SELECTED;
                    const unread = c.unread > 0;
                    return (
                      <div key={c.name} className="flex items-center gap-2.5 px-3.5 py-2" style={{ borderBottom: `1px solid ${p.hairline}`, borderLeft: `2px solid ${sel ? p.accent : "transparent"}`, background: sel ? p.accentSoft : "transparent" }}>
                        <span className="grid place-items-center rounded-[8px] shrink-0 text-[12px] font-semibold" style={{ height: 30, width: 30, background: p.surface, border: `1px solid ${p.hairlineStrong}`, color: p.muted }}>{c.monogram}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {unread && <span className="inline-block h-[6px] w-[6px] rounded-full shrink-0" style={{ background: p.accent }} />}
                            <span className="truncate text-[12.5px]" style={{ color: p.ink, fontWeight: unread ? 700 : 600 }}>{c.name}</span>
                            <span className="ml-auto text-[10px] shrink-0" style={{ fontFamily: MONO, color: p.dim }}>{c.time}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="truncate text-[11px]" style={{ color: unread ? p.muted : p.dim }}>{c.preview}</span>
                            {unread && <span className="ml-auto shrink-0 rounded-full px-1.5 text-[8.5px] font-bold" style={{ background: p.accent, color: p.accentOn }}>{c.unread}</span>}
                          </div>
                          {/* amber reserved for the one actionable state — a pending ask.
                              answered needs no badge (resolved = no attention = no color). */}
                          {c.ask === "pending" && <span className="mt-1 inline-block rounded-[3px] px-1 py-px text-[8px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.08em", background: p.warnBg, color: p.warnFg }}>ask pending</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* thread */}
        <div className="flex flex-col min-w-0 flex-1" style={{ background: p.bg }}>
          <div className="flex items-center gap-2.5 px-4 shrink-0" style={{ height: 52, borderBottom: `1px solid ${p.hairline}` }}>
            <span className="grid place-items-center rounded-full shrink-0 text-[12px] font-semibold" style={{ height: 28, width: 28, background: p.surface, border: `1px solid ${p.hairlineStrong}`, color: p.muted }}>D</span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-tight leading-none" style={{ color: p.ink }}>Dewey</div>
              <div className="truncate text-[10px] mt-1" style={{ fontFamily: MONO, color: p.dim }}>dewey · main · ~/dev/dewey · c.a4d433a9</div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-semibold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.06em", color: p.muted, border: `1px solid ${p.hairlineStrong}`, background: p.surface }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.6" /></svg>Observe
              </button>
              <button type="button" className="rounded-[6px] px-2.5 py-1 text-[10px] font-semibold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.06em", color: p.accent, border: `1px solid ${p.accent}`, background: p.accentSoft }}>Message</button>
            </div>
          </div>

          {/* pinned ask band — amber only while pending; answered tones to neutral */}
          {(() => {
            const pending = PINNED_ASK.state !== "answered";
            const edge = pending ? p.warnFg : p.hairlineStrong;
            const fg = pending ? p.warnFg : p.dim;
            return (
              <div className="px-4 py-2 shrink-0" style={{ background: pending ? p.warnBg : p.surface, boxShadow: `inset 2px 0 0 ${edge}`, borderBottom: `1px solid ${p.hairline}` }}>
                <div className="flex items-center gap-1.5">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: fg }} aria-hidden><path d="M12 17v5" /><path d="M9 10.76 5.5 14h13L15 10.76V4h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1z" /></svg>
                  <span className="text-[8.5px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.1em", color: fg }}>Pinned ask · {pending ? "Awaiting reply" : "Answered"}</span>
                  <span className="text-[8.5px]" style={{ fontFamily: MONO, color: p.dim }}>from {PINNED_ASK.from}</span>
                </div>
                <div className="text-[11px] leading-snug mt-0.5" style={{ color: p.muted }}>{PINNED_ASK.text}</div>
              </div>
            );
          })()}

          {/* turns — flat sender-led transcript */}
          <div className="flex-1 overflow-hidden px-4 py-3.5" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {TURNS.map((t, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="grid place-items-center rounded-full shrink-0 text-[11px] font-semibold" style={{ height: 26, width: 26, background: t.me ? p.accent : p.surface, color: t.me ? p.accentOn : p.muted, border: t.me ? `1px solid ${p.accent}` : `1px solid ${p.hairlineStrong}`, boxShadow: t.me ? `0 0 0 2px ${p.accentSoft}` : undefined }}>{t.monogram}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[12px] font-semibold" style={{ color: p.ink }}>{t.author}</span>
                    <span className="text-[10px]" style={{ fontFamily: MONO, color: p.dim }}>{t.time}</span>
                  </div>
                  {t.replyTo && (
                    <div className="mt-1 flex items-center gap-1.5 text-[9.5px]" style={{ fontFamily: MONO, color: p.dim }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>
                      <span className="font-bold uppercase" style={{ letterSpacing: "0.08em" }}>reply to</span>
                      <span className="truncate" style={{ color: p.muted }}>{t.replyTo.title}</span>
                      <span className="shrink-0">· {t.replyTo.from}</span>
                      <span className="shrink-0" style={{ color: t.replyTo.status === "working" ? p.accent : p.dim }}>· {t.replyTo.status}</span>
                    </div>
                  )}
                  {/* Current = honest baseline: flat sender-led body, no bubble (that
                      nicety lives in the Proposal). Don't cheat the current. */}
                  <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: p.ink2, maxWidth: 560 }}>{t.body}</div>
                  {t.card && (
                    <div className="mt-2 overflow-hidden rounded-[7px]" style={{ border: `1px solid ${p.hairlineStrong}`, background: p.surface, maxWidth: 560 }}>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px]" style={{ fontFamily: MONO, color: p.ink, borderBottom: `1px solid ${p.hairline}` }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>{t.card.head}
                      </div>
                      <div className="px-2.5 py-1.5 text-[10.5px] leading-snug" style={{ color: p.muted }}>{t.card.body}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* composer */}
          <div className="px-4 pb-3.5 pt-1 shrink-0">
            <div className="rounded-[8px]" style={{ background: p.surface, border: `1px solid ${p.hairlineStrong}`, borderTop: `1px solid ${p.accent}`, boxShadow: p.accentShadow }}>
              <div className="px-3 pt-2.5 pb-1.5 text-[11px]" style={{ fontFamily: MONO, color: p.dim }}>Message Dewey…</div>
              <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderTop: `1px solid ${p.hairline}` }}>
                <span className="text-[9px] uppercase" style={{ fontFamily: MONO, letterSpacing: "0.08em", color: p.dim }}>⌘↵ to send</span>
                <span className="ml-auto inline-flex items-center gap-2" style={{ color: p.dim }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3" /></svg>
                  <span className="grid place-items-center rounded-full" style={{ height: 22, width: 22, background: p.accent, color: p.accentOn }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* inspector */}
        <div className="flex flex-col shrink-0" style={{ width: 272, borderLeft: `1px solid ${p.hairline}`, background: p.surface }}>
          <div className="flex items-center justify-between px-3.5 shrink-0" style={{ height: 38, borderBottom: `1px solid ${p.hairline}` }}>
            <div className="flex items-center gap-1.5">
              <span className="block rounded-sm" style={{ height: 12, width: 2, background: p.accent }} />
              <span className="text-[9px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.1em", color: p.dim }}>DM</span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[8px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.08em", color: p.dim, border: `1px solid ${p.hairlineStrong}` }}>Open</span>
          </div>
          <div className="flex flex-col gap-3.5 p-3.5 overflow-hidden">
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center rounded-full text-[13px] font-semibold" style={{ height: 32, width: 32, background: p.bg, border: `1px solid ${p.hairlineStrong}`, color: p.muted }}>D</span>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold tracking-tight leading-tight" style={{ color: p.ink }}>Dewey</div>
                <div className="truncate text-[9.5px]" style={{ fontFamily: MONO, color: p.dim }}>dewey.main.arts-mac-mini-local</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="rounded-[6px] px-3 py-1 text-[10px] font-semibold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.06em", color: p.accentOn, background: p.accent }}>Open</button>
              <button type="button" className="rounded-[6px] px-2.5 py-1 text-[10px] font-semibold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.06em", color: p.muted, border: `1px solid ${p.hairlineStrong}`, background: p.surface }}>+ New</button>
            </div>
            {section("Conversation", p.hairlineStrong, <div className="flex flex-col gap-1">{kv("Last", "2m")}{kv("Unread", "2", p.accent)}{kv("Channel", "DM")}</div>)}
            {section("Project", p.hairlineStrong, <div className="flex flex-col gap-1">{kv("Repo", "dewey")}{kv("Branch", "main")}{kv("Path", "~/dev/dewey")}</div>)}
            {section("Ask", p.hairlineStrong, (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-[3px] px-1 py-px text-[8px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.06em", color: p.dim, border: `1px solid ${p.hairlineStrong}` }}>answered</span>
                  <span className="text-[8.5px]" style={{ fontFamily: MONO, color: p.dim }}>from Art</span>
                </div>
                <div className="text-[10.5px] leading-snug" style={{ color: p.muted }}>Surface the resolved skin in the inspector.</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3.5 shrink-0" style={{ height: 24, background: p.chrome, borderTop: `1px solid ${p.hairline}` }}>
        <span className="text-[9px] uppercase" style={{ fontFamily: MONO, letterSpacing: "0.08em", color: p.muted }}>Comms · 24 chats · 2 need you</span>
        <span className="ml-auto text-[9px] uppercase" style={{ fontFamily: MONO, letterSpacing: "0.08em", color: p.dim }}>broker online</span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   PROPOSAL treatment — the macOS Comms surface re-crafted to the
   agent-lanes bar: hairlines at low alpha, recessed "screens", glyph-led
   mono fact lines, a single semantic indigo accent, and the signature
   connected spine + elbow timeline down the thread. Quiet ghost actions —
   no bordered uppercase mono pills. Light + dark via the same palette.
   ════════════════════════════════════════════════════════════════════ */

function craft(p: Pal) {
  const light = p.mode === "light";
  return {
    hair: light ? "rgba(18,20,40,0.07)" : "rgba(150,172,205,0.12)",
    hairS: light ? "rgba(18,20,40,0.13)" : "rgba(150,172,205,0.22)",
    inset: light ? "rgba(18,20,40,0.028)" : "rgba(0,0,0,0.24)",
    insetShadow: light
      ? "inset 0 1px 2px rgba(18,20,40,0.05)"
      : "inset 0 1px 0 rgba(255,255,255,0.03), inset 0 2px 7px rgba(0,0,0,0.32)",
    pill: light ? "rgba(18,20,40,0.045)" : "rgba(255,255,255,0.06)",
    accentPill: light ? "rgba(62,102,204,0.10)" : "rgba(85,133,230,0.18)",
    winGrad: light ? "linear-gradient(180deg,#F7F9FB,#EFF2F6)" : "linear-gradient(180deg,#1D1D1D,#191919)",
    chrome: light ? "rgba(18,20,40,0.022)" : "rgba(0,0,0,0.18)",
    // spine + elbow are NEUTRAL hairlines — the accent is a whisper, not a tint.
    spine: light
      ? "linear-gradient(180deg,transparent 0%,rgba(18,20,40,.09) 14%,rgba(18,20,40,.13) 50%,rgba(18,20,40,.09) 86%,transparent 100%)"
      : "linear-gradient(180deg,transparent 0%,rgba(180,180,180,.14) 14%,rgba(180,180,180,.20) 50%,rgba(180,180,180,.14) 86%,transparent 100%)",
    elbow: light ? "rgba(18,20,40,.12)" : "rgba(180,180,180,.18)",
    bubbleShadow: light
      ? "0 1px 1px rgba(18,20,40,.04), 0 5px 14px -7px rgba(18,20,40,.14)"
      : "0 1px 1px rgba(0,0,0,.3), 0 6px 16px -8px rgba(0,0,0,.5)",
  };
}

/* tiny line glyphs — 12px box, 1px stroke, currentColor (agent-lanes idiom) */
const mg = (s = 12) => ({ width: s, height: s, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });
const GFolder = () => <svg {...mg()} aria-hidden><path d="M1.6 3.7c0-.4.3-.6.6-.6h2l.9.9h3.7c.3 0 .6.3.6.6V8.4c0 .3-.3.6-.6.6H2.2c-.3 0-.6-.3-.6-.6z" /></svg>;
const GBranch = () => <svg {...mg()} aria-hidden><circle cx="3" cy="3" r="1.2" /><circle cx="3" cy="9" r="1.2" /><circle cx="9" cy="3.6" r="1.2" /><path d="M3 4.2v3.6M9 4.8c0 2.4-2.6 1.9-4.2 3.2" /></svg>;
const GClock = () => <svg {...mg()} aria-hidden><circle cx="6" cy="6" r="4.1" /><path d="M6 3.7V6l1.7 1" /></svg>;
const GSession = () => <svg {...mg()} aria-hidden><circle cx="6" cy="3.2" r="1.3" /><circle cx="6" cy="8.8" r="1.3" /><path d="M6 4.5v3" /></svg>;
const GHash = () => <svg {...mg()} aria-hidden><path d="M4.4 2 3.5 10M8.5 2 7.6 10M2.3 4.4h7.4M2 7.6h7.4" /></svg>;
const GPin = () => <svg {...mg()} aria-hidden><path d="M6 8.4V11M4.5 5.3 3.1 6.8h5.8L7.5 5.3V2.5h.4a.5.5 0 0 0 0-1H4.1a.5.5 0 0 0 0 1h.4z" /></svg>;
const GEye = ({ s = 14 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.6" /></svg>;
const GMsg = ({ s = 14 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-6.1A8.4 8.4 0 1 1 21 11.5z" /></svg>;
const GSend = ({ s = 12 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>;

function ProposalComms({ p }: { p: Pal }) {
  const x = craft(p);
  const eyebrow = (t: string) => <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: p.dim }}>{t}</div>;
  const fact = (glyph: React.ReactNode, val: React.ReactNode, tint?: string, tail?: React.ReactNode) => (
    <div className="flex items-center gap-2 min-w-0">
      <span style={{ color: p.dim, flex: "none", width: 14, display: "inline-flex", justifyContent: "center" }}>{glyph}</span>
      <span className="truncate" style={{ fontFamily: MONO, fontSize: 11, color: tint ?? p.muted }}>{val}</span>
      {tail ? <span className="ml-auto" style={{ flex: "none" }}>{tail}</span> : null}
    </div>
  );
  const pillTag = (txt: string, tone: "neutral" | "amber" = "neutral") => (
    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase", padding: "1px 6px", borderRadius: 4, background: tone === "amber" ? p.warnBg : x.pill, color: tone === "amber" ? p.warnFg : p.muted }}>{txt}</span>
  );

  const rootStyle = {
    background: x.winGrad, border: `1px solid ${x.hairS}`, color: p.ink, fontFamily: UI,
    boxShadow: p.windowShadow,
    ["--pc-spine" as string]: x.spine, ["--pc-elbow" as string]: x.elbow,
    ["--pc-bg" as string]: p.bg, ["--pc-hairS" as string]: x.hairS, ["--pc-pill" as string]: x.pill,
    ["--pc-dim" as string]: p.dim, ["--pc-ink" as string]: p.ink, ["--pc-accent" as string]: p.accent, ["--pc-accentOn" as string]: p.accentOn,
  } as React.CSSProperties;

  return (
    <div className="pcw overflow-hidden rounded-[12px]" style={rootStyle}>
      <style>{`
        .pcw .pc-thread{position:relative}
        .pcw .pc-spine{position:absolute;left:27px;top:8px;bottom:8px;width:1px;background:var(--pc-spine);pointer-events:none}
        .pcw .pc-turn{position:relative;display:flex;gap:12px;align-items:flex-start}
        .pcw .pc-turn + .pc-turn{margin-top:15px}
        .pcw .pc-av{position:relative;z-index:1;flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;color:var(--pc-dim);background:var(--pc-bg);box-shadow:0 0 0 3px var(--pc-bg), inset 0 0 0 1px var(--pc-hairS)}
        .pcw .pc-av.is-me{color:var(--pc-accentOn);background:var(--pc-accent);box-shadow:0 0 0 3px var(--pc-bg), inset 0 0 0 1px var(--pc-accent)}
        .pcw .pc-elbow{position:absolute;left:24px;top:11px;width:11px;height:1px;background:var(--pc-elbow);pointer-events:none}
        .pcw .pc-body{min-width:0;flex:1}
        .pcw .pc-gbtn{display:inline-grid;place-items:center;width:27px;height:22px;border-radius:6px;color:var(--pc-dim);cursor:pointer;border:0;background:transparent;transition:background .12s ease,color .12s ease}
        .pcw .pc-gbtn:hover{background:var(--pc-pill);color:var(--pc-ink)}
        .pcw .pc-gbtn.is-accent{color:var(--pc-accent)}
      `}</style>

      {/* titlebar */}
      <div className="flex items-center gap-2 px-3.5" style={{ height: 38, background: x.chrome, borderBottom: `1px solid ${x.hair}` }}>
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#FF5F57" }} />
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#FEBC2E" }} />
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#28C840" }} />
        <span className="ml-2 text-[11px] tracking-[0.04em]" style={{ fontFamily: MONO, color: p.dim }}>Scout — Comms</span>
      </div>

      <div className="flex" style={{ height: 532 }}>
        {/* nav rail */}
        <div className="flex flex-col items-center gap-1 py-2.5 shrink-0" style={{ width: 52, background: x.chrome, borderRight: `1px solid ${x.hair}` }}>
          <div className="mb-1.5 grid place-items-center rounded-[8px] font-semibold" style={{ height: 26, width: 26, background: p.accent, color: p.accentOn, fontSize: 12 }}>S</div>
          {SF_NAV.map((Icon, i) => {
            const on = i === 0;
            return (
              <div key={i} className="relative grid place-items-center rounded-[8px]" style={{ height: 33, width: 33, color: on ? p.ink : p.dim, background: on ? x.pill : "transparent" }}>
                <Icon s={17} />
              </div>
            );
          })}
          <div className="mt-auto grid place-items-center rounded-[8px]" style={{ height: 33, width: 33, color: p.dim }}><SfGear s={17} /></div>
        </div>

        {/* list */}
        <div className="flex flex-col shrink-0" style={{ width: 248, borderRight: `1px solid ${x.hair}` }}>
          <div className="flex items-center px-3.5 shrink-0" style={{ height: 44, borderBottom: `1px solid ${x.hair}` }}>
            <span className="text-[13px] font-semibold tracking-[-0.01em]" style={{ color: p.ink }}>Chats</span>
            <span className="ml-2" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>24</span>
            <span className="ml-auto pc-gbtn is-accent" title="New session"><svg {...mg(13)} aria-hidden><path d="M6 2.4v7.2M2.4 6h7.2" /></svg></span>
          </div>
          <div className="flex items-center gap-1.5 px-3.5 py-2 shrink-0" style={{ borderBottom: `1px solid ${x.hair}` }}>
            {["All", "Direct", "Shared"].map((f, i) => (
              <span key={f} style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".04em", padding: "2px 7px", borderRadius: 5, background: i === 0 ? x.pill : "transparent", color: i === 0 ? p.ink : p.dim }}>{f}</span>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {GROUPS.map((grp) => {
              const rows = CONVS.filter((c) => c.group === grp.id);
              if (!rows.length) return null;
              return (
                <div key={grp.id}>
                  <div className="px-3.5 pt-2.5 pb-1">{eyebrow(grp.label)}</div>
                  {rows.map((c) => {
                    const sel = c.name === SELECTED;
                    const unread = c.unread > 0;
                    return (
                      <div key={c.name} className="flex items-center gap-2.5 px-3.5 py-2" style={{ borderBottom: `1px solid ${x.hair}`, background: sel ? x.pill : "transparent" }}>
                        <span className="grid place-items-center rounded-full shrink-0 text-[11px] font-semibold" style={{ height: 28, width: 28, background: x.inset, boxShadow: `inset 0 0 0 1px ${sel ? p.accent : x.hairS}`, color: sel ? p.ink : p.muted }}>{c.monogram}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {unread && <span className="inline-block h-[5px] w-[5px] rounded-full shrink-0" style={{ background: p.accent }} />}
                            <span className="truncate text-[12px]" style={{ color: p.ink, fontWeight: unread ? 700 : 500, letterSpacing: "-0.01em" }}>{c.name}</span>
                            <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>{c.time}</span>
                            {unread && <span style={{ fontFamily: MONO, fontSize: 9.5, color: p.accent }}>{c.unread}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 mt-[3px]">
                            <span className="truncate text-[10.5px]" style={{ color: p.dim }}>{c.preview}</span>
                          </div>
                          {c.ask === "pending" && <div className="mt-1">{pillTag("ask pending", "amber")}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* thread */}
        <div className="flex flex-col min-w-0 flex-1">
          {/* header — name + glyph-led sub-line + quiet ghost actions */}
          <div className="flex items-center gap-2.5 px-4 shrink-0" style={{ height: 52, borderBottom: `1px solid ${x.hair}` }}>
            <span className="grid place-items-center rounded-full shrink-0 text-[12px] font-semibold" style={{ height: 28, width: 28, background: x.inset, boxShadow: `inset 0 0 0 1px ${x.hairS}`, color: p.muted }}>D</span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-[-0.01em] leading-none" style={{ color: p.ink }}>Dewey</div>
              <div className="flex items-center gap-3 mt-1.5 min-w-0" style={{ fontFamily: MONO, fontSize: 10, color: p.muted }}>
                <span className="flex items-center gap-1.5 min-w-0"><span style={{ color: p.dim, display: "inline-flex" }}><GFolder /></span><span className="truncate">dewey</span></span>
                <span className="flex items-center gap-1.5"><span style={{ color: p.dim, display: "inline-flex" }}><GBranch /></span>main</span>
                <span className="flex items-center gap-1.5" style={{ color: p.dim }}><GSession />c.a4d433a9</span>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              <span className="pc-gbtn" title="Observe"><GEye /></span>
              <span className="pc-gbtn is-accent" title="Message"><GMsg /></span>
            </div>
          </div>

          {/* pinned ask — recessed screen, neutral when answered */}
          <div className="mx-4 mt-3 rounded-[8px] px-3 py-2 shrink-0" style={{ background: x.inset, boxShadow: x.insetShadow, border: `1px solid ${x.hair}` }}>
            <div className="flex items-center gap-1.5">
              <span style={{ color: p.dim, display: "inline-flex" }}><GPin /></span>
              <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: p.dim }}>Pinned ask · answered</span>
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: p.dim }}>· from Art</span>
            </div>
            <div className="text-[11px] leading-snug mt-1" style={{ color: p.muted }}>{PINNED_ASK.text}</div>
          </div>

          {/* transcript — connected spine + nodes + elbows */}
          <div className="flex-1 overflow-hidden px-4 py-4" style={{ WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 30px), transparent)", maskImage: "linear-gradient(to bottom, #000 calc(100% - 30px), transparent)" }}>
            <div className="pc-thread">
              <span className="pc-spine" />
              {TURNS.map((t, i) => (
                <div key={i} className="pc-turn">
                  <span className={`pc-av${t.me ? " is-me" : ""}`}>{t.monogram}</span>
                  <span className="pc-elbow" />
                  <div className="pc-body">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[12px] font-semibold" style={{ color: p.ink }}>{t.author}</span>
                      <span style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>{t.time}</span>
                    </div>
                    {t.replyTo && (
                      <div className="mt-1 flex items-center gap-1.5" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>
                        <span className="truncate" style={{ color: p.muted }}>{t.replyTo.title}</span>
                        <span className="shrink-0">· {t.replyTo.from} · {t.replyTo.status}</span>
                      </div>
                    )}
                    <div className="mt-1.5 inline-block rounded-[11px] px-3 py-2 text-[12.5px] leading-[1.5]" style={t.me
                      ? { background: p.accent, color: p.accentOn, maxWidth: 520 }
                      : { background: p.surface, color: p.ink, border: `1px solid ${x.hair}`, boxShadow: x.bubbleShadow, maxWidth: 510 }}>{t.body}</div>
                    {t.card && (
                      <div className="mt-2 overflow-hidden rounded-[8px]" style={{ background: x.inset, boxShadow: x.insetShadow, border: `1px solid ${x.hair}`, maxWidth: 510 }}>
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ fontFamily: MONO, fontSize: 10, color: p.muted, borderBottom: `1px solid ${x.hair}` }}>
                          <span style={{ color: p.dim, display: "inline-flex" }}><svg {...mg(11)} aria-hidden><path d="M3 1.6h4l2 2v6.8H3z" /><path d="M7 1.6v2h2" /></svg></span>{t.card.head}
                        </div>
                        <div className="px-2.5 py-1.5 text-[10.5px] leading-snug" style={{ color: p.dim }}>{t.card.body}</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* composer — clean native field (no terminal chrome) */}
          <div className="px-4 pb-4 pt-1 shrink-0">
            <div className="flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ background: p.surface, border: `1px solid ${x.hairS}` }}>
              <span className="flex-1 text-[12px]" style={{ color: p.dim }}>Message Dewey…</span>
              <span className="pc-gbtn" title="Attach"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg></span>
              <span className="pc-gbtn" title="Dictate"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3" /></svg></span>
              <span className="grid place-items-center rounded-[8px]" style={{ height: 26, width: 30, background: p.accent, color: p.accentOn }}><GSend /></span>
            </div>
          </div>
        </div>

        {/* inspector — glyph-led fact lines + one recessed Ask screen */}
        <div className="flex flex-col shrink-0" style={{ width: 272, borderLeft: `1px solid ${x.hair}`, background: x.chrome }}>
          <div className="flex items-center justify-between px-3.5 shrink-0" style={{ height: 38, borderBottom: `1px solid ${x.hair}` }}>
            {eyebrow("DM")}
            <span className="flex items-center gap-1.5" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: p.dim }}>
              <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: p.dim }} />open
            </span>
          </div>
          <div className="flex flex-col gap-4 p-3.5 overflow-hidden">
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center rounded-full text-[13px] font-semibold" style={{ height: 32, width: 32, background: x.inset, boxShadow: `inset 0 0 0 1px ${x.hairS}`, color: p.muted }}>D</span>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold tracking-[-0.01em] leading-tight" style={{ color: p.ink }}>Dewey</div>
                <div className="truncate" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>dewey.main.arts-mac-mini-local</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" style={{ fontFamily: UI, fontSize: 11, fontWeight: 500, color: p.accent, background: x.pill, border: 0, borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>Open</button>
              <button type="button" style={{ fontFamily: UI, fontSize: 11, fontWeight: 500, color: p.dim, background: "transparent", border: 0, padding: "5px 6px", cursor: "pointer" }}>+ New</button>
            </div>
            <div className="flex flex-col gap-2">
              {eyebrow("Conversation")}
              {fact(<GClock />, "2m ago")}
              {fact(<span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: p.accent }} />, "2 unread", p.accent)}
              {fact(<GHash />, "Direct message")}
            </div>
            <div className="flex flex-col gap-2">
              {eyebrow("Project")}
              {fact(<GFolder />, "~/dev/dewey")}
              {fact(<GBranch />, "main")}
            </div>
            <div className="flex flex-col gap-1.5">
              {eyebrow("Ask")}
              <div className="rounded-[8px] px-2.5 py-2" style={{ background: x.inset, boxShadow: x.insetShadow, border: `1px solid ${x.hair}` }}>
                <div className="flex items-center gap-1.5">
                  <span style={{ color: p.dim, display: "inline-flex" }}><GPin /></span>
                  <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".04em", textTransform: "uppercase", color: p.dim }}>answered · from Art</span>
                </div>
                <div className="text-[10.5px] leading-snug mt-1" style={{ color: p.muted }}>Surface the resolved skin in the inspector.</div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {eyebrow("Shared")}
              {fact(<svg {...mg(12)} aria-hidden><path d="M3 1.6h4l2 2v6.8H3z" /><path d="M7 1.6v2h2" /></svg>, "AgentHomeShellView.swift")}
              {fact(<svg {...mg(12)} aria-hidden><path d="M3 1.6h4l2 2v6.8H3z" /><path d="M7 1.6v2h2" /></svg>, "ScoutTheme.swift")}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3.5 shrink-0" style={{ height: 24, background: x.chrome, borderTop: `1px solid ${x.hair}` }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: p.dim }}>Comms · 24 chats · 2 need you</span>
        <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: p.dim }}>broker online</span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   AGENT ↔ AGENT (observer-first) — same crafted shell as the Proposal,
   but the operator is watching, not talking. No accent bubble; identity on
   the node; seen/ack + handoff provenance promoted to first-class.
   ════════════════════════════════════════════════════════════════════ */

function A2AComms({ p }: { p: Pal }) {
  const x = craft(p);
  const eyebrow = (t: string) => <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: p.dim }}>{t}</div>;
  const fact = (glyph: React.ReactNode, val: React.ReactNode, tint?: string) => (
    <div className="flex items-center gap-2 min-w-0">
      <span style={{ color: p.dim, flex: "none", width: 14, display: "inline-flex", justifyContent: "center" }}>{glyph}</span>
      <span className="truncate" style={{ fontFamily: MONO, fontSize: 11, color: tint ?? p.muted }}>{val}</span>
    </div>
  );

  const rootStyle = {
    background: x.winGrad, border: `1px solid ${x.hairS}`, color: p.ink, fontFamily: UI,
    boxShadow: p.windowShadow,
    ["--pc-spine" as string]: x.spine, ["--pc-elbow" as string]: x.elbow,
    ["--pc-bg" as string]: p.bg, ["--pc-hairS" as string]: x.hairS, ["--pc-pill" as string]: x.pill,
    ["--pc-dim" as string]: p.dim, ["--pc-ink" as string]: p.ink, ["--pc-accent" as string]: p.accent, ["--pc-accentOn" as string]: p.accentOn,
  } as React.CSSProperties;

  const node = (mono: string, ident: string) => (
    <span className="pc-av" style={{ background: p.bg, boxShadow: `0 0 0 3px ${p.bg}, inset 0 0 0 1.5px ${ident}`, color: ident }}>{mono}</span>
  );

  return (
    <div className="pcw overflow-hidden rounded-[12px]" style={rootStyle}>
      <style>{`
        .pcw .pc-thread{position:relative}
        .pcw .pc-spine{position:absolute;left:27px;top:8px;bottom:8px;width:1px;background:var(--pc-spine);pointer-events:none}
        .pcw .pc-turn{position:relative;display:flex;gap:12px;align-items:flex-start}
        .pcw .pc-turn + .pc-turn{margin-top:15px}
        .pcw .pc-av{position:relative;z-index:1;flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600}
        .pcw .pc-elbow{position:absolute;left:24px;top:11px;width:11px;height:1px;background:var(--pc-elbow);pointer-events:none}
        .pcw .pc-body{min-width:0;flex:1}
      `}</style>

      {/* titlebar */}
      <div className="flex items-center gap-2 px-3.5" style={{ height: 38, background: x.chrome, borderBottom: `1px solid ${x.hair}` }}>
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#FF5F57" }} />
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#FEBC2E" }} />
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#28C840" }} />
        <span className="ml-2 text-[11px] tracking-[0.04em]" style={{ fontFamily: MONO, color: p.dim }}>Scout — Comms · Observing</span>
      </div>

      <div className="flex" style={{ height: 532 }}>
        {/* nav rail */}
        <div className="flex flex-col items-center gap-1 py-2.5 shrink-0" style={{ width: 52, background: x.chrome, borderRight: `1px solid ${x.hair}` }}>
          <div className="mb-1.5 grid place-items-center rounded-[8px] font-semibold" style={{ height: 26, width: 26, background: p.accent, color: p.accentOn, fontSize: 12 }}>S</div>
          {SF_NAV.map((Icon, i) => (
            <div key={i} className="relative grid place-items-center rounded-[8px]" style={{ height: 33, width: 33, color: i === 0 ? p.ink : p.dim, background: i === 0 ? x.pill : "transparent" }}><Icon s={17} /></div>
          ))}
          <div className="mt-auto grid place-items-center rounded-[8px]" style={{ height: 33, width: 33, color: p.dim }}><SfGear s={17} /></div>
        </div>

        {/* list — agent ↔ agent threads, paired nodes */}
        <div className="flex flex-col shrink-0" style={{ width: 248, borderRight: `1px solid ${x.hair}` }}>
          <div className="flex items-center px-3.5 shrink-0" style={{ height: 44, borderBottom: `1px solid ${x.hair}` }}>
            <span className="text-[13px] font-semibold tracking-[-0.01em]" style={{ color: p.ink }}>Threads</span>
            <span className="ml-2" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>agent ↔ agent</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="px-3.5 pt-2.5 pb-1">{eyebrow("Now")}</div>
            {A2A_THREADS.map((th) => (
              <div key={th.a + th.b} className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ borderBottom: `1px solid ${x.hair}`, background: th.sel ? x.pill : "transparent" }}>
                <span className="relative shrink-0" style={{ width: 36, height: 26 }}>
                  <span className="grid place-items-center rounded-full text-[9px] font-semibold" style={{ position: "absolute", left: 0, top: 1, height: 22, width: 22, background: p.bg, boxShadow: `0 0 0 2px ${p.bg}, inset 0 0 0 1.5px ${IDENT[th.a] ?? p.dim}`, color: IDENT[th.a] ?? p.muted }}>{th.a[0]}</span>
                  <span className="grid place-items-center rounded-full text-[9px] font-semibold" style={{ position: "absolute", left: 13, top: 3, height: 22, width: 22, background: p.bg, boxShadow: `0 0 0 2px ${p.bg}, inset 0 0 0 1.5px ${IDENT[th.b] ?? p.dim}`, color: IDENT[th.b] ?? p.muted }}>{th.b[0]}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px]" style={{ color: p.ink, fontWeight: 500, letterSpacing: "-0.01em" }}>{th.a} <span style={{ color: p.dim }}>→</span> {th.b}</span>
                    <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>{th.time}</span>
                  </div>
                  <div className="truncate text-[10.5px] mt-[3px]" style={{ color: p.dim }}>{th.preview}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* thread — observer-first */}
        <div className="flex flex-col min-w-0 flex-1">
          {/* observing banner */}
          <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 36, background: x.chrome, borderBottom: `1px solid ${x.hair}` }}>
            <span style={{ color: p.dim, display: "inline-flex" }}><GEye s={13} /></span>
            <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".04em", color: p.muted }}>Observing — you’re not in this thread</span>
            <span className="ml-auto flex items-center gap-1.5" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>{node("D", IDENT.Dewey)}<span style={{ opacity: .6 }}>→</span>{node("H", IDENT.Hudson)}</span>
          </div>

          <div className="flex-1 overflow-hidden px-4 py-4" style={{ WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 30px), transparent)", maskImage: "linear-gradient(to bottom, #000 calc(100% - 30px), transparent)" }}>
            <div className="pc-thread">
              <span className="pc-spine" />
              {A2A_TURNS.map((t, i) => {
                const ident = IDENT[t.author] ?? p.dim;
                return (
                  <div key={i} className="pc-turn">
                    {node(t.monogram, ident)}
                    <span className="pc-elbow" />
                    <div className="pc-body">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-semibold" style={{ color: p.ink }}>{t.author}</span>
                        {t.working
                          ? <><span style={{ fontFamily: MONO, fontSize: 9.5, color: ident }}>● working</span><span style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>· seen 30s ago</span></>
                          : <span style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>{t.time}</span>}
                      </div>
                      {t.custody && (
                        <div className="mt-1 flex items-center gap-1.5" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>
                          <span className="truncate">{t.custody}</span>
                        </div>
                      )}
                      {t.working ? (
                        <div className="mt-1.5 inline-flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ background: x.inset, boxShadow: x.insetShadow, border: `1px solid ${x.hair}` }}>
                          <span style={{ display: "inline-flex", gap: 3 }}>{[0, 1, 2].map((d) => <span key={d} style={{ width: 4, height: 4, borderRadius: 9, background: p.dim, opacity: 0.4 + d * 0.22 }} />)}</span>
                          <span style={{ fontFamily: MONO, fontSize: 10, color: p.dim }}>composing reply…</span>
                        </div>
                      ) : (
                        // no accent — every bubble floats; nobody here is "me"
                        <div className="mt-1.5 inline-block rounded-[11px] px-3 py-2 text-[12.5px] leading-[1.5]" style={{ background: p.surface, color: p.ink, border: `1px solid ${x.hair}`, boxShadow: x.bubbleShadow, maxWidth: 470 }}>{t.body}</div>
                      )}
                      {t.receipt && (
                        <div className="mt-1 flex items-center gap-1" style={{ fontFamily: MONO, fontSize: 9, color: p.dim }}>
                          <span style={{ letterSpacing: "-1.5px", color: p.dim }}>✓✓</span><span className="ml-1">{t.receipt}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* jump-in — the ONE place the accent returns: injecting makes you a participant */}
          <div className="px-4 pb-4 pt-1 shrink-0">
            <div className="flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ background: "transparent", border: `1px dashed ${x.hairS}` }}>
              <span style={{ color: p.dim, display: "inline-flex" }}><GMsg s={14} /></span>
              <span className="flex-1 text-[12px]" style={{ color: p.dim }}>Jump in… <span style={{ opacity: .7 }}>— your reply joins as Art</span></span>
              <span className="grid place-items-center rounded-[8px]" style={{ height: 26, width: 30, background: p.accent, color: p.accentOn }}><GSend /></span>
            </div>
          </div>
        </div>

        {/* inspector — participants + delivery (ack) timeline */}
        <div className="flex flex-col shrink-0" style={{ width: 272, borderLeft: `1px solid ${x.hair}`, background: x.chrome }}>
          <div className="flex items-center justify-between px-3.5 shrink-0" style={{ height: 38, borderBottom: `1px solid ${x.hair}` }}>
            {eyebrow("Thread")}
            <span className="flex items-center gap-1.5" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: p.dim }}><span style={{ color: p.dim, display: "inline-flex" }}><GEye /></span>observing</span>
          </div>
          <div className="flex flex-col gap-4 p-3.5 overflow-hidden">
            <div className="flex flex-col gap-2">
              {eyebrow("Participants")}
              {[{ n: "Dewey", s: "waiting" }, { n: "Hudson", s: "working" }].map((m) => (
                <div key={m.n} className="flex items-center gap-2">
                  <span className="grid place-items-center rounded-full text-[10px] font-semibold" style={{ height: 22, width: 22, background: x.inset, boxShadow: `inset 0 0 0 1.5px ${IDENT[m.n]}`, color: IDENT[m.n] }}>{m.n[0]}</span>
                  <span className="text-[12px]" style={{ color: p.ink }}>{m.n}</span>
                  <span className="ml-auto flex items-center gap-1" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}><span style={{ width: 5, height: 5, borderRadius: 9, background: m.s === "working" ? IDENT[m.n] : p.dim }} />{m.s}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {eyebrow("Relationship")}
              {fact(<GBranch />, "Delegation · Dewey → Hudson")}
              {fact(<GFolder />, "talkie-overlay-settings")}
            </div>
            <div className="flex flex-col gap-1.5">
              {eyebrow("Delivery")}
              <div className="rounded-[8px] px-2.5 py-2" style={{ background: x.inset, boxShadow: x.insetShadow, border: `1px solid ${x.hair}` }}>
                {([["Delivered", "2m"], ["Seen", "2m"], ["Working", "30s"], ["Replied", "—"]] as [string, string][]).map(([k, v], idx) => {
                  const live = v !== "—";
                  return (
                    <div key={k} className="flex items-center gap-2" style={{ marginTop: idx ? 5 : 0 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 9, background: live ? p.dim : "transparent", boxShadow: live ? undefined : `inset 0 0 0 1px ${x.hairS}`, flex: "none" }} />
                      <span style={{ fontFamily: MONO, fontSize: 10, color: live ? p.muted : p.dim }}>{k}</span>
                      <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 9.5, color: p.dim }}>{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3.5 shrink-0" style={{ height: 24, background: x.chrome, borderTop: `1px solid ${x.hair}` }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: p.dim }}>Observing · agent ↔ agent · 3 live</span>
        <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: p.dim }}>broker online</span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ELEVATED treatment — frosted glass · corner ticks · bracketed segments
   · hand-drawn glyphs · bubbles. Re-pegged to the REAL palette + indigo:
   no more borrowed dark canvas or chartreuse accent.
   ════════════════════════════════════════════════════════════════════ */

function ev(s = 18) {
  return { width: s, height: s, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
}
function GBubbles() { return <svg {...ev()} aria-hidden><path d="M2.4 4.3a1.4 1.4 0 0 1 1.4-1.4h6.1a1.4 1.4 0 0 1 1.4 1.4v3.1a1.4 1.4 0 0 1-1.4 1.4H5.6L3.2 10v-1.2H3.8" /><path d="M8.4 8.8h3.8a1.4 1.4 0 0 1 1.4 1.4v1.7a1.4 1.4 0 0 1-1.4 1.4h-.6V14l-1.8-1.7H7.6" opacity=".55" /></svg>; }
function GPeople() { return <svg {...ev()} aria-hidden><circle cx="6" cy="5.4" r="2.1" /><path d="M2.6 12.4c0-2 1.5-3.3 3.4-3.3s3.4 1.3 3.4 3.3" /><circle cx="11.2" cy="6" r="1.6" opacity=".55" /><path d="M10 12.4c0-1.6.9-2.7 2.2-2.7 1 0 1.7.6 2 1.5" opacity=".55" /></svg>; }
function GTail() { return <svg {...ev()} aria-hidden><path d="M1.6 8h2.1l1.3-3.6 1.9 7L9 6.1l1.1 1.9h3.3" /></svg>; }
function GRepos() { return <svg {...ev()} aria-hidden><circle cx="4.4" cy="4" r="1.5" /><circle cx="4.4" cy="12" r="1.5" /><circle cx="11.6" cy="4" r="1.5" /><path d="M4.4 5.5v5" /><path d="M4.4 9.2c0-2.8 2.4-2.8 4.6-3.4 1.2-.3 2.6-.8 2.6-2.3" opacity=".75" /></svg>; }
function GGear() { return <svg {...ev()} aria-hidden><path d="M2.5 4.5h7M11.5 4.5h2" /><circle cx="10" cy="4.5" r="1.4" /><path d="M2.5 11.5h2M6.5 11.5h7" /><circle cx="5" cy="11.5" r="1.4" /></svg>; }
const G_NAV = [GBubbles, GPeople, GTail, GRepos];

function CornerTicks({ color, gap = 4, len = 5 }: { color: string; gap?: number; len?: number }) {
  const base: React.CSSProperties = { position: "absolute", width: len, height: len, opacity: 0.7, pointerEvents: "none" };
  const edge = `1px solid ${color}`;
  return (
    <>
      <span style={{ ...base, top: gap, left: gap, borderTop: edge, borderLeft: edge }} />
      <span style={{ ...base, top: gap, right: gap, borderTop: edge, borderRight: edge }} />
      <span style={{ ...base, bottom: gap, left: gap, borderBottom: edge, borderLeft: edge }} />
      <span style={{ ...base, bottom: gap, right: gap, borderBottom: edge, borderRight: edge }} />
    </>
  );
}

function ElevatedComms({ p }: { p: Pal }) {
  const pip = (state: Conv["state"], size = 7) => {
    const tint = pipColor(p, state);
    const glow = state === "working" || state === "available";
    return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: tint, boxShadow: glow ? `0 0 0 3px color-mix(in oklab, ${tint} 28%, transparent)` : undefined }} />;
  };
  const pill = (children: React.ReactNode, tone: "neutral" | "accent" | "warn" | "ok" = "neutral") => {
    const styles: Record<string, React.CSSProperties> = {
      neutral: { color: p.muted, border: `1px solid ${p.glassBorder}` },
      accent: { color: p.accent, border: `1px solid ${p.accent}`, background: p.accentSoft },
      warn: { color: p.warnFg, border: `1px solid ${p.warnFg}`, background: p.warnBg },
      ok: { color: p.okFg, border: `1px solid ${p.okFg}`, background: p.okBg },
    };
    return <span className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-[2px] rounded-[4px] inline-flex items-center gap-1" style={{ fontFamily: MONO, ...styles[tone] }}>{children}</span>;
  };
  const segments = (items: string[], active: string) => (
    <div className="flex items-center gap-1">
      {items.map((it) => {
        const on = it === active;
        return (
          <span key={it} className="text-[10px] uppercase tracking-[0.13em] px-1.5 py-[3px] rounded-[5px] inline-flex items-center gap-1" style={{ fontFamily: MONO, ...(on ? { color: p.accent, ...glassRaised(p) } : { color: p.muted }) }}>
            {on && <span style={{ color: p.accent, opacity: 0.7 }}>⌜</span>}{it}{on && <span style={{ color: p.accent, opacity: 0.7 }}>⌝</span>}
          </span>
        );
      })}
    </div>
  );
  const evkv = (k: string, v: React.ReactNode, tint?: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ fontFamily: MONO, color: p.dim }}>{k}</span>
      <span className="text-[11px] tabular-nums text-right" style={{ fontFamily: MONO, color: tint ?? p.ink }}>{v}</span>
    </div>
  );
  const evsection = (title: string, body: React.ReactNode) => (
    <div className="relative rounded-lg px-3 py-2.5" style={glassPanel(p)}>
      <CornerTicks color={p.glassBorder} />
      <div className="text-[9px] font-bold uppercase mb-2" style={{ fontFamily: MONO, letterSpacing: "0.16em", color: p.muted }}>{title}</div>
      <div className="space-y-[5px]">{body}</div>
    </div>
  );

  return (
    <div className="relative overflow-hidden rounded-[14px]" style={{ ...glassWindow(p), color: p.ink }}>
      {/* titlebar */}
      <div className="flex items-center gap-3 px-3.5 h-[42px]" style={{ borderBottom: `1px solid ${p.glassBorder}` }}>
        <div className="flex items-center gap-2">
          <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#FF5F57", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.2)" }} />
          <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#FEBC2E", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.2)" }} />
          <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#28C840", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.2)" }} />
        </div>
        <div className="flex items-baseline gap-2 ml-1">
          <span className="text-[11px] tracking-[0.04em] font-semibold" style={{ fontFamily: MONO, color: p.ink }}>Scout</span>
          <span className="text-[11px]" style={{ color: p.dim }}>—</span>
          <span className="text-[11px] tracking-[0.06em] uppercase" style={{ fontFamily: MONO, color: p.muted }}>Comms</span>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-[7px] px-2 py-[5px] text-[10px] uppercase tracking-[0.1em]" style={{ fontFamily: MONO, color: p.accent, ...glassRaised(p) }}>
          <svg {...ev(12)} aria-hidden><path d="M8 3.5v9M3.5 8h9" /></svg>New
        </span>
      </div>

      <div className="flex" style={{ height: 532 }}>
        {/* nav rail */}
        <div className="flex flex-col items-center gap-1.5 py-3 px-2 shrink-0" style={{ width: 56, background: p.mode === "light" ? "rgba(255,255,255,0.25)" : "rgba(11,14,21,0.4)", borderRight: `1px solid ${p.glassBorder}` }}>
          {G_NAV.map((Glyph, i) => {
            const on = i === 0;
            return (
              <div key={i} className="relative flex h-9 w-9 items-center justify-center rounded-[9px]" style={on ? glassRaised(p) : undefined}>
                {on && <span className="absolute left-[-8px] top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full" style={{ background: p.accent }} />}
                <span style={{ color: on ? p.accent : p.muted }}><Glyph /></span>
              </div>
            );
          })}
          <div className="mt-auto flex h-9 w-9 items-center justify-center rounded-[9px]" style={{ color: p.dim }}><GGear /></div>
        </div>

        {/* list */}
        <div className="flex flex-col shrink-0" style={{ width: 256, borderRight: `1px solid ${p.glassBorder}` }}>
          <div className="flex items-center gap-2 px-3 h-[38px] shrink-0" style={{ borderBottom: `1px solid ${p.glassBorder}` }}>{segments(["All", "Asks", "Unread"], "All")}</div>
          <div className="flex-1 overflow-hidden px-2 py-2 space-y-3">
            {GROUPS.map((grp) => {
              const rows = CONVS.filter((c) => c.group === grp.id);
              if (!rows.length) return null;
              return (
                <div key={grp.id}>
                  <div className="px-1.5 mb-1 text-[8.5px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: "0.2em", color: p.dim }}>{grp.label.charAt(0) + grp.label.slice(1).toLowerCase()}</div>
                  {rows.map((c) => {
                    const sel = c.name === SELECTED;
                    return (
                      <div key={c.name} className="relative flex items-start gap-2.5 rounded-[8px] px-2.5 py-2" style={sel ? glassRaised(p) : undefined}>
                        <span className="mt-[3px]">{pip(c.state)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-[12px] truncate" style={{ color: p.ink }}>{c.name}</span>
                            {c.ask === "pending" && pill("ask", "warn")}
                            <span className="ml-auto text-[10px] tabular-nums" style={{ fontFamily: MONO, color: p.dim }}>{c.time}</span>
                            {c.unread > 0 && <span className="text-[9px] tabular-nums rounded-full px-1.5 py-[1px]" style={{ fontFamily: MONO, color: p.accentOn, background: p.accent }}>{c.unread}</span>}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug line-clamp-1" style={{ color: p.muted }}>{c.preview}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* thread */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2.5 px-4 h-[44px] shrink-0" style={{ borderBottom: `1px solid ${p.glassBorder}` }}>
            {pip("working", 8)}
            <div>
              <div className="text-[12.5px] font-semibold leading-none" style={{ color: p.ink }}>Dewey</div>
              <div className="text-[9.5px] mt-1" style={{ fontFamily: MONO, color: p.dim }}>~/dev/dewey · main · c.a4d433a9</div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">{pill("Observe")}{pill("Message", "accent")}</div>
          </div>

          {/* pinned ask */}
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-[8px] px-3 py-2" style={glassPanel(p)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={p.dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 17v5" /><path d="M9 10.76 5.5 14h13L15 10.76V4h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1z" /></svg>
            <span className="text-[8.5px] uppercase tracking-[0.1em]" style={{ fontFamily: MONO, color: p.muted }}>Pinned ask · answered</span>
            <span className="text-[8.5px]" style={{ fontFamily: MONO, color: p.dim }}>from Art</span>
          </div>

          <div className="flex-1 overflow-hidden px-4 py-3.5 space-y-3.5">
            <div className="flex items-center gap-2 rounded-[7px] px-2.5 py-1.5 w-fit" style={glassPanel(p)}>
              <span className="text-[9px] uppercase tracking-[0.1em]" style={{ fontFamily: MONO, color: p.dim }}>reply ▸</span>
              <span className="text-[11px]" style={{ color: p.ink }}>surface active theme in inspector</span>
              {pill("done", "accent")}
            </div>
            {TURNS.map((t, i) => (
              <div key={i} className={t.me ? "flex justify-end" : "flex justify-start"}>
                <div className="max-w-[78%] rounded-[11px] px-3 py-2 text-[12px] leading-snug" style={t.me ? { color: p.accentOn, background: p.accent, boxShadow: p.meBubbleShadow } : { color: p.ink, ...glassRaised(p) }}>{t.body}</div>
              </div>
            ))}
          </div>

          <div className="px-4 pb-3 pt-1 shrink-0">
            <div className="rounded-[9px] px-3 py-2 flex items-center" style={glassPanel(p)}>
              <span className="text-[11px]" style={{ color: p.dim }}>Message Dewey…</span>
              <span className="ml-auto text-[9px] uppercase tracking-[0.1em]" style={{ fontFamily: MONO, color: p.dim }}>⌘↵</span>
            </div>
          </div>
        </div>

        {/* inspector */}
        <div className="shrink-0 flex flex-col gap-2.5 px-2.5 py-2.5" style={{ width: 210, borderLeft: `1px solid ${p.glassBorder}`, background: p.mode === "light" ? "rgba(255,255,255,0.2)" : "rgba(11,14,21,0.3)" }}>
          <div className="flex items-center gap-2.5 px-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] font-semibold text-[13px]" style={{ color: p.ink, ...glassRaised(p) }}>D</span>
            <div>
              <div className="text-[13px] font-semibold leading-none" style={{ color: p.ink }}>Dewey</div>
              <div className="mt-1 flex items-center gap-1.5">{pip("working", 6)}<span className="text-[9.5px] uppercase tracking-[0.08em]" style={{ fontFamily: MONO, color: p.muted }}>working</span></div>
            </div>
          </div>
          {evsection("Conversation", <>{evkv("Last", "2m")}{evkv("Unread", "2", p.accent)}{evkv("Channel", "DM")}</>)}
          {evsection("Project", <>{evkv("Repo", "dewey")}{evkv("Branch", "main")}</>)}
          {evsection("Ask", <div className="flex items-center gap-1.5">{pill("answered")}<span className="text-[10.5px]" style={{ color: p.muted }}>from Art</span></div>)}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3.5 h-[26px]" style={{ borderTop: `1px solid ${p.glassBorder}`, background: p.mode === "light" ? "rgba(255,255,255,0.25)" : "rgba(11,14,21,0.4)" }}>
        <span className="text-[9.5px] tracking-[0.08em] uppercase" style={{ fontFamily: MONO, color: p.dim }}>24 conversations · 2 need you</span>
        <span className="ml-auto text-[9.5px] tracking-[0.08em] uppercase" style={{ fontFamily: MONO, color: p.dim }}>broker online</span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Ledger — with mode + accent now controlled, what the elevated
   treatment actually contributes (and what was merely the confound).
   ════════════════════════════════════════════════════════════════════ */

type Verdict = "substance" | "plating" | "neutralized";
const VERDICT: Record<Verdict, { label: string; bg: string; fg: string }> = {
  substance: { label: "Substance", bg: "var(--status-ok-bg)", fg: "var(--status-ok-fg)" },
  plating: { label: "Plating", bg: "var(--status-warn-bg)", fg: "var(--status-warn-fg)" },
  neutralized: { label: "Was the confound", bg: "var(--status-info-bg)", fg: "var(--status-info-fg)" },
};
const LEDGER: { move: string; detail: string; verdict: Verdict }[] = [
  { move: "Dark canvas", detail: "The earlier render only looked elevated because it sat on near-black. Mode is now its own axis — flip it for either treatment — so it can't carry the before/after.", verdict: "neutralized" },
  { move: "Chartreuse accent", detail: "The studio's green :root accent did a lot of the talking. Both treatments now use the app's real indigo, so the accent is no longer a variable.", verdict: "neutralized" },
  { move: "Frosted glass + ambient glow", detail: "backdrop-blur, inset highlights, soft bloom. In the app's own light palette it mostly reads as haze over the same content — presentation, not a UX gain.", verdict: "plating" },
  { move: "Raised card rows", detail: "Selected rows float on a glass tile vs the app's flat row + 2px accent bar + soft wash. Costs density and edge clarity for a lift.", verdict: "plating" },
  { move: "Corner ticks + bracketed segments", detail: "⌜ ⌝ tick marks and bracket framing on controls. Decorative cockpit styling with no native referent.", verdict: "plating" },
  { move: "Hand-drawn line glyphs", detail: "Thin custom marks replace SF Symbols. A deliberate brand call — but a costume change, not a comprehension win.", verdict: "plating" },
  { move: "Chat bubbles", detail: "Sender-sided bubbles vs a flat sender-led transcript. A real layout choice — debatable on a dense ops surface, not free.", verdict: "substance" },
  { move: "Pinned originating-ask band", detail: "Pins the ask the thread answers. Real comprehension win — reads cleanly in the flat native idiom too.", verdict: "substance" },
  { move: "Reply-context backlink", detail: "Resolves the raw [ask:<id>] token into reply-to · title · from · status. The headline feature; lands in either treatment.", verdict: "substance" },
  { move: "Signed-off inspector blocks", detail: "Identity → Open → Conversation → Project → Ask. Real IA — and it reads fine as flat native sections.", verdict: "substance" },
];

function Ledger() {
  return (
    <div className="overflow-hidden rounded-[8px] border border-studio-edge">
      <div className="grid gap-x-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint" style={{ gridTemplateColumns: "180px 1fr 116px" }}>
        <span>Elevated move</span><span>What it actually is, once mode + accent are controlled</span><span className="text-right">Verdict</span>
      </div>
      {LEDGER.map((row, i) => {
        const v = VERDICT[row.verdict];
        return (
          <div key={row.move} className={["grid items-start gap-x-3 px-3 py-2", i > 0 ? "border-t border-studio-edge" : ""].join(" ")} style={{ gridTemplateColumns: "180px 1fr 116px" }}>
            <span className="font-sans text-[11px] font-semibold text-studio-ink">{row.move}</span>
            <span className="font-sans text-[10.5px] leading-snug text-studio-ink-muted">{row.detail}</span>
            <span className="text-right"><span className="inline-block rounded-[2px] px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow" style={{ background: v.bg, color: v.fg }}>{v.label}</span></span>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Page — two orthogonal toggles: MODE × TREATMENT.
   ════════════════════════════════════════════════════════════════════ */

type Treatment = "current" | "proposal" | "elevated";

function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[9px] p-1" style={{ background: "color-mix(in oklab, var(--studio-surface) 60%, transparent)", border: "1px solid var(--studio-edge)" }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} className="rounded-[6px] px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors" style={on ? { color: "var(--scout-accent)", background: "var(--studio-surface)", border: "1px solid var(--studio-edge-strong)" } : { color: "var(--studio-ink-muted)", border: "1px solid transparent" }}>{o.label}</button>
        );
      })}
    </div>
  );
}

export default function ScoutMacOSControlPage() {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [treatment, setTreatment] = useState<Treatment>("proposal");
  const p = mode === "light" ? LIGHT : DARK;

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* No ambient tint. The page rides the studio shell (so the prose +
       *  toggles keep their studio theming); indigo stays a whisper *inside*
       *  the comms window only — selection / unread / own bubble / send — and
       *  never washes the backdrop. The earlier indigo glow here was just the
       *  studio's green subsidy repainted purple; the honest read is the real
       *  running app, not an ambient studio glow of any hue. */}
      <div className="mx-auto max-w-[1180px] px-6 py-10">
        <header className="mb-9 max-w-[68ch]">
          <EyebrowLabel className="mb-3">Studies · macOS · Control</EyebrowLabel>
          <h1 className="text-[30px] font-semibold tracking-tight text-studio-ink leading-none">The existing style, reconstructed</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-studio-ink-muted">
            The refresh has been chasing a “more elevated” direction, and those renders read as a big leap.
            But a chunk of the leap was <span className="text-studio-ink">plating the studio handed over for free</span> — its default
            skin is dark with a neon-green accent, so the elevated windows inherited dark canvas, glow, and green before one
            deliberate decision was made.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-studio-ink-muted">
            So this control is built as an honest test. <span className="text-studio-ink">Mode and treatment are separate axes.</span> The
            before/after is the <span className="text-studio-ink">treatment</span>, always within one mode — a dark↔light swap never
            stands in for the improvement. Both treatments use the app's real <span className="text-studio-ink">indigo</span> accent;
            the elevated side no longer cheats with green-on-black. The content is identical across all four cells, so the only
            thing changing in the before/after is the treatment language itself.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-studio-ink-faint">Treatment · current vs proposal</span>
              <Toggle value={treatment} onChange={setTreatment} options={[{ id: "current", label: "Current" }, { id: "proposal", label: "Proposal" }, { id: "elevated", label: "Elevated" }]} />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-studio-ink-faint">Mode · independent</span>
              <Toggle value={mode} onChange={setMode} options={[{ id: "light", label: "Light" }, { id: "dark", label: "Dark" }]} />
            </div>
          </div>
          <p className="mt-2.5 font-mono text-[10px] text-studio-ink-faint">
            {treatment === "current" ? "Current · honest flat baseline — the app as it ships" : treatment === "proposal" ? "Proposal · fine hairlines · connected spine · glyph-led facts · quiet ghost actions" : "Elevated (reference) · frosted glass · the studio's flattered render"}
            {"  ·  "}{mode === "light" ? "Juniper Light · Indigo" : "Juniper Dark · Indigo"}
          </p>
        </header>

        <section className="mb-12">
          {treatment === "current" ? <CurrentComms p={p} /> : treatment === "proposal" ? <ProposalComms p={p} /> : <ElevatedComms p={p} />}
          <p className="mt-3 max-w-[74ch] text-[12px] leading-relaxed text-studio-ink-faint">
            {treatment === "current"
              ? "The honest baseline — the existing style reconstructed flat (sender-led transcript, no bubble). The “don't cheat the current” reference; a real screenshot of the running app is the next step toward true fidelity."
              : treatment === "proposal"
              ? "The crisp direction, channeling agent-lanes: a connected spine the turns hang off as nodes, incoming bubbles floating on a hairline (yours flat/anchored), glyph-led mono facts in the inspector, a recessed ❯ composer, hairlines at ~7% alpha, and quiet ghost actions — no bordered pills. Flip Mode to see it in either palette."
              : "Elevated, kept only as a reference — the frosted-glass render the studio's dark/green skin flattered. Not the direction we're taking."}
          </p>
        </section>

        <section className="mb-12">
          <h2 className="mb-1 text-[18px] font-medium tracking-tight text-studio-ink">Agent ↔ agent · observer-first</h2>
          <p className="mb-5 max-w-[74ch] text-[13px] leading-relaxed text-studio-ink-muted">
            The window above is operator-anchored: <span className="text-studio-ink">accent = “me”</span>, everything else floats. An
            agent↔agent thread has no “me”, so here <span className="text-studio-ink">no bubble takes the accent</span> — it’s reserved
            for the moment you <span className="text-studio-ink">jump in</span> (the dashed well’s send). Identity moves to the{" "}
            <span className="text-studio-ink">node</span> (sprite + a desaturated identity ring) and the name; the agent-to-agent
            affordances become first-class — a <span className="text-studio-ink">seen/ack receipt</span> before the slow reply, a live
            “composing” node, and <span className="text-studio-ink">handoff provenance</span> on every turn. Uses the Mode toggle above.
          </p>
          <A2AComms p={p} />
          <p className="mt-3 max-w-[74ch] text-[12px] leading-relaxed text-studio-ink-faint">
            You’re watching Dewey delegate to Hudson. The absence of accent reads as “you’re not in this thread”; the dashed
            jump-in well — with the accent send — is the one place the accent returns, because injecting makes you a participant.
            Delivery state (delivered → seen → working → replied) lives on the node and in the inspector’s ack timeline.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-[18px] font-medium tracking-tight text-studio-ink">Plating vs. substance</h2>
          <p className="mb-5 max-w-[74ch] text-[13px] leading-relaxed text-studio-ink-muted">
            With mode and accent now controlled, the two moves that did the heavy lifting earlier — <span style={{ color: "var(--status-info-fg)" }}>dark
            canvas</span> and the <span style={{ color: "var(--status-info-fg)" }}>green accent</span> — drop out of the comparison entirely.
            What's left sorts cleanly into <span style={{ color: "var(--status-ok-fg)" }}>substance</span> (real improvements that ship in
            either treatment, and are already in the Existing render above) and <span style={{ color: "var(--status-warn-fg)" }}>plating</span> (the
            glass-and-ticks costume). The substance is the actual refresh; the rest is presentation.
          </p>
          <Ledger />
        </section>
      </div>
    </div>
  );
}
