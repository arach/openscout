import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentCapability,
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  AgentHarness,
  InvocationRequest,
} from "@openscout/protocol";

import {
  loadResolvedRelayAgents,
  readRelayAgentOverrides,
  writeRelayAgentOverrides,
  type RelayAgentOverride,
  type ResolvedRelayAgentConfig,
} from "./setup.js";
import {
  relayAgentLogsDirectory,
  relayAgentRuntimeDirectory,
  resolveOpenScoutSupportPaths,
} from "./support-paths.js";

const BUILT_IN_LOCAL_AGENT_IDS = new Set(["scout", "builder", "reviewer", "research"]);
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const OPENSCOUT_REPO_ROOT = resolve(MODULE_DIRECTORY, "..", "..", "..");

type ProjectTwinRecord = {
  project: string;
  tmuxSession: string;
  cwd: string;
  startedAt: number;
  systemPrompt?: string;
  harness?: AgentHarness;
  transport?: "tmux";
  capabilities?: AgentCapability[];
  launchArgs?: string[];
};

export type ProjectTwinConfigState = {
  twinId: string;
  editable: boolean;
  systemPrompt: string;
  runtime: {
    cwd: string;
    harness: AgentHarness;
    transport: "tmux";
    sessionId: string;
    wakePolicy: "on_demand";
  };
  launchArgs: string[];
  capabilities: AgentCapability[];
  applyMode: "restart";
  templateHint: string;
};

export type ProjectTwinBinding = {
  actor: ActorIdentity;
  agent: AgentDefinition;
  endpoint: AgentEndpoint;
};

interface BrokerSnapshotMessage {
  actorId: string;
  body: string;
  createdAt: number;
}

interface BrokerSnapshot {
  messages: Record<string, BrokerSnapshotMessage>;
}

const DEFAULT_TWIN_CAPABILITIES: AgentCapability[] = ["chat", "invoke", "deliver"];
const DEFAULT_TWIN_HARNESS: AgentHarness = "claude";

function resolveRelayHub(): string {
  return resolveOpenScoutSupportPaths().relayHubDirectory;
}

function resolveProjectsRoot(projectPath: string): string {
  if (process.env.OPENSCOUT_PROJECTS_ROOT?.trim()) {
    return resolve(process.env.OPENSCOUT_PROJECTS_ROOT.trim());
  }

  try {
    const supportPaths = resolveOpenScoutSupportPaths();
    if (!existsSync(supportPaths.settingsPath)) {
      return dirname(projectPath);
    }

    const raw = JSON.parse(readFileSync(supportPaths.settingsPath, "utf8")) as {
      discovery?: {
        workspaceRoots?: string[];
      };
    };
    const workspaceRoot = raw.discovery?.workspaceRoots?.find((entry) => typeof entry === "string" && entry.trim().length > 0);
    return workspaceRoot ? resolve(workspaceRoot) : dirname(projectPath);
  } catch {
    return dirname(projectPath);
  }
}

