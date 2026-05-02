import {
  createVoxdClient,
  VoxDError,
  type LiveSession,
  type SessionFinalEvent,
  type SessionState,
} from "@voxd/client";

export type VoxConnectionState = "unknown" | "probing" | "connected" | "unavailable";

export type VoxSessionState = SessionState;

export type VoxLiveFinal = {
  sessionId: string;
  text: string;
  durationMs: number;
};

export type VoxLiveHandle = {
  readonly sessionId: string | null;
  result: Promise<VoxLiveFinal>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
};

export type VoxLiveCallbacks = {
  onState?: (state: VoxSessionState) => void;
  onPartial?: (text: string) => void;
  onFinal?: (final: VoxLiveFinal) => void;
};

export type VoxSpeakResult = {
  contentType: string;
  audioBase64: string;
  modelId: string;
  voiceId: string;
  audioBytes: number;
};

export type VoxSpeakHandle = {
  promise: Promise<VoxSpeakResult>;
  stop: () => void;
};

export type VoxLaunchOptions = {
  source?: string;
  returnTo?: string;
  context?: VoxLaunchContext;
};

export type VoxLaunchContext = {
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

const DEFAULT_VOX_BRIDGE = "http://127.0.0.1:43115";
const VOX_CLIENT_ID = "openscout-web";

export class VoxBrowserClient {
  private state: VoxConnectionState = "unknown";
  private unavailableReason: string | null = null;
  private client: ReturnType<typeof createVoxdClient>;

  constructor(private readonly baseUrl = DEFAULT_VOX_BRIDGE) {
    this.client = this.createClient();
  }

  get connectionState(): VoxConnectionState {
    return this.state;
  }

  get lastUnavailableReason(): string | null {
    return this.unavailableReason;
  }

  async probe(timeoutMs = 1200): Promise<boolean> {
    this.state = "probing";
    this.unavailableReason = null;
    this.client = this.createClient(timeoutMs);

    try {
      const healthy = await this.client.probe();
      if (!healthy) {
        this.state = "unavailable";
        return false;
      }

      await this.client.capabilities();
      this.state = "connected";
      return true;
    } catch (error) {
      this.state = "unavailable";
      this.unavailableReason = humanVoxError(error);
      return false;
    }
  }

  launch(options: VoxLaunchOptions = {}): void {
    window.location.href = buildVoxUrl("launch", {
      source: options.source,
      returnTo: options.returnTo ?? currentBrowserOrigin(),
      context: encodeLaunchContext(options.context),
    });
  }

  openSettings(options: VoxLaunchOptions = {}): void {
    window.location.href = buildVoxUrl("settings", {
      source: options.source,
      returnTo: options.returnTo ?? currentBrowserOrigin(),
      context: encodeLaunchContext(options.context),
    });
  }

  async startLive(callbacks: VoxLiveCallbacks = {}): Promise<VoxLiveHandle> {
    const session = this.client.createLiveSession();
    let final: VoxLiveFinal | null = null;
    bindLiveCallbacks(session, callbacks, (next) => {
      final = next;
    });
    const result = session.start({ modelId: "parakeet:v3" })
      .then((event) => {
        final ??= normalizeFinal(event);
        return final;
      })
      .catch((error) => {
        throw new Error(humanVoxError(error));
      });

    return {
      get sessionId() {
        return session.id;
      },
      result,
      stop: async () => {
        await session.stop();
      },
      cancel: async () => {
        await session.cancel().catch(() => undefined);
      },
    };
  }

  private createClient(probeTimeout = 1200) {
    return createVoxdClient({
      baseUrl: this.baseUrl,
      clientId: VOX_CLIENT_ID,
      probeTimeout,
    });
  }
}

function stoppedSpeechError(): Error {
  const error = new Error("Speech stopped.");
  error.name = "AbortError";
  return error;
}

export function isVoxSpeechStopped(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function speakWithVox(
  text: string,
  options: { signal?: AbortSignal } = {},
): Promise<VoxSpeakResult> {
  const response = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    try {
      const parsed = JSON.parse(body) as { error?: string };
      throw new Error(parsed.error ?? `Voice returned HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(body || `Voice returned HTTP ${response.status}`);
      }
      throw error;
    }
  }
  const result = await response.json() as VoxSpeakResult;
  if (options.signal?.aborted) {
    throw stoppedSpeechError();
  }
  const audio = new Audio(`data:${result.contentType};base64,${result.audioBase64}`);
  const stopPlayback = () => {
    audio.pause();
    audio.currentTime = 0;
  };
  options.signal?.addEventListener("abort", stopPlayback, { once: true });
  await audio.play();
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
        reject(new Error("Vox audio playback failed."));
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

export function startVoxSpeech(text: string): VoxSpeakHandle {
  const controller = new AbortController();
  return {
    promise: speakWithVox(text, { signal: controller.signal }),
    stop: () => controller.abort(),
  };
}

function bindLiveCallbacks(
  session: LiveSession,
  callbacks: VoxLiveCallbacks,
  updateFinal: (final: VoxLiveFinal) => void,
): void {
  session.onState((event) => callbacks.onState?.(event.state));
  session.onPartial((event) => callbacks.onPartial?.(event.text));
  session.onFinal((event) => {
    const final = normalizeFinal(event);
    updateFinal(final);
    callbacks.onFinal?.(final);
  });
}

function normalizeFinal(raw: SessionFinalEvent): VoxLiveFinal {
  return {
    sessionId: raw.sessionId,
    text: raw.text.trim(),
    durationMs: raw.durationMs,
  };
}

function buildVoxUrl(host: "launch" | "settings", params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `vox://${host}?${query}` : `vox://${host}`;
}

function encodeLaunchContext(context: VoxLaunchContext | undefined): string | undefined {
  if (!context) return undefined;
  return JSON.stringify(context);
}

function currentBrowserOrigin(): string | undefined {
  try {
    return window.location.origin;
  } catch {
    return undefined;
  }
}

function humanVoxError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof VoxDError && error.code === "http_error" && /origin not allowed/i.test(message)) {
    return "Vox blocked this OpenScout URL. Restart OpenScout so it can register its Vox browser origin, then try again.";
  }
  if (/origin not allowed/i.test(message)) {
    return "Vox blocked this OpenScout URL. Restart OpenScout so it can register its Vox browser origin, then try again.";
  }
  return message || "Vox request failed.";
}
