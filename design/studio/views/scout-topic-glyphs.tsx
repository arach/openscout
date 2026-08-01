"use client";

import { useState } from "react";
import { TopicGlyph, type TopicGlyphId } from "@/components/scout/TopicGlyphs";

type Tone = "quiet" | "active" | "accent";

type GlyphItem = {
  id: TopicGlyphId;
  label: string;
  current?: string;
  recommendation?: string;
  tone?: Tone;
};

const NAV: GlyphItem[] = [
  { id: "comms", label: "Comms", current: "bubble.left.and.bubble.right", recommendation: "keep", tone: "active" },
  { id: "projects", label: "Projects", current: "folder", recommendation: "square stack", tone: "active" },
  { id: "terminals", label: "Terminals", current: "terminal", recommendation: "keep", tone: "active" },
  { id: "tail", label: "Tail", current: "waveform.path.ecg", recommendation: "list rectangle", tone: "accent" },
  { id: "dispatch", label: "Dispatch", current: "paperplane", recommendation: "keep", tone: "active" },
  { id: "lanes", label: "Lanes", current: "rectangle.split.3x1", recommendation: "three parallel tracks", tone: "active" },
  { id: "repos", label: "Repos", current: "arrow.triangle.branch", recommendation: "keep", tone: "active" },
  { id: "code", label: "Code", current: "chevron.left.forwardslash.chevron.right", recommendation: "keep", tone: "active" },
  { id: "settings", label: "Settings", current: "gearshape", recommendation: "keep", tone: "quiet" },
];

const SETTINGS: GlyphItem[] = [
  { id: "appearance", label: "Appearance", current: "paintpalette", recommendation: "half-light circle", tone: "accent" },
  { id: "terminals", label: "Terminal", current: "terminal", recommendation: "keep" },
  { id: "voice", label: "Voice", current: "waveform", recommendation: "mic", tone: "accent" },
  { id: "notifications", label: "Notifications", current: "bell", recommendation: "keep" },
  { id: "about", label: "About", current: "info.circle", recommendation: "keep" },
];

const SERVICES: GlyphItem[] = [
  { id: "broker", label: "Broker", current: "custom hub", recommendation: "keep custom / server rack fallback" },
  { id: "mesh", label: "Mesh", current: "custom triangle", recommendation: "keep custom" },
  { id: "web", label: "Web", current: "custom globe", recommendation: "globe" },
  { id: "peers", label: "Peers", current: "custom dots", recommendation: "person cluster" },
  { id: "terminals", label: "Terminal", current: "custom prompt", recommendation: "terminal" },
  { id: "relay", label: "Relay", current: "custom endpoints", recommendation: "directional link" },
];

const SEMANTIC: GlyphItem[] = [
  { id: "all", label: "All", current: "tray.full", recommendation: "keep" },
  { id: "direct", label: "Direct", current: "person.crop.circle", recommendation: "keep" },
  { id: "channels", label: "Channels", current: "number", recommendation: "keep # association" },
  { id: "think", label: "Think", current: "brain / sparkles", recommendation: "one canonical mark" },
  { id: "tool", label: "Tool", current: "wrench.and.screwdriver", recommendation: "keep" },
  { id: "ask", label: "Ask", current: "questionmark.circle / bubble", recommendation: "question bubble" },
  { id: "message", label: "Message", current: "text.bubble / bubble.left", recommendation: "one canonical bubble" },
  { id: "note", label: "Note", current: "note.text", recommendation: "keep" },
  { id: "boot", label: "Boot", current: "power", recommendation: "keep" },
  { id: "read", label: "Read", current: "eye", recommendation: "keep" },
  { id: "edit", label: "Edit", current: "pencil", recommendation: "keep" },
];

const GROUPS = [
  { id: "nav", label: "Main navigation", items: NAV },
  { id: "settings", label: "Settings", items: SETTINGS },
  { id: "services", label: "Menu-bar service deck", items: SERVICES },
  { id: "semantic", label: "Semantic events and filters", items: SEMANTIC },
] as const;

function GlyphCard({ item, large = false }: { item: GlyphItem; large?: boolean }) {
  const tone = item.tone ?? "quiet";
  const color = tone === "accent" ? "var(--scout-accent)" : tone === "active" ? "var(--studio-ink)" : "var(--studio-ink-muted)";
  return (
    <article className="rounded-[9px] border border-studio-edge bg-studio-canvas-alt p-3">
      <div className="flex items-center gap-3">
        <div
          className={`${large ? "h-12 w-12" : "h-9 w-9"} grid shrink-0 place-items-center rounded-[8px]`}
          style={{ color, background: tone === "accent" ? "var(--scout-accent-soft)" : "var(--studio-canvas)" }}
        >
          <TopicGlyph id={item.id} size={large ? 24 : 18} label={item.label} />
        </div>
        <div className="min-w-0">
          <h3 className="font-sans text-sm font-semibold text-studio-ink">{item.label}</h3>
          {item.current ? <div className="truncate font-mono text-2xs text-studio-ink-faint">now · {item.current}</div> : null}
        </div>
      </div>
      {item.recommendation ? (
        <div className="mt-3 border-t border-studio-edge pt-2 font-mono text-2xs uppercase tracking-[0.08em] text-studio-ink-faint">
          direction · <span className="text-studio-ink-muted">{item.recommendation}</span>
        </div>
      ) : null}
    </article>
  );
}

