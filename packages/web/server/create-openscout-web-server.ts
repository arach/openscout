import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { Hono, type Context } from "hono";
import type {
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
import {
  createCachedSnapshot,
  installScoutApiMiddleware,
  relayEventStream,
  registerScoutWebAssets,
  type ScoutWebAssetMode,
} from "./server-core.ts";
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
} from "./db-queries.ts";
import {
  appendScoutCollaborationEvent,
  appendScoutUnblockRequestEvent,
  askScoutQuestion,
  loadScoutReadCursors,
  loadScoutRelayConfig,
  markScoutConversationRead,
  readScoutUnblockRequests,
  resolveScoutBrokerUrl,
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
import type { ScoutVantageNativeSession } from "@openscout/runtime/vantage-plan";
import {
  projectSessionsAttention,
  sessionApprovalAttentionId,
  type SessionAttentionItem,
} from "@openscout/runtime";
import {
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
  createRangerAssistantService,
  RangerAssistantError,
  type RangerBrief,
  type RangerBriefCapture,
  type RangerBriefObservation,
  type RangerBriefReference,
} from "./ranger-assistant.ts";
import {
  deleteBriefing,
  getBriefing,
  listBriefings,
  saveBriefing,
  type BriefingKind,
} from "./db/briefings.ts";
import {
  createRangerReminderStore,
  RangerReminderError,
} from "./ranger-reminders.ts";
import {
  createRangerCredentialStore,
} from "./ranger-credentials.ts";
import { loadServiceBudgets } from "./service-budgets.ts";
import { buildWorkMaterialsInventory, readWorkMaterialContent } from "./work-materials.ts";
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
  readFilePreview,
  resolveTrustedPath,
} from "./file-preview.ts";
import { ensureOpenScoutVoxOrigins, resolveVoxSpeechDefaults, synthesizeVoxSpeech, type VoxSpeechTimingRequest } from "./vox.ts";
import {
  createOpenScoutVantageHandoff,
  type OpenScoutVantageHandoff,
  type OpenScoutVantageHandoffInput,
} from "./vantage-handoff.ts";
import {
  loadUserConfig,
  saveUserConfig,
  resolveOperatorName,
} from "@openscout/runtime/user-config";
import {
  DEFAULT_LOCAL_CONFIG,
  loadLocalConfig,
  localConfigExists,
  localConfigPath,
  writeLocalConfig,
} from "@openscout/runtime/local-config";
import {
  findNearestProjectRoot,
  initializeOpenScoutSetup,
  loadResolvedRelayAgents,
  readOpenScoutSettings,
  writeOpenScoutSettings,
} from "@openscout/runtime/setup";
import { relayAgentRuntimeDirectory } from "@openscout/runtime/support-paths";
import { readSessionCatalogSync } from "@openscout/runtime/claude-stream-json";

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
  resolveOpenScoutWebRoutes,
  serializeOpenScoutWebBootstrap,
} from "../shared/runtime-config.js";
export type { ScoutWebAssetMode } from "./server-core.ts";

