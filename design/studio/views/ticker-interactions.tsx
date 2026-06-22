"use client";

/**
 * Ticker · Interactions — static exploration.
 *
 * The ticker study is alive (scroll + hover + dock). That makes the
 * interaction states hard to inspect — by the time you've decided to
 * look closely at a chip cluster, the slot has scrolled past or your
 * cursor moved. This study renders the slot card and its interaction
 * states STATICALLY, side by side, so the design can be reviewed as
 * a system: storyboard of the flow, per-kind defaults, dock states.
 *
 * Everything below uses the production primitives (TickerSlotCard,
 * ActionCluster, InputDock) with controlled initial state — no
 * scrolling, no real hover, no motion (besides the SMIL bits inside
 * the dock's recording mic).
 */

import {
  TickerSlotCard,
  tickerSlotWidth,
  type TickerEvent,
} from "@/components/Ticker";
import {
  ActionCluster,
  DEFAULT_STEER_ACTIONS,
  InputDock,
  type SteerAction,
  type SteerKind,
} from "@/components/QuickSteer";

// ── Sample events covering each kind ────────────────────────────────

const E_MESSAGE: TickerEvent = {
  id: "msg",
  agent: "scout",
  agentHue: 125,
  kind: "message",
  label: "@hudson auth?",
  time: "21:18",
};

const E_WORK: TickerEvent = {
  id: "wrk",
  agent: "hudson",
  agentHue: 210,
  kind: "work",
  label: "PR #214 review",
  time: "21:18",
};

const E_DECISION: TickerEvent = {
  id: "dec",
  agent: "qb",
  agentHue: 25,
  kind: "decision",
  label: "flight 0c8f?",
  time: "21:19",
};

const E_ARTIFACT: TickerEvent = {
  id: "art",
  agent: "hudson",
  agentHue: 210,
  kind: "artifact",
  label: "auth.diff",
  time: "21:21",
};

const KIND_EVENTS: Record<SteerKind, TickerEvent> = {
  message: E_MESSAGE,
  work: E_WORK,
  decision: E_DECISION,
  artifact: E_ARTIFACT,
};

const noop = () => {};

// ── Page ────────────────────────────────────────────────────────────

export default function TickerInteractionsPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · ticker · interactions
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Ticker · interactions
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          A static frame-by-frame of the ticker slot under the steer
          behavior — at rest, hovered, chip-focused, dock open, sending,
          flashed. Everything is rendered from the production primitives
          (<code className="font-mono text-[11px] text-studio-ink">TickerSlotCard</code>,{" "}
          <code className="font-mono text-[11px] text-studio-ink">ActionCluster</code>,{" "}
          <code className="font-mono text-[11px] text-studio-ink">InputDock</code>) at
          controlled state, so what you see here is exactly what the live
          ticker would show if you could pause the world.
        </p>
      </header>

      <SectionTitle hint="See it → hover → pick a verb → type a reply → send">
        Storyboard
      </SectionTitle>
      <Storyboard />

      <SectionTitle
        hint="Each kind ships with its own default verbs"
        className="mt-14"
      >
        Default vocabulary per kind
      </SectionTitle>
      <KindGallery />

      <SectionTitle hint="The input dock across its four states" className="mt-14">
        Dock states
      </SectionTitle>
      <DockStates />

      <SectionTitle hint="What every piece is" className="mt-14">
        Anatomy
      </SectionTitle>
      <Anatomy />

      <section className="mt-14 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · how to read this study
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Each cell is a single ticker slot rendered statically with the
          interaction state forced via props. Hovering THIS page does
          not trigger anything — to feel the live behavior, go back to{" "}
          <code className="font-mono text-[11px] text-studio-ink">/studies/ticker</code>.
          This page exists so the design can be inspected as a system
          rather than experienced as a flow.
        </p>
      </section>
    </main>
  );
}

// ── Storyboard — 5-station horizontal flow ──────────────────────────

function Storyboard() {
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="flex min-w-max items-start gap-2">
        <Station caption="1 · at rest" sub="ambient, no interaction">
          <BareSlot evt={E_MESSAGE} />
        </Station>

        <ArrowBetween />

        <Station caption="2 · hovered" sub="cluster appears, scroll pauses">
          <SlotWithCluster evt={E_MESSAGE} keyframeId="sb-hover" />
        </Station>

        <ArrowBetween />

        <Station caption="3 · chip in focus" sub="reply is highlighted">
          <SlotWithCluster
            evt={E_MESSAGE}
            keyframeId="sb-focus"
            highlightActionId="reply"
          />
        </Station>

        <ArrowBetween />

        <Station caption="4 · dock open" sub="reply chip clicked → input field">
          <SlotWithDock
            evt={E_MESSAGE}
            actionId="reply"
            keyframeId="sb-dock"
          />
        </Station>

        <ArrowBetween />

        <Station caption="5 · composed" sub="text in, send is armed">
          <SlotWithDock
            evt={E_MESSAGE}
            actionId="reply"
            keyframeId="sb-compose"
            initialText="approved, ship it"
          />
        </Station>

        <ArrowBetween />

        <Station caption="6 · committed" sub="flash dot, cluster gone">
          <BareSlot evt={E_MESSAGE} showFlash />
        </Station>
      </div>
    </div>
  );
}

