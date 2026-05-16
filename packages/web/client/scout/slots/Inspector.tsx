import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { openContent } from "./openContent.ts";
import { agentStateLabel, normalizeAgentState } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { AgentsInspector } from "../inspector/AgentsInspector.tsx";
import { HomeAgentsInspector } from "../inspector/HomeAgentsInspector.tsx";
import { SessionsInspector } from "../inspector/SessionsInspector.tsx";
import { WorkInspector } from "../inspector/WorkInspector.tsx";
import { MeshInspectorPanel } from "../inspector/MeshInspector.tsx";
import { RangerPanel } from "../ranger/RangerPanel.tsx";
import { BrokerAttemptInspector } from "../../screens/BrokerScreen.tsx";
import { usePersistentBoolean, usePersistentNumber } from "../../lib/persistent-state.ts";
import { VerticalResizeHandle } from "./VerticalResizeHandle.tsx";
import type { Agent, FleetAsk, FleetAttentionItem, FleetState, OpsMode, Route } from "../../lib/types.ts";

const RANGER_MIN_HEIGHT = 180;
const RANGER_MAX_HEIGHT_RATIO = 0.7;
const RANGER_DEFAULT_HEIGHT = 320;

function clampRangerHeight(value: number, inspectorHeight: number) {
  const max = Math.max(RANGER_MIN_HEIGHT, Math.floor(inspectorHeight * RANGER_MAX_HEIGHT_RATIO));
  return Math.min(max, Math.max(RANGER_MIN_HEIGHT, Math.round(value)));
}

export function ScoutInspector() {
  const { route, navigate, agents, selectedBrokerAttempt, clearBrokerAttempt } = useScout();
  const [rangerCollapsed] = usePersistentBoolean("openscout.ranger.collapsed", false);
  const [rangerHeight, setRangerHeight] = usePersistentNumber("openscout.ranger.height", RANGER_DEFAULT_HEIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inspectorHeight, setInspectorHeight] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setInspectorHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setInspectorHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (inspectorHeight <= 0) return;
    const next = clampRangerHeight(rangerHeight, inspectorHeight);
    if (next !== rangerHeight) {
      setRangerHeight(next);
    }
  }, [inspectorHeight, rangerHeight, setRangerHeight]);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const startY = event.clientY;
      const startHeight = rangerHeight;
      const containerHeight = containerRef.current?.getBoundingClientRect().height ?? inspectorHeight;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        setRangerHeight(clampRangerHeight(startHeight - delta, containerHeight));
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [inspectorHeight, rangerHeight, setRangerHeight],
  );

  let content: ReactNode = null;

  switch (route.view) {
    case "inbox":
    case "fleet":
      content = <HomeAgentsInspector />;
      break;
    case "agents":
    case "agent-info":
      content = <AgentsInspector />;
      break;
    case "sessions":
    case "conversation":
      content = <SessionsInspector />;
      break;
    case "work":
      content = <WorkInspector />;
      break;
    case "mesh":
      content = <MeshInspectorPanel />;
      break;
    case "ops":
      content = <OpsInspectorPanel mode={route.mode ?? "command"} agents={agents} navigate={navigate} />;
      break;
    case "broker":
      content = selectedBrokerAttempt
        ? (
          <BrokerAttemptInspector
            attempt={selectedBrokerAttempt}
            navigate={navigate}
            onClose={clearBrokerAttempt}
          />
        )
        : <BrokerInspectorEmpty />;
      break;
    default:
      content = null;
  }

  const clampedRangerHeight = inspectorHeight > 0
    ? clampRangerHeight(rangerHeight, inspectorHeight)
    : rangerHeight;

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        {content}
      </div>
      {!rangerCollapsed && <VerticalResizeHandle onResizeStart={handleResizeStart} />}
      <RangerPanel height={rangerCollapsed ? undefined : clampedRangerHeight} />
    </div>
  );
}

function BrokerInspectorEmpty() {
  return (
    <div className="sys-broker-right-empty">
      <div className="sys-kicker">Broker</div>
      <p>Select any broker ledger row to inspect route metadata here.</p>
    </div>
  );
}

const OPS_MODE_LABELS: Record<OpsMode, string> = {
  command: "Command",
  mission: "Control",
  plan: "Plan",
  conductor: "Conduct",
  tail: "Tail",
  atop: "Atop",
  agents: "Agents",
  runs: "Runs",
};

type OpsDetailSnapshot = {
  focus: "flow" | "item";
  title: string;
  meta: string;
  body: string;
  action: { label: string; route: Route } | null;
};

