"use client";

// Scout iOS — phone chrome + per-surface lab scaffold.
//
// <PhoneShell> draws the device + the fixed RootView chrome (status bar,
// masthead, docked tab bar, cockpit status bar) around a surface body.
// <SurfaceLab> is the page scaffold every dedicated surface study uses: a
// header + nav, a palette toggle, a treatment switcher, and a notes column —
// so each surface is its own page you can try treatments on, one system.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Glyph } from "./Glyph";
import { Seg } from "./primitives";
import { SCOUT_IOS_CSS, TABS, type Surface, type Variant } from "./theme";

/** Treatment hooks flipped onto the `.scoutios` wrapper (see theme.ts). */
export interface TreatmentMods { density?: "compact"; layout?: "hairline"; tone?: "kind"; }

/** Surfaces where the persistent compose "+" appears (always the same masthead
 *  spot, but only where starting a new conversation/session is meaningful). Ops,
 *  Settings, Connect, etc. are omitted — "new" means nothing there. */
const COMPOSE_SURFACES: Surface[] = ["home", "comms", "agents"];

/** One treatment on a surface — a labelled variant of the body + its rationale. */
export interface Treatment {
  id: string;
  label: string;
  /** One-line rationale shown in the notes column. */
  note?: ReactNode;
  /** The `.iBody` surface to render. */
  body: ReactNode;
  /** Data-attribute deltas (density / layout) applied to the frame. */
  mods?: TreatmentMods;
}

/** Inject the scoped CSS once. Safe to mount more than once (identical text). */
export function ScoutIOSStyles() {
  return <style>{SCOUT_IOS_CSS}</style>;
}

/** The device + RootView chrome around a surface body. */
export function PhoneShell({
  surface, variant, mods, header, showChrome = true, tabBadges, children,
}: {
  surface: Surface; variant: Variant; mods?: TreatmentMods;
  /** Replaces the default "Scout" masthead (for pushed/sheet surfaces). */
  header?: ReactNode;
  /** Show the docked tab bar + cockpit status bar. False for full-screen pushes. */
  showChrome?: boolean;
  /** Count badges per tab, keyed by lowercased label (e.g. `{ inbox: 5 }`). */
  tabBadges?: Partial<Record<string, number>>;
  children: ReactNode;
}) {
  return (
    <div className="scoutios" data-v={variant} data-density={mods?.density} data-layout={mods?.layout} data-tone={mods?.tone}>
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

          {/* Masthead — "Scout" wordmark + gear (RootView), or a surface header */}
          {header ?? (
            <div className="iHead">
              <div className="iMast">
                <span className="iWordmark">Scout</span>
                {COMPOSE_SURFACES.includes(surface) && (
                  <span className="iCompose"><Glyph kind="plus" size={18} /></span>
                )}
                <span className="iGear"><Glyph kind="gear" size={20} /></span>
              </div>
              <div className="iMastRule" />
            </div>
          )}

          {children}

          {showChrome && (
            <>
              {/* Docked tab bar — Home · Agents · New · Tail · Terminal */}
              <div className="iTabs">
                {TABS.map((t) => {
                  const badge = tabBadges?.[t.label.toLowerCase()];
                  return (
                    <div className="iTab" key={t.label} data-on={t.activeFor?.includes(surface) ?? false}>
                      <span className="iTabIcon">
                        <Glyph kind={t.kind} size={19} />
                        {badge != null && badge > 0 && <span className="iTabBadge">{badge}</span>}
                      </span>
                      <span className="iTabLabel">{t.label}</span>
                    </div>
                  );
                })}
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
            </>
          )}
          <div className="iHomeBar" />
        </div>
      </div>
    </div>
  );
}

// ── Lab scaffold ────────────────────────────────────────────────────────────

const SURFACE_NAV: { surface: Surface | "theme"; label: string; href: string }[] = [
  { surface: "theme", label: "Theme", href: "/studies/scout-ios" },
  { surface: "home", label: "Home", href: "/studies/scout-ios-home" },
  { surface: "agents", label: "Agents", href: "/studies/scout-ios-agents" },
  { surface: "comms", label: "Comms", href: "/studies/scout-ios-comms" },
  { surface: "conversation", label: "Conversation", href: "/studies/scout-ios-conversation" },
  { surface: "ops", label: "Ops", href: "/studies/scout-ios-ops" },
  { surface: "tail", label: "Tail", href: "/studies/scout-ios-tail" },
  { surface: "terminal", label: "Terminal", href: "/studies/scout-ios-terminal" },
  { surface: "new", label: "New", href: "/studies/scout-ios-new" },
  { surface: "connect", label: "Connect", href: "/studies/scout-ios-connect" },
  { surface: "settings", label: "Settings", href: "/studies/scout-ios-settings" },
];

