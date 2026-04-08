"use client";

import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Bell,
  Copy,
  Bot,
  BookOpen,
  Check,
  CheckCheck,
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
  SendHorizontal,
  Radar,
  Terminal,
  X,
  FolderOpen,
  Clock,
  ChevronRight,
  FileJson,
  Tag,
  Calendar,
  Folder,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  AtSign,
  MoreHorizontal,
  Mic,
  Reply,
  Smartphone,
  Star,
  Sun,
  Moon,
  Eye,
  GitBranch,
  List,
  Settings2,
} from 'lucide-react';
import { MessagesView } from "@/components/messages-view";
import MachinesView from "@/components/machines-view";
import { OverviewView } from "@/components/overview-view";
import PlansView from "@/components/plans-view";
import { AgentSettingsView } from "@/components/agent-settings-view";
import { CommunicationSettingsView } from "@/components/communication-settings-view";
import {
  PairingSurfacePlaceholder,
  ProductSurfaceLogo,
  describePairingSurfaceBadge,
} from "@/components/pairing-surface-placeholder";
import {
  AgentActionButton,
  InterAgentIcon,
  RelayTimeline,
  buildOptimisticRelayMessage,
  copyTextToClipboard,
  generateClientMessageId,
} from "@/components/relay/relay-timeline";
import {
  agentRosterFilterLabel,
  agentRosterSecondaryText,
  agentRosterSortLabel,
  asErrorMessage,
  buildRelayConversationItems,
  buildRelayFeedItems,
  cleanDisplayTitle,
  compactHomePath,
  compareAgentRoster,
  filterRelayMessages,
  findActiveRelayMention,
  firstInterAgentThreadIdForAgent,
  formatFooterTime,
  interAgentCounterparts,
  interAgentProfileKindLabel,
  interAgentThreadSubtitle,
  interAgentThreadTitleForAgent,
  isAgentRosterActive,
  messagePreviewSnippet,
  parseCapabilityText,
  scoreRelayMentionCandidate,
  serializeAppSettings,
  serializeEditableAgentConfig,
  colorForIdentity,
  relayPresenceDotClass,
  relaySecondaryText,
  resolveRelayDestination,
} from "@/components/relay/relay-utils";
import type {
  AgentRosterFilterMode,
  AgentRosterSortMode,
  RelayActiveMention,
  RelayMentionCandidate,
} from "@/components/relay/relay-types";
import { WorkspaceExplorerView } from "@/components/workspace-explorer-view";
import { OverviewInboxActivityView } from "@/components/views/overview-inbox-activity-view";
import { OpsViews } from "@/components/views/ops-views";
import { SettingsHelpView } from "@/components/views/settings-help-view";
import { AgentViews } from "@/components/views/agent-views";
import { MessagesRelayView, type MessagesRelayComposerProps } from "@/components/views/messages-relay-view";
import { StartupSplashOverlay } from "@/components/startup-splash";
import { BootLoader } from "@/components/boot-loader";
import { LogPanel } from "@/components/log-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { getScoutDesktop } from "@/lib/electron";
import { cn } from "@/lib/utils";
import {
  parseSettingsPath,
  type SettingsSectionId,
} from "@/settings/settings-paths";
import { C } from "@/lib/theme";
import {
  type AppView,
  type ComposerRelayReference,
  type CreateAgentDraft,
  type InboxItem,
  type InboxItemTone,
  type MessagesDetailTab,
  type NavViewItem,
  type OnboardingWizardStepId,
  type PendingRelayMessage,
  type ProductSurface,
  type SettingsSectionMeta,
  type WorkspaceExplorerFilterTab,
  type WorkspaceExplorerViewMode,
} from "@/app-types";
import {
  buildDesktopPath,
  parseRelayViewPath,
} from "@/app-routing";
import {
  buildDefaultCreateAgentDraft,
  normalizeCreateAgentHarness,
  pairingStatesMeaningfullyEqual,
} from "@/app-utils";
import type {
  AgentSessionInspector,
  AgentConfigState,
  AppSettingsState,
  BrokerControlAction,
  DesktopBrokerInspector,
  DesktopFeedbackBundle,
  DesktopFeedbackSubmission,
  DesktopFeatureFlags,
  HiddenProjectSummary,
  PairingState,
  DesktopLogCatalog,
  DesktopLogContent,
  DesktopLogSource,
  DesktopShellState,
  SetupProjectSummary,
  InterAgentAgent,
  InterAgentThread,
  MessagesThread,
  OnboardingCommandName,
  OnboardingCommandResult,
  PhonePreparationState,
  RelayDirectThread,
  RelayDestinationKind,
  RelayMessage,
  RelayNavItem,
  SessionMetadata,
  DesktopAppInfo,
  SubmitFeedbackReportInput,
  UpdatePairingConfigInput,
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

const ONBOARDING_WIZARD_STEP_ORDER: OnboardingWizardStepId[] = [
  'welcome',
  'source-roots',
  'harness',
  'confirm',
  'setup',
  'doctor',
  'runtimes',
];

const SOURCE_ROOT_PATH_SUGGESTIONS = ['~/dev', '~/src', '~/code'];
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
  const [selectedMessagesThreadId, setSelectedMessagesThreadId] = useState<string | null>(null);
  const [messagesDetailOpen, setMessagesDetailOpen] = useState(true);
  const [messagesDetailTab, setMessagesDetailTab] = useState<MessagesDetailTab>('overview');
  const [phonePreparation, setPhonePreparation] = useState<PhonePreparationState | null>(null);
  const [phonePreparationLoading, setPhonePreparationLoading] = useState(false);
  const [phonePreparationSaving, setPhonePreparationSaving] = useState(false);
  const [phonePreparationFeedback, setPhonePreparationFeedback] = useState<string | null>(null);
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [draggedPhoneSection, setDraggedPhoneSection] = useState<'favorites' | 'quickHits' | null>(null);
  const [scoutAppInfo, setScoutAppInfo] = useState<DesktopAppInfo | null>(null);
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [isLoadingShell, setIsLoadingShell] = useState(true);
  const [shellError, setShellError] = useState<string | null>(null);
  const [pairingState, setPairingState] = useState<PairingState | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingControlPending, setPairingControlPending] = useState(false);
  const [pairingConfigPending, setPairingConfigPending] = useState(false);
  const [pairingApprovalPendingId, setPairingApprovalPendingId] = useState<string | null>(null);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [appReloadPending, setAppReloadPending] = useState(false);
  const [pairingConfigFeedback, setPairingConfigFeedback] = useState<string | null>(null);
  const [selectedRelayKind, setSelectedRelayKind] = useState<RelayDestinationKind>('channel');
  const [selectedRelayId, setSelectedRelayId] = useState('shared');
  const [relayDraft, setRelayDraft] = useState('');
  const [relaySending, setRelaySending] = useState(false);
  const [relayComposerSelectionStart, setRelayComposerSelectionStart] = useState(0);
  const [relayMentionSelectionIndex, setRelayMentionSelectionIndex] = useState(0);
  const [relayFeedback, setRelayFeedback] = useState<string | null>(null);
  const [relayTimelinePinnedToBottom, setRelayTimelinePinnedToBottom] = useState(true);
  const [relayReplyTarget, setRelayReplyTarget] = useState<{
    messageId: string;
    authorId: string;
    authorName: string;
    preview: string;
  } | null>(null);
  const [relayContextMessageIds, setRelayContextMessageIds] = useState<string[]>([]);
  const [pendingRelayMessages, setPendingRelayMessages] = useState<PendingRelayMessage[]>([]);
  const [pendingRelayComposerFocusTick, setPendingRelayComposerFocusTick] = useState(0);
  const [selectedInterAgentId, setSelectedInterAgentId] = useState<string | null>(null);
  const [selectedInterAgentThreadId, setSelectedInterAgentThreadId] = useState<string | null>(null);
  const [selectedAgentableProjectId, setSelectedAgentableProjectId] = useState<string | null>(null);
  const [agentRosterFilter, setAgentRosterFilter] = useState<AgentRosterFilterMode>('all');
  const [agentRosterSort, setAgentRosterSort] = useState<AgentRosterSortMode>('chat');
  const [agentThreadsExpanded, setAgentThreadsExpanded] = useState(false);
  const [agentSnapshotExpanded, setAgentSnapshotExpanded] = useState(false);
  const [agentActivityExpanded, setAgentActivityExpanded] = useState(false);
  const [agentSessionLogsExpanded, setAgentSessionLogsExpanded] = useState(false);
  const [agentRosterMenu, setAgentRosterMenu] = useState<null | 'filter' | 'sort'>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfigState | null>(null);
  const [agentConfigDraft, setAgentConfigDraft] = useState<AgentConfigState | null>(null);
  const [agentConfigLoading, setAgentConfigLoading] = useState(false);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigRestarting, setAgentConfigRestarting] = useState(false);
  const [agentConfigFeedback, setAgentConfigFeedback] = useState<string | null>(null);
  const [pendingConfigFocusAgentId, setPendingConfigFocusAgentId] = useState<string | null>(null);
  const [isAgentConfigEditing, setIsAgentConfigEditing] = useState(false);
  const [isCreateAgentDialogOpen, setIsCreateAgentDialogOpen] = useState(false);
  const [createAgentDraft, setCreateAgentDraft] = useState<CreateAgentDraft>({
    projectPath: '',
    agentName: '',
    harness: 'claude',
  });
  const [createAgentSubmitting, setCreateAgentSubmitting] = useState(false);
  const [createAgentFeedback, setCreateAgentFeedback] = useState<string | null>(null);
  const [agentSession, setAgentSession] = useState<AgentSessionInspector | null>(null);
  const [agentSessionLoading, setAgentSessionLoading] = useState(false);
  const [agentSessionFeedback, setAgentSessionFeedback] = useState<string | null>(null);
  const [agentSessionCopied, setAgentSessionCopied] = useState(false);
  const [agentSessionRefreshTick, setAgentSessionRefreshTick] = useState(0);
  const [isAgentSessionPeekOpen, setIsAgentSessionPeekOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettingsState | null>(null);
  const [appSettingsDraft, setAppSettingsDraft] = useState<AppSettingsState | null>(null);
  const [appSettingsLoading, setAppSettingsLoading] = useState(false);
  const [workspaceInventoryLoading, setWorkspaceInventoryLoading] = useState(false);
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);
  const [appSettingsFeedback, setAppSettingsFeedback] = useState<string | null>(null);
  const [isAppSettingsEditing, setIsAppSettingsEditing] = useState(false);
  const [projectRetirementPendingRoot, setProjectRetirementPendingRoot] = useState<string | null>(null);
  const [onboardingWizardStep, setOnboardingWizardStep] = useState<OnboardingWizardStepId>('welcome');
  const [onboardingCommandPending, setOnboardingCommandPending] = useState<OnboardingCommandName | null>(null);
  const [onboardingCommandResult, setOnboardingCommandResult] = useState<OnboardingCommandResult | null>(null);
  const [onboardingCommandHistory, setOnboardingCommandHistory] = useState<Partial<Record<OnboardingCommandName, OnboardingCommandResult>>>({});
  const [onboardingCopiedCommand, setOnboardingCopiedCommand] = useState<OnboardingCommandName | null>(null);
  const [startupOnboardingState, setStartupOnboardingState] = useState<'checking' | 'active' | 'done'>('checking');
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
  const [workspaceExplorerQuery, setWorkspaceExplorerQuery] = useState('');
  const [workspaceExplorerFilter, setWorkspaceExplorerFilter] = useState<WorkspaceExplorerFilterTab>('all');
  const [workspaceExplorerViewMode, setWorkspaceExplorerViewMode] = useState<WorkspaceExplorerViewMode>('grid');
  const [logCatalog, setLogCatalog] = useState<DesktopLogCatalog | null>(null);
  const [selectedLogSourceId, setSelectedLogSourceId] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<DesktopLogContent | null>(null);
  const [brokerInspector, setBrokerInspector] = useState<DesktopBrokerInspector | null>(null);
  const [brokerControlPending, setBrokerControlPending] = useState(false);
  const [brokerControlFeedback, setBrokerControlFeedback] = useState<string | null>(null);
  const [pendingBrokerInspectorFocus, setPendingBrokerInspectorFocus] = useState(false);
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState(false);
  const [feedbackBundle, setFeedbackBundle] = useState<DesktopFeedbackBundle | null>(null);
  const [feedbackBundleLoading, setFeedbackBundleLoading] = useState(false);
  const [feedbackBundleError, setFeedbackBundleError] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [feedbackSubmission, setFeedbackSubmission] = useState<DesktopFeedbackSubmission | null>(null);
  const [feedbackActionPending, setFeedbackActionPending] = useState<'copy' | 'refresh' | 'repair' | 'submit' | null>(null);
  const [feedbackActionMessage, setFeedbackActionMessage] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsFeedback, setLogsFeedback] = useState<string | null>(null);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logSourceQuery, setLogSourceQuery] = useState('');
  const [logsRefreshTick, setLogsRefreshTick] = useState(0);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [dark, setDark] = useState(false);
  const activeResizeTarget = useRef<"left-sidebar" | "right-sidebar" | null>(null);
  const relayComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const relayTimelineViewportRef = useRef<HTMLDivElement | null>(null);
  const agentRuntimePathRef = useRef<HTMLInputElement | null>(null);
  const agentSessionInlineViewportRef = useRef<HTMLElement | null>(null);
  const agentSessionPeekViewportRef = useRef<HTMLElement | null>(null);
  const agentSessionInlineStickToBottomRef = useRef(true);
  const agentSessionPeekStickToBottomRef = useRef(true);
  const settingsOperatorNameRef = useRef<HTMLInputElement | null>(null);
  const relayServiceInspectorRef = useRef<HTMLElement | null>(null);
  const shellStateLoadInFlightRef = useRef(false);
  const commitPairingState = React.useCallback((nextState: PairingState) => {
    setPairingState((current) => pairingStatesMeaningfullyEqual(current, nextState) ? current : nextState);
  }, []);

  const sessions = shellState?.sessions ?? [];
  const machinesState = shellState?.machines ?? null;
  const plansState = shellState?.plans ?? null;
  const messagesState = shellState?.messages ?? null;
  const runtime = shellState?.runtime ?? null;
  const relayState = shellState?.relay ?? null;
  const interAgentState = shellState?.interAgent ?? null;
  const desktopFeatures = scoutAppInfo?.features ?? shellState?.appInfo.features ?? DEFAULT_DESKTOP_FEATURES;
  const surfaceCaps = scoutAppInfo?.capabilities ?? shellState?.appInfo.capabilities;
  const pairingSurfaceBadge = describePairingSurfaceBadge(pairingState, pairingLoading, pairingError);

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
      setSelectedRelayKind('channel');
      setSelectedRelayId('shared');
      setRelayFeedback('Relay is running.');
      setAppSettingsFeedback(null);
      return;
    }

    setActiveView('settings');
    setSettingsSection('communication');
    setPendingBrokerInspectorFocus(true);
    setAppSettingsFeedback('Relay is not running yet. Finish onboarding by starting the broker from Communication.');
  }, []);

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
    if (!relayState) {
      return;
    }

    const relayFeedItems = buildRelayFeedItems(relayState);
    const relayConversationItems = buildRelayConversationItems(relayState);
    const availableDestinations = [
      ...relayFeedItems.map((item) => `${item.kind}:${item.id}`),
      ...relayConversationItems.map((item) => `${item.kind}:${item.id}`),
      ...relayState.directs.map((item) => `${item.kind}:${item.id}`),
    ];

    const currentKey = `${selectedRelayKind}:${selectedRelayId}`;
    if (!availableDestinations.includes(currentKey)) {
      setSelectedRelayKind('channel');
      setSelectedRelayId('shared');
    }
  }, [relayState, selectedRelayId, selectedRelayKind]);

  useEffect(() => {
    if (!interAgentState) {
      return;
    }

    const allAgents = interAgentState.agents;
    const filteredAgents = allAgents
      .filter((agent) => (agentRosterFilter === 'all' ? true : isAgentRosterActive(agent)))
      .sort((lhs, rhs) => compareAgentRoster(lhs, rhs, agentRosterSort));
    const selectableAgents = activeView === 'agents' || activeView === 'inter-agent'
      ? filteredAgents
      : allAgents;

    if (!selectableAgents.length) {
      setSelectedInterAgentId(null);
      setSelectedInterAgentThreadId(null);
      return;
    }

    const preferredAgentId = selectableAgents.find((agent) => agent.threadCount > 0)?.id
      ?? selectableAgents[0]?.id
      ?? null;
    const nextAgentId = selectableAgents.some((agent) => agent.id === selectedInterAgentId)
      ? selectedInterAgentId
      : preferredAgentId;
    if (nextAgentId !== selectedInterAgentId) {
      setSelectedInterAgentId(nextAgentId);
    }

    const availableThreads = interAgentState.threads.filter((thread) =>
      thread.participants.some((participant) => participant.id === nextAgentId),
    );
    const nextThreadId = availableThreads.some((thread) => thread.id === selectedInterAgentThreadId)
      ? selectedInterAgentThreadId
      : availableThreads[0]?.id ?? null;
    if (nextThreadId !== selectedInterAgentThreadId) {
      setSelectedInterAgentThreadId(nextThreadId);
    }
  }, [activeView, agentRosterFilter, agentRosterSort, interAgentState, selectedInterAgentId, selectedInterAgentThreadId]);

  useEffect(() => {
    const threads = messagesState?.threads ?? [];
    if (threads.length === 0) {
      if (selectedMessagesThreadId !== null) {
        setSelectedMessagesThreadId(null);
      }
      return;
    }

    if (selectedMessagesThreadId && threads.some((thread) => thread.id === selectedMessagesThreadId)) {
      return;
    }

    const preferredThread = threads.find((thread) => (
      thread.relayDestinationKind === selectedRelayKind
      && thread.relayDestinationId === selectedRelayId
    )) ?? threads.find((thread) => thread.interAgentThreadId === selectedInterAgentThreadId)
      ?? threads[0];

    if (preferredThread && preferredThread.id !== selectedMessagesThreadId) {
      setSelectedMessagesThreadId(preferredThread.id);
    }
  }, [messagesState, selectedInterAgentThreadId, selectedMessagesThreadId, selectedRelayId, selectedRelayKind]);

  useEffect(() => {
    if (!selectedMessagesThreadId) {
      return;
    }

    setMessagesDetailOpen(true);
    setMessagesDetailTab('overview');
  }, [selectedMessagesThreadId]);

  useEffect(() => {
    if (!selectedInterAgentId || !scoutDesktop?.getAgentConfig) {
      setAgentConfig(null);
      setAgentConfigDraft(null);
      setAgentConfigFeedback(null);
      setAgentThreadsExpanded(false);
      setAgentSnapshotExpanded(false);
      setAgentActivityExpanded(false);
      return;
    }

    let cancelled = false;
    const loadAgentConfig = async () => {
      setAgentConfigLoading(true);
      try {
        const nextConfig = await scoutDesktop!.getAgentConfig(selectedInterAgentId);
        if (cancelled) {
          return;
        }
        setAgentConfig(nextConfig);
        setAgentConfigDraft(nextConfig);
        setAgentConfigFeedback(null);
        if (!pendingConfigFocusAgentId || pendingConfigFocusAgentId !== selectedInterAgentId) {
          setIsAgentConfigEditing(false);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAgentConfig(null);
        setAgentConfigDraft(null);
        setAgentConfigFeedback(asErrorMessage(error));
        setIsAgentConfigEditing(false);
      } finally {
        if (!cancelled) {
          setAgentConfigLoading(false);
        }
      }
    };

    void loadAgentConfig();
    return () => {
      cancelled = true;
    };
  }, [pendingConfigFocusAgentId, selectedInterAgentId]);

  /** Loads agent session for the focused direct thread / agents roster. Omit `agentSession` from deps: a successful fetch updates it and would otherwise rerun this effect in a tight loop. */
  useEffect(() => {
    const sessionTargetAgentId = activeView === 'messages'
      ? (selectedMessagesThread?.kind === 'relay' && selectedRelayKind === 'direct' ? selectedRelayId : null)
      : activeView === 'agents'
        ? selectedInterAgentId
        : null;

    if (!sessionTargetAgentId || !scoutDesktop?.getAgentSession) {
      setAgentSession(null);
      setAgentSessionFeedback(null);
      setAgentSessionCopied(false);
      return;
    }

    let cancelled = false;
    const loadAgentSession = async () => {
      setAgentSessionLoading(true);
      try {
        const nextSession = await scoutDesktop!.getAgentSession(sessionTargetAgentId);
        if (cancelled) {
          return;
        }
        setAgentSession(nextSession);
        setAgentSessionFeedback(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAgentSession(null);
        setAgentSessionFeedback(asErrorMessage(error));
      } finally {
        if (!cancelled) {
          setAgentSessionLoading(false);
        }
      }
    };

    void loadAgentSession();
    return () => {
      cancelled = true;
    };
  }, [
    activeView,
    agentSessionRefreshTick,
    scoutDesktop,
    selectedInterAgentId,
    selectedMessagesThreadId,
    selectedRelayId,
    selectedRelayKind,
  ]);

  useEffect(() => {
    setAgentSessionFeedback(null);
    setAgentSessionCopied(false);
  }, [selectedInterAgentId, selectedMessagesThreadId, selectedRelayId, selectedRelayKind]);

  useEffect(() => {
    if (activeView !== 'agents' && activeView !== 'messages') {
      setIsAgentSessionPeekOpen(false);
    }
  }, [activeView]);

  useEffect(() => {
    const peekTargetAgentId = activeView === 'messages'
      ? (selectedMessagesThread?.kind === 'relay' && selectedRelayKind === 'direct' ? selectedRelayId : null)
      : activeView === 'agents'
        ? selectedInterAgentId
        : null;

    if (!isAgentSessionPeekOpen || !peekTargetAgentId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setAgentSessionRefreshTick((current) => current + 1);
    }, 1600);

    return () => window.clearInterval(intervalId);
  }, [activeView, isAgentSessionPeekOpen, selectedInterAgentId, selectedMessagesThreadId, selectedRelayId, selectedRelayKind]);

  useEffect(() => {
    if (!isAgentSessionPeekOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAgentSessionPeekOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAgentSessionPeekOpen]);

  const agentSessionShouldStickToBottom = React.useCallback((element: HTMLElement | null) => {
    if (!element) {
      return true;
    }

    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    return remaining <= 48;
  }, []);

  const scrollAgentSessionToBottom = React.useCallback((element: HTMLElement | null) => {
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    agentSessionInlineStickToBottomRef.current = true;
    agentSessionPeekStickToBottomRef.current = true;
  }, [selectedInterAgentId, isAgentSessionPeekOpen]);

  useEffect(() => {
    const shouldLoadAppSettings = activeView === 'settings' || activeView === 'help' || startupOnboardingState === 'active';
    if (!shouldLoadAppSettings || !scoutDesktop?.getAppSettings) {
      return;
    }

    let cancelled = false;
    const loadAppSettings = async () => {
      setAppSettingsLoading(true);
      try {
        const nextSettings = await scoutDesktop!.getAppSettings();
        if (cancelled) {
          return;
        }
        setAppSettings(nextSettings);
        setAppSettingsDraft(nextSettings);
        if (startupOnboardingState === 'active' && nextSettings.onboarding.needed) {
          setAppSettingsFeedback(null);
          setIsAppSettingsEditing(true);
          setOnboardingWizardStep((current) => current || 'welcome');
        } else {
          setAppSettingsFeedback(null);
          setIsAppSettingsEditing(false);
        }
        if (startupOnboardingState === 'active' && !nextSettings.onboarding.needed) {
          completeOnboardingIntoRelay(shellState);
          setStartupOnboardingState('done');
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAppSettings(null);
        setAppSettingsDraft(null);
        setAppSettingsFeedback(asErrorMessage(error));
        setIsAppSettingsEditing(false);
        if (startupOnboardingState !== 'done') {
          setStartupOnboardingState('done');
        }
      } finally {
        if (!cancelled) {
          setAppSettingsLoading(false);
        }
      }
    };

    void loadAppSettings();
    return () => {
      cancelled = true;
    };
  }, [activeView, completeOnboardingIntoRelay, startupOnboardingState]);

  useEffect(() => {
    let cancelled = false;

    if (!scoutDesktop?.getAppSettings) {
      setStartupOnboardingState('done');
      return () => {
        cancelled = true;
      };
    }

    const checkOnboarding = async () => {
      try {
        const nextSettings = await scoutDesktop!.getAppSettings();
        if (cancelled) {
          return;
        }
        setAppSettings((current) => current ?? nextSettings);
        setAppSettingsDraft((current) => current ?? nextSettings);
        if (nextSettings.onboarding.needed) {
          setAppSettingsFeedback(null);
          setIsAppSettingsEditing(true);
          setOnboardingWizardStep('welcome');
          setStartupOnboardingState('active');
        } else {
          setStartupOnboardingState('done');
        }
      } catch {
        // Startup onboarding should not block the rest of the shell if settings cannot be read yet.
        if (!cancelled) {
          setStartupOnboardingState('done');
        }
      }
    };

    void checkOnboarding();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeView !== 'sessions' || !scoutDesktop?.getPhonePreparation) {
      return;
    }

    let cancelled = false;
    const loadPhonePreparation = async () => {
      setPhonePreparationLoading(true);
      try {
        const nextState = await scoutDesktop.getPhonePreparation();
        if (cancelled) {
          return;
        }
        setPhonePreparation(nextState);
        setPhonePreparationFeedback(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPhonePreparation(null);
        setPhonePreparationFeedback(asErrorMessage(error));
      } finally {
        if (!cancelled) {
          setPhonePreparationLoading(false);
        }
      }
    };

    void loadPhonePreparation();
    return () => {
      cancelled = true;
    };
  }, [activeView, scoutDesktop]);

  // Load catalog once when entering logs view — no refresh tick dependency
  useEffect(() => {
    if (activeView !== 'logs') {
      return;
    }
    if (!scoutDesktop?.getLogCatalog) {
      setLogCatalog(null);
      setLogsFeedback('Logs are unavailable in the current desktop bridge. Restart the app so the latest Electron preload is loaded.');
      return;
    }

    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const nextCatalog = await scoutDesktop!.getLogCatalog();
        if (cancelled) return;
        setLogCatalog(nextCatalog);
        // Auto-select the default source on first load
        setSelectedLogSourceId((current) => {
          if (current && nextCatalog.sources.some((s) => s.id === current)) return current;
          return nextCatalog.defaultSourceId ?? nextCatalog.sources[0]?.id ?? null;
        });
        if (nextCatalog.sources.length === 0) {
          setLogsFeedback('No log sources available.');
        }
      } catch (error) {
        if (!cancelled) setLogsFeedback(asErrorMessage(error));
      }
    };
    void loadCatalog();
    return () => { cancelled = true; };
  }, [activeView]);

  // Load log content on source change and refresh tick (content only, no catalog)
  useEffect(() => {
    if (activeView !== 'logs' || !selectedLogSourceId) {
      return;
    }
    if (!scoutDesktop?.readLogSource) {
      setLogContent(null);
      return;
    }

    let cancelled = false;
    // Show loading spinner on first load or source switch, but not on background refresh
    if (!logContent || logContent.sourceId !== selectedLogSourceId) {
      setLogsLoading(true);
    }
    setLogsFeedback(null);
    const loadContent = async () => {
      try {
        const nextContent = await scoutDesktop!.readLogSource({ sourceId: selectedLogSourceId, tailLines: 500 });
        if (cancelled) return;
        setLogContent(nextContent);
        setLogsFeedback(null);
      } catch (error) {
        if (!cancelled) {
          setLogContent(null);
          setLogsFeedback(asErrorMessage(error));
        }
      } finally {
        if (!cancelled) setLogsLoading(false);
      }
    };
    void loadContent();
    return () => { cancelled = true; };
  }, [activeView, selectedLogSourceId, logsRefreshTick]);

  useEffect(() => {
    if (!desktopFeatures.pairing || !scoutDesktop?.getPairingState) {
      return;
    }

    let cancelled = false;
    const loadPairingState = async (options?: { showLoading?: boolean }) => {
      if (options?.showLoading) {
        setPairingLoading(true);
      }
      try {
        const nextState = await scoutDesktop!.getPairingState();
        if (cancelled) {
          return;
        }
        commitPairingState(nextState);
        setPairingError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPairingError(asErrorMessage(error));
      } finally {
        if (!cancelled) {
          setPairingLoading(false);
        }
      }
    };

    void loadPairingState({ showLoading: !pairingState });
    const intervalId = window.setInterval(() => {
      void loadPairingState();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [commitPairingState, desktopFeatures.pairing, pairingState]);

  useEffect(() => {
    if (activeView !== 'settings' || settingsSection !== 'communication' || !scoutDesktop?.getBrokerInspector) {
      return;
    }

    let cancelled = false;
    const loadRelayInspector = async () => {
      try {
        const nextInspector = await scoutDesktop!.getBrokerInspector();
        if (!cancelled) {
          setBrokerInspector(nextInspector);
        }
      } catch {
        if (!cancelled) {
          setBrokerInspector(null);
        }
      }
    };

    void loadRelayInspector();
    return () => {
      cancelled = true;
    };
  }, [activeView, settingsSection, logsRefreshTick]);

  useEffect(() => {
    if (!pendingBrokerInspectorFocus || activeView !== 'settings' || settingsSection !== 'communication') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      relayServiceInspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingBrokerInspectorFocus(false);
    }, 40);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeView, pendingBrokerInspectorFocus, settingsSection, brokerInspector]);

  useEffect(() => {
    if (activeView !== 'logs') {
      return;
    }

    const interval = window.setInterval(() => {
      setLogsRefreshTick((current) => current + 1);
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeView]);

  useEffect(() => {
    const refreshTargetAgentId = activeView === 'messages'
      ? (selectedMessagesThread?.kind === 'relay' && selectedRelayKind === 'direct' ? selectedRelayId : null)
      : activeView === 'agents'
        ? selectedInterAgentId
        : null;

    if (!refreshTargetAgentId) {
      return;
    }

    const interval = window.setInterval(() => {
      setAgentSessionRefreshTick((current) => current + 1);
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeView, selectedInterAgentId, selectedMessagesThreadId, selectedRelayId, selectedRelayKind]);

  useEffect(() => {
    if (!agentSessionCopied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setAgentSessionCopied(false);
    }, 1500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [agentSessionCopied]);

  useEffect(() => {
    const textarea = relayComposerRef.current;
    if (!textarea) {
      return;
    }

    const maxHeight = 120;
    textarea.style.height = '0px';
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [relayDraft]);

  useEffect(() => {
    if ((activeView !== 'relay' && activeView !== 'messages') || pendingRelayComposerFocusTick === 0) {
      return;
    }

    const target = relayComposerRef.current;
    if (!target) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      target.focus();
      const end = target.value.length;
      target.setSelectionRange?.(end, end);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activeView, pendingRelayComposerFocusTick]);

  useEffect(() => {
    if (!relayReplyTarget) {
      return;
    }

    if (selectedRelayKind !== 'direct' || selectedRelayId !== relayReplyTarget.authorId) {
      setRelayReplyTarget(null);
    }
  }, [relayReplyTarget, selectedRelayKind, selectedRelayId]);

  useEffect(() => {
    if (
      activeView !== 'settings'
      || settingsSection !== 'agents'
      || !pendingConfigFocusAgentId
      || selectedInterAgentId !== pendingConfigFocusAgentId
      || agentConfigLoading
    ) {
      return;
    }

    const target = agentRuntimePathRef.current;
    if (!target) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.focus();
      if ("value" in target && typeof target.value === 'string') {
        const end = target.value.length;
        target.setSelectionRange?.(end, end);
      }
      setPendingConfigFocusAgentId((current) => (current === pendingConfigFocusAgentId ? null : current));
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activeView, pendingConfigFocusAgentId, selectedInterAgentId, agentConfigLoading, agentConfigDraft]);

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

  useEffect(() => {
    if (activeView !== 'agents' || !isAgentConfigEditing) {
      return;
    }

    setIsAgentConfigEditing(false);
    setPendingConfigFocusAgentId(null);
  }, [activeView, isAgentConfigEditing]);

  useEffect(() => {
    if (!relayState?.messages.length) {
      return;
    }

    const confirmedClientIds = new Set(
      relayState.messages
        .map((message) => message.clientMessageId)
        .filter((messageId): messageId is string => Boolean(messageId)),
    );
    if (!confirmedClientIds.size) {
      return;
    }

    setPendingRelayMessages((current) => current.filter((entry) => !confirmedClientIds.has(entry.clientMessageId)));
  }, [relayState]);

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

  const phonePreparationState = phonePreparation ?? {
    favorites: [],
    quickHits: [],
    preparedAt: null,
  };

  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );

  const preparedPhoneCandidates = useMemo(
    () => [...sessions]
      .sort((left, right) =>
        new Date(right.lastModified).getTime() - new Date(left.lastModified).getTime()
        || right.messageCount - left.messageCount
        || left.title.localeCompare(right.title),
      ),
    [sessions],
  );

  const favoritePhoneSessions = useMemo(
    () => phonePreparationState.favorites
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is SessionMetadata => Boolean(session)),
    [phonePreparationState.favorites, sessionsById],
  );

  const quickHitPhoneSessions = useMemo(
    () => phonePreparationState.quickHits
      .filter((sessionId) => !phonePreparationState.favorites.includes(sessionId))
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is SessionMetadata => Boolean(session)),
    [phonePreparationState.favorites, phonePreparationState.quickHits, sessionsById],
  );

  // Stats
  const stats = useMemo(() => ({
    totalSessions: sessions.length,
    totalMessages: sessions.reduce((sum, s) => sum + s.messageCount, 0),
    totalTokens: sessions.reduce((sum, s) => sum + (s.tokens || 0), 0),
    projects: projects.length,
  }), [sessions, projects]);

  const persistPhonePreparation = React.useCallback(async (
    nextState: PhonePreparationState,
    successMessage?: string | null,
  ) => {
    if (!scoutDesktop?.updatePhonePreparation) {
      setPhonePreparationFeedback('Phone preparation is unavailable in this build.');
      return;
    }

    const previous = phonePreparation;
    setPhonePreparation(nextState);
    setPhonePreparationSaving(true);
    try {
      const saved = await scoutDesktop.updatePhonePreparation(nextState);
      setPhonePreparation(saved);
      if (successMessage) {
        setPhonePreparationFeedback(successMessage);
      } else if (successMessage === null) {
        setPhonePreparationFeedback(null);
      }
    } catch (error) {
      setPhonePreparation(previous);
      setPhonePreparationFeedback(asErrorMessage(error));
    } finally {
      setPhonePreparationSaving(false);
      setDraggedSessionId(null);
      setDraggedPhoneSection(null);
    }
  }, [phonePreparation, scoutDesktop]);

  const updatePhonePreparation = React.useCallback((
    mutator: (current: PhonePreparationState) => PhonePreparationState,
    successMessage?: string | null,
  ) => {
    const nextState = mutator(phonePreparationState);
    void persistPhonePreparation(nextState, successMessage);
  }, [persistPhonePreparation, phonePreparationState]);

  const handlePreparePhone = React.useCallback(() => {
    const favorites = phonePreparationState.favorites.filter((sessionId) => sessionsById.has(sessionId));
    const quickHits = preparedPhoneCandidates
      .map((session) => session.id)
      .filter((sessionId) => !favorites.includes(sessionId))
      .slice(0, 8);

    void persistPhonePreparation({
      favorites,
      quickHits,
      preparedAt: Date.now(),
    }, `Prepared ${favorites.length + quickHits.length} phone picks.`);
  }, [persistPhonePreparation, phonePreparationState.favorites, preparedPhoneCandidates, sessionsById]);

  const handleClearPhoneQuickHits = React.useCallback(() => {
    updatePhonePreparation((current) => ({
      ...current,
      quickHits: [],
      preparedAt: Date.now(),
    }), 'Cleared My List. Favorites stayed pinned.');
  }, [updatePhonePreparation]);

  const handleAddSessionToPhoneSection = React.useCallback((sessionId: string, section: 'favorites' | 'quickHits') => {
    updatePhonePreparation((current) => {
      if (section === 'favorites') {
        return {
          favorites: current.favorites.includes(sessionId) ? current.favorites : [...current.favorites, sessionId],
          quickHits: current.quickHits.filter((id) => id !== sessionId),
          preparedAt: Date.now(),
        };
      }

      if (current.favorites.includes(sessionId) || current.quickHits.includes(sessionId)) {
        return {
          ...current,
          preparedAt: Date.now(),
        };
      }

      return {
        ...current,
        quickHits: [...current.quickHits, sessionId],
        preparedAt: Date.now(),
      };
    }, section === 'favorites' ? 'Pinned for phone.' : 'Added to My List.');
  }, [updatePhonePreparation]);

  const handleRemoveSessionFromPhoneSection = React.useCallback((sessionId: string, section: 'favorites' | 'quickHits') => {
    updatePhonePreparation((current) => ({
      favorites: section === 'favorites' ? current.favorites.filter((id) => id !== sessionId) : current.favorites,
      quickHits: section === 'quickHits' ? current.quickHits.filter((id) => id !== sessionId) : current.quickHits,
      preparedAt: Date.now(),
    }), section === 'favorites' ? 'Removed from phone favorites.' : 'Removed from My List.');
  }, [updatePhonePreparation]);

  const handleDropIntoFavorites = React.useCallback(() => {
    if (!draggedSessionId) {
      return;
    }
    handleAddSessionToPhoneSection(draggedSessionId, 'favorites');
  }, [draggedSessionId, handleAddSessionToPhoneSection]);

  const handleDropIntoQuickHits = React.useCallback((targetIndex?: number) => {
    if (!draggedSessionId) {
      return;
    }

    updatePhonePreparation((current) => {
      if (current.favorites.includes(draggedSessionId)) {
        return {
          ...current,
          preparedAt: Date.now(),
        };
      }

      const nextQuickHits = current.quickHits.filter((id) => id !== draggedSessionId);
      const normalizedTargetIndex = typeof targetIndex === 'number'
        ? Math.max(0, Math.min(targetIndex, nextQuickHits.length))
        : nextQuickHits.length;
      nextQuickHits.splice(normalizedTargetIndex, 0, draggedSessionId);

      return {
        ...current,
        quickHits: nextQuickHits,
        preparedAt: Date.now(),
      };
    }, draggedPhoneSection === 'quickHits' ? 'Reordered My List.' : 'Added to My List.');
  }, [draggedPhoneSection, draggedSessionId, updatePhonePreparation]);

  const availableAgentNames = useMemo(
    () => Array.from(new Set(sessions.map((session) => session.agent))).sort(),
    [sessions],
  );

  const relayFeedItems = useMemo(
    () => buildRelayFeedItems(relayState).filter((item) => desktopFeatures.voice || !(item.kind === 'channel' && item.id === 'voice')),
    [desktopFeatures.voice, relayState],
  );
  const relayConversationItems = useMemo(() => buildRelayConversationItems(relayState), [relayState]);
  const relayCurrentDestination = relayState
    ? resolveRelayDestination(relayState, relayFeedItems, selectedRelayKind, selectedRelayId)
    : null;
  const selectedRelayDirectThread = relayState && selectedRelayKind === 'direct'
    ? relayState.directs.find((item) => item.id === selectedRelayId) ?? null
    : null;
  const mergedRelayMessages = useMemo(
    () => {
      const brokerMessages = relayState?.messages ?? [];
      if (!pendingRelayMessages.length) {
        return brokerMessages;
      }

      const confirmedClientIds = new Set(
        brokerMessages
          .map((message) => message.clientMessageId)
          .filter((messageId): messageId is string => Boolean(messageId)),
      );
      const pendingMessages = pendingRelayMessages
        .filter((entry) => !confirmedClientIds.has(entry.clientMessageId))
        .map((entry) => entry.message);

      if (!pendingMessages.length) {
        return brokerMessages;
      }

      return [...brokerMessages, ...pendingMessages].sort(
        (lhs, rhs) => lhs.createdAt - rhs.createdAt || lhs.id.localeCompare(rhs.id),
      );
    },
    [pendingRelayMessages, relayState],
  );
  const visibleRelayMessages = useMemo(
    () => filterRelayMessages(mergedRelayMessages, selectedRelayKind, selectedRelayId),
    [mergedRelayMessages, selectedRelayKind, selectedRelayId],
  );
  const relayMessageLookup = useMemo(
    () => new Map(mergedRelayMessages.map((message) => [message.id, message])),
    [mergedRelayMessages],
  );
  const relayContextReferences = useMemo(
    () => relayContextMessageIds
      .map((messageId) => relayMessageLookup.get(messageId))
      .filter((message): message is RelayMessage => Boolean(message))
      .map((message) => ({
        messageId: message.id,
        authorName: message.authorName,
        preview: messagePreviewSnippet(message.body, 96),
      })),
    [relayContextMessageIds, relayMessageLookup],
  );
  const relayThreadTitle = cleanDisplayTitle(relayCurrentDestination?.title ?? '# shared-channel');
  const relayThreadSubtitle = selectedRelayDirectThread
    ? relaySecondaryText(selectedRelayDirectThread)
    : relayCurrentDestination?.subtitle
      ?? null;
  const relayThreadCount = relayCurrentDestination && 'count' in relayCurrentDestination && relayCurrentDestination.count > 0
    ? relayCurrentDestination.count
    : null;
  const lastVisibleRelayMessage = visibleRelayMessages.at(-1) ?? null;
  const relaySelectionIsFeed = relayFeedItems.some(
    (item) => item.kind === selectedRelayKind && item.id === selectedRelayId,
  );
  const interAgentAgents = interAgentState?.agents ?? [];
  const interAgentThreads = interAgentState?.threads ?? [];
  const relayMentionCandidates = useMemo(
    () => interAgentAgents
      .flatMap((agent): RelayMentionCandidate[] => {
        const mentionToken = agent.selector ?? agent.defaultSelector;
        if (!mentionToken) {
          return [];
        }

        return [{
          agentId: agent.id,
          title: agent.title,
          subtitle: agent.projectRoot ?? agent.cwd ?? agent.subtitle ?? null,
          mentionToken,
          definitionId: agent.definitionId,
          workspaceQualifier: agent.workspaceQualifier,
          branch: agent.branch,
          harness: agent.harness,
          state: agent.state,
          statusLabel: agent.statusLabel,
          searchText: [
            agent.title,
            agent.id,
            agent.definitionId ?? '',
            mentionToken,
            agent.selector ?? '',
            agent.defaultSelector ?? '',
            agent.workspaceQualifier ?? '',
            agent.branch ?? '',
            agent.harness ?? '',
            agent.projectRoot ?? '',
            agent.cwd ?? '',
          ].join(' ').toLowerCase(),
        }];
      })
      .sort((left, right) => left.title.localeCompare(right.title)),
    [interAgentAgents],
  );

  useEffect(() => {
    setRelayTimelinePinnedToBottom(true);
    const viewport = relayTimelineViewportRef.current;
    if (!viewport) {
      return;
    }
    requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
    });
  }, [selectedRelayKind, selectedRelayId]);

  useEffect(() => {
    if (!relayTimelinePinnedToBottom) {
      return;
    }
    const viewport = relayTimelineViewportRef.current;
    if (!viewport) {
      return;
    }
    requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
    });
  }, [
    relayTimelinePinnedToBottom,
    selectedRelayDirectThread?.state,
    selectedRelayDirectThread?.activeTask,
    lastVisibleRelayMessage?.id,
    lastVisibleRelayMessage?.body,
    lastVisibleRelayMessage?.receipt?.state,
  ]);

  const handleRelayTimelineScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setRelayTimelinePinnedToBottom(distanceFromBottom <= 48);
  };
  const relayActiveMention = useMemo(
    () => findActiveRelayMention(relayDraft, relayComposerSelectionStart),
    [relayComposerSelectionStart, relayDraft],
  );
  const relayMentionSuggestions = useMemo(
    () => {
      if (!relayActiveMention) {
        return [];
      }

      const selectedDirectAgentId = selectedRelayKind === 'direct' ? selectedRelayId : null;
      return relayMentionCandidates
        .map((candidate) => ({
          candidate,
          score: scoreRelayMentionCandidate(candidate, relayActiveMention.query, selectedDirectAgentId),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => (
          right.score - left.score
          || left.candidate.title.localeCompare(right.candidate.title)
        ))
        .slice(0, 8)
        .map(({ candidate }) => candidate);
    },
    [relayActiveMention, relayMentionCandidates, selectedRelayId, selectedRelayKind],
  );
  const relayMentionDuplicateTitleCounts = useMemo(
    () => relayMentionCandidates.reduce((map, candidate) => {
      map.set(candidate.title, (map.get(candidate.title) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
    [relayMentionCandidates],
  );
  const relayMentionMenuOpen = relayMentionSuggestions.length > 0;
  useEffect(() => {
    if (!relayMentionMenuOpen) {
      setRelayMentionSelectionIndex(0);
      return;
    }

    setRelayMentionSelectionIndex((current) => Math.min(current, relayMentionSuggestions.length - 1));
  }, [relayMentionMenuOpen, relayMentionSuggestions.length]);
  const interAgentAgentLookup = useMemo(
    () => new Map(interAgentAgents.map((agent) => [agent.id, agent])),
    [interAgentAgents],
  );
  const relayDirectLookup = useMemo(
    () => new Map((relayState?.directs ?? []).map((thread) => [thread.id, thread])),
    [relayState],
  );
  const rosterInterAgentAgents = useMemo(
    () => {
      const filteredAgents = interAgentAgents.filter((agent) => (
        agentRosterFilter === 'all' ? true : isAgentRosterActive(agent)
      ));

      return [...filteredAgents].sort((lhs, rhs) => compareAgentRoster(lhs, rhs, agentRosterSort));
    },
    [agentRosterFilter, agentRosterSort, interAgentAgents],
  );
  const rosterAgentTitleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of rosterInterAgentAgents) {
      counts.set(agent.title, (counts.get(agent.title) ?? 0) + 1);
    }
    return counts;
  }, [rosterInterAgentAgents]);
  const messageThreads = messagesState?.threads ?? [];
  const selectedMessagesThread = useMemo(
    () => messageThreads.find((thread) => thread.id === selectedMessagesThreadId) ?? null,
    [messageThreads, selectedMessagesThreadId],
  );
  const selectedInterAgent = interAgentAgents.find((agent) => agent.id === selectedInterAgentId) ?? null;
  const visibleInterAgentThreads = useMemo(
    () => interAgentThreads.filter((thread) => thread.participants.some((participant) => participant.id === selectedInterAgentId)),
    [interAgentThreads, selectedInterAgentId],
  );
  const selectedInterAgentDirectThread = useMemo(
    () => selectedInterAgent
      ? relayState?.directs.find((thread) => thread.id === selectedInterAgent.id) ?? null
      : null,
    [relayState, selectedInterAgent],
  );
  const selectedInterAgentThread = visibleInterAgentThreads.find((thread) => thread.id === selectedInterAgentThreadId) ?? null;
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

      return mergedRelayMessages
        .filter((message) => (
          relatedPrivateThreadMessageIds.has(message.id)
          || message.authorId === selectedInterAgent.id
        ))
        .slice(-60);
    },
    [mergedRelayMessages, selectedInterAgent, visibleInterAgentThreads],
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
  const selectedInterAgentChatActionLabel = selectedInterAgentDirectThread?.preview || selectedInterAgentDirectThread?.timestampLabel
    ? 'Open Chat'
    : 'Start Chat';
  const selectedMessagesInternalThread = useMemo(
    () => selectedMessagesThread?.interAgentThreadId
      ? interAgentThreads.find((thread) => thread.id === selectedMessagesThread.interAgentThreadId) ?? null
      : null,
    [interAgentThreads, selectedMessagesThread],
  );
  const selectedMessagesInternalMessages = useMemo(
    () => {
      if (!selectedMessagesInternalThread) {
        return [];
      }

      const messageIds = new Set(selectedMessagesInternalThread.messageIds);
      return mergedRelayMessages.filter((message) => messageIds.has(message.id));
    },
    [mergedRelayMessages, selectedMessagesInternalThread],
  );
  const selectedMessagesInternalTarget = useMemo(
    () => {
      if (!selectedMessagesInternalThread) {
        return null;
      }

      const participantIds = selectedMessagesInternalThread.participants.map((participant) => participant.id);
      const relayDirectId = relayState?.directs.find((thread) => participantIds.includes(thread.id))?.id ?? null;
      return relayDirectId
        ? interAgentAgents.find((agent) => agent.id === relayDirectId) ?? null
        : null;
    },
    [interAgentAgents, relayState, selectedMessagesInternalThread],
  );
  const selectedMessagesDetailAgentId = selectedMessagesThread?.kind === 'relay' && selectedRelayKind === 'direct'
    ? selectedRelayId
    : selectedMessagesInternalTarget?.id ?? null;
  const selectedMessagesDetailAgent = selectedMessagesDetailAgentId
    ? interAgentAgents.find((agent) => agent.id === selectedMessagesDetailAgentId) ?? null
    : null;
  const selectedMessagesSessions = useMemo(
    () => {
      if (selectedMessagesDetailAgent) {
        return sessions.filter((session) => (
          session.project === selectedMessagesDetailAgent.id
          || session.agent === selectedMessagesDetailAgent.title
        ));
      }

      if (selectedMessagesInternalThread) {
        const participantIds = new Set(selectedMessagesInternalThread.participants.map((participant) => participant.id));
        const participantTitles = new Set(selectedMessagesInternalThread.participants.map((participant) => participant.title));
        return sessions.filter((session) => participantIds.has(session.project) || participantTitles.has(session.agent));
      }

      if (selectedMessagesThread?.relayDestinationKind === 'channel' && selectedMessagesThread.relayDestinationId) {
        return sessions.filter((session) => session.tags?.includes(selectedMessagesThread.relayDestinationId ?? '') ?? false);
      }

      return sessions.slice(0, 8);
    },
    [selectedMessagesDetailAgent, selectedMessagesInternalThread, selectedMessagesThread, sessions],
  );
  const visibleAgentSession = agentSession?.agentId === selectedMessagesDetailAgentId || agentSession?.agentId === selectedInterAgent?.id
    ? agentSession
    : null;
  const agentSessionPending = agentSessionLoading && !visibleAgentSession;
  useEffect(() => {
    if (!visibleAgentSession?.body) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      if (agentSessionInlineStickToBottomRef.current) {
        scrollAgentSessionToBottom(agentSessionInlineViewportRef.current);
      }
      if (isAgentSessionPeekOpen && agentSessionPeekStickToBottomRef.current) {
        scrollAgentSessionToBottom(agentSessionPeekViewportRef.current);
      }
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [
    isAgentSessionPeekOpen,
    scrollAgentSessionToBottom,
    visibleAgentSession?.agentId,
    visibleAgentSession?.body,
    visibleAgentSession?.updatedAtLabel,
  ]);
  const selectedAgentDirectLinePreview = selectedInterAgentDirectThread?.preview || selectedInterAgentDirectThread?.timestampLabel
    ? relaySecondaryText(selectedInterAgentDirectThread)
    : selectedInterAgent
      ? `${selectedInterAgent.title} is ready for a direct message.`
      : 'Direct line available.';
  const visibleAppSettings = isAppSettingsEditing ? (appSettingsDraft ?? appSettings) : appSettings;
  const agentableProjects = visibleAppSettings?.projectInventory ?? [];
  const createAgentDefaults = useMemo(
    () => buildDefaultCreateAgentDraft(agentableProjects, visibleAppSettings),
    [agentableProjects, visibleAppSettings],
  );
  const hiddenProjects = visibleAppSettings?.hiddenProjects ?? [];
  const appSettingsDirty = useMemo(
    () => serializeAppSettings(appSettingsDraft) !== serializeAppSettings(appSettings),
    [appSettingsDraft, appSettings],
  );
  const selectedAgentableProject = agentableProjects.find((project) => project.id === selectedAgentableProjectId) ?? null;
  const selectedWorkspaceProject = selectedAgentableProject;
  const selectedWorkspaceAgent = selectedWorkspaceProject
    ? interAgentAgents.find((agent) => (
      agent.id === selectedWorkspaceProject.id || agent.id === selectedWorkspaceProject.definitionId
    )) ?? null
    : null;
  const workspaceExplorerItems = useMemo(() => agentableProjects.map((project) => {
    const linkedAgent = interAgentAgents.find((agent) => (
      agent.id === project.id || agent.id === project.definitionId
    )) ?? null;
    const isBound = Boolean(linkedAgent) || project.registrationKind === 'configured';
    const primaryHarness = project.harnesses[0]?.harness ?? project.defaultHarness;
    return {
      project,
      linkedAgent,
      isBound,
      primaryHarness,
      pathLabel: compactHomePath(project.root) ?? project.root,
      branchLabel: 'local',
      activityLabel: linkedAgent?.timestampLabel ?? 'Workspace',
      statusLabel: isBound ? 'Bound' : project.registrationKind === 'configured' ? 'Ready' : 'Discovered',
    };
  }), [agentableProjects, interAgentAgents]);
  const filteredWorkspaceExplorerItems = useMemo(() => {
    const query = workspaceExplorerQuery.trim().toLowerCase();
    return workspaceExplorerItems.filter(({ project, isBound, primaryHarness }) => {
      const matchesFilter = workspaceExplorerFilter === 'all'
        ? true
        : workspaceExplorerFilter === 'bound'
          ? isBound
          : !isBound;
      if (!matchesFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        project.title,
        project.projectName,
        project.root,
        project.relativePath,
        primaryHarness,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [workspaceExplorerFilter, workspaceExplorerItems, workspaceExplorerQuery]);
  const workspaceExplorerBoundCount = useMemo(
    () => workspaceExplorerItems.filter((item) => item.isBound).length,
    [workspaceExplorerItems],
  );
  const workspaceExplorerDiscoveredCount = useMemo(
    () => workspaceExplorerItems.filter((item) => !item.isBound).length,
    [workspaceExplorerItems],
  );
  const workspaceInventoryLoaded = Boolean(visibleAppSettings?.workspaceInventoryLoaded);
  const canRefreshWorkspaceInventory = Boolean(appSettings && scoutDesktop?.refreshSettingsInventory);
  const showDoctorOutput = Boolean(
    onboardingCommandPending === 'doctor'
    || onboardingCommandHistory.doctor
    || onboardingCommandResult?.command === 'doctor',
  );
  useEffect(() => {
    if (!selectedAgentableProjectId) {
      return;
    }

    if (!agentableProjects.some((project) => project.id === selectedAgentableProjectId)) {
      setSelectedAgentableProjectId(null);
    }
  }, [agentableProjects, selectedAgentableProjectId]);
  const onboardingContextRoot = visibleAppSettings?.onboardingContextRoot
    ?? visibleAppSettings?.workspaceRoots?.[0]
    ?? null;
  const onboardingHasProjectConfig = Boolean(visibleAppSettings?.currentProjectConfigPath);
  const onboardingRuntimeMatch = (visibleAppSettings?.runtimeCatalog ?? []).find((entry) => entry.name === visibleAppSettings?.defaultHarness) ?? null;
  const onboardingStepCompletion = useMemo(
    () => new Map((visibleAppSettings?.onboarding.steps ?? []).map((step) => [step.id, step.complete])),
    [visibleAppSettings?.onboarding.steps],
  );
  const onboardingWizardSteps = useMemo(() => ([
    {
      id: 'welcome' as const,
      number: '01',
      title: 'Say hi',
      detail: 'Tell Scout what to call you before the rest of setup begins.',
      complete: onboardingStepCompletion.get('welcome') ?? false,
    },
    {
      id: 'source-roots' as const,
      number: '02',
      title: 'Choose folders to scan',
      detail: 'Pick the parent folders Scout should scan for repos, then choose where this Scout context should live.',
      complete: onboardingStepCompletion.get('source-roots') ?? false,
    },
    {
      id: 'harness' as const,
      number: '03',
      title: 'Choose a default harness',
      detail: 'This is the assistant family Scout should prefer when a project does not pin one of its own.',
      complete: onboardingStepCompletion.get('harness') ?? false,
    },
    {
      id: 'confirm' as const,
      number: '04',
      title: 'Confirm this context',
      detail: 'Review which folders Scout will scan and where it will save this context before moving into the command steps.',
      complete: onboardingStepCompletion.get('confirm') ?? false,
    },
    {
      id: 'setup' as const,
      number: '05',
      title: 'Run setup',
      detail: 'See how Scout writes `.openscout/project.json` at your chosen context root and uses it as this context anchor.',
      complete: onboardingStepCompletion.get('setup') ?? false,
    },
    {
      id: 'doctor' as const,
      number: '06',
      title: 'Run doctor',
      detail: 'See how Scout combines broker health, scanned folders, and context manifests into one inventory view.',
      complete: onboardingStepCompletion.get('doctor') ?? false,
    },
    {
      id: 'runtimes' as const,
      number: '07',
      title: 'Run runtimes',
      detail: 'Check whether Claude or Codex is installed, signed in, and ready for broker-owned sessions.',
      complete: onboardingStepCompletion.get('runtimes') ?? false,
    },
  ]), [onboardingStepCompletion]);
  const onboardingWizardIndex = Math.max(
    0,
    ONBOARDING_WIZARD_STEP_ORDER.indexOf(onboardingWizardStep),
  );
  const activeOnboardingStep = onboardingWizardSteps[onboardingWizardIndex] ?? onboardingWizardSteps[0];
  const canGoToPreviousOnboardingStep = onboardingWizardIndex > 0;
  const canGoToNextOnboardingStep = onboardingWizardIndex < onboardingWizardSteps.length - 1;
  const startupOnboardingVisible = startupOnboardingState === 'active' && Boolean(visibleAppSettings?.onboarding);
  const startupOnboardingBlocking = startupOnboardingState !== 'done';
  const buildOnboardingCommandLine = React.useCallback((command: OnboardingCommandName) => {
    const contextRootArg = onboardingContextRoot ? ` --context-root ${onboardingContextRoot}` : '';
    const sourceRootArgs = command === 'setup'
      ? (visibleAppSettings?.workspaceRoots ?? []).map((root) => ` --source-root ${root}`).join('')
      : '';
    return `scout ${command}${contextRootArg}${sourceRootArgs}`;
  }, [onboardingContextRoot, visibleAppSettings?.workspaceRoots]);
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
  const handleCopyOnboardingCommand = React.useCallback(async (command: OnboardingCommandName) => {
    const commandLine = buildOnboardingCommandLine(command);
    await navigator.clipboard.writeText(commandLine);
    setOnboardingCopiedCommand(command);
    window.setTimeout(() => {
      setOnboardingCopiedCommand((current) => current === command ? null : current);
    }, 1500);
  }, [buildOnboardingCommandLine]);
  const visibleAgentConfig = selectedInterAgentId && (agentConfigDraft ?? agentConfig)?.agentId === selectedInterAgentId
    ? (agentConfigDraft ?? agentConfig)
    : null;
  const hasEditableAgentConfig = Boolean(agentConfig?.editable && visibleAgentConfig);
  const updateAgentConfigDraft = React.useCallback((updater: (current: AgentConfigState) => AgentConfigState) => {
    setAgentConfigDraft((current) => current ? updater(current) : current);
    setAgentConfigFeedback(null);
  }, []);
  const logSources = logCatalog?.sources ?? [];
  const filteredLogSources = useMemo(
    () => {
      const query = logSourceQuery.trim().toLowerCase();
      if (!query) {
        return logSources;
      }
      return logSources.filter((source) => (
        source.title.toLowerCase().includes(query)
        || source.subtitle.toLowerCase().includes(query)
      ));
    },
    [logSourceQuery, logSources],
  );
  const selectedLogSource = logSources.find((source) => source.id === selectedLogSourceId) ?? null;
  const visibleLogBody = useMemo(
    () => {
      const body = logContent?.body ?? '';
      const query = logSearchQuery.trim().toLowerCase();
      if (!query) {
        return body;
      }
      return body
        .split(/\r?\n/)
        .filter((line) => line.toLowerCase().includes(query))
        .join('\n');
    },
    [logContent, logSearchQuery],
  );
  const agentConfigDirty = useMemo(
    () => serializeEditableAgentConfig(agentConfigDraft) !== serializeEditableAgentConfig(agentConfig),
    [agentConfigDraft, agentConfig],
  );
  const agentCapabilitiesPreview = useMemo(
    () => parseCapabilityText(visibleAgentConfig?.capabilitiesText ?? ''),
    [visibleAgentConfig?.capabilitiesText],
  );
  const agentRestartActionLabel = isAgentConfigEditing && agentConfigDirty ? 'Save + Restart' : 'Restart Agent';
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
    () => [...mergedRelayMessages]
      .filter((message) => !message.isVoice)
      .slice(-18)
      .reverse(),
    [mergedRelayMessages],
  );
  const pendingApprovals = pairingState?.pendingApprovals ?? [];
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
    setRelayFeedback('Refreshing…');
    try {
      if (productSurface === 'pairing' && scoutDesktop?.refreshPairingState) {
        const nextPairingState = await scoutDesktop.refreshPairingState();
        commitPairingState(nextPairingState);
        setPairingError(null);
        setRelayFeedback('Pairing refreshed.');
        return;
      }
      if (scoutDesktop?.refreshShellState) {
        const nextState = await scoutDesktop.refreshShellState();
        setShellState(nextState);
        setShellError(null);
      } else {
        await loadShellState(true);
      }

      if ((activeView === 'settings' || activeView === 'help') && scoutDesktop?.getAppSettings) {
        const nextSettings = activeView === 'settings'
          && settingsSection === 'workspaces'
          && scoutDesktop?.refreshSettingsInventory
          ? await scoutDesktop.refreshSettingsInventory()
          : await scoutDesktop.getAppSettings();
        setAppSettings(nextSettings);
        setAppSettingsDraft((current) => isAppSettingsEditing ? current : nextSettings);
      }

      if (activeView === 'settings' && settingsSection === 'communication' && scoutDesktop?.getBrokerInspector) {
        const nextInspector = await scoutDesktop.getBrokerInspector();
        setBrokerInspector(nextInspector);
      }

      if (activeView === 'logs') {
        setLogsRefreshTick((current) => current + 1);
      }

      if (activeView === 'agents' && selectedInterAgentId) {
        setAgentSessionRefreshTick((current) => current + 1);
      }

      setRelayFeedback('Refreshed.');
    } catch (error) {
      setRelayFeedback(asErrorMessage(error));
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

  const handlePairingControl = React.useCallback(async (action: 'start' | 'stop' | 'restart') => {
    if (!scoutDesktop?.controlPairingService) {
      return;
    }

    setPairingControlPending(true);
    try {
      const nextState = await scoutDesktop.controlPairingService(action);
      commitPairingState(nextState);
      setPairingError(null);
      setRelayFeedback(action === 'start' ? 'Pairing started.' : action === 'stop' ? 'Pairing stopped.' : 'Pairing restarted.');
    } catch (error) {
      setPairingError(asErrorMessage(error));
    } finally {
      setPairingControlPending(false);
    }
  }, [commitPairingState]);

  const handleUpdatePairingConfig = React.useCallback(async (input: UpdatePairingConfigInput) => {
    if (!scoutDesktop?.updatePairingConfig) {
      return;
    }

    setPairingConfigPending(true);
    setPairingConfigFeedback(null);
    try {
      const nextState = await scoutDesktop.updatePairingConfig(input);
      commitPairingState(nextState);
      setPairingError(null);
      setPairingConfigFeedback('Pairing settings saved.');
    } catch (error) {
      const message = asErrorMessage(error);
      setPairingConfigFeedback(message);
      throw error;
    } finally {
      setPairingConfigPending(false);
    }
  }, [commitPairingState]);

  const handleDecidePairingApproval = React.useCallback(async (
    approval: NonNullable<PairingState>["pendingApprovals"][number],
    decision: 'approve' | 'deny',
  ) => {
    if (!scoutDesktop?.decidePairingApproval) {
      return;
    }

    const approvalId = `${approval.sessionId}:${approval.turnId}:${approval.blockId}:${decision}`;
    setPairingApprovalPendingId(approvalId);
    try {
      const nextState = await scoutDesktop.decidePairingApproval({
        sessionId: approval.sessionId,
        turnId: approval.turnId,
        blockId: approval.blockId,
        version: approval.version,
        decision,
      });
      commitPairingState(nextState);
      setPairingError(null);
      setRelayFeedback(decision === 'approve' ? 'Approval sent.' : 'Action denied.');
    } catch (error) {
      setPairingError(asErrorMessage(error));
    } finally {
      setPairingApprovalPendingId((current) => current === approvalId ? null : current);
    }
  }, [commitPairingState]);

  const handleBrokerControl = React.useCallback(async (action: BrokerControlAction) => {
    if (!surfaceCaps?.canManageBroker || !scoutDesktop?.controlBroker) {
      return;
    }

    setBrokerControlPending(true);
    setBrokerControlFeedback(null);
    try {
      const nextState = await scoutDesktop.controlBroker(action);
      setShellState(nextState);
      setShellError(null);
      if (scoutDesktop.getBrokerInspector) {
        const nextInspector = await scoutDesktop.getBrokerInspector();
        setBrokerInspector(nextInspector);
      }
      setBrokerControlFeedback(
        action === 'start' ? 'Relay started.' : action === 'stop' ? 'Relay stopped.' : 'Relay restarted.',
      );
    } catch (error) {
      setBrokerControlFeedback(asErrorMessage(error));
    } finally {
      setBrokerControlPending(false);
    }
  }, [surfaceCaps, scoutDesktop]);

  const openRelayDiagnostics = React.useCallback(() => {
    setProductSurface('relay');
    setActiveView('settings');
    setSettingsSection('communication');
    setPendingBrokerInspectorFocus(true);
  }, []);

  const openFeedbackDialog = React.useCallback(() => {
    setIsFeedbackDialogOpen(true);
    setFeedbackActionMessage(null);
  }, []);

  const handleStartAppSettingsEdit = React.useCallback(() => {
    setAppSettingsDraft(appSettings);
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
    if (appSettings?.onboarding.needed) {
      setOnboardingWizardStep('welcome');
    }
  }, [appSettings]);

  const handleCancelAppSettingsEdit = React.useCallback(() => {
    setAppSettingsDraft(appSettings);
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(false);
  }, [appSettings]);

  const updateAppSettingsDraft = React.useCallback((updater: (current: AppSettingsState) => AppSettingsState) => {
    setAppSettingsDraft((current) => current ? updater(current) : current);
    setAppSettingsFeedback(null);
  }, []);

  const mergeEditableAppSettingsDraft = React.useCallback((
    currentDraft: AppSettingsState | null,
    nextSettings: AppSettingsState,
  ): AppSettingsState => {
    if (!currentDraft) {
      return nextSettings;
    }

    return {
      ...nextSettings,
      operatorName: currentDraft.operatorName,
      onboardingContextRoot: currentDraft.onboardingContextRoot,
      workspaceRoots: currentDraft.workspaceRoots,
      includeCurrentRepo: currentDraft.includeCurrentRepo,
      defaultHarness: currentDraft.defaultHarness,
      defaultTransport: currentDraft.defaultTransport,
      defaultCapabilities: currentDraft.defaultCapabilities,
      sessionPrefix: currentDraft.sessionPrefix,
      telegram: currentDraft.telegram,
    };
  }, []);

  const applyNextAppSettings = React.useCallback((nextSettings: AppSettingsState) => {
    setAppSettings(nextSettings);
    setAppSettingsDraft((current) => (
      isAppSettingsEditing
        ? mergeEditableAppSettingsDraft(current, nextSettings)
        : nextSettings
    ));
    if (nextSettings.workspaceInventoryLoaded) {
      setWorkspaceInventoryLoading(false);
    }
  }, [isAppSettingsEditing, mergeEditableAppSettingsDraft]);

  useEffect(() => {
    if (
      activeView !== 'settings'
      || settingsSection !== 'workspaces'
      || !scoutDesktop?.refreshSettingsInventory
      || !appSettings
      || appSettings.workspaceInventoryLoaded
      || workspaceInventoryLoading
    ) {
      return;
    }

    let cancelled = false;
    const loadWorkspaceInventory = async () => {
      setWorkspaceInventoryLoading(true);
      try {
        const nextSettings = await scoutDesktop.refreshSettingsInventory();
        if (!cancelled) {
          applyNextAppSettings(nextSettings);
        }
      } catch (error) {
        if (!cancelled) {
          setAppSettingsFeedback(asErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setWorkspaceInventoryLoading(false);
        }
      }
    };

    void loadWorkspaceInventory();
    return () => {
      cancelled = true;
    };
  }, [
    activeView,
    appSettings,
    applyNextAppSettings,
    scoutDesktop,
    settingsSection,
  ]);

  const handleSaveAppSettings = async (): Promise<boolean> => {
    if (!appSettingsDraft || !scoutDesktop?.updateAppSettings) {
      return false;
    }

    setAppSettingsSaving(true);
    try {
      const nextSettings = await scoutDesktop.updateAppSettings({
        operatorName: appSettingsDraft.operatorName,
        onboardingContextRoot: appSettingsDraft.onboardingContextRoot,
        workspaceRootsText: appSettingsDraft.workspaceRoots.join('\n'),
        includeCurrentRepo: appSettingsDraft.includeCurrentRepo,
        defaultHarness: appSettingsDraft.defaultHarness,
        defaultCapabilitiesText: appSettingsDraft.defaultCapabilities.join('\n'),
        sessionPrefix: appSettingsDraft.sessionPrefix,
        telegram: {
          enabled: appSettingsDraft.telegram.enabled,
          mode: appSettingsDraft.telegram.mode,
          botToken: appSettingsDraft.telegram.botToken,
          secretToken: appSettingsDraft.telegram.secretToken,
          apiBaseUrl: appSettingsDraft.telegram.apiBaseUrl,
          userName: appSettingsDraft.telegram.userName,
          defaultConversationId: appSettingsDraft.telegram.defaultConversationId,
          ownerNodeId: appSettingsDraft.telegram.ownerNodeId,
        },
      });
      setAppSettings(nextSettings);
      setAppSettingsDraft(nextSettings);
      setAppSettingsFeedback('Settings saved.');
      setIsAppSettingsEditing(nextSettings.onboarding.needed);
      setStartupOnboardingState((current) => current === 'active'
        ? (nextSettings.onboarding.needed ? 'active' : 'done')
        : current);
      await loadShellState(false);
      return true;
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
      return false;
    } finally {
      setAppSettingsSaving(false);
    }
  };

  const moveOnboardingWizard = React.useCallback((direction: -1 | 1) => {
    setOnboardingWizardStep((current) => {
      const currentIndex = ONBOARDING_WIZARD_STEP_ORDER.indexOf(current);
      if (currentIndex < 0) {
        return ONBOARDING_WIZARD_STEP_ORDER[0];
      }
      const nextIndex = Math.min(
        ONBOARDING_WIZARD_STEP_ORDER.length - 1,
        Math.max(0, currentIndex + direction),
      );
      return ONBOARDING_WIZARD_STEP_ORDER[nextIndex];
    });
  }, []);

  const handleRunOnboardingCommand = React.useCallback(async (command: OnboardingCommandName): Promise<OnboardingCommandResult | null> => {
    if (!surfaceCaps?.canProvisionRuntime || !scoutDesktop?.runOnboardingCommand) {
      setAppSettingsFeedback(
        surfaceCaps && !surfaceCaps.canProvisionRuntime
          ? 'Setup and doctor commands must be run from the Scout CLI (`scout setup`, `scout doctor`) on this host.'
          : null,
      );
      return null;
    }

    setOnboardingCommandPending(command);
    setAppSettingsFeedback(null);
    try {
      const sourceRoots = (appSettingsDraft ?? appSettings)?.workspaceRoots ?? [];
      const result = await scoutDesktop.runOnboardingCommand({
        command,
        contextRoot: (appSettingsDraft ?? appSettings)?.onboardingContextRoot ?? sourceRoots[0],
        sourceRoots: command === 'setup' ? sourceRoots : undefined,
      });
      setOnboardingCommandResult(result);
      setOnboardingCommandHistory((prev) => ({ ...prev, [command]: result }));
      setAppSettingsFeedback(
        result.exitCode !== 0
          ? `${command} exited with status ${result.exitCode}. Review the output below before continuing.`
          : null,
      );

      if (scoutDesktop.getAppSettings) {
        const nextSettings = (command === 'doctor' || command === 'setup') && scoutDesktop.refreshSettingsInventory
          ? await scoutDesktop.refreshSettingsInventory()
          : await scoutDesktop.getAppSettings();
        setAppSettings(nextSettings);
        setAppSettingsDraft(nextSettings);
        setIsAppSettingsEditing(nextSettings.onboarding.needed);
        const nextShellState = await loadShellState(false);

        if (!nextSettings.onboarding.needed) {
          completeOnboardingIntoRelay(nextShellState);
        } else if (command === 'runtimes' && result.exitCode === 0 && !nextShellState?.runtime?.brokerReachable) {
          setOnboardingWizardStep('doctor');
          setAppSettingsFeedback('Relay is still offline. Run doctor again and make sure the broker is reachable before onboarding can finish.');
        } else if (result.exitCode === 0) {
          // Auto-advance to the next step after a short pause so the success state is visible
          setTimeout(() => {
            moveOnboardingWizard(1);
          }, 1800);
        }

        setStartupOnboardingState((current) => current === 'active'
          ? (nextSettings.onboarding.needed ? 'active' : 'done')
          : current);
      }
      return result;
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
      return null;
    } finally {
      setOnboardingCommandPending(null);
    }
  }, [appSettings, appSettingsDraft, completeOnboardingIntoRelay, loadShellState, moveOnboardingWizard, scoutDesktop, surfaceCaps]);

  const handleRetireProject = React.useCallback(async (projectRoot: string, projectTitle: string) => {
    if (!surfaceCaps?.canEditFilesystem) {
      setAppSettingsFeedback('Project retirement is not available in this host. Use the Scout CLI or desktop app.');
      return;
    }
    if (!scoutDesktop?.retireProject) {
      setAppSettingsFeedback('Project retirement is unavailable in this build.');
      return;
    }

    setProjectRetirementPendingRoot(projectRoot);
    try {
      const nextSettings = await scoutDesktop.retireProject(projectRoot);
      applyNextAppSettings(nextSettings);
      await loadShellState(false);
      if (selectedAgentableProject?.root === projectRoot) {
        setSelectedAgentableProjectId(null);
        setSelectedInterAgentId(null);
        setSelectedInterAgentThreadId(null);
      }
      setAppSettingsFeedback(`Retired ${projectTitle}. It is hidden from discovery until restored.`);
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
    } finally {
      setProjectRetirementPendingRoot(null);
    }
  }, [applyNextAppSettings, loadShellState, scoutDesktop, selectedAgentableProject?.root, surfaceCaps]);

  const handleRestoreProject = React.useCallback(async (project: HiddenProjectSummary) => {
    if (!surfaceCaps?.canEditFilesystem) {
      setAppSettingsFeedback('Project restore is not available in this host. Use the Scout CLI or desktop app.');
      return;
    }
    if (!scoutDesktop?.restoreProject) {
      setAppSettingsFeedback('Project restore is unavailable in this build.');
      return;
    }

    setProjectRetirementPendingRoot(project.root);
    try {
      const nextSettings = await scoutDesktop.restoreProject(project.root);
      applyNextAppSettings(nextSettings);
      await loadShellState(false);
      setAppSettingsFeedback(`Restored ${project.title}. Scout will discover it again.`);
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
    } finally {
      setProjectRetirementPendingRoot(null);
    }
  }, [applyNextAppSettings, loadShellState, scoutDesktop, surfaceCaps]);

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

  const handleRestartOnboarding = React.useCallback(() => {
    void (async () => {
      try {
        if (!scoutDesktop?.restartOnboarding) {
          return;
        }

        const nextSettings = await scoutDesktop.restartOnboarding();
        setAppSettings(nextSettings);
        setAppSettingsDraft(nextSettings);
        setOnboardingWizardStep('welcome');
        setOnboardingCommandResult(null);
        setOnboardingCopiedCommand(null);
        setIsAppSettingsEditing(true);
        setStartupOnboardingState('active');
        setAppSettingsFeedback('Onboarding restarted.');
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, []);

  const loadFeedbackBundle = React.useCallback(async (options?: { showSpinner?: boolean }) => {
    if (!scoutDesktop?.getFeedbackBundle) {
      setFeedbackBundleError('Feedback diagnostics are unavailable in this build.');
      return null;
    }

    if (options?.showSpinner) {
      setFeedbackBundleLoading(true);
    }

    try {
      const nextBundle = await scoutDesktop.getFeedbackBundle();
      setFeedbackBundle(nextBundle);
      setFeedbackBundleError(null);
      return nextBundle;
    } catch (error) {
      setFeedbackBundleError(asErrorMessage(error));
      return null;
    } finally {
      if (options?.showSpinner) {
        setFeedbackBundleLoading(false);
      }
    }
  }, [scoutDesktop]);

  useEffect(() => {
    if (!isFeedbackDialogOpen) {
      return;
    }

    void loadFeedbackBundle({ showSpinner: true });
  }, [isFeedbackDialogOpen, loadFeedbackBundle]);

  const handleRefreshFeedbackBundle = React.useCallback(() => {
    void (async () => {
      setFeedbackActionPending('refresh');
      setFeedbackActionMessage(null);
      try {
        await loadFeedbackBundle({ showSpinner: true });
        setFeedbackActionMessage('Support details refreshed.');
      } finally {
        setFeedbackActionPending(null);
      }
    })();
  }, [loadFeedbackBundle]);

  const handleCopyFeedbackBundle = React.useCallback(() => {
    void (async () => {
      if (!feedbackBundle?.text) {
        setFeedbackActionMessage('Support bundle is still loading.');
        return;
      }

      setFeedbackActionPending('copy');
      setFeedbackActionMessage(null);
      try {
        await copyTextToClipboard(feedbackBundle.text);
        setFeedbackActionMessage('Support bundle copied.');
      } catch (error) {
        setFeedbackActionMessage(asErrorMessage(error));
      } finally {
        setFeedbackActionPending(null);
      }
    })();
  }, [feedbackBundle?.text]);

  const handleSubmitFeedbackReport = React.useCallback(() => {
    void (async () => {
      if (!scoutDesktop?.submitFeedbackReport) {
        setFeedbackActionMessage('Feedback submission is unavailable in this build.');
        return;
      }

      const message = feedbackDraft.trim();
      if (!message) {
        setFeedbackActionMessage('Add a short description before submitting.');
        return;
      }

      setFeedbackActionPending('submit');
      setFeedbackActionMessage(null);
      try {
        const result = await scoutDesktop.submitFeedbackReport({
          message,
        } satisfies SubmitFeedbackReportInput);
        setFeedbackSubmission(result);
        setFeedbackDraft('');
        setFeedbackActionMessage(`Feedback submitted as ${result.key}.`);
      } catch (error) {
        setFeedbackActionMessage(asErrorMessage(error));
      } finally {
        setFeedbackActionPending(null);
      }
    })();
  }, [feedbackDraft, scoutDesktop]);

  const handleRepairSetup = React.useCallback(() => {
    void (async () => {
      const notes: string[] = [];
      setFeedbackActionPending('repair');
      setFeedbackActionMessage(null);

      try {
        if (scoutDesktop?.restartOnboarding) {
          const nextSettings = await scoutDesktop.restartOnboarding();
          setAppSettings(nextSettings);
          setAppSettingsDraft(nextSettings);
          setOnboardingWizardStep('welcome');
          setOnboardingCommandResult(null);
          setOnboardingCopiedCommand(null);
          setIsAppSettingsEditing(true);
          setStartupOnboardingState('active');
        } else {
          notes.push('Onboarding reset unavailable.');
        }

        setAppSettingsFeedback(null);
        setRelayFeedback(null);
        setPairingError(null);
        setPairingConfigFeedback(null);
        setBrokerControlFeedback(null);
        setLogsFeedback(null);

        if (surfaceCaps?.canManageBroker && scoutDesktop?.controlBroker) {
          try {
            const nextShellState = await scoutDesktop.controlBroker(
              brokerInspector?.installed ? 'restart' : 'start',
            );
            setShellState(nextShellState);
            setShellError(null);
          } catch (error) {
            notes.push(`Relay: ${asErrorMessage(error)}`);
          }
        }

        if (scoutDesktop?.controlPairingService) {
          try {
            const nextPairingState = await scoutDesktop.controlPairingService(
              pairingState?.isRunning ? 'restart' : 'start',
            );
            commitPairingState(nextPairingState);
          } catch (error) {
            notes.push(`Pairing: ${asErrorMessage(error)}`);
          }
        }

        if (scoutDesktop?.getBrokerInspector) {
          try {
            const nextInspector = await scoutDesktop.getBrokerInspector();
            setBrokerInspector(nextInspector);
          } catch (error) {
            notes.push(`Broker diagnostics: ${asErrorMessage(error)}`);
          }
        }

        if (scoutDesktop?.refreshPairingState) {
          try {
            const nextPairingState = await scoutDesktop.refreshPairingState();
            commitPairingState(nextPairingState);
          } catch (error) {
            notes.push(`Pairing refresh: ${asErrorMessage(error)}`);
          }
        }

        await loadShellState(false);
        await loadFeedbackBundle();
        setFeedbackActionMessage(
          notes.length > 0
            ? `Repair finished with notes: ${notes.join(' · ')}`
            : 'Setup repaired. Onboarding was reset and local services were refreshed.',
        );
      } catch (error) {
        setFeedbackActionMessage(asErrorMessage(error));
      } finally {
        setFeedbackActionPending(null);
      }
    })();
  }, [brokerInspector?.installed, commitPairingState, loadFeedbackBundle, loadShellState, pairingState?.isRunning, scoutDesktop, surfaceCaps]);

  const handleAddSourceRootSuggestion = React.useCallback((root: string) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      const nextRoots = Array.from(new Set([...base.workspaceRoots, root]));
      return {
        ...base,
        onboardingContextRoot: base.onboardingContextRoot || root,
        workspaceRoots: nextRoots,
      };
    });
    setAppSettingsFeedback('Project paths updated. Save General to persist the change.');
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleBeginGeneralEdit = React.useCallback(() => {
    if (!isAppSettingsEditing) {
      setAppSettingsDraft(appSettings);
      setAppSettingsFeedback(null);
      setIsAppSettingsEditing(true);
    }
  }, [appSettings, isAppSettingsEditing]);

  const handleSetSourceRootAt = React.useCallback((index: number, value: string) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      const nextRoots = [...base.workspaceRoots];
      while (nextRoots.length <= index) {
        nextRoots.push('');
      }
      nextRoots[index] = value;

      return {
        ...base,
        onboardingContextRoot: index === 0 && (!base.onboardingContextRoot || base.onboardingContextRoot === base.workspaceRoots[0]) ? value : base.onboardingContextRoot,
        workspaceRoots: nextRoots,
      };
    });
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleAddSourceRootRow = React.useCallback(() => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      return {
        ...base,
        workspaceRoots: [...base.workspaceRoots, ''],
      };
    });
    setAppSettingsFeedback('Project paths updated. Save General to persist the change.');
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleRemoveSourceRootRow = React.useCallback((index: number) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      const removedRoot = base.workspaceRoots[index] ?? '';
      const nextRoots = base.workspaceRoots.filter((_, entryIndex) => entryIndex !== index);
      const nextContextRoot = index === 0 && (!base.onboardingContextRoot || base.onboardingContextRoot === removedRoot)
        ? (nextRoots[0] ?? '')
        : base.onboardingContextRoot;

      return {
        ...base,
        onboardingContextRoot: nextContextRoot,
        workspaceRoots: nextRoots,
      };
    });
    setAppSettingsFeedback('Project paths updated. Save General to persist the change.');
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleBrowseForSourceRoot = React.useCallback((index: number) => {
    void (async () => {
      try {
        if (!surfaceCaps?.canPickDirectory || !scoutDesktop?.pickDirectory) {
          return;
        }
        const selectedPath = await scoutDesktop.pickDirectory();
        if (!selectedPath) {
          return;
        }
        handleSetSourceRootAt(index, selectedPath);
        setAppSettingsFeedback('Project paths updated. Save General to persist the change.');
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, [handleSetSourceRootAt, scoutDesktop, surfaceCaps]);

  const handleSetOnboardingContextRoot = React.useCallback((value: string) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      return {
        ...base,
        onboardingContextRoot: value,
      };
    });
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleBrowseForOnboardingContextRoot = React.useCallback(() => {
    void (async () => {
      try {
        if (!surfaceCaps?.canPickDirectory || !scoutDesktop?.pickDirectory) {
          return;
        }
        const selectedPath = await scoutDesktop.pickDirectory();
        if (!selectedPath) {
          return;
        }
        handleSetOnboardingContextRoot(selectedPath);
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, [handleSetOnboardingContextRoot, scoutDesktop, surfaceCaps]);

  const dismissStartupOnboarding = React.useCallback(() => {
    void (async () => {
      try {
        if (scoutDesktop?.skipOnboarding) {
          const nextSettings = await scoutDesktop.skipOnboarding();
          setAppSettings(nextSettings);
          setAppSettingsDraft(nextSettings);
        }
        setStartupOnboardingState('done');
        setAppSettingsFeedback(null);
        setIsAppSettingsEditing(false);
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, []);

  const handleOnboardingContinue = React.useCallback(() => {
    void (async () => {
      if (activeOnboardingStep.id !== 'confirm') {
        moveOnboardingWizard(1);
        return;
      }

      if (!appSettingsDirty) {
        moveOnboardingWizard(1);
        return;
      }

      const saved = await handleSaveAppSettings();
      if (saved) {
        moveOnboardingWizard(1);
      }
    })();
  }, [activeOnboardingStep.id, appSettingsDirty, handleSaveAppSettings, moveOnboardingWizard]);

  // Auto-run setup/doctor/runtimes when the step activates and it hasn't run yet
  React.useEffect(() => {
    const step = activeOnboardingStep.id;
    if (step !== 'setup' && step !== 'doctor' && step !== 'runtimes') return;
    if (onboardingCommandPending) return;
    if (onboardingCommandHistory[step as OnboardingCommandName]) return;
    if (!visibleAppSettings || appSettingsLoading) return;
    if (step === 'doctor' && !onboardingHasProjectConfig) return;
    const timer = setTimeout(() => {
      void handleRunOnboardingCommand(step as OnboardingCommandName);
    }, 600);
    return () => clearTimeout(timer);
  }, [activeOnboardingStep.id, onboardingCommandPending, onboardingCommandHistory, visibleAppSettings, appSettingsLoading, onboardingHasProjectConfig, handleRunOnboardingCommand]);

  const skipCurrentOnboardingStep = React.useCallback(() => {
    if (canGoToNextOnboardingStep) {
      moveOnboardingWizard(1);
      return;
    }
    dismissStartupOnboarding();
  }, [canGoToNextOnboardingStep, dismissStartupOnboarding, moveOnboardingWizard]);

  const handleSelectInterAgent = React.useCallback((agentId: string) => {
    setSelectedInterAgentId(agentId);
    setSelectedInterAgentThreadId(firstInterAgentThreadIdForAgent(interAgentThreads, agentId));
  }, [interAgentThreads]);

  const openAgentProfile = React.useCallback((agentId: string) => {
    handleSelectInterAgent(agentId);
    setIsAgentConfigEditing(false);
    setPendingConfigFocusAgentId(null);
    setMessagesDetailOpen(true);
    setMessagesDetailTab('overview');
    setSelectedRelayKind('direct');
    setSelectedRelayId(agentId);
    setSelectedMessagesThreadId(
      messagesState?.threads.find((thread) => (
        thread.relayDestinationKind === 'direct' && thread.relayDestinationId === agentId
      ))?.id ?? null,
    );
    setActiveView('messages');
  }, [handleSelectInterAgent, messagesState]);

  const openAgentSettings = React.useCallback((agentId: string, focusConfig = false) => {
    handleSelectInterAgent(agentId);
    setSettingsSection('agents');
    setActiveView('settings');
    setIsAgentConfigEditing(focusConfig);
    setPendingConfigFocusAgentId(focusConfig ? agentId : null);
  }, [handleSelectInterAgent]);

  const handleOpenCreateAgentDialog = React.useCallback(() => {
    setCreateAgentDraft(buildDefaultCreateAgentDraft(agentableProjects, visibleAppSettings));
    setCreateAgentFeedback(null);
    setIsCreateAgentDialogOpen(true);
  }, [agentableProjects, visibleAppSettings]);

  const handleBrowseCreateAgentProject = React.useCallback(() => {
    void (async () => {
      try {
        if (!surfaceCaps?.canPickDirectory || !scoutDesktop?.pickDirectory) {
          return;
        }
        const selectedPath = await scoutDesktop.pickDirectory();
        if (!selectedPath) {
          return;
        }
        setCreateAgentDraft((current) => ({
          ...current,
          projectPath: selectedPath,
        }));
        setCreateAgentFeedback(null);
      } catch (error) {
        setCreateAgentFeedback(asErrorMessage(error));
      }
    })();
  }, [scoutDesktop, surfaceCaps]);

  const handleCreateAgent = React.useCallback(() => {
    void (async () => {
      if (!scoutDesktop?.createAgent) {
        setCreateAgentFeedback('Electron desktop bridge is unavailable.');
        return;
      }

      const projectPath = createAgentDraft.projectPath.trim();
      if (!projectPath) {
        setCreateAgentFeedback('Choose a project path first.');
        return;
      }

      setCreateAgentSubmitting(true);
      setCreateAgentFeedback(null);
      try {
        const result = await scoutDesktop.createAgent({
          projectPath,
          agentName: createAgentDraft.agentName.trim() || null,
          harness: createAgentDraft.harness,
        });

        setShellState(result.shellState);
        setShellError(null);
        setRelayFeedback(`Created ${result.agentId}.`);
        setSelectedInterAgentId(result.agentId);
        setSelectedInterAgentThreadId(null);
        setActiveView('agents');
        setIsCreateAgentDialogOpen(false);

        if (scoutDesktop.refreshSettingsInventory) {
          try {
            const nextSettings = await scoutDesktop.refreshSettingsInventory();
            setAppSettings(nextSettings);
            if (!isAppSettingsEditing || !appSettingsDirty) {
              setAppSettingsDraft(nextSettings);
            }
          } catch {
            // Keep the created agent flow successful even if inventory refresh fails.
          }
        }
      } catch (error) {
        setCreateAgentFeedback(asErrorMessage(error));
      } finally {
        setCreateAgentSubmitting(false);
      }
    })();
  }, [appSettingsDirty, createAgentDraft, isAppSettingsEditing, scoutDesktop]);

  const handleStartAgentConfigEdit = React.useCallback(() => {
    setActiveView('settings');
    setSettingsSection('agents');
    setIsAgentConfigEditing(true);
    if (selectedInterAgentId) {
      setPendingConfigFocusAgentId(selectedInterAgentId);
    }
  }, [selectedInterAgentId]);

  const handleCancelAgentConfigEdit = React.useCallback(() => {
    setAgentConfigDraft(agentConfig);
    setAgentConfigFeedback(null);
    setIsAgentConfigEditing(false);
  }, [agentConfig]);

  const handleToggleVoiceCapture = async () => {
    if (!scoutDesktop?.toggleVoiceCapture) {
      setShellError('Electron desktop bridge is unavailable.');
      return;
    }

    try {
      const nextState = await scoutDesktop.toggleVoiceCapture();
      setShellState(nextState);
      setShellError(null);
      setRelayFeedback(nextState.relay.voice.isCapturing ? 'Voice capture started.' : 'Voice capture stopped.');
    } catch (error) {
      setRelayFeedback(asErrorMessage(error));
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
      setRelayFeedback(enabled ? 'Playback enabled.' : 'Playback disabled.');
    } catch (error) {
      setRelayFeedback(asErrorMessage(error));
    }
  };

  const handleSaveAgentConfig = async () => {
    if (!selectedInterAgentId || !visibleAgentConfig || !scoutDesktop?.updateAgentConfig) {
      return;
    }

    setAgentConfigSaving(true);
    try {
      const nextConfig = await scoutDesktop.updateAgentConfig({
        agentId: selectedInterAgentId,
        runtime: {
          cwd: visibleAgentConfig.runtime.cwd,
          harness: visibleAgentConfig.runtime.harness,
          sessionId: visibleAgentConfig.runtime.sessionId,
          transport: visibleAgentConfig.runtime.transport,
        },
        systemPrompt: visibleAgentConfig.systemPrompt,
        toolUse: {
          launchArgsText: visibleAgentConfig.toolUse.launchArgsText,
        },
        capabilitiesText: visibleAgentConfig.capabilitiesText,
      });
      setAgentConfig(nextConfig);
      setAgentConfigDraft(nextConfig);
      setAgentConfigFeedback('Agent settings saved.');
      setIsAgentConfigEditing(false);
    } catch (error) {
      setAgentConfigFeedback(asErrorMessage(error));
    } finally {
      setAgentConfigSaving(false);
    }
  };

  const handleRestartAgent = async () => {
    if (!selectedInterAgentId || !visibleAgentConfig || !scoutDesktop?.restartAgent) {
      return;
    }

    setAgentConfigRestarting(true);
    try {
      let nextConfig = visibleAgentConfig;
      if (agentConfigDirty && scoutDesktop?.updateAgentConfig) {
        setAgentConfigSaving(true);
        nextConfig = await scoutDesktop.updateAgentConfig({
          agentId: selectedInterAgentId,
          runtime: {
            cwd: visibleAgentConfig.runtime.cwd,
            harness: visibleAgentConfig.runtime.harness,
            sessionId: visibleAgentConfig.runtime.sessionId,
            transport: visibleAgentConfig.runtime.transport,
          },
          systemPrompt: visibleAgentConfig.systemPrompt,
          toolUse: {
            launchArgsText: visibleAgentConfig.toolUse.launchArgsText,
          },
          capabilitiesText: visibleAgentConfig.capabilitiesText,
        });
        setAgentConfig(nextConfig);
        setAgentConfigDraft(nextConfig);
        setAgentConfigSaving(false);
      }

      const nextShellState = await scoutDesktop.restartAgent({
        agentId: selectedInterAgentId,
        previousSessionId: selectedInterAgent?.sessionId ?? agentConfig?.runtime.sessionId ?? null,
      });
      setShellState(nextShellState);
      setShellError(null);
      setAgentConfigFeedback(`${selectedInterAgent?.title ?? 'Agent'} restarted.`);
      setIsAgentConfigEditing(false);
    } catch (error) {
      setAgentConfigFeedback(asErrorMessage(error));
    } finally {
      setAgentConfigSaving(false);
      setAgentConfigRestarting(false);
    }
  };

  const handleOpenAgentSession = React.useCallback(async () => {
    const targetAgentId = activeView === 'messages'
      ? selectedMessagesDetailAgentId
      : selectedInterAgentId;
    if (!surfaceCaps?.canOpenNativeSession || !targetAgentId || !scoutDesktop?.openAgentSession) {
      return;
    }

    try {
      await scoutDesktop.openAgentSession(targetAgentId);
      setAgentSessionFeedback(agentSession?.mode === 'tmux' ? 'Opening tmux session in Terminal.' : 'Opening session logs.');
    } catch (error) {
      setAgentSessionFeedback(asErrorMessage(error));
    }
  }, [activeView, agentSession?.mode, scoutDesktop, selectedInterAgentId, selectedMessagesDetailAgentId, surfaceCaps]);

  const handleCopyAgentSessionCommand = React.useCallback(async () => {
    if (!agentSession?.commandLabel) {
      return;
    }

    try {
      await copyTextToClipboard(agentSession.commandLabel);
      setAgentSessionCopied(true);
      setAgentSessionFeedback('Attach command copied.');
    } catch (error) {
      setAgentSessionFeedback(asErrorMessage(error));
    }
  }, [agentSession]);

  const handlePeekAgentSession = React.useCallback(() => {
    setAgentSessionFeedback(null);
    setIsAgentSessionPeekOpen(true);
    setAgentSessionRefreshTick((current) => current + 1);
  }, []);
  const handleInspectWorkspace = React.useCallback((project: SetupProjectSummary) => {
    setSelectedAgentableProjectId(project.id);
    setSelectedInterAgentId(null);
    setSelectedInterAgentThreadId(null);
    setIsAgentConfigEditing(false);
    setAgentConfigFeedback(null);
  }, []);

  const handleOpenWorkspace = React.useCallback((project: SetupProjectSummary) => {
    if (project.registrationKind === 'configured') {
      openAgentProfile(project.id);
      return;
    }
    handleInspectWorkspace(project);
  }, [handleInspectWorkspace, openAgentProfile]);

  const handleAddWorkspaceFromExplorer = React.useCallback(() => {
    setActiveView('settings');
    setSettingsSection('profile');
    handleBeginGeneralEdit();
    setAppSettingsFeedback('Add a scan folder below, then go back to Workspaces and refresh to discover workspaces.');
  }, [handleBeginGeneralEdit]);

  const handleLoadWorkspaceInventory = React.useCallback(() => {
    if (!scoutDesktop?.refreshSettingsInventory) {
      return;
    }
    setWorkspaceInventoryLoading(true);
    void scoutDesktop.refreshSettingsInventory()
      .then((nextSettings) => {
        applyNextAppSettings(nextSettings);
      })
      .catch((error) => {
        setAppSettingsFeedback(asErrorMessage(error));
      })
      .finally(() => {
        setWorkspaceInventoryLoading(false);
      });
  }, [applyNextAppSettings, scoutDesktop]);

  const applyRelayMentionSuggestion = React.useCallback((candidate: RelayMentionCandidate) => {
    if (!relayActiveMention) {
      return;
    }

    const suffix = relayDraft.slice(relayActiveMention.end);
    const trailingSpace = suffix.startsWith(' ') || suffix.length === 0 ? '' : ' ';
    const nextDraft = `${relayDraft.slice(0, relayActiveMention.start)}${candidate.mentionToken}${trailingSpace}${suffix}`;
    const nextCursor = relayActiveMention.start + candidate.mentionToken.length + trailingSpace.length;

    setRelayDraft(nextDraft);
    setRelayComposerSelectionStart(nextCursor);
    setRelayMentionSelectionIndex(0);

    window.requestAnimationFrame(() => {
      const textarea = relayComposerRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [relayActiveMention, relayDraft]);

  const handleRelaySend = async () => {
    const body = relayDraft.trim();
    if (!body || relaySending || !scoutDesktop?.sendRelayMessage) {
      return;
    }

    const previousDraft = relayDraft;
    const previousReplyTarget = relayReplyTarget;
    const previousContextMessageIds = relayContextMessageIds;
    const clientMessageId = generateClientMessageId();
    const effectiveReplyToMessageId = relayReplyTarget?.messageId ?? relayContextMessageIds[0] ?? null;
    const optimisticMessage = buildOptimisticRelayMessage({
      relayState,
      appSettings,
      destinationKind: selectedRelayKind,
      destinationId: selectedRelayId,
      body,
      replyToMessageId: effectiveReplyToMessageId,
      clientMessageId,
    });
    setRelaySending(true);
    setRelayFeedback('Sending…');
    setPendingRelayMessages((current) => [...current, { clientMessageId, message: optimisticMessage }]);
    setRelayDraft('');
    setRelayReplyTarget(null);
    setRelayContextMessageIds([]);
    try {
      const nextState = await scoutDesktop.sendRelayMessage({
        destinationKind: selectedRelayKind,
        destinationId: selectedRelayId,
        body,
        replyToMessageId: effectiveReplyToMessageId,
        referenceMessageIds: relayContextMessageIds,
        clientMessageId,
      });
      setShellState((current) => (
        current
          ? {
              ...current,
              ...nextState,
            }
          : current
      ));
      setPendingRelayMessages((current) => current.map((entry) => (
        entry.clientMessageId === clientMessageId
          ? {
              ...entry,
              message: {
                ...entry.message,
                receipt: entry.message.receipt
                  ? { ...entry.message.receipt, label: 'Sent', detail: null }
                  : { state: 'sent', label: 'Sent', detail: null },
              },
            }
          : entry
      )));
      setRelayFeedback('Sent.');
    } catch (error) {
      setPendingRelayMessages((current) => current.filter((entry) => entry.clientMessageId !== clientMessageId));
      setRelayDraft(previousDraft);
      setRelayReplyTarget(previousReplyTarget);
      setRelayContextMessageIds(previousContextMessageIds);
      setRelayFeedback(asErrorMessage(error));
    } finally {
      setRelaySending(false);
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

  const openMessagesRelayDestination = React.useCallback((
    kind: RelayDestinationKind,
    id: string,
  ) => {
    setSelectedRelayKind(kind);
    setSelectedRelayId(id);
    setSelectedMessagesThreadId(
      messagesState?.threads.find((thread) => (
        thread.relayDestinationKind === kind
        && thread.relayDestinationId === id
      ))?.id ?? null,
    );
    setActiveView('messages');
  }, [messagesState]);

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
    setSelectedMessagesThreadId(thread.id);
    if (thread.kind === 'relay' && thread.relayDestinationKind && thread.relayDestinationId) {
      setSelectedRelayKind(thread.relayDestinationKind);
      setSelectedRelayId(thread.relayDestinationId);
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
      setSelectedInterAgentId(nextAgentId);
    }
  }, [interAgentAgents, interAgentThreads]);

  const openRelayAgentThread = React.useCallback((
    agentId: string,
    options?: {
      replyToMessage?: RelayMessage | null;
      draft?: string | null;
      focusComposer?: boolean;
    },
  ) => {
    openMessagesRelayDestination('direct', agentId);
    setRelayContextMessageIds([]);
    setRelayReplyTarget(options?.replyToMessage ? {
      messageId: options.replyToMessage.id,
      authorId: options.replyToMessage.authorId,
      authorName: options.replyToMessage.authorName,
      preview: messagePreviewSnippet(options.replyToMessage.body, 96),
    } : null);
    if (typeof options?.draft === 'string') {
      setRelayDraft(options.draft);
    }
    if (options?.focusComposer) {
      setPendingRelayComposerFocusTick((current) => current + 1);
    }
  }, [openMessagesRelayDestination]);

  const handleNudgeMessage = React.useCallback((message: RelayMessage) => {
    if (message.isOperator) {
      return;
    }

    openRelayAgentThread(message.authorId, {
      replyToMessage: message,
      draft: 'Following up on this.',
      focusComposer: true,
    });
    setRelayFeedback(`Drafting a follow-up to ${message.authorName}.`);
  }, [openRelayAgentThread]);

  const openAgentDirectMessage = React.useCallback((agentId: string, draft?: string | null) => {
    openRelayAgentThread(agentId, {
      draft: draft ?? null,
      focusComposer: true,
    });
  }, [openRelayAgentThread]);

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
    const commandResult = onboardingCommandHistory[command] ?? (onboardingCommandResult?.command === command ? onboardingCommandResult : null);
    const succeeded = commandResult && commandResult.exitCode === 0;
    const failed = commandResult && commandResult.exitCode !== 0;

    return (
      <div className="space-y-2">
        {/* Status banner — only when done */}
        {succeeded && (() => {
          const projectCount = visibleAppSettings?.projectInventory?.length ?? 0;
          const brokerOk = visibleAppSettings?.broker?.reachable;
          const runtimesReady = (visibleAppSettings?.runtimeCatalog ?? []).filter((r) => r.readinessState === 'ready').length;
          const runtimesTotal = (visibleAppSettings?.runtimeCatalog ?? []).length;

          const facts: string[] = [];
          if (command === 'setup' || command === 'doctor') {
            facts.push(brokerOk ? 'Broker running' : 'Broker installed');
            if (projectCount > 0) facts.push(`${projectCount} project${projectCount === 1 ? '' : 's'} discovered`);
          }
          if (command === 'runtimes' && runtimesTotal > 0) {
            facts.push(`${runtimesReady} of ${runtimesTotal} runtime${runtimesTotal === 1 ? '' : 's'} ready`);
          }

          return (
            <div
              className="rounded-xl border px-4 py-3"
              style={{ backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.25)' }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <CheckCheck size={14} style={{ color: '#16a34a' }} />
                <span className="text-[12px] font-semibold" style={{ color: '#16a34a' }}>Done</span>
              </div>
              {facts.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {facts.map((fact) => (
                    <span key={fact} className="text-[11px]" style={{ color: '#16a34a', opacity: 0.85 }}>
                      {fact}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        {failed && (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.25)' }}
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <AlertCircle size={15} className="shrink-0 mt-0.5" style={{ color: '#dc2626' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold" style={{ color: '#dc2626' }}>
                  Command failed (exit {commandResult.exitCode})
                </div>
                <div className="text-[11px] mt-1 leading-[1.5]" style={{ color: '#dc2626', opacity: 0.8 }}>
                  Check the output below for details, then try again or run the command in Terminal for more context.
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
                style={{ borderColor: 'rgba(239,68,68,0.35)', color: '#dc2626', backgroundColor: 'rgba(239,68,68,0.08)' }}
                onClick={() => void handleRunOnboardingCommand(command)}
                disabled={Boolean(onboardingCommandPending)}
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Terminal shell */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(15, 23, 42, 0.12)', backgroundColor: C.termBg }}>
          <div
            className="flex items-center justify-between gap-3 px-3.5 py-2 border-b"
            style={{ borderBottomColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(255,255,255,0.03)' }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex items-center gap-[5px]">
                <span className="w-[7px] h-[7px] rounded-full bg-[#ff5f57]" />
                <span className="w-[7px] h-[7px] rounded-full bg-[#febc2e]" />
                <span className="w-[7px] h-[7px] rounded-full bg-[#28c840]" />
              </div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.38)' }}>
                Terminal
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {running && (
                <span className="text-[10px] font-mono px-2 py-1 rounded animate-pulse"
                  style={{ backgroundColor: 'rgba(45,212,191,0.18)', color: '#99f6e4' }}>
                  Running…
                </span>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-opacity hover:opacity-85"
                style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.82)', backgroundColor: 'rgba(255,255,255,0.04)' }}
                onClick={() => void handleCopyOnboardingCommand(command)}
              >
                {onboardingCopiedCommand === command ? <CheckCheck size={12} /> : <Copy size={12} />}
                {onboardingCopiedCommand === command ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[13px] leading-[1.7] font-mono break-all" style={{ color: C.termFg }}>
              <span style={{ color: 'rgba(153,246,228,0.80)' }}>$</span> {commandLine}
            </div>
          </div>
          {(running || commandResult) && (
            <div className="border-t px-4 py-3" style={{ borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(0,0,0,0.08)' }}>
              <div className="text-[10px] font-mono mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                cwd: {commandResult?.cwd ?? (onboardingContextRoot || '…')}
              </div>
              <pre
                className="text-[11px] leading-[1.6] whitespace-pre-wrap break-words overflow-x-auto font-mono"
                style={{ color: failed ? 'rgba(252,165,165,0.85)' : C.termFg, maxHeight: '16rem', overflowY: 'auto' }}
              >
                {running
                  ? '… waiting for output'
                  : commandResult?.output}
              </pre>
            </div>
          )}
          {!running && !commandResult && (
            <div className="px-4 py-4 border-t" style={{ borderTopColor: 'rgba(255,255,255,0.06)' }}>
              <div className="text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Output will appear here after you run the command.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderImmersiveOnboardingStep = () => {
    if (!visibleAppSettings) {
      return null;
    }

    if (activeOnboardingStep.id === 'welcome') {
      return (
        <div className="space-y-8">
          <div className="space-y-3">
            <div className="text-[32px] font-bold tracking-tight leading-[1.15]" style={s.inkText}>
              Welcome to Scout
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              What should we call you?
            </div>
          </div>

          <div className="rounded-xl border px-6 py-6" style={{ borderColor: C.border, backgroundColor: C.surface }}>
            <div className="text-[10px] font-mono uppercase tracking-widest mb-4" style={{ color: C.accent }}>Your name</div>
            <input
              ref={settingsOperatorNameRef}
              value={visibleAppSettings.operatorName ?? ''}
              onChange={(event) => {
                setAppSettingsDraft((current) => current ? {
                  ...current,
                  operatorName: event.target.value,
                } : current);
                setAppSettingsFeedback(null);
                setIsAppSettingsEditing(true);
              }}
              readOnly={appSettingsSaving}
              placeholder={visibleAppSettings.operatorNameDefault || 'Operator'}
              className="w-full border-b-2 border-t-0 border-l-0 border-r-0 px-0 py-3 text-[24px] font-semibold leading-[1.3] bg-transparent outline-none transition-colors focus:border-[var(--os-accent)]"
              style={{ borderBottomColor: C.border, color: C.ink }}
            />
            <div className="text-[12px] mt-4 leading-[1.6]" style={s.mutedText}>
              Prefilled from your machine.
            </div>
          </div>
        </div>
      );
    }

    if (activeOnboardingStep.id === 'source-roots') {
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
              Scan folders and context root
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              Choose the parent folders Scout should scan for repos, then choose the one directory where this Scout context should live.
            </div>
          </div>

          <div className="rounded-xl border px-5 py-5" style={{ borderColor: C.border, backgroundColor: C.surface }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-[11px] font-mono uppercase tracking-widest" style={s.mutedText}>Source Roots</div>
              <button
                type="button"
                className="os-toolbar-button inline-flex items-center gap-1 text-[12px] font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ color: C.ink, borderColor: C.border }}
                onClick={handleAddSourceRootRow}
                disabled={appSettingsSaving}
              >
                <span className="text-[14px] leading-none">+</span>
                Add path
              </button>
            </div>
            <div className="text-[12px] mb-3 leading-[1.6]" style={s.mutedText}>
              These are scan inputs. Scout looks through the repos underneath them, but listing a folder here does not make it the place where Scout saves this context.
            </div>
            <div className="space-y-3">
              {(visibleAppSettings.workspaceRoots ?? []).map((root, index) => (
                <div key={`immersive-source-root-${index}`} className="flex items-center gap-2">
                  <input
                    value={root}
                    onChange={(event) => handleSetSourceRootAt(index, event.target.value)}
                    readOnly={appSettingsSaving}
                    className="flex-1 rounded-lg border px-4 py-3 text-[15px] font-mono leading-[1.5] bg-transparent outline-none transition-colors focus:border-[var(--os-accent)]"
                    style={{ borderColor: C.border, color: C.ink }}
                    placeholder={index === 0 ? "~/dev" : "Add another source root"}
                  />
                  <button
                    type="button"
                    className="os-toolbar-button text-[12px] font-medium px-3 py-3 rounded-lg border disabled:opacity-50 shrink-0"
                    style={{ color: C.ink, borderColor: C.border }}
                    onClick={() => handleBrowseForSourceRoot(index)}
                    disabled={appSettingsSaving}
                  >
                    Finder
                  </button>
                  <button
                    type="button"
                    className="os-toolbar-button text-[14px] font-medium w-10 h-10 rounded-lg border disabled:opacity-50 shrink-0"
                    style={{ color: C.ink, borderColor: C.border }}
                    onClick={() => handleRemoveSourceRootRow(index)}
                    disabled={appSettingsSaving || ((visibleAppSettings.workspaceRoots ?? []).length <= 1 && !root)}
                    aria-label={`Remove source root ${index + 1}`}
                  >
                    -
                  </button>
                </div>
              ))}
              {(visibleAppSettings.workspaceRoots ?? []).length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-4 text-[12px] leading-[1.6]" style={{ borderColor: C.border, color: C.muted }}>
                  No scan folders yet. Add a path above to tell Scout where to look for repos and projects.
                </div>
              ) : null}
            </div>
            <div className="mt-5 pt-5 border-t" style={{ borderTopColor: C.border }}>
              <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={s.mutedText}>Relay Context Root</div>
              <div className="text-[12px] leading-[1.6] mb-3" style={s.mutedText}>
                This is different from the scan folders above. Scout will save this context here by writing <code className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: C.bg }}>.openscout/project.json</code> inside this directory.
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={visibleAppSettings.onboardingContextRoot ?? ''}
                  onChange={(event) => handleSetOnboardingContextRoot(event.target.value)}
                  readOnly={appSettingsSaving}
                  className="flex-1 rounded-lg border px-4 py-3 text-[15px] font-mono leading-[1.5] bg-transparent outline-none transition-colors focus:border-[var(--os-accent)]"
                  style={{ borderColor: C.border, color: C.ink }}
                  placeholder="Choose where .openscout should live"
                />
                <button
                  type="button"
                  className="os-toolbar-button text-[12px] font-medium px-3 py-3 rounded-lg border disabled:opacity-50 shrink-0"
                  style={{ color: C.ink, borderColor: C.border }}
                  onClick={handleBrowseForOnboardingContextRoot}
                  disabled={appSettingsSaving}
                >
                  Finder
                </button>
              </div>
            </div>
            <div className="text-[12px] mt-3 leading-[1.6]" style={s.mutedText}>
              Usually something like <code className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: C.bg }}>~/dev</code> or <code className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: C.bg }}>~/src</code>.
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {SOURCE_ROOT_PATH_SUGGESTIONS.map((root) => (
                <button
                  key={root}
                  className="os-toolbar-button text-[12px] font-mono font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50"
                  style={{ color: C.ink, borderColor: C.border }}
                  onClick={() => handleAddSourceRootSuggestion(root)}
                  disabled={appSettingsSaving}
                >
                  {root}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (activeOnboardingStep.id === 'harness') {
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
              Default harness
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              Which assistant should answer new project turns by default?
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(['claude', 'codex'] as const).map((harness) => {
              const runtimeEntry = (visibleAppSettings.runtimeCatalog ?? []).find((entry) => entry.name === harness) ?? null;
              const selected = visibleAppSettings.defaultHarness === harness;
              return (
                <button
                  key={harness}
                  className="os-card text-left rounded-xl border px-5 py-5 disabled:opacity-60"
                  style={{ borderColor: selected ? C.accent : C.border, backgroundColor: selected ? C.accentBg : C.surface, boxShadow: selected ? `0 0 0 1px ${C.accent}` : 'none' }}
                  disabled={appSettingsSaving}
                  onClick={() => {
                    setAppSettingsDraft((current) => current ? {
                      ...current,
                      defaultHarness: harness,
                    } : current);
                    setAppSettingsFeedback(null);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[18px] font-semibold capitalize tracking-tight" style={s.inkText}>{harness}</div>
                      <div className="text-[13px] mt-2 leading-[1.6]" style={s.mutedText}>
                        {harness === 'claude'
                          ? 'Anthropic Claude Code — agentic coding via local CLI session.'
                          : 'OpenAI Codex — agentic coding via cloud sandbox.'}
                      </div>
                      <div className="text-[12px] mt-4 leading-[1.6]" style={s.mutedText}>
                        Runtime: {runtimeEntry?.label ?? harness} · {runtimeEntry?.readinessDetail ?? 'Not reported yet.'}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono px-2.5 py-1 rounded-full shrink-0" style={selected ? s.activePill : s.tagBadge}>
                      {selected ? 'selected' : 'available'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (activeOnboardingStep.id === 'confirm') {
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
              Confirm this context
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              Review which folders Scout will scan and where it will save this context before continuing.
            </div>
          </div>

          <div className="rounded-xl border px-5 py-5" style={{ borderColor: C.border, backgroundColor: C.surface }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {[
                ['Operator', visibleAppSettings.operatorName || visibleAppSettings.operatorNameDefault],
                ['Source roots', (visibleAppSettings.workspaceRoots ?? []).join(', ') || 'None yet'],
                ['Default harness', visibleAppSettings.defaultHarness ?? 'Not set'],
                ['Relay context root', visibleAppSettings.onboardingContextRoot || 'Not set'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg px-4 py-3" style={{ backgroundColor: C.bg }}>
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: C.accent }}>{label}</div>
                  <div className="text-[15px] font-medium leading-[1.5]" style={s.inkText}>
                    {label === 'Relay context root'
                      ? renderLocalPathValue(String(value), { className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity' })
                      : value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {appSettingsDirty ? (
            <div className="text-[12px] leading-[1.6]" style={s.mutedText}>Unsaved changes.</div>
          ) : null}
        </div>
      );
    }

    if (activeOnboardingStep.id === 'setup') {
      const setupCommandLine = buildOnboardingCommandLine('setup');
      const setupRunning = onboardingCommandPending === 'setup';
      const initManifestPath = visibleAppSettings.currentProjectConfigPath
        ?? (visibleAppSettings.onboardingContextRoot ? `${visibleAppSettings.onboardingContextRoot}/.openscout/project.json` : 'Not created yet.');
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
              Setup
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              Create the local project manifest.
            </div>
          </div>

          {renderOnboardingCommandShell('setup', setupCommandLine, setupRunning)}

          <div className="rounded-xl border px-5 py-5" style={{ borderColor: C.border, backgroundColor: C.surface }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                ['1. Context root', visibleAppSettings.onboardingContextRoot || 'Not set'],
                ['2. Manifest', 'Writes `.openscout/project.json` at that root to anchor this context.'],
                ['3. Discovery', 'Uses that context plus scanned folders to build inventory and routing.'],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-lg border px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <div className="text-[11px] font-mono font-medium tracking-wide" style={{ color: C.accent }}>{label}</div>
                  <div className="text-[12px] mt-2 leading-[1.6]" style={s.mutedText}>{detail}</div>
                </div>
              ))}
            </div>
            <div className="text-[12px] font-mono mt-5 leading-[1.6] break-all" style={s.mutedText}>
              {typeof initManifestPath === 'string'
                ? renderLocalPathValue(initManifestPath, { className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity', style: s.mutedText })
                : initManifestPath}
            </div>
          </div>

          <button
            className="os-btn-primary flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
            style={{ backgroundColor: C.accent, color: '#fff' }}
            onClick={() => { void handleRunOnboardingCommand('setup'); }}
            disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsDirty}
          >
            {setupRunning ? 'Running Setup…' : 'Run Setup'}
          </button>
        </div>
      );
    }

    if (activeOnboardingStep.id === 'doctor') {
      const doctorCommandLine = buildOnboardingCommandLine('doctor');
      const doctorRunning = onboardingCommandPending === 'doctor';
      const brokerOk = visibleAppSettings.broker.reachable;
      const projectCount = visibleAppSettings.projectInventory.length;

      const statusItems = [
        {
          label: 'Broker',
          value: brokerOk ? 'Reachable' : 'Unavailable',
          ok: brokerOk,
          fix: brokerOk ? null : 'Re-run setup to install and start the broker service.',
        },
        {
          label: 'Projects',
          value: `${projectCount} found`,
          ok: projectCount > 0,
          fix: projectCount === 0 ? 'Add workspace roots in Settings → General, then refresh Workspaces.' : null,
        },
        {
          label: 'Context root',
          value: visibleAppSettings.currentProjectConfigPath ? 'Configured' : 'Missing',
          ok: Boolean(visibleAppSettings.currentProjectConfigPath),
          fix: visibleAppSettings.currentProjectConfigPath ? null : 'Run setup again from the previous step.',
        },
      ];
      const hasIssues = statusItems.some((item) => !item.ok);

      return (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>Doctor</div>
            <div className="text-[14px] leading-[1.6]" style={s.mutedText}>
              Verify broker health, project discovery, and relay context.
            </div>
          </div>

          {/* Status grid — live from app settings */}
          <div className="grid grid-cols-3 gap-3">
            {statusItems.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border px-4 py-3"
                style={{
                  borderColor: item.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
                  backgroundColor: item.ok ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)',
                }}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span style={{ color: item.ok ? '#16a34a' : '#dc2626', fontSize: 13 }}>
                    {item.ok ? '✓' : '✗'}
                  </span>
                  <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: item.ok ? '#16a34a' : '#dc2626' }}>
                    {item.label}
                  </div>
                </div>
                <div className="text-[13px] font-medium" style={s.inkText}>{item.value}</div>
                {item.fix && (
                  <div className="text-[11px] mt-1.5 leading-[1.5]" style={{ color: '#dc2626', opacity: 0.8 }}>
                    {item.fix}
                  </div>
                )}
              </div>
            ))}
          </div>

          {renderOnboardingCommandShell('doctor', doctorCommandLine, doctorRunning)}

          <button
            className="os-btn-primary flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
            style={{ backgroundColor: hasIssues ? '#dc2626' : C.accent, color: '#fff' }}
            onClick={() => { void handleRunOnboardingCommand('doctor'); }}
            disabled={Boolean(onboardingCommandPending) || appSettingsLoading || !onboardingHasProjectConfig}
          >
            {doctorRunning ? 'Running Doctor…' : hasIssues ? 'Run Doctor to diagnose' : 'Run Doctor'}
          </button>
        </div>
      );
    }

    const runtimesCommandLine = buildOnboardingCommandLine('runtimes');
    return (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>Runtimes</div>
          <div className="text-[14px] leading-[1.6]" style={s.mutedText}>
            Verify each harness has a working local runtime.
          </div>
        </div>

        {/* Runtime status cards — always visible, live from settings */}
        {(visibleAppSettings.runtimeCatalog ?? []).length > 0 && (
          <div className="grid grid-cols-1 gap-2">
            {(visibleAppSettings.runtimeCatalog ?? []).map((runtimeEntry) => {
              const ready = runtimeEntry.readinessState === 'ready';
              return (
                <div
                  key={runtimeEntry.name}
                  className="rounded-xl border px-4 py-3 flex items-start justify-between gap-3"
                  style={{
                    borderColor: ready ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
                    backgroundColor: ready ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)',
                  }}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 text-[14px]" style={{ color: ready ? '#16a34a' : '#dc2626' }}>
                      {ready ? '✓' : '✗'}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold" style={s.inkText}>{runtimeEntry.label}</div>
                      <div className="text-[11px] mt-0.5 leading-[1.5]" style={ready ? s.mutedText : { color: '#dc2626', opacity: 0.85 }}>
                        {runtimeEntry.readinessDetail}
                      </div>
                      {!ready && runtimeEntry.readinessState === 'missing' && (
                        <div className="text-[10px] font-mono mt-1.5 px-2 py-1 rounded inline-block" style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#dc2626' }}>
                          {runtimeEntry.name === 'claude' ? 'brew install claude' : runtimeEntry.name === 'codex' ? 'npm install -g @openai/codex' : `install ${runtimeEntry.name}`}
                        </div>
                      )}
                      {!ready && runtimeEntry.readinessState === 'configured' && (
                        <div className="text-[10px] font-mono mt-1.5 px-2 py-1 rounded inline-block" style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#dc2626' }}>
                          {runtimeEntry.name === 'claude' ? 'claude login' : runtimeEntry.name === 'codex' ? 'codex login' : `${runtimeEntry.name} login`}
                        </div>
                      )}
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-mono px-2.5 py-1 rounded-full shrink-0"
                    style={ready ? s.activePill : { backgroundColor: 'rgba(239,68,68,0.12)', color: '#dc2626' }}
                  >
                    {runtimeEntry.readinessState}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {renderOnboardingCommandShell('runtimes', runtimesCommandLine, onboardingCommandPending === 'runtimes')}

        <button
          className="os-btn-primary flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
          style={{ backgroundColor: C.accent, color: '#fff' }}
          onClick={() => void handleRunOnboardingCommand('runtimes')}
          disabled={Boolean(onboardingCommandPending) || appSettingsLoading}
        >
          {onboardingCommandPending === 'runtimes' ? 'Running Runtimes…' : 'Run Runtimes'}
        </button>
      </div>
    );
  };

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
                    {onboardingWizardSteps.map((step) => {
                      const idx = ONBOARDING_WIZARD_STEP_ORDER.indexOf(step.id);
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
                  {renderImmersiveOnboardingStep()}

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
    <div
      className={`flex flex-col h-screen w-full font-sans overflow-hidden${dark ? ' dark' : ''}`}
      style={s.root}
    >
      {/* Global Top Bar */}
      <div className="scout-window-bar h-12 border-b flex items-center px-3 shrink-0 z-10 gap-3" style={s.topBar}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="w-5 h-5 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--os-hover)]"
            style={{ WebkitAppRegion: 'no-drag', color: C.muted } as React.CSSProperties}
            onClick={handleQuitApp}
            aria-label="Quit"
            title="Quit"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1l-6 6"/></svg>
          </button>
          <div className="flex items-center gap-1.5 ml-2">
            {([
              ['relay', 'Relay', desktopFeatures.relay],
              ['pairing', 'Pairing', desktopFeatures.pairing],
            ] as const)
              .filter(([, , enabled]) => enabled)
              .map(([surface, label]) => {
              const active = productSurface === surface;
              const badge = surface === 'pairing' ? pairingSurfaceBadge : null;
              return (
                <button
                  key={surface}
                  type="button"
                  onClick={() => setProductSurface(surface)}
                  className="flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[12px] font-semibold tracking-tight transition-colors"
                  style={active
                    ? { backgroundColor: C.surface, borderColor: C.border, color: C.ink, boxShadow: `0 1px 0 rgba(0,0,0,0.04)` }
                    : { backgroundColor: C.bg, borderColor: C.border, color: C.muted }}
                >
                  <ProductSurfaceLogo surface={surface} active={active} />
                  <span>{label}</span>
                  {badge ? (
                    <span
                      className="rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]"
                      style={{
                        backgroundColor: badge.backgroundColor,
                        borderColor: badge.borderColor,
                        color: badge.color,
                      }}
                    >
                      {badge.label}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        <div
          className="flex-1 self-stretch min-w-[120px] rounded-md cursor-grab active:cursor-grabbing"
          aria-hidden="true"
        />
        <div className="flex items-center gap-5 shrink-0">
          <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider" style={s.mutedText}>
            <button
              type="button"
              onClick={openRelayDiagnostics}
              className="flex items-center gap-1.5 rounded-full border px-2 py-1 transition-opacity hover:opacity-80"
              style={{ borderColor: C.border }}
              title={relayStatusTitle}
            >
              Relay
              {relayRuntimeBooting ? (
                <Spinner
                  className="text-[11px]"
                  style={{ color: C.muted }}
                  aria-label="Syncing relay status"
                />
              ) : (
                <>
                  <div className={`w-1.5 h-1.5 rounded-full ${relayStatusDotClassName}`}></div>
                  <span className="font-medium" style={s.inkText}>{relayStatusLabel}</span>
                </>
              )}
            </button>
            <div className="flex items-center gap-1.5">
              Agents <span className="font-medium" style={s.inkText}>{runtime?.agentCount ?? 0}</span>
            </div>
          </div>
          <div className="flex items-center gap-2" style={s.mutedText}>
            <button
              onClick={() => setDark(d => !d)}
              className="p-1 rounded transition-colors hover:opacity-70"
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              className="hover:opacity-70 transition-opacity"
              onClick={handleReloadApp}
              title={appReloadPending ? 'Reloading…' : 'Reload app'}
              disabled={appReloadPending}
            >
              {appReloadPending ? <Spinner className="text-[14px]" /> : <RefreshCw size={14} />}
            </button>
          </div>
        </div>
      </div>

      {productSurface === 'relay' ? (
      <>
      <div className="flex flex-1 overflow-hidden os-fade-in">
        {/* Sidebar Nav (Leftmost) */}
        <div className="w-12 border-r flex flex-col items-center py-2 gap-3 shrink-0 z-10" style={s.navBar}>
          <div className="flex flex-col gap-1 w-full px-2 mt-2" style={s.mutedText}>
            {navViews.map(({ id, icon, title, badgeCount }) => (
              <button
                key={id}
                onClick={() => setActiveView(id)}
                title={title}
                className="relative p-1.5 rounded flex items-center justify-center transition-colors"
                style={activeView === id ? s.activePill : undefined}
              >
                {icon}
                {badgeCount ? (
                  <span
                    className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-mono flex items-center justify-center"
                    style={{ backgroundColor: '#f97316', color: '#fff7ed' }}
                  >
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-1 items-center w-full px-2">
            {collapsibleViews.has(activeView) && (
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-1.5 rounded flex items-center justify-center transition-opacity hover:opacity-70"
                style={s.mutedText}
                title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              >
                {isCollapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
              </button>
            )}
            {desktopFeatures.settings ? (
              <button
                className="p-1.5 rounded flex items-center justify-center transition-colors"
                style={activeView === 'settings' ? s.activePill : s.mutedText}
                title="Settings"
                onClick={() => setActiveView('settings')}
              >
                <Settings size={16} strokeWidth={1.5} />
              </button>
            ) : null}
          </div>
        </div>

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
            onSelectRelay: openMessagesRelayDestination,
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
            onOpenRelayAgent: openRelayAgentThread,
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
            onOpenRelayAgent: openRelayAgentThread,
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
        <SettingsHelpView
          activeView={activeView}
          help={{
            styles: {
              surface: s.surface,
              inkText: s.inkText,
              mutedText: s.mutedText,
              tagBadge: s.tagBadge,
              activePill: s.activePill,
            },
            buildOnboardingCommandLine,
            onboardingCopiedCommand,
            onboardingCommandPending,
            onCopyOnboardingCommand: handleCopyOnboardingCommand,
            onRunOnboardingCommand: handleRunOnboardingCommand,
            onOpenGeneralSettings: () => {
              setActiveView('settings');
              setSettingsSection('profile');
            },
          }}
          settings={{
            styles: {
              surface: s.surface,
              inkText: s.inkText,
              mutedText: s.mutedText,
              tagBadge: s.tagBadge,
              activePill: s.activePill,
            },
            settingsSection,
            settingsSections,
            activeSettingsMeta,
            onSetSettingsSection: setSettingsSection,
            onOpenFeedbackDialog: openFeedbackDialog,
            headerActions: settingsSection === 'profile' ? (
              <>
                {isAppSettingsEditing ? (
                  <>
                    <button
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                      style={{ color: C.ink }}
                      onClick={() => handleCancelAppSettingsEdit()}
                      disabled={appSettingsSaving}
                    >
                      Cancel
                    </button>
                    <button
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                      style={{ color: C.ink }}
                      onClick={() => void handleSaveAppSettings()}
                      disabled={!appSettingsDirty || appSettingsSaving || appSettingsLoading}
                    >
                      {appSettingsSaving ? 'Saving…' : 'Save General'}
                    </button>
                  </>
                ) : (
                  <button
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                    style={{ color: C.ink }}
                    onClick={() => handleStartAppSettingsEdit()}
                    disabled={appSettingsLoading || !visibleAppSettings}
                  >
                    Edit General
                  </button>
                )}
                <button
                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                  style={{ color: C.ink }}
                  onClick={handleRestartOnboarding}
                  disabled={appSettingsLoading || !visibleAppSettings}
                >
                  <RefreshCw size={12} />
                  Restart onboarding
                </button>
              </>
            ) : settingsSection === 'communication' ? (
              isAppSettingsEditing ? (
                <>
                  <button
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                    style={{ color: C.ink }}
                    onClick={() => handleCancelAppSettingsEdit()}
                    disabled={appSettingsSaving}
                  >
                    Cancel
                  </button>
                  <button
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                    style={{ color: C.ink }}
                    onClick={() => void handleSaveAppSettings()}
                    disabled={!appSettingsDirty || appSettingsSaving || appSettingsLoading}
                  >
                    {appSettingsSaving ? 'Saving…' : desktopFeatures.telegram ? 'Save Telegram' : 'Save Communication'}
                  </button>
                </>
              ) : (
                <button
                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                  style={{ color: C.ink }}
                  onClick={() => handleStartAppSettingsEdit()}
                  disabled={appSettingsLoading || !visibleAppSettings}
                >
                  {desktopFeatures.telegram ? 'Edit Telegram' : 'Edit Communication'}
                </button>
              )
            ) : settingsSection === 'agents' ? (
              <>
                <button
                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ color: C.ink }}
                  onClick={() => setActiveView('agents')}
                >
                  Open Agents
                </button>
                {selectedInterAgent && hasEditableAgentConfig ? (
                  isAgentConfigEditing ? (
                    <>
                      <button
                        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                        style={{ color: C.ink }}
                        onClick={() => handleCancelAgentConfigEdit()}
                        disabled={agentConfigSaving || agentConfigRestarting}
                      >
                        Cancel
                      </button>
                      <button
                        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                        style={{ color: C.ink }}
                        onClick={() => void handleSaveAgentConfig()}
                        disabled={!agentConfigDirty || agentConfigLoading || agentConfigSaving || agentConfigRestarting}
                      >
                        {agentConfigSaving ? 'Saving…' : 'Save Changes'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                      style={{ color: C.ink }}
                      onClick={() => handleStartAgentConfigEdit()}
                      disabled={agentConfigLoading || agentConfigRestarting}
                    >
                      Edit Agent
                    </button>
                  )
                ) : null}
                {selectedInterAgent && hasEditableAgentConfig ? (
                  <button
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                    style={{ color: C.ink }}
                    onClick={() => void handleRestartAgent()}
                    disabled={agentConfigLoading || agentConfigRestarting || !visibleAgentConfig}
                  >
                    {agentConfigRestarting ? 'Restarting…' : agentRestartActionLabel}
                  </button>
                ) : null}
              </>
            ) : settingsSection === 'database' ? (
              <button
                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                style={{ color: C.ink }}
                onClick={() => setActiveView('sessions')}
              >
                Browse Sessions
              </button>
            ) : null,
            profile: {
              styles: {
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
              },
              visibleAppSettings,
              appSettings,
              isAppSettingsEditing,
              appSettingsSaving,
              appSettingsLoading,
              appSettingsDirty,
              appSettingsFeedback,
              settingsOperatorNameRef,
              onboardingWizardStep,
              setOnboardingWizardStep,
              activeOnboardingStepIndex: onboardingWizardIndex,
              activeOnboardingStep,
              onboardingWizardSteps,
              sourceRootPathSuggestions: SOURCE_ROOT_PATH_SUGGESTIONS,
              onboardingRuntimeMatch,
              onboardingHasProjectConfig,
              onboardingCopiedCommand,
              onboardingCommandPending,
              onboardingCommandResult,
              canGoToPreviousOnboardingStep,
              canGoToNextOnboardingStep,
              moveOnboardingWizard,
              handleOnboardingContinue,
              handleRestartOnboarding,
              handleStartAppSettingsEdit,
              handleBeginGeneralEdit,
              handleSetSourceRootAt,
              handleBrowseForSourceRoot,
              handleRemoveSourceRootRow,
              handleAddSourceRootRow,
              handleAddSourceRootSuggestion,
              handleSetOnboardingContextRoot,
              handleBrowseForOnboardingContextRoot,
              setAppSettingsDraft,
              setAppSettingsFeedback,
              buildOnboardingCommandLine,
              handleCopyOnboardingCommand,
              handleRunOnboardingCommand,
              renderOnboardingCommandShell,
              renderLocalPathValue,
              openKnowledgeBase,
            },
            agentSettingsViewProps: {
              styles: {
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
              },
              selectedInterAgent,
              availableAgents: rosterInterAgentAgents,
              isAgentConfigEditing,
              hasEditableAgentConfig,
              agentConfigLoading,
              agentConfigSaving,
              agentConfigRestarting,
              visibleAgentConfig,
              agentConfigFeedback,
              agentCapabilitiesPreview,
              agentRuntimePathRef,
              onOpenAgents: () => setActiveView('agents'),
              onOpenAgentProfile: openAgentProfile,
              onOpenAgentThread: (agentId) => openRelayAgentThread(agentId, { focusComposer: true }),
              onUpdateAgentConfigDraft: updateAgentConfigDraft,
              renderLocalPathValue,
              interAgentProfileKindLabel,
              onSelectAgent: handleSelectInterAgent,
            },
            workspaceExplorerViewProps: {
              styles: {
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
              },
              selectedWorkspaceProject,
              selectedWorkspaceAgent,
              workspaceExplorerQuery,
              setWorkspaceExplorerQuery,
              workspaceExplorerFilter,
              setWorkspaceExplorerFilter,
              workspaceExplorerViewMode,
              setWorkspaceExplorerViewMode,
              workspaceExplorerItems,
              workspaceExplorerBoundCount,
              workspaceExplorerDiscoveredCount,
              filteredWorkspaceExplorerItems,
              workspaceInventoryLoaded,
              workspaceInventoryLoading,
              canRefreshWorkspaceInventory,
              onboardingCommandPending,
              appSettingsLoading,
              appSettingsSaving,
              appSettingsDirty,
              appSettingsFeedback,
              showDoctorOutput,
              doctorOutput: renderOnboardingCommandShell('doctor', buildOnboardingCommandLine('doctor'), onboardingCommandPending === 'doctor'),
              projectRetirementPendingRoot,
              onRefreshWorkspaceDiscovery: () => {
                void handleRunOnboardingCommand('doctor');
              },
              onLoadWorkspaceInventory: handleLoadWorkspaceInventory,
              onAddWorkspace: handleAddWorkspaceFromExplorer,
              onInspectWorkspace: handleInspectWorkspace,
              onOpenWorkspace: handleOpenWorkspace,
              onRetireWorkspace: (project) => {
                void handleRetireProject(project.root, project.title);
              },
              onOpenAgentProfile: openAgentProfile,
              onOpenAgentSettings: (agentId) => openAgentSettings(agentId, true),
              renderLocalPathValue,
            },
            communicationSettingsViewProps: {
              styles: {
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
              },
              showTelegram: desktopFeatures.telegram,
              showVoice: desktopFeatures.voice,
              visibleAppSettings,
              isAppSettingsEditing,
              appSettingsSaving,
              appSettingsFeedback,
              onUpdateAppSettingsDraft: updateAppSettingsDraft,
              brokerInspector,
              brokerControlPending,
              brokerControlFeedback,
              onBrokerControl: (action) => {
                void handleBrokerControl(action);
              },
              relayServiceInspectorRef,
              relayRuntimeBooting,
              relayRuntimeHealthLabel,
              runtime,
              reachableRelayAgentCount: reachableRelayAgents.length,
              voiceCaptureTitle: relayState?.voice.captureTitle ?? 'Not reported',
              voiceRepliesEnabled: relayState?.voice.repliesEnabled ?? false,
              onSetVoiceRepliesEnabled: (enabled) => {
                void handleSetVoiceRepliesEnabled(enabled);
              },
              renderLocalPathValue,
            },
            database: {
              styles: {
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
              },
              stats,
              runtime,
              visibleAppSettings,
              renderLocalPathValue,
              onRevealPath: (filePath) => {
                if (!surfaceCaps?.canRevealPath) {
                  return;
                }
                void scoutDesktop?.revealPath?.(filePath);
              },
            },
            appearance: {
              styles: {
                surface: s.surface,
                inkText: s.inkText,
                mutedText: s.mutedText,
                tagBadge: s.tagBadge,
                activePill: s.activePill,
              },
              dark,
              setDark,
              showAnnotations,
              setShowAnnotations,
              isCollapsed,
              activeSettingsLabel: activeSettingsMeta.label,
            },
          }}
        />
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
            onOpenAgentThread: openRelayAgentThread,
            onPeekAgentSession: handlePeekAgentSession,
            onOpenAgentSettings: openAgentSettings,
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
            onInlineAgentSessionScroll: (event) => {
              agentSessionInlineStickToBottomRef.current = agentSessionShouldStickToBottom(event.currentTarget);
            },
            renderLocalPathValue,
            selectedInterAgentActivityMessages,
            interAgentAgentLookup,
            relayDirectLookup,
            onOpenAgentProfile: openAgentProfile,
            onNudgeMessage: handleNudgeMessage,
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
            selectedRelayDirectThread,
            showAnnotations,
            setShowAnnotations,
            interAgentMessageTarget,
            openAgentDirectMessage,
            interAgentConfigureTarget,
            onOpenAgentSettings: openAgentSettings,
            interAgentConfigureLabel,
            visibleInterAgentMessages,
            interAgentAgentLookup,
            relayDirectLookup,
            onOpenAgentProfile: openAgentProfile,
            onNudgeMessage: handleNudgeMessage,
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
            onNudgeMessage: handleNudgeMessage,
            messagesDetailOpen,
            setMessagesDetailOpen,
            messagesDetailTab,
            setMessagesDetailTab,
          }}
          composer={
            {
              selectedRelayKind,
              selectedRelayId,
              relayThreadTitle,
              relayThreadSubtitle,
              relayThreadCount,
              selectedRelayDirectThread,
              relayVoiceState: relayState?.voice,
              visibleRelayMessages,
              relayTimelineViewportRef,
              onRelayTimelineScroll: handleRelayTimelineScroll,
              relayReplyTarget,
              setRelayReplyTarget,
              relayContextReferences,
              relayContextMessageIds,
              setRelayContextMessageIds,
              relayComposerRef,
              relayDraft,
              setRelayDraft,
              relaySending,
              relayFeedback,
              relayComposerSelectionStart,
              setRelayComposerSelectionStart,
              mergedRelayMessages,
              relayMentionMenuOpen,
              relayMentionSuggestions,
              relayMentionSelectionIndex,
              setRelayMentionSelectionIndex,
              relayMentionDuplicateTitleCounts,
              applyRelayMentionSuggestion,
              onRelaySend: () => void handleRelaySend(),
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
            onOpenAgentSettings: openAgentSettings,
            desktopVoiceEnabled: desktopFeatures.voice,
          }}
        />
      </div>

      {isAgentSessionPeekOpen && selectedInterAgent ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-6"
          style={{ backgroundColor: 'rgba(244, 240, 232, 0.72)', backdropFilter: 'blur(6px)' }}
          onClick={() => setIsAgentSessionPeekOpen(false)}
        >
          <div
            className="w-full max-w-5xl h-[78vh] border rounded-2xl overflow-hidden flex flex-col"
            style={{
              backgroundColor: C.surface,
              borderColor: C.border,
              boxShadow: '0 24px 72px rgba(15, 23, 42, 0.16)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 h-14 border-b flex items-center justify-between gap-3 shrink-0" style={{ borderBottomColor: C.border }}>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold tracking-tight truncate" style={s.inkText}>
                  Peek · {selectedInterAgent.title}
                </div>
                <div className="text-[11px] truncate mt-0.5" style={s.mutedText}>
                  {agentSessionPending
                    ? 'Checking tmux pane and runtime logs for the selected agent.'
                    : visibleAgentSession?.subtitle ?? 'No live session output available yet.'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {visibleAgentSession?.commandLabel ? (
                  <button
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                    style={{ color: C.ink }}
                    onClick={() => void handleCopyAgentSessionCommand()}
                  >
                    {agentSessionCopied ? 'Copied' : 'Copy Attach'}
                  </button>
                ) : null}
                {visibleAgentSession && visibleAgentSession.mode !== 'none' ? (
                  <button
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                    style={{ color: C.ink }}
                    onClick={() => void handleOpenAgentSession()}
                  >
                    {visibleAgentSession.mode === 'tmux' ? 'Open TMUX' : 'Open Logs'}
                  </button>
                ) : null}
                <button
                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ color: C.ink }}
                  onClick={() => setIsAgentSessionPeekOpen(false)}
                >
                  <X size={12} />
                  Close
                </button>
              </div>
            </div>

            <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap text-[10px] shrink-0" style={{ borderBottomColor: C.border, color: C.muted }}>
              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={visibleAgentSession?.mode === 'tmux' ? s.activePill : s.tagBadge}>
                {agentSessionPending ? 'Loading' : visibleAgentSession?.mode === 'tmux' ? 'TMUX' : visibleAgentSession?.mode === 'logs' ? 'Logs' : 'Unavailable'}
              </span>
              {(visibleAgentSession?.harness ?? selectedInterAgent.harness) ? (
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                  {visibleAgentSession?.harness ?? selectedInterAgent.harness}
                </span>
              ) : null}
              {(visibleAgentSession?.transport ?? selectedInterAgent.transport) ? (
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                  {visibleAgentSession?.transport ?? selectedInterAgent.transport}
                </span>
              ) : null}
              {(visibleAgentSession?.sessionId ?? selectedInterAgent.sessionId) ? (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>
                  {visibleAgentSession?.sessionId ?? selectedInterAgent.sessionId}
                </span>
              ) : null}
              {visibleAgentSession?.updatedAtLabel ? <span>Updated {visibleAgentSession.updatedAtLabel}</span> : null}
              {typeof visibleAgentSession?.lineCount === 'number' && visibleAgentSession.lineCount > 0 ? <span>{visibleAgentSession.lineCount} lines</span> : null}
              {visibleAgentSession?.truncated ? <span>Tail only</span> : null}
              <span>Refreshing live while open</span>
            </div>

            <div className="flex-1 overflow-hidden" style={{ backgroundColor: C.bg }}>
              {agentSessionLoading && !visibleAgentSession ? (
                <div className="px-4 py-8 text-[12px]" style={s.mutedText}>
                  Loading live session…
                </div>
              ) : visibleAgentSession?.body ? (
                <pre
                  ref={(element) => {
                    agentSessionPeekViewportRef.current = element;
                  }}
                  onScroll={(event) => {
                    agentSessionPeekStickToBottomRef.current = agentSessionShouldStickToBottom(event.currentTarget);
                  }}
                  className="h-full px-4 py-4 text-[11px] leading-[1.58] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words"
                  style={{ color: C.ink, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                >
                  {visibleAgentSession.body}
                </pre>
              ) : (
                <div className="px-4 py-8 text-[12px] leading-[1.65]" style={s.mutedText}>
                  {agentSessionPending
                    ? 'Checking for a live tmux pane first, then falling back to canonical runtime logs.'
                    : visibleAgentSession?.subtitle ?? 'No session output available yet.'}
                </div>
              )}
            </div>

            <div className="px-4 h-10 border-t flex items-center justify-between gap-3 shrink-0 text-[10px]" style={{ borderTopColor: C.border, color: C.muted }}>
              <div className="truncate min-w-0">
                {renderLocalPathValue(
                  visibleAgentSession?.pathLabel ?? compactHomePath(selectedInterAgent.cwd ?? selectedInterAgent.projectRoot) ?? 'No stable session path yet.',
                  {
                    className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity',
                  },
                )}
              </div>
              {agentSessionFeedback ? <div style={s.inkText}>{agentSessionFeedback}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
      </>
      ) : (
        <PairingSurfacePlaceholder
          pairingControlPending={pairingControlPending}
          pairingConfigFeedback={pairingConfigFeedback}
          pairingConfigPending={pairingConfigPending}
          pairingError={pairingError}
          pairingLoading={pairingLoading}
          pairingState={pairingState}
          onControlPairing={handlePairingControl}
          onDecideApproval={handleDecidePairingApproval}
          onOpenFullLogs={() => {
            setProductSurface('relay');
            setActiveView('logs');
          }}
          onOpenFeedback={openFeedbackDialog}
          pairingApprovalPendingId={pairingApprovalPendingId}
          onUpdateConfig={handleUpdatePairingConfig}
          onRefresh={() => void handleRefreshShell()}
          onRevealPath={(filePath) => {
            if (!surfaceCaps?.canRevealPath) {
              return;
            }
            void scoutDesktop?.revealPath?.(filePath);
          }}
        />
      )}

      <Dialog open={isCreateAgentDialogOpen} onOpenChange={setIsCreateAgentDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New Agent</DialogTitle>
            <DialogDescription>
              Pick a project, choose a harness, and start a local relay agent without leaving the homepage.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-widest" style={s.mutedText}>
                Project
              </label>
              <select
                className="w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none"
                style={{ borderColor: C.border, backgroundColor: C.surface, color: C.ink }}
                value={agentableProjects.find((project) => project.root === createAgentDraft.projectPath)?.id ?? ''}
                onChange={(event) => {
                  const nextProject = agentableProjects.find((project) => project.id === event.target.value) ?? null;
                  if (!nextProject) {
                    return;
                  }
                  setCreateAgentDraft((current) => ({
                    ...current,
                    projectPath: nextProject.root,
                    harness: normalizeCreateAgentHarness(nextProject.defaultHarness || current.harness),
                  }));
                  setCreateAgentFeedback(null);
                }}
              >
                <option value="">Select a discovered project</option>
                {agentableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title} · {compactHomePath(project.root) ?? project.root}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-widest" style={s.mutedText}>
                Path
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={createAgentDraft.projectPath}
                  onChange={(event) => {
                    setCreateAgentDraft((current) => ({ ...current, projectPath: event.target.value }));
                    setCreateAgentFeedback(null);
                  }}
                  placeholder={createAgentDefaults.projectPath || "/path/to/project"}
                  className="h-10"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={handleBrowseCreateAgentProject}
                >
                  <FolderOpen size={14} />
                  Browse
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_160px]">
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-widest" style={s.mutedText}>
                  Agent Name
                </label>
                <Input
                  value={createAgentDraft.agentName}
                  onChange={(event) => {
                    setCreateAgentDraft((current) => ({ ...current, agentName: event.target.value }));
                    setCreateAgentFeedback(null);
                  }}
                  placeholder="Optional. Defaults to the project name."
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-widest" style={s.mutedText}>
                  Harness
                </label>
                <select
                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none"
                  style={{ borderColor: C.border, backgroundColor: C.surface, color: C.ink }}
                  value={createAgentDraft.harness}
                  onChange={(event) => {
                    setCreateAgentDraft((current) => ({
                      ...current,
                      harness: normalizeCreateAgentHarness(event.target.value),
                    }));
                    setCreateAgentFeedback(null);
                  }}
                >
                  {AVAILABLE_AGENT_HARNESSES.map((harness) => (
                    <option key={harness} value={harness}>
                      {harness}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-lg border px-3 py-3 text-[12px] leading-[1.6]" style={{ borderColor: C.border, backgroundColor: C.surface, color: C.muted }}>
              Scout will create the relay-agent config if needed, start the session, then refresh the desktop shell so the new agent appears immediately.
            </div>

            {createAgentFeedback ? (
              <div className="text-[12px] leading-[1.6]" style={{ color: '#b91c1c' }}>
                {createAgentFeedback}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateAgentDialogOpen(false)}
              disabled={createAgentSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateAgent}
              disabled={createAgentSubmitting || !createAgentDraft.projectPath.trim()}
            >
              {createAgentSubmitting ? (
                <>
                  <Spinner className="mr-2" />
                  Starting…
                </>
              ) : (
                <>
                  <Bot size={14} />
                  Create Agent
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isFeedbackDialogOpen}
        onOpenChange={(open) => {
          setIsFeedbackDialogOpen(open);
          if (!open) {
            setFeedbackActionMessage(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Feedback</DialogTitle>
            <DialogDescription>
              Submit feedback directly, copy a support bundle, inspect the local Scout environment, or repair onboarding and background services without leaving the current screen.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[12px] font-medium" style={s.inkText}>What should we look at?</div>
              <Textarea
                value={feedbackDraft}
                onChange={(event) => setFeedbackDraft(event.target.value)}
                placeholder="Describe the issue, what you expected, and what Scout did instead."
                className="min-h-24 resize-y"
                disabled={feedbackActionPending === 'submit'}
              />
              {feedbackSubmission ? (
                <div className="text-[11px] leading-[1.5]" style={s.mutedText}>
                  Latest submission: <a href={feedbackSubmission.adminUrl} target="_blank" rel="noreferrer" className="underline">{feedbackSubmission.key}</a>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={handleSubmitFeedbackReport}
                disabled={feedbackBundleLoading || feedbackActionPending !== null}
              >
                {feedbackActionPending === 'submit' ? <Spinner className="mr-2" /> : <SendHorizontal size={14} />}
                Submit Feedback
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleRefreshFeedbackBundle}
                disabled={feedbackBundleLoading || feedbackActionPending !== null}
              >
                {feedbackActionPending === 'refresh' ? <Spinner className="mr-2" /> : <RefreshCw size={14} />}
                Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleRepairSetup}
                disabled={feedbackBundleLoading || feedbackActionPending !== null}
              >
                {feedbackActionPending === 'repair' ? <Spinner className="mr-2" /> : <Settings2 size={14} />}
                Repair Setup
              </Button>
              <Button
                type="button"
                onClick={handleCopyFeedbackBundle}
                disabled={feedbackBundleLoading || feedbackActionPending !== null || !feedbackBundle?.text}
              >
                {feedbackActionPending === 'copy' ? <Spinner className="mr-2" /> : <Copy size={14} />}
                Copy Support Bundle
              </Button>
            </div>

            {feedbackActionMessage ? (
              <div className="text-[12px] leading-[1.6]" style={s.inkText}>
                {feedbackActionMessage}
              </div>
            ) : null}

            {feedbackBundleError ? (
              <div className="text-[12px] leading-[1.6]" style={{ color: '#b91c1c' }}>
                {feedbackBundleError}
              </div>
            ) : null}

            <div
              className="max-h-[60vh] space-y-3 overflow-y-auto pr-1"
              style={{ scrollbarGutter: 'stable both-edges' as React.CSSProperties['scrollbarGutter'] }}
            >
              {feedbackBundleLoading && !feedbackBundle ? (
                <div className="flex items-center gap-2 text-[12px]" style={s.mutedText}>
                  <Spinner className="text-[14px]" />
                  Loading support details…
                </div>
              ) : null}

              {feedbackBundle ? (
                <>
                  <div
                    className="rounded-lg border px-3 py-2.5 text-[11px] leading-[1.6]"
                    style={{ borderColor: C.border, backgroundColor: C.surface }}
                  >
                    <span className="font-mono uppercase tracking-widest" style={s.mutedText}>
                      Generated
                    </span>
                    <div className="mt-1" style={s.inkText}>{feedbackBundle.generatedAtLabel}</div>
                  </div>

                  {feedbackBundle.sections.map((section) => (
                    <section
                      key={section.id}
                      className="rounded-xl border"
                      style={{ borderColor: C.border, backgroundColor: C.surface }}
                    >
                      <div className="border-b px-4 py-3" style={{ borderBottomColor: C.border }}>
                        <h3 className="text-[12px] font-semibold tracking-tight" style={s.inkText}>
                          {section.title}
                        </h3>
                      </div>
                      <div className="divide-y" style={{ borderColor: C.border }}>
                        {section.entries.map((entry) => (
                          <div
                            key={`${section.id}-${entry.label}`}
                            className="grid grid-cols-1 gap-1 px-4 py-3 text-[12px] leading-[1.6] sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3"
                          >
                            <div className="font-mono uppercase tracking-widest" style={s.mutedText}>
                              {entry.label}
                            </div>
                            <div className="break-words" style={s.inkText}>
                              {entry.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Global Bottom Bar */}
      <div className="h-6 border-t flex items-center justify-between px-3 shrink-0 text-[9px] font-mono uppercase tracking-widest" style={{ backgroundColor: C.bg, borderTopColor: C.border, color: C.muted }}>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              setProductSurface('relay');
              setActiveView('overview');
            }}
            className="flex items-center gap-1 hover:opacity-70 cursor-pointer transition-opacity"
          >
            <LayoutGrid size={9} /> Home
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openFeedbackDialog}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:opacity-80"
            style={isFeedbackDialogOpen ? s.activePill : s.mutedText}
            title="Feedback"
          >
            <MessageSquare size={9} />
            <span>Feedback</span>
          </button>
          <button
            type="button"
            onClick={openKnowledgeBase}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:opacity-80"
            style={activeView === 'help' ? s.activePill : s.mutedText}
            title="Help"
          >
            <BookOpen size={9} />
            <span>Help</span>
          </button>
          <button
            onClick={() => {
              setProductSurface('relay');
              setActiveView('logs');
            }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:opacity-80"
            style={activeView === 'logs' ? s.activePill : s.mutedText}
            title={logsButtonTitle}
          >
            <FileJson size={9} />
            <span>Logs</span>
            {logsAttentionLevel ? (
              <span
                className={`block w-1.5 h-1.5 rounded-full ${logsAttentionLevel === 'error' ? 'bg-rose-500' : 'bg-amber-500'}`}
              />
            ) : null}
          </button>
          <span className="w-px h-3" style={{ backgroundColor: C.border }}></span>
          <span style={s.inkText}>{footerTimeLabel}</span>
        </div>
      </div>
    </div>
  );
}
