import { Radio, Square } from "lucide-react";
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
  setOpen: Dispatch<SetStateAction<boolean>>;
  startCall: () => Promise<void>;
  endCall: () => void;
};

const DEFAULT_REALTIME_VOICE_CONTEXT: ScoutbotRealtimeVoiceContextValue = {
  open: false,
  state: "idle",
  error: null,
  trace: [],
  setOpen: () => {},
  startCall: async () => {},
  endCall: () => {},
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
  const callRef = useRef<ScoutRealtimeVoiceCall | null>(null);
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
    callRef.current?.stop();
    callRef.current = null;
    setState("ended");
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      callRef.current?.stop();
      callRef.current = null;
    };
  }, []);

  const applyReplyActions = useCallback((body: string) => {
    window.dispatchEvent(new CustomEvent(SCOUTBOT_REALTIME_REPLY_EVENT, { detail: { body } }));
    for (const action of extractScoutbotUiActions(body)) {
      if (action.type === "ask-agent") {
        void sendScoutbotAsk(action, appendTrace, setError);
      } else if (action.type !== "reminder") {
        appendTrace(describeAction(action));
        bridgeRef.current.applyScoutbotUiAction(action);
      }
    }
  }, [appendTrace]);

  const startCall = useCallback(async () => {
    if (startingRef.current || state === "connecting" || state === "live") return;
    startingRef.current = true;
    setError(null);
    setTrace([{ id: "connecting", label: "Connecting secure audio" }]);
    setState("connecting");
    try {
      const call = await startScoutRealtimeVoiceCall({
        getRoute: () => bridgeRef.current.route,
        onState: (next) => {
          if (!disposedRef.current) setState(next);
        },
        onError: (message) => {
          if (!disposedRef.current) setError(message);
        },
        onTrace: (event) => {
          if (!disposedRef.current) {
            setTrace((current) => [...current, event].slice(-6));
          }
        },
        onScoutbotReply: applyReplyActions,
      });
      if (disposedRef.current) {
        call.stop();
        return;
      }
      callRef.current = call;
    } catch (caught) {
      if (!disposedRef.current) {
        setState("error");
        setError(caught instanceof Error ? caught.message : "Could not start realtime voice.");
      }
    } finally {
      startingRef.current = false;
    }
  }, [applyReplyActions, state]);

  const value = useMemo<ScoutbotRealtimeVoiceContextValue>(
    () => ({ open, state, error, trace, setOpen, startCall, endCall }),
    [open, state, error, trace, startCall, endCall],
  );

  return (
    <ScoutbotRealtimeVoiceContext.Provider value={value}>
      {children}
      {!open && (state === "connecting" || state === "live") && (
        <aside className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded border border-lime-300/35 bg-[var(--scout-chrome-bg)] px-2.5 py-2 shadow-xl">
          <Radio size={12} className={state === "connecting" ? "animate-pulse text-lime-300" : "text-lime-300"} />
          <span className="font-mono text-[10px] text-[var(--scout-chrome-ink)]">
            Scoutbot voice {state === "connecting" ? "connecting" : "live"}
          </span>
          <button
            type="button"
            onClick={endCall}
            className="ml-1 inline-flex min-h-6 items-center gap-1 rounded border border-red-400/40 px-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-red-100 hover:bg-red-400/15"
          >
            <Square size={9} className="fill-current" /> End
          </button>
        </aside>
      )}
    </ScoutbotRealtimeVoiceContext.Provider>
  );
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
): Promise<void> {
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
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not send to agent.";
    appendTrace("Scoutbot could not send the request", message);
    setError(message);
  }
}
