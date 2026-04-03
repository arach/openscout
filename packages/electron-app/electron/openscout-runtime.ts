import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractAgentSelectors,
  resolveAgentSelector,
  type AgentHarness,
  type AgentSelectorCandidate,
} from "@openscout/protocol";

import {
  brokerServiceStatus,
  restartBrokerService,
  startBrokerService,
  stopBrokerService,
} from "../../runtime/src/broker-service.js";
import { loadHarnessCatalogSnapshot } from "../../runtime/src/harness-catalog.js";
import {
  ensureLocalAgentBindingOnline,
  getLocalAgentConfig,
  loadRegisteredLocalAgentBindings,
  restartLocalAgent,
  SUPPORTED_LOCAL_AGENT_HARNESSES,
  updateLocalAgentConfig,
} from "../../runtime/src/local-agents.js";
import {
  ensureScoutRelayAgentConfigured,
  loadResolvedRelayAgents,
  primaryDirectConversationIdForAgent,
  readOpenScoutSettings,
  resolveRelayAgentConfig,
  SCOUT_AGENT_ID,
  type SetupResult,
  writeOpenScoutSettings,
} from "../../runtime/src/setup.js";
import { relayAgentLogsDirectory, relayAgentRuntimeDirectory, resolveOpenScoutSupportPaths } from "../../runtime/src/support-paths.js";
import type { RuntimeRegistrySnapshot } from "../../runtime/src/registry.js";
import { relayVoiceBridgeService } from "./voice-bridge-service.js";
import { telegramBridgeService } from "./telegram-bridge-service.js";

import type {
  AgentSessionInspector,
  AgentConfigState,
  AppSettingsState,
  BrokerControlAction,
  DesktopBrokerInspector,
  DesktopLogCatalog,
  DesktopLogContent,
  DesktopLogSource,
  DesktopAppInfo,
  DesktopMachine,
  DesktopMachineEndpoint,
  DesktopMachineEndpointState,
  DesktopMachinesState,
  DesktopPlan,
  DesktopReconciliationFinding,
  DesktopPlansState,
  DesktopRuntimeState,
  DesktopShellState,
  DesktopTask,
  DesktopTaskStatus,
  PhonePreparationState,
  OnboardingCommandResult,
  RunOnboardingCommandInput,
  RestartAgentInput,
  ReadLogSourceInput,
  RelayDirectThread,
  RelayMessage,
  RelayNavItem,
  RelayState,
  SendRelayMessageInput,
  SessionMetadata,
  UpdateAgentConfigInput,
  UpdateAppSettingsInput,
  UpdatePhonePreparationInput,
} from "../src/lib/openscout-desktop.js";

const OPERATOR_ID = "operator";
const DEFAULT_OPERATOR_DISPLAY_NAME = process.env.OPENSCOUT_OPERATOR_NAME?.trim() || "Arach";
const SHARED_CHANNEL_ID = "channel.shared";
const VOICE_CHANNEL_ID = "channel.voice";
const SYSTEM_CHANNEL_ID = "channel.system";
const BUILT_IN_ROLE_AGENT_IDS = new Set(["scout", "builder", "reviewer", "research"]);
const PROJECT_GIT_ACTIVITY_CACHE_TTL_MS = 30_000;
const RECENT_AGENT_ACTIVITY_WINDOW_SECONDS = 60 * 60 * 24 * 30;
const LOG_TAIL_CHUNK_BYTES = 64 * 1024;
const LOG_CATALOG_CACHE_TTL_MS = 1_500;
const RESOLVED_RELAY_AGENTS_CACHE_TTL_MS = 30_000;
const RECONCILE_OFFLINE_WAIT_SECONDS = 60 * 3;
const RECONCILE_NO_FOLLOW_UP_SECONDS = 60 * 10;
const RECONCILE_STALE_WORKING_SECONDS = 60 * 15;

type LoadResolvedRelayAgentsOptions = NonNullable<Parameters<typeof loadResolvedRelayAgents>[0]>;

type TmuxSession = {
  name: string;
  createdAt: number | null;
};

type BrokerNode = {
  id: string;
};

type ResolvedLogSource = DesktopLogSource & {
  paths: string[];
};

type CachedLogCatalog = {
  expiresAt: number;
  sources: ResolvedLogSource[];
};

let cachedLogCatalog: CachedLogCatalog | null = null;

type CachedResolvedRelayAgents = {
  expiresAt: number;
  promise: Promise<SetupResult> | null;
  value?: SetupResult;
};

const cachedResolvedRelayAgents = new Map<string, CachedResolvedRelayAgents>();

type ActorRecord = {
  id: string;
  displayName?: string;
  handle?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  kind?: string;
};

type AgentRecord = ActorRecord & {
  agentClass?: string;
  capabilities?: string[];
  wakePolicy?: string;
  metadata?: Record<string, unknown>;
};

type EndpointRecord = {
  id: string;
  agentId: string;
  nodeId?: string;
  state?: string;
  transport?: string;
  harness?: string;
  cwd?: string;
  projectRoot?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

type ConversationRecord = {
  id: string;
  kind: string;
  title: string;
  visibility?: string;
  participantIds: string[];
  metadata?: Record<string, unknown>;
};

type MessageRecord = {
  id: string;
  conversationId: string;
  actorId: string;
  originNodeId: string;
  class: string;
  body: string;
  replyToMessageId?: string;
  createdAt: number;
  speech?: {
    text?: string;
    voice?: string;
    interruptible?: boolean;
  };
  audience?: {
    visibleTo?: string[];
    notify?: string[];
    invoke?: string[];
    reason?: string;
  };
  mentions?: Array<{ actorId: string; label?: string }>;
  metadata?: Record<string, unknown>;
};

type ReferencedMessageContext = {
  id: string;
  authorId: string;
  authorName: string;
  conversationId: string;
  conversationTitle: string;
  createdAt: number;
  body: string;
};

type FlightRecord = {
  id: string;
  targetAgentId: string;
  state: string;
  summary?: string;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
};

type DirectAgentActivity = {
  state: RelayDirectThread["state"];
  reachable: boolean;
  statusLabel: string;
  statusDetail: string | null;
  activeTask: string | null;
  lastMessageAt: number | null;
};

type AgentWorkspaceRecord = {
  agentId: string;
  project: string;
  cwd: string;
};

type ProjectGitActivity = {
  lastCodeChangeAt: number | null;
  lastCodeChangeLabel: string | null;
};

const projectGitActivityCache = new Map<string, { cachedAt: number; activity: ProjectGitActivity }>();

type ParsedPlanFrontmatter = {
  attributes: Record<string, string>;
  body: string;
};

function normalizeTimestamp(value: number | null | undefined): number {
  if (!value) return 0;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function isoFromTimestamp(value: number): string {
  return new Date(normalizeTimestamp(value) * 1000).toISOString();
}

function formatTimeLabel(value: number): string {
  const date = new Date(normalizeTimestamp(value) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDayLabel(value: number): string {
  const date = new Date(normalizeTimestamp(value) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(date)
    .toUpperCase();
}

function formatRelativeTime(value: number): string {
  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - normalizeTimestamp(value));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function formatDateTimeLabel(value: number | null | undefined): string | null {
  const normalized = normalizeTimestamp(value);
  if (!normalized) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(normalized * 1000));
}

function compactHomePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const home = homedir();
  return value.startsWith(home) ? value.replace(home, "~") : value;
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function logSectionLabel(filePath: string): string {
  return path.basename(filePath);
}

function readJsonField(filePath: string, field: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const value = payload[field];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function runtimeVersionLabel(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "packages", "runtime", "package.json"),
    path.resolve(process.cwd(), "package.json"),
  ];

  for (const candidate of candidates) {
    const version = readJsonField(candidate, "version");
    if (version) {
      return version;
    }
  }

  return null;
}

function runOptionalCommand(command: string, args: string[]): string | null {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function readProjectGitActivity(projectRoot: string | null | undefined): ProjectGitActivity {
  if (!projectRoot) {
    return {
      lastCodeChangeAt: null,
      lastCodeChangeLabel: null,
    };
  }

  const normalizedRoot = path.resolve(projectRoot);
  const cached = projectGitActivityCache.get(normalizedRoot);
  if (cached && Date.now() - cached.cachedAt < PROJECT_GIT_ACTIVITY_CACHE_TTL_MS) {
    return cached.activity;
  }

  const rawTimestamp = runOptionalCommand("git", ["-C", normalizedRoot, "log", "-1", "--format=%ct"]);
  const parsedTimestamp = Number.parseInt(rawTimestamp ?? "", 10);
  const lastCodeChangeAt = Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
    ? normalizeTimestamp(parsedTimestamp)
    : null;
  const activity = {
    lastCodeChangeAt,
    lastCodeChangeLabel: lastCodeChangeAt ? formatRelativeTime(lastCodeChangeAt) : null,
  } satisfies ProjectGitActivity;
  projectGitActivityCache.set(normalizedRoot, {
    cachedAt: Date.now(),
    activity,
  });
  return activity;
}

function visibleRelayAgentIds(
  snapshot: RuntimeRegistrySnapshot,
  configuredAgentIds: Set<string>,
  messagesByConversation: Map<string, MessageRecord[]>,
  directActivity: Map<string, DirectAgentActivity>,
) {
  const visible = new Set<string>([
    ...configuredAgentIds,
    ...Array.from(BUILT_IN_ROLE_AGENT_IDS),
  ]);
  const cutoff = Math.floor(Date.now() / 1000) - RECENT_AGENT_ACTIVITY_WINDOW_SECONDS;
  const conversationsById = snapshot.conversations as Record<string, ConversationRecord>;

  for (const [agentId, activity] of directActivity.entries()) {
    if (activity.reachable || activity.state === "working" || (activity.lastMessageAt ?? 0) >= cutoff) {
      visible.add(agentId);
    }
  }

  for (const endpoint of Object.values(snapshot.endpoints as Record<string, EndpointRecord>)) {
    if (endpoint.state && endpoint.state !== "offline") {
      visible.add(endpoint.agentId);
    }
  }

  for (const conversation of Object.values(conversationsById)) {
    const messages = messagesByConversation.get(conversation.id) ?? [];
    const latestMessage = messages.at(-1);
    if (!latestMessage || normalizeTimestamp(latestMessage.createdAt) < cutoff) {
      continue;
    }

    if (isInterAgentConversation(snapshot, conversation)) {
      for (const participantId of conversation.participantIds) {
        if ((snapshot.agents as Record<string, AgentRecord>)[participantId]) {
          visible.add(participantId);
        }
      }
      continue;
    }

    for (const message of messages) {
      if (normalizeTimestamp(message.createdAt) < cutoff || !isKnownCounterpart(snapshot, message.actorId)) {
        continue;
      }
      const recipients = inferRecipients(message, conversation)
        .filter((recipientId) => recipientId !== OPERATOR_ID && recipientId !== message.actorId)
        .filter((recipientId) => isKnownCounterpart(snapshot, recipientId));
      const participantIds = interAgentParticipantIds(snapshot, [message.actorId, ...recipients]);
      if (participantIds.length >= 2 && participantIds.length <= 3) {
        for (const participantId of participantIds) {
          if (isKnownVisibleAgent(snapshot, participantId)) {
            visible.add(participantId);
          }
        }
      }
    }
  }

  return visible;
}

function resolveBrokerProcessId(brokerUrl: string, fallbackPid: number | null): number | null {
  if (fallbackPid && Number.isFinite(fallbackPid)) {
    return fallbackPid;
  }

  try {
    const port = new URL(brokerUrl).port;
    if (!port) {
      return null;
    }
    const output = runOptionalCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    const pid = Number.parseInt(output?.split(/\s+/g)[0] ?? "", 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function formatProcessStartLabel(pid: number | null): string | null {
  if (!pid) {
    return null;
  }

  const raw = runOptionalCommand("ps", ["-p", String(pid), "-o", "lstart="]);
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatRelativeTime(Math.floor(parsed.getTime() / 1000));
  }

  return raw;
}

function readProcessCommand(pid: number | null): string | null {
  if (!pid) {
    return null;
  }

  return runOptionalCommand("ps", ["-p", String(pid), "-o", "command="]);
}

function brokerStatusLabel(status: Awaited<ReturnType<typeof brokerServiceStatus>>): { label: string; detail: string | null } {
  if (status.reachable && status.health.ok) {
    return {
      label: "Running",
      detail: `Broker is responding at ${status.brokerUrl}.`,
    };
  }
  if (status.loaded) {
    return {
      label: "Starting",
      detail: "LaunchAgent is loaded, but the broker health endpoint is not responding yet.",
    };
  }
  if (status.installed) {
    return {
      label: "Installed",
      detail: "LaunchAgent exists on disk, but it is not currently loaded.",
    };
  }
  return {
    label: "Missing",
    detail: "No LaunchAgent is installed for the broker yet.",
  };
}

function brokerTroubleshootingHints(status: Awaited<ReturnType<typeof brokerServiceStatus>>): string[] {
  const hints: string[] = [];

  if (!status.installed) {
    hints.push("The broker LaunchAgent is not installed.");
  }
  if (status.installed && !status.loaded) {
    hints.push("The LaunchAgent exists but is not loaded.");
  }
  if (status.loaded && !status.reachable) {
    hints.push("launchd reports the service as loaded, but the broker health endpoint is not responding.");
  }
  if (status.lastExitStatus !== null && status.lastExitStatus !== 0) {
    hints.push(`The last broker exit status was ${status.lastExitStatus}.`);
  }
  if (status.lastLogLine) {
    hints.push(`Last broker log line: ${status.lastLogLine}`);
  }

  return hints;
}

function brokerFeedbackSummary(
  status: Awaited<ReturnType<typeof brokerServiceStatus>>,
  processId: number | null,
  processCommand: string | null,
  startedLabel: string | null,
  version: string | null,
): string {
  const counts = status.health.counts;
  return [
    `status: ${status.reachable ? "reachable" : "unreachable"}`,
    `label: ${status.label}`,
    `mode: ${status.mode}`,
    `version: ${version ?? "not reported"}`,
    `url: ${status.brokerUrl}`,
    `pid: ${processId ?? "not reported"}`,
    `started: ${startedLabel ?? "not reported"}`,
    `launchd: ${status.launchdState ?? "not reported"}`,
    `last_exit: ${status.lastExitStatus ?? "not reported"}`,
    `node: ${status.health.nodeId ?? "not reported"}`,
    `mesh: ${status.health.meshId ?? "not reported"}`,
    `counts: actors=${counts?.actors ?? "?"} agents=${counts?.agents ?? "?"} conversations=${counts?.conversations ?? "?"} messages=${counts?.messages ?? "?"} flights=${counts?.flights ?? "?"}`,
    `command: ${processCommand ?? "not reported"}`,
    `stdout: ${compactHomePath(status.stdoutLogPath) ?? status.stdoutLogPath}`,
    `stderr: ${compactHomePath(status.stderrLogPath) ?? status.stderrLogPath}`,
    `last_log: ${status.lastLogLine ?? "not reported"}`,
  ].join("\n");
}

function resolvedRelayAgentsCacheKey(options: LoadResolvedRelayAgentsOptions): string {
  return JSON.stringify({
    currentDirectory: options.currentDirectory ?? desktopCurrentDirectory(),
    ensureCurrentProjectConfig: Boolean(options.ensureCurrentProjectConfig),
    syncLegacyMirror: Boolean(options.syncLegacyMirror),
  });
}

function invalidateResolvedRelayAgentsCache(): void {
  cachedResolvedRelayAgents.clear();
}

async function readResolvedRelayAgents(
  options: LoadResolvedRelayAgentsOptions = {},
  cacheOptions: {
    force?: boolean;
    ttlMs?: number;
  } = {},
): Promise<SetupResult> {
  const normalizedOptions: LoadResolvedRelayAgentsOptions = {
    ...options,
    currentDirectory: options.currentDirectory ?? desktopCurrentDirectory(),
  };
  const cacheKey = resolvedRelayAgentsCacheKey(normalizedOptions);
  const ttlMs = cacheOptions.ttlMs ?? RESOLVED_RELAY_AGENTS_CACHE_TTL_MS;
  const existing = cachedResolvedRelayAgents.get(cacheKey);
  const now = Date.now();

  if (!cacheOptions.force) {
    if (existing?.value && existing.expiresAt > now) {
      return existing.value;
    }
    if (existing?.promise) {
      return existing.promise;
    }
  }

  const loadPromise = loadResolvedRelayAgents(normalizedOptions)
    .then((value) => {
      cachedResolvedRelayAgents.set(cacheKey, {
        value,
        expiresAt: Date.now() + ttlMs,
        promise: null,
      });
      return value;
    })
    .catch((error) => {
      if (existing?.value && !cacheOptions.force) {
        cachedResolvedRelayAgents.set(cacheKey, {
          value: existing.value,
          expiresAt: Date.now() + Math.min(ttlMs, 5_000),
          promise: null,
        });
        return existing.value;
      }

      const current = cachedResolvedRelayAgents.get(cacheKey);
      if (current?.promise === loadPromise) {
        cachedResolvedRelayAgents.delete(cacheKey);
      }
      throw error;
    });

  cachedResolvedRelayAgents.set(cacheKey, {
    value: existing?.value,
    expiresAt: existing?.expiresAt ?? 0,
    promise: loadPromise,
  });

  return loadPromise;
}

async function buildResolvedLogCatalog(): Promise<ResolvedLogSource[]> {
  if (cachedLogCatalog && cachedLogCatalog.expiresAt > Date.now()) {
    return cachedLogCatalog.sources;
  }

  const supportPaths = resolveOpenScoutSupportPaths();
  const setup = await readResolvedRelayAgents();

  const sources: ResolvedLogSource[] = [
    {
      id: "broker",
      title: "Relay Runtime",
      subtitle: "Relay service stdout and stderr",
      group: "runtime",
      pathLabel: compactHomePath(supportPaths.brokerLogsDirectory) ?? supportPaths.brokerLogsDirectory,
      paths: [
        path.join(supportPaths.brokerLogsDirectory, "stdout.log"),
        path.join(supportPaths.brokerLogsDirectory, "stderr.log"),
      ],
    },
    {
      id: "app",
      title: "Desktop App",
      subtitle: "Electron and local app logs",
      group: "app",
      pathLabel: compactHomePath(supportPaths.appLogsDirectory) ?? supportPaths.appLogsDirectory,
      paths: [
        path.join(supportPaths.appLogsDirectory, "electron.log"),
        path.join(supportPaths.appLogsDirectory, "native.log"),
        path.join(supportPaths.appLogsDirectory, "agent-host.log"),
      ],
    },
  ];

  for (const agent of setup.agents.slice().sort((lhs, rhs) => lhs.displayName.localeCompare(rhs.displayName))) {
    const logsDirectory = relayAgentLogsDirectory(agent.agentId);
    sources.push({
      id: `agent:${agent.agentId}`,
      title: agent.displayName,
      subtitle: "Relay agent runtime logs",
      group: "agents",
      pathLabel: compactHomePath(logsDirectory) ?? logsDirectory,
      paths: [
        path.join(logsDirectory, "stdout.log"),
        path.join(logsDirectory, "stderr.log"),
      ],
    });
  }

  cachedLogCatalog = {
    expiresAt: Date.now() + LOG_CATALOG_CACHE_TTL_MS,
    sources,
  };
  return sources;
}

async function tailLogSource(source: ResolvedLogSource, tailLines = 240): Promise<DesktopLogContent> {
  const sections: string[] = [];
  let updatedAtMs = 0;
  let lineCount = 0;
  let truncated = false;
  let foundAny = false;

  for (const filePath of source.paths) {
    if (!existsSync(filePath)) {
      continue;
    }

    foundAny = true;
    const content = await readVisibleLogFile(filePath, tailLines);
    updatedAtMs = Math.max(updatedAtMs, content.updatedAtMs);
    lineCount += content.lines.length;
    truncated = truncated || content.truncated;
    sections.push(`== ${logSectionLabel(filePath)} ==`);
    sections.push(content.lines.join("\n") || "(empty)");
  }

  return {
    sourceId: source.id,
    title: source.title,
    subtitle: source.subtitle,
    pathLabel: source.pathLabel,
    body: foundAny ? sections.join("\n\n") : "",
    updatedAtLabel: updatedAtMs > 0 ? formatRelativeTime(updatedAtMs) : null,
    lineCount,
    truncated,
    missing: !foundAny,
  };
}

function captureTmuxPane(sessionId: string, tailLines: number): {
  body: string;
  lineCount: number;
  truncated: boolean;
  missing: boolean;
} {
  const output = runOptionalCommand("tmux", [
    "capture-pane",
    "-p",
    "-t",
    sessionId,
    "-S",
    `-${Math.max(tailLines, 40)}`,
  ]);
  if (output === null) {
    return {
      body: "",
      lineCount: 0,
      truncated: false,
      missing: true,
    };
  }

  const lines = splitLogLines(output);
  const visibleLines = lines.length > tailLines ? lines.slice(-tailLines) : lines;
  return {
    body: visibleLines.join("\n"),
    lineCount: visibleLines.length,
    truncated: lines.length > tailLines,
    missing: false,
  };
}

async function readAgentSessionLogs(agentId: string, tailLines: number): Promise<{
  body: string;
  pathLabel: string;
  updatedAtLabel: string | null;
  lineCount: number;
  truncated: boolean;
  missing: boolean;
}> {
  const logsDirectory = relayAgentLogsDirectory(agentId);
  const sources = [
    path.join(logsDirectory, "stdout.log"),
    path.join(logsDirectory, "stderr.log"),
  ];
  const sections: string[] = [];
  let updatedAtMs = 0;
  let lineCount = 0;
  let truncated = false;
  let foundAny = false;

  for (const filePath of sources) {
    if (!existsSync(filePath)) {
      continue;
    }

    foundAny = true;
    const content = await readVisibleLogFile(filePath, tailLines);
    updatedAtMs = Math.max(updatedAtMs, content.updatedAtMs);
    lineCount += content.lines.length;
    truncated = truncated || content.truncated;
    sections.push(`== ${logSectionLabel(filePath)} ==`);
    sections.push(content.lines.join("\n") || "(empty)");
  }

  return {
    body: foundAny ? sections.join("\n\n") : "",
    pathLabel: compactHomePath(logsDirectory) ?? logsDirectory,
    updatedAtLabel: updatedAtMs > 0 ? formatRelativeTime(updatedAtMs) : null,
    lineCount,
    truncated,
    missing: !foundAny,
  };
}

async function readVisibleLogFile(filePath: string, tailLines: number): Promise<{
  lines: string[];
  updatedAtMs: number;
  truncated: boolean;
}> {
  const file = await open(filePath, "r");
  try {
    const stats = await file.stat();
    if (tailLines <= 0 || stats.size <= 0) {
      const raw = stats.size > 0 ? await file.readFile({ encoding: "utf8" }) : "";
      return {
        lines: splitLogLines(raw),
        updatedAtMs: stats.mtimeMs,
        truncated: false,
      };
    }

    let position = stats.size;
    let newlineCount = 0;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    while (position > 0 && newlineCount <= tailLines) {
      const readSize = Math.min(LOG_TAIL_CHUNK_BYTES, position);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      const { bytesRead } = await file.read(buffer, 0, readSize, position);
      if (bytesRead <= 0) {
        break;
      }
      const chunk = buffer.subarray(0, bytesRead);
      chunks.unshift(chunk);
      totalBytes += bytesRead;
      for (const byte of chunk) {
        if (byte === 10) {
          newlineCount += 1;
        }
      }
    }

    const raw = Buffer.concat(chunks, totalBytes).toString("utf8");
    const lines = splitLogLines(raw);
    return {
      lines: lines.length > tailLines ? lines.slice(-tailLines) : lines,
      updatedAtMs: stats.mtimeMs,
      truncated: position > 0 || lines.length > tailLines,
    };
  } finally {
    await file.close();
  }
}

function splitLogLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function splitDelimitedTokens(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isReachableEndpointState(state: string | undefined): boolean {
  return state === "active" || state === "idle" || state === "waiting";
}

function isWorkingFlightState(state: string | undefined): boolean {
  return state === "queued" || state === "waking" || state === "running" || state === "waiting";
}

function directConversationId(agentId: string): string {
  return `dm.${OPERATOR_ID}.${agentId}`;
}

function flightMetadataString(flight: FlightRecord | null | undefined, key: string): string | null {
  const value = flight?.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function colorForIdentity(identity: string) {
  const palette = ["#3b82f6", "#14b8a6", "#fb923c", "#f43f5e", "#8b5cf6", "#10b981"];
  let seed = 0;
  for (const character of identity) {
    seed += character.charCodeAt(0);
  }
  return palette[seed % palette.length];
}

type DesktopSettingsRecord = {
  operatorName?: string;
  profile?: {
    operatorName?: string;
  };
};

function openScoutSupportDirectory(): string {
  return resolveOpenScoutSupportPaths().supportDirectory;
}

function desktopSettingsPath(): string {
  return resolveOpenScoutSupportPaths().settingsPath;
}

function desktopCurrentDirectory(): string {
  return process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();
}

function desktopRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function desktopCliEntrypoint(): string {
  return path.join(desktopRepoRoot(), "packages", "cli", "src", "main.ts");
}

function normalizeOperatorName(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || DEFAULT_OPERATOR_DISPLAY_NAME;
}

function readDesktopSettingsRecord(): DesktopSettingsRecord {
  try {
    const raw = JSON.parse(readFileSync(desktopSettingsPath(), "utf8")) as DesktopSettingsRecord;
    return raw ?? {};
  } catch {
    return {};
  }
}

function resolveOperatorDisplayName(): string {
  const record = readDesktopSettingsRecord();
  return normalizeOperatorName(record.profile?.operatorName ?? record.operatorName);
}

async function readRegisteredAgentWorkspaces(): Promise<AgentWorkspaceRecord[]> {
  try {
    const setup = await readResolvedRelayAgents({
      currentDirectory: desktopCurrentDirectory(),
      ensureCurrentProjectConfig: true,
    });
    const records = [...setup.agents, ...setup.discoveredAgents]
      .map((agent) => {
        const cwd = agent.runtime.cwd?.trim() || agent.projectRoot?.trim();
        if (!cwd) {
          return null;
        }

        const resolvedCwd = path.resolve(expandHomePath(cwd));
        return {
          agentId: agent.agentId,
          project: agent.projectName.trim() || path.basename(resolvedCwd),
          cwd: resolvedCwd,
        } satisfies AgentWorkspaceRecord;
      })
      .filter((entry): entry is AgentWorkspaceRecord => Boolean(entry));

    return Array.from(
      records.reduce((map, entry) => map.set(entry.cwd, entry), new Map<string, AgentWorkspaceRecord>()).values(),
    );
  } catch {
    return [];
  }
}

async function walkMarkdownFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkMarkdownFiles(fullPath)));
        continue;
      }

      if (entry.isFile() && fullPath.endsWith(".md")) {
        files.push(fullPath);
      }
    }

    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function parsePlanFrontmatter(source: string): ParsedPlanFrontmatter {
  const normalized = source.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return { attributes: {}, body: normalized.trim() };
  }

  const endOfFrontmatter = normalized.indexOf("\n---\n", 4);
  if (endOfFrontmatter === -1) {
    return { attributes: {}, body: normalized.trim() };
  }

  const rawAttributes = normalized.slice(4, endOfFrontmatter).trim();
  const body = normalized.slice(endOfFrontmatter + 5).trim();
  const attributes: Record<string, string> = {};

  for (const line of rawAttributes.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    attributes[match[1].trim().toLowerCase()] = match[2].trim();
  }

  return { attributes, body };
}

function parsePlanStatus(value: string | undefined): DesktopPlan["status"] {
  switch (value) {
    case "awaiting-review":
    case "in-progress":
    case "completed":
    case "paused":
    case "draft":
      return value;
    default:
      return "draft";
  }
}

function extractPlanTitle(attributes: Record<string, string>, body: string, slug: string): string {
  if (attributes.title) {
    return attributes.title;
  }

  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) {
    return heading[1].trim();
  }

  return slug
    .split("-")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function extractPlanSummary(attributes: Record<string, string>, body: string): string {
  if (attributes.summary) {
    return attributes.summary;
  }

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (
      trimmed.startsWith("#")
      || trimmed.startsWith("- ")
      || trimmed.startsWith("* ")
      || trimmed.startsWith(">")
      || /^\d+\.\s/.test(trimmed)
    ) {
      continue;
    }

    return trimmed;
  }

  return "No summary yet.";
}

function resolvePlanAgentId(attributes: Record<string, string>, fallback: string): string {
  return attributes.agentid || attributes["agent-id"] || fallback;
}

function countPlanChecklistItems(markdown: string): { stepsCompleted: number; stepsTotal: number } {
  let stepsCompleted = 0;
  let stepsTotal = 0;

  for (const line of markdown.split("\n")) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+/);
    if (!match) {
      continue;
    }

    stepsTotal += 1;
    if (match[1].toLowerCase() === "x") {
      stepsCompleted += 1;
    }
  }

  return { stepsCompleted, stepsTotal };
}

function parsePlanTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function loadWorkspacePlans(snapshot: RuntimeRegistrySnapshot | null): Promise<DesktopPlan[]> {
  const workspaces = new Map<string, AgentWorkspaceRecord>();

  for (const workspace of await readRegisteredAgentWorkspaces()) {
    workspaces.set(workspace.cwd, workspace);
  }

  if (snapshot) {
    for (const endpoint of Object.values(snapshot.endpoints as Record<string, EndpointRecord>)) {
      const cwd = endpoint.projectRoot ?? endpoint.cwd;
      if (!cwd) {
        continue;
      }

      const resolvedCwd = path.resolve(cwd);
      workspaces.set(resolvedCwd, {
        agentId: endpoint.agentId,
        project: String(endpoint.metadata?.project ?? path.basename(resolvedCwd)),
        cwd: resolvedCwd,
      });
    }
  }

  const plans = (
    await Promise.all(
      Array.from(workspaces.values()).map(async (workspace) => {
        const planFiles = (
          await Promise.all([
            walkMarkdownFiles(path.join(workspace.cwd, "plans")),
            walkMarkdownFiles(path.join(workspace.cwd, ".openscout", "plans")),
          ])
        ).flat();

        return Promise.all(
          planFiles.map(async (filePath) => {
            const [source, fileStats] = await Promise.all([
              readFile(filePath, "utf8"),
              stat(filePath),
            ]);
            const { attributes, body } = parsePlanFrontmatter(source);
            const slug = path.basename(filePath, ".md");
            const { stepsCompleted, stepsTotal } = countPlanChecklistItems(body);
            const updatedAt = attributes.updated && !Number.isNaN(Date.parse(attributes.updated))
              ? new Date(attributes.updated).toISOString()
              : fileStats.mtime.toISOString();

            return {
              id: attributes.id || slug.toUpperCase(),
              title: extractPlanTitle(attributes, body, slug),
              summary: extractPlanSummary(attributes, body),
              status: parsePlanStatus(attributes.status),
              stepsCompleted,
              stepsTotal,
              progressPercent: stepsTotal > 0 ? Math.round((stepsCompleted / stepsTotal) * 100) : 0,
              tags: parsePlanTags(attributes.tags),
              agentId: resolvePlanAgentId(attributes, workspace.agentId),
              agent: attributes.agent || workspace.project,
              workspaceName: workspace.project,
              workspacePath: compactHomePath(workspace.cwd) ?? workspace.cwd,
              path: compactHomePath(filePath) ?? filePath,
              updatedAt,
              updatedAtLabel: formatDateTimeLabel(Math.floor(Date.parse(updatedAt) / 1000)) ?? "Unknown",
            } satisfies DesktopPlan;
          }),
        );
      }),
    )
  )
    .flat()
    .sort((lhs, rhs) => Date.parse(rhs.updatedAt) - Date.parse(lhs.updatedAt) || lhs.title.localeCompare(rhs.title));

  return plans;
}

function readHelperStatus() {
  const statusPath = resolveOpenScoutSupportPaths().desktopStatusPath;
  if (!existsSync(statusPath)) {
    return {
      running: false,
      detail: null,
      heartbeatLabel: null,
    };
  }

  try {
    const raw = JSON.parse(readFileSync(statusPath, "utf8")) as {
      state?: string;
      detail?: string;
      heartbeat?: number;
    };
    const running = raw.state === "running";
    const heartbeatLabel = raw.heartbeat ? formatTimeLabel(raw.heartbeat) : null;
    return {
      running,
      detail: raw.detail ?? null,
      heartbeatLabel,
    };
  } catch {
    return {
      running: false,
      detail: "Helper status unreadable.",
      heartbeatLabel: null,
    };
  }
}

function readTmuxSessions(): TmuxSession[] {
  try {
    const stdout = execFileSync("tmux", ["ls", "-F", "#{session_name}\t#{session_created}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, createdAtRaw] = line.split("\t");
        return {
          name,
          createdAt: createdAtRaw ? Number.parseInt(createdAtRaw, 10) : null,
        };
      });
  } catch {
    return [];
  }
}

