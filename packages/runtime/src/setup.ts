import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import type { AgentCapability, AgentHarness } from "@openscout/protocol";

import { resolveOpenScoutSupportPaths } from "./support-paths.js";

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
      defaults?: {
        cwd?: string;
        harness?: AgentHarness;
        transport?: "tmux";
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
  discovery: {
    workspaceRoots: string[];
    includeCurrentRepo: boolean;
  };
  agents: {
    defaultHarness: AgentHarness;
    defaultTransport: "tmux";
    defaultCapabilities: AgentCapability[];
    sessionPrefix: string;
  };
};

export type RelayAgentOverride = {
  agentId: string;
  displayName?: string;
  projectName?: string;
  projectRoot: string;
  projectConfigPath?: string | null;
  source?: "manifest" | "inferred" | "legacy-import" | "manual";
  startedAt?: number;
  systemPrompt?: string;
  launchArgs?: string[];
  capabilities?: AgentCapability[];
  runtime?: {
    cwd?: string;
    harness?: AgentHarness;
    transport?: "tmux";
    sessionId?: string;
    wakePolicy?: "on_demand";
  };
};

export type ResolvedRelayAgentConfig = {
  agentId: string;
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
  runtime: {
    cwd: string;
    harness: AgentHarness;
    transport: "tmux";
    sessionId: string;
    wakePolicy: "on_demand";
  };
};

export type SetupResult = {
  supportDirectory: string;
  settingsPath: string;
  relayAgentsPath: string;
  relayHubPath: string;
  currentProjectConfigPath: string | null;
  createdProjectConfig: boolean;
  settings: OpenScoutSettings;
  agents: ResolvedRelayAgentConfig[];
  discoveredAgents: ResolvedRelayAgentConfig[];
};

export type UpdateOpenScoutSettingsInput = {
  profile?: Partial<OpenScoutSettings["profile"]>;
  discovery?: Partial<OpenScoutSettings["discovery"]>;
  agents?: Partial<OpenScoutSettings["agents"]>;
};

type LegacyRelayConfig = {
  projectRoot?: string;
};

type LegacyTwinRecord = {
  project?: string;
  tmuxSession?: string;
  cwd?: string;
  startedAt?: number;
  systemPrompt?: string;
  harness?: AgentHarness;
  transport?: "tmux";
  capabilities?: AgentCapability[];
  launchArgs?: string[];
};

type LegacyRelayAgentRecord = {
  cwd?: string;
  project?: string;
  session?: string;
};

const DEFAULT_OPERATOR_NAME = process.env.OPENSCOUT_OPERATOR_NAME?.trim() || "Arach";
const DEFAULT_CAPABILITIES: AgentCapability[] = ["chat", "invoke", "deliver"];
const DEFAULT_TRANSPORT = "tmux" as const;
const SETTINGS_VERSION = 1;
const PROJECT_CONFIG_VERSION = 1;
const BUILT_IN_AGENT_IDS = new Set(["scout", "builder", "reviewer", "research"]);

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
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  return {
    version: SETTINGS_VERSION,
    profile: {
      operatorName: DEFAULT_OPERATOR_NAME,
    },
    discovery: {
      workspaceRoots: [],
      includeCurrentRepo: true,
    },
    agents: {
      defaultHarness: "claude",
      defaultTransport: DEFAULT_TRANSPORT,
      defaultCapabilities: [...DEFAULT_CAPABILITIES],
      sessionPrefix: "relay",
    },
  };
}

function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".openscout", "project.json");
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

async function readLegacyRelayConfig(): Promise<LegacyRelayConfig | null> {
  const relayHub = resolveOpenScoutSupportPaths().relayHubDirectory;
  return readJsonFile<LegacyRelayConfig>(join(relayHub, "config.json"));
}

async function readLegacyTwinsRegistry(): Promise<Record<string, LegacyTwinRecord>> {
  const relayHub = resolveOpenScoutSupportPaths().relayHubDirectory;
  return (await readJsonFile<Record<string, LegacyTwinRecord>>(join(relayHub, "twins.json"))) ?? {};
}

async function readLegacyRelayAgentsRegistry(): Promise<Record<string, LegacyRelayAgentRecord>> {
  const relayHub = resolveOpenScoutSupportPaths().relayHubDirectory;
  return (await readJsonFile<Record<string, LegacyRelayAgentRecord>>(join(relayHub, "agents.json"))) ?? {};
}

