"use client";

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LayoutGrid,
  FileText,
  PenTool,
  MessageSquare,
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
  Send,
  Sun,
  Moon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  DesktopShellState,
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

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<'overview' | 'sessions' | 'search' | 'relay'>('overview');
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
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [dark, setDark] = useState(false);
  const isDragging = useRef(false);
  const relayComposerRef = useRef<HTMLTextAreaElement | null>(null);

  const sessions = shellState?.sessions ?? [];
  const runtime = shellState?.runtime ?? null;
  const relayState = shellState?.relay ?? null;

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

    const availableDestinations = [
      ...relayState.channels.map((item) => `${item.kind}:${item.id}`),
      ...relayState.views.map((item) => `${item.kind}:${item.id}`),
      ...relayState.directs.map((item) => `${item.kind}:${item.id}`),
    ];

    const currentKey = `${selectedRelayKind}:${selectedRelayId}`;
    if (!availableDestinations.includes(currentKey)) {
      setSelectedRelayKind('channel');
      setSelectedRelayId('shared');
    }
  }, [relayState, selectedRelayId, selectedRelayKind]);

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

  const relayViewItems = useMemo(() => ensureOverviewView(relayState?.views ?? [], relayState?.messages ?? []), [relayState]);
  const relayCurrentDestination = relayState
    ? resolveRelayDestination(relayState, relayViewItems, selectedRelayKind, selectedRelayId)
    : null;
  const selectedRelayDirectThread = relayState && selectedRelayKind === 'direct'
    ? relayState.directs.find((item) => item.id === selectedRelayId) ?? null
    : null;
  const visibleRelayMessages = relayState
    ? filterRelayMessages(relayState.messages, selectedRelayKind, selectedRelayId)
    : [];
  const relayThreadTitle = cleanDisplayTitle(relayCurrentDestination?.title ?? '# shared-channel');
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

  const handleBrokerControl = async (action: 'start' | 'stop' | 'restart') => {
    if (!window.openScoutDesktop) {
      setShellError('Electron desktop bridge is unavailable.');
      return;
    }

    setRelayFeedback(`${action[0]?.toUpperCase()}${action.slice(1)}ing broker…`);
    try {
      const nextState = await window.openScoutDesktop.controlBroker(action);
      setShellState(nextState);
      setShellError(null);
      setRelayFeedback(`Broker ${action}ed.`);
    } catch (error) {
      setRelayFeedback(asErrorMessage(error));
    }
  };

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
      });
      setShellState(nextState);
      setRelayDraft('');
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
              Broker <span className="font-medium" style={s.inkText}>{runtime?.brokerReachable ? 'Running' : 'Offline'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
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
              ['sessions', <Radar size={16} strokeWidth={1.5} />, 'Session History'],
              ['search',   <Search size={16} strokeWidth={1.5} />, 'Search'],
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
            {(activeView === 'sessions' || activeView === 'relay' || activeView === 'search') && (
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-1.5 rounded flex items-center justify-center transition-opacity hover:opacity-70"
                style={s.mutedText}
                title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              >
                {isCollapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
              </button>
            )}
            <button className="p-1.5 rounded flex items-center justify-center transition-opacity hover:opacity-70" style={s.mutedText}>
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
                  <div className="os-fade-in text-[10px] font-mono tracking-widest uppercase mb-4 flex items-center gap-2" style={s.mutedText}>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 os-status-pulse"></div>
                    Command Center
                  </div>
                  <h1 className="os-fade-up text-5xl font-bold mb-4 tracking-tight leading-tight" style={s.inkText}>
                    Your agents,<br />unified.
                  </h1>
                  <p className="os-fade-up os-stagger-1 text-lg mb-8 max-w-xl leading-relaxed" style={s.mutedText}>
                    Collaborate with Claude, Codex, GPT, and more. See their plans, track their work, and search every conversation across all your machines.
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
                  { value: `${Math.round(stats.totalTokens / 1000)}k`, label: 'Tokens processed' },
                  { value: stats.projects, label: 'Active projects' },
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
                <span className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Index Ready
                </span>
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
                <span className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Index Ready
                </span>
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
                  {/* Channels */}
                  <div className="mb-3 px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Channels</div>
                    <div className="flex flex-col gap-px">
                      {relayState?.channels.map((channel) => {
                        const active = selectedRelayKind === channel.kind && selectedRelayId === channel.id;
                        return (
                          <button
                            key={`${channel.kind}:${channel.id}`}
                            className={`os-rail-row flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left${active ? ' os-rail-row-active' : ''}`}
                            style={active ? s.activeItem : s.mutedText}
                            onClick={() => {
                              setSelectedRelayKind(channel.kind);
                              setSelectedRelayId(channel.id);
                            }}
                          >
                            {channel.id === 'voice' ? (
                              <Radio size={12} className="os-row-icon shrink-0" style={active ? { color: C.accent } : undefined} />
                            ) : channel.id === 'system' ? (
                              <Settings size={12} className="os-row-icon shrink-0" style={active ? { color: C.accent } : undefined} />
                            ) : (
                              <Hash size={12} className="os-row-icon shrink-0" style={active ? { color: C.accent } : undefined} />
                            )}
                            <span className="font-medium text-[12px] flex-1 truncate">{cleanDisplayTitle(channel.title)}</span>
                            <span className="os-row-count text-[9px] font-mono" style={s.mutedText}>{channel.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Views */}
                  <div className="mb-3 px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Views</div>
                    <div className="flex flex-col gap-px">
                      {relayViewItems.map((view) => {
                        const active = selectedRelayKind === view.kind && selectedRelayId === view.id;
                        const icon = view.id === 'mentions'
                          ? <AtSign size={12} className="os-row-icon shrink-0" style={active ? { color: C.accent } : undefined} />
                          : <Radar size={12} className="os-row-icon shrink-0" style={active ? { color: C.accent } : undefined} />;
                        return (
                          <button
                            key={`${view.kind}:${view.id}`}
                            className={`os-rail-row flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left${active ? ' os-rail-row-active' : ''}`}
                            style={active ? s.activeItem : s.mutedText}
                            onClick={() => {
                              setSelectedRelayKind(view.kind);
                              setSelectedRelayId(view.id);
                            }}
                          >
                            {icon}
                            <span className="font-medium text-[12px] flex-1 truncate">{cleanDisplayTitle(view.title)}</span>
                            {view.count > 0 ? (
                              <span className="os-row-count text-[9px] font-mono px-1 rounded" style={active ? s.activePill : s.tagBadge}>
                                {view.count}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Agents */}
                  <div className="px-1.5">
                    <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={s.mutedText}>Agents</div>
                    <div className="flex flex-col gap-px">
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
                            <span
                              className="os-rail-pill min-w-[2rem] text-center text-[8px] font-mono uppercase tracking-wider border rounded px-1.5 py-0.5"
                              style={relayPresencePillStyle(dm.state)}
                            >
                              {relayPresenceIndicatorLabel(dm.state)}
                            </span>
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
                    ) : selectedRelayKind === 'filter' ? (
                      <Radar size={14} style={s.mutedText} />
                    ) : selectedRelayId === 'voice' ? (
                      <Radio size={14} style={s.mutedText} />
                    ) : selectedRelayId === 'system' ? (
                      <Settings size={14} style={s.mutedText} />
                    ) : (
                      <Hash size={14} style={s.mutedText} />
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
                    {selectedRelayDirectThread?.statusDetail ? (
                      <div className="text-[10px] truncate mt-0.5" style={s.mutedText}>
                        {selectedRelayDirectThread.statusDetail}
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
                      inkStyle={s.inkText}
                      mutedStyle={s.mutedText}
                      tagStyle={s.tagBadge}
                      annotStyle={s.annotBadge}
                    />
                    {selectedRelayDirectThread?.state === 'working' ? (
                      <RelayThinkingIndicator
                        thread={selectedRelayDirectThread}
                        inkStyle={s.inkText}
                        mutedStyle={s.mutedText}
                        tagStyle={s.tagBadge}
                      />
                    ) : null}
                  </div>
                )}
              </div>

              {/* Compose */}
              <div className="px-4 py-3 shrink-0" style={s.surface}>
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
                  {selectedRelayDirectThread ? (
                    <>
                      <div className={`w-1.5 h-1.5 rounded-full ${relayPresenceDotClass(selectedRelayDirectThread.state)}`}></div>
                      <span>{selectedRelayDirectThread.statusLabel}</span>
                      {selectedRelayDirectThread.state === 'working' ? <TypingDots className="text-[var(--os-accent)]" /> : null}
                    </>
                  ) : (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                      <span>Channel Active</span>
                    </>
                  )}
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
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Ready
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span>OpenScout</span>
        </div>
      </div>
    </div>
  );
}

function RelayPresenceBadge({ thread }: { thread: RelayDirectThread }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.18em] border rounded-full px-2 py-1 shrink-0"
      style={relayPresencePillStyle(thread.state)}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${relayPresenceDotClass(thread.state)}`}></span>
      <span>{thread.statusLabel}</span>
      {thread.state === 'working' ? <TypingDots className="text-[var(--os-accent)]" /> : null}
    </span>
  );
}

function RelayThinkingIndicator({
  thread,
  inkStyle,
  mutedStyle,
  tagStyle,
}: {
  thread: RelayDirectThread;
  inkStyle: React.CSSProperties;
  mutedStyle: React.CSSProperties;
  tagStyle: React.CSSProperties;
}) {
  return (
    <div className="flex gap-2.5 mb-2">
      <div
        className="w-6 h-6 rounded text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
        style={{ backgroundColor: colorForIdentity(thread.id) }}
      >
        {thread.title.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[12px]" style={inkStyle}>{cleanDisplayTitle(thread.title)}</span>
          <RelayPresenceBadge thread={thread} />
        </div>
        <div
          className="mt-1 inline-flex items-center gap-2 border rounded-full px-3 py-1.5"
          style={{ ...tagStyle, borderColor: 'rgba(0,102,255,0.2)', backgroundColor: 'rgba(0,102,255,0.08)', color: 'var(--os-accent)' }}
        >
          <TypingDots className="text-[var(--os-accent)]" />
          <span className="text-[11px] normal-case tracking-normal" style={inkStyle}>
            {thread.activeTask ?? thread.statusDetail ?? 'Working on your latest message.'}
          </span>
        </div>
        <div className="text-[10px] mt-1" style={mutedStyle}>
          Live broker activity for this direct thread.
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
  inkStyle,
  mutedStyle,
  tagStyle,
  annotStyle,
}: {
  messages: RelayMessage[];
  showAnnotations: boolean;
  inkStyle: React.CSSProperties;
  mutedStyle: React.CSSProperties;
  tagStyle: React.CSSProperties;
  annotStyle: React.CSSProperties;
}) {
  const rows: React.ReactNode[] = [];
  let lastDayLabel = '';
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    const visibleRole = shouldRenderRole(message.authorRole) ? message.authorRole : null;

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
                <span className="font-semibold text-[12px]" style={inkStyle}>{message.authorName}</span>
                <span className="text-[9px] font-mono" style={mutedStyle}>{message.timestampLabel}</span>
              </div>
            </div>
            <div className="text-[12px] leading-relaxed" style={inkStyle}>
              <div className="flex items-center gap-2 px-2 py-1.5 border rounded font-mono text-[10px] w-fit" style={tagStyle}>
                <Loader2 size={10} className="animate-spin" />
                <span><span style={mutedStyle}>TASK //</span> {message.body}</span>
                <span className="ml-2 px-1 rounded" style={{ backgroundColor: 'rgba(99,102,241,0.12)', color: 'var(--os-accent)' }}>IN PROGRESS</span>
              </div>
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
      cursor < messages.length &&
      messages[cursor].authorId === message.authorId &&
      messages[cursor].dayLabel === message.dayLabel &&
      !messages[cursor].isSystem &&
      messages[cursor].messageClass !== 'status'
    ) {
      grouped.push(messages[cursor]);
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
              <span className="font-semibold text-[12px]" style={inkStyle}>{message.authorName}</span>
              {visibleRole ? (
                <span className="text-[9px] font-mono border px-1 py-0.5 rounded" style={tagStyle}>{visibleRole}</span>
              ) : null}
              <span className="text-[9px] font-mono" style={mutedStyle}>{message.timestampLabel}</span>
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
            {grouped.map((entry) => (
              <div key={entry.id} className="text-[12px] leading-relaxed" style={inkStyle}>
                <div className="flex flex-col gap-2">{renderMessageBody(entry.body, inkStyle, mutedStyle, tagStyle)}</div>
                {entry.receipt ? (
                  <div
                    className="mt-1 inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.18em] border rounded-full px-2 py-1 w-fit"
                    style={relayReceiptStyle(entry.receipt.state)}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${relayReceiptDotClass(entry.receipt.state)}`}></span>
                    <span>{entry.receipt.label}</span>
                    {entry.receipt.detail ? (
                      <span className="normal-case tracking-normal opacity-80">{entry.receipt.detail}</span>
                    ) : null}
                  </div>
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
              </div>
            ))}
          </div>
        </div>
      </div>,
    );

    index = cursor;
  }

  return <>{rows}</>;
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

function relayReceiptDotClass(state: NonNullable<RelayMessage['receipt']>['state']) {
  switch (state) {
    case 'replied':
      return 'bg-emerald-500';
    case 'seen':
      return 'bg-[var(--os-accent)]';
    case 'delivered':
      return 'bg-sky-500';
    case 'sent':
    default:
      return 'bg-zinc-400/60';
  }
}

function relayReceiptStyle(state: NonNullable<RelayMessage['receipt']>['state']): React.CSSProperties {
  switch (state) {
    case 'replied':
      return {
        borderColor: 'rgba(16,185,129,0.18)',
        backgroundColor: 'rgba(16,185,129,0.08)',
        color: '#059669',
      };
    case 'seen':
      return {
        borderColor: 'rgba(0,102,255,0.2)',
        backgroundColor: 'rgba(0,102,255,0.08)',
        color: 'var(--os-accent)',
      };
    case 'delivered':
      return {
        borderColor: 'rgba(14,165,233,0.18)',
        backgroundColor: 'rgba(14,165,233,0.08)',
        color: '#0284c7',
      };
    case 'sent':
    default:
      return {
        borderColor: 'var(--os-border)',
        backgroundColor: 'var(--os-tag-bg)',
        color: 'var(--os-muted)',
      };
  }
}

function shouldRenderRole(role: string | null) {
  if (!role) {
    return false;
  }
  return role.trim().toLowerCase() !== 'operator';
}

function resolveRelayDestination(
  relayState: DesktopShellState['relay'],
  views: RelayNavItem[],
  kind: RelayDestinationKind,
  id: string,
) {
  if (kind === 'channel') {
    return relayState.channels.find((item) => item.id === id) ?? null;
  }
  if (kind === 'filter') {
    return views.find((item) => item.id === id) ?? null;
  }
  return relayState.directs.find((item) => item.id === id) ?? null;
}

function filterRelayMessages(messages: RelayMessage[], kind: RelayDestinationKind, id: string) {
  if (kind === 'direct') {
    return messages.filter(
      (message) =>
        message.isDirectConversation &&
        message.messageClass !== 'status' &&
        (message.authorId === id || message.recipients.includes(id)),
    );
  }

  if (kind === 'filter' && id === 'overview') {
    return messages.filter((message) => !message.isVoice && message.messageClass !== 'status');
  }

  if (kind === 'filter' && id === 'mentions') {
    return messages.filter(
      (message) =>
        !message.isDirectConversation &&
        !message.isSystem &&
        !message.isVoice &&
        message.messageClass !== 'status' &&
        message.recipients.length > 0,
    );
  }

  if (kind === 'channel' && id === 'voice') {
    return messages.filter((message) => message.isVoice && message.messageClass !== 'status');
  }

  if (kind === 'channel' && id === 'system') {
    return messages.filter((message) => message.isSystem || message.messageClass === 'status');
  }

  return messages.filter(
    (message) =>
      !message.isDirectConversation &&
      !message.isSystem &&
      !message.isVoice &&
      message.messageClass !== 'status' &&
      (!message.normalizedChannel || message.normalizedChannel === 'shared'),
  );
}

function ensureOverviewView(views: RelayNavItem[], messages: RelayMessage[]) {
  if (views.some((view) => view.id === 'overview')) {
    return views;
  }

  const overviewItem: RelayNavItem = {
    kind: 'filter',
    id: 'overview',
    title: 'Overview',
    subtitle: 'Cross-agent activity and workspace traffic.',
    count: messages.filter((message) => !message.isVoice).length,
  };

  return [overviewItem, ...views];
}

function placeholderForDestination(kind: RelayDestinationKind, id: string) {
  if (kind === 'direct') {
    return 'Message direct thread...';
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

function asErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Action failed.';
}