/** Pushed-surface header — back chevron + title (+ subtitle/badge) + trailing. */
export function DetailHeader({ title, subtitle, badge, trailing }: {
  title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; trailing?: ReactNode;
}) {
  return (
    <div className="iDetailHead">
      <span className="iBackBtn"><Glyph kind="chevron" size={14} rotate={180} /></span>
      <div className="iDetailTitleBlock">
        <div className="iDetailTitleRow">
          <span className="iDetailTitle">{title}</span>
          {badge}
        </div>
        {subtitle && <span className="iDetailSub">{subtitle}</span>}
      </div>
      <span className="iSpacer" />
      {trailing}
    </div>
  );
}

/** Sibling-surface link row, current one accented. */
export function SurfaceNav({ current }: { current: Surface | "theme" }) {
  return (
    <nav style={{ display: "flex", gap: 4, margin: "14px 0 0", flexWrap: "wrap" }}>
      {SURFACE_NAV.map((s) => {
        const on = s.surface === current;
        return (
          <Link key={s.surface} href={s.href}
            style={{
              fontFamily: "var(--i-mono,monospace)", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none",
              padding: "4px 10px", borderRadius: 7,
              color: on ? "#04130d" : "#aab0ba",
              background: on ? "#10b981" : "#15171a",
              border: `1px solid ${on ? "#10b981" : "#24272c"}`,
            }}>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The dedicated-surface page scaffold. Renders the header + nav, a palette
 * toggle, a treatment switcher, the phone with the selected treatment, and a
 * notes column. Each surface study is `<SurfaceLab surface="…" treatments={…}/>`.
 */
export function SurfaceLab({
  surface, title, blurb, source, treatments, controls, header, showChrome = true, tabBadges,
}: {
  surface: Surface;
  title: string;
  blurb: ReactNode;
  /** Source-of-truth file, shown in the notes column. */
  source?: string;
  treatments: Treatment[];
  /** Optional surface-specific control (e.g. Agents' sort mode). */
  controls?: ReactNode;
  /** Custom phone header (pushed/sheet surfaces) — replaces the masthead. */
  header?: ReactNode;
  /** Show the docked tab bar + cockpit status bar. False for full-screen pushes. */
  showChrome?: boolean;
  /** Count badges per tab, keyed by lowercased label (e.g. `{ inbox: 5 }`). */
  tabBadges?: Partial<Record<string, number>>;
}) {
  const [variant, setVariant] = useState<Variant>("shipped");
  const [tid, setTid] = useState(treatments[0]?.id ?? "");
  const current = treatments.find((t) => t.id === tid) ?? treatments[0];

  return (
    <div style={{ minHeight: "100%", background: "#0b0c0e", color: "#e7e9ee", padding: "28px 32px 64px" }}>
      <ScoutIOSStyles />

      <header style={{ maxWidth: 980, margin: "0 auto 20px" }}>
        <div style={{ fontFamily: "var(--i-mono, monospace)", fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#10b981" }}>
          Studies · iOS
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: "6px 0 6px" }}>
          {title}
        </h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#9aa0aa", maxWidth: 640 }}>{blurb}</p>
        <SurfaceNav current={surface} />
      </header>

      {/* controls */}
      <div style={{ maxWidth: 980, margin: "0 auto 20px", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <Seg label="Palette" value={variant} onChange={(v) => setVariant(v as Variant)}
          options={[{ id: "shipped", label: "Shipped" }, { id: "hc", label: "Higher-contrast" }]} />
        {treatments.length > 1 && (
          <Seg label="Treatment" value={current?.id ?? ""} onChange={setTid}
            options={treatments.map((t) => ({ id: t.id, label: t.label }))} />
        )}
        {controls}
      </div>

      {/* stage */}
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gridTemplateColumns: "418px 1fr", gap: 40, alignItems: "start" }}>
        <PhoneShell surface={surface} variant={variant} mods={current?.mods} header={header} showChrome={showChrome} tabBadges={tabBadges}>
          {current?.body}
        </PhoneShell>

        {/* notes column */}
        <div>
          <div style={{ fontFamily: "var(--i-mono,monospace)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7f88", marginBottom: 10 }}>
            {current?.label ?? "Treatment"}
          </div>
          {current?.note && (
            <p style={{ fontSize: 13, lineHeight: 1.55, color: "#cdd2db", maxWidth: 380, margin: "0 0 14px" }}>
              {current.note}
            </p>
          )}
          {treatments.length > 1 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px", display: "grid", gap: 6 }}>
              {treatments.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setTid(t.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
                      background: "transparent", border: "none", cursor: "pointer", padding: "2px 0",
                    }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none",
                      background: t.id === current?.id ? "#10b981" : "#3a3f47" }} />
                    <span style={{ fontSize: 12.5, color: t.id === current?.id ? "#e7e9ee" : "#9aa0aa" }}>{t.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {source && (
            <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "#7a7f88", maxWidth: 380, marginTop: 4 }}>
              <strong style={{ color: "#9aa0aa" }}>Source.</strong>{" "}
              <code style={{ fontFamily: "var(--i-mono,monospace)", color: "#9aa0aa" }}>{source}</code> — the baseline
              treatment is a faithful port. Add a treatment by pushing onto the{" "}
              <code style={{ fontFamily: "var(--i-mono,monospace)", color: "#9aa0aa" }}>treatments</code> array.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
