/**
 * HUD Chrome — study.
 *
 * The current studio chrome is a 220px persistent left sidebar + a
 * top per-page strip. It works, but it looks like every other docs
 * site — generic, bookish, anchored. This study explores a different
 * direction: strip the chrome to floating capsules and a structural
 * glyph rail, free up the page for content, and lean on ambient
 * telemetry instead of nav as the dominant visual.
 *
 * Four floating components compose the new chrome:
 *
 *   HudGlyphRail        — 48px structural rail, left edge
 *   HudCapsule          — top-center breadcrumb / status / blurb pill
 *   HudGroundControl    — bottom-right fleet presence + broker pulse
 *   TelegraphTape       — full-width bottom strip, ambient ticker
 *
 * The page renders all of them around a mock SCO doc so the trade-off
 * is visible. Inside the viewport you should see what a real reader
 * would see — the chrome should feel like overlay, not container.
 *
 * This is a STUDY, not the active shell. The existing
 * StudioSidebar/PageStrip stay put until we commit. Both chrome
 * directions are reachable; this one is preview-only.
 */

import { HudGlyphRail } from "@/components/hud/HudGlyphRail";
import { HudCapsule } from "@/components/hud/HudCapsule";
import {
  HudGroundControl,
  type GroundAgent,
} from "@/components/hud/HudGroundControl";
import {
  TelegraphTape,
  type TelegraphEvent,
} from "@/components/TelegraphTape";

const FLEET: GroundAgent[] = [
  { id: "scout", hue: 125, state: "working" },
  { id: "hudson", hue: 210, state: "working" },
  { id: "qb", hue: 25, state: "needs-attention" },
  { id: "cody", hue: 85, state: "available" },
  { id: "ranger", hue: 295, state: "idle" },
  { id: "vox", hue: 340, state: "offline" },
];

export default function HudChromePage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <PageHeader />

      <Viewport />

      <Anatomy />

      <TradeOffs />

      <ConstructionNotes />

      <PageFooter />
    </main>
  );
}

// ── Page header ──────────────────────────────────────────────────────

function PageHeader() {
  return (
    <header className="mb-9 max-w-prose">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · studies · web · hud-chrome
      </div>
      <h1 className="mt-1.5 font-display text-[40px] font-medium leading-[1.05] tracking-tight text-studio-ink">
        HUD chrome
      </h1>
      <p className="mt-3 font-sans text-[14px] leading-relaxed text-studio-ink-muted">
        A different chrome direction for the studio. Strip the
        220-pixel sidebar and the full-width header strip; replace them
        with a thin glyph rail, a floating breadcrumb capsule, a
        ground-control cluster for fleet presence, and a telegraph tape
        along the bottom. The reading column gets the page; the
        chrome gets the corners.
      </p>
      <p className="mt-3 font-sans text-[13px] italic leading-relaxed text-studio-ink-faint">
        Honest about the trade-off: this looks better and feels more
        modern, but nav becomes hover-or-cmd-k. That is a real cost.
        The study exists so we can see the look before we commit to
        the cost.
      </p>
    </header>
  );
}

// ── Viewport ─────────────────────────────────────────────────────────
//
// A bezeled "display" containing the HUD chrome and mock SCO content.
// Sized large so the floating elements have room to actually float.
// The bezel is a 1px edge with a slightly inset shadow — clean
// external display, not a phone frame.

function Viewport() {
  return (
    <section className="relative">
      <div
        className="relative mx-auto overflow-hidden rounded-[10px] border border-studio-edge-strong"
        style={{
          background: "var(--studio-canvas)",
          boxShadow:
            "0 24px 48px -24px rgba(0,0,0,0.5), 0 0 0 1px var(--studio-edge) inset",
          // Aspect target: ~1180×740. Constrain to viewport with min-height.
          aspectRatio: "1180 / 740",
          minHeight: "560px",
          maxWidth: "1180px",
        }}
      >
        {/* Inside-viewport background grain — gives the glass something to blur against. */}
        <ViewportBackdrop />

        {/* The HUD chrome. */}
        <HudGlyphRail active="engineering" />

        <HudCapsule
          crumbs={["Engineering", "SCO-047", "Agent Identity"]}
          status="in-flight"
          blurb="Branch enters identity only on collision."
        />

        <HudGroundControl agents={FLEET} brokerOk unread={7} />

        {/* Mock content — sits behind the floating chrome. */}
        <MockSCODoc />

        {/* Real Telegraph tape, pinned to the viewport's bottom edge. */}
        <div className="absolute inset-x-0 bottom-0 z-10">
          <TelegraphTape events={HUD_TAPE} speed="brisk" />
        </div>
      </div>

      <Caption />
    </section>
  );
}

