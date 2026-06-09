"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * ScoutNext Nav Lab — bottom-navigation treatment gallery + Home polish ideas.
 *
 * A breadth-first playground: many active-state treatments, bar heights, and bar
 * materials rendered at true iPhone width (375pt) so we can pick a direction, plus
 * a set of Home polish experiments. The winning shapes port to
 * apps/ios/ScoutNext/RootView.swift (tab bar) + HomeSurface.swift.
 */

const ACCENT = "var(--scout-accent)";

// ── Glyph set (ported from apps/ios/ScoutNext/Glyphs.swift) ──────────────────

type GlyphKind = "home" | "agent" | "comms" | "terminal" | "plus";

const GLYPHS: Record<GlyphKind, ReactNode> = {
  home: (
    <>
      <rect x="3" y="3" width="7.75" height="7.75" rx="1.9" />
      <rect x="13.25" y="3" width="7.75" height="7.75" rx="1.9" />
      <rect x="3" y="13.25" width="7.75" height="7.75" rx="1.9" />
      <rect x="13.25" y="13.25" width="7.75" height="7.75" rx="1.9" />
    </>
  ),
  agent: (
    <>
      <circle cx="12" cy="7.9" r="3.2" />
      <path d="M5.3 19.3Q12 12.4 18.7 19.3" />
    </>
  ),
  comms: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="3.4" />
      <path d="M8.5 16 7 20 12.5 16" />
    </>
  ),
  terminal: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M6.5 10 9.5 13 6.5 16" />
      <path d="M11.5 16 15.5 16" />
    </>
  ),
  plus: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.6" />
      <path d="M12 9 12 15" />
      <path d="M9 12 15 12" />
    </>
  ),
};

function Glyph({
  kind,
  size = 18,
  className,
  style,
}: {
  kind: GlyphKind;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={Math.max(1, size * (1.6 / 24))}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {GLYPHS[kind]}
    </svg>
  );
}

const TABS: Array<{ label: string; kind: GlyphKind }> = [
  { label: "Home", kind: "home" },
  { label: "Agents", kind: "agent" },
  { label: "Comms", kind: "comms" },
  { label: "Terminal", kind: "terminal" },
  { label: "New", kind: "plus" },
];

// ── Nav bar (spec-driven) ────────────────────────────────────────────────────

type Indicator =
  | "capsuleGlow" // current shipped treatment
  | "topBar"
  | "bottomBar"
  | "dotUnder"
  | "underline"
  | "softPill"
  | "filledTile"
  | "ring"
  | "activeFill"
  | "colorOnly";

interface NavSpec {
  indicator: Indicator;
  height: number; // tab button height (content area)
  glyph: number;
  labels: boolean;
  bar?: "flat" | "frosted" | "floating" | "raised";
  tintBar?: boolean; // faint accent wash in the bar fill
  topAccentLine?: boolean; // accent hairline on the bar's top edge
}

function NavBar({ spec }: { spec: NavSpec }) {
  const floating = spec.bar === "floating";
  const style: CSSProperties = { paddingLeft: 8, paddingRight: 8 };
  if (spec.tintBar) {
    style.background = "color-mix(in oklab, var(--scout-accent) 7%, rgba(255,255,255,0.02))";
  } else if (spec.bar === "frosted") {
    style.background = "rgba(255,255,255,0.05)";
    style.backdropFilter = "blur(8px)";
  } else if (spec.bar === "raised") {
    style.background = "rgba(255,255,255,0.06)";
    style.backdropFilter = "blur(14px)";
  } else if (floating) {
    style.background = "rgba(255,255,255,0.07)";
    style.backdropFilter = "blur(8px)";
  } else {
    style.background = "rgba(255,255,255,0.025)";
  }
  if (floating) {
    style.margin = "0 12px 8px";
    style.borderRadius = 20;
    style.border = "1px solid rgba(255,255,255,0.08)";
    style.boxShadow = "0 8px 24px -12px rgba(0,0,0,0.7)";
  } else {
    style.borderTop = spec.topAccentLine
      ? "1.5px solid color-mix(in oklab, var(--scout-accent) 55%, transparent)"
      : "1px solid rgba(255,255,255,0.08)";
    // "Raised" reads as lifted off the content — a soft shadow casts upward so
    // the list appears to scroll underneath it.
    if (spec.bar === "raised") {
      style.boxShadow = "0 -14px 32px -16px rgba(0,0,0,0.9)";
    }
  }
  return (
    <div className="grid grid-cols-5" style={style}>
      {TABS.map((tab, i) => (
        <Tab key={tab.label} tab={tab} active={i === 0} spec={spec} />
      ))}
    </div>
  );
}

