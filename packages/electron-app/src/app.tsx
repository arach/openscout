"use client";

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowUpDown,
  Bot,
  Check,
  CheckCheck,
  CornerUpLeft,
  Database,
  Filter,
  LayoutGrid,
  FileText,
  Network,
  Palette,
  PenTool,
  MessageSquare,
  User,
  Settings,
  Hash,
  RefreshCw,
  Search,
  Radar,
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
  Sun,
  Moon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MachinesView from "@/components/machines-view";
import PlansView from "@/components/plans-view";
import type {
  AgentSessionInspector,
  AgentConfigState,
  AppSettingsState,
  DesktopBrokerInspector,
  DesktopLogCatalog,
  DesktopLogContent,
  DesktopLogSource,
  DesktopShellState,
  InterAgentAgent,
  InterAgentThread,
  RelayDirectThread,
  RelayDestinationKind,
  RelayMessage,
  RelayNavItem,
  SessionMetadata,
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

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<'overview' | 'machines' | 'plans' | 'sessions' | 'search' | 'relay' | 'inter-agent' | 'agents' | 'logs' | 'settings'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionMetadata | null>(null);
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [isLoadingShell, setIsLoadingShell] = useState(true);
  const [shellError, setShellError] = useState<string | null>(null);
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
  const [appSettings, setAppSettings] = useState<AppSettingsState | null>(null);
  const [appSettingsDraft, setAppSettingsDraft] = useState<AppSettingsState | null>(null);
  const [appSettingsLoading, setAppSettingsLoading] = useState(false);
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);
  const [appSettingsFeedback, setAppSettingsFeedback] = useState<string | null>(null);
  const [isAppSettingsEditing, setIsAppSettingsEditing] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'profile' | 'agents' | 'communication' | 'database' | 'appearance'>('profile');
  const [logCatalog, setLogCatalog] = useState<DesktopLogCatalog | null>(null);
  const [selectedLogSourceId, setSelectedLogSourceId] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<DesktopLogContent | null>(null);
  const [brokerInspector, setBrokerInspector] = useState<DesktopBrokerInspector | null>(null);
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
  const settingsOperatorNameRef = useRef<HTMLInputElement | null>(null);

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
      return;
    }

    if (withSpinner) {
      setIsLoadingShell(true);
    }

    try {
      const nextState = await window.openScoutDesktop.getShellState();
      setShellState(nextState);
      setShellError(null);
    } catch (error) {
      setShellError(asErrorMessage(error));
    } finally {
      setIsLoadingShell(false);
    }
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
        setAppSettingsFeedback(null);
        setIsAppSettingsEditing(false);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAppSettings(null);
        setAppSettingsDraft(null);
        setAppSettingsFeedback(asErrorMessage(error));
        setIsAppSettingsEditing(false);
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

  const relayFeedItems = useMemo(() => buildRelayFeedItems(relayState), [relayState]);
  const relayConversationItems = useMemo(() => buildRelayConversationItems(relayState), [relayState]);
  const relayCurrentDestination = relayState
    ? resolveRelayDestination(relayState, relayFeedItems, selectedRelayKind, selectedRelayId)
    : null;
  const selectedRelayDirectThread = relayState && selectedRelayKind === 'direct'
    ? relayState.directs.find((item) => item.id === selectedRelayId) ?? null
    : null;
  const visibleRelayMessages = relayState
    ? filterRelayMessages(relayState.messages, selectedRelayKind, selectedRelayId)
    : [];
  const relayThreadTitle = cleanDisplayTitle(relayCurrentDestination?.title ?? '# shared-channel');
  const relayThreadSubtitle = selectedRelayDirectThread?.statusDetail
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
  const visibleAgentConfig = agentConfigDraft ?? agentConfig;
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
      description: 'Identity, workspace roots, starter relay-agent defaults, and discovered projects.',
      icon: <FolderOpen size={15} />,
    },
    {
      id: 'agents' as const,
      label: 'Agents',
      description: 'Relay agent configuration, runtime definitions, prompts, and restart controls.',
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

  const handleStartAppSettingsEdit = React.useCallback(() => {
    setAppSettingsDraft(appSettings);
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(true);
  }, [appSettings]);

  const handleCancelAppSettingsEdit = React.useCallback(() => {
    setAppSettingsDraft(appSettings);
    setAppSettingsFeedback(null);
    setIsAppSettingsEditing(false);
  }, [appSettings]);

  const handleSaveAppSettings = async () => {
    if (!appSettingsDraft || !window.openScoutDesktop?.updateAppSettings) {
      return;
    }

    setAppSettingsSaving(true);
    try {
      const nextSettings = await window.openScoutDesktop.updateAppSettings({
        operatorName: appSettingsDraft.operatorName,
        workspaceRootsText: appSettingsDraft.workspaceRoots.join('\n'),
        includeCurrentRepo: appSettingsDraft.includeCurrentRepo,
        defaultHarness: appSettingsDraft.defaultHarness,
        defaultCapabilitiesText: appSettingsDraft.defaultCapabilities.join('\n'),
        sessionPrefix: appSettingsDraft.sessionPrefix,
      });
      setAppSettings(nextSettings);
      setAppSettingsDraft(nextSettings);
      setAppSettingsFeedback('Settings saved.');
      setIsAppSettingsEditing(false);
      await loadShellState(false);
    } catch (error) {
      setAppSettingsFeedback(asErrorMessage(error));
    } finally {
      setAppSettingsSaving(false);
    }
  };

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

  const handleRelaySend = async () => {
    const body = relayDraft.trim();
    if (!body || relaySending || !window.openScoutDesktop) {
      return;
    }

    setRelaySending(true);
    setRelayFeedback('Sending…');
    try {
      const nextState = await window.openScoutDesktop.sendRelayMessage({
        destinationKind: selectedRelayKind,
        destinationId: selectedRelayId,
        body,
        replyToMessageId: relayReplyTarget?.messageId ?? null,
      });
      setShellState(nextState);
      setRelayDraft('');
      setRelayReplyTarget(null);
      setRelayFeedback('Sent.');
    } catch (error) {
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
          <div
            className="flex items-center gap-2 ml-2 border rounded px-2 py-1"
            style={{ backgroundColor: C.logoBg, borderColor: C.logoBorder }}
          >
            <div className="w-5 h-5 rounded flex items-center justify-center text-white text-[10px] font-mono font-bold" style={{ backgroundColor: C.ink }}>
              {'>_'}
            </div>
            <span className="font-semibold text-[13px] tracking-tight" style={s.inkText}>OpenScout</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider" style={s.mutedText}>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${runtime?.brokerReachable ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
              Relay <span className="font-medium" style={s.inkText}>{runtime?.brokerReachable ? 'Running' : 'Offline'}</span>
            </div>
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

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Nav (Leftmost) */}
        <div className="w-12 border-r flex flex-col items-center py-2 gap-3 shrink-0 z-10" style={s.navBar}>
          <div className="flex flex-col gap-1 w-full px-2 mt-2" style={s.mutedText}>
            {([
              ['overview', <LayoutGrid size={16} strokeWidth={1.5} />, 'Overview'],
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
            {(activeView === 'machines' || activeView === 'plans' || activeView === 'sessions' || activeView === 'relay' || activeView === 'search' || activeView === 'inter-agent' || activeView === 'agents' || activeView === 'logs') && (
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
                      desc: 'Track recent asks and load Markdown plans from registered twin workspaces.',
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
              planCount: 0,
              workspaceCount: 0,
              lastUpdatedLabel: null,
              tasks: [],
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
                            {appSettingsSaving ? 'Saving…' : 'Save Setup'}
                          </button>
                        </>
                      ) : (
                        <button
                          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded disabled:opacity-50"
                          style={{ color: C.ink }}
                          onClick={() => handleStartAppSettingsEdit()}
                          disabled={appSettingsLoading || !visibleAppSettings}
                        >
                          Edit Setup
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
                    ) : settingsSection === 'communication' ? (
                      <>
                        <button
                          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                          style={{ color: C.ink }}
                          onClick={() => setActiveView('relay')}
                        >
                          Open Relay
                        </button>
                        <button
                          className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                          style={{ color: C.ink }}
                          onClick={() => void handleRefreshShell()}
                        >
                          Refresh
                        </button>
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
                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: C.accentBg }}>
                            <FolderOpen size={18} style={{ color: C.accent }} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Setup</div>
                            <div className="text-[13px] font-medium mt-1" style={s.inkText}>Identity, workspace roots, and starter defaults</div>
                            <div className="text-[11px] mt-1 leading-[1.5]" style={s.mutedText}>
                              This is the canonical onboarding surface for OpenScout. The desktop app and `scout init` both use the same underlying setup state.
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
                                  placeholder={appSettings?.operatorNameDefault ?? 'Arach'}
                                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] leading-[1.5] bg-transparent outline-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                />
                              ) : (
                                <div className="rounded-xl border px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                  <div className="text-[20px] font-semibold tracking-tight" style={s.inkText}>
                                    {visibleAppSettings?.operatorName ?? 'Arach'}
                                  </div>
                                  <div className="text-[11px] mt-1 leading-[1.5]" style={s.mutedText}>
                                    {visibleAppSettings?.note ?? 'Shown everywhere the desktop shell refers to you.'}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Workspace Roots</div>
                              {isAppSettingsEditing ? (
                                <textarea
                                  value={(visibleAppSettings?.workspaceRoots ?? []).join('\n')}
                                  onChange={(event) => {
                                    setAppSettingsDraft((current) => current ? {
                                      ...current,
                                      workspaceRoots: event.target.value.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean),
                                    } : current);
                                    setAppSettingsFeedback(null);
                                  }}
                                  readOnly={appSettingsSaving}
                                  rows={4}
                                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] leading-[1.5] bg-transparent outline-none resize-none"
                                  style={{ borderColor: C.border, color: C.ink }}
                                />
                              ) : (
                                <div className="rounded-xl border px-4 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                  <div className="flex flex-wrap gap-2">
                                    {(visibleAppSettings?.workspaceRoots ?? []).length > 0 ? (visibleAppSettings?.workspaceRoots ?? []).map((root) => (
                                      <span key={root} className="text-[10px] font-mono px-2 py-1 rounded" style={s.tagBadge}>{root}</span>
                                    )) : (
                                      <span className="text-[11px]" style={s.mutedText}>No workspace roots configured yet.</span>
                                    )}
                                  </div>
                                  <div className="text-[11px] mt-2 leading-[1.5]" style={s.mutedText}>
                                    {visibleAppSettings?.workspaceRootsNote ?? 'OpenScout scans each configured root shallowly for repos and project manifests.'}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={s.mutedText}>Default Harness</div>
                                {isAppSettingsEditing ? (
                                  <select
                                    value={visibleAppSettings?.defaultHarness ?? 'claude'}
                                    onChange={(event) => {
                                      setAppSettingsDraft((current) => current ? {
                                        ...current,
                                        defaultHarness: event.target.value,
                                      } : current);
                                      setAppSettingsFeedback(null);
                                    }}
                                    disabled={appSettingsSaving}
                                    className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent outline-none"
                                    style={{ borderColor: C.border, color: C.ink }}
                                  >
                                    <option value="claude">claude</option>
                                    <option value="codex">codex</option>
                                  </select>
                                ) : (
                                  <div className="text-[13px] font-medium" style={s.inkText}>{visibleAppSettings?.defaultHarness ?? 'claude'}</div>
                                )}
                              </div>

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
                                <div className="text-[12px] font-medium" style={s.inkText}>Include the current repo</div>
                                <div className="text-[11px] leading-[1.5]" style={s.mutedText}>
                                  Create or honor `.openscout/project.json` in the repo you launched from and keep it in discovery.
                                </div>
                              </div>
                            </label>

                            {appSettingsFeedback ? (
                              <div className="text-[11px] leading-[1.5]" style={s.inkText}>{appSettingsFeedback}</div>
                            ) : null}
                          </div>
                        )}
                      </section>
                    </div>

                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Discovered Projects</div>
                        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                          {(visibleAppSettings?.discoveredAgents ?? []).length > 0 ? (visibleAppSettings?.discoveredAgents ?? []).map((agent) => (
                            <button
                              key={agent.id}
                              onClick={() => {
                                if (agent.registrationKind === 'configured') {
                                  openAgentProfile(agent.id);
                                }
                              }}
                              className="w-full text-left rounded-lg border px-3 py-3 transition-opacity hover:opacity-90"
                              style={{ borderColor: C.border, backgroundColor: C.bg }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[12px] font-medium truncate" style={s.inkText}>{agent.title}</div>
                                  <div className="text-[10px] mt-1 leading-[1.4]" style={s.mutedText}>{agent.root}</div>
                                  <div className="text-[10px] mt-1" style={s.mutedText}>
                                    {agent.registrationKind === 'configured' ? 'relay agent' : 'candidate'} · {agent.source} · {agent.harness}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {agent.projectConfigPath ? (
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>manifest</span>
                                  ) : null}
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={agent.registrationKind === 'configured' ? s.activePill : s.tagBadge}>
                                    {agent.registrationKind === 'configured' ? 'agent' : 'candidate'}
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
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Canonical Paths</div>
                        <div className="grid grid-cols-1 gap-3">
                          {[
                            ['Settings', visibleAppSettings?.settingsPath ?? 'Not reported'],
                            ['Relay Agents', visibleAppSettings?.relayAgentsPath ?? 'Not reported'],
                            ['Relay Hub', visibleAppSettings?.relayHubPath ?? 'Not reported'],
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
                        <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>Relay Service</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          {[
                            ['Label', visibleAppSettings?.broker.label ?? 'Not reported'],
                            ['Reachable', visibleAppSettings?.broker.reachable ? 'Yes' : 'No'],
                            ['Installed', visibleAppSettings?.broker.installed ? 'Yes' : 'No'],
                            ['Loaded', visibleAppSettings?.broker.loaded ? 'Yes' : 'No'],
                            ['Relay URL', visibleAppSettings?.broker.url ?? 'Not reported'],
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

                    <div className="space-y-4 min-w-0">
                      {brokerInspector ? (
                        <>
                          <section className="border rounded-xl p-5" style={{ ...s.surface, borderColor: C.border }}>
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div>
                                <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Relay Service</div>
                                <div className="text-[11px] mt-1" style={s.mutedText}>
                                  {brokerInspector.statusDetail ?? 'Relay service profile and runtime state.'}
                                </div>
                              </div>
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={brokerInspector.reachable ? s.activePill : s.tagBadge}>
                                {brokerInspector.statusLabel}
                              </span>
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
              <div className="border-b flex items-center justify-between px-4 h-14 shrink-0 gap-4" style={{ ...s.surface, borderBottomColor: C.border }}>
                <div className="flex items-center gap-2 min-w-0">
                  <Bot size={14} style={s.mutedText} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold tracking-tight truncate" style={s.inkText}>
                      {selectedInterAgent ? selectedInterAgent.title : 'Agents'}
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={s.mutedText}>
                      {selectedInterAgent
                        ? `${interAgentProfileKindLabel(selectedInterAgent.profileKind)} · ${selectedInterAgent.statusDetail ?? selectedInterAgent.summary ?? 'Operational snapshot and recent thread activity.'}`
                        : 'Select an agent to inspect its operational snapshot and recent threads.'}
                    </div>
                  </div>
                </div>
                {selectedInterAgent ? (
                  <div className="flex items-center gap-2">
                    <button
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                      onClick={() => openRelayAgentThread(selectedInterAgent.id, { focusComposer: true })}
                    >
                      {selectedInterAgentChatActionLabel}
                    </button>
                    {visibleInterAgentThreads.length > 0 ? (
                      <button
                        className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                        style={{ color: C.ink }}
                        onClick={() => setActiveView('inter-agent')}
                      >
                        Open Threads
                      </button>
                    ) : null}
                    <button
                      className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                      style={{ color: C.ink }}
                      onClick={() => openAgentSettings(selectedInterAgent.id, selectedInterAgent.profileKind === 'project')}
                    >
                      {selectedInterAgent.profileKind === 'project' ? 'Configure' : 'Open Settings'}
                    </button>
                  </div>
                ) : null}
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
                  <div className="grid grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)] gap-4">
                    <div className="space-y-4 min-w-0">
                      <section className="border rounded-xl p-4" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="flex items-start gap-3">
                          <div className="relative shrink-0">
                            <div
                              className={`w-10 h-10 rounded text-white flex items-center justify-center text-[13px] font-bold ${selectedInterAgent.reachable ? '' : 'opacity-40 grayscale'}`}
                              style={{ backgroundColor: colorForIdentity(selectedInterAgent.id) }}
                            >
                              {selectedInterAgent.title.charAt(0).toUpperCase()}
                            </div>
                            <div
                              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${relayPresenceDotClass(selectedInterAgent.state)}`}
                              style={{ border: `1px solid ${C.bg}` }}
                            ></div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="text-[15px] font-semibold tracking-tight" style={s.inkText}>{selectedInterAgent.title}</div>
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                                {interAgentProfileKindLabel(selectedInterAgent.profileKind)}
                              </span>
                            </div>
                            {normalizeLegacyAgentCopy(selectedInterAgent.role) ? (
                              <div className="text-[11px] mt-1" style={s.inkText}>{normalizeLegacyAgentCopy(selectedInterAgent.role)}</div>
                            ) : null}
                            {normalizeLegacyAgentCopy(selectedInterAgent.summary) ? (
                              <div className="text-[12px] leading-[1.55] mt-2" style={s.mutedText}>{normalizeLegacyAgentCopy(selectedInterAgent.summary)}</div>
                            ) : null}
                            <div className="mt-3 flex items-center gap-2 flex-wrap text-[10px]" style={s.mutedText}>
                              <span>{selectedInterAgent.lastChatLabel ? `Last chat ${selectedInterAgent.lastChatLabel}` : 'No direct chat yet.'}</span>
                              {selectedInterAgent.lastSessionLabel ? (
                                <>
                                  <span className="w-1 h-1 rounded-full" style={{ backgroundColor: C.border }}></span>
                                  <span>Last session {selectedInterAgent.lastSessionLabel}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </section>

                      <section className="border rounded-xl p-4" style={{ ...s.surface, borderColor: C.border }}>
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                            <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Live Session</div>
                            <div className="text-[11px] mt-1" style={s.mutedText}>
                              {visibleAgentSession?.mode === 'tmux'
                                ? 'Live tmux pane capture for the selected agent.'
                                : visibleAgentSession?.mode === 'logs'
                                  ? 'Canonical runtime session logs for the selected agent.'
                                  : 'No live tmux pane or predictable runtime logs are available yet.'}
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
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap text-[10px] mb-3" style={s.mutedText}>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={visibleAgentSession?.mode === 'tmux' ? s.activePill : s.tagBadge}>
                            {visibleAgentSession?.mode === 'tmux' ? 'TMUX' : visibleAgentSession?.mode === 'logs' ? 'Logs' : 'Unavailable'}
                          </span>
                          {visibleAgentSession?.harness ? (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                              {visibleAgentSession.harness}
                            </span>
                          ) : null}
                          {visibleAgentSession?.transport ? (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={s.tagBadge}>
                              {visibleAgentSession.transport}
                            </span>
                          ) : null}
                          {visibleAgentSession?.sessionId ? (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>
                              {visibleAgentSession.sessionId}
                            </span>
                          ) : null}
                          {visibleAgentSession?.updatedAtLabel ? (
                            <span>Updated {visibleAgentSession.updatedAtLabel}</span>
                          ) : null}
                          {typeof visibleAgentSession?.lineCount === 'number' && visibleAgentSession.lineCount > 0 ? (
                            <span>{visibleAgentSession.lineCount} lines</span>
                          ) : null}
                          {visibleAgentSession?.truncated ? <span>Tail only</span> : null}
                        </div>

                        <div
                          className="border rounded-lg overflow-hidden"
                          style={{ borderColor: C.border, backgroundColor: C.bg }}
                        >
                          {agentSessionLoading && !visibleAgentSession ? (
                            <div className="px-3 py-6 text-[11px]" style={s.mutedText}>
                              Loading live session…
                            </div>
                          ) : visibleAgentSession?.body ? (
                            <pre
                              className="px-3 py-3 text-[11px] leading-[1.55] overflow-x-auto whitespace-pre-wrap break-words min-h-[220px] max-h-[420px] overflow-y-auto"
                              style={{ color: C.ink, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                            >
                              {visibleAgentSession.body}
                            </pre>
                          ) : (
                            <div className="px-3 py-6 text-[11px] leading-[1.6]" style={s.mutedText}>
                              {visibleAgentSession?.subtitle ?? 'No session output available yet.'}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3 mt-3 text-[10px]" style={s.mutedText}>
                          <div className="truncate min-w-0">
                            {visibleAgentSession?.pathLabel ?? 'No stable session path yet.'}
                          </div>
                          {agentSessionFeedback ? (
                            <div className="shrink-0" style={s.inkText}>{agentSessionFeedback}</div>
                          ) : null}
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
                <div className="text-[10px] font-mono" style={s.mutedText}>{filteredSessions.length} results</div>
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
                <span className="text-[9px] font-mono" style={s.mutedText}>Click session to view details</span>
                <span className="text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>Index Ready</span>
              </div>
            </div>

            {/* Session Detail Panel */}
            {selectedSession && (
              <div className="w-80 border-l shrink-0 overflow-y-auto flex flex-col" style={{ ...s.surface, borderLeftColor: C.border }}>
                <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderBottomColor: C.border }}>
                  <div className="text-[10px] font-mono tracking-widest uppercase" style={s.mutedText}>Session Details</div>
                  <button onClick={() => setSelectedSession(null)} className="hover:opacity-70" style={s.mutedText}><X size={14} /></button>
                </div>
                <div className="p-4 flex-1">
                  <div className="flex items-center gap-2 mb-4">
                    <div
                      className="w-8 h-8 rounded text-white flex items-center justify-center text-[12px] font-bold"
                      style={{ backgroundColor: colorForIdentity(selectedSession.agent) }}
                    >
                      {selectedSession.agent.charAt(0)}
                    </div>
                    <div>
                      <div className="text-[11px] font-medium" style={s.inkText}>{selectedSession.agent}</div>
                      <div className="text-[10px] font-mono" style={s.mutedText}>{selectedSession.model}</div>
                    </div>
                  </div>
                  <h3 className="text-[14px] font-semibold mb-3" style={s.inkText}>{selectedSession.title}</h3>
                  <div className="space-y-3 mb-4">
                    {[
                      [<Folder size={12} />, 'Project', selectedSession.project],
                      [<MessageSquare size={12} />, 'Messages', selectedSession.messageCount],
                      [<Hash size={12} />, 'Tokens', selectedSession.tokens],
                      [<Calendar size={12} />, 'Created', formatDate(selectedSession.createdAt)],
                      [<Clock size={12} />, 'Modified', formatDate(selectedSession.lastModified)],
                    ].map(([icon, label, value]) => (
                      <div key={label as string} className="flex items-center gap-2 text-[11px]">
                        <span style={s.mutedText}>{icon as React.ReactNode}</span>
                        <span style={s.mutedText}>{label as string}:</span>
                        <span className="font-medium" style={s.inkText}>{String(value)}</span>
                      </div>
                    ))}
                  </div>
                  {selectedSession.tags && selectedSession.tags.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>Tags</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedSession.tags.map(tag => (
                          <span key={tag} className="text-[10px] font-mono border px-2 py-1 rounded" style={s.tagBadge}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>Preview</div>
                    <p className="text-[12px] leading-relaxed" style={s.mutedText}>{selectedSession.preview}</p>
                  </div>
                </div>
                <div className="px-4 py-3 border-t" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
                  <button className="w-full text-white px-4 py-2 rounded text-[12px] font-medium transition-opacity hover:opacity-80" style={{ backgroundColor: C.ink }}>
                    Open Session
                  </button>
                </div>
              </div>
            )}
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
                      Send a message into this lane to wake a twin or start a broker-backed conversation.
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
                <div className="border rounded flex items-center px-2 py-1 transition-all focus-within:ring-1" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                  <textarea
                    ref={relayComposerRef}
                    className="flex-1 bg-transparent outline-none resize-none h-[20px] min-h-[20px] max-h-[80px] text-[12px] leading-tight py-0.5"
                    style={{ color: C.ink }}
                    placeholder={placeholderForDestination(selectedRelayKind, selectedRelayId)}
                    rows={1}
                    value={relayDraft}
                    onChange={(event) => setRelayDraft(event.currentTarget.value)}
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

      {/* Global Bottom Bar */}
      <div className="h-6 border-t flex items-center justify-between px-3 shrink-0 text-[9px] font-mono uppercase tracking-widest" style={{ backgroundColor: C.bg, borderTopColor: C.border, color: C.muted }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 hover:opacity-70 cursor-pointer transition-opacity">
            <LayoutGrid size={9} /> Home
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView('logs')}
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
          <span>{cleanDisplayTitle(thread.title)} is working</span>
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
      await copyTextToClipboard(stableMessageRef(messageId));
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
                  <div className="flex flex-col gap-2">{renderMessageBody(entry.body, inkStyle, mutedStyle, tagStyle)}</div>
                  {entry.receipt ? (
                    <RelayReceiptInline receipt={entry.receipt} mutedStyle={mutedStyle} />
                  ) : null}
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
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div
            className={`w-8 h-8 rounded text-white flex items-center justify-center text-[11px] font-bold ${agent.reachable ? '' : 'opacity-40 grayscale'}`}
            style={{ backgroundColor: colorForIdentity(agent.id) }}
          >
            {agent.title.charAt(0).toUpperCase()}
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${relayPresenceDotClass(agent.state)}`}
            style={{ border: `1px solid ${C.surface}` }}
          ></div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12px] font-semibold truncate" style={{ color: C.ink }}>{agent.title}</div>
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: C.tagBg, color: C.muted }}>
              {interAgentProfileKindLabel(agent.profileKind)}
            </span>
          </div>
          <div className="text-[10px] mt-1" style={mutedStyle}>
            {directThread?.statusDetail ?? agent.statusDetail ?? agent.summary ?? 'Available as a local relay channel.'}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] mt-2" style={mutedStyle}>
            <span>{agent.harness ?? 'runtime'}</span>
            <span>{compactHomePath(agent.projectRoot ?? agent.cwd) ?? 'no path'}</span>
            {agent.lastChatLabel ? <span>last chat {agent.lastChatLabel}</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
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
      </div>
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
}: {
  receipt: NonNullable<RelayMessage['receipt']>;
  mutedStyle: React.CSSProperties;
}) {
  const tone = relayReceiptTone(receipt.state);
  return (
    <div
      className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] leading-none"
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
    case 'seen':
      return { color: 'var(--os-accent)' };
    case 'delivered':
      return { color: '#64748b' };
    case 'sent':
    default:
      return { color: 'var(--os-muted)' };
  }
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

  return value.replace(/\bproject twin\b/gi, (match) => (
    match[0] === match[0].toUpperCase() ? 'Relay Agent' : 'relay agent'
  ));
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
