import "./plan-view.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor } from "../lib/colors.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
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

type PlanLaneKey = "attention" | "active" | "committed";

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

function laneForWork(work: WorkItem): PlanLaneKey {
  const state = workNodeState(work);
  if (state === "stuck") return "attention";
  if (state === "inflight") return "active";
  return "committed";
}

function laneForAsk(ask: FleetAsk): PlanLaneKey {
  const state = askNodeState(ask);
  if (state === "stuck") return "attention";
  if (state === "inflight") return "active";
  return "committed";
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

function buildNodeFromAttention(item: FleetAttentionItem, nowMs: number): PlanNode {
  return {
    id: `attention:${item.recordId}`,
    kind: "task",
    title: item.title,
    summary: item.summary,
    state: "stuck",
    assigneeId: item.agentId,
    detail: item.summary ?? item.state.replace(/_/g, " "),
    why: item.kind === "question"
      ? "Operator input is required before this can move again."
      : "This work item is blocked on a review, decision, or reply.",
    progress: progressForState("stuck"),
    stuckMins: minutesSince(item.updatedAt, nowMs),
    updatedAt: item.updatedAt,
    route: routeForAttention(item),
  };
}

function nodeSort(left: PlanNode, right: PlanNode): number {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function laneNode(
  id: PlanLaneKey,
  title: string,
  summary: string,
  state: MissionNodeState,
  children: PlanNode[],
): PlanNode {
  return {
    id: `lane:${id}`,
    kind: "phase",
    title,
    summary,
    state,
    assigneeId: null,
    detail: summary,
    why: summary,
    progress: progressForState(state),
    stuckMins: null,
    updatedAt: children[0]?.updatedAt ?? null,
    route: { view: "fleet" },
    children,
  };
}

function missionTitle(
  attentionCount: number,
  activeCount: number,
  committedCount: number,
  onlineCount: number,
): string {
  if (attentionCount > 0) return "Resolve blockers before the queue widens";
  if (activeCount > 0) return "Keep the live queue moving";
  if (committedCount > 0) return "Commit the next slice of work";
  if (onlineCount > 0) return "Stand up the next unit of work";
  return "No live operational plan yet";
}

function missionGoal(
  workCount: number,
  activeAskCount: number,
  attentionCount: number,
  onlineCount: number,
): string {
  if (workCount === 0 && activeAskCount === 0) {
    return onlineCount > 0
      ? `${onlineCount} agent${onlineCount === 1 ? " is" : "s are"} connected, but no work items or asks are active yet.`
      : "Bring agents online or dispatch the first ask to light up the plan surface.";
  }
  return `${workCount} live work item${workCount === 1 ? "" : "s"}, ${activeAskCount} active ask${activeAskCount === 1 ? "" : "s"}, and ${attentionCount} item${attentionCount === 1 ? "" : "s"} currently need operator awareness.`;
}

function missionRationale(workCount: number, activityCount: number): string {
  return `Derived from live collaboration records, active asks, and recent fleet activity. This surface now reflects the current checkout instead of a canned mission narrative. ${workCount > 0 ? `You have ${workCount} active work records in play.` : "No work records are active yet."} ${activityCount > 0 ? `${activityCount} recent fleet events are informing the live view.` : "Recent fleet activity is quiet right now."}`;
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

export function PlanView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"plan" | "live">("plan");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [fleetResult, workResult] = await Promise.allSettled([
      api<FleetState>("/api/fleet"),
      api<WorkItem[]>("/api/work"),
    ]);

    if (fleetResult.status === "fulfilled") {
      setFleet(fleetResult.value);
    }
    if (workResult.status === "fulfilled") {
      setWorkItems(workResult.value);
    }
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

  const onlineCount = useMemo(
    () => agents.filter((agent) => normalizeAgentState(agent.state) !== "offline").length,
    [agents],
  );

  const derived = useMemo(() => {
    const attentionNodes: PlanNode[] = [];
    const activeNodes: PlanNode[] = [];
    const committedNodes: PlanNode[] = [];
    const consumedWorkIds = new Set<string>();
    const workById = new Map(workItems.map((work) => [work.id, work]));

    for (const item of fleet?.needsAttention ?? []) {
      const relatedWork = workById.get(item.recordId);
      if (relatedWork) {
        const node = buildNodeFromWork(relatedWork, nowMs);
        attentionNodes.push({
          ...node,
          state: "stuck",
          detail: item.summary ?? node.detail,
          why: item.summary ?? node.summary ?? node.why,
          stuckMins: minutesSince(item.updatedAt, nowMs),
          updatedAt: item.updatedAt,
          route: node.route ?? routeForAttention(item),
        });
        consumedWorkIds.add(relatedWork.id);
      } else {
        attentionNodes.push(buildNodeFromAttention(item, nowMs));
      }
    }

    for (const ask of fleet?.activeAsks ?? []) {
      const relatedWorkId = ask.collaborationRecordId ?? null;
      const relatedWork = relatedWorkId ? workById.get(relatedWorkId) : null;
      if (relatedWork && consumedWorkIds.has(relatedWork.id)) {
        continue;
      }
      if (relatedWork) {
        const node = buildNodeFromWork(relatedWork, nowMs);
        const lane = laneForWork(relatedWork);
        if (lane === "attention") attentionNodes.push(node);
        else if (lane === "active") activeNodes.push(node);
        else committedNodes.push(node);
        consumedWorkIds.add(relatedWork.id);
      } else {
        const node = buildNodeFromAsk(ask, nowMs);
        const lane = laneForAsk(ask);
        if (lane === "attention") attentionNodes.push(node);
        else if (lane === "active") activeNodes.push(node);
        else committedNodes.push(node);
      }
    }

    for (const work of workItems) {
      if (consumedWorkIds.has(work.id)) continue;
      const node = buildNodeFromWork(work, nowMs);
      const lane = laneForWork(work);
      if (lane === "attention") attentionNodes.push(node);
      else if (lane === "active") activeNodes.push(node);
      else committedNodes.push(node);
    }

    attentionNodes.sort(nodeSort);
    activeNodes.sort(nodeSort);
    committedNodes.sort(nodeSort);

    const rootChildren: PlanNode[] = [];
    if (attentionNodes.length > 0) {
      rootChildren.push(
        laneNode(
          "attention",
          "Needs input",
          `${attentionNodes.length} item${attentionNodes.length === 1 ? "" : "s"} are waiting on an answer, decision, or unblock.`,
          "stuck",
          attentionNodes,
        ),
      );
    }
    if (activeNodes.length > 0) {
      rootChildren.push(
        laneNode(
          "active",
          "In flight",
          `${activeNodes.length} item${activeNodes.length === 1 ? "" : "s"} are currently moving through the fleet.`,
          "inflight",
          activeNodes,
        ),
      );
    }
    if (committedNodes.length > 0) {
      rootChildren.push(
        laneNode(
          "committed",
          "Committed next",
          `${committedNodes.length} item${committedNodes.length === 1 ? "" : "s"} are queued or ready to be picked up next.`,
          "committed",
          committedNodes,
        ),
      );
    }

    const leafNodes = [...attentionNodes, ...activeNodes, ...committedNodes];
    const root = {
      id: "plan:root",
      kind: "mission",
      title: missionTitle(
        attentionNodes.length,
        activeNodes.length,
        committedNodes.length,
        onlineCount,
      ),
      summary: missionGoal(
        workItems.length,
        fleet?.activeAsks.length ?? 0,
        attentionNodes.length,
        onlineCount,
      ),
      state: attentionNodes.length > 0
        ? "stuck"
        : activeNodes.length > 0
          ? "inflight"
          : committedNodes.length > 0
            ? "committed"
            : "proposed",
      assigneeId: null,
      detail: null,
      why: missionRationale(workItems.length, fleet?.activity.length ?? 0),
      progress: leafNodes.length > 0
        ? leafNodes.reduce((sum, node) => sum + (node.progress ?? 0), 0) / leafNodes.length
        : 0,
      stuckMins: null,
      updatedAt: fleet?.generatedAt ?? null,
      route: { view: "fleet" } as Route,
      badge: `${leafNodes.length} live item${leafNodes.length === 1 ? "" : "s"}`,
      children: rootChildren,
    } satisfies PlanNode;

    const risks = buildRisks(
      fleet?.needsAttention ?? [],
      fleet?.activeAsks ?? [],
      workItems,
    );

    const recentCompleted = (fleet?.recentCompleted ?? []).slice(0, 4);

    return {
      root,
      leafNodes,
      risks,
      recentCompleted,
      pendingAttention: fleet?.needsAttention ?? [],
      counts: {
        done: recentCompleted.length,
        inflight: activeNodes.length,
        stuck: attentionNodes.length,
      },
    };
  }, [fleet, nowMs, onlineCount, workItems]);

  const selectedNode = selected ? findNode(derived.root, selected) : null;

  useEffect(() => {
    if (selectedNode) return;
    setSelected(derived.leafNodes[0]?.id ?? derived.root.id);
  }, [derived.leafNodes, derived.root.id, selectedNode]);

  return (
    <div className="s-plan">
      <div className="s-plan-inner">
        <div className="s-plan-banner">
          <span className="s-plan-banner-badge">
            ◉ Live plan
          </span>
          <span className="s-plan-banner-meta">
            {workItems.length} work item{workItems.length === 1 ? "" : "s"} · {fleet?.activeAsks.length ?? 0} active ask{(fleet?.activeAsks.length ?? 0) === 1 ? "" : "s"} · {derived.pendingAttention.length} waiting on you
          </span>
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
          <div className="s-ops-eyebrow">◇ Mission</div>
          <h1 className="s-plan-title">{derived.root.title}</h1>
          <p className="s-plan-goal">{derived.root.summary}</p>

          <div className="s-ops-eyebrow">Derived from live state</div>
          <p className="s-plan-rationale">{derived.root.why}</p>

          <div className="s-ops-eyebrow">Risks · watch</div>
          {derived.risks.length === 0 ? (
            <div className="s-plan-change-card">
              <div className="s-plan-change-summary">No active blockers</div>
              <div className="s-plan-change-why">
                The queue is clear of explicit questions, failed asks, and blocked work items.
              </div>
            </div>
          ) : (
            derived.risks.map((risk) => (
              <RiskRow key={risk.id} risk={risk} />
            ))
          )}

          <div className="s-ops-eyebrow" style={{ marginTop: 24 }}>Agents on mission</div>
          {agents.filter((agent) => countAssigned(derived.root, agent.id) > 0).length === 0 ? (
            <div className="s-plan-change-card">
              <div className="s-plan-change-summary">No assigned work yet</div>
              <div className="s-plan-change-why">
                As soon as asks and work items have clear owners, this roster will show who is carrying what.
              </div>
            </div>
          ) : (
            agents.map((agent) => {
              const count = countAssigned(derived.root, agent.id);
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
                      {count} item{count === 1 ? "" : "s"} assigned
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="s-plan-col" style={{ padding: "20px 16px 40px" }}>
          <div className="s-plan-tree-header">
            <div className="s-ops-eyebrow" style={{ marginBottom: 0 }}>◆ Execution tree</div>
            <span className="s-plan-tree-stats">
              {derived.leafNodes.length} items · {derived.counts.done} recent done · {derived.counts.inflight} in flight · {derived.counts.stuck} stuck
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

          {derived.root.children && derived.root.children.length > 0 ? (
            <TreeNode
              node={derived.root}
              depth={0}
              mode={mode}
              selected={selected ?? derived.root.id}
              setSelected={setSelected}
              agentsById={agentsById}
              nowMs={nowMs}
            />
          ) : (
            <div className="s-plan-change-card">
              <div className="s-plan-change-summary">No live plan records yet</div>
              <div className="s-plan-change-why">
                The execution tree is populated from live work items and active asks. Dispatch work and it will appear here automatically.
              </div>
            </div>
          )}
        </div>

        <div className="s-plan-col" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <div className="s-ops-eyebrow">↻ Attention queue · {derived.pendingAttention.length}</div>
            {derived.pendingAttention.length === 0 ? (
              <div className="s-plan-change-card">
                <div className="s-plan-change-summary">Nothing is waiting on you</div>
                <div className="s-plan-change-why">
                  Questions, reviews, and blocked work items will show up here as soon as operator input is required.
                </div>
              </div>
            ) : (
              derived.pendingAttention.map((item) => (
                <AttentionCard
                  key={item.recordId}
                  item={item}
                  navigate={navigate}
                />
              ))
            )}
          </div>

          <div>
            <div className="s-ops-eyebrow">✓ Recent finishes · {derived.recentCompleted.length}</div>
            {derived.recentCompleted.length === 0 ? (
              <div className="s-plan-change-card">
                <div className="s-plan-change-summary">No recent completions</div>
                <div className="s-plan-change-why">
                  Completed asks will land here so you can review what just finished without leaving the plan view.
                </div>
              </div>
            ) : (
              derived.recentCompleted.map((ask) => (
                <CompletedCard key={ask.invocationId} ask={ask} navigate={navigate} />
              ))
            )}
          </div>

          {selectedNode && (
            <div>
              <div className="s-ops-eyebrow">◎ Selected</div>
              <NodeDetail
                node={selectedNode}
                agentsById={agentsById}
                navigate={navigate}
              />
            </div>
          )}
        </div>
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