function resolveBrokerUrl(): string {
  return process.env.OPENSCOUT_BROKER_URL ?? "http://127.0.0.1:65535";
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeBrokerTimestamp(value: number): number {
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function brokerRelayCommand(): string {
  return `bun run --cwd ${JSON.stringify(OPENSCOUT_REPO_ROOT)} packages/relay/src/cli.ts relay`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTwinFlightId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCaseTwinName(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export const SUPPORTED_TWIN_HARNESSES: AgentHarness[] = ["claude", "codex"];

type TwinSystemPromptTemplateContext = {
  twinId: string;
  displayName: string;
  projectName: string;
  projectPath: string;
  brokerUrl: string;
  relayCommand: string;
  projectsRoot: string;
  relayHub: string;
  openscoutRoot: string;
};

export const TWIN_SYSTEM_PROMPT_TEMPLATE_HINT = [
  "Supports {{base_prompt}}, {{project_context}}, {{protocol_prompt}}, {{protocol}}, {{twin_id}}, {{display_name}}, ",
  "{{project_name}}, {{project_path}}, {{project_root}}, {{workspace_root}}, {{cwd}}, {{projects_root}}, {{base_path}}, ",
  "{{relay_hub}}, {{broker_url}}, {{relay_command}}, {{openscout_root}}, and {{env.NAME}} variables.",
].join("");

function buildTwinTemplateContext(
  twinId: string,
  projectName: string,
  projectPath: string,
): TwinSystemPromptTemplateContext {
  return {
    twinId,
    displayName: titleCaseTwinName(twinId),
    projectName,
    projectPath,
    brokerUrl: resolveBrokerUrl(),
    relayCommand: brokerRelayCommand(),
    projectsRoot: resolveProjectsRoot(projectPath),
    relayHub: resolveRelayHub(),
    openscoutRoot: OPENSCOUT_REPO_ROOT,
  };
}

function buildTwinBasePrompt(context: TwinSystemPromptTemplateContext): string {
  return [
    `You are "${context.twinId}", a relay agent for the ${context.projectName} project.`,
    "",
    "You are the persistent, project-native runtime for this codebase.",
    "A primary agent may call into you for context, execution, follow-through, and handoff.",
    "",
    "Your job:",
    `  - Respond to @${context.twinId} mentions from other agents`,
    "  - Answer questions about this project's code, architecture, and status",
    "  - Coordinate with other agents when they need project-native context",
    "  - Maintain continuity for ongoing project work",
  ].join("\n");
}

function buildTwinProjectContextPrompt(context: TwinSystemPromptTemplateContext): string {
  return [
    "Project context:",
    `  - Codebase root: ${context.projectPath}`,
    `  - Projects root: ${context.projectsRoot}`,
    `  - Relay hub: ${context.relayHub}`,
    `  - Broker URL: ${context.brokerUrl}`,
  ].join("\n");
}

function buildTwinProtocolPrompt(context: TwinSystemPromptTemplateContext): string {
  return [
    "Relay protocol:",
    `  - Read recent context with: ${context.relayCommand} read --as ${context.twinId}`,
    `  - Reply with: ${context.relayCommand} send --as ${context.twinId} "your message"`,
    "",
    "Rules:",
    "  - Do not read or write channel.log or channel.jsonl directly",
    "  - Always reply via the broker-backed relay command above so other agents and the app can see your response",
    "  - When replying to an [ask:<id>] request, include the same [ask:<id>] tag in your reply",
    "  - Use the broker-backed relay read command above to inspect recent context before responding",
  ].join("\n");
}

export function buildTwinSystemPromptTemplate(): string {
  return [
    "{{base_prompt}}",
    "",
    "{{project_context}}",
    "",
    "{{protocol_prompt}}",
  ].join("\n");
}

export function renderTwinSystemPromptTemplate(template: string, context: TwinSystemPromptTemplateContext): string {
  const basePrompt = buildTwinBasePrompt(context);
  const projectContext = buildTwinProjectContextPrompt(context);
  const protocolPrompt = buildTwinProtocolPrompt(context);
  const variables: Record<string, string> = {
    twin_id: context.twinId,
    agent_id: context.twinId,
    display_name: context.displayName,
    project_name: context.projectName,
    project_path: context.projectPath,
    project_root: context.projectPath,
    workspace_root: context.projectPath,
    cwd: context.projectPath,
    projects_root: context.projectsRoot,
    base_path: context.projectsRoot,
    relay_hub: context.relayHub,
    broker_url: context.brokerUrl,
    relay_command: context.relayCommand,
    openscout_root: context.openscoutRoot,
    base_prompt: basePrompt,
    project_context: projectContext,
    protocol_prompt: protocolPrompt,
    protocol: protocolPrompt,
  };

  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey).trim();
    if (key.startsWith("env.") || key.startsWith("env:")) {
      const envName = key.slice(4).trim();
      return envName ? process.env[envName] ?? "" : "";
    }

    return variables[key] ?? match;
  });
}

function buildLegacySimpleRelayPrompt(
  twinId: string,
  projectName: string,
  projectPath: string,
  relayCommandBase: string,
  relayHub: string,
): string {
  return [
    `You are "${twinId}", a project twin for the ${projectName} project.`,
    "",
    "You are the persistent, project-native runtime for this codebase.",
    "A primary agent may call into you for context, execution, follow-through, and handoff.",
    "",
    `You have full access to the codebase at ${projectPath}.`,
    `There is a structured relay event stream at ${join(relayHub, "channel.jsonl")} shared by all agents.`,
    "",
    "Your job:",
    `  - Respond to @${twinId} mentions from other agents`,
    "  - Answer questions about this project's code, architecture, and status",
    "  - Coordinate with other agents when they need project-native context",
    "  - Maintain continuity for ongoing project work",
    "",
    "Relay commands:",
    `  ${relayCommandBase} send --as ${twinId} "your message"`,
    `  ${relayCommandBase} read`,
    "",
    "Rules:",
    "  - Always reply via relay send so other agents see your response",
    "  - When replying to an [ask:<id>] request, include the same [ask:<id>] tag in your reply",
    "  - Check relay read for context before responding",
  ].join("\n");
}

function buildLegacyBrokerBackedRelayPrompt(
  twinId: string,
  projectName: string,
  projectPath: string,
  relayCommandBase: string,
  brokerUrl: string,
): string {
  return [
    `You are "${twinId}", a project twin for the ${projectName} project.`,
    "",
    "You are the persistent, project-native runtime for this codebase.",
    "A primary agent may call into you for context, execution, follow-through, and handoff.",
    "",
    `You have full access to the codebase at ${projectPath}.`,
    `The local broker for agent communication is at ${brokerUrl}.`,
    "",
    "Your job:",
    `  - Respond to @${twinId} mentions from other agents`,
    "  - Answer questions about this project's code, architecture, and status",
    "  - Coordinate with other agents when they need project-native context",
    "  - Maintain continuity for ongoing project work",
    "",
    "Broker-backed relay commands:",
    `  ${relayCommandBase} send --as ${twinId} "your message"`,
    `  ${relayCommandBase} read --as ${twinId}`,
    "",
    "Rules:",
    "  - Do not read or write channel.log or channel.jsonl directly",
    `  - Always reply via ${relayCommandBase} send so other agents and the app can see your response`,
    "  - When replying to an [ask:<id>] request, include the same [ask:<id>] tag in your reply",
    `  - Use ${relayCommandBase} read to inspect recent broker-backed context before responding`,
  ].join("\n");
}

function legacyTwinSystemPromptCandidates(
  twinId: string,
  projectName: string,
  projectPath: string,
): string[] {
  const relayHub = resolveRelayHub();
  const brokerUrl = resolveBrokerUrl();
  const relayCommandBases = ["openscout relay", brokerRelayCommand()];
  const projectPathCandidates = projectPath.endsWith("/") ? [projectPath, projectPath.slice(0, -1)] : [projectPath, `${projectPath}/`];
  const candidates = new Set<string>();

  for (const pathCandidate of projectPathCandidates) {
    for (const relayCommandBase of relayCommandBases) {
      candidates.add(buildLegacySimpleRelayPrompt(twinId, projectName, pathCandidate, relayCommandBase, relayHub));
      candidates.add(buildLegacyBrokerBackedRelayPrompt(twinId, projectName, pathCandidate, relayCommandBase, brokerUrl));
    }
  }

  return Array.from(candidates);
}

function normalizeTwinSystemPrompt(twinId: string, projectName: string, projectPath: string, systemPrompt: string | undefined): string | undefined {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (legacyTwinSystemPromptCandidates(twinId, projectName, projectPath).includes(trimmed)) {
    return undefined;
  }

  return trimmed;
}

async function readTwinsRegistry(): Promise<Record<string, ProjectTwinRecord>> {
  const setup = await loadResolvedRelayAgents();
  return Object.fromEntries(
    setup.agents.map((agent) => [agent.agentId, projectTwinRecordFromResolvedConfig(agent)]),
  );
}

async function writeTwinsRegistry(registry: Record<string, ProjectTwinRecord>): Promise<void> {
  const overrides = await readRelayAgentOverrides();
  const nextOverrides: Record<string, RelayAgentOverride> = {
    ...overrides,
  };

  for (const [twinId, record] of Object.entries(registry)) {
    nextOverrides[twinId] = relayAgentOverrideFromProjectTwinRecord(twinId, record, overrides[twinId]);
  }

  await writeRelayAgentOverrides(nextOverrides);
  await loadResolvedRelayAgents({ syncLegacyMirror: true });
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return process.env.HOME ?? process.cwd();
  }
  if (value.startsWith("~/")) {
    return join(process.env.HOME ?? process.cwd(), value.slice(2));
  }
  return value;
}

