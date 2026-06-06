import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  StateTracker,
  createAcpAdapter,
  type Adapter,
  type PairingEvent,
  type SessionState,
} from "@openscout/agent-sessions";

export type AcpStdioSessionRequestOptions = {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs: string[];
};

export type AcpStdioInvocationOptions = AcpStdioSessionRequestOptions & {
  prompt: string;
  timeoutMs?: number;
};

export type AcpStdioSessionResult = {
  sessionId: string;
  externalSessionId?: string;
  metadata?: Record<string, unknown>;
};

export type AcpStdioInvocationResult = AcpStdioSessionResult & {
  output: string;
};

export type AcpStdioLaunchOptions = {
  command?: string;
  args: string[];
  protocolVersion?: number;
  sessionId?: string;
  sessionMode?: "auto" | "new" | "resume" | "load";
  authMethodId?: string;
  mcpServers: unknown[];
  additionalDirectories: string[];
  readTextFile: boolean;
  writeTextFile: boolean;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  promptTimeoutMs?: number;
};

const DEFAULT_ACP_STDIO_TIMEOUT_MS = 300_000;
const ACP_STDIO_FLAGS_WITH_VALUES = new Set([
  "--command",
  "--cmd",
  "--acp-command",
  "--arg",
  "--acp-arg",
  "--args-json",
  "--session-id",
  "--session-mode",
  "--auth-method",
  "--auth-method-id",
  "--additional-directory",
  "--add-dir",
  "--mcp-server-json",
  "--protocol-version",
  "--startup-timeout-ms",
  "--request-timeout-ms",
  "--prompt-timeout-ms",
]);

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizePositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readFlagAssignment(value: string): { flag: string; assigned: string } | null {
  const equals = value.indexOf("=");
  if (equals <= 0) {
    return null;
  }
  const flag = value.slice(0, equals);
  if (!ACP_STDIO_FLAGS_WITH_VALUES.has(flag)) {
    return null;
  }
  return { flag, assigned: value.slice(equals + 1) };
}

