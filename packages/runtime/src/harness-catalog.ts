import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentCapability, AgentHarness } from "@openscout/protocol";

import { resolveOpenScoutSupportPaths } from "./support-paths.js";

export const HARNESS_CATALOG_VERSION = 1;

export type HarnessCatalogSupport = {
  install: boolean;
  workspace: boolean;
  collaboration: boolean;
  browser: boolean;
  files: boolean;
  tunnels: boolean;
  onboarding: boolean;
};

export type HarnessRequirement =
  | {
    kind: "env";
    key: string;
    label?: string;
  }
  | {
    kind: "file";
    path: string;
    label?: string;
    fileType?: "file" | "directory" | "any";
  };

export type HarnessInstallSpec = {
  binary?: string;
  requires?: string[];
  macos?: string;
  linux?: string;
  windows?: string;
  verify?: string;
  verifyWin?: string;
};

export type HarnessReadinessConfig = {
  allOf?: HarnessRequirement[];
  anyOf?: HarnessRequirement[];
  healthcheckCommand?: string;
  loginCommand?: string;
  notReadyMessage?: string;
};

export type HarnessCatalogEntry = {
  name: string;
  harness: AgentHarness | (string & {});
  label: string;
  description: string;
  homepage?: string;
  tags: string[];
  featured?: boolean;
  order?: number;
  support: HarnessCatalogSupport;
  install?: HarnessInstallSpec;
  readiness?: HarnessReadinessConfig;
  launch?: {
    args: string[];
  };
  resolveEnv?: Array<{ from: string; to: string }>;
  capabilities: AgentCapability[];
  metadata?: Record<string, string | number | boolean | null>;
};

export type HarnessCatalogOverride = Partial<Omit<HarnessCatalogEntry, "support" | "install" | "readiness" | "launch">> & {
  support?: Partial<HarnessCatalogSupport>;
  install?: Partial<HarnessInstallSpec>;
  readiness?: Partial<HarnessReadinessConfig>;
  launch?: Partial<HarnessCatalogEntry["launch"]>;
};

export type HarnessCatalogOverrideRecord = {
  version: typeof HARNESS_CATALOG_VERSION;
  entries: Record<string, HarnessCatalogOverride>;
  updatedAt?: string;
};

export type HarnessReadinessState = "ready" | "configured" | "installed" | "missing";

export type HarnessReadinessReport = {
  state: HarnessReadinessState;
  installed: boolean;
  configured: boolean;
  ready: boolean;
  detail: string;
  missing: string[];
  binaryPath: string | null;
  loginCommand: string | null;
};

export type ResolvedHarnessCatalogEntry = HarnessCatalogEntry & {
  source: "builtin" | "local";
  readinessReport: HarnessReadinessReport;
};

export type HarnessCatalogSnapshot = {
  version: typeof HARNESS_CATALOG_VERSION;
  generatedAt: number;
  entries: ResolvedHarnessCatalogEntry[];
};

export type HarnessCatalogLoadOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  overridePath?: string;
  now?: () => number;
  whichBinary?: (binary: string) => string | null;
  requirementExists?: (requirement: Extract<HarnessRequirement, { kind: "file" }>) => boolean;
  runCommand?: (command: string) => boolean;
};

const DEFAULT_SUPPORT: HarnessCatalogSupport = {
  install: true,
  workspace: false,
  collaboration: false,
  browser: false,
  files: false,
  tunnels: false,
  onboarding: true,
};