function normalizeProjectPath(value: string): string {
  return resolve(expandHomePath(value.trim() || "."));
}

function compactHomePath(value: string): string {
  const home = process.env.HOME;
  if (!home) {
    return value;
  }
  return value.startsWith(home) ? value.replace(home, "~") : value;
}

function normalizeTmuxSessionName(value: string | undefined, twinId: string): string {
  const fallback = `relay-${twinId}`;
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeTwinHarness(value: string | undefined): AgentHarness {
  return value === "codex" ? "codex" : DEFAULT_TWIN_HARNESS;
}

function normalizeTwinCapabilities(value: unknown): AgentCapability[] {
  const allowed = new Set<AgentCapability>([
    "chat",
    "invoke",
    "deliver",
    "speak",
    "listen",
    "bridge",
    "summarize",
    "review",
    "execute",
  ]);
  const list = Array.isArray(value)
    ? value.map((entry) => String(entry).trim())
    : [];
  const normalized = Array.from(new Set(list.filter((entry): entry is AgentCapability => allowed.has(entry as AgentCapability))));
  return normalized.length > 0 ? normalized : [...DEFAULT_TWIN_CAPABILITIES];
}

function normalizeTwinLaunchArgs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
}

function normalizeProjectTwinRecord(twinId: string, record: ProjectTwinRecord): ProjectTwinRecord {
  const cwd = normalizeProjectPath(record.cwd || process.cwd());
  const project = record.project?.trim() || basename(cwd);
  return {
    project,
    tmuxSession: normalizeTmuxSessionName(record.tmuxSession, twinId),
    cwd,
    startedAt: Number.isFinite(record.startedAt) && record.startedAt > 0 ? Math.floor(record.startedAt) : nowSeconds(),
    systemPrompt: normalizeTwinSystemPrompt(twinId, project, cwd, record.systemPrompt),
    harness: normalizeTwinHarness(record.harness),
    transport: "tmux",
    capabilities: normalizeTwinCapabilities(record.capabilities),
    launchArgs: normalizeTwinLaunchArgs(record.launchArgs),
  };
}

