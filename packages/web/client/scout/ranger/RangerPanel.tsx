import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, ChevronDown, ChevronUp, Compass, Gauge, ListChecks, Loader2, Map, Mic, Radio, RefreshCw, Rocket, SendHorizontal, Settings, Square, Volume2, VolumeX } from "lucide-react";
import { api } from "../../lib/api.ts";
import { getOpenAIApiKey } from "../../lib/credentials.ts";
import { usePersistentBoolean, usePersistentNumber } from "../../lib/persistent-state.ts";
import { extractRangerUiActions, normalizeRangerUiAction } from "../../lib/ranger.ts";
import { isVoxSpeechStopped, playPreparedVoxSpeech, prepareVoxSpeech, startVoxSpeech, VoxBrowserClient, type VoxLiveHandle, type VoxSessionState, type VoxSpeakHandle, type VoxSpeakResult } from "../../lib/vox.ts";
import { useScout } from "../Provider.tsx";

type RangerAgentConfig = {
  editable: boolean;
  model: string;
  systemPrompt: string;
};

type RangerAgentConfigUpdateResult = {
  config: RangerAgentConfig;
};

type RangerAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  createdAt: number;
};

type RangerAssistantSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messageCount: number;
  messages: RangerAssistantMessage[];
};

type RangerAssistantSessionSummary = Omit<RangerAssistantSession, "messages">;

type RangerAssistantSessionState = {
  session: RangerAssistantSession;
  sessions: RangerAssistantSessionSummary[];
  config: RangerAgentConfig;
};

type RangerAssistantReply = RangerAssistantSessionState & {
  reply: RangerAssistantMessage;
  responseId: string | null;
};

type RangerBriefStep = {
  id: string;
  label: string;
  route: Record<string, unknown>;
  narration: string;
  durationMs: number;
  snapshot: {
    capturedAt: number;
    expiresAt: number;
    source: "prepared" | "refreshed" | "live";
  };
};

type RangerBriefAction = {
  label: string;
  route?: Record<string, unknown>;
  prompt?: string;
};

type RangerBrief = {
  id: string;
  title: string;
  summary: string;
  preparedAt: number;
  expiresAt: number;
  ttlMs: number;
  steps: RangerBriefStep[];
  recommendation: string;
  actions: RangerBriefAction[];
};

type VoiceProbeState = "idle" | "probing" | "launching";

const STATE_PROMPT =
  "What's the state of things? Give me a terse ops summary, the biggest risk, and the next action you recommend.";
const RANGER_VOICE_SPEEDS = [1, 1.2, 1.35] as const;
const DEFAULT_RANGER_VOICE_SPEED = 1.2;

