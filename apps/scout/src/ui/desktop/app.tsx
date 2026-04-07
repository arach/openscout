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
  settingsPath,
  type SettingsSectionId,
} from "@/settings/settings-paths";
import { C } from "@/lib/theme";
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
type PendingRelayMessage = {
  clientMessageId: string;
  message: RelayMessage;
};

type OnboardingWizardStepId = 'welcome' | 'source-roots' | 'harness' | 'confirm' | 'setup' | 'doctor' | 'runtimes';
type WorkspaceExplorerFilterTab = 'all' | 'bound' | 'discovered';
type WorkspaceExplorerViewMode = 'grid' | 'list';
type InboxItemTone = 'critical' | 'warning' | 'info';
type InboxItemKind = 'approval' | 'finding' | 'task';
type InboxItem = {
  id: string;
  kind: InboxItemKind;
  tone: InboxItemTone;
  title: string;
  summary: string;
  detail: string | null;
  meta: string;
  actionLabel: string;
  onAction: () => void;
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
};

type ComposerRelayReference = {
  messageId: string;
  authorName: string;
  preview: string;
};

const PRODUCT_SURFACES = ['relay', 'pairing'] as const;
type ProductSurface = (typeof PRODUCT_SURFACES)[number];
type AppView = 'overview' | 'inbox' | 'activity' | 'machines' | 'plans' | 'sessions' | 'search' | 'messages' | 'relay' | 'inter-agent' | 'agents' | 'logs' | 'settings' | 'help';
type MessagesDetailTab = 'overview' | 'live' | 'history';
type NavViewItem = { id: AppView; icon: React.ReactNode; title: string; badgeCount?: number };
type SettingsSectionMeta = { id: SettingsSectionId; label: string; description: string; icon: React.ReactNode };
type CreateAgentDraft = {
  projectPath: string;
  agentName: string;
  harness: "claude" | "codex";
};

const APP_VIEW_IDS: readonly AppView[] = [
  'overview',
  'inbox',
  'activity',
  'machines',
  'plans',
  'sessions',
  'search',
  'messages',
  'relay',
  'inter-agent',
  'agents',
  'logs',
  'settings',
  'help',
];

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

function normalizeCreateAgentHarness(value: string | null | undefined): CreateAgentDraft["harness"] {
  return value === 'codex' ? 'codex' : 'claude';
}

function buildDefaultCreateAgentDraft(
  projects: SetupProjectSummary[],
  settings: AppSettingsState | null | undefined,
): CreateAgentDraft {
  const preferredProject = projects.find((project) => project.root === settings?.onboardingContextRoot)
    ?? projects[0]
    ?? null;

  return {
    projectPath: preferredProject?.root ?? settings?.onboardingContextRoot ?? '',
    agentName: '',
    harness: normalizeCreateAgentHarness(preferredProject?.defaultHarness ?? settings?.defaultHarness),
  };
}

function pairingTrustedPeersMeaningfullyEqual(left: PairingState['trustedPeers'], right: PairingState['trustedPeers']) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((peer, index) => {
    const other = right[index];
    return peer.publicKey === other?.publicKey
      && peer.fingerprint === other?.fingerprint
      && peer.name === other?.name
      && peer.pairedAt === other?.pairedAt
      && peer.pairedAtLabel === other?.pairedAtLabel
      && peer.lastSeen === other?.lastSeen
      && peer.lastSeenLabel === other?.lastSeenLabel;
  });
}

function pairingApprovalsMeaningfullyEqual(left: PairingState['pendingApprovals'], right: PairingState['pendingApprovals']) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((approval, index) => {
    const other = right[index];
    return approval.sessionId === other?.sessionId
      && approval.turnId === other?.turnId
      && approval.blockId === other?.blockId
      && approval.version === other?.version
      && approval.risk === other?.risk
      && approval.title === other?.title
      && approval.description === other?.description
      && approval.detail === other?.detail
      && approval.actionKind === other?.actionKind
      && approval.actionStatus === other?.actionStatus;
  });
}

function pairingStatesMeaningfullyEqual(left: PairingState | null, right: PairingState | null) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }

  return left.status === right.status
    && left.statusLabel === right.statusLabel
    && left.statusDetail === right.statusDetail
    && left.connectedPeerFingerprint === right.connectedPeerFingerprint
    && left.isRunning === right.isRunning
    && left.commandLabel === right.commandLabel
    && left.configPath === right.configPath
    && left.identityPath === right.identityPath
    && left.trustedPeersPath === right.trustedPeersPath
    && left.logPath === right.logPath
    && left.relay === right.relay
    && left.configuredRelay === right.configuredRelay
    && left.secure === right.secure
    && left.workspaceRoot === right.workspaceRoot
    && left.sessionCount === right.sessionCount
    && left.identityFingerprint === right.identityFingerprint
    && left.trustedPeerCount === right.trustedPeerCount
    && pairingTrustedPeersMeaningfullyEqual(left.trustedPeers, right.trustedPeers)
    && pairingApprovalsMeaningfullyEqual(left.pendingApprovals, right.pendingApprovals)
    && left.logTail === right.logTail
    && left.logUpdatedAtLabel === right.logUpdatedAtLabel
    && left.logMissing === right.logMissing
    && left.logTruncated === right.logTruncated
    && left.pairing?.relay === right.pairing?.relay
    && left.pairing?.room === right.pairing?.room
    && left.pairing?.publicKey === right.pairing?.publicKey
    && left.pairing?.expiresAt === right.pairing?.expiresAt
    && left.pairing?.qrValue === right.pairing?.qrValue
    && left.pairing?.qrArt === right.pairing?.qrArt;
}

function isProductSurface(value: string | null): value is ProductSurface {
  return value !== null && (PRODUCT_SURFACES as readonly string[]).includes(value);
}

function isAppView(value: string | null): value is AppView {
  return value !== null && (APP_VIEW_IDS as readonly string[]).includes(value);
}

function parseRelayViewPath(pathname: string): AppView | null {
  if (pathname === '/') {
    return 'overview';
  }

  const segment = pathname.slice(1).split('/')[0] ?? '';
  if (!segment || segment === 'pairing' || segment === 'settings') {
    return null;
  }

  return isAppView(segment) ? segment : null;
}

