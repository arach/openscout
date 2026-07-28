import {
  SCOUT_SURFACE_PROTOCOL_VERSION,
  type CodexDeckRoute,
  type FleetDispatchDelta,
  type FleetTailDelta,
  type HostScope,
  type LaneSelection,
  type NativeVoiceSnapshot,
  type RequestId,
  type RoutedAskRequest,
  type RoutedAskReceipt,
  type RoutedReviewRequest,
  type RoutedReviewReceipt,
  type ScoutSurfaceClient,
  type ScoutSurfaceMethod,
  type ScoutSurfaceMethodContract,
  type ScoutSurfaceReply,
  type ScoutSurfaceRequest,
  type ScoutSurfaceId,
  type SurfaceBootstrap,
  type SurfacePreference,
  type SurfacePreferenceKey,
  type SurfacePreferences,
} from "./scout-surface-contract.ts";
import { NativeScoutSurfaceClient } from "./native-scout-surface-client.ts";

const DECK_SURFACE_PATH = "/api/surfaces/deck";
const PREFERENCES_STORAGE_KEY = "scout.surface.preferences.v1";

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type BrowserSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
};

type BrowserSpeechRecognitionErrorEvent = Event & { error?: string; message?: string };

type BrowserSpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export function createScoutSurfaceClient(
  surface: ScoutSurfaceId,
  currentScope: () => HostScope,
): ScoutSurfaceClient {
  if (window.webkit?.messageHandlers?.scoutSurface) {
    return new NativeScoutSurfaceClient(surface, currentScope);
  }
  return new WebScoutSurfaceClient(surface, currentScope);
}

/**
 * Same surface contract as the native WKWebView bridge, transported through
 * the trusted same-origin OpenScout web server. Browser-owned concerns
 * (speech, external URLs and preferences) stay in the browser; fleet and Codex
 * operations cross the allowlisted server boundary.
 */
export class WebScoutSurfaceClient implements ScoutSurfaceClient {
  private readonly pending = new Map<RequestId, AbortController>();
  private readonly voice = new BrowserVoiceController();

  constructor(
    private readonly surface: ScoutSurfaceId,
    private readonly currentScope: () => HostScope,
    private readonly endpoint = DECK_SURFACE_PATH,
  ) {}

  async bootstrap(): Promise<SurfaceBootstrap> {
    const value = await this.request("bootstrap", {});
    if (!this.voice.inputAvailable) return value;
    const capabilities = new Set(value.capabilities);
    capabilities.add("native.voice.snapshot");
    capabilities.add("native.voice.toggleInput");
    if (this.voice.outputAvailable) {
      capabilities.add("native.voice.speak");
      capabilities.add("native.voice.stopOutput");
    }
    return {
      ...value,
      capabilities: [...capabilities],
      device: {
        platform: "web",
        formFactor: browserFormFactor(),
      },
    };
  }

  agents = {
    list: (scope: HostScope) => this.request("agents.list", {}, scope),
    observe: (scope: HostScope, agentIds: readonly string[]) =>
      this.request("agents.observe", { agentIds }, scope),
  };

  tail = {
    recent: (scope: HostScope, cursor?: string) =>
      this.request("tail.recent", { ...(cursor ? { cursor } : {}) }, scope),
    subscribe: (scope: HostScope, listener: (delta: FleetTailDelta) => void) => {
      let known = new Set<string>();
      const poll = async () => {
        try {
          const fleet = await this.tail.recent(scope);
          for (const host of fleet.hosts) {
            if (!host.ready) continue;
            const next = host.value.events.filter((event) => !known.has(event.id));
            known = new Set(host.value.events.map((event) => event.id));
            if (next.length > 0) listener({ hostId: host.hostId, cursor: host.value.cursor, events: next });
          }
        } catch {
          // Polling is opportunistic. The owning surface's snapshot loop carries
          // connection errors and remains the visible source of truth.
        }
      };
      void poll();
      const timer = window.setInterval(() => void poll(), 2_000);
      return () => {
        window.clearInterval(timer);
      };
    },
  };