function Tab({
  tab,
  active,
  spec,
}: {
  tab: { label: string; kind: GlyphKind };
  active: boolean;
  spec: NavSpec;
}) {
  const ind = spec.indicator;
  const muted = "rgba(255,255,255,0.45)";

  // Glyph + label coloring per indicator.
  let glyphColor = active ? ACCENT : muted;
  let labelColor = active ? ACCENT : muted;
  if (ind === "capsuleGlow") {
    glyphColor = active ? "rgba(255,255,255,0.92)" : muted;
    labelColor = active ? "rgba(255,255,255,0.85)" : muted;
  }
  if (ind === "activeFill") {
    glyphColor = active ? "#0a0c0b" : muted;
    labelColor = active ? "#0a0c0b" : muted;
  }

  // The element wrapping the glyph (for tile/pill/ring/capsule indicators).
  const glyphWrap = (
    <span
      className="grid place-items-center"
      style={glyphWrapStyle(ind, active)}
    >
      <Glyph kind={tab.kind} size={spec.glyph} style={{ color: glyphColor }} />
    </span>
  );

  return (
    <button
      type="button"
      className="relative flex flex-col items-center justify-center"
      style={{ height: spec.height, gap: 3 }}
    >
      {active && ind === "topBar" ? (
        <span
          className="absolute top-0 rounded-full"
          style={{ height: 2.5, width: 18, background: ACCENT }}
        />
      ) : null}
      {active && ind === "bottomBar" ? (
        <span
          className="absolute bottom-0 rounded-full"
          style={{ height: 2.5, width: 22, background: ACCENT }}
        />
      ) : null}
      {glyphWrap}
      {spec.labels ? (
        <span
          className="font-sans text-[10px] leading-none"
          style={{ color: labelColor }}
        >
          {tab.label}
        </span>
      ) : null}
      {active && ind === "underline" ? (
        <span
          className="rounded-full"
          style={{ height: 2, width: 16, marginTop: 1, background: ACCENT }}
        />
      ) : null}
      {active && ind === "dotUnder" ? (
        <span
          className="rounded-full"
          style={{ height: 4, width: 4, marginTop: 1, background: ACCENT }}
        />
      ) : null}
    </button>
  );
}

function glyphWrapStyle(ind: Indicator, active: boolean): CSSProperties {
  if (!active) {
    if (ind === "softPill" || ind === "filledTile" || ind === "ring" || ind === "capsuleGlow" || ind === "activeFill") {
      return { padding: "5px 14px" };
    }
    return {};
  }
  switch (ind) {
    case "capsuleGlow":
      return {
        padding: "5px 14px",
        borderRadius: 999,
        border: "1px solid color-mix(in oklab, var(--scout-accent) 34%, transparent)",
        background: "color-mix(in oklab, var(--scout-accent) 16%, transparent)",
        boxShadow: "0 0 10px color-mix(in oklab, var(--scout-accent) 28%, transparent)",
      };
    case "softPill":
      return {
        padding: "5px 14px",
        borderRadius: 999,
        background: "color-mix(in oklab, var(--scout-accent) 12%, transparent)",
      };
    case "filledTile":
      return {
        padding: "5px 12px",
        borderRadius: 9,
        background: "color-mix(in oklab, var(--scout-accent) 14%, transparent)",
      };
    case "ring":
      return {
        padding: 6,
        borderRadius: 999,
        border: "1.4px solid color-mix(in oklab, var(--scout-accent) 55%, transparent)",
      };
    case "activeFill":
      return {
        padding: "5px 16px",
        borderRadius: 999,
        background: ACCENT,
        boxShadow: "0 0 12px color-mix(in oklab, var(--scout-accent) 35%, transparent)",
      };
    default:
      return {};
  }
}

// ── Phone-bottom preview frame ───────────────────────────────────────────────

function PhoneBottom({
  children,
  overlay,
  base,
}: {
  children: ReactNode;
  overlay?: CSSProperties;
  base?: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[18px] border border-white/[0.08]"
      style={{ background: base ?? "#080a09" }}
    >
      {overlay ? (
        <div className="pointer-events-none absolute inset-0 z-10" style={overlay} />
      ) : null}
      {/* Faded content hint so the bar reads in context, not floating. */}
      <div className="relative h-[78px] px-4 pt-3">
        <div className="space-y-2 opacity-60">
          <div className="h-2.5 w-24 rounded bg-white/10" />
          <div className="h-8 w-full rounded-lg bg-white/[0.05]" />
          <div className="h-6 w-3/4 rounded-lg bg-white/[0.04]" />
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent"
          style={{ ["--tw-gradient-to" as string]: base ?? "#080a09" }}
        />
      </div>
      {children}
      {/* Home indicator pill. */}
      <div className="flex justify-center pb-1.5 pt-1">
        <div className="h-1 w-24 rounded-full bg-white/25" />
      </div>
    </div>
  );
}

