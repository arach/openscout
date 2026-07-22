import { Activity, ArrowUpRight, Check, Loader2, Radio, ShieldCheck, Square, Volume2 } from "lucide-react";
import { useOptionalFlag } from "hudsonkit/flags";
import { useEffect } from "react";

import { SCOUT_REALTIME_VOICE_FLAG } from "../../../shared/realtime-voice.ts";
import { ScoutbotIconButton } from "./ScoutbotControls.tsx";
import { useScoutbotRealtimeVoice } from "./ScoutbotRealtimeVoiceContext.tsx";

export function ScoutbotRealtimeVoice({
  dictationActive,
}: {
  dictationActive: boolean;
}) {
  const enabled = useOptionalFlag(SCOUT_REALTIME_VOICE_FLAG, false);
  const { open, setOpen, state, error, trace, startCall, endCall } = useScoutbotRealtimeVoice();

  useEffect(() => () => setOpen(false), [setOpen]);

  const active = state === "connecting" || state === "live";
  const activity = trace.length > 0
    ? trace
    : [
        { id: "secure", label: "Secure browser audio", detail: "WebRTC microphone connection" },
        { id: "context", label: "Live Scout context", detail: "Fleet and workspace stay in sync" },
        { id: "guidance", label: "Guided navigation", detail: "Scoutbot can open the relevant page" },
      ];
  const status = state === "live"
    ? { label: "Live", detail: "Listening and ready", tone: "text-lime-200 border-lime-300/30 bg-lime-300/10" }
    : state === "connecting"
      ? { label: "Connecting", detail: "Opening secure audio", tone: "text-amber-100 border-amber-300/30 bg-amber-300/10" }
      : { label: "Ready", detail: "Start when you want to talk", tone: "text-[var(--scout-chrome-ink-faint)] border-[var(--scout-chrome-border-soft)] bg-black/10" };

  if (!enabled) return null;

  return (
    <div className="relative">
      <ScoutbotIconButton
        icon={state === "connecting" ? <Loader2 size={11} className="animate-spin" /> : <Radio size={11} />}
        title={active ? "Scoutbot voice is active" : "Open Scoutbot voice"}
        onClick={() => setOpen((value) => !value)}
        disabled={dictationActive}
        active={active || open}
      />
      {open && (
        <div className="absolute right-0 top-8 z-30 w-[19rem] overflow-hidden rounded-lg border border-lime-300/25 bg-[color-mix(in_srgb,var(--scout-chrome-bg)_94%,black)] shadow-[0_18px_45px_rgba(0,0,0,0.46)] backdrop-blur">
          <div className="border-b border-lime-300/15 bg-[linear-gradient(135deg,rgba(163,230,53,0.12),transparent_58%)] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border ${active ? "border-lime-300/45 bg-lime-300/12 text-lime-200" : "border-[var(--scout-chrome-border-soft)] bg-black/20 text-[var(--scout-chrome-ink-faint)]"}`}>
                  {state === "connecting" ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--scout-chrome-ink)]">Scoutbot voice</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
                    Speak naturally. Scoutbot can inspect the fleet, guide you to the right work, and coordinate through Scout.
                  </p>
                </div>
              </div>
              <span className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.11em] ${status.tone}`}>{status.label}</span>
            </div>
          </div>

          <div className="space-y-3 p-3">
            <div className="flex items-center justify-between rounded-md border border-[var(--scout-chrome-border-soft)] bg-black/15 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <Activity size={12} className={active ? "text-lime-300" : "text-[var(--scout-chrome-ink-ghost)]"} />
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--scout-chrome-ink-ghost)]">Voice session</div>
                  <div className="mt-0.5 text-[10px] text-[var(--scout-chrome-ink-faint)]">{status.detail}</div>
                </div>
              </div>
              {state === "live" && <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(163,230,53,0.9)]" aria-label="Live" />}
            </div>

            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-ghost)]">{trace.length > 0 ? "Live activity" : "What happens next"}</div>
                {trace.length === 0 && <ShieldCheck size={11} className="text-lime-300/80" aria-hidden="true" />}
              </div>
              <ol className="overflow-hidden rounded-md border border-[var(--scout-chrome-border-soft)] bg-black/10">
                {activity.map((entry, index) => (
                  <li key={entry.id} className={`flex gap-2 px-2.5 py-2 ${index > 0 ? "border-t border-[var(--scout-chrome-border-soft)]" : ""}`}>
                    <span className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border ${trace.length > 0 ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink-ghost)]"}`}>
                      {trace.length > 0 ? <Check size={8} strokeWidth={3} /> : index === 2 ? <ArrowUpRight size={8} strokeWidth={2.5} /> : <span className="size-1 rounded-full bg-current" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] leading-tight text-[var(--scout-chrome-ink)]">{entry.label}</span>
                      {entry.detail && <span className="mt-0.5 block font-mono text-[8px] leading-relaxed text-[var(--scout-chrome-ink-ghost)]">{entry.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

          {dictationActive ? (
            <div className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-2 font-mono text-[9px] leading-relaxed text-amber-100/85">Finish dictation before starting a live call.</div>
          ) : state === "live" ? (
            <button
              type="button"
              onClick={endCall}
              className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border border-red-400/45 bg-red-400/10 px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-red-100 transition-colors hover:bg-red-400/20"
            >
              <Square size={10} className="fill-current" /> End live voice
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startCall()}
              disabled={state === "connecting"}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-lime-200/65 bg-lime-300 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-black transition-colors hover:bg-lime-200 disabled:cursor-not-allowed disabled:border-lime-300/25 disabled:bg-lime-300/20 disabled:text-lime-100/60"
            >
              {state === "connecting" ? <Loader2 size={11} className="animate-spin" /> : <Volume2 size={11} />}
              {state === "connecting" ? "Connecting secure audio" : "Start live voice"}
            </button>
          )}
          {error && <p className="rounded-md border border-red-400/25 bg-red-400/[0.08] px-2.5 py-2 font-mono text-[9px] leading-relaxed text-red-100">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
