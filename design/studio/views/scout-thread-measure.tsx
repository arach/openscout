"use client";

/**
 * Scout Thread Measure — study (macOS Comms thread).
 *
 * The complaint, precisely: a turn does not have *one* right edge. The turn
 * plate and the reply-context bar run the full pane; the body is clamped to a
 * 600pt reading measure; a code block inside the body stops somewhere else
 * again. Three edges stacked vertically, and the eye reads the disagreement as
 * breakage rather than as a column.
 *
 * The tempting fix — "exempt the technical content from the measure" — makes
 * it worse. That is one more edge, not one fewer.
 *
 * So: **one content edge per thread.** Prose, code, plates, headers, rules and
 * metric rows all stop at the same x. What differs between the directions is
 * what the pane does with the remainder, because a measure only reads as
 * deliberate when the leftover is doing something.
 *
 *   00 Today      — the shipped mix, drawn honestly. Baseline, not a proposal.
 *   01 Column     — one edge, centred. Remainder becomes symmetric margin.
 *   02 Marginalia — one edge, left, and the remainder is a reserved gutter.
 *
 * ── On 02: the column is structural, the ink is on demand ────────────
 *
 * Two different questions, and conflating them gets both wrong.
 *
 *   **The column is reserved.** Always there, always the same width, for every
 *   message. A gutter that appeared and vanished per message would put the
 *   thread back to two widths — the exact defect this study opened on, one
 *   level up. Reserving costs nothing: empty space is free.
 *
 *   **The ink is on demand.** A standing column of WHEN · FROM · REF against
 *   every message — including a two-word "Ship it." — is noise wearing the
 *   costume of consistency. It makes the thread louder than the version it
 *   replaced, which is a failure however consistent it is.
 *
 * So: the margin is empty until you hover a turn, and then that turn's
 * marginalia fades up in place. Nothing reflows, because the space was always
 * allocated — the reveal is opacity, never layout. What stays consistent is
 * *where* things appear and *in what order*; what varies is whether you asked.
 *
 * A slot appears when it says something the turn head does not:
 *   FROM     — only when the origin is worth remarking (another device, a
 *              relay, a handoff, system). Not when it is just this app.
 *   REPLY    — when the message answers a specific earlier one.
 *   READOUT  — when the turn did work worth counting.
 *   FILES    — when it touched files.
 *   ATTACHED — when something came with it.
 *
 * Deliberately not slots: the timestamp (already in the turn head) and the
 * message id (inspector material, not marginalia).
 *
 * Keyboard parity is not optional in this app — the *selected* turn reveals
 * its marginalia the same way hover does, so the whole affordance is reachable
 * from j/k. Toggle "selected" below to see it.
 *
 * Below ~1100pt there is no margin to reveal into, so the same slots reveal
 * inline beneath the turn instead. One place the renderer carries two layouts.
 *
 * Ports to: apps/macos/Sources/Scout/ScoutCommsView.swift (ScoutCommsMetrics)
 * + the turn rows in ScoutRootView.swift.
 */

import { useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";

/* ────────────────────────────────────────────────────────────────────
   §1  Metrics.

   `messageBubbleMaxWidth = 840` exists in the Swift today, is documented
   as "the outer limit … we constrain the prose inside it", and is
   referenced nowhere. Only the 600 ever shipped, which is why the plate
   the comment describes is missing from the window.
   ──────────────────────────────────────────────────────────────────── */

const SHIPPED_MEASURE = 600;
/** One edge for everything in 01. ~72ch at 13pt — a measure, but an honest one. */
const COLUMN = 780;
const GUTTER = 268;
const GUTTER_GAP = 32;
/** Below this the gutter folds back into the body. */
const GUTTER_MIN_PANE = 1100;

const PANES = [
  { w: 1600, label: "1600 · large display" },
  { w: 1240, label: "1240 · your window" },
  { w: 980, label: "980 · narrow" },
];

type TreatmentId = "today" | "column" | "marginalia";

const TREATMENTS: { id: TreatmentId; label: string; note: string }[] = [
  {
    id: "today",
    label: "00 · Today",
    note: "Three edges in one turn: plate at pane, body at 600, code somewhere else.",
  },
  {
    id: "column",
    label: "01 · Column",
    note: "One edge, centred. The remainder becomes margin and reads as composition.",
  },
  {
    id: "marginalia",
    label: "02 · Reveal",
    note: "One edge, left. The margin is reserved and empty — hover a turn and its marginalia fades up. Nothing reflows.",
  },
];

/* ────────────────────────────────────────────────────────────────────
   §2  Content.

   Four messages, deliberately uneven: a plain operator line with almost
   no body, a rich agent turn, a one-line status, and a short reply. If
   the gutter only works on the rich one, the design has failed.
   ──────────────────────────────────────────────────────────────────── */

type Block =
  | { t: "p"; v: string }
  | { t: "ledger"; v: string[] }
  | { t: "files"; v: string[] };

/**
 * One line per slot, always.
 *
 * The first pass stacked label over value, which made a four-slot gutter
 * ~200pt tall — taller than a two-line message. Since the row height is
 * max(body, gutter), short messages with rich metadata got stretched and the
 * thread went ragged again, vertically this time. Label left at a fixed width,
 * value right and truncating, keeps the gutter shorter than the body it
 * annotates in every case that matters.
 */
interface Slot {
  label: string;
  value: string;
  /** Backed by a real field today, or a gap to close. See the notes. */
  backed: boolean;
  mono?: boolean;
  accent?: boolean;
}

interface Msg {
  who: string;
  time: string;
  agent?: boolean;
  plate?: boolean;
  blocks: Block[];
  slots: Slot[];
}

/**
 * Fixed slot order. Absent slots are skipped; present slots never move.
 * No WHEN (the turn head already says it) and no REF (inspector material) —
 * a slot that repeats what is already on screen is the noise, not the signal.
 */
const SLOT_ORDER = ["From", "Reply", "Readout", "Files", "Attached"];

const MESSAGES: Msg[] = [
  {
    who: "Arach",
    time: "1h",
    blocks: [
      {
        t: "p",
        v: "That looks good. can you work a little bit on the new thread created or new task created kind of work in progress view meaning the current working thing is just like one little animation.",
      },
    ],
    // Sent from the phone while the reader is on the Mac — worth remarking.
    slots: [
      { label: "From", value: "iOS · Scout", backed: true },
      { label: "Attached", value: "1 image", backed: true },
    ],
  },
  {
    who: "Faraday",
    time: "41m",
    agent: true,
    plate: true,
    blocks: [
      {
        t: "p",
        v: "Built it — the working turn now shows a live step ledger instead of a pulse. Verified against a real running turn, not a mock.",
      },
      {
        t: "ledger",
        v: [
          "Edit chat/ConversationScreen.tsx success 2m",
          "bash bun test client/screens/chat/ success 1m",
        ],
      },
      {
        t: "p",
        v: "Source is the Tail firehose (sub-second, tool name + arg + outcome intact), with your observe poll as the fallback for sessions this host can't tail. Rows are one-per-action: tool results fold into the call above them as an outcome.",
      },
      {
        t: "files",
        v: [
          "packages/web/client/screens/chat/turn-steps.ts",
          "packages/web/client/screens/chat/use-turn-steps.ts",
        ],
      },
    ],
    slots: [
      { label: "From", value: "claude · session-msdng1", backed: true, mono: true },
      { label: "Reply", value: "That looks good. can you…", backed: true },
      { label: "Readout", value: "24 tools · 5 thinking · 2m14s", backed: false, mono: true },
      { label: "Files", value: "turn-steps.ts +1", backed: false, mono: true, accent: true },
    ],
  },
  {
    who: "Scout",
    time: "38m",
    blocks: [{ t: "p", v: "Session session-msdng1 went idle." }],
    slots: [{ label: "From", value: "system · session watch", backed: true }],
  },
  {
    // Nothing to say about this one. Empty margin is the correct outcome —
    // the column still holds the edge, the silence holds the calm.
    who: "Arach",
    time: "12m",
    blocks: [{ t: "p", v: "Nice. Ship it." }],
    slots: [],
  },
];

/* ────────────────────────────────────────────────────────────────────
   §3  Shell
   ──────────────────────────────────────────────────────────────────── */

export default function ScoutThreadMeasureStudy() {
  const [treatment, setTreatment] = useState<TreatmentId>("marginalia");
  const [pane, setPane] = useState(1240);
  const [edges, setEdges] = useState(false);
  /** Stands in for the j/k cursor: the selected turn reveals like a hovered one. */
  const [selected, setSelected] = useState<number | null>(null);
  const active = TREATMENTS.find((t) => t.id === treatment)!;

  return (
    <ScoutStudyShell
      pageId="scout-thread-measure"
      title="Thread Measure"
      blurb={
        <>
          A turn currently has three right edges — plate at the pane, body at
          600pt, code somewhere else again — and the eye reads the disagreement
          as breakage. Every direction enforces{" "}
          <b>one content edge per thread</b>. In 02 the margin is{" "}
          <b>reserved but empty</b>: hover a turn and its marginalia fades up in
          place. The column holds the edge so nothing reflows; the silence keeps
          the thread quiet until you ask.
        </>
      }
    >
      {() => (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md border border-studio-edge p-0.5">
              {TREATMENTS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTreatment(t.id)}
                  className={`rounded-[5px] px-3 py-1.5 font-mono text-sm font-semibold transition-colors ${
                    treatment === t.id
                      ? "bg-studio-surface text-studio-ink"
                      : "text-studio-ink-faint hover:text-studio-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-md border border-studio-edge p-0.5">
              {PANES.map((p) => (
                <button
                  key={p.w}
                  type="button"
                  onClick={() => setPane(p.w)}
                  className={`rounded-[5px] px-2.5 py-1.5 font-mono text-2xs transition-colors ${
                    pane === p.w
                      ? "bg-studio-surface text-studio-ink"
                      : "text-studio-ink-faint hover:text-studio-ink"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setEdges((v) => !v)}
              className={`rounded-md border px-3 py-1.5 font-mono text-2xs uppercase tracking-eyebrow transition-colors ${
                edges
                  ? "border-rose-500/50 text-rose-500"
                  : "border-studio-edge text-studio-ink-faint hover:text-studio-ink"
              }`}
            >
              {edges ? "edges on" : "edges off"}
            </button>

            {treatment === "marginalia" ? (
              <button
                type="button"
                onClick={() => setSelected((s) => (s === 1 ? null : 1))}
                className={`rounded-md border px-3 py-1.5 font-mono text-2xs uppercase tracking-eyebrow transition-colors ${
                  selected !== null
                    ? "border-emerald-500/50 text-emerald-600"
                    : "border-studio-edge text-studio-ink-faint hover:text-studio-ink"
                }`}
              >
                {selected !== null ? "turn selected" : "select a turn (j/k)"}
              </button>
            ) : null}
          </div>

          <p className="font-sans text-sm text-studio-ink-faint">{active.note}</p>

          <div
            className="overflow-x-auto rounded-[10px] p-6"
            style={{ background: "var(--s-bg)", border: "1px solid var(--s-hairline)" }}
          >
            <div style={{ width: pane, fontFamily: "var(--s-font-sans)" }}>
              <PaneHeader pane={pane} />
              {treatment === "today" ? <TodayThread pane={pane} edges={edges} /> : null}
              {treatment === "column" ? <ColumnThread edges={edges} /> : null}
              {treatment === "marginalia" ? (
                <MarginaliaThread pane={pane} edges={edges} selected={selected} />
              ) : null}
            </div>
          </div>

          <Notes treatment={treatment} pane={pane} />
        </div>
      )}
    </ScoutStudyShell>
  );
}

function PaneHeader({ pane }: { pane: number }) {
  return (
    <div
      className="mb-4 flex items-baseline gap-3 pb-3"
      style={{ borderBottom: "1px solid var(--s-hairline)" }}
    >
      <span className="text-[15px] font-semibold" style={{ color: "var(--s-ink)" }}>
        Openscout
      </span>
      <span className="font-mono text-[10px]" style={{ color: "var(--s-dim)" }}>
        openscout · codex/delivery-campaign-source · session-msdng1
      </span>
      <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--s-dim)" }}>
        pane {pane}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §4  00 — Today. Drawn from the shipped constraints, so the baseline
       is an observation rather than a strawman.
   ──────────────────────────────────────────────────────────────────── */

function TodayThread({ pane, edges }: { pane: number; edges: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      {MESSAGES.map((m, i) =>
        m.plate ? (
          <Edged key={i} edges={edges} width={pane} label="pane" tone="warn">
            <div className="rounded-[11px] px-4 py-3" style={{ background: "var(--s-accent-soft)" }}>
              <Edged edges={edges} width={pane - 32} label="pane" tone="warn">
                <ReplyBar text="That looks good. can you work a little bit on the new thread c…" />
              </Edged>
              <div className="mt-2 flex gap-4">
                <Avatar who={m.who} />
                <div className="min-w-0 flex-1">
                  <TurnHead who={m.who} time={m.time} />
                  <Edged edges={edges} width={SHIPPED_MEASURE} label="600">
                    <Body blocks={m.blocks} />
                  </Edged>
                </div>
              </div>
            </div>
          </Edged>
        ) : (
          <div key={i} className="flex gap-4">
            <Avatar who={m.who} />
            <div className="min-w-0 flex-1">
              <TurnHead who={m.who} time={m.time} />
              <Edged edges={edges} width={SHIPPED_MEASURE} label="600">
                <Body blocks={m.blocks} />
              </Edged>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §5  01 — Column. One edge, centred.
   ──────────────────────────────────────────────────────────────────── */

function ColumnThread({ edges }: { edges: boolean }) {
  return (
    <div className="flex justify-center">
      <Edged edges={edges} width={COLUMN} label="780">
        <div className="flex flex-col gap-5">
          {MESSAGES.map((m, i) => (
            <Plate key={i} on={m.plate}>
              {m.plate ? (
                <ReplyBar text="That looks good. can you work a little bit on the new thread c…" />
              ) : null}
              <div className={m.plate ? "mt-2 flex gap-4" : "flex gap-4"}>
                <Avatar who={m.who} />
                <div className="min-w-0 flex-1">
                  <TurnHead who={m.who} time={m.time} />
                  <Body blocks={m.blocks} />
                </div>
              </div>
            </Plate>
          ))}
        </div>
      </Edged>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §6  02 — Marginalia. One edge, left; the remainder is reserved.

   Every message gets the gutter at the same width — the plain "Ship it."
   included. That is the difference between a column and a decoration: a
   gutter that came and went would put the thread back to two widths, the
   exact defect this study opened on.
   ──────────────────────────────────────────────────────────────────── */

function MarginaliaThread({
  pane,
  edges,
  selected,
}: {
  pane: number;
  edges: boolean;
  selected: number | null;
}) {
  const showGutter = pane >= GUTTER_MIN_PANE;
  const body = showGutter ? pane - GUTTER - GUTTER_GAP : pane;
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <Edged edges={edges} width={pane} label="pane">
      <div className="flex flex-col gap-5">
        {MESSAGES.map((m, i) => {
          const lit = hovered === i || selected === i;
          return (
            <div
              key={i}
              className="flex"
              style={{ gap: GUTTER_GAP }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
            >
              <div style={{ width: body }}>
                <Edged edges={edges} width={body} label="body">
                  <Plate on={m.plate}>
                    <div className="flex gap-4">
                      <Avatar who={m.who} />
                      <div className="min-w-0 flex-1">
                        <TurnHead who={m.who} time={m.time} />
                        <Body blocks={m.blocks} />
                        {/* No margin to reveal into down here, so the same
                            slots reveal inline instead. Height is reserved
                            either way — the row must not jump on hover. */}
                        {!showGutter ? <InlineSlots slots={m.slots} lit={lit} /> : null}
                      </div>
                    </div>
                  </Plate>
                </Edged>
              </div>

              {showGutter ? (
                <div style={{ width: GUTTER }} className="pt-1">
                  <Gutter slots={m.slots} lit={lit} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Edged>
  );
}

/** Slots in canonical order. Absent slots skip; present slots never move. */
function orderedSlots(slots: Slot[]): Slot[] {
  return SLOT_ORDER.map((label) => slots.find((s) => s.label === label)).filter(
    (s): s is Slot => Boolean(s),
  );
}

/**
 * The reveal. Opacity and a 6pt settle, never layout — the slots occupy their
 * space whether lit or not, so nothing on the page moves when the pointer
 * crosses a turn. The per-slot delay is what makes it read as *developing*
 * rather than *switching on*; 22ms is enough to sense and too small to wait for.
 */
function Gutter({ slots, lit }: { slots: Slot[]; lit: boolean }) {
  const rows = orderedSlots(slots);
  return (
    <div className="flex flex-col">
      {rows.map((s, i) => (
        <div
          key={s.label}
          className="flex items-baseline gap-2 py-[1px]"
          style={{
            opacity: lit ? 1 : 0,
            transform: lit ? "none" : "translateX(-6px)",
            transition: "opacity 140ms ease, transform 140ms ease",
            transitionDelay: lit ? `${i * 22}ms` : "0ms",
          }}
        >
          <span
            className="w-[52px] flex-none font-mono text-[9px] uppercase tracking-[0.12em]"
            style={{ color: "var(--s-dim)" }}
          >
            {s.label}
          </span>
          <span
            className={`min-w-0 truncate ${s.mono ? "font-mono text-[10.5px]" : "text-[11px]"}`}
            style={{ color: s.accent ? "var(--s-accent)" : "var(--s-ink)" }}
            title={s.value}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The fold-back. Same slots, same order, same reveal — one line, wrapped. */
function InlineSlots({ slots, lit }: { slots: Slot[]; lit: boolean }) {
  const rows = orderedSlots(slots);
  if (rows.length === 0) return null;
  return (
    <div
      className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-2"
      style={{
        borderTop: "1px solid var(--s-hairline)",
        opacity: lit ? 1 : 0,
        transition: "opacity 140ms ease",
      }}
    >
      {rows.map((s) => (
        <span key={s.label} className="flex items-baseline gap-1.5">
          <span
            className="font-mono text-[9px] uppercase tracking-[0.12em]"
            style={{ color: "var(--s-dim)" }}
          >
            {s.label}
          </span>
          <span
            className="font-mono text-[10px]"
            style={{ color: s.accent ? "var(--s-accent)" : "var(--s-muted)" }}
          >
            {s.value}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §7  Shared pieces
   ──────────────────────────────────────────────────────────────────── */

function Plate({ on, children }: { on?: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="rounded-[11px] px-4 py-3" style={{ background: "var(--s-accent-soft)" }}>
      {children}
    </div>
  );
}

function Body({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((blk, i) => {
        if (blk.t === "p") return <Prose key={i}>{blk.v}</Prose>;
        if (blk.t === "ledger") return <Ledger key={i} rows={blk.v} />;
        return <FileLinks key={i} files={blk.v} />;
      })}
    </div>
  );
}

function Avatar({ who }: { who: string }) {
  return (
    <span
      className="mt-[2px] grid h-[28px] w-[28px] flex-none place-items-center rounded-[8px] font-mono text-[11px] font-bold"
      style={{ background: "var(--s-surface)", color: "var(--s-muted)" }}
    >
      {who.charAt(0)}
    </span>
  );
}

function TurnHead({ who, time }: { who: string; time: string }) {
  return (
    <div className="mb-1 flex items-baseline gap-2">
      <span className="text-[12px] font-semibold" style={{ color: "var(--s-ink)" }}>
        {who}
      </span>
      <span className="font-mono text-[10px]" style={{ color: "var(--s-dim)" }}>
        {time}
      </span>
    </div>
  );
}

function ReplyBar({ text }: { text: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-[6px] px-2 py-1 font-mono text-[10px]"
      style={{ background: "var(--s-surface)", color: "var(--s-dim)" }}
    >
      <span>↩ REPLY TO</span>
      <span className="truncate">{text}</span>
    </div>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] leading-relaxed" style={{ color: "var(--s-ink)" }}>
      {children}
    </p>
  );
}

function Ledger({ rows }: { rows: string[] }) {
  return (
    <div className="flex flex-col gap-[3px]">
      {rows.map((r) => (
        <div
          key={r}
          className="truncate rounded-[3px] px-1.5 py-[2px] font-mono text-[11px]"
          style={{ background: "var(--s-surface)", color: "var(--s-ink)" }}
        >
          {r}
        </div>
      ))}
    </div>
  );
}

function FileLinks({ files }: { files: string[] }) {
  return (
    <div className="flex flex-col">
      {files.map((f) => (
        <span key={f} className="truncate font-mono text-[11px]" style={{ color: "var(--s-accent)" }}>
          {f}
        </span>
      ))}
    </div>
  );
}

function Edged({
  edges,
  width,
  label,
  tone,
  children,
}: {
  edges: boolean;
  width: number;
  label: string;
  tone?: "warn";
  children: React.ReactNode;
}) {
  const color = tone === "warn" ? "rgb(244 63 94 / 0.85)" : "rgb(244 63 94 / 0.45)";
  return (
    <div className="relative" style={{ width, maxWidth: "100%" }}>
      {children}
      {edges ? (
        <>
          <span
            className="pointer-events-none absolute inset-y-0 right-0"
            style={{ width: 1, background: color }}
          />
          <span
            className="pointer-events-none absolute right-0 top-0 translate-x-[calc(100%+4px)] font-mono text-[9px]"
            style={{ color }}
          >
            {label}
          </span>
        </>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §8  Notes
   ──────────────────────────────────────────────────────────────────── */

function Notes({ treatment, pane }: { treatment: TreatmentId; pane: number }) {
  if (treatment === "today") {
    return (
      <NoteGrid>
        <Note title="Three edges, one turn">
          The plate and the reply bar run the full pane. The body stops at 600.
          Turn <b>edges</b> on and the guides land in three different places
          inside a single card — that disagreement is what reads as broken, not
          the narrowness itself.
        </Note>
        <Note title="The half-built rule">
          <code>messageBubbleMaxWidth = 840</code> is declared in{" "}
          <code>ScoutCommsMetrics</code>, documented as the outer plate the prose
          sits inside, and referenced nowhere in the codebase. The two-tier
          system the comment describes was never wired, so one clamp is doing
          both jobs badly.
        </Note>
        <Note title="Why exempting code makes it worse">
          The obvious fix — let technical content ignore the measure — adds a
          fourth edge. Prose at 600 beside a code block at the pane is more
          ragged, not less. Whatever the measure is, everything shares it.
        </Note>
      </NoteGrid>
    );
  }

  if (treatment === "column") {
    return (
      <NoteGrid>
        <Note title="One seam">
          Plate, reply bar, prose, ledger and links all stop at 780. With{" "}
          <b>edges</b> on there is a single guide, which is the point — the turn
          has a shape instead of a silhouette.
        </Note>
        <Note title="Centred, so the remainder reads as margin">
          Left-aligning a narrow column against a wide pane makes the leftover
          look like something failed to fill. Splitting it either side makes the
          same pixels read as composition.
        </Note>
        <Note title="Where it runs out">
          On a 1600pt pane it is a 780pt column with 400pt of nothing on each
          side. That is calm, but it is also the argument for 02 — the space is
          balanced rather than used.
        </Note>
      </NoteGrid>
    );
  }

  return (
    <NoteGrid>
      <Note title="The column is structure, the ink is on demand">
        Reserving the margin costs nothing — empty space is free — and it is
        what keeps every turn on one edge. Filling it on every message is what
        would make the thread louder than the version it replaced. So it is
        allocated always and inked only on hover or selection; the reveal is
        opacity and a 6pt settle, never layout, so nothing moves under the
        pointer.
      </Note>
      <Note title="Slots earn their place">
        FROM · REPLY · READOUT · FILES · ATTACHED, in that order — absent slots
        skip, present slots never move. No WHEN and no REF: the turn head
        already carries the time, and the message id is inspector material. A
        slot repeating what is already on screen is the noise, not the signal.
        &ldquo;Nice. Ship it.&rdquo; reveals nothing, which is correct.
        {pane < GUTTER_MIN_PANE ? (
          <>
            {" "}
            At {pane}pt there is no margin to reveal into, so the same slots
            reveal inline beneath the turn instead.
          </>
        ) : null}
      </Note>
      <Note title="What's backed, and what isn't">
        <b>Backed today:</b> FROM (<code>metadata.originSurface</code> /{" "}
        <code>source</code>), REPLY (<code>replyToMessageId</code>), ATTACHED (
        <code>attachments</code>). <b>Not backed:</b> READOUT is live-turn-only
        (<code>ScoutActiveTurn.activity</code>{" "}
        does not persist onto the finished message) and FILES has no field at
        all — it would come from tool events or body parsing. Those two reveal
        empty or don&rsquo;t ship.
      </Note>
    </NoteGrid>
  );
}

function NoteGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-3">{children}</div>;
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-studio-edge p-4">
      <div className="font-mono text-2xs font-bold uppercase tracking-eyebrow text-studio-ink-faint">
        {title}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-studio-ink-muted">{children}</p>
    </div>
  );
}