export async function detectPreferredHarness(projectRoot: string, fallback: AgentHarness = "claude"): Promise<AgentHarness> {
  const codexMarkers = [
    "AGENTS.md",
    ".agents",
    ".codex",
  ];
  for (const marker of codexMarkers) {
    if (await pathExists(join(projectRoot, marker))) {
      return "codex";
    }
  }

  const claudeMarkers = [
    "CLAUDE.md",
    ".claude",
  ];
  for (const marker of claudeMarkers) {
    if (await pathExists(join(projectRoot, marker))) {
      return "claude";
    }
  }

  return fallback;
}

async function normalizeSettingsRecord(
  value: unknown,
  options: { currentDirectory?: string; legacyRelayConfig?: LegacyRelayConfig | null; legacyTwins?: Record<string, LegacyTwinRecord> } = {},
): Promise<OpenScoutSettings> {
  const base = defaultSettings();
  const candidate = typeof value === "object" && value ? value as Record<string, unknown> : {};
  const profile = typeof candidate.profile === "object" && candidate.profile ? candidate.profile as Record<string, unknown> : {};
  const discovery = typeof candidate.discovery === "object" && candidate.discovery ? candidate.discovery as Record<string, unknown> : {};
  const agents = typeof candidate.agents === "object" && candidate.agents ? candidate.agents as Record<string, unknown> : {};
  const oldOperatorName = typeof candidate.operatorName === "string" ? candidate.operatorName : undefined;

  const seededWorkspaceRoots = await seedWorkspaceRoots({
    currentDirectory: options.currentDirectory,
    legacyRelayConfig: options.legacyRelayConfig ?? null,
    legacyTwins: options.legacyTwins ?? {},
  });

  const rawWorkspaceRoots = Array.isArray(discovery.workspaceRoots)
    ? discovery.workspaceRoots.map((entry) => String(entry))
    : [];
  const workspaceRoots = uniquePaths(rawWorkspaceRoots.length > 0 ? rawWorkspaceRoots : seededWorkspaceRoots);

  return {
    version: SETTINGS_VERSION,
    profile: {
      operatorName: String(profile.operatorName ?? oldOperatorName ?? base.profile.operatorName).trim() || base.profile.operatorName,
    },
    discovery: {
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
  };
}

async function seedWorkspaceRoots(options: {
  currentDirectory?: string;
  legacyRelayConfig?: LegacyRelayConfig | null;
  legacyTwins?: Record<string, LegacyTwinRecord>;
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

  for (const record of Object.values(options.legacyTwins ?? {})) {
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
  const supportPaths = resolveOpenScoutSupportPaths();
  const legacyRelayConfig = await readLegacyRelayConfig();
  const legacyTwins = await readLegacyTwinsRegistry();
  const rawSettings = await readJsonFile<unknown>(supportPaths.settingsPath);
  return normalizeSettingsRecord(rawSettings, {
    currentDirectory: options.currentDirectory,
    legacyRelayConfig,
    legacyTwins,
  });
}

export async function writeOpenScoutSettings(settings: UpdateOpenScoutSettingsInput, options: { currentDirectory?: string } = {}): Promise<OpenScoutSettings> {
  const current = await readOpenScoutSettings(options);
  const merged = {
    ...current,
    ...settings,
    profile: {
      ...current.profile,
      ...(settings.profile ?? {}),
    },
    discovery: {
      ...current.discovery,
      ...(settings.discovery ?? {}),
    },
    agents: {
      ...current.agents,
      ...(settings.agents ?? {}),
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
      const normalizedId = normalizeAgentId(record.agentId || agentId);
      const projectRoot = normalizePath(record.projectRoot);
      return [
        normalizedId,
        {
          ...record,
          agentId: normalizedId,
          projectRoot,
          projectConfigPath: record.projectConfigPath ? normalizePath(record.projectConfigPath) : null,
          source: record.source ?? "manual",
          startedAt: Number.isFinite(record.startedAt) && record.startedAt ? Math.floor(record.startedAt) : nowSeconds(),
          runtime: {
            cwd: record.runtime?.cwd ? normalizePath(record.runtime.cwd) : projectRoot,
            harness: normalizeHarness(record.runtime?.harness, "claude"),
            transport: DEFAULT_TRANSPORT,
            sessionId: normalizeTmuxSessionName(record.runtime?.sessionId, normalizedId),
            wakePolicy: "on_demand",
          },
          launchArgs: normalizeLaunchArgs(record.launchArgs),
          capabilities: normalizeCapabilities(record.capabilities),
        } satisfies RelayAgentOverride,
      ];
    }),
  );
}

export async function writeRelayAgentOverrides(overrides: Record<string, RelayAgentOverride>): Promise<void> {
  const normalizedAgents = Object.fromEntries(
    Object.entries(overrides).map(([agentId, record]) => {
      const normalizedId = normalizeAgentId(record.agentId || agentId);
      return [
        normalizedId,
        {
          ...record,
          agentId: normalizedId,
          projectRoot: normalizePath(record.projectRoot),
          projectConfigPath: record.projectConfigPath ? normalizePath(record.projectConfigPath) : null,
          source: record.source ?? "manual",
          startedAt: Number.isFinite(record.startedAt) && record.startedAt ? Math.floor(record.startedAt) : nowSeconds(),
          runtime: {
            cwd: record.runtime?.cwd ? normalizePath(record.runtime.cwd) : normalizePath(record.projectRoot),
            harness: normalizeHarness(record.runtime?.harness, "claude"),
            transport: DEFAULT_TRANSPORT,
            sessionId: normalizeTmuxSessionName(record.runtime?.sessionId, normalizedId),
            wakePolicy: "on_demand",
          },
          launchArgs: normalizeLaunchArgs(record.launchArgs),
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
  const agentId = normalizeAgentId(projectName);
  const relativeRoot = relative(projectRoot, projectRoot) || ".";

  return {
    version: PROJECT_CONFIG_VERSION,
    project: {
      id: projectName,
      name: titleCase(projectName),
      root: relativeRoot,
    },
    agent: {
      id: agentId,
      displayName: titleCase(agentId),
      prompt: {},
      runtime: {
        defaults: {
          cwd: ".",
          harness: preferredHarness,
          transport: settings.agents.defaultTransport,
          sessionId: normalizeTmuxSessionName(undefined, agentId, settings.agents.sessionPrefix),
          launchArgs: [],
          capabilities: [...settings.agents.defaultCapabilities],
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
}

async function ensureLegacyRelayLink(projectRoot: string): Promise<void> {
  const supportPaths = resolveOpenScoutSupportPaths();
  if (await pathExists(legacyLocalRelayLinkPath(projectRoot))) {
    return;
  }

  await writeJsonFile(legacyLocalRelayLinkPath(projectRoot), {
    hub: compactHomePath(supportPaths.relayHubDirectory),
  });
}

export async function ensureProjectConfigForDirectory(currentDirectory: string, settings?: OpenScoutSettings): Promise<{
  projectRoot: string | null;
  projectConfigPath: string | null;
  created: boolean;
}> {
  const projectRoot = await findNearestProjectRoot(currentDirectory);
  if (!projectRoot) {
    return {
      projectRoot: null,
      projectConfigPath: null,
      created: false,
    };
  }

  const existing = await readProjectConfig(projectRoot);
  if (existing) {
    return {
      projectRoot,
      projectConfigPath: projectConfigPath(projectRoot),
      created: false,
    };
  }

  const effectiveSettings = settings ?? await readOpenScoutSettings({ currentDirectory });
  const preferredHarness = await detectPreferredHarness(projectRoot, effectiveSettings.agents.defaultHarness);
  await writeProjectConfig(projectRoot, defaultProjectConfig(projectRoot, effectiveSettings, preferredHarness));
  await ensureLegacyRelayLink(projectRoot);

  return {
    projectRoot,
    projectConfigPath: projectConfigPath(projectRoot),
    created: true,
  };
}

async function inferProjectCandidate(projectRoot: string): Promise<boolean> {
  const markers = [
    join(projectRoot, ".git"),
    join(projectRoot, ".openscout", "project.json"),
    join(projectRoot, "package.json"),
    join(projectRoot, "AGENTS.md"),
  ];

  for (const marker of markers) {
    if (await pathExists(marker)) {
      return true;
    }
  }

  return false;
}

async function scanWorkspaceRoots(workspaceRoots: string[]): Promise<string[]> {
  const discovered = new Set<string>();

  for (const workspaceRoot of workspaceRoots) {
    if (!(await isDirectory(workspaceRoot))) {
      continue;
    }

    const entries = await readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const candidateRoot = join(workspaceRoot, entry.name);
      if (await inferProjectCandidate(candidateRoot)) {
        discovered.add(candidateRoot);
      }
    }
  }

  return Array.from(discovered);
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

  return {
    ...base,
    displayName: override.displayName?.trim() || base.displayName,
    projectName: override.projectName?.trim() || base.projectName,
    projectRoot: override.projectRoot ? normalizePath(override.projectRoot) : base.projectRoot,
    projectConfigPath: override.projectConfigPath ?? base.projectConfigPath,
    source: override.source ?? base.source,
    registrationKind: isConfiguredRelayAgentOverride(base.agentId, override, settings)
      ? "configured"
      : base.registrationKind,
    startedAt: Number.isFinite(override.startedAt) && override.startedAt ? Math.floor(override.startedAt) : base.startedAt,
    systemPrompt: override.systemPrompt?.trim() || base.systemPrompt,
    launchArgs: normalizeLaunchArgs(override.launchArgs).length > 0 ? normalizeLaunchArgs(override.launchArgs) : base.launchArgs,
    capabilities: normalizeCapabilities(override.capabilities).length > 0 ? normalizeCapabilities(override.capabilities) : base.capabilities,
    runtime: {
      cwd: override.runtime?.cwd ? normalizePath(override.runtime.cwd) : base.runtime.cwd,
      harness: normalizeHarness(override.runtime?.harness, base.runtime.harness),
      transport: DEFAULT_TRANSPORT,
      sessionId: normalizeTmuxSessionName(
        override.runtime?.sessionId,
        base.agentId,
        settings.agents.sessionPrefix,
      ),
      wakePolicy: "on_demand",
    },
  };
}

async function resolveManifestBackedAgent(
  projectRoot: string,
  config: OpenScoutProjectConfig,
  settings: OpenScoutSettings,
  override: RelayAgentOverride | undefined,
): Promise<ResolvedRelayAgentConfig> {
  const resolvedProjectRoot = resolveProjectRootFromConfig(projectRoot, config);
  const projectName = config.project.name?.trim() || titleCase(config.project.id || basename(resolvedProjectRoot));
  const fallbackAgentId = normalizeAgentId(config.project.id || basename(resolvedProjectRoot));
  const agentId = normalizeAgentId(
    config.agent?.id
      || override?.agentId
      || fallbackAgentId,
  );
  const detectedHarness = await detectPreferredHarness(resolvedProjectRoot, settings.agents.defaultHarness);
  const runtimeDefaults = config.agent?.runtime?.defaults;
  const base: ResolvedRelayAgentConfig = {
    agentId,
    displayName: config.agent?.displayName?.trim() || override?.displayName?.trim() || titleCase(agentId),
    projectName,
    projectRoot: resolvedProjectRoot,
    projectConfigPath: projectConfigPath(projectRoot),
    source: "manifest",
    registrationKind: "configured",
    startedAt: nowSeconds(),
    systemPrompt: config.agent?.prompt?.template?.trim() || undefined,
    launchArgs: normalizeLaunchArgs(runtimeDefaults?.launchArgs),
    capabilities: normalizeCapabilities(runtimeDefaults?.capabilities),
    runtime: {
      cwd: runtimeDefaults?.cwd ? normalizePath(join(projectRoot, runtimeDefaults.cwd)) : resolvedProjectRoot,
      harness: normalizeHarness(runtimeDefaults?.harness, detectedHarness),
      transport: DEFAULT_TRANSPORT,
      sessionId: normalizeTmuxSessionName(runtimeDefaults?.sessionId, agentId, settings.agents.sessionPrefix),
      wakePolicy: "on_demand",
    },
  };

  return mergeResolvedAgentConfig(base, override, settings);
}

async function resolveInferredAgent(
  projectRoot: string,
  settings: OpenScoutSettings,
  override: RelayAgentOverride | undefined,
): Promise<ResolvedRelayAgentConfig> {
  const projectName = basename(projectRoot);
  const overrideId = override?.agentId?.trim();
  const agentId = normalizeAgentId(overrideId || projectName);
  const detectedHarness = await detectPreferredHarness(projectRoot, settings.agents.defaultHarness);
  const base: ResolvedRelayAgentConfig = {
    agentId,
    displayName: override?.displayName?.trim() || titleCase(agentId),
    projectName: override?.projectName?.trim() || titleCase(projectName),
    projectRoot,
    projectConfigPath: null,
    source: override?.source ?? "inferred",
    registrationKind: isConfiguredRelayAgentOverride(agentId, override, settings) ? "configured" : "discovered",
    startedAt: Number.isFinite(override?.startedAt) && override?.startedAt ? Math.floor(override.startedAt) : nowSeconds(),
    systemPrompt: override?.systemPrompt?.trim() || undefined,
    launchArgs: normalizeLaunchArgs(override?.launchArgs),
    capabilities: normalizeCapabilities(override?.capabilities),
    runtime: {
      cwd: override?.runtime?.cwd ? normalizePath(override.runtime.cwd) : projectRoot,
      harness: normalizeHarness(override?.runtime?.harness, detectedHarness),
      transport: DEFAULT_TRANSPORT,
      sessionId: normalizeTmuxSessionName(override?.runtime?.sessionId, agentId, settings.agents.sessionPrefix),
      wakePolicy: "on_demand",
    },
  };

  return mergeResolvedAgentConfig(base, override, settings);
}

async function importLegacyState(currentDirectory?: string): Promise<{
  settings: OpenScoutSettings;
  overrides: Record<string, RelayAgentOverride>;
}> {
  const supportPaths = resolveOpenScoutSupportPaths();
  const legacyRelayConfig = await readLegacyRelayConfig();
  const legacyTwins = await readLegacyTwinsRegistry();
  const legacyRelayAgents = await readLegacyRelayAgentsRegistry();
  const settings = await readOpenScoutSettings({ currentDirectory });
  const overrides = await readRelayAgentOverrides();
  let wroteOverrides = false;

  for (const [agentId, record] of Object.entries(legacyTwins)) {
    const normalizedAgentId = normalizeAgentId(agentId);
    if (BUILT_IN_AGENT_IDS.has(normalizedAgentId) || overrides[normalizedAgentId]) {
      continue;
    }

    const projectRoot = record.cwd?.trim() ? normalizePath(record.cwd) : join(homedir(), "dev", normalizedAgentId);
    overrides[normalizedAgentId] = {
      agentId: normalizedAgentId,
      displayName: titleCase(normalizedAgentId),
      projectName: record.project?.trim() || titleCase(basename(projectRoot)),
      projectRoot,
      source: "legacy-import",
      startedAt: Number.isFinite(record.startedAt) && record.startedAt ? Math.floor(record.startedAt) : nowSeconds(),
      systemPrompt: record.systemPrompt?.trim() || undefined,
      launchArgs: normalizeLaunchArgs(record.launchArgs),
      capabilities: normalizeCapabilities(record.capabilities),
      runtime: {
        cwd: projectRoot,
        harness: normalizeHarness(record.harness, settings.agents.defaultHarness),
        transport: DEFAULT_TRANSPORT,
        sessionId: normalizeTmuxSessionName(record.tmuxSession, normalizedAgentId, settings.agents.sessionPrefix),
        wakePolicy: "on_demand",
      },
    };
    wroteOverrides = true;
  }

  for (const [agentId, record] of Object.entries(legacyRelayAgents)) {
    const normalizedAgentId = normalizeAgentId(agentId);
    if (BUILT_IN_AGENT_IDS.has(normalizedAgentId) || overrides[normalizedAgentId] || !record.cwd?.trim()) {
      continue;
    }

    const projectRoot = normalizePath(record.cwd);
    overrides[normalizedAgentId] = {
      agentId: normalizedAgentId,
      displayName: titleCase(normalizedAgentId),
      projectName: record.project?.trim() || titleCase(basename(projectRoot)),
      projectRoot,
      source: "legacy-import",
      startedAt: nowSeconds(),
      launchArgs: [],
      capabilities: [...settings.agents.defaultCapabilities],
      runtime: {
        cwd: projectRoot,
        harness: await detectPreferredHarness(projectRoot, settings.agents.defaultHarness),
        transport: DEFAULT_TRANSPORT,
        sessionId: normalizeTmuxSessionName(record.session, normalizedAgentId, settings.agents.sessionPrefix),
        wakePolicy: "on_demand",
      },
    };
    wroteOverrides = true;
  }

  if (wroteOverrides) {
    await writeRelayAgentOverrides(overrides);
  }

  // Keep legacy roots flowing into the canonical settings file once it exists.
  if (!existsSync(supportPaths.settingsPath)) {
    const normalizedSettings = await normalizeSettingsRecord(settings, {
      currentDirectory,
      legacyRelayConfig,
      legacyTwins,
    });
    await writeJsonFile(supportPaths.settingsPath, normalizedSettings);
    return {
      settings: normalizedSettings,
      overrides,
    };
  }

  return {
    settings,
    overrides,
  };
}

async function syncLegacyTwinMirror(agents: ResolvedRelayAgentConfig[]): Promise<void> {
  const supportPaths = resolveOpenScoutSupportPaths();
  const mirror = Object.fromEntries(
    agents.map((agent) => [
      agent.agentId,
      {
        project: agent.projectName,
        tmuxSession: agent.runtime.sessionId,
        cwd: agent.runtime.cwd,
        startedAt: agent.startedAt,
        systemPrompt: agent.systemPrompt,
        harness: agent.runtime.harness,
        transport: agent.runtime.transport,
        capabilities: agent.capabilities,
        launchArgs: agent.launchArgs,
      } satisfies LegacyTwinRecord,
    ]),
  );

  await writeJsonFile(join(supportPaths.relayHubDirectory, "twins.json"), mirror);
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
  const supportPaths = resolveOpenScoutSupportPaths();
  await mkdir(supportPaths.supportDirectory, { recursive: true });
  await mkdir(supportPaths.logsDirectory, { recursive: true });
  await mkdir(supportPaths.appLogsDirectory, { recursive: true });
  await mkdir(supportPaths.brokerLogsDirectory, { recursive: true });
  await mkdir(supportPaths.relayAgentsDirectory, { recursive: true });
  await mkdir(supportPaths.relayHubDirectory, { recursive: true });
  await mkdir(supportPaths.controlHome, { recursive: true });

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
  const projectCandidates = new Set<string>(workspaceCandidates);
  const overrideByRoot = buildOverrideIndexByProjectRoot(overrides);

  if (settings.discovery.includeCurrentRepo && currentProjectConfig.projectRoot) {
    projectCandidates.add(currentProjectConfig.projectRoot);
  }

  for (const override of Object.values(overrides)) {
    projectCandidates.add(normalizePath(override.projectRoot));
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
  const nextOverrides = Object.fromEntries(
    configuredAgents.map((agent) => [
      agent.agentId,
      {
        agentId: agent.agentId,
        displayName: agent.displayName,
        projectName: agent.projectName,
        projectRoot: agent.projectRoot,
        projectConfigPath: agent.projectConfigPath,
        source: agent.source === "manifest" ? "manifest" : agent.source,
        startedAt: agent.startedAt,
        systemPrompt: agent.systemPrompt,
        launchArgs: agent.launchArgs,
        capabilities: agent.capabilities,
        runtime: {
          cwd: agent.runtime.cwd,
          harness: agent.runtime.harness,
          transport: agent.runtime.transport,
          sessionId: agent.runtime.sessionId,
          wakePolicy: agent.runtime.wakePolicy,
        },
      } satisfies RelayAgentOverride,
    ]),
  );

  await writeRelayAgentOverrides(nextOverrides);

  if (options.syncLegacyMirror) {
    await syncLegacyTwinMirror(configuredAgents);
    if (currentProjectConfig.projectRoot) {
      await ensureLegacyRelayLink(currentProjectConfig.projectRoot);
    }
  }

  return {
    supportDirectory: supportPaths.supportDirectory,
    settingsPath: supportPaths.settingsPath,
    relayAgentsPath: supportPaths.relayAgentsRegistryPath,
    relayHubPath: supportPaths.relayHubDirectory,
    currentProjectConfigPath: currentProjectConfig.projectConfigPath,
    createdProjectConfig: currentProjectConfig.created,
    settings,
    agents: configuredAgents.sort((lhs, rhs) => lhs.displayName.localeCompare(rhs.displayName)),
    discoveredAgents: resolvedAgents.sort((lhs, rhs) => lhs.displayName.localeCompare(rhs.displayName)),
  };
}

export async function initializeOpenScoutSetup(options: { currentDirectory?: string } = {}): Promise<SetupResult> {
  return loadResolvedRelayAgents({
    currentDirectory: options.currentDirectory,
    ensureCurrentProjectConfig: true,
    syncLegacyMirror: true,
  });
}