function VariantCard({
  name,
  note,
  overlay,
  base,
  children,
}: {
  name: string;
  note: string;
  overlay?: CSSProperties;
  base?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-[13px] font-medium text-studio-ink">
          {name}
        </span>
        <span className="font-mono text-[10px] text-studio-ink-faint">{note}</span>
      </div>
      <div style={{ width: 375 }} className="max-w-full">
        <PhoneBottom overlay={overlay} base={base}>
          {children}
        </PhoneBottom>
      </div>
    </div>
  );
}

// ── Variant catalogs ─────────────────────────────────────────────────────────

const STD = { height: 54, glyph: 18, labels: true } as const;

const ACTIVE_TREATMENTS: Array<{ name: string; note: string; spec: NavSpec }> = [
  { name: "Capsule + glow", note: "current", spec: { ...STD, indicator: "capsuleGlow" } },
  { name: "Top indicator", note: "picked", spec: { ...STD, indicator: "topBar" } },
  { name: "Bottom indicator", note: "rail-style", spec: { ...STD, indicator: "bottomBar" } },
  { name: "Underline", note: "under label", spec: { ...STD, indicator: "underline" } },
  { name: "Dot", note: "under label", spec: { ...STD, indicator: "dotUnder" } },
  { name: "Soft pill", note: "no border/glow", spec: { ...STD, indicator: "softPill" } },
  { name: "Filled tile", note: "rounded square", spec: { ...STD, indicator: "filledTile" } },
  { name: "Ring", note: "outline", spec: { ...STD, indicator: "ring" } },
  { name: "Color only", note: "glyph + label tint", spec: { ...STD, indicator: "colorOnly" } },
  { name: "Solid fill", note: "inverted active", spec: { ...STD, indicator: "activeFill" } },
];

const HEIGHTS: Array<{ name: string; note: string; spec: NavSpec }> = [
  { name: "Compact", note: "h 44 · glyph 16", spec: { indicator: "topBar", height: 44, glyph: 16, labels: true } },
  { name: "Snug", note: "h 50 · glyph 17", spec: { indicator: "topBar", height: 50, glyph: 17, labels: true } },
  { name: "Standard", note: "h 54 · glyph 18", spec: { indicator: "topBar", height: 54, glyph: 18, labels: true } },
  { name: "Tall", note: "h 64 · glyph 20", spec: { indicator: "topBar", height: 64, glyph: 20, labels: true } },
  { name: "No labels", note: "h 46 · glyph 20", spec: { indicator: "topBar", height: 46, glyph: 20, labels: false } },
  { name: "Big glyph, no label", note: "h 50 · glyph 22", spec: { indicator: "softPill", height: 50, glyph: 22, labels: false } },
];

const BARS: Array<{ name: string; note: string; spec: NavSpec }> = [
  { name: "Flat", note: "hairline + dim fill", spec: { ...STD, indicator: "topBar", bar: "flat" } },
  { name: "Frosted", note: "blur + lift", spec: { ...STD, indicator: "topBar", bar: "frosted" } },
  { name: "Floating glass", note: "inset rounded pill", spec: { height: 50, glyph: 18, labels: true, indicator: "softPill", bar: "floating" } },
];

// ── Texture + color overlays (pure CSS, no image assets) ─────────────────────

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const TEX = {
  glowBottom: {
    background:
      "radial-gradient(150% 95% at 50% 100%, color-mix(in oklab, var(--scout-accent) 13%, transparent), transparent 60%)",
  },
  glowTop: {
    background:
      "radial-gradient(135% 80% at 50% 0%, color-mix(in oklab, var(--scout-accent) 14%, transparent), transparent 60%)",
  },
  grain: {
    backgroundImage: NOISE,
    backgroundSize: "120px 120px",
    opacity: 0.09,
    mixBlendMode: "overlay",
  },
  scanlines: {
    backgroundImage:
      "repeating-linear-gradient(to bottom, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px)",
  },
  dots: {
    backgroundImage:
      "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1.3px)",
    backgroundSize: "13px 13px",
  },
  sheen: {
    background: "linear-gradient(to bottom, rgba(255,255,255,0.05), transparent 38%)",
  },
  wash: {
    background:
      "linear-gradient(155deg, color-mix(in oklab, var(--scout-accent) 16%, transparent), transparent 52%)",
  },
} as Record<string, CSSProperties>;

