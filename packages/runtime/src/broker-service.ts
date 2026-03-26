import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BrokerServiceMode = "dev" | "prod" | "custom";

export type BrokerServiceConfig = {
  label: string;
  mode: BrokerServiceMode;
  uid: number;
  domainTarget: string;
  serviceTarget: string;
  launchAgentPath: string;
  supportDirectory: string;
  logsDirectory: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  controlHome: string;
  runtimePackageDir: string;
  bunExecutable: string;
  brokerHost: string;
  brokerPort: number;
  brokerUrl: string;
};

export type BrokerHealthSnapshot = {
  reachable: boolean;
  ok: boolean;
  nodeId?: string;
  meshId?: string;
  counts?: {
    nodes: number;
    actors: number;
    agents: number;
    conversations: number;
    messages: number;
    flights: number;
  };
  error?: string;
};

export type BrokerServiceStatus = {
  label: string;
  mode: BrokerServiceMode;
  launchAgentPath: string;
  brokerUrl: string;
  supportDirectory: string;
  controlHome: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  installed: boolean;
  loaded: boolean;
  pid: number | null;
  launchdState: string | null;
  lastExitStatus: number | null;
  usesLaunchAgent: boolean;
  reachable: boolean;
  health: BrokerHealthSnapshot;
  lastLogLine: string | null;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type LaunchctlStatus = {
  loaded: boolean;
  pid: number | null;
  launchdState: string | null;
  lastExitStatus: number | null;
  raw: string;
};

function runtimePackageDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function resolveBunExecutable(): string {
  const explicit = process.env.OPENSCOUT_BUN_BIN ?? process.env.BUN_BIN;
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }

  if (basename(process.execPath).startsWith("bun")) {
    return process.execPath;
  }

  return "bun";
}

function resolveBrokerServiceMode(): BrokerServiceMode {
  const explicit = (process.env.OPENSCOUT_BROKER_SERVICE_MODE ?? "").trim().toLowerCase();
  if (explicit === "prod" || explicit === "production") {
    return "prod";
  }
  if (explicit === "custom") {
    return "custom";
  }
  return "dev";
}

function resolveBrokerServiceLabel(mode: BrokerServiceMode): string {
  const explicit = process.env.OPENSCOUT_BROKER_SERVICE_LABEL?.trim();
  if (explicit) {
    return explicit;
  }

  switch (mode) {
    case "prod":
      return "com.openscout.broker";
    case "custom":
      return "com.openscout.broker.custom";
    case "dev":
    default:
      return "dev.openscout.broker";
  }
}

export function resolveBrokerServiceConfig(): BrokerServiceConfig {
  const mode = resolveBrokerServiceMode();
  const label = resolveBrokerServiceLabel(mode);
  const uid = typeof process.getuid === "function" ? process.getuid() : Number.parseInt(process.env.UID ?? "0", 10);
  const supportDirectory = join(homedir(), "Library", "Application Support", "OpenScout");
  const logsDirectory = join(supportDirectory, "logs");
  const controlHome = process.env.OPENSCOUT_CONTROL_HOME ?? join(homedir(), ".openscout", "control-plane");
  const brokerHost = process.env.OPENSCOUT_BROKER_HOST ?? "127.0.0.1";
  const brokerPort = Number.parseInt(process.env.OPENSCOUT_BROKER_PORT ?? "65535", 10);
  const brokerUrl = process.env.OPENSCOUT_BROKER_URL ?? `http://${brokerHost}:${brokerPort}`;
  const launchAgentPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);

  return {
    label,
    mode,
    uid,
    domainTarget: `gui/${uid}`,
    serviceTarget: `gui/${uid}/${label}`,
    launchAgentPath,
    supportDirectory,
    logsDirectory,
    stdoutLogPath: join(logsDirectory, "broker.stdout.log"),
    stderrLogPath: join(logsDirectory, "broker.stderr.log"),
    controlHome,
    runtimePackageDir: runtimePackageDir(),
    bunExecutable: resolveBunExecutable(),
    brokerHost,
    brokerPort,
    brokerUrl,
  };
}

