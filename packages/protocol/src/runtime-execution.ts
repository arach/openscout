import type { AgentHarness } from "./actors.js";

/**
 * Harness ids that Scout can select for a new execution session. This is
 * deliberately narrower than AgentHarness: native/worker/bridge/http describe
 * endpoint categories, not user-selectable runtimes.
 */
export const SCOUT_LAUNCHABLE_HARNESSES = [
  "claude",
  "codex",
  "grok",
  "grok-acp",
  "kimi",
  "flue",
  "cursor",
  "pi",
] as const satisfies readonly AgentHarness[];

export type ScoutLaunchableHarness = typeof SCOUT_LAUNCHABLE_HARNESSES[number];

export const SCOUT_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type ScoutReasoningEffort = typeof SCOUT_REASONING_EFFORTS[number];

export const SCOUT_REASONING_EFFORTS_BY_HARNESS: Readonly<
  Partial<Record<ScoutLaunchableHarness, readonly ScoutReasoningEffort[]>>
> = {
  codex: SCOUT_REASONING_EFFORTS,
  claude: ["low", "medium", "high", "xhigh", "max"],
};

export type ScoutRuntimeResolutionSource =
  | "flag"
  | "literal"
  | "profile"
  | "endpoint"
  | "config"
  | "default";

export type ScoutRuntimeDriftState =
  | "unknown"
  | "match"
  | "mismatch";

export interface ScoutRuntimeDimensionResolution {
  requested?: string;
  resolved?: string;
  source?: ScoutRuntimeResolutionSource;
  observed?: string;
  observedAt?: number;
  drift: ScoutRuntimeDriftState;
}

/**
 * Durable execution truth for one concrete session. `requested` is caller
 * intent, `resolved` is the spawn value after the launch ladder, and
 * `observed` is populated only from harness-owned evidence.
 */
export interface ScoutExecutionResolution {
  schemaVersion: "openscout.execution-resolution.v1";
  harness: ScoutRuntimeDimensionResolution;
  model: ScoutRuntimeDimensionResolution;
  reasoningEffort: ScoutRuntimeDimensionResolution;
  sessionId?: string;
  resolvedAt?: number;
  observedAt?: number;
}

export interface ScoutRuntimeModelOption {
  id: string;
  label: string;
  harnesses: ScoutLaunchableHarness[];
  source: "catalog" | "observed" | "configured" | "default";
  family?: string;
  version?: string;
}

export interface ScoutRuntimeEffortOption {
  id: ScoutReasoningEffort;
  label: string;
  description?: string;
  harnesses: ScoutLaunchableHarness[];
  models?: string[];
}

export interface ScoutRuntimeHarnessOption {
  id: ScoutLaunchableHarness;
  name?: string;
  label: string;
  description?: string | null;
  state?: "ready" | "configured" | "installed" | "missing" | null;
  ready?: boolean | null;
  detail?: string | null;
}

export interface ScoutRuntimeCapabilityCatalog {
  schemaVersion: "openscout.runtime-capabilities.v1";
  generatedAt: number;
  scope: "global" | "project" | "global+project";
  projectRoot?: string;
  harnesses: ScoutRuntimeHarnessOption[];
  models: ScoutRuntimeModelOption[];
  efforts: ScoutRuntimeEffortOption[];
  defaults?: {
    harness?: ScoutLaunchableHarness;
    model?: string | null;
    reasoningEffort?: ScoutReasoningEffort | null;
  };
  warnings?: string[];
}

