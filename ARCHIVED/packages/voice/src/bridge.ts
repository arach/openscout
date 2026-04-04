import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

type BridgeCommand = {
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
};

type BridgeResponse = {
  id?: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
};

type BridgeEvent = {
  event: string;
  data?: Record<string, unknown>;
};

type VoiceCaptureState =
  | "unavailable"
  | "idle"
  | "connecting"
  | "recording"
  | "processing"
  | "error";

type VoiceStatus = {
  captureState: VoiceCaptureState;
  speaking: boolean;
  voxAvailable: boolean;
  oraAvailable: boolean;
  detail?: string;
};

type PlaybackSynthesis = {
  audioBytes: Uint8Array;
  mimeType: string | undefined;
  voice: string;
  providerLabel: string;
};

type VoxClientModule = {
  VoxClient: new (options: { clientId?: string; port?: number }) => {
    connected?: boolean;
    connect(): Promise<void>;
    disconnect(): void;
    createLiveSession(): {
      start(params?: Record<string, unknown>): Promise<unknown>;
      stop(): Promise<void>;
      cancel(): Promise<void>;
      on(event: "state", handler: (payload: { state: VoiceCaptureState | "starting" | "done" | "cancelled"; previous?: string | null }) => void): void;
      on(event: "partial", handler: (payload: { text: string }) => void): void;
      on(event: "final", handler: (payload: { text: string }) => void): void;
      on(event: "error", handler: (payload: { error: Error }) => void): void;
    };
    scheduleWarmup?(modelId?: string, delayMs?: number): Promise<unknown>;
  };
};

type OraModule = {
  OraMemoryCacheStore: new () => unknown;
  OraMemoryCredentialStore: new () => {
    set(provider: string, value: Record<string, unknown>): Promise<void>;
  };
  OraBufferedInstrumentationSink: new () => unknown;
  createOraRuntime: (options: {
    providers: unknown[];
    cacheStore: unknown;
    credentialStore: unknown;
    instrumentation: unknown[];
  }) => {
    provider(id: "openai"): {
      listVoices(): Promise<Array<{ id: string; label?: string }>>;
      synthesize(request: {
        text: string;
        voice?: string;
        format?: "mp3" | "wav" | "aac" | "opus" | "aiff";
        instructions?: string;
        rate?: number;
      }): Promise<{
        audio?: {
          data?: Uint8Array;
          url?: string;
          mimeType?: string;
        };
        audioData?: Uint8Array;
        audioUrl?: string;
        mimeType?: string;
      }>;
    };
  };
  createOpenAiTtsProvider: () => unknown;
};

const bridgeState: VoiceStatus = {
  captureState: "unavailable",
  speaking: false,
  voxAvailable: false,
  oraAvailable: false,
  detail: "Voice bridge booting.",
};

let voxModulePromise: Promise<VoxClientModule> | null = null;
let oraModulePromise: Promise<OraModule> | null = null;
let voxClient: InstanceType<VoxClientModule["VoxClient"]> | null = null;
let liveSession: ReturnType<InstanceType<VoxClientModule["VoxClient"]>["createLiveSession"]> | null = null;
let playbackProcess: ChildProcess | null = null;
let playbackTempFile: string | null = null;

function emit(message: BridgeResponse | BridgeEvent) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function emitEvent(event: string, data?: Record<string, unknown>) {
  emit({ event, data });
}

function updateStatus(patch: Partial<VoiceStatus>) {
  Object.assign(bridgeState, patch);
  emitEvent("status", bridgeState);
}

function respond(id: string | undefined, ok: boolean, payload?: Record<string, unknown>, error?: string) {
  emit({
    id,
    ok,
    ...(payload ? { result: payload } : {}),
    ...(error ? { error } : {}),
  });
}

function resolveOraModuleCandidates() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(moduleDirectory, "../node_modules/@arach/ora/src/index.ts"),
    resolve(moduleDirectory, "../../../node_modules/@arach/ora/src/index.ts"),
  ];
}

function resolveVoxModuleCandidates() {
  const home = process.env.HOME ?? "";
  return [
    process.env.OPENSCOUT_VOX_MODULE ?? "",
    "/Users/arach/dev/vox/packages/client/src/index.ts",
    home ? join(home, "dev", "vox", "packages", "client", "src", "index.ts") : "",
  ].filter(Boolean);
}

async function loadOraModule() {
  if (!oraModulePromise) {
    oraModulePromise = (async () => {
      for (const candidate of resolveOraModuleCandidates()) {
        if (!existsSync(candidate)) {
          continue;
        }

        return import(candidate) as Promise<OraModule>;
      }

      throw new Error("Ora source entry not found. Run bun install so @arach/ora is available.");
    })();
  }

  return oraModulePromise;
}

