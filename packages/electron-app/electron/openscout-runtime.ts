import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  brokerServiceStatus,
  restartBrokerService,
  startBrokerService,
  stopBrokerService,
} from "../../runtime/src/broker-service.js";
import {
  buildTwinSystemPrompt,
  getProjectTwinConfig,
  loadRegisteredProjectTwinBindings,
  restartProjectTwin,
  SUPPORTED_TWIN_HARNESSES,
  updateProjectTwinConfig,
} from "../../runtime/src/project-twins.js";
import {
  initializeOpenScoutSetup,
  loadResolvedRelayAgents,
  readOpenScoutSettings,
  writeOpenScoutSettings,
} from "../../runtime/src/setup.js";
import { relayAgentLogsDirectory, relayAgentRuntimeDirectory, resolveOpenScoutSupportPaths } from "../../runtime/src/support-paths.js";
import type { RuntimeRegistrySnapshot } from "../../runtime/src/registry.js";
import { relayVoiceBridgeService } from "./voice-bridge-service.js";

import type {
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
  DesktopPlansState,
  DesktopRuntimeState,
  DesktopShellState,
  DesktopTask,
  DesktopTaskStatus,
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

type TwinWorkspaceRecord = {
  twinId: string;
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
      if (normalizeTimestamp(message.createdAt) < cutoff || !isKnownAgent(snapshot, message.actorId)) {
        continue;
      }
      const recipients = inferRecipients(message, conversation)
        .filter((recipientId) => recipientId !== OPERATOR_ID && recipientId !== message.actorId)
        .filter((recipientId) => isKnownAgent(snapshot, recipientId));
      const participantIds = interAgentParticipantIds(snapshot, [message.actorId, ...recipients]);
      if (participantIds.length >= 2 && participantIds.length <= 3) {
        for (const participantId of participantIds) {
          visible.add(participantId);
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

async function buildResolvedLogCatalog(): Promise<ResolvedLogSource[]> {
  if (cachedLogCatalog && cachedLogCatalog.expiresAt > Date.now()) {
    return cachedLogCatalog.sources;
  }

  const supportPaths = resolveOpenScoutSupportPaths();
  const setup = await loadResolvedRelayAgents({ currentDirectory: desktopCurrentDirectory() });

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

async function readRegisteredTwinWorkspaces(): Promise<TwinWorkspaceRecord[]> {
  const registryPath = path.join(resolveOpenScoutSupportPaths().relayHubDirectory, "twins.json");

  try {
    const raw = JSON.parse(await readFile(registryPath, "utf8")) as Record<string, {
      project?: string;
      cwd?: string;
    }>;
    const records = Object.entries(raw ?? {})
      .map(([twinId, record]) => {
        const cwd = record?.cwd?.trim();
        if (!cwd) {
          return null;
        }

        const resolvedCwd = path.resolve(expandHomePath(cwd));
        return {
          twinId,
          project: record?.project?.trim() || path.basename(resolvedCwd),
          cwd: resolvedCwd,
        } satisfies TwinWorkspaceRecord;
      })
      .filter((entry): entry is TwinWorkspaceRecord => Boolean(entry));

    return Array.from(
      records.reduce((map, entry) => map.set(entry.cwd, entry), new Map<string, TwinWorkspaceRecord>()).values(),
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
  const workspaces = new Map<string, TwinWorkspaceRecord>();

  for (const workspace of await readRegisteredTwinWorkspaces()) {
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
        twinId: endpoint.agentId,
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
              twinId: attributes.twin || workspace.twinId,
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

    const activeTask =
      sanitizeRelayBody(
        activeFlight?.summary?.trim()
        || flightMetadataString(activeFlight, "task")
        || "Working on your latest message.",
      ) || null;

    if (activeFlight) {
      activity.set(agent.id, {
        state: "working",
        reachable: true,
        statusLabel: "Working",
        statusDetail: activeTask,
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
  const [plans, tasks] = await Promise.all([
    loadWorkspacePlans(snapshot),
    Promise.resolve(snapshot ? buildDesktopTasks(snapshot, tmuxSessions) : []),
  ]);
  const workspaceCount = new Set(plans.map((plan) => plan.workspacePath)).size;
  const runningTaskCount = tasks.filter((task) => task.status === "running").length;
  const failedTaskCount = tasks.filter((task) => task.status === "failed").length;
  const completedTaskCount = tasks.filter((task) => task.status === "completed").length;
  const latestTask = tasks[0];
  const latestPlan = plans[0];
  const latestPlanLabel = latestPlan
    ? formatRelativeTime(Math.floor(Date.parse(latestPlan.updatedAt) / 1000))
    : null;

  return {
    title: "Plans",
    subtitle: `${tasks.length} asks · ${plans.length} plans · ${workspaceCount} workspaces`,
    taskCount: tasks.length,
    runningTaskCount,
    failedTaskCount,
    completedTaskCount,
    planCount: plans.length,
    workspaceCount,
    lastUpdatedLabel: latestTask?.ageLabel ?? latestPlanLabel,
    tasks,
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
      return {
        ...message,
        receipt: {
          state: "seen",
          label: "Seen",
          detail: status.body,
        },
      };
    }

    const activity = activityByAgent.get(targetAgentId);
    const isLatestForAgent = latestOperatorDirectMessageByAgent.get(targetAgentId) === message.id;
    if (activity?.state === "working" && isLatestForAgent) {
      return {
        ...message,
        receipt: {
          state: "seen",
          label: "Seen",
          detail: activity.activeTask ?? "Working now.",
        },
      };
    }

    if (activity?.reachable) {
      return {
        ...message,
        receipt: {
          state: "delivered",
          label: "Delivered",
          detail: "Agent available.",
        },
      };
    }

    return {
      ...message,
      receipt: {
        state: "sent",
        label: "Sent",
        detail: "Agent offline.",
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
    Boolean((snapshot.agents as Record<string, AgentRecord>)[participantId]),
  );
}

function isKnownAgent(
  snapshot: RuntimeRegistrySnapshot,
  actorId: string,
  visibleAgentIds?: Set<string>,
) {
  return Boolean((snapshot.agents as Record<string, AgentRecord>)[actorId])
    && (!visibleAgentIds || visibleAgentIds.has(actorId));
}

function interAgentParticipantIds(
  snapshot: RuntimeRegistrySnapshot,
  participantIds: string[],
  visibleAgentIds?: Set<string>,
) {
  return Array.from(
    new Set(
      participantIds.filter((participantId) => participantId !== OPERATOR_ID && isKnownAgent(snapshot, participantId, visibleAgentIds)),
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
  if (agent.metadata?.source === "relay-twin-registry") {
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
  if (agent.metadata?.source === "relay-twin-registry") {
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
      if (!isKnownAgent(snapshot, message.actorId, visibleAgentIds)) {
        continue;
      }

      const recipients = inferRecipients(message, conversation)
        .filter((recipientId) => recipientId !== OPERATOR_ID && recipientId !== message.actorId)
        .filter((recipientId) => isKnownAgent(snapshot, recipientId, visibleAgentIds));

      if (recipients.length === 0) {
        continue;
      }

      const projectedParticipantIds = interAgentParticipantIds(snapshot, [message.actorId, ...recipients], visibleAgentIds);
      if (projectedParticipantIds.length < 2 || projectedParticipantIds.length > 3) {
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
          ? "No inter-agent traffic yet"
          : counterpartCount === 1
            ? "1 agent counterpart"
            : `${counterpartCount} agent counterparts`;

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
  const conversationId = `dm.${OPERATOR_ID}.${agentId}`;
  if (snapshot.conversations[conversationId]) {
    return conversationId;
  }

  await brokerPost(baseUrl, "/v1/conversations", {
    id: conversationId,
    kind: "direct",
    title: actorDisplayName(snapshot, agentId),
    visibility: "private",
    shareMode: "local",
    authorityNodeId: nodeId,
    participantIds: [OPERATOR_ID, agentId].sort(),
    metadata: { surface: "electron" },
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

function parseMentionTargets(body: string, snapshot: RuntimeRegistrySnapshot): string[] {
  const matches = Array.from(body.matchAll(/(^|\s)@([a-z0-9._-]+)/gi)).map((match) => (match[2] ?? "").toLowerCase());
  if (!matches.length) {
    return [];
  }

  const validAgents = new Set(Object.keys(snapshot.agents));
  const endpointBackedAgents = unique(
    Object.values(snapshot.endpoints as Record<string, EndpointRecord>).map((endpoint) => endpoint.agentId),
  );

  const targets = new Set<string>();
  for (const match of matches) {
    if (match === "all") {
      for (const agentId of endpointBackedAgents) {
        targets.add(agentId);
      }
      continue;
    }

    if (validAgents.has(match)) {
      targets.add(match);
    }
  }

  return Array.from(targets).sort();
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
  const mentionTargets = parseMentionTargets(input.body, snapshot);
  const invokeTargets = unique([...(directTarget ? [directTarget] : []), ...mentionTargets]);

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
    replyToMessageId: input.replyToMessageId ?? undefined,
    actorId: OPERATOR_ID,
    originNodeId: node.id,
    class: messageClass,
    body: input.body.trim(),
    mentions: invokeTargets.map((actorId) => ({ actorId, label: `@${actorId}` })),
    audience: invokeTargets.length > 0
      ? {
          notify: invokeTargets,
          invoke: invokeTargets,
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
    loadResolvedRelayAgents({ currentDirectory: desktopCurrentDirectory() }),
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
  const [setup, status] = await Promise.all([
    loadResolvedRelayAgents({
      currentDirectory: desktopCurrentDirectory(),
      syncLegacyMirror: true,
    }),
    brokerServiceStatus(),
  ]);
  const record = await readOpenScoutSettings({ currentDirectory: desktopCurrentDirectory() });

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
    workspaceRootsNote: "Workspace roots are user-configured. OpenScout scans them shallowly for repos and project manifests.",
    includeCurrentRepo: setup.settings.discovery.includeCurrentRepo,
    defaultHarness: setup.settings.agents.defaultHarness,
    defaultTransport: setup.settings.agents.defaultTransport,
    defaultCapabilities: [...setup.settings.agents.defaultCapabilities],
    sessionPrefix: setup.settings.agents.sessionPrefix,
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

export async function updateAppSettings(input: UpdateAppSettingsInput): Promise<AppSettingsState> {
  const trimmedOperatorName = input.operatorName?.trim() ?? "";
  await writeOpenScoutSettings({
    profile: {
      operatorName: trimmedOperatorName || DEFAULT_OPERATOR_DISPLAY_NAME,
    },
    discovery: {
      workspaceRoots: splitLines(input.workspaceRootsText).map((entry) => expandHomePath(entry)),
      includeCurrentRepo: input.includeCurrentRepo,
    },
    agents: {
      defaultHarness: input.defaultHarness === "codex" ? "codex" : "claude",
      defaultTransport: "tmux",
      defaultCapabilities: splitDelimitedTokens(input.defaultCapabilitiesText) as Array<"chat" | "invoke" | "deliver" | "speak" | "listen" | "bridge" | "summarize" | "review" | "execute">,
      sessionPrefix: input.sessionPrefix,
    },
  }, {
    currentDirectory: desktopCurrentDirectory(),
  });
  await initializeOpenScoutSetup({ currentDirectory: desktopCurrentDirectory() });

  const status = await brokerServiceStatus();
  if (status.reachable) {
    try {
      await ensureOperatorActor(status.brokerUrl);
      await syncAllProjectTwinBindingsToBroker();
    } catch {
      // Persisting settings should not fail just because the live broker actor could not refresh.
    }
  }

  return getAppSettings();
}

async function syncProjectTwinBindingToBroker(agentId: string, ensureOnline = false): Promise<void> {
  const liveBroker = await readLiveBrokerState(await brokerServiceStatus());
  const status = liveBroker.status;
  const node = liveBroker.node;
  if (!node) {
    return;
  }

  const bindings = await loadRegisteredProjectTwinBindings(node.id, {
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

async function syncAllProjectTwinBindingsToBroker(): Promise<void> {
  const liveBroker = await readLiveBrokerState(await brokerServiceStatus());
  const status = liveBroker.status;
  const node = liveBroker.node;
  if (!node) {
    return;
  }

  const bindings = await loadRegisteredProjectTwinBindings(node.id);
  for (const binding of bindings) {
    await brokerPost(status.brokerUrl, "/v1/actors", binding.actor);
    await brokerPost(status.brokerUrl, "/v1/agents", binding.agent);
    await brokerPost(status.brokerUrl, "/v1/endpoints", binding.endpoint);
  }
}

export async function getAgentConfig(agentId: string): Promise<AgentConfigState> {
  const twinConfig = await getProjectTwinConfig(agentId);
  if (twinConfig) {
    const runtimeDirectory = relayAgentRuntimeDirectory(agentId);
    const logsDirectory = relayAgentLogsDirectory(agentId);
    return {
      agentId,
      editable: twinConfig.editable,
      title: agentId,
      typeLabel: "Relay Agent",
      applyModeLabel: "Save changes, then restart to apply runtime, prompt, and capability updates.",
      note: `Stored in the canonical relay agent registry. Runtime files live at ${compactHomePath(runtimeDirectory) ?? runtimeDirectory} and logs at ${compactHomePath(logsDirectory) ?? logsDirectory}.`,
      systemPromptHint: twinConfig.templateHint,
      availableHarnesses: [...SUPPORTED_TWIN_HARNESSES],
      runtime: {
        cwd: compactHomePath(twinConfig.runtime.cwd) ?? twinConfig.runtime.cwd,
        projectRoot: compactHomePath(twinConfig.runtime.cwd),
        harness: twinConfig.runtime.harness,
        transport: twinConfig.runtime.transport,
        sessionId: twinConfig.runtime.sessionId,
        wakePolicy: twinConfig.runtime.wakePolicy,
        source: "relay-twin-registry",
      },
      systemPrompt: twinConfig.systemPrompt,
      toolUse: {
        launchArgsText: twinConfig.launchArgs.join("\n"),
      },
      capabilitiesText: twinConfig.capabilities.join(", "),
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
      availableHarnesses: [...SUPPORTED_TWIN_HARNESSES],
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
    availableHarnesses: [...SUPPORTED_TWIN_HARNESSES],
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
  const nextConfig = await updateProjectTwinConfig(input.agentId, {
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
    availableHarnesses: [...SUPPORTED_TWIN_HARNESSES],
    runtime: {
      cwd: compactHomePath(nextConfig.runtime.cwd) ?? nextConfig.runtime.cwd,
      projectRoot: compactHomePath(nextConfig.runtime.cwd),
      harness: nextConfig.runtime.harness,
      transport: nextConfig.runtime.transport,
      sessionId: nextConfig.runtime.sessionId,
      wakePolicy: nextConfig.runtime.wakePolicy,
      source: "relay-twin-registry",
    },
    systemPrompt: nextConfig.systemPrompt,
    toolUse: {
      launchArgsText: nextConfig.launchArgs.join("\n"),
    },
    capabilitiesText: nextConfig.capabilities.join(", "),
  };
}

export async function restartAgent(appInfo: DesktopAppInfo, input: RestartAgentInput): Promise<DesktopShellState> {
  const nextRecord = await restartProjectTwin(input.agentId, {
    previousSessionId: input.previousSessionId ?? null,
  });
  if (!nextRecord) {
    throw new Error(`Agent ${input.agentId} is not an editable relay agent.`);
  }

  await syncProjectTwinBindingToBroker(input.agentId, true);
  return buildDesktopShellState(appInfo);
}

export async function controlBroker(appInfo: DesktopAppInfo, action: BrokerControlAction): Promise<DesktopShellState> {
  switch (action) {
    case "start":
      await startBrokerService();
      try {
        const status = await brokerServiceStatus();
        await ensureOperatorActor(status.brokerUrl);
        await syncAllProjectTwinBindingsToBroker();
      } catch {
        // A restarted broker can still be warming; return live state even if reconciliation has to catch up.
      }
      break;
    case "stop":
      await stopBrokerService();
      break;
    case "restart":
      await restartBrokerService();
      try {
        const status = await brokerServiceStatus();
        await ensureOperatorActor(status.brokerUrl);
        await syncAllProjectTwinBindingsToBroker();
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