async function brokerGet<T>(baseUrl: string, pathname: string): Promise<T | null> {
  try {
    const response = await fetch(new URL(pathname, baseUrl), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function brokerPost<T>(baseUrl: string, pathname: string, body: unknown): Promise<T | null> {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `${pathname} returned ${response.status}`);
  }

  return (await response.json()) as T;
}

async function readSnapshot(baseUrl: string): Promise<RuntimeRegistrySnapshot | null> {
  return brokerGet<RuntimeRegistrySnapshot>(baseUrl, "/v1/snapshot");
}

async function readNode(baseUrl: string): Promise<BrokerNode | null> {
  return brokerGet<BrokerNode>(baseUrl, "/v1/node");
}

async function readLiveBrokerState(status: Awaited<ReturnType<typeof brokerServiceStatus>>) {
  const [snapshot, node] = await Promise.all([
    readSnapshot(status.brokerUrl),
    readNode(status.brokerUrl),
  ]);
  const snapshotReachable = Boolean(snapshot);

  if (!snapshotReachable || status.reachable) {
    return { snapshot, node, status };
  }

  return {
    snapshot,
    node,
    status: {
      ...status,
      reachable: true,
      loaded: status.loaded || Boolean(snapshot),
      health: {
        ...status.health,
        reachable: true,
        ok: true,
        error: undefined,
        nodeId: status.health.nodeId ?? node?.id,
      },
    },
  };
}

function actorDisplayName(snapshot: RuntimeRegistrySnapshot, actorId: string): string {
  if (actorId === OPERATOR_ID) {
    return resolveOperatorDisplayName();
  }
  const agent = snapshot.agents[actorId] as AgentRecord | undefined;
  if (agent?.displayName) return agent.displayName;
  const actor = snapshot.actors[actorId] as ActorRecord | undefined;
  if (actor?.displayName) return actor.displayName;
  return actorId;
}

function actorRole(snapshot: RuntimeRegistrySnapshot, actorId: string): string | null {
  const agent = snapshot.agents[actorId] as AgentRecord | undefined;
  const role = agent?.metadata?.role;
  return typeof role === "string" ? role : null;
}

function activeEndpoint(snapshot: RuntimeRegistrySnapshot, actorId: string): EndpointRecord | null {
  const candidates = Object.values(snapshot.endpoints as Record<string, EndpointRecord>).filter(
    (endpoint) => endpoint.agentId === actorId,
  );
  const rank = (state: string | undefined) => {
    switch (state) {
      case "active":
        return 0;
      case "idle":
        return 1;
      case "waiting":
        return 2;
      case "degraded":
        return 3;
      case "offline":
        return 5;
      default:
        return 4;
    }
  };

  return [...candidates].sort((lhs, rhs) => rank(lhs.state) - rank(rhs.state))[0] ?? null;
}

function inferRecipients(message: MessageRecord, conversation: ConversationRecord | undefined): string[] {
  const fromAudience = [
    ...(message.audience?.notify ?? []),
    ...(message.audience?.invoke ?? []),
    ...(message.mentions?.map((mention) => mention.actorId) ?? []),
  ];

  if (fromAudience.length > 0) {
    return Array.from(new Set(fromAudience)).filter((recipient) => recipient !== message.actorId);
  }

  if (!conversation) {
    return [];
  }

  return conversation.participantIds.filter((participant) => participant !== message.actorId);
}

function normalizedChannel(conversation: ConversationRecord | undefined): string | null {
  if (!conversation) return null;
  if (conversation.id.startsWith("channel.")) {
    return conversation.id.replace(/^channel\./, "");
  }
  return null;
}

function sanitizeRelayBody(body: string): string {
  return body
    .replace(/\[ask:[^\]]+\]\s*/g, "")
    .replace(/\[speak\]\s*/gi, "")
    .replace(/^(@[\w.-]+\s+)+/g, "")
    .trim();
}

function normalizeMessageReferenceIds(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value.map((entry) => String(entry).trim()).filter(Boolean),
  ));
}

function referencedMessageContext(
  snapshot: RuntimeRegistrySnapshot,
  messageId: string,
): ReferencedMessageContext | null {
  const message = (snapshot.messages as Record<string, MessageRecord>)[messageId];
  if (!message) {
    return null;
  }

  const conversation = (snapshot.conversations as Record<string, ConversationRecord>)[message.conversationId];
  return {
    id: message.id,
    authorId: message.actorId,
    authorName: actorDisplayName(snapshot, message.actorId),
    conversationId: message.conversationId,
    conversationTitle: conversation?.title ?? message.conversationId,
    createdAt: normalizeTimestamp(message.createdAt),
    body: sanitizeRelayBody(message.body),
  };
}

function formatReferencedMessageContext(reference: ReferencedMessageContext): string {
  const normalizedRef = reference.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const shortRef = `m:${normalizedRef.slice(-7) || normalizedRef.slice(0, 7) || "message"}`;
  const body = reference.body.length > 280
    ? `${reference.body.slice(0, 279).trimEnd()}…`
    : reference.body;
  return [
    `[${shortRef}] ${reference.authorName}`,
    `Conversation: ${reference.conversationTitle} (${reference.conversationId})`,
    `At: ${formatTimeLabel(reference.createdAt)}`,
    `Body: ${body || "[no text]"}`,
  ].join("\n");
}

function spokenTextForMessage(message: MessageRecord): string | null {
  const explicitSpeech = message.speech?.text?.trim();
  if (explicitSpeech) {
    return explicitSpeech;
  }

  const taggedSpeech = message.body.match(/^\[speak\]\s*([\s\S]+)$/i)?.[1]?.trim();
  return taggedSpeech || null;
}

function buildMessagesByConversation(snapshot: RuntimeRegistrySnapshot): Map<string, MessageRecord[]> {
  const messagesByConversation = new Map<string, MessageRecord[]>();

  for (const message of Object.values(snapshot.messages as Record<string, MessageRecord>)) {
    if (message.metadata?.transportOnly === "true") {
      continue;
    }

    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  for (const bucket of messagesByConversation.values()) {
    bucket.sort((lhs, rhs) => normalizeTimestamp(lhs.createdAt) - normalizeTimestamp(rhs.createdAt));
  }

  return messagesByConversation;
}

function buildDirectAgentActivity(
  snapshot: RuntimeRegistrySnapshot,
  tmuxSessions: TmuxSession[],
  messagesByConversation: Map<string, MessageRecord[]>,
): Map<string, DirectAgentActivity> {
  const tmuxSet = new Set(tmuxSessions.map((session) => session.name));
  const flights = Object.values(snapshot.flights as Record<string, FlightRecord>);
  const activity = new Map<string, DirectAgentActivity>();

  for (const agent of Object.values(snapshot.agents as Record<string, AgentRecord>)) {
    const endpoint = activeEndpoint(snapshot, agent.id);
    const endpointSessionId =
      endpoint?.sessionId
      ?? (typeof endpoint?.metadata?.tmuxSession === "string" ? String(endpoint.metadata.tmuxSession) : null);
    const tmuxReachable = endpointSessionId ? tmuxSet.has(endpointSessionId) : false;
    const reachable =
      (endpoint?.transport === "tmux"
        ? tmuxReachable
        : Boolean(endpoint && isReachableEndpointState(endpoint.state)))
      || tmuxSet.has(`relay-${agent.id}`);
    const latestMessage = (messagesByConversation.get(directConversationId(agent.id)) ?? []).at(-1) ?? null;
    const lastMessageAt = latestMessage ? normalizeTimestamp(latestMessage.createdAt) : null;
    const degradedReason =
      typeof endpoint?.metadata?.lastError === "string"
        ? String(endpoint.metadata.lastError)
        : null;
    const activeFlight =
      flights
        .filter((flight) => flight.targetAgentId === agent.id && isWorkingFlightState(flight.state))
        .sort(
          (lhs, rhs) =>
            normalizeTimestamp(rhs.startedAt ?? rhs.completedAt ?? 0) -
            normalizeTimestamp(lhs.startedAt ?? lhs.completedAt ?? 0),
        )[0] ?? null;

    const activeTaskSummary =
      sanitizeRelayBody(
        activeFlight?.summary?.trim()
        || flightMetadataString(activeFlight, "task")
        || "Working on your latest message.",
      ) || null;
    const activeTask =
      activeTaskSummary && /is working\.?$/i.test(activeTaskSummary)
        ? null
        : activeTaskSummary;

    if (activeFlight) {
      activity.set(agent.id, {
        state: "working",
        reachable: true,
        statusLabel: "Working",
        statusDetail: activeTask ?? null,
        activeTask,
        lastMessageAt,
      });
      continue;
    }

    if (reachable) {
      activity.set(agent.id, {
        state: "available",
        reachable,
        statusLabel: "Available",
        statusDetail: latestMessage ? `Last activity ${formatRelativeTime(latestMessage.createdAt)}` : "Ready for a direct message.",
        activeTask: null,
        lastMessageAt,
      });
      continue;
    }

    activity.set(agent.id, {
      state: "offline",
      reachable: false,
      statusLabel: "Offline",
      statusDetail:
        degradedReason && degradedReason.includes("tmux session missing")
          ? "Relay session is not running."
          : latestMessage
            ? `Last activity ${formatRelativeTime(latestMessage.createdAt)}`
            : "No active endpoint detected.",
      activeTask: null,
      lastMessageAt,
    });
  }

  return activity;
}

function machineEndpointState(
  endpoint: EndpointRecord,
  activity: DirectAgentActivity | undefined,
): DesktopMachineEndpointState {
  if (activity?.state === "working" || endpoint.state === "active") {
    return "running";
  }

  if (endpoint.state === "idle") {
    return "idle";
  }

  if (endpoint.state === "waiting" || endpoint.state === "degraded") {
    return "waiting";
  }

  return "offline";
}

function machineEndpointStateLabel(state: DesktopMachineEndpointState): string {
  switch (state) {
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    case "waiting":
      return "Waiting";
    case "offline":
      return "Offline";
  }
}

function isTaskLikeOperatorMessage(body: string): boolean {
  const normalized = sanitizeRelayBody(body).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.length >= 24 || normalized.includes("?") || normalized.includes("\n")) {
    return true;
  }

  return /\b(can you|could you|please|review|check|update|build|fix|write|work on|look at|ask|ship|plan|test|deploy|investigate|sync|implement)\b/i.test(normalized);
}

function taskTitleFromBody(body: string): string {
  const normalized = sanitizeRelayBody(body).replace(/\s+/g, " ").trim();
  if (normalized.length <= 110) {
    return normalized;
  }

  return `${normalized.slice(0, 109).trimEnd()}…`;
}

function taskSignalKey(messageId: string, targetAgentId: string): string {
  return `${messageId}::${targetAgentId}`;
}

function buildDesktopTasks(
  snapshot: RuntimeRegistrySnapshot,
  tmuxSessions: TmuxSession[],
): DesktopTask[] {
  const conversations = snapshot.conversations as Record<string, ConversationRecord>;
  const messages = Object.values(snapshot.messages as Record<string, MessageRecord>)
    .filter((message) => message.metadata?.transportOnly !== "true")
    .sort((lhs, rhs) => normalizeTimestamp(rhs.createdAt) - normalizeTimestamp(lhs.createdAt));
  const messagesByConversation = buildMessagesByConversation(snapshot);
  const directActivity = buildDirectAgentActivity(snapshot, tmuxSessions, messagesByConversation);
  const latestStatusByTask = new Map<string, { createdAt: number; body: string }>();
  const latestReplyByTask = new Map<string, { createdAt: number; body: string }>();

  for (const message of messages) {
    if (!message.replyToMessageId) {
      continue;
    }

    if (message.class === "status") {
      const targetAgentId = typeof message.metadata?.targetAgentId === "string"
        ? String(message.metadata.targetAgentId)
        : null;
      if (!targetAgentId) {
        continue;
      }

      const key = taskSignalKey(message.replyToMessageId, targetAgentId);
      const current = latestStatusByTask.get(key);
      if (!current || normalizeTimestamp(current.createdAt) < normalizeTimestamp(message.createdAt)) {
        latestStatusByTask.set(key, {
          createdAt: message.createdAt,
          body: sanitizeRelayBody(message.body),
        });
      }
      continue;
    }

    if (message.actorId === OPERATOR_ID) {
      continue;
    }

    const key = taskSignalKey(message.replyToMessageId, message.actorId);
    const current = latestReplyByTask.get(key);
    if (!current || normalizeTimestamp(current.createdAt) < normalizeTimestamp(message.createdAt)) {
      latestReplyByTask.set(key, {
        createdAt: message.createdAt,
        body: sanitizeRelayBody(message.body),
      });
    }
  }

  const candidates = messages.flatMap((message) => {
    if (message.actorId !== OPERATOR_ID || !isTaskLikeOperatorMessage(message.body)) {
      return [];
    }

    const conversation = conversations[message.conversationId];
    const targets = inferRecipients(message, conversation)
      .filter((recipient) => recipient !== OPERATOR_ID)
      .filter((recipient) => Boolean((snapshot.agents as Record<string, AgentRecord>)[recipient]));

    return targets.map((targetAgentId) => ({ message, targetAgentId }));
  });

  const latestTaskIdByAgent = new Map<string, string>();
  for (const candidate of candidates) {
    if (!latestTaskIdByAgent.has(candidate.targetAgentId)) {
      latestTaskIdByAgent.set(candidate.targetAgentId, candidate.message.id);
    }
  }

  return candidates
    .map(({ message, targetAgentId }) => {
      const key = taskSignalKey(message.id, targetAgentId);
      const reply = latestReplyByTask.get(key) ?? null;
      const statusSignal = latestStatusByTask.get(key) ?? null;
      const activity = directActivity.get(targetAgentId);
      const endpoint = activeEndpoint(snapshot, targetAgentId);
      const agent = (snapshot.agents as Record<string, AgentRecord>)[targetAgentId];
      const projectRoot = endpoint?.projectRoot
        ?? endpoint?.cwd
        ?? (typeof agent?.metadata?.projectRoot === "string" ? String(agent.metadata.projectRoot) : null);
      const project =
        typeof endpoint?.metadata?.project === "string"
          ? String(endpoint.metadata.project)
          : typeof agent?.metadata?.project === "string"
            ? String(agent.metadata.project)
            : projectRoot
              ? path.basename(projectRoot)
              : null;
      const isLatestTaskForAgent = latestTaskIdByAgent.get(targetAgentId) === message.id;
      let status: DesktopTaskStatus = "queued";
      let statusLabel = activity?.reachable ? "Queued" : "Pending";
      let statusDetail = activity?.reachable ? "Delivered to the agent." : "Waiting for the agent to come online.";
      let updatedAt = message.createdAt;

      if (reply) {
        status = "completed";
        statusLabel = "Completed";
        statusDetail = `Answered ${formatRelativeTime(reply.createdAt)}`;
        updatedAt = reply.createdAt;
      } else if (statusSignal && /failed|timed out|error/i.test(statusSignal.body)) {
        status = "failed";
        statusLabel = "Failed";
        statusDetail = statusSignal.body;
        updatedAt = statusSignal.createdAt;
      } else if (
        (statusSignal && /working|running|waking|queued/i.test(statusSignal.body))
        || (activity?.state === "working" && isLatestTaskForAgent)
      ) {
        status = "running";
        statusLabel = "Running";
        statusDetail = statusSignal?.body || activity?.activeTask || "Working on the latest ask.";
        updatedAt = statusSignal?.createdAt ?? message.createdAt;
      } else if (statusSignal) {
        statusDetail = statusSignal.body;
        updatedAt = statusSignal.createdAt;
      }

      return {
        id: `task:${message.id}:${targetAgentId}`,
        messageId: message.id,
        conversationId: message.conversationId,
        targetAgentId,
        targetAgentName: actorDisplayName(snapshot, targetAgentId),
        project,
        projectRoot: compactHomePath(projectRoot) ?? projectRoot,
        title: taskTitleFromBody(message.body),
        body: sanitizeRelayBody(message.body),
        status,
        statusLabel,
        statusDetail,
        replyPreview: reply?.body ?? null,
        createdAt: message.createdAt,
        createdAtLabel: formatDateTimeLabel(message.createdAt) ?? formatTimeLabel(message.createdAt),
        updatedAtLabel: formatDateTimeLabel(updatedAt) ?? formatTimeLabel(updatedAt),
        ageLabel: formatRelativeTime(message.createdAt),
      } satisfies DesktopTask;
    })
    .sort((lhs, rhs) => normalizeTimestamp(rhs.createdAt) - normalizeTimestamp(lhs.createdAt));
}

