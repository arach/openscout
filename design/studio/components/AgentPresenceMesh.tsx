/**
 * AgentPresenceMesh — radial SVG topology around a focused agent.
 *
 * Center node = the agent the operator opened. Peers orbit at a fixed
 * radius, placed by polar coordinates. Each peer's fill is its state
 * color so a glance shows the cohort's health.
 *
 * v1 is static; the scout production version animates pulses along the
 * connection lines via SVG <animateMotion>. We stay still here to keep
 * the study readable in a side-by-side.
 *
 * Lifted from: packages/web/client/scout/inspector/AgentsInspector.tsx:433-584
 */
import { AGENT_STATE_COLOR, type AgentState } from "./AgentPresenceDot";
import { avatarColor } from "./AgentRow";

interface AgentPresenceMeshProps {
  focus: { name: string };
  peers: { name: string; state: AgentState }[];
}

export function AgentPresenceMesh({ focus, peers }: AgentPresenceMeshProps) {
  const W = 240;
  const H = 180;
  const CX = W / 2;
  const CY = H / 2;
  const R = 68;

  const nodes = peers.slice(0, 8).map((peer, i, arr) => {
    const angle = (2 * Math.PI * i) / Math.max(arr.length, 1) - Math.PI / 2;
    return {
      ...peer,
      x: CX + R * Math.cos(angle),
      y: CY + R * Math.sin(angle),
    };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="studioMeshGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--scout-accent)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--scout-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx={CX} cy={CY} r={R + 14} fill="url(#studioMeshGlow)" />
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke="var(--studio-edge-strong)"
        strokeDasharray="2 4"
      />

      {nodes.map((n) => (
        <line
          key={`line-${n.name}`}
          x1={CX}
          y1={CY}
          x2={n.x}
          y2={n.y}
          stroke={AGENT_STATE_COLOR[n.state]}
          strokeOpacity={0.4}
          strokeWidth={1}
        />
      ))}

      {/* Focus node */}
      <g>
        <circle
          cx={CX}
          cy={CY}
          r={19}
          fill="none"
          stroke="var(--scout-accent)"
          strokeOpacity={0.25}
        />
        <circle
          cx={CX}
          cy={CY}
          r={14}
          fill={avatarColor(focus.name)}
          stroke="var(--scout-accent)"
          strokeWidth={1.5}
        />
        <text
          x={CX}
          y={CY}
          dy="0.35em"
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize={11}
          fontWeight={600}
          fill="var(--studio-canvas)"
        >
          {focus.name[0]?.toUpperCase()}
        </text>
        <text
          x={CX}
          y={CY + 26}
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize={8}
          fill="var(--studio-ink-faint)"
          letterSpacing="0.04em"
        >
          {focus.name}
        </text>
      </g>

      {/* Peers */}
      {nodes.map((n) => {
        const stateColor = AGENT_STATE_COLOR[n.state];
        const isActive = n.state === "working" || n.state === "available";
        return (
          <g key={`peer-${n.name}`}>
            {isActive && (
              <circle
                cx={n.x}
                cy={n.y}
                r={14}
                fill="none"
                stroke={stateColor}
                strokeWidth={0.8}
                opacity={0.4}
              />
            )}
            <circle
              cx={n.x}
              cy={n.y}
              r={9}
              fill={avatarColor(n.name)}
              stroke="var(--studio-surface)"
              strokeWidth={1}
            />
            <circle
              cx={n.x + 7}
              cy={n.y + 7}
              r={2.4}
              fill={stateColor}
              stroke="var(--studio-surface)"
              strokeWidth={1}
            />
            <text
              x={n.x}
              y={n.y}
              dy="0.35em"
              textAnchor="middle"
              fontFamily="var(--font-mono, monospace)"
              fontSize={8}
              fontWeight={600}
              fill="var(--studio-canvas)"
            >
              {n.name[0]?.toUpperCase()}
            </text>
            <text
              x={n.x}
              y={n.y + 19}
              textAnchor="middle"
              fontFamily="var(--font-mono, monospace)"
              fontSize={7.5}
              fill="var(--studio-ink-faint)"
              letterSpacing="0.04em"
            >
              {n.name.length > 9 ? n.name.slice(0, 8) + "…" : n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
