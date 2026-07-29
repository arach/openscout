import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { api } from "../../lib/api.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { openContent } from "../../scout/slots/openContent.ts";
import type { Agent, AgentRun, Route, SessionEntry, WorkItem } from "../../lib/types.ts";
import {
  buildChannelMembers,
  channelDisplayLabel,
  channelMemberForActor,
  channelMemberStatusLabel,
  sharedChannelWorkspace,
  type ChannelMemberProfile,
} from "./channel-context-model.ts";

const TERMINAL_CHANNEL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);

type ChannelActivityItem = {
  id: string;
  kind: "work" | "run";
  actorId: string | null;
  actorName: string;
  status: string;
  title: string;
  detail: string | null;
  updatedAt: number;
  active: boolean;
  route: Route | null;
};

function objectField(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringField(value: unknown, key: string): string | null {
  const field = objectField(value, key);
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function agentNameFor(id: string | null | undefined, fallback: string | null | undefined, agents: Agent[]): string {
  if (fallback?.trim()) return fallback.trim();
  const agent = id ? agents.find((candidate) => candidate.id === id) : null;
  return agent?.name ?? id ?? "Unassigned";
}

function runTask(run: AgentRun): string | null {
  return stringField(run.input, "task") ?? stringField(run.input, "action");
}

function runOutputSummary(run: AgentRun): string | null {
  return stringField(run.output, "summary") ?? stringField(run.output, "text");
}

function isActiveChannelRun(run: AgentRun): boolean {
  return !TERMINAL_CHANNEL_RUN_STATES.has(run.state);
}

function runUpdatedAt(run: AgentRun): number {
  return run.updatedAt ?? run.completedAt ?? run.startedAt ?? run.createdAt ?? Date.now();
}

function runStatusLabel(state: string): string {
  switch (state.trim().toLowerCase()) {
    case "queued":
    case "waking":
    case "waiting":
    case "dispatching":
      return "Waiting";
    case "running":
    case "working":
    case "active":
    case "in_progress":
      return "Working";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return state.replace(/_/g, " ");
  }
}

function routeForRun(run: AgentRun): Route | null {
  if (run.workId) return { view: "work", workId: run.workId };
  const flightId = run.flightIds?.[0] ?? null;
  if (flightId) return { view: "follow", flightId, preferredView: "chat" };
  if (run.invocationId) return { view: "follow", invocationId: run.invocationId, preferredView: "chat" };
  return null;
}

function workActivityItem(work: WorkItem, agents: Agent[]): ChannelActivityItem {
  const actorId = work.nextMoveOwnerId ?? work.ownerId;
  const actorName = agentNameFor(actorId, work.nextMoveOwnerName ?? work.ownerName, agents);
  const activeFlights = work.activeFlightCount > 0
    ? `${work.activeFlightCount} active flight${work.activeFlightCount === 1 ? "" : "s"}`
    : null;
  return {
    id: `work:${work.id}`,
    kind: "work",
    actorId,
    actorName,
    status: activeFlights ? "Working" : runStatusLabel(work.currentPhase),
    title: work.title,
    detail: work.lastMeaningfulSummary ?? work.summary,
    updatedAt: work.lastMeaningfulAt || work.updatedAt,
    active: true,
    route: { view: "work", workId: work.id },
  };
}

function runActivityItem(run: AgentRun, agents: Agent[]): ChannelActivityItem {
  const active = isActiveChannelRun(run);
  const outputSummary = runOutputSummary(run);
  return {
    id: `run:${run.id}`,
    kind: "run",
    actorId: run.agentId,
    actorName: agentNameFor(run.agentId, run.agentName, agents),
    status: runStatusLabel(run.state),
    title: runTask(run) ?? outputSummary ?? "Agent run",
    detail: active ? outputSummary : null,
    updatedAt: runUpdatedAt(run),
    active,
    route: routeForRun(run),
  };
}

function buildChannelActivityItems(workItems: WorkItem[], runs: AgentRun[], agents: Agent[]): ChannelActivityItem[] {
  const visibleWorkIds = new Set(workItems.map((work) => work.id));
  const workItemsForChannel = workItems.map((work) => workActivityItem(work, agents));
  const activeRuns = runs.filter((run) => isActiveChannelRun(run));
  const recentRuns = runs.filter((run) => !isActiveChannelRun(run)).slice(0, 6);
  const runItems = [...activeRuns, ...recentRuns]
    .filter((run) => !run.workId || !visibleWorkIds.has(run.workId))
    .map((run) => runActivityItem(run, agents));

  return [...workItemsForChannel, ...runItems]
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      return right.updatedAt - left.updatedAt;
    })
    .slice(0, 12);
}