function projectTwinRecordFromResolvedConfig(config: ResolvedRelayAgentConfig): ProjectTwinRecord {
  return normalizeProjectTwinRecord(config.agentId, {
    project: config.projectName,
    tmuxSession: config.runtime.sessionId,
    cwd: config.runtime.cwd,
    startedAt: config.startedAt,
    systemPrompt: config.systemPrompt,
    harness: config.runtime.harness,
    transport: "tmux",
    capabilities: config.capabilities,
    launchArgs: config.launchArgs,
  });
}

function relayAgentOverrideFromProjectTwinRecord(
  twinId: string,
  record: ProjectTwinRecord,
  existing: RelayAgentOverride | undefined,
): RelayAgentOverride {
  const normalizedRecord = normalizeProjectTwinRecord(twinId, record);
  const projectRoot = normalizeProjectPath(existing?.projectRoot || normalizedRecord.cwd);

  return {
    ...existing,
    agentId: twinId,
    displayName: existing?.displayName || titleCaseTwinName(twinId),
    projectName: normalizedRecord.project,
    projectRoot,
    projectConfigPath: existing?.projectConfigPath ?? null,
    source: existing?.source ?? "manual",
    startedAt: normalizedRecord.startedAt,
    systemPrompt: normalizedRecord.systemPrompt,
    launchArgs: normalizeTwinLaunchArgs(normalizedRecord.launchArgs),
    capabilities: normalizeTwinCapabilities(normalizedRecord.capabilities),
    runtime: {
      cwd: normalizeProjectPath(normalizedRecord.cwd),
      harness: normalizeTwinHarness(normalizedRecord.harness),
      transport: "tmux",
      sessionId: normalizedRecord.tmuxSession,
      wakePolicy: "on_demand",
    },
  };
}

