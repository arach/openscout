"use client";

import React from "react";
import {
  Bot,
  ChevronRight,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  Filter,
  Folder,
  MessageSquare,
  Network,
  Radar,
  RefreshCw,
  Search,
  Users,
  X,
  Zap,
} from "lucide-react";
import type {
  ScoutRelayMessage,
  ScoutRelayDestinationKind,
  ScoutDesktopTask,
  ScoutSessionMetadata,
  ScoutRelayDirectThread,
} from "../../../app/desktop/state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThemePalette = Record<string, string>;
type ThemeStyles = {
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  activePill: React.CSSProperties;
};

type AppView =
  | "overview"
  | "activity"
  | "machines"
  | "plans"
  | "sessions"
  | "search"
  | "relay"
  | "inter-agent"
  | "agents"
  | "logs"
  | "settings"
  | "help";

type FeatureFlags = {
  relay?: boolean;
  interAgent?: boolean;
  sessions?: boolean;
  plans?: boolean;
  search?: boolean;
  machines?: boolean;
};

type OverviewProject = {
  name: string;
  count: number;
};

type Stats = {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
};

// ---------------------------------------------------------------------------
// Inter-Agent icon (inline SVG to avoid importing from app.tsx)
// ---------------------------------------------------------------------------

function InterAgentIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="16" r="3" />
      <path d="M10.5 10.5L13.5 13.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type OverviewViewProps = {
  C: ThemePalette;
  s: ThemeStyles;
  features: FeatureFlags;
  stats: Stats;
  runtime: { messageCount?: number } | null;
  machinesOnlineCount: number;
  reachableAgents: ScoutRelayDirectThread[];
  activityMessages: ScoutRelayMessage[];
  activityTasks: ScoutDesktopTask[];
  overviewSessions: ScoutSessionMetadata[];
  overviewProjects: OverviewProject[];
  runningTaskCount: number;
  shellError: string | null;
  agentLookup: Map<string, { id: string }>;
  onNavigate: (view: AppView) => void;
  onCreateAgent: () => void;
  onRefresh: () => void;
  onOpenAgent: (agentId: string) => void;
  onOpenSession: (session: ScoutSessionMetadata) => void;
  onOpenProject: (projectName: string) => void;
  onSelectRelay: (kind: ScoutRelayDestinationKind, id: string) => void;
  formatDate: (dateStr: string) => string;
  colorForIdentity: (identity: string) => string;
  cleanDisplayTitle: (title: string) => string;
  messagePreviewSnippet: (body: string, maxLength?: number) => string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverviewView({
  C,
  s,
  features,
  stats,
  runtime,
  machinesOnlineCount,
  reachableAgents,
  activityMessages,
  activityTasks,
  overviewSessions,
  overviewProjects,
  runningTaskCount,
  shellError,
  agentLookup,
  onNavigate,
  onCreateAgent,
  onRefresh,
  onOpenAgent,
  onOpenSession,
  onOpenProject,
  onSelectRelay,
  formatDate,
  colorForIdentity,
  cleanDisplayTitle,
  messagePreviewSnippet,
}: OverviewViewProps) {
  // Build unified feed
  const feedItems = React.useMemo(() => {
    type FeedItem = {
      id: string;
      ts: number;
      kind: "message" | "task" | "session";
      data: ScoutRelayMessage | ScoutDesktopTask | ScoutSessionMetadata;
    };
    const items: FeedItem[] = [];

    for (const message of activityMessages) {
      items.push({
        id: `msg-${message.id}`,
        ts: message.createdAt,
        kind: "message",
        data: message,
      });
    }
    for (const task of activityTasks) {
      items.push({
        id: `task-${task.id}`,
        ts: task.createdAt,
        kind: "task",
        data: task,
      });
    }
    for (const session of overviewSessions) {
      items.push({
        id: `session-${session.id}`,
        ts: new Date(session.lastModified).getTime(),
        kind: "session",
        data: session,
      });
    }

    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, 30);
  }, [activityMessages, activityTasks, overviewSessions]);

  // Filter state for activity stream
  const [feedFilter, setFeedFilter] = React.useState<
    "all" | "message" | "task" | "session"
  >("all");

  const filteredFeedItems = React.useMemo(
    () =>
      feedFilter === "all"
        ? feedItems
        : feedItems.filter((item) => item.kind === feedFilter),
    [feedItems, feedFilter],
  );

  // Stat cards data
  const statCards = React.useMemo(() => {
    const cards: {
      icon: React.ReactNode;
      label: string;
      value: string;
      sub?: string;
      color: string;
    }[] = [
      {
        icon: <Users size={14} />,
        label: "ACTIVE AGENTS",
        value: String(reachableAgents.length),
        sub: features.machines ? `/ ${machinesOnlineCount}` : undefined,
        color: C.accent,
      },
      {
        icon: <CheckCircle2 size={14} />,
        label: "TASKS DONE",
        value: String(
          stats.totalSessions > 0 ? stats.totalSessions : runningTaskCount,
        ),
        sub: runningTaskCount > 0 ? `${runningTaskCount} running` : undefined,
        color: "#22c55e",
      },
      {
        icon: <Cpu size={14} />,
        label: "COMPUTE",
        value:
          stats.totalTokens >= 1_000_000
            ? `${(stats.totalTokens / 1_000_000).toFixed(1)}`
            : `${Math.round(stats.totalTokens / 1000)}`,
        sub:
          stats.totalTokens >= 1_000_000 ? "M tokens" : "k tokens",
        color: "#f59e0b",
      },
      {
        icon: <Clock size={14} />,
        label: "MESSAGES",
        value: String(
          runtime?.messageCount ?? stats.totalMessages,
        ),
        sub:
          stats.totalMessages > 0
            ? `${stats.totalSessions} sessions`
            : undefined,
        color: "#ef4444",
      },
    ];
    return cards;
  }, [
    reachableAgents.length,
    machinesOnlineCount,
    runningTaskCount,
    stats,
    runtime,
    features.machines,
    C.accent,
  ]);

  // Quick action shortcuts
  const quickActions = React.useMemo(() => {
    const actions: {
      icon: React.ReactNode;
      label: string;
      primary: boolean;
      onClick: () => void;
    }[] = [];

    actions.push({
      icon: <Bot size={14} />,
      label: "New Agent",
      primary: true,
      onClick: onCreateAgent,
    });
    if (features.plans) {
      actions.push({
        icon: <FileText size={14} />,
        label: "Review Plans",
        primary: false,
        onClick: () => onNavigate("plans"),
      });
    }
    if (features.relay) {
      actions.push({
        icon: <MessageSquare size={14} />,
        label: "Open Relay",
        primary: false,
        onClick: () => onNavigate("relay"),
      });
    }
    if (features.machines) {
      actions.push({
        icon: <Network size={14} />,
        label: "View Machines",
        primary: false,
        onClick: () => onNavigate("machines"),
      });
    }
    if (features.search) {
      actions.push({
        icon: <Search size={14} />,
        label: "Search",
        primary: false,
        onClick: () => onNavigate("search"),
      });
    }

    return actions;
  }, [features, onCreateAgent, onNavigate]);

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          {/* --- HEADING --- */}
          <div className="flex items-center justify-between mb-6">
            <h1
              className="text-[22px] font-semibold tracking-tight"
              style={s.inkText}
            >
              Overview
            </h1>
            <button
              onClick={onRefresh}
              className="os-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors"
              style={{ color: C.muted }}
              title="Sync Runtime"
            >
              <RefreshCw size={13} />
            </button>
          </div>

          {/* --- 1. STAT CARDS --- */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="border rounded-xl px-5 py-4"
                style={{ borderColor: C.border, backgroundColor: C.surface }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ color: card.color }}>{card.icon}</span>
                  <span
                    className="text-[10px] font-semibold tracking-wider uppercase"
                    style={{ color: card.color }}
                  >
                    {card.label}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-[28px] font-bold tabular-nums leading-none"
                    style={s.inkText}
                  >
                    {card.value}
                  </span>
                  {card.sub ? (
                    <span className="text-[13px]" style={s.mutedText}>
                      {card.sub}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* --- 2. QUICK ACTIONS --- */}
          {quickActions.length > 0 ? (
            <div className="mb-8">
              <div
                className="text-[10px] font-semibold tracking-wider uppercase mb-3"
                style={s.mutedText}
              >
                QUICK ACTIONS
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.onClick}
                    className="os-btn flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-colors border"
                    style={
                      action.primary
                        ? {
                            backgroundColor: C.accent,
                            color: "#fff",
                            borderColor: C.accent,
                          }
                        : {
                            backgroundColor: "transparent",
                            color: C.ink,
                            borderColor: C.border,
                          }
                    }
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ))}

                {/* Online agents inline */}
                {reachableAgents.length > 0 ? (
                  <>
                    <div
                      className="w-px h-7 mx-1"
                      style={{ backgroundColor: C.border }}
                    />
                    <div className="flex items-center gap-1.5">
                      {reachableAgents.slice(0, 6).map((thread) => (
                        <button
                          key={thread.id}
                          onClick={() => onSelectRelay("direct", thread.id)}
                          className="relative group"
                          title={cleanDisplayTitle(thread.title)}
                        >
                          <div
                            className="w-8 h-8 rounded-full text-white flex items-center justify-center text-[11px] font-bold transition-transform group-hover:scale-110"
                            style={{
                              backgroundColor: colorForIdentity(thread.id),
                            }}
                          >
                            {thread.title.charAt(0)}
                          </div>
                          <div
                            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-[1.5px]"
                            style={{ borderColor: C.bg }}
                          />
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* --- 3. ACTIVITY STREAM --- */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2
                className="text-[16px] font-semibold"
                style={s.inkText}
              >
                Activity Stream
              </h2>
              <button
                className="os-btn flex items-center gap-2 px-3 py-1.5 border rounded-lg text-[12px] transition-colors"
                style={{
                  borderColor: C.border,
                  color: C.muted,
                  backgroundColor: "transparent",
                }}
                onClick={() => {
                  const order: Array<"all" | "message" | "task" | "session"> = [
                    "all",
                    "message",
                    "task",
                    "session",
                  ];
                  const idx = order.indexOf(feedFilter);
                  setFeedFilter(order[(idx + 1) % order.length]!);
                }}
              >
                <Filter size={12} />
                {feedFilter === "all"
                  ? "All Events"
                  : feedFilter === "message"
                    ? "Messages"
                    : feedFilter === "task"
                      ? "Tasks"
                      : "Sessions"}
                <ChevronRight
                  size={10}
                  className="rotate-90"
                  style={s.mutedText}
                />
              </button>
            </div>

            {filteredFeedItems.length === 0 ? (
              <div
                className="py-16 text-center border rounded-xl"
                style={{ borderColor: C.border }}
              >
                <div className="text-[13px]" style={s.mutedText}>
                  Waiting for activity...
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredFeedItems.map((item) => {
                  if (item.kind === "message") {
                    const message = item.data as ScoutRelayMessage;
                    const agent = agentLookup.get(message.authorId) ?? null;
                    return (
                      <div
                        key={item.id}
                        className="os-row flex items-start gap-4 px-5 py-4 rounded-xl border cursor-pointer transition-colors"
                        style={{
                          borderColor: C.border,
                          backgroundColor: C.surface,
                        }}
                        onClick={() => {
                          if (agent) onOpenAgent(agent.id);
                        }}
                      >
                        <div
                          className="w-9 h-9 rounded-full text-white flex items-center justify-center text-[12px] font-bold shrink-0 mt-0.5"
                          style={{ backgroundColor: message.avatarColor }}
                        >
                          {message.avatarLabel}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="text-[13px] font-semibold"
                              style={s.inkText}
                            >
                              {message.authorName}
                            </span>
                            {message.messageClass ? (
                              <span
                                className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                                style={
                                  message.messageClass === "status"
                                    ? s.activePill
                                    : s.tagBadge
                                }
                              >
                                {message.messageClass}
                              </span>
                            ) : null}
                            <span className="flex-1" />
                            <span
                              className="text-[11px] flex items-center gap-1"
                              style={s.mutedText}
                            >
                              <Clock size={10} />
                              {message.timestampLabel}
                            </span>
                          </div>
                          <div
                            className="text-[13px] leading-[1.6]"
                            style={s.mutedText}
                          >
                            {messagePreviewSnippet(message.body, 280)}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === "task") {
                    const task = item.data as ScoutDesktopTask;
                    const statusColor =
                      task.status === "running"
                        ? {
                            bg: "rgba(99, 102, 241, 0.10)",
                            fg: C.accent,
                          }
                        : task.status === "failed"
                          ? {
                              bg: "rgba(248, 113, 113, 0.10)",
                              fg: "#b91c1c",
                            }
                          : task.status === "completed"
                            ? {
                                bg: "rgba(34, 197, 94, 0.10)",
                                fg: "#166534",
                              }
                            : { bg: C.tagBg, fg: C.muted };

                    return (
                      <div
                        key={item.id}
                        className="os-row flex items-start gap-4 px-5 py-4 rounded-xl border cursor-pointer transition-colors"
                        style={{
                          borderColor: C.border,
                          backgroundColor: C.surface,
                        }}
                        onClick={() => onOpenAgent(task.targetAgentId)}
                      >
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                          style={{
                            backgroundColor: statusColor.bg,
                            color: statusColor.fg,
                          }}
                        >
                          <Zap size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full"
                              style={s.tagBadge}
                            >
                              {task.targetAgentName}
                            </span>
                            <span
                              className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: statusColor.bg,
                                color: statusColor.fg,
                              }}
                            >
                              {task.statusLabel}
                            </span>
                            <span className="flex-1" />
                            <span
                              className="text-[11px] flex items-center gap-1"
                              style={s.mutedText}
                            >
                              <Clock size={10} />
                              {task.ageLabel ??
                                task.updatedAtLabel ??
                                task.createdAtLabel ??
                                ""}
                            </span>
                          </div>
                          <div
                            className="text-[13px] font-medium leading-[1.5]"
                            style={s.inkText}
                          >
                            {task.title}
                          </div>
                          {task.replyPreview ? (
                            <div
                              className="text-[12px] mt-1.5 leading-[1.5]"
                              style={s.mutedText}
                            >
                              {task.replyPreview}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === "session") {
                    const session = item.data as ScoutSessionMetadata;
                    return (
                      <div
                        key={item.id}
                        className="os-row flex items-start gap-4 px-5 py-4 rounded-xl border cursor-pointer transition-colors"
                        style={{
                          borderColor: C.border,
                          backgroundColor: C.surface,
                        }}
                        onClick={() => onOpenSession(session)}
                      >
                        <div
                          className="w-9 h-9 rounded-full text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                          style={{
                            backgroundColor: colorForIdentity(session.agent),
                          }}
                        >
                          {session.agent.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="text-[13px] font-semibold"
                              style={s.inkText}
                            >
                              {session.title}
                            </span>
                            <span
                              className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                              style={s.tagBadge}
                            >
                              {session.project}
                            </span>
                            <span className="flex-1" />
                            <span
                              className="text-[11px] flex items-center gap-1"
                              style={s.mutedText}
                            >
                              <Clock size={10} />
                              {formatDate(session.lastModified)}
                            </span>
                          </div>
                          <div
                            className="text-[12px]"
                            style={s.mutedText}
                          >
                            {session.messageCount} messages
                          </div>
                        </div>
                        <ChevronRight
                          size={14}
                          className="shrink-0 mt-2"
                          style={s.mutedText}
                        />
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            )}

            {/* Projects strip */}
            {overviewProjects.length > 0 ? (
              <div
                className="mt-8 pt-6 border-t"
                style={{ borderColor: C.border }}
              >
                <div
                  className="text-[10px] font-semibold tracking-wider uppercase mb-3"
                  style={s.mutedText}
                >
                  PROJECTS
                </div>
                <div className="flex flex-wrap gap-2">
                  {overviewProjects.map((project) => (
                    <button
                      key={project.name}
                      onClick={() => onOpenProject(project.name)}
                      className="os-btn flex items-center gap-2 px-3.5 py-2 border rounded-xl text-[12px] font-medium transition-colors"
                      style={{
                        ...s.surface,
                        borderColor: C.border,
                        color: C.ink,
                      }}
                    >
                      <Folder size={12} style={s.mutedText} />
                      {project.name}
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                        style={s.tagBadge}
                      >
                        {project.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {shellError ? (
              <div
                className="mt-6 pt-6 border-t"
                style={{ borderColor: C.border }}
              >
                <div
                  className="flex items-center gap-2 px-4 py-3 text-[12px] border rounded-xl"
                  style={{
                    ...s.surface,
                    borderColor: C.border,
                    color: C.muted,
                  }}
                >
                  <X size={12} />
                  <span>{shellError}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
