import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  formatAgentSelector,
  parseAgentSelector,
  normalizeAgentSelectorSegment,
  resolveAgentSelector,
  type AgentSelector,
  type AgentSelectorCandidate,
  type AgentCapability,
  type AgentHarness,
} from "@openscout/protocol";

import { ensureHarnessCatalogOverrideFile } from "./harness-catalog.js";
import { ensureOpenScoutCleanSlateSync, resolveOpenScoutSupportPaths } from "./support-paths.js";

export type RelayRuntimeTransport = "claude_stream_json" | "codex_app_server" | "tmux";
export type TelegramBridgeMode = "auto" | "webhook" | "polling";
export const SCOUT_AGENT_ID = "scout";
export const SCOUT_PRIMARY_CONVERSATION_ID = "dm.scout.primary";
export const MANAGED_AGENT_HARNESSES = ["claude", "codex"] as const;
export type ManagedAgentHarness = typeof MANAGED_AGENT_HARNESSES[number];

export type RelayHarnessProfile = {
  cwd: string;
  transport: RelayRuntimeTransport;
  sessionId: string;
  launchArgs: string[];
};

export type RelayHarnessProfiles = Partial<Record<ManagedAgentHarness, RelayHarnessProfile>>;

export type RelayHarnessProfileInput = {
  cwd?: string;
  transport?: RelayRuntimeTransport;
  sessionId?: string;
  launchArgs?: string[];
};

export type OpenScoutProjectConfig = {
  version: 1;
  project: {
    id: string;
    name: string;
    root?: string;
  };
  agent?: {
    id?: string;
    displayName?: string;
    prompt?: {
      template?: string;
    };
    runtime?: {
      defaultHarness?: AgentHarness;
      profiles?: Partial<Record<ManagedAgentHarness, RelayHarnessProfileInput>>;
      defaults?: {
        cwd?: string;
        harness?: AgentHarness;
        transport?: RelayRuntimeTransport;
        sessionId?: string;
        launchArgs?: string[];
        capabilities?: AgentCapability[];
      };
    };
  };
};

export type OpenScoutSettings = {
  version: 1;
  profile: {
    operatorName: string;
  };
  onboarding: {
    operatorAnsweredAt: number | null;
    sourceRootsAnsweredAt: number | null;
    harnessChosenAt: number | null;
    inputsSavedAt: number | null;
    initRanAt: number | null;
    doctorRanAt: number | null;
    runtimesRanAt: number | null;
    completedAt: number | null;
    skippedAt: number | null;
  };
  discovery: {
    contextRoot: string | null;
    workspaceRoots: string[];
    includeCurrentRepo: boolean;
  };
  agents: {
    defaultHarness: AgentHarness;
    defaultTransport: RelayRuntimeTransport;
    defaultCapabilities: AgentCapability[];
    sessionPrefix: string;
  };
  bridges: {
    telegram: {
      enabled: boolean;
      mode: TelegramBridgeMode;
      botToken: string;
      secretToken: string;
      apiBaseUrl: string;
      userName: string;
      defaultConversationId: string;
      ownerNodeId: string;
    };
  };
  phone: {
    favorites: string[];
    quickHits: string[];
    preparedAt: number | null;
  };
};

export type RelayAgentOverride = {
  agentId: string;
  definitionId?: string;
  displayName?: string;
  projectName?: string;
  projectRoot: string;
  projectConfigPath?: string | null;
  source?: "manifest" | "inferred" | "legacy-import" | "manual";
  startedAt?: number;
  systemPrompt?: string;
  launchArgs?: string[];
  capabilities?: AgentCapability[];
  defaultHarness?: AgentHarness;
  harnessProfiles?: Partial<Record<ManagedAgentHarness, RelayHarnessProfileInput>>;
  runtime?: {
    cwd?: string;
    harness?: AgentHarness;
    transport?: RelayRuntimeTransport;
    sessionId?: string;
    wakePolicy?: "on_demand";
  };
};

export type ResolvedRelayAgentConfig = {
  agentId: string;
  definitionId: string;
  displayName: string;
  projectName: string;
  projectRoot: string;
  projectConfigPath: string | null;
  source: "manifest" | "inferred" | "legacy-import" | "manual";
  registrationKind: "configured" | "discovered";
  startedAt: number;
  systemPrompt?: string;
  launchArgs: string[];
  capabilities: AgentCapability[];
  defaultHarness: ManagedAgentHarness;
  harnessProfiles: RelayHarnessProfiles;
  instance: {
    id: string;
    selector: string;
    defaultSelector: string;
    nodeQualifier: string;
    workspaceQualifier: string;
    branch: string | null;
    isDefault: true;
  };
  runtime: {
    cwd: string;
    harness: AgentHarness;
    transport: RelayRuntimeTransport;
    sessionId: string;
    wakePolicy: "on_demand";
  };
};

export type ProjectInventoryHarnessEvidence = {
  harness: ManagedAgentHarness;
  source: "manifest" | "marker" | "default";
  detail: string;
};

export type ProjectInventoryEntry = {
  agentId: string;
  definitionId: string;
  displayName: string;
  projectName: string;
  projectRoot: string;
  sourceRoot: string;
  relativePath: string;
  source: ResolvedRelayAgentConfig["source"];
  registrationKind: ResolvedRelayAgentConfig["registrationKind"];
  projectConfigPath: string | null;
  defaultHarness: ManagedAgentHarness;
  harnesses: ProjectInventoryHarnessEvidence[];
};

export type SetupResult = {
  supportDirectory: string;
  settingsPath: string;
  harnessCatalogPath: string;
  relayAgentsPath: string;
  relayHubPath: string;
  currentProjectConfigPath: string | null;
  createdProjectConfig: boolean;
  settings: OpenScoutSettings;
  agents: ResolvedRelayAgentConfig[];
  discoveredAgents: ResolvedRelayAgentConfig[];
  projectInventory: ProjectInventoryEntry[];
};

export type UpdateOpenScoutSettingsInput = {
  profile?: Partial<OpenScoutSettings["profile"]>;
  onboarding?: Partial<OpenScoutSettings["onboarding"]>;
  discovery?: Partial<OpenScoutSettings["discovery"]>;
  agents?: Partial<OpenScoutSettings["agents"]>;
  bridges?: {
    telegram?: Partial<OpenScoutSettings["bridges"]["telegram"]>;
  };
  phone?: Partial<OpenScoutSettings["phone"]>;
};

type LegacyRelayConfig = {
  projectRoot?: string;
};

type LegacyAgentRecord = {
  project?: string;
  tmuxSession?: string;
  cwd?: string;
  startedAt?: number;
  systemPrompt?: string;
  harness?: AgentHarness;
  transport?: RelayRuntimeTransport;
  capabilities?: AgentCapability[];
  launchArgs?: string[];
};

type LegacyRelayAgentRecord = {
  cwd?: string;
  project?: string;
  session?: string;
};

function titleCaseWords(value: string): string {
  return value
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function guessedOperatorName(): string {
  const seeded = process.env.OPENSCOUT_OPERATOR_NAME?.trim();
  if (seeded) {
    return seeded;
  }

  const candidates = [
    process.env.OPENSCOUT_OPERATOR_DISPLAY_NAME,
    process.env.USER,
    process.env.LOGNAME,
    process.env.USERNAME,
  ];

  try {
    candidates.push(userInfo().username);
  } catch {
    // Ignore OS user lookup failures and fall through to a neutral default.
  }

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = titleCaseWords(trimmed);
    if (normalized) {
      return normalized;
    }
  }

  return "Operator";
}

