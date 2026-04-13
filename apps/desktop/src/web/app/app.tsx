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
  asErrorMessage,
  compactHomePath,
  formatFooterTime,
  interAgentCounterparts,
  interAgentThreadSubtitle,
  interAgentThreadTitleForAgent,
  relayPresenceDotClass,
} from "@web/features/messages/lib/relay-utils";
import { DesktopAppShellView } from "@/components/views/desktop-app-shell-view";
import { OverviewInboxActivityView } from "@/components/views/overview-inbox-activity-view";
import { OpsViews } from "@/components/views/ops-views";
import { SettingsHelpView } from "@/components/views/settings-help-view";
import { OnboardingCommandShell, StartupOnboardingStepContent } from "@/components/views/startup-onboarding-view";
import { AgentViews } from "@/components/views/agent-views";
import { BootLoader } from "@/components/boot-loader";
import { getScoutDesktop } from "@/lib/desktop-bridge";
import { cn } from "@/lib/utils";
import { useAgentController } from "@/hooks/use-agent-controller";
import { useDiagnosticsController } from "@/hooks/use-diagnostics-controller";
import { usePairingController } from "@/hooks/use-pairing-controller";
import { usePhonePreparationController } from "@/hooks/use-phone-preparation-controller";
import { useRelaySurfaceViewProps } from "@/hooks/use-relay-surface-view-props";
import { useSettingsHelpViewProps } from "@/hooks/use-settings-help-view-props";
import { useSettingsController } from "@/hooks/use-settings-controller";
import { MessagesRelayView } from "@web/features/messages/components/messages-relay-view";
import { useMessagesController } from "@web/features/messages/hooks/use-messages-controller";
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
  DesktopHomeState,
  DesktopMessagesWorkspaceState,
  DesktopShellPatch,
  DesktopShellState,
  DesktopServicesState,
  MessagesThread,
  OnboardingCommandName,
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
const HOME_CACHE_KEY = 'scout.desktop.home-cache.v1';

type CachedHomeSnapshot = {
  savedAt: number;
  homeState: DesktopHomeState | null;
  servicesState: DesktopServicesState | null;
};

type DevLoadMetric = {
  label: string;
  durationMs: number;
  recordedAt: number;
  detail?: Record<string, unknown>;
};

type DevLoadMetrics = {
  services: DevLoadMetric | null;
  home: DevLoadMetric | null;
  workspace: DevLoadMetric | null;
};

function readCachedHomeSnapshot(): CachedHomeSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(HOME_CACHE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as CachedHomeSnapshot;
  } catch {
    return null;
  }
}

function writeCachedHomeSnapshot(snapshot: Omit<CachedHomeSnapshot, 'savedAt'>) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(HOME_CACHE_KEY, JSON.stringify({
      ...snapshot,
      savedAt: Date.now(),
    } satisfies CachedHomeSnapshot));
  } catch {
    // Ignore local storage failures in the desktop renderer.
  }
}

function captureLoadMetric(label: string, startedAt: number, detail?: Record<string, unknown>): DevLoadMetric {
  const metric = {
    label,
    durationMs: Math.round(performance.now() - startedAt),
    recordedAt: Date.now(),
    detail,
  } satisfies DevLoadMetric;

  console.info(`[scout] ${label}`, {
    durationMs: metric.durationMs,
    ...detail,
  });

  return metric;
}

function mergeMetricDetail(
  counts: Record<string, unknown>,
  performanceTrace?: { totalMs: number; steps: { label: string; durationMs: number }[] } | null,
): Record<string, unknown> | undefined {
  const detail: Record<string, unknown> = { ...counts };
  if (performanceTrace) {
    detail.Total = `${performanceTrace.totalMs}ms`;
    performanceTrace.steps.forEach((step) => {
      detail[step.label] = `${step.durationMs}ms`;
    });
  }
  return Object.keys(detail).length > 0 ? detail : undefined;
}

