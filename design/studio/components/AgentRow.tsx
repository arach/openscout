/**
 * AgentRow — the canonical "one agent in a list" primitive.
 *
 * Three densities of the same row, all reading the same data shape.
 *  - comfortable : roster sidebar default (avatar + name + state-tinted task)
 *  - compact     : ~25 above the fold
 *  - manifest    : single dense baseline-aligned line for ops/tail
 *
 * Opt-in `steerable` mode wraps the row in <QuickSteer> so hovering it
 * brings up the same chip cluster + input dock the Ticker offers.
 * Same vocabulary across surfaces: a roster row and a ticker slot
 * showing the same agent's activity should react the same way.
 *
 * Lifted from: packages/web/client/scout/inspector/HomeAgentsInspector.tsx:69-111
 *              + design/studio/app/studies/agent-pulse/page.tsx (consolidated).
 */
import {
  AGENT_STATE_COLOR,
  AGENT_STATE_LABEL,
  type AgentState,
} from "./AgentPresenceDot";
import {
  QuickSteer,
  type SteerEvent,
  type SteerKind,
} from "./QuickSteer";

export interface AgentRowAgent {
  id: string;
  name: string;
  state: AgentState;
  task?: string;
  updatedAgo: string;
}

interface AgentRowProps {
  agent: AgentRowAgent;
  density: "comfortable" | "compact" | "manifest";
  /** Opt-in: wraps the row in <QuickSteer> so hover shows the chip
   *  cluster and the input dock fires `onAction(event, actionId, text?)`.
   *  Off by default — roster rows render passively unless asked. */
  steerable?: boolean;
  onAction?: (
    event: SteerEvent,
    actionId: string,
    text?: string,
  ) => void;
}

// Agent identity is carried by name + handle, not color. Avatars use a
// single neutral warm tone so the eye sorts the roster by name first.
// (The per-agent hue table is preserved as `AVATAR_HUES` for any caller
// that still needs a numeric hue — e.g. legacy QuickSteer wiring — but
// `avatarColor` no longer returns a per-agent color.)
const AVATAR_HUES: Record<string, number> = {
  Scout: 125,
  Hudson: 210,
  QB: 25,
  Cody: 85,
  Ranger: 295,
  Vox: 340,
  Atlas: 175,
  Vault: 250,
};

export function avatarColor(_name: string): string {
  return "oklch(0.42 0.008 80)";
}

/** Derive a SteerEvent from an agent for use in QuickSteer wrapping.
 *  Roster rows default to `message` kind (reply/thread/pin actions) —
 *  the most common operator intent on a roster is "I want to talk to
 *  this agent", not ops-style abort/tail. Callers can override via
 *  `event.actions` if a particular row should expose different verbs. */
function rowEvent(agent: AgentRowAgent): SteerEvent {
  const kind: SteerKind = agent.state === "needs-attention" ? "decision" : "message";
  return {
    id: agent.id,
    agent: agent.id,
    agentHue: AVATAR_HUES[agent.name] ?? 200,
    kind,
    label: agent.task ?? AGENT_STATE_LABEL[agent.state],
    time: agent.updatedAgo,
  };
}

export function AgentRow({
  agent,
  density,
  steerable = false,
  onAction,
}: AgentRowProps) {
  const dim = agent.state === "offline";
  const dotColor = AGENT_STATE_COLOR[agent.state];
  const steerEvent = steerable ? rowEvent(agent) : null;

  const wrap = (children: React.ReactNode) => {
    if (!steerable || !steerEvent) return children;
    return (
      <QuickSteer event={steerEvent} onAction={onAction}>
        {children}
      </QuickSteer>
    );
  };

  if (density === "manifest") {
    return wrap(
      <div
        className={[
          "group flex items-baseline gap-4 border-b border-studio-edge px-3 py-1.5 last:border-b-0 transition-colors hover:bg-studio-canvas-alt",
          steerable ? "cursor-pointer" : "",
          dim ? "opacity-60 hover:opacity-100" : "",
        ].join(" ")}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: dotColor,
            boxShadow:
              agent.state === "working"
                ? `0 0 0 3px color-mix(in oklab, ${dotColor} 32%, transparent)`
                : undefined,
          }}
        />
        <span className="w-[80px] shrink-0 font-sans text-[13px] font-medium text-studio-ink">
          {agent.name}
        </span>
        <span
          className="w-[110px] shrink-0 font-mono text-[10px] uppercase tracking-eyebrow"
          style={{ color: dotColor }}
        >
          {AGENT_STATE_LABEL[agent.state]}
        </span>
        <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-studio-ink-faint">
          {agent.task ?? "—"}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-studio-ink-faint">
          {agent.updatedAgo}
        </span>
      </div>
    );
  }

  const padY = density === "compact" ? "py-1" : "py-1.5";
  const avatarSize =
    density === "compact" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[10.5px]";
  const dotRing = density === "compact" ? "ring-1" : "ring-2";

  return wrap(
    <div
      className={[
        "group flex items-center gap-2.5 rounded-sm px-2 transition-colors hover:bg-studio-canvas-alt",
        padY,
        steerable ? "cursor-pointer" : "",
        dim ? "opacity-60 hover:opacity-100" : "",
      ].join(" ")}
    >
      <div
        className={`relative shrink-0 rounded-full font-mono ${avatarSize} flex items-center justify-center`}
        style={{
          background: avatarColor(agent.name),
          color: "var(--studio-canvas)",
        }}
      >
        {agent.name[0]?.toUpperCase()}
        {agent.state === "working" || agent.state === "available" ? (
          <span
            className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ${dotRing}`}
            style={{
              background: dotColor,
              boxShadow: `0 0 0 2px var(--studio-surface)`,
            }}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-sans text-[12.5px] text-studio-ink">
          {agent.name}
        </span>
        <span
          className="truncate font-mono text-[10px]"
          style={{ color: dotColor }}
        >
          {AGENT_STATE_LABEL[agent.state]}
          {agent.task ? (
            <span className="text-studio-ink-faint"> · {agent.task}</span>
          ) : null}
        </span>
      </div>
      <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
        {agent.updatedAgo}
      </span>
    </div>
  );
}
