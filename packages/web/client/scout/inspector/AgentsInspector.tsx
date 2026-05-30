import { useCallback, useEffect, useMemo, useState } from "react";
import { useScout } from "../Provider.tsx";
import { openAgent } from "../slots/openAgent.ts";
import { openContent } from "../slots/openContent.ts";
import {
  agentStateLabel,
  isAgentOnline,
  normalizeAgentState,
} from "../../lib/agent-state.ts";
import { actorColor, stateColor } from "../../lib/colors.ts";
import { compareTimestampsDesc, timeAgo } from "../../lib/time.ts";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { queueTakeover } from "../../lib/terminal-takeover.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import type {
  Agent,
  AgentObservePayload,
  FleetAsk,
  FleetState,
  ObserveData,
  Route,
  SessionCatalogEntry,
  SessionCatalogWithResume,
} from "../../lib/types.ts";

const GROUPED_NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function fmtCompactNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) < 1_000) {
    return GROUPED_NUMBER_FORMAT.format(value);
  }

  return COMPACT_NUMBER_FORMAT.format(value).toLowerCase();
}

function fmtWindowSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0s";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes >= 10 || remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

function shortHostLabel(value: string): string {
  return value.replace(/\.local$/i, "").replace(/-local-openscout$/i, "");
}

function pathLeaf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