function ViewportBackdrop() {
  // A subtle radial fade from canvas-alt at top-left to canvas at
  // bottom-right. Gives the glass capsules something with variation
  // to blur against — flat surfaces make glass look like a flat panel.
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse at top left, var(--studio-canvas-alt) 0%, var(--studio-canvas) 60%)",
      }}
    />
  );
}

function Caption() {
  return (
    <div className="mt-3 text-center font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
      viewport mock — actual HUD components rendered at scale
    </div>
  );
}

// ── Mock SCO doc ─────────────────────────────────────────────────────
//
// Realistic-looking proposal opening. The studio-prose class drives
// the type ramp. Padded inside the rail (left: 4rem to clear the
// 48px rail + breathing room) and the capsule (top: 4.5rem to clear
// the floating pill).

function MockSCODoc() {
  return (
    <article
      className="studio-prose absolute inset-0 overflow-y-auto"
      style={{
        paddingLeft: "5rem",
        paddingRight: "2.5rem",
        paddingTop: "4.5rem",
        paddingBottom: "5rem",
      }}
    >
      <div className="mx-auto max-w-prose">
        {/* Eyebrow above the title — feels like a real numbered SCO. */}
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
          · proposal · in-flight · last touched 4 min ago
        </div>

        <h1>SCO-047 · Agent Identity and Fleet Counting</h1>

        <p>
          The fleet currently double-counts agents that exist in more
          than one workspace. An agent named <code>scout</code> running
          in <code>/dev/openscout</code> and another <code>scout</code>{" "}
          in <code>/dev/landing</code> appear as two rows in
          ground-control, two beacons on the sonar, and two senders in
          the broker tail. That's the right model for routing — they
          are distinct processes with distinct sessions — but it is the
          wrong model for the operator's mental count of "how many
          agents do I have running".
        </p>

        <p>
          This proposal threads the needle: agent identity stays
          process-scoped (workspace, harness, branch, model), but the{" "}
          <strong>display identity</strong> collapses to a single row
          per name unless there is a genuine collision worth surfacing.
          A collision is genuine when two processes with the same name
          are doing different things — different branch, different
          model, or different harness. Same-name same-everything is a
          presentation artifact and gets folded.
        </p>

        <h2>Mechanism</h2>

        <p>
          The broker already knows the full tuple for each connected
          agent. We add a thin <code>renderIdentity()</code> helper
          downstream of presence that returns a short display string
          plus a <code>disambiguator</code> field that's only populated
          when the operator needs to tell two same-named agents apart.
          Consumers (sonar, ground-control, tail) read the same helper.
        </p>

        <pre>
          <code>{`function renderIdentity(a: Agent, peers: Agent[]) {
  const sameName = peers.filter(p => p.name === a.name);
  if (sameName.length === 1) return { label: a.name };

  // Genuine collision — surface the smallest distinguisher.
  const byBranch = unique(sameName.map(p => p.branch));
  if (byBranch.length > 1) {
    return { label: a.name, disambiguator: a.branch };
  }
  // ... model, then harness, then projectRoot tail
}`}</code>
        </pre>

        <h2>Open questions</h2>

        <p>
          Three things to land before merge. First, the disambiguator's{" "}
          <em>visual</em> placement — does it appear inline with the
          name in ground-control, or only on hover? Second, the
          ordering rule when a collision happens — alphabetical by
          disambiguator feels right but isn't load-bearing. Third,
          whether the in-place worktree convention (working in the
          project root by default) changes the math; if every agent
          shares <code>projectRoot</code>, branch becomes the dominant
          distinguisher.
        </p>
      </div>
    </article>
  );
}