const NAV_TEXTURE: Array<{
  name: string;
  note: string;
  spec: NavSpec;
  overlay?: CSSProperties;
  base?: string;
}> = [
  { name: "Accent up-glow", note: "light bleeds from bar", spec: { ...STD, indicator: "topBar" }, overlay: TEX.glowBottom },
  { name: "Accent top edge", note: "hairline goes green", spec: { ...STD, indicator: "topBar", topAccentLine: true } },
  { name: "Tinted bar", note: "faint accent fill", spec: { ...STD, indicator: "softPill", tintBar: true } },
  { name: "Film grain", note: "noise overlay", spec: { ...STD, indicator: "topBar" }, overlay: TEX.grain },
  { name: "Scanlines", note: "CRT hairlines", spec: { ...STD, indicator: "topBar" }, overlay: TEX.scanlines },
  { name: "Dot grid", note: "engineered texture", spec: { ...STD, indicator: "topBar" }, overlay: TEX.dots },
  { name: "Top sheen", note: "glassy highlight", spec: { ...STD, indicator: "topBar", bar: "frosted" }, overlay: TEX.sheen },
  { name: "Cool base", note: "blue-black canvas", spec: { ...STD, indicator: "topBar" }, base: "#070a0d" },
];

// ── Top-area chrome (status bar + wordmark + machines + search) ───────────────

interface TopSpec {
  overlay?: CSSProperties; // subtle ambient only — no texture
  base?: string;
  hero?: boolean; // larger, quieter wordmark
  airy?: boolean; // extra breathing room
  rule?: boolean; // refined neutral hairline under the header
  inset?: boolean; // machines + search grouped in a recessed panel
}

function PhoneTop({ spec }: { spec: TopSpec }) {
  const machines = (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
        Machines
      </span>
      <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 font-sans text-[12.5px] font-medium text-white/82">
        <span
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: ACCENT, boxShadow: "0 0 8px color-mix(in oklab, var(--scout-accent) 70%, transparent)" }}
        />
        arachs mac mini
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.035] px-2.5 py-1 font-sans text-[12.5px] font-medium text-white/55">
        <MiniPlus />
        Add
      </span>
    </div>
  );
  const search = (
    <div className="flex h-[40px] items-center gap-2.5 rounded-[9px] border border-white/[0.06] bg-black/40 px-3.5">
      <span className="text-white/35">
        <MiniSearch />
      </span>
      <span className="font-sans text-[14px] text-white/30">Search the fleet</span>
    </div>
  );
  return (
    <div
      data-testid="phone-top"
      className="relative overflow-hidden rounded-[18px] border border-white/[0.08]"
      style={{ background: spec.base ?? "#060707" }}
    >
      {spec.overlay ? (
        <div className="pointer-events-none absolute inset-0 z-10" style={spec.overlay} />
      ) : null}
      <div className={`relative px-5 pb-4 ${spec.airy ? "pt-3" : "pt-2"}`}>
        {/* status bar */}
        <div className="flex h-7 items-center justify-between">
          <span className="font-sans text-[13px] font-semibold text-white">9:22</span>
          <span className="inline-flex items-end gap-[2px]">
            {[5, 8, 11, 14].map((h) => (
              <span key={h} className="w-[3px] rounded-[1px] bg-white/90" style={{ height: h }} />
            ))}
          </span>
        </div>
        {/* wordmark + gear */}
        <div className={`${spec.airy ? "mt-3" : "mt-2"} flex items-center justify-between`}>
          <div className="flex items-baseline gap-2">
            <span
              className="font-sans font-semibold tracking-tight text-white/92"
              style={{ fontSize: spec.hero ? 34 : 26 }}
            >
              Scout
            </span>
            <span
              className="font-mono font-bold uppercase tracking-[0.24em]"
              style={{ color: ACCENT, fontSize: 11, opacity: spec.hero ? 0.75 : 1 }}
            >
              Next
            </span>
          </div>
          <span className="grid h-8 w-8 place-items-center rounded-full border border-white/[0.07] bg-white/[0.04] text-white/55">
            <MiniGear />
          </span>
        </div>
        {spec.rule ? (
          <div className={`${spec.airy ? "mt-4" : "mt-3"} h-px w-full bg-white/[0.07]`} />
        ) : null}
        {spec.inset ? (
          <div
            className={`${spec.airy ? "mt-5" : "mt-4"} flex flex-col gap-2.5 rounded-[12px] border border-white/[0.04] p-2.5`}
            style={{ background: "rgba(0,0,0,0.25)", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.45)" }}
          >
            {machines}
            {search}
          </div>
        ) : (
          <>
            <div className={spec.airy ? "mt-5" : "mt-4"}>{machines}</div>
            <div className={spec.airy ? "mt-4" : "mt-3"}>{search}</div>
          </>
        )}
      </div>
    </div>
  );
}

