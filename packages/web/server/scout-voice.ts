import { createVoxdClient } from "@voxd/client";

import {
  ensureOpenScoutVoxOrigins,
  resolveVoxSpeechDefaults,
  synthesizeVoxSpeech,
  type VoxSpeechDefaults,
  type VoxSpeechResult,
  type VoxSpeechTimingRequest,
} from "./vox.ts";

export type ScoutVoiceHealth = {
  ok: boolean;
  service: "scout-voice";
  adapter: "hudson-voice";
  detail: string | null;
};

export type ScoutVoiceTranscriptionResult = {
  text: string;
  durationMs: number;
  words?: Array<{ word: string; start: number; end: number }>;
  metrics?: Record<string, unknown>;
};

export type ScoutSpeechResult = VoxSpeechResult;
export type ScoutSpeechDefaults = VoxSpeechDefaults;
export type ScoutSpeechTimingRequest = VoxSpeechTimingRequest;

const SCOUT_VOICE_CLIENT_ID = "openscout-web";
const DEFAULT_SCOUT_VOICE_ASR_URL = "http://127.0.0.1:43115";

export async function getScoutVoiceHealth(): Promise<ScoutVoiceHealth> {
  try {
    const client = createScoutVoiceAsrClient(1200);
    const ok = await client.probe();
    if (!ok) {
      return {
        ok: false,
        service: "scout-voice",
        adapter: "hudson-voice",
        detail: "Scout voice capture adapter is unavailable.",
      };
    }
    return {
      ok: true,
      service: "scout-voice",
      adapter: "hudson-voice",
      detail: null,
    };
  } catch (error) {
    return {
      ok: false,
      service: "scout-voice",
      adapter: "hudson-voice",
      detail: error instanceof Error ? error.message : "Scout voice service is unavailable.",
    };
  }
}

export async function transcribeScoutVoiceAudio(input: {
  audio: Blob | ArrayBuffer;
  modelId?: string;
  format?: "mp3" | "wav" | "aac" | "opus" | "pcm16";
  language?: string;
  timestamps?: boolean;
}): Promise<ScoutVoiceTranscriptionResult> {
  const client = createScoutVoiceAsrClient();
  const result = await client.transcribe({
    audio: input.audio,
    modelId: input.modelId,
    format: input.format,
    language: input.language,
    timestamps: input.timestamps,
    metadata: {
      surface: SCOUT_VOICE_CLIENT_ID,
      owner: "scout",
    },
  });

  return {
    text: result.text,
    durationMs: result.durationMs,
    ...(result.words ? { words: result.words } : {}),
    ...(result.metrics ? { metrics: result.metrics } : {}),
  };
}

export async function synthesizeScoutSpeech(input: {
  text: string;
  modelId?: string;
  voiceId?: string;
  speed?: number;
  instructions?: string;
  originAppId?: string;
  utteranceId?: string;
  speechTiming?: ScoutSpeechTimingRequest;
  signal?: AbortSignal;
}): Promise<ScoutSpeechResult> {
  return synthesizeVoxSpeech(input);
}

export function resolveScoutSpeechDefaults(env: NodeJS.ProcessEnv = process.env): ScoutSpeechDefaults {
  return resolveVoxSpeechDefaults({
    ...env,
    OPENSCOUT_VOX_TTS_MODEL_ID: env.OPENSCOUT_VOICE_TTS_MODEL_ID ?? env.OPENSCOUT_VOX_TTS_MODEL_ID,
    OPENSCOUT_VOX_TTS_VOICE_ID: env.OPENSCOUT_VOICE_TTS_VOICE_ID ?? env.OPENSCOUT_VOX_TTS_VOICE_ID,
  });
}

export function ensureScoutVoiceOrigins(): void {
  ensureOpenScoutVoxOrigins();
}

function createScoutVoiceAsrClient(probeTimeout?: number) {
  return createVoxdClient({
    baseUrl: resolveScoutVoiceAsrUrl(),
    clientId: SCOUT_VOICE_CLIENT_ID,
    ...(probeTimeout ? { probeTimeout } : {}),
  });
}

function resolveScoutVoiceAsrUrl(env: NodeJS.ProcessEnv = process.env): string {
  return firstNonEmptyString(
    env.OPENSCOUT_VOICE_ASR_URL,
    env.OPENSCOUT_VOICE_BRIDGE_URL,
    env.VOX_COMPANION_URL,
  ) ?? DEFAULT_SCOUT_VOICE_ASR_URL;
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed.replace(/\/$/, "");
  }
  return undefined;
}
