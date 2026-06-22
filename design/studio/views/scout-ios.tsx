"use client";

/**
 * Scout iOS — hub / index.
 *
 * The family overview + the source of truth for "what's current". The bar is
 * four tabs — Home · Comms · Agents · Ops — with New as a contextual masthead
 * compose (not a tab). The in-frame switcher shows those four; each also has a
 * dedicated lab (reached from the nav row + the directory below). Detail
 * surfaces (Conversation, New-sheet, Connect, Settings) are pushed, not tabs.
 * Tail + Terminal are now *inside* Ops, not standalone tabs.
 *
 * The `--i-*` vars are the exact native values: HudPalette / HudHairline
 * (~/dev/hudson/.../HudsonUI/Tokens/HudPalette.swift) + the Scout card/canvas
 * tones (apps/ios/Scout/Theme.swift). It is dark-locked — no presets, no light
 * mode, no accent switching, unlike macOS's ScoutThemeColors.
 */

// Surface directory — the single map of what's current, grouped by role.
const SURFACE_MAP: { group: string; items: { label: string; href: string; note: string }[] }[] = [
  { group: "Tabs", items: [
    { label: "Home", href: "/studies/scout-ios-home", note: "needs-you band + ambient swarm" },
    { label: "Comms", href: "/studies/scout-ios-comms", note: "the chats (DMs + channels)" },
    { label: "Agents", href: "/studies/scout-ios-agents", note: "the directory / inventory tree" },
    { label: "Ops", href: "/studies/scout-ios-ops", note: "Tail (default) + Terminal toggle" },
  ] },
  { group: "Detail · pushed", items: [
    { label: "Conversation", href: "/studies/scout-ios-conversation", note: "a chat transcript — opens from Comms" },
    { label: "New", href: "/studies/scout-ios-new", note: "the compose sheet the “+” opens" },
    { label: "Connect", href: "/studies/scout-ios-connect", note: "pairing — from the gear" },
    { label: "Settings", href: "/studies/scout-ios-settings", note: "from the gear" },
  ] },
  { group: "Inside Ops", items: [
    { label: "Tail", href: "/studies/scout-ios-tail", note: "now the default view of Ops" },
    { label: "Terminal", href: "/studies/scout-ios-terminal", note: "now the toggle inside Ops" },
  ] },
];

import { useState } from "react";
import Link from "next/link";
import {
  PhoneShell, ScoutIOSStyles, SurfaceNav, Seg,
  HomeSurface, AgentsSurface, CommsSurface, OpsSurface,
  BOARD, type Surface, type Variant,
} from "@/components/scout-ios";

export default function ScoutIOSThemeHub() {
  const [variant, setVariant] = useState<Variant>("shipped");
  const [surface, setSurface] = useState<Surface>("home");
  const [agentSort, setAgentSort] = useState<"project" | "recent">("project");
  const [opsView, setOpsView] = useState<"tail" | "terminal">("tail");

  // The four current tabs: Home · Comms · Agents · Ops.
  const body =
    surface === "home" ? <HomeSurface /> :
    surface === "comms" ? <CommsSurface /> :
    surface === "agents" ? <AgentsSurface sort={agentSort} onSort={setAgentSort} /> :
    <OpsSurface view={opsView} onView={setOpsView} />;

  return (
    <div style={{ minHeight: "100%", background: "#0b0c0e", color: "#e7e9ee", padding: "28px 32px 64px" }}>
      <ScoutIOSStyles />

      <header style={{ maxWidth: 980, margin: "0 auto 20px" }}>
        <div style={{ fontFamily: "var(--i-mono, monospace)", fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#10b981" }}>
          Studies · iOS
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: "6px 0 6px" }}>
          Scout iOS — hub
        </h1>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "#cdd2db", maxWidth: 640, margin: "0 0 4px" }}>
          <strong style={{ color: "#10b981" }}>Current bar:</strong> Home · Comms · Agents · Ops (four tabs).
          New is a contextual compose “+” in the masthead, not a tab. Tail + Terminal live inside Ops.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#9aa0aa", maxWidth: 620 }}>
          The iOS app renders on Hudson&rsquo;s <code style={{ fontFamily: "var(--i-mono,monospace)", color: "#cdd2db" }}>HudPalette</code> dark
          palette (emerald accent, dark-locked — no presets or light mode) plus a thin Scout layer
          (<code style={{ fontFamily: "var(--i-mono,monospace)", color: "#cdd2db" }}>ScoutCanvas</code> wash + <code style={{ fontFamily: "var(--i-mono,monospace)", color: "#cdd2db" }}>scoutCard</code> depth).
          Toggle the proposed higher-contrast palette — it mirrors the macOS dark port: raise <code style={{ fontFamily: "var(--i-mono,monospace)", color: "#cdd2db" }}>dim</code> past
          WCAG AA, lift surface/card off the canvas, strengthen hairlines.
        </p>

        {/* Surface directory — the single map of what's current */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, margin: "18px 0 4px", maxWidth: 760 }}>
          {SURFACE_MAP.map((g) => (
            <div key={g.group}>
              <div style={{ fontFamily: "var(--i-mono,monospace)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: g.group === "Inside Ops" ? "#7a7f88" : "#10b981", marginBottom: 8 }}>{g.group}</div>
              <div style={{ display: "grid", gap: 5 }}>
                {g.items.map((it) => (
                  <Link key={it.label} href={it.href} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 1, padding: "6px 9px", borderRadius: 8, background: "#121316", border: "1px solid #24272c" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "#e7e9ee" }}>{it.label}</span>
                    <span style={{ fontSize: 10.5, color: "#7a7f88" }}>{it.note}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <SurfaceNav current="theme" />
      </header>

      {/* controls */}
      <div style={{ maxWidth: 980, margin: "0 auto 20px", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <Seg label="Palette" value={variant} onChange={(v) => setVariant(v as Variant)}
          options={[{ id: "shipped", label: "Shipped" }, { id: "hc", label: "Higher-contrast" }]} />
        <Seg label="Surface" value={surface} onChange={(v) => setSurface(v as Surface)}
          options={[{ id: "home", label: "Home" }, { id: "comms", label: "Comms" }, { id: "agents", label: "Agents" }, { id: "ops", label: "Ops" }]} />
      </div>

      {/* stage */}
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gridTemplateColumns: "418px 1fr", gap: 40, alignItems: "start" }}>
        <PhoneShell surface={surface} variant={variant}>{body}</PhoneShell>

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
