import { Loader2, Radio, Send, Square, X } from "lucide-react";

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

export function ScoutbotRealtimeVoiceCallHeader({ state }: { state: string }) {
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
          <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] ${tone.chip}`}>
            {tone.label}
          </span>
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
  } = useScoutbotRealtimeVoice();
  const active = state === "connecting" || state === "live";
  const recentTrace = trace.slice(-2);

  return (
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
        <div className="space-y-2">
          <p className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 p-2 text-[9px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
            Realtime voice is enabled in Settings. Starting a call sends microphone audio to OpenAI Realtime. Agent requests still require confirmation.
          </p>
          <button
            type="button"
            onClick={() => void startCall()}
            className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded border border-lime-300/40 bg-lime-300/[0.12] px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-lime-100 transition-colors hover:bg-lime-300/20"
          >
            <Radio size={11} />
            Start live voice
          </button>
        </div>
      )}

      {error && (
        <p className="rounded border border-red-400/25 bg-red-400/[0.07] px-2 py-1.5 font-mono text-[9px] leading-relaxed text-red-100">
          {error}
        </p>
      )}
    </div>
  );
}
