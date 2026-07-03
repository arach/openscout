import { useMemo } from "react";
import "../../scout/slots/ctx-panel.css";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import type { Route } from "../../lib/types.ts";
import {
  isIdleCodexRelay,
  isLaneRosterFleetAgent,
  lanePrimaryLabel,
  laneStatusLabel,
} from "./agent-lanes-model.ts";
import { useLaneRoster, type LaneRosterEntry } from "./lane-roster-store.ts";

/** Scroll the deck to a lane column and hand it the deck's own keyboard cursor
 *  (the same-document `data-lane-id` anchor the columns render). Because the deck
 *  publishes the roster it actually rendered, the matching column should be
 *  present; when it is momentarily absent we fall back to the agent profile only
 *  for registered agents. Native/terminal lanes have no profile to open, so a
 *  missing column is simply a no-op rather than a broken navigate. */
function focusDeckLane(
  laneId: string,
  agentId: string | undefined,
  navigate: (route: Route) => void,
): void {
  const selector = `[data-lane-id="${laneId.replace(/["\\]/g, "\\$&")}"]`;
  const column = typeof document !== "undefined"
    ? document.querySelector<HTMLElement>(selector)
    : null;
  if (column) {
    column.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    column.focus();
    return;
  }
  if (agentId) {
    navigate({ view: "agents-v2", agentId, tab: "profile" });
  }
}

/** Lanes-mode left rail: a 1:1 mirror of the deck's rendered columns so the
 *  count and order always match the strip on screen, and off-viewport lanes
 *  (the deck h-scrolls) get a jump target. The deck publishes the roster it
 *  rendered; until it does (the rail can mount a beat early), we show an interim
 *  fleet-derived list so the rail isn't blank. The Surfaces / Needs you / Active
 *  sections `OpsDefaultLeft` shows are redundant here — surface switching lives
 *  in the top OpsSubnav and lane attention is already on the deck. */
export function OpsLanesLeft() {
  const { agents, navigate } = useScout();
  const published = useLaneRoster();

  // Interim roster while the deck hasn't published yet: the same fleet agents
  // that seed the deck's scout lanes (live transport / provider session, minus
  // idle codex relays), read from the already-loaded fleet without the deck's
  // tail/observe polling. Ignored the moment `published` (the real mirror) lands.
  const fallback = useMemo<LaneRosterEntry[]>(
    () =>
      agents
        .filter((agent) => !isIdleCodexRelay(agent) && isLaneRosterFleetAgent(agent))
        .sort((left, right) => {
          const recency = (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
          if (recency !== 0) return recency;
          return lanePrimaryLabel(left, "scout").localeCompare(lanePrimaryLabel(right, "scout"));
        })
        .map((agent) => ({
          id: agent.id,
          label: lanePrimaryLabel(agent, "scout"),
          statusLabel: laneStatusLabel(agent, "scout"),
          tone: normalizeAgentState(agent.state, agent),
          agentId: agent.id,
          updatedAt: agent.updatedAt ?? undefined,
        })),
    [agents],
  );

  const lanes = published ?? fallback;

  return (
    <div className="ctx-panel ctx-panel--ops">
      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Lanes
          {lanes.length > 0 && <span className="ctx-panel-count">{lanes.length}</span>}
        </div>
        {lanes.length === 0 ? (
          <div className="ctx-panel-empty">No active lanes</div>
        ) : (
          lanes.map((entry) => (
            <RailRow
              key={entry.id}
              name={entry.label}
              meta={entry.updatedAt ? timeAgo(entry.updatedAt) : undefined}
              tone={entry.tone}
              title={entry.statusLabel}
              onClick={() => focusDeckLane(entry.id, entry.agentId, navigate)}
            />
          ))
        )}
      </section>
    </div>
  );
}
