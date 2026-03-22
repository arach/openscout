#!/usr/bin/env node

import {
  appendRelayEvent,
  appendRelayMessage,
  createTmuxClaudeProjectTwinRuntime,
  DEFAULT_USER_TWIN,
  ensureRelayFiles,
  getVoiceForChannel,
  createRelayEventId,
  getUserTwinName as resolveUserTwinName,
  getRelayEventsPath,
  getRelayLogPath,
  isAudioChannel,
  loadRelayConfig as loadRelayConfigForHub,
  readProjectedRelayAgentStates,
  readProjectedRelayMessages,
  readRelayMessages,
  saveRelayConfig as saveRelayConfigForHub,
  speakRelayText,
  type ProjectTwinRecord,
  type RelayConfig,
  type RelayStoredMessage,
} from "./core/index.js";
import { invokeClaudeExploreTwinAction } from "./hosts/claude/explore-twin-subagent.js";
import { invokeCodexExecTwinAction } from "./hosts/codex/exec-twin-subagent.js";
import { createProjectTwinActionRunner } from "./twin-actions/project-twin-runner.js";
import type {
  TwinActionKind,
  TwinActionMode,
  TwinActionRequest,
} from "./twin-actions/protocol.js";

const VERSION = "0.2.0";
const BRAND = "\x1b[32m◆\x1b[0m";

const args = process.argv.slice(2);
const command = args[0];

