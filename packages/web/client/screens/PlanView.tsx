import "./plan-view.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor } from "../lib/colors.ts";
import { timeAgo } from "../lib/time.ts";
import { conversationForAgent } from "../lib/router.ts";
import type {
  Agent,
  FleetAsk,
  FleetAttentionItem,
  FleetState,
  MissionNodeState,
  Route,
  WorkItem,
} from "../lib/types.ts";

const STATE_META: Record<
  MissionNodeState,
  { label: string; icon: string; color: string }
> = {
  proposed: { label: "PROPOSED", icon: "◌", color: "var(--dim)" },
  committed: { label: "COMMITTED", icon: "◐", color: "var(--accent)" },
  inflight: { label: "IN FLIGHT", icon: "◉", color: "var(--green)" },
  done: { label: "DONE", icon: "●", color: "var(--muted)" },
  stuck: { label: "STUCK", icon: "▲", color: "var(--amber)" },
};

type PlanNode = {
  id: string;
  kind: "mission" | "phase" | "task";
  title: string;
  summary: string | null;
  state: MissionNodeState;
  assigneeId: string | null;
  detail: string | null;
  why: string | null;
  progress: number | null;
  stuckMins: number | null;
  updatedAt: number | null;
  route: Route | null;
  badge?: string | null;
  children?: PlanNode[];
};

type OpsRisk = {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "med" | "low";
};

type PlanFilter = "ongoing" | "recent" | "all";

type PlanRecordStatus = "blocked" | "active" | "queued" | "complete" | "needs_review";

type CompletionEvaluation = {
  state: "not_started" | "in_progress" | "blocked" | "needs_review" | "verified";
  label: string;
  summary: string;
  detail: string;
};

type PlanLoadStatus = "loading" | "ready";

type PlanRecord = {
  id: string;
  source: "work" | "ask";
  title: string;
  summary: string | null;
  status: PlanRecordStatus;
  createdAt: number;
  updatedAt: number;
  ownerId: string | null;
  ownerName: string | null;
  harnesses: string[];
  root: PlanNode;
  leafNodes: PlanNode[];
  route: Route | null;
  completion: CompletionEvaluation;
};

function flattenTree(root: PlanNode): PlanNode[] {
  const out = [root];
  if (root.children) root.children.forEach((child) => out.push(...flattenTree(child)));
  return out;
}

function findNode(root: PlanNode, id: string): PlanNode | null {
  if (root.id === id) return root;
  if (!root.children) return null;
  for (const child of root.children) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return null;
}

function countAssigned(root: PlanNode, agentId: string): number {
  return flattenTree(root).filter(
    (node) => node.kind === "task" && node.assigneeId === agentId,
  ).length;
}

function progressForState(state: MissionNodeState): number {
  switch (state) {
    case "done":
      return 1;
    case "inflight":
      return 0.7;
    case "committed":
      return 0.32;
    case "stuck":
      return 0.18;
    default:
      return 0.1;
  }
}

function phaseLabel(work: WorkItem): string {
  const phase = work.currentPhase || work.state;
  return phase.replace(/\s+/g, " ");
}

function workNodeState(work: WorkItem): MissionNodeState {
  if (work.state === "done") return "done";
  if (work.attention === "interrupt") return "stuck";
  if (
    work.attention === "badge" ||
    work.state === "waiting" ||
    work.state === "review"
  ) {
    return "stuck";
  }
  if (
    work.state === "working" ||
    work.activeFlightCount > 0 ||
    work.currentPhase === "Working" ||
    work.currentPhase === "Waking"
  ) {
    return "inflight";
  }
  return "committed";
}

function askNodeState(ask: FleetAsk): MissionNodeState {
  switch (ask.status) {
    case "working":
      return "inflight";
    case "completed":
      return "done";
    case "needs_attention":
    case "failed":
      return "stuck";
    default:
      return "committed";
  }
}

function minutesSince(ts: number | null, nowMs: number): number | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((nowMs - ts) / 60_000));
}

function routeForAttention(item: FleetAttentionItem): Route | null {
  if (item.recordId) {
    return { view: "work", workId: item.recordId };
  }
  if (item.conversationId) {
    return { view: "conversation", conversationId: item.conversationId };
  }
  if (item.agentId) {
    return { view: "agents", agentId: item.agentId };
  }
  return null;
}

function routeForAsk(ask: FleetAsk): Route | null {
  if (ask.conversationId) {
    return { view: "conversation", conversationId: ask.conversationId };
  }
  if (ask.collaborationRecordId) {
    return { view: "work", workId: ask.collaborationRecordId };
  }
  return { view: "agents", agentId: ask.agentId };
}

function buildNodeFromWork(work: WorkItem, nowMs: number): PlanNode {
  const state = workNodeState(work);
  const detail = work.lastMeaningfulSummary ?? work.summary ?? null;
  return {
    id: `work:${work.id}`,
    kind: "task",
    title: work.title,
    summary: work.summary ?? work.lastMeaningfulSummary ?? null,
    state,
    assigneeId: work.ownerId ?? work.nextMoveOwnerId,
    detail,
    why: work.summary ?? `Current phase: ${phaseLabel(work)}`,
    progress: progressForState(state),
    stuckMins: state === "stuck" ? minutesSince(work.lastMeaningfulAt, nowMs) : null,
    updatedAt: work.lastMeaningfulAt,
    route: { view: "work", workId: work.id },
  };
}

