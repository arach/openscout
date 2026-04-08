import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { RelayVoiceState } from "@scout/app/scout-desktop";
import type { RuntimeRegistrySnapshot } from "../../runtime/src/registry.js";

const OPERATOR_ID = "operator";
const BRIDGE_TIMEOUT_MS = 30_000;

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
  detail: string;
};

type BridgeCommand = {
  id: string;
  method: string;
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

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type ConversationRecord = {
  id: string;
  kind: string;
};

type MessageRecord = {
  id: string;
  conversationId: string;
  actorId: string;
  class: string;
  body: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
  speech?: {
    text?: string;
    voice?: string;
    interruptible?: boolean;
  };
};

function normalizeTimestamp(value: number | null | undefined): number {
  if (!value) return 0;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function resolveRepositoryRoot() {
  const explicitRoot = process.env.OPENSCOUT_REPO_ROOT?.trim();
  if (explicitRoot && existsSync(explicitRoot)) {
    return explicitRoot;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), __dirname, path.dirname(process.execPath)];

  for (const candidate of candidates) {
    const root = searchUpwardsForRepositoryRoot(candidate);
    if (root) {
      return root;
    }
  }

  return null;
}

function searchUpwardsForRepositoryRoot(startDirectory: string) {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    if (
      existsSync(path.join(currentDirectory, "package.json")) &&
      existsSync(path.join(currentDirectory, "packages")) &&
      existsSync(path.join(currentDirectory, "native"))
    ) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

function resolveBunExecutable() {
  const explicitPaths = [
    process.env.OPENSCOUT_BUN_BIN,
    process.env.BUN_BIN,
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  for (const candidate of explicitPaths) {
    const expanded = candidate.replace(/^~(?=$|\/)/, homedir());
    if (existsSync(expanded)) {
      return expanded;
    }
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const commonDirectories = [
    path.join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];

  for (const directory of [...pathEntries, ...commonDirectories]) {
    const candidate = path.join(directory.replace(/^~(?=$|\/)/, homedir()), "bun");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function sanitizeRelayBody(body: string) {
  return body
    .replace(/\[ask:[^\]]+\]\s*/g, "")
    .replace(/\[speak\]\s*/gi, "")
    .replace(/^(@[\w.-]+\s+)+/g, "")
    .trim();
}

function normalizedChannel(conversation: ConversationRecord | undefined) {
  if (!conversation) return null;
  if (conversation.id.startsWith("channel.")) {
    return conversation.id.replace(/^channel\./, "");
  }
  return null;
}

function spokenTextForMessage(message: MessageRecord) {
  const explicitSpeech = message.speech?.text?.trim();
  if (explicitSpeech) {
    return explicitSpeech;
  }

  const taggedSpeech = message.body.match(/^\[speak\]\s*([\s\S]+)$/i)?.[1]?.trim();
  return taggedSpeech || null;
}

function isSystemMessage(message: MessageRecord, conversation: ConversationRecord | undefined) {
  return message.class === "system" || conversation?.kind === "system" || normalizedChannel(conversation) === "system";
}

function captureTitleForState(captureState: string) {
  switch (captureState) {
    case "connecting":
      return "Connecting";
    case "recording":
    case "processing":
      return "Stop";
    default:
      return "Listen";
  }
}

function isCaptureActive(captureState: string) {
  return captureState === "connecting" || captureState === "recording" || captureState === "processing";
}

class RelayVoiceBridgeService {
  private bridgeProcess: ChildProcessWithoutNullStreams | null = null;
  private bridgeStatus: VoiceStatus | null = null;
  private bridgeReady = false;
  private observedMessageIds = new Set<string>();
  private historySeeded = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private repliesEnabled = false;

  private resolveVoicePackageDir() {
    const repositoryRoot = resolveRepositoryRoot();
    if (!repositoryRoot) {
      throw new Error("Unable to locate the Scout repository root for the voice bridge.");
    }

    const packageDirectory = path.join(repositoryRoot, "packages", "voice");
    if (!existsSync(packageDirectory)) {
      throw new Error(`Voice bridge package not found at ${packageDirectory}.`);
    }

    return packageDirectory;
  }

  private async startIfNeeded() {
    if (this.bridgeProcess && !this.bridgeProcess.killed) {
      return;
    }

    const bunExecutable = resolveBunExecutable();
    if (!bunExecutable) {
      throw new Error("Unable to locate Bun for the Electron voice bridge.");
    }

    const packageDirectory = this.resolveVoicePackageDir();
    const child = spawn(
      bunExecutable,
      ["run", "--cwd", packageDirectory, "bridge"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      },
    );

    this.bridgeProcess = child;
    this.bridgeReady = true;

    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdout.on("line", (line) => {
      this.handleBridgeLine(line);
    });

    const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderr.on("line", (line) => {
      void line;
    });

    child.once("exit", (code, signal) => {
      this.bridgeProcess = null;
      this.bridgeReady = false;
      this.rejectPendingRequests(
        new Error(
          code === 0
            ? "Voice bridge stopped."
            : `Voice bridge exited (${signal ?? code ?? "unknown"}).`,
        ),
      );
      this.bridgeStatus = {
        captureState: "unavailable",
        speaking: false,
        voxAvailable: false,
        oraAvailable: false,
        detail: code === 0 ? "Voice bridge stopped." : "Voice bridge unavailable.",
      };
    });

    await this.sendCommand("health");
  }

  private rejectPendingRequests(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }

  private handleBridgeLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let payload: BridgeResponse | BridgeEvent;
    try {
      payload = JSON.parse(trimmed) as BridgeResponse | BridgeEvent;
    } catch {
      return;
    }

    if ("event" in payload) {
      this.handleBridgeEvent(payload);
      return;
    }

    const requestId = payload.id;
    if (!requestId) {
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);

    if (payload.ok) {
      pending.resolve(payload.result ?? {});
    } else {
      pending.reject(new Error(payload.error ?? "Voice bridge request failed."));
    }
  }

  private handleBridgeEvent(event: BridgeEvent) {
    if (event.event === "status") {
      this.bridgeStatus = {
        captureState: (event.data?.captureState as VoiceCaptureState | undefined) ?? "unavailable",
        speaking: Boolean(event.data?.speaking),
        voxAvailable: Boolean(event.data?.voxAvailable),
        oraAvailable: Boolean(event.data?.oraAvailable),
        detail: typeof event.data?.detail === "string" ? event.data.detail : "Voice bridge active.",
      };
      return;
    }

    if (event.event === "voice.error") {
      this.bridgeStatus = {
        captureState: "error",
        speaking: this.bridgeStatus?.speaking ?? false,
        voxAvailable: this.bridgeStatus?.voxAvailable ?? false,
        oraAvailable: this.bridgeStatus?.oraAvailable ?? false,
        detail: typeof event.data?.message === "string" ? event.data.message : "Voice bridge error.",
      };
      return;
    }

    if (event.event === "speech.started") {
      this.bridgeStatus = {
        captureState: this.bridgeStatus?.captureState ?? "idle",
        speaking: true,
        voxAvailable: this.bridgeStatus?.voxAvailable ?? false,
        oraAvailable: this.bridgeStatus?.oraAvailable ?? false,
        detail: typeof event.data?.text === "string" ? `Speaking: ${event.data.text}` : "Speaking.",
      };
      return;
    }

    if (event.event === "speech.finished") {
      this.bridgeStatus = {
        captureState: this.bridgeStatus?.captureState ?? "idle",
        speaking: false,
        voxAvailable: this.bridgeStatus?.voxAvailable ?? false,
        oraAvailable: this.bridgeStatus?.oraAvailable ?? false,
        detail: "Playback idle.",
      };
    }
  }

  private async sendCommand(method: string, params?: Record<string, unknown>) {
    if (!this.bridgeProcess || !this.bridgeReady) {
      throw new Error("Voice bridge is not available.");
    }

    const id = randomUUID();
    const command: BridgeCommand = { id, method, ...(params ? { params } : {}) };

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Voice bridge request timed out for ${method}.`));
      }, BRIDGE_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.bridgeProcess?.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (!error) {
          return;
        }

        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private async send(method: string, params?: Record<string, unknown>) {
    await this.startIfNeeded();
    return this.sendCommand(method, params);
  }

  getRelayVoiceState(): RelayVoiceState {
    const captureState = this.bridgeStatus?.captureState ?? "off";
    const speaking = this.bridgeStatus?.speaking ?? false;
    const detail =
      this.bridgeStatus?.detail
      ?? (this.repliesEnabled ? "Playback ready." : "Voice playback is off.");

    return {
      captureState,
      captureTitle: captureTitleForState(captureState),
      repliesEnabled: this.repliesEnabled,
      detail,
      isCapturing: isCaptureActive(captureState),
      speaking,
    };
  }

  async setRepliesEnabled(enabled: boolean) {
    if (enabled) {
      await this.send("health");
      this.repliesEnabled = true;
      return;
    }

    if (this.bridgeProcess && !this.bridgeProcess.killed) {
      await this.send("speech.stop");
    }

    this.repliesEnabled = false;
  }

  async toggleCapture() {
    const currentState = this.bridgeStatus?.captureState ?? "off";
    const isActive = isCaptureActive(currentState);

    if (isActive) {
      await this.send("voice.stop");
      return;
    }

    await this.send("voice.start", {
      clientId: "openscout-electron",
    });
  }

  syncRelayPlayback(snapshot: RuntimeRegistrySnapshot) {
    const messages = Object.values(snapshot.messages as Record<string, MessageRecord>)
      .filter((message) => message.metadata?.transportOnly !== "true")
      .sort((left, right) => normalizeTimestamp(left.createdAt) - normalizeTimestamp(right.createdAt));
    const currentIds = new Set(messages.map((message) => message.id));

    if (!this.historySeeded) {
      this.historySeeded = true;
      this.observedMessageIds = currentIds;
      return;
    }

    const newMessages = messages.filter((message) => !this.observedMessageIds.has(message.id));
    this.observedMessageIds = currentIds;

    if (!this.repliesEnabled || newMessages.length === 0) {
      return;
    }

    const conversations = snapshot.conversations as Record<string, ConversationRecord>;
    const newestSpeakableMessage = [...newMessages].reverse().find((message) => {
      const conversation = conversations[message.conversationId];
      const spokenText = spokenTextForMessage(message);
      if (!spokenText) {
        return false;
      }

      if (message.actorId === OPERATOR_ID) {
        return false;
      }

      if (isSystemMessage(message, conversation)) {
        return false;
      }

      return sanitizeRelayBody(message.body).length > 0;
    });

    if (!newestSpeakableMessage) {
      return;
    }

    const spokenText = spokenTextForMessage(newestSpeakableMessage);
    if (!spokenText) {
      return;
    }

    void this.send("speech.speak", {
      text: spokenText,
      ...(newestSpeakableMessage.speech?.voice ? { voice: newestSpeakableMessage.speech.voice } : {}),
    }).catch((error) => {
      this.bridgeStatus = {
        captureState: this.bridgeStatus?.captureState ?? "error",
        speaking: false,
        voxAvailable: this.bridgeStatus?.voxAvailable ?? false,
        oraAvailable: this.bridgeStatus?.oraAvailable ?? false,
        detail: error instanceof Error ? error.message : "Voice playback failed.",
      };
    });
  }

  async shutdown() {
    if (!this.bridgeProcess || this.bridgeProcess.killed) {
      return;
    }

    try {
      await this.send("shutdown");
    } catch {
      this.bridgeProcess.kill("SIGTERM");
    } finally {
      this.bridgeProcess = null;
      this.bridgeReady = false;
    }
  }
}

export const relayVoiceBridgeService = new RelayVoiceBridgeService();