export const DEFAULT_OPERATOR_NAME = guessedOperatorName();
const DEFAULT_CAPABILITIES: AgentCapability[] = ["chat", "invoke", "deliver"];
const DEFAULT_TRANSPORT: RelayRuntimeTransport = "claude_stream_json";
const DEFAULT_TELEGRAM_MODE: TelegramBridgeMode = "polling";
const LEGACY_DEFAULT_TELEGRAM_CONVERSATION_ID = "channel.shared";
const DEFAULT_TELEGRAM_CONVERSATION_ID = SCOUT_PRIMARY_CONVERSATION_ID;
const SETTINGS_VERSION = 1;
const PROJECT_CONFIG_VERSION = 1;
const BUILT_IN_AGENT_IDS = new Set(["scout", "builder", "reviewer", "research"]);
const PROJECT_SCAN_SKIP_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  ".turbo",
  ".next",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "Pods",
  ".venv",
  "venv",
]);
const PROJECT_STRONG_MARKERS = [
  ".openscout/project.json",
  ".git",
] as const;
const PROJECT_WEAK_MARKERS = [
  "AGENTS.md",
  "CLAUDE.md",
] as const;
const PROJECT_HARNESS_MARKERS: Record<ManagedAgentHarness, readonly string[]> = {
  claude: ["CLAUDE.md", ".claude"],
  codex: ["AGENTS.md", ".codex"],
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function compactHomePath(value: string): string {
  const home = homedir();
  return value.startsWith(home) ? value.replace(home, "~") : value;
}

function normalizePath(value: string): string {
  return resolve(expandHomePath(value.trim() || "."));
}

function uniquePaths(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => normalizePath(value))));
}

function normalizeAgentId(value: string): string {
  return normalizeAgentSelectorSegment(value);
}

function normalizeManagedHarness(
  value: string | undefined,
  fallback: ManagedAgentHarness,
): ManagedAgentHarness {
  if (value === "codex") {
    return "codex";
  }
  if (value === "claude") {
    return "claude";
  }
  return fallback;
}

function titleCase(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizeSessionPrefix(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return trimmed || "relay";
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean),
  ));
}

function normalizeOptionalTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.floor(value);
}

function readEnvFileValue(filePath: string, key: string): string {
  try {
    const raw = execFileSync("sh", ["-lc", `test -f ${JSON.stringify(filePath)} && cat ${JSON.stringify(filePath)} || true`], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      if (!normalized.startsWith(`${key}=`)) continue;

      let value = normalized.slice(key.length + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    return "";
  }

  return "";
}

function resolveTelegramConfigSeedValue(
  key: string,
  currentDirectory?: string,
): string {
  const envValue = process.env[key]?.trim();
  if (envValue) {
    return envValue;
  }

  if (currentDirectory) {
    const currentDirValue = readEnvFileValue(join(currentDirectory, ".env.local"), key).trim();
    if (currentDirValue) {
      return currentDirValue;
    }
  }

  const home = homedir();
  if (!home) {
    return "";
  }

  return readEnvFileValue(join(home, ".env.local"), key).trim();
}

function normalizeTelegramBridgeMode(value: unknown): TelegramBridgeMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "auto":
    case "webhook":
    case "polling":
      return normalized as TelegramBridgeMode;
    default:
      return DEFAULT_TELEGRAM_MODE;
  }
}

function normalizeTelegramConversationId(value: unknown): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized || normalized === LEGACY_DEFAULT_TELEGRAM_CONVERSATION_ID) {
    return DEFAULT_TELEGRAM_CONVERSATION_ID;
  }

  return normalized;
}

export function primaryDirectConversationIdForAgent(agentId: string): string {
  const normalizedAgentId = normalizeAgentId(agentId);
  if (normalizedAgentId === SCOUT_AGENT_ID) {
    return SCOUT_PRIMARY_CONVERSATION_ID;
  }

  return `dm.operator.${normalizedAgentId}`;
}

function resolveNodeQualifier(): string {
  return normalizeAgentSelectorSegment(
    process.env.OPENSCOUT_NODE_QUALIFIER?.trim()
    || hostname()
    || "local",
  ) || "local";
}

