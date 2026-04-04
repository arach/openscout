import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createOpenAiTtsProvider,
  createOraRuntime,
  type OraAudioFormat,
} from "@arach/ora";
import { loadRelayConfigSync, type RelayConfig } from "./config.js";

const relayOraRuntime = createOraRuntime({
  providers: [createOpenAiTtsProvider()],
});

type OraCompatAudioAsset = {
  data?: Uint8Array;
  url?: string;
  mimeType?: string;
};

type OraCompatSynthesisResponse = {
  format: string;
  audioData?: Uint8Array;
  audioUrl?: string;
  mimeType?: string;
  audio?: OraCompatAudioAsset;
};

function readEnvFileValue(filePath: string, key: string): string {
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      if (!normalized.startsWith(`${key}=`)) continue;

      let value = normalized.slice(key.length + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    return "";
  }

  return "";
}

function resolveApiKey(config: RelayConfig): string {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  if (config.openaiApiKey) {
    return config.openaiApiKey;
  }

  const cwdEnv = readEnvFileValue(join(process.cwd(), ".env.local"), "OPENAI_API_KEY");
  if (cwdEnv) {
    return cwdEnv;
  }

  const home = process.env.HOME || "";
  if (home) {
    const homeEnv = readEnvFileValue(join(home, ".env.local"), "OPENAI_API_KEY");
    if (homeEnv) {
      return homeEnv;
    }
  }

  return "";
}

function resolveAudioFileExtension(format: string): string {
  switch (format) {
    case "aiff":
      return "aiff";
    case "wav":
      return "wav";
    case "aac":
      return "aac";
    case "opus":
      return "opus";
    case "mp3":
    default:
      return "mp3";
  }
}

function getSynthesisAudioData(response: OraCompatSynthesisResponse | null): Uint8Array | undefined {
  if (!response) {
    return undefined;
  }

  return response.audioData ?? response.audio?.data;
}

function playAudioFile(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "ignore"],
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with status ${code ?? "unknown"}`));
    });
  });
}

async function playSynthesizedAudio(audioData: Uint8Array, format: string): Promise<void> {
  const extension = resolveAudioFileExtension(format);
  const tempFilePath = join(tmpdir(), `openscout-ora-${randomUUID()}.${extension}`);

  await writeFile(tempFilePath, audioData);

  try {
    if (process.platform === "darwin") {
      try {
        await playAudioFile("afplay", [tempFilePath]);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }

    await playAudioFile("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", tempFilePath]);
  } finally {
    await rm(tempFilePath, { force: true }).catch(() => {});
  }
}

export function isAudioChannel(config: RelayConfig, channel?: string): boolean {
  if (!channel) return false;
  return config.channels?.[channel]?.audio === true;
}

export function getVoiceForChannel(config: RelayConfig, channel?: string): string {
  return (channel ? config.channels?.[channel]?.voice : undefined) || config.defaultVoice || "nova";
}

export function applyPronunciations(text: string, pronunciations?: Record<string, string>): string {
  if (!pronunciations) return text;

  let result = text;
  for (const [word, phonetic] of Object.entries(pronunciations)) {
    result = result.replace(new RegExp(`\\b${word}\\b`, "gi"), phonetic);
  }
  return result;
}

export function sanitizeRelaySpeechText(text: string, config: RelayConfig): string {
  const stripped = text.replace(/@[\w.-]+\s*/g, "").trim();
  if (!stripped) return "";
  return applyPronunciations(stripped, config.pronunciations).trim();
}

export async function synthesizeRelaySpeech(options: {
  relayDir: string;
  text: string;
  voice?: string;
  format?: OraAudioFormat;
  rate?: number;
}) {
  const config = loadRelayConfigSync(options.relayDir);
  const apiKey = resolveApiKey(config);
  const clean = sanitizeRelaySpeechText(options.text, config);

  if (!apiKey || !clean) {
    return null;
  }

  relayOraRuntime.setCredentials("openai", { apiKey });

  return relayOraRuntime.synthesize({
    provider: "openai",
    text: clean,
    voice: options.voice || getVoiceForChannel(config, "voice"),
    format: options.format || "mp3",
    rate: options.rate ?? 1.1,
    preferences: {
      priority: "responsiveness",
    },
  });
}

export async function speakRelayText(options: {
  relayDir: string;
  text: string;
  voice?: string;
  format?: OraAudioFormat;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
}): Promise<boolean> {
  const config = loadRelayConfigSync(options.relayDir);
  const apiKey = resolveApiKey(config);
  const clean = sanitizeRelaySpeechText(options.text, config);

  if (!apiKey || !clean) {
    return false;
  }

  options.onStart?.();

  try {
    const response = await synthesizeRelaySpeech({
      relayDir: options.relayDir,
      text: options.text,
      voice: options.voice,
      format: options.format,
      rate: options.rate,
    });

    const audioData = getSynthesisAudioData(response as OraCompatSynthesisResponse | null);
    if (!response || !audioData?.length) {
      return false;
    }

    await playSynthesizedAudio(audioData, response.format);
    return true;
  } finally {
    options.onEnd?.();
  }
}
