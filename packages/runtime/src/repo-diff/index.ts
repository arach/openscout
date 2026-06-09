// Repo Diff (SCO-065) — the broker-side join for the on-demand diff viewer.
//
// The Rust `openscout-repo-service diff` command produces raw, bounded Git diff
// facts (`openscout.repo.diff/v1`). This module launches it for a single
// worktree and wraps the raw facts with Scout context (attached agents /
// sessions / hints) and render hints, producing a `ScoutRepoDiffSnapshot`.
//
// Ownership mirrors repo-watch: Rust observes the machine, TypeScript
// interprets Scout. Raw patch text is never persisted here.

import {
  normalizeHints,
  normalizePath,
  pathContains,
  refsForHints,
  type RepoWatchAgentRef,
  type RepoWatchHintSummary,
  type RepoWatchPathHint,
  type RepoWatchSessionRef,
} from "../repo-watch/index.js";
import {
  resolveRepoServiceCommand,
  runRepoServiceJson,
} from "../repo-service/process.js";

// ── Native contract (mirrors crates/openscout-repo-service/src/diff.rs) ─────

export type RepoDiffLayerKind = "unstaged" | "staged" | "branch";

export type RepoDiffFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "conflict"
  | "unknown";

export type RepoDiffLimits = {
  maxPatchBytes?: number;
  maxFiles?: number;
  maxHunksPerFile?: number;
  maxLinesPerHunk?: number;
  timeoutMs?: number;
  includeRawPatch?: boolean;
  includeParsedHunks?: boolean;
  includeBinaryPatch?: boolean;
};

export type RepoDiffNativeRequest = {
  schema?: "openscout.repo.diff.request/v1";
  worktreePath: string;
  layers?: RepoDiffLayerKind[];
  baseRef?: string | null;
  compareRef?: string | null;
  paths?: string[];
  limits?: RepoDiffLimits;
};

export type RepoDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section: string | null;
  additions: number;
  deletions: number;
  truncated: boolean;
};

export type RepoDiffFile = {
  oldPath: string | null;
  newPath: string | null;
  status: RepoDiffFileStatus;
  oldOid: string | null;
  newOid: string | null;
  oldMode: string | null;
  newMode: string | null;
  similarity: number | null;
  binary: boolean;
  additions: number | null;
  deletions: number | null;
  hunks: RepoDiffHunk[];
  truncated: boolean;
};

export type RepoDiffLayer = {
  kind: RepoDiffLayerKind;
  baseLabel: string | null;
  compareLabel: string | null;
  command: string[];
  patchOid: string;
  rawPatch: string | null;
  rawPatchBytes: number;
  truncated: boolean;
  files: RepoDiffFile[];
  shortstat: string | null;
};

export type RepoDiffCoverage = {
  requestedLayers: number;
  emittedLayers: number;
  files: number;
  patchBytes: number;
  truncatedLayers: number;
  scanBudgetReached: boolean;
};

export type RepoDiffDiagnostic = {
  level: "info" | "warning";
  kind: string;
  message: string;
  path: string | null;
};

export type RepoDiffResponse = {
  schema: "openscout.repo.diff/v1" | string;
  generatedAt: number;
  worktreePath: string;
  layers: RepoDiffLayer[];
  coverage: RepoDiffCoverage;
  diagnostics: RepoDiffDiagnostic[];
};

// ── Scout-wrapped snapshot (the UI/API contract) ───────────────────────────

export type RepoDiffScoutContext = {
  worktreeId: string | null;
  projectId: string | null;
  agents: RepoWatchAgentRef[];
  sessions: RepoWatchSessionRef[];
  hints: RepoWatchHintSummary[];
};

export type RepoDiffRenderHints = {
  renderKey: string;
  cachePolicy: "local-disposable";
  preferredTheme: string;
  preferredLayout: "split" | "stacked";
};

export type ScoutRepoDiffSnapshot = RepoDiffResponse & {
  scout: RepoDiffScoutContext;
  render: RepoDiffRenderHints;
};

export type RepoDiffNativeExec = (
  request: RepoDiffNativeRequest,
) => Promise<RepoDiffResponse>;

