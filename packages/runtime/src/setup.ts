import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

import {
  BUILT_IN_AGENT_DEFINITION_IDS,
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
import { collectUserLevelProjectRootHints, encodeClaudeProjectsSlug } from "./user-project-hints.js";

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

export type OpenScoutProjectScriptSet = {
  default?: string;
  macos?: string;
  linux?: string;
  windows?: string;
};

export type OpenScoutProjectAction = {
  name: string;
  icon?: string;
  scripts: OpenScoutProjectScriptSet;
};

export type OpenScoutProjectEnvironment = {
  setup?: OpenScoutProjectScriptSet;
  actions?: OpenScoutProjectAction[];
};

export type OpenScoutCodexImport = {
  sourcePath: string;
  importedAt: number;
  version?: number;
  name?: string;
  environment?: OpenScoutProjectEnvironment;
};

export type OpenScoutClaudeImport = {
  sourcePath: string;
  importedAt: number;
  slug: string;
  memoryPath?: string;
  recentDirectories?: string[];
  gitBranches?: string[];
  sessionCount?: number;
};

export type OpenScoutProjectConfig = {
  version: 1;
  project: {
    id: string;
    name: string;
    root?: string;
  };
  environment?: OpenScoutProjectEnvironment;
  imports?: {
    codex?: OpenScoutCodexImport;
    claude?: OpenScoutClaudeImport;
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
  node: {
    alias: string;
  };
  discovery: {
    contextRoot: string | null;
    workspaceRoots: string[];
    includeCurrentRepo: boolean;
    hiddenProjectRoots: string[];
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
  node?: Partial<OpenScoutSettings["node"]>;
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
  "target",
  ".gradle",
  "__pypackages__",
  ".tox",
  ".nox",
  ".mypy_cache",
  ".ruff_cache",
  ".pytest_cache",
  "bower_components",
  ".pnpm-store",
  ".pnpm",
  ".yarn",
  "tmp",
  ".tmp",
  "DerivedData",
]);
const PROJECT_STRONG_MARKERS = [
  ".openscout/project.json",
  ".git",
] as const;
/** Files/dirs that imply an AI/agent workspace — used only for discovery, not harness choice. */
const PROJECT_WEAK_MARKERS = [
  "AGENTS.md",
  "CLAUDE.md",
  "CLAUDE.local.md",
  "CODEX.md",
  "GEMINI.md",
  "GOOGLE.md",
  ".cursorrules",
  ".cursor",
  ".github/copilot-instructions.md",
  "opencode.json",
  ".opencode",
  "WARP.md",
  "CONTINUE.md",
  ".aider.conf.yml",
  ".aider",
  ".kilocode",
  ".factory",
  "PI.md",
  ".pi",
  "Cargo.toml",
  "go.mod",
  "go.work",
  "pyproject.toml",
  "setup.py",
  "Gemfile",
  "Package.swift",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pubspec.yaml",
  "composer.json",
  "flake.nix",
] as const;
const PROJECT_HARNESS_MARKERS: Record<ManagedAgentHarness, readonly string[]> = {
  claude: [
    "CLAUDE.md",
    "CLAUDE.local.md",
    ".claude",
  ],
  codex: [
    "AGENTS.md",
    "CODEX.md",
    ".codex",
  ],
};

function partitionFlatAndNestedMarkers(markers: readonly string[]): { flat: string[]; nested: string[] } {
  const flat: string[] = [];
  const nested: string[] = [];
  for (const marker of markers) {
    if (marker.includes("/")) {
      nested.push(marker);
    } else {
      flat.push(marker);
    }
  }
  return { flat, nested };
}

const PROJECT_STRONG_MARKERS_FLAT_NESTED = partitionFlatAndNestedMarkers(PROJECT_STRONG_MARKERS);
const PROJECT_WEAK_MARKERS_FLAT_NESTED = partitionFlatAndNestedMarkers(PROJECT_WEAK_MARKERS);

function matchFlatMarkers(entryNames: ReadonlySet<string>, flatMarkers: readonly string[]): string[] {
  const found: string[] = [];
  for (const marker of flatMarkers) {
    if (entryNames.has(marker)) {
      found.push(marker);
    }
  }
  return found;
}

async function matchNestedMarkers(projectRoot: string, nestedMarkers: readonly string[]): Promise<string[]> {
  if (nestedMarkers.length === 0) {
    return [];
  }
  const hits = await Promise.all(
    nestedMarkers.map(async (marker) => ((await pathExists(join(projectRoot, marker))) ? marker : null)),
  );
  return hits.filter((marker): marker is string => Boolean(marker));
}

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

function normalizeProjectRelativePath(projectRoot: string, value: string): string {
  const expanded = expandHomePath(value.trim() || ".");
  return isAbsolute(expanded) ? resolve(expanded) : resolve(projectRoot, expanded);
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
  // Priority: env var > settings alias > hostname
  const fromEnv = process.env.OPENSCOUT_NODE_QUALIFIER?.trim();
  if (fromEnv) {
    return normalizeAgentSelectorSegment(fromEnv) || "local";
  }

  const alias = readNodeAliasSync();
  if (alias) {
    return normalizeAgentSelectorSegment(alias) || "local";
  }

  return normalizeAgentSelectorSegment(hostname() || "local") || "local";
}

function readNodeAliasSync(): string | null {
  try {
    const settingsPath = resolveOpenScoutSupportPaths().settingsPath;
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as { node?: { alias?: string } };
    return settings.node?.alias?.trim() || null;
  } catch {
    return null;
  }
}

function detectGitBranchUncached(projectRoot: string): string | null {
  // Prefer `symbolic-ref` so we still get a branch name on unborn HEADs
  // (freshly initialized repos with no commits yet). Fall back to
  // `rev-parse --abbrev-ref HEAD` for detached-HEAD detection.
  try {
    const branch = execFileSync(
      "git",
      ["-C", projectRoot, "symbolic-ref", "--short", "HEAD"],
      { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" },
    ).trim();
    if (branch) {
      return branch;
    }
  } catch {
    // ignore and fall through
  }
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

// Per-projectRoot branch cache. `readRelayAgentOverrides` is called on every
// mobile createSession RPC and iterates every stored override — without this
// memo, we'd shell out to git 30+ times per call (~200ms). The cache assumes
// branch changes are rare relative to RPC cadence; callers that need a fresh
// read can clear via clearGitBranchCache().
const GIT_BRANCH_CACHE_TTL_MS = 15_000;
type GitBranchCacheEntry = { branch: string | null; expiresAt: number };
const gitBranchCache = new Map<string, GitBranchCacheEntry>();

function detectGitBranch(projectRoot: string): string | null {
  const now = Date.now();
  const cached = gitBranchCache.get(projectRoot);
  if (cached && cached.expiresAt > now) {
    return cached.branch;
  }
  const branch = detectGitBranchUncached(projectRoot);
  gitBranchCache.set(projectRoot, { branch, expiresAt: now + GIT_BRANCH_CACHE_TTL_MS });
  return branch;
}

export function clearGitBranchCache(projectRoot?: string): void {
  if (projectRoot) {
    gitBranchCache.delete(projectRoot);
  } else {
    gitBranchCache.clear();
  }
}

function resolveWorkspaceQualifier(projectRoot: string): { workspaceQualifier: string; branch: string | null } {
  const normalizedProjectRoot = normalizePath(projectRoot);
  const branch = detectGitBranch(normalizedProjectRoot);
  const workspaceQualifier = branch ? normalizeAgentSelectorSegment(branch) : "";
  return {
    workspaceQualifier,
    branch,
  };
}

export function buildRelayAgentInstance(agentId: string, projectRoot: string): ResolvedRelayAgentConfig["instance"] {
  const nodeQualifier = resolveNodeQualifier();
  const { workspaceQualifier, branch } = resolveWorkspaceQualifier(projectRoot);
  return {
    id: [agentId, workspaceQualifier, nodeQualifier].filter(Boolean).join("."),
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
    cwd: profile?.cwd ? normalizeProjectRelativePath(options.projectRoot, profile.cwd) : options.projectRoot,
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
    node: {
      alias: "",
    },
    discovery: {
      contextRoot: null,
      workspaceRoots: [],
      includeCurrentRepo: true,
      hiddenProjectRoots: [],
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

function codexEnvironmentPath(projectRoot: string): string {
  return join(projectRoot, ".codex", "environments", "environment.toml");
}

function currentHomeDirectory(): string {
  return process.env.HOME?.trim() || homedir();
}

function normalizeProjectScriptSet(value: unknown): OpenScoutProjectScriptSet | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const next: OpenScoutProjectScriptSet = {};
  const defaults = [
    normalizeOptionalString(candidate.default),
    normalizeOptionalString(candidate.script),
    normalizeOptionalString(candidate.command),
  ].find(Boolean);
  const macos = [
    normalizeOptionalString(candidate.macos),
    normalizeOptionalString(candidate.macosScript),
    normalizeOptionalString(candidate.macosCommand),
    normalizeOptionalString((candidate.macos as Record<string, unknown> | undefined)?.script),
    normalizeOptionalString((candidate.macos as Record<string, unknown> | undefined)?.command),
  ].find(Boolean);
  const linux = [
    normalizeOptionalString(candidate.linux),
    normalizeOptionalString(candidate.linuxScript),
    normalizeOptionalString(candidate.linuxCommand),
    normalizeOptionalString((candidate.linux as Record<string, unknown> | undefined)?.script),
    normalizeOptionalString((candidate.linux as Record<string, unknown> | undefined)?.command),
  ].find(Boolean);
  const windows = [
    normalizeOptionalString(candidate.windows),
    normalizeOptionalString(candidate.windowsScript),
    normalizeOptionalString(candidate.windowsCommand),
    normalizeOptionalString((candidate.windows as Record<string, unknown> | undefined)?.script),
    normalizeOptionalString((candidate.windows as Record<string, unknown> | undefined)?.command),
  ].find(Boolean);

  if (defaults) {
    next.default = defaults;
  }
  if (macos) {
    next.macos = macos;
  }
  if (linux) {
    next.linux = linux;
  }
  if (windows) {
    next.windows = windows;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeProjectActions(value: unknown): OpenScoutProjectAction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const actions: OpenScoutProjectAction[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || !entry) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const name = normalizeOptionalString(candidate.name);
    if (!name) {
      continue;
    }
    const scripts = normalizeProjectScriptSet(candidate);
    if (!scripts) {
      continue;
    }
    actions.push({
      name,
      icon: normalizeOptionalString(candidate.icon) || undefined,
      scripts,
    });
  }

  return actions.length > 0 ? actions : undefined;
}

function normalizeProjectEnvironment(value: unknown): OpenScoutProjectEnvironment | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const setup = normalizeProjectScriptSet(candidate.setup);
  const actions = normalizeProjectActions(candidate.actions);
  if (!setup && !actions) {
    return undefined;
  }

  return {
    ...(setup ? { setup } : {}),
    ...(actions ? { actions } : {}),
  };
}

function normalizeCodexImport(value: unknown): OpenScoutCodexImport | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const sourcePath = normalizeOptionalString(candidate.sourcePath);
  if (!sourcePath) {
    return undefined;
  }

  return {
    sourcePath,
    importedAt: Number.isFinite(candidate.importedAt) ? Number(candidate.importedAt) : nowSeconds(),
    version: Number.isFinite(candidate.version) ? Number(candidate.version) : undefined,
    name: normalizeOptionalString(candidate.name) || undefined,
    ...(normalizeProjectEnvironment(candidate.environment) ? { environment: normalizeProjectEnvironment(candidate.environment) } : {}),
  };
}

function normalizeClaudeImport(value: unknown): OpenScoutClaudeImport | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const sourcePath = normalizeOptionalString(candidate.sourcePath);
  const slug = normalizeOptionalString(candidate.slug);
  if (!sourcePath || !slug) {
    return undefined;
  }

  const recentDirectories = Array.isArray(candidate.recentDirectories)
    ? candidate.recentDirectories.map((entry) => normalizeOptionalString(entry)).filter(Boolean)
    : [];
  const gitBranches = Array.isArray(candidate.gitBranches)
    ? candidate.gitBranches.map((entry) => normalizeOptionalString(entry)).filter(Boolean)
    : [];

  return {
    sourcePath,
    importedAt: Number.isFinite(candidate.importedAt) ? Number(candidate.importedAt) : nowSeconds(),
    slug,
    memoryPath: normalizeOptionalString(candidate.memoryPath) || undefined,
    ...(recentDirectories.length > 0 ? { recentDirectories } : {}),
    ...(gitBranches.length > 0 ? { gitBranches } : {}),
    ...(Number.isFinite(candidate.sessionCount) ? { sessionCount: Number(candidate.sessionCount) } : {}),
  };
}

async function readCodexEnvironmentImport(projectRoot: string): Promise<OpenScoutCodexImport | null> {
  const sourcePath = codexEnvironmentPath(projectRoot);
  let body: string;
  try {
    body = await readFile(sourcePath, "utf8");
  } catch {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(body) as Record<string, unknown>;
  } catch {
    return null;
  }

  const environment = normalizeProjectEnvironment({
    setup: parsed.setup,
    actions: parsed.actions,
  });

  return {
    sourcePath,
    importedAt: nowSeconds(),
    version: Number.isFinite(parsed.version) ? Number(parsed.version) : undefined,
    name: normalizeOptionalString(parsed.name) || undefined,
    ...(environment ? { environment } : {}),
  };
}

async function readClaudeProjectImport(projectRoot: string): Promise<OpenScoutClaudeImport | null> {
  const slug = encodeClaudeProjectsSlug(projectRoot);
  const sourcePath = join(currentHomeDirectory(), ".claude", "projects", slug);
  if (!(await isDirectory(sourcePath))) {
    return null;
  }

  const memoryPath = await pathExists(join(sourcePath, "memory", "MEMORY.md"))
    ? join(sourcePath, "memory", "MEMORY.md")
    : undefined;

  let entries: string[] = [];
  try {
    entries = await readdir(sourcePath, { withFileTypes: false });
  } catch {
    entries = [];
  }

  const recentDirectories = new Set<string>();
  const gitBranches = new Set<string>();
  let sessionCount = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) {
      continue;
    }
    sessionCount += 1;
    const sessionPath = join(sourcePath, entry);
    let body: string;
    try {
      body = await readFile(sessionPath, "utf8");
    } catch {
      continue;
    }

    let lineCount = 0;
    for (const line of body.split("\n")) {
      if (lineCount++ >= 200) {
        break;
      }
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const cwd = normalizeOptionalString(parsed.cwd);
        if (cwd) {
          recentDirectories.add(cwd);
        }
        const gitBranch = normalizeOptionalString(parsed.gitBranch);
        if (gitBranch) {
          gitBranches.add(gitBranch);
        }
      } catch {
        continue;
      }
    }
  }

  return {
    sourcePath,
    importedAt: nowSeconds(),
    slug,
    ...(memoryPath ? { memoryPath } : {}),
    ...(recentDirectories.size > 0 ? { recentDirectories: Array.from(recentDirectories).sort() } : {}),
    ...(gitBranches.size > 0 ? { gitBranches: Array.from(gitBranches).sort() } : {}),
    ...(sessionCount > 0 ? { sessionCount } : {}),
  };
}