const TOP_VARIANTS: Array<{ name: string; note: string; spec: TopSpec }> = [
  { name: "Flat", note: "baseline", spec: {} },
  { name: "Whisper", note: "ambient top light", spec: { overlay: { background: "linear-gradient(to bottom, rgba(255,255,255,0.035), transparent 56%)" } } },
  { name: "Editorial rule", note: "hairline + air", spec: { rule: true, airy: true } },
  { name: "Inset toolbar", note: "recessed controls", spec: { inset: true } },
  { name: "Quiet hero", note: "big calm wordmark", spec: { hero: true, airy: true } },
];

function MiniGear() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v3M12 18.2v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.8 12h3M18.2 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function MiniSearch() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15.2 15.2 4 4" />
    </svg>
  );
}

function MiniPlus() {
  return (
    <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" className="text-white/45">
      <path d="M12 5.5V18.5" />
      <path d="M5.5 12H18.5" />
    </svg>
  );
}

function MiniFolder() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/45">
      <path d="M3 8.5 3 6.5 8.5 6.5 10.5 8.5" />
      <path d="M3 8.5h15.8a2.2 2.2 0 0 1 2.2 2.2v6.1a2.2 2.2 0 0 1-2.2 2.2H5.2a2.2 2.2 0 0 1-2.2-2.2Z" />
    </svg>
  );
}

function MiniChevron({ arrow }: { arrow?: boolean }) {
  return arrow ? (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/25">
      <path d="M4.5 12 18.5 12" />
      <path d="M13 6.5 18.5 12 13 17.5" />
    </svg>
  ) : (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/30">
      <path d="M9.5 6 15.5 12 9.5 18" />
    </svg>
  );
}

// ── Full-phone vibe compositions ─────────────────────────────────────────────

interface Vibe {
  name: string;
  tagline: string;
  base: string;
  surface: string;
  border: string;
  overlay?: CSSProperties; // texture across the whole phone
  topOverlay?: CSSProperties; // localized treatment in the header zone
  hairline?: boolean; // accent rule under the header
  editorial?: boolean; // neutral rule under the header + extra air
  nav: NavSpec;
  all: "text" | "chip" | "bracket";
  card: "current" | "wash" | "ticks";
}

const VIBE_ROWS: Array<{ name: string; seg: string; age: string; live?: boolean; solo?: boolean }> = [
  { name: "talkie", seg: "4 agents", age: "4h" },
  { name: "openscout", seg: "9 agents", age: "now", live: true },
  { name: "Dewey", seg: "claude", age: "1d", solo: true },
  { name: "Studio", seg: "claude", age: "2d", solo: true },
];

function VibeRow({ row }: { row: (typeof VIBE_ROWS)[number] }) {
  return (
    <div className="flex items-center gap-2 px-3 py-[7px]">
      <MiniFolder />
      <span className="truncate font-sans text-[13px] font-semibold text-white/92">{row.name}</span>
      <span className="font-mono text-[10px] text-white/22">/</span>
      <span className="flex items-center gap-1">
        <Glyph kind="agent" size={11} style={{ color: "rgba(255,255,255,0.35)" }} />
        <span className="font-sans text-[12px] font-medium text-white/60">{row.seg}</span>
      </span>
      {row.live ? (
        <span className="h-[6px] w-[6px] rounded-full" style={{ background: ACCENT, boxShadow: "0 0 7px color-mix(in oklab, var(--scout-accent) 70%, transparent)" }} />
      ) : null}
      <span
        className="ml-auto font-mono text-[10px] tabular-nums"
        style={{ color: row.live ? ACCENT : "rgba(255,255,255,0.45)" }}
      >
        {row.age}
      </span>
      <MiniChevron arrow={row.solo} />
    </div>
  );
}

function AllBit({ kind }: { kind: Vibe["all"] }) {
  if (kind === "chip") {
    return (
      <span
        className="ml-auto rounded-full px-1.5 py-[1px] font-mono text-[8px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: ACCENT, background: "color-mix(in oklab, var(--scout-accent) 12%, transparent)" }}
      >
        All
      </span>
    );
  }
  if (kind === "bracket") {
    return (
      <span className="ml-auto font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-white/45">
        [ <span style={{ color: ACCENT }}>All</span> ]
      </span>
    );
  }
  return (
    <span className="ml-auto font-mono text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
      All
    </span>
  );
}

