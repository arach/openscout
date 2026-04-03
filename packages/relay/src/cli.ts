#!/usr/bin/env node

import {
  extractAgentSelectors,
  normalizeAgentSelectorSegment,
  resolveAgentSelector,
  type AgentHarness,
  type AgentSelector,
  type AgentSelectorCandidate,
  type AgentState,
  type ControlEvent,
  type MessageRecord,
} from "@openscout/protocol";
import {
  ensureRelayAgentConfigured,
  loadResolvedRelayAgents,
  resolveRelayAgentConfig,
  type ResolvedRelayAgentConfig,
} from "@openscout/runtime/setup";
import {
  ensureLocalAgentBindingOnline,
  inferLocalAgentBinding,
  sendTmuxPrompt,
  SUPPORTED_LOCAL_AGENT_HARNESSES,
} from "@openscout/runtime/local-agents";
import { formatRelayLogLine } from "./core/compat/channel-log.js";
import { hasTmuxSessionSync, killTmuxSessionSync } from "./core/compat/tmux-sessions.js";
import { readRelayMessages } from "./core/store/jsonl-store.js";

const VERSION = "0.2.1";
const BRAND = "\x1b[32m◆\x1b[0m";

const args = process.argv.slice(2);
const command = args[0];

function print(msg: string) {
  console.log(msg);
}

function printBrand() {
  print(`\n  ${BRAND} \x1b[1mOpenScout\x1b[0m v${VERSION}\n`);
}

function help() {
  printBrand();
  print("  \x1b[2mAgent-forward development platform for builders\x1b[0m\n");
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout <command> [options]\n");
  print("  \x1b[1mCommands:\x1b[0m");
  print("    init              Scaffold a new agent workspace");
  print("    add <type>        Add an agent, tool, or workflow");
  print("    run               Run your agents");
  print("    list              List configured agents and tools");
  print("    relay             Broker-backed agent chat (relay --help)");
  print("    --help, -h        Show this help message");
  print("    --version, -v     Show version\n");
  print("  \x1b[1mExamples:\x1b[0m");
  print("    npx openscout init");
  print("    openscout add agent --name reviewer");
  print("    openscout run\n");
  print(`  \x1b[2mhttps://openscout.app\x1b[0m\n`);
}

async function init() {
  printBrand();

  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "my-project";

  print(`  Initializing OpenScout in \x1b[1m${projectName}\x1b[0m...\n`);

  // Create config directory
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const configDir = path.join(cwd, ".openscout");
  await fs.mkdir(configDir, { recursive: true });

  // Create config file
  const config = {
    name: projectName,
    version: "0.1.0",
    agents: [],
    tools: [],
    workflows: [],
    settings: {
      model: "auto",
      local: true,
      streaming: true,
    },
  };

  await fs.writeFile(
    path.join(configDir, "config.json"),
    JSON.stringify(config, null, 2) + "\n"
  );

  // Create agents directory
  await fs.mkdir(path.join(configDir, "agents"), { recursive: true });

  // Create tools directory
  await fs.mkdir(path.join(configDir, "tools"), { recursive: true });

  // Create example agent
  const exampleAgent = {
    name: "scout",
    description: "Default agent for general tasks",
    model: "auto",
    tools: [],
    instructions: "You are a helpful development agent.",
  };

  await fs.writeFile(
    path.join(configDir, "agents", "scout.json"),
    JSON.stringify(exampleAgent, null, 2) + "\n"
  );

  print("  \x1b[32m✓\x1b[0m Created .openscout/config.json");
  print("  \x1b[32m✓\x1b[0m Created .openscout/agents/scout.json");
  print("  \x1b[32m✓\x1b[0m Created .openscout/agents/");
  print("  \x1b[32m✓\x1b[0m Created .openscout/tools/\n");
  print("  \x1b[1mNext steps:\x1b[0m");
  print("    openscout add agent --name <name>");
  print("    openscout run\n");
}

