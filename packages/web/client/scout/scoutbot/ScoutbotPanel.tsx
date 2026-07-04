import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, Loader2, Radio, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { ScoutbotBroadcastChip } from "../../components/ScoutbotBroadcastChip.tsx";
import { ensureOpenAIKeyOnServer } from "../../lib/credentials.ts";
import { usePersistentBoolean, usePersistentNumber, usePersistentString } from "../../lib/persistent-state.ts";
import {
  clearClientBroadcast,
  dismissPromotedBroadcast,
  emitClientBroadcast,
  onToggleScoutbot,
  selectActiveBroadcast,
  useScoutbotBroadcastStore,
} from "../../lib/scoutbot-broadcast-store.ts";
import { extractScoutbotUiActions, normalizeScoutbotUiAction, stripScoutbotUiFences } from "../../lib/scoutbot.ts";
import { parseScoutbotReminderIntent } from "../../lib/scoutbot-reminder-intent.ts";
import { toSpokenScoutText } from "../../lib/spoken-text.ts";
import {
  isScoutSpeechStopped,
  playPreparedScoutSpeechWithEffects,
  prepareScoutSpeech,
  ensureScoutVoiceAutoProbe,
  getSharedScoutVoiceClient,
  startScoutSpeechWithEffects,
  subscribeScoutVoiceProbe,
  type ScoutVoiceLiveHandle,
  type ScoutVoiceSessionState,
  type ScoutSpeechHandle,
  type ScoutSpeechResult,
  type ScoutSpeechTimingCueRequest,
} from "../../lib/scout-voice.ts";
import { useScout } from "../Provider.tsx";
import {
  useScoutbotStatePublisher,
  type ScoutbotActionApi,
  type ScoutbotActivity,
  type ScoutbotPublicState,
} from "./ScoutbotStateContext.tsx";
import { ChatHistory, ChatInput } from "./ScoutbotChat.tsx";
import { ScoutbotIconButton, ScoutVoiceSetupPanel } from "./ScoutbotControls.tsx";
import { ScoutbotSettingsPanel } from "./ScoutbotSettingsPanel.tsx";
import {
  DEFAULT_SCOUTBOT_VOICE_PRESET_ID,
  DEFAULT_SCOUTBOT_VOICE_SPEED,
  SCOUTBOT_BRIEF_SPEECH_INSTRUCTIONS,
  SCOUTBOT_VOICE_SPEEDS,
  STATE_PROMPT,
  SCOUT_VOICE_STOP_TIMEOUT_MS,
  buildScoutbotBriefSpeechPlan,
  estimateBriefDuration,
  extractAbsoluteFilePaths,
  formatReminderDueAt,
  isScoutVoiceCancellation,
  makeScoutAudioLaunchContext,
  releaseScoutVoiceLive,
  resolveScoutbotBriefCueSchedule,
  resolveScoutbotFxParams,
  shortenForMenu,
  wait,
  withTimeout,
  type PreparedBriefSpeech,
  type ScoutbotAgentConfig,
  type ScoutbotAgentConfigUpdateResult,
  type ScoutbotAskAgentResult,
  type ScoutbotAssistantReply,
  type ScoutbotAssistantSession,
  type ScoutbotAssistantSessionState,
  type ScoutbotBrief,
  type ScoutbotBriefCueSchedule,
  type ScoutbotBriefSegment,
  type ScoutbotReminder,
  type ScoutbotReminderCreateResult,
  type ScoutbotReminderState,
  type ScoutbotVoiceDefaults,
  type VoiceProbeState,
  type ScoutVoiceCancelReason,
} from "./scoutbot-model.ts";

function agentPromptHandle(agent: { handle: string | null; name: string; id: string }): string {
  const raw = agent.handle?.trim() || agent.name.trim() || agent.id;
  return raw.replace(/^@+/, "").replace(/\s+/g, "-");
}

function isScoutbotPromptAgent(agent: { handle: string | null; name: string; id: string; role?: string | null }): boolean {
  const values = [agent.handle, agent.name, agent.id, agent.role].filter(Boolean).map((value) => value!.toLowerCase());
  return values.some((value) => value === "scoutbot" || value.includes("scoutbot"));
}

