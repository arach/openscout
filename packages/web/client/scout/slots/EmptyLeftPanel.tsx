import { useCallback, useEffect, useMemo, useState } from "react";
import "./ctx-panel.css";
import { isAgentOnline } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import { actorColor } from "../../lib/colors.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../Provider.tsx";
import type { FleetAsk, FleetAttentionItem, FleetState, Route } from "../../lib/types.ts";

const VIEW_HINTS: Record<string, string> = {
  mesh: "Mesh nodes will appear here",
  broker: "Broker diagnostics are in the main pane",
  activity: "Filters will appear here",
  ops: "Ops modes will appear here",
  work: "Work tree will appear here",
  settings: "Sections will appear here",
  terminal: "Terminal sessions will appear here",
  sessions: "Use the screen to browse",
};

export function ScoutEmptyLeftPanel() {
  const { agents, route, navigate } = useScout();
  const onlineCount = useMemo(
    () => agents.filter((a) => isAgentOnline(a.state)).length,
    [agents],
  );

  const hint = VIEW_HINTS[route.view] ?? "Nothing to navigate here";

  if (route.view === "ops") {
    return (
      <ScoutOpsLeftPanel
        navigate={navigate}
      />
    );
  }

  return (
    <div className="ctx-panel ctx-panel--empty">
      <div className="ctx-panel-empty-state">
        <div className="ctx-panel-empty-hint">{hint}</div>
      </div>

      <button
        type="button"
        className="ctx-panel-roster-button"
        onClick={() => navigate({ view: "agents" })}
      >
        <span className="ctx-panel-roster-label">Agents</span>
        <span className="ctx-panel-roster-count">
          <span className="ctx-panel-roster-online-dot" />
          {onlineCount} online · {agents.length} total
        </span>
      </button>
    </div>
  );
}

function ScoutOpsLeftPanel({
  navigate,
}: {
  navigate: (route: Route) => void;
}) {
  const [state, setState] = useState<FleetState | null>(null);

  const load = useCallback(async () => {
    const data = await api<FleetState>("/api/fleet").catch(() => null);
    setState(data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted" ||
      event.kind === "flight.updated" ||
      event.kind === "collaboration.event.appended"
    ) {
      void load();
    }
  });

  const needs = state?.needsAttention ?? [];
  const active = (state?.activeAsks ?? []).filter((ask) => ask.status !== "needs_attention");

  const openAttention = (item: FleetAttentionItem) => {
    if (item.conversationId) {
      navigate({ view: "conversation", conversationId: item.conversationId });
    } else {
      navigate({ view: "ops", mode: "command" });
    }
  };

  const openAsk = (ask: FleetAsk) => {
    if (ask.conversationId) {
      navigate({ view: "conversation", conversationId: ask.conversationId });
    } else {
      navigate({ view: "ops", mode: "runs" });
    }
  };

  return (
    <div className="ctx-panel ctx-panel--ops">
      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Needs you
          {needs.length > 0 && <span className="ctx-panel-count">{needs.length}</span>}
        </div>
        {needs.length === 0 ? (
          <div className="ctx-panel-empty">All clear</div>
        ) : (
          <div className="ctx-panel-list">
            {needs.slice(0, 4).map((item) => (
              <button
                key={item.recordId}
                type="button"
                className="ctx-panel-item ctx-panel-item--attention"
                onClick={() => openAttention(item)}
              >
                <div
                  className="ctx-panel-avatar"
                  style={{ background: actorColor(item.agentName ?? item.agentId ?? item.title) }}
                >
                  {(item.agentName ?? item.agentId ?? "?")[0]?.toUpperCase()}
                </div>
                <div className="ctx-panel-body">
                  <span className="ctx-panel-name">{item.title}</span>
                  <span className="ctx-panel-sub">{item.agentName ?? item.agentId ?? "operator"} · {timeAgo(item.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Active
          {active.length > 0 && <span className="ctx-panel-count">{active.length}</span>}
        </div>
        {active.length === 0 ? (
          <div className="ctx-panel-empty">No active asks</div>
        ) : (
          <div className="ctx-panel-list ctx-panel-list--scroll">
            {active.slice(0, 10).map((ask) => (
              <button
                key={ask.invocationId}
                type="button"
                className="ctx-panel-item"
                onClick={() => openAsk(ask)}
              >
                <div
                  className="ctx-panel-avatar"
                  style={{ background: actorColor(ask.agentName ?? ask.agentId) }}
                >
                  {(ask.agentName ?? ask.agentId)[0]?.toUpperCase()}
                </div>
                <div className="ctx-panel-body">
                  <span className="ctx-panel-name">{ask.task}</span>
                  <span className="ctx-panel-sub">{ask.agentName ?? ask.agentId} · {ask.statusLabel}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
