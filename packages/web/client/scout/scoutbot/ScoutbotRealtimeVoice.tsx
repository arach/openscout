import { Loader2, Radio, Square } from "lucide-react";
import { useOptionalFlag } from "hudsonkit/flags";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SCOUT_REALTIME_VOICE_FLAG } from "../../../shared/realtime-voice.ts";
import { useScoutbotRealtimeVoice } from "./ScoutbotRealtimeVoiceContext.tsx";

type SessionTone = {
  label: string;
  detail: string;
  chip: string;
  iconWrap: string;
};

function sessionTone(state: string): SessionTone {
  if (state === "live") {
    return {
      label: "Live",
      detail: "Listening — speak naturally",
      chip: "border-lime-300/30 bg-lime-300/[0.08] text-lime-100",
      iconWrap: "border-lime-300/35 bg-lime-300/[0.08] text-lime-200",
    };
  }
  if (state === "connecting") {
    return {
      label: "Connecting",
      detail: "Opening secure audio…",
      chip: "border-amber-300/25 bg-amber-300/[0.07] text-amber-100/90",
      iconWrap: "border-amber-300/30 bg-amber-300/[0.07] text-amber-100",
    };
  }
  if (state === "error") {
    return {
      label: "Error",
      detail: "Could not hold the call",
      chip: "border-red-400/30 bg-red-400/[0.08] text-red-100",
      iconWrap: "border-red-400/30 bg-red-400/[0.08] text-red-100",
    };
  }
  if (state === "ended") {
    return {
      label: "Ended",
      detail: "Call closed — start again anytime",
      chip: "border-[var(--scout-chrome-border-soft)] bg-black/10 text-[var(--scout-chrome-ink-faint)]",
      iconWrap: "border-[var(--scout-chrome-border-soft)] bg-black/15 text-[var(--scout-chrome-ink-faint)]",
    };
  }
  return {
    label: "Ready",
    detail: "Talk continuously with Scoutbot",
    chip: "border-[var(--scout-chrome-border-soft)] bg-black/10 text-[var(--scout-chrome-ink-ghost)]",
    iconWrap: "border-[var(--scout-chrome-border-soft)] bg-black/15 text-[var(--scout-chrome-ink-faint)]",
  };
}

