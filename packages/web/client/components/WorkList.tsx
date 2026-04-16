import { renderWithMentions } from "../lib/mentions.tsx";
import { timeAgo } from "../lib/time.ts";
import type { Route, WorkItem } from "../lib/types.ts";

function pillVariant(work: WorkItem): "updated" | "working" | "completed" | "failed" {
  if (work.attention === "interrupt") return "failed";
  if (work.state === "done") return "completed";
  if (work.attention === "badge" || work.state === "waiting" || work.state === "review") return "updated";
  return "working";
}

function stateLabel(state: string): string {
  switch (state) {
    case "review":
      return "In review";
    case "waiting":
      return "Waiting";
    case "working":
      return "Working";
    case "done":
      return "Done";
    default:
      return state.replace(/_/g, " ");
  }
}

function attentionLabel(attention: WorkItem["attention"]): string | null {
  switch (attention) {
    case "badge":
      return "Needs attention";
    case "interrupt":
      return "Blocked";
    default:
      return null;
  }
}

type WorkListProps = {
  items: WorkItem[];
  navigate: (route: Route) => void;
  emptyTitle: string;
  emptyDetail?: string;
};

export function WorkList({
  items,
  navigate,
  emptyTitle,
  emptyDetail,
}: WorkListProps) {
  if (items.length === 0) {
    return (
      <div className="s-empty">
        <p>{emptyTitle}</p>
        {emptyDetail && <p>{emptyDetail}</p>}
      </div>
    );
  }

  return (
    <div className="s-work-list">
      {items.map((work) => {
        const clickable = Boolean(work.id) || Boolean(work.conversationId);
        const attention = attentionLabel(work.attention);
        const ownerLabel = work.ownerName ?? work.ownerId ?? "Unassigned";

        const onClick = work.id
          ? () => navigate({ view: "work", workId: work.id })
          : work.conversationId
          ? () => navigate({ view: "conversation", conversationId: work.conversationId! })
          : undefined;

        return (
          <div
            key={work.id}
            className={`s-work-row${clickable ? " s-work-row-clickable" : ""}`}
            onClick={onClick}
          >
            <div className="s-work-row-header">
              <div className="s-work-row-title-wrap">
                <span className="s-work-row-title">{work.title}</span>
                {work.priority && <span className="s-badge">{work.priority}</span>}
              </div>
              <span className={`s-pill s-pill-${pillVariant(work)}`}>{work.currentPhase}</span>
            </div>
            <div className="s-work-row-meta">
              <span>{ownerLabel}</span>
              <span>{stateLabel(work.state)}</span>
              {work.activeChildWorkCount > 0 && (
                <span>{work.activeChildWorkCount} child{work.activeChildWorkCount === 1 ? "" : "ren"}</span>
              )}
              {work.activeFlightCount > 0 && (
                <span>{work.activeFlightCount} flight{work.activeFlightCount === 1 ? "" : "s"}</span>
              )}
              {attention && <span>{attention}</span>}
              <span>{timeAgo(work.lastMeaningfulAt)}</span>
            </div>
            {work.lastMeaningfulSummary && (
              <p className="s-work-row-summary">{renderWithMentions(work.lastMeaningfulSummary)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