function buildProjectTwinConfigState(twinId: string, record: ProjectTwinRecord): ProjectTwinConfigState {
  return {
    twinId,
    editable: true,
    systemPrompt: record.systemPrompt || buildTwinSystemPromptTemplate(),
    runtime: {
      cwd: compactHomePath(record.cwd),
      harness: normalizeTwinHarness(record.harness),
      transport: "tmux",
      sessionId: record.tmuxSession,
      wakePolicy: "on_demand",
    },
    launchArgs: normalizeTwinLaunchArgs(record.launchArgs),
    capabilities: normalizeTwinCapabilities(record.capabilities),
    applyMode: "restart",
    templateHint: TWIN_SYSTEM_PROMPT_TEMPLATE_HINT,
  };
}

async function assertDirectoryExists(directory: string): Promise<void> {
  const stats = await stat(directory);
  if (!stats.isDirectory()) {
    throw new Error(`${directory} is not a directory.`);
  }
}

export async function getProjectTwinConfig(twinId: string): Promise<ProjectTwinConfigState | null> {
  const registry = await readTwinsRegistry();
  const record = registry[twinId];
  if (!record) {
    return null;
  }

  return buildProjectTwinConfigState(twinId, record);
}

export async function updateProjectTwinConfig(
  twinId: string,
  input: {
    runtime: {
      cwd: string;
      harness: string;
      sessionId: string;
    };
    systemPrompt: string;
    launchArgs: string[];
    capabilities: string[];
  },
): Promise<ProjectTwinConfigState | null> {
  const registry = await readTwinsRegistry();
  const record = registry[twinId];
  if (!record) {
    return null;
  }

  const cwd = normalizeProjectPath(input.runtime.cwd || record.cwd);
  await assertDirectoryExists(cwd);

  const nextRecord = normalizeProjectTwinRecord(twinId, {
    ...record,
    cwd,
    tmuxSession: input.runtime.sessionId,
    harness: normalizeTwinHarness(input.runtime.harness),
    transport: "tmux",
    systemPrompt: input.systemPrompt.trim() || undefined,
    launchArgs: input.launchArgs,
    capabilities: input.capabilities as AgentCapability[],
  });

  registry[twinId] = nextRecord;
  await writeTwinsRegistry(registry);
  return buildProjectTwinConfigState(twinId, nextRecord);
}

