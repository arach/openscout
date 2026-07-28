"use client";

/**
 * MessageComposer — the one chat input across Scout (sandwich layout).
 *
 *   ┌ header ─ reply / annotation (optional slot) ────┐
 *   │ body ── message input                           │
 *   │         waveform from speech energy (not a loop)│
 *   ├ toolbar ────────────────────────────────────────┤
 *   │ [attach]              [tools/model] [mic] [Send]│
 *   └─────────────────────────────────────────────────┘
 *
 * ── The contract ─────────────────────────────────────────────────────────
 * `MessageComposerProps` below is the SPEC every port mirrors: the web
 * production twin (packages/web/client/components/MessageComposer/), the iOS
 * study kit (components/scout-ios/composer.tsx) and the eventual SwiftUI
 * view. Every variant any surface needs is expressible as params, so no
 * surface re-rolls the markup. How each category translates to Swift:
 *
 *   strings / numbers      → `String` / `Int`
 *   booleans (`show*`)     → `Bool`
 *   `density`              → a Swift `enum`, never a raw string
 *   callbacks (`on*`)      → escaping closures
 *   slots (header, tools)  → `@ViewBuilder` params
 *   `className`            → web-only styling escape hatch. The Swift port
 *                            drops it; a port that needs per-surface chrome
 *                            adds a real param instead.
 *
 * State DERIVES — it is never passed in. "Armed" is `draft is non-empty`,
 * focus is real focus (`autoFocus`), recording is internal. There is no
 * `armed` / `focused` prop and there must not be: a study that wants to pin a
 * visual state pins it through the real mechanism, so a mock can never drift
 * from shipped behaviour.
 *
 * Studio dictation mock: advances a real phrase and drives bar heights from
 * vowel/consonant/pause energy along that utterance — so the wave is
 * representative of what is being "said", not a decorative CSS cycle.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowUp, ChevronDown, Mic, Paperclip, Square } from "lucide-react";

/**
 * Outer rhythm — how much room the composer takes in its host. `panel` —
 * standalone, no outer padding, 15px body (the default; what a page or a
 * phone dock puts its own padding around). `thread` — docked at the foot of
 * a transcript, roomy outer padding. `compact` — dense chrome, tight outer
 * padding and a 13px body.
 */
export type MessageComposerDensity = "panel" | "thread" | "compact";

/**
 * The shell's idiom — orthogonal to density.
 *
 * `panel` (default) — the desktop card: 14px radius, a tinted toolbar tray
 * fenced off by a hairline. Room for a header, several tools, long drafts.
 *
 * `pill` — the phone idiom: a soft 21px capsule, no tray and no fence, 28px
 * controls, one-line body. With nothing on the base row (no `showAttach`, no
 * `tools`) the controls fold up beside the input and the whole thing is a
 * single ~44px line — the classic ask box. Add `tools` and the base row
 * appears underneath, still untrayed, so it stays light on glass.
 */
export type MessageComposerAppearance = "panel" | "pill";

export interface MessageComposerProps {
  // ── Draft ────────────────────────────────────────────────────────────
  /** Controlled draft. Omit for uncontrolled. */
  value?: string;
  /** Uncontrolled seed. A non-empty seed is also how a study arms Send. */
  defaultValue?: string;
  placeholder?: string;
  /** Initial textarea rows; the body autosizes from there up to 160px. */
  rows?: number;
  /** Take focus on mount — how a study pins the "keyboard is up" state. */
  autoFocus?: boolean;
  onChange?: (value: string) => void;

  // ── Commit ───────────────────────────────────────────────────────────
  onSend?: (value: string) => void;
  /** Override the derived rule (draft non-empty · not sending · enabled). */
  canSend?: boolean;
  /** In flight — the body locks, Send stays down. */
  sending?: boolean;
  disabled?: boolean;
  /** Agent is running: the Send slot becomes Stop. Not a mic control. */
  stopMode?: boolean;
  onStop?: () => void;

  // ── Toolbar ──────────────────────────────────────────────────────────
  /** Attach anchors the toolbar's left end. */
  showAttach?: boolean;
  onAttach?: () => void;
  /** Mic starts/stops dictation — never commits. */
  showDictation?: boolean;
  /** Top slot: reply annotation, context chips. */
  header?: ReactNode;
  /** Right toolbar slot, before mic/Send: routing / harness / model chips
   *  (use `MessageComposerSelect`, which is the designed resting shape). */
  tools?: ReactNode;

  // ── Presentation ─────────────────────────────────────────────────────
  density?: MessageComposerDensity;
  appearance?: MessageComposerAppearance;
  /** Web-only escape hatch — the Swift port drops it. */
  className?: string;