/** Stable built-in seed. Fleet-observed models are appended by capability providers. */
export const SCOUT_RUNTIME_MODEL_CATALOG: readonly ScoutRuntimeModelOption[] = [
  { id: "claude-opus-5", label: "Opus 5", harnesses: ["claude"], source: "default", family: "Opus", version: "5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", harnesses: ["claude"], source: "default", family: "Sonnet", version: "4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", harnesses: ["claude"], source: "default", family: "Haiku", version: "4.5" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", harnesses: ["codex"], source: "default", family: "GPT", version: "5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", harnesses: ["codex"], source: "default", family: "GPT", version: "5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", harnesses: ["codex"], source: "default", family: "GPT", version: "5.6 Luna" },
  { id: "gpt-5.5", label: "GPT-5.5", harnesses: ["codex"], source: "default", family: "GPT", version: "5.5" },
  { id: "gpt-5.5-mini", label: "GPT-5.5 mini", harnesses: ["codex"], source: "default", family: "GPT", version: "5.5 mini" },
  { id: "claude-opus-4-8", label: "Opus 4.8", harnesses: ["claude"], source: "default", family: "Opus", version: "4.8" },
  { id: "claude-opus-4-7", label: "Opus 4.7", harnesses: ["claude"], source: "default", family: "Opus", version: "4.7" },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5", harnesses: ["claude"], source: "default", family: "Sonnet", version: "4.5" },
  { id: "grok-4.5", label: "Grok 4.5", harnesses: ["grok", "grok-acp"], source: "default", family: "Grok", version: "4.5" },
  { id: "grok-4.3", label: "Grok 4.3", harnesses: ["grok", "grok-acp"], source: "default", family: "Grok", version: "4.3" },
];

export const SCOUT_RUNTIME_EFFORT_CATALOG: readonly ScoutRuntimeEffortOption[] = [
  { id: "none", label: "None", description: "No extra thinking", harnesses: ["codex"] },
  { id: "minimal", label: "Minimal", description: "Smallest reasoning budget", harnesses: ["codex"] },
  { id: "low", label: "Low", description: "Quick pass", harnesses: ["claude", "codex"] },
  { id: "medium", label: "Medium", description: "Balanced default", harnesses: ["claude", "codex"] },
  { id: "high", label: "High", description: "Deeper pass", harnesses: ["claude", "codex"] },
  { id: "xhigh", label: "XHigh", description: "Highest supported", harnesses: ["claude", "codex"] },
  { id: "max", label: "Max", description: "Maximum reasoning depth", harnesses: ["claude", "codex"] },
  { id: "ultra", label: "Ultra", description: "Maximum with delegation", harnesses: ["codex"] },
];

export type ScoutRuntimeTuple = {
  harness?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
};

export interface ScoutRuntimeSpec {
  harness: ScoutLaunchableHarness;
  model?: string;
  reasoningEffort?: ScoutReasoningEffort;
}

export type ScoutRuntimeSpecParseResult =
  | { ok: true; value: ScoutRuntimeSpec }
  | { ok: false; error: string };

export type ScoutRuntimeModelNormalization =
  | { ok: true; requested: string; resolved: string }
  | { ok: false; requested: string; error: string; candidates?: string[] };

/** Canonical model aliases shared by every request boundary and spawn path. */
export function normalizeScoutRuntimeModel(
  harness: string,
  input: string,
): ScoutRuntimeModelNormalization {
  const requested = input.trim();
  if (!requested) {
    return { ok: false, requested, error: "model cannot be empty" };
  }
  const normalizedHarness = harness.trim().toLowerCase();
  const lower = requested.toLowerCase();
  if (normalizedHarness === "codex") {
    if (lower === "5.6" || lower === "gpt-5.6") {
      return { ok: true, requested, resolved: "gpt-5.6-sol" };
    }
    if (/^\d+(?:\.\d+)*(?:-[a-z0-9][a-z0-9._-]*)?$/u.test(lower)) {
      return { ok: true, requested, resolved: `gpt-${lower}` };
    }
    return { ok: true, requested, resolved: requested };
  }
  if (normalizedHarness === "claude") {
    const aliases: Record<string, string> = {
      fable: "claude-fable-5",
      opus: "claude-opus-5",
      sonnet: "claude-sonnet-4-6",
      haiku: "claude-haiku-4-5",
    };
    return { ok: true, requested, resolved: aliases[lower] ?? requested };
  }
  return { ok: true, requested, resolved: requested };
}

/** Parse the shell-safe `<harness>[/<model>[/<effort>]]` production. */
export function parseScoutRuntimeSpec(input: string): ScoutRuntimeSpecParseResult {
  const raw = input.trim();
  const parts = raw.split("/");
  if (!raw || parts.length > 3 || parts.some((part) => !part.trim())) {
    return {
      ok: false,
      error: "runtime must be <harness>[/<model>[/<effort>]]",
    };
  }
  const harness = parts[0]!.trim().toLowerCase();
  if (!isScoutLaunchableHarness(harness)) {
    return {
      ok: false,
      error: `unsupported runtime harness "${parts[0]}"; expected one of: ${SCOUT_LAUNCHABLE_HARNESSES.join(", ")}`,
    };
  }
  const model = parts[1]?.trim();
  const effortRaw = parts[2]?.trim();
  const reasoningEffort = effortRaw ? normalizeScoutReasoningEffort(effortRaw) : null;
  if (effortRaw && !reasoningEffort) {
    return {
      ok: false,
      error: `unsupported reasoning effort "${effortRaw}"; expected one of: ${SCOUT_REASONING_EFFORTS.join(", ")}`,
    };
  }
  const issues = validateScoutRuntimeTuple({ harness, model, reasoningEffort });
  if (issues.length > 0) {
    return { ok: false, error: issues.map((issue) => issue.message).join("; ") };
  }
  return {
    ok: true,
    value: {
      harness,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    },
  };
}

export function formatScoutRuntimeSpec(spec: ScoutRuntimeSpec): string {
  if (spec.reasoningEffort && !spec.model) {
    throw new Error("runtime literal cannot encode effort without a model; use --harness and --effort");
  }
  return [spec.harness, spec.model, spec.reasoningEffort]
    .filter((part): part is string => Boolean(part))
    .join("/");
}

export type ScoutRuntimeTupleIssue = {
  code:
    | "unsupported_harness"
    | "unsupported_reasoning_effort"
    | "reasoning_effort_harness_mismatch"
    | "unsupported_model_dimension"
    | "model_harness_mismatch";
  dimension: "harness" | "model" | "reasoningEffort";
  message: string;
};

export function isScoutLaunchableHarness(value: string | null | undefined): value is ScoutLaunchableHarness {
  return Boolean(value)
    && SCOUT_LAUNCHABLE_HARNESSES.includes(value!.trim().toLowerCase() as ScoutLaunchableHarness);
}

export function normalizeScoutReasoningEffort(
  value: string | null | undefined,
): ScoutReasoningEffort | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && SCOUT_REASONING_EFFORTS.includes(normalized as ScoutReasoningEffort)
    ? normalized as ScoutReasoningEffort
    : null;
}