function buildReconciliationFindings(
  snapshot: RuntimeRegistrySnapshot,
  tmuxSessions: TmuxSession[],
): DesktopReconciliationFinding[] {
  const conversations = snapshot.conversations as Record<string, ConversationRecord>;
  const messages = Object.values(snapshot.messages as Record<string, MessageRecord>)
    .filter((message) => message.metadata?.transportOnly !== "true")
    .sort((lhs, rhs) => normalizeTimestamp(rhs.createdAt) - normalizeTimestamp(lhs.createdAt));
  const messagesByConversation = buildMessagesByConversation(snapshot);
  const directActivity = buildDirectAgentActivity(snapshot, tmuxSessions, messagesByConversation);
  const latestStatusByExpectation = new Map<string, { createdAt: number; body: string }>();
  const latestReplyByExpectation = new Map<string, { createdAt: number; body: string }>();
  const findings = new Map<string, DesktopReconciliationFinding>();
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const message of messages) {
    if (!message.replyToMessageId) {
      continue;
    }

    if (message.class === "status") {
      const targetAgentId = typeof message.metadata?.targetAgentId === "string"
        ? String(message.metadata.targetAgentId)
        : null;
      if (!targetAgentId) {
        continue;
      }

      const key = taskSignalKey(message.replyToMessageId, targetAgentId);
      const current = latestStatusByExpectation.get(key);
      if (!current || normalizeTimestamp(current.createdAt) < normalizeTimestamp(message.createdAt)) {
        latestStatusByExpectation.set(key, {
          createdAt: message.createdAt,
          body: sanitizeRelayBody(message.body),
        });
      }
      continue;
    }

    const key = taskSignalKey(message.replyToMessageId, message.actorId);
    const current = latestReplyByExpectation.get(key);
    if (!current || normalizeTimestamp(current.createdAt) < normalizeTimestamp(message.createdAt)) {
      latestReplyByExpectation.set(key, {
        createdAt: message.createdAt,
        body: sanitizeRelayBody(message.body),
      });
    }
  }

  for (const message of messages) {
    if (message.class === "status" || message.class === "system") {
      continue;
    }

    if (!isTaskLikeOperatorMessage(message.body)) {
      continue;
    }

    const conversation = conversations[message.conversationId];
    const targets = inferRecipients(message, conversation)
      .filter((recipient) => recipient !== message.actorId)
      .filter((recipient) => Boolean((snapshot.agents as Record<string, AgentRecord>)[recipient]));

    for (const targetAgentId of targets) {
      const key = taskSignalKey(message.id, targetAgentId);
      const reply = latestReplyByExpectation.get(key) ?? null;
      if (reply) {
        continue;
      }

      const statusSignal = latestStatusByExpectation.get(key) ?? null;
      const activity = directActivity.get(targetAgentId);
      const createdAt = normalizeTimestamp(message.createdAt);
      const ageSeconds = Math.max(0, nowSeconds - createdAt);
      const requesterName = actorDisplayName(snapshot, message.actorId);
      const targetAgentName = actorDisplayName(snapshot, targetAgentId);
      const title = `${requesterName} is waiting on ${targetAgentName}`;
      const baseFinding = {
        requesterId: message.actorId,
        requesterName,
        targetAgentId,
        targetAgentName,
        conversationId: message.conversationId,
        messageId: message.id,
        recordId: null,
        ageLabel: formatRelativeTime(message.createdAt),
      } satisfies Pick<DesktopReconciliationFinding, "requesterId" | "requesterName" | "targetAgentId" | "targetAgentName" | "conversationId" | "messageId" | "recordId" | "ageLabel">;

      if (!activity?.reachable && ageSeconds >= RECONCILE_OFFLINE_WAIT_SECONDS) {
        findings.set(`finding:${key}:offline`, {
          id: `finding:${key}:offline`,
          kind: "agent_offline",
          severity: "error",
          title,
          summary: `${targetAgentName} has not started handling this ask.`,
          detail: `${targetAgentName} looks offline while ${requesterName} is still waiting on: ${taskTitleFromBody(message.body)}`,
          updatedAtLabel: null,
          ...baseFinding,
        });
        continue;
      }

      if (
        statusSignal
        && /working|running|waking|queued/i.test(statusSignal.body)
      ) {
        const statusAgeSeconds = Math.max(0, nowSeconds - normalizeTimestamp(statusSignal.createdAt));
        if (statusAgeSeconds >= RECONCILE_STALE_WORKING_SECONDS) {
          findings.set(`finding:${key}:stale-working`, {
            id: `finding:${key}:stale-working`,
            kind: "stale_working",
            severity: "warning",
            title,
            summary: `${targetAgentName} said it was working, but nothing else happened.`,
            detail: statusSignal.body,
            updatedAtLabel: formatRelativeTime(statusSignal.createdAt),
            ...baseFinding,
          });
        }
        continue;
      }

      if (!statusSignal && ageSeconds >= RECONCILE_NO_FOLLOW_UP_SECONDS) {
        findings.set(`finding:${key}:no-follow-up`, {
          id: `finding:${key}:no-follow-up`,
          kind: "no_follow_up",
          severity: "warning",
          title,
          summary: `${targetAgentName} has not acknowledged or answered this ask.`,
          detail: taskTitleFromBody(message.body),
          updatedAtLabel: null,
          ...baseFinding,
        });
      }
    }
  }

  for (const record of Object.values(snapshot.collaborationRecords ?? {}) as Array<unknown>) {
    const recordValue = record as Record<string, unknown>;
    const nextMoveOwnerId = typeof recordValue.nextMoveOwnerId === "string" ? String(recordValue.nextMoveOwnerId) : null;
    const ownerId = typeof recordValue.ownerId === "string" ? String(recordValue.ownerId) : null;
    const waitingOn = typeof recordValue.waitingOn === "object" && recordValue.waitingOn ? recordValue.waitingOn as Record<string, unknown> : null;
    const targetId = typeof waitingOn?.targetId === "string" ? String(waitingOn.targetId) : null;
    const waitingKind = typeof waitingOn?.kind === "string" ? String(waitingOn.kind) : null;
    const updatedAt = typeof recordValue.updatedAt === "number" ? recordValue.updatedAt : 0;
    const recordId = typeof recordValue.id === "string" ? String(recordValue.id) : null;
    const title = typeof recordValue.title === "string" ? String(recordValue.title) : "Open item";
    if (!recordId || !nextMoveOwnerId || waitingKind !== "actor" || !targetId) {
      continue;
    }

    const targetActivity = directActivity.get(targetId);
    const staleSeconds = Math.max(0, nowSeconds - normalizeTimestamp(updatedAt));
    if (targetActivity?.reachable || staleSeconds < RECONCILE_NO_FOLLOW_UP_SECONDS) {
      continue;
    }

    findings.set(`finding:record:${recordId}`, {
      id: `finding:record:${recordId}`,
      kind: "waiting_on_record",
      severity: "error",
      title: `${actorDisplayName(snapshot, nextMoveOwnerId)} is blocked on ${actorDisplayName(snapshot, targetId)}`,
      summary: title,
      detail: typeof waitingOn?.label === "string" ? String(waitingOn.label) : null,
      requesterId: ownerId ?? nextMoveOwnerId,
      requesterName: actorDisplayName(snapshot, ownerId ?? nextMoveOwnerId),
      targetAgentId: targetId,
      targetAgentName: actorDisplayName(snapshot, targetId),
      conversationId: typeof recordValue.conversationId === "string" ? String(recordValue.conversationId) : null,
      messageId: null,
      recordId,
      ageLabel: formatRelativeTime(updatedAt),
      updatedAtLabel: formatRelativeTime(updatedAt),
    });
  }

  return Array.from(findings.values())
    .sort((lhs, rhs) => {
      const severityRank = (value: DesktopReconciliationFinding["severity"]) => value === "error" ? 0 : 1;
      const findingTimestamp = (finding: DesktopReconciliationFinding) => {
        if (finding.messageId) {
          const message = snapshot.messages[finding.messageId] as MessageRecord | undefined;
          return normalizeTimestamp(message?.createdAt ?? 0);
        }
        if (finding.recordId) {
          const record = snapshot.collaborationRecords?.[finding.recordId] as unknown;
          const recordValue = record as Record<string, unknown> | undefined;
          return normalizeTimestamp(typeof recordValue?.updatedAt === "number" ? recordValue.updatedAt : 0);
        }
        return 0;
      };
      return (
        severityRank(lhs.severity) - severityRank(rhs.severity)
        || findingTimestamp(rhs) - findingTimestamp(lhs)
        || lhs.title.localeCompare(rhs.title)
      );
    });
}

function buildEmptyMachinesState(): DesktopMachinesState {
  return {
    title: "Machines",
    subtitle: "Broker unavailable",
    totalMachines: 0,
    onlineCount: 0,
    degradedCount: 0,
    offlineCount: 0,
    lastUpdatedLabel: null,
    machines: [],
  };
}

function buildMachinesState(
  snapshot: RuntimeRegistrySnapshot,
  tmuxSessions: TmuxSession[],
  localNodeId: string | null,
): DesktopMachinesState {
  const messagesByConversation = buildMessagesByConversation(snapshot);
  const directActivity = buildDirectAgentActivity(snapshot, tmuxSessions, messagesByConversation);
  const endpoints = Object.values(snapshot.endpoints as Record<string, EndpointRecord>);
  const endpointsByNode = endpoints.reduce((map, endpoint) => {
    const bucket = map.get(endpoint.nodeId) ?? [];
    bucket.push(endpoint);
    map.set(endpoint.nodeId, bucket);
    return map;
  }, new Map<string, EndpointRecord[]>());
  const nowSeconds = Math.floor(Date.now() / 1000);
  const nodeIds = unique([
    ...Object.keys(snapshot.nodes),
    ...endpoints.map((endpoint) => endpoint.nodeId),
  ]);

  const machines = nodeIds
    .map((nodeId) => {
      const node = snapshot.nodes[nodeId];
      const nodeEndpoints = endpointsByNode.get(nodeId) ?? [];
      const endpointItems = nodeEndpoints
        .map((endpoint) => {
          const activity = directActivity.get(endpoint.agentId);
          const projectRoot = compactHomePath(endpoint.projectRoot ?? endpoint.cwd);
          const project =
            typeof endpoint.metadata?.project === "string"
              ? String(endpoint.metadata.project)
              : endpoint.projectRoot
                ? path.basename(endpoint.projectRoot)
                : endpoint.cwd
                  ? path.basename(endpoint.cwd)
                  : null;
          const lastActiveAt =
            typeof endpoint.metadata?.lastCompletedAt === "number"
              ? Number(endpoint.metadata.lastCompletedAt)
              : typeof endpoint.metadata?.lastStartedAt === "number"
                ? Number(endpoint.metadata.lastStartedAt)
                : null;
          const state = machineEndpointState(endpoint, activity);

          return {
            id: endpoint.id,
            agentId: endpoint.agentId,
            agentName: actorDisplayName(snapshot, endpoint.agentId),
            project,
            projectRoot,
            cwd: compactHomePath(endpoint.cwd),
            harness: endpoint.harness ?? null,
            transport: endpoint.transport ?? null,
            sessionId: endpoint.sessionId ?? null,
            state,
            stateLabel: machineEndpointStateLabel(state),
            reachable: Boolean(activity?.reachable),
            lastActiveLabel: lastActiveAt ? formatRelativeTime(lastActiveAt) : null,
            activeTask: activity?.state === "working" ? activity.activeTask : null,
          } satisfies DesktopMachineEndpoint;
        })
        .sort((lhs, rhs) => lhs.agentName.localeCompare(rhs.agentName));

      const latestEndpointActivityAt = nodeEndpoints.reduce((latest, endpoint) => {
        const completedAt = typeof endpoint.metadata?.lastCompletedAt === "number"
          ? Number(endpoint.metadata.lastCompletedAt)
          : 0;
        const startedAt = typeof endpoint.metadata?.lastStartedAt === "number"
          ? Number(endpoint.metadata.lastStartedAt)
          : 0;
        return Math.max(latest, normalizeTimestamp(completedAt || startedAt || 0));
      }, 0);
      const lastSeenAt = normalizeTimestamp(
        node?.lastSeenAt
        ?? latestEndpointActivityAt
        ?? node?.registeredAt
        ?? 0,
      );
      const reachableEndpointCount = endpointItems.filter((endpoint) => endpoint.reachable).length;
      const workingEndpointCount = endpointItems.filter((endpoint) => endpoint.state === "running").length;
      const idleEndpointCount = endpointItems.filter((endpoint) => endpoint.state === "idle").length;
      const waitingEndpointCount = endpointItems.filter((endpoint) => endpoint.state === "waiting").length;
      const ageSeconds = lastSeenAt ? Math.max(0, nowSeconds - lastSeenAt) : Number.POSITIVE_INFINITY;
      const status: DesktopMachine["status"] =
        reachableEndpointCount > 0 || ageSeconds <= 300
          ? "online"
          : nodeEndpoints.length > 0 || ageSeconds <= 3600
            ? "degraded"
            : "offline";
      const statusLabel =
        status === "online"
          ? "Online"
          : status === "degraded"
            ? "Degraded"
            : "Offline";
      const projectRoots = unique(
        endpointItems
          .map((endpoint) => endpoint.projectRoot)
          .filter((value): value is string => Boolean(value)),
      );

      return {
        id: nodeId,
        title: node?.name || node?.hostName || nodeId,
        hostName: node?.hostName ?? null,
        status,
        statusLabel,
        statusDetail: reachableEndpointCount > 0
          ? `${reachableEndpointCount} reachable endpoint${reachableEndpointCount === 1 ? "" : "s"}`
          : lastSeenAt
            ? `Last seen ${formatRelativeTime(lastSeenAt)}`
            : "No active endpoint detected.",
        advertiseScope: typeof node?.advertiseScope === "string" ? String(node.advertiseScope) : null,
        brokerUrl: typeof node?.brokerUrl === "string" ? String(node.brokerUrl) : null,
        capabilities: Array.isArray(node?.capabilities) ? node.capabilities.map((capability) => String(capability)) : [],
        labels: Array.isArray(node?.labels) ? node.labels.map((label) => String(label)) : [],
        isLocal: localNodeId === nodeId,
        registeredAtLabel: formatDateTimeLabel(node?.registeredAt) ?? null,
        lastSeenLabel: lastSeenAt ? formatRelativeTime(lastSeenAt) : null,
        projectRoots,
        projectCount: projectRoots.length,
        endpointCount: endpointItems.length,
        reachableEndpointCount,
        workingEndpointCount,
        idleEndpointCount,
        waitingEndpointCount,
        endpoints: endpointItems,
      } satisfies DesktopMachine;
    })
    .sort((lhs, rhs) => {
      const rank = (value: DesktopMachine["status"]) => {
        switch (value) {
          case "online":
            return 0;
          case "degraded":
            return 1;
          case "offline":
            return 2;
        }
      };

      return (
        rank(lhs.status) - rank(rhs.status)
        || rhs.workingEndpointCount - lhs.workingEndpointCount
        || lhs.title.localeCompare(rhs.title)
      );
    });

  return {
    title: "Machines",
    subtitle: `${machines.length} nodes · ${endpoints.length} endpoints`,
    totalMachines: machines.length,
    onlineCount: machines.filter((machine) => machine.status === "online").length,
    degradedCount: machines.filter((machine) => machine.status === "degraded").length,
    offlineCount: machines.filter((machine) => machine.status === "offline").length,
    lastUpdatedLabel: machines.find((machine) => machine.lastSeenLabel)?.lastSeenLabel ?? null,
    machines,
  };
}

async function buildPlansState(
  snapshot: RuntimeRegistrySnapshot | null,
  tmuxSessions: TmuxSession[],
): Promise<DesktopPlansState> {
  const [plans, tasks, findings] = await Promise.all([
    loadWorkspacePlans(snapshot),
    Promise.resolve(snapshot ? buildDesktopTasks(snapshot, tmuxSessions) : []),
    Promise.resolve(snapshot ? buildReconciliationFindings(snapshot, tmuxSessions) : []),
  ]);
  const workspaceCount = new Set(plans.map((plan) => plan.workspacePath)).size;
  const runningTaskCount = tasks.filter((task) => task.status === "running").length;
  const failedTaskCount = tasks.filter((task) => task.status === "failed").length;
  const completedTaskCount = tasks.filter((task) => task.status === "completed").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const latestTask = tasks[0];
  const latestPlan = plans[0];
  const latestFinding = findings[0];
  const latestPlanLabel = latestPlan
    ? formatRelativeTime(Math.floor(Date.parse(latestPlan.updatedAt) / 1000))
    : null;

  return {
    title: "Plans",
    subtitle: `${tasks.length} asks · ${findings.length} findings · ${plans.length} plans · ${workspaceCount} workspaces`,
    taskCount: tasks.length,
    runningTaskCount,
    failedTaskCount,
    completedTaskCount,
    findingCount: findings.length,
    warningCount,
    errorCount,
    planCount: plans.length,
    workspaceCount,
    lastUpdatedLabel: latestFinding?.updatedAtLabel ?? latestTask?.ageLabel ?? latestPlanLabel,
    tasks,
    findings,
    plans,
  };
}

function buildRelayMessages(snapshot: RuntimeRegistrySnapshot): RelayMessage[] {
  const conversations = snapshot.conversations as Record<string, ConversationRecord>;
  const messages = Object.values(snapshot.messages as Record<string, MessageRecord>)
    .filter((message) => message.metadata?.transportOnly !== "true")
    .sort((lhs, rhs) => normalizeTimestamp(lhs.createdAt) - normalizeTimestamp(rhs.createdAt));

  return messages.map((message) => {
    const conversation = conversations[message.conversationId];
    const channel = normalizedChannel(conversation);
    const recipients = inferRecipients(message, conversation);
    const endpoint = activeEndpoint(snapshot, message.actorId);
    const provenanceParts = [
      endpoint?.transport,
      endpoint?.harness,
      endpoint?.cwd ? path.basename(endpoint.cwd) : null,
    ].filter(Boolean) as string[];

    return {
      id: message.id,
      clientMessageId: typeof message.metadata?.clientMessageId === "string" ? String(message.metadata.clientMessageId) : null,
      conversationId: message.conversationId,
      createdAt: message.createdAt,
      replyToMessageId: message.replyToMessageId ?? null,
      authorId: message.actorId,
      authorName: actorDisplayName(snapshot, message.actorId),
      authorRole: actorRole(snapshot, message.actorId),
      body: sanitizeRelayBody(message.body),
      timestampLabel: formatTimeLabel(message.createdAt),
      dayLabel: formatDayLabel(message.createdAt),
      normalizedChannel: channel,
      recipients,
      isDirectConversation: conversation?.kind === "direct" || conversation?.id.startsWith("dm.") === true,
      isSystem: message.class === "system" || channel === "system" || conversation?.kind === "system",
      isVoice: channel === "voice" || Boolean(spokenTextForMessage(message)),
      messageClass: message.class,
      routingSummary: recipients.length > 0 ? `Targets ${recipients.map((id) => actorDisplayName(snapshot, id)).join(", ")}` : null,
      provenanceSummary: provenanceParts.length > 0 ? `via ${provenanceParts.join(" · ")}` : null,
      provenanceDetail: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
      isOperator: message.actorId === OPERATOR_ID,
      avatarLabel: actorDisplayName(snapshot, message.actorId).slice(0, 1).toUpperCase(),
      avatarColor: colorForIdentity(message.actorId),
      receipt: null,
    };
  });
}

