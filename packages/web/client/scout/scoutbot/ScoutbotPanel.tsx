import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, Bot, CheckCircle2, ChevronDown, ChevronUp, Compass, Copy, Gauge, History, Loader2, Map, Mic, Radio, RefreshCw, SendHorizontal, Settings, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
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
import { ScoutbotMarkdown } from "../../lib/scoutbot-markdown.tsx";
import { parseScoutbotReminderIntent } from "../../lib/scoutbot-reminder-intent.ts";
import { toSpokenScoutText } from "../../lib/spoken-text.ts";
import { isVoxSpeechStopped, playPreparedVoxSpeechWithEffects, prepareVoxSpeech, startVoxSpeechWithEffects, VoxBrowserClient, type VoxLiveHandle, type VoxSessionState, type VoxSpeakHandle, type VoxSpeakResult, type VoxSpeechTimingCueRequest } from "../../lib/vox.ts";
import { VOICE_FX_PRESETS, type VoiceFxParams } from "@voxd/client/fx";

// Default voice mood + clean-dispatch overrides specific to Chill Dispatcher.
// The stock Vox presets are intentionally characterful; Scoutbot's default should
// read closer to a clean mic with dispatch bookends than a noisy radio.
const DEFAULT_SCOUTBOT_VOICE_PRESET_ID = "chill-dispatcher";
const SCOUTBOT_BRIEF_CUE_EARLY_MS = 100;
const VOX_LIVE_STOP_TIMEOUT_MS = 60_000;
const VOX_LIVE_CANCEL_TIMEOUT_MS = 2_500;
const CHILL_DISPATCHER_OVERRIDES: Partial<VoiceFxParams> = {
  lowCutHz: 160,
  highCutHz: 5200,
  bandQ: 0.35,
  saturationAmount: 0.035,
  bitcrushAmount: 0,
  hissGain: 0,
  hissCutoffHz: 1800,
  presencePeakDb: 1.5,
  presenceCenterHz: 1500,
  presenceQ: 0.65,
  compressorThresholdDb: -15,
  compressorRatio: 2.2,
  clickEnabled: true,
  clickGain: 0.24,
  clickDurationMs: 45,
  squelchTailEnabled: true,
  squelchTailGain: 0.018,
  squelchTailDurationMs: 95,
  outputGain: 1,
  wetMix: 0.38,
};

// Subtle, "low-key" variation based on how busy the fleet feels. The idea is
// the voice should feel the room — a touch faster + slightly more bite when
// lots of agents are online, chill and clean when it's quiet. Never dramatic;
// just enough that you sense the mood shift over a session.
function scoutbotActivityParams(onlineCount: number): Partial<VoiceFxParams> {
  const activity = Math.min(1, onlineCount / 8); // 0 at idle, 1 at 8+ online
  return {
    saturationAmount: 0.035 + activity * 0.025,  // tiny edge without audible crunch
    presencePeakDb: 1.5 + activity * 1.5,        // clarity lift, not radio bite
  };
}

// Resolve the FX params for a given preset id. For Chill Dispatcher we apply
// the clarity-tuned overrides on top; for every other preset we use the
// preset's own balanced character. Activity-driven variation is layered on
// regardless so any voice "feels the room."
function resolveScoutbotFxParams(presetId: string, onlineCount: number): Partial<VoiceFxParams> {
  const base = presetId === "chill-dispatcher" ? CHILL_DISPATCHER_OVERRIDES : {};
  return { ...base, ...scoutbotActivityParams(onlineCount) };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}

async function releaseVoxLive(
  live: VoxLiveHandle,
  options: { allowCurrentSession?: boolean } = {},
): Promise<void> {
  if (!live.sessionId && !options.allowCurrentSession) return;
  await withTimeout(
    live.cancel(),
    VOX_LIVE_CANCEL_TIMEOUT_MS,
    "Timed out releasing Scout voice session.",
  ).catch(() => undefined);
}

function isVoxLiveCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session_cancelled|was cancelled|cancelled/i.test(message);
}
import { useScout } from "../Provider.tsx";
import {
  useScoutbotStatePublisher,
  type ScoutbotActionApi,
  type ScoutbotActivity,
  type ScoutbotPublicState,
} from "./ScoutbotStateContext.tsx";

type ScoutbotAgentConfig = {
  editable: boolean;
  model: string;
  systemPrompt: string;
};

type ScoutbotAgentConfigUpdateResult = {
  config: ScoutbotAgentConfig;
};

type ScoutbotAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  createdAt: number;
};

type ScoutbotAssistantSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messageCount: number;
  messages: ScoutbotAssistantMessage[];
};

type ScoutbotAssistantSessionSummary = Omit<ScoutbotAssistantSession, "messages">;

type ScoutbotAssistantSessionState = {
  session: ScoutbotAssistantSession;
  sessions: ScoutbotAssistantSessionSummary[];
  retention?: {
    activeLimit: number;
    archivedCount: number;
    totalCount: number;
  };
  config: ScoutbotAgentConfig;
};

type ScoutbotAssistantReply = ScoutbotAssistantSessionState & {
  reply: ScoutbotAssistantMessage;
  responseId: string | null;
};

type VoxLiveCancelReason = "discard" | "stop-failed";

type ScoutbotBriefStep = {
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

type ScoutbotBriefAction = {
  label: string;
  route?: Record<string, unknown>;
  prompt?: string;
};

type ScoutbotBrief = {
  id: string;
  title: string;
  summary: string;
  preparedAt: number;
  expiresAt: number;
  ttlMs: number;
  steps: ScoutbotBriefStep[];
  recommendation: string;
  actions: ScoutbotBriefAction[];
};

type PreparedBriefSpeech = {
  promise: Promise<VoxSpeakResult | null>;
  abort: () => void;
};

type ScoutbotBriefSegment = {
  id: string;
  cueId: string;
  label: string;
  route: Record<string, unknown> | null;
  narration: string;
  durationMs: number;
};

type ScoutbotBriefSpeechPlan = {
  text: string;
  cues: VoxSpeechTimingCueRequest[];
};

type ScoutbotBriefCueSchedule = {
  cueId: string;
  segmentIndex: number;
  activateMs: number;
};

type ScoutbotReminder = {
  id: string;
  title: string;
  body: string;
  status: "scheduled" | "due" | "dismissed";
  source: "scoutbot" | "api";
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  dueInMs: number;
  dismissedAt?: number;
};

type ScoutbotReminderState = {
  generatedAt: number;
  reminders: ScoutbotReminder[];
  due: ScoutbotReminder[];
  scheduled: ScoutbotReminder[];
};

type ScoutbotReminderCreateResult = ScoutbotReminderState & {
  reminder: ScoutbotReminder;
};

type ScoutbotAskAgentResult = {
  ok: boolean;
  targetLabel: string;
  conversationId: string | null;
  messageId: string | null;
  flightId: string | null;
  targetAgentId: string | null;
};

type VoiceProbeState = "idle" | "probing" | "opening";

const STATE_PROMPT =
  "What's the state of things? Give me a terse ops summary, the biggest risk, and the next action you recommend.";
const SCOUTBOT_VOICE_SPEEDS = [1, 1.2, 1.35] as const;
const DEFAULT_SCOUTBOT_VOICE_SPEED = 1.2;
const SCOUTBOT_BRIEF_SEGMENT_SEPARATOR = "\n\n";
const SCOUTBOT_BRIEF_SPEECH_INSTRUCTIONS = [
  "Read as a calm local operations briefer.",
  "Use the paragraph breaks as short breath moments so the operator can look at the screen.",
  "Keep the tone warm, focused, and unhurried; do not sound like an advertisement.",
].join(" ");

type ScoutbotVoiceDefaults = {
  modelId: string;
  voiceId?: string;
};

function buildScoutbotBriefSpeechPlan(segments: ScoutbotBriefSegment[]): ScoutbotBriefSpeechPlan {
  let text = "";
  const cues: VoxSpeechTimingCueRequest[] = [];
  for (const segment of segments) {
    const spoken = toSpokenScoutText(segment.narration);
    if (!spoken) {
      continue;
    }
    if (text) {
      text += SCOUTBOT_BRIEF_SEGMENT_SEPARATOR;
    }
    const textStart = text.length;
    text += spoken;
    cues.push({
      id: segment.cueId,
      textStart,
      textEnd: text.length,
    });
  }
  return { text, cues };
}

function resolveScoutbotBriefCueSchedule(
  result: VoxSpeakResult,
  segments: ScoutbotBriefSegment[],
): ScoutbotBriefCueSchedule[] | null {
  const timingCues = result.speechTiming?.cues;
  if (!timingCues?.length) {
    return null;
  }
  const byId = new globalThis.Map(timingCues.map((cue) => [cue.id, cue]));
  const schedule: ScoutbotBriefCueSchedule[] = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const cue = byId.get(segment.cueId);
    if (!cue || !Number.isFinite(cue.startMs)) {
      return null;
    }
    schedule.push({
      cueId: segment.cueId,
      segmentIndex,
      activateMs: Math.max(0, cue.startMs - SCOUTBOT_BRIEF_CUE_EARLY_MS),
    });
  }
  return schedule;
}

