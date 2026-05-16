import { useCallback, useEffect, useState } from "react";
import "./ctx-panel.css";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../Provider.tsx";
import { openContent } from "./openContent.ts";
import { RailRow } from "./RailRow.tsx";
import type { FleetAsk, FleetAttentionItem, FleetState } from "../../lib/types.ts";

export function ScoutOpsLeftPanel() {
  const { navigate, route } = useScout();
  const [state, setState] = useState<FleetState | null>(null);

  const load = useCallback(async () => {
    const data = await api<FleetState>("/api/fleet").catch(() => null);
    setState(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      openContent(navigate, { view: "conversation", conversationId: item.conversationId }, { returnTo: route });
    } else {
      navigate({ view: "ops", mode: "command" });
    }
  };

  const openAsk = (ask: FleetAsk) => {
    if (ask.conversationId) {
      openContent(navigate, { view: "conversation", conversationId: ask.conversationId }, { returnTo: route });
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
          needs.slice(0, 4).map((item) => {
            const label = item.agentName ?? item.agentId ?? "operator";
            return (
              <RailRow
                key={item.recordId}
                name={item.title}
                meta={timeAgo(item.updatedAt)}
                tone="working"
                unread
                title={`${label} · ${item.kind}`}
                onClick={() => openAttention(item)}
              />
            );
          })
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
          active.slice(0, 10).map((ask) => (
            <RailRow
              key={ask.invocationId}
              name={ask.task}
              meta={timeAgo(ask.updatedAt)}
              tone={ask.agentState}
              title={`${ask.agentName ?? ask.agentId} · ${ask.statusLabel}`}
              onClick={() => openAsk(ask)}
            />
          ))
        )}
      </section>
    </div>
  );
}
