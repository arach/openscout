"use client";

import React from "react";
import { Clock, Copy, RefreshCw, X } from "lucide-react";

import type {
  DesktopHomeActivityItem,
  DesktopHomeAgent,
} from "@/lib/scout-desktop";

type ThemePalette = Record<string, string>;
type ThemeStyles = {
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  activePill: React.CSSProperties;
};

export type OverviewViewProps = {
  C: ThemePalette;
  s: ThemeStyles;
  bootLoader: React.ReactNode;
  homeAgents: DesktopHomeAgent[];
  activity: DesktopHomeActivityItem[];
  shellError: string | null;
  onRefresh: () => void;
  onOpenAgent: (agentId: string) => void;
  colorForIdentity: (identity: string) => string;
};

function statusTone(
  status: DesktopHomeAgent["state"],
  styles: ThemeStyles,
) {
  if (status === "working") {
    return styles.activePill;
  }

  if (status === "available") {
    return {
      backgroundColor: "rgba(34, 197, 94, 0.12)",
      color: "#166534",
    };
  }

  return styles.tagBadge;
}

export function OverviewView({
  C,
  s,
  bootLoader,
  homeAgents,
  activity,
  shellError,
  onRefresh,
  onOpenAgent,
  colorForIdentity,
}: OverviewViewProps) {
  const featuredAgents = React.useMemo(
    () => homeAgents.slice(0, 8),
    [homeAgents],
  );
  const recentActivity = React.useMemo(
    () => activity.slice(0, 18),
    [activity],
  );

  const handleCopy = React.useCallback(async (event: React.MouseEvent, value: string) => {
    event.stopPropagation();
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Ignore clipboard failures on Home.
    }
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="w-full px-8 py-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1
                className="text-[22px] font-semibold tracking-tight"
                style={s.inkText}
              >
                Home
              </h1>
              <p className="text-[12px] mt-1 leading-[1.6]" style={s.mutedText}>
                Recent agents and the latest relay activity.
              </p>
            </div>
            <button
              onClick={onRefresh}
              className="os-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors"
              style={{ color: C.muted }}
              title="Refresh"
            >
              <RefreshCw size={13} />
            </button>
          </div>

          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-semibold" style={s.inkText}>
                Recent Agents
              </h2>
              {homeAgents.length > featuredAgents.length ? (
                <div className="text-[11px]" style={s.mutedText}>
                  Top {featuredAgents.length} by recent activity
                </div>
              ) : null}
            </div>

            {featuredAgents.length > 0 ? (
              <div className="-mx-2 overflow-x-auto px-2 pb-2">
                <div className="flex gap-3 min-w-max">
                  {featuredAgents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => onOpenAgent(agent.id)}
                      className="w-[220px] shrink-0 text-left rounded-xl border px-4 py-3 transition-colors hover:opacity-90"
                      style={{ borderColor: C.border, backgroundColor: C.surface }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-10 h-10 rounded-full text-white flex items-center justify-center text-[12px] font-bold shrink-0"
                          style={{ backgroundColor: colorForIdentity(agent.id) }}
                          title={agent.title}
                        >
                          {agent.title.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div
                              className="text-[13px] font-semibold truncate"
                              style={s.inkText}
                            >
                              {agent.title}
                            </div>
                            <span
                              className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-full"
                              style={statusTone(agent.state, s)}
                            >
                              {agent.statusLabel}
                            </span>
                          </div>
                          {agent.role ? (
                            <div className="text-[11px] mt-1 truncate" style={s.mutedText}>
                              {agent.role}
                            </div>
                          ) : null}
                          {agent.statusDetail ? (
                            <div className="text-[11px] mt-2 line-clamp-2" style={s.mutedText}>
                              {agent.statusDetail}
                            </div>
                          ) : agent.summary ? (
                            <div className="text-[11px] mt-2 line-clamp-2" style={s.mutedText}>
                              {agent.summary}
                            </div>
                          ) : null}
                          {agent.timestampLabel ? (
                            <div className="text-[10px] mt-2 uppercase tracking-[0.12em]" style={s.mutedText}>
                              Active {agent.timestampLabel}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div
                className="rounded-xl border px-4 py-6 text-[13px]"
                style={{ borderColor: C.border, color: C.muted }}
              >
                No agents are visible yet.
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-semibold" style={s.inkText}>
                Activity Stream
              </h2>
            </div>

            {bootLoader ? (
              <div
                className="min-h-[20rem] flex items-center justify-center rounded-xl border px-6 py-8"
                style={{ borderColor: C.border, backgroundColor: C.surface }}
              >
                {bootLoader}
              </div>
            ) : recentActivity.length > 0 ? (
              <div
                className="divide-y rounded-xl border overflow-hidden"
                style={{ borderColor: C.border }}
              >
                {recentActivity.map((item) => (
                  <div
                    key={item.id}
                    className="group relative flex items-start gap-4 px-4 py-4"
                    style={{ backgroundColor: C.surface }}
                  >
                    <button
                      type="button"
                      className="relative shrink-0 mt-0.5"
                      onClick={() => onOpenAgent(item.actorId)}
                      title={item.actorName}
                    >
                      <div
                        className="w-9 h-9 rounded-full text-white flex items-center justify-center text-[12px] font-bold"
                        style={{ backgroundColor: colorForIdentity(item.actorId) }}
                      >
                        {item.actorName.slice(0, 1).toUpperCase()}
                      </div>
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <button
                          type="button"
                          className="text-[13px] font-semibold transition-opacity hover:opacity-75"
                          style={s.inkText}
                          onClick={() => onOpenAgent(item.actorId)}
                          title={`Open ${item.actorName}`}
                        >
                          {item.actorName}
                        </button>
                        {item.kind === "system" ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={s.tagBadge}>
                            system
                          </span>
                        ) : item.channel ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={s.tagBadge}>
                            #{item.channel}
                          </span>
                        ) : null}
                        <span className="flex-1" />
                        <span
                          className="text-[11px] flex items-center gap-1"
                          style={s.mutedText}
                        >
                          <Clock size={10} />
                          {item.timestampLabel}
                        </span>
                      </div>

                      <div className="text-[13px] leading-[1.65]" style={s.mutedText}>
                        {item.detail ?? item.title}
                      </div>
                    </div>

                    {item.detail ? (
                      <div
                        className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{
                          backgroundColor: C.bg,
                          borderColor: C.border,
                        }}
                      >
                        <button
                          onClick={(event) => void handleCopy(event, item.detail ?? "")}
                          className="p-1 rounded hover:opacity-70"
                          style={{ color: C.muted }}
                          title="Copy"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="py-16 text-center border rounded-xl"
                style={{ borderColor: C.border }}
              >
                <div className="text-[13px]" style={s.mutedText}>
                  Waiting for recent activity...
                </div>
              </div>
            )}
          </section>

          {shellError ? (
            <div
              className="mt-6 rounded-xl border px-4 py-3"
              style={{ borderColor: C.border, backgroundColor: C.surface }}
            >
              <div className="flex items-center gap-2 text-[12px]" style={s.mutedText}>
                <X size={12} />
                <span>{shellError}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
