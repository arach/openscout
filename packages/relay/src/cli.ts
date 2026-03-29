#!/usr/bin/env node

import {
  extractAgentSelectors,
  normalizeAgentSelectorSegment,
  resolveAgentSelector,
  type AgentSelector,
  type AgentSelectorCandidate,
} from "@openscout/protocol";
import {
  ensureRelayAgentConfigured,
  resolveRelayAgentConfig,
} from "@openscout/runtime/setup";
import {
  ensureProjectTwinBindingOnline,
  inferProjectTwinBinding,
} from "@openscout/runtime/project-twins";

const VERSION = "0.2.0";
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
  print("    relay             File-based agent chat (relay --help)");
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
  return `agent-${process.pid}`;
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

interface BrokerSnapshot {
  actors: Record<string, BrokerActorRecord>;
  agents: Record<string, BrokerAgentRecord>;
  conversations: Record<string, BrokerConversationRecord>;
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

async function resolveMentionTargets(
  snapshot: BrokerSnapshot,
  text: string,
): Promise<{ resolved: BrokerMentionTarget[]; unresolved: string[]; legacyTargets: string[] }> {
  const selectors = extractAgentSelectors(text);
  const resolved = new Map<string, BrokerMentionTarget>();
  const unresolved: string[] = [];
  const legacyTargets = new Set<string>();
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

  for (const selector of selectors) {
    if (selector.definitionId === "system" || selector.definitionId === "all") {
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
  binding: Awaited<ReturnType<typeof inferProjectTwinBinding>>,
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
    syncLegacyMirror: true,
  });
  if (!configured) {
    return;
  }

  await syncBrokerBinding(baseUrl, snapshot, await inferProjectTwinBinding(configured.agentId, nodeId));
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

  const binding = await ensureProjectTwinBindingOnline(agentId, nodeId, {
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

async function postRelayMessageToBroker(input: {
  senderId: string;
  body: string;
  messageId: string;
  channel?: string;
  shouldSpeak?: boolean;
  mentionTargets: BrokerMentionTarget[];
  createdAtMs: number;
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
          invoke: validTargets,
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

async function writeChannel(hub: string, msg: Omit<ChannelMessage, "id">): Promise<ChannelMessage> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const entry: ChannelMessage = { id: generateMessageId(), ...msg };

  // Source of truth: JSONL
  await fs.appendFile(path.join(hub, "channel.jsonl"), JSON.stringify(entry) + "\n");

  // Human-readable mirror
  const tagStr = entry.tags?.length ? entry.tags.map(t => `[${t}]`).join(" ") + " " : "";
  await fs.appendFile(path.join(hub, "channel.log"), `${entry.ts} ${entry.from} ${entry.type} ${tagStr}${entry.body}\n`);

  return entry;
}


async function readChannel(hub: string, opts?: { since?: number; last?: number; id?: string }): Promise<ChannelMessage[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  let content: string;
  try {
    content = await fs.readFile(path.join(hub, "channel.jsonl"), "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n").filter(Boolean);
  let messages: ChannelMessage[] = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  if (opts?.id) {
    const idx = messages.findIndex(m => m.id === opts.id);
    return idx >= 0 ? [messages[idx]] : [];
  }
  if (opts?.since) {
    messages = messages.filter(m => m.ts > opts.since!);
  }
  if (opts?.last) {
    messages = messages.slice(-opts.last);
  }
  return messages;
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
  roster?: string[];     // project names to auto-start as twins (e.g. ["dev", "lattices", "arc"])
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
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  // Create global relay hub
  const hub = await getGlobalRelayDir();
  await fs.mkdir(hub, { recursive: true });

  const configPath = path.join(hub, "config.json");
  const logPath = path.join(hub, "channel.log");

  // Write config if it doesn't exist
  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: [],
        created: Date.now(),
        channels: { voice: { audio: true } },
      }, null, 2) + "\n"
    );
  }

  // Create log if it doesn't exist
  try {
    await fs.access(logPath);
  } catch {
    await fs.writeFile(logPath, "");
  }

  // Create local link in current project (so agents in this dir find the hub)
  const localDir = path.join(process.cwd(), ".openscout");
  await fs.mkdir(localDir, { recursive: true });
  const linkPath = path.join(localDir, "relay.json");
  const hubShort = hub.replace(os.homedir(), "~");
  await fs.writeFile(
    linkPath,
    JSON.stringify({ hub: hubShort, linkedAt: new Date().toISOString() }, null, 2) + "\n"
  );

  // Write a SYS init line
  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "unknown";
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: projectName, type: "SYS", body: `${projectName} linked to the relay` });

