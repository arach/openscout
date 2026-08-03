"use client";

/**
 * Scout Keyboard Navigation — study (macOS).
 *
 * The live app's keyboard is a flat list of single keys: j/k/h/l walk the
 * selection, ⌘1–3 filter, ⌘K/⌘L focus, `?` opens a cheatsheet that describes
 * some bindings that don't exist. There is no way to *go somewhere* — every
 * section change is a mouse trip to the rail.
 *
 * This study proposes three layers, all driven by one keymap table:
 *
 *   1. GO — `g` is a prefix, not a command. `g` then a letter lands you in a
 *      section. Arming `g` reveals the letter palette over the rail, so the
 *      chord teaches itself: the hint IS the rail, in the same order, in the
 *      same place your eye already goes.
 *
 *   2. JUMP — hold a modifier and the conversation list stamps itself with
 *      targets: digits 1–9 on the nine most recent, then name-derived letter
 *      tags for the rest. Press the target, land in the chat. Works while the
 *      composer has focus, which is the whole point — you jump *out* of a
 *      conversation from inside it.
 *
 *   3. HELP — `?` renders the same table it binds, two columns, active
 *      section first. It cannot drift because it isn't prose.
 *
 * The rig below is live: click into the window and fly it. Everything the
 * grammar claims is wired, including the composer-focus guards.
 *
 * Ports to: apps/macos/Sources/Scout/ScoutRootView.swift (handleKeyboardEvent),
 * ScoutCommands.swift, ScoutKeyboardCheatsheet.swift.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";

/* ────────────────────────────────────────────────────────────────────
   §1  The keymap — one table, three consumers (binding, palette, help).
   ──────────────────────────────────────────────────────────────────── */

type SectionId =
  | "comms"
  | "agents"
  | "terminals"
  | "tail"
  | "dispatch"
  | "lanes"
  | "repos"
  | "code"
  | "settings";

interface SectionDef {
  id: SectionId;
  label: string;
  /** Second key of the `g` chord. */
  chord: string;
  /** Why this letter, when it isn't the first one. */
  why?: string;
  icon: (props: { className?: string }) => React.ReactElement;
}

const SECTIONS: SectionDef[] = [
  { id: "comms", label: "Comms", chord: "c", icon: IconBubble },
  { id: "agents", label: "Projects", chord: "p", icon: IconFolder },
  { id: "terminals", label: "Terminals", chord: "t", icon: IconTerminal },
  { id: "tail", label: "Tail", chord: "f", why: "tail ­-f — t belongs to Terminals", icon: IconPulse },
  { id: "dispatch", label: "Dispatch", chord: "d", icon: IconSend },
  { id: "lanes", label: "Lanes", chord: "l", icon: IconLanes },
  { id: "repos", label: "Repos", chord: "r", icon: IconBranch },
  { id: "code", label: "Code", chord: "e", why: "editor — c belongs to Comms", icon: IconCode },
  { id: "settings", label: "Settings", chord: "s", icon: IconGear },
];

const SECTION_BY_CHORD = new Map(SECTIONS.map((s) => [s.chord, s]));

/** Chord keys that aren't destinations. */
const CHORD_EXTRAS: { key: string; label: string; detail: string }[] = [
  { key: "g", label: "top", detail: "first row of this surface's list" },
  { key: "b", label: "back", detail: "the section you came from" },
];

/** Per-section bindings, for the help sheet's context column. */
const CONTEXT_KEYS: Record<string, { keys: string; desc: string }[]> = {
  comms: [
    { keys: "⌘N", desc: "new chat" },
    { keys: "⌘K", desc: "focus search" },
    { keys: "⌘L", desc: "focus composer" },
    // Relocated off ⌘1–3 when the digits became the conversation jump.
    { keys: "⌥⌘1 2 3", desc: "all · direct · shared" },
    { keys: "⌘V", desc: "paste image" },
    { keys: "↵ · ⇧↵", desc: "send · newline" },
  ],
  agents: [
    { keys: "l · h", desc: "expand · collapse" },
    { keys: "↵", desc: "open session" },
    { keys: "⌘O", desc: "observe agent" },
  ],
  terminals: [{ keys: "⌘N", desc: "new shell" }],
  tail: [{ keys: "↵", desc: "load session" }],
  dispatch: [],
  lanes: [{ keys: "⌘R", desc: "refresh embed" }],
  repos: [
    { keys: "l · h", desc: "expand · collapse" },
    { keys: "⌘↩", desc: "reveal in Finder" },
  ],
  code: [],
  settings: [],
};

const MOVE_KEYS: { keys: string; desc: string }[] = [
  { keys: "j · k", desc: "next · previous" },
  { keys: "⌘↓ ⌘↑", desc: "same, while typing" },
  { keys: "g g · ⇧G", desc: "first · last" },
  { keys: "↵", desc: "open selection" },
  { keys: "Esc", desc: "leave the composer" },
];

/* ────────────────────────────────────────────────────────────────────
   §2  Mock fleet — the conversation list the jump targets stamp.
   ──────────────────────────────────────────────────────────────────── */

interface Chat {
  id: string;
  name: string;
  preview: string;
  time: string;
  unread: number;
  bucket: "now" | "today" | "earlier";
  state: "working" | "idle" | "needs";
}

