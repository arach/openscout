import {
  DEFAULT_VOICE_FX,
  VOICE_FX_PRESETS,
  decodeAudioFromBase64,
  playWithVoiceFx,
  type VoiceFxParams,
} from "@voxd/client/fx";

export type ScoutVoiceConnectionState = "unknown" | "probing" | "connected" | "unavailable";
export type ScoutVoiceSessionState = "starting" | "recording" | "processing" | "done" | "cancelled" | "error";

export type ScoutVoiceLiveFinal = {
  sessionId: string;
  text: string;
  durationMs: number;
};

export type ScoutVoiceLiveHandle = {
  readonly sessionId: string | null;
  result: Promise<ScoutVoiceLiveFinal>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
};

export type ScoutVoiceLiveCallbacks = {
  onState?: (state: ScoutVoiceSessionState) => void;
  onPartial?: (text: string) => void;
  onFinal?: (final: ScoutVoiceLiveFinal) => void;
};

export type ScoutSpeechResult = {
  contentType: string;
  audioBase64: string;
  modelId: string;
  voiceId: string;
  audioBytes: number;
  metrics?: Record<string, unknown>;
  traceId?: string;
  speechTiming?: ScoutSpeechTimingResult;
};

export type ScoutSpeechHandle = {
  promise: Promise<ScoutSpeechResult>;
  stop: () => void;
};

export type ScoutSpeechOptions = {
  signal?: AbortSignal;
  speed?: number;
  instructions?: string;
  originAppId?: string;
  utteranceId?: string;
  speechTiming?: ScoutSpeechTimingRequest;
};

export type ScoutSpeechTimingCueRequest = {
  id: string;
  textStart?: number;
  textEnd?: number;
  text?: string;
};

export type ScoutSpeechTimingRequest = {
  enabled: true;
  modelId?: string;
  strict?: boolean;
  cues?: ScoutSpeechTimingCueRequest[];
};

export type ScoutSpeechTimingWord = {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  sourceTextStart?: number;
  sourceTextEnd?: number;
};

export type ScoutSpeechTimingCueResult = {
  id: string;
  startMs: number;
  endMs?: number;
  confidence?: number;
  source?: string;
};

export type ScoutSpeechTimingResult = {
  source?: string;
  modelId?: string;
  elapsedMs?: number;
  words?: ScoutSpeechTimingWord[];
  cues?: ScoutSpeechTimingCueResult[];
};

export type ScoutVoiceLaunchOptions = {
  source?: string;
  returnTo?: string;
  context?: ScoutVoiceLaunchContext;
};

export type ScoutVoiceLaunchContext = {
  requesterName?: string;
  productName?: string;
  headline?: string;
  body?: string;
  actionLabel?: string;
  logo?: {
    url?: string;
    path?: string;
    symbolName?: string;
  };
};

export function shouldAutoProbeScoutVoice(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    typeof fetch === "function" &&
      typeof MediaRecorder !== "undefined" &&
      navigator.mediaDevices?.getUserMedia,
  );
}

export class ScoutVoiceClient {
  private state: ScoutVoiceConnectionState = "unknown";
  private unavailableReason: string | null = null;

  get connectionState(): ScoutVoiceConnectionState {
    return this.state;
  }

  get lastUnavailableReason(): string | null {
    return this.unavailableReason;
  }

