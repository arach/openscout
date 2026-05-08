import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useScout } from "../Provider.tsx";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import type { WorkDetail } from "../../lib/types.ts";

export function WorkInspector() {
  const { route, navigate } = useScout();
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
  useBrokerEvents(() => {
    if (!workId) {
      return;
    }
    void load();
  });

  if (route.view !== "work") return null;

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-ghost)]">
        Loading work item…
      </div>
    );
  }

  const stateColor = stateToColor(detail.state);
  const nextMove = inspectorNextMove(detail);

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

      <Section label="Network signal">
        <div className="text-[12px] leading-snug text-[var(--scout-chrome-ink-strong)]">
          {nextMove.title}
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
          {nextMove.detail}
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {detail.conversationId && (
            <button
              type="button"
              onClick={() => navigate({ view: "conversation", conversationId: detail.conversationId! })}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-cyan-400/25 bg-cyan-400/10 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300/90 hover:bg-cyan-400/15"
            >
              <MessageSquare aria-hidden="true" size={12} strokeWidth={1.8} />
              Open thread
            </button>
          )}
        </div>
      </Section>

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

      {detail.lastMeaningfulSummary && (
        <Section label="Hudson context">
          <div className="text-[11px] italic leading-relaxed text-[var(--scout-chrome-ink-soft)]">
            {detail.lastMeaningfulSummary}
          </div>
          <div className="mt-2 flex gap-1.5">
            <span className="rounded border border-[var(--scout-chrome-border-soft)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
              Plan
            </span>
            <span className="rounded border border-[var(--scout-chrome-border-soft)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
              Docs
            </span>
            <span className="rounded border border-[var(--scout-chrome-border-soft)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
              Code
            </span>
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

function inspectorNextMove(detail: WorkDetail): { title: string; detail: string } {
  const owner = detail.ownerName ?? detail.ownerId ?? "Unassigned";
  const nextOwner = detail.nextMoveOwnerName ?? detail.nextMoveOwnerId ?? owner;
  const accountable = nextOwner === "Unassigned" ? owner : nextOwner;

  if (detail.attention === "interrupt") {
    return {
      title: `Blocker surfaced for ${accountable}`,
      detail: detail.conversationId ? "Open only if you want context." : "Record has the blocking context.",
    };
  }

  if (detail.attention === "badge") {
    return {
      title: `Plan activity from ${accountable}`,
      detail: detail.conversationId ? "Plan/spec discussion in the agent network." : "No thread is attached yet.",
    };
  }

  if (detail.activeFlights.length > 0 || detail.state === "working") {
    return {
      title: `${owner} is working`,
      detail: detail.conversationId ? "Thread has live context." : "Timeline will update next.",
    };
  }

  if (detail.state === "done") {
    return {
      title: "Work is done",
      detail: detail.conversationId ? "Thread has final context." : "Record is preserved here.",
    };
  }

  return {
    title: nextOwner === "Unassigned" ? "No next owner set" : `Waiting on ${nextOwner}`,
    detail: detail.conversationId ? "Thread has current context." : "Record and timeline are current.",
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
