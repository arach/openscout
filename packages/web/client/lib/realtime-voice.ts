import {
  SCOUT_REALTIME_SCOUTBOT_CHAT_PATH,
  SCOUT_REALTIME_VOICE_CALL_PATH,
  SCOUT_REALTIME_VOICE_FLAG_HEADER,
  SCOUT_REALTIME_VOICE_FLAG_HEADER_VALUE,
} from "../../shared/realtime-voice.ts";
import { stripScoutbotUiFences } from "./scoutbot.ts";

export type ScoutRealtimeVoiceConnectionState = "connecting" | "live" | "ended" | "error";

export type ScoutRealtimeVoiceCall = {
  stop: () => void;
};

export type ScoutRealtimeVoiceTraceEvent = {
  id: string;
  label: string;
  detail?: string;
};

type ScoutRealtimeFunctionCall = {
  callId: string;
  name: string;
  arguments: string;
};

type ScoutbotChatResult = {
  reply?: { body?: unknown };
};

export async function startScoutRealtimeVoiceCall(callbacks: {
  onState?: (state: ScoutRealtimeVoiceConnectionState) => void;
  onError?: (message: string) => void;
  onScoutbotReply?: (body: string) => void;
  onTrace?: (event: ScoutRealtimeVoiceTraceEvent) => void;
  /** Read the route at the moment Scoutbot handles a turn, not only when the call started. */
  getRoute?: () => unknown;
  route?: unknown;
} = {}): Promise<ScoutRealtimeVoiceCall> {
  if (!globalThis.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support realtime audio calls.");
  }

  callbacks.onState?.("connecting");
  const peerConnection = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  let stopped = false;
  let mediaStream: MediaStream | null = null;
  let traceSequence = 0;

  const trace = (label: string, detail?: string) => {
    traceSequence += 1;
    callbacks.onTrace?.({
      id: `voice-${traceSequence}`,
      label,
      ...(detail ? { detail } : {}),
    });
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mediaStream?.getTracks().forEach((track) => track.stop());
    audio.pause();
    audio.srcObject = null;
    peerConnection.close();
    callbacks.onState?.("ended");
  };

  peerConnection.ontrack = ({ streams }) => {
    const stream = streams[0];
    if (!stream || stopped) return;
    const [track] = stream.getAudioTracks();
    if (track) {
      track.addEventListener("ended", () => {
        if (!stopped) callbacks.onError?.("Realtime voice audio ended unexpectedly.");
      });
    }
    audio.srcObject = stream;
    void audio.play()
      .catch(() => {
        callbacks.onError?.("Browser playback was blocked. Interact with the page, then start the call again.");
      });
  };
  peerConnection.onconnectionstatechange = () => {
    if (stopped) return;
    if (peerConnection.connectionState === "connected") {
      callbacks.onState?.("live");
      trace("Realtime channel connected", "Scoutbot bridge is ready");
    } else if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
      callbacks.onError?.("Realtime voice connection ended unexpectedly.");
      stop();
    }
  };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of mediaStream.getTracks()) {
      peerConnection.addTrack(track, mediaStream);
    }

    const events = peerConnection.createDataChannel("oai-events");
    const handledFunctionCallIds = new Set<string>();
    let functionQueue = Promise.resolve();
    const sendRealtimeEvent = (payload: unknown): boolean => {
      if (stopped || events.readyState !== "open") return false;
      try {
        events.send(JSON.stringify(payload));
        return true;
      } catch {
        callbacks.onError?.("Realtime voice events channel closed unexpectedly.");
        return false;
      }
    };
    events.addEventListener("open", () => {
      if (stopped) return;
      trace("Scoutbot bridge ready", "Live fleet context is available");
      if (!sendRealtimeEvent({
        type: "response.create",
        response: {
          instructions: "Open with one brief audible greeting: 'Hi, I’m Scoutbot. I can check the fleet and coordinate through Scout. What would you like to work on?'",
        },
      })) {
        callbacks.onError?.("Could not request Scout's opening greeting.");
      }
    });
    events.addEventListener("error", () => {
      callbacks.onError?.("Realtime voice events channel closed unexpectedly.");
    });
    events.addEventListener("message", (event) => {
      const payload = parseRealtimeEvent(event.data);
      if (payload?.type === "error") {
        callbacks.onError?.(payload.message ?? "OpenAI Realtime reported an error.");
        return;
      }
      if (payload?.type !== "response.done") return;
      for (const functionCall of extractFunctionCalls(payload)) {
        if (functionCall.name !== "ask_scoutbot" || handledFunctionCallIds.has(functionCall.callId)) continue;
        handledFunctionCallIds.add(functionCall.callId);
        functionQueue = functionQueue
          .then(() => fulfillScoutbotFunctionCall({
            functionCall,
            route: callbacks.getRoute?.() ?? callbacks.route,
            onReply: callbacks.onScoutbotReply,
            onTrace: trace,
            send: sendRealtimeEvent,
          }))
          .catch((error) => {
            callbacks.onError?.(error instanceof Error ? error.message : "Scoutbot could not complete the voice request.");
          });
      }
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    if (!offer.sdp) {
      throw new Error("Could not create a WebRTC offer.");
    }

    const response = await fetch(SCOUT_REALTIME_VOICE_CALL_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/sdp",
        [SCOUT_REALTIME_VOICE_FLAG_HEADER]: SCOUT_REALTIME_VOICE_FLAG_HEADER_VALUE,
      },
      body: offer.sdp,
    });
    const answerSdp = await response.text();
    if (!response.ok) {
      throw new Error(readRealtimeCallError(answerSdp, response.status));
    }
    await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });

    return { stop };
  } catch (error) {
    stop();
    throw error;
  }
}