const CHATS: Chat[] = [
  { id: "dewey", name: "Dewey", preview: "Take both — and surface the active theme in the inspector.", time: "2m", unread: 2, bucket: "now", state: "working" },
  { id: "hudson", name: "Hudson", preview: "Moved resolveStartupTheme() ahead of the composer mount.", time: "8m", unread: 0, bucket: "now", state: "working" },
  { id: "dustin", name: "Dustin", preview: "Broker journal is replaying cleanly after the flap fix.", time: "11m", unread: 1, bucket: "now", state: "needs" },
  { id: "atlas", name: "Atlas", preview: "Dropped the iconography study. Want to walk through it?", time: "22m", unread: 0, bucket: "today", state: "idle" },
  { id: "preframe", name: "Preframe", preview: "Standup in 5m — I'll bring up the worktree map.", time: "1h", unread: 0, bucket: "today", state: "idle" },
  { id: "lattices", name: "Lattices", preview: "Token sweep landed; light mode hairlines are consistent now.", time: "1h", unread: 0, bucket: "today", state: "idle" },
  { id: "pairing", name: "Scout · iOS pairing", preview: "QR handoff from iOS. Awaiting the second-device scan.", time: "2h", unread: 3, bucket: "today", state: "needs" },
  { id: "meridian", name: "Meridian", preview: "Route aliases wired through the dispatcher. Tests green.", time: "3h", unread: 0, bucket: "today", state: "idle" },
  { id: "cobalt", name: "Cobalt", preview: "Pushed the retention GC branch, needs a second pair of eyes.", time: "4h", unread: 0, bucket: "today", state: "idle" },
  { id: "delta", name: "Delta", preview: "Terminal workspaces survive a crash now — ratchet holds.", time: "6h", unread: 0, bucket: "earlier", state: "idle" },
  { id: "harbor", name: "Harbor", preview: "Landing copy rewrite is in the studio for review.", time: "yd", unread: 0, bucket: "earlier", state: "idle" },
  { id: "corvus", name: "Corvus", preview: "Sparkle updater feed is signed and serving.", time: "yd", unread: 0, bucket: "earlier", state: "idle" },
  { id: "prism", name: "Prism", preview: "Sprite hash parity between Swift and JS confirmed.", time: "2d", unread: 0, bucket: "earlier", state: "idle" },
  { id: "castle", name: "Castle", preview: "Disk survey done — the clones were lying about size.", time: "3d", unread: 0, bucket: "earlier", state: "idle" },
];

const BUCKET_LABEL: Record<Chat["bucket"], string> = {
  now: "Now",
  today: "Today",
  earlier: "Earlier",
};

/* ────────────────────────────────────────────────────────────────────
   §3  Target tags — digits for the recent nine, letters for the rest.

   The letter tag is the first *differentiating* characters of the name:
   a name whose initial nobody else shares gets that one letter; when
   several share an initial they all take two ("Corvus" → `co`,
   "Castle" → `ca`).

   The set must be prefix-free, and that is the whole reason the rule is
   "everyone in a contested group goes to two" rather than "shortest
   unique prefix". Shortest-unique would hand Corvus `c` and Castle `ca`,
   and then `c` resolves the instant it is typed — `ca` is unreachable,
   forever. Grouping first means no tag is ever a prefix of another.

   Ported verbatim so the Swift side produces identical tags.
   ──────────────────────────────────────────────────────────────────── */

const DIGIT_TARGETS = 9;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