const BUILT_IN_HARNESS_CATALOG: HarnessCatalogEntry[] = [
  {
    name: "claude",
    harness: "claude",
    label: "Claude Code",
    description: "Anthropic's CLI coding agent",
    homepage: "https://claude.ai/claude-code",
    tags: ["coding", "cli", "anthropic"],
    featured: true,
    order: 1,
    support: {
      ...DEFAULT_SUPPORT,
      workspace: true,
      collaboration: true,
    },
    install: {
      binary: "claude",
      requires: ["node"],
      macos: "npm install -g @anthropic-ai/claude-code",
      linux: "npm install -g @anthropic-ai/claude-code",
      windows: "npm install -g @anthropic-ai/claude-code",
    },
    readiness: {
      anyOf: [
        { kind: "env", key: "ANTHROPIC_API_KEY" },
        { kind: "file", path: "~/.claude/sessions", label: "~/.claude/sessions", fileType: "directory" },
        { kind: "file", path: "~/.claude/.credentials.json", label: "~/.claude/.credentials.json", fileType: "file" },
      ],
      loginCommand: "claude login",
      notReadyMessage: "Claude is installed but not authenticated yet.",
    },
    capabilities: ["chat", "invoke", "deliver", "summarize", "review"],
  },
  {
    name: "codex",
    harness: "codex",
    label: "Codex",
    description: "OpenAI's CLI coding agent",
    homepage: "https://github.com/openai/codex",
    tags: ["coding", "cli", "openai"],
    featured: true,
    order: 2,
    support: {
      ...DEFAULT_SUPPORT,
      workspace: true,
      collaboration: true,
    },
    install: {
      binary: "codex",
      requires: ["node"],
      macos: "npm install -g @openai/codex",
      linux: "npm install -g @openai/codex",
      windows: "npm install -g @openai/codex",
    },
    readiness: {
      anyOf: [
        { kind: "env", key: "OPENAI_API_KEY" },
        { kind: "file", path: "~/.codex/auth.json", label: "~/.codex/auth.json", fileType: "file" },
      ],
      loginCommand: "codex login",
      notReadyMessage: "Codex is installed but not authenticated yet.",
    },
    capabilities: ["chat", "invoke", "deliver", "review", "execute"],
  },
];

function expandHomePath(value: string): string {
  if (value === "~") return process.env.HOME || value;
  if (value.startsWith("~/")) return join(process.env.HOME || "~", value.slice(2));
  return value;
}