async function loadVoxModule() {
  if (!voxModulePromise) {
    voxModulePromise = (async () => {
      for (const candidate of resolveVoxModuleCandidates()) {
        if (!existsSync(candidate)) {
          continue;
        }

        return import(candidate) as Promise<VoxClientModule>;
      }

      throw new Error("Vox client source not found. Set OPENSCOUT_VOX_MODULE or keep ~/dev/vox available.");
    })();
  }

  return voxModulePromise;
}

async function readOpenAiApiKey() {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  if (process.env.ORA_OPENAI_API_KEY) {
    return process.env.ORA_OPENAI_API_KEY;
  }

  try {
    const settingsPath = join(process.env.HOME ?? "", ".config", "speakeasy", "settings.json");
    const raw = await readFile(settingsPath, "utf8");
    const data = JSON.parse(raw) as {
      providers?: {
        openai?: {
          apiKey?: string;
        };
      };
    };
    return data.providers?.openai?.apiKey ?? "";
  } catch {
    return "";
  }
}

function mimeTypeForFormat(format: "mp3" | "wav" | "aac" | "opus" | "aiff") {
  switch (format) {
    case "wav":
      return "audio/wav";
    case "aac":
      return "audio/aac";
    case "opus":
      return "audio/opus";
    case "aiff":
      return "audio/aiff";
    case "mp3":
    default:
      return "audio/mpeg";
  }
}

function fileExtensionForMime(mimeType: string | undefined) {
  switch (mimeType) {
    case "audio/wav":
      return "wav";
    case "audio/aac":
      return "aac";
    case "audio/opus":
      return "opus";
    case "audio/aiff":
      return "aiff";
    case "audio/mpeg":
    default:
      return "mp3";
  }
}

async function ensureOraProvider() {
  const ora = await loadOraModule();
  const apiKey = await readOpenAiApiKey();

  if (!apiKey) {
    throw new Error("OpenAI API key not found for Ora playback.");
  }

  const credentialStore = new ora.OraMemoryCredentialStore();
  await credentialStore.set("openai", { apiKey });

  const runtime = ora.createOraRuntime({
    providers: [ora.createOpenAiTtsProvider()],
    cacheStore: new ora.OraMemoryCacheStore(),
    credentialStore,
    instrumentation: [new ora.OraBufferedInstrumentationSink()],
  });

  bridgeState.oraAvailable = true;
  return runtime.provider("openai");
}

function resolveExternalTtsBaseUrl() {
  return (
    process.env.OPENSCOUT_TTS_BASE_URL
    || process.env.OPENSCOUT_VOXTRAL_BASE_URL
    || ""
  ).trim().replace(/\/+$/, "");
}

function resolveExternalTtsEndpoint() {
  const explicitEndpoint = (
    process.env.OPENSCOUT_TTS_ENDPOINT
    || process.env.OPENSCOUT_VOXTRAL_ENDPOINT
    || ""
  ).trim();

  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const baseUrl = resolveExternalTtsBaseUrl();
  if (!baseUrl) {
    return "";
  }

  return `${baseUrl}/v1/audio/speech`;
}

function resolveExternalTtsModel() {
  return (
    process.env.OPENSCOUT_TTS_MODEL
    || process.env.OPENSCOUT_VOXTRAL_MODEL
    || "mistralai/Voxtral-4B-TTS-2603"
  ).trim();
}

function resolveOraPlaybackVoice(voice: string | undefined) {
  return (
    voice
    || process.env.OPENSCOUT_ORA_VOICE
    || "nova"
  ).trim();
}

function resolveExternalPlaybackVoice(voice: string | undefined) {
  return (
    voice
    || process.env.OPENSCOUT_TTS_VOICE
    || process.env.OPENSCOUT_VOXTRAL_VOICE
    || ""
  ).trim();
}

async function synthesizeWithExternalTts(text: string, voice: string | undefined): Promise<PlaybackSynthesis> {
  const endpoint = resolveExternalTtsEndpoint();
  if (!endpoint) {
    throw new Error("External TTS endpoint is not configured.");
  }

  const selectedVoice = resolveExternalPlaybackVoice(voice);
  const responseFormat = (process.env.OPENSCOUT_TTS_FORMAT || "mp3").trim().toLowerCase();
  const apiKey = (
    process.env.OPENSCOUT_TTS_API_KEY
    || process.env.OPENAI_API_KEY
    || ""
  ).trim();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "audio/*",
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      input: text,
      model: resolveExternalTtsModel(),
      ...(selectedVoice ? { voice: selectedVoice } : {}),
      response_format: responseFormat,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).trim();
    throw new Error(
      `External TTS request failed (${response.status}): ${body.slice(0, 200) || response.statusText || "unknown error"}`,
    );
  }

  const audioBytes = new Uint8Array(await response.arrayBuffer());
  if (!audioBytes.length) {
    throw new Error("External TTS returned no audio bytes.");
  }

  bridgeState.oraAvailable = true;
  return {
    audioBytes,
    mimeType: response.headers.get("content-type") ?? mimeTypeForFormat(responseFormat as "mp3"),
    voice: selectedVoice || "default voice",
    providerLabel: resolveExternalTtsModel(),
  };
}

