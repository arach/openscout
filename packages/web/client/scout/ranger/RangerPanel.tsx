import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Compass, Loader2, Map, Mic, Radio, RefreshCw, Rocket, Settings, Square, Volume2, VolumeX } from "lucide-react";
import { api } from "../../lib/api.ts";
import { isRangerActorId, isRangerAgent } from "../../lib/ranger.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { speakWithVox, VoxBrowserClient, type VoxLiveHandle, type VoxSessionState } from "../../lib/vox.ts";
import { useScout } from "../Provider.tsx";

type SendResult = {
  conversationId?: string;
};

type VoiceProbeState = "idle" | "probing" | "launching";

const STATE_PROMPT =
  "What's the state of things? Give me a terse ops summary, the biggest risk, and the next action you recommend.";

export function RangerPanel() {
  const {
    agents,
    rangerAgentId,
    rangerConversationId,
    applyRangerUiAction,
  } = useScout();
  const rangerAgent = useMemo(
    () => agents.find((agent) => agent.id === rangerAgentId) ?? agents.find(isRangerAgent) ?? null,
    [agents, rangerAgentId],
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [voiceIssue, setVoiceIssue] = useState<string | null>(null);
  const [voiceProbeState, setVoiceProbeState] = useState<VoiceProbeState>("probing");
  const [voiceReplies, setVoiceReplies] = usePersistentBoolean("openscout.ranger.voiceReplies", false);
  const [recording, setRecording] = useState(false);
  const [voiceState, setVoiceState] = useState<VoxSessionState | null>(null);
  const [partial, setPartial] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [lastAsk, setLastAsk] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [askStatus, setAskStatus] = useState<string | null>(null);
  const clientRef = useRef<VoxBrowserClient | null>(null);
  const liveRef = useRef<VoxLiveHandle | null>(null);
  const voiceRepliesRef = useRef(voiceReplies);
  voiceRepliesRef.current = voiceReplies;

  const probeVoice = useCallback(async () => {
    const client = clientRef.current ?? new VoxBrowserClient();
    clientRef.current = client;
    setVoiceProbeState("probing");

    const ok = await client.probe();
    setVoiceAvailable(ok);
    setVoiceIssue(ok ? null : client.lastUnavailableReason ?? "Vox Companion is not reachable.");
    setVoiceProbeState("idle");
    return ok;
  }, []);

  useEffect(() => {
    void probeVoice();
  }, [probeVoice]);

  const launchVox = useCallback(() => {
    const client = clientRef.current ?? new VoxBrowserClient();
    clientRef.current = client;
    setError(null);
    setVoiceProbeState("launching");
    client.launch({ source: "openscout", context: makeScoutAudioLaunchContext() });
    window.setTimeout(() => {
      void probeVoice();
    }, 2400);
  }, [probeVoice]);

  const openVoxSettings = useCallback(() => {
    const client = clientRef.current ?? new VoxBrowserClient();
    clientRef.current = client;
    client.openSettings({ source: "openscout", context: makeScoutAudioLaunchContext() });
  }, []);

  const askRanger = useCallback(async (body: string) => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setLastAsk(trimmed);
    setLastReply(null);
    setAskStatus("Sending to Ranger");
    try {
      await api<SendResult>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          body: trimmed,
          conversationId: rangerConversationId,
        }),
      });
      setDraft("");
      setAskStatus("Waiting for Ranger");
    } catch (err) {
      setAskStatus(null);
      setError(err instanceof Error ? err.message : "Could not ask Ranger.");
    } finally {
      setSending(false);
    }
  }, [rangerConversationId, sending]);

  const startVoice = useCallback(async () => {
    if (recording) return;
    const client = clientRef.current ?? new VoxBrowserClient();
    clientRef.current = client;
    setError(null);
    setPartial("");
    setVoiceState("starting");

    if (voiceAvailable !== true) {
      const ok = await probeVoice();
      if (!ok) {
        setVoiceState(null);
        return;
      }
    }

    try {
      const live = await client.startLive({
        onState: setVoiceState,
        onPartial: setPartial,
      });
      liveRef.current = live;
      setRecording(true);
      const final = await live.result;
      setRecording(false);
      liveRef.current = null;
      setPartial("");
      setVoiceState("done");
      if (final.text) {
        await askRanger(final.text);
      }
    } catch (err) {
      setRecording(false);
      liveRef.current = null;
      setVoiceState("error");
      setError(err instanceof Error ? err.message : "Vox recording failed.");
    }
  }, [askRanger, probeVoice, recording, voiceAvailable]);

  const stopVoice = useCallback(async () => {
    setVoiceState("processing");
    await liveRef.current?.stop();
  }, []);

  const cancelVoice = useCallback(async () => {
    await liveRef.current?.cancel();
    liveRef.current = null;
    setRecording(false);
    setPartial("");
    setVoiceState(null);
  }, []);

  useBrokerEvents((event) => {
    if (event.kind !== "message.posted") {
      return;
    }
    const message = event.payload && typeof event.payload === "object"
      ? (event.payload as { message?: unknown }).message
      : null;
    if (!message || typeof message !== "object") {
      return;
    }
    const record = message as { actorId?: unknown; body?: unknown; conversationId?: unknown };
    const conversationId = typeof record.conversationId === "string" ? record.conversationId : "";
    if (conversationId && conversationId !== rangerConversationId) {
      return;
    }
    if (
      typeof record.actorId !== "string" ||
      !isRangerActorId(record.actorId, rangerAgentId) ||
      typeof record.body !== "string" ||
      !record.body.trim()
    ) {
      return;
    }
    const replyText = stripRangerUiFences(record.body);
    if (!replyText) {
      return;
    }
    setLastReply(replyText);
    setAskStatus("Ranger replied");
    if (!voiceRepliesRef.current) {
      return;
    }
    setSpeaking(true);
    void speakWithVox(replyText)
      .catch((err) => setError(err instanceof Error ? err.message : "Vox speech failed."))
      .finally(() => setSpeaking(false));
  });

  const voiceLabel = recording
    ? voiceState === "processing" ? "Sending" : "Stop"
    : voiceProbeState === "probing" ? "Checking Vox"
    : voiceProbeState === "launching" ? "Opening Vox"
    : voiceAvailable === false ? "Launch Vox" : "Start Talking";
  const agentStatus = rangerAgent
    ? rangerAgent.state ?? "registered"
    : "default target";

  return (
    <section className="flex flex-col gap-3 border-b border-[var(--scout-chrome-border-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-lime-300" />
            <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--scout-chrome-ink-strong)]">
              Ranger
            </h2>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-[var(--scout-chrome-ink-faint)]">
            {rangerAgent?.name ?? rangerAgentId} · {agentStatus}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RangerActionButton
          icon={<Radio size={13} />}
          label="State"
          onClick={() => void askRanger(STATE_PROMPT)}
          disabled={sending}
        />
        <RangerActionButton
          icon={<Map size={13} />}
          label="Ops Tail"
          onClick={() => applyRangerUiAction({ type: "navigate", route: { view: "ops", mode: "tail" } })}
        />
        <RangerActionButton
          icon={<Compass size={13} />}
          label="Fleet"
          onClick={() => applyRangerUiAction({ type: "navigate", route: { view: "fleet" } })}
        />
        <RangerActionButton
          icon={voiceReplies ? <Volume2 size={13} /> : <VolumeX size={13} />}
          label={voiceReplies ? "Replies On" : "Replies Off"}
          onClick={() => setVoiceReplies(!voiceReplies)}
        />
      </div>

      {voiceAvailable === false && (
        <VoxSetupPanel
          issue={voiceIssue}
          probeState={voiceProbeState}
          onLaunch={launchVox}
          onRetry={() => void probeVoice()}
          onSettings={openVoxSettings}
        />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (voiceAvailable === false) {
              launchVox();
              return;
            }
            void (recording ? stopVoice() : startVoice());
          }}
          className={`flex flex-1 items-center justify-center gap-2 rounded border px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
            recording
              ? "border-lime-300/50 bg-lime-300/10 text-lime-200"
              : "border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink)] hover:bg-[var(--scout-chrome-hover)]"
          }`}
          disabled={sending || voiceState === "processing" || voiceProbeState === "probing"}
        >
          {voiceState === "processing" || voiceProbeState === "probing" ? <Loader2 size={13} className="animate-spin" /> : recording ? <Square size={12} className="fill-current" /> : <Mic size={13} />}
          {voiceLabel}
        </button>
        {recording && (
          <button
            type="button"
            onClick={() => void cancelVoice()}
            className="rounded border border-[var(--scout-chrome-border-soft)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)]"
          >
            Discard
          </button>
        )}
      </div>

      {(partial || speaking) && (
        <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
          {speaking ? "Speaking Ranger reply…" : partial}
        </div>
      )}

      {(lastAsk || lastReply || askStatus) && (
        <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
          {askStatus && (
            <div className="mb-1 uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-ghost)]">
              {askStatus}
            </div>
          )}
          {lastAsk && (
            <p className="line-clamp-3">
              <span className="text-[var(--scout-chrome-ink-soft)]">You: </span>
              {lastAsk}
            </p>
          )}
          {lastReply ? (
            <p className="mt-1 line-clamp-4">
              <span className="text-lime-200">Ranger: </span>
              {lastReply}
            </p>
          ) : askStatus === "Waiting for Ranger" ? (
            <p className="mt-1 text-[var(--scout-chrome-ink-ghost)]">Waiting in the sidebar...</p>
          ) : null}
        </div>
      )}

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void askRanger(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask Ranger to inspect state or move the UI…"
          rows={3}
          className="w-full resize-none rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--scout-chrome-ink)] placeholder:text-[var(--scout-chrome-ink-ghost)]"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="flex items-center justify-center gap-2 rounded bg-lime-300/90 px-2.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending && <Loader2 size={13} className="animate-spin" />}
          Ask Ranger
        </button>
      </form>

      {error && (
        <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-red-200">
          {error}
        </div>
      )}
    </section>
  );
}