  printBrand();
  print(`  \x1b[32m✓\x1b[0m Global relay hub: \x1b[1m${hubShort}/\x1b[0m`);
  print(`  \x1b[32m✓\x1b[0m Local link: \x1b[1m.openscout/relay.json\x1b[0m → hub`);
  print(`  \x1b[32m✓\x1b[0m Channel log: \x1b[1m${hubShort}/channel.log\x1b[0m\n`);
  print("  \x1b[2mAll projects linked to the same hub share one channel.\x1b[0m");
  print("  \x1b[2mRun this in each project directory to link it.\x1b[0m\n");
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout relay send --as agent-a \"hello\"");
  print("    openscout relay read");
  print("    openscout relay watch --as agent-a\n");
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
    const twins = await loadTwins();
    const names = Object.keys(twins);
    if (names.length === 0) return "no twins running";

    const now = Math.floor(Date.now() / 1000);
    const lines: string[] = [];
    for (const name of names) {
      const twin = twins[name];
      const alive = await isTmuxSessionAlive(twin.tmuxSession);
      const uptime = now - twin.startedAt;
      const uptimeStr = uptime < 60 ? `${uptime}s`
        : uptime < 3600 ? `${Math.floor(uptime / 60)}m`
        : `${Math.floor(uptime / 3600)}h`;
      const icon = alive ? "●" : "✗";
      lines.push(`${icon} ${name} (${twin.project}, ${uptimeStr})`);
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
    const twins = await loadTwins();
    const status = await Promise.all(roster.map(async (name) => {
      const twin = twins[name];
      const alive = twin && await isTmuxSessionAlive(twin.tmuxSession);
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
        const twinName = name;
        const hubShort = hub.replace(os.homedir(), "~");
        const systemPrompt = [
          `You are "${twinName}", a relay twin for the ${projectName} project.`,
          `You have full access to the codebase at ${projectPath}.`,
          `Use the relay commands below for agent communication. They prefer the broker and fall back to the local relay queue when needed.`,
          `Respond to @${twinName} mentions, answer questions about this project, coordinate with other agents.`,
          `Always reply via: openscout relay send --as ${twinName} "your message"`,
          `Read context via: openscout relay read --as ${twinName}`,
          `To speak aloud to the human: openscout relay speak --as ${twinName} "your answer"`,
          `Only use relay speak for final meaningful responses to humans, not acks or status updates.`,
          `Do not read or write channel.log or channel.jsonl directly.`,
          `Be specific with file paths. Keep messages under 200 chars.`,
        ].join("\n");

        const twinDir = path.join(hub, "twins");
        await fs.mkdir(twinDir, { recursive: true });
        const promptFile = path.join(twinDir, `${twinName}.prompt.txt`);
        await fs.writeFile(promptFile, systemPrompt);
        const initialMsg = `You are now online as a relay twin for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${twinName} "twin online — ready to assist with ${projectName}"`;
        const initialFile = path.join(twinDir, `${twinName}.initial.txt`);
        await fs.writeFile(initialFile, initialMsg);
        const launchScript = path.join(twinDir, `${twinName}.launch.sh`);
        await fs.writeFile(launchScript, [
          `#!/bin/bash`,
          `cd ${JSON.stringify(projectPath)}`,
          `(sleep 5 && tmux send-keys -t ${tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
          `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
        ].join("\n") + "\n");
        await fs.chmod(launchScript, 0o755);
        execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

        const currentTwins = await loadTwins();
        currentTwins[twinName] = { project: projectName, tmuxSession, cwd: projectPath, startedAt: Math.floor(Date.now() / 1000) };
        await saveTwins(currentTwins);

        await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: twinName, type: "SYS", body: `twin spawned for ${projectName}` });
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
    const twinName = parts[2] || projectName; // optional alias as 3rd arg
    const tmuxSession = `relay-${tmuxSafe(twinName)}`;

    // Check if already running
    if (await isTmuxSessionAlive(tmuxSession)) {
      return `${twinName} is already running`;
    }

    // Build system prompt
    const hubShort = hub.replace(os.homedir(), "~");
    const systemPrompt = [
      `You are "${twinName}", a relay twin — a headless agent that handles relay communication for the ${projectName} project.`,
      `You have full access to the codebase at ${projectPath}.`,
      `Use the relay commands below for agent communication. They prefer the broker and fall back to the local relay queue when needed.`,
      `Your job: respond to @${twinName} mentions, answer questions about this project's code, coordinate with other agents.`,
      `Relay commands:`,
      `  openscout relay send --as ${twinName} "your message"`,
      `  openscout relay speak --as ${twinName} "your message"  (speaks aloud to the human via TTS)`,
      `  openscout relay read --as ${twinName}`,
      `  openscout relay who`,
      `Audio: the human may be in a voice conversation. Use 'relay speak' when you have a substantive`,
      `answer or result for the human. Do NOT speak acks, status updates, or agent-to-agent chatter.`,
      `Only speak the final, meaningful response directed at a human.`,
      `Rules: always reply via relay send, do not read or write channel.log or channel.jsonl directly, be specific with file paths, keep messages under 200 chars.`,
    ].join("\n");

    // Write files
    const twinDir = path.join(hub, "twins");
    await fs.mkdir(twinDir, { recursive: true });
    const promptFile = path.join(twinDir, `${twinName}.prompt.txt`);
    await fs.writeFile(promptFile, systemPrompt);

    const initialMsg = `You are now online as a relay twin for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${twinName} "twin online — ready to assist with ${projectName}"`;
    const initialFile = path.join(twinDir, `${twinName}.initial.txt`);
    await fs.writeFile(initialFile, initialMsg);

    const launchScript = path.join(twinDir, `${twinName}.launch.sh`);
    await fs.writeFile(launchScript, [
      `#!/bin/bash`,
      `cd ${JSON.stringify(projectPath)}`,
      `(sleep 5 && tmux send-keys -t ${tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
      `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
    ].join("\n") + "\n");
    await fs.chmod(launchScript, 0o755);

    // Spawn
    execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

    // Save registry
    const twins = await loadTwins();
    twins[twinName] = {
      project: projectName,
      tmuxSession,
      cwd: projectPath,
      startedAt: Math.floor(Date.now() / 1000),
    };
    await saveTwins(twins);

    await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: twinName, type: "SYS", body: `twin spawned for ${projectName}` });

    return `✓ spawned ${twinName} (tmux: ${tmuxSession})`;
  }

  if (cmd === "down") {
    const target = parts[1];
    if (!target) return "usage: @system down <name> | @system down --all";

    const twins = await loadTwins();

    if (target === "--all") {
      const names = Object.keys(twins);
      if (names.length === 0) return "no twins to stop";
      const results: string[] = [];
      for (const name of names) {
        try {
          execSync(`tmux kill-session -t ${twins[name].tmuxSession} 2>/dev/null`);
          results.push(`✓ ${name}`);
        } catch {
          results.push(`○ ${name} (already stopped)`);
        }
      }
      await saveTwins({});
      await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: "system", type: "SYS", body: "all twins stopped" });
      return results.join(", ");
    }

    const twin = twins[target];
    if (!twin) {
      const names = Object.keys(twins);
      return names.length > 0
        ? `no twin named ${target}. running: ${names.join(", ")}`
        : `no twin named ${target}`;
    }

    try {
      execSync(`tmux kill-session -t ${twin.tmuxSession} 2>/dev/null`);
    } catch { /* already gone */ }
    delete twins[target];
    await saveTwins(twins);

    await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: target, type: "SYS", body: "twin stopped" });
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
  const fs = await import("node:fs/promises");
  const { hub, logPath } = await requireRelay();

  // Collect message: everything after "send" that isn't a flag
  const sendIdx = args.indexOf("send");
  const msgParts: string[] = [];
  let channel: string | undefined;
  let shouldSpeak = false;
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
    msgParts.push(args[i]);
    i++;
  }

  const message = msgParts.join(" ").trim();
  if (!message) {
    print("\n  \x1b[31m✗\x1b[0m No message provided. Usage: openscout relay send \"your message\"\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const ts = Math.floor(Date.now() / 1000);
  const tags = shouldSpeak ? ["speak"] : [];
  const broker = await loadBrokerRelayContext();
  const mentionResolution = broker
    ? await resolveMentionTargets(broker.snapshot, message)
    : { resolved: [] as BrokerMentionTarget[], unresolved: [] as string[], legacyTargets: [] as string[] };
  const legacyMentions = mentionResolution.legacyTargets;

  const entry = await writeChannel(hub, {
    ts, from: agent, type: "MSG", body: message,
    tags: tags.length ? tags : undefined,
    to: legacyMentions.length ? legacyMentions : undefined,
    channel,
  });

  print(formatLine(`${ts} ${agent} MSG ${tags.map(t => `[${t}]`).join(" ")}${tags.length ? " " : ""}${message}`));

  // Track the origin channel for audio responses
  const config = await loadRelayConfig();
  const audioEnabled = isAudioChannel(config, channel);

  // Check for @system command
  if (message.match(/@system\b/i)) {
    const result = await handleSystemCommand(agent, message);
    if (result) {
      const replyTs = Math.floor(Date.now() / 1000);
      await writeChannel(hub, { ts: replyTs, from: "system", type: "MSG", body: `@${agent} ${result}`, to: [agent] });
      print(formatLine(`${replyTs} system MSG @${agent} ${result}`));

      // Audio channel → speak the system response
      if (audioEnabled) {
        const voice = getVoiceForChannel(config, channel);
        speak(result, voice);
      }
    }
    return;
  }

  // Notify @mentioned agents
  const brokerResult = broker
    ? await postRelayMessageToBroker({
        senderId: agent,
        body: message,
        messageId: entry.id,
        channel,
        shouldSpeak,
        mentionTargets: mentionResolution.resolved,
        createdAtMs: Date.now(),
      })
    : {
        usedBroker: false,
        invokedTargets: [] as string[],
        unresolvedTargets: [...mentionResolution.unresolved, ...legacyMentions],
      };
  if (brokerResult.usedBroker) {
    for (const target of brokerResult.invokedTargets) {
      print(`  \x1b[32m✓\x1b[0m Routed to ${target} via broker invocation`);
    }
  }

  for (const label of brokerResult.unresolvedTargets) {
    print(`  \x1b[2m○\x1b[0m ${label} is not currently routable — message queued in channel\x1b[0m`);
  }

  const fallbackTargets = legacyMentions.filter((target) => !brokerResult.invokedTargets.includes(target));
  if (fallbackTargets.length) {
    for (const target of fallbackTargets) {
      if (target === agent) continue; // don't deliver to yourself
      const result = await deliverToAgent(target, agent, message, channel, entry.id);
      if (result === "delivered") {
        print(`  \x1b[32m✓\x1b[0m Delivered to ${target}'s session (resumed)`);
      } else if (result === "nudged") {
        print(`  \x1b[33m○\x1b[0m Nudged ${target} via tmux (session not found)`);
      } else {
        print(`  \x1b[2m○\x1b[0m ${target} not registered — message queued in channel\x1b[0m`);
      }
    }
  }
}

async function relaySpeak() {
  const fs = await import("node:fs/promises");
  const { hub, logPath } = await requireRelay();

  // Collect message — same flag parsing as send
  const speakIdx = args.indexOf("speak");
  const msgParts: string[] = [];
  let i = speakIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") {
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
  const ts = Math.floor(Date.now() / 1000);
  const broker = await loadBrokerRelayContext();
  const mentionResolution = broker
    ? await resolveMentionTargets(broker.snapshot, message)
    : { resolved: [] as BrokerMentionTarget[], unresolved: [] as string[], legacyTargets: [] as string[] };
  const legacyMentions = mentionResolution.legacyTargets;

  const entry = await writeChannel(hub, {
    ts, from: agent, type: "MSG", body: message,
    tags: ["speak"],
    to: legacyMentions.length ? legacyMentions : undefined,
  });
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

  const brokerResult = broker
    ? await postRelayMessageToBroker({
        senderId: agent,
        body: message,
        messageId: entry.id,
        channel: "voice",
        shouldSpeak: true,
        mentionTargets: mentionResolution.resolved,
        createdAtMs: Date.now(),
      })
    : {
        usedBroker: false,
        invokedTargets: [] as string[],
        unresolvedTargets: [...mentionResolution.unresolved, ...legacyMentions],
      };
  if (brokerResult.usedBroker) {
    for (const target of brokerResult.invokedTargets) {
      print(`  \x1b[32m✓\x1b[0m Routed to ${target} via broker invocation`);
    }
  }

  for (const label of brokerResult.unresolvedTargets) {
    print(`  \x1b[2m○\x1b[0m ${label} is not currently routable — message queued in channel\x1b[0m`);
  }

  const fallbackTargets = legacyMentions.filter((target) => !brokerResult.invokedTargets.includes(target));
  if (fallbackTargets.length) {
    for (const target of fallbackTargets) {
      if (target === agent) continue;
      await deliverToAgent(target, agent, message, undefined, entry.id);
    }
  }
}

// ── relay ask ─────────────────────────────────────────

async function relayAsk() {
  const fs = await import("node:fs");
  const fsP = await import("node:fs/promises");
  const path = await import("node:path");
  const { hub, logPath } = await requireRelay();

  // Parse --twin
  const twinIdx = args.indexOf("--twin");
  const twinName = twinIdx !== -1 ? args[twinIdx + 1] : null;
  if (!twinName) {
    process.stderr.write("error: --twin <name> is required\n");
    process.exit(1);
  }

  // Parse --timeout (default 300s)
  const timeoutIdx = args.indexOf("--timeout");
  const timeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : 300;

  // Collect question — everything after "ask" that isn't a flag
  const skipFlags = new Set(["--twin", "--as", "--timeout"]);
  const msgParts: string[] = [];
  for (let i = 2; i < args.length; i++) {
    if (skipFlags.has(args[i])) { i++; continue; }
    msgParts.push(args[i]);
  }
  const question = msgParts.join(" ").trim();
  if (!question) {
    process.stderr.write("error: no question provided\n");
    process.exit(1);
  }

  const asker = getAgentName();

  // Verify twin is alive
  const twins = await loadTwins();
  const twin = twins[twinName];
  if (!twin || !await isTmuxSessionAlive(twin.tmuxSession)) {
    process.stderr.write(`error: twin "${twinName}" is not running\n`);
    process.exit(1);
  }

  // Create flight
  const flight = await createFlight(asker, twinName, question);
  process.stderr.write(`asking ${twinName}... (flight ${flight.id})\n`);

  // Write tagged message to channel
  const taggedMessage = `[ask:${flight.id}] @${twinName} ${question}`;
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: asker, type: "MSG", body: taggedMessage });

  // Deliver to twin inbox
  await deliverToAgent(twinName, asker, taggedMessage);

  // Watch channel.log for twin's response
  const stat = fs.statSync(logPath);
  let position = stat.size;

  const deadline = Date.now() + timeout * 1000;

  const checkNew = (): string | null => {
    const current = fs.statSync(logPath);
    if (current.size <= position) return null;

    const fd = fs.openSync(logPath, "r");
    const buf = Buffer.alloc(current.size - position);
    fs.readSync(fd, buf, 0, buf.length, position);
    fs.closeSync(fd);
    position = current.size;

    const lines = buf.toString("utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const parts = line.split(" ");
      const from = parts[1];
      const type = parts[2];
      const body = parts.slice(3).join(" ");

      // Match: MSG from the twin that @mentions the asker
      if (type === "MSG" && from === twinName && body.includes(`@${asker}`)) {
        // Clean the response: strip @mentions and ask tags
        const clean = body
          .replace(/@[\w.-]+/g, "")
          .replace(/\[ask:[^\]]+\]/g, "")
          .trim();
        return clean;
      }
    }
    return null;
  };

  return new Promise<void>(async (resolve) => {
    let done = false;

    const complete = async (response: string) => {
      if (done) return;
      done = true;
      watcher.close();
      clearTimeout(timer);

      const flights = await loadFlights();
      const f = flights.find((fl) => fl.id === flight.id);
      if (f) {
        f.status = "completed";
        f.response = response;
        f.respondedAt = Math.floor(Date.now() / 1000);
        await saveFlights(flights);
      }

      process.stderr.write(`flight ${flight.id} completed\n`);
      process.stdout.write(response + "\n");
      resolve();
    };

    const watcher = fs.watch(logPath, () => {
      const response = checkNew();
      if (response !== null) complete(response);
    });

    const timer = setTimeout(() => {
      if (done) return;
      watcher.close();
      process.stderr.write(`error: timed out after ${timeout}s waiting for ${twinName}\n`);
      process.exit(1);
    }, timeout * 1000);

    // Initial check in case the response arrived before the watcher started
    const immediate = checkNew();
    if (immediate !== null) complete(immediate);
  });
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
  const { hub } = await requireRelay();

  // --since <timestamp> filter
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx !== -1 ? Number(args[sinceIdx + 1]) : 0;

  // -n <count> or default 20
  const nIdx = args.indexOf("-n");
  const count = nIdx !== -1 ? Number(args[nIdx + 1]) : 20;

  const messages = await readChannel(hub, since > 0 ? { since } : { last: count });

  if (messages.length === 0) {
    print("\n  \x1b[2mNo messages.\x1b[0m\n");
    return;
  }

  print("");
  for (const msg of messages) {
    const tagStr = msg.tags?.length ? msg.tags.map(t => `[${t}]`).join(" ") + " " : "";
    print(formatLine(`${msg.ts} ${msg.from} ${msg.type} ${tagStr}${msg.body}`));
  }
  print("");
}

