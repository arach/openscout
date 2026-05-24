"use client";

/**
 * Telegraph — study.
 *
 * The *thin* temporal view to Choreography's wide one. Where
 * Choreography lays the fleet out as a score (eight lanes, ninety
 * minutes, all visible at once), Telegraph collapses time onto a
 * single horizontal lane and lets it scroll past. One strip. One
 * direction. All day.
 *
 * Morse-inspired glyph vocabulary so the tape reads as rhythm before
 * it reads as content:
 *
 *   dot          — message     ·
 *   dash         — work        —
 *   double-dash  — decision    =
 *   dotted       — artifact    ⊙
 *
 * Each glyph is colored by the agent's hue (the same hue table the
 * rest of the studio uses). Tape scrolls right-to-left into a pinned
 * NOW marker on the right edge.
 *
 * Static mock. Wire to `broker_feed` when the cursor lands; the
 * shape of EVENTS below mirrors what a real feed cursor would yield.
 */

import { TelegraphTape, type TelegraphEvent } from "../../../components/TelegraphTape";

// Agent hue table — mirrors AVATAR_HUES in agent-pulse + the LANES
// table in choreography. Kept inline so this page is self-contained.
const AGENT_HUE: Record<string, number> = {
  scout: 125,
  hudson: 210,
  qb: 25,
  cody: 85,
  ranger: 295,
  vox: 340,
  atlas: 175,
  vault: 250,
  // Extras for fleet variety — same oklch(0.72-0.78 0.13-0.16 H) band.
  echo: 280,
  pixel: 55,
  drift: 165,
  lumen: 240,
};

function evt(
  id: string,
  agent: keyof typeof AGENT_HUE,
  kind: TelegraphEvent["kind"],
  label: string,
  time: string,
): TelegraphEvent {
  return { id, agent, agentHue: AGENT_HUE[agent], kind, label, time };
}

// ~25-minute window of fleet life. Mix of message/work/decision/
// artifact, a few call-and-response pairs, some quiet stretches.
// Read top-to-bottom = oldest-to-newest in storyline order. The tape
// will render them in this order then loop.
const EVENTS: TelegraphEvent[] = [
  evt("e01", "scout", "work", "INDEX SHARED", "09:14:02"),
  evt("e02", "hudson", "message", "@SCOUT PING", "09:15:18"),
  evt("e03", "scout", "message", "ON IT", "09:15:24"),
  evt("e04", "vault", "work", "SNAPSHOT", "09:16:00"),
  evt("e05", "cody", "artifact", "SEED-001.SQL", "09:17:33"),
  evt("e06", "qb", "decision", "APPROVE 0C8F", "09:18:51"),
  evt("e07", "hudson", "work", "PR #214 REVIEW", "09:19:40"),
  evt("e08", "ranger", "work", "TAIL WATCH", "09:21:05"),
  evt("e09", "vox", "decision", "TTS RETRY", "09:22:14"),
  evt("e10", "atlas", "artifact", "ICON-SET.SVG", "09:23:00"),
  evt("e11", "scout", "message", "@CODY STATUS?", "09:24:30"),
  evt("e12", "cody", "message", "MERGED MAIN", "09:24:48"),
  evt("e13", "hudson", "artifact", "AUTH.DIFF +182", "09:26:11"),
  evt("e14", "qb", "message", "@SCOUT REVIEW", "09:27:25"),
  evt("e15", "scout", "work", "REVIEW PASS", "09:28:02"),
  evt("e16", "echo", "work", "WARM CLOUD", "09:29:18"),
  evt("e17", "scout", "decision", "APPROVE PR", "09:30:40"),
  evt("e18", "hudson", "decision", "SHIP PR #214", "09:31:02"),
  evt("e19", "hudson", "artifact", "MERGED → MAIN", "09:31:09"),
  evt("e20", "vault", "work", "SNAPSHOT", "09:33:00"),
  evt("e21", "atlas", "work", "ATOMS/EYEBROW", "09:34:22"),
  evt("e22", "scout", "artifact", "FLEET-REPORT.MD", "09:36:05"),
  evt("e23", "drift", "message", "@PIXEL HEARTBEAT", "09:37:18"),
  evt("e24", "pixel", "message", "ALIVE", "09:37:21"),
];

// The "Decoded" section freezes the last six events. Live tape =
// rhythm; this list = the read.
const DECODED = EVENTS.slice(-6).reverse();