function PreviewRail({ proposed }: { proposed: boolean }) {
  const items = NAV.map((item) => ({
    ...item,
    id: !proposed && item.id === "tail" ? "pulse" as const : item.id,
  }));
  return (
    <div className="flex items-center gap-1 rounded-[10px] border border-studio-edge bg-studio-canvas-alt p-2">
      {items.map((item, index) => (
        <div
          key={item.label}
          className="group relative grid h-10 w-10 place-items-center rounded-[8px]"
          style={{
            color: index === 3 ? "var(--scout-accent)" : "var(--studio-ink-muted)",
            background: index === 3 ? "var(--scout-accent-soft)" : "transparent",
          }}
          title={item.label}
        >
          <TopicGlyph id={item.id} size={19} />
          <span className="pointer-events-none absolute -bottom-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-studio-ink px-1.5 py-1 font-mono text-2xs text-studio-canvas opacity-0 transition-opacity group-hover:opacity-100">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ScoutTopicGlyphsPage() {
  const [proposed, setProposed] = useState(true);

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          studies / macos / iconography
        </div>
        <h1 className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-studio-ink">
          Scout topic glyphs
        </h1>
        <p className="mt-3 font-sans text-lg leading-relaxed text-studio-ink-faint">
          A controlled vocabulary for the native app&apos;s topics, settings, services, and event kinds.
          Every mark here is a small inline SVG primitive owned by Scout — no SF Symbols, icon font,
          Lucide, or vendored asset is required.
        </p>
      </header>

      <section className="rounded-[10px] border border-studio-edge bg-studio-canvas-alt p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">rail preview</div>
            <div className="mt-1 font-sans text-sm text-studio-ink-muted">The proposed Tail mark is the one deliberate semantic change.</div>
          </div>
          <div className="flex items-center gap-1 rounded-[7px] border border-studio-edge bg-studio-canvas px-1 py-1 font-mono text-2xs uppercase tracking-[0.08em]">
            <button
              type="button"
              className={`rounded-[4px] px-2 py-1 ${!proposed ? "bg-studio-surface text-studio-ink" : "text-studio-ink-faint"}`}
              onClick={() => setProposed(false)}
            >
              current
            </button>
            <button
              type="button"
              className={`rounded-[4px] px-2 py-1 ${proposed ? "bg-studio-surface text-studio-ink" : "text-studio-ink-faint"}`}
              onClick={() => setProposed(true)}
            >
              proposed
            </button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-4">
          <PreviewRail proposed={proposed} />
          <div className="font-mono text-2xs uppercase tracking-[0.08em] text-studio-ink-faint">
            <span className="text-studio-ink-muted">{proposed ? "inline SVG / proposed" : "symbol names / current"}</span>
            <br />
            currentColor · 1.6–1.8 stroke
          </div>
        </div>
      </section>

      {GROUPS.map((group) => (
        <section key={group.id} className="mt-10">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="font-sans text-xl font-semibold text-studio-ink">{group.label}</h2>
            <span className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">{group.items.length} glyphs</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => <GlyphCard key={`${group.id}-${item.label}`} item={item} large={group.id === "nav"} />)}
          </div>
        </section>
      ))}

      <section className="mt-10 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-[10px] border border-studio-edge bg-studio-canvas-alt p-4">
          <div className="font-mono text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">ownership rule</div>
          <h2 className="mt-2 font-sans text-lg font-semibold text-studio-ink">Draw the meaning once.</h2>
          <p className="mt-2 font-sans text-md leading-relaxed text-studio-ink-faint">
            The visual primitives live in <code className="font-mono text-studio-ink-muted">TopicGlyphs.tsx</code> and use only SVG paths,
            circles, rectangles, and currentColor. A native SwiftUI port can mirror those primitives without importing an icon package.
          </p>
        </article>
        <article className="rounded-[10px] border border-studio-edge bg-studio-canvas-alt p-4">
          <div className="font-mono text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">consistency pass</div>
          <h2 className="mt-2 font-sans text-lg font-semibold text-studio-ink">One semantic mark per event.</h2>
          <p className="mt-2 font-sans text-md leading-relaxed text-studio-ink-faint">
            Think, Ask, and Message currently drift between Comms and Observe. The atlas gives each a single controlled mark before the production mapping is ported.
          </p>
        </article>
      </section>
    </main>
  );
}
