"use client";

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpDown,
  Copy,
  Bot,
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
  PenTool,
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
  FileJson,
  Tag,
  Calendar,
  Folder,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  AtSign,
  Loader2,
  Mic,
  Reply,
  Send,
  Smartphone,
  Star,
  Sun,
  Moon,
  Eye,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderSVG } from 'uqr';
import MachinesView from "@/components/machines-view";
import PlansView from "@/components/plans-view";
import { Button } from "@/components/ui/button";
import type {
  AgentSessionInspector,
  AgentConfigState,
  AppSettingsState,
  BrokerControlAction,
  DesktopBrokerInspector,
  DispatchState,
  DesktopLogCatalog,
  DesktopLogContent,
  DesktopLogSource,
  DesktopShellState,
  InterAgentAgent,
  InterAgentThread,
  OnboardingCommandName,
  OnboardingCommandResult,
  PhonePreparationState,
  RelayDirectThread,
  RelayDestinationKind,
  RelayMessage,
  RelayNavItem,
  SessionMetadata,
  UpdateDispatchConfigInput,
} from "@/lib/openscout-desktop";

// Semantic CSS variable shortcuts as inline style helpers
const C = {
  bg:        'var(--os-bg)',
  surface:   'var(--os-surface)',
  border:    'var(--os-border)',
  ink:       'var(--os-ink)',
  muted:     'var(--os-muted)',
  accent:    'var(--os-accent)',
  accentBg:  'var(--os-accent-bg)',
  accentBorder: 'var(--os-accent-border)',
  tagBg:     'var(--os-tag-bg)',
  logoBg:    'var(--os-logo-bg)',
  logoBorder:'var(--os-logo-border)',
  termBg:    'var(--os-terminal-bg)',
  termFg:    'var(--os-terminal-fg)',
  markBg:    'var(--os-mark-bg)',
  markFg:    'var(--os-mark-fg)',
};

type AgentRosterFilterMode = 'all' | 'active';
type AgentRosterSortMode = 'chat' | 'code' | 'session' | 'alpha';
type PendingRelayMessage = {
  clientMessageId: string;
  message: RelayMessage;
};

type OnboardingWizardStepId = 'welcome' | 'source-roots' | 'harness' | 'confirm' | 'init' | 'doctor' | 'runtimes';

type ComposerRelayReference = {
  messageId: string;
  authorName: string;
  preview: string;
};

const ONBOARDING_WIZARD_STEP_ORDER: OnboardingWizardStepId[] = [
  'welcome',
  'source-roots',
  'harness',
  'confirm',
  'init',
  'doctor',
  'runtimes',
];

const SOURCE_ROOT_PATH_SUGGESTIONS = ['~/dev', '~/src', '~/code'];