export function RangerPanel({ height }: { height?: number } = {}) {
  const {
    applyRangerUiAction,
    route,
  } = useScout();

  const [collapsed, setCollapsed] = usePersistentBoolean("openscout.ranger.collapsed", false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [voiceIssue, setVoiceIssue] = useState<string | null>(null);
  const [voiceProbeState, setVoiceProbeState] = useState<VoiceProbeState>("idle");
  const [voiceReplies, setVoiceReplies] = usePersistentBoolean("openscout.ranger.voiceReplies", false);
  const [voiceSpeed, setVoiceSpeed] = usePersistentNumber("openscout.ranger.voiceSpeed", DEFAULT_RANGER_VOICE_SPEED);
  const [briefing, setBriefing] = useState(false);
  const [brief, setBrief] = useState<RangerBrief | null>(null);
  const [briefStepIndex, setBriefStepIndex] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceState, setVoiceState] = useState<VoxSessionState | null>(null);
  const [partial, setPartial] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [lastAsk, setLastAsk] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [askStatus, setAskStatus] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionState, setSessionState] = useState<RangerAssistantSessionState | null>(null);
  const [resettingSession, setResettingSession] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const clientRef = useRef<VoxBrowserClient | null>(null);
  const liveRef = useRef<VoxLiveHandle | null>(null);
  const speechRef = useRef<VoxSpeakHandle | null>(null);
  const briefRunRef = useRef<string | null>(null);
  const voiceRepliesRef = useRef(voiceReplies);
  voiceRepliesRef.current = voiceReplies;

  const stopSpeech = useCallback(() => {
    speechRef.current?.stop();
    speechRef.current = null;
    setSpeaking(false);
  }, []);

  useEffect(() => () => {
    briefRunRef.current = null;
    stopSpeech();
  }, [stopSpeech]);

  const syncLastMessages = useCallback((session: RangerAssistantSession) => {
    const lastUser = [...session.messages].reverse().find((message) => message.role === "user");
    const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
    setLastAsk(lastUser?.body ?? null);
    setLastReply(lastAssistant ? stripRangerUiFences(lastAssistant.body) : null);
  }, []);

  const loadRangerSession = useCallback(async () => {
    try {
      const state = await api<RangerAssistantSessionState>("/api/ranger/session");
      setSessionState(state);
      syncLastMessages(state.session);
    } catch {
      setSessionState(null);
    }
  }, [syncLastMessages]);

  useEffect(() => {
    void loadRangerSession();
  }, [loadRangerSession]);

  const loadRangerConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const config = await api<RangerAgentConfig>("/api/ranger/config");
      setModelDraft(config.model);
      setPromptDraft(config.systemPrompt);
      setConfigStatus(null);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Could not load Ranger settings.");
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      void loadRangerConfig();
    }
  }, [loadRangerConfig, settingsOpen]);

  const saveRangerConfig = useCallback(async () => {
    setConfigSaving(true);
    setConfigError(null);
    setConfigStatus(null);
    try {
      const result = await api<RangerAgentConfigUpdateResult>(
        "/api/ranger/config",
        {
          method: "POST",
          body: JSON.stringify({
            model: modelDraft,
            systemPrompt: promptDraft,
          }),
        },
      );
      setModelDraft(result.config.model);
      setPromptDraft(result.config.systemPrompt);
      setConfigStatus("Saved");
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Could not save Ranger settings.");
    } finally {
      setConfigSaving(false);
    }
  }, [modelDraft, promptDraft]);

  const resetRangerSession = useCallback(async () => {
    setResettingSession(true);
    setError(null);
    setAskStatus("Starting fresh Ranger session");
    stopSpeech();
    try {
      const state = await api<RangerAssistantSessionState>("/api/ranger/session/reset", { method: "POST" });
      setSessionState(state);
      setLastAsk(null);
      setLastReply(null);
      setAskStatus("Fresh Ranger session ready");
    } catch (err) {
      setAskStatus(null);
      setError(err instanceof Error ? err.message : "Could not start a fresh Ranger session.");
    } finally {
      setResettingSession(false);
    }
  }, [stopSpeech]);

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

  const handleRangerReply = useCallback((body: string) => {
    const replyText = stripRangerUiFences(body);
    setLastReply(replyText);
    for (const action of extractRangerUiActions(body)) {
      applyRangerUiAction(action);
    }
    if (!replyText || !voiceRepliesRef.current) {
      return;
    }
    stopSpeech();
    const speech = startVoxSpeech(replyText, { speed: voiceSpeed });
    speechRef.current = speech;
    setSpeaking(true);
    void speech.promise
      .catch((err) => {
        if (!isVoxSpeechStopped(err)) {
          setError(err instanceof Error ? err.message : "Vox speech failed.");
        }
      })
      .finally(() => {
        if (speechRef.current === speech) {
          speechRef.current = null;
          setSpeaking(false);
        }
      });
  }, [applyRangerUiAction, stopSpeech, voiceSpeed]);

  const cycleVoiceSpeed = useCallback(() => {
    const nearestIndex = RANGER_VOICE_SPEEDS.reduce((bestIndex, candidate, index) => (
      Math.abs(candidate - voiceSpeed) < Math.abs(RANGER_VOICE_SPEEDS[bestIndex] - voiceSpeed)
        ? index
        : bestIndex
    ), 0);
    setVoiceSpeed(RANGER_VOICE_SPEEDS[(nearestIndex + 1) % RANGER_VOICE_SPEEDS.length]);
  }, [setVoiceSpeed, voiceSpeed]);

  const prepareBriefSpeech = useCallback((text: string): Promise<VoxSpeakResult | null> => {
    if (!voiceRepliesRef.current) {
      return Promise.resolve(null);
    }
    return prepareVoxSpeech(text, { speed: voiceSpeed })
      .catch((err) => {
        if (!isVoxSpeechStopped(err)) {
          setError(err instanceof Error ? err.message : "Vox speech failed.");
        }
        return null;
      });
  }, [voiceSpeed]);

  const playBriefSpeech = useCallback(async (
    prepared: Promise<VoxSpeakResult | null>,
    runId: string,
  ): Promise<boolean> => {
    const audio = await prepared;
    if (!audio || briefRunRef.current !== runId || !voiceRepliesRef.current) {
      return false;
    }
    const controller = new AbortController();
    const promise = playPreparedVoxSpeech(audio, { signal: controller.signal });
    const speech: VoxSpeakHandle = {
      promise,
      stop: () => controller.abort(),
    };
    speechRef.current = speech;
    setSpeaking(true);
    try {
      await promise;
    } catch (err) {
      if (!isVoxSpeechStopped(err)) {
        throw err;
      }
    } finally {
      if (speechRef.current === speech) {
        speechRef.current = null;
        setSpeaking(false);
      }
    }
    return true;
  }, []);

  const runBrief = useCallback(async (nextBrief: RangerBrief, runId: string) => {
    const segments = [
      ...nextBrief.steps.map((step) => ({
        id: step.id,
        label: step.label,
        route: step.route,
        narration: step.narration,
        durationMs: step.durationMs,
      })),
      {
        id: "recommendation",
        label: "Recommendation",
        route: null,
        narration: `Recommendation: ${nextBrief.recommendation}`,
        durationMs: estimateBriefDuration(nextBrief.recommendation),
      },
    ];
    const spokenLines: string[] = [];
    let preparedSpeech = prepareBriefSpeech(segments[0]?.narration ?? nextBrief.summary);

    for (let index = 0; index < segments.length; index += 1) {
      if (briefRunRef.current !== runId) return;
      if (Date.now() > nextBrief.expiresAt) {
        setAskStatus("Brief expired; refresh before acting");
        break;
      }

      const segment = segments[index];
      const nextSegment = segments[index + 1];
      const currentSpeech = preparedSpeech;
      preparedSpeech = nextSegment
        ? prepareBriefSpeech(nextSegment.narration)
        : Promise.resolve(null);

      setBriefStepIndex(Math.min(index, nextBrief.steps.length - 1));
      setAskStatus(`Brief ${Math.min(index + 1, nextBrief.steps.length)}/${nextBrief.steps.length}: ${segment.label}`);
      if (segment.route) {
        const action = normalizeRangerUiAction({ type: "navigate", route: segment.route });
        if (action?.type === "navigate") {
          applyRangerUiAction(action);
        }
      }
      spokenLines.push(`${segment.label}: ${segment.narration}`);

      if (voiceRepliesRef.current) {
        const played = await playBriefSpeech(currentSpeech, runId);
        if (!played) {
          await wait(Math.min(segment.durationMs, 2400));
        }
      } else {
        await wait(Math.min(segment.durationMs, 2400));
      }
    }

    if (briefRunRef.current !== runId) return;
    setLastReply([
      nextBrief.summary,
      "",
      ...spokenLines,
    ].join("\n"));
    setAskStatus(Date.now() > nextBrief.expiresAt ? "Brief expired" : "Brief complete");
    setBriefing(false);
    setBriefStepIndex(null);
    briefRunRef.current = null;
  }, [applyRangerUiAction, playBriefSpeech, prepareBriefSpeech]);

  const startBrief = useCallback(async () => {
    if (briefing || sending) return;
    const runId = `brief-${Date.now()}`;
    briefRunRef.current = runId;
    setBriefing(true);
    setBrief(null);
    setBriefStepIndex(null);
    setError(null);
    setLastAsk("One-minute brief");
    setLastReply(null);
    setAskStatus("Preparing one-minute brief");
    stopSpeech();
    try {
      const nextBrief = await api<RangerBrief>("/api/ranger/brief", {
        method: "POST",
        body: JSON.stringify({
          route,
          ttlMs: 2 * 60_000,
          openaiApiKey: await getOpenAIApiKey().catch(() => null),
        }),
      });
      if (briefRunRef.current !== runId) return;
      setBrief(nextBrief);
      await runBrief(nextBrief, runId);
    } catch (err) {
      if (briefRunRef.current === runId) {
        setAskStatus(null);
        setError(err instanceof Error ? err.message : "Could not prepare Ranger brief.");
        setBriefing(false);
        setBriefStepIndex(null);
        briefRunRef.current = null;
      }
    }
  }, [briefing, route, runBrief, sending, stopSpeech]);

  const askRanger = useCallback(async (body: string) => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setLastAsk(trimmed);
    setLastReply(null);
    setAskStatus("Sending to Ranger");
    try {
      const result = await api<RangerAssistantReply>("/api/ranger/chat", {
        method: "POST",
        body: JSON.stringify({
          body: trimmed,
          route,
          openaiApiKey: await getOpenAIApiKey().catch(() => null),
        }),
      });
      setSessionState({
        session: result.session,
        sessions: result.sessions,
        config: result.config,
      });
      setDraft("");
      setAskStatus("Ranger replied");
      handleRangerReply(result.reply.body);
    } catch (err) {
      setAskStatus(null);
      setError(err instanceof Error ? err.message : "Could not ask Ranger.");
    } finally {
      setSending(false);
    }
  }, [handleRangerReply, route, sending]);

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

  useEffect(() => {
    const openHandler = () => setCollapsed(false);
    window.addEventListener("scout:ranger-panel-open", openHandler);
    return () => window.removeEventListener("scout:ranger-panel-open", openHandler);
  }, [setCollapsed]);

  useEffect(() => {
    const submitHandler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const body = detail && typeof detail === "object" && "body" in detail
        ? (detail as { body?: unknown }).body
        : null;
      if (typeof body === "string" && body.trim()) {
        setCollapsed(false);
        void askRanger(body);
      }
    };
    window.addEventListener("scout:ranger-submit", submitHandler);
    return () => window.removeEventListener("scout:ranger-submit", submitHandler);
  }, [askRanger, setCollapsed]);

  const voiceLabel = recording
    ? voiceState === "processing" ? "Sending" : "Stop"
    : voiceProbeState === "probing" ? "Checking Vox"
    : voiceProbeState === "launching" ? "Opening Vox"
    : voiceAvailable === false ? "Launch Vox" : "Start Talking";
  const activeSession = sessionState?.session ?? null;
  const activeSessionId = activeSession?.id ?? null;
  const sessionStartedLabel = activeSession?.createdAt
    ? new Date(activeSession.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const sessionRuntimeLabel = activeSession?.model ?? sessionState?.config.model ?? null;

  if (collapsed) {
    return (
      <section className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--scout-chrome-border-soft)] bg-black/10 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Bot size={12} className="text-lime-300" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--scout-chrome-ink-strong)]">
            Ranger
          </span>
          <span className="truncate font-mono text-[10px] text-[var(--scout-chrome-ink-faint)]">
            · direct loop
            {activeSessionId ? ` · ${activeSessionId.slice(0, 8)}` : ""}
          </span>
        </div>
        <button
          type="button"
          title="Expand Ranger"
          aria-label="Expand Ranger"
          onClick={() => setCollapsed(false)}
          className="shrink-0 rounded border border-[var(--scout-chrome-border-soft)] p-1 text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
        >
          <ChevronUp size={12} />
        </button>
      </section>
    );
  }

  const expandedClassName = height === undefined
    ? "flex max-h-[60vh] shrink-0 flex-col gap-2.5 overflow-y-auto border-t border-[var(--scout-chrome-border-soft)] p-3"
    : "flex shrink-0 flex-col gap-2.5 overflow-y-auto border-t border-[var(--scout-chrome-border-soft)] p-3";
  const expandedStyle = height === undefined ? undefined : { height: `${height}px` };

  return (
    <section className={expandedClassName} style={expandedStyle}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-lime-300" />
            <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--scout-chrome-ink-strong)]">
              Ranger
            </h2>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-[var(--scout-chrome-ink-faint)]">
            Direct Scout control loop
            {sessionRuntimeLabel ? ` · ${sessionRuntimeLabel}` : ""}
            {activeSessionId ? ` · session ${activeSessionId.slice(0, 8)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="Ranger settings"
            onClick={() => setSettingsOpen((open) => !open)}
            className={`rounded border p-1.5 transition-colors ${
              settingsOpen
                ? "border-lime-300/50 bg-lime-300/10 text-lime-200"
                : "border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
            }`}
          >
            <Settings size={13} />
          </button>
          <button
            type="button"
            title="Minimize Ranger"
            aria-label="Minimize Ranger"
            onClick={() => setCollapsed(true)}
            className="rounded border border-[var(--scout-chrome-border-soft)] p-1.5 text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      <div className="flex items-stretch gap-1.5">
        <RangerActionButton
          icon={<Radio size={13} />}
          label="State"
          onClick={() => void askRanger(STATE_PROMPT)}
          disabled={sending || briefing}
        />
        <RangerActionButton
          icon={briefing ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />}
          label={briefing ? "Briefing" : "Brief"}
          title="Run a one-minute Ranger brief"
          onClick={() => void startBrief()}
          disabled={sending}
        />
        <RangerActionButton
          icon={<Map size={13} />}
          label="Ops Tail"
          onClick={() => applyRangerUiAction({ type: "navigate", route: { view: "ops", mode: "tail" } })}
          compact
        />
        <RangerActionButton
          icon={<Compass size={13} />}
          label="Fleet"
          onClick={() => applyRangerUiAction({ type: "navigate", route: { view: "fleet" } })}
          compact
        />
        <RangerActionButton
          icon={voiceReplies ? <Volume2 size={13} /> : <VolumeX size={13} />}
          label={voiceReplies ? "Replies On" : "Replies Off"}
          onClick={() => {
            const next = !voiceReplies;
            setVoiceReplies(next);
            if (!next) stopSpeech();
          }}
          compact
        />
        <RangerActionButton
          icon={<Gauge size={13} />}
          label={`${formatVoiceSpeed(voiceSpeed)}x`}
          title={`Voice speed ${formatVoiceSpeed(voiceSpeed)}x`}
          onClick={cycleVoiceSpeed}
        />
        <RangerActionButton
          icon={resettingSession ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          label="New Session"
          onClick={() => void resetRangerSession()}
          disabled={resettingSession || sending || briefing}
          compact
        />
      </div>

      {activeSessionId && (
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2 py-1.5 font-mono text-[9.5px] text-[var(--scout-chrome-ink-faint)]">
          <span className="shrink-0 uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-ghost)]">Session</span>
          <span className="shrink-0 text-lime-200" title={activeSessionId}>{activeSessionId.slice(0, 8)}</span>
          {sessionStartedLabel ? <span className="shrink-0">started {sessionStartedLabel}</span> : null}
          {sessionRuntimeLabel ? <span className="min-w-0 truncate">{sessionRuntimeLabel}</span> : null}
          {sessionState && sessionState.sessions.length > 1 ? (
            <span className="ml-auto shrink-0 text-[var(--scout-chrome-ink-ghost)]">
              {sessionState.sessions.length - 1} older
            </span>
          ) : null}
        </div>
      )}

      {brief && (
        <div className="rounded border border-lime-300/20 bg-lime-300/[0.05] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate uppercase tracking-[0.12em] text-lime-200">
              {briefing && briefStepIndex !== null
                ? `Briefing ${brief.steps[briefStepIndex]?.label ?? "step"}`
                : brief.title}
            </span>
            <span className="shrink-0 text-[var(--scout-chrome-ink-ghost)]">
              {briefFreshnessLabel(brief)}
            </span>
          </div>
          <div className="mt-1 truncate text-[var(--scout-chrome-ink-faint)]">
            {brief.summary}
          </div>
          {brief.actions.length > 0 && !briefing && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {brief.actions.map((action) => (
                <button
                  key={`${action.label}:${action.prompt ?? JSON.stringify(action.route ?? {})}`}
                  type="button"
                  onClick={() => {
                    if (action.route) {
                      const uiAction = normalizeRangerUiAction({ type: "navigate", route: action.route });
                      if (uiAction) applyRangerUiAction(uiAction);
                      return;
                    }
                    if (action.prompt) {
                      void askRanger(action.prompt);
                    }
                  }}
                  className="rounded border border-lime-300/20 px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-lime-100 hover:bg-lime-300/10"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {settingsOpen && (
        <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 p-3">
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
              Model
              <input
                value={modelDraft}
                onChange={(event) => setModelDraft(event.target.value)}
                placeholder="gpt-4.1-mini"
                className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/20 px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-[var(--scout-chrome-ink)] placeholder:text-[var(--scout-chrome-ink-ghost)]"
                disabled={configLoading || configSaving}
              />
            </label>
            <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
              System Prompt
              <textarea
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                rows={6}
                className="w-full resize-y rounded border border-[var(--scout-chrome-border-soft)] bg-black/20 px-2 py-1.5 font-mono text-[10px] normal-case leading-relaxed tracking-normal text-[var(--scout-chrome-ink)]"
                disabled={configLoading || configSaving}
              />
            </label>
            {configError && (
              <div className="font-mono text-[10px] leading-relaxed text-red-300">
                {configError}
              </div>
            )}
            {configStatus && (
              <div className="font-mono text-[10px] leading-relaxed text-lime-200">
                {configStatus}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveRangerConfig()}
                disabled={configLoading || configSaving || !promptDraft.trim()}
                className="flex items-center justify-center gap-2 rounded bg-lime-300/90 px-2.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {(configLoading || configSaving) && <Loader2 size={13} className="animate-spin" />}
                {configSaving ? "Saving" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void loadRangerConfig()}
                disabled={configLoading || configSaving}
                className="rounded border border-[var(--scout-chrome-border-soft)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )}

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
        <div className="flex items-center justify-between gap-2 rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
          <span className="min-w-0 truncate">{speaking ? "Speaking Ranger reply…" : partial}</span>
          {speaking && (
            <button
              type="button"
              title="Stop spoken reply"
              onClick={stopSpeech}
              className="shrink-0 rounded border border-[var(--scout-chrome-border-soft)] p-1 text-[var(--scout-chrome-ink)] hover:bg-[var(--scout-chrome-hover)]"
            >
              <Square size={11} className="fill-current" />
            </button>
          )}
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
          ) : askStatus === "Sending to Ranger" ? (
            <p className="mt-1 text-[var(--scout-chrome-ink-ghost)]">Reading the control plane...</p>
          ) : null}
        </div>
      )}

      <form
        className="grid grid-cols-[1fr_auto] gap-2"
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
          title="Ask Ranger"
          aria-label="Ask Ranger"
          disabled={!draft.trim() || sending}
          className="flex w-9 items-center justify-center rounded bg-lime-300/90 px-0 py-2 text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <SendHorizontal size={13} />}
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

function formatVoiceSpeed(value: number): string {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function estimateBriefDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(12_000, Math.max(3500, words * 360));
}

function briefFreshnessLabel(brief: RangerBrief): string {
  const now = Date.now();
  if (now > brief.expiresAt) {
    return "expired";
  }
  const ageSeconds = Math.max(0, Math.round((now - brief.preparedAt) / 1000));
  const remainingSeconds = Math.max(0, Math.round((brief.expiresAt - now) / 1000));
  return `prepared ${ageSeconds}s ago · ${remainingSeconds}s TTL`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function RangerActionButton({
  icon,
  label,
  title,
  onClick,
  disabled,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-8 items-center justify-center gap-1.5 rounded border border-[var(--scout-chrome-border-soft)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink)] transition-colors hover:bg-[var(--scout-chrome-hover)] disabled:cursor-not-allowed disabled:opacity-45 ${
        compact ? "w-8 shrink-0 px-0" : "min-w-0 flex-1 px-2"
      }`}
    >
      {icon}
      {!compact && <span className="truncate">{label}</span>}
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
