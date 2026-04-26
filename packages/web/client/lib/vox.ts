export type VoxConnectionState = "unknown" | "probing" | "connected" | "unavailable";

export type VoxSessionState = "starting" | "recording" | "processing" | "done" | "cancelled" | "error";

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

export class VoxBrowserClient {
  private state: VoxConnectionState = "unknown";

  constructor(private readonly baseUrl = DEFAULT_VOX_BRIDGE) {}

  get connectionState(): VoxConnectionState {
    return this.state;
  }

  async probe(timeoutMs = 1200): Promise<boolean> {
    this.state = "probing";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      const body = await response.json().catch(() => null) as { ok?: boolean } | null;
      this.state = response.ok && body?.ok ? "connected" : "unavailable";
      return this.state === "connected";
    } catch {
      this.state = "unavailable";
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  launch(): void {
    window.location.href = "vox://launch";
  }

  openSettings(): void {
    window.location.href = "vox://settings";
  }

  async startLive(callbacks: VoxLiveCallbacks = {}): Promise<VoxLiveHandle> {
    let sessionId: string | null = null;
    let final: VoxLiveFinal | null = null;
    const controller = new AbortController();

    const result = (async () => {
      const response = await fetch(`${this.baseUrl}/live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: "openscout-web",
          modelId: "parakeet:v3",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await response.text().catch(() => `Vox returned HTTP ${response.status}`));
      }
      if (!response.body) {
        throw new Error("Vox live session did not return a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const parsed = parseNdjson(line);
          if (!parsed) continue;
          if (typeof parsed.error === "string" && parsed.error) {
            throw new Error(parsed.error);
          }

          if (typeof parsed.event === "string") {
            const data = asRecord(parsed.data);
            const nextSessionId = stringValue(data.sessionId);
            if (nextSessionId) sessionId = nextSessionId;
            if (parsed.event === "session.state") {
              callbacks.onState?.(normalizeSessionState(data.state));
            }
            if (parsed.event === "session.partial") {
              callbacks.onPartial?.(stringValue(data.text));
            }
            if (parsed.event === "session.final") {
              final = normalizeFinal(data, sessionId);
              callbacks.onFinal?.(final);
            }
            continue;
          }

          if (parsed.result && typeof parsed.result === "object") {
            final = normalizeFinal(parsed.result as Record<string, unknown>, sessionId);
          }
        }
      }

      if (!final) {
        throw new Error("Vox live session ended without a transcript.");
      }
      return final;
    })();

    return {
      get sessionId() {
        return sessionId;
      },
      result,
      stop: async () => {
        await fetch(`${this.baseUrl}/live/stop`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sessionId ? { sessionId } : {}),
        });
      },
      cancel: async () => {
        controller.abort();
        await fetch(`${this.baseUrl}/live/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sessionId ? { sessionId } : {}),
        }).catch(() => undefined);
      },
    };
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

function parseNdjson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function normalizeSessionState(value: unknown): VoxSessionState {
  switch (value) {
    case "starting":
    case "recording":
    case "processing":
    case "done":
    case "cancelled":
    case "error":
      return value;
    default:
      return "error";
  }
}

function normalizeFinal(raw: Record<string, unknown>, fallbackSessionId: string | null): VoxLiveFinal {
  return {
    sessionId: stringValue(raw.sessionId) || fallbackSessionId || "",
    text: stringValue(raw.text).trim(),
    durationMs: Number(raw.durationMs ?? raw.elapsedMs ?? 0),
  };
}