export function assignTargets(names: string[]): string[] {
  const digits = names.slice(0, DIGIT_TARGETS).map((_, i) => String(i + 1));
  const rest = names.slice(DIGIT_TARGETS);
  const letters = rest.map((n) => n.toLowerCase().replace(/[^a-z]/g, "") || "z");

  const shareInitial = new Map<string, number>();
  for (const l of letters) {
    shareInitial.set(l[0], (shareInitial.get(l[0]) ?? 0) + 1);
  }

  const taken = new Set<string>();
  const tags = letters.map((l) => {
    const head = l[0];
    if ((shareInitial.get(head) ?? 0) === 1) {
      taken.add(head);
      return head;
    }
    // Contested initial: widen to two, walking the name for a free second
    // character, then the alphabet if the name runs out (duplicate names).
    for (const c of l.slice(1) + ALPHABET) {
      const candidate = head + c;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    return head;
  });

  return [...digits, ...tags];
}

/* ────────────────────────────────────────────────────────────────────
   §4  The rig.
   ──────────────────────────────────────────────────────────────────── */

/** Which modifier plane carries the jump targets. */
type JumpPlane = "alt" | "meta";

const PLANE_LABEL: Record<JumpPlane, string> = { alt: "⌥", meta: "⌘" };

/** How long the modifier must be held before the targets paint. */
const REVEAL_MS = 260;
/** How long `g` waits before it shows its palette (fast chords stay silent). */
const CHORD_HINT_MS = 180;

export default function ScoutKeyboardNavStudy() {
  return (
    <ScoutStudyShell
      pageId="scout-keyboard-nav"
      title="Keyboard Navigation"
      blurb={
        <>
          Three layers on one keymap: <b>g</b> as a go-prefix that reveals its own
          palette, a held modifier that stamps jump targets onto the conversation
          list, and a <b>?</b> sheet generated from the same table it binds. The
          window below is live — click it and fly.
        </>
      }
    >
      {() => <Rig />}
    </ScoutStudyShell>
  );
}

function Rig() {
  const [section, setSection] = useState<SectionId>("comms");
  const [previousSection, setPreviousSection] = useState<SectionId>("agents");
  const [selected, setSelected] = useState(0);
  const [chatId, setChatId] = useState(CHATS[0].id);
  // ⌘ is the ratified plane (2026-08-03): ⌘1–9 is the macOS idiom for "nth
  // thing" and fires while typing without ceremony. The ⌥ variant stays
  // switchable below because it is the only way to carry the letter tier, and
  // that tier is the reach past nine — worth keeping legible if the list ever
  // outgrows the digits.
  const [plane, setPlane] = useState<JumpPlane>("meta");

  const [chord, setChord] = useState<null | { visible: boolean }>(null);
  const [targets, setTargets] = useState(false);
  const [typed, setTyped] = useState("");
  const [help, setHelp] = useState(false);
  const [composing, setComposing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [focusWithin, setFocusWithin] = useState(false);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const chordTimer = useRef<number | null>(null);
  const revealTimer = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);

  const tags = useMemo(() => assignTargets(CHATS.map((c) => c.name)), []);

  const announce = useCallback((message: string) => {
    setFlash(message);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1400);
  }, []);

  const go = useCallback(
    (next: SectionId) => {
      setSection((current) => {
        if (current !== next) setPreviousSection(current);
        return next;
      });
      announce(`go → ${SECTIONS.find((s) => s.id === next)?.label ?? next}`);
    },
    [announce],
  );

  const disarmChord = useCallback(() => {
    if (chordTimer.current) window.clearTimeout(chordTimer.current);
    chordTimer.current = null;
    setChord(null);
  }, []);

  const clearTargets = useCallback(() => {
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
    setTargets(false);
    setTyped("");
  }, []);

  const jumpTo = useCallback(
    (index: number) => {
      const chat = CHATS[index];
      if (!chat) return;
      setChatId(chat.id);
      setSelected(index);
      if (section !== "comms") {
        setPreviousSection(section);
        setSection("comms");
      }
      announce(`jump → ${chat.name}`);
    },
    [announce, section],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    function isTyping(): boolean {
      const el = document.activeElement;
      return (
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && el.type === "text")
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!frame || !frame.contains(document.activeElement)) return;

      // ── The jump plane. Held modifier + target resolves from anywhere,
      //    including mid-sentence in the composer: leaving a conversation is
      //    exactly the thing you want to do while writing in it.
      const planeHeld = plane === "alt" ? event.altKey : event.metaKey;
      if (planeHeld && !event.ctrlKey) {
        // macOS composes ⌥+letter into a glyph (⌥d → ∂), so the studio reads
        // event.code. AppKit's charactersIgnoringModifiers gives the plain
        // letter directly — see the port notes.
        const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
        if (digit) {
          event.preventDefault();
          jumpTo(Number(digit) - 1);
          clearTargets();
          return;
        }
        const letter = /^Key([A-Z])$/.exec(event.code)?.[1]?.toLowerCase();
        // Letter tags need the deliberate hold. Without it, ⌥e stays a dead
        // key and ⌘L still focuses the composer.
        if (letter && targets && !isTyping()) {
          event.preventDefault();
          const next = typed + letter;
          const exact = tags.indexOf(next);
          if (exact >= 0) {
            jumpTo(exact);
            clearTargets();
            return;
          }
          if (tags.some((t) => t.startsWith(next))) {
            setTyped(next);
            return;
          }
          setTyped("");
          return;
        }
      }

      if (event.metaKey || event.ctrlKey) return;

      if (event.key === "Escape") {
        if (help) {
          setHelp(false);
          event.preventDefault();
          return;
        }
        if (chord) {
          disarmChord();
          event.preventDefault();
          return;
        }
        if (isTyping()) {
          composerRef.current?.blur();
          frame.focus();
          setComposing(false);
          event.preventDefault();
        }
        return;
      }

      if (isTyping()) return;

      // ── The go-prefix.
      if (chord) {
        event.preventDefault();
        const key = event.key.toLowerCase();
        disarmChord();
        const destination = SECTION_BY_CHORD.get(key);
        if (destination) {
          go(destination.id);
          return;
        }
        if (key === "g") {
          setSelected(0);
          announce("top of list");
          return;
        }
        if (key === "b") {
          go(previousSection);
          return;
        }
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setHelp((v) => !v);
        return;
      }

      switch (event.key) {
        case "g": {
          event.preventDefault();
          setChord({ visible: false });
          if (chordTimer.current) window.clearTimeout(chordTimer.current);
          chordTimer.current = window.setTimeout(
            () => setChord({ visible: true }),
            CHORD_HINT_MS,
          );
          return;
        }
        case "G": {
          event.preventDefault();
          setSelected(CHATS.length - 1);
          announce("last item");
          return;
        }
        case "j":
        case "ArrowDown": {
          event.preventDefault();
          setSelected((i) => Math.min(i + 1, CHATS.length - 1));
          return;
        }
        case "k":
        case "ArrowUp": {
          event.preventDefault();
          setSelected((i) => Math.max(i - 1, 0));
          return;
        }
        case "Enter": {
          event.preventDefault();
          setChatId(CHATS[selected].id);
          announce(`open ${CHATS[selected].name}`);
          return;
        }
        default:
          break;
      }
    }

    function onModifierDown(event: KeyboardEvent) {
      if (!frame || !frame.contains(document.activeElement)) return;
      const isPlaneKey = plane === "alt" ? event.key === "Alt" : event.key === "Meta";
      if (!isPlaneKey || targets || revealTimer.current) return;
      revealTimer.current = window.setTimeout(() => {
        revealTimer.current = null;
        setTargets(true);
      }, REVEAL_MS);
    }

    function onKeyUp(event: KeyboardEvent) {
      const isPlaneKey = plane === "alt" ? event.key === "Alt" : event.key === "Meta";
      if (isPlaneKey) clearTargets();
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keydown", onModifierDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", clearTargets);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keydown", onModifierDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", clearTargets);
    };
  }, [
    announce,
    chord,
    clearTargets,
    disarmChord,
    go,
    help,
    jumpTo,
    plane,
    previousSection,
    selected,
    tags,
    targets,
    typed,
  ]);

  useEffect(() => () => {
    if (chordTimer.current) window.clearTimeout(chordTimer.current);
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  // `?state=chord|targets|help` pins one overlay open, so a reviewer can link
  // to a single state (and a screenshot can capture it) without holding a key.
  useEffect(() => {
    const pinned = new URLSearchParams(window.location.search).get("state");
    if (pinned === "chord") setChord({ visible: true });
    if (pinned === "targets") setTargets(true);
    if (pinned === "help") setHelp(true);
  }, []);

  const chat = CHATS.find((c) => c.id === chatId) ?? CHATS[0];

  return (
    <div className="flex flex-col gap-6">
      <RigControls
        plane={plane}
        setPlane={setPlane}
        focused={focusWithin}
        onFocusRequest={() => frameRef.current?.focus()}
      />

      <div
        ref={frameRef}
        tabIndex={0}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setFocusWithin(false);
            clearTargets();
            disarmChord();
          }
        }}
        className="relative flex h-[560px] flex-col overflow-hidden rounded-[10px] outline-none"
        style={{
          background: "var(--s-bg)",
          border: "1px solid var(--s-hairline-strong)",
          boxShadow: focusWithin
            ? "0 0 0 3px color-mix(in oklab, var(--s-accent) 30%, transparent), 0 18px 40px -24px rgba(0,0,0,0.55)"
            : "0 18px 40px -24px rgba(0,0,0,0.55)",
          fontFamily: "var(--s-font-sans)",
          transition: "box-shadow 140ms ease",
        }}
      >
        <Titlebar section={section} flash={flash} />

        <div className="flex min-h-0 flex-1">
          <NavRail
            section={section}
            chordArmed={Boolean(chord?.visible)}
            onSelect={go}
          />
          <ChatList
            chats={CHATS}
            tags={tags}
            selected={selected}
            activeId={chat.id}
            targets={targets}
            typed={typed}
            plane={plane}
            dimmed={section !== "comms"}
            onSelect={(i) => {
              setSelected(i);
              setChatId(CHATS[i].id);
            }}
          />
          {section === "comms" ? (
            <Thread
              chat={chat}
              plane={plane}
              composerRef={composerRef}
              composing={composing}
              setComposing={setComposing}
            />
          ) : (
            <SectionStub section={section} />
          )}
        </div>

        <StatusStrip
          section={section}
          chordArmed={Boolean(chord)}
          targets={targets}
          typed={typed}
          plane={plane}
        />

        {chord?.visible ? <ChordScrim /> : null}
        {help ? <HelpSheet section={section} plane={plane} onClose={() => setHelp(false)} /> : null}
      </div>

      <Legend plane={plane} />
      <PortNotes />
    </div>
  );
}

