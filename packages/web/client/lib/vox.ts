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

  launch(): void {
    window.location.href = "vox://launch";
  }

  openSettings(): void {
    window.location.href = "vox://settings";
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

export async function speakWithVox(text: string): Promise<VoxSpeakResult> {
  const response = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
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
  const audio = new Audio(`data:${result.contentType};base64,${result.audioBase64}`);
  await audio.play();
  return result;
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