async function relayWatch() {
  const fs = await import("node:fs");
  const { hub, logPath } = await requireRelay();
  const { execSync } = await import("node:child_process");

  const agent = getAgentName();
  const tmuxIdx = args.indexOf("--tmux");
  const tmuxPane = tmuxIdx !== -1 ? args[tmuxIdx + 1] : null;

  // Write join message
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agent, type: "SYS", body: `${agent} joined the relay` });

  // Start reading from end of file
  const stat = fs.statSync(logPath);
  let position = stat.size;

  printBrand();
  print(`  Watching as \x1b[1m${agent}\x1b[0m ${tmuxPane ? `(nudging tmux pane ${tmuxPane})` : ""}`);
  print("  \x1b[2mPress Ctrl+C to stop\x1b[0m\n");

  const readNew = () => {
    const current = fs.statSync(logPath);
    if (current.size <= position) return;

    const fd = fs.openSync(logPath, "r");
    const buf = Buffer.alloc(current.size - position);
    fs.readSync(fd, buf, 0, buf.length, position);
    fs.closeSync(fd);
    position = current.size;

    const newContent = buf.toString("utf-8");
    const lines = newContent.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const parts = line.split(" ");
      const from = parts[1];

      // Don't echo our own messages back
      if (from === agent) continue;

      print(formatLine(line));

      // Tmux nudge
      if (tmuxPane) {
        const type = parts[2];
        const body = parts.slice(3).join(" ");
        const preview = body.length > 80 ? body.slice(0, 80) + "…" : body;
        const nudge = type === "SYS"
          ? `[relay] ${body}`
          : `[relay] ${from}: ${preview}`;
        try {
          execSync(`tmux send-keys -t ${tmuxPane} ${JSON.stringify(nudge)} Enter`);
        } catch {
          // tmux not available or pane doesn't exist — silently skip
        }
      }
    }
  };

  fs.watch(logPath, () => readNew());

  // Keep process alive
  process.on("SIGINT", () => {
    writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agent, type: "SYS", body: `${agent} left the relay` }).finally(() => {
      print(`\n  \x1b[2m${agent} left the relay\x1b[0m\n`);
      process.exit(0);
    });
  });
}

