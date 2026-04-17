import { randomUUID } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SessionState } from "@openscout/agent-sessions";
import type {
  AgentCapability,
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  AgentHarness,
  InvocationRequest,
} from "@openscout/protocol";
import { BUILT_IN_AGENT_DEFINITION_IDS, normalizeAgentSelectorSegment } from "@openscout/protocol";

import {
  answerClaudeStreamJsonQuestion,
  ensureClaudeStreamJsonAgentOnline,
  getClaudeStreamJsonAgentSnapshot,
  invokeClaudeStreamJsonAgent,
  isClaudeStreamJsonAgentAlive,
  shutdownClaudeStreamJsonAgent,
} from "./claude-stream-json.js";
import {
  ensureCodexAppServerAgentOnline,
  getCodexAppServerAgentSnapshot,
  invokeCodexAppServerAgent,
  sendCodexAppServerAgent,
  isCodexAppServerAgentAlive,
  shutdownCodexAppServerAgent,
} from "./codex-app-server.js";
import {
  buildCollaborationContractPrompt,
  buildInvocationCollaborationContextPrompt,
} from "./collaboration-contract.js";
import {
  buildRelayAgentInstance,
  ensureProjectConfigForDirectory,
  ensureRelayAgentConfigured,
  findNearestProjectRoot,
  loadResolvedRelayAgents,
  type ManagedAgentHarness,
  type OpenScoutProjectConfig,
  readProjectConfig,
  readRelayAgentOverrides,
  type RelayHarnessProfile,
  type RelayHarnessProfileInput,
  type RelayHarnessProfiles,
  type RelayRuntimeTransport,
  writeRelayAgentOverrides,
  type RelayAgentOverride,
  type ResolvedRelayAgentConfig,
} from "./setup.js";
import {
  relayAgentLogsDirectory,
  relayAgentRuntimeDirectory,
  resolveOpenScoutSupportPaths,
} from "./support-paths.js";
import { resolveBrokerServiceConfig } from "./broker-service.js";
import {
  LOCAL_AGENT_SYSTEM_PROMPT_TEMPLATE_HINT,
  LOCAL_AGENT_SYSTEM_PROMPT_INSERT_TOKENS,
  LOCAL_AGENT_SYSTEM_PROMPT_INSERT_BLOCK_COUNT,
} from "./local-agent-template.js";
import { buildManagedAgentShellExports } from "./managed-agent-environment.js";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const OPENSCOUT_REPO_ROOT = resolve(MODULE_DIRECTORY, "..", "..", "..");

type LocalAgentRecord = {
  definitionId?: string;
  project: string;
  projectRoot?: string;
  tmuxSession: string;
  cwd: string;
  startedAt: number;
  systemPrompt?: string;
  harness?: AgentHarness;
  defaultHarness?: AgentHarness;
  harnessProfiles?: RelayHarnessProfiles;
  transport: RelayRuntimeTransport;
  capabilities?: AgentCapability[];
  launchArgs?: string[];
};

export type LocalAgentConfigState = {
  agentId: string;
  editable: boolean;
  systemPrompt: string;
  runtime: {
    cwd: string;
    harness: AgentHarness;
    transport: RelayRuntimeTransport;
    sessionId: string;
    wakePolicy: "on_demand";
  };
  launchArgs: string[];
  capabilities: AgentCapability[];
  applyMode: "restart";
  templateHint: string;
};

export type LocalAgentBinding = {
  actor: ActorIdentity;
  agent: AgentDefinition;
  endpoint: AgentEndpoint;
};

export type ScoutLocalAgentStatus = {
  agentId: string;
  definitionId: string;
  projectName: string;
  projectRoot: string;
  sessionId: string;
  startedAt: number;
  harness: AgentHarness;
  transport: RelayRuntimeTransport;
  isOnline: boolean;
  source: "configured" | "manual";
};

export type StartLocalAgentInput = {
  projectPath: string;
  agentName?: string;
  displayName?: string;
  harness?: AgentHarness;
  currentDirectory?: string;
  model?: string;
  branch?: string;
  /** Override the agent's working directory (e.g., for git worktrees). */
  cwdOverride?: string;
};

interface BrokerSnapshotMessage {
  actorId: string;
  body: string;
  createdAt: number;
}

interface BrokerSnapshot {
  messages: Record<string, BrokerSnapshotMessage>;
}