async function revealLocalPath(input: {
  path: string;
  basePath?: string | null;
  agentId: string;
  sessionId?: string | null;
}) {
  await api<{ ok: true; path: string }>("/api/local-path/reveal", {
    method: "POST",
    body: JSON.stringify({
      path: input.path,
      agentId: input.agentId,
      ...(input.basePath ? { basePath: input.basePath } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
  });
}

function revealPath(input: {
  path: string;
  basePath?: string | null;
  agentId: string;
  sessionId?: string | null;
}) {
  void revealLocalPath(input).catch((error) => {
    console.warn("Failed to reveal local path", error);
  });
}

export function AgentsInspector() {
  const { route, agents, navigate } = useScout();
  if (route.view !== "agents") return null;

  const agent = route.agentId
    ? agents.find((a) => a.id === route.agentId) ?? null
    : null;

  if (!agent) {
    const working = agents.filter((a) => isAgentOnline(a.state)).length;
    return (
      <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
        <Row label="Total" value={`${agents.length}`} />
        <Row label="Working" value={`${working}`} />
        <Row label="Available" value={`${agents.length - working}`} />
        <div className="mt-2 text-[10px] font-mono uppercase tracking-[0.15em] leading-relaxed text-[var(--scout-chrome-ink-ghost)]">
          Select an agent from the roster to see its context here.
        </div>
      </div>
    );
  }

  return (
    <AgentContextPanel
      agent={agent}
      agents={agents}
      navigate={navigate}
      route={route}
      observeMode={route.tab === "observe"}
    />
  );
}

function AgentContextPanel({
  agent,
  agents,
  navigate,
  route,
  observeMode,
}: {
  agent: Agent;
  agents: Agent[];
  navigate: (r: Route) => void;
  route: Route;
  observeMode: boolean;
}) {
  const online = isAgentOnline(agent.state);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [sessionCatalog, setSessionCatalog] = useState<SessionCatalogWithResume | null>(null);

  const load = useCallback(async () => {
    const [fleetResult, catalogResult] = await Promise.all([
      api<FleetState>("/api/fleet").catch(() => null),
      api<SessionCatalogWithResume>(
        `/api/agents/${encodeURIComponent(agent.id)}/session-catalog`,
      ).catch(() => null),
    ]);
    if (fleetResult) setFleet(fleetResult);
    setSessionCatalog(catalogResult);
  }, [agent.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setSessionCatalog(null);
  }, [agent.id]);
  useBrokerEvents(() => {
    void load();
  });

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      {/* Identity */}
      <div className="flex items-center gap-3 border-b border-[var(--scout-chrome-border-soft)] pb-3">
        <div
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-mono text-[var(--scout-chrome-avatar-ink)]"
          style={{ background: actorColor(agent.name) }}
        >
          {agent.name[0]?.toUpperCase() ?? "?"}
          {online && (
            <span
              className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--hud-bg)]"
              style={{
                background: stateColor(agent.state),
                opacity: normalizeAgentState(agent.state) === "working" ? 0.85 : 0.6,
              }}
            />
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate text-[13px] text-[var(--scout-chrome-ink-strong)]">
            {agent.name}
          </span>
          {agent.handle && (
            <span className="text-[10px] font-mono text-cyan-400/70">
              @{agent.handle}
            </span>
          )}
        </div>
      </div>

      {/* State */}
      <Section label="State">
        <div className="flex items-baseline gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: stateColor(agent.state),
              opacity: online ? 1 : 0.4,
            }}
          />
          <span className="text-[12px] capitalize text-[var(--scout-chrome-ink)]">
            {agentStateLabel(agent.state)}
          </span>
        </div>
        {agent.updatedAt && (
          <div className="mt-1 text-[10px] font-mono text-[var(--scout-chrome-ink-faint)]">
            Updated {timeAgo(agent.updatedAt)}
          </div>
        )}
      </Section>

      {/* Presence mesh */}
      <Section label="Presence">
        <InspectorMesh
          focusAgent={agent}
          agents={agents}
          onOpenAgent={(target) =>
            openAgent(navigate, target, { from: "inspector", returnTo: route })
          }
        />
      </Section>

      {observeMode && <ObserveContext agentId={agent.id} />}

      {/* Incoming asks */}
      {fleet && (
        <InspectorAsks
          asks={fleet.activeAsks}
          agentId={agent.id}
          navigate={navigate}
        />
      )}

      {/* Identity detail */}
      <Section label="Identity">
        <Row label="Class" value={agent.agentClass} />
        {agent.role && <Row label="Role" value={agent.role} />}
        {agent.harness && <Row label="Harness" value={agent.harness} />}
        {agent.transport && <Row label="Transport" value={agent.transport} />}
        {(agent.homeNodeName || agent.homeNodeId) && (
          <Row label="Host" value={shortHostLabel(agent.homeNodeName ?? agent.homeNodeId ?? "")} />
        )}
      </Section>

      {/* Project */}
      {(agent.project || agent.branch || agent.cwd) && (
        <Section label="Project">
          {agent.project && <Row label="Name" value={agent.project} />}
          {agent.branch && <Row label="Branch" value={agent.branch} />}
          {agent.cwd && <Row label="Cwd" value={agent.cwd} />}
        </Section>
      )}

      {/* Capabilities */}
      {agent.capabilities.length > 0 && (
        <Section label={`Capabilities · ${agent.capabilities.length}`}>
          <div className="flex flex-wrap gap-1">
            {agent.capabilities.map((cap) => (
              <span
                key={cap}
                className="rounded-sm bg-[var(--scout-chrome-hover)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--scout-chrome-ink-soft)]"
              >
                {cap}
              </span>
            ))}
          </div>
        </Section>
      )}

      <RunningSessions
        agent={agent}
        catalog={sessionCatalog}
        navigate={navigate}
        returnTo={route}
      />
    </div>
  );
}

