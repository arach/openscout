import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useOptionalFlag } from "hudsonkit/flags";

import { api } from "../../lib/api.ts";
import { fetchScoutVoiceSettings } from "../../lib/scout-voice.ts";
import {
  startScoutRealtimeVoiceCall,
  isActiveResponseError,
  type ScoutRealtimeVoiceCall,
  type ScoutRealtimeVoiceConnectionState,
  type ScoutRealtimeVoiceTraceEvent,
} from "../../lib/realtime-voice.ts";
import { SCOUT_REALTIME_VOICE_FLAG } from "../../../shared/realtime-voice.ts";
import {
  extractScoutbotUiActions,
  isScoutNativeUiActionHost,
  type ScoutbotUiAction,
} from "../../lib/scoutbot.ts";
import { scoutbotUiContext } from "../../../shared/scoutbot-navigation.ts";
import { useScout } from "../Provider.tsx";
import type { ScoutbotAskAgentResult } from "./scoutbot-model.ts";

export const SCOUTBOT_REALTIME_REPLY_EVENT = "scout:scoutbot-realtime-reply";

type ScoutbotRealtimeVoiceContextValue = {
  enabled: boolean;
  open: boolean;
  state: ScoutRealtimeVoiceConnectionState | "idle";
  leaseId: string | null;
  error: string | null;
  trace: ScoutRealtimeVoiceTraceEvent[];
  pendingAgentRequest: Extract<ScoutbotUiAction, { type: "ask-agent" }> | null;
  setOpen: Dispatch<SetStateAction<boolean>>;
  startCall: () => Promise<void>;
  endCall: () => Promise<boolean>;
  confirmAgentRequest: () => Promise<void>;
  cancelAgentRequest: () => void;
  clearTrace: () => void;
  openVoiceSettings: () => void;
};

const DEFAULT_REALTIME_VOICE_CONTEXT: ScoutbotRealtimeVoiceContextValue = {
  enabled: false,
  open: false,
  state: "idle",
  leaseId: null,
  error: null,
  trace: [],
  pendingAgentRequest: null,
  setOpen: () => {},
  startCall: async () => {},
  endCall: async () => true,
  confirmAgentRequest: async () => {},
  cancelAgentRequest: () => {},
  clearTrace: () => {},
  openVoiceSettings: () => {},
};

const ScoutbotRealtimeVoiceContext = createContext<ScoutbotRealtimeVoiceContextValue>(
  DEFAULT_REALTIME_VOICE_CONTEXT,
);

