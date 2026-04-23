import { useCallback, useEffect, useState } from "react";
import { useScout } from "../Provider.tsx";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import type { WorkDetail } from "../../lib/types.ts";

export function WorkInspector() {
  const { route } = useScout();
  const workId = route.view === "work" ? route.workId : null;
  const [detail, setDetail] = useState<WorkDetail | null>(null);

  const load = useCallback(async () => {
    if (!workId) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await api<WorkDetail>(`/api/work/${encodeURIComponent(workId)}`));
    } catch {
      setDetail(null);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(load);

  if (route.view !== "work") return null;

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-ghost)]">
        Loading work item…
      </div>
    );
  }

  const stateColor = stateToColor(detail.state);

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      <div className="border-b border-[var(--scout-chrome-border-soft)] pb-3">
        <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-cyan-400/70 mb-1">
          Case {compactId(detail.id)}
        </div>
        <div className="text-[13px] leading-snug text-[var(--scout-chrome-ink-strong)]">
          {detail.title}
        </div>
      </div>

      <Section label="State">
        <div className="flex items-baseline gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${stateColor.dot}`} />
          <span className={`text-[12px] capitalize ${stateColor.text}`}>
            {detail.state.replace(/_/g, " ")}
          </span>
        </div>
        <div className="mt-1 text-[10px] font-mono text-[var(--scout-chrome-ink-faint)]">
          Phase · {detail.currentPhase}
        </div>
      </Section>

      <Section label="Ownership">
        {detail.ownerName && <Row label="Owner" value={detail.ownerName} />}
        {detail.nextMoveOwnerName && (
          <Row label="Next move" value={detail.nextMoveOwnerName} />
        )}
        {detail.priority && <Row label="Priority" value={detail.priority} />}
      </Section>

      <Section label="Activity">
        <Row label="Children" value={`${detail.activeChildWorkCount}`} />
        <Row label="Flights" value={`${detail.activeFlightCount}`} />
        {detail.lastMeaningfulAt && (
          <Row label="Last update" value={timeAgo(detail.lastMeaningfulAt)} />
        )}
      </Section>

      {detail.attention !== "silent" && (
        <div
          className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm ${
            detail.attention === "interrupt"
              ? "text-red-300/90 bg-red-500/10 border border-red-500/20"
              : "text-amber-300/90 bg-amber-500/10 border border-amber-500/20"
          }`}
        >
          {detail.attention === "interrupt" ? "Interrupt" : "Needs attention"}
        </div>
      )}

      {detail.lastMeaningfulSummary && (
        <Section label="Latest">
          <div className="text-[11px] italic leading-relaxed text-[var(--scout-chrome-ink-soft)]">
            {detail.lastMeaningfulSummary}
          </div>
        </Section>
      )}
    </div>
  );
}

function compactId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function stateToColor(state: string): { dot: string; text: string } {
  if (/complete|done|finished/i.test(state))
    return { dot: "bg-emerald-400", text: "text-emerald-300/90" };
  if (/fail|error/i.test(state))
    return { dot: "bg-red-400", text: "text-red-300/90" };
  if (/block|wait|pause/i.test(state))
    return { dot: "bg-amber-400", text: "text-amber-300/90" };
  if (/active|working|in[_-]?progress/i.test(state))
    return { dot: "bg-cyan-400", text: "text-cyan-300/90" };
  return {
    dot: "bg-[var(--scout-chrome-ink-faint)]",
    text: "text-[var(--scout-chrome-ink)]",
  };
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-[var(--scout-chrome-ink-faint)]">
        {label}
      </span>
      <span className="truncate text-[11px] font-mono text-[var(--scout-chrome-ink)]">
        {value}
      </span>
    </div>
  );
}