export function renderLaunchAgentPlist(config: BrokerServiceConfig): string {
  const launchPath = resolveLaunchAgentPATH();
  const envEntries = {
    OPENSCOUT_BROKER_HOST: config.brokerHost,
    OPENSCOUT_BROKER_PORT: String(config.brokerPort),
    OPENSCOUT_BROKER_URL: config.brokerUrl,
    OPENSCOUT_CONTROL_HOME: config.controlHome,
    OPENSCOUT_BROKER_SERVICE_MODE: config.mode,
    OPENSCOUT_BROKER_SERVICE_LABEL: config.label,
    HOME: homedir(),
    PATH: launchPath,
  };

  const envBlock = Object.entries(envEntries)
    .map(([key, value]) => `\n    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(config.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(config.bunExecutable)}</string>
    <string>run</string>
    <string>--cwd</string>
    <string>${xmlEscape(config.runtimePackageDir)}</string>
    <string>broker</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(config.runtimePackageDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(config.stdoutLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(config.stderrLogPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>${envBlock}
  </dict>
</dict>
</plist>
`;
}

function resolveLaunchAgentPATH(): string {
  const entries = [
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];

  return Array.from(new Set(entries)).join(":");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function ensureServiceDirectories(config: BrokerServiceConfig): void {
  mkdirSync(config.supportDirectory, { recursive: true });
  mkdirSync(config.logsDirectory, { recursive: true });
  mkdirSync(config.controlHome, { recursive: true });
  ensureParentDirectory(config.launchAgentPath);
}

function writeLaunchAgentPlist(config: BrokerServiceConfig): void {
  ensureServiceDirectories(config);
  writeFileSync(config.launchAgentPath, renderLaunchAgentPlist(config), "utf8");
}

function runCommand(command: string, args: string[], options?: { allowFailure?: boolean; env?: Record<string, string> }): CommandResult {
  const result = spawnSync(command, args, {
    env: {
      ...process.env,
      ...(options?.env ?? {}),
    },
    encoding: "utf8",
  });

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  const exitCode = result.status ?? 1;

  if (exitCode !== 0 && !options?.allowFailure) {
    throw new Error(stderr || stdout || `${command} exited with status ${exitCode}`);
  }

  return { exitCode, stdout, stderr };
}

function launchctlPath(): string {
  return "/bin/launchctl";
}

function readLastLogLine(paths: string[]): string | null {
  for (const path of paths) {
    if (!existsSync(path)) {
      continue;
    }

    const lines = readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      return lines.at(-1) ?? null;
    }
  }

  return null;
}

export function parseLaunchctlPrint(output: string): Omit<LaunchctlStatus, "loaded" | "raw"> {
  const pidMatch = output.match(/\bpid = (\d+)/);
  const stateMatch = output.match(/\bstate = ([^\n]+)/);
  const lastExitMatch = output.match(/\blast exit code = (-?\d+)/i) || output.match(/\blast exit status = (-?\d+)/i);

  return {
    pid: pidMatch ? Number.parseInt(pidMatch[1] ?? "0", 10) : null,
    launchdState: stateMatch?.[1]?.trim() ?? null,
    lastExitStatus: lastExitMatch ? Number.parseInt(lastExitMatch[1] ?? "0", 10) : null,
  };
}

function inspectLaunchctl(config: BrokerServiceConfig): LaunchctlStatus {
  const printResult = runCommand(launchctlPath(), ["print", config.serviceTarget], { allowFailure: true });
  if (printResult.exitCode !== 0) {
    return {
      loaded: false,
      pid: null,
      launchdState: null,
      lastExitStatus: null,
      raw: printResult.stderr || printResult.stdout,
    };
  }

  return {
    loaded: true,
    raw: printResult.stdout,
    ...parseLaunchctlPrint(printResult.stdout),
  };
}

async function fetchHealthSnapshot(config: BrokerServiceConfig): Promise<BrokerHealthSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(new URL("/health", config.brokerUrl), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return {
        reachable: false,
        ok: false,
        error: `health returned ${response.status}`,
      };
    }

    const payload = await response.json() as BrokerHealthSnapshot & { ok: boolean };
    return {
      reachable: true,
      ok: Boolean(payload.ok),
      nodeId: payload.nodeId,
      meshId: payload.meshId,
      counts: payload.counts,
    };
  } catch (error) {
    return {
      reachable: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function brokerServiceStatus(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  ensureServiceDirectories(config);
  const launchctl = inspectLaunchctl(config);
  const health = await fetchHealthSnapshot(config);
  const installed = existsSync(config.launchAgentPath);
  const lastLogLine = readLastLogLine([config.stderrLogPath, config.stdoutLogPath]);

  return {
    label: config.label,
    mode: config.mode,
    launchAgentPath: config.launchAgentPath,
    brokerUrl: config.brokerUrl,
    supportDirectory: config.supportDirectory,
    controlHome: config.controlHome,
    stdoutLogPath: config.stdoutLogPath,
    stderrLogPath: config.stderrLogPath,
    installed,
    loaded: launchctl.loaded,
    pid: launchctl.pid,
    launchdState: launchctl.launchdState,
    lastExitStatus: launchctl.lastExitStatus,
    usesLaunchAgent: installed || launchctl.loaded,
    reachable: health.reachable,
    health,
    lastLogLine,
  };
}

export async function installBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  writeLaunchAgentPlist(config);
  return brokerServiceStatus(config);
}

export async function startBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  writeLaunchAgentPlist(config);
  runCommand(launchctlPath(), ["bootout", config.serviceTarget], { allowFailure: true });
  runCommand(launchctlPath(), ["bootstrap", config.domainTarget, config.launchAgentPath], { allowFailure: true });
  runCommand(launchctlPath(), ["kickstart", "-k", config.serviceTarget], { allowFailure: true });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await brokerServiceStatus(config);
    if (status.health.reachable) {
      return status;
    }
    await sleep(100);
  }

  const status = await brokerServiceStatus(config);
  throw new Error(status.lastLogLine ?? status.health.error ?? "Broker service did not become healthy.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stopBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  runCommand(launchctlPath(), ["bootout", config.serviceTarget], { allowFailure: true });
  return brokerServiceStatus(config);
}