async function relayWho() {
  const fs = await import("node:fs/promises");
  const { channelPath } = await requireRelay();

  const content = await fs.readFile(channelPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const now = Math.floor(Date.now() / 1000);
  const ONLINE_THRESHOLD = 600; // 10 minutes

  // Build agent map from structured JSONL
  const agents = new Map<string, { lastSeen: number; messages: number; forgotten: boolean }>();

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

  // Filter out forgotten agents
  const visible = [...agents.entries()].filter(([_, info]) => !info.forgotten);

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

  print(`  \x1b[32m✓\x1b[0m Wrote enrollment event to channel.log\n`);
}

async function relayBroadcast() {
  const fs = await import("node:fs/promises");
  const { execSync } = await import("node:child_process");
  const { hub } = await requireRelay();

  // Collect message
  const bcIdx = args.indexOf("broadcast");
  const msgParts: string[] = [];
  let i = bcIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") { i += 2; continue; }
    msgParts.push(args[i]);
    i++;
  }

  const message = msgParts.join(" ").trim();
  if (!message) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay broadcast \"your message\"\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const ts = Math.floor(Date.now() / 1000);
  await writeChannel(hub, { ts, from: agent, type: "MSG", body: `📢 ${message}` });

  print(formatLine(`${ts} ${agent} MSG 📢 ${message}`));

  // Nudge all tmux panes
  let nudged = 0;
  try {
    const panes = execSync("tmux list-panes -a -F '#{pane_id}'", { encoding: "utf-8" })
      .trim().split("\n").filter(Boolean);

    const preview = message.length > 60 ? message.slice(0, 60) + "…" : message;
    for (const pane of panes) {
      try {
        execSync(`tmux send-keys -t ${pane} ${JSON.stringify(`[broadcast] ${agent}: ${preview}`)} Enter`);
        nudged++;
      } catch {
        // pane may not accept input — skip
      }
    }
  } catch {
    // tmux not running — that's fine
  }

  if (nudged > 0) {
    print(`  \x1b[32m✓\x1b[0m Nudged ${nudged} tmux pane${nudged === 1 ? "" : "s"}`);
  }
  print("");
}

