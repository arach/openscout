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

// Broker sits dead-centre; peers ring it so every route reads as broker→peer.
const BROKER = 5;

const NODES: MeshNode[] = [
  { x: 70,  y: 36,  label: "cli·hudson",   anchor: "start",  dx: 9,  dy: 3 },
  { x: 200, y: 22,  label: "mac·atlas",    anchor: "middle", dx: 0,  dy: -10 },
  { x: 330, y: 36,  label: "iphone·orin",  anchor: "end",    dx: -9, dy: 3 },
  { x: 70,  y: 128, label: "ide·arc",      anchor: "start",  dx: 9,  dy: 3 },
  { x: 330, y: 128, label: "web·echo",     anchor: "end",    dx: -9, dy: 3 },
  { x: 200, y: 82,  label: "broker",       anchor: "middle", dx: 0,  dy: 19 },
];

// Routes through the broker (heavier, solid). Peer-to-peer mesh links are
// rendered separately, lighter, so the hub reads as the hub.
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
                r={isBroker ? 7 : 4}
                className={
                  isBroker ? "mesh-figure__node--broker" : "mesh-figure__node--peer"
                }
              />
              {isBroker && <circle r="2.6" className="mesh-figure__node-core" />}
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
        <span className="mesh-figure__caption-meta">broker + 5 peers · 1 mesh</span>
      </div>
    </div>
  );
}
