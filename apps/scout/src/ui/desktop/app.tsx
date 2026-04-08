"use client";

import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ArrowUpDown,
  Bell,
  Bot,
  Check,
  CornerUpLeft,
  Database,
  Filter,
  LayoutGrid,
  FileText,
  Network,
  ExternalLink,
  Key,
  Palette,
  MessageSquare,
  User,
  Server,
  Settings,
  Shield,
  Hash,
  RefreshCw,
  Search,
  Radar,
  Terminal,
  X,
  FolderOpen,
  Clock,
  ChevronRight,
  Tag,
  Calendar,
  Folder,
  Radio,
  AtSign,
  MoreHorizontal,
  Mic,
  Reply,
  Smartphone,
  Star,
  Eye,
  GitBranch,
  List,
} from 'lucide-react';
import {
  describePairingSurfaceBadge,
} from "@/components/pairing-surface-placeholder";
import {
  AgentActionButton,
  InterAgentIcon,
  RelayTimeline,
} from "@/components/relay/relay-timeline";
import {
  agentRosterFilterLabel,
  agentRosterSecondaryText,
  agentRosterSortLabel,
  asErrorMessage,
  cleanDisplayTitle,
  compactHomePath,
  formatFooterTime,
  interAgentCounterparts,
  interAgentThreadSubtitle,
  interAgentThreadTitleForAgent,
  messagePreviewSnippet,
  colorForIdentity,
  relayPresenceDotClass,
} from "@/components/relay/relay-utils";
import { DesktopAppShellView } from "@/components/views/desktop-app-shell-view";
import { OverviewInboxActivityView } from "@/components/views/overview-inbox-activity-view";
import { OpsViews } from "@/components/views/ops-views";
import { SettingsHelpView } from "@/components/views/settings-help-view";
import { OnboardingCommandShell, StartupOnboardingStepContent } from "@/components/views/startup-onboarding-view";
import { AgentViews } from "@/components/views/agent-views";
import { MessagesRelayView, type MessagesRelayComposerProps } from "@/components/views/messages-relay-view";
import { StartupSplashOverlay } from "@/components/startup-splash";
import { BootLoader } from "@/components/boot-loader";
import { getScoutDesktop } from "@/lib/electron";
import { cn } from "@/lib/utils";
import { useAgentController } from "@/hooks/use-agent-controller";
import { useDiagnosticsController } from "@/hooks/use-diagnostics-controller";
import { useMessagesController } from "@/hooks/use-messages-controller";
import { usePairingController } from "@/hooks/use-pairing-controller";
import { usePhonePreparationController } from "@/hooks/use-phone-preparation-controller";
import { useSettingsHelpViewProps } from "@/hooks/use-settings-help-view-props";
import { useSettingsController } from "@/hooks/use-settings-controller";
import {
  parseSettingsPath,
  type SettingsSectionId,
} from "@/settings/settings-paths";
import { C } from "@/lib/theme";
import {
  type AppView,
  type InboxItem,
  type InboxItemTone,
  type MessagesDetailTab,
  type NavViewItem,
  type ProductSurface,
  type SettingsSectionMeta,
} from "@/app-types";
import {
  buildDesktopPath,
  parseRelayViewPath,
} from "@/app-routing";
import type {
  DesktopFeatureFlags,
  DesktopShellState,
  MessagesThread,
  OnboardingCommandName,
  OnboardingCommandResult,
  RelayDirectThread,
  RelayNavItem,
  SessionMetadata,
  DesktopAppInfo,
} from "@/lib/scout-desktop";
const DEFAULT_DESKTOP_FEATURES: DesktopFeatureFlags = {
  enableAll: false,
  overview: true,
  inbox: true,
  relay: true,
  pairing: true,
  interAgent: true,
  agents: true,
  settings: true,
  logs: true,
  activity: false,
  machines: false,
  plans: false,
  sessions: true,
  search: true,
  phonePreparation: false,
  telegram: false,
  voice: false,
  monitor: false,
};

const AVAILABLE_AGENT_HARNESSES = ['claude', 'codex'] as const;

