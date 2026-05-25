"use client";

/**
 * Ticker — study.
 *
 * Showcases the reusable activity-stream primitive AND the underlying
 * QuickSteer behavior that powers it — both modes (passive scroll,
 * steer interaction), the action vocabulary per kind, an in-context
 * demo, and a final section proving that QuickSteer ports cleanly to
 * any agent-activity surface (here: AgentRow).
 *
 * Hover in steer mode no longer pauses the scroll — only an open
 * input dock does. Quick verbs commit on a moving target; only the
 * conversational dock locks the strip while the operator types.
 */

import { useState } from "react";
import {
  DEFAULT_TICKER_ACTIONS,
  Ticker,
  type TickerEvent,
  type TickerKind,
} from "@/components/Ticker";
import { AgentRow, type AgentRowAgent } from "@/components/AgentRow";
import type { SteerEvent } from "@/components/QuickSteer";

// ── Mock data ────────────────────────────────────────────────────────

const ROSTER: AgentRowAgent[] = [
  { id: "scout", name: "Scout", state: "working", task: "indexing channel.shared", updatedAgo: "2s" },
  { id: "hudson", name: "Hudson", state: "working", task: "reviewing PR #214", updatedAgo: "11s" },
  { id: "qb", name: "QB", state: "needs-attention", task: "awaiting decision · 0c8f", updatedAgo: "1m" },
  { id: "cody", name: "Cody", state: "available", task: "idle, ready to dispatch", updatedAgo: "4m" },
  { id: "ranger", name: "Ranger", state: "idle", task: "tail watcher", updatedAgo: "18m" },
  { id: "vox", name: "Vox", state: "error", task: "TTS provider auth failed", updatedAgo: "32m" },
];

const FEED: TickerEvent[] = [
  { id: "t1", agent: "scout", agentHue: 125, kind: "message", label: "indexed channel.shared", time: "21:18:04" },
  { id: "t2", agent: "hudson", agentHue: 210, kind: "work", label: "PR #214 review", time: "21:18:42" },
  { id: "t3", agent: "qb", agentHue: 25, kind: "decision", label: "flight 0c8f approve?", time: "21:19:15" },
  { id: "t4", agent: "cody", agentHue: 85, kind: "work", label: "fixture rebuild", time: "21:20:01" },
  { id: "t5", agent: "hudson", agentHue: 210, kind: "artifact", label: "auth.diff +182 / -47", time: "21:21:33" },
  { id: "t6", agent: "scout", agentHue: 125, kind: "message", label: "@cody status?", time: "21:22:08" },
  { id: "t7", agent: "cody", agentHue: 85, kind: "message", label: "merged main", time: "21:22:51" },
  { id: "t8", agent: "atlas", agentHue: 175, kind: "work", label: "icon-set draft", time: "21:23:40" },
  { id: "t9", agent: "vox", agentHue: 340, kind: "decision", label: "TTS retry?", time: "21:24:14" },
  { id: "t10", agent: "ranger", agentHue: 295, kind: "work", label: "tail watcher", time: "21:25:00" },
  { id: "t11", agent: "scout", agentHue: 125, kind: "artifact", label: "fleet-report.md", time: "21:26:21" },
  { id: "t12", agent: "qb", agentHue: 25, kind: "message", label: "@scout review please", time: "21:27:09" },
  { id: "t13", agent: "echo", agentHue: 280, kind: "work", label: "warming pool", time: "21:28:02" },
  { id: "t14", agent: "drift", agentHue: 165, kind: "artifact", label: "cache.bin", time: "21:29:18" },
];

// ── Page ─────────────────────────────────────────────────────────────