export type RepoDiffSnapshotOptions = {
  worktreePath: string;
  layers?: RepoDiffLayerKind[];
  baseRef?: string | null;
  compareRef?: string | null;
  paths?: string[];
  limits?: RepoDiffLimits;
  hints?: RepoWatchPathHint[];
  preferredTheme?: string;
  preferredLayout?: "split" | "stacked";
  nativeDiff?: RepoDiffNativeExec;
  now?: () => number;
};

const DEFAULT_NATIVE_TIMEOUT_MS = 20_000;
const RENDER_OPTIONS_VERSION = 1;
const DEFAULT_PREFERRED_THEME = "pierre-dark";
const DEFAULT_PREFERRED_LAYOUT: "split" | "stacked" = "split";

async function defaultNativeRepoDiff(request: RepoDiffNativeRequest): Promise<RepoDiffResponse> {
  const command = resolveRepoServiceCommand("diff");
  if (!command) {
    throw new Error("Repo service binary was not found.");
  }

  const timeoutMs = Math.max(2_000, (request.limits?.timeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS) + 1_500);
  const output = await runRepoServiceJson(command, request, timeoutMs);

  if (!output || typeof output !== "object") {
    throw new Error("Repo service returned a non-object response.");
  }
  const response = output as RepoDiffResponse;
  if (response.schema !== "openscout.repo.diff/v1" || !Array.isArray(response.layers)) {
    throw new Error("Repo service returned an unsupported diff response.");
  }
  return response;
}

/**
 * Produce a Scout-wrapped diff snapshot for one worktree. Rust supplies the raw
 * diff facts; this attaches the agents/sessions/hints near the worktree and a
 * content-stable render key for the local Pierre cache.
 */
export async function getRepoDiffSnapshot(
  options: RepoDiffSnapshotOptions,
): Promise<ScoutRepoDiffSnapshot> {
  const nativeDiff = options.nativeDiff ?? defaultNativeRepoDiff;
  const worktreePath = normalizePath(options.worktreePath);

  const request: RepoDiffNativeRequest = {
    schema: "openscout.repo.diff.request/v1",
    worktreePath,
  };
  if (options.layers && options.layers.length > 0) request.layers = options.layers;
  if (options.baseRef != null) request.baseRef = options.baseRef;
  if (options.compareRef != null) request.compareRef = options.compareRef;
  if (options.paths && options.paths.length > 0) request.paths = options.paths;
  if (options.limits) request.limits = options.limits;

  const response = await nativeDiff(request);

  const scout = buildScoutContext(worktreePath, options.hints ?? []);
  const render = buildRenderHints(response, worktreePath, options);

  return { ...response, scout, render };
}

function buildScoutContext(
  worktreePath: string,
  rawHints: RepoWatchPathHint[],
): RepoDiffScoutContext {
  const matched = normalizeHints(rawHints).filter(
    (hint) => pathContains(worktreePath, hint.path) || pathContains(hint.path, worktreePath),
  );
  const { agents, sessions } = refsForHints(matched);
  return {
    worktreeId: stableId(`worktree:${worktreePath}`),
    projectId: null,
    agents,
    sessions,
    hints: matched,
  };
}

function buildRenderHints(
  response: RepoDiffResponse,
  worktreePath: string,
  options: RepoDiffSnapshotOptions,
): RepoDiffRenderHints {
  // Content identity for the local render cache. The client appends its own
  // theme/layout per SCO-065 §12; this is the shared, path+content portion. The
  // render-options version lets a Pierre/Shiki upgrade invalidate every key.
  const layerIdentity = response.layers
    .map((layer) => `${layer.kind}:${layer.patchOid}`)
    .join("|");
  const renderKey = stableId(
    `openscout-diff:v${RENDER_OPTIONS_VERSION}:${worktreePath}:${layerIdentity}`,
  );
  return {
    renderKey,
    cachePolicy: "local-disposable",
    preferredTheme: options.preferredTheme ?? DEFAULT_PREFERRED_THEME,
    preferredLayout: options.preferredLayout ?? DEFAULT_PREFERRED_LAYOUT,
  };
}

// FNV-1a (32-bit) — a short, stable, non-cryptographic id. Mirrors the
// hashing repo-watch uses for worktree ids; client cache ids never expose
// absolute paths (SCO-065 §12).
function stableId(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
