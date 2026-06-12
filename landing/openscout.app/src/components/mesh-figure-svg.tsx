"use client";

const NODES = [
  { x: 60,  y: 28,  label: "cli·hudson" },
  { x: 200, y: 16,  label: "mac·atlas" },
  { x: 340, y: 30,  label: "iphone·orin" },
  { x: 110, y: 110, label: "ide·arc" },
  { x: 280, y: 120, label: "web·echo" },
  { x: 200, y: 70,  label: "broker" },
];

const EDGES: [number, number][] = [
  [0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [0, 3], [1, 4],
];

export function MeshFigureSvg() {
  return (
    <div className="mesh-figure">
      <div className="mesh-figure__chrome">
        <span>scout-001.conn</span>
        <span className="mesh-figure__zoom">⌕ 25% ⊕</span>
      </div>
      <svg
        viewBox="0 0 400 160"
        className="mesh-figure__svg"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        {EDGES.map(([a, b], i) => (
          <line
            key={i}
            x1={NODES[a].x}
            y1={NODES[a].y}
            x2={NODES[b].x}
            y2={NODES[b].y}
            stroke="currentColor"
            strokeWidth="0.6"
            strokeDasharray="2 2"
            opacity="0.45"
          />
        ))}
        {NODES.map((n, i) => (
          <g key={i} transform={`translate(${n.x}, ${n.y})`}>
            <circle r={i === 5 ? 5 : 3} fill="none" stroke="currentColor" strokeWidth="0.8" />
            {i === 5 && <circle r="2" fill="currentColor" />}
            <text
              x="8"
              y="3"
              fontSize="6"
              fontFamily="ui-monospace, monospace"
              fill="currentColor"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
