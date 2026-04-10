import React from 'react';
import { FileText, MessageSquare, RefreshCw } from 'lucide-react';

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

  return (
    <>
      {!activity.isCollapsed && (
        <div style={{ width: activity.sidebarWidth, ...activity.styles.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
          <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={activity.onResizeStart} />
          <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
            <div className="text-[10px] font-mono tracking-widest uppercase" style={activity.styles.mutedText}>Activity Monitor</div>
            <div className="text-[13px] font-semibold tracking-tight mt-1" style={activity.styles.inkText}>System-wide watch</div>
            <div className="text-[11px] leading-[1.5] mt-1" style={activity.styles.mutedText}>
              Asks, blockers, runtime signals, and recent coordination across Scout.
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
            <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
              <div className="text-[9px] font-mono tracking-widest uppercase mb-3" style={activity.styles.mutedText}>Right Now</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Running', value: `${activity.plansState?.runningTaskCount ?? 0}` },
                  { label: 'Watchlist', value: `${activity.plansState?.findingCount ?? 0}` },
                  { label: 'Agents', value: `${activity.runtime?.agentCount ?? 0}` },
                  { label: 'Nodes', value: `${activity.machinesState?.onlineCount ?? 0}` },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border px-3 py-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                    <div className="text-[9px] font-mono uppercase tracking-widest" style={activity.styles.mutedText}>{item.label}</div>
                    <div className="text-[18px] font-semibold mt-1" style={activity.styles.inkText}>{item.value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
              <div className="text-[9px] font-mono tracking-widest uppercase mb-2" style={activity.styles.mutedText}>Lead Task</div>
              {activity.activityLeadTask ? (
                <>
                  <div className="text-[12px] font-medium leading-[1.5]" style={activity.styles.inkText}>{activity.activityLeadTask.title}</div>
                  <div className="text-[10px] mt-1 leading-[1.5]" style={activity.styles.mutedText}>
                    {activity.activityLeadTask.targetAgentName} · {activity.activityLeadTask.statusLabel} · {activity.activityLeadTask.ageLabel ?? activity.activityLeadTask.updatedAtLabel ?? 'now'}
                  </div>
                  {activity.activityLeadTask.statusDetail ? (
                    <div className="text-[11px] mt-2 leading-[1.55]" style={activity.styles.mutedText}>
                      {activity.activityLeadTask.statusDetail}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => activity.onOpenAgentProfile(activity.activityLeadTask!.targetAgentId)}
                    className="mt-3 text-[10px] font-medium hover:opacity-80"
                    style={{ color: C.accent }}
                  >
                    Open {activity.activityLeadTask.targetAgentName}
                  </button>
                </>
              ) : (
                <div className="text-[11px] leading-[1.5]" style={activity.styles.mutedText}>
                  No active asks are visible yet.
                </div>
              )}
            </section>

            <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
              <div className="text-[9px] font-mono tracking-widest uppercase mb-2" style={activity.styles.mutedText}>View Model</div>
              <div className="space-y-2 text-[11px] leading-[1.5]" style={activity.styles.mutedText}>
                <div>Task-first rows, not micro chat.</div>
                <div>Watchlist surfaces blockers and stale work.</div>
                <div>Runtime stays visible without becoming the main story.</div>
              </div>
            </section>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0" style={activity.styles.surface}>
        <div className="border-b shrink-0 px-6 py-5" style={{ borderBottomColor: C.border }}>
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={activity.styles.mutedText}>Activity Monitor</div>
              <h1 className="text-[28px] font-semibold tracking-tight" style={activity.styles.inkText}>
                Everything Scout Is Coordinating
              </h1>
              <p className="text-[13px] mt-2 max-w-3xl leading-[1.65]" style={activity.styles.mutedText}>
                A system-wide operational picture of asks, handoffs, runtime signals, human interventions, and recent coordination.
                This is the control-room view, not just the mesh view.
              </p>
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
                Open Plans
              </button>
              <button
                type="button"
                onClick={activity.onOpenMessages}
                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                style={{ color: C.ink }}
              >
                <MessageSquare size={14} />
                Open Messages
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mt-5">
            {[
              { label: 'Work In Flight', value: `${activity.plansState?.runningTaskCount ?? 0}`, detail: `${activity.plansState?.taskCount ?? 0} total asks` },
              { label: 'Watchlist', value: `${activity.plansState?.findingCount ?? 0}`, detail: `${activity.plansState?.errorCount ?? 0} errors · ${activity.plansState?.warningCount ?? 0} warnings` },
              { label: 'Live Runtime', value: `${activity.activityEndpoints.filter((entry) => entry.endpoint.state === 'running').length}`, detail: `${activity.runtime?.tmuxSessionCount ?? 0} sessions visible` },
              { label: 'Recent Coordination', value: `${activity.activityRecentMessages.length}`, detail: `${activity.runtime?.messageCount ?? 0} broker messages captured` },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border px-4 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <div className="text-[9px] font-mono uppercase tracking-widest" style={activity.styles.mutedText}>{item.label}</div>
                <div className="text-[24px] font-semibold mt-2" style={activity.styles.inkText}>{item.value}</div>
                <div className="text-[11px] mt-1" style={activity.styles.mutedText}>{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4">
            <div className="space-y-4 min-w-0">
              <section className="border rounded-xl overflow-hidden" style={{ ...activity.styles.surface, borderColor: C.border }}>
                <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase" style={activity.styles.mutedText}>Work Feed</div>
                    <div className="text-[11px] mt-1" style={activity.styles.mutedText}>Task-level asks and routed work, newest first.</div>
                  </div>
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={activity.styles.activePill}>
                    {activity.activityTasks.length} rows
                  </span>
                </div>
                <div className="divide-y" style={{ borderColor: C.border }}>
                  {activity.activityTasks.length > 0 ? activity.activityTasks.map((task) => (
                    <div key={task.id} className="px-4 py-4" style={{ backgroundColor: C.surface }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded"
                              style={
                                task.status === 'running'
                                  ? activity.styles.activePill
                                  : task.status === 'failed'
                                    ? { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' }
                                    : task.status === 'completed'
                                      ? { backgroundColor: 'rgba(34, 197, 94, 0.12)', color: '#166534' }
                                      : activity.styles.tagBadge
                              }
                            >
                              {task.statusLabel}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={activity.styles.tagBadge}>
                              {task.targetAgentName}
                            </span>
                            {task.project ? (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={activity.styles.tagBadge}>
                                {task.project}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[13px] font-medium mt-2 leading-[1.5]" style={activity.styles.inkText}>
                            {task.title}
                          </div>
                          {task.statusDetail ? (
                            <div className="text-[11px] mt-1 leading-[1.6]" style={activity.styles.mutedText}>
                              {task.statusDetail}
                            </div>
                          ) : null}
                          {task.replyPreview ? (
                            <div className="mt-2 rounded-lg border px-3 py-2 text-[11px] leading-[1.6]" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.muted }}>
                              {task.replyPreview}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span className="text-[10px] font-mono" style={activity.styles.mutedText}>
                            {task.ageLabel ?? task.updatedAtLabel ?? task.createdAtLabel}
                          </span>
                          <button
                            type="button"
                            onClick={() => activity.onOpenAgentProfile(task.targetAgentId)}
                            className="text-[10px] font-medium hover:opacity-80"
                            style={{ color: C.accent }}
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="px-4 py-10 text-[12px] text-center" style={activity.styles.mutedText}>
                      No task-level activity has been indexed yet.
                    </div>
                  )}
                </div>
              </section>

              <section className="border rounded-xl overflow-hidden" style={{ ...activity.styles.surface, borderColor: C.border }}>
                <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase" style={activity.styles.mutedText}>Recent Coordination</div>
                    <div className="text-[11px] mt-1" style={activity.styles.mutedText}>The latest human, bridge, and agent interactions crossing the system.</div>
                  </div>
                </div>
                <div className="divide-y" style={{ borderColor: C.border }}>
                  {activity.activityRecentMessages.length > 0 ? activity.activityRecentMessages.map((message) => {
                    const agent = activity.interAgentAgentLookup.get(message.authorId) ?? null;
                    const counterparts = message.recipients.filter((recipient) => recipient !== message.authorId).slice(0, 2).join(', ');
                    return (
                      <div key={message.id} className="px-4 py-3 flex items-start gap-3" style={{ backgroundColor: C.surface }}>
                        <div
                          className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: message.avatarColor }}
                        >
                          {message.avatarLabel}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] font-medium" style={activity.styles.inkText}>{message.authorName}</span>
                            {message.messageClass ? (
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={message.messageClass === 'status' ? activity.styles.activePill : activity.styles.tagBadge}>
                                {message.messageClass}
                              </span>
                            ) : null}
                            {counterparts ? (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={activity.styles.tagBadge}>
                                to {counterparts}
                              </span>
                            ) : null}
                            <span className="text-[9px] font-mono" style={activity.styles.mutedText}>{message.timestampLabel}</span>
                          </div>
                          <div className="text-[11px] mt-1 leading-[1.6]" style={activity.styles.mutedText}>
                            {messagePreviewSnippet(message.body, 220)}
                          </div>
                        </div>
                        {agent ? (
                          <button
                            type="button"
                            onClick={() => activity.onOpenAgentProfile(agent.id)}
                            className="text-[10px] font-medium shrink-0 hover:opacity-80"
                            style={{ color: C.accent }}
                          >
                            Open
                          </button>
                        ) : null}
                      </div>
                    );
                  }) : (
                    <div className="px-4 py-10 text-[12px] text-center" style={activity.styles.mutedText}>
                      No coordination history has been captured yet.
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="space-y-4 min-w-0">
              <section className="border rounded-xl overflow-hidden" style={{ ...activity.styles.surface, borderColor: C.border }}>
                <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase" style={activity.styles.mutedText}>Watchlist</div>
                    <div className="text-[11px] mt-1" style={activity.styles.mutedText}>Errors and warnings that may need cleanup or intervention.</div>
                  </div>
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={activity.activityFindings.some((finding) => finding.severity === 'error') ? { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' } : activity.styles.tagBadge}>
                    {activity.activityFindings.length}
                  </span>
                </div>
                <div className="divide-y" style={{ borderColor: C.border }}>
                  {activity.activityFindings.length > 0 ? activity.activityFindings.map((finding) => (
                    <div key={finding.id} className="px-4 py-3" style={{ backgroundColor: C.surface }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[12px] font-medium" style={activity.styles.inkText}>{finding.title}</div>
                        <span
                          className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0"
                          style={finding.severity === 'error'
                            ? { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' }
                            : { backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#b45309' }}
                        >
                          {finding.severity}
                        </span>
                      </div>
                      <div className="text-[11px] mt-1 leading-[1.55]" style={activity.styles.mutedText}>{finding.summary}</div>
                      {finding.detail ? (
                        <div className="text-[10px] mt-2 leading-[1.5]" style={activity.styles.mutedText}>{finding.detail}</div>
                      ) : null}
                    </div>
                  )) : (
                    <div className="px-4 py-10 text-[12px] text-center" style={activity.styles.mutedText}>
                      No blockers are visible right now.
                    </div>
                  )}
                </div>
              </section>

              <section className="border rounded-xl overflow-hidden" style={{ ...activity.styles.surface, borderColor: C.border }}>
                <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase" style={activity.styles.mutedText}>Runtime Signals</div>
                  <div className="text-[11px] mt-1" style={activity.styles.mutedText}>Active and waiting endpoints across the current mesh.</div>
                </div>
                <div className="divide-y" style={{ borderColor: C.border }}>
                  {activity.activityEndpoints.length > 0 ? activity.activityEndpoints.map((entry) => (
                    <div key={entry.endpoint.id} className="px-4 py-3 flex items-start justify-between gap-3" style={{ backgroundColor: C.surface }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-medium" style={activity.styles.inkText}>{entry.endpoint.agentName}</span>
                          <span
                            className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded"
                            style={
                              entry.endpoint.state === 'running'
                                ? activity.styles.activePill
                                : entry.endpoint.state === 'waiting'
                                  ? { backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#b45309' }
                                  : activity.styles.tagBadge
                            }
                          >
                            {entry.endpoint.stateLabel}
                          </span>
                        </div>
                        <div className="text-[10px] mt-1" style={activity.styles.mutedText}>
                          {entry.machineTitle} · {entry.endpoint.transport ?? 'runtime'} · {entry.endpoint.project ?? 'no project'}
                        </div>
                        {entry.endpoint.activeTask ? (
                          <div className="text-[11px] mt-2 leading-[1.55]" style={activity.styles.mutedText}>
                            {entry.endpoint.activeTask}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => activity.onOpenAgentProfile(entry.endpoint.agentId)}
                        className="text-[10px] font-medium shrink-0 hover:opacity-80"
                        style={{ color: C.accent }}
                      >
                        Open
                      </button>
                    </div>
                  )) : (
                    <div className="px-4 py-10 text-[12px] text-center" style={activity.styles.mutedText}>
                      No runtime endpoints are visible yet.
                    </div>
                  )}
                </div>
              </section>

              <section className="border rounded-xl overflow-hidden" style={{ ...activity.styles.surface, borderColor: C.border }}>
                <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase" style={activity.styles.mutedText}>Recent Sessions</div>
                  <div className="text-[11px] mt-1" style={activity.styles.mutedText}>Fresh session history from local workspaces and harnesses.</div>
                </div>
                <div className="divide-y" style={{ borderColor: C.border }}>
                  {activity.overviewSessions.length > 0 ? activity.overviewSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => activity.onOpenSessionDetail(session)}
                      className="w-full text-left px-4 py-3 transition-opacity hover:opacity-90"
                      style={{ backgroundColor: C.surface }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium truncate" style={activity.styles.inkText}>{session.title}</div>
                          <div className="text-[10px] mt-1" style={activity.styles.mutedText}>{session.project} · {session.agent}</div>
                        </div>
                        <span className="text-[10px] font-mono shrink-0" style={activity.styles.mutedText}>{activity.formatDate(session.lastModified)}</span>
                      </div>
                    </button>
                  )) : (
                    <div className="px-4 py-10 text-[12px] text-center" style={activity.styles.mutedText}>
                      No session history is available yet.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="h-7 border-t flex items-center px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
          <span className="text-[9px] font-mono" style={activity.styles.mutedText}>
            System-wide activity view: tasks first, watchlist second, runtime and coordination side by side
          </span>
        </div>
      </div>
    </>
  );
}