function defaultWhichBinary(binary: string, platform: NodeJS.Platform): string | null {
  try {
    const command = platform === "win32" ? "where" : "sh";
    const args = platform === "win32"
      ? [binary]
      : ["-lc", `command -v ${JSON.stringify(binary)}`];
    const raw = execFileSync(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return raw.split(/\r?\n/).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function defaultRunCommand(command: string, platform: NodeJS.Platform): boolean {
  try {
    if (platform === "win32") {
      execFileSync("cmd.exe", ["/d", "/s", "/c", command], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      return true;
    }
    execFileSync("sh", ["-lc", command], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function defaultRequirementExists(requirement: Extract<HarnessRequirement, { kind: "file" }>): boolean {
  const expanded = expandHomePath(requirement.path);
  if (!existsSync(expanded)) return false;
  if (requirement.fileType === "any" || !requirement.fileType) return true;

  try {
    const fileStat = statSync(expanded);
    return requirement.fileType === "directory" ? fileStat.isDirectory() : fileStat.isFile();
  } catch {
    return false;
  }
}

function mergeSupport(
  base: HarnessCatalogSupport,
  override?: Partial<HarnessCatalogSupport>,
): HarnessCatalogSupport {
  return {
    ...base,
    ...(override ?? {}),
  };
}

function mergeInstall(
  base?: HarnessInstallSpec,
  override?: Partial<HarnessInstallSpec>,
): HarnessInstallSpec | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

function mergeReadiness(
  base?: HarnessReadinessConfig,
  override?: Partial<HarnessReadinessConfig>,
): HarnessReadinessConfig | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

function mergeLaunch(
  base?: HarnessCatalogEntry["launch"],
  override?: Partial<HarnessCatalogEntry["launch"]>,
): HarnessCatalogEntry["launch"] | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base ?? { args: [] }),
    ...(override ?? {}),
    args: override?.args ?? base?.args ?? [],
  };
}

function formatRequirement(requirement: HarnessRequirement): string {
  if (requirement.label?.trim()) return requirement.label.trim();
  if (requirement.kind === "env") return requirement.key;
  return requirement.path;
}

function evaluateRequirement(
  requirement: HarnessRequirement,
  options: Required<Pick<HarnessCatalogLoadOptions, "env" | "requirementExists">>,
): boolean {
  if (requirement.kind === "env") {
    return Boolean(options.env[requirement.key]?.trim());
  }
  return options.requirementExists(requirement);
}

function supportSummaryText(entry: HarnessCatalogEntry): string {
  const enabled = Object.entries(entry.support)
    .filter(([key, enabledFlag]) => enabledFlag && key !== "install" && key !== "onboarding")
    .map(([key]) => key);
  return enabled.length > 0 ? enabled.join(", ") : "general use";
}

export function createBuiltInHarnessCatalog(): HarnessCatalogEntry[] {
  return BUILT_IN_HARNESS_CATALOG.map((entry) => ({
    ...entry,
    tags: [...entry.tags],
    support: { ...entry.support },
    install: entry.install ? { ...entry.install, requires: [...(entry.install.requires ?? [])] } : undefined,
    readiness: entry.readiness
      ? {
        ...entry.readiness,
        allOf: entry.readiness.allOf ? [...entry.readiness.allOf] : undefined,
        anyOf: entry.readiness.anyOf ? [...entry.readiness.anyOf] : undefined,
      }
      : undefined,
    launch: entry.launch ? { ...entry.launch, args: [...entry.launch.args] } : undefined,
    resolveEnv: entry.resolveEnv ? [...entry.resolveEnv] : undefined,
    capabilities: [...entry.capabilities],
    metadata: entry.metadata ? { ...entry.metadata } : undefined,
  }));
}

export function mergeHarnessCatalogEntries(
  baseEntries: HarnessCatalogEntry[],
  overrides: Record<string, HarnessCatalogOverride> = {},
): HarnessCatalogEntry[] {
  const mergedEntries = baseEntries.map((entry) => {
    const override = overrides[entry.name];
    if (!override) return entry;

    return {
      ...entry,
      ...override,
      support: mergeSupport(entry.support, override.support),
      install: mergeInstall(entry.install, override.install),
      readiness: mergeReadiness(entry.readiness, override.readiness),
      launch: mergeLaunch(entry.launch, override.launch),
      tags: override.tags ? [...override.tags] : entry.tags,
      capabilities: override.capabilities ? [...override.capabilities] : entry.capabilities,
      resolveEnv: override.resolveEnv ? [...override.resolveEnv] : entry.resolveEnv,
      metadata: {
        ...(entry.metadata ?? {}),
        ...(override.metadata ?? {}),
      },
    };
  });

  for (const [name, override] of Object.entries(overrides)) {
    if (mergedEntries.some((entry) => entry.name === name)) continue;
    if (!override.label || !override.description || !override.harness || !override.tags || !override.capabilities) {
      continue;
    }
    mergedEntries.push({
      name,
      harness: override.harness,
      label: override.label,
      description: override.description,
      homepage: override.homepage,
      tags: [...override.tags],
      featured: override.featured,
      order: override.order,
      support: mergeSupport(DEFAULT_SUPPORT, override.support),
      install: mergeInstall(undefined, override.install),
      readiness: mergeReadiness(undefined, override.readiness),
      launch: mergeLaunch(undefined, override.launch),
      resolveEnv: override.resolveEnv ? [...override.resolveEnv] : undefined,
      capabilities: [...override.capabilities],
      metadata: override.metadata ? { ...override.metadata } : undefined,
    });
  }

  return mergedEntries.sort((lhs, rhs) => {
    const lhsFeatured = lhs.featured ? 1 : 0;
    const rhsFeatured = rhs.featured ? 1 : 0;
    if (lhsFeatured !== rhsFeatured) return rhsFeatured - lhsFeatured;
    if (lhsFeatured && rhsFeatured) return (lhs.order ?? 999) - (rhs.order ?? 999);
    return lhs.label.localeCompare(rhs.label);
  });
}

export function evaluateHarnessReadiness(
  entry: HarnessCatalogEntry,
  options: HarnessCatalogLoadOptions = {},
): HarnessReadinessReport {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const whichBinary = options.whichBinary ?? ((binary: string) => defaultWhichBinary(binary, platform));
  const requirementExists = options.requirementExists ?? defaultRequirementExists;
  const runCommand = options.runCommand ?? ((command: string) => defaultRunCommand(command, platform));

  const binary = entry.install?.binary;
  const binaryPath = binary ? whichBinary(binary) : null;
  const verifyCommand = platform === "win32"
    ? entry.install?.verifyWin ?? entry.install?.verify
    : entry.install?.verify;
  const verifiedInstall = verifyCommand ? runCommand(verifyCommand) : null;
  const installed = binary
    ? Boolean(binaryPath || verifiedInstall)
    : verifiedInstall ?? true;

  const missing: string[] = [];
  const readiness = entry.readiness;

  if (installed && readiness?.allOf) {
    for (const requirement of readiness.allOf) {
      if (!evaluateRequirement(requirement, { env, requirementExists })) {
        missing.push(formatRequirement(requirement));
      }
    }
  }

  if (installed && readiness?.anyOf && readiness.anyOf.length > 0) {
    const anySatisfied = readiness.anyOf.some((requirement) => evaluateRequirement(requirement, { env, requirementExists }));
    if (!anySatisfied) {
      missing.push(`one of: ${readiness.anyOf.map((requirement) => formatRequirement(requirement)).join(", ")}`);
    }
  }

  const configured = installed && missing.length === 0;
  const healthcheckPassed = configured && readiness?.healthcheckCommand
    ? runCommand(readiness.healthcheckCommand)
    : configured;
  const ready = configured && healthcheckPassed;

  let state: HarnessReadinessState;
  let detail: string;

  if (!installed) {
    state = "missing";
    detail = binary
      ? `${entry.label} is not installed yet.`
      : `${entry.label} is not available yet.`;
  } else if (!configured) {
    state = "installed";
    detail = readiness?.notReadyMessage
      ?? `${entry.label} is installed but still needs configuration.`;
  } else if (!ready) {
    state = "configured";
    detail = `${entry.label} is configured but its readiness check is failing.`;
  } else {
    state = "ready";
    detail = `${entry.label} is ready for ${supportSummaryText(entry)}.`;
  }

  return {
    state,
    installed,
    configured,
    ready,
    detail,
    missing,
    binaryPath,
    loginCommand: readiness?.loginCommand ?? null,
  };
}

export async function readHarnessCatalogOverrides(
  overridePath = resolveOpenScoutSupportPaths().harnessCatalogPath,
): Promise<Record<string, HarnessCatalogOverride>> {
  try {
    const raw = JSON.parse(await readFile(overridePath, "utf8")) as HarnessCatalogOverrideRecord;
    return raw.entries ?? {};
  } catch {
    return {};
  }
}

export async function writeHarnessCatalogOverrides(
  overrides: Record<string, HarnessCatalogOverride>,
  overridePath = resolveOpenScoutSupportPaths().harnessCatalogPath,
): Promise<void> {
  await mkdir(dirname(overridePath), { recursive: true });
  const payload: HarnessCatalogOverrideRecord = {
    version: HARNESS_CATALOG_VERSION,
    entries: overrides,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(overridePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export async function ensureHarnessCatalogOverrideFile(
  overridePath = resolveOpenScoutSupportPaths().harnessCatalogPath,
): Promise<void> {
  if (existsSync(overridePath)) return;
  await writeHarnessCatalogOverrides({}, overridePath);
}

export async function loadHarnessCatalogSnapshot(
  options: HarnessCatalogLoadOptions = {},
): Promise<HarnessCatalogSnapshot> {
  const overrides = await readHarnessCatalogOverrides(options.overridePath);
  const entries = mergeHarnessCatalogEntries(createBuiltInHarnessCatalog(), overrides)
    .map((entry) => {
      const source: ResolvedHarnessCatalogEntry["source"] = overrides[entry.name] ? "local" : "builtin";
      return {
        ...entry,
        source,
        readinessReport: evaluateHarnessReadiness(entry, options),
      };
    });

  return {
    version: HARNESS_CATALOG_VERSION,
    generatedAt: (options.now ?? Date.now)(),
    entries,
  };
}
