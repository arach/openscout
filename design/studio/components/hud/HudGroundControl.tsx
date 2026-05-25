"use client";

/**
 * HudGroundControl — bottom-right floating fleet-presence cluster.
 *
 * The point of this corner is ambient telemetry: the operator should
 * be able to glance and see (1) the fleet is alive, (2) which agents
 * are present + what state, (3) whether anything is waiting.
 *
 * Layout:
 *   GROUND CONTROL                       BROKER ●  (pulses)
 *   ─────────────────────────────────────────────
 *   [S] [H] [Q] [C] [R] [V]              7 ✉
 *    s   h   q   c   r   v               (unread)
 *
 * Agent dots are colored by hue (avatar convention from
 * app/studies/agent-pulse). State shows as a ring/halo:
 *   working          — solid dot, scout-accent halo
 *   needs-attention  — solid dot, error-fg ping ring (subtle pulse)
 *   available        — solid dot, ok-fg ring
 *   idle             — open dot (stroke only)
 *   offline          — dim dot, no ring
 *
 * Broker pulse is the single warm scout-accent element when nothing
 * is hovered — a 1.8s breathing dot. The heartbeat.
 *
 * Pure mock, accepts an agents array prop.
 */

import type { ReactElement } from "react";

type AgentState =
  | "working"
  | "available"
  | "needs-attention"
  | "idle"
  | "offline";

export interface GroundAgent {
  id: string;
  hue: number;
  state: AgentState;
}

export function HudGroundControl({
  agents,
  brokerOk = true,
  unread,
}: {
  agents: GroundAgent[];
  brokerOk?: boolean;
  unread?: number;
}): ReactElement {
  return (
    <div
      role="status"
      aria-label="Fleet ground control"
      className="absolute bottom-12 right-3 z-30 w-[268px] rounded-md border border-studio-edge"
      style={{
        background:
          "color-mix(in oklab, var(--studio-canvas) 72%, transparent)",
        backdropFilter: "blur(14px) saturate(140%)",
        WebkitBackdropFilter: "blur(14px) saturate(140%)",
        boxShadow:
          "0 8px 32px -8px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04) inset",
      }}
    >
      {/* Header row — eyebrow + broker pulse. */}
      <div className="flex items-center justify-between border-b border-studio-edge px-3 py-1.5">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          Ground Control
        </span>
        <BrokerPulse ok={brokerOk} />
      </div>

      {/* Agent presence row. */}
      <div className="px-3 py-2.5">
        <div className="flex items-end justify-between gap-1.5">
          {agents.map((a) => (
            <AgentBeacon key={a.id} agent={a} />
          ))}
        </div>
      </div>

      {/* Footer row — unread + tiny grid. */}
      {typeof unread === "number" ? (
        <div className="flex items-center justify-between border-t border-studio-edge px-3 py-1.5">
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            Inbox
          </span>
          <UnreadChip count={unread} />
        </div>
      ) : null}
    </div>
  );
}

// ── Agent beacon ─────────────────────────────────────────────────────

function AgentBeacon({ agent }: { agent: GroundAgent }) {
  const fill = `oklch(0.72 0.14 ${agent.hue})`;
  const initial = agent.id.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative grid h-4 w-4 place-items-center">
        <BeaconBody fill={fill} state={agent.state} />
      </div>
      <span className="font-mono text-[8.5px] uppercase text-studio-ink-faint">
        {initial}
      </span>
    </div>
  );
}

function BeaconBody({ fill, state }: { fill: string; state: AgentState }) {
  if (state === "offline") {
    return (
      <span
        className="block h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--studio-ink-faint)", opacity: 0.45 }}
      />
    );
  }

  if (state === "idle") {
    return (
      <span
        className="block h-1.5 w-1.5 rounded-full border"
        style={{
          background: "transparent",
          borderColor: fill,
        }}
      />
    );
  }

  // working / available / needs-attention — render dot + svg ring.
  const ringColor =
    state === "working"
      ? "var(--scout-accent)"
      : state === "needs-attention"
        ? "var(--status-error-fg)"
        : "var(--status-ok-fg)";

  return (
    <>
      <svg
        aria-hidden
        className="absolute inset-0"
        viewBox="0 0 16 16"
        width="16"
        height="16"
      >
        {state === "needs-attention" ? (
          <circle
            cx="8"
            cy="8"
            r="5"
            fill="none"
            stroke={ringColor}
            strokeWidth="0.8"
            opacity="0.7"
          >
            <animate
              attributeName="r"
              values="3.2;6.6;3.2"
              dur="2.4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.75;0;0.75"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
        ) : (
          <circle
            cx="8"
            cy="8"
            r="5"
            fill="none"
            stroke={ringColor}
            strokeWidth="0.8"
            opacity={state === "working" ? 0.5 : 0.35}
          />
        )}
      </svg>
      <span
        className="relative block h-1.5 w-1.5 rounded-full"
        style={{ background: fill }}
      />
    </>
  );
}

// ── Broker pulse ─────────────────────────────────────────────────────

function BrokerPulse({ ok }: { ok: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        broker
      </span>
      <svg
        aria-hidden
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className="overflow-visible"
      >
        <circle
          cx="5"
          cy="5"
          r="2.2"
          fill={ok ? "var(--scout-accent)" : "var(--status-error-fg)"}
        >
          {ok ? (
            <animate
              attributeName="opacity"
              values="0.4;1;0.4"
              dur="1.8s"
              repeatCount="indefinite"
            />
          ) : null}
        </circle>
      </svg>
    </span>
  );
}

// ── Unread chip ──────────────────────────────────────────────────────

function UnreadChip({ count }: { count: number }) {
  if (count <= 0) {
    return (
      <span className="font-mono text-[9.5px] text-studio-ink-faint">
        — clear
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-px font-mono text-[9.5px] font-semibold"
      style={{
        color: "var(--status-error-fg)",
        background: "var(--status-error-bg)",
      }}
    >
      {count} <span aria-hidden>✉</span>
    </span>
  );
}