function VibePhone({ vibe }: { vibe: Vibe }) {
  return (
    <div
      data-testid="vibe-phone"
      className="relative flex flex-col overflow-hidden rounded-[26px] border border-white/[0.12] shadow-[0_30px_70px_-30px_rgba(0,0,0,0.85)]"
      style={{ width: 360, height: 716, background: vibe.base }}
    >
      {vibe.overlay ? (
        <div className="pointer-events-none absolute inset-0 z-30" style={vibe.overlay} />
      ) : null}

      {/* status bar */}
      <div className="relative flex h-9 items-center justify-between px-6 pt-1">
        <span className="font-sans text-[13px] font-semibold text-white">9:22</span>
        <span className="inline-flex items-end gap-[2px]">
          {[5, 8, 11, 14].map((h) => (
            <span key={h} className="w-[3px] rounded-[1px] bg-white/90" style={{ height: h }} />
          ))}
        </span>
      </div>

      {/* header zone */}
      <div className="relative px-4">
        {vibe.topOverlay ? (
          <div className="pointer-events-none absolute inset-0" style={vibe.topOverlay} />
        ) : null}
        <div className="relative flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-sans text-[24px] font-semibold tracking-tight text-white/92">Scout</span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: ACCENT }}>
              Next
            </span>
          </div>
          <span className="grid h-8 w-8 place-items-center rounded-full border border-white/[0.07] bg-white/[0.04] text-white/55">
            <MiniGear />
          </span>
        </div>
        {vibe.editorial ? (
          <div className="relative mt-3 h-px w-full bg-white/[0.07]" />
        ) : vibe.hairline ? (
          <div className="relative mt-2.5 h-px w-full" style={{ background: "color-mix(in oklab, var(--scout-accent) 38%, transparent)" }} />
        ) : null}
        <div className={`relative ${vibe.editorial ? "mt-4" : "mt-3"} flex items-center gap-2`}>
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-white/45">Machines</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.04] px-2 py-[3px] font-sans text-[11.5px] font-medium text-white/82">
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: ACCENT }} />
            arachs mac mini
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.035] px-2 py-[3px] font-sans text-[11.5px] font-medium text-white/55">
            <MiniPlus />
            Add
          </span>
        </div>
        <div className={`relative ${vibe.editorial ? "mt-3" : "mt-2.5"} flex h-[36px] items-center gap-2 rounded-[9px] border border-white/[0.07] bg-black/50 px-3`}>
          <span className="text-white/35">
            <MiniSearch />
          </span>
          <span className="font-sans text-[13px] text-white/30">Search the fleet</span>
        </div>
      </div>

      {/* content */}
      <div className="relative mt-3 flex-1 overflow-hidden px-3">
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <span className="h-[6px] w-[6px] rounded-full" style={{ background: ACCENT, boxShadow: "0 0 7px color-mix(in oklab, var(--scout-accent) 70%, transparent)" }} />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-white/55">Currently working</span>
          <span className="font-mono text-[9px] text-white/35">1</span>
        </div>
        <div className="px-1">
          <WorkingCard treatment={vibe.card} />
        </div>
        <div className="mb-2 mt-4 flex items-baseline gap-2 px-1">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-white/55">Projects</span>
          <span className="font-mono text-[9px] text-white/35">5</span>
          <AllBit kind={vibe.all} />
        </div>
        <div className="overflow-hidden rounded-[10px]" style={{ border: `1px solid ${vibe.border}`, background: vibe.surface }}>
          {VIBE_ROWS.map((r, i) => (
            <div key={r.name}>
              {i > 0 ? <div className="h-px" style={{ background: "rgba(255,255,255,0.05)", marginLeft: 28 }} /> : null}
              <VibeRow row={r} />
            </div>
          ))}
        </div>
      </div>

      {/* nav */}
      <div className="relative">
        <NavBar spec={vibe.nav} />
        <div className="flex justify-center pb-1.5 pt-1" style={{ background: vibe.nav.bar === "floating" ? "transparent" : undefined }}>
          <div className="h-1 w-24 rounded-full bg-white/25" />
        </div>
      </div>
    </div>
  );
}

