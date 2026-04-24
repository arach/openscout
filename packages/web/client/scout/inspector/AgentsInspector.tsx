import { useCallback, useEffect, useMemo, useState } from "react";
import { useScout } from "../Provider.tsx";
import {
  agentStateLabel,
  isAgentOnline,
  normalizeAgentState,
} from "../../lib/agent-state.ts";
import { actorColor, stateColor } from "../../lib/colors.ts";
import { timeAgo } from "../../lib/time.ts";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import type { Agent, FleetAsk, FleetState, Route } from "../../lib/types.ts";

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
    <AgentContextPanel agent={agent} agents={agents} navigate={navigate} />
  );
}

function AgentContextPanel({
  agent,
  agents,
  navigate,
}: {
  agent: Agent;
  agents: Agent[];
  navigate: (r: Route) => void;
}) {
  const online = isAgentOnline(agent.state);
  const [fleet, setFleet] = useState<FleetState | null>(null);

  const load = useCallback(async () => {
    const result = await api<FleetState>("/api/fleet").catch(() => null);
    if (result) setFleet(result);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
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
          navigate={navigate}
        />
      </Section>

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
    </div>
  );
}

function InspectorMesh({
  focusAgent,
  agents,
  navigate,
}: {
  focusAgent: Agent;
  agents: Agent[];
  navigate: (r: Route) => void;
}) {
  const W = 240;
  const H = 180;
  const CX = W / 2;
  const CY = H / 2;
  const R = 68;
  const others = agents.filter((a) => a.id !== focusAgent.id).slice(0, 8);

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
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full block"
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
            onClick={() =>
              navigate({ view: "agents", agentId: n.agent.id })
            }
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