function RunningSessions({
  agent,
  catalog,
  navigate,
  returnTo,
}: {
  agent: Agent;
  catalog: SessionCatalogWithResume | null;
  navigate: (r: Route) => void;
  returnTo: Route;
}) {
  const showContextMenu = useContextMenu();
  const activeSessionId = catalog?.activeSessionId
    ?? (agent.transport === "tmux" ? agent.harnessSessionId : null);
  const sessions = useMemo(
    () => buildRunningSessions(agent, catalog, activeSessionId),
    [agent, catalog, activeSessionId],
  );
  const running = sessions.filter((session) =>
    session.id === activeSessionId || !session.endedAt
  );
  const visible = running.slice(0, 5);
  if (visible.length === 0) return null;
  const openTerminal = (mode: "observe" | "takeover") =>
    openContent(navigate, { view: "terminal", agentId: agent.id, mode }, { returnTo });
  const runTakeover = () => {
    if (agent.transport === "tmux") {
      openTerminal("takeover");
      return;
    }
    if (!catalog?.resumeCommand) return;
    void queueTakeover({
      command: catalog.resumeCommand,
      cwd: catalog.resumeCwd,
      agentId: agent.id,
    }).then(() => openTerminal("takeover"));
  };
  const openSessionDetail = (sessionId: string) =>
    openContent(navigate, { view: "sessions", sessionId }, { returnTo });
  const sessionMenuItems = (
    session: SessionCatalogEntry,
    canObserveTerminal: boolean,
    canTakeover: boolean,
  ): MenuItem[] => {
    const items: MenuItem[] = [];
    if (canObserveTerminal) {
      items.push({
        kind: "action",
        label: "Observe in terminal",
        onSelect: () => openTerminal("observe"),
      });
    }
    if (canTakeover) {
      items.push({
        kind: "action",
        label: "Takeover terminal",
        onSelect: runTakeover,
      });
    }
    if (items.length > 0) {
      items.push({ kind: "separator" });
    }
    items.push({
      kind: "action",
      label: "Open session detail",
      onSelect: () => openSessionDetail(session.id),
    });
    items.push({
      kind: "action",
      label: "Open agent profile",
      onSelect: () => openAgent(navigate, agent, { from: "inspector", returnTo }),
    });
    return items;
  };

  return (
    <Section label={`Running sessions · ${running.length}`}>
      <div className="flex flex-col gap-1.5">
        {visible.map((session) => {
          const active = session.id === activeSessionId;
          const canObserveTerminal = active && agent.transport === "tmux";
          const canTakeover = active && (agent.transport === "tmux" || Boolean(catalog?.resumeCommand));
          const age = timeAgo(session.startedAt) || "recent";
          const harnessLabel = session.transport ?? session.harness ?? agent.transport ?? agent.harness ?? "session";
          const lowerMeta = active
            ? age
            : session.endedAt
              ? `${timeAgo(session.endedAt) || age} ended`
              : harnessLabel;
          const menuItems = sessionMenuItems(session, canObserveTerminal, canTakeover);
          return (
            <div
              key={session.id}
              onContextMenu={(event) => showContextMenu(event, menuItems)}
              className={`rounded border px-2 py-1.5 transition-colors ${
                active
                  ? "border-cyan-400/40 bg-cyan-400/[0.08]"
                  : "border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)]"
              }`}
            >
              <button
                type="button"
                title={canObserveTerminal
                  ? `Observe tmux terminal ${session.id}`
                  : `Open session ${session.id}`}
                onClick={() =>
                  canObserveTerminal
                    ? openTerminal("observe")
                    : openSessionDetail(session.id)
                }
                className="flex w-full items-center justify-between gap-2 bg-transparent p-0 text-left"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {active && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                    )}
                    <span className="truncate font-mono text-[10.5px] text-[var(--scout-chrome-ink)]">
                      {shortSessionId(session.id)}
                    </span>
                    <span className="shrink-0 rounded-sm bg-[var(--scout-chrome-hover)] px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-faint)]">
                      {harnessLabel}
                    </span>
                  </span>
                  <span className="mt-0.5 truncate font-mono text-[9px] text-[var(--scout-chrome-ink-faint)]">
                    {session.cwd ? pathLeaf(session.cwd) : "workspace"}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-cyan-400/70">
                    {active ? "active" : "running"}
                  </span>
                  <span className="mt-0.5 max-w-[78px] truncate font-mono text-[9px] text-[var(--scout-chrome-ink-ghost)]">
                    {lowerMeta}
                  </span>
                </span>
              </button>
              <button
                type="button"
                title="Session actions"
                onClick={(event) => showContextMenu(event, menuItems)}
                className="mt-1.5 h-5 rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-1.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-active)] hover:text-[var(--scout-chrome-ink)]"
              >
                ...
              </button>
            </div>
          );
        })}
        {running.length > visible.length && (
          <div className="px-1 pt-0.5 font-mono text-[9px] text-[var(--scout-chrome-ink-ghost)]">
            {running.length - visible.length} more running
          </div>
        )}
      </div>
    </Section>
  );
}

