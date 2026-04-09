import React from 'react';

import { colorForIdentity } from '@web/features/messages/lib/relay-utils';
import type { AppView, MessagesDetailTab } from '@/app-types';
import type { AgentViewsProps } from '@/components/views/agent-views';
import type { OpsViewsProps } from '@/components/views/ops-views';
import type { OverviewInboxActivityViewProps } from '@/components/views/overview-inbox-activity-view';
import { useAgentController } from '@/hooks/use-agent-controller';
import { useDiagnosticsController } from '@/hooks/use-diagnostics-controller';
import { usePhonePreparationController } from '@/hooks/use-phone-preparation-controller';
import type { DesktopFeatureFlags } from '@/lib/scout-desktop';
import type { MessagesRelayViewProps } from '@web/features/messages/components/messages-relay-view';
import { useMessagesController } from '@web/features/messages/hooks/use-messages-controller';

type OverviewViewProps = OverviewInboxActivityViewProps['overviewViewProps'];
type AgentViewLayoutStyles = AgentViewsProps['layout']['styles'];
type SearchViewStyles = OpsViewsProps['search']['styles'];

interface RelaySurfaceStyles extends AgentViewLayoutStyles {
  kbd: SearchViewStyles['kbd'];
}

type UseRelaySurfaceViewPropsInput = {
  activeView: AppView;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  desktopFeatures: DesktopFeatureFlags;
  styles: RelaySurfaceStyles;
  colorTheme: OverviewViewProps['C'];
  sidebarWidth: number;
  messagesDetailWidth: number;
  isCollapsed: boolean;
  onResizeStart: (event: React.MouseEvent<Element>) => void;
  onMessagesDetailResizeStart: MessagesRelayViewProps['layout']['onMessagesDetailResizeStart'];
  stats: {
    totalSessions: number;
    totalMessages: number;
  };
  runtime: OverviewInboxActivityViewProps['activity']['runtime'];
  shellState: unknown;
  shellError: OverviewViewProps['shellError'];
  plansState: OverviewInboxActivityViewProps['activity']['plansState'];
  machinesState: OverviewInboxActivityViewProps['activity']['machinesState'];
  messagesState: MessagesRelayViewProps['threading']['messagesState'];
  interAgentState: {
    title: string;
    subtitle: string;
  } | null;
  interAgentAgents: MessagesRelayViewProps['threading']['interAgentAgents'];
  interAgentAgentLookup: MessagesRelayViewProps['threading']['interAgentAgentLookup'];
  relayDirectLookup: MessagesRelayViewProps['threading']['relayDirectLookup'];
  homeAgents: OverviewViewProps['homeAgents'];
  homeActivity: OverviewViewProps['activity'];
  activityRecentMessages: OverviewInboxActivityViewProps['activity']['activityRecentMessages'];
  activityTasks: OverviewInboxActivityViewProps['activity']['activityTasks'];
  activityLeadTask: OverviewInboxActivityViewProps['activity']['activityLeadTask'];
  activityFindings: OverviewInboxActivityViewProps['activity']['activityFindings'];
  activityEndpoints: OverviewInboxActivityViewProps['activity']['activityEndpoints'];
  overviewSessions: OverviewInboxActivityViewProps['activity']['overviewSessions'];
  inboxAlertCount: OverviewInboxActivityViewProps['inbox']['inboxAlertCount'];
  pendingApprovalsCount: OverviewInboxActivityViewProps['inbox']['pendingApprovalsCount'];
  inboxFailedTaskCount: OverviewInboxActivityViewProps['inbox']['inboxFailedTaskCount'];
  inboxAwaitingYouItems: OverviewInboxActivityViewProps['inbox']['inboxAwaitingYouItems'];
  availableAgentNames: OpsViewsProps['search']['availableAgentNames'];
  searchQuery: OpsViewsProps['search']['searchQuery'];
  setSearchQuery: OpsViewsProps['search']['setSearchQuery'];
  filteredSessions: OpsViewsProps['search']['filteredSessions'];
  selectedSession: MessagesRelayViewProps['threading']['selectedSession'];
  setSelectedSession: MessagesRelayViewProps['threading']['setSelectedSession'];
  isLoadingShell: boolean;
  showAnnotations: MessagesRelayViewProps['threading']['showAnnotations'];
  setShowAnnotations: MessagesRelayViewProps['threading']['setShowAnnotations'];
  messagesDetailOpen: MessagesRelayViewProps['threading']['messagesDetailOpen'];
  setMessagesDetailOpen: MessagesRelayViewProps['threading']['setMessagesDetailOpen'];
  messagesDetailTab: MessagesDetailTab;
  setMessagesDetailTab: MessagesRelayViewProps['threading']['setMessagesDetailTab'];
  formatDate: OverviewInboxActivityViewProps['activity']['formatDate'];
  onRefreshShell: () => void;
  openAgentProfile: OverviewViewProps['onOpenAgent'];
  openSessionDetail: OverviewInboxActivityViewProps['activity']['onOpenSessionDetail'];
  handleSelectSearchSession: OpsViewsProps['search']['onOpenSession'];
  handleToggleVoiceCapture: MessagesRelayViewProps['composer']['onToggleVoiceCapture'];
  handleSetVoiceRepliesEnabled: (enabled: boolean) => void;
  selectMessageThread: MessagesRelayViewProps['threading']['onSelectMessageThread'];
  renderLocalPathValue: AgentViewsProps['agents']['renderLocalPathValue'];
  selectedInterAgentActivityMessages: AgentViewsProps['agents']['selectedInterAgentActivityMessages'];
  selectedInterAgentInboundTasks: AgentViewsProps['agents']['selectedInterAgentInboundTasks'];
  selectedInterAgentOutboundFindings: AgentViewsProps['agents']['selectedInterAgentOutboundFindings'];
  selectedInterAgentFindings: AgentViewsProps['agents']['selectedInterAgentFindings'];
  interAgentThreadTitle: AgentViewsProps['interAgent']['interAgentThreadTitle'];
  selectedInterAgentThreadSubtitle: AgentViewsProps['interAgent']['selectedInterAgentThreadSubtitle'];
  interAgentConfigureTarget: AgentViewsProps['interAgent']['interAgentConfigureTarget'];
  interAgentConfigureLabel: AgentViewsProps['interAgent']['interAgentConfigureLabel'];
  interAgentMessageTarget: AgentViewsProps['interAgent']['interAgentMessageTarget'];
  visibleInterAgentMessages: AgentViewsProps['interAgent']['visibleInterAgentMessages'];
  relayVoiceState: MessagesRelayViewProps['composer']['relayVoiceState'];
  messagesController: ReturnType<typeof useMessagesController>;
  agentController: ReturnType<typeof useAgentController>;
  diagnosticsController: ReturnType<typeof useDiagnosticsController>;
  phonePreparationController: ReturnType<typeof usePhonePreparationController>;
  overviewBootLoader: React.ReactNode;
};

