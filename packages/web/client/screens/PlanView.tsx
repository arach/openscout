import "./plan-view.css";

import { useMemo, useState } from "react";
import { actorColor } from "../lib/colors.ts";
import {
  getMockMission,
  getMockTree,
  getMockChanges,
  getMockRisks,
} from "../lib/ops-mock-data.ts";
import type {
  Agent,
  MissionTreeNode,
  MissionNodeState,
  PlanChange,
  PlanRisk,
  Route,
} from "../lib/types.ts";

/* ── State metadata ── */

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

function flattenTree(root: MissionTreeNode): MissionTreeNode[] {
  const out = [root];
  if (root.children) root.children.forEach((c) => out.push(...flattenTree(c)));
  return out;
}

function findNode(root: MissionTreeNode, id: string): MissionTreeNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const c of root.children) {
      const f = findNode(c, id);
      if (f) return f;
    }
  }
  return null;
}

function countAssigned(root: MissionTreeNode, agentId: string): number {
  return flattenTree(root).filter((n) => n.assignee === agentId).length;
}

export function PlanView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const mission = getMockMission();
  const tree = getMockTree();
  const changes = getMockChanges();
  const risks = getMockRisks();

  const agentsById = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a])),
    [agents],
  );

  const [selected, setSelected] = useState("t2b");
  const [mode, setMode] = useState<"plan" | "live">("plan");
  const [acceptedChanges, setAcceptedChanges] = useState<Set<string>>(
    () => new Set(changes.filter((c) => c.status === "accepted").map((c) => c.id)),
  );
  const [rejectedChanges, setRejectedChanges] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  // tick for live mode animations
  useState(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  });

  const allNodes = flattenTree(tree);
  const selectedNode = findNode(tree, selected);
  const pendingCount = changes.filter(
    (c) => c.status === "pending" && !acceptedChanges.has(c.id) && !rejectedChanges.has(c.id),
  ).length;

  return (
    <div className="s-plan">
      <div className="s-plan-inner">
        {/* Banner */}
        <div className="s-plan-banner">
          <span className="s-plan-banner-badge">
            ↻ Living plan · Re-proposed {mission.lastReproposedMinsAgo}m ago
          </span>
          <span className="s-plan-banner-meta">
            {pendingCount} pending changes · {Math.round(mission.confidence * 100)}% confidence ·
            deadline <b>{mission.deadline}</b>
          </span>
          <span style={{ flex: 1 }} />
          <button className="s-ops-btn">◈ Fork plan</button>
          <button className="s-ops-btn">◢ Declare complete</button>
        </div>

        {/* Left: Mission brief */}
        <div className="s-plan-col">
          <div className="s-ops-eyebrow">◇ Mission</div>
          <h1 className="s-plan-title">{mission.title}</h1>
          <p className="s-plan-goal">{mission.goal}</p>

          <div className="s-ops-eyebrow">Why now</div>
          <p className="s-plan-rationale">{mission.rationale}</p>

          <div className="s-ops-eyebrow">Risks · watch</div>
          {risks.map((r) => (
            <RiskRow key={r.id} risk={r} />
          ))}

          <div className="s-ops-eyebrow" style={{ marginTop: 24 }}>Agents on mission</div>
          {agents.map((a) => {
            const count = countAssigned(tree, a.id);
            if (count === 0) return null;
            return (
              <div key={a.id} className="s-plan-agent-row">
                <div
                  className="s-ops-avatar"
                  style={{ "--size": "22px", background: actorColor(a.name) } as React.CSSProperties}
                >
                  {a.name[0]?.toUpperCase()}
                </div>
                <div className="s-plan-agent-row-copy">
                  <div className="s-plan-agent-row-name">{a.name}</div>
                  <div className="s-plan-agent-row-tasks">
                    {count} task{count > 1 ? "s" : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center: Mission tree */}
        <div className="s-plan-col" style={{ padding: "20px 16px 40px" }}>
          <div className="s-plan-tree-header">
            <div className="s-ops-eyebrow" style={{ marginBottom: 0 }}>◆ Mission tree</div>
            <span className="s-plan-tree-stats">
              {allNodes.length} nodes · {allNodes.filter((n) => n.state === "done").length} done ·{" "}
              {allNodes.filter((n) => n.state === "inflight").length} in flight ·{" "}
              {allNodes.filter((n) => n.state === "stuck").length} stuck
            </span>
            <div className="s-plan-tree-toggle">
              {(["plan", "live"] as const).map((m) => (
                <button
                  key={m}
                  className={`s-plan-tree-toggle-btn${mode === m ? " s-plan-tree-toggle-btn--active" : ""}`}
                  onClick={() => setMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <TreeNode
            node={tree}
            depth={0}
            mode={mode}
            selected={selected}
            setSelected={setSelected}
            agentsById={agentsById}
            tick={tick}
          />
        </div>

        {/* Right: Change feed + detail */}
        <div className="s-plan-col" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <div className="s-ops-eyebrow">↻ Re-proposals · {pendingCount} pending</div>
            {changes.map((c) => {
              const accepted = c.status === "accepted" || acceptedChanges.has(c.id);
              const rejected = rejectedChanges.has(c.id);
              return (
                <ChangeCard
                  key={c.id}
                  change={c}
                  accepted={accepted}
                  rejected={rejected}
                  onAccept={() => setAcceptedChanges((s) => new Set(s).add(c.id))}
                  onReject={() => setRejectedChanges((s) => new Set(s).add(c.id))}
                />
              );
            })}
          </div>

          {selectedNode && (
            <div>
              <div className="s-ops-eyebrow">◎ Selected</div>
              <NodeDetail node={selectedNode} agentsById={agentsById} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Tree node (recursive) ── */

function TreeNode({
  node,
  depth,
  mode,
  selected,
  setSelected,
  agentsById,
  tick,
}: {
  node: MissionTreeNode;
  depth: number;
  mode: "plan" | "live";
  selected: string;
  setSelected: (id: string) => void;
  agentsById: Record<string, Agent>;
  tick: number;
}) {
  const isMission = node.kind === "mission";
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
        tick={tick}
      />
      {hasChildren && (
        <div className={depth === 0 ? undefined : "s-plan-node-children"}>
          {node.children!.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              mode={mode}
              selected={selected}
              setSelected={setSelected}
              agentsById={agentsById}
              tick={tick}
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
  tick,
}: {
  node: MissionTreeNode;
  depth: number;
  mode: "plan" | "live";
  selected: boolean;
  onClick: () => void;
  agentsById: Record<string, Agent>;
  tick: number;
}) {
  const meta = STATE_META[node.state];
  const assignee = node.assignee && node.assignee !== "human" ? agentsById[node.assignee] : null;
  const isHuman = node.assignee === "human";
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
          {mode === "plan" && node.why && <span>{node.why}</span>}
          {mode === "plan" && !node.why && !isMission && node.state !== "done" && (
            <span style={{ opacity: 0.6 }}>—</span>
          )}
          {mode === "live" && <LivePayload node={node} tick={tick} />}
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
          ) : isHuman ? (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--amber)" }}>
              human
            </span>
          ) : (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--dim)" }}>
              unassigned
            </span>
          )}
        </div>
      )}

      {!isMission && (
        <div className="s-plan-node-right">
          {mode === "plan" ? (
            <div className="s-plan-confidence-bar">
              <div
                className="s-plan-confidence-bar-fill"
                style={{ width: `${(node.confidence ?? 0) * 100}%`, background: meta.color }}
              />
            </div>
          ) : (
            <LiveMeter node={node} color={meta.color} tick={tick} />
          )}
          <span className="s-ops-state-chip" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
      )}

      {isMission && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--dim)", letterSpacing: "0.08em" }}>
          MISSION · {Math.round((node.confidence ?? 0) * 100)}% CONF
        </div>
      )}
    </div>
  );
}

function LivePayload({ node, tick }: { node: MissionTreeNode; tick: number }) {
  if (node.state === "done") return <span style={{ opacity: 0.55 }}>✓ completed</span>;
  if (node.state === "stuck")
    return <span style={{ color: "var(--amber)" }}>▲ {node.detail ?? "blocked"}</span>;
  if (node.state === "inflight") {
    const dots = ".".repeat((tick % 3) + 1);
    return (
      <span>
        › {node.detail ?? "working"}
        <span style={{ opacity: 0.5 }}>{dots}</span>
      </span>
    );
  }
  if (node.state === "proposed") return <span style={{ opacity: 0.55 }}>◌ awaiting commit</span>;
  if (node.state === "committed") return <span style={{ opacity: 0.7 }}>◐ queued</span>;
  return null;
}

function LiveMeter({ node, color, tick }: { node: MissionTreeNode; color: string; tick: number }) {
  if (node.state === "done")
    return <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--dim)" }}>✓</span>;
  if (node.state === "stuck")
    return (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color }}>
        {node.stuckMins ?? 0}m blocked
      </span>
    );
  if (node.state === "inflight") {
    const prog = typeof node.progress === "number"
      ? node.progress
      : Math.sin(tick * 0.5 + node.id.charCodeAt(0)) * 0.3 + 0.5;
    return (
      <div className="s-plan-confidence-bar">
        <div className="s-plan-confidence-bar-fill" style={{ width: `${prog * 100}%`, background: color }} />
      </div>
    );
  }
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--dim)" }}>—</span>;
}