function buildRunningSessions(
  agent: Agent,
  catalog: SessionCatalogWithResume | null,
  activeSessionId: string | null,
): SessionCatalogEntry[] {
  const sessions = [...(catalog?.sessions ?? [])];
  if (
    agent.transport === "tmux" &&
    activeSessionId &&
    !sessions.some((session) => session.id === activeSessionId)
  ) {
    sessions.unshift({
      id: activeSessionId,
      startedAt: agent.createdAt ?? agent.updatedAt ?? Date.now(),
      cwd: agent.cwd ?? agent.projectRoot ?? ".",
      ...(agent.harness ? { harness: agent.harness } : {}),
      ...(agent.transport ? { transport: agent.transport } : {}),
      model: agent.model,
    });
  }

  return sessions.sort((a, b) => {
    const left = a.endedAt ?? a.startedAt;
    const right = b.endedAt ?? b.startedAt;
    return compareTimestampsDesc(left, right);
  });
}

function shortSessionId(value: string): string {
  const compact = value.replace(/^session[_:-]?/i, "");
  return compact.length > 10 ? compact.slice(0, 8) : compact;
}

function ObserveContext({ agentId }: { agentId: string }) {
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);

  const load = useCallback(async () => {
    const result = await api<AgentObservePayload>(
      `/api/agents/${encodeURIComponent(agentId)}/observe`,
    ).catch(() => null);
    setObserve(result);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  if (!observe?.data) {
    return (
      <Section label="Trace">
        <div className="text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
          Resolving session trace.
        </div>
      </Section>
    );
  }

  return <ObserveStats agentId={agentId} data={observe.data} sessionId={observe.sessionId} />;
}

function ObserveStats({
  agentId,
  data,
  sessionId,
}: {
  agentId: string;
  data: ObserveData;
  sessionId: string | null;
}) {
  const sessionMeta = data.metadata?.session;
  const events = data.events;
  const files = data.files;
  const toolCount = events.filter((e) => e.kind === "tool").length;
  const thinkCount = events.filter((e) => e.kind === "think").length;
  const askCount = events.filter((e) => e.kind === "ask").length;
  const readCount = events.filter(
    (e) => e.kind === "tool" && e.tool === "read",
  ).length;
  const editCount = events.filter(
    (e) => e.kind === "tool" && (e.tool === "edit" || e.tool === "write"),
  ).length;
  const observedWindowSeconds = events.length > 0 ? events[events.length - 1]!.t : 0;
  const sourcePath = sessionMeta?.threadPath;

  return (
    <>
      <Section label="Session">
        {sessionId && <Row label="Active" value={sessionId.slice(0, 8)} />}
        {sourcePath && (
          <PathRow
            label="Source"
            path={sourcePath}
            basePath={sessionMeta?.cwd ?? null}
            value={pathLeaf(sourcePath)}
            agentId={agentId}
            sessionId={sessionId}
          />
        )}
        {sessionMeta?.cwd && (
          <PathRow
            label="Workspace"
            path={sessionMeta.cwd}
            value={sessionMeta.cwd}
            agentId={agentId}
            sessionId={sessionId}
          />
        )}
      </Section>

      <Section label="Trace stats">
        <div className="grid grid-cols-2 gap-1.5">
          <TraceMetric label="Turns" value={fmtCompactNumber(sessionMeta?.turnCount ?? 0)} />
          <TraceMetric label="Tools" value={fmtCompactNumber(toolCount)} />
          <TraceMetric label="Thinks" value={fmtCompactNumber(thinkCount)} />
          <TraceMetric label="Asks" value={fmtCompactNumber(askCount)} />
          <TraceMetric label="Reads" value={fmtCompactNumber(readCount)} />
          <TraceMetric label="Edits" value={fmtCompactNumber(editCount)} />
          <TraceMetric label="Files" value={fmtCompactNumber(files.length)} />
          <TraceMetric label="Window" value={fmtWindowSpan(observedWindowSeconds)} />
        </div>
      </Section>

      {files.length > 0 && (
        <Section label={`Files touched · ${files.length}`}>
          <div className="flex flex-col gap-1">
            {files.slice(0, 8).map((file) => (
              <button
                type="button"
                key={file.path}
                title={file.path}
                onClick={() => revealPath({
                  path: file.path,
                  basePath: sessionMeta?.cwd ?? null,
                  agentId,
                  sessionId,
                })}
                className="flex items-center justify-between gap-2 rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-2 py-1 text-left hover:border-[var(--accent)]"
              >
                <span className="min-w-0 truncate font-mono text-[10px] text-[var(--scout-chrome-ink-soft)]">
                  {file.path}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-[var(--scout-chrome-ink-faint)]">
                  x{file.touches}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function PathRow({
  label,
  path,
  basePath,
  value,
  agentId,
  sessionId,
}: {
  label: string;
  path: string;
  basePath?: string | null;
  value: string;
  agentId: string;
  sessionId?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-[var(--scout-chrome-ink-faint)]">
        {label}
      </span>
      <button
        type="button"
        title={`Reveal ${path}`}
        onClick={() => revealPath({ path, basePath, agentId, sessionId })}
        className="min-w-0 truncate bg-transparent p-0 text-right font-mono text-[11px] text-cyan-400/80 hover:text-[var(--scout-chrome-ink)] hover:underline"
      >
        {value}
      </button>
    </div>
  );
}

function TraceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-2 py-1.5">
      <div className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[12px] text-[var(--scout-chrome-ink)]">
        {value}
      </div>
    </div>
  );
}

function InspectorMesh({
  focusAgent,
  agents,
  onOpenAgent,
}: {
  focusAgent: Agent;
  agents: Agent[];
  onOpenAgent: (agent: Agent) => void;
}) {
  const W = 240;
  const H = 180;
  const CX = W / 2;
  const CY = H / 2;
  const R = 68;
  const others = useMemo(() => {
    const peers = agents.filter((a) => a.id !== focusAgent.id);
    const stateRank = (s: string) => {
      const n = normalizeAgentState(s);
      if (n === "working") return 0;
      if (n === "available") return 1;
      return 2;
    };
    return peers
      .slice()
      .sort((a, b) => {
        const sa = stateRank(a.state ?? "");
        const sb = stateRank(b.state ?? "");
        if (sa !== sb) return sa - sb;
        return compareTimestampsDesc(a.updatedAt, b.updatedAt);
      })
      .slice(0, 8);
  }, [agents, focusAgent.id]);

  const nodes = useMemo(() => {
    const result: Array<{
      agent: Agent;
      x: number;
      y: number;
      focused: boolean;
    }> = [{ agent: focusAgent, x: CX, y: CY, focused: true }];
    others.forEach((a, i) => {
      const angle =
        (2 * Math.PI * i) / Math.max(others.length, 1) - Math.PI / 2;
      result.push({
        agent: a,
        x: CX + R * Math.cos(angle),
        y: CY + R * Math.sin(angle),
        focused: false,
      });
    });
    return result;
  }, [focusAgent, others, CX, CY, R]);

  return (
    <div className="flex flex-wrap items-start gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block shrink-0 w-full"
        style={{ maxWidth: W }}
        xmlns="http://www.w3.org/2000/svg"
      >
      <defs>
        <radialGradient id="inspMeshGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.06" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r={R + 14} fill="url(#inspMeshGlow)" />
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke="var(--border)"
        strokeDasharray="2 4"
      />

      {nodes.slice(1).map((n, i) => (
        <g key={`e-${n.agent.id}`}>
          <line
            x1={CX}
            y1={CY}
            x2={n.x}
            y2={n.y}
            stroke="var(--accent)"
            strokeWidth={1}
            opacity={0.6}
          />
          <circle r={2} fill="var(--accent)">
            <animateMotion
              dur={`${2 + i * 0.3}s`}
              repeatCount="indefinite"
              path={`M ${CX},${CY} L ${n.x},${n.y}`}
            />
          </circle>
        </g>
      ))}

      {nodes.map((n) => {
        const nState = normalizeAgentState(n.agent.state);
        const isActive = nState === "working" || nState === "available";
        const r = n.focused ? 14 : 9;
        return (
          <g
            key={n.agent.id}
            style={{ cursor: "pointer" }}
            onClick={() => onOpenAgent(n.agent)}
          >
            {isActive && (
              <circle
                cx={n.x}
                cy={n.y}
                r={r + 5}
                fill="none"
                stroke={actorColor(n.agent.name)}
                strokeWidth={0.8}
                opacity={0.3}
              >
                <animate
                  attributeName="r"
                  values={`${r};${r + 8};${r}`}
                  dur="2.5s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.3;0;0.3"
                  dur="2.5s"
                  repeatCount="indefinite"
                />
              </circle>
            )}
            <circle
              cx={n.x}
              cy={n.y}
              r={r}
              fill={actorColor(n.agent.name)}
              stroke={n.focused ? "var(--accent)" : "var(--surface)"}
              strokeWidth={n.focused ? 1.5 : 1}
            />
            <text
              x={n.x}
              y={n.y}
              dy="0.35em"
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={n.focused ? 10 : 8}
              fontWeight={600}
              fill="var(--scout-chrome-avatar-ink)"
            >
              {n.agent.name[0].toUpperCase()}
            </text>
            <text
              x={n.x}
              y={n.y + r + 10}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={8}
              fill="var(--dim)"
              letterSpacing="0.04em"
            >
              {n.agent.name.length > 9
                ? n.agent.name.slice(0, 8) + "..."
                : n.agent.name}
            </text>
          </g>
        );
      })}
      </svg>
      {others.length > 0 && (
        <ul className="flex-1 min-w-[120px] flex flex-col gap-1 m-0 p-0 list-none">
          {others.map((peer) => {
            const nState = normalizeAgentState(peer.state);
            return (
              <li key={peer.id}>
                <button
                  type="button"
                  onClick={() => onOpenAgent(peer)}
                  className="w-full flex items-center gap-2 py-1 px-1.5 rounded hover:bg-[var(--surface-hover)] text-left"
                >
                  <span
                    aria-hidden
                    className="shrink-0 w-2 h-2 rounded-full"
                    style={{ background: actorColor(peer.name) }}
                  />
                  <span className="flex-1 truncate text-[11px] font-mono text-[var(--scout-chrome-ink)]">
                    {peer.name}
                  </span>
                  <span
                    aria-hidden
                    title={agentStateLabel(peer.state)}
                    className="shrink-0 w-1.5 h-1.5 rounded-full"
                    style={{ background: stateColor(nState) }}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function InspectorAsks({
  asks,
  agentId,
  navigate,
}: {
  asks: FleetAsk[];
  agentId: string;
  navigate: (r: Route) => void;
}) {
  const relevant = asks.filter(
    (a) =>
      a.agentId === agentId &&
      (a.status === "needs_attention" || a.status === "queued"),
  );
  if (relevant.length === 0) return null;

  return (
    <Section label={`Incoming asks · ${relevant.length}`}>
      <div className="flex flex-col gap-2">
        {relevant.map((ask) => (
          <div
            key={ask.invocationId}
            className="p-2.5 rounded-md border border-amber-500/30 bg-amber-500/[0.04] cursor-pointer hover:bg-amber-500/[0.08] transition-colors"
            onClick={() => {
              if (ask.conversationId) {
                navigate({
                  view: "agents",
                  agentId,
                  conversationId: ask.conversationId,
                });
              }
            }}
          >
            <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-amber-500/80 mb-1">
              awaiting
            </div>
            <div className="line-clamp-2 text-[11px] leading-relaxed text-[var(--scout-chrome-ink)]">
              {ask.summary ?? ask.task}
            </div>
            <div className="mt-1.5 text-[9px] font-mono text-[var(--scout-chrome-ink-ghost)]">
              {ask.harness ?? "operator"} &rarr; {ask.agentName ?? "agent"}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-[var(--scout-chrome-ink-faint)]">
        {label}
      </span>
      <span className="truncate text-[11px] font-mono text-[var(--scout-chrome-ink)]">
        {value}
      </span>
    </div>
  );
}