async function fulfillScoutbotFunctionCall(input: {
  functionCall: ScoutRealtimeFunctionCall;
  route: unknown;
  onReply?: (body: string) => void;
  onTrace: (label: string, detail?: string) => void;
  send: (payload: unknown) => boolean;
}): Promise<void> {
  const request = readScoutbotRequest(input.functionCall.arguments);
  if (!request) {
    input.onTrace("Scoutbot request could not be read");
    sendScoutbotFunctionOutput(input, { ok: false, error: "The voice request did not include a usable Scoutbot prompt." });
    return;
  }

  input.onTrace("Scoutbot is checking the control plane", request);
  try {
    const response = await fetch(SCOUT_REALTIME_SCOUTBOT_CHAT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: request, route: input.route }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(readScoutbotChatError(raw, response.status));
    }
    const parsed = JSON.parse(raw) as ScoutbotChatResult;
    const body = typeof parsed.reply?.body === "string" ? parsed.reply.body.trim() : "";
    if (!body) {
      throw new Error("Scoutbot returned an empty reply.");
    }

    input.onReply?.(body);
    const spokenReply = stripScoutbotUiFences(body);
    input.onTrace("Scoutbot reply ready");
    sendScoutbotFunctionOutput(input, { ok: true, reply: spokenReply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scoutbot could not complete the voice request.";
    input.onTrace("Scoutbot request failed", message);
    sendScoutbotFunctionOutput(input, { ok: false, error: message });
  }
}

function sendScoutbotFunctionOutput(
  input: {
    functionCall: ScoutRealtimeFunctionCall;
    send: (payload: unknown) => boolean;
  },
  output: { ok: boolean; reply?: string; error?: string },
): void {
  const sent = input.send({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: input.functionCall.callId,
      output: JSON.stringify(output),
    },
  });
  if (!sent) return;
  input.send({
    type: "response.create",
    response: {
      instructions: output.ok
        ? "Answer using the Scoutbot result. Speak the useful answer naturally and concisely. Do not mention tools, JSON, fences, or implementation details."
        : "Briefly tell the operator that Scoutbot could not complete the live lookup and state the returned error plainly.",
    },
  });
}

function parseRealtimeEvent(value: unknown): {
  type?: string;
  message?: string;
  response?: { output?: unknown };
} | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as {
      type?: unknown;
      error?: { message?: unknown };
      response?: { output?: unknown };
    };
    return {
      ...(typeof parsed.type === "string" ? { type: parsed.type } : {}),
      ...(typeof parsed.error?.message === "string" ? { message: parsed.error.message } : {}),
      ...(parsed.response && typeof parsed.response === "object" ? { response: parsed.response } : {}),
    };
  } catch {
    return null;
  }
}

function extractFunctionCalls(event: { response?: { output?: unknown } }): ScoutRealtimeFunctionCall[] {
  if (!Array.isArray(event.response?.output)) return [];
  return event.response.output.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as { type?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown };
    if (
      item.type !== "function_call"
      || typeof item.call_id !== "string"
      || typeof item.name !== "string"
      || typeof item.arguments !== "string"
    ) {
      return [];
    }
    return [{ callId: item.call_id, name: item.name, arguments: item.arguments }];
  });
}

function readScoutbotRequest(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson) as { request?: unknown };
    if (typeof parsed.request !== "string") return null;
    const request = parsed.request.trim();
    return request ? request.slice(0, 8_000) : null;
  } catch {
    return null;
  }
}

function readScoutbotChatError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // Fall back to a stable status message below.
  }
  return `Scoutbot could not complete the live lookup (HTTP ${status}).`;
}

function readRealtimeCallError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // Fall back to a stable, non-provider-specific browser error below.
  }
  return `Could not start realtime voice (HTTP ${status}).`;
}
