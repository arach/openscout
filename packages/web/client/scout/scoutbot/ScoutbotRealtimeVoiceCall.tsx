import { ChevronDown, History, ListTree, Loader2, Maximize2, Minimize2, Plus, Radio, Settings2, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { useScoutbotRealtimeVoice } from "./ScoutbotRealtimeVoiceContext.tsx";
import type { ScoutRealtimeVoiceTraceKind } from "../../lib/realtime-voice.ts";

// The live-call panel: durable Scoutbot chat selection, recent trace, and the
// start/end control. The audio connection is disposable; the selected chat is
// what preserves conversational context across calls.
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
  onExpand,
  layout = "compact",
}: {
  state: string;
  onMinimize?: () => void;
  onExpand?: () => void;
  layout?: "compact" | "page";
}) {
  const tone = sessionTone(state);
  const page = layout === "page";
  return (
    <header className={`flex items-start border-b border-[var(--scout-chrome-border-soft)] ${page ? "gap-3.5 px-5 py-4" : "gap-2.5 px-2.5 py-2.5"}`}>
      <div className={`${page ? "mt-0.5 size-8" : "mt-0.5 size-6"} flex shrink-0 items-center justify-center rounded border ${tone.iconWrap}`}>
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
          <div className={`font-mono font-medium uppercase tracking-[0.12em] text-[var(--scout-chrome-ink)] ${page ? "text-xs" : "text-[10px]"}`}>
            Live voice
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] ${tone.chip}`}>
              {tone.label}
            </span>
            {onExpand && (
              <button
                type="button"
                onClick={onExpand}
                title={page ? "Return to compact live voice view" : "Open full live voice view"}
                aria-label={page ? "Return to compact live voice view" : "Open full live voice view"}
                className="flex size-5 items-center justify-center rounded text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-white/[0.06] hover:text-[var(--scout-chrome-ink)]"
              >
                {page ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
              </button>
            )}
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                title="Collapse live voice into the status bar"
                aria-label="Collapse live voice into the status bar"
                className="flex size-5 items-center justify-center rounded text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-white/[0.06] hover:text-[var(--scout-chrome-ink)]"
              >
                <ChevronDown size={11} />
              </button>
            )}
          </div>
        </div>
        <p className={`mt-1 leading-snug text-[var(--scout-chrome-ink-faint)] ${page ? "text-xs" : "text-[10px]"}`}>
          {tone.detail}
        </p>
      </div>
    </header>
  );
}

export function ScoutbotRealtimeVoiceCall({
  dictationActive,
  layout = "compact",
}: {
  dictationActive: boolean;
  layout?: "compact" | "page";
}) {
  const {
    state,
    error,
    trace,
    chatState,
    sessionAction,
    startCall,
    endCall,
    startNewChat,
    switchChat,
    updatePreferredModel,
    clearTrace,
    openVoiceSettings,
  } = useScoutbotRealtimeVoice();
  const active = state === "connecting" || state === "live";
  const [view, setView] = useState<"controls" | "activity">("controls");
  const visibleError = friendlyVoiceError(error);
  const page = layout === "page";
  const [modelDraft, setModelDraft] = useState("");
  const [modelSaving, setModelSaving] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!modelSaving && chatState?.config.model) setModelDraft(chatState.config.model);
  }, [chatState?.config.model, modelSaving]);

  const savePreferredModel = async () => {
    if (!modelDraft.trim() || modelSaving) return;
    setModelSaving(true);
    setModelStatus(null);
    try {
      const model = await updatePreferredModel(modelDraft);
      setModelDraft(model);
      setModelStatus("Saved");
    } catch (caught) {
      setModelStatus(caught instanceof Error ? caught.message : "Could not save model.");
    } finally {
      setModelSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className={`grid grid-cols-2 border-b border-[var(--scout-chrome-border-soft)] ${page ? "px-5" : "px-2.5"}`} aria-label="Live voice views">
        <button
          type="button"
          onClick={() => setView("controls")}
          className={`flex items-center justify-center gap-1.5 border-b font-mono uppercase tracking-[0.09em] transition-colors ${page ? "h-10 text-[10px]" : "h-8 text-[9px]"} ${view === "controls" ? "border-lime-300/70 text-[var(--scout-chrome-ink)]" : "border-transparent text-[var(--scout-chrome-ink-faint)] hover:text-[var(--scout-chrome-ink)]"}`}
        >
          <Radio size={10} />
          Controls
        </button>
        <button
          type="button"
          onClick={() => setView("activity")}
          className={`flex items-center justify-center gap-1.5 border-b font-mono uppercase tracking-[0.09em] transition-colors ${page ? "h-10 text-[10px]" : "h-8 text-[9px]"} ${view === "activity" ? "border-lime-300/70 text-[var(--scout-chrome-ink)]" : "border-transparent text-[var(--scout-chrome-ink-faint)] hover:text-[var(--scout-chrome-ink)]"}`}
        >
          <ListTree size={10} />
          Activity
          {trace.length > 0 && <span className="text-[8px] text-[var(--scout-chrome-ink-ghost)]">{trace.length}</span>}
        </button>
      </nav>

      {view === "activity" ? (
        <div className={`flex min-h-0 flex-1 flex-col ${page ? "p-5" : "p-2.5"}`}>
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
                    <div className="flex min-w-0 items-start gap-1.5">
                      <span className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[7px] uppercase tracking-[0.08em] ${traceKindTone(entry.kind)}`}>
                        {traceKindLabel(entry.kind)}
                      </span>
                      <span className={`${page ? "text-xs" : "text-[10px]"} min-w-0 leading-tight text-[var(--scout-chrome-ink)]`}>{entry.label}</span>
                    </div>
                    <time className="shrink-0 font-mono text-[7px] text-[var(--scout-chrome-ink-ghost)]">
                      {formatTraceTime(entry.at)}
                    </time>
                  </div>
                  {entry.detail && (
                    <span className={`mt-1 block whitespace-pre-wrap break-words font-mono leading-relaxed text-[var(--scout-chrome-ink-ghost)] ${page ? "text-[10px]" : "text-[8px]"}`}>
                      {entry.detail}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div className={`min-h-0 w-full space-y-2.5 overflow-y-auto ${page ? "mx-auto max-w-3xl p-5" : "p-2.5"}`}>
          <section className="space-y-2 rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 p-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <History size={10} className="shrink-0 text-lime-200/80" />
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--scout-chrome-ink-faint)]">
                  Live chat
                </p>
              </div>
              <p className="mt-1 truncate text-[10px] text-[var(--scout-chrome-ink)]" title={chatState?.session.id}>
                {chatState?.session.title || "Loading chat…"}
              </p>
              <p className="mt-0.5 text-[9px] leading-snug text-[var(--scout-chrome-ink-ghost)]">
                Context stays with this chat when voice stops or the panel closes.
              </p>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              {chatState && chatState.sessions.length > 1 && (
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Switch live chat</span>
                  <select
                    value={chatState.session.id}
                    disabled={Boolean(sessionAction)}
                    onChange={(event) => void switchChat(event.target.value)}
                    className="h-7 w-full min-w-0 rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-bg)] px-2 font-mono text-[9px] text-[var(--scout-chrome-ink)] outline-none focus:border-lime-300/40 disabled:cursor-wait disabled:opacity-50"
                    title="Switch live chat; an active voice connection will end"
                  >
                    {chatState.sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.title || `Chat ${session.id.slice(0, 8)}`} · {session.messageCount} msg
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                onClick={() => void startNewChat()}
                disabled={!chatState || Boolean(sessionAction)}
                title="Start a new chat; an active voice connection will end"
                className="flex h-7 shrink-0 items-center justify-center gap-1 rounded border border-lime-300/30 bg-lime-300/[0.06] px-2 font-mono text-[8px] uppercase tracking-[0.08em] text-lime-100 hover:bg-lime-300/10 disabled:cursor-wait disabled:opacity-40"
              >
                {sessionAction === "new" ? <Loader2 size={9} className="animate-spin" /> : <Plus size={9} />}
                New
              </button>
            </div>
          </section>

          <section className="space-y-1.5 rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] text-[var(--scout-chrome-ink)]">Preferred Scoutbot model</p>
                <p className="mt-0.5 text-[9px] leading-snug text-[var(--scout-chrome-ink-faint)]">
                  Used for typed and live Scoutbot replies.
                </p>
              </div>
              {chatState?.config.provider && (
                <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-ghost)]">
                  {chatState.config.provider}
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <input
                value={modelDraft}
                onChange={(event) => {
                  setModelDraft(event.target.value);
                  setModelStatus(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void savePreferredModel();
                }}
                placeholder="gpt-4.1-mini"
                aria-label="Preferred Scoutbot model"
                className="h-7 min-w-0 flex-1 rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-bg)] px-2 font-mono text-[9px] text-[var(--scout-chrome-ink)] outline-none focus:border-lime-300/40"
              />
              <button
                type="button"
                onClick={() => void savePreferredModel()}
                disabled={modelSaving || !modelDraft.trim() || modelDraft.trim() === chatState?.config.model}
                className="flex h-7 min-w-12 items-center justify-center rounded border border-lime-300/30 bg-lime-300/[0.06] px-2 font-mono text-[8px] uppercase tracking-[0.08em] text-lime-100 disabled:opacity-35"
              >
                {modelSaving ? <Loader2 size={9} className="animate-spin" /> : "Apply"}
              </button>
            </div>
            {modelStatus && (
              <p className="font-mono text-[8px] text-[var(--scout-chrome-ink-faint)]">{modelStatus}</p>
            )}
          </section>

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

function traceKindLabel(kind: ScoutRealtimeVoiceTraceKind | undefined): string {
  switch (kind) {
    case "navigation": return "Navigate";
    case "scoutbot": return "Scoutbot";
    case "agent": return "Agent ask";
    case "error": return "Error";
    case "voice":
    default:
      return "Voice";
  }
}

function traceKindTone(kind: ScoutRealtimeVoiceTraceKind | undefined): string {
  switch (kind) {
    case "navigation": return "border-sky-300/25 bg-sky-300/[0.06] text-sky-100/80";
    case "scoutbot": return "border-violet-300/25 bg-violet-300/[0.06] text-violet-100/80";
    case "agent": return "border-amber-300/25 bg-amber-300/[0.06] text-amber-100/80";
    case "error": return "border-red-300/25 bg-red-300/[0.06] text-red-100/80";
    case "voice":
    default:
      return "border-lime-300/20 bg-lime-300/[0.05] text-lime-100/70";
  }
}