export function runtimeDimensionResolution(input: {
  requested?: string | null;
  resolved?: string | null;
  source?: ScoutRuntimeResolutionSource;
  observed?: string | null;
  observedAt?: number;
}): ScoutRuntimeDimensionResolution {
  const requested = input.requested?.trim() || undefined;
  const resolved = input.resolved?.trim() || undefined;
  const observed = input.observed?.trim() || undefined;
  const drift: ScoutRuntimeDriftState = !observed || !resolved
    ? "unknown"
    : observed.toLowerCase() === resolved.toLowerCase()
      ? "match"
      : "mismatch";
  return {
    ...(requested ? { requested } : {}),
    ...(resolved ? { resolved } : {}),
    ...(input.source && resolved ? { source: input.source } : {}),
    ...(observed ? { observed } : {}),
    ...(observed && input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
    drift,
  };
}

export function createScoutExecutionResolution(input: {
  requested?: ScoutRuntimeTuple;
  resolved?: ScoutRuntimeTuple;
  source?: Partial<Record<"harness" | "model" | "reasoningEffort", ScoutRuntimeResolutionSource>>;
  observed?: ScoutRuntimeTuple;
  sessionId?: string;
  resolvedAt?: number;
  observedAt?: number;
}): ScoutExecutionResolution {
  const dimension = (key: "harness" | "model" | "reasoningEffort") => runtimeDimensionResolution({
    requested: input.requested?.[key],
    resolved: input.resolved?.[key],
    source: input.source?.[key],
    observed: input.observed?.[key],
    observedAt: input.observedAt,
  });
  return {
    schemaVersion: "openscout.execution-resolution.v1",
    harness: dimension("harness"),
    model: dimension("model"),
    reasoningEffort: dimension("reasoningEffort"),
    ...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
    ...(input.resolvedAt !== undefined ? { resolvedAt: input.resolvedAt } : {}),
    ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
  };
}

export function validateScoutRuntimeTuple(
  input: ScoutRuntimeTuple,
  catalog?: Pick<ScoutRuntimeCapabilityCatalog, "models" | "efforts">,
): ScoutRuntimeTupleIssue[] {
  const harness = input.harness?.trim().toLowerCase();
  const model = input.model?.trim();
  const effortRaw = input.reasoningEffort?.trim();
  const issues: ScoutRuntimeTupleIssue[] = [];

  if (harness && !isScoutLaunchableHarness(harness)) {
    issues.push({
      code: "unsupported_harness",
      dimension: "harness",
      message: `unsupported harness "${input.harness}"; expected one of: ${SCOUT_LAUNCHABLE_HARNESSES.join(", ")}`,
    });
    return issues;
  }

  const effort = effortRaw ? normalizeScoutReasoningEffort(effortRaw) : null;
  if (effortRaw && !effort) {
    issues.push({
      code: "unsupported_reasoning_effort",
      dimension: "reasoningEffort",
      message: `unsupported reasoning effort "${effortRaw}"; expected one of: ${SCOUT_REASONING_EFFORTS.join(", ")}`,
    });
  } else if (effort && harness) {
    const catalogEffort = catalog?.efforts.find((candidate) => candidate.id === effort);
    const supported = catalogEffort
      ? catalogEffort.harnesses.includes(harness as ScoutLaunchableHarness)
      : (SCOUT_REASONING_EFFORTS_BY_HARNESS[harness as ScoutLaunchableHarness] ?? []).includes(effort);
    if (!supported) {
      issues.push({
        code: "reasoning_effort_harness_mismatch",
        dimension: "reasoningEffort",
        message: `reasoning effort "${effort}" is not supported by harness "${harness}"`,
      });
    }
  }

  if (model && harness && harness !== "claude" && harness !== "codex") {
    issues.push({
      code: "unsupported_model_dimension",
      dimension: "model",
      message: `model selection is not supported by harness "${harness}"`,
    });
  } else if (model && harness && catalog) {
    const known = catalog.models.find((candidate) => candidate.id.toLowerCase() === model.toLowerCase());
    if (known && !known.harnesses.includes(harness as ScoutLaunchableHarness)) {
      issues.push({
        code: "model_harness_mismatch",
        dimension: "model",
        message: `model "${model}" is not supported by harness "${harness}"`,
      });
    }
  }

  return issues;
}