async function add() {
  const type = args[1];

  if (!type) {
    print("\n  \x1b[31m✗\x1b[0m Missing type. Usage: openscout add <agent|tool>\n");
    process.exit(1);
  }

  const nameIdx = args.indexOf("--name");
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;

  if (!name) {
    print(`\n  \x1b[31m✗\x1b[0m Missing --name. Usage: openscout add ${type} --name <name>\n`);
    process.exit(1);
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const cwd = process.cwd();
  const configDir = path.join(cwd, ".openscout");

  // Check if initialized
  try {
    await fs.access(path.join(configDir, "config.json"));
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Not initialized. Run \x1b[1mopenscout init\x1b[0m first.\n");
    process.exit(1);
  }

  if (type === "agent") {
    const agent = {
      name,
      description: "",
      model: "auto",
      tools: [],
      instructions: `You are the ${name} agent.`,
    };

    await fs.writeFile(
      path.join(configDir, "agents", `${name}.json`),
      JSON.stringify(agent, null, 2) + "\n"
    );

    // Update config
    const configRaw = await fs.readFile(path.join(configDir, "config.json"), "utf-8");
    const config = JSON.parse(configRaw);
    config.agents.push(name);
    await fs.writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify(config, null, 2) + "\n"
    );

    print(`\n  \x1b[32m✓\x1b[0m Added agent \x1b[1m${name}\x1b[0m`);
    print(`  \x1b[2m→ .openscout/agents/${name}.json\x1b[0m\n`);
  } else if (type === "tool") {
    const tool = {
      name,
      description: "",
      command: "",
    };

    await fs.writeFile(
      path.join(configDir, "tools", `${name}.json`),
      JSON.stringify(tool, null, 2) + "\n"
    );

    const configRaw = await fs.readFile(path.join(configDir, "config.json"), "utf-8");
    const config = JSON.parse(configRaw);
    config.tools.push(name);
    await fs.writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify(config, null, 2) + "\n"
    );

    print(`\n  \x1b[32m✓\x1b[0m Added tool \x1b[1m${name}\x1b[0m`);
    print(`  \x1b[2m→ .openscout/tools/${name}.json\x1b[0m\n`);
  } else {
    print(`\n  \x1b[31m✗\x1b[0m Unknown type: ${type}. Use \x1b[1magent\x1b[0m or \x1b[1mtool\x1b[0m.\n`);
    process.exit(1);
  }
}

async function list() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const cwd = process.cwd();
  const configPath = path.join(cwd, ".openscout", "config.json");

  try {
    await fs.access(configPath);
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Not initialized. Run \x1b[1mopenscout init\x1b[0m first.\n");
    process.exit(1);
  }

  const configRaw = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(configRaw);

  printBrand();

  print("  \x1b[1mAgents:\x1b[0m");
  if (config.agents.length === 0) {
    print("    \x1b[2m(none — run openscout add agent --name <name>)\x1b[0m");
  } else {
    for (const a of config.agents) {
      print(`    ${BRAND} ${a}`);
    }
  }

  print("\n  \x1b[1mTools:\x1b[0m");
  if (config.tools.length === 0) {
    print("    \x1b[2m(none — run openscout add tool --name <name>)\x1b[0m");
  } else {
    for (const t of config.tools) {
      print(`    ▣ ${t}`);
    }
  }
  print("");
}

async function run() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const cwd = process.cwd();
  const configPath = path.join(cwd, ".openscout", "config.json");

  try {
    await fs.access(configPath);
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Not initialized. Run \x1b[1mopenscout init\x1b[0m first.\n");
    process.exit(1);
  }

  const configRaw = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(configRaw);

  printBrand();
  print("  Starting agents...\n");

  if (config.agents.length === 0) {
    print("  \x1b[33m!\x1b[0m No agents configured. Add one with:");
    print("    openscout add agent --name <name>\n");
    return;
  }

  for (const name of config.agents) {
    const agentPath = path.join(cwd, ".openscout", "agents", `${name}.json`);
    try {
      const raw = await fs.readFile(agentPath, "utf-8");
      const agent = JSON.parse(raw);
      print(`  \x1b[32m●\x1b[0m ${agent.name} \x1b[2m— ${agent.description || agent.instructions}\x1b[0m`);
    } catch {
      print(`  \x1b[33m○\x1b[0m ${name} \x1b[2m— config not found\x1b[0m`);
    }
  }

  print("\n  \x1b[2mAgent runtime coming soon.\x1b[0m\n");
}

// ── Relay ──────────────────────────────────────────────

function getAgentName(): string {
  const asIdx = args.indexOf("--as");
  if (asIdx !== -1 && args[asIdx + 1]) return args[asIdx + 1];
  if (process.env.OPENSCOUT_AGENT) return process.env.OPENSCOUT_AGENT;
  return OPERATOR_ID;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatLine(line: string): string {
  const parts = line.split(" ");
  if (parts.length < 3) return line;
  const [ts, from, type, ...rest] = parts;
  const time = formatTimestamp(Number(ts));
  const body = rest.join(" ");
  if (type === "SYS") {
    return `  \x1b[2m${time} ∙ ${body}\x1b[0m`;
  }
  if (type === "ACK") {
    return `  \x1b[2m${time} ${from} ✓ ack ${body}\x1b[0m`;
  }
  return `  \x1b[2m${time}\x1b[0m \x1b[1m${from}\x1b[0m  ${body}`;
}

// ── Relay Path Resolution ─────────────────────────────
// Global hub: ~/.openscout/relay/
// Local link: .openscout/relay.json → { "hub": "~/.openscout/relay" }
// Resolution order:
//   1. Local .openscout/relay.json (if it has a "hub" pointer)
//   2. Global ~/.openscout/relay/
//   3. Fail with init instructions

interface RelayPaths {
  hub: string;        // the global relay directory
  logPath: string;    // hub + channel.log (human-readable mirror)
  channelPath: string; // hub + channel.jsonl (source of truth)
  configPath: string;  // hub + config.json
}

interface ChannelMessage {
  id: string;
  ts: number;
  from: string;
  type: "MSG" | "SYS";
  body: string;
  tags?: string[];     // e.g. ["speak"], ["ask:f-abc123"]
  to?: string[];       // @mentioned agents
  channel?: string;    // e.g. "voice"
}

interface BrokerActorRecord {
  id: string;
  kind?: string;
  displayName?: string;
  handle?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
}

interface BrokerAgentRecord extends BrokerActorRecord {
  homeNodeId?: string;
  authorityNodeId?: string;
}

interface BrokerEndpointRecord {
  id: string;
  agentId: string;
  nodeId?: string;
  harness?: string;
  transport?: string;
  state?: AgentState;
  address?: string;
  sessionId?: string;
  cwd?: string;
  projectRoot?: string;
  metadata?: Record<string, unknown>;
}

interface BrokerConversationRecord {
  id: string;
  kind: string;
  title: string;
  visibility: string;
  shareMode?: string;
  authorityNodeId: string;
  participantIds: string[];
  metadata?: Record<string, unknown>;
}

type BrokerMessageRecord = MessageRecord;

interface BrokerSnapshot {
  actors: Record<string, BrokerActorRecord>;
  agents: Record<string, BrokerAgentRecord>;
  endpoints: Record<string, BrokerEndpointRecord>;
  conversations: Record<string, BrokerConversationRecord>;
  messages: Record<string, BrokerMessageRecord>;
}

interface BrokerNodeRecord {
  id: string;
  brokerUrl?: string;
}

interface BrokerRelayContext {
  baseUrl: string;
  node: BrokerNodeRecord;
  snapshot: BrokerSnapshot;
}

interface BrokerMentionTarget {
  agentId: string;
  label: string;
  selector: AgentSelector;
}

const BROKER_SHARED_CHANNEL_ID = "channel.shared";
const BROKER_VOICE_CHANNEL_ID = "channel.voice";
const BROKER_SYSTEM_CHANNEL_ID = "channel.system";
const OPERATOR_ID = "operator";

function generateMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function titleCaseName(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function resolveBrokerUrl(): string {
  return process.env.OPENSCOUT_BROKER_URL ?? "http://127.0.0.1:65535";
}

function sanitizeConversationSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "shared";
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeUnixTimestamp(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function maxDefined(values: Array<number | null | undefined>): number | null {
  let maxValue: number | null = null;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    maxValue = maxValue === null ? value : Math.max(maxValue, value);
  }
  return maxValue;
}

type RelayWhoRegistrationKind = "broker" | "configured" | "discovered";

type RelayWhoEntry = {
  agentId: string;
  state: AgentState | "discovered";
  messages: number;
  lastSeen: number | null;
  registrationKind: RelayWhoRegistrationKind;
};

type RelayWhoLegacyStats = {
  lastSeen: number;
  messages: number;
  forgotten: boolean;
};

function relayWhoStateRank(state: AgentState | "discovered"): number {
  switch (state) {
    case "active":
      return 5;
    case "waiting":
      return 4;
    case "degraded":
      return 3;
    case "idle":
      return 2;
    case "offline":
      return 1;
    case "discovered":
    default:
      return 0;
  }
}

function relayWhoStatus(state: AgentState | "discovered"): string {
  switch (state) {
    case "active":
      return "\x1b[32m●\x1b[0m";
    case "waiting":
      return "\x1b[33m●\x1b[0m";
    case "degraded":
      return "\x1b[33m●\x1b[0m";
    case "idle":
      return "\x1b[36m●\x1b[0m";
    case "offline":
      return "\x1b[2m○\x1b[0m";
    case "discovered":
    default:
      return "\x1b[2m◇\x1b[0m";
  }
}

function relayWhoStateLabel(state: AgentState | "discovered"): string {
  return state === "discovered" ? "discovered" : state;
}

function relayWhoEndpointActivity(endpoint: BrokerEndpointRecord): number | null {
  return maxDefined([
    normalizeUnixTimestamp(endpoint.metadata?.lastCompletedAt),
    normalizeUnixTimestamp(endpoint.metadata?.lastStartedAt),
    normalizeUnixTimestamp(endpoint.metadata?.lastFailedAt),
    normalizeUnixTimestamp(endpoint.metadata?.startedAt),
  ]);
}

function relayWhoEntryState(
  endpoints: BrokerEndpointRecord[],
  registrationKind: RelayWhoRegistrationKind,
): AgentState | "discovered" {
  if (endpoints.length === 0) {
    return registrationKind === "discovered" ? "discovered" : "offline";
  }

  return endpoints.reduce<AgentState>((bestState, endpoint) => {
    const nextState = endpoint.state ?? "offline";
    return relayWhoStateRank(nextState) > relayWhoStateRank(bestState) ? nextState : bestState;
  }, "offline");
}

async function resolveMentionTargets(
  snapshot: BrokerSnapshot,
  text: string,
): Promise<{ resolved: BrokerMentionTarget[]; unresolved: string[]; legacyTargets: string[] }> {
  const selectors = extractAgentSelectors(text);
  const resolved = new Map<string, BrokerMentionTarget>();
  const unresolved: string[] = [];
  const legacyTargets = new Set<string>();
  const candidateMap = new Map<string, AgentSelectorCandidate>();
  const endpointBackedAgentIds = unique(
    Object.values(snapshot.endpoints)
      .map((endpoint) => endpoint.agentId)
      .filter((agentId) => agentId && agentId !== OPERATOR_ID),
  );
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

  for (const selector of selectors) {
    if (selector.definitionId === "system") {
      continue;
    }

    const discovered = await resolveRelayAgentConfig(selector, {
      currentDirectory: process.cwd(),
    });
    if (discovered && !candidateMap.has(discovered.agentId)) {
      candidateMap.set(discovered.agentId, {
        agentId: discovered.agentId,
        definitionId: discovered.definitionId,
        nodeQualifier: discovered.instance.nodeQualifier,
        workspaceQualifier: discovered.instance.workspaceQualifier,
        aliases: [discovered.instance.selector, discovered.instance.defaultSelector],
      });
    }

    const candidates = Array.from(candidateMap.values());
    if (selector.definitionId === "all") {
      const targetAgentIds = endpointBackedAgentIds.length > 0
        ? endpointBackedAgentIds
        : candidates.map((candidate) => candidate.agentId);
      for (const agentId of targetAgentIds) {
        resolved.set(agentId, {
          agentId,
          label: selector.label,
          selector,
        });
        legacyTargets.add(agentId);
      }
      continue;
    }

    const match = resolveAgentSelector(selector, candidates);
    if (!match) {
      unresolved.push(selector.label);
      if (!selector.nodeQualifier && !selector.workspaceQualifier) {
        legacyTargets.add(selector.definitionId);
      }
      continue;
    }

    resolved.set(match.agentId, {
      agentId: match.agentId,
      label: selector.label,
      selector,
    });
    legacyTargets.add(match.agentId);
  }

  return {
    resolved: Array.from(resolved.values()).sort((lhs, rhs) => lhs.agentId.localeCompare(rhs.agentId)),
    unresolved: Array.from(new Set(unresolved)).sort(),
    legacyTargets: Array.from(legacyTargets)
      .map((value) => normalizeAgentSelectorSegment(value))
      .filter(Boolean)
      .sort(),
  };
}

async function resolveSingleBrokerTarget(
  snapshot: BrokerSnapshot,
  label: string,
): Promise<BrokerMentionTarget | null> {
  const normalized = label.trim();
  if (!normalized) {
    return null;
  }

  const resolution = await resolveMentionTargets(
    snapshot,
    normalized.startsWith("@") ? normalized : `@${normalized}`,
  );

  return resolution.resolved[0] ?? null;
}

function resolveConversationShareMode(
  snapshot: BrokerSnapshot,
  nodeId: string,
  participantIds: string[],
  fallback: "local" | "shared",
): "local" | "shared" {
  if (fallback === "shared") {
    return "shared";
  }

  const hasRemoteParticipant = participantIds.some((participantId) => {
    const participant = snapshot.agents[participantId];
    return Boolean(participant?.authorityNodeId && participant.authorityNodeId !== nodeId);
  });

  return hasRemoteParticipant ? "shared" : fallback;
}

function stripAgentSelectorLabels(text: string): string {
  return extractAgentSelectors(text).reduce((next, selector) => (
    next.replaceAll(selector.label, "").replace(/\s{2,}/g, " ").trim()
  ), text).trim();
}

async function brokerReadJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

async function brokerPostJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

async function loadBrokerRelayContext(): Promise<BrokerRelayContext | null> {
  const baseUrl = resolveBrokerUrl();

  try {
    const health = await brokerReadJson<{ ok?: boolean }>(baseUrl, "/health");
    if (!health.ok) {
      return null;
    }

    const [node, snapshot] = await Promise.all([
      brokerReadJson<BrokerNodeRecord>(baseUrl, "/v1/node"),
      brokerReadJson<BrokerSnapshot>(baseUrl, "/v1/snapshot"),
    ]);

    if (!node.id) {
      return null;
    }

    return {
      baseUrl,
      node,
      snapshot,
    };
  } catch {
    return null;
  }
}

function requestedHarnessFromArgs(): AgentHarness | undefined {
  const harnessIdx = args.indexOf("--harness");
  if (harnessIdx === -1) {
    return undefined;
  }

  const rawHarness = args[harnessIdx + 1]?.trim();
  if (!rawHarness) {
    print(`\n  \x1b[31m✗\x1b[0m Missing harness value. Use one of: ${SUPPORTED_LOCAL_AGENT_HARNESSES.join(", ")}\n`);
    process.exit(1);
  }

  if (SUPPORTED_LOCAL_AGENT_HARNESSES.includes(rawHarness as AgentHarness)) {
    return rawHarness as AgentHarness;
  }

  print(`\n  \x1b[31m✗\x1b[0m Unsupported harness \x1b[1m${rawHarness}\x1b[0m. Use one of: ${SUPPORTED_LOCAL_AGENT_HARNESSES.join(", ")}\n`);
  process.exit(1);
}

function relayConversationIdForChannel(channel?: string): string {
  const normalizedChannel = channel?.trim() || "shared";
  if (normalizedChannel === "voice") {
    return BROKER_VOICE_CHANNEL_ID;
  }
  if (normalizedChannel === "system") {
    return BROKER_SYSTEM_CHANNEL_ID;
  }
  if (normalizedChannel === "shared") {
    return BROKER_SHARED_CHANNEL_ID;
  }
  return `channel.${sanitizeConversationSegment(normalizedChannel)}`;
}

function relayViewTypeForMessage(message: BrokerMessageRecord): "MSG" | "SYS" {
  return message.class === "system" || message.class === "status" ? "SYS" : "MSG";
}

function formatBrokerMessageLine(message: BrokerMessageRecord): string {
  const ts = normalizeUnixTimestamp(message.createdAt) ?? Math.floor(Date.now() / 1000);
  return formatLine(`${ts} ${message.actorId} ${relayViewTypeForMessage(message)} ${message.body}`);
}

async function loadBrokerMessages(
  baseUrl: string,
  options: {
    conversationId?: string;
    since?: number;
    limit?: number;
  } = {},
): Promise<BrokerMessageRecord[]> {
  const search = new URLSearchParams();
  if (options.conversationId) {
    search.set("conversationId", options.conversationId);
  }
  if (typeof options.since === "number" && Number.isFinite(options.since) && options.since > 0) {
    search.set("since", String(options.since));
  }
  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
    search.set("limit", String(options.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return brokerReadJson<BrokerMessageRecord[]>(baseUrl, `/v1/messages${suffix}`);
}

async function requireBrokerRelayContext(): Promise<BrokerRelayContext> {
  const broker = await loadBrokerRelayContext();
  if (broker) {
    return broker;
  }

  print("\n  \x1b[31m✗\x1b[0m Broker is not reachable. Start it with \x1b[1mopenscout relay init\x1b[0m.\n");
  process.exit(1);
}

async function ensureBrokerActor(
  baseUrl: string,
  snapshot: BrokerSnapshot,
  actorId: string,
): Promise<void> {
  if (snapshot.actors[actorId] || snapshot.agents[actorId]) {
    return;
  }

  const actor: BrokerActorRecord = {
    id: actorId,
    kind: actorId === OPERATOR_ID ? "person" : "agent",
    displayName: titleCaseName(actorId),
    handle: actorId,
    labels: ["relay"],
    metadata: { source: "relay-cli" },
  };

  await brokerPostJson(baseUrl, "/v1/actors", actor);
  snapshot.actors[actorId] = actor;
}

async function syncBrokerBinding(
  baseUrl: string,
  snapshot: BrokerSnapshot,
  binding: Awaited<ReturnType<typeof inferLocalAgentBinding>>,
): Promise<void> {
  if (!binding) {
    return;
  }

  await brokerPostJson(baseUrl, "/v1/actors", binding.actor);
  await brokerPostJson(baseUrl, "/v1/agents", binding.agent);
  await brokerPostJson(baseUrl, "/v1/endpoints", binding.endpoint);
  snapshot.actors[binding.actor.id] = binding.actor;
  snapshot.agents[binding.agent.id] = binding.agent;
}

async function ensureSenderRelayAgent(
  baseUrl: string,
  snapshot: BrokerSnapshot,
  nodeId: string,
  senderId: string,
): Promise<void> {
  if (snapshot.agents[senderId]) {
    return;
  }

  const configured = await ensureRelayAgentConfigured(senderId, {
    currentDirectory: process.cwd(),
    ensureCurrentProjectConfig: true,
  });
  if (!configured) {
    return;
  }

  await syncBrokerBinding(baseUrl, snapshot, await inferLocalAgentBinding(configured.agentId, nodeId));
}

async function ensureTargetRelayAgent(
  baseUrl: string,
  snapshot: BrokerSnapshot,
  nodeId: string,
  agentId: string,
): Promise<boolean> {
  if (snapshot.agents[agentId]) {
    return true;
  }

  const binding = await ensureLocalAgentBindingOnline(agentId, nodeId, {
    includeDiscovered: true,
    currentDirectory: process.cwd(),
  });
  await syncBrokerBinding(baseUrl, snapshot, binding);
  return Boolean(binding);
}

function relayConversationDefinition(
  snapshot: BrokerSnapshot,
  nodeId: string,
  channel: string | undefined,
  senderId: string,
  targetParticipantIds: string[] = [],
): BrokerConversationRecord {
  const normalizedChannel = channel?.trim() || "shared";
  const sharedParticipants = unique([
    OPERATOR_ID,
    senderId,
    ...Object.keys(snapshot.agents),
  ]).sort();
  const scopedParticipants = unique([
    OPERATOR_ID,
    senderId,
    ...targetParticipantIds,
  ]).sort();

  if (normalizedChannel === "voice") {
    return {
      id: BROKER_VOICE_CHANNEL_ID,
      kind: "channel",
      title: "voice",
      visibility: "workspace",
      shareMode: resolveConversationShareMode(snapshot, nodeId, scopedParticipants, "local"),
      authorityNodeId: nodeId,
      participantIds: scopedParticipants,
      metadata: { surface: "relay-cli", channel: "voice" },
    };
  }

  if (normalizedChannel === "system") {
    return {
      id: BROKER_SYSTEM_CHANNEL_ID,
      kind: "system",
      title: "system",
      visibility: "system",
      shareMode: "local",
      authorityNodeId: nodeId,
      participantIds: unique([OPERATOR_ID, senderId]).sort(),
      metadata: { surface: "relay-cli", channel: "system" },
    };
  }

  if (normalizedChannel === "shared") {
    return {
      id: BROKER_SHARED_CHANNEL_ID,
      kind: "channel",
      title: "shared-channel",
      visibility: "workspace",
      shareMode: "shared",
      authorityNodeId: nodeId,
      participantIds: sharedParticipants,
      metadata: { surface: "relay-cli", channel: "shared" },
    };
  }

  return {
    id: `channel.${sanitizeConversationSegment(normalizedChannel)}`,
    kind: "channel",
    title: normalizedChannel,
    visibility: "workspace",
    shareMode: resolveConversationShareMode(snapshot, nodeId, scopedParticipants, "local"),
    authorityNodeId: nodeId,
    participantIds: scopedParticipants,
    metadata: { surface: "relay-cli", channel: normalizedChannel },
  };
}

async function ensureBrokerConversation(
  baseUrl: string,
  snapshot: BrokerSnapshot,
  nodeId: string,
  channel: string | undefined,
  senderId: string,
  targetParticipantIds: string[] = [],
): Promise<BrokerConversationRecord> {
  const definition = relayConversationDefinition(snapshot, nodeId, channel, senderId, targetParticipantIds);
  const existing = snapshot.conversations[definition.id];
  const nextParticipants = unique([
    ...(existing?.participantIds ?? []),
    ...definition.participantIds,
  ]).sort();

  if (
    !existing
    || existing.kind !== definition.kind
    || existing.visibility !== definition.visibility
    || existing.shareMode !== definition.shareMode
    || nextParticipants.length !== existing.participantIds.length
  ) {
    const nextConversation: BrokerConversationRecord = {
      ...definition,
      participantIds: nextParticipants,
    };
    await brokerPostJson(baseUrl, "/v1/conversations", nextConversation);
    snapshot.conversations[nextConversation.id] = nextConversation;
    return nextConversation;
  }

  return existing;
}

type BrokerRelayPostResult = {
  usedBroker: boolean;
  invokedTargets: string[];
  unresolvedTargets: string[];
};

type BrokerFlightRecord = {
  id: string;
  invocationId: string;
  requesterId: string;
  targetAgentId: string;
  state: string;
  summary?: string;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
};

type BrokerAskResult = {
  usedBroker: boolean;
  flight?: BrokerFlightRecord;
  conversationId?: string;
  messageId?: string;
  unresolvedTarget?: string;
};

async function postRelayMessageToBroker(input: {
  senderId: string;
  body: string;
  messageId: string;
  channel?: string;
  shouldSpeak?: boolean;
  mentionTargets: BrokerMentionTarget[];
  createdAtMs: number;
  executionHarness?: AgentHarness;
}): Promise<BrokerRelayPostResult> {
  const broker = await loadBrokerRelayContext();
  if (!broker) {
    return {
      usedBroker: false,
      invokedTargets: [],
      unresolvedTargets: input.mentionTargets.map((target) => target.label),
    };
  }

  await ensureSenderRelayAgent(broker.baseUrl, broker.snapshot, broker.node.id, input.senderId);
  await ensureBrokerActor(broker.baseUrl, broker.snapshot, input.senderId);
  const availableTargets = (
    await Promise.all(
      input.mentionTargets.map(async (target) => (
        await ensureTargetRelayAgent(broker.baseUrl, broker.snapshot, broker.node.id, target.agentId)
          ? target
          : null
      )),
    )
  ).filter((target): target is BrokerMentionTarget => Boolean(target));
  const conversation = await ensureBrokerConversation(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.channel,
    input.senderId,
    availableTargets.map((target) => target.agentId),
  );

  const validTargets = unique(
    availableTargets
      .map((target) => target.agentId)
      .filter((target) => target !== input.senderId && Boolean(broker.snapshot.agents[target])),
  ).sort();
  const unresolvedTargets = input.mentionTargets
    .filter((target) => !validTargets.includes(target.agentId))
    .map((target) => target.label);
  const speechText = input.shouldSpeak
    ? stripAgentSelectorLabels(input.body)
    : "";

  await brokerPostJson(broker.baseUrl, "/v1/messages", {
    id: input.messageId,
    conversationId: conversation.id,
    actorId: input.senderId,
    originNodeId: broker.node.id,
    class: conversation.kind === "system" ? "system" : "agent",
    body: input.body,
    mentions: input.mentionTargets
      .filter((target) => validTargets.includes(target.agentId))
      .map((target) => ({ actorId: target.agentId, label: target.label })),
    speech: speechText ? { text: speechText } : undefined,
    audience: validTargets.length > 0
      ? {
          notify: validTargets,
          reason: "mention",
        }
      : undefined,
    visibility: conversation.visibility,
    policy: "durable",
    createdAt: input.createdAtMs,
    metadata: {
      source: "relay-cli",
      relayChannel: input.channel ?? "shared",
      relayMessageId: input.messageId,
    },
  });

  for (const targetAgentId of validTargets) {
    await brokerPostJson(broker.baseUrl, "/v1/invocations", {
      id: `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      requesterId: input.senderId,
      requesterNodeId: broker.node.id,
      targetAgentId,
      action: "consult",
      task: input.body,
      conversationId: conversation.id,
      messageId: input.messageId,
      execution: input.executionHarness
        ? {
            harness: input.executionHarness,
          }
        : undefined,
      ensureAwake: true,
      stream: false,
      createdAt: Date.now(),
      metadata: {
        source: "relay-cli",
        relayChannel: input.channel ?? "shared",
      },
    });
  }

  return {
    usedBroker: true,
    invokedTargets: validTargets,
    unresolvedTargets,
  };
}

async function postRelayAskToBroker(input: {
  senderId: string;
  targetLabel: string;
  body: string;
  channel?: string;
  shouldSpeak?: boolean;
  createdAtMs: number;
  executionHarness?: AgentHarness;
}): Promise<BrokerAskResult> {
  const broker = await loadBrokerRelayContext();
  if (!broker) {
    return {
      usedBroker: false,
      unresolvedTarget: input.targetLabel,
    };
  }

  await ensureBrokerActor(broker.baseUrl, broker.snapshot, input.senderId);
  if (input.senderId !== OPERATOR_ID) {
    await ensureSenderRelayAgent(broker.baseUrl, broker.snapshot, broker.node.id, input.senderId);
  }

  const target = await resolveSingleBrokerTarget(broker.snapshot, input.targetLabel);
  if (!target) {
    return {
      usedBroker: true,
      unresolvedTarget: input.targetLabel,
    };
  }

  const targetReady = await ensureTargetRelayAgent(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    target.agentId,
  );
  if (!targetReady) {
    return {
      usedBroker: true,
      unresolvedTarget: input.targetLabel,
    };
  }

  const conversation = await ensureBrokerConversation(
    broker.baseUrl,
    broker.snapshot,
    broker.node.id,
    input.channel,
    input.senderId,
    [target.agentId],
  );
  const messageId = generateMessageId();
  const messageBody = input.body.trim().startsWith(target.label)
    ? input.body.trim()
    : `${target.label} ${input.body.trim()}`;
  const speechText = input.shouldSpeak ? stripAgentSelectorLabels(messageBody) : "";

  await brokerPostJson(broker.baseUrl, "/v1/messages", {
    id: messageId,
    conversationId: conversation.id,
    actorId: input.senderId,
    originNodeId: broker.node.id,
    class: conversation.kind === "system" ? "system" : "agent",
    body: messageBody,
    mentions: [{ actorId: target.agentId, label: target.label }],
    speech: speechText ? { text: speechText } : undefined,
    audience: {
      notify: [target.agentId],
      reason: "mention",
    },
    visibility: conversation.visibility,
    policy: "durable",
    createdAt: input.createdAtMs,
    metadata: {
      source: "relay-cli",
      relayChannel: input.channel ?? "shared",
      relayTarget: target.agentId,
    },
  });

  const invocationId = `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const invocationResponse = await brokerPostJson<{
    ok: boolean;
    flight: BrokerFlightRecord;
  }>(broker.baseUrl, "/v1/invocations", {
    id: invocationId,
    requesterId: input.senderId,
    requesterNodeId: broker.node.id,
    targetAgentId: target.agentId,
    action: "consult",
    task: messageBody,
    conversationId: conversation.id,
    messageId,
    execution: input.executionHarness
      ? {
          harness: input.executionHarness,
        }
      : undefined,
    ensureAwake: true,
    stream: false,
    createdAt: Date.now(),
    metadata: {
      source: "relay-cli",
      relayChannel: input.channel ?? "shared",
      relayTarget: target.agentId,
    },
  });

  return {
    usedBroker: true,
    flight: invocationResponse.flight,
    conversationId: conversation.id,
    messageId,
  };
}

async function loadBrokerFlight(baseUrl: string, flightId: string): Promise<BrokerFlightRecord | null> {
  const snapshot = await brokerReadJson<{
    flights?: Record<string, BrokerFlightRecord>;
  }>(baseUrl, "/v1/snapshot");
  return snapshot.flights?.[flightId] ?? null;
}

async function waitForBrokerFlight(
  baseUrl: string,
  flightId: string,
  options: { timeoutSeconds?: number } = {},
): Promise<BrokerFlightRecord> {
  const deadline = typeof options.timeoutSeconds === "number" && options.timeoutSeconds > 0
    ? Date.now() + options.timeoutSeconds * 1000
    : null;
  let lastState = "";
  let lastSummary = "";

  while (true) {
    const flight = await loadBrokerFlight(baseUrl, flightId);
    if (!flight) {
      throw new Error(`Flight ${flightId} is no longer available.`);
    }

    if (flight.state !== lastState || (flight.summary ?? "") !== lastSummary) {
      const detail = [flight.state, flight.summary].filter(Boolean).join(" — ");
      if (detail) {
        process.stderr.write(`${detail}\n`);
      }
      lastState = flight.state;
      lastSummary = flight.summary ?? "";
    }

    if (flight.state === "completed") {
      return flight;
    }

    if (flight.state === "failed" || flight.state === "cancelled") {
      throw new Error(flight.error || flight.summary || `Flight ${flight.id} failed.`);
    }

    if (deadline !== null && Date.now() > deadline) {
      throw new Error(`Timed out waiting for flight ${flight.id}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function writeChannel(hub: string, msg: Omit<ChannelMessage, "id">): Promise<ChannelMessage> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const entry: ChannelMessage = { id: generateMessageId(), ...msg };

  // Source of truth: JSONL
  await fs.appendFile(path.join(hub, "channel.jsonl"), JSON.stringify(entry) + "\n");

  // Human-readable mirror
  await fs.appendFile(path.join(hub, "channel.log"), formatRelayLogLine(entry));

  return entry;
}


async function readChannel(hub: string, opts?: { since?: number; last?: number; id?: string }): Promise<ChannelMessage[]> {
  const messages = await readRelayMessages(hub, opts);
  return messages.map((message) => ({
    id: message.id,
    ts: message.ts,
    from: message.from,
    type: message.type,
    body: message.body,
    tags: message.tags,
    to: message.to,
    channel: message.channel,
  }));
}

async function getGlobalRelayDir(): Promise<string> {
  const path = await import("node:path");
  const os = await import("node:os");
  return path.join(os.homedir(), ".openscout", "relay");
}

async function resolveRelayPaths(): Promise<RelayPaths | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // 1. Check for local link file
  const localLink = path.join(process.cwd(), ".openscout", "relay.json");
  try {
    const raw = await fs.readFile(localLink, "utf-8");
    const config = JSON.parse(raw);
    if (config.hub) {
      const hub = config.hub.replace(/^~/, (await import("node:os")).homedir());
      return {
        hub,
        logPath: path.join(hub, "channel.log"),
        channelPath: path.join(hub, "channel.jsonl"),
        configPath: path.join(hub, "config.json"),
      };
    }
  } catch {
    // No local link — fall through
  }

  // 2. Check global relay
  const hub = await getGlobalRelayDir();
  const logPath = path.join(hub, "channel.log");
  const channelPath = path.join(hub, "channel.jsonl");
  try {
    // Check for either log format — JSONL is source of truth, log is legacy
    try { await fs.access(channelPath); } catch { await fs.access(logPath); }
    return { hub, logPath, channelPath, configPath: path.join(hub, "config.json") };
  } catch {
    return null;
  }
}

async function requireRelay(): Promise<RelayPaths> {
  const paths = await resolveRelayPaths();
  if (!paths) {
    print("\n  \x1b[31m✗\x1b[0m Relay not initialized. Run \x1b[1mopenscout relay init\x1b[0m first.\n");
    process.exit(1);
  }
  return paths;
}

// ── Relay Config ──────────────────────────────────────

interface ChannelConfig {
  audio: boolean;        // whether responses on this channel get spoken
  voice?: string;        // TTS voice override (default: "nova")
}

interface RelayConfig {
  agents: string[];
  created: number;
  projectRoot?: string;  // e.g. "~/dev" — where bare project names are resolved
  channels?: Record<string, ChannelConfig>;  // channel-level settings (e.g. "voice": { audio: true })
  defaultVoice?: string; // default TTS voice (default: "nova")
  roster?: string[];     // project names to auto-start as local agents (e.g. ["dev", "lattices", "arc"])
  pronunciations?: Record<string, string>;  // e.g. { "arach": "ah-rahsh", "openscout": "open scout" }
  openaiApiKey?: string;  // fallback if OPENAI_API_KEY env var not set
}

async function loadRelayConfig(): Promise<RelayConfig> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const configPath = path.join(hub, "config.json");
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { agents: [], created: Date.now() };
  }
}

async function saveRelayConfig(config: RelayConfig): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const configPath = path.join(hub, "config.json");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

async function resolveProjectPath(target: string): Promise<string> {
  const path = await import("node:path");
  const os = await import("node:os");

  // Absolute or home-relative paths pass through
  if (target.startsWith("/")) return target;
  if (target.startsWith("~")) return target.replace("~", os.homedir());

  // Bare name → look up projectRoot from config, fallback to ~/dev
  const config = await loadRelayConfig();
  const root = config.projectRoot
    ? config.projectRoot.replace(/^~/, os.homedir())
    : path.join(os.homedir(), "dev");

  return path.join(root, target);
}

async function relayInit() {
  const path = await import("node:path");
  const broker = await loadBrokerRelayContext();
  const setup = await loadResolvedRelayAgents({
    currentDirectory: process.cwd(),
    ensureCurrentProjectConfig: true,
  });
  const projectName = path.basename(process.cwd());

  printBrand();
  if (broker) {
    print(`  \x1b[32m✓\x1b[0m Broker: \x1b[1m${broker.baseUrl}\x1b[0m`);
  } else {
    print(`  \x1b[33m○\x1b[0m Broker: \x1b[1m${resolveBrokerUrl()}\x1b[0m`);
    print("  \x1b[2mBroker is not reachable yet.\x1b[0m");
  }
  if (setup.currentProjectConfigPath) {
    print(`  \x1b[32m✓\x1b[0m Project config: \x1b[1m${setup.currentProjectConfigPath}\x1b[0m`);
  }
  print(`  \x1b[32m✓\x1b[0m Workspace ready: \x1b[1m${projectName}\x1b[0m\n`);
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout relay send --as agent-a \"hello\"");
  print("    openscout relay read --channel shared");
  print("    openscout relay watch --channel shared\n");
}

interface AgentRegistryEntry {
  pane: string;
  cwd: string;
  project: string;
  session_id?: string;
  registered_at?: number;
}

async function loadRegistry(): Promise<Record<string, AgentRegistryEntry>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const registryPath = path.join(hub, "agents.json");
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ── Channel-based audio ───────────────────────────────
// Audio is a property of the channel, not the user or the message.
// The voice channel has audio: true. Responses to messages from that channel get spoken.

function isAudioChannel(config: RelayConfig, channel?: string): boolean {
  if (!channel) return false;
  const ch = config.channels?.[channel];
  return ch?.audio === true;
}

function getVoiceForChannel(config: RelayConfig, channel?: string): string {
  const ch = channel ? config.channels?.[channel] : undefined;
  return ch?.voice || config.defaultVoice || "nova";
}

function applyPronunciations(text: string, pronunciations?: Record<string, string>): string {
  if (!pronunciations) return text;
  let result = text;
  for (const [word, phonetic] of Object.entries(pronunciations)) {
    result = result.replace(new RegExp(`\\b${word}\\b`, "gi"), phonetic);
  }
  return result;
}

// ── On-air semaphore (prevents overlapping TTS) ──────

async function acquireOnAir(agent: string, timeoutMs = 30000): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const lockPath = path.join(hub, "on-air.lock");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(lockPath, "utf-8");
      const lock = JSON.parse(raw);
      // Stale lock (>30s) — take over
      if (Date.now() - lock.ts > 30000) break;
      // Someone else is on air — wait
      await new Promise(r => setTimeout(r, 2000));
    } catch {
      // No lock file — free to proceed
      break;
    }
  }
  await fs.writeFile(lockPath, JSON.stringify({ agent, ts: Date.now() }) + "\n");
}

async function releaseOnAir(): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const lockPath = path.join(hub, "on-air.lock");
  try { await fs.unlink(lockPath); } catch { /* already gone */ }
}

async function speak(text: string, voice: string): Promise<void> {
  const config = await loadRelayConfig();

  // Find API key: env var → relay config
  const apiKey = process.env.OPENAI_API_KEY || config.openaiApiKey || null;
  if (!apiKey) return;
  const clean = applyPronunciations(text.trim(), config.pronunciations);
  if (!clean) return;

  try {
    const { spawn } = await import("node:child_process");
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", voice, input: clean, response_format: "pcm", speed: 1.1 }),
    });
    if (!res.ok || !res.body) return;

    const player = spawn("ffplay", [
      "-nodisp", "-autoexit", "-loglevel", "quiet",
      "-f", "s16le", "-ar", "24000", "-ch_layout", "mono", "-",
    ], { stdio: ["pipe", "ignore", "ignore"] });

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      player.stdin.write(value);
    }
    player.stdin.end();
    await new Promise<void>(resolve => player.on("close", resolve));
  } catch { /* noop */ }
}

async function deliverToAgent(name: string, from: string, message: string, channel?: string, messageId?: string): Promise<"delivered" | "nudged" | "queued"> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();

  // Notification only — channel.jsonl is the source of truth (already written by relaySend)
  const agentsPath = path.join(hub, "agents.json");
  try {
    const agentsRaw = await fs.readFile(agentsPath, "utf-8");
    const agents = JSON.parse(agentsRaw);
    const agent = agents[name];
    if (agent?.session_id) {
      const replyCmd = channel === "voice" ? "speak" : "send";
      const idRef = messageId ? ` (message: ${messageId})` : "";
      const nudge = `You have a new relay message from ${from}${idRef}. Check the channel and respond.\n\nRead recent: openscout relay read -n 5 --as ${name}\nReply via: openscout relay ${replyCmd} --as ${name} "@${from} <your response>"`;
      const { spawn } = await import("node:child_process");
      const child = spawn("claude", ["--resume", agent.session_id, "--print", nudge], {
        cwd: agent.cwd || process.cwd(),
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      return "delivered";
    }
  } catch { /* no session — fall through */ }

  return "queued";
}

// ── Flights (tracked requests with callbacks) ─────────

interface Flight {
  id: string;
  from: string;
  to: string;
  message: string;
  sentAt: number;
  status: "pending" | "completed";
  response?: string;
  respondedAt?: number;
}

async function getFlightsPath(): Promise<string> {
  const os = await import("node:os");
  const path = await import("node:path");
  return path.join(os.homedir(), ".openscout", "relay", "flights.json");
}

async function loadFlights(): Promise<Flight[]> {
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(await getFlightsPath(), "utf8"));
  } catch {
    return [];
  }
}

async function saveFlights(flights: Flight[]): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.writeFile(await getFlightsPath(), JSON.stringify(flights, null, 2) + "\n");
}

async function createFlight(from: string, to: string, message: string): Promise<Flight> {
  const flights = await loadFlights();
  const flight: Flight = {
    id: `f-${Date.now().toString(36)}`,
    from,
    to,
    message,
    sentAt: Math.floor(Date.now() / 1000),
    status: "pending",
  };
  flights.push(flight);
  if (flights.length > 50) flights.splice(0, flights.length - 50);
  await saveFlights(flights);
  return flight;
}

// ── @system agent ─────────────────────────────────────

async function handleSystemCommand(from: string, message: string): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { execSync } = await import("node:child_process");

  // Strip the @system prefix and parse the command
  const stripped = message.replace(/@system\s*/i, "").trim();
  const parts = stripped.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  if (!cmd) {
    return "usage: @system up <name> | down <name> | down --all | ps | config root <path>";
  }

  const hub = await getGlobalRelayDir();

  if (cmd === "ps") {
    const localAgents = await loadLocalAgents();
    const names = Object.keys(localAgents);
    if (names.length === 0) return "no local agents running";

    const now = Math.floor(Date.now() / 1000);
    const lines: string[] = [];
    for (const name of names) {
      const localAgent = localAgents[name];
      const alive = await isTmuxSessionAlive(localAgent.tmuxSession);
      const uptime = now - localAgent.startedAt;
      const uptimeStr = uptime < 60 ? `${uptime}s`
        : uptime < 3600 ? `${Math.floor(uptime / 60)}m`
        : `${Math.floor(uptime / 3600)}h`;
      const icon = alive ? "●" : "✗";
      lines.push(`${icon} ${name} (${localAgent.project}, ${uptimeStr})`);
    }
    return lines.join(" | ");
  }

  if (cmd === "roster") {
    const sub = parts[1];
    const config = await loadRelayConfig();

    if (sub === "add" && parts[2]) {
      const name = parts[2];
      config.roster = config.roster || [];
      if (!config.roster.includes(name)) {
        config.roster.push(name);
        await saveRelayConfig(config);
      }
      return `added ${name} to roster (${config.roster.length} total)`;
    }

    if (sub === "remove" && parts[2]) {
      const name = parts[2];
      config.roster = (config.roster || []).filter((n) => n !== name);
      await saveRelayConfig(config);
      return `removed ${name} from roster`;
    }

    // Show roster
    const roster = config.roster || [];
    if (roster.length === 0) return "roster is empty — add with: @system roster add <name>";
    const localAgents = await loadLocalAgents();
    const status = await Promise.all(roster.map(async (name) => {
      const localAgent = localAgents[name];
      const alive = localAgent && await isTmuxSessionAlive(localAgent.tmuxSession);
      return `${alive ? "●" : "○"} ${name}`;
    }));
    return status.join("  ");
  }

  if (cmd === "up") {
    const target = parts[1];

    // No args = bring up the whole roster
    if (!target) {
      const config = await loadRelayConfig();
      const roster = config.roster || [];
      if (roster.length === 0) return "no roster configured — add with: @system roster add <name>";

      const results: string[] = [];
      for (const name of roster) {
        const tmuxSession = `relay-${tmuxSafe(name)}`;
        if (await isTmuxSessionAlive(tmuxSession)) {
          results.push(`${name} (already up)`);
          continue;
        }
        // Spawn using same logic as single up
        let projectPath: string;
        try {
          projectPath = await resolveProjectPath(name);
          const stat = await fs.stat(projectPath);
          if (!stat.isDirectory()) { results.push(`${name} (not found)`); continue; }
        } catch { results.push(`${name} (not found)`); continue; }

        const projectName = path.basename(projectPath);
        const agentName = name;
        const hubShort = hub.replace(os.homedir(), "~");
        const systemPrompt = [
          `You are "${agentName}", a relay agent for the ${projectName} project.`,
          `You have full access to the codebase at ${projectPath}.`,
          `Use the relay commands below for agent communication. They prefer the broker and fall back to the local relay queue when needed.`,
          `Respond to @${agentName} mentions, answer questions about this project, coordinate with other agents.`,
          `Always reply via: openscout relay send --as ${agentName} "your message"`,
          `Read context via: openscout relay read --as ${agentName}`,
          `To speak aloud to the human: openscout relay speak --as ${agentName} "your answer"`,
          `Only use relay speak for final meaningful responses to humans, not acks or status updates.`,
          `Do not use file-backed relay state directly.`,
          `Be specific with file paths. Keep messages under 200 chars.`,
        ].join("\n");

        const agentDirectory = path.join(hub, "agents");
        await fs.mkdir(agentDirectory, { recursive: true });
        const promptFile = path.join(agentDirectory, `${agentName}.prompt.txt`);
        await fs.writeFile(promptFile, systemPrompt);
        const initialMsg = `You are now online as a relay agent for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${agentName} "relay agent online — ready to assist with ${projectName}"`;
        const initialFile = path.join(agentDirectory, `${agentName}.initial.txt`);
        await fs.writeFile(initialFile, initialMsg);
        const launchScript = path.join(agentDirectory, `${agentName}.launch.sh`);
        await fs.writeFile(launchScript, [
          `#!/bin/bash`,
          `cd ${JSON.stringify(projectPath)}`,
          `(sleep 5 && BUFFER_NAME="openscout-init-${agentName}-$$" && tmux load-buffer -b "$BUFFER_NAME" ${JSON.stringify(initialFile)} && tmux paste-buffer -d -b "$BUFFER_NAME" -t ${tmuxSession} && tmux send-keys -t ${tmuxSession} Enter) &`,
          `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${agentName}-relay-agent"`,
        ].join("\n") + "\n");
        await fs.chmod(launchScript, 0o755);
        execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

        const currentLocalAgents = await loadLocalAgents();
        currentLocalAgents[agentName] = { project: projectName, tmuxSession, cwd: projectPath, startedAt: Math.floor(Date.now() / 1000) };
        await saveLocalAgents(currentLocalAgents);

        await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agentName, type: "SYS", body: `agent spawned for ${projectName}` });
        results.push(`${name} (up)`);
      }
      return results.join(", ");
    }

    // Resolve: bare name → <projectRoot>/<name>, or use as path
    let projectPath = await resolveProjectPath(target);

    // Verify it exists
    try {
      const stat = await fs.stat(projectPath);
      if (!stat.isDirectory()) return `not a directory: ${target}`;
    } catch {
      return `not found: ${projectPath}`;
    }

    const projectName = path.basename(projectPath);
    const agentName = parts[2] || projectName; // optional alias as 3rd arg
    const tmuxSession = `relay-${tmuxSafe(agentName)}`;

    // Check if already running
    if (await isTmuxSessionAlive(tmuxSession)) {
      return `${agentName} is already running`;
    }

    // Build system prompt
    const hubShort = hub.replace(os.homedir(), "~");
    const systemPrompt = [
      `You are "${agentName}", a relay agent — a headless agent that handles relay communication for the ${projectName} project.`,
      `You have full access to the codebase at ${projectPath}.`,
      `Use the relay commands below for agent communication. They prefer the broker and fall back to the local relay queue when needed.`,
      `Your job: respond to @${agentName} mentions, answer questions about this project's code, coordinate with other agents.`,
      `Relay commands:`,
      `  openscout relay send --as ${agentName} "your message"`,
      `  openscout relay speak --as ${agentName} "your message"  (speaks aloud to the human via TTS)`,
      `  openscout relay read --as ${agentName}`,
      `  openscout relay who`,
      `Audio: the human may be in a voice conversation. Use 'relay speak' when you have a substantive`,
      `answer or result for the human. Do NOT speak acks, status updates, or agent-to-agent chatter.`,
      `Only speak the final, meaningful response directed at a human.`,
      `Rules: always reply via relay send, do not use file-backed relay state directly, be specific with file paths, keep messages under 200 chars.`,
    ].join("\n");

    // Write files
    const agentDirectory = path.join(hub, "agents");
    await fs.mkdir(agentDirectory, { recursive: true });
    const promptFile = path.join(agentDirectory, `${agentName}.prompt.txt`);
    await fs.writeFile(promptFile, systemPrompt);

    const initialMsg = `You are now online as a relay agent for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${agentName} "relay agent online — ready to assist with ${projectName}"`;
    const initialFile = path.join(agentDirectory, `${agentName}.initial.txt`);
    await fs.writeFile(initialFile, initialMsg);

    const launchScript = path.join(agentDirectory, `${agentName}.launch.sh`);
    await fs.writeFile(launchScript, [
      `#!/bin/bash`,
      `cd ${JSON.stringify(projectPath)}`,
      `(sleep 5 && BUFFER_NAME="openscout-init-${agentName}-$$" && tmux load-buffer -b "$BUFFER_NAME" ${JSON.stringify(initialFile)} && tmux paste-buffer -d -b "$BUFFER_NAME" -t ${tmuxSession} && tmux send-keys -t ${tmuxSession} Enter) &`,
      `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${agentName}-relay-agent"`,
    ].join("\n") + "\n");
    await fs.chmod(launchScript, 0o755);

    // Spawn
    execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

    // Save registry
    const localAgents = await loadLocalAgents();
    localAgents[agentName] = {
      project: projectName,
      tmuxSession,
      cwd: projectPath,
      startedAt: Math.floor(Date.now() / 1000),
    };
    await saveLocalAgents(localAgents);

    await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agentName, type: "SYS", body: `agent spawned for ${projectName}` });

    return `✓ spawned ${agentName} (tmux: ${tmuxSession})`;
  }

  if (cmd === "down") {
    const target = parts[1];
    if (!target) return "usage: @system down <name> | @system down --all";

    const localAgents = await loadLocalAgents();

    if (target === "--all") {
      const names = Object.keys(localAgents);
      if (names.length === 0) return "no local agents to stop";
      const results: string[] = [];
      for (const name of names) {
        if (killTmuxSessionSync(localAgents[name].tmuxSession)) {
          results.push(`✓ ${name}`);
        } else {
          results.push(`○ ${name} (already stopped)`);
        }
      }
      await saveLocalAgents({});
      await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: "system", type: "SYS", body: "all local agents stopped" });
      return results.join(", ");
    }

    const localAgent = localAgents[target];
    if (!localAgent) {
      const names = Object.keys(localAgents);
      return names.length > 0
        ? `no local agent named ${target}. running: ${names.join(", ")}`
        : `no local agent named ${target}`;
    }

    killTmuxSessionSync(localAgent.tmuxSession);
    delete localAgents[target];
    await saveLocalAgents(localAgents);

    await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: target, type: "SYS", body: "agent stopped" });
    return `✓ stopped ${target}`;
  }

  if (cmd === "config") {
    const key = parts[1];
    const value = parts[2];

    if (key === "root" && value) {
      const config = await loadRelayConfig();
      config.projectRoot = value;
      await saveRelayConfig(config);
      return `set project root to ${value}`;
    }

    // Channel audio config: @system config audio <channel> on/off
    if (key === "audio" && value) {
      const config = await loadRelayConfig();
      config.channels = config.channels || {};
      const onOff = parts[3];
      if (onOff === "off") {
        if (config.channels[value]) config.channels[value].audio = false;
        await saveRelayConfig(config);
        return `audio disabled on channel "${value}"`;
      }
      config.channels[value] = { ...config.channels[value], audio: true };
      await saveRelayConfig(config);
      return `audio enabled on channel "${value}"`;
    }

    if (key === "voice" && value) {
      const config = await loadRelayConfig();
      const channel = parts[3]; // optional: @system config voice nova voice-tab
      if (channel) {
        config.channels = config.channels || {};
        config.channels[channel] = { ...config.channels[channel], audio: config.channels[channel]?.audio ?? true, voice: value };
        await saveRelayConfig(config);
        return `voice "${value}" set on channel "${channel}"`;
      }
      config.defaultVoice = value;
      await saveRelayConfig(config);
      return `default voice set to ${value}`;
    }

    // Show current config
    const config = await loadRelayConfig();
    const root = config.projectRoot || "~/dev (default)";
    const voice = config.defaultVoice || "nova (default)";
    const channels = config.channels || {};
    const chList = Object.entries(channels)
      .map(([name, ch]) => `${name}: audio=${ch.audio ? "on" : "off"}${ch.voice ? ` voice=${ch.voice}` : ""}`)
      .join(", ") || "none configured";
    return `root: ${root} | voice: ${voice} | channels: ${chList}`;
  }

  return `unknown command: ${cmd}. try: up, down, ps, config`;
}

async function relaySend() {
  // Collect message: everything after "send" that isn't a flag
  const sendIdx = args.indexOf("send");
  const msgParts: string[] = [];
  let channel: string | undefined;
  let shouldSpeak = false;
  const requestedHarness = requestedHarnessFromArgs();
  let i = sendIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") {
      i += 2; // skip --as and its value
      continue;
    }
    if (args[i] === "--channel") {
      channel = args[i + 1];
      i += 2; // skip --channel and its value
      continue;
    }
    if (args[i] === "--speak") {
      shouldSpeak = true;
      i++;
      continue;
    }
    if (args[i] === "--harness") {
      i += 2;
      continue;
    }
    msgParts.push(args[i]);
    i++;
  }

  const message = msgParts.join(" ").trim();
  if (!message) {
    print("\n  \x1b[31m✗\x1b[0m No message provided. Usage: openscout relay send \"your message\"\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const createdAtMs = Date.now();
  const ts = Math.floor(createdAtMs / 1000);
  const broker = await requireBrokerRelayContext();
  if (broker && msgParts.length > 1 && !msgParts[0]?.startsWith("@")) {
    const positionalTarget = await resolveSingleBrokerTarget(broker.snapshot, msgParts[0] ?? "");
    if (positionalTarget) {
      print(`\n  \x1b[31m✗\x1b[0m Positional relay targets are deprecated.\n`);
      print(`  Use \x1b[1mopenscout relay ask --to ${positionalTarget.agentId}${agent !== OPERATOR_ID ? ` --as ${agent}` : ""} ${JSON.stringify(msgParts.slice(1).join(" ").trim())}\x1b[0m\n`);
      process.exit(1);
    }
  }
  const mentionResolution = broker
    ? await resolveMentionTargets(broker.snapshot, message)
    : { resolved: [] as BrokerMentionTarget[], unresolved: [] as string[], legacyTargets: [] as string[] };
  const brokerMessageId = generateMessageId();

  print(formatLine(`${ts} ${agent} MSG ${shouldSpeak ? "[speak] " : ""}${message}`));

  // Notify @mentioned agents
  const brokerResult = await postRelayMessageToBroker({
    senderId: agent,
    body: message,
    messageId: brokerMessageId,
    channel,
    shouldSpeak,
    mentionTargets: mentionResolution.resolved,
    createdAtMs,
    executionHarness: requestedHarness,
  });
  if (!brokerResult.usedBroker) {
    print("\n  \x1b[31m✗\x1b[0m Broker is not reachable.\n");
    process.exit(1);
  }
  for (const target of brokerResult.invokedTargets) {
    const harnessLabel = requestedHarness ? ` (${requestedHarness})` : "";
    print(`  \x1b[32m✓\x1b[0m Routed to ${target}${harnessLabel} via broker invocation`);
  }

  for (const label of brokerResult.unresolvedTargets) {
    print(`  \x1b[2m○\x1b[0m ${label} is not currently routable\x1b[0m`);
  }
}

async function relaySpeak() {
  // Collect message — same flag parsing as send
  const speakIdx = args.indexOf("speak");
  const msgParts: string[] = [];
  const requestedHarness = requestedHarnessFromArgs();
  let i = speakIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") {
      i += 2;
      continue;
    }
    if (args[i] === "--harness") {
      i += 2;
      continue;
    }
    msgParts.push(args[i]);
    i++;
  }

  const message = msgParts.join(" ").trim();
  if (!message) {
    print("\n  \x1b[31m✗\x1b[0m No message provided. Usage: openscout relay speak --as dev \"your message\"\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const createdAtMs = Date.now();
  const ts = Math.floor(createdAtMs / 1000);
  const broker = await requireBrokerRelayContext();
  const mentionResolution = broker
    ? await resolveMentionTargets(broker.snapshot, message)
    : { resolved: [] as BrokerMentionTarget[], unresolved: [] as string[], legacyTargets: [] as string[] };
  print(formatLine(`${ts} ${agent} MSG [speak] ${message}`));

  // Acquire on-air lock, speak, then release
  await acquireOnAir(agent);
  await setAgentState(agent, "speaking");

  const config = await loadRelayConfig();
  const voice = getVoiceForChannel(config, "voice");
  const clean = stripAgentSelectorLabels(message);
  if (clean) {
    await speak(clean, voice);
  }

  await setAgentState(agent, "idle");
  await releaseOnAir();

  const brokerResult = await postRelayMessageToBroker({
    senderId: agent,
    body: message,
    messageId: generateMessageId(),
    channel: "voice",
    shouldSpeak: true,
    mentionTargets: mentionResolution.resolved,
    createdAtMs,
    executionHarness: requestedHarness,
  });
  if (!brokerResult.usedBroker) {
    print("\n  \x1b[31m✗\x1b[0m Broker is not reachable.\n");
    process.exit(1);
  }
  for (const target of brokerResult.invokedTargets) {
    const harnessLabel = requestedHarness ? ` (${requestedHarness})` : "";
    print(`  \x1b[32m✓\x1b[0m Routed to ${target}${harnessLabel} via broker invocation`);
  }

  for (const label of brokerResult.unresolvedTargets) {
    print(`  \x1b[2m○\x1b[0m ${label} is not currently routable\x1b[0m`);
  }
}

// ── relay ask ─────────────────────────────────────────

async function relayAsk() {
  const toIdx = args.indexOf("--to");
  const targetLabel = toIdx !== -1 ? args[toIdx + 1] : null;
  if (!targetLabel) {
    process.stderr.write("error: --to <name> is required\n");
    process.exit(1);
  }

  const requestedHarness = requestedHarnessFromArgs();
  const timeoutIdx = args.indexOf("--timeout");
  const timeoutRaw = timeoutIdx !== -1 ? args[timeoutIdx + 1] : undefined;
  const parsedTimeout = timeoutRaw ? parseInt(timeoutRaw, 10) : undefined;
  const skipFlags = new Set(["--to", "--as", "--timeout", "--channel", "--harness"]);
  const msgParts: string[] = [];
  let channel: string | undefined;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--channel") {
      channel = args[i + 1];
      i += 1;
      continue;
    }
    if (skipFlags.has(args[i])) {
      i += 1;
      continue;
    }
    msgParts.push(args[i]);
  }
  const question = msgParts.join(" ").trim();
  if (!question) {
    process.stderr.write("error: no question provided\n");
    process.exit(1);
  }

  const asker = getAgentName();
  const broker = await requireBrokerRelayContext();
  const result = await postRelayAskToBroker({
    senderId: asker,
    targetLabel,
    body: question,
    channel,
    createdAtMs: Date.now(),
    executionHarness: requestedHarness,
  });

  if (!result.usedBroker) {
    process.stderr.write("error: broker is not reachable\n");
    process.exit(1);
  }
  if (!result.flight) {
    process.stderr.write(`error: target ${targetLabel} is not currently routable\n`);
    process.exit(1);
  }

  process.stderr.write(`asking ${result.flight.targetAgentId}... (flight ${result.flight.id})\n`);
  const completed = await waitForBrokerFlight(
    broker.baseUrl,
    result.flight.id,
    { timeoutSeconds: Number.isFinite(parsedTimeout) ? parsedTimeout : undefined },
  );
  process.stdout.write(`${completed.output ?? completed.summary ?? ""}\n`);
}

// ── Agent state ───────────────────────────────────────
// Agents set their own state: speaking, thinking, idle, etc.
// State is stored in state.json — the TUI reads it for visual feedback.

async function loadAgentStates(): Promise<Record<string, string>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  try {
    const raw = await fs.readFile(path.join(hub, "state.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveAgentStates(states: Record<string, string>): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  await fs.writeFile(path.join(hub, "state.json"), JSON.stringify(states, null, 2) + "\n");
}

async function setAgentState(agent: string, state: string): Promise<void> {
  const states = await loadAgentStates();
  if (state === "idle" || state === "clear") {
    delete states[agent];
  } else {
    states[agent] = state;
  }
  await saveAgentStates(states);
}

async function relayState() {
  // Collect the state value — skip --as <name> flags
  const stateIdx = args.indexOf("state");
  let state: string | undefined;
  let i = stateIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") { i += 2; continue; }
    state = args[i];
    break;
  }

  if (!state) {
    // Show all states
    const states = await loadAgentStates();
    const entries = Object.entries(states);
    if (entries.length === 0) {
      print("  \x1b[2mAll agents idle\x1b[0m");
    } else {
      for (const [agent, s] of entries) {
        print(`  \x1b[1m${agent}\x1b[0m  ${s}`);
      }
    }
    return;
  }

  const agent = getAgentName();
  await setAgentState(agent, state);
  if (state === "idle" || state === "clear") {
    print(`  \x1b[2m${agent} → idle\x1b[0m`);
  } else {
    print(`  \x1b[1m${agent}\x1b[0m → ${state}`);
  }
}

async function relayRead() {
  const broker = await requireBrokerRelayContext();

  // --since <timestamp> filter
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx !== -1 ? Number(args[sinceIdx + 1]) : 0;

  // -n <count> or default 20
  const nIdx = args.indexOf("-n");
  const count = nIdx !== -1 ? Number(args[nIdx + 1]) : 20;
  const channelIdx = args.indexOf("--channel");
  const channel = channelIdx !== -1 ? args[channelIdx + 1] : undefined;
  const conversationId = relayConversationIdForChannel(channel);

  const messages = await loadBrokerMessages(broker.baseUrl, {
    conversationId,
    since: since > 0 ? since : undefined,
    limit: count,
  });

  if (messages.length === 0) {
    print("\n  \x1b[2mNo messages.\x1b[0m\n");
    return;
  }

  print("");
  for (const msg of messages) {
    print(formatBrokerMessageLine(msg));
  }
  print("");
}

async function relayWatch() {
  const broker = await requireBrokerRelayContext();
  const agent = getAgentName();
  const channelIdx = args.indexOf("--channel");
  const channel = channelIdx !== -1 ? args[channelIdx + 1] : undefined;
  const conversationId = relayConversationIdForChannel(channel);
  const channelLabel = channel?.trim() || "shared";

  if (args.includes("--tmux")) {
    print("\n  \x1b[31m✗\x1b[0m relay watch no longer supports tmux pane nudges.\n");
    process.exit(1);
  }

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on("SIGINT", onSigint);

  printBrand();
  print(`  Watching \x1b[1m${channelLabel}\x1b[0m as \x1b[1m${agent}\x1b[0m`);
  print("  \x1b[2mPress Ctrl+C to stop\x1b[0m\n");

  try {
    const response = await fetch(new URL("/v1/events/stream", broker.baseUrl), {
      headers: {
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`/v1/events/stream returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleBlock = (block: string) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return;
      }

      let eventName = "";
      const dataLines: string[] = [];
      for (const line of trimmed.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }

      if (eventName !== "message.posted" || dataLines.length === 0) {
        return;
      }

      let event: ControlEvent;
      try {
        event = JSON.parse(dataLines.join("\n")) as ControlEvent;
      } catch {
        return;
      }

      const message = (event as Extract<ControlEvent, { kind: "message.posted" }>).payload?.message as BrokerMessageRecord | undefined;
      if (!message || message.conversationId !== conversationId || message.actorId === agent) {
        return;
      }

      print(formatBrokerMessageLine(message));
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const delimiterIndex = buffer.indexOf("\n\n");
        if (delimiterIndex === -1) {
          break;
        }
        const block = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);
        handleBlock(block);
      }
    }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    if (!isAbort) {
      throw error;
    }
  } finally {
    process.off("SIGINT", onSigint);
    print("\n  \x1b[2mStopped watching.\x1b[0m\n");
  }
}

async function relayWho() {
  const broker = await requireBrokerRelayContext();
  await relayWhoFromBroker(broker);
}

async function loadRelayWhoLegacyStats(): Promise<Map<string, RelayWhoLegacyStats>> {
  const fs = await import("node:fs/promises");
  const { channelPath } = await requireRelay();

  let content = "";
  try {
    content = await fs.readFile(channelPath, "utf-8");
  } catch {
    return new Map();
  }
  const lines = content.trim().split("\n").filter(Boolean);

  const agents = new Map<string, RelayWhoLegacyStats>();

  for (const line of lines) {
    let entry: { ts?: number; from?: string; type?: string; body?: string };
    try { entry = JSON.parse(line); } catch { continue; }
    const { ts, from, type, body } = entry;
    if (!from || !ts) continue;

    if (!agents.has(from)) {
      agents.set(from, { lastSeen: ts, messages: 0, forgotten: false });
    }
    const agent = agents.get(from)!;
    agent.lastSeen = Math.max(agent.lastSeen, ts);

    if (type === "MSG") agent.messages++;
    if (type === "SYS" && body?.includes("forgotten")) agent.forgotten = true;
  }

  return agents;
}

async function relayWhoLegacy() {
  const visible = [...(await loadRelayWhoLegacyStats()).entries()].filter(([_, info]) => !info.forgotten);

  const now = Math.floor(Date.now() / 1000);
  const ONLINE_THRESHOLD = 600; // 10 minutes

  if (visible.length === 0) {
    print("\n  \x1b[2mNo agents have used the relay yet.\x1b[0m\n");
    return;
  }

  printBrand();
  print("  \x1b[1mAgents\x1b[0m\n");

  for (const [name, info] of visible) {
    const isOnline = (now - info.lastSeen) < ONLINE_THRESHOLD;
    const status = isOnline ? "\x1b[32m●\x1b[0m" : "\x1b[2m○\x1b[0m";
    const time = formatTimestamp(info.lastSeen);
    const msgs = info.messages === 1 ? "1 message" : `${info.messages} messages`;
    print(`  ${status} \x1b[1m${name}\x1b[0m  \x1b[2m${msgs} · last seen ${time}\x1b[0m`);
  }
  print("");
}

async function loadRelayWhoDiscoveryMap(): Promise<Map<string, ResolvedRelayAgentConfig>> {
  try {
    const setup = await loadResolvedRelayAgents({
      currentDirectory: process.cwd(),
    });
    return new Map(setup.discoveredAgents.map((agent) => [agent.agentId, agent]));
  } catch {
    return new Map();
  }
}

async function relayWhoFromBroker(broker: BrokerRelayContext) {
  const discoveredAgents = await loadRelayWhoDiscoveryMap();
  const endpointsByAgent = new Map<string, BrokerEndpointRecord[]>();
  const messageStats = new Map<string, { messages: number; lastSeen: number | null }>();

  for (const endpoint of Object.values(broker.snapshot.endpoints ?? {})) {
    if (!endpoint.agentId || endpoint.agentId === OPERATOR_ID) {
      continue;
    }
    const existing = endpointsByAgent.get(endpoint.agentId) ?? [];
    existing.push(endpoint);
    endpointsByAgent.set(endpoint.agentId, existing);
  }

  for (const message of Object.values(broker.snapshot.messages ?? {})) {
    if (!message.actorId || message.actorId === OPERATOR_ID) {
      continue;
    }
    const current = messageStats.get(message.actorId) ?? { messages: 0, lastSeen: null };
    current.messages += 1;
    current.lastSeen = maxDefined([
      current.lastSeen,
      normalizeUnixTimestamp(message.createdAt),
    ]);
    messageStats.set(message.actorId, current);
  }

  const agentIds = unique([
    ...Object.keys(broker.snapshot.agents ?? {}),
    ...Array.from(endpointsByAgent.keys()),
    ...Array.from(messageStats.keys()),
    ...Array.from(discoveredAgents.keys()),
  ])
    .filter((agentId) => agentId && agentId !== OPERATOR_ID)
    .sort();

  const entries = agentIds.map((agentId): RelayWhoEntry => {
    const endpoints = endpointsByAgent.get(agentId) ?? [];
    const brokerMessages = messageStats.get(agentId);
    const registrationKind = discoveredAgents.get(agentId)?.registrationKind ?? "broker";
    const state = relayWhoEntryState(endpoints, registrationKind);
    const lastSeen = maxDefined([
      brokerMessages?.lastSeen,
      ...endpoints.map((endpoint) => relayWhoEndpointActivity(endpoint)),
    ]);
    const messages = brokerMessages?.messages ?? 0;

    return {
      agentId,
      state,
      messages,
      lastSeen,
      registrationKind,
    };
  }).sort((lhs, rhs) => {
    const stateDelta = relayWhoStateRank(rhs.state) - relayWhoStateRank(lhs.state);
    if (stateDelta !== 0) {
      return stateDelta;
    }

    const lastSeenDelta = (rhs.lastSeen ?? -1) - (lhs.lastSeen ?? -1);
    if (lastSeenDelta !== 0) {
      return lastSeenDelta;
    }

    return lhs.agentId.localeCompare(rhs.agentId);
  });

  if (entries.length === 0) {
    print("\n  \x1b[2mNo relay agents are known to the broker yet.\x1b[0m\n");
    return;
  }

  printBrand();
  print("  \x1b[1mAgents\x1b[0m\n");

  for (const entry of entries) {
    const msgs = entry.messages === 1 ? "1 message" : `${entry.messages} messages`;
    const lastSeenText = entry.lastSeen ? `last seen ${formatTimestamp(entry.lastSeen)}` : "not seen yet";
    const registrationText = entry.registrationKind === "discovered" ? "auto-discovered" : null;
    const details = [
      relayWhoStateLabel(entry.state),
      msgs,
      lastSeenText,
      registrationText,
    ].filter(Boolean).join(" · ");
    print(`  ${relayWhoStatus(entry.state)} \x1b[1m${entry.agentId}\x1b[0m  \x1b[2m${details}\x1b[0m`);
  }

  print("");
}

async function relayForget() {
  const fs = await import("node:fs/promises");
  const { hub } = await requireRelay();

  // Get agent name to forget from args after "forget"
  const forgetIdx = args.indexOf("forget");
  const targetName = forgetIdx !== -1 ? args[forgetIdx + 1] : undefined;

  if (!targetName) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay forget <agent-name>\n");
    process.exit(1);
  }

  const agent = getAgentName();
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: targetName, type: "SYS", body: `${targetName} forgotten by ${agent}` });

  print(`\n  \x1b[32m✓\x1b[0m Removed \x1b[1m${targetName}\x1b[0m from the relay.\n`);
}

async function relayEnroll() {
  const fs = await import("node:fs/promises");
  const { hub, logPath } = await requireRelay();

  const agent = getAgentName();

  // Check for --task flag
  const taskIdx = args.indexOf("--task");
  const task = taskIdx !== -1 ? args.slice(taskIdx + 1).filter((a) => !a.startsWith("--")).join(" ") : "";

  const prompt = [
    `You are ${agent}.`,
    "",
    `There is a global relay channel at ${logPath} that other agents are watching.`,
    "Use it to coordinate with other agents working on related packages.",
    "",
    "Relay commands:",
    `  openscout relay send --as ${agent} "your message"   — send a message`,
    `  openscout relay read                                — check recent messages`,
    `  openscout relay who                                 — see who's active`,
    "",
    "Rules:",
    "  - Check the relay before starting work for context from other agents",
    "  - Send a message when you complete something other agents need to know about",
    "  - Be specific: include file paths, version numbers, what changed",
    "  - Keep messages under 200 chars",
    task ? `\nYour task: ${task}` : "",
  ].filter((l) => l !== undefined).join("\n");

  // Try to copy to clipboard
  let copied = false;
  try {
    const { execSync } = await import("node:child_process");
    execSync("pbcopy", { input: prompt });
    copied = true;
  } catch {
    // No pbcopy available
  }

  printBrand();
  print(`  Enrollment prompt for \x1b[1m${agent}\x1b[0m${copied ? " \x1b[32m(copied to clipboard)\x1b[0m" : ""}:\n`);
  print("  ┌──────────────────────────────────────────────────────────────");
  for (const line of prompt.split("\n")) {
    print(`  │ ${line}`);
  }
  print("  └──────────────────────────────────────────────────────────────\n");

  if (copied) {
    print("  \x1b[32m✓\x1b[0m Paste this into a Claude Code session to enroll the agent.");
  } else {
    print("  Copy the prompt above and paste it into a Claude Code session.");
  }

  // Write a SYS event
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agent, type: "SYS", body: `${agent} enrolled via relay enroll` });

  print(`  \x1b[32m✓\x1b[0m Recorded enrollment event in the broker-backed relay history\n`);
}

async function relayBroadcast() {
  // Collect message
  const bcIdx = args.indexOf("broadcast");
  const msgParts: string[] = [];
  const requestedHarness = requestedHarnessFromArgs();
  let i = bcIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") { i += 2; continue; }
    if (args[i] === "--harness") { i += 2; continue; }
    msgParts.push(args[i]);
    i++;
  }

  const message = msgParts.join(" ").trim();
  if (!message) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay broadcast \"your message\"\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const broker = await requireBrokerRelayContext();
  const createdAtMs = Date.now();
  const ts = Math.floor(createdAtMs / 1000);
  const body = `@all ${message}`;
  const mentionResolution = await resolveMentionTargets(broker.snapshot, body);
  const brokerResult = await postRelayMessageToBroker({
    senderId: agent,
    body,
    messageId: generateMessageId(),
    mentionTargets: mentionResolution.resolved,
    createdAtMs,
    executionHarness: requestedHarness,
  });
  if (!brokerResult.usedBroker) {
    print("\n  \x1b[31m✗\x1b[0m Broker is not reachable.\n");
    process.exit(1);
  }

  print(formatLine(`${ts} ${agent} MSG 📢 ${message}`));
  if (brokerResult.invokedTargets.length > 0) {
    const harnessLabel = requestedHarness ? ` (${requestedHarness})` : "";
    print(`  \x1b[32m✓\x1b[0m Routed to ${brokerResult.invokedTargets.length} agents${harnessLabel}`);
  }
  for (const label of brokerResult.unresolvedTargets) {
    print(`  \x1b[2m○\x1b[0m ${label} is not currently routable\x1b[0m`);
  }
  print("");
}

async function relayLink() {
  const path = await import("node:path");
  const setup = await loadResolvedRelayAgents({
    currentDirectory: process.cwd(),
    ensureCurrentProjectConfig: true,
  });
  const projectName = path.basename(process.cwd());

  printBrand();
  if (setup.currentProjectConfigPath) {
    print(`  \x1b[32m✓\x1b[0m Project config: \x1b[1m${setup.currentProjectConfigPath}\x1b[0m`);
  }
  print(`  \x1b[32m✓\x1b[0m Workspace ready: \x1b[1m${projectName}\x1b[0m\n`);
  print("  Run \x1b[1mopenscout relay read --channel shared\x1b[0m to inspect broker-backed messages.\n");
}

// ── Local Agents ─────────────────────────────────────────────

interface LocalAgentEntry {
  project: string;
  tmuxSession: string;
  cwd: string;
  startedAt: number;
  systemPrompt?: string;
}

async function loadLocalAgents(): Promise<Record<string, LocalAgentEntry>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const agentsPath = path.join(hub, "agents.json");
  try {
    const raw = await fs.readFile(agentsPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveLocalAgents(localAgents: Record<string, LocalAgentEntry>): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const agentsPath = path.join(hub, "agents.json");
  await fs.writeFile(agentsPath, JSON.stringify(localAgents, null, 2) + "\n");
}

function tmuxSafe(name: string): string {
  // tmux treats dots as window.pane separators — replace with underscores
  return name.replace(/\./g, "_");
}

async function isTmuxSessionAlive(sessionName: string): Promise<boolean> {
  return hasTmuxSessionSync(sessionName);
}

async function relayUp() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { execSync } = await import("node:child_process");
  await requireRelay();

  // Parse: relay up <path-or-name> [--name <alias>] [--task <task>]
  const upIdx = args.indexOf("up");
  const targetArg = args[upIdx + 1];

  if (!targetArg || targetArg.startsWith("--")) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay up <project-path> [--name <alias>] [--task <description>]\n");
    print("  \x1b[1mExamples:\x1b[0m");
    print("    openscout relay up ~/dev/lattices");
    print("    openscout relay up ~/dev/arc --name arc");
    print("    openscout relay up . --task \"monitor tests\"\n");
    process.exit(1);
  }

  // Resolve project path (bare names use projectRoot from config)
  let projectPath = targetArg === "." ? process.cwd() : await resolveProjectPath(targetArg);

  // Verify directory exists
  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    print(`\n  \x1b[31m✗\x1b[0m Not a directory: ${targetArg}\n`);
    process.exit(1);
  }

  const projectName = path.basename(projectPath);

  // Parse optional name
  const nameIdx = args.indexOf("--name");
  const agentName = nameIdx !== -1 ? args[nameIdx + 1] : projectName;

  // Parse optional task
  const taskIdx = args.indexOf("--task");
  const task = taskIdx !== -1 ? args.slice(taskIdx + 1).filter((a) => !a.startsWith("--")).join(" ") : "";

  const tmuxSession = `relay-${tmuxSafe(agentName)}`;

  // Check if already running
  if (await isTmuxSessionAlive(tmuxSession)) {
    print(`\n  \x1b[33m!\x1b[0m Local agent \x1b[1m${agentName}\x1b[0m is already running (tmux: ${tmuxSession})`);
    print(`  \x1b[2mUse: openscout relay down ${agentName}\x1b[0m\n`);
    process.exit(1);
  }

  // Build the enrollment system prompt
  const hub = await getGlobalRelayDir();
  const hubShort = hub.replace(os.homedir(), "~");
  const systemPrompt = [
    `You are "${agentName}", a relay agent — a headless agent that handles relay communication for the ${projectName} project.`,
    ``,
    `You have full access to the codebase at ${projectPath}.`,
    `Use the relay commands below for agent communication. They prefer the broker and fall back to the local relay queue when needed.`,
    ``,
    `Your job:`,
    `  - Respond to @${agentName} mentions from other agents`,
    `  - Answer questions about this project's code, architecture, and status`,
    `  - Coordinate with other agents when they need info from this project`,
    `  - Run commands, check code, and provide accurate answers`,
    ``,
    `Relay commands:`,
    `  openscout relay send --as ${agentName} "your message"   — send a message`,
    `  openscout relay read --as ${agentName}                  — check recent messages`,
    `  openscout relay who                                    — see who's active`,
    ``,
    `Rules:`,
    `  - Always reply via relay send so other agents see your response`,
    `  - Do not use file-backed relay state directly`,
    `  - Be specific: include file paths, line numbers, what you found`,
    `  - Keep messages under 200 chars unless detailed info was requested`,
    `  - Check relay read for context before responding`,
    task ? `\nYour primary task: ${task}` : "",
  ].filter(Boolean).join("\n");

  // Create the tmux session with claude
  printBrand();
  print(`  Spawning local agent \x1b[1m${agentName}\x1b[0m...\n`);

  // Write system prompt + launcher to files (avoids shell quoting hell)
  const agentDirectory = path.join(hub, "agents");
  await fs.mkdir(agentDirectory, { recursive: true });
  const promptFile = path.join(agentDirectory, `${agentName}.prompt.txt`);
  await fs.writeFile(promptFile, systemPrompt);

  const initialMsg = task
    ? `You are now online as a relay agent. Your task: ${task}. Announce yourself on the relay and start working.`
    : `You are now online as a relay agent for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${agentName} "relay agent online — ready to assist with ${projectName}"`;

  const initialFile = path.join(agentDirectory, `${agentName}.initial.txt`);
  await fs.writeFile(initialFile, initialMsg);

  // Launcher: starts Claude interactively, then sends initial message after startup
  const launchScript = path.join(agentDirectory, `${agentName}.launch.sh`);
  await fs.writeFile(launchScript, [
    `#!/bin/bash`,
    `cd ${JSON.stringify(projectPath)}`,
    `# Send initial message after Claude starts (background)`,
    `(sleep 5 && BUFFER_NAME="openscout-init-${agentName}-$$" && tmux load-buffer -b "$BUFFER_NAME" ${JSON.stringify(initialFile)} && tmux paste-buffer -d -b "$BUFFER_NAME" -t ${tmuxSession} && tmux send-keys -t ${tmuxSession} Enter) &`,
    `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${agentName}-relay-agent"`,
  ].join("\n") + "\n");
  await fs.chmod(launchScript, 0o755);

  // Create detached tmux session running the launcher
  execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

  // Save to localAgents registry
  const localAgents = await loadLocalAgents();
  localAgents[agentName] = {
    project: projectName,
    tmuxSession,
    cwd: projectPath,
    startedAt: Math.floor(Date.now() / 1000),
    systemPrompt: task || undefined,
  };
  await saveLocalAgents(localAgents);

  // Log to channel
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agentName, type: "SYS", body: `agent spawned for ${projectName}` });

  print(`  \x1b[32m✓\x1b[0m Local agent \x1b[1m${agentName}\x1b[0m is alive`);
  print(`  \x1b[2m  tmux: ${tmuxSession}\x1b[0m`);
  print(`  \x1b[2m  cwd:  ${projectPath}\x1b[0m`);
  if (task) print(`  \x1b[2m  task: ${task}\x1b[0m`);
  print("");
  print("  \x1b[1mUseful commands:\x1b[0m");
  print(`    tmux attach -t ${tmuxSession}        \x1b[2m# peek at the local agent\x1b[0m`);
  print(`    openscout relay send "@${agentName} hey"  \x1b[2m# talk to it\x1b[0m`);
  print(`    openscout relay ps                    \x1b[2m# check all local agents\x1b[0m`);
  print(`    openscout relay down ${agentName}          \x1b[2m# stop it\x1b[0m\n`);
}

async function relayDown() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { execSync } = await import("node:child_process");
  await requireRelay();

  const downIdx = args.indexOf("down");
  const targetName = downIdx !== -1 ? args[downIdx + 1] : undefined;

  if (!targetName) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay down <agent-name>\n");
    process.exit(1);
  }

  // Check --all flag
  if (targetName === "--all") {
    const localAgents = await loadLocalAgents();
    const names = Object.keys(localAgents);
    if (names.length === 0) {
      print("\n  \x1b[2mNo local agents to stop.\x1b[0m\n");
      return;
    }

    printBrand();
    for (const name of names) {
      const localAgent = localAgents[name];
      if (killTmuxSessionSync(localAgent.tmuxSession)) {
        print(`  \x1b[32m✓\x1b[0m Stopped \x1b[1m${name}\x1b[0m`);
      } else {
        print(`  \x1b[2m○\x1b[0m ${name} was already stopped`);
      }
    }

    // Clear registry
    await saveLocalAgents({});

    const hub = await getGlobalRelayDir();
    await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: "system", type: "SYS", body: "all local agents stopped" });

    print("");
    return;
  }

  const localAgents = await loadLocalAgents();
  const localAgent = localAgents[targetName];

  if (!localAgent) {
    print(`\n  \x1b[31m✗\x1b[0m No local agent named \x1b[1m${targetName}\x1b[0m.`);
    const names = Object.keys(localAgents);
    if (names.length > 0) {
      print(`  \x1b[2mRunning local agents: ${names.join(", ")}\x1b[0m`);
    }
    print("");
    process.exit(1);
  }

  // Kill tmux session
  if (killTmuxSessionSync(localAgent.tmuxSession)) {
    print(`\n  \x1b[32m✓\x1b[0m Stopped local agent \x1b[1m${targetName}\x1b[0m (tmux: ${localAgent.tmuxSession})`);
  } else {
    print(`\n  \x1b[2m○\x1b[0m Local agent \x1b[1m${targetName}\x1b[0m tmux session was already gone.`);
  }

  // Remove from registry
  delete localAgents[targetName];
  await saveLocalAgents(localAgents);

  // Log to channel
  const hub = await getGlobalRelayDir();
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: targetName, type: "SYS", body: "agent stopped" });

  print("");
}

async function relayRestart() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { execSync } = await import("node:child_process");
  await requireRelay();

  printBrand();
  print("  Restarting relay local agents...\n");

  // 0. Clear stale on-air lock
  await releaseOnAir();

  // 1. Kill all stale local agents from registry
  const localAgents = await loadLocalAgents();
  const staleNames = Object.keys(localAgents);
  for (const name of staleNames) {
    const localAgent = localAgents[name];
    if (killTmuxSessionSync(localAgent.tmuxSession)) {
      print(`  \x1b[32m✓\x1b[0m Stopped \x1b[1m${name}\x1b[0m`);
    } else {
      print(`  \x1b[2m○\x1b[0m ${name} was already stopped`);
    }
  }
  await saveLocalAgents({});

  // 2. Respawn roster
  const config = await loadRelayConfig();
  const roster = config.roster || [];
  if (roster.length === 0) {
    print("\n  \x1b[2mNo roster configured — add with: openscout relay config roster add <name>\x1b[0m\n");
    return;
  }

  const hub = await getGlobalRelayDir();
  const hubShort = hub.replace(os.homedir(), "~");
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: "system", type: "SYS", body: "relay restart — respawning roster" });

  print(`\n  Spawning roster: ${roster.join(", ")}\n`);

  for (const name of roster) {
    const tmuxSession = `relay-${tmuxSafe(name)}`;
    if (await isTmuxSessionAlive(tmuxSession)) {
      print(`  \x1b[33m!\x1b[0m ${name} already running`);
      continue;
    }

    let projectPath: string;
    try {
      projectPath = await resolveProjectPath(name);
      const stat = await fs.stat(projectPath);
      if (!stat.isDirectory()) { print(`  \x1b[31m✗\x1b[0m ${name} — not found`); continue; }
    } catch { print(`  \x1b[31m✗\x1b[0m ${name} — not found`); continue; }

    const projectName = path.basename(projectPath);
    const agentName = name;
    const systemPrompt = [
      `You are "${agentName}", a relay agent for the ${projectName} project.`,
      `You have full access to the codebase at ${projectPath}.`,
      `Use the relay commands below for agent communication. They prefer the broker and fall back to the local relay queue when needed.`,
      `Respond to @${agentName} mentions, answer questions about this project, coordinate with other agents.`,
      `Always reply via: openscout relay send --as ${agentName} "your message"`,
      `Read context via: openscout relay read --as ${agentName}`,
      `To speak aloud to the human: openscout relay speak --as ${agentName} "your answer"`,
      `Only use relay speak for final meaningful responses to humans, not acks or status updates.`,
      `Do not use file-backed relay state directly.`,
      `Be specific with file paths. Keep messages under 200 chars.`,
    ].join("\n");

    const agentDirectory = path.join(hub, "agents");
    await fs.mkdir(agentDirectory, { recursive: true });
    const promptFile = path.join(agentDirectory, `${agentName}.prompt.txt`);
    await fs.writeFile(promptFile, systemPrompt);
    const initialMsg = `You are now online as a relay agent for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${agentName} "relay agent online — ready to assist with ${projectName}"`;
    const initialFile = path.join(agentDirectory, `${agentName}.initial.txt`);
    await fs.writeFile(initialFile, initialMsg);
    const launchScript = path.join(agentDirectory, `${agentName}.launch.sh`);
    await fs.writeFile(launchScript, [
      `#!/bin/bash`,
      `cd ${JSON.stringify(projectPath)}`,
      `(sleep 5 && BUFFER_NAME="openscout-init-${agentName}-$$" && tmux load-buffer -b "$BUFFER_NAME" ${JSON.stringify(initialFile)} && tmux paste-buffer -d -b "$BUFFER_NAME" -t ${tmuxSession} && tmux send-keys -t ${tmuxSession} Enter) &`,
      `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${agentName}-relay-agent"`,
    ].join("\n") + "\n");
    await fs.chmod(launchScript, 0o755);

    try {
      execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);
      const currentLocalAgents = await loadLocalAgents();
      currentLocalAgents[agentName] = { project: projectName, tmuxSession, cwd: projectPath, startedAt: Math.floor(Date.now() / 1000) };
      await saveLocalAgents(currentLocalAgents);
      await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agentName, type: "SYS", body: `agent spawned for ${projectName}` });
      print(`  \x1b[32m✓\x1b[0m \x1b[1m${name}\x1b[0m is alive`);
    } catch (e) {
      print(`  \x1b[31m✗\x1b[0m ${name} — failed to spawn`);
    }
  }

  print("");
}

async function relayPs() {
  const { execSync } = await import("node:child_process");
  await requireRelay();

  const localAgents = await loadLocalAgents();
  const names = Object.keys(localAgents);

  printBrand();
  print("  \x1b[1mLocal Agents\x1b[0m\n");

  if (names.length === 0) {
    print("  \x1b[2m(no local agents running)\x1b[0m");
    print("  \x1b[2mSpawn one: openscout relay up ~/dev/my-project\x1b[0m\n");
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  for (const name of names) {
    const localAgent = localAgents[name];
    const alive = await isTmuxSessionAlive(localAgent.tmuxSession);
    const status = alive ? "\x1b[32m●\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const uptime = now - localAgent.startedAt;
    const uptimeStr = uptime < 60
      ? `${uptime}s`
      : uptime < 3600
        ? `${Math.floor(uptime / 60)}m`
        : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    print(`  ${status} \x1b[1m${name}\x1b[0m  \x1b[2m${localAgent.project} · up ${uptimeStr} · tmux:${localAgent.tmuxSession}\x1b[0m`);

    if (localAgent.systemPrompt) {
      const taskPreview = localAgent.systemPrompt.length > 60 ? localAgent.systemPrompt.slice(0, 60) + "…" : localAgent.systemPrompt;
      print(`    \x1b[2mtask: ${taskPreview}\x1b[0m`);
    }
  }
  print("");

  // Clean up dead local agents
  let cleaned = false;
  for (const name of names) {
    if (!await isTmuxSessionAlive(localAgents[name].tmuxSession)) {
      delete localAgents[name];
      cleaned = true;
    }
  }
  if (cleaned) {
    await saveLocalAgents(localAgents);
    print("  \x1b[2m(cleaned up dead local agents from registry)\x1b[0m\n");
  }
}

async function relayStatus() {
  const path = await import("node:path");
  const broker = await loadBrokerRelayContext();
  const setup = await loadResolvedRelayAgents({
    currentDirectory: process.cwd(),
  });

  printBrand();
  if (broker) {
    const counts = broker.snapshot;
    const countSummary = `${Object.keys(counts.agents).length} agents · ${Object.keys(counts.conversations).length} conversations · ${Object.keys(counts.messages).length} messages`;
    print(`  \x1b[32m✓\x1b[0m Broker: \x1b[1m${broker.baseUrl}\x1b[0m  \x1b[2m(${countSummary})\x1b[0m`);
  } else {
    print(`  \x1b[31m✗\x1b[0m Broker: \x1b[1m${resolveBrokerUrl()}\x1b[0m`);
    print("  \x1b[2mBroker is not reachable.\x1b[0m");
  }
  if (setup.currentProjectConfigPath) {
    print(`  \x1b[32m✓\x1b[0m Project config: \x1b[1m${setup.currentProjectConfigPath}\x1b[0m`);
  } else {
    print(`  \x1b[33m○\x1b[0m Project config: \x1b[2m${path.join(process.cwd(), ".openscout", "project.json")} not created\x1b[0m`);
  }
  print("");
}

function relayHelp() {
  printBrand();
  print("  \x1b[1mRelay\x1b[0m — broker-backed agent chat\n");
  print("  \x1b[2mMessages are persisted in the broker and invocations are explicit.\x1b[0m\n");
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout relay <command> [options]\n");
  print("  \x1b[1mCommands:\x1b[0m");
  print("    init                           Ensure broker service and project config");
  print("    link                           Ensure this workspace has project config");
  print("    status                         Show broker and project status");
  print("    send <message>                 Post a broker-backed message");
  print("    speak <message>                Send + speak aloud via TTS");
  print("    state [state]                  Set agent state (speaking, thinking, idle)");
  print("    read                           Print recent channel messages (last 20)");
  print("    read --since <timestamp>       Messages after a unix timestamp");
  print("    read -n <count>                Show last N messages");
  print("    read --channel <name>          Read one broker conversation (default: shared)");
  print("    watch                          Stream new broker messages");
  print("    watch --channel <name>         Stream one broker conversation");
  print("    who                            List agents and their last activity");
  print("    forget <name>                  Remove a stale agent from the list");
  print("    tui                            Open the relay monitor dashboard");
  print("    enroll --as <name>             Generate enrollment prompt for an agent");
  print("    broadcast <message>            Send to all routable agents (alias: bc)\n");
  print("  \x1b[1mLocal Agents:\x1b[0m \x1b[2m(runtime-managed sessions)\x1b[0m");
  print("    up <path> [--name n] [--task t]  Spawn a local agent for a project");
  print("    down <name>                      Stop a local agent");
  print("    down --all                       Stop all local agents");
  print("    restart                          Clean stale local agents + respawn roster");
  print("    ps                               List running local agents");
  print("    ask --to <name> \"<question>\"     Ask an agent via the broker and wait for the answer\n");
  print("  \x1b[1mIdentity:\x1b[0m");
  print("    --as <name>                    Set agent name for this command");
  print("    --harness <claude|codex>       Force one harness for this invocation");
  print("    OPENSCOUT_AGENT=<name>         Set agent name via env var\n");
  print("  \x1b[1mExamples:\x1b[0m");
  print("    openscout relay init                              # first time");
  print("    openscout relay up ~/dev/lattices                 # spawn a local agent");
  print("    openscout relay up ~/dev/arc --task \"run tests\"   # local agent with a task");
  print("    openscout relay ps                                # check local agents");
  print("    openscout relay ask --to lattices --harness codex \"hey\"  # ask via codex");
  print("    openscout relay send --as dev \"@lattices hey\"            # post + invoke");
  print("    openscout relay down lattices                     # stop a local agent");
  print("    openscout relay tui\n");
}

async function relay() {
  const sub = args[1];

  switch (sub) {
    case "init":
      await relayInit();
      break;
    case "send":
      await relaySend();
      break;
    case "speak":
      await relaySpeak();
      break;
    case "state":
      await relayState();
      break;
    case "read":
      await relayRead();
      break;
    case "watch":
      await relayWatch();
      break;
    case "who":
      await relayWho();
      break;
    case "enroll":
      await relayEnroll();
      break;
    case "forget":
      await relayForget();
      break;
    case "broadcast":
    case "bc":
      await relayBroadcast();
      break;
    case "link":
      await relayLink();
      break;
    case "status":
      await relayStatus();
      break;
    case "up":
      await relayUp();
      break;
    case "down":
      await relayDown();
      break;
    case "ps":
      await relayPs();
      break;
    case "restart":
      await relayRestart();
      break;
    case "ask":
      await relayAsk();
      break;
    case "tui": {
      const { execSync } = await import("node:child_process");
      const path = await import("node:path");
      const tuiPath = path.join(import.meta.dirname, "..", "src", "tui", "index.tsx");
      const tmuxSession = "relay-tui";
      const forwardedTuiArgs = args
        .slice(2)
        .filter((arg) => arg !== "--no-tmux")
        .map((arg) => JSON.stringify(arg))
        .join(" ");
      const tuiCommand = forwardedTuiArgs
        ? `bun run ${JSON.stringify(tuiPath)} ${forwardedTuiArgs}`
        : `bun run ${JSON.stringify(tuiPath)}`;

      // If already inside the relay-tui tmux session, just run the TUI
      if (process.env.TMUX && process.env.TMUX.includes(tmuxSession)) {
        try {
          execSync(tuiCommand, { stdio: "inherit", cwd: process.cwd() });
        } catch { /* TUI exited — normal */ }
        break;
      }

      // If --no-tmux flag, run directly
      if (args.includes("--no-tmux")) {
        try {
          execSync(tuiCommand, { stdio: "inherit", cwd: process.cwd() });
        } catch { /* TUI exited — normal */ }
        break;
      }

      // Otherwise, wrap in a tmux session for tiling support
      try {
        // Kill stale session if it exists
        killTmuxSessionSync(tmuxSession);

        // Create tmux session with settings optimized for TUI rendering
        execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(process.cwd())} -x $(tput cols) -y $(tput lines)`);
        // Reduce flicker: disable status bar in this session, set escape-time to 0
        try {
          execSync(`tmux set-option -t ${tmuxSession} status off 2>/dev/null`);
          execSync(`tmux set-option -t ${tmuxSession} escape-time 0 2>/dev/null`);
        } catch { /* noop */ }
        // Send the TUI command and attach
        sendTmuxPrompt(tmuxSession, tuiCommand);
        execSync(`tmux attach -t ${tmuxSession}`, { stdio: "inherit" });
      } catch {
        // tmux not available or user quit — that's fine
      }
      break;
    }
    case "--help":
    case "-h":
    case undefined:
      relayHelp();
      break;
    default:
      print(`\n  \x1b[31m✗\x1b[0m Unknown relay command: ${sub}\n`);
      relayHelp();
      process.exit(1);
  }
}

// ── Route ──────────────────────────────────────────────

switch (command) {
  case "init":
    init();
    break;
  case "add":
    add();
    break;
  case "run":
    run();
    break;
  case "list":
  case "ls":
    list();
    break;
  case "relay":
    relay();
    break;
  case "--version":
  case "-v":
    print(VERSION);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    help();
    break;
  default:
    print(`\n  \x1b[31m✗\x1b[0m Unknown command: ${command}\n`);
    help();
    process.exit(1);
}
