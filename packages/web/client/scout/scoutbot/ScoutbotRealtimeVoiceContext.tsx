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

import { api } from "../../lib/api.ts";
import {
  startScoutRealtimeVoiceCall,
  type ScoutRealtimeVoiceCall,
  type ScoutRealtimeVoiceConnectionState,
  type ScoutRealtimeVoiceTraceEvent,
} from "../../lib/realtime-voice.ts";
import {
  extractScoutbotUiActions,
  type ScoutbotUiAction,
} from "../../lib/scoutbot.ts";
import { useScout } from "../Provider.tsx";
import type { ScoutbotAskAgentResult } from "./scoutbot-model.ts";

export const SCOUTBOT_REALTIME_REPLY_EVENT = "scout:scoutbot-realtime-reply";

type ScoutbotRealtimeVoiceContextValue = {
  open: boolean;
  state: ScoutRealtimeVoiceConnectionState | "idle";
  error: string | null;
  trace: ScoutRealtimeVoiceTraceEvent[];
  pendingAgentRequest: Extract<ScoutbotUiAction, { type: "ask-agent" }> | null;
  setOpen: Dispatch<SetStateAction<boolean>>;
  startCall: () => Promise<void>;
  endCall: () => void;
  confirmAgentRequest: () => Promise<void>;
  cancelAgentRequest: () => void;
};

const DEFAULT_REALTIME_VOICE_CONTEXT: ScoutbotRealtimeVoiceContextValue = {
  open: false,
  state: "idle",
  error: null,
  trace: [],
  pendingAgentRequest: null,
  setOpen: () => {},
  startCall: async () => {},
  endCall: () => {},
  confirmAgentRequest: async () => {},
  cancelAgentRequest: () => {},
};

const ScoutbotRealtimeVoiceContext = createContext<ScoutbotRealtimeVoiceContextValue>(
  DEFAULT_REALTIME_VOICE_CONTEXT,
);

export function ScoutbotRealtimeVoiceProvider({ children }: { children: ReactNode }) {
  const { route, applyScoutbotUiAction } = useScout();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ScoutRealtimeVoiceConnectionState | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<ScoutRealtimeVoiceTraceEvent[]>([]);
  const [pendingAgentRequests, setPendingAgentRequests] = useState<
    Array<Extract<ScoutbotUiAction, { type: "ask-agent" }>>
  >([]);
  const callRef = useRef<ScoutRealtimeVoiceCall | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const confirmingAgentRequestRef = useRef(false);
  const disposedRef = useRef(false);
  const startingRef = useRef(false);
  const bridgeRef = useRef({ route, applyScoutbotUiAction });
  bridgeRef.current = { route, applyScoutbotUiAction };

  const appendTrace = useCallback((label: string, detail?: string) => {
    setTrace((current) => [
      ...current,
      { id: `voice-ui-${Date.now()}-${current.length}`, label, ...(detail ? { detail } : {}) },
    ].slice(-6));
  }, []);

  const endCall = useCallback(() => {
    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    callRef.current?.stop();
    callRef.current = null;
    setPendingAgentRequests([]);
    setState("ended");
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      generationRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      callRef.current?.stop();
      callRef.current = null;
    };
  }, []);

  const applyReplyActions = useCallback((body: string) => {
    window.dispatchEvent(new CustomEvent(SCOUTBOT_REALTIME_REPLY_EVENT, { detail: { body } }));
    for (const action of extractScoutbotUiActions(body)) {
      if (action.type === "ask-agent") {
        setPendingAgentRequests((current) => [...current, action]);
        appendTrace("Agent request needs confirmation", `Review the request for ${action.targetLabel}`);
      } else if (action.type !== "reminder") {
        appendTrace(describeAction(action));
        bridgeRef.current.applyScoutbotUiAction(action);
      }
    }
  }, [appendTrace]);

  const startCall = useCallback(async () => {
    if (startingRef.current || state === "connecting" || state === "live") return;
    startingRef.current = true;
    abortControllerRef.current?.abort();
    callRef.current?.stop();
    callRef.current = null;
    setPendingAgentRequests([]);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let started = false;
    setError(null);
    setTrace([{ id: "connecting", label: "Connecting secure audio" }]);
    setState("connecting");
    try {
      const call = await startScoutRealtimeVoiceCall({
        signal: controller.signal,
        getRoute: () => bridgeRef.current.route,
        onState: (next) => {
          if (!disposedRef.current && generationRef.current === generation) {
            setState(next);
            if (next === "ended") setPendingAgentRequests([]);
          }
        },
        onError: (message) => {
          if (!disposedRef.current && generationRef.current === generation) setError(message);
        },
        onTrace: (event) => {
          if (!disposedRef.current && generationRef.current === generation) {
            setTrace((current) => [...current, event].slice(-6));
          }
        },
        onScoutbotReply: (body) => {
          if (!disposedRef.current && generationRef.current === generation) {
            applyReplyActions(body);
          }
        },
      });
      if (disposedRef.current || controller.signal.aborted || generationRef.current !== generation) {
        call.stop();
        return;
      }
      callRef.current = call;
      started = true;
    } catch (caught) {
      if (!disposedRef.current && generationRef.current === generation && !isAbortError(caught)) {
        setState("error");
        setError(caught instanceof Error ? caught.message : "Could not start realtime voice.");
      }
    } finally {
      if (!started && abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      startingRef.current = false;
    }
  }, [applyReplyActions, state]);

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
      open,
      state,
      error,
      trace,
      pendingAgentRequest: pendingAgentRequests[0] ?? null,
      setOpen,
      startCall,
      endCall,
      confirmAgentRequest,
      cancelAgentRequest,
    }),
    [
      open,
      state,
      error,
      trace,
      pendingAgentRequests,
      startCall,
      endCall,
      confirmAgentRequest,
      cancelAgentRequest,
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
  if (action.type === "navigate") return "Scoutbot opened the requested page";
  if (action.type === "open-scoutbot") return "Scoutbot opened its panel";
  if (action.type === "refresh") return "Scoutbot refreshed live state";
  return "Scoutbot opened the requested file";
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