export function ScoutbotPanel({ height }: { height?: number } = {}) {
  const {
    applyScoutbotUiAction,
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
  const [voiceState, setVoiceState] = useState<VoxSessionState | null>(null);
  const [partial, setPartial] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [lastAsk, setLastAsk] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [askStatus, setAskStatus] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const clientRef = useRef<VoxBrowserClient | null>(null);
  const liveRef = useRef<VoxLiveHandle | null>(null);
  const liveCancelReasonRef = useRef<VoxLiveCancelReason | null>(null);
  const speechRef = useRef<VoxSpeakHandle | null>(null);
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
    const speech = startVoxSpeechWithEffects(toSpokenScoutText(text), {
      speed: voiceSpeed,
      presetId: voicePresetId,
      params: resolveScoutbotFxParams(voicePresetId, onlineCount),
    });
    speechRef.current = speech;
    setSpeaking(true);
    void speech.promise
      .catch((err) => {
        if (!isVoxSpeechStopped(err)) {
          setError(err instanceof Error ? err.message : "Scout voice failed.");
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

  const probeVoice = useCallback(async () => {
    const client = clientRef.current ?? new VoxBrowserClient();
    clientRef.current = client;
    setVoiceProbeState("probing");

    const ok = await client.probe();
    setVoiceAvailable(ok);
    setVoiceIssue(ok ? null : client.lastUnavailableReason ?? "Scout Menu voice is not reachable.");
    setVoiceProbeState("idle");
    return ok;
  }, []);

  useEffect(() => {
    void probeVoice();
    const onFocus = () => { void probeVoice(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void probeVoice();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [probeVoice]);

  const openScoutVoiceSettings = useCallback(() => {
    const client = clientRef.current ?? new VoxBrowserClient();
    clientRef.current = client;
    setError(null);
    setVoiceProbeState("opening");
    client.openSettings({ source: "openscout", context: makeScoutAudioLaunchContext() });
    window.setTimeout(() => {
      void probeVoice();
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
    cues: VoxSpeechTimingCueRequest[],
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
    const promise = prepareVoxSpeech(text, {
      speed: voiceSpeed,
      instructions: SCOUTBOT_BRIEF_SPEECH_INSTRUCTIONS,
      signal: controller.signal,
      originAppId: "openscout.scoutbot",
      utteranceId: `scoutbot-brief:${runId}`,
      ...(cues.length > 0 ? { speechTiming: { enabled: true, cues } } : {}),
    })
      .catch((err) => {
        if (!isVoxSpeechStopped(err)) {
          setError(err instanceof Error ? err.message : "Scout voice failed.");
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
    prepared: Promise<VoxSpeakResult | null>,
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
    const promise = playPreparedVoxSpeechWithEffects(audio, {
      signal: controller.signal,
      presetId: voicePresetId,
      params: fxParams,
      onPlaybackStart: scheduleCueTimers,
    });
    const speech: VoxSpeakHandle = {
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
      if (!isVoxSpeechStopped(err)) {
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
    let preparedAudio: VoxSpeakResult | null = null;

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
        if (!isVoxSpeechStopped(err)) {
          setError(err instanceof Error ? err.message : "Scout voice failed.");
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
          if (!isVoxSpeechStopped(err)) {
            setError(err instanceof Error ? err.message : "Scout voice failed.");
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
    const client = clientRef.current ?? new VoxBrowserClient();
    clientRef.current = client;
    liveCancelReasonRef.current = null;
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

    let live: VoxLiveHandle | null = null;
    let released = false;
    const cleanupLive = async () => {
      if (!live || released) return;
      released = true;
      await releaseVoxLive(live, { allowCurrentSession: liveRef.current === live });
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
      const wasCancellation = Boolean(cancelReason) || isVoxLiveCancellation(err);
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
        VOX_LIVE_STOP_TIMEOUT_MS,
        "Scout voice did not finish processing the recording.",
      );
    } catch (err) {
      liveCancelReasonRef.current = "stop-failed";
      await releaseVoxLive(live, { allowCurrentSession: true });
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
    if (voiceAvailable === false) {
      emitClientBroadcast({
        key: "voice.offline",
        tier: "warn",
        text: "Scout voice setup needed",
      });
    } else if (voiceAvailable === true) {
      clearClientBroadcast("voice.offline");
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
    : voiceProbeState === "opening" ? "Opening Scout"
    : voiceAvailable === false ? "Voice Setup" : "Start Talking";
  const activeSession = sessionState?.session ?? null;
  const activeSessionId = activeSession?.id ?? null;
  const sessionStartedLabel = activeSession?.createdAt
    ? new Date(activeSession.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const sessionRuntimeLabel = activeSession?.model ?? sessionState?.config.model ?? null;
  if (collapsed) {
    return (
      <div className="flex shrink-0 items-center border-t border-[var(--scout-chrome-border-soft)] px-3 py-1.5">
        <ScoutbotBroadcastChip />
      </div>
    );
  }

  const expandedClassName = height === undefined
    ? "flex max-h-[60vh] shrink-0 flex-col overflow-hidden border-t border-[var(--scout-chrome-border-soft)]"
    : "flex shrink-0 flex-col overflow-hidden border-t border-[var(--scout-chrome-border-soft)]";
  const expandedStyle = height === undefined ? undefined : { height: `${height}px` };

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
          <ScoutbotIconButton
            icon={<ChevronDown size={11} />}
            title="Minimize"
            onClick={() => setCollapsed(true)}
          />
        </div>
      </div>

      {promotedBroadcast && (
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
        <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 p-3">
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
              Voice FX
              <select
                value={voicePresetId}
                onChange={(event) => setVoicePresetId(event.target.value)}
                className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/20 px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-[var(--scout-chrome-ink)]"
              >
                {VOICE_FX_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} — {preset.family}
                  </option>
                ))}
              </select>
              <span className="font-mono text-[9px] normal-case leading-relaxed tracking-normal text-[var(--scout-chrome-ink-ghost)]">
                {VOICE_FX_PRESETS.find((preset) => preset.id === voicePresetId)?.description
                  ?? "Custom voice mood for spoken replies."}
              </span>
            </label>
            <div className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
              Reply Voice
              <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-black/20 px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-[var(--scout-chrome-ink)]">
                {voiceDefaults
                  ? `${voiceDefaults.modelId}${voiceDefaults.voiceId ? ` / ${voiceDefaults.voiceId}` : ""}`
                  : "Unavailable"}
              </div>
            </div>
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
                onClick={() => void saveScoutbotConfig()}
                disabled={configLoading || configSaving || !promptDraft.trim()}
                className="flex items-center justify-center gap-2 rounded bg-lime-300/90 px-2.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {(configLoading || configSaving) && <Loader2 size={13} className="animate-spin" />}
                {configSaving ? "Saving" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void loadScoutbotConfig()}
                disabled={configLoading || configSaving}
                className="rounded border border-[var(--scout-chrome-border-soft)] px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
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
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-[var(--scout-chrome-border-soft)] bg-black/10 px-3 pt-2 pb-2.5">
        {voiceAvailable === false && (
          <ScoutVoiceSetupPanel
            issue={voiceIssue}
            probeState={voiceProbeState}
            onOpenSettings={openScoutVoiceSettings}
            onRetry={() => void probeVoice()}
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
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={() => void askScoutbot(draft)}
          sending={sending}
          recording={recording}
          voiceLabel={voiceLabel}
          voiceBusy={voiceState === "processing" || voiceProbeState === "probing" || voiceProbeState === "opening"}
          voiceUnavailable={voiceAvailable === false}
          onMicClick={() => {
            if (voiceAvailable === false) {
              openScoutVoiceSettings();
              return;
            }
            void (recording ? stopVoice() : startVoice());
          }}
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
const FILE_PATH_RE =
  /(?:^|(?<=[\s(`'"<>]))(?:~\/|\/(?:Users|home|opt|var|etc|tmp|private)\/)[^\s)`'"<>]+\.[A-Za-z0-9]{1,8}\b/g;

function extractAbsoluteFilePaths(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  FILE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      found.push(match[0]);
    }
  }
  return found;
}

function shortenForMenu(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

function makeScoutAudioLaunchContext() {
  return {
    requesterName: "OpenScout",
    productName: "Scout Voice",
    headline: "Turn on Scout voice",
    body: "Scout Menu handles microphone capture and local transcription. Choose the microphone, grant permission, then return here to talk with your workspace.",
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

function formatReminderDueAt(dueAt: number): string {
  return new Date(dueAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const SCOUTBOT_MESSAGE_TIMESTAMP_GAP_MS = 5 * 60_000;

function shouldShowScoutbotMessageTimestamp(
  previous: ScoutbotAssistantMessage | undefined,
  current: ScoutbotAssistantMessage,
): boolean {
  if (!previous) return true;
  if (!isSameScoutbotMessageDay(previous.createdAt, current.createdAt)) return true;
  return Math.abs(current.createdAt - previous.createdAt) >= SCOUTBOT_MESSAGE_TIMESTAMP_GAP_MS;
}

function isSameScoutbotMessageDay(left: number, right: number): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function formatScoutbotMessageTimestamp(value: number): string {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isSameScoutbotMessageDay(value, now.getTime())) {
    return `Today ${time}`;
  }
  if (isSameScoutbotMessageDay(value, yesterday.getTime())) {
    return `Yesterday ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  }
  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${time}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function ChatHistory({
  state,
  chatExpanded,
  onToggleExpanded,
  sessionPickerOpen,
  onToggleSessionPicker,
  onSwitchSession,
  switchingSessionId,
  sending,
  briefing,
  pendingAsk,
  onArchiveSession,
  archivingSessionId,
  onAssistantContextMenu,
}: {
  state: ScoutbotAssistantSessionState;
  chatExpanded: boolean;
  onToggleExpanded: () => void;
  sessionPickerOpen: boolean;
  onToggleSessionPicker: () => void;
  onSwitchSession: (id: string) => void;
  switchingSessionId: string | null;
  sending: boolean;
  briefing: boolean;
  pendingAsk: string | null;
  onArchiveSession: (id: string) => void;
  archivingSessionId: string | null;
  onAssistantContextMenu?: (event: React.MouseEvent, body: string) => void;
}) {
  const TRAIL = 4;
  const messages = state.session.messages;
  const visible = chatExpanded ? messages : messages.slice(-TRAIL);
  const hiddenCount = chatExpanded ? 0 : Math.max(0, messages.length - visible.length);
  const totalCount = messages.length;
  const sessionsCount = state.sessions.length;
  const retention = state.retention;
  const startedAt = state.session.createdAt
    ? new Date(state.session.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const titleLine = state.session.title && state.session.title !== "New Scout Session"
    ? state.session.title
    : `Session ${state.session.id.slice(0, 8)}`;

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const lastMessageBody = messages[messages.length - 1]?.body ?? "";
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastMessageId, lastMessageBody, pendingAsk, sending, chatExpanded, state.session.id]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded border border-[var(--scout-chrome-border-soft)] bg-black/10 font-mono text-[10px] text-[var(--scout-chrome-ink-faint)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--scout-chrome-border-soft)] px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[var(--scout-chrome-ink)]" title={state.session.id}>
            {titleLine}
          </span>
          {startedAt && (
            <span className="shrink-0 text-[var(--scout-chrome-ink-ghost)]">· {startedAt}</span>
          )}
          <span className="shrink-0 text-[var(--scout-chrome-ink-ghost)]">· {totalCount} msg{totalCount === 1 ? "" : "s"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={`Switch session (${sessionsCount} total)`}
            aria-label="Switch session"
            onClick={onToggleSessionPicker}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] transition-colors ${
              sessionPickerOpen
                ? "border-lime-300/40 bg-lime-300/10 text-lime-100"
                : "border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
            }`}
          >
            <History size={10} />
            <span>Sessions</span>
            <span className="text-[var(--scout-chrome-ink-ghost)]">{sessionsCount}</span>
            <ChevronDown size={9} className={sessionPickerOpen ? "rotate-180 transition-transform" : "transition-transform"} />
          </button>
          {totalCount > TRAIL && (
            <button
              type="button"
              title={chatExpanded ? "Collapse chat" : "View full session"}
              aria-label={chatExpanded ? "Collapse chat" : "View full session"}
              onClick={onToggleExpanded}
              className="flex items-center gap-1 rounded border border-[var(--scout-chrome-border-soft)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
            >
              <span>{chatExpanded ? "Collapse" : "Full"}</span>
              {chatExpanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
            </button>
          )}
        </div>
      </div>

      {sessionPickerOpen && (
        <div className="shrink-0 border-b border-[var(--scout-chrome-border-soft)] px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between gap-2 px-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-ghost)]">
            <span>Recent sessions</span>
            {retention && retention.archivedCount > 0 && (
              <span>{retention.archivedCount} archived</span>
            )}
          </div>
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto pr-0.5">
            {state.sessions.map((entry) => {
              const isActive = entry.id === state.session.id;
              const isBusy = switchingSessionId === entry.id;
              const isArchiving = archivingSessionId === entry.id;
              const ts = new Date(entry.updatedAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              });
              const display = entry.title && entry.title !== "New Scout Session"
                ? entry.title
                : `Session ${entry.id.slice(0, 8)}`;
              return (
                <div
                  key={entry.id}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-left transition-colors ${
                    isActive
                      ? "border-lime-300/40 bg-lime-300/[0.06] text-lime-100"
                      : "border-transparent text-[var(--scout-chrome-ink-faint)] hover:border-[var(--scout-chrome-border-soft)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (isActive) return;
                      onSwitchSession(entry.id);
                    }}
                    disabled={isActive || Boolean(switchingSessionId) || Boolean(archivingSessionId)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-lime-300" : "bg-[var(--scout-chrome-ink-ghost)]"}`} />
                    <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--scout-chrome-ink)]">{display}</span>
                    <span className="shrink-0 text-[9px] text-[var(--scout-chrome-ink-ghost)]">
                      {entry.messageCount} msg
                    </span>
                    <span className="shrink-0 text-[9px] text-[var(--scout-chrome-ink-ghost)]">{ts}</span>
                    {isBusy && <Loader2 size={10} className="shrink-0 animate-spin text-lime-200" />}
                  </button>
                  <button
                    type="button"
                    title="Archive chat"
                    aria-label={`Archive chat ${display}`}
                    onClick={() => onArchiveSession(entry.id)}
                    disabled={Boolean(switchingSessionId) || Boolean(archivingSessionId)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-transparent text-[var(--scout-chrome-ink-ghost)] transition-colors hover:border-[var(--scout-chrome-border-soft)] hover:bg-black/20 hover:text-[var(--scout-chrome-ink)] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {isArchiving ? <Loader2 size={10} className="animate-spin" /> : <Archive size={10} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2">
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onToggleExpanded}
            className="self-start text-[9px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-ghost)] hover:text-[var(--scout-chrome-ink)]"
          >
            ↑ {hiddenCount} earlier message{hiddenCount === 1 ? "" : "s"}
          </button>
        )}
        {visible.length === 0 && !pendingAsk && (
          <p className="text-[var(--scout-chrome-ink-ghost)]">No messages yet — ask anything below.</p>
        )}
        {visible.map((message, index) => {
          const showTimestamp = shouldShowScoutbotMessageTimestamp(visible[index - 1], message);
          const timestamp = formatScoutbotMessageTimestamp(message.createdAt);
          return (
            <div key={message.id} className="flex flex-col gap-1">
              {showTimestamp && (
                <div
                  className="self-center rounded-full bg-white/[0.06] px-2.5 py-0.5 font-mono text-[9px] font-medium text-[var(--scout-chrome-ink-ghost)]"
                  title={new Date(message.createdAt).toLocaleString()}
                  aria-label={timestamp}
                >
                  {timestamp}
                </div>
              )}
              <ChatBubble
                role={message.role}
                body={message.body}
                onContextMenu={
                  message.role === "assistant" && onAssistantContextMenu
                    ? (event) => onAssistantContextMenu(event, message.body)
                    : undefined
                }
              />
            </div>
          );
        })}
        {pendingAsk && (
          <ChatBubble role="user" body={pendingAsk} pending />
        )}
        {sending && !pendingAsk && (
          <p className="text-[var(--scout-chrome-ink-ghost)]">Reading the control plane…</p>
        )}
        {briefing && (
          <div className="flex items-center gap-2 rounded border border-lime-300/30 bg-lime-300/[0.06] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-lime-100">
            <Loader2 size={12} className="shrink-0 animate-spin text-lime-300" aria-hidden="true" />
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-[0.14em] text-lime-300">Briefing</span>
              <span className="text-[var(--scout-chrome-ink)]">
                Codex is reviewing the control-plane snapshot. Voice will pick up when it lands.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatInput({
  draft,
  onDraftChange,
  onSubmit,
  sending,
  recording,
  voiceLabel,
  voiceBusy,
  voiceUnavailable,
  onMicClick,
}: {
  draft: string;
  onDraftChange: (next: string) => void;
  onSubmit: () => void;
  sending: boolean;
  recording: boolean;
  voiceLabel: string;
  voiceBusy: boolean;
  voiceUnavailable: boolean;
  onMicClick: () => void;
}) {
  let micTitle = "Start talking";
  if (voiceUnavailable) micTitle = "Open Scout voice settings";
  if (recording) micTitle = "Stop talking";
  if (voiceBusy) micTitle = voiceLabel;
  const showVoiceLabel = voiceUnavailable || voiceBusy || recording;
  return (
    <form
      className="grid grid-cols-[auto_1fr_auto] gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <button
        type="button"
        title={micTitle}
        aria-label={micTitle}
        onClick={onMicClick}
        disabled={sending || voiceBusy}
        className={`flex items-center justify-center self-stretch rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          recording
            ? "border-lime-300/50 bg-lime-300/10 text-lime-200"
            : "border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
        } ${showVoiceLabel ? "min-w-[7.5rem] gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em]" : "w-9"}`}
      >
        {voiceBusy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : recording ? (
          <Square size={12} className="fill-current" />
        ) : (
          <Mic size={13} />
        )}
        {showVoiceLabel && <span className="truncate">{voiceLabel}</span>}
      </button>
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="Ask to inspect state or move the UI…"
        rows={2}
        className="w-full resize-none rounded border border-[var(--scout-chrome-border-soft)] bg-black/20 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--scout-chrome-ink)] placeholder:text-[var(--scout-chrome-ink-ghost)]"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (draft.trim() && !sending) onSubmit();
          }
        }}
      />
      <button
        type="submit"
        title="Send"
        aria-label="Send"
        disabled={!draft.trim() || sending}
        className="flex w-9 items-center justify-center self-stretch rounded bg-lime-300/90 px-0 text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? <Loader2 size={13} className="animate-spin" /> : <SendHorizontal size={13} />}
      </button>
    </form>
  );
}

function ChatBubble({
  role,
  body,
  pending = false,
  onContextMenu,
}: {
  role: "user" | "assistant";
  body: string;
  pending?: boolean;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const isUser = role === "user";
  const text = isUser ? body : stripScoutbotUiFences(body);
  const [copied, setCopied] = useState(false);
  const copyMessage = useCallback(() => {
    void copyTextToClipboard(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  }, [text]);
  return (
    <div className="group flex flex-col gap-0.5" onContextMenu={onContextMenu}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[9px] uppercase tracking-[0.12em] ${isUser ? "text-[var(--scout-chrome-ink-ghost)]" : "text-lime-300"}`}>
          {isUser ? "You" : "Reply"}
          {pending && " · sending"}
        </span>
        <button
          type="button"
          title={copied ? "Copied" : "Copy message"}
          aria-label={copied ? "Copied message" : "Copy message"}
          disabled={pending || !text.trim()}
          onClick={copyMessage}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink-ghost)] opacity-70 transition hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)] disabled:cursor-not-allowed disabled:opacity-20 group-hover:opacity-100"
        >
          {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
        </button>
      </div>
      {isUser ? (
        <p className={`whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--scout-chrome-ink)] ${pending ? "opacity-60" : ""}`}>
          {text}
        </p>
      ) : (
        <div className={pending ? "opacity-60" : ""}>
          <ScoutbotMarkdown text={text} />
        </div>
      )}
    </div>
  );
}

function ScoutbotIconButton({
  icon,
  title,
  onClick,
  disabled,
  active,
  badge,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-1 rounded border p-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-lime-300/50 bg-lime-300/10 text-lime-200"
          : "border-[var(--scout-chrome-border-soft)] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
      }`}
    >
      {icon}
      {badge && <span className="font-mono text-[8.5px] tracking-tight">{badge}</span>}
    </button>
  );
}

function ScoutbotActionButton({
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

function ScoutVoiceSetupPanel({
  issue,
  probeState,
  onOpenSettings,
  onRetry,
}: {
  issue: string | null;
  probeState: VoiceProbeState;
  onOpenSettings: () => void;
  onRetry: () => void;
}) {
  const isBusy = probeState === "probing" || probeState === "opening";

  return (
    <div className="rounded border border-lime-300/25 bg-lime-300/[0.06] px-3 py-3 font-mono text-[10px] text-[var(--scout-chrome-ink)]">
      <div className="flex items-start gap-2">
        <Mic size={14} className="mt-0.5 shrink-0 text-lime-300" />
        <div className="min-w-0">
          <div className="uppercase tracking-[0.14em] text-lime-200">Scout Voice</div>
          <p className="mt-1 leading-relaxed text-[var(--scout-chrome-ink-faint)]">
            Scout Menu owns microphone capture. Open Voice settings, choose a microphone, grant permission, then retry.
          </p>
          {issue && (
            <p className="mt-2 break-words leading-relaxed text-[var(--scout-chrome-ink-ghost)]">
              {issue}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ScoutVoiceSetupButton
          icon={probeState === "opening" ? <Loader2 size={12} className="animate-spin" /> : <Settings size={12} />}
          label={probeState === "opening" ? "Opening" : "Voice Settings"}
          onClick={onOpenSettings}
          disabled={probeState === "probing"}
          title="Open Scout voice settings"
        />
        <ScoutVoiceSetupButton
          icon={probeState === "probing" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          label="Retry"
          onClick={onRetry}
          disabled={isBusy}
          title="Check Scout voice again"
        />
      </div>
    </div>
  );
}

function ScoutVoiceSetupButton({
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
