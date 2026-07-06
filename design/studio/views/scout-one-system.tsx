"use client";

import { Fragment, useState } from "react";
import { ScoutStudyShell, type ScoutSkinId } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import { PhoneShell, ScoutIOSStyles, Glyph, FLEET, type Agent } from "@/components/scout-ios";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/**
 * Scout — One System.
 *
 * Scout ships four visual dialects today — main-window indigo (themable, 5×5),
 * the HUD lime broadsheet (a deliberate costume), the menu-bar green, and iOS
 * emerald (dark-locked). Each dialect is internally coherent; together they read
 * as four apps. The One System proposal keeps each platform's *depth idiom*
 * (flat ruled panels on desktop, raised cards on phone, the broadsheet HUD) and
 * unifies the *grammar*: identity (sprites), status vocabulary, icon language,
 * and — the headline — theme inheritance, where a paired phone adopts the Mac's
 * theme.
 *
 * Four blocks:
 *   A  Four dialects — the honest diagnostic strip.
 *   B  macOS pane — Current ⇄ One System. macOS donates the system, so the
 *      deltas are small: eyebrow grammar, hand-drawn domain glyphs, contrast.
 *   C  iOS pane — the headline demo. Sprites on rows, theme-follows-pairing,
 *      shared vocabulary. Keeps the phone's raised-card depth idiom.
 *   D  Ledger — every proposal, its disposition, native touch points, honors.
 */

type Treatment = "current" | "one-system";
type Paired = "none" | "juniper-d" | "graphite" | "nocturne-indigo";