const KIND_LABEL: Record<TelegraphEvent["kind"], string> = {
  message: "MESSAGE",
  work: "WORK",
  decision: "DECISION",
  artifact: "ARTIFACT",
};

// ── Page ─────────────────────────────────────────────────────────────
export default function TelegraphPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · telegraph
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Telegraph
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          A single horizontal lane the fleet scrolls past, glyph by glyph.
          The <em>thin</em> temporal view to{" "}
          <a
            href="/studies/choreography"
            className="text-studio-ink underline decoration-studio-edge-strong underline-offset-2 hover:text-scout-accent"
          >
            Choreography
          </a>
          &apos;s wide one — same vocabulary, collapsed onto one line you can
          park at the bottom of a monitor and forget about.
        </p>
      </header>

      {/* Hero strip — full-bleed against the page padding. */}
      <section className="-mx-7">
        <TelegraphTape events={EVENTS} speed="calm" />
      </section>

      <Legend />

      {/* In context — stylized mock monitor with a tape pinned to its
          bottom edge. The placeholder interior is intentionally
          abstract so the eye lands on the tape. */}
      <section className="mt-12">
        <SectionHeading label="· in context" />
        <p className="mt-2 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Lives at the bottom of an ops monitor. Always on, always slow.
          Glance up between tasks; the rhythm tells you what kind of
          minute it was.
        </p>

        <div className="mt-6 flex justify-center">
          <MockMonitor>
            <TelegraphTape events={EVENTS} speed="brisk" />
          </MockMonitor>
        </div>
      </section>

      {/* Decoded — frozen last-6, mono list. */}
      <section className="mt-12 max-w-prose">
        <SectionHeading label="· decoded" />
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The last six events, frozen. When the rhythm catches your ear
          and you actually want to read.
        </p>

        <div className="mt-4 rounded-md border border-studio-edge bg-studio-canvas-alt">
          <ul className="[&>*+*]:border-t [&>*+*]:border-studio-edge">
            {DECODED.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline gap-3 px-4 py-2.5 font-mono text-[11px]"
              >
                <span className="text-studio-ink tabular-nums">{e.time}</span>
                <span className="text-studio-ink-faint">·</span>
                <span
                  className="font-semibold"
                  style={{ color: `oklch(0.74 0.15 ${e.agentHue})` }}
                >
                  @{e.agent}
                </span>
                <span className="text-studio-ink-faint">·</span>
                <span className="text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                  {KIND_LABEL[e.kind]}
                </span>
                <span className="text-studio-ink-faint">·</span>
                <span className="text-studio-ink">{e.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Why this exists. */}
      <section className="mt-12 max-w-prose">
        <SectionHeading label="· why this exists" />
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Most fleet surfaces fight for attention. Telegraph doesn&apos;t.
          It sits at the periphery and gives the operator a felt sense
          of fleet tempo — busy stretches read as dense glyph runs,
          quiet stretches as obvious gaps — without ever asking to be
          read. When something does want a closer look, the Decoded list
          is there to catch it.
        </p>
      </section>
    </main>
  );
}

// ── Section heading — matches sibling studies. ─────────────────────
function SectionHeading({ label }: { label: string }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      {label}
    </div>
  );
}