async function synthesizePlaybackAudio(text: string, voice: string | undefined): Promise<PlaybackSynthesis> {
  if (resolveExternalTtsEndpoint()) {
    return synthesizeWithExternalTts(text, voice);
  }

  const provider = await ensureOraProvider();
  const selectedVoice = resolveOraPlaybackVoice(voice);
  const response = await provider.synthesize({
    text,
    voice: selectedVoice,
    format: "mp3",
  });

  const audioBytes = response.audio?.data ?? response.audioData;
  if (!audioBytes || audioBytes.length === 0) {
    throw new Error("Ora returned no audio bytes.");
  }

  return {
    audioBytes,
    mimeType: response.audio?.mimeType ?? response.mimeType ?? mimeTypeForFormat("mp3"),
    voice: selectedVoice,
    providerLabel: "ora",
  };
}

async function writeAudioFile(bytes: Uint8Array, mimeType: string | undefined) {
  const extension = fileExtensionForMime(mimeType);
  const digest = createHash("sha1")
    .update(bytes)
    .digest("hex")
    .slice(0, 12);
  const tempDir = join(tmpdir(), "openscout-voice");
  await mkdir(tempDir, { recursive: true });

  const filePath = join(tempDir, `${Date.now()}-${digest}.${extension}`);
  await writeFile(filePath, bytes);
  return filePath;
}

async function stopPlayback() {
  if (playbackProcess && !playbackProcess.killed) {
    playbackProcess.kill("SIGTERM");
  }
  playbackProcess = null;
  playbackTempFile = null;
  updateStatus({ speaking: false });
}