/* ── Rig chrome ─────────────────────────────────────────────────── */

function RigControls({
  plane,
  setPlane,
  focused,
  onFocusRequest,
}: {
  plane: JumpPlane;
  setPlane: (p: JumpPlane) => void;
  focused: boolean;
  onFocusRequest: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
          Jump plane
        </span>
        <div className="inline-flex rounded-md border border-studio-edge p-0.5">
          {(["alt", "meta"] as JumpPlane[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPlane(p);
                onFocusRequest();
              }}
              className={`rounded-[5px] px-3 py-1.5 font-mono text-sm font-semibold transition-colors ${
                plane === p
                  ? "bg-studio-surface text-studio-ink"
                  : "text-studio-ink-faint hover:text-studio-ink"
              }`}
            >
              {PLANE_LABEL[p]}
              <span className="ml-1.5 font-sans text-2xs font-normal opacity-70">
                {p === "alt" ? "digits + letters" : "shipped"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onFocusRequest}
        className={`rounded-md border px-3 py-1.5 font-mono text-2xs uppercase tracking-eyebrow transition-colors ${
          focused
            ? "border-emerald-500/50 text-emerald-600"
            : "border-studio-edge text-studio-ink-faint hover:text-studio-ink"
        }`}
      >
        {focused ? "keyboard live — try g then c" : "click to give the window focus"}
      </button>
    </div>
  );
}

function Titlebar({ section, flash }: { section: SectionId; flash: string | null }) {
  const label = SECTIONS.find((s) => s.id === section)?.label ?? "";
  return (
    <div
      className="flex h-[30px] flex-none items-center gap-2 px-3"
      style={{ background: "var(--s-chrome)", borderBottom: "1px solid var(--s-hairline)" }}
    >
      <div className="flex items-center gap-1.5">
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#FF5F57" }} />
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#FEBC2E" }} />
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#28C840" }} />
      </div>
      <div
        className="ml-3 font-mono text-[10px] uppercase tracking-[0.14em]"
        style={{ color: "var(--s-dim)" }}
      >
        Scout · {label}
      </div>
      <div className="ml-auto h-[18px] min-w-[120px] text-right">
        {flash ? (
          <span
            className="inline-block rounded px-2 py-[2px] font-mono text-[10px]"
            style={{
              background: "var(--s-accent-soft)",
              color: "var(--s-accent)",
            }}
          >
            {flash}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The rail is the palette. Arming `g` swaps each icon for its chord letter
 * in place — no floating menu to read, no new spatial model to learn. The
 * hint lives where the destination already lives.
 */
function NavRail({
  section,
  chordArmed,
  onSelect,
}: {
  section: SectionId;
  chordArmed: boolean;
  onSelect: (id: SectionId) => void;
}) {
  const main = SECTIONS.filter((s) => s.id !== "settings");
  const settings = SECTIONS[SECTIONS.length - 1];

  return (
    <div
      className="relative z-20 flex w-[116px] flex-none flex-col gap-[2px] px-2 py-2"
      style={{ background: "var(--s-chrome)", borderRight: "1px solid var(--s-hairline)" }}
    >
      {main.map((s) => (
        <RailRow
          key={s.id}
          def={s}
          active={s.id === section}
          armed={chordArmed}
          onSelect={onSelect}
        />
      ))}
      <div className="mt-auto">
        <RailRow def={settings} active={section === "settings"} armed={chordArmed} onSelect={onSelect} />
      </div>
    </div>
  );
}

function RailRow({
  def,
  active,
  armed,
  onSelect,
}: {
  def: SectionDef;
  active: boolean;
  armed: boolean;
  onSelect: (id: SectionId) => void;
}) {
  const Icon = def.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(def.id)}
      className="flex h-[26px] w-full items-center gap-2 rounded-[5px] px-1.5 text-left transition-colors"
      style={{
        background: active ? "var(--s-surface)" : "transparent",
        color: active ? "var(--s-ink)" : "var(--s-dim)",
      }}
    >
      <span className="relative grid h-[16px] w-[16px] flex-none place-items-center">
        <span
          className="absolute inset-0 grid place-items-center transition-opacity duration-150"
          style={{ opacity: armed ? 0 : 1 }}
        >
          <Icon />
        </span>
        <span
          className="absolute inset-[-2px] grid place-items-center rounded-[4px] font-mono text-[11px] font-bold transition-all duration-150"
          style={{
            opacity: armed ? 1 : 0,
            transform: armed ? "scale(1)" : "scale(0.7)",
            background: "var(--s-accent)",
            color: "var(--s-bg)",
          }}
        >
          {def.chord}
        </span>
      </span>
      <span className="truncate text-[11px]" style={{ fontWeight: active ? 600 : 400 }}>
        {def.label}
      </span>
    </button>
  );
}

/** Dims everything but the rail while the chord is armed. */
function ChordScrim() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      style={{
        background: "color-mix(in oklab, var(--s-bg) 62%, transparent)",
        backdropFilter: "blur(0.5px)",
      }}
    />
  );
}

function ChatList({
  chats,
  tags,
  selected,
  activeId,
  targets,
  typed,
  plane,
  dimmed,
  onSelect,
}: {
  chats: Chat[];
  tags: string[];
  selected: number;
  activeId: string;
  targets: boolean;
  typed: string;
  plane: JumpPlane;
  dimmed: boolean;
  onSelect: (index: number) => void;
}) {
  let lastBucket: Chat["bucket"] | null = null;

  return (
    <div
      className="flex w-[248px] flex-none flex-col overflow-hidden transition-opacity duration-200"
      style={{
        background: "var(--s-bg)",
        borderRight: "1px solid var(--s-hairline)",
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      <div
        className="flex h-[30px] flex-none items-center justify-between px-3"
        style={{ borderBottom: "1px solid var(--s-hairline)" }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-[0.14em]"
          style={{ color: "var(--s-dim)" }}
        >
          Conversations
        </span>
        {targets ? (
          <span
            className="font-mono text-[10px]"
            style={{ color: "var(--s-accent)" }}
          >
            {PLANE_LABEL[plane]} jump
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {chats.map((c, i) => {
          const header = c.bucket !== lastBucket ? BUCKET_LABEL[c.bucket] : null;
          lastBucket = c.bucket;
          const tag = tags[i];
          const isDigit = i < DIGIT_TARGETS;
          const matched = !isDigit && typed.length > 0 && tag.startsWith(typed);
          const muted = targets && !isDigit && typed.length > 0 && !matched;

          return (
            <div key={c.id}>
              {header ? (
                <div
                  className="px-3 pb-1 pt-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: "var(--s-dim)" }}
                >
                  {header}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => onSelect(i)}
                className="flex w-full items-start gap-2 px-2 py-[6px] text-left transition-colors"
                style={{
                  background:
                    c.id === activeId
                      ? "var(--s-accent-soft)"
                      : i === selected
                        ? "var(--s-surface)"
                        : "transparent",
                  boxShadow:
                    i === selected && c.id !== activeId
                      ? "inset 2px 0 0 var(--s-accent)"
                      : "none",
                  opacity: muted ? 0.35 : 1,
                }}
              >
                <span className="relative mt-[2px] grid h-[16px] w-[16px] flex-none place-items-center">
                  <span
                    className="absolute inset-0 grid place-items-center transition-opacity duration-150"
                    style={{ opacity: targets ? 0 : 1 }}
                  >
                    <StateDot state={c.state} />
                  </span>
                  <span
                    className="absolute inset-[-1px] grid place-items-center rounded-[3px] font-mono text-[10px] font-bold transition-all duration-150"
                    style={{
                      opacity: targets ? 1 : 0,
                      transform: targets ? "scale(1)" : "scale(0.7)",
                      background: matched
                        ? "var(--s-accent)"
                        : isDigit
                          ? "var(--s-accent)"
                          : "var(--s-hairline-strong)",
                      color: matched || isDigit ? "var(--s-bg)" : "var(--s-ink)",
                      minWidth: tag.length > 1 ? 20 : 16,
                    }}
                  >
                    {tag}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span
                      className="truncate text-[12px]"
                      style={{
                        color: "var(--s-ink)",
                        fontWeight: c.unread > 0 ? 600 : 500,
                      }}
                    >
                      {c.name}
                    </span>
                    <span
                      className="ml-auto flex-none font-mono text-[10px]"
                      style={{ color: "var(--s-dim)" }}
                    >
                      {c.time}
                    </span>
                  </span>
                  <span
                    className="mt-[1px] block truncate text-[11px]"
                    style={{ color: "var(--s-muted)" }}
                  >
                    {c.preview}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StateDot({ state }: { state: Chat["state"] }) {
  const color =
    state === "working" ? "var(--s-ok)" : state === "needs" ? "var(--s-warn)" : "var(--s-dim)";
  return (
    <span
      className="block h-[6px] w-[6px] rounded-full"
      style={{ background: color, opacity: state === "idle" ? 0.5 : 1 }}
    />
  );
}

function Thread({
  chat,
  plane,
  composerRef,
  composing,
  setComposing,
}: {
  chat: Chat;
  plane: JumpPlane;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  composing: boolean;
  setComposing: (v: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ background: "var(--s-bg)" }}>
      <div
        className="flex h-[30px] flex-none items-center gap-2 px-4"
        style={{ borderBottom: "1px solid var(--s-hairline)" }}
      >
        <StateDot state={chat.state} />
        <span className="text-[12px] font-semibold" style={{ color: "var(--s-ink)" }}>
          {chat.name}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Turn who={chat.name} accent>
          {chat.preview}
        </Turn>
        <Turn who="You">
          Good — hold {PLANE_LABEL[plane]} while you read this and the list stamps
          its targets. You never have to leave the sentence you&rsquo;re writing.
        </Turn>
        <Turn who={chat.name} accent>
          Right. The jump resolves from inside the composer, so switching
          conversations costs one chord instead of a mouse trip to the rail.
        </Turn>
      </div>

      <div
        className="flex-none px-3 pb-3 pt-2"
        style={{ borderTop: "1px solid var(--s-hairline)" }}
      >
        <textarea
          ref={composerRef}
          rows={2}
          onFocus={() => setComposing(true)}
          onBlur={() => setComposing(false)}
          placeholder="Type here — then hold the jump modifier and press a target."
          className="w-full resize-none rounded-[6px] px-2.5 py-2 text-[12px] outline-none"
          style={{
            background: "var(--s-surface)",
            color: "var(--s-ink)",
            border: `1px solid ${composing ? "var(--s-accent)" : "var(--s-hairline-strong)"}`,
          }}
        />
        <div
          className="mt-1 flex items-center gap-3 font-mono text-[10px]"
          style={{ color: "var(--s-dim)" }}
        >
          <span>↵ send</span>
          <span>⇧↵ newline</span>
          <span>Esc leave composer</span>
        </div>
      </div>
    </div>
  );
}

function Turn({
  who,
  accent,
  children,
}: {
  who: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex gap-2">
      <span
        className="mt-[1px] grid h-[18px] w-[18px] flex-none place-items-center rounded-[4px] font-mono text-[9px] font-bold"
        style={{
          background: accent ? "var(--s-accent-soft)" : "var(--s-surface)",
          color: accent ? "var(--s-accent)" : "var(--s-muted)",
        }}
      >
        {who.charAt(0)}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[10px]" style={{ color: "var(--s-dim)" }}>
          {who}
        </div>
        <div className="text-[12px] leading-relaxed" style={{ color: "var(--s-ink)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function SectionStub({ section }: { section: SectionId }) {
  const def = SECTIONS.find((s) => s.id === section);
  if (!def) return null;
  const Icon = def.icon;
  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3"
      style={{ background: "var(--s-bg)" }}
    >
      <span style={{ color: "var(--s-dim)" }}>
        <Icon />
      </span>
      <div className="text-center">
        <div className="text-[13px] font-semibold" style={{ color: "var(--s-ink)" }}>
          {def.label}
        </div>
        <div className="mt-1 font-mono text-[10px]" style={{ color: "var(--s-dim)" }}>
          arrived via g {def.chord} · g b goes back
        </div>
      </div>
    </div>
  );
}

function StatusStrip({
  section,
  chordArmed,
  targets,
  typed,
  plane,
}: {
  section: SectionId;
  chordArmed: boolean;
  targets: boolean;
  typed: string;
  plane: JumpPlane;
}) {
  const label = SECTIONS.find((s) => s.id === section)?.label ?? "";
  return (
    <div
      className="flex h-[22px] flex-none items-center gap-3 px-3 font-mono text-[10px] uppercase tracking-[0.12em]"
      style={{ background: "var(--s-chrome)", borderTop: "1px solid var(--s-hairline)" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--s-ok)" }} />
      <span style={{ color: "var(--s-muted)" }}>{label}</span>
      <span className="ml-auto flex items-center gap-2">
        {chordArmed ? <Pending>g …</Pending> : null}
        {targets ? <Pending>{PLANE_LABEL[plane]} {typed || "target"}</Pending> : null}
        <span style={{ color: "var(--s-dim)" }}>? help</span>
      </span>
    </div>
  );
}

function Pending({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded px-1.5 py-[1px] normal-case"
      style={{ background: "var(--s-accent)", color: "var(--s-bg)" }}
    >
      {children}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §5  The help sheet — two columns, generated from the tables above.

   The old sheet was one 520pt column of seven equal groups, half of
   them describing keys that don't exist and half describing sections
   you aren't in. This one splits the two questions a user actually has:
   *where can I go* (left, the stable half — same grid as the rail
   palette, so the sheet rehearses the chord) and *what works here*
   (right, the volatile half — active section first).
   ──────────────────────────────────────────────────────────────────── */

function HelpSheet({
  section,
  plane,
  onClose,
}: {
  section: SectionId;
  plane: JumpPlane;
  onClose: () => void;
}) {
  const contextual = CONTEXT_KEYS[section] ?? [];
  const active = SECTIONS.find((s) => s.id === section);

  return (
    <div
      className="absolute inset-0 z-30 grid place-items-center px-6"
      style={{ background: "color-mix(in oklab, var(--s-bg) 88%, transparent)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] overflow-hidden rounded-[10px]"
        style={{
          background: "var(--s-chrome)",
          border: "1px solid var(--s-hairline-strong)",
          boxShadow: "0 24px 48px -20px rgba(0,0,0,0.5)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--s-hairline)" }}
        >
          <span
            className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: "var(--s-ink)" }}
          >
            Keyboard
          </span>
          <span className="flex items-center gap-1.5">
            <Cap>⌘/</Cap>
            <span className="font-mono text-[10px]" style={{ color: "var(--s-dim)" }}>
              toggle
            </span>
          </span>
        </div>

        <div className="grid grid-cols-[1fr_1fr]">
          {/* Left — where you can go. Mirrors the rail order exactly. */}
          <div className="p-4" style={{ borderRight: "1px solid var(--s-hairline)" }}>
            <GroupLabel>
              Go — press <Cap tight>g</Cap>, then
            </GroupLabel>
            {/* Column-major so reading down column one, then column two,
                walks the rail top to bottom. Row-major would interleave. */}
            <div
              className="mt-2 grid grid-cols-2 gap-x-3 gap-y-[3px]"
              style={{ gridAutoFlow: "column", gridTemplateRows: "repeat(6, auto)" }}
            >
              {SECTIONS.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5">
                  <Cap tight highlight={s.id === section}>
                    {s.chord}
                  </Cap>
                  <span
                    className="truncate text-[11px]"
                    style={{
                      color: s.id === section ? "var(--s-ink)" : "var(--s-muted)",
                      fontWeight: s.id === section ? 600 : 400,
                    }}
                  >
                    {s.label}
                  </span>
                </div>
              ))}
              {CHORD_EXTRAS.map((e) => (
                <div key={e.key} className="flex items-center gap-1.5">
                  <Cap tight>{e.key}</Cap>
                  <span className="truncate text-[11px]" style={{ color: "var(--s-dim)" }}>
                    {e.label}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <GroupLabel>
                Jump — hold <Cap tight>{PLANE_LABEL[plane]}</Cap>
              </GroupLabel>
              <div className="mt-2 space-y-[3px]">
                <Row keys="1 – 9" desc="the nine most recent" />
                {plane === "alt" ? (
                  <Row keys="a – z" desc="the rest, tagged by name" />
                ) : (
                  <div className="text-[11px]" style={{ color: "var(--s-dim)" }}>
                    Fires from inside the composer too.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right — what works here, active section first. */}
          <div className="p-4">
            <GroupLabel accent>{active?.label ?? ""} — here</GroupLabel>
            <div className="mt-2 space-y-[3px]">
              {contextual.length > 0 ? (
                contextual.map((k) => <Row key={k.keys} keys={k.keys} desc={k.desc} />)
              ) : (
                <div className="text-[11px]" style={{ color: "var(--s-dim)" }}>
                  No section keys — the surface owns its own controls.
                </div>
              )}
            </div>

            <div className="mt-4">
              <GroupLabel>Move — any list</GroupLabel>
              <div className="mt-2 space-y-[3px]">
                {MOVE_KEYS.map((k) => (
                  <Row key={k.keys} keys={k.keys} desc={k.desc} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          className="flex items-center gap-3 px-4 py-2 font-mono text-[10px]"
          style={{ borderTop: "1px solid var(--s-hairline)", color: "var(--s-dim)" }}
        >
          <span>
            <Cap tight>?</Cap> this sheet
          </span>
          <span className="ml-auto">
            <Cap tight>Esc</Cap> close
          </span>
        </div>
      </div>
    </div>
  );
}

function GroupLabel({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em]"
      style={{ color: accent ? "var(--s-accent)" : "var(--s-dim)" }}
    >
      {children}
    </div>
  );
}

function Row({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[86px] flex-none">
        <Cap tight>{keys}</Cap>
      </span>
      <span className="text-[11px]" style={{ color: "var(--s-muted)" }}>
        {desc}
      </span>
    </div>
  );
}

function Cap({
  children,
  tight,
  highlight,
}: {
  children: React.ReactNode;
  tight?: boolean;
  highlight?: boolean;
}) {
  return (
    <span
      className={`inline-block rounded-[3px] font-mono font-bold ${
        tight ? "px-1 py-[0.5px] text-[10px]" : "px-1.5 py-[1px] text-[10px]"
      }`}
      style={{
        color: highlight ? "var(--s-bg)" : "var(--s-ink)",
        background: highlight ? "var(--s-accent)" : "transparent",
        border: `1px solid ${highlight ? "var(--s-accent)" : "var(--s-hairline-strong)"}`,
      }}
    >
      {children}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §6  Legend — the decisions the grammar makes, stated where they can
       be argued with.
   ──────────────────────────────────────────────────────────────────── */

function Legend({ plane }: { plane: JumpPlane }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Note title="Why g owns the prefix">
        Bare <code>g</code>{" "}
        means &ldquo;first row&rdquo; today, which is one key spent on something{" "}
        <code>Home</code> already does. Promoting it to a prefix buys nine
        destinations for the cost of one keystroke, and <code>g g</code>{" "}
        keeps the vim reading of &ldquo;top&rdquo;. Same call the web client&rsquo;s
        plan ratified, so the two clients stay one grammar.
      </Note>
      <Note title="Two letters aren't first letters">
        <code>Tail</code> yields <code>t</code> to Terminals and takes{" "}
        <code>f</code> — <code>tail -f</code>, which is what the surface actually
        is. <code>Code</code> yields <code>c</code> to Comms and takes{" "}
        <code>e</code> for editor. Everything else is its own initial.
      </Note>
      <Note title={`Why ${PLANE_LABEL[plane]} carries the jump`}>
        {plane === "alt" ? (
          <>
            ⌘ is full: ⌘N/K/L/R/O are bound and ⌘1–3 filter the list. ⌥ is
            empty, so digits <em>and</em> letters fit on one plane without
            evicting anything. Cost: ⌥-letter dead keys (é) are shadowed —
            which is why letter tags require the deliberate hold and never fire
            while the composer has focus.
          </>
        ) : (
          <>
            ⌘1–9 is the macOS idiom for &ldquo;nth thing&rdquo; and fires while
            typing without ceremony. Cost: the three comms filters lose ⌘1–3 and
            move to ⌥⌘1–3, and letter tags can't ride ⌘ at all — ⌘L, ⌘K, ⌘N,
            ⌘O and ⌘R already own those letters. Digits only.
          </>
        )}
      </Note>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §7  Port notes — what the Swift side has to do differently, written
       down here because each one was found by trying to write it.
   ──────────────────────────────────────────────────────────────────── */

function PortNotes() {
  return (
    <div className="rounded-lg border border-studio-edge p-5">
      <div className="font-mono text-2xs font-bold uppercase tracking-eyebrow text-studio-ink-faint">
        Port notes — macOS
      </div>
      <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-studio-ink-muted">
        <li>
          <b>The chord palette is Scout-owned, not an edit to the rail.</b>{" "}
          <code>HudSidebarItem</code> has no accessory slot, and HudsonKit is
          currently on another agent&rsquo;s branch. So the palette ships as a
          Scout overlay pinned to the rail&rsquo;s frame — same width, same 26pt
          row pitch, same chrome fill — which reads as the rail lighting up
          rather than a menu appearing. Same resolution the titlebar floating row
          took for the same reason.
        </li>
        <li>
          <b>Key identity: <code>charactersIgnoringModifiers</code>, not{" "}
          <code>keyCode</code>.</b> The studio reads <code>event.code</code>{" "}
          only because the browser composes ⌥+letter into a glyph (⌥d → ∂).
          AppKit hands over the unmodified letter directly, so the mnemonics
          stay layout-dependent — which is correct: they are mnemonics, not
          positions.
        </li>
        <li>
          <b>The hold needs a <code>.flagsChanged</code> monitor.</b>{" "}
          <code>ScoutKeyboardEventMonitor</code> only matched{" "}
          <code>.keyDown</code>; it now takes an event mask and the root mounts
          a second, non-consuming instance for modifier changes.
        </li>
        <li>
          <b>Window resign needs its own handler — flags-changed is not
          enough.</b> A <em>local</em> monitor only sees events aimed at this
          app, so ⌘-up after a ⌘⇥ away never arrives: the digits would stay
          stamped on a window the user already left, and a pending chord would
          wait to eat their next keystroke on return.{" "}
          <code>didResignKeyNotification</code> clears both.
        </li>
        <li>
          <b>The reveal delay gates the hint, never the binding.</b> ⌘1–9 fires
          the instant it is pressed; the 260ms hold only decides whether the
          digits are <em>drawn</em>. Someone who knows the chord never sees a
          flash, someone who hesitates gets taught.
        </li>
        <li>
          <b>The letter tier is designed, not shipped.</b> ⌘ carries digits
          only — ⌘K/L/N/R/O already own the letters it would need. The ⌥ variant
          above is the recorded alternative if the list ever has to reach past
          nine; its tags are prefix-free by construction, which is the part
          worth keeping.
        </li>
        <li>
          <b>The terminal guard stays outermost.</b>{" "}
          <code>ScoutKeyboardInputContext.isTerminalInput</code> already bails
          before any Scout binding; the chord and the jump plane both sit inside
          it. xterm keeps its whole keyboard.
        </li>
        <li>
          <b><code>g</code> must not re-arm.</b> Armed-then-unknown clears and
          stops — it cannot fall through into the arming branch, or{" "}
          <code>g g</code> eats the following keystroke. The web plan logged
          this exact defect; the Swift state machine gets a test for it.
        </li>
      </ul>
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

/* ── Icons — 16px, stroke-only, matching the rail's SF Symbol weights ── */

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