// ── Legend — inline row, matches choreography's restraint. ─────────
function Legend() {
  const items: Array<{ kind: TelegraphEvent["kind"]; label: string }> = [
    { kind: "message", label: "dot = message" },
    { kind: "work", label: "dash = work" },
    { kind: "decision", label: "double-dash = decision" },
    { kind: "artifact", label: "dotted = artifact" },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] text-studio-ink-faint">
      {items.map((it) => (
        <span key={it.kind} className="inline-flex items-center gap-1.5">
          <LegendGlyph kind={it.kind} />
          <span>{it.label}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-3 w-px"
          style={{ background: "var(--scout-accent)" }}
        />
        <span>now</span>
      </span>
    </div>
  );
}

function LegendGlyph({ kind }: { kind: TelegraphEvent["kind"] }) {
  const color = "var(--studio-ink-muted)";
  if (kind === "message") {
    return (
      <svg width={18} height={10} aria-hidden>
        <circle cx={9} cy={5} r={2.2} fill={color} />
      </svg>
    );
  }
  if (kind === "work") {
    return (
      <svg width={18} height={10} aria-hidden>
        <rect x={3} y={3.5} width={12} height={3} rx={1.5} fill={color} />
      </svg>
    );
  }
  if (kind === "decision") {
    return (
      <svg width={18} height={10} aria-hidden>
        <rect x={3} y={2} width={12} height={2} rx={1} fill={color} />
        <rect x={3} y={6} width={12} height={2} rx={1} fill={color} />
      </svg>
    );
  }
  return (
    <svg width={18} height={10} aria-hidden>
      <circle cx={9} cy={5} r={2.2} fill={color} />
      <circle
        cx={9}
        cy={5}
        r={4.2}
        fill="none"
        stroke={color}
        strokeWidth={0.6}
        opacity={0.45}
      />
    </svg>
  );
}

// ── Mock monitor ────────────────────────────────────────────────────
//
// A rounded rect ~720px wide, 16:9 aspect, with a thin bezel and a
// darker interior holding skeleton placeholder bars. A subtle thin
// reflection band across the top sells "this is glass." Bottom edge
// hosts the brisk Telegraph tape passed as children.
function MockMonitor({ children }: { children: React.ReactNode }) {
  const width = 720;
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative overflow-hidden rounded-[14px] border border-studio-edge-strong shadow-[0_24px_60px_-30px_rgba(0,0,0,0.55)]"
        style={{
          width,
          background: "var(--studio-surface)",
          padding: 6,
        }}
      >
        {/* Inner screen — 16:9. */}
        <div
          className="relative overflow-hidden rounded-[8px] border border-studio-edge"
          style={{
            background: "var(--studio-canvas)",
            aspectRatio: "16 / 9",
          }}
        >
          {/* Thin reflection band, very subtle. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{
              height: "38%",
              background:
                "linear-gradient(to bottom, color-mix(in oklab, var(--studio-ink) 5%, transparent), transparent)",
            }}
          />

          {/* Top chrome bar — tiny dots + a faint search-ish pill. */}
          <div className="flex items-center gap-2 px-3 pt-3">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "var(--studio-edge-strong)" }}
            />
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "var(--studio-edge-strong)" }}
            />
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "var(--studio-edge-strong)" }}
            />
            <span
              className="ml-3 h-3 flex-1 rounded-sm"
              style={{
                background: "var(--studio-canvas-alt)",
                maxWidth: 240,
              }}
            />
          </div>

          {/* Placeholder content — extremely abstract bars so the eye
              goes straight to the tape. */}
          <div className="grid grid-cols-12 gap-2 px-3 pt-4">
            <div className="col-span-3 space-y-1.5">
              {[14, 10, 12, 9, 11, 8].map((w, i) => (
                <div
                  key={i}
                  className="h-2 rounded-sm"
                  style={{
                    width: `${w * 6}px`,
                    background: "var(--studio-canvas-alt)",
                    opacity: 0.85,
                  }}
                />
              ))}
            </div>
            <div className="col-span-9 space-y-2">
              <div
                className="h-3 rounded-sm"
                style={{
                  width: "55%",
                  background: "var(--studio-canvas-alt)",
                }}
              />
              <div
                className="h-2 rounded-sm"
                style={{
                  width: "82%",
                  background: "var(--studio-canvas-alt)",
                  opacity: 0.78,
                }}
              />
              <div
                className="h-2 rounded-sm"
                style={{
                  width: "70%",
                  background: "var(--studio-canvas-alt)",
                  opacity: 0.7,
                }}
              />
              <div
                className="h-2 rounded-sm"
                style={{
                  width: "76%",
                  background: "var(--studio-canvas-alt)",
                  opacity: 0.62,
                }}
              />
              <div className="grid grid-cols-3 gap-2 pt-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 rounded-sm border border-studio-edge"
                    style={{
                      background: "var(--studio-canvas-alt)",
                      opacity: 0.7,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Bottom-pinned Telegraph tape. */}
          <div className="absolute inset-x-0 bottom-0">{children}</div>
        </div>
      </div>

      {/* Tiny "stand" silhouette — just a hint of physical object. */}
      <div
        className="mt-1 h-1.5 rounded-b-sm"
        style={{
          width: 140,
          background: "var(--studio-edge-strong)",
          opacity: 0.7,
        }}
      />
      <div
        className="h-1 rounded-b-sm"
        style={{
          width: 80,
          background: "var(--studio-edge)",
          opacity: 0.6,
        }}
      />
    </div>
  );
}