function detectGitBranch(projectRoot: string): string | null {
  try {
    const branch = execFileSync(
      "git",
      ["-C", projectRoot, "rev-parse", "--abbrev-ref", "HEAD"],
      { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" },
    ).trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

function resolveWorkspaceQualifier(projectRoot: string): { workspaceQualifier: string; branch: string | null } {
  const branch = detectGitBranch(projectRoot);
  const workspaceQualifier = normalizeAgentSelectorSegment(branch || basename(projectRoot) || "workspace");
  return {
    workspaceQualifier: workspaceQualifier || "workspace",
    branch,
  };
}

export function buildRelayAgentInstance(agentId: string, projectRoot: string): ResolvedRelayAgentConfig["instance"] {
  const nodeQualifier = resolveNodeQualifier();
  const { workspaceQualifier, branch } = resolveWorkspaceQualifier(projectRoot);
  return {
    id: [agentId, nodeQualifier, workspaceQualifier].filter(Boolean).join("."),
    selector: formatAgentSelector({ definitionId: agentId, nodeQualifier, workspaceQualifier }),
    defaultSelector: formatAgentSelector({ definitionId: agentId }),
    nodeQualifier,
    workspaceQualifier,
    branch,
    isDefault: true,
  };
}

function normalizeTmuxSessionName(value: string | undefined, fallbackId: string, prefix = "relay"): string {
  const trimmed = (value ?? "").trim();
  const normalized = trimmed.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || `${normalizeSessionPrefix(prefix)}-${fallbackId}`;
}

function normalizeCapabilities(value: unknown): AgentCapability[] {
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

  const normalized = Array.isArray(value)
    ? Array.from(new Set(value.map((entry) => String(entry).trim()).filter((entry): entry is AgentCapability => allowed.has(entry as AgentCapability))))
    : [];

  return normalized.length > 0 ? normalized : [...DEFAULT_CAPABILITIES];
}

function normalizeHarness(value: string | undefined, fallback: AgentHarness): AgentHarness {
  return value === "codex" ? "codex" : value === "claude" ? "claude" : fallback;
}

function normalizeTransport(
  value: string | undefined,
  harness: AgentHarness,
  fallback: RelayRuntimeTransport,
): RelayRuntimeTransport {
  if (harness === "codex") {
    return "codex_app_server";
  }

  if (value === "claude_stream_json") {
    return "claude_stream_json";
  }

  if (value === "codex_app_server") {
    return "codex_app_server";
  }

  return fallback === "codex_app_server" ? "claude_stream_json" : fallback;
}

function normalizeHarnessProfile(
  profile: RelayHarnessProfileInput | undefined,
  harness: ManagedAgentHarness,
  options: {
    projectRoot: string;
    sessionKey: string;
    sessionPrefix: string;
    fallbackLaunchArgs?: string[];
  },
): RelayHarnessProfile {
  return {
    cwd: profile?.cwd ? normalizePath(profile.cwd) : options.projectRoot,
    transport: normalizeTransport(profile?.transport, harness, harness === "codex" ? "codex_app_server" : DEFAULT_TRANSPORT),
    sessionId: normalizeTmuxSessionName(
      profile?.sessionId,
      `${options.sessionKey}-${harness}`,
      options.sessionPrefix,
    ),
    launchArgs: normalizeLaunchArgs(profile?.launchArgs ?? options.fallbackLaunchArgs),
  };
}

function buildHarnessProfiles(input: {
  projectRoot: string;
  sessionKey: string;
  sessionPrefix: string;
  defaultHarness: ManagedAgentHarness;
  profiles?: Partial<Record<ManagedAgentHarness, RelayHarnessProfileInput>>;
  runtime?: {
    cwd?: string;
    harness?: AgentHarness;
    transport?: RelayRuntimeTransport;
    sessionId?: string;
  };
  launchArgs?: string[];
}): RelayHarnessProfiles {
  const profiles: RelayHarnessProfiles = {};
  const runtimeHarness = normalizeManagedHarness(
    typeof input.runtime === "object" && input.runtime && "harness" in input.runtime
      ? String((input.runtime as { harness?: string }).harness)
      : undefined,
    input.defaultHarness,
  );

  if (input.runtime || (input.launchArgs ?? []).length > 0) {
    profiles[runtimeHarness] = normalizeHarnessProfile({
      cwd: typeof input.runtime === "object" && input.runtime && "cwd" in input.runtime
        ? (input.runtime as { cwd?: string }).cwd
        : undefined,
      transport: typeof input.runtime === "object" && input.runtime && "transport" in input.runtime
        ? (input.runtime as { transport?: RelayRuntimeTransport }).transport
        : undefined,
      sessionId: typeof input.runtime === "object" && input.runtime && "sessionId" in input.runtime
        ? (input.runtime as { sessionId?: string }).sessionId
        : undefined,
      launchArgs: input.launchArgs,
    }, runtimeHarness, {
      projectRoot: input.projectRoot,
      sessionKey: input.sessionKey,
      sessionPrefix: input.sessionPrefix,
      fallbackLaunchArgs: input.launchArgs,
    });
  }

  for (const harness of MANAGED_AGENT_HARNESSES) {
    const profile = input.profiles?.[harness];
    if (!profile && profiles[harness]) {
      continue;
    }
    if (profile) {
      profiles[harness] = normalizeHarnessProfile(profile, harness, {
        projectRoot: input.projectRoot,
        sessionKey: input.sessionKey,
        sessionPrefix: input.sessionPrefix,
        fallbackLaunchArgs: profiles[harness]?.launchArgs ?? input.launchArgs,
      });
    }
  }

  const ensuredHarness = profiles[input.defaultHarness]
    ?? normalizeHarnessProfile(undefined, input.defaultHarness, {
      projectRoot: input.projectRoot,
      sessionKey: input.sessionKey,
      sessionPrefix: input.sessionPrefix,
      fallbackLaunchArgs: input.launchArgs,
    });
  profiles[input.defaultHarness] = ensuredHarness;

  return profiles;
}

function resolvedRuntimeView(
  defaultHarness: ManagedAgentHarness,
  harnessProfiles: RelayHarnessProfiles,
): { runtime: ResolvedRelayAgentConfig["runtime"]; launchArgs: string[] } {
  const profile = harnessProfiles[defaultHarness];
  if (!profile) {
    throw new Error(`missing harness profile for ${defaultHarness}`);
  }

  return {
    runtime: {
      cwd: profile.cwd,
      harness: defaultHarness,
      transport: profile.transport,
      sessionId: profile.sessionId,
      wakePolicy: "on_demand",
    },
    launchArgs: [...profile.launchArgs],
  };
}

function normalizeLaunchArgs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
}

function hasCustomCapabilities(value: unknown, defaults: AgentCapability[]): boolean {
  const normalized = normalizeCapabilities(value);
  return normalized.join("\n") !== normalizeCapabilities(defaults).join("\n");
}

function tmuxSessionExists(sessionId: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionId], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function isConfiguredRelayAgentOverride(
  agentId: string,
  override: RelayAgentOverride | undefined,
  settings: OpenScoutSettings,
): boolean {
  if (!override?.source || override.source === "inferred") {
    return false;
  }

  if (override.source !== "legacy-import") {
    return true;
  }

  if (override.systemPrompt?.trim()) {
    return true;
  }

  if (normalizeLaunchArgs(override.launchArgs).length > 0) {
    return true;
  }

  if (hasCustomCapabilities(override.capabilities, settings.agents.defaultCapabilities)) {
    return true;
  }

  return tmuxSessionExists(
    normalizeTmuxSessionName(
      override.runtime?.sessionId,
      agentId,
      settings.agents.sessionPrefix,
    ),
  );
}

function defaultSettings(): OpenScoutSettings {
  const seededBotToken = resolveTelegramConfigSeedValue("TELEGRAM_BOT_TOKEN");
  return {
    version: SETTINGS_VERSION,
    profile: {
      operatorName: DEFAULT_OPERATOR_NAME,
    },
    onboarding: {
      operatorAnsweredAt: null,
      sourceRootsAnsweredAt: null,
      harnessChosenAt: null,
      inputsSavedAt: null,
      initRanAt: null,
      doctorRanAt: null,
      runtimesRanAt: null,
      completedAt: null,
      skippedAt: null,
    },
    discovery: {
      contextRoot: null,
      workspaceRoots: [],
      includeCurrentRepo: true,
    },
    agents: {
      defaultHarness: "claude",
      defaultTransport: DEFAULT_TRANSPORT,
      defaultCapabilities: [...DEFAULT_CAPABILITIES],
      sessionPrefix: "relay",
    },
    bridges: {
      telegram: {
        enabled: Boolean(seededBotToken),
        mode: DEFAULT_TELEGRAM_MODE,
        botToken: seededBotToken,
        secretToken: resolveTelegramConfigSeedValue("TELEGRAM_WEBHOOK_SECRET_TOKEN"),
        apiBaseUrl: resolveTelegramConfigSeedValue("TELEGRAM_API_BASE_URL"),
        userName: resolveTelegramConfigSeedValue("TELEGRAM_BOT_USERNAME"),
        defaultConversationId: DEFAULT_TELEGRAM_CONVERSATION_ID,
        ownerNodeId: "",
      },
    },
    phone: {
      favorites: [],
      quickHits: [],
      preparedAt: null,
    },
  };
}

function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".openscout", "project.json");
}

function projectGitignorePath(projectRoot: string): string {
  return join(projectRoot, ".gitignore");
}