export type TerminalRunRequest = {
  command: string;
  cwd?: string | null;
  agentId?: string | null;
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
  createVantageHandoff?: (request: OpenScoutVantageHandoffInput) => Promise<OpenScoutVantageHandoff>;
  terminalRelayHealthcheck?: () => Promise<boolean>;
  revealPath?: (targetPath: string) => Promise<void> | void;
};

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
  brief: RangerBrief,
  capture: RangerBriefCapture,
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
    });
  } catch (err) {
    console.warn(
      "[briefings] auto-save failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

function buildFleetHomeBrief(brief: RangerBrief): FleetHomeBrief {
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
  modelObservations: RangerBriefObservation[],
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

function normalizeFleetBriefReference(ref: RangerBriefReference): FleetHomeBriefReference | null {
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
  const agents = queryAgents(200).filter((agent) => !isRangerLikeAgentRecord(agent));
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function parseVoxSpeechTimingRequest(value: unknown): VoxSpeechTimingRequest | null | undefined {
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
    ...(cues ? { cues: cues as NonNullable<VoxSpeechTimingRequest["cues"]> } : {}),
  };
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
    const operatorCandidates = new Set([senderId.trim(), "operator"]);
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

  if (conversationId?.startsWith("dm.operator.")) {
    const legacyAgentId = conversationId.slice("dm.operator.".length);
    return legacyAgentId || null;
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

function buildAgentSessionCatalogPayload(input: {
  agentId: string;
  harness: string | null;
  cwd: string;
}) {
  const runtimeDir = relayAgentRuntimeDirectory(input.agentId);
  const catalog = readSessionCatalogSync(runtimeDir);
  const sessionId = catalog.activeSessionId;
  const harnessEntry = findHarnessEntry(input.harness);
  const resumeCommand = sessionId && harnessEntry
    ? buildHarnessResumeCommand(harnessEntry, sessionId, input.cwd)
    : null;
  return {
    ...catalog,
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

function compactRangerText(value: string | null | undefined, max = 280): string | null {
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
  const mentionsScoutMcpTool = /mcp__?scout__(invocations_ask|messages_reply)|mcp.*(invocations_ask|messages_reply)/.test(normalized);
  const mentionsScoutTool = /scout ask|allowedtools|allowlist/.test(normalized) || mentionsScoutMcpTool;
  if (!mentionsPermission || !mentionsScoutTool) {
    return null;
  }

  const replyTool = /messages_reply/.test(normalized);
  const command = mentionsScoutMcpTool
    ? `/allow ${replyTool ? "mcp__scout__messages_reply" : "mcp__scout__invocations_ask"}`
    : `{ "allowedTools": ["Bash(scout:*)"] }`;
  const title = mentionsScoutMcpTool
    ? "Claude needs Scout MCP permission"
    : "Claude needs Scout CLI permission";

  return {
    id: `config:${mentionsScoutMcpTool ? `mcp-scout-${replyTool ? "messages-reply" : "invocations-ask"}` : "scout-ask-cli"}`,
    kind: "configuration",
    title,
    summary: compactAttentionSummary(detail),
    detail: mentionsScoutMcpTool
      ? "Allow the Scout MCP coordination tool in the Claude session so routed asks can be delivered without stalling."
      : "Allow the Scout CLI in the Claude session so agents can read context and coordinate without approval loops.",
    agentId: null,
    agentName: null,
    conversationId: null,
    updatedAt: Date.now(),
    severity: "critical",
    sourceLabel: "Claude permissions",
    actions: [
      {
        kind: "copy",
        label: "Copy fix",
        value: command,
      },
      {
        kind: "configure",
        label: "Open settings",
        route: { view: "settings" },
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

  for (const ask of fleet.recentCompleted.filter((item) => item.status === "failed")) {
    items.push({
      id: `ask:${ask.invocationId}`,
      kind: "ask",
      title: "Ask failed",
      summary: compactAttentionSummary(ask.summary ?? ask.task),
      detail: ask.task,
      agentId: ask.agentId,
      agentName: ask.agentName,
      conversationId: ask.conversationId,
      updatedAt: ask.updatedAt,
      severity: "critical",
      sourceLabel: "Ask delivery",
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

async function buildRangerAssistantControlState(currentDirectory: string) {
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
    .map(compactRangerTailEvent);
  const scoutChatter = queryRecentMessages(50).map(compactRangerMessage);

  return {
    build: loadOpenScoutBuildInfo(currentDirectory),
    agents: queryAgents(40)
      .filter((agent) => !isRangerLikeAgentRecord(agent))
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
      activeAsks: fleet.activeAsks.slice(0, 12).map(compactRangerFleetAsk),
      needsAttention: fleet.needsAttention.slice(0, 12).map(compactRangerFleetAttention),
      recentCompleted: fleet.recentCompleted.slice(0, 8).map(compactRangerFleetAsk),
      activity: fleet.activity.slice(0, 12).map(compactRangerActivity),
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
      failedQueries: broker.failedQueries.slice(0, 8).map(compactRangerRouteAttempt),
      failedDeliveries: broker.failedDeliveries.slice(0, 8).map(compactRangerRouteAttempt),
      attempts: broker.attempts.slice(0, 12).map(compactRangerRouteAttempt),
      dialogue: broker.dialogue.slice(0, 12).map(compactRangerDialogue),
    },
    activeWork: queryWorkItems({ activeOnly: true, limit: 20 }).map(compactRangerWorkItem),
    activeRuns: queryRuns({ active: true, limit: 24 }),
    activeFlights: queryFlights({ activeOnly: true }).slice(0, 24),
    sessions: querySessions(24),
    recentMessages: scoutChatter.slice(0, 16),
    recentActivity: queryActivity(16).map(compactRangerActivity),
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
            command: compactRangerText(p.command, 140),
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

function compactRangerFleetAsk(ask: ReturnType<typeof queryFleet>["activeAsks"][number]) {
  return {
    invocationId: ask.invocationId,
    flightId: ask.flightId,
    agentId: ask.agentId,
    agentName: ask.agentName,
    conversationId: ask.conversationId,
    task: compactRangerText(ask.task, 260),
    status: ask.status,
    statusLabel: ask.statusLabel,
    attention: ask.attention,
    summary: compactRangerText(ask.summary, 260),
    startedAt: ask.startedAt,
    completedAt: ask.completedAt,
    updatedAt: ask.updatedAt,
  };
}

function compactRangerFleetAttention(item: ReturnType<typeof queryFleet>["needsAttention"][number]) {
  return {
    kind: item.kind,
    recordId: item.recordId,
    title: compactRangerText(item.title, 180),
    summary: compactRangerText(item.summary, 260),
    agentId: item.agentId,
    agentName: item.agentName,
    conversationId: item.conversationId,
    state: item.state,
    acceptanceState: item.acceptanceState,
    updatedAt: item.updatedAt,
  };
}

function compactRangerActivity(item: ReturnType<typeof queryActivity>[number]) {
  return {
    id: item.id,
    kind: item.kind,
    ts: item.ts,
    actorName: item.actorName,
    title: compactRangerText(item.title, 180),
    summary: compactRangerText(item.summary, 260),
    conversationId: item.conversationId,
    workspaceRoot: item.workspaceRoot,
  };
}

function compactRangerRouteAttempt(attempt: ReturnType<typeof queryBrokerDiagnostics>["attempts"][number]) {
  return {
    id: attempt.id,
    kind: attempt.kind,
    status: attempt.status,
    ts: attempt.ts,
    actorName: attempt.actorName,
    target: attempt.target,
    route: attempt.route,
    detail: compactRangerText(attempt.detail, 320),
    conversationId: attempt.conversationId,
    messageId: attempt.messageId,
    deliveryId: attempt.deliveryId,
    invocationId: attempt.invocationId,
  };
}

function compactRangerDialogue(item: ReturnType<typeof queryBrokerDiagnostics>["dialogue"][number]) {
  return {
    id: item.id,
    ts: item.ts,
    actorName: item.actorName,
    conversationId: item.conversationId,
    body: compactRangerText(item.body, 320),
    class: item.class,
  };
}

function compactRangerWorkItem(item: ReturnType<typeof queryWorkItems>[number]) {
  return {
    id: item.id,
    title: compactRangerText(item.title, 180),
    summary: compactRangerText(item.summary, 260),
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
    lastMeaningfulSummary: compactRangerText(item.lastMeaningfulSummary, 260),
  };
}

function compactRangerMessage(message: ReturnType<typeof queryRecentMessages>[number]) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    actorName: message.actorName,
    body: compactRangerText(message.body, 320),
    createdAt: message.createdAt,
    class: message.class,
  };
}

function compactRangerTailEvent(event: ReturnType<typeof snapshotRecentEvents>[number]) {
  return {
    id: event.id,
    ts: event.ts,
    source: event.source,
    sessionId: event.sessionId,
    project: event.project,
    cwd: event.cwd,
    harness: event.harness,
    kind: event.kind,
    summary: compactRangerText(event.summary, 360),
  };
}

async function valueOrNull<T>(value: Promise<T> | T): Promise<T | null> {
  try {
    return await value;
  } catch {
    return null;
  }
}

function isRangerLikeAgentRecord(agent: { id: string; name: string; handle: string | null; role: string | null }): boolean {
  return [agent.id, agent.name, agent.handle ?? "", agent.role ?? ""]
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === "ranger" || value.startsWith("ranger.") || value.includes(".ranger."));
}

function previewSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 10) {
    return "configured";
  }
  return `${trimmed.slice(0, 5)}...${trimmed.slice(-4)}`;
}

async function resolveRangerCredentialState(
  rangerCredentials: ReturnType<typeof createRangerCredentialStore>,
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
  const storeKey = rangerCredentials.getOpenAIKey()?.trim() ?? "";
  const key = envKey || configKey || storeKey;
  return {
    openai: {
      configured: Boolean(key),
      source: envKey ? "env" : configKey ? "local-config" : storeKey ? "local-store" : "missing",
      preview: key ? previewSecret(key) : null,
    },
  };
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
      defaultTransport: settings?.agents.defaultTransport ?? "claude_stream_json",
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

export async function createOpenScoutWebServer(
  options: CreateOpenScoutWebServerOptions,
): Promise<OpenScoutWebServer> {
  const shellTtl = options.shellStateCacheTtlMs ?? 15_000;
  const currentDirectory = options.currentDirectory;
  const routes = resolveOpenScoutWebRoutes(process.env);
  ensureOpenScoutVoxOrigins();
  startGlobalHeuristicsWatcher();
  const app = new Hono();
  const shellStateCache = createCachedSnapshot<OpenScoutWebShellState>(
    loadOpenScoutWebShellState,
    shellTtl,
  );
  const rangerReminders = createRangerReminderStore();
  const rangerCredentials = createRangerCredentialStore();
  const rangerAssistant = createRangerAssistantService({
    currentDirectory,
    loadContext: async () => ({
      ...(await buildRangerAssistantControlState(currentDirectory)),
      reminders: rangerReminders.getState(),
    }),
    resolveApiKey: async () => {
      const config = await loadScoutRelayConfig().catch(() => null);
      return config?.openaiApiKey ?? rangerCredentials.getOpenAIKey();
    },
  });
  let fleetHomeBrief: FleetHomeBrief | null = null;
  let fleetHomeBriefInFlight: Promise<FleetHomeBrief> | null = null;
  const loadFleetHomeBrief = async (force = false): Promise<FleetHomeBrief> => {
    const now = Date.now();
    if (!force && fleetHomeBrief && fleetHomeBrief.expiresAt > now) {
      return fleetHomeBrief;
    }
    if (!force && fleetHomeBriefInFlight) {
      return fleetHomeBriefInFlight;
    }
    let captured: RangerBriefCapture | null = null;
    fleetHomeBriefInFlight = rangerAssistant.createBrief({
      route: { view: "fleet" },
      ttlMs: FLEET_HOME_BRIEF_TTL_MS,
      mode: "fleet-home",
      onCaptured: (c) => { captured = c; },
    })
      .then((rangerBrief) => {
        if (captured) persistBriefing("fleet-home", rangerBrief, captured);
        return buildFleetHomeBrief(rangerBrief);
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
  app.get("/api/ranger/session", (c) => c.json(rangerAssistant.getSessionState()));
  app.post("/api/ranger/session/reset", (c) => c.json(rangerAssistant.resetSession()));
  app.post("/api/ranger/session/switch", async (c) => {
    const body = await c.req.json<{ id?: unknown }>().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return c.json({ error: "id is required" }, 400);
    }
    try {
      return c.json(rangerAssistant.switchSession(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ranger switch failed";
      const status = error instanceof RangerAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 404 | 500);
    }
  });
  app.post("/api/ranger/session/archive", async (c) => {
    const body = await c.req.json<{ id?: unknown }>().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return c.json({ error: "id is required" }, 400);
    }
    try {
      return c.json(rangerAssistant.archiveSession(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ranger archive failed";
      const status = error instanceof RangerAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 404 | 500);
    }
  });
  app.get("/api/ranger/reminders", (c) => c.json(rangerReminders.getState()));
  app.post("/api/ranger/reminders", async (c) => {
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
      return c.json(rangerReminders.create(body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ranger reminder failed";
      const status = error instanceof RangerReminderError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 404 | 500);
    }
  });
  app.post("/api/ranger/reminders/:id/dismiss", (c) => {
    try {
      return c.json(rangerReminders.dismiss(c.req.param("id")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ranger reminder failed";
      const status = error instanceof RangerReminderError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 404 | 500);
    }
  });
  app.get("/api/ranger/config", (c) => c.json(rangerAssistant.getConfig()));
  app.post("/api/ranger/config", async (c) => {
    const body = await c.req.json<{
      model?: string | null;
      systemPrompt?: string | null;
    }>().catch(() => ({}));
    return c.json({
      config: rangerAssistant.updateConfig({
        model: body.model,
        systemPrompt: body.systemPrompt,
      }),
    });
  });
  app.get("/api/ranger/credentials", async (c) => {
    return c.json(await resolveRangerCredentialState(rangerCredentials));
  });
  app.post("/api/ranger/credentials/openai", async (c) => {
    const body = await c.req.json<{ apiKey?: unknown }>().catch(() => ({}));
    try {
      if (typeof body.apiKey !== "string") {
        return c.json({ error: "apiKey is required" }, 400);
      }
      rangerCredentials.setOpenAIKey(body.apiKey);
      return c.json(await resolveRangerCredentialState(rangerCredentials));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save OpenAI API key.";
      return c.json({ error: message }, 400);
    }
  });
  app.delete("/api/ranger/credentials/openai", async (c) => {
    rangerCredentials.deleteOpenAIKey();
    return c.json(await resolveRangerCredentialState(rangerCredentials));
  });
  app.post("/api/ranger/chat", async (c) => {
    const body = await c.req.json<{
      body?: string;
      route?: unknown;
    }>().catch(() => ({}));

    try {
      return c.json(await rangerAssistant.respond({
        body: body.body ?? "",
        route: body.route,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ranger assistant failed";
      const status = error instanceof RangerAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 500 | 502 | 503);
    }
  });
  app.post("/api/ranger/actions/ask", async (c) => {
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
  app.post("/api/ranger/brief", async (c) => {
    const body = await c.req.json<{
      route?: unknown;
      ttlMs?: number | null;
    }>().catch(() => ({}));

    try {
      let captured: RangerBriefCapture | null = null;
      const brief = await rangerAssistant.createBrief({
        route: body.route,
        ttlMs: body.ttlMs,
        onCaptured: (cap) => { captured = cap; },
      });
      if (captured) persistBriefing("tour", brief, captured);
      return c.json(brief);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ranger brief failed";
      const status = error instanceof RangerAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 500 | 502 | 503);
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
  app.get("/api/agents", (c) => c.json(queryAgents()));
  app.get("/api/agents/:id", (c) => {
    const agent = queryAgentById(c.req.param("id"));
    return agent ? c.json(agent) : c.json({ error: "agent not found" }, 404);
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
  app.get("/api/agents/:id/session-catalog", (c) => {
    const agentId = c.req.param("id");
    const agents = queryAgents();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return c.json(emptyAgentSessionCatalogPayload(agentId));
    const cwd = agent.cwd ?? agent.projectRoot ?? ".";
    return c.json(buildAgentSessionCatalogPayload({ agentId, harness: agent.harness, cwd }));
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
    const res = await fetch(url);
    if (!res.ok) {
      return c.json({ error: `broker topology unavailable (${res.status})` }, 502);
    }
    return c.json(await res.json());
  });
  app.get("/api/broker", (c) =>
    c.json(
      queryBrokerDiagnostics({
        limit: parseOptionalPositiveInt(c.req.query("limit"), 120),
        windowMs: parseOptionalPositiveInt(c.req.query("windowMs")),
      }),
    ),
  );
  app.get("/api/heartrate", (c) => c.json(queryHeartrate()));
  app.get("/api/service-budgets", async (c) => c.json(await loadServiceBudgets()));
  app.get("/api/fleet/brief", async (c) => {
    try {
      const refresh = c.req.query("refresh");
      return c.json(await loadFleetHomeBrief(refresh === "1" || refresh === "true"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fleet brief failed";
      const status = error instanceof RangerAssistantError ? error.status : 500;
      return c.json({ error: message }, status as 400 | 500 | 502 | 503);
    }
  });
  app.get("/api/fleet", (c) =>
    c.json(
      queryFleet({
        limit: parseOptionalPositiveInt(c.req.query("limit")),
        activityLimit: parseOptionalPositiveInt(c.req.query("activityLimit")),
      }),
    ),
  );
  app.get("/api/messages", (c) =>
    c.json(
      queryRecentMessages(
        parseOptionalPositiveInt(c.req.query("limit"), 80) ?? 80,
        { conversationId: c.req.query("conversationId") || undefined },
      ),
    ),
  );
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
  const handleListWork = (c: Context) => {
    const agentId = c.req.query("agentId");
    const activeOnly = c.req.query("active") !== "false";
    const rawLimit = Number(c.req.query("limit"));
    const limit = Number.isFinite(rawLimit)
      ? Math.min(250, Math.max(1, Math.floor(rawLimit)))
      : undefined;
    return c.json(
      queryWorkItems({
        agentId: agentId || undefined,
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
  app.get("/api/work", handleListWork);
  app.get("/api/tasks", handleListWork);
  app.get("/api/work/:id", handleWorkDetail);
  app.get("/api/work/:id/inventory", handleWorkInventory);
  app.get("/api/work/:id/material", handleWorkMaterialContent);
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
  app.get("/api/conversations", async (c) => {
    const rawLimit = Number(c.req.query("limit"));
    const rawKinds = c.req.query("kinds")?.trim();
    return c.json(await getScoutConversations({
      query: c.req.query("query") || undefined,
      limit: Number.isFinite(rawLimit) ? Math.min(250, Math.max(1, Math.floor(rawLimit))) : undefined,
      kinds: parseConversationKinds(rawKinds),
    }));
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
    const existing = queryConversationDefinitionById(conversationId);
    if (!existing) return null;
    const nextParticipants = mutate(existing.participantIds);
    await upsertScoutConversation({
      id: existing.id,
      kind: existing.kind as ConversationDefinition["kind"],
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
    return nextParticipants;
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
    return c.json({ ok: true, participantIds: next });
  });

  app.delete("/api/conversations/:id/members/:actorId", async (c) => {
    const conversationId = c.req.param("id");
    const actorId = c.req.param("actorId");
    const next = await writeConversationMembers(conversationId, (current) =>
      current.filter((id) => id !== actorId),
    );
    if (!next) return c.json({ error: "conversation not found" }, 404);
    return c.json({ ok: true, participantIds: next });
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

      const brokerUrl = `http://${ip}:65535`;
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
    const hasLocalConfig = localConfigExists();
    const settings = await readOpenScoutSettings({ currentDirectory }).catch(() => null);
    const configuredContextRoot = settings?.discovery.contextRoot ?? null;
    const projectRoot = await findNearestProjectRoot(currentDirectory).catch(() => null)
      ?? await findNearestProjectRoot(configuredContextRoot ?? "").catch(() => null);
    const hasProjectConfig = projectRoot !== null;
    const userName = loadUserConfig().name?.trim() ?? "";
    return c.json({
      hasLocalConfig,
      hasProjectConfig,
      hasOperatorName: userName.length > 0,
      localConfigPath: localConfigPath(),
      localConfig: hasLocalConfig ? loadLocalConfig() : null,
      projectRoot,
      currentDirectory,
      contextRoot: configuredContextRoot,
      operatorName: userName || null,
      operatorNameSuggestion: resolveOperatorName(),
    });
  });

  app.delete("/api/onboarding/state", (c) => {
    try {
      rmSync(localConfigPath(), { force: true });
    } catch {
      /* already absent */
    }
    return c.json({ ok: true, localConfigPath: localConfigPath() });
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
      await writeOpenScoutSettings({
        discovery: {
          contextRoot,
          workspaceRoots: sourceRoots,
        },
        agents: { defaultHarness: harness },
      });

      const result = await initializeOpenScoutSetup({
        currentDirectory: contextRoot,
      });
      return c.json({
        ok: true,
        projectConfigPath: result.currentProjectConfigPath,
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
    writeLocalConfig({
      version: 1,
      host: body.host ?? DEFAULT_LOCAL_CONFIG.host,
      ports: {
        broker: body.ports?.broker ?? DEFAULT_LOCAL_CONFIG.ports.broker,
        web: body.ports?.web ?? DEFAULT_LOCAL_CONFIG.ports.web,
        pairing: body.ports?.pairing ?? DEFAULT_LOCAL_CONFIG.ports.pairing,
      },
    });
    return c.json({
      ok: true,
      localConfig: loadLocalConfig(),
      localConfigPath: localConfigPath(),
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

  app.post("/api/send", async (c) => {
    const { body, conversationId } = (await c.req.json()) as {
      body: string;
      conversationId?: string;
    };
    if (!body?.trim()) {
      return c.json({ error: "body is required" }, 400);
    }

    const { directAgentId, channel, conversationId: routedConversationId, senderId } =
      resolveConversationRouting(conversationId);

    if (directAgentId) {
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
      currentDirectory,
    });

    if (!result.usedBroker) {
      return c.json({ error: "broker unreachable" }, 502);
    }

    return c.json(result);
  });

  app.post("/api/ask", async (c) => {
    const { body, conversationId } = (await c.req.json()) as {
      body: string;
      conversationId?: string;
    };
    if (!body?.trim()) {
      return c.json({ error: "body is required" }, 400);
    }

    const { directAgentId, senderId } =
      resolveConversationRouting(conversationId);
    if (!directAgentId) {
      return c.json(
        {
          error:
            "ask is only available in a direct conversation with one agent",
        },
        400,
      );
    }

    const result = await askScoutQuestion({
      senderId,
      targetLabel: directAgentId,
      targetAgentId: directAgentId,
      body: body.trim(),
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
    const speechTiming = parseVoxSpeechTimingRequest(body.speechTiming);
    if (speechTiming === null) {
      return c.json({ error: "speechTiming is invalid" }, 400);
    }

    try {
      return c.json(await synthesizeVoxSpeech({
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
      const message = error instanceof Error ? error.message : "Vox speech failed";
      return c.json({ error: message }, 503);
    }
  });

  app.get("/api/voice/defaults", (c) => {
    return c.json(resolveVoxSpeechDefaults());
  });

  // Dev-only: serve generated Ranger FX fixtures for /dev/ranger-fx lab.
  // Fixtures are produced by packages/web/scripts/generate-ranger-fx-fixtures.mjs
  // and live in packages/web/dev/ranger-fx-fixtures/ (gitignored).
  if (process.env.NODE_ENV !== "production") {
    const fixturesRoot = join(process.cwd(), "dev", "ranger-fx-fixtures");

    app.get("/api/dev/ranger-fx/fixtures", (c) => {
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

    app.get("/api/dev/ranger-fx/audio/:name", (c) => {
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
    const brokerHost = process.env.OPENSCOUT_BROKER_HOST ?? "127.0.0.1";
    const brokerPort = process.env.OPENSCOUT_BROKER_PORT ?? "65535";
    const brokerUrl =
      process.env.OPENSCOUT_BROKER_URL ?? `http://${brokerHost}:${brokerPort}`;
    try {
      return await relayEventStream(`${brokerUrl}/v1/events/stream`, {
        signal: c.req.raw.signal,
      });
    } catch {
      return c.text("Broker unreachable", 502);
    }
  });

  app.get("/api/tail/discover", async (c) => {
    const force = c.req.query("force") === "true";
    const snapshot = await getTailDiscovery(force);
    return c.json(snapshot);
  });

  app.get("/api/tail/recent", async (c) => {
    const limitParam = parseOptionalPositiveInt(c.req.query("limit"), 500) ?? 500;
    const bufferedEvents = snapshotRecentEvents(limitParam);
    if (c.req.query("transcripts") !== "true") {
      return c.json({ events: bufferedEvents });
    }
    const transcriptEvents = await readRecentTranscriptEvents(limitParam, {
      perTranscriptLineLimit: Math.min(200, Math.max(50, limitParam)),
    });
    const eventsById = new Map<string, (typeof bufferedEvents)[number]>();
    for (const event of transcriptEvents) {
      eventsById.set(event.id, event);
    }
    for (const event of bufferedEvents) {
      eventsById.set(event.id, event);
    }
    const events = [...eventsById.values()]
      .sort((left, right) => right.ts - left.ts)
      .slice(0, limitParam);
    return c.json({ events });
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

  await registerScoutWebAssets(app, {
    assetMode: options.assetMode,
    staticRoot: resolveStaticRoot(options.staticRoot),
    viteDevUrl: options.viteDevUrl,
    defaultViteUrl: "http://127.0.0.1:5180",
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

  return { app, warmupCaches };
}