function buildDesktopPath(surface: ProductSurface, view: AppView, settingsSection: SettingsSectionId): string {
  if (surface === 'pairing') {
    return '/pairing';
  }

  if (view === 'settings') {
    return settingsPath(settingsSection);
  }

  return view === 'overview' ? '/' : `/${view}`;
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
      setAgentSessionLoading((current) => current || !agentSession);
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
  }, [activeView, agentSessionRefreshTick, agentSession, scoutDesktop, selectedInterAgentId, selectedMessagesThreadId, selectedRelayId, selectedRelayKind]);

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
          if (!scoutDesktop?.revealPath) {
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
  }, []);
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
    if (!scoutDesktop?.controlBroker) {
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
  }, []);

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
    if (!scoutDesktop?.runOnboardingCommand) {
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
  }, [appSettings, appSettingsDraft, completeOnboardingIntoRelay, loadShellState, moveOnboardingWizard]);

  const handleRetireProject = React.useCallback(async (projectRoot: string, projectTitle: string) => {
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
  }, [applyNextAppSettings, loadShellState, scoutDesktop, selectedAgentableProject?.root]);

  const handleRestoreProject = React.useCallback(async (project: HiddenProjectSummary) => {
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
  }, [applyNextAppSettings, loadShellState, scoutDesktop]);

  const handleQuitApp = React.useCallback(() => {
    void (async () => {
      try {
        if (scoutDesktop?.quitApp) {
          await scoutDesktop.quitApp();
        }
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, []);

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

        if (scoutDesktop?.controlBroker) {
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
  }, [brokerInspector?.installed, commitPairingState, loadFeedbackBundle, loadShellState, pairingState?.isRunning, scoutDesktop]);

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
        if (!scoutDesktop?.pickDirectory) {
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
  }, [handleSetSourceRootAt]);

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
        if (!scoutDesktop?.pickDirectory) {
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
  }, [handleSetOnboardingContextRoot]);

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
        if (!scoutDesktop?.pickDirectory) {
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
  }, [scoutDesktop]);

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
    if (!targetAgentId || !scoutDesktop?.openAgentSession) {
      return;
    }

    try {
      await scoutDesktop.openAgentSession(targetAgentId);
      setAgentSessionFeedback(agentSession?.mode === 'tmux' ? 'Opening tmux session in Terminal.' : 'Opening session logs.');
    } catch (error) {
      setAgentSessionFeedback(asErrorMessage(error));
    }
  }, [activeView, agentSession?.mode, scoutDesktop, selectedInterAgentId, selectedMessagesDetailAgentId]);

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

        {/* --- OVERVIEW --- */}
        {activeView === 'overview' ? (
          <OverviewView
            C={C}
            s={s}
            features={desktopFeatures}
            stats={stats}
            runtime={runtime}
            machinesOnlineCount={machinesState?.onlineCount ?? 0}
            reachableAgents={reachableRelayAgents}
            activityMessages={activityRecentMessages}
            activityTasks={activityTasks}
            overviewSessions={overviewSessions}
            overviewProjects={overviewProjects}
            runningTaskCount={plansState?.runningTaskCount ?? 0}
            shellError={shellError}
            agentLookup={interAgentAgentLookup}
            onNavigate={setActiveView}
            onCreateAgent={handleOpenCreateAgentDialog}
            onRefresh={() => void handleRefreshShell()}
            onOpenAgent={openAgentProfile}
            onOpenSession={openSessionDetail}
            onOpenProject={openProjectSessions}
            onSelectRelay={openMessagesRelayDestination}
            formatDate={formatDate}
            colorForIdentity={colorForIdentity}
            cleanDisplayTitle={cleanDisplayTitle}
            messagePreviewSnippet={messagePreviewSnippet}
          />

        ) : activeView === 'inbox' ? (
          <>
            {!isCollapsed && (
              <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
                <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={handleMouseDown} />
                <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Inbox</div>
                  <div className="text-[13px] font-semibold tracking-tight mt-1" style={s.inkText}>Subscribed updates</div>
                  <div className="text-[11px] leading-[1.5] mt-1" style={s.mutedText}>
                    Only updates worth notifying about belong here.
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
                  <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                    <div className="text-[9px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Summary</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Needs You', value: `${inboxAlertCount}` },
                        { label: 'Approvals', value: `${pendingApprovals.length}` },
                        { label: 'Failures', value: `${inboxFailedTaskCount}` },
                        { label: 'Policy', value: 'Opt-in' },
                      ].map((item) => (
                        <div key={item.label} className="rounded-lg border px-3 py-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                          <div className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>{item.label}</div>
                          <div className="text-[18px] font-semibold mt-1" style={s.inkText}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                    <div className="text-[9px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>V1 Scope</div>
                    <div className="space-y-2 text-[11px] leading-[1.5]" style={s.mutedText}>
                      <div>Pairing approvals surface here first.</div>
                      <div>Failed asks count as attention.</div>
                      <div>Progress and troubleshooting stay elsewhere.</div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col min-w-0" style={s.surface}>
              <div className="border-b shrink-0 px-6 py-5" style={{ borderBottomColor: C.border }}>
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>Inbox</div>
                    <h1 className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
                      What You Asked To Know About
                    </h1>
                    <p className="text-[13px] mt-2 max-w-3xl leading-[1.65]" style={s.mutedText}>
                      A first-pass desktop notification inbox for Scout. No delivery yet, just the small set of subscribed updates that are worth surfacing inside Electron.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleRefreshShell()}
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('plans')}
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                    >
                      <FileText size={14} />
                      Open Plans
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 mt-5">
                  {[
                    { label: 'Needs You', value: `${inboxAlertCount}`, detail: `${pendingApprovals.length} approvals · ${inboxFailedTaskCount} failed asks` },
                    { label: 'Approvals', value: `${pendingApprovals.length}`, detail: 'Inline pairing actions' },
                    { label: 'Failures', value: `${inboxFailedTaskCount}`, detail: 'Failed asks from plans' },
                    { label: 'Policy', value: 'Opt-in', detail: 'Progress and watchlists stay elsewhere' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border px-4 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>{item.label}</div>
                      <div className="text-[24px] font-semibold mt-2" style={s.inkText}>{item.value}</div>
                      <div className="text-[11px] mt-1" style={s.mutedText}>{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
                  <section className="border rounded-xl overflow-hidden min-w-0" style={{ ...s.surface, borderColor: C.border }}>
                    <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                      <div>
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Needs You</div>
                        <div className="text-[11px] mt-1" style={s.mutedText}>Approvals and failed asks that are worth interrupting for.</div>
                      </div>
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={inboxAlertCount > 0 ? s.activePill : s.tagBadge}>
                        {inboxAlertCount} items
                      </span>
                    </div>
                    <div className="divide-y" style={{ borderColor: C.border }}>
                      {inboxAwaitingYouItems.length > 0 ? inboxAwaitingYouItems.map((item) => (
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
                                        : s.activePill
                                  }
                                >
                                  {item.kind}
                                </span>
                                <span className="text-[9px] font-mono" style={s.mutedText}>{item.meta}</span>
                              </div>
                              <div className="text-[13px] font-medium mt-2 leading-[1.5]" style={s.inkText}>
                                {item.title}
                              </div>
                              <div className="text-[11px] mt-1 leading-[1.6]" style={s.mutedText}>
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
                                  style={s.mutedText}
                                >
                                  {item.secondaryActionLabel}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="px-4 py-10 text-[12px] text-center" style={s.mutedText}>
                          Nothing urgent right now.
                        </div>
                      )}
                    </div>
                  </section>

                  <div className="space-y-4 min-w-0">
                    <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Notes</div>
                        <div className="text-[11px] mt-1" style={s.mutedText}>This is UI-only for now, backed by existing desktop state instead of durable broker attention events.</div>
                      </div>
                      <div className="px-4 py-4 text-[11px] leading-[1.7]" style={s.mutedText}>
                        Inbox is currently limited to approvals and failed asks. Agent progress, stale/problem states, and cleanup flows stay in other parts of Scout.
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </>

        /* --- ACTIVITY --- */
        ) : activeView === 'activity' ? (
          <>
            {!isCollapsed && (
              <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
                <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={handleMouseDown} />
                <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Activity Monitor</div>
                  <div className="text-[13px] font-semibold tracking-tight mt-1" style={s.inkText}>System-wide watch</div>
                  <div className="text-[11px] leading-[1.5] mt-1" style={s.mutedText}>
                    Asks, blockers, runtime signals, and recent coordination across Scout.
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
                  <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                    <div className="text-[9px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Right Now</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Running', value: `${plansState?.runningTaskCount ?? 0}` },
                        { label: 'Watchlist', value: `${plansState?.findingCount ?? 0}` },
                        { label: 'Agents', value: `${runtime?.agentCount ?? 0}` },
                        { label: 'Nodes', value: `${machinesState?.onlineCount ?? 0}` },
                      ].map((item) => (
                        <div key={item.label} className="rounded-lg border px-3 py-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                          <div className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>{item.label}</div>
                          <div className="text-[18px] font-semibold mt-1" style={s.inkText}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                    <div className="text-[9px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>Lead Task</div>
                    {activityLeadTask ? (
                      <>
                        <div className="text-[12px] font-medium leading-[1.5]" style={s.inkText}>{activityLeadTask.title}</div>
                        <div className="text-[10px] mt-1 leading-[1.5]" style={s.mutedText}>
                          {activityLeadTask.targetAgentName} · {activityLeadTask.statusLabel} · {activityLeadTask.ageLabel ?? activityLeadTask.updatedAtLabel ?? 'now'}
                        </div>
                        {activityLeadTask.statusDetail ? (
                          <div className="text-[11px] mt-2 leading-[1.55]" style={s.mutedText}>
                            {activityLeadTask.statusDetail}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openAgentProfile(activityLeadTask.targetAgentId)}
                          className="mt-3 text-[10px] font-medium hover:opacity-80"
                          style={{ color: C.accent }}
                        >
                          Open {activityLeadTask.targetAgentName}
                        </button>
                      </>
                    ) : (
                      <div className="text-[11px] leading-[1.5]" style={s.mutedText}>
                        No active asks are visible yet.
                      </div>
                    )}
                  </section>

                  <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                    <div className="text-[9px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>View Model</div>
                    <div className="space-y-2 text-[11px] leading-[1.5]" style={s.mutedText}>
                      <div>Task-first rows, not micro chat.</div>
                      <div>Watchlist surfaces blockers and stale work.</div>
                      <div>Runtime stays visible without becoming the main story.</div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col min-w-0" style={s.surface}>
              <div className="border-b shrink-0 px-6 py-5" style={{ borderBottomColor: C.border }}>
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>Activity Monitor</div>
                    <h1 className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
                      Everything Scout Is Coordinating
                    </h1>
                    <p className="text-[13px] mt-2 max-w-3xl leading-[1.65]" style={s.mutedText}>
                      A system-wide operational picture of asks, handoffs, runtime signals, human interventions, and recent coordination.
                      This is the control-room view, not just the mesh view.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleRefreshShell()}
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('plans')}
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                    >
                      <FileText size={14} />
                      Open Plans
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('messages')}
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
                    { label: 'Work In Flight', value: `${plansState?.runningTaskCount ?? 0}`, detail: `${plansState?.taskCount ?? 0} total asks` },
                    { label: 'Watchlist', value: `${plansState?.findingCount ?? 0}`, detail: `${plansState?.errorCount ?? 0} errors · ${plansState?.warningCount ?? 0} warnings` },
                    { label: 'Live Runtime', value: `${activityEndpoints.filter((entry) => entry.endpoint.state === 'running').length}`, detail: `${runtime?.tmuxSessionCount ?? 0} sessions visible` },
                    { label: 'Recent Coordination', value: `${activityRecentMessages.length}`, detail: `${runtime?.messageCount ?? 0} broker messages captured` },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border px-4 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>{item.label}</div>
                      <div className="text-[24px] font-semibold mt-2" style={s.inkText}>{item.value}</div>
                      <div className="text-[11px] mt-1" style={s.mutedText}>{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4">
                  <div className="space-y-4 min-w-0">
                    <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                        <div>
                          <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Work Feed</div>
                          <div className="text-[11px] mt-1" style={s.mutedText}>Task-level asks and routed work, newest first.</div>
                        </div>
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.activePill}>
                          {activityTasks.length} rows
                        </span>
                      </div>
                      <div className="divide-y" style={{ borderColor: C.border }}>
                        {activityTasks.length > 0 ? activityTasks.map((task) => (
                          <div key={task.id} className="px-4 py-4" style={{ backgroundColor: C.surface }}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded"
                                    style={
                                      task.status === 'running'
                                        ? s.activePill
                                        : task.status === 'failed'
                                          ? { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' }
                                          : task.status === 'completed'
                                            ? { backgroundColor: 'rgba(34, 197, 94, 0.12)', color: '#166534' }
                                            : s.tagBadge
                                    }
                                  >
                                    {task.statusLabel}
                                  </span>
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>
                                    {task.targetAgentName}
                                  </span>
                                  {task.project ? (
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>
                                      {task.project}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-[13px] font-medium mt-2 leading-[1.5]" style={s.inkText}>
                                  {task.title}
                                </div>
                                {task.statusDetail ? (
                                  <div className="text-[11px] mt-1 leading-[1.6]" style={s.mutedText}>
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
                                <span className="text-[10px] font-mono" style={s.mutedText}>
                                  {task.ageLabel ?? task.updatedAtLabel ?? task.createdAtLabel}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openAgentProfile(task.targetAgentId)}
                                  className="text-[10px] font-medium hover:opacity-80"
                                  style={{ color: C.accent }}
                                >
                                  Open
                                </button>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="px-4 py-10 text-[12px] text-center" style={s.mutedText}>
                            No task-level activity has been indexed yet.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                        <div>
                          <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Recent Coordination</div>
                          <div className="text-[11px] mt-1" style={s.mutedText}>The latest human, bridge, and agent interactions crossing the system.</div>
                        </div>
                      </div>
                      <div className="divide-y" style={{ borderColor: C.border }}>
                        {activityRecentMessages.length > 0 ? activityRecentMessages.map((message) => {
                          const agent = interAgentAgentLookup.get(message.authorId) ?? null;
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
                                  <span className="text-[12px] font-medium" style={s.inkText}>{message.authorName}</span>
                                  {message.messageClass ? (
                                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={message.messageClass === 'status' ? s.activePill : s.tagBadge}>
                                      {message.messageClass}
                                    </span>
                                  ) : null}
                                  {counterparts ? (
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>
                                      to {counterparts}
                                    </span>
                                  ) : null}
                                  <span className="text-[9px] font-mono" style={s.mutedText}>{message.timestampLabel}</span>
                                </div>
                                <div className="text-[11px] mt-1 leading-[1.6]" style={s.mutedText}>
                                  {messagePreviewSnippet(message.body, 220)}
                                </div>
                              </div>
                              {agent ? (
                                <button
                                  type="button"
                                  onClick={() => openAgentProfile(agent.id)}
                                  className="text-[10px] font-medium shrink-0 hover:opacity-80"
                                  style={{ color: C.accent }}
                                >
                                  Open
                                </button>
                              ) : null}
                            </div>
                          );
                        }) : (
                          <div className="px-4 py-10 text-[12px] text-center" style={s.mutedText}>
                            No coordination events yet.
                          </div>
                        )}
                      </div>
                    </section>
                  </div>

                  <div className="space-y-4 min-w-0">
                    <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                        <div>
                          <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Watchlist</div>
                          <div className="text-[11px] mt-1" style={s.mutedText}>Blocked, stale, or otherwise suspicious coordination.</div>
                        </div>
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={activityFindings.length > 0 ? { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' } : s.tagBadge}>
                          {activityFindings.length}
                        </span>
                      </div>
                      <div className="divide-y" style={{ borderColor: C.border }}>
                        {activityFindings.length > 0 ? activityFindings.map((finding) => (
                          <div key={finding.id} className="px-4 py-3" style={{ backgroundColor: C.surface }}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[12px] font-medium" style={s.inkText}>{finding.title}</div>
                              <span
                                className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0"
                                style={finding.severity === 'error'
                                  ? { backgroundColor: 'rgba(248, 113, 113, 0.14)', color: '#b91c1c' }
                                  : { backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#b45309' }}
                              >
                                {finding.severity}
                              </span>
                            </div>
                            <div className="text-[11px] mt-1 leading-[1.55]" style={s.mutedText}>{finding.summary}</div>
                            {finding.detail ? (
                              <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>{finding.detail}</div>
                            ) : null}
                          </div>
                        )) : (
                          <div className="px-4 py-10 text-[12px] text-center" style={s.mutedText}>
                            No blockers are visible right now.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Runtime Signals</div>
                        <div className="text-[11px] mt-1" style={s.mutedText}>Active and waiting endpoints across the current mesh.</div>
                      </div>
                      <div className="divide-y" style={{ borderColor: C.border }}>
                        {activityEndpoints.length > 0 ? activityEndpoints.map((entry) => (
                          <div key={entry.endpoint.id} className="px-4 py-3 flex items-start justify-between gap-3" style={{ backgroundColor: C.surface }}>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[12px] font-medium" style={s.inkText}>{entry.endpoint.agentName}</span>
                                <span
                                  className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded"
                                  style={
                                    entry.endpoint.state === 'running'
                                      ? s.activePill
                                      : entry.endpoint.state === 'waiting'
                                        ? { backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#b45309' }
                                        : s.tagBadge
                                  }
                                >
                                  {entry.endpoint.stateLabel}
                                </span>
                              </div>
                              <div className="text-[10px] mt-1" style={s.mutedText}>
                                {entry.machineTitle} · {entry.endpoint.transport ?? 'runtime'} · {entry.endpoint.project ?? 'no project'}
                              </div>
                              {entry.endpoint.activeTask ? (
                                <div className="text-[11px] mt-2 leading-[1.55]" style={s.mutedText}>
                                  {entry.endpoint.activeTask}
                                </div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => openAgentProfile(entry.endpoint.agentId)}
                              className="text-[10px] font-medium shrink-0 hover:opacity-80"
                              style={{ color: C.accent }}
                            >
                              Open
                            </button>
                          </div>
                        )) : (
                          <div className="px-4 py-10 text-[12px] text-center" style={s.mutedText}>
                            No runtime endpoints are visible yet.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Recent Sessions</div>
                        <div className="text-[11px] mt-1" style={s.mutedText}>Fresh session history from local workspaces and harnesses.</div>
                      </div>
                      <div className="divide-y" style={{ borderColor: C.border }}>
                        {overviewSessions.length > 0 ? overviewSessions.map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => openSessionDetail(session)}
                            className="w-full text-left px-4 py-3 transition-opacity hover:opacity-90"
                            style={{ backgroundColor: C.surface }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[12px] font-medium truncate" style={s.inkText}>{session.title}</div>
                                <div className="text-[10px] mt-1" style={s.mutedText}>{session.project} · {session.agent}</div>
                              </div>
                              <span className="text-[10px] font-mono shrink-0" style={s.mutedText}>{formatDate(session.lastModified)}</span>
                            </div>
                          </button>
                        )) : (
                          <div className="px-4 py-10 text-[12px] text-center" style={s.mutedText}>
                            No session history is available yet.
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <div className="h-7 border-t flex items-center px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
                <span className="text-[9px] font-mono" style={s.mutedText}>
                  System-wide activity view: tasks first, watchlist second, runtime and coordination side by side
                </span>
              </div>
            </div>
          </>

        /* --- MACHINES --- */
        ) : activeView === 'machines' ? (
          <MachinesView
            machinesState={machinesState ?? {
              title: 'Machines',
              subtitle: 'Broker unavailable',
              totalMachines: 0,
              onlineCount: 0,
              degradedCount: 0,
              offlineCount: 0,
              lastUpdatedLabel: null,
              machines: [],
            }}
            C={C}
            s={s}
            isCollapsed={isCollapsed}
            sidebarWidth={sidebarWidth}
            onResizeStart={handleMouseDown}
            onOpenRelayAgent={openRelayAgentThread}
            onRefresh={() => void handleRefreshShell()}
            identityColor={colorForIdentity}
          />

        /* --- PLANS --- */
        ) : activeView === 'plans' ? (
          <PlansView
            plansState={plansState ?? {
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
            }}
            C={C}
            s={s}
            isCollapsed={isCollapsed}
            sidebarWidth={sidebarWidth}
            onResizeStart={handleMouseDown}
            onOpenRelayAgent={openRelayAgentThread}
            onRefresh={() => void handleRefreshShell()}
            identityColor={colorForIdentity}
          />

        /* --- SEARCH --- */
        ) : activeView === 'search' ? (
          <>
            {!isCollapsed && (
              <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
                <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={handleMouseDown} />
                <div className="px-3 py-2.5 flex items-center justify-between border-b" style={{ borderBottomColor: C.border }}>
                  <div>
                    <h1 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>Search</h1>
                    <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>Full-text search</div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                  {/* Scope */}
                  <div className="mb-3 px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Scope</div>
                    <div className="flex flex-col gap-px">
                      <button className="flex items-center gap-2 px-1.5 py-1 shadow-sm border rounded text-[12px]" style={s.activeItem}>
                        <LayoutGrid size={12} style={{ color: C.accent }} />
                        <span className="font-medium flex-1 truncate text-left">All Sessions</span>
                      </button>
                      {[['Content Only', <FileText size={12} />], ['Tags Only', <Tag size={12} />]].map(([label, icon]) => (
                        <button key={label as string} className="flex items-center gap-2 px-1.5 py-1 rounded text-[12px] hover:opacity-80 transition-opacity" style={s.mutedText}>
                          {icon as React.ReactNode}
                          <span className="font-medium flex-1 truncate text-left">{label as string}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Time Range */}
                  <div className="mb-3 px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Time Range</div>
                    <div className="flex flex-col gap-px">
                      <button className="flex items-center gap-2 px-1.5 py-1 shadow-sm border rounded text-[12px]" style={s.activeItem}>
                        <Calendar size={12} style={{ color: C.accent }} />
                        <span className="font-medium flex-1 truncate text-left">All Time</span>
                      </button>
                      {['Last 7 Days', 'Last 30 Days'].map(label => (
                        <button key={label} className="flex items-center gap-2 px-1.5 py-1 rounded text-[12px] hover:opacity-80 transition-opacity" style={s.mutedText}>
                          <Clock size={12} />
                          <span className="font-medium flex-1 truncate text-left">{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Agents */}
                  <div className="mb-3 px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Agents</div>
                    <div className="flex flex-col gap-px">
                      {availableAgentNames.map(agent => (
                        <label key={agent} className="flex items-center gap-2 px-1.5 py-1 rounded text-[12px] hover:opacity-80 transition-opacity cursor-pointer" style={s.mutedText}>
                          <input type="checkbox" defaultChecked className="w-3 h-3 rounded" />
                          <div
                            className="w-3 h-3 rounded text-white flex items-center justify-center text-[7px] font-bold"
                            style={{ backgroundColor: colorForIdentity(agent) }}
                          >
                            {agent.charAt(0)}
                          </div>
                          <span className="font-medium flex-1 truncate text-left">{agent}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Quick Filters */}
                  <div className="px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Quick Filters</div>
                    <div className="flex flex-wrap gap-1 px-1.5">
                      {['code-review', 'debugging', 'docs', 'architecture', 'performance', 'testing'].map(tag => (
                        <button key={tag} className="text-[9px] font-mono border px-1.5 py-0.5 rounded hover:opacity-70 transition-opacity" style={s.tagBadge}>
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Main Search Area */}
            <div className="flex-1 flex flex-col relative min-w-0" style={s.surface}>
              <div className="border-b shrink-0 p-4" style={{ ...s.surface, borderBottomColor: C.border }}>
                <div className="flex items-center gap-3 border rounded-lg px-3 py-2 transition-all focus-within:ring-1" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                  <Search size={16} className="shrink-0" style={s.mutedText} />
                  <input
                    type="text"
                    placeholder="Search across all sessions, messages, and metadata..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none text-[13px]"
                    style={{ color: C.ink }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="p-1 hover:opacity-70" style={s.mutedText}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2 text-[10px] font-mono" style={s.mutedText}>
                    <span>Press</span>
                    <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-medium" style={s.kbd}>Enter</kbd>
                    <span>to search</span>
                  </div>
                  <div className="text-[10px] font-mono" style={s.mutedText}>
                    {searchQuery ? `${filteredSessions.length} results` : `${stats.totalSessions} sessions indexed`}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {!searchQuery ? (
                  <div className="p-6">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-3" style={s.mutedText}>Recent Searches</div>
                    <div className="flex flex-col gap-2">
                      {['authentication refactor', 'database migration', 'API performance'].map((term, i) => (
                        <button key={i} onClick={() => setSearchQuery(term)} className="flex items-center gap-2 text-left text-[12px] hover:opacity-70 transition-opacity" style={s.mutedText}>
                          <Clock size={12} /><span>{term}</span>
                        </button>
                      ))}
                    </div>
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-3 mt-8" style={s.mutedText}>Popular Tags</div>
                    <div className="flex flex-wrap gap-2">
                      {['code-review', 'auth', 'security', 'database', 'migration', 'api', 'performance', 'testing', 'docs'].map(tag => (
                        <button key={tag} onClick={() => setSearchQuery(tag)} className="text-[11px] font-mono border px-2 py-1 rounded hover:opacity-70 transition-opacity" style={s.tagBadge}>
                          #{tag}
                        </button>
                      ))}
                    </div>
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-3 mt-8" style={s.mutedText}>Search Tips</div>
                    <div className="text-[12px] space-y-2" style={s.mutedText}>
                      {[
                        ['project:openscout-core', 'Search within a project'],
                        ['agent:claude', 'Filter by agent'],
                        ['tag:security', 'Search by tag'],
                        ['"exact phrase"', 'Match exact phrase'],
                      ].map(([code, desc]) => (
                        <p key={code}><code className="border rounded px-1 font-mono text-[10px]" style={s.tagBadge}>{code}</code>{' -- '}{desc}</p>
                      ))}
                    </div>
                  </div>
                ) : filteredSessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <Search size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No results found</h3>
                    <p className="text-[13px] max-w-sm" style={s.mutedText}>Try different keywords or adjust your filters</p>
                  </div>
                ) : (
                  <div style={{ borderColor: C.border }} className="divide-y">
                    {filteredSessions.map(session => (
                      <div
                        key={session.id}
                        className="px-4 py-4 cursor-pointer transition-opacity hover:opacity-90"
                        style={{ borderBottomColor: C.border }}
                        onClick={() => { setSelectedSession(session); setActiveView('sessions'); }}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-5 h-5 rounded text-white flex items-center justify-center text-[9px] font-bold"
                              style={{ backgroundColor: colorForIdentity(session.agent) }}
                            >
                              {session.agent.charAt(0)}
                            </div>
                            <span className="text-[13px] font-medium" style={s.inkText}>{session.title}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <span className="text-[9px] font-mono border px-1.5 py-0.5 rounded" style={s.tagBadge}>{session.project}</span>
                            <span className="text-[10px] font-mono" style={s.mutedText}>{formatDate(session.lastModified)}</span>
                          </div>
                        </div>
                        <div className="text-[12px] mb-2 pl-7 leading-relaxed" style={s.mutedText}>
                          {session.preview.split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) =>
                            part.toLowerCase() === searchQuery.toLowerCase() ? (
                              <mark key={i} className="px-0.5 rounded" style={{ backgroundColor: C.markBg, color: C.markFg }}>{part}</mark>
                            ) : (
                              <span key={i}>{part}</span>
                            )
                          )}
                        </div>
                        <div className="flex items-center gap-3 pl-7">
                          <span className="text-[10px]" style={s.mutedText}>{session.messageCount} messages</span>
                          {session.tokens && <span className="text-[10px]" style={s.mutedText}>{(session.tokens / 1000).toFixed(1)}k tokens</span>}
                          {session.model && <span className="text-[9px] font-mono text-indigo-400 bg-indigo-950/30 px-1.5 py-0.5 rounded">{session.model}</span>}
                        </div>
                        {session.tags && session.tags.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-2 pl-7">
                            {session.tags.map(tag => (
                              <span key={tag} className="text-[9px] font-mono border px-1.5 py-0.5 rounded" style={
                                tag.toLowerCase().includes(searchQuery.toLowerCase())
                                  ? { backgroundColor: C.markBg, borderColor: C.border, color: C.markFg }
                                  : s.tagBadge
                              }>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="h-7 border-t flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
                <span className="text-[9px] font-mono" style={s.mutedText}>Indexed: {stats.totalSessions} sessions / {stats.totalMessages} messages</span>
                <span className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>Index Ready</span>
              </div>
            </div>
          </>

        /* --- HELP --- */
        ) : activeView === 'help' ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl px-8 py-6">
              <div className="flex items-start justify-between gap-6 mb-5">
                <div>
                  <div className="text-[10px] font-mono tracking-widest uppercase mb-1.5" style={{ color: C.accent }}>Help</div>
                  <h1 className="text-[22px] font-semibold tracking-tight" style={s.inkText}>Knowledge Base</h1>
                  <p className="text-[12px] mt-1.5 max-w-2xl leading-[1.6]" style={s.mutedText}>
                    Core Scout terms and the main CLI commands you can use here or in Terminal.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                    style={{ color: C.ink }}
                    onClick={() => {
                      setActiveView('settings');
                      setSettingsSection('profile');
                    }}
                  >
                    <Settings size={12} />
                    General
                  </button>
                </div>
              </div>

              <div className="space-y-5">
                <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Vocabulary</div>
                      <div className="text-[14px] font-medium mt-1" style={s.inkText}>What Scout means by each term</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      [
                        'Project Path',
                        'A folder Scout scans recursively to discover repos, project roots, and harness evidence.',
                      ],
                      [
                        'Context Root',
                        'The directory where Scout saves `.openscout/project.json` for the current local context.',
                      ],
                      [
                        'Harness',
                        'The assistant family a project prefers by default, such as `claude` or `codex`.',
                      ],
                      [
                        'Runtime',
                        'The installed local program or persistent session Scout uses to launch a chosen harness.',
                      ],
                    ].map(([label, value]) => (
                      <article
                        key={label}
                        className="rounded-xl border px-4 py-3.5"
                        style={{ borderColor: C.border, backgroundColor: C.bg }}
                      >
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>{label}</div>
                        <div className="text-[12px] mt-2 leading-[1.6]" style={s.inkText}>{value}</div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>CLI Basics</div>
                      <div className="text-[14px] font-medium mt-1" style={s.inkText}>The same commands the app runs for you</div>
                      <div className="text-[12px] mt-1 leading-[1.6] max-w-2xl" style={s.mutedText}>
                        Run them from here for guidance, or copy them into your shell when you want the direct Scout workflow.
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {([
                      {
                        command: 'setup' as const,
                        title: 'Setup',
                        detail: 'Writes a local `.openscout/project.json` for the chosen context.',
                      },
                      {
                        command: 'doctor' as const,
                        title: 'Doctor',
                        detail: 'Checks broker health and whether Scout can discover workspaces from your scan roots.',
                      },
                      {
                        command: 'runtimes' as const,
                        title: 'Runtimes',
                        detail: 'Shows whether Claude and Codex are installed, authenticated, and ready.',
                      },
                    ]).map((item) => (
                      <article
                        key={item.command}
                        className="rounded-xl border px-4 py-3.5"
                        style={{ borderColor: C.border, backgroundColor: C.bg }}
                      >
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>{item.title}</div>
                        <div className="text-[12px] mt-2 leading-[1.6]" style={s.inkText}>{item.detail}</div>
                        <div className="text-[10px] font-mono mt-3 break-all" style={s.mutedText}>
                          {buildOnboardingCommandLine(item.command)}
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                            style={{ color: C.ink }}
                            onClick={() => { void handleCopyOnboardingCommand(item.command); }}
                          >
                            {onboardingCopiedCommand === item.command ? <Check size={12} /> : <Copy size={12} />}
                            Copy
                          </button>
                          <button
                            type="button"
                            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
                            style={{ color: C.ink }}
                            onClick={() => { void handleRunOnboardingCommand(item.command); }}
                            disabled={Boolean(onboardingCommandPending)}
                          >
                            <Terminal size={12} />
                            Run
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>

        /* --- SETTINGS --- */
        ) : activeView === 'settings' ? (
          <div className="flex-1 flex overflow-hidden" style={s.surface}>
            <div className="w-56 border-r flex flex-col shrink-0" style={{ backgroundColor: C.bg, borderColor: C.border }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
                <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Settings</div>
              </div>
              <div className="px-2 py-2 flex flex-col gap-0.5 flex-1">
                {settingsSections.map((section) => {
                  const active = settingsSection === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setSettingsSection(section.id)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors"
                      style={active ? { backgroundColor: C.surface, borderColor: C.border, color: C.ink, boxShadow: C.shadowXs } : s.mutedText}
                    >
                      <span style={{ color: active ? C.accent : C.muted }}>{section.icon}</span>
                      <span className="text-[12px] font-medium" style={active ? s.inkText : undefined}>{section.label}</span>
                      {active ? <ChevronRight size={12} className="ml-auto" style={s.mutedText} /> : null}
                    </button>
                  );
                })}
              </div>
              <div className="px-3 py-3 border-t" style={{ borderColor: C.border }}>
                <button
                  type="button"
                  onClick={openFeedbackDialog}
                  className="flex items-center gap-2 px-3 py-2 w-full rounded-lg transition-colors hover:opacity-70"
                  style={s.mutedText}
                >
                  <MessageSquare size={13} style={{ color: C.muted }} />
                  <span className="text-[12px] font-medium">Feedback</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="max-w-6xl px-8 py-6">
                <div className="flex items-start justify-between gap-6 mb-5">
                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={{ color: C.accent }}>Settings</div>
                    <h1 className="text-[18px] font-semibold tracking-tight" style={s.inkText}>{activeSettingsMeta.label}</h1>
                    <p className="text-[11px] mt-1 max-w-2xl leading-[1.6]" style={s.mutedText}>
                      {activeSettingsMeta.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {settingsSection === 'profile' ? (
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
                    ) : null}
                  </div>
                </div>

                {settingsSection === 'profile' ? (
                  <div className="max-w-3xl">
                    <div className="space-y-5 min-w-0">
                      {visibleAppSettings?.onboarding?.needed ? (
                        <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Onboarding</div>
                              <div className="text-[13px] font-medium mt-1" style={s.inkText}>{visibleAppSettings.onboarding.title}</div>
                              <div className="text-[11px] mt-1 leading-[1.5]" style={s.mutedText}>
                                {visibleAppSettings.onboarding.detail}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                                style={{ color: C.ink }}
                                onClick={handleRestartOnboarding}
                              >
                                <RefreshCw size={12} />
                                Restart onboarding
                              </button>
                              <span
                                className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={s.tagBadge}
                              >
                                {`${activeOnboardingStepIndex + 1}/${ONBOARDING_WIZARD_STEP_ORDER.length}`}
                              </span>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                            <div className="space-y-2">
                              {ONBOARDING_WIZARD_STEP_ORDER.map((stepId, index) => {
                                const step = ONBOARDING_WIZARD_STEPS.find((entry) => entry.id === stepId);
                                if (!step) {
                                  return null;
                                }
                                const active = onboardingWizardStep === step.id;
                                const complete = index < activeOnboardingStepIndex;
                                return (
                                  <button
                                    key={step.id}
                                    type="button"
                                    className="w-full rounded-lg border px-3 py-2 text-left transition-opacity hover:opacity-90"
                                    style={{
                                      borderColor: active ? C.accent : C.border,
                                      backgroundColor: active ? C.accentBg : C.surface,
                                      color: active ? C.accent : C.ink,
                                    }}
                                    onClick={() => setOnboardingWizardStep(step.id)}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-[10px] font-mono uppercase tracking-widest">{step.title}</div>
                                        <div className="text-[10px] mt-1 leading-[1.5]" style={active ? { color: C.accent } : s.mutedText}>
                                          {step.detail}
                                        </div>
                                      </div>
                                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={complete ? s.activePill : s.tagBadge}>
                                        {complete ? 'done' : index + 1}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>

                            <div className="rounded-xl border p-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: C.accent }}>{activeOnboardingStep.title}</div>
                              <div className="text-[13px] font-medium mt-1" style={s.inkText}>{activeOnboardingStep.detail}</div>
                              <div className="text-[11px] mt-2 leading-[1.6]" style={s.mutedText}>
                                {activeOnboardingStep.helper}
                              </div>

                              {activeOnboardingStep.id === 'welcome' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="text-[12px] font-medium" style={s.inkText}>Before you start</div>
                                    <div className="text-[10px] mt-1 leading-[1.5]" style={s.mutedText}>
                                      Scout discovers workspaces from scan folders, stores local config under a context root, and needs a default harness before it can broker local runs.
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {[
                                      ['Source roots', (visibleAppSettings.workspaceRoots ?? []).join(', ') || 'None yet'],
                                      ['Context root', visibleAppSettings.onboardingContextRoot || 'Not set'],
                                      ['Default harness', visibleAppSettings.defaultHarness ?? 'Not set'],
                                      ['Operator', visibleAppSettings.operatorName || visibleAppSettings.operatorNameDefault],
                                    ].map(([label, value]) => (
                                      <div key={label}>
                                        <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                                        <div className="text-[11px] leading-[1.45]" style={s.inkText}>{value}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : activeOnboardingStep.id === 'source-roots' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="text-[12px] font-medium" style={s.inkText}>Project scan folders</div>
                                    <div className="text-[10px] mt-1 leading-[1.5]" style={s.mutedText}>
                                      Scout recursively scans these folders to find repos, manifests, and harness evidence.
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    {(visibleAppSettings.workspaceRoots ?? []).map((root, index) => (
                                      <div key={`onboarding-source-root-${index}`} className="flex items-center gap-1.5">
                                        <input
                                          value={root}
                                          onChange={(event) => handleSetSourceRootAt(index, event.target.value)}
                                          readOnly={!isAppSettingsEditing || appSettingsSaving}
                                          className="flex-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none font-mono"
                                          style={{ borderColor: C.border, color: C.ink }}
                                          placeholder={index === 0 ? '~/dev' : 'Add another scan folder'}
                                        />
                                        <button
                                          type="button"
                                          className="os-toolbar-button text-[10px] font-medium px-2 py-1.5 rounded-md"
                                          style={{ color: C.ink }}
                                          onClick={() => handleBrowseForSourceRoot(index)}
                                          disabled={!isAppSettingsEditing || appSettingsSaving}
                                        >
                                          Finder
                                        </button>
                                        <button
                                          type="button"
                                          className="os-toolbar-button text-[12px] font-medium w-7 h-7 rounded-md disabled:opacity-50"
                                          style={{ color: C.ink }}
                                          onClick={() => handleRemoveSourceRootRow(index)}
                                          disabled={!isAppSettingsEditing || appSettingsSaving || ((visibleAppSettings.workspaceRoots ?? []).length <= 1 && !root)}
                                          aria-label={`Remove source root ${index + 1}`}
                                        >
                                          -
                                        </button>
                                      </div>
                                    ))}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <button
                                      type="button"
                                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
                                      style={{ color: C.ink }}
                                      onClick={() => {
                                        handleBeginGeneralEdit();
                                        handleAddSourceRootRow();
                                      }}
                                      disabled={appSettingsSaving}
                                    >
                                      <span className="text-[12px] leading-none">+</span>
                                      Add path
                                    </button>
                                    <span className="text-[10px]" style={s.mutedText}>or</span>
                                    {SOURCE_ROOT_PATH_SUGGESTIONS.map((root) => (
                                      <button
                                        key={root}
                                        type="button"
                                        className="os-toolbar-button text-[10px] font-mono px-2 py-1 rounded-md disabled:opacity-50"
                                        style={{ color: C.ink }}
                                        onClick={() => {
                                          handleBeginGeneralEdit();
                                          handleAddSourceRootSuggestion(root);
                                        }}
                                        disabled={appSettingsSaving}
                                      >
                                        {root}
                                      </button>
                                    ))}
                                  </div>

                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Context root</div>
                                    {isAppSettingsEditing ? (
                                      <>
                                        <div className="flex items-center gap-1.5 max-w-md">
                                          <input
                                            value={visibleAppSettings.onboardingContextRoot ?? ''}
                                            onChange={(event) => handleSetOnboardingContextRoot(event.target.value)}
                                            readOnly={appSettingsSaving}
                                            className="flex-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none font-mono"
                                            style={{ borderColor: C.border, color: C.ink }}
                                            placeholder="Choose where .openscout should live"
                                          />
                                          <button
                                            type="button"
                                            className="os-toolbar-button text-[10px] font-medium px-2 py-1.5 rounded-md"
                                            style={{ color: C.ink }}
                                            onClick={handleBrowseForOnboardingContextRoot}
                                            disabled={appSettingsSaving}
                                          >
                                            Finder
                                          </button>
                                        </div>
                                        <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                          Project manifest will be saved here.
                                        </div>
                                      </>
                                    ) : (
                                      <div className="text-[11px] leading-[1.45]" style={s.inkText}>
                                        {visibleAppSettings.onboardingContextRoot || 'Not set'}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : activeOnboardingStep.id === 'harness' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="flex items-center gap-2">
                                      <Key size={14} style={{ color: C.accent }} />
                                      <div className="text-[12px] font-medium" style={s.inkText}>Harness vs runtime</div>
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      The harness is the assistant family (e.g. Claude, Codex). The runtime is the local program that launches it.
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {(['claude', 'codex'] as const).map((harness) => {
                                      const runtimeEntry = (visibleAppSettings.runtimeCatalog ?? []).find((entry) => entry.name === harness) ?? null;
                                      const selected = visibleAppSettings.defaultHarness === harness;
                                      return (
                                        <button
                                          key={harness}
                                          className="text-left rounded-lg border px-3 py-3 transition-opacity hover:opacity-90 disabled:opacity-60"
                                          style={{ borderColor: C.border, backgroundColor: selected ? C.bg : C.surface }}
                                          disabled={!isAppSettingsEditing || appSettingsSaving}
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
                                              <div className="text-[12px] font-medium capitalize" style={s.inkText}>{harness}</div>
                                              <div className="text-[10px] mt-1 leading-[1.5]" style={s.mutedText}>
                                                {harness === 'claude'
                                                  ? 'Use Claude as the default responder for new project agents.'
                                                  : 'Use Codex as the default responder for new project agents.'}
                                              </div>
                                              <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                                Runtime: {runtimeEntry?.label ?? harness} · {runtimeEntry?.readinessDetail ?? 'Not reported yet.'}
                                              </div>
                                            </div>
                                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={selected ? s.activePill : s.tagBadge}>
                                              {selected ? 'selected' : 'available'}
                                            </span>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : activeOnboardingStep.id === 'confirm' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="text-[12px] font-medium" style={s.inkText}>Confirm this context</div>
                                    <div className="text-[10px] mt-1 leading-[1.5]" style={s.mutedText}>
                                      Review your scan folders and context root before continuing.
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                      {[
                                        ['Source roots', (visibleAppSettings.workspaceRoots ?? []).join(', ') || 'None yet'],
                                        ['Default harness', visibleAppSettings.defaultHarness ?? 'Not set'],
                                        ['Relay context root', visibleAppSettings.onboardingContextRoot || 'Not set'],
                                        ['Operator', visibleAppSettings.operatorName || visibleAppSettings.operatorNameDefault],
                                      ].map(([label, value]) => (
                                        <div key={label}>
                                          <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                                          <div className="text-[11px] leading-[1.45]" style={s.inkText}>{value}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap gap-2 items-center">
                                    {!isAppSettingsEditing ? (
                                      <button
                                        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                                        style={{ color: C.ink }}
                                        onClick={handleStartAppSettingsEdit}
                                        disabled={appSettingsLoading || appSettingsSaving}
                                      >
                                        Edit Inputs
                                      </button>
                                    ) : null}
                                    <div className="text-[10px] leading-[1.5]" style={s.mutedText}>
                                      {appSettingsDirty
                                        ? 'Next confirms and saves these choices locally.'
                                        : 'Everything here is already saved locally.'}
                                    </div>
                                  </div>
                                </div>
                              ) : activeOnboardingStep.id === 'setup' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="flex items-center gap-2">
                                      <FileJson size={14} style={{ color: C.accent }} />
                                      <div className="text-[12px] font-medium" style={s.inkText}>Create the local project manifest</div>
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      Initialize the project manifest at your context root.
                                    </div>
                                    <div className="text-[11px] font-mono mt-3 break-all" style={s.inkText}>
                                      {buildOnboardingCommandLine('setup')}
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      Project config path:{' '}
                                      {renderLocalPathValue(
                                        visibleAppSettings.currentProjectConfigPath ?? (visibleAppSettings.onboardingContextRoot ? `${visibleAppSettings.onboardingContextRoot}/.openscout/project.json` : 'Not created yet.'),
                                        { className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity', style: s.mutedText },
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                                    style={{ color: C.ink }}
                                    onClick={() => { void handleRunOnboardingCommand('setup'); }}
                                    disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsDirty}
                                  >
                                    {onboardingCommandPending === 'setup' ? 'Running Setup…' : 'Run Setup'}
                                  </button>
                                </div>
                              ) : activeOnboardingStep.id === 'doctor' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="flex items-center gap-2">
                                      <Shield size={14} style={{ color: C.accent }} />
                                      <div className="text-[12px] font-medium" style={s.inkText}>Review the current inventory</div>
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      Check broker connectivity, source roots, and discovered projects.
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mt-3">
                                      <div>
                                        <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Projects</div>
                                        <div className="text-[12px] font-medium" style={s.inkText}>{visibleAppSettings.projectInventory.length}</div>
                                      </div>
                                      <div>
                                        <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Broker</div>
                                        <div className="text-[12px] font-medium" style={s.inkText}>{visibleAppSettings.broker.reachable ? 'Reachable' : 'Unavailable'}</div>
                                      </div>
                                    </div>
                                    <div className="text-[11px] font-mono mt-3 break-all" style={s.inkText}>scout doctor</div>
                                  </div>
                                  <button
                                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                                    style={{ color: C.ink }}
                                    onClick={() => { void handleRunOnboardingCommand('doctor'); }}
                                    disabled={Boolean(onboardingCommandPending) || appSettingsLoading || !onboardingHasProjectConfig}
                                  >
                                    {onboardingCommandPending === 'doctor' ? 'Running Doctor…' : 'Run Doctor'}
                                  </button>
                                </div>
                              ) : (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="flex items-center gap-2">
                                      <Terminal size={14} style={{ color: C.accent }} />
                                      <div className="text-[12px] font-medium" style={s.inkText}>Check runtime readiness</div>
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      Verify each harness runtime is installed and ready.
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 mt-3">
                                      {(visibleAppSettings.runtimeCatalog ?? []).map((runtimeEntry) => (
                                        <div key={runtimeEntry.name} className="rounded-lg border px-3 py-2.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                              <div className="text-[11px] font-medium" style={s.inkText}>{runtimeEntry.label}</div>
                                              <div className="text-[10px] mt-1 leading-[1.4]" style={s.mutedText}>{runtimeEntry.readinessDetail}</div>
                                            </div>
                                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={runtimeEntry.readinessState === 'ready' ? s.activePill : s.tagBadge}>
                                              {runtimeEntry.readinessState}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="text-[10px] mt-3 leading-[1.5]" style={s.mutedText}>
                                      Default harness: {visibleAppSettings.defaultHarness}. {onboardingRuntimeMatch ? `${onboardingRuntimeMatch.label} currently reports ${onboardingRuntimeMatch.readinessState}.` : 'No matching runtime is reported yet.'}
                                    </div>
                                    <div className="text-[11px] font-mono mt-3 break-all" style={s.inkText}>scout runtimes</div>
                                  </div>
                                  <button
                                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                                    style={{ color: C.ink }}
                                    onClick={() => void handleRunOnboardingCommand('runtimes')}
                                    disabled={Boolean(onboardingCommandPending) || appSettingsLoading}
                                  >
                                    {onboardingCommandPending === 'runtimes' ? 'Running Runtimes…' : 'Run Runtimes'}
                                  </button>
                                </div>
                              )}

                              <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
                                <button
                                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                                  style={{ color: C.ink }}
                                  onClick={() => moveOnboardingWizard(-1)}
                                  disabled={!canGoToPreviousOnboardingStep}
                                >
                                  Back
                                </button>
                                <button
                                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                                  style={{ color: C.ink }}
                                  onClick={handleOnboardingContinue}
                                  disabled={!canGoToNextOnboardingStep || appSettingsSaving || appSettingsLoading}
                                >
                                  {activeOnboardingStep.id === 'confirm'
                                    ? (appSettingsSaving ? 'Confirming…' : 'Confirm')
                                    : 'Next'}
                                  {activeOnboardingStep.id === 'confirm' ? null : <ChevronRight size={12} />}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg border px-3 py-3 mt-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>CLI Equivalent</div>
                            <div className="space-y-1">
                              {visibleAppSettings.onboarding.commands.map((command) => (
                                <div key={command} className="text-[11px] font-mono break-all" style={s.inkText}>{command}</div>
                              ))}
                            </div>
                            <div className="text-[10px] mt-3 leading-[1.5]" style={s.mutedText}>
                              Each wizard step runs the corresponding CLI command above.
                            </div>
                          </div>

                          {appSettingsFeedback ? (
                            <div className="text-[11px] mt-3 leading-[1.5]" style={s.inkText}>{appSettingsFeedback}</div>
                          ) : null}

                          {onboardingCommandResult ? (
                            <div className="rounded-lg border px-3 py-3 mt-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Last Command</div>
                                  <div className="text-[11px] font-mono break-all" style={s.inkText}>{onboardingCommandResult.commandLine}</div>
                                  <div className="text-[10px] mt-1" style={s.mutedText}>
                                    cwd:{' '}
                                    {renderLocalPathValue(onboardingCommandResult.cwd, {
                                      className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity',
                                      style: s.mutedText,
                                    })}
                                  </div>
                                </div>
                                <span
                                  className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                                  style={onboardingCommandResult.exitCode === 0 ? s.activePill : s.tagBadge}
                                >
                                  exit {onboardingCommandResult.exitCode}
                                </span>
                              </div>
                              <pre
                                className="mt-3 text-[10px] leading-[1.45] whitespace-pre-wrap break-words overflow-x-auto"
                                style={{ color: C.ink }}
                              >
                                {onboardingCommandResult.output}
                              </pre>
                            </div>
                          ) : null}
                        </section>
                      ) : null}

                      {appSettingsLoading && !visibleAppSettings ? (
                        <div className="text-[11px]" style={s.mutedText}>Loading settings…</div>
                      ) : (
                        <div className="space-y-5">
                          <section className="border rounded-lg overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                            <div className="p-4 border-b" style={{ borderColor: C.border }}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Scout CLI</div>
                                  <div className="text-[14px] font-medium mt-1" style={s.inkText}>Use the same commands here and in Terminal</div>
                                  <div className="text-[11px] mt-1 leading-[1.6] max-w-2xl" style={s.mutedText}>
                                    General is for local Scout setup. Workspace discovery lives in Workspace Explorer so this screen can stay fast.
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                                    style={{ color: C.ink }}
                                    onClick={openKnowledgeBase}
                                  >
                                    <BookOpen size={12} />
                                    Knowledge Base
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-4">
                              {([
                                {
                                  command: 'setup' as const,
                                  title: 'scout setup',
                                  detail: 'Create or refresh the local project manifest for this context.',
                                },
                                {
                                  command: 'doctor' as const,
                                  title: 'scout doctor',
                                  detail: 'Check broker health, scan roots, and discovery readiness.',
                                },
                                {
                                  command: 'runtimes' as const,
                                  title: 'scout runtimes',
                                  detail: 'Verify Claude and Codex runtimes are installed and ready.',
                                },
                              ]).map((item) => (
                                <article
                                  key={item.command}
                                  className="rounded-xl border px-4 py-4"
                                  style={{ borderColor: C.border, backgroundColor: C.bg }}
                                >
                                  <div className="text-[11px] font-mono font-medium" style={{ color: C.accent }}>{item.title}</div>
                                  <div className="text-[11px] mt-2 leading-[1.6]" style={s.mutedText}>{item.detail}</div>
                                  <div className="text-[10px] font-mono mt-3 break-all" style={s.inkText}>
                                    {buildOnboardingCommandLine(item.command)}
                                  </div>
                                  <div className="flex items-center gap-2 mt-4">
                                    <button
                                      type="button"
                                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
                                      style={{ color: C.ink }}
                                      onClick={() => { void handleRunOnboardingCommand(item.command); }}
                                      disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsSaving || (item.command === 'doctor' && appSettingsDirty)}
                                    >
                                      <Terminal size={12} />
                                      Run
                                    </button>
                                    <button
                                      type="button"
                                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                                      style={{ color: C.ink }}
                                      onClick={() => { void handleCopyOnboardingCommand(item.command); }}
                                    >
                                      {onboardingCopiedCommand === item.command ? <Check size={12} /> : <Copy size={12} />}
                                      Copy
                                    </button>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </section>

                          <section className="border rounded-lg overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                            <div className="divide-y" style={{ borderColor: C.border }}>
                              <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                <div className="sm:w-1/3">
                                  <div className="text-[12px] font-medium" style={s.inkText}>Display Name</div>
                                  <div className="text-[10px] mt-0.5" style={s.mutedText}>Used across Scout and Relay.</div>
                                </div>
                                <div className="sm:w-2/3">
                                  <input
                                    ref={settingsOperatorNameRef}
                                    value={isAppSettingsEditing ? (visibleAppSettings?.operatorName ?? '') : (visibleAppSettings?.operatorName ?? visibleAppSettings?.operatorNameDefault ?? '')}
                                    onChange={(event) => {
                                      setAppSettingsDraft((current) => current ? {
                                        ...current,
                                        operatorName: event.target.value,
                                      } : current);
                                      setAppSettingsFeedback(null);
                                    }}
                                    readOnly={!isAppSettingsEditing || appSettingsSaving}
                                    placeholder={appSettings?.operatorNameDefault ?? 'Operator'}
                                    className="w-full max-w-md rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none"
                                    style={{ borderColor: C.border, color: C.ink }}
                                  />
                                </div>
                              </div>

                              <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                                <div className="sm:w-1/3">
                                  <div className="text-[12px] font-medium" style={s.inkText}>Default Harness</div>
                                  <div className="text-[10px] mt-0.5" style={s.mutedText}>Fallback assistant family.</div>
                                </div>
                                <div className="sm:w-2/3">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {(['claude', 'codex'] as const).map((harness) => {
                                      const selected = visibleAppSettings?.defaultHarness === harness;
                                      const runtime = (visibleAppSettings?.runtimeCatalog ?? []).find((r) => r.name === harness);
                                      return (
                                        <button
                                          key={harness}
                                          type="button"
                                          className="rounded-md border px-3 py-1.5 text-[12px] font-medium capitalize transition-colors disabled:opacity-60 flex items-center gap-1.5"
                                          style={{ borderColor: selected ? C.accentBorder : C.border, backgroundColor: selected ? C.accentBg : C.bg, color: selected ? C.accent : C.ink }}
                                          disabled={!isAppSettingsEditing || appSettingsSaving}
                                          onClick={() => {
                                            setAppSettingsDraft((current) => current ? {
                                              ...current,
                                              defaultHarness: harness,
                                            } : current);
                                            setAppSettingsFeedback(null);
                                          }}
                                        >
                                          {harness}
                                          {runtime ? (
                                            <span className="text-[8px] font-mono uppercase tracking-wider px-1 py-px rounded-sm" style={runtime.readinessState === 'ready' ? s.activePill : s.tagBadge}>
                                              {runtime.readinessState}
                                            </span>
                                          ) : null}
                                        </button>
                                      );
                                    })}
                                    <button
                                      type="button"
                                      className="rounded-md border border-dashed w-8 h-8 flex items-center justify-center text-[14px] transition-colors disabled:opacity-40"
                                      style={{ borderColor: C.border, color: C.muted }}
                                      disabled={!isAppSettingsEditing || appSettingsSaving}
                                      title="Add runtime"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              </div>

                              <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                                <div className="sm:w-1/3">
                                  <div className="text-[12px] font-medium" style={s.inkText}>Context Root</div>
                                  <div className="text-[10px] mt-0.5" style={s.mutedText}>Where Scout stores workspace config.</div>
                                </div>
                                <div className="sm:w-2/3">
                                  <div className="flex items-center gap-1.5 max-w-md mb-2">
                                    <input
                                      value={visibleAppSettings?.onboardingContextRoot ?? ''}
                                      onChange={(event) => handleSetOnboardingContextRoot(event.target.value)}
                                      readOnly={!isAppSettingsEditing || appSettingsSaving}
                                      className="flex-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none font-mono"
                                      style={{ borderColor: C.border, color: C.ink }}
                                      placeholder="Choose where .openscout should live"
                                    />
                                    <button
                                      type="button"
                                      className="os-toolbar-button text-[10px] font-medium px-2 py-1.5 rounded-md"
                                      style={{ color: C.ink }}
                                      onClick={handleBrowseForOnboardingContextRoot}
                                      disabled={!isAppSettingsEditing || appSettingsSaving}
                                    >
                                      Finder
                                    </button>
                                  </div>
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={visibleAppSettings?.includeCurrentRepo ?? true}
                                        disabled={!isAppSettingsEditing || appSettingsSaving}
                                        onChange={(event) => {
                                          setAppSettingsDraft((current) => current ? {
                                            ...current,
                                            includeCurrentRepo: event.target.checked,
                                          } : current);
                                          setAppSettingsFeedback(null);
                                        }}
                                      />
                                      <span className="text-[10px]" style={s.inkText}>Include root in discovery</span>
                                    </label>
                                    {visibleAppSettings?.currentProjectConfigPath ? (
                                      <>
                                        <div className="hidden sm:block w-px h-3" style={{ backgroundColor: C.border }} />
                                        <span className="text-[9px] font-mono truncate" style={s.mutedText} title={visibleAppSettings.currentProjectConfigPath}>
                                          {renderLocalPathValue(visibleAppSettings.currentProjectConfigPath, {
                                            compact: true,
                                            className: 'text-left hover:opacity-80 transition-opacity',
                                            style: s.mutedText,
                                          })}
                                        </span>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                                <div className="sm:w-1/3">
                                  <div className="text-[12px] font-medium" style={s.inkText}>Scan Folders</div>
                                  <div className="text-[10px] mt-0.5" style={s.mutedText}>Parent directories for repos.</div>
                                </div>
                                <div className="sm:w-2/3">
                                  <div className="space-y-1.5">
                                    {(visibleAppSettings?.workspaceRoots ?? []).map((root, index) => (
                                      <div key={`general-source-root-${index}`} className="flex items-center gap-1.5 max-w-md">
                                        <input
                                          value={root}
                                          onChange={(event) => handleSetSourceRootAt(index, event.target.value)}
                                          readOnly={!isAppSettingsEditing || appSettingsSaving}
                                          className="flex-1 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.5] bg-transparent outline-none font-mono"
                                          style={{ borderColor: C.border, color: C.ink }}
                                          placeholder={index === 0 ? '~/dev' : 'Add another path'}
                                        />
                                        <button
                                          type="button"
                                          className="os-toolbar-button text-[10px] font-medium px-2 py-1.5 rounded-md"
                                          style={{ color: C.ink }}
                                          onClick={() => handleBrowseForSourceRoot(index)}
                                          disabled={!isAppSettingsEditing || appSettingsSaving}
                                        >
                                          Finder
                                        </button>
                                        <button
                                          type="button"
                                          className="os-toolbar-button text-[12px] font-medium w-7 h-7 rounded-md disabled:opacity-50"
                                          style={{ color: C.ink }}
                                          onClick={() => handleRemoveSourceRootRow(index)}
                                          disabled={!isAppSettingsEditing || appSettingsSaving || ((visibleAppSettings?.workspaceRoots ?? []).length <= 1 && !root)}
                                          aria-label={`Remove project path ${index + 1}`}
                                        >
                                          -
                                        </button>
                                      </div>
                                    ))}
                                    {(visibleAppSettings?.workspaceRoots?.length ?? 0) === 0 ? (
                                      <div className="rounded-md border border-dashed px-2.5 py-2.5 text-[11px] leading-[1.5] max-w-md" style={{ borderColor: C.border, color: C.muted }}>
                                        No scan folders configured. Add one to discover projects.
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                    <button
                                      type="button"
                                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
                                      style={{ color: C.ink }}
                                      onClick={() => {
                                        handleBeginGeneralEdit();
                                        handleAddSourceRootRow();
                                      }}
                                      disabled={appSettingsSaving}
                                    >
                                      <span className="text-[12px] leading-none">+</span>
                                      Add path
                                    </button>
                                    <span className="text-[10px]" style={s.mutedText}>or</span>
                                    {SOURCE_ROOT_PATH_SUGGESTIONS.map((root) => (
                                      <button
                                        key={root}
                                        type="button"
                                        className="os-toolbar-button text-[10px] font-mono px-2 py-1 rounded-md disabled:opacity-50"
                                        style={{ color: C.ink }}
                                        onClick={() => {
                                          handleBeginGeneralEdit();
                                          handleAddSourceRootSuggestion(root);
                                        }}
                                        disabled={appSettingsSaving}
                                      >
                                        {root}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </section>

                          {appSettingsFeedback ? (
                            <div className="text-[11px] leading-[1.5]" style={s.inkText}>{appSettingsFeedback}</div>
                          ) : null}

                          {onboardingCommandResult?.command === 'doctor' ? (
                            <div className="space-y-2">
                              <div className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>Doctor Output</div>
                              {renderOnboardingCommandShell('doctor', buildOnboardingCommandLine('doctor'), onboardingCommandPending === 'doctor')}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ) : settingsSection === 'agents' ? (
                  <AgentSettingsView
                    styles={{
                      surface: s.surface,
                      inkText: s.inkText,
                      mutedText: s.mutedText,
                      tagBadge: s.tagBadge,
                      activePill: s.activePill,
                    }}
                    selectedInterAgent={selectedInterAgent}
                    availableAgents={rosterInterAgentAgents}
                    isAgentConfigEditing={isAgentConfigEditing}
                    hasEditableAgentConfig={hasEditableAgentConfig}
                    agentConfigLoading={agentConfigLoading}
                    agentConfigSaving={agentConfigSaving}
                    agentConfigRestarting={agentConfigRestarting}
                    visibleAgentConfig={visibleAgentConfig}
                    agentConfigFeedback={agentConfigFeedback}
                    agentCapabilitiesPreview={agentCapabilitiesPreview}
                    agentRuntimePathRef={agentRuntimePathRef}
                    onOpenAgents={() => setActiveView('agents')}
                    onOpenAgentProfile={openAgentProfile}
                    onOpenAgentThread={(agentId) => openRelayAgentThread(agentId, { focusComposer: true })}
                    onUpdateAgentConfigDraft={updateAgentConfigDraft}
                    renderLocalPathValue={renderLocalPathValue}
                    interAgentProfileKindLabel={interAgentProfileKindLabel}
                    onSelectAgent={handleSelectInterAgent}
                  />
                ) : settingsSection === 'workspaces' ? (
                  <WorkspaceExplorerView
                    styles={{
                      surface: s.surface,
                      inkText: s.inkText,
                      mutedText: s.mutedText,
                      tagBadge: s.tagBadge,
                      activePill: s.activePill,
                    }}
                    selectedWorkspaceProject={selectedWorkspaceProject}
                    selectedWorkspaceAgent={selectedWorkspaceAgent}
                    workspaceExplorerQuery={workspaceExplorerQuery}
                    setWorkspaceExplorerQuery={setWorkspaceExplorerQuery}
                    workspaceExplorerFilter={workspaceExplorerFilter}
                    setWorkspaceExplorerFilter={setWorkspaceExplorerFilter}
                    workspaceExplorerViewMode={workspaceExplorerViewMode}
                    setWorkspaceExplorerViewMode={setWorkspaceExplorerViewMode}
                    workspaceExplorerItems={workspaceExplorerItems}
                    workspaceExplorerBoundCount={workspaceExplorerBoundCount}
                    workspaceExplorerDiscoveredCount={workspaceExplorerDiscoveredCount}
                    filteredWorkspaceExplorerItems={filteredWorkspaceExplorerItems}
                    workspaceInventoryLoaded={workspaceInventoryLoaded}
                    workspaceInventoryLoading={workspaceInventoryLoading}
                    canRefreshWorkspaceInventory={canRefreshWorkspaceInventory}
                    onboardingCommandPending={onboardingCommandPending}
                    appSettingsLoading={appSettingsLoading}
                    appSettingsSaving={appSettingsSaving}
                    appSettingsDirty={appSettingsDirty}
                    appSettingsFeedback={appSettingsFeedback}
                    showDoctorOutput={showDoctorOutput}
                    doctorOutput={renderOnboardingCommandShell('doctor', buildOnboardingCommandLine('doctor'), onboardingCommandPending === 'doctor')}
                    projectRetirementPendingRoot={projectRetirementPendingRoot}
                    onRefreshWorkspaceDiscovery={() => {
                      void handleRunOnboardingCommand('doctor');
                    }}
                    onLoadWorkspaceInventory={handleLoadWorkspaceInventory}
                    onAddWorkspace={handleAddWorkspaceFromExplorer}
                    onInspectWorkspace={handleInspectWorkspace}
                    onOpenWorkspace={handleOpenWorkspace}
                    onRetireWorkspace={(project) => {
                      void handleRetireProject(project.root, project.title);
                    }}
                    onOpenAgentProfile={openAgentProfile}
                    onOpenAgentSettings={(agentId) => openAgentSettings(agentId, true)}
                    renderLocalPathValue={renderLocalPathValue}
                  />
                ) : settingsSection === 'communication' ? (
                  <CommunicationSettingsView
                    styles={{
                      surface: s.surface,
                      inkText: s.inkText,
                      mutedText: s.mutedText,
                      tagBadge: s.tagBadge,
                      activePill: s.activePill,
                    }}
                    showTelegram={desktopFeatures.telegram}
                    showVoice={desktopFeatures.voice}
                    visibleAppSettings={visibleAppSettings}
                    isAppSettingsEditing={isAppSettingsEditing}
                    appSettingsSaving={appSettingsSaving}
                    appSettingsFeedback={appSettingsFeedback}
                    onUpdateAppSettingsDraft={updateAppSettingsDraft}
                    brokerInspector={brokerInspector}
                    brokerControlPending={brokerControlPending}
                    brokerControlFeedback={brokerControlFeedback}
                    onBrokerControl={(action) => {
                      void handleBrokerControl(action);
                    }}
                    relayServiceInspectorRef={relayServiceInspectorRef}
                    relayRuntimeBooting={relayRuntimeBooting}
                    relayRuntimeHealthLabel={relayRuntimeHealthLabel}
                    runtime={runtime}
                    reachableRelayAgentCount={reachableRelayAgents.length}
                    voiceCaptureTitle={relayState?.voice.captureTitle ?? 'Not reported'}
                    voiceRepliesEnabled={relayState?.voice.repliesEnabled ?? false}
                    onSetVoiceRepliesEnabled={(enabled) => {
                      void handleSetVoiceRepliesEnabled(enabled);
                    }}
                    renderLocalPathValue={renderLocalPathValue}
                  />
                ) : settingsSection === 'database' ? (
                  <div className="space-y-4">
                    <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Session Index</div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          ['Sessions', `${stats.totalSessions}`],
                          ['Messages', `${stats.totalMessages}`],
                          ['Projects', `${stats.projects}`],
                          ['Tokens', `${Math.round(stats.totalTokens / 1000)}k`],
                          ['Runtime Messages', `${runtime?.messageCount ?? 0}`],
                          ['tmux Sessions', `${runtime?.tmuxSessionCount ?? 0}`],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg border px-3 py-2.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                            <div className="text-[16px] font-semibold" style={s.inkText}>{value}</div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Storage</div>
                      <div className="space-y-3">
                        {visibleAppSettings?.controlPlaneSqlitePath ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium" style={s.inkText}>Control plane database</div>
                              <div className="text-[11px] font-mono mt-1 truncate" style={s.mutedText}>
                                {renderLocalPathValue(visibleAppSettings.controlPlaneSqlitePath, {
                                  className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity truncate',
                                  style: s.mutedText,
                                })}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="os-toolbar-button text-[11px] font-medium px-3 py-1.5 rounded-lg border shrink-0"
                              style={{ color: C.ink, borderColor: C.border }}
                              onClick={() => scoutDesktop?.revealPath(visibleAppSettings.controlPlaneSqlitePath)}
                            >
                              Reveal in Finder
                            </button>
                          </div>
                        ) : null}
                        {visibleAppSettings?.settingsPath ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium" style={s.inkText}>Settings</div>
                              <div className="text-[11px] font-mono mt-1 truncate" style={s.mutedText}>
                                {renderLocalPathValue(visibleAppSettings.settingsPath, {
                                  className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity truncate',
                                  style: s.mutedText,
                                })}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="os-toolbar-button text-[11px] font-medium px-3 py-1.5 rounded-lg border shrink-0"
                              style={{ color: C.ink, borderColor: C.border }}
                              onClick={() => scoutDesktop?.revealPath(visibleAppSettings.settingsPath)}
                            >
                              Reveal in Finder
                            </button>
                          </div>
                        ) : null}
                        {visibleAppSettings?.supportDirectory ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium" style={s.inkText}>Support directory</div>
                              <div className="text-[11px] font-mono mt-1 truncate" style={s.mutedText}>
                                {renderLocalPathValue(visibleAppSettings.supportDirectory, {
                                  className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity truncate',
                                  style: s.mutedText,
                                })}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="os-toolbar-button text-[11px] font-medium px-3 py-1.5 rounded-lg border shrink-0"
                              style={{ color: C.ink, borderColor: C.border }}
                              onClick={() => scoutDesktop?.revealPath(visibleAppSettings.supportDirectory)}
                            >
                              Reveal in Finder
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(320px,0.85fr)] gap-4">
                    <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Color Mode</div>
                      <div className="flex gap-3 mb-5">
                        {[
                          { id: 'light', label: 'Light' },
                          { id: 'dark', label: 'Dark' },
                        ].map((mode) => {
                          const active = mode.id === (dark ? 'dark' : 'light');
                          return (
                            <button
                              key={mode.id}
                              onClick={() => setDark(mode.id === 'dark')}
                              className="flex-1 border rounded-xl px-4 py-4 text-left"
                              style={{
                                borderColor: active ? C.accent : C.border,
                                backgroundColor: active ? C.bg : C.surface,
                              }}
                            >
                              <div className="flex items-center gap-2 mb-1" style={{ color: active ? C.accent : C.muted }}>
                                {mode.id === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                                <span className="text-[12px] font-medium" style={active ? { color: C.accent } : s.inkText}>{mode.label}</span>
                              </div>
                              <div className="text-[11px] leading-[1.5]" style={s.mutedText}>
                                {mode.id === 'dark' ? 'Deep shell contrast for low-light work.' : 'Warm neutral shell with higher paper-like contrast.'}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="border rounded-xl px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={{ color: C.accent }}>Annotations</div>
                            <div className="text-[12px] leading-[1.6]" style={s.mutedText}>
                              Show routing and provenance tags in timelines.
                            </div>
                          </div>
                          <button
                            onClick={() => setShowAnnotations((current) => !current)}
                            className="os-toolbar-button text-[11px] font-medium px-2 py-1 rounded"
                            style={{ color: C.ink }}
                          >
                            {showAnnotations ? 'Hide annotations' : 'Show annotations'}
                          </button>
                        </div>
                      </div>
                    </section>

                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Current Surface</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          {[
                            ['Mode', dark ? 'Dark' : 'Light'],
                            ['Annotations', showAnnotations ? 'Visible' : 'Hidden'],
                            ['Sidebar', isCollapsed ? 'Collapsed' : 'Expanded'],
                            ['Section', activeSettingsMeta.label],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                              <div className="text-[12px]" style={s.inkText}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={{ color: C.accent }}>Coming Soon</div>
                        <div className="text-[12px] leading-[1.6]" style={s.mutedText}>
                          Theme, density, and typography controls.
                        </div>
                      </section>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        /* --- AGENTS --- */
        ) : activeView === 'agents' ? (
          <>
            {!isCollapsed && (
              <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
                <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={handleMouseDown} />
                <div className="px-4 h-14 flex items-center justify-between border-b" style={{ borderBottomColor: C.border }}>
                  <div>
                    <h1 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>Agents</h1>
                    <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>
                      {rosterInterAgentAgents.length === interAgentAgents.length
                        ? `${interAgentAgents.length} agents`
                        : `${rosterInterAgentAgents.length} visible · ${interAgentAgents.length} total`}
                    </div>
                  </div>
                  <button className="p-1.5 rounded transition-opacity hover:opacity-70" style={s.mutedText} onClick={() => void handleRefreshShell()}>
                    <RefreshCw size={14} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-3">
                  <div className="mb-3 px-2">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1.5 px-2" style={s.mutedText}>Roster</div>
                    <div className="flex items-center justify-end gap-2 px-2 mb-2 relative">
                      <div className="relative">
                        <button
                          className="os-toolbar-button flex items-center gap-1 text-[10px] px-2 py-1 rounded"
                          style={{ color: C.ink }}
                          onClick={() => setAgentRosterMenu((current) => current === 'filter' ? null : 'filter')}
                          title="Filter roster"
                        >
                          <Filter size={11} />
                          <span style={s.mutedText}>{agentRosterFilterLabel(agentRosterFilter)}</span>
                        </button>
                        {agentRosterMenu === 'filter' ? (
                          <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border shadow-sm z-20" style={{ backgroundColor: C.surface, borderColor: C.border }}>
                            {([
                              ['all', 'All Agents'],
                              ['active', 'Active Only'],
                            ] as const).map(([value, label]) => (
                              <button
                                key={value}
                                className="w-full text-left px-3 py-2 text-[11px] transition-opacity hover:opacity-80"
                                style={value === agentRosterFilter ? s.activeItem : s.inkText}
                                onClick={() => {
                                  setAgentRosterFilter(value);
                                  setAgentRosterMenu(null);
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
                          onClick={() => setAgentRosterMenu((current) => current === 'sort' ? null : 'sort')}
                          title="Sort roster"
                        >
                          <ArrowUpDown size={11} />
                          <span style={s.mutedText}>{agentRosterSortLabel(agentRosterSort)}</span>
                        </button>
                        {agentRosterMenu === 'sort' ? (
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
                                style={value === agentRosterSort ? s.activeItem : s.inkText}
                                onClick={() => {
                                  setAgentRosterSort(value);
                                  setAgentRosterMenu(null);
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
                      {rosterInterAgentAgents.length > 0 ? rosterInterAgentAgents.map((agent) => {
                        const active = selectedInterAgentId === agent.id;
                        return (
                          <button
                            key={agent.id}
                            onClick={() => handleSelectInterAgent(agent.id)}
                            className="flex items-center gap-2 px-2 py-2 rounded text-[12px] transition-opacity w-full text-left"
                            style={active ? s.activeItem : s.mutedText}
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
                              ></div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate" style={s.inkText}>
                                {agent.title}
                                {(rosterAgentTitleCounts.get(agent.title) ?? 0) > 1 && agent.branch ? (
                                  <span className="font-normal ml-1 text-[10px]" style={s.mutedText}>{agent.branch}</span>
                                ) : null}
                              </div>
                              <div className="text-[10px] truncate" style={s.mutedText}>{agentRosterSecondaryText(agent, agentRosterSort)}</div>
                            </div>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={active ? s.activePill : s.tagBadge}>{agent.threadCount}</span>
                          </button>
                        );
                      }) : (
                        <div className="px-3 py-8 text-[12px] text-center" style={s.mutedText}>
                          No agents match this view yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col relative min-w-0" style={s.surface}>
              <div className="border-b px-4 py-3 shrink-0" style={{ ...s.surface, borderBottomColor: C.border }}>
                {selectedInterAgent ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="relative shrink-0">
                        <div
                          className={`w-9 h-9 rounded-xl text-[13px] text-white flex items-center justify-center font-bold ${selectedInterAgent.reachable ? '' : 'opacity-40 grayscale'}`}
                          style={{ backgroundColor: colorForIdentity(selectedInterAgent.id) }}
                        >
                          {selectedInterAgent.title.charAt(0).toUpperCase()}
                        </div>
                        <div
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${relayPresenceDotClass(selectedInterAgent.state)}`}
                          style={{ border: `1px solid ${C.surface}` }}
                        ></div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-[15px] font-semibold tracking-tight truncate" style={s.inkText}>
                            {selectedInterAgent.title}
                          </div>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={selectedInterAgent.state === 'working' ? s.activePill : s.tagBadge}>
                            {selectedInterAgent.state === 'working' ? 'Working' : selectedInterAgent.state === 'offline' ? 'Offline' : 'Available'}
                          </span>
                        </div>
                        <div className="text-[11px] mt-0.5 truncate max-w-2xl" style={s.mutedText}>
                          {selectedInterAgent.statusDetail ?? selectedInterAgent.summary ?? null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <AgentActionButton
                        icon={<MessageSquare size={13} />}
                        tone={selectedInterAgentDirectThread ? 'primary' : 'neutral'}
                        onClick={() => openRelayAgentThread(selectedInterAgent.id, { focusComposer: true })}
                      >
                        {selectedInterAgentChatActionLabel}
                      </AgentActionButton>
                      <AgentActionButton
                        icon={<Eye size={13} />}
                        onClick={() => handlePeekAgentSession()}
                      >
                        Peek
                      </AgentActionButton>
                      <AgentActionButton
                        icon={<Settings size={13} />}
                        onClick={() => openAgentSettings(selectedInterAgent.id, selectedInterAgent.profileKind === 'project')}
                      >
                        {selectedInterAgent.profileKind === 'project' ? 'Configure' : 'Settings'}
                      </AgentActionButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <Bot size={14} style={s.mutedText} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold tracking-tight truncate" style={s.inkText}>
                        Agents
                      </div>
                      <div className="text-[10px] truncate mt-0.5" style={s.mutedText}>
                        Select an agent to inspect its operational snapshot and recent threads.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {!selectedInterAgent ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <Bot size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No agent selected</h3>
                    <p className="text-[13px] max-w-sm" style={s.mutedText}>
                      Pick an agent from the left rail to inspect its profile, runtime binding, and recent communication.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {/* 1. Live Session */}
                    <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                      <div
                        className="px-4 py-3 border-b flex items-center justify-between gap-3"
                        style={{ backgroundColor: C.surface, borderBottomColor: C.border }}
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Live Session</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {visibleAgentSession?.commandLabel ? (
                            <AgentActionButton
                              icon={<Copy size={13} />}
                              onClick={() => void handleCopyAgentSessionCommand()}
                            >
                              {agentSessionCopied ? 'Copied' : 'Copy'}
                            </AgentActionButton>
                          ) : null}
                          {visibleAgentSession && visibleAgentSession.mode !== 'none' ? (
                            <AgentActionButton
                              icon={<FolderOpen size={13} />}
                              onClick={() => void handleOpenAgentSession()}
                            >
                              {visibleAgentSession.mode === 'tmux' ? 'Open TMUX' : 'Open Logs'}
                            </AgentActionButton>
                          ) : null}
                        </div>
                      </div>

                      {/* Messages — primary content */}
                      <div className="px-4 py-4 max-h-[320px] overflow-y-auto" style={{ backgroundColor: C.bg }}>
                        {selectedInterAgentActivityMessages.length > 0 ? (
                          <RelayTimeline
                            messages={selectedInterAgentActivityMessages.slice(-8)}
                            showAnnotations={false}
                            showStatusMessages={false}
                            inkStyle={s.inkText}
                            mutedStyle={s.mutedText}
                            tagStyle={s.tagBadge}
                            annotStyle={s.annotBadge}
                            agentLookup={interAgentAgentLookup}
                            directThreadLookup={relayDirectLookup}
                            onOpenAgentProfile={openAgentProfile}
                            onOpenAgentChat={(agentId, draft) => openRelayAgentThread(agentId, { draft, focusComposer: true })}
                            onNudgeMessage={handleNudgeMessage}
                          />
                        ) : (
                          <div className="text-[11px] leading-[1.6]" style={s.mutedText}>
                            No messages yet. Use the broker to send this agent a task.
                          </div>
                        )}
                      </div>

                      {/* Logs — collapsible secondary */}
                      <Collapsible open={agentSessionLogsExpanded} onOpenChange={setAgentSessionLogsExpanded}>
                        <CollapsibleTrigger asChild>
                          <button
                            className="w-full px-4 py-2 border-t flex items-center justify-between gap-2 text-[10px] hover:opacity-90 transition-opacity text-left"
                            style={{ borderTopColor: C.border, backgroundColor: C.bg, color: C.muted }}
                          >
                            <div className="flex items-center gap-2">
                              <ChevronRight size={10} className="transition-transform duration-150" style={{ transform: agentSessionLogsExpanded ? 'rotate(90deg)' : undefined }} />
                              <span className="font-mono uppercase tracking-wider">Logs</span>
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={visibleAgentSession?.mode === 'tmux' ? s.activePill : s.tagBadge}>
                                {agentSessionPending ? 'Loading' : visibleAgentSession?.mode === 'tmux' ? 'TMUX' : visibleAgentSession?.mode === 'logs' ? 'Logs' : 'Unavailable'}
                              </span>
                              {visibleAgentSession?.updatedAtLabel ? <span>Updated {visibleAgentSession.updatedAtLabel}</span> : null}
                            </div>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div style={{ backgroundColor: C.termBg }}>
                            {agentSessionLoading && !visibleAgentSession ? (
                              <div className="px-4 py-8 text-[11px] font-mono" style={{ color: C.termFg }}>
                                Loading live session…
                              </div>
                            ) : visibleAgentSession?.body ? (
                              <pre
                                ref={(element) => {
                                  agentSessionInlineViewportRef.current = element;
                                }}
                                onScroll={(event) => {
                                  agentSessionInlineStickToBottomRef.current = agentSessionShouldStickToBottom(event.currentTarget);
                                }}
                                className="px-4 py-4 text-[11px] leading-[1.6] overflow-x-auto whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto"
                                style={{ color: C.termFg, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                              >
                                {visibleAgentSession.body}
                              </pre>
                            ) : (
                              <div className="px-4 py-8 text-[11px] leading-[1.65] font-mono" style={{ color: C.termFg }}>
                                {agentSessionPending
                                  ? 'Checking for a live tmux pane first, then falling back to canonical runtime logs.'
                                  : visibleAgentSession?.subtitle ?? 'No session output available yet.'}
                              </div>
                            )}
                          </div>
                          <div
                            className="px-4 h-10 border-t flex items-center justify-between gap-3 text-[10px]"
                            style={{ borderTopColor: C.border, backgroundColor: C.bg, color: C.muted }}
                          >
                            <div className="truncate min-w-0 font-mono">
                              {renderLocalPathValue(
                                visibleAgentSession?.pathLabel ?? compactHomePath(selectedInterAgent?.cwd ?? selectedInterAgent?.projectRoot) ?? 'No stable session path yet.',
                                {
                                  className: 'text-left underline underline-offset-2 decoration-dotted hover:opacity-80 transition-opacity',
                                },
                              )}
                            </div>
                            {agentSessionFeedback ? (
                              <div className="shrink-0" style={s.inkText}>{agentSessionFeedback}</div>
                            ) : null}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </section>

                    {/* 2. Recent Activity */}
                    <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border, backgroundColor: C.surface }}>
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Recent Activity</div>
                        </div>
                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                              {selectedInterAgentActivityMessages.length} events
                            </span>
                            {selectedInterAgentInboundTasks.length > 0 ? (
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.activePill}>
                                {selectedInterAgentInboundTasks.length} asks
                              </span>
                            ) : null}
                            {selectedInterAgentOutboundFindings.length > 0 ? (
                              <span
                                className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded"
                                style={{
                                  backgroundColor: 'rgba(248, 113, 113, 0.14)',
                                  color: '#b91c1c',
                                }}
                              >
                                {selectedInterAgentOutboundFindings.length} waiting
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {selectedInterAgentFindings.length > 0 ? (
                          <div className="px-4 py-3 border-b flex flex-col gap-2" style={{ borderBottomColor: C.border, backgroundColor: C.bg }}>
                            {selectedInterAgentFindings.slice(0, 2).map((finding) => (
                              <div
                                key={finding.id}
                                className="rounded-lg border px-3 py-2"
                                style={{
                                  borderColor: finding.severity === 'error' ? 'rgba(248, 113, 113, 0.28)' : 'rgba(245, 158, 11, 0.28)',
                                  backgroundColor: finding.severity === 'error' ? 'rgba(248, 113, 113, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                                }}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[11px] font-medium" style={s.inkText}>{finding.title}</div>
                                  <span className="text-[9px] font-mono uppercase" style={s.mutedText}>
                                    {finding.ageLabel ?? finding.updatedAtLabel ?? 'Open'}
                                  </span>
                                </div>
                                <div className="text-[11px] mt-1" style={s.mutedText}>
                                  {finding.summary}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                      <div className="px-4 py-4 max-h-[280px] overflow-y-auto" style={{ backgroundColor: C.bg }}>
                        {selectedInterAgentActivityMessages.length > 0 ? (
                          <RelayTimeline
                            messages={agentActivityExpanded ? selectedInterAgentActivityMessages : selectedInterAgentActivityMessages.slice(-5)}
                            showAnnotations={true}
                            showStatusMessages={true}
                            inkStyle={s.inkText}
                            mutedStyle={s.mutedText}
                            tagStyle={s.tagBadge}
                            annotStyle={s.annotBadge}
                            agentLookup={interAgentAgentLookup}
                            directThreadLookup={relayDirectLookup}
                            onOpenAgentProfile={openAgentProfile}
                            onOpenAgentChat={(agentId, draft) => openRelayAgentThread(agentId, { draft, focusComposer: true })}
                            onNudgeMessage={handleNudgeMessage}
                          />
                        ) : (
                          <div className="text-[11px] leading-[1.6]" style={s.mutedText}>
                            No broker-visible activity for this agent yet.
                          </div>
                        )}
                        {selectedInterAgentActivityMessages.length > 5 && !agentActivityExpanded ? (
                          <button
                            className="w-full text-center py-2 text-[11px] font-medium hover:opacity-80 transition-opacity"
                            style={{ color: C.accent }}
                            onClick={() => setAgentActivityExpanded(true)}
                          >
                            Show all {selectedInterAgentActivityMessages.length} events
                          </button>
                        ) : null}
                      </div>
                    </section>

                    {/* 3. Open Threads (collapsible) */}
                    <Collapsible open={agentThreadsExpanded} onOpenChange={setAgentThreadsExpanded}>
                      <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                        <CollapsibleTrigger asChild>
                          <button className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:opacity-90 transition-opacity text-left" style={{ backgroundColor: C.surface }}>
                            <div className="flex items-center gap-2">
                              <ChevronRight size={12} className="transition-transform duration-150" style={{ color: C.muted, transform: agentThreadsExpanded ? 'rotate(90deg)' : undefined }} />
                              <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Open Threads</div>
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>{visibleInterAgentThreads.length + 1}</span>
                            </div>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-4 py-3 border-t flex flex-col gap-3" style={{ borderTopColor: C.border }}>
                            <div className="border rounded-lg px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[13px] font-medium truncate" style={s.inkText}>Direct Line</div>
                                  <div className="text-[10px] truncate mt-1" style={s.mutedText}>You and {selectedInterAgent.title}</div>
                                </div>
                                <span className="text-[10px] font-mono shrink-0" style={s.mutedText}>
                                  {selectedInterAgentDirectThread?.timestampLabel ?? selectedInterAgent.lastChatLabel ?? ''}
                                </span>
                              </div>
                              <div className="text-[12px] leading-[1.55] mt-3" style={s.mutedText}>
                                {selectedAgentDirectLinePreview}
                              </div>
                              <div className="flex items-center justify-between gap-3 mt-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.activePill}>
                                    Direct
                                  </span>
                                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                                    {selectedInterAgent.state === 'working' ? 'Working' : selectedInterAgent.state === 'offline' ? 'Offline' : 'Available'}
                                  </span>
                                </div>
                                <button
                                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded shrink-0"
                                  style={{ color: C.ink }}
                                  onClick={() => openRelayAgentThread(selectedInterAgent.id, { focusComposer: true })}
                                >
                                  {selectedInterAgentChatActionLabel}
                                </button>
                              </div>
                            </div>
                            {visibleInterAgentThreads.length > 0 ? (
                              <div className="flex flex-col gap-3">
                                {visibleInterAgentThreads.map((thread) => (
                                  <div
                                    key={thread.id}
                                    className="border rounded-lg px-3 py-3"
                                    style={{ borderColor: C.border, backgroundColor: selectedInterAgentThreadId === thread.id ? C.bg : C.surface }}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-[13px] font-medium truncate" style={s.inkText}>
                                          {interAgentThreadTitleForAgent(thread, selectedInterAgent.id)}
                                        </div>
                                        <div className="text-[10px] truncate mt-1" style={s.mutedText}>
                                          {interAgentThreadSubtitle(thread, selectedInterAgent.id)}
                                        </div>
                                      </div>
                                      <span className="text-[10px] font-mono shrink-0" style={s.mutedText}>
                                        {thread.timestampLabel ?? ''}
                                      </span>
                                    </div>
                                    <div className="text-[12px] leading-[1.55] mt-3" style={s.mutedText}>
                                      {thread.preview ?? 'No message preview yet.'}
                                    </div>
                                    <div className="flex items-center justify-between gap-3 mt-3">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={thread.sourceKind === 'private' ? s.tagBadge : s.activePill}>
                                          {thread.sourceKind === 'private' ? 'Private' : 'Targeted'}
                                        </span>
                                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>
                                          {thread.messageCount} msgs
                                        </span>
                                      </div>
                                      <button
                                        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                                        style={{ color: C.ink }}
                                        onClick={() => {
                                          setSelectedInterAgentThreadId(thread.id);
                                          setActiveView('inter-agent');
                                        }}
                                      >
                                        Open
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex flex-col items-start gap-3">
                                <div className="text-[11px] leading-[1.5]" style={s.mutedText}>
                                  No other active channels for this agent yet.
                                </div>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </section>
                    </Collapsible>

                    {/* 4. Operational Snapshot (collapsible) */}
                    <Collapsible open={agentSnapshotExpanded} onOpenChange={setAgentSnapshotExpanded}>
                      <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                        <CollapsibleTrigger asChild>
                          <button className="w-full px-4 py-3 flex items-center gap-2 hover:opacity-90 transition-opacity text-left" style={{ backgroundColor: C.surface }}>
                            <ChevronRight size={12} className="transition-transform duration-150" style={{ color: C.muted, transform: agentSnapshotExpanded ? 'rotate(90deg)' : undefined }} />
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: C.accent }}>Operational Snapshot</div>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-4 py-3 border-t" style={{ borderTopColor: C.border }}>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                              {[
                                ['Harness', visibleAgentConfig?.runtime.harness ?? selectedInterAgent.harness ?? 'Not reported'],
                                ['Session', visibleAgentConfig?.runtime.sessionId ?? selectedInterAgent.sessionId ?? 'Not reported'],
                                ['Transport', visibleAgentConfig?.runtime.transport ?? selectedInterAgent.transport ?? 'Not reported'],
                                ['Wake Policy', visibleAgentConfig?.runtime.wakePolicy || selectedInterAgent.wakePolicy || 'Not reported'],
                                ['Last Chat', selectedInterAgent.lastChatLabel ?? 'Not reported'],
                                ['Last Dev Session', selectedInterAgent.lastSessionLabel ?? 'Not reported'],
                                ['Last Code Change', selectedInterAgent.lastCodeChangeLabel ?? 'Not reported'],
                              ].map(([label, value]) => (
                                <div key={label} className="min-w-0">
                                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                                  <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{value}</div>
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

        /* --- LOGS --- */
        ) : activeView === 'logs' ? (
          <>
            {!isCollapsed && (
              <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
                <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={handleMouseDown} />
                <div className="px-4 h-14 flex items-center border-b" style={{ borderBottomColor: C.border }}>
                  <div>
                    <h1 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>Logs</h1>
                    <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>
                      {logSources.length} sources
                    </div>
                  </div>
                </div>
                <div className="px-3 py-3 border-b" style={{ borderBottomColor: C.border }}>
                  <input
                    type="text"
                    value={logSourceQuery}
                    onChange={(event) => setLogSourceQuery(event.target.value)}
                    placeholder="Filter sources…"
                    className="w-full rounded-lg border px-3 py-2 text-[11px] bg-transparent outline-none"
                    style={{ borderColor: C.border, color: C.ink }}
                  />
                </div>
                <div className="flex-1 overflow-y-auto py-3">
                  {logSources.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <div className="flex justify-center gap-1 mb-2">
                        <span className="os-thinking-dot" style={{ color: C.accent }} />
                        <span className="os-thinking-dot" style={{ color: C.accent }} />
                        <span className="os-thinking-dot" style={{ color: C.accent }} />
                      </div>
                      <div className="text-[11px]" style={s.mutedText}>Loading sources…</div>
                    </div>
                  ) : (['runtime', 'app', 'agents'] as const).map((group) => {
                    const groupSources = filteredLogSources.filter((source) => source.group === group);
                    if (groupSources.length === 0) {
                      return null;
                    }
                    const label = group === 'runtime' ? 'Runtime' : group === 'app' ? 'App' : 'Agents';
                    return (
                      <div key={group} className="mb-3 px-2">
                        <div className="font-mono text-[9px] tracking-widest uppercase mb-1.5 px-2" style={s.mutedText}>{label}</div>
                        <div className="flex flex-col gap-px">
                          {groupSources.map((source) => {
                            const active = selectedLogSourceId === source.id;
                            return (
                              <button
                                key={source.id}
                                onClick={() => {
                                  setSelectedLogSourceId(source.id);
                                  setLogSearchQuery('');
                                }}
                                className="w-full text-left px-2 py-2 rounded transition-opacity hover:opacity-90"
                                style={active ? s.activeItem : s.mutedText}
                              >
                                <div className="text-[12px] font-medium truncate" style={s.inkText}>{source.title}</div>
                                <div className="text-[10px] truncate mt-0.5" style={s.mutedText}>{source.subtitle}</div>
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

            <div className="flex-1 flex flex-col relative min-w-0" style={s.surface}>
              <div className="border-b flex items-center justify-between px-4 h-14 shrink-0 gap-4" style={{ ...s.surface, borderBottomColor: C.border }}>
                <div className="flex items-center gap-2 min-w-0">
                  <FileJson size={14} style={s.mutedText} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold tracking-tight truncate" style={s.inkText}>
                      {selectedLogSource?.title ?? 'Logs'}
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={s.mutedText}>
                      {logContent?.updatedAtLabel
                        ? `${selectedLogSource?.subtitle ?? 'Log tail'} · Updated ${logContent.updatedAtLabel}`
                        : selectedLogSource?.subtitle ?? 'Relay runtime, app, and relay agent logs.'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-b px-4 py-3 flex items-center gap-3" style={{ borderBottomColor: C.border }}>
                <input
                  type="text"
                  value={logSearchQuery}
                  onChange={(event) => setLogSearchQuery(event.target.value)}
                  placeholder="Filter visible lines…"
                  className="flex-1 rounded-lg border px-3 py-2 text-[11px] bg-transparent outline-none"
                  style={{ borderColor: C.border, color: C.ink }}
                />
                <div className="text-[10px] font-mono shrink-0" style={s.mutedText}>
                  {logContent
                    ? logContent.truncated
                      ? `Tail ${logContent.lineCount} lines`
                      : `${logContent.lineCount} lines`
                    : 'No file'}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {!selectedLogSource ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    {!logCatalog ? (
                      <>
                        <div className="flex justify-center gap-1 mb-3">
                          <span className="os-thinking-dot" style={{ color: C.accent }} />
                          <span className="os-thinking-dot" style={{ color: C.accent }} />
                          <span className="os-thinking-dot" style={{ color: C.accent }} />
                        </div>
                        <p className="text-[13px]" style={s.mutedText}>Loading log sources…</p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                          <FileJson size={24} style={{ color: C.accent }} />
                        </div>
                        <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No log selected</h3>
                        <p className="text-[13px] max-w-sm" style={s.mutedText}>
                          Pick a relay runtime, app, or relay agent source from the left rail.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <LogPanel
                    title={selectedLogSource.title}
                    pathLabel={logContent?.pathLabel ?? selectedLogSource.pathLabel}
                    body={logContent?.body ?? null}
                    truncated={logContent?.truncated}
                    lineCount={logContent?.lineCount}
                    missing={logContent?.missing}
                    loading={logsLoading}
                    searchQuery={logSearchQuery}
                    updatedAtLabel={logContent?.updatedAtLabel}
                    minHeight={360}
                  />
                )}
                {logsFeedback ? (
                  <div className="text-[11px] leading-[1.5] mt-3" style={s.inkText}>{logsFeedback}</div>
                ) : null}
              </div>

              <div className="h-7 border-t flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
                <span className="text-[9px] font-mono" style={s.mutedText}>Canonical relay runtime, app, and relay agent log tails</span>
              </div>
            </div>
          </>

        /* --- INTER-AGENT --- */
        ) : activeView === 'inter-agent' ? (
          <>
            {!isCollapsed && (
              <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
                <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={handleMouseDown} />
                <div className="px-4 h-14 flex items-center justify-between border-b" style={{ borderBottomColor: C.border }}>
                  <div>
                    <h1 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>{interAgentState?.title ?? 'Inter-Agent'}</h1>
                    <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>
                      {rosterInterAgentAgents.length === interAgentAgents.length
                        ? interAgentState?.subtitle ?? 'Agent-to-agent traffic'
                        : `${rosterInterAgentAgents.length} visible · ${interAgentState?.subtitle ?? `${interAgentAgents.length} agents`}`}
                    </div>
                  </div>
                  <button className="p-1.5 rounded transition-opacity hover:opacity-70" style={s.mutedText} onClick={() => void handleRefreshShell()}>
                    <RefreshCw size={14} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-3">
                  <div className="mb-3 px-2">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1.5 px-2" style={s.mutedText}>Agents</div>
                    <div className="flex items-center justify-end gap-2 px-2 mb-2 relative">
                      <div className="relative">
                        <button
                          className="os-toolbar-button flex items-center gap-1 text-[10px] px-2 py-1 rounded"
                          style={{ color: C.ink }}
                          onClick={() => setAgentRosterMenu((current) => current === 'filter' ? null : 'filter')}
                          title="Filter roster"
                        >
                          <Filter size={11} />
                          <span style={s.mutedText}>{agentRosterFilterLabel(agentRosterFilter)}</span>
                        </button>
                        {agentRosterMenu === 'filter' ? (
                          <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border shadow-sm z-20" style={{ backgroundColor: C.surface, borderColor: C.border }}>
                            {([
                              ['all', 'All Agents'],
                              ['active', 'Active Only'],
                            ] as const).map(([value, label]) => (
                              <button
                                key={value}
                                className="w-full text-left px-3 py-2 text-[11px] transition-opacity hover:opacity-80"
                                style={value === agentRosterFilter ? s.activeItem : s.inkText}
                                onClick={() => {
                                  setAgentRosterFilter(value);
                                  setAgentRosterMenu(null);
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
                          onClick={() => setAgentRosterMenu((current) => current === 'sort' ? null : 'sort')}
                          title="Sort roster"
                        >
                          <ArrowUpDown size={11} />
                          <span style={s.mutedText}>{agentRosterSortLabel(agentRosterSort)}</span>
                        </button>
                        {agentRosterMenu === 'sort' ? (
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
                                style={value === agentRosterSort ? s.activeItem : s.inkText}
                                onClick={() => {
                                  setAgentRosterSort(value);
                                  setAgentRosterMenu(null);
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
                      {rosterInterAgentAgents.length > 0 ? rosterInterAgentAgents.map((agent) => {
                        const active = selectedInterAgentId === agent.id;
                        return (
                          <button
                            key={agent.id}
                            onClick={() => handleSelectInterAgent(agent.id)}
                            className="flex items-center gap-2 px-2 py-2 rounded text-[12px] transition-opacity w-full text-left"
                            style={active ? s.activeItem : s.mutedText}
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
                              ></div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate" style={s.inkText}>
                                {agent.title}
                                {(rosterAgentTitleCounts.get(agent.title) ?? 0) > 1 && agent.branch ? (
                                  <span className="font-normal ml-1 text-[10px]" style={s.mutedText}>{agent.branch}</span>
                                ) : null}
                              </div>
                              <div className="text-[10px] truncate" style={s.mutedText}>{agentRosterSecondaryText(agent, agentRosterSort)}</div>
                            </div>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={active ? s.activePill : s.tagBadge}>{agent.threadCount}</span>
                          </button>
                        );
                      }) : (
                        <div className="px-3 py-8 text-[12px] text-center" style={s.mutedText}>
                          No agents match this view yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="w-[336px] border-r shrink-0 overflow-hidden flex flex-col" style={{ ...s.surface, borderRightColor: C.border }}>
              <div className="px-4 h-14 border-b flex flex-col justify-center" style={{ borderBottomColor: C.border }}>
                <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Agent Threads</div>
                <div className="text-[12px] mt-1" style={s.inkText}>
                  {selectedInterAgent
                    ? `${selectedInterAgent.title} · ${visibleInterAgentThreads.length} thread${visibleInterAgentThreads.length === 1 ? '' : 's'}`
                    : 'Select an agent'}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {selectedInterAgent && visibleInterAgentThreads.length > 0 ? (
                  <div className="divide-y" style={{ borderColor: C.border }}>
                    {visibleInterAgentThreads.map((thread) => {
                      const active = selectedInterAgentThreadId === thread.id;
                      return (
                        <button
                          key={thread.id}
                          onClick={() => setSelectedInterAgentThreadId(thread.id)}
                          className="w-full text-left px-4 py-3.5 transition-opacity hover:opacity-90"
                          style={active ? { backgroundColor: C.bg } : undefined}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium truncate" style={s.inkText}>
                                {interAgentThreadTitleForAgent(thread, selectedInterAgentId)}
                              </div>
                              <div className="mt-1">
                                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={thread.sourceKind === 'private' ? s.tagBadge : s.activePill}>
                                  {thread.sourceKind === 'private' ? 'Private' : 'Relay'}
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono shrink-0" style={s.mutedText}>
                              {thread.timestampLabel ?? ''}
                            </span>
                          </div>
                          <div className="text-[10px] mb-1.5 truncate" style={s.mutedText}>
                            {interAgentThreadSubtitle(thread, selectedInterAgentId)}
                          </div>
                          <div className="text-[12px] leading-[1.45] line-clamp-2" style={s.mutedText}>
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
                      <div className="text-[14px] font-medium mb-1" style={s.inkText}>No agent threads</div>
                      <div className="text-[12px]" style={s.mutedText}>
                        {selectedInterAgent ? `No inter-agent traffic for ${selectedInterAgent.title} yet.` : 'Pick an agent to inspect its thread network.'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col relative min-w-0" style={s.surface}>
              <div className="border-b flex items-center justify-between px-4 h-14 shrink-0 gap-4" style={{ ...s.surface, borderBottomColor: C.border }}>
                <div className="flex items-center gap-2 min-w-0">
                  <InterAgentIcon size={14} style={s.mutedText} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="text-[13px] font-semibold tracking-tight truncate" style={s.inkText}>{interAgentThreadTitle}</h2>
                      {selectedInterAgentThread ? (
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0" style={selectedInterAgentThread.sourceKind === 'private' ? s.tagBadge : s.activePill}>
                          {selectedInterAgentThread.sourceKind === 'private' ? 'Private' : 'Relay'}
                        </span>
                      ) : null}
                      {selectedInterAgentThread ? (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={s.tagBadge}>
                          {selectedInterAgentThread.messageCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={s.mutedText}>
                      {selectedInterAgentThreadSubtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedRelayDirectThread ? (
                    <button
                      className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                      onClick={() => openAgentProfile(selectedRelayDirectThread.id)}
                    >
                      <Bot size={11} />
                      <span>Agent</span>
                    </button>
                  ) : null}
                  <button
                    onClick={() => setShowAnnotations(!showAnnotations)}
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                    style={showAnnotations ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
                  >
                    Annotations <span className="font-mono uppercase">{showAnnotations ? 'On' : 'Off'}</span>
                  </button>
                  {interAgentMessageTarget ? (
                    <button
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                      onClick={() => openAgentDirectMessage(interAgentMessageTarget.id)}
                      title={`Open direct chat with ${interAgentMessageTarget.title}`}
                    >
                      Message
                    </button>
                  ) : null}
                  {interAgentConfigureTarget ? (
                    <button
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                      onClick={() => openAgentSettings(interAgentConfigureTarget.id, interAgentConfigureTarget.profileKind === 'project')}
                      title={interAgentConfigureTarget.profileKind === 'project'
                        ? `Configure ${interAgentConfigureTarget.title}`
                        : `Open ${interAgentConfigureTarget.title} profile`}
                    >
                      {interAgentConfigureLabel}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
                {!selectedInterAgent ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <InterAgentIcon size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No agent selected</h3>
                    <p className="text-[13px] max-w-sm" style={s.mutedText}>
                      Choose an agent from the left rail to inspect their traffic with other agents.
                    </p>
                  </div>
                ) : !selectedInterAgentThread ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <MessageSquare size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No thread selected</h3>
                    <p className="text-[13px] max-w-sm" style={s.mutedText}>
                      Pick one of {selectedInterAgent.title}&apos;s agent threads to read it.
                    </p>
                  </div>
                ) : visibleInterAgentMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <MessageSquare size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>Thread is quiet</h3>
                    <p className="text-[13px] max-w-sm" style={s.mutedText}>
                      This agent thread exists, but there are no visible messages in it yet.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <RelayTimeline
                      messages={visibleInterAgentMessages}
                      showAnnotations={showAnnotations}
                      showStatusMessages={false}
                      inkStyle={s.inkText}
                      mutedStyle={s.mutedText}
                      tagStyle={s.tagBadge}
                      annotStyle={s.annotBadge}
                      agentLookup={interAgentAgentLookup}
                      directThreadLookup={relayDirectLookup}
                      onOpenAgentProfile={openAgentProfile}
                      onOpenAgentChat={openAgentDirectMessage}
                      onNudgeMessage={handleNudgeMessage}
                    />
                  </div>
                )}
              </div>

              <div className="h-7 border-t flex items-center px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
                <span className="text-[9px] font-mono" style={s.mutedText}>Read-only monitor over inter-agent traffic</span>
              </div>
            </div>
          </>

        /* --- SESSIONS --- */
        ) : activeView === 'sessions' ? (
          <>
            {/* Main Sessions Area */}
            <div className="flex-1 flex flex-col relative min-w-0" style={s.surface}>
              <div className="h-10 border-b flex items-center justify-between px-4 shrink-0" style={{ ...s.surface, borderBottomColor: C.border }}>
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="min-w-0 shrink-0">
                    <div className="text-[13px] font-semibold tracking-tight" style={s.inkText}>Sessions</div>
                    <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>
                      {searchQuery ? `${filteredSessions.length} results` : `${stats.totalSessions} total`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Search size={14} style={s.mutedText} />
                    <input
                      type="text"
                      placeholder="Search sessions by title, content, tags, or agent..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none text-[12px]"
                      style={{ color: C.ink }}
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="hover:opacity-70" style={s.mutedText}><X size={14} /></button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="p-1.5 rounded transition-opacity hover:opacity-70" style={s.mutedText} onClick={() => void handleRefreshShell()}>
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {isLoadingShell && !shellState ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-3">
                      <Spinner className="text-[28px]" style={{ color: C.accent }} />
                      <span className="text-[13px]" style={s.mutedText}>Loading broker workspace…</span>
                    </div>
                  </div>
                ) : filteredSessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <FolderOpen size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No sessions found</h3>
                    <p className="text-[13px] max-w-sm" style={s.mutedText}>
                      {searchQuery ? 'Try adjusting your search query' : 'No conversations are in the broker yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: C.border }}>
                    {filteredSessions.map(session => (
                      <button
                        key={session.id}
                        onClick={() => setSelectedSession(session)}
                        draggable
                        onDragStart={() => {
                          setDraggedSessionId(session.id);
                          setDraggedPhoneSection(null);
                        }}
                        onDragEnd={() => {
                          setDraggedSessionId(null);
                          setDraggedPhoneSection(null);
                        }}
                        className="w-full text-left px-4 py-3 transition-opacity hover:opacity-90"
                        style={selectedSession?.id === session.id ? { backgroundColor: C.bg } : undefined}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-5 h-5 rounded text-white flex items-center justify-center text-[9px] font-bold"
                              style={{ backgroundColor: colorForIdentity(session.agent) }}
                            >
                              {session.agent.charAt(0)}
                            </div>
                            <span className="text-[13px] font-medium line-clamp-1" style={s.inkText}>{session.title}</span>
                            {phonePreparationState.favorites.includes(session.id) && (
                              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium" style={{ backgroundColor: C.accentBg, color: C.accent }}>
                                <Star size={9} />
                                Fav
                              </span>
                            )}
                            {!phonePreparationState.favorites.includes(session.id) && phonePreparationState.quickHits.includes(session.id) && (
                              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium" style={{ backgroundColor: C.tagBg, color: C.ink }}>
                                <Smartphone size={9} />
                                My List
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono shrink-0 ml-2" style={s.mutedText}>{formatDate(session.lastModified)}</span>
                        </div>
                        <div className="flex items-center gap-2 mb-1.5 pl-7">
                          <span className="text-[10px] font-mono" style={s.mutedText}>{session.project}</span>
                          <span className="w-px h-3" style={{ backgroundColor: C.border }}></span>
                          <span className="text-[10px]" style={s.mutedText}>{session.messageCount} messages</span>
                          {session.tokens && (
                            <>
                              <span className="w-px h-3" style={{ backgroundColor: C.border }}></span>
                              <span className="text-[10px]" style={s.mutedText}>{(session.tokens / 1000).toFixed(1)}k tokens</span>
                            </>
                          )}
                        </div>
                        <p className="text-[12px] line-clamp-1 pl-7" style={s.mutedText}>{session.preview}</p>
                        {session.tags && session.tags.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-2 pl-7">
                            {session.tags.slice(0, 3).map(tag => (
                              <span key={tag} className="text-[9px] font-mono border px-1.5 py-0.5 rounded" style={s.tagBadge}>{tag}</span>
                            ))}
                            {session.tags.length > 3 && <span className="text-[9px]" style={s.mutedText}>+{session.tags.length - 3}</span>}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="h-7 border-t flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
                <span className="text-[9px] font-mono" style={s.mutedText}>Drag sessions into My List or click one for quick actions.</span>
                <span className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>Index Ready</span>
              </div>
            </div>

            <div className="w-80 border-l shrink-0 overflow-y-auto flex flex-col" style={{ ...s.surface, borderLeftColor: C.border }}>
              <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={s.mutedText}>My List</div>
                        <div className="text-[12px] font-medium" style={s.inkText}>My List first, then browse and search.</div>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearPhoneQuickHits}
                    disabled={phonePreparationSaving || phonePreparationState.quickHits.length === 0}
                    className="rounded px-2 py-1 text-[10px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ backgroundColor: C.bg, color: C.ink, border: `1px solid ${C.border}` }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col gap-4">
                {phonePreparationLoading ? (
                  <div className="flex items-center gap-2 text-[12px]" style={s.mutedText}>
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
                        handleDropIntoFavorites();
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <Star size={12} style={{ color: C.accent }} />
                          <div className="text-[11px] font-semibold" style={s.inkText}>Favorites</div>
                        </div>
                        <div className="text-[10px] font-mono" style={s.mutedText}>{favoritePhoneSessions.length}</div>
                      </div>
                      {favoritePhoneSessions.length === 0 ? (
                        <div className="rounded border border-dashed px-3 py-4 text-[11px]" style={{ borderColor: C.border, color: C.muted }}>
                          Drop sessions here to keep them pinned in your list.
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {favoritePhoneSessions.map((session) => (
                            <div
                              key={`favorite-${session.id}`}
                              draggable
                              onDragStart={() => {
                                setDraggedSessionId(session.id);
                                setDraggedPhoneSection('favorites');
                              }}
                              onDragEnd={() => {
                                setDraggedSessionId(null);
                                setDraggedPhoneSection(null);
                              }}
                              className="rounded border px-3 py-2"
                              style={{ borderColor: C.border, backgroundColor: C.surface }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[12px] font-medium line-clamp-1" style={s.inkText}>{session.title}</div>
                                  <div className="text-[10px] mt-1" style={s.mutedText}>{session.project} · {formatDate(session.lastModified)}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSessionFromPhoneSection(session.id, 'favorites')}
                                  className="text-[10px] hover:opacity-70"
                                  style={s.mutedText}
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
                        handleDropIntoQuickHits();
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <List size={12} style={{ color: C.accent }} />
                          <div className="text-[11px] font-semibold" style={s.inkText}>My List</div>
                        </div>
                        <div className="text-[10px] font-mono" style={s.mutedText}>{quickHitPhoneSessions.length}</div>
                      </div>
                      {quickHitPhoneSessions.length === 0 ? (
                        <div className="rounded border border-dashed px-3 py-4 text-[11px]" style={{ borderColor: C.border, color: C.muted }}>
                          Drag sessions here and order them however you want.
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {quickHitPhoneSessions.map((session, index) => (
                            <div
                              key={`quick-hit-${session.id}`}
                              draggable
                              onDragStart={() => {
                                setDraggedSessionId(session.id);
                                setDraggedPhoneSection('quickHits');
                              }}
                              onDragEnd={() => {
                                setDraggedSessionId(null);
                                setDraggedPhoneSection(null);
                              }}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                handleDropIntoQuickHits(index);
                              }}
                              className="rounded border px-3 py-2"
                              style={{ borderColor: C.border, backgroundColor: C.surface }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-mono mb-1" style={s.mutedText}>#{index + 1}</div>
                                  <div className="text-[12px] font-medium line-clamp-1" style={s.inkText}>{session.title}</div>
                                  <div className="text-[10px] mt-1" style={s.mutedText}>{session.project} · {formatDate(session.lastModified)}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSessionFromPhoneSection(session.id, 'quickHits')}
                                  className="text-[10px] hover:opacity-70"
                                  style={s.mutedText}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {phonePreparationFeedback && (
                      <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: C.border, backgroundColor: C.surface, color: C.ink }}>
                        {phonePreparationFeedback}
                      </div>
                    )}

                    <div className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>Selected Session</div>
                      {selectedSession ? (
                        <>
                          <div className="flex items-center gap-2 mb-3">
                            <div
                              className="w-8 h-8 rounded text-white flex items-center justify-center text-[12px] font-bold"
                              style={{ backgroundColor: colorForIdentity(selectedSession.agent) }}
                            >
                              {selectedSession.agent.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium line-clamp-1" style={s.inkText}>{selectedSession.title}</div>
                              <div className="text-[10px]" style={s.mutedText}>{selectedSession.project} · {selectedSession.messageCount} messages</div>
                            </div>
                          </div>
                          <p className="text-[11px] leading-relaxed mb-3" style={s.mutedText}>{selectedSession.preview}</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleAddSessionToPhoneSection(selectedSession.id, 'favorites')}
                              disabled={phonePreparationSaving || phonePreparationState.favorites.includes(selectedSession.id)}
                              className="flex-1 rounded px-3 py-2 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                              style={{ backgroundColor: C.accentBg, color: C.accent }}
                            >
                              {phonePreparationState.favorites.includes(selectedSession.id) ? 'Pinned' : 'Add to Favorites'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddSessionToPhoneSection(selectedSession.id, 'quickHits')}
                              disabled={phonePreparationSaving || phonePreparationState.quickHits.includes(selectedSession.id) || phonePreparationState.favorites.includes(selectedSession.id)}
                              className="flex-1 rounded px-3 py-2 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                              style={{ backgroundColor: C.surface, color: C.ink, border: `1px solid ${C.border}` }}
                            >
                              {phonePreparationState.quickHits.includes(selectedSession.id) || phonePreparationState.favorites.includes(selectedSession.id)
                                ? 'Already Added'
                                : 'Add to My List'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="text-[11px]" style={s.mutedText}>
                          Select a session to pin it or add it to My List.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>

        /* --- MESSAGES --- */
        ) : activeView === 'messages' || activeView === 'relay' ? (
          <MessagesView
            sidebarWidth={sidebarWidth}
            messagesDetailWidth={messagesDetailWidth}
            isCollapsed={isCollapsed}
            onResizeStart={handleMouseDown}
            onMessagesDetailResizeStart={handleMessagesDetailResizeStart}
            styles={{
              sidebar: s.sidebar,
              surface: s.surface,
              inkText: s.inkText,
              mutedText: s.mutedText,
              tagBadge: s.tagBadge,
              annotBadge: s.annotBadge,
              activeItem: s.activeItem,
              activePill: s.activePill,
              kbd: s.kbd,
            }}
            messagesState={messagesState}
            messageThreads={messageThreads}
            selectedMessagesThread={selectedMessagesThread}
            onSelectMessageThread={selectMessageThread}
            showAnnotations={showAnnotations}
            setShowAnnotations={setShowAnnotations}
            onRefresh={() => void handleRefreshShell()}
            selectedMessagesInternalThread={selectedMessagesInternalThread}
            selectedMessagesInternalMessages={selectedMessagesInternalMessages}
            selectedMessagesInternalTarget={selectedMessagesInternalTarget}
            selectedMessagesDetailAgentId={selectedMessagesDetailAgentId}
            selectedMessagesDetailAgent={selectedMessagesDetailAgent}
            selectedMessagesSessions={selectedMessagesSessions}
            selectedSession={selectedSession}
            setSelectedSession={setSelectedSession}
            formatDate={formatDate}
            interAgentAgents={interAgentAgents}
            interAgentAgentLookup={interAgentAgentLookup}
            relayDirectLookup={relayDirectLookup}
            openAgentProfile={openAgentProfile}
            openAgentDirectMessage={openAgentDirectMessage}
            onNudgeMessage={handleNudgeMessage}
            messagesDetailOpen={messagesDetailOpen}
            setMessagesDetailOpen={setMessagesDetailOpen}
            messagesDetailTab={messagesDetailTab}
            setMessagesDetailTab={setMessagesDetailTab}
            selectedRelayKind={selectedRelayKind}
            selectedRelayId={selectedRelayId}
            relayThreadTitle={relayThreadTitle}
            relayThreadSubtitle={relayThreadSubtitle}
            relayThreadCount={relayThreadCount}
            selectedRelayDirectThread={selectedRelayDirectThread}
            relayVoiceState={relayState?.voice}
            visibleRelayMessages={visibleRelayMessages}
            relayTimelineViewportRef={relayTimelineViewportRef}
            onRelayTimelineScroll={handleRelayTimelineScroll}
            relayReplyTarget={relayReplyTarget}
            setRelayReplyTarget={setRelayReplyTarget}
            relayContextReferences={relayContextReferences}
            relayContextMessageIds={relayContextMessageIds}
            setRelayContextMessageIds={setRelayContextMessageIds}
            relayComposerRef={relayComposerRef}
            relayDraft={relayDraft}
            setRelayDraft={setRelayDraft}
            relaySending={relaySending}
            relayFeedback={relayFeedback}
            relayComposerSelectionStart={relayComposerSelectionStart}
            setRelayComposerSelectionStart={setRelayComposerSelectionStart}
            mergedRelayMessages={mergedRelayMessages}
            relayMentionMenuOpen={relayMentionMenuOpen}
            relayMentionSuggestions={relayMentionSuggestions}
            relayMentionSelectionIndex={relayMentionSelectionIndex}
            setRelayMentionSelectionIndex={setRelayMentionSelectionIndex}
            relayMentionDuplicateTitleCounts={relayMentionDuplicateTitleCounts}
            applyRelayMentionSuggestion={applyRelayMentionSuggestion}
            onRelaySend={() => void handleRelaySend()}
            onToggleVoiceCapture={() => void handleToggleVoiceCapture()}
            onSetVoiceRepliesEnabled={(enabled) => void handleSetVoiceRepliesEnabled(enabled)}
            visibleAgentSession={visibleAgentSession}
            agentSessionPending={agentSessionPending}
            agentSessionFeedback={agentSessionFeedback}
            agentSessionCopied={agentSessionCopied}
            onCopyAgentSessionCommand={() => void handleCopyAgentSessionCommand()}
            onOpenAgentSession={() => void handleOpenAgentSession()}
            onPeekAgentSession={handlePeekAgentSession}
            onOpenAgentSettings={openAgentSettings}
            desktopVoiceEnabled={desktopFeatures.voice}
          />
        ) : null}
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
          onRevealPath={(filePath) => void scoutDesktop?.revealPath?.(filePath)}
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