async function relayLink() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const hub = await getGlobalRelayDir();
  const logPath = path.join(hub, "channel.log");

  // Verify global hub exists
  try {
    await fs.access(logPath);
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Global relay not initialized. Run \x1b[1mopenscout relay init\x1b[0m first.\n");
    process.exit(1);
  }

  // Create local link
  const localDir = path.join(process.cwd(), ".openscout");
  await fs.mkdir(localDir, { recursive: true });
  const linkPath = path.join(localDir, "relay.json");
  const hubShort = hub.replace(os.homedir(), "~");
  await fs.writeFile(
    linkPath,
    JSON.stringify({ hub: hubShort, linkedAt: new Date().toISOString() }, null, 2) + "\n"
  );

  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "unknown";
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: projectName, type: "SYS", body: `${projectName} linked to the relay` });

  printBrand();
  print(`  \x1b[32m✓\x1b[0m Linked \x1b[1m${projectName}\x1b[0m → \x1b[1m${hubShort}/\x1b[0m\n`);
  print("  Agents in this directory now share the global relay channel.");
  print("  Run \x1b[1mopenscout relay read\x1b[0m to see messages from all projects.\n");
}

// ── Twins ─────────────────────────────────────────────

interface TwinEntry {
  project: string;
  tmuxSession: string;
  cwd: string;
  startedAt: number;
  systemPrompt?: string;
}