function OpsInspectorPanel({
  mode,
  agents,
  navigate,
}: {
  mode: OpsMode;
  agents: Agent[];
  navigate: (route: Route) => void;
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [detail, setDetail] = useState<OpsDetailSnapshot | null>(() => {
    if (typeof window === "undefined") return null;
    const target = window as typeof window & { scoutOpsDetailSnapshot?: unknown };
    return parseOpsDetailSnapshot(target.scoutOpsDetailSnapshot);
  });

  const load = useCallback(async () => {
    const data = await api<FleetState>("/api/fleet").catch(() => null);
    setFleet(data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onDetail = (event: Event) => {
      setDetail(parseOpsDetailSnapshot((event as CustomEvent<unknown>).detail));
    };
    window.addEventListener("scout:ops-detail", onDetail);
    return () => window.removeEventListener("scout:ops-detail", onDetail);
  }, []);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted" ||
      event.kind === "flight.updated" ||
      event.kind === "collaboration.event.appended"
    ) {
      void load();
    }
  });

  const activeAsks = (fleet?.activeAsks ?? []).filter((ask) => ask.status !== "needs_attention");
  const needsAttention = fleet?.needsAttention ?? [];
  const workingAgents = agents.filter((agent) => normalizeAgentState(agent.state) === "working");
  const onlineAgents = agents.filter((agent) => normalizeAgentState(agent.state) !== "offline");
  const recentAgents = [...agents]
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(0, 7);

  return (
    <div className="ctx-panel ctx-panel--ops-inspector">
      {detail && (
        <section className="ctx-panel-section ctx-panel-selected-detail">
          <div className="ctx-panel-section-label">
            {detail.focus === "flow" ? "Message" : "Selection"}
          </div>
          <div className="ctx-panel-selected-card">
            <div className="ctx-panel-selected-title">{detail.title}</div>
            <div className="ctx-panel-selected-meta">{detail.meta}</div>
            <div className="ctx-panel-selected-body">{detail.body}</div>
            {detail.action && (
              <button
                type="button"
                className="ctx-panel-selected-action"
                onClick={() => navigate(detail.action!.route)}
              >
                {detail.action.label}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="ctx-panel-section ctx-panel-ops-summary">
        <div className="ctx-panel-section-label">Ops Context</div>
        <div className="ctx-panel-ops-mode-card">
          <span>Current</span>
          <strong>{OPS_MODE_LABELS[mode]}</strong>
          <small>{fleet ? `${timeAgo(fleet.generatedAt)} refresh` : "loading"}</small>
        </div>
        <div className="ctx-panel-stat-grid">
          <OpsStat label="Needs" value={needsAttention.length} tone={needsAttention.length > 0 ? "warn" : "ok"} />
          <OpsStat label="Active" value={activeAsks.length} />
          <OpsStat label="Online" value={`${onlineAgents.length}/${agents.length}`} />
          <OpsStat label="Working" value={workingAgents.length} />
        </div>
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Queue
          {needsAttention.length > 0 && <span className="ctx-panel-count">{needsAttention.length}</span>}
        </div>
        {needsAttention.length === 0 ? (
          <div className="ctx-panel-empty">No operator cues</div>
        ) : (
          <div className="ctx-panel-list">
            {needsAttention.slice(0, 5).map((item) => (
              <OpsAttentionButton key={item.recordId} item={item} navigate={navigate} />
            ))}
          </div>
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Runs
          {activeAsks.length > 0 && <span className="ctx-panel-count">{activeAsks.length}</span>}
        </div>
        {activeAsks.length === 0 ? (
          <div className="ctx-panel-empty">No active asks</div>
        ) : (
          <div className="ctx-panel-list">
            {activeAsks.slice(0, 5).map((ask) => (
              <OpsAskButton key={ask.invocationId} ask={ask} navigate={navigate} />
            ))}
          </div>
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">Agent Pulse</div>
        <div className="ctx-panel-pulse-list">
          {recentAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="ctx-panel-pulse-row"
              onClick={() => navigate({ view: "agents", agentId: agent.id })}
            >
              <span className={`ctx-panel-pulse-dot ctx-panel-pulse-dot--${normalizeAgentState(agent.state)}`} />
              <span>{agent.name}</span>
              <small>{agentStateLabel(agent.state)} · {agent.updatedAt ? timeAgo(agent.updatedAt) : "unknown"}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function OpsStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn";
}) {
  return (
    <div className={`ctx-panel-stat${tone ? ` ctx-panel-stat--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function parseOpsDetailSnapshot(value: unknown): OpsDetailSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<OpsDetailSnapshot>;
  if (
    (record.focus !== "flow" && record.focus !== "item") ||
    typeof record.title !== "string" ||
    typeof record.meta !== "string" ||
    typeof record.body !== "string"
  ) {
    return null;
  }
  return {
    focus: record.focus,
    title: record.title,
    meta: record.meta,
    body: record.body,
    action: record.action && typeof record.action === "object" ? record.action : null,
  };
}

function OpsAttentionButton({
  item,
  navigate,
}: {
  item: FleetAttentionItem;
  navigate: (route: Route) => void;
}) {
  const { route } = useScout();
  return (
    <button
      type="button"
      className="ctx-panel-item ctx-panel-item--attention"
      onClick={() => {
        if (item.conversationId) {
          openContent(navigate, { view: "conversation", conversationId: item.conversationId }, { returnTo: route });
        } else {
          navigate({ view: "ops", mode: "command" });
        }
      }}
    >
      <div className="ctx-panel-body">
        <span className="ctx-panel-name">{item.title}</span>
        <span className="ctx-panel-sub">{item.agentName ?? item.agentId ?? "operator"} · {timeAgo(item.updatedAt)}</span>
      </div>
    </button>
  );
}

function OpsAskButton({
  ask,
  navigate,
}: {
  ask: FleetAsk;
  navigate: (route: Route) => void;
}) {
  const { route } = useScout();
  return (
    <button
      type="button"
      className="ctx-panel-item"
      onClick={() => {
        if (ask.conversationId) {
          openContent(navigate, { view: "conversation", conversationId: ask.conversationId }, { returnTo: route });
        } else {
          navigate({ view: "ops", mode: "runs" });
        }
      }}
    >
      <div className="ctx-panel-body">
        <span className="ctx-panel-name">{ask.task}</span>
        <span className="ctx-panel-sub">{ask.agentName ?? ask.agentId} · {ask.statusLabel}</span>
      </div>
    </button>
  );
}