// ── Telegraph mock feed ──────────────────────────────────────────────
// A short loop of events to feed the TelegraphTape inside the viewport.
// Mirrors the kind of stream the real ticker would carry in production.

const HUD_TAPE: TelegraphEvent[] = [
  { id: "h1", agent: "scout", agentHue: 125, kind: "message", label: "indexed channel.shared", time: "21:18" },
  { id: "h2", agent: "hudson", agentHue: 210, kind: "work", label: "PR #214 review", time: "21:18" },
  { id: "h3", agent: "qb", agentHue: 25, kind: "decision", label: "approve flight 0c8f", time: "21:19" },
  { id: "h4", agent: "cody", agentHue: 85, kind: "work", label: "fixture rebuild", time: "21:20" },
  { id: "h5", agent: "hudson", agentHue: 210, kind: "artifact", label: "auth.diff", time: "21:21" },
  { id: "h6", agent: "scout", agentHue: 125, kind: "message", label: "@cody status?", time: "21:22" },
  { id: "h7", agent: "cody", agentHue: 85, kind: "message", label: "merged main", time: "21:22" },
  { id: "h8", agent: "atlas", agentHue: 175, kind: "work", label: "icon-set", time: "21:23" },
  { id: "h9", agent: "vox", agentHue: 340, kind: "decision", label: "TTS retry", time: "21:24" },
  { id: "h10", agent: "ranger", agentHue: 295, kind: "work", label: "tail watcher", time: "21:25" },
  { id: "h11", agent: "scout", agentHue: 125, kind: "artifact", label: "fleet-report.md", time: "21:26" },
  { id: "h12", agent: "qb", agentHue: 25, kind: "message", label: "@scout review", time: "21:27" },
];

// ── Anatomy ──────────────────────────────────────────────────────────

function Anatomy() {
  return (
    <section className="mt-14">
      <SectionHead
        kicker="anatomy"
        title="What's floating where"
        lede="Four pieces — three glass, one tape. Each carries a single responsibility."
      />

      <ol className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
        <AnatomyItem
          marker="A"
          name="Glyph rail"
          role="Structural / navigation"
          body="48px rail at the left edge. Hand-drawn glyphs, one per bucket. Hover surfaces a label; active state is a 2px scout-accent bar against the inner edge."
        />
        <AnatomyItem
          marker="B"
          name="Breadcrumb capsule"
          role="Floating / orientation"
          body="Pill at top-center. Carries the path, a status pill, and a one-line italic blurb. Floats over content with real shadow and back-blur."
        />
        <AnatomyItem
          marker="C"
          name="Ground control"
          role="Floating / telemetry"
          body="Bottom-right cluster. Agent presence beacons colored by hue, with rings encoding state. Broker pulse breathes once every 1.8s — the heartbeat."
        />
        <AnatomyItem
          marker="D"
          name="Telegraph tape"
          role="Full-width / ambient"
          body="44px strip along the very bottom. Reserved for the live broker tail or session morse — the ticker, not the news."
        />
      </ol>
    </section>
  );
}

function AnatomyItem({
  marker,
  name,
  role,
  body,
}: {
  marker: string;
  name: string;
  role: string;
  body: string;
}) {
  return (
    <li className="flex list-none gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[3px] border border-studio-edge font-mono text-[10px] font-semibold text-studio-ink-faint"
      >
        {marker}
      </span>
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[16px] text-studio-ink">
            {name}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            {role}
          </span>
        </div>
        <p className="mt-1 font-sans text-[12.5px] leading-relaxed text-studio-ink-muted">
          {body}
        </p>
      </div>
    </li>
  );
}

// ── Trade-offs ───────────────────────────────────────────────────────