function buildNodeFromAsk(ask: FleetAsk, nowMs: number): PlanNode {
  const state = askNodeState(ask);
  return {
    id: `ask:${ask.invocationId}`,
    kind: "task",
    title: ask.task,
    summary: ask.summary,
    state,
    assigneeId: ask.agentId,
    detail: ask.summary ?? ask.statusLabel,
    why: `Ask status: ${ask.statusLabel}`,
    progress: progressForState(state),
    stuckMins: state === "stuck" ? minutesSince(ask.updatedAt, nowMs) : null,
    updatedAt: ask.updatedAt,
    route: routeForAsk(ask),
  };
}

function buildRisks(
  attentionItems: FleetAttentionItem[],
  activeAsks: FleetAsk[],
  workItems: WorkItem[],
): OpsRisk[] {
  const risks: OpsRisk[] = [];

  for (const item of attentionItems.slice(0, 4)) {
    risks.push({
      id: `risk:attention:${item.recordId}`,
      title: item.title,
      detail: item.summary
        ?? (item.kind === "question"
          ? "Waiting on an answer or decision."
          : "Waiting on the next operator move."),
      severity: item.kind === "question" ? "high" : "med",
    });
  }

  for (const work of workItems) {
    if (risks.length >= 4) break;
    if (work.attention === "interrupt") {
      risks.push({
        id: `risk:work:${work.id}`,
        title: work.title,
        detail: work.lastMeaningfulSummary ?? "Latest flight failed or the work item is blocked.",
        severity: "high",
      });
    }
  }

  for (const ask of activeAsks) {
    if (risks.length >= 4) break;
    if (ask.status === "failed") {
      risks.push({
        id: `risk:ask:${ask.invocationId}`,
        title: ask.task,
        detail: ask.summary ?? "The delegated ask reported a failure state.",
        severity: "high",
      });
    }
  }

  return risks;
}

const RECENT_PLAN_WINDOW_MS = 7 * 24 * 60 * 60_000;
const COMPLETION_REVIEW_WINDOW_MS = 12 * 60 * 60_000;

const PLAN_STATUS_META: Record<PlanRecordStatus, { label: string; color: string }> = {
  blocked: { label: "Blocked", color: "var(--amber)" },
  active: { label: "Active", color: "var(--green)" },
  queued: { label: "Queued", color: "var(--accent)" },
  complete: { label: "Complete", color: "var(--muted)" },
  needs_review: { label: "Review", color: "var(--amber)" },
};

function isTerminalWorkState(state: string): boolean {
  return state === "done" || state === "cancelled";
}

function workStatus(work: WorkItem, descendants: WorkItem[]): PlanRecordStatus {
  const items = [work, ...descendants];
  if (items.some((item) => item.attention !== "silent" || item.state === "waiting" || item.state === "review")) {
    return "blocked";
  }
  if (items.some((item) => item.state === "working" || item.activeFlightCount > 0)) {
    return "active";
  }
  if (items.every((item) => isTerminalWorkState(item.state))) {
    return work.acceptanceState === "pending" ? "needs_review" : "complete";
  }
  return "queued";
}

function askStatus(ask: FleetAsk): PlanRecordStatus {
  if (ask.status === "failed" || ask.status === "needs_attention") return "blocked";
  if (ask.status === "working") return "active";
  if (ask.status === "queued") return "queued";
  return "needs_review";
}

function completionForWork(work: WorkItem, descendants: WorkItem[], nowMs: number): CompletionEvaluation {
  const items = [work, ...descendants];
  const latestAt = Math.max(...items.map((item) => item.lastMeaningfulAt || item.updatedAt || item.createdAt));
  const hasBlocked = items.some((item) => item.attention !== "silent" || item.state === "waiting" || item.state === "review");
  const hasActive = items.some((item) => item.state === "working" || item.activeFlightCount > 0);
  const allDone = items.every((item) => item.state === "done");
  const hasQueued = items.some((item) => item.state === "open");

  if (hasBlocked) {
    return {
      state: "blocked",
      label: "Needs operator check",
      summary: "A child item is waiting, in review, or marked for attention.",
      detail: "Completion cannot be trusted until the blocking state is resolved.",
    };
  }
  if (hasActive) {
    return {
      state: "in_progress",
      label: "Still moving",
      summary: "At least one item or flight is still active.",
      detail: "The plan should stay in the ongoing set.",
    };
  }
  if (allDone) {
    const stale = nowMs - latestAt > COMPLETION_REVIEW_WINDOW_MS;
    return stale
      ? {
          state: "needs_review",
          label: "Done, needs freshness check",
          summary: "The plan is marked done, but the last meaningful update is no longer fresh.",
          detail: "Ask the owner to confirm whether the completion state is still accurate.",
        }
      : {
          state: "verified",
          label: "Recently completed",
          summary: "All visible items are marked done with a recent meaningful update.",
          detail: "This looks current from the available collaboration state.",
        };
  }
  if (hasQueued) {
    return {
      state: "not_started",
      label: "Queued",
      summary: "The plan has open work but no active execution signal yet.",
      detail: "It is ready to be picked up or clarified.",
    };
  }
  return {
    state: "needs_review",
    label: "Needs review",
    summary: "The plan is in a terminal or quiet state without enough signal to verify completion.",
    detail: "Use the owner review path before treating this as closed.",
  };
}

