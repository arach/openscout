"use client";

/**
 * Scout Keyboard Sheet — study (macOS `?` overlay).
 *
 * The shipped sheet is *organised* but not designed: two columns of
 * equal-weight key/description rows, every cap the same box, hierarchy
 * carried entirely by two coloured labels. It reads as a spec table.
 *
 * The design problem underneath it is not decoration. Scout's keyboard has
 * **two grammars**:
 *
 *     ⌘N     — simultaneous. Hold, strike, release. One gesture.
 *     g c    — sequential.   Strike, release, strike. Two gestures.
 *
 * The shipped sheet draws them identically — same cap, same box, same
 * spacing — so it cannot teach the one thing that is actually new. Worse, it
 * crams whole phrases into a single cap (`⌥⌘1 2 3`, `↵ · ⇧↵`, `g g · ⇧G`),
 * which breaks the key metaphor exactly where precision matters most.
 *
 * Every treatment below encodes simultaneity in form:
 *
 *     simultaneous → caps butt together, 2px, read as one object
 *     sequential   → caps separated, with the beat drawn between them
 *
 * Three directions, same content, same data:
 *
 *   01 Instrument — flat. No boxes at all. Keys are bright mono ink on the
 *      plane, right-aligned into a seam so every description starts on one
 *      line. Structure from hairlines and rhythm. The house Instrument
 *      language, applied to a keyboard.
 *
 *   02 Rail — the sheet as a picture of the app. The GO half is literally
 *      the rail at rail metrics; the jump strip is literally the list.
 *      Teaches *location*, not just letters.
 *
 *   03 Keycap — commit to the physical metaphor and do it properly: one key
 *      per cap, real cap geometry, modifiers visually subordinate to the
 *      letter they modify. The tactile counterpoint to 01.
 *
 * Ports to: apps/macos/Sources/Scout/ScoutKeyboardCheatsheet.swift.
 * Grammar + bindings: /studies/scout-keyboard-nav.
 */

import { useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";

/* ────────────────────────────────────────────────────────────────────
   §1  Data — one shape for every treatment.

   `seq` is an array of *beats*; each beat is the set of keys held down
   together for that beat. So ⌘N is one beat of two keys, and `g c` is
   two beats of one key. Every treatment reads this and draws the beat
   boundary its own way; none of them can accidentally render a chord as
   a combo, because the difference is in the data.
   ──────────────────────────────────────────────────────────────────── */

interface Binding {
  seq: string[][];
  desc: string;
}

const b = (seq: string[][], desc: string): Binding => ({ seq, desc });

const SECTIONS = [
  { id: "comms", label: "Comms", chord: "c", icon: IconBubble },
  { id: "agents", label: "Projects", chord: "p", icon: IconFolder },
  { id: "terminals", label: "Terminals", chord: "t", icon: IconTerminal },
  { id: "tail", label: "Tail", chord: "f", icon: IconPulse },
  { id: "dispatch", label: "Dispatch", chord: "d", icon: IconSend },
  { id: "lanes", label: "Lanes", chord: "l", icon: IconLanes },
  { id: "repos", label: "Repos", chord: "r", icon: IconBranch },
  { id: "code", label: "Code", chord: "e", icon: IconCode },
  { id: "settings", label: "Settings", chord: "s", icon: IconGear },
] as const;

const EXTRAS = [
  { chord: "g", label: "top of list" },
  { chord: "b", label: "back" },
] as const;

/** Split out of the crammed rows the shipped sheet used. */
const HERE: Binding[] = [
  b([["⌘", "N"]], "new chat"),
  b([["⌘", "K"]], "focus search"),
  b([["⌘", "L"]], "focus composer"),
  b([["⌘", "V"]], "paste image"),
  b([["↵"]], "send"),
  b([["⇧", "↵"]], "newline"),
];

const FILTERS: Binding[] = [
  b([["⌥", "⌘", "1"]], "all"),
  b([["⌥", "⌘", "2"]], "direct"),
  b([["⌥", "⌘", "3"]], "shared"),
];

const MOVE: Binding[] = [
  b([["j"]], "next"),
  b([["k"]], "previous"),
  b([["⌘", "↓"]], "next, while typing"),
  b([["g"], ["g"]], "first row"),
  b([["⇧", "G"]], "last row"),
  b([["↵"]], "open selection"),
  b([["esc"]], "leave the composer"),
];

const ACTIVE = "comms";

/* ────────────────────────────────────────────────────────────────────
   §2  Shell
   ──────────────────────────────────────────────────────────────────── */

type TreatmentId = "instrument" | "rail" | "keycap";

const TREATMENTS: { id: TreatmentId; label: string; note: string }[] = [
  {
    id: "instrument",
    label: "01 · Instrument",
    note: "Flat, boxless, right-aligned into a seam. The house language.",
  },
  {
    id: "rail",
    label: "02 · Rail",
    note: "The sheet as a picture of the app — rail metrics, list metrics.",
  },
  {
    id: "keycap",
    label: "03 · Keycap",
    note: "The physical metaphor, done properly. One key per cap.",
  },
];

export default function ScoutKeyboardSheetStudy() {
  const [treatment, setTreatment] = useState<TreatmentId>("instrument");
  const active = TREATMENTS.find((t) => t.id === treatment)!;

  return (
    <ScoutStudyShell
      pageId="scout-keyboard-sheet"
      title="Keyboard Sheet"
      blurb={
        <>
          The <b>?</b> overlay, designed rather than tabulated. Scout&rsquo;s
          keyboard has two grammars — <b>⌘N</b> is simultaneous,{" "}
          <b>g c</b> is sequential — and the shipped sheet draws them
          identically. All three directions below encode the difference in
          form.
        </>
      }
    >
      {() => (
        <div className="flex flex-col gap-6">
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
            <p className="font-sans text-sm text-studio-ink-faint">{active.note}</p>
          </div>

          <Backdrop>
            {treatment === "instrument" ? <InstrumentSheet /> : null}
            {treatment === "rail" ? <RailSheet /> : null}
            {treatment === "keycap" ? <KeycapSheet /> : null}
          </Backdrop>

          <GrammarNote />
        </div>
      )}
    </ScoutStudyShell>
  );
}

/** The dimmed app plane the sheet floats over, so contrast reads honestly. */
function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center rounded-[10px] px-6 py-12"
      style={{
        background: "var(--s-bg)",
        border: "1px solid var(--s-hairline)",
        fontFamily: "var(--s-font-sans)",
      }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §3  Treatment 01 — Instrument.

   No cap boxes anywhere. A key is bright mono ink; a description is
   muted sans. The keys right-align into a single vertical seam so the
   eye scans one column of shapes and one column of language, instead of
   zig-zagging across ragged boxes. Beats are separated by a hairline
   tick — the pause, drawn.
   ──────────────────────────────────────────────────────────────────── */

function InstrumentSheet() {
  return (
    <Sheet width={620}>
      <SheetHead />

      <div className="px-6 pb-5 pt-4">
        {/* Three columns, row-major: reading left to right walks the rail in
            order and fills the band edge to edge. Two columns left a void down
            the middle wide enough to read as a gutter that meant something. */}
        <Band
          label="Go"
          hint={
            <>
              press
              <span>
                <span className="font-bold" style={{ color: "var(--s-accent)" }}>
                  g
                </span>
                ,
              </span>
              then
            </>
          }
        >
          <div className="grid grid-cols-3 gap-x-5 gap-y-[1px]">
            {SECTIONS.map((s) => (
              <InstrumentGoRow key={s.id} chord={s.chord} label={s.label} active={s.id === ACTIVE} />
            ))}
            {EXTRAS.map((e) => (
              <InstrumentGoRow key={e.chord} chord={e.chord} label={e.label} muted />
            ))}
          </div>
        </Band>

        <BandRule />

        <Band label="Jump" hint="hold ⌘">
          <div className="flex items-baseline gap-3">
            <div className="flex items-baseline gap-[7px]">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <span
                  key={n}
                  className="font-mono text-[13px] font-bold"
                  style={{ color: "var(--s-accent)" }}
                >
                  {n}
                </span>
              ))}
            </div>
            <span className="text-[12px]" style={{ color: "var(--s-muted)" }}>
              the nine most recent chats — fires from inside the composer
            </span>
          </div>
        </Band>

        <BandRule />

        <div className="grid grid-cols-2 gap-x-8">
          <Band label="Comms" hint="here" accentLabel>
            {HERE.map((k) => (
              <InstrumentRow key={k.desc} binding={k} />
            ))}
            <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--s-hairline)" }}>
              {FILTERS.map((k) => (
                <InstrumentRow key={k.desc} binding={k} />
              ))}
            </div>
          </Band>

          <Band label="Move" hint="any list">
            {MOVE.map((k) => (
              <InstrumentRow key={k.desc} binding={k} />
            ))}
          </Band>
        </div>
      </div>
    </Sheet>
  );
}