  // ── Studio dictation mock ────────────────────────────────────────────
  /**
   * Full phrase the studio "speaks" while recording. Waveform energy tracks
   * this text; partial caption reveals it as progress advances.
   */
  demoUtterance?: string;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// NOTE on colours: Tailwind cannot put an opacity modifier on the studio
// palette — `colors.studio.*` are bare `var(--studio-*)` strings holding
// oklch, and Tailwind 3 emits NO RULE for `border-studio-ink/35` (see the
// "Ink tints" block in app/globals.css). Every tint here therefore uses a
// registered token or one of that file's color-mix utilities, so the atom
// looks the same wherever its tokens are re-pointed (e.g. inside the iOS
// phone, where `.scoutios` rebinds `--studio-*` to the phone palette).
/** Outlined round control. `pill` appearance runs one step smaller. */
const iconBtn = (pill: boolean) =>
  cx(
    "inline-flex items-center justify-center rounded-full",
    pill ? "h-7 w-7" : "h-8 w-8",
    "border border-studio-edge text-studio-ink-faint transition-colors",
    "hover:border-studio-edge-strong hover:text-studio-ink",
    "disabled:cursor-not-allowed disabled:opacity-40",
  );

const WAVE_BARS = 48;
const DEFAULT_UTTERANCE =
  "shell padding is still off by four pixels on the quiet start composer";

/** 0–1 energy at a point in the utterance (vowels loud, spaces quiet). */
function energyAlongUtterance(text: string, progress: number): number {
  if (!text) return 0.06;
  const t = Math.max(0, Math.min(1, progress));
  const index = Math.min(text.length - 1, Math.floor(t * text.length));
  const window = text.slice(Math.max(0, index - 2), index + 3);
  let score = 0.15;
  for (const ch of window) {
    if (/[aeiouy]/i.test(ch)) score += 0.22;
    else if (/[a-z]/i.test(ch)) score += 0.1;
    else if (/\s/.test(ch)) score *= 0.35;
    else if (/[,.;:!?—-]/.test(ch)) score *= 0.45;
  }
  const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0.05, t))) ** 0.7;
  const jitter = 0.9 + 0.1 * Math.sin(index * 1.7 + t * 14);
  return Math.max(0.04, Math.min(1, score * envelope * jitter));
}

function StudioWaveform({
  samples,
  live,
  processing,
}: {
  samples: number[];
  live: boolean;
  processing: boolean;
}) {
  return (
    <div
      className={cx(
        "flex h-7 w-full items-center justify-between gap-[2px] py-0.5",
        live && "text-emerald-400",
        processing && "text-studio-ink-faint",
      )}
      aria-hidden="true"
      data-wave-source="speech"
    >
      {samples.map((h, i) => (
        <span
          key={i}
          className="min-w-[1.5px] max-w-[3px] flex-1 origin-center rounded-full bg-current"
          style={{
            height: "100%",
            transform: `scaleY(${Math.max(0.08, h)})`,
            opacity: processing
              ? 0.28 + h * 0.35
              : live
                ? 0.4 + h * 0.55
                : 0.25,
            transition: "transform 40ms linear, opacity 80ms ease",
          }}
        />
      ))}
    </div>
  );
}