async function loadTwins(): Promise<Record<string, TwinEntry>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const twinsPath = path.join(hub, "twins.json");
  try {
    const raw = await fs.readFile(twinsPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTwins(twins: Record<string, TwinEntry>): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const twinsPath = path.join(hub, "twins.json");
  await fs.writeFile(twinsPath, JSON.stringify(twins, null, 2) + "\n");
}

function tmuxSafe(name: string): string {
  // tmux treats dots as window.pane separators — replace with underscores
  return name.replace(/\./g, "_");
}

async function isTmuxSessionAlive(sessionName: string): Promise<boolean> {
  try {
    const { execSync } = await import("node:child_process");
    execSync(`tmux has-session -t ${sessionName}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
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
    print("    openscout relay up ~/dev/arc --name arc-twin");
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
  const twinName = nameIdx !== -1 ? args[nameIdx + 1] : projectName;

  // Parse optional task
  const taskIdx = args.indexOf("--task");
  const task = taskIdx !== -1 ? args.slice(taskIdx + 1).filter((a) => !a.startsWith("--")).join(" ") : "";

  const tmuxSession = `relay-${tmuxSafe(twinName)}`;

  // Check if already running
  if (await isTmuxSessionAlive(tmuxSession)) {
    print(`\n  \x1b[33m!\x1b[0m Twin \x1b[1m${twinName}\x1b[0m is already running (tmux: ${tmuxSession})`);
    print(`  \x1b[2mUse: openscout relay down ${twinName}\x1b[0m\n`);
    process.exit(1);
  }

  // Build the enrollment system prompt
  const hub = await getGlobalRelayDir();
  const hubShort = hub.replace(os.homedir(), "~");
  const systemPrompt = [
    `You are "${twinName}", a relay twin — a headless agent that handles relay communication for the ${projectName} project.`,
    ``,
    `You have full access to the codebase at ${projectPath}.`,
    `Use the relay commands below for agent communication. They prefer the broker and fall back to the local relay queue when needed.`,
    ``,
    `Your job:`,
    `  - Respond to @${twinName} mentions from other agents`,
    `  - Answer questions about this project's code, architecture, and status`,
    `  - Coordinate with other agents when they need info from this project`,
    `  - Run commands, check code, and provide accurate answers`,
    ``,
    `Relay commands:`,
    `  openscout relay send --as ${twinName} "your message"   — send a message`,
    `  openscout relay read --as ${twinName}                  — check recent messages`,
    `  openscout relay who                                    — see who's active`,
    ``,
    `Rules:`,
    `  - Always reply via relay send so other agents see your response`,
    `  - Do not read or write channel.log or channel.jsonl directly`,
    `  - Be specific: include file paths, line numbers, what you found`,
    `  - Keep messages under 200 chars unless detailed info was requested`,
    `  - Check relay read for context before responding`,
    task ? `\nYour primary task: ${task}` : "",
  ].filter(Boolean).join("\n");

  // Create the tmux session with claude
  printBrand();
  print(`  Spawning twin \x1b[1m${twinName}\x1b[0m...\n`);

  // Write system prompt + launcher to files (avoids shell quoting hell)
  const twinDir = path.join(hub, "twins");
  await fs.mkdir(twinDir, { recursive: true });
  const promptFile = path.join(twinDir, `${twinName}.prompt.txt`);
  await fs.writeFile(promptFile, systemPrompt);

  const initialMsg = task
    ? `You are now online as a relay twin. Your task: ${task}. Announce yourself on the relay and start working.`
    : `You are now online as a relay twin for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${twinName} "twin online — ready to assist with ${projectName}"`;

  const initialFile = path.join(twinDir, `${twinName}.initial.txt`);
  await fs.writeFile(initialFile, initialMsg);

  // Launcher: starts Claude interactively, then sends initial message after startup
  const launchScript = path.join(twinDir, `${twinName}.launch.sh`);
  await fs.writeFile(launchScript, [
    `#!/bin/bash`,
    `cd ${JSON.stringify(projectPath)}`,
    `# Send initial message after Claude starts (background)`,
    `(sleep 5 && tmux send-keys -t ${tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
    `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
  ].join("\n") + "\n");
  await fs.chmod(launchScript, 0o755);

  // Create detached tmux session running the launcher
  execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

  // Save to twins registry
  const twins = await loadTwins();
  twins[twinName] = {
    project: projectName,
    tmuxSession,
    cwd: projectPath,
    startedAt: Math.floor(Date.now() / 1000),
    systemPrompt: task || undefined,
  };
  await saveTwins(twins);

  // Log to channel
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: twinName, type: "SYS", body: `twin spawned for ${projectName}` });

  print(`  \x1b[32m✓\x1b[0m Twin \x1b[1m${twinName}\x1b[0m is alive`);
  print(`  \x1b[2m  tmux: ${tmuxSession}\x1b[0m`);
  print(`  \x1b[2m  cwd:  ${projectPath}\x1b[0m`);
  if (task) print(`  \x1b[2m  task: ${task}\x1b[0m`);
  print("");
  print("  \x1b[1mUseful commands:\x1b[0m");
  print(`    tmux attach -t ${tmuxSession}        \x1b[2m# peek at the twin\x1b[0m`);
  print(`    openscout relay send "@${twinName} hey"  \x1b[2m# talk to it\x1b[0m`);
  print(`    openscout relay ps                    \x1b[2m# check all twins\x1b[0m`);
  print(`    openscout relay down ${twinName}          \x1b[2m# stop it\x1b[0m\n`);
}

async function relayDown() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { execSync } = await import("node:child_process");
  await requireRelay();

  const downIdx = args.indexOf("down");
  const targetName = downIdx !== -1 ? args[downIdx + 1] : undefined;

  if (!targetName) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay down <twin-name>\n");
    process.exit(1);
  }

  // Check --all flag
  if (targetName === "--all") {
    const twins = await loadTwins();
    const names = Object.keys(twins);
    if (names.length === 0) {
      print("\n  \x1b[2mNo twins to stop.\x1b[0m\n");
      return;
    }

    printBrand();
    for (const name of names) {
      const twin = twins[name];
      try {
        execSync(`tmux kill-session -t ${twin.tmuxSession} 2>/dev/null`);
        print(`  \x1b[32m✓\x1b[0m Stopped \x1b[1m${name}\x1b[0m`);
      } catch {
        print(`  \x1b[2m○\x1b[0m ${name} was already stopped`);
      }
    }

    // Clear registry
    await saveTwins({});

    const hub = await getGlobalRelayDir();
    await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: "system", type: "SYS", body: "all twins stopped" });

    print("");
    return;
  }

  const twins = await loadTwins();
  const twin = twins[targetName];

  if (!twin) {
    print(`\n  \x1b[31m✗\x1b[0m No twin named \x1b[1m${targetName}\x1b[0m.`);
    const names = Object.keys(twins);
    if (names.length > 0) {
      print(`  \x1b[2mRunning twins: ${names.join(", ")}\x1b[0m`);
    }
    print("");
    process.exit(1);
  }

  // Kill tmux session
  try {
    execSync(`tmux kill-session -t ${twin.tmuxSession} 2>/dev/null`);
    print(`\n  \x1b[32m✓\x1b[0m Stopped twin \x1b[1m${targetName}\x1b[0m (tmux: ${twin.tmuxSession})`);
  } catch {
    print(`\n  \x1b[2m○\x1b[0m Twin \x1b[1m${targetName}\x1b[0m tmux session was already gone.`);
  }

  // Remove from registry
  delete twins[targetName];
  await saveTwins(twins);

  // Log to channel
  const hub = await getGlobalRelayDir();
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: targetName, type: "SYS", body: "twin stopped" });

  print("");
}