function readJsonArray(value: string | undefined): unknown[] {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStringJsonArray(value: string | undefined): string[] {
  return readJsonArray(value).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function appendPositional(parsed: AcpStdioLaunchOptions, value: string): void {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return;
  }
  if (!parsed.command && !normalized.startsWith("-")) {
    parsed.command = normalized;
    return;
  }
  parsed.args.push(value);
}

function applyFlagValue(parsed: AcpStdioLaunchOptions, flag: string, rawValue: string | undefined): boolean {
  const value = normalizeOptionalString(rawValue);

  switch (flag) {
    case "--command":
    case "--cmd":
    case "--acp-command":
      if (value) parsed.command = value;
      return true;
    case "--arg":
    case "--acp-arg":
      if (value) parsed.args.push(value);
      return true;
    case "--args-json":
      parsed.args.push(...readStringJsonArray(value));
      return true;
    case "--session-id":
      if (value) parsed.sessionId = value;
      return true;
    case "--session-mode":
      if (value === "auto" || value === "new" || value === "resume" || value === "load") {
        parsed.sessionMode = value;
      }
      return true;
    case "--auth-method":
    case "--auth-method-id":
      if (value) parsed.authMethodId = value;
      return true;
    case "--additional-directory":
    case "--add-dir":
      if (value) parsed.additionalDirectories.push(value);
      return true;
    case "--mcp-server-json": {
      const servers = readJsonArray(value);
      if (servers.length > 0) parsed.mcpServers.push(...servers);
      return true;
    }
    case "--protocol-version":
      {
        const parsedNumber = normalizePositiveInteger(value);
        if (parsedNumber) parsed.protocolVersion = parsedNumber;
      }
      return true;
    case "--startup-timeout-ms":
      {
        const parsedNumber = normalizePositiveInteger(value);
        if (parsedNumber) parsed.startupTimeoutMs = parsedNumber;
      }
      return true;
    case "--request-timeout-ms":
      {
        const parsedNumber = normalizePositiveInteger(value);
        if (parsedNumber) parsed.requestTimeoutMs = parsedNumber;
      }
      return true;
    case "--prompt-timeout-ms":
      {
        const parsedNumber = normalizePositiveInteger(value);
        if (parsedNumber) parsed.promptTimeoutMs = parsedNumber;
      }
      return true;
    default:
      return false;
  }
}

export function parseAcpStdioLaunchArgs(launchArgs: readonly string[]): AcpStdioLaunchOptions {
  const parsed: AcpStdioLaunchOptions = {
    args: [],
    mcpServers: [],
    additionalDirectories: [],
    readTextFile: true,
    writeTextFile: false,
  };

  for (let index = 0; index < launchArgs.length; index += 1) {
    const current = launchArgs[index] ?? "";
    const assignment = readFlagAssignment(current);
    if (assignment) {
      applyFlagValue(parsed, assignment.flag, assignment.assigned);
      continue;
    }

    if (current === "--") {
      const rest = launchArgs.slice(index + 1);
      if (!parsed.command && rest.length > 0) {
        appendPositional(parsed, rest[0] ?? "");
        parsed.args.push(...rest.slice(1));
      } else {
        parsed.args.push(...rest);
      }
      break;
    }

    if (current === "--read-text-file") {
      parsed.readTextFile = true;
      continue;
    }

    if (current === "--no-read-text-file") {
      parsed.readTextFile = false;
      continue;
    }

    if (current === "--write-text-file" || current === "--allow-write-text-file") {
      parsed.writeTextFile = true;
      continue;
    }

    if (current === "--no-write-text-file") {
      parsed.writeTextFile = false;
      continue;
    }

    if (ACP_STDIO_FLAGS_WITH_VALUES.has(current)) {
      applyFlagValue(parsed, current, launchArgs[index + 1]);
      index += 1;
      continue;
    }

    appendPositional(parsed, current);
  }

  return parsed;
}

export function resolveAcpStdioCommand(launchArgs: readonly string[]): string | undefined {
  return parseAcpStdioLaunchArgs(launchArgs).command ?? normalizeOptionalString(process.env.OPENSCOUT_ACP_COMMAND);
}

function isShellCommandAvailable(binary: string): boolean {
  try {
    execFileSync("sh", ["-lc", `command -v ${JSON.stringify(binary)}`], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

export function isAcpStdioCommandAvailable(launchArgs: readonly string[]): boolean {
  const command = resolveAcpStdioCommand(launchArgs);
  if (!command) {
    return false;
  }
  return command.includes("/") ? existsSync(command) : isShellCommandAvailable(command);
}

function extractTurnText(snapshot: SessionState | null, turnId: string): string {
  const turn = snapshot?.turns.find((candidate) => candidate.id === turnId);
  if (!turn) {
    return "";
  }

  const textParts: string[] = [];
  const errorParts: string[] = [];
  for (const blockState of turn.blocks) {
    const block = blockState.block;
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "error") {
      errorParts.push(block.message);
    }
  }

  const text = textParts.join("").trim();
  if (text) {
    return text;
  }
  return errorParts.join("\n").trim();
}

function terminalTurnError(snapshot: SessionState | null, turnId: string): string | null {
  const turn = snapshot?.turns.find((candidate) => candidate.id === turnId);
  if (!turn || turn.status !== "error") {
    return null;
  }
  return extractTurnText(snapshot, turnId) || "ACP stdio turn failed.";
}

function acpProviderMeta(snapshot: SessionState | null): Record<string, unknown> | undefined {
  const acp = snapshot?.session.providerMeta?.acp;
  return acp && typeof acp === "object" && !Array.isArray(acp) ? { ...acp } : undefined;
}

function acpExternalSessionId(snapshot: SessionState | null): string | undefined {
  const sessionId = acpProviderMeta(snapshot)?.acpSessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : undefined;
}

function composeAcpPrompt(systemPrompt: string, prompt: string): string {
  const normalizedSystemPrompt = systemPrompt.trim();
  return normalizedSystemPrompt ? `${normalizedSystemPrompt}\n\n${prompt}` : prompt;
}

class AcpStdioAgentSession {
  private adapter: Adapter | null = null;
  private readonly tracker = new StateTracker();
  private currentRun: Promise<unknown> = Promise.resolve();
  private lastError: Error | null = null;

  constructor(private readonly options: AcpStdioSessionRequestOptions) {}

  get snapshot(): SessionState | null {
    return this.tracker.getSessionState(this.options.sessionId);
  }

  get sessionMetadata(): Record<string, unknown> | undefined {
    const acp = acpProviderMeta(this.snapshot);
    if (!acp) {
      return undefined;
    }
    return {
      transport: "acp_stdio",
      acp,
    };
  }

  get externalSessionId(): string | undefined {
    return acpExternalSessionId(this.snapshot);
  }

  get alive(): boolean {
    const status = this.snapshot?.session.status;
    return Boolean(this.adapter && status !== "closed" && status !== "error");
  }

  async ensureOnline(): Promise<{ sessionId: string; externalSessionId?: string }> {
    if (this.alive) {
      return {
        sessionId: this.options.sessionId,
        ...(this.externalSessionId ? { externalSessionId: this.externalSessionId } : {}),
      };
    }

    await mkdir(this.options.runtimeDirectory, { recursive: true });
    await mkdir(this.options.logsDirectory, { recursive: true });
    await writeFile(join(this.options.runtimeDirectory, "prompt.txt"), this.options.systemPrompt);

    const launch = parseAcpStdioLaunchArgs(this.options.launchArgs);
    const adapter = createAcpAdapter({
      sessionId: this.options.sessionId,
      name: `${this.options.agentName} ACP stdio`,
      cwd: this.options.cwd,
      options: {
        ...launch,
        ...(launch.command ? {} : { command: process.env.OPENSCOUT_ACP_COMMAND }),
      },
    });

    this.adapter = adapter;
    this.lastError = null;
    this.tracker.createSession(this.options.sessionId, adapter.session);
    adapter.on("event", (event) => {
      this.tracker.trackEvent(this.options.sessionId, event);
    });
    adapter.on("error", (error) => {
      this.lastError = error;
      this.tracker.trackEvent(this.options.sessionId, {
        event: "session:update",
        session: {
          ...adapter.session,
          status: "error",
          providerMeta: {
            ...(adapter.session.providerMeta ?? {}),
            acp: {
              ...acpProviderMeta(this.snapshot),
              errorMessage: error.message,
            },
          },
        },
      });
    });

    await adapter.start();
    this.tracker.trackEvent(this.options.sessionId, {
      event: "session:update",
      session: { ...adapter.session },
    });

    return {
      sessionId: this.options.sessionId,
      ...(this.externalSessionId ? { externalSessionId: this.externalSessionId } : {}),
    };
  }

  async invoke(prompt: string, timeoutMs = DEFAULT_ACP_STDIO_TIMEOUT_MS): Promise<string> {
    const run = this.currentRun.then(() => this.invokeNow(prompt, timeoutMs));
    this.currentRun = run.catch(() => undefined);
    return run;
  }

  async shutdown(): Promise<void> {
    const adapter = this.adapter;
    this.adapter = null;
    if (adapter) {
      await adapter.shutdown();
      this.tracker.trackEvent(this.options.sessionId, {
        event: "session:closed",
        sessionId: this.options.sessionId,
      });
    }
  }

  private async invokeNow(prompt: string, timeoutMs: number): Promise<string> {
    await this.ensureOnline();
    const adapter = this.adapter;
    if (!adapter) {
      throw new Error("ACP stdio adapter is not online.");
    }

    return new Promise<string>((resolve, reject) => {
      let turnId: string | null = null;
      let settled = false;
      const cleanup = () => {
        adapter.off("event", onEvent);
        adapter.off("error", onError);
        clearTimeout(timer);
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const onError = (error: Error) => {
        finish(() => reject(error));
      };
      const onEvent = (event: PairingEvent) => {
        if (event.event === "turn:start" && !turnId) {
          turnId = event.turn.id;
          return;
        }
        if (event.event !== "turn:end" || event.turnId !== turnId) {
          return;
        }
        const snapshot = this.snapshot;
        const error = terminalTurnError(snapshot, event.turnId);
        if (error) {
          finish(() => reject(new Error(error)));
          return;
        }
        finish(() => resolve(extractTurnText(snapshot, event.turnId)));
      };
      const timer = setTimeout(() => {
        adapter.interrupt();
        finish(() => reject(new Error(`ACP stdio invocation timed out after ${timeoutMs}ms.`)));
      }, timeoutMs);

      adapter.on("event", onEvent);
      adapter.on("error", onError);

      if (this.lastError) {
        finish(() => reject(this.lastError!));
        return;
      }

      adapter.send({
        sessionId: this.options.sessionId,
        text: composeAcpPrompt(this.options.systemPrompt, prompt),
      });
    });
  }
}

const sessions = new Map<string, AcpStdioAgentSession>();

function sessionKey(options: Pick<AcpStdioSessionRequestOptions, "sessionId">): string {
  return options.sessionId;
}

function getOrCreateSession(options: AcpStdioSessionRequestOptions): AcpStdioAgentSession {
  const key = sessionKey(options);
  const existing = sessions.get(key);
  if (existing) {
    return existing;
  }
  const session = new AcpStdioAgentSession(options);
  sessions.set(key, session);
  return session;
}

export async function ensureAcpStdioAgentOnline(options: AcpStdioSessionRequestOptions): Promise<AcpStdioSessionResult> {
  const session = getOrCreateSession(options);
  const result = await session.ensureOnline();
  return {
    ...result,
    ...(session.sessionMetadata ? { metadata: session.sessionMetadata } : {}),
  };
}

export async function invokeAcpStdioAgent(options: AcpStdioInvocationOptions): Promise<AcpStdioInvocationResult> {
  const session = getOrCreateSession(options);
  const output = await session.invoke(options.prompt, options.timeoutMs);
  return {
    output,
    sessionId: options.sessionId,
    ...(session.externalSessionId ? { externalSessionId: session.externalSessionId } : {}),
    ...(session.sessionMetadata ? { metadata: session.sessionMetadata } : {}),
  };
}

export function getAcpStdioAgentSnapshot(options: Pick<AcpStdioSessionRequestOptions, "sessionId">): SessionState | null {
  return sessions.get(sessionKey(options))?.snapshot ?? null;
}

export function isAcpStdioAgentAlive(options: Pick<AcpStdioSessionRequestOptions, "sessionId">): boolean {
  return sessions.get(sessionKey(options))?.alive ?? false;
}

export async function shutdownAcpStdioAgent(options: Pick<AcpStdioSessionRequestOptions, "sessionId">): Promise<void> {
  const key = sessionKey(options);
  const session = sessions.get(key);
  if (!session) {
    return;
  }
  await session.shutdown();
  sessions.delete(key);
}