function applyImportedEnvironmentSeeds(
  config: OpenScoutProjectConfig,
  codexImport: OpenScoutCodexImport | null,
  projectRoot: string,
): OpenScoutProjectConfig {
  const { imports: _ignoredImports, ...configWithoutImports } = config;
  const nextImports = { ...(config.imports ?? {}) };
  if (codexImport) {
    nextImports.codex = codexImport;
  } else {
    delete nextImports.codex;
  }

  const next: OpenScoutProjectConfig = {
    ...configWithoutImports,
    ...(Object.keys(nextImports).length > 0 ? { imports: nextImports } : {}),
  };

  const importedEnvironment = codexImport?.environment;
  if (importedEnvironment) {
    next.environment = {
      ...(config.environment ?? {}),
      ...(!(config.environment?.setup) && importedEnvironment.setup ? { setup: importedEnvironment.setup } : {}),
      ...((config.environment?.actions?.length ?? 0) === 0 && importedEnvironment.actions
        ? { actions: importedEnvironment.actions }
        : {}),
    };
  }

  const defaultProjectName = titleCase(basename(projectRoot));
  if (codexImport?.name?.trim() && (!config.project.name?.trim() || config.project.name === defaultProjectName)) {
    next.project = {
      ...config.project,
      name: codexImport.name.trim(),
    };
  }

  return next;
}