  async probe(timeoutMs = 1200): Promise<boolean> {
    this.state = "probing";
    this.unavailableReason = null;

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.state = "unavailable";
      this.unavailableReason = "Scout voice capture is unavailable in this browser.";
      return false;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("/api/voice/health", { signal: controller.signal });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; detail?: string; error?: string };
      if (!response.ok || !body.ok) {
        this.state = "unavailable";
        this.unavailableReason = body.detail ?? body.error ?? "Scout voice service is unavailable.";
        return false;
      }
      this.state = "connected";
      return true;
    } catch (error) {
      this.state = "unavailable";
      this.unavailableReason = error instanceof Error && error.name === "AbortError"
        ? "Scout voice service did not respond."
        : "Scout voice service is unavailable.";
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async launch(_options: ScoutVoiceLaunchOptions = {}): Promise<void> {
    try {
      const response = await fetch("/api/scout-services/restart-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "all" }),
      });
      const body = await response.json().catch(() => ({})) as { url?: string };
      if (body.url?.startsWith("scout://services/restart/")) {
        window.location.href = body.url;
        return;
      }
    } catch {
      // Fall through to the HUD URL. The retry button still gives feedback.
    }
    window.location.href = "scout://hud/show";
  }

  async startLive(callbacks: ScoutVoiceLiveCallbacks = {}): Promise<ScoutVoiceLiveHandle> {
    const sessionId = createSessionId();
    const chunks: Blob[] = [];
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let cancelled = false;
    let finalized = false;

    let resolveResult!: (final: ScoutVoiceLiveFinal) => void;
    let rejectResult!: (error: Error) => void;
    const result = new Promise<ScoutVoiceLiveFinal>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const stopTracks = () => {
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
      stream = null;
    };

    const settleError = (error: Error, state: ScoutVoiceSessionState = "error") => {
      if (finalized) return;
      finalized = true;
      stopTracks();
      callbacks.onState?.(state);
      rejectResult(error);
    };

    const finalizeRecording = async () => {
      if (finalized) return;
      stopTracks();
      if (cancelled) {
        settleError(cancelledVoiceError(), "cancelled");
        return;
      }
      callbacks.onState?.("processing");
      const mimeType = recorder?.mimeType || preferredRecordingMimeType() || "application/octet-stream";
      const audio = new Blob(chunks, { type: mimeType });
      if (audio.size === 0) {
        settleError(new Error("No voice audio was captured."));
        return;
      }
      try {
        const final = await transcribeScoutVoiceAudio(audio, { sessionId });
        if (finalized) return;
        finalized = true;
        callbacks.onFinal?.(final);
        callbacks.onState?.("done");
        resolveResult(final);
      } catch (error) {
        settleError(error instanceof Error ? error : new Error(String(error)));
      }
    };

    try {
      callbacks.onState?.("starting");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredRecordingMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        settleError(new Error("Scout voice recorder failed."));
      });
      recorder.addEventListener("stop", () => {
        void finalizeRecording();
      }, { once: true });
      recorder.start();
      callbacks.onPartial?.("");
      callbacks.onState?.("recording");
    } catch (error) {
      const startError = error instanceof Error ? error : new Error(String(error));
      settleError(startError);
      void result.catch(() => undefined);
      throw startError;
    }

    return {
      get sessionId() {
        return sessionId;
      },
      result,
      stop: async () => {
        if (!recorder || recorder.state === "inactive") return;
        recorder.stop();
      },
      cancel: async () => {
        cancelled = true;
        if (recorder && recorder.state !== "inactive") {
          recorder.stop();
          return;
        }
        settleError(cancelledVoiceError(), "cancelled");
      },
    };
  }
}

