import "./warroom-view.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { actorColor } from "../lib/colors.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import { getMockToolTicker } from "../lib/ops-mock-data.ts";
import type { Agent, FleetState, Route, ToolTickerItem } from "../lib/types.ts";

function formatHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function WarRoomView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [tick, setTick] = useState(0);
  const [breachSec, setBreachSec] = useState(268);

  const load = useCallback(async () => {
    try {
      setFleet(await api<FleetState>("/api/fleet"));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  useEffect(() => {
    const i = setInterval(() => {
      setTick((t) => t + 1);
      setBreachSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const onlineCount = agents.filter((a) => normalizeAgentState(a.state) !== "offline").length;
  const needsAttention = fleet?.needsAttention ?? [];
  const activeAsks = fleet?.activeAsks ?? [];
  const toolTicker = getMockToolTicker();

  const waveform = useMemo(() => {
    const N = 180;
    return Array.from({ length: N }, (_, i) => {
      const t = i / N;
      return (
        0.5 +
        0.35 * Math.sin(t * 8 + 0.7) * Math.cos(t * 3) +
        0.15 * Math.sin(t * 22) +
        (Math.random() - 0.5) * 0.08
      );
    });
  }, []);

  return (
    <div className="s-warroom">
      {/* Top strip */}
      <div className="s-warroom-topstrip">
        <div className="s-warroom-topstrip-left">
          <span className="s-ops-label">▸ War Room</span>
        </div>
        <div className="s-warroom-topstrip-center">
          OPERATIONS · {new Date().toISOString().slice(0, 19).replace("T", " ")}Z
        </div>
        <div className="s-warroom-topstrip-right">
          <Telemetry label="Agents" value={`${onlineCount}/${agents.length}`} />
          <Telemetry label="Threads" value={String(fleet?.totals.activity ?? 0)} />
          <Telemetry label="Asks" value={String(activeAsks.length)} warn={activeAsks.length > 0} />
          <Telemetry label="Cost/h" value="$3.14" />
        </div>
      </div>

      {/* Main grid */}
      <div className="s-warroom-grid">
        {/* Left: SLA breach + asks */}
        <div className="s-warroom-panel">
          <div className="s-ops-label" style={{ marginBottom: 12 }}>◌ Asks · Awaiting</div>
          <div className="s-warroom-breach">
            <div className="s-warroom-breach-clock">{formatHMS(breachSec)}</div>
            <div className="s-warroom-breach-sub">
              Oldest unresolved · {needsAttention[0]?.agentName ?? "none"}
            </div>
          </div>

          {needsAttention.slice(0, 3).map((item) => (
            <div key={item.recordId} className="s-warroom-ask-card">
              <div className="s-warroom-ask-header">
                <div
                  className="s-ops-avatar"
                  style={{ "--size": "18px", background: actorColor(item.agentName ?? "?") } as React.CSSProperties}
                >
                  {(item.agentName ?? "?")[0]?.toUpperCase()}
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
                  {item.agentName ?? "unknown"}
                </span>
              </div>
              <div className="s-warroom-ask-body">
                {(item.title ?? item.summary ?? "").slice(0, 110)}
              </div>
            </div>
          ))}

          <div className="s-ops-label" style={{ marginTop: 16 }}>○ Blockers</div>
          <div className="s-warroom-blockers">
            {needsAttention.length === 0 && activeAsks.length === 0 ? (
              <div style={{ color: "var(--dim)" }}>No blockers</div>
            ) : (
              <>
                {needsAttention.map((item) => (
                  <div key={item.recordId} className="s-warroom-blockers-item--high">
                    ▲ {item.title ?? "Unresolved item"}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Center: mesh visualization */}
        <div className="s-warroom-panel s-warroom-mesh">
          <div className="s-warroom-mesh-label">
            <span className="s-ops-label">◉ Mesh · Live</span>
          </div>
          <WarMesh agents={agents} />
        </div>

        {/* Right: tool stream + cost */}
        <div className="s-warroom-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="s-ops-label">›_ Tool stream</div>
          <ToolStream items={toolTicker} agents={agents} tick={tick} />
          <div className="s-ops-label">$ Burn</div>
          <div className="s-warroom-burn-grid">
            <BurnTile num="1.2M" label="tok/h" />
            <BurnTile num="$3.14" label="usd/h" />
            <BurnTile num="42%" label="sonnet" />
            <BurnTile num="58%" label="opus" />
          </div>
        </div>

        {/* Bottom: waveform */}
        <div className="s-warroom-waveform-panel">
          <div className="s-warroom-waveform-header">
            <span className="s-ops-label">⌇ Fleet activity · Last 60m</span>
            <span className="s-warroom-waveform-meta">events/min · rolling</span>
            <span style={{ flex: 1 }} />
            <span className="s-warroom-waveform-meta">peak 142 · now 87</span>
          </div>
          <Waveform values={waveform} tick={tick} />
        </div>
      </div>
    </div>
  );
}

function Telemetry({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="s-warroom-telemetry">
      <div className="s-warroom-telemetry-label">{label}</div>
      <div className={`s-warroom-telemetry-value${warn ? " s-warroom-telemetry-value--warn" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function ToolStream({ items, agents, tick }: { items: ToolTickerItem[]; agents: Agent[]; tick: number }) {
  return (
    <div className="s-warroom-ticker">
      {items.map((item, i) => {
        const age = (tick + i * 2) % 20;
        const fade = age < 16 ? 1 : (20 - age) / 4;
        return (
          <div key={i} className="s-warroom-ticker-line" style={{ opacity: fade * (1 - i * 0.05) }}>
            <span className="s-warroom-ticker-agent">{item.agent}</span>
            <span className="s-warroom-ticker-sep">›</span>
            <span className="s-warroom-ticker-tool">{item.tool}</span>
            <span className="s-warroom-ticker-result">{item.result}</span>
          </div>
        );
      })}
    </div>
  );
}

function BurnTile({ num, label }: { num: string; label: string }) {
  return (
    <div className="s-warroom-burn-tile">
      <div className="s-warroom-burn-num">{num}</div>
      <div className="s-warroom-burn-label">{label}</div>
    </div>
  );
}

function WarMesh({ agents }: { agents: Agent[] }) {
  const W = 800;
  const H = 480;

  const positions = useMemo(() => {
    if (agents.length === 0) return {};
    const cx = 0.5;
    const cy = 0.5;
    const r = 0.3;
    const map: Record<string, { x: number; y: number }> = {};
    agents.forEach((a, i) => {
      const angle = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
      map[a.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
    return map;
  }, [agents]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%" }}>
      <defs>
        <pattern id="warGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
        </pattern>
        <radialGradient id="warGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.1" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#warGrid)" />
      <circle cx={W / 2} cy={H / 2} r={200} fill="url(#warGlow)" />

      {/* Edges between all agents (simplified) */}
      {agents.flatMap((a, i) =>
        agents.slice(i + 1).map((b) => {
          const pa = positions[a.id];
          const pb = positions[b.id];
          if (!pa || !pb) return null;
          return (
            <line
              key={`${a.id}-${b.id}`}
              x1={pa.x * W}
              y1={pa.y * H}
              x2={pb.x * W}
              y2={pb.y * H}
              stroke="var(--dim)"
              strokeWidth="0.8"
              opacity="0.3"
            />
          );
        }),
      )}

      {/* Nodes */}
      {agents.map((a) => {
        const p = positions[a.id];
        if (!p) return null;
        const x = p.x * W;
        const y = p.y * H;
        const color = actorColor(a.name);
        const isActive = normalizeAgentState(a.state) === "working";
        return (
          <g key={a.id} transform={`translate(${x}, ${y})`}>
            {isActive && (
              <circle r="18" fill="none" stroke={color} strokeWidth="1" opacity="0.5">
                <animate attributeName="r" values="18;30;18" dur="2.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite" />
              </circle>
            )}
            <circle r="18" fill={color} stroke="var(--bg)" strokeWidth="2" />
            <text
              textAnchor="middle"
              dy="0.35em"
              fontFamily="var(--font-mono)"
              fontSize="14"
              fontWeight="600"
              fill="rgba(0,0,0,0.7)"
            >
              {a.name[0]?.toUpperCase()}
            </text>
            <text
              textAnchor="middle"
              y={36}
              fontFamily="var(--font-mono)"
              fontSize="10"
              fill="var(--muted)"
              letterSpacing="0.1em"
            >
              {a.name.toUpperCase()}
            </text>
            <text
              textAnchor="middle"
              y={48}
              fontFamily="var(--font-mono)"
              fontSize="8.5"
              fill="var(--dim)"
              letterSpacing="0.08em"
            >
              {normalizeAgentState(a.state).toUpperCase()} · {a.project ?? "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Waveform({ values, tick }: { values: number[]; tick: number }) {
  const W = 1000;
  const H = 80;
  const N = values.length;
  const shifted = values.map((_, i) => values[(i + tick) % N]);
  const pts = shifted.map((v, i) => `${(i / (N - 1)) * W},${H - v * (H - 8) - 4}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 80, display: "block" }}>
      <defs>
        <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill="url(#waveFill)" />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.2" />
    </svg>
  );
}
