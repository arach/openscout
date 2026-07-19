"use client";

/**
 * Quick Capture · Magic Motion — interactive motion lab for the two
 * quick-create entries into the HUD Runner: the Hyper+A hotkey and the
 * hot-corner image drop.
 *
 * The audit of the shipped flows (HUDController / HUDCaptureHotZone /
 * HUDRunnerState) found that every transition today is an opacity fade
 * or a state swap: the panel materializes at rest (45ms delay + 100ms
 * fade), the cold receiver is a static amber-stroked rectangle, the
 * dropped image vanishes and reappears as a chip, and submit is a text
 * flash then a fade. The thesis of this study: the magic upgrade is
 * object permanence and a little physics, not more chrome.
 *
 * Two rigs:
 *   1. The STAGE — a simulated desktop that plays the full choreography
 *      end to end (drag, drop, submit), switchable Current ⇄ Proposed.
 *      Good for feel; bad for judging deltas (sequential A/B relies on
 *      motion memory).
 *   2. The SIDE-BY-SIDE — each moment plays Current and Proposed
 *      simultaneously in twin panes off one clock, defaulting to ¼×.
 *      This is where the difference actually reads. Review feedback
 *      ("status quo and proposed look very close") drove this rig.
 *
 * Minimal-first contract demonstrated, not asserted: in the minimal
 * composer the project token in the routing line is click-to-switch
 * (popover picker), and ⇥ expands the full routing surface. Minimal
 * never locks you in.
 *
 * The ledger maps each moment to its Swift call site; the token table
 * proposes a HUDMotion vocabulary so easing stops being inline literals.
 * Prototype only — HTML stands in for NSPanel; springs approximated
 * with CSS linear() easings.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { EyebrowLabel } from "@/components/EyebrowLabel";
import "./magic.css";

/* ────────────────────────────────────────────────────────────────────
   Types + constants
   ──────────────────────────────────────────────────────────────────── */

type Mode = "current" | "proposed";
type Phase = "idle" | "open" | "submitting" | "departing" | "closing";
type Anchor = "center" | "corner";
type Layout = "full" | "minimal";

const SHOT_NAME = "Screen 2026-07-17 at 9.41.png";

/** Receiver geometry in stage px (stands in for the 112×82pt panel). */
const RECV = { left: 14, bottom: 14, w: 140, h: 100 };

const PROJECTS = [
  { name: "openscout", path: "~/dev/openscout" },
  { name: "hudson", path: "~/dev/hudson" },
  { name: "talkie", path: "~/dev/talkie" },
  { name: "dewey", path: "~/dev/dewey" },
];

/* ────────────────────────────────────────────────────────────────────
   Tiny inline glyphs (stroke = currentColor)
   ──────────────────────────────────────────────────────────────────── */