export function isScoutSpeechStopped(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function prepareScoutSpeech(
  text: string,
  options: ScoutSpeechOptions = {},
): Promise<ScoutSpeechResult> {
  const body: Record<string, unknown> = {
    text,
    speed: normalizeSpeechSpeed(options.speed),
  };
  if (options.originAppId) body.originAppId = options.originAppId;
  if (options.utteranceId) body.utteranceId = options.utteranceId;
  if (options.instructions) body.instructions = options.instructions;
  if (options.speechTiming?.enabled) body.speechTiming = options.speechTiming;

  const response = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      throw new Error(parsed.error ?? `Scout voice returned HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(raw || `Scout voice returned HTTP ${response.status}`);
      }
      throw error;
    }
  }
  return await response.json() as ScoutSpeechResult;
}

export async function playPreparedScoutSpeech(
  result: ScoutSpeechResult,
  options: { signal?: AbortSignal; onPlaybackStart?: () => void } = {},
): Promise<ScoutSpeechResult> {
  if (options.signal?.aborted) throw stoppedSpeechError();
  const audio = new Audio(`data:${result.contentType};base64,${result.audioBase64}`);
  const stopPlayback = () => {
    audio.pause();
    audio.currentTime = 0;
  };
  options.signal?.addEventListener("abort", stopPlayback, { once: true });
  await audio.play();
  options.onPlaybackStart?.();
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const onEnded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Scout voice playback failed."));
      };
      const onAbort = () => {
        cleanup();
        reject(stoppedSpeechError());
      };
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      audio.addEventListener("ended", onEnded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
    return result;
  } finally {
    options.signal?.removeEventListener("abort", stopPlayback);
  }
}

export async function speakWithScoutVoice(
  text: string,
  options: ScoutSpeechOptions = {},
): Promise<ScoutSpeechResult> {
  const result = await prepareScoutSpeech(text, options);
  return await playPreparedScoutSpeech(result, { signal: options.signal });
}

export function startScoutSpeech(text: string, options: Omit<ScoutSpeechOptions, "signal"> = {}): ScoutSpeechHandle {
  const controller = new AbortController();
  return {
    promise: speakWithScoutVoice(text, { ...options, signal: controller.signal }),
    stop: () => controller.abort(),
  };
}

export type ScoutSpeakWithEffectsOptions = ScoutSpeechOptions & {
  presetId?: string;
  params?: Partial<VoiceFxParams>;
};

export async function speakWithEffects(
  text: string,
  options: ScoutSpeakWithEffectsOptions = {},
): Promise<ScoutSpeechResult> {
  const result = await prepareScoutSpeech(text, options);
  if (options.signal?.aborted) throw stoppedSpeechError();
  const buffer = await decodeAudioFromBase64(result.audioBase64, result.contentType);
  const params = resolveVoiceFxParams(options.presetId, options.params);
  const handle = playWithVoiceFx(buffer, { params, signal: options.signal });
  await handle.promise;
  return result;
}

export async function playPreparedScoutSpeechWithEffects(
  result: ScoutSpeechResult,
  options: { signal?: AbortSignal; presetId?: string; params?: Partial<VoiceFxParams>; onPlaybackStart?: () => void } = {},
): Promise<ScoutSpeechResult> {
  if (options.signal?.aborted) throw stoppedSpeechError();
  const buffer = await decodeAudioFromBase64(result.audioBase64, result.contentType);
  const params = resolveVoiceFxParams(options.presetId, options.params);
  const handle = playWithVoiceFx(buffer, { params, signal: options.signal });
  options.onPlaybackStart?.();
  await handle.promise;
  return result;
}

export function startScoutSpeechWithEffects(
  text: string,
  options: Omit<ScoutSpeakWithEffectsOptions, "signal"> = {},
): ScoutSpeechHandle {
  const controller = new AbortController();
  return {
    promise: speakWithEffects(text, { ...options, signal: controller.signal }),
    stop: () => controller.abort(),
  };
}

async function transcribeScoutVoiceAudio(
  audio: Blob,
  input: { sessionId: string },
): Promise<ScoutVoiceLiveFinal> {
  const form = new FormData();
  const format = audioFormatForMimeType(audio.type);
  form.append("audio", audio, `audio.${extensionForMimeType(audio.type)}`);
  form.append("sessionId", input.sessionId);
  if (format) form.append("format", format);

  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      throw new Error(parsed.error ?? `Scout voice returned HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(raw || `Scout voice returned HTTP ${response.status}`);
      }
      throw error;
    }
  }
  const result = await response.json() as { text?: string; durationMs?: number };
  return {
    sessionId: input.sessionId,
    text: result.text?.trim() ?? "",
    durationMs: Number(result.durationMs ?? 0),
  };
}

function stoppedSpeechError(): Error {
  const error = new Error("Speech stopped.");
  error.name = "AbortError";
  return error;
}

function cancelledVoiceError(): Error {
  const error = new Error("Voice recording was cancelled.");
  error.name = "AbortError";
  return error;
}

function preferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/wav",
  ];
  return candidates.find((candidate) => {
    try {
      return MediaRecorder.isTypeSupported(candidate);
    } catch {
      return false;
    }
  });
}

function audioFormatForMimeType(mimeType: string): string | undefined {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("mp3") || normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("aac") || normalized.includes("mp4")) return "aac";
  if (normalized.includes("opus") || normalized.includes("ogg") || normalized.includes("webm")) return "opus";
  return undefined;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "opus";
  if (normalized.includes("mp4") || normalized.includes("aac")) return "m4a";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mp3") || normalized.includes("mpeg")) return "mp3";
  return "audio";
}

function resolveVoiceFxParams(
  presetId: string | undefined,
  override: Partial<VoiceFxParams> | undefined,
): VoiceFxParams {
  const presetParams = presetId
    ? VOICE_FX_PRESETS.find((p) => p.id === presetId)?.params
    : undefined;
  return {
    ...DEFAULT_VOICE_FX,
    ...(presetParams ?? {}),
    ...(override ?? {}),
  };
}

function normalizeSpeechSpeed(speed: number | undefined): number | undefined {
  if (speed === undefined || !Number.isFinite(speed)) return undefined;
  return Math.min(2, Math.max(0.5, Number(speed.toFixed(2))));
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `scout-voice:${crypto.randomUUID()}`;
  }
  return `scout-voice:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