function stripRangerUiFences(body: string): string {
  return body
    .replace(/```(?:scout-ui|scout-ui-action|ranger-ui)\s*[\s\S]*?```/gi, "")
    .trim();
}

function makeScoutAudioLaunchContext() {
  return {
    requesterName: "OpenScout",
    productName: "Scout Audio",
    headline: "Turn on local voice for Ranger",
    body: "Scout Audio uses Vox for local speech capture and spoken replies. Start Vox, then return here to talk with your workspace.",
    actionLabel: "Return to OpenScout",
    logo: {
      url: new URL("/openscout-icon.png", window.location.href).toString(),
      symbolName: "sparkles",
    },
  };
}

function RangerActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 rounded border border-[var(--scout-chrome-border-soft)] px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink)] transition-colors hover:bg-[var(--scout-chrome-hover)] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      {label}
    </button>
  );
}

function VoxSetupPanel({
  issue,
  probeState,
  onLaunch,
  onRetry,
  onSettings,
}: {
  issue: string | null;
  probeState: VoiceProbeState;
  onLaunch: () => void;
  onRetry: () => void;
  onSettings: () => void;
}) {
  const isBusy = probeState === "probing" || probeState === "launching";

  return (
    <div className="rounded border border-lime-300/25 bg-lime-300/[0.06] px-3 py-3 font-mono text-[10px] text-[var(--scout-chrome-ink)]">
      <div className="flex items-start gap-2">
        <Rocket size={14} className="mt-0.5 shrink-0 text-lime-300" />
        <div className="min-w-0">
          <div className="uppercase tracking-[0.14em] text-lime-200">Connect Vox</div>
          <p className="mt-1 leading-relaxed text-[var(--scout-chrome-ink-faint)]">
            Start Vox, then retry once the menu bar icon is visible.
          </p>
          {issue && (
            <p className="mt-2 break-words leading-relaxed text-[var(--scout-chrome-ink-ghost)]">
              {issue}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <VoxSetupButton
          icon={probeState === "launching" ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
          label={probeState === "launching" ? "Opening" : "Launch"}
          onClick={onLaunch}
          disabled={probeState === "probing"}
          title="Open Vox"
        />
        <VoxSetupButton
          icon={probeState === "probing" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          label="Retry"
          onClick={onRetry}
          disabled={isBusy}
          title="Check Vox again"
        />
        <VoxSetupButton
          icon={<Settings size={12} />}
          label="Settings"
          onClick={onSettings}
          disabled={probeState === "probing"}
          title="Open Vox settings"
        />
      </div>
    </div>
  );
}

function VoxSetupButton({
  icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-8 items-center justify-center gap-1.5 rounded border border-lime-300/20 px-2 text-[9px] uppercase tracking-[0.12em] text-lime-100 transition-colors hover:bg-lime-300/10 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      {label}
    </button>
  );
}

function usePersistentBoolean(key: string, initialValue: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initialValue : stored === "true";
    } catch {
      return initialValue;
    }
  });

  const setPersistentValue = useCallback((next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next ? "true" : "false");
    } catch {
      /* storage may be unavailable */
    }
  }, [key]);

  return [value, setPersistentValue];
}