function completionForAsk(ask: FleetAsk, nowMs: number): CompletionEvaluation {
  if (ask.status === "failed" || ask.status === "needs_attention") {
    return {
      state: "blocked",
      label: "Needs operator check",
      summary: ask.summary ?? "The ask is blocked or failed.",
      detail: "Completion cannot be trusted until the ask is resolved.",
    };
  }
  if (ask.status === "queued" || ask.status === "working") {
    return {
      state: "in_progress",
      label: ask.status === "queued" ? "Queued" : "Still moving",
      summary: ask.summary ?? ask.task,
      detail: "The ask has not reported a terminal result yet.",
    };
  }
  const updatedAt = ask.completedAt ?? ask.updatedAt;
  return nowMs - updatedAt > COMPLETION_REVIEW_WINDOW_MS
    ? {
        state: "needs_review",
        label: "Completed, needs freshness check",
        summary: ask.summary ?? ask.task,
        detail: "The completion is older than the review window.",
      }
    : {
        state: "verified",
        label: "Recently completed",
        summary: ask.summary ?? ask.task,
        detail: "The ask completed recently.",
      };
}

function collectDescendants(work: WorkItem, childrenByParent: Map<string, WorkItem[]>): WorkItem[] {
  const children = childrenByParent.get(work.id) ?? [];
  return children.flatMap((child) => [child, ...collectDescendants(child, childrenByParent)]);
}

function buildWorkTree(work: WorkItem, childrenByParent: Map<string, WorkItem[]>, nowMs: number): PlanNode {
  const children = (childrenByParent.get(work.id) ?? [])
    .sort((left, right) => right.lastMeaningfulAt - left.lastMeaningfulAt)
    .map((child) => buildWorkTree(child, childrenByParent, nowMs));
  const node = buildNodeFromWork(work, nowMs);
  return {
    ...node,
    children: children.length > 0 ? children : undefined,
  };
}