function legacyLocalRelayLinkPath(projectRoot: string): string {
  return join(projectRoot, ".openscout", "relay.json");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isDirectory();
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function ensureProjectConfigIgnored(projectRoot: string): Promise<void> {
  const gitignorePath = projectGitignorePath(projectRoot);
  const ignoreRule = ".openscout/project.json";
  const comment = "# OpenScout local state";

  let current = "";
  try {
    current = await readFile(gitignorePath, "utf8");
  } catch {
    current = "";
  }

  const lines = current.split(/\r?\n/g);
  if (lines.some((line) => line.trim() === ignoreRule)) {
    return;
  }

  const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  const header = lines.some((line) => line.trim() === comment) ? "" : `${comment}\n`;
  await writeFile(gitignorePath, `${current}${separator}${header}${ignoreRule}\n`, "utf8");
}

async function readLegacyRelayConfig(): Promise<LegacyRelayConfig | null> {
  const relayHub = resolveOpenScoutSupportPaths().relayHubDirectory;
  return readJsonFile<LegacyRelayConfig>(join(relayHub, "config.json"));
}

async function readLegacyAgentRegistry(): Promise<Record<string, LegacyAgentRecord>> {
  const relayHub = resolveOpenScoutSupportPaths().relayHubDirectory;
  return (await readJsonFile<Record<string, LegacyAgentRecord>>(join(relayHub, "agents.json"))) ?? {};
}

async function readLegacyRelayAgentsRegistry(): Promise<Record<string, LegacyRelayAgentRecord>> {
  const relayHub = resolveOpenScoutSupportPaths().relayHubDirectory;
  return (await readJsonFile<Record<string, LegacyRelayAgentRecord>>(join(relayHub, "agents.json"))) ?? {};
}

async function detectHarnessMarkers(projectRoot: string): Promise<Record<ManagedAgentHarness, string[]>> {
  const detected: Record<ManagedAgentHarness, string[]> = {
    claude: [],
    codex: [],
  };

  for (const harness of MANAGED_AGENT_HARNESSES) {
    for (const marker of PROJECT_HARNESS_MARKERS[harness]) {
      if (await pathExists(join(projectRoot, marker))) {
        detected[harness].push(marker);
      }
    }
  }

  return detected;
}

export async function detectPreferredHarness(projectRoot: string, fallback: AgentHarness = "claude"): Promise<AgentHarness> {
  const markers = await detectHarnessMarkers(projectRoot);
  const hasClaude = markers.claude.length > 0;
  const hasCodex = markers.codex.length > 0;

  if (hasClaude && !hasCodex) {
    return "claude";
  }
  if (hasCodex && !hasClaude) {
    return "codex";
  }
  return fallback;
}

async function normalizeSettingsRecord(
  value: unknown,
  options: { currentDirectory?: string; legacyRelayConfig?: LegacyRelayConfig | null; legacyAgents?: Record<string, LegacyAgentRecord> } = {},
): Promise<OpenScoutSettings> {
  const base = defaultSettings();
  const candidate = typeof value === "object" && value ? value as Record<string, unknown> : {};
  const profile = typeof candidate.profile === "object" && candidate.profile ? candidate.profile as Record<string, unknown> : {};
  const onboarding = typeof candidate.onboarding === "object" && candidate.onboarding ? candidate.onboarding as Record<string, unknown> : {};
  const discovery = typeof candidate.discovery === "object" && candidate.discovery ? candidate.discovery as Record<string, unknown> : {};
  const agents = typeof candidate.agents === "object" && candidate.agents ? candidate.agents as Record<string, unknown> : {};
  const bridges = typeof candidate.bridges === "object" && candidate.bridges ? candidate.bridges as Record<string, unknown> : {};
  const telegram = typeof bridges.telegram === "object" && bridges.telegram ? bridges.telegram as Record<string, unknown> : {};
  const phone = typeof candidate.phone === "object" && candidate.phone ? candidate.phone as Record<string, unknown> : {};
  const oldOperatorName = typeof candidate.operatorName === "string" ? candidate.operatorName : undefined;

  const seededWorkspaceRoots = await seedWorkspaceRoots({
    currentDirectory: options.currentDirectory,
    legacyRelayConfig: options.legacyRelayConfig ?? null,
    legacyAgents: options.legacyAgents ?? {},
  });

  const rawWorkspaceRoots = Array.isArray(discovery.workspaceRoots)
    ? discovery.workspaceRoots.map((entry) => String(entry))
    : [];
  const workspaceRoots = uniquePaths(rawWorkspaceRoots.length > 0 ? rawWorkspaceRoots : seededWorkspaceRoots);
  const contextRoot = normalizeOptionalString(discovery.contextRoot)
    ? normalizePath(String(discovery.contextRoot))
    : null;
  const seededTelegramBotToken = resolveTelegramConfigSeedValue("TELEGRAM_BOT_TOKEN", options.currentDirectory);
  const seededTelegramSecretToken = resolveTelegramConfigSeedValue("TELEGRAM_WEBHOOK_SECRET_TOKEN", options.currentDirectory);
  const seededTelegramApiBaseUrl = resolveTelegramConfigSeedValue("TELEGRAM_API_BASE_URL", options.currentDirectory);
  const seededTelegramUserName = resolveTelegramConfigSeedValue("TELEGRAM_BOT_USERNAME", options.currentDirectory);
  const telegramBotToken = normalizeOptionalString(telegram.botToken) || seededTelegramBotToken;
  const telegramSecretToken = normalizeOptionalString(telegram.secretToken) || seededTelegramSecretToken;
  const telegramApiBaseUrl = normalizeOptionalString(telegram.apiBaseUrl) || seededTelegramApiBaseUrl;
  const telegramUserName = normalizeOptionalString(telegram.userName) || seededTelegramUserName;

  return {
    version: SETTINGS_VERSION,
    profile: {
      operatorName: String(profile.operatorName ?? oldOperatorName ?? base.profile.operatorName).trim() || base.profile.operatorName,
    },
    onboarding: {
      operatorAnsweredAt: normalizeOptionalTimestamp(onboarding.operatorAnsweredAt),
      sourceRootsAnsweredAt: normalizeOptionalTimestamp(onboarding.sourceRootsAnsweredAt),
      harnessChosenAt: normalizeOptionalTimestamp(onboarding.harnessChosenAt),
      inputsSavedAt: normalizeOptionalTimestamp(onboarding.inputsSavedAt),
      initRanAt: normalizeOptionalTimestamp(onboarding.initRanAt),
      doctorRanAt: normalizeOptionalTimestamp(onboarding.doctorRanAt),
      runtimesRanAt: normalizeOptionalTimestamp(onboarding.runtimesRanAt),
      completedAt: normalizeOptionalTimestamp(onboarding.completedAt),
      skippedAt: normalizeOptionalTimestamp(onboarding.skippedAt),
    },
    discovery: {
      contextRoot,
      workspaceRoots,
      includeCurrentRepo: typeof discovery.includeCurrentRepo === "boolean"
        ? discovery.includeCurrentRepo
        : base.discovery.includeCurrentRepo,
    },
    agents: {
      defaultHarness: normalizeHarness(
        typeof agents.defaultHarness === "string" ? agents.defaultHarness : undefined,
        base.agents.defaultHarness,
      ),
      defaultTransport: DEFAULT_TRANSPORT,
      defaultCapabilities: normalizeCapabilities(agents.defaultCapabilities),
      sessionPrefix: normalizeSessionPrefix(typeof agents.sessionPrefix === "string" ? agents.sessionPrefix : undefined),
    },
    bridges: {
      telegram: {
        enabled: typeof telegram.enabled === "boolean"
          ? telegram.enabled
          : Boolean(telegramBotToken),
        mode: normalizeTelegramBridgeMode(telegram.mode),
        botToken: telegramBotToken,
        secretToken: telegramSecretToken,
        apiBaseUrl: telegramApiBaseUrl,
        userName: telegramUserName,
        defaultConversationId: normalizeTelegramConversationId(telegram.defaultConversationId),
        ownerNodeId: normalizeOptionalString(telegram.ownerNodeId),
      },
    },
    phone: {
      favorites: normalizeStringList(phone.favorites),
      quickHits: normalizeStringList(phone.quickHits),
      preparedAt: normalizeOptionalTimestamp(phone.preparedAt),
    },
  };
}

async function seedWorkspaceRoots(options: {
  currentDirectory?: string;
  legacyRelayConfig?: LegacyRelayConfig | null;
  legacyAgents?: Record<string, LegacyAgentRecord>;
}): Promise<string[]> {
  const roots = new Set<string>();
  const currentProjectRoot = options.currentDirectory
    ? await findNearestProjectRoot(options.currentDirectory)
    : null;

  if (currentProjectRoot) {
    roots.add(dirname(currentProjectRoot));
  }

  const legacyRoot = options.legacyRelayConfig?.projectRoot?.trim();
  if (legacyRoot) {
    roots.add(normalizePath(legacyRoot));
  }

  for (const record of Object.values(options.legacyAgents ?? {})) {
    if (record.cwd?.trim()) {
      roots.add(dirname(normalizePath(record.cwd)));
    }
  }

  if (roots.size === 0) {
    roots.add(join(homedir(), "dev"));
  }

  return Array.from(roots);
}

export async function readOpenScoutSettings(options: { currentDirectory?: string } = {}): Promise<OpenScoutSettings> {
  ensureOpenScoutCleanSlateSync();
  const supportPaths = resolveOpenScoutSupportPaths();
  const legacyRelayConfig = await readLegacyRelayConfig();
  const legacyAgents = await readLegacyAgentRegistry();
  const rawSettings = await readJsonFile<unknown>(supportPaths.settingsPath);
  return normalizeSettingsRecord(rawSettings, {
    currentDirectory: options.currentDirectory,
    legacyRelayConfig,
    legacyAgents,
  });
}

export async function writeOpenScoutSettings(settings: UpdateOpenScoutSettingsInput, options: { currentDirectory?: string } = {}): Promise<OpenScoutSettings> {
  ensureOpenScoutCleanSlateSync();
  const current = await readOpenScoutSettings(options);
  const merged = {
    ...current,
    ...settings,
    profile: {
      ...current.profile,
      ...(settings.profile ?? {}),
    },
    onboarding: {
      ...current.onboarding,
      ...(settings.onboarding ?? {}),
    },
    discovery: {
      ...current.discovery,
      ...(settings.discovery ?? {}),
    },
    agents: {
      ...current.agents,
      ...(settings.agents ?? {}),
    },
    bridges: {
      ...current.bridges,
      ...(settings.bridges ?? {}),
      telegram: {
        ...current.bridges.telegram,
        ...(settings.bridges?.telegram ?? {}),
      },
    },
    phone: {
      ...current.phone,
      ...(settings.phone ?? {}),
    },
  } satisfies OpenScoutSettings;

  const normalized = await normalizeSettingsRecord(merged, {
    currentDirectory: options.currentDirectory,
  });

  await writeJsonFile(resolveOpenScoutSupportPaths().settingsPath, normalized);
  return normalized;
}

export async function readRelayAgentOverrides(): Promise<Record<string, RelayAgentOverride>> {
  const supportPaths = resolveOpenScoutSupportPaths();
  const raw = await readJsonFile<{
    version?: number;
    agents?: Record<string, RelayAgentOverride>;
  }>(supportPaths.relayAgentsRegistryPath);

  const agents = raw?.agents ?? {};
  return Object.fromEntries(
    Object.entries(agents).map(([agentId, record]) => {
      const definitionId = normalizeAgentId(record.definitionId || record.agentId || agentId);
      const projectRoot = normalizePath(record.projectRoot);
      const concreteAgentId = BUILT_IN_AGENT_IDS.has(definitionId)
        ? definitionId
        : buildRelayAgentInstance(definitionId, projectRoot).id;
      const defaultHarness = normalizeManagedHarness(
        typeof record.defaultHarness === "string"
          ? record.defaultHarness
          : record.runtime?.harness,
        "claude",
      );
      const harnessProfiles = buildHarnessProfiles({
        projectRoot,
        sessionKey: concreteAgentId,
        sessionPrefix: "relay",
        defaultHarness,
        profiles: record.harnessProfiles,
        runtime: record.runtime,
        launchArgs: record.launchArgs,
      });
      const resolved = resolvedRuntimeView(defaultHarness, harnessProfiles);
      return [
        concreteAgentId,
        {
          ...record,
          agentId: concreteAgentId,
          definitionId,
          projectRoot,
          projectConfigPath: record.projectConfigPath ? normalizePath(record.projectConfigPath) : null,
          source: record.source ?? "manual",
          startedAt: Number.isFinite(record.startedAt) && record.startedAt ? Math.floor(record.startedAt) : nowSeconds(),
          defaultHarness,
          harnessProfiles,
          runtime: resolved.runtime,
          launchArgs: resolved.launchArgs,
          capabilities: normalizeCapabilities(record.capabilities),
        } satisfies RelayAgentOverride,
      ];
    }),
  );
}

export async function writeRelayAgentOverrides(overrides: Record<string, RelayAgentOverride>): Promise<void> {
  const normalizedAgents = Object.fromEntries(
    Object.entries(overrides).map(([agentId, record]) => {
      const definitionId = normalizeAgentId(record.definitionId || record.agentId || agentId);
      const projectRoot = normalizePath(record.projectRoot);
      const concreteAgentId = BUILT_IN_AGENT_IDS.has(definitionId)
        ? definitionId
        : buildRelayAgentInstance(definitionId, projectRoot).id;
      const defaultHarness = normalizeManagedHarness(
        typeof record.defaultHarness === "string"
          ? record.defaultHarness
          : record.runtime?.harness,
        "claude",
      );
      const harnessProfiles = buildHarnessProfiles({
        projectRoot,
        sessionKey: concreteAgentId,
        sessionPrefix: "relay",
        defaultHarness,
        profiles: record.harnessProfiles,
        runtime: record.runtime,
        launchArgs: record.launchArgs,
      });
      const resolved = resolvedRuntimeView(defaultHarness, harnessProfiles);
      return [
        concreteAgentId,
        {
          ...record,
          agentId: concreteAgentId,
          definitionId,
          defaultHarness,
          harnessProfiles,
          projectRoot,
          projectConfigPath: record.projectConfigPath ? normalizePath(record.projectConfigPath) : null,
          source: record.source ?? "manual",
          startedAt: Number.isFinite(record.startedAt) && record.startedAt ? Math.floor(record.startedAt) : nowSeconds(),
          runtime: resolved.runtime,
          launchArgs: resolved.launchArgs,
          capabilities: normalizeCapabilities(record.capabilities),
        } satisfies RelayAgentOverride,
      ];
    }),
  );

  await writeJsonFile(resolveOpenScoutSupportPaths().relayAgentsRegistryPath, {
    version: 1,
    agents: normalizedAgents,
  });
}

export async function findNearestProjectRoot(startDirectory: string): Promise<string | null> {
  let current = normalizePath(startDirectory);
  let lastCandidate: string | null = null;

  while (true) {
    if (await pathExists(join(current, ".git"))) {
      return current;
    }

    if (
      await pathExists(projectConfigPath(current))
      || await pathExists(join(current, "package.json"))
      || await pathExists(join(current, "AGENTS.md"))
      || await pathExists(join(current, "CLAUDE.md"))
    ) {
      lastCandidate = current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return lastCandidate;
    }
    current = parent;
  }
}

function defaultProjectConfig(projectRoot: string, settings: OpenScoutSettings, preferredHarness: AgentHarness): OpenScoutProjectConfig {
  const projectName = basename(projectRoot);
  const definitionId = normalizeAgentId(projectName);
  const relativeRoot = relative(projectRoot, projectRoot) || ".";

  return {
    version: PROJECT_CONFIG_VERSION,
    project: {
      id: projectName,
      name: titleCase(projectName),
      root: relativeRoot,
    },
    agent: {
      id: definitionId,
      displayName: titleCase(definitionId),
      prompt: {},
      runtime: {
        defaultHarness: normalizeManagedHarness(preferredHarness, "claude"),
        profiles: {
          [normalizeManagedHarness(preferredHarness, "claude")]: {
            cwd: ".",
            transport: normalizeTransport(undefined, preferredHarness, settings.agents.defaultTransport),
            sessionId: normalizeTmuxSessionName(undefined, `${definitionId}-${normalizeManagedHarness(preferredHarness, "claude")}`, settings.agents.sessionPrefix),
            launchArgs: [],
          },
        },
      },
    },
  };
}

export async function readProjectConfig(projectRoot: string): Promise<OpenScoutProjectConfig | null> {
  const raw = await readJsonFile<OpenScoutProjectConfig>(projectConfigPath(projectRoot));
  if (!raw || typeof raw !== "object") {
    return null;
  }

  return raw;
}

export async function writeProjectConfig(projectRoot: string, config: OpenScoutProjectConfig): Promise<void> {
  await writeJsonFile(projectConfigPath(projectRoot), config);
  await ensureProjectConfigIgnored(projectRoot);
}

async function removeLegacyRelayLink(projectRoot: string): Promise<void> {
  await rm(legacyLocalRelayLinkPath(projectRoot), { force: true });
}

export async function ensureProjectConfigForDirectory(currentDirectory: string, settings?: OpenScoutSettings): Promise<{
  projectRoot: string | null;
  projectConfigPath: string | null;
  created: boolean;
}> {
  const projectRoot = await findNearestProjectRoot(currentDirectory) ?? normalizePath(currentDirectory);

  const existing = await readProjectConfig(projectRoot);
  if (existing) {
    await ensureProjectConfigIgnored(projectRoot);
    return {
      projectRoot,
      projectConfigPath: projectConfigPath(projectRoot),
      created: false,
    };
  }

  const effectiveSettings = settings ?? await readOpenScoutSettings({ currentDirectory });
  const preferredHarness = await detectPreferredHarness(projectRoot, effectiveSettings.agents.defaultHarness);
  await writeProjectConfig(projectRoot, defaultProjectConfig(projectRoot, effectiveSettings, preferredHarness));
  await removeLegacyRelayLink(projectRoot);

  return {
    projectRoot,
    projectConfigPath: projectConfigPath(projectRoot),
    created: true,
  };
}

type ProjectScanCandidate = {
  projectRoot: string;
  sourceRoot: string;
};

async function detectProjectMarkers(
  projectRoot: string,
  markers: readonly string[],
): Promise<string[]> {
  const detected: string[] = [];
  for (const marker of markers) {
    if (await pathExists(join(projectRoot, marker))) {
      detected.push(marker);
    }
  }
  return detected;
}

async function scanSourceRoot(sourceRoot: string): Promise<ProjectScanCandidate[]> {
  const discovered = new Map<string, ProjectScanCandidate>();

  async function walk(currentDirectory: string): Promise<void> {
    const strongMarkers = await detectProjectMarkers(currentDirectory, PROJECT_STRONG_MARKERS);
    if (strongMarkers.length > 0) {
      discovered.set(currentDirectory, {
        projectRoot: currentDirectory,
        sourceRoot,
      });
      return;
    }

    const weakMarkers = await detectProjectMarkers(currentDirectory, PROJECT_WEAK_MARKERS);
    if (weakMarkers.length > 0) {
      discovered.set(currentDirectory, {
        projectRoot: currentDirectory,
        sourceRoot,
      });
      return;
    }

    const entries = await readdir(currentDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (entry.name.startsWith(".") && entry.name !== ".openscout") {
        continue;
      }
      if (PROJECT_SCAN_SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await walk(join(currentDirectory, entry.name));
    }
  }

  await walk(sourceRoot);
  return Array.from(discovered.values());
}

async function scanWorkspaceRoots(workspaceRoots: string[]): Promise<ProjectScanCandidate[]> {
  const discovered = new Map<string, ProjectScanCandidate>();

  for (const workspaceRoot of workspaceRoots) {
    if (!(await isDirectory(workspaceRoot))) {
      continue;
    }

    const candidates = await scanSourceRoot(workspaceRoot);
    for (const candidate of candidates) {
      discovered.set(candidate.projectRoot, candidate);
    }
  }

  return Array.from(discovered.values());
}

function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizePath(candidatePath);
  const root = normalizePath(rootPath);
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function sourceRootForProject(projectRoot: string, workspaceRoots: string[]): string {
  const matches = workspaceRoots
    .filter((root) => isPathInsideRoot(projectRoot, root))
    .sort((lhs, rhs) => rhs.length - lhs.length);
  return matches[0] ?? projectRoot;
}

function relativeProjectPath(projectRoot: string, sourceRoot: string): string {
  return relative(sourceRoot, projectRoot) || ".";
}

function resolveProjectRootFromConfig(projectRoot: string, config: OpenScoutProjectConfig): string {
  return normalizePath(join(projectRoot, config.project.root ?? "."));
}

function mergeResolvedAgentConfig(
  base: ResolvedRelayAgentConfig,
  override: RelayAgentOverride | undefined,
  settings: OpenScoutSettings,
): ResolvedRelayAgentConfig {
  if (!override) {
    return base;
  }

  const manifestBeatsLegacyImport = base.source === "manifest" && override.source === "legacy-import";
  const overrideLaunchArgs = normalizeLaunchArgs(override.launchArgs);
  const overrideCapabilities = normalizeCapabilities(override.capabilities);

  const definitionId = manifestBeatsLegacyImport ? base.definitionId : (override.definitionId || base.definitionId);
  const projectRoot = manifestBeatsLegacyImport
    ? base.projectRoot
    : (override.projectRoot ? normalizePath(override.projectRoot) : base.projectRoot);
  const instance = buildRelayAgentInstance(definitionId, projectRoot);
  const defaultHarness = normalizeManagedHarness(
    manifestBeatsLegacyImport
      ? base.defaultHarness
      : (override.defaultHarness ?? override.runtime?.harness),
    base.defaultHarness,
  );
  const harnessProfiles = buildHarnessProfiles({
    projectRoot,
    sessionKey: instance.id,
    sessionPrefix: settings.agents.sessionPrefix,
    defaultHarness,
    profiles: {
      ...(base.harnessProfiles ?? {}),
      ...(manifestBeatsLegacyImport ? {} : (override.harnessProfiles ?? {})),
    },
    runtime: manifestBeatsLegacyImport ? undefined : override.runtime,
    launchArgs: manifestBeatsLegacyImport ? base.launchArgs : overrideLaunchArgs,
  });
  const view = resolvedRuntimeView(defaultHarness, harnessProfiles);

  return {
    ...base,
    agentId: instance.id,
    definitionId,
    displayName: manifestBeatsLegacyImport ? base.displayName : (override.displayName?.trim() || base.displayName),
    projectName: manifestBeatsLegacyImport ? base.projectName : (override.projectName?.trim() || base.projectName),
    projectRoot,
    projectConfigPath: manifestBeatsLegacyImport ? base.projectConfigPath : (override.projectConfigPath ?? base.projectConfigPath),
    source: manifestBeatsLegacyImport ? base.source : (override.source ?? base.source),
    registrationKind: isConfiguredRelayAgentOverride(instance.id, override, settings)
      ? "configured"
      : base.registrationKind,
    startedAt: Number.isFinite(override.startedAt) && override.startedAt ? Math.floor(override.startedAt) : base.startedAt,
    systemPrompt: manifestBeatsLegacyImport
      ? (base.systemPrompt || override.systemPrompt?.trim() || undefined)
      : (override.systemPrompt?.trim() || base.systemPrompt),
    launchArgs: view.launchArgs,
    capabilities: manifestBeatsLegacyImport
      ? (base.capabilities.length > 0 ? base.capabilities : overrideCapabilities)
      : (overrideCapabilities.length > 0 ? overrideCapabilities : base.capabilities),
    defaultHarness,
    harnessProfiles,
    instance,
    runtime: view.runtime,
  };
}

function relayAgentOverrideFromResolvedConfig(config: ResolvedRelayAgentConfig): RelayAgentOverride {
  return {
    agentId: config.agentId,
    definitionId: config.definitionId,
    displayName: config.displayName,
    projectName: config.projectName,
    projectRoot: config.projectRoot,
    projectConfigPath: config.projectConfigPath,
    source: config.source === "manifest" ? "manifest" : config.source,
    startedAt: config.startedAt,
    systemPrompt: config.systemPrompt,
    defaultHarness: config.defaultHarness,
    harnessProfiles: config.harnessProfiles,
    launchArgs: config.launchArgs,
    capabilities: config.capabilities,
    runtime: {
      cwd: config.runtime.cwd,
      harness: config.runtime.harness,
      transport: config.runtime.transport,
      sessionId: config.runtime.sessionId,
      wakePolicy: config.runtime.wakePolicy,
    },
  };
}

function selectorCandidateFromResolvedAgent(config: ResolvedRelayAgentConfig): AgentSelectorCandidate {
  return {
    agentId: config.agentId,
    definitionId: config.definitionId,
    nodeQualifier: config.instance.nodeQualifier,
    workspaceQualifier: config.instance.workspaceQualifier,
    aliases: [config.instance.selector, config.instance.defaultSelector],
  };
}

function selectorFromInput(value: string | AgentSelector): AgentSelector | null {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return parseAgentSelector(trimmed.startsWith("@") ? trimmed : `@${trimmed}`);
}

async function resolveManifestBackedAgent(
  projectRoot: string,
  config: OpenScoutProjectConfig,
  settings: OpenScoutSettings,
  override: RelayAgentOverride | undefined,
): Promise<ResolvedRelayAgentConfig> {
  const resolvedProjectRoot = resolveProjectRootFromConfig(projectRoot, config);
  const projectName = config.project.name?.trim() || titleCase(config.project.id || basename(resolvedProjectRoot));
  const fallbackDefinitionId = normalizeAgentId(config.project.id || basename(resolvedProjectRoot));
  const definitionId = normalizeAgentId(
    config.agent?.id
      || override?.definitionId
      || fallbackDefinitionId,
  );
  const detectedHarness = await detectPreferredHarness(resolvedProjectRoot, settings.agents.defaultHarness);
  const runtimeDefaults = config.agent?.runtime?.defaults;
  const defaultHarness = normalizeManagedHarness(
    typeof config.agent?.runtime?.defaultHarness === "string"
      ? config.agent.runtime.defaultHarness
      : runtimeDefaults?.harness,
    normalizeManagedHarness(detectedHarness, "claude"),
  );
  const instance = buildRelayAgentInstance(definitionId, resolvedProjectRoot);
  const harnessProfiles = buildHarnessProfiles({
    projectRoot: resolvedProjectRoot,
    sessionKey: instance.id,
    sessionPrefix: settings.agents.sessionPrefix,
    defaultHarness,
    profiles: config.agent?.runtime?.profiles,
    runtime: runtimeDefaults,
    launchArgs: normalizeLaunchArgs(runtimeDefaults?.launchArgs),
  });
  const view = resolvedRuntimeView(defaultHarness, harnessProfiles);
  const base: ResolvedRelayAgentConfig = {
    agentId: instance.id,
    definitionId,
    displayName: config.agent?.displayName?.trim() || override?.displayName?.trim() || titleCase(definitionId),
    projectName,
    projectRoot: resolvedProjectRoot,
    projectConfigPath: projectConfigPath(projectRoot),
    source: "manifest",
    registrationKind: "configured",
    startedAt: nowSeconds(),
    systemPrompt: config.agent?.prompt?.template?.trim() || undefined,
    launchArgs: view.launchArgs,
    capabilities: normalizeCapabilities(runtimeDefaults?.capabilities),
    defaultHarness,
    harnessProfiles,
    instance,
    runtime: view.runtime,
  };

  return mergeResolvedAgentConfig(base, override, settings);
}

async function resolveInferredAgent(
  projectRoot: string,
  settings: OpenScoutSettings,
  override: RelayAgentOverride | undefined,
): Promise<ResolvedRelayAgentConfig> {
  const projectName = basename(projectRoot);
  const definitionId = normalizeAgentId(override?.definitionId?.trim() || projectName);
  const detectedHarness = await detectPreferredHarness(projectRoot, settings.agents.defaultHarness);
  const defaultHarness = normalizeManagedHarness(
    override?.defaultHarness ?? override?.runtime?.harness,
    normalizeManagedHarness(detectedHarness, "claude"),
  );
  const instance = buildRelayAgentInstance(definitionId, projectRoot);
  const harnessProfiles = buildHarnessProfiles({
    projectRoot,
    sessionKey: instance.id,
    sessionPrefix: settings.agents.sessionPrefix,
    defaultHarness,
    profiles: override?.harnessProfiles,
    runtime: override?.runtime,
    launchArgs: normalizeLaunchArgs(override?.launchArgs),
  });
  const view = resolvedRuntimeView(defaultHarness, harnessProfiles);
  const base: ResolvedRelayAgentConfig = {
    agentId: instance.id,
    definitionId,
    displayName: override?.displayName?.trim() || titleCase(definitionId),
    projectName: override?.projectName?.trim() || titleCase(projectName),
    projectRoot,
    projectConfigPath: null,
    source: override?.source ?? "inferred",
    registrationKind: isConfiguredRelayAgentOverride(instance.id, override, settings) ? "configured" : "discovered",
    startedAt: Number.isFinite(override?.startedAt) && override?.startedAt ? Math.floor(override.startedAt) : nowSeconds(),
    systemPrompt: override?.systemPrompt?.trim() || undefined,
    launchArgs: view.launchArgs,
    capabilities: normalizeCapabilities(override?.capabilities),
    defaultHarness,
    harnessProfiles,
    instance,
    runtime: view.runtime,
  };

  return mergeResolvedAgentConfig(base, override, settings);
}

async function buildProjectInventoryEntry(
  agent: ResolvedRelayAgentConfig,
  sourceRoot: string,
): Promise<ProjectInventoryEntry> {
  const manifestRoot = agent.projectConfigPath
    ? normalizePath(join(dirname(agent.projectConfigPath), ".."))
    : null;
  const manifest = manifestRoot ? await readProjectConfig(manifestRoot) : null;
  const markers = await detectHarnessMarkers(agent.projectRoot);
  const harnesses = new Map<ManagedAgentHarness, ProjectInventoryHarnessEvidence>();
  const runtimeProfiles = manifest?.agent?.runtime?.profiles ?? {};
  const manifestDefaultHarness = manifest?.agent?.runtime?.defaultHarness;

  for (const harness of MANAGED_AGENT_HARNESSES) {
    if (runtimeProfiles[harness]) {
      harnesses.set(harness, {
        harness,
        source: "manifest",
        detail: "Project manifest profile",
      });
    }
  }

  if (manifestDefaultHarness === "claude" || manifestDefaultHarness === "codex") {
    harnesses.set(manifestDefaultHarness, {
      harness: manifestDefaultHarness,
      source: "manifest",
      detail: "Project manifest default",
    });
  }

  for (const harness of MANAGED_AGENT_HARNESSES) {
    for (const marker of markers[harness]) {
      if (!harnesses.has(harness)) {
        harnesses.set(harness, {
          harness,
          source: "marker",
          detail: marker,
        });
      }
    }
  }

  if (!harnesses.has(agent.defaultHarness)) {
    harnesses.set(agent.defaultHarness, {
      harness: agent.defaultHarness,
      source: "default",
      detail: "OpenScout default",
    });
  }

  return {
    agentId: agent.agentId,
    definitionId: agent.definitionId,
    displayName: agent.displayName,
    projectName: agent.projectName,
    projectRoot: agent.projectRoot,
    sourceRoot,
    relativePath: relativeProjectPath(agent.projectRoot, sourceRoot),
    source: agent.source,
    registrationKind: agent.registrationKind,
    projectConfigPath: agent.projectConfigPath,
    defaultHarness: agent.defaultHarness,
    harnesses: Array.from(harnesses.values()),
  };
}

async function importLegacyState(currentDirectory?: string): Promise<{
  settings: OpenScoutSettings;
  overrides: Record<string, RelayAgentOverride>;
}> {
  const settings = await readOpenScoutSettings({ currentDirectory });
  const overrides = await readRelayAgentOverrides();
  return {
    settings,
    overrides,
  };
}

async function syncRelayAgentMirror(agents: ResolvedRelayAgentConfig[]): Promise<void> {
  void agents;
}

function buildOverrideIndexByProjectRoot(overrides: Record<string, RelayAgentOverride>): Map<string, RelayAgentOverride> {
  return new Map(
    Object.values(overrides).map((record) => [normalizePath(record.projectRoot), record]),
  );
}

export async function loadResolvedRelayAgents(options: {
  currentDirectory?: string;
  ensureCurrentProjectConfig?: boolean;
  syncLegacyMirror?: boolean;
} = {}): Promise<SetupResult> {
  ensureOpenScoutCleanSlateSync();
  const supportPaths = resolveOpenScoutSupportPaths();
  if (options.currentDirectory) {
    const projectRoot = await findNearestProjectRoot(options.currentDirectory);
    if (projectRoot) {
      await removeLegacyRelayLink(projectRoot);
    }
  }
  await mkdir(supportPaths.supportDirectory, { recursive: true });
  await mkdir(supportPaths.logsDirectory, { recursive: true });
  await mkdir(supportPaths.appLogsDirectory, { recursive: true });
  await mkdir(supportPaths.brokerLogsDirectory, { recursive: true });
  await mkdir(supportPaths.catalogDirectory, { recursive: true });
  await mkdir(supportPaths.relayAgentsDirectory, { recursive: true });
  await mkdir(supportPaths.controlHome, { recursive: true });
  await ensureHarnessCatalogOverrideFile(supportPaths.harnessCatalogPath);

  const { settings, overrides } = await importLegacyState(options.currentDirectory);
  let currentProjectConfig = {
    projectRoot: null as string | null,
    projectConfigPath: null as string | null,
    created: false,
  };

  if (options.currentDirectory && options.ensureCurrentProjectConfig) {
    currentProjectConfig = await ensureProjectConfigForDirectory(options.currentDirectory, settings);
  } else if (options.currentDirectory) {
    const currentProjectRoot = await findNearestProjectRoot(options.currentDirectory);
    if (currentProjectRoot) {
      currentProjectConfig = {
        projectRoot: currentProjectRoot,
        projectConfigPath: (await pathExists(projectConfigPath(currentProjectRoot))) ? projectConfigPath(currentProjectRoot) : null,
        created: false,
      };
    }
  }

  const workspaceCandidates = await scanWorkspaceRoots(settings.discovery.workspaceRoots);
  const projectCandidates = new Set<string>(workspaceCandidates.map((candidate) => candidate.projectRoot));
  const sourceRootByProject = new Map<string, string>(
    workspaceCandidates.map((candidate) => [candidate.projectRoot, candidate.sourceRoot]),
  );
  const overrideByRoot = buildOverrideIndexByProjectRoot(overrides);

  if (settings.discovery.includeCurrentRepo && currentProjectConfig.projectRoot) {
    projectCandidates.add(currentProjectConfig.projectRoot);
    sourceRootByProject.set(
      currentProjectConfig.projectRoot,
      sourceRootForProject(currentProjectConfig.projectRoot, settings.discovery.workspaceRoots),
    );
  }

  for (const override of Object.values(overrides)) {
    const normalizedRoot = normalizePath(override.projectRoot);
    projectCandidates.add(normalizedRoot);
    sourceRootByProject.set(
      normalizedRoot,
      sourceRootForProject(normalizedRoot, settings.discovery.workspaceRoots),
    );
  }

  const resolvedAgents: ResolvedRelayAgentConfig[] = [];
  for (const projectRoot of Array.from(projectCandidates).sort()) {
    const manifest = await readProjectConfig(projectRoot);
    const override = overrideByRoot.get(projectRoot);
    const resolvedAgent = manifest
      ? await resolveManifestBackedAgent(projectRoot, manifest, settings, override)
      : await resolveInferredAgent(projectRoot, settings, override);

    if (!resolvedAgent.agentId || BUILT_IN_AGENT_IDS.has(resolvedAgent.agentId)) {
      continue;
    }

    resolvedAgents.push(resolvedAgent);
  }

  const configuredAgents = resolvedAgents.filter((agent) => agent.registrationKind === "configured");
  const builtInOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([agentId]) => BUILT_IN_AGENT_IDS.has(agentId)),
  );
  const nextOverrides = {
    ...builtInOverrides,
    ...Object.fromEntries(
    configuredAgents.map((agent) => [
      agent.agentId,
      relayAgentOverrideFromResolvedConfig(agent),
    ]),
    ),
  };

  await writeRelayAgentOverrides(nextOverrides);

  if (options.syncLegacyMirror) {
    await syncRelayAgentMirror(configuredAgents);
  }

  const projectInventory = await Promise.all(
    resolvedAgents.map((agent) => buildProjectInventoryEntry(
      agent,
      sourceRootByProject.get(agent.projectRoot)
        ?? sourceRootForProject(agent.projectRoot, settings.discovery.workspaceRoots),
    )),
  );

  return {
    supportDirectory: supportPaths.supportDirectory,
    settingsPath: supportPaths.settingsPath,
    harnessCatalogPath: supportPaths.harnessCatalogPath,
    relayAgentsPath: supportPaths.relayAgentsRegistryPath,
    relayHubPath: supportPaths.relayHubDirectory,
    currentProjectConfigPath: currentProjectConfig.projectConfigPath,
    createdProjectConfig: currentProjectConfig.created,
    settings,
    agents: configuredAgents.sort((lhs, rhs) => lhs.displayName.localeCompare(rhs.displayName)),
    discoveredAgents: resolvedAgents.sort((lhs, rhs) => lhs.displayName.localeCompare(rhs.displayName)),
    projectInventory: projectInventory.sort((lhs, rhs) => lhs.relativePath.localeCompare(rhs.relativePath) || lhs.displayName.localeCompare(rhs.displayName)),
  };
}

