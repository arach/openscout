#!/usr/bin/env node

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
  hub: string;       // the global relay directory
  logPath: string;   // hub + channel.log
  configPath: string; // hub + config.json
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
        configPath: path.join(hub, "config.json"),
      };
    }
  } catch {
    // No local link — fall through
  }

  // 2. Check global relay
  const hub = await getGlobalRelayDir();
  const logPath = path.join(hub, "channel.log");
  try {
    await fs.access(logPath);
    return { hub, logPath, configPath: path.join(hub, "config.json") };
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
      JSON.stringify({ agents: [], created: Date.now() }, null, 2) + "\n"
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
  const ts = Math.floor(Date.now() / 1000);
  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "unknown";
  await fs.appendFile(logPath, `${ts} ${projectName} SYS ${projectName} linked to the relay\n`);

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

async function relaySend() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

  // Collect message: everything after "send" that isn't --as <name>
  const sendIdx = args.indexOf("send");
  const msgParts: string[] = [];
  let i = sendIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") {
      i += 2; // skip --as and its value
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
  await fs.appendFile(logPath, `${ts} ${agent} MSG ${message}\n`);

  print(formatLine(`${ts} ${agent} MSG ${message}`));
}

async function relayRead() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

  const content = await fs.readFile(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  // --since <timestamp> filter
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx !== -1 ? Number(args[sinceIdx + 1]) : 0;

  // -n <count> or default 20
  const nIdx = args.indexOf("-n");
  const count = nIdx !== -1 ? Number(args[nIdx + 1]) : 20;

  let filtered = lines;
  if (since > 0) {
    filtered = lines.filter((l) => {
      const ts = Number(l.split(" ")[0]);
      return ts > since;
    });
  } else {
    filtered = lines.slice(-count);
  }

  if (filtered.length === 0) {
    print("\n  \x1b[2mNo messages.\x1b[0m\n");
    return;
  }

  print("");
  for (const line of filtered) {
    print(formatLine(line));
  }
  print("");
}

async function relayWatch() {
  const fs = await import("node:fs");
  const { logPath } = await requireRelay();
  const { execSync } = await import("node:child_process");

  const agent = getAgentName();
  const tmuxIdx = args.indexOf("--tmux");
  const tmuxPane = tmuxIdx !== -1 ? args[tmuxIdx + 1] : null;

  // Write join message
  const joinTs = Math.floor(Date.now() / 1000);
  fs.appendFileSync(logPath, `${joinTs} ${agent} SYS ${agent} joined the relay\n`);

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
    const leaveTs = Math.floor(Date.now() / 1000);
    fs.appendFileSync(logPath, `${leaveTs} ${agent} SYS ${agent} left the relay\n`);
    print(`\n  \x1b[2m${agent} left the relay\x1b[0m\n`);
    process.exit(0);
  });
}

async function relayWho() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

  const content = await fs.readFile(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const now = Math.floor(Date.now() / 1000);
  const ONLINE_THRESHOLD = 600; // 10 minutes

  // Build agent map
  const agents = new Map<string, { lastSeen: number; messages: number; forgotten: boolean }>();

  for (const line of lines) {
    const parts = line.split(" ");
    const [ts, from, type, ...rest] = parts;
    const timestamp = Number(ts);
    const body = rest.join(" ");

    if (!agents.has(from)) {
      agents.set(from, { lastSeen: timestamp, messages: 0, forgotten: false });
    }
    const agent = agents.get(from)!;
    agent.lastSeen = Math.max(agent.lastSeen, timestamp);

    if (type === "MSG") agent.messages++;
    if (type === "SYS" && body.includes("forgotten")) agent.forgotten = true;
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
  const { logPath } = await requireRelay();

  // Get agent name to forget from args after "forget"
  const forgetIdx = args.indexOf("forget");
  const targetName = forgetIdx !== -1 ? args[forgetIdx + 1] : undefined;

  if (!targetName) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay forget <agent-name>\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${targetName} SYS ${targetName} forgotten by ${agent}\n`);

  print(`\n  \x1b[32m✓\x1b[0m Removed \x1b[1m${targetName}\x1b[0m from the relay.\n`);
}

async function relayEnroll() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

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
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${agent} SYS ${agent} enrolled via relay enroll\n`);

  print(`  \x1b[32m✓\x1b[0m Wrote enrollment event to channel.log\n`);
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
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${projectName} SYS ${projectName} linked to the relay\n`);

  printBrand();
  print(`  \x1b[32m✓\x1b[0m Linked \x1b[1m${projectName}\x1b[0m → \x1b[1m${hubShort}/\x1b[0m\n`);
  print("  Agents in this directory now share the global relay channel.");
  print("  Run \x1b[1mopenscout relay read\x1b[0m to see messages from all projects.\n");
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
  print("    read                           Print recent messages (last 20)");
  print("    read --since <timestamp>       Messages after a unix timestamp");
  print("    read -n <count>                Show last N messages");
  print("    watch                          Stream new messages as they arrive");
  print("    watch --tmux <pane>            Stream + nudge a tmux pane on new messages");
  print("    who                            List agents and their last activity");
  print("    forget <name>                  Remove a stale agent from the list");
  print("    tui                            Open the relay monitor dashboard");
  print("    enroll --as <name>             Generate enrollment prompt for an agent\n");
  print("  \x1b[1mIdentity:\x1b[0m");
  print("    --as <name>                    Set agent name for this command");
  print("    OPENSCOUT_AGENT=<name>         Set agent name via env var\n");
  print("  \x1b[1mExamples:\x1b[0m");
  print("    openscout relay init                              # first time");
  print("    cd ~/dev/other-project && openscout relay link    # link another project");
  print("    openscout relay send --as agent-a \"Updated types\"");
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
    case "link":
      await relayLink();
      break;
    case "status":
      await relayStatus();
      break;
    case "tui": {
      const { execSync } = await import("node:child_process");
      const path = await import("node:path");
      const tuiPath = path.join(import.meta.dirname, "..", "src", "tui", "index.tsx");
      try {
        execSync(`bun run ${tuiPath}`, { stdio: "inherit", cwd: process.cwd() });
      } catch {
        // TUI exited — normal
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