function ChannelInspectorPanel({
  channelId,
  agents,
  navigate,
  returnRoute,
}: {
  channelId: string | undefined;
  agents: Agent[];
  navigate: (route: Route) => void;
  returnRoute: Route;
}) {
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [session, setSession] = useState<SessionEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [identityLoadFailed, setIdentityLoadFailed] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const load = useCallback(async () => {
    if (!channelId) {
      setLoaded(true);
      setWorkItems([]);
      setRuns([]);
      setSession(null);
      return;
    }
    const [workResult, runResult, sessionResult] = await Promise.allSettled([
      api<WorkItem[]>(
        `/api/work?conversationId=${encodeURIComponent(channelId)}&active=true&limit=12`,
      ),
      api<AgentRun[]>(
        `/api/runs?conversationId=${encodeURIComponent(channelId)}&active=false&limit=24`,
      ),
      api<SessionEntry>(`/api/session/${encodeURIComponent(channelId)}`),
    ]);
    if (workResult.status === "fulfilled") setWorkItems(workResult.value);
    if (runResult.status === "fulfilled") setRuns(runResult.value);
    if (sessionResult.status === "fulfilled") {
      setSession(sessionResult.value);
      setIdentityLoadFailed(false);
    } else {
      setIdentityLoadFailed(true);
    }
    setLoaded(true);
  }, [channelId]);

  useEffect(() => {
    setLoaded(false);
    setIdentityLoadFailed(false);
    setShowAllMembers(false);
    setCopiedId(false);
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (!channelId) return;
    if (event.kind === "message.posted") {
      const payload = event.payload as { message?: { conversationId?: string } } | undefined;
      if (payload?.message?.conversationId === channelId) void load();
      return;
    }
    if (
      event.kind === "conversation.upserted" ||
      event.kind === "invocation.requested" ||
      event.kind === "flight.updated" ||
      event.kind === "collaboration.event.appended"
    ) {
      void load();
    }
  });

  const items = useMemo(
    () => buildChannelActivityItems(workItems, runs, agents),
    [workItems, runs, agents],
  );
  const members = useMemo(
    () => buildChannelMembers(session, agents, items),
    [session, agents, items],
  );
  const namedItems = useMemo(
    () => items.map((item) => ({
      ...item,
      actorName: channelMemberForActor(members, item.actorId)?.name ?? item.actorName,
    })),
    [items, members],
  );
  const activeItems = namedItems.filter((item) => item.active);
  const recentItems = namedItems.filter((item) => !item.active);
  const visibleMembers = showAllMembers ? members : members.slice(0, 6);
  const hiddenMemberCount = Math.max(0, members.length - visibleMembers.length);
  const workspace = sharedChannelWorkspace(members);
  const channelLabel = channelDisplayLabel(session, channelId);

  if (!channelId) {
    return (
      <div className="ctx-panel ctx-panel--empty">
        <div className="ctx-panel-empty-state">
          <div className="ctx-panel-empty-hint">Select a channel to see related work.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ctx-panel ctx-panel--channel">
      <section className="ctx-panel-section ctx-panel-channel-summary">
        <div className="ctx-panel-section-label">Channel</div>
        <div className="ctx-panel-channel-card">
          <span className="ctx-panel-hash">#</span>
          <div className="ctx-panel-body">
            <span className="ctx-panel-name" title={channelLabel}>{channelLabel.replace(/^#/, "")}</span>
            <span className="ctx-panel-preview">
              {loaded
                ? `Group channel · ${members.length} member${members.length === 1 ? "" : "s"} · ${activeItems.length} active`
                : "Loading channel context"}
            </span>
            {workspace && <span className="ctx-panel-sub">{workspace}</span>}
          </div>
          <button
            type="button"
            className="ctx-panel-copy-id"
            aria-label={copiedId ? "Conversation ID copied" : "Copy conversation ID"}
            title={copiedId ? "Copied" : "Copy conversation ID"}
            onClick={() => {
              void copyTextToClipboard(channelId).then((copied) => {
                if (!copied) return;
                setCopiedId(true);
                window.setTimeout(() => setCopiedId(false), 1_600);
              });
            }}
          >
            {copiedId
              ? <Check size={12} strokeWidth={2} aria-hidden="true" />
              : <Copy size={12} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        </div>
      </section>

      <section className="ctx-panel-section ctx-panel-members" aria-labelledby="channel-members-label">
        <div id="channel-members-label" className="ctx-panel-section-label">
          Members
          <span className="ctx-panel-count">{members.length}</span>
        </div>
        {!loaded ? (
          <ChannelMemberSkeleton />
        ) : members.length === 0 ? (
          <div className="ctx-panel-empty">
            {identityLoadFailed ? "Channel profiles are unavailable" : "No resolved members"}
          </div>
        ) : (
          <div className={["ctx-panel-member-list", showAllMembers && "ctx-panel-member-list--expanded"].filter(Boolean).join(" ")} role="list">
            {visibleMembers.map((member) => (
              <div key={member.id} className="ctx-panel-member-item" role="listitem">
                <ChannelMemberButton
                  member={member}
                  agents={agents}
                  navigate={navigate}
                  returnRoute={returnRoute}
                />
              </div>
            ))}
          </div>
        )}
        {members.length > 6 && (
          <button
            type="button"
            className="ctx-panel-members-toggle"
            aria-expanded={showAllMembers}
            onClick={() => setShowAllMembers((current) => !current)}
          >
            {showAllMembers
              ? "Show fewer"
              : `Show all ${members.length} members${hiddenMemberCount ? ` · +${hiddenMemberCount}` : ""}`}
          </button>
        )}
      </section>

      <section className="ctx-panel-section" aria-labelledby="channel-doing-label">
        <div id="channel-doing-label" className="ctx-panel-section-label">
          Doing
          <span className="ctx-panel-count">{activeItems.length}</span>
        </div>
        {activeItems.length === 0 ? (
          <div className="ctx-panel-empty">{loaded ? "No active work in this channel" : "Loading context"}</div>
        ) : (
          <div className="ctx-panel-list">
            {activeItems.map((item) => (
              <ChannelActivityButton
                key={item.id}
                item={item}
                navigate={navigate}
                returnRoute={returnRoute}
              />
            ))}
          </div>
        )}
      </section>

      <section className="ctx-panel-section" aria-labelledby="channel-recent-label">
        <div id="channel-recent-label" className="ctx-panel-section-label">
          Recent
          <span className="ctx-panel-count">{recentItems.length}</span>
        </div>
        {recentItems.length === 0 ? (
          <div className="ctx-panel-empty">{loaded ? "No recent channel runs" : "Loading context"}</div>
        ) : (
          <div className="ctx-panel-list ctx-panel-list--scroll">
            {recentItems.map((item) => (
              <ChannelActivityButton
                key={item.id}
                item={item}
                navigate={navigate}
                returnRoute={returnRoute}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ChannelMemberSkeleton() {
  return (
    <div className="ctx-panel-member-list" aria-label="Loading channel members" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="ctx-panel-member ctx-panel-member--skeleton" aria-hidden="true">
          <span className="ctx-panel-member-skeleton-avatar" />
          <span className="ctx-panel-member-skeleton-lines">
            <span />
            <span />
          </span>
        </div>
      ))}
    </div>
  );
}

function ChannelMemberButton({
  member,
  agents,
  navigate,
  returnRoute,
}: {
  member: ChannelMemberProfile;
  agents: Agent[];
  navigate: (route: Route) => void;
  returnRoute: Route;
}) {
  const agent = member.agentId
    ? agents.find((candidate) => candidate.id === member.agentId)
    : null;
  const route: Route | null = member.preferredRoute === "session" && member.sessionId
    ? { view: "sessions", sessionId: member.sessionId }
    : member.preferredRoute === "agent" && member.agentId
      ? { view: "agents-v2", agentId: member.agentId, tab: "profile" }
      : null;
  const runtimeDetail = [member.model, member.reasoningEffort].filter(Boolean).join(" · ");
  const title = [
    `${member.name} · ${channelMemberStatusLabel(member.status)}`,
    runtimeDetail,
    member.sessionId,
  ].filter(Boolean).join(" · ");
  const content = (
    <>
      <span className="ctx-panel-member-avatar-wrap">
        <AgentAvatar
          agent={agent ?? undefined}
          name={member.name}
          placement="list"
          className="ctx-panel-avatar"
        />
        <span className="ctx-panel-member-state-dot" data-status={member.status} aria-hidden="true" />
      </span>
      <span className="ctx-panel-body">
        <span className="ctx-panel-name">{member.name}</span>
        <span className="ctx-panel-sub">{member.detail}</span>
      </span>
      <span className="ctx-panel-member-status" data-status={member.status}>
        {member.isOperator ? "Here" : channelMemberStatusLabel(member.status)}
      </span>
    </>
  );

  if (!route) {
    return <div className="ctx-panel-member" title={title}>{content}</div>;
  }
  return (
    <button
      type="button"
      className="ctx-panel-member ctx-panel-member--button"
      title={title}
      aria-label={`Open ${member.name} ${member.preferredRoute === "session" ? "session" : "profile"}`}
      onClick={() => openContent(navigate, route, { returnTo: returnRoute })}
    >
      {content}
    </button>
  );
}

function ChannelActivityButton({
  item,
  navigate,
  returnRoute,
}: {
  item: ChannelActivityItem;
  navigate: (route: Route) => void;
  returnRoute: Route;
}) {
  const content = (
    <>
      <AgentAvatar name={item.actorName} placement="list" className="ctx-panel-avatar" />
      <div className="ctx-panel-body">
        <span className="ctx-panel-name">{item.actorName}</span>
        <span className="ctx-panel-sub">{item.status}</span>
        <span className="ctx-panel-preview">{item.title}</span>
        {item.active && item.detail && item.detail !== item.title && (
          <span className="ctx-panel-preview">{item.detail}</span>
        )}
      </div>
      <div className="ctx-panel-trailing">
        <span className="ctx-panel-time">{timeAgo(item.updatedAt)}</span>
      </div>
    </>
  );

  if (!item.route) {
    return <div className="ctx-panel-item ctx-panel-channel-item">{content}</div>;
  }

  return (
    <button
      type="button"
      className={[
        "ctx-panel-item",
        "ctx-panel-channel-item",
        item.active && "ctx-panel-item--active",
      ].filter(Boolean).join(" ")}
      aria-label={`${item.actorName}, ${item.status}, ${item.title}`}
      onClick={() => openContent(navigate, item.route!, { returnTo: returnRoute })}
    >
      {content}
    </button>
  );
}

export { ChannelInspectorPanel as ChatChannelsRight };
