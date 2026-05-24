/**
 * AgentCard — the info-dense agent tile.
 *
 * Five rows of metadata stacked into one tile that an operator can
 * scan and make routing decisions from:
 *   identity → state → task+progress → project → capabilities
 *
 * `selected` flips a left accent rule for the focused tile.
 *
 * Lifted from: design/studio/app/studies/agent-cards/page.tsx (AgentCardView)
 *              + packages/web/client/scout/inspector/AgentsInspector.tsx.
 */
import {
  AGENT_STATE_COLOR,
  type AgentState,
} from "./AgentPresenceDot";
import { avatarColor } from "./AgentRow";

export interface AgentCardAgent {
  id: string;
  name: string;
  handle: string;
  state: AgentState;
  task?: string;
  taskProgress?: number;
  project: { repo: string; branch: string; cwd?: string };
  harness: string;
  model: string;
  tools: string[];
  lastTouched: string;
  unread?: number;
}

const STATE_LABEL: Record<AgentState, string> = {
  working: "WORKING",
  "needs-attention": "NEEDS ATTENTION",
  available: "AVAILABLE",
  idle: "IDLE",
  offline: "OFFLINE",
  error: "ERROR",
};

interface AgentCardProps {
  agent: AgentCardAgent;
  selected?: boolean;
}

export function AgentCard({ agent, selected = false }: AgentCardProps) {
  const stateColor = AGENT_STATE_COLOR[agent.state];
  const dim = agent.state === "offline";
  return (
    <article
      className={[
        "relative flex flex-col gap-2.5 rounded-md border bg-studio-surface px-4 py-3 transition-colors",
        selected
          ? "border-scout-accent shadow-[inset_2px_0_0_var(--scout-accent)]"
          : "border-studio-edge hover:border-studio-edge-strong",
        dim ? "opacity-70" : "",
      ].join(" ")}
    >
      <header className="flex items-start gap-3">
        <div
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[13px]"
          style={{
            background: avatarColor(agent.name),
            color: "var(--studio-canvas)",
          }}
        >
          {agent.name[0]?.toUpperCase()}
          {agent.state === "working" || agent.state === "available" ? (
            <span
              className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full"
              style={{
                background: stateColor,
                boxShadow: `0 0 0 2px var(--studio-surface)`,
              }}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-sans text-[15px] font-semibold tracking-tight text-studio-ink">
              {agent.name}
            </span>
            <span className="font-mono text-[10.5px] text-studio-ink-faint">
              {agent.handle}
            </span>
          </div>
          <div
            className="mt-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow"
            style={{ color: stateColor }}
          >
            {STATE_LABEL[agent.state]}
            <span className="ml-2 font-normal text-studio-ink-faint">
              · {agent.lastTouched} ago
            </span>
          </div>
        </div>

        {agent.unread ? (
          <span
            className="rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tabular-nums"
            style={{
              color: "var(--status-error-fg)",
              background: "var(--status-error-bg)",
            }}
          >
            {agent.unread}
          </span>
        ) : null}
      </header>

      {agent.task ? (
        <div className="rounded-[4px] bg-studio-canvas-alt px-2.5 py-2">
          <div className="flex items-baseline gap-2 font-sans text-[12.5px] text-studio-ink">
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              task
            </span>
            <span className="min-w-0 flex-1 truncate">{agent.task}</span>
          </div>
          {typeof agent.taskProgress === "number" ? (
            <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-studio-edge">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(agent.taskProgress * 100)}%`,
                  background: stateColor,
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 font-mono text-[10.5px]">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">
          Branch
        </span>
        <span className="truncate text-studio-ink">
          {agent.project.repo}
          <span className="text-studio-ink-faint">@</span>
          {agent.project.branch}
        </span>
        {agent.project.cwd ? (
          <>
            <span className="uppercase tracking-eyebrow text-studio-ink-faint">
              Cwd
            </span>
            <span className="truncate text-studio-ink-muted">
              {agent.project.cwd}
            </span>
          </>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-studio-edge pt-2 font-mono text-[9.5px]">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">
          {agent.harness}
        </span>
        <span className="text-studio-ink-faint">·</span>
        <span className="text-studio-ink">{agent.model}</span>
        <span className="text-studio-ink-faint">·</span>
        <span className="flex flex-wrap items-baseline gap-1">
          {agent.tools.map((t) => (
            <code
              key={t}
              className="rounded-[2px] bg-studio-canvas-alt px-1 py-px text-[9px] text-studio-ink-muted"
            >
              {t}
            </code>
          ))}
        </span>
      </footer>
    </article>
  );
}