export function MessageComposer({
  value: controlledValue,
  defaultValue = "",
  onChange,
  onSend,
  placeholder = "Type a message…",
  disabled = false,
  sending = false,
  canSend,
  stopMode = false,
  onStop,
  showDictation = true,
  showAttach = false,
  onAttach,
  header,
  tools,
  density = "panel",
  appearance = "panel",
  className,
  rows = 2,
  autoFocus = false,
  demoUtterance = DEFAULT_UTTERANCE,
}: MessageComposerProps) {
  const reactId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const value = controlledValue ?? uncontrolled;
  const [recording, setRecording] = useState(false);
  const [partial, setPartial] = useState("");
  const [phase, setPhase] = useState<"idle" | "recording" | "processing">("idle");
  const [samples, setSamples] = useState<number[]>(() =>
    Array.from({ length: WAVE_BARS }, () => 0.05),
  );
  const rafRef = useRef(0);
  const progressRef = useRef(0);
  const startedAtRef = useRef(0);

  const setValue = (next: string) => {
    if (controlledValue === undefined) setUncontrolled(next);
    onChange?.(next);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Speech-driven simulation: progress through the utterance, push energy
  // samples that track the words — pauses at spaces, peaks on vowels.
  useEffect(() => {
    if (phase !== "recording") {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      return;
    }

    // ~words-per-minute-ish duration for the demo phrase.
    const durationMs = Math.max(2800, demoUtterance.length * 55);
    startedAtRef.current = performance.now();
    progressRef.current = 0;
    let lastPush = 0;

    const tick = (now: number) => {
      const elapsed = now - startedAtRef.current;
      const progress = Math.min(1, elapsed / durationMs);
      progressRef.current = progress;

      if (now - lastPush >= 36) {
        lastPush = now;
        const energy = energyAlongUtterance(demoUtterance, progress);
        setSamples((prev) => {
          const next = prev.slice(1);
          next.push(energy);
          return next;
        });
        const chars = Math.floor(progress * demoUtterance.length);
        setPartial(demoUtterance.slice(0, chars));
      }

      if (progress >= 1) {
        // Natural end of phrase — hold listening with quiet floor until stop.
        setPartial(demoUtterance);
        setSamples((prev) => {
          const next = prev.slice(1);
          next.push(0.08 + Math.random() * 0.04);
          return next;
        });
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [phase, demoUtterance]);

  // Processing: decay the trail instead of inventing new motion.
  useEffect(() => {
    if (phase !== "processing") return;
    let frames = 0;
    const id = window.setInterval(() => {
      frames += 1;
      setSamples((prev) => prev.map((s) => Math.max(0.04, s * 0.82)));
      if (frames > 14) window.clearInterval(id);
    }, 45);
    return () => window.clearInterval(id);
  }, [phase]);

  const sendEnabled =
    canSend ?? (value.trim().length > 0 && !sending && !disabled && !stopMode);

  const commitSend = () => {
    if (!sendEnabled) return;
    onSend?.(value.trim());
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commitSend();
    }
  };

  const toggleMic = () => {
    if (phase === "processing") return;
    if (recording) {
      setRecording(false);
      setPhase("processing");
      window.setTimeout(() => {
        const spoken = partial.trim() || demoUtterance;
        setValue(value.trim() ? `${value.trimEnd()} ${spoken}` : spoken);
        setPartial("");
        setPhase("idle");
        setSamples(Array.from({ length: WAVE_BARS }, () => 0.05));
        textareaRef.current?.focus();
      }, 480);
      return;
    }
    setRecording(true);
    setPhase("recording");
    setPartial("");
    setSamples(Array.from({ length: WAVE_BARS }, () => 0.05));
  };

  const pad =
    density === "thread"
      ? "p-4 pt-3"
      : density === "compact"
        ? "p-2"
        : "p-0";

  const showVoice =
    phase === "recording" || phase === "processing" || Boolean(partial);

  const pill = appearance === "pill";
  // The pill's fold: with nothing to put on a base row, mic and Send sit
  // beside the input and the composer is one ~44px line. Dictation unfolds it
  // again — the waveform needs the full width.
  const inlineControls = pill && !showAttach && !tools && !showVoice;

  const controls = (
    <div
      className={cx(
        "flex shrink-0 items-center justify-end",
        pill ? "gap-1" : "gap-1.5",
      )}
    >
      {tools ? (
        <div className="flex min-w-0 flex-nowrap items-center justify-end gap-1">
          {tools}
        </div>
      ) : null}
      {showDictation ? (
        <button
          type="button"
          disabled={disabled || sending || phase === "processing"}
          aria-label={recording ? "Stop recording" : "Start recording"}
          title={recording ? "Stop recording" : "Start recording"}
          aria-pressed={recording}
          onClick={toggleMic}
          className={cx(
            iconBtn(pill),
            recording && "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
          )}
        >
          {phase === "processing" ? (
            <span className="h-3 w-3 animate-pulse rounded-full bg-current" />
          ) : recording ? (
            <Square size={11} className="fill-current" />
          ) : (
            <Mic size={13} />
          )}
        </button>
      ) : null}

      {stopMode ? (
        <button
          type="button"
          aria-label="Stop agent"
          title="Stop agent"
          onClick={onStop}
          className={cx(
            "inline-flex items-center justify-center rounded-full",
            pill ? "h-7 w-7" : "h-8 w-8",
            "bg-red-500 text-white transition-transform hover:scale-105",
          )}
        >
          <Square size={11} className="fill-current" />
        </button>
      ) : (
        <button
          type="button"
          disabled={!sendEnabled}
          data-action="send"
          aria-label="Send message (Cmd+Enter)"
          title="Send (Cmd+Enter)"
          onClick={commitSend}
          className={cx(
            "inline-flex items-center justify-center rounded-full",
            pill ? "h-7 w-7" : "h-8 w-8",
            "bg-studio-ink text-studio-canvas transition-transform",
            "hover:scale-105 disabled:cursor-default disabled:opacity-25 disabled:hover:scale-100",
          )}
        >
          <ArrowUp size={pill ? 14 : 15} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );

  return (
    <div className={cx("w-full min-w-0", pad, className)} data-composer-id={reactId}>
      <div
        className={cx(
          "relative flex flex-col overflow-hidden border border-studio-edge",
          pill ? "rounded-[21px]" : "rounded-[14px]",
          "bg-studio-surface transition-colors focus-within:border-studio-edge-strong",
        )}
      >
        {header ? (
          <div
            className={cx(
              "px-3 py-2",
              pill ? "pb-1" : "canvas-tint border-b border-studio-edge",
            )}
          >
            {header}
          </div>
        ) : null}

        <div
          className={cx(
            "flex",
            inlineControls
              ? "flex-row items-center gap-1.5 py-1.5 pl-4 pr-1.5"
              : "flex-col",
            !inlineControls && (pill ? "px-4 pb-0.5 pt-2" : "px-3 pb-1.5 pt-2.5"),
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            disabled={disabled || sending}
            rows={rows}
            autoFocus={autoFocus}
            placeholder={placeholder}
            aria-label="Message"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            className={cx(
              "block max-h-40 w-full min-w-0 resize-none",
              "border-0 bg-transparent font-sans text-[15px] leading-normal",
              "text-studio-ink outline-none placeholder:text-studio-ink-faint",
              "disabled:cursor-not-allowed disabled:opacity-55",
              pill ? "min-h-[24px]" : "min-h-[44px]",
              density === "compact" && "min-h-[32px] text-[13px]",
            )}
          />

          {showVoice ? (
            <div
              className="mt-2 flex flex-col gap-1"
              role="status"
              aria-live="polite"
            >
              {(phase === "recording" || phase === "processing") && (
                <StudioWaveform
                  samples={samples}
                  live={phase === "recording"}
                  processing={phase === "processing"}
                />
              )}
              <div
                className={cx(
                  "flex items-baseline gap-2 font-sans text-[11px] leading-snug",
                  phase === "recording" && "text-emerald-400",
                  phase === "processing" && "text-studio-ink-faint",
                )}
              >
                <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.1em]">
                  {phase === "processing" ? "Transcribing" : "Listening"}
                </span>
                <span className="min-w-0 truncate text-studio-ink-faint">
                  {phase === "processing"
                    ? "Finalizing transcript…"
                    : partial || ""}
                </span>
              </div>
            </div>
          ) : null}

          {inlineControls ? controls : null}
        </div>

        {inlineControls ? null : (
          <div
            className={cx(
              "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2",
              pill
                ? "px-2 pb-1.5 pt-0.5"
                : "canvas-tint border-t border-studio-edge px-2 py-1.5",
            )}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              {showAttach ? (
                <button
                  type="button"
                  disabled={disabled || sending}
                  title="Add attachment"
                  aria-label="Add attachment"
                  onClick={onAttach}
                  className={iconBtn(pill)}
                >
                  <Paperclip size={14} />
                </button>
              ) : null}
            </div>

            {/* Right: tools · mic · Send */}
            <div className="col-start-3 justify-self-end">{controls}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Designed resting chip for the `tools` slot — routing, harness, model.
 * Value-only pill (no kicker labels, no border) · mono value · chevron: the
 * name of the thing is redundant next to its value, and on a 390px phone
 * toolbar it is the difference between fitting and wrapping. `label` is the
 * accessible name only. Swift port: a `Menu` with the same value-only label.
 */
export function MessageComposerSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  size = "md",
}: {
  /** Accessible name — never rendered. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  /** `sm` is the phone chip — three of these plus attach, mic and Send have
   *  to sit on 390px of glass without wrapping. */
  size?: "sm" | "md";
}) {
  const selected = options.find((option) => option.value === value);
  const display = selected?.label
    ?? (value.trim() ? value : options[0]?.label ?? label);

  return (
    <label
      className={cx(
        // `ink-chip` (globals.css) is the color-mix stand-in for the
        // `bg-studio-ink/[0.07]` modifier Tailwind cannot emit here.
        "ink-chip relative inline-flex max-w-[200px] items-center",
        "rounded-full border-0 transition-colors",
        size === "sm" ? "min-h-6 gap-0.5 px-2" : "min-h-7 gap-1 px-2.5",
        "focus-within:shadow-[0_0_0_2px_rgba(255,255,255,0.08)]",
        disabled && "cursor-not-allowed opacity-45",
        !disabled && "cursor-pointer",
      )}
    >
      <span
        className={cx(
          "min-w-0 truncate font-mono font-medium tracking-[0.01em] text-studio-ink-faint",
          size === "sm" ? "text-[10px]" : "text-[11px]",
        )}
      >
        {display}
      </span>
      <ChevronDown
        size={size === "sm" ? 9 : 10}
        strokeWidth={2}
        className="shrink-0 text-studio-ink-faint"
        aria-hidden
      />
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-inherit appearance-none opacity-0"
      >
        {options.map((option) => (
          <option key={option.value || "__empty__"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