export default function App() {
    const scoutDesktop = getScoutDesktop();
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [messagesDetailWidth, setMessagesDetailWidth] = useState(340);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [productSurface, setProductSurface] = useState<ProductSurface>('relay');
  const [activeView, setActiveView] = useState<AppView>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionMetadata | null>(null);
  const [messagesDetailOpen, setMessagesDetailOpen] = useState(true);
  const [messagesDetailTab, setMessagesDetailTab] = useState<MessagesDetailTab>('overview');
  const [scoutAppInfo, setScoutAppInfo] = useState<DesktopAppInfo | null>(null);
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [isLoadingShell, setIsLoadingShell] = useState(true);
  const [shellError, setShellError] = useState<string | null>(null);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [appReloadPending, setAppReloadPending] = useState(false);
  const [startupSplashDismissed, setStartupSplashDismissed] = useState(false);
  const dismissStartupSplash = React.useCallback(() => {
    setStartupSplashDismissed(true);
  }, []);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('profile');
  const navigate = useNavigate();
  const location = useLocation();

  /** Deep links and browser navigation: /settings/* → in-app settings view. */
  useLayoutEffect(() => {
    if (!location.pathname.startsWith("/settings")) {
      return;
    }
    const section = parseSettingsPath(location.pathname);
    if (section) {
      setProductSurface("relay");
      setActiveView("settings");
      setSettingsSection(section);
      return;
    }
    navigate("/settings/profile", { replace: true });
  }, [location.pathname, navigate]);

  useLayoutEffect(() => {
    if (location.pathname.startsWith('/settings')) {
      return;
    }

    if (location.pathname === '/pairing') {
      setProductSurface('pairing');
      setActiveView((current) => current === 'settings' ? 'overview' : current);
      return;
    }

    const relayView = parseRelayViewPath(location.pathname);
    if (relayView) {
      setProductSurface('relay');
      setActiveView(relayView);
      return;
    }

    navigate('/', { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => {
    const nextPath = buildDesktopPath(productSurface, activeView, settingsSection);
    if (location.pathname === nextPath) {
      return;
    }

    navigate(nextPath, { replace: true });
  }, [activeView, location.pathname, navigate, productSurface, settingsSection]);

  const openKnowledgeBase = React.useCallback(() => {
    setProductSurface('relay');
    setActiveView('help');
    setAppSettingsFeedback(null);
  }, []);
  const [pendingBrokerInspectorFocus, setPendingBrokerInspectorFocus] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [dark, setDark] = useState(false);
  const activeResizeTarget = useRef<"left-sidebar" | "right-sidebar" | null>(null);
  const settingsOperatorNameRef = useRef<HTMLInputElement | null>(null);
  const relayServiceInspectorRef = useRef<HTMLElement | null>(null);
  const shellStateLoadInFlightRef = useRef(false);

  const sessions = shellState?.sessions ?? [];
  const machinesState = shellState?.machines ?? null;
  const plansState = shellState?.plans ?? null;
  const messagesState = shellState?.messages ?? null;
  const runtime = shellState?.runtime ?? null;
  const relayState = shellState?.relay ?? null;
  const interAgentState = shellState?.interAgent ?? null;
  const interAgentAgents = interAgentState?.agents ?? [];
  const interAgentThreads = interAgentState?.threads ?? [];
  const desktopFeatures = scoutAppInfo?.features ?? shellState?.appInfo.features ?? DEFAULT_DESKTOP_FEATURES;
  const surfaceCaps = scoutAppInfo?.capabilities ?? shellState?.appInfo.capabilities;
  const loadShellState = React.useCallback(async (withSpinner = false) => {
    if (!scoutDesktop?.getShellState) {
      setShellError('Electron desktop bridge is unavailable.');
      setIsLoadingShell(false);
      return null;
    }

    if (shellStateLoadInFlightRef.current) {
      return null;
    }

    if (withSpinner) {
      setIsLoadingShell(true);
    }

    shellStateLoadInFlightRef.current = true;
    try {
      const nextState = await scoutDesktop.getShellState();
      setShellState(nextState);
      setShellError(null);
      return nextState;
    } catch (error) {
      setShellError(asErrorMessage(error));
      return null;
    } finally {
      shellStateLoadInFlightRef.current = false;
      setIsLoadingShell(false);
    }
  }, [scoutDesktop]);

  useEffect(() => {
    if (!scoutDesktop?.getAppInfo) {
      return;
    }

    let cancelled = false;
    const loadScoutAppInfo = async () => {
      try {
        const nextInfo = await scoutDesktop.getAppInfo();
        if (!cancelled) {
          setScoutAppInfo(nextInfo);
        }
      } catch {
        if (!cancelled) {
          setScoutAppInfo(null);
        }
      }
    };

    void loadScoutAppInfo();
    return () => {
      cancelled = true;
    };
  }, [scoutDesktop]);

  useEffect(() => {
    if (!scoutDesktop?.onOpenKnowledgeBase) {
      return;
    }

    return scoutDesktop.onOpenKnowledgeBase(openKnowledgeBase);
  }, [openKnowledgeBase, scoutDesktop]);

  const completeOnboardingIntoRelay = React.useCallback((nextShellState: DesktopShellState | null) => {
    setProductSurface('relay');
    if (nextShellState?.runtime?.brokerReachable) {
      setActiveView('messages');
      setSelectedConversationKind('channel');
      setSelectedConversationId('shared');
      setMessagesFeedback('Relay is running.');
      setAppSettingsFeedback(null);
      return;
    }

    setActiveView('settings');
    setSettingsSection('communication');
    setPendingBrokerInspectorFocus(true);
    setAppSettingsFeedback('Relay is not running yet. Finish onboarding by starting the broker from Communication.');
  }, []);

  const settingsController = useSettingsController({
    activeView,
    settingsSection,
    scoutDesktop,
    shellState,
    surfaceCaps,
    completeOnboardingIntoRelay,
    loadShellState,
  });

  const {
    SOURCE_ROOT_PATH_SUGGESTIONS,
    appSettings,
    setAppSettings,
    appSettingsLoading,
    workspaceInventoryLoading,
    appSettingsSaving,
    appSettingsFeedback,
    setAppSettingsFeedback,
    setAppSettingsDraft,
    isAppSettingsEditing,
    onboardingWizardStep,
    setOnboardingWizardStep,
    onboardingCommandPending,
    onboardingCommandResult,
    onboardingCommandHistory,
    onboardingCopiedCommand,
    startupOnboardingState,
    setIsAppSettingsEditing,
    visibleAppSettings,
    agentableProjects,
    appSettingsDirty,
    projectRetirementPendingRoot,
    workspaceInventoryLoaded,
    canRefreshWorkspaceInventory,
    showDoctorOutput,
    onboardingContextRoot,
    onboardingHasProjectConfig,
    onboardingRuntimeMatch,
    onboardingWizardSteps,
    onboardingWizardIndex,
    activeOnboardingStep,
    canGoToPreviousOnboardingStep,
    canGoToNextOnboardingStep,
    startupOnboardingVisible,
    startupOnboardingBlocking,
    buildOnboardingCommandLine,
    applyNextAppSettings,
    applyRestartedOnboardingSettings,
    refreshVisibleAppSettings,
    handleStartAppSettingsEdit,
    handleCancelAppSettingsEdit,
    updateAppSettingsDraft,
    handleSaveAppSettings,
    moveOnboardingWizard,
    handleRunOnboardingCommand,
    handleRestoreProject,
    handleRestartOnboarding,
    handleAddSourceRootSuggestion,
    handleSetSourceRootAt,
    handleAddSourceRootRow,
    handleRemoveSourceRootRow,
    handleBrowseForSourceRoot,
    handleSetOnboardingContextRoot,
    handleBrowseForOnboardingContextRoot,
    dismissStartupOnboarding,
    handleOnboardingContinue,
    skipCurrentOnboardingStep,
    handleCopyOnboardingCommand,
    handleLoadWorkspaceInventory,
  } = settingsController;

  const {
    selectedConversationKind,
    setSelectedConversationKind,
    selectedConversationId,
    setSelectedConversationId,
    selectedMessageThreadId,
    setSelectedMessageThreadId,
    selectedMessagesThread,
    selectedMessagesInternalThread,
    selectedMessagesInternalTarget,
    selectedMessagesDetailAgentId,
    selectedMessagesDetailAgent,
    selectedMessagesInternalMessages,
    selectedMessagesSessions,
    composerDraft,
    setComposerDraft,
    composerSending,
    composerSelectionStart,
    setComposerSelectionStart,
    mentionSelectionIndex,
    setMentionSelectionIndex,
    messagesFeedback,
    setMessagesFeedback,
    replyTarget,
    setReplyTarget,
    contextReferences,
    contextMessageIds,
    setContextMessageIds,
    composerRef,
    timelineViewportRef,
    mergedConversationMessages,
    visibleConversationMessages,
    currentConversationTitle,
    currentConversationSubtitle,
    currentConversationCount,
    selectedDirectConversation,
    mentionMenuOpen,
    mentionSuggestions,
    mentionDuplicateTitleCounts,
    handleConversationTimelineScroll,
    openConversation,
    applyMentionSuggestion,
    sendMessage,
    openDirectConversation,
    nudgeMessage,
    openAgentDirectMessage,
    messageThreads,
  } = useMessagesController({
    activeView,
    scoutDesktop,
    voiceEnabled: desktopFeatures.voice,
    relayState,
    messagesState,
    interAgentAgents,
    interAgentThreads,
    sessions,
    appSettings,
    setActiveView,
    setShellState,
  });

  const {
    pairingState,
    pairingLoading,
    pairingError,
    setPairingError,
    pairingControlPending,
    pairingConfigPending,
    pairingApprovalPendingId,
    pairingConfigFeedback,
    setPairingConfigFeedback,
    pendingApprovals,
    commitPairingState,
    refreshPairingState,
    handlePairingControl,
    handleUpdatePairingConfig,
    handleDecidePairingApproval,
  } = usePairingController({
    pairingEnabled: desktopFeatures.pairing,
    scoutDesktop,
    setRelayFeedback: setMessagesFeedback,
  });

  const pairingSurfaceBadge = describePairingSurfaceBadge(pairingState, pairingLoading, pairingError);

  const {
    phonePreparationState,
    phonePreparationLoading,
    phonePreparationSaving,
    phonePreparationFeedback,
    setDraggedSessionId,
    setDraggedPhoneSection,
    favoritePhoneSessions,
    quickHitPhoneSessions,
    handleClearPhoneQuickHits,
    handleDropIntoFavorites,
    handleDropIntoQuickHits,
    handleRemoveSessionFromPhoneSection,
    handleAddSessionToPhoneSection,
  } = usePhonePreparationController({
    activeView,
    scoutDesktop,
    sessions,
  });

  const diagnosticsController = useDiagnosticsController({
    activeView,
    settingsSection,
    scoutDesktop,
    surfaceCaps,
    pendingBrokerInspectorFocus,
    setPendingBrokerInspectorFocus,
    relayServiceInspectorRef,
    loadShellState,
    setShellState,
    setShellError,
    applyRestartedOnboardingSettings,
    commitPairingState,
    pairingState,
    setAppSettingsFeedback,
    setRelayFeedback: setMessagesFeedback,
    setPairingError,
    setPairingConfigFeedback,
  });

  const {
    logCatalog,
    logSources,
    filteredLogSources,
    selectedLogSourceId,
    setSelectedLogSourceId,
    selectedLogSource,
    logContent,
    brokerInspector,
    brokerControlPending,
    brokerControlFeedback,
    isFeedbackDialogOpen,
    feedbackBundle,
    feedbackBundleLoading,
    feedbackBundleError,
    feedbackDraft,
    setFeedbackDraft,
    feedbackSubmission,
    feedbackActionPending,
    feedbackActionMessage,
    logsLoading,
    logsFeedback,
    logSearchQuery,
    setLogSearchQuery,
    logSourceQuery,
    setLogSourceQuery,
    refreshLogs,
    refreshBrokerInspector,
    openFeedbackDialog,
    handleFeedbackDialogOpenChange,
    handleBrokerControl,
    handleRefreshFeedbackBundle,
    handleCopyFeedbackBundle,
    handleSubmitFeedbackReport,
    handleRepairSetup,
  } = diagnosticsController;

  const agentController = useAgentController({
    activeView,
    scoutDesktop,
    surfaceCaps,
    interAgentState,
    interAgentAgents,
    interAgentThreads,
    relayState,
    selectedMessagesThread,
    selectedMessagesDetailAgentId,
    selectedRelayKind: selectedConversationKind,
    selectedRelayId: selectedConversationId,
    agentableProjects,
    visibleAppSettings,
    isAppSettingsEditing,
    appSettingsDirty,
    setAppSettings,
    setAppSettingsDraft,
    setActiveView,
    setSettingsSection,
    setShellState,
    setShellError,
    setRelayFeedback: setMessagesFeedback,
  });

  const {
    selectedInterAgentId,
    selectedInterAgentThreadId,
    setSelectedInterAgentThreadId,
    agentRosterFilter,
    setAgentRosterFilter,
    agentRosterSort,
    setAgentRosterSort,
    agentThreadsExpanded,
    setAgentThreadsExpanded,
    agentSnapshotExpanded,
    setAgentSnapshotExpanded,
    agentActivityExpanded,
    setAgentActivityExpanded,
    agentSessionLogsExpanded,
    setAgentSessionLogsExpanded,
    agentRosterMenu,
    setAgentRosterMenu,
    selectedInterAgent,
    rosterInterAgentAgents,
    rosterAgentTitleCounts,
    visibleInterAgentThreads,
    selectedInterAgentDirectThread,
    selectedInterAgentThread,
    selectedInterAgentChatActionLabel,
    selectedAgentDirectLinePreview,
    isAgentConfigEditing,
    visibleAgentConfig,
    hasEditableAgentConfig,
    agentConfigLoading,
    agentConfigSaving,
    agentConfigRestarting,
    agentConfigFeedback,
    agentCapabilitiesPreview,
    agentRuntimePathRef,
    updateAgentConfigDraft,
    agentConfigDirty,
    agentRestartActionLabel,
    handleSelectInterAgent,
    handleOpenAgentSettings,
    deactivateAgentConfigEdit,
    handleStartAgentConfigEdit,
    handleCancelAgentConfigEdit,
    handleSaveAgentConfig,
    handleRestartAgent,
    isCreateAgentDialogOpen,
    setIsCreateAgentDialogOpen,
    createAgentDraft,
    setCreateAgentDraft,
    createAgentDefaults,
    createAgentSubmitting,
    createAgentFeedback,
    setCreateAgentFeedback,
    handleOpenCreateAgentDialog,
    handleBrowseCreateAgentProject,
    handleCreateAgent,
    visibleAgentSession,
    agentSessionPending,
    agentSessionLoading,
    agentSessionFeedback,
    agentSessionCopied,
    isAgentSessionPeekOpen,
    closeAgentSessionPeek,
    agentSessionInlineViewportRef,
    handleInlineAgentSessionScroll,
    agentSessionPeekViewportRef,
    handlePeekAgentSessionScroll,
    handleOpenAgentSession,
    handleCopyAgentSessionCommand,
    handlePeekAgentSession,
    refreshAgentSession,
  } = agentController;

  useEffect(() => {
    void loadShellState(true);
    const interval = window.setInterval(() => {
      void loadShellState(false);
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadShellState]);

  useEffect(() => {
    const threads = messagesState?.threads ?? [];
    if (threads.length === 0) {
      if (selectedMessageThreadId !== null) {
        setSelectedMessageThreadId(null);
      }
      return;
    }

    if (selectedMessageThreadId && threads.some((thread) => thread.id === selectedMessageThreadId)) {
      return;
    }

    const preferredThread = threads.find((thread) => (
      thread.relayDestinationKind === selectedConversationKind
      && thread.relayDestinationId === selectedConversationId
    )) ?? threads.find((thread) => thread.interAgentThreadId === selectedInterAgentThreadId)
      ?? threads[0];

    if (preferredThread && preferredThread.id !== selectedMessageThreadId) {
      setSelectedMessageThreadId(preferredThread.id);
    }
  }, [
    messagesState,
    selectedConversationId,
    selectedConversationKind,
    selectedInterAgentThreadId,
    selectedMessageThreadId,
    setSelectedMessageThreadId,
  ]);

  useEffect(() => {
    if (!selectedMessageThreadId) {
      return;
    }

    setMessagesDetailOpen(true);
    setMessagesDetailTab('overview');
  }, [selectedMessageThreadId]);

  useEffect(() => {
    if (activeView !== 'settings' || !isAppSettingsEditing) {
      return;
    }

    const target = settingsOperatorNameRef.current;
    if (!target) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      target.focus();
      target.select();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activeView, isAppSettingsEditing]);

  // Get unique projects
  const projects = useMemo(() => {
    const projectMap = new Map<string, { count: number; lastModified: string }>();
    sessions.forEach(s => {
      const existing = projectMap.get(s.project);
      if (!existing || new Date(s.lastModified) > new Date(existing.lastModified)) {
        projectMap.set(s.project, {
          count: (existing?.count || 0) + 1,
          lastModified: s.lastModified
        });
      } else if (existing) {
        projectMap.set(s.project, { ...existing, count: existing.count + 1 });
      }
    });
    return Array.from(projectMap.entries()).map(([name, data]) => ({ name, ...data }));
  }, [sessions]);

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    let filtered = sessions;
    if (selectedProject) {
      filtered = filtered.filter(s => s.project === selectedProject);
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.title.toLowerCase().includes(query) ||
        s.preview.toLowerCase().includes(query) ||
        s.tags?.some(t => t.toLowerCase().includes(query)) ||
        s.agent.toLowerCase().includes(query) ||
        s.project.toLowerCase().includes(query)
      );
    }
    return filtered.sort((a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );
  }, [sessions, searchQuery, selectedProject]);

  // Stats
  const stats = useMemo(() => ({
    totalSessions: sessions.length,
    totalMessages: sessions.reduce((sum, s) => sum + s.messageCount, 0),
    totalTokens: sessions.reduce((sum, s) => sum + (s.tokens || 0), 0),
    projects: projects.length,
  }), [sessions, projects]);

  const availableAgentNames = useMemo(
    () => Array.from(new Set(sessions.map((session) => session.agent))).sort(),
    [sessions],
  );
  const interAgentAgentLookup = useMemo(
    () => new Map(interAgentAgents.map((agent) => [agent.id, agent])),
    [interAgentAgents],
  );
  const relayDirectLookup = useMemo(
    () => new Map((relayState?.directs ?? []).map((thread) => [thread.id, thread])),
    [relayState],
  );
  const visibleInterAgentMessages = useMemo(
    () => {
      if (!relayState || !selectedInterAgentThread) {
        return [];
      }

      const messageIds = new Set(selectedInterAgentThread.messageIds);
      return relayState.messages.filter((message) => messageIds.has(message.id));
    },
    [relayState, selectedInterAgentThread],
  );
  const selectedInterAgentActivityMessages = useMemo(
    () => {
      if (!selectedInterAgent) {
        return [];
      }

      const relatedPrivateThreadMessageIds = new Set(
        visibleInterAgentThreads
          .filter((thread) => thread.sourceKind === 'private')
          .flatMap((thread) => thread.messageIds),
      );

      return mergedConversationMessages
        .filter((message) => (
          relatedPrivateThreadMessageIds.has(message.id)
          || message.authorId === selectedInterAgent.id
        ))
        .slice(-60);
    },
    [mergedConversationMessages, selectedInterAgent, visibleInterAgentThreads],
  );
  const selectedInterAgentInboundTasks = useMemo(
    () => plansState?.tasks.filter((task) => task.targetAgentId === selectedInterAgentId) ?? [],
    [plansState, selectedInterAgentId],
  );
  const selectedInterAgentFindings = useMemo(
    () => plansState?.findings.filter((finding) => (
      finding.targetAgentId === selectedInterAgentId || finding.requesterId === selectedInterAgentId
    )) ?? [],
    [plansState, selectedInterAgentId],
  );
  const selectedInterAgentOutboundFindings = useMemo(
    () => selectedInterAgentFindings.filter((finding) => finding.requesterId === selectedInterAgentId),
    [selectedInterAgentFindings, selectedInterAgentId],
  );
  const interAgentThreadTitle = selectedInterAgentThread
    ? interAgentThreadTitleForAgent(selectedInterAgentThread, selectedInterAgentId)
    : selectedInterAgent
      ? `${selectedInterAgent.title}'s agent threads`
      : 'Inter-Agent';
  const selectedInterAgentThreadSubtitle = selectedInterAgentThread
    ? interAgentThreadSubtitle(selectedInterAgentThread, selectedInterAgentId)
    : selectedInterAgent?.statusDetail ?? 'Select an agent to inspect private threads between agents.';
  const interAgentConfigureTarget = useMemo(() => {
    if (selectedInterAgentThread) {
      const counterparts = interAgentCounterparts(selectedInterAgentThread, selectedInterAgentId);
      if (counterparts.length === 1) {
        return interAgentAgents.find((agent) => agent.id === counterparts[0]?.id) ?? selectedInterAgent;
      }
    }

    return selectedInterAgent;
  }, [selectedInterAgentThread, selectedInterAgentId, interAgentAgents, selectedInterAgent]);
  const interAgentConfigureLabel = interAgentConfigureTarget
    ? interAgentConfigureTarget.profileKind === 'project' ? 'Configure' : 'Profile'
    : null;
  const interAgentMessageTarget = interAgentConfigureTarget ?? selectedInterAgent;
  const renderLocalPathValue = React.useCallback((
    filePath: string | null | undefined,
    options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
  ) => {
    if (!filePath) {
      return null;
    }

    const label = options?.compact ? (compactHomePath(filePath) ?? filePath) : filePath;
    const looksLikePath = label.includes('/') || label.startsWith('~/') || label.startsWith('.openscout');
    if (!looksLikePath) {
      return <>{label}</>;
    }

    return (
      <button
        type="button"
        className={options?.className ?? 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity'}
        style={options?.style ?? { color: C.ink }}
        onClick={(event) => {
          event.preventDefault();
          if (!surfaceCaps?.canRevealPath || !scoutDesktop?.revealPath) {
            return;
          }
          void scoutDesktop.revealPath(filePath).catch((error) => {
            setAppSettingsFeedback(asErrorMessage(error));
          });
        }}
        title="Open in Finder"
      >
        {label}
      </button>
    );
  }, [scoutDesktop, surfaceCaps]);
  const overviewSessions = useMemo(
    () => [...sessions]
      .sort((lhs, rhs) => new Date(rhs.lastModified).getTime() - new Date(lhs.lastModified).getTime())
      .slice(0, 5),
    [sessions],
  );
  const overviewProjects = useMemo(
    () => {
      const sessionProjects = new Map(
        projects.map((project) => [project.name, project] as const),
      );

      const discoveredProjects = (visibleAppSettings?.projectInventory ?? []).map((project) => {
        const name = project.projectName || project.title || project.id;
        const sessionProject = sessionProjects.get(name);
        return {
          name,
          count: sessionProject?.count ?? 0,
          lastModified: sessionProject?.lastModified ?? '',
        };
      });

      const missingSessionProjects = projects.filter((project) => !discoveredProjects.some((entry) => entry.name === project.name));

      return [...discoveredProjects, ...missingSessionProjects]
        .sort((lhs, rhs) =>
          rhs.count - lhs.count
          || new Date(rhs.lastModified || 0).getTime() - new Date(lhs.lastModified || 0).getTime()
          || lhs.name.localeCompare(rhs.name),
        )
        .slice(0, 6);
    },
    [projects, visibleAppSettings?.projectInventory],
  );
  const reachableRelayAgents = useMemo(
    () => (relayState?.directs ?? []).filter((thread) => thread.reachable),
    [relayState],
  );
  const activityTasks = useMemo(
    () => [...(plansState?.tasks ?? [])]
      .sort((lhs, rhs) => rhs.createdAt - lhs.createdAt)
      .slice(0, 18),
    [plansState],
  );
  const activityFindings = useMemo(
    () => [...(plansState?.findings ?? [])].slice(0, 10),
    [plansState],
  );
  const activityEndpoints = useMemo(
    () => (machinesState?.machines ?? [])
      .flatMap((machine) => machine.endpoints.map((endpoint) => ({
        machineId: machine.id,
        machineTitle: machine.title,
        machineStatus: machine.status,
        endpoint,
      })))
      .sort((lhs, rhs) => {
        const rank = (state: string) => {
          switch (state) {
            case 'running':
              return 0;
            case 'waiting':
              return 1;
            case 'idle':
              return 2;
            default:
              return 3;
          }
        };
        return rank(lhs.endpoint.state) - rank(rhs.endpoint.state)
          || lhs.endpoint.agentName.localeCompare(rhs.endpoint.agentName);
      })
      .slice(0, 14),
    [machinesState],
  );
  const activityRecentMessages = useMemo(
    () => [...mergedConversationMessages]
      .filter((message) => !message.isVoice)
      .slice(-18)
      .reverse(),
    [mergedConversationMessages],
  );
  const inboxFailedTaskCount = useMemo(
    () => (plansState?.tasks ?? []).filter((task) => task.status === 'failed').length,
    [plansState],
  );
  const inboxAlertCount = pendingApprovals.length + inboxFailedTaskCount;
  const activityLeadTask = activityTasks.find((task) => task.status === 'running') ?? activityTasks[0] ?? null;
  const relayRuntimeBooting = isLoadingShell && !shellState && !shellError;
  const relayStatusLabel = relayRuntimeBooting
    ? 'Syncing…'
    : runtime?.brokerReachable
      ? 'Running'
      : 'Offline';
  const relayStatusTitle = relayRuntimeBooting
    ? 'Scout is still syncing with the relay runtime.'
    : runtime?.brokerReachable
      ? 'Open Relay diagnostics'
      : 'Relay is offline. Open diagnostics.';
  const relayStatusDotClassName = relayRuntimeBooting
    ? 'bg-sky-500 animate-pulse'
    : runtime?.brokerReachable
      ? 'bg-emerald-500'
      : 'bg-amber-500';
  const relayRuntimeHealthLabel = relayRuntimeBooting
    ? 'Syncing'
    : runtime?.brokerHealthy
      ? 'Healthy'
      : runtime?.brokerReachable
        ? 'Reachable'
        : 'Offline';
  const logsAttentionLevel = useMemo<'error' | 'warning' | null>(() => {
    if (shellError || relayState?.voice.captureState === 'error') {
      return 'error';
    }
    if (relayRuntimeBooting) {
      return null;
    }
    if (runtime && (!runtime.brokerReachable || !runtime.brokerHealthy)) {
      return 'warning';
    }
    return null;
  }, [relayRuntimeBooting, relayState?.voice.captureState, runtime, shellError]);
  const logsButtonTitle = logsAttentionLevel === 'error'
    ? 'Logs · attention required'
    : logsAttentionLevel === 'warning'
      ? 'Logs · check runtime warnings'
      : 'Logs';
  const footerTimeLabel = formatFooterTime(new Date());
  const navViews: NavViewItem[] = [];
  if (desktopFeatures.overview) navViews.push({ id: 'overview', icon: <LayoutGrid size={16} strokeWidth={1.5} />, title: 'Overview' });
  if (desktopFeatures.inbox) navViews.push({ id: 'inbox', icon: <Bell size={16} strokeWidth={1.5} />, title: 'Inbox', badgeCount: inboxAlertCount > 0 ? inboxAlertCount : undefined });
  if (desktopFeatures.relay) navViews.push({ id: 'messages', icon: <MessageSquare size={16} strokeWidth={1.5} />, title: 'Messages' });
  if (desktopFeatures.activity) navViews.push({ id: 'activity', icon: <Radio size={16} strokeWidth={1.5} />, title: 'Activity Monitor' });
  if (desktopFeatures.machines) navViews.push({ id: 'machines', icon: <Network size={16} strokeWidth={1.5} />, title: 'Machines' });
  if (desktopFeatures.plans) navViews.push({ id: 'plans', icon: <FileText size={16} strokeWidth={1.5} />, title: 'Plans' });
  if (desktopFeatures.search) navViews.push({ id: 'search', icon: <Search size={16} strokeWidth={1.5} />, title: 'Search' });

  const collapsibleViews = new Set<AppView>(navViews.map((item) => item.id).filter((view) => view !== 'overview'));
  if (desktopFeatures.logs) {
    collapsibleViews.add('logs');
  }

  const settingsSections: SettingsSectionMeta[] = [
    {
      id: 'profile' as const,
      label: 'General',
      description: 'Local Scout defaults, CLI setup commands, and workspace scanning roots.',
      icon: <FolderOpen size={15} />,
    },
    {
      id: 'agents' as const,
      label: 'Agents',
      description: 'Select an agent, then edit its runtime, capabilities, and restart controls.',
      icon: <Bot size={15} />,
    },
    {
      id: 'workspaces' as const,
      label: 'Workspaces',
      description: 'Workspace discovery, repo bindings, and harness readiness.',
      icon: <FolderOpen size={15} />,
    },
    {
      id: 'communication' as const,
      label: 'Communication',
      description: 'Broker, relay delivery, and live runtime status.',
      icon: <Radio size={15} />,
    },
  ];
  if (desktopFeatures.sessions) {
    settingsSections.push({
      id: 'database',
      label: 'Database',
      description: 'Session indexing and storage.',
      icon: <Database size={15} />,
    });
  }
  if (desktopFeatures.enableAll) {
    settingsSections.push({
      id: 'appearance',
      label: 'Appearance',
      description: 'Visual preferences and display options.',
      icon: <Palette size={15} />,
    });
  }
  const activeSettingsMeta = settingsSections.find((section) => section.id === settingsSection) ?? settingsSections[0];

  useEffect(() => {
    if (productSurface !== 'relay') {
      return;
    }

    const enabledViews = new Set<AppView>([
      ...navViews.map((item) => item.id),
      ...(desktopFeatures.relay ? ['relay' as const, 'inter-agent' as const, 'agents' as const] : []),
      ...(desktopFeatures.sessions ? ['sessions' as const] : []),
      ...(desktopFeatures.settings ? ['settings' as const] : []),
      ...(desktopFeatures.logs ? ['logs' as const] : []),
    ]);

    if (!enabledViews.has(activeView)) {
      setActiveView(desktopFeatures.relay ? 'messages' : 'overview');
    }
  }, [activeView, desktopFeatures.logs, desktopFeatures.relay, desktopFeatures.sessions, desktopFeatures.settings, navViews, productSurface]);

  useEffect(() => {
    if (!settingsSections.some((section) => section.id === settingsSection)) {
      setSettingsSection('profile');
    }
  }, [settingsSection, settingsSections]);

  const beginResize = React.useCallback((e: React.MouseEvent, target: "left-sidebar" | "right-sidebar") => {
    e.preventDefault();
    activeResizeTarget.current = target;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    beginResize(e, "left-sidebar");
  }, [beginResize]);

  const handleMessagesDetailResizeStart = React.useCallback((e: React.MouseEvent) => {
    beginResize(e, "right-sidebar");
  }, [beginResize]);

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (activeResizeTarget.current === "left-sidebar") {
      const newWidth = e.clientX - 48;
      if (newWidth > 160 && newWidth < 400) setSidebarWidth(newWidth);
      return;
    }
    if (activeResizeTarget.current === "right-sidebar") {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 280 && newWidth < 520) setMessagesDetailWidth(newWidth);
    }
  }, []);

  const handleMouseUp = React.useCallback(() => {
    activeResizeTarget.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleRefreshShell = async () => {
    setManualRefreshPending(true);
    setMessagesFeedback('Refreshing…');
    try {
      if (
        productSurface === 'pairing'
        && desktopFeatures.pairing
        && (scoutDesktop?.refreshPairingState || scoutDesktop?.getPairingState)
      ) {
        const nextPairingState = await refreshPairingState();
        if (nextPairingState) {
          setMessagesFeedback('Pairing refreshed.');
        }
        return;
      }
      if (scoutDesktop?.refreshShellState) {
        const nextState = await scoutDesktop.refreshShellState();
        setShellState(nextState);
        setShellError(null);
      } else {
        await loadShellState(true);
      }

      if (activeView === 'settings' || activeView === 'help') {
        await refreshVisibleAppSettings({
          preferInventory: activeView === 'settings' && settingsSection === 'workspaces',
        });
      }

      if (activeView === 'settings' && settingsSection === 'communication') {
        await refreshBrokerInspector();
      }

      if (activeView === 'logs') {
        refreshLogs();
      }

      if (activeView === 'agents' && selectedInterAgentId) {
        refreshAgentSession();
      }

      setMessagesFeedback('Refreshed.');
    } catch (error) {
      setMessagesFeedback(asErrorMessage(error));
    } finally {
      setManualRefreshPending(false);
    }
  };

  const handleReloadApp = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setAppReloadPending(true);
    if (scoutDesktop?.reloadApp) {
      void scoutDesktop.reloadApp();
      return;
    }
    window.location.reload();
  }, [scoutDesktop]);

  const openRelayDiagnostics = React.useCallback(() => {
    setProductSurface('relay');
    setActiveView('settings');
    setSettingsSection('communication');
    setPendingBrokerInspectorFocus(true);
  }, []);

  const handleQuitApp = React.useCallback(() => {
    void (async () => {
      try {
        if (!surfaceCaps?.canQuitHost) {
          return;
        }
        if (scoutDesktop?.quitApp) {
          await scoutDesktop.quitApp();
        }
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, [scoutDesktop, surfaceCaps]);
  const openAgentProfile = React.useCallback((agentId: string) => {
    handleSelectInterAgent(agentId);
    deactivateAgentConfigEdit();
    setMessagesDetailOpen(true);
    setMessagesDetailTab('overview');
    openConversation('direct', agentId);
  }, [deactivateAgentConfigEdit, handleSelectInterAgent, openConversation]);

  const handleToggleVoiceCapture = async () => {
    if (!scoutDesktop?.toggleVoiceCapture) {
      setShellError('Electron desktop bridge is unavailable.');
      return;
    }

    try {
      const nextState = await scoutDesktop.toggleVoiceCapture();
      setShellState(nextState);
      setShellError(null);
      setMessagesFeedback(nextState.relay.voice.isCapturing ? 'Voice capture started.' : 'Voice capture stopped.');
    } catch (error) {
      setMessagesFeedback(asErrorMessage(error));
    }
  };

  const handleSetVoiceRepliesEnabled = async (enabled: boolean) => {
    if (!scoutDesktop?.setVoiceRepliesEnabled) {
      setShellError('Electron desktop bridge is unavailable.');
      return;
    }

    try {
      const nextState = await scoutDesktop.setVoiceRepliesEnabled(enabled);
      setShellState(nextState);
      setShellError(null);
      setMessagesFeedback(enabled ? 'Playback enabled.' : 'Playback disabled.');
    } catch (error) {
      setMessagesFeedback(asErrorMessage(error));
    }
  };

  const openProjectSessions = (projectName: string) => {
    setSelectedProject(projectName);
    setSelectedSession(null);
    setActiveView('sessions');
  };

  const openSessionDetail = (session: SessionMetadata) => {
    setSelectedSession(session);
    setMessagesDetailOpen(true);
    setMessagesDetailTab('history');
    const relatedThread = messagesState?.threads.find((thread) => (
      thread.relayDestinationKind === 'direct' && thread.relayDestinationId === session.project
    )) ?? null;
    if (relatedThread) {
      selectMessageThread(relatedThread);
    }
    setSelectedProject(null);
    setActiveView('messages');
  };

  const inboxFailedTaskItems = useMemo<InboxItem[]>(
    () => (plansState?.tasks ?? [])
      .filter((task) => task.status === 'failed')
      .slice(0, 10)
      .map((task) => ({
        id: `task-failed:${task.id}`,
        kind: 'task',
        tone: 'critical',
        title: task.title,
        summary: `${task.targetAgentName} reported a failed ask.`,
        detail: task.statusDetail ?? task.replyPreview ?? task.body,
        meta: [task.project, task.updatedAtLabel, task.ageLabel].filter(Boolean).join(' · ') || task.createdAtLabel,
        actionLabel: 'Open Agent',
        onAction: () => openAgentProfile(task.targetAgentId),
      })),
    [openAgentProfile, plansState],
  );

  const inboxApprovalItems = useMemo<InboxItem[]>(
    () => pendingApprovals.map((approval) => ({
      id: `approval:${approval.sessionId}:${approval.turnId}:${approval.blockId}`,
      kind: 'approval',
      tone: approval.risk === 'high' ? 'critical' : approval.risk === 'medium' ? 'warning' : 'info',
      title: approval.title,
      summary: approval.description,
      detail: approval.detail,
      meta: `${approval.sessionName} · ${approval.risk} risk`,
      actionLabel: 'Open Pairing',
      onAction: () => {
        setProductSurface('pairing');
      },
      onSecondaryAction: () => {
        void handleDecidePairingApproval(approval, 'approve');
      },
      secondaryActionLabel: 'Approve',
    })),
    [handleDecidePairingApproval, pendingApprovals],
  );

  const inboxAwaitingYouItems = useMemo(
    () => [...inboxApprovalItems, ...inboxFailedTaskItems]
      .sort((lhs, rhs) => {
        const rank = (tone: InboxItemTone) => tone === 'critical' ? 0 : tone === 'warning' ? 1 : 2;
        return rank(lhs.tone) - rank(rhs.tone) || lhs.title.localeCompare(rhs.title);
      }),
    [inboxApprovalItems, inboxFailedTaskItems],
  );

  const selectMessageThread = React.useCallback((thread: MessagesThread) => {
    setSelectedMessageThreadId(thread.id);
    if (thread.kind === 'relay' && thread.relayDestinationKind && thread.relayDestinationId) {
      setSelectedConversationKind(thread.relayDestinationKind);
      setSelectedConversationId(thread.relayDestinationId);
      return;
    }

    if (!thread.interAgentThreadId) {
      return;
    }

    setSelectedInterAgentThreadId(thread.interAgentThreadId);
    const internalThread = interAgentThreads.find((item) => item.id === thread.interAgentThreadId) ?? null;
    const nextAgentId = internalThread?.participants.find((participant) => (
      interAgentAgents.some((agent) => agent.id === participant.id)
    ))?.id ?? null;
    if (nextAgentId) {
      handleSelectInterAgent(nextAgentId);
      setSelectedInterAgentThreadId(thread.interAgentThreadId);
    }
  }, [
    handleSelectInterAgent,
    interAgentAgents,
    interAgentThreads,
    setSelectedConversationId,
    setSelectedConversationKind,
    setSelectedInterAgentThreadId,
    setSelectedMessageThreadId,
  ]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
  };

  // Shared style builders
  const s = {
    root:        { backgroundColor: C.bg, color: C.ink },
    surface:     { backgroundColor: C.surface },
    border:      { borderColor: C.border },
    topBar:      { backgroundColor: C.surface, borderBottomColor: C.border },
    navBar:      { backgroundColor: C.bg, borderRightColor: C.border },
    sidebar:     { backgroundColor: C.bg, borderRightColor: C.border },
    sectionLabel:{ color: C.muted },
    inkText:     { color: C.ink },
    mutedText:   { color: C.muted },
    tagBadge:    { backgroundColor: C.tagBg, borderColor: C.border, color: C.muted },
    activePill:  { backgroundColor: C.accentBg, color: C.accent },
    activeItem:  { backgroundColor: C.surface, borderColor: C.border, color: C.ink },
    kbd:         { backgroundColor: C.surface, borderColor: C.border, color: C.ink },
    hoverBg:     'hover:bg-[var(--os-hover)]',
    annotBadge:  { backgroundColor: C.tagBg, borderColor: C.border, color: C.muted },
  };

  const renderOnboardingCommandShell = (
    command: OnboardingCommandName,
    commandLine: string,
    running: boolean,
  ) => {
    const commandResult = onboardingCommandHistory[command] ?? (
      onboardingCommandResult?.command === command ? onboardingCommandResult : null
    );

    return (
      <OnboardingCommandShell
        command={command}
        commandLine={commandLine}
        running={running}
        commandResult={commandResult}
        visibleAppSettings={visibleAppSettings}
        onboardingCopiedCommand={onboardingCopiedCommand}
        onboardingCommandPending={onboardingCommandPending}
        onboardingContextRoot={onboardingContextRoot}
        onCopyOnboardingCommand={handleCopyOnboardingCommand}
        onRunOnboardingCommand={handleRunOnboardingCommand}
      />
    );
  };

  const settingsHelpViewProps = useSettingsHelpViewProps({
    activeView,
    setActiveView,
    settingsSection,
    setSettingsSection,
    settingsSections,
    activeSettingsMeta,
    desktopFeatures,
    stats,
    runtime,
    relayState,
    relayRuntimeBooting,
    relayRuntimeHealthLabel,
    reachableRelayAgentCount: reachableRelayAgents.length,
    dark,
    setDark,
    showAnnotations,
    setShowAnnotations,
    isCollapsed,
    styles: {
      surface: s.surface,
      inkText: s.inkText,
      mutedText: s.mutedText,
      tagBadge: s.tagBadge,
      activePill: s.activePill,
    },
    scoutDesktop,
    surfaceCaps,
    interAgentAgents,
    openKnowledgeBase,
    openAgentProfile,
    openDirectConversation,
    renderOnboardingCommandShell,
    renderLocalPathValue,
    settingsOperatorNameRef,
    relayServiceInspectorRef,
    handleSetVoiceRepliesEnabled,
    settingsController,
    diagnosticsController,
    agentController,
  });

  if (!startupSplashDismissed) {
    return (
      <StartupSplashOverlay
        dark={dark}
        productName={scoutAppInfo?.productName ?? 'Scout'}
        onDismissed={dismissStartupSplash}
      />
    );
  }

  if (startupOnboardingBlocking) {
    return (
      <div
        className={`min-h-screen w-full font-sans${dark ? ' dark' : ''}`}
        style={{ backgroundColor: C.bg, color: C.ink }}
      >
        <div className="relative min-h-screen flex items-center justify-center px-6 py-10">
          <div className="absolute top-6 left-6 z-10">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] transition-opacity hover:opacity-80"
              style={{ borderColor: C.border, color: C.muted }}
              onClick={handleQuitApp}
            >
              <X size={12} />
              Quit
            </button>
          </div>
          {startupOnboardingVisible && visibleAppSettings ? (
            <div className="w-full max-w-[820px] os-scale-in">
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.surface, boxShadow: `0 24px 80px ${dark ? 'rgba(0,0,0,0.4)' : 'rgba(15,23,42,0.08)'}` }}>
                <div
                  className="px-8 pt-8 pb-6 border-b cursor-grab active:cursor-grabbing"
                  style={{ borderBottomColor: C.border, WebkitAppRegion: 'drag' } as React.CSSProperties}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-[11px] font-mono uppercase tracking-[0.22em]" style={s.mutedText}>Scout Setup</div>
                    <button
                      className="text-[12px] transition-opacity hover:opacity-70"
                      style={{ ...s.mutedText, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      onClick={dismissStartupOnboarding}
                    >
                      Skip onboarding
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-6">
                    {onboardingWizardSteps.map((step, idx) => {
                      const done = idx < onboardingWizardIndex;
                      const active = idx === onboardingWizardIndex;
                      return (
                        <div
                          key={step.id}
                          className="h-1 flex-1 rounded-full transition-all duration-300"
                          style={{
                            backgroundColor: done || active ? C.accent : (dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'),
                            opacity: active ? 0.6 : 1,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ backgroundColor: C.accentBg, color: C.accent }}>
                      {activeOnboardingStep.number}/{onboardingWizardSteps.length}
                    </span>
                    <span className="text-[12px] font-medium" style={s.mutedText}>
                      {activeOnboardingStep.title}
                    </span>
                  </div>
                </div>

                <div className="px-8 py-8 os-fade-up" key={activeOnboardingStep.id}>
                  <StartupOnboardingStepContent
                    activeOnboardingStep={activeOnboardingStep}
                    visibleAppSettings={visibleAppSettings}
                    appSettingsSaving={appSettingsSaving}
                    appSettingsLoading={appSettingsLoading}
                    appSettingsDirty={appSettingsDirty}
                    onboardingCommandPending={onboardingCommandPending}
                    onboardingHasProjectConfig={onboardingHasProjectConfig}
                    sourceRootPathSuggestions={SOURCE_ROOT_PATH_SUGGESTIONS}
                    settingsOperatorNameRef={settingsOperatorNameRef}
                    setAppSettingsDraft={setAppSettingsDraft}
                    setAppSettingsFeedback={setAppSettingsFeedback}
                    setIsAppSettingsEditing={setIsAppSettingsEditing}
                    handleAddSourceRootRow={handleAddSourceRootRow}
                    handleSetSourceRootAt={handleSetSourceRootAt}
                    handleBrowseForSourceRoot={handleBrowseForSourceRoot}
                    handleRemoveSourceRootRow={handleRemoveSourceRootRow}
                    handleSetOnboardingContextRoot={handleSetOnboardingContextRoot}
                    handleBrowseForOnboardingContextRoot={handleBrowseForOnboardingContextRoot}
                    handleAddSourceRootSuggestion={handleAddSourceRootSuggestion}
                    handleRunOnboardingCommand={handleRunOnboardingCommand}
                    buildOnboardingCommandLine={buildOnboardingCommandLine}
                    renderOnboardingCommandShell={renderOnboardingCommandShell}
                    renderLocalPathValue={renderLocalPathValue}
                    styles={{
                      inkText: s.inkText,
                      mutedText: s.mutedText,
                      activePill: s.activePill,
                      tagBadge: s.tagBadge,
                    }}
                    availableHarnesses={AVAILABLE_AGENT_HARNESSES}
                  />

                  {appSettingsFeedback ? (
                    <div className="text-[13px] mt-6 leading-[1.6] os-fade-in" style={s.inkText}>{appSettingsFeedback}</div>
                  ) : null}
                </div>

                <div className="px-8 py-5 border-t flex items-center justify-between gap-4" style={{ borderTopColor: C.border, backgroundColor: C.bg }}>
                  <button
                    className="os-btn flex items-center gap-1 text-[12px] font-medium px-4 py-2.5 rounded-lg border disabled:opacity-40 transition-all"
                    style={{ color: C.muted, borderColor: C.border, backgroundColor: 'transparent' }}
                    onClick={() => moveOnboardingWizard(-1)}
                    disabled={!canGoToPreviousOnboardingStep}
                  >
                    Back
                  </button>
                  <div className="text-[11px] font-mono text-center" style={s.mutedText}>
                    {activeOnboardingStep.number} of {onboardingWizardSteps.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="os-btn flex items-center gap-1 text-[12px] font-medium px-4 py-2.5 rounded-lg transition-all"
                      style={{ color: C.muted }}
                      onClick={skipCurrentOnboardingStep}
                    >
                      {canGoToNextOnboardingStep ? 'Skip step' : 'Finish later'}
                    </button>
                    <button
                      className="os-btn-primary flex items-center gap-1 text-[12px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
                      style={{ backgroundColor: C.accent, color: '#fff' }}
                      onClick={handleOnboardingContinue}
                      disabled={!canGoToNextOnboardingStep || appSettingsSaving || appSettingsLoading}
                    >
                      {activeOnboardingStep.id === 'confirm'
                        ? (appSettingsSaving ? 'Confirming…' : 'Confirm')
                        : 'Continue'}
                      {activeOnboardingStep.id === 'confirm' ? null : <ChevronRight size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <BootLoader dark={dark} C={C} s={s} />
          )}
        </div>
      </div>
    );
  }

  return (
    <DesktopAppShellView
      dark={dark}
      setDark={setDark}
      C={C}
      s={s}
      productSurface={productSurface}
      setProductSurface={setProductSurface}
      activeView={activeView}
      setActiveView={setActiveView}
      desktopFeatures={desktopFeatures}
      pairingSurfaceBadge={pairingSurfaceBadge}
      openRelayDiagnostics={openRelayDiagnostics}
      relayStatusTitle={relayStatusTitle}
      relayRuntimeBooting={relayRuntimeBooting}
      relayStatusDotClassName={relayStatusDotClassName}
      relayStatusLabel={relayStatusLabel}
      runtime={runtime}
      appReloadPending={appReloadPending}
      handleReloadApp={handleReloadApp}
      handleQuitApp={handleQuitApp}
      navViews={navViews}
      collapsibleViews={collapsibleViews}
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      pairingSurfaceProps={{
        pairingControlPending,
        pairingConfigFeedback,
        pairingConfigPending,
        pairingError,
        pairingLoading,
        pairingState,
        onControlPairing: handlePairingControl,
        onDecideApproval: handleDecidePairingApproval,
        onOpenFullLogs: () => {
          setProductSurface('relay');
          setActiveView('logs');
        },
        onOpenFeedback: openFeedbackDialog,
        pairingApprovalPendingId,
        onUpdateConfig: handleUpdatePairingConfig,
        onRefresh: () => void handleRefreshShell(),
        onRevealPath: (filePath) => {
          if (!surfaceCaps?.canRevealPath) {
            return;
          }
          void scoutDesktop?.revealPath?.(filePath);
        },
      }}
      isAgentSessionPeekOpen={isAgentSessionPeekOpen}
      selectedInterAgent={selectedInterAgent}
      visibleAgentSession={visibleAgentSession}
      agentSessionPending={agentSessionPending}
      agentSessionLoading={agentSessionLoading}
      agentSessionFeedback={agentSessionFeedback}
      agentSessionCopied={agentSessionCopied}
      agentSessionPeekViewportRef={agentSessionPeekViewportRef}
      handlePeekAgentSessionScroll={handlePeekAgentSessionScroll}
      closeAgentSessionPeek={closeAgentSessionPeek}
      handleCopyAgentSessionCommand={() => void handleCopyAgentSessionCommand()}
      handleOpenAgentSession={() => void handleOpenAgentSession()}
      renderLocalPathValue={renderLocalPathValue}
      isCreateAgentDialogOpen={isCreateAgentDialogOpen}
      setIsCreateAgentDialogOpen={setIsCreateAgentDialogOpen}
      agentableProjects={agentableProjects}
      createAgentDraft={createAgentDraft}
      setCreateAgentDraft={setCreateAgentDraft}
      createAgentDefaults={createAgentDefaults}
      createAgentSubmitting={createAgentSubmitting}
      createAgentFeedback={createAgentFeedback}
      setCreateAgentFeedback={setCreateAgentFeedback}
      handleBrowseCreateAgentProject={handleBrowseCreateAgentProject}
      handleCreateAgent={handleCreateAgent}
      availableAgentHarnesses={AVAILABLE_AGENT_HARNESSES}
      isFeedbackDialogOpen={isFeedbackDialogOpen}
      handleFeedbackDialogOpenChange={handleFeedbackDialogOpenChange}
      feedbackDraft={feedbackDraft}
      setFeedbackDraft={setFeedbackDraft}
      feedbackSubmission={feedbackSubmission}
      feedbackActionPending={feedbackActionPending}
      feedbackBundleLoading={feedbackBundleLoading}
      feedbackBundle={feedbackBundle}
      feedbackBundleError={feedbackBundleError}
      feedbackActionMessage={feedbackActionMessage}
      handleSubmitFeedbackReport={() => void handleSubmitFeedbackReport()}
      handleRefreshFeedbackBundle={() => void handleRefreshFeedbackBundle()}
      handleRepairSetup={() => void handleRepairSetup()}
      handleCopyFeedbackBundle={() => void handleCopyFeedbackBundle()}
      openFeedbackDialog={openFeedbackDialog}
      openKnowledgeBase={openKnowledgeBase}
      logsAttentionLevel={logsAttentionLevel}
      logsButtonTitle={logsButtonTitle}
      footerTimeLabel={footerTimeLabel}
    >
      {productSurface === 'relay' ? (
        <>
          <OverviewInboxActivityView
            activeView={activeView}
            overviewViewProps={{
              C,
              s,
              features: desktopFeatures,
              stats,
              runtime,
              machinesOnlineCount: machinesState?.onlineCount ?? 0,
              reachableAgents: reachableRelayAgents,
              activityMessages: activityRecentMessages,
              activityTasks,
              overviewSessions,
              overviewProjects,
              runningTaskCount: plansState?.runningTaskCount ?? 0,
              shellError,
              agentLookup: interAgentAgentLookup,
              onNavigate: setActiveView,
              onCreateAgent: handleOpenCreateAgentDialog,
              onRefresh: () => void handleRefreshShell(),
              onOpenAgent: openAgentProfile,
              onOpenSession: openSessionDetail,
              onOpenProject: openProjectSessions,
              onSelectRelay: openConversation,
              formatDate,
              colorForIdentity,
              cleanDisplayTitle,
              messagePreviewSnippet,
            }}
            inbox={{
              isCollapsed,
              sidebarWidth,
              onResizeStart: handleMouseDown,
              styles: {
                sidebar: s.sidebar,
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
              },
              inboxAlertCount,
              pendingApprovalsCount: pendingApprovals.length,
              inboxFailedTaskCount,
              inboxAwaitingYouItems,
            }}
            activity={{
              isCollapsed,
              sidebarWidth,
              onResizeStart: handleMouseDown,
              styles: {
                sidebar: s.sidebar,
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
              },
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
              onRefresh: () => void handleRefreshShell(),
              onOpenPlans: () => setActiveView('plans'),
              onOpenMessages: () => setActiveView('messages'),
              onOpenAgentProfile: openAgentProfile,
              onOpenSessionDetail: openSessionDetail,
            }}
          />
          <OpsViews
            activeView={activeView}
            machinesViewProps={{
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
              C,
              s,
              isCollapsed,
              sidebarWidth,
              onResizeStart: handleMouseDown,
              onOpenRelayAgent: openDirectConversation,
              onRefresh: () => void handleRefreshShell(),
              identityColor: colorForIdentity,
            }}
            plansViewProps={{
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
              C,
              s,
              isCollapsed,
              sidebarWidth,
              onResizeStart: handleMouseDown,
              onOpenRelayAgent: openDirectConversation,
              onRefresh: () => void handleRefreshShell(),
              identityColor: colorForIdentity,
            }}
            search={{
              isCollapsed,
              sidebarWidth,
              onResizeStart: handleMouseDown,
              styles: {
                sidebar: s.sidebar,
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activeItem: s.activeItem,
                kbd: s.kbd,
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
              onOpenSession: (session) => {
                setSelectedSession(session);
                setActiveView('sessions');
              },
            }}
          />
          <SettingsHelpView {...settingsHelpViewProps} />
          <AgentViews
            activeView={activeView}
            layout={{
              isCollapsed,
              sidebarWidth,
              onResizeStart: handleMouseDown,
              styles: {
                sidebar: s.sidebar,
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
                activeItem: s.activeItem,
                annotBadge: s.annotBadge,
              },
            }}
            roster={{
              interAgentStateTitle: interAgentState?.title ?? 'Inter-Agent',
              interAgentStateSubtitle: interAgentState?.subtitle ?? 'Agent-to-agent traffic',
              rosterInterAgentAgents,
              interAgentAgents,
              selectedInterAgentId,
              onSelectInterAgent: handleSelectInterAgent,
              agentRosterMenu,
              setAgentRosterMenu,
              agentRosterFilter,
              setAgentRosterFilter,
              agentRosterSort,
              setAgentRosterSort,
              rosterAgentTitleCounts,
              onRefresh: () => void handleRefreshShell(),
            }}
            agents={{
              selectedInterAgent,
              selectedInterAgentDirectThread,
              selectedInterAgentChatActionLabel,
              onOpenAgentThread: openDirectConversation,
              onPeekAgentSession: handlePeekAgentSession,
              onOpenAgentSettings: handleOpenAgentSettings,
              visibleAgentSession,
              agentSessionPending,
              agentSessionLoading,
              agentSessionFeedback,
              agentSessionCopied,
              onCopyAgentSessionCommand: () => void handleCopyAgentSessionCommand(),
              onOpenAgentSession: () => void handleOpenAgentSession(),
              agentSessionLogsExpanded,
              setAgentSessionLogsExpanded,
              agentSessionInlineViewportRef,
              onInlineAgentSessionScroll: handleInlineAgentSessionScroll,
              renderLocalPathValue,
              selectedInterAgentActivityMessages,
              interAgentAgentLookup,
              relayDirectLookup,
              onOpenAgentProfile: openAgentProfile,
              onNudgeMessage: nudgeMessage,
              selectedInterAgentInboundTasks,
              selectedInterAgentOutboundFindings,
              selectedInterAgentFindings,
              agentActivityExpanded,
              setAgentActivityExpanded,
              agentThreadsExpanded,
              setAgentThreadsExpanded,
              visibleInterAgentThreads,
              selectedInterAgentThreadId,
              onOpenThreadInTrafficView: (threadId) => {
                setSelectedInterAgentThreadId(threadId);
                setActiveView('inter-agent');
              },
              selectedAgentDirectLinePreview,
              agentSnapshotExpanded,
              setAgentSnapshotExpanded,
              visibleAgentConfig,
            }}
            logs={{
              logSources,
              filteredLogSources,
              selectedLogSourceId,
              setSelectedLogSourceId,
              selectedLogSource,
              logCatalog,
              logContent,
              logsLoading,
              logsFeedback,
              logSearchQuery,
              setLogSearchQuery,
              logSourceQuery,
              setLogSourceQuery,
            }}
            interAgent={{
              selectedInterAgent,
              visibleInterAgentThreads,
              selectedInterAgentThreadId,
              setSelectedInterAgentThreadId,
              interAgentThreadTitle,
              selectedInterAgentThread,
              selectedInterAgentThreadSubtitle,
              selectedRelayDirectThread: selectedDirectConversation,
              showAnnotations,
              setShowAnnotations,
              interAgentMessageTarget,
              openAgentDirectMessage,
              interAgentConfigureTarget,
              onOpenAgentSettings: handleOpenAgentSettings,
              interAgentConfigureLabel,
              visibleInterAgentMessages,
              interAgentAgentLookup,
              relayDirectLookup,
              onOpenAgentProfile: openAgentProfile,
              onNudgeMessage: nudgeMessage,
            }}
            sessions={{
              searchQuery,
              setSearchQuery,
              filteredSessions,
              stats: {
                totalSessions: stats.totalSessions,
              },
              onRefresh: () => void handleRefreshShell(),
              loadingSessions: isLoadingShell && !shellState,
              selectedSession,
              setSelectedSession,
              phonePreparationState,
              phonePreparationLoading,
              phonePreparationSaving,
              phonePreparationFeedback,
              setDraggedSessionId,
              setDraggedPhoneSection,
              favoritePhoneSessions,
              quickHitPhoneSessions,
              formatDate,
              onClearPhoneQuickHits: handleClearPhoneQuickHits,
              onDropIntoFavorites: handleDropIntoFavorites,
              onDropIntoQuickHits: handleDropIntoQuickHits,
              onRemoveSessionFromPhoneSection: handleRemoveSessionFromPhoneSection,
              onAddSessionToPhoneSection: handleAddSessionToPhoneSection,
            }}
          />
          <MessagesRelayView
            activeView={activeView}
            layout={{
              sidebarWidth,
              messagesDetailWidth,
              isCollapsed,
              onResizeStart: handleMouseDown,
              onMessagesDetailResizeStart: handleMessagesDetailResizeStart,
              styles: {
                sidebar: s.sidebar,
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                annotBadge: s.annotBadge,
                activeItem: s.activeItem,
                activePill: s.activePill,
                kbd: s.kbd,
              },
            }}
            threading={{
              messagesState,
              messageThreads,
              selectedMessagesThread,
              onSelectMessageThread: selectMessageThread,
              showAnnotations,
              setShowAnnotations,
              onRefresh: () => void handleRefreshShell(),
              selectedMessagesInternalThread,
              selectedMessagesInternalMessages,
              selectedMessagesInternalTarget,
              selectedMessagesDetailAgentId,
              selectedMessagesDetailAgent,
              selectedMessagesSessions,
              selectedSession,
              setSelectedSession,
              formatDate,
              interAgentAgents,
              interAgentAgentLookup,
              relayDirectLookup,
              openAgentProfile,
              openAgentDirectMessage,
              onNudgeMessage: nudgeMessage,
              messagesDetailOpen,
              setMessagesDetailOpen,
              messagesDetailTab,
              setMessagesDetailTab,
            }}
            composer={
              {
                selectedRelayKind: selectedConversationKind,
                selectedRelayId: selectedConversationId,
                relayThreadTitle: currentConversationTitle,
                relayThreadSubtitle: currentConversationSubtitle,
                relayThreadCount: currentConversationCount,
                selectedRelayDirectThread: selectedDirectConversation,
                relayVoiceState: relayState?.voice,
                visibleRelayMessages: visibleConversationMessages,
                relayTimelineViewportRef: timelineViewportRef,
                onRelayTimelineScroll: handleConversationTimelineScroll,
                relayReplyTarget: replyTarget,
                setRelayReplyTarget: setReplyTarget,
                relayContextReferences: contextReferences,
                relayContextMessageIds: contextMessageIds,
                setRelayContextMessageIds: setContextMessageIds,
                relayComposerRef: composerRef,
                relayDraft: composerDraft,
                setRelayDraft: setComposerDraft,
                relaySending: composerSending,
                relayFeedback: messagesFeedback,
                relayComposerSelectionStart: composerSelectionStart,
                setRelayComposerSelectionStart: setComposerSelectionStart,
                mergedRelayMessages: mergedConversationMessages,
                relayMentionMenuOpen: mentionMenuOpen,
                relayMentionSuggestions: mentionSuggestions,
                relayMentionSelectionIndex: mentionSelectionIndex,
                setRelayMentionSelectionIndex: setMentionSelectionIndex,
                relayMentionDuplicateTitleCounts: mentionDuplicateTitleCounts,
                applyRelayMentionSuggestion: applyMentionSuggestion,
                onRelaySend: () => void sendMessage(),
                onToggleVoiceCapture: () => void handleToggleVoiceCapture(),
                onSetVoiceRepliesEnabled: (enabled) => void handleSetVoiceRepliesEnabled(enabled),
              } satisfies MessagesRelayComposerProps
            }
            agentSession={{
              visibleAgentSession,
              agentSessionPending,
              agentSessionFeedback,
              agentSessionCopied,
              onCopyAgentSessionCommand: () => void handleCopyAgentSessionCommand(),
              onOpenAgentSession: () => void handleOpenAgentSession(),
              onPeekAgentSession: handlePeekAgentSession,
              onOpenAgentSettings: handleOpenAgentSettings,
              desktopVoiceEnabled: desktopFeatures.voice,
            }}
          />
        </>
      ) : null}
    </DesktopAppShellView>
  );
}
