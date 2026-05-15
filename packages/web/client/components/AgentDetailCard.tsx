import "./agent-detail-card.css";

import { forwardRef } from "react";
import type { Agent } from "../lib/types.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import { stateColor } from "../lib/colors.ts";
import { timeAgo } from "../lib/time.ts";

function homify(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.replace(/^\/Users\/[^/]+/, "~");
}

export type AgentDetailCardProps = {
  agent: Agent;
  pinned: boolean;
  onOpen: () => void;
  onClose: () => void;
  style?: React.CSSProperties;
  className?: string;
};

export const AgentDetailCard = forwardRef<HTMLDivElement, AgentDetailCardProps>(
  function AgentDetailCard({ agent, pinned, onOpen, onClose, style, className }, ref) {
    const state = normalizeAgentState(agent.state);
    const cwd = homify(agent.cwd) ?? homify(agent.projectRoot);
    const name = agent.handle ?? agent.name;
    const stateLabel =
      state === "working" ? "Working" : state === "available" ? "Available" : "Offline";

    return (
      <div
        ref={ref}
        className={`agent-card${pinned ? " agent-card--pinned" : ""}${className ? ` ${className}` : ""}`}
        style={style}
        role="dialog"
        aria-label={`${name} details`}
      >
        <header className="agent-card-head">
          <div className="agent-card-name">{name}</div>
          <div className="agent-card-meta">
            <span
              className={`agent-card-dot agent-card-dot--${state}`}
              style={state === "working" ? { background: stateColor(agent.state) } : undefined}
            />
            <span className={`agent-card-state agent-card-state--${state}`}>{stateLabel}</span>
            {agent.updatedAt && (
              <>
                <span className="agent-card-sep">·</span>
                <span className="agent-card-time">{timeAgo(agent.updatedAt)}</span>
              </>
            )}
          </div>
        </header>

        <div className="agent-card-body">
          {cwd && (
            <Field label="cwd">
              <code className="agent-card-mono">{cwd}</code>
            </Field>
          )}

          {(agent.project || agent.branch) && (
            <Field label="project">
              <span className="agent-card-mono">
                {agent.project ?? "—"}
                {agent.branch && (
                  <>
                    <span className="agent-card-sep agent-card-sep--inline">·</span>
                    <span className="agent-card-branch">{agent.branch}</span>
                  </>
                )}
              </span>
            </Field>
          )}

          {(agent.harness || agent.model) && (
            <Field label="harness">
              <span className="agent-card-mono">
                {agent.harness ?? "—"}
                {agent.model && (
                  <>
                    <span className="agent-card-sep agent-card-sep--inline">·</span>
                    <span className="agent-card-model">{agent.model}</span>
                  </>
                )}
              </span>
            </Field>
          )}

          {agent.transport && (
            <Field label="transport">
              <span className="agent-card-mono">{agent.transport}</span>
            </Field>
          )}

          {agent.role && (
            <Field label="role">
              <span className="agent-card-mono">{agent.role}</span>
            </Field>
          )}

          {agent.capabilities && agent.capabilities.length > 0 && (
            <Field label="capabilities">
              <div className="agent-card-caps">
                {agent.capabilities.slice(0, 8).map((cap) => (
                  <span key={cap} className="agent-card-cap">{cap}</span>
                ))}
                {agent.capabilities.length > 8 && (
                  <span className="agent-card-cap agent-card-cap--more">
                    +{agent.capabilities.length - 8}
                  </span>
                )}
              </div>
            </Field>
          )}
        </div>

        <footer className="agent-card-foot">
          <button type="button" className="agent-card-link" onClick={onOpen}>
            Open agent <span aria-hidden>→</span>
          </button>
          {pinned && (
            <button type="button" className="agent-card-close" onClick={onClose} aria-label="Close">
              esc
            </button>
          )}
        </footer>
      </div>
    );
  },
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="agent-card-field">
      <span className="agent-card-label">{label}</span>
      <div className="agent-card-value">{children}</div>
    </div>
  );
}
