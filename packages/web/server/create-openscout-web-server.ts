import { execFile, execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { promisify } from "node:util";

import { Hono, type Context } from "hono";
import type {
  AgentEndpoint,
  AgentHarness,
  CollaborationEvent,
  CollaborationKind,
  ConversationDefinition,
  ConversationKind,
  UnblockRequestEvent,
  UnblockRequestRecord,
} from "@openscout/protocol";

import {
  controlScoutWebPairingService,
  decideScoutWebPairingApproval,
  getScoutWebPairingState,
  getScoutWebPairingSessionSnapshots,
  refreshScoutWebPairingState,
  removeScoutPairingTrustedPeer,
  type ScoutPairingControlAction,
  type ScoutPairingState,
} from "./pairing.ts";
import { createPendingPairRequestStore } from "./pairing-pair-requests.ts";
import { startScoutPairLanBeacon } from "./pairing-lan-beacon.ts";
import {
  createCachedSnapshot,
  installScoutApiMiddleware,
  relayEventStream,
  registerScoutWebAssets,
  type ScoutWebAssetMode,
} from "./server-core.ts";
import {
  endpointMetadataRecord,
  selectPreferredAgentEndpoint,
  type EndpointPreference,
} from "./core/agent-endpoints.ts";
import { resolveTerminalSurface } from "./core/terminal-surfaces.ts";
import {
  queryDiscoveredTerminalSessions,
  terminalSurfaceKey,
} from "./terminal-session-discovery.ts";
import {
  getImageBlob,
  ImageBlobError,
  putImageBlob,
} from "./image-blob-store.ts";
import {
  queryAgentById,
  queryAgents,
  queryActivity,
  queryBrokerDiagnostics,
  queryConversationDefinitionById,
  queryFleet,
  queryFlightRecordById,
  queryFlights,
  queryRecentMessages,
  queryWorkItems,
  queryWorkItemById,
  querySessions,
  querySessionById,
  queryFollowTarget,
  queryHeartrate,
  queryRuns,
  queryTerminalSessions,
  type WebAgent,
} from "./db-queries.ts";
import {
  configuredOperatorActorIds,
  conversationIdForAgent,
  parseDirectConversationId,
} from "./db/internal/conversation-ids.ts";
import {
  compact as compactPath,
  isTransportSessionRef,
  resolveHarnessSessionId,
  resolveHarnessSessionIdForAgent,
} from "./db/internal/paths.ts";
import {
  appendScoutCollaborationEvent,
  appendScoutUnblockRequestEvent,
  askScoutQuestion,
  loadScoutBrokerContext,
  loadScoutReadCursors,
  loadScoutRelayConfig,
  markScoutConversationRead,
  readScoutUnblockRequests,
  resolveScoutBrokerUrl,
  type OutgoingAttachmentInput,
  type ScoutBrokerContext,
  sendScoutConversationMessage,
  sendScoutDirectMessage,
  sendScoutMessage,
  upsertScoutConversation,
  upsertScoutFlight,
  upsertScoutUnblockRequest,
} from "./core/broker/service.ts";
import { scoutBrokerPaths } from "./core/broker/paths.ts";
import { getScoutConversations } from "./core/conversations/service.ts";
import {
  loadAgentObservePayload,
  loadAgentObserveSummaries,
  loadSessionRefObservePayload,
} from "./core/observe/service.ts";
import {
  getTailDiscovery,
  readRecentTranscriptEvents,
  snapshotRecentEvents,
  type DiscoveredTranscript,
} from "@openscout/runtime/tail";
import {
  indexRecentSessionKnowledge,
  resolveOpenScoutKnowledgePaths,
  SQLiteKnowledgeStore,
  type KnowledgeSourceRef,
} from "@openscout/runtime/knowledge";
import type { ScoutVantageNativeSession } from "@openscout/runtime/vantage-plan";
import {
  getRepoDiffSnapshot,
  projectSessionsAttention,
  sessionApprovalAttentionId,
  type RepoDiffFile,
  type RepoDiffLayer,
  type RepoDiffLayerKind,
  type RepoDiffSnapshotOptions,
  type ScoutRepoDiffSnapshot,
  type SessionAttentionItem,
} from "@openscout/runtime";
import {
  emitBroadcast,
  snapshotRecentBroadcasts,
  subscribeBroadcast,
} from "./core/broadcast/service.ts";
import {
  announceMeshVisibility,
  controlTailscale,
  loadMeshStatus,
  type TailscaleControlAction,
} from "./core/mesh/service.ts";
import {
  loadOpenScoutWebShellState,
  type OpenScoutWebShellState,
} from "./runtime-summary.ts";
import {
  createScoutbotAssistantService,
  ScoutbotAssistantError,
  type ScoutbotCodexAssistantInvoker,
  type ScoutbotBrief,
  type ScoutbotBriefCapture,
  type ScoutbotBriefObservation,
  type ScoutbotBriefReference,
} from "./scoutbot-assistant.ts";
import {
  deleteBriefing,
  getBriefing,
  listBriefings,
  saveBriefing,
  type BriefingKind,
} from "./db/briefings.ts";
import {
  createScoutbotReminderStore,
  ScoutbotReminderError,
} from "./scoutbot-reminders.ts";
import {
  createScoutbotCredentialStore,
} from "./scoutbot-credentials.ts";
import {
  startScoutbotRunner,
  type ScoutbotRunnerHandle,
} from "./scoutbot/runner.ts";
import { SCOUTBOT_AGENT_ID, SCOUTBOT_REASONING_EFFORT } from "./scoutbot/role.ts";
import { loadServiceBudgets } from "./service-budgets.ts";
import {
  buildWorkMaterialsInventory,
  readWorkMaterialContent,
  readWorkMaterialRaw,
} from "./work-materials.ts";
import { indexPlanDocuments } from "./plan-documents.ts";
import {
  defaultHeuristicsResponse,
  globalHeuristicsFile,
  projectHeuristicsFile,
  startGlobalHeuristicsWatcher,
  writeGlobalHeuristicsFile,
  writeProjectHeuristicsFile,
} from "./material-heuristics.ts";
import {
  collectTrustedRoots,
  mediaTypeFor,
  readFilePreview,
  resolveTrustedPath,
} from "./file-preview.ts";
import {
  ensureScoutVoiceOrigins,
  getScoutVoiceHealth,
  resolveScoutSpeechDefaults,
  synthesizeScoutSpeech,
  transcribeScoutVoiceAudio,
  type ScoutSpeechTimingRequest,
} from "./scout-voice.ts";
import {
  createOpenScoutVantageHandoff,
  type OpenScoutVantageHandoff,
  type OpenScoutVantageHandoffInput,
} from "./vantage-handoff.ts";
import {
  createSignedScoutServicesRestartUrl,
  parseScoutServicesRestartTarget,
} from "./scout-services-deeplink.ts";
import {
  loadUserConfig,
  saveUserConfig,
  resolveOperatorName,
} from "@openscout/runtime/user-config";
import {
  localConfigPath,
} from "@openscout/runtime/local-config";
import {
  loadResolvedRelayAgents,
  readOpenScoutSettings,
  writeOpenScoutSettings,
} from "@openscout/runtime/setup";
import {
  ensureOpenScoutOnboardingLocalConfig,
  loadOpenScoutOnboardingState,
  runOpenScoutOnboardingSetup,
  saveOpenScoutOnboardingIdentity,
  saveOpenScoutOnboardingProject,
  skipOpenScoutOnboarding,
} from "@openscout/runtime/onboarding";
import { relayAgentLogsDirectory, relayAgentRuntimeDirectory, resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";
import { readSessionCatalogSync } from "@openscout/runtime/claude-stream-json";
import {
  invokeCodexAppServerAgent,
  normalizeCodexAppServerLaunchArgs,
} from "@openscout/runtime/codex-app-server";

function parseConversationKinds(value: string | undefined): ConversationKind[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(",")
    .map((kind) => kind.trim())
    .filter((kind): kind is ConversationKind => (
      kind === "direct"
      || kind === "channel"
      || kind === "group_direct"
      || kind === "thread"
      || kind === "system"
    ));
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .filter((candidate): candidate is string => typeof candidate === "string")
      .map((candidate) => candidate.trim())
      .filter(Boolean)
    : [];
}

function isHttpsWebRequest(c: Context, publicOrigin: string | undefined): boolean {
  const forwardedProto = c.req.header("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "https") return true;

  try {
    if (new URL(c.req.url).protocol === "https:") return true;
  } catch {
    // Fall through to the configured public origin.
  }

  if (!publicOrigin) return false;
  try {
    return new URL(publicOrigin).protocol === "https:";
  } catch {
    return publicOrigin.trim().toLowerCase().startsWith("https://");
  }
}

function installHttpsEdgeSecurityHeaders(app: Hono, publicOrigin: string | undefined): void {
  app.use("*", async (c, next) => {
    await next();
    if (!isHttpsWebRequest(c, publicOrigin)) return;
    c.header("Content-Security-Policy", "upgrade-insecure-requests; block-all-mixed-content");
  });
}

function resolveVantageNativeSessions(
  transcripts: readonly DiscoveredTranscript[],
  selectedIds: readonly string[],
): ScoutVantageNativeSession[] {
  const selected = new Set(selectedIds);
  return transcripts
    .map((transcript) => toVantageNativeSession(transcript))
    .filter((session) => selected.has(session.id));
}

function toVantageNativeSession(transcript: DiscoveredTranscript): ScoutVantageNativeSession {
  return {
    id: nativeSessionId(transcript),
    source: transcript.source,
    sessionId: transcript.sessionId,
    transcriptPath: transcript.transcriptPath,
    project: transcript.project,
    harness: transcript.harness,
    cwd: transcript.cwd,
    mtimeMs: transcript.mtimeMs,
    tmuxSessionName: `scout-vantage-${slugifyTmuxName(transcript.source)}-${stableHash(transcript.transcriptPath)}`,
  };
}

function nativeSessionId(transcript: DiscoveredTranscript): string {
  const sessionId = transcript.sessionId?.trim() || "session";
  return `native:${transcript.source}:${sessionId}:${stableHash(transcript.transcriptPath)}`;
}

function slugifyTmuxName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "native";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
import { buildHarnessResumeCommand, findHarnessEntry, loadHarnessCatalogSnapshot } from "@openscout/runtime/harness-catalog";
import {
  pairingDeepLinks,
  SCOUT_PAIRING_DEEP_LINK_PATH,
  SCOUT_PAIRING_DEEP_LINK_SCHEME,
} from "../shared/pairing-link.js";
import {
  resolveOpenScoutWebRoutes,
  serializeOpenScoutWebBootstrap,
} from "../shared/runtime-config.js";
export type { ScoutWebAssetMode } from "./server-core.ts";

const execFileAsync = promisify(execFile);

export type TerminalRunRequest = {
  command: string;
  cwd?: string | null;
  agentId?: string | null;
};

export type TerminalRelayDestroyRequest = {
  sessionId?: string;
};

export type TerminalSurfaceControlRequest = {
  backend?: string;
  sessionName?: string;
  action?: string;
};

export type TmuxPanePeekRequest = {
  agentId: string;
  sessionId: string;
  paneTarget: string;
  cwd: string | null;
  lines: number;
  columns: number;
};

export type TmuxPanePeekCapture = {
  body: string;
  lineCount?: number;
  truncated?: boolean;
};

export type CreateOpenScoutWebServerOptions = {
  currentDirectory: string;
  shellStateCacheTtlMs?: number;
  assetMode: ScoutWebAssetMode;
  viteDevUrl?: string;
  staticRoot?: string;
  publicOrigin?: string;
  portalHost?: string;
  advertisedHost?: string;
  trustedHosts?: string[];
  trustedOrigins?: string[];
  runTerminalCommand?: (request: TerminalRunRequest) => Promise<void>;
  destroyTerminalRelaySession?: (sessionId: string) => Promise<boolean>;
  destroyTerminalRelaySurface?: (backend: "tmux" | "zellij", sessionName: string) => Promise<number>;
  createVantageHandoff?: (request: OpenScoutVantageHandoffInput) => Promise<OpenScoutVantageHandoff>;
  terminalRelayHealthcheck?: () => Promise<boolean>;
  revealPath?: (targetPath: string) => Promise<void> | void;
  captureTmuxPane?: (request: TmuxPanePeekRequest) => Promise<TmuxPanePeekCapture | null> | TmuxPanePeekCapture | null;
  scoutbotAssistant?: {
    invokeCodex?: ScoutbotCodexAssistantInvoker;
  };
  scoutbot?: {
    enabled?: boolean;
    brokerBaseUrl?: string;
  };
  // Injectable for tests; defaults to the runtime native diff producer.
  repoDiffSnapshot?: (options: RepoDiffSnapshotOptions) => Promise<ScoutRepoDiffSnapshot>;
  repoPullRequests?: (options: RepoPullRequestLoadOptions) => Promise<RepoPullRequestSnapshot>;
};

const REPO_DIFF_VIEWER_LIMITS: NonNullable<RepoDiffSnapshotOptions["limits"]> = {
  timeoutMs: 15_000,
  includeBinaryPatch: false,
};

const REPO_DIFF_SUMMARY_LIMITS: NonNullable<RepoDiffSnapshotOptions["limits"]> = {
  ...REPO_DIFF_VIEWER_LIMITS,
  includeRawPatch: false,
  includeParsedHunks: false,
};

const REPO_DIFF_CACHE_MAX_ENTRIES = 64;
const REPO_DIFF_GIT_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_REPO_DIFF_LAYERS: RepoDiffLayerKind[] = ["branch", "unstaged", "staged"];
const REPO_PRS_MAX_PATHS = 16;
const REPO_PRS_DEFAULT_LIMIT = 12;

type RepoDiffCacheMode = "reload" | "prefer" | "only";
type RepoDiffTier = "patch" | "summary";
type RepoDiffCacheEntry = {
  snapshot: ScoutRepoDiffSnapshot;
  storedAt: number;
};

type RepoPullRequestLoadOptions = {
  paths: string[];
  limitPerRepo: number;
};

type GhPullRequest = {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  headRefName?: string;
  baseRefName?: string;
  updatedAt?: string;
  author?: { login?: string | null } | null;
};

type RepoPullRequestItem = {
  id: string;
  repo: string;
  path: string;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  author: string | null;
  updatedAt: string | null;
};

type RepoPullRequestSnapshot = {
  generatedAt: number;
  source: "gh";
  paths: string[];
  pullRequests: RepoPullRequestItem[];
  warnings: string[];
};

type RepoDiffScopeMetadata =
  | {
      kind: "worktree";
      label: string;
      worktreePath: string;
      filteredPaths: string[];
    }
  | {
      kind: "session";
      label: string;
      worktreePath: string;
      refId: string | null;
      agentId: string | null;
      sessionId: string | null;
      filteredPaths: string[];
      touchedFiles: number;
      changedFiles: number;
      include: "changed" | "all";
      caveat: "path-filtered-not-hunk-provenance";
    };
type ScopedRepoDiffSnapshot = ScoutRepoDiffSnapshot & {
  scope?: RepoDiffScopeMetadata;
};

function parseRepoDiffCacheMode(value: string | undefined, force: string | undefined): RepoDiffCacheMode {
  if (force === "1" || force === "true") return "reload";
  switch (value) {
    case "only":
      return "only";
    case "prefer":
      return "prefer";
    case "reload":
    case "refresh":
    case "live":
      return "reload";
    default:
      return "reload";
  }
}

function parseRepoDiffTier(value: string | undefined): RepoDiffTier {
  return value === "summary" ? "summary" : "patch";
}

function wantsRepoDiffRehydrate(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function repoDiffCacheKey(input: {
  worktreePath: string;
  layers: readonly RepoDiffLayerKind[];
  baseRef: string | undefined;
  compareRef: string | undefined;
  tier: RepoDiffTier;
  stateKey: string | undefined;
  paths?: readonly string[];
}): string {
  return [
    input.worktreePath.trim(),
    input.layers.join(","),
    input.baseRef ?? "",
    input.compareRef ?? "",
    input.tier,
    input.stateKey ?? "",
    ...(input.paths?.length ? [input.paths.join("\n")] : []),
  ].join("\u0000");
}

const REPO_DIFF_TRUNK_REFS = [
  "origin/main",
  "main",
  "origin/master",
  "master",
  "origin/trunk",
  "trunk",
];

function runGitRaw(currentDirectory: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", currentDirectory, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function resolveGitCommitRef(worktreePath: string, ref: string): string | null {
  return runGitValue(worktreePath, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

function preferredRepoDiffBaseRef(worktreePath: string): string | null {
  const upstream = runGitValue(worktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  for (const candidate of [...REPO_DIFF_TRUNK_REFS, upstream].filter(Boolean) as string[]) {
    if (candidate === "HEAD") continue;
    if (resolveGitCommitRef(worktreePath, candidate)) return candidate;
  }
  return null;
}

function resolveRepoDiffBranchRefs(input: {
  worktreePath: string;
  layers: readonly RepoDiffLayerKind[];
  baseRef?: string;
  compareRef?: string;
}): { baseRef?: string; compareRef?: string } {
  if (!input.layers.includes("branch")) {
    return { baseRef: input.baseRef, compareRef: input.compareRef };
  }
  const compareRef = input.compareRef?.trim() || "HEAD";
  const compareOid = resolveGitCommitRef(input.worktreePath, compareRef);
  if (!compareOid) {
    return { baseRef: input.baseRef, compareRef: input.compareRef };
  }
  const baseCandidate = input.baseRef?.trim() || preferredRepoDiffBaseRef(input.worktreePath);
  if (!baseCandidate) {
    return { compareRef: compareOid };
  }
  const baseOid = resolveGitCommitRef(input.worktreePath, baseCandidate);
  if (!baseOid) {
    return { baseRef: baseCandidate, compareRef: compareOid };
  }
  const mergeBase = runGitValue(input.worktreePath, ["merge-base", baseOid, compareOid]);
  return {
    baseRef: mergeBase ?? baseOid,
    compareRef: compareOid,
  };
}

function repoDiffStateKey(input: {
  worktreePath: string;
  layers: readonly RepoDiffLayerKind[];
  baseRef?: string;
  compareRef?: string;
  paths?: readonly string[];
}): string {
  const parts: string[] = [];
  if (input.layers.includes("branch")) {
    parts.push(`branch:${input.baseRef ?? ""}..${input.compareRef ?? ""}`);
  }
  const pathArgs = input.paths?.length ? ["--", ...input.paths] : [];
  if (input.layers.includes("staged")) {
    const staged = runGitRaw(input.worktreePath, [
      "diff",
      "--cached",
      "--raw",
      "-z",
      ...pathArgs,
    ]);
    parts.push(`staged:${stableHash(staged ?? "unavailable")}`);
  }
  if (input.layers.includes("unstaged")) {
    const status = runGitRaw(input.worktreePath, [
      "status",
      "--porcelain=v2",
      "-z",
      "--",
      ...(input.paths ?? []),
    ]);
    const diff = runGitRaw(input.worktreePath, [
      "diff",
      "--numstat",
      "-z",
      ...pathArgs,
    ]);
    parts.push(`unstaged:${stableHash(`${status ?? "unavailable"}\0${diff ?? ""}`)}`);
  }
  return parts.join("|");
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeRepoDiffPathFilters(worktreePath: string, rawPaths: readonly string[]): string[] {
  const worktreeRoot = resolve(worktreePath);
  const paths: string[] = [];
  for (const rawPath of rawPaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const absolute = isAbsolute(trimmed)
      ? resolve(trimmed)
      : resolve(worktreeRoot, trimmed);
    const relativePath = relative(worktreeRoot, absolute);
    if (!relativePath || relativePath === "." || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      continue;
    }
    paths.push(relativePath.replace(/\\/g, "/"));
  }
  return uniqueNonEmpty(paths);
}

function repoDiffPathFiltersFromQuery(c: Context, worktreePath: string): string[] {
  return normalizeRepoDiffPathFilters(worktreePath, [
    ...(c.req.queries("file") ?? []),
    ...(c.req.queries("pathspec") ?? []),
  ]);
}

function withRepoDiffScope(
  snapshot: ScoutRepoDiffSnapshot,
  scope: RepoDiffScopeMetadata,
): ScopedRepoDiffSnapshot {
  return { ...snapshot, scope };
}

function repoDiffLayerLabels(kind: RepoDiffLayerKind): { base: string | null; compare: string | null } {
  switch (kind) {
    case "unstaged":
      return { base: "index", compare: "working tree" };
    case "staged":
      return { base: "HEAD", compare: "index" };
    case "branch":
      return { base: null, compare: null };
  }
}

function repoDiffGitArgs(input: {
  kind: RepoDiffLayerKind;
  baseRef?: string;
  compareRef?: string;
}): { selector: string[]; baseLabel: string | null; compareLabel: string | null; missing?: string } {
  switch (input.kind) {
    case "unstaged":
      return { selector: ["diff"], baseLabel: "index", compareLabel: "working tree" };
    case "staged":
      return { selector: ["diff", "--cached"], baseLabel: "HEAD", compareLabel: "index" };
    case "branch": {
      const base = input.baseRef?.trim();
      if (!base) {
        return {
          selector: ["diff"],
          baseLabel: null,
          compareLabel: input.compareRef ?? null,
          missing: "Branch layer requires a base ref.",
        };
      }
      const compare = input.compareRef?.trim() || "HEAD";
      return {
        selector: ["diff", base, compare],
        baseLabel: base,
        compareLabel: compare,
      };
    }
  }
}

function runRepoDiffGit(worktreePath: string, args: string[], maxBuffer = REPO_DIFF_GIT_MAX_BUFFER): string | null {
  try {
    return execFileSync("git", ["-C", worktreePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      maxBuffer,
    });
  } catch {
    return null;
  }
}

function repoDiffPathArgs(paths: readonly string[] | undefined): string[] {
  return paths && paths.length > 0 ? ["--", ...paths] : [];
}

function repoDiffFileStatus(statusCode: string): RepoDiffFile["status"] {
  switch (statusCode.charAt(0)) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechange";
    case "U":
      return "conflict";
    default:
      return "unknown";
  }
}

type RepoDiffNumstat = {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
};

function parseRepoDiffNumstatZ(output: string): Map<string, RepoDiffNumstat> {
  const stats = new Map<string, RepoDiffNumstat>();
  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const parts = token.split("\t");
    if (parts.length < 3) continue;
    let path = parts.slice(2).join("\t");
    if (!path && index + 2 < tokens.length) {
      // With -z, rename/copy numstat records are: add<TAB>del<TAB><NUL>old<NUL>new<NUL>.
      index += 2;
      path = tokens[index] || tokens[index - 1] || "";
    }
    if (!path) continue;
    const binary = parts[0] === "-" || parts[1] === "-";
    stats.set(path, {
      additions: binary ? null : Number(parts[0]) || 0,
      deletions: binary ? null : Number(parts[1]) || 0,
      binary,
    });
  }
  return stats;
}

function parseRepoDiffRawZ(output: string, numstat: Map<string, RepoDiffNumstat>): RepoDiffFile[] {
  const files: RepoDiffFile[] = [];
  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const meta = tokens[index];
    if (!meta?.startsWith(":")) continue;
    const fields = meta.slice(1).split(/\s+/);
    if (fields.length < 5) continue;
    const statusCode = fields[4] ?? "";
    const status = repoDiffFileStatus(statusCode);
    const twoPathRecord = status === "renamed" || status === "copied";
    const firstPath = tokens[index + 1] || null;
    const secondPath = twoPathRecord ? (tokens[index + 2] || null) : null;
    index += twoPathRecord ? 2 : 1;

    let oldPath = firstPath;
    let newPath = twoPathRecord ? secondPath : firstPath;
    if (status === "added") oldPath = null;
    if (status === "deleted") newPath = null;

    const stat = numstat.get(newPath ?? "") ?? numstat.get(oldPath ?? "");
    files.push({
      oldPath,
      newPath,
      status,
      oldOid: fields[2] ?? null,
      newOid: fields[3] ?? null,
      oldMode: fields[0] ?? null,
      newMode: fields[1] ?? null,
      similarity: twoPathRecord ? Number.parseInt(statusCode.slice(1), 10) || null : null,
      binary: stat?.binary ?? false,
      additions: stat?.additions ?? null,
      deletions: stat?.deletions ?? null,
      hunks: [],
      truncated: false,
    });
  }
  return files;
}

function repoDiffDisplayPath(file: RepoDiffFile): string {
  return file.newPath ?? file.oldPath ?? "";
}

function recentBranchDiffPaths(input: {
  worktreePath: string;
  baseRef?: string;
  compareRef?: string;
  paths?: readonly string[];
}): string[] {
  if (!input.baseRef) return [];
  const range = `${input.baseRef}..${input.compareRef || "HEAD"}`;
  const output = runRepoDiffGit(input.worktreePath, [
    "log",
    "--name-only",
    "--pretty=format:",
    "--diff-filter=ACMRTUXB",
    range,
    ...repoDiffPathArgs(input.paths),
  ]);
  return uniqueNonEmpty((output ?? "").split(/\r?\n/));
}

function sortRepoDiffFilesRecentFirst(files: RepoDiffFile[], recentPaths: readonly string[]): RepoDiffFile[] {
  if (recentPaths.length === 0) return files;
  const rank = new Map(recentPaths.map((path, index) => [path, index]));
  return files
    .map((file, index) => ({ file, index }))
    .sort((left, right) => {
      const leftRank = rank.get(repoDiffDisplayPath(left.file)) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(repoDiffDisplayPath(right.file)) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    })
    .map((entry) => entry.file);
}

function buildGitRepoDiffLayer(input: {
  worktreePath: string;
  kind: RepoDiffLayerKind;
  baseRef?: string;
  compareRef?: string;
  paths?: readonly string[];
  tier: RepoDiffTier;
  diagnostics: Array<{ level: "info" | "warning"; kind: string; message: string; path: string | null }>;
}): RepoDiffLayer | null {
  const resolved = repoDiffGitArgs(input);
  if (resolved.missing) {
    input.diagnostics.push({
      level: "warning",
      kind: "branch_refs_missing",
      message: resolved.missing,
      path: null,
    });
    return null;
  }
  const pathArgs = repoDiffPathArgs(input.paths);
  const raw = runRepoDiffGit(input.worktreePath, [...resolved.selector, "--raw", "-z", ...pathArgs]) ?? "";
  const numstat = runRepoDiffGit(input.worktreePath, [...resolved.selector, "--numstat", "-z", ...pathArgs]) ?? "";
  const shortstat = runRepoDiffGit(input.worktreePath, [...resolved.selector, "--shortstat", ...pathArgs])
    ?.trim() || null;
  let files = parseRepoDiffRawZ(raw, parseRepoDiffNumstatZ(numstat));
  if (input.kind === "branch") {
    files = sortRepoDiffFilesRecentFirst(files, recentBranchDiffPaths(input));
  }

  const patchFlags = [
    "--no-color",
    "--no-ext-diff",
    "--default-prefix",
    "--full-index",
    "-U3",
  ];
  const patchArgs = [...resolved.selector, ...patchFlags, ...pathArgs];
  const command = ["git", ...patchArgs];
  let rawPatch: string | null = null;
  let rawPatchBytes = 0;
  let truncated = false;

  if (input.tier === "patch") {
    const patch = runRepoDiffGit(input.worktreePath, patchArgs, REPO_DIFF_GIT_MAX_BUFFER) ?? "";
    rawPatchBytes = Buffer.byteLength(patch);
    const maxPatchBytes = REPO_DIFF_VIEWER_LIMITS.maxPatchBytes ?? 2_000_000;
    if (rawPatchBytes > maxPatchBytes) {
      truncated = true;
      rawPatch = patch.slice(0, maxPatchBytes);
      input.diagnostics.push({
        level: "warning",
        kind: "patch_truncated",
        message: `Patch text truncated to ${maxPatchBytes} of ${rawPatchBytes} bytes.`,
        path: null,
      });
    } else {
      rawPatch = patch;
    }
  }

  return {
    kind: input.kind,
    baseLabel: resolved.baseLabel,
    compareLabel: resolved.compareLabel,
    command,
    patchOid: stableHash(`${command.join("\0")}\0${raw}\0${numstat}\0${shortstat ?? ""}\0${rawPatch ?? ""}`),
    rawPatch,
    rawPatchBytes,
    truncated,
    files,
    shortstat,
  };
}

function buildGitRepoDiffSnapshot(input: {
  worktreePath: string;
  layers: readonly RepoDiffLayerKind[];
  baseRef?: string;
  compareRef?: string;
  tier: RepoDiffTier;
  paths?: readonly string[];
}): ScoutRepoDiffSnapshot {
  const diagnostics: Array<{ level: "info" | "warning"; kind: string; message: string; path: string | null }> = [];
  const layers = input.layers
    .map((kind) => buildGitRepoDiffLayer({
      worktreePath: input.worktreePath,
      kind,
      baseRef: input.baseRef,
      compareRef: input.compareRef,
      paths: input.paths,
      tier: input.tier,
      diagnostics,
    }))
    .filter((layer): layer is RepoDiffLayer => Boolean(layer));

  if (input.tier === "summary" && layers.some((layer) => layer.files.length > 100)) {
    diagnostics.push({
      level: "info",
      kind: "large_diff_strategy",
      message: "Loaded a recent-first file inventory; select a file to fetch its patch text.",
      path: null,
    });
  }

  const renderKey = stableHash([
    "git-repo-diff",
    input.worktreePath,
    input.tier,
    input.baseRef ?? "",
    input.compareRef ?? "",
    input.paths?.join("\n") ?? "",
    layers.map((layer) => `${layer.kind}:${layer.patchOid}`).join("|"),
  ].join("\0"));

  return {
    schema: "openscout.repo.diff/v1",
    generatedAt: Date.now(),
    worktreePath: input.worktreePath,
    layers,
    coverage: {
      requestedLayers: input.layers.length,
      emittedLayers: layers.length,
      files: layers.reduce((sum, layer) => sum + layer.files.length, 0),
      patchBytes: layers.reduce((sum, layer) => sum + layer.rawPatchBytes, 0),
      truncatedLayers: layers.filter((layer) => layer.truncated).length,
      scanBudgetReached: false,
    },
    diagnostics,
    scout: { worktreeId: `worktree:${stableHash(input.worktreePath)}`, projectId: null, agents: [], sessions: [], hints: [] },
    render: {
      renderKey,
      cachePolicy: "local-disposable",
      preferredTheme: "pierre-dark",
      preferredLayout: "split",
    },
  };
}

function shouldUseGitRepoDiffFallback(input: {
  tier: RepoDiffTier;
  paths?: readonly string[];
}): boolean {
  return input.tier === "summary" || (input.paths?.length ?? 0) > 0;
}

function emptyRepoDiffSnapshot(input: {
  worktreePath: string;
  layers: readonly RepoDiffLayerKind[];
  scope: RepoDiffScopeMetadata;
}): ScopedRepoDiffSnapshot {
  const layers = input.layers.map((kind) => {
    const labels = repoDiffLayerLabels(kind);
    return {
      kind,
      baseLabel: labels.base,
      compareLabel: labels.compare,
      command: ["git", "diff"],
      patchOid: stableHash(`empty:${input.worktreePath}:${kind}:${input.scope.kind}`),
      rawPatch: "",
      rawPatchBytes: 0,
      truncated: false,
      files: [],
      shortstat: null,
    };
  });
  return {
    schema: "openscout.repo.diff/v1",
    generatedAt: Date.now(),
    worktreePath: input.worktreePath,
    layers,
    coverage: {
      requestedLayers: input.layers.length,
      emittedLayers: layers.length,
      files: 0,
      patchBytes: 0,
      truncatedLayers: 0,
      scanBudgetReached: false,
    },
    diagnostics: [],
    scout: { worktreeId: null, projectId: null, agents: [], sessions: [], hints: [] },
    render: {
      renderKey: stableHash(`empty-render:${input.worktreePath}:${input.layers.join(",")}:${input.scope.kind}`),
      cachePolicy: "local-disposable",
      preferredTheme: "pierre-dark",
      preferredLayout: "split",
    },
    scope: input.scope,
  };
}

function trimRepoDiffCache(cache: Map<string, RepoDiffCacheEntry>): void {
  while (cache.size > REPO_DIFF_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

type FleetHomeBrief = {
  id: string;
  statement: string;
  summary: string;
  observations: FleetHomeBriefObservation[];
  preparedAt: number;
  expiresAt: number;
  ttlMs: number;
  sourceBriefId: string;
};

type FleetHomeBriefReference = {
  id: string;
  kind: string;
  label: string;
  route?: Record<string, unknown>;
  detail?: string;
};

type FleetHomeBriefObservation = {
  id: string;
  text: string;
  tone?: string;
  references: FleetHomeBriefReference[];
};

const FLEET_HOME_BRIEF_TTL_MS = 30 * 60_000;

function persistBriefing(
  kind: BriefingKind,
  brief: ScoutbotBrief,
  capture: ScoutbotBriefCapture,
): void {
  try {
    const observations = brief.steps.flatMap((step) => step.observations ?? []);
    saveBriefing({
      id: brief.id,
      kind,
      title: brief.title,
      summary: brief.summary,
      recommendation: brief.recommendation || null,
      preparedAt: brief.preparedAt,
      ttlMs: brief.ttlMs,
      brief,
      observations,
      snapshot: capture.snapshot,
      call: capture.call,
      markdown: brief.markdown ?? null,
    });
  } catch (err) {
    console.warn(
      "[briefings] auto-save failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

function buildFleetHomeBrief(brief: ScoutbotBrief): FleetHomeBrief {
  const fleetStep = brief.steps.find((step) => step.route?.view === "fleet");
  const statement = (fleetStep?.narration ?? brief.steps[0]?.narration ?? brief.summary).trim();
  const observations = buildFleetHomeBriefObservations(statement || brief.summary, fleetStep?.observations ?? []);
  return {
    id: `fleet-home:${brief.id}`,
    statement: statement || brief.summary,
    summary: brief.summary,
    observations,
    preparedAt: brief.preparedAt,
    expiresAt: brief.expiresAt,
    ttlMs: brief.ttlMs,
    sourceBriefId: brief.id,
  };
}

function buildFleetHomeBriefObservations(
  statement: string,
  modelObservations: ScoutbotBriefObservation[],
): FleetHomeBriefObservation[] {
  const modelItems = modelObservations
    .map((item, index) => ({
      id: `obs-${index + 1}`,
      text: item.text.trim(),
      ...(item.tone ? { tone: item.tone } : {}),
      references: dedupeFleetBriefReferences(item.references.map(normalizeFleetBriefReference).filter(Boolean)),
    }))
    .filter((item) => item.text);

  const baseItems = modelItems.length > 0
    ? modelItems
    : splitFleetBriefSentences(statement).map((text, index) => ({
      id: `obs-${index + 1}`,
      text,
      references: [] as FleetHomeBriefReference[],
    }));

  return baseItems.map((item, index) => ({
    ...item,
    id: item.id || `obs-${index + 1}`,
    references: dedupeFleetBriefReferences([
      ...item.references,
      ...inferFleetBriefReferences(item.text),
    ]).slice(0, 4),
  }));
}

function splitFleetBriefSentences(value: string): string[] {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return [];
  const parts = compact.match(/[^.!?]+[.!?]?/g)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [compact];
  return parts.slice(0, 4).map((part) => /[.!?]$/.test(part) ? part : `${part}.`);
}

function normalizeFleetBriefReference(ref: ScoutbotBriefReference): FleetHomeBriefReference | null {
  const label = ref.label.trim();
  if (!label) return null;
  const id = `${ref.kind}:${label}:${JSON.stringify(ref.route ?? {})}`;
  return {
    id,
    kind: ref.kind,
    label,
    ...(ref.route ? { route: ref.route } : {}),
    ...(ref.detail ? { detail: ref.detail } : {}),
  };
}

function inferFleetBriefReferences(text: string): FleetHomeBriefReference[] {
  const refs: FleetHomeBriefReference[] = [];
  const lower = text.toLowerCase();
  const agents = queryAgents(200).filter((agent) => !isScoutbotLikeAgentRecord(agent));
  for (const agent of agents) {
    const names = [agent.name, agent.handle ? `@${agent.handle}` : "", agent.handle ?? ""]
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.some((name) => lower.includes(name.toLowerCase()))) {
      refs.push({
        id: `agent:${agent.id}`,
        kind: "agent",
        label: agent.name,
        route: { view: "agents", agentId: agent.id, tab: "observe" },
        ...(agent.handle ? { detail: `@${agent.handle}` } : {}),
      });
    }
  }

  const fleet = queryFleet({ limit: 12, activityLimit: 40 });
  const attentionTerms = /\b(attention|badge|pending|review|reviews|blocked|blocking|stalled|waiting|open work|work items?|next moves?|operator)\b/i;
  if (attentionTerms.test(text)) {
    for (const item of fleet.needsAttention.slice(0, 3)) {
      refs.push({
        id: `${item.kind}:${item.recordId}`,
        kind: item.kind === "work_item" ? "work" : "question",
        label: item.title,
        route: item.kind === "work_item"
          ? { view: "work", workId: item.recordId }
          : item.conversationId
            ? { view: "conversation", conversationId: item.conversationId }
            : { view: "activity" },
        detail: item.agentName ?? item.state,
      });
    }
    for (const ask of fleet.recentCompleted.filter((item) => item.status === "failed" || item.attention !== "silent").slice(0, 2)) {
      refs.push({
        id: `ask:${ask.invocationId}`,
        kind: ask.status === "failed" ? "failure" : "ask",
        label: ask.agentName ?? ask.task,
        route: ask.conversationId
          ? { view: "conversation", conversationId: ask.conversationId }
          : { view: "agents", agentId: ask.agentId, tab: "observe" },
        detail: ask.statusLabel,
      });
    }
  }

  const sessionTerms = /\b(session|transcript|assets?|artifact|render|copy|font|files?)\b/i;
  if (sessionTerms.test(text)) {
    const sessions = querySessions(80);
    for (const session of sessions.slice(0, 2)) {
      const label = session.title || session.agentName || session.id;
      if (
        lower.includes(label.toLowerCase())
        || (session.agentName && lower.includes(session.agentName.toLowerCase()))
        || (session.preview && hasSharedWord(lower, session.preview.toLowerCase()))
      ) {
        refs.push({
          id: `session:${session.id}`,
          kind: "session",
          label,
          route: { view: "sessions", sessionId: session.id },
          ...(session.agentName ? { detail: session.agentName } : {}),
        });
      }
    }
  }

  const conversationTerms = /\b(conversation|thread|message|handoff|approval|approved|ship|shipped|completed)\b/i;
  if (conversationTerms.test(text)) {
    for (const activity of queryActivity(80).slice(0, 4)) {
      const haystack = `${activity.actorName ?? ""} ${activity.agentName ?? ""} ${activity.title ?? ""} ${activity.summary ?? ""}`.toLowerCase();
      if (!activity.conversationId || !hasSharedWord(lower, haystack)) continue;
      refs.push({
        id: `conversation:${activity.conversationId}`,
        kind: "conversation",
        label: activity.title ?? activity.actorName ?? "Open thread",
        route: { view: "conversation", conversationId: activity.conversationId },
        detail: activity.actorName ?? undefined,
      });
      break;
    }
  }

  return refs;
}

function hasSharedWord(left: string, right: string): boolean {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "work", "item", "items"]);
  const words = left
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 5 && !stop.has(word));
  return words.some((word) => right.includes(word));
}

function dedupeFleetBriefReferences(refs: FleetHomeBriefReference[]): FleetHomeBriefReference[] {
  const seen = new Set<string>();
  const result: FleetHomeBriefReference[] = [];
  for (const ref of refs) {
    const key = ref.id || `${ref.kind}:${ref.label}:${JSON.stringify(ref.route ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export type OpenScoutWebServer = {
  app: Hono;
  warmupCaches: () => Promise<void>;
  stop: () => Promise<void>;
};

type OperatorAttentionItem = {
  id: string;
  kind: "approval" | "configuration" | "ask" | "work_item" | "question" | "session";
  title: string;
  summary: string | null;
  detail: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  updatedAt: number;
  severity: "critical" | "warning" | "info";
  sourceLabel: string;
  approval?: ScoutPairingState["pendingApprovals"][number];
  unblockRequest?: UnblockRequestRecord;
  actions: Array<{
    kind: "approve" | "deny" | "open" | "configure" | "copy" | "dismiss";
    label: string;
    route?: { view: string; [key: string]: string | undefined };
    value?: string;
    recordId?: string;
    recordKind?: CollaborationKind;
    flightId?: string;
    unblockRequestId?: string;
  }>;
};

type OpenScoutBuildInfo = {
  version: string | null;
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
  mode: "dev" | "production";
};

function parseOptionalPositiveInt(
  value: string | undefined,
  fallback?: number,
): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  return undefined;
}

type HarnessTranscriptSourceRef = Extract<KnowledgeSourceRef, { kind: "harness_transcript" }>;

type JsonlPreviewRecord = {
  index: number;
  raw: string;
  type?: string;
  role?: string;
  kind?: string;
  summary: string;
  renderedText: string;
  parsed: boolean;
  matched?: boolean;
  matchCount?: number;
  matchTerms?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function trimPreviewLine(value: string, max = 260): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 3))}...`;
}

function previewQueryTerms(query: string | undefined): string[] {
  const seen = new Set<string>();
  return (query ?? "")
    .split(/[^A-Za-z0-9_./-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .filter((term) => {
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function matchStats(text: string, terms: string[]): { count: number; terms: string[] } {
  if (!text || terms.length === 0) return { count: 0, terms: [] };
  const lower = text.toLowerCase();
  let count = 0;
  const matchedTerms: string[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    let index = lower.indexOf(needle);
    let matched = false;
    while (index >= 0) {
      count++;
      matched = true;
      index = lower.indexOf(needle, index + needle.length);
    }
    if (matched) matchedTerms.push(term);
  }
  return { count, terms: matchedTerms };
}

function extractPreviewText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => extractPreviewText(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join(" ");
    return joined || null;
  }
  if (!isRecord(value)) return null;
  for (const key of [
    "text",
    "message",
    "content",
    "input",
    "arguments",
    "args",
    "output",
    "result",
    "prompt",
    "command",
    "lastPrompt",
    "aiTitle",
    "summary",
  ]) {
    const extracted = extractPreviewText(value[key]);
    if (extracted) return extracted;
  }
  return null;
}

function summarizeJsonlRecord(raw: string, index: number, terms: string[]): JsonlPreviewRecord {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const payload = isRecord(parsed) ? parsed.payload : null;
    const message = isRecord(parsed) ? parsed.message : null;
    const candidate = payload ?? message ?? parsed;
    const type = stringField(parsed, "type") ?? stringField(candidate, "type");
    const role = stringField(parsed, "role") ?? stringField(candidate, "role") ?? stringField(message, "role");
    const kind = stringField(parsed, "kind") ?? stringField(candidate, "kind") ?? type ?? role;
    const renderedText = extractPreviewText(candidate) ?? extractPreviewText(parsed) ?? raw;
    const summary = trimPreviewLine(renderedText);
    const stats = matchStats(`${summary}\n${renderedText}\n${raw}`, terms);
    return {
      index,
      raw,
      ...(type ? { type } : {}),
      ...(role ? { role } : {}),
      ...(kind ? { kind } : {}),
      summary,
      renderedText,
      parsed: true,
      matched: stats.count > 0,
      matchCount: stats.count,
      matchTerms: stats.terms,
    };
  } catch {
    const stats = matchStats(raw, terms);
    return {
      index,
      raw,
      kind: "unparseable",
      summary: trimPreviewLine(raw),
      renderedText: raw,
      parsed: false,
      matched: stats.count > 0,
      matchCount: stats.count,
      matchTerms: stats.terms,
    };
  }
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveKnowledgePreviewPath(
  sourceRef: HarnessTranscriptSourceRef,
  currentDirectory: string,
): string | null {
  const paths = resolveOpenScoutKnowledgePaths();
  const controlHome = dirname(paths.knowledgeRoot);
  const portable = sourceRef.path;
  const relPath = portable.relPath?.trim();
  if (!relPath) return null;

  if (portable.root === "ABSOLUTE") {
    const absolute = resolve(relPath);
    const trustedRoots = [homedir(), currentDirectory, controlHome].map((root) => resolve(root));
    return trustedRoots.some((root) => isInsideRoot(root, absolute)) ? absolute : null;
  }

  const root = portable.root === "HOME"
    ? homedir()
    : portable.root === "OPENSCOUT_CONTROL_HOME"
      ? controlHome
      : portable.root === "OPENSCOUT_SUPPORT_DIRECTORY"
        ? dirname(controlHome)
        : portable.root === "PROJECT_ROOT"
          ? currentDirectory
          : null;
  if (!root) return null;
  const resolved = resolve(root, relPath);
  return isInsideRoot(resolve(root), resolved) ? resolved : null;
}

async function readKnowledgeJsonlPreview(input: {
  sourceRef: HarnessTranscriptSourceRef;
  currentDirectory: string;
  contextRecords?: number;
  maxRecords?: number;
  query?: string;
}) {
  const resolvedPath = resolveKnowledgePreviewPath(input.sourceRef, input.currentDirectory);
  if (!resolvedPath) {
    throw new Error("source path is outside trusted preview roots");
  }
  const stats = statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error("source path is not a file");
  }

  const requested = input.sourceRef.recordRange;
  const requestedStart = Array.isArray(requested) && Number.isFinite(requested[0])
    ? Math.max(0, Math.floor(requested[0]))
    : 0;
  const requestedEnd = Array.isArray(requested) && Number.isFinite(requested[1])
    ? Math.max(requestedStart, Math.floor(requested[1]))
    : requestedStart + 24;
  const contextRecords = Math.min(20, Math.max(0, Math.floor(input.contextRecords ?? 4)));
  const maxRecords = Math.min(120, Math.max(1, Math.floor(input.maxRecords ?? 80)));
  const start = Math.max(0, requestedStart - contextRecords);
  const desiredEnd = requestedEnd + contextRecords;
  const end = Math.min(desiredEnd, start + maxRecords - 1);
  const terms = previewQueryTerms(input.query);

  const records: JsonlPreviewRecord[] = [];
  let index = 0;
  let truncatedAfter = false;
  const reader = createInterface({
    input: createReadStream(resolvedPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (index > end) {
      truncatedAfter = true;
      reader.close();
      break;
    }
    if (index >= start) {
      records.push(summarizeJsonlRecord(line, index, terms));
    }
    index++;
  }

  const first = records[0]?.index ?? start;
  const last = records.at(-1)?.index ?? first;
  return {
    path: resolvedPath,
    sourcePath: input.sourceRef.path,
    harness: input.sourceRef.harness,
    sessionId: input.sourceRef.sessionId,
    requestedRange: requested,
    previewRange: [first, last] as [number, number],
    records,
    recordsRead: records.length,
    truncatedBefore: start > 0,
    truncatedAfter,
    query: input.query,
    queryTerms: terms,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const EXECUTION_SESSION_PREFERENCES = new Set(["new", "existing", "any"]);

function normalizeExecutionSession(
  value: unknown,
): "new" | "existing" | "any" | undefined {
  const normalized = optionalString(value)?.trim();
  return normalized && EXECUTION_SESSION_PREFERENCES.has(normalized)
    ? (normalized as "new" | "existing" | "any")
    : undefined;
}

const KNOWN_AGENT_HARNESSES = new Set<string>([
  "codex",
  "claude",
  "flue",
  "cursor",
  "native",
  "worker",
  "bridge",
  "http",
  "pi",
]);

function coerceAgentHarness(value: unknown): AgentHarness | undefined {
  const normalized = optionalString(value)?.trim();
  return normalized && KNOWN_AGENT_HARNESSES.has(normalized)
    ? (normalized as AgentHarness)
    : undefined;
}

function recordInput(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function firstMetadataString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function parseTerminalSessionBackend(value: string | undefined): "tmux" | "zellij" | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "tmux" || normalized === "zellij" ? normalized : undefined;
}

function parseTerminalSessionLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(1000, Math.floor(parsed)) : 100;
}

function parseTerminalSessionDiscoveryFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "backend";
}

function parseTerminalSurfaceControlAction(value: string | undefined): "interrupt" | "quit" | "stop-job" | "restart-resume" | "detach" | "force-quit" | "force-quit-bridge" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "interrupt"
    || normalized === "quit"
    || normalized === "stop-job"
    || normalized === "restart-resume"
    || normalized === "detach"
    || normalized === "force-quit"
    || normalized === "force-quit-bridge"
  ) {
    return normalized;
  }
  return undefined;
}

type TmuxPaneProcess = {
  pid: number;
  ppid: number;
  pgid: number;
  comm: string;
};

type ProcessCommandRow = TmuxPaneProcess & {
  command: string;
};

type RelayRuntimeState = {
  agentId?: string;
  projectRoot?: string;
  sessionId?: string;
  promptFile?: string;
  launchScript?: string;
};

function parseProcessNumber(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function tmuxPaneDetail(sessionName: string): { panePid: number; paneTty: string; paneCurrentPath: string | null } | null {
  try {
    const output = execFileSync("tmux", [
      "display-message",
      "-p",
      "-t",
      sessionName,
      "#{pane_pid}\t#{pane_tty}\t#{pane_current_path}",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const [pidRaw, ttyRaw, pathRaw] = output.split("\t");
    const panePid = parseProcessNumber(pidRaw);
    const paneTty = ttyRaw?.replace(/^\/dev\//u, "").trim();
    const paneCurrentPath = pathRaw?.trim() || null;
    return panePid && paneTty ? { panePid, paneTty, paneCurrentPath } : null;
  } catch {
    return null;
  }
}

function processRowsForTty(tty: string): TmuxPaneProcess[] {
  try {
    const output = execFileSync("ps", [
      "-t",
      tty,
      "-o",
      "pid=,ppid=,pgid=,comm=",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/u);
        const pid = parseProcessNumber(parts[0]);
        const ppid = parseProcessNumber(parts[1]);
        const pgid = parseProcessNumber(parts[2]);
        const comm = parts.slice(3).join(" ");
        return pid && ppid && pgid && comm ? { pid, ppid, pgid, comm } : null;
      })
      .filter((row): row is TmuxPaneProcess => Boolean(row));
  } catch {
    return [];
  }
}

function allProcessRows(): TmuxPaneProcess[] {
  try {
    const output = execFileSync("ps", [
      "-axo",
      "pid=,ppid=,pgid=,comm=",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/u);
        const pid = parseProcessNumber(parts[0]);
        const ppid = parseProcessNumber(parts[1]);
        const pgid = parseProcessNumber(parts[2]);
        const comm = parts.slice(3).join(" ");
        return pid && ppid && pgid && comm ? { pid, ppid, pgid, comm } : null;
      })
      .filter((row): row is TmuxPaneProcess => Boolean(row));
  } catch {
    return [];
  }
}

function allProcessCommandRows(): ProcessCommandRow[] {
  try {
    const output = execFileSync("ps", [
      "-axo",
      "pid=,ppid=,pgid=,command=",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/u);
        const pid = parseProcessNumber(parts[0]);
        const ppid = parseProcessNumber(parts[1]);
        const pgid = parseProcessNumber(parts[2]);
        const command = parts.slice(3).join(" ");
        const comm = command.split(/\s+/u)[0] ?? "";
        return pid && ppid && pgid && comm && command
          ? { pid, ppid, pgid, comm, command }
          : null;
      })
      .filter((row): row is ProcessCommandRow => Boolean(row));
  } catch {
    return [];
  }
}

function processRowsForTmuxPane(detail: { panePid: number; paneTty: string }): TmuxPaneProcess[] {
  const byPid = new Map<number, TmuxPaneProcess>();
  // Keep tty-derived parentage first: macOS can report long-running tmux pane
  // children as reparented elsewhere, while the tty scan still exposes the
  // pane-to-Claude relationship we need to find no-tty shell jobs.
  for (const row of processRowsForTty(detail.paneTty)) {
    byPid.set(row.pid, row);
  }
  for (const row of allProcessRows()) {
    if (!byPid.has(row.pid)) byPid.set(row.pid, row);
  }
  return [...byPid.values()];
}

function descendantsOf(rootPid: number, rows: TmuxPaneProcess[]): Set<number> {
  const descendants = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.ppid !== rootPid && !descendants.has(row.ppid)) continue;
      if (descendants.has(row.pid)) continue;
      descendants.add(row.pid);
      changed = true;
    }
  }
  return descendants;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcesses(pids: number[], signal: NodeJS.Signals): number {
  let killed = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      killed += 1;
    } catch {
      // The process may already be gone.
    }
  }
  return killed;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:+=@%-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function readProcessCwd(pid: number): string | null {
  try {
    const output = execFileSync("lsof", [
      "-a",
      "-p",
      String(pid),
      "-d",
      "cwd",
      "-Fn",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of output.split(/\r?\n/u)) {
      if (!line.startsWith("n")) continue;
      const value = line.slice(1).trim();
      if (value) return value;
    }
  } catch {
    return null;
  }
  return null;
}

function claudeProjectDirForCwd(cwd: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/\//gu, "-"));
}

function mostRecentClaudeSessionForCwd(cwd: string): { sessionId: string; transcriptPath: string } | null {
  const dir = claudeProjectDirForCwd(cwd);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  let best: { sessionId: string; transcriptPath: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const transcriptPath = join(dir, entry);
    try {
      const mtimeMs = statSync(transcriptPath).mtimeMs;
      if (!best || mtimeMs > best.mtimeMs) {
        best = {
          sessionId: entry.slice(0, -".jsonl".length),
          transcriptPath,
          mtimeMs,
        };
      }
    } catch {
      // Ignore stale entries that disappeared while scanning.
    }
  }
  return best ? { sessionId: best.sessionId, transcriptPath: best.transcriptPath } : null;
}

function readRelayRuntimeStateForTmuxSession(sessionName: string): RelayRuntimeState | null {
  const agentsDir = resolveOpenScoutSupportPaths().relayAgentsDirectory;
  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const statePath = join(agentsDir, entry, "state.json");
    try {
      const parsed = JSON.parse(readFileSync(statePath, "utf8")) as RelayRuntimeState;
      if (parsed.sessionId === sessionName) return parsed;
    } catch {
      // Ignore malformed or partially-written runtime state files.
    }
  }
  return null;
}

function resumeScriptFromLaunchScript(launchScript: string, sessionId: string): string {
  const resumePrefix = `exec claude --resume ${shellQuote(sessionId)} `;
  const rewritten = launchScript.replace(/(^|\n)(\s*)claude\s+/u, `$1$2${resumePrefix}`);
  return rewritten === launchScript
    ? `${launchScript}\n# OpenScout resume fallback\n${resumePrefix}\n`
    : rewritten;
}

function forceQuitRelayAgentProcessTree(agentId: string): boolean {
  const rows = allProcessCommandRows();
  const claudeRoots = rows.filter((row) =>
    /(^|\/)claude(\s|$)/u.test(row.command) && row.command.includes(agentId)
  );
  const targetPids = new Set<number>();
  for (const root of claudeRoots) {
    targetPids.add(root.pid);
    const descendants = descendantsOf(root.pid, rows);
    const targetGroups = new Set<number>([root.pgid]);
    for (const row of rows) {
      if (descendants.has(row.pid)) {
        targetPids.add(row.pid);
        targetGroups.add(row.pgid);
      }
    }
    for (const row of rows) {
      if (targetGroups.has(row.pgid)) targetPids.add(row.pid);
    }
  }
  return terminateProcessesWithEscalation([...targetPids]);
}

function restartClaudeWithResumeInTmuxSurface(sessionName: string): { ok: boolean; sessionId: string | null; transcriptPath: string | null } {
  const runtimeState = readRelayRuntimeStateForTmuxSession(sessionName);
  const detail = tmuxPaneDetail(sessionName);
  const surface = detail ? claudeRowsInTmuxSurface(sessionName) : null;
  const liveClaudeCwd = surface?.claudeRows[0]?.pid
    ? readProcessCwd(surface.claudeRows[0].pid)
    : null;
  const cwd = runtimeState?.projectRoot
    ?? liveClaudeCwd
    ?? detail?.paneCurrentPath
    ?? null;
  if (!cwd) return { ok: false, sessionId: null, transcriptPath: null };
  const transcript = mostRecentClaudeSessionForCwd(cwd);
  if (!transcript) return { ok: false, sessionId: null, transcriptPath: null };

  const launchScriptPath = runtimeState?.launchScript;
  const launchScript = launchScriptPath && existsSync(launchScriptPath)
    ? readFileSync(launchScriptPath, "utf8")
    : `#!/bin/bash
set -uo pipefail
cd ${shellQuote(cwd)}
exec claude --resume ${shellQuote(transcript.sessionId)}
`;
  const resumeScript = resumeScriptFromLaunchScript(launchScript, transcript.sessionId);

  try {
    if (runtimeState?.agentId) {
      forceQuitRelayAgentProcessTree(runtimeState.agentId);
    } else if (detail) {
      forceQuitClaudeInTmuxSurface(sessionName);
    }
    const command = `bash -lc ${shellQuote(resumeScript)}`;
    if (detail) {
      execFileSync("tmux", [
        "respawn-pane",
        "-k",
        "-t",
        sessionName,
        "-c",
        cwd,
        command,
      ], { stdio: "ignore" });
    } else {
      execFileSync("tmux", [
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-c",
        cwd,
        command,
      ], { stdio: "ignore" });
    }
    return { ok: true, sessionId: transcript.sessionId, transcriptPath: transcript.transcriptPath };
  } catch {
    return { ok: false, sessionId: transcript.sessionId, transcriptPath: transcript.transcriptPath };
  }
}

function terminateProcessesWithEscalation(pids: number[]): boolean {
  const targetPids = [...new Set(pids)]
    .filter((pid) => Number.isFinite(pid) && pid > 0)
    .sort((left, right) => right - left);
  if (targetPids.length === 0) return false;
  killProcesses(targetPids, "SIGTERM");
  const stillAlive = targetPids.filter(processExists);
  if (stillAlive.length > 0) {
    setTimeout(() => {
      killProcesses(stillAlive.filter(processExists), "SIGKILL");
    }, 750);
  }
  return true;
}

function claudeRowsInTmuxSurface(sessionName: string): {
  detail: { panePid: number; paneTty: string };
  rows: TmuxPaneProcess[];
  panePgid: number;
  claudeRows: TmuxPaneProcess[];
} | null {
  const detail = tmuxPaneDetail(sessionName);
  if (!detail) return null;
  const rows = processRowsForTmuxPane(detail);
  const descendantPids = descendantsOf(detail.panePid, rows);
  const panePgid = rows.find((row) => row.pid === detail.panePid)?.pgid ?? detail.panePid;
  const claudeRows = rows.filter((row) =>
    descendantPids.has(row.pid) && /(^|\/)claude$/u.test(row.comm)
  );
  return { detail, rows, panePgid, claudeRows };
}

function stopClaudeActiveJobInTmuxSurface(sessionName: string): boolean {
  const surface = claudeRowsInTmuxSurface(sessionName);
  if (!surface) return false;
  const targetPids = new Set<number>();
  for (const claudeRow of surface.claudeRows) {
    const claudeDescendants = descendantsOf(claudeRow.pid, surface.rows);
    const jobGroups = new Set(
      surface.rows
        .filter((row) =>
          claudeDescendants.has(row.pid)
          && row.pgid !== surface.panePgid
          && row.pgid !== claudeRow.pgid
        )
        .map((row) => row.pgid),
    );
    for (const row of surface.rows) {
      if (claudeDescendants.has(row.pid) && jobGroups.has(row.pgid)) {
        targetPids.add(row.pid);
      }
    }
  }
  return terminateProcessesWithEscalation([...targetPids]);
}

function forceQuitClaudeInTmuxSurface(sessionName: string): boolean {
  const surface = claudeRowsInTmuxSurface(sessionName);
  if (!surface) return false;
  const targetPids = [...new Set(surface.claudeRows.flatMap((row) =>
    surface.rows
      .filter((candidate) => candidate.pid === row.pid || descendantsOf(row.pid, surface.rows).has(candidate.pid))
      .map((candidate) => candidate.pid)
  ))].sort((left, right) => right - left);
  return terminateProcessesWithEscalation(targetPids);
}

function controlTmuxSurface(sessionName: string, action: "interrupt" | "quit" | "stop-job" | "restart-resume" | "detach" | "force-quit"): boolean {
  try {
    if (action === "interrupt") {
      execFileSync("tmux", ["send-keys", "-t", sessionName, "C-c"], { stdio: "ignore" });
      return true;
    }
    if (action === "quit") {
      execFileSync("tmux", ["send-keys", "-t", sessionName, "C-d"], { stdio: "ignore" });
      return true;
    }
    if (action === "stop-job") {
      return stopClaudeActiveJobInTmuxSurface(sessionName);
    }
    if (action === "restart-resume") {
      return restartClaudeWithResumeInTmuxSurface(sessionName).ok;
    }
    if (action === "force-quit") {
      return forceQuitClaudeInTmuxSurface(sessionName);
    }
    execFileSync("tmux", ["detach-client", "-s", sessionName], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function metadataTimestampMs(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return numeric > 10_000_000_000 ? Math.floor(numeric) : Math.floor(numeric * 1000);
}

function agentEndpointMetadata(endpoint: AgentEndpoint | null | undefined): Record<string, unknown> {
  return endpointMetadataRecord(endpoint);
}

function activeEndpointForAgent(
  snapshot: { endpoints?: Record<string, AgentEndpoint> },
  agentId: string,
  preference?: EndpointPreference,
): AgentEndpoint | null {
  return selectPreferredAgentEndpoint(snapshot, agentId, preference);
}

const ACTIVE_BROKER_FLIGHT_STATES = new Set(["queued", "waking", "running", "waiting"]);

function metadataStringValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  return firstMetadataString(metadata?.[key]);
}

function metadataBooleanValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  return metadata?.[key] === true;
}

function metadataStringArrayValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function metadataRecordValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = metadata?.[key];
  return recordInput(value);
}

function metadataRecordArrayValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown>[] {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(recordInput).filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function isBrokerAgentVisibleInWeb(agent: ScoutBrokerContext["snapshot"]["agents"][string]): boolean {
  const metadata = recordInput(agent.metadata);
  return metadataBooleanValue(metadata, "brokerRegistered")
    && !metadataBooleanValue(metadata, "staleLocalRegistration")
    && !metadataBooleanValue(metadata, "retiredFromFleet");
}

function latestBrokerAgentTimestamp(
  agent: ScoutBrokerContext["snapshot"]["agents"][string],
  endpoint: AgentEndpoint | null,
): number | null {
  const agentMetadata = recordInput(agent.metadata);
  const endpointMetadata = agentEndpointMetadata(endpoint);
  const timestamps = [
    agentMetadata?.createdAt,
    agentMetadata?.registeredAt,
    agentMetadata?.updatedAt,
    endpointMetadata.lastSeenAt,
    endpointMetadata.lastEnsuredAt,
    endpointMetadata.startedAt,
    endpointMetadata.lastStartedAt,
    endpointMetadata.lastCompletedAt,
    endpointMetadata.lastFailedAt,
  ].map(metadataTimestampMs).filter((value): value is number => value !== undefined);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function brokerAgentFlightPhase(
  broker: ScoutBrokerContext,
  agentId: string,
): "in_turn" | "in_flight" | null {
  let phase: "in_turn" | "in_flight" | null = null;
  for (const flight of Object.values(broker.snapshot.flights ?? {})) {
    if (flight.targetAgentId !== agentId || !ACTIVE_BROKER_FLIGHT_STATES.has(flight.state)) {
      continue;
    }
    if (flight.state === "running") {
      return "in_turn";
    }
    phase = "in_flight";
  }
  return phase;
}

function summarizeBrokerAgentState(
  agent: ScoutBrokerContext["snapshot"]["agents"][string],
  endpoint: AgentEndpoint | null,
  flightPhase: "in_turn" | "in_flight" | null,
): string {
  if (flightPhase === "in_turn") {
    return "working";
  }
  if (flightPhase === "in_flight") {
    return "in_flight";
  }
  void agent;
  void endpoint;
  return "available";
}

function brokerNodeName(
  broker: ScoutBrokerContext,
  nodeId: string | null | undefined,
): string | null {
  if (!nodeId) {
    return null;
  }
  return broker.snapshot.nodes?.[nodeId]?.name ?? null;
}

function brokerActorDisplay(
  broker: ScoutBrokerContext,
  actorId: string | null | undefined,
): { name: string | null; handle: string | null } {
  const actor = actorId ? broker.snapshot.actors?.[actorId] : null;
  return {
    name: actor?.displayName ?? null,
    handle: actor?.handle ?? null,
  };
}

function projectNameFromRoot(path: string | null): string | null {
  const normalized = path?.trim();
  return normalized ? basename(normalized) : null;
}

function brokerAgentIdentityMatches(
  agent: ScoutBrokerContext["snapshot"]["agents"][string],
  value: string,
): boolean {
  return [
    agent.id,
    agent.definitionId,
    agent.handle,
    agent.selector,
    agent.defaultSelector,
  ].some((candidate) => candidate === value);
}

function brokerAgentCapabilitiesForWeb(
  agent: ScoutBrokerContext["snapshot"]["agents"][string],
  metadata: Record<string, unknown> | null,
): string[] {
  const explicit = Array.isArray(agent.capabilities)
    ? agent.capabilities.map((capability) => String(capability).trim()).filter(Boolean)
    : [];
  if (explicit.length > 0) {
    return explicit;
  }
  const metadataCapabilities = metadataStringArrayValue(metadata, "capabilities");
  return metadataCapabilities.length > 0 ? metadataCapabilities : ["chat", "invoke"];
}

function brokerAgentCardMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return metadataRecordValue(metadata, "a2aAgentCard")
    ?? metadataRecordValue(metadata, "agentCard");
}

function brokerAgentProvider(
  metadata: Record<string, unknown> | null,
  card: Record<string, unknown> | null,
): { name: string | null; url: string | null } {
  const provider = metadataRecordValue(card, "provider")
    ?? metadataRecordValue(metadata, "provider");
  return {
    name: firstMetadataString(
      metadataStringValue(provider, "organization"),
      metadataStringValue(provider, "name"),
      metadataStringValue(metadata, "providerName"),
    ),
    url: firstMetadataString(
      metadataStringValue(provider, "url"),
      metadataStringValue(metadata, "providerUrl"),
    ),
  };
}

function brokerAgentProtocol(
  metadata: Record<string, unknown> | null,
  endpointMetadata: Record<string, unknown>,
): string | null {
  const supportedInterfaces = metadataRecordArrayValue(metadata, "supportedInterfaces")
    .concat(metadataRecordArrayValue(endpointMetadata, "supportedInterfaces"));
  const protocol = firstMetadataString(
    ...supportedInterfaces.map((entry) => metadataStringValue(entry, "protocol")),
    metadataStringValue(metadata, "protocol"),
    metadataStringValue(endpointMetadata, "protocol"),
  );
  if (protocol?.toLowerCase() === "a2a" || metadataStringValue(metadata, "a2aExecutionUrl")) {
    return "A2A";
  }
  return protocol;
}

function brokerAgentSkillNames(
  metadata: Record<string, unknown> | null,
  card: Record<string, unknown> | null,
): string[] {
  const skills = metadataRecordArrayValue(card, "skills")
    .concat(metadataRecordArrayValue(metadata, "skills"));
  return Array.from(new Set(
    skills
      .map((skill) => firstMetadataString(
        metadataStringValue(skill, "name"),
        metadataStringValue(skill, "id"),
      ))
      .filter((skill): skill is string => Boolean(skill)),
  ));
}

function brokerAgentCardToWebAgent(
  broker: ScoutBrokerContext,
  agent: ScoutBrokerContext["snapshot"]["agents"][string],
): WebAgent | null {
  if (!isBrokerAgentVisibleInWeb(agent)) {
    return null;
  }

  const endpoint = activeEndpointForAgent(broker.snapshot, agent.id);
  const agentMetadata = recordInput(agent.metadata);
  const endpointMetadata = agentEndpointMetadata(endpoint);
  const cardMetadata = brokerAgentCardMetadata(agentMetadata);
  const provider = brokerAgentProvider(agentMetadata, cardMetadata);
  const protocol = brokerAgentProtocol(agentMetadata, endpointMetadata);
  const skills = brokerAgentSkillNames(agentMetadata, cardMetadata);
  const projectRoot = firstMetadataString(
    endpoint?.projectRoot,
    metadataStringValue(endpointMetadata, "projectRoot"),
    metadataStringValue(agentMetadata, "projectRoot"),
  );
  const cwd = firstMetadataString(
    endpoint?.cwd,
    metadataStringValue(endpointMetadata, "currentDirectory"),
    metadataStringValue(endpointMetadata, "cwd"),
    metadataStringValue(agentMetadata, "currentDirectory"),
    metadataStringValue(agentMetadata, "cwd"),
    projectRoot,
  );
  const owner = brokerActorDisplay(broker, agent.ownerId);
  const createdAt = metadataTimestampMs(agentMetadata?.createdAt)
    ?? metadataTimestampMs(agentMetadata?.registeredAt)
    ?? null;
  const updatedAt = latestBrokerAgentTimestamp(agent, endpoint) ?? createdAt;

  return {
    id: agent.id,
    definitionId: agent.definitionId,
    name: agent.displayName,
    handle: agent.handle ?? null,
    agentClass: agent.agentClass,
    harness: endpoint?.harness ?? metadataStringValue(agentMetadata, "harness"),
    state: summarizeBrokerAgentState(agent, endpoint, brokerAgentFlightPhase(broker, agent.id)),
    projectRoot: compactPath(projectRoot),
    cwd: compactPath(cwd),
    updatedAt,
    createdAt,
    transport: endpoint?.transport ?? metadataStringValue(agentMetadata, "transport"),
    selector: agent.selector ?? metadataStringValue(agentMetadata, "selector"),
    defaultSelector: agent.defaultSelector ?? metadataStringValue(agentMetadata, "defaultSelector"),
    nodeQualifier: agent.nodeQualifier ?? metadataStringValue(agentMetadata, "nodeQualifier"),
    workspaceQualifier: agent.workspaceQualifier ?? metadataStringValue(agentMetadata, "workspaceQualifier"),
    wakePolicy: agent.wakePolicy,
    capabilities: brokerAgentCapabilitiesForWeb(agent, agentMetadata),
    project: metadataStringValue(agentMetadata, "project") ?? projectNameFromRoot(projectRoot),
    branch: metadataStringValue(agentMetadata, "branch") ?? metadataStringValue(endpointMetadata, "branch"),
    role: null,
    model: metadataStringValue(endpointMetadata, "model") ?? metadataStringValue(agentMetadata, "model"),
    harnessSessionId: resolveHarnessSessionIdForAgent(
      endpoint?.transport ?? metadataStringValue(agentMetadata, "transport"),
      endpoint?.sessionId ?? null,
      {
        ...agentMetadata,
        ...endpointMetadata,
      },
      summarizeBrokerAgentState(agent, endpoint, brokerAgentFlightPhase(broker, agent.id)),
    ),
    terminalSurface: resolveTerminalSurface({
      transport: endpoint?.transport ?? metadataStringValue(agentMetadata, "transport"),
      endpointSessionId: endpoint?.sessionId ?? null,
      metadata: {
        ...agentMetadata,
        ...endpointMetadata,
      },
    }),
    harnessLogPath: null,
    conversationId: conversationIdForAgent(agent.id),
    authorityNodeId: agent.authorityNodeId ?? null,
    authorityNodeName: brokerNodeName(broker, agent.authorityNodeId),
    homeNodeId: agent.homeNodeId ?? null,
    homeNodeName: brokerNodeName(broker, agent.homeNodeId),
    ownerId: agent.ownerId ?? null,
    ownerName: owner.name,
    ownerHandle: owner.handle,
    staleLocalRegistration: metadataBooleanValue(agentMetadata, "staleLocalRegistration"),
    retiredFromFleet: metadataBooleanValue(agentMetadata, "retiredFromFleet"),
    replacedByAgentId: metadataStringValue(agentMetadata, "replacedByAgentId"),
    providerName: provider.name,
    providerUrl: provider.url,
    protocol,
    skills,
  };
}

function brokerCardAgentsForWeb(broker: ScoutBrokerContext): WebAgent[] {
  return Object.values(broker.snapshot.agents ?? {})
    .map((agent) => brokerAgentCardToWebAgent(broker, agent))
    .filter((agent): agent is WebAgent => Boolean(agent))
    .sort((left, right) =>
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      || left.name.localeCompare(right.name),
    );
}

async function queryAgentsIncludingBrokerCards(): Promise<WebAgent[]> {
  const agents = queryAgents().map(withResolvedHarnessSessionIdentity);
  const broker = await loadScoutBrokerContext().catch(() => null);
  if (!broker) {
    return agents;
  }
  const existingIds = new Set(agents.map((agent) => agent.id));
  const brokerAgents = brokerCardAgentsForWeb(broker)
    .filter((agent) => !existingIds.has(agent.id))
    .map(withResolvedHarnessSessionIdentity);
  return [...agents, ...brokerAgents];
}

async function queryAgentIncludingBrokerCard(agentId: string): Promise<WebAgent | null> {
  const agent = queryAgentById(agentId);
  if (agent) {
    return withResolvedHarnessSessionIdentity(agent);
  }
  const broker = await loadScoutBrokerContext().catch(() => null);
  if (!broker) {
    return null;
  }
  const brokerAgent = Object.values(broker.snapshot.agents ?? {}).find(
    (candidate) => brokerAgentIdentityMatches(candidate, agentId),
  );
  const brokerWebAgent = brokerAgent ? brokerAgentCardToWebAgent(broker, brokerAgent) : null;
  return brokerWebAgent ? withResolvedHarnessSessionIdentity(brokerWebAgent) : null;
}

function withResolvedHarnessSessionIdentity(agent: WebAgent): WebAgent {
  if (agent.harness !== "claude") {
    return agent;
  }
  const cwd = agent.cwd ?? agent.projectRoot;
  const transcript = cwd ? mostRecentClaudeSessionForCwd(cwd) : null;
  if (!transcript?.sessionId) {
    return agent;
  }
  const sessionId = agent.harnessSessionId?.trim() ?? "";
  if (sessionId === transcript.sessionId) {
    return agent;
  }
  if (sessionId && !isTransportSessionRef(sessionId)) {
    return agent;
  }
  return {
    ...agent,
    harnessSessionId: transcript.sessionId,
    harnessLogPath: agent.harnessLogPath ?? transcript.transcriptPath,
  };
}

const TMUX_PEEK_DEFAULT_LINES = 44;
const TMUX_PEEK_MIN_LINES = 10;
const TMUX_PEEK_MAX_LINES = 80;
const TMUX_PEEK_DEFAULT_COLUMNS = 132;
const TMUX_PEEK_MIN_COLUMNS = 60;
const TMUX_PEEK_MAX_COLUMNS = 200;
const TMUX_PEEK_CAPTURE_MIN_LINES = 60;
const TMUX_PEEK_MAX_BYTES = 48 * 1024;

type TmuxPeekTarget = {
  sessionId: string;
  paneTarget: string;
  cwd: string | null;
};

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseTmuxPeekLineCount(value: string | undefined): number {
  return parseBoundedInteger(
    value,
    TMUX_PEEK_DEFAULT_LINES,
    TMUX_PEEK_MIN_LINES,
    TMUX_PEEK_MAX_LINES,
  );
}

function parseTmuxPeekColumnCount(value: string | undefined): number {
  return parseBoundedInteger(
    value,
    TMUX_PEEK_DEFAULT_COLUMNS,
    TMUX_PEEK_MIN_COLUMNS,
    TMUX_PEEK_MAX_COLUMNS,
  );
}

function stripTerminalControlSequences(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function normalizeTmuxPeekLine(line: string, columns: number): string {
  const chars = Array.from(line);
  const clipped = chars.length > columns ? chars.slice(0, columns).join("") : line;
  const clippedLength = Array.from(clipped).length;
  return `${clipped}${" ".repeat(Math.max(0, columns - clippedLength))}`;
}

function normalizeTmuxPeekBody(body: string, lines: number, columns: number): {
  body: string;
  lineCount: number;
  columnCount: number;
  truncated: boolean;
} {
  const cleaned = stripTerminalControlSequences(body)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const split = cleaned.endsWith("\n") ? cleaned.slice(0, -1).split("\n") : cleaned.split("\n");
  const sourceRows = split.length === 1 && split[0] === "" ? [] : split;
  const visible = sourceRows.length > lines ? sourceRows.slice(-lines) : sourceRows;
  const rows = [...visible];
  while (rows.length < lines) {
    rows.unshift("");
  }
  return {
    body: rows.map((line) => normalizeTmuxPeekLine(line, columns)).join("\n"),
    lineCount: rows.length,
    columnCount: columns,
    truncated: sourceRows.length > lines,
  };
}

function resolveTmuxPeekTarget(agent: ReturnType<typeof queryAgents>[number], endpoint: AgentEndpoint | null): TmuxPeekTarget | null {
  const endpointMetadata = agentEndpointMetadata(endpoint);
  const terminalSurface = agent.terminalSurface?.backend === "tmux"
    ? agent.terminalSurface
    : resolveTerminalSurface({
        transport: endpoint?.transport ?? agent.transport,
        endpointSessionId: endpoint?.sessionId ?? agent.harnessSessionId,
        metadata: endpointMetadata,
      });
  if (!terminalSurface || terminalSurface.backend !== "tmux") {
    return null;
  }
  const tmuxSession = terminalSurface.sessionName;
  const paneTarget = firstMetadataString(
    terminalSurface.paneId,
    endpoint?.pane,
    endpointMetadata.paneTarget,
    endpointMetadata.tmuxPane,
    tmuxSession,
  );

  if (!tmuxSession || !paneTarget) {
    return null;
  }

  return {
    sessionId: tmuxSession,
    paneTarget,
    cwd: endpoint?.cwd ?? endpoint?.projectRoot ?? agent.cwd ?? agent.projectRoot ?? null,
  };
}

function defaultCaptureTmuxPane(request: TmuxPanePeekRequest): TmuxPanePeekCapture | null {
  try {
    const body = execFileSync("tmux", [
      "capture-pane",
      "-p",
      "-J",
      "-t",
      request.paneTarget,
      "-S",
      `-${Math.max(request.lines, TMUX_PEEK_CAPTURE_MIN_LINES)}`,
      "-E",
      "-",
    ], {
      encoding: "utf8",
      maxBuffer: TMUX_PEEK_MAX_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_500,
    });
    return { body };
  } catch {
    return null;
  }
}

function parseScoutSpeechTimingRequest(value: unknown): ScoutSpeechTimingRequest | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = recordInput(value);
  if (!record) {
    return null;
  }
  if (record.enabled !== true) {
    return undefined;
  }
  const rawCues = record.cues;
  if (rawCues !== undefined && !Array.isArray(rawCues)) {
    return null;
  }
  const cues = rawCues?.map((rawCue) => {
    const cue = recordInput(rawCue);
    if (!cue) {
      return null;
    }
    const id = optionalString(cue.id)?.trim();
    if (!id) {
      return null;
    }
    const text = optionalString(cue.text);
    if (text !== undefined) {
      return { id, text };
    }
    const textStart = optionalFiniteNumber(cue.textStart);
    const textEnd = optionalFiniteNumber(cue.textEnd);
    if (textStart === undefined || textEnd === undefined || textEnd < textStart) {
      return null;
    }
    return { id, textStart, textEnd };
  });
  if (cues?.some((cue) => cue === null)) {
    return null;
  }
  const modelId = optionalString(record.modelId)?.trim();
  return {
    enabled: true,
    ...(modelId ? { modelId } : {}),
    ...(typeof record.strict === "boolean" ? { strict: record.strict } : {}),
    ...(cues ? { cues: cues as NonNullable<ScoutSpeechTimingRequest["cues"]> } : {}),
  };
}

function parseScoutVoiceAudioFormat(value: string | undefined): "mp3" | "wav" | "aac" | "opus" | "pcm16" | null | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  switch (normalized) {
    case "mp3":
    case "wav":
    case "aac":
    case "opus":
    case "pcm16":
      return normalized;
    default:
      return null;
  }
}

function inferDirectTargetAgentId(
  conversationId: string | undefined,
  session: {
    kind: string;
    agentId: string | null;
    participantIds: string[];
  } | null,
  senderId: string,
): string | null {
  if (session?.kind === "direct") {
    const operatorCandidates = new Set([
      senderId.trim(),
      "operator",
      process.env.OPENSCOUT_OPERATOR_NAME?.trim(),
      ...configuredOperatorActorIds(),
    ].filter((candidate): candidate is string => Boolean(candidate)));
    if (session.agentId) {
      const participants = session.participantIds.filter(
        (participantId) => participantId.trim().length > 0,
      );
      if (
        participants.length === 0 ||
        participants.some((participantId) => operatorCandidates.has(participantId))
      ) {
        return session.agentId;
      }
      return null;
    }

    const participants = session.participantIds.filter(
      (participantId) => participantId.trim().length > 0,
    );
    if (participants.length === 2) {
      if (!participants.some((participantId) => operatorCandidates.has(participantId))) {
        return null;
      }
      const nonOperatorParticipants = participants.filter(
        (participantId) => !operatorCandidates.has(participantId),
      );
      if (nonOperatorParticipants.length === 1) {
        return nonOperatorParticipants[0] ?? null;
      }

      const localSessionParticipant =
        nonOperatorParticipants.find((participantId) =>
          participantId.startsWith("local-session-agent-"),
        ) ??
        participants.find((participantId) =>
          participantId.startsWith("local-session-agent-"),
        );
      if (localSessionParticipant) {
        return localSessionParticipant;
      }

      return participants[0] ?? null;
    }
  }

  const parsedDirectConversation = !session && conversationId
    ? parseDirectConversationId(conversationId)
    : null;
  if (parsedDirectConversation) {
    return parsedDirectConversation.agentId || null;
  }

  return null;
}

function inferDirectSenderId(
  _session: { kind: string; participantIds: string[] } | null,
  _fallbackSenderId: string,
  _directTargetAgentId: string | null,
): string {
  // Web-originated sends must use the canonical operator actor id so direct
  // chats stay on one deterministic thread id.
  return "operator";
}

function channelNameFromConversationId(conversationId: string | undefined): string | null {
  if (!conversationId?.startsWith("channel.")) {
    return null;
  }
  const channel = conversationId.slice("channel.".length).trim();
  return channel || null;
}

function inferChannelName(
  conversationId: string | undefined,
  session: { kind: string } | null,
): string | null {
  if (session?.kind === "channel" || session?.kind === "system") {
    return channelNameFromConversationId(conversationId);
  }

  // Let direct channel URLs create or post to a channel even before the session
  // projection has caught up.
  return channelNameFromConversationId(conversationId);
}

function resolveConversationRouting(conversationId: string | undefined): {
  directAgentId: string | null;
  channel: string | null;
  conversationId: string | null;
  senderId: string;
} {
  const fallbackSenderId = "operator";
  const session = conversationId ? querySessionById(conversationId) : null;
  const directAgentId = inferDirectTargetAgentId(
    conversationId,
    session,
    fallbackSenderId,
  );
  const senderId = inferDirectSenderId(
    session,
    fallbackSenderId,
    directAgentId,
  );
  const channel = directAgentId
    ? null
    : inferChannelName(conversationId, session);
  const existingConversationId = session && !directAgentId && !channel
    ? conversationId ?? null
    : null;
  return { directAgentId, channel, conversationId: existingConversationId, senderId };
}

function conversationKindAfterMemberMutation(
  kind: ConversationDefinition["kind"],
  participantIds: string[],
): ConversationDefinition["kind"] {
  if (kind === "direct" && participantIds.length > 2) {
    return "group_direct";
  }
  if (kind === "group_direct" && participantIds.length <= 2) {
    return "direct";
  }
  return kind;
}

function buildAgentSessionCatalogPayload(input: {
  agentId: string;
  harness: string | null;
  cwd: string;
  transport?: string | null;
  terminalSurface?: WebAgent["terminalSurface"];
  activeSessionId?: string | null;
  model?: string | null;
  startedAt?: number | null;
  endpoint?: AgentEndpoint | null;
}) {
  const runtimeDir = relayAgentRuntimeDirectory(input.agentId);
  const catalog = readSessionCatalogSync(runtimeDir);
  const catalogActiveSession = catalog.activeSessionId
    ? catalog.sessions.find((session) => session.id === catalog.activeSessionId) ?? null
    : null;
  const endpointMetadata = agentEndpointMetadata(input.endpoint);
  const endpointSessionId = firstMetadataString(
    input.activeSessionId,
    input.endpoint?.sessionId,
    endpointMetadata.externalSessionId,
    endpointMetadata.threadId,
  );
  const observedHarnessSession = input.harness === "claude"
    ? mostRecentClaudeSessionForCwd(input.cwd)
    : null;
  const harnessNativeSessionId = firstMetadataString(
    endpointMetadata.externalSessionId,
    endpointMetadata.threadId,
    observedHarnessSession?.sessionId,
  );
  const terminalSurface = input.terminalSurface ?? resolveTerminalSurface({
    transport: input.transport,
    endpointSessionId: input.activeSessionId,
    metadata: endpointMetadata,
  });
  const fallbackTerminalSessionId = terminalSurface
    ? input.activeSessionId ?? terminalSurface.sessionName
    : null;
  const catalogActiveMatchesProfile = Boolean(
    catalogActiveSession
    && (!input.harness || !catalogActiveSession.harness || catalogActiveSession.harness === input.harness)
    && (!input.transport || !catalogActiveSession.transport || catalogActiveSession.transport === input.transport),
  );
  const sessionId = catalogActiveMatchesProfile
    ? harnessNativeSessionId ?? catalog.activeSessionId
    : harnessNativeSessionId ?? endpointSessionId ?? fallbackTerminalSessionId ?? catalog.activeSessionId;
  const harnessEntry = findHarnessEntry(input.harness);
  const resumeCommand = sessionId && harnessEntry && input.transport !== "tmux"
    ? buildHarnessResumeCommand(harnessEntry, sessionId, input.cwd)
    : null;
  const canResumeIntoTerminal = input.transport === "codex_exec";
  const historyPath = firstMetadataString(
    endpointMetadata.threadPath,
    endpointMetadata.resumeSessionPath,
    endpointMetadata.historyPath,
  );
  const sessionHistoryPath = historyPath ?? observedHarnessSession?.transcriptPath ?? null;
  const provider = firstMetadataString(endpointMetadata.provider);
  const source = firstMetadataString(endpointMetadata.source) ?? "broker-endpoint";
  const startedAt = metadataTimestampMs(endpointMetadata.lastStartedAt)
    ?? metadataTimestampMs(endpointMetadata.startedAt)
    ?? input.startedAt
    ?? Date.now();
  const sessions = sessionId && !catalog.sessions.some((session) => session.id === sessionId)
    ? [
        {
          id: sessionId,
          startedAt,
          cwd: input.cwd,
          ...(input.harness ? { harness: input.harness } : {}),
          ...(input.transport ? { transport: input.transport } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(provider ? { provider } : {}),
          ...(sessionHistoryPath ? { historyPath: sessionHistoryPath } : {}),
          ...(terminalSurface?.sessionName && terminalSurface.sessionName !== sessionId
            ? { surfaceSessionId: terminalSurface.sessionName }
            : {}),
          source,
          canObserve: Boolean(sessionHistoryPath) || Boolean(terminalSurface),
          // Terminal surfaces are taken over by grabbing the live pane (no
          // resume command needed). For broker protocol endpoints, a resume
          // command can still be useful copy, but it is not a live takeover.
          canTakeover: Boolean(terminalSurface) || Boolean(resumeCommand && canResumeIntoTerminal),
        },
        ...catalog.sessions,
      ]
    : catalog.sessions;
  return {
    ...catalog,
    activeSessionId: sessionId,
    sessions,
    agentId: input.agentId,
    harness: input.harness,
    resumeCommand,
    resumeCwd: input.cwd,
  };
}

function emptyAgentSessionCatalogPayload(agentId: string) {
  return {
    activeSessionId: null,
    sessions: [],
    agentId,
    harness: null,
    resumeCommand: null,
    resumeCwd: null,
  };
}

function resolveBundledStaticClientRoot(
  moduleUrl: string | URL = import.meta.url,
): string {
  return resolve(dirname(fileURLToPath(moduleUrl.toString())), "client");
}

function normalizeRequestHost(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .split(":")[0]
    ?.replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase() ?? "";
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

function resolveExplorablePath(
  targetPath: string,
  basePath: string | null | undefined,
  currentDirectory: string,
): string {
  const expandedTarget = expandHomePath(targetPath.trim());
  const expandedBase = basePath?.trim()
    ? expandHomePath(basePath.trim())
    : currentDirectory;
  return resolve(expandedBase, expandedTarget);
}

function realpathIfExists(targetPath: string): string | null {
  try {
    return realpathSync(targetPath);
  } catch {
    return null;
  }
}

function resolveObservedPath(
  targetPath: string,
  cwd: string | null | undefined,
): string | null {
  const expanded = expandHomePath(targetPath.trim());
  if (!expanded) {
    return null;
  }
  if (isAbsolute(expanded)) {
    return resolve(expanded);
  }
  if (!cwd?.trim()) {
    return null;
  }
  return resolve(expandHomePath(cwd.trim()), expanded);
}

async function loadRevealObservePayload(input: {
  agentId?: string | null;
  sessionId?: string | null;
}) {
  const agentId = input.agentId?.trim() || null;
  const sessionId = input.sessionId?.trim() || null;
  if (agentId) {
    const activePayload = await loadAgentObservePayload(agentId);
    if (activePayload && (!sessionId || activePayload.sessionId === sessionId)) {
      return activePayload;
    }
  }

  if (sessionId) {
    const refPayload = await loadSessionRefObservePayload(sessionId);
    if (refPayload && (!agentId || refPayload.agentId === null || refPayload.agentId === agentId)) {
      return refPayload;
    }
  }

  return null;
}

function observedRevealPathSet(payload: Awaited<ReturnType<typeof loadRevealObservePayload>>): Set<string> {
  const allowed = new Set<string>();
  const session = payload?.data.metadata?.session;
  const cwd = session?.cwd ?? null;
  const candidates = [
    payload?.historyPath,
    cwd,
    session?.threadPath,
    ...(payload?.data.files.map((file) => file.path) ?? []),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const resolved = resolveObservedPath(candidate, cwd);
    const real = resolved ? realpathIfExists(resolved) : null;
    if (real) {
      allowed.add(real);
    }
  }

  return allowed;
}

type LoadedObservePayload = NonNullable<Awaited<ReturnType<typeof loadRevealObservePayload>>>;

function observedWorktreePath(payload: LoadedObservePayload): string | null {
  const sessionCwd = payload.data.metadata?.session?.cwd?.trim();
  if (sessionCwd) {
    return resolve(expandHomePath(sessionCwd));
  }
  if (payload.agentId) {
    const agent = queryAgentById(payload.agentId);
    const agentPath = agent?.cwd?.trim() || agent?.projectRoot?.trim();
    if (agentPath) {
      return resolve(expandHomePath(agentPath));
    }
  }
  return null;
}

function sessionDiffInclude(value: string | undefined): "changed" | "all" {
  return value === "all" || value === "touched" ? "all" : "changed";
}

function sessionDiffTouchedPaths(payload: LoadedObservePayload, include: "changed" | "all"): string[] {
  return payload.data.files
    .filter((file) => include === "all" || file.state !== "read")
    .map((file) => file.path);
}

function sessionTouchedResponse(payload: LoadedObservePayload, refId: string | null) {
  const worktreePath = observedWorktreePath(payload);
  const changedFiles = payload.data.files.filter((file) => file.state !== "read").length;
  return {
    schema: "openscout.session.touched/v1",
    refId,
    agentId: payload.agentId,
    sessionId: payload.sessionId,
    source: payload.source,
    fidelity: payload.fidelity,
    historyPath: payload.historyPath,
    worktreePath,
    counts: {
      files: payload.data.files.length,
      changedFiles,
      readFiles: payload.data.files.length - changedFiles,
    },
    files: payload.data.files,
  };
}

function defaultRevealLocalPath(targetPath: string): void {
  if (!existsSync(targetPath)) {
    throw new Error("Path does not exist.");
  }

  const stats = statSync(targetPath);
  const directory = stats.isDirectory() ? targetPath : dirname(targetPath);
  if (process.platform === "darwin") {
    execFileSync("open", stats.isDirectory() ? [targetPath] : ["-R", targetPath], {
      stdio: "ignore",
      timeout: 1500,
    });
    return;
  }
  if (process.platform === "win32") {
    execFileSync("explorer.exe", stats.isDirectory() ? [targetPath] : [`/select,${targetPath}`], {
      stdio: "ignore",
      timeout: 1500,
    });
    return;
  }

  execFileSync("xdg-open", [directory], {
    stdio: "ignore",
    timeout: 1500,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function severityRank(severity: OperatorAttentionItem["severity"]): number {
  switch (severity) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    default:
      return 2;
  }
}

function compactAttentionSummary(value: string | null | undefined, max = 220): string | null {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compacted) {
    return null;
  }
  return compacted.length > max ? `${compacted.slice(0, max - 1)}...` : compacted;
}

function compactScoutbotText(value: string | null | undefined, max = 280): string | null {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compacted) {
    return null;
  }
  return compacted.length > max ? `${compacted.slice(0, max - 1)}...` : compacted;
}

function buildScoutEntityId(prefix: string, createdAtMs: number): string {
  return `${prefix}-${createdAtMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dismissCollaborationAction(recordKind: CollaborationKind, recordId: string): OperatorAttentionItem["actions"][number] {
  return {
    kind: "dismiss",
    label: "Dismiss",
    recordKind,
    recordId,
  };
}

async function dismissCollaborationAttention(input: {
  recordKind: CollaborationKind;
  recordId: string;
  itemUpdatedAt: number;
}): Promise<void> {
  const at = Date.now();
  const event: CollaborationEvent = {
    id: buildScoutEntityId("evt", at),
    recordId: input.recordId,
    recordKind: input.recordKind,
    kind: "dismissed",
    actorId: "operator",
    at,
    summary: "Dismissed from operator queue.",
    metadata: {
      source: "openscout-web",
      itemUpdatedAt: input.itemUpdatedAt,
    },
  };
  await appendScoutCollaborationEvent(event);
}

async function dismissFlightAttention(input: {
  flightId: string;
  itemUpdatedAt: number;
}): Promise<void> {
  const flight = queryFlightRecordById(input.flightId);
  if (!flight) {
    throw new Error("flight not found");
  }
  await upsertScoutFlight({
    ...flight,
    metadata: {
      ...(flight.metadata ?? {}),
      operatorAttentionDismissedAt: Date.now(),
      operatorAttentionItemUpdatedAt: input.itemUpdatedAt,
      operatorAttentionDismissedBy: "operator",
    },
  });
}

function readWebPackageVersion(): string | null {
  try {
    const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

function runGitValue(currentDirectory: string, args: string[]): string | null {
  try {
    const value = execFileSync("git", ["-C", currentDirectory, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function loadOpenScoutBuildInfo(currentDirectory: string): OpenScoutBuildInfo {
  const branch = runGitValue(currentDirectory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = runGitValue(currentDirectory, ["rev-parse", "--short", "HEAD"]);
  const dirtyStatus = runGitValue(currentDirectory, ["status", "--porcelain"]);
  return {
    version: readWebPackageVersion(),
    branch,
    commit,
    dirty: dirtyStatus === null ? null : dirtyStatus.length > 0,
    mode: process.env.NODE_ENV === "production" ? "production" : "dev",
  };
}

function repoPullRequestRoot(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const candidate = resolve(trimmed);
  try {
    if (!statSync(candidate).isDirectory()) return null;
  } catch {
    return null;
  }
  return runGitValue(candidate, ["rev-parse", "--show-toplevel"]) ?? candidate;
}

function normalizeRepoPullRequestPaths(rawPaths: readonly string[], fallbackPath: string): string[] {
  const sourcePaths = rawPaths.length > 0 ? rawPaths : [fallbackPath];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const rawPath of sourcePaths) {
    const root = repoPullRequestRoot(rawPath);
    if (!root) continue;
    const key = realpathSync(root);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(root);
    if (roots.length >= REPO_PRS_MAX_PATHS) break;
  }
  return roots;
}

function repoNameFromGitRemote(remote: string | null, fallbackPath: string): string {
  if (remote) {
    const ssh = /^git@[^:]+:([^/]+\/.+?)(?:\.git)?$/.exec(remote);
    if (ssh) return ssh[1];
    try {
      const url = new URL(remote);
      const path = url.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
      if (path.includes("/")) return path;
    } catch {
      const local = remote.replace(/\.git$/, "");
      if (local.includes("/")) return local.split("/").slice(-2).join("/");
    }
  }
  return basename(fallbackPath);
}

function parseGhPullRequests(stdout: string, repo: string, path: string): RepoPullRequestItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: RepoPullRequestItem[] = [];
  for (const raw of parsed as GhPullRequest[]) {
    if (
      typeof raw.number !== "number" ||
      typeof raw.title !== "string" ||
      typeof raw.url !== "string"
    ) {
      continue;
    }
    items.push({
      id: `${repo}#${raw.number}`,
      repo,
      path,
      number: raw.number,
      title: raw.title,
      url: raw.url,
      state: typeof raw.state === "string" ? raw.state : "OPEN",
      isDraft: Boolean(raw.isDraft),
      headRefName: typeof raw.headRefName === "string" ? raw.headRefName : "",
      baseRefName: typeof raw.baseRefName === "string" ? raw.baseRefName : "",
      author: typeof raw.author?.login === "string" ? raw.author.login : null,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    });
  }
  return items;
}

async function loadRepoPullRequests(options: RepoPullRequestLoadOptions): Promise<RepoPullRequestSnapshot> {
  const paths = options.paths.slice(0, REPO_PRS_MAX_PATHS);
  const limit = Math.max(1, Math.min(50, options.limitPerRepo || REPO_PRS_DEFAULT_LIMIT));
  const results = await Promise.all(paths.map(async (path) => {
    const remote = runGitValue(path, ["remote", "get-url", "origin"]);
    const repo = repoNameFromGitRemote(remote, path);
    try {
      const result = await execFileAsync("gh", [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        String(limit),
        "--json",
        "number,title,url,state,isDraft,headRefName,baseRefName,author,updatedAt",
      ], {
        cwd: path,
        encoding: "utf8",
        timeout: 2_500,
        maxBuffer: 512 * 1024,
      });
      return {
        pullRequests: parseGhPullRequests(result.stdout, repo, path),
        warning: null,
      };
    } catch {
      return {
        pullRequests: [],
        warning: `${repo}: open PRs unavailable`,
      };
    }
  }));

  const pullRequests = results.flatMap((result) => result.pullRequests);
  const warnings = results
    .map((result) => result.warning)
    .filter((warning): warning is string => Boolean(warning));

  return {
    generatedAt: Date.now(),
    source: "gh",
    paths,
    pullRequests: pullRequests.sort((left, right) => {
      const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      return rightTime - leftTime || left.repo.localeCompare(right.repo) || right.number - left.number;
    }),
    warnings,
  };
}

function operatorAttentionFromUnblockRequest(
  request: UnblockRequestRecord,
): OperatorAttentionItem {
  const actions = (request.actions ?? [])
    .filter((action) => action.kind !== "approve" && action.kind !== "deny")
    .map((action): OperatorAttentionItem["actions"][number] => ({
      kind: action.kind === "answer" || action.kind === "snooze" ? "open" : action.kind,
      label: action.label,
      route: typeof action.route?.view === "string"
        ? action.route as OperatorAttentionItem["actions"][number]["route"]
        : undefined,
      value: action.value,
      unblockRequestId: request.id,
    }));
  if (!actions.some((action) => action.kind === "dismiss")) {
    actions.push({ kind: "dismiss", label: "Dismiss", unblockRequestId: request.id });
  }

  return {
    id: request.id,
    kind: request.kind === "permission" ? "approval" : request.kind === "flight" ? "ask" : request.kind,
    title: request.title,
    summary: request.summary ?? null,
    detail: request.detail ?? null,
    agentId: request.agentId ?? null,
    agentName: null,
    conversationId: request.conversationId ?? null,
    updatedAt: request.updatedAt,
    severity: request.severity ?? "warning",
    sourceLabel: request.sourceLabel ?? request.source,
    unblockRequest: request,
    actions,
  };
}

async function markUnblockRequestTerminal(input: {
  requestId: string;
  state: Extract<UnblockRequestRecord["state"], "resolved" | "dismissed" | "denied" | "expired">;
  actorId?: string;
  summary?: string;
  resolution?: string;
}): Promise<void> {
  const requests = await readScoutUnblockRequests({ limit: 500 });
  const current = requests.find((request) => request.id === input.requestId);
  if (!current) {
    return;
  }
  const at = Date.now();
  const next: UnblockRequestRecord = {
    ...current,
    state: input.state,
    updatedAt: at,
    resolvedAt: current.resolvedAt ?? at,
    resolution: input.resolution ?? current.resolution,
    actions: undefined,
  };
  const event: UnblockRequestEvent = {
    id: buildScoutEntityId("evt", at),
    requestId: current.id,
    kind: input.state,
    actorId: input.actorId ?? "operator",
    at,
    summary: input.summary,
    metadata: {
      previousState: current.state,
    },
  };
  await upsertScoutUnblockRequest(next);
  await appendScoutUnblockRequestEvent(event);
}

function permissionSetupHint(detail: string): OperatorAttentionItem | null {
  const normalized = detail.toLowerCase();
  const mentionsPermission = /permission|approval|allow|blocked/.test(normalized);
  const mentionsScoutMcpReply =
    /\bmcp__?scout__messages_reply\b/.test(normalized) ||
    /\bmcp\b.*\bmessages_reply\b/.test(normalized);
  const mentionsScoutMcpAsk =
    /\bmcp__?scout__ask\b/.test(normalized) ||
    /\bmcp\b.*\bscout ask\b/.test(normalized);
  const mentionsScoutMcpTool = mentionsScoutMcpReply || mentionsScoutMcpAsk;
  const mentionsScoutTool = /scout ask|allowedtools|allowlist/.test(normalized) || mentionsScoutMcpTool;
  if (!mentionsPermission || !mentionsScoutTool) {
    return null;
  }

  const replyTool = mentionsScoutMcpReply;
  const command = mentionsScoutMcpTool
    ? `/allow ${replyTool ? "mcp__scout__messages_reply" : "mcp__scout__ask"}`
    : `{ "allowedTools": ["Bash(scout:*)"] }`;
  const title = mentionsScoutMcpTool
    ? "Claude needs Scout MCP permission"
    : "Claude needs Scout CLI permission";
  const remediationDetail = mentionsScoutMcpTool
    ? "This is a Claude-session permission. Copy the /allow line, paste it into the blocked Claude session, then retry the Scout request."
    : "This is a Claude-session permission. Copy the allowed-tools snippet into the blocked Claude session or project settings, then retry the Scout request.";

  return {
    id: `config:${mentionsScoutMcpTool ? `mcp-scout-${replyTool ? "messages-reply" : "ask"}` : "scout-ask-cli"}`,
    kind: "configuration",
    title,
    summary: compactAttentionSummary(detail),
    detail: remediationDetail,
    agentId: null,
    agentName: null,
    conversationId: null,
    updatedAt: Date.now(),
    severity: "critical",
    sourceLabel: "Claude permissions",
    actions: [
      {
        kind: "copy",
        label: "Copy Claude fix",
        value: command,
      },
    ],
  };
}

function dedupeAttentionItems(items: OperatorAttentionItem[]): OperatorAttentionItem[] {
  const byId = new Map<string, OperatorAttentionItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const bySeverity = severityRank(left.severity) - severityRank(right.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    return right.updatedAt - left.updatedAt;
  });
}

function operatorAttentionFromSessionItem(item: SessionAttentionItem): OperatorAttentionItem {
  const route = {
    view: "follow",
    sessionId: item.sessionId,
    preferredView: "session",
  };
  const approvalActions = item.kind === "approval" && item.approval
    ? [
        { kind: "approve" as const, label: "Approve" },
        { kind: "deny" as const, label: "Deny" },
      ]
    : [];
  const openAction = {
    kind: "open" as const,
    label: "Open session",
    route,
  };

  return {
    id: item.id,
    kind: item.kind === "approval"
      ? "approval"
      : item.kind === "question"
        ? "question"
        : "session",
    title: item.title,
    summary: item.summary,
    detail: item.detail,
    agentId: null,
    agentName: item.sessionName,
    conversationId: null,
    updatedAt: item.updatedAt,
    severity: item.severity,
    sourceLabel: item.sourceLabel,
    ...(item.approval ? { approval: item.approval } : {}),
    actions: [
      ...approvalActions,
      openAction,
    ],
  };
}

async function buildOperatorAttentionState(currentDirectory: string) {
  const [pairing, pairingSnapshots, fleet, broker] = await Promise.all([
    loadPairingState(currentDirectory, false).catch(() => null),
    getScoutWebPairingSessionSnapshots().catch(() => []),
    Promise.resolve(queryFleet({ limit: 24, activityLimit: 120 })),
    Promise.resolve(queryBrokerDiagnostics({ limit: 160, windowMs: 24 * 60 * 60_000 })),
  ]);

  const items: OperatorAttentionItem[] = [];
  const pendingApprovalIds = new Set<string>();
  const activeUnblockRequests = await readScoutUnblockRequests({
    ownerId: "operator",
    active: true,
    limit: 200,
  }).catch(() => []);

  for (const approval of pairing?.pendingApprovals ?? []) {
    const approvalId = sessionApprovalAttentionId(
      approval.sessionId,
      approval.turnId,
      approval.blockId,
      approval.version,
    );
    pendingApprovalIds.add(approvalId);
    items.push({
      id: approvalId,
      kind: "approval",
      title: approval.title,
      summary: approval.description,
      detail: approval.detail,
      agentId: null,
      agentName: approval.sessionName,
      conversationId: null,
      updatedAt: Date.now(),
      severity: approval.risk === "high" ? "critical" : "warning",
      sourceLabel: `${approval.adapterType} approval`,
      approval,
      actions: [
        { kind: "approve", label: "Approve" },
        { kind: "deny", label: "Deny" },
        {
          kind: "open",
          label: "Open session",
          route: {
            view: "follow",
            sessionId: approval.sessionId,
            preferredView: "session",
          },
        },
      ],
    });
  }

  for (const sessionItem of projectSessionsAttention(pairingSnapshots, { pendingApprovalIds })) {
    items.push(operatorAttentionFromSessionItem(sessionItem));
  }

  for (const request of activeUnblockRequests) {
    items.push(operatorAttentionFromUnblockRequest(request as UnblockRequestRecord));
  }

  for (const work of fleet.needsAttention) {
    const route = work.kind === "work_item"
      ? { view: "work", workId: work.recordId }
      : work.conversationId
        ? { view: "conversation", conversationId: work.conversationId }
        : undefined;
    items.push({
      id: `${work.kind}:${work.recordId}`,
      kind: work.kind,
      title: work.title,
      summary: work.summary,
      detail: work.acceptanceState !== "none"
        ? work.acceptanceState.replace(/_/g, " ")
        : work.state.replace(/_/g, " "),
      agentId: work.agentId,
      agentName: work.agentName,
      conversationId: work.conversationId,
      updatedAt: work.updatedAt,
      severity: work.state === "waiting" || work.kind === "question" ? "warning" : "info",
      sourceLabel: work.kind === "question" ? "Question" : "Work item",
      actions: [
        ...(route ? [{ kind: "open" as const, label: work.kind === "question" ? "Answer" : "Open", route }] : []),
        dismissCollaborationAction(work.kind, work.recordId),
      ],
    });
  }

  for (const ask of fleet.recentCompleted.filter((item) => item.status === "failed" && item.attention !== "silent")) {
    const noteworthy = ask.attention === "badge";
    const noteworthyTitle = ask.statusLabel === "Stopped" ? "Ask stopped" : "Ask interrupted";
    items.push({
      id: `ask:${ask.invocationId}`,
      kind: "ask",
      title: noteworthy ? noteworthyTitle : "Ask failed",
      summary: compactAttentionSummary(ask.summary ?? ask.task),
      detail: ask.task,
      agentId: ask.agentId,
      agentName: ask.agentName,
      conversationId: ask.conversationId,
      updatedAt: ask.updatedAt,
      severity: noteworthy ? "warning" : "critical",
      sourceLabel: noteworthy ? "Ask notice" : "Ask delivery",
      actions: [
        ...(ask.conversationId
          ? [{ kind: "open" as const, label: "Open thread", route: { view: "conversation", conversationId: ask.conversationId } }]
          : [{ kind: "open" as const, label: "Open agent", route: { view: "agents", agentId: ask.agentId } }]),
        ...(ask.flightId ? [{ kind: "dismiss" as const, label: "Dismiss", flightId: ask.flightId }] : []),
      ],
    });
  }

  for (const failure of [...broker.failedDeliveries, ...broker.failedQueries]) {
    const hint = permissionSetupHint(failure.detail);
    if (!hint) {
      continue;
    }
    items.push({
      ...hint,
      id: `${hint.id}:${failure.id}`,
      agentName: failure.target,
      conversationId: failure.conversationId,
      updatedAt: failure.ts,
      actions: [
        ...hint.actions,
        ...(failure.conversationId
          ? [{
              kind: "open" as const,
              label: "Open thread",
              route: { view: "conversation", conversationId: failure.conversationId },
            }]
          : []),
      ],
    });
  }

  for (const message of broker.dialogue) {
    if (message.actorName !== "Openscout") {
      continue;
    }
    const hint = permissionSetupHint(message.body);
    if (!hint) {
      continue;
    }
    items.push({
      ...hint,
      id: `${hint.id}:${message.conversationId}`,
      agentName: message.actorName,
      conversationId: message.conversationId,
      updatedAt: message.ts,
      actions: [
        ...hint.actions,
        {
          kind: "open" as const,
          label: "Open thread",
          route: { view: "conversation", conversationId: message.conversationId },
        },
      ],
    });
  }

  const deduped = dedupeAttentionItems(items);
  return {
    generatedAt: Date.now(),
    totals: {
      all: deduped.length,
      approvals: deduped.filter((item) => item.kind === "approval").length,
      configuration: deduped.filter((item) => item.kind === "configuration").length,
      collaboration: deduped.filter((item) =>
        item.kind === "ask"
        || item.kind === "work_item"
        || item.kind === "question"
        || item.kind === "session"
      ).length,
    },
    items: deduped,
  };
}

async function buildScoutbotAssistantControlState(currentDirectory: string, route?: unknown) {
  const omittedActiveAgentId = isScoutbotAssistantRoute(route) ? "scoutbot" : null;
  const [attention, mesh, tailDiscovery] = await Promise.all([
    valueOrNull(buildOperatorAttentionState(currentDirectory)),
    valueOrNull(loadMeshStatus()),
    valueOrNull(getTailDiscovery()),
  ]);
  const broker = queryBrokerDiagnostics({ limit: 80, windowMs: 6 * 60 * 60_000 });
  const fleet = queryFleet({ limit: 16, activityLimit: 40 });
  const transcriptEvents = await valueOrNull(
    readRecentTranscriptEvents(50, {
      ...(tailDiscovery ? { discovery: tailDiscovery } : {}),
    }),
  );
  const agentLogEvents = transcriptEvents && transcriptEvents.length > 0
    ? transcriptEvents
    : snapshotRecentEvents(50).slice().reverse();
  const agentLogMessages = agentLogEvents
    .filter((event) => event.kind !== "system")
    .filter((event) => !event.summary.toLowerCase().startsWith("permission-mode"))
    .map(compactScoutbotTailEvent);
  const scoutChatter = queryRecentMessages(50).map(compactScoutbotMessage);
  const activeRuns = queryRuns({ active: true, limit: 24 })
    .filter((run) => run.agentId !== omittedActiveAgentId);
  const activeFlights = queryFlights({ activeOnly: true })
    .filter((flight) => flight.agentId !== omittedActiveAgentId)
    .slice(0, 24);

  return {
    build: loadOpenScoutBuildInfo(currentDirectory),
    agents: queryAgents(40)
      .filter((agent) => !isScoutbotLikeAgentRecord(agent))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        handle: agent.handle,
        state: agent.state,
        harness: agent.harness,
        transport: agent.transport,
        model: agent.model,
        project: agent.project,
        branch: agent.branch,
        cwd: agent.cwd,
        updatedAt: agent.updatedAt,
        conversationId: agent.conversationId,
      })),
    fleet: {
      generatedAt: fleet.generatedAt,
      totals: fleet.totals,
      activeAsks: fleet.activeAsks.slice(0, 12).map(compactScoutbotFleetAsk),
      needsAttention: fleet.needsAttention.slice(0, 12).map(compactScoutbotFleetAttention),
      recentCompleted: fleet.recentCompleted.slice(0, 8).map(compactScoutbotFleetAsk),
      activity: fleet.activity.slice(0, 12).map(compactScoutbotActivity),
    },
    operatorAttention: attention
      ? {
          generatedAt: attention.generatedAt,
          totals: attention.totals,
          items: attention.items.slice(0, 16),
        }
      : null,
    broker: {
      generatedAt: broker.generatedAt,
      windowMs: broker.windowMs,
      totals: broker.totals,
      rates: broker.rates,
      failedQueries: broker.failedQueries.slice(0, 8).map(compactScoutbotRouteAttempt),
      failedDeliveries: broker.failedDeliveries.slice(0, 8).map(compactScoutbotRouteAttempt),
      attempts: broker.attempts.slice(0, 12).map(compactScoutbotRouteAttempt),
      dialogue: broker.dialogue.slice(0, 12).map(compactScoutbotDialogue),
    },
    activeWork: queryWorkItems({ activeOnly: true, limit: 20 }).map(compactScoutbotWorkItem),
    activeRuns,
    activeFlights,
    sessions: querySessions(24),
    recentMessages: scoutChatter.slice(0, 16),
    recentActivity: queryActivity(16).map(compactScoutbotActivity),
    briefingEvidence: {
      agentLogMessages,
      scoutChatter,
    },
    heartrate: queryHeartrate(),
    mesh: mesh
      ? {
          brokerUrl: mesh.brokerUrl,
          identity: mesh.identity,
          meshId: mesh.meshId,
          localNode: mesh.localNode,
          issueCount: mesh.issues.length,
          issues: mesh.issues,
          warnings: mesh.warnings,
          tailscale: {
            available: mesh.tailscale.available,
            running: mesh.tailscale.running,
            backendState: mesh.tailscale.backendState,
            onlineCount: mesh.tailscale.onlineCount,
          },
        }
      : null,
    harnessActivity: tailDiscovery
      ? {
          generatedAt: tailDiscovery.generatedAt,
          totals: tailDiscovery.totals,
          processes: tailDiscovery.processes.slice(0, 24).map((p) => ({
            pid: p.pid,
            source: p.source,
            harness: p.harness,
            command: compactScoutbotText(p.command, 140),
            cwd: p.cwd,
            etime: p.etime,
          })),
          transcripts: tailDiscovery.transcripts.slice(0, 24).map((t) => ({
            source: t.source,
            harness: t.harness,
            sessionId: t.sessionId,
            project: t.project,
            cwd: t.cwd,
            transcriptPath: t.transcriptPath,
            mtimeMs: t.mtimeMs,
            size: t.size,
          })),
        }
      : null,
  };
}

function isScoutbotAssistantRoute(route: unknown): boolean {
  return Boolean(
    route
    && typeof route === "object"
    && (route as { surface?: unknown }).surface === "scoutbot",
  );
}

function compactScoutbotFleetAsk(ask: ReturnType<typeof queryFleet>["activeAsks"][number]) {
  return {
    invocationId: ask.invocationId,
    flightId: ask.flightId,
    agentId: ask.agentId,
    agentName: ask.agentName,
    conversationId: ask.conversationId,
    task: compactScoutbotText(ask.task, 260),
    status: ask.status,
    statusLabel: ask.statusLabel,
    attention: ask.attention,
    summary: compactScoutbotText(ask.summary, 260),
    startedAt: ask.startedAt,
    completedAt: ask.completedAt,
    updatedAt: ask.updatedAt,
  };
}

function compactScoutbotFleetAttention(item: ReturnType<typeof queryFleet>["needsAttention"][number]) {
  return {
    kind: item.kind,
    recordId: item.recordId,
    title: compactScoutbotText(item.title, 180),
    summary: compactScoutbotText(item.summary, 260),
    agentId: item.agentId,
    agentName: item.agentName,
    conversationId: item.conversationId,
    state: item.state,
    acceptanceState: item.acceptanceState,
    updatedAt: item.updatedAt,
  };
}

function compactScoutbotActivity(item: ReturnType<typeof queryActivity>[number]) {
  return {
    id: item.id,
    kind: item.kind,
    ts: item.ts,
    actorName: item.actorName,
    title: compactScoutbotText(item.title, 180),
    summary: compactScoutbotText(item.summary, 260),
    conversationId: item.conversationId,
    workspaceRoot: item.workspaceRoot,
  };
}

function compactScoutbotRouteAttempt(attempt: ReturnType<typeof queryBrokerDiagnostics>["attempts"][number]) {
  return {
    id: attempt.id,
    kind: attempt.kind,
    status: attempt.status,
    ts: attempt.ts,
    actorName: attempt.actorName,
    target: attempt.target,
    route: attempt.route,
    detail: compactScoutbotText(attempt.detail, 320),
    conversationId: attempt.conversationId,
    messageId: attempt.messageId,
    deliveryId: attempt.deliveryId,
    invocationId: attempt.invocationId,
  };
}

function compactScoutbotDialogue(item: ReturnType<typeof queryBrokerDiagnostics>["dialogue"][number]) {
  return {
    id: item.id,
    ts: item.ts,
    actorName: item.actorName,
    conversationId: item.conversationId,
    body: compactScoutbotText(item.body, 320),
    class: item.class,
  };
}

function compactScoutbotWorkItem(item: ReturnType<typeof queryWorkItems>[number]) {
  return {
    id: item.id,
    title: compactScoutbotText(item.title, 180),
    summary: compactScoutbotText(item.summary, 260),
    ownerId: item.ownerId,
    ownerName: item.ownerName,
    nextMoveOwnerId: item.nextMoveOwnerId,
    nextMoveOwnerName: item.nextMoveOwnerName,
    conversationId: item.conversationId,
    state: item.state,
    acceptanceState: item.acceptanceState,
    priority: item.priority,
    currentPhase: item.currentPhase,
    attention: item.attention,
    activeChildWorkCount: item.activeChildWorkCount,
    activeFlightCount: item.activeFlightCount,
    lastMeaningfulAt: item.lastMeaningfulAt,
    lastMeaningfulSummary: compactScoutbotText(item.lastMeaningfulSummary, 260),
  };
}

function compactScoutbotMessage(message: ReturnType<typeof queryRecentMessages>[number]) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    actorName: message.actorName,
    body: compactScoutbotText(message.body, 320),
    createdAt: message.createdAt,
    class: message.class,
  };
}

function compactScoutbotTailEvent(event: ReturnType<typeof snapshotRecentEvents>[number]) {
  return {
    id: event.id,
    ts: event.ts,
    source: event.source,
    sessionId: event.sessionId,
    project: event.project,
    cwd: event.cwd,
    harness: event.harness,
    kind: event.kind,
    summary: compactScoutbotText(event.summary, 360),
  };
}

async function valueOrNull<T>(value: Promise<T> | T): Promise<T | null> {
  try {
    return await value;
  } catch {
    return null;
  }
}

function isScoutbotLikeAgentRecord(agent: { id: string; name: string; handle: string | null; role: string | null }): boolean {
  return [agent.id, agent.name, agent.handle ?? "", agent.role ?? ""]
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === "scoutbot" || value.startsWith("scoutbot.") || value.includes(".scoutbot."));
}

function previewSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 10) {
    return "configured";
  }
  return `${trimmed.slice(0, 5)}...${trimmed.slice(-4)}`;
}

async function resolveScoutbotCredentialState(
  scoutbotCredentials: ReturnType<typeof createScoutbotCredentialStore>,
): Promise<{
  openai: {
    configured: boolean;
    source: "env" | "local-config" | "local-store" | "missing";
    preview: string | null;
  };
}> {
  const envKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const config = await loadScoutRelayConfig().catch(() => ({}));
  const configKey = typeof config.openaiApiKey === "string" ? config.openaiApiKey.trim() : "";
  const storeKey = scoutbotCredentials.getOpenAIKey()?.trim() ?? "";
  const key = envKey || configKey || storeKey;
  return {
    openai: {
      configured: Boolean(key),
      source: envKey ? "env" : configKey ? "local-config" : storeKey ? "local-store" : "missing",
      preview: key ? previewSecret(key) : null,
    },
  };
}

function createDefaultScoutbotCodexInvoker(currentDirectory: string): ScoutbotCodexAssistantInvoker {
  return async (input) => {
    const runtimeName = `scoutbot-assistant-${sanitizeSupportPathSegment(input.sessionId)}`;
    const result = await invokeCodexAppServerAgent({
      agentName: "scoutbot-assistant",
      sessionId: input.sessionId,
      cwd: currentDirectory,
      systemPrompt: input.systemPrompt,
      runtimeDirectory: relayAgentRuntimeDirectory(runtimeName),
      logsDirectory: relayAgentLogsDirectory(runtimeName),
      launchArgs: buildScoutbotAssistantCodexLaunchArgs(process.env),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      prompt: input.prompt,
      timeoutMs: input.timeoutMs,
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    return {
      output: result.output,
      threadId: result.threadId,
    };
  };
}

function buildScoutbotAssistantCodexLaunchArgs(env: NodeJS.ProcessEnv): string[] {
  const args: string[] = [];
  const model = env.OPENSCOUT_SCOUTBOT_CODEX_MODEL?.trim();
  const reasoningEffort = env.OPENSCOUT_SCOUTBOT_CODEX_REASONING_EFFORT?.trim()
    || SCOUTBOT_REASONING_EFFORT;
  if (model) args.push("--model", model);
  if (reasoningEffort) args.push("--reasoning-effort", reasoningEffort);
  return normalizeCodexAppServerLaunchArgs(args);
}

function sanitizeSupportPathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || "default";
}

function renderScoutLocalPortal(input: {
  requestUrl: string;
  portalHost: string;
  nodeHost: string;
}): string {
  const url = new URL(input.requestUrl);
  const port = url.port ? `:${url.port}` : "";
  const nodeUrl = `${url.protocol}//${input.nodeHost}${port}/`;
  const portalHost = escapeHtml(input.portalHost);
  const nodeHost = escapeHtml(input.nodeHost);
  const escapedNodeUrl = escapeHtml(nodeUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scout Local</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #080a07; color: #f5f1e8; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; }
      main { width: min(760px, 100%); }
      .eyebrow { color: #a6e15e; font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .12em; }
      h1 { margin: 14px 0 10px; font-size: clamp(34px, 7vw, 58px); line-height: .98; font-weight: 650; letter-spacing: 0; }
      p { max-width: 600px; margin: 0 0 28px; color: #aaa69b; line-height: 1.55; font-size: 16px; }
      .node { display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center; border: 1px solid #303729; color: #f5f1e8; text-decoration: none; padding: 18px 20px; background: #10130e; border-radius: 8px; }
      .node:hover { border-color: #a6e15e; background: #141810; }
      .node strong { display: block; font-size: 17px; font-weight: 620; letter-spacing: 0; }
      .node span { color: #aaa69b; font-size: 13px; }
      .open { color: #a6e15e; font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .08em; }
      @media (max-width: 520px) {
        body { padding: 22px; place-items: start center; }
        .node { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">${portalHost}</div>
      <h1>Scout local</h1>
      <p>Registered machines on this local Scout mesh. Open a node to inspect agents, sessions, activity, and settings.</p>
      <a class="node" href="${escapedNodeUrl}">
        <span>
          <strong>${nodeHost}</strong>
          <span>Local web node</span>
        </span>
        <span class="open">Open</span>
      </a>
    </main>
  </body>
</html>`;
}

function resolveSourceStaticClientRoot(
  moduleUrl: string | URL = import.meta.url,
): string {
  return resolve(dirname(fileURLToPath(moduleUrl.toString())), "../dist/client");
}

function resolveStaticRoot(staticRoot: string | undefined): string {
  const configured = staticRoot?.trim();
  if (configured) {
    return configured;
  }

  const bundled = resolveBundledStaticClientRoot(import.meta.url);
  if (existsSync(resolve(bundled, "index.html"))) {
    return bundled;
  }

  return resolveSourceStaticClientRoot(import.meta.url);
}

async function loadPairingState(
  currentDirectory: string,
  refresh: boolean,
): Promise<ScoutPairingState> {
  return refresh
    ? refreshScoutWebPairingState(currentDirectory)
    : getScoutWebPairingState(currentDirectory);
}

const BYOK_PROVIDER_CATALOG = [
  {
    id: "minimax",
    name: "MiniMax",
    protocol: "openai-compatible",
    baseUrl: "https://api.minimax.io/v1",
    docsUrl: "https://platform.minimax.io/docs/token-plan/other-tools",
    envKeys: ["MINIMAX_API_KEY"],
    note: "International OpenAI-compatible endpoint. China-region users may need the minimaxi.com base URL override later.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/docs/quickstart",
    envKeys: ["OPENROUTER_API_KEY"],
    note: "Routes many upstream providers behind one key; optional app attribution headers can be added when we wire requests.",
  },
  {
    id: "xai",
    name: "xAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    docsUrl: "https://docs.x.ai/developers/model-capabilities/legacy/chat-completions",
    envKeys: ["XAI_API_KEY"],
    note: "OpenAI SDK compatible chat completions surface for Grok models.",
  },
] as const;

function isProviderConfigured(envKeys: readonly string[]): boolean {
  return envKeys.some((key) => Boolean(process.env[key]?.trim()));
}

async function buildAgentConfigurationSnapshot(currentDirectory: string) {
  const [settingsResult, setupResult, catalogResult, shellResult] = await Promise.allSettled([
    readOpenScoutSettings({ currentDirectory }),
    loadResolvedRelayAgents({ currentDirectory }),
    loadHarnessCatalogSnapshot(),
    loadOpenScoutWebShellState(),
  ]);
  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : null;
  const setup = setupResult.status === "fulfilled" ? setupResult.value : null;
  const catalog = catalogResult.status === "fulfilled" ? catalogResult.value : null;
  const shell = shellResult.status === "fulfilled" ? shellResult.value.runtime : null;
  const agents = queryAgents(200);

  return {
    generatedAt: Date.now(),
    context: {
      currentDirectory,
      workspaceRoots: settings?.discovery.workspaceRoots ?? [],
      hiddenProjectCount: settings?.discovery.hiddenProjectRoots.length ?? 0,
      defaultHarness: settings?.agents.defaultHarness ?? "claude",
      defaultTransport: settings?.agents.defaultTransport ?? "tmux",
      defaultCapabilities: settings?.agents.defaultCapabilities ?? [],
      sessionPrefix: settings?.agents.sessionPrefix ?? "relay",
    },
    broker: {
      label: shell?.brokerLabel ?? "Unavailable",
      reachable: shell?.brokerReachable ?? false,
      healthy: shell?.brokerHealthy ?? false,
      nodeId: shell?.nodeId ?? null,
      agentCount: shell?.agentCount ?? agents.length,
      messageCount: shell?.messageCount ?? 0,
      error: shell?.error ?? null,
    },
    runtimes: (catalog?.entries ?? []).map((entry) => ({
      id: entry.name,
      label: entry.label,
      description: entry.description,
      state: entry.readinessReport.state,
      detail: entry.readinessReport.detail,
      binaryPath: entry.readinessReport.binaryPath,
      loginCommand: entry.readinessReport.loginCommand,
      capabilities: entry.capabilities,
      source: entry.source,
    })),
    providers: BYOK_PROVIDER_CATALOG.map((provider) => ({
      ...provider,
      status: isProviderConfigured(provider.envKeys) ? "configured" as const : "missing" as const,
      envKeys: [...provider.envKeys],
    })),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      source: "broker" as const,
      status: agent.state ?? "offline",
      harness: agent.harness,
      transport: agent.transport,
      model: agent.model,
      projectRoot: agent.projectRoot,
      cwd: agent.cwd,
      capabilities: agent.capabilities,
      conversationId: agent.conversationId,
    })),
    projects: (setup?.projectInventory ?? []).slice(0, 120).map((project) => ({
      id: project.agentId,
      title: project.displayName,
      root: project.projectRoot,
      source: project.source,
      registrationKind: project.registrationKind,
      defaultHarness: project.defaultHarness,
      projectConfigPath: project.projectConfigPath,
    })),
    integrations: [
      {
        id: "telegram",
        name: "Telegram",
        status: settings?.bridges.telegram.enabled ? "enabled" as const : "disabled" as const,
        detail: settings?.bridges.telegram.enabled
          ? `Mode ${settings.bridges.telegram.mode}; conversation ${settings.bridges.telegram.defaultConversationId}`
          : "Bridge configured in settings but currently disabled.",
        source: "bridge" as const,
      },
    ],
    toolContext: {
      mcpServerCount: 0,
      note: "MCP/tool context is not yet exposed as a first-class web catalog. Current controls live on individual agent launch args, capabilities, and harness defaults.",
    },
    gaps: [
      "First-class MCP server registry and per-agent tool loadouts",
      "Secret storage and write flows for provider credentials",
      "Broker-owned durable unblock records for all human-needed states",
      "External runtime API-server harness and session adapter",
    ],
  };
}

async function readLocalHarnessTopologySnapshot() {
  try {
    const { HarnessTopologyObserver } = await import("@openscout/runtime/harness-topology");
    const observer = new HarnessTopologyObserver({
      cwd: process.env.OPENSCOUT_SETUP_CWD || process.cwd(),
    });
    return await observer.getSnapshot(true);
  } catch {
    return null;
  }
}

export async function createOpenScoutWebServer(
  options: CreateOpenScoutWebServerOptions,
): Promise<OpenScoutWebServer> {
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const currentDirectory = options.currentDirectory;

  // Approval-gated LAN pairing: a phone tapping an idle Mac registers a request
  // here; the Mac approves it before pair mode starts and the payload is served.
  const pendingPairRequests = createPendingPairRequestStore();
  // Always-on discovery beacon so idle Macs still appear in the iOS "On your
  // network" list. Stands down while pair mode runs (the controller advertises).
  const lanPairBeacon = startScoutPairLanBeacon(async () => {
    try {
      return (await loadPairingState(currentDirectory, false)).isRunning;
    } catch {
      return false;
    }
  });
  const routes = resolveOpenScoutWebRoutes(process.env);
  ensureScoutVoiceOrigins();
  startGlobalHeuristicsWatcher();
  const app = new Hono();
  installHttpsEdgeSecurityHeaders(app, options.publicOrigin);
  const shellStateCache = createCachedSnapshot<OpenScoutWebShellState>(
    loadOpenScoutWebShellState,
    shellTtl,
  );
  const scoutbotReminders = createScoutbotReminderStore();
  const scoutbotCredentials = createScoutbotCredentialStore();
  const scoutbotAssistant = createScoutbotAssistantService({
    currentDirectory,
    loadContext: async (route) => ({
      ...(await buildScoutbotAssistantControlState(currentDirectory, route)),
      reminders: scoutbotReminders.getState(),
    }),
    resolveApiKey: async () => {
      const config = await loadScoutRelayConfig().catch(() => null);
      return config?.openaiApiKey ?? scoutbotCredentials.getOpenAIKey();
    },
    invokeCodex: options.scoutbotAssistant?.invokeCodex
      ?? createDefaultScoutbotCodexInvoker(currentDirectory),
  });
  let scoutbotRunner: ScoutbotRunnerHandle | null = null;
  if (options.scoutbot?.enabled) {
    try {
      scoutbotRunner = await startScoutbotRunner({
        brokerBaseUrl: options.scoutbot.brokerBaseUrl,
        currentDirectory,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[scoutbot] runner failed to start: ${message}`);
    }
  }
  let fleetHomeBrief: FleetHomeBrief | null = null;
  let fleetHomeBriefInFlight: Promise<FleetHomeBrief> | null = null;
  const repoDiffCache = new Map<string, RepoDiffCacheEntry>();
  const repoDiffInFlight = new Map<string, Promise<ScoutRepoDiffSnapshot>>();
  const runCachedRepoDiff = (
    key: string,
    runRepoDiff: (options: RepoDiffSnapshotOptions) => Promise<ScoutRepoDiffSnapshot>,
    snapshotOptions: RepoDiffSnapshotOptions,
  ): Promise<ScoutRepoDiffSnapshot> => {
    const active = repoDiffInFlight.get(key);
    if (active) return active;
    const request = runRepoDiff(snapshotOptions)
      .then((snapshot) => {
        repoDiffCache.delete(key);
        repoDiffCache.set(key, { snapshot, storedAt: Date.now() });
        trimRepoDiffCache(repoDiffCache);
        return snapshot;
      })
      .finally(() => {
        repoDiffInFlight.delete(key);
      });
    repoDiffInFlight.set(key, request);
    return request;
  };
  const serveRepoDiffSnapshot = async (
    c: Context,
    input: {
      worktreePath: string;
      layers: readonly RepoDiffLayerKind[];
      baseRef?: string;
      compareRef?: string;
      tier: RepoDiffTier;
      cacheMode: RepoDiffCacheMode;
      rehydrate: boolean;
      stateKey?: string;
      paths?: readonly string[];
      scope?: RepoDiffScopeMetadata;
    },
  ) => {
    const runRepoDiff = options.repoDiffSnapshot ?? getRepoDiffSnapshot;
    const cacheKey = repoDiffCacheKey({
      worktreePath: input.worktreePath,
      layers: input.layers,
      baseRef: input.baseRef,
      compareRef: input.compareRef,
      tier: input.tier,
      stateKey: input.stateKey,
      paths: input.paths,
    });
    const snapshotOptions: RepoDiffSnapshotOptions = {
      worktreePath: input.worktreePath,
      layers: input.layers.length > 0 ? [...input.layers] : undefined,
      baseRef: input.baseRef,
      compareRef: input.compareRef,
      paths: input.paths && input.paths.length > 0 ? [...input.paths] : undefined,
      limits: input.tier === "summary" ? REPO_DIFF_SUMMARY_LIMITS : REPO_DIFF_VIEWER_LIMITS,
    };

    if (!options.repoDiffSnapshot && shouldUseGitRepoDiffFallback(input)) {
      const snapshot = buildGitRepoDiffSnapshot({
        worktreePath: input.worktreePath,
        layers: input.layers,
        baseRef: input.baseRef,
        compareRef: input.compareRef,
        tier: input.tier,
        paths: input.paths,
      });
      c.header("x-openscout-repo-diff-cache", "git");
      return c.json(input.scope ? withRepoDiffScope(snapshot, input.scope) : snapshot);
    }

    if (input.cacheMode !== "reload") {
      const cached = repoDiffCache.get(cacheKey);
      if (cached) {
        c.header("x-openscout-repo-diff-cache", "hit");
        c.header("x-openscout-repo-diff-cached-at", String(cached.storedAt));
        if (input.rehydrate) {
          c.header("x-openscout-repo-diff-rehydrate", "queued");
          void runCachedRepoDiff(cacheKey, runRepoDiff, snapshotOptions).catch(() => undefined);
        }
        return c.json(input.scope ? withRepoDiffScope(cached.snapshot, input.scope) : cached.snapshot);
      }
      if (input.cacheMode === "only") {
        c.header("x-openscout-repo-diff-cache", "miss");
        const warming = repoDiffInFlight.has(cacheKey);
        return c.json({
          status: warming ? "warming" : "missing",
          worktreePath: input.worktreePath,
          tier: input.tier,
          layers: input.layers,
          paths: input.paths ?? [],
        }, warming ? 202 : 404);
      }
    }

    try {
      // A diff is a local read — run the native producer in-process. The broker
      // (fleet coordination) is intentionally NOT in this path; agent/session
      // annotations (SCO-065 §15) can enrich later without coupling here.
      const snapshot = await runCachedRepoDiff(cacheKey, runRepoDiff, snapshotOptions);
      c.header("x-openscout-repo-diff-cache", "miss");
      return c.json(input.scope ? withRepoDiffScope(snapshot, input.scope) : snapshot);
    } catch (error) {
      return c.json(
        { error: `repo-diff failed: ${error instanceof Error ? error.message : String(error)}` },
        502,
      );
    }
  };
  const loadFleetHomeBrief = async (force = false): Promise<FleetHomeBrief> => {
    const now = Date.now();
    if (!force && fleetHomeBrief && fleetHomeBrief.expiresAt > now) {
      return fleetHomeBrief;
    }
    if (!force && fleetHomeBriefInFlight) {
      return fleetHomeBriefInFlight;
    }
    let captured: ScoutbotBriefCapture | null = null;
    fleetHomeBriefInFlight = scoutbotAssistant.createBrief({
      route: { view: "fleet" },
      ttlMs: FLEET_HOME_BRIEF_TTL_MS,
      mode: "fleet-home",
      onCaptured: (c) => { captured = c; },
    })
      .then((scoutbotBrief) => {
        if (captured) persistBriefing("fleet-home", scoutbotBrief, captured);
        return buildFleetHomeBrief(scoutbotBrief);
      })
      .then((brief) => {
        fleetHomeBrief = brief;
        return brief;
      })
      .finally(() => {
        fleetHomeBriefInFlight = null;
      });
    return fleetHomeBriefInFlight;
  };

  installScoutApiMiddleware(app, "openscout-web api", {
    trustedHosts: options.trustedHosts,
    trustedOrigins: options.trustedOrigins,
  });

  app.get(routes.bootstrapScriptPath, (c) =>
    new Response(serializeOpenScoutWebBootstrap(process.env), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/javascript; charset=utf-8",
      },
    }),
  );
  app.get(routes.healthPath, (c) =>
    c.json({
      ok: true,
      surface: "openscout-web",
      currentDirectory,
      advertisedHost: options.advertisedHost,
      portalHost: options.portalHost,
      publicOrigin: options.publicOrigin,
    }),
  );
  app.get("/api/build", (c) => c.json(loadOpenScoutBuildInfo(currentDirectory)));

  app.get("/api/knowledge/status", (c) => {
    const store = new SQLiteKnowledgeStore();
    try {
      return c.json(store.status());
    } finally {
      store.close();
    }
  });

  app.get("/api/knowledge/search", (c) => {
    const q = c.req.query("q") ?? "";
    const limit = parseOptionalPositiveInt(c.req.query("limit"), 30) ?? 30;
    const store = new SQLiteKnowledgeStore();
    try {
      return c.json({
        q,
        hits: store.searchLexical({
          q,
          sourceKinds: ["sessions"],
          limit,
          mode: "lexical",
        }),
        status: store.status(),
      });
    } finally {
      store.close();
    }
  });

  app.post("/api/knowledge/source-preview", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      sourceRef?: unknown;
      contextRecords?: unknown;
      maxRecords?: unknown;
      q?: unknown;
    };
    const sourceRef = body.sourceRef;
    if (!isRecord(sourceRef) || sourceRef.kind !== "harness_transcript") {
      return c.json({ error: "sourceRef must be a harness transcript ref" }, 400);
    }
    try {
      return c.json(await readKnowledgeJsonlPreview({
        sourceRef: sourceRef as HarnessTranscriptSourceRef,
        currentDirectory,
        contextRecords: typeof body.contextRecords === "number" ? body.contextRecords : undefined,
        maxRecords: typeof body.maxRecords === "number" ? body.maxRecords : undefined,
        query: typeof body.q === "string" ? body.q : undefined,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("trusted preview roots") ? 403 : 500;
      return c.json({ error: message }, status as 403 | 500);
    }
  });

  app.post("/api/knowledge/sessions/index", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      days?: unknown;
      limit?: unknown;
      force?: unknown;
    };
    const days = typeof body.days === "number" && Number.isFinite(body.days)
      ? body.days
      : 3;
    const limit = typeof body.limit === "number" && Number.isFinite(body.limit)
      ? body.limit
      : 220;
    const force = body.force === true;
    try {
      const result = await indexRecentSessionKnowledge({ days, limit, force });
      const store = new SQLiteKnowledgeStore();
      try {
        return c.json({ result, status: store.status() });
      } finally {
        store.close();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/ui/scenes", async (c) => {
    const settings = await readOpenScoutSettings({ currentDirectory }).catch(() => null);
    return c.json(settings?.ui ?? { scenes: [], activeSceneIdBySurface: {} });
  });

  app.put("/api/ui/scenes", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      scenes?: unknown;
      activeSceneIdBySurface?: unknown;
    };
    try {
      const updated = await writeOpenScoutSettings({
        ui: {
          scenes: Array.isArray(body.scenes) ? (body.scenes as never) : [],
          activeSceneIdBySurface: typeof body.activeSceneIdBySurface === "object" && body.activeSceneIdBySurface
            ? (body.activeSceneIdBySurface as never)
            : {},
        },
      }, { currentDirectory });
      return c.json(updated.ui);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ui/scenes]", message);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/api/scoutbot/session", (c) => c.json(scoutbotAssistant.getSessionState()));
  app.post("/api/scoutbot/session/reset", (c) => c.json(scoutbotAssistant.resetSession()));
  app.post("/api/scoutbot/session/switch", async (c) => {
    const body = await c.req.json<{ id?: unknown }>().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return c.json({ error: "id is required" }, 400);
    }
    try {
      return c.json(scoutbotAssistant.switchSession(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scoutbot switch failed";
      const status = error instanceof ScoutbotAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 404 | 500);
    }
  });
  app.post("/api/scoutbot/session/archive", async (c) => {
    const body = await c.req.json<{ id?: unknown }>().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return c.json({ error: "id is required" }, 400);
    }
    try {
      return c.json(scoutbotAssistant.archiveSession(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scoutbot archive failed";
      const status = error instanceof ScoutbotAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 404 | 500);
    }
  });
  app.get("/api/scoutbot/reminders", (c) => c.json(scoutbotReminders.getState()));
  app.post("/api/scoutbot/reminders", async (c) => {
    const body = await c.req.json<{
      title?: unknown;
      body?: unknown;
      source?: unknown;
      dueAt?: unknown;
      delayMs?: unknown;
      delayMinutes?: unknown;
      context?: unknown;
    }>().catch(() => ({}));

    try {
      return c.json(scoutbotReminders.create(body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scoutbot reminder failed";
      const status = error instanceof ScoutbotReminderError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 404 | 500);
    }
  });
  app.post("/api/scoutbot/reminders/:id/dismiss", (c) => {
    try {
      return c.json(scoutbotReminders.dismiss(c.req.param("id")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scoutbot reminder failed";
      const status = error instanceof ScoutbotReminderError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 404 | 500);
    }
  });
  app.get("/api/scoutbot/config", (c) => c.json(scoutbotAssistant.getConfig()));
  app.post("/api/scoutbot/config", async (c) => {
    const body = await c.req.json<{
      model?: string | null;
      systemPrompt?: string | null;
    }>().catch(() => ({}));
    return c.json({
      config: scoutbotAssistant.updateConfig({
        model: body.model,
        systemPrompt: body.systemPrompt,
      }),
    });
  });
  app.get("/api/scoutbot/credentials", async (c) => {
    return c.json(await resolveScoutbotCredentialState(scoutbotCredentials));
  });
  app.post("/api/scoutbot/credentials/openai", async (c) => {
    const body = await c.req.json<{ apiKey?: unknown }>().catch(() => ({}));
    try {
      if (typeof body.apiKey !== "string") {
        return c.json({ error: "apiKey is required" }, 400);
      }
      scoutbotCredentials.setOpenAIKey(body.apiKey);
      return c.json(await resolveScoutbotCredentialState(scoutbotCredentials));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save OpenAI API key.";
      return c.json({ error: message }, 400);
    }
  });
  app.delete("/api/scoutbot/credentials/openai", async (c) => {
    scoutbotCredentials.deleteOpenAIKey();
    return c.json(await resolveScoutbotCredentialState(scoutbotCredentials));
  });
  app.post("/api/scoutbot/chat", async (c) => {
    const body = await c.req.json<{
      body?: string;
      route?: unknown;
    }>().catch(() => ({}));

    try {
      return c.json(await scoutbotAssistant.respond({
        body: body.body ?? "",
        route: body.route,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scoutbot assistant failed";
      const status = error instanceof ScoutbotAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 500 | 502 | 503 | 504);
    }
  });
  app.post("/api/scoutbot/actions/ask", async (c) => {
    const body = await c.req.json<{
      targetLabel?: string;
      targetAgentId?: string;
      body?: string;
      channel?: string;
    }>().catch(() => ({}));
    const targetLabel = body.targetLabel?.trim() || body.targetAgentId?.trim() || "";
    const targetAgentId = body.targetAgentId?.trim();
    const requestBody = body.body?.trim() ?? "";
    const channel = body.channel?.trim();
    if (!targetLabel) {
      return c.json({ error: "targetLabel or targetAgentId is required" }, 400);
    }
    if (!requestBody) {
      return c.json({ error: "body is required" }, 400);
    }

    const result = await askScoutQuestion({
      senderId: resolveOperatorName().trim() || "operator",
      targetLabel,
      ...(targetAgentId ? { targetAgentId } : {}),
      body: requestBody,
      ...(channel ? { channel } : {}),
      currentDirectory,
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }
    if (result.unresolvedTarget) {
      return c.json(
        {
          error: `could not route ask to ${result.unresolvedTarget}`,
          targetDiagnostic: result.targetDiagnostic ?? null,
        },
        409,
      );
    }

    return c.json({
      ok: true,
      targetLabel,
      conversationId: result.conversationId ?? null,
      messageId: result.messageId ?? null,
      flightId: result.flight?.id ?? null,
      targetAgentId: result.flight?.targetAgentId ?? null,
    });
  });
  app.post("/api/scoutbot/brief", async (c) => {
    const body = await c.req.json<{
      route?: unknown;
      ttlMs?: number | null;
    }>().catch(() => ({}));

    try {
      let captured: ScoutbotBriefCapture | null = null;
      const brief = await scoutbotAssistant.createBrief({
        route: body.route,
        ttlMs: body.ttlMs,
        onCaptured: (cap) => { captured = cap; },
      });
      if (captured) persistBriefing("tour", brief, captured);
      emitBroadcast({
        tier: "info",
        text: `Brief · ${brief.title}`,
        ruleId: "scoutbot.brief",
        key: "scoutbot.brief",
        agent: "scoutbot",
      });
      return c.json(brief);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scoutbot brief failed";
      const status = error instanceof ScoutbotAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 500 | 502 | 503 | 504);
    }
  });
  app.get("/api/briefings", (c) => {
    const limitParam = c.req.query("limit");
    const parsed = limitParam ? Number.parseInt(limitParam, 10) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;
    return c.json({ briefings: listBriefings({ limit }) });
  });
  app.get("/api/briefings/:id", (c) => {
    const briefing = getBriefing(c.req.param("id"));
    if (!briefing) return c.json({ error: "not found" }, 404);
    return c.json(briefing);
  });
  app.delete("/api/briefings/:id", (c) => {
    return c.json({ deleted: deleteBriefing(c.req.param("id")) });
  });
  app.get("/api/file/roots", (c) => {
    const roots = collectTrustedRoots({ currentDirectory });
    return c.json({ roots });
  });

  app.get("/api/file/preview", (c) => {
    const requestedPath = c.req.query("path");
    if (!requestedPath) {
      return c.json({ error: "missing path" }, 400);
    }
    const result = readFilePreview({ requestedPath, currentDirectory });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 403 | 404 | 415 | 500);
    }
    return c.json(result.content);
  });

  app.get("/api/file/raw", (c) => {
    const requestedPath = c.req.query("path");
    if (!requestedPath) {
      return c.json({ error: "missing path" }, 400);
    }
    const roots = collectTrustedRoots({ currentDirectory });
    const resolved = resolveTrustedPath({ requestedPath, roots });
    if (!resolved.ok) {
      return c.json({ error: resolved.error }, resolved.status as 400 | 403 | 404);
    }
    try {
      if (!statSync(resolved.realPath).isFile()) {
        return c.json({ error: "path is not a file" }, 415);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not read file";
      return c.json({ error: message }, 500);
    }
    return new Response(Bun.file(resolved.realPath), {
      headers: {
        "content-type": mediaTypeFor(resolved.realPath),
        "cache-control": "private, max-age=60",
      },
    });
  });

  app.post("/api/file/reveal", async (c) => {
    const body = await c.req.json<{ path?: unknown }>().catch(() => null);
    const requestedPath = typeof body?.path === "string" ? body.path : "";
    if (!requestedPath.trim()) {
      return c.json({ error: "missing path" }, 400);
    }
    const roots = collectTrustedRoots({ currentDirectory });
    const resolved = resolveTrustedPath({ requestedPath, roots });
    if (!resolved.ok) {
      return c.json({ error: resolved.error }, resolved.status as 400 | 403 | 404);
    }
    try {
      await (options.revealPath ?? defaultRevealLocalPath)(resolved.realPath);
      return c.json({ ok: true, path: resolved.realPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to reveal path";
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/local-path/reveal", async (c) => {
    const body = await c.req.json<{
      path?: unknown;
      basePath?: unknown;
      agentId?: unknown;
      sessionId?: unknown;
    }>().catch(() => null);
    const rawPath = typeof body?.path === "string" ? body.path.trim() : "";
    if (!rawPath) {
      return c.json({ error: "missing path" }, 400);
    }
    const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!agentId && !sessionId) {
      return c.json({ error: "agentId or sessionId is required" }, 400);
    }

    const observePayload = await loadRevealObservePayload({ agentId, sessionId });
    if (!observePayload) {
      return c.json({ error: "observe payload not found" }, 404);
    }

    const basePath = typeof body?.basePath === "string" ? body.basePath : null;
    const targetPath = resolveExplorablePath(rawPath, basePath, currentDirectory);
    const realTargetPath = realpathIfExists(targetPath);
    if (!realTargetPath) {
      return c.json({ error: "path not found" }, 404);
    }
    if (!observedRevealPathSet(observePayload).has(realTargetPath)) {
      return c.json({ error: "path is not part of the observed session" }, 403);
    }

    try {
      await (options.revealPath ?? defaultRevealLocalPath)(realTargetPath);
      return c.json({ ok: true, path: realTargetPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to reveal path";
      return c.json({ error: message }, 500);
    }
  });
  app.use("/", async (c, next) => {
    const portalHost = options.portalHost?.trim().toLowerCase();
    const nodeHost = options.advertisedHost?.trim().toLowerCase();
    const requestHost = normalizeRequestHost(c.req.header("host"));
    if (portalHost && nodeHost && requestHost === portalHost && portalHost !== nodeHost) {
      return new Response(
        renderScoutLocalPortal({
          requestUrl: c.req.url,
          portalHost,
          nodeHost,
        }),
        {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    }
    return next();
  });
  app.get(routes.terminalRelayHealthPath, async (c) => {
    const ok = await (options.terminalRelayHealthcheck?.() ?? Promise.resolve(false));
    return c.json(
      {
        ok,
        surface: "openscout-terminal-relay",
      },
      ok ? 200 : 503,
    );
  });
  app.get("/api/pairing-state", async (c) =>
    c.json(await loadPairingState(currentDirectory, false)),
  );
  app.get("/api/pairing-state/refresh", async (c) =>
    c.json(await loadPairingState(currentDirectory, true)),
  );
  const pickPairingLocation = (
    state: ScoutPairingState,
    route: string | null,
  ): string | null => {
    const links = pairingDeepLinks(state.pairing?.qrValue);
    return route === "lan"
      ? links.lan ?? links.default
      : route === "ts" || route === "tsn" || route === "tailnet"
        ? links.tailnet ?? links.default
        : links.default;
  };
  app.get(`/${SCOUT_PAIRING_DEEP_LINK_PATH}`, async (c) => {
    c.header("cache-control", "no-store");
    const route = c.req.query("route")?.trim().toLowerCase() ?? null;
    const token = c.req.query("token")?.trim() || null;
    const wantsJson = (c.req.header("accept") ?? "").includes("application/json");

    const state = await loadPairingState(currentDirectory, true);
    const location = pickPairingLocation(state, route);

    // Live payload available (pair mode running) — hand it straight over. This
    // is the existing fast path: manual start, QR, or an approved request whose
    // pair mode has come up. Once delivered, the request is done.
    if (location) {
      if (token) pendingPairRequests.fulfill(token);
      return c.redirect(location, 302);
    }

    // No live payload. Initial pairing is trust-on-first-use, so we don't start
    // pair mode for just anyone on the LAN — we register a request the Mac must
    // approve. The device polls with its token until approval brings the
    // payload up (302) or the request is denied/expires.
    if (token) {
      const req = pendingPairRequests.get(token);
      if (!req) {
        return wantsJson
          ? c.json({ status: "expired", token }, 410)
          : c.text("Pairing request expired.", 410);
      }
      if (req.status === "denied") {
        return wantsJson
          ? c.json({ status: "denied", token }, 403)
          : c.text("Pairing request was denied.", 403);
      }
      // pending, or approved but the relay payload isn't up yet — keep polling.
      // Touch so an actively-polling device doesn't age out mid-approval.
      pendingPairRequests.touch(token);
      return c.json({ status: req.status, token, pollAfterMs: 1200 }, 202);
    }

    // First contact from an unpaired device — register an approval request.
    const xff = c.req.header("x-forwarded-for");
    const requesterIp = (xff ? xff.split(",")[0]?.trim() : null)
      || c.req.header("x-real-ip")?.trim()
      || null;
    const req = pendingPairRequests.create({
      requesterIp,
      requesterLabel: c.req.header("x-scout-device-name")?.trim() || null,
      route,
    });
    return wantsJson
      ? c.json({ status: "pending", token: req.token, pollAfterMs: 1200 }, 202)
      : c.text(
          `${SCOUT_PAIRING_DEEP_LINK_SCHEME}://${SCOUT_PAIRING_DEEP_LINK_PATH} pairing requires approval on the Mac.`,
          202,
        );
  });
  app.get("/api/pairing/requests", (c) =>
    c.json({ requests: pendingPairRequests.list() }),
  );
  app.post("/api/pairing/requests/:token/decide", async (c) => {
    const token = c.req.param("token");
    const body = (await c.req.json().catch(() => ({}))) as { decision?: string };
    const decision =
      body.decision === "approve" ? "approve"
      : body.decision === "deny" ? "deny"
      : null;
    if (!decision) {
      return c.json({ error: "decision must be 'approve' or 'deny'" }, 400);
    }
    const req = pendingPairRequests.decide(token, decision);
    if (!req) {
      return c.json({ error: "unknown or expired pairing request" }, 404);
    }
    if (decision === "approve") {
      // Bring pair mode up so the payload is ready for the device's next poll.
      // The runtime spins up asynchronously; the device keeps polling /pair.
      try {
        await controlScoutWebPairingService("start", currentDirectory);
      } catch (error) {
        console.error(
          "[openscout-web pairing] failed to start pair mode on approval:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    shellStateCache.invalidate();
    return c.json({ request: req });
  });
  app.get("/api/operator-attention", async (c) =>
    c.json(await buildOperatorAttentionState(currentDirectory)),
  );
  app.post("/api/operator-attention/approvals/decide", async (c) => {
    const body = (await c.req.json()) as {
      sessionId?: string;
      turnId?: string;
      blockId?: string;
      version?: number;
      decision?: "approve" | "deny";
      reason?: string | null;
    };
    if (!body.sessionId || !body.turnId || !body.blockId || typeof body.version !== "number") {
      return c.json({ error: "sessionId, turnId, blockId, and version are required" }, 400);
    }
    if (body.decision !== "approve" && body.decision !== "deny") {
      return c.json({ error: "decision must be approve or deny" }, 400);
    }
    await decideScoutWebPairingApproval(
      {
        sessionId: body.sessionId,
        turnId: body.turnId,
        blockId: body.blockId,
        version: body.version,
        decision: body.decision,
        reason: body.reason ?? null,
      },
      currentDirectory,
    );
    shellStateCache.invalidate();
    return c.json(await buildOperatorAttentionState(currentDirectory));
  });
  app.post("/api/operator-attention/dismiss", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      recordKind?: unknown;
      recordId?: unknown;
      flightId?: unknown;
      unblockRequestId?: unknown;
      itemUpdatedAt?: unknown;
    };
    const recordKind = body.recordKind === "question" || body.recordKind === "work_item" ? body.recordKind : null;
    const recordId = typeof body.recordId === "string" ? body.recordId.trim() : "";
    const flightId = typeof body.flightId === "string" ? body.flightId.trim() : "";
    const unblockRequestId = typeof body.unblockRequestId === "string" ? body.unblockRequestId.trim() : "";
    const itemUpdatedAt = typeof body.itemUpdatedAt === "number" && Number.isFinite(body.itemUpdatedAt)
      ? body.itemUpdatedAt
      : 0;
    if (itemUpdatedAt <= 0 || (!unblockRequestId && !flightId && (!recordKind || !recordId))) {
      return c.json({ error: "unblockRequestId, recordKind and recordId, or flightId, plus itemUpdatedAt are required" }, 400);
    }
    if (unblockRequestId) {
      await markUnblockRequestTerminal({
        requestId: unblockRequestId,
        state: "dismissed",
        summary: "Dismissed from operator queue.",
        resolution: "Dismissed by operator.",
      });
    } else if (flightId) {
      await dismissFlightAttention({ flightId, itemUpdatedAt });
    } else if (recordKind && recordId) {
      await dismissCollaborationAttention({ recordKind, recordId, itemUpdatedAt });
    }
    return c.json(await buildOperatorAttentionState(currentDirectory));
  });
  app.post("/api/pairing/control", async (c) => {
    const { action } = (await c.req.json()) as {
      action: ScoutPairingControlAction;
    };
    const result = await controlScoutWebPairingService(
      action,
      currentDirectory,
    );
    shellStateCache.invalidate();
    return c.json(result);
  });
  app.delete("/api/pairing/peers/:fingerprint", async (c) => {
    const fingerprint = c.req.param("fingerprint");
    const removed = removeScoutPairingTrustedPeer(fingerprint);
    if (!removed) {
      return c.json({ error: "Peer not found" }, 404);
    }
    return c.json({ ok: true });
  });

  app.get("/api/shell-state", async (c) => c.json(await shellStateCache.get()));
  app.get("/api/shell-state/refresh", async (c) =>
    c.json(await shellStateCache.refresh()),
  );

  app.get("/api/agent-config/snapshot", async (c) =>
    c.json(await buildAgentConfigurationSnapshot(currentDirectory)),
  );
  app.get("/api/agents", async (c) => c.json(await queryAgentsIncludingBrokerCards()));
  app.get("/api/terminal-sessions", (c) => {
    const backend = parseTerminalSessionBackend(c.req.query("backend"));
    if (c.req.query("backend") && !backend) {
      return c.json({ error: "backend must be tmux or zellij" }, 400);
    }
    const limit = parseTerminalSessionLimit(c.req.query("limit"));
    const sessions = queryTerminalSessions({
      ...(c.req.query("harness") ? { harness: c.req.query("harness") } : {}),
      ...(c.req.query("sourceSessionId") ? { sourceSessionId: c.req.query("sourceSessionId") } : {}),
      ...(backend ? { backend } : {}),
      limit,
    });
    const includeDiscovered = parseTerminalSessionDiscoveryFlag(c.req.query("includeDiscovered"));
    const discovered = includeDiscovered
      ? queryDiscoveredTerminalSessions({
          ...(backend ? { backend } : {}),
          limit: Math.max(0, limit - sessions.length),
          excludeSurfaces: sessions.flatMap((session) =>
            session.surfaces.map((surface) => terminalSurfaceKey(surface.backend, surface.sessionName))
          ),
        })
      : [];
    const visibleSessions = [...sessions, ...discovered];
    return c.json({
      ok: true,
      count: visibleSessions.length,
      sessions: visibleSessions,
    });
  });
  app.get("/api/terminal-sessions/peek", async (c) => {
    const backend = parseTerminalSessionBackend(c.req.query("backend"));
    const sessionName = firstMetadataString(c.req.query("sessionName"));
    const capturedAt = Date.now();
    const lines = parseTmuxPeekLineCount(c.req.query("lines"));
    const columns = parseTmuxPeekColumnCount(c.req.query("cols") ?? c.req.query("columns"));

    if (!backend) {
      return c.json({ error: "backend must be tmux or zellij" }, 400);
    }
    if (!sessionName) {
      return c.json({ error: "sessionName is required" }, 400);
    }
    if (backend !== "tmux") {
      return c.json({
        available: false,
        agentId: "terminal",
        sessionId: sessionName,
        capturedAt,
        body: "",
        lineCount: lines,
        columnCount: columns,
        truncated: false,
        reason: `${backend} previews are not available yet.`,
      });
    }

    const capture = await (options.captureTmuxPane ?? defaultCaptureTmuxPane)({
      agentId: "terminal",
      sessionId: sessionName,
      paneTarget: sessionName,
      cwd: null,
      lines,
      columns,
    });
    if (!capture) {
      return c.json({
        available: false,
        agentId: "terminal",
        sessionId: sessionName,
        capturedAt,
        body: "",
        lineCount: lines,
        columnCount: columns,
        truncated: false,
        reason: "The tmux pane is not available right now.",
      });
    }

    const normalized = normalizeTmuxPeekBody(capture.body, lines, columns);
    return c.json({
      available: true,
      agentId: "terminal",
      sessionId: sessionName,
      capturedAt,
      body: normalized.body,
      lineCount: capture.lineCount ?? normalized.lineCount,
      columnCount: normalized.columnCount,
      truncated: capture.truncated ?? normalized.truncated,
      reason: null,
    });
  });
  app.get("/api/agents/:id", async (c) => {
    const agent = await queryAgentIncludingBrokerCard(c.req.param("id"));
    return agent ? c.json(agent) : c.json({ error: "agent not found" }, 404);
  });
  // Flexible session initiation. A single payload expresses every modality —
  // start fresh in a project, start "the same agent" fresh, continue an
  // agent's existing harness session with full context, or seed a new
  // conversation from a message — by setting different fields. See
  // docs/agent for the modality matrix; `seed.branchFrom` is accepted now and
  // reserved for forthcoming context-forking work (currently inert).
  app.post("/api/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      target?: { agentId?: string; projectPath?: string };
      execution?: {
        harness?: string;
        model?: string;
        session?: string;
        targetSessionId?: string;
      };
      agent?: { persistence?: string; name?: string; displayName?: string };
      seed?: {
        instructions?: string;
        fromMessageId?: string;
        fromConversationId?: string;
        branchFrom?: { sessionId?: string; messageId?: string };
      };
    };

    const targetAgentId = optionalString(body.target?.agentId)?.trim();
    const agent = targetAgentId ? queryAgentById(targetAgentId) : null;
    if (targetAgentId && !agent) {
      return c.json({ error: `agent ${targetAgentId} not found` }, 404);
    }

    // Resolve a project path: explicit wins, else inherit the agent's root.
    const projectPath =
      optionalString(body.target?.projectPath)?.trim() ||
      agent?.projectRoot?.trim() ||
      undefined;
    if (!targetAgentId && !projectPath) {
      return c.json(
        { error: "target.agentId or target.projectPath is required" },
        400,
      );
    }

    // Execution preferences fall back to the resolved agent so "same agent"
    // keeps its harness/model.
    const session = normalizeExecutionSession(body.execution?.session);
    const harness =
      coerceAgentHarness(body.execution?.harness) ??
      coerceAgentHarness(agent?.harness);
    const model =
      optionalString(body.execution?.model)?.trim() ||
      agent?.model?.trim() ||
      undefined;
    let targetSessionId = optionalString(body.execution?.targetSessionId)?.trim();
    if (session === "existing" && !targetSessionId) {
      targetSessionId = agent?.harnessSessionId?.trim() || undefined;
    }
    if (session === "existing" && !targetSessionId) {
      return c.json(
        {
          error:
            "session 'existing' requires execution.targetSessionId or an agent with a resolvable session",
        },
        400,
      );
    }

    // Sticky reuse of the same agentName is what makes M3/M4 "the same agent".
    const persistence =
      body.agent?.persistence === "one_time" ? "one_time" : "sticky";
    const agentName =
      optionalString(body.agent?.name)?.trim() || agent?.name?.trim() || undefined;
    const displayName = optionalString(body.agent?.displayName)?.trim() || undefined;

    const instructions = optionalString(body.seed?.instructions)?.trim();
    const fromMessageId = optionalString(body.seed?.fromMessageId)?.trim();
    const fromConversationId = optionalString(body.seed?.fromConversationId)?.trim();
    const branchFrom = body.seed?.branchFrom;

    const result = await askScoutQuestion({
      senderId: resolveOperatorName().trim() || "operator",
      ...(targetAgentId
        ? { targetLabel: targetAgentId, targetAgentId }
        : {
            target: { kind: "project_path", projectPath: projectPath! },
          }),
      body: instructions && instructions.length > 0 ? instructions : "New session started.",
      ...(harness ? { executionHarness: harness } : {}),
      ...(model ? { executionModel: model } : {}),
      ...(session ? { executionSession: session } : {}),
      ...(targetSessionId ? { executionTargetSessionId: targetSessionId } : {}),
      projectAgent: {
        persistence,
        ...(agentName ? { agentName } : {}),
        ...(displayName ? { displayName } : {}),
      },
      currentDirectory: projectPath ?? currentDirectory,
      source: "scout-session-initiation",
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }
    if (result.unresolvedTarget) {
      return c.json(
        {
          error: `could not start session: ${result.unresolvedTarget}`,
          targetDiagnostic: result.targetDiagnostic ?? null,
        },
        409,
      );
    }

    return c.json({
      ok: true,
      conversationId: result.conversationId ?? null,
      messageId: result.messageId ?? null,
      flightId: result.flight?.id ?? null,
      agentId: result.flight?.targetAgentId ?? targetAgentId ?? null,
      provenance:
        fromMessageId || fromConversationId || branchFrom
          ? {
              fromMessageId: fromMessageId ?? null,
              fromConversationId: fromConversationId ?? null,
              branchFrom: branchFrom ?? null,
            }
          : null,
    });
  });
  app.get("/api/observe/agents", async (c) => {
    const ids = c.req.query("ids")
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return c.json(await loadAgentObserveSummaries(ids));
  });
  app.get("/api/agents/:id/observe", async (c) => {
    const payload = await loadAgentObservePayload(c.req.param("id"));
    return payload ? c.json(payload) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/agents/:agentId/config", async (c) => {
    const agentId = c.req.param("agentId");
    const { getLocalAgentConfig } = await import("@openscout/runtime/local-agents");
    const config = await getLocalAgentConfig(agentId);
    return config ? c.json(config) : c.json({ error: "agent config not found" }, 404);
  });
  app.post("/api/agents/:agentId/config", async (c) => {
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const { getLocalAgentConfig, restartLocalAgent, updateLocalAgentConfig } =
      await import("@openscout/runtime/local-agents");
    const existing = await getLocalAgentConfig(agentId);
    if (!existing) {
      return c.json({ error: "agent config not found" }, 404);
    }

    const runtime = body.runtime && typeof body.runtime === "object"
      ? body.runtime as Record<string, unknown>
      : {};
    const model = hasOwn(body, "model")
      ? optionalString(body.model)?.trim() || null
      : existing.model;
    const nextConfig = await updateLocalAgentConfig(agentId, {
      runtime: {
        cwd: optionalString(runtime.cwd) ?? existing.runtime.cwd,
        harness: optionalString(runtime.harness) ?? existing.runtime.harness,
        transport: optionalString(runtime.transport) ?? existing.runtime.transport,
        sessionId: optionalString(runtime.sessionId) ?? existing.runtime.sessionId,
      },
      systemPrompt: optionalString(body.systemPrompt) ?? existing.systemPrompt,
      launchArgs: stringList(body.launchArgs, existing.launchArgs),
      model,
      channelEnabled: hasOwn(body, "channelEnabled") ? body.channelEnabled === true : existing.channelEnabled,
      capabilities: stringList(body.capabilities, existing.capabilities),
    });
    if (!nextConfig) {
      return c.json({ error: "agent config not found" }, 404);
    }

    let restarted = false;
    if (body.restart === true) {
      const restartedRecord = await restartLocalAgent(agentId);
      restarted = Boolean(restartedRecord);
    }
    shellStateCache.invalidate();
    const config = await getLocalAgentConfig(agentId);
    return c.json({ config: config ?? nextConfig, restarted });
  });
  app.get("/api/agents/:id/session-catalog", async (c) => {
    const agentId = c.req.param("id");
    const agents = queryAgents();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return c.json(emptyAgentSessionCatalogPayload(agentId));
    const broker = await loadScoutBrokerContext().catch(() => null);
    const endpoint = broker ? activeEndpointForAgent(broker.snapshot, agentId, {
      harness: agent.harness,
      transport: agent.transport,
      sessionId: agent.harnessSessionId,
      cwd: agent.cwd,
      projectRoot: agent.projectRoot,
    }) : null;
    const cwd = endpoint?.cwd ?? endpoint?.projectRoot ?? agent.cwd ?? agent.projectRoot ?? ".";
    return c.json(
      buildAgentSessionCatalogPayload({
        agentId,
        harness: agent.harness,
        cwd,
        transport: agent.transport,
        terminalSurface: agent.terminalSurface,
        activeSessionId: endpoint?.sessionId ?? agent.harnessSessionId,
        model: agent.model,
        startedAt: agent.createdAt ?? agent.updatedAt,
        endpoint,
      }),
    );
  });
  app.get("/api/agents/:agentId/tmux-peek", async (c) => {
    const agentId = c.req.param("agentId");
    const agent = queryAgents(200).find((candidate) => candidate.id === agentId)
      ?? queryAgentById(agentId);
    if (!agent) return c.json({ error: "agent not found" }, 404);

    const broker = await loadScoutBrokerContext().catch(() => null);
    const endpoint = broker ? activeEndpointForAgent(broker.snapshot, agentId, {
      harness: agent.harness,
      transport: agent.transport,
      sessionId: agent.harnessSessionId,
      cwd: agent.cwd,
      projectRoot: agent.projectRoot,
    }) : null;
    const target = resolveTmuxPeekTarget(agent, endpoint);
    const capturedAt = Date.now();
    const lines = parseTmuxPeekLineCount(c.req.query("lines"));
    const columns = parseTmuxPeekColumnCount(c.req.query("cols") ?? c.req.query("columns"));
    if (!target) {
      return c.json({
        available: false,
        agentId,
        sessionId: null,
        capturedAt,
        body: "",
        lineCount: 0,
        columnCount: columns,
        truncated: false,
        reason: "No tmux-backed session is registered for this agent.",
      });
    }

    const capture = await (options.captureTmuxPane ?? defaultCaptureTmuxPane)({
      agentId,
      sessionId: target.sessionId,
      paneTarget: target.paneTarget,
      cwd: target.cwd,
      lines,
      columns,
    });
    if (!capture) {
      return c.json({
        available: false,
        agentId,
        sessionId: target.sessionId,
        capturedAt,
        body: "",
        lineCount: 0,
        columnCount: columns,
        truncated: false,
        reason: "The tmux pane is not available right now.",
      });
    }

    const normalized = normalizeTmuxPeekBody(capture.body, lines, columns);
    return c.json({
      available: true,
      agentId,
      sessionId: target.sessionId,
      capturedAt,
      body: normalized.body,
      lineCount: capture.lineCount ?? normalized.lineCount,
      columnCount: normalized.columnCount,
      truncated: capture.truncated ?? normalized.truncated,
      reason: null,
    });
  });
  app.get("/api/agents/:agentId/session/context", async (c) => {
    const agentId = c.req.param("agentId");
    const { getLocalAgentContextState } =
      await import("@openscout/runtime/local-agents");
    const context = await getLocalAgentContextState(agentId);
    if (!context) {
      return c.json({ error: "agent config not found" }, 404);
    }
    return c.json(context);
  });
  app.get("/api/activity", (c) => c.json(queryActivity()));
  app.get("/api/topology/snapshot", async (c) => {
    const url = new URL(scoutBrokerPaths.v1.topologySnapshot, resolveScoutBrokerUrl());
    if (c.req.query("force") === "1") {
      url.searchParams.set("force", "1");
    }
    try {
      const res = await fetch(url);
      if (res.ok) {
        const brokerSnapshot = await res.json();
        if (brokerSnapshot?.totals?.sources > 0) {
          return c.json(brokerSnapshot);
        }
        const localSnapshot = await readLocalHarnessTopologySnapshot();
        return c.json(localSnapshot?.totals.sources ? localSnapshot : brokerSnapshot);
      }
    } catch {
      /* Fall through to the local read-only observer. */
    }
    const localSnapshot = await readLocalHarnessTopologySnapshot();
    if (localSnapshot) return c.json(localSnapshot);
    return c.json({ error: "broker topology unavailable" }, 502);
  });
  app.get("/api/broker", (c) =>
    c.json(
      queryBrokerDiagnostics({
        limit: parseOptionalPositiveInt(c.req.query("limit"), 120),
        windowMs: parseOptionalPositiveInt(c.req.query("windowMs")),
        cursor: c.req.query("cursor") ?? null,
      }),
    ),
  );
  app.get("/api/heartrate", (c) => c.json(queryHeartrate()));
  app.get("/api/service-budgets", async (c) => {
    const refresh = c.req.query("refresh");
    return c.json(await loadServiceBudgets(refresh === "1" || refresh === "true"));
  });
  app.get("/api/fleet/brief", async (c) => {
    try {
      const refresh = c.req.query("refresh");
      return c.json(await loadFleetHomeBrief(refresh === "1" || refresh === "true"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fleet brief failed";
      const status = error instanceof ScoutbotAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 500 | 502 | 503 | 504);
    }
  });
  app.get("/api/fleet", (c) =>
    c.json(
      queryFleet({
        limit: parseOptionalPositiveInt(c.req.query("limit")),
        activityLimit: parseOptionalPositiveInt(c.req.query("activityLimit")),
        activityLookbackMs: parseOptionalPositiveInt(c.req.query("activityLookbackMs")),
      }),
    ),
  );
  app.get("/api/messages", (c) => {
    const cId = c.req.query("cId") || c.req.query("conversationId") || undefined;
    const messages = queryRecentMessages(
      parseOptionalPositiveInt(c.req.query("limit"), 80) ?? 80,
      { conversationId: cId },
    );
    return c.json(messages.map((message) => ({
      ...message,
      cId: message.conversationId,
    })));
  });
  const rawHeuristicsFromRequest = async (c: Context): Promise<string> => {
    const body = await c.req.json().catch(() => null) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body) && typeof (body as { raw?: unknown }).raw === "string") {
      return (body as { raw: string }).raw;
    }
    return `${JSON.stringify(body ?? {}, null, 2)}\n`;
  };
  app.get("/api/heuristics/defaults", (c) => c.json(defaultHeuristicsResponse()));
  app.get("/api/heuristics/global", (c) => {
    const result = globalHeuristicsFile();
    return "config" in result ? c.json(result) : c.json(result, 400);
  });
  app.put("/api/heuristics/global", async (c) => {
    const result = writeGlobalHeuristicsFile(await rawHeuristicsFromRequest(c));
    return "config" in result ? c.json(result) : c.json(result, 400);
  });
  app.get("/api/heuristics/project", (c) => {
    const workspaceRoot = c.req.query("workspaceRoot");
    if (!workspaceRoot) {
      return c.json({ error: "workspaceRoot is required" }, 400);
    }
    const result = projectHeuristicsFile(workspaceRoot);
    return "config" in result ? c.json(result) : c.json(result, 400);
  });
  app.put("/api/heuristics/project", async (c) => {
    const workspaceRoot = c.req.query("workspaceRoot");
    if (!workspaceRoot) {
      return c.json({ error: "workspaceRoot is required" }, 400);
    }
    const result = writeProjectHeuristicsFile(workspaceRoot, await rawHeuristicsFromRequest(c));
    return "config" in result ? c.json(result) : c.json(result, 400);
  });
  app.get("/api/plan-documents", async (c) => {
    const agents = queryAgents();
    return c.json(await indexPlanDocuments({
      currentDirectory,
      workspaces: agents.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        cwd: agent.cwd,
        project: agent.project,
        projectRoot: agent.projectRoot,
      })),
    }));
  });
  const handleListWork = (c: Context) => {
    const agentId = c.req.query("agentId");
    const conversationId = c.req.query("conversationId");
    const activeOnly = c.req.query("active") !== "false";
    const rawLimit = Number(c.req.query("limit"));
    const limit = Number.isFinite(rawLimit)
      ? Math.min(250, Math.max(1, Math.floor(rawLimit)))
      : undefined;
    return c.json(
      queryWorkItems({
        agentId: agentId || undefined,
        conversationId: conversationId || undefined,
        activeOnly,
        limit,
      }),
    );
  };
  const handleWorkDetail = async (c: Context) => {
    const workId = c.req.param("id");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    const inventory = await buildWorkMaterialsInventory(detail);
    return c.json({ ...detail, inventory });
  };
  const handleWorkInventory = async (c: Context) => {
    const workId = c.req.param("id");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(await buildWorkMaterialsInventory(detail));
  };
  const handleWorkMaterialContent = async (c: Context) => {
    const workId = c.req.param("id");
    const materialId = c.req.query("materialId");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    if (!materialId) {
      return c.json({ error: "materialId is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    const result = await readWorkMaterialContent(detail, materialId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 403 | 404 | 410 | 415);
    }
    return c.json(result.content);
  };
  const handleWorkMaterialRaw = async (c: Context) => {
    const workId = c.req.param("id");
    const materialId = c.req.query("materialId");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    if (!materialId) {
      return c.json({ error: "materialId is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    const result = await readWorkMaterialRaw(detail, materialId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 403 | 404 | 410 | 415);
    }
    return new Response(Bun.file(result.realPath), {
      headers: {
        "content-type": result.mediaType,
        "cache-control": "private, max-age=60",
      },
    });
  };
  app.get("/api/work", handleListWork);
  app.get("/api/tasks", handleListWork);
  app.get("/api/work/:id", handleWorkDetail);
  app.get("/api/work/:id/inventory", handleWorkInventory);
  app.get("/api/work/:id/material", handleWorkMaterialContent);
  app.get("/api/work/:id/material/raw", handleWorkMaterialRaw);
  app.get("/api/tasks/:id", handleWorkDetail);
  app.get("/api/runs", (c) => {
    const agentId = c.req.query("agentId");
    const conversationId = c.req.query("conversationId");
    const collaborationRecordId = c.req.query("collaborationRecordId");
    const workId = c.req.query("workId");
    const state = c.req.query("state");
    const source = c.req.query("source");
    const active = parseOptionalBoolean(c.req.query("active"));
    const limit = parseOptionalPositiveInt(c.req.query("limit"));
    return c.json(
      queryRuns({
        agentId: agentId || undefined,
        conversationId: conversationId || undefined,
        collaborationRecordId: collaborationRecordId || undefined,
        workId: workId || undefined,
        state: state || undefined,
        source: source || undefined,
        active,
        limit,
      }),
    );
  });
  app.get("/api/flights", (c) => {
    const agentId = c.req.query("agentId");
    const conversationId = c.req.query("conversationId");
    const collaborationRecordId = c.req.query("collaborationRecordId");
    const activeOnly = c.req.query("active") !== "false";
    return c.json(
      queryFlights({
        agentId: agentId || undefined,
        conversationId: conversationId || undefined,
        collaborationRecordId: collaborationRecordId || undefined,
        activeOnly,
      }),
    );
  });
  app.get("/api/follow", (c) =>
    c.json(
      queryFollowTarget({
        flightId: c.req.query("flightId") || undefined,
        invocationId: c.req.query("invocationId") || undefined,
        conversationId: c.req.query("conversationId") || undefined,
        workId: c.req.query("workId") || undefined,
        sessionId: c.req.query("sessionId") || undefined,
        targetAgentId: c.req.query("targetAgentId") || undefined,
      }),
    ),
  );
  const readCommsList = async (c: Context) => {
    const rawLimit = Number(c.req.query("limit"));
    const rawKinds = c.req.query("kinds")?.trim();
    return getScoutConversations({
      query: c.req.query("query") || undefined,
      limit: Number.isFinite(rawLimit) ? Math.min(250, Math.max(1, Math.floor(rawLimit))) : undefined,
      kinds: parseConversationKinds(rawKinds),
    });
  };

  app.get("/api/comms", async (c) => {
    const items = await readCommsList(c);
    return c.json(items.map((item) => ({
      ...item,
      cId: item.id,
    })));
  });

  app.get("/api/conversations", async (c) => {
    return c.json(await readCommsList(c));
  });

  app.get("/api/conversations/:id/read-cursors", async (c) => {
    try {
      return c.json(await loadScoutReadCursors({
        conversationId: c.req.param("id"),
      }));
    } catch (cause) {
      return c.json(
        { error: cause instanceof Error ? cause.message : String(cause) },
        502,
      );
    }
  });

  app.post("/api/conversations/:id/read-cursor", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      actorId?: string;
      lastReadMessageId?: string;
      lastReadSeq?: number;
      lastReadAt?: number;
      metadata?: Record<string, unknown>;
    };
    try {
      return c.json(await markScoutConversationRead({
        conversationId: c.req.param("id"),
        actorId: body.actorId?.trim() || "operator",
        lastReadMessageId: body.lastReadMessageId,
        lastReadSeq: body.lastReadSeq,
        lastReadAt: body.lastReadAt,
        metadata: {
          source: "scout-web",
          ...(body.metadata ?? {}),
        },
      }));
    } catch (cause) {
      return c.json(
        { error: cause instanceof Error ? cause.message : String(cause) },
        502,
      );
    }
  });

  const writeConversationMembers = async (
    conversationId: string,
    mutate: (current: string[]) => string[],
  ) => {
    const currentSession = querySessionById(conversationId);
    const canonicalConversationId = currentSession?.id ?? conversationId;
    const existing = queryConversationDefinitionById(canonicalConversationId);
    if (!existing) return null;
    const nextParticipants = mutate(existing.participantIds);
    const nextKind = conversationKindAfterMemberMutation(
      existing.kind as ConversationDefinition["kind"],
      nextParticipants,
    );
    await upsertScoutConversation({
      id: existing.id,
      kind: nextKind,
      title: existing.title,
      visibility: existing.visibility as ConversationDefinition["visibility"],
      shareMode: existing.shareMode as ConversationDefinition["shareMode"],
      authorityNodeId: existing.authorityNodeId,
      participantIds: nextParticipants,
      ...(existing.topic ? { topic: existing.topic } : {}),
      ...(existing.parentConversationId
        ? { parentConversationId: existing.parentConversationId }
        : {}),
      ...(existing.messageId ? { messageId: existing.messageId } : {}),
      ...(existing.metadata ? { metadata: existing.metadata } : {}),
    });
    return {
      kind: nextKind,
      participantIds: nextParticipants,
      session: querySessionById(existing.id),
    };
  };

  app.post("/api/conversations/:id/members", async (c) => {
    const conversationId = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as
      | { actorId?: string }
      | null;
    const actorId = body?.actorId?.trim();
    if (!actorId) return c.json({ error: "actorId is required" }, 400);
    const next = await writeConversationMembers(conversationId, (current) =>
      Array.from(new Set([...current, actorId])).sort(),
    );
    if (!next) return c.json({ error: "conversation not found" }, 404);
    return c.json({ ok: true, ...next });
  });

  app.delete("/api/conversations/:id/members/:actorId", async (c) => {
    const conversationId = c.req.param("id");
    const actorId = c.req.param("actorId");
    const next = await writeConversationMembers(conversationId, (current) =>
      current.filter((id) => id !== actorId),
    );
    if (!next) return c.json({ error: "conversation not found" }, 404);
    return c.json({ ok: true, ...next });
  });

  app.get("/api/sessions", (c) => c.json(querySessions()));
  app.get("/api/session-ref/:id", async (c) => {
    const refId = c.req.param("id");
    const conversation = querySessionById(refId);
    if (conversation) {
      return c.json({
        kind: "conversation",
        refId,
        conversationId: conversation.id,
        session: conversation,
      });
    }

    const harnessSession = querySessions(200).find((session) =>
      session.harnessSessionId === refId
      || (session.harnessSessionId?.endsWith(".jsonl") === true
        && session.harnessSessionId.slice(0, -".jsonl".length) === refId)
    );
    if (harnessSession?.agentId) {
      const payload = await loadSessionRefObservePayload(refId);
      if (payload) {
        return c.json({
          kind: "observe",
          refId,
          session: harnessSession,
          observe: payload,
        });
      }
    }

    const payload = await loadSessionRefObservePayload(refId);
    if (payload) {
      return c.json({
        kind: "observe",
        refId,
        session: null,
        observe: payload,
      });
    }
    return c.json({ error: "not found" }, 404);
  });
  app.get("/api/session-ref/:id/touched", async (c) => {
    const refId = c.req.param("id");
    const payload = await loadSessionRefObservePayload(refId);
    if (!payload) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(sessionTouchedResponse(payload, refId));
  });
  app.get("/api/session/:id", (c) => {
    const session = querySessionById(c.req.param("id"));
    return session ? c.json(session) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/mesh", async (c) => {
    try {
      return c.json(await loadMeshStatus());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });
  app.post("/api/mesh/announce", async (c) => {
    try {
      return c.json(await announceMeshVisibility());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });
  app.post("/api/mesh/tailscale", async (c) => {
    try {
      const { action } = (await c.req.json()) as {
        action: TailscaleControlAction;
      };
      return c.json(await controlTailscale(action));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/mesh/tailnet-probe", async (c) => {
    try {
      const { ip } = (await c.req.json()) as { ip: string };
      // Only allow Tailscale CGNAT range (100.64.0.0/10)
      const parts = ip.split(".");
      const oct1 = Number(parts[0]);
      const oct2 = Number(parts[1]);
      if (parts.length !== 4 || oct1 !== 100 || oct2 < 64 || oct2 > 127) {
        return c.json({ error: "IP is not in the Tailscale address range" }, 403);
      }

      const brokerUrl = `http://${ip}:43110`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      try {
        const [homeRes, nodeRes] = await Promise.all([
          fetch(`${brokerUrl}/v1/home`, { signal: ac.signal }),
          fetch(`${brokerUrl}/v1/node`, { signal: ac.signal }),
        ]);
        clearTimeout(timer);
        const home = homeRes.ok ? await homeRes.json() : null;
        const node = nodeRes.ok ? await nodeRes.json() : null;
        return c.json({ reachable: true, home, node });
      } catch (fetchErr) {
        clearTimeout(timer);
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        return c.json({ reachable: false, error: msg });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/user", (c) => {
    const config = loadUserConfig();
    return c.json({
      name: resolveOperatorName(),
      handle: config.handle ?? "",
      pronouns: config.pronouns ?? "",
      hue: config.hue ?? 195,
      bio: config.bio ?? "",
      timezone: config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      workingHours: config.workingHours ?? "08:00 – 18:00",
      interruptThreshold: config.interruptThreshold ?? "blocking-only",
      batchWindow: config.batchWindow ?? 15,
      channel: config.channel ?? "here+mobile",
      verbosity: config.verbosity ?? "terse",
      tone: config.tone ?? "direct",
      quietHours: config.quietHours ?? "22:00 – 07:00",
    });
  });

  app.get("/api/onboarding/state", async (c) => {
    return c.json(await loadOpenScoutOnboardingState({ currentDirectory }));
  });

  app.delete("/api/onboarding/state", (c) => {
    try {
      rmSync(localConfigPath(), { force: true });
    } catch {
      /* already absent */
    }
    return c.json({ ok: true, localConfigPath: localConfigPath() });
  });

  app.post("/api/onboarding/skip", async (c) => {
    return c.json(await skipOpenScoutOnboarding({ currentDirectory }));
  });

  app.post("/api/onboarding/setup", async (c) => {
    const state = await loadOpenScoutOnboardingState({ currentDirectory });
    const contextRoot = state.contextRoot || state.projectRoot || state.currentDirectory;
    try {
      const result = await runOpenScoutOnboardingSetup({
        currentDirectory: contextRoot,
        contextRoot,
        sourceRoots: state.sourceRoots,
        defaultHarness: state.defaultHarness,
      });
      return c.json({
        ok: true,
        projectConfigPath: result.setup.currentProjectConfigPath,
        brokerReachable: result.broker.reachable,
        brokerWarning: result.brokerWarning,
        hasReadyRuntime: result.state.hasReadyRuntime,
        state: result.state,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[onboarding/setup]", message);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/onboarding/project", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      contextRoot?: string;
      sourceRoots?: string[];
      defaultHarness?: "claude" | "codex";
    };
    const contextRoot = body.contextRoot?.trim();
    if (!contextRoot) {
      return c.json({ error: "contextRoot is required" }, 400);
    }
    const sourceRoots = (body.sourceRoots ?? [])
      .map((entry) => entry?.trim())
      .filter((entry): entry is string => Boolean(entry && entry.length > 0));
    const harness = body.defaultHarness === "codex" ? "codex" : "claude";

    try {
      await saveOpenScoutOnboardingProject({
        currentDirectory,
        contextRoot,
        sourceRoots,
        defaultHarness: harness,
      });

      const result = await runOpenScoutOnboardingSetup({
        currentDirectory: contextRoot,
        contextRoot,
        sourceRoots,
        defaultHarness: harness,
      });
      return c.json({
        ok: true,
        projectConfigPath: result.setup.currentProjectConfigPath,
        brokerReachable: result.broker.reachable,
        brokerWarning: result.brokerWarning,
        hasReadyRuntime: result.state.hasReadyRuntime,
        state: result.state,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[onboarding/project]", message);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/onboarding/init", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      host?: string;
      ports?: { broker?: number; web?: number; pairing?: number };
    };
    const state = await ensureOpenScoutOnboardingLocalConfig({
      currentDirectory,
      host: body.host,
      ports: body.ports,
    });
    return c.json({
      ok: true,
      localConfig: state.localConfig,
      localConfigPath: state.localConfigPath,
      state,
    });
  });

  app.post("/api/user", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const config = loadUserConfig();

    const stringFields = [
      "name", "handle", "pronouns", "bio", "timezone",
      "workingHours", "interruptThreshold", "channel",
      "verbosity", "tone", "quietHours",
    ] as const;
    for (const key of stringFields) {
      if (key in body) {
        const val = body[key];
        if (typeof val === "string" && val.trim()) {
          (config as Record<string, unknown>)[key] = val.trim();
        } else {
          delete (config as Record<string, unknown>)[key];
        }
      }
    }
    if ("hue" in body && typeof body.hue === "number") {
      config.hue = body.hue;
    }
    if ("batchWindow" in body && typeof body.batchWindow === "number") {
      config.batchWindow = body.batchWindow;
    }

    saveUserConfig(config);
    if (typeof body.name === "string" && body.name.trim()) {
      await saveOpenScoutOnboardingIdentity({
        currentDirectory,
        name: body.name.trim(),
      });
    }
    return c.json({
      name: resolveOperatorName(),
      handle: config.handle ?? "",
      pronouns: config.pronouns ?? "",
      hue: config.hue ?? 195,
      bio: config.bio ?? "",
      timezone: config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      workingHours: config.workingHours ?? "08:00 – 18:00",
      interruptThreshold: config.interruptThreshold ?? "blocking-only",
      batchWindow: config.batchWindow ?? 15,
      channel: config.channel ?? "here+mobile",
      verbosity: config.verbosity ?? "terse",
      tone: config.tone ?? "direct",
      quietHours: config.quietHours ?? "22:00 – 07:00",
    });
  });

  app.post(routes.terminalRunPath, async (c) => {
    const body = await c.req.json<TerminalRunRequest>();
    const command = body.command?.trim();
    if (!command) return c.json({ error: "missing command" }, 400);
    if (!options.runTerminalCommand) {
      return c.json({ error: "terminal relay is unavailable" }, 503);
    }
    try {
      await options.runTerminalCommand({
        command,
        cwd: body.cwd?.trim() || null,
        agentId: body.agentId?.trim() || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to queue command";
      return c.json({ error: message }, 503);
    }
    return c.json({ ok: true });
  });

  app.post("/api/terminal-relay/session/destroy", async (c) => {
    const body = await c.req.json<TerminalRelayDestroyRequest>().catch((): Partial<TerminalRelayDestroyRequest> => ({}));
    const sessionId = body.sessionId?.trim();
    if (!sessionId) return c.json({ error: "missing sessionId" }, 400);
    if (!options.destroyTerminalRelaySession) {
      return c.json({ error: "terminal relay is unavailable" }, 503);
    }
    try {
      const destroyed = await options.destroyTerminalRelaySession(sessionId);
      return c.json({ ok: true, destroyed });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to destroy terminal session";
      return c.json({ error: message }, 503);
    }
  });

  app.post("/api/terminal-sessions/control", async (c) => {
    const body = await c.req.json<TerminalSurfaceControlRequest>().catch((): Partial<TerminalSurfaceControlRequest> => ({}));
    const backend = parseTerminalSessionBackend(body.backend);
    const sessionName = body.sessionName?.trim();
    const action = parseTerminalSurfaceControlAction(body.action);

    if (!backend) return c.json({ error: "backend must be tmux or zellij" }, 400);
    if (!sessionName) return c.json({ error: "sessionName is required" }, 400);
    if (!action) return c.json({ error: "action must be interrupt, quit, stop-job, restart-resume, detach, force-quit, or force-quit-bridge" }, 400);

    let delivered = false;
    let resumeResult: { ok: boolean; sessionId: string | null; transcriptPath: string | null } | null = null;
    if (backend === "tmux" && action === "restart-resume") {
      resumeResult = restartClaudeWithResumeInTmuxSurface(sessionName);
      delivered = resumeResult.ok;
    } else if (backend === "tmux" && action !== "force-quit-bridge") {
      delivered = controlTmuxSurface(sessionName, action);
    } else if (action !== "force-quit-bridge") {
      return c.json({ error: `${backend} surface control is not available yet` }, 400);
    }

    let destroyed = 0;
    if (action === "detach" || action === "force-quit" || action === "force-quit-bridge" || action === "restart-resume") {
      if (options.destroyTerminalRelaySurface) {
        destroyed = await options.destroyTerminalRelaySurface(backend, sessionName);
      }
      if (backend === "tmux" && action !== "restart-resume") {
        controlTmuxSurface(sessionName, "detach");
      }
    }

    return c.json({
      ok: true,
      action,
      backend,
      sessionName,
      delivered,
      destroyed,
      resumeSessionId: resumeResult?.sessionId ?? null,
      resumeTranscriptPath: resumeResult?.transcriptPath ?? null,
    });
  });

  app.post(routes.vantageOpenPath, async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      agentId?: unknown;
      agentIds?: unknown;
      nativeSessionIds?: unknown;
      launch?: unknown;
    };
    const agentIds = parseStringArray(body.agentIds);
    const nativeSessionIds = parseStringArray(body.nativeSessionIds);
    try {
      const nativeSessions = nativeSessionIds.length > 0
        ? resolveVantageNativeSessions((await getTailDiscovery()).transcripts, nativeSessionIds)
        : [];
      const handoff = await (options.createVantageHandoff ?? createOpenScoutVantageHandoff)({
        currentDirectory,
        agentId: typeof body.agentId === "string" ? body.agentId.trim() || null : null,
        agentIds,
        nativeSessionIds,
        nativeSessions,
        launch: body.launch !== false,
      });
      return c.json(handoff);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to create Vantage handoff";
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/agents/:agentId/interrupt", async (c) => {
    const agentId = c.req.param("agentId");
    const { interruptLocalAgent } =
      await import("@openscout/runtime/local-agents");
    const result = await interruptLocalAgent(agentId);
    if (!result.ok)
      return c.json({ error: "Agent not found or not interruptible" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/agents/:agentId/session/reset", async (c) => {
    const agentId = c.req.param("agentId");
    const { getLocalAgentConfig, restartLocalAgent } =
      await import("@openscout/runtime/local-agents");
    const config = await getLocalAgentConfig(agentId);
    if (!config) {
      return c.json({ error: "agent config not found" }, 404);
    }

    const restarted = await restartLocalAgent(agentId);
    if (!restarted) {
      return c.json({ error: "agent not found or not restartable" }, 404);
    }

    shellStateCache.invalidate();
    const runtimeDir = relayAgentRuntimeDirectory(agentId);
    const catalog = readSessionCatalogSync(runtimeDir);
    const sessionId = catalog.activeSessionId;
    const harnessEntry = findHarnessEntry(config.runtime.harness);
    const resumeCommand = sessionId && harnessEntry
      ? buildHarnessResumeCommand(harnessEntry, sessionId, config.runtime.cwd)
      : null;

    return c.json({
      ok: true,
      agentId,
      catalog: {
        ...catalog,
        agentId,
        harness: config.runtime.harness,
        resumeCommand,
        resumeCwd: config.runtime.cwd,
      },
    });
  });

  app.get("/api/scoutbot/threads", async (c) => {
    if (!scoutbotRunner) {
      return c.json({ error: "scoutbot runner is not enabled" }, 503);
    }
    try {
      return c.json(await scoutbotRunner.getThreads());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, /broker unreachable/i.test(message) ? 502 : 500);
    }
  });

  // Ephemeral image attachments. Bytes are uploaded here, stored in a cache
  // dir with a TTL, and handed back as an absolute URL that any consumer (the
  // browser, the Mac app, or an agent) can fetch. Nothing lands in the DB.
  app.post("/api/blobs", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      data?: string;
      mediaType?: string;
      fileName?: string;
    } | null;
    if (!body?.data || !body.mediaType) {
      return c.json({ error: "data and mediaType are required" }, 400);
    }
    try {
      const stored = await putImageBlob({
        data: body.data,
        mediaType: body.mediaType,
        fileName: body.fileName,
      });
      const origin = options.publicOrigin?.trim() || new URL(c.req.url).origin;
      return c.json({
        id: stored.id,
        url: `${origin.replace(/\/$/, "")}/api/blobs/${stored.id}`,
        mediaType: stored.mediaType,
        fileName: stored.fileName,
        size: stored.size,
      });
    } catch (error) {
      if (error instanceof ImageBlobError) {
        return c.json({ error: error.message }, error.status as 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/blobs/:id", (c) => {
    const entry = getImageBlob(c.req.param("id"));
    if (!entry) {
      return c.json({ error: "not found" }, 404);
    }
    const headers: Record<string, string> = {
      "content-type": entry.mediaType,
      "cache-control": "private, max-age=3600",
      "content-length": String(entry.size),
    };
    if (entry.fileName) {
      headers["content-disposition"] =
        `inline; filename="${entry.fileName.replace(/"/g, "")}"`;
    }
    return new Response(Bun.file(entry.path), { headers });
  });

  app.post("/api/send", async (c) => {
    const { body, cId, conversationId, threadId, attachments } = (await c.req.json()) as {
      body: string;
      cId?: string;
      conversationId?: string;
      threadId?: string;
      attachments?: OutgoingAttachmentInput[];
    };
    if (!body?.trim() && !attachments?.length) {
      return c.json({ error: "body or attachments are required" }, 400);
    }

    const routeCId = cId ?? conversationId;

    if (!routeCId && scoutbotRunner) {
      try {
        const result = await scoutbotRunner.postOperatorMessage({
          body: body.trim(),
          threadId,
        });
        if (!result.usedBroker) {
          return c.json({ error: "broker unreachable" }, 502);
        }
        return c.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, /unknown scoutbot thread/i.test(message) ? 404 : 500);
      }
    }

    const { directAgentId, channel, conversationId: routedConversationId, senderId } =
      resolveConversationRouting(routeCId);

    if (directAgentId) {
      if (directAgentId === SCOUTBOT_AGENT_ID && scoutbotRunner) {
        try {
          const result = await scoutbotRunner.postOperatorMessage({
            body: body.trim(),
            threadId,
          });
          if (!result.usedBroker) {
            return c.json({ error: "broker unreachable" }, 502);
          }
          return c.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return c.json({ error: message }, /unknown scoutbot thread/i.test(message) ? 404 : 500);
        }
      }

      const result = await sendScoutDirectMessage({
        agentId: directAgentId,
        body: body.trim(),
        currentDirectory,
        source: "scout-web",
      });
      return c.json(result);
    }

    if (routedConversationId) {
      const result = await sendScoutConversationMessage({
        conversationId: routedConversationId,
        senderId,
        body: body.trim(),
        attachments,
        currentDirectory,
        source: "scout-web",
      });
      if (!result.usedBroker) {
        return c.json({ error: "broker unreachable" }, 502);
      }
      return c.json(result);
    }

    const result = await sendScoutMessage({
      senderId,
      body: body.trim(),
      ...(channel ? { channel } : {}),
      attachments,
      currentDirectory,
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }

    return c.json(result);
  });

  app.post("/api/ask", async (c) => {
    const requestBody = (await c.req.json().catch(() => ({}))) as {
      body?: unknown;
      cId?: string;
      conversationId?: string;
      targetAgentId?: unknown;
      targetLabel?: unknown;
      metadata?: unknown;
      execution?: {
        harness?: unknown;
        model?: unknown;
      };
    };
    const message = optionalString(requestBody.body)?.trim();
    if (!message) {
      return c.json({ error: "body is required" }, 400);
    }

    const explicitTargetAgentId = optionalString(requestBody.targetAgentId)?.trim();
    const explicitTargetLabel = optionalString(requestBody.targetLabel)?.trim();
    const routed = explicitTargetAgentId
      ? {
          directAgentId: explicitTargetAgentId,
          senderId: resolveOperatorName().trim() || "operator",
        }
      : resolveConversationRouting(requestBody.cId ?? requestBody.conversationId);
    const agent = routed.directAgentId ? queryAgentById(routed.directAgentId) : null;
    if (!routed.directAgentId) {
      return c.json(
        {
          error:
            "ask is only available in a direct conversation with one agent",
        },
        400,
      );
    }
    const executionHarness =
      coerceAgentHarness(requestBody.execution?.harness) ??
      coerceAgentHarness(agent?.harness);
    const executionModel =
      optionalString(requestBody.execution?.model)?.trim() ||
      agent?.model?.trim() ||
      undefined;
    const requestMetadata = recordInput(requestBody.metadata);
    const source = metadataStringValue(requestMetadata, "source") ?? "scout-web";

    const result = await askScoutQuestion({
      senderId: routed.senderId,
      targetLabel: explicitTargetLabel || routed.directAgentId,
      targetAgentId: routed.directAgentId,
      body: message,
      ...(executionHarness ? { executionHarness } : {}),
      ...(executionModel ? { executionModel } : {}),
      source,
      ...(requestMetadata ? {
        messageMetadata: requestMetadata,
        invocationMetadata: requestMetadata,
      } : {}),
      currentDirectory,
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }
    if (result.unresolvedTarget) {
      return c.json(
        {
          error: `could not route ask to ${result.unresolvedTarget}`,
          targetDiagnostic: result.targetDiagnostic ?? null,
        },
        409,
      );
    }

    return c.json(result);
  });

  app.get("/api/voice/health", async (c) => {
    const health = await getScoutVoiceHealth();
    return c.json(health, health.ok ? 200 : 503);
  });

  app.post("/api/voice/transcribe", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof Blob)) {
      return c.json({ error: "audio file is required" }, 400);
    }
    const format = parseScoutVoiceAudioFormat(optionalString(form?.get("format")));
    if (format === null) {
      return c.json({ error: "audio format is invalid" }, 400);
    }

    try {
      return c.json(await transcribeScoutVoiceAudio({
        audio,
        ...(format ? { format } : {}),
        language: optionalString(form?.get("language")),
        modelId: optionalString(form?.get("modelId")),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scout voice transcription failed";
      return c.json({ error: message }, 503);
    }
  });

  app.post("/api/voice/speak", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      text?: string;
      modelId?: string;
      voiceId?: string;
      speed?: number;
      instructions?: string;
      originAppId?: string;
      utteranceId?: string;
      speechTiming?: unknown;
    };
    const text = body.text?.trim();
    if (!text) {
      return c.json({ error: "text is required" }, 400);
    }
    const speechTiming = parseScoutSpeechTimingRequest(body.speechTiming);
    if (speechTiming === null) {
      return c.json({ error: "speechTiming is invalid" }, 400);
    }

    try {
      return c.json(await synthesizeScoutSpeech({
        text,
        modelId: body.modelId,
        voiceId: body.voiceId,
        speed: body.speed,
        instructions: optionalString(body.instructions),
        originAppId: optionalString(body.originAppId),
        utteranceId: optionalString(body.utteranceId),
        speechTiming,
        signal: c.req.raw.signal,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice speech failed";
      return c.json({ error: message }, 503);
    }
  });

  app.get("/api/voice/defaults", (c) => {
    return c.json(resolveScoutSpeechDefaults());
  });

  // Dev-only: serve generated Scoutbot FX fixtures for /dev/scoutbot-fx lab.
  // Fixtures are produced by packages/web/scripts/generate-scoutbot-fx-fixtures.mjs
  // and live in packages/web/dev/scoutbot-fx-fixtures/ (gitignored).
  if (process.env.NODE_ENV !== "production") {
    const fixturesRoot = join(process.cwd(), "dev", "scoutbot-fx-fixtures");

    app.get("/api/dev/scoutbot-fx/fixtures", (c) => {
      if (!existsSync(fixturesRoot)) {
        return c.json({ fixtures: [], generatedAt: null, available: false });
      }
      const manifestPath = join(fixturesRoot, "manifest.json");
      if (!existsSync(manifestPath)) {
        return c.json({ fixtures: [], generatedAt: null, available: true, note: "manifest missing — re-run the generator script" });
      }
      try {
        const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          generatedAt?: string;
          fixtures?: unknown;
        };
        return c.json({
          available: true,
          generatedAt: parsed.generatedAt ?? null,
          fixtures: Array.isArray(parsed.fixtures) ? parsed.fixtures : [],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "manifest read failed";
        return c.json({ error: message }, 500);
      }
    });

    app.get("/api/dev/scoutbot-fx/audio/:name", (c) => {
      const raw = c.req.param("name");
      // Disallow anything that could escape the fixtures dir.
      if (!raw || raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
        return c.json({ error: "invalid fixture name" }, 400);
      }
      if (!/^[a-zA-Z0-9._-]+\.wav$/.test(raw)) {
        return c.json({ error: "invalid fixture name" }, 400);
      }
      const filePath = join(fixturesRoot, raw);
      if (!existsSync(filePath)) {
        return c.json({ error: "fixture not found" }, 404);
      }
      const body = readFileSync(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "audio/wav",
          "content-length": String(body.length),
          "cache-control": "no-store",
        },
      });
    });
  }

  app.get("/api/events", async (c) => {
    const brokerUrl = resolveScoutBrokerUrl();
    try {
      return await relayEventStream(`${brokerUrl}/v1/events/stream`, {
        signal: c.req.raw.signal,
      });
    } catch {
      return c.text("Broker unreachable", 502);
    }
  });

  app.get("/api/tail/discover", async (c) => {
    const url = new URL(scoutBrokerPaths.v1.tailDiscover, resolveScoutBrokerUrl());
    if (c.req.query("force") === "true" || c.req.query("force") === "1") {
      url.searchParams.set("force", "1");
    }
    const res = await fetch(url);
    if (!res.ok) {
      return c.json({ error: `broker tail discovery unavailable (${res.status})` }, 502);
    }
    return c.json(await res.json());
  });

  app.get("/api/repo-watch", async (c) => {
    const url = new URL(scoutBrokerPaths.v1.repoWatchSnapshot, resolveScoutBrokerUrl());
    for (const key of ["force", "includeTail", "includeDiff", "includeLastCommit", "native"]) {
      const value = c.req.query(key);
      if (value === "1" || value === "true") url.searchParams.set(key, "1");
    }
    for (const key of ["maxRoots", "maxWorktrees", "maxFilesPerWorktree", "scanBudgetMs"]) {
      const value = parseOptionalPositiveInt(c.req.query(key));
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    try {
      const res = await fetch(url, { signal: c.req.raw.signal });
      if (!res.ok) {
        return c.json({ error: `broker repo-watch unavailable (${res.status})` }, 502);
      }
      return c.json(await res.json());
    } catch {
      return c.json({ error: "broker repo-watch unavailable" }, 502);
    }
  });

  app.get("/api/repo-prs", async (c) => {
    const paths = normalizeRepoPullRequestPaths(c.req.queries("path") ?? [], options.currentDirectory);
    const limitPerRepo = parseOptionalPositiveInt(c.req.query("limit"), REPO_PRS_DEFAULT_LIMIT)
      ?? REPO_PRS_DEFAULT_LIMIT;
    if (paths.length === 0) {
      return c.json({
        generatedAt: Date.now(),
        source: "gh",
        paths: [],
        pullRequests: [],
        warnings: ["No git repositories available for open PR lookup."],
      } satisfies RepoPullRequestSnapshot);
    }
    const loadPullRequests = options.repoPullRequests ?? loadRepoPullRequests;
    try {
      return c.json(await loadPullRequests({ paths, limitPerRepo }));
    } catch (error) {
      return c.json({
        generatedAt: Date.now(),
        source: "gh",
        paths,
        pullRequests: [],
        warnings: [error instanceof Error ? error.message : "open PR lookup failed"],
      } satisfies RepoPullRequestSnapshot);
    }
  });

  app.post("/api/scout-services/restart-link", async (c) => {
    let target = parseScoutServicesRestartTarget(c.req.query("target"));
    if (!target) {
      try {
        const body = await c.req.json<{ target?: string }>();
        target = parseScoutServicesRestartTarget(body.target);
      } catch {
        // Body is optional; query-string target is enough.
      }
    }

    if (!target) {
      return c.json({ error: "unsupported Scout Services restart target" }, 400);
    }

    return c.json(createSignedScoutServicesRestartUrl(target));
  });

  app.get("/api/repo-diff/session", async (c) => {
    const refId = c.req.query("sessionId")?.trim()
      || c.req.query("refId")?.trim()
      || c.req.query("ref")?.trim()
      || null;
    const agentId = c.req.query("agentId")?.trim() || null;
    if (!refId && !agentId) {
      return c.json({ error: "repo-diff session scope requires sessionId/refId or agentId" }, 400);
    }
    const payload = await loadRevealObservePayload({ agentId, sessionId: refId });
    if (!payload) {
      return c.json({ error: "observed session not found" }, 404);
    }
    const worktreePath = observedWorktreePath(payload);
    if (!worktreePath) {
      return c.json({ error: "observed session has no worktree path" }, 422);
    }
    const layers = (c.req.queries("layer") ?? []).filter(
      (value): value is RepoDiffLayerKind =>
        value === "unstaged" || value === "staged" || value === "branch",
    );
    const baseRef = c.req.query("baseRef");
    const compareRef = c.req.query("compareRef");
    const tier = parseRepoDiffTier(c.req.query("tier"));
    const cacheMode = parseRepoDiffCacheMode(c.req.query("cache"), c.req.query("force"));
    const rehydrate = wantsRepoDiffRehydrate(c.req.query("rehydrate"));
    const resolvedLayers = layers.length > 0 ? layers : DEFAULT_REPO_DIFF_LAYERS;
    const trimmedBaseRef = baseRef && baseRef.trim() ? baseRef.trim() : undefined;
    const trimmedCompareRef = compareRef && compareRef.trim() ? compareRef.trim() : undefined;
    const include = sessionDiffInclude(c.req.query("include"));
    const paths = normalizeRepoDiffPathFilters(worktreePath, sessionDiffTouchedPaths(payload, include));
    const changedFiles = payload.data.files.filter((file) => file.state !== "read").length;
    const scope: RepoDiffScopeMetadata = {
      kind: "session",
      label: include === "all" ? "Session-touched diff" : "Session changed-files diff",
      worktreePath,
      refId,
      agentId: payload.agentId,
      sessionId: payload.sessionId,
      filteredPaths: paths,
      touchedFiles: payload.data.files.length,
      changedFiles,
      include,
      caveat: "path-filtered-not-hunk-provenance",
    };
    if (paths.length === 0) {
      c.header("x-openscout-repo-diff-cache", "skip");
      return c.json(emptyRepoDiffSnapshot({ worktreePath, layers: resolvedLayers, scope }));
    }
    const resolvedRefs = resolveRepoDiffBranchRefs({
      worktreePath,
      layers: resolvedLayers,
      baseRef: trimmedBaseRef,
      compareRef: trimmedCompareRef,
    });
    const stateKey = repoDiffStateKey({
      worktreePath,
      layers: resolvedLayers,
      baseRef: resolvedRefs.baseRef,
      compareRef: resolvedRefs.compareRef,
      paths,
    });
    return serveRepoDiffSnapshot(c, {
      worktreePath,
      layers: resolvedLayers,
      baseRef: resolvedRefs.baseRef,
      compareRef: resolvedRefs.compareRef,
      tier,
      cacheMode,
      rehydrate,
      stateKey,
      paths,
      scope,
    });
  });

  app.get("/api/repo-diff/worktree", async (c) => {
    const path = c.req.query("path");
    if (!path || !path.trim()) {
      return c.json({ error: "repo-diff requires a worktree path" }, 400);
    }
    const layers = (c.req.queries("layer") ?? []).filter(
      (value): value is RepoDiffLayerKind =>
        value === "unstaged" || value === "staged" || value === "branch",
    );
    const baseRef = c.req.query("baseRef");
    const compareRef = c.req.query("compareRef");
    const runRepoDiff = options.repoDiffSnapshot ?? getRepoDiffSnapshot;
    const tier = parseRepoDiffTier(c.req.query("tier"));
    const cacheMode = parseRepoDiffCacheMode(c.req.query("cache"), c.req.query("force"));
    const rehydrate = wantsRepoDiffRehydrate(c.req.query("rehydrate"));
    const resolvedLayers = layers.length > 0 ? layers : DEFAULT_REPO_DIFF_LAYERS;
    const trimmedPath = path.trim();
    const trimmedBaseRef = baseRef && baseRef.trim() ? baseRef.trim() : undefined;
    const trimmedCompareRef = compareRef && compareRef.trim() ? compareRef.trim() : undefined;
    const paths = repoDiffPathFiltersFromQuery(c, trimmedPath);
    const scope: RepoDiffScopeMetadata = {
      kind: "worktree",
      label: paths.length > 0 ? "Filtered worktree diff" : "Worktree diff",
      worktreePath: trimmedPath,
      filteredPaths: paths,
    };
    const resolvedRefs = resolveRepoDiffBranchRefs({
      worktreePath: trimmedPath,
      layers: resolvedLayers,
      baseRef: trimmedBaseRef,
      compareRef: trimmedCompareRef,
    });
    const stateKey = repoDiffStateKey({
      worktreePath: trimmedPath,
      layers: resolvedLayers,
      baseRef: resolvedRefs.baseRef,
      compareRef: resolvedRefs.compareRef,
      paths,
    });
    return serveRepoDiffSnapshot(c, {
      worktreePath: trimmedPath,
      layers: resolvedLayers,
      baseRef: resolvedRefs.baseRef,
      compareRef: resolvedRefs.compareRef,
      tier,
      cacheMode,
      rehydrate,
      stateKey,
      paths,
      scope,
    });
  });

  app.get("/api/tail/recent", async (c) => {
    const limitParam = parseOptionalPositiveInt(c.req.query("limit"), 500) ?? 500;
    const url = new URL(scoutBrokerPaths.v1.tailRecent, resolveScoutBrokerUrl());
    url.searchParams.set("limit", String(limitParam));
    if (c.req.query("transcripts") === "true" || c.req.query("transcripts") === "1") {
      url.searchParams.set("transcripts", "true");
    }
    const res = await fetch(url);
    if (!res.ok) {
      return c.json({ error: `broker tail unavailable (${res.status})` }, 502);
    }
    return c.json(await res.json());
  });

  // /api/tail/stream removed — clients now subscribe to broker tail.events
  // directly via tRPC over WebSocket. See packages/web/client/lib/tail-events.ts.

  app.get("/api/broadcast/recent", (c) => {
    const limitParam = parseOptionalPositiveInt(c.req.query("limit"), 50) ?? 50;
    return c.json({ broadcasts: snapshotRecentBroadcasts(limitParam) });
  });

  app.get("/api/broadcast/stream", (c) => {
    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const safeEnqueue = (chunk: Uint8Array) => {
          if (closed) return;
          try {
            controller.enqueue(chunk);
          } catch {
            closed = true;
          }
        };

        const recent = snapshotRecentBroadcasts(50);
        for (const broadcast of recent) {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify(broadcast)}\n\n`));
        }
        safeEnqueue(
          encoder.encode(`event: ready\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`),
        );

        const unsubscribe = subscribeBroadcast((broadcast) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify(broadcast)}\n\n`));
        });

        const heartbeat = setInterval(() => {
          safeEnqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
        }, 15_000);

        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        signal.addEventListener("abort", close, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  app.all("/api/*", (c) => c.json({ error: `unknown api route: ${c.req.path}` }, 404));

  await registerScoutWebAssets(app, {
    assetMode: options.assetMode,
    staticRoot: resolveStaticRoot(options.staticRoot),
    viteDevUrl: options.viteDevUrl,
    defaultViteUrl: "http://127.0.0.1:43122",
  });

  const warmupCaches = () =>
    Promise.allSettled([
      shellStateCache.refresh(),
      loadPairingState(currentDirectory, true),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          const message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          console.error(
            "[openscout-web api] initial cache warmup failed:",
            message,
          );
        }
      }
    });

  const stop = async () => {
    lanPairBeacon?.stop();
    pendingPairRequests.dispose();
    if (!scoutbotRunner) return;
    const runner = scoutbotRunner;
    scoutbotRunner = null;
    await runner.stop();
  };

  return { app, warmupCaches, stop };
}
