import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { openContent } from "../../scout/slots/openContent.ts";
import type { Agent, AgentRun, Route, WorkItem } from "../../lib/types.ts";

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

function channelRouteLabel(channelId: string): string {
  return channelId;
}

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
  return state.replace(/_/g, " ");
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
    status: activeFlights ?? work.currentPhase,
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
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!channelId) {
      setLoaded(true);
      setWorkItems([]);
      setRuns([]);
      return;
    }
    try {
      const [work, channelRuns] = await Promise.all([
        api<WorkItem[]>(
          `/api/work?conversationId=${encodeURIComponent(channelId)}&active=true&limit=12`,
        ),
        api<AgentRun[]>(
          `/api/runs?conversationId=${encodeURIComponent(channelId)}&active=false&limit=24`,
        ),
      ]);
      setWorkItems(work);
      setRuns(channelRuns);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [channelId]);

  useEffect(() => {
    setLoaded(false);
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
  const activeItems = items.filter((item) => item.active);
  const recentItems = items.filter((item) => !item.active);

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
            <span className="ctx-panel-name">{channelRouteLabel(channelId)}</span>
            <span className="ctx-panel-preview">
              {loaded ? `${items.length} related item${items.length === 1 ? "" : "s"}` : "Loading context"}
            </span>
          </div>
        </div>
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Doing
          <span className="ctx-panel-count">{activeItems.length}</span>
        </div>
        {activeItems.length === 0 ? (
          <div className="ctx-panel-empty">No active channel work</div>
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

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
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
        <span className="ctx-panel-sub">
          {item.kind} · {item.status}
        </span>
        <span className="ctx-panel-preview">{item.title}</span>
        {item.detail && <span className="ctx-panel-preview">{item.detail}</span>}
      </div>
      <div className="ctx-panel-trailing">
        <span className="ctx-panel-time">{timeAgo(item.updatedAt)}</span>
        {item.active && <span className="ctx-panel-dot" />}
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
      onClick={() => openContent(navigate, item.route!, { returnTo: returnRoute })}
    >
      {content}
    </button>
  );
}

export { ChannelInspectorPanel as ChatChannelsRight };