export async function restartBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  await stopBrokerService(config);
  return startBrokerService(config);
}

export async function uninstallBrokerService(config: BrokerServiceConfig = resolveBrokerServiceConfig()): Promise<BrokerServiceStatus> {
  await stopBrokerService(config);
  if (existsSync(config.launchAgentPath)) {
    rmSync(config.launchAgentPath, { force: true });
  }
  return brokerServiceStatus(config);
}

async function main() {
  const command = process.argv[2] ?? "status";
  const json = process.argv.includes("--json");
  const config = resolveBrokerServiceConfig();

  let status: BrokerServiceStatus;
  switch (command) {
    case "install":
      status = await installBrokerService(config);
      break;
    case "start":
      status = await startBrokerService(config);
      break;
    case "stop":
      status = await stopBrokerService(config);
      break;
    case "restart":
      status = await restartBrokerService(config);
      break;
    case "uninstall":
      status = await uninstallBrokerService(config);
      break;
    case "status":
      status = await brokerServiceStatus(config);
      break;
    default:
      console.error(`Unknown broker service command: ${command}`);
      process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(formatBrokerServiceStatus(status));
}

function formatBrokerServiceStatus(status: BrokerServiceStatus): string {
  const lines = [
    `label: ${status.label}`,
    `mode: ${status.mode}`,
    `launch agent: ${status.installed ? status.launchAgentPath : "not installed"}`,
    `loaded: ${status.loaded ? "yes" : "no"}`,
    `pid: ${status.pid ?? "—"}`,
    `launchd state: ${status.launchdState ?? "—"}`,
    `broker url: ${status.brokerUrl}`,
    `reachable: ${status.reachable ? "yes" : "no"}`,
    `health: ${status.health.ok ? "ok" : status.health.error ?? "unreachable"}`,
    `logs: ${status.stdoutLogPath}`,
  ];

  if (status.lastLogLine) {
    lines.push(`last log: ${status.lastLogLine}`);
  }

  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
