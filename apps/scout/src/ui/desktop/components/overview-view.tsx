"use client";

import React from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  FileText,
  Filter,
  Folder,
  MessageSquare,
  Network,
  Radar,
  RefreshCw,
  Search,
  Square,
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

  // Expanded item + selected index for keyboard nav
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState<number>(0);

  // Clamp selectedIndex when filter/items change
  React.useEffect(() => {
    if (selectedIndex >= filteredFeedItems.length) {
      setSelectedIndex(Math.max(0, filteredFeedItems.length - 1));
    }
  }, [filteredFeedItems.length, selectedIndex]);

  // Keyboard navigation: j/k to move, e to expand, Escape to collapse
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, Math.max(0, filteredFeedItems.length - 1)),
        );
      } else if (event.key === "k") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (event.key === "e") {
        event.preventDefault();
        const item = filteredFeedItems[selectedIndex];
        if (item) {
          setExpandedId((prev) => (prev === item.id ? null : item.id));
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = filteredFeedItems[selectedIndex];
        if (item) {
          setExpandedId((prev) => (prev === item.id ? null : item.id));
        }
      } else if (event.key === "Escape") {
        if (expandedId !== null) {
          event.preventDefault();
          setExpandedId(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredFeedItems, selectedIndex, expandedId]);

  const cycleFilter = React.useCallback(() => {
    const order: Array<"all" | "message" | "task" | "session"> = [
      "all",
      "message",
      "task",
      "session",
    ];
    const idx = order.indexOf(feedFilter);
    setFeedFilter(order[(idx + 1) % order.length]!);
  }, [feedFilter]);

  const filterLabel =
    feedFilter === "all"
      ? "All Events"
      : feedFilter === "message"
        ? "Messages"
        : feedFilter === "task"
          ? "Tasks"
          : "Sessions";

  const handleCopy = React.useCallback(
    (event: React.MouseEvent, text: string) => {
      event.stopPropagation();
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(text).catch(() => {});
      }
    },
    [],
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

          {/* --- 1. STAT CARDS (compact inline row) --- */}
          <div className="mb-6 flex flex-wrap items-center gap-6">
            {statCards.map((card) => (
              <div key={card.label} className="flex items-center gap-2">
                <span style={{ color: card.color }}>{card.icon}</span>
                <span className="text-xs" style={s.mutedText}>
                  {card.label}
                </span>
                <span
                  className="text-sm font-medium tabular-nums"
                  style={s.inkText}
                >
                  {card.value}
                </span>
                {card.sub ? (
                  <span className="text-xs" style={s.mutedText}>
                    {card.sub}
                  </span>
                ) : null}
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
              <div className="flex items-center gap-4">
                <h2
                  className="text-[16px] font-semibold"
                  style={s.inkText}
                >
                  Activity Stream
                </h2>
                <div
                  className="hidden items-center gap-2 text-[10px] sm:flex"
                  style={s.mutedText}
                >
                  <span
                    className="font-mono px-1.5 py-0.5 rounded"
                    style={s.tagBadge}
                  >
                    j k
                  </span>
                  <span>navigate</span>
                  <span
                    className="font-mono px-1.5 py-0.5 rounded"
                    style={s.tagBadge}
                  >
                    e
                  </span>
                  <span>expand</span>
                </div>
              </div>
              <button
                className="os-btn flex items-center gap-2 px-3 py-1.5 border rounded-lg text-[12px] transition-colors"
                style={{
                  borderColor: C.border,
                  color: C.muted,
                  backgroundColor: "transparent",
                }}
                onClick={cycleFilter}
              >
                <Filter size={12} />
                {filterLabel}
                <ChevronDown size={10} />
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
              <div
                className="divide-y rounded-xl border overflow-hidden"
                style={{ borderColor: C.border }}
              >
                {filteredFeedItems.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  const isExpanded = expandedId === item.id;
                  const rowBackground = isSelected ? C.surface : "transparent";

                  if (item.kind === "message") {
                    const message = item.data as ScoutRelayMessage;
                    const agent = agentLookup.get(message.authorId) ?? null;
                    const isRunning = false;
                    return (
                      <div
                        key={item.id}
                        className="group relative flex items-start gap-4 px-4 py-3 cursor-pointer transition-colors"
                        style={{ backgroundColor: rowBackground }}
                        onClick={() => {
                          setSelectedIndex(index);
                          setExpandedId((prev) =>
                            prev === item.id ? null : item.id,
                          );
                          if (agent) onOpenAgent(agent.id);
                        }}
                      >
                        {isRunning ? (
                          <div
                            className="absolute left-0 top-0 bottom-0 w-0.5"
                            style={{ backgroundColor: C.accent }}
                          />
                        ) : null}
                        <div className="relative shrink-0 mt-0.5">
                          <div
                            className="w-9 h-9 rounded-full text-white flex items-center justify-center text-[12px] font-bold"
                            style={{ backgroundColor: message.avatarColor }}
                          >
                            {message.avatarLabel}
                          </div>
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
                            className={`text-[13px] leading-[1.6] ${isExpanded ? "" : "line-clamp-2"}`}
                            style={s.mutedText}
                          >
                            {isExpanded
                              ? message.body
                              : messagePreviewSnippet(message.body, 280)}
                          </div>
                        </div>
                        <div
                          className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            backgroundColor: C.bg,
                            borderColor: C.border,
                          }}
                        >
                          <button
                            onClick={(event) => handleCopy(event, message.body)}
                            className="p-1 rounded hover:opacity-70"
                            style={{ color: C.muted }}
                            title="Copy"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === "task") {
                    const task = item.data as ScoutDesktopTask;
                    const isRunning = task.status === "running";
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

                    const taskBody = [task.title, task.replyPreview ?? ""]
                      .filter(Boolean)
                      .join("\n");

                    return (
                      <div
                        key={item.id}
                        className="group relative flex items-start gap-4 px-4 py-3 cursor-pointer transition-colors"
                        style={{ backgroundColor: rowBackground }}
                        onClick={() => {
                          setSelectedIndex(index);
                          setExpandedId((prev) =>
                            prev === item.id ? null : item.id,
                          );
                          onOpenAgent(task.targetAgentId);
                        }}
                      >
                        {isRunning ? (
                          <div
                            className="absolute left-0 top-0 bottom-0 w-0.5"
                            style={{ backgroundColor: C.accent }}
                          />
                        ) : null}
                        <div className="relative shrink-0 mt-0.5">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center"
                            style={{
                              backgroundColor: statusColor.bg,
                              color: statusColor.fg,
                            }}
                          >
                            <Zap size={14} />
                          </div>
                          {isRunning ? (
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                              <span
                                className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                                style={{ backgroundColor: C.accent }}
                              />
                              <span
                                className="relative inline-flex h-3 w-3 rounded-full border-2"
                                style={{
                                  backgroundColor: C.accent,
                                  borderColor: C.bg,
                                }}
                              />
                            </span>
                          ) : null}
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
                            className={`text-[13px] font-medium leading-[1.5] ${isExpanded ? "" : "line-clamp-2"}`}
                            style={s.inkText}
                          >
                            {task.title}
                          </div>
                          {task.replyPreview ? (
                            <div
                              className={`text-[12px] mt-1.5 leading-[1.5] ${isExpanded ? "" : "line-clamp-2"}`}
                              style={s.mutedText}
                            >
                              {task.replyPreview}
                            </div>
                          ) : null}
                        </div>
                        <div
                          className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            backgroundColor: C.bg,
                            borderColor: C.border,
                          }}
                        >
                          <button
                            onClick={(event) => handleCopy(event, taskBody)}
                            className="p-1 rounded hover:opacity-70"
                            style={{ color: C.muted }}
                            title="Copy"
                          >
                            <Copy size={12} />
                          </button>
                          {isRunning ? (
                            <button
                              onClick={(event) => event.stopPropagation()}
                              className="p-1 rounded hover:opacity-70"
                              title="Stop"
                              style={{ color: "#ef4444" }}
                            >
                              <Square size={12} className="fill-current" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === "session") {
                    const session = item.data as ScoutSessionMetadata;
                    const sessionBody = `${session.title} (${session.project})`;
                    return (
                      <div
                        key={item.id}
                        className="group relative flex items-start gap-4 px-4 py-3 cursor-pointer transition-colors"
                        style={{ backgroundColor: rowBackground }}
                        onClick={() => {
                          setSelectedIndex(index);
                          setExpandedId((prev) =>
                            prev === item.id ? null : item.id,
                          );
                          onOpenSession(session);
                        }}
                      >
                        <div className="relative shrink-0 mt-0.5">
                          <div
                            className="w-9 h-9 rounded-full text-white flex items-center justify-center text-[11px] font-bold"
                            style={{
                              backgroundColor: colorForIdentity(session.agent),
                            }}
                          >
                            {session.agent.charAt(0)}
                          </div>
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
                            className={`text-[12px] ${isExpanded ? "" : "line-clamp-2"}`}
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
                        <div
                          className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            backgroundColor: C.bg,
                            borderColor: C.border,
                          }}
                        >
                          <button
                            onClick={(event) => handleCopy(event, sessionBody)}
                            className="p-1 rounded hover:opacity-70"
                            style={{ color: C.muted }}
                            title="Copy"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
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
