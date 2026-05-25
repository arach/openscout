"use client";

/**
 * QuickSteer — the portable "hover a row, get the chip cluster + input
 * dock" behavior, extracted from Ticker so any agent-activity surface
 * (ticker slot, roster row, choreography glyph, decision card) can opt
 * in without re-implementing the state machine.
 *
 * Wraps its children in a relatively-positioned container and renders
 * the floating chip cluster + input dock above them on hover. Click an
 * instant chip → fires `onAction(event, actionId)`. Click a chip
 * marked `needsInput` → opens the dock; type or speak; Enter sends →
 * fires `onAction(event, actionId, text)`. Esc cancels.
 *
 * Hosts can listen via `onInteract(active)` to coordinate side effects
 * (e.g. pause a scrolling ticker while a dock is open).
 */

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// ── Types (the canonical steer vocabulary; Ticker aliases these) ────

export type SteerKind = "message" | "work" | "decision" | "artifact";

export type SteerActionGlyph =
  | "reply"
  | "thread"
  | "pin"
  | "pause"
  | "abort"
  | "ack"
  | "open"
  | "tail"
  | "mic"
  | "send"
  | "save";

export interface SteerAction {
  id: string;
  label: string;
  glyph: SteerActionGlyph;
  variant?: "default" | "primary" | "danger";
  /** When true, clicking opens an inline input dock (mic + text + send)
   *  instead of committing immediately. `onAction` fires with the typed
   *  or spoken text as its third argument when the operator sends. */
  needsInput?: boolean;
  inputPlaceholder?: string;
}

export interface SteerEvent {
  id: string;
  agent: string;
  agentHue: number;
  kind: SteerKind;
  label: string;
  time: string;
  /** Per-event override of `DEFAULT_STEER_ACTIONS[kind]`. */
  actions?: SteerAction[];
}

// ── Canonical actions ──────────────────────────────────────────────

export const DEFAULT_STEER_ACTIONS: Record<SteerKind, SteerAction[]> = {
  message: [
    { id: "reply", label: "Reply", glyph: "reply", needsInput: true, inputPlaceholder: "Reply…" },
    { id: "thread", label: "Open thread", glyph: "thread", needsInput: true, inputPlaceholder: "Start thread…" },
    { id: "pin", label: "Pin", glyph: "pin" },
  ],
  work: [
    { id: "tail", label: "Tail", glyph: "tail" },
    { id: "pause", label: "Pause", glyph: "pause" },
    { id: "abort", label: "Abort", glyph: "abort", variant: "danger" },
  ],
  decision: [
    { id: "ack", label: "Acknowledge", glyph: "ack", variant: "primary" },
    { id: "pin", label: "Pin", glyph: "pin" },
    { id: "reject", label: "Reject", glyph: "abort", variant: "danger", needsInput: true, inputPlaceholder: "Why?" },
  ],
  artifact: [
    { id: "open", label: "Open", glyph: "open" },
    { id: "reply", label: "Reply", glyph: "reply", needsInput: true, inputPlaceholder: "Note…" },
    { id: "pin", label: "Pin", glyph: "pin" },
  ],
};

// Mock voice transcriptions per action — stand-in for real Web Speech.
const MOCK_TRANSCRIPTS: Record<string, string> = {
  reply: "looks good, ship it",
  thread: "let's talk this one through in detail",
  reject: "blocked on the migration concern",
};

// Shared glass treatment for the cluster + dock, matching the HUD
// chrome glass tokens so the language stays consistent.
export const STEER_GLASS_PANEL: CSSProperties = {
  background:
    "color-mix(in oklab, var(--studio-canvas) 72%, transparent)",
  backdropFilter: "blur(14px) saturate(140%)",
  WebkitBackdropFilter: "blur(14px) saturate(140%)",
  boxShadow: "0 6px 24px -8px rgba(0,0,0,0.45)",
};

// ── Wrapper component ──────────────────────────────────────────────

interface DockState {
  action: SteerAction;
}

