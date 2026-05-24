/**
 * AgentAskAlertCard — "this agent is waiting on you" card.
 *
 * Amber-tinted card with an "AWAITING" eyebrow, task summary clamped to
 * three lines, and a `harness → agent` breadcrumb so the operator can
 * see who originated the ask.
 *
 * Color goes through --status-warn-* tokens; never hex.
 *
 * Lifted from: packages/web/client/scout/inspector/AgentsInspector.tsx:606-631
 *              (InspectorAsks card body).
 */
interface AgentAskAlertCardProps {
  task: string;
  from: { harness: string; agent: string };
  updatedAgo: string;
}

export function AgentAskAlertCard({
  task,
  from,
  updatedAgo,
}: AgentAskAlertCardProps) {
  return (
    <div
      className="cursor-pointer rounded-md border p-2.5 transition-colors hover:bg-studio-canvas-alt"
      style={{
        borderColor: "color-mix(in oklab, var(--status-warn-fg) 32%, transparent)",
        background: "var(--status-warn-bg)",
      }}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span
          className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
          style={{ color: "var(--status-warn-fg)" }}
        >
          awaiting
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink-faint">
          {updatedAgo}
        </span>
      </div>
      <div
        className="font-sans text-[12px] leading-relaxed text-studio-ink"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {task}
      </div>
      <div className="mt-1.5 font-mono text-[9.5px] text-studio-ink-faint">
        {from.harness} <span className="opacity-60">&rarr;</span> {from.agent}
      </div>
    </div>
  );
}