function isTwinAlive(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${JSON.stringify(sessionName)}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function readBrokerMessagesSince(sinceSeconds: number): Promise<BrokerSnapshotMessage[]> {
  const response = await fetch(new URL("/v1/snapshot", resolveBrokerUrl()));
  if (!response.ok) {
    throw new Error(`Broker snapshot failed: ${response.status} ${response.statusText}`);
  }

  const snapshot = await response.json() as BrokerSnapshot;
  return Object.values(snapshot.messages)
    .filter((message) => normalizeBrokerTimestamp(message.createdAt) >= sinceSeconds)
    .sort((lhs, rhs) => normalizeBrokerTimestamp(lhs.createdAt) - normalizeBrokerTimestamp(rhs.createdAt));
}

export function buildTwinSystemPrompt(
  twinName: string,
  projectName: string,
  projectPath: string,
): string {
  return renderTwinSystemPromptTemplate(buildTwinSystemPromptTemplate(), buildTwinTemplateContext(twinName, projectName, projectPath));
}

function buildTwinInitialMessage(projectName: string, twinName: string): string {
  return `You are now online as the ${twinName} relay agent for ${projectName}. Announce yourself on the relay with: ${brokerRelayCommand()} send --as ${twinName} "relay agent online — ready to assist with ${projectName}"`;
}

export function buildTwinNudge(twinName: string, invocation: InvocationRequest, flightId: string): string {
  const relayCommand = brokerRelayCommand();
  const parts = [
    `New broker ask from ${invocation.requesterId}.`,
    `Task: ${invocation.task}`,
  ];

  if (invocation.context && Object.keys(invocation.context).length > 0) {
    parts.push(`Context: ${JSON.stringify(invocation.context)}`);
  }

  parts.push(`Read recent context if needed: ${relayCommand} read -n 20 --as ${twinName}.`);
  parts.push(`Reply with: ${relayCommand} send --as ${twinName} "[ask:${flightId}] @${invocation.requesterId} <your response>"`);
  return parts.join(" ");
}

export function stripTwinReplyMetadata(body: string, flightId: string, asker: string): string {
  return body
    .replace(new RegExp(`\\[ask:${escapeRegExp(flightId)}\\]`, "g"), "")
    .replace(new RegExp(`@${escapeRegExp(asker)}`, "g"), "")
    .trim();
}

async function sendTwinPrompt(record: ProjectTwinRecord, prompt: string): Promise<void> {
  execSync(
    `tmux send-keys -t ${JSON.stringify(record.tmuxSession)} ${JSON.stringify(prompt)} Enter`,
    { stdio: "pipe" },
  );
}

function shellQuoteArguments(args: string[]): string {
  return args.map((arg) => JSON.stringify(arg)).join(" ");
}

function buildTwinBootstrapPrompt(harness: AgentHarness, systemPrompt: string, initialMessage: string): string {
  if (harness === "codex") {
    return [
      "Adopt the following standing session instructions for the rest of this conversation.",
      "",
      systemPrompt,
      "",
      initialMessage,
    ].join("\n");
  }

  return initialMessage;
}

function buildTwinLaunchCommand(
  twinName: string,
  record: ProjectTwinRecord,
  projectPath: string,
  promptFile: string,
): string {
  const extraArgs = shellQuoteArguments(normalizeTwinLaunchArgs(record.launchArgs));
  if (normalizeTwinHarness(record.harness) === "codex") {
    return [
      "exec codex",
      "-a never",
      "-s workspace-write",
      "--no-alt-screen",
      "-C",
      JSON.stringify(projectPath),
      extraArgs,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "exec claude",
    `--append-system-prompt "$(cat ${JSON.stringify(promptFile)})"`,
    "--name",
    JSON.stringify(`${twinName}-relay-agent`),
    extraArgs,
  ]
    .filter(Boolean)
    .join(" ");
}

function killTwinSession(sessionName: string): void {
  try {
    execSync(`tmux kill-session -t ${JSON.stringify(sessionName)}`, { stdio: "pipe" });
  } catch {
    // Ignore missing sessions during restart.
  }
}

async function ensureTwinOnline(twinName: string, record: ProjectTwinRecord): Promise<ProjectTwinRecord> {
  const normalizedRecord = normalizeProjectTwinRecord(twinName, record);
  if (isTwinAlive(normalizedRecord.tmuxSession)) {
    return normalizedRecord;
  }

  const projectPath = normalizedRecord.cwd;
  const projectName = normalizedRecord.project || basename(projectPath);
  const systemPromptTemplate = normalizedRecord.systemPrompt || buildTwinSystemPromptTemplate();
  const systemPrompt = renderTwinSystemPromptTemplate(
    systemPromptTemplate,
    buildTwinTemplateContext(twinName, projectName, projectPath),
  );
  const initialMessage = buildTwinInitialMessage(projectName, twinName);
  const bootstrapPrompt = buildTwinBootstrapPrompt(normalizeTwinHarness(normalizedRecord.harness), systemPrompt, initialMessage);

  const twinDir = relayAgentRuntimeDirectory(twinName);
  const logsDir = relayAgentLogsDirectory(twinName);
  await mkdir(twinDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const promptFile = join(twinDir, "prompt.txt");
  const initialFile = join(twinDir, "initial.txt");
  const launchScript = join(twinDir, "launch.sh");
  const stateFile = join(twinDir, "state.json");
  const stdoutLogFile = join(logsDir, "stdout.log");
  const stderrLogFile = join(logsDir, "stderr.log");

  await writeFile(promptFile, systemPrompt);
  await writeFile(initialFile, bootstrapPrompt);
  await writeFile(
    launchScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `mkdir -p ${JSON.stringify(logsDir)}`,
      `cd ${JSON.stringify(projectPath)}`,
      `(sleep 5 && tmux send-keys -t ${JSON.stringify(normalizedRecord.tmuxSession)} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
      `exec ${buildTwinLaunchCommand(twinName, normalizedRecord, projectPath, promptFile).replace(/^exec\s+/, "")} 2>>${JSON.stringify(stderrLogFile)}`,
    ].join("\n") + "\n",
  );
  execSync(`chmod 755 ${JSON.stringify(launchScript)}`);
  const paneId = execSync(
    `tmux new-session -dP -F '#{pane_id}' -s ${JSON.stringify(normalizedRecord.tmuxSession)} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (paneId) {
    try {
      execSync(
        `tmux pipe-pane -o -t ${JSON.stringify(paneId)} ${JSON.stringify(`cat >> ${JSON.stringify(stdoutLogFile)}`)}`,
        { stdio: "pipe" },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[openscout-runtime] unable to attach tmux pipe for ${twinName}: ${reason}`);
    }
  }
  await writeFile(
    stateFile,
    JSON.stringify({
      agentId: twinName,
      projectRoot: projectPath,
      sessionId: normalizedRecord.tmuxSession,
      promptFile,
      initialFile,
      launchScript,
      stdoutLogFile,
      stderrLogFile,
      updatedAt: new Date().toISOString(),
    }, null, 2) + "\n",
  );

  const registry = await readTwinsRegistry();
  registry[twinName] = {
    ...normalizedRecord,
    startedAt: nowSeconds(),
    systemPrompt: normalizedRecord.systemPrompt,
  };
  await writeTwinsRegistry(registry);

  return registry[twinName];
}

export async function restartProjectTwin(
  twinId: string,
  options: { previousSessionId?: string | null } = {},
): Promise<ProjectTwinRecord | null> {
  const registry = await readTwinsRegistry();
  const record = registry[twinId];
  if (!record) {
    return null;
  }

  const normalizedRecord = normalizeProjectTwinRecord(twinId, record);
  const sessionsToStop = new Set<string>([
    normalizedRecord.tmuxSession,
    ...(options.previousSessionId?.trim() ? [options.previousSessionId.trim()] : []),
  ]);

  for (const sessionName of sessionsToStop) {
    killTwinSession(sessionName);
  }

  return ensureTwinOnline(twinId, normalizedRecord);
}

function buildTwinBinding(
  twinId: string,
  record: ProjectTwinRecord,
  alive: boolean,
  nodeId: string,
  source: "relay-twin-registry" | "project-inferred",
): ProjectTwinBinding {
  const displayName = titleCaseTwinName(twinId);
  const normalizedRecord = normalizeProjectTwinRecord(twinId, record);

  return {
    actor: {
      id: twinId,
      kind: "agent",
      displayName,
      handle: twinId,
      labels: ["relay", "project", "agent", "twin"],
      metadata: {
        source,
        project: normalizedRecord.project,
        projectRoot: normalizedRecord.cwd,
        tmuxSession: normalizedRecord.tmuxSession,
      },
    },
    agent: {
      id: twinId,
      kind: "agent",
      displayName,
      handle: twinId,
      labels: ["relay", "project", "agent", "twin"],
      metadata: {
        source,
        project: normalizedRecord.project,
        projectRoot: normalizedRecord.cwd,
        tmuxSession: normalizedRecord.tmuxSession,
        summary: `${displayName} relay agent for ${normalizedRecord.project}.`,
        role: "Relay agent",
      },
      agentClass: "general",
      capabilities: normalizeTwinCapabilities(normalizedRecord.capabilities),
      wakePolicy: "on_demand",
      homeNodeId: nodeId,
      authorityNodeId: nodeId,
      advertiseScope: "local",
    },
    endpoint: {
      id: `endpoint.${twinId}.${nodeId}.tmux`,
      agentId: twinId,
      nodeId,
      harness: normalizeTwinHarness(normalizedRecord.harness),
      transport: "tmux",
      state: alive ? "idle" : "waiting",
      cwd: normalizedRecord.cwd,
      projectRoot: normalizedRecord.cwd,
      sessionId: normalizedRecord.tmuxSession,
      metadata: {
        source,
        twinName: twinId,
        tmuxSession: normalizedRecord.tmuxSession,
        project: normalizedRecord.project,
        projectRoot: normalizedRecord.cwd,
        startedAt: String(normalizedRecord.startedAt),
      },
    },
  };
}

export async function loadRegisteredProjectTwinBindings(
  nodeId: string,
  options: { ensureOnline?: boolean; agentIds?: string[] } = {},
): Promise<ProjectTwinBinding[]> {
  const registry = await readTwinsRegistry();
  const requestedAgentIds = new Set((options.agentIds ?? []).filter(Boolean));
  const selectedEntries = Object.entries(registry).filter(([twinId]) => (
    requestedAgentIds.size === 0 || requestedAgentIds.has(twinId)
  ));

  return Promise.all(selectedEntries.map(async ([twinId, record]) => {
    const effectiveRecord = options.ensureOnline
      ? await ensureTwinOnline(twinId, record)
      : record;

    return buildTwinBinding(
      twinId,
      effectiveRecord,
      isTwinAlive(effectiveRecord.tmuxSession),
      nodeId,
      "relay-twin-registry",
    );
  }));
}

export async function inferProjectTwinBinding(agentId: string, nodeId: string): Promise<ProjectTwinBinding | null> {
  if (!agentId || BUILT_IN_LOCAL_AGENT_IDS.has(agentId)) {
    return null;
  }

  const setup = await loadResolvedRelayAgents();
  const agent = setup.agents.find((entry) => entry.agentId === agentId);
  if (!agent) {
    return null;
  }

  const record = projectTwinRecordFromResolvedConfig(agent);
  return buildTwinBinding(
    agentId,
    record,
    isTwinAlive(record.tmuxSession),
    nodeId,
    agent.source === "inferred" ? "project-inferred" : "relay-twin-registry",
  );
}

type TwinInvocationResult = {
  output: string;
};

export async function invokeProjectTwinEndpoint(
  endpoint: AgentEndpoint,
  invocation: InvocationRequest,
): Promise<TwinInvocationResult> {
  const twinName = String(endpoint.metadata?.twinName ?? endpoint.agentId);
  const registry = await readTwinsRegistry();
  const existing = registry[twinName];
  const projectRoot = endpoint.projectRoot ?? endpoint.cwd;

  const record = existing ?? (
    projectRoot
      ? {
        project: basename(projectRoot),
        tmuxSession: String(endpoint.metadata?.tmuxSession ?? `relay-${twinName}`),
        cwd: projectRoot,
        startedAt: nowSeconds(),
        harness: normalizeTwinHarness(typeof endpoint.harness === "string" ? endpoint.harness : undefined),
        transport: "tmux",
        capabilities: [...DEFAULT_TWIN_CAPABILITIES],
        launchArgs: [],
      }
      : null
  );

  if (!record) {
    throw new Error(`Twin ${twinName} is not registered and has no project root.`);
  }

  const onlineRecord = await ensureTwinOnline(twinName, record);
  const flightId = createTwinFlightId();
  const askedAt = nowSeconds();
  const timeoutSeconds = invocation.timeoutMs ? Math.max(30, Math.floor(invocation.timeoutMs / 1000)) : 300;
  await sendTwinPrompt(onlineRecord, buildTwinNudge(twinName, invocation, flightId));

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() <= deadline) {
    const messages = await readBrokerMessagesSince(askedAt - 1);

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.actorId !== twinName) continue;
      if (!message.body.includes(`[ask:${flightId}]`)) continue;

      return {
        output: stripTwinReplyMetadata(message.body, flightId, invocation.requesterId),
      };
    }

    await sleep(500);
  }

  throw new Error(`Timed out after ${timeoutSeconds}s waiting for ${twinName}.`);
}

export function shouldDisableGeneratedCodexEndpoint(endpoint: AgentEndpoint): boolean {
  if (endpoint.transport !== "codex_exec") {
    return false;
  }

  return endpoint.metadata?.source === "scout-app";
}