export function ScoutbotRealtimeVoice({
  dictationActive,
}: {
  dictationActive: boolean;
}) {
  const enabled = useOptionalFlag(SCOUT_REALTIME_VOICE_FLAG, false);
  const { open, setOpen, state, error, trace, startCall, endCall } = useScoutbotRealtimeVoice();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ left: 12, bottom: 36 });

  useEffect(() => () => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  useLayoutEffect(() => {
    if (!open) return;
    const positionPopover = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const popoverWidth = Math.min(280, window.innerWidth - 16);
      setPopoverPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8)),
        bottom: Math.max(36, window.innerHeight - rect.top + 8),
      });
    };
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open]);

  if (!enabled) return null;

  const active = state === "connecting" || state === "live";
  const tone = sessionTone(state);
  const recentTrace = trace.slice(-2);
  const title = active
    ? state === "connecting"
      ? "Scoutbot voice is connecting"
      : "Scoutbot voice is live"
    : open
      ? "Hide Scoutbot voice"
      : "Open Scoutbot voice";
  const portalHost = typeof document === "undefined"
    ? null
    : document.querySelector<HTMLElement>("[data-scout-theme]") ?? document.body;

  return (
    <div className="flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-controls="scoutbot-realtime-voice-menu"
        className={`flex h-[18px] items-center gap-1.5 rounded border px-1.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors ${
          state === "live"
            ? "border-lime-300/35 bg-lime-300/[0.08] text-lime-100"
            : state === "connecting"
              ? "border-amber-300/30 bg-amber-300/[0.07] text-amber-100/90"
              : state === "error"
                ? "border-red-400/30 bg-red-400/[0.07] text-red-100"
                : open
                  ? "border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] text-[var(--scout-chrome-ink)]"
                  : "border-transparent text-[var(--scout-chrome-ink-faint)] hover:text-[var(--scout-chrome-ink)]"
        }`}
      >
        {state === "connecting" ? (
          <Loader2 size={10} className="animate-spin" aria-hidden="true" />
        ) : state === "live" ? (
          <span className="relative flex size-1.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime-300/30" />
            <span className="relative inline-flex size-1.5 rounded-full bg-lime-300/90" />
          </span>
        ) : (
          <Radio size={10} aria-hidden="true" />
        )}
        <span>{state === "live" ? "Voice live" : state === "connecting" ? "Voice connecting" : "Voice"}</span>
      </button>

      {open && portalHost && createPortal(
        <>
          <div
            className="fixed inset-0 z-[80]"
            aria-hidden="true"
            onMouseDown={() => setOpen(false)}
          />
          <div
            id="scoutbot-realtime-voice-menu"
            className="fixed z-[81] flex max-h-[calc(100vh-3rem)] w-[min(17.5rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-md border border-[var(--scout-chrome-border-soft)] bg-[color-mix(in_srgb,var(--scout-chrome-bg)_96%,black)] shadow-[0_14px_36px_rgba(0,0,0,0.42)] backdrop-blur"
            style={{ left: popoverPosition.left, bottom: popoverPosition.bottom }}
            role="dialog"
            aria-label="Scoutbot live voice"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start gap-2.5 border-b border-[var(--scout-chrome-border-soft)] px-2.5 py-2.5">
              <div className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border ${tone.iconWrap}`}>
                {state === "connecting" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : state === "live" ? (
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime-300/35" />
                    <span className="relative inline-flex size-2 rounded-full bg-lime-300/90" />
                  </span>
                ) : (
                  <Radio size={12} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--scout-chrome-ink)]">
                    Live voice
                  </div>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] ${tone.chip}`}>
                    {tone.label}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-[var(--scout-chrome-ink-faint)]">
                  {tone.detail}
                </p>
              </div>
            </header>

            <div className="min-h-0 space-y-2.5 overflow-y-auto p-2.5">
              {active && recentTrace.length > 0 && (
                <ol className="overflow-hidden rounded border border-[var(--scout-chrome-border-soft)] bg-black/10">
                  {recentTrace.map((entry, index) => (
                    <li
                      key={entry.id}
                      className={`px-2 py-1.5 ${index > 0 ? "border-t border-[var(--scout-chrome-border-soft)]" : ""}`}
                    >
                      <span className="block text-[10px] leading-tight text-[var(--scout-chrome-ink)]">
                        {entry.label}
                      </span>
                      {entry.detail && (
                        <span className="mt-0.5 block font-mono text-[8px] leading-relaxed text-[var(--scout-chrome-ink-ghost)]">
                          {entry.detail}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {dictationActive ? (
                <p className="rounded border border-amber-300/20 bg-amber-300/[0.05] px-2 py-1.5 font-mono text-[9px] leading-relaxed text-amber-100/80">
                  Finish dictation before starting a live call.
                </p>
              ) : active ? (
                <button
                  type="button"
                  onClick={endCall}
                  className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded border border-red-400/35 bg-red-400/[0.08] px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-red-100/95 transition-colors hover:bg-red-400/15"
                >
                  <Square size={9} className="fill-current" />
                  {state === "connecting" ? "Cancel" : "End call"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startCall()}
                  className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded border border-lime-300/40 bg-lime-300/[0.12] px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-lime-100 transition-colors hover:bg-lime-300/20"
                >
                  <Radio size={11} />
                  Start live voice
                </button>
              )}

              {error && (
                <p className="rounded border border-red-400/25 bg-red-400/[0.07] px-2 py-1.5 font-mono text-[9px] leading-relaxed text-red-100">
                  {error}
                </p>
              )}
            </div>
          </div>
        </>,
        portalHost,
      )}
    </div>
  );
}