export function useRelaySurfaceViewProps({
  activeView,
  setActiveView,
  desktopFeatures,
  styles,
  colorTheme,
  sidebarWidth,
  messagesDetailWidth,
  isCollapsed,
  onResizeStart,
  onMessagesDetailResizeStart,
  stats,
  runtime,
  shellState,
  shellError,
  plansState,
  machinesState,
  messagesState,
  interAgentState,
  interAgentAgents,
  interAgentAgentLookup,
  relayDirectLookup,
  homeAgents,
  homeActivity,
  activityRecentMessages,
  activityTasks,
  activityLeadTask,
  activityFindings,
  activityEndpoints,
  overviewSessions,
  inboxAlertCount,
  pendingApprovalsCount,
  inboxFailedTaskCount,
  inboxAwaitingYouItems,
  availableAgentNames,
  searchQuery,
  setSearchQuery,
  filteredSessions,
  selectedSession,
  setSelectedSession,
  isLoadingShell,
  showAnnotations,
  setShowAnnotations,
  messagesDetailOpen,
  setMessagesDetailOpen,
  messagesDetailTab,
  setMessagesDetailTab,
  formatDate,
  onRefreshShell,
  openAgentProfile,
  openSessionDetail,
  handleSelectSearchSession,
  handleToggleVoiceCapture,
  handleSetVoiceRepliesEnabled,
  selectMessageThread,
  renderLocalPathValue,
  selectedInterAgentActivityMessages,
  selectedInterAgentInboundTasks,
  selectedInterAgentOutboundFindings,
  selectedInterAgentFindings,
  interAgentThreadTitle,
  selectedInterAgentThreadSubtitle,
  interAgentConfigureTarget,
  interAgentConfigureLabel,
  interAgentMessageTarget,
  visibleInterAgentMessages,
  relayVoiceState,
  messagesController,
  agentController,
  diagnosticsController,
  phonePreparationController,
  overviewBootLoader,
}: UseRelaySurfaceViewPropsInput) {
  const sidebarSurfaceStyles = {
    sidebar: styles.sidebar,
    surface: styles.surface,
    inkText: styles.inkText,
    mutedText: styles.mutedText,
    tagBadge: styles.tagBadge,
    activePill: styles.activePill,
  };

  return {
    overviewInboxActivityViewProps: {
      activeView,
      overviewViewProps: {
        C: colorTheme,
        s: styles,
        bootLoader: overviewBootLoader,
        homeAgents,
        activity: homeActivity,
        shellError,
        onRefresh: onRefreshShell,
        onOpenAgent: openAgentProfile,
        onSelectRelay: messagesController.openConversation,
        colorForIdentity,
      },
      inbox: {
        isCollapsed,
        sidebarWidth,
        onResizeStart,
        styles: sidebarSurfaceStyles,
        inboxAlertCount,
        pendingApprovalsCount,
        inboxFailedTaskCount,
        inboxAwaitingYouItems,
      },
      activity: {
        isCollapsed,
        sidebarWidth,
        onResizeStart,
        styles: sidebarSurfaceStyles,
        plansState,
        machinesState,
        runtime,
        activityLeadTask,
        activityTasks,
        activityFindings,
        activityEndpoints,
        activityRecentMessages,
        interAgentAgentLookup,
        overviewSessions,
        formatDate,
        onRefresh: onRefreshShell,
        onOpenPlans: () => setActiveView('plans'),
        onOpenMessages: () => setActiveView('messages'),
        onOpenAgentProfile: openAgentProfile,
        onOpenSessionDetail: openSessionDetail,
      },
    } satisfies OverviewInboxActivityViewProps,
    opsViewsProps: {
      activeView,
      machinesViewProps: {
        machinesState: machinesState ?? {
          title: 'Machines',
          subtitle: 'Broker unavailable',
          totalMachines: 0,
          onlineCount: 0,
          degradedCount: 0,
          offlineCount: 0,
          lastUpdatedLabel: null,
          machines: [],
        },
        C: colorTheme,
        s: styles,
        isCollapsed,
        sidebarWidth,
        onResizeStart,
        onOpenRelayAgent: messagesController.openDirectConversation,
        onRefresh: onRefreshShell,
        identityColor: colorForIdentity,
      },
      plansViewProps: {
        plansState: plansState ?? {
          title: 'Plans',
          subtitle: 'No broker snapshot yet',
          taskCount: 0,
          runningTaskCount: 0,
          failedTaskCount: 0,
          completedTaskCount: 0,
          findingCount: 0,
          warningCount: 0,
          errorCount: 0,
          planCount: 0,
          workspaceCount: 0,
          lastUpdatedLabel: null,
          tasks: [],
          findings: [],
          plans: [],
        },
        C: colorTheme,
        s: styles,
        isCollapsed,
        sidebarWidth,
        onResizeStart,
        onOpenRelayAgent: messagesController.openDirectConversation,
        onRefresh: onRefreshShell,
        identityColor: colorForIdentity,
      },
      search: {
        isCollapsed,
        sidebarWidth,
        onResizeStart,
        styles: {
          sidebar: styles.sidebar,
          surface: styles.surface,
          inkText: styles.inkText,
          mutedText: styles.mutedText,
          tagBadge: styles.tagBadge,
          activeItem: styles.activeItem,
          kbd: styles.kbd,
        },
        availableAgentNames,
        searchQuery,
        setSearchQuery,
        filteredSessions,
        stats: {
          totalSessions: stats.totalSessions,
          totalMessages: stats.totalMessages,
        },
        formatDate,
        onOpenSession: handleSelectSearchSession,
      },
    } satisfies OpsViewsProps,
    agentViewsProps: {
      activeView,
      layout: {
        isCollapsed,
        sidebarWidth,
        onResizeStart,
        styles: {
          sidebar: styles.sidebar,
          surface: styles.surface,
          inkText: styles.inkText,
          mutedText: styles.mutedText,
          tagBadge: styles.tagBadge,
          activePill: styles.activePill,
          activeItem: styles.activeItem,
          annotBadge: styles.annotBadge,
        },
      },
      roster: {
        interAgentStateTitle: interAgentState?.title ?? 'Inter-Agent',
        interAgentStateSubtitle: interAgentState?.subtitle ?? 'Agent-to-agent traffic',
        rosterInterAgentAgents: agentController.rosterInterAgentAgents,
        interAgentAgents,
        selectedInterAgentId: agentController.selectedInterAgentId,
        onSelectInterAgent: agentController.handleSelectInterAgent,
        agentRosterMenu: agentController.agentRosterMenu,
        setAgentRosterMenu: agentController.setAgentRosterMenu,
        agentRosterFilter: agentController.agentRosterFilter,
        setAgentRosterFilter: agentController.setAgentRosterFilter,
        agentRosterSort: agentController.agentRosterSort,
        setAgentRosterSort: agentController.setAgentRosterSort,
        rosterAgentTitleCounts: agentController.rosterAgentTitleCounts,
        onRefresh: onRefreshShell,
      },
      agents: {
        selectedInterAgent: agentController.selectedInterAgent,
        selectedInterAgentDirectThread: agentController.selectedInterAgentDirectThread,
        selectedInterAgentChatActionLabel: agentController.selectedInterAgentChatActionLabel,
        onOpenAgentThread: messagesController.openDirectConversation,
        onPeekAgentSession: agentController.handlePeekAgentSession,
        onOpenAgentSettings: agentController.handleOpenAgentSettings,
        visibleAgentSession: agentController.visibleAgentSession,
        agentSessionPending: agentController.agentSessionPending,
        agentSessionLoading: agentController.agentSessionLoading,
        agentSessionFeedback: agentController.agentSessionFeedback,
        agentSessionCopied: agentController.agentSessionCopied,
        onCopyAgentSessionCommand: () => void agentController.handleCopyAgentSessionCommand(),
        onOpenAgentSession: () => void agentController.handleOpenAgentSession(),
        agentSessionLogsExpanded: agentController.agentSessionLogsExpanded,
        setAgentSessionLogsExpanded: agentController.setAgentSessionLogsExpanded,
        agentSessionInlineViewportRef: agentController.agentSessionInlineViewportRef,
        onInlineAgentSessionScroll: agentController.handleInlineAgentSessionScroll,
        renderLocalPathValue,
        selectedInterAgentActivityMessages,
        interAgentAgentLookup,
        relayDirectLookup,
        onOpenAgentProfile: openAgentProfile,
        onNudgeMessage: messagesController.nudgeMessage,
        selectedInterAgentInboundTasks,
        selectedInterAgentOutboundFindings,
        selectedInterAgentFindings,
        agentActivityExpanded: agentController.agentActivityExpanded,
        setAgentActivityExpanded: agentController.setAgentActivityExpanded,
        agentThreadsExpanded: agentController.agentThreadsExpanded,
        setAgentThreadsExpanded: agentController.setAgentThreadsExpanded,
        visibleInterAgentThreads: agentController.visibleInterAgentThreads,
        selectedInterAgentThreadId: agentController.selectedInterAgentThreadId,
        onOpenThreadInTrafficView: (threadId) => {
          agentController.setSelectedInterAgentThreadId(threadId);
          setActiveView('inter-agent');
        },
        selectedAgentDirectLinePreview: agentController.selectedAgentDirectLinePreview,
        agentSnapshotExpanded: agentController.agentSnapshotExpanded,
        setAgentSnapshotExpanded: agentController.setAgentSnapshotExpanded,
        visibleAgentConfig: agentController.visibleAgentConfig,
      },
      logs: {
        logSources: diagnosticsController.logSources,
        filteredLogSources: diagnosticsController.filteredLogSources,
        selectedLogSourceId: diagnosticsController.selectedLogSourceId,
        setSelectedLogSourceId: diagnosticsController.setSelectedLogSourceId,
        selectedLogSource: diagnosticsController.selectedLogSource,
        logCatalog: diagnosticsController.logCatalog,
        logContent: diagnosticsController.logContent,
        logsLoading: diagnosticsController.logsLoading,
        logsFeedback: diagnosticsController.logsFeedback,
        logSearchQuery: diagnosticsController.logSearchQuery,
        setLogSearchQuery: diagnosticsController.setLogSearchQuery,
        logSourceQuery: diagnosticsController.logSourceQuery,
        setLogSourceQuery: diagnosticsController.setLogSourceQuery,
      },
      interAgent: {
        selectedInterAgent: agentController.selectedInterAgent,
        visibleInterAgentThreads: agentController.visibleInterAgentThreads,
        selectedInterAgentThreadId: agentController.selectedInterAgentThreadId,
        setSelectedInterAgentThreadId: agentController.setSelectedInterAgentThreadId,
        interAgentThreadTitle,
        selectedInterAgentThread: agentController.selectedInterAgentThread,
        selectedInterAgentThreadSubtitle,
        selectedRelayDirectThread: messagesController.selectedDirectConversation,
        showAnnotations,
        setShowAnnotations,
        interAgentMessageTarget,
        openAgentDirectMessage: messagesController.openAgentDirectMessage,
        interAgentConfigureTarget,
        onOpenAgentSettings: agentController.handleOpenAgentSettings,
        interAgentConfigureLabel,
        visibleInterAgentMessages,
        interAgentAgentLookup,
        relayDirectLookup,
        onOpenAgentProfile: openAgentProfile,
        onNudgeMessage: messagesController.nudgeMessage,
      },
      sessions: {
        searchQuery,
        setSearchQuery,
        filteredSessions,
        stats: {
          totalSessions: stats.totalSessions,
        },
        onRefresh: onRefreshShell,
        loadingSessions: isLoadingShell && !shellState,
        selectedSession,
        setSelectedSession,
        phonePreparationState: phonePreparationController.phonePreparationState,
        phonePreparationLoading: phonePreparationController.phonePreparationLoading,
        phonePreparationSaving: phonePreparationController.phonePreparationSaving,
        phonePreparationFeedback: phonePreparationController.phonePreparationFeedback,
        setDraggedSessionId: phonePreparationController.setDraggedSessionId,
        setDraggedPhoneSection: phonePreparationController.setDraggedPhoneSection,
        favoritePhoneSessions: phonePreparationController.favoritePhoneSessions,
        quickHitPhoneSessions: phonePreparationController.quickHitPhoneSessions,
        formatDate,
        onClearPhoneQuickHits: phonePreparationController.handleClearPhoneQuickHits,
        onDropIntoFavorites: phonePreparationController.handleDropIntoFavorites,
        onDropIntoQuickHits: phonePreparationController.handleDropIntoQuickHits,
        onRemoveSessionFromPhoneSection: phonePreparationController.handleRemoveSessionFromPhoneSection,
        onAddSessionToPhoneSection: phonePreparationController.handleAddSessionToPhoneSection,
      },
    } satisfies AgentViewsProps,
    messagesRelayViewProps: {
      activeView,
      layout: {
        sidebarWidth,
        messagesDetailWidth,
        isCollapsed,
        onResizeStart,
        onMessagesDetailResizeStart,
        styles: {
          sidebar: styles.sidebar,
          surface: styles.surface,
          inkText: styles.inkText,
          mutedText: styles.mutedText,
          tagBadge: styles.tagBadge,
          annotBadge: styles.annotBadge,
          activeItem: styles.activeItem,
          activePill: styles.activePill,
          kbd: styles.kbd,
        },
      },
      threading: {
        messagesState,
        messageThreads: messagesController.messageThreads,
        selectedMessagesThread: messagesController.selectedMessagesThread,
        onSelectMessageThread: selectMessageThread,
        showAnnotations,
        setShowAnnotations,
        onRefresh: onRefreshShell,
        selectedMessagesInternalThread: messagesController.selectedMessagesInternalThread,
        selectedMessagesInternalMessages: messagesController.selectedMessagesInternalMessages,
        selectedMessagesInternalTarget: messagesController.selectedMessagesInternalTarget,
        selectedMessagesDetailAgentId: messagesController.selectedMessagesDetailAgentId,
        selectedMessagesDetailAgent: messagesController.selectedMessagesDetailAgent,
        selectedMessagesSessions: messagesController.selectedMessagesSessions,
        selectedSession,
        setSelectedSession,
        formatDate,
        interAgentAgents,
        interAgentAgentLookup,
        relayDirectLookup,
        openAgentProfile,
        openAgentDirectMessage: messagesController.openAgentDirectMessage,
        onNudgeMessage: messagesController.nudgeMessage,
        messagesDetailOpen,
        setMessagesDetailOpen,
        messagesDetailTab,
        setMessagesDetailTab,
      },
      composer: {
        selectedRelayKind: messagesController.selectedConversationKind,
        selectedRelayId: messagesController.selectedConversationId,
        relayThreadTitle: messagesController.currentConversationTitle,
        relayThreadSubtitle: messagesController.currentConversationSubtitle,
        relayThreadCount: messagesController.currentConversationCount,
        selectedRelayDirectThread: messagesController.selectedDirectConversation,
        relayVoiceState,
        visibleRelayMessages: messagesController.visibleConversationMessages,
        relayTimelineViewportRef: messagesController.timelineViewportRef,
        onRelayTimelineScroll: messagesController.handleConversationTimelineScroll,
        relayReplyTarget: messagesController.replyTarget,
        setRelayReplyTarget: messagesController.setReplyTarget,
        relayContextReferences: messagesController.contextReferences,
        relayContextMessageIds: messagesController.contextMessageIds,
        setRelayContextMessageIds: messagesController.setContextMessageIds,
        relayComposerRef: messagesController.composerRef,
        relayDraft: messagesController.composerDraft,
        setRelayDraft: messagesController.setComposerDraft,
        relaySending: messagesController.composerSending,
        relayFeedback: messagesController.messagesFeedback,
        relayComposerSelectionStart: messagesController.composerSelectionStart,
        setRelayComposerSelectionStart: messagesController.setComposerSelectionStart,
        mergedRelayMessages: messagesController.mergedConversationMessages,
        relayMentionMenuOpen: messagesController.mentionMenuOpen,
        relayMentionSuggestions: messagesController.mentionSuggestions,
        relayMentionSelectionIndex: messagesController.mentionSelectionIndex,
        setRelayMentionSelectionIndex: messagesController.setMentionSelectionIndex,
        relayMentionDuplicateTitleCounts: messagesController.mentionDuplicateTitleCounts,
        applyRelayMentionSuggestion: messagesController.applyMentionSuggestion,
        onRelaySend: () => void messagesController.sendMessage(),
        onToggleVoiceCapture: handleToggleVoiceCapture,
        onSetVoiceRepliesEnabled: (enabled) => void handleSetVoiceRepliesEnabled(enabled),
      },
      agentSession: {
        visibleAgentSession: agentController.visibleAgentSession,
        agentSessionPending: agentController.agentSessionPending,
        agentSessionFeedback: agentController.agentSessionFeedback,
        agentSessionCopied: agentController.agentSessionCopied,
        onCopyAgentSessionCommand: () => void agentController.handleCopyAgentSessionCommand(),
        onOpenAgentSession: () => void agentController.handleOpenAgentSession(),
        onPeekAgentSession: agentController.handlePeekAgentSession,
        onOpenAgentSettings: agentController.handleOpenAgentSettings,
        desktopVoiceEnabled: desktopFeatures.voice,
      },
    } satisfies MessagesRelayViewProps,
  };
}