export async function resolveRelayAgentConfig(
  value: string | AgentSelector,
  options: {
    currentDirectory?: string;
    ensureCurrentProjectConfig?: boolean;
  } = {},
): Promise<ResolvedRelayAgentConfig | null> {
  const selector = selectorFromInput(value);
  if (!selector) {
    return null;
  }

  const setup = await loadResolvedRelayAgents({
    currentDirectory: options.currentDirectory,
    ensureCurrentProjectConfig: options.ensureCurrentProjectConfig,
  });
  const match = resolveAgentSelector(
    selector,
    setup.discoveredAgents.map(selectorCandidateFromResolvedAgent),
  );
  if (!match) {
    return null;
  }

  return setup.discoveredAgents.find((agent) => agent.agentId === match.agentId) ?? null;
}

export async function ensureRelayAgentConfigured(
  value: string | AgentSelector,
  options: {
    currentDirectory?: string;
    ensureCurrentProjectConfig?: boolean;
    syncLegacyMirror?: boolean;
  } = {},
): Promise<ResolvedRelayAgentConfig | null> {
  const candidate = await resolveRelayAgentConfig(value, {
    currentDirectory: options.currentDirectory,
    ensureCurrentProjectConfig: options.ensureCurrentProjectConfig,
  });
  if (!candidate) {
    return null;
  }

  if (candidate.registrationKind === "configured") {
    return candidate;
  }

  const overrides = await readRelayAgentOverrides();
  overrides[candidate.agentId] = relayAgentOverrideFromResolvedConfig(candidate);
  await writeRelayAgentOverrides(overrides);

  await loadResolvedRelayAgents({
    currentDirectory: options.currentDirectory,
    syncLegacyMirror: options.syncLegacyMirror ?? true,
  });

  return {
    ...candidate,
    registrationKind: "configured",
  };
}