export interface QuickSteerProps {
  event: SteerEvent;
  actions?: SteerAction[];
  /** Toggle the entire behavior. When false, children render as-is
   *  with no hover/state/overlay — useful for surfaces that want to
   *  conditionally disable steer (e.g., read-only mode). */
  enabled?: boolean;
  onAction?: (event: SteerEvent, actionId: string, text?: string) => void;
  /** Host listener for "is this slot in an interactive state?" —
   *  fires `true` on hover OR dock open, `false` when both end.
   *  Tickers use this to pause their scroll so the operator has a
   *  steady target to aim at. */
  onLock?: (locked: boolean) => void;
  /** Where the cluster/dock floats relative to children. Default top. */
  placement?: "top" | "bottom";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export const QuickSteer = forwardRef<HTMLDivElement, QuickSteerProps>(
  function QuickSteer(
    {
      event,
      actions,
      enabled = true,
      onAction,
      onLock,
      placement = "top",
      className,
      style,
      children,
    },
    ref,
  ) {
    const keyframeId = useId().replace(/:/g, "");
    const [hovered, setHovered] = useState(false);
    const [flashing, setFlashing] = useState(false);
    const [dock, setDock] = useState<DockState | null>(null);

    // Lock fires whenever the slot is in an interactive state — either
    // hovered (chips visible) or dock open. Hosts use this to pause
    // ambient motion so the operator can read/aim/act on the target.
    const locked = hovered || dock !== null;
    const prevLocked = useRef(false);
    useEffect(() => {
      if (locked !== prevLocked.current) {
        prevLocked.current = locked;
        onLock?.(locked);
      }
    }, [locked, onLock]);

    const resolvedActions = actions ?? event.actions ?? DEFAULT_STEER_ACTIONS[event.kind];
    const color = `oklch(0.74 0.15 ${event.agentHue})`;

    const commit = (action: SteerAction, text?: string) => {
      onAction?.(event, action.id, text);
      setFlashing(true);
      setDock(null);
      setTimeout(() => setFlashing(false), 900);
    };

    const handleChipClick = (action: SteerAction) => {
      if (action.needsInput) {
        setDock({ action });
        return;
      }
      commit(action);
    };

    if (!enabled) {
      return (
        <div ref={ref} className={className} style={style}>
          {children}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={["relative", className ?? ""].join(" ").trim()}
        style={style}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <style>{`
          @keyframes qs-chip-in-${keyframeId} {
            from { opacity: 0; transform: translateX(-50%) translateY(3px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
        `}</style>

        {children}

        {flashing ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--scout-accent)" }}
          />
        ) : null}

        {dock ? (
          <InputDock
            evt={event}
            action={dock.action}
            color={color}
            keyframeId={keyframeId}
            placement={placement}
            onSend={(text) => commit(dock.action, text)}
            onCancel={() => setDock(null)}
          />
        ) : hovered ? (
          <ActionCluster
            actions={resolvedActions}
            color={color}
            keyframeId={keyframeId}
            placement={placement}
            onChipClick={handleChipClick}
          />
        ) : null}
      </div>
    );
  },
);

// ── Chip cluster ────────────────────────────────────────────────────

function clusterPositionStyle(placement: "top" | "bottom"): CSSProperties {
  return placement === "top"
    ? { bottom: "calc(100% - 2px)", left: "50%" }
    : { top: "calc(100% - 2px)", left: "50%" };
}

export function ActionCluster({
  actions,
  color,
  keyframeId,
  placement = "top",
  onChipClick,
  highlightActionId,
}: {
  actions: SteerAction[];
  color: string;
  keyframeId: string;
  placement?: "top" | "bottom";
  onChipClick: (action: SteerAction) => void;
  /** For static demos — visually highlight a specific chip as if it
   *  were hovered. Production composition doesn't pass this. */
  highlightActionId?: string;
}) {
  return (
    <div
      className="absolute z-20 flex flex-col items-center"
      style={{
        ...clusterPositionStyle(placement),
        transform: "translateX(-50%)",
        animation: `qs-chip-in-${keyframeId} 140ms ease-out forwards`,
      }}
    >
      {placement === "bottom" ? (
        <div
          aria-hidden
          className="h-2 w-px"
          style={{ background: color, opacity: 0.7 }}
        />
      ) : null}
      <div
        className="flex items-center gap-1 rounded-full border border-studio-edge px-1.5 py-1"
        style={STEER_GLASS_PANEL}
      >
        {actions.map((a) => (
          <ActionChip
            key={a.id}
            action={a}
            onClick={() => onChipClick(a)}
            forceHover={highlightActionId === a.id}
          />
        ))}
      </div>
      {placement === "top" ? (
        <div
          aria-hidden
          className="h-2 w-px"
          style={{ background: color, opacity: 0.7 }}
        />
      ) : null}
    </div>
  );
}

