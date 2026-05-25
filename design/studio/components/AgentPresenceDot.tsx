/**
 * AgentPresenceDot — the bare presence indicator.
 *
 * Single source of truth for "what state is this agent in?" as a colored
 * circle. Used standalone in dense surfaces (mention chips, ops tail),
 * with a halo for active states, or as a ring on an avatar corner.
 *
 * Color maps to status tokens — never a hex.
 *   working / needs-attention   → status-warn / status-error
 *   available                   → status-ok
 *   idle                        → scout-accent (signal of presence, not stress)
 *   offline / error             → ink-faint / status-error
 *
 * Lifted from: packages/web/client/scout/inspector/HomeAgentsInspector.tsx:94
 */
export type AgentState =
  | "working"
  | "available"
  | "needs-attention"
  | "idle"
  | "offline"
  | "error";

// Two-tone palette: ink scales for passive states, single accent for the
// states that actually need operator attention. No warn/ok/info/error
// rainbow — semantic differentiation comes from the label, not a hue.
export const AGENT_STATE_COLOR: Record<AgentState, string> = {
  working: "var(--scout-accent)",
  "needs-attention": "var(--scout-accent)",
  available: "var(--studio-ink-muted)",
  idle: "var(--studio-ink-faint)",
  offline: "var(--studio-ink-faint)",
  error: "var(--scout-accent)",
};

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  working: "working",
  "needs-attention": "needs attention",
  available: "available",
  idle: "idle",
  offline: "offline",
  error: "error",
};

interface AgentPresenceDotProps {
  state: AgentState;
  size?: "sm" | "md" | "lg";
  withHalo?: boolean;
}

const SIZE_PX: Record<NonNullable<AgentPresenceDotProps["size"]>, number> = {
  sm: 6,
  md: 8,
  lg: 12,
};

export function AgentPresenceDot({
  state,
  size = "md",
  withHalo = false,
}: AgentPresenceDotProps) {
  const color = AGENT_STATE_COLOR[state];
  const px = SIZE_PX[size];
  return (
    <span
      aria-label={AGENT_STATE_LABEL[state]}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: px,
        height: px,
        background: color,
        boxShadow: withHalo
          ? `0 0 0 ${Math.max(2, Math.round(px * 0.5))}px color-mix(in oklab, ${color} 32%, transparent)`
          : undefined,
      }}
    />
  );
}
