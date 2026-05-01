"use client";

import { useEffect, useState } from "react";

type NodeKind = "broker" | "online" | "bridge" | "self";

type Node = {
  id: string;
  label: string;
  sub: string;
  kind: NodeKind;
  cx: number;
  cy: number;
};

const nodes: Node[] = [
  { id: "broker", label: "this broker", sub: "scout/Ø :7421",  kind: "broker", cx: 200, cy: 170 },
  { id: "atlas",  label: "atlas",       sub: "cc · openscout", kind: "online", cx: 200, cy: 50  },
  { id: "hudson", label: "hudson",      sub: "cursor · docs",  kind: "online", cx: 60,  cy: 110 },
  { id: "echo",   label: "echo",        sub: "codex · scout",  kind: "online", cx: 60,  cy: 240 },
  { id: "aria",   label: "aria",        sub: "tg · bridge",    kind: "bridge", cx: 340, cy: 110 },
  { id: "you",    label: "you",         sub: "iphone",         kind: "self",   cx: 340, cy: 240 },
];

const edges: [string, string][] = [
  ["broker", "atlas"],
  ["broker", "hudson"],
  ["broker", "echo"],
  ["broker", "aria"],
  ["broker", "you"],
];

const flightOrder = ["atlas", "hudson", "aria", "echo", "you", "atlas", "echo", "hudson"];

export function TopologyMock() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = setInterval(() => setTick((t) => t + 1), 1700);
    return () => clearInterval(id);
  }, []);

  const activeId = flightOrder[tick % flightOrder.length];
  const broker = nodes[0];
  const activeNode = nodes.find((n) => n.id === activeId)!;

  return (
    <div className="topo-mock" aria-label="Mesh topology — broker plus addressable peers (canned animation)">
      <div className="topo-mock__chrome">
        <span className="topo-mock__chrome-id">scout/Ø · mesh studio-mesh · 5 peers</span>
        <span className="topo-mock__chrome-status">
          <span className="topo-mock__chrome-dot" /> healthy
        </span>
      </div>

      <div className="topo-mock__body">
        <svg viewBox="0 0 400 290" className="topo-mock__svg" aria-hidden>
          <defs>
            <radialGradient id="topo-broker-glow">
              <stop offset="0%" stopColor="var(--site-accent)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--site-accent)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* edges */}
          {edges.map(([a, b]) => {
            const A = nodes.find((n) => n.id === a)!;
            const B = nodes.find((n) => n.id === b)!;
            const isActive = a === activeId || b === activeId;
            return (
              <line
                key={`${a}-${b}`}
                x1={A.cx} y1={A.cy} x2={B.cx} y2={B.cy}
                className={`topo-mock__edge ${isActive ? "topo-mock__edge--active" : ""}`}
              />
            );
          })}

          {/* travelling pulse on the active edge */}
          <circle
            key={activeId}
            r="3"
            className="topo-mock__pulse"
          >
            <animate
              attributeName="cx"
              values={`${broker.cx};${activeNode.cx}`}
              dur="1.4s"
              fill="freeze"
            />
            <animate
              attributeName="cy"
              values={`${broker.cy};${activeNode.cy}`}
              dur="1.4s"
              fill="freeze"
            />
          </circle>

          {/* broker glow */}
          <circle cx={broker.cx} cy={broker.cy} r="36" fill="url(#topo-broker-glow)" />

          {/* nodes */}
          {nodes.map((n) => {
            const isBroker = n.kind === "broker";
            const isActive = n.id === activeId;
            return (
              <g key={n.id}>
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={isBroker ? 10 : 6}
                  className={[
                    "topo-mock__node",
                    `topo-mock__node--${n.kind}`,
                    isActive ? "is-active" : "",
                  ].join(" ")}
                />
                {isBroker && (
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r="4"
                    className="topo-mock__node-core"
                  />
                )}
              </g>
            );
          })}

          {/* labels */}
          {nodes.map((n) => {
            const above = n.cy < 120;
            const labelY = above ? n.cy - 16 : n.cy + 22;
            const subY = above ? n.cy - 4 : n.cy + 34;
            return (
              <g key={`l-${n.id}`}>
                <text
                  x={n.cx}
                  y={labelY}
                  textAnchor="middle"
                  className={`topo-mock__label ${n.id === activeId ? "is-active" : ""}`}
                >
                  {n.label}
                </text>
                <text
                  x={n.cx}
                  y={subY}
                  textAnchor="middle"
                  className="topo-mock__sub"
                >
                  {n.sub}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="topo-mock__legend">
          <span className="topo-mock__legend-item">
            <span className="topo-mock__legend-mark topo-mock__legend-mark--online" /> peer
          </span>
          <span className="topo-mock__legend-item">
            <span className="topo-mock__legend-mark topo-mock__legend-mark--bridge" /> bridge
          </span>
          <span className="topo-mock__legend-item">
            <span className="topo-mock__legend-mark topo-mock__legend-mark--self" /> you
          </span>
        </div>
      </div>
    </div>
  );
}