async function relayRestart() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { execSync } = await import("node:child_process");
  await requireRelay();

  printBrand();
  print("  Restarting relay twins...\n");

  // 0. Clear stale on-air lock
  await releaseOnAir();

  // 1. Kill all stale twins from registry
  const twins = await loadTwins();
  const staleNames = Object.keys(twins);
  for (const name of staleNames) {
    const twin = twins[name];
    try {
      execSync(`tmux kill-session -t ${twin.tmuxSession} 2>/dev/null`);
      print(`  \x1b[32m✓\x1b[0m Stopped \x1b[1m${name}\x1b[0m`);
    } catch {
      print(`  \x1b[2m○\x1b[0m ${name} was already stopped`);
    }
  }
  await saveTwins({});

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
    const twinName = name;
    const systemPrompt = [
      `You are "${twinName}", a relay twin for the ${projectName} project.`,
      `You have full access to the codebase at ${projectPath}.`,
      `Use the relay commands below for agent communication. They prefer the broker and fall back to the local relay queue when needed.`,
      `Respond to @${twinName} mentions, answer questions about this project, coordinate with other agents.`,
      `Always reply via: openscout relay send --as ${twinName} "your message"`,
      `Read context via: openscout relay read --as ${twinName}`,
      `To speak aloud to the human: openscout relay speak --as ${twinName} "your answer"`,
      `Only use relay speak for final meaningful responses to humans, not acks or status updates.`,
      `Do not read or write channel.log or channel.jsonl directly.`,
      `Be specific with file paths. Keep messages under 200 chars.`,
    ].join("\n");

    const twinDir = path.join(hub, "twins");
    await fs.mkdir(twinDir, { recursive: true });
    const promptFile = path.join(twinDir, `${twinName}.prompt.txt`);
    await fs.writeFile(promptFile, systemPrompt);
    const initialMsg = `You are now online as a relay twin for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${twinName} "twin online — ready to assist with ${projectName}"`;
    const initialFile = path.join(twinDir, `${twinName}.initial.txt`);
    await fs.writeFile(initialFile, initialMsg);
    const launchScript = path.join(twinDir, `${twinName}.launch.sh`);
    await fs.writeFile(launchScript, [
      `#!/bin/bash`,
      `cd ${JSON.stringify(projectPath)}`,
      `(sleep 5 && tmux send-keys -t ${tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
      `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
    ].join("\n") + "\n");
    await fs.chmod(launchScript, 0o755);

    try {
      execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);
      const currentTwins = await loadTwins();
      currentTwins[twinName] = { project: projectName, tmuxSession, cwd: projectPath, startedAt: Math.floor(Date.now() / 1000) };
      await saveTwins(currentTwins);
      await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: twinName, type: "SYS", body: `twin spawned for ${projectName}` });
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

  const twins = await loadTwins();
  const names = Object.keys(twins);

  printBrand();
  print("  \x1b[1mTwins\x1b[0m\n");

  if (names.length === 0) {
    print("  \x1b[2m(no twins running)\x1b[0m");
    print("  \x1b[2mSpawn one: openscout relay up ~/dev/my-project\x1b[0m\n");
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  for (const name of names) {
    const twin = twins[name];
    const alive = await isTmuxSessionAlive(twin.tmuxSession);
    const status = alive ? "\x1b[32m●\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const uptime = now - twin.startedAt;
    const uptimeStr = uptime < 60
      ? `${uptime}s`
      : uptime < 3600
        ? `${Math.floor(uptime / 60)}m`
        : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    print(`  ${status} \x1b[1m${name}\x1b[0m  \x1b[2m${twin.project} · up ${uptimeStr} · tmux:${twin.tmuxSession}\x1b[0m`);

    if (twin.systemPrompt) {
      const taskPreview = twin.systemPrompt.length > 60 ? twin.systemPrompt.slice(0, 60) + "…" : twin.systemPrompt;
      print(`    \x1b[2mtask: ${taskPreview}\x1b[0m`);
    }
  }
  print("");

  // Clean up dead twins
  let cleaned = false;
  for (const name of names) {
    if (!await isTmuxSessionAlive(twins[name].tmuxSession)) {
      delete twins[name];
      cleaned = true;
    }
  }
  if (cleaned) {
    await saveTwins(twins);
    print("  \x1b[2m(cleaned up dead twins from registry)\x1b[0m\n");
  }
}

