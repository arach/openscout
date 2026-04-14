import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, FileText, MessageSquare, RefreshCw, X } from 'lucide-react';

import { OverviewView } from '@/components/overview-view';
import { messagePreviewSnippet } from '@web/features/messages/lib/relay-utils';
import { C } from '@/lib/theme';
import type { AppView, InboxItem } from '@/app-types';
import type {
  DesktopShellState,
  InterAgentAgent,
  RelayMessage,
  SessionMetadata,
} from '@/lib/scout-desktop';

type PlansState = NonNullable<DesktopShellState['plans']>;
type MachinesState = NonNullable<DesktopShellState['machines']>;
type RuntimeState = NonNullable<DesktopShellState['runtime']>;
type ActivityTask = PlansState['tasks'][number];
type ActivityFinding = PlansState['findings'][number];
type ActivityEndpointEntry = {
  machineId: MachinesState['machines'][number]['id'];
  machineTitle: MachinesState['machines'][number]['title'];
  machineStatus: MachinesState['machines'][number]['status'];
  endpoint: MachinesState['machines'][number]['endpoints'][number];
};

interface ViewStyles {
  sidebar: React.CSSProperties;
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  activePill: React.CSSProperties;
}

interface InboxViewModel {
  isCollapsed: boolean;
  sidebarWidth: number;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  styles: ViewStyles;
  inboxAlertCount: number;
  pendingApprovalsCount: number;
  inboxFailedTaskCount: number;
  inboxAwaitingYouItems: InboxItem[];
}

interface ActivityViewModel {
  isCollapsed: boolean;
  sidebarWidth: number;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  styles: ViewStyles;
  plansState: DesktopShellState['plans'] | null;
  machinesState: DesktopShellState['machines'] | null;
  runtime: DesktopShellState['runtime'] | null;
  activityLeadTask: ActivityTask | null;
  activityTasks: ActivityTask[];
  activityFindings: ActivityFinding[];
  activityEndpoints: ActivityEndpointEntry[];
  activityRecentMessages: RelayMessage[];
  interAgentAgentLookup: Map<string, InterAgentAgent>;
  overviewSessions: SessionMetadata[];
  formatDate: (value: string) => string;
  onRefresh: () => void;
  onOpenPlans: () => void;
  onOpenMessages: () => void;
  onOpenAgentProfile: (agentId: string) => void;
  onOpenSessionDetail: (session: SessionMetadata) => void;
}

export interface OverviewInboxActivityViewProps {
  activeView: AppView;
  overviewViewProps: React.ComponentProps<typeof OverviewView>;
  inbox: InboxViewModel;
  activity: ActivityViewModel;
}