const DEFAULT_LOCAL_AGENT_CAPABILITIES: AgentCapability[] = ["chat", "invoke", "deliver"];
const DEFAULT_LOCAL_AGENT_HARNESS: AgentHarness = "claude";

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
  return resolveBrokerServiceConfig().brokerUrl;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeBrokerTimestamp(value: number): number {
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function brokerRelayCommand(): string {
  return `node ${JSON.stringify(join(OPENSCOUT_REPO_ROOT, "packages", "cli", "bin", "scout.mjs"))}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLocalAgentFlightId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCaseLocalAgentName(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export const SUPPORTED_LOCAL_AGENT_HARNESSES: AgentHarness[] = ["claude", "codex"];

type LocalAgentSystemPromptTemplateContext = {
  agentId: string;
  displayName: string;
  projectName: string;
  projectPath: string;
  brokerUrl: string;
  relayCommand: string;
  projectsRoot: string;
  relayHub: string;
  openscoutRoot: string;
  scoutSkill: string;
};

function resolveScoutSkillPath(): string {
  const candidatePaths = [
    join(OPENSCOUT_REPO_ROOT, ".agents", "skills", "scout", "SKILL.md"),
    join(process.env.HOME ?? "", ".agents", "skills", "scout", "SKILL.md"),
    join(OPENSCOUT_REPO_ROOT, ".agents", "skills", "relay-agent-comms", "SKILL.md"),
    join(process.env.HOME ?? "", ".agents", "skills", "relay-agent-comms", "SKILL.md"),
  ];

  for (const path of candidatePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return candidatePaths[0]!;
}

function buildLocalAgentTemplateContext(
  agentId: string,
  projectName: string,
  projectPath: string,
): LocalAgentSystemPromptTemplateContext {
  return {
    agentId,
    displayName: titleCaseLocalAgentName(agentId),
    projectName,
    projectPath,
    brokerUrl: resolveBrokerUrl(),
    relayCommand: brokerRelayCommand(),
    projectsRoot: resolveProjectsRoot(projectPath),
    relayHub: resolveRelayHub(),
    openscoutRoot: OPENSCOUT_REPO_ROOT,
    scoutSkill: resolveScoutSkillPath(),
  };
}

function buildLocalAgentBasePrompt(context: LocalAgentSystemPromptTemplateContext): string {
  return [
    `You are "${context.agentId}", a relay agent for the ${context.projectName} project.`,
    "",
    "You are the persistent, project-native runtime for this codebase.",
    "A primary agent may call into you for context, execution, follow-through, and handoff.",
    "",
    "Your job:",
    `  - Respond to @${context.agentId} mentions from other agents`,
    "  - Answer questions about this project's code, architecture, and status",
    "  - Coordinate with other agents when they need project-native context",
    "  - Maintain continuity for ongoing project work",
  ].join("\n");
}

function buildLocalAgentProjectContextPrompt(context: LocalAgentSystemPromptTemplateContext): string {
  return [
    "Project context:",
    `  - Codebase root: ${context.projectPath}`,
    `  - Projects root: ${context.projectsRoot}`,
    `  - Broker URL: ${context.brokerUrl}`,
    `  - Scout skill: ${context.scoutSkill}`,
  ].join("\n");
}

function buildLocalAgentCollaborationPrompt(context: LocalAgentSystemPromptTemplateContext): string {
  return buildCollaborationContractPrompt(context.agentId);
}

function buildLocalAgentTmuxProtocolPrompt(context: LocalAgentSystemPromptTemplateContext): string {
  return [
    "Relay protocol:",
    `  - Read recent context with: ${context.relayCommand} read --as ${context.agentId}`,
    `  - Reply with: ${context.relayCommand} send --as ${context.agentId} "your message"`,
    `  - Ask another agent and stay attached with: ${context.relayCommand} ask --to <agent> --as ${context.agentId} "your request"`,
    "",
    "Rules:",
    "  - Do not use file-backed relay state or side channels directly",
    "  - Always reply via the broker-backed relay command above so other agents and the app can see your response",
    "  - When replying to an [ask:<id>] request, include the same [ask:<id>] tag in your reply",
    "  - Use the broker-backed relay read command above to inspect recent context before responding",
    `  - Follow the scout skill at ${context.scoutSkill} for agent-to-agent communication`,
  ].join("\n");
}

function buildLocalAgentDirectProtocolPrompt(context: LocalAgentSystemPromptTemplateContext): string {
  return [
    "OpenScout runtime:",
    "  - You are invoked directly by the OpenScout broker",
    "  - Return your final answer in the assistant message for the current turn",
    "  - Do not shell out to send the final answer through relay yourself",
    `  - If you need recent relay context, inspect it with: ${context.relayCommand} read --as ${context.agentId}`,
    `  - If you need another agent to do work, use: ${context.relayCommand} ask --to <agent> --as ${context.agentId} "your request"`,
    `  - Follow the scout skill at ${context.scoutSkill} for agent-to-agent communication`,
  ].join("\n");
}

export function buildLocalAgentSystemPromptTemplate(): string {
  return [
    "{{base_prompt}}",
    "",
    "{{project_context}}",
    "",
    "{{collaboration_prompt}}",
    "",
    "{{protocol_prompt}}",
  ].join("\n");
}

export function renderLocalAgentSystemPromptTemplate(
  template: string,
  context: LocalAgentSystemPromptTemplateContext,
  options: { transport?: RelayRuntimeTransport } = {},
): string {
  const basePrompt = buildLocalAgentBasePrompt(context);
  const projectContext = buildLocalAgentProjectContextPrompt(context);
  const collaborationPrompt = buildLocalAgentCollaborationPrompt(context);
  const protocolPrompt = options.transport === "codex_app_server" || options.transport === "claude_stream_json"
    ? buildLocalAgentDirectProtocolPrompt(context)
    : buildLocalAgentTmuxProtocolPrompt(context);
  const variables: Record<string, string> = {
    agent_id: context.agentId,
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
    scout_skill: context.scoutSkill,
    relay_agent_comms_skill: context.scoutSkill,
    base_prompt: basePrompt,
    project_context: projectContext,
    collaboration_prompt: collaborationPrompt,
    collaboration_contract: collaborationPrompt,
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
  agentId: string,
  projectName: string,
  projectPath: string,
  relayCommandBase: string,
  relayHub: string,
): string {
  return [
    `You are "${agentId}", a relay agent for the ${projectName} project.`,
    "",
    "You are the persistent, project-native runtime for this codebase.",
    "A primary agent may call into you for context, execution, follow-through, and handoff.",
    "",
    `You have full access to the codebase at ${projectPath}.`,
    `There is a structured relay event stream at ${join(relayHub, "channel.jsonl")} shared by all agents.`,
    "",
    "Your job:",
    `  - Respond to @${agentId} mentions from other agents`,
    "  - Answer questions about this project's code, architecture, and status",
    "  - Coordinate with other agents when they need project-native context",
    "  - Maintain continuity for ongoing project work",
    "",
    "Relay commands:",
    `  ${relayCommandBase} send --as ${agentId} "your message"`,
    `  ${relayCommandBase} read`,
    "",
    "Rules:",
    "  - Always reply via relay send so other agents see your response",
    "  - When replying to an [ask:<id>] request, include the same [ask:<id>] tag in your reply",
    "  - Check relay read for context before responding",
  ].join("\n");
}

function buildLegacyBrokerBackedRelayPrompt(
  agentId: string,
  projectName: string,
  projectPath: string,
  relayCommandBase: string,
  brokerUrl: string,
): string {
  return [
    `You are "${agentId}", a relay agent for the ${projectName} project.`,
    "",
    "You are the persistent, project-native runtime for this codebase.",
    "A primary agent may call into you for context, execution, follow-through, and handoff.",
    "",
    `You have full access to the codebase at ${projectPath}.`,
    `The local broker for agent communication is at ${brokerUrl}.`,
    "",
    "Your job:",
    `  - Respond to @${agentId} mentions from other agents`,
    "  - Answer questions about this project's code, architecture, and status",
    "  - Coordinate with other agents when they need project-native context",
    "  - Maintain continuity for ongoing project work",
    "",
    "Broker-backed relay commands:",
    `  ${relayCommandBase} send --as ${agentId} "your message"`,
    `  ${relayCommandBase} read --as ${agentId}`,
    "",
    "Rules:",
    "  - Do not read or write channel.log or channel.jsonl directly",
    `  - Always reply via ${relayCommandBase} send so other agents and the app can see your response`,
    "  - When replying to an [ask:<id>] request, include the same [ask:<id>] tag in your reply",
    `  - Use ${relayCommandBase} read to inspect recent broker-backed context before responding`,
  ].join("\n");
}

function legacyLocalAgentSystemPromptCandidates(
  agentId: string,
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
      candidates.add(buildLegacySimpleRelayPrompt(agentId, projectName, pathCandidate, relayCommandBase, relayHub));
      candidates.add(buildLegacyBrokerBackedRelayPrompt(agentId, projectName, pathCandidate, relayCommandBase, brokerUrl));
    }
  }

  return Array.from(candidates);
}

function normalizeLocalAgentSystemPrompt(agentId: string, projectName: string, projectPath: string, systemPrompt: string | undefined): string | undefined {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (legacyLocalAgentSystemPromptCandidates(agentId, projectName, projectPath).includes(trimmed)) {
    return undefined;
  }

  return trimmed;
}

async function readLocalAgentRegistry(): Promise<Record<string, LocalAgentRecord>> {
  const overrides = await readRelayAgentOverrides();
  return Object.fromEntries(
    Object.entries(overrides).map(([agentId, override]) => [
      agentId,
      localAgentRecordFromRelayAgentOverride(agentId, override),
    ]),
  );
}

async function writeLocalAgentRegistry(registry: Record<string, LocalAgentRecord>): Promise<void> {
  const overrides = await readRelayAgentOverrides();
  const nextOverrides: Record<string, RelayAgentOverride> = {
    ...overrides,
  };

  for (const [agentId, record] of Object.entries(registry)) {
    nextOverrides[agentId] = relayAgentOverrideFromLocalAgentRecord(agentId, record, overrides[agentId]);
  }

  await writeRelayAgentOverrides(nextOverrides);
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

function normalizeTmuxSessionName(value: string | undefined, agentId: string): string {
  const fallback = `relay-${agentId}`;
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeLocalAgentHarness(value: string | undefined): AgentHarness {
  return value === "codex" ? "codex" : DEFAULT_LOCAL_AGENT_HARNESS;
}

function normalizeLocalAgentTransport(value: string | undefined, harness: AgentHarness): RelayRuntimeTransport {
  if (harness === "codex") {
    return "codex_app_server";
  }

  if (value === "claude_stream_json") {
    return "claude_stream_json";
  }

  if (value === "codex_app_server") {
    return "codex_app_server";
  }

  if (value === "tmux") {
    return "tmux";
  }

  return "claude_stream_json";
}

function normalizeLocalAgentCapabilities(value: unknown): AgentCapability[] {
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
  return normalized.length > 0 ? normalized : [...DEFAULT_LOCAL_AGENT_CAPABILITIES];
}

function normalizeLocalAgentLaunchArgs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
}

function normalizeManagedHarness(value: string | undefined, fallback: ManagedAgentHarness): ManagedAgentHarness {
  return value === "codex" ? "codex" : value === "claude" ? "claude" : fallback;
}

function normalizeLocalHarnessProfiles(agentId: string, record: LocalAgentRecord): RelayHarnessProfiles {
  const defaultHarness = normalizeManagedHarness(
    typeof record.defaultHarness === "string" ? record.defaultHarness : record.harness,
    "claude",
  );
  const nextProfiles: RelayHarnessProfiles = {};
  for (const harness of ["claude", "codex"] as const) {
    const profile = record.harnessProfiles?.[harness];
    if (!profile) {
      continue;
    }
    nextProfiles[harness] = {
      cwd: normalizeProjectPath(profile.cwd || record.cwd || process.cwd()),
      transport: normalizeLocalAgentTransport(profile.transport, harness),
      sessionId: normalizeTmuxSessionName(profile.sessionId, `${agentId}-${harness}`),
      launchArgs: normalizeLocalAgentLaunchArgs(profile.launchArgs),
    };
  }
  const runtimeHarness = normalizeManagedHarness(record.harness, defaultHarness);

  if (!nextProfiles[runtimeHarness]) {
    nextProfiles[runtimeHarness] = {
      cwd: normalizeProjectPath(record.cwd || process.cwd()),
      transport: normalizeLocalAgentTransport(record.transport, runtimeHarness),
      sessionId: normalizeTmuxSessionName(record.tmuxSession, `${agentId}-${runtimeHarness}`),
      launchArgs: normalizeLocalAgentLaunchArgs(record.launchArgs),
    };
  }

  if (!nextProfiles[defaultHarness]) {
    nextProfiles[defaultHarness] = {
      cwd: normalizeProjectPath(record.cwd || process.cwd()),
      transport: normalizeLocalAgentTransport(record.transport, defaultHarness),
      sessionId: normalizeTmuxSessionName(record.tmuxSession, `${agentId}-${defaultHarness}`),
      launchArgs: normalizeLocalAgentLaunchArgs(record.launchArgs),
    };
  }

  for (const harness of ["claude", "codex"] as const) {
    const profile = nextProfiles[harness];
    if (!profile) {
      continue;
    }
    nextProfiles[harness] = {
      cwd: normalizeProjectPath(profile.cwd || record.cwd || process.cwd()),
      transport: normalizeLocalAgentTransport(profile.transport, harness),
      sessionId: normalizeTmuxSessionName(profile.sessionId, `${agentId}-${harness}`),
      launchArgs: normalizeLocalAgentLaunchArgs(profile.launchArgs),
    } satisfies RelayHarnessProfile;
  }

  return nextProfiles;
}

function activeLocalHarness(record: LocalAgentRecord): ManagedAgentHarness {
  return normalizeManagedHarness(
    typeof record.defaultHarness === "string" ? record.defaultHarness : record.harness,
    "claude",
  );
}

function recordForHarness(record: LocalAgentRecord, harnessOverride?: AgentHarness): LocalAgentRecord {
  const normalized = normalizeLocalAgentRecord(
    record.definitionId || "agent",
    record,
  );
  const selectedHarness = normalizeManagedHarness(harnessOverride, activeLocalHarness(normalized));
  const profile = normalized.harnessProfiles?.[selectedHarness];
  if (!profile) {
    // Build a default profile from the record's workspace path instead of throwing
    const fallbackCwd = normalizeProjectPath(normalized.projectRoot || normalized.cwd || process.cwd());
    const fallbackTransport = normalizeLocalAgentTransport(undefined, selectedHarness);
    const agentKey = normalized.definitionId || "agent";
    const fallbackSessionId = normalizeTmuxSessionName(undefined, `${agentKey}-${selectedHarness}`);
    return {
      ...normalized,
      harness: selectedHarness,
      defaultHarness: selectedHarness,
      tmuxSession: fallbackSessionId,
      cwd: fallbackCwd,
      transport: fallbackTransport,
      launchArgs: normalizeLocalAgentLaunchArgs(normalized.launchArgs),
      harnessProfiles: {
        ...normalized.harnessProfiles,
        [selectedHarness]: {
          cwd: fallbackCwd,
          transport: fallbackTransport,
          sessionId: fallbackSessionId,
          launchArgs: normalizeLocalAgentLaunchArgs(normalized.launchArgs),
        },
      },
    };
  }

  return {
    ...normalized,
    harness: selectedHarness,
    defaultHarness: selectedHarness,
    tmuxSession: profile.sessionId,
    cwd: profile.cwd,
    transport: profile.transport,
    launchArgs: profile.launchArgs,
  };
}

function normalizeLocalAgentRecord(agentId: string, record: LocalAgentRecord): LocalAgentRecord {
  const cwd = normalizeProjectPath(record.cwd || process.cwd());
  const projectRoot = normalizeProjectPath(record.projectRoot || cwd);
  const project = record.project?.trim() || basename(projectRoot);
  const definitionId = record.definitionId?.trim() || agentId;
  const defaultHarness = activeLocalHarness(record);
  const harnessProfiles = normalizeLocalHarnessProfiles(agentId, {
    ...record,
    cwd,
    projectRoot,
    project,
  });
  const activeProfile = harnessProfiles[defaultHarness];
  const harness = normalizeLocalAgentHarness(defaultHarness);
  return {
    definitionId,
    project,
    projectRoot,
    tmuxSession: activeProfile?.sessionId ?? normalizeTmuxSessionName(record.tmuxSession, `${agentId}-${defaultHarness}`),
    cwd: activeProfile?.cwd ?? cwd,
    startedAt: Number.isFinite(record.startedAt) && record.startedAt > 0 ? Math.floor(record.startedAt) : nowSeconds(),
    systemPrompt: normalizeLocalAgentSystemPrompt(definitionId, project, projectRoot, record.systemPrompt),
    harness,
    defaultHarness,
    harnessProfiles,
    transport: activeProfile?.transport ?? normalizeLocalAgentTransport(record.transport, harness),
    capabilities: normalizeLocalAgentCapabilities(record.capabilities),
    launchArgs: activeProfile?.launchArgs ?? normalizeLocalAgentLaunchArgs(record.launchArgs),
  };
}

function localAgentStatusFromRecord(
  agentId: string,
  record: LocalAgentRecord,
  source: ScoutLocalAgentStatus["source"],
): ScoutLocalAgentStatus {
  const normalizedRecord = normalizeLocalAgentRecord(agentId, record);
  return {
    agentId,
    definitionId: normalizedRecord.definitionId ?? agentId,
    projectName: normalizedRecord.project,
    projectRoot: normalizedRecord.projectRoot ?? normalizedRecord.cwd,
    sessionId: normalizedRecord.tmuxSession,
    startedAt: normalizedRecord.startedAt,
    harness: normalizeLocalAgentHarness(normalizedRecord.harness),
    transport: normalizedRecord.transport,
    isOnline: isLocalAgentRecordOnline(agentId, normalizedRecord),
    source,
  };
}

function localAgentStatusSource(
  agentId: string,
  overrides: Record<string, RelayAgentOverride>,
): ScoutLocalAgentStatus["source"] {
  return overrides[agentId]?.source === "manual" ? "manual" : "configured";
}

function localAgentRecordFromResolvedConfig(config: ResolvedRelayAgentConfig): LocalAgentRecord {
  return normalizeLocalAgentRecord(config.agentId, {
    definitionId: config.definitionId,
    project: config.projectName,
    projectRoot: config.projectRoot,
    tmuxSession: config.runtime.sessionId,
    cwd: config.runtime.cwd,
    startedAt: config.startedAt,
    systemPrompt: config.systemPrompt,
    harness: config.runtime.harness,
    defaultHarness: config.defaultHarness,
    harnessProfiles: config.harnessProfiles,
    transport: config.runtime.transport,
    capabilities: config.capabilities,
    launchArgs: config.launchArgs,
  });
}

function localAgentRecordFromRelayAgentOverride(
  agentId: string,
  override: RelayAgentOverride,
): LocalAgentRecord {
  return normalizeLocalAgentRecord(agentId, {
    definitionId: override.definitionId ?? agentId,
    project: override.projectName ?? basename(override.projectRoot || override.runtime?.cwd || agentId),
    projectRoot: override.projectRoot ?? override.runtime?.cwd,
    tmuxSession: override.runtime?.sessionId ?? `relay-${agentId}`,
    cwd: override.runtime?.cwd ?? override.projectRoot,
    startedAt: override.startedAt ?? nowSeconds(),
    systemPrompt: override.systemPrompt,
    harness: override.runtime?.harness,
    defaultHarness: override.defaultHarness ?? override.runtime?.harness,
    harnessProfiles: override.harnessProfiles as RelayHarnessProfiles | undefined,
    transport: normalizeLocalAgentTransport(override.runtime?.transport, normalizeLocalAgentHarness(override.runtime?.harness)),
    capabilities: override.capabilities,
    launchArgs: override.launchArgs,
  });
}

function relayAgentOverrideFromLocalAgentRecord(
  agentId: string,
  record: LocalAgentRecord,
  existing: RelayAgentOverride | undefined,
): RelayAgentOverride {
  const normalizedRecord = normalizeLocalAgentRecord(agentId, record);
  const projectRoot = normalizeProjectPath(existing?.projectRoot || normalizedRecord.cwd);

  return {
    ...existing,
    agentId: agentId,
    definitionId: normalizedRecord.definitionId ?? existing?.definitionId ?? agentId,
    displayName: existing?.displayName || titleCaseLocalAgentName(normalizedRecord.definitionId ?? agentId),
    projectName: normalizedRecord.project,
    projectRoot,
    projectConfigPath: existing?.projectConfigPath ?? null,
    source: existing?.source && existing.source !== "inferred" ? existing.source : "manual",
    startedAt: normalizedRecord.startedAt,
    systemPrompt: normalizedRecord.systemPrompt,
    launchArgs: normalizeLocalAgentLaunchArgs(normalizedRecord.launchArgs),
    capabilities: normalizeLocalAgentCapabilities(normalizedRecord.capabilities),
    defaultHarness: normalizeManagedHarness(normalizedRecord.defaultHarness, "claude"),
    harnessProfiles: normalizedRecord.harnessProfiles,
    runtime: {
      cwd: normalizeProjectPath(normalizedRecord.cwd),
      harness: normalizeLocalAgentHarness(normalizedRecord.harness),
      transport: normalizeLocalAgentTransport(normalizedRecord.transport, normalizeLocalAgentHarness(normalizedRecord.harness)),
      sessionId: normalizedRecord.tmuxSession,
      wakePolicy: "on_demand",
    },
  };
}

function buildLocalAgentConfigState(agentId: string, record: LocalAgentRecord): LocalAgentConfigState {
  return {
    agentId,
    editable: true,
    systemPrompt: record.systemPrompt || buildLocalAgentSystemPromptTemplate(),
    runtime: {
      cwd: compactHomePath(record.cwd),
      harness: normalizeLocalAgentHarness(record.harness),
      transport: normalizeLocalAgentTransport(record.transport, normalizeLocalAgentHarness(record.harness)),
      sessionId: record.tmuxSession,
      wakePolicy: "on_demand",
    },
    launchArgs: normalizeLocalAgentLaunchArgs(record.launchArgs),
    capabilities: normalizeLocalAgentCapabilities(record.capabilities),
    applyMode: "restart",
    templateHint: LOCAL_AGENT_SYSTEM_PROMPT_TEMPLATE_HINT,
  };
}

async function assertDirectoryExists(directory: string): Promise<void> {
  const stats = await stat(directory);
  if (!stats.isDirectory()) {
    throw new Error(`${directory} is not a directory.`);
  }
}

async function resolveConfiguredLocalAgentRecord(agentId: string): Promise<LocalAgentRecord | null> {
  const overrides = await readRelayAgentOverrides();
  const override = overrides[agentId];
  if (override) {
    return localAgentRecordFromRelayAgentOverride(agentId, override);
  }

  const registry = await readLocalAgentRegistry();
  const record = registry[agentId];
  return record ? normalizeLocalAgentRecord(agentId, record) : null;
}

export async function getLocalAgentConfig(agentId: string): Promise<LocalAgentConfigState | null> {
  const record = await resolveConfiguredLocalAgentRecord(agentId);
  if (!record) {
    return null;
  }

  return buildLocalAgentConfigState(agentId, record);
}

export async function getLocalAgentSessionSnapshot(agentId: string): Promise<SessionState | null> {
  const record = await resolveConfiguredLocalAgentRecord(agentId);
  if (!record) {
    return null;
  }

  if (record.transport === "codex_app_server") {
    return getCodexAppServerAgentSnapshot(buildCodexAgentSessionOptions(agentId, record));
  }

  if (record.transport === "claude_stream_json") {
    return getClaudeStreamJsonAgentSnapshot(buildClaudeAgentSessionOptions(agentId, record));
  }

  return null;
}

export async function getLocalAgentEndpointSessionSnapshot(endpoint: AgentEndpoint): Promise<SessionState | null> {
  if (endpoint.transport === "codex_app_server") {
    return getCodexAppServerAgentSnapshot(buildCodexEndpointSessionOptions(endpoint));
  }

  if (endpoint.transport === "claude_stream_json") {
    return getClaudeStreamJsonAgentSnapshot(buildClaudeEndpointSessionOptions(endpoint));
  }

  return null;
}

export async function ensureLocalSessionEndpointOnline(endpoint: AgentEndpoint): Promise<void> {
  if (endpoint.transport === "codex_app_server") {
    await ensureCodexAppServerAgentOnline(buildCodexEndpointSessionOptions(endpoint));
    return;
  }

  if (endpoint.transport === "claude_stream_json") {
    await ensureClaudeStreamJsonAgentOnline(buildClaudeEndpointSessionOptions(endpoint));
  }
}

export async function shutdownLocalSessionEndpoint(endpoint: AgentEndpoint): Promise<void> {
  if (endpoint.transport === "codex_app_server") {
    await shutdownCodexAppServerAgent(buildCodexEndpointSessionOptions(endpoint));
    return;
  }

  if (endpoint.transport === "claude_stream_json") {
    await shutdownClaudeStreamJsonAgent(buildClaudeEndpointSessionOptions(endpoint));
  }
}

export async function answerLocalAgentSessionQuestion(
  agentId: string,
  input: { blockId: string; answer: string[] },
): Promise<void> {
  const record = await resolveConfiguredLocalAgentRecord(agentId);
  if (!record) {
    throw new Error(`Agent ${agentId} is not configured.`);
  }

  if (record.transport !== "claude_stream_json") {
    throw new Error(`Agent ${agentId} does not support direct question answers for transport ${record.transport}.`);
  }

  await answerClaudeStreamJsonQuestion(buildClaudeAgentSessionOptions(agentId, record), input);
}

export async function updateLocalAgentConfig(
  agentId: string,
  input: {
    runtime: {
      cwd: string;
      harness: string;
      sessionId: string;
      transport?: string;
    };
    systemPrompt: string;
    launchArgs: string[];
    capabilities: string[];
  },
): Promise<LocalAgentConfigState | null> {
  const [registry, overrides] = await Promise.all([
    readLocalAgentRegistry(),
    readRelayAgentOverrides(),
  ]);
  const record = registry[agentId]
    ?? (overrides[agentId] ? localAgentRecordFromRelayAgentOverride(agentId, overrides[agentId]) : undefined);
  if (!record) {
    return null;
  }

  const cwd = normalizeProjectPath(input.runtime.cwd || record.cwd);
  await assertDirectoryExists(cwd);

  const nextHarness = normalizeLocalAgentHarness(input.runtime.harness);
  const nextTransport = normalizeLocalAgentTransport(
    input.runtime.transport ?? record.transport,
    nextHarness,
  );

  const nextRecord = normalizeLocalAgentRecord(agentId, {
    ...record,
    cwd,
    tmuxSession: input.runtime.sessionId,
    harness: nextHarness,
    defaultHarness: nextHarness,
    harnessProfiles: {
      ...(record.harnessProfiles ?? {}),
      [normalizeManagedHarness(input.runtime.harness, "claude")]: {
        cwd,
        transport: nextTransport,
        sessionId: normalizeTmuxSessionName(input.runtime.sessionId, `${agentId}-${normalizeManagedHarness(input.runtime.harness, "claude")}`),
        launchArgs: input.launchArgs,
      },
    },
    transport: nextTransport,
    systemPrompt: input.systemPrompt.trim() || undefined,
    launchArgs: input.launchArgs,
    capabilities: input.capabilities as AgentCapability[],
  });

  registry[agentId] = nextRecord;
  await writeLocalAgentRegistry(registry);
  return buildLocalAgentConfigState(agentId, nextRecord);
}

function buildCodexAgentSessionOptions(
  agentName: string,
  record: LocalAgentRecord,
  systemPrompt?: string,
): {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs: string[];
  threadId?: string;
  requireExistingThread?: boolean;
} {
  return {
    agentName,
    sessionId: record.tmuxSession,
    cwd: record.cwd,
    systemPrompt: systemPrompt ?? buildLocalAgentSystemPrompt(agentName, record.project, record.cwd, { transport: "codex_app_server" }),
    runtimeDirectory: relayAgentRuntimeDirectory(agentName),
    logsDirectory: relayAgentLogsDirectory(agentName),
    launchArgs: normalizeLocalAgentLaunchArgs(record.launchArgs),
  };
}

function buildClaudeAgentSessionOptions(
  agentName: string,
  record: LocalAgentRecord,
  systemPrompt?: string,
): {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs: string[];
} {
  return {
    agentName,
    sessionId: record.tmuxSession,
    cwd: record.cwd,
    systemPrompt: systemPrompt ?? buildLocalAgentSystemPrompt(agentName, record.project, record.cwd, { transport: "claude_stream_json" }),
    runtimeDirectory: relayAgentRuntimeDirectory(agentName),
    logsDirectory: relayAgentLogsDirectory(agentName),
    launchArgs: normalizeLocalAgentLaunchArgs(record.launchArgs),
  };
}

function endpointMetadataString(endpoint: AgentEndpoint, key: string): string | undefined {
  const value = endpoint.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function endpointInvocationPrompt(
  endpoint: AgentEndpoint,
  agentName: string,
  invocation: InvocationRequest,
): string {
  const source = endpointMetadataString(endpoint, "source");
  const externalSource = endpointMetadataString(endpoint, "externalSource");
  const attachedTransport = endpointMetadataString(endpoint, "attachedTransport");
  const sessionBacked = endpoint.metadata?.sessionBacked === true;

  if (
    invocation.action === "consult"
    && (
      sessionBacked
      || source === "local-session"
      || externalSource === "local-session"
      || attachedTransport === "codex_app_server"
      || attachedTransport === "claude_stream_json"
    )
  ) {
    return invocation.task;
  }

  if (sessionBacked) {
    return buildAttachedSessionInvocationPrompt(invocation);
  }

  return buildLocalAgentDirectInvocationPrompt(agentName, invocation);
}

function isSessionBackedEndpoint(endpoint: AgentEndpoint): boolean {
  const source = endpointMetadataString(endpoint, "source");
  const externalSource = endpointMetadataString(endpoint, "externalSource");
  const attachedTransport = endpointMetadataString(endpoint, "attachedTransport");
  return endpoint.metadata?.sessionBacked === true
    || source === "local-session"
    || externalSource === "local-session"
    || attachedTransport === "codex_app_server"
    || attachedTransport === "claude_stream_json";
}

function endpointAgentName(endpoint: AgentEndpoint): string {
  return endpointMetadataString(endpoint, "agentName")
    ?? endpointMetadataString(endpoint, "definitionId")
    ?? endpoint.agentId;
}

function endpointRuntimeInstanceId(endpoint: AgentEndpoint): string {
  return endpointMetadataString(endpoint, "runtimeInstanceId")
    ?? endpointMetadataString(endpoint, "runtimeSessionId")
    ?? endpoint.sessionId
    ?? `relay-${endpointAgentName(endpoint)}`;
}

function endpointCwd(endpoint: AgentEndpoint): string {
  return endpoint.cwd ?? endpoint.projectRoot ?? process.cwd();
}

function attachedLocalSessionSystemPrompt(endpoint: AgentEndpoint): string {
  const explicit = endpointMetadataString(endpoint, "systemPrompt");
  if (explicit) {
    return explicit;
  }

  return "Resume the existing session without changing its identity or prior context.";
}

function buildCodexEndpointSessionOptions(endpoint: AgentEndpoint): {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs: string[];
  threadId?: string;
  requireExistingThread?: boolean;
} {
  const agentName = endpointAgentName(endpoint);
  const threadId = endpointMetadataString(endpoint, "threadId")
    ?? endpointMetadataString(endpoint, "externalSessionId")
    ?? endpoint.sessionId
    ?? undefined;

  return {
    agentName,
    sessionId: endpointRuntimeInstanceId(endpoint),
    cwd: endpointCwd(endpoint),
    systemPrompt: attachedLocalSessionSystemPrompt(endpoint),
    runtimeDirectory: relayAgentRuntimeDirectory(agentName),
    logsDirectory: relayAgentLogsDirectory(agentName),
    launchArgs: [],
    threadId,
    requireExistingThread: Boolean(threadId),
  };
}

function buildClaudeEndpointSessionOptions(endpoint: AgentEndpoint): {
  agentName: string;
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  runtimeDirectory: string;
  logsDirectory: string;
  launchArgs: string[];
} {
  const agentName = endpointAgentName(endpoint);
  return {
    agentName,
    sessionId: endpointRuntimeInstanceId(endpoint),
    cwd: endpointCwd(endpoint),
    systemPrompt: attachedLocalSessionSystemPrompt(endpoint),
    runtimeDirectory: relayAgentRuntimeDirectory(agentName),
    logsDirectory: relayAgentLogsDirectory(agentName),
    launchArgs: [],
  };
}

function isLocalAgentRecordOnline(agentName: string, record: LocalAgentRecord): boolean {
  const normalizedRecord = normalizeLocalAgentRecord(agentName, record);
  if (normalizedRecord.transport === "codex_app_server") {
    return isCodexAppServerAgentAlive(buildCodexAgentSessionOptions(agentName, normalizedRecord));
  }

  if (normalizedRecord.transport === "claude_stream_json") {
    return isClaudeStreamJsonAgentAlive(buildClaudeAgentSessionOptions(agentName, normalizedRecord));
  }

  return isLocalAgentSessionAlive(normalizedRecord.tmuxSession);
}

export function isLocalAgentSessionAlive(sessionName: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function isLocalAgentEndpointAlive(endpoint: AgentEndpoint): boolean {
  if (endpoint.transport === "pairing_bridge") {
    return endpoint.state !== "offline";
  }

  if (endpoint.transport === "codex_app_server") {
    return isCodexAppServerAgentAlive(buildCodexEndpointSessionOptions(endpoint));
  }

  if (endpoint.transport === "claude_stream_json") {
    return isClaudeStreamJsonAgentAlive(buildClaudeEndpointSessionOptions(endpoint));
  }

  const sessionId =
    endpoint.sessionId
    ?? (typeof endpoint.metadata?.tmuxSession === "string" ? String(endpoint.metadata.tmuxSession) : null);
  return sessionId ? isLocalAgentSessionAlive(sessionId) : false;
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

export function buildLocalAgentSystemPrompt(
  agentName: string,
  projectName: string,
  projectPath: string,
  options: { transport?: RelayRuntimeTransport } = {},
): string {
  return renderLocalAgentSystemPromptTemplate(
    buildLocalAgentSystemPromptTemplate(),
    buildLocalAgentTemplateContext(agentName, projectName, projectPath),
    options,
  );
}

function buildLocalAgentInitialMessage(projectName: string, agentName: string): string {
  return `You are now online as the ${agentName} relay agent for ${projectName}. Announce yourself on the relay with: ${brokerRelayCommand()} send --as ${agentName} "relay agent online — ready to assist with ${projectName}"`;
}

export function buildLocalAgentDirectInvocationPrompt(agentName: string, invocation: InvocationRequest): string {
  const contextLines = Object.entries(invocation.context ?? {})
    .map(([key, value]) => `- ${key}: ${String(value)}`);
  const collaborationContract = buildCollaborationContractPrompt(agentName);
  const collaborationContext = buildInvocationCollaborationContextPrompt(invocation);
  const actionRules = invocation.action === "execute"
    ? "You may inspect and modify the workspace when needed. End with the concise broker-visible reply for the requester."
    : "Do not modify files unless the request explicitly requires it. End with the concise broker-visible reply for the requester.";

  return [
    `OpenScout invocation for ${agentName}.`,
    `Requester: ${invocation.requesterId}.`,
    `Action: ${invocation.action}.`,
    invocation.conversationId ? `Conversation: ${invocation.conversationId}.` : undefined,
    invocation.messageId ? `Message: ${invocation.messageId}.` : undefined,
    "",
    actionRules,
    collaborationContract,
    "Return only the reply that should be delivered back through the broker.",
    "",
    collaborationContext,
    contextLines.length > 0 ? `Context:\n${contextLines.join("\n")}` : undefined,
    "Task:",
    invocation.task,
  ]
    .filter((value): value is string => Boolean(value && value.length > 0))
    .join("\n");
}

export function buildAttachedSessionInvocationPrompt(invocation: InvocationRequest): string {
  const contextLines = Object.entries(invocation.context ?? {})
    .map(([key, value]) => `- ${key}: ${String(value)}`);

  return [
    `Scout message from ${invocation.requesterId}.`,
    invocation.conversationId ? `Conversation: ${invocation.conversationId}.` : undefined,
    invocation.messageId ? `Reply-To Message: ${invocation.messageId}.` : undefined,
    invocation.action !== "consult" ? `Requested action: ${invocation.action}.` : undefined,
    "Treat this as a direct message to the current session and reply normally as yourself in this session.",
    contextLines.length > 0 ? `Context:\n${contextLines.join("\n")}` : undefined,
    "",
    invocation.task,
  ]
    .filter((value): value is string => Boolean(value && value.length > 0))
    .join("\n");
}

export function buildLocalAgentNudge(agentName: string, invocation: InvocationRequest, flightId: string): string {
  const relayCommand = brokerRelayCommand();
  const parts = [
    `New broker ask from ${invocation.requesterId}.`,
    `Task: ${invocation.task}`,
    "Follow the OpenScout collaboration contract: answer directly if you can, otherwise make the next owner explicit and avoid broad wakeups.",
  ];

  if (invocation.context && Object.keys(invocation.context).length > 0) {
    parts.push(`Context: ${JSON.stringify(invocation.context)}`);
  }

  parts.push(`Read recent context if needed: ${relayCommand} read -n 20 --as ${agentName}.`);
  parts.push(`Reply with: ${relayCommand} send --as ${agentName} "[ask:${flightId}] @${invocation.requesterId} <your response>"`);
  return parts.join(" ");
}

export function stripLocalAgentReplyMetadata(body: string, flightId: string, asker: string): string {
  return body
    .replace(new RegExp(`\\[ask:${escapeRegExp(flightId)}\\]`, "g"), "")
    .replace(new RegExp(`@${escapeRegExp(asker)}`, "g"), "")
    .trim();
}

async function sendLocalAgentPrompt(agentName: string, record: LocalAgentRecord, prompt: string): Promise<void> {
  if (normalizeLocalAgentHarness(record.harness) === "codex") {
    const promptPipe = join(relayAgentRuntimeDirectory(agentName), "prompt.pipe");
    await writeFile(promptPipe, prompt.trim() + "\0");
    return;
  }

  sendTmuxPrompt(record.tmuxSession, prompt);
}

export function sendTmuxPrompt(sessionName: string, prompt: string): void {
  const bufferName = `openscout-prompt-${randomUUID()}`;
  try {
    execFileSync("tmux", ["load-buffer", "-b", bufferName, "-"], {
      stdio: "pipe",
      input: prompt,
    });
    execFileSync("tmux", ["paste-buffer", "-d", "-b", bufferName, "-t", sessionName], {
      stdio: "pipe",
    });
    execFileSync("tmux", ["send-keys", "-t", sessionName, "Enter"], { stdio: "pipe" });
  } catch (error) {
    try {
      execFileSync("tmux", ["delete-buffer", "-b", bufferName], { stdio: "pipe" });
    } catch {
      // Ignore cleanup failures after a tmux delivery error.
    }
    throw error;
  }
}

function shellQuoteArguments(args: string[]): string {
  return args.map((arg) => JSON.stringify(arg)).join(" ");
}

function buildLocalAgentBootstrapPrompt(_harness: AgentHarness, _systemPrompt: string, initialMessage: string): string {
  return initialMessage;
}

function buildLocalAgentLaunchCommand(
  agentName: string,
  record: LocalAgentRecord,
  projectPath: string,
  promptFile: string,
  workerScript?: string,
): string {
  const extraArgs = shellQuoteArguments(normalizeLocalAgentLaunchArgs(record.launchArgs));
  if (normalizeLocalAgentHarness(record.harness) === "codex") {
    return `exec bash ${JSON.stringify(workerScript ?? join(relayAgentRuntimeDirectory(agentName), "codex-worker.sh"))}`;
  }

  return [
    "claude",
    `--append-system-prompt "$(cat ${JSON.stringify(promptFile)})"`,
    "--name",
    JSON.stringify(`${agentName}-relay-agent`),
    extraArgs,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildCodexExecCommand(
  record: LocalAgentRecord,
  projectPath: string,
  promptFileExpression: string,
  options: { resumeSessionIdExpression?: string | null } = {},
): string {
  const extraArgs = shellQuoteArguments(normalizeLocalAgentLaunchArgs(record.launchArgs));
  const sharedArgs = [
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--color",
    "never",
    "-c",
    "check_for_update_on_startup=false",
    extraArgs,
  ].filter(Boolean).join(" ");

  if (options.resumeSessionIdExpression) {
    return [
      "codex exec resume",
      options.resumeSessionIdExpression,
      sharedArgs,
      "-",
      `< ${promptFileExpression}`,
    ].filter(Boolean).join(" ");
  }

  return [
    "codex exec",
    sharedArgs,
    "-C",
    JSON.stringify(projectPath),
    "-",
    `< ${promptFileExpression}`,
  ].filter(Boolean).join(" ");
}

function buildCodexWorkerScript(
  agentName: string,
  record: LocalAgentRecord,
  projectPath: string,
  promptFile: string,
  queueDirectory: string,
  processingDirectory: string,
  processedDirectory: string,
  sessionIdFile: string,
): string {
  const bootstrapInputFile = join(processingDirectory, "bootstrap-input.txt");
  const resumeIdExpression = '"$(cat "$SESSION_ID_FILE")"';
  const firstRunCommand = buildCodexExecCommand(record, projectPath, '"$ACTIVE_INPUT_FILE"');
  const resumeCommand = buildCodexExecCommand(record, projectPath, '"$ACTIVE_INPUT_FILE"', {
    resumeSessionIdExpression: resumeIdExpression,
  });

  return [
    "#!/bin/bash",
    "set -uo pipefail",
    `TWIN_NAME=${JSON.stringify(agentName)}`,
    `PROJECT_PATH=${JSON.stringify(projectPath)}`,
    `PROMPT_FILE=${JSON.stringify(promptFile)}`,
    `QUEUE_DIR=${JSON.stringify(queueDirectory)}`,
    `PROCESSING_DIR=${JSON.stringify(processingDirectory)}`,
    `PROCESSED_DIR=${JSON.stringify(processedDirectory)}`,
    `SESSION_ID_FILE=${JSON.stringify(sessionIdFile)}`,
    `BOOTSTRAP_INPUT_FILE=${JSON.stringify(bootstrapInputFile)}`,
    "",
    "mkdir -p \"$QUEUE_DIR\" \"$PROCESSING_DIR\" \"$PROCESSED_DIR\"",
    "echo \"[openscout] codex relay worker ready for ${TWIN_NAME}\"",
    "",
    "while true; do",
    "  set -- \"$QUEUE_DIR\"/*.prompt",
    "  if [ ! -e \"$1\" ]; then",
    "    sleep 0.2",
    "    continue",
    "  fi",
    "",
    "  current_file=\"$1\"",
    "  prompt_name=\"$(basename \"$current_file\")\"",
    "  working_file=\"$PROCESSING_DIR/$prompt_name\"",
    "  mv \"$current_file\" \"$working_file\" || continue",
    "",
    "  run_output=\"$PROCESSED_DIR/${prompt_name%.prompt}.output.log\"",
    "  active_input_file=\"$working_file\"",
    "  if [ ! -s \"$SESSION_ID_FILE\" ]; then",
    "    cat \"$PROMPT_FILE\" > \"$BOOTSTRAP_INPUT_FILE\"",
    "    printf '\\n\\n' >> \"$BOOTSTRAP_INPUT_FILE\"",
    "    cat \"$working_file\" >> \"$BOOTSTRAP_INPUT_FILE\"",
    "    active_input_file=\"$BOOTSTRAP_INPUT_FILE\"",
    "  fi",
    "",
    "  export ACTIVE_INPUT_FILE=\"$active_input_file\"",
    "  printf '\\n[openscout] codex prompt %s\\n' \"$prompt_name\"",
    "  if [ -s \"$SESSION_ID_FILE\" ]; then",
    `    ${resumeCommand} 2>&1 | tee \"$run_output\"`,
    "  else",
    `    ${firstRunCommand} 2>&1 | tee \"$run_output\"`,
    "  fi",
    "  exit_code=${PIPESTATUS[0]}",
    "",
    "  if [ ! -s \"$SESSION_ID_FILE\" ] && [ \"$exit_code\" -eq 0 ]; then",
    "    session_id=\"$(sed -n 's/^session id: //p' \"$run_output\" | head -n 1 | tr -d '\\r')\"",
    "    if [ -n \"$session_id\" ]; then",
    "      printf '%s\\n' \"$session_id\" > \"$SESSION_ID_FILE\"",
    "    fi",
    "  fi",
    "",
    "  printf '[openscout] codex exit %s for %s\\n' \"$exit_code\" \"$prompt_name\"",
    "  mv \"$working_file\" \"$PROCESSED_DIR/$prompt_name\"",
    "done",
    "",
  ].join("\n");
}