async function relayStatus() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const hub = await getGlobalRelayDir();
  const hubShort = hub.replace(os.homedir(), "~");
  const logPath = path.join(hub, "channel.log");

  printBrand();

  // Check global hub
  try {
    await fs.access(logPath);
    const content = await fs.readFile(logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const msgCount = lines.filter((l) => l.split(" ")[2] === "MSG").length;
    print(`  \x1b[32m✓\x1b[0m Hub: \x1b[1m${hubShort}/\x1b[0m  \x1b[2m(${lines.length} lines, ${msgCount} messages)\x1b[0m`);
  } catch {
    print(`  \x1b[31m✗\x1b[0m Hub: \x1b[2mnot initialized\x1b[0m`);
    print("\n  Run \x1b[1mopenscout relay init\x1b[0m to create the global hub.\n");
    return;
  }

  // Check local link
  const localLink = path.join(process.cwd(), ".openscout", "relay.json");
  try {
    const raw = await fs.readFile(localLink, "utf-8");
    const config = JSON.parse(raw);
    const projectName = process.cwd().split("/").pop() || "unknown";
    print(`  \x1b[32m✓\x1b[0m Link: \x1b[1m${projectName}\x1b[0m → ${config.hub}  \x1b[2m(${config.linkedAt?.slice(0, 10) || "?"})\x1b[0m`);
  } catch {
    const projectName = process.cwd().split("/").pop() || "unknown";
    print(`  \x1b[33m○\x1b[0m Link: \x1b[1m${projectName}\x1b[0m \x1b[2m— not linked (run \x1b[0mopenscout relay link\x1b[2m)\x1b[0m`);
  }

  // Show linked projects by scanning known locations
  // (We can't enumerate all links, but we can show what the user might expect)
  print("");
}

function relayHelp() {
  printBrand();
  print("  \x1b[1mRelay\x1b[0m — file-based agent chat\n");
  print("  \x1b[2mGlobal hub at ~/.openscout/relay/ — all projects share one channel.\x1b[0m\n");
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout relay <command> [options]\n");
  print("  \x1b[1mCommands:\x1b[0m");
  print("    init                           Create global hub + link this project");
  print("    link                           Link this project to the global hub");
  print("    status                         Show hub and link status");
  print("    send <message>                 Append a message to the channel");
  print("    speak <message>                Send + speak aloud via TTS");
  print("    state [state]                  Set agent state (speaking, thinking, idle)");
  print("    read                           Print recent messages (last 20)");
  print("    read --since <timestamp>       Messages after a unix timestamp");
  print("    read -n <count>                Show last N messages");
  print("    watch                          Stream new messages as they arrive");
  print("    watch --tmux <pane>            Stream + nudge a tmux pane on new messages");
  print("    who                            List agents and their last activity");
  print("    forget <name>                  Remove a stale agent from the list");
  print("    tui                            Open the relay monitor dashboard");
  print("    enroll --as <name>             Generate enrollment prompt for an agent");
  print("    broadcast <message>            Send + nudge all tmux panes (alias: bc)\n");
  print("  \x1b[1mTwins:\x1b[0m \x1b[2m(headless agents in detached tmux sessions)\x1b[0m");
  print("    up <path> [--name n] [--task t]  Spawn a twin for a project");
  print("    down <name>                      Stop a twin");
  print("    down --all                       Stop all twins");
  print("    restart                          Clean stale twins + respawn roster");
  print("    ps                               List running twins");
  print("    ask --twin <name> \"<question>\"   Ask a twin and wait for the answer\n");
  print("  \x1b[1mIdentity:\x1b[0m");
  print("    --as <name>                    Set agent name for this command");
  print("    OPENSCOUT_AGENT=<name>         Set agent name via env var\n");
  print("  \x1b[1mExamples:\x1b[0m");
  print("    openscout relay init                              # first time");
  print("    openscout relay up ~/dev/lattices                 # spawn a twin");
  print("    openscout relay up ~/dev/arc --task \"run tests\"   # twin with a task");
  print("    openscout relay ps                                # check twins");
  print("    openscout relay send --as dev \"@lattices hey\"     # talk to a twin");
  print("    openscout relay down lattices                     # stop a twin");
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

      // If already inside the relay-tui tmux session, just run the TUI
      if (process.env.TMUX && process.env.TMUX.includes(tmuxSession)) {
        try {
          execSync(`bun run ${tuiPath}`, { stdio: "inherit", cwd: process.cwd() });
        } catch { /* TUI exited — normal */ }
        break;
      }

      // If --no-tmux flag, run directly
      if (args.includes("--no-tmux")) {
        try {
          execSync(`bun run ${tuiPath}`, { stdio: "inherit", cwd: process.cwd() });
        } catch { /* TUI exited — normal */ }
        break;
      }

      // Otherwise, wrap in a tmux session for tiling support
      try {
        // Kill stale session if it exists
        try { execSync(`tmux kill-session -t ${tmuxSession} 2>/dev/null`); } catch { /* noop */ }

        // Create tmux session with settings optimized for TUI rendering
        execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(process.cwd())} -x $(tput cols) -y $(tput lines)`);
        // Reduce flicker: disable status bar in this session, set escape-time to 0
        try {
          execSync(`tmux set-option -t ${tmuxSession} status off 2>/dev/null`);
          execSync(`tmux set-option -t ${tmuxSession} escape-time 0 2>/dev/null`);
        } catch { /* noop */ }
        // Send the TUI command and attach
        execSync(`tmux send-keys -t ${tmuxSession} ${JSON.stringify(`bun run ${tuiPath}`)} Enter`);
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