async function speakText(text: string, voice: string | undefined) {
  const clean = text.replace(/@[\w.-]+\s*/g, "").trim();
  if (!clean) {
    return;
  }

  const playback = await synthesizePlaybackAudio(clean, voice);

  await stopPlayback();
  playbackTempFile = await writeAudioFile(playback.audioBytes, playback.mimeType);
  updateStatus({ speaking: true, detail: `Speaking with ${playback.voice}.` });
  emitEvent("speech.started", {
    provider: playback.providerLabel,
    voice: playback.voice,
    text: clean,
  });

  const child = spawn("/usr/bin/afplay", [playbackTempFile], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  playbackProcess = child;

  child.on("close", () => {
    playbackProcess = null;
    playbackTempFile = null;
    updateStatus({ speaking: false, detail: "Playback idle." });
    emitEvent("speech.finished", {
      text: clean,
    });
  });
}

async function ensureVoxClient(clientId: string) {
  if (!voxClient) {
    const vox = await loadVoxModule();
    voxClient = new vox.VoxClient({ clientId });
  }

  if (!voxClient.connected) {
    updateStatus({
      captureState: "connecting",
      detail: "Connecting to Vox.",
    });
    await voxClient.connect();
  }

  if (typeof voxClient.scheduleWarmup === "function") {
    try {
      await voxClient.scheduleWarmup("parakeet:v3", 200);
    } catch {
      // Warmup is a best-effort latency improvement.
    }
  }

  bridgeState.voxAvailable = true;
  return voxClient;
}

function routeSessionState(state: string): VoiceCaptureState {
  switch (state) {
    case "starting":
      return "connecting";
    case "recording":
      return "recording";
    case "processing":
      return "processing";
    case "error":
      return "error";
    case "done":
    case "cancelled":
    default:
      return "idle";
  }
}

async function startVoiceCapture(params: Record<string, unknown>) {
  if (liveSession) {
    return;
  }

  const clientId = typeof params.clientId === "string" ? params.clientId : "openscout-app";
  const client = await ensureVoxClient(clientId);
  const session = client.createLiveSession();
  liveSession = session;
  updateStatus({
    captureState: "recording",
    detail: "Listening.",
  });

  session.on("state", ({ state }) => {
    updateStatus({
      captureState: routeSessionState(state),
      detail: `Vox state: ${state}.`,
    });
  });

  session.on("partial", ({ text }) => {
    emitEvent("voice.partial", {
      text,
    });
  });

  session.on("final", ({ text }) => {
    emitEvent("voice.final", {
      text,
    });
    liveSession = null;
    updateStatus({
      captureState: "idle",
      detail: "Voice capture complete.",
    });
  });

  session.on("error", ({ error }) => {
    liveSession = null;
    updateStatus({
      captureState: "error",
      detail: error.message,
    });
    emitEvent("voice.error", {
      message: error.message,
    });
  });

  void session.start().catch((error: unknown) => {
    liveSession = null;
    const message = error instanceof Error ? error.message : "Unknown Vox error.";
    updateStatus({
      captureState: "error",
      detail: message,
    });
    emitEvent("voice.error", {
      message,
    });
  });
}

async function stopVoiceCapture() {
  if (!liveSession) {
    updateStatus({
      captureState: bridgeState.voxAvailable ? "idle" : "unavailable",
      detail: "Voice capture is idle.",
    });
    return;
  }

  updateStatus({
    captureState: "processing",
    detail: "Stopping voice capture.",
  });

  try {
    await liveSession.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stop Vox session.";
    updateStatus({
      captureState: "error",
      detail: message,
    });
    emitEvent("voice.error", {
      message,
    });
  }
}

async function listVoices() {
  if (resolveExternalTtsEndpoint()) {
    const configuredVoices = (process.env.OPENSCOUT_TTS_VOICES || "")
      .split(",")
      .map((voice) => voice.trim())
      .filter(Boolean);
    const voices = configuredVoices.length > 0 ? configuredVoices : [];

    return {
      voices: voices.map((voice) => ({
        id: voice,
        label: voice,
      })),
    };
  }

  const provider = await ensureOraProvider();
  const voices = await provider.listVoices();

  return {
    voices: voices.map((voice) => ({
      id: voice.id,
      label: voice.label ?? voice.id,
    })),
  };
}

async function health() {
  const detailParts: string[] = [];
  let voxAvailable = false;
  let oraAvailable = false;

  try {
    await loadVoxModule();
    voxAvailable = true;
    detailParts.push("vox ready");
  } catch (error) {
    detailParts.push(error instanceof Error ? error.message : "vox unavailable");
  }

  try {
    if (resolveExternalTtsEndpoint()) {
      oraAvailable = true;
      detailParts.push(`tts ready (${resolveExternalTtsModel()})`);
    } else {
      await ensureOraProvider();
      oraAvailable = true;
      detailParts.push("ora ready");
    }
  } catch (error) {
    detailParts.push(error instanceof Error ? error.message : "ora unavailable");
  }

  updateStatus({
    captureState: voxAvailable ? "idle" : "unavailable",
    voxAvailable,
    oraAvailable,
    detail: detailParts.join(" · "),
  });

  return {
    status: bridgeState,
  };
}

async function handleCommand(command: BridgeCommand) {
  const id = command.id ?? randomUUID();
  const method = command.method ?? "";
  const params = command.params ?? {};

  try {
    switch (method) {
      case "health":
        respond(id, true, await health());
        return;
      case "voices.list":
        respond(id, true, await listVoices());
        return;
      case "voice.start":
        await startVoiceCapture(params);
        respond(id, true, { status: bridgeState });
        return;
      case "voice.stop":
        await stopVoiceCapture();
        respond(id, true, { status: bridgeState });
        return;
      case "speech.speak":
        await speakText(
          typeof params.text === "string" ? params.text : "",
          typeof params.voice === "string" ? params.voice : undefined,
        );
        respond(id, true, { status: bridgeState });
        return;
      case "speech.stop":
        await stopPlayback();
        respond(id, true, { status: bridgeState });
        return;
      case "shutdown":
        await stopPlayback();
        if (voxClient) {
          try {
            voxClient.disconnect();
          } catch {
            // Ignore teardown issues.
          }
        }
        respond(id, true, { ok: true });
        process.exit(0);
      default:
        respond(id, false, undefined, `Unknown method: ${method}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown voice bridge error.";
    updateStatus({
      detail: message,
      captureState: method.startsWith("voice.") ? "error" : bridgeState.captureState,
      oraAvailable: bridgeState.oraAvailable,
      voxAvailable: bridgeState.voxAvailable,
    });
    respond(id, false, undefined, message);
  }
}

async function main() {
  emitEvent("bridge.ready", {
    pid: process.pid,
  });
  await health().catch(() => {
    // Health probes are best effort on boot.
  });

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    try {
      const command = JSON.parse(line) as BridgeCommand;
      void handleCommand(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON command.";
      emitEvent("voice.error", {
        message,
      });
    }
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Voice bridge crashed.";
  emitEvent("voice.error", {
    message,
  });
  process.exitCode = 1;
});