function buildRelayDirects(
  snapshot: RuntimeRegistrySnapshot,
  activityByAgent: Map<string, DirectAgentActivity>,
  messagesByConversation: Map<string, MessageRecord[]>,
  visibleAgentIds: Set<string>,
): RelayDirectThread[] {
  return Object.values(snapshot.agents as Record<string, AgentRecord>)
    .filter((agent) => visibleAgentIds.has(agent.id))
    .sort((lhs, rhs) => actorDisplayName(snapshot, lhs.id).localeCompare(actorDisplayName(snapshot, rhs.id)))
    .map((agent) => {
      const directMessages = messagesByConversation.get(directConversationId(agent.id)) ?? [];
      const latestMessage = directMessages.at(-1) ?? null;
      const previewMessage =
        [...directMessages].reverse().find((message) => message.class !== "status" && message.class !== "system")
        ?? latestMessage;
      const subtitle =
        typeof agent.metadata?.role === "string"
          ? String(agent.metadata.role)
          : typeof agent.metadata?.summary === "string"
            ? String(agent.metadata.summary)
            : "Relay agent";
      const activity = activityByAgent.get(agent.id) ?? {
        state: "offline" as const,
        reachable: false,
        statusLabel: "Offline",
        statusDetail: "No active endpoint detected.",
        activeTask: null,
        lastMessageAt: null,
      };

      return {
        kind: "direct" as const,
        id: agent.id,
        title: actorDisplayName(snapshot, agent.id),
        subtitle,
        preview: previewMessage ? sanitizeRelayBody(previewMessage.body) : null,
        timestampLabel: latestMessage ? formatTimeLabel(latestMessage.createdAt) : null,
        state: activity.state,
        reachable: activity.reachable,
        statusLabel: activity.statusLabel,
        statusDetail: activity.statusDetail,
        activeTask: activity.activeTask,
      };
    });
}

function attachRelayReceipts(
  snapshot: RuntimeRegistrySnapshot,
  messages: RelayMessage[],
  activityByAgent: Map<string, DirectAgentActivity>,
): RelayMessage[] {
  const latestStatusByReplyTo = new Map<string, { createdAt: number; body: string; targetAgentId: string | null }>();
  const latestReplyByReplyTo = new Map<string, { createdAt: number; authorId: string }>();
  const latestOperatorDirectMessageByAgent = new Map<string, string>();

  for (const message of messages) {
    if (!message.isOperator || !message.isDirectConversation) {
      continue;
    }

    const targetAgentId = message.recipients.find((recipient) => recipient !== OPERATOR_ID);
    if (targetAgentId) {
      latestOperatorDirectMessageByAgent.set(targetAgentId, message.id);
    }
  }

  for (const message of Object.values(snapshot.messages as Record<string, MessageRecord>)) {
    if (message.metadata?.transportOnly === "true" || !message.replyToMessageId) {
      continue;
    }

    if (message.class === "status") {
      const current = latestStatusByReplyTo.get(message.replyToMessageId);
      if (!current || normalizeTimestamp(current.createdAt) < normalizeTimestamp(message.createdAt)) {
        latestStatusByReplyTo.set(message.replyToMessageId, {
          createdAt: message.createdAt,
          body: sanitizeRelayBody(message.body),
          targetAgentId: typeof message.metadata?.targetAgentId === "string" ? message.metadata.targetAgentId : null,
        });
      }
      continue;
    }

    if (message.actorId === OPERATOR_ID) {
      continue;
    }

    const current = latestReplyByReplyTo.get(message.replyToMessageId);
    if (!current || normalizeTimestamp(current.createdAt) < normalizeTimestamp(message.createdAt)) {
      latestReplyByReplyTo.set(message.replyToMessageId, {
        createdAt: message.createdAt,
        authorId: message.actorId,
      });
    }
  }

  return messages.map((message) => {
    if (!message.isOperator || !message.isDirectConversation) {
      return message;
    }

    const targetAgentId = message.recipients.find((recipient) => recipient !== OPERATOR_ID);
    if (!targetAgentId) {
      return message;
    }

    const reply = latestReplyByReplyTo.get(message.id);
    if (reply && reply.authorId === targetAgentId) {
      return {
        ...message,
        receipt: {
          state: "replied",
          label: "Replied",
          detail: formatRelativeTime(reply.createdAt),
        },
      };
    }

    const status = latestStatusByReplyTo.get(message.id);
    if (status && (!status.targetAgentId || status.targetAgentId === targetAgentId)) {
      if (/is working\.?$/i.test(status.body)) {
        return {
          ...message,
          receipt: {
            state: "working",
            label: "Working",
            detail: null,
          },
        };
      }

      return {
        ...message,
        receipt: {
          state: "seen",
          label: "Seen",
          detail: null,
        },
      };
    }

    const activity = activityByAgent.get(targetAgentId);
    const isLatestForAgent = latestOperatorDirectMessageByAgent.get(targetAgentId) === message.id;
    if (activity?.state === "working" && isLatestForAgent) {
      return {
        ...message,
        receipt: {
          state: "working",
          label: "Working",
          detail: null,
        },
      };
    }

    if (activity?.reachable) {
      return {
        ...message,
        receipt: {
          state: "delivered",
          label: "Delivered",
          detail: null,
        },
      };
    }

    return {
      ...message,
      receipt: {
        state: "sent",
        label: "Sent",
        detail: null,
      },
    };
  });
}

function isRelaySharedConversationMessage(message: RelayMessage) {
  return (
    !message.isDirectConversation &&
    !message.isSystem &&
    !message.isVoice &&
    message.messageClass !== "status" &&
    (!message.normalizedChannel || message.normalizedChannel === "shared")
  );
}

function isRelaySystemMessage(message: RelayMessage) {
  return message.isSystem;
}

function isRelayVoiceMessage(message: RelayMessage) {
  return message.isVoice;
}

function isRelayAllTrafficMessage(message: RelayMessage) {
  return !message.isVoice;
}

function isRelayCoordinationMessage(message: RelayMessage) {
  return (
    !message.isVoice &&
    !message.isSystem &&
    (message.isDirectConversation || message.recipients.length > 0 || message.messageClass === "status")
  );
}

function isRelayMentionMessage(message: RelayMessage) {
  return (
    !message.isDirectConversation &&
    !message.isSystem &&
    !message.isVoice &&
    message.messageClass !== "status" &&
    message.recipients.length > 0
  );
}

function countMessages(messages: RelayMessage[], predicate: (message: RelayMessage) => boolean) {
  return messages.filter(predicate).length;
}

function buildRelayState(
  snapshot: RuntimeRegistrySnapshot,
  tmuxSessions: TmuxSession[],
  configuredAgentIds: Set<string>,
): RelayState {
  const messagesByConversation = buildMessagesByConversation(snapshot);
  const directActivity = buildDirectAgentActivity(snapshot, tmuxSessions, messagesByConversation);
  const visibleAgentIds = visibleRelayAgentIds(snapshot, configuredAgentIds, messagesByConversation, directActivity);
  const messages = attachRelayReceipts(snapshot, buildRelayMessages(snapshot), directActivity);
  const directs = buildRelayDirects(snapshot, directActivity, messagesByConversation, visibleAgentIds);
  const voiceState = relayVoiceBridgeService.getRelayVoiceState();

  const channels: RelayNavItem[] = [
    {
      kind: "channel",
      id: "shared",
      title: "# shared-channel",
      subtitle: "Broadcast updates and shared context.",
      count: countMessages(messages, isRelaySharedConversationMessage),
    },
    {
      kind: "channel",
      id: "voice",
      title: "# voice",
      subtitle: "Voice-related chat, transcripts, and spoken updates.",
      count: countMessages(messages, isRelayVoiceMessage),
    },
    {
      kind: "channel",
      id: "system",
      title: "# system",
      subtitle: "Infrastructure, lifecycle, and broker state events.",
      count: countMessages(messages, isRelaySystemMessage),
    },
  ];

  const views: RelayNavItem[] = [
    {
      kind: "filter",
      id: "all-traffic",
      title: "All Traffic",
      subtitle: "Every non-voice message across the workspace.",
      count: countMessages(messages, isRelayAllTrafficMessage),
    },
    {
      kind: "filter",
      id: "coordination",
      title: "Coordination",
      subtitle: "Targeted messages, direct threads, and task handoffs.",
      count: countMessages(messages, isRelayCoordinationMessage),
    },
    {
      kind: "filter",
      id: "mentions",
      title: "Mentions",
      subtitle: "Focused view over shared-channel targeted messages.",
      count: countMessages(messages, isRelayMentionMessage),
    },
  ];

  return {
    title: "Relay",
    subtitle: `${messages.length} messages · ${directs.length} agents`,
    transportTitle: "Broker-backed",
    meshTitle: "Local mesh",
    syncLine: "Live sync",
    operatorId: OPERATOR_ID,
    channels,
    views,
    directs,
    messages,
    voice: voiceState,
    lastUpdatedLabel: messages.at(-1) ? formatRelativeTime(normalizeTimestamp((snapshot.messages as Record<string, MessageRecord>)[messages.at(-1)?.id ?? ""]?.createdAt ?? 0)) : null,
  };
}

function isInterAgentConversation(snapshot: RuntimeRegistrySnapshot, conversation: ConversationRecord) {
  if (conversation.kind !== "direct" && conversation.kind !== "group_direct") {
    return false;
  }

  if (conversation.participantIds.includes(OPERATOR_ID)) {
    return false;
  }

  if (conversation.participantIds.length < 2) {
    return false;
  }

  return conversation.participantIds.every((participantId) =>
    isKnownCounterpart(snapshot, participantId),
  );
}

function isKnownVisibleAgent(
  snapshot: RuntimeRegistrySnapshot,
  actorId: string,
  visibleAgentIds?: Set<string>,
) {
  return Boolean((snapshot.agents as Record<string, AgentRecord>)[actorId])
    && (!visibleAgentIds || visibleAgentIds.has(actorId));
}

function isKnownCounterpart(
  snapshot: RuntimeRegistrySnapshot,
  actorId: string,
  visibleAgentIds?: Set<string>,
) {
  if (actorId === OPERATOR_ID) {
    return false;
  }

  if (isKnownVisibleAgent(snapshot, actorId, visibleAgentIds)) {
    return true;
  }

  return Boolean((snapshot.actors as Record<string, ActorRecord>)[actorId]);
}

function interAgentParticipantIds(
  snapshot: RuntimeRegistrySnapshot,
  participantIds: string[],
  visibleAgentIds?: Set<string>,
) {
  return Array.from(
    new Set(
      participantIds.filter((participantId) => participantId !== OPERATOR_ID && isKnownCounterpart(snapshot, participantId, visibleAgentIds)),
    ),
  ).sort();
}

function interAgentThreadKey(participantIds: string[]) {
  return `inter-agent:${participantIds.join("::")}`;
}

function interAgentProfileKind(agent: AgentRecord) {
  if (agent.agentClass === "system") {
    return "system" as const;
  }
  if (agent.metadata?.source === "relay-agent-registry") {
    return "project" as const;
  }
  return "role" as const;
}

function agentTypeLabel(agent: AgentRecord | null | undefined) {
  if (!agent) {
    return "Agent";
  }
  if (agent.agentClass === "system") {
    return "System";
  }
  if (agent.metadata?.source === "relay-agent-registry") {
    return "Relay Agent";
  }
  return "Built-in Role";
}