/* ── Change card ── */

function ChangeCard({
  change,
  accepted,
  rejected,
  onAccept,
  onReject,
}: {
  change: PlanChange;
  accepted: boolean;
  rejected: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div
      className={`s-plan-change-card${accepted ? " s-plan-change-card--accepted" : ""}${rejected ? " s-plan-change-card--rejected" : ""}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className={`s-plan-change-kind s-plan-change-kind--${change.kind}`}>
          {change.kind}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--dim)" }}>
          {change.minsAgo}m ago
        </span>
      </div>
      <div className="s-plan-change-summary">{change.summary}</div>
      <div className="s-plan-change-why">{change.why}</div>
      {!accepted && !rejected && (
        <div className="s-plan-change-actions">
          <button className="s-ops-btn s-ops-btn--primary" style={{ flex: 1 }} onClick={onAccept}>
            Accept
          </button>
          <button className="s-ops-btn" onClick={onReject}>Reject</button>
          <button className="s-ops-btn">Tweak</button>
        </div>
      )}
      {accepted && <div className="s-plan-change-accepted-label">✓ ACCEPTED</div>}
    </div>
  );
}

/* ── Risk row ── */

function RiskRow({ risk }: { risk: PlanRisk }) {
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

/* ── Node detail ── */

function NodeDetail({
  node,
  agentsById,
}: {
  node: MissionTreeNode;
  agentsById: Record<string, Agent>;
}) {
  const meta = STATE_META[node.state];
  const assignee = node.assignee && node.assignee !== "human" ? agentsById[node.assignee] : null;

  return (
    <div className="s-plan-detail">
      <div className="s-plan-detail-header">
        <span style={{ color: meta.color }}>{meta.icon}</span>
        <span className="s-ops-state-chip" style={{ color: meta.color, fontSize: 10 }}>
          {meta.label}
        </span>
      </div>
      <div className="s-plan-detail-title">{node.title}</div>
      {node.why && <div className="s-plan-detail-why">{node.why}</div>}
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
          <button className="s-ops-btn" style={{ fontSize: 10 }}>Re-assign</button>
        </div>
      )}
      <div className="s-plan-detail-actions">
        <button className="s-ops-btn s-ops-btn--primary">Commit</button>
        <button className="s-ops-btn">Split</button>
        <button className="s-ops-btn">Ask to research</button>
      </div>
    </div>
  );
}