/* ── shared segmented control (studio tokens, adapts to studio light/dark) ── */
function Toggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-[9px] p-1"
      style={{ background: "color-mix(in oklab, var(--studio-surface) 60%, transparent)", border: "1px solid var(--studio-edge)" }}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="rounded-[6px] px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors"
            style={
              on
                ? { color: "var(--scout-accent)", background: "var(--studio-surface)", border: "1px solid var(--studio-edge-strong)" }
                : { color: "var(--studio-ink-muted)", border: "1px solid transparent" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Block A — Four dialects diagnostic strip.
   ════════════════════════════════════════════════════════════════════ */

const DIALECTS: {
  name: string;
  accent: string;
  hex: string;
  theming: string;
  depth: string;
  type: string;
}[] = [
  {
    name: "Main window",
    accent: "#493AC4",
    hex: "Indigo · default",
    theming: "5 presets × 5 accents, user-swappable (Paper/Mist/Porcelain/Graphite/Nocturne)",
    depth: "flat ruled panels + hairlines",
    type: "system faces",
  },
  {
    name: "HUD",
    accent: "#94E36B",
    hex: "Lime · hardcoded",
    theming: "hardcoded HUDChrome — no presets",
    depth: "warm near-black broadsheet + paper grain",
    type: "Inter + JetBrains Mono",
  },
  {
    name: "Menu bar",
    accent: "#6DDB8C",
    hex: "Green · ShellPalette",
    theming: "own ShellPalette, standalone",
    depth: "grid-backdrop popover",
    type: "mono masthead",
  },
  {
    name: "iOS",
    accent: "#10B981",
    hex: "Emerald · HudPalette",
    theming: "warm/neutral/cool tones, dark-only — no presets, no light",
    depth: "raised .scoutCard + cockpit key-light",
    type: "hand-drawn 24-grid glyphs",
  },
];

function BlockA() {
  return (
    <section className="mb-14">
      <SectionEyebrow>Block A · Diagnosis — four internally-coherent dialects</SectionEyebrow>
      <h2 className="mb-1 font-display text-[19px] font-medium tracking-tight text-studio-ink">Four dialects today</h2>
      <p className="mb-5 max-w-[76ch] text-[13px] leading-relaxed text-studio-ink-muted">
        Not a criticism — each surface is coherent on its own. But identity, status, icon language, and theming
        are decided four separate times, so the fleet reads as four apps. This is the gap the One System grammar closes.
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {DIALECTS.map((d) => (
          <div key={d.name} className="overflow-hidden rounded-[10px] border border-studio-edge bg-studio-surface">
            <div className="flex items-center gap-2.5 border-b border-studio-edge px-3 py-2.5">
              <span
                className="h-6 w-6 flex-none rounded-[7px]"
                style={{ background: d.accent, boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--studio-ink) 18%, transparent)" }}
              />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-studio-ink">{d.name}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-studio-ink-faint">{d.accent}</div>
              </div>
            </div>
            <dl className="px-3 py-2.5">
              <DialectRow k="Accent" v={d.hex} />
              <DialectRow k="Theming" v={d.theming} />
              <DialectRow k="Depth" v={d.depth} />
              <DialectRow k="Type" v={d.type} />
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function DialectRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-t border-studio-edge/70 py-1.5 first:border-t-0 first:pt-0">
      <dt className="font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-studio-ink-faint">{k}</dt>
      <dd className="mt-0.5 text-[11px] leading-snug text-studio-ink-muted">{v}</dd>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Block B — macOS pane (Current ⇄ One System).
   macOS donates the system; the deltas are deliberately small.
     ① eyebrow / status vocabulary → shared mono micro-caps, leading "·"
     ② domain glyphs → hand-drawn 24-grid stroke (comms/agents/tail only)
     ③ secondary-text contrast → lifted to the shared AA baseline
   ════════════════════════════════════════════════════════════════════ */

/** A quiet numbered marker for a visible delta (geometric, not emoji). */
function DeltaMark({ n }: { n: number }) {
  return <span className="os1-mark">{n}</span>;
}

const NAV: { label: string; glyph: "comms" | "agents" | "pulse" | "gear" | null; on?: boolean }[] = [
  { label: "Comms", glyph: "comms", on: true },
  { label: "Agents", glyph: "agents" },
  { label: "Terminals", glyph: null },
  { label: "Tail", glyph: "pulse" },
  { label: "Dispatch", glyph: null },
  { label: "Lanes", glyph: null },
  { label: "Repos", glyph: null },
];

type MacConvo = {
  name: string;
  channel?: boolean;
  preview: string;
  age: string;
  unread?: number;
  sel?: boolean;
};

const MAC_CONVOS: MacConvo[] = [
  { name: "Talkie", preview: "Render before send — moved resolveStartupTheme() ahead of the composer mount; no skin flash on cold open.", age: "2m", unread: 6, sel: true },
  { name: "broker-smith", preview: "Can you confirm the in-app session route lands on the operator DM?", age: "8m", unread: 2 },
  { name: "openscout", channel: true, preview: "feat/repo-watch — themeVars bridge landed; the embed adopts the app palette.", age: "1h" },
  { name: "Hudson", preview: "Reviewed. Overlay settings polished — moved the no-fly list inline.", age: "2h" },
];

function MacRailIcon({ glyph, active }: { glyph: "comms" | "agents" | "pulse" | "gear" | null; active: boolean }) {
  // One System swaps the domain-object placeholders for hand-drawn glyphs on
  // comms / agents / tail only. Everything else keeps the generic placeholder;
  // Settings keeps its conventional gear.
  if (active && glyph && glyph !== "gear") {
    return <Glyph kind={glyph} size={15} />;
  }
  if (glyph === "gear") return <Glyph kind="gear" size={15} />;
  return <span className="os1mac-ph" />;
}

function MacComms({ treatment }: { treatment: Treatment }) {
  const one = treatment === "one-system";
  return (
    <div
      className="os1mac"
      style={{ ["--sec" as string]: one ? "var(--s-muted)" : "var(--s-dim)" } as React.CSSProperties}
    >
      {/* Nav rail */}
      <nav className="os1mac-rail">
        <div className="os1mac-navcap">Scout</div>
        {NAV.map((n) => (
          <div key={n.label} className={`os1mac-nav ${n.on ? "on" : ""}`}>
            <span className="os1mac-navicon">
              <MacRailIcon glyph={n.glyph} active={one} />
            </span>
            <span>{n.label}</span>
            {n.label === "Agents" && one ? <DeltaMark n={2} /> : null}
          </div>
        ))}
        <span className="os1mac-navspace" />
        <div className="os1mac-nav">
          <span className="os1mac-navicon">
            <Glyph kind="gear" size={15} />
          </span>
          <span>Settings</span>
        </div>
      </nav>

      {/* Conversation list */}
      <aside className="os1mac-list">
        <div className="os1mac-listhead">
          <span className="os1mac-listtitle">Conversations</span>
          <span className="os1mac-listcount">4 · 2 unread</span>
        </div>
        {/* Recency group — the eyebrow-grammar delta ①: sentence-case → mono
            micro-caps with a leading "·". */}
        <div className="os1mac-grp" data-g={one ? "mono" : "plain"}>
          {one ? "· Now" : "Now"}
          {one ? <DeltaMark n={1} /> : null}
        </div>
        {MAC_CONVOS.map((c, i) => (
          <div key={c.name} className={`os1mac-row ${c.sel ? "sel" : ""} ${c.unread ? "un" : ""}`}>
            <span className={`os1mac-ava ${c.channel ? "ch" : ""}`}>
              {c.channel ? "#" : <SpriteAvatar name={c.name} size={32} tile />}
            </span>
            <span className="os1mac-body">
              <span className="os1mac-top">
                {c.unread ? <span className="os1mac-undot" /> : null}
                <span className="os1mac-name">{c.name}</span>
                <span className="os1mac-age">{c.age}</span>
              </span>
              <span className="os1mac-prev">
                {c.preview}
                {i === 0 && one ? <DeltaMark n={3} /> : null}
              </span>
            </span>
            {c.unread ? <span className="os1mac-num">{c.unread}</span> : null}
          </div>
        ))}
      </aside>

      {/* Thread */}
      <section className="os1mac-thread">
        <header className="os1mac-thead">
          <span className="os1mac-tava">
            <SpriteAvatar name="Talkie" size={34} tile />
          </span>
          <div className="os1mac-tident">
            <div className="os1mac-teyebrow" data-g={one ? "mono" : "plain"}>
              {one ? "· Conversation" : "Conversation"}
            </div>
            <div className="os1mac-tname">Talkie</div>
            <div className="os1mac-tfacts">~/dev/talkie · master · #ab3fd0</div>
          </div>
          <div className="os1mac-tactions">
            <button className="os1mac-ghost">Observe</button>
            <button className="os1mac-primary">Message</button>
          </div>
        </header>
        <div className="os1mac-stream">
          <MacTurn author="Talkie" agent time="2:15 PM" text="Moved resolveStartupTheme() ahead of the composer mount, and the inspector now shows the resolved skin badge. Pushed to master." />
          <MacTurn author="Art" me time="2:17 PM" text="Great — surface the active theme in the inspector too, so I can see which skin a session opened with." />
        </div>
        <div className="os1mac-composer">
          <span className="os1mac-cfield">Message Talkie…</span>
          <button className="os1mac-primary">Send</button>
        </div>
      </section>
    </div>
  );
}

function MacTurn({ author, text, time, me, agent }: { author: string; text: string; time: string; me?: boolean; agent?: boolean }) {
  return (
    <div className="os1mac-turn">
      <span className={`os1mac-tuava ${me ? "me" : ""}`}>
        {agent ? <SpriteAvatar name={author} size={26} /> : author[0]}
      </span>
      <div className="os1mac-tubody">
        <div className="os1mac-tuhead">
          <span className="os1mac-tuauthor">{author}</span>
          <span className="os1mac-tutime">{time}</span>
        </div>
        <div className="os1mac-tutext">{text}</div>
      </div>
    </div>
  );
}

const MAC_LEGEND: { n: number; text: React.ReactNode }[] = [
  { n: 1, text: <>Status / eyebrow vocabulary aligned to the shared grammar — mono micro-caps with a leading <code className="os1-code">·</code>.</> },
  { n: 2, text: <>Domain-object glyphs swap from generic placeholders to the hand-drawn 24-grid stroke style (comms / agents / tail only — Settings keeps its gear).</> },
  { n: 3, text: <>Secondary-text contrast lifted from <code className="os1-code">dim</code> to the shared AA baseline (<code className="os1-code">muted</code>).</> },
];

function BlockB({ treatment, skin }: { treatment: Treatment; skin: ScoutSkinId }) {
  const one = treatment === "one-system";
  return (
    <section className="mb-14">
      <SectionEyebrow>Block B · macOS — donates the system</SectionEyebrow>
      <h2 className="mb-1 font-display text-[19px] font-medium tracking-tight text-studio-ink">macOS · Comms</h2>
      <p className="mb-4 max-w-[76ch] text-[13px] leading-relaxed text-studio-ink-muted">
        macOS is the source of truth for the theme system, so it changes least. The One System deltas here are
        three small grammar alignments — the flat ruled-panel idiom, sprite identity, and indigo accent all stay.
        Skin follows the toggle top-right ({skin === "juniper-l" ? "Juniper Light — the live app theme" : skin === "juniper-d" ? "Juniper Dark" : "Graphite"}).
      </p>
      <ScoutWindow title="scout · comms">
        <MacComms treatment={treatment} />
      </ScoutWindow>
      {/* Legend — only the One System treatment marks deltas. */}
      <div className="mt-3 max-w-[80ch]">
        {one ? (
          <div className="grid gap-1.5">
            {MAC_LEGEND.map((l) => (
              <div key={l.n} className="flex items-start gap-2.5">
                <DeltaMark n={l.n} />
                <span className="text-[11.5px] leading-snug text-studio-ink-muted">{l.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[10.5px] text-studio-ink-faint">
            Current · the app as it ships — flat hairline list, sprite identity, generic rail placeholders, indigo accent.
          </p>
        )}
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Block C — iOS pane (Current ⇄ One System). The headline demo.
     ① sprite avatars replace plain state dots
     ② theme follows pairing (--i-* overridden by the paired Mac skin)
     ③ shared eyebrow / status vocabulary
   ════════════════════════════════════════════════════════════════════ */

const IOS_AGENTS: Agent[] = FLEET.slice(0, 6);

/** State marker for the Current treatment: live = pulsing accent dot, idle =
 *  filled muted, offline = ring. Replaced by a sprite in One System. */
function StateMark({ state }: { state: Agent["state"] }) {
  if (state === "live") return <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />;
  if (state === "offline") return <span className="iRing" />;
  return <span className="iDot" style={{ background: "var(--i-muted)" }} />;
}

function IosAgentRow({ a, one }: { a: Agent; one: boolean }) {
  const live = a.state === "live";
  const sessionLine = [a.project, a.branch].filter(Boolean).join(" · ");
  return (
    <div className="iLeafRow" style={{ background: "transparent", padding: "9px 13px", gap: 10 }}>
      {one ? (
        <span style={{ flex: "none", display: "grid", placeItems: "center" }}>
          <SpriteAvatar name={a.title} size={22} />
        </span>
      ) : (
        <span style={{ width: 22, flex: "none", display: "grid", placeItems: "center" }}>
          <StateMark state={a.state} />
        </span>
      )}
      <div className="iAgentMain">
        <span className={`iAgentName ${live ? "" : "dim"}`} style={{ fontWeight: 500 }}>{a.title}</span>
        {sessionLine && <span className="iSessionLine">{sessionLine}</span>}
      </div>
      <span className="iSpacer" />
      <span className="iAge" style={{ color: live ? "var(--i-accent)" : "var(--i-dim)" }}>{a.age}</span>
      {a.harness && <span className="iHarness">{a.harness}</span>}
    </div>
  );
}

function IosAgents({ one }: { one: boolean }) {
  const liveN = IOS_AGENTS.filter((a) => a.state === "live").length;
  return (
    <div className="iBody">
      {/* Section header — eyebrow-grammar delta ③: sentence-case header →
          shared mono micro-caps with the leading "·" + a live pulse. */}
      {one ? (
        <div className="iSec">
          <span className="iPulse" />
          <span className="iSecLabel">· Agents — {liveN} live</span>
        </div>
      ) : (
        <div className="iSec">
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--i-ink)" }}>Agents</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--i-mono)", fontSize: 10, color: "var(--i-dim)" }}>{liveN} live</span>
        </div>
      )}
      <div className="iCard">
        {IOS_AGENTS.map((a, i) => (
          <Fragment key={a.id}>
            {i > 0 && <div className="iRowSep" />}
            <IosAgentRow a={a} one={one} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const PAIRED_OPTS: { id: Paired; label: string }[] = [
  { id: "none", label: "Emerald" },
  { id: "juniper-d", label: "Juniper Dark" },
  { id: "graphite", label: "Graphite" },
  { id: "nocturne-indigo", label: "Nocturne · Indigo" },
];

const PAIRED_NOTE: Record<Paired, string> = {
  none: "Shipped — the native HudPalette emerald, dark-locked. No pairing override.",
  "juniper-d": "Inheriting the Mac's Juniper Dark preset — neutral charcoal, royal-blue accent (#5585e6).",
  graphite: "Inheriting Graphite — hueless dark, higher contrast, indigo accent (#6d7ae8).",
  "nocturne-indigo": "Inheriting Nocturne · Indigo — deep indigo-tinted dark; accent derived from the main-window default #493AC4, lifted for dark legibility.",
};

function BlockC({ treatment }: { treatment: Treatment }) {
  const one = treatment === "one-system";
  const [paired, setPaired] = useState<Paired>("juniper-d");
  const activePaired: Paired = one ? paired : "none";

  return (
    <section className="mb-14">
      <SectionEyebrow>Block C · iOS — inherits the theme · the headline demo</SectionEyebrow>
      <h2 className="mb-1 font-display text-[19px] font-medium tracking-tight text-studio-ink">iOS · Agents</h2>
      <p className="mb-5 max-w-[76ch] text-[13px] leading-relaxed text-studio-ink-muted">
        The phone keeps its raised-card depth idiom — top-lit edges, insets, cockpit key-light — it is never flattened to
        the desktop language. What changes is the grammar: sprite identity, a paired-theme control, and the shared
        eyebrow / status vocabulary.
      </p>
      <div className="grid items-start gap-10" style={{ gridTemplateColumns: "418px 1fr" }}>
        <div data-paired={activePaired}>
          <PhoneShell surface="agents" variant="shipped">
            <IosAgents one={one} />
          </PhoneShell>
        </div>

        <div>
          {one ? (
            <>
              <div className="mb-2 flex items-center gap-2.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-studio-ink-faint">Paired Mac theme</span>
                <Toggle value={paired} onChange={setPaired} options={PAIRED_OPTS} />
              </div>
              <p className="mb-4 max-w-[42ch] text-[12.5px] leading-relaxed text-studio-ink-muted">{PAIRED_NOTE[activePaired]}</p>
              <ul className="grid max-w-[42ch] list-none gap-2 p-0">
                <IosDelta n={1}>Sprite avatars replace the plain state dots — the same name → same creature across macOS, iOS, and web.</IosDelta>
                <IosDelta n={2}>Theme follows pairing — the phone overrides its <code className="os1-code">--i-*</code> accent + surface tokens with the paired Mac skin. Phone stays dark; light presets are omitted.</IosDelta>
                <IosDelta n={3}>Shared eyebrow / status vocabulary — mono micro-caps section header with a leading <code className="os1-code">·</code> and a live pulse.</IosDelta>
              </ul>
              <p className="mt-5 max-w-[42ch] text-[12.5px] font-medium leading-relaxed text-studio-ink">
                Pair your phone, and it inherits your Mac's theme.
              </p>
            </>
          ) : (
            <>
              <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-studio-ink-faint">Current · shipped</div>
              <p className="max-w-[42ch] text-[12.5px] leading-relaxed text-studio-ink-muted">
                The dark-locked emerald build. Agent rows carry plain state dots — a pulsing accent dot for live, a filled
                muted dot for idle, a hollow ring for offline — and no per-agent identity mark. The theme cannot follow a
                paired Mac. Flip to <span className="text-studio-ink">One System</span> to see sprites, theme inheritance,
                and the shared vocabulary.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function IosDelta({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <DeltaMark n={n} />
      <span className="text-[11.5px] leading-snug text-studio-ink-muted">{children}</span>
    </li>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Block D — Ledger. Every proposal, its disposition + native touch points.
   ════════════════════════════════════════════════════════════════════ */

type Disposition = "ship" | "refine" | "defer";
const DISPO: Record<Disposition, { label: string; bg: string; fg: string }> = {
  ship: { label: "Ship", bg: "var(--status-ok-bg)", fg: "var(--status-ok-fg)" },
  refine: { label: "Refine", bg: "var(--status-info-bg)", fg: "var(--status-info-fg)" },
  defer: { label: "Defer", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)" },
};

const LEDGER: { proposal: string; dispo: Disposition; touch: React.ReactNode; honors: string }[] = [
  {
    proposal: "Theme follows pairing (iOS inherits Mac preset + accent)",
    dispo: "ship",
    touch: <><code className="os1-code">apps/ios/Scout/Theme.swift</code> — ScoutTone → ScoutThemeColors mapping; pairing payload carries theme.</>,
    honors: "macOS theming is source of truth",
  },
  {
    proposal: "Sprites on iOS agent rows",
    dispo: "ship",
    touch: <>Port <code className="os1-code">AgentSprite</code> hash to iOS — <code className="os1-code">apps/macos/Sources/ScoutAppCore/AgentSprite.swift</code> is the reference; the hash must stay bit-exact across ports.</>,
    honors: "cross-port sprite identity",
  },
  {
    proposal: "Shared status vocabulary (dot sizes / pulse semantics, eyebrow grammar)",
    dispo: "ship",
    touch: <><code className="os1-code">Scout/Theme.swift</code>, <code className="os1-code">ScoutTheme.swift</code> — HUD stays as-is.</>,
    honors: "minimal dots, single accent",
  },
  {
    proposal: "Hand-drawn glyphs for domain objects on the macOS sidebar",
    dispo: "refine",
    touch: <>Needs a macOS port of <code className="os1-code">Glyphs.swift</code> (<code className="os1-code">apps/ios/Scout/Glyphs.swift</code> is the reference); SF Symbols stay for OS actions.</>,
    honors: "icon language, not a costume change",
  },
  {
    proposal: "Contrast baseline (adopt the iOS ScoutInk lift as a shared rule)",
    dispo: "ship",
    touch: <>Audit <code className="os1-code">ScoutThemePreset</code> muted / dim values against the AA baseline.</>,
    honors: "legibility across skins",
  },
  {
    proposal: "Accent unification across HUD / menu",
    dispo: "defer",
    touch: <>HUD lime is a deliberate broadsheet costume; menu-bar green is low-traffic.</>,
    honors: "accent-parity is low priority",
  },
];

function BlockD() {
  return (
    <section className="mb-6">
      <SectionEyebrow>Block D · Ledger</SectionEyebrow>
      <h2 className="mb-1 font-display text-[19px] font-medium tracking-tight text-studio-ink">What ships, what refines, what defers</h2>
      <p className="mb-5 max-w-[76ch] text-[13px] leading-relaxed text-studio-ink-muted">
        Each proposal mapped to a disposition, its native touch points, and the principle it honors.
      </p>
      <div className="overflow-hidden rounded-[8px] border border-studio-edge">
        <div
          className="grid gap-x-4 border-b border-studio-edge bg-studio-canvas-alt px-4 py-2 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint"
          style={{ gridTemplateColumns: "1.5fr 84px 2fr 1.1fr" }}
        >
          <span>Proposal</span>
          <span>Disposition</span>
          <span>Native touch points</span>
          <span>Honors</span>
        </div>
        {LEDGER.map((r, i) => {
          const d = DISPO[r.dispo];
          return (
            <div
              key={r.proposal}
              className={["grid items-start gap-x-4 px-4 py-3", i > 0 ? "border-t border-studio-edge" : ""].join(" ")}
              style={{ gridTemplateColumns: "1.5fr 84px 2fr 1.1fr" }}
            >
              <span className="text-[12px] font-semibold leading-snug text-studio-ink">{r.proposal}</span>
              <span>
                <span
                  className="inline-block rounded-[3px] px-1.5 py-px font-mono text-[8px] font-semibold uppercase tracking-eyebrow"
                  style={{ background: d.bg, color: d.fg }}
                >
                  {d.label}
                </span>
              </span>
              <span className="text-[11px] leading-snug text-studio-ink-muted">{r.touch}</span>
              <span className="text-[11px] leading-snug text-studio-ink-muted">{r.honors}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Page.
   ════════════════════════════════════════════════════════════════════ */

export default function ScoutOneSystemStudy() {
  const [treatment, setTreatment] = useState<Treatment>("one-system");

  return (
    <ScoutStudyShell
      pageId="scout-one-system"
      title="Scout — One System"
      blurb={
        <>
          Scout ships four visual dialects today — main-window indigo (themable, 5×5), the HUD lime broadsheet (a
          deliberate costume), the menu-bar green, and iOS emerald (dark-locked). Each is internally coherent; together
          they read as four apps. <strong className="text-studio-ink">One System</strong> keeps each platform&rsquo;s depth
          idiom — flat ruled panels on desktop, raised cards on phone, the broadsheet HUD — and unifies the{" "}
          <strong className="text-studio-ink">grammar</strong>: identity, status vocabulary, icon language, and theme
          inheritance. Toggle <code className="font-mono text-[11px] text-studio-ink">Current ⇄ One System</code> to flip
          both platforms at once.
        </>
      }
    >
      {(skin) => (
        <>
          <ScoutIOSStyles />
          <style>{ONE_SYSTEM_CSS}</style>

          {/* Master treatment toggle — drives both the macOS and iOS panes. */}
          <div className="mb-10 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-studio-ink-faint">Treatment · current vs one system</span>
            <Toggle
              value={treatment}
              onChange={setTreatment}
              options={[{ id: "current", label: "Current" }, { id: "one-system", label: "One System" }]}
            />
            <span className="font-mono text-[10px] text-studio-ink-faint">
              {treatment === "current"
                ? "Four dialects as they ship — coherent apart, disjoint together."
                : "One grammar across platforms — each keeps its own depth idiom."}
            </span>
          </div>

          <BlockA />
          <BlockB treatment={treatment} skin={skin} />
          <BlockC treatment={treatment} />
          <BlockD />
        </>
      )}
    </ScoutStudyShell>
  );
}

/* ── Scoped CSS (raw <style>, following the scout-ios idiom). ──────────
 * · iOS "theme follows pairing" — overrides --i-* with the paired Mac skin.
 *   Selector bumped to (0,3,0) via [data-v] so it beats .scoutios[data-v="…"].
 * · macOS Comms surface (`.os1mac-*`) — reads only --s-* skin tokens, plus a
 *   `--sec` secondary-text hook flipped by the treatment (contrast delta ③).
 * · `.os1-mark` — the quiet numbered delta marker (a thin accent ring).       */
const ONE_SYSTEM_CSS = `
/* ── iOS · theme follows pairing ─────────────────────────────────────── */
[data-paired="juniper-d"] .scoutios[data-v] {
  --i-bg:#191919; --i-surface:#292929; --i-chrome:#0f0f0f;
  --i-ink:#f5f5f5; --i-muted:#b6b6b6; --i-dim:#8f8f8f;
  --i-border:rgba(180,180,180,0.22); --i-hairline:rgba(180,180,180,0.12); --i-hairline-strong:rgba(180,180,180,0.28);
  --i-accent:#5585e6; --i-accent-2:#5585e6; --i-accent-soft:rgba(85,133,230,0.16);
  --i-card-top:#323232; --i-card-bottom:#242424; --i-card-edge-top:rgba(205,205,205,0.30); --i-card-edge-bottom:rgba(180,180,180,0.18);
  --i-wash-top:#111111; --i-wash-bottom:#0a0a0a; --i-keylight:rgba(255,255,255,0.05);
}
[data-paired="graphite"] .scoutios[data-v] {
  --i-bg:#121214; --i-surface:#242428; --i-chrome:#08080a;
  --i-ink:rgba(255,255,255,0.97); --i-muted:rgba(255,255,255,0.72); --i-dim:rgba(255,255,255,0.52);
  --i-border:rgba(255,255,255,0.17); --i-hairline:rgba(255,255,255,0.10); --i-hairline-strong:rgba(255,255,255,0.22);
  --i-accent:#6d7ae8; --i-accent-2:#6d7ae8; --i-accent-soft:rgba(109,122,232,0.18);
  --i-card-top:#2b2b30; --i-card-bottom:#202024; --i-card-edge-top:rgba(255,255,255,0.16); --i-card-edge-bottom:rgba(255,255,255,0.14);
  --i-wash-top:#0e0e10; --i-wash-bottom:#050506; --i-keylight:rgba(255,255,255,0.055);
}
[data-paired="nocturne-indigo"] .scoutios[data-v] {
  --i-bg:#14131c; --i-surface:#221f30; --i-chrome:#0d0c14;
  --i-ink:#f3f2f8; --i-muted:#b6b2c8; --i-dim:#8a869e;
  --i-border:rgba(150,142,205,0.24); --i-hairline:rgba(150,142,205,0.12); --i-hairline-strong:rgba(150,142,205,0.30);
  --i-accent:#7c6ff5; --i-accent-2:#6d5ef0; --i-accent-soft:rgba(124,111,245,0.18);
  --i-card-top:#2a2740; --i-card-bottom:#1e1b2c; --i-card-edge-top:rgba(170,160,235,0.34); --i-card-edge-bottom:rgba(150,142,205,0.18);
  --i-wash-top:#141320; --i-wash-bottom:#0a0910; --i-keylight:rgba(190,180,255,0.06);
}

/* ── Quiet numbered delta marker — a thin accent ring, not a filled chip. ── */
.os1-mark {
  display:inline-grid; place-items:center; flex:none;
  width:14px; height:14px; margin-left:1px;
  border-radius:50%; border:1px solid color-mix(in oklab, var(--scout-accent) 55%, transparent);
  color:var(--scout-accent); background:transparent;
  font-family:"JetBrains Mono", ui-monospace, monospace; font-size:8.5px; font-weight:700; line-height:1;
}
.os1-code {
  font-family:"JetBrains Mono", ui-monospace, monospace; font-size:10.5px;
  color:var(--studio-ink); background:color-mix(in oklab, var(--studio-ink) 8%, transparent);
  padding:0 4px; border-radius:3px;
}

/* ── macOS Comms surface — reads only --s-* skin tokens ──────────────── */
.os1mac { display:grid; grid-template-columns:134px 300px 1fr; min-height:456px; font-family:var(--s-font-sans); }

.os1mac-rail { display:flex; flex-direction:column; gap:1px; padding:10px 8px; background:var(--s-chrome); border-right:1px solid var(--s-hairline); }
.os1mac-navcap { font-family:var(--s-font-mono); font-size:8px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:var(--s-dim); padding:2px 8px 8px; }
.os1mac-nav { display:flex; align-items:center; gap:9px; padding:6px 9px; border-radius:7px; color:var(--s-muted); font-size:12.5px; font-weight:500; }
.os1mac-nav.on { background:var(--s-accent-soft); color:var(--s-accent); }
.os1mac-navicon { width:16px; height:16px; display:grid; place-items:center; color:var(--s-dim); flex:none; }
.os1mac-nav.on .os1mac-navicon { color:var(--s-accent); }
.os1mac-ph { width:13px; height:13px; border:1.4px solid currentColor; border-radius:3px; opacity:0.85; }
.os1mac-navspace { flex:1; min-height:12px; }

.os1mac-list { display:flex; flex-direction:column; min-width:0; background:var(--s-bg); border-right:1px solid var(--s-hairline); }
.os1mac-listhead { display:flex; align-items:baseline; justify-content:space-between; padding:13px 15px 8px; }
.os1mac-listtitle { font-size:14px; font-weight:600; color:var(--s-ink); }
.os1mac-listcount { font-family:var(--s-font-mono); font-size:10px; color:var(--s-dim); }
.os1mac-grp { display:flex; align-items:center; gap:6px; padding:7px 15px 4px; font-size:12px; font-weight:600; color:var(--s-muted); }
.os1mac-grp[data-g="mono"] { font-family:var(--s-font-mono); font-size:9px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--s-dim); }
.os1mac-row { display:grid; grid-template-columns:32px 1fr auto; gap:10px; padding:9px 15px; border-left:2px solid transparent; align-items:start; }
.os1mac-row.sel { background:var(--s-accent-soft); border-left-color:var(--s-accent); }
.os1mac-ava { width:32px; height:32px; border-radius:9px; display:grid; place-items:center; flex:none; }
.os1mac-ava.ch { font-family:var(--s-font-mono); font-size:15px; font-weight:700; color:var(--s-muted); background:var(--s-surface); border:1px solid var(--s-hairline-strong); }
.os1mac-body { min-width:0; display:flex; flex-direction:column; gap:2px; }
.os1mac-top { display:flex; align-items:center; gap:6px; }
.os1mac-undot { width:6px; height:6px; border-radius:50%; background:var(--s-accent); flex:none; }
.os1mac-name { font-size:13px; font-weight:500; color:var(--s-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.os1mac-row.un .os1mac-name { font-weight:700; }
.os1mac-age { margin-left:auto; font-family:var(--s-font-mono); font-size:10px; color:var(--s-dim); flex:none; }
.os1mac-prev { font-size:12px; line-height:1.4; color:var(--sec, var(--s-dim)); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.os1mac-num { align-self:center; font-family:var(--s-font-mono); font-size:11px; font-weight:600; color:var(--s-accent); }

.os1mac-thread { display:flex; flex-direction:column; min-width:0; background:var(--s-bg); }
.os1mac-thead { display:flex; align-items:center; gap:11px; padding:11px 16px; border-bottom:1px solid var(--s-hairline); }
.os1mac-tava { flex:none; }
.os1mac-tident { min-width:0; flex:1; }
.os1mac-teyebrow { font-size:11px; font-weight:600; color:var(--s-muted); }
.os1mac-teyebrow[data-g="mono"] { font-family:var(--s-font-mono); font-size:8.5px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--s-dim); }
.os1mac-tname { font-size:14px; font-weight:600; color:var(--s-ink); margin-top:1px; }
.os1mac-tfacts { font-family:var(--s-font-mono); font-size:10.5px; color:var(--sec, var(--s-dim)); margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.os1mac-tactions { display:flex; gap:8px; flex:none; }
.os1mac-ghost { padding:6px 12px; border-radius:8px; font-size:12px; font-weight:600; color:var(--s-muted); background:var(--s-surface); border:1px solid var(--s-hairline-strong); cursor:pointer; }
.os1mac-primary { padding:6px 14px; border-radius:8px; font-size:12px; font-weight:600; color:var(--s-bg); background:var(--s-accent); border:1px solid var(--s-accent); cursor:pointer; }

.os1mac-stream { flex:1; min-height:0; padding:16px; display:flex; flex-direction:column; gap:18px; }
.os1mac-turn { display:flex; gap:11px; }
.os1mac-tuava { width:26px; height:26px; border-radius:7px; flex:none; display:grid; place-items:center; font-size:12px; font-weight:700; color:var(--s-bg); background:var(--s-accent); }
.os1mac-tuava.me { color:var(--s-muted); background:var(--s-surface); border:1px solid var(--s-hairline-strong); }
.os1mac-tubody { min-width:0; flex:1; max-width:60ch; }
.os1mac-tuhead { display:flex; align-items:baseline; gap:8px; margin-bottom:3px; }
.os1mac-tuauthor { font-size:12.5px; font-weight:600; color:var(--s-ink); }
.os1mac-tutime { font-family:var(--s-font-mono); font-size:10px; color:var(--s-dim); }
.os1mac-tutext { font-size:13px; line-height:1.55; color:color-mix(in srgb, var(--s-ink) 90%, transparent); }

.os1mac-composer { display:flex; align-items:center; gap:10px; padding:12px 16px 14px; border-top:1px solid var(--s-hairline); }
.os1mac-cfield { flex:1; padding:9px 13px; border-radius:10px; font-size:12.5px; color:var(--s-dim); background:var(--s-surface); border:1px solid color-mix(in srgb, var(--s-accent) 30%, var(--s-hairline-strong)); }
`;