export function ScoutbotRealtimeVoiceProvider({ children }: { children: ReactNode }) {
  const { route, applyScoutbotUiAction } = useScout();
  const enabled = useOptionalFlag(SCOUT_REALTIME_VOICE_FLAG, false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ScoutRealtimeVoiceConnectionState | "idle">("idle");
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<ScoutRealtimeVoiceTraceEvent[]>([]);
  const [pendingAgentRequests, setPendingAgentRequests] = useState<
    Array<Extract<ScoutbotUiAction, { type: "ask-agent" }>>
  >([]);
  const callRef = useRef<ScoutRealtimeVoiceCall | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const startSettledRef = useRef<Promise<void> | null>(null);
  const generationRef = useRef(0);
  const confirmingAgentRequestRef = useRef(false);
  const disposedRef = useRef(false);
  const startingRef = useRef(false);
  const bridgeRef = useRef({ route, applyScoutbotUiAction });
  bridgeRef.current = { route, applyScoutbotUiAction };

  const appendTrace = useCallback((label: string, detail?: string) => {
    setTrace((current) => [
      ...current,
      {
        id: `voice-ui-${Date.now()}-${current.length}`,
        at: Date.now(),
        label,
        ...(detail ? { detail } : {}),
      },
    ].slice(-100));
  }, []);

  const clearTrace = useCallback(() => setTrace([]), []);

  const endCall = useCallback(async () => {
    generationRef.current += 1;
    const pendingStart = startSettledRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const activeCall = callRef.current;
    callRef.current = null;
    setPendingAgentRequests([]);
    try {
      await activeCall?.stop();
      await pendingStart;
    } catch (caught) {
      if (!disposedRef.current) {
        setState("error");
        setError(caught instanceof Error ? caught.message : "Could not end realtime voice cleanly.");
      }
      return false;
    }
    if (disposedRef.current) return true;
    setLeaseId(null);
    setState("ended");
    appendTrace("Live voice ended", "Microphone and host lease released");
    return true;
  }, [appendTrace]);

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    if (callRef.current || state === "connecting" || state === "live") void endCall();
  }, [enabled, endCall, state]);

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    if (callRef.current || state === "connecting" || state === "live") endCall();
  }, [enabled, endCall, state]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      generationRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      void callRef.current?.stop().catch(() => {});
      callRef.current = null;
    };
  }, []);

  const applyReplyActions = useCallback((body: string) => {
    window.dispatchEvent(new CustomEvent(SCOUTBOT_REALTIME_REPLY_EVENT, { detail: { body } }));
    const spokenBody = body.replace(/```[\s\S]*?```/gu, "").trim();
    if (spokenBody) appendTrace("Scoutbot replied", spokenBody.slice(0, 2_000));
    for (const action of extractScoutbotUiActions(body)) {
      if (action.type === "ask-agent") {
        setPendingAgentRequests((current) => [...current, action]);
        appendTrace("Agent request needs confirmation", `Review the request for ${action.targetLabel}`);
      } else if (action.type !== "reminder") {
        const detail = describeActionDetail(action);
        appendTrace(describeAction(action), detail);
        bridgeRef.current.applyScoutbotUiAction(action);
        appendTrace(
          isScoutNativeUiActionHost() ? "Action sent to Scout for macOS" : "Action applied in OpenScout",
          detail,
        );
      }
    }
  }, [appendTrace]);

  const openVoiceSettings = useCallback(() => {
    const action: ScoutbotUiAction = { type: "navigate", route: { view: "settings", section: "voice" } };
    appendTrace("Voice settings requested");
    bridgeRef.current.applyScoutbotUiAction(action);
  }, [appendTrace]);

  const startCall = useCallback(async () => {
    if (!enabled) {
      setError("Turn on live voice in Settings → Voice before starting a call.");
      setOpen(false);
      return;
    }
    if (startingRef.current || state === "connecting" || state === "live") return;
    startingRef.current = true;
    abortControllerRef.current?.abort();
    const previousCall = callRef.current;
    callRef.current = null;
    try {
      await previousCall?.stop();
      setLeaseId(null);
    } catch (caught) {
      setState("error");
      setError(caught instanceof Error ? caught.message : "Could not end the previous realtime voice call.");
      startingRef.current = false;
      return;
    }
    setPendingAgentRequests([]);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let settleStart: () => void = () => {};
    const startSettled = new Promise<void>((resolve) => {
      settleStart = resolve;
    });
    startSettledRef.current = startSettled;
    let started = false;
    setError(null);
    setTrace([{ id: "connecting", at: Date.now(), label: "Connecting secure audio" }]);
    setState("connecting");
    try {
      const inputDeviceName = await fetchScoutVoiceSettings()
        .then(({ settings }) => settings.inputDeviceName)
        .catch(() => null);
      const call = await startScoutRealtimeVoiceCall({
        signal: controller.signal,
        inputDeviceName,
        getRoute: () => bridgeRef.current.route,
        getUiContext: () => scoutbotUiContext(isScoutNativeUiActionHost() ? "macos" : "web"),
        onState: (next) => {
          if (!disposedRef.current && generationRef.current === generation) {
            setState(next);
            if (next === "ended") setPendingAgentRequests([]);
          }
        },
        onError: (message) => {
          if (disposedRef.current || generationRef.current !== generation) return;
          if (isActiveResponseError(message)) {
            appendTrace("Scoutbot reply queued", "Waiting for the current spoken response to finish");
            return;
          }
          setError(message);
          appendTrace("Voice issue", message);
        },
        onTrace: (event) => {
          if (!disposedRef.current && generationRef.current === generation) {
            setTrace((current) => [...current, event].slice(-100));
          }
        },
        onScoutbotReply: (body) => {
          if (!disposedRef.current && generationRef.current === generation) {
            applyReplyActions(body);
          }
        },
      });
      if (disposedRef.current || controller.signal.aborted || generationRef.current !== generation) {
        await call.stop();
        return;
      }
      callRef.current = call;
      setLeaseId(call.leaseId);
      started = true;
    } catch (caught) {
      if (!disposedRef.current && generationRef.current === generation && !isAbortError(caught)) {
        setState("error");
        const message = caught instanceof Error ? caught.message : "Could not start realtime voice.";
        setError(message);
        appendTrace("Live voice could not start", message);
      }
    } finally {
      if (!started && abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      settleStart();
      if (startSettledRef.current === startSettled) startSettledRef.current = null;
      startingRef.current = false;
    }
  }, [appendTrace, applyReplyActions, enabled, state]);

  const confirmAgentRequest = useCallback(async () => {
    if (confirmingAgentRequestRef.current) return;
    const action = pendingAgentRequests[0];
    if (!action) return;
    confirmingAgentRequestRef.current = true;
    try {
      const sent = await sendScoutbotAsk(action, appendTrace, setError);
      if (sent) setPendingAgentRequests((current) => current.slice(1));
    } finally {
      confirmingAgentRequestRef.current = false;
    }
  }, [appendTrace, pendingAgentRequests]);

  const cancelAgentRequest = useCallback(() => {
    const action = pendingAgentRequests[0];
    if (!action) return;
    setPendingAgentRequests((current) => current.slice(1));
    appendTrace("Agent request not sent", action.targetLabel);
  }, [appendTrace, pendingAgentRequests]);

  const value = useMemo<ScoutbotRealtimeVoiceContextValue>(
    () => ({
      enabled,
      open,
      state,
      leaseId,
      error,
      trace,
      pendingAgentRequest: pendingAgentRequests[0] ?? null,
      setOpen,
      startCall,
      endCall,
      confirmAgentRequest,
      cancelAgentRequest,
      clearTrace,
      openVoiceSettings,
    }),
    [
      enabled,
      open,
      state,
      leaseId,
      error,
      trace,
      pendingAgentRequests,
      startCall,
      endCall,
      confirmAgentRequest,
      cancelAgentRequest,
      clearTrace,
      openVoiceSettings,
    ],
  );

  return (
    <ScoutbotRealtimeVoiceContext.Provider value={value}>
      {children}
    </ScoutbotRealtimeVoiceContext.Provider>
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function useScoutbotRealtimeVoice(): ScoutbotRealtimeVoiceContextValue {
  return useContext(ScoutbotRealtimeVoiceContext);
}

function describeAction(action: Exclude<ScoutbotUiAction, { type: "ask-agent" } | { type: "reminder" }>): string {
  if (action.type === "navigate") return "Navigation requested";
  if (action.type === "open-scoutbot") return "Scoutbot opened its panel";
  if (action.type === "refresh") return "Scoutbot refreshed live state";
  return "Scoutbot opened the requested file";
}

function describeActionDetail(
  action: Exclude<ScoutbotUiAction, { type: "ask-agent" } | { type: "reminder" }>,
): string {
  if (action.type === "navigate") return JSON.stringify(action.route);
  if (action.type === "view-file") return action.path;
  return action.reason?.trim() || action.type;
}

async function sendScoutbotAsk(
  action: Extract<ScoutbotUiAction, { type: "ask-agent" }>,
  appendTrace: (label: string, detail?: string) => void,
  setError: (message: string | null) => void,
): Promise<boolean> {
  appendTrace("Scoutbot is coordinating", `Asking ${action.targetLabel}`);
  try {
    const result = await api<ScoutbotAskAgentResult>("/api/scoutbot/actions/ask", {
      method: "POST",
      body: JSON.stringify({
        targetLabel: action.targetLabel,
        targetAgentId: action.targetAgentId,
        body: action.body,
        channel: action.channel,
      }),
    });
    appendTrace(
      "Scoutbot sent the request",
      result.flightId
        ? `${result.targetAgentId ?? result.targetLabel} · run ${result.flightId}`
        : result.targetAgentId ?? result.targetLabel,
    );
    return true;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not send to agent.";
    appendTrace("Scoutbot could not send the request", message);
    setError(message);
    return false;
  }
}