function InstrumentGoRow({
  chord,
  label,
  active,
  muted,
}: {
  chord: string;
  label: string;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 py-[2px]">
      <span
        className="w-[10px] flex-none text-right font-mono text-[13px] font-bold"
        style={{ color: active ? "var(--s-accent)" : muted ? "var(--s-dim)" : "var(--s-ink)" }}
      >
        {chord}
      </span>
      <span
        className="text-[12px]"
        style={{
          color: active ? "var(--s-ink)" : muted ? "var(--s-dim)" : "var(--s-muted)",
          fontWeight: active ? 600 : 400,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * The seam: keys right-aligned in a fixed gutter, descriptions left-aligned
 * after it. One column of shapes, one column of language. Routes through
 * `Beats` like every other treatment, so the flat rendering can't quietly
 * lose the beat boundary or the modifier's subordinate ink.
 */
function InstrumentRow({ binding }: { binding: Binding }) {
  return (
    <div className="flex items-center gap-3 py-[2px]">
      <span className="flex w-[64px] flex-none items-center justify-end">
        <Beats binding={binding} tone="flat" />
      </span>
      <span className="text-[12px]" style={{ color: "var(--s-muted)" }}>
        {binding.desc}
      </span>
    </div>
  );
}

function Band({
  label,
  hint,
  accentLabel,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  accentLabel?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span
          className="font-mono text-[9px] font-bold uppercase tracking-[0.18em]"
          style={{ color: accentLabel ? "var(--s-accent)" : "var(--s-ink)" }}
        >
          {label}
        </span>
        {/* Lowercase: the hint is prose, not a label, and uppercasing it ate
            the one thing it exists to name — the `g` you actually press. */}
        {hint ? (
          <span
            className="flex items-baseline gap-1 font-mono text-[9.5px] tracking-[0.06em]"
            style={{ color: "var(--s-dim)" }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function BandRule() {
  return <div style={{ height: 1, background: "var(--s-hairline)" }} />;
}

/* ────────────────────────────────────────────────────────────────────
   §4  Treatment 02 — Rail.

   The left half is not a list of destinations, it *is* the rail: chrome
   fill, 26pt rows, icon then letter then name, active row lit exactly as
   the app lights it. The jump strip below is not a description of the
   conversation list, it is nine numbered tiles in a row. The sheet
   becomes a diagram of the window the user is already looking at.
   ──────────────────────────────────────────────────────────────────── */

function RailSheet() {
  return (
    <Sheet width={640}>
      <SheetHead />

      <div className="flex">
        <div
          className="w-[190px] flex-none px-2 py-3"
          style={{ background: "var(--s-chrome)", borderRight: "1px solid var(--s-hairline)" }}
        >
          <div className="mb-2 flex items-center justify-between gap-2 px-1.5">
            <span
              className="font-mono text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ color: "var(--s-ink)" }}
            >
              Go
            </span>
            <span
              className="flex items-center gap-1.5 font-mono text-[9px] lowercase"
              style={{ color: "var(--s-dim)" }}
            >
              press <Cap>g</Cap> then
            </span>
          </div>
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = s.id === ACTIVE;
            return (
              <div
                key={s.id}
                className="flex h-[26px] items-center gap-2 rounded-[5px] px-1.5"
                style={{ background: active ? "var(--s-surface)" : "transparent" }}
              >
                <span
                  className="grid h-[16px] w-[16px] flex-none place-items-center"
                  style={{ color: active ? "var(--s-accent)" : "var(--s-dim)" }}
                >
                  <Icon />
                </span>
                {/* The letter is what the sheet is consulted for; the name is
                    the context that lets you find it. Drawing the name at full
                    ink and the letter at dim — as the shipped sheet did —
                    inverts exactly the thing being looked up. */}
                <span
                  className="flex-1 text-[12px]"
                  style={{
                    color: active ? "var(--s-ink)" : "var(--s-muted)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {s.label}
                </span>
                <span
                  className="font-mono text-[13px] font-bold"
                  style={{ color: active ? "var(--s-accent)" : "var(--s-ink)" }}
                >
                  {s.chord}
                </span>
              </div>
            );
          })}
          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--s-hairline)" }}>
            {EXTRAS.map((e) => (
              <div key={e.chord} className="flex h-[22px] items-center gap-2 px-1.5">
                <span className="w-[16px] flex-none" />
                <span className="flex-1 text-[12px]" style={{ color: "var(--s-dim)" }}>
                  {e.label}
                </span>
                <span className="font-mono text-[12px] font-bold" style={{ color: "var(--s-dim)" }}>
                  {e.chord}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 px-5 py-3">
          <ColumnLabel accent>Comms — here</ColumnLabel>
          <div className="mt-1.5 grid grid-cols-2 gap-x-5">
            <div>
              {HERE.slice(0, 3).map((k) => (
                <RailRow key={k.desc} binding={k} />
              ))}
            </div>
            <div>
              {HERE.slice(3).map((k) => (
                <RailRow key={k.desc} binding={k} />
              ))}
            </div>
          </div>

          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--s-hairline)" }}>
            <ColumnLabel>Move — any list</ColumnLabel>
            <div className="mt-1.5 grid grid-cols-2 gap-x-5">
              <div>
                {MOVE.slice(0, 4).map((k) => (
                  <RailRow key={k.desc} binding={k} />
                ))}
              </div>
              <div>
                {MOVE.slice(4).map((k) => (
                  <RailRow key={k.desc} binding={k} />
                ))}
                {FILTERS.slice(0, 1).map((k) => (
                  <RailRow key={k.desc} binding={b([["⌥", "⌘", "1–3"]], "filter chats")} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The jump strip — nine tiles, drawn as the list they stand for. */}
      <div
        className="flex items-center gap-3 px-5 py-2.5"
        style={{ borderTop: "1px solid var(--s-hairline)", background: "var(--s-chrome)" }}
      >
        <span
          className="font-mono text-[9px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "var(--s-dim)" }}
        >
          Hold ⌘
        </span>
        <div className="flex items-center gap-[3px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <span
              key={n}
              className="grid h-[17px] w-[17px] place-items-center rounded-[3px] font-mono text-[10px] font-bold"
              style={{ background: "var(--s-accent)", color: "var(--s-bg)" }}
            >
              {n}
            </span>
          ))}
        </div>
        <span className="text-[11px]" style={{ color: "var(--s-muted)" }}>
          the nine most recent chats — even mid-sentence
        </span>
      </div>
    </Sheet>
  );
}

function RailRow({ binding }: { binding: Binding }) {
  return (
    <div className="flex items-center gap-2.5 py-[3px]">
      <span className="flex w-[64px] flex-none items-center justify-end">
        <Beats binding={binding} tone="flat" />
      </span>
      <span className="truncate text-[12px]" style={{ color: "var(--s-muted)" }}>
        {binding.desc}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §5  Treatment 03 — Keycap.

   The physical metaphor, taken seriously. One key per cap, never a
   phrase. Caps in a beat butt together at 2px and share a common
   ground; a beat boundary opens to 10px and draws the pause. Modifier
   caps sit visually *under* the letter they modify — dimmer ink, same
   plate — so ⌘N reads as one chord shape rather than two equal keys.
   ──────────────────────────────────────────────────────────────────── */

function KeycapSheet() {
  return (
    <Sheet width={660}>
      <SheetHead />

      <div className="px-6 pb-5 pt-4">
        <div className="mb-3 flex items-baseline gap-2">
          <ColumnLabel>Go</ColumnLabel>
          <span className="flex items-baseline gap-1.5 font-mono text-[10px]" style={{ color: "var(--s-dim)" }}>
            press
            <Beats binding={b([["g"], ["·"]], "")} tone="raised" hideLast />
            then a letter
          </span>
        </div>

        <div className="grid grid-cols-3 gap-x-4 gap-y-[3px]">
          {SECTIONS.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <KeyPlate raised accent={s.id === ACTIVE}>
                {s.chord}
              </KeyPlate>
              <span
                className="truncate text-[12px]"
                style={{
                  color: s.id === ACTIVE ? "var(--s-ink)" : "var(--s-muted)",
                  fontWeight: s.id === ACTIVE ? 600 : 400,
                }}
              >
                {s.label}
              </span>
            </div>
          ))}
          {EXTRAS.map((e) => (
            <div key={e.chord} className="flex items-center gap-2">
              <KeyPlate raised>{e.chord}</KeyPlate>
              <span className="truncate text-[12px]" style={{ color: "var(--s-dim)" }}>
                {e.label}
              </span>
            </div>
          ))}
        </div>

        <div className="my-4" style={{ height: 1, background: "var(--s-hairline)" }} />

        <div className="grid grid-cols-2 gap-x-7">
          <div>
            <ColumnLabel accent>Comms — here</ColumnLabel>
            <div className="mt-2">
              {HERE.map((k) => (
                <KeycapRow key={k.desc} binding={k} />
              ))}
              {FILTERS.map((k) => (
                <KeycapRow key={k.desc} binding={k} />
              ))}
            </div>
          </div>
          <div>
            <ColumnLabel>Move — any list</ColumnLabel>
            <div className="mt-2">
              {MOVE.map((k) => (
                <KeycapRow key={k.desc} binding={k} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex items-center gap-3 px-6 py-3"
        style={{ borderTop: "1px solid var(--s-hairline)", background: "var(--s-chrome)" }}
      >
        <ColumnLabel>Jump</ColumnLabel>
        <div className="flex items-center gap-[2px]">
          <KeyPlate raised modifier>
            ⌘
          </KeyPlate>
          <div className="flex items-center gap-[2px]">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <KeyPlate key={n} raised accent>
                {n}
              </KeyPlate>
            ))}
          </div>
        </div>
        <span className="text-[11px]" style={{ color: "var(--s-muted)" }}>
          the nine most recent chats
        </span>
      </div>
    </Sheet>
  );
}

function KeycapRow({ binding }: { binding: Binding }) {
  return (
    <div className="flex items-center gap-3 py-[3px]">
      <span className="flex w-[76px] flex-none items-center justify-end">
        <Beats binding={binding} tone="raised" />
      </span>
      <span className="truncate text-[12px]" style={{ color: "var(--s-muted)" }}>
        {binding.desc}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §6  Shared parts — the beat renderer is the whole idea.
   ──────────────────────────────────────────────────────────────────── */

const MODIFIERS = new Set(["⌘", "⌥", "⇧", "⌃"]);

/**
 * Draws a binding's beats. Keys inside a beat butt together at 2px and
 * read as one shape; beats open to 10px with the pause drawn between
 * them. This is the only place the two grammars are distinguished, and
 * every treatment routes through it.
 */
function Beats({
  binding,
  tone,
  hideLast,
}: {
  binding: Binding;
  tone: "flat" | "raised";
  hideLast?: boolean;
}) {
  const beats = hideLast ? binding.seq.slice(0, -1) : binding.seq;
  return (
    <span className="flex items-center">
      {beats.map((beat, i) => (
        <span key={i} className="flex items-center">
          {/* The beat boundary. Wide enough that the gap alone carries it —
              the mark is confirmation, not the signal. Intra-beat spacing is
              1px below, so the ratio is ~12:1 and no one has to be told. */}
          {i > 0 ? (
            <span
              className="mx-[7px] font-mono text-[10px] leading-none"
              style={{ color: "var(--s-dim)" }}
              aria-hidden
              title="then"
            >
              ›
            </span>
          ) : null}
          <span className="flex items-center gap-[1px]">
            {beat.map((key) => (
              <KeyPlate key={key} raised={tone === "raised"} modifier={MODIFIERS.has(key)}>
                {key}
              </KeyPlate>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

function KeyPlate({
  children,
  raised,
  modifier,
  accent,
}: {
  children: React.ReactNode;
  raised?: boolean;
  modifier?: boolean;
  accent?: boolean;
}) {
  const label = String(children);
  const wide = label.length > 2;

  if (!raised) {
    return (
      <span
        className="font-mono text-[12px] font-bold"
        style={{ color: modifier ? "var(--s-dim)" : "var(--s-ink)" }}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className="grid place-items-center font-mono font-bold"
      style={{
        minWidth: wide ? 32 : 18,
        height: 18,
        padding: wide ? "0 4px" : 0,
        fontSize: 10.5,
        borderRadius: 4,
        // The cap: a plate lifted off the sheet by a hairline and one
        // pixel of bottom edge. No gradients, no glow — the lift is
        // structural, which is what keeps it Scout and not skeuomorphic.
        background: accent ? "var(--s-accent)" : "var(--s-surface)",
        color: accent ? "var(--s-bg)" : modifier ? "var(--s-dim)" : "var(--s-ink)",
        border: `1px solid ${accent ? "var(--s-accent)" : "var(--s-hairline-strong)"}`,
        boxShadow: accent ? "none" : "0 1px 0 var(--s-hairline-strong)",
      }}
    >
      {label}
    </span>
  );
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="grid h-[16px] min-w-[16px] place-items-center rounded-[3px] font-mono text-[10px] font-bold"
      style={{ background: "var(--s-accent)", color: "var(--s-bg)" }}
    >
      {children}
    </span>
  );
}

function ColumnLabel({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className="font-mono text-[9px] font-bold uppercase tracking-[0.18em]"
      style={{ color: accent ? "var(--s-accent)" : "var(--s-ink)" }}
    >
      {children}
    </span>
  );
}

function Sheet({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        width,
        background: "var(--s-surface)",
        border: "1px solid var(--s-hairline-strong)",
        boxShadow: "0 24px 48px -20px rgba(0,0,0,0.45)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * One head band, shared. The dismissal lives up here with the toggle it
 * pairs with, which retires the shipped sheet's whole footer strip —
 * a full band that said nothing the header didn't.
 */
function SheetHead() {
  return (
    <div
      className="flex items-center justify-between px-5 py-2.5"
      style={{ borderBottom: "1px solid var(--s-hairline)", background: "var(--s-chrome)" }}
    >
      <span
        className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]"
        style={{ color: "var(--s-ink)" }}
      >
        Keyboard
      </span>
      <span className="flex items-center gap-3 font-mono text-[10px]" style={{ color: "var(--s-dim)" }}>
        <span className="flex items-center gap-1.5">
          <KeyPlate raised modifier>
            ⌘
          </KeyPlate>
          <KeyPlate raised>/</KeyPlate>
          toggle
        </span>
        <span className="flex items-center gap-1.5">
          <KeyPlate raised>esc</KeyPlate>
          close
        </span>
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §7  The note.
   ──────────────────────────────────────────────────────────────────── */

function GrammarNote() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Note title="The defect was structural">
        The shipped sheet gave <code>⌘N</code> and <code>g c</code> the same box,
        so the only genuinely new idea in the keyboard — that <code>g</code> starts
        a <em>sequence</em> — arrived looking exactly like every shortcut the user
        already knew. Encoding the beat in spacing costs nothing and teaches the
        grammar without a sentence of explanation.
      </Note>
      <Note title="One key per cap">
        <code>⌥⌘1 2 3</code>, <code>↵ · ⇧↵</code> and <code>g g · ⇧G</code> were
        three phrases wearing a keycap. A cap that can hold a phrase isn&rsquo;t a
        cap. Those rows split into six honest ones, which cost four lines and
        bought precision exactly where the sheet is consulted.
      </Note>
      <Note title="Modifiers are subordinate">
        In <code>⌘N</code> the letter is the verb and <code>⌘</code> is grammar.
        Drawing both at full ink makes every combo read as two equal keys. Dimming
        the modifier lets the row scan on its letter — which is what the hand is
        actually looking for.
      </Note>
    </div>
  );
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

/* ── Icons ─────────────────────────────────────────────────────────── */

function IconBubble() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2 6.5A3.5 3.5 0 015.5 3h3A3.5 3.5 0 0112 6.5v0A3.5 3.5 0 018.5 10H6L3.5 12v-2.2A3.5 3.5 0 012 6.5z" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.2l1.2 1.5h5.6A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M5 6.5L7 8l-2 1.5M8.5 10H11" />
    </svg>
  );
}

function IconPulse() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M1.5 8h2.2l1.6-4 2.2 8 1.8-5 1.2 3h4" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M14 2L7 9M14 2l-4.5 12-2.3-5.2L2 6.4 14 2z" strokeLinejoin="round" />
    </svg>
  );
}

function IconLanes() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="4" width="12" height="8" rx="1" />
      <path d="M6 4v8M10 4v8" />
    </svg>
  );
}

function IconBranch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="6" r="1.6" />
      <path d="M4.5 5.1v5.8M6.1 6h2.4c1 0 1.5.6 1.5 1.6v1.2" />
    </svg>
  );
}

function IconCode() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" />
    </svg>
  );
}
