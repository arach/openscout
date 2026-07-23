import {
  SCOUT_REALTIME_SCOUTBOT_CHAT_PATH,
  SCOUT_REALTIME_VOICE_CALL_PATH,
  SCOUT_REALTIME_VOICE_LEASE_HEADER,
  SCOUT_REALTIME_VOICE_LEASE_PATH,
} from "../../shared/realtime-voice.ts";
import { extractScoutbotUiActions, stripScoutbotUiFences } from "./scoutbot.ts";

const REALTIME_VOICE_HEARTBEAT_MS = 25_000;

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
  signal?: AbortSignal;
} = {}): Promise<ScoutRealtimeVoiceCall> {
  throwIfAborted(callbacks.signal);
  if (!globalThis.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support realtime audio calls.");
  }

  callbacks.onState?.("connecting");
  const peerConnection = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  let stopped = false;
  let mediaStream: MediaStream | null = null;
  let leaseId: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatFailures = 0;
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
    callbacks.signal?.removeEventListener("abort", stop);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    mediaStream?.getTracks().forEach((track) => track.stop());
    audio.pause();
    audio.srcObject = null;
    peerConnection.close();
    if (leaseId) void releaseRealtimeVoiceLease(leaseId);
    leaseId = null;
    callbacks.onState?.("ended");
  };
  callbacks.signal?.addEventListener("abort", stop, { once: true });

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
    mediaStream = await abortableMediaStream(
      navigator.mediaDevices.getUserMedia({ audio: true }),
      callbacks.signal,
    );
    throwIfAborted(callbacks.signal);
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
      if (!stopped) callbacks.onError?.("Realtime voice events channel closed unexpectedly.");
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

    const offer = await abortable(peerConnection.createOffer(), callbacks.signal);
    await abortable(peerConnection.setLocalDescription(offer), callbacks.signal);
    if (!offer.sdp) {
      throw new Error("Could not create a WebRTC offer.");
    }

    const response = await fetch(SCOUT_REALTIME_VOICE_CALL_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/sdp",
      },
      body: offer.sdp,
      signal: callbacks.signal,
    });
    const answerSdp = await abortable(response.text(), callbacks.signal);
    if (!response.ok) {
      throw new Error(readRealtimeCallError(answerSdp, response.status));
    }
    leaseId = response.headers.get(SCOUT_REALTIME_VOICE_LEASE_HEADER)?.trim() || null;
    if (!leaseId) {
      throw new Error("Scout started the audio connection without a concurrency lease. Please try again.");
    }
    heartbeatTimer = setInterval(() => {
      if (!leaseId || stopped) return;
      const currentLeaseId = leaseId;
      void heartbeatRealtimeVoiceLease(currentLeaseId)
        .then((ok) => {
          if (stopped || currentLeaseId !== leaseId) return;
          if (ok) {
            heartbeatFailures = 0;
            return;
          }
          callbacks.onError?.("Realtime voice lost its server lease. Reconnect to continue safely.");
          stop();
        })
        .catch(() => {
          heartbeatFailures += 1;
          if (heartbeatFailures < 2 || stopped) return;
          callbacks.onError?.("Realtime voice could not renew its server lease. Check the connection and try again.");
          stop();
        });
    }, REALTIME_VOICE_HEARTBEAT_MS);
    await abortable(
      peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp }),
      callbacks.signal,
    );
    throwIfAborted(callbacks.signal);

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
    const agentRequestPendingConfirmation = extractScoutbotUiActions(body)
      .some((action) => action.type === "ask-agent");
    input.onTrace("Scoutbot reply ready");
    sendScoutbotFunctionOutput(input, {
      ok: true,
      reply: spokenReply,
      ...(agentRequestPendingConfirmation ? { agentRequestPendingConfirmation: true } : {}),
    });
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
  output: { ok: boolean; reply?: string; error?: string; agentRequestPendingConfirmation?: boolean },
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
        ? output.agentRequestPendingConfirmation
          ? "Answer using the Scoutbot result. Say clearly that the agent request is ready for operator confirmation and has not been sent yet. Be concise and do not mention tools, JSON, fences, or implementation details."
          : "Answer using the Scoutbot result. Speak the useful answer naturally and concisely. Do not mention tools, JSON, fences, or implementation details."
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

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function abortableMediaStream(
  promise: Promise<MediaStream>,
  signal?: AbortSignal,
): Promise<MediaStream> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<MediaStream>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (stream) => {
        signal.removeEventListener("abort", onAbort);
        if (aborted || signal.aborted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        resolve(stream);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        if (!aborted) reject(error);
      },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Realtime voice connection was cancelled.", "AbortError");
}

async function heartbeatRealtimeVoiceLease(leaseId: string): Promise<boolean> {
  const response = await fetch(`${SCOUT_REALTIME_VOICE_LEASE_PATH}/${encodeURIComponent(leaseId)}`, {
    method: "PUT",
  });
  return response.ok;
}

async function releaseRealtimeVoiceLease(leaseId: string): Promise<void> {
  try {
    await fetch(`${SCOUT_REALTIME_VOICE_LEASE_PATH}/${encodeURIComponent(leaseId)}`, {
      method: "DELETE",
      keepalive: true,
    });
  } catch {
    // The short lease expires server-side if the browser disappears entirely.
  }
}