export async function ensureScoutRelayAgentConfigured(options: {
  currentDirectory?: string;
  projectRoot?: string;
} = {}): Promise<RelayAgentOverride> {
  const settings = await readOpenScoutSettings({ currentDirectory: options.currentDirectory });
  const overrides = await readRelayAgentOverrides();
  const existing = overrides[SCOUT_AGENT_ID];
  const resolvedProjectRoot = options.projectRoot
    ? normalizePath(options.projectRoot)
    : options.currentDirectory
      ? (await findNearestProjectRoot(options.currentDirectory)) ?? normalizePath(options.currentDirectory)
      : normalizePath(process.cwd());

  const nextOverride: RelayAgentOverride = {
    ...existing,
    agentId: SCOUT_AGENT_ID,
    definitionId: SCOUT_AGENT_ID,
    displayName: "Scout",
    projectName: "OpenScout",
    projectRoot: resolvedProjectRoot,
    projectConfigPath: existing?.projectConfigPath ? normalizePath(existing.projectConfigPath) : null,
    source: "manual",
    startedAt: existing?.startedAt ?? nowSeconds(),
    systemPrompt: existing?.systemPrompt?.trim() || undefined,
    capabilities: normalizeCapabilities(existing?.capabilities),
    defaultHarness: "claude",
    harnessProfiles: buildHarnessProfiles({
      projectRoot: resolvedProjectRoot,
      sessionKey: SCOUT_AGENT_ID,
      sessionPrefix: settings.agents.sessionPrefix,
      defaultHarness: "claude",
      profiles: existing?.harnessProfiles,
      runtime: existing?.runtime,
      launchArgs: normalizeLaunchArgs(existing?.launchArgs),
    }),
    runtime: {
      cwd: resolvedProjectRoot,
      harness: "claude",
      transport: "claude_stream_json",
      sessionId: normalizeTmuxSessionName(existing?.runtime?.sessionId, `${SCOUT_AGENT_ID}-claude`, settings.agents.sessionPrefix),
      wakePolicy: "on_demand",
    },
  };
  nextOverride.launchArgs = nextOverride.harnessProfiles?.claude?.launchArgs ?? [];

  if (JSON.stringify(existing) !== JSON.stringify(nextOverride)) {
    overrides[SCOUT_AGENT_ID] = nextOverride;
    await writeRelayAgentOverrides(overrides);
  }

  return nextOverride;
}

export async function initializeOpenScoutSetup(options: { currentDirectory?: string } = {}): Promise<SetupResult> {
  return loadResolvedRelayAgents({
    currentDirectory: options.currentDirectory,
    ensureCurrentProjectConfig: true,
    syncLegacyMirror: true,
  });
}
