import React from 'react';
import type { TraceIntent } from '@openscout/session-trace';
import {
  ArrowUpDown,
  Bot,
  ChevronRight,
  Copy,
  Eye,
  FileJson,
  Filter,
  FolderOpen,
  List,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Star,
  X,
} from 'lucide-react';

import { AgentSessionTraceSurface } from '@/components/agent-session-trace-surface';
import { LogPanel } from '@/components/log-panel';
import {
  AgentActionButton,
  InterAgentIcon,
  RelayTimeline,
} from '@web/features/messages/components/relay-timeline';
import {
  agentRosterFilterLabel,
  agentRosterSecondaryText,
  agentRosterSortLabel,
  compactHomePath,
  colorForIdentity,
  interAgentThreadSubtitle,
  interAgentThreadTitleForAgent,
  relayPresenceDotClass,
} from '@web/features/messages/lib/relay-utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/primitives/collapsible';
import { Spinner } from '@/components/primitives/spinner';
import type { AppView } from '@/app-types';
import { C } from '@/lib/theme';
import type {
  AgentConfigState,
  AgentSessionInspector,
  AppSettingsState,
  DesktopLogCatalog,
  DesktopLogContent,
  DesktopLogSource,
  InterAgentAgent,
  InterAgentThread,
  PhonePreparationState,
  RelayDirectThread,
  RelayMessage,
  SessionMetadata,
} from '@/lib/scout-desktop';
import type { AgentRosterFilterMode, AgentRosterSortMode } from '@web/features/messages/lib/relay-types';

type RosterMenu = null | 'filter' | 'sort';

interface ViewStyles {
  sidebar: React.CSSProperties;
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  activePill: React.CSSProperties;
  activeItem: React.CSSProperties;
  annotBadge: React.CSSProperties;
}

interface LayoutViewModel {
  isCollapsed: boolean;
  sidebarWidth: number;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  styles: ViewStyles;
}

interface RosterViewModel {
  interAgentStateTitle: string;
  interAgentStateSubtitle: string;
  rosterInterAgentAgents: InterAgentAgent[];
  interAgentAgents: InterAgentAgent[];
  selectedInterAgentId: string | null;
  onSelectInterAgent: (agentId: string) => void;
  agentRosterMenu: RosterMenu;
  setAgentRosterMenu: React.Dispatch<React.SetStateAction<RosterMenu>>;
  agentRosterFilter: AgentRosterFilterMode;
  setAgentRosterFilter: React.Dispatch<React.SetStateAction<AgentRosterFilterMode>>;
  agentRosterSort: AgentRosterSortMode;
  setAgentRosterSort: React.Dispatch<React.SetStateAction<AgentRosterSortMode>>;
  rosterAgentTitleCounts: Map<string, number>;
  onRefresh: () => void;
}

interface AgentsViewModel {
  selectedInterAgent: InterAgentAgent | null;
  selectedInterAgentDirectThread: RelayDirectThread | null;
  selectedInterAgentChatActionLabel: string;
  onOpenAgentThread: (agentId: string, options?: { draft?: string | null; focusComposer?: boolean }) => void;
  onPeekAgentSession: () => void;
  onOpenAgentSettings: (agentId: string, preferProjectAgent?: boolean) => void;
  visibleAgentSession: AgentSessionInspector | null;
  agentSessionPending: boolean;
  agentSessionLoading: boolean;
  agentSessionFeedback: string | null;
  agentSessionCopied: boolean;
  onCopyAgentSessionCommand: () => void;
  onOpenAgentSession: () => void;
  onAgentSessionTraceIntent: (intent: TraceIntent) => void;
  agentSessionLogsExpanded: boolean;
  setAgentSessionLogsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  agentSessionInlineViewportRef: React.MutableRefObject<HTMLElement | null>;
  onInlineAgentSessionScroll: React.UIEventHandler<HTMLElement>;
  renderLocalPathValue: (
    filePath: string | null | undefined,
    options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
  ) => React.ReactNode;
  selectedInterAgentActivityMessages: RelayMessage[];
  interAgentAgentLookup: Map<string, InterAgentAgent>;
  relayDirectLookup: Map<string, RelayDirectThread>;
  onOpenAgentProfile: (agentId: string) => void;
  onNudgeMessage: (message: RelayMessage) => void;
  selectedInterAgentInboundTasks: Array<{
    id: string;
  }>;
  selectedInterAgentOutboundFindings: Array<{
    id: string;
  }>;
  selectedInterAgentFindings: Array<{
    id: string;
    title: string;
    severity: 'error' | 'warning';
    summary: string;
    ageLabel?: string | null;
    updatedAtLabel?: string | null;
  }>;
  agentActivityExpanded: boolean;
  setAgentActivityExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  agentThreadsExpanded: boolean;
  setAgentThreadsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  visibleInterAgentThreads: InterAgentThread[];
  selectedInterAgentThreadId: string | null;
  onOpenThreadInTrafficView: (threadId: string) => void;
  selectedAgentDirectLinePreview: string;
  agentSnapshotExpanded: boolean;
  setAgentSnapshotExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  visibleAgentConfig: AgentConfigState | null;
}

interface LogsViewModel {
  logSources: DesktopLogSource[];
  filteredLogSources: DesktopLogSource[];
  selectedLogSourceId: string | null;
  setSelectedLogSourceId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedLogSource: DesktopLogSource | null;
  logCatalog: DesktopLogCatalog | null;
  logContent: DesktopLogContent | null;
  logsLoading: boolean;
  logsFeedback: string | null;
  logSearchQuery: string;
  setLogSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  logSourceQuery: string;
  setLogSourceQuery: React.Dispatch<React.SetStateAction<string>>;
}

interface InterAgentViewModel {
  selectedInterAgent: InterAgentAgent | null;
  visibleInterAgentThreads: InterAgentThread[];
  selectedInterAgentThreadId: string | null;
  setSelectedInterAgentThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  interAgentThreadTitle: string;
  selectedInterAgentThread: InterAgentThread | null;
  selectedInterAgentThreadSubtitle: string;
  selectedRelayDirectThread: RelayDirectThread | null;
  showAnnotations: boolean;
  setShowAnnotations: React.Dispatch<React.SetStateAction<boolean>>;
  interAgentMessageTarget: InterAgentAgent | null;
  openAgentDirectMessage: (agentId: string) => void;
  interAgentConfigureTarget: InterAgentAgent | null;
  onOpenAgentSettings: (agentId: string, preferProjectAgent?: boolean) => void;
  interAgentConfigureLabel: string | null;
  visibleInterAgentMessages: RelayMessage[];
  interAgentAgentLookup: Map<string, InterAgentAgent>;
  relayDirectLookup: Map<string, RelayDirectThread>;
  onOpenAgentProfile: (agentId: string) => void;
  onNudgeMessage: (message: RelayMessage) => void;
}

