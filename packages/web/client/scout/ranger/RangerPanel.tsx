import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Compass, Loader2, Map, Mic, MicOff, Radio, Volume2, VolumeX } from "lucide-react";
import { api } from "../../lib/api.ts";
import { isRangerActorId, isRangerAgent } from "../../lib/ranger.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { speakWithVox, VoxBrowserClient, type VoxLiveHandle, type VoxSessionState } from "../../lib/vox.ts";
import { useScout } from "../Provider.tsx";

type SendResult = {
  conversationId?: string;
};

const STATE_PROMPT =
  "What's the state of things? Give me a terse ops summary, the biggest risk, and the next action you recommend.";

export function RangerPanel() {
  const {
    agents,
    navigate,
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
  const [voiceReplies, setVoiceReplies] = usePersistentBoolean("openscout.ranger.voiceReplies", false);
  const [recording, setRecording] = useState(false);
  const [voiceState, setVoiceState] = useState<VoxSessionState | null>(null);
  const [partial, setPartial] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const clientRef = useRef<VoxBrowserClient | null>(null);
  const liveRef = useRef<VoxLiveHandle | null>(null);
  const voiceRepliesRef = useRef(voiceReplies);
  voiceRepliesRef.current = voiceReplies;

  useEffect(() => {
    const client = new VoxBrowserClient();
    clientRef.current = client;
    void client.probe().then(setVoiceAvailable);
  }, []);

  const openRanger = useCallback((mode: "ask" | "tell" = "ask") => {
    navigate({
      view: "conversation",
      conversationId: rangerConversationId,
      ...(mode === "ask" ? { composeMode: "ask" } : {}),
    });
  }, [navigate, rangerConversationId]);

  const askRanger = useCallback(async (body: string) => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await api<SendResult>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          body: trimmed,
          conversationId: rangerConversationId,
        }),
      });
      setDraft("");
      navigate({
        view: "conversation",
        conversationId: result.conversationId ?? rangerConversationId,
        composeMode: "ask",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not ask Ranger.");
    } finally {
      setSending(false);
    }
  }, [navigate, rangerConversationId, sending]);

  const startVoice = useCallback(async () => {
    if (recording) return;
    const client = clientRef.current ?? new VoxBrowserClient();
    clientRef.current = client;
    setError(null);
    setPartial("");
    setVoiceState("starting");

    if (voiceAvailable !== true) {
      const ok = await client.probe();
      setVoiceAvailable(ok);
      if (!ok) {
        setVoiceState(null);
        setError("Vox Companion is not reachable.");
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
  }, [askRanger, recording, voiceAvailable]);

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
    if (!voiceRepliesRef.current || event.kind !== "message.posted") {
      return;
    }
    const message = event.payload && typeof event.payload === "object"
      ? (event.payload as { message?: unknown }).message
      : null;
    if (!message || typeof message !== "object") {
      return;
    }
    const record = message as { actorId?: unknown; body?: unknown };
    if (
      typeof record.actorId !== "string" ||
      !isRangerActorId(record.actorId, rangerAgentId) ||
      typeof record.body !== "string" ||
      !record.body.trim()
    ) {
      return;
    }
    setSpeaking(true);
    void speakWithVox(record.body)
      .catch((err) => setError(err instanceof Error ? err.message : "Vox speech failed."))
      .finally(() => setSpeaking(false));
  });

  const voiceLabel = recording
    ? voiceState === "processing" ? "Processing" : "Listening"
    : voiceAvailable === false ? "Launch Vox" : "Talk";
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
        <button
          type="button"
          onClick={() => openRanger("ask")}
          className="rounded border border-[var(--scout-chrome-border-soft)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink)] hover:bg-[var(--scout-chrome-hover)]"
        >
          Open
        </button>
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

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (voiceAvailable === false) {
              clientRef.current?.launch();
              return;
            }
            void (recording ? stopVoice() : startVoice());
          }}
          className={`flex flex-1 items-center justify-center gap-2 rounded border px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
            recording
              ? "border-lime-300/50 bg-lime-300/10 text-lime-200"
              : "border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink)] hover:bg-[var(--scout-chrome-hover)]"
          }`}
          disabled={sending || voiceState === "processing"}
        >
          {voiceState === "processing" ? <Loader2 size={13} className="animate-spin" /> : recording ? <MicOff size={13} /> : <Mic size={13} />}
          {voiceLabel}
        </button>
        {recording && (
          <button
            type="button"
            onClick={() => void cancelVoice()}
            className="rounded border border-[var(--scout-chrome-border-soft)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)]"
          >
            Cancel
          </button>
        )}
      </div>

      {(partial || speaking) && (
        <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
          {speaking ? "Speaking Ranger reply…" : partial}
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