function pickMessagesWorkspaceState(
  nextState: Pick<DesktopShellState, "runtime" | "messages" | "sessions" | "relay" | "interAgent" | "performance">,
): DesktopMessagesWorkspaceState {
  return {
    runtime: nextState.runtime,
    messages: nextState.messages,
    sessions: nextState.sessions,
    relay: nextState.relay,
    interAgent: nextState.interAgent,
    performance: nextState.performance ?? null,
  };
}

function mergeRelayPatchPlans(
  currentPlans: DesktopShellState["plans"],
  nextPlans: DesktopShellPatch["plans"],
): DesktopShellState["plans"] {
  return {
    ...nextPlans,
    planCount: currentPlans.planCount,
    workspaceCount: currentPlans.workspaceCount,
    plans: currentPlans.plans,
    subtitle: `${nextPlans.taskCount} asks · ${nextPlans.findingCount} findings · ${currentPlans.planCount} plans · ${currentPlans.workspaceCount} workspaces`,
  };
}

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
  const [homeState, setHomeState] = useState<DesktopHomeState | null>(null);
  const [servicesState, setServicesState] = useState<DesktopServicesState | null>(null);
  const [messagesWorkspaceState, setMessagesWorkspaceState] = useState<DesktopMessagesWorkspaceState | null>(null);
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [loadMetrics, setLoadMetrics] = useState<DevLoadMetrics>({
    services: null,
    home: null,
    workspace: null,
  });
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  const [isLoadingHome, setIsLoadingHome] = useState(true);
  const [isLoadingMessagesWorkspace, setIsLoadingMessagesWorkspace] = useState(false);
  const [isLoadingShell, setIsLoadingShell] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [appReloadPending, setAppReloadPending] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('profile');
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const cachedHomeStateRef = useRef<DesktopHomeState | null>(null);
  const cachedServicesStateRef = useRef<DesktopServicesState | null>(null);
  const homeBootstrappedRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  /** Deep links and browser navigation: /settings/* → in-app settings view. */
  useLayoutEffect(() => {
    if (!location.pathname.startsWith("/settings")) {
      return;
    }
    const settingsPath = parseSettingsPath(location.pathname);
    if (settingsPath) {
      setProductSurface("relay");
      setActiveView("settings");
      setSettingsSection(settingsPath.section);
      setSettingsAgentId(settingsPath.agentId);
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
    const nextPath = buildDesktopPath(productSurface, activeView, settingsSection, settingsAgentId);
    if (location.pathname === nextPath) {
      return;
    }

    navigate(nextPath, { replace: true });
  }, [activeView, location.pathname, navigate, productSurface, settingsAgentId, settingsSection]);

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
  const homeStateLoadInFlightRef = useRef(false);
  const servicesStateLoadInFlightRef = useRef(false);
  const messagesWorkspaceLoadInFlightRef = useRef(false);
  const shellStateLoadInFlightRef = useRef(false);

  const messagesWorkspaceRequired = productSurface === 'relay' && (
    activeView === 'messages'
    || activeView === 'relay'
  );
  const sessions = messagesWorkspaceRequired
    ? (messagesWorkspaceState?.sessions ?? shellState?.sessions ?? [])
    : (shellState?.sessions ?? []);
  const machinesState = shellState?.machines ?? null;
  const plansState = shellState?.plans ?? null;
  const messagesState = messagesWorkspaceRequired
    ? (messagesWorkspaceState?.messages ?? shellState?.messages ?? null)
    : (shellState?.messages ?? null);
  const runtime = messagesWorkspaceRequired
    ? (messagesWorkspaceState?.runtime ?? shellState?.runtime ?? null)
    : (shellState?.runtime ?? null);
  const relayState = messagesWorkspaceRequired
    ? (messagesWorkspaceState?.relay ?? shellState?.relay ?? null)
    : (shellState?.relay ?? null);
  const interAgentState = messagesWorkspaceRequired
    ? (messagesWorkspaceState?.interAgent ?? shellState?.interAgent ?? null)
    : (shellState?.interAgent ?? null);
  const interAgentAgents = interAgentState?.agents ?? [];
  const interAgentThreads = interAgentState?.threads ?? [];
  const desktopFeatures = scoutAppInfo?.features ?? shellState?.appInfo.features ?? DEFAULT_DESKTOP_FEATURES;
  const surfaceCaps = scoutAppInfo?.capabilities ?? shellState?.appInfo.capabilities;

  useEffect(() => {
    cachedHomeStateRef.current = homeState;
  }, [homeState]);

  useEffect(() => {
    cachedServicesStateRef.current = servicesState;
  }, [servicesState]);

  const persistCachedHome = React.useCallback((nextHomeState: DesktopHomeState | null, nextServicesState: DesktopServicesState | null) => {
    writeCachedHomeSnapshot({
      homeState: nextHomeState,
      servicesState: nextServicesState,
    });
  }, []);
  const loadServicesState = React.useCallback(async () => {
    if (!scoutDesktop?.getServicesState) {
      return null;
    }

    if (servicesStateLoadInFlightRef.current) {
      return null;
    }

    const startedAt = performance.now();
    setIsLoadingServices(true);
    servicesStateLoadInFlightRef.current = true;
    try {
      const nextState = await scoutDesktop.getServicesState();
      setServicesState(nextState);
      persistCachedHome(cachedHomeStateRef.current, nextState);
      setLoadMetrics((current) => ({
        ...current,
        services: captureLoadMetric(
          'services-state',
          startedAt,
          mergeMetricDetail(
            { serviceCount: nextState.services.length },
            nextState.performance,
          ),
        ),
      }));
      return nextState;
    } catch (error) {
      setShellError(asErrorMessage(error));
      return null;
    } finally {
      servicesStateLoadInFlightRef.current = false;
      setIsLoadingServices(false);
    }
  }, [persistCachedHome, scoutDesktop]);
  const loadHomeState = React.useCallback(async (withSpinner = false) => {
    if (!scoutDesktop?.getHomeState) {
      setShellError("Desktop bridge is unavailable.");
      setIsLoadingHome(false);
      return null;
    }

    if (homeStateLoadInFlightRef.current) {
      return null;
    }

    if (withSpinner) {
      setIsLoadingHome(true);
    }

    const startedAt = performance.now();
    homeStateLoadInFlightRef.current = true;
    try {
      const nextState = await scoutDesktop.getHomeState();
      setHomeState(nextState);
      setShellError(null);
      persistCachedHome(nextState, cachedServicesStateRef.current);
      setLoadMetrics((current) => ({
        ...current,
        home: captureLoadMetric(
          'home-state',
          startedAt,
          mergeMetricDetail(
            {
              agents: nextState.agents.length,
              activity: nextState.activity.length,
            },
            nextState.performance,
          ),
        ),
      }));
      return nextState;
    } catch (error) {
      setShellError(asErrorMessage(error));
      return null;
    } finally {
      homeStateLoadInFlightRef.current = false;
      setIsLoadingHome(false);
    }
  }, [persistCachedHome, scoutDesktop]);
  const loadMessagesWorkspaceState = React.useCallback(async (withSpinner = false) => {
    if (!scoutDesktop?.getMessagesWorkspaceState) {
      setShellError("Desktop bridge is unavailable.");
      setIsLoadingMessagesWorkspace(false);
      return null;
    }

    if (messagesWorkspaceLoadInFlightRef.current) {
      return null;
    }

    if (withSpinner) {
      setIsLoadingMessagesWorkspace(true);
    }

    messagesWorkspaceLoadInFlightRef.current = true;
    const startedAt = performance.now();
    try {
      const nextState = await scoutDesktop.getMessagesWorkspaceState();
      setMessagesWorkspaceState(nextState);
      setShellError(null);
      setLoadMetrics((current) => ({
        ...current,
        workspace: captureLoadMetric(
          'messages-workspace',
          startedAt,
          mergeMetricDetail(
            {
              threads: nextState.messages.threads.length,
              messages: nextState.relay.messages.length,
              agents: nextState.interAgent.agents.length,
              sessions: nextState.sessions.length,
            },
            nextState.performance,
          ),
        ),
      }));
      return nextState;
    } catch (error) {
      setShellError(asErrorMessage(error));
      return null;
    } finally {
      messagesWorkspaceLoadInFlightRef.current = false;
      setIsLoadingMessagesWorkspace(false);
    }
  }, [scoutDesktop]);
  const loadShellState = React.useCallback(async (withSpinner = false) => {
    if (!scoutDesktop?.getShellState) {
      setShellError("Desktop bridge is unavailable.");
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
    const startedAt = performance.now();
    try {
      const nextState = await scoutDesktop.getShellState();
      setShellState(nextState);
      setShellError(null);
      setLoadMetrics((current) => ({
        ...current,
        workspace: captureLoadMetric(
          'relay-workspace',
          startedAt,
          mergeMetricDetail(
            {
              messages: nextState.relay.messages.length,
              agents: nextState.interAgent.agents.length,
              sessions: nextState.sessions.length,
            },
            nextState.performance,
          ),
        ),
      }));
      return nextState;
    } catch (error) {
      setShellError(asErrorMessage(error));
      return null;
    } finally {
      shellStateLoadInFlightRef.current = false;
      setIsLoadingShell(false);
    }
  }, [scoutDesktop]);
  const applyRelayWorkspacePatch = React.useCallback((
    nextState: DesktopShellPatch,
  ) => {
    setShellState((current) => (
      current
        ? {
            ...current,
            ...nextState,
            relay: {
              ...nextState.relay,
              voice: current.relay.voice,
            },
            plans: mergeRelayPatchPlans(current.plans, nextState.plans),
          }
        : current
    ));
    setMessagesWorkspaceState((current) => (
      current
        ? {
            ...current,
            ...pickMessagesWorkspaceState(nextState),
            relay: {
              ...nextState.relay,
              voice: current.relay.voice,
            },
          }
        : current
    ));
  }, []);

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
    const brokerReachable = nextShellState?.runtime?.brokerReachable
      ?? servicesState?.services.find((service) => service.id === 'broker')?.reachable
      ?? false;

    setProductSurface('relay');
    if (brokerReachable) {
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
  }, [servicesState]);

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

  const messagesController = useMessagesController({
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
    applyRelayWorkspacePatch,
  });

  const {
    selectedConversationKind,
    setSelectedConversationKind,
    selectedConversationId,
    setSelectedConversationId,
    selectedMessageThreadId,
    setSelectedMessageThreadId,
    selectedMessagesThread,
    selectedMessagesDetailAgentId,
    messagesFeedback,
    setMessagesFeedback,
    mergedConversationMessages,
    openConversation,
    openDirectConversation,
  } = messagesController;

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

  const phonePreparationController = usePhonePreparationController({
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
    isFeedbackDialogOpen,
    feedbackBundle,
    feedbackBundleLoading,
    feedbackBundleError,
    feedbackDraft,
    setFeedbackDraft,
    feedbackSubmission,
    feedbackActionPending,
    feedbackActionMessage,
    refreshLogs,
    refreshBrokerInspector,
    openFeedbackDialog,
    handleFeedbackDialogOpenChange,
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
    setSettingsAgentId,
    setShellState,
    setShellError,
    setRelayFeedback: setMessagesFeedback,
  });

  const {
    selectedInterAgentId,
    selectedInterAgentThreadId,
    setSelectedInterAgentThreadId,
    selectedInterAgent,
    visibleInterAgentThreads,
    selectedInterAgentThread,
    handleSelectInterAgent,
    deactivateAgentConfigEdit,
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
    agentSessionPeekViewportRef,
    handlePeekAgentSessionScroll,
    handleOpenAgentSession,
    handleCopyAgentSessionCommand,
    handlePeekAgentSession,
    refreshAgentSession,
  } = agentController;

  useEffect(() => {
    if (activeView !== 'settings' || settingsSection !== 'agents') {
      return;
    }

    if (!settingsAgentId) {
      deactivateAgentConfigEdit();
      return;
    }

    if (selectedInterAgentId === settingsAgentId) {
      return;
    }

    handleSelectInterAgent(settingsAgentId);
  }, [
    activeView,
    deactivateAgentConfigEdit,
    handleSelectInterAgent,
    selectedInterAgentId,
    settingsAgentId,
    settingsSection,
  ]);

  const relayWorkspaceRequired = productSurface === 'relay' && (
    activeView === 'inbox'
    || activeView === 'activity'
    || activeView === 'machines'
    || activeView === 'plans'
    || activeView === 'sessions'
    || activeView === 'search'
    || activeView === 'inter-agent'
    || activeView === 'agents'
    || activeView === 'logs'
    || (activeView === 'settings' && (
      settingsSection === 'agents'
      || settingsSection === 'communication'
      || settingsSection === 'database'
    ))
  );
  const relayPatchRefreshRequired = productSurface === 'relay' && (
    activeView === 'inbox'
    || activeView === 'activity'
    || activeView === 'messages'
    || activeView === 'relay'
    || activeView === 'agents'
    || activeView === 'inter-agent'
    || activeView === 'sessions'
    || activeView === 'search'
  );

  useEffect(() => {
    if (homeBootstrappedRef.current || !scoutDesktop) {
      return;
    }

    homeBootstrappedRef.current = true;
    const cached = readCachedHomeSnapshot();
    if (cached?.servicesState) {
      setServicesState(cached.servicesState);
    }
    if (cached?.homeState) {
      setHomeState(cached.homeState);
      setIsLoadingHome(false);
    }

    void loadServicesState();
    void loadHomeState(!cached?.homeState);
  }, [loadHomeState, loadServicesState, scoutDesktop]);

  useEffect(() => {
    if (startupOnboardingBlocking || !messagesWorkspaceRequired || messagesWorkspaceState) {
      return;
    }

    if (shellState) {
      setMessagesWorkspaceState(pickMessagesWorkspaceState(shellState));
      return;
    }

    void loadMessagesWorkspaceState(true);
  }, [
    loadMessagesWorkspaceState,
    messagesWorkspaceRequired,
    messagesWorkspaceState,
    shellState,
    startupOnboardingBlocking,
  ]);

  useEffect(() => {
    if (startupOnboardingBlocking || !relayWorkspaceRequired || shellState) {
      return;
    }

    void loadShellState(true);
  }, [loadShellState, relayWorkspaceRequired, shellState, startupOnboardingBlocking]);

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

  useEffect(() => {
    if (!runtime) {
      return;
    }

    setServicesState((current) => {
      if (!current) {
        return current;
      }

      const nextState: DesktopServicesState = {
        ...current,
        updatedAtLabel: runtime.updatedAtLabel ?? current.updatedAtLabel,
        services: current.services.map((service) => {
          if (service.id === 'broker') {
            return {
              ...service,
              status: runtime.brokerReachable
                ? runtime.brokerHealthy ? 'running' : 'degraded'
                : 'offline',
              statusLabel: runtime.brokerReachable
                ? runtime.brokerHealthy ? 'Running' : 'Degraded'
                : 'Offline',
              healthy: runtime.brokerHealthy,
              reachable: runtime.brokerReachable,
              detail: runtime.brokerLabel,
              updatedAtLabel: runtime.updatedAtLabel ?? service.updatedAtLabel,
              url: runtime.brokerUrl,
              nodeId: runtime.nodeId,
            };
          }

          if (service.id === 'helper') {
            return {
              ...service,
              status: runtime.helperRunning ? 'running' : 'offline',
              statusLabel: runtime.helperRunning ? 'Running' : 'Offline',
              healthy: runtime.helperRunning,
              reachable: runtime.helperRunning,
              detail: runtime.helperDetail,
              updatedAtLabel: runtime.updatedAtLabel ?? service.updatedAtLabel,
            };
          }

          return service;
        }),
      };

      persistCachedHome(homeState, nextState);
      return nextState;
    });
  }, [homeState, persistCachedHome, runtime]);

  useEffect(() => {
    if (!relayState) {
      return;
    }

    const nextHomeState: DesktopHomeState = {
      title: 'Home',
      subtitle: `${relayState.directs.length} agents · ${relayState.messages.filter((message) => !message.isVoice).length} recent updates`,
      updatedAtLabel: relayState.lastUpdatedLabel ?? runtime?.updatedAtLabel ?? null,
      agents: relayState.directs.slice(0, 24).map((thread) => ({
        id: thread.id,
        title: thread.title,
        role: null,
        summary: thread.preview,
        projectRoot: null,
        state: thread.state,
        reachable: thread.reachable,
        statusLabel: thread.statusLabel,
        statusDetail: thread.statusDetail,
        activeTask: thread.activeTask,
        timestampLabel: thread.timestampLabel,
      })),
      activity: relayState.messages
        .filter((message) => !message.isVoice)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 24)
        .map((message) => ({
          id: message.id,
          kind: message.isSystem ? 'system' : 'message',
          actorId: message.authorId,
          actorName: message.authorName,
          title: message.authorName,
          detail: message.body,
          conversationId: message.conversationId,
          channel: message.normalizedChannel,
          timestamp: message.createdAt,
          timestampLabel: message.timestampLabel,
        })),
      recentSessions: [...sessions]
        .sort((left, right) => new Date(right.lastModified).getTime() - new Date(left.lastModified).getTime())
        .slice(0, 6),
    };

    setHomeState(nextHomeState);
    persistCachedHome(nextHomeState, servicesState);
  }, [persistCachedHome, relayState, runtime?.updatedAtLabel, servicesState, sessions]);

  const homeAgents = homeState?.agents ?? [];
  const homeActivity = homeState?.activity ?? [];
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
  const brokerService = servicesState?.services.find((service) => service.id === 'broker') ?? null;
  const reachableHomeAgentCount = homeAgents.filter((agent) => agent.reachable).length;
  const headerAgentCount = homeAgents.length > 0 ? homeAgents.length : (runtime?.agentCount ?? 0);
  const relayRuntimeBooting = !startupOnboardingBlocking
    && isLoadingHome
    && !servicesState
    && !homeState
    && !shellError;
  const relayStatusLabel = relayRuntimeBooting
    ? 'Syncing…'
    : brokerService?.statusLabel ?? (
      runtime?.brokerReachable ? 'Running' : 'Offline'
    );
  const relayStatusTitle = relayRuntimeBooting
    ? 'Checking relay health.'
    : brokerService?.detail
      ? `Relay diagnostics · ${brokerService.detail}`
      : brokerService?.reachable || runtime?.brokerReachable
        ? 'Open Relay diagnostics'
        : 'Relay is offline. Open diagnostics.';
  const relayStatusDotClassName = relayRuntimeBooting
    ? 'bg-sky-500 animate-pulse'
    : brokerService?.status === 'running' || runtime?.brokerReachable
      ? 'bg-emerald-500'
      : brokerService?.status === 'degraded'
        ? 'bg-amber-500'
        : 'bg-slate-400';
  const relayRuntimeHealthLabel = relayRuntimeBooting
    ? 'Syncing'
    : brokerService?.healthy || runtime?.brokerHealthy
      ? 'Healthy'
      : brokerService?.reachable || runtime?.brokerReachable
        ? 'Reachable'
        : 'Offline';
  const logsAttentionLevel = useMemo<'error' | 'warning' | null>(() => {
    if (shellError || relayState?.voice.captureState === 'error') {
      return 'error';
    }
    if (relayRuntimeBooting) {
      return null;
    }
    if (brokerService && (!brokerService.reachable || !brokerService.healthy)) {
      return 'warning';
    }
    if (runtime && (!runtime.brokerReachable || !runtime.brokerHealthy)) {
      return 'warning';
    }
    return null;
  }, [brokerService, relayRuntimeBooting, relayState?.voice.captureState, runtime, shellError]);
  const logsButtonTitle = logsAttentionLevel === 'error'
    ? 'Logs · attention required'
    : logsAttentionLevel === 'warning'
      ? 'Logs · check runtime warnings'
      : 'Logs';
  const footerTimeLabel = formatFooterTime(new Date());
  const showDevLoadMetrics = true;
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

      if (activeView === 'overview') {
        await Promise.all([
          loadServicesState(),
          loadHomeState(!homeState),
        ]);
      } else if (relayPatchRefreshRequired && scoutDesktop?.refreshRelayShellPatch) {
        const nextState = await scoutDesktop.refreshRelayShellPatch();
        applyRelayWorkspacePatch(nextState);
        setShellError(null);
      } else if (messagesWorkspaceRequired) {
        await loadMessagesWorkspaceState(true);
      } else if (relayWorkspaceRequired && scoutDesktop?.refreshShellState) {
        const nextState = await scoutDesktop.refreshShellState();
        setShellState(nextState);
        setShellError(null);
      } else if (relayWorkspaceRequired) {
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
      setShellError("Desktop bridge is unavailable.");
      return;
    }

    try {
      const nextState = await scoutDesktop.toggleVoiceCapture();
      setShellState(nextState);
      setMessagesWorkspaceState((current) => (
        current ? pickMessagesWorkspaceState(nextState) : current
      ));
      setShellError(null);
      setMessagesFeedback(nextState.relay.voice.isCapturing ? 'Voice capture started.' : 'Voice capture stopped.');
    } catch (error) {
      setMessagesFeedback(asErrorMessage(error));
    }
  };

  const handleSetVoiceRepliesEnabled = async (enabled: boolean) => {
    if (!scoutDesktop?.setVoiceRepliesEnabled) {
      setShellError("Desktop bridge is unavailable.");
      return;
    }

    try {
      const nextState = await scoutDesktop.setVoiceRepliesEnabled(enabled);
      setShellState(nextState);
      setMessagesWorkspaceState((current) => (
        current ? pickMessagesWorkspaceState(nextState) : current
      ));
      setShellError(null);
      setMessagesFeedback(enabled ? 'Playback enabled.' : 'Playback disabled.');
    } catch (error) {
      setMessagesFeedback(asErrorMessage(error));
    }
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
    settingsAgentId,
    setSettingsAgentId,
    settingsSections,
    activeSettingsMeta,
    desktopFeatures,
    stats,
    runtime,
    relayState,
    relayRuntimeBooting,
    relayRuntimeHealthLabel,
    reachableRelayAgentCount: reachableHomeAgentCount,
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

  const relaySurfaceViewProps = useRelaySurfaceViewProps({
    activeView,
    setActiveView,
    desktopFeatures,
    styles: {
      sidebar: s.sidebar,
      surface: s.surface,
      inkText: s.inkText,
      mutedText: s.mutedText,
      tagBadge: s.tagBadge,
      activePill: s.activePill,
      activeItem: s.activeItem,
      annotBadge: s.annotBadge,
      kbd: s.kbd,
    },
    colorTheme: C,
    sidebarWidth,
    messagesDetailWidth,
    isCollapsed,
    onResizeStart: handleMouseDown,
    onMessagesDetailResizeStart: handleMessagesDetailResizeStart,
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
    pendingApprovalsCount: pendingApprovals.length,
    inboxFailedTaskCount,
    inboxAwaitingYouItems,
    availableAgentNames,
    searchQuery,
    setSearchQuery,
    filteredSessions,
    selectedSession,
    setSelectedSession,
    isLoadingMessagesWorkspace,
    isLoadingShell,
    showAnnotations,
    setShowAnnotations,
    messagesDetailOpen,
    setMessagesDetailOpen,
    messagesDetailTab,
    setMessagesDetailTab,
    formatDate,
    onRefreshShell: () => void handleRefreshShell(),
    openAgentProfile,
    openSessionDetail,
    handleSelectSearchSession: (session) => {
      setSelectedSession(session);
      setActiveView('sessions');
    },
    handleToggleVoiceCapture: () => void handleToggleVoiceCapture(),
    handleSetVoiceRepliesEnabled: (enabled) => void handleSetVoiceRepliesEnabled(enabled),
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
    relayVoiceState: relayState?.voice,
    messagesController,
    agentController,
    diagnosticsController,
    phonePreparationController,
    overviewBootLoader: !startupOnboardingBlocking && isLoadingHome && !homeState && !shellError
      ? <BootLoader dark={dark} C={C} s={s} />
      : null,
  });

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
    <>
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
        headerAgentCount={headerAgentCount}
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
            <OverviewInboxActivityView {...relaySurfaceViewProps.overviewInboxActivityViewProps} />
            <OpsViews {...relaySurfaceViewProps.opsViewsProps} />
            <SettingsHelpView {...settingsHelpViewProps} />
            <AgentViews {...relaySurfaceViewProps.agentViewsProps} />
            <MessagesRelayView {...relaySurfaceViewProps.messagesRelayViewProps} />
          </>
        ) : null}
      </DesktopAppShellView>

      {showDevLoadMetrics ? (
        <div className="pointer-events-none fixed right-4 top-20 z-40">
          <div
            className="w-[220px] rounded-2xl border px-4 py-3 shadow-[0_18px_48px_rgba(15,23,42,0.12)]"
            style={{
              backgroundColor: dark ? 'rgba(17, 24, 39, 0.9)' : 'rgba(255,255,255,0.92)',
              borderColor: C.border,
              backdropFilter: 'blur(10px)',
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.16em]" style={s.mutedText}>
                Dev Load Times
              </div>
              <div className="text-[10px]" style={s.mutedText}>
                live
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {([
                {
                  key: 'services',
                  title: 'Relay health',
                  metric: loadMetrics.services,
                  loading: isLoadingServices,
                  idleLabel: '—',
                  idleDetail: 'No measurement yet',
                },
                {
                  key: 'home',
                  title: 'Home data',
                  metric: loadMetrics.home,
                  loading: isLoadingHome,
                  idleLabel: '—',
                  idleDetail: 'No measurement yet',
                },
                {
                  key: 'workspace',
                  title: 'Workspace',
                  metric: loadMetrics.workspace,
                  loading: messagesWorkspaceRequired
                    ? isLoadingMessagesWorkspace
                    : relayWorkspaceRequired && isLoadingShell,
                  idleLabel: messagesWorkspaceRequired || relayWorkspaceRequired ? '—' : 'deferred',
                  idleDetail: messagesWorkspaceRequired || relayWorkspaceRequired
                    ? 'No measurement yet'
                    : 'Loads only on workspace-heavy surfaces',
                },
              ] as const).map((entry) => (
                <div
                  key={entry.key}
                  className="rounded-xl border px-3 py-2"
                  style={{
                    borderColor: C.border,
                    backgroundColor: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.025)',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-medium" style={s.inkText}>
                      {entry.title}
                    </div>
                    <div className="text-[11px] font-mono" style={entry.loading ? { color: C.accent } : s.inkText}>
                      {entry.loading ? 'loading…' : entry.metric ? `${entry.metric.durationMs}ms` : entry.idleLabel}
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] leading-[1.5]" style={s.mutedText}>
                    {entry.metric
                      ? `${entry.metric.label} · ${new Date(entry.metric.recordedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
                      : entry.idleDetail}
                  </div>
                  {entry.metric?.detail ? (
                    <div className="mt-2 space-y-1">
                      {Object.entries(entry.metric.detail).slice(0, 8).map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-3 text-[10px]" style={s.mutedText}>
                          <span className="truncate">{label}</span>
                          <span className="font-mono shrink-0" style={s.inkText}>{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