interface SessionsViewModel {
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  filteredSessions: SessionMetadata[];
  stats: {
    totalSessions: number;
  };
  onRefresh: () => void;
  loadingSessions: boolean;
  selectedSession: SessionMetadata | null;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionMetadata | null>>;
  phonePreparationState: PhonePreparationState;
  phonePreparationLoading: boolean;
  phonePreparationSaving: boolean;
  phonePreparationFeedback: string | null;
  setDraggedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraggedPhoneSection: React.Dispatch<React.SetStateAction<'favorites' | 'quickHits' | null>>;
  favoritePhoneSessions: SessionMetadata[];
  quickHitPhoneSessions: SessionMetadata[];
  formatDate: (value: string) => string;
  onClearPhoneQuickHits: () => void;
  onDropIntoFavorites: () => void;
  onDropIntoQuickHits: (index?: number) => void;
  onRemoveSessionFromPhoneSection: (sessionId: string, section: 'favorites' | 'quickHits') => void;
  onAddSessionToPhoneSection: (sessionId: string, section: 'favorites' | 'quickHits') => void;
}

export interface AgentViewsProps {
  activeView: AppView;
  layout: LayoutViewModel;
  roster: RosterViewModel;
  agents: AgentsViewModel;
  logs: LogsViewModel;
  interAgent: InterAgentViewModel;
  sessions: SessionsViewModel;
}