function buildInterAgentState(
  snapshot: RuntimeRegistrySnapshot,
  tmuxSessions: TmuxSession[],
  configuredAgentIds: Set<string>,
) {
  const conversations = Object.values(snapshot.conversations as Record<string, ConversationRecord>);
  const conversationsById = snapshot.conversations as Record<string, ConversationRecord>;
  const messagesByConversation = buildMessagesByConversation(snapshot);
  const directActivity = buildDirectAgentActivity(snapshot, tmuxSessions, messagesByConversation);
  const visibleAgentIds = visibleRelayAgentIds(snapshot, configuredAgentIds, messagesByConversation, directActivity);
  const tmuxSessionCreatedAt = new Map(
    tmuxSessions.map((session) => [session.name, normalizeTimestamp(session.createdAt ?? 0)]),
  );

  type ThreadAccumulator = {
    id: string;
    conversationId: string | null;
    title: string;
    participants: Array<{ id: string; title: string; role: string | null }>;
    sourceKind: "private" | "projected";
    sourceConversationIds: Set<string>;
    messageIdSet: Set<string>;
    messages: MessageRecord[];
  };

  const threadMap = new Map<string, ThreadAccumulator>();

  const ensureThread = (
    participantIds: string[],
    sourceKind: "private" | "projected",
    conversationId: string | null = null,
    title?: string,
  ) => {
    const normalizedParticipantIds = interAgentParticipantIds(snapshot, participantIds, visibleAgentIds);
    if (normalizedParticipantIds.length < 2) {
      return null;
    }

    const threadId = interAgentThreadKey(normalizedParticipantIds);
    const existing = threadMap.get(threadId);
    if (existing) {
      if (sourceKind === "private") {
        existing.sourceKind = "private";
        existing.conversationId = conversationId ?? existing.conversationId;
      }
      if (title && !existing.title) {
        existing.title = title;
      }
      if (conversationId) {
        existing.sourceConversationIds.add(conversationId);
      }
      return existing;
    }

    const participants = normalizedParticipantIds.map((participantId) => ({
      id: participantId,
      title: actorDisplayName(snapshot, participantId),
      role: actorRole(snapshot, participantId),
    }));

    const nextThread: ThreadAccumulator = {
      id: threadId,
      conversationId,
      title: title || participants.map((participant) => participant.title).join(" ↔ "),
      participants,
      sourceKind,
      sourceConversationIds: new Set(conversationId ? [conversationId] : []),
      messageIdSet: new Set<string>(),
      messages: [],
    };
    threadMap.set(threadId, nextThread);
    return nextThread;
  };

  const appendMessages = (thread: ThreadAccumulator | null, messages: MessageRecord[], conversationId: string) => {
    if (!thread) {
      return;
    }

    thread.sourceConversationIds.add(conversationId);
    for (const message of messages) {
      if (thread.messageIdSet.has(message.id)) {
        continue;
      }
      thread.messageIdSet.add(message.id);
      thread.messages.push(message);
    }
  };

  for (const conversation of conversations.filter((entry) => isInterAgentConversation(snapshot, entry))) {
    const thread = ensureThread(
      conversation.participantIds,
      "private",
      conversation.id,
      conversation.title,
    );
    appendMessages(thread, messagesByConversation.get(conversation.id) ?? [], conversation.id);
  }

  for (const [conversationId, messages] of messagesByConversation.entries()) {
    const conversation = conversationsById[conversationId];
    if (conversation && isInterAgentConversation(snapshot, conversation)) {
      continue;
    }

    for (const message of messages) {
      if (!isKnownCounterpart(snapshot, message.actorId, visibleAgentIds)) {
        continue;
      }

      const recipients = inferRecipients(message, conversation)
        .filter((recipientId) => recipientId !== OPERATOR_ID && recipientId !== message.actorId)
        .filter((recipientId) => isKnownCounterpart(snapshot, recipientId, visibleAgentIds));

      if (recipients.length === 0) {
        continue;
      }

      const projectedParticipantIds = interAgentParticipantIds(snapshot, [message.actorId, ...recipients], visibleAgentIds);
      if (projectedParticipantIds.length < 2 || projectedParticipantIds.length > 3) {
        continue;
      }
      if (!projectedParticipantIds.some((participantId) => isKnownVisibleAgent(snapshot, participantId, visibleAgentIds))) {
        continue;
      }

      const thread = ensureThread(projectedParticipantIds, "projected");
      appendMessages(thread, [message], conversationId);
    }
  }

  const threads = Array.from(threadMap.values())
    .map((thread) => {
      const orderedMessages = [...thread.messages]
        .sort((lhs, rhs) => normalizeTimestamp(lhs.createdAt) - normalizeTimestamp(rhs.createdAt));
      const latestMessage = orderedMessages.at(-1) ?? null;
      const previewMessage =
        [...orderedMessages].reverse().find((message) => message.class !== "status" && message.class !== "system")
        ?? latestMessage;

      return {
        id: thread.id,
        conversationId: thread.conversationId,
        title: thread.title,
        subtitle: latestMessage
          ? `Last from ${actorDisplayName(snapshot, latestMessage.actorId)}`
          : `${thread.participants.length} agents`,
        preview: previewMessage ? sanitizeRelayBody(previewMessage.body) : null,
        timestampLabel: latestMessage ? formatTimeLabel(latestMessage.createdAt) : null,
        messageCount: orderedMessages.length,
        latestAuthorName: latestMessage ? actorDisplayName(snapshot, latestMessage.actorId) : null,
        messageIds: orderedMessages.map((message) => message.id),
        sourceKind: thread.sourceKind,
        participants: thread.participants,
        latestTimestamp: normalizeTimestamp(latestMessage?.createdAt ?? 0),
      };
    })
    .sort((lhs, rhs) => rhs.latestTimestamp - lhs.latestTimestamp || lhs.title.localeCompare(rhs.title));

  const agentThreadSummary = threads.reduce((map, thread) => {
    for (const participant of thread.participants) {
      const entry = map.get(participant.id) ?? {
        threadCount: 0,
        counterpartIds: new Set<string>(),
        latestTimestamp: 0,
      };
      entry.threadCount += 1;
      entry.latestTimestamp = Math.max(entry.latestTimestamp, thread.latestTimestamp);
      for (const counterpart of thread.participants) {
        if (counterpart.id !== participant.id) {
          entry.counterpartIds.add(counterpart.id);
        }
      }
      map.set(participant.id, entry);
    }
    return map;
  }, new Map<string, { threadCount: number; counterpartIds: Set<string>; latestTimestamp: number }>());

  const agents = Object.values(snapshot.agents as Record<string, AgentRecord>)
    .filter((agent) => visibleAgentIds.has(agent.id))
    .map((agent) => {
      const entry = agentThreadSummary.get(agent.id) ?? {
        threadCount: 0,
        counterpartIds: new Set<string>(),
        latestTimestamp: 0,
      };
      const endpoint = activeEndpoint(snapshot, agent.id);
      const activity = directActivity.get(agent.id) ?? {
        state: "offline" as const,
        reachable: false,
        statusLabel: "Offline",
        statusDetail: "No active endpoint detected.",
        activeTask: null,
        lastMessageAt: null,
      };
      const projectRoot =
        endpoint?.projectRoot
        ?? endpoint?.cwd
        ?? (typeof agent.metadata?.projectRoot === "string" ? String(agent.metadata.projectRoot) : null);
      const endpointSessionAt = normalizeTimestamp(
        typeof endpoint?.metadata?.lastCompletedAt === "number"
          ? Number(endpoint.metadata.lastCompletedAt)
          : typeof endpoint?.metadata?.lastStartedAt === "number"
            ? Number(endpoint.metadata.lastStartedAt)
            : 0,
      );
      const endpointStartedAt = normalizeTimestamp(
        typeof endpoint?.metadata?.startedAt === "string"
          ? Number(endpoint.metadata.startedAt)
          : typeof endpoint?.metadata?.startedAt === "number"
            ? Number(endpoint.metadata.startedAt)
            : 0,
      );
      const tmuxCreatedAt = normalizeTimestamp(tmuxSessionCreatedAt.get(endpoint?.sessionId ?? `relay-${agent.id}`) ?? 0);
      const lastChatAt = Math.max(entry.latestTimestamp, activity.lastMessageAt ?? 0) || null;
      const lastSessionAt = Math.max(endpointSessionAt, endpointStartedAt, tmuxCreatedAt) || null;
      const codeActivity = readProjectGitActivity(projectRoot);
      const counterpartCount = entry.counterpartIds.size;
      const subtitle =
        entry.threadCount === 0
          ? "No active channels yet"
          : counterpartCount === 1
            ? "1 counterpart"
            : `${counterpartCount} counterparts`;

      return {
        id: agent.id,
        title: actorDisplayName(snapshot, agent.id),
        subtitle,
        profileKind: interAgentProfileKind(agent),
        registrationKind: "configured" as const,
        source: typeof agent.metadata?.source === "string" ? String(agent.metadata.source) : null,
        agentClass: typeof agent.agentClass === "string" ? String(agent.agentClass) : null,
        role: typeof agent.metadata?.role === "string" ? String(agent.metadata.role) : null,
        summary: typeof agent.metadata?.summary === "string" ? String(agent.metadata.summary) : null,
        harness: endpoint?.harness ?? null,
        transport: endpoint?.transport ?? null,
        cwd: endpoint?.cwd ?? null,
        projectRoot,
        sessionId: endpoint?.sessionId ?? null,
        wakePolicy: typeof agent.wakePolicy === "string" ? String(agent.wakePolicy) : null,
        capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.map((capability) => String(capability)) : [],
        threadCount: entry.threadCount,
        counterpartCount,
        timestampLabel: lastChatAt ? formatTimeLabel(lastChatAt) : null,
        lastChatAt,
        lastChatLabel: lastChatAt ? formatRelativeTime(lastChatAt) : null,
        lastCodeChangeAt: codeActivity.lastCodeChangeAt,
        lastCodeChangeLabel: codeActivity.lastCodeChangeLabel,
        lastSessionAt,
        lastSessionLabel: lastSessionAt ? formatRelativeTime(lastSessionAt) : null,
        state: activity.state,
        reachable: activity.reachable,
        statusLabel: activity.statusLabel,
        statusDetail: activity.statusDetail,
      };
    })
    .sort((lhs, rhs) =>
      rhs.threadCount - lhs.threadCount
      || lhs.title.localeCompare(rhs.title),
    );

  return {
    title: "Inter-Agent",
    subtitle: `${threads.length} agent threads · ${agents.length} agents`,
    agents,
    threads: threads.map(({ latestTimestamp: _latestTimestamp, ...thread }) => thread),
    lastUpdatedLabel: threads[0] ? formatRelativeTime(threads[0].latestTimestamp) : null,
  };
}

function buildSessions(snapshot: RuntimeRegistrySnapshot): SessionMetadata[] {
  const conversations = Object.values(snapshot.conversations as Record<string, ConversationRecord>);
  const messagesByConversation = new Map<string, MessageRecord[]>();

  for (const message of Object.values(snapshot.messages as Record<string, MessageRecord>)) {
    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  return conversations
    .map((conversation) => {
      const messages = (messagesByConversation.get(conversation.id) ?? [])
        .sort((lhs, rhs) => normalizeTimestamp(lhs.createdAt) - normalizeTimestamp(rhs.createdAt));
      const latestMessage = messages.at(-1);
      const firstMessage = messages[0];
      const nonOperator = conversation.participantIds.find((participant) => participant !== OPERATOR_ID) ?? OPERATOR_ID;
      const title =
        conversation.kind === "direct"
          ? `Direct · ${actorDisplayName(snapshot, nonOperator)}`
          : conversation.title;
      const project =
        conversation.kind === "direct"
          ? nonOperator
          : normalizedChannel(conversation) ?? "relay";

      return {
        id: conversation.id,
        project,
        agent: actorDisplayName(snapshot, nonOperator),
        title,
        messageCount: messages.length,
        createdAt: isoFromTimestamp(firstMessage?.createdAt ?? Math.floor(Date.now() / 1000)),
        lastModified: isoFromTimestamp(latestMessage?.createdAt ?? Math.floor(Date.now() / 1000)),
        preview: latestMessage?.body ?? conversation.title,
        tags: [conversation.kind, ...(normalizedChannel(conversation) ? [normalizedChannel(conversation) as string] : [])],
        model: typeof (snapshot.agents as Record<string, AgentRecord>)[nonOperator]?.metadata?.source === "string"
          ? String((snapshot.agents as Record<string, AgentRecord>)[nonOperator]?.metadata?.source)
          : undefined,
        tokens: undefined,
      };
    })
    .sort((lhs, rhs) => Date.parse(rhs.lastModified) - Date.parse(lhs.lastModified));
}

function buildRuntimeState(
  snapshot: RuntimeRegistrySnapshot | null,
  tmuxSessions: TmuxSession[],
  latestRelayLabel: string | null,
  helper: ReturnType<typeof readHelperStatus>,
  status: Awaited<ReturnType<typeof brokerServiceStatus>>,
  visibleAgentCount: number,
): DesktopRuntimeState {
  return {
    helperRunning: helper.running,
    helperDetail: helper.detail,
    brokerInstalled: status.installed,
    brokerLoaded: status.loaded,
    brokerReachable: status.reachable,
    brokerHealthy: status.health.ok,
    brokerLabel: status.label,
    brokerUrl: status.brokerUrl,
    nodeId: status.health.nodeId ?? null,
    agentCount: visibleAgentCount,
    conversationCount: snapshot ? Object.keys(snapshot.conversations).length : status.health.counts?.conversations ?? 0,
    messageCount: snapshot ? Object.keys(snapshot.messages).length : status.health.counts?.messages ?? 0,
    flightCount: snapshot ? Object.keys(snapshot.flights).length : status.health.counts?.flights ?? 0,
    tmuxSessionCount: tmuxSessions.length,
    latestRelayLabel,
    lastHeartbeatLabel: helper.heartbeatLabel,
    updatedAtLabel: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date()),
  };
}

function latestRelayLabelFromSnapshot(snapshot: RuntimeRegistrySnapshot | null): string | null {
  if (!snapshot) return null;
  const latestMessage = Object.values(snapshot.messages as Record<string, MessageRecord>)
    .sort((lhs, rhs) => normalizeTimestamp(rhs.createdAt) - normalizeTimestamp(lhs.createdAt))[0];
  if (!latestMessage) return null;
  return `${actorDisplayName(snapshot, latestMessage.actorId)} · ${formatTimeLabel(latestMessage.createdAt)}`;
}

async function ensureCoreConversation(
  baseUrl: string,
  snapshot: RuntimeRegistrySnapshot,
  nodeId: string,
  conversationId: string,
): Promise<void> {
  if (snapshot.conversations[conversationId]) {
    return;
  }

  const participantIds = Array.from(
    new Set([OPERATOR_ID, ...Object.keys(snapshot.agents)]),
  ).sort();

  const definition =
    conversationId === SHARED_CHANNEL_ID
      ? {
          id: SHARED_CHANNEL_ID,
          kind: "channel",
          title: "shared-channel",
          visibility: "workspace",
          shareMode: "shared",
          authorityNodeId: nodeId,
          participantIds,
          metadata: { surface: "electron" },
        }
      : conversationId === VOICE_CHANNEL_ID
        ? {
            id: VOICE_CHANNEL_ID,
            kind: "channel",
            title: "voice",
            visibility: "workspace",
            shareMode: "local",
            authorityNodeId: nodeId,
            participantIds,
            metadata: { surface: "electron" },
          }
        : {
            id: SYSTEM_CHANNEL_ID,
            kind: "system",
            title: "system",
            visibility: "system",
            shareMode: "local",
            authorityNodeId: nodeId,
            participantIds: [OPERATOR_ID],
            metadata: { surface: "electron" },
          };

  await brokerPost(baseUrl, "/v1/conversations", definition);
}

async function ensureDirectConversation(
  baseUrl: string,
  snapshot: RuntimeRegistrySnapshot,
  nodeId: string,
  agentId: string,
): Promise<string> {
  const conversationId = primaryDirectConversationIdForAgent(agentId);
  const nextShareMode = snapshot.agents[agentId]?.authorityNodeId && snapshot.agents[agentId]?.authorityNodeId !== nodeId ? "shared" : "local";
  const existing = snapshot.conversations[conversationId];
  if (existing?.shareMode === nextShareMode) {
    return conversationId;
  }

  await brokerPost(baseUrl, "/v1/conversations", {
    id: conversationId,
    kind: "direct",
    title: agentId === SCOUT_AGENT_ID ? "Scout" : actorDisplayName(snapshot, agentId),
    visibility: "private",
    shareMode: nextShareMode,
    authorityNodeId: nodeId,
    participantIds: [OPERATOR_ID, agentId].sort(),
    metadata: {
      surface: "electron",
      ...(agentId === SCOUT_AGENT_ID ? { role: "partner" } : {}),
    },
  });

  return conversationId;
}