function ArrowBetween() {
  return (
    <div className="flex h-[160px] items-center pt-12">
      <svg width={36} height={10} aria-hidden>
        <line x1={0} y1={5} x2={28} y2={5} stroke="var(--studio-ink-faint)" strokeWidth={1} opacity={0.6} />
        <path d="M28 1 L34 5 L28 9" stroke="var(--studio-ink-faint)" strokeWidth={1} fill="none" opacity={0.6} />
      </svg>
    </div>
  );
}

function Station({
  caption,
  sub,
  children,
}: {
  caption: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="relative pt-12">
        {/* Tape-style frame around the slot so it reads as a discrete unit. */}
        <div className="rounded-md border border-studio-edge bg-studio-canvas-alt">
          {children}
        </div>
      </div>
      <div className="max-w-[200px]">
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink">
          {caption}
        </div>
        {sub ? (
          <div className="mt-0.5 font-mono text-[9px] text-studio-ink-faint">
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Kind gallery — slot + default cluster per kind ──────────────────

function KindGallery() {
  const kinds: SteerKind[] = ["message", "work", "decision", "artifact"];
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {kinds.map((k) => (
        <KindCell key={k} kind={k} />
      ))}
    </div>
  );
}

function KindCell({ kind }: { kind: SteerKind }) {
  const evt = KIND_EVENTS[kind];
  const actions = DEFAULT_STEER_ACTIONS[kind];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between font-mono text-[9.5px] uppercase tracking-eyebrow">
        <span className="text-studio-ink">{kind}</span>
        <span className="text-studio-ink-faint">{actions.length} verbs</span>
      </div>
      <div className="relative pt-12">
        <div className="rounded-md border border-studio-edge bg-studio-canvas-alt">
          <SlotWithCluster evt={evt} keyframeId={`kind-${kind}`} />
        </div>
      </div>
      <ul className="m-0 list-none space-y-1 p-0">
        {actions.map((a) => (
          <li key={a.id} className="flex items-baseline gap-2 font-mono text-[10px]">
            <span
              className="uppercase tracking-eyebrow"
              style={{
                color:
                  a.variant === "primary"
                    ? "var(--status-ok-fg)"
                    : a.variant === "danger"
                      ? "var(--status-error-fg)"
                      : "var(--studio-ink)",
              }}
            >
              {a.label.toLowerCase()}
            </span>
            {a.needsInput ? (
              <span className="text-[8.5px] text-studio-ink-faint">⋯ input</span>
            ) : (
              <span className="text-[8.5px] text-studio-ink-faint">instant</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Dock states — four cells side by side ───────────────────────────

function DockStates() {
  return (
    <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
      <DockCell
        caption="empty"
        sub="just opened, focus in input"
        evt={E_MESSAGE}
        actionId="reply"
        keyframeId="ds-empty"
      />
      <DockCell
        caption="typing"
        sub="text present, send armed"
        evt={E_MESSAGE}
        actionId="reply"
        keyframeId="ds-typing"
        initialText="approved, ship it"
      />
      <DockCell
        caption="recording"
        sub="mic active, listening…"
        evt={E_MESSAGE}
        actionId="reply"
        keyframeId="ds-recording"
        initialRecording
      />
      <DockCell
        caption="danger verb"
        sub="reject on a decision (text required)"
        evt={E_DECISION}
        actionId="reject"
        keyframeId="ds-danger"
        initialText="blocked on the migration concern"
      />
    </div>
  );
}

function DockCell({
  caption,
  sub,
  evt,
  actionId,
  keyframeId,
  initialText,
  initialRecording,
}: {
  caption: string;
  sub?: string;
  evt: TickerEvent;
  actionId: string;
  keyframeId: string;
  initialText?: string;
  initialRecording?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink">
          {caption}
        </div>
        {sub ? (
          <div className="mt-0.5 font-mono text-[9px] text-studio-ink-faint">
            {sub}
          </div>
        ) : null}
      </div>
      <div className="relative pt-16">
        <div className="rounded-md border border-studio-edge bg-studio-canvas-alt">
          <SlotWithDock
            evt={evt}
            actionId={actionId}
            keyframeId={keyframeId}
            initialText={initialText}
            initialRecording={initialRecording}
          />
        </div>
      </div>
    </div>
  );
}

// ── Anatomy — labeled callouts ──────────────────────────────────────

function Anatomy() {
  return (
    <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(280px,360px)]">
      <div className="flex justify-center">
        <div className="relative pt-12">
          <div className="rounded-md border border-studio-edge bg-studio-canvas-alt">
            <SlotWithCluster
              evt={E_MESSAGE}
              keyframeId="anat"
              highlightActionId="reply"
            />
          </div>
        </div>
      </div>
      <dl className="m-0 space-y-3 font-mono text-[10.5px]">
        <AnatomyItem letter="A" label="Slot card">
          Glyph (morse-coded by kind) + label + time/@agent. Tab-stop unit.
        </AnatomyItem>
        <AnatomyItem letter="B" label="Chip cluster">
          Glass capsule floating above the slot. Border, blur, drop shadow
          per <code className="text-studio-ink">STEER_GLASS_PANEL</code>.
        </AnatomyItem>
        <AnatomyItem letter="C" label="Action chip">
          24×24 button, single hand-drawn glyph. Hover tints to scout-accent
          (or ok-fg / error-fg per variant). The tiny{" "}
          <span className="text-studio-ink">⋯</span> marks verbs that open
          the dock.
        </AnatomyItem>
        <AnatomyItem letter="D" label="Agent-hue connector">
          1px vertical line in the slot&apos;s agent color, ties the cluster
          to its slot.
        </AnatomyItem>
      </dl>
    </div>
  );
}

function AnatomyItem({
  letter,
  label,
  children,
}: {
  letter: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        aria-hidden
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[9px] font-semibold"
        style={{
          borderColor: "var(--scout-accent)",
          color: "var(--scout-accent)",
        }}
      >
        {letter}
      </span>
      <div className="flex flex-col gap-0.5">
        <dt className="uppercase tracking-eyebrow text-studio-ink">{label}</dt>
        <dd className="font-sans text-[12px] leading-relaxed text-studio-ink-faint">
          {children}
        </dd>
      </div>
    </div>
  );
}

// ── Helpers — slot in various states ────────────────────────────────

function BareSlot({
  evt,
  showFlash = false,
}: {
  evt: TickerEvent;
  showFlash?: boolean;
}) {
  return (
    <div
      className="relative shrink-0"
      style={{ width: `${tickerSlotWidth(evt.kind)}px` }}
    >
      <TickerSlotCard evt={evt} />
      {showFlash ? (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--scout-accent)" }}
        />
      ) : null}
    </div>
  );
}

function SlotWithCluster({
  evt,
  keyframeId,
  highlightActionId,
}: {
  evt: TickerEvent;
  keyframeId: string;
  highlightActionId?: string;
}) {
  const actions = evt.actions ?? DEFAULT_STEER_ACTIONS[evt.kind];
  const color = `oklch(0.74 0.15 ${evt.agentHue})`;
  return (
    <div
      className="relative shrink-0"
      style={{ width: `${tickerSlotWidth(evt.kind)}px` }}
    >
      <ClusterKeyframes id={keyframeId} />
      <TickerSlotCard evt={evt} />
      <ActionCluster
        actions={actions}
        color={color}
        keyframeId={keyframeId}
        onChipClick={noop}
        highlightActionId={highlightActionId}
      />
    </div>
  );
}

function SlotWithDock({
  evt,
  actionId,
  keyframeId,
  initialText,
  initialRecording,
}: {
  evt: TickerEvent;
  actionId: string;
  keyframeId: string;
  initialText?: string;
  initialRecording?: boolean;
}) {
  const actions = evt.actions ?? DEFAULT_STEER_ACTIONS[evt.kind];
  const action = actions.find((a) => a.id === actionId) ?? actions[0];
  const color = `oklch(0.74 0.15 ${evt.agentHue})`;
  return (
    <div
      className="relative shrink-0"
      style={{ width: `${tickerSlotWidth(evt.kind)}px` }}
    >
      <ClusterKeyframes id={keyframeId} />
      <TickerSlotCard evt={evt} />
      <InputDock
        evt={evt}
        action={action as SteerAction}
        color={color}
        keyframeId={keyframeId}
        onSend={noop}
        onCancel={noop}
        initialText={initialText}
        initialRecording={initialRecording}
      />
    </div>
  );
}

/** ActionCluster and InputDock reference a `qs-chip-in-${id}`
 *  keyframe that's normally injected by QuickSteer's `<style>` block.
 *  Outside QuickSteer (in this study) we have to inject it ourselves
 *  so the entrance animation has a name to point at. */
function ClusterKeyframes({ id }: { id: string }) {
  return (
    <style>{`
      @keyframes qs-chip-in-${id} {
        from { opacity: 0; transform: translateX(-50%) translateY(3px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `}</style>
  );
}

// ── Section title (matches the other studies) ───────────────────────

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
        <div className="font-mono text-[10px] text-studio-ink-faint">{hint}</div>
      ) : null}
      <div className="ml-3 h-px flex-1 bg-studio-edge" />
    </div>
  );
}