export function ScoutbotPanel({
  height,
  forceExpanded = false,
  fill = false,
}: {
  height?: number;
  forceExpanded?: boolean;
  fill?: boolean;
} = {}) {
  const {
    applyScoutbotUiAction,
    agents,
    route,
    onlineCount,
  } = useScout();
  const publisher = useScoutbotStatePublisher();

  const [collapsed, setCollapsed] = usePersistentBoolean("openscout.scoutbot.collapsed", true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [voiceIssue, setVoiceIssue] = useState<string | null>(null);
  const [voiceProbeState, setVoiceProbeState] = useState<VoiceProbeState>("idle");
  const [voiceReplies, setVoiceReplies] = usePersistentBoolean("openscout.scoutbot.voiceReplies", false);
  const [voiceSpeed, setVoiceSpeed] = usePersistentNumber("openscout.scoutbot.voiceSpeed", DEFAULT_SCOUTBOT_VOICE_SPEED);
  const [voicePresetId, setVoicePresetId] = usePersistentString("openscout.scoutbot.voicePresetId", DEFAULT_SCOUTBOT_VOICE_PRESET_ID);
  const [briefing, setBriefing] = useState(false);
  const [brief, setBrief] = useState<ScoutbotBrief | null>(null);
  const [briefStepIndex, setBriefStepIndex] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceState, setVoiceState] = useState<ScoutVoiceSessionState | null>(null);
  const [partial, setPartial] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [lastAsk, setLastAsk] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [askStatus, setAskStatus] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false);
  const [sessionState, setSessionState] = useState<ScoutbotAssistantSessionState | null>(null);
  const [resettingSession, setResettingSession] = useState(false);
  const [archivingSessionId, setArchivingSessionId] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [voiceDefaults, setVoiceDefaults] = useState<ScoutbotVoiceDefaults | null>(null);
  const [reminderState, setReminderState] = useState<ScoutbotReminderState | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null);
  const clientRef = useRef(getSharedScoutVoiceClient());
  const liveRef = useRef<ScoutVoiceLiveHandle | null>(null);
  const liveCancelReasonRef = useRef<ScoutVoiceCancelReason | null>(null);
  const speechRef = useRef<ScoutSpeechHandle | null>(null);
  const speechPrepareAbortRef = useRef<AbortController | null>(null);
  const briefRunRef = useRef<string | null>(null);
  const initializedDueReminderIdsRef = useRef(false);
  const announcedDueReminderIdsRef = useRef<Set<string>>(new Set());
  const voiceRepliesRef = useRef(voiceReplies);
  voiceRepliesRef.current = voiceReplies;

  const stopSpeech = useCallback(() => {
    speechPrepareAbortRef.current?.abort();
    speechPrepareAbortRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    setSpeaking(false);
  }, []);

  const runSpeech = useCallback((text: string) => {
    if (!text) return;
    stopSpeech();
    const speech = startScoutSpeechWithEffects(toSpokenScoutText(text), {
      speed: voiceSpeed,
      presetId: voicePresetId,
      params: resolveScoutbotFxParams(voicePresetId, onlineCount),
    });
    speechRef.current = speech;
    setSpeaking(true);
    void speech.promise
      .catch((err) => {
        if (!isScoutSpeechStopped(err)) {
          setError(err instanceof Error ? err.message : "Scout voice speech failed.");
        }
      })
      .finally(() => {
        if (speechRef.current === speech) {
          speechRef.current = null;
          setSpeaking(false);
        }
      });
  }, [stopSpeech, voiceSpeed, onlineCount, voicePresetId]);

  const speakScoutbotText = useCallback((text: string) => {
    if (!voiceRepliesRef.current) return;
    runSpeech(text);
  }, [runSpeech]);

  const replayScoutbotText = useCallback((body: string) => {
    runSpeech(stripScoutbotUiFences(body));
  }, [runSpeech]);

  const { openFilePreview } = useScout();
  const showContextMenu = useContextMenu();
  const onAssistantMessageContextMenu = useCallback(
    (event: React.MouseEvent, body: string) => {
      const sel = window.getSelection()?.toString().trim();
      const text = stripScoutbotUiFences(body);
      const paths = extractAbsoluteFilePaths(text);
      const items: MenuItem[] = [];
      if (sel) {
        items.push({
          kind: "action",
          label: "Copy selection",
          shortcut: "⌘C",
          onSelect: () => {
            void copyTextToClipboard(sel);
          },
        });
        items.push({ kind: "separator" });
      }
      items.push({
        kind: "action",
        label: "Copy message",
        onSelect: () => {
          void copyTextToClipboard(text);
        },
      });
      if (paths.length > 0) {
        items.push({ kind: "separator" });
        for (const path of paths.slice(0, 5)) {
          const display = shortenForMenu(path);
          items.push({
            kind: "action",
            label: `Preview ${display}`,
            onSelect: () => openFilePreview(path),
          });
        }
        for (const path of paths.slice(0, 5)) {
          const display = shortenForMenu(path);
          items.push({
            kind: "action",
            label: `Open ${display} in OS`,
            onSelect: () => {
              void api("/api/file/reveal", {
                method: "POST",
                body: JSON.stringify({ path }),
              }).catch(() => {});
            },
          });
        }
        items.push({
          kind: "action",
          label: paths.length === 1 ? "Copy path" : "Copy first path",
          onSelect: () => {
            void copyTextToClipboard(paths[0]);
          },
        });
      }
      items.push({ kind: "separator" });
      items.push({
        kind: "action",
        label: speaking ? "Say again (stop current)" : "Say",
        onSelect: () => replayScoutbotText(body),
      });
      showContextMenu(event, items);
    },
    [openFilePreview, replayScoutbotText, showContextMenu, speaking],
  );

  useEffect(() => () => {
    briefRunRef.current = null;
    stopSpeech();
  }, [stopSpeech]);

  const suggestedPrompts = useMemo(() => {
    const promptAgent = agents.find((agent) => !isScoutbotPromptAgent(agent) && agent.state === "working")
      ?? agents.find((agent) => !isScoutbotPromptAgent(agent));
    const mention = promptAgent ? `@${agentPromptHandle(promptAgent)}` : "@agent";
    return [
      "Let me know when this turn finishes.",
      `Ask ${mention} what needs me next.`,
      "Summarize these lanes and call out blockers.",
    ];
  }, [agents]);

  const syncLastMessages = useCallback((session: ScoutbotAssistantSession) => {
    const lastUser = [...session.messages].reverse().find((message) => message.role === "user");
    const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
    setLastAsk(lastUser?.body ?? null);
    setLastReply(lastAssistant ? stripScoutbotUiFences(lastAssistant.body) : null);
  }, []);

  const loadScoutbotSession = useCallback(async () => {
    try {
      const state = await api<ScoutbotAssistantSessionState>("/api/scoutbot/session");
      setSessionState(state);
      syncLastMessages(state.session);
    } catch {
      setSessionState(null);
    }
  }, [syncLastMessages]);

  useEffect(() => {
    void loadScoutbotSession();
  }, [loadScoutbotSession]);

  const loadScoutbotReminders = useCallback(async () => {
    try {
      setReminderState(await api<ScoutbotReminderState>("/api/scoutbot/reminders"));
    } catch {
      setReminderState(null);
    }
  }, []);

  useEffect(() => {
    void loadScoutbotReminders();
    const timer = window.setInterval(() => {
      void loadScoutbotReminders();
    }, 15_000);
    window.addEventListener("focus", loadScoutbotReminders);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", loadScoutbotReminders);
    };
  }, [loadScoutbotReminders]);

  const createScoutbotReminder = useCallback(async (input: {
    title?: string;
    body: string;
    dueAt?: number;
    delayMs?: number;
    delayMinutes?: number;
    context?: Record<string, unknown>;
  }): Promise<ScoutbotReminder> => {
    const result = await api<ScoutbotReminderCreateResult>("/api/scoutbot/reminders", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        source: "scoutbot",
      }),
    });
    setReminderState({
      generatedAt: result.generatedAt,
      reminders: result.reminders,
      due: result.due,
      scheduled: result.scheduled,
    });
    return result.reminder;
  }, []);

  const dismissScoutbotReminder = useCallback(async (id: string) => {
    const next = await api<ScoutbotReminderState>(`/api/scoutbot/reminders/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
    });
    setReminderState(next);
  }, []);

  const loadScoutbotConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const config = await api<ScoutbotAgentConfig>("/api/scoutbot/config");
      setModelDraft(config.model);
      setPromptDraft(config.systemPrompt);
      setConfigStatus(null);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Could not load settings.");
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      void loadScoutbotConfig();
    }
  }, [loadScoutbotConfig, settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    void api<ScoutbotVoiceDefaults>("/api/voice/defaults")
      .then((defaults) => {
        if (!cancelled) {
          setVoiceDefaults(defaults);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVoiceDefaults(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  const saveScoutbotConfig = useCallback(async () => {
    setConfigSaving(true);
    setConfigError(null);
    setConfigStatus(null);
    try {
      const result = await api<ScoutbotAgentConfigUpdateResult>(
        "/api/scoutbot/config",
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
      setConfigError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setConfigSaving(false);
    }
  }, [modelDraft, promptDraft]);

  const switchScoutbotSession = useCallback(async (id: string) => {
    if (!id || switchingSessionId) return;
    setSwitchingSessionId(id);
    setError(null);
    stopSpeech();
    try {
      const state = await api<ScoutbotAssistantSessionState>("/api/scoutbot/session/switch", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      setSessionState(state);
      syncLastMessages(state.session);
      setSessionPickerOpen(false);
      setChatExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch session.");
    } finally {
      setSwitchingSessionId(null);
    }
  }, [stopSpeech, switchingSessionId, syncLastMessages]);

  const resetScoutbotSession = useCallback(async () => {
    setResettingSession(true);
    setError(null);
    setAskStatus("Starting fresh session");
    stopSpeech();
    try {
      const state = await api<ScoutbotAssistantSessionState>("/api/scoutbot/session/reset", { method: "POST" });
      setSessionState(state);
      setLastAsk(null);
      setLastReply(null);
      setChatExpanded(false);
      setSessionPickerOpen(false);
      setAskStatus("Fresh session ready");
    } catch (err) {
      setAskStatus(null);
      setError(err instanceof Error ? err.message : "Could not start a fresh session.");
    } finally {
      setResettingSession(false);
    }
  }, [stopSpeech]);

  const archiveScoutbotSession = useCallback(async (id: string) => {
    if (!id || archivingSessionId) return;
    setArchivingSessionId(id);
    setError(null);
    stopSpeech();
    try {
      const state = await api<ScoutbotAssistantSessionState>("/api/scoutbot/session/archive", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      setSessionState(state);
      syncLastMessages(state.session);
      setChatExpanded(false);
      setAskStatus("session archived");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive session.");
    } finally {
      setArchivingSessionId(null);
    }
  }, [archivingSessionId, stopSpeech, syncLastMessages]);

  const applyProbeState = useCallback((client: ReturnType<typeof getSharedScoutVoiceClient>, ok: boolean) => {
    setVoiceAvailable(ok);
    setVoiceIssue(ok ? null : client.lastUnavailableReason ?? "Scout voice service is not reachable.");
    setVoiceProbeState("idle");
  }, []);

  const probeVoice = useCallback(async (force = false) => {
    const client = clientRef.current;
    setVoiceProbeState((state) => (state === "launching" ? state : "probing"));

    const ok = await client.probe(force ? { force: true } : undefined);
    applyProbeState(client, ok);
    return ok;
  }, [applyProbeState]);

  useEffect(() => {
    ensureScoutVoiceAutoProbe();
    const client = clientRef.current;
    const unsubscribe = subscribeScoutVoiceProbe((snapshot) => {
      setVoiceAvailable(snapshot.ok);
      setVoiceIssue(snapshot.ok ? null : snapshot.reason);
      setVoiceProbeState("idle");
    });

    if (client.connectionState === "unknown") {
      void probeVoice();
    } else {
      applyProbeState(client, client.connectionState === "connected");
    }

    return unsubscribe;
  }, [applyProbeState, probeVoice]);

  const launchScoutVoice = useCallback(() => {
    const client = clientRef.current;
    setError(null);
    setVoiceProbeState("launching");
    void client.launch({ source: "openscout", context: makeScoutAudioLaunchContext() });
    window.setTimeout(() => {
      void probeVoice(true);
    }, 2400);
  }, [probeVoice]);

  const handleScoutbotReply = useCallback((body: string) => {
    const replyText = stripScoutbotUiFences(body);
    setLastReply(replyText);
    for (const action of extractScoutbotUiActions(body)) {
      if (action.type === "ask-agent") {
        setAskStatus(`Asking ${action.targetLabel}`);
        void api<ScoutbotAskAgentResult>("/api/scoutbot/actions/ask", {
          method: "POST",
          body: JSON.stringify({
            targetLabel: action.targetLabel,
            targetAgentId: action.targetAgentId,
            body: action.body,
            channel: action.channel,
          }),
        }).then((result) => {
          setAskStatus(
            result.flightId
              ? `Asked ${result.targetAgentId ?? result.targetLabel} · flight ${result.flightId}`
              : `Asked ${result.targetAgentId ?? result.targetLabel}`,
          );
        }).catch((err) => {
          setAskStatus(null);
          setError(err instanceof Error ? err.message : "Could not ask agent.");
        });
      } else if (action.type === "reminder") {
        void createScoutbotReminder({
          title: action.title,
          body: action.body,
          dueAt: action.dueAt,
          delayMs: action.delayMs,
          delayMinutes: action.delayMinutes,
          context: { route, reason: action.reason },
        }).then((reminder) => {
          setAskStatus(`Reminder set for ${formatReminderDueAt(reminder.dueAt)}`);
        }).catch((err) => {
          setError(err instanceof Error ? err.message : "Could not set reminder.");
        });
      } else {
        applyScoutbotUiAction(action);
      }
    }
    speakScoutbotText(replyText);
  }, [applyScoutbotUiAction, createScoutbotReminder, route, speakScoutbotText]);

  useEffect(() => {
    const due = reminderState?.due ?? [];
    if (!initializedDueReminderIdsRef.current) {
      for (const reminder of due) {
        announcedDueReminderIdsRef.current.add(reminder.id);
      }
      initializedDueReminderIdsRef.current = true;
      return;
    }

    const freshDue = due.find((reminder) => !announcedDueReminderIdsRef.current.has(reminder.id));
    if (!freshDue) {
      return;
    }

    for (const reminder of due) {
      announcedDueReminderIdsRef.current.add(reminder.id);
    }
    const text = `Reminder due: ${freshDue.body}`;
    setAskStatus("Reminder due");
    setLastReply(text);
    speakScoutbotText(text);
  }, [reminderState, speakScoutbotText]);

  const cycleVoiceSpeed = useCallback(() => {
    const nearestIndex = SCOUTBOT_VOICE_SPEEDS.reduce((bestIndex, candidate, index) => (
      Math.abs(candidate - voiceSpeed) < Math.abs(SCOUTBOT_VOICE_SPEEDS[bestIndex] - voiceSpeed)
        ? index
        : bestIndex
    ), 0);
    setVoiceSpeed(SCOUTBOT_VOICE_SPEEDS[(nearestIndex + 1) % SCOUTBOT_VOICE_SPEEDS.length]);
  }, [setVoiceSpeed, voiceSpeed]);

  const prepareBriefSpeech = useCallback((
    text: string,
    cues: ScoutSpeechTimingCueRequest[],
    runId: string,
  ): PreparedBriefSpeech => {
    if (!voiceRepliesRef.current) {
      return {
        promise: Promise.resolve(null),
        abort: () => undefined,
      };
    }
    speechPrepareAbortRef.current?.abort();
    const controller = new AbortController();
    speechPrepareAbortRef.current = controller;
    const abort = () => {
      controller.abort();
      if (speechPrepareAbortRef.current === controller) {
        speechPrepareAbortRef.current = null;
      }
    };
    const promise = prepareScoutSpeech(text, {
      speed: voiceSpeed,
      instructions: SCOUTBOT_BRIEF_SPEECH_INSTRUCTIONS,
      signal: controller.signal,
      originAppId: "openscout.scoutbot",
      utteranceId: `scoutbot-brief:${runId}`,
      ...(cues.length > 0 ? { speechTiming: { enabled: true, cues } } : {}),
    })
      .catch((err) => {
        if (!isScoutSpeechStopped(err)) {
          setError(err instanceof Error ? err.message : "Scout voice speech failed.");
        }
        return null;
      })
      .finally(() => {
        if (speechPrepareAbortRef.current === controller) {
          speechPrepareAbortRef.current = null;
        }
      });
    return { promise, abort };
  }, [voiceSpeed]);

  const playBriefSpeech = useCallback(async (
    prepared: Promise<ScoutSpeechResult | null>,
    runId: string,
    options: {
      cueSchedule?: ScoutbotBriefCueSchedule[];
      onCue?: (cue: ScoutbotBriefCueSchedule) => void;
    } = {},
  ): Promise<boolean> => {
    const audio = await prepared;
    if (!audio || briefRunRef.current !== runId || !voiceRepliesRef.current) {
      return false;
    }
    const controller = new AbortController();
    const cueTimers: number[] = [];
    const fxParams = resolveScoutbotFxParams(voicePresetId, onlineCount);
    const playbackRate = Math.min(2, Math.max(0.5, fxParams.playbackRate ?? 1));
    const clearCueTimers = () => {
      for (const timer of cueTimers) {
        window.clearTimeout(timer);
      }
      cueTimers.length = 0;
    };
    const scheduleCueTimers = () => {
      if (!options.cueSchedule?.length) {
        return;
      }
      for (const cue of options.cueSchedule) {
        const delayMs = Math.max(0, cue.activateMs / playbackRate);
        cueTimers.push(window.setTimeout(() => {
          if (controller.signal.aborted || briefRunRef.current !== runId) {
            return;
          }
          options.onCue?.(cue);
        }, delayMs));
      }
    };
    const promise = playPreparedScoutSpeechWithEffects(audio, {
      signal: controller.signal,
      presetId: voicePresetId,
      params: fxParams,
      onPlaybackStart: scheduleCueTimers,
    });
    const speech: ScoutSpeechHandle = {
      promise,
      stop: () => {
        clearCueTimers();
        controller.abort();
      },
    };
    speechRef.current?.stop();
    speechRef.current = speech;
    setSpeaking(true);
    try {
      await promise;
    } catch (err) {
      if (!isScoutSpeechStopped(err)) {
        throw err;
      }
    } finally {
      clearCueTimers();
      if (speechRef.current === speech) {
        speechRef.current = null;
        setSpeaking(false);
      }
    }
    return true;
  }, [onlineCount, voicePresetId]);

  const runBrief = useCallback(async (nextBrief: ScoutbotBrief, runId: string) => {
    const segments: ScoutbotBriefSegment[] = [
      ...nextBrief.steps.map((step) => ({
        id: step.id,
        cueId: `step:${step.id}`,
        label: step.label,
        route: step.route,
        narration: step.narration,
        durationMs: step.durationMs,
      })),
      {
        id: "recommendation",
        cueId: "recommendation",
        label: "Recommendation",
        route: null,
        narration: `Recommendation: ${nextBrief.recommendation}`,
        durationMs: estimateBriefDuration(nextBrief.recommendation),
      },
    ];
    const spokenLines: string[] = [];
    const speechPlan = buildScoutbotBriefSpeechPlan(segments);
    let preparedBriefSpeech: PreparedBriefSpeech | null = null;
    let preparedAudio: ScoutSpeechResult | null = null;

    const activateSegment = (segment: ScoutbotBriefSegment, index: number) => {
      setBriefStepIndex(Math.min(index, nextBrief.steps.length - 1));
      setAskStatus(`Brief ${Math.min(index + 1, nextBrief.steps.length)}/${nextBrief.steps.length}: ${segment.label}`);
      if (segment.route) {
        const action = normalizeScoutbotUiAction({ type: "navigate", route: segment.route });
        if (action?.type === "navigate") {
          applyScoutbotUiAction(action);
        }
      }
      spokenLines.push(`${segment.label}: ${segment.narration}`);
    };

    const runEstimatedSequence = async () => {
      for (let index = 0; index < segments.length; index += 1) {
        if (briefRunRef.current !== runId) return;
        if (Date.now() > nextBrief.expiresAt) {
          setAskStatus("Brief expired; refresh before acting");
          break;
        }

        const segment = segments[index];
        activateSegment(segment, index);
        await wait(Math.min(segment.durationMs, 2400));
      }
    };

    if (voiceRepliesRef.current) {
      setAskStatus("Preparing brief audio");
      preparedBriefSpeech = prepareBriefSpeech(
        speechPlan.text || toSpokenScoutText(nextBrief.summary),
        speechPlan.cues,
        runId,
      );
      preparedAudio = await preparedBriefSpeech.promise;
      if (briefRunRef.current !== runId) {
        preparedBriefSpeech.abort();
        return;
      }
    }

    const cueSchedule = preparedAudio ? resolveScoutbotBriefCueSchedule(preparedAudio, segments) : null;
    if (preparedAudio && cueSchedule) {
      const activatedSegmentIndexes = new Set<number>();
      try {
        const playedWithTiming = await playBriefSpeech(Promise.resolve(preparedAudio), runId, {
          cueSchedule,
          onCue: (cue) => {
            if (activatedSegmentIndexes.has(cue.segmentIndex)) {
              return;
            }
            if (Date.now() > nextBrief.expiresAt) {
              setAskStatus("Brief expired; refresh before acting");
              return;
            }
            activatedSegmentIndexes.add(cue.segmentIndex);
            activateSegment(segments[cue.segmentIndex], cue.segmentIndex);
          },
        });
        if (!playedWithTiming && briefRunRef.current === runId) {
          await runEstimatedSequence();
        }
      } catch (err) {
        if (!isScoutSpeechStopped(err)) {
          setError(err instanceof Error ? err.message : "Scout voice speech failed.");
        }
      }
    } else {
      const playback = preparedAudio && voiceRepliesRef.current
        ? playBriefSpeech(Promise.resolve(preparedAudio), runId)
        : null;
      await runEstimatedSequence();
      if (playback) {
        try {
          await playback;
        } catch (err) {
          if (!isScoutSpeechStopped(err)) {
            setError(err instanceof Error ? err.message : "Scout voice speech failed.");
          }
        }
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
  }, [applyScoutbotUiAction, playBriefSpeech, prepareBriefSpeech]);

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
      await ensureOpenAIKeyOnServer().catch(() => null);
      const nextBrief = await api<ScoutbotBrief>("/api/scoutbot/brief", {
        method: "POST",
        body: JSON.stringify({
          route,
          ttlMs: 2 * 60_000,
        }),
      });
      if (briefRunRef.current !== runId) return;
      setBrief(nextBrief);
      await runBrief(nextBrief, runId);
    } catch (err) {
      if (briefRunRef.current === runId) {
        setAskStatus(null);
        setError(err instanceof Error ? err.message : "Could not prepare brief.");
        setBriefing(false);
        setBriefStepIndex(null);
        briefRunRef.current = null;
      }
    }
  }, [briefing, route, runBrief, sending, stopSpeech]);

  const askScoutbot = useCallback(async (body: string) => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setLastAsk(trimmed);
    setLastReply(null);
    setAskStatus("Sending");
    setDraft((current) => current.trim() === trimmed ? "" : current);
    try {
      const reminderIntent = parseScoutbotReminderIntent(trimmed);
      if (reminderIntent) {
        setAskStatus("Setting reminder");
        const reminder = await createScoutbotReminder({
          title: reminderIntent.title,
          body: reminderIntent.body,
          delayMs: reminderIntent.delayMs,
          context: { route, naturalLanguage: trimmed },
        });
        const reply = `Reminder set for ${formatReminderDueAt(reminder.dueAt)}: ${reminder.body}`;
        setAskStatus("Reminder set");
        handleScoutbotReply(reply);
        return;
      }

      await ensureOpenAIKeyOnServer().catch(() => null);
      const result = await api<ScoutbotAssistantReply>("/api/scoutbot/chat", {
        method: "POST",
        body: JSON.stringify({
          body: trimmed,
          route,
        }),
      });
      setSessionState({
        session: result.session,
        sessions: result.sessions,
        config: result.config,
      });
      setAskStatus("Reply received");
      handleScoutbotReply(result.reply.body);
    } catch (err) {
      setAskStatus(null);
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setSending(false);
    }
  }, [createScoutbotReminder, handleScoutbotReply, route, sending]);

  const startVoice = useCallback(async () => {
    if (recording) return;
    const client = clientRef.current;
    liveCancelReasonRef.current = null;
    setError(null);
    setPartial("");
    setVoiceState("starting");

    if (voiceAvailable !== true) {
      const ok = await probeVoice(true);
      if (!ok) {
        setVoiceState(null);
        return;
      }
    }

    let live: ScoutVoiceLiveHandle | null = null;
    let released = false;
    const cleanupLive = async () => {
      if (!live || released) return;
      released = true;
      await releaseScoutVoiceLive(live, { allowCurrentSession: liveRef.current === live });
      if (liveRef.current === live) {
        liveRef.current = null;
      }
    };

    try {
      live = await client.startLive({
        onState: setVoiceState,
        onPartial: setPartial,
      });
      liveRef.current = live;
      setRecording(true);
      const final = await live.result;
      await cleanupLive();
      setRecording(false);
      setPartial("");
      if (liveCancelReasonRef.current) {
        return;
      }
      setVoiceState("done");
      if (final.text) {
        await askScoutbot(final.text);
      }
    } catch (err) {
      const cancelReason = liveCancelReasonRef.current;
      const wasCancellation = Boolean(cancelReason) || isScoutVoiceCancellation(err);
      await cleanupLive();
      setRecording(false);
      setPartial("");
      if (cancelReason === "stop-failed") {
        return;
      }
      setVoiceState(wasCancellation ? null : "error");
      if (!wasCancellation) {
        setError(err instanceof Error ? err.message : "Scout voice recording failed.");
      }
    } finally {
      await cleanupLive();
      liveCancelReasonRef.current = null;
    }
  }, [askScoutbot, probeVoice, recording, voiceAvailable]);

  const stopVoice = useCallback(async () => {
    const live = liveRef.current;
    if (!live) return;
    setVoiceState("processing");
    try {
      await withTimeout(
        live.stop(),
        SCOUT_VOICE_STOP_TIMEOUT_MS,
        "Scout voice did not finish processing the recording.",
      );
    } catch (err) {
      liveCancelReasonRef.current = "stop-failed";
      await releaseScoutVoiceLive(live, { allowCurrentSession: true });
      if (liveRef.current === live) {
        liveRef.current = null;
        setRecording(false);
        setPartial("");
        setVoiceState("error");
      }
      setError(err instanceof Error ? `Scout voice recording did not finish: ${err.message}` : "Scout voice recording did not finish.");
    }
  }, []);

  useEffect(() => {
    const openHandler = () => setCollapsed(false);
    window.addEventListener("scout:scoutbot-panel-open", openHandler);
    return () => window.removeEventListener("scout:scoutbot-panel-open", openHandler);
  }, [setCollapsed]);

  useEffect(
    () => onToggleScoutbot(() => setCollapsed(!collapsed)),
    [collapsed, setCollapsed],
  );

  const broadcastSnap = useScoutbotBroadcastStore();
  const promotedBroadcast = selectActiveBroadcast(broadcastSnap);

  useEffect(() => {
    const submitHandler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const body = detail && typeof detail === "object" && "body" in detail
        ? (detail as { body?: unknown }).body
        : null;
      if (typeof body === "string" && body.trim()) {
        setCollapsed(false);
        void askScoutbot(body);
      }
    };
    window.addEventListener("scout:scoutbot-submit", submitHandler);
    return () => window.removeEventListener("scout:scoutbot-submit", submitHandler);
  }, [askScoutbot, setCollapsed]);

  useEffect(() => {
    const briefHandler = () => {
      setCollapsed(false);
      if (!briefing && !sending) {
        void startBrief();
      }
    };
    window.addEventListener("scout:scoutbot-brief-now", briefHandler);
    return () => window.removeEventListener("scout:scoutbot-brief-now", briefHandler);
  }, [briefing, sending, setCollapsed, startBrief]);

  const scoutbotPublicState = useMemo<ScoutbotPublicState>(() => {
    const activity: ScoutbotActivity = speaking
      ? "speaking"
      : briefing
        ? "briefing"
        : sending
          ? "thinking"
          : recording
            ? "listening"
            : "idle";
    const session = sessionState?.session ?? null;
    const lastMessage = session && session.messages.length > 0
      ? session.messages[session.messages.length - 1]
      : null;
    const due = (reminderState?.due ?? []).slice(0, 5).map((reminder) => ({
      id: reminder.id,
      body: reminder.body,
      status: reminder.status,
      dueAt: reminder.dueAt,
    }));
    const nextScheduled = reminderState?.scheduled[0];
    return {
      activity,
      brief: {
        lastDeliveredAt: brief && !briefing ? brief.preparedAt : null,
      },
      reminders: {
        dueCount: reminderState?.due.length ?? 0,
        upcomingCount: reminderState?.scheduled.length ?? 0,
        due,
        next: nextScheduled
          ? {
              id: nextScheduled.id,
              body: nextScheduled.body,
              status: nextScheduled.status,
              dueAt: nextScheduled.dueAt,
            }
          : null,
      },
      voice: {
        available: voiceAvailable,
        setupBlocked: voiceAvailable === false,
        replies: voiceReplies,
      },
      error,
      session: {
        title: session?.title ?? null,
        lastActivityAt: lastMessage?.createdAt ?? session?.updatedAt ?? null,
      },
    };
  }, [
    speaking,
    briefing,
    sending,
    recording,
    brief,
    reminderState,
    voiceAvailable,
    voiceReplies,
    error,
    sessionState,
  ]);

  useEffect(() => {
    publisher?.publishState(scoutbotPublicState);
  }, [publisher, scoutbotPublicState]);

  useEffect(() => {
    if (!publisher) return;
    const actions: ScoutbotActionApi = {
      focusScoutbot: () => setCollapsed(false),
      triggerBrief: () => {
        setCollapsed(false);
        if (!briefing && !sending) {
          void startBrief();
        }
      },
      triggerAskState: () => {
        setCollapsed(false);
        void askScoutbot(STATE_PROMPT);
      },
      toggleVoiceReplies: () => {
        const next = !voiceReplies;
        setVoiceReplies(next);
        if (!next) stopSpeech();
      },
      openScoutbotSettings: () => {
        setCollapsed(false);
        setSettingsOpen(true);
      },
      startNewChat: () => {
        setCollapsed(false);
        if (!resettingSession) {
          void resetScoutbotSession();
        }
      },
      dismissReminder: (id) => {
        void dismissScoutbotReminder(id);
      },
      askReminderStatus: ({ body }) => {
        setCollapsed(false);
        void askScoutbot(
          `Reminder due: ${body}. Check the current Scout control-plane state and give me the shortest useful status update.`,
        );
      },
    };
    publisher.registerActions(actions);
  }, [
    publisher,
    setCollapsed,
    briefing,
    sending,
    startBrief,
    askScoutbot,
    voiceReplies,
    setVoiceReplies,
    stopSpeech,
    setSettingsOpen,
    resettingSession,
    resetScoutbotSession,
    dismissScoutbotReminder,
  ]);

  // Sync attention states onto the broadcast store so the chip surfaces them.
  const dueReminderCount = reminderState?.due.length ?? 0;
  useEffect(() => {
    if (dueReminderCount > 0) {
      emitClientBroadcast({
        key: "reminder.due",
        tier: "warn",
        text: `${dueReminderCount} reminder${dueReminderCount === 1 ? "" : "s"} due`,
      });
    } else {
      clearClientBroadcast("reminder.due");
    }
  }, [dueReminderCount]);

  useEffect(() => {
    clearClientBroadcast("voice.offline");
    if (voiceAvailable === true) {
      setVoiceSetupOpen(false);
    }
  }, [voiceAvailable]);

  useEffect(() => {
    if (error) {
      emitClientBroadcast({
        key: "scoutbot.error",
        tier: "error",
        text: error,
      });
    } else {
      clearClientBroadcast("scoutbot.error");
    }
  }, [error]);

  const voiceLabel = recording
    ? voiceState === "processing" ? "Sending" : "Stop"
    : voiceProbeState === "probing" ? "Checking Voice"
    : voiceProbeState === "launching" ? "Opening Scout"
    : voiceAvailable === false ? "Open Scout" : "Start Talking";
  const isEmptyChat = sessionState !== null
    && sessionState.session.messages.length === 0
    && !sending
    && !briefing;
  if (collapsed && !forceExpanded) {
    return (
      <div className="flex shrink-0 items-center border-t border-[var(--scout-chrome-border-soft)] px-3 py-1.5">
        <ScoutbotBroadcastChip />
      </div>
    );
  }

  const expandedClassName = fill
    ? "flex h-full min-h-0 flex-col overflow-hidden border-t border-[var(--scout-chrome-border-soft)]"
    : height === undefined
      ? "flex max-h-[60vh] shrink-0 flex-col overflow-hidden border-t border-[var(--scout-chrome-border-soft)]"
      : "flex shrink-0 flex-col overflow-hidden border-t border-[var(--scout-chrome-border-soft)]";
  const expandedStyle = height === undefined || fill ? undefined : { height: `${height}px` };

  return (
    <section className={expandedClassName} style={expandedStyle}>
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-2.5 pb-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Bot size={20} className="shrink-0 text-lime-300" aria-hidden="true" />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ScoutbotIconButton
            icon={voiceReplies ? <Volume2 size={11} /> : <VolumeX size={11} />}
            title={voiceReplies ? "Voice replies on (click to mute)" : "Voice replies off (click to enable)"}
            onClick={() => {
              const next = !voiceReplies;
              setVoiceReplies(next);
              if (!next) stopSpeech();
            }}
            active={voiceReplies}
          />
          {!forceExpanded && (
            <ScoutbotIconButton
              icon={<ChevronDown size={11} />}
              title="Minimize"
              onClick={() => setCollapsed(true)}
            />
          )}
        </div>
      </div>

      {promotedBroadcast && !(isEmptyChat && promotedBroadcast.tier === "info") && (
        <div className={`rounded border px-2.5 py-1.5 font-mono text-[10px] leading-relaxed ${
          promotedBroadcast.tier === "error"
            ? "border-rose-300/30 bg-rose-300/[0.07] text-rose-50"
            : promotedBroadcast.tier === "warn"
              ? "border-amber-300/30 bg-amber-300/[0.07] text-amber-50"
              : "border-lime-300/20 bg-lime-300/[0.05] text-[var(--scout-chrome-ink)]"
        }`}>
          <div className="flex items-center gap-2">
            <Sparkles size={11} className={`shrink-0 ${
              promotedBroadcast.tier === "error"
                ? "text-rose-200"
                : promotedBroadcast.tier === "warn"
                  ? "text-amber-200"
                  : "text-lime-200"
            }`} />
            <span className="min-w-0 flex-1 truncate text-[var(--scout-chrome-ink)]">
              {promotedBroadcast.text}
            </span>
            <button
              type="button"
              title="Ask about this"
              aria-label="Ask about this"
              onClick={() => void askScoutbot(`Tell me about this broadcast: ${promotedBroadcast.text}`)}
              disabled={sending || briefing}
              className="shrink-0 rounded border border-[var(--scout-chrome-border-soft)] p-1 text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)] disabled:opacity-40"
            >
              <Radio size={11} />
            </button>
            <button
              type="button"
              title="Dismiss"
              aria-label="Dismiss broadcast"
              onClick={() => dismissPromotedBroadcast()}
              className="shrink-0 rounded border border-[var(--scout-chrome-border-soft)] p-1 text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <ScoutbotSettingsPanel
          voicePresetId={voicePresetId}
          onVoicePresetId={setVoicePresetId}
          voiceDefaults={voiceDefaults}
          modelDraft={modelDraft}
          onModelDraft={setModelDraft}
          promptDraft={promptDraft}
          onPromptDraft={setPromptDraft}
          configLoading={configLoading}
          configSaving={configSaving}
          configError={configError}
          configStatus={configStatus}
          onSave={() => void saveScoutbotConfig()}
          onReload={() => void loadScoutbotConfig()}
        />
      )}

      </div>{/* /top stack */}

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-1.5">
        {sessionState && (
          <ChatHistory
            state={sessionState}
            chatExpanded={chatExpanded}
            onToggleExpanded={() => setChatExpanded((v) => !v)}
            sessionPickerOpen={sessionPickerOpen}
            onToggleSessionPicker={() => setSessionPickerOpen((v) => !v)}
            onSwitchSession={(id) => void switchScoutbotSession(id)}
            switchingSessionId={switchingSessionId}
            sending={sending}
            briefing={briefing}
            pendingAsk={sending ? lastAsk : null}
            onArchiveSession={(id) => void archiveScoutbotSession(id)}
            archivingSessionId={archivingSessionId}
            onAssistantContextMenu={onAssistantMessageContextMenu}
            suggestedPrompts={suggestedPrompts}
            onSelectPrompt={(prompt) => {
              setDraft(prompt);
              setChatExpanded(false);
            }}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-[var(--scout-chrome-border-soft)] bg-black/10 px-3 pt-2 pb-2.5">
        {voiceAvailable === false && voiceSetupOpen && (
          <ScoutVoiceSetupPanel
            issue={voiceIssue}
            probeState={voiceProbeState}
            onLaunch={launchScoutVoice}
            onRetry={() => void probeVoice(true)}
            onSettings={() => setSettingsOpen(true)}
            onDismiss={() => setVoiceSetupOpen(false)}
          />
        )}

        {(partial || speaking) && (
          <div className="flex items-center justify-between gap-2 rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
            <span className="min-w-0 truncate">{speaking ? "Speaking reply…" : partial}</span>
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

        {askStatus && !sending && (
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-ghost)]">
            {askStatus}
          </div>
        )}

        <ChatInput
          agents={agents}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={() => void askScoutbot(draft)}
          sending={sending}
          recording={recording}
          voiceLabel={voiceLabel}
          voiceBusy={voiceState === "processing" || voiceProbeState === "probing" || voiceProbeState === "launching"}
          voiceUnavailable={voiceAvailable === false}
          onMicClick={() => {
            if (voiceAvailable === false) {
              setVoiceSetupOpen(true);
              return;
            }
            void (recording ? stopVoice() : startVoice());
          }}
          prominent={isEmptyChat}
          autoFocus={forceExpanded}
        />

        {error && (
          <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-red-200">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
