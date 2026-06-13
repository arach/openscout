"use client";

import { useEffect, useState } from "react";

type Anchor = "start" | "middle" | "end";

type MeshNode = {
  x: number;
  y: number;
  label: string;
  anchor: Anchor;
  dx: number;
  dy: number;
};

// Broker is the hub, but the plate is deliberately asymmetric — spokes vary in
// length and angle so the figure reads as a survey of a real network, not a
// clip-art star. Label offsets are tuned so no line passes through a label.
const BROKER = 5;

const NODES: MeshNode[] = [
  { x: 58,  y: 34,  label: "cli·hudson",   anchor: "start",  dx: 8,  dy: 3 },
  { x: 232, y: 26,  label: "mac·atlas",    anchor: "start",  dx: 7,  dy: -6 },
  { x: 346, y: 62,  label: "iphone·orin",  anchor: "end",    dx: -3, dy: -9 },
  { x: 92,  y: 118, label: "ide·arc",      anchor: "start",  dx: 9,  dy: 4 },
  { x: 282, y: 126, label: "web·echo",     anchor: "start",  dx: 8,  dy: 3 },
  { x: 172, y: 80,  label: "scout",        anchor: "middle", dx: 0,  dy: 17 },
];

// Routes through the broker (solid). Peer-to-peer mesh links are rendered
// separately, dashed and quieter, and kept clearly diagonal so they never
// mimic the card border.
const ROUTES: number[] = [0, 1, 2, 3, 4];
const MESH: [number, number][] = [
  [0, 3],
  [2, 4],
];

// A short conversation across the mesh: each packet hops sender → broker →
// recipient, illustrating a handoff. Staggered so roughly one is in flight at a
// time, reading as a sequence of steps rather than ambient noise.
const seg = (a: number, b: number) =>
  `M${NODES[a].x},${NODES[a].y} L${NODES[BROKER].x},${NODES[BROKER].y} L${NODES[b].x},${NODES[b].y}`;
const TRIPS: string[] = [
  seg(0, 1), // hudson → broker → atlas
  seg(1, 4), // atlas  → broker → echo
  seg(3, 2), // arc    → broker → orin
];
const CYCLE = 4.5;
const STAGGER = CYCLE / TRIPS.length;

export function MeshFigureSvg() {
  const [motion, setMotion] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotion(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <div className="mesh-figure">
      <div className="mesh-figure__chrome">
        <span>scout-001.conn</span>
        <span className="mesh-figure__zoom">⌕ 25% ⊕</span>
      </div>
      <svg
        viewBox="0 0 400 150"
        className="mesh-figure__svg"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        {/* peer-to-peer mesh — the quiet layer */}
        {MESH.map(([a, b], i) => (
          <line
            key={`m-${i}`}
            x1={NODES[a].x}
            y1={NODES[a].y}
            x2={NODES[b].x}
            y2={NODES[b].y}
            className="mesh-figure__link mesh-figure__link--mesh"
          />
        ))}

        {/* broker routes — every peer is reachable through the hub */}
        {ROUTES.map((p, i) => (
          <line
            key={`r-${i}`}
            x1={NODES[BROKER].x}
            y1={NODES[BROKER].y}
            x2={NODES[p].x}
            y2={NODES[p].y}
            className="mesh-figure__link mesh-figure__link--route"
          />
        ))}

        {/* nodes */}
        {NODES.map((n, i) => {
          const isBroker = i === BROKER;
          return (
            <g key={n.label} transform={`translate(${n.x}, ${n.y})`}>
              <circle
                r={isBroker ? 4.2 : 3}
                className={
                  isBroker ? "mesh-figure__node--broker" : "mesh-figure__node--peer"
                }
              />
              <text
                x={n.dx}
                y={n.dy}
                textAnchor={n.anchor}
                className={
                  isBroker ? "mesh-figure__label--broker" : "mesh-figure__label"
                }
              >
                {n.label}
              </text>
            </g>
          );
        })}

        {/* traffic — packets riding the routes through the broker */}
        {motion &&
          TRIPS.map((d, i) => (
            <circle key={`pkt-${i}`} r="2.6" className="mesh-figure__packet" opacity="0">
              <animateMotion
                dur={`${CYCLE}s`}
                begin={`${i * STAGGER}s`}
                repeatCount="indefinite"
                keyPoints="0;1;1"
                keyTimes="0;0.32;1"
                calcMode="linear"
                path={d}
              />
              <animate
                attributeName="opacity"
                dur={`${CYCLE}s`}
                begin={`${i * STAGGER}s`}
                repeatCount="indefinite"
                values="0;1;1;0;0"
                keyTimes="0;0.04;0.30;0.34;1"
                calcMode="linear"
              />
            </circle>
          ))}
      </svg>
      <div className="mesh-figure__caption">
        <span className="mesh-figure__caption-num">Mesh · local</span>
        <span className="mesh-figure__caption-meta">scout + 5 peers · 2 mesh links</span>
      </div>
    </div>
  );
}
