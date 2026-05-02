import { useCallback, useEffect, useState } from "react";
import "./ctx-panel.css";
import { api } from "../../lib/api.ts";
import { actorColor } from "../../lib/colors.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../Provider.tsx";
import type { FleetAttentionItem, FleetAsk, FleetState } from "../../lib/types.ts";

export function ScoutFleetLeftPanel() {
  const { navigate } = useScout();
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
  const active = (state?.activeAsks ?? []).filter((a) => a.status !== "needs_attention");

  const openAsk = (ask: FleetAsk) => {
    if (ask.conversationId) {
      navigate({ view: "conversation", conversationId: ask.conversationId });
    }
  };

  const openAttention = (item: FleetAttentionItem) => {
    if (item.conversationId) {
      navigate({ view: "conversation", conversationId: item.conversationId });
    }
  };

  return (
    <div className="ctx-panel">
      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Needs you
          {needs.length > 0 && <span className="ctx-panel-count">{needs.length}</span>}
        </div>
        {needs.length === 0 ? (
          <div className="ctx-panel-empty">All clear</div>
        ) : (
          <div className="ctx-panel-list">
            {needs.map((item) => (
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
                  <span className="ctx-panel-sub">
                    {item.agentName ?? item.agentId ?? "—"} · {timeAgo(item.updatedAt)}
                  </span>
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
          <div className="ctx-panel-list">
            {active.slice(0, 12).map((ask) => (
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
                  <span className="ctx-panel-sub">
                    {ask.agentName ?? ask.agentId} · {ask.statusLabel}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