async function ensureOperatorActor(baseUrl: string): Promise<void> {
  await brokerPost(baseUrl, "/v1/actors", {
    id: OPERATOR_ID,
    kind: "person",
    displayName: resolveOperatorDisplayName(),
    handle: OPERATOR_ID,
    labels: ["operator", "desktop"],
    metadata: { source: "electron-app" },
  });
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function ensureLocalAgentBindingOnBroker(
  baseUrl: string,
  snapshot: RuntimeRegistrySnapshot,
  nodeId: string,
  agentId: string,
): Promise<boolean> {
  if (snapshot.agents[agentId]) {
    return true;
  }

  const binding = await ensureLocalAgentBindingOnline(agentId, nodeId, {
    includeDiscovered: true,
    currentDirectory: desktopCurrentDirectory(),
  });
  if (!binding) {
    return false;
  }

  await brokerPost(baseUrl, "/v1/actors", binding.actor);
  await brokerPost(baseUrl, "/v1/agents", binding.agent);
  await brokerPost(baseUrl, "/v1/endpoints", binding.endpoint);
  snapshot.actors[binding.actor.id] = binding.actor;
  snapshot.agents[binding.agent.id] = binding.agent;
  snapshot.endpoints[binding.endpoint.id] = binding.endpoint;
  return true;
}

async function parseMentionTargets(
  body: string,
  snapshot: RuntimeRegistrySnapshot,
): Promise<{ actorIds: string[]; labels: Record<string, string> }> {
  const validAgents = new Set(Object.keys(snapshot.agents));
  const endpointBackedAgents = unique(
    Object.values(snapshot.endpoints as Record<string, EndpointRecord>).map((endpoint) => endpoint.agentId),
  );

  const labels: Record<string, string> = {};
  const targets = new Set<string>();
  const selectors = extractAgentSelectors(body);
  if (!selectors.length) {
    return { actorIds: [], labels };
  }

  const setup = await readResolvedRelayAgents();
  const candidateMap = new Map<string, AgentSelectorCandidate>();
  for (const agent of Object.values(snapshot.agents)) {
    candidateMap.set(agent.id, {
      agentId: agent.id,
      definitionId: metadataString(agent.metadata, "definitionId") || agent.id,
      nodeQualifier: metadataString(agent.metadata, "nodeQualifier"),
      workspaceQualifier: metadataString(agent.metadata, "workspaceQualifier"),
      aliases: [
        metadataString(agent.metadata, "selector"),
        metadataString(agent.metadata, "defaultSelector"),
      ].filter(Boolean) as string[],
    });
  }
  for (const agent of setup.discoveredAgents) {
    if (candidateMap.has(agent.agentId)) {
      continue;
    }
    candidateMap.set(agent.agentId, {
      agentId: agent.agentId,
      definitionId: agent.definitionId,
      nodeQualifier: agent.instance.nodeQualifier,
      workspaceQualifier: agent.instance.workspaceQualifier,
      aliases: [agent.instance.selector, agent.instance.defaultSelector],
    });
  }
  const candidates = Array.from(candidateMap.values());

  for (const selector of selectors) {
    if (selector.definitionId === "all") {
      for (const agentId of endpointBackedAgents) {
        targets.add(agentId);
        labels[agentId] = "@all";
      }
      continue;
    }

    const match = resolveAgentSelector(selector, candidates);
    if (match) {
      targets.add(match.agentId);
      labels[match.agentId] = selector.label;
      if (validAgents.has(match.agentId)) {
        continue;
      }

      const fallback = await resolveRelayAgentConfig(selector, {
        currentDirectory: desktopCurrentDirectory(),
      });
      if (fallback) {
        targets.add(fallback.agentId);
        labels[fallback.agentId] = selector.label;
      }
    }
  }

  return {
    actorIds: Array.from(targets).sort(),
    labels,
  };
}

async function postMessageAndInvocations(
  appInfo: DesktopAppInfo,
  input: SendRelayMessageInput,
): Promise<DesktopShellState> {
  const liveBroker = await readLiveBrokerState(await brokerServiceStatus());
  const status = liveBroker.status;
  const snapshot = liveBroker.snapshot;
  const node = liveBroker.node;
  if (!snapshot || !node?.id) {
    throw new Error("Broker snapshot is unavailable.");
  }

  await ensureOperatorActor(status.brokerUrl);
  await ensureCoreConversation(status.brokerUrl, snapshot, node.id, SHARED_CHANNEL_ID);
  await ensureCoreConversation(status.brokerUrl, snapshot, node.id, VOICE_CHANNEL_ID);
  await ensureCoreConversation(status.brokerUrl, snapshot, node.id, SYSTEM_CHANNEL_ID);

  const directTarget = input.destinationKind === "direct" ? input.destinationId : null;
  if (directTarget) {
    if (directTarget === SCOUT_AGENT_ID) {
      await ensureScoutRelayAgentConfigured({ currentDirectory: desktopCurrentDirectory() });
    }
    await ensureLocalAgentBindingOnBroker(status.brokerUrl, snapshot, node.id, directTarget);
  }

  const mentionTargets = await parseMentionTargets(input.body, snapshot);
  for (const targetAgentId of mentionTargets.actorIds) {
    await ensureLocalAgentBindingOnBroker(status.brokerUrl, snapshot, node.id, targetAgentId);
  }
  const invokeTargets = unique([...(directTarget ? [directTarget] : []), ...mentionTargets.actorIds])
    .filter((targetAgentId) => Boolean(snapshot.agents[targetAgentId]));
  const requestedHarness = input.harness && SUPPORTED_LOCAL_AGENT_HARNESSES.includes(input.harness as AgentHarness)
    ? input.harness as AgentHarness
    : undefined;

  const referenceMessageIds = normalizeMessageReferenceIds(input.referenceMessageIds);
  const referencedMessages = referenceMessageIds
    .map((messageId) => referencedMessageContext(snapshot, messageId))
    .filter((entry): entry is ReferencedMessageContext => Boolean(entry));
  const effectiveReplyToMessageId = input.replyToMessageId ?? referencedMessages[0]?.id ?? undefined;

  let conversationId = SHARED_CHANNEL_ID;
  let visibility = "workspace";
  let messageClass = "agent";

  if (input.destinationKind === "channel" && input.destinationId === "voice") {
    conversationId = VOICE_CHANNEL_ID;
  } else if (input.destinationKind === "channel" && input.destinationId === "system") {
    conversationId = SYSTEM_CHANNEL_ID;
    visibility = "system";
    messageClass = "system";
  } else if (input.destinationKind === "direct" && directTarget) {
    conversationId = await ensureDirectConversation(status.brokerUrl, snapshot, node.id, directTarget);
    visibility = "private";
  }

  const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await brokerPost(status.brokerUrl, "/v1/messages", {
    id: messageId,
    conversationId,
    replyToMessageId: effectiveReplyToMessageId,
    actorId: OPERATOR_ID,
    originNodeId: node.id,
    class: messageClass,
    body: input.body.trim(),
    mentions: invokeTargets.map((actorId) => ({
      actorId,
      label: actorId === directTarget ? `@${actorId}` : (mentionTargets.labels[actorId] ?? `@${actorId}`),
    })),
    audience: invokeTargets.length > 0
      ? {
          notify: invokeTargets,
          reason: directTarget ? "direct_message" : "mention",
        }
      : undefined,
    visibility,
    policy: "durable",
    createdAt: Date.now(),
    metadata: {
      source: "electron-app",
      destinationKind: input.destinationKind,
      destinationId: input.destinationId,
      referenceMessageIds,
      clientMessageId: input.clientMessageId ?? null,
    },
  });

  for (const targetAgentId of invokeTargets) {
    await brokerPost(status.brokerUrl, "/v1/invocations", {
      id: `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      requesterId: OPERATOR_ID,
      requesterNodeId: node.id,
      targetAgentId,
      action: "consult",
      task: input.body.trim(),
      conversationId,
      messageId,
      context: referencedMessages.length > 0
        ? {
            reference_message_ids: referenceMessageIds.join(", "),
            referenced_messages: referencedMessages.map(formatReferencedMessageContext).join("\n\n"),
          }
        : undefined,
      execution: requestedHarness
        ? {
            harness: requestedHarness,
          }
        : undefined,
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: {
        source: "electron-app",
        destinationKind: input.destinationKind,
      },
    });
  }

  return buildDesktopShellState(appInfo);
}

export async function buildDesktopShellState(appInfo: DesktopAppInfo): Promise<DesktopShellState> {
  const [status, helper, setup] = await Promise.all([
    brokerServiceStatus(),
    Promise.resolve(readHelperStatus()),
    readResolvedRelayAgents(),
  ]);
  const liveBroker = await readLiveBrokerState(status);
  const tmuxSessions = readTmuxSessions();
  const snapshot = liveBroker.snapshot;
  const configuredAgentIds = new Set(setup.agents.map((agent) => agent.agentId));
  const messagesByConversation = snapshot ? buildMessagesByConversation(snapshot) : null;
  const directActivity = snapshot ? buildDirectAgentActivity(snapshot, tmuxSessions, messagesByConversation) : null;
  const visibleAgentCount = snapshot && messagesByConversation && directActivity
    ? visibleRelayAgentIds(snapshot, configuredAgentIds, messagesByConversation, directActivity).size
    : setup.agents.length;
  if (snapshot) {
    relayVoiceBridgeService.syncRelayPlayback(snapshot);
  }
  const plans = await buildPlansState(snapshot, tmuxSessions);
  const latestRelayLabel = latestRelayLabelFromSnapshot(snapshot);

  return {
    appInfo,
    runtime: buildRuntimeState(snapshot, tmuxSessions, latestRelayLabel, helper, liveBroker.status, visibleAgentCount),
    machines: snapshot
      ? buildMachinesState(snapshot, tmuxSessions, status.health.nodeId ?? null)
      : buildEmptyMachinesState(),
    plans,
    sessions: snapshot ? buildSessions(snapshot) : [],
    interAgent: snapshot
      ? buildInterAgentState(snapshot, tmuxSessions, configuredAgentIds)
      : {
          title: "Inter-Agent",
          subtitle: "Broker unavailable",
          agents: [],
          threads: [],
          lastUpdatedLabel: null,
        },
    relay: snapshot
      ? buildRelayState(snapshot, tmuxSessions, configuredAgentIds)
      : {
          title: "Relay",
          subtitle: "Broker unavailable",
          transportTitle: "Broker-backed",
          meshTitle: "Local mesh",
          syncLine: "Disconnected",
          operatorId: OPERATOR_ID,
          channels: [],
          views: [],
          directs: [],
          messages: [],
          voice: relayVoiceBridgeService.getRelayVoiceState(),
          lastUpdatedLabel: null,
        },
  };
}

export async function getAppSettings(): Promise<AppSettingsState> {
  const [setup, status, catalog] = await Promise.all([
    readResolvedRelayAgents({
      syncLegacyMirror: true,
    }, {
      force: true,
    }),
    brokerServiceStatus(),
    loadHarnessCatalogSnapshot(),
  ]);
  const record = await readOpenScoutSettings({ currentDirectory: desktopCurrentDirectory() });
  const telegram = telegramBridgeService.getRuntimeState();
  const readinessByHarness = new Map(
    catalog.entries.map((entry) => [entry.harness, entry.readinessReport] as const),
  );
  const hasSourceRoots = setup.settings.discovery.workspaceRoots.length > 0;
  const hasReadyRuntime = catalog.entries.some((entry) => entry.readinessReport.ready);
  const hasCurrentProjectConfig = Boolean(setup.currentProjectConfigPath);
  const onboardingProgress = record.onboarding;
  const onboardingSteps = [
    {
      id: "source-roots",
      title: "Choose a source root",
      detail: hasSourceRoots
        ? `${setup.settings.discovery.workspaceRoots.length} source root${setup.settings.discovery.workspaceRoots.length === 1 ? "" : "s"} currently configured.`
        : "Add the parent directory that contains your repos so OpenScout can walk it for projects.",
      complete: Boolean(onboardingProgress.sourceRootsAnsweredAt),
    },
    {
      id: "harness",
      title: "Choose a default harness",
      detail: `Current default harness: ${setup.settings.agents.defaultHarness}.`,
      complete: Boolean(onboardingProgress.harnessChosenAt),
    },
    {
      id: "confirm",
      title: "Confirm and save inputs",
      detail: onboardingProgress.inputsSavedAt
        ? "Inputs have been explicitly saved for onboarding."
        : "Save the onboarding inputs before running the command steps.",
      complete: Boolean(onboardingProgress.inputsSavedAt),
    },
    {
      id: "init",
      title: "Run init",
      detail: hasCurrentProjectConfig
        ? "The current repo currently has a local `.openscout/project.json`."
        : "Run `scout init` from this screen to create a local `.openscout/project.json` for the repo you launched from.",
      complete: Boolean(onboardingProgress.initRanAt),
    },
    {
      id: "doctor",
      title: "Run doctor",
      detail: setup.projectInventory.length > 0
        ? `${setup.projectInventory.length} project${setup.projectInventory.length === 1 ? "" : "s"} currently appear in inventory.`
        : "OpenScout has not discovered any projects yet.",
      complete: Boolean(onboardingProgress.doctorRanAt),
    },
    {
      id: "runtimes",
      title: "Run runtimes",
      detail: hasReadyRuntime
        ? "At least one harness is installed and authenticated."
        : "Install or sign into Claude or Codex so the broker can start local agent sessions.",
      complete: Boolean(onboardingProgress.runtimesRanAt),
    },
  ];
  const onboardingNeeded = !(onboardingProgress.completedAt || onboardingProgress.skippedAt);

  return {
    operatorId: OPERATOR_ID,
    operatorName: normalizeOperatorName(record.profile.operatorName),
    operatorNameDefault: DEFAULT_OPERATOR_DISPLAY_NAME,
    note: "Shown across Relay, Inter-Agent, and other desktop surfaces. Clear it to fall back to the default name.",
    settingsPath: setup.settingsPath,
    relayAgentsPath: setup.relayAgentsPath,
    relayHubPath: setup.relayHubPath,
    supportDirectory: setup.supportDirectory,
    currentProjectConfigPath: setup.currentProjectConfigPath,
    workspaceRoots: setup.settings.discovery.workspaceRoots.map((root) => compactHomePath(root) ?? root),
    workspaceRootsNote: "Source roots are user-configured. OpenScout walks them recursively to find project roots and harness evidence.",
    includeCurrentRepo: setup.settings.discovery.includeCurrentRepo,
    defaultHarness: setup.settings.agents.defaultHarness,
    defaultTransport: setup.settings.agents.defaultTransport,
    defaultCapabilities: [...setup.settings.agents.defaultCapabilities],
    sessionPrefix: setup.settings.agents.sessionPrefix,
    telegram: {
      enabled: record.bridges.telegram.enabled,
      mode: record.bridges.telegram.mode,
      botToken: record.bridges.telegram.botToken,
      secretToken: record.bridges.telegram.secretToken,
      apiBaseUrl: record.bridges.telegram.apiBaseUrl,
      userName: record.bridges.telegram.userName,
      defaultConversationId: record.bridges.telegram.defaultConversationId,
      ownerNodeId: record.bridges.telegram.ownerNodeId,
      configured: telegram.configured,
      running: telegram.running,
      runtimeMode: telegram.runtimeMode,
      detail: telegram.detail,
      lastError: telegram.lastError,
      bindingCount: telegram.bindingCount,
      pendingDeliveries: telegram.pendingDeliveries,
    },
    discoveredAgents: setup.discoveredAgents.map((agent) => ({
      id: agent.agentId,
      title: agent.displayName,
      root: compactHomePath(agent.projectRoot) ?? agent.projectRoot,
      source: agent.source,
      registrationKind: agent.registrationKind,
      harness: agent.runtime.harness,
      sessionId: agent.runtime.sessionId,
      projectConfigPath: agent.projectConfigPath ? compactHomePath(agent.projectConfigPath) ?? agent.projectConfigPath : null,
    })),
    projectInventory: setup.projectInventory.map((project) => ({
      id: project.agentId,
      definitionId: project.definitionId,
      title: project.displayName,
      projectName: project.projectName,
      root: compactHomePath(project.projectRoot) ?? project.projectRoot,
      sourceRoot: compactHomePath(project.sourceRoot) ?? project.sourceRoot,
      relativePath: project.relativePath,
      source: project.source,
      registrationKind: project.registrationKind,
      defaultHarness: project.defaultHarness,
      projectConfigPath: project.projectConfigPath ? compactHomePath(project.projectConfigPath) ?? project.projectConfigPath : null,
      harnesses: project.harnesses.map((harness) => ({
        harness: harness.harness,
        source: harness.source,
        detail: harness.detail,
        readinessState: readinessByHarness.get(harness.harness)?.state ?? null,
        readinessDetail: readinessByHarness.get(harness.harness)?.detail ?? null,
      })),
    })),
    runtimeCatalog: catalog.entries.map((entry) => ({
      name: entry.name,
      label: entry.label,
      readinessState: entry.readinessReport.state,
      readinessDetail: entry.readinessReport.detail,
    })),
    onboarding: {
      needed: onboardingNeeded,
      title: onboardingNeeded ? "Finish First-Run Setup" : "OpenScout Is Ready",
      detail: onboardingNeeded
        ? "Use the same `scout init`, `scout doctor`, and `scout runtimes` commands from this screen. The wizard tracks your explicit progress instead of guessing from current machine state."
        : "OpenScout onboarding has been completed or skipped for this machine. You can still revisit the setup screens any time.",
      commands: [
        "scout init --source-root ~/dev",
        "scout doctor",
        "scout runtimes",
      ],
      steps: onboardingSteps,
    },
    broker: {
      label: status.label,
      url: status.brokerUrl,
      installed: status.installed,
      loaded: status.loaded,
      reachable: status.reachable,
      launchAgentPath: compactHomePath(status.launchAgentPath) ?? status.launchAgentPath,
      stdoutLogPath: compactHomePath(status.stdoutLogPath) ?? status.stdoutLogPath,
      stderrLogPath: compactHomePath(status.stderrLogPath) ?? status.stderrLogPath,
    },
  };
}

export async function getPhonePreparation(): Promise<PhonePreparationState> {
  const record = await readOpenScoutSettings({ currentDirectory: desktopCurrentDirectory() });
  return {
    favorites: [...record.phone.favorites],
    quickHits: [...record.phone.quickHits],
    preparedAt: record.phone.preparedAt,
  };
}

export async function updatePhonePreparation(input: UpdatePhonePreparationInput): Promise<PhonePreparationState> {
  await writeOpenScoutSettings({
    phone: {
      favorites: input.favorites,
      quickHits: input.quickHits,
      preparedAt: input.preparedAt,
    },
  }, {
    currentDirectory: desktopCurrentDirectory(),
  });

  return getPhonePreparation();
}

export async function getLogCatalog(): Promise<DesktopLogCatalog> {
  const [sources, broker] = await Promise.all([
    buildResolvedLogCatalog(),
    brokerServiceStatus(),
  ]);

  return {
    sources: sources.map(({ paths: _paths, ...source }) => source),
    defaultSourceId: broker.reachable ? "broker" : "app",
  };
}

export async function getBrokerInspector(): Promise<DesktopBrokerInspector> {
  const status = await brokerServiceStatus();
  const processId = resolveBrokerProcessId(status.brokerUrl, status.pid);
  const processCommand = readProcessCommand(processId);
  const lastRestartLabel = formatProcessStartLabel(processId);
  const version = runtimeVersionLabel();
  const { label, detail } = brokerStatusLabel(status);
  const counts = status.health.counts;

  return {
    statusLabel: label,
    statusDetail: detail,
    version,
    label: status.label,
    mode: status.mode,
    url: status.brokerUrl,
    installed: status.installed,
    loaded: status.loaded,
    reachable: status.reachable,
    pid: processId ? String(processId) : null,
    processCommand,
    lastRestartLabel,
    nodeId: status.health.nodeId ?? null,
    meshId: status.health.meshId ?? null,
    launchdState: status.launchdState,
    lastExitStatus: status.lastExitStatus !== null ? String(status.lastExitStatus) : null,
    lastLogLine: status.lastLogLine,
    supportDirectory: compactHomePath(status.supportDirectory) ?? status.supportDirectory,
    controlHome: compactHomePath(status.controlHome) ?? status.controlHome,
    launchAgentPath: compactHomePath(status.launchAgentPath) ?? status.launchAgentPath,
    stdoutLogPath: compactHomePath(status.stdoutLogPath) ?? status.stdoutLogPath,
    stderrLogPath: compactHomePath(status.stderrLogPath) ?? status.stderrLogPath,
    actorCount: counts?.actors ?? null,
    agentCount: counts?.agents ?? null,
    conversationCount: counts?.conversations ?? null,
    messageCount: counts?.messages ?? null,
    flightCount: counts?.flights ?? null,
    troubleshooting: brokerTroubleshootingHints(status),
    feedbackSummary: brokerFeedbackSummary(status, processId, processCommand, lastRestartLabel, version),
  };
}

export async function readLogSource(input: ReadLogSourceInput): Promise<DesktopLogContent> {
  const sources = await buildResolvedLogCatalog();
  const source = sources.find((entry) => entry.id === input.sourceId);
  if (!source) {
    throw new Error(`Unknown log source: ${input.sourceId}`);
  }
  return tailLogSource(source, input.tailLines ?? 240);
}

export async function getAgentSession(agentId: string): Promise<AgentSessionInspector> {
  const agentConfig = await getLocalAgentConfig(agentId);
  const configuredTitle = agentConfig?.agentId ?? agentId;
  const configuredHarness = agentConfig?.runtime.harness ?? null;
  const configuredTransport = agentConfig?.runtime.transport ?? null;
  const configuredSessionId = agentConfig?.runtime.sessionId ?? null;
  const configuredDirectoryPath = agentConfig?.runtime.cwd ?? null;
  const configuredCwd = compactHomePath(configuredDirectoryPath ?? "") || null;

  // Most relay agents are local tmux-backed sessions. Check the canonical local config first
  // so the UI can render immediately instead of waiting on broker status and snapshot fetches.
  if (configuredTransport === "tmux" && configuredSessionId) {
    const tmuxCapture = captureTmuxPane(configuredSessionId, 180);
    if (!tmuxCapture.missing) {
      return {
        agentId,
        title: configuredTitle,
        subtitle: configuredCwd ? `Live tmux pane capture · ${configuredCwd}` : "Live tmux pane capture",
        mode: "tmux",
        harness: configuredHarness,
        transport: configuredTransport,
        sessionId: configuredSessionId,
        commandLabel: `tmux attach -t ${configuredSessionId}`,
        pathLabel: configuredCwd ? `${configuredCwd} · tmux:${configuredSessionId}` : `tmux:${configuredSessionId}`,
        directoryPath: configuredDirectoryPath,
        body: tmuxCapture.body,
        updatedAtLabel: null,
        lineCount: tmuxCapture.lineCount,
        truncated: tmuxCapture.truncated,
        missing: false,
      };
    }
  }

  const logCapture = await readAgentSessionLogs(agentId, 180);

  const liveBroker = await readLiveBrokerState(await brokerServiceStatus());
  const snapshot = liveBroker.snapshot;
  const agent = snapshot?.agents?.[agentId] as AgentRecord | undefined;
  const endpoint = snapshot ? activeEndpoint(snapshot, agentId) : null;

  const title = agent?.displayName ?? configuredTitle;
  const harness = endpoint?.harness ?? configuredHarness;
  const transport = endpoint?.transport ?? configuredTransport;
  const sessionId = endpoint?.sessionId ?? configuredSessionId;
  const directoryPath = endpoint?.cwd ?? configuredDirectoryPath;
  const cwd = compactHomePath(directoryPath ?? "") || null;

  if (transport === "tmux" && sessionId) {
    const tmuxCapture = captureTmuxPane(sessionId, 180);
    if (!tmuxCapture.missing) {
      return {
        agentId,
        title,
        subtitle: cwd ? `Live tmux pane capture · ${cwd}` : "Live tmux pane capture",
        mode: "tmux",
        harness,
        transport,
        sessionId,
        commandLabel: `tmux attach -t ${sessionId}`,
        pathLabel: cwd ? `${cwd} · tmux:${sessionId}` : `tmux:${sessionId}`,
        directoryPath,
        body: tmuxCapture.body,
        updatedAtLabel: null,
        lineCount: tmuxCapture.lineCount,
        truncated: tmuxCapture.truncated,
        missing: false,
      };
    }
  }

  if (!logCapture.missing) {
    return {
      agentId,
      title,
      subtitle: transport && transport !== "tmux"
        ? `${transport} session logs`
        : "Runtime session logs",
      mode: "logs",
      harness,
      transport,
      sessionId,
      commandLabel: null,
      pathLabel: logCapture.pathLabel,
      directoryPath: relayAgentLogsDirectory(agentId),
      body: logCapture.body,
      updatedAtLabel: logCapture.updatedAtLabel,
      lineCount: logCapture.lineCount,
      truncated: logCapture.truncated,
      missing: false,
    };
  }

  return {
    agentId,
    title,
    subtitle: "No live tmux pane or session logs available yet.",
    mode: "none",
    harness,
    transport,
    sessionId,
    commandLabel: sessionId && transport === "tmux" ? `tmux attach -t ${sessionId}` : null,
    pathLabel: cwd,
    directoryPath,
    body: "",
    updatedAtLabel: null,
    lineCount: 0,
    truncated: false,
    missing: true,
  };
}

export async function runOnboardingCommand(input: RunOnboardingCommandInput): Promise<OnboardingCommandResult> {
  const command = input.command;
  const currentDirectory = desktopCurrentDirectory();
  const repoRoot = desktopRepoRoot();
  const cliEntrypoint = desktopCliEntrypoint();
  const normalizedSourceRoots = Array.from(new Set(
    (input.sourceRoots ?? [])
      .map((entry) => expandHomePath(entry).trim())
      .filter(Boolean),
  ));

  const displayArgs = ["scout", command];
  const execArgs = ["run", cliEntrypoint, command];
  if (command === "init") {
    for (const sourceRoot of normalizedSourceRoots) {
      displayArgs.push("--source-root", compactHomePath(sourceRoot) ?? sourceRoot);
      execArgs.push("--source-root", sourceRoot);
    }
  }

  const result = await new Promise<OnboardingCommandResult>((resolvePromise, reject) => {
    const child = spawn("bun", execArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENSCOUT_SETUP_CWD: currentDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      const stdoutText = stdout.trim();
      const stderrText = stderr.trim();
      const output = [stdoutText, stderrText].filter(Boolean).join("\n\n").trim();
      resolvePromise({
        command,
        commandLine: displayArgs.join(" "),
        cwd: compactHomePath(currentDirectory) ?? currentDirectory,
        exitCode: code ?? 0,
        stdout: stdoutText,
        stderr: stderrText,
        output: output || "(no output)",
      });
    });
  });

  invalidateResolvedRelayAgentsCache();
  if (result.exitCode === 0) {
    const now = Date.now();
    await writeOpenScoutSettings({
      onboarding: input.command === "init"
        ? {
          initRanAt: now,
        }
        : input.command === "doctor"
          ? {
            doctorRanAt: now,
          }
          : {
            runtimesRanAt: now,
            completedAt: now,
          },
    }, {
      currentDirectory,
    });
  }
  return result;
}

export async function skipOnboarding(): Promise<AppSettingsState> {
  await writeOpenScoutSettings({
    onboarding: {
      skippedAt: Date.now(),
    },
  }, {
    currentDirectory: desktopCurrentDirectory(),
  });
  invalidateResolvedRelayAgentsCache();
  return getAppSettings();
}

export async function updateAppSettings(input: UpdateAppSettingsInput): Promise<AppSettingsState> {
  const trimmedOperatorName = input.operatorName?.trim() ?? "";
  const defaultHarness: AgentHarness = SUPPORTED_LOCAL_AGENT_HARNESSES.includes(input.defaultHarness as AgentHarness)
    ? input.defaultHarness as AgentHarness
    : "claude";
  const now = Date.now();
  await writeOpenScoutSettings({
    profile: {
      operatorName: trimmedOperatorName || DEFAULT_OPERATOR_DISPLAY_NAME,
    },
    onboarding: {
      sourceRootsAnsweredAt: splitLines(input.workspaceRootsText).length > 0 ? now : null,
      harnessChosenAt: now,
      inputsSavedAt: now,
    },
    discovery: {
      workspaceRoots: splitLines(input.workspaceRootsText).map((entry) => expandHomePath(entry)),
      includeCurrentRepo: input.includeCurrentRepo,
    },
    agents: {
      defaultHarness,
      defaultTransport: defaultHarness === "codex" ? "codex_app_server" : "claude_stream_json",
      defaultCapabilities: splitDelimitedTokens(input.defaultCapabilitiesText) as Array<"chat" | "invoke" | "deliver" | "speak" | "listen" | "bridge" | "summarize" | "review" | "execute">,
      sessionPrefix: input.sessionPrefix,
    },
    bridges: {
      telegram: {
        enabled: input.telegram.enabled,
        mode: input.telegram.mode,
        botToken: input.telegram.botToken,
        secretToken: input.telegram.secretToken,
        apiBaseUrl: input.telegram.apiBaseUrl,
        userName: input.telegram.userName,
        defaultConversationId: input.telegram.defaultConversationId,
        ownerNodeId: input.telegram.ownerNodeId,
      },
    },
  }, {
    currentDirectory: desktopCurrentDirectory(),
  });
  invalidateResolvedRelayAgentsCache();
  await telegramBridgeService.refreshConfiguration();

  const status = await brokerServiceStatus();
  if (status.reachable) {
    try {
      await ensureOperatorActor(status.brokerUrl);
      await syncAllLocalAgentBindingsToBroker();
    } catch {
      // Persisting settings should not fail just because the live broker actor could not refresh.
    }
  }

  return getAppSettings();
}

async function syncLocalAgentBindingToBroker(agentId: string, ensureOnline = false): Promise<void> {
  const liveBroker = await readLiveBrokerState(await brokerServiceStatus());
  const status = liveBroker.status;
  const node = liveBroker.node;
  if (!node) {
    return;
  }

  const bindings = await loadRegisteredLocalAgentBindings(node.id, {
    agentIds: [agentId],
    ensureOnline,
  });
  const binding = bindings[0];
  if (!binding) {
    return;
  }

  await brokerPost(status.brokerUrl, "/v1/actors", binding.actor);
  await brokerPost(status.brokerUrl, "/v1/agents", binding.agent);
  await brokerPost(status.brokerUrl, "/v1/endpoints", binding.endpoint);
}

async function syncAllLocalAgentBindingsToBroker(): Promise<void> {
  const liveBroker = await readLiveBrokerState(await brokerServiceStatus());
  const status = liveBroker.status;
  const node = liveBroker.node;
  if (!node) {
    return;
  }

  const bindings = await loadRegisteredLocalAgentBindings(node.id);
  for (const binding of bindings) {
    await brokerPost(status.brokerUrl, "/v1/actors", binding.actor);
    await brokerPost(status.brokerUrl, "/v1/agents", binding.agent);
    await brokerPost(status.brokerUrl, "/v1/endpoints", binding.endpoint);
  }
}

export async function getAgentConfig(agentId: string): Promise<AgentConfigState> {
  const agentConfig = await getLocalAgentConfig(agentId);
  if (agentConfig) {
    const runtimeDirectory = relayAgentRuntimeDirectory(agentId);
    const logsDirectory = relayAgentLogsDirectory(agentId);
    return {
      agentId,
      editable: agentConfig.editable,
      title: agentId,
      typeLabel: "Relay Agent",
      applyModeLabel: "Save changes, then restart to apply runtime, prompt, and capability updates.",
      note: `Stored in the canonical relay agent registry. Runtime files live at ${compactHomePath(runtimeDirectory) ?? runtimeDirectory} and logs at ${compactHomePath(logsDirectory) ?? logsDirectory}.`,
      systemPromptHint: agentConfig.templateHint,
      availableHarnesses: [...SUPPORTED_LOCAL_AGENT_HARNESSES],
      runtime: {
        cwd: compactHomePath(agentConfig.runtime.cwd) ?? agentConfig.runtime.cwd,
        projectRoot: compactHomePath(agentConfig.runtime.cwd),
        harness: agentConfig.runtime.harness,
        transport: agentConfig.runtime.transport,
        sessionId: agentConfig.runtime.sessionId,
        wakePolicy: agentConfig.runtime.wakePolicy,
        source: "relay-agent-registry",
      },
      systemPrompt: agentConfig.systemPrompt,
      toolUse: {
        launchArgsText: agentConfig.launchArgs.join("\n"),
      },
      capabilitiesText: agentConfig.capabilities.join(", "),
    };
  }

  const liveBroker = await readLiveBrokerState(await brokerServiceStatus());
  const snapshot = liveBroker.snapshot;
  const agent = snapshot?.agents?.[agentId] as AgentRecord | undefined;
  const endpoint = snapshot ? activeEndpoint(snapshot, agentId) : null;
  if (!agent) {
    return {
      agentId,
      editable: false,
      title: agentId,
      typeLabel: "Agent",
      applyModeLabel: null,
      note: "The selected agent is not currently present in the broker snapshot.",
      systemPromptHint: null,
      availableHarnesses: [...SUPPORTED_LOCAL_AGENT_HARNESSES],
      runtime: {
        cwd: "",
        projectRoot: null,
        harness: "",
        transport: "",
        sessionId: "",
        wakePolicy: "",
        source: null,
      },
      systemPrompt: "Agent system prompt unavailable.",
      toolUse: {
        launchArgsText: "",
      },
      capabilitiesText: "",
    };
  }

  const role = typeof agent.metadata?.role === "string" ? String(agent.metadata.role) : "Not reported";
  const summary = typeof agent.metadata?.summary === "string" ? String(agent.metadata.summary) : "Not reported";
  const capabilities = Array.isArray(agent.capabilities) && agent.capabilities.length > 0
    ? agent.capabilities.join(", ")
    : "Not reported";

  return {
    agentId,
    editable: false,
    title: agent.displayName ?? agentId,
    typeLabel: agentTypeLabel(agent),
    applyModeLabel: null,
    note: "Built-in role agents are not editable yet.",
    systemPromptHint: null,
    availableHarnesses: [...SUPPORTED_LOCAL_AGENT_HARNESSES],
    runtime: {
      cwd: compactHomePath(endpoint?.cwd) ?? "",
      projectRoot: compactHomePath(endpoint?.projectRoot ?? endpoint?.cwd),
      harness: endpoint?.harness ?? "",
      transport: endpoint?.transport ?? "",
      sessionId: endpoint?.sessionId ?? "",
      wakePolicy: agent.wakePolicy ?? "",
      source: typeof agent.metadata?.source === "string" ? String(agent.metadata.source) : null,
    },
    systemPrompt: [
      `Display name: ${agent.displayName ?? agentId}`,
      `Class: ${agent.agentClass ?? "Not reported"}`,
      `Role: ${role}`,
      `Summary: ${summary}`,
      `Capabilities: ${capabilities}`,
    ].join("\n"),
    toolUse: {
      launchArgsText: "",
    },
    capabilitiesText: Array.isArray(agent.capabilities) ? agent.capabilities.join(", ") : "",
  };
}

export async function updateAgentConfig(input: UpdateAgentConfigInput): Promise<AgentConfigState> {
  const nextConfig = await updateLocalAgentConfig(input.agentId, {
    runtime: {
      cwd: input.runtime.cwd,
      harness: input.runtime.harness,
      sessionId: input.runtime.sessionId,
    },
    systemPrompt: input.systemPrompt,
    launchArgs: splitLines(input.toolUse.launchArgsText),
    capabilities: splitDelimitedTokens(input.capabilitiesText),
  });
  if (!nextConfig) {
    throw new Error(`Agent ${input.agentId} is not an editable relay agent.`);
  }

  return {
    agentId: input.agentId,
    editable: nextConfig.editable,
    title: input.agentId,
    typeLabel: "Relay Agent",
    applyModeLabel: "Saved. Restart to apply runtime, prompt, and capability updates.",
    note: "Saved to the local relay registry.",
    systemPromptHint: nextConfig.templateHint,
    availableHarnesses: [...SUPPORTED_LOCAL_AGENT_HARNESSES],
    runtime: {
      cwd: compactHomePath(nextConfig.runtime.cwd) ?? nextConfig.runtime.cwd,
      projectRoot: compactHomePath(nextConfig.runtime.cwd),
      harness: nextConfig.runtime.harness,
      transport: nextConfig.runtime.transport,
      sessionId: nextConfig.runtime.sessionId,
      wakePolicy: nextConfig.runtime.wakePolicy,
      source: "relay-agent-registry",
    },
    systemPrompt: nextConfig.systemPrompt,
    toolUse: {
      launchArgsText: nextConfig.launchArgs.join("\n"),
    },
    capabilitiesText: nextConfig.capabilities.join(", "),
  };
}

export async function restartAgent(appInfo: DesktopAppInfo, input: RestartAgentInput): Promise<DesktopShellState> {
  const nextRecord = await restartLocalAgent(input.agentId, {
    previousSessionId: input.previousSessionId ?? null,
  });
  if (!nextRecord) {
    throw new Error(`Agent ${input.agentId} is not an editable relay agent.`);
  }

  await syncLocalAgentBindingToBroker(input.agentId, true);
  return buildDesktopShellState(appInfo);
}

export async function controlBroker(appInfo: DesktopAppInfo, action: BrokerControlAction): Promise<DesktopShellState> {
  switch (action) {
    case "start":
      await startBrokerService();
      await telegramBridgeService.refreshConfiguration();
      try {
        const status = await brokerServiceStatus();
        await ensureOperatorActor(status.brokerUrl);
        await syncAllLocalAgentBindingsToBroker();
      } catch {
        // A restarted broker can still be warming; return live state even if reconciliation has to catch up.
      }
      break;
    case "stop":
      await stopBrokerService();
      break;
    case "restart":
      await restartBrokerService();
      await telegramBridgeService.refreshConfiguration();
      try {
        const status = await brokerServiceStatus();
        await ensureOperatorActor(status.brokerUrl);
        await syncAllLocalAgentBindingsToBroker();
      } catch {
        // A restarted broker can still be warming; return live state even if reconciliation has to catch up.
      }
      break;
  }

  return buildDesktopShellState(appInfo);
}

export async function sendRelayMessage(appInfo: DesktopAppInfo, input: SendRelayMessageInput): Promise<DesktopShellState> {
  return postMessageAndInvocations(appInfo, input);
}

export async function toggleVoiceCapture(appInfo: DesktopAppInfo): Promise<DesktopShellState> {
  await relayVoiceBridgeService.toggleCapture();
  return buildDesktopShellState(appInfo);
}

export async function setVoiceRepliesEnabled(
  appInfo: DesktopAppInfo,
  enabled: boolean,
): Promise<DesktopShellState> {
  await relayVoiceBridgeService.setRepliesEnabled(enabled);
  return buildDesktopShellState(appInfo);
}
