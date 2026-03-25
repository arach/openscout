import { execSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  InvocationRequest,
} from "@openscout/protocol";

import { readProjectedRelayMessages } from "../../relay/src/core/projections/messages.js";
import { appendRelayMessage } from "../../relay/src/core/store/jsonl-store.js";

const BUILT_IN_LOCAL_AGENT_IDS = new Set(["scout", "builder", "reviewer", "research"]);

type ProjectTwinRecord = {
  project: string;
  tmuxSession: string;
  cwd: string;
  startedAt: number;
  systemPrompt?: string;
};

export type ProjectTwinBinding = {
  actor: ActorIdentity;
  agent: AgentDefinition;
  endpoint: AgentEndpoint;
};

function resolveRelayHub(): string {
  return process.env.OPENSCOUT_RELAY_HUB
    ?? join(process.env.HOME ?? process.cwd(), ".openscout", "relay");
}

function resolveProjectsRoot(): string {
  return process.env.OPENSCOUT_PROJECTS_ROOT
    ?? join(process.env.HOME ?? process.cwd(), "dev");
}

function twinsRegistryPath(): string {
  return join(resolveRelayHub(), "twins.json");
}

function twinsWorkingDirectory(): string {
  return join(resolveRelayHub(), "twins");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
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

async function readTwinsRegistry(): Promise<Record<string, ProjectTwinRecord>> {
  try {
    const raw = await readFile(twinsRegistryPath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, ProjectTwinRecord>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

async function writeTwinsRegistry(registry: Record<string, ProjectTwinRecord>): Promise<void> {
  await mkdir(resolveRelayHub(), { recursive: true });
  await writeFile(twinsRegistryPath(), JSON.stringify(registry, null, 2) + "\n");
}

function isTwinAlive(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${JSON.stringify(sessionName)}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function buildTwinSystemPrompt(
  twinName: string,
  projectName: string,
  projectPath: string,
): string {
  const relayEventsPath = join(resolveRelayHub(), "channel.jsonl");

  return [
    `You are "${twinName}", a project twin for the ${projectName} project.`,
    "",
    `You are the persistent, project-native runtime for this codebase.`,
    `A primary agent may call into you for context, execution, follow-through, and handoff.`,
    "",
    `You have full access to the codebase at ${projectPath}.`,
    `There is a structured relay event stream at ${relayEventsPath} shared by all agents.`,
    "",
    `Your job:`,
    `  - Respond to @${twinName} mentions from other agents`,
    `  - Answer questions about this project's code, architecture, and status`,
    `  - Coordinate with other agents when they need project-native context`,
    `  - Maintain continuity for ongoing project work`,
    "",
    `Relay commands:`,
    `  openscout relay send --as ${twinName} "your message"`,
    `  openscout relay read`,
    "",
    `Rules:`,
    `  - Always reply via relay send so other agents see your response`,
    `  - When replying to an [ask:<id>] request, include the same [ask:<id>] tag in your reply`,
    `  - Check relay read for context before responding`,
  ].join("\n");
}

function buildTwinInitialMessage(projectName: string, twinName: string): string {
  return `You are now online as the ${twinName} twin for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${twinName} "twin online — ready to assist with ${projectName}"`;
}

function buildTwinNudge(twinName: string, asker: string, flightId: string): string {
  return [
    `New relay ask from ${asker}.`,
    `Read it: openscout relay read -n 5 --as ${twinName}.`,
    `Reply with: openscout relay send --as ${twinName} "[ask:${flightId}] @${asker} <your response>"`,
  ].join(" ");
}

function stripTwinReplyMetadata(body: string, flightId: string, asker: string): string {
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

async function ensureTwinOnline(twinName: string, record: ProjectTwinRecord): Promise<ProjectTwinRecord> {
  if (isTwinAlive(record.tmuxSession)) {
    return record;
  }

  const projectPath = record.cwd;
  const projectName = record.project || basename(projectPath);
  const systemPrompt = record.systemPrompt || buildTwinSystemPrompt(twinName, projectName, projectPath);
  const initialMessage = buildTwinInitialMessage(projectName, twinName);

  const twinDir = twinsWorkingDirectory();
  await mkdir(twinDir, { recursive: true });

  const promptFile = join(twinDir, `${twinName}.prompt.txt`);
  const initialFile = join(twinDir, `${twinName}.initial.txt`);
  const launchScript = join(twinDir, `${twinName}.launch.sh`);

  await writeFile(promptFile, systemPrompt);
  await writeFile(initialFile, initialMessage);
  await writeFile(
    launchScript,
    [
      "#!/bin/bash",
      `cd ${JSON.stringify(projectPath)}`,
      `(sleep 5 && tmux send-keys -t ${record.tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
      `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
    ].join("\n") + "\n",
  );
  execSync(`chmod 755 ${JSON.stringify(launchScript)}`);
  execSync(`tmux new-session -d -s ${JSON.stringify(record.tmuxSession)} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

  const registry = await readTwinsRegistry();
  registry[twinName] = {
    ...record,
    startedAt: nowSeconds(),
    systemPrompt,
  };
  await writeTwinsRegistry(registry);

  return registry[twinName];
}

function buildTwinBinding(
  twinId: string,
  record: ProjectTwinRecord,
  alive: boolean,
  nodeId: string,
  source: "relay-twin-registry" | "project-inferred",
): ProjectTwinBinding {
  const displayName = titleCaseTwinName(twinId);

  return {
    actor: {
      id: twinId,
      kind: "agent",
      displayName,
      handle: twinId,
      labels: ["relay", "project", "twin"],
      metadata: {
        source,
        project: record.project,
        projectRoot: record.cwd,
        tmuxSession: record.tmuxSession,
      },
    },
    agent: {
      id: twinId,
      kind: "agent",
      displayName,
      handle: twinId,
      labels: ["relay", "project", "twin"],
      metadata: {
        source,
        project: record.project,
        projectRoot: record.cwd,
        tmuxSession: record.tmuxSession,
        summary: `${displayName} project twin for ${record.project}.`,
        role: "Project twin",
      },
      agentClass: "general",
      capabilities: ["chat", "invoke", "deliver"],
      wakePolicy: "on_demand",
      homeNodeId: nodeId,
      authorityNodeId: nodeId,
      advertiseScope: "local",
    },
    endpoint: {
      id: `endpoint.${twinId}.${nodeId}.tmux`,
      agentId: twinId,
      nodeId,
      harness: "claude",
      transport: "tmux",
      state: alive ? "idle" : "waiting",
      cwd: record.cwd,
      projectRoot: record.cwd,
      sessionId: record.tmuxSession,
      metadata: {
        source,
        twinName: twinId,
        tmuxSession: record.tmuxSession,
        project: record.project,
        projectRoot: record.cwd,
        startedAt: String(record.startedAt),
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

  const projectRoot = join(resolveProjectsRoot(), agentId);
  try {
    const stats = await stat(projectRoot);
    if (!stats.isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }

  const record: ProjectTwinRecord = {
    project: agentId,
    tmuxSession: `relay-${agentId}`,
    cwd: projectRoot,
    startedAt: nowSeconds(),
  };

  return buildTwinBinding(agentId, record, isTwinAlive(record.tmuxSession), nodeId, "project-inferred");
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
  const contextBlock = invocation.context
    ? `\n\nContext: ${JSON.stringify(invocation.context, null, 2)}`
    : "";

  await appendRelayMessage(resolveRelayHub(), {
    ts: askedAt,
    from: invocation.requesterId,
    type: "MSG",
    body: `[ask:${flightId}] @${twinName} ${invocation.task}${contextBlock}`,
    to: [twinName],
  });

  await sendTwinPrompt(onlineRecord, buildTwinNudge(twinName, invocation.requesterId, flightId));

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() <= deadline) {
    const messages = await readProjectedRelayMessages(resolveRelayHub(), { since: askedAt - 1 });

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.type !== "MSG") continue;
      if (message.from !== twinName) continue;
      if (!message.rawBody.includes(`[ask:${flightId}]`)) continue;

      return {
        output: stripTwinReplyMetadata(message.rawBody, flightId, invocation.requesterId),
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