export function OverviewInboxActivityView({
  activeView,
  overviewViewProps,
  inbox,
  activity,
}: OverviewInboxActivityViewProps) {
  if (activeView === 'overview') {
    return <OverviewView {...overviewViewProps} />;
  }

  if (activeView === 'inbox') {
    return (
      <>
        <div className="flex-1 flex flex-col min-w-0" style={inbox.styles.surface}>
          <div className="border-b shrink-0 px-6 py-5" style={{ borderBottomColor: C.border }}>
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={inbox.styles.mutedText}>Inbox</div>
                <h1 className="text-[28px] font-semibold tracking-tight" style={inbox.styles.inkText}>
                  Things You Asked Scout To Tell You About
                </h1>
                <p className="text-[13px] mt-2 max-w-3xl leading-[1.65]" style={inbox.styles.mutedText}>
                  Notifications are opt-in. This surface is reserved for approvals, failed asks, and other subscribed updates that are actually worth surfacing.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 mt-5">
              {[
                { label: 'Needs You', value: `${inbox.inboxAlertCount}`, detail: `${inbox.pendingApprovalsCount} approvals · ${inbox.inboxFailedTaskCount} failed asks` },
                { label: 'Approvals', value: `${inbox.pendingApprovalsCount}`, detail: 'Inline pairing actions' },
                { label: 'Failures', value: `${inbox.inboxFailedTaskCount}`, detail: 'Failed asks from plans' },
                { label: 'Policy', value: 'Opt-in', detail: 'Progress and watchlists stay elsewhere' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border px-4 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <div className="text-[9px] font-mono uppercase tracking-widest" style={inbox.styles.mutedText}>{item.label}</div>
                  <div className="text-[24px] font-semibold mt-2" style={inbox.styles.inkText}>{item.value}</div>
                  <div className="text-[11px] mt-1" style={inbox.styles.mutedText}>{item.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
              <section className="border rounded-xl overflow-hidden min-w-0" style={{ ...inbox.styles.surface, borderColor: C.border }}>
                <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase" style={inbox.styles.mutedText}>Needs You</div>
                    <div className="text-[11px] mt-1" style={inbox.styles.mutedText}>Approvals and failed asks that are worth interrupting for.</div>
                  </div>
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={inbox.inboxAlertCount > 0 ? inbox.styles.activePill : inbox.styles.tagBadge}>
                    {inbox.inboxAlertCount} items
                  </span>
                </div>
                <div className="divide-y" style={{ borderColor: C.border }}>
                  {inbox.inboxAwaitingYouItems.length > 0 ? inbox.inboxAwaitingYouItems.map((item) => (
                    <div key={item.id} className="px-4 py-4" style={{ backgroundColor: C.surface }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded"
                              style={
                                item.tone === 'critical'
                                  ? { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' }
                                  : item.tone === 'warning'
                                    ? { backgroundColor: 'rgba(251, 191, 36, 0.16)', color: '#92400e' }
                                    : inbox.styles.activePill
                              }
                            >
                              {item.kind}
                            </span>
                            <span className="text-[9px] font-mono" style={inbox.styles.mutedText}>{item.meta}</span>
                          </div>
                          <div className="text-[13px] font-medium mt-2 leading-[1.5]" style={inbox.styles.inkText}>
                            {item.title}
                          </div>
                          <div className="text-[11px] mt-1 leading-[1.6]" style={inbox.styles.mutedText}>
                            {item.summary}
                          </div>
                          {item.detail && item.detail !== item.summary ? (
                            <div className="mt-2 rounded-lg border px-3 py-2 text-[11px] leading-[1.6]" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.muted }}>
                              {item.detail}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={item.onAction}
                            className="text-[10px] font-medium hover:opacity-80"
                            style={{ color: C.accent }}
                          >
                            {item.actionLabel}
                          </button>
                          {item.onSecondaryAction && item.secondaryActionLabel ? (
                            <button
                              type="button"
                              onClick={item.onSecondaryAction}
                              className="text-[10px] font-medium hover:opacity-80"
                              style={inbox.styles.mutedText}
                            >
                              {item.secondaryActionLabel}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="px-4 py-10 text-[12px] text-center" style={inbox.styles.mutedText}>
                      Nothing urgent right now.
                    </div>
                  )}
                </div>
              </section>

              <div className="space-y-4 min-w-0">
                <section className="border rounded-xl overflow-hidden" style={{ ...inbox.styles.surface, borderColor: C.border }}>
                  <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                    <div className="text-[10px] font-mono tracking-widest uppercase" style={inbox.styles.mutedText}>Notes</div>
                    <div className="text-[11px] mt-1" style={inbox.styles.mutedText}>This is UI-only for now, backed by existing desktop state instead of durable broker attention events.</div>
                  </div>
                  <div className="px-4 py-4 text-[11px] leading-[1.7]" style={inbox.styles.mutedText}>
                    Inbox is currently limited to approvals and failed asks. Agent progress, stale/problem states, and cleanup flows stay in other parts of Scout.
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (activeView !== 'activity') {
    return null;
  }

  return <ActivityStreamView activity={activity} />;
}

/* ------------------------------------------------------------------ */
/*  Unified activity stream with sliding detail panel                 */
/* ------------------------------------------------------------------ */

type StreamItemKind = 'task' | 'message' | 'finding' | 'endpoint' | 'session';

type StreamItem = {
  id: string;
  kind: StreamItemKind;
  sortKey: number;
  /** actor display name */
  actor: string;
  /** first letter(s) for avatar */
  avatarLabel: string;
  /** CSS color for avatar bg */
  avatarColor: string;
  /** event-type label shown next to actor, e.g. "replied", "ask opened" */
  eventLabel: string;
  /** human timestamp */
  timestamp: string;
  /** message / body text shown in the turn bubble */
  body: string;
  /** optional channel / thread context */
  channel: string | null;
  /** raw data for the detail panel */
  data: unknown;
};

/** max chars shown inline before "Show more" */
const BODY_CAP = 280;

/** deterministic avatar colour from a string id */
const AVATAR_PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];
function avatarColorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function buildStream(activity: ActivityViewModel): StreamItem[] {
  const items: StreamItem[] = [];

  for (const task of activity.activityTasks) {
    items.push({
      id: `task-${task.id}`,
      kind: 'task',
      sortKey: task.createdAt,
      actor: task.targetAgentName,
      avatarLabel: task.targetAgentName.charAt(0).toUpperCase(),
      avatarColor: avatarColorFromId(task.targetAgentId),
      eventLabel: task.statusLabel,
      timestamp: task.ageLabel ?? task.updatedAtLabel ?? task.createdAtLabel,
      body: task.title + (task.statusDetail ? `\n${task.statusDetail}` : '') + (task.replyPreview ? `\n${task.replyPreview}` : ''),
      channel: task.project,
      data: task,
    });
  }

  for (const message of activity.activityRecentMessages) {
    items.push({
      id: `msg-${message.id}`,
      kind: 'message',
      sortKey: message.createdAt,
      actor: message.authorName,
      avatarLabel: message.avatarLabel,
      avatarColor: message.avatarColor,
      eventLabel: message.messageClass ?? 'message',
      timestamp: message.timestampLabel,
      body: message.body,
      channel: message.normalizedChannel,
      data: message,
    });
  }

  for (const finding of activity.activityFindings) {
    items.push({
      id: `finding-${finding.id}`,
      kind: 'finding',
      sortKey: Date.now(),
      actor: finding.targetAgentName ?? 'System',
      avatarLabel: (finding.targetAgentName ?? 'S').charAt(0).toUpperCase(),
      avatarColor: finding.severity === 'error' ? '#ef4444' : '#f59e0b',
      eventLabel: finding.severity,
      timestamp: finding.ageLabel ?? finding.updatedAtLabel ?? '',
      body: `${finding.title}\n${finding.summary}`,
      channel: null,
      data: finding,
    });
  }

  for (const entry of activity.activityEndpoints) {
    items.push({
      id: `ep-${entry.endpoint.id}`,
      kind: 'endpoint',
      sortKey: Date.now() - 1,
      actor: entry.endpoint.agentName,
      avatarLabel: entry.endpoint.agentName.charAt(0).toUpperCase(),
      avatarColor: avatarColorFromId(entry.endpoint.agentId),
      eventLabel: entry.endpoint.stateLabel,
      timestamp: entry.endpoint.lastActiveLabel ?? '',
      body: entry.endpoint.activeTask ?? `${entry.endpoint.stateLabel} on ${entry.machineTitle}`,
      channel: entry.endpoint.project,
      data: entry,
    });
  }

  for (const session of activity.overviewSessions) {
    items.push({
      id: `session-${session.id}`,
      kind: 'session',
      sortKey: new Date(session.lastModified).getTime() || 0,
      actor: session.agent,
      avatarLabel: session.agent.charAt(0).toUpperCase(),
      avatarColor: avatarColorFromId(session.agent),
      eventLabel: 'session',
      timestamp: session.lastModified,
      body: session.title + (session.preview ? `\n${session.preview}` : ''),
      channel: session.project,
      data: session,
    });
  }

  items.sort((a, b) => b.sortKey - a.sortKey);
  return items;
}

const kindLabel: Record<StreamItemKind, string> = {
  task: 'Task',
  message: 'Message',
  finding: 'Finding',
  endpoint: 'Endpoint',
  session: 'Session',
};

function ActivityStreamView({ activity }: { activity: ActivityViewModel }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedBodies, setExpandedBodies] = useState<Set<string>>(() => new Set());

  const stream = useMemo(() => buildStream(activity), [
    activity.activityTasks,
    activity.activityRecentMessages,
    activity.activityFindings,
    activity.activityEndpoints,
    activity.overviewSessions,
  ]);

  const channels = useMemo(() => {
    const set = new Set<string>();
    for (const item of stream) {
      if (item.channel) set.add(item.channel);
    }
    return Array.from(set).sort();
  }, [stream]);

  const [activeChannel, setActiveChannel] = useState<string | null>(null);

  const filteredStream = activeChannel
    ? stream.filter((item) => item.channel === activeChannel)
    : stream;

  const selected = selectedId ? stream.find((item) => item.id === selectedId) ?? null : null;

  return (
    <div className="flex-1 flex flex-col min-w-0" style={activity.styles.surface}>
      {/* Header */}
      <div className="border-b shrink-0 px-6 py-3" style={{ borderBottomColor: C.border }}>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className="text-[18px] font-semibold tracking-tight" style={activity.styles.inkText}>
              Activity
            </h1>
            <div className="flex items-center gap-3">
              {[
                { label: 'Running', value: activity.plansState?.runningTaskCount ?? 0 },
                { label: 'Watchlist', value: activity.plansState?.findingCount ?? 0 },
                { label: 'Agents', value: activity.runtime?.agentCount ?? 0 },
              ].map((item) => (
                <span key={item.label} className="text-[11px] font-mono" style={activity.styles.mutedText}>
                  {item.label} <span style={activity.styles.inkText}>{item.value}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={activity.onRefresh}
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ color: C.ink }}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              type="button"
              onClick={activity.onOpenPlans}
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ color: C.ink }}
            >
              <FileText size={14} />
              Plans
            </button>
            <button
              type="button"
              onClick={activity.onOpenMessages}
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ color: C.ink }}
            >
              <MessageSquare size={14} />
              Messages
            </button>
          </div>
        </div>

        {/* Channel filter pills */}
        {channels.length > 0 && (
          <div className="flex items-center gap-1.5 mt-3 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveChannel(null)}
              className="text-[10px] font-medium px-2.5 py-1 rounded-full shrink-0 transition-colors"
              style={activeChannel === null
                ? { backgroundColor: C.accent, color: '#fff' }
                : { backgroundColor: C.bg, color: C.muted, border: `1px solid ${C.border}` }
              }
            >
              All
            </button>
            {channels.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setActiveChannel(activeChannel === ch ? null : ch)}
                className="text-[10px] font-medium px-2.5 py-1 rounded-full shrink-0 transition-colors"
                style={activeChannel === ch
                  ? { backgroundColor: C.accent, color: '#fff' }
                  : { backgroundColor: C.bg, color: C.muted, border: `1px solid ${C.border}` }
                }
              >
                {ch}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Stream + Detail */}
      <div className="flex-1 flex min-h-0">
        {/* Stream column — conversational layout */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {filteredStream.length > 0 ? (
            <div className="px-5 py-4 space-y-1">
              {filteredStream.map((item) => {
                const isSelected = item.id === selectedId;
                const isExpanded = expandedBodies.has(item.id);
                const isTruncated = item.body.length > BODY_CAP;
                const displayBody = isTruncated && !isExpanded ? item.body.slice(0, BODY_CAP) + '...' : item.body;

                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 rounded-xl px-3 py-3 transition-colors cursor-pointer"
                    style={{
                      backgroundColor: isSelected ? C.accentBg : 'transparent',
                    }}
                    onClick={() => setSelectedId(isSelected ? null : item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(isSelected ? null : item.id); }}}
                  >
                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-full text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                      style={{ backgroundColor: item.avatarColor }}
                    >
                      {item.avatarLabel}
                    </div>

                    {/* Turn content */}
                    <div className="flex-1 min-w-0">
                      {/* Actor line */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold" style={activity.styles.inkText}>{item.actor}</span>
                        <span
                          className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded"
                          style={
                            item.kind === 'task' ? taskStatusStyle(activity, (item.data as ActivityTask).status) :
                            item.kind === 'finding' ? findingSeverityStyle((item.data as ActivityFinding).severity) :
                            item.kind === 'endpoint' ? endpointStateStyle(activity, (item.data as ActivityEndpointEntry).endpoint.state) :
                            activity.styles.tagBadge
                          }
                        >
                          {item.eventLabel}
                        </span>
                        <span className="text-[10px] font-mono" style={activity.styles.mutedText}>{item.timestamp}</span>
                      </div>

                      {/* Body — conversational, multi-line */}
                      <div
                        className="text-[12px] leading-[1.7] mt-1.5 whitespace-pre-wrap"
                        style={activity.styles.inkText}
                      >
                        {displayBody}
                      </div>

                      {/* Show more / less */}
                      {isTruncated && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedBodies((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                              return next;
                            });
                          }}
                          className="text-[11px] font-medium mt-1 hover:opacity-80"
                          style={{ color: C.accent }}
                        >
                          {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}

                      {/* Channel tag (subtle, below body) */}
                      {item.channel && (
                        <div className="mt-1.5">
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={activity.styles.tagBadge}>
                            {item.channel}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Chevron hint */}
                    <div className="shrink-0 mt-1">
                      <ChevronRight size={14} style={{ color: C.muted, opacity: isSelected ? 1 : 0.3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-[12px] text-center" style={activity.styles.mutedText}>
                No activity yet.
              </div>
            </div>
          )}
        </div>

        {/* Detail panel — slides in from the right */}
        {selected && (
          <div
            className="border-l overflow-y-auto shrink-0"
            style={{
              width: 360,
              borderLeftColor: C.border,
              backgroundColor: C.bg,
            }}
          >
            <div className="px-5 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
              <span className="text-[10px] font-mono uppercase tracking-widest" style={activity.styles.mutedText}>
                {kindLabel[selected.kind]} Details
              </span>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="shrink-0 hover:opacity-80"
                style={{ color: C.muted }}
              >
                <X size={14} />
              </button>
            </div>

            <div className="px-5 py-4">
              {selected.kind === 'task' && <TaskDetail task={selected.data as ActivityTask} activity={activity} />}
              {selected.kind === 'message' && <MessageDetail message={selected.data as RelayMessage} activity={activity} />}
              {selected.kind === 'finding' && <FindingDetail finding={selected.data as ActivityFinding} activity={activity} />}
              {selected.kind === 'endpoint' && <EndpointDetail entry={selected.data as ActivityEndpointEntry} activity={activity} />}
              {selected.kind === 'session' && <SessionDetail session={selected.data as SessionMetadata} activity={activity} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Style helpers                                                      */
/* ------------------------------------------------------------------ */

function taskStatusStyle(activity: ActivityViewModel, status: string): React.CSSProperties {
  switch (status) {
    case 'running': return activity.styles.activePill;
    case 'failed': return { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' };
    case 'completed': return { backgroundColor: 'rgba(34, 197, 94, 0.12)', color: '#166534' };
    default: return activity.styles.tagBadge;
  }
}

function findingSeverityStyle(severity: string): React.CSSProperties {
  return severity === 'error'
    ? { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' }
    : { backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#b45309' };
}

function endpointStateStyle(activity: ActivityViewModel, state: string): React.CSSProperties {
  switch (state) {
    case 'running': return activity.styles.activePill;
    case 'waiting': return { backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#b45309' };
    default: return activity.styles.tagBadge;
  }
}

/* ------------------------------------------------------------------ */
/*  Detail panels                                                      */
/* ------------------------------------------------------------------ */

function DetailRow({ label, children, styles }: { label: string; children: React.ReactNode; styles: ViewStyles }) {
  return (
    <div className="mb-3">
      <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>{label}</div>
      <div className="text-[12px] leading-[1.6]" style={styles.inkText}>{children}</div>
    </div>
  );
}

function TaskDetail({ task, activity }: { task: ActivityTask; activity: ActivityViewModel }) {
  const { styles } = activity;
  return (
    <div>
      <DetailRow label="Status" styles={styles}>
        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded" style={taskStatusStyle(activity, task.status)}>
          {task.statusLabel}
        </span>
      </DetailRow>
      <DetailRow label="Agent" styles={styles}>{task.targetAgentName}</DetailRow>
      {task.project && <DetailRow label="Project" styles={styles}>{task.project}</DetailRow>}
      <DetailRow label="Created" styles={styles}>{task.createdAtLabel}</DetailRow>
      {task.updatedAtLabel && <DetailRow label="Updated" styles={styles}>{task.updatedAtLabel}</DetailRow>}
      {task.ageLabel && <DetailRow label="Age" styles={styles}>{task.ageLabel}</DetailRow>}

      {task.body && task.body !== task.title && (
        <div className="mt-4">
          <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Full Body</div>
          <div className="text-[11px] leading-[1.65] rounded-lg border px-3 py-2 whitespace-pre-wrap" style={{ borderColor: C.border, backgroundColor: C.surface, ...styles.mutedText }}>
            {task.body}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => activity.onOpenAgentProfile(task.targetAgentId)}
        className="mt-5 text-[11px] font-medium hover:opacity-80"
        style={{ color: C.accent }}
      >
        Open {task.targetAgentName}
      </button>
    </div>
  );
}

function MessageDetail({ message, activity }: { message: RelayMessage; activity: ActivityViewModel }) {
  const { styles } = activity;
  const agent = activity.interAgentAgentLookup.get(message.authorId) ?? null;
  const counterparts = message.recipients.filter((r) => r !== message.authorId);

  return (
    <div>
      {message.messageClass && (
        <DetailRow label="Event" styles={styles}>
          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded" style={message.messageClass === 'status' ? activity.styles.activePill : activity.styles.tagBadge}>
            {message.messageClass}
          </span>
        </DetailRow>
      )}
      <DetailRow label="Time" styles={styles}>{message.timestampLabel}</DetailRow>
      <DetailRow label="Author" styles={styles}>{message.authorName}</DetailRow>
      {counterparts.length > 0 && (
        <DetailRow label="Recipients" styles={styles}>{counterparts.join(', ')}</DetailRow>
      )}
      {message.normalizedChannel && <DetailRow label="Channel" styles={styles}>{message.normalizedChannel}</DetailRow>}
      <DetailRow label="Thread" styles={styles}>
        <span className="font-mono text-[10px]">{message.conversationId}</span>
      </DetailRow>

      {agent && (
        <button
          type="button"
          onClick={() => activity.onOpenAgentProfile(agent.id)}
          className="mt-4 text-[11px] font-medium hover:opacity-80"
          style={{ color: C.accent }}
        >
          Open {agent.title ?? message.authorName}
        </button>
      )}
    </div>
  );
}

function FindingDetail({ finding, activity }: { finding: ActivityFinding; activity: ActivityViewModel }) {
  const { styles } = activity;
  return (
    <div>
      <DetailRow label="Severity" styles={styles}>
        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded" style={findingSeverityStyle(finding.severity)}>
          {finding.severity}
        </span>
      </DetailRow>
      <DetailRow label="Kind" styles={styles}>{finding.kind}</DetailRow>
      {finding.targetAgentName && <DetailRow label="Agent" styles={styles}>{finding.targetAgentName}</DetailRow>}
      {finding.requesterName && <DetailRow label="Requester" styles={styles}>{finding.requesterName}</DetailRow>}
      {finding.ageLabel && <DetailRow label="Age" styles={styles}>{finding.ageLabel}</DetailRow>}

      {finding.detail && (
        <div className="mt-4">
          <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={styles.mutedText}>Detail</div>
          <div className="text-[11px] leading-[1.65] rounded-lg border px-3 py-2 whitespace-pre-wrap" style={{ borderColor: C.border, backgroundColor: C.surface, ...styles.mutedText }}>
            {finding.detail}
          </div>
        </div>
      )}

      {finding.targetAgentId && (
        <button
          type="button"
          onClick={() => activity.onOpenAgentProfile(finding.targetAgentId!)}
          className="mt-5 text-[11px] font-medium hover:opacity-80"
          style={{ color: C.accent }}
        >
          Open {finding.targetAgentName}
        </button>
      )}
    </div>
  );
}

function EndpointDetail({ entry, activity }: { entry: ActivityEndpointEntry; activity: ActivityViewModel }) {
  const { styles } = activity;
  const ep = entry.endpoint;
  return (
    <div>
      <DetailRow label="State" styles={styles}>
        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded" style={endpointStateStyle(activity, ep.state)}>
          {ep.stateLabel}
        </span>
      </DetailRow>
      <DetailRow label="Machine" styles={styles}>{entry.machineTitle}</DetailRow>
      <DetailRow label="Transport" styles={styles}>{ep.transport ?? 'runtime'}</DetailRow>
      {ep.project && <DetailRow label="Project" styles={styles}>{ep.project}</DetailRow>}
      {ep.harness && <DetailRow label="Harness" styles={styles}>{ep.harness}</DetailRow>}
      {ep.lastActiveLabel && <DetailRow label="Last Active" styles={styles}>{ep.lastActiveLabel}</DetailRow>}

      <button
        type="button"
        onClick={() => activity.onOpenAgentProfile(ep.agentId)}
        className="mt-5 text-[11px] font-medium hover:opacity-80"
        style={{ color: C.accent }}
      >
        Open {ep.agentName}
      </button>
    </div>
  );
}

function SessionDetail({ session, activity }: { session: SessionMetadata; activity: ActivityViewModel }) {
  const { styles } = activity;
  return (
    <div>
      <DetailRow label="Project" styles={styles}>{session.project}</DetailRow>
      <DetailRow label="Agent" styles={styles}>{session.agent}</DetailRow>
      <DetailRow label="Messages" styles={styles}>{session.messageCount}</DetailRow>
      <DetailRow label="Created" styles={styles}>{activity.formatDate(session.createdAt)}</DetailRow>
      <DetailRow label="Last Modified" styles={styles}>{activity.formatDate(session.lastModified)}</DetailRow>
      {session.model && <DetailRow label="Model" styles={styles}>{session.model}</DetailRow>}
      {session.tokens != null && <DetailRow label="Tokens" styles={styles}>{session.tokens.toLocaleString()}</DetailRow>}
      {session.tags && session.tags.length > 0 && (
        <DetailRow label="Tags" styles={styles}>
          <div className="flex flex-wrap gap-1">
            {session.tags.map((tag) => (
              <span key={tag} className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={activity.styles.tagBadge}>{tag}</span>
            ))}
          </div>
        </DetailRow>
      )}

      <button
        type="button"
        onClick={() => activity.onOpenSessionDetail(session)}
        className="mt-5 text-[11px] font-medium hover:opacity-80"
        style={{ color: C.accent }}
      >
        Open Session
      </button>
    </div>
  );
}
