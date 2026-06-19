import { compactAgentId } from "../../lib/agent-labels.ts";
import type { Agent, FleetAsk } from "../../lib/types.ts";
import {
  presenceColor,
  type ConversationPresence,
} from "./conversation-model.ts";

export function PinnedAskCard({
  pinnedAsk,
  onAnswer,
}: {
  pinnedAsk: FleetAsk;
  onAnswer: () => void;
}) {
  return (
    <div className="s-thread-pinned-ask">
      <div className="s-thread-pinned-ask-label">
        Pinned ask &middot; Awaiting operator
      </div>
      <div className="s-thread-pinned-ask-body">
        {pinnedAsk.task}
      </div>
      <div className="s-thread-pinned-ask-routing">
        <span>{pinnedAsk.agentName ?? compactAgentId(pinnedAsk.agentId) ?? pinnedAsk.agentId}</span>
        <span className="s-thread-pinned-ask-routing-arrow">
          &rarr;
        </span>
        <span>You</span>
      </div>
      <div className="s-thread-pinned-ask-actions">
        <button
          type="button"
          className="s-ops-btn s-ops-btn--primary"
          onClick={onAnswer}
        >
          Answer
        </button>
        <button type="button" className="s-ops-btn">
          Defer
        </button>
        <button type="button" className="s-ops-btn">
          Route
        </button>
      </div>
      <div className="s-thread-pinned-ask-strip" />
    </div>
  );
}

export function ConversationStatusStrip({
  presence,
  agent,
}: {
  presence: ConversationPresence;
  agent: Agent | null;
}) {
  if (!presence.showStrip) return null;
  return (
    <div
      className={`s-thread-status s-thread-status--${presence.tone}`}
      aria-live="polite"
    >
      <span
        className="s-thread-status-dot"
        style={{
          background: presenceColor(presence, agent?.state ?? null),
        }}
      />
      <div className="s-thread-status-copy">
        <span className="s-thread-status-label">{presence.label}</span>
        <span className="s-thread-status-detail">{presence.detail}</span>
      </div>
    </div>
  );
}