export function buildTmuxLaunchShellCommand(launchScript: string): string {
  return `exec bash ${JSON.stringify(launchScript)}`;
}

function killAgentSession(sessionName: string): void {
  try {
    execSync(`tmux kill-session -t ${JSON.stringify(sessionName)}`, { stdio: "pipe" });
  } catch {
    // Ignore missing sessions during restart.
  }
}

function isHarnessBinaryAvailable(transport: string): boolean {
  const binaryMap: Record<string, string> = {
    claude_stream_json: "claude",
    codex_app_server: "codex",
  };
  const binary = binaryMap[transport];
  if (!binary) return true;
  try {
    execFileSync("sh", ["-lc", `command -v ${binary}`], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureLocalAgentOnline(agentName: string, record: LocalAgentRecord): Promise<LocalAgentRecord> {
  const normalizedRecord = normalizeLocalAgentRecord(agentName, record);
  if (isLocalAgentRecordOnline(agentName, normalizedRecord)) {
    return normalizedRecord;
  }

  if (!isHarnessBinaryAvailable(normalizedRecord.transport)) {
    console.warn(`[openscout-runtime] skipping warmup for ${agentName}: harness binary for ${normalizedRecord.transport} not found in PATH`);
    return normalizedRecord;
  }

  const projectPath = normalizedRecord.cwd;
  const projectName = normalizedRecord.project || basename(projectPath);
  const systemPromptTemplate = normalizedRecord.systemPrompt || buildLocalAgentSystemPromptTemplate();
  const systemPrompt = renderLocalAgentSystemPromptTemplate(
    systemPromptTemplate,
    buildLocalAgentTemplateContext(agentName, projectName, projectPath),
    { transport: normalizedRecord.transport },
  );

  const agentRuntimeDir = relayAgentRuntimeDirectory(agentName);
  const logsDir = relayAgentLogsDirectory(agentName);
  await mkdir(agentRuntimeDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  if (normalizedRecord.transport === "codex_app_server") {
    await writeFile(join(agentRuntimeDir, "prompt.txt"), systemPrompt);
    await ensureCodexAppServerAgentOnline(buildCodexAgentSessionOptions(agentName, normalizedRecord, systemPrompt));

    const registry = await readLocalAgentRegistry();
    registry[agentName] = {
      ...normalizedRecord,
      startedAt: nowSeconds(),
      systemPrompt: normalizedRecord.systemPrompt,
    };
    await writeLocalAgentRegistry(registry);

    return registry[agentName];
  }

  if (normalizedRecord.transport === "claude_stream_json") {
    await writeFile(join(agentRuntimeDir, "prompt.txt"), systemPrompt);
    await ensureClaudeStreamJsonAgentOnline(buildClaudeAgentSessionOptions(agentName, normalizedRecord, systemPrompt));

    const registry = await readLocalAgentRegistry();
    registry[agentName] = {
      ...normalizedRecord,
      startedAt: nowSeconds(),
      systemPrompt: normalizedRecord.systemPrompt,
    };
    await writeLocalAgentRegistry(registry);

    return registry[agentName];
  }

  const initialMessage = buildLocalAgentInitialMessage(projectName, agentName);
  const bootstrapPrompt = buildLocalAgentBootstrapPrompt(normalizeLocalAgentHarness(normalizedRecord.harness), systemPrompt, initialMessage);

  const queueDirectory = join(agentRuntimeDir, "queue");
  const processingDirectory = join(queueDirectory, "processing");
  const processedDirectory = join(queueDirectory, "processed");

  const promptFile = join(agentRuntimeDir, "prompt.txt");
  const initialFile = join(agentRuntimeDir, "initial.txt");
  const launchScript = join(agentRuntimeDir, "launch.sh");
  const workerScript = join(agentRuntimeDir, "codex-worker.sh");
  const codexSessionIdFile = join(agentRuntimeDir, "codex-session-id.txt");
  const stateFile = join(agentRuntimeDir, "state.json");
  const stdoutLogFile = join(logsDir, "stdout.log");
  const stderrLogFile = join(logsDir, "stderr.log");

  await writeFile(promptFile, systemPrompt);
  await writeFile(initialFile, bootstrapPrompt);
  await writeFile(stderrLogFile, "");
  await rm(queueDirectory, { recursive: true, force: true });
  await mkdir(processingDirectory, { recursive: true });
  await mkdir(processedDirectory, { recursive: true });
  await writeFile(codexSessionIdFile, "");
  const bootstrapLine = null;

  await writeFile(
    launchScript,
    [
      "#!/bin/bash",
      "set -uo pipefail",
      `mkdir -p ${JSON.stringify(logsDir)}`,
      `cd ${JSON.stringify(projectPath)}`,
      ...buildManagedAgentShellExports({
        agentName,
        currentDirectory: projectPath,
      }),
      bootstrapLine,
      buildLocalAgentLaunchCommand(agentName, normalizedRecord, projectPath, promptFile, workerScript),
    ].filter(Boolean).join("\n") + "\n",
  );
  execFileSync("chmod", ["755", launchScript], { stdio: "pipe" });
  const paneId = execFileSync(
    "tmux",
    [
      "new-session",
      "-dP",
      "-F",
      "#{pane_id}",
      "-s",
      normalizedRecord.tmuxSession,
      "-c",
      projectPath,
      buildTmuxLaunchShellCommand(launchScript),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (paneId) {
    try {
      execFileSync(
        "tmux",
        ["pipe-pane", "-o", "-t", paneId, `cat >> ${JSON.stringify(stdoutLogFile)}`],
        { stdio: "pipe" },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[openscout-runtime] unable to attach tmux pipe for ${agentName}: ${reason}`);
    }
  }
  await writeFile(
    stateFile,
    JSON.stringify({
      agentId: agentName,
      projectRoot: projectPath,
      sessionId: normalizedRecord.tmuxSession,
      promptFile,
      initialFile,
      launchScript,
      workerScript: null,
      queueDirectory: null,
      codexSessionIdFile: null,
      stdoutLogFile,
      stderrLogFile,
      updatedAt: new Date().toISOString(),
    }, null, 2) + "\n",
  );

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (isLocalAgentSessionAlive(normalizedRecord.tmuxSession)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!isLocalAgentSessionAlive(normalizedRecord.tmuxSession)) {
    const stderrTail = existsSync(stderrLogFile)
      ? readFileSync(stderrLogFile, "utf8").trim().split(/\r?\n/).slice(-10).join("\n").trim()
      : "";
    throw new Error(
      stderrTail
        ? `Relay agent ${agentName} failed to stay online:\n${stderrTail}`
        : `Relay agent ${agentName} failed to stay online.`,
    );
  }

  const registry = await readLocalAgentRegistry();
  registry[agentName] = {
    ...normalizedRecord,
    startedAt: nowSeconds(),
    systemPrompt: normalizedRecord.systemPrompt,
  };
  await writeLocalAgentRegistry(registry);

  return registry[agentName];
}

export async function restartLocalAgent(
  agentId: string,
  options: { previousSessionId?: string | null } = {},
): Promise<LocalAgentRecord | null> {
  const registry = await readLocalAgentRegistry();
  const record = registry[agentId];
  if (!record) {
    return null;
  }

  const normalizedRecord = normalizeLocalAgentRecord(agentId, record);
  const sessionsToStop = new Set<string>([
    normalizedRecord.tmuxSession,
    ...(options.previousSessionId?.trim() ? [options.previousSessionId.trim()] : []),
  ]);

  if (normalizedRecord.transport === "codex_app_server") {
    for (const sessionName of sessionsToStop) {
      await shutdownCodexAppServerAgent({
        ...buildCodexAgentSessionOptions(agentId, normalizedRecord),
        sessionId: sessionName,
      }, {
        resetThread: true,
      });
    }
  } else if (normalizedRecord.transport === "claude_stream_json") {
    for (const sessionName of sessionsToStop) {
      await shutdownClaudeStreamJsonAgent({
        ...buildClaudeAgentSessionOptions(agentId, normalizedRecord),
        sessionId: sessionName,
      }, {
        resetSession: true,
      });
    }
  } else {
    for (const sessionName of sessionsToStop) {
      killAgentSession(sessionName);
    }
  }

  return ensureLocalAgentOnline(agentId, normalizedRecord);
}

export type ResolvedAgentName = {
  agentId: string;
  definitionId: string;
  projectRoot: string;
};

export async function resolveLocalAgentByName(name: string): Promise<ResolvedAgentName | null> {
  const normalized = normalizeAgentSelectorSegment(name);
  if (!normalized) return null;

  const overrides = await readRelayAgentOverrides();
  for (const [id, override] of Object.entries(overrides)) {
    if (BUILT_IN_AGENT_DEFINITION_IDS.has(id)) continue;
    const defId = override.definitionId ?? id;
    if (defId === normalized || normalizeAgentSelectorSegment(override.projectName ?? "") === normalized) {
      return { agentId: id, definitionId: defId, projectRoot: override.projectRoot };
    }
  }
  return null;
}

export async function listLocalAgents(options: {
  currentDirectory?: string;
} = {}): Promise<ScoutLocalAgentStatus[]> {
  void options;
  const overrides = await readRelayAgentOverrides();

  return Object.entries(overrides)
    .filter(([agentId]) => !BUILT_IN_AGENT_DEFINITION_IDS.has(agentId))
    .map(([agentId, override]) => (
      localAgentStatusFromRecord(
        agentId,
        localAgentRecordFromRelayAgentOverride(agentId, override),
        localAgentStatusSource(agentId, overrides),
      )
    ))
    .sort((lhs, rhs) => lhs.projectName.localeCompare(rhs.projectName) || lhs.agentId.localeCompare(rhs.agentId));
}

export type ResolvedAgentIdentity = {
  definitionId: string;
  displayName: string;
  instanceId: string;
  branch: string | null;
  nodeQualifier: string;
  harness: ManagedAgentHarness;
  projectRoot: string;
  projectName: string;
  source: "existing" | "new" | "config";
};

export async function resolveLocalAgentIdentity(input: StartLocalAgentInput): Promise<ResolvedAgentIdentity> {
  const projectPath = normalizeProjectPath(input.projectPath);
  const preferredHarness = input.harness ? normalizeLocalAgentHarness(input.harness) : undefined;
  const requestedDefinitionId = input.agentName?.trim()
    ? normalizeAgentSelectorSegment(input.agentName.trim())
    : "";

  if (input.agentName?.trim() && !requestedDefinitionId) {
    throw new Error(`Invalid agent name "${input.agentName}".`);
  }

  const overrides = await readRelayAgentOverrides();

  const findMatchForRoot = (root: string): { agentId: string; override: RelayAgentOverride } | null => {
    let fallback: { agentId: string; override: RelayAgentOverride } | null = null;
    for (const [id, override] of Object.entries(overrides)) {
      if (BUILT_IN_AGENT_DEFINITION_IDS.has(id)) continue;
      if (!override.projectRoot) continue;
      if (normalizeProjectPath(override.projectRoot) !== root) continue;
      if (requestedDefinitionId && override.definitionId === requestedDefinitionId) {
        return { agentId: id, override };
      }
      if (!fallback) fallback = { agentId: id, override };
    }
    return fallback;
  };

  let matched = findMatchForRoot(projectPath);
  let projectRoot = projectPath;

  if (!matched) {
    const resolved = await findNearestProjectRoot(projectPath);
    if (resolved && resolved !== projectPath) {
      projectRoot = normalizeProjectPath(resolved);
      matched = findMatchForRoot(projectRoot);
    }
  }

  if (matched) {
    const override = matched.override;
    const instance = buildRelayAgentInstance(override.definitionId ?? matched.agentId, normalizeProjectPath(override.projectRoot));
    return {
      definitionId: override.definitionId ?? matched.agentId,
      displayName: input.displayName || override.displayName || titleCaseLocalAgentName(override.definitionId ?? matched.agentId),
      instanceId: instance.id,
      branch: instance.branch,
      nodeQualifier: instance.nodeQualifier,
      harness: normalizeManagedHarness(preferredHarness ?? override.defaultHarness, "claude"),
      projectRoot: normalizeProjectPath(override.projectRoot),
      projectName: override.projectName ?? basename(override.projectRoot),
      source: "existing",
    };
  }

  const ensuredProject = await ensureProjectConfigForDirectory(projectPath);
  projectRoot = ensuredProject.projectRoot ?? projectPath;
  const config = ensuredProject.config;

  matched = findMatchForRoot(projectRoot);
  if (matched) {
    const override = matched.override;
    const instance = buildRelayAgentInstance(override.definitionId ?? matched.agentId, normalizeProjectPath(override.projectRoot));
    return {
      definitionId: override.definitionId ?? matched.agentId,
      displayName: input.displayName || override.displayName || titleCaseLocalAgentName(override.definitionId ?? matched.agentId),
      instanceId: instance.id,
      branch: instance.branch,
      nodeQualifier: instance.nodeQualifier,
      harness: normalizeManagedHarness(preferredHarness ?? override.defaultHarness, "claude"),
      projectRoot: normalizeProjectPath(override.projectRoot),
      projectName: override.projectName ?? basename(override.projectRoot),
      source: "existing",
    };
  }

  const configDefinitionId = config?.agent?.id?.trim()
    ? normalizeAgentSelectorSegment(config.agent.id.trim())
    : "";
  const definitionId = requestedDefinitionId || configDefinitionId || normalizeAgentSelectorSegment(basename(projectRoot)) || "agent";
  const configDisplayName = config?.agent?.displayName?.trim() || "";
  const displayName = input.displayName || configDisplayName || titleCaseLocalAgentName(definitionId);
  const instance = buildRelayAgentInstance(definitionId, projectRoot);
  const configDefaultHarness = config?.agent?.runtime?.defaultHarness;
  const effectiveHarness = normalizeManagedHarness(preferredHarness ?? configDefaultHarness, "claude");

  return {
    definitionId,
    displayName,
    instanceId: instance.id,
    branch: instance.branch,
    nodeQualifier: instance.nodeQualifier,
    harness: effectiveHarness,
    projectRoot,
    projectName: basename(projectRoot),
    source: configDefinitionId || configDisplayName ? "config" : "new",
  };
}

export async function startLocalAgent(input: StartLocalAgentInput): Promise<ScoutLocalAgentStatus> {
  const projectPath = normalizeProjectPath(input.projectPath);
  const preferredHarness = input.harness ? normalizeLocalAgentHarness(input.harness) : undefined;
  const currentDirectory = input.currentDirectory ?? projectPath;
  const effectiveCwd = input.cwdOverride ? normalizeProjectPath(input.cwdOverride) : undefined;
  const requestedDefinitionId = input.agentName?.trim()
    ? normalizeAgentSelectorSegment(input.agentName.trim())
    : "";

  if (input.agentName?.trim() && !requestedDefinitionId) {
    throw new Error(`Invalid agent name "${input.agentName}".`);
  }

  // Fast path: operate directly on the relay-agents override file. No filesystem walk,
  // no project-config sync. The override file is the single source of truth for
  // registered agents; if a match exists for this projectPath we skip the expensive
  // ensureProjectConfigForDirectory (which reads every ~/.claude/projects/<slug>/*.jsonl).
  const overrides = await readRelayAgentOverrides();

  const findMatchForRoot = (root: string): { agentId: string; override: RelayAgentOverride } | null => {
    let fallback: { agentId: string; override: RelayAgentOverride } | null = null;
    for (const [id, override] of Object.entries(overrides)) {
      if (BUILT_IN_AGENT_DEFINITION_IDS.has(id)) continue;
      if (!override.projectRoot) continue;
      if (normalizeProjectPath(override.projectRoot) !== root) continue;
      if (requestedDefinitionId && override.definitionId === requestedDefinitionId) {
        return { agentId: id, override };
      }
      if (!fallback) fallback = { agentId: id, override };
    }
    return fallback;
  };

  // First try the caller-provided path directly. Mobile createSession always passes
  // the canonical projectRoot, so this short-circuits the slow findNearestProjectRoot walk.
  let matched = findMatchForRoot(projectPath);
  let projectRoot = projectPath;

  // Fallback: resolve to the nearest project root (covers `scout up` from a subdir) and retry.
  if (!matched) {
    const resolved = await findNearestProjectRoot(projectPath);
    if (resolved && resolved !== projectPath) {
      projectRoot = normalizeProjectPath(resolved);
      matched = findMatchForRoot(projectRoot);
    }
  }

  let matchingAgentId = matched?.agentId;
  let matchingOverride = matched?.override;
  let coldProjectConfigPath: string | null = null;

  let targetAgentId: string;

  let coldProjectConfig: OpenScoutProjectConfig | null = null;

  if (!matchingOverride) {
    // Cold path only: hit the config-ensure helper (and its ~/.claude scan) to seed a
    // first-time agent override. Warm mobile createSession never lands here.
    const ensuredProject = await ensureProjectConfigForDirectory(projectPath);
    projectRoot = ensuredProject.projectRoot ?? projectPath;
    coldProjectConfigPath = ensuredProject.projectConfigPath ?? null;
    coldProjectConfig = ensuredProject.config ?? null;
    // Recheck overrides in case ensureProjectConfigForDirectory canonicalized the root
    // to something we already have a match for.
    matched = findMatchForRoot(projectRoot);
    matchingAgentId = matched?.agentId;
    matchingOverride = matched?.override;
  }

  if (!matchingOverride) {
    // Dynamic agent creation: build an override from workspace defaults.
    // Use project config's agent.id as a fallback for the definition ID.
    const configDefinitionId = coldProjectConfig?.agent?.id?.trim()
      ? normalizeAgentSelectorSegment(coldProjectConfig.agent.id.trim())
      : "";
    const definitionId = requestedDefinitionId || configDefinitionId || normalizeAgentSelectorSegment(basename(projectRoot)) || "agent";
    const configDisplayName = coldProjectConfig?.agent?.displayName?.trim() || "";
    const effectiveDisplayName = input.displayName || configDisplayName || titleCaseLocalAgentName(definitionId);
    const instance = buildRelayAgentInstance(definitionId, projectRoot);
    const configDefaultHarness = coldProjectConfig?.agent?.runtime?.defaultHarness;
    const effectiveHarness = normalizeManagedHarness(preferredHarness ?? configDefaultHarness, "claude");
    const transport = normalizeLocalAgentTransport(undefined, effectiveHarness);
    const sessionId = normalizeTmuxSessionName(undefined, `${instance.id}-${effectiveHarness}`);

    const existingForInstance = overrides[instance.id];
    if (existingForInstance && normalizeProjectPath(existingForInstance.projectRoot) !== projectRoot) {
      throw new Error(
        `Another agent is already registered as ${instance.id} at ${existingForInstance.projectRoot}. `
          + `Two clones of the same project on the same branch cannot both register here; `
          + `rename one of the checkouts or switch its branch before running scout up.`,
      );
    }

    overrides[instance.id] = {
      agentId: instance.id,
      definitionId,
      displayName: effectiveDisplayName,
      projectName: basename(projectRoot),
      projectRoot,
      projectConfigPath: coldProjectConfigPath,
      source: "manual",
      startedAt: nowSeconds(),
      defaultHarness: effectiveHarness,
      harnessProfiles: {
        [effectiveHarness]: {
          cwd: effectiveCwd ?? projectRoot,
          transport,
          sessionId,
          launchArgs: [],
        },
      },
      runtime: {
        cwd: effectiveCwd ?? projectRoot,
        harness: effectiveHarness,
        transport,
        sessionId,
        wakePolicy: "on_demand",
      },
    };
    await writeRelayAgentOverrides(overrides);
    targetAgentId = instance.id;
  } else if (requestedDefinitionId && requestedDefinitionId !== matchingOverride.definitionId) {
    // Caller asked for a different definitionId than the stored override — fork a new instance.
    const matchingProjectRoot = normalizeProjectPath(matchingOverride.projectRoot);
    const instance = buildRelayAgentInstance(requestedDefinitionId, matchingProjectRoot);
    const existingForInstance = overrides[instance.id];
    if (
      existingForInstance
      && normalizeProjectPath(existingForInstance.projectRoot) !== matchingProjectRoot
    ) {
      throw new Error(
        `Another agent is already registered as ${instance.id} at ${existingForInstance.projectRoot}. `
          + `Two clones of the same project on the same branch cannot both register here; `
          + `rename one of the checkouts or switch its branch before running scout up.`,
      );
    }
    const resolvedHarness = preferredHarness ?? matchingOverride.runtime?.harness;
    overrides[instance.id] = {
      agentId: instance.id,
      definitionId: requestedDefinitionId,
      displayName: input.displayName || titleCaseLocalAgentName(requestedDefinitionId),
      projectName: matchingOverride.projectName ?? basename(matchingProjectRoot),
      projectRoot: matchingProjectRoot,
      projectConfigPath: matchingOverride.projectConfigPath ?? null,
      source: "manual",
      startedAt: matchingOverride.startedAt ?? nowSeconds(),
      systemPrompt: matchingOverride.systemPrompt,
      launchArgs: matchingOverride.launchArgs,
      capabilities: matchingOverride.capabilities,
      defaultHarness: normalizeManagedHarness(preferredHarness ?? matchingOverride.defaultHarness, "claude"),
      harnessProfiles: matchingOverride.harnessProfiles,
      runtime: {
        cwd: effectiveCwd ?? matchingOverride.runtime?.cwd ?? matchingProjectRoot,
        harness: resolvedHarness,
        transport: preferredHarness
          ? normalizeLocalAgentTransport(undefined, preferredHarness)
          : matchingOverride.runtime?.transport,
        sessionId: matchingOverride.runtime?.sessionId
          ?? normalizeTmuxSessionName(undefined, `${instance.id}-${normalizeManagedHarness(resolvedHarness, "claude")}`),
        wakePolicy: "on_demand",
      },
    };
    await writeRelayAgentOverrides(overrides);
    targetAgentId = instance.id;
  } else {
    // Existing override already matches — nothing to persist.
    targetAgentId = matchingAgentId!;
  }

  await ensureLocalAgentBindingOnline(targetAgentId, process.env.OPENSCOUT_NODE_ID ?? "local", {
    includeDiscovered: false,
    currentDirectory,
    ensureCurrentProjectConfig: false,
    harness: preferredHarness,
  });

  const finalOverrides = await readRelayAgentOverrides();
  const finalOverride = finalOverrides[targetAgentId];
  if (!finalOverride) {
    throw new Error(`Agent ${targetAgentId} did not register successfully.`);
  }
  const record = localAgentRecordFromRelayAgentOverride(targetAgentId, finalOverride);

  return localAgentStatusFromRecord(targetAgentId, record, localAgentStatusSource(targetAgentId, finalOverrides));
}

export async function stopLocalAgent(agentId: string): Promise<ScoutLocalAgentStatus | null> {
  const [registry, overrides] = await Promise.all([
    readLocalAgentRegistry(),
    readRelayAgentOverrides(),
  ]);
  const record = registry[agentId];
  if (!record) {
    return null;
  }

  const normalizedRecord = normalizeLocalAgentRecord(agentId, record);
  const sessionsToStop = new Set<string>([normalizedRecord.tmuxSession]);

  if (normalizedRecord.transport === "codex_app_server") {
    for (const sessionName of sessionsToStop) {
      await shutdownCodexAppServerAgent({
        ...buildCodexAgentSessionOptions(agentId, normalizedRecord),
        sessionId: sessionName,
      }, {
        resetThread: true,
      });
    }
  } else if (normalizedRecord.transport === "claude_stream_json") {
    for (const sessionName of sessionsToStop) {
      await shutdownClaudeStreamJsonAgent({
        ...buildClaudeAgentSessionOptions(agentId, normalizedRecord),
        sessionId: sessionName,
      }, {
        resetSession: true,
      });
    }
  } else {
    for (const sessionName of sessionsToStop) {
      killAgentSession(sessionName);
    }
  }

  return {
    ...localAgentStatusFromRecord(agentId, normalizedRecord, localAgentStatusSource(agentId, overrides)),
    isOnline: false,
  };
}

export async function interruptLocalAgent(agentId: string): Promise<{ ok: boolean; agentId: string }> {
  const registry = await readLocalAgentRegistry();
  const record = registry[agentId];
  if (!record) {
    return { ok: false, agentId };
  }

  const normalizedRecord = normalizeLocalAgentRecord(agentId, record);
  const sessionName = normalizedRecord.tmuxSession;

  try {
    execSync(`tmux send-keys -t ${JSON.stringify(sessionName)} C-c`, { stdio: "pipe" });
    return { ok: true, agentId };
  } catch {
    return { ok: false, agentId };
  }
}

export async function stopAllLocalAgents(options: {
  currentDirectory?: string;
} = {}): Promise<ScoutLocalAgentStatus[]> {
  const agents = await listLocalAgents(options);
  const stopped = await Promise.all(agents.map(async (agent) => stopLocalAgent(agent.agentId)));
  return stopped.filter((agent): agent is ScoutLocalAgentStatus => Boolean(agent));
}

export async function restartAllLocalAgents(options: {
  currentDirectory?: string;
} = {}): Promise<ScoutLocalAgentStatus[]> {
  const agents = await listLocalAgents(options);
  const overrides = await readRelayAgentOverrides();
  const restarted = await Promise.all(agents.map(async (agent) => {
    const record = await restartLocalAgent(agent.agentId);
    if (!record) {
      return null;
    }
    return localAgentStatusFromRecord(
      agent.agentId,
      record,
      localAgentStatusSource(agent.agentId, overrides),
    );
  }));
  return restarted.filter((agent): agent is ScoutLocalAgentStatus => Boolean(agent));
}

function buildLocalAgentBinding(
  agentId: string,
  record: LocalAgentRecord,
  alive: boolean,
  nodeId: string,
  source: "relay-agent-registry" | "project-inferred",
): LocalAgentBinding {
  const normalizedRecord = normalizeLocalAgentRecord(agentId, record);
  const definitionId = normalizedRecord.definitionId ?? agentId;
  const displayName = titleCaseLocalAgentName(definitionId);
  const projectRoot = normalizedRecord.projectRoot ?? normalizedRecord.cwd;
  const instance = buildRelayAgentInstance(definitionId, projectRoot);
  const actorId = instance.id;

  return {
    actor: {
      id: actorId,
      kind: "agent",
      displayName,
      handle: definitionId,
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        source,
        project: normalizedRecord.project,
        projectRoot,
        tmuxSession: normalizedRecord.tmuxSession,
        definitionId,
        instanceId: instance.id,
        selector: instance.selector,
        defaultSelector: instance.defaultSelector,
        nodeQualifier: instance.nodeQualifier,
        workspaceQualifier: instance.workspaceQualifier,
        branch: instance.branch,
      },
    },
    agent: {
      id: actorId,
      kind: "agent",
      definitionId,
      nodeQualifier: instance.nodeQualifier,
      workspaceQualifier: instance.workspaceQualifier,
      selector: instance.selector,
      defaultSelector: instance.defaultSelector,
      displayName,
      handle: definitionId,
      labels: ["relay", "project", "agent", "local-agent"],
      metadata: {
        source,
        project: normalizedRecord.project,
        projectRoot,
        tmuxSession: normalizedRecord.tmuxSession,
        summary: `${displayName} relay agent for ${normalizedRecord.project}.`,
        role: "Relay agent",
        definitionId,
        instanceId: instance.id,
        selector: instance.selector,
        defaultSelector: instance.defaultSelector,
        nodeQualifier: instance.nodeQualifier,
        workspaceQualifier: instance.workspaceQualifier,
        branch: instance.branch,
      },
      agentClass: "general",
      capabilities: normalizeLocalAgentCapabilities(normalizedRecord.capabilities),
      wakePolicy: "on_demand",
      homeNodeId: nodeId,
      authorityNodeId: nodeId,
      advertiseScope: "local",
    },
    endpoint: {
      id: `endpoint.${actorId}.${nodeId}.${normalizedRecord.transport}`,
      agentId: actorId,
      nodeId,
      harness: normalizeLocalAgentHarness(normalizedRecord.harness),
      transport: normalizedRecord.transport,
      state: alive ? "idle" : "waiting",
      cwd: normalizedRecord.cwd,
      projectRoot,
      sessionId: normalizedRecord.tmuxSession,
      metadata: {
        source,
        agentName: definitionId,
        tmuxSession: normalizedRecord.tmuxSession,
        runtimeInstanceId: normalizedRecord.tmuxSession,
        transport: normalizedRecord.transport,
        project: normalizedRecord.project,
        projectRoot,
        startedAt: String(normalizedRecord.startedAt),
        instanceId: instance.id,
        selector: instance.selector,
        nodeQualifier: instance.nodeQualifier,
        workspaceQualifier: instance.workspaceQualifier,
        branch: instance.branch,
      },
    },
  };
}

export async function loadRegisteredLocalAgentBindings(
  nodeId: string,
  options: { ensureOnline?: boolean; agentIds?: string[]; harness?: AgentHarness } = {},
): Promise<LocalAgentBinding[]> {
  const [registry, overrides] = await Promise.all([
    readLocalAgentRegistry(),
    readRelayAgentOverrides(),
  ]);
  const requestedAgentIds = new Set((options.agentIds ?? []).filter(Boolean));
  const selectedEntries = Object.entries(registry).filter(([agentId]) => (
    requestedAgentIds.size === 0 || requestedAgentIds.has(agentId)
  ));

  const results = await Promise.all(selectedEntries.map(async ([agentId, record]) => {
    const baseRecord = overrides[agentId]?.projectRoot
      ? {
        ...record,
        projectRoot: overrides[agentId].projectRoot,
      }
      : record;
    const harnessRecord = options.harness ? recordForHarness(baseRecord, options.harness) : baseRecord;

    let effectiveRecord: LocalAgentRecord;
    if (options.ensureOnline) {
      try {
        effectiveRecord = await ensureLocalAgentOnline(agentId, harnessRecord);
      } catch (error) {
        console.error(`[openscout-runtime] failed to warm agent ${agentId}: ${error instanceof Error ? error.message : error}`);
        effectiveRecord = normalizeLocalAgentRecord(agentId, harnessRecord);
      }
    } else {
      effectiveRecord = normalizeLocalAgentRecord(agentId, harnessRecord);
    }

    return buildLocalAgentBinding(
      agentId,
      effectiveRecord,
      isLocalAgentRecordOnline(agentId, effectiveRecord),
      nodeId,
      "relay-agent-registry",
    );
  }));

  return results;
}

export async function inferLocalAgentBinding(agentId: string, nodeId: string): Promise<LocalAgentBinding | null> {
  if (!agentId || BUILT_IN_AGENT_DEFINITION_IDS.has(agentId)) {
    return null;
  }

  const overrides = await readRelayAgentOverrides();
  const override = overrides[agentId];
  if (!override) {
    return null;
  }

  const record = localAgentRecordFromRelayAgentOverride(agentId, override);
  return buildLocalAgentBinding(
    agentId,
    record,
    isLocalAgentRecordOnline(agentId, record),
    nodeId,
    "relay-agent-registry",
  );
}

export async function ensureLocalAgentBindingOnline(
  agentId: string,
  nodeId: string,
  options: {
    includeDiscovered?: boolean;
    currentDirectory?: string;
    ensureCurrentProjectConfig?: boolean;
    harness?: AgentHarness;
  } = {},
): Promise<LocalAgentBinding | null> {
  if (!agentId) {
    return null;
  }

  const registeredBinding = (await loadRegisteredLocalAgentBindings(nodeId, {
    agentIds: [agentId],
    ensureOnline: true,
    harness: options.harness,
  }))[0];
  if (registeredBinding) {
    return registeredBinding;
  }

  if (BUILT_IN_AGENT_DEFINITION_IDS.has(agentId)) {
    return null;
  }

  // Fallback: hydrate directly from the relay-agents override file. No filesystem walk,
  // no legacy-mirror sync. `includeDiscovered` used to opt into a filesystem scan that
  // could resurface project-inferred agents; this path is not used from hot mobile RPCs
  // and the override file is the single source of truth for `scout up`-registered agents.
  if (options.includeDiscovered) {
    const configured = await ensureRelayAgentConfigured(agentId, {
      currentDirectory: options.currentDirectory,
      ensureCurrentProjectConfig: options.ensureCurrentProjectConfig,
      syncLegacyMirror: true,
    });
    if (!configured) {
      return null;
    }
    const onlineRecord = await ensureLocalAgentOnline(
      agentId,
      recordForHarness(localAgentRecordFromResolvedConfig(configured), options.harness),
    );
    return buildLocalAgentBinding(
      agentId,
      onlineRecord,
      isLocalAgentRecordOnline(agentId, onlineRecord),
      nodeId,
      configured.registrationKind === "configured" ? "relay-agent-registry" : "project-inferred",
    );
  }

  const overrides = await readRelayAgentOverrides();
  const override = overrides[agentId];
  if (!override) {
    return null;
  }

  const onlineRecord = await ensureLocalAgentOnline(
    agentId,
    recordForHarness(localAgentRecordFromRelayAgentOverride(agentId, override), options.harness),
  );

  return buildLocalAgentBinding(
    agentId,
    onlineRecord,
    isLocalAgentRecordOnline(agentId, onlineRecord),
    nodeId,
    "relay-agent-registry",
  );
}

type LocalAgentInvocationResult = {
  output: string;
};

export async function invokeLocalAgentEndpoint(
  endpoint: AgentEndpoint,
  invocation: InvocationRequest,
): Promise<LocalAgentInvocationResult> {
  const agentRuntimeId = endpoint.agentId;
  const definitionId = String(endpoint.metadata?.definitionId ?? endpoint.metadata?.agentName ?? endpoint.agentId);
  const prompt = endpointInvocationPrompt(endpoint, definitionId, invocation);
  const registry = await readLocalAgentRegistry();
  const existing = registry[agentRuntimeId];

  if (!existing && endpoint.transport === "codex_app_server") {
    await ensureLocalSessionEndpointOnline(endpoint);
    const invoke = isSessionBackedEndpoint(endpoint)
      ? sendCodexAppServerAgent
      : invokeCodexAppServerAgent;
    const result = await invoke({
      ...buildCodexEndpointSessionOptions(endpoint),
      prompt,
      timeoutMs: invocation.timeoutMs,
    });

    return {
      output: result.output,
    };
  }

  if (!existing && endpoint.transport === "claude_stream_json") {
    await ensureLocalSessionEndpointOnline(endpoint);
    const result = await invokeClaudeStreamJsonAgent({
      ...buildClaudeEndpointSessionOptions(endpoint),
      prompt,
      timeoutMs: invocation.timeoutMs,
    });

    return {
      output: result.output,
    };
  }

  const projectRoot = endpoint.projectRoot ?? endpoint.cwd;
  const requestedHarness = invocation.execution?.harness;

  const record = existing ?? (
    projectRoot
      ? {
        definitionId,
        project: basename(projectRoot),
        projectRoot,
        tmuxSession: String(endpoint.metadata?.tmuxSession ?? `relay-${agentRuntimeId}`),
        cwd: projectRoot,
        startedAt: nowSeconds(),
        harness: normalizeLocalAgentHarness(typeof endpoint.harness === "string" ? endpoint.harness : undefined),
        defaultHarness: normalizeLocalAgentHarness(typeof endpoint.harness === "string" ? endpoint.harness : undefined),
        harnessProfiles: {
          [normalizeManagedHarness(typeof endpoint.harness === "string" ? endpoint.harness : undefined, "claude")]: {
            cwd: projectRoot,
            sessionId: String(
              endpoint.sessionId
              ?? endpoint.metadata?.runtimeInstanceId
              ?? endpoint.metadata?.runtimeSessionId
              ?? `relay-${agentRuntimeId}`,
            ),
            transport: normalizeLocalAgentTransport(
              typeof endpoint.transport === "string" ? endpoint.transport : undefined,
              normalizeLocalAgentHarness(typeof endpoint.harness === "string" ? endpoint.harness : undefined),
            ),
            launchArgs: [],
          },
        },
        transport: normalizeLocalAgentTransport(
          typeof endpoint.transport === "string" ? endpoint.transport : undefined,
          normalizeLocalAgentHarness(typeof endpoint.harness === "string" ? endpoint.harness : undefined),
        ),
        capabilities: [...DEFAULT_LOCAL_AGENT_CAPABILITIES],
        launchArgs: [],
      }
      : null
  );

  if (!record) {
    throw new Error(`Agent ${agentRuntimeId} is not registered and has no project root.`);
  }

  const selectedRecord = recordForHarness(record, requestedHarness);
  const onlineRecord = await ensureLocalAgentOnline(agentRuntimeId, selectedRecord);
  if (onlineRecord.transport === "codex_app_server") {
    const result = await invokeCodexAppServerAgent({
      ...buildCodexAgentSessionOptions(
        agentRuntimeId,
        onlineRecord,
        renderLocalAgentSystemPromptTemplate(
          onlineRecord.systemPrompt || buildLocalAgentSystemPromptTemplate(),
          buildLocalAgentTemplateContext(definitionId, onlineRecord.project, onlineRecord.cwd),
          { transport: "codex_app_server" },
        ),
      ),
      prompt,
      timeoutMs: invocation.timeoutMs,
    });

    return {
      output: result.output,
    };
  }

  if (onlineRecord.transport === "claude_stream_json") {
    const result = await invokeClaudeStreamJsonAgent({
      ...buildClaudeAgentSessionOptions(
        agentRuntimeId,
        onlineRecord,
        renderLocalAgentSystemPromptTemplate(
          onlineRecord.systemPrompt || buildLocalAgentSystemPromptTemplate(),
          buildLocalAgentTemplateContext(definitionId, onlineRecord.project, onlineRecord.cwd),
          { transport: "claude_stream_json" },
        ),
      ),
      prompt,
      timeoutMs: invocation.timeoutMs,
    });

    return {
      output: result.output,
    };
  }

  const flightId = createLocalAgentFlightId();
  const askedAt = nowSeconds();
  const timeoutSeconds = invocation.timeoutMs ? Math.max(30, Math.floor(invocation.timeoutMs / 1000)) : 300;
  await sendLocalAgentPrompt(agentRuntimeId, onlineRecord, buildLocalAgentNudge(definitionId, invocation, flightId));

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() <= deadline) {
    const messages = await readBrokerMessagesSince(askedAt - 1);

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.actorId !== agentRuntimeId) continue;
      if (!message.body.includes(`[ask:${flightId}]`)) continue;

      return {
        output: stripLocalAgentReplyMetadata(message.body, flightId, invocation.requesterId),
      };
    }

    await sleep(500);
  }

  throw new Error(`Timed out after ${timeoutSeconds}s waiting for ${agentRuntimeId}.`);
}

export function shouldDisableGeneratedCodexEndpoint(endpoint: AgentEndpoint): boolean {
  if (endpoint.transport !== "codex_exec") {
    return false;
  }

  return endpoint.metadata?.source === "scout-app";
}