async function syncProjectConfigFromLocalSources(
  projectRoot: string,
  config: OpenScoutProjectConfig,
): Promise<{ config: OpenScoutProjectConfig; changed: boolean }> {
  const [codexImport, claudeImport] = await Promise.all([
    readCodexEnvironmentImport(projectRoot),
    readClaudeProjectImport(projectRoot),
  ]);

  const seeded = applyImportedEnvironmentSeeds(config, codexImport, projectRoot);
  const { imports: _ignoredImports, ...seededWithoutImports } = seeded;
  const nextImports = { ...(seeded.imports ?? {}) };
  if (claudeImport) {
    nextImports.claude = claudeImport;
  } else {
    delete nextImports.claude;
  }
  const nextConfig: OpenScoutProjectConfig = {
    ...seededWithoutImports,
    ...(Object.keys(nextImports).length > 0 ? { imports: nextImports } : {}),
  };

  const changed = JSON.stringify(config) !== JSON.stringify(nextConfig);
  return { config: nextConfig, changed };
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
  const node = typeof candidate.node === "object" && candidate.node ? candidate.node as Record<string, unknown> : {};
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
  const hiddenProjectRoots = uniquePaths(
    Array.isArray(discovery.hiddenProjectRoots)
      ? discovery.hiddenProjectRoots.map((entry) => String(entry))
      : [],
  );
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
    node: {
      alias: normalizeOptionalString(node.alias),
    },
    discovery: {
      contextRoot,
      workspaceRoots,
      includeCurrentRepo: typeof discovery.includeCurrentRepo === "boolean"
        ? discovery.includeCurrentRepo
        : base.discovery.includeCurrentRepo,
      hiddenProjectRoots,
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

export function resolveOpenScoutSetupContextRoot(options: {
  env?: NodeJS.ProcessEnv;
  fallbackDirectory?: string | null;
} = {}): string {
  const env = options.env ?? process.env;
  const explicit = env.OPENSCOUT_SETUP_CWD?.trim();
  if (explicit) {
    return normalizePath(explicit);
  }

  const home = env.HOME?.trim() || homedir();
  const supportDirectory = env.OPENSCOUT_SUPPORT_DIRECTORY?.trim()
    || join(home, "Library", "Application Support", "OpenScout");
  const settingsPath = join(supportDirectory, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        discovery?: {
          contextRoot?: unknown;
          workspaceRoots?: unknown;
        };
      };
      const discovery = raw.discovery;
      if (typeof discovery?.contextRoot === "string" && discovery.contextRoot.trim()) {
        return normalizePath(discovery.contextRoot);
      }
      if (Array.isArray(discovery?.workspaceRoots)) {
        const workspaceRoot = discovery.workspaceRoots.find(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        );
        if (workspaceRoot) {
          return normalizePath(workspaceRoot);
        }
      }
    } catch {
      // Ignore malformed settings and fall back below.
    }
  }

  if (options.fallbackDirectory?.trim()) {
    return normalizePath(options.fallbackDirectory);
  }

  return normalizePath(process.cwd());
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
    node: {
      ...current.node,
      ...(settings.node ?? {}),
    },
    discovery: {
      ...current.discovery,
      ...(settings.discovery ?? {}),
      hiddenProjectRoots: settings.discovery?.hiddenProjectRoots
        ? uniquePaths(settings.discovery.hiddenProjectRoots.map((entry) => String(entry)))
        : current.discovery.hiddenProjectRoots,
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

const SCOUT_SKILL_FILE_NAME = "SKILL.md";

const SETUP_MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCOUT_SKILL_REPO_ROOT = resolve(SETUP_MODULE_DIRECTORY, "..", "..", "..");

// Codex's canonical user-level skills path is `~/.agents/skills/` (the
// loader at codex-rs/core-skills/src/loader.rs marks `~/.codex/skills/` as
// deprecated). Claude Code still keys off `~/.claude/skills/`.
const SCOUT_SKILL_INSTALL_PATHS: Partial<Record<ManagedAgentHarness, string>> = {
  claude: join(homedir(), ".claude", "skills", "scout", SCOUT_SKILL_FILE_NAME),
  codex: join(homedir(), ".agents", "skills", "scout", SCOUT_SKILL_FILE_NAME),
};

function resolveScoutSkillSourcePath(): string | null {
  const candidates = [
    join(SCOUT_SKILL_REPO_ROOT, ".agents", "skills", "scout", SCOUT_SKILL_FILE_NAME),
    join(homedir(), ".agents", "skills", "scout", SCOUT_SKILL_FILE_NAME),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

export type ScoutSkillInstallEntry = {
  harness: ManagedAgentHarness;
  target: string;
  status: "installed" | "skipped" | "error";
  error?: string;
};

export type ScoutSkillInstallReport = {
  source: string | null;
  entries: ScoutSkillInstallEntry[];
};

export async function installScoutSkillToHarnesses(): Promise<ScoutSkillInstallReport> {
  const source = resolveScoutSkillSourcePath();
  if (!source) {
    return { source: null, entries: [] };
  }

  const content = await readFile(source, "utf8");
  const entries: ScoutSkillInstallEntry[] = [];

  for (const harness of MANAGED_AGENT_HARNESSES) {
    const target = SCOUT_SKILL_INSTALL_PATHS[harness];
    if (!target) {
      entries.push({ harness, target: "", status: "skipped" });
      continue;
    }
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      entries.push({ harness, target, status: "installed" });
    } catch (error) {
      entries.push({
        harness,
        target,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { source, entries };
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
      const concreteAgentId = buildRelayAgentInstance(definitionId, projectRoot).id;
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
      const concreteAgentId = buildRelayAgentInstance(definitionId, projectRoot).id;
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

  const candidate = raw as OpenScoutProjectConfig & {
    environment?: unknown;
    imports?: unknown;
  };
  const { environment: _ignoredEnvironment, imports: _ignoredImports, ...candidateWithoutImported } = candidate;
  const imports = typeof candidate.imports === "object" && candidate.imports
    ? candidate.imports as Record<string, unknown>
    : {};
  const environment = normalizeProjectEnvironment(candidate.environment);
  const codexImport = normalizeCodexImport(imports.codex);
  const claudeImport = normalizeClaudeImport(imports.claude);

  return {
    ...candidateWithoutImported,
    ...(environment ? { environment } : {}),
    ...(codexImport || claudeImport
      ? {
          imports: {
            ...(codexImport ? { codex: codexImport } : {}),
            ...(claudeImport ? { claude: claudeImport } : {}),
          },
        }
      : {}),
  };
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
  config: OpenScoutProjectConfig | null;
  created: boolean;
}> {
  const projectRoot = await findNearestProjectRoot(currentDirectory) ?? normalizePath(currentDirectory);

  const existing = await readProjectConfig(projectRoot);
  if (existing) {
    const synced = await syncProjectConfigFromLocalSources(projectRoot, existing);
    if (synced.changed) {
      await writeProjectConfig(projectRoot, synced.config);
    }
    await ensureProjectConfigIgnored(projectRoot);
    return {
      projectRoot,
      projectConfigPath: projectConfigPath(projectRoot),
      config: synced.changed ? synced.config : existing,
      created: false,
    };
  }

  const effectiveSettings = settings ?? await readOpenScoutSettings({ currentDirectory });
  const preferredHarness = await detectPreferredHarness(projectRoot, effectiveSettings.agents.defaultHarness);
  const synced = await syncProjectConfigFromLocalSources(
    projectRoot,
    defaultProjectConfig(projectRoot, effectiveSettings, preferredHarness),
  );
  await writeProjectConfig(projectRoot, synced.config);
  await removeLegacyRelayLink(projectRoot);

  return {
    projectRoot,
    projectConfigPath: projectConfigPath(projectRoot),
    config: synced.config,
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

const PROJECT_SCAN_MAX_DEPTH = 64;

async function tryCanonicalDirectory(dir: string): Promise<string | null> {
  try {
    return await realpath(dir);
  } catch {
    return null;
  }
}

/** Collapse multiple candidate paths that resolve to the same directory (symlinks, overlaps). */
async function dedupeResolvedAgentsByCanonicalProjectRoot(
  agents: ResolvedRelayAgentConfig[],
): Promise<ResolvedRelayAgentConfig[]> {
  if (agents.length <= 1) {
    return agents;
  }

  const rank = (agent: ResolvedRelayAgentConfig) =>
    (agent.registrationKind === "configured" ? 4 : 0)
    + (agent.projectConfigPath ? 2 : 0)
    + (agent.source === "manifest" ? 1 : 0);

  const pickWinner = (agent: ResolvedRelayAgentConfig, prev: ResolvedRelayAgentConfig) => {
    const ra = rank(agent);
    const rb = rank(prev);
    if (ra !== rb) {
      return ra > rb ? agent : prev;
    }
    if (agent.projectRoot.length !== prev.projectRoot.length) {
      return agent.projectRoot.length < prev.projectRoot.length ? agent : prev;
    }
    return agent.projectRoot < prev.projectRoot ? agent : prev;
  };

  const byCanon = new Map<string, ResolvedRelayAgentConfig>();
  for (const agent of agents) {
    let canon: string;
    try {
      canon = await realpath(agent.projectRoot);
    } catch {
      canon = normalizePath(agent.projectRoot);
    }
    const prev = byCanon.get(canon);
    byCanon.set(canon, prev ? pickWinner(agent, prev) : agent);
  }

  // Two project roots can resolve to the same agent FQN (same definitionId +
  // branch + node). Without a path fingerprint to disambiguate, they collide;
  // keep the higher-ranked one so downstream consumers see a single owner.
  const byAgentId = new Map<string, ResolvedRelayAgentConfig>();
  for (const agent of byCanon.values()) {
    const prev = byAgentId.get(agent.agentId);
    byAgentId.set(agent.agentId, prev ? pickWinner(agent, prev) : agent);
  }

  return Array.from(byAgentId.values());
}

async function scanSourceRoot(sourceRoot: string): Promise<ProjectScanCandidate[]> {
  const discovered = new Map<string, ProjectScanCandidate>();
  const visitedCanonical = new Set<string>();

  async function walk(currentDirectory: string, depth: number): Promise<void> {
    if (depth > PROJECT_SCAN_MAX_DEPTH) {
      return;
    }

    const canonical = await tryCanonicalDirectory(currentDirectory);
    if (!canonical) {
      return;
    }
    if (visitedCanonical.has(canonical)) {
      return;
    }
    visitedCanonical.add(canonical);

    const entries = await readdir(currentDirectory, { withFileTypes: true }).catch(() => []);
    const entryNames = new Set(entries.map((entry) => entry.name));

    const strongMarkers = [
      ...matchFlatMarkers(entryNames, PROJECT_STRONG_MARKERS_FLAT_NESTED.flat),
      ...(await matchNestedMarkers(currentDirectory, PROJECT_STRONG_MARKERS_FLAT_NESTED.nested)),
    ];
    if (strongMarkers.length > 0) {
      discovered.set(currentDirectory, {
        projectRoot: currentDirectory,
        sourceRoot,
      });
    }

    const weakMarkers = [
      ...matchFlatMarkers(entryNames, PROJECT_WEAK_MARKERS_FLAT_NESTED.flat),
      ...(await matchNestedMarkers(currentDirectory, PROJECT_WEAK_MARKERS_FLAT_NESTED.nested)),
    ];
    if (weakMarkers.length > 0) {
      discovered.set(currentDirectory, {
        projectRoot: currentDirectory,
        sourceRoot,
      });
    }

    // One project per matched directory: do not descend into children (monorepo = single row).
    if (strongMarkers.length > 0 || weakMarkers.length > 0) {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".openscout") {
        continue;
      }
      if (PROJECT_SCAN_SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const nextPath = join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        if (!(await isDirectory(nextPath))) {
          continue;
        }
      } else if (!entry.isDirectory()) {
        continue;
      }

      await walk(nextPath, depth + 1);
    }
  }

  await walk(sourceRoot, 0);
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

  const overrideIsManual = override.source === "manual";
  const manifestOwnsResolvedConfig = base.source === "manifest" && !overrideIsManual;
  const overrideLaunchArgs = normalizeLaunchArgs(override.launchArgs);
  const overrideCapabilities = normalizeCapabilities(override.capabilities);

  const definitionId = manifestOwnsResolvedConfig ? base.definitionId : (override.definitionId || base.definitionId);
  const projectRoot = manifestOwnsResolvedConfig
    ? base.projectRoot
    : (override.projectRoot ? normalizePath(override.projectRoot) : base.projectRoot);
  const instance = buildRelayAgentInstance(definitionId, projectRoot);
  const defaultHarness = normalizeManagedHarness(
    manifestOwnsResolvedConfig
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
      ...(manifestOwnsResolvedConfig ? {} : (override.harnessProfiles ?? {})),
    },
    runtime: manifestOwnsResolvedConfig ? undefined : override.runtime,
    launchArgs: manifestOwnsResolvedConfig ? base.launchArgs : overrideLaunchArgs,
  });
  const view = resolvedRuntimeView(defaultHarness, harnessProfiles);

  return {
    ...base,
    agentId: instance.id,
    definitionId,
    displayName: manifestOwnsResolvedConfig ? base.displayName : (override.displayName?.trim() || base.displayName),
    projectName: manifestOwnsResolvedConfig ? base.projectName : (override.projectName?.trim() || base.projectName),
    projectRoot,
    projectConfigPath: manifestOwnsResolvedConfig ? base.projectConfigPath : (override.projectConfigPath ?? base.projectConfigPath),
    source: manifestOwnsResolvedConfig ? base.source : (override.source ?? base.source),
    registrationKind: isConfiguredRelayAgentOverride(instance.id, override, settings)
      ? "configured"
      : base.registrationKind,
    startedAt: Number.isFinite(override.startedAt) && override.startedAt ? Math.floor(override.startedAt) : base.startedAt,
    systemPrompt: overrideIsManual
      ? (override.systemPrompt?.trim() || base.systemPrompt)
      : (base.systemPrompt || override.systemPrompt?.trim() || undefined),
    launchArgs: view.launchArgs,
    capabilities: manifestOwnsResolvedConfig
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
  /** Plain-text doctor / UI: invoked after each project row is built (sorted by relative path). */
  onProjectInventoryEntry?: (entry: ProjectInventoryEntry) => void | Promise<void>;
  /** Home used for ~/.claude/projects, Cursor workspaceStorage, ~/.codex hints. Defaults to os.homedir(). */
  userLevelHintsHome?: string;
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
  let currentProjectConfig: {
    projectRoot: string | null;
    projectConfigPath: string | null;
    config?: OpenScoutProjectConfig | null;
    created: boolean;
  } = {
    projectRoot: null,
    projectConfigPath: null,
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

  const hiddenProjectRoots = new Set(settings.discovery.hiddenProjectRoots.map((entry) => normalizePath(entry)));
  const workspaceCandidates = await scanWorkspaceRoots(settings.discovery.workspaceRoots);
  const projectCandidates = new Set<string>(workspaceCandidates.map((candidate) => candidate.projectRoot));
  const sourceRootByProject = new Map<string, string>(
    workspaceCandidates.map((candidate) => [candidate.projectRoot, candidate.sourceRoot]),
  );

  if (process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS !== "1") {
    try {
      const hintHome = options.userLevelHintsHome ?? homedir();
      const userHints = await collectUserLevelProjectRootHints({ home: hintHome });
      for (const hint of userHints) {
        const normalized = normalizePath(hint);
        if (hiddenProjectRoots.has(normalized)) {
          continue;
        }
        if (projectCandidates.has(normalized)) {
          continue;
        }
        projectCandidates.add(normalized);
        sourceRootByProject.set(
          normalized,
          sourceRootForProject(normalized, settings.discovery.workspaceRoots),
        );
      }
    } catch {
      /* best-effort: ignore hint collection failures */
    }
  }

  const overrideByRoot = buildOverrideIndexByProjectRoot(overrides);

  if (settings.discovery.includeCurrentRepo && currentProjectConfig.projectRoot) {
    const normalizedCurrentProjectRoot = normalizePath(currentProjectConfig.projectRoot);
    if (!hiddenProjectRoots.has(normalizedCurrentProjectRoot)) {
      projectCandidates.add(normalizedCurrentProjectRoot);
      sourceRootByProject.set(
        normalizedCurrentProjectRoot,
        sourceRootForProject(normalizedCurrentProjectRoot, settings.discovery.workspaceRoots),
      );
    }
  }

  for (const override of Object.values(overrides)) {
    const normalizedRoot = normalizePath(override.projectRoot);
    if (hiddenProjectRoots.has(normalizedRoot)) {
      continue;
    }
    projectCandidates.add(normalizedRoot);
    sourceRootByProject.set(
      normalizedRoot,
      sourceRootForProject(normalizedRoot, settings.discovery.workspaceRoots),
    );
  }

  const resolvedAgents: ResolvedRelayAgentConfig[] = [];
  for (const projectRoot of Array.from(projectCandidates).sort()) {
    if (hiddenProjectRoots.has(normalizePath(projectRoot))) {
      continue;
    }
    const manifest = await readProjectConfig(projectRoot);
    const override = overrideByRoot.get(projectRoot);
    const resolvedAgent = manifest
      ? await resolveManifestBackedAgent(projectRoot, manifest, settings, override)
      : await resolveInferredAgent(projectRoot, settings, override);

    if (!resolvedAgent.agentId || BUILT_IN_AGENT_DEFINITION_IDS.has(resolvedAgent.definitionId)) {
      continue;
    }

    resolvedAgents.push(resolvedAgent);
  }

  const dedupedResolvedAgents = await dedupeResolvedAgentsByCanonicalProjectRoot(resolvedAgents);

  const configuredAgents = dedupedResolvedAgents.filter((agent) => agent.registrationKind === "configured");
  const builtInOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, record]) => record.definitionId ? BUILT_IN_AGENT_DEFINITION_IDS.has(record.definitionId) : false),
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

  const sortedForInventory = dedupedResolvedAgents.slice().sort((lhs, rhs) => {
    const sourceRootL = sourceRootByProject.get(lhs.projectRoot)
      ?? sourceRootForProject(lhs.projectRoot, settings.discovery.workspaceRoots);
    const sourceRootR = sourceRootByProject.get(rhs.projectRoot)
      ?? sourceRootForProject(rhs.projectRoot, settings.discovery.workspaceRoots);
    const pathCmp = relativeProjectPath(lhs.projectRoot, sourceRootL).localeCompare(
      relativeProjectPath(rhs.projectRoot, sourceRootR),
    );
    if (pathCmp !== 0) {
      return pathCmp;
    }
    return lhs.displayName.localeCompare(rhs.displayName);
  });

  const projectInventory: ProjectInventoryEntry[] = [];
  for (const agent of sortedForInventory) {
    const sourceRoot = sourceRootByProject.get(agent.projectRoot)
      ?? sourceRootForProject(agent.projectRoot, settings.discovery.workspaceRoots);
    const row = await buildProjectInventoryEntry(agent, sourceRoot);
    projectInventory.push(row);
    await options.onProjectInventoryEntry?.(row);
  }

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
    discoveredAgents: dedupedResolvedAgents.sort((lhs, rhs) => lhs.displayName.localeCompare(rhs.displayName)),
    projectInventory,
  };
}

export async function resolveRelayAgentConfig(
  value: string | AgentSelector,
  options: {
    currentDirectory?: string;
    ensureCurrentProjectConfig?: boolean;
  } = {},
): Promise<ResolvedRelayAgentConfig | null> {
  const setup = await loadResolvedRelayAgents({
    currentDirectory: options.currentDirectory,
    ensureCurrentProjectConfig: options.ensureCurrentProjectConfig,
  });

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      const exact = setup.discoveredAgents.find((agent) => agent.agentId === trimmed);
      if (exact) {
        return exact;
      }
    }
  }

  const selector = selectorFromInput(value);
  if (!selector) {
    return null;
  }

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
  const resolvedProjectRoot = options.projectRoot
    ? normalizePath(options.projectRoot)
    : options.currentDirectory
      ? (await findNearestProjectRoot(options.currentDirectory)) ?? normalizePath(options.currentDirectory)
      : normalizePath(process.cwd());
  const qualifiedAgentId = buildRelayAgentInstance(SCOUT_AGENT_ID, resolvedProjectRoot).id;
  const existing = overrides[qualifiedAgentId] ?? overrides[SCOUT_AGENT_ID];

  const nextOverride: RelayAgentOverride = {
    ...existing,
    agentId: qualifiedAgentId,
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
      sessionKey: qualifiedAgentId,
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

  if (overrides[SCOUT_AGENT_ID]) {
    delete overrides[SCOUT_AGENT_ID];
  }
  if (JSON.stringify(overrides[qualifiedAgentId]) !== JSON.stringify(nextOverride)) {
    overrides[qualifiedAgentId] = nextOverride;
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