function Glyph({ d, size = 14, sw = 1.6 }: { d: string; size?: number; sw?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const G = {
  plusBubble: "M2 3.5h12v8H9l-3 3v-3H2zM8 5v5M5.5 7.5h5",
  plus: "M8 3v10M3 8h10",
  arrowUp: "M8 13V3M4 7l4-4 4 4",
  mic: "M8 2.5a2 2 0 0 1 2 2v4a2 2 0 1 1-4 0v-4a2 2 0 0 1 2-2zM3.5 8.5a4.5 4.5 0 0 0 9 0M8 13v1.5",
  docDown: "M4 2h5l3 3v9H4zM9 2v3h3M8 7v4M6 9.5 8 11.5l2-2",
  chevron: "M5 6.5 8 9.5l3-3",
};

/* ────────────────────────────────────────────────────────────────────
   The full interactive stage
   ──────────────────────────────────────────────────────────────────── */

function MotionStage() {
  const [mode, setMode] = useState<Mode>("proposed");
  const [slow, setSlow] = useState(false);
  const [layout, setLayout] = useState<Layout>("full");
  const [sound, setSound] = useState(true);

  const [phase, setPhase] = useState<Phase>("idle");
  const [anchor, setAnchor] = useState<Anchor>("center");
  const [attached, setAttached] = useState(false);
  const [incoming, setIncoming] = useState(false);
  const [flash, setFlash] = useState(false);
  const [toast, setToast] = useState(false);
  const [glyphPulse, setGlyphPulse] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [project, setProject] = useState(PROJECTS[0]);
  const [picker, setPicker] = useState(false);
  const [text, setText] = useState(
    "Fix the flaky media-blobs retry test and tighten the backoff.",
  );

  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [snapback, setSnapback] = useState(false);
  const [zone, setZone] = useState({ near: false, over: false });
  const [ghost, setGhost] = useState<
    { x: number; y: number; w: number; h: number; r: number } | null
  >(null);
  const [departVec, setDepartVec] = useState<{ x: number; y: number } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const shotRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const glyphRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragStart = useRef<{ px: number; py: number } | null>(null);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audio = useRef<AudioContext | null>(null);

  const spd = slow ? 4 : 1;

  const later = useCallback(
    (fn: () => void, ms: number) => {
      timeouts.current.push(setTimeout(fn, ms * (slow ? 4 : 1)));
    },
    [slow],
  );

  const clearTimers = useCallback(() => {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setAttached(false);
    setIncoming(false);
    setFlash(false);
    setToast(false);
    setGlyphPulse(false);
    setLaunching(false);
    setImporting(false);
    setPicker(false);
    setDrag(null);
    setSnapback(false);
    setZone({ near: false, over: false });
    setGhost(null);
    setDepartVec(null);
  }, [clearTimers]);

  const switchMode = (m: Mode) => {
    reset();
    setMode(m);
  };

  /* ── sound — synthesized, no assets ─────────────────────────────── */

  const blip = useCallback(
    (kind: "pop" | "tick") => {
      if (!sound) return;
      try {
        audio.current ??= new AudioContext();
        const ctx = audio.current;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        if (kind === "pop") {
          o.frequency.setValueAtTime(520, t);
          o.frequency.exponentialRampToValueAtTime(920, t + 0.09);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
        } else {
          o.frequency.setValueAtTime(660, t);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.04, t + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        }
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.2);
      } catch {
        /* audio unavailable — fine */
      }
    },
    [sound],
  );

  /* ── open / close / submit ──────────────────────────────────────── */

  const openComposer = useCallback(
    (from: Anchor) => {
      setAnchor(from);
      setPicker(false);
      setPhase("open");
      later(() => inputRef.current?.focus(), mode === "current" ? 180 : 380);
    },
    [later, mode],
  );

  const close = useCallback(() => {
    setPicker(false);
    setPhase("closing");
    later(() => {
      setPhase("idle");
      setAttached(false);
      setIncoming(false);
      setFlash(false);
    }, 190);
  }, [later]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc cascade, matching the real composer: picker → composer.
      if (picker) setPicker(false);
      else if (phase === "open") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, picker, close]);

  const submit = useCallback(() => {
    if (phase !== "open" || !text.trim()) return;
    setPicker(false);
    setPhase("submitting");
    if (mode === "current") {
      // Today: spinner → text flash → 700ms wait → 140ms fade in place.
      later(() => setFlash(true), 420);
      later(() => setPhase("closing"), 1120);
      later(() => {
        setPhase("idle");
        setAttached(false);
        setFlash(false);
      }, 1270);
    } else {
      // Proposed: arrow launches → pop → panel travels to the glyph.
      setLaunching(true);
      later(() => {
        const p = panelRef.current?.getBoundingClientRect();
        const g = glyphRef.current?.getBoundingClientRect();
        if (p && g) {
          setDepartVec({
            x: g.left + g.width / 2 - (p.left + p.width / 2),
            y: g.top + g.height / 2 - (p.top + p.height / 2),
          });
        }
        setPhase("departing");
        blip("pop");
        setGlyphPulse(true);
        later(() => setGlyphPulse(false), 680);
        later(() => setToast(true), 260);
        later(() => {
          setPhase("idle");
          setAttached(false);
          setLaunching(false);
        }, 450);
        later(() => setToast(false), 2400);
      }, 460);
    }
  }, [phase, text, mode, later, blip]);

  /* ── drag: the screenshot → hot corner ──────────────────────────── */

  const onShotDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "idle") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY };
    setSnapback(false);
    setDrag({ dx: 0, dy: 0 });
  };

  const onShotMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !dragStart.current || !stageRef.current) return;
    setDrag({
      dx: e.clientX - dragStart.current.px,
      dy: e.clientY - dragStart.current.py,
    });
    const s = stageRef.current.getBoundingClientRect();
    const lx = e.clientX - s.left;
    const ly = e.clientY - s.top;
    const near = Math.hypot(lx, s.height - ly) < 190;
    const over =
      lx >= RECV.left - 12 &&
      lx <= RECV.left + RECV.w + 12 &&
      ly >= s.height - RECV.bottom - RECV.h - 12;
    setZone({ near: near || over, over });
  };

  const onShotUp = () => {
    if (!drag) return;
    if (zone.over) {
      doDrop();
    } else {
      setSnapback(true);
      setDrag({ dx: 0, dy: 0 });
      later(() => {
        setSnapback(false);
        setDrag(null);
      }, 280);
    }
    setZone({ near: false, over: false });
    dragStart.current = null;
  };

  const doDrop = () => {
    const s = stageRef.current?.getBoundingClientRect();
    const shot = shotRef.current?.getBoundingClientRect();
    setDrag(null);
    setSnapback(false);
    if (!s || !shot) return;

    if (mode === "current") {
      // Today: "IMPORTING…" beat, receiver vanishes, panel fades in with
      // the chip already present. The image teleports.
      setImporting(true);
      later(() => {
        setImporting(false);
        setAttached(true);
        openComposer("corner");
      }, 260);
    } else {
      // Proposed: the image never disappears. A ghost holds the drop
      // point while the panel grows out of the corner, then flies into
      // the capture strip and lands with the boing.
      setGhost({
        x: shot.left - s.left + 10,
        y: shot.top - s.top,
        w: 96,
        h: 70,
        r: 7,
      });
      setIncoming(true);
      openComposer("corner");
      blip("tick");
      later(() => {
        const slot = slotRef.current?.getBoundingClientRect();
        const st = stageRef.current?.getBoundingClientRect();
        if (slot && st) {
          setGhost((g) =>
            g && {
              x: slot.left - st.left,
              y: slot.top - st.top,
              w: slot.width,
              h: slot.height,
              r: 5,
            },
          );
        }
      }, 400);
      later(() => {
        setGhost(null);
        setIncoming(false);
        setAttached(true);
      }, 740);
    }
  };

  /* ── render ─────────────────────────────────────────────────────── */

  const panelVisible = phase !== "idle";
  const receiverOn = (!!drag && zone.near) || importing;
  const effLayout: Layout = mode === "current" ? "full" : layout;

  const panelCls = [
    "qcm-panel",
    anchor,
    phase === "open" || phase === "submitting"
      ? mode === "current"
        ? "arrive-cur"
        : anchor === "corner"
          ? "arrive-pro-corner"
          : "arrive-pro-center"
      : "",
    phase === "departing" ? "depart" : "",
    phase === "closing" ? (mode === "current" ? "exit-cur" : "exit-pro") : "",
  ]
    .filter(Boolean)
    .join(" ");

  const panelStyle: CSSProperties = departVec
    ? ({ "--dep-x": `${departVec.x}px`, "--dep-y": `${departVec.y}px` } as CSSProperties)
    : {};

  const shotStyle: CSSProperties = {
    left: "64%",
    top: "30%",
    transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
  };

  const projectPicker = picker && (
    <div
      className="qcm-pop"
      style={effLayout === "minimal" ? { left: 14, top: 36 } : { left: 16, top: 118 }}
    >
      <div className="qcm-pop-label">SWITCH PROJECT</div>
      {PROJECTS.map((p) => (
        <button
          key={p.name}
          type="button"
          className={`qcm-pop-item${p.name === project.name ? " sel" : ""}`}
          onClick={() => {
            setProject(p);
            setPicker(false);
            inputRef.current?.focus();
          }}
        >
          <span>{p.name}</span>
          <span className="path">{p.path}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {/* controls */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Seg
          label="mode"
          value={mode}
          onChange={(v) => switchMode(v as Mode)}
          options={[
            { value: "current", label: "Current" },
            { value: "proposed", label: "Proposed" },
          ]}
        />
        <Seg
          label="speed"
          value={slow ? "slow" : "full"}
          onChange={(v) => setSlow(v === "slow")}
          options={[
            { value: "full", label: "1×" },
            { value: "slow", label: "¼× slow-mo" },
          ]}
        />
        <Seg
          label="composer"
          value={effLayout}
          onChange={(v) => setLayout(v as Layout)}
          disabled={mode === "current"}
          options={[
            { value: "full", label: "Full" },
            { value: "minimal", label: "Minimal" },
          ]}
        />
        <Seg
          label="sound"
          value={sound && mode === "proposed" ? "on" : "off"}
          onChange={(v) => setSound(v === "on")}
          disabled={mode === "current"}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => openComposer("center")}
            disabled={phase !== "idle"}
            className="focus-ring rounded border border-studio-edge-strong bg-studio-surface px-2.5 py-1 font-mono text-[9.5px] font-semibold text-studio-ink hover:border-scout-accent disabled:opacity-40"
          >
            ⌃⌥⇧⌘A · open composer
          </button>
          <button
            type="button"
            onClick={reset}
            className="focus-ring rounded border border-studio-edge px-2.5 py-1 font-mono text-[9.5px] font-semibold text-studio-ink-faint hover:text-studio-ink"
          >
            reset
          </button>
        </div>
      </div>

      {/* the stage */}
      <div ref={stageRef} className="qcm-stage" style={{ "--spd": spd } as CSSProperties}>
        {/* menu bar */}
        <div className="qcm-menubar">
          <div>
            <span style={{ fontWeight: 700 }}>Scout</span>
            <span style={{ opacity: 0.55 }}>File</span>
            <span style={{ opacity: 0.55 }}>Edit</span>
            <span style={{ opacity: 0.55 }}>View</span>
          </div>
          <div>
            <div ref={glyphRef} className={`qcm-glyph${glyphPulse ? " pulse" : ""}`} />
            <span>Thu 9:41 AM</span>
          </div>
        </div>

        {/* hot-corner affordance + receiver */}
        <div className="qcm-corner-mark" aria-hidden />
        <div
          className={[
            "qcm-receiver",
            mode === "current" ? "cur" : "pro",
            receiverOn ? "on" : "",
            zone.over ? "targeted" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {mode === "proposed" && (
            <span className="qcm-recv-icon">
              <Glyph d={G.docDown} size={20} sw={1.3} />
            </span>
          )}
          <span className="qcm-recv-label">
            {importing ? "IMPORTING…" : zone.over ? "RELEASE" : "DROP TASK"}
          </span>
        </div>

        {/* draggable screenshot */}
        <div
          ref={shotRef}
          className={[
            "qcm-shot",
            drag ? "dragging" : "",
            snapback ? "snapback" : "",
            phase !== "idle" ? "dim" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={shotStyle}
          onPointerDown={onShotDown}
          onPointerMove={onShotMove}
          onPointerUp={onShotUp}
        >
          <div className="qcm-shot-thumb" />
          <span className="qcm-shot-name">{SHOT_NAME}</span>
        </div>

        {/* flying ghost — drop continuity */}
        {ghost && (
          <div
            className="qcm-ghost"
            style={{
              left: ghost.x,
              top: ghost.y,
              width: ghost.w,
              height: ghost.h,
              borderRadius: ghost.r,
            }}
          />
        )}

        {/* the composer panel */}
        {panelVisible && (
          <div ref={panelRef} className={panelCls} style={panelStyle}>
            {effLayout === "full" ? (
              <>
                <div className="qcm-head">
                  <div className="qcm-head-icon">
                    <Glyph d={G.plusBubble} size={16} sw={1.3} />
                  </div>
                  <div>
                    <div className="qcm-eyebrow">NEW TASK</div>
                    <div className="qcm-title">Send work to an agent</div>
                  </div>
                  <div className="qcm-head-spacer" />
                  <span className="qcm-tag accent">
                    <span className="dot" />
                    SCOUT
                  </span>
                  <span className="qcm-tag">ESC</span>
                </div>
                <div className="qcm-hairline" />
                <div className="qcm-route-cards">
                  <div
                    className="qcm-route-card click"
                    onClick={() => setPicker((p) => !p)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="qcm-route-k">PROJECT</div>
                    <div className="qcm-route-v">
                      {project.name} <span>· {project.path}</span>
                    </div>
                  </div>
                  <div className="qcm-route-card">
                    <div className="qcm-route-k">RUNTIME</div>
                    <div className="qcm-route-v">
                      claude <span>· Opus 4.8</span>
                    </div>
                  </div>
                </div>
                <div className="qcm-msg-label">MESSAGE</div>
              </>
            ) : (
              <div className="qcm-route-line">
                <span className="arrow-glyph">→</span>
                <button
                  type="button"
                  className="qcm-route-proj"
                  onClick={() => setPicker((p) => !p)}
                >
                  {project.name} <Glyph d={G.chevron} size={9} />
                </button>
                <span className="val">· claude · Opus 4.8 · {project.path}</span>
                <span className="hint">⇥ ROUTING</span>
              </div>
            )}

            {projectPicker}

            <div className={`qcm-composer${effLayout === "minimal" ? " roomy" : ""}`}>
              <textarea
                ref={inputRef}
                className="qcm-input"
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                  } else if (e.key === "Tab" && effLayout === "minimal") {
                    // ⇥ expands routing — minimal never locks you in.
                    e.preventDefault();
                    setLayout("full");
                  }
                }}
                placeholder="Describe the task — what should the agent build, fix, or investigate?"
                spellCheck={false}
              />
              {(attached || incoming) && (
                <div className="qcm-strip">
                  <div className={`qcm-chip-file ${attached ? "land" : "incoming"}`}>
                    <div ref={slotRef} className="qcm-chip-thumb" />
                    <div className="qcm-chip-meta">
                      <div className="qcm-chip-name">{SHOT_NAME}</div>
                      <div className="qcm-chip-size">184 KB · png</div>
                    </div>
                    <span className="qcm-chip-x">×</span>
                  </div>
                </div>
              )}
              <div className="qcm-toolbar">
                <button type="button" className="qcm-tool" aria-label="Attach">
                  <Glyph d={G.plus} />
                </button>
                <span className="qcm-runtime">
                  claude · opus 4.8 <Glyph d={G.chevron} size={10} />
                </span>
                <button type="button" className="qcm-tool" aria-label="Dictate">
                  <Glyph d={G.mic} />
                </button>
                <button
                  type="button"
                  className={`qcm-send${launching ? " launch" : ""}`}
                  onClick={submit}
                  disabled={phase !== "open"}
                  aria-label="Send"
                >
                  <span className="qcm-send-arrow">
                    <Glyph d={G.arrowUp} sw={2} />
                  </span>
                  {phase === "submitting" && <span className="qcm-spinner" />}
                </button>
              </div>
            </div>

            {flash && <div className="qcm-flash">● started scout · a1b2c3</div>}
            <div className="qcm-hintline">
              <span>⌘↩ SEND</span>
              <span>ESC DISMISS</span>
            </div>
          </div>
        )}

        {/* post-departure toast */}
        {toast && (
          <div className="qcm-toast">
            <span className="dot" />
            started scout · a1b2c3
          </div>
        )}

        {/* idle hint */}
        {phase === "idle" && !drag && (
          <div className="qcm-hint">
            press the hotkey button above — or drag the screenshot into the corner
          </div>
        )}
      </div>
    </div>
  );
}

/* ── segmented control (studio chrome) ─────────────────────────────── */

function Seg({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2${disabled ? " opacity-40" : ""}`}>
      <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
        {label}
      </span>
      <div className="flex overflow-hidden rounded border border-studio-edge">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={[
              "focus-ring px-2 py-1 font-mono text-[9.5px] font-semibold",
              o.value === value
                ? "bg-studio-surface text-scout-accent"
                : "text-studio-ink-faint hover:text-studio-ink",
            ].join(" ")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Side-by-side compare rig — twin panes, one clock.
   Sequential toggle-and-remember hides motion deltas; synchronized
   playback is the honest comparison. Defaults to ¼×.
   ──────────────────────────────────────────────────────────────────── */

function useScript() {
  const [fired, setFired] = useState<Set<string>>(() => new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => stop, [stop]);
  const play = useCallback(
    (script: [number, string][], spd: number) => {
      stop();
      setFired(new Set(["run"]));
      for (const [ms, name] of script) {
        timers.current.push(
          setTimeout(() => setFired((p) => new Set(p).add(name)), ms * spd),
        );
      }
    },
    [stop],
  );
  return { fired, play };
}

function MomentCard({
  title,
  blurb,
  onReplay,
  children,
}: {
  title: string;
  blurb: string;
  onReplay: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-studio-edge bg-studio-canvas-alt p-3">
      <div className="mb-2 flex items-baseline gap-3">
        <span className="font-sans text-[12px] font-semibold text-studio-ink">{title}</span>
        <span className="hidden font-sans text-[10.5px] text-studio-ink-faint md:inline">
          {blurb}
        </span>
        <button
          type="button"
          onClick={onReplay}
          className="focus-ring ml-auto rounded border border-studio-edge-strong px-2 py-0.5 font-mono text-[9px] font-semibold text-studio-ink hover:border-scout-accent"
        >
          ▶ play both
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Pane({
  variant,
  spd,
  glyphPulse,
  glyphRef,
  children,
}: {
  variant: "cur" | "pro";
  spd: number;
  glyphPulse?: boolean;
  glyphRef?: React.Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className="qcm-stage qcm-pane" style={{ "--spd": spd } as CSSProperties}>
      <span className={`qcm-pane-tag${variant === "pro" ? " accent" : ""}`}>
        {variant === "cur" ? "CURRENT" : "PROPOSED"}
      </span>
      <div className="qcm-pane-glyph">
        <div ref={glyphRef} className={`qcm-glyph${glyphPulse ? " pulse" : ""}`} />
      </div>
      {children}
    </div>
  );
}

function MiniPanel({
  className,
  withStrip,
  chipState,
  slotRef,
  flash,
  sendState,
  panelRef,
  style,
}: {
  className?: string;
  withStrip?: boolean;
  chipState?: "incoming" | "land";
  slotRef?: React.Ref<HTMLDivElement>;
  flash?: boolean;
  sendState?: "idle" | "launch" | "spin";
  panelRef?: React.Ref<HTMLDivElement>;
  style?: CSSProperties;
}) {
  return (
    <div ref={panelRef} className={`qcm-mini ${className ?? ""}`} style={style}>
      <div className="qcm-mini-head">
        <div className="qcm-mini-icon">
          <Glyph d={G.plusBubble} size={12} sw={1.4} />
        </div>
        <div>
          <div className="qcm-mini-eyebrow">NEW TASK</div>
          <div className="qcm-mini-title">Send work to an agent</div>
        </div>
      </div>
      <div className="qcm-mini-well">Fix the flaky media-blobs retry test.</div>
      {withStrip && (
        <div className="qcm-mini-strip">
          <div className={`qcm-mini-chip ${chipState ?? ""}`}>
            <div ref={slotRef} className="qcm-chip-thumb" />
            <span>Screen…9.41.png</span>
          </div>
        </div>
      )}
      {flash && <div className="qcm-mini-flash">● started scout · a1b2c3</div>}
      <div className="qcm-mini-bar">
        <button
          type="button"
          className={`qcm-mini-send${sendState === "launch" ? " launch" : ""}`}
          aria-label="Send"
        >
          <span className="qcm-send-arrow">
            <Glyph d={G.arrowUp} size={11} sw={2} />
          </span>
          {sendState === "spin" && <span className="qcm-spinner" />}
        </button>
      </div>
    </div>
  );
}

/* 1 · Arrival — fade-at-rest vs settle spring. */
function ArrivalDemo({ spd }: { spd: number }) {
  const { fired, play } = useScript();
  const run = fired.has("run");
  return (
    <MomentCard
      title="Arrival"
      blurb="45ms + 100ms fade at rest vs settle spring (scale .98→1 + rise). Deliberately subtle — ~2% of motion."
      onReplay={() => play([], spd)}
    >
      <Pane variant="cur" spd={spd}>
        {run && <MiniPanel className="qcm-anim-arrive-cur" />}
      </Pane>
      <Pane variant="pro" spd={spd}>
        {run && <MiniPanel className="qcm-anim-arrive-pro" />}
      </Pane>
    </MomentCard>
  );
}

/* 2 · Receiver — pops when you're already there vs meets you halfway. */
function ReceiverDemo({ spd }: { spd: number }) {
  const { fired, play } = useScript();
  const run = fired.has("run");
  const approach = fired.has("approach");
  const near = fired.has("near");
  const over = fired.has("over");
  const fileStyle: CSSProperties = over
    ? { left: 24, top: "calc(100% - 104px)" }
    : approach
      ? { left: 40, top: "calc(100% - 128px)" }
      : { left: "58%", top: "20%" };

  const file = (
    <div className="qcm-demo-file" style={fileStyle}>
      <div className="qcm-shot-thumb" />
    </div>
  );

  return (
    <MomentCard
      title="Receiver"
      blurb="Today it appears only once you're already at the corner, static, amber. Proposed opens to meet the drag and breathes when targeted."
      onReplay={() => play([[30, "approach"], [650, "near"], [1050, "over"]], spd)}
    >
      <Pane variant="cur" spd={spd}>
        {run && file}
        <div
          className={`qcm-receiver cur${over ? " on targeted" : ""}`}
        >
          <span className="qcm-recv-label">{over ? "RELEASE" : "DROP TASK"}</span>
        </div>
      </Pane>
      <Pane variant="pro" spd={spd}>
        {run && file}
        <div
          className={`qcm-receiver pro${near ? " on" : ""}${over ? " targeted" : ""}`}
        >
          <span className="qcm-recv-icon">
            <Glyph d={G.docDown} size={18} sw={1.3} />
          </span>
          <span className="qcm-recv-label">{over ? "RELEASE" : "DROP TASK"}</span>
        </div>
      </Pane>
    </MomentCard>
  );
}

/* 3 · Drop continuity — teleport vs travel. */
function DropDemo({ spd }: { spd: number }) {
  const { fired, play } = useScript();
  const paneRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<
    { x: number; y: number; w: number; h: number } | null
  >(null);

  const run = fired.has("run");
  const drop = fired.has("drop");
  const panelin = fired.has("panelin");
  const flight = fired.has("flight");
  const landed = fired.has("landed");

  // Ghost lifecycle: appear at the corner on drop, fly to the measured
  // chip slot on flight, unmount on landed.
  useEffect(() => {
    if (drop && !flight && !ghost) {
      setGhost({ x: 26, y: (paneRef.current?.clientHeight ?? 260) - 96, w: 64, h: 46 });
    }
    if (flight && ghost && slotRef.current && paneRef.current) {
      const slot = slotRef.current.getBoundingClientRect();
      const pane = paneRef.current.getBoundingClientRect();
      const target = {
        x: slot.left - pane.left,
        y: slot.top - pane.top,
        w: slot.width,
        h: slot.height,
      };
      if (ghost.x !== target.x || ghost.y !== target.y) setGhost(target);
    }
    if (landed && ghost) setGhost(null);
  }, [drop, flight, landed, ghost]);

  const replay = () => {
    setGhost(null);
    play(
      [
        [30, "drop"],
        [300, "panelin"],
        [430, "flight"],
        [780, "landed"],
      ],
      spd,
    );
  };

  const idleFile = (hidden: boolean) => (
    <div
      className="qcm-demo-file"
      style={{ left: 26, top: "calc(100% - 100px)", opacity: hidden ? 0 : 1, transition: "none" }}
    >
      <div className="qcm-shot-thumb" />
    </div>
  );

  return (
    <MomentCard
      title="Drop continuity"
      blurb="Today the image vanishes and a chip reappears after the IPC round-trip. Proposed: it never disappears — a ghost flies into the strip."
      onReplay={replay}
    >
      <Pane variant="cur" spd={spd}>
        {idleFile(drop)}
        <div className={`qcm-receiver cur${drop && !panelin ? " on targeted" : ""}`}>
          <span className="qcm-recv-label">IMPORTING…</span>
        </div>
        {panelin && (
          <MiniPanel className="corner qcm-anim-arrive-cur" withStrip chipState={undefined} />
        )}
      </Pane>
      <Pane variant="pro" spd={spd}>
        <div ref={paneRef} style={{ position: "absolute", inset: 0 }}>
          {idleFile(drop)}
          <div className={`qcm-receiver pro${run && !drop ? " on targeted" : ""}`}>
            <span className="qcm-recv-icon">
              <Glyph d={G.docDown} size={18} sw={1.3} />
            </span>
            <span className="qcm-recv-label">RELEASE</span>
          </div>
          {drop && (
            <MiniPanel
              className="corner qcm-anim-grow"
              withStrip
              chipState={landed ? "land" : "incoming"}
              slotRef={slotRef}
            />
          )}
          {ghost && (
            <div
              className="qcm-ghost"
              style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}
            />
          )}
        </div>
      </Pane>
    </MomentCard>
  );
}

/* 4 · Departure — flash-and-fade in place vs travel to the glyph. */
function DepartureDemo({ spd }: { spd: number }) {
  const { fired, play } = useScript();
  const proPanelRef = useRef<HTMLDivElement>(null);
  const glyphRef = useRef<HTMLDivElement>(null);
  const [vec, setVec] = useState<{ x: number; y: number } | null>(null);

  const run = fired.has("run");
  const submitted = fired.has("submit");
  const flash = fired.has("flash");
  const depart = fired.has("depart");
  const toast = fired.has("toast");
  const fadeout = fired.has("fadeout");

  useEffect(() => {
    if (depart && !vec && proPanelRef.current && glyphRef.current) {
      const p = proPanelRef.current.getBoundingClientRect();
      const g = glyphRef.current.getBoundingClientRect();
      setVec({
        x: g.left + g.width / 2 - (p.left + p.width / 2),
        y: g.top + g.height / 2 - (p.top + p.height / 2),
      });
    }
  }, [depart, vec]);

  const replay = () => {
    setVec(null);
    play(
      [
        [30, "submit"],
        [450, "flash"],
        [490, "depart"],
        [740, "toast"],
        [1150, "fadeout"],
      ],
      spd,
    );
  };

  const departStyle: CSSProperties = vec
    ? ({ "--dep-x": `${vec.x}px`, "--dep-y": `${vec.y}px` } as CSSProperties)
    : {};

  return (
    <MomentCard
      title="Departure"
      blurb="Today: text flash, 700ms wait, fade in place — no sound, no destination. Proposed: arrow launch, pop, the panel travels to the glyph."
      onReplay={replay}
    >
      <Pane variant="cur" spd={spd}>
        <MiniPanel
          className={fadeout ? "qcm-anim-fadeout" : ""}
          flash={flash}
          sendState={submitted && !flash ? "spin" : "idle"}
        />
      </Pane>
      <Pane variant="pro" spd={spd} glyphPulse={depart} glyphRef={glyphRef}>
        <MiniPanel
          panelRef={proPanelRef}
          className={depart && vec ? "qcm-anim-depart" : ""}
          style={departStyle}
          sendState={submitted && !depart ? "launch" : "idle"}
        />
        {toast && (
          <div className="qcm-mini-toast">
            <span
              className="dot"
              style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }}
            />
            started scout · a1b2c3
          </div>
        )}
      </Pane>
    </MomentCard>
  );
}

function CompareSection() {
  const [slow, setSlow] = useState(true);
  const spd = slow ? 4 : 1;
  return (
    <div>
      <div className="mb-3 flex items-center gap-5">
        <Seg
          label="speed"
          value={slow ? "slow" : "full"}
          onChange={(v) => setSlow(v === "slow")}
          options={[
            { value: "slow", label: "¼× slow-mo" },
            { value: "full", label: "1×" },
          ]}
        />
        <span className="font-sans text-[11px] text-studio-ink-faint">
          both panes run off one clock — press play and watch them diverge
        </span>
      </div>
      <div className="space-y-4">
        <ArrivalDemo spd={spd} />
        <ReceiverDemo spd={spd} />
        <DropDemo spd={spd} />
        <DepartureDemo spd={spd} />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Reference tables
   ──────────────────────────────────────────────────────────────────── */

const MOMENTS: { moment: string; today: string; proposed: string; port: string }[] = [
  {
    moment: "Arrival",
    today:
      "45ms warm delay → 100ms opacity fade, at final position and scale. The panel materializes; nothing moves.",
    proposed:
      "Same speed, ~2% of motion: scale .98→1 + 8pt rise on a settle spring (~300ms, one soft overshoot). From the hot corner, the panel grows out of the receiver — transform-origin at the corner — so the drop target visibly becomes the composer.",
    port: "HUDController.swift:417–429 (warmAndFadeIn / fadeIn)",
  },
  {
    moment: "Receiver",
    today:
      "Pops in with zero animation. Feedback is fill 7.5%→10% white + a stroke swap to amber — an off-palette outlier. Text only.",
    proposed:
      "Springs from the corner (scale .55→1, ~220ms settle) when a drag approaches; targeted = +5% scale, lime accent, breathing 1.2s border, doc-arrow icon. Re-skinned on HUDChrome tokens; the amber dies.",
    port: "HUDCaptureHotZone.swift:541–745 (HUDCaptureReceiverPanel/View)",
  },
  {
    moment: "Drop continuity",
    today:
      "The image vanishes at the drop point; the payload round-trips through IPC and reappears as a chip. Teleportation, not travel.",
    proposed:
      "A ghost thumbnail persists at the drop point while the panel grows beneath it, then flies into the capture strip (~300ms travel spring) and lands as the chip with the existing boing (HUDFlashRow spring: response .32 / damping .58).",
    port: "ScoutHUDRouter.swift:107–129 (task-capture) + HUDRunnerState.stageCapture",
  },
  {
    moment: "Departure",
    today:
      "Success = a one-line text flash ('started ⟨handle⟩'), a 700ms wait, then a 140ms fade in place. No sound — the only audio in the flow is a failure beep.",
    proposed:
      "⌘↩ launches the arrow out of the send button (~180ms), a soft synthesized pop, then the panel shrinks and travels to the menu-bar glyph (~430ms). The glyph pulses; a toast confirms. The task visibly goes somewhere.",
    port: "HUDRunnerState.swift:1152–1284 (submit) + HUDController.swift:219–222 (dismiss)",
  },
  {
    moment: "Focus layout",
    today:
      "640×406 always: header + routing surface + section labels, even when every capture accepts the defaults.",
    proposed:
      "Minimal-first: editor + toolbar + one quiet routing summary line (~640×230). The project token is click-to-switch; ⇥ expands full routing with the existing disclosure spring. The fast path looks as fast as it is — and never locks you in.",
    port: "HUDRunnerView.swift:42–58 (HUDRunnerLayout.contentSize)",
  },
];

const TOKENS: { token: string; spec: string; used: string }[] = [
  { token: "hudMotion.snap", spec: "120ms · easeOut", used: "hovers, chip remove, small state flips" },
  {
    token: "hudMotion.settle",
    spec: "spring(response .28, damping .85)",
    used: "panel arrival, receiver entrance, drag snap-back",
  },
  {
    token: "hudMotion.boing",
    spec: "spring(response .32, damping .58)",
    used: "chip landing, flash row — already exists in HUDFlashRow.swift:111",
  },
  {
    token: "hudMotion.travel",
    spec: "spring(response .34, damping .90)",
    used: "continuity flights (ghost → strip), panel departure",
  },
  { token: "hudMotion.exit", spec: "140–180ms · easeIn", used: "esc dismiss, fades out" },
  {
    token: "hudMotion.breathe",
    spec: "1.2s · easeInOut · repeat",
    used: "targeted drop border, attention ring",
  },
];

function Cell({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <td
      className={`border-t border-studio-edge px-3 py-2.5 align-top text-[11px] leading-relaxed ${
        mono ? "font-mono text-[10px] text-studio-ink-muted" : "font-sans text-studio-ink-muted"
      }`}
    >
      {children}
    </td>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-3 pb-2 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
      {children}
    </th>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export default function QuickCaptureMagicPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <EyebrowLabel size="sm">· studies · macos · quick capture</EyebrowLabel>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Quick Capture · Magic Motion
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Motion lab for the two quick-create entries into the HUD Runner — the
          Hyper+A hotkey and the hot-corner image drop. The audit found every
          transition today is an opacity fade or a state swap; the thesis here
          is that the magic upgrade is <em>object permanence and a little
          physics</em>, not more chrome. Two rigs: the side-by-side compare
          (where the deltas actually read) and the full interactive stage
          (where the feel lives).
        </p>
      </header>

      <section className="mb-10">
        <EyebrowLabel as="h2" size="sm">
          side-by-side — the same moment, one clock, two treatments
        </EyebrowLabel>
        <p className="mb-3 mt-2 max-w-prose font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">
          Toggling a single stage between Current and Proposed asks you to
          compare against motion memory, and the deltas vanish. Here each
          moment plays both treatments simultaneously. Honest framing: Arrival
          is deliberately subtle (~2% motion at the same speed). The headline
          differences are <span className="text-studio-ink">Receiver</span>,{" "}
          <span className="text-studio-ink">Drop continuity</span> and{" "}
          <span className="text-studio-ink">Departure</span> — moments where
          today literally nothing moves.
        </p>
        <CompareSection />
      </section>

      <section className="mb-10">
        <EyebrowLabel as="h2" size="sm">
          the full choreography — interactive stage
        </EyebrowLabel>
        <div className="mt-3">
          <MotionStage />
        </div>
        <p className="mt-3 max-w-prose font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">
          Drive it: <span className="font-mono text-[10px]">hotkey button</span> opens
          centered; dragging the screenshot toward the bottom-left corner wakes the
          receiver; releasing on it grows the composer out of the corner while the
          thumbnail flies into the capture strip;{" "}
          <span className="font-mono text-[10px]">⌘↩</span> submits and the panel
          departs to the menu-bar glyph. In the <em>Minimal</em> composer, click the
          project token to switch projects in place, and{" "}
          <span className="font-mono text-[10px]">⇥</span> expands full routing —
          minimal never locks you in. <span className="font-mono text-[10px]">esc</span>{" "}
          walks back: picker → composer.
        </p>
      </section>

      <section className="mb-10">
        <EyebrowLabel as="h2" size="sm">
          moment ledger — today vs proposed, with port targets
        </EyebrowLabel>
        <div className="mt-3 overflow-x-auto rounded-lg border border-studio-edge bg-studio-canvas-alt">
          <table className="w-full min-w-[840px] border-collapse">
            <thead>
              <tr>
                <Th>Moment</Th>
                <Th>Today (measured)</Th>
                <Th>Proposed</Th>
                <Th>Port target</Th>
              </tr>
            </thead>
            <tbody>
              {MOMENTS.map((m) => (
                <tr key={m.moment}>
                  <Cell>
                    <span className="font-sans text-[11px] font-semibold text-studio-ink">
                      {m.moment}
                    </span>
                  </Cell>
                  <Cell>{m.today}</Cell>
                  <Cell>{m.proposed}</Cell>
                  <Cell mono>{m.port}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-10">
        <EyebrowLabel as="h2" size="sm">
          proposed hudmotion tokens — easing stops being inline literals
        </EyebrowLabel>
        <div className="mt-3 overflow-x-auto rounded-lg border border-studio-edge bg-studio-canvas-alt">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <Th>Token</Th>
                <Th>Spec</Th>
                <Th>Used for</Th>
              </tr>
            </thead>
            <tbody>
              {TOKENS.map((t) => (
                <tr key={t.token}>
                  <Cell mono>
                    <span className="text-scout-accent">{t.token}</span>
                  </Cell>
                  <Cell mono>{t.spec}</Cell>
                  <Cell>{t.used}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-prose font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">
          Everything collapses to a fast opacity fade under Reduce Motion (the stage
          honors <span className="font-mono text-[10px]">prefers-reduced-motion</span>{" "}
          the same way). Today's inline literals — dwell 0.42s, hide 180ms, warm delay
          45ms, fade 0.10/0.14s, resize 0.18s — fold into this vocabulary.
        </p>
      </section>

      <section className="mb-6 max-w-prose">
        <EyebrowLabel as="h2" size="sm">
          open questions
        </EyebrowLabel>
        <ul className="mt-3 space-y-2 font-sans text-[12px] leading-relaxed text-studio-ink-muted">
          <li>
            <span className="font-semibold text-studio-ink">Sound default</span> — the
            success pop does enormous vibe work, but should it ship default-on with a
            setting, or default-off? (Today the only audio in the flow is a failure
            beep.)
          </li>
          <li>
            <span className="font-semibold text-studio-ink">Departure target</span> —
            menu-bar glyph (prototyped) vs the origin hot corner. The glyph reads as
            "handed to Scout"; the corner reads as "returned whence it came."
          </li>
          <li>
            <span className="font-semibold text-studio-ink">Minimal-first scope</span>{" "}
            — minimal for the hotkey (defaults accepted, speed is the point), full for
            the drop (routing matters more when content arrives first)? Project
            switching stays one click in both.
          </li>
          <li>
            <span className="font-semibold text-studio-ink">Copy unification</span> —
            three phrasings of the droppable-things list exist (warm overlay, in-app
            zone, web). Pick one while re-skinning the receiver.
          </li>
        </ul>
      </section>
    </main>
  );
}