function dispatchStatesMeaningfullyEqual(left: DispatchState | null, right: DispatchState | null) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }

  return left.status === right.status
    && left.statusLabel === right.statusLabel
    && left.statusDetail === right.statusDetail
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

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [productSurface, setProductSurface] = useState<'relay' | 'dispatch'>('relay');
  const [activeView, setActiveView] = useState<'overview' | 'activity' | 'machines' | 'plans' | 'sessions' | 'search' | 'relay' | 'inter-agent' | 'agents' | 'logs' | 'settings'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionMetadata | null>(null);
  const [phonePreparation, setPhonePreparation] = useState<PhonePreparationState | null>(null);
  const [phonePreparationLoading, setPhonePreparationLoading] = useState(false);
  const [phonePreparationSaving, setPhonePreparationSaving] = useState(false);
  const [phonePreparationFeedback, setPhonePreparationFeedback] = useState<string | null>(null);
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [draggedPhoneSection, setDraggedPhoneSection] = useState<'favorites' | 'quickHits' | null>(null);
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [isLoadingShell, setIsLoadingShell] = useState(true);
  const [shellError, setShellError] = useState<string | null>(null);
  const [dispatchState, setDispatchState] = useState<DispatchState | null>(null);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchControlPending, setDispatchControlPending] = useState(false);
  const [dispatchConfigPending, setDispatchConfigPending] = useState(false);
  const [dispatchConfigFeedback, setDispatchConfigFeedback] = useState<string | null>(null);
  const [selectedRelayKind, setSelectedRelayKind] = useState<RelayDestinationKind>('channel');
  const [selectedRelayId, setSelectedRelayId] = useState('shared');
  const [relayDraft, setRelayDraft] = useState('');
  const [relaySending, setRelaySending] = useState(false);
  const [relayFeedback, setRelayFeedback] = useState<string | null>(null);
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
  const [agentRosterFilter, setAgentRosterFilter] = useState<AgentRosterFilterMode>('all');
  const [agentRosterSort, setAgentRosterSort] = useState<AgentRosterSortMode>('chat');
  const [agentRosterMenu, setAgentRosterMenu] = useState<null | 'filter' | 'sort'>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfigState | null>(null);
  const [agentConfigDraft, setAgentConfigDraft] = useState<AgentConfigState | null>(null);
  const [agentConfigLoading, setAgentConfigLoading] = useState(false);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigRestarting, setAgentConfigRestarting] = useState(false);
  const [agentConfigFeedback, setAgentConfigFeedback] = useState<string | null>(null);
  const [pendingConfigFocusAgentId, setPendingConfigFocusAgentId] = useState<string | null>(null);
  const [isAgentConfigEditing, setIsAgentConfigEditing] = useState(false);
  const [agentSession, setAgentSession] = useState<AgentSessionInspector | null>(null);
  const [agentSessionLoading, setAgentSessionLoading] = useState(false);
  const [agentSessionFeedback, setAgentSessionFeedback] = useState<string | null>(null);
  const [agentSessionCopied, setAgentSessionCopied] = useState(false);
  const [agentSessionRefreshTick, setAgentSessionRefreshTick] = useState(0);
  const [isAgentSessionPeekOpen, setIsAgentSessionPeekOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettingsState | null>(null);
  const [appSettingsDraft, setAppSettingsDraft] = useState<AppSettingsState | null>(null);
  const [appSettingsLoading, setAppSettingsLoading] = useState(false);
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);
  const [appSettingsFeedback, setAppSettingsFeedback] = useState<string | null>(null);
  const [isAppSettingsEditing, setIsAppSettingsEditing] = useState(false);
  const [onboardingWizardStep, setOnboardingWizardStep] = useState<OnboardingWizardStepId>('welcome');
  const [onboardingCommandPending, setOnboardingCommandPending] = useState<OnboardingCommandName | null>(null);
  const [onboardingCommandResult, setOnboardingCommandResult] = useState<OnboardingCommandResult | null>(null);
  const [onboardingCopiedCommand, setOnboardingCopiedCommand] = useState<OnboardingCommandName | null>(null);
  const [startupOnboardingState, setStartupOnboardingState] = useState<'checking' | 'active' | 'done'>('checking');
  const [settingsSection, setSettingsSection] = useState<'profile' | 'agents' | 'communication' | 'database' | 'appearance'>('profile');
  const [logCatalog, setLogCatalog] = useState<DesktopLogCatalog | null>(null);
  const [selectedLogSourceId, setSelectedLogSourceId] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<DesktopLogContent | null>(null);
  const [brokerInspector, setBrokerInspector] = useState<DesktopBrokerInspector | null>(null);
  const [brokerControlPending, setBrokerControlPending] = useState(false);
  const [brokerControlFeedback, setBrokerControlFeedback] = useState<string | null>(null);
  const [pendingBrokerInspectorFocus, setPendingBrokerInspectorFocus] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsFeedback, setLogsFeedback] = useState<string | null>(null);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logSourceQuery, setLogSourceQuery] = useState('');
  const [logsRefreshTick, setLogsRefreshTick] = useState(0);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [dark, setDark] = useState(false);
  const isDragging = useRef(false);
  const relayComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const agentRuntimePathRef = useRef<HTMLInputElement | null>(null);
  const agentSystemPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const agentSystemPromptViewRef = useRef<HTMLDivElement | null>(null);
  const agentSessionInlineViewportRef = useRef<HTMLElement | null>(null);
  const agentSessionPeekViewportRef = useRef<HTMLElement | null>(null);
  const agentSessionInlineStickToBottomRef = useRef(true);
  const agentSessionPeekStickToBottomRef = useRef(true);
  const settingsOperatorNameRef = useRef<HTMLInputElement | null>(null);
  const relayServiceInspectorRef = useRef<HTMLElement | null>(null);
  const shellStateLoadInFlightRef = useRef(false);
  const startupOnboardingCheckedRef = useRef(false);
  const commitDispatchState = React.useCallback((nextState: DispatchState) => {
    setDispatchState((current) => dispatchStatesMeaningfullyEqual(current, nextState) ? current : nextState);
  }, []);

  const sessions = shellState?.sessions ?? [];
  const machinesState = shellState?.machines ?? null;
  const plansState = shellState?.plans ?? null;
  const runtime = shellState?.runtime ?? null;
  const relayState = shellState?.relay ?? null;
  const interAgentState = shellState?.interAgent ?? null;

  const loadShellState = React.useCallback(async (withSpinner = false) => {
    if (!window.openScoutDesktop) {
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
      const nextState = await window.openScoutDesktop.getShellState();
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
  }, []);

  const completeOnboardingIntoRelay = React.useCallback((nextShellState: DesktopShellState | null) => {
    setProductSurface('relay');
    if (nextShellState?.runtime?.brokerReachable) {
      setActiveView('relay');
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
    if (!selectedInterAgentId || !window.openScoutDesktop?.getAgentConfig) {
      setAgentConfig(null);
      setAgentConfigDraft(null);
      setAgentConfigFeedback(null);
      return;
    }

    let cancelled = false;
    const loadAgentConfig = async () => {
      setAgentConfigLoading(true);
      try {
        const nextConfig = await window.openScoutDesktop!.getAgentConfig(selectedInterAgentId);
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
    if (activeView !== 'agents' || !selectedInterAgentId || !window.openScoutDesktop?.getAgentSession) {
      setAgentSession(null);
      setAgentSessionFeedback(null);
      setAgentSessionCopied(false);
      return;
    }

    let cancelled = false;
    const loadAgentSession = async () => {
      setAgentSessionLoading((current) => current || !agentSession);
      try {
        const nextSession = await window.openScoutDesktop!.getAgentSession(selectedInterAgentId);
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
  }, [activeView, agentSessionRefreshTick, selectedInterAgentId]);

  useEffect(() => {
    setAgentSessionFeedback(null);
    setAgentSessionCopied(false);
  }, [selectedInterAgentId]);

  useEffect(() => {
    if (activeView !== 'agents') {
      setIsAgentSessionPeekOpen(false);
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView !== 'agents' || !isAgentSessionPeekOpen || !selectedInterAgentId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setAgentSessionRefreshTick((current) => current + 1);
    }, 1600);

    return () => window.clearInterval(intervalId);
  }, [activeView, isAgentSessionPeekOpen, selectedInterAgentId]);

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
    if (activeView !== 'settings' || !window.openScoutDesktop?.getAppSettings) {
      return;
    }

    let cancelled = false;
    const loadAppSettings = async () => {
      setAppSettingsLoading(true);
      try {
        const nextSettings = await window.openScoutDesktop!.getAppSettings();
        if (cancelled) {
          return;
        }
        setAppSettings(nextSettings);
        setAppSettingsDraft(nextSettings);
        if (startupOnboardingState === 'active' && nextSettings.onboarding.needed) {
          setAppSettingsFeedback('OpenScout needs a quick first-run setup. Answer the wizard one step at a time, save the inputs, then run init, doctor, and runtimes from this screen.');
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
        if (startupOnboardingState === 'checking') {
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
  }, [activeView, completeOnboardingIntoRelay, shellState, startupOnboardingState]);

  useEffect(() => {
    if (startupOnboardingCheckedRef.current) {
      return;
    }

    startupOnboardingCheckedRef.current = true;
    let cancelled = false;

    if (!window.openScoutDesktop?.getAppSettings) {
      setStartupOnboardingState('done');
      return () => {
        cancelled = true;
      };
    }

    const checkOnboarding = async () => {
      try {
        const nextSettings = await window.openScoutDesktop!.getAppSettings();
        if (cancelled) {
          return;
        }
        setAppSettings((current) => current ?? nextSettings);
        setAppSettingsDraft((current) => current ?? nextSettings);
        if (nextSettings.onboarding.needed) {
          setAppSettingsFeedback('OpenScout needs a quick first-run setup. Answer the wizard one step at a time, save the inputs, then run init, doctor, and runtimes from this screen.');
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
    if (activeView !== 'sessions' || !window.openScoutDesktop?.getPhonePreparation) {
      return;
    }

    let cancelled = false;
    const loadPhonePreparation = async () => {
      setPhonePreparationLoading(true);
      try {
        const nextState = await window.openScoutDesktop!.getPhonePreparation();
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
  }, [activeView]);

  useEffect(() => {
    if (activeView !== 'logs' || !window.openScoutDesktop?.getLogCatalog || !window.openScoutDesktop?.readLogSource) {
      return;
    }

    let cancelled = false;
    const loadLogs = async () => {
      setLogsLoading(true);
      try {
        const nextCatalog = await window.openScoutDesktop!.getLogCatalog();
        if (cancelled) {
          return;
        }
        setLogCatalog(nextCatalog);
        const nextSourceId = nextCatalog.sources.some((source) => source.id === selectedLogSourceId)
          ? selectedLogSourceId
          : nextCatalog.defaultSourceId ?? nextCatalog.sources[0]?.id ?? null;
        setSelectedLogSourceId(nextSourceId);
        if (!nextSourceId) {
          setLogContent(null);
          setLogsFeedback('No log sources available.');
          return;
        }
        const nextContent = await window.openScoutDesktop!.readLogSource({ sourceId: nextSourceId, tailLines: 240 });
        if (cancelled) {
          return;
        }
        setLogContent(nextContent);
        setLogsFeedback(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLogContent(null);
        setLogsFeedback(asErrorMessage(error));
      } finally {
        if (!cancelled) {
          setLogsLoading(false);
        }
      }
    };

    void loadLogs();
    return () => {
      cancelled = true;
    };
  }, [activeView, selectedLogSourceId, logsRefreshTick]);

  useEffect(() => {
    if (productSurface !== 'dispatch' || !window.openScoutDesktop?.getDispatchState) {
      return;
    }

    let cancelled = false;
    const loadDispatchState = async (options?: { showLoading?: boolean }) => {
      if (options?.showLoading) {
        setDispatchLoading(true);
      }
      try {
        const nextState = await window.openScoutDesktop!.getDispatchState();
        if (cancelled) {
          return;
        }
        commitDispatchState(nextState);
        setDispatchError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setDispatchError(asErrorMessage(error));
      } finally {
        if (!cancelled) {
          setDispatchLoading(false);
        }
      }
    };

    void loadDispatchState({ showLoading: !dispatchState });
    const intervalId = window.setInterval(() => {
      void loadDispatchState();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [commitDispatchState, dispatchState, productSurface]);

  useEffect(() => {
    if (activeView !== 'settings' || settingsSection !== 'communication' || !window.openScoutDesktop?.getBrokerInspector) {
      return;
    }

    let cancelled = false;
    const loadRelayInspector = async () => {
      try {
        const nextInspector = await window.openScoutDesktop!.getBrokerInspector();
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
    if (activeView !== 'agents' || !selectedInterAgentId) {
      return;
    }

    const interval = window.setInterval(() => {
      setAgentSessionRefreshTick((current) => current + 1);
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeView, selectedInterAgentId]);

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
    if (activeView !== 'relay' || pendingRelayComposerFocusTick === 0) {
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

    const target = agentRuntimePathRef.current ?? agentSystemPromptRef.current ?? agentSystemPromptViewRef.current;
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
    if (!window.openScoutDesktop?.updatePhonePreparation) {
      setPhonePreparationFeedback('Phone preparation is unavailable in this build.');
      return;
    }

    const previous = phonePreparation;
    setPhonePreparation(nextState);
    setPhonePreparationSaving(true);
    try {
      const saved = await window.openScoutDesktop.updatePhonePreparation(nextState);
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
  }, [phonePreparation]);

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

  const relayFeedItems = useMemo(() => buildRelayFeedItems(relayState), [relayState]);
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
  const relayThreadSubtitle = selectedRelayDirectThread?.state === 'working'
    ? null
    : selectedRelayDirectThread?.statusDetail
      ?? selectedRelayDirectThread?.subtitle
      ?? relayCurrentDestination?.subtitle
      ?? null;
  const relaySelectionIsFeed = relayFeedItems.some(
    (item) => item.kind === selectedRelayKind && item.id === selectedRelayId,
  );
  const interAgentAgents = interAgentState?.agents ?? [];
  const interAgentThreads = interAgentState?.threads ?? [];
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

      const relatedThreadMessageIds = new Set(
        visibleInterAgentThreads.flatMap((thread) => thread.messageIds),
      );

      return mergedRelayMessages
        .filter((message) => (
          relatedThreadMessageIds.has(message.id)
          || message.authorId === selectedInterAgent.id
          || message.recipients.includes(selectedInterAgent.id)
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
  const visibleAgentSession = agentSession?.agentId === selectedInterAgent?.id ? agentSession : null;
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
  const appSettingsDirty = useMemo(
    () => serializeAppSettings(appSettingsDraft) !== serializeAppSettings(appSettings),
    [appSettingsDraft, appSettings],
  );
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
      detail: 'Tell OpenScout what to call you before the rest of setup begins.',
      complete: onboardingStepCompletion.get('welcome') ?? false,
    },
    {
      id: 'source-roots' as const,
      number: '02',
      title: 'Choose a source root',
      detail: 'Pick the parent folder that contains your repos so OpenScout can discover projects automatically.',
      complete: onboardingStepCompletion.get('source-roots') ?? false,
    },
    {
      id: 'harness' as const,
      number: '03',
      title: 'Choose a default harness',
      detail: 'This is the assistant family OpenScout should prefer when a project does not pin one of its own.',
      complete: onboardingStepCompletion.get('harness') ?? false,
    },
    {
      id: 'confirm' as const,
      number: '04',
      title: 'Confirm your local setup',
      detail: 'Review the onboarding choices before OpenScout saves them locally and moves into the command steps.',
      complete: onboardingStepCompletion.get('confirm') ?? false,
    },
    {
      id: 'init' as const,
      number: '05',
      title: 'Run init',
      detail: 'See how your chosen Relay context root becomes a local project manifest and how that feeds discovery.',
      complete: onboardingStepCompletion.get('init') ?? false,
    },
    {
      id: 'doctor' as const,
      number: '06',
      title: 'Run doctor',
      detail: 'See how OpenScout combines broker health, source roots, and project manifests into one inventory view.',
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
    const sourceRootArgs = command === 'init'
      ? (visibleAppSettings?.workspaceRoots ?? []).map((root) => ` --source-root ${root}`).join('')
      : '';
    return `scout ${command}${contextRootArg}${sourceRootArgs}`;
  }, [onboardingContextRoot, visibleAppSettings?.workspaceRoots]);
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
    () => [...projects]
      .sort((lhs, rhs) => rhs.count - lhs.count || new Date(rhs.lastModified).getTime() - new Date(lhs.lastModified).getTime())
      .slice(0, 6),
    [projects],
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
  const activityLeadTask = activityTasks.find((task) => task.status === 'running') ?? activityTasks[0] ?? null;
  const logsAttentionLevel = useMemo<'error' | 'warning' | null>(() => {
    if (shellError || relayState?.voice.captureState === 'error') {
      return 'error';
    }
    if (runtime && (!runtime.brokerReachable || !runtime.brokerHealthy)) {
      return 'warning';
    }
    return null;
  }, [relayState?.voice.captureState, runtime, shellError]);
  const logsButtonTitle = logsAttentionLevel === 'error'
    ? 'Logs · attention required'
    : logsAttentionLevel === 'warning'
      ? 'Logs · check runtime warnings'
      : 'Logs';
  const footerTimeLabel = formatFooterTime(new Date());
  const settingsSections = [
    {
      id: 'profile' as const,
      label: 'Getting Started',
      description: 'Identity, source roots, runtime readiness, and project inventory.',
      icon: <FolderOpen size={15} />,
    },
    {
      id: 'agents' as const,
      label: 'Agents',
      description: 'Agent configuration, runtime definitions, prompts, and restart controls.',
      icon: <Bot size={15} />,
    },
    {
      id: 'communication' as const,
      label: 'Communication',
      description: 'Broker, relay delivery, and live operator-facing runtime status.',
      icon: <Radio size={15} />,
    },
    {
      id: 'database' as const,
      label: 'Database',
      description: 'Session indexing and storage surfaces that back the desktop shell.',
      icon: <Database size={15} />,
    },
    {
      id: 'appearance' as const,
      label: 'Appearance',
      description: 'Visual preferences for the shell and operator-focused overlays.',
      icon: <Palette size={15} />,
    },
  ];
  const activeSettingsMeta = settingsSections.find((section) => section.id === settingsSection) ?? settingsSections[0];

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return;
    const newWidth = e.clientX - 48;
    if (newWidth > 160 && newWidth < 400) setSidebarWidth(newWidth);
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleRefreshShell = async () => {
    setRelayFeedback('Refreshing…');
    try {
      if (productSurface === 'dispatch' && window.openScoutDesktop?.refreshDispatchState) {
        const nextDispatchState = await window.openScoutDesktop.refreshDispatchState();
        commitDispatchState(nextDispatchState);
        setDispatchError(null);
        setRelayFeedback('Dispatch refreshed.');
        return;
      }
      if (window.openScoutDesktop?.refreshShellState) {
        const nextState = await window.openScoutDesktop.refreshShellState();
        setShellState(nextState);
        setShellError(null);
      } else {
        await loadShellState(true);
      }
      setRelayFeedback('Refreshed.');
    } catch (error) {
      setRelayFeedback(asErrorMessage(error));
    }
  };

  const handleDispatchControl = React.useCallback(async (action: 'start' | 'stop' | 'restart') => {
    if (!window.openScoutDesktop?.controlDispatchService) {
      return;
    }

    setDispatchControlPending(true);
    try {
      const nextState = await window.openScoutDesktop.controlDispatchService(action);
      commitDispatchState(nextState);
      setDispatchError(null);
      setRelayFeedback(action === 'start' ? 'Dispatch started.' : action === 'stop' ? 'Dispatch stopped.' : 'Dispatch restarted.');
    } catch (error) {
      setDispatchError(asErrorMessage(error));
    } finally {
      setDispatchControlPending(false);
    }
  }, [commitDispatchState]);

  const handleUpdateDispatchConfig = React.useCallback(async (input: UpdateDispatchConfigInput) => {
    if (!window.openScoutDesktop?.updateDispatchConfig) {
      return;
    }

    setDispatchConfigPending(true);
    setDispatchConfigFeedback(null);
    try {
      const nextState = await window.openScoutDesktop.updateDispatchConfig(input);
      commitDispatchState(nextState);
      setDispatchError(null);
      setDispatchConfigFeedback('Dispatch settings saved.');
    } catch (error) {
      const message = asErrorMessage(error);
      setDispatchConfigFeedback(message);
      throw error;
    } finally {
      setDispatchConfigPending(false);
    }
  }, [commitDispatchState]);

  const handleBrokerControl = React.useCallback(async (action: BrokerControlAction) => {
    if (!window.openScoutDesktop?.controlBroker) {
      return;
    }

    setBrokerControlPending(true);
    setBrokerControlFeedback(null);
    try {
      const nextState = await window.openScoutDesktop.controlBroker(action);
      setShellState(nextState);
      setShellError(null);
      if (window.openScoutDesktop.getBrokerInspector) {
        const nextInspector = await window.openScoutDesktop.getBrokerInspector();
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

  const handleSaveAppSettings = async (): Promise<boolean> => {
    if (!appSettingsDraft || !window.openScoutDesktop?.updateAppSettings) {
      return false;
    }

    setAppSettingsSaving(true);
    try {
      const nextSettings = await window.openScoutDesktop.updateAppSettings({
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

  const handleRunOnboardingCommand = React.useCallback(async (command: OnboardingCommandName): Promise<OnboardingCommandResult | null> => {
    if (!window.openScoutDesktop?.runOnboardingCommand) {
      return null;
    }

    setOnboardingCommandPending(command);
    setAppSettingsFeedback(null);
    try {
      const sourceRoots = (appSettingsDraft ?? appSettings)?.workspaceRoots ?? [];
      const result = await window.openScoutDesktop.runOnboardingCommand({
        command,
        contextRoot: (appSettingsDraft ?? appSettings)?.onboardingContextRoot ?? sourceRoots[0],
        sourceRoots: command === 'init' ? sourceRoots : undefined,
      });
      setOnboardingCommandResult(result);

      if (window.openScoutDesktop.getAppSettings) {
        const nextSettings = await window.openScoutDesktop.getAppSettings();
        setAppSettings(nextSettings);
        setAppSettingsDraft(nextSettings);
        setIsAppSettingsEditing(nextSettings.onboarding.needed);
        const nextShellState = await loadShellState(false);

        if (!nextSettings.onboarding.needed) {
          completeOnboardingIntoRelay(nextShellState);
        } else if (command === 'runtimes' && result.exitCode === 0 && !nextShellState?.runtime?.brokerReachable) {
          setOnboardingWizardStep('doctor');
          setAppSettingsFeedback('Relay is still offline. Run doctor again and make sure the broker is reachable before onboarding can finish.');
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
  }, [appSettings, appSettingsDraft, completeOnboardingIntoRelay, loadShellState]);

  const handleQuitApp = React.useCallback(() => {
    void (async () => {
      try {
        if (window.openScoutDesktop?.quitApp) {
          await window.openScoutDesktop.quitApp();
        }
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, []);

  const handleRestartOnboarding = React.useCallback(() => {
    void (async () => {
      try {
        if (!window.openScoutDesktop?.restartOnboarding) {
          return;
        }

        const nextSettings = await window.openScoutDesktop.restartOnboarding();
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
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
  }, [appSettings]);

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
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleRemoveSourceRootRow = React.useCallback((index: number) => {
    setAppSettingsDraft((current) => {
      const base = current ?? appSettings;
      if (!base) {
        return current;
      }

      const nextRoots = base.workspaceRoots.filter((_, entryIndex) => entryIndex !== index);
      return {
        ...base,
        workspaceRoots: nextRoots.length > 0 ? nextRoots : [''],
      };
    });
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleBrowseForSourceRoot = React.useCallback((index: number) => {
    void (async () => {
      try {
        if (!window.openScoutDesktop?.pickDirectory) {
          return;
        }
        const selectedPath = await window.openScoutDesktop.pickDirectory();
        if (!selectedPath) {
          return;
        }
        handleSetSourceRootAt(index, selectedPath);
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
        if (!window.openScoutDesktop?.pickDirectory) {
          return;
        }
        const selectedPath = await window.openScoutDesktop.pickDirectory();
        if (!selectedPath) {
          return;
        }
        handleSetOnboardingContextRoot(selectedPath);
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, [handleSetOnboardingContextRoot]);

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

  const dismissStartupOnboarding = React.useCallback(() => {
    void (async () => {
      try {
        if (window.openScoutDesktop?.skipOnboarding) {
          const nextSettings = await window.openScoutDesktop.skipOnboarding();
          setAppSettings(nextSettings);
          setAppSettingsDraft(nextSettings);
        }
        setStartupOnboardingState('done');
        setAppSettingsFeedback('Onboarding skipped. You can revisit it from Settings.');
        setIsAppSettingsEditing(false);
      } catch (error) {
        setAppSettingsFeedback(asErrorMessage(error));
      }
    })();
  }, []);

  const skipCurrentOnboardingStep = React.useCallback(() => {
    if (canGoToNextOnboardingStep) {
      moveOnboardingWizard(1);
      return;
    }
    dismissStartupOnboarding();
  }, [canGoToNextOnboardingStep, dismissStartupOnboarding, moveOnboardingWizard]);

  const openAgentProfile = React.useCallback((agentId: string) => {
    setSelectedInterAgentId(agentId);
    setSelectedInterAgentThreadId(firstInterAgentThreadIdForAgent(interAgentThreads, agentId));
    setIsAgentConfigEditing(false);
    setPendingConfigFocusAgentId(null);
    setActiveView('agents');
  }, [interAgentThreads]);

  const openAgentSettings = React.useCallback((agentId: string, focusConfig = false) => {
    setSelectedInterAgentId(agentId);
    setSelectedInterAgentThreadId(firstInterAgentThreadIdForAgent(interAgentThreads, agentId));
    setSettingsSection('agents');
    setActiveView('settings');
    setIsAgentConfigEditing(focusConfig);
    setPendingConfigFocusAgentId(focusConfig ? agentId : null);
  }, [interAgentThreads]);

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
    if (!window.openScoutDesktop?.toggleVoiceCapture) {
      setShellError('Electron desktop bridge is unavailable.');
      return;
    }

    try {
      const nextState = await window.openScoutDesktop.toggleVoiceCapture();
      setShellState(nextState);
      setShellError(null);
      setRelayFeedback(nextState.relay.voice.isCapturing ? 'Voice capture started.' : 'Voice capture stopped.');
    } catch (error) {
      setRelayFeedback(asErrorMessage(error));
    }
  };

  const handleSetVoiceRepliesEnabled = async (enabled: boolean) => {
    if (!window.openScoutDesktop?.setVoiceRepliesEnabled) {
      setShellError('Electron desktop bridge is unavailable.');
      return;
    }

    try {
      const nextState = await window.openScoutDesktop.setVoiceRepliesEnabled(enabled);
      setShellState(nextState);
      setShellError(null);
      setRelayFeedback(enabled ? 'Playback enabled.' : 'Playback disabled.');
    } catch (error) {
      setRelayFeedback(asErrorMessage(error));
    }
  };

  const handleSaveAgentConfig = async () => {
    if (!selectedInterAgentId || !visibleAgentConfig || !window.openScoutDesktop?.updateAgentConfig) {
      return;
    }

    setAgentConfigSaving(true);
    try {
      const nextConfig = await window.openScoutDesktop.updateAgentConfig({
        agentId: selectedInterAgentId,
        runtime: {
          cwd: visibleAgentConfig.runtime.cwd,
          harness: visibleAgentConfig.runtime.harness,
          sessionId: visibleAgentConfig.runtime.sessionId,
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
    if (!selectedInterAgentId || !visibleAgentConfig || !window.openScoutDesktop?.restartAgent) {
      return;
    }

    setAgentConfigRestarting(true);
    try {
      let nextConfig = visibleAgentConfig;
      if (agentConfigDirty && window.openScoutDesktop?.updateAgentConfig) {
        setAgentConfigSaving(true);
        nextConfig = await window.openScoutDesktop.updateAgentConfig({
          agentId: selectedInterAgentId,
          runtime: {
            cwd: visibleAgentConfig.runtime.cwd,
            harness: visibleAgentConfig.runtime.harness,
            sessionId: visibleAgentConfig.runtime.sessionId,
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

      const nextShellState = await window.openScoutDesktop.restartAgent({
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
    if (!selectedInterAgentId || !window.openScoutDesktop?.openAgentSession) {
      return;
    }

    try {
      await window.openScoutDesktop.openAgentSession(selectedInterAgentId);
      setAgentSessionFeedback(agentSession?.mode === 'tmux' ? 'Opening tmux session in Terminal.' : 'Opening session logs.');
    } catch (error) {
      setAgentSessionFeedback(asErrorMessage(error));
    }
  }, [agentSession?.mode, selectedInterAgentId]);

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

  const handleRelaySend = async () => {
    const body = relayDraft.trim();
    if (!body || relaySending || !window.openScoutDesktop) {
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
      const nextState = await window.openScoutDesktop.sendRelayMessage({
        destinationKind: selectedRelayKind,
        destinationId: selectedRelayId,
        body,
        replyToMessageId: effectiveReplyToMessageId,
        referenceMessageIds: relayContextMessageIds,
        clientMessageId,
      });
      setShellState(nextState);
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
    setSelectedProject(null);
    setSelectedSession(session);
    setActiveView('sessions');
  };

  const openRelayAgentThread = React.useCallback((
    agentId: string,
    options?: {
      replyToMessage?: RelayMessage | null;
      draft?: string | null;
      focusComposer?: boolean;
    },
  ) => {
    setSelectedRelayKind('direct');
    setSelectedRelayId(agentId);
    setActiveView('relay');
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
  }, []);

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
    const commandResult = onboardingCommandResult?.command === command ? onboardingCommandResult : null;
    const outputLabel = running
      ? 'Running…'
      : commandResult
        ? `exit ${commandResult.exitCode}`
        : 'Awaiting run';
    const outputBody = running
      ? '$ command started\n… waiting for process output'
      : commandResult
        ? commandResult.output
        : 'Run this command from the button below and its output will appear here.';

    return (
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(15, 23, 42, 0.12)', backgroundColor: C.termBg }}>
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-b"
          style={{ borderBottomColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
            </div>
            <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Terminal
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-[10px] font-mono px-2 py-1 rounded"
              style={running
                ? { backgroundColor: 'rgba(45, 212, 191, 0.18)', color: '#99f6e4' }
                : commandResult
                  ? (commandResult.exitCode === 0
                    ? { backgroundColor: 'rgba(45, 212, 191, 0.18)', color: '#99f6e4' }
                    : { backgroundColor: 'rgba(248, 113, 113, 0.18)', color: '#fecaca' })
                  : { backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.72)' }}
            >
              {outputLabel}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-opacity hover:opacity-85"
              style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.82)', backgroundColor: 'rgba(255,255,255,0.04)' }}
              onClick={() => {
                void handleCopyOnboardingCommand(command);
              }}
            >
              {onboardingCopiedCommand === command ? <CheckCheck size={12} /> : <Copy size={12} />}
              {onboardingCopiedCommand === command ? 'Copied' : 'Quick copy'}
            </button>
          </div>
        </div>
        <div className="px-5 py-5">
          <div className="text-[14px] leading-[1.8] font-mono break-all" style={{ color: C.termFg }}>
            <span style={{ color: 'rgba(153, 246, 228, 0.88)' }}>$</span> {commandLine}
          </div>
        </div>
        <div className="border-t px-5 py-4" style={{ borderTopColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(0,0,0,0.10)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.48)' }}>
              Output
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.48)' }}>
              cwd: {commandResult?.cwd ?? (onboardingContextRoot || 'pending')}
            </div>
          </div>
          <pre
            className="mt-3 text-[12px] leading-[1.6] whitespace-pre-wrap break-words overflow-x-auto font-mono"
            style={{ color: running ? 'rgba(255,255,255,0.68)' : C.termFg, minHeight: '5.5rem' }}
          >
            {outputBody}
          </pre>
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
              Welcome to OpenScout
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
              Source roots
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              Point OpenScout at the parent folder that contains your repos.
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
            <div className="space-y-3">
              {((visibleAppSettings.workspaceRoots ?? []).length > 0 ? visibleAppSettings.workspaceRoots : ['']).map((root, index) => (
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
              Confirm
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              Review your choices before continuing.
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
                  <div className="text-[15px] font-medium leading-[1.5]" style={s.inkText}>{value}</div>
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

    if (activeOnboardingStep.id === 'init') {
      const initCommandLine = buildOnboardingCommandLine('init');
      const initRunning = onboardingCommandPending === 'init';
      const initManifestPath = visibleAppSettings.currentProjectConfigPath
        ?? (visibleAppSettings.onboardingContextRoot ? `${visibleAppSettings.onboardingContextRoot}/.openscout/project.json` : 'Not created yet.');
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
              Init
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              Create the local project manifest.
            </div>
          </div>

          {renderOnboardingCommandShell('init', initCommandLine, initRunning)}

          <div className="rounded-xl border px-5 py-5" style={{ borderColor: C.border, backgroundColor: C.surface }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                ['1. Context root', visibleAppSettings.onboardingContextRoot || 'Not set'],
                ['2. Manifest', 'Writes .openscout/project.json at the root.'],
                ['3. Discovery', 'Feeds the project inventory and routing.'],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-lg border px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <div className="text-[11px] font-mono font-medium tracking-wide" style={{ color: C.accent }}>{label}</div>
                  <div className="text-[12px] mt-2 leading-[1.6]" style={s.mutedText}>{detail}</div>
                </div>
              ))}
            </div>
            <div className="text-[12px] font-mono mt-5 leading-[1.6] break-all" style={s.mutedText}>
              {initManifestPath}
            </div>
          </div>

          <button
            className="os-btn-primary flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
            style={{ backgroundColor: C.accent, color: '#fff' }}
            onClick={() => {
              void (async () => {
                const result = await handleRunOnboardingCommand('init');
                if (result?.exitCode === 0) {
                  setOnboardingWizardStep('doctor');
                }
              })();
            }}
            disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsDirty}
          >
            {initRunning ? 'Running Init…' : 'Run Init'}
          </button>
        </div>
      );
    }

    if (activeOnboardingStep.id === 'doctor') {
      const doctorCommandLine = buildOnboardingCommandLine('doctor');
      const doctorRunning = onboardingCommandPending === 'doctor';
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
              Doctor
            </div>
            <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
              Check broker health, source roots, and project inventory.
            </div>
          </div>

          {renderOnboardingCommandShell('doctor', doctorCommandLine, doctorRunning)}

          <div className="rounded-xl border px-5 py-5" style={{ borderColor: C.border, backgroundColor: C.surface }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                ['1. Broker', 'Checks the broker is installed and reachable.'],
                ['2. Discovery', 'Scans source roots for project manifests.'],
                ['3. Inventory', 'Merges inputs into the shared project inventory.'],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-lg border px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <div className="text-[11px] font-mono font-medium tracking-wide" style={{ color: C.accent }}>{label}</div>
                  <div className="text-[12px] mt-2 leading-[1.6]" style={s.mutedText}>{detail}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
              {[
                ['Projects', `${visibleAppSettings.projectInventory.length}`],
                ['Broker', visibleAppSettings.broker.reachable ? 'Reachable' : 'Unavailable'],
                ['Relay context root', visibleAppSettings.currentProjectConfigPath ?? (visibleAppSettings.onboardingContextRoot || 'Not created')],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg px-4 py-3" style={{ backgroundColor: C.bg }}>
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: C.accent }}>{label}</div>
                  <div className="text-[15px] font-medium leading-[1.5] break-words" style={s.inkText}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          <button
            className="os-btn-primary flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40 transition-all"
            style={{ backgroundColor: C.accent, color: '#fff' }}
            onClick={() => {
              void (async () => {
                const result = await handleRunOnboardingCommand('doctor');
                if (result?.exitCode === 0) {
                  setOnboardingWizardStep('runtimes');
                }
              })();
            }}
            disabled={Boolean(onboardingCommandPending) || appSettingsLoading || !onboardingHasProjectConfig}
          >
            {doctorRunning ? 'Running Doctor…' : 'Run Doctor'}
          </button>
        </div>
      );
    }

    const runtimesCommandLine = buildOnboardingCommandLine('runtimes');
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="text-[28px] font-semibold tracking-tight" style={s.inkText}>
            Runtimes
          </div>
          <div className="text-[15px] leading-[1.7] max-w-2xl" style={s.mutedText}>
            Verify each harness has a working local runtime.
          </div>
        </div>

        {renderOnboardingCommandShell('runtimes', runtimesCommandLine, onboardingCommandPending === 'runtimes')}

        <div className="grid grid-cols-1 gap-3">
          {(visibleAppSettings.runtimeCatalog ?? []).map((runtimeEntry) => (
            <div key={runtimeEntry.name} className="os-card rounded-xl border px-5 py-4" style={{ borderColor: runtimeEntry.readinessState === 'ready' ? C.accent : C.border, backgroundColor: C.surface }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center mt-0.5" style={{ backgroundColor: runtimeEntry.readinessState === 'ready' ? C.accentBg : C.bg }}>
                    <span className="text-[14px]" style={{ color: runtimeEntry.readinessState === 'ready' ? C.accent : C.muted }}>&#9654;</span>
                  </div>
                  <div>
                    <div className="text-[16px] font-semibold tracking-tight" style={s.inkText}>{runtimeEntry.label}</div>
                    <div className="text-[13px] mt-1 leading-[1.6]" style={s.mutedText}>{runtimeEntry.readinessDetail}</div>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2.5 py-1 rounded-full shrink-0" style={runtimeEntry.readinessState === 'ready' ? s.activePill : s.tagBadge}>
                  {runtimeEntry.readinessState}
                </span>
              </div>
            </div>
          ))}
        </div>

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
                    <div className="text-[11px] font-mono uppercase tracking-[0.22em]" style={s.mutedText}>OpenScout Setup</div>
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
            <div className="w-full max-w-[560px] rounded-2xl border px-8 py-10 text-center os-scale-in" style={{ borderColor: C.border, backgroundColor: C.surface, boxShadow: `0 24px 80px ${dark ? 'rgba(0,0,0,0.4)' : 'rgba(15,23,42,0.08)'}` }}>
              <div className="w-10 h-10 rounded-lg mx-auto mb-5 flex items-center justify-center" style={{ backgroundColor: C.accentBg }}>
                <span className="text-[18px]" style={{ color: C.accent }}>&#9670;</span>
              </div>
              <div className="text-[11px] font-mono uppercase tracking-[0.22em]" style={s.mutedText}>OpenScout Setup</div>
              <div className="text-[28px] font-semibold tracking-tight mt-4" style={s.inkText}>Setting up…</div>
              <div className="text-[14px] mt-3 leading-[1.7]" style={s.mutedText}>
                Checking your local environment.
              </div>
              <div className="flex justify-center mt-6 gap-1">
                <span className="os-thinking-dot" style={{ color: C.accent }} />
                <span className="os-thinking-dot" style={{ color: C.accent }} />
                <span className="os-thinking-dot" style={{ color: C.accent }} />
              </div>
            </div>
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
      <div className="scout-window-bar h-10 border-b flex items-center justify-between px-3 shrink-0 z-10" style={s.topBar}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]"></div>
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]"></div>
            <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]"></div>
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            {([
              ['relay', 'Relay'],
              ['dispatch', 'Dispatch'],
            ] as const).map(([surface, label]) => {
              const active = productSurface === surface;
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
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider" style={s.mutedText}>
            <button
              type="button"
              onClick={openRelayDiagnostics}
              className="flex items-center gap-1.5 rounded-full border px-2 py-1 transition-opacity hover:opacity-80"
              style={{ borderColor: C.border }}
              title={runtime?.brokerReachable ? 'Open Relay diagnostics' : 'Relay is offline. Open diagnostics.'}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${runtime?.brokerReachable ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
              Relay <span className="font-medium" style={s.inkText}>{runtime?.brokerReachable ? 'Running' : 'Offline'}</span>
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
            <button className="hover:opacity-70 transition-opacity">
              <PenTool size={14} />
            </button>
            <button className="hover:opacity-70 transition-opacity" onClick={() => void handleRefreshShell()}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {productSurface === 'relay' ? (
      <>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Nav (Leftmost) */}
        <div className="w-12 border-r flex flex-col items-center py-2 gap-3 shrink-0 z-10" style={s.navBar}>
          <div className="flex flex-col gap-1 w-full px-2 mt-2" style={s.mutedText}>
            {([
              ['overview', <LayoutGrid size={16} strokeWidth={1.5} />, 'Overview'],
              ['activity', <Radio size={16} strokeWidth={1.5} />, 'Activity Monitor'],
              ['machines', <Network size={16} strokeWidth={1.5} />, 'Machines'],
              ['plans', <FileText size={16} strokeWidth={1.5} />, 'Plans'],
              ['sessions', <Radar size={16} strokeWidth={1.5} />, 'Session History'],
              ['search',   <Search size={16} strokeWidth={1.5} />, 'Search'],
              ['agents', <Bot size={16} strokeWidth={1.5} />, 'Agents'],
              ['inter-agent', <InterAgentIcon size={16} />, 'Inter-Agent'],
              ['relay',    <MessageSquare size={16} strokeWidth={1.5} />, 'Relay'],
            ] as [string, React.ReactNode, string][]).map(([view, icon, title]) => (
              <button
                key={view}
                onClick={() => setActiveView(view as typeof activeView)}
                title={title}
                className="p-1.5 rounded flex items-center justify-center transition-colors"
                style={activeView === view ? s.activePill : undefined}
              >
                {icon}
              </button>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-1 items-center w-full px-2">
            {(activeView === 'activity' || activeView === 'machines' || activeView === 'plans' || activeView === 'sessions' || activeView === 'relay' || activeView === 'search' || activeView === 'inter-agent' || activeView === 'agents' || activeView === 'logs') && (
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-1.5 rounded flex items-center justify-center transition-opacity hover:opacity-70"
                style={s.mutedText}
                title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              >
                {isCollapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
              </button>
            )}
            <button
              className="p-1.5 rounded flex items-center justify-center transition-colors"
              style={activeView === 'settings' ? s.activePill : s.mutedText}
              title="Settings"
              onClick={() => setActiveView('settings')}
            >
              <Settings size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* --- OVERVIEW --- */}
        {activeView === 'overview' ? (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <div className="px-12 pt-16 pb-12 border-b" style={{ borderColor: C.border }}>
                <div className="max-w-5xl">
                  <div className="os-fade-in text-[10px] font-mono tracking-widest uppercase mb-4" style={s.mutedText}>
                    Command Center
                  </div>
                  <h1 className="os-fade-up text-5xl font-bold mb-4 tracking-tight leading-tight" style={s.inkText}>
                    Your Agents,<br />Connected
                  </h1>
                  <p className="os-fade-up os-stagger-1 text-lg mb-8 max-w-xl leading-relaxed" style={s.mutedText}>
                    OpenScout gives you and your agents a shared control plane to communicate, collaborate, and coordinate.
                  </p>
                  <div className="os-fade-up os-stagger-2 flex items-center gap-3">
                    <button
                      onClick={() => setActiveView('relay')}
                      className="os-btn-primary text-white px-5 py-2.5 rounded-lg text-[14px] font-medium shadow-md flex items-center gap-2"
                      style={{ backgroundColor: C.accent }}
                    >
                      <MessageSquare size={16} />
                      Open Relay
                    </button>
                    <button
                      onClick={() => setActiveView('sessions')}
                      className="os-btn border px-5 py-2.5 rounded-lg text-[14px] font-medium shadow-sm flex items-center gap-2"
                      style={{ ...s.surface, borderColor: C.border, color: C.ink }}
                    >
                      <Radar size={16} />
                      Browse Sessions
                    </button>
                    <button
                      onClick={() => void handleRefreshShell()}
                      className="os-btn border px-5 py-2.5 rounded-lg text-[14px] font-medium shadow-sm flex items-center gap-2"
                      style={{ ...s.surface, borderColor: C.border, color: C.muted }}
                    >
                      <RefreshCw size={16} />
                      Sync Runtime
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-12 py-6 border-b flex items-center gap-12" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                {[
                  { value: stats.totalSessions, label: 'Sessions indexed' },
                  { value: runtime?.messageCount ?? stats.totalMessages, label: 'Messages captured' },
                  { value: machinesState?.onlineCount ?? 0, label: 'Live nodes' },
                  { value: plansState?.planCount ?? 0, label: 'Plans tracked' },
                ].map((stat, i) => (
                  <div key={stat.label} className={`os-fade-in os-stagger-${i + 1} flex items-baseline gap-2`}>
                    <span className="text-2xl font-bold" style={s.inkText}>{stat.value}</span>
                    <span className="text-[12px]" style={s.mutedText}>{stat.label}</span>
                  </div>
                ))}
              </div>

              <div className="px-12 py-10">
                <div className="text-[10px] font-mono tracking-widest uppercase mb-6" style={s.mutedText}>Capabilities</div>
                <div className="grid grid-cols-3 gap-5 mb-12">
                  {[
                    {
                      icon: <MessageSquare size={20} />,
                      title: 'Relay',
                      desc: 'Real-time communication hub. Agent-to-agent, human-to-agent, all in one stream.',
                      action: () => setActiveView('relay'),
                      accent: true,
                    },
                    {
                      icon: <Radar size={20} />,
                      title: 'Sessions',
                      desc: 'Browse and organize session histories by project. Every conversation, searchable.',
                      action: () => setActiveView('sessions'),
                      accent: false,
                    },
                    {
                      icon: <InterAgentIcon size={20} />,
                      title: 'Inter-Agent',
                      desc: 'Read private agent-to-agent threads and inspect who Fabric, Builder, and others are talking to.',
                      action: () => setActiveView('inter-agent'),
                      accent: false,
                    },
                    {
                      icon: <Network size={20} />,
                      title: 'Machines',
                      desc: 'Inspect servers and computers on the mesh, including runtime endpoints and active projects.',
                      action: () => setActiveView('machines'),
                      accent: false,
                    },
                    {
                      icon: <FileText size={20} />,
                      title: 'Plans',
                      desc: 'Track recent asks and load Markdown plans from registered agent workspaces.',
                      action: () => setActiveView('plans'),
                      accent: false,
                    },
                    {
                      icon: <Search size={20} />,
                      title: 'Search',
                      desc: 'Full-text search across all sessions, messages, and metadata. Find anything instantly.',
                      action: () => setActiveView('search'),
                      accent: false,
                    },
                  ].map((card, i) => (
                    <button
                      key={card.title}
                      onClick={card.action}
                      className={`os-card os-fade-up os-stagger-${i + 1} text-left border rounded-xl p-6 group`}
                      style={{ ...s.surface, borderColor: C.border }}
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-transform duration-200 group-hover:scale-110"
                        style={card.accent ? { backgroundColor: C.accent, color: '#fff' } : { backgroundColor: C.tagBg, color: C.muted }}
                      >
                        {card.icon}
                      </div>
                      <h3 className="text-[15px] font-semibold mb-2 flex items-center gap-2" style={s.inkText}>
                        {card.title}
                        <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-all duration-200 group-hover:translate-x-0.5" style={s.mutedText} />
                      </h3>
                      <p className="text-[13px] leading-relaxed" style={s.mutedText}>{card.desc}</p>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase mb-4 flex items-center justify-between" style={s.mutedText}>
                      <span>Recent Activity</span>
                      <button onClick={() => setActiveView('sessions')} className="flex items-center gap-1 hover:opacity-70" style={{ color: C.accent }}>
                        View all <ChevronRight size={10} />
                      </button>
                    </div>
                    <div className="border rounded-xl overflow-hidden" style={{ borderColor: C.border }}>
                      {overviewSessions.length > 0 ? overviewSessions.map((session, i) => (
                        <div
                          key={session.id}
                          className={`os-row px-4 py-3 flex items-center gap-3 cursor-pointer os-fade-in os-stagger-${i + 1}`}
                          style={{
                            ...s.surface,
                            ...(i < overviewSessions.length - 1 ? { borderBottom: `1px solid ${C.border}` } : {}),
                          }}
                          onClick={() => openSessionDetail(session)}
                        >
                          <div
                            className="os-avatar w-6 h-6 rounded text-white flex items-center justify-center text-[10px] font-bold shrink-0"
                            style={{ backgroundColor: colorForIdentity(session.agent) }}
                          >
                            {session.agent.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-medium truncate" style={s.inkText}>{session.title}</div>
                            <div className="text-[10px] font-mono" style={s.mutedText}>{session.project}</div>
                          </div>
                          <div className="text-[10px] font-mono shrink-0" style={s.mutedText}>{formatDate(session.lastModified)}</div>
                        </div>
                      )) : (
                        <div className="px-4 py-8 text-[12px] text-center" style={{ ...s.surface, color: C.muted }}>
                          No session history yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase mb-4" style={s.mutedText}>Agents Online</div>
                    {reachableRelayAgents.length > 0 ? (
                      <div className="grid grid-cols-5 gap-3 mb-8">
                        {reachableRelayAgents.slice(0, 5).map((thread) => (
                          <button
                            key={thread.id}
                            onClick={() => {
                              setSelectedRelayKind('direct');
                              setSelectedRelayId(thread.id);
                              setActiveView('relay');
                            }}
                            className="flex flex-col items-center gap-2"
                          >
                            <div className="os-avatar relative cursor-pointer">
                              <div
                                className="w-10 h-10 rounded-lg text-white flex items-center justify-center text-sm font-bold"
                                style={{ backgroundColor: colorForIdentity(thread.id) }}
                              >
                                {thread.title.charAt(0)}
                              </div>
                              <div className="os-avatar-ring absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2" style={{ borderColor: C.surface }}></div>
                            </div>
                            <span className="text-[10px] font-medium truncate max-w-[4.5rem]" style={s.mutedText}>{cleanDisplayTitle(thread.title)}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="border rounded-xl px-4 py-5 mb-8 text-[12px]" style={{ ...s.surface, borderColor: C.border, color: C.muted }}>
                        No reachable agents detected right now.
                      </div>
                    )}

                    <div className="text-[10px] font-mono tracking-widest uppercase mb-4" style={s.mutedText}>Projects</div>
                    <div className="flex flex-wrap gap-2">
                      {overviewProjects.map((project) => (
                        <button
                          key={project.name}
                          onClick={() => openProjectSessions(project.name)}
                          className="os-btn flex items-center gap-2 px-3 py-2 border rounded-lg text-[12px] font-medium"
                          style={{ ...s.surface, borderColor: C.border, color: C.ink }}
                        >
                          <Folder size={12} style={s.mutedText} />
                          {project.name}
                          <span className="os-tag text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>{project.count}</span>
                        </button>
                      ))}
                    </div>

                    {shellError ? (
                      <div className="mt-8 pt-8 border-t" style={{ borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-4" style={s.mutedText}>Runtime Error</div>
                        <div className="flex items-center gap-2 px-3 py-2 text-[12px] border rounded" style={{ ...s.surface, borderColor: C.border, color: C.muted }}>
                          <X size={12} />
                          <span>{shellError}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

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
                    Asks, blockers, runtime signals, and recent coordination across OpenScout.
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
                      Everything OpenScout Is Coordinating
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
                      onClick={() => setActiveView('relay')}
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                    >
                      <MessageSquare size={14} />
                      Open Relay
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

        /* --- SETTINGS --- */
        ) : activeView === 'settings' ? (
          <div className="flex-1 flex overflow-hidden" style={s.surface}>
            <div className="w-56 border-r flex flex-col shrink-0" style={{ backgroundColor: C.bg, borderColor: C.border }}>
              <div className="px-4 py-4 border-b" style={{ borderColor: C.border }}>
                <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Settings</div>
              </div>
              <div className="px-2 py-2 flex flex-col gap-1">
                {settingsSections.map((section) => {
                  const active = settingsSection === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setSettingsSection(section.id)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded text-left transition-colors"
                      style={active ? s.activeItem : s.mutedText}
                    >
                      <span style={{ color: active ? C.accent : C.muted }}>{section.icon}</span>
                      <span className="text-[13px] font-medium" style={active ? s.inkText : undefined}>{section.label}</span>
                      {active ? <ChevronRight size={12} className="ml-auto" style={s.mutedText} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="max-w-6xl mx-auto px-8 py-8">
                <div className="flex items-start justify-between gap-6 mb-6">
                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>Settings</div>
                    <h1 className="text-[28px] font-semibold tracking-tight" style={s.inkText}>{activeSettingsMeta.label}</h1>
                    <p className="text-[13px] mt-2 max-w-2xl leading-[1.6]" style={s.mutedText}>
                      {activeSettingsMeta.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {settingsSection === 'profile' ? (
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
                            {appSettingsSaving ? 'Saving…' : 'Save Inputs'}
                          </button>
                        </>
                      ) : (
                          <button
                            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                            style={{ color: C.ink }}
                            onClick={() => handleStartAppSettingsEdit()}
                            disabled={appSettingsLoading || !visibleAppSettings}
                          >
                          Edit Inputs
                        </button>
                      )
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
                            {appSettingsSaving ? 'Saving…' : 'Save Telegram'}
                          </button>
                        </>
                      ) : (
                        <button
                          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                          style={{ color: C.ink }}
                          onClick={() => handleStartAppSettingsEdit()}
                          disabled={appSettingsLoading || !visibleAppSettings}
                        >
                          Edit Telegram
                        </button>
                      )
                    ) : settingsSection === 'agents' ? (
                      <>
                        <button
                          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                          style={{ color: C.ink }}
                          onClick={() => setActiveView('agents')}
                        >
                          Open Overview
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
                  <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)] gap-4">
                    <div className="space-y-4 min-w-0">
                      {visibleAppSettings?.onboarding ? (
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
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                                style={visibleAppSettings.onboarding.needed ? s.tagBadge : s.activePill}
                              >
                                {visibleAppSettings.onboarding.needed ? 'needs setup' : 'ready'}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)] gap-4 mt-4">
                            <div className="space-y-2">
                              {onboardingWizardSteps.map((step) => {
                                const isActive = step.id === activeOnboardingStep.id;
                                return (
                                  <button
                                    key={step.id}
                                    className="w-full text-left rounded-lg border px-3 py-3 transition-opacity hover:opacity-90"
                                    style={{ borderColor: C.border, backgroundColor: isActive ? C.bg : C.surface }}
                                    onClick={() => setOnboardingWizardStep(step.id)}
                                  >
                                    <div className="flex items-start gap-3">
                                      <span
                                        className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                                        style={step.complete ? s.activePill : (isActive ? s.tagBadge : s.mutedText)}
                                      >
                                        {step.number}
                                      </span>
                                      <div className="min-w-0">
                                        <div className="text-[12px] font-medium" style={s.inkText}>{step.title}</div>
                                        <div className="text-[10px] mt-1 leading-[1.4]" style={s.mutedText}>{step.detail}</div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>

                            <div className="rounded-xl border px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>
                                    Step {activeOnboardingStep.number} of {onboardingWizardSteps.length}
                                  </div>
                                  <div className="text-[16px] font-semibold mt-1 tracking-tight" style={s.inkText}>{activeOnboardingStep.title}</div>
                                  <div className="text-[11px] mt-2 leading-[1.6]" style={s.mutedText}>{activeOnboardingStep.detail}</div>
                                </div>
                                <span
                                  className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                                  style={activeOnboardingStep.complete ? s.activePill : s.tagBadge}
                                >
                                  {activeOnboardingStep.complete ? 'done' : 'focus'}
                                </span>
                              </div>

                              {!visibleAppSettings.onboarding.needed ? (
                                <div className="rounded-lg border px-3 py-3 mt-4" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                  <div className="text-[12px] font-medium" style={s.inkText}>OpenScout is ready.</div>
                                  <div className="text-[10px] mt-1 leading-[1.5]" style={s.mutedText}>
                                    You can revisit this wizard any time, but the Relay context root, inventory, and runtime checks are already in place.
                                  </div>
                                  <div className="flex flex-wrap gap-2 mt-3">
                                    <button
                                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                                      style={{ color: C.ink }}
                                      onClick={() => setActiveView('overview')}
                                    >
                                      Open Overview
                                    </button>
                                    <button
                                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                                      style={{ color: C.ink }}
                                      onClick={() => setActiveView('agents')}
                                    >
                                      Open Agents
                                    </button>
                                  </div>
                                </div>
                              ) : activeOnboardingStep.id === 'welcome' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="flex items-center gap-2">
                                      <User size={14} style={{ color: C.accent }} />
                                      <div className="text-[12px] font-medium" style={s.inkText}>What should OpenScout call you?</div>
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      This is the name OpenScout will use across Relay, desktop views, and future prompts. It is prefilled from this machine when possible, and you can change it later.
                                    </div>
                                  </div>

                                  {isAppSettingsEditing ? (
                                    <input
                                      ref={settingsOperatorNameRef}
                                      value={visibleAppSettings.operatorName ?? ''}
                                      onChange={(event) => {
                                        setAppSettingsDraft((current) => current ? {
                                          ...current,
                                          operatorName: event.target.value,
                                        } : current);
                                        setAppSettingsFeedback(null);
                                      }}
                                      readOnly={appSettingsSaving}
                                      placeholder={visibleAppSettings.operatorNameDefault || 'Operator'}
                                      className="w-full rounded-lg border px-3 py-2.5 text-[13px] leading-[1.5] bg-transparent outline-none"
                                      style={{ borderColor: C.border, color: C.ink }}
                                    />
                                  ) : (
                                    <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                      <div className="text-[13px] font-medium" style={s.inkText}>
                                        {visibleAppSettings.operatorName || visibleAppSettings.operatorNameDefault}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : activeOnboardingStep.id === 'source-roots' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="flex items-center gap-2">
                                      <Folder size={14} style={{ color: C.accent }} />
                                      <div className="text-[12px] font-medium" style={s.inkText}>Where do your repos live?</div>
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      OpenScout can scan all the projects inside one folder, so it works best if you point it at a parent directory like `~/dev`, `~/src`, or `~/code` and let it discover the repos underneath.
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      This is safe: OpenScout only inspects what is there and does not add files to that parent folder. If you do not already have one, create a folder like `~/dev` first and point OpenScout there.
                                    </div>
                                  </div>

                                  {isAppSettingsEditing ? (
                                    <div className="space-y-3">
                                      {((visibleAppSettings.workspaceRoots ?? []).length > 0 ? visibleAppSettings.workspaceRoots : ['']).map((root, index) => (
                                        <div key={`settings-source-root-${index}`} className="flex items-center gap-2">
                                          <input
                                            value={root}
                                            onChange={(event) => handleSetSourceRootAt(index, event.target.value)}
                                            readOnly={appSettingsSaving}
                                            className="flex-1 rounded-lg border px-3 py-2.5 text-[13px] leading-[1.5] bg-transparent outline-none"
                                            style={{ borderColor: C.border, color: C.ink }}
                                            placeholder={index === 0 ? "~/dev" : "Add another source root"}
                                          />
                                          <button
                                            type="button"
                                            className="os-toolbar-button text-[10px] font-medium px-2 py-2 rounded"
                                            style={{ color: C.ink }}
                                            onClick={() => handleBrowseForSourceRoot(index)}
                                            disabled={appSettingsSaving}
                                          >
                                            Finder
                                          </button>
                                          <button
                                            type="button"
                                            className="os-toolbar-button text-[12px] font-medium w-8 h-8 rounded disabled:opacity-50"
                                            style={{ color: C.ink }}
                                            onClick={() => handleRemoveSourceRootRow(index)}
                                            disabled={appSettingsSaving || ((visibleAppSettings.workspaceRoots ?? []).length <= 1 && !root)}
                                            aria-label={`Remove source root ${index + 1}`}
                                          >
                                            -
                                          </button>
                                        </div>
                                      ))}
                                      <button
                                        type="button"
                                        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                                        style={{ color: C.ink }}
                                        onClick={handleAddSourceRootRow}
                                        disabled={appSettingsSaving}
                                      >
                                        <span className="text-[12px] leading-none">+</span>
                                        Add path
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                      <div className="flex flex-wrap gap-2">
                                        {(visibleAppSettings.workspaceRoots ?? []).length > 0 ? visibleAppSettings.workspaceRoots.map((root) => (
                                          <span key={root} className="text-[10px] font-mono px-2 py-1 rounded" style={s.tagBadge}>{root}</span>
                                        )) : (
                                          <span className="text-[11px]" style={s.mutedText}>No source roots configured yet.</span>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  <div>
                                    <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Quick Picks</div>
                                    <div className="flex flex-wrap gap-2">
                                      {SOURCE_ROOT_PATH_SUGGESTIONS.map((root) => (
                                        <button
                                          key={root}
                                          className="os-toolbar-button text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                                          style={{ color: C.ink }}
                                          onClick={() => handleAddSourceRootSuggestion(root)}
                                          disabled={appSettingsSaving}
                                        >
                                          Add {root}
                                        </button>
                                      ))}
                                    </div>
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
                                      A harness is the assistant family that answers a turn. A runtime is the local program or long-running session OpenScout uses to launch that harness.
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
                                    <div className="text-[12px] font-medium" style={s.inkText}>Confirmation</div>
                                    <div className="text-[10px] mt-1 leading-[1.5]" style={s.mutedText}>
                                      Review the choices below. Confirming saves them locally and then moves into the command steps.
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
                              ) : activeOnboardingStep.id === 'init' ? (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
                                    <div className="flex items-center gap-2">
                                      <FileJson size={14} style={{ color: C.accent }} />
                                      <div className="text-[12px] font-medium" style={s.inkText}>Create the local project manifest</div>
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      This runs `scout init` against your chosen Relay context root and uses your current source roots as repeated `--source-root` flags.
                                    </div>
                                    <div className="text-[11px] font-mono mt-3 break-all" style={s.inkText}>
                                      {buildOnboardingCommandLine('init')}
                                    </div>
                                    <div className="text-[10px] mt-2 leading-[1.5]" style={s.mutedText}>
                                      Project config path: {visibleAppSettings.currentProjectConfigPath ?? (visibleAppSettings.onboardingContextRoot ? `${visibleAppSettings.onboardingContextRoot}/.openscout/project.json` : 'Not created yet.')}
                                    </div>
                                  </div>
                                  <button
                                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded disabled:opacity-50"
                                    style={{ color: C.ink }}
                                    onClick={() => {
                                      void (async () => {
                                        const result = await handleRunOnboardingCommand('init');
                                        if (result?.exitCode === 0) {
                                          setOnboardingWizardStep('doctor');
                                        }
                                      })();
                                    }}
                                    disabled={Boolean(onboardingCommandPending) || appSettingsLoading || appSettingsDirty}
                                  >
                                    {onboardingCommandPending === 'init' ? 'Running Init…' : 'Run Init'}
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
                                      `scout doctor` reports the broker, your source roots, and the projects that were discovered from them.
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
                                    onClick={() => {
                                      void (async () => {
                                        const result = await handleRunOnboardingCommand('doctor');
                                        if (result?.exitCode === 0) {
                                          setOnboardingWizardStep('runtimes');
                                        }
                                      })();
                                    }}
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
                                      `scout runtimes` checks the local programs behind each harness and tells you whether they are ready to serve turns.
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
                              The buttons in this wizard run these exact commands. The UI only helps you answer the inputs one decision at a time.
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
                                  <div className="text-[10px] mt-1" style={s.mutedText}>cwd: {onboardingCommandResult.cwd}</div>
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

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: C.accentBg }}>
                            <FolderOpen size={18} style={{ color: C.accent }} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Additional Inputs</div>
                            <div className="text-[13px] font-medium mt-1" style={s.inkText}>Everything the wizard does not need to ask first</div>
                            <div className="text-[11px] mt-1 leading-[1.5]" style={s.mutedText}>
                              These settings are still local and still important, but they are secondary to the source root, harness, and command-backed onboarding flow above.
                            </div>
                          </div>
                        </div>

                        {appSettingsLoading ? (
                          <div className="text-[11px]" style={s.mutedText}>Loading settings…</div>
                        ) : (
                          <div className="space-y-4">
                            <div>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Your Name</div>
                              {isAppSettingsEditing ? (
                                <input
                                  ref={settingsOperatorNameRef}
                                  value={visibleAppSettings?.operatorName ?? ''}
                                  onChange={(event) => {
                                    setAppSettingsDraft((current) => current ? {
                                      ...current,
                                      operatorName: event.target.value,
                                    } : current);
                                    setAppSettingsFeedback(null);
                                  }}
                                  readOnly={appSettingsSaving}
                                  placeholder={appSettings?.operatorNameDefault ?? 'Operator'}
                                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] leading-[1.5] bg-transparent outline-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                />
                              ) : (
                                <div className="rounded-xl border px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                  <div className="text-[20px] font-semibold tracking-tight" style={s.inkText}>
                                    {visibleAppSettings?.operatorName ?? visibleAppSettings?.operatorNameDefault ?? 'Operator'}
                                  </div>
                                  <div className="text-[11px] mt-1 leading-[1.5]" style={s.mutedText}>
                                    {visibleAppSettings?.note ?? 'Shown everywhere the desktop shell refers to you.'}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Session Prefix</div>
                                {isAppSettingsEditing ? (
                                  <input
                                    value={visibleAppSettings?.sessionPrefix ?? 'relay'}
                                    onChange={(event) => {
                                      setAppSettingsDraft((current) => current ? {
                                        ...current,
                                        sessionPrefix: event.target.value,
                                      } : current);
                                      setAppSettingsFeedback(null);
                                    }}
                                    readOnly={appSettingsSaving}
                                    className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                    style={{ borderColor: C.border, color: C.ink }}
                                  />
                                ) : (
                                  <div className="text-[13px] font-medium" style={s.inkText}>{visibleAppSettings?.sessionPrefix ?? 'relay'}</div>
                                )}
                              </div>
                            </div>

                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Default Capabilities</div>
                              {isAppSettingsEditing ? (
                                <textarea
                                  value={(visibleAppSettings?.defaultCapabilities ?? []).join('\n')}
                                  onChange={(event) => {
                                    setAppSettingsDraft((current) => current ? {
                                      ...current,
                                      defaultCapabilities: event.target.value.split(/[\r\n,]/g).map((entry) => entry.trim()).filter(Boolean),
                                    } : current);
                                    setAppSettingsFeedback(null);
                                  }}
                                  readOnly={appSettingsSaving}
                                  rows={3}
                                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] leading-[1.5] bg-transparent outline-none resize-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                />
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {(visibleAppSettings?.defaultCapabilities ?? []).map((capability) => (
                                    <span key={capability} className="text-[10px] font-mono px-2 py-1 rounded" style={s.tagBadge}>
                                      {capability}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <label className="flex items-center gap-2 rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
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
                              <div className="min-w-0">
                                <div className="text-[12px] font-medium" style={s.inkText}>Include the Relay context root</div>
                                <div className="text-[11px] leading-[1.5]" style={s.mutedText}>
                                  Create a local `.openscout/project.json` at the selected Relay context root and keep that context in discovery.
                                </div>
                              </div>
                            </label>

                          </div>
                        )}
                      </section>
                    </div>

                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Vocabulary</div>
                        <div className="space-y-3">
                          {[
                            ['Source Root', 'The parent folder that contains many repos. Point OpenScout at `~/dev`, `~/src`, or whichever folder you actually keep your projects in.'],
                            ['Harness', 'The assistant family a project should prefer by default. Today that is `claude` or `codex`.'],
                            ['Runtime', 'The local installed program or long-running session OpenScout uses to launch a harness and keep it available for work.'],
                          ].map(([label, detail]) => (
                            <div key={label} className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="text-[11px] font-medium" style={s.inkText}>{label}</div>
                              <div className="text-[10px] mt-1 leading-[1.5]" style={s.mutedText}>{detail}</div>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Project Inventory</div>
                        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                          {(visibleAppSettings?.projectInventory ?? []).length > 0 ? (visibleAppSettings?.projectInventory ?? []).map((project) => (
                            <button
                              key={project.id}
                              onClick={() => {
                                if (project.registrationKind === 'configured') {
                                  openAgentProfile(project.id);
                                }
                              }}
                              className="w-full text-left rounded-lg border px-3 py-3 transition-opacity hover:opacity-90"
                              style={{ borderColor: C.border, backgroundColor: C.bg }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[12px] font-medium truncate" style={s.inkText}>{project.title}</div>
                                  <div className="text-[10px] mt-1 leading-[1.4]" style={s.mutedText}>
                                    {project.relativePath === '.' ? project.root : `${project.relativePath} · ${project.root}`}
                                  </div>
                                  <div className="text-[10px] mt-1" style={s.mutedText}>
                                    {project.registrationKind === 'configured' ? 'configured agent' : 'discovered project'} · default {project.defaultHarness}
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    {project.harnesses.map((harness) => (
                                      <span
                                        key={`${project.id}:${harness.harness}`}
                                        className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                                        style={harness.readinessState === 'ready' ? s.activePill : s.tagBadge}
                                        title={harness.readinessDetail ?? undefined}
                                      >
                                        {harness.harness} · {harness.detail}
                                      </span>
                                    ))}
                                  </div>
                                  <div className="text-[10px] mt-2" style={s.mutedText}>
                                    Source root: {project.sourceRoot}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {project.projectConfigPath ? (
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>manifest</span>
                                  ) : null}
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={project.registrationKind === 'configured' ? s.activePill : s.tagBadge}>
                                    {project.registrationKind === 'configured' ? 'agent' : 'project'}
                                  </span>
                                </div>
                              </div>
                            </button>
                          )) : (
                            <div className="text-[11px]" style={s.mutedText}>No projects discovered yet.</div>
                          )}
                        </div>
                      </section>

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Runtime Readiness</div>
                        <div className="grid grid-cols-1 gap-2">
                          {(visibleAppSettings?.runtimeCatalog ?? []).length > 0 ? (visibleAppSettings?.runtimeCatalog ?? []).map((runtimeEntry) => (
                            <div key={runtimeEntry.name} className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[12px] font-medium" style={s.inkText}>{runtimeEntry.label}</div>
                                  <div className="text-[10px] mt-1 leading-[1.4]" style={s.mutedText}>{runtimeEntry.readinessDetail}</div>
                                </div>
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={runtimeEntry.readinessState === 'ready' ? s.activePill : s.tagBadge}>
                                  {runtimeEntry.readinessState}
                                </span>
                              </div>
                            </div>
                          )) : (
                            <div className="text-[11px]" style={s.mutedText}>No runtimes reported yet.</div>
                          )}
                        </div>
                      </section>

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Canonical Paths</div>
                        <div className="grid grid-cols-1 gap-3">
                          {[
                            ['Settings', visibleAppSettings?.settingsPath ?? 'Not reported'],
                            ['Support Directory', visibleAppSettings?.supportDirectory ?? 'Not reported'],
                            ['Agent Registry', visibleAppSettings?.relayAgentsPath ?? 'Not reported'],
                            ['Current Project', visibleAppSettings?.currentProjectConfigPath ?? 'Not created'],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                              <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Broker Service</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          {[
                            ['Label', visibleAppSettings?.broker.label ?? 'Not reported'],
                            ['Reachable', visibleAppSettings?.broker.reachable ? 'Yes' : 'No'],
                            ['Installed', visibleAppSettings?.broker.installed ? 'Yes' : 'No'],
                            ['Loaded', visibleAppSettings?.broker.loaded ? 'Yes' : 'No'],
                            ['Broker URL', visibleAppSettings?.broker.url ?? 'Not reported'],
                            ['LaunchAgent', visibleAppSettings?.broker.launchAgentPath ?? 'Not reported'],
                            ['Stdout Log', visibleAppSettings?.broker.stdoutLogPath ?? 'Not reported'],
                            ['Stderr Log', visibleAppSettings?.broker.stderrLogPath ?? 'Not reported'],
                          ].map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                              <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  </div>
                ) : settingsSection === 'agents' ? (
                  <div className="grid grid-cols-[minmax(280px,0.58fr)_minmax(0,1.42fr)] gap-4">
                    <section className="border rounded-xl p-5 min-w-0" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Configured Agents</div>
                      <div className="flex flex-col gap-2 max-h-[780px] overflow-y-auto pr-1">
                        {interAgentAgents.length > 0 ? interAgentAgents.map((agent) => (
                          <button
                            key={agent.id}
                            onClick={() => {
                              setSelectedInterAgentId(agent.id);
                              setSelectedInterAgentThreadId(firstInterAgentThreadIdForAgent(interAgentThreads, agent.id));
                              setIsAgentConfigEditing(false);
                              setAgentConfigFeedback(null);
                            }}
                            className="w-full text-left border rounded-lg px-3 py-3 transition-opacity hover:opacity-90"
                            style={{ borderColor: C.border, backgroundColor: selectedInterAgentId === agent.id ? C.bg : C.surface }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex items-start gap-3">
                                <div
                                  className={`w-8 h-8 rounded text-white flex items-center justify-center text-[11px] font-bold shrink-0 ${agent.reachable ? '' : 'opacity-40 grayscale'}`}
                                  style={{ backgroundColor: colorForIdentity(agent.id) }}
                                >
                                  {agent.title.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <div className="text-[12px] font-medium truncate" style={s.inkText}>{agent.title}</div>
                                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                                      {interAgentProfileKindLabel(agent.profileKind)}
                                    </span>
                                  </div>
                                  <div className="text-[10px] mt-1 leading-[1.4]" style={s.mutedText}>
                                    {agent.summary ?? agent.subtitle}
                                  </div>
                                  <div className="text-[10px] mt-1" style={s.mutedText}>
                                    {agent.harness ?? 'runtime'} · {agent.transport ?? 'transport'} · {agent.threadCount} threads
                                  </div>
                                </div>
                              </div>
                              <span className="text-[10px] font-mono shrink-0" style={s.mutedText}>
                                {agent.timestampLabel ?? ''}
                              </span>
                            </div>
                          </button>
                        )) : (
                          <div className="text-[11px]" style={s.mutedText}>No registered agents found.</div>
                        )}
                      </div>
                    </section>

                    <div className="space-y-4 min-w-0">
                      {!selectedInterAgent ? (
                        <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                          <div className="text-[13px] font-medium mb-1" style={s.inkText}>No agent selected</div>
                          <div className="text-[12px] leading-[1.6]" style={s.mutedText}>
                            Pick a relay agent from the left to edit its runtime, system prompt, tool use, and capabilities.
                          </div>
                        </section>
                      ) : (
                        <>
                          <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Selected Agent</div>
                                <div className="text-[20px] font-semibold tracking-tight mt-2" style={s.inkText}>{selectedInterAgent.title}</div>
                                <div className="text-[12px] mt-2 leading-[1.6]" style={s.mutedText}>
                                  {interAgentProfileKindLabel(selectedInterAgent.profileKind)} · {selectedInterAgent.statusDetail ?? selectedInterAgent.summary ?? 'Stored runtime definition and prompt template.'}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                                  style={{ color: C.ink }}
                                  onClick={() => openRelayAgentThread(selectedInterAgent.id, { focusComposer: true })}
                                >
                                  Message
                                </button>
                                <button
                                  className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                                  style={{ color: C.ink }}
                                  onClick={() => openAgentProfile(selectedInterAgent.id)}
                                >
                                  Open Overview
                                </button>
                              </div>
                            </div>
                          </section>

                          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
                            <section className="border rounded-xl p-5 min-w-0" style={{ ...s.surface, borderColor: C.border }}>
                              <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>System Prompt</div>
                              {agentConfigLoading ? (
                                <div className="text-[11px]" style={s.mutedText}>Loading system prompt…</div>
                              ) : isAgentConfigEditing ? (
                                <textarea
                                  ref={agentSystemPromptRef}
                                  value={visibleAgentConfig?.systemPrompt ?? ''}
                                  onChange={(event) => {
                                    setAgentConfigDraft((current) => current ? {
                                      ...current,
                                      systemPrompt: event.target.value,
                                    } : current);
                                    setAgentConfigFeedback(null);
                                  }}
                                  readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                                  className="w-full min-h-[460px] rounded-lg border px-3 py-3 text-[11px] font-mono leading-[1.55] resize-y bg-transparent outline-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                />
                              ) : (
                                <div
                                  ref={agentSystemPromptViewRef}
                                  tabIndex={0}
                                  className="w-full min-h-[460px] max-h-[760px] overflow-auto rounded-lg border px-3 py-3 text-[11px] font-mono leading-[1.6] whitespace-pre-wrap break-words outline-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                >
                                  {visibleAgentConfig?.systemPrompt ?? 'System prompt unavailable.'}
                                </div>
                              )}
                              {visibleAgentConfig?.systemPromptHint ? (
                                <div className="text-[11px] mt-2 leading-[1.5]" style={s.mutedText}>{visibleAgentConfig.systemPromptHint}</div>
                              ) : null}
                              {agentConfigFeedback ? (
                                <div className="text-[11px] mt-2 leading-[1.5]" style={s.inkText}>{agentConfigFeedback}</div>
                              ) : null}
                            </section>

                            <div className="space-y-4 min-w-0">
                              <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                                <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Runtime</div>
                                {agentConfigLoading ? (
                                  <div className="text-[11px]" style={s.mutedText}>Loading runtime…</div>
                                ) : isAgentConfigEditing ? (
                                  <div className="space-y-3">
                                    <div>
                                      <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Path</div>
                                      <input
                                        ref={agentRuntimePathRef}
                                        value={visibleAgentConfig?.runtime.cwd ?? ''}
                                        onChange={(event) => {
                                          setAgentConfigDraft((current) => current ? {
                                            ...current,
                                            runtime: {
                                              ...current.runtime,
                                              cwd: event.target.value,
                                            },
                                          } : current);
                                          setAgentConfigFeedback(null);
                                        }}
                                        readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                                        className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                                        style={{ borderColor: C.border, color: C.ink }}
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                      <div>
                                        <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Harness</div>
                                        <select
                                          value={visibleAgentConfig?.runtime.harness ?? ''}
                                          onChange={(event) => {
                                            setAgentConfigDraft((current) => current ? {
                                              ...current,
                                              runtime: {
                                                ...current.runtime,
                                                harness: event.target.value,
                                              },
                                            } : current);
                                            setAgentConfigFeedback(null);
                                          }}
                                          disabled={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                                          className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                                          style={{ borderColor: C.border, color: C.ink }}
                                        >
                                          {visibleAgentConfig?.availableHarnesses.map((harness) => (
                                            <option key={harness} value={harness}>{harness}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div>
                                        <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Session</div>
                                        <input
                                          value={visibleAgentConfig?.runtime.sessionId ?? ''}
                                          onChange={(event) => {
                                            setAgentConfigDraft((current) => current ? {
                                              ...current,
                                              runtime: {
                                                ...current.runtime,
                                                sessionId: event.target.value,
                                              },
                                            } : current);
                                            setAgentConfigFeedback(null);
                                          }}
                                          readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                                          className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                                          style={{ borderColor: C.border, color: C.ink }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                    {[
                                      ['Path', visibleAgentConfig?.runtime.cwd ?? compactHomePath(selectedInterAgent.projectRoot ?? selectedInterAgent.cwd) ?? 'Not reported'],
                                      ['Harness', visibleAgentConfig?.runtime.harness ?? selectedInterAgent.harness ?? 'Not reported'],
                                      ['Session', visibleAgentConfig?.runtime.sessionId ?? selectedInterAgent.sessionId ?? 'Not reported'],
                                      ['Transport', visibleAgentConfig?.runtime.transport ?? selectedInterAgent.transport ?? 'Not reported'],
                                      ['Wake Policy', visibleAgentConfig?.runtime.wakePolicy || selectedInterAgent.wakePolicy || 'Not reported'],
                                      ['Live Runtime', compactHomePath(selectedInterAgent.projectRoot ?? selectedInterAgent.cwd) ?? 'Not reported'],
                                    ].map(([label, value]) => (
                                      <div key={label} className="min-w-0">
                                        <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                                        <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{value}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>

                              <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                                <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Tool Use</div>
                                {isAgentConfigEditing ? (
                                  <textarea
                                    value={visibleAgentConfig?.toolUse.launchArgsText ?? ''}
                                    onChange={(event) => {
                                      setAgentConfigDraft((current) => current ? {
                                        ...current,
                                        toolUse: {
                                          ...current.toolUse,
                                          launchArgsText: event.target.value,
                                        },
                                      } : current);
                                      setAgentConfigFeedback(null);
                                    }}
                                    readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                                    className="w-full min-h-[132px] rounded-lg border px-3 py-3 text-[11px] font-mono leading-[1.5] resize-y bg-transparent outline-none"
                                    style={{ borderColor: C.border, color: C.ink }}
                                  />
                                ) : (
                                  <div className="rounded-lg border px-3 py-3 text-[11px] font-mono leading-[1.55] whitespace-pre-wrap break-words min-h-[88px]" style={{ borderColor: C.border, color: C.ink }}>
                                    {normalizeDraftText(visibleAgentConfig?.toolUse.launchArgsText ?? '') || 'No launch args configured.'}
                                  </div>
                                )}
                              </section>

                              <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                                <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Capabilities</div>
                                {isAgentConfigEditing ? (
                                  <input
                                    value={visibleAgentConfig?.capabilitiesText ?? ''}
                                    onChange={(event) => {
                                      setAgentConfigDraft((current) => current ? {
                                        ...current,
                                        capabilitiesText: event.target.value,
                                      } : current);
                                      setAgentConfigFeedback(null);
                                    }}
                                    readOnly={!hasEditableAgentConfig || agentConfigSaving || agentConfigRestarting}
                                    className="w-full rounded-lg border px-3 py-2.5 text-[11px] leading-[1.5] bg-transparent outline-none"
                                    style={{ borderColor: C.border, color: C.ink }}
                                  />
                                ) : null}
                                {agentCapabilitiesPreview.length > 0 ? (
                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    {agentCapabilitiesPreview.map((capability) => (
                                      <span key={capability} className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                                        {capability}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[11px]" style={s.mutedText}>No capabilities configured.</div>
                                )}
                              </section>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : settingsSection === 'communication' ? (
                  <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] gap-4">
                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: C.accentBg }}>
                            <Radio size={18} style={{ color: C.accent }} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Telegram Bridge</div>
                            <div className="text-[13px] font-medium mt-1" style={s.inkText}>ChatSDK-backed Telegram delivery and ingest</div>
                            <div className="text-[11px] mt-1 leading-[1.5]" style={s.mutedText}>
                              The desktop bridge uses ChatSDK in-process and should normally run in polling mode. Polling is the safe default for a long-running local app because Telegram webhooks require a public endpoint that this desktop app does not host.
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="flex items-center gap-2 rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                            <input
                              type="checkbox"
                              checked={visibleAppSettings?.telegram.enabled ?? false}
                              disabled={!isAppSettingsEditing || appSettingsSaving}
                              onChange={(event) => {
                                setAppSettingsDraft((current) => current ? {
                                  ...current,
                                  telegram: {
                                    ...current.telegram,
                                    enabled: event.target.checked,
                                  },
                                } : current);
                                setAppSettingsFeedback(null);
                              }}
                            />
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium" style={s.inkText}>Enable Telegram bridge</div>
                              <div className="text-[11px] leading-[1.5]" style={s.mutedText}>
                                Starts the desktop Telegram bridge on launch and routes inbound/outbound Telegram traffic through the broker.
                              </div>
                            </div>
                          </label>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Mode</div>
                              {isAppSettingsEditing ? (
                                <select
                                  value={visibleAppSettings?.telegram.mode ?? 'polling'}
                                  onChange={(event) => {
                                    setAppSettingsDraft((current) => current ? {
                                      ...current,
                                      telegram: {
                                        ...current.telegram,
                                        mode: event.target.value as 'auto' | 'webhook' | 'polling',
                                      },
                                    } : current);
                                    setAppSettingsFeedback(null);
                                  }}
                                  disabled={appSettingsSaving}
                                  className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                >
                                  <option value="polling">polling</option>
                                  <option value="auto">auto</option>
                                  <option value="webhook">webhook</option>
                                </select>
                              ) : (
                                <div className="text-[13px] font-medium" style={s.inkText}>{visibleAppSettings?.telegram.mode ?? 'polling'}</div>
                              )}
                            </div>

                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Telegram Target</div>
                              {isAppSettingsEditing ? (
                                <input
                                  value={visibleAppSettings?.telegram.defaultConversationId ?? 'dm.scout.primary'}
                                  onChange={(event) => {
                                    setAppSettingsDraft((current) => current ? {
                                      ...current,
                                      telegram: {
                                        ...current.telegram,
                                        defaultConversationId: event.target.value,
                                      },
                                    } : current);
                                    setAppSettingsFeedback(null);
                                  }}
                                  readOnly={appSettingsSaving}
                                  className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                />
                              ) : (
                                <div className="text-[13px] font-medium" style={s.inkText}>{visibleAppSettings?.telegram.defaultConversationId ?? 'dm.scout.primary'}</div>
                              )}
                            </div>
                          </div>

                          <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Owner Node</div>
                            {isAppSettingsEditing ? (
                              <input
                                value={visibleAppSettings?.telegram.ownerNodeId ?? ''}
                                onChange={(event) => {
                                  setAppSettingsDraft((current) => current ? {
                                    ...current,
                                    telegram: {
                                      ...current.telegram,
                                      ownerNodeId: event.target.value,
                                    },
                                  } : current);
                                  setAppSettingsFeedback(null);
                                }}
                                readOnly={appSettingsSaving}
                                placeholder="Leave blank for automatic mesh owner election"
                                className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                style={{ borderColor: C.border, color: C.ink }}
                              />
                            ) : (
                              <div className="text-[13px] font-medium break-words" style={s.inkText}>
                                {visibleAppSettings?.telegram.ownerNodeId || 'Automatic mesh owner'}
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Bot Username</div>
                              {isAppSettingsEditing ? (
                                <input
                                  value={visibleAppSettings?.telegram.userName ?? ''}
                                  onChange={(event) => {
                                    setAppSettingsDraft((current) => current ? {
                                      ...current,
                                      telegram: {
                                        ...current.telegram,
                                        userName: event.target.value,
                                      },
                                    } : current);
                                    setAppSettingsFeedback(null);
                                  }}
                                  readOnly={appSettingsSaving}
                                  className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                />
                              ) : (
                                <div className="text-[13px] font-medium break-words" style={s.inkText}>{visibleAppSettings?.telegram.userName || 'Not set'}</div>
                              )}
                            </div>

                            <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>API Base URL</div>
                              {isAppSettingsEditing ? (
                                <input
                                  value={visibleAppSettings?.telegram.apiBaseUrl ?? ''}
                                  onChange={(event) => {
                                    setAppSettingsDraft((current) => current ? {
                                      ...current,
                                      telegram: {
                                        ...current.telegram,
                                        apiBaseUrl: event.target.value,
                                      },
                                    } : current);
                                    setAppSettingsFeedback(null);
                                  }}
                                  readOnly={appSettingsSaving}
                                  className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                />
                              ) : (
                                <div className="text-[13px] font-medium break-words" style={s.inkText}>{visibleAppSettings?.telegram.apiBaseUrl || 'Default Telegram API'}</div>
                              )}
                            </div>
                          </div>

                          <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Bot Token</div>
                            {isAppSettingsEditing ? (
                              <input
                                type="password"
                                value={visibleAppSettings?.telegram.botToken ?? ''}
                                onChange={(event) => {
                                  setAppSettingsDraft((current) => current ? {
                                    ...current,
                                    telegram: {
                                      ...current.telegram,
                                      botToken: event.target.value,
                                    },
                                  } : current);
                                  setAppSettingsFeedback(null);
                                }}
                                readOnly={appSettingsSaving}
                                placeholder="Telegram bot token"
                                className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                style={{ borderColor: C.border, color: C.ink }}
                              />
                            ) : (
                              <div className="text-[12px]" style={s.inkText}>
                                {visibleAppSettings?.telegram.botToken ? 'Configured' : 'Not set'}
                              </div>
                            )}
                          </div>

                          <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Webhook Secret</div>
                            {isAppSettingsEditing ? (
                              <input
                                type="password"
                                value={visibleAppSettings?.telegram.secretToken ?? ''}
                                onChange={(event) => {
                                  setAppSettingsDraft((current) => current ? {
                                    ...current,
                                    telegram: {
                                      ...current.telegram,
                                      secretToken: event.target.value,
                                    },
                                  } : current);
                                  setAppSettingsFeedback(null);
                                }}
                                readOnly={appSettingsSaving}
                                placeholder="Optional webhook secret"
                                className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                style={{ borderColor: C.border, color: C.ink }}
                              />
                            ) : (
                              <div className="text-[12px]" style={s.inkText}>
                                {visibleAppSettings?.telegram.secretToken ? 'Configured' : 'Not set'}
                              </div>
                            )}
                          </div>

                          {appSettingsFeedback ? (
                            <div className="text-[11px] leading-[1.5]" style={s.inkText}>{appSettingsFeedback}</div>
                          ) : null}
                        </div>
                      </section>

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Relay Runtime</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          {[
                            ['Relay', runtime?.brokerHealthy ? 'Healthy' : runtime?.brokerReachable ? 'Reachable' : 'Offline'],
                            ['Relay URL', runtime?.brokerUrl ?? 'Not reported'],
                            ['Node ID', runtime?.nodeId ?? 'Not reported'],
                            ['Agents', `${runtime?.agentCount ?? 0}`],
                            ['Conversations', `${runtime?.conversationCount ?? 0}`],
                            ['Flights', `${runtime?.flightCount ?? 0}`],
                            ['Latest Relay', runtime?.latestRelayLabel ?? 'Not reported'],
                            ['Updated', runtime?.updatedAtLabel ?? 'Not reported'],
                          ].map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                              <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>

                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Telegram Status</div>
                            <div className="text-[11px] mt-1" style={s.mutedText}>
                              {visibleAppSettings?.telegram.detail ?? 'Telegram bridge status is not reported yet.'}
                            </div>
                          </div>
                          <span
                            className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded"
                            style={visibleAppSettings?.telegram.running ? s.activePill : s.tagBadge}
                          >
                            {visibleAppSettings?.telegram.running ? 'Running' : visibleAppSettings?.telegram.enabled ? 'Stopped' : 'Disabled'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          {[
                            ['Configured', visibleAppSettings?.telegram.configured ? 'Yes' : 'No'],
                            ['Enabled', visibleAppSettings?.telegram.enabled ? 'Yes' : 'No'],
                            ['Requested Mode', visibleAppSettings?.telegram.mode ?? 'polling'],
                            ['Runtime Mode', visibleAppSettings?.telegram.runtimeMode ?? 'Not running'],
                            ['Owner Node', visibleAppSettings?.telegram.ownerNodeId || 'Automatic'],
                            ['Bindings', `${visibleAppSettings?.telegram.bindingCount ?? 0}`],
                            ['Pending Deliveries', `${visibleAppSettings?.telegram.pendingDeliveries ?? 0}`],
                          ].map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                              <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{value}</div>
                            </div>
                          ))}
                        </div>
                        {visibleAppSettings?.telegram.lastError ? (
                          <div className="mt-3 pt-3 border-t" style={{ borderTopColor: C.border }}>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Last Error</div>
                            <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{visibleAppSettings.telegram.lastError}</div>
                          </div>
                        ) : null}
                      </section>

                      {brokerInspector ? (
                        <>
                          <section ref={relayServiceInspectorRef} className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div>
                                <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Relay Service</div>
                                <div className="text-[11px] mt-1" style={s.mutedText}>
                                  {brokerInspector.statusDetail ?? 'Relay service profile and runtime state.'}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={brokerInspector.reachable ? s.activePill : s.tagBadge}>
                                  {brokerInspector.statusLabel}
                                </span>
                                <Button
                                  type="button"
                                  variant={brokerInspector.reachable ? 'outline' : 'default'}
                                  size="sm"
                                  onClick={() => void handleBrokerControl(brokerInspector.reachable ? 'restart' : 'start')}
                                  disabled={brokerControlPending}
                                >
                                  {brokerInspector.reachable ? 'Restart' : 'Start'}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleBrokerControl('stop')}
                                  disabled={brokerControlPending || !brokerInspector.loaded}
                                >
                                  Stop
                                </Button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                              {[
                                ['Version', brokerInspector.version ?? 'Not reported'],
                                ['Mode', brokerInspector.mode],
                                ['Service Label', brokerInspector.label],
                                ['Relay URL', brokerInspector.url],
                                ['PID', brokerInspector.pid ?? 'Not reported'],
                                ['Last Restart', brokerInspector.lastRestartLabel ?? 'Not reported'],
                                ['Installed', brokerInspector.installed ? 'Yes' : 'No'],
                                ['Loaded', brokerInspector.loaded ? 'Yes' : 'No'],
                                ['Reachable', brokerInspector.reachable ? 'Yes' : 'No'],
                                ['Launch State', brokerInspector.launchdState ?? 'Not reported'],
                                ['Last Exit', brokerInspector.lastExitStatus ?? 'Not reported'],
                                ['Mesh', brokerInspector.meshId ?? 'Not reported'],
                              ].map(([label, value]) => (
                                <div key={label} className="min-w-0">
                                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                                  <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{value}</div>
                                </div>
                              ))}
                            </div>
                            {brokerInspector.processCommand ? (
                              <div className="mt-3 pt-3 border-t" style={{ borderTopColor: C.border }}>
                                <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Process</div>
                                <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{brokerInspector.processCommand}</div>
                              </div>
                            ) : null}
                            {brokerControlFeedback ? (
                              <div className="mt-3 pt-3 border-t text-[11px] leading-[1.45]" style={{ borderTopColor: C.border, color: C.ink }}>
                                {brokerControlFeedback}
                              </div>
                            ) : null}
                          </section>

                          <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                            <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Relay Paths</div>
                            <div className="space-y-3">
                              {[
                                ['Support', brokerInspector.supportDirectory],
                                ['Control Home', brokerInspector.controlHome],
                                ['LaunchAgent', brokerInspector.launchAgentPath],
                                ['Stdout Log', brokerInspector.stdoutLogPath],
                                ['Stderr Log', brokerInspector.stderrLogPath],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                                  <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{value}</div>
                                </div>
                              ))}
                            </div>
                            {brokerInspector.lastLogLine ? (
                              <div className="mt-3 pt-3 border-t" style={{ borderTopColor: C.border }}>
                                <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Last Service Log</div>
                                <div className="text-[11px] leading-[1.45] break-words" style={s.inkText}>{brokerInspector.lastLogLine}</div>
                              </div>
                            ) : null}
                          </section>

                          {brokerInspector.troubleshooting.length > 0 || brokerInspector.feedbackSummary ? (
                            <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                              <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Diagnostics</div>
                              {brokerInspector.troubleshooting.length > 0 ? (
                                <div className="space-y-2 mb-4">
                                  {brokerInspector.troubleshooting.map((item) => (
                                    <div key={item} className="text-[11px] leading-[1.5]" style={s.inkText}>{item}</div>
                                  ))}
                                </div>
                              ) : null}
                              {brokerInspector.feedbackSummary ? (
                                <div className="rounded-lg border px-3 py-3 text-[11px] font-mono leading-[1.55] whitespace-pre-wrap break-words" style={{ borderColor: C.border, color: C.ink }}>
                                  {brokerInspector.feedbackSummary}
                                </div>
                              ) : null}
                            </section>
                          ) : null}
                        </>
                      ) : null}

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Voice & Delivery</div>
                        <div className="space-y-3">
                          <div>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Capture</div>
                            <div className="text-[12px]" style={s.inkText}>{relayState?.voice.captureTitle ?? 'Not reported'}</div>
                          </div>
                          <div>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Replies</div>
                            <button
                              className="os-toolbar-button text-[11px] font-medium px-2 py-1 rounded"
                              style={{ color: C.ink }}
                              onClick={() => void handleSetVoiceRepliesEnabled(!(relayState?.voice.repliesEnabled ?? false))}
                            >
                              {relayState?.voice.repliesEnabled ? 'Disable voice replies' : 'Enable voice replies'}
                            </button>
                          </div>
                          <div>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>Reachable Directs</div>
                            <div className="text-[12px]" style={s.inkText}>{reachableRelayAgents.length}</div>
                          </div>
                        </div>
                      </section>

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Surfaces</div>
                        <div className="text-[12px] leading-[1.6]" style={s.mutedText}>
                          Relay remains the live operator-facing communication surface. Inter-Agent gives you passive visibility into private agent traffic without mixing it back into your own threads, and Logs stays focused on raw tails rather than service configuration.
                        </div>
                      </section>
                    </div>
                  </div>
                ) : settingsSection === 'database' ? (
                  <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(320px,0.85fr)] gap-4">
                    <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Session Index</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                        {[
                          ['Sessions Indexed', `${stats.totalSessions}`],
                          ['Messages Indexed', `${stats.totalMessages}`],
                          ['Projects', `${stats.projects}`],
                          ['Tokens', `${Math.round(stats.totalTokens / 1000)}k`],
                          ['Runtime Messages', `${runtime?.messageCount ?? 0}`],
                          ['tmux Sessions', `${runtime?.tmuxSessionCount ?? 0}`],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={s.mutedText}>{label}</div>
                            <div className="text-[15px] font-semibold" style={s.inkText}>{value}</div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Current Backing</div>
                        <div className="text-[12px] leading-[1.6]" style={s.mutedText}>
                          The desktop shell currently combines indexed session history with the live broker snapshot. The richer database controls from the v0 PR are useful directionally, but they are not wired in this Electron runtime yet.
                        </div>
                      </section>

                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Next Step</div>
                        <div className="text-[12px] leading-[1.6]" style={s.mutedText}>
                          If we want this section to become editable, the root fix is a real persisted storage config model in the runtime first, rather than adding disconnected form controls in the shell.
                        </div>
                      </section>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(320px,0.85fr)] gap-4">
                    <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Color Mode</div>
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
                            <div className="text-[10px] font-mono tracking-widest uppercase mb-1" style={s.mutedText}>Annotations</div>
                            <div className="text-[12px] leading-[1.6]" style={s.mutedText}>
                              Show routing and provenance tags inside Relay and Inter-Agent timelines.
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
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Current Surface</div>
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
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Direction</div>
                        <div className="text-[12px] leading-[1.6]" style={s.mutedText}>
                          The v0 PR includes richer theme, density, and typography controls. Those belong here once we promote them from purely visual settings to persisted desktop preferences.
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
                            onClick={() => {
                              setSelectedInterAgentId(agent.id);
                              setSelectedInterAgentThreadId(firstInterAgentThreadIdForAgent(interAgentThreads, agent.id));
                            }}
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
                              <div className="font-medium truncate" style={s.inkText}>{agent.title}</div>
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
              <div className="border-b px-4 py-4 shrink-0" style={{ ...s.surface, borderBottomColor: C.border }}>
                {selectedInterAgent ? (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="relative shrink-0">
                        <div
                          className={`w-11 h-11 rounded-2xl text-[15px] text-white flex items-center justify-center font-bold ${selectedInterAgent.reachable ? '' : 'opacity-40 grayscale'}`}
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-[16px] font-semibold tracking-tight truncate" style={s.inkText}>
                            {selectedInterAgent.title}
                          </div>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: C.tagBg, color: C.muted }}>
                            {interAgentProfileKindLabel(selectedInterAgent.profileKind)}
                          </span>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={selectedInterAgent.state === 'working' ? s.activePill : s.tagBadge}>
                            {selectedInterAgent.state === 'working' ? 'Working' : selectedInterAgent.state === 'offline' ? 'Offline' : 'Available'}
                          </span>
                        </div>
                        {normalizeLegacyAgentCopy(selectedInterAgent.role) ? (
                          <div className="text-[11px] mt-1.5" style={s.inkText}>
                            {normalizeLegacyAgentCopy(selectedInterAgent.role)}
                          </div>
                        ) : null}
                        <div className="text-[11px] leading-[1.55] mt-1 max-w-3xl" style={s.mutedText}>
                          {selectedInterAgent.statusDetail ?? selectedInterAgent.summary ?? 'Operational snapshot and recent thread activity.'}
                        </div>
                        <div className="mt-3 flex items-center gap-2 flex-wrap text-[10px]" style={s.mutedText}>
                          {selectedInterAgent.lastChatLabel ? (
                            <span className="rounded-full px-2 py-1" style={{ backgroundColor: C.bg }}>
                              Last chat {selectedInterAgent.lastChatLabel}
                            </span>
                          ) : null}
                          {selectedInterAgent.lastSessionLabel ? (
                            <span className="rounded-full px-2 py-1" style={{ backgroundColor: C.bg }}>
                              Last session {selectedInterAgent.lastSessionLabel}
                            </span>
                          ) : null}
                          {selectedInterAgent.harness ? (
                            <span className="rounded-full px-2 py-1 font-mono uppercase" style={{ backgroundColor: C.bg }}>
                              {selectedInterAgent.harness}
                            </span>
                          ) : null}
                          {selectedInterAgent.transport ? (
                            <span className="rounded-full px-2 py-1 font-mono uppercase" style={{ backgroundColor: C.bg }}>
                              {selectedInterAgent.transport}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <AgentActionButton
                        icon={<MessageSquare size={14} />}
                        tone={selectedInterAgentDirectThread ? 'primary' : 'neutral'}
                        onClick={() => openRelayAgentThread(selectedInterAgent.id, { focusComposer: true })}
                      >
                        {selectedInterAgentChatActionLabel}
                      </AgentActionButton>
                      {visibleInterAgentThreads.length > 0 ? (
                        <AgentActionButton
                          icon={<Network size={14} />}
                          onClick={() => setActiveView('inter-agent')}
                        >
                          Open Threads
                        </AgentActionButton>
                      ) : null}
                      <AgentActionButton
                        icon={<Eye size={14} />}
                        onClick={() => handlePeekAgentSession()}
                      >
                        Peek
                      </AgentActionButton>
                      <AgentActionButton
                        icon={<Settings size={14} />}
                        onClick={() => openAgentSettings(selectedInterAgent.id, selectedInterAgent.profileKind === 'project')}
                      >
                        {selectedInterAgent.profileKind === 'project' ? 'Configure' : 'Open Settings'}
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
                  <div className="grid grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] gap-4">
                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border, backgroundColor: C.surface }}>
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Activity Tail</div>
                            <div className="text-[11px] mt-1" style={s.mutedText}>
                              Broker-native asks, replies, and status signals touching {selectedInterAgent.title}. This is the operational trail behind Scout&apos;s routing work.
                            </div>
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

                        <div className="px-4 py-4 max-h-[420px] overflow-y-auto" style={{ backgroundColor: C.bg }}>
                          {selectedInterAgentActivityMessages.length > 0 ? (
                            <RelayTimeline
                              messages={selectedInterAgentActivityMessages}
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
                        </div>
                      </section>

                      <section className="border rounded-xl p-4" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div>
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Open Threads</div>
                            <div className="text-[11px] mt-1" style={s.mutedText}>
                              Your direct line first, then the other channels this agent is actively involved in.
                            </div>
                          </div>
                          {visibleInterAgentThreads.length > 0 ? (
                            <button
                              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                              style={{ color: C.ink }}
                              onClick={() => setActiveView('inter-agent')}
                            >
                              Open Inter-Agent
                            </button>
                          ) : null}
                        </div>
                        <div className="flex flex-col gap-3">
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
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                                      style={{ color: C.ink }}
                                      onClick={() => openRelayAgentThread(selectedInterAgent.id, {
                                        draft: agentThreadFollowUpDraft(thread, selectedInterAgent.id),
                                        focusComposer: true,
                                      })}
                                    >
                                      Ask About This
                                    </button>
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
                      </section>
                    </div>

                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl overflow-hidden" style={{ ...s.surface, borderColor: C.border }}>
                        <div
                          className="px-4 py-3 border-b flex items-center justify-between gap-3"
                          style={{ backgroundColor: C.surface, borderBottomColor: C.border }}
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#f97316' }}></span>
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#facc15' }}></span>
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#22c55e' }}></span>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Live Session</div>
                              <div className="text-[11px] mt-1 truncate" style={s.mutedText}>
                                {agentSessionPending
                                  ? 'Checking tmux pane and runtime logs for the selected agent.'
                                  : visibleAgentSession?.mode === 'tmux'
                                  ? 'Live tmux pane capture for the selected agent.'
                                  : visibleAgentSession?.mode === 'logs'
                                    ? 'Canonical runtime session logs for the selected agent.'
                                    : 'No live tmux pane or predictable runtime logs are available yet.'}
                              </div>
                            </div>
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

                        <div
                          className="px-4 py-2 border-b flex items-center gap-2 flex-wrap text-[10px]"
                          style={{ backgroundColor: C.bg, borderBottomColor: C.border, color: C.muted }}
                        >
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={visibleAgentSession?.mode === 'tmux' ? s.activePill : s.tagBadge}>
                            {agentSessionPending ? 'Loading' : visibleAgentSession?.mode === 'tmux' ? 'TMUX' : visibleAgentSession?.mode === 'logs' ? 'Logs' : 'Unavailable'}
                          </span>
                          {(visibleAgentSession?.harness ?? selectedInterAgent?.harness) ? (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                              {visibleAgentSession?.harness ?? selectedInterAgent?.harness}
                            </span>
                          ) : null}
                          {(visibleAgentSession?.transport ?? selectedInterAgent?.transport) ? (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                              {visibleAgentSession?.transport ?? selectedInterAgent?.transport}
                            </span>
                          ) : null}
                          {(visibleAgentSession?.sessionId ?? selectedInterAgent?.sessionId) ? (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>
                              {visibleAgentSession?.sessionId ?? selectedInterAgent?.sessionId}
                            </span>
                          ) : null}
                          {visibleAgentSession?.updatedAtLabel ? <span>Updated {visibleAgentSession.updatedAtLabel}</span> : null}
                          {typeof visibleAgentSession?.lineCount === 'number' && visibleAgentSession.lineCount > 0 ? <span>{visibleAgentSession.lineCount} lines</span> : null}
                          {visibleAgentSession?.truncated ? <span>Tail only</span> : null}
                        </div>

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
                              className="px-4 py-4 text-[11px] leading-[1.6] overflow-x-auto whitespace-pre-wrap break-words min-h-[320px] max-h-[520px] overflow-y-auto"
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
                            {visibleAgentSession?.pathLabel ?? compactHomePath(selectedInterAgent?.cwd ?? selectedInterAgent?.projectRoot) ?? 'No stable session path yet.'}
                          </div>
                          {agentSessionFeedback ? (
                            <div className="shrink-0" style={s.inkText}>{agentSessionFeedback}</div>
                          ) : null}
                        </div>
                      </section>

                      <section className="border rounded-xl p-4" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Operational Snapshot</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          {[
                            ['Agent ID', selectedInterAgent.id],
                            ['Source', visibleAgentConfig?.runtime.source ?? selectedInterAgent.source ?? 'Built-in'],
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
                        <div className="text-[11px] leading-[1.5] mt-3 pt-3 border-t" style={{ ...s.mutedText, borderTopColor: C.border }}>
                          The main agent view stays operational. Use Settings when you want to edit the system prompt, runtime definition, tools, or capabilities.
                        </div>
                      </section>
                    </div>
                  </div>
                )}
              </div>

              <div className="h-7 border-t flex items-center px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
                <span className="text-[9px] font-mono" style={s.mutedText}>Relay agent overview, live session, direct line, and recent thread activity</span>
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
                  {(['runtime', 'app', 'agents'] as const).map((group) => {
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
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <FileJson size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No log selected</h3>
                    <p className="text-[13px] max-w-sm" style={s.mutedText}>
                      Pick a relay runtime, app, or relay agent source from the left rail.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="border rounded-xl overflow-hidden min-h-[360px]" style={{ borderColor: C.border, backgroundColor: C.termBg }}>
                      <div className="px-4 py-2 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono uppercase tracking-widest" style={s.mutedText}>{selectedLogSource.title}</div>
                          <div className="text-[11px] truncate mt-1" style={s.mutedText}>{logContent?.pathLabel ?? selectedLogSource.pathLabel}</div>
                        </div>
                        <div className="text-[10px] font-mono shrink-0" style={s.mutedText}>
                          {logContent?.truncated ? 'Tail' : 'Full'}
                        </div>
                      </div>
                      {logsLoading && !logContent ? (
                        <div className="flex items-center justify-center min-h-[240px]">
                          <div className="flex flex-col items-center gap-3">
                            <Loader2 size={18} className="animate-spin" style={{ color: C.accent }} />
                            <span className="text-[13px]" style={s.mutedText}>Loading log tail…</span>
                          </div>
                        </div>
                      ) : logContent?.missing ? (
                        <div className="flex flex-col items-center justify-center min-h-[240px] px-6 text-center">
                          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                            <FileJson size={24} style={{ color: C.accent }} />
                          </div>
                          <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No log file yet</h3>
                          <p className="text-[13px] max-w-sm" style={s.mutedText}>
                            {selectedLogSource.title} has not written a log yet. This panel stays live and will update as soon as the next log line lands.
                          </p>
                        </div>
                      ) : (
                        <pre className="h-full overflow-auto p-4 text-[11px] leading-[1.55] whitespace-pre-wrap break-words" style={{ color: C.termFg }}>
                          {visibleLogBody || (logSearchQuery.trim() ? 'No visible lines match the current filter.' : '(empty log)')}
                        </pre>
                      )}
                    </div>
                  </div>
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
                            onClick={() => {
                              setSelectedInterAgentId(agent.id);
                              setSelectedInterAgentThreadId(firstInterAgentThreadIdForAgent(interAgentThreads, agent.id));
                            }}
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
                              <div className="font-medium truncate" style={s.inkText}>{agent.title}</div>
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
            {!isCollapsed && (
              <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
                <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={handleMouseDown} />
                <div className="px-3 py-2.5 flex items-center justify-between border-b" style={{ borderBottomColor: C.border }}>
                  <div>
                    <h1 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>Sessions</h1>
                    <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>{stats.totalSessions} total</div>
                  </div>
                  <button className="p-1.5 rounded transition-opacity hover:opacity-70" style={s.mutedText} onClick={() => void handleRefreshShell()}>
                    <RefreshCw size={14} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                  <div className="mb-3 px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Projects</div>
                    <div className="flex flex-col gap-px">
                      <button
                        onClick={() => setSelectedProject(null)}
                        className="flex items-center gap-2 px-1.5 py-1 rounded text-[12px] transition-opacity"
                        style={!selectedProject ? s.activeItem : s.mutedText}
                      >
                        <LayoutGrid size={12} style={!selectedProject ? { color: C.accent } : undefined} />
                        <span className="font-medium flex-1 truncate text-left">All Projects</span>
                        <span className="text-[9px] font-mono" style={s.mutedText}>{stats.totalSessions}</span>
                      </button>
                      {projects.map(project => (
                        <button
                          key={project.name}
                          onClick={() => setSelectedProject(selectedProject === project.name ? null : project.name)}
                          className="flex items-center gap-2 px-1.5 py-1 rounded text-[12px] transition-opacity"
                          style={selectedProject === project.name ? s.activeItem : s.mutedText}
                        >
                          <Folder size={12} style={selectedProject === project.name ? { color: C.accent } : undefined} />
                          <span className="font-medium flex-1 truncate text-left">{project.name}</span>
                          <span className="text-[9px] font-mono" style={s.mutedText}>{project.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Source</div>
                    <div className="flex flex-col gap-px">
                      <div className="flex items-center gap-2 px-1.5 py-1 text-[11px]" style={s.mutedText}>
                        <FileJson size={12} />
                        <span className="truncate">{runtime?.brokerUrl ?? 'Broker unavailable'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Main Sessions Area */}
            <div className="flex-1 flex flex-col relative min-w-0" style={s.surface}>
              <div className="h-10 border-b flex items-center justify-between px-4 shrink-0" style={{ ...s.surface, borderBottomColor: C.border }}>
                <div className="flex items-center gap-2 flex-1">
                  <Search size={14} style={s.mutedText} />
                  <input
                    type="text"
                    placeholder="Search sessions by title, content, tags, agent..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none text-[12px]"
                    style={{ color: C.ink }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="hover:opacity-70" style={s.mutedText}><X size={14} /></button>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {phonePreparationSaving && <Loader2 size={12} className="animate-spin" style={s.mutedText} />}
                  <button
                    type="button"
                    onClick={handlePreparePhone}
                    disabled={phonePreparationSaving || phonePreparationLoading || sessions.length === 0}
                    className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ backgroundColor: C.accentBg, color: C.accent }}
                  >
                    <Smartphone size={11} />
                    Prepare Phone
                  </button>
                  <div className="text-[10px] font-mono" style={s.mutedText}>{filteredSessions.length} results</div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {isLoadingShell && !shellState ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.accent, borderTopColor: 'transparent' }} />
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
                    <div className="flex items-center gap-2 mb-1">
                      <Smartphone size={13} style={{ color: C.accent }} />
                      <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>My List</div>
                    </div>
                    <div className="text-[12px] font-medium" style={s.inkText}>My List first, then browse and search.</div>
                    <div className="text-[10px] mt-1" style={s.mutedText}>
                      {phonePreparationState.preparedAt
                        ? `Prepared ${new Date(phonePreparationState.preparedAt).toLocaleString()}`
                        : 'Not prepared yet'}
                    </div>
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
                    <Loader2 size={12} className="animate-spin" />
                    Loading My List…
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
                          Drop sessions here to keep them pinned on the phone.
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
                          <Smartphone size={12} style={{ color: C.accent }} />
                          <div className="text-[11px] font-semibold" style={s.inkText}>My List</div>
                        </div>
                        <div className="text-[10px] font-mono" style={s.mutedText}>{quickHitPhoneSessions.length}</div>
                      </div>
                      {quickHitPhoneSessions.length === 0 ? (
                        <div className="rounded border border-dashed px-3 py-4 text-[11px]" style={{ borderColor: C.border, color: C.muted }}>
                          Prepare the phone for a fresh list, or drag sessions here and order them yourself.
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

        /* --- RELAY --- */
        ) : (
          <>
            {!isCollapsed && (
              <div style={{ width: sidebarWidth, ...s.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
                <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={handleMouseDown} />
                <div className="px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <h1 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>{relayState?.title ?? 'Relay'}</h1>
                    <div className="text-[10px] font-mono mt-0.5" style={s.mutedText}>
                      {relayState ? `${relayState.messages.length} msg / ${relayState.directs.length} agt` : 'Broker unavailable'}
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                  <div className="mb-3 px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Feeds</div>
                    <div className="flex flex-col gap-px">
                      {relayFeedItems.map((item) => {
                        const active = selectedRelayKind === item.kind && selectedRelayId === item.id;
                        return (
                          <button
                            key={`${item.kind}:${item.id}`}
                            className={`os-rail-row flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left${active ? ' os-rail-row-active' : ''}`}
                            style={active ? s.activeItem : s.mutedText}
                            onClick={() => {
                              setSelectedRelayKind(item.kind);
                              setSelectedRelayId(item.id);
                            }}
                          >
                            <RelayRailIcon id={item.id} active={active} />
                            <span className="font-medium text-[12px] flex-1 truncate">{cleanDisplayTitle(item.title)}</span>
                            {item.count > 0 ? (
                              <span className="os-row-count text-[9px] font-mono px-1 rounded" style={active ? s.activePill : s.tagBadge}>
                                {item.count}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mb-3 px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Conversations</div>
                    <div className="flex flex-col gap-px">
                      {relayConversationItems.map((item) => {
                        const active = selectedRelayKind === item.kind && selectedRelayId === item.id;
                        return (
                          <button
                            key={`${item.kind}:${item.id}`}
                            className={`os-rail-row flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left${active ? ' os-rail-row-active' : ''}`}
                            style={active ? s.activeItem : s.mutedText}
                            onClick={() => {
                              setSelectedRelayKind(item.kind);
                              setSelectedRelayId(item.id);
                            }}
                          >
                            <RelayRailIcon id={item.id} active={active} />
                            <span className="font-medium text-[12px] flex-1 truncate">{cleanDisplayTitle(item.title)}</span>
                            {item.count > 0 ? (
                              <span className="os-row-count text-[9px] font-mono px-1 rounded" style={active ? s.activePill : s.tagBadge}>
                                {item.count}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}

                      {relayState?.directs.length ? (
                        <div className="px-1.5 pt-2 pb-1 font-mono text-[8px] tracking-[0.22em] uppercase" style={s.mutedText}>
                          Direct Threads
                        </div>
                      ) : null}

                      {relayState?.directs.map((dm) => {
                        const active = selectedRelayKind === 'direct' && selectedRelayId === dm.id;
                        return (
                          <button
                            key={dm.id}
                            className={`os-rail-row flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left${active ? ' os-rail-row-active' : ''}`}
                            style={active ? s.activeItem : s.mutedText}
                            onClick={() => {
                              setSelectedRelayKind('direct');
                              setSelectedRelayId(dm.id);
                            }}
                          >
                            <div className="relative shrink-0">
                              <div
                                className={`os-rail-avatar w-4 h-4 rounded text-white flex items-center justify-center font-bold text-[8px] ${dm.reachable ? '' : 'opacity-40 grayscale'}`}
                                style={{ backgroundColor: colorForIdentity(dm.id) }}
                              >
                                {dm.title.charAt(0).toUpperCase()}
                              </div>
                              <div
                                className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${relayPresenceDotClass(dm.state)}`}
                                style={{ border: `1px solid ${C.bg}` }}
                              ></div>
                            </div>
                            <div className={`flex-1 min-w-0 ${dm.reachable ? '' : 'opacity-50'}`}>
                              <div className="flex items-center gap-1.5">
                                <div className="font-medium text-[12px] truncate">{cleanDisplayTitle(dm.title)}</div>
                                {dm.state === 'working' ? <TypingDots className="text-[var(--os-accent)]" /> : null}
                              </div>
                              <div className="text-[10px] truncate" style={s.mutedText}>{relaySecondaryText(dm)}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Agents</div>
                    <div className="flex flex-col gap-px">
                      {relayState?.directs.map((dm) => {
                        const active = selectedRelayKind === 'direct' && selectedRelayId === dm.id;
                        return (
                          <button
                            key={`agent-${dm.id}`}
                            className={`os-rail-row flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left${active ? ' os-rail-row-active' : ''}`}
                            style={active ? s.activeItem : s.mutedText}
                            onClick={() => {
                              setSelectedRelayKind('direct');
                              setSelectedRelayId(dm.id);
                            }}
                          >
                            <div className="relative shrink-0">
                              <div
                                className={`os-rail-avatar w-4 h-4 rounded text-white flex items-center justify-center font-bold text-[8px] ${dm.reachable ? '' : 'opacity-40 grayscale'}`}
                                style={{ backgroundColor: colorForIdentity(dm.id) }}
                              >
                                {dm.title.charAt(0).toUpperCase()}
                              </div>
                              <div
                                className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${relayPresenceDotClass(dm.state)}`}
                                style={{ border: `1px solid ${C.bg}` }}
                              ></div>
                            </div>
                            <div className={`flex-1 min-w-0 ${dm.reachable ? '' : 'opacity-50'}`}>
                              <div className="font-medium text-[12px] truncate">{cleanDisplayTitle(dm.title)}</div>
                              <div className="text-[10px] truncate" style={s.mutedText}>{dm.subtitle}</div>
                            </div>
                            {dm.state === 'working' ? <TypingDots className="text-[var(--os-accent)]" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col relative min-w-0" style={s.surface}>
              {/* Channel Header */}
              <div className="border-b flex items-center justify-between px-4 py-2 shrink-0 gap-4" style={{ ...s.surface, borderBottomColor: C.border }}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="shrink-0">
                    {selectedRelayKind === 'direct' ? (
                      <AtSign size={14} style={s.mutedText} />
                    ) : (
                      <RelayRailIcon id={selectedRelayId} active={false} size={14} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="text-[13px] font-semibold tracking-tight truncate" style={s.inkText}>{relayThreadTitle}</h2>
                      {relayCurrentDestination && 'count' in relayCurrentDestination && relayCurrentDestination.count > 0 ? (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={s.tagBadge}>
                          {relayCurrentDestination.count}
                        </span>
                      ) : null}
                      {selectedRelayDirectThread ? <RelayPresenceBadge thread={selectedRelayDirectThread} /> : null}
                    </div>
                    {relayThreadSubtitle ? (
                      <div className="text-[10px] truncate mt-0.5" style={s.mutedText}>
                        {relayThreadSubtitle}
                      </div>
                    ) : null}
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
                  <button
                    className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
                    style={relayState?.voice.isCapturing ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
                    onClick={() => void handleToggleVoiceCapture()}
                    title={relayState?.voice.detail ?? undefined}
                  >
                    {relayState?.voice.captureTitle ?? 'Capture'} <span className="font-mono uppercase" style={{ color: C.accent }}>{relayState?.voice.captureState ?? 'Off'}</span>
                  </button>
                  <button
                    className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
                    style={relayState?.voice.repliesEnabled ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
                    onClick={() => void handleSetVoiceRepliesEnabled(!(relayState?.voice.repliesEnabled ?? false))}
                    title={relayState?.voice.detail ?? undefined}
                  >
                    Playback <span className="font-mono uppercase" style={{ color: C.accent }}>{relayState?.voice.speaking ? 'Speaking' : relayState?.voice.repliesEnabled ? 'On' : 'Off'}</span>
                  </button>
                  <button className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded" style={{ color: C.ink }} onClick={() => void handleRefreshShell()}>
                    Sync
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
                {visibleRelayMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                      <MessageSquare size={24} style={{ color: C.accent }} />
                    </div>
                    <h3 className="text-[15px] font-medium mb-1" style={s.inkText}>No relay traffic yet</h3>
                    <p className="text-[13px] max-w-sm" style={s.mutedText}>
                      Send a message into this lane to wake an agent or start a broker-backed conversation.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <RelayTimeline
                      messages={visibleRelayMessages}
                      showAnnotations={showAnnotations}
                      showStatusMessages={selectedRelayKind === 'channel' && selectedRelayId === 'system'}
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
                    {selectedRelayDirectThread?.state === 'working' ? (
                      <RelayThinkingIndicator
                        thread={selectedRelayDirectThread}
                        mutedStyle={s.mutedText}
                      />
                    ) : null}
                  </div>
                )}
              </div>

              {/* Compose */}
              <div className="px-4 py-3 shrink-0" style={s.surface}>
                {relayReplyTarget ? (
                  <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                    <div className="min-w-0">
                      <div className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>
                        Replying to {relayReplyTarget.authorName} · {shortMessageRef(relayReplyTarget.messageId)}
                      </div>
                      <div className="text-[11px] truncate mt-1" style={s.mutedText}>{relayReplyTarget.preview}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRelayReplyTarget(null)}
                      className="shrink-0 rounded p-1 transition-opacity hover:opacity-70"
                      style={s.mutedText}
                      title="Clear reply context"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : null}
                {relayContextReferences.length > 0 ? (
                  <div className="mb-2 space-y-2">
                    {relayContextReferences.map((reference) => (
                      <div
                        key={reference.messageId}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                        style={{ borderColor: C.border, backgroundColor: C.bg }}
                      >
                        <div className="min-w-0">
                          <div className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>
                            Context · {reference.authorName} · {shortMessageRef(reference.messageId)}
                          </div>
                          <div className="text-[11px] truncate mt-1" style={s.mutedText}>{reference.preview}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRelayContextMessageIds((current) => current.filter((messageId) => messageId !== reference.messageId))}
                          className="shrink-0 rounded p-1 transition-opacity hover:opacity-70"
                          style={s.mutedText}
                          title="Clear referenced context"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="border rounded flex items-center px-2 py-1 transition-all focus-within:ring-1" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                  <textarea
                    ref={relayComposerRef}
                    className="flex-1 bg-transparent outline-none resize-none h-[20px] min-h-[20px] max-h-[80px] text-[12px] leading-tight py-0.5"
                    style={{ color: C.ink }}
                    placeholder={placeholderForDestination(selectedRelayKind, selectedRelayId)}
                    rows={1}
                    value={relayDraft}
                    onChange={(event) => {
                      const nextDraft = ingestRelayMessageRefs(
                        event.currentTarget.value,
                        mergedRelayMessages,
                        relayContextMessageIds,
                      );
                      setRelayDraft(nextDraft.body);
                      if (nextDraft.nextReferenceMessageIds !== relayContextMessageIds) {
                        setRelayContextMessageIds(nextDraft.nextReferenceMessageIds);
                      }
                    }}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void handleRelaySend();
                      }
                    }}
                  />
                  <div className="shrink-0 flex items-center gap-1 ml-2">
                    <button className="p-1 opacity-50 cursor-default transition-opacity" style={s.mutedText} title={relayState?.voice.detail ?? 'Voice unavailable in Electron'}>
                      <Mic size={12} />
                    </button>
                    <button
                      className="p-1 hover:opacity-70 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                      style={s.mutedText}
                      onClick={() => void handleRelaySend()}
                      disabled={relaySending || !relayDraft.trim()}
                    >
                      <Send size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Channel Footer */}
              <div className="h-7 border-t flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
                <div className="flex items-center gap-3 text-[9px] font-mono" style={s.mutedText}>
                  <span className="flex items-center gap-1"><span style={s.inkText}>@</span> mention agents</span>
                  <span className="w-px h-3" style={{ backgroundColor: C.border }}></span>
                  <span className="flex items-center gap-1">
                    <kbd className="font-sans px-1 py-0.5 rounded border text-[9px] font-medium leading-none shadow-sm" style={s.kbd}>Cmd+Enter</kbd> send
                  </span>
                  {relayFeedback ? (
                    <>
                      <span className="w-px h-3" style={{ backgroundColor: C.border }}></span>
                      <span>{relayFeedback}</span>
                    </>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>
                  {selectedRelayDirectThread?.state === 'offline' ? (
                    <span>Offline</span>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
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
                {visibleAgentSession?.pathLabel ?? compactHomePath(selectedInterAgent.cwd ?? selectedInterAgent.projectRoot) ?? 'No stable session path yet.'}
              </div>
              {agentSessionFeedback ? <div style={s.inkText}>{agentSessionFeedback}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
      </>
      ) : (
        <DispatchSurfacePlaceholder
          dispatchControlPending={dispatchControlPending}
          dispatchConfigFeedback={dispatchConfigFeedback}
          dispatchConfigPending={dispatchConfigPending}
          dispatchError={dispatchError}
          dispatchLoading={dispatchLoading}
          dispatchState={dispatchState}
          onControlDispatch={handleDispatchControl}
          onOpenLogs={() => {
            document.getElementById('dispatch-live-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          onUpdateConfig={handleUpdateDispatchConfig}
          onRefresh={() => void handleRefreshShell()}
        />
      )}

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

function DispatchSurfacePlaceholder({
  dispatchControlPending,
  dispatchConfigFeedback,
  dispatchConfigPending,
  dispatchError,
  dispatchLoading,
  dispatchState,
  onControlDispatch,
  onOpenLogs,
  onUpdateConfig,
  onRefresh,
}: {
  dispatchControlPending: boolean;
  dispatchConfigFeedback: string | null;
  dispatchConfigPending: boolean;
  dispatchError: string | null;
  dispatchLoading: boolean;
  dispatchState: DispatchState | null;
  onControlDispatch: (action: 'start' | 'stop' | 'restart') => void;
  onOpenLogs: () => void;
  onUpdateConfig: (input: UpdateDispatchConfigInput) => Promise<void>;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [relayDraft, setRelayDraft] = useState('');
  const [workspaceDraft, setWorkspaceDraft] = useState('');
  const [workspaceEditing, setWorkspaceEditing] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [qrExpanded, setQrExpanded] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const logsRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const dispatchPairingSvg = useMemo(() => {
    const qrValue = dispatchState?.pairing?.qrValue;
    if (!qrValue) {
      return null;
    }
    return renderSVG(qrValue, {
      border: 2,
      ecc: 'M',
      pixelSize: qrExpanded ? 8 : 6,
      blackColor: '#111111',
      whiteColor: '#ffffff',
    });
  }, [dispatchState?.pairing?.qrValue, qrExpanded]);
  const expiresIn = dispatchState?.pairing
    ? Math.max(0, Math.floor((dispatchState.pairing.expiresAt - countdownNow) / 1000))
    : null;
  const serviceIsRunning = Boolean(dispatchState?.isRunning);
  const activeRelay = dispatchState?.pairing?.relay ?? dispatchState?.relay ?? null;
  const dashboardTone = dispatchState?.status === 'paired' || dispatchState?.status === 'connected' || dispatchState?.status === 'connecting'
    ? { label: 'Relay Active', backgroundColor: '#ecfdf3', borderColor: '#bbf7d0', color: '#15803d' }
    : dispatchState?.status === 'error' || dispatchState?.status === 'closed'
      ? { label: 'Attention', backgroundColor: '#fff1f2', borderColor: '#fecdd3', color: '#be123c' }
      : { label: 'Ready', backgroundColor: '#eff6ff', borderColor: '#bfdbfe', color: '#1d4ed8' };
  const connectionTone = dispatchState?.status === 'paired'
    ? { backgroundColor: '#ecfdf3', borderColor: '#bbf7d0', color: '#15803d' }
    : dispatchState?.status === 'error' || dispatchState?.status === 'closed'
      ? { backgroundColor: '#fff1f2', borderColor: '#fecdd3', color: '#be123c' }
      : { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', color: '#1d4ed8' };
  const cardStyle = {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(15, 23, 42, 0.08)',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  } as const;
  const subtlePanelStyle = {
    backgroundColor: '#f7f8fb',
    borderColor: 'rgba(15, 23, 42, 0.08)',
  } as const;
  const simpleTableStyle = {
    backgroundColor: '#fbfbfd',
    borderColor: 'rgba(15, 23, 42, 0.06)',
  } as const;
  const pairCommand = dispatchState?.commandLabel ?? 'bun dispatch/cli/src/main.ts start';
  const connectionLabel = dispatchState?.pairing
    ? 'Pairing Ready'
    : dispatchState?.status === 'error' || dispatchState?.status === 'closed'
      ? dispatchState.statusLabel
      : serviceIsRunning
        ? dispatchState?.statusLabel ?? 'Running'
        : 'Ready to Start';
  const connectionDetail = dispatchError
    ?? dispatchState?.statusDetail
    ?? 'Start Dispatch to launch a local pairing relay, generate a fresh QR code, and wait for your phone to connect.';
  const runtimeRows = [
    ['Expires In', expiresIn !== null ? formatDurationShort(expiresIn) : '—'],
    ['Secure Mode', dispatchState?.secure ? 'Yes' : 'No'],
    ['Active Sessions', `${dispatchState?.sessionCount ?? 0}`],
    ['Trusted Peers', `${dispatchState?.trustedPeerCount ?? 0}`],
    ['Last Updated', dispatchState?.lastUpdatedLabel ?? '—'],
  ] as const;
  const statusRows = [
    ['Relay', activeRelay ?? 'Not set'],
    ['Client ID', dispatchState?.identityFingerprint ?? 'Not created'],
    ['Room', dispatchState?.pairing?.room ?? 'Pending'],
  ] as const;
  const topActions = (
    <>
      <span
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-medium"
        style={dashboardTone}
      >
        <span className={`block h-1.5 w-1.5 rounded-full ${serviceIsRunning ? 'bg-emerald-500' : dispatchState?.status === 'error' ? 'bg-rose-500' : 'bg-zinc-400'}`} />
        {dashboardTone.label}
      </span>
      <button
        type="button"
        onClick={() => logsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className="text-[12px] font-medium transition-opacity hover:opacity-70"
        style={{ color: C.muted }}
      >
        Logs
      </button>
      <button
        type="button"
        onClick={() => {
          setShowAdvancedSettings(true);
          window.setTimeout(() => {
            settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 0);
        }}
        className="text-[12px] font-medium transition-opacity hover:opacity-70"
        style={{ color: C.muted }}
      >
        Advanced
      </button>
    </>
  );

  const handleCopy = React.useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => {
        setCopied((current) => current === label ? null : current);
      }, 1_200);
    } catch {
      setCopied(null);
    }
  }, []);

  const saveDispatchConfig = React.useCallback(async () => {
    try {
      await onUpdateConfig({
        relay: relayDraft,
        workspaceRoot: workspaceDraft || null,
      });
      setConfigDirty(false);
      setWorkspaceEditing(false);
    } catch {
      // Feedback is surfaced via dispatchConfigFeedback.
    }
  }, [onUpdateConfig, relayDraft, workspaceDraft]);

  useEffect(() => {
    if (configDirty) {
      return;
    }

    setRelayDraft(dispatchState?.configuredRelay ?? '');
    setWorkspaceDraft(dispatchState?.workspaceRoot ?? '');
  }, [configDirty, dispatchState?.configuredRelay, dispatchState?.workspaceRoot]);

  useEffect(() => {
    if (!dispatchState?.pairing?.expiresAt) {
      return;
    }

    setCountdownNow(Date.now());
    const intervalId = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [dispatchState?.pairing?.expiresAt]);

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: C.bg }}>
      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-10" style={{ backgroundColor: '#FAFAFA' }}>
          <div className="mx-auto flex max-w-[980px] flex-col gap-8">
            <div className="sticky top-0 z-10 -mx-8 flex items-center justify-between gap-6 border-b px-8 py-4 backdrop-blur" style={{ borderBottomColor: C.border, backgroundColor: 'rgba(250,250,250,0.92)' }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ backgroundColor: '#4f46e5', color: '#ffffff' }}
                >
                  <Activity size={15} strokeWidth={1.6} />
                </div>
                <div className="text-[18px] font-medium tracking-tight" style={{ color: C.ink }}>
                  Dispatch Relay
                </div>
              </div>
              <div className="flex items-center gap-4">
                {topActions}
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_320px] items-start">
              <div className="flex flex-col gap-5">
                <section className="rounded-[20px] border p-5" style={cardStyle}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2 text-[17px] font-medium tracking-tight" style={{ color: C.ink }}>
                        <Server size={15} style={{ color: '#9ca3af' }} strokeWidth={1.5} />
                        Dispatch Status
                      </span>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-normal uppercase tracking-wide"
                        style={connectionTone}
                      >
                        {!serviceIsRunning && (dispatchState?.status === 'error' || dispatchState?.status === 'closed') ? <AlertCircle size={13} strokeWidth={1.5} /> : null}
                        {connectionLabel}
                      </span>
                    </div>
                    <p className="mt-3 text-[15px] leading-[1.75] font-light" style={{ color: C.muted }}>
                      {connectionDetail}
                    </p>
                    {dispatchState?.statusDetail && (dispatchState.status === 'error' || dispatchState.status === 'closed') ? (
                      <div
                        className="mt-4 rounded-2xl border px-4 py-3 text-[12px] leading-[1.7] font-mono whitespace-pre-wrap break-words"
                        style={{ backgroundColor: '#fff1f2', borderColor: '#fecdd3', color: '#9f1239' }}
                      >
                        {dispatchState.statusDetail}
                      </div>
                    ) : null}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={dispatchControlPending || dispatchLoading}>
                    <RefreshCw size={14} />
                    Refresh
                  </Button>
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border" style={simpleTableStyle}>
                  {statusRows.map(([label, value], index) => (
                    <div
                      key={label}
                      className="grid gap-2 px-3 py-2.5 md:grid-cols-[112px_minmax(0,1fr)] md:items-start"
                      style={index === 0 ? undefined : { borderTop: `1px solid ${C.border}` }}
                    >
                      <div className="text-[9px] font-mono uppercase tracking-[0.16em]" style={{ color: C.muted }}>
                        {label}:
                      </div>
                      <div className="text-[12px] leading-[1.5] break-words" style={{ color: C.ink }}>
                        {value}
                      </div>
                    </div>
                  ))}
                  <div
                    className="grid gap-2 px-3 py-2.5 md:grid-cols-[112px_minmax(0,1fr)_auto] md:items-center"
                    style={{ borderTop: `1px solid ${C.border}` }}
                  >
                    <div className="text-[9px] font-mono uppercase tracking-[0.16em]" style={{ color: C.muted }}>
                      Workspace:
                    </div>
                    {workspaceEditing ? (
                      <input
                        type="text"
                        value={workspaceDraft}
                        onChange={(event) => {
                          setWorkspaceDraft(event.target.value);
                          setConfigDirty(true);
                        }}
                        placeholder="/Users/arach/dev/openscout"
                        className="w-full rounded-lg border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                        style={{ borderColor: C.border, color: C.ink }}
                      />
                    ) : (
                      <div className="text-[12px] leading-[1.5] break-words" style={{ color: C.ink }}>
                        {dispatchState?.workspaceRoot || 'Not set'}
                      </div>
                    )}
                    <div className="flex items-center gap-2 md:justify-end">
                      {workspaceEditing ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              void saveDispatchConfig();
                            }}
                            disabled={dispatchConfigPending}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setWorkspaceDraft(dispatchState?.workspaceRoot ?? '');
                              setConfigDirty(false);
                              setWorkspaceEditing(false);
                            }}
                            disabled={dispatchConfigPending}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setWorkspaceDraft(dispatchState?.workspaceRoot ?? '');
                            setWorkspaceEditing(true);
                          }}
                          className="text-[12px] font-medium transition-opacity hover:opacity-70"
                          style={{ color: C.muted }}
                        >
                          [edit]
                        </button>
                      )}
                    </div>
                  </div>
                  {dispatchConfigFeedback ? (
                    <div
                      className="px-4 py-3 text-[11px] leading-[1.6]"
                      style={{ borderTop: `1px solid ${C.border}`, color: C.ink }}
                    >
                      {dispatchConfigFeedback}
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onControlDispatch(serviceIsRunning ? 'stop' : 'start')}
                    disabled={dispatchControlPending}
                  >
                    {serviceIsRunning ? 'Stop Dispatch' : 'Start Dispatch'}
                  </Button>
                  {serviceIsRunning ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onControlDispatch('restart')}
                      disabled={dispatchControlPending}
                    >
                      Restart
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenLogs}
                  >
                    <Terminal size={14} />
                    Logs
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAdvancedSettings(true);
                      window.setTimeout(() => {
                        settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 0);
                    }}
                  >
                    <Settings size={14} />
                    Advanced
                  </Button>
                </div>
                </section>
              </div>

              {dispatchPairingSvg ? (
                <section className="rounded-[20px] border p-5" style={cardStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>Scan QR Code</div>
                      <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                        Point Dispatch on your phone at this code.
                      </div>
                    </div>
                    <span
                      className="rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap"
                      style={{ backgroundColor: '#ecfdf3', borderColor: '#bbf7d0', color: '#15803d' }}
                    >
                      Ready to Pair
                    </span>
                  </div>
                  <div className="mt-5 rounded-[22px] border p-4" style={{ backgroundColor: '#ffffff', borderColor: 'rgba(15, 23, 42, 0.08)' }}>
                    <div
                      aria-label="Dispatch pairing QR code"
                      className={`mx-auto w-full ${qrExpanded ? 'max-w-[320px]' : 'max-w-[248px]'}`}
                      dangerouslySetInnerHTML={{ __html: dispatchPairingSvg }}
                    />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 text-[11px] leading-[1.65] font-light" style={{ color: C.muted }}>
                    <div>
                      Refreshes in <span style={{ color: C.ink }}>{expiresIn !== null ? formatDurationShort(expiresIn) : '—'}</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQrExpanded((current) => !current)}
                    >
                      {qrExpanded ? 'Compact QR' : 'Larger QR'}
                    </Button>
                  </div>
                </section>
              ) : (
                <section className="rounded-[20px] border bg-[rgba(250,250,250,0.65)] p-5" style={cardStyle}>
                  <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-3" style={{ color: C.muted }}>
                    CLI Equivalent
                  </div>
                  <div className="rounded-2xl border px-3 py-3 flex items-center gap-3" style={subtlePanelStyle}>
                    <code className="min-w-0 flex-1 truncate text-[11px]" style={{ color: C.ink }}>
                      {pairCommand}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => void handleCopy('command', pairCommand)}
                    >
                      {copied === 'command' ? <Check size={14} /> : <Copy size={14} />}
                    </Button>
                  </div>
                  <div className="mt-4 text-[11px] leading-[1.6] font-light" style={{ color: C.muted }}>
                    <div className="inline-flex items-center gap-1.5">
                      <Key size={13} strokeWidth={1.5} />
                      Same backend as the command line, with QR rotation and log access.
                    </div>
                  </div>
                </section>
              )}
            </div>

            <div className={`grid gap-5 items-start ${showAdvancedSettings ? 'lg:grid-cols-[minmax(0,1.5fr)_320px]' : 'lg:grid-cols-1'}`}>
              <section id="dispatch-live-logs" ref={logsRef} className="rounded-[20px] border overflow-hidden" style={cardStyle}>
                <div className="px-5 py-4 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                  <div>
                    <div className="inline-flex items-center gap-2 text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>
                      <Terminal size={15} style={{ color: '#9ca3af' }} strokeWidth={1.5} />
                      Logs
                    </div>
                    <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                      {dispatchState?.logUpdatedAtLabel ? `Updated ${dispatchState.logUpdatedAtLabel}` : 'Waiting for log output.'}
                    </div>
                  </div>
                </div>
                <div className="bg-[#f7f8fb] px-5 py-4">
                  <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-[13px] leading-[1.7] font-mono font-light" style={{ color: '#475569' }}>
                    {dispatchState?.logTail || (dispatchState?.logMissing ? 'Log file has not been created yet.' : 'Waiting for Dispatch bridge output.')}
                  </pre>
                </div>
              </section>

              {showAdvancedSettings ? (
              <section id="dispatch-settings-card" ref={settingsRef} className="rounded-[20px] border overflow-hidden" style={cardStyle}>
                <div className="px-5 py-4 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                  <div>
                    <div className="inline-flex items-center gap-2 text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>
                      <Settings size={15} style={{ color: '#9ca3af' }} strokeWidth={1.5} />
                      Advanced Settings
                    </div>
                    <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                      You usually do not need these. Dispatch can auto-launch a local relay for pairing.
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy('config', dispatchState?.configPath ?? '')} disabled={!dispatchState?.configPath}>
                    {copied === 'config' ? <Check size={14} /> : <Copy size={14} />}
                    Config Path
                  </Button>
                </div>
                <div className="divide-y" style={{ borderColor: C.border }}>
                  <div className="px-5 py-4 space-y-3">
                    {runtimeRows.map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3 text-[12px]">
                        <span className="font-light" style={{ color: C.muted }}>
                          {label === 'Secure Mode' ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Shield size={13} strokeWidth={1.5} />
                              {label}
                            </span>
                          ) : label === 'Last Updated' ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Clock size={13} strokeWidth={1.5} />
                              {label}
                            </span>
                          ) : label}
                        </span>
                        <span className="text-right break-words font-normal" style={{ color: C.ink }}>{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-4 space-y-4">
                    <label className="block">
                      <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-2" style={{ color: C.muted }}>
                        Custom Pairing Relay URL
                      </div>
                      <input
                        type="text"
                        value={relayDraft}
                        onChange={(event) => {
                          setRelayDraft(event.target.value);
                          setConfigDirty(true);
                        }}
                        placeholder="Leave blank to auto-select a local relay"
                        className="w-full rounded-xl border px-3 py-2 text-[13px] bg-transparent outline-none"
                        style={{ borderColor: C.border, color: C.ink }}
                      />
                    </label>
                    <label className="block">
                      <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-2" style={{ color: C.muted }}>
                        Workspace Root
                      </div>
                      <input
                        type="text"
                        value={workspaceDraft}
                        onChange={(event) => {
                          setWorkspaceDraft(event.target.value);
                          setConfigDirty(true);
                        }}
                        placeholder="/Users/arach/dev/openscout"
                        className="w-full rounded-xl border px-3 py-2 text-[13px] bg-transparent outline-none"
                        style={{ borderColor: C.border, color: C.ink }}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void saveDispatchConfig();
                        }}
                        disabled={dispatchConfigPending}
                      >
                        Save
                      </Button>
                    </div>
                    {dispatchConfigFeedback ? (
                      <div className="text-[11px] leading-[1.6]" style={{ color: C.ink }}>
                        {dispatchConfigFeedback}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductSurfaceLogo({
  active,
  surface,
}: {
  active: boolean;
  surface: 'relay' | 'dispatch';
}) {
  if (surface === 'relay') {
    return (
      <div
        className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-mono font-bold"
        style={active
          ? { backgroundColor: C.ink, color: '#fff' }
          : { backgroundColor: C.surface, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.border}` }}
      >
        {'>_'}
      </div>
    );
  }

  return (
    <div
      className="w-5 h-5 rounded-full flex items-center justify-center"
      style={active
        ? { backgroundColor: C.accentBg, boxShadow: `inset 0 0 0 1px ${C.accentBorder}` }
        : { backgroundColor: C.tagBg, boxShadow: `inset 0 0 0 1px ${C.border}` }}
    >
      <span
        className="block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: active ? C.accent : C.muted }}
      />
    </div>
  );
}

function formatDurationShort(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function RelayPresenceBadge({ thread }: { thread: RelayDirectThread }) {
  if (thread.state === "available") {
    return null;
  }

  if (thread.state === "working") {
    return (
      <span className="inline-flex items-center gap-1.5 shrink-0 text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: C.accent }}>
        <TypingDots className="text-[var(--os-accent)]" />
        <span>{thread.statusLabel}</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.18em] border rounded-full px-2 py-1 shrink-0"
      style={relayPresencePillStyle(thread.state)}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${relayPresenceDotClass(thread.state)}`}></span>
      <span>{thread.statusLabel}</span>
    </span>
  );
}

function RelayThinkingIndicator({
  thread,
  mutedStyle,
}: {
  thread: RelayDirectThread;
  mutedStyle: React.CSSProperties;
}) {
  return (
    <div className="flex gap-2.5 mb-2">
      <div
        className="w-6 h-6 rounded text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
        style={{ backgroundColor: colorForIdentity(thread.id) }}
      >
        {thread.title.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0 pt-1">
        <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: C.accent }}>
          <TypingDots className="text-[var(--os-accent)]" />
          <span>Working</span>
          {thread.activeTask ? (
            <span className="normal-case tracking-normal" style={mutedStyle}>
              · {thread.activeTask}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TypingDots({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-hidden="true">
      <span className="os-thinking-dot"></span>
      <span className="os-thinking-dot"></span>
      <span className="os-thinking-dot"></span>
    </span>
  );
}

function RelayTimeline({
  messages,
  showAnnotations,
  showStatusMessages,
  inkStyle,
  mutedStyle,
  tagStyle,
  annotStyle,
  agentLookup,
  directThreadLookup,
  onOpenAgentProfile,
  onOpenAgentChat,
  onNudgeMessage,
}: {
  messages: RelayMessage[];
  showAnnotations: boolean;
  showStatusMessages: boolean;
  inkStyle: React.CSSProperties;
  mutedStyle: React.CSSProperties;
  tagStyle: React.CSSProperties;
  annotStyle: React.CSSProperties;
  agentLookup: Map<string, InterAgentAgent>;
  directThreadLookup: Map<string, RelayDirectThread>;
  onOpenAgentProfile: (agentId: string) => void;
  onOpenAgentChat: (agentId: string, draft?: string | null) => void;
  onNudgeMessage?: (message: RelayMessage) => void;
}) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [nudgedMessageId, setNudgedMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const rows: React.ReactNode[] = [];
  let lastDayLabel = '';
  let index = 0;
  const timelineMessages = useMemo(
    () => showStatusMessages ? messages : messages.filter((message) => message.messageClass !== 'status'),
    [messages, showStatusMessages],
  );
  const messageById = useMemo(
    () => new Map(timelineMessages.map((message) => [message.id, message])),
    [timelineMessages],
  );
  const latestDirectReceiptMessageId = useMemo(() => {
    let latestMessageId: string | null = null;
    for (const message of timelineMessages) {
      if (message.isOperator && message.isDirectConversation && message.receipt) {
        latestMessageId = message.id;
      }
    }
    return latestMessageId;
  }, [timelineMessages]);

  useEffect(() => {
    if (!copiedMessageId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopiedMessageId((current) => (current === copiedMessageId ? null : current));
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [copiedMessageId]);

  useEffect(() => {
    if (!nudgedMessageId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNudgedMessageId((current) => (current === nudgedMessageId ? null : current));
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [nudgedMessageId]);

  useEffect(() => {
    if (!highlightedMessageId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === highlightedMessageId ? null : current));
    }, 2200);

    return () => window.clearTimeout(timeoutId);
  }, [highlightedMessageId]);

  const handleCopyMessageRef = React.useCallback(async (messageId: string) => {
    try {
      await copyTextToClipboard(shortMessageRef(messageId));
      setCopiedMessageId(messageId);
    } catch {
      setCopiedMessageId(null);
    }
  }, []);

  const handleNudge = React.useCallback((message: RelayMessage) => {
    onNudgeMessage?.(message);
    setNudgedMessageId(message.id);
  }, [onNudgeMessage]);

  const handleJumpToMessage = React.useCallback((messageId: string) => {
    if (typeof document === 'undefined') {
      return;
    }

    const target = document.getElementById(messageDomId(messageId));
    if (!target) {
      return;
    }

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightedMessageId(messageId);
  }, []);

  while (index < timelineMessages.length) {
    const message = timelineMessages[index];
    const visibleRole = shouldRenderRole(message.authorRole) ? message.authorRole : null;
    const authorAgent = message.isOperator ? null : agentLookup.get(message.authorId) ?? null;
    const authorDirectThread = authorAgent ? directThreadLookup.get(authorAgent.id) ?? null : null;

    if (message.dayLabel !== lastDayLabel) {
      rows.push(
        <div key={`day-${message.dayLabel}`} className="flex items-center justify-center mb-4">
          <div className="px-2 font-mono text-[9px] tracking-widest uppercase" style={mutedStyle}>{message.dayLabel}</div>
        </div>,
      );
      lastDayLabel = message.dayLabel;
    }

    if (message.isSystem || message.messageClass === 'status') {
      rows.push(
        <div key={message.id} className="flex gap-2.5 mb-3 group">
          <div className="w-6 h-6 rounded text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5" style={{ backgroundColor: message.avatarColor }}>
            {message.avatarLabel}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between mb-0.5">
              <div className="flex items-baseline gap-2">
                {authorAgent ? (
                  <AgentIdentityInline
                    agent={authorAgent}
                    directThread={authorDirectThread}
                    visibleRole={visibleRole}
                    timestampLabel={message.timestampLabel}
                    inkStyle={inkStyle}
                    mutedStyle={mutedStyle}
                    tagStyle={tagStyle}
                    onOpenProfile={onOpenAgentProfile}
                    onOpenChat={onOpenAgentChat}
                  />
                ) : (
                  <>
                    <span className="font-semibold text-[12px]" style={inkStyle}>{message.authorName}</span>
                    <span className="text-[9px] font-mono" style={mutedStyle}>{message.timestampLabel}</span>
                  </>
                )}
              </div>
            </div>
            <div
              id={messageDomId(message.id)}
              className="group/message relative text-[12px] leading-relaxed rounded-lg px-2 py-1.5 pr-12 -mx-2"
              style={highlightedMessageId === message.id ? highlightedMessageStyle() : inkStyle}
            >
              <div className="flex items-center gap-2 px-2 py-1.5 border rounded font-mono text-[10px] w-fit" style={tagStyle}>
                <Loader2 size={10} className="animate-spin" />
                <span><span style={mutedStyle}>TASK //</span> {message.body}</span>
                <span className="ml-2 px-1 rounded" style={{ backgroundColor: 'rgba(99,102,241,0.12)', color: 'var(--os-accent)' }}>IN PROGRESS</span>
              </div>
              <MessageReferenceControls
                message={message}
                copied={copiedMessageId === message.id}
                nudged={nudgedMessageId === message.id}
                canNudge={Boolean(onNudgeMessage && !message.isOperator)}
                mutedStyle={mutedStyle}
                onCopyRef={handleCopyMessageRef}
                onNudge={() => handleNudge(message)}
              />
            </div>
          </div>
        </div>,
      );
      index += 1;
      continue;
    }

    const grouped: RelayMessage[] = [message];
    let cursor = index + 1;
    while (
      cursor < timelineMessages.length &&
      timelineMessages[cursor].authorId === message.authorId &&
      timelineMessages[cursor].dayLabel === message.dayLabel &&
      !timelineMessages[cursor].isSystem &&
      timelineMessages[cursor].messageClass !== 'status'
    ) {
      grouped.push(timelineMessages[cursor]);
      cursor += 1;
    }

    rows.push(
      <div key={message.id} className="flex gap-2.5 mb-4 group">
        <div className="w-6 h-6 rounded text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5" style={{ backgroundColor: message.avatarColor }}>
          {message.avatarLabel}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between mb-0.5">
            <div className="flex items-baseline gap-2">
              {authorAgent ? (
                <AgentIdentityInline
                  agent={authorAgent}
                  directThread={authorDirectThread}
                  visibleRole={visibleRole}
                  timestampLabel={message.timestampLabel}
                  inkStyle={inkStyle}
                  mutedStyle={mutedStyle}
                  tagStyle={tagStyle}
                  onOpenProfile={onOpenAgentProfile}
                  onOpenChat={onOpenAgentChat}
                />
              ) : (
                <>
                  <span className="font-semibold text-[12px]" style={inkStyle}>{message.authorName}</span>
                  {visibleRole ? (
                    <span className="text-[9px] font-mono border px-1 py-0.5 rounded" style={tagStyle}>{visibleRole}</span>
                  ) : null}
                  <span className="text-[9px] font-mono" style={mutedStyle}>{message.timestampLabel}</span>
                </>
              )}
            </div>
            {showAnnotations && (message.routingSummary || message.provenanceSummary) ? (
              <div className="flex items-center gap-1">
                {message.routingSummary ? (
                  <span className="text-[9px] font-mono border px-1 rounded" style={annotStyle}>{message.routingSummary}</span>
                ) : null}
                {message.provenanceSummary ? (
                  <span className="text-[9px] font-mono border px-1 rounded" style={annotStyle}>{message.provenanceSummary}</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 mt-0.5">
            {grouped.map((entry) => {
              const replyTarget = entry.replyToMessageId ? messageById.get(entry.replyToMessageId) ?? null : null;
              const showReceipt = Boolean(
                entry.receipt && (
                  !entry.isOperator
                  || !entry.isDirectConversation
                  || latestDirectReceiptMessageId === entry.id
                )
              );
              const renderReceiptInline = showReceipt && canInlineRelayReceipt(entry.body);
              return (
                <div
                  key={entry.id}
                  id={messageDomId(entry.id)}
                  className="group/message relative text-[12px] leading-relaxed rounded-lg px-2 py-1.5 pr-12 -mx-2"
                  style={highlightedMessageId === entry.id ? highlightedMessageStyle() : inkStyle}
                >
                  {entry.replyToMessageId ? (
                    replyTarget ? (
                      <ReplyReferenceLine
                        messageId={entry.replyToMessageId}
                        preview={messagePreviewSnippet(replyTarget.body, 64)}
                        mutedStyle={mutedStyle}
                        onJump={() => handleJumpToMessage(entry.replyToMessageId!)}
                      />
                    ) : (
                      <ReplyReferenceLine
                        messageId={entry.replyToMessageId}
                        mutedStyle={mutedStyle}
                      />
                    )
                  ) : null}
                  {renderReceiptInline && entry.receipt ? (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="min-w-0 max-w-full whitespace-pre-wrap break-words" style={inkStyle}>
                        {entry.body}
                      </span>
                      <RelayReceiptInline receipt={entry.receipt} mutedStyle={mutedStyle} inline />
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2">{renderMessageBody(entry.body, inkStyle, mutedStyle, tagStyle)}</div>
                      {showReceipt && entry.receipt ? (
                        <RelayReceiptInline receipt={entry.receipt} mutedStyle={mutedStyle} />
                      ) : null}
                    </>
                  )}
                  {showAnnotations && (entry.routingSummary || entry.provenanceSummary || entry.provenanceDetail) ? (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {entry.routingSummary ? (
                        <span className="text-[9px] font-mono border px-1 rounded" style={annotStyle}>{entry.routingSummary}</span>
                      ) : null}
                      {entry.provenanceSummary ? (
                        <span className="text-[9px] font-mono border px-1 rounded" style={annotStyle}>{entry.provenanceSummary}</span>
                      ) : null}
                      {entry.provenanceDetail ? (
                        <span className="text-[9px]" style={mutedStyle}>{entry.provenanceDetail}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <MessageReferenceControls
                    message={entry}
                    copied={copiedMessageId === entry.id}
                    nudged={nudgedMessageId === entry.id}
                    canNudge={Boolean(onNudgeMessage && !entry.isOperator)}
                    mutedStyle={mutedStyle}
                    onCopyRef={handleCopyMessageRef}
                    onNudge={() => handleNudge(entry)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>,
    );

    index = cursor;
  }

  return <>{rows}</>;
}

function MessageReferenceControls({
  message,
  copied,
  nudged,
  canNudge,
  mutedStyle,
  onCopyRef,
  onNudge,
}: {
  message: RelayMessage;
  copied: boolean;
  nudged: boolean;
  canNudge: boolean;
  mutedStyle: React.CSSProperties;
  onCopyRef: (messageId: string) => void;
  onNudge: () => void;
}) {
  return (
    <div className="absolute top-1.5 right-2 flex items-center gap-2 opacity-0 pointer-events-none transition-opacity group-hover/message:opacity-100 group-hover/message:pointer-events-auto group-focus-within/message:opacity-100 group-focus-within/message:pointer-events-auto">
      {canNudge ? (
        <button
          type="button"
          onClick={onNudge}
          className="text-[9px] font-mono lowercase tracking-wide transition-colors hover:opacity-80"
          style={nudged ? { color: C.accent } : mutedStyle}
          title={`Follow up with ${message.authorName}`}
        >
          {nudged ? 'drafted' : 'nudge'}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void onCopyRef(message.id)}
        className="text-[9px] font-mono lowercase tracking-wide transition-colors hover:opacity-80"
        style={copied ? { color: C.accent } : mutedStyle}
        title={stableMessageRef(message.id)}
      >
        {copied ? 'copied' : messageRefSuffix(message.id)}
      </button>
    </div>
  );
}

function AgentIdentityInline({
  agent,
  directThread,
  visibleRole,
  timestampLabel,
  inkStyle,
  mutedStyle,
  tagStyle,
  onOpenProfile,
  onOpenChat,
}: {
  agent: InterAgentAgent;
  directThread: RelayDirectThread | null;
  visibleRole: string | null;
  timestampLabel: string;
  inkStyle: React.CSSProperties;
  mutedStyle: React.CSSProperties;
  tagStyle: React.CSSProperties;
  onOpenProfile: (agentId: string) => void;
  onOpenChat: (agentId: string, draft?: string | null) => void;
}) {
  const handleTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) {
      onOpenChat(agent.id);
      return;
    }
    onOpenProfile(agent.id);
  };

  return (
    <div className="relative group/agent inline-flex items-baseline gap-2 min-w-0">
      <button
        type="button"
        onClick={handleTriggerClick}
        className="inline-flex items-baseline gap-2 min-w-0 text-left hover:opacity-90 transition-opacity"
        title="Click for overview. Cmd-click to open direct chat."
      >
        <span className="font-semibold text-[12px] truncate" style={inkStyle}>{agent.title}</span>
        {visibleRole ? (
          <span className="text-[9px] font-mono border px-1 py-0.5 rounded shrink-0" style={tagStyle}>{visibleRole}</span>
        ) : null}
      </button>
      <span className="text-[9px] font-mono shrink-0" style={mutedStyle}>{timestampLabel}</span>
      <AgentHoverCard
        agent={agent}
        directThread={directThread}
        mutedStyle={mutedStyle}
        onOpenProfile={onOpenProfile}
        onOpenChat={onOpenChat}
      />
    </div>
  );
}

function AgentIdentityCard({
  agent,
  directThread = null,
  variant = 'hero',
  mutedStyle = { color: C.muted },
  borderColor = C.bg,
  actions = null,
}: {
  agent: InterAgentAgent;
  directThread?: RelayDirectThread | null;
  variant?: 'hero' | 'hover';
  mutedStyle?: React.CSSProperties;
  borderColor?: string;
  actions?: React.ReactNode;
}) {
  const compact = variant === 'hover';
  const role = normalizeLegacyAgentCopy(agent.role);
  const summary = normalizeLegacyAgentCopy(agent.summary);
  const detail = directThread?.statusDetail ?? agent.statusDetail ?? summary ?? 'Available as a local relay channel.';

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div
            className={`${compact ? 'w-8 h-8 text-[11px]' : 'w-10 h-10 text-[13px]'} rounded text-white flex items-center justify-center font-bold ${agent.reachable ? '' : 'opacity-40 grayscale'}`}
            style={{ backgroundColor: colorForIdentity(agent.id) }}
          >
            {agent.title.charAt(0).toUpperCase()}
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${relayPresenceDotClass(agent.state)}`}
            style={{ border: `1px solid ${borderColor}` }}
          ></div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={compact ? 'text-[12px] font-semibold truncate' : 'text-[15px] font-semibold tracking-tight'} style={{ color: C.ink }}>
              {agent.title}
            </div>
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: C.tagBg, color: C.muted }}>
              {interAgentProfileKindLabel(agent.profileKind)}
            </span>
          </div>
          {compact ? (
            <div className="text-[10px] mt-1" style={mutedStyle}>
              {detail}
            </div>
          ) : (
            <>
              {role ? (
                <div className="text-[11px] mt-1" style={{ color: C.ink }}>{role}</div>
              ) : null}
              {summary ? (
                <div className="text-[12px] leading-[1.55] mt-2" style={{ color: C.muted }}>{summary}</div>
              ) : null}
            </>
          )}
          <div className={`text-[10px] ${compact ? 'mt-2 flex flex-wrap gap-x-3 gap-y-1' : 'mt-3 flex items-center gap-2 flex-wrap'}`} style={mutedStyle}>
            {compact ? (
              <>
                <span>{agent.harness ?? 'runtime'}</span>
                <span>{compactHomePath(agent.projectRoot ?? agent.cwd) ?? 'no path'}</span>
                {agent.lastChatLabel ? <span>last chat {agent.lastChatLabel}</span> : null}
              </>
            ) : (
              <>
                <span>{agent.lastChatLabel ? `Last chat ${agent.lastChatLabel}` : 'No direct chat yet.'}</span>
                {agent.lastSessionLabel ? (
                  <>
                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: C.border }}></span>
                    <span>Last session {agent.lastSessionLabel}</span>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
      {actions ? (
        <div className="mt-3 flex items-center gap-2">
          {actions}
        </div>
      ) : null}
    </>
  );
}

function AgentActionButton({
  children,
  icon,
  tone = 'neutral',
  ...props
}: React.ComponentProps<typeof Button> & {
  icon?: React.ReactNode;
  tone?: 'neutral' | 'primary';
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 rounded-xl px-3 text-[10px] font-medium shadow-none"
      style={tone === 'primary'
        ? {
            backgroundColor: C.accentBg,
            borderColor: C.accentBorder,
            color: C.accent,
          }
        : {
            backgroundColor: C.surface,
            borderColor: C.border,
            color: C.ink,
          }}
      {...props}
    >
      {icon}
      {children}
    </Button>
  );
}

function AgentHoverCard({
  agent,
  directThread,
  mutedStyle,
  onOpenProfile,
  onOpenChat,
}: {
  agent: InterAgentAgent;
  directThread: RelayDirectThread | null;
  mutedStyle: React.CSSProperties;
  onOpenProfile: (agentId: string) => void;
  onOpenChat: (agentId: string, draft?: string | null) => void;
}) {
  return (
    <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border p-3 shadow-lg opacity-0 pointer-events-none translate-y-1 transition-all duration-150 group-hover/agent:opacity-100 group-hover/agent:pointer-events-auto group-hover/agent:translate-y-0 group-focus-within/agent:opacity-100 group-focus-within/agent:pointer-events-auto group-focus-within/agent:translate-y-0" style={{ borderColor: C.border, backgroundColor: C.surface }}>
      <AgentIdentityCard
        agent={agent}
        directThread={directThread}
        variant="hover"
        mutedStyle={mutedStyle}
        borderColor={C.surface}
        actions={(
          <>
            <button
              type="button"
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
              style={{ color: C.ink }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenChat(agent.id);
              }}
            >
              Message
            </button>
            <button
              type="button"
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
              style={{ color: C.ink }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenProfile(agent.id);
              }}
            >
              Overview
            </button>
            <span className="ml-auto text-[9px] font-mono" style={mutedStyle}>Cmd-click to DM</span>
          </>
        )}
      />
    </div>
  );
}

function ReplyReferenceLine({
  messageId,
  preview,
  mutedStyle,
  onJump,
}: {
  messageId: string;
  preview?: string | null;
  mutedStyle: React.CSSProperties;
  onJump?: () => void;
}) {
  const refLabel = shortMessageRef(messageId);
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] leading-none min-w-0" style={mutedStyle}>
      <CornerUpLeft size={10} className="shrink-0" />
      <span className="font-mono uppercase tracking-[0.14em] shrink-0">Reply to</span>
      {onJump ? (
        <button
          type="button"
          onClick={onJump}
          className="font-mono underline-offset-2 hover:underline shrink-0"
          style={{ color: C.accent }}
          title={stableMessageRef(messageId)}
        >
          {refLabel}
        </button>
      ) : (
        <span className="font-mono shrink-0">{refLabel}</span>
      )}
      {preview ? (
        <span className="truncate min-w-0" title={preview}>
          {preview}
        </span>
      ) : null}
    </div>
  );
}

function RelayReceiptInline({
  receipt,
  mutedStyle,
  inline = false,
}: {
  receipt: NonNullable<RelayMessage['receipt']>;
  mutedStyle: React.CSSProperties;
  inline?: boolean;
}) {
  const tone = relayReceiptTone(receipt.state);
  return (
    <div
      className={`${inline ? '' : 'mt-1.5 '}inline-flex items-center gap-1.5 text-[10px] leading-none shrink-0`}
      style={{ ...mutedStyle, color: tone.color }}
      title={receipt.detail ?? receipt.label}
    >
      <RelayReceiptIcon state={receipt.state} />
      <span className="font-mono uppercase tracking-[0.14em]">{receipt.label}</span>
      {receipt.state === 'replied' && receipt.detail ? (
        <span style={mutedStyle}>{receipt.detail}</span>
      ) : null}
    </div>
  );
}

function RelayReceiptIcon({ state }: { state: NonNullable<RelayMessage['receipt']>['state'] }) {
  switch (state) {
    case 'replied':
      return <Reply size={11} />;
    case 'working':
      return <TypingDots className="text-[var(--os-accent)]" />;
    case 'seen':
      return <CheckCheck size={11} />;
    case 'delivered':
      return <CheckCheck size={11} />;
    case 'sent':
    default:
      return <Check size={11} />;
  }
}

function relaySecondaryText(thread: RelayDirectThread) {
  if (thread.state === 'working') {
    return thread.activeTask ?? thread.statusDetail ?? thread.subtitle;
  }

  if (thread.statusDetail) {
    return `${thread.subtitle} · ${thread.statusDetail}`;
  }

  return thread.subtitle;
}

function relayPresenceDotClass(state: RelayDirectThread['state']) {
  if (state === 'working') {
    return 'bg-[var(--os-accent)] os-presence-pulse';
  }
  if (state === 'available') {
    return 'bg-emerald-500';
  }
  return 'bg-zinc-400/50';
}

function relayPresencePillStyle(state: RelayDirectThread['state']): React.CSSProperties {
  if (state === 'working') {
    return {
      borderColor: 'rgba(0,102,255,0.2)',
      backgroundColor: 'rgba(0,102,255,0.08)',
      color: 'var(--os-accent)',
    };
  }

  if (state === 'available') {
    return {
      borderColor: 'rgba(16,185,129,0.18)',
      backgroundColor: 'rgba(16,185,129,0.08)',
      color: '#059669',
    };
  }

  return {
    borderColor: 'var(--os-border)',
    backgroundColor: 'var(--os-tag-bg)',
    color: 'var(--os-muted)',
  };
}

function relayPresenceIndicatorLabel(state: RelayDirectThread['state']) {
  return state === 'offline' ? 'Off' : 'On';
}

function relayReceiptTone(state: NonNullable<RelayMessage['receipt']>['state']) {
  switch (state) {
    case 'replied':
      return { color: '#059669' };
    case 'working':
      return { color: 'var(--os-accent)' };
    case 'seen':
      return { color: 'var(--os-accent)' };
    case 'delivered':
      return { color: '#64748b' };
    case 'sent':
    default:
      return { color: 'var(--os-muted)' };
  }
}

function canInlineRelayReceipt(body: string) {
  const trimmed = body.trim();
  if (!trimmed || trimmed.includes('\n')) {
    return false;
  }

  if (/```|`|\[[^\]]+\]\([^)]+\)|^>\s|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\|/.test(trimmed)) {
    return false;
  }

  return true;
}

function firstInterAgentThreadIdForAgent(threads: InterAgentThread[], agentId: string) {
  return threads.find((thread) => thread.participants.some((participant) => participant.id === agentId))?.id ?? null;
}

function interAgentCounterparts(thread: InterAgentThread, perspectiveId: string | null) {
  const others = perspectiveId
    ? thread.participants.filter((participant) => participant.id !== perspectiveId)
    : thread.participants;
  return others.length > 0 ? others : thread.participants;
}

function interAgentThreadTitleForAgent(thread: InterAgentThread, perspectiveId: string | null) {
  return interAgentCounterparts(thread, perspectiveId).map((participant) => participant.title).join(", ");
}

function interAgentThreadSubtitle(thread: InterAgentThread, perspectiveId: string | null) {
  const sourceLabel = thread.sourceKind === 'private' ? 'Private thread' : 'Targeted relay traffic';
  const participantLine = thread.participants.map((participant) => participant.title).join(" ↔ ");
  if (!perspectiveId) {
    return `${sourceLabel} · ${participantLine}`;
  }

  const others = interAgentCounterparts(thread, perspectiveId).map((participant) => participant.title).join(", ");
  return thread.latestAuthorName
    ? `${sourceLabel} · ${others} · Last from ${thread.latestAuthorName}`
    : `${sourceLabel} · ${participantLine}`;
}

function agentThreadFollowUpDraft(thread: InterAgentThread, perspectiveId: string | null) {
  const others = interAgentCounterparts(thread, perspectiveId).map((participant) => participant.title).join(", ");
  return others
    ? `Can you catch me up on your thread with ${others}?`
    : "Can you catch me up on this thread?";
}

function interAgentProfileKindLabel(profileKind: InterAgentAgent['profileKind']) {
  if (profileKind === 'project') {
    return 'Relay Agent';
  }
  if (profileKind === 'system') {
    return 'System';
  }
  return 'Built-in Role';
}

function agentRosterFilterLabel(mode: AgentRosterFilterMode) {
  return mode === 'active' ? 'active' : 'all';
}

function agentRosterSortLabel(mode: AgentRosterSortMode) {
  if (mode === 'code') {
    return 'code';
  }
  if (mode === 'session') {
    return 'session';
  }
  if (mode === 'alpha') {
    return 'a-z';
  }
  return 'chat';
}

function isAgentRosterActive(agent: InterAgentAgent) {
  return agent.threadCount > 0
    || agent.reachable
    || Boolean(agent.lastChatAt || agent.lastCodeChangeAt || agent.lastSessionAt);
}

function agentRosterTimestamp(agent: InterAgentAgent, mode: AgentRosterSortMode) {
  if (mode === 'code') {
    return agent.lastCodeChangeAt ?? 0;
  }
  if (mode === 'session') {
    return agent.lastSessionAt ?? 0;
  }
  return agent.lastChatAt ?? 0;
}

function compareAgentRoster(lhs: InterAgentAgent, rhs: InterAgentAgent, mode: AgentRosterSortMode) {
  if (mode === 'alpha') {
    return lhs.title.localeCompare(rhs.title);
  }

  const delta = agentRosterTimestamp(rhs, mode) - agentRosterTimestamp(lhs, mode);
  if (delta !== 0) {
    return delta;
  }

  return rhs.threadCount - lhs.threadCount || lhs.title.localeCompare(rhs.title);
}

function agentRosterSecondaryText(agent: InterAgentAgent, mode: AgentRosterSortMode) {
  if (mode === 'chat' && agent.lastChatLabel) {
    return `${agent.subtitle} · chat ${agent.lastChatLabel}`;
  }
  if (mode === 'code' && agent.lastCodeChangeLabel) {
    return `${agent.subtitle} · code ${agent.lastCodeChangeLabel}`;
  }
  if (mode === 'session' && agent.lastSessionLabel) {
    return `${agent.subtitle} · session ${agent.lastSessionLabel}`;
  }
  return agent.subtitle;
}

function normalizeDraftText(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

function serializeEditableAgentConfig(config: AgentConfigState | null) {
  if (!config) {
    return '';
  }

  return JSON.stringify({
    cwd: normalizeDraftText(config.runtime.cwd),
    harness: config.runtime.harness,
    sessionId: normalizeDraftText(config.runtime.sessionId),
    systemPrompt: normalizeDraftText(config.systemPrompt),
    launchArgsText: normalizeDraftText(config.toolUse.launchArgsText),
    capabilitiesText: normalizeDraftText(config.capabilitiesText),
  });
}

function serializeAppSettings(settings: AppSettingsState | null) {
  if (!settings) {
    return '';
  }

  return JSON.stringify({
    operatorName: normalizeDraftText(settings.operatorName),
    workspaceRoots: settings.workspaceRoots.map((entry) => normalizeDraftText(entry)),
    includeCurrentRepo: settings.includeCurrentRepo,
    defaultHarness: settings.defaultHarness,
    defaultCapabilities: settings.defaultCapabilities.map((entry) => normalizeDraftText(entry)),
    sessionPrefix: normalizeDraftText(settings.sessionPrefix),
    telegram: {
      enabled: settings.telegram.enabled,
      mode: settings.telegram.mode,
      botToken: normalizeDraftText(settings.telegram.botToken),
      secretToken: normalizeDraftText(settings.telegram.secretToken),
      apiBaseUrl: normalizeDraftText(settings.telegram.apiBaseUrl),
      userName: normalizeDraftText(settings.telegram.userName),
      defaultConversationId: normalizeDraftText(settings.telegram.defaultConversationId),
      ownerNodeId: normalizeDraftText(settings.telegram.ownerNodeId),
    },
  });
}

function parseCapabilityText(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/g)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeLegacyAgentCopy(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value;
}

function compactHomePath(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~");
}

function InterAgentIcon({
  size = 16,
  strokeWidth = 1.35,
  style,
}: {
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  return <Network size={size} strokeWidth={strokeWidth} className="shrink-0" style={style} aria-hidden="true" />;
}

function shouldRenderRole(role: string | null) {
  if (!role) {
    return false;
  }
  return role.trim().toLowerCase() !== 'operator';
}

function RelayRailIcon({ id, active, size = 12 }: { id: string; active: boolean; size?: number }) {
  const iconStyle = active ? { color: C.accent } : undefined;

  if (id === 'voice') {
    return <Radio size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  if (id === 'system') {
    return <Settings size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  if (id === 'mentions') {
    return <AtSign size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  if (id === 'coordination') {
    return <MessageSquare size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  if (id === 'all-traffic') {
    return <Radar size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  return <Hash size={size} className="os-row-icon shrink-0" style={iconStyle} />;
}

function isRelaySharedConversationMessage(message: RelayMessage) {
  return (
    !message.isDirectConversation &&
    !message.isSystem &&
    !message.isVoice &&
    message.messageClass !== 'status' &&
    (!message.normalizedChannel || message.normalizedChannel === 'shared')
  );
}

function isRelaySystemMessage(message: RelayMessage) {
  return message.isSystem;
}

function isRelayVoiceMessage(message: RelayMessage) {
  return message.isVoice;
}

function isRelayAllTrafficMessage(message: RelayMessage) {
  return !message.isVoice;
}

function isRelayCoordinationMessage(message: RelayMessage) {
  return (
    !message.isVoice &&
    !message.isSystem &&
    (message.isDirectConversation || message.recipients.length > 0 || message.messageClass === 'status')
  );
}

function isRelayMentionMessage(message: RelayMessage) {
  return (
    !message.isDirectConversation &&
    !message.isSystem &&
    !message.isVoice &&
    message.messageClass !== 'status' &&
    message.recipients.length > 0
  );
}

function relayMessageCount(messages: RelayMessage[], predicate: (message: RelayMessage) => boolean) {
  return messages.filter(predicate).length;
}

function buildRelayFeedItems(relayState: DesktopShellState['relay'] | null): RelayNavItem[] {
  if (!relayState) {
    return [];
  }

  const viewById = new Map(relayState.views.map((item) => [item.id, item]));
  const channelById = new Map(relayState.channels.map((item) => [item.id, item]));

  return [
    viewById.get('all-traffic') ?? {
      kind: 'filter',
      id: 'all-traffic',
      title: 'All Traffic',
      subtitle: 'Every non-voice message across the workspace.',
      count: relayMessageCount(relayState.messages, isRelayAllTrafficMessage),
    },
    viewById.get('coordination') ?? {
      kind: 'filter',
      id: 'coordination',
      title: 'Coordination',
      subtitle: 'Targeted messages, direct threads, and task handoffs.',
      count: relayMessageCount(relayState.messages, isRelayCoordinationMessage),
    },
    viewById.get('mentions') ?? {
      kind: 'filter',
      id: 'mentions',
      title: 'Mentions',
      subtitle: 'Focused view over shared-channel targeted messages.',
      count: relayMessageCount(relayState.messages, isRelayMentionMessage),
    },
    channelById.get('system') ?? {
      kind: 'channel',
      id: 'system',
      title: '# system',
      subtitle: 'Infrastructure, lifecycle, and broker state events.',
      count: relayMessageCount(relayState.messages, isRelaySystemMessage),
    },
    channelById.get('voice') ?? {
      kind: 'channel',
      id: 'voice',
      title: '# voice',
      subtitle: 'Voice-related chat, transcripts, and spoken updates.',
      count: relayMessageCount(relayState.messages, isRelayVoiceMessage),
    },
  ];
}

function buildRelayConversationItems(relayState: DesktopShellState['relay'] | null): RelayNavItem[] {
  if (!relayState) {
    return [];
  }

  const sharedChannel = relayState.channels.find((item) => item.id === 'shared');
  return [
    sharedChannel ?? {
      kind: 'channel',
      id: 'shared',
      title: '# shared-channel',
      subtitle: 'Broadcast updates and shared context.',
      count: relayMessageCount(relayState.messages, isRelaySharedConversationMessage),
    },
  ];
}

function resolveRelayDestination(
  relayState: DesktopShellState['relay'],
  feedItems: RelayNavItem[],
  kind: RelayDestinationKind,
  id: string,
) {
  if (kind === 'channel') {
    return relayState.channels.find((item) => item.id === id) ?? null;
  }
  if (kind === 'filter') {
    return feedItems.find((item) => item.id === id) ?? null;
  }
  return relayState.directs.find((item) => item.id === id) ?? null;
}

function filterRelayMessages(messages: RelayMessage[], kind: RelayDestinationKind, id: string) {
  if (kind === 'direct') {
    return messages.filter(
      (message) =>
        message.isDirectConversation &&
        (message.authorId === id || message.recipients.includes(id)),
    );
  }

  if (kind === 'filter' && id === 'all-traffic') {
    return messages.filter(isRelayAllTrafficMessage);
  }

  if (kind === 'filter' && id === 'coordination') {
    return messages.filter(isRelayCoordinationMessage);
  }

  if (kind === 'filter' && id === 'mentions') {
    return messages.filter(isRelayMentionMessage);
  }

  if (kind === 'channel' && id === 'voice') {
    return messages.filter(isRelayVoiceMessage);
  }

  if (kind === 'channel' && id === 'system') {
    return messages.filter(isRelaySystemMessage);
  }

  return messages.filter(isRelaySharedConversationMessage);
}

function placeholderForDestination(kind: RelayDestinationKind, id: string) {
  if (kind === 'direct') {
    return 'Message direct thread...';
  }
  if (kind === 'filter' && id === 'coordination') {
    return 'Message #shared-channel or @agent...';
  }
  if (kind === 'channel' && id === 'voice') {
    return 'Message #voice...';
  }
  if (kind === 'channel' && id === 'system') {
    return 'Message #system...';
  }
  return 'Message #shared-channel...';
}

function cleanDisplayTitle(title: string) {
  return title.replace(/^[@#]\s*/, '');
}

function normalizeRelayTimestamp(value: number) {
  return value > 10_000_000_000 ? value : value * 1000;
}

function formatRelayTimestamp(value: number) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(normalizeRelayTimestamp(value)));
}

function formatRelayDayLabel(value: number) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(normalizeRelayTimestamp(value))).toUpperCase();
}

function formatFooterTime(date: Date) {
  return new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function colorForIdentity(identity: string) {
  const palette = ['#3b82f6', '#14b8a6', '#fb923c', '#f43f5e', '#8b5cf6', '#10b981'];
  let seed = 0;
  for (const character of identity) {
    seed += character.charCodeAt(0);
  }
  return palette[seed % palette.length];
}

function generateClientMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `client-${crypto.randomUUID()}`;
  }

  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveOperatorDisplayName(
  relayState: DesktopShellState['relay'] | null,
  appSettings: AppSettingsState | null,
) {
  const configuredName = appSettings?.operatorName?.trim();
  if (configuredName) {
    return configuredName;
  }

  const operatorId = relayState?.operatorId ?? 'operator';
  const messages = relayState?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.authorId === operatorId && message.authorName.trim()) {
      return message.authorName.trim();
    }
  }

  return appSettings?.operatorNameDefault ?? 'Operator';
}

function relayMessageMentionRecipients(body: string) {
  const matches = body.match(/@[a-z0-9][\w.-]*(?:@[a-z0-9][\w.-]*)?(?:#[a-z0-9][\w.-]*)?/gi) ?? [];
  return Array.from(new Set(matches.map((match) => match.slice(1))));
}

function optimisticRelayConversationId(kind: RelayDestinationKind, id: string) {
  if (kind === 'direct') {
    if (id === 'scout') {
      return 'dm.scout.primary';
    }
    return `dm.operator.${id}`;
  }
  if (kind === 'channel' && id === 'voice') {
    return 'channel.voice';
  }
  if (kind === 'channel' && id === 'system') {
    return 'channel.system';
  }
  return 'channel.shared';
}

function normalizedMessageRefKey(messageId: string) {
  return messageId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function messageRefTokenPattern() {
  return /\b(?:message:[a-zA-Z0-9._:-]+|m:[a-z0-9]{4,12})\b/gi;
}

function arraysEqual(values: string[], other: string[]) {
  if (values.length !== other.length) {
    return false;
  }

  return values.every((value, index) => value === other[index]);
}

function resolveRelayMessageRefToken(token: string, messages: RelayMessage[]) {
  const normalizedToken = token.trim().toLowerCase();
  if (!normalizedToken) {
    return null;
  }

  if (normalizedToken.startsWith('message:')) {
    const messageId = token.slice(token.indexOf(':') + 1).trim();
    return messages.find((message) => message.id === messageId) ?? null;
  }

  if (!normalizedToken.startsWith('m:')) {
    return null;
  }

  const suffix = normalizedToken.slice(2);
  if (!suffix) {
    return null;
  }

  const matches = messages.filter((message) => normalizedMessageRefKey(message.id).endsWith(suffix));
  return matches.length === 1 ? matches[0] : null;
}

function stripResolvedRelayRefTokens(body: string, resolvedTokens: string[]) {
  if (resolvedTokens.length === 0) {
    return body;
  }

  const tokenSet = new Set(resolvedTokens.map((token) => token.toLowerCase()));
  const withoutTokens = body.replace(messageRefTokenPattern(), (match) => (
    tokenSet.has(match.toLowerCase()) ? ' ' : match
  ));

  return withoutTokens
    .split(/\r?\n/g)
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
    .join('\n')
    .trim();
}

function ingestRelayMessageRefs(
  body: string,
  messages: RelayMessage[],
  currentReferenceMessageIds: string[],
) {
  const tokens = body.match(messageRefTokenPattern()) ?? [];
  if (tokens.length === 0) {
    return {
      body,
      nextReferenceMessageIds: currentReferenceMessageIds,
    };
  }

  const nextReferenceMessageIds = [...currentReferenceMessageIds];
  const resolvedTokens: string[] = [];
  for (const token of tokens) {
    const match = resolveRelayMessageRefToken(token, messages);
    if (!match) {
      continue;
    }
    resolvedTokens.push(token);
    if (!nextReferenceMessageIds.includes(match.id)) {
      nextReferenceMessageIds.push(match.id);
    }
  }

  if (resolvedTokens.length === 0) {
    return {
      body,
      nextReferenceMessageIds: currentReferenceMessageIds,
    };
  }

  const cleanedBody = stripResolvedRelayRefTokens(body, resolvedTokens);
  return {
    body: cleanedBody,
    nextReferenceMessageIds: arraysEqual(nextReferenceMessageIds, currentReferenceMessageIds)
      ? currentReferenceMessageIds
      : nextReferenceMessageIds,
  };
}

function buildOptimisticRelayMessage({
  relayState,
  appSettings,
  destinationKind,
  destinationId,
  body,
  replyToMessageId,
  clientMessageId,
}: {
  relayState: DesktopShellState['relay'] | null;
  appSettings: AppSettingsState | null;
  destinationKind: RelayDestinationKind;
  destinationId: string;
  body: string;
  replyToMessageId: string | null;
  clientMessageId: string;
}): RelayMessage {
  const createdAt = Date.now();
  const operatorId = relayState?.operatorId ?? 'operator';
  const operatorName = resolveOperatorDisplayName(relayState, appSettings);
  const recipients = destinationKind === 'direct'
    ? Array.from(new Set([destinationId, ...relayMessageMentionRecipients(body)]))
    : relayMessageMentionRecipients(body);
  const normalizedChannel = destinationKind === 'channel'
    ? destinationId
    : destinationKind === 'direct'
      ? null
      : 'shared';
  const isVoice = destinationKind === 'channel' && destinationId === 'voice';
  const isSystem = destinationKind === 'channel' && destinationId === 'system';

  return {
    id: `pending-${clientMessageId}`,
    clientMessageId,
    conversationId: optimisticRelayConversationId(destinationKind, destinationId),
    createdAt,
    replyToMessageId,
    authorId: operatorId,
    authorName: operatorName,
    authorRole: null,
    body,
    timestampLabel: formatRelayTimestamp(createdAt),
    dayLabel: formatRelayDayLabel(createdAt),
    normalizedChannel,
    recipients,
    isDirectConversation: destinationKind === 'direct',
    isSystem,
    isVoice,
    messageClass: isSystem ? 'system' : 'agent',
    routingSummary: recipients.length > 0 ? `Targets ${recipients.join(', ')}` : null,
    provenanceSummary: 'via electron · sending',
    provenanceDetail: null,
    isOperator: true,
    avatarLabel: operatorName.slice(0, 1).toUpperCase() || 'A',
    avatarColor: colorForIdentity(operatorId),
    receipt: {
      state: 'sent',
      label: 'Sending…',
      detail: null,
    },
  };
}

function renderMessageBody(
  body: string,
  inkStyle: React.CSSProperties,
  mutedStyle: React.CSSProperties,
  tagStyle: React.CSSProperties,
) {
  const markdownStyle = {
    '--os-markdown-ink': String(inkStyle.color ?? C.ink),
    '--os-markdown-muted': String(mutedStyle.color ?? C.muted),
    '--os-markdown-link': C.accent,
    '--os-markdown-border': C.border,
    '--os-markdown-surface': String(tagStyle.backgroundColor ?? C.tagBg),
    '--os-markdown-inline-border': String(tagStyle.borderColor ?? C.border),
    '--os-markdown-code-bg': C.termBg,
    '--os-markdown-code-fg': C.termFg,
  } as React.CSSProperties;

  return (
    <div className="os-markdown" style={markdownStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote>{children}</blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
            const value = String(children).replace(/\n$/, '');
            const isInline = !language && !value.includes('\n');

            if (isInline) {
              return (
                <code className="os-markdown-inline-code" {...props}>
                  {value}
                </code>
              );
            }

            return (
              <div className="os-markdown-code-block">
                <div className="os-markdown-code-header">
                  <span>{language ?? 'code'}</span>
                </div>
                <pre className="os-markdown-pre">
                  <code className={className} {...props}>
                    {value}
                  </code>
                </pre>
              </div>
            );
          },
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,
          hr: () => <hr />,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="os-markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function shortMessageRef(messageId: string) {
  const normalized = messageId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const suffix = normalized.slice(-7) || normalized.slice(0, 7) || 'message';
  return `m:${suffix}`;
}

function messageRefSuffix(messageId: string) {
  const normalized = messageId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return normalized.slice(-4) || normalized.slice(0, 4) || 'ref';
}

function stableMessageRef(messageId: string) {
  return `message:${messageId}`;
}

function messageDomId(messageId: string) {
  return `message-${messageId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function messagePreviewSnippet(body: string, maxLength = 88) {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function highlightedMessageStyle(): React.CSSProperties {
  return {
    color: C.ink,
    backgroundColor: C.accentBg,
    boxShadow: 'inset 0 0 0 1px rgba(0,102,255,0.16)',
  };
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (copied) {
      return;
    }
  }

  throw new Error('Clipboard unavailable.');
}

function asErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Action failed.';
}