function ActionChip({
  action,
  onClick,
  forceHover = false,
}: {
  action: SteerAction;
  onClick: () => void;
  forceHover?: boolean;
}) {
  const [hoveredState, setHovered] = useState(false);
  const hovered = forceHover || hoveredState;
  const accent =
    action.variant === "primary"
      ? "var(--status-ok-fg)"
      : action.variant === "danger"
        ? "var(--status-error-fg)"
        : "var(--scout-accent)";
  return (
    <button
      type="button"
      aria-label={action.label}
      title={action.label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative grid h-6 w-6 place-items-center rounded-full transition-colors duration-75 ease-out"
      style={{
        color: hovered ? accent : "var(--studio-ink-faint)",
        background: hovered
          ? "color-mix(in oklab, var(--studio-canvas-alt) 60%, transparent)"
          : "transparent",
      }}
    >
      <SteerActionGlyph kind={action.glyph} />
      {action.needsInput ? (
        <span
          aria-hidden
          className="absolute -bottom-0.5 right-0.5 text-[7px] leading-none"
          style={{
            color: hovered ? accent : "var(--studio-ink-faint)",
            opacity: 0.7,
          }}
        >
          ⋯
        </span>
      ) : null}
    </button>
  );
}

// ── Input dock ─────────────────────────────────────────────────────

export function InputDock({
  evt,
  action,
  color,
  keyframeId,
  placement = "top",
  onSend,
  onCancel,
  onSave,
  saveLabel = "save",
  initialText = "",
  initialRecording = false,
  inline = false,
}: {
  evt: SteerEvent;
  action: SteerAction;
  color: string;
  keyframeId: string;
  placement?: "top" | "bottom";
  onSend: (text: string) => void;
  onCancel: () => void;
  /** Optional secondary commit verb. When provided, the dock renders a
   *  second commit button (a bookmark/pin glyph) to the right of
   *  `send`. Semantically: `send` ships the feedback to the agent now;
   *  `onSave` keeps it on the surface as an annotation to be picked up
   *  later (e.g. as part of a batch handoff). Default `undefined` —
   *  the dock renders single-button as before, so existing callers
   *  (QuickSteer hover, ticker-interactions) are unchanged. */
  onSave?: (text: string) => void;
  /** Label for the save verb in the lead-in chip. Defaults to "save". */
  saveLabel?: string;
  /** For static demos — preset the field with text. */
  initialText?: string;
  /** For static demos — start in the recording state. */
  initialRecording?: boolean;
  /** When true, the dock sits inline (relative) inside its parent
   *  rather than floating absolutely above a hover target. Used by
   *  composition surfaces where the dock is the chunk's affordance,
   *  not an overlay on top of a ticker tape. Drops the connector
   *  hairline and the translate-x centering. */
  inline?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [recording, setRecording] = useState(initialRecording);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const toggleMic = () => {
    if (recording) {
      const phrase = MOCK_TRANSCRIPTS[action.id] ?? "noted";
      setText((prev) => (prev ? `${prev} ${phrase}` : phrase));
      setRecording(false);
      inputRef.current?.focus();
    } else {
      setRecording(true);
    }
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
  };

  const submitSave = () => {
    const trimmed = text.trim();
    if (!trimmed || !onSave) return;
    onSave(trimmed);
  };

  const accent =
    action.variant === "primary"
      ? "var(--status-ok-fg)"
      : action.variant === "danger"
        ? "var(--status-error-fg)"
        : "var(--scout-accent)";

  const hasText = text.trim().length > 0;

  const wrapperStyle: CSSProperties = inline
    ? {
        animation: `qs-chip-in-${keyframeId} 160ms ease-out forwards`,
      }
    : {
        ...clusterPositionStyle(placement),
        transform: "translateX(-50%)",
        animation: `qs-chip-in-${keyframeId} 160ms ease-out forwards`,
      };

  return (
    <div
      className={
        inline
          ? "relative z-10 flex flex-col items-stretch"
          : "absolute z-30 flex flex-col items-center"
      }
      style={wrapperStyle}
    >
      {!inline && placement === "bottom" ? (
        <div aria-hidden className="h-1.5 w-px" style={{ background: color, opacity: 0.7 }} />
      ) : null}
      <div
        className="flex items-center gap-2 rounded-full border border-studio-edge px-2 py-1"
        style={{ ...STEER_GLASS_PANEL, minWidth: inline ? 0 : 360 }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="shrink-0 font-mono text-[9px] uppercase tracking-eyebrow"
          style={{ color: accent, letterSpacing: "0.22em" }}
        >
          {action.label.toLowerCase()}
        </span>
        <span
          aria-hidden
          className="shrink-0 font-mono text-[9px] uppercase text-studio-ink-faint"
        >
          {onSave ? `→ @${evt.agent} · save` : `→ @${evt.agent}`}
        </span>

        <button
          type="button"
          aria-label={recording ? "Stop recording" : "Voice input"}
          title={recording ? "Stop recording" : "Voice input"}
          onClick={(e) => {
            e.stopPropagation();
            toggleMic();
          }}
          className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors duration-75"
          style={{
            color: recording ? "var(--status-error-fg)" : "var(--studio-ink-faint)",
            background: recording
              ? "color-mix(in oklab, var(--status-error-bg) 90%, transparent)"
              : "transparent",
          }}
        >
          {recording ? (
            <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
              <circle cx={10} cy={10} r={4} fill="var(--status-error-fg)">
                <animate attributeName="r" values="3.5;5.5;3.5" dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;1;0.7" dur="1.2s" repeatCount="indefinite" />
              </circle>
              <circle cx={10} cy={10} fill="none" stroke="var(--status-error-fg)" strokeWidth={1}>
                <animate attributeName="r" values="5;9" dur="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0" dur="1.4s" repeatCount="indefinite" />
              </circle>
            </svg>
          ) : (
            <SteerActionGlyph kind="mic" />
          )}
        </button>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if ((e.metaKey || e.ctrlKey) && onSave) {
                submitSave();
              } else {
                submit();
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={
            recording ? "listening…" : action.inputPlaceholder ?? "Message…"
          }
          className="flex-1 bg-transparent font-mono text-[12px] text-studio-ink placeholder:text-studio-ink-faint focus:outline-none"
          style={{ minWidth: 0 }}
        />

        <button
          type="button"
          aria-label="Send"
          title="Send (↵)"
          disabled={!hasText}
          onClick={(e) => {
            e.stopPropagation();
            submit();
          }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors duration-75"
          style={{
            color: hasText ? accent : "var(--studio-ink-faint)",
            background: hasText
              ? "color-mix(in oklab, var(--studio-canvas-alt) 70%, transparent)"
              : "transparent",
            cursor: hasText ? "pointer" : "default",
            opacity: hasText ? 1 : 0.55,
          }}
        >
          <SteerActionGlyph kind="send" />
        </button>

        {onSave ? (
          <>
            {/* Quiet vertical hairline separates the two commit verbs
                so they read as distinct (act now / leave a note) rather
                than as a multi-step toolbar. */}
            <span
              aria-hidden
              className="block h-4 w-px shrink-0"
              style={{ background: "var(--studio-edge-strong)", opacity: 0.7 }}
            />
            <button
              type="button"
              aria-label={saveLabel}
              title={`${saveLabel} (⌘↵) — leave as annotation`}
              disabled={!hasText}
              onClick={(e) => {
                e.stopPropagation();
                submitSave();
              }}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors duration-75"
              style={{
                color: hasText
                  ? "var(--studio-ink)"
                  : "var(--studio-ink-faint)",
                background: "transparent",
                cursor: hasText ? "pointer" : "default",
                opacity: hasText ? 1 : 0.55,
              }}
            >
              <SteerActionGlyph kind="save" />
            </button>
          </>
        ) : null}
      </div>

      <div
        className="mt-0.5 font-mono text-[7.5px] uppercase tracking-eyebrow text-studio-ink-faint"
        style={{ opacity: 0.75, textAlign: inline ? "right" : "center" }}
      >
        {onSave ? "↵ send · ⌘↵ save · esc cancel" : "↵ send · esc cancel"}
      </div>
      {!inline && placement === "top" ? (
        <div aria-hidden className="mt-0.5 h-1.5 w-px" style={{ background: color, opacity: 0.7 }} />
      ) : null}
    </div>
  );
}

// ── Action glyphs (hand-drawn) ─────────────────────────────────────

export function SteerActionGlyph({ kind }: { kind: SteerActionGlyph }) {
  const s = "currentColor";
  const sw = 1.4;
  const cap = "round";
  const join = "round";
  switch (kind) {
    case "reply":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M5 4 L2 7 L5 10" stroke={s} strokeWidth={sw} strokeLinecap={cap} strokeLinejoin={join} />
          <path d="M2 7 L9 7 A3 3 0 0 1 12 10" stroke={s} strokeWidth={sw} strokeLinecap={cap} fill="none" />
        </svg>
      );
    case "thread":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <line x1={3} y1={5} x2={11} y2={5} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
          <line x1={3} y1={9} x2={9} y2={9} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
        </svg>
      );
    case "pin":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx={7} cy={5} r={2.5} stroke={s} strokeWidth={sw} fill="none" />
          <line x1={7} y1={7.5} x2={7} y2={12} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
        </svg>
      );
    case "pause":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <line x1={5} y1={3} x2={5} y2={11} stroke={s} strokeWidth={1.6} strokeLinecap={cap} />
          <line x1={9} y1={3} x2={9} y2={11} stroke={s} strokeWidth={1.6} strokeLinecap={cap} />
        </svg>
      );
    case "abort":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <line x1={4} y1={4} x2={10} y2={10} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
          <line x1={10} y1={4} x2={4} y2={10} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
        </svg>
      );
    case "ack":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3 7 L6 10 L11 4" stroke={s} strokeWidth={1.6} strokeLinecap={cap} strokeLinejoin={join} fill="none" />
        </svg>
      );
    case "open":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <line x1={4} y1={10} x2={10} y2={4} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
          <path d="M6 4 L10 4 L10 8" stroke={s} strokeWidth={sw} strokeLinecap={cap} fill="none" />
        </svg>
      );
    case "tail":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <line x1={3} y1={4} x2={11} y2={4} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
          <line x1={3} y1={7} x2={11} y2={7} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
          <line x1={3} y1={10} x2={8} y2={10} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
        </svg>
      );
    case "mic":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <rect x={5} y={2} width={4} height={6.5} rx={2} stroke={s} strokeWidth={sw} fill="none" />
          <path
            d="M3.5 7.5 A3.5 3.5 0 0 0 10.5 7.5"
            stroke={s}
            strokeWidth={sw}
            strokeLinecap={cap}
            fill="none"
          />
          <line x1={7} y1={10.5} x2={7} y2={12} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
        </svg>
      );
    case "send":
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2 7 L12 3 L9 7 L12 11 Z" stroke={s} strokeWidth={sw} strokeLinejoin={join} fill="none" />
          <line x1={5} y1={7} x2={9} y2={7} stroke={s} strokeWidth={sw} strokeLinecap={cap} />
        </svg>
      );
    case "save":
      // Annotation mark — a tiny bookmark/pin, ribbon notch at the
      // bottom so it reads as "leave this here," not "ship it."
      return (
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M4 3 L10 3 L10 11 L7 9 L4 11 Z"
            stroke={s}
            strokeWidth={sw}
            strokeLinejoin={join}
            fill="none"
          />
        </svg>
      );
  }
}
