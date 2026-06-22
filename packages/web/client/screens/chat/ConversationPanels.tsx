import { useMemo, type CSSProperties } from "react";
import {
  compactAgentId,
  minimalAgentHandle,
} from "../../lib/agent-labels.ts";
import {
  isAgentCallable,
  normalizeAgentState,
} from "../../lib/agent-state.ts";
import { actorColor, stateColor } from "../../lib/colors.ts";
import { isUnread, type LastViewedMap } from "../../lib/sessionRead.ts";
import {
  formatAbsoluteTimestamp,
  timeAgo,
} from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import type {
  Agent,
  Flight,
  FleetActivity,
  Route,
  SessionEntry,
} from "../../lib/types.ts";
import {
  activityKindLabel,
  deriveDisplayTitle,
  deriveParticipantActivity,
  groupSessionsByWorkspace,
  pathLeaf,
  resolveAgentByIdentity,
  turnActivityText,
  type MotionTone,
  type TurnSnapshot,
} from "./conversation-model.ts";

export function ChannelRail({
  sessions,
  activeConversationId,
  needsYouIds,
  lastViewed,
  navigate,
}: {
  sessions: SessionEntry[];
  activeConversationId: string;
  needsYouIds: Set<string>;
  lastViewed: LastViewedMap;
  navigate: (r: Route) => void;
}) {
  const needsYouSessions = sessions.filter(
    (s) => needsYouIds.has(s.id) || (s.agentId && needsYouIds.has(s.agentId)),
  );
  const groups = useMemo(() => groupSessionsByWorkspace(sessions), [sessions]);

  return (
    <aside className="s-thread-rail">
      <div className="s-thread-rail-scroll">
        {needsYouSessions.length > 0 && (
          <div className="s-thread-rail-section s-thread-rail-section--needs-you">
            <div className="s-thread-rail-section-label">Needs you</div>
            {needsYouSessions.map((session) => (
              <RailItem
                key={`needs-${session.id}`}
                session={session}
                active={session.id === activeConversationId}
                unread={isUnread(session.lastMessageAt, session.id, lastViewed)}
                needsYou
                navigate={navigate}
              />
            ))}
          </div>
        )}
        {groups.map((group) => (
          <div key={group.workspace} className="s-thread-rail-section">
            <div className="s-thread-rail-section-label">
              {group.workspace}
            </div>
            {group.sessions.map((session) => (
              <RailItem
                key={session.id}
                session={session}
                active={session.id === activeConversationId}
                unread={isUnread(session.lastMessageAt, session.id, lastViewed)}
                needsYou={false}
                navigate={navigate}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function PresenceSidebar({
  sessionMeta,
  agents,
  flights,
  conversationId,
  navigate,
  route,
}: {
  sessionMeta: SessionEntry | null;
  agents: Agent[];
  flights: Flight[];
  conversationId: string;
  navigate: (r: Route) => void;
  route: Route;
}) {
  const participantAgents = useMemo(() => {
    if (!sessionMeta) return [];
    return sessionMeta.participantIds
      .filter((id) => id !== "operator")
      .map((id) => resolveAgentByIdentity(agents, [id]))
      .filter((a): a is Agent => a !== null);
  }, [sessionMeta, agents]);

  const operatorEntry = {
    id: "operator",
    name: "You",
    handle: "operator",
    activity: null as string | null,
    state: "ready" as const,
    agent: null as Agent | null,
  };

  const participantEntries = useMemo(() => {
    return participantAgents.map((a) => ({
      id: a.id,
      name: a.name,
      handle: minimalAgentHandle(a) ?? compactAgentId(a.id) ?? a.id,
      activity: deriveParticipantActivity(a, flights, conversationId),
      state: normalizeAgentState(a.state),
      agent: a,
    }));
  }, [participantAgents, flights, conversationId]);

  const allParticipants = [operatorEntry, ...participantEntries];

  return (
    <aside className="s-thread-sidebar">
      <div className="s-thread-sidebar-section">
        <div className="s-thread-sidebar-label">In this conversation</div>
        {allParticipants.map((p) => {
          const content = (
            <>
              <div
                className="s-ops-avatar"
                style={{
                  "--size": "28px",
                  background: actorColor(p.name),
                } as CSSProperties}
              >
                {p.name[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="s-thread-sidebar-participant-info">
                <span className="s-thread-sidebar-participant-name">
                  {p.name}
                </span>
                <span className="s-thread-sidebar-participant-handle">
                  @{p.handle}
                </span>
              </div>
              <div className="s-thread-sidebar-participant-activity">
                {p.activity ? (
                  <>
                    <span
                      className="s-thread-sidebar-activity-dot s-thread-sidebar-activity-dot--pulse"
                      style={{ background: "var(--green)" }}
                    />
                    <span className="s-thread-sidebar-activity-label">
                      {p.activity}
                    </span>
                  </>
                ) : isAgentCallable(p.state) || p.id === "operator" ? (
                  <span
                    className="s-thread-sidebar-activity-dot"
                    style={{ background: stateColor(p.state) }}
                  />
                ) : (
                  <span
                    className="s-thread-sidebar-activity-dot"
                    style={{ background: "var(--dim)" }}
                  />
                )}
              </div>
            </>
          );
          if (!p.agent) {
            return (
              <div key={p.id} className="s-thread-sidebar-participant">
                {content}
              </div>
            );
          }
          return (
            <button
              key={p.id}
              type="button"
              className="s-thread-sidebar-participant s-thread-sidebar-participant--clickable"
              onClick={() =>
                openContent(
                  navigate,
                  { view: "agents", agentId: p.agent!.id },
                  { returnTo: route },
                )
              }
              title={`Open ${p.name} profile`}
            >
              {content}
            </button>
          );
        })}
      </div>

      {participantEntries.length > 0 && (
        <div className="s-thread-sidebar-section">
          <div className="s-thread-sidebar-label">Conversation mesh</div>
          <MiniMeshSvg participants={participantEntries} />
        </div>
      )}
    </aside>
  );
}

export function ThreadMotionPanel({
  agentName,
  title,
  detail,
  snapshot,
  events,
  tone,
  workspaceName,
  branch,
  startedAt,
}: {
  agentName: string;
  title: string;
  detail: string;
  snapshot: TurnSnapshot;
  events: FleetActivity[];
  tone: MotionTone;
  workspaceName: string | null;
  branch: string | null | undefined;
  startedAt: number | null | undefined;
}) {
  const visibleEvents = events.slice(0, 4);
  const startedLabel = startedAt ? timeAgo(startedAt) : "now";
  return (
    <section
      className={`s-thread-motion-panel s-thread-motion-panel--${tone}`}
      aria-live="polite"
    >
      <div className="s-thread-motion-head">
        <div className="s-thread-motion-beacon" aria-hidden="true">
          <span />
        </div>
        <div className="s-thread-motion-title-block">
          <div className="s-thread-motion-kicker">Currently working</div>
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
      </div>

      <div className="s-thread-motion-meter" aria-hidden="true">
        {MOTION_BAR_PATTERN.map((height, index) => (
          <span
            key={`${height}-${index}`}
            style={{
              "--bar-height": `${height}%`,
              "--bar-delay": `${index * 74}ms`,
            } as CSSProperties}
          />
        ))}
      </div>

      <dl className="s-thread-motion-stats">
        <div>
          <dt>Session</dt>
          <dd>{startedLabel}</dd>
        </div>
        <div>
          <dt>Activity</dt>
          <dd>{snapshot.activityLabel}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd>{snapshot.lastActivityLabel}</dd>
        </div>
      </dl>

      <div className="s-thread-motion-latest">
        <span>{agentName}</span>
        <strong>{snapshot.latest}</strong>
      </div>

      {visibleEvents.length > 0 ? (
        <ol className="s-thread-motion-events">
          {visibleEvents.map((event) => (
            <li key={event.id}>
              <span className="s-thread-motion-event-kind">
                {activityKindLabel(event.kind)}
              </span>
              <span className="s-thread-motion-event-summary">
                {turnActivityText(event) ?? "Activity recorded"}
              </span>
              <time title={formatAbsoluteTimestamp(event.ts)}>
                {timeAgo(event.ts)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <div className="s-thread-motion-waiting">
          <span>Session created</span>
          <strong>waiting for the first trace event</strong>
        </div>
      )}

      {(workspaceName || branch) && (
        <div className="s-thread-motion-chips">
          {workspaceName && <span>{workspaceName}</span>}
          {branch && <span>{branch}</span>}
        </div>
      )}
    </section>
  );
}

function RailItem({
  session,
  active,
  unread,
  needsYou,
  navigate,
}: {
  session: SessionEntry;
  active: boolean;
  unread: boolean;
  needsYou: boolean;
  navigate: (r: Route) => void;
}) {
  const { route } = useScout();
  const title = deriveDisplayTitle(session);
  const initial = (session.agentName ?? title)[0]?.toUpperCase() ?? "?";
  const isDm = session.kind === "direct";
  const sub = pathLeaf(session.workspaceRoot) ?? session.kind;

  return (
    <button
      type="button"
      className={[
        "s-thread-rail-item",
        active && "s-thread-rail-item--active",
        needsYou && "s-thread-rail-item--needs-you",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() =>
        openContent(navigate, { view: "conversation", conversationId: session.id }, { returnTo: route })
      }
    >
      {isDm ? (
        <div
          className="s-thread-rail-avatar"
          style={{ background: actorColor(session.agentName ?? title) }}
        >
          {initial}
        </div>
      ) : (
        <div className="s-thread-rail-avatar s-thread-rail-avatar--channel">
          #
        </div>
      )}
      <div className="s-thread-rail-body">
        <span className="s-thread-rail-name">{title}</span>
        <span className="s-thread-rail-sub">{sub}</span>
      </div>
      <div className="s-thread-rail-trailing">
        {unread && !needsYou && (
          <span
            className="s-thread-rail-presence-dot"
            style={{ background: "var(--accent)" }}
          />
        )}
        {needsYou && (
          <span className="s-thread-rail-badge s-thread-rail-badge--amber">
            !
          </span>
        )}
      </div>
    </button>
  );
}

function MiniMeshSvg({
  participants,
}: {
  participants: Array<{
    id: string;
    name: string;
    state: string;
  }>;
}) {
  const cx = 130;
  const cy = 80;
  const radius = 55;
  const nodeRadius = 16;

  const nodes = participants.map((p, i) => {
    const angle = (2 * Math.PI * i) / participants.length - Math.PI / 2;
    return {
      ...p,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  return (
    <div className="s-thread-mini-mesh">
      <svg viewBox="0 0 260 160" aria-label="Conversation participant mesh">
        {nodes.map((node) => (
          <line
            key={`edge-${node.id}`}
            x1={cx}
            y1={cy}
            x2={node.x}
            y2={node.y}
            className="s-thread-mini-mesh-edge"
          />
        ))}
        <circle
          cx={cx}
          cy={cy}
          r={nodeRadius}
          className="s-thread-mini-mesh-node s-thread-mini-mesh-node--center"
        />
        <text
          x={cx}
          y={cy}
          className="s-thread-mini-mesh-label s-thread-mini-mesh-label--center"
        >
          OP
        </text>
        {nodes.map((node) => (
          <g key={`node-${node.id}`}>
            <circle
              cx={node.x}
              cy={node.y}
              r={nodeRadius}
              className="s-thread-mini-mesh-node"
              style={
                node.state === "in_turn" || node.state === "in_flight"
                  ? { stroke: "var(--green)" }
                  : undefined
              }
            />
            <text
              x={node.x}
              y={node.y}
              className="s-thread-mini-mesh-label"
            >
              {node.name.slice(0, 3).toUpperCase()}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const MOTION_BAR_PATTERN = [42, 76, 54, 88, 34, 66, 92, 48, 72, 38, 84, 58];
