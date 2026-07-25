import { ChevronDown, ListTree, Loader2, Radio, Send, Settings2, Square, X } from "lucide-react";
import { useState } from "react";

import { useScoutbotRealtimeVoice } from "./ScoutbotRealtimeVoiceContext.tsx";

// The live-call panel: session state, recent trace, the pending-agent-request
// confirmation, and the start/end control.
//
// Shared on purpose. The web status bar wears it inside a popover; the macOS
// app mounts it directly through /embed/voice. A second copy would mean two
// consent checkboxes and two start buttons to keep honest.

type SessionTone = {
  label: string;
  detail: string;
  chip: string;
  iconWrap: string;
};

export function sessionTone(state: string): SessionTone {
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

export function ScoutbotRealtimeVoiceCallHeader({
  state,
  onMinimize,
}: {
  state: string;
  onMinimize?: () => void;
}) {
  const tone = sessionTone(state);
  return (
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
          <div className="flex shrink-0 items-center gap-1">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] ${tone.chip}`}>
              {tone.label}
            </span>
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                title="Minimize live voice"
                aria-label="Minimize live voice"
                className="flex size-5 items-center justify-center rounded text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-white/[0.06] hover:text-[var(--scout-chrome-ink)]"
              >
                <ChevronDown size={11} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-[var(--scout-chrome-ink-faint)]">
          {tone.detail}
        </p>
      </div>
    </header>
  );
}

export function ScoutbotRealtimeVoiceCall({
  dictationActive,
}: {
  dictationActive: boolean;
}) {
  const {
    state,
    error,
    trace,
    pendingAgentRequest,
    startCall,
    endCall,
    confirmAgentRequest,
    cancelAgentRequest,
    clearTrace,
    openVoiceSettings,
  } = useScoutbotRealtimeVoice();
  const active = state === "connecting" || state === "live";
  const [view, setView] = useState<"controls" | "activity">("controls");
  const visibleError = friendlyVoiceError(error);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="grid grid-cols-2 border-b border-[var(--scout-chrome-border-soft)] px-2.5" aria-label="Live voice views">
        <button
          type="button"
          onClick={() => setView("controls")}
          className={`flex h-8 items-center justify-center gap-1.5 border-b font-mono text-[9px] uppercase tracking-[0.09em] transition-colors ${view === "controls" ? "border-lime-300/70 text-[var(--scout-chrome-ink)]" : "border-transparent text-[var(--scout-chrome-ink-faint)] hover:text-[var(--scout-chrome-ink)]"}`}
        >
          <Radio size={10} />
          Controls
        </button>
        <button
          type="button"
          onClick={() => setView("activity")}
          className={`flex h-8 items-center justify-center gap-1.5 border-b font-mono text-[9px] uppercase tracking-[0.09em] transition-colors ${view === "activity" ? "border-lime-300/70 text-[var(--scout-chrome-ink)]" : "border-transparent text-[var(--scout-chrome-ink-faint)] hover:text-[var(--scout-chrome-ink)]"}`}
        >
          <ListTree size={10} />
          Activity
          {trace.length > 0 && <span className="text-[8px] text-[var(--scout-chrome-ink-ghost)]">{trace.length}</span>}
        </button>
      </nav>

      {view === "activity" ? (
        <div className="flex min-h-0 flex-1 flex-col p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--scout-chrome-ink-faint)]">
              Session activity
            </p>
            {trace.length > 0 && (
              <button
                type="button"
                onClick={clearTrace}
                className="font-mono text-[8px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-ghost)] hover:text-[var(--scout-chrome-ink)]"
              >
                Clear
              </button>
            )}
          </div>
          {trace.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-[var(--scout-chrome-border-soft)] px-4 text-center text-[10px] leading-snug text-[var(--scout-chrome-ink-ghost)]">
              Start a call to record requests, replies, navigation attempts, and delivery results.
            </div>
          ) : (
            <ol className="min-h-0 flex-1 overflow-y-auto rounded border border-[var(--scout-chrome-border-soft)] bg-black/10">
              {trace.map((entry, index) => (
                <li
                  key={entry.id}
                  className={`px-2 py-1.5 ${index > 0 ? "border-t border-[var(--scout-chrome-border-soft)]" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] leading-tight text-[var(--scout-chrome-ink)]">{entry.label}</span>
                    <time className="shrink-0 font-mono text-[7px] text-[var(--scout-chrome-ink-ghost)]">
                      {formatTraceTime(entry.at)}
                    </time>
                  </div>
                  {entry.detail && (
                    <span className="mt-1 block whitespace-pre-wrap break-words font-mono text-[8px] leading-relaxed text-[var(--scout-chrome-ink-ghost)]">
                      {entry.detail}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div className="min-h-0 space-y-2.5 overflow-y-auto p-2.5">
          <section className="flex items-center justify-between gap-3 rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 p-2.5">
            <div className="min-w-0">
              <p className="text-[10px] text-[var(--scout-chrome-ink)]">Live conversation</p>
              <p className="mt-0.5 text-[9px] leading-snug text-[var(--scout-chrome-ink-faint)]">
                {active ? "Microphone and spoken replies are active." : "Start when you are ready to speak."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              disabled={dictationActive || state === "connecting"}
              onClick={() => void (active ? endCall() : startCall())}
              className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-wait disabled:opacity-60 ${active ? "border-lime-300/40 bg-lime-300/20" : "border-[var(--scout-chrome-border-soft)] bg-black/20"}`}
              title={active ? "End live voice" : "Start live voice"}
            >
              <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${active ? "left-[18px] bg-lime-200" : "left-0.5 bg-[var(--scout-chrome-ink-ghost)]"}`} />
            </button>
          </section>

          {pendingAgentRequest && (
            <section className="space-y-2 rounded border border-amber-300/25 bg-amber-300/[0.06] p-2">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-amber-100">
              Agent request not sent
            </p>
            <p className="mt-1 text-[10px] leading-snug text-[var(--scout-chrome-ink-faint)]">
              Review the request for {pendingAgentRequest.targetLabel}.
            </p>
          </div>
          <p className="max-h-20 overflow-y-auto whitespace-pre-wrap rounded border border-[var(--scout-chrome-border-soft)] bg-black/15 px-2 py-1.5 text-[10px] leading-snug text-[var(--scout-chrome-ink)]">
            {pendingAgentRequest.body}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => void confirmAgentRequest()}
              className="flex min-h-7 items-center justify-center gap-1 rounded border border-lime-300/35 bg-lime-300/[0.1] px-2 font-mono text-[9px] uppercase tracking-[0.08em] text-lime-100 hover:bg-lime-300/15"
            >
              <Send size={9} />
              Send request
            </button>
            <button
              type="button"
              onClick={cancelAgentRequest}
              className="flex min-h-7 items-center justify-center gap-1 rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-faint)] hover:text-[var(--scout-chrome-ink)]"
            >
              <X size={9} />
              Do not send
            </button>
          </div>
            </section>
          )}

          {dictationActive && (
            <p className="rounded border border-amber-300/20 bg-amber-300/[0.05] px-2 py-1.5 font-mono text-[9px] leading-relaxed text-amber-100/80">
              Finish dictation before starting a live call.
            </p>
          )}

          {active && (
          <button
            type="button"
            onClick={() => void endCall()}
            className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded border border-red-400/30 bg-red-400/[0.06] px-2 font-mono text-[9px] uppercase tracking-[0.09em] text-red-100/90 transition-colors hover:bg-red-400/12"
          >
            <Square size={8} className="fill-current" />
            {state === "connecting" ? "Cancel connection" : "End live voice"}
          </button>
          )}

          <button
            type="button"
            onClick={openVoiceSettings}
            className="flex min-h-7 w-full items-center justify-center gap-1.5 rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-faint)] hover:text-[var(--scout-chrome-ink)]"
          >
            <Settings2 size={9} />
            Voice settings
          </button>

          {visibleError && (
            <p className="rounded border border-red-400/25 bg-red-400/[0.07] px-2 py-1.5 text-[9px] leading-relaxed text-red-100">
              {visibleError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatTraceTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function friendlyVoiceError(error: string | null): string | null {
  if (!error) return null;
  const normalized = error.toLowerCase();
  if (normalized.includes("active response in progress") || normalized.includes("conversation already has an active response")) {
    return null;
  }
  if (normalized.includes("realtime voice call is already active")) {
    return "Live voice is still running on this Scout host. Stop it from the footer, or wait a moment for it to finish closing.";
  }
  return error;
}