function print(msg: string) {
  console.log(msg);
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function getFlagText(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;

  const values: string[] = [];
  for (let i = idx + 1; i < args.length; i += 1) {
    const value = args[i];
    if (value.startsWith("--")) break;
    values.push(value);
  }

  return values.length > 0 ? values.join(" ") : undefined;
}

function printBrand() {
  print(`\n  ${BRAND} \x1b[1mOpenScout\x1b[0m v${VERSION}\n`);
}

function normalizeTwinName(value: string): string {
  const trimmed = value.trim();
  const pkgSegment = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  const normalized = pkgSegment
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || DEFAULT_USER_TWIN;
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

function formatTwinUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
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

interface ResolvedTwinContext {
  projectPath: string;
  projectName: string;
  twinName: string;
  task?: string;
  nameSource: "flag" | ".openscout/config.json" | "package.json" | "directory";
}

type ChannelMessage = RelayStoredMessage;

function getProjectTwinRuntime(hub: string) {
  return createTmuxClaudeProjectTwinRuntime(hub);
}

function getTwinActionRunner(hub: string) {
  return createProjectTwinActionRunner(getProjectTwinRuntime(hub));
}

async function writeChannel(hub: string, msg: Omit<ChannelMessage, "id">): Promise<ChannelMessage> {
  return appendRelayMessage(hub, msg);
}


async function readChannel(hub: string, opts?: { since?: number; last?: number; id?: string }): Promise<ChannelMessage[]> {
  return readRelayMessages(hub, opts);
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
      const logPath = path.join(hub, "channel.log");
      const channelPath = path.join(hub, "channel.jsonl");
      try {
        try { await fs.access(channelPath); } catch { await fs.access(logPath); }
        return {
          hub,
          logPath,
          channelPath,
          configPath: path.join(hub, "config.json"),
        };
      } catch {
        // stale local link — fall through to global resolution
      }
    }
  } catch {
    // No local link — fall through
  }

  // 2. Check global relay
  const hub = await getGlobalRelayDir();
  const logPath = getRelayLogPath(hub);
  const channelPath = getRelayEventsPath(hub);
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

async function loadRelayConfig(): Promise<RelayConfig> {
  const hub = await getGlobalRelayDir();
  return loadRelayConfigForHub(hub);
}

async function saveRelayConfig(config: RelayConfig): Promise<void> {
  const hub = await getGlobalRelayDir();
  await saveRelayConfigForHub(hub, config);
}

function createDefaultRelayConfig(): RelayConfig {
  return {
    agents: [],
    created: Date.now(),
    userTwin: DEFAULT_USER_TWIN,
    channels: { voice: { audio: true } },
  };
}

async function writeRelayLink(projectPath: string, hub: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const localDir = path.join(projectPath, ".openscout");
  await fs.mkdir(localDir, { recursive: true });
  const linkPath = path.join(localDir, "relay.json");
  const hubShort = hub.replace(os.homedir(), "~");
  await fs.writeFile(
    linkPath,
    JSON.stringify({ hub: hubShort, linkedAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

async function ensureRelayBootstrap(hub: string, projectPathToLink?: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  await ensureRelayFiles(hub);

  try {
    await fs.access(path.join(hub, "config.json"));
  } catch {
    await saveRelayConfigForHub(hub, createDefaultRelayConfig());
  }

  if (projectPathToLink) {
    await writeRelayLink(projectPathToLink, hub);
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  const fs = await import("node:fs/promises");

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveTwinContext(targetArg?: string): Promise<ResolvedTwinContext> {
  const path = await import("node:path");

  const explicitName = getFlagValue("--name");
  const explicitTask = getFlagText("--task");
  const projectPath = !targetArg || targetArg === "."
    ? process.cwd()
    : await resolveProjectPath(targetArg);
  const projectName = path.basename(projectPath);

  if (explicitName) {
    return {
      projectPath,
      projectName,
      twinName: normalizeTwinName(explicitName),
      task: explicitTask,
      nameSource: "flag",
    };
  }

  const scoutConfig = await readJsonObject(path.join(projectPath, ".openscout", "config.json"));
  if (typeof scoutConfig?.name === "string" && scoutConfig.name.trim()) {
    return {
      projectPath,
      projectName,
      twinName: normalizeTwinName(scoutConfig.name),
      task: explicitTask,
      nameSource: ".openscout/config.json",
    };
  }

  const packageJson = await readJsonObject(path.join(projectPath, "package.json"));
  if (typeof packageJson?.name === "string" && packageJson.name.trim()) {
    return {
      projectPath,
      projectName,
      twinName: normalizeTwinName(packageJson.name),
      task: explicitTask,
      nameSource: "package.json",
    };
  }

  return {
    projectPath,
    projectName,
    twinName: normalizeTwinName(projectName),
    task: explicitTask,
    nameSource: "directory",
  };
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
  await ensureRelayBootstrap(hub, process.cwd());

  const hubShort = hub.replace(os.homedir(), "~");

  // Write a SYS init line
  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "unknown";
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: projectName, type: "SYS", body: `${projectName} linked to the relay` });

  printBrand();
  print(`  \x1b[32m✓\x1b[0m Global relay hub: \x1b[1m${hubShort}/\x1b[0m`);
  print(`  \x1b[32m✓\x1b[0m Event stream: \x1b[1m${hubShort}/channel.jsonl\x1b[0m`);
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

async function speak(text: string, voice: string, relayDir: string): Promise<void> {
  try {
    await speakRelayText({
      relayDir,
      text,
      voice,
    });
  } catch { /* noop */ }
}

async function deliverToAgent(name: string, from: string, message: string, channel?: string, messageId?: string): Promise<"delivered" | "nudged" | "queued"> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const twinRuntime = getProjectTwinRuntime(hub);

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

  const idRef = messageId ? ` (message: ${messageId})` : "";
  const twinTicked = await twinRuntime.tickProjectTwin(
    name,
    `new relay message from ${from}${idRef}`,
  );
  if (twinTicked) {
    return "nudged";
  }

  return "queued";
}

// ── @system agent ─────────────────────────────────────

async function handleSystemCommand(from: string, message: string): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // Strip the @system prefix and parse the command
  const stripped = message.replace(/@system\s*/i, "").trim();
  const parts = stripped.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  if (!cmd) {
    return "usage: @system up <name> | down <name> | down --all | ps | config root <path>";
  }

  const hub = await getGlobalRelayDir();
  const twinRuntime = getProjectTwinRuntime(hub);

  if (cmd === "ps") {
    const twins = await twinRuntime.listProjectTwins();
    if (twins.length === 0) return "no twins running";

    return twins
      .map((twin) => `${twin.alive ? "●" : "✗"} ${twin.twinId} (${twin.project}, ${formatTwinUptime(twin.uptimeSeconds)})`)
      .join(" | ");
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
    const twins = await twinRuntime.loadTwins();
    const status = await Promise.all(roster.map(async (name) => {
      const twin = twins[name];
      const alive = twin ? await twinRuntime.isTwinAlive(name) : false;
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
        let projectPath: string;
        try {
          projectPath = await resolveProjectPath(name);
          const stat = await fs.stat(projectPath);
          if (!stat.isDirectory()) { results.push(`${name} (not found)`); continue; }
        } catch { results.push(`${name} (not found)`); continue; }

        const result = await twinRuntime.startProjectTwin({
          hub,
          projectPath,
          twinName: name,
        });
        results.push(result.status === "already_running" ? `${name} (already up)` : `${name} (up)`);
      }
      return results.join(", ");
    }

    // Resolve: bare name → <projectRoot>/<name>, or use as path
    const projectPath = await resolveProjectPath(target);

    // Verify it exists
    try {
      const stat = await fs.stat(projectPath);
      if (!stat.isDirectory()) return `not a directory: ${target}`;
    } catch {
      return `not found: ${projectPath}`;
    }

    const projectName = path.basename(projectPath);
    const twinName = parts[2] || projectName; // optional alias as 3rd arg
    const result = await twinRuntime.startProjectTwin({
      hub,
      projectPath,
      twinName,
    });
    if (result.status === "already_running") {
      return `${twinName} is already running`;
    }

    return `✓ started ${twinName} (${result.record.runtime})`;
  }

  if (cmd === "down") {
    const target = parts[1];
    if (!target) return "usage: @system down <name> | @system down --all";

    if (target === "--all") {
      const results = await twinRuntime.stopAllProjectTwins();
      if (results.length === 0) return "no twins to stop";
      return results.map((result) => result.status === "stopped" ? `✓ ${result.twinName}` : `○ ${result.twinName} (already stopped)`).join(", ");
    }

    const result = await twinRuntime.stopProjectTwin(target);
    if (result.status === "not_found") {
      const twins = await twinRuntime.loadTwins();
      const names = Object.keys(twins);
      return names.length > 0
        ? `no twin named ${target}. running: ${names.join(", ")}`
        : `no twin named ${target}`;
    }

    return result.status === "stopped" ? `✓ stopped ${target}` : `○ ${target} (already stopped)`;
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

    if (key === "companion" && value) {
      const config = await loadRelayConfig();
      config.userTwin = value;
      await saveRelayConfig(config);
      return `user twin set to ${value}`;
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
    const userTwin = resolveUserTwinName(config);
    const voice = config.defaultVoice || "nova (default)";
    const channels = config.channels || {};
    const chList = Object.entries(channels)
      .map(([name, ch]) => `${name}: audio=${ch.audio ? "on" : "off"}${ch.voice ? ` voice=${ch.voice}` : ""}`)
      .join(", ") || "none configured";
    return `root: ${root} | user twin: ${userTwin} | voice: ${voice} | channels: ${chList}`;
  }

  if (cmd === "companion") {
    const value = parts[1];
    const config = await loadRelayConfig();

    if (!value) {
      return `user twin: ${resolveUserTwinName(config)}`;
    }

    config.userTwin = value;
    await saveRelayConfig(config);
    return `user twin set to ${value}`;
  }

  return `unknown command: ${cmd}. try: up, down, ps, companion, config`;
}

async function relaySend() {
  const { hub } = await requireRelay();

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
  const mentions = message.match(/@([\w.-]+)/g)?.map(m => m.slice(1)) || [];

  const entry = await writeChannel(hub, {
    ts, from: agent, type: "MSG", body: message,
    tags: tags.length ? tags : undefined,
    to: mentions.length ? mentions : undefined,
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
        void speak(result, voice, hub);
      }
    }
    return;
  }

  // Notify @mentioned agents
  if (mentions.length) {
    for (const target of mentions) {
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
  const { hub } = await requireRelay();

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
  const mentions = message.match(/@([\w.-]+)/g)?.map(m => m.slice(1)) || [];

  const entry = await writeChannel(hub, {
    ts, from: agent, type: "MSG", body: message,
    tags: ["speak"],
    to: mentions.length ? mentions : undefined,
  });
  print(formatLine(`${ts} ${agent} MSG [speak] ${message}`));

  // Set state → speaking, play TTS, set state → idle
  await setAgentState(agent, "speaking");

  const config = await loadRelayConfig();
  const voice = getVoiceForChannel(config, "voice");
  const clean = message.replace(/@[\w.-]+\s*/g, "").trim();
  if (clean) {
    await speak(clean, voice, hub);
  }

  await setAgentState(agent, "idle");

  // Also notify @mentioned agents
  if (mentions.length) {
    for (const target of mentions) {
      if (target === agent) continue;
      await deliverToAgent(target, agent, message, undefined, entry.id);
    }
  }
}

// ── relay ask ─────────────────────────────────────────

async function relayAsk() {
  const { hub } = await requireRelay();
  const twinActionRunner = getTwinActionRunner(hub);

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
  const viaIdx = args.indexOf("--via");
  const via = viaIdx !== -1 ? args[viaIdx + 1] : null;
  if (via && via !== "claude" && via !== "codex") {
    process.stderr.write(`error: unsupported --via "${via}"\n`);
    process.exit(1);
  }

  // Collect question — everything after "ask" that isn't a flag
  const skipFlags = new Set(["--twin", "--as", "--timeout", "--via"]);
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
  process.stderr.write(`asking ${twinName}...\n`);
  const request: TwinActionRequest = {
    twinId: twinName,
    action: "consult",
    mode: "persistent",
    actor: asker,
    input: question,
    timeoutSeconds: timeout,
  };

  try {
    const result = via === "claude"
      ? await invokeClaudeExploreTwinAction({
        request,
        cwd: process.cwd(),
      })
      : via === "codex"
        ? await invokeCodexExecTwinAction({
          request,
          cwd: process.cwd(),
        })
      : await twinActionRunner.invokeTwinAction(request);

    if (result.flightId) {
      process.stderr.write(`flight ${result.flightId} completed\n`);
    }
    if (!result.ok) {
      process.stderr.write(`error: ${result.output}\n`);
      process.exit(1);
    }
    process.stdout.write(result.output + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    process.exit(1);
  }
}

async function relayTwinAction() {
  const { hub } = await requireRelay();
  const twinActionRunner = getTwinActionRunner(hub);

  const twinIdx = args.indexOf("--twin");
  const twinId = twinIdx !== -1 ? args[twinIdx + 1] : null;
  if (!twinId) {
    process.stderr.write("error: --twin <name> is required\n");
    process.exit(1);
  }

  const actionIdx = args.indexOf("--action");
  const action = (actionIdx !== -1 ? args[actionIdx + 1] : "consult") as TwinActionKind;
  const validActions: TwinActionKind[] = ["consult", "execute", "status", "summarize", "tick"];
  if (!validActions.includes(action)) {
    process.stderr.write(`error: invalid --action "${action}"\n`);
    process.exit(1);
  }

  const modeIdx = args.indexOf("--mode");
  const mode = (modeIdx !== -1 ? args[modeIdx + 1] : "persistent") as TwinActionMode;
  if (mode !== "persistent" && mode !== "ephemeral") {
    process.stderr.write(`error: invalid --mode "${mode}"\n`);
    process.exit(1);
  }

  const timeoutIdx = args.indexOf("--timeout");
  const timeoutSeconds = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : undefined;
  const fromIdx = args.indexOf("--from");
  const actor = fromIdx !== -1 ? args[fromIdx + 1] : getAgentName();
  const jsonOutput = args.includes("--json");

  let input = "";
  const inputBase64Idx = args.indexOf("--input-base64");
  if (inputBase64Idx !== -1) {
    input = Buffer.from(args[inputBase64Idx + 1], "base64").toString("utf8");
  } else {
    const inputIdx = args.indexOf("--input");
    if (inputIdx !== -1) {
      input = args[inputIdx + 1];
    }
  }

  let context: Record<string, unknown> | undefined;
  const contextBase64Idx = args.indexOf("--context-base64");
  if (contextBase64Idx !== -1) {
    const raw = Buffer.from(args[contextBase64Idx + 1], "base64").toString("utf8");
    context = JSON.parse(raw) as Record<string, unknown>;
  }

  const result = await twinActionRunner.invokeTwinAction({
    twinId,
    action,
    mode,
    input,
    context,
    actor,
    timeoutSeconds,
  });

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  if (result.flightId) {
    process.stderr.write(`flight ${result.flightId} completed\n`);
  }
  process.stdout.write(result.output + "\n");
  if (!result.ok) {
    process.exit(1);
  }
}

// ── Agent state ───────────────────────────────────────
// Agents set their own state: speaking, thinking, idle, etc.
// State is projected from Relay events — the TUI reads the projection for visual feedback.

async function loadAgentStates(): Promise<Record<string, string>> {
  const hub = await getGlobalRelayDir();
  const states = await readProjectedRelayAgentStates(hub);
  return Object.fromEntries(
    Object.entries(states).map(([agent, state]) => [agent, state.state]),
  );
}

async function setAgentState(agent: string, state: string): Promise<void> {
  const hub = await getGlobalRelayDir();
  await appendRelayEvent(hub, {
    id: createRelayEventId("state"),
    kind: "agent.state_set",
    v: 1,
    ts: Math.floor(Date.now() / 1000),
    actor: agent,
    payload: {
      state,
    },
  });
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
  const { hub, channelPath } = await requireRelay();
  const { execSync } = await import("node:child_process");

  const agent = getAgentName();
  const tmuxIdx = args.indexOf("--tmux");
  const tmuxPane = tmuxIdx !== -1 ? args[tmuxIdx + 1] : null;

  // Write join message
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agent, type: "SYS", body: `${agent} joined the relay` });

  await ensureRelayFiles(hub);
  let seenCount = (await readProjectedRelayMessages(hub)).length;

  printBrand();
  print(`  Watching as \x1b[1m${agent}\x1b[0m ${tmuxPane ? `(nudging tmux pane ${tmuxPane})` : ""}`);
  print("  \x1b[2mPress Ctrl+C to stop\x1b[0m\n");

  const readNew = async () => {
    const messages = await readProjectedRelayMessages(hub);
    if (messages.length < seenCount) {
      seenCount = 0;
    }

    const fresh = messages.slice(seenCount);
    if (fresh.length === 0) return;
    seenCount = messages.length;

    for (const msg of fresh) {
      if (msg.from === agent) continue;

      print(formatLine(`${msg.timestamp} ${msg.from} ${msg.type} ${msg.body}`));

      if (tmuxPane) {
        const preview = msg.body.length > 80 ? msg.body.slice(0, 80) + "…" : msg.body;
        const nudge = msg.type === "SYS"
          ? `[relay] ${msg.body}`
          : `[relay] ${msg.from}: ${preview}`;
        try {
          execSync(`tmux send-keys -t ${tmuxPane} ${JSON.stringify(nudge)} Enter`);
        } catch {
          // tmux not available or pane doesn't exist — silently skip
        }
      }
    }
  };

  fs.watch(channelPath, () => {
    void readNew();
  });

  // Keep process alive
  process.on("SIGINT", () => {
    writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: agent, type: "SYS", body: `${agent} left the relay` }).finally(() => {
      print(`\n  \x1b[2m${agent} left the relay\x1b[0m\n`);
      process.exit(0);
    });
  });
}

async function relayWho() {
  const { hub } = await requireRelay();
  const messages = await readProjectedRelayMessages(hub);

  const now = Math.floor(Date.now() / 1000);
  const ONLINE_THRESHOLD = 600; // 10 minutes

  // Build agent map
  const agents = new Map<string, { lastSeen: number; messages: number; forgotten: boolean }>();

  for (const message of messages) {
    if (!agents.has(message.from)) {
      agents.set(message.from, { lastSeen: message.timestamp, messages: 0, forgotten: false });
    }
    const agent = agents.get(message.from)!;
    agent.lastSeen = Math.max(agent.lastSeen, message.timestamp);

    if (message.type === "MSG") agent.messages++;
    if (message.type === "SYS" && message.rawBody.includes("forgotten")) agent.forgotten = true;
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
  const { hub, channelPath } = await requireRelay();

  const agent = getAgentName();

  // Check for --task flag
  const taskIdx = args.indexOf("--task");
  const task = taskIdx !== -1 ? args.slice(taskIdx + 1).filter((a) => !a.startsWith("--")).join(" ") : "";

  const prompt = [
    `You are ${agent}.`,
    "",
    `There is a global relay event stream at ${channelPath} that other agents are using.`,
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

  print(`  \x1b[32m✓\x1b[0m Wrote enrollment event to relay stream\n`);
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
  const os = await import("node:os");

  const hub = await getGlobalRelayDir();
  const channelPath = getRelayEventsPath(hub);
  const logPath = getRelayLogPath(hub);

  // Verify global hub exists
  try {
    try {
      await fs.access(channelPath);
    } catch {
      await fs.access(logPath);
    }
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Global relay not initialized. Run \x1b[1mopenscout relay init\x1b[0m first.\n");
    process.exit(1);
  }

  // Create local link
  await writeRelayLink(process.cwd(), hub);

  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "unknown";
  await writeChannel(hub, { ts: Math.floor(Date.now() / 1000), from: projectName, type: "SYS", body: `${projectName} linked to the relay` });

  printBrand();
  print(`  \x1b[32m✓\x1b[0m Linked \x1b[1m${projectName}\x1b[0m → \x1b[1m${hub.replace(os.homedir(), "~")}/\x1b[0m\n`);
  print("  Agents in this directory now share the global relay channel.");
  print("  Run \x1b[1mopenscout relay read\x1b[0m to see messages from all projects.\n");
}

// ── Twins ─────────────────────────────────────────────

async function openTwinFocusedTui(twinName: string, cwd: string): Promise<void> {
  const { execSync, spawnSync } = await import("node:child_process");
  const path = await import("node:path");

  const tuiPath = path.join(import.meta.dirname, "..", "src", "tui", "index.tsx");
  const tuiArgs = ["run", tuiPath, "--", "--focus-twin", twinName];

  if (hasFlag("--no-tmux") || process.env.TMUX) {
    try {
      spawnSync("bun", tuiArgs, { stdio: "inherit", cwd });
    } catch {
      // TUI exit or local Bun issue — surface nothing extra here.
    }
    return;
  }

  const tmuxSession = `relay-view-${normalizeTwinName(twinName)}`;
  const tuiCommand = `bun run ${JSON.stringify(tuiPath)} -- --focus-twin ${JSON.stringify(twinName)}`;

  try {
    try { execSync(`tmux kill-session -t ${tmuxSession} 2>/dev/null`); } catch { /* noop */ }
    execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(cwd)} -x $(tput cols) -y $(tput lines)`);
    try {
      execSync(`tmux set-option -t ${tmuxSession} status off 2>/dev/null`);
      execSync(`tmux set-option -t ${tmuxSession} escape-time 0 2>/dev/null`);
    } catch { /* noop */ }
    execSync(`tmux send-keys -t ${tmuxSession} ${JSON.stringify(tuiCommand)} Enter`);
    execSync(`tmux attach -t ${tmuxSession}`, { stdio: "inherit" });
  } catch {
    try {
      spawnSync("bun", tuiArgs, { stdio: "inherit", cwd });
    } catch {
      // TUI exit — normal.
    }
  }
}

function relayTwinHelp() {
  printBrand();
  print("  \x1b[1mRelay Twin\x1b[0m — project-native runtime workflow\n");
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout relay twin <command> [options]\n");
  print("  \x1b[1mCommands:\x1b[0m");
  print("    up [path] [--name n] [--task t]  Start or adopt the project twin, then open its monitor");
  print("    view [name|path]                 Open the relay monitor focused on a twin");
  print("    ps                               List running twins");
  print("    down <name>                      Stop a twin");
  print("    ask --twin <name> \"<question>\"   Ask a twin via Relay");
  print("    tick <name> [--reason text]      Nudge a twin proactively\n");
  print("  \x1b[1mDefaults:\x1b[0m");
  print("    `twin up` infers the twin name from `.openscout/config.json`, then `package.json`, then the directory name.");
  print("    It also bootstraps the relay hub and links the current project if needed.\n");
  print("  \x1b[1mExamples:\x1b[0m");
  print("    openscout relay twin up");
  print("    openscout relay twin up . --task \"watch failing tests\"");
  print("    openscout relay twin view");
  print("    openscout relay twin view lattices");
  print("    openscout relay twin tick dev --reason \"new local edits\"\n");
}

async function relayTwinUp() {
  const fs = await import("node:fs/promises");

  if (hasFlag("--help") || hasFlag("-h")) {
    print("\n  openscout relay twin up [path] [--name <name>] [--task <description>] [--no-view] [--no-tmux]\n");
    print("  Starts or adopts the twin for the current project context, then opens a focused relay monitor.\n");
    return;
  }

  const upIdx = args.indexOf("up");
  const targetArg = upIdx !== -1 && args[upIdx + 1] && !args[upIdx + 1].startsWith("--")
    ? args[upIdx + 1]
    : undefined;
  const context = await resolveTwinContext(targetArg);

  try {
    const stat = await fs.stat(context.projectPath);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    print(`\n  \x1b[31m✗\x1b[0m Not a directory: ${targetArg ?? context.projectPath}\n`);
    process.exit(1);
  }

  const existing = await resolveRelayPaths();
  const hub = existing?.hub ?? await getGlobalRelayDir();
  await ensureRelayBootstrap(hub, context.projectPath);

  const twinRuntime = getProjectTwinRuntime(hub);
  const result = await twinRuntime.startProjectTwin({
    hub,
    projectPath: context.projectPath,
    twinName: context.twinName,
    task: context.task,
  });

  printBrand();
  print(`  \x1b[32m✓\x1b[0m Twin \x1b[1m${context.twinName}\x1b[0m ${result.status === "started" ? "ready" : "already running"}`);
  print(`  \x1b[2m  project: ${context.projectName}\x1b[0m`);
  print(`  \x1b[2m  cwd:     ${context.projectPath}\x1b[0m`);
  print(`  \x1b[2m  tmux:    ${result.record.tmuxSession}\x1b[0m`);
  if (context.nameSource !== "flag") {
    print(`  \x1b[2m  name:    inferred from ${context.nameSource}\x1b[0m`);
  }
  if (context.task) {
    print(`  \x1b[2m  task:    ${context.task}\x1b[0m`);
  }
  print("");

  if (hasFlag("--no-view")) {
    print("  \x1b[1mUseful commands:\x1b[0m");
    print(`    tmux attach -t ${result.record.tmuxSession}        \x1b[2m# peek at the twin\x1b[0m`);
    print(`    openscout relay twin view ${context.twinName}      \x1b[2m# focused relay monitor\x1b[0m`);
    print(`    openscout relay ask --via codex --twin ${context.twinName} \"status?\"\n`);
    return;
  }

  print(`  \x1b[2mOpening relay monitor focused on @${context.twinName}...\x1b[0m\n`);
  await openTwinFocusedTui(context.twinName, context.projectPath);
}

async function relayTwinView() {
  if (hasFlag("--help") || hasFlag("-h")) {
    print("\n  openscout relay twin view [name|path] [--no-tmux]\n");
    print("  Opens the relay monitor focused on the inferred twin for this project, or on the named twin.\n");
    return;
  }

  const viewIdx = args.indexOf("view");
  const targetArg = viewIdx !== -1 && args[viewIdx + 1] && !args[viewIdx + 1].startsWith("--")
    ? args[viewIdx + 1]
    : undefined;
  const looksLikePath = !!targetArg && (
    targetArg === "." ||
    targetArg.startsWith("/") ||
    targetArg.startsWith("~")
  );

  const existing = await resolveRelayPaths();
  const hub = existing?.hub ?? await getGlobalRelayDir();
  await ensureRelayBootstrap(hub, process.cwd());

  if (!targetArg || looksLikePath) {
    const context = await resolveTwinContext(targetArg);
    await openTwinFocusedTui(context.twinName, context.projectPath);
    return;
  }

  await openTwinFocusedTui(normalizeTwinName(targetArg), process.cwd());
}

async function relayTwinTick() {
  if (hasFlag("--help") || hasFlag("-h")) {
    print("\n  openscout relay twin tick <name> [--reason <text>]\n");
    print("  Sends a proactive tick to a registered twin without waiting for an inbound ask.\n");
    return;
  }

  const { hub } = await requireRelay();
  const tickIdx = args.indexOf("tick");
  const twinName = tickIdx !== -1 ? args[tickIdx + 1] : undefined;

  if (!twinName || twinName.startsWith("--")) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay twin tick <name> [--reason <text>]\n");
    process.exit(1);
  }

  const reason = getFlagText("--reason") ?? "manual twin tick";
  const ok = await getProjectTwinRuntime(hub).tickProjectTwin(twinName, reason);

  printBrand();
  if (!ok) {
    print(`  \x1b[31m✗\x1b[0m Twin \x1b[1m${twinName}\x1b[0m is not available for ticking\n`);
    process.exit(1);
  }

  print(`  \x1b[32m✓\x1b[0m Ticked \x1b[1m${twinName}\x1b[0m`);
  print(`  \x1b[2m  reason: ${reason}\x1b[0m\n`);
}

async function relayTwin() {
  const sub = args[2];

  switch (sub) {
    case "up":
      await relayTwinUp();
      break;
    case "view":
      await relayTwinView();
      break;
    case "ps":
      await relayPs();
      break;
    case "down":
      await relayDown();
      break;
    case "ask":
      await relayAsk();
      break;
    case "tick":
      await relayTwinTick();
      break;
    case "--help":
    case "-h":
    case undefined:
      relayTwinHelp();
      break;
    default:
      print(`\n  \x1b[31m✗\x1b[0m Unknown relay twin command: ${sub}\n`);
      relayTwinHelp();
      process.exit(1);
  }
}

async function relayUp() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { hub } = await requireRelay();
  const twinRuntime = getProjectTwinRuntime(hub);

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
  const projectPath = targetArg === "." ? process.cwd() : await resolveProjectPath(targetArg);

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
  const result = await twinRuntime.startProjectTwin({
    hub,
    projectPath,
    twinName,
    task,
  });

  if (result.status === "already_running") {
    print(`\n  \x1b[33m!\x1b[0m Twin \x1b[1m${twinName}\x1b[0m is already running (tmux: ${result.record.tmuxSession})`);
    print(`  \x1b[2mUse: openscout relay down ${twinName}\x1b[0m\n`);
    process.exit(1);
  }

  print(`  \x1b[32m✓\x1b[0m Twin \x1b[1m${twinName}\x1b[0m is alive`);
  print(`  \x1b[2m  runtime: ${result.record.runtime}\x1b[0m`);
  print(`  \x1b[2m  tmux: ${result.record.tmuxSession}\x1b[0m`);
  print(`  \x1b[2m  cwd:  ${result.record.projectRoot}\x1b[0m`);
  if (task) print(`  \x1b[2m  task: ${task}\x1b[0m`);
  print("");
  print("  \x1b[1mUseful commands:\x1b[0m");
  print(`    tmux attach -t ${result.record.tmuxSession}        \x1b[2m# peek at the twin\x1b[0m`);
  print(`    openscout relay send "@${twinName} hey"  \x1b[2m# talk to it\x1b[0m`);
  print(`    openscout relay ps                    \x1b[2m# check all twins\x1b[0m`);
  print(`    openscout relay down ${twinName}          \x1b[2m# stop it\x1b[0m\n`);
}

async function relayCompanion() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const existing = await resolveRelayPaths();
  const hub = existing?.hub ?? await getGlobalRelayDir();
  await ensureRelayBootstrap(hub, process.cwd());
  const twinRuntime = getProjectTwinRuntime(hub);
  const config = await loadRelayConfigForHub(hub);

  const companionIdx = args.indexOf("companion");
  const targetArg = companionIdx !== -1 && args[companionIdx + 1] && !args[companionIdx + 1].startsWith("--")
    ? args[companionIdx + 1]
    : ".";

  const projectPath = targetArg === "." ? process.cwd() : await resolveProjectPath(targetArg);
  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    print(`\n  \x1b[31m✗\x1b[0m Not a directory: ${targetArg}\n`);
    process.exit(1);
  }

  const projectName = path.basename(projectPath);
  const nameIdx = args.indexOf("--name");
  const twinName = nameIdx !== -1 ? args[nameIdx + 1] : resolveUserTwinName(config);
  const taskIdx = args.indexOf("--task");
  const task = taskIdx !== -1 ? args.slice(taskIdx + 1).filter((a) => !a.startsWith("--")).join(" ") : "";

  config.userTwin = twinName;
  await saveRelayConfigForHub(hub, config);

  const result = await twinRuntime.startProjectTwin({
    hub,
    projectPath,
    twinName,
    task,
  });

  printBrand();
  print(`  \x1b[32m✓\x1b[0m User twin: \x1b[1m${twinName}\x1b[0m`);
  print(`  \x1b[2m  project: ${projectName}\x1b[0m`);
  print(`  \x1b[2m  cwd:     ${projectPath}\x1b[0m`);
  print(`  \x1b[2m  runtime: ${result.record.runtime}\x1b[0m`);
  if (task) print(`  \x1b[2m  task:    ${task}\x1b[0m`);

  if (result.status === "already_running") {
    print(`  \x1b[33m!\x1b[0m Twin is already running (tmux: ${result.record.tmuxSession})`);
  } else {
    print(`  \x1b[32m✓\x1b[0m Twin started (tmux: ${result.record.tmuxSession})`);
  }

  print("");
  print(`  \x1b[2mUnaddressed TUI voice messages will route to @${twinName}.\x1b[0m`);
  print(`  \x1b[2mUse: openscout relay ask --via codex --twin ${twinName} \"status?\"\x1b[0m\n`);
}

async function relayDown() {
  const { hub } = await requireRelay();
  const twinRuntime = getProjectTwinRuntime(hub);

  const downIdx = args.indexOf("down");
  const targetName = downIdx !== -1 ? args[downIdx + 1] : undefined;

  if (!targetName) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay down <twin-name>\n");
    process.exit(1);
  }

  // Check --all flag
  if (targetName === "--all") {
    const results = await twinRuntime.stopAllProjectTwins();
    if (results.length === 0) {
      print("\n  \x1b[2mNo twins to stop.\x1b[0m\n");
      return;
    }

    printBrand();
    for (const result of results) {
      if (result.status === "stopped") {
        print(`  \x1b[32m✓\x1b[0m Stopped \x1b[1m${result.twinName}\x1b[0m`);
      } else {
        print(`  \x1b[2m○\x1b[0m ${result.twinName} was already stopped`);
      }
    }

    print("");
    return;
  }

  const result = await twinRuntime.stopProjectTwin(targetName);
  if (result.status === "not_found") {
    const twins = await twinRuntime.loadTwins();
    print(`\n  \x1b[31m✗\x1b[0m No twin named \x1b[1m${targetName}\x1b[0m.`);
    const names = Object.keys(twins);
    if (names.length > 0) {
      print(`  \x1b[2mRunning twins: ${names.join(", ")}\x1b[0m`);
    }
    print("");
    process.exit(1);
  }

  if (result.status === "stopped") {
    print(`\n  \x1b[32m✓\x1b[0m Stopped twin \x1b[1m${targetName}\x1b[0m (tmux: ${result.record?.tmuxSession ?? "unknown"})`);
  } else {
    print(`\n  \x1b[2m○\x1b[0m Twin \x1b[1m${targetName}\x1b[0m tmux session was already gone.`);
  }

  print("");
}

async function relayPs() {
  const { hub } = await requireRelay();
  const twinRuntime = getProjectTwinRuntime(hub);
  const twins = await twinRuntime.listProjectTwins();

  printBrand();
  print("  \x1b[1mTwins\x1b[0m\n");

  if (twins.length === 0) {
    print("  \x1b[2m(no twins running)\x1b[0m");
    print("  \x1b[2mSpawn one: openscout relay up ~/dev/my-project\x1b[0m\n");
    return;
  }

  for (const twin of twins) {
    const status = twin.alive ? "\x1b[32m●\x1b[0m" : "\x1b[31m✗\x1b[0m";
    print(`  ${status} \x1b[1m${twin.twinId}\x1b[0m  \x1b[2m${twin.project} · up ${formatTwinUptime(twin.uptimeSeconds)} · tmux:${twin.tmuxSession}\x1b[0m`);

    if (twin.systemPrompt) {
      const taskPreview = twin.systemPrompt.length > 60 ? twin.systemPrompt.slice(0, 60) + "…" : twin.systemPrompt;
      print(`    \x1b[2mtask: ${taskPreview}\x1b[0m`);
    }
  }
  print("");

  const removed = await twinRuntime.cleanupDeadTwins();
  if (removed.length > 0) {
    print("  \x1b[2m(cleaned up dead twins from registry)\x1b[0m\n");
  }
}

async function relayStatus() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const hub = await getGlobalRelayDir();
  const hubShort = hub.replace(os.homedir(), "~");
  const channelPath = getRelayEventsPath(hub);

  printBrand();

  // Check global hub
  try {
    await fs.access(channelPath);
    const messages = await readRelayMessages(hub);
    const msgCount = messages.filter((message) => message.type === "MSG").length;
    print(`  \x1b[32m✓\x1b[0m Hub: \x1b[1m${hubShort}/\x1b[0m  \x1b[2m(${messages.length} events, ${msgCount} messages)\x1b[0m`);
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
  print("  \x1b[1mRelay\x1b[0m — local-first agent communication\n");
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
  print("    twin <command>                 Twin-native workflow (up/view/ps/down/tick)");
  print("    enroll --as <name>             Generate enrollment prompt for an agent");
  print("    broadcast <message>            Send + nudge all tmux panes (alias: bc)\n");
  print("  \x1b[1mTwins:\x1b[0m \x1b[2m(persistent project-native runtimes)\x1b[0m");
  print("    up <path> [--name n] [--task t]  Start a twin for a project");
  print("    companion [path] [--name n]      Start or configure your user twin");
  print("    down <name>                      Stop a twin");
  print("    down --all                       Stop all twins");
  print("    ps                               List running twins");
  print("    ask --twin <name> \"<question>\"   Invoke a twin and wait for the answer");
  print("    ask --via claude ...              Route the ask via Claude Explore (Haiku)");
  print("    ask --via codex ...               Route the ask via Codex exec\n");
  print("  \x1b[1mIdentity:\x1b[0m");
  print("    --as <name>                    Set agent name for this command");
  print("    OPENSCOUT_AGENT=<name>         Set agent name via env var\n");
  print("  \x1b[1mExamples:\x1b[0m");
  print("    openscout relay init                              # first time");
  print("    openscout relay companion . --name dev            # set your user twin");
  print("    openscout relay twin up                           # infer + launch this repo twin");
  print("    openscout relay twin view                         # open the focused twin monitor");
  print("    openscout relay up ~/dev/lattices                 # spawn a twin");
  print("    openscout relay up ~/dev/arc --task \"run tests\"   # twin with a task");
  print("    openscout relay ps                                # check twins");
  print("    openscout relay send --as dev \"@lattices hey\"     # talk to a twin");
  print("    openscout relay ask --via claude --twin lattices \"what changed?\"");
  print("    openscout relay ask --via codex --twin lattices \"what changed?\"");
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
    case "twin":
      await relayTwin();
      break;
    case "up":
      await relayUp();
      break;
    case "companion":
      await relayCompanion();
      break;
    case "down":
      await relayDown();
      break;
    case "ps":
      await relayPs();
      break;
    case "ask":
      await relayAsk();
      break;
    case "twin-action":
      await relayTwinAction();
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