function TradeOffs() {
  return (
    <section className="mt-14">
      <SectionHead
        kicker="honest assessment"
        title="Trade-offs"
        lede="This direction is not free. Both columns are real."
      />

      <div className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded border border-studio-edge md:grid-cols-2">
        <Column
          tone="ok"
          heading="What you gain"
          items={[
            "Reading column gets the page. Studio prose at 720px sits centered without the 220px sidebar pushing it off-axis.",
            "Ambient telemetry. The broker pulse and fleet beacons live in the chrome instead of needing a dedicated route.",
            "Less generic. The current chrome looks like Notion / Linear / every docs site. The HUD direction does not.",
            "More room for content density. The studies that want a full canvas (choreography, standing-watch) get it back.",
          ]}
        />
        <Column
          tone="warn"
          heading="What you give up"
          items={[
            "Nav becomes hover-or-cmd-k. The full bucket list is no longer visible at rest — you have to know it's there.",
            "Glass doesn't read on every backdrop. A solid-color study page makes the capsules look almost flat.",
            "More floating layers means more visual chrome to manage on small viewports. The capsule and ground-control can collide on narrow screens.",
            "Reaching for a page you haven't visited recently takes a search instead of a glance.",
          ]}
        />
      </div>
    </section>
  );
}

function Column({
  tone,
  heading,
  items,
}: {
  tone: "ok" | "warn";
  heading: string;
  items: string[];
}) {
  const accent =
    tone === "ok" ? "var(--status-ok-fg)" : "var(--status-warn-fg)";

  return (
    <div className="bg-studio-canvas-alt p-5">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: accent }}
        />
        <h3 className="m-0 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          {heading}
        </h3>
      </div>
      <ul className="mt-3 m-0 space-y-2.5 p-0">
        {items.map((item, i) => (
          <li
            key={i}
            className="list-none border-l border-studio-edge pl-3 font-sans text-[12.5px] leading-relaxed text-studio-ink-muted"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Construction notes ───────────────────────────────────────────────

function ConstructionNotes() {
  return (
    <section className="mt-14">
      <SectionHead
        kicker="construction"
        title="The four parts"
        lede="Files added by this study. All additive — nothing in the active shell changed."
      />

      <div className="mt-5 overflow-hidden rounded border border-studio-edge bg-studio-canvas-alt">
        <ul className="m-0 p-0">
          {[
            {
              path: "components/hud/HudGlyphRail.tsx",
              role: "48px structural rail; hand-drawn glyph per bucket; hover tooltip; active accent bar.",
            },
            {
              path: "components/hud/HudCapsule.tsx",
              role: "Top-center pill; breadcrumbs · status · italic blurb; glass back, real shadow.",
            },
            {
              path: "components/hud/HudGroundControl.tsx",
              role: "Bottom-right cluster; agent beacons keyed by hue; broker pulse on a 1.8s breath.",
            },
            {
              path: "app/studies/hud-chrome/page.tsx",
              role: "This page. Bezeled viewport with mock SCO content under the floating HUD.",
            },
          ].map((item) => (
            <li
              key={item.path}
              className="m-0 list-none p-4 [&+li]:border-t [&+li]:border-studio-edge"
            >
              <div className="flex items-baseline justify-between gap-4">
                <code className="font-mono text-[11.5px] text-studio-ink">
                  {item.path}
                </code>
                <span className="hidden font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint sm:inline">
                  new
                </span>
              </div>
              <p className="mt-1.5 font-sans text-[12px] leading-relaxed text-studio-ink-muted">
                {item.role}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Section head ─────────────────────────────────────────────────────

function SectionHead({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="max-w-prose">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {kicker}
      </div>
      <h2 className="mt-1 m-0 font-display text-[26px] font-medium leading-tight tracking-tight text-studio-ink">
        {title}
      </h2>
      <p className="mt-2 font-sans text-[13.5px] leading-relaxed text-studio-ink-muted">
        {lede}
      </p>
    </header>
  );
}

// ── Footer ───────────────────────────────────────────────────────────

function PageFooter() {
  return (
    <footer className="mt-14 border-t border-studio-edge pt-3 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
      <span>study · </span>
      <span className="text-studio-ink">hud-chrome</span>
      <span className="mx-1.5">·</span>
      <span>preview only — active shell unchanged</span>
    </footer>
  );
}