  codex = {
    snapshot: (route: CodexDeckRoute) => this.request("codex.thread.snapshot", { route }),
    connect: (route: CodexDeckRoute) => this.request("codex.thread.connect", { route }),
    start: (route: CodexDeckRoute, text: string) => this.request("codex.turn.start", { route, text }),
    steer: (route: CodexDeckRoute, text: string) => this.request("codex.turn.steer", { route, text }),
    interrupt: (route: CodexDeckRoute) => this.request("codex.turn.interrupt", { route }),
  };

  dispatch = {
    diagnostics: () => Promise.reject(new Error("Dispatch is unavailable on the Deck surface.")),
    ask: (_request: RoutedAskRequest): Promise<RoutedAskReceipt> =>
      Promise.reject(new Error("Dispatch is unavailable on the Deck surface.")),
    review: (_request: RoutedReviewRequest): Promise<RoutedReviewReceipt> =>
      Promise.reject(new Error("Dispatch is unavailable on the Deck surface.")),
    subscribe: (_scope: HostScope, _listener: (delta: FleetDispatchDelta) => void) => () => {},
  };

  native = {
    setLaneSelection: async (selection: LaneSelection | null) => {
      await this.request("native.setLaneSelection", { selection });
    },
    openExternalURL: async (url: string) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("Only https URLs can be opened from the Deck.");
      window.open(parsed, "_blank", "noopener,noreferrer");
    },
    getPreferences: async (keys: readonly SurfacePreferenceKey[]): Promise<SurfacePreferences> => {
      const values = readPreferences();
      return { entries: values.filter((entry) => keys.includes(entry.key)) };
    },
    setPreferences: async (values: SurfacePreferences) => {
      const next = new Map(readPreferences().map((entry) => [entry.key, entry]));
      for (const entry of values.entries) next.set(entry.key, entry);
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify([...next.values()]));
    },
    cancel: async (requestId: RequestId) => {
      this.pending.get(requestId)?.abort();
      this.pending.delete(requestId);
    },
    voice: {
      snapshot: () => Promise.resolve(this.voice.snapshot()),
      toggleInput: () => this.voice.toggleInput(),
      speak: (text: string) => this.voice.speak(text),
      stopOutput: () => this.voice.stopOutput(),
    },
  };

  selectedScope(): HostScope {
    return this.currentScope();
  }

  private async request<M extends ScoutSurfaceMethod>(
    method: M,
    params: ScoutSurfaceMethodContract[M]["params"],
    scope?: HostScope,
  ): Promise<ScoutSurfaceMethodContract[M]["result"]> {
    if (this.surface !== "deck") throw new Error("The web surface transport currently supports Scout Deck only.");
    const id = requestId();
    const controller = new AbortController();
    this.pending.set(id, controller);
    const message = {
      v: SCOUT_SURFACE_PROTOCOL_VERSION,
      id,
      surface: this.surface,
      method,
      params,
      ...(scope ? { hostIds: scope.hostIds } : {}),
    } as ScoutSurfaceRequest;

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Scout Deck web bridge returned HTTP ${response.status}.`);
      }
      const reply = await response.json() as ScoutSurfaceReply;
      if (reply.v !== SCOUT_SURFACE_PROTOCOL_VERSION || reply.id !== id || reply.method !== method) {
        throw new Error("Scout Deck web bridge returned a mismatched reply.");
      }
      if ("error" in reply) throw new Error(`${reply.error.code}: ${reply.error.message}`);
      return reply.result as ScoutSurfaceMethodContract[M]["result"];
    } finally {
      this.pending.delete(id);
    }
  }
}

class BrowserVoiceController {
  private readonly Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  private recognition: BrowserSpeechRecognition | null = null;
  private finalBuffer = "";
  private endingWithError: string | null = null;
  private state: NativeVoiceSnapshot = {
    input: {
      state: this.Recognition ? "idle" : "unavailable",
      partialText: "",
      finalText: "",
      finalCount: 0,
      engine: "apple",
      modelReady: Boolean(this.Recognition),
      unavailableReason: this.Recognition ? null : "Browser dictation is unavailable on this device.",
    },
    output: { speaking: false },
  };

  get inputAvailable(): boolean {
    return Boolean(this.Recognition);
  }

  get outputAvailable(): boolean {
    return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  snapshot(): NativeVoiceSnapshot {
    return {
      input: { ...this.state.input },
      output: { ...this.state.output },
    };
  }

  async toggleInput(): Promise<NativeVoiceSnapshot> {
    if (!this.Recognition) return this.snapshot();
    if (this.state.input.state === "listening") {
      this.state = { ...this.state, input: { ...this.state.input, state: "transcribing" } };
      this.recognition?.stop();
      return this.snapshot();
    }
    if (this.state.input.state === "transcribing") {
      this.recognition?.abort();
      this.finishRecognition();
      return this.snapshot();
    }

    this.stopOutput();
    this.finalBuffer = "";
    this.endingWithError = null;
    const recognition = new this.Recognition();
    this.recognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";
    recognition.onstart = () => {
      this.state = {
        ...this.state,
        input: { ...this.state.input, state: "listening", partialText: "", unavailableReason: null },
      };
    };
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;
        if (result.isFinal) this.finalBuffer = appendText(this.finalBuffer, transcript);
        else interim = appendText(interim, transcript);
      }
      this.state = {
        ...this.state,
        input: { ...this.state.input, partialText: appendText(this.finalBuffer, interim) },
      };
    };
    recognition.onerror = (event) => {
      const reason = browserSpeechError(event.error, event.message);
      if (event.error === "aborted") return;
      this.endingWithError = reason;
    };
    recognition.onend = () => this.finishRecognition();

    this.state = { ...this.state, input: { ...this.state.input, state: "preparing" } };
    try {
      recognition.start();
    } catch (cause) {
      this.endingWithError = cause instanceof Error ? cause.message : String(cause);
      this.finishRecognition();
    }
    return this.snapshot();
  }

  async speak(text: string): Promise<NativeVoiceSnapshot> {
    const value = text.trim();
    if (!value || !this.outputAvailable) return this.snapshot();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.onstart = () => {
      this.state = { ...this.state, output: { speaking: true } };
    };
    utterance.onend = utterance.onerror = () => {
      this.state = { ...this.state, output: { speaking: false } };
    };
    window.speechSynthesis.speak(utterance);
    this.state = { ...this.state, output: { speaking: true } };
    return this.snapshot();
  }

  async stopOutput(): Promise<NativeVoiceSnapshot> {
    if (this.outputAvailable) window.speechSynthesis.cancel();
    this.state = { ...this.state, output: { speaking: false } };
    return this.snapshot();
  }

  private finishRecognition(): void {
    const finalText = (this.finalBuffer.trim() || this.state.input.partialText.trim());
    const error = this.endingWithError;
    this.recognition = null;
    this.finalBuffer = "";
    this.endingWithError = null;
    this.state = {
      ...this.state,
      input: {
        ...this.state.input,
        state: error ? "unavailable" : "idle",
        partialText: "",
        finalText: error ? this.state.input.finalText : finalText,
        finalCount: error || !finalText ? this.state.input.finalCount : this.state.input.finalCount + 1,
        modelReady: !error,
        unavailableReason: error,
      },
    };
  }
}

function readPreferences(): SurfacePreference[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as SurfacePreference[] : [];
  } catch {
    return [];
  }
}

function browserFormFactor(): SurfaceBootstrap["device"]["formFactor"] {
  const width = Math.min(window.screen.width, window.screen.height);
  if (/iPad/i.test(navigator.userAgent)) return "ipad";
  if (/Mobi|iPhone|Android/i.test(navigator.userAgent) && width < 700) return "phone";
  return width < 1_100 ? "tablet" : "desktop";
}

function browserSpeechError(error?: string, message?: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone permission was denied for this Deck URL.";
  }
  if (error === "audio-capture") return "No microphone is available to the browser.";
  if (error === "network") return "Browser dictation could not reach its speech service.";
  return message?.trim() || (error ? `Browser dictation failed (${error}).` : "Browser dictation stopped unexpectedly.");
}

function appendText(left: string, right: string): string {
  return [left.trim(), right.trim()].filter(Boolean).join(" ");
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `surface-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
