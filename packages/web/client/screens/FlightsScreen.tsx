import { timeAgo } from "../lib/time.ts";
import { actorColor } from "../lib/colors.ts";
import { conversationForAgent } from "../lib/router.ts";
import type { Flight, Route } from "../lib/types.ts";

const STATE_COLORS: Record<string, string> = {
  running: "var(--green)",
  waking: "var(--accent)",
  waiting: "var(--accent)",
  queued: "var(--dim)",
};

function stateLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function FlightsScreen({
  navigate,
  flights,
}: {
  navigate: (r: Route) => void;
  flights: Flight[];
}) {
  return (
    <div>
      <h2 className="s-section-title">Tasks</h2>

      {flights.length === 0 ? (
        <div className="s-empty">
          <p>No active tasks</p>
          <p>Tasks appear here when agents are working</p>
        </div>
      ) : (
        <div className="s-flights">
          {flights.map((f) => {
            const name = f.agentName ?? f.agentId;
            return (
              <div
                key={f.id}
                className="s-flight-row"
                onClick={() => navigate({ view: "conversation", conversationId: conversationForAgent(f.agentId) })}
              >
                <div
                  className="s-avatar s-avatar-sm"
                  style={{ background: actorColor(name) }}
                >
                  {name[0].toUpperCase()}
                </div>
                <div className="s-flight-body">
                  <div className="s-flight-header">
                    <span className="s-flight-name">{name}</span>
                    <span
                      className="s-flight-state"
                      style={{ color: STATE_COLORS[f.state] ?? "var(--muted)" }}
                    >
                      {stateLabel(f.state)}
                    </span>
                    {f.startedAt && (
                      <span className="s-time">{timeAgo(f.startedAt)}</span>
                    )}
                  </div>
                  {f.summary && (
                    <p className="s-flight-summary">{f.summary}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
