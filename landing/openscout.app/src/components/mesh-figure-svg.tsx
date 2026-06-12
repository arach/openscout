"use client";

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
  { x: 172, y: 80,  label: "broker",       anchor: "middle", dx: 0,  dy: 17 },
];

// Routes through the broker (solid). Peer-to-peer mesh links are rendered
// separately, dashed and quieter, and kept clearly diagonal so they never
// mimic the card border.
const ROUTES: number[] = [0, 1, 2, 3, 4];
const MESH: [number, number][] = [
  [0, 3],
  [2, 4],
];

export function MeshFigureSvg() {
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
      </svg>
      <div className="mesh-figure__caption">
        <span className="mesh-figure__caption-num">Fig. 1.0 · Topology</span>
        <span className="mesh-figure__caption-meta">broker + 5 peers · 2 mesh links</span>
      </div>
    </div>
  );
}