function AgentRosterSidebar({
  title,
  subtitle,
  layout,
  roster,
}: {
  title: string;
  subtitle: string;
  layout: LayoutViewModel;
  roster: RosterViewModel;
}) {
  if (layout.isCollapsed) {
    return null;
  }

  return (
    <div style={{ width: layout.sidebarWidth, ...layout.styles.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
      <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={layout.onResizeStart} />
      <div className="px-4 h-14 flex items-center justify-between border-b" style={{ borderBottomColor: C.border }}>
        <div>
          <h1 className="text-[13px] font-semibold tracking-tight" style={layout.styles.inkText}>{title}</h1>
          <div className="text-[10px] font-mono mt-0.5" style={layout.styles.mutedText}>{subtitle}</div>
        </div>
        <button className="p-1.5 rounded transition-opacity hover:opacity-70" style={layout.styles.mutedText} onClick={roster.onRefresh}>
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-3">
        <div className="mb-3 px-2">
          <div className="font-mono text-[9px] tracking-widest uppercase mb-1.5 px-2" style={layout.styles.mutedText}>Roster</div>
          <div className="flex items-center justify-end gap-2 px-2 mb-2 relative">
            <div className="relative">
              <button
                className="os-toolbar-button flex items-center gap-1 text-[10px] px-2 py-1 rounded"
                style={{ color: C.ink }}
                onClick={() => roster.setAgentRosterMenu((current) => current === 'filter' ? null : 'filter')}
                title="Filter roster"
              >
                <Filter size={11} />
                <span style={layout.styles.mutedText}>{agentRosterFilterLabel(roster.agentRosterFilter)}</span>
              </button>
              {roster.agentRosterMenu === 'filter' ? (
                <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border shadow-sm z-20" style={{ backgroundColor: C.surface, borderColor: C.border }}>
                  {([
                    ['all', 'All Agents'],
                    ['active', 'Active Only'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className="w-full text-left px-3 py-2 text-[11px] transition-opacity hover:opacity-80"
                      style={value === roster.agentRosterFilter ? layout.styles.activeItem : layout.styles.inkText}
                      onClick={() => {
                        roster.setAgentRosterFilter(value);
                        roster.setAgentRosterMenu(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                className="os-toolbar-button flex items-center gap-1 text-[10px] px-2 py-1 rounded"
                style={{ color: C.ink }}
                onClick={() => roster.setAgentRosterMenu((current) => current === 'sort' ? null : 'sort')}
                title="Sort roster"
              >
                <ArrowUpDown size={11} />
                <span style={layout.styles.mutedText}>{agentRosterSortLabel(roster.agentRosterSort)}</span>
              </button>
              {roster.agentRosterMenu === 'sort' ? (
                <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border shadow-sm z-20" style={{ backgroundColor: C.surface, borderColor: C.border }}>
                  {([
                    ['chat', 'Recent Chat'],
                    ['code', 'Code Changes'],
                    ['session', 'Dev Sessions'],
                    ['alpha', 'A-Z'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className="w-full text-left px-3 py-2 text-[11px] transition-opacity hover:opacity-80"
                      style={value === roster.agentRosterSort ? layout.styles.activeItem : layout.styles.inkText}
                      onClick={() => {
                        roster.setAgentRosterSort(value);
                        roster.setAgentRosterMenu(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-px">
            {roster.rosterInterAgentAgents.length > 0 ? roster.rosterInterAgentAgents.map((agent) => {
              const active = roster.selectedInterAgentId === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => roster.onSelectInterAgent(agent.id)}
                  className="flex items-center gap-2 px-2 py-2 rounded text-[12px] transition-opacity w-full text-left"
                  style={active ? layout.styles.activeItem : layout.styles.mutedText}
                >
                  <div className="relative shrink-0">
                    <div
                      className={`w-6 h-6 rounded text-white flex items-center justify-center text-[9px] font-bold ${agent.reachable ? '' : 'opacity-40 grayscale'}`}
                      style={{ backgroundColor: colorForIdentity(agent.id) }}
                    >
                      {agent.title.charAt(0).toUpperCase()}
                    </div>
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${relayPresenceDotClass(agent.state)}`}
                      style={{ border: `1px solid ${C.bg}` }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" style={layout.styles.inkText}>
                      {agent.title}
                      {(roster.rosterAgentTitleCounts.get(agent.title) ?? 0) > 1 && agent.branch ? (
                        <span className="font-normal ml-1 text-[10px]" style={layout.styles.mutedText}>{agent.branch}</span>
                      ) : null}
                    </div>
                    <div className="text-[10px] truncate" style={layout.styles.mutedText}>{agentRosterSecondaryText(agent, roster.agentRosterSort)}</div>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={active ? layout.styles.activePill : layout.styles.tagBadge}>{agent.threadCount}</span>
                </button>
              );
            }) : (
              <div className="px-3 py-8 text-[12px] text-center" style={layout.styles.mutedText}>
                No agents match this view yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentViews({
  activeView,
  layout,
  roster,
  agents,
  logs,
  interAgent,
  sessions,
}: AgentViewsProps) {
  if (activeView === 'agents') {
    const subtitle = roster.rosterInterAgentAgents.length === roster.interAgentAgents.length
      ? `${roster.interAgentAgents.length} agents`
      : `${roster.rosterInterAgentAgents.length} visible · ${roster.interAgentAgents.length} total`;

    return (
      <>
        <AgentRosterSidebar title="Agents" subtitle={subtitle} layout={layout} roster={roster} />

        <div className="flex-1 flex flex-col relative min-w-0" style={layout.styles.surface}>
          <div className="border-b px-4 py-3 shrink-0" style={{ ...layout.styles.surface, borderBottomColor: C.border }}>
            {agents.selectedInterAgent ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="relative shrink-0">
                    <div
                      className={`w-9 h-9 rounded-xl text-[13px] text-white flex items-center justify-center font-bold ${agents.selectedInterAgent.reachable ? '' : 'opacity-40 grayscale'}`}
                      style={{ backgroundColor: colorForIdentity(agents.selectedInterAgent.id) }}
                    >
                      {agents.selectedInterAgent.title.charAt(0).toUpperCase()}
                    </div>
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${relayPresenceDotClass(agents.selectedInterAgent.state)}`}
                      style={{ border: `1px solid ${C.surface}` }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-[15px] font-semibold tracking-tight truncate" style={layout.styles.inkText}>
                        {agents.selectedInterAgent.title}
                      </div>
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={agents.selectedInterAgent.state === 'working' ? layout.styles.activePill : layout.styles.tagBadge}>
                        {agents.selectedInterAgent.statusLabel}
                      </span>
                    </div>
                    <div className="text-[11px] mt-0.5 truncate max-w-2xl" style={layout.styles.mutedText}>
                      {agents.selectedInterAgent.statusDetail ?? agents.selectedInterAgent.summary ?? null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <AgentActionButton
                    icon={<MessageSquare size={13} />}
                    tone={agents.selectedInterAgentDirectThread ? 'primary' : 'neutral'}
                    onClick={() => agents.onOpenAgentThread(agents.selectedInterAgent!.id, { focusComposer: true })}
                  >
                    {agents.selectedInterAgentChatActionLabel}
                  </AgentActionButton>
                  <AgentActionButton icon={<Eye size={13} />} onClick={agents.onPeekAgentSession}>
                    Peek
                  </AgentActionButton>
                  <AgentActionButton
                    icon={<Settings size={13} />}
                    onClick={() => agents.onOpenAgentSettings(agents.selectedInterAgent!.id, agents.selectedInterAgent!.profileKind === 'project')}
                  >
                    {agents.selectedInterAgent.profileKind === 'project' ? 'Configure' : 'Settings'}
                  </AgentActionButton>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <Bot size={14} style={layout.styles.mutedText} />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold tracking-tight truncate" style={layout.styles.inkText}>
                    Agents
                  </div>
                  <div className="text-[10px] truncate mt-0.5" style={layout.styles.mutedText}>
                    Select an agent to inspect its operational snapshot and recent threads.
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {!agents.selectedInterAgent ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                  <Bot size={24} style={{ color: C.accent }} />
                </div>
                <h3 className="text-[15px] font-medium mb-1" style={layout.styles.inkText}>No agent selected</h3>
                <p className="text-[13px] max-w-sm" style={layout.styles.mutedText}>
                  Pick an agent from the left rail to inspect its profile, runtime binding, and recent communication.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <section className="border rounded-xl overflow-hidden" style={{ ...layout.styles.surface, borderColor: C.border }}>
                  <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ backgroundColor: C.surface, borderBottomColor: C.border }}>
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Live Session</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {agents.visibleAgentSession?.commandLabel ? (
                        <AgentActionButton icon={<Copy size={13} />} onClick={agents.onCopyAgentSessionCommand}>
                          {agents.agentSessionCopied ? 'Copied' : 'Copy'}
                        </AgentActionButton>
                      ) : null}
                      {agents.visibleAgentSession?.mode === 'trace' ? (
                        <AgentActionButton icon={<Eye size={13} />} onClick={agents.onPeekAgentSession}>
                          Open Trace
                        </AgentActionButton>
                      ) : null}
                      {agents.visibleAgentSession?.mode === 'debug' ? (
                        <AgentActionButton icon={<FolderOpen size={13} />} onClick={agents.onOpenAgentSession}>
                          {agents.visibleAgentSession.debugMode === 'tmux' ? 'Open TMUX' : 'Open Debug'}
                        </AgentActionButton>
                      ) : null}
                    </div>
                  </div>

                  <div className="px-4 py-4 max-h-[320px] overflow-y-auto" style={{ backgroundColor: C.bg }}>
                    {agents.selectedInterAgentActivityMessages.length > 0 ? (
                      <RelayTimeline
                        messages={agents.selectedInterAgentActivityMessages.slice(-8)}
                        showAnnotations={false}
                        showStatusMessages={false}
                        inkStyle={layout.styles.inkText}
                        mutedStyle={layout.styles.mutedText}
                        tagStyle={layout.styles.tagBadge}
                        annotStyle={layout.styles.annotBadge}
                        agentLookup={agents.interAgentAgentLookup}
                        directThreadLookup={agents.relayDirectLookup}
                        onOpenAgentProfile={agents.onOpenAgentProfile}
                        onOpenAgentChat={(agentId, draft) => agents.onOpenAgentThread(agentId, { draft, focusComposer: true })}
                        onNudgeMessage={agents.onNudgeMessage}
                      />
                    ) : (
                      <div className="text-[11px] leading-[1.6]" style={layout.styles.mutedText}>
                        No messages yet. Use the broker to send this agent a task.
                      </div>
                    )}
                  </div>

                  <Collapsible open={agents.agentSessionLogsExpanded} onOpenChange={agents.setAgentSessionLogsExpanded}>
                    <CollapsibleTrigger asChild>
                      <button
                        className="w-full px-4 py-2 border-t flex items-center justify-between gap-2 text-[10px] hover:opacity-90 transition-opacity text-left"
                        style={{ borderTopColor: C.border, backgroundColor: C.bg, color: C.muted }}
                      >
                        <div className="flex items-center gap-2">
                          <ChevronRight size={10} className="transition-transform duration-150" style={{ transform: agents.agentSessionLogsExpanded ? 'rotate(90deg)' : undefined }} />
                          <span className="font-mono uppercase tracking-wider">
                            {agents.visibleAgentSession?.mode === 'trace' ? 'Trace' : 'Session'}
                          </span>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={agents.visibleAgentSession?.mode === 'trace' ? layout.styles.activePill : layout.styles.tagBadge}>
                            {agents.agentSessionPending
                              ? 'Loading'
                              : agents.visibleAgentSession?.mode === 'trace'
                                ? 'Trace'
                                : agents.visibleAgentSession?.debugMode === 'tmux'
                                  ? 'TMUX'
                                  : agents.visibleAgentSession?.debugMode === 'logs'
                                    ? 'Debug'
                                    : 'Unavailable'}
                          </span>
                          {agents.visibleAgentSession?.updatedAtLabel ? <span>Updated {agents.visibleAgentSession.updatedAtLabel}</span> : null}
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div style={{ backgroundColor: agents.visibleAgentSession?.mode === 'trace' ? C.bg : C.termBg }}>
                        {agents.agentSessionLoading && !agents.visibleAgentSession ? (
                          <div className="px-4 py-8 text-[11px] font-mono" style={{ color: C.termFg }}>
                            Loading live session…
                          </div>
                        ) : agents.visibleAgentSession?.mode === 'trace' && agents.visibleAgentSession.trace ? (
                          <div
                            ref={(element) => {
                              agents.agentSessionInlineViewportRef.current = element;
                            }}
                            onScroll={agents.onInlineAgentSessionScroll}
                            className="max-h-[400px] overflow-y-auto px-4 py-4"
                          >
                            <AgentSessionTraceSurface
                              snapshot={agents.visibleAgentSession.trace}
                              onIntent={agents.onAgentSessionTraceIntent}
                            />
                          </div>
                        ) : agents.visibleAgentSession?.body ? (
                          <pre
                            ref={(element) => {
                              agents.agentSessionInlineViewportRef.current = element;
                            }}
                            onScroll={agents.onInlineAgentSessionScroll}
                            className="px-4 py-4 text-[11px] leading-[1.6] overflow-x-auto whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto"
                            style={{ color: C.termFg, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                          >
                            {agents.visibleAgentSession.body}
                          </pre>
                        ) : (
                          <div className="px-4 py-8 text-[11px] leading-[1.65] font-mono" style={{ color: C.termFg }}>
                            {agents.agentSessionPending
                              ? 'Loading live session state.'
                              : agents.visibleAgentSession?.subtitle ?? 'No session output available yet.'}
                          </div>
                        )}
                      </div>
                      <div
                        className="px-4 h-10 border-t flex items-center justify-between gap-3 text-[10px]"
                        style={{ borderTopColor: C.border, backgroundColor: C.bg, color: C.muted }}
                      >
                        <div className="truncate min-w-0 font-mono">
                          {agents.renderLocalPathValue(
                            agents.visibleAgentSession?.pathLabel ?? compactHomePath(agents.selectedInterAgent.cwd ?? agents.selectedInterAgent.projectRoot) ?? 'No stable session path yet.',
                            {
                              className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity',
                            },
                          )}
                        </div>
                        {agents.agentSessionFeedback ? <div className="shrink-0" style={layout.styles.inkText}>{agents.agentSessionFeedback}</div> : null}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </section>

                <section className="border rounded-xl overflow-hidden" style={{ ...layout.styles.surface, borderColor: C.border }}>
                  <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border, backgroundColor: C.surface }}>
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Recent Activity</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={layout.styles.tagBadge}>
                        {agents.selectedInterAgentActivityMessages.length} events
                      </span>
                      {agents.selectedInterAgentInboundTasks.length > 0 ? (
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={layout.styles.activePill}>
                          {agents.selectedInterAgentInboundTasks.length} asks
                        </span>
                      ) : null}
                      {agents.selectedInterAgentOutboundFindings.length > 0 ? (
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' }}>
                          {agents.selectedInterAgentOutboundFindings.length} waiting
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {agents.selectedInterAgentFindings.length > 0 ? (
                    <div className="px-4 py-3 border-b flex flex-col gap-2" style={{ borderBottomColor: C.border, backgroundColor: C.bg }}>
                      {agents.selectedInterAgentFindings.slice(0, 2).map((finding) => (
                        <div
                          key={finding.id}
                          className="rounded-lg border px-3 py-2"
                          style={{
                            borderColor: finding.severity === 'error' ? 'rgba(248, 113, 113, 0.28)' : 'rgba(245, 158, 11, 0.28)',
                            backgroundColor: finding.severity === 'error' ? 'rgba(248, 113, 113, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-medium" style={layout.styles.inkText}>{finding.title}</div>
                            <span className="text-[9px] font-mono uppercase" style={layout.styles.mutedText}>
                              {finding.ageLabel ?? finding.updatedAtLabel ?? 'Open'}
                            </span>
                          </div>
                          <div className="text-[11px] mt-1" style={layout.styles.mutedText}>
                            {finding.summary}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="px-4 py-4 max-h-[280px] overflow-y-auto" style={{ backgroundColor: C.bg }}>
                    {agents.selectedInterAgentActivityMessages.length > 0 ? (
                      <RelayTimeline
                        messages={agents.agentActivityExpanded ? agents.selectedInterAgentActivityMessages : agents.selectedInterAgentActivityMessages.slice(-5)}
                        showAnnotations={true}
                        showStatusMessages={true}
                        inkStyle={layout.styles.inkText}
                        mutedStyle={layout.styles.mutedText}
                        tagStyle={layout.styles.tagBadge}
                        annotStyle={layout.styles.annotBadge}
                        agentLookup={agents.interAgentAgentLookup}
                        directThreadLookup={agents.relayDirectLookup}
                        onOpenAgentProfile={agents.onOpenAgentProfile}
                        onOpenAgentChat={(agentId, draft) => agents.onOpenAgentThread(agentId, { draft, focusComposer: true })}
                        onNudgeMessage={agents.onNudgeMessage}
                      />
                    ) : (
                      <div className="text-[11px] leading-[1.6]" style={layout.styles.mutedText}>
                        No broker-visible activity for this agent yet.
                      </div>
                    )}
                    {agents.selectedInterAgentActivityMessages.length > 5 && !agents.agentActivityExpanded ? (
                      <button
                        className="w-full text-center py-2 text-[11px] font-medium hover:opacity-80 transition-opacity"
                        style={{ color: C.accent }}
                        onClick={() => agents.setAgentActivityExpanded(true)}
                      >
                        Show all {agents.selectedInterAgentActivityMessages.length} events
                      </button>
                    ) : null}
                  </div>
                </section>

                <Collapsible open={agents.agentThreadsExpanded} onOpenChange={agents.setAgentThreadsExpanded}>
                  <section className="border rounded-xl overflow-hidden" style={{ ...layout.styles.surface, borderColor: C.border }}>
                    <CollapsibleTrigger asChild>
                      <button className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:opacity-90 transition-opacity text-left" style={{ backgroundColor: C.surface }}>
                        <div className="flex items-center gap-2">
                          <ChevronRight size={12} className="transition-transform duration-150" style={{ color: C.muted, transform: agents.agentThreadsExpanded ? 'rotate(90deg)' : undefined }} />
                          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Open Threads</div>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={layout.styles.tagBadge}>{agents.visibleInterAgentThreads.length + 1}</span>
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 py-3 border-t flex flex-col gap-3" style={{ borderTopColor: C.border }}>
                        <div className="border rounded-lg px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium truncate" style={layout.styles.inkText}>Direct Line</div>
                              <div className="text-[10px] truncate mt-1" style={layout.styles.mutedText}>You and {agents.selectedInterAgent.title}</div>
                            </div>
                            <span className="text-[10px] font-mono shrink-0" style={layout.styles.mutedText}>
                              {agents.selectedInterAgentDirectThread?.timestampLabel ?? agents.selectedInterAgent.lastChatLabel ?? ''}
                            </span>
                          </div>
                          <div className="text-[12px] leading-[1.55] mt-3" style={layout.styles.mutedText}>
                            {agents.selectedAgentDirectLinePreview}
                          </div>
                          <div className="flex items-center justify-between gap-3 mt-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={layout.styles.activePill}>
                                Direct
                              </span>
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={layout.styles.tagBadge}>
                                {agents.selectedInterAgent.statusLabel}
                              </span>
                            </div>
                            <button
                              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded shrink-0"
                              style={{ color: C.ink }}
                              onClick={() => agents.onOpenAgentThread(agents.selectedInterAgent!.id, { focusComposer: true })}
                            >
                              {agents.selectedInterAgentChatActionLabel}
                            </button>
                          </div>
                        </div>
                        {agents.visibleInterAgentThreads.length > 0 ? (
                          <div className="flex flex-col gap-3">
                            {agents.visibleInterAgentThreads.map((thread) => (
                              <div
                                key={thread.id}
                                className="border rounded-lg px-3 py-3"
                                style={{ borderColor: C.border, backgroundColor: agents.selectedInterAgentThreadId === thread.id ? C.bg : C.surface }}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-[13px] font-medium truncate" style={layout.styles.inkText}>
                                      {interAgentThreadTitleForAgent(thread, agents.selectedInterAgent!.id)}
                                    </div>
                                    <div className="text-[10px] truncate mt-1" style={layout.styles.mutedText}>
                                      {interAgentThreadSubtitle(thread, agents.selectedInterAgent!.id)}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-mono shrink-0" style={layout.styles.mutedText}>
                                    {thread.timestampLabel ?? ''}
                                  </span>
                                </div>
                                <div className="text-[12px] leading-[1.55] mt-3" style={layout.styles.mutedText}>
                                  {thread.preview ?? 'No message preview yet.'}
                                </div>
                                <div className="flex items-center justify-between gap-3 mt-3">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={thread.sourceKind === 'private' ? layout.styles.tagBadge : layout.styles.activePill}>
                                      {thread.sourceKind === 'private' ? 'Private' : 'Targeted'}
                                    </span>
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={layout.styles.tagBadge}>
                                      {thread.messageCount} msgs
                                    </span>
                                  </div>
                                  <button
                                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                                    style={{ color: C.ink }}
                                    onClick={() => agents.onOpenThreadInTrafficView(thread.id)}
                                  >
                                    Open
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col items-start gap-3">
                            <div className="text-[11px] leading-[1.5]" style={layout.styles.mutedText}>
                              No other active channels for this agent yet.
                            </div>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </section>
                </Collapsible>

                <Collapsible open={agents.agentSnapshotExpanded} onOpenChange={agents.setAgentSnapshotExpanded}>
                  <section className="border rounded-xl overflow-hidden" style={{ ...layout.styles.surface, borderColor: C.border }}>
                    <CollapsibleTrigger asChild>
                      <button className="w-full px-4 py-3 flex items-center gap-2 hover:opacity-90 transition-opacity text-left" style={{ backgroundColor: C.surface }}>
                        <ChevronRight size={12} className="transition-transform duration-150" style={{ color: C.muted, transform: agents.agentSnapshotExpanded ? 'rotate(90deg)' : undefined }} />
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Operational Snapshot</div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 py-3 border-t" style={{ borderTopColor: C.border }}>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          {[
                            ['Harness', agents.visibleAgentConfig?.runtime.harness ?? agents.selectedInterAgent.harness ?? 'Not reported'],
                            ['Session', agents.visibleAgentConfig?.runtime.sessionId ?? agents.selectedInterAgent.sessionId ?? 'Not reported'],
                            ['Transport', agents.visibleAgentConfig?.runtime.transport ?? agents.selectedInterAgent.transport ?? 'Not reported'],
                            ['Wake Policy', agents.visibleAgentConfig?.runtime.wakePolicy || agents.selectedInterAgent.wakePolicy || 'Not reported'],
                            ['Last Chat', agents.selectedInterAgent.lastChatLabel ?? 'Not reported'],
                            ['Last Dev Session', agents.selectedInterAgent.lastSessionLabel ?? 'Not reported'],
                            ['Last Code Change', agents.selectedInterAgent.lastCodeChangeLabel ?? 'Not reported'],
                          ].map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={layout.styles.mutedText}>{label}</div>
                              <div className="text-[11px] leading-[1.45] break-words" style={layout.styles.inkText}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </section>
                </Collapsible>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  if (activeView === 'logs') {
    return (
      <>
        {!layout.isCollapsed && (
          <div style={{ width: layout.sidebarWidth, ...layout.styles.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
            <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={layout.onResizeStart} />
            <div className="px-4 h-14 flex items-center border-b" style={{ borderBottomColor: C.border }}>
              <div>
                <h1 className="text-[13px] font-semibold tracking-tight" style={layout.styles.inkText}>Logs</h1>
                <div className="text-[10px] font-mono mt-0.5" style={layout.styles.mutedText}>
                  {logs.logSources.length} sources
                </div>
              </div>
            </div>
            <div className="px-3 py-3 border-b" style={{ borderBottomColor: C.border }}>
              <input
                type="text"
                value={logs.logSourceQuery}
                onChange={(event) => logs.setLogSourceQuery(event.target.value)}
                placeholder="Filter sources…"
                className="w-full rounded-lg border px-3 py-2 text-[11px] bg-transparent outline-none"
                style={{ borderColor: C.border, color: C.ink }}
              />
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              {logs.logSources.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <div className="flex justify-center gap-1 mb-2">
                    <span className="os-thinking-dot" style={{ color: C.accent }} />
                    <span className="os-thinking-dot" style={{ color: C.accent }} />
                    <span className="os-thinking-dot" style={{ color: C.accent }} />
                  </div>
                  <div className="text-[11px]" style={layout.styles.mutedText}>Loading sources…</div>
                </div>
              ) : (['runtime', 'app', 'agents'] as const).map((group) => {
                const groupSources = logs.filteredLogSources.filter((source) => source.group === group);
                if (groupSources.length === 0) {
                  return null;
                }
                const label = group === 'runtime' ? 'Runtime' : group === 'app' ? 'App' : 'Agents';
                return (
                  <div key={group} className="mb-3 px-2">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1.5 px-2" style={layout.styles.mutedText}>{label}</div>
                    <div className="flex flex-col gap-px">
                      {groupSources.map((source) => {
                        const active = logs.selectedLogSourceId === source.id;
                        return (
                          <button
                            key={source.id}
                            onClick={() => {
                              logs.setSelectedLogSourceId(source.id);
                              logs.setLogSearchQuery('');
                            }}
                            className="w-full text-left px-2 py-2 rounded transition-opacity hover:opacity-90"
                            style={active ? layout.styles.activeItem : layout.styles.mutedText}
                          >
                            <div className="text-[12px] font-medium truncate" style={layout.styles.inkText}>{source.title}</div>
                            <div className="text-[10px] truncate mt-0.5" style={layout.styles.mutedText}>{source.subtitle}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col relative min-w-0" style={layout.styles.surface}>
          <div className="border-b flex items-center justify-between px-4 h-14 shrink-0 gap-4" style={{ ...layout.styles.surface, borderBottomColor: C.border }}>
            <div className="flex items-center gap-2 min-w-0">
              <FileJson size={14} style={layout.styles.mutedText} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-tight truncate" style={layout.styles.inkText}>
                  {logs.selectedLogSource?.title ?? 'Logs'}
                </div>
                <div className="text-[10px] truncate mt-0.5" style={layout.styles.mutedText}>
                  {logs.logContent?.updatedAtLabel
                    ? `${logs.selectedLogSource?.subtitle ?? 'Log tail'} · Updated ${logs.logContent.updatedAtLabel}`
                    : logs.selectedLogSource?.subtitle ?? 'Relay runtime, app, and relay agent logs.'}
                </div>
              </div>
            </div>
          </div>

          <div className="border-b px-4 py-3 flex items-center gap-3" style={{ borderBottomColor: C.border }}>
            <input
              type="text"
              value={logs.logSearchQuery}
              onChange={(event) => logs.setLogSearchQuery(event.target.value)}
              placeholder="Filter visible lines…"
              className="flex-1 rounded-lg border px-3 py-2 text-[11px] bg-transparent outline-none"
              style={{ borderColor: C.border, color: C.ink }}
            />
            <div className="text-[10px] font-mono shrink-0" style={layout.styles.mutedText}>
              {logs.logContent
                ? logs.logContent.truncated
                  ? `Tail ${logs.logContent.lineCount} lines`
                  : `${logs.logContent.lineCount} lines`
                : 'No file'}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {!logs.selectedLogSource ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                {!logs.logCatalog ? (
                  <>
                    <div className="flex justify-center gap-1 mb-3">
                      <span className="os-thinking-dot" style={{ color: C.accent }} />
                      <span className="os-thinking-dot" style={{ color: C.accent }} />
                      <span className="os-thinking-dot" style={{ color: C.accent }} />
                    </div>
                    <p className="text-[13px]" style={layout.styles.mutedText}>Loading log sources…</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <FileJson size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={layout.styles.inkText}>No log selected</h3>
                    <p className="text-[13px] max-w-sm" style={layout.styles.mutedText}>
                      Pick a relay runtime, app, or relay agent source from the left rail.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <LogPanel
                title={logs.selectedLogSource.title}
                pathLabel={logs.logContent?.pathLabel ?? logs.selectedLogSource.pathLabel}
                body={logs.logContent?.body ?? null}
                truncated={logs.logContent?.truncated}
                lineCount={logs.logContent?.lineCount}
                missing={logs.logContent?.missing}
                loading={logs.logsLoading}
                searchQuery={logs.logSearchQuery}
                updatedAtLabel={logs.logContent?.updatedAtLabel}
                minHeight={360}
              />
            )}
            {logs.logsFeedback ? (
              <div className="text-[11px] leading-[1.5] mt-3" style={layout.styles.inkText}>{logs.logsFeedback}</div>
            ) : null}
          </div>

          <div className="h-7 border-t flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
            <span className="text-[9px] font-mono" style={layout.styles.mutedText}>Canonical relay runtime, app, and relay agent log tails</span>
          </div>
        </div>
      </>
    );
  }

  if (activeView === 'inter-agent') {
    const subtitle = roster.rosterInterAgentAgents.length === roster.interAgentAgents.length
      ? roster.interAgentStateSubtitle
      : `${roster.rosterInterAgentAgents.length} visible · ${roster.interAgentStateSubtitle}`;

    return (
      <>
        <AgentRosterSidebar title={roster.interAgentStateTitle} subtitle={subtitle} layout={layout} roster={roster} />

        <div className="w-[336px] border-r shrink-0 overflow-hidden flex flex-col" style={{ ...layout.styles.surface, borderRightColor: C.border }}>
          <div className="px-4 h-14 border-b flex flex-col justify-center" style={{ borderBottomColor: C.border }}>
            <div className="text-[10px] font-mono tracking-widest uppercase" style={layout.styles.mutedText}>Agent Threads</div>
            <div className="text-[12px] mt-1" style={layout.styles.inkText}>
              {interAgent.selectedInterAgent
                ? `${interAgent.selectedInterAgent.title} · ${interAgent.visibleInterAgentThreads.length} thread${interAgent.visibleInterAgentThreads.length === 1 ? '' : 's'}`
                : 'Select an agent'}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {interAgent.selectedInterAgent && interAgent.visibleInterAgentThreads.length > 0 ? (
              <div className="divide-y" style={{ borderColor: C.border }}>
                {interAgent.visibleInterAgentThreads.map((thread) => {
                  const active = interAgent.selectedInterAgentThreadId === thread.id;
                  return (
                    <button
                      key={thread.id}
                      onClick={() => interAgent.setSelectedInterAgentThreadId(thread.id)}
                      className="w-full text-left px-4 py-3.5 transition-opacity hover:opacity-90"
                      style={active ? { backgroundColor: C.bg } : undefined}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium truncate" style={layout.styles.inkText}>
                            {interAgentThreadTitleForAgent(thread, interAgent.selectedInterAgent!.id)}
                          </div>
                          <div className="mt-1">
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={thread.sourceKind === 'private' ? layout.styles.tagBadge : layout.styles.activePill}>
                              {thread.sourceKind === 'private' ? 'Private' : 'Relay'}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono shrink-0" style={layout.styles.mutedText}>
                          {thread.timestampLabel ?? ''}
                        </span>
                      </div>
                      <div className="text-[10px] mb-1.5 truncate" style={layout.styles.mutedText}>
                        {interAgentThreadSubtitle(thread, interAgent.selectedInterAgent!.id)}
                      </div>
                      <div className="text-[12px] leading-[1.45] line-clamp-2" style={layout.styles.mutedText}>
                        {thread.preview ?? 'No message preview yet.'}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <div>
                  <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: C.accentBg }}>
                    <InterAgentIcon size={22} style={{ color: C.accent }} />
                  </div>
                  <div className="text-[14px] font-medium mb-1" style={layout.styles.inkText}>No agent threads</div>
                  <div className="text-[12px]" style={layout.styles.mutedText}>
                    {interAgent.selectedInterAgent ? `No inter-agent traffic for ${interAgent.selectedInterAgent.title} yet.` : 'Pick an agent to inspect its thread network.'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col relative min-w-0" style={layout.styles.surface}>
          <div className="border-b flex items-center justify-between px-4 h-14 shrink-0 gap-4" style={{ ...layout.styles.surface, borderBottomColor: C.border }}>
            <div className="flex items-center gap-2 min-w-0">
              <InterAgentIcon size={14} style={layout.styles.mutedText} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-[13px] font-semibold tracking-tight truncate" style={layout.styles.inkText}>{interAgent.interAgentThreadTitle}</h2>
                  {interAgent.selectedInterAgentThread ? (
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0" style={interAgent.selectedInterAgentThread.sourceKind === 'private' ? layout.styles.tagBadge : layout.styles.activePill}>
                      {interAgent.selectedInterAgentThread.sourceKind === 'private' ? 'Private' : 'Relay'}
                    </span>
                  ) : null}
                  {interAgent.selectedInterAgentThread ? (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={layout.styles.tagBadge}>
                      {interAgent.selectedInterAgentThread.messageCount}
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] truncate mt-0.5" style={layout.styles.mutedText}>
                  {interAgent.selectedInterAgentThreadSubtitle}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {interAgent.selectedRelayDirectThread ? (
                <button
                  className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ color: C.ink }}
                  onClick={() => interAgent.onOpenAgentProfile(interAgent.selectedRelayDirectThread!.id)}
                >
                  <Bot size={11} />
                  <span>Agent</span>
                </button>
              ) : null}
              <button
                onClick={() => interAgent.setShowAnnotations(!interAgent.showAnnotations)}
                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                style={interAgent.showAnnotations ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
              >
                Annotations <span className="font-mono uppercase">{interAgent.showAnnotations ? 'On' : 'Off'}</span>
              </button>
              {interAgent.interAgentMessageTarget ? (
                <button
                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ color: C.ink }}
                  onClick={() => interAgent.openAgentDirectMessage(interAgent.interAgentMessageTarget!.id)}
                  title={`Open direct chat with ${interAgent.interAgentMessageTarget.title}`}
                >
                  Message
                </button>
              ) : null}
              {interAgent.interAgentConfigureTarget ? (
                <button
                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ color: C.ink }}
                  onClick={() => interAgent.onOpenAgentSettings(interAgent.interAgentConfigureTarget!.id, interAgent.interAgentConfigureTarget!.profileKind === 'project')}
                  title={interAgent.interAgentConfigureTarget.profileKind === 'project'
                    ? `Configure ${interAgent.interAgentConfigureTarget.title}`
                    : `Open ${interAgent.interAgentConfigureTarget.title} profile`}
                >
                  {interAgent.interAgentConfigureLabel}
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
            {!interAgent.selectedInterAgent ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                  <InterAgentIcon size={24} style={{ color: C.accent }} />
                </div>
                <h3 className="text-[15px] font-medium mb-1" style={layout.styles.inkText}>No agent selected</h3>
                <p className="text-[13px] max-w-sm" style={layout.styles.mutedText}>
                  Choose an agent from the left rail to inspect their traffic with other agents.
                </p>
              </div>
            ) : !interAgent.selectedInterAgentThread ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                  <MessageSquare size={24} style={{ color: C.accent }} />
                </div>
                <h3 className="text-[15px] font-medium mb-1" style={layout.styles.inkText}>No thread selected</h3>
                <p className="text-[13px] max-w-sm" style={layout.styles.mutedText}>
                  Pick one of {interAgent.selectedInterAgent.title}&apos;s agent threads to read it.
                </p>
              </div>
            ) : interAgent.visibleInterAgentMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                  <MessageSquare size={24} style={{ color: C.accent }} />
                </div>
                <h3 className="text-[15px] font-medium mb-1" style={layout.styles.inkText}>Thread is quiet</h3>
                <p className="text-[13px] max-w-sm" style={layout.styles.mutedText}>
                  This agent thread exists, but there are no visible messages in it yet.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <RelayTimeline
                  messages={interAgent.visibleInterAgentMessages}
                  showAnnotations={interAgent.showAnnotations}
                  showStatusMessages={false}
                  inkStyle={layout.styles.inkText}
                  mutedStyle={layout.styles.mutedText}
                  tagStyle={layout.styles.tagBadge}
                  annotStyle={layout.styles.annotBadge}
                  agentLookup={interAgent.interAgentAgentLookup}
                  directThreadLookup={interAgent.relayDirectLookup}
                  onOpenAgentProfile={interAgent.onOpenAgentProfile}
                  onOpenAgentChat={interAgent.openAgentDirectMessage}
                  onNudgeMessage={interAgent.onNudgeMessage}
                />
              </div>
            )}
          </div>

          <div className="h-7 border-t flex items-center px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
            <span className="text-[9px] font-mono" style={layout.styles.mutedText}>Read-only monitor over inter-agent traffic</span>
          </div>
        </div>
      </>
    );
  }

  if (activeView !== 'sessions') {
    return null;
  }

  return (
    <>
      <div className="flex-1 flex flex-col relative min-w-0" style={layout.styles.surface}>
        <div className="h-10 border-b flex items-center justify-between px-4 shrink-0" style={{ ...layout.styles.surface, borderBottomColor: C.border }}>
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="min-w-0 shrink-0">
              <div className="text-[13px] font-semibold tracking-tight" style={layout.styles.inkText}>Sessions</div>
              <div className="text-[10px] font-mono mt-0.5" style={layout.styles.mutedText}>
                {sessions.searchQuery ? `${sessions.filteredSessions.length} results` : `${sessions.stats.totalSessions} total`}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Search size={14} style={layout.styles.mutedText} />
              <input
                type="text"
                placeholder="Search sessions by title, content, tags, or agent..."
                value={sessions.searchQuery}
                onChange={(event) => sessions.setSearchQuery(event.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-[12px]"
                style={{ color: C.ink }}
              />
              {sessions.searchQuery ? (
                <button onClick={() => sessions.setSearchQuery('')} className="hover:opacity-70" style={layout.styles.mutedText}><X size={14} /></button>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="p-1.5 rounded transition-opacity hover:opacity-70" style={layout.styles.mutedText} onClick={sessions.onRefresh}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessions.loadingSessions ? (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3">
                <Spinner className="text-[28px]" style={{ color: C.accent }} />
                <span className="text-[13px]" style={layout.styles.mutedText}>Loading broker workspace…</span>
              </div>
            </div>
          ) : sessions.filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                <FolderOpen size={24} style={{ color: C.accent }} />
              </div>
              <h3 className="text-[15px] font-medium mb-1" style={layout.styles.inkText}>No sessions found</h3>
              <p className="text-[13px] max-w-sm" style={layout.styles.mutedText}>
                {sessions.searchQuery ? 'Try adjusting your search query' : 'No conversations are in the broker yet.'}
              </p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: C.border }}>
              {sessions.filteredSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => sessions.setSelectedSession(session)}
                  draggable
                  onDragStart={() => {
                    sessions.setDraggedSessionId(session.id);
                    sessions.setDraggedPhoneSection(null);
                  }}
                  onDragEnd={() => {
                    sessions.setDraggedSessionId(null);
                    sessions.setDraggedPhoneSection(null);
                  }}
                  className="w-full text-left px-4 py-3 transition-opacity hover:opacity-90"
                  style={sessions.selectedSession?.id === session.id ? { backgroundColor: C.bg } : undefined}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded text-white flex items-center justify-center text-[9px] font-bold"
                        style={{ backgroundColor: colorForIdentity(session.agent) }}
                      >
                        {session.agent.charAt(0)}
                      </div>
                      <span className="text-[13px] font-medium line-clamp-1" style={layout.styles.inkText}>{session.title}</span>
                      {sessions.phonePreparationState.favorites.includes(session.id) ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium" style={{ backgroundColor: C.accentBg, color: C.accent }}>
                          <Star size={9} />
                          Fav
                        </span>
                      ) : null}
                      {!sessions.phonePreparationState.favorites.includes(session.id) && sessions.phonePreparationState.quickHits.includes(session.id) ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium" style={{ backgroundColor: C.tagBg, color: C.ink }}>
                          <Smartphone size={9} />
                          My List
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[10px] font-mono shrink-0 ml-2" style={layout.styles.mutedText}>{sessions.formatDate(session.lastModified)}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1.5 pl-7">
                    <span className="text-[10px] font-mono" style={layout.styles.mutedText}>{session.project}</span>
                    <span className="w-px h-3" style={{ backgroundColor: C.border }} />
                    <span className="text-[10px]" style={layout.styles.mutedText}>{session.messageCount} messages</span>
                    {session.tokens ? (
                      <>
                        <span className="w-px h-3" style={{ backgroundColor: C.border }} />
                        <span className="text-[10px]" style={layout.styles.mutedText}>{(session.tokens / 1000).toFixed(1)}k tokens</span>
                      </>
                    ) : null}
                  </div>
                  <p className="text-[12px] line-clamp-1 pl-7" style={layout.styles.mutedText}>{session.preview}</p>
                  {session.tags && session.tags.length > 0 ? (
                    <div className="flex items-center gap-1.5 mt-2 pl-7">
                      {session.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[9px] font-mono border px-1.5 py-0.5 rounded" style={layout.styles.tagBadge}>{tag}</span>
                      ))}
                      {session.tags.length > 3 ? <span className="text-[9px]" style={layout.styles.mutedText}>+{session.tags.length - 3}</span> : null}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-7 border-t flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
          <span className="text-[9px] font-mono" style={layout.styles.mutedText}>Drag sessions into My List or click one for quick actions.</span>
          <span className="text-[9px] font-mono uppercase tracking-widest" style={layout.styles.mutedText}>Index Ready</span>
        </div>
      </div>

      <div className="w-80 border-l shrink-0 overflow-y-auto flex flex-col" style={{ ...layout.styles.surface, borderLeftColor: C.border }}>
        <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={layout.styles.mutedText}>My List</div>
              <div className="text-[12px] font-medium" style={layout.styles.inkText}>My List first, then browse and search.</div>
            </div>
            <button
              type="button"
              onClick={sessions.onClearPhoneQuickHits}
              disabled={sessions.phonePreparationSaving || sessions.phonePreparationState.quickHits.length === 0}
              className="rounded px-2 py-1 text-[10px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: C.bg, color: C.ink, border: `1px solid ${C.border}` }}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="p-4 flex-1 flex flex-col gap-4">
          {sessions.phonePreparationLoading ? (
            <div className="flex items-center gap-2 text-[12px]" style={layout.styles.mutedText}>
              <Spinner className="text-[12px]" />
              Loading list…
            </div>
          ) : (
            <>
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: C.border, backgroundColor: C.bg }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  sessions.onDropIntoFavorites();
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Star size={12} style={{ color: C.accent }} />
                    <div className="text-[11px] font-semibold" style={layout.styles.inkText}>Favorites</div>
                  </div>
                  <div className="text-[10px] font-mono" style={layout.styles.mutedText}>{sessions.favoritePhoneSessions.length}</div>
                </div>
                {sessions.favoritePhoneSessions.length === 0 ? (
                  <div className="rounded border border-dashed px-3 py-4 text-[11px]" style={{ borderColor: C.border, color: C.muted }}>
                    Drop sessions here to keep them pinned in your list.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {sessions.favoritePhoneSessions.map((session) => (
                      <div
                        key={`favorite-${session.id}`}
                        draggable
                        onDragStart={() => {
                          sessions.setDraggedSessionId(session.id);
                          sessions.setDraggedPhoneSection('favorites');
                        }}
                        onDragEnd={() => {
                          sessions.setDraggedSessionId(null);
                          sessions.setDraggedPhoneSection(null);
                        }}
                        className="rounded border px-3 py-2"
                        style={{ borderColor: C.border, backgroundColor: C.surface }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium line-clamp-1" style={layout.styles.inkText}>{session.title}</div>
                            <div className="text-[10px] mt-1" style={layout.styles.mutedText}>{session.project} · {sessions.formatDate(session.lastModified)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => sessions.onRemoveSessionFromPhoneSection(session.id, 'favorites')}
                            className="text-[10px] hover:opacity-70"
                            style={layout.styles.mutedText}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div
                className="rounded-lg border p-3"
                style={{ borderColor: C.border, backgroundColor: C.bg }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  sessions.onDropIntoQuickHits();
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <List size={12} style={{ color: C.accent }} />
                    <div className="text-[11px] font-semibold" style={layout.styles.inkText}>My List</div>
                  </div>
                  <div className="text-[10px] font-mono" style={layout.styles.mutedText}>{sessions.quickHitPhoneSessions.length}</div>
                </div>
                {sessions.quickHitPhoneSessions.length === 0 ? (
                  <div className="rounded border border-dashed px-3 py-4 text-[11px]" style={{ borderColor: C.border, color: C.muted }}>
                    Drag sessions here and order them however you want.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {sessions.quickHitPhoneSessions.map((session, index) => (
                      <div
                        key={`quick-hit-${session.id}`}
                        draggable
                        onDragStart={() => {
                          sessions.setDraggedSessionId(session.id);
                          sessions.setDraggedPhoneSection('quickHits');
                        }}
                        onDragEnd={() => {
                          sessions.setDraggedSessionId(null);
                          sessions.setDraggedPhoneSection(null);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          sessions.onDropIntoQuickHits(index);
                        }}
                        className="rounded border px-3 py-2"
                        style={{ borderColor: C.border, backgroundColor: C.surface }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[11px] font-mono mb-1" style={layout.styles.mutedText}>#{index + 1}</div>
                            <div className="text-[12px] font-medium line-clamp-1" style={layout.styles.inkText}>{session.title}</div>
                            <div className="text-[10px] mt-1" style={layout.styles.mutedText}>{session.project} · {sessions.formatDate(session.lastModified)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => sessions.onRemoveSessionFromPhoneSection(session.id, 'quickHits')}
                            className="text-[10px] hover:opacity-70"
                            style={layout.styles.mutedText}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {sessions.phonePreparationFeedback ? (
                <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: C.border, backgroundColor: C.surface, color: C.ink }}>
                  {sessions.phonePreparationFeedback}
                </div>
              ) : null}

              <div className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={layout.styles.mutedText}>Selected Session</div>
                {sessions.selectedSession ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-8 h-8 rounded text-white flex items-center justify-center text-[12px] font-bold"
                        style={{ backgroundColor: colorForIdentity(sessions.selectedSession.agent) }}
                      >
                        {sessions.selectedSession.agent.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium line-clamp-1" style={layout.styles.inkText}>{sessions.selectedSession.title}</div>
                        <div className="text-[10px]" style={layout.styles.mutedText}>{sessions.selectedSession.project} · {sessions.selectedSession.messageCount} messages</div>
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed mb-3" style={layout.styles.mutedText}>{sessions.selectedSession.preview}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => sessions.onAddSessionToPhoneSection(sessions.selectedSession!.id, 'favorites')}
                        disabled={sessions.phonePreparationSaving || sessions.phonePreparationState.favorites.includes(sessions.selectedSession.id)}
                        className="flex-1 rounded px-3 py-2 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ backgroundColor: C.accentBg, color: C.accent }}
                      >
                        {sessions.phonePreparationState.favorites.includes(sessions.selectedSession.id) ? 'Pinned' : 'Add to Favorites'}
                      </button>
                      <button
                        type="button"
                        onClick={() => sessions.onAddSessionToPhoneSection(sessions.selectedSession!.id, 'quickHits')}
                        disabled={sessions.phonePreparationSaving || sessions.phonePreparationState.quickHits.includes(sessions.selectedSession.id) || sessions.phonePreparationState.favorites.includes(sessions.selectedSession.id)}
                        className="flex-1 rounded px-3 py-2 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ backgroundColor: C.surface, color: C.ink, border: `1px solid ${C.border}` }}
                      >
                        {sessions.phonePreparationState.quickHits.includes(sessions.selectedSession.id) || sessions.phonePreparationState.favorites.includes(sessions.selectedSession.id)
                          ? 'Already Added'
                          : 'Add to My List'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-[11px]" style={layout.styles.mutedText}>
                    Select a session to pin it or add it to My List.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