function nodeProgressAverage(nodes: PlanNode[]): number {
  const values = nodes.map((node) => node.progress).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function harnessesForWork(items: WorkItem[], agentsById: Record<string, Agent>): string[] {
  const harnesses = new Set<string>();
  for (const item of items) {
    const owner = item.ownerId ? agentsById[item.ownerId] : null;
    const next = item.nextMoveOwnerId ? agentsById[item.nextMoveOwnerId] : null;
    if (owner?.harness) harnesses.add(owner.harness);
    if (next?.harness) harnesses.add(next.harness);
  }
  return [...harnesses].sort();
}

function buildWorkPlanRecord(
  work: WorkItem,
  childrenByParent: Map<string, WorkItem[]>,
  agentsById: Record<string, Agent>,
  nowMs: number,
): PlanRecord {
  const descendants = collectDescendants(work, childrenByParent);
  const tree = buildWorkTree(work, childrenByParent, nowMs);
  const leafNodes = flattenTree(tree).filter((node) => node.kind === "task");
  const status = workStatus(work, descendants);
  const completion = completionForWork(work, descendants, nowMs);
  const rootChildren = tree.children && tree.children.length > 0 ? tree.children : [tree];
  const root: PlanNode = {
    ...tree,
    id: `plan:${work.id}`,
    kind: "mission",
    badge: `${leafNodes.length} item${leafNodes.length === 1 ? "" : "s"}`,
    progress: leafNodes.length > 0 ? nodeProgressAverage(leafNodes) : tree.progress,
    children: rootChildren,
  };
  const allItems = [work, ...descendants];
  return {
    id: `work:${work.id}`,
    source: "work",
    title: work.title,
    summary: work.summary ?? work.lastMeaningfulSummary,
    status,
    createdAt: work.createdAt,
    updatedAt: Math.max(...allItems.map((item) => item.lastMeaningfulAt || item.updatedAt || item.createdAt)),
    ownerId: work.ownerId ?? work.nextMoveOwnerId,
    ownerName: work.ownerName ?? work.nextMoveOwnerName,
    harnesses: harnessesForWork(allItems, agentsById),
    root,
    leafNodes,
    route: { view: "work", workId: work.id },
    completion,
  };
}

function buildAskPlanRecord(ask: FleetAsk, nowMs: number): PlanRecord {
  const node = buildNodeFromAsk(ask, nowMs);
  const root: PlanNode = {
    ...node,
    id: `plan:ask:${ask.invocationId}`,
    kind: "mission",
    badge: ask.statusLabel,
    children: [node],
  };
  return {
    id: `ask:${ask.invocationId}`,
    source: "ask",
    title: ask.task,
    summary: ask.summary,
    status: askStatus(ask),
    createdAt: ask.startedAt ?? ask.updatedAt,
    updatedAt: ask.updatedAt,
    ownerId: ask.agentId,
    ownerName: ask.agentName ?? ask.agentId,
    harnesses: ask.harness ? [ask.harness] : [],
    root,
    leafNodes: [node],
    route: routeForAsk(ask),
    completion: completionForAsk(ask, nowMs),
  };
}

function formatReviewTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function completionReviewDraft(record: PlanRecord): string {
  const visibleItems = record.leafNodes
    .slice(0, 6)
    .map((node) => `- ${STATE_META[node.state].label}: ${node.title}`)
    .join("\n");
  const remaining = record.leafNodes.length > 6
    ? `\n- ${record.leafNodes.length - 6} more item${record.leafNodes.length - 6 === 1 ? "" : "s"}`
    : "";
  const visibleSection = `${visibleItems || "- No visible child items"}${remaining}`;

  return [
    "Can you evaluate completion for this plan and update the collaboration state if needed?",
    "",
    `Plan: ${record.title}`,
    `Current status: ${PLAN_STATUS_META[record.status].label}`,
    `Completion signal: ${record.completion.label}`,
    `Last visible update: ${formatReviewTimestamp(record.updatedAt)}`,
    "",
    record.completion.summary,
    record.completion.detail,
    "",
    "Visible items:",
    visibleSection,
    "",
    "Please check whether this is actually done, what remains, and whether the plan record is stale.",
  ].join("\n");
}

function mergeWorkItemResults(results: Array<PromiseSettledResult<WorkItem[]>>): WorkItem[] {
  const byId = new Map<string, WorkItem>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

function planMatchesFilter(record: PlanRecord, filter: PlanFilter, nowMs: number): boolean {
  if (filter === "all") return true;
  if (filter === "ongoing") return record.status !== "complete";
  return nowMs - Math.max(record.createdAt, record.updatedAt) <= RECENT_PLAN_WINDOW_MS;
}

function planSort(left: PlanRecord, right: PlanRecord): number {
  const rank: Record<PlanRecordStatus, number> = {
    blocked: 0,
    active: 1,
    queued: 2,
    needs_review: 3,
    complete: 4,
  };
  const byStatus = rank[left.status] - rank[right.status];
  if (byStatus !== 0) return byStatus;
  return right.updatedAt - left.updatedAt;
}

export function PlanView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"plan" | "live">("plan");
  const [filter, setFilter] = useState<PlanFilter>("ongoing");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loadStatus, setLoadStatus] = useState<PlanLoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current;
    const [fleetResult, activeWorkResult, recentWorkResult] = await Promise.allSettled([
      api<FleetState>("/api/fleet"),
      api<WorkItem[]>("/api/work?limit=250"),
      api<WorkItem[]>("/api/work?active=false&limit=250"),
    ]);

    if (requestSeq !== requestSeqRef.current) return;

    if (fleetResult.status === "fulfilled") {
      setFleet(fleetResult.value);
    }
    if (activeWorkResult.status === "fulfilled" || recentWorkResult.status === "fulfilled") {
      setWorkItems(mergeWorkItemResults([activeWorkResult, recentWorkResult]));
    }
    const errors = [
      fleetResult.status === "rejected" ? `fleet: ${fleetResult.reason instanceof Error ? fleetResult.reason.message : String(fleetResult.reason)}` : null,
      activeWorkResult.status === "rejected" ? `active work: ${activeWorkResult.reason instanceof Error ? activeWorkResult.reason.message : String(activeWorkResult.reason)}` : null,
      recentWorkResult.status === "rejected" ? `recent work: ${recentWorkResult.reason instanceof Error ? recentWorkResult.reason.message : String(recentWorkResult.reason)}` : null,
    ].filter((error): error is string => Boolean(error));
    setLoadError(errors.length > 0 ? errors.join(" · ") : null);
    setLoadStatus("ready");
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(intervalId);
  }, []);

  const agentsById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const planData = useMemo(() => {
    const workById = new Map(workItems.map((work) => [work.id, work]));
    const childrenByParent = new Map<string, WorkItem[]>();
    for (const work of workItems) {
      if (work.parentId && workById.has(work.parentId)) {
        const children = childrenByParent.get(work.parentId) ?? [];
        children.push(work);
        childrenByParent.set(work.parentId, children);
      }
    }

    const rootWork = workItems.filter((work) => !work.parentId || !workById.has(work.parentId));
    const workRecords = rootWork.map((work) => buildWorkPlanRecord(work, childrenByParent, agentsById, nowMs));
    const workIds = new Set(workItems.map((work) => work.id));
    const askRecords = [...(fleet?.activeAsks ?? []), ...(fleet?.recentCompleted ?? [])]
      .filter((ask) => !ask.collaborationRecordId || !workIds.has(ask.collaborationRecordId))
      .map((ask) => buildAskPlanRecord(ask, nowMs));
    const records = [...workRecords, ...askRecords].sort(planSort);
    const visibleRecords = records.filter((record) => planMatchesFilter(record, filter, nowMs));
    const harnesses = new Set<string>();
    for (const record of records) {
      record.harnesses.forEach((harness) => harnesses.add(harness));
    }

    return {
      records,
      visibleRecords,
      risks: buildRisks(fleet?.needsAttention ?? [], fleet?.activeAsks ?? [], workItems),
      recentCompleted: (fleet?.recentCompleted ?? []).slice(0, 4),
      pendingAttention: fleet?.needsAttention ?? [],
      harnesses: [...harnesses].sort(),
      counts: {
        ongoing: records.filter((record) => record.status !== "complete").length,
        recent: records.filter((record) => nowMs - Math.max(record.createdAt, record.updatedAt) <= RECENT_PLAN_WINDOW_MS).length,
        review: records.filter((record) => record.completion.state === "needs_review").length,
        blocked: records.filter((record) => record.status === "blocked").length,
      },
    };
  }, [agentsById, filter, fleet, nowMs, workItems]);

  const selectedPlan = useMemo(() => {
    return planData.records.find((record) => record.id === selectedPlanId)
      ?? planData.visibleRecords[0]
      ?? planData.records[0]
      ?? null;
  }, [planData.records, planData.visibleRecords, selectedPlanId]);

  const selectedNode = selected && selectedPlan ? findNode(selectedPlan.root, selected) : null;
  const isInitialLoading = loadStatus === "loading" && planData.records.length === 0;

  useEffect(() => {
    const nextPlanId = planData.visibleRecords[0]?.id ?? planData.records[0]?.id ?? null;
    if (!selectedPlanId || !planData.records.some((record) => record.id === selectedPlanId)) {
      setSelectedPlanId(nextPlanId);
    }
  }, [planData.records, planData.visibleRecords, selectedPlanId]);

  useEffect(() => {
    if (!selectedPlan) {
      if (selected !== null) setSelected(null);
      return;
    }
    if (!selectedNode) {
      setSelected(selectedPlan.root.id);
    }
  }, [selected, selectedNode, selectedPlan]);

  return (
    <div className="s-plan">
      <div className="s-plan-inner s-plan-inner--registry">
        <div className="s-plan-banner">
          <span className="s-plan-banner-badge">
            Plans
          </span>
          <span className="s-plan-banner-meta">
            {isInitialLoading
              ? "loading plan registry..."
              : `${planData.records.length} record${planData.records.length === 1 ? "" : "s"} · ${planData.counts.ongoing} ongoing · ${planData.counts.recent} recent · ${planData.counts.review} review · ${planData.harnesses.length || "no"} harness${planData.harnesses.length === 1 ? "" : "es"}`}
          </span>
          {loadError && (
            <span className="s-plan-banner-meta s-plan-banner-meta--error">
              partial data · {loadError}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {fleet && (
            <span className="s-plan-banner-meta">
              updated {timeAgo(fleet.generatedAt)}
            </span>
          )}
          <button className="s-ops-btn" onClick={() => navigate({ view: "fleet" })}>
            Open fleet
          </button>
          <button className="s-ops-btn" onClick={() => navigate({ view: "sessions" })}>
            Sessions
          </button>
        </div>

        <div className="s-plan-col">
          <div className="s-ops-eyebrow">Plan index</div>
          <div className="s-plan-filterbar">
            {(["ongoing", "recent", "all"] as const).map((nextFilter) => (
              <button
                key={nextFilter}
                type="button"
                className={`s-plan-tree-toggle-btn${filter === nextFilter ? " s-plan-tree-toggle-btn--active" : ""}`}
                onClick={() => setFilter(nextFilter)}
              >
                {nextFilter}
              </button>
            ))}
          </div>
          <div className="s-plan-record-list">
            {planData.visibleRecords.length === 0 ? (
              <div className="s-plan-change-card">
                <div className="s-plan-change-summary">
                  {isInitialLoading
                    ? "Loading plan registry"
                    : loadError && planData.records.length === 0
                      ? "Plan data did not load"
                      : "No matching plan records"}
                </div>
                <div className="s-plan-change-why">
                  {isInitialLoading
                    ? "Fetching collaboration records, active asks, and recent finishes."
                    : loadError && planData.records.length === 0
                      ? loadError
                      : planData.records.length === 0
                    ? "No collaboration records or recent asks are available yet."
                    : "Switch filters to inspect older or completed records."}
                </div>
              </div>
            ) : (
              planData.visibleRecords.map((record) => (
                <PlanRecordButton
                  key={record.id}
                  record={record}
                  selected={record.id === selectedPlan?.id}
                  onSelect={() => {
                    setSelectedPlanId(record.id);
                    setSelected(record.root.id);
                  }}
                />
              ))
            )}
          </div>

          <div className="s-ops-eyebrow" style={{ marginTop: 24 }}>Risks · watch</div>
          {planData.risks.length === 0 ? (
            <div className="s-plan-change-card">
              <div className="s-plan-change-summary">No active blockers</div>
              <div className="s-plan-change-why">
                The queue is clear of explicit questions, failed asks, and blocked work items.
              </div>
            </div>
          ) : (
            planData.risks.map((risk) => (
              <RiskRow key={risk.id} risk={risk} />
            ))
          )}
        </div>

        <div className="s-plan-col" style={{ padding: "20px 16px 40px" }}>
          {selectedPlan && (
            <div className="s-plan-readonly-head">
              <div>
                <div className="s-ops-eyebrow">Read-only plan</div>
                <h1 className="s-plan-title">{selectedPlan.title}</h1>
                <p className="s-plan-goal">{selectedPlan.summary ?? selectedPlan.completion.summary}</p>
              </div>
              <span className="s-ops-state-chip" style={{ color: PLAN_STATUS_META[selectedPlan.status].color }}>
                {PLAN_STATUS_META[selectedPlan.status].label}
              </span>
            </div>
          )}
          <div className="s-plan-tree-header">
            <div className="s-ops-eyebrow" style={{ marginBottom: 0 }}>Execution tree</div>
            <span className="s-plan-tree-stats">
              {selectedPlan?.leafNodes.length ?? 0} item{(selectedPlan?.leafNodes.length ?? 0) === 1 ? "" : "s"} · created {selectedPlan ? timeAgo(selectedPlan.createdAt) : "never"} · updated {selectedPlan ? timeAgo(selectedPlan.updatedAt) : "never"}
            </span>
            <div className="s-plan-tree-toggle">
              {(["plan", "live"] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  className={`s-plan-tree-toggle-btn${mode === nextMode ? " s-plan-tree-toggle-btn--active" : ""}`}
                  onClick={() => setMode(nextMode)}
                >
                  {nextMode}
                </button>
              ))}
            </div>
          </div>

          {selectedPlan ? (
            <TreeNode
              node={selectedPlan.root}
              depth={0}
              mode={mode}
              selected={selected ?? selectedPlan.root.id}
              setSelected={setSelected}
              agentsById={agentsById}
              nowMs={nowMs}
            />
          ) : (
            <div className="s-plan-change-card">
              <div className="s-plan-change-summary">
                {isInitialLoading ? "Loading plan registry" : "No plan records yet"}
              </div>
              <div className="s-plan-change-why">
                {isInitialLoading
                  ? "Resolving the latest collaboration state."
                  : "Collaboration records and asks will appear here as they are created."}
              </div>
            </div>
          )}
        </div>

        <div className="s-plan-col" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {selectedPlan && (
            <CompletionReviewCard
              record={selectedPlan}
              navigate={navigate}
            />
          )}

          {selectedNode && (
            <div>
              <div className="s-ops-eyebrow">Selected node</div>
              <NodeDetail
                node={selectedNode}
                agentsById={agentsById}
                navigate={navigate}
              />
            </div>
          )}

          {selectedPlan && (
            <div>
              <div className="s-ops-eyebrow">Agents on plan</div>
              {agents.filter((agent) => countAssigned(selectedPlan.root, agent.id) > 0).length === 0 ? (
                <div className="s-plan-change-card">
                  <div className="s-plan-change-summary">No assigned owner</div>
                  <div className="s-plan-change-why">
                    This record has no visible owner in the current fleet roster.
                  </div>
                </div>
              ) : (
                agents.map((agent) => {
                  const count = countAssigned(selectedPlan.root, agent.id);
                  if (count === 0) return null;
                  return (
                    <div key={agent.id} className="s-plan-agent-row">
                      <div
                        className="s-ops-avatar"
                        style={{ "--size": "22px", background: actorColor(agent.name) } as React.CSSProperties}
                      >
                        {agent.name[0]?.toUpperCase()}
                      </div>
                      <div className="s-plan-agent-row-copy">
                        <div className="s-plan-agent-row-name">{agent.name}</div>
                        <div className="s-plan-agent-row-tasks">
                          {count} item{count === 1 ? "" : "s"} · {agent.harness ?? "unknown harness"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <div>
            <div className="s-ops-eyebrow">Attention · {planData.pendingAttention.length}</div>
            {planData.pendingAttention.length === 0 ? (
              <div className="s-plan-change-card">
                <div className="s-plan-change-summary">Nothing is waiting on you</div>
                <div className="s-plan-change-why">
                  Questions, reviews, and blocked work items will show up here as soon as operator input is required.
                </div>
              </div>
            ) : (
              planData.pendingAttention.slice(0, 3).map((item) => (
                <AttentionCard
                  key={item.recordId}
                  item={item}
                  navigate={navigate}
                />
              ))
            )}
          </div>

          <div>
            <div className="s-ops-eyebrow">Recent finishes · {planData.recentCompleted.length}</div>
            {planData.recentCompleted.length === 0 ? (
              <div className="s-plan-change-card">
                <div className="s-plan-change-summary">No recent completions</div>
                <div className="s-plan-change-why">
                  Completed asks will land here so you can review what just finished without leaving the plan view.
                </div>
              </div>
            ) : (
              planData.recentCompleted.map((ask) => (
                <CompletedCard key={ask.invocationId} ask={ask} navigate={navigate} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanRecordButton({
  record,
  selected,
  onSelect,
}: {
  record: PlanRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = PLAN_STATUS_META[record.status];
  return (
    <button
      type="button"
      className={`s-plan-record${selected ? " s-plan-record--selected" : ""}`}
      onClick={onSelect}
    >
      <div className="s-plan-record-top">
        <span className="s-plan-change-kind" style={{ color: status.color }}>
          {status.label}
        </span>
        <span className="s-plan-record-source">{record.source}</span>
        <span className="s-plan-record-time">{timeAgo(record.updatedAt)}</span>
      </div>
      <div className="s-plan-record-title">{record.title}</div>
      <div className="s-plan-record-summary">{record.summary ?? record.completion.summary}</div>
      <div className="s-plan-record-foot">
        <span>{record.leafNodes.length} item{record.leafNodes.length === 1 ? "" : "s"}</span>
        <span>{record.ownerName ?? record.ownerId ?? "unassigned"}</span>
        <span>{record.harnesses.length > 0 ? record.harnesses.join(", ") : "unknown harness"}</span>
      </div>
    </button>
  );
}

function CompletionReviewCard({
  record,
  navigate,
}: {
  record: PlanRecord;
  navigate: (route: Route) => void;
}) {
  const stateColor = record.completion.state === "verified"
    ? "var(--green)"
    : record.completion.state === "blocked" || record.completion.state === "needs_review"
      ? "var(--amber)"
      : "var(--accent)";

  return (
    <div className="s-plan-detail s-plan-completion">
      <div className="s-ops-eyebrow">Completion</div>
      <div className="s-plan-detail-header">
        <span className="s-ops-state-chip" style={{ color: stateColor }}>
          {record.completion.label}
        </span>
        <span className="s-plan-record-time">updated {timeAgo(record.updatedAt)}</span>
      </div>
      <div className="s-plan-detail-title">{record.completion.summary}</div>
      <div className="s-plan-detail-why">{record.completion.detail}</div>
      <div className="s-plan-detail-actions">
        {record.route && (
          <button
            className="s-ops-btn s-ops-btn--primary"
            onClick={() => navigate(record.route!)}
          >
            Open editor
          </button>
        )}
        {record.ownerId && (
          <button
            className="s-ops-btn"
            onClick={() =>
              navigate({
                view: "conversation",
                conversationId: conversationForAgent(record.ownerId!),
                composeMode: "ask",
                composeDraft: completionReviewDraft(record),
              })}
          >
            Evaluate with owner
          </button>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  mode,
  selected,
  setSelected,
  agentsById,
  nowMs,
}: {
  node: PlanNode;
  depth: number;
  mode: "plan" | "live";
  selected: string;
  setSelected: (id: string) => void;
  agentsById: Record<string, Agent>;
  nowMs: number;
}) {
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <NodeRow
        node={node}
        depth={depth}
        mode={mode}
        selected={selected === node.id}
        onClick={() => setSelected(node.id)}
        agentsById={agentsById}
        nowMs={nowMs}
      />
      {hasChildren && (
        <div className={depth === 0 ? undefined : "s-plan-node-children"}>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              mode={mode}
              selected={selected}
              setSelected={setSelected}
              agentsById={agentsById}
              nowMs={nowMs}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NodeRow({
  node,
  depth,
  mode,
  selected,
  onClick,
  agentsById,
  nowMs,
}: {
  node: PlanNode;
  depth: number;
  mode: "plan" | "live";
  selected: boolean;
  onClick: () => void;
  agentsById: Record<string, Agent>;
  nowMs: number;
}) {
  const meta = STATE_META[node.state];
  const assignee = node.assigneeId ? agentsById[node.assigneeId] : null;
  const isMission = node.kind === "mission";
  const isPhase = node.kind === "phase";
  const kindClass = isMission ? "mission" : isPhase ? "phase" : "task";

  return (
    <div
      className={`s-plan-node s-plan-node--${kindClass}${selected ? " s-plan-node--selected" : ""}`}
      onClick={onClick}
    >
      {!isMission && (
        <span className="s-plan-node-icon" style={{ color: meta.color }}>
          {meta.icon}
        </span>
      )}

      <div className="s-plan-node-title-wrap">
        <div className="s-plan-node-title-row" style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span
            className={`s-plan-node-title s-plan-node-title--${kindClass}${node.state === "done" ? " s-plan-node-title--done" : ""}`}
          >
            {node.title}
          </span>
        </div>
        <div className={`s-plan-node-payload${mode === "live" ? " s-plan-node-payload--live" : ""}`}>
          {mode === "plan" ? (
            <span>{node.why ?? node.summary ?? "—"}</span>
          ) : (
            <LivePayload node={node} nowMs={nowMs} />
          )}
        </div>
      </div>

      {!isMission && (
        <div className="s-plan-node-assignee">
          {assignee ? (
            <>
              <div
                className="s-ops-avatar"
                style={{ "--size": "18px", background: actorColor(assignee.name) } as React.CSSProperties}
              >
                {assignee.name[0]?.toUpperCase()}
              </div>
              <span className="s-plan-node-assignee-handle">
                {assignee.handle ? `@${assignee.handle}` : assignee.name}
              </span>
            </>
          ) : (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--dim)" }}>
              unassigned
            </span>
          )}
        </div>
      )}

      {!isMission && (
        <div className="s-plan-node-right">
          <div className="s-plan-confidence-bar">
            <div
              className="s-plan-confidence-bar-fill"
              style={{ width: `${(node.progress ?? 0) * 100}%`, background: meta.color }}
            />
          </div>
          <span className="s-ops-state-chip" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
      )}

      {isMission && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--dim)", letterSpacing: "0.08em" }}>
          {node.badge ?? "LIVE"}
        </div>
      )}
    </div>
  );
}

function LivePayload({ node, nowMs }: { node: PlanNode; nowMs: number }) {
  if (node.state === "done") {
    return <span style={{ opacity: 0.55 }}>✓ completed {node.updatedAt ? timeAgo(node.updatedAt) : "recently"}</span>;
  }
  if (node.state === "stuck") {
    return (
      <span style={{ color: "var(--amber)" }}>
        ▲ {node.detail ?? "blocked"}
        {node.stuckMins ? ` · ${node.stuckMins}m` : ""}
      </span>
    );
  }
  if (node.state === "inflight") {
    return (
      <span>
        › {node.detail ?? "working"}
        {node.updatedAt ? ` · ${timeAgo(node.updatedAt)}` : ""}
      </span>
    );
  }
  if (node.state === "committed") {
    return (
      <span>
        ◐ {node.detail ?? "queued"}
        {node.updatedAt ? ` · ${timeAgo(node.updatedAt)}` : ""}
      </span>
    );
  }
  return <span style={{ opacity: 0.55 }}>◌ waiting for first live signal {node.updatedAt ? timeAgo(node.updatedAt) : ""}</span>;
}

function AttentionCard({
  item,
  navigate,
}: {
  item: FleetAttentionItem;
  navigate: (route: Route) => void;
}) {
  const route = routeForAttention(item);

  return (
    <div className="s-plan-change-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="s-plan-change-kind" style={{ color: "var(--amber)" }}>
          {item.kind === "question" ? "question" : "work item"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--dim)" }}>
          {timeAgo(item.updatedAt)}
        </span>
      </div>
      <div className="s-plan-change-summary">{item.title}</div>
      <div className="s-plan-change-why">
        {item.summary ?? `${item.state.replace(/_/g, " ")} · ${item.acceptanceState.replace(/_/g, " ")}`}
      </div>
      {route && (
        <div className="s-plan-change-actions">
          <button className="s-ops-btn s-ops-btn--primary" style={{ flex: 1 }} onClick={() => navigate(route)}>
            Open item
          </button>
        </div>
      )}
    </div>
  );
}

function CompletedCard({
  ask,
  navigate,
}: {
  ask: FleetAsk;
  navigate: (route: Route) => void;
}) {
  const route = routeForAsk(ask);

  return (
    <div className="s-plan-change-card s-plan-change-card--accepted">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="s-plan-change-kind" style={{ color: "var(--green)" }}>
          {ask.status}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--dim)" }}>
          {timeAgo(ask.completedAt ?? ask.updatedAt)}
        </span>
      </div>
      <div className="s-plan-change-summary">{ask.summary ?? ask.task}</div>
      <div className="s-plan-change-why">
        {ask.agentName ?? ask.agentId} · {ask.task}
      </div>
      {route && (
        <div className="s-plan-change-actions">
          <button className="s-ops-btn" style={{ flex: 1 }} onClick={() => navigate(route)}>
            Open thread
          </button>
        </div>
      )}
    </div>
  );
}

function RiskRow({ risk }: { risk: OpsRisk }) {
  return (
    <div className="s-plan-risk">
      <span className={`s-plan-risk-icon s-plan-risk-icon--${risk.severity}`}>▲</span>
      <div>
        <div className="s-plan-risk-title">{risk.title}</div>
        <div className="s-plan-risk-detail">{risk.detail}</div>
      </div>
    </div>
  );
}

function NodeDetail({
  node,
  agentsById,
  navigate,
}: {
  node: PlanNode;
  agentsById: Record<string, Agent>;
  navigate: (route: Route) => void;
}) {
  const meta = STATE_META[node.state];
  const assignee = node.assigneeId ? agentsById[node.assigneeId] : null;

  return (
    <div className="s-plan-detail">
      <div className="s-plan-detail-header">
        <span style={{ color: meta.color }}>{meta.icon}</span>
        <span className="s-ops-state-chip" style={{ color: meta.color, fontSize: 10 }}>
          {meta.label}
        </span>
      </div>
      <div className="s-plan-detail-title">{node.title}</div>
      {(node.summary || node.detail || node.why) && (
        <div className="s-plan-detail-why">
          {node.summary ?? node.detail ?? node.why}
        </div>
      )}
      {assignee && (
        <div className="s-plan-detail-assignee">
          <div
            className="s-ops-avatar"
            style={{ "--size": "22px", background: actorColor(assignee.name) } as React.CSSProperties}
          >
            {assignee.name[0]?.toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5 }}>{assignee.name}</div>
            <div style={{ fontSize: 10.5, color: "var(--dim)", fontFamily: "var(--font-mono)" }}>
              {assignee.project ?? "—"} · {assignee.branch ?? "main"}
            </div>
          </div>
        </div>
      )}
      <div className="s-plan-detail-actions">
        {node.route && (
          <button className="s-ops-btn s-ops-btn--primary" onClick={() => navigate(node.route!)}>
            Open item
          </button>
        )}
        {assignee && (
          <button
            className="s-ops-btn"
            onClick={() =>
              navigate({
                view: "conversation",
                conversationId: conversationForAgent(assignee.id),
                composeMode: "tell",
              })}
          >
            Tell owner
          </button>
        )}
        {assignee && (
          <button
            className="s-ops-btn"
            onClick={() =>
              navigate({
                view: "conversation",
                conversationId: conversationForAgent(assignee.id),
                composeMode: "ask",
              })}
          >
            Ask owner
          </button>
        )}
      </div>
    </div>
  );
}
