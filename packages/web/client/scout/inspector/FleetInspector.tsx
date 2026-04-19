import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import type { FleetState } from "../../lib/types.ts";

export function FleetInspector() {
  const [fleet, setFleet] = useState<FleetState | null>(null);

  const load = useCallback(async () => {
    try {
      setFleet(await api<FleetState>("/api/fleet"));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(load);

  if (!fleet) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] font-mono uppercase tracking-[0.15em] text-white/25">
        Loading fleet…
      </div>
    );
  }

  const t = fleet.totals;

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30">
        Updated {timeAgo(fleet.generatedAt)}
      </div>

      <Metric label="Needs Input" value={t.needsAttention} emphasis={t.needsAttention > 0 ? "warn" : "muted"} />
      <Metric label="Active Asks" value={t.active} />
      <Metric label="Recent Finished" value={t.recentCompleted} emphasis={t.recentCompleted > 0 ? "good" : "muted"} />
      <Metric label="Activity" value={t.activity} />
    </div>
  );
}

function Metric({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: "good" | "warn" | "muted";
}) {
  const valueColor =
    emphasis === "good"
      ? "text-emerald-300/90"
      : emphasis === "warn"
        ? "text-amber-300/90"
        : emphasis === "muted"
          ? "text-white/40"
          : "text-white/80";
  return (
    <div className="flex flex-col pb-3 border-b border-white/[0.04] last:border-b-0">
      <span
        className={`text-[24px] font-mono tabular-nums leading-none ${valueColor}`}
      >
        {value}
      </span>
      <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30 mt-1">
        {label}
      </span>
    </div>
  );
}