const VIBES: Vibe[] = [
  {
    name: "Clean · elegant",
    tagline: "dark · snug · frosted-raised",
    base: "#060707",
    surface: "rgba(255,255,255,0.022)",
    border: "rgba(255,255,255,0.09)",
    editorial: true,
    nav: { height: 48, glyph: 17, labels: true, indicator: "colorOnly", bar: "raised" },
    all: "text",
    card: "ticks",
  },
  {
    name: "Cockpit",
    tagline: "engineered · instrument panel",
    base: "#06080a",
    surface: "rgba(255,255,255,0.02)",
    border: "rgba(255,255,255,0.10)",
    // Visible instrument-panel dot grid + a faint radar glow up top.
    overlay: {
      backgroundImage:
        "radial-gradient(rgba(150,220,120,0.10) 1px, transparent 1.4px), radial-gradient(150% 70% at 50% 0%, color-mix(in oklab, var(--scout-accent) 9%, transparent), transparent 55%)",
      backgroundSize: "12px 12px, 100% 100%",
    },
    hairline: true,
    nav: { ...STD, indicator: "topBar", topAccentLine: true },
    all: "bracket",
    card: "ticks",
  },
  {
    name: "Aurora",
    tagline: "matte · lit · premium",
    base: "#0b0a08",
    surface: "rgba(255,255,255,0.03)",
    border: "color-mix(in oklab, var(--scout-accent) 14%, rgba(255,255,255,0.08))",
    overlay: TEX.grain,
    // Commit to "lit": a strong warm halo washing the top third.
    topOverlay: {
      background:
        "radial-gradient(120% 130% at 50% -18%, color-mix(in oklab, var(--scout-accent) 24%, transparent), transparent 64%)",
    },
    nav: { ...STD, indicator: "softPill", tintBar: true },
    all: "text",
    card: "wash",
  },
  {
    name: "Glass",
    tagline: "frosted · modern iOS",
    base: "#070a0d",
    surface: "rgba(255,255,255,0.05)",
    border: "rgba(255,255,255,0.10)",
    topOverlay: TEX.sheen,
    nav: { height: 50, glyph: 18, labels: true, indicator: "softPill", bar: "floating" },
    all: "chip",
    card: "current",
  },
];

// ── Home polish experiments ──────────────────────────────────────────────────

function WorkingCard({
  treatment,
}: {
  treatment: "current" | "wash" | "ticks";
}) {
  const base =
    "relative flex w-[220px] flex-col gap-1.5 overflow-hidden rounded-[11px] px-3 py-2.5";
  const styles: Record<string, CSSProperties> = {
    current: {
      border: "1px solid color-mix(in oklab, var(--scout-accent) 30%, transparent)",
      background: "color-mix(in oklab, var(--scout-accent) 7%, rgba(255,255,255,0.02))",
    },
    wash: {
      border: "1px solid color-mix(in oklab, var(--scout-accent) 26%, transparent)",
      backgroundImage:
        "linear-gradient(135deg, color-mix(in oklab, var(--scout-accent) 16%, transparent), rgba(255,255,255,0.015))",
    },
    ticks: {
      border: "1px solid color-mix(in oklab, var(--scout-accent) 36%, transparent)",
      background: "rgba(255,255,255,0.02)",
      boxShadow: "0 0 18px -6px color-mix(in oklab, var(--scout-accent) 40%, transparent)",
    },
  };
  return (
    <div className={base} style={styles[treatment]}>
      {treatment === "ticks" ? (
        <>
          <Corner pos="tl" />
          <Corner pos="tr" />
        </>
      ) : null}
      <div className="flex items-center gap-1.5">
        <span
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: ACCENT, boxShadow: "0 0 8px color-mix(in oklab, var(--scout-accent) 70%, transparent)" }}
        />
        <span className="truncate font-sans text-[12.5px] font-semibold text-white/92">
          Home layout
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="truncate font-mono text-[11px] text-white/55">
          editing HomeSurface.swift
        </span>
        <span
          className="inline-block h-[12px] w-[2px] translate-y-[1px]"
          style={{ background: ACCENT }}
        />
      </div>
      <div className="truncate font-mono text-[9.5px] text-white/40">
        openscout · +3 · ⎇ mini-home
      </div>
    </div>
  );
}

function Corner({ pos }: { pos: "tl" | "tr" }) {
  const common = "absolute h-2 w-2 border-[var(--scout-accent)]";
  const map: Record<string, string> = {
    tl: "left-1.5 top-1.5 border-l border-t",
    tr: "right-1.5 top-1.5 border-r border-t",
  };
  return <span className={[common, map[pos]].join(" ")} style={{ opacity: 0.6 }} />;
}