export default function TickerStudyPage() {
  const [log, setLog] = useState<
    Array<{ at: string; verb: string; on: string; text?: string }>
  >([]);

  const onAction = (evt: SteerEvent, actionId: string, text?: string) => {
    const at = new Date()
      .toLocaleTimeString("en-US", { hour12: false })
      .slice(0, 8);
    setLog((prev) =>
      [
        { at, verb: actionId, on: `@${evt.agent} · ${evt.label}`, text },
        ...prev,
      ].slice(0, 6),
    );
  };

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · ticker
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Ticker
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The reusable activity stream that backs Telegraph and the HUD
          chrome&apos;s bottom strip. Two modes: <em>passive</em> for ambient
          read, <em>steer</em> for quick-steer — hover any event to pause,
          click a chip to commit a verb. Glass treatment on the chip
          cluster matches the HUD capsules so the language stays
          consistent across surfaces.
        </p>
      </header>

      {/* Passive mode */}
      <SectionTitle hint="Default — runs all day, no interaction">
        Passive
      </SectionTitle>
      <div className="-mx-2 mt-3">
        <Ticker events={FEED} speed="calm" mode="passive" />
      </div>
      <Note>
        The full Telegraph study is one applied configuration of this
        mode. Embedded in HUD chrome it&apos;s also passive — ambient
        only, hover does nothing.
      </Note>

      {/* Steer mode */}
      <SectionTitle hint="Hover pauses · click a chip to commit" className="mt-12">
        Steer
      </SectionTitle>
      <div className="-mx-2 mt-3 pt-8">
        <Ticker events={FEED} speed="calm" mode="steer" onAction={onAction} />
      </div>
      <Note>
        Hover any event — the strip pauses, a glass chip cluster
        floats above the slot. Instant verbs (pin / pause / abort /
        ack / open / tail) commit on click. Conversational verbs
        (reply / thread / reject — marked with a small{" "}
        <span className="font-mono text-studio-ink">⋯</span>) open an
        inline input dock with a mic, text field, and send button.
        Esc cancels; Enter sends. Pull off → scroll resumes.
      </Note>

      <ActionLog entries={log} />

      {/* Action vocabulary */}
      <SectionTitle hint="Canonical verbs per kind (override per-event via TickerEvent.actions)" className="mt-14">
        Action vocabulary
      </SectionTitle>
      <ActionVocab />

      {/* In context */}
      <SectionTitle hint="Embedded in a faux ops monitor with steer enabled" className="mt-14">
        In context
      </SectionTitle>
      <InContext onAction={onAction} />

      {/* On other surfaces — QuickSteer ports cleanly to any agent
       *  activity row, not just ticker slots. */}
      <SectionTitle hint="The same chips on a static roster row" className="mt-14">
        On other surfaces
      </SectionTitle>
      <OnOtherSurfaces onAction={onAction} />

      {/* API */}
      <SectionTitle hint="What you import" className="mt-14">
        API
      </SectionTitle>
      <Api />

      {/* Why this exists */}
      <section className="mt-14 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · why this exists
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Telegraph proved the value of an ambient activity strip. HUD
          chrome wanted one too. Both surfaces wanted to remain
          glanceable, but operators sometimes need to ACT on what they
          glance at — ack a decision, pin a thread, abort a runaway
          job, or <em>say something back</em> — without leaving the
          surface they were already on. Quick steer is the smallest
          possible nudge UX: hover, click, commit. Verbs that take a
          payload (reply / thread / reject) open an inline dock with a
          mic, a text field, and a send button — so a voice or typed
          message goes straight from your eye to the broker in two
          gestures. No modal, no new screen, no context loss. Anything
          bigger than this is a different surface (channel, agent
          detail, decision queue).
        </p>
        <p className="mt-3 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          The mic in the dock is mocked here — clicking it twice
          appends a contextual phrase per verb so the UX reads without
          us wiring{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            window.SpeechRecognition
          </code>{" "}
          yet. The real version drops in at a single line.
        </p>
      </section>
    </main>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function SectionTitle({
  children,
  hint,
  className = "",
}: {
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-3 ${className}`}>
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {children}
      </div>
      {hint ? (
        <div className="font-mono text-[10px] text-studio-ink-faint">
          {hint}
        </div>
      ) : null}
      <div className="ml-3 h-px flex-1 bg-studio-edge" />
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
      {children}
    </p>
  );
}

function ActionLog({
  entries,
}: {
  entries: Array<{ at: string; verb: string; on: string; text?: string }>;
}) {
  return (
    <div className="mt-5 max-w-prose">
      <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        · action log {entries.length > 0 ? `(${entries.length})` : ""}
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-studio-edge bg-studio-canvas-alt px-4 py-3 font-mono text-[10.5px] text-studio-ink-faint">
          No actions yet — hover the Steer ticker, click a chip. Verbs like{" "}
          <span className="text-studio-ink">reply</span>,{" "}
          <span className="text-studio-ink">thread</span>, and{" "}
          <span className="text-studio-ink">reject</span> open the input dock.
        </div>
      ) : (
        <ul className="m-0 list-none rounded-md border border-studio-edge bg-studio-canvas-alt p-0 font-mono text-[10.5px] [&>*+*]:border-t [&>*+*]:border-studio-edge">
          {entries.map((e, i) => (
            <li key={i} className="flex flex-col gap-0.5 px-4 py-2">
              <div className="flex items-baseline gap-3">
                <span className="tabular-nums text-studio-ink-faint">
                  {e.at}
                </span>
                <span className="uppercase tracking-eyebrow text-studio-ink">
                  {e.verb}
                </span>
                <span className="text-studio-ink-faint">→ {e.on}</span>
              </div>
              {e.text ? (
                <div
                  className="ml-[68px] font-sans text-[11.5px] italic text-studio-ink"
                  style={{ color: "var(--scout-accent)" }}
                >
                  “{e.text}”
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionVocab() {
  const kinds: TickerKind[] = ["message", "work", "decision", "artifact"];
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-studio-edge bg-studio-canvas-alt">
      <div className="grid grid-cols-[140px_1fr_minmax(0,2fr)] gap-4 border-b border-studio-edge px-5 py-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        <div>Kind</div>
        <div>Default actions</div>
        <div>Meaning</div>
      </div>
      <div className="[&>*+*]:border-t [&>*+*]:border-studio-edge">
        {kinds.map((kind) => (
          <VocabRow key={kind} kind={kind} />
        ))}
      </div>
    </div>
  );
}

function VocabRow({ kind }: { kind: TickerKind }) {
  const actions = DEFAULT_TICKER_ACTIONS[kind];
  return (
    <div className="grid grid-cols-[140px_1fr_minmax(0,2fr)] items-center gap-4 px-5 py-3.5">
      <div>
        <div className="font-sans text-[13px] font-medium text-studio-ink">
          {kind}
        </div>
        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {kindGlyphHint(kind)}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {actions.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-1.5 rounded-full border border-studio-edge px-2 py-0.5 font-mono text-[9.5px] text-studio-ink-faint"
            style={{
              color:
                a.variant === "danger"
                  ? "var(--status-error-fg)"
                  : a.variant === "primary"
                    ? "var(--status-ok-fg)"
                    : undefined,
            }}
          >
            <span>{a.label.toLowerCase()}</span>
          </div>
        ))}
      </div>
      <div className="font-sans text-[12.5px] text-studio-ink-faint">
        {kindMeaning(kind)}
      </div>
    </div>
  );
}

function kindGlyphHint(kind: TickerKind): string {
  switch (kind) {
    case "message":
      return "·  dot";
    case "work":
      return "—  dash";
    case "decision":
      return "══  double";
    case "artifact":
      return "●  dotted";
  }
}

function kindMeaning(kind: TickerKind): string {
  switch (kind) {
    case "message":
      return "An @mention or chat line between agents. Reply inline, lift to a thread, or pin for later.";
    case "work":
      return "Sustained activity (a task, a job, a long run). Tail the output, pause, or abort if it's misbehaving.";
    case "decision":
      return "A point that needs an answer. Acknowledge to land it, pin to defer, reject to send it back.";
    case "artifact":
      return "A file, diff, PR, or report just landed. Open it, reply to it, or pin it.";
  }
}

// ── In-context demo ──────────────────────────────────────────────────

function InContext({
  onAction,
}: {
  onAction: (e: TickerEvent, a: string) => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-studio-edge bg-studio-canvas-alt p-5">
      {/* Faux monitor / app window */}
      <div
        className="relative mx-auto overflow-hidden rounded-md border border-studio-edge bg-studio-canvas"
        style={{ maxWidth: 880, aspectRatio: "16 / 10" }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-1.5 border-b border-studio-edge px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--status-error-fg)" }}
          />
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--status-warn-fg)" }}
          />
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--status-ok-fg)" }}
          />
          <span className="ml-3">openscout · ops</span>
        </div>

        {/* Body — abstract placeholder */}
        <div className="flex h-full flex-col">
          <div className="flex-1 px-6 py-5">
            <div className="space-y-2">
              <div
                className="h-4 w-2/5 rounded"
                style={{ background: "var(--studio-canvas-alt)" }}
              />
              <div
                className="h-2 w-3/5 rounded"
                style={{ background: "var(--studio-canvas-alt)", opacity: 0.7 }}
              />
              <div
                className="h-2 w-2/5 rounded"
                style={{ background: "var(--studio-canvas-alt)", opacity: 0.7 }}
              />
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 rounded border border-studio-edge"
                  style={{ background: "var(--studio-canvas-alt)", opacity: 0.5 }}
                />
              ))}
            </div>
          </div>

          {/* Ticker pinned to the bottom edge, steer mode on. */}
          <div className="relative">
            <Ticker
              events={FEED}
              speed="brisk"
              mode="steer"
              onAction={onAction}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 text-center font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        hover an event in the strip → action chips float above
      </div>
    </div>
  );
}

// ── Other surfaces: AgentRow with steer enabled ─────────────────────

function OnOtherSurfaces({
  onAction,
}: {
  onAction: (e: SteerEvent, a: string, t?: string) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
      <SurfacePanel
        title="Roster · comfortable"
        sub="Default sidebar density · steerable"
      >
        <div className="rounded-md border border-studio-edge bg-studio-surface p-2">
          {ROSTER.slice(0, 4).map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              density="comfortable"
              steerable
              onAction={onAction}
            />
          ))}
        </div>
      </SurfacePanel>

      <SurfacePanel
        title="Roster · compact"
        sub="Higher-density list · steerable"
      >
        <div className="rounded-md border border-studio-edge bg-studio-surface p-1">
          {ROSTER.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              density="compact"
              steerable
              onAction={onAction}
            />
          ))}
        </div>
      </SurfacePanel>

      <SurfacePanel
        title="Manifest · ops tail"
        sub="Single-line baseline · steerable"
      >
        <div className="rounded-md border border-studio-edge bg-studio-surface">
          {ROSTER.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              density="manifest"
              steerable
              onAction={onAction}
            />
          ))}
        </div>
      </SurfacePanel>

      <div className="lg:col-span-3">
        <p className="max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          Same chip cluster, same input dock, same{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            onAction
          </code>{" "}
          callback. AgentRow opts in by setting{" "}
          <code className="font-mono text-[11px] text-studio-ink">steerable</code>{" "}
          — the underlying QuickSteer wrapper handles state, glass, and
          mic. Roster events default to{" "}
          <code className="font-mono text-[11px] text-studio-ink">message</code>{" "}
          kind (reply / thread / pin), and agents in{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            needs-attention
          </code>{" "}
          surface decision verbs (ack / pin / reject) instead. Click the
          chips on any density to see the action log fill — it&apos;s the
          same log as the ticker above.
        </p>
      </div>
    </div>
  );
}

function SurfacePanel({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <div className="font-sans text-[12.5px] font-medium text-studio-ink">
          {title}
        </div>
        <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          {sub}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── API reference ────────────────────────────────────────────────────

function Api() {
  return (
    <pre
      className="mt-3 overflow-x-auto rounded-md border border-studio-edge p-5 font-mono text-[11.5px] leading-[1.55] text-studio-ink"
      style={{ background: "var(--code-bg)" }}
    >
{`import { Ticker, DEFAULT_TICKER_ACTIONS } from "@/components/Ticker";
import type {
  TickerEvent,
  TickerAction,
  TickerKind,
} from "@/components/Ticker";

<Ticker
  events={events}                         // TickerEvent[]
  speed="calm"                            // "calm" (~180s) | "brisk" (~90s)
  mode="steer"                            // "passive" | "steer"
  showNow                                 // boolean
  onAction={(evt, id, text) => {…}}       // text is set when the
                                          //   action used the input dock
/>

// TickerAction
{
  id: string;
  label: string;
  glyph: "reply" | "thread" | "pin" | "pause" | "abort" | "ack" |
         "open" | "tail" | "mic" | "send";
  variant?: "default" | "primary" | "danger";
  needsInput?: boolean;        // opens mic+text dock instead of committing
  inputPlaceholder?: string;
}

// TickerEvent
{
  id: string;
  agent: string;
  agentHue: number;            // oklch hue, e.g. 125 for Scout
  kind: "message" | "work" | "decision" | "artifact";
  label: string;
  time: string;                // HH:MM or HH:MM:SS
  actions?: TickerAction[];    // overrides DEFAULT_TICKER_ACTIONS[kind]
}`}
    </pre>
  );
}