function AllTreatment({ kind }: { kind: "text" | "chip" | "bracket" }) {
  return (
    <div className="flex items-baseline gap-2 rounded-lg bg-[#080a09] px-3 py-2">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
        Activity
      </span>
      <span className="font-mono text-[10px] font-semibold text-white/35">4</span>
      <span className="ml-auto">
        {kind === "text" ? (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
            All
          </span>
        ) : kind === "chip" ? (
          <span
            className="rounded-full px-2 py-[2px] font-mono text-[9px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: ACCENT, background: "color-mix(in oklab, var(--scout-accent) 12%, transparent)" }}
          >
            All
          </span>
        ) : (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
            [ <span style={{ color: ACCENT }}>All</span> ]
          </span>
        )}
      </span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ScoutNextNavLab() {
  return (
    <main className="px-6 py-6">
      <header className="mb-6 max-w-[76ch] border-b border-studio-edge pb-5">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          ios study - ScoutNext Nav Lab
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Bottom-nav treatments + polish
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Breadth-first gallery at true iPhone width (375pt): active-state styles,
          bar heights/density, and bar materials — plus a few Home polish ideas.
          Pick winners; they port to RootView.swift + HomeSurface.swift.
        </p>
      </header>

      <Section
        title="Vibes — full compositions"
        blurb="The treatments assembled into complete looks: base color, texture, top area, working card, and nav working together. Same content, four different feels."
      >
        {VIBES.map((v) => (
          <div key={v.name} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-sans text-[14px] font-semibold text-studio-ink">{v.name}</span>
              <span className="font-mono text-[10px] text-studio-ink-faint">{v.tagline}</span>
            </div>
            <VibePhone vibe={v} />
          </div>
        ))}
      </Section>

      <Section
        title="Active-state treatments"
        blurb="Same bar (h 54, glyph 18, labels on) — only how the selected tab (Home) is marked changes."
      >
        {ACTIVE_TREATMENTS.map((v) => (
          <VariantCard key={v.name} name={v.name} note={v.note}>
            <NavBar spec={v.spec} />
          </VariantCard>
        ))}
      </Section>

      <Section
        title="Bar height + density"
        blurb="Top-indicator treatment held constant; button height, glyph size, and labels vary."
      >
        {HEIGHTS.map((v) => (
          <VariantCard key={v.name} name={v.name} note={v.note}>
            <NavBar spec={v.spec} />
          </VariantCard>
        ))}
      </Section>

      <Section
        title="Bar material"
        blurb="The surface the bar sits on — flat hairline, frosted blur, or a floating inset pill."
      >
        {BARS.map((v) => (
          <VariantCard key={v.name} name={v.name} note={v.note}>
            <NavBar spec={v.spec} />
          </VariantCard>
        ))}
      </Section>

      <Section
        title="Nav — texture + color"
        blurb="Same top-indicator bar, dressed with grain, glow, tint, and surface texture to add depth without clutter."
      >
        {NAV_TEXTURE.map((v) => (
          <VariantCard key={v.name} name={v.name} note={v.note} overlay={v.overlay} base={v.base}>
            <NavBar spec={v.spec} />
          </VariantCard>
        ))}
      </Section>

      <Section
        title="Top area — elegant"
        blurb="Restrained header treatments: subtle ambient depth, refined type + spacing, hairlines, a recessed toolbar. No texture — elegance through restraint."
      >
        {TOP_VARIANTS.map((v) => (
          <div key={v.name} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-sans text-[13px] font-medium text-studio-ink">{v.name}</span>
              <span className="font-mono text-[10px] text-studio-ink-faint">{v.note}</span>
            </div>
            <div style={{ width: 375 }} className="max-w-full">
              <PhoneTop spec={v.spec} />
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Home polish — working card"
        blurb="Treatments for the live 'Currently working' card."
      >
        <PolishCell name="Current" note="accent wash + border">
          <WorkingCard treatment="current" />
        </PolishCell>
        <PolishCell name="Diagonal wash" note="gradient fill">
          <WorkingCard treatment="wash" />
        </PolishCell>
        <PolishCell name="Glow + corner ticks" note="cockpit framing · liked">
          <WorkingCard treatment="ticks" />
        </PolishCell>
      </Section>

      <Section
        title="Home polish — section 'All'"
        blurb="How the header's All affordance reads."
      >
        <PolishCell name="Accent text" note="picked">
          <div style={{ width: 300 }}>
            <AllTreatment kind="text" />
          </div>
        </PolishCell>
        <PolishCell name="Tinted chip" note="pill">
          <div style={{ width: 300 }}>
            <AllTreatment kind="chip" />
          </div>
        </PolishCell>
        <PolishCell name="Bracketed" note="terminal flavor">
          <div style={{ width: 300 }}>
            <AllTreatment kind="bracket" />
          </div>
        </PolishCell>
      </Section>
    </main>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="font-display text-[18px] font-medium tracking-tight text-studio-ink">
          {title}
        </h2>
        <p className="mt-1 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          {blurb}
        </p>
      </div>
      <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
        {children}
      </div>
    </section>
  );
}

function PolishCell({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-[13px] font-medium text-studio-ink">{name}</span>
        <span className="font-mono text-[10px] text-studio-ink-faint">{note}</span>
      </div>
      <div className="flex min-h-[110px] items-center justify-center rounded-[14px] border border-white/[0.07] bg-[#080a09] p-4">
        {children}
      </div>
    </div>
  );
}
