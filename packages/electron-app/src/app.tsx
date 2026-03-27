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
  Upload,
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
  Terminal,
  Mic,
  Send,
  Sun,
  Moon,
} from 'lucide-react';
import type {
  DesktopShellState,
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
  const visibleRelayMessages = relayState
    ? filterRelayMessages(relayState.messages, selectedRelayKind, selectedRelayId)
    : [];
  const relayThreadTitle = cleanDisplayTitle(relayCurrentDestination?.title ?? '# shared-channel');

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
            <div className="flex-1 overflow-y-auto p-12">
              <div className="max-w-4xl">
                <div className="text-[10px] font-mono tracking-widest uppercase mb-2" style={s.mutedText}>Overview</div>
                <h1 className="text-3xl font-bold mb-2 tracking-tight" style={s.inkText}>Agent Interaction Shell</h1>
                <p className="text-[14px] mb-8 max-w-2xl leading-relaxed" style={s.mutedText}>
                  OpenScout now centers relay traffic, launch-agent broker state, and local tmux runtimes so the shell can help you steer agent work with confidence.
                </p>

                <div className="flex items-center gap-3 mb-10">
                  <button
                    onClick={() => setActiveView('relay')}
                    className="text-white px-4 py-1.5 rounded-md text-[13px] font-medium transition-opacity hover:opacity-80 shadow-sm flex items-center gap-2"
                    style={{ backgroundColor: C.accent }}
                  >
                    <MessageSquare size={14} />
                    Open Relay
                  </button>
                  <button
                    onClick={() => setActiveView('sessions')}
                    className="border px-4 py-1.5 rounded-md text-[13px] font-medium transition-opacity hover:opacity-80 shadow-sm"
                    style={{ ...s.surface, borderColor: C.border, color: C.ink }}
                  >
                    Browse Sessions
                  </button>
                  <button
                    onClick={() => void handleRefreshShell()}
                    className="border px-4 py-1.5 rounded-md text-[13px] font-medium transition-opacity hover:opacity-80 shadow-sm"
                    style={{ ...s.surface, borderColor: C.border, color: C.ink }}
                  >
                    Refresh Runtime
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-12">
                  {[
                    { label: 'Agents', value: runtime?.agentCount ?? 0, desc: 'Known broker-backed agents and registered twins.' },
                    { label: 'Messages', value: runtime?.messageCount ?? 0, desc: 'Total relay messages stored in the control plane.' },
                    { label: 'Flights', value: runtime?.flightCount ?? 0, desc: 'Invocation flights currently tracked by the broker.' },
                  ].map(card => (
                    <div key={card.label} className="border rounded-xl p-5 shadow-sm" style={{ ...s.surface, borderColor: C.border }}>
                      <div className="text-[10px] font-mono tracking-widest uppercase mb-3" style={s.mutedText}>{card.label}</div>
                      <div className="text-4xl font-semibold mb-3" style={s.inkText}>{card.value}</div>
                      <div className="text-[12px] leading-relaxed" style={s.mutedText}>{card.desc}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="text-[10px] font-mono tracking-widest uppercase mb-4" style={s.mutedText}>Projects</div>
                  <div className="flex flex-col">
                    {projects.map((project, i) => (
                      <div key={project.name} className="border-t py-4" style={{ borderColor: C.border, ...(i === projects.length - 1 ? { borderBottom: `1px solid ${C.border}` } : {}) }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Folder size={14} style={s.mutedText} />
                            <span className="text-[13px] font-semibold" style={s.inkText}>{project.name}</span>
                            <span className="text-[9px] font-mono border px-1.5 py-0.5 rounded" style={s.tagBadge}>{project.count} SESSIONS</span>
                          </div>
                          <button
                            onClick={() => { setSelectedProject(project.name); setActiveView('sessions'); }}
                            className="text-[11px] flex items-center gap-1 hover:opacity-70 transition-opacity"
                            style={{ color: C.accent }}
                          >
                            View <ChevronRight size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {shellError ? (
                  <div className="mt-10">
                    <div className="text-[10px] font-mono tracking-widest uppercase mb-4" style={s.mutedText}>Runtime Error</div>
                    <div className="flex items-center gap-2 px-3 py-2 text-[12px] border rounded" style={{ ...s.surface, borderColor: C.border, color: C.muted }}>
                      <X size={12} />
                      <span>{shellError}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Right Sidebar (Index Status) */}
            <div className="w-64 border-l p-8 shrink-0 overflow-y-auto" style={{ ...s.navBar, borderLeftColor: C.border }}>
              <div className="text-[10px] font-mono tracking-widest uppercase mb-6" style={s.mutedText}>Runtime</div>
              {[
                { label: 'Helper', value: runtime?.helperRunning ? 'Running' : 'Offline' },
                { label: 'Broker', value: runtime?.brokerReachable ? 'Running' : 'Offline' },
                { label: 'Relay', value: runtime?.brokerHealthy ? 'Active' : 'Waiting' },
                { label: 'Agents', value: runtime?.agentCount ?? 0, mono: true },
                { label: 'Last Heartbeat', value: runtime?.lastHeartbeatLabel ?? '—', mono: true },
                { label: 'Latest Relay', value: runtime?.latestRelayLabel ?? '—', mono: true },
              ].map(row => (
                <div key={row.label} className="mb-5">
                  <div className="text-[9px] font-mono tracking-widest uppercase mb-1" style={s.mutedText}>{row.label}</div>
                  <div className={`text-[13px] font-semibold ${row.mono ? 'font-mono' : ''}`} style={row.mono ? s.mutedText : s.inkText}>{row.value}</div>
                </div>
              ))}
              <div className="flex flex-col gap-2 mt-8">
                <button className="border px-3 py-1.5 rounded-md text-[12px] font-medium" style={{ ...s.surface, borderColor: C.border, color: C.ink }} onClick={() => void handleBrokerControl('start')}>
                  Start Broker
                </button>
                <button className="border px-3 py-1.5 rounded-md text-[12px] font-medium" style={{ ...s.surface, borderColor: C.border, color: C.ink }} onClick={() => void handleBrokerControl('restart')}>
                  Restart Broker
                </button>
                <button className="border px-3 py-1.5 rounded-md text-[12px] font-medium" style={{ ...s.surface, borderColor: C.border, color: C.ink }} onClick={() => void handleBrokerControl('stop')}>
                  Stop Broker
                </button>
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
                            className="flex items-center gap-2 px-1.5 py-1 shadow-sm border rounded cursor-pointer w-full text-left"
                            style={active ? s.activeItem : { ...s.surface, borderColor: 'transparent', color: C.muted }}
                            onClick={() => {
                              setSelectedRelayKind(channel.kind);
                              setSelectedRelayId(channel.id);
                            }}
                          >
                            {channel.id === 'voice' ? (
                              <Radio size={12} style={active ? { color: C.accent } : undefined} />
                            ) : channel.id === 'system' ? (
                              <Settings size={12} style={active ? { color: C.accent } : undefined} />
                            ) : (
                              <Hash size={12} style={active ? { color: C.accent } : undefined} />
                            )}
                            <span className="font-medium text-[12px] flex-1 truncate">{cleanDisplayTitle(channel.title)}</span>
                            <span className="text-[9px] font-mono" style={s.mutedText}>{channel.count}</span>
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
                        const icon = view.id === 'mentions' ? <AtSign size={12} style={active ? { color: C.accent } : undefined} /> : <Radar size={12} style={active ? { color: C.accent } : undefined} />;
                        return (
                          <button
                            key={`${view.kind}:${view.id}`}
                            className="flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left"
                            style={active ? s.activeItem : s.mutedText}
                            onClick={() => {
                              setSelectedRelayKind(view.kind);
                              setSelectedRelayId(view.id);
                            }}
                          >
                            {icon}
                            <span className="font-medium text-[12px] flex-1 truncate">{cleanDisplayTitle(view.title)}</span>
                            {view.count > 0 ? (
                              <span className="text-[9px] font-mono px-1 rounded" style={active ? s.activePill : { ...s.tagBadge, color: C.accent }}>
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
                            className="flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left"
                            style={active ? s.activeItem : s.mutedText}
                            onClick={() => {
                              setSelectedRelayKind('direct');
                              setSelectedRelayId(dm.id);
                            }}
                          >
                            <div className="relative shrink-0">
                              <div
                                className={`w-4 h-4 rounded text-white flex items-center justify-center font-bold text-[8px] ${dm.reachable ? '' : 'opacity-40 grayscale'}`}
                                style={{ backgroundColor: colorForIdentity(dm.id) }}
                              >
                                {dm.title.charAt(0).toUpperCase()}
                              </div>
                              <div className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${dm.reachable ? 'bg-emerald-500' : 'bg-transparent'}`} style={{ border: `1px solid ${C.bg}` }}></div>
                            </div>
                            <div className={`flex-1 min-w-0 ${dm.reachable ? '' : 'opacity-50'}`}>
                              <div className="font-medium text-[12px] truncate">{cleanDisplayTitle(dm.title)}</div>
                              <div className="text-[10px] truncate" style={s.mutedText}>{dm.subtitle}</div>
                            </div>
                            <span className={`text-[8px] font-mono uppercase tracking-wider ${dm.reachable ? 'text-emerald-500' : 'opacity-40'}`}>
                              {dm.reachable ? 'ON' : 'OFF'}
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
              <div className="h-10 border-b flex items-center justify-between px-4 shrink-0" style={{ ...s.surface, borderBottomColor: C.border }}>
                <div className="flex items-center gap-2">
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
                  <h2 className="text-[13px] font-semibold tracking-tight" style={s.inkText}>{relayThreadTitle}</h2>
                  {relayCurrentDestination && 'count' in relayCurrentDestination && relayCurrentDestination.count > 0 ? (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={s.tagBadge}>
                      {relayCurrentDestination.count}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAnnotations(!showAnnotations)}
                    className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded transition-opacity hover:opacity-70"
                    style={showAnnotations ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
                  >
                    Annotations <span className="font-mono uppercase">{showAnnotations ? 'On' : 'Off'}</span>
                  </button>
                  <button className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded opacity-70 cursor-default" style={{ backgroundColor: C.bg, color: C.muted }}>
                    {relayState?.voice.captureTitle ?? 'Capture'} <span className="font-mono uppercase" style={{ color: C.accent }}>{relayState?.voice.captureState ?? 'Off'}</span>
                  </button>
                  <button className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded opacity-70 cursor-default" style={{ backgroundColor: C.bg, color: C.muted }}>
                    Playback <span className="font-mono uppercase" style={{ color: C.accent }}>{relayState?.voice.repliesEnabled ? 'On' : 'Off'}</span>
                  </button>
                  <button className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded hover:opacity-70" style={{ color: C.ink }} onClick={() => void handleRefreshShell()}>
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
                  <RelayTimeline
                    messages={visibleRelayMessages}
                    showAnnotations={showAnnotations}
                    inkStyle={s.inkText}
                    mutedStyle={s.mutedText}
                    tagStyle={s.tagBadge}
                    annotStyle={s.annotBadge}
                  />
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
                <span className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest" style={s.mutedText}>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Channel Active
                </span>
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
                  <div className="mt-1 text-[9px] font-mono uppercase tracking-wide" style={mutedStyle}>
                    {entry.receipt.label}{entry.receipt.detail ? ` · ${entry.receipt.detail}` : ''}
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
  const parts = parseBodySegments(body);
  return parts.map((part, index) => {
    if (part.type === 'paragraph') {
      return <p key={index}>{part.text}</p>;
    }

    if (part.type === 'quote') {
      return (
        <div key={index} className="pl-2.5 border-l-2 italic" style={{ borderLeftColor: 'var(--os-border)', color: mutedStyle.color }}>
          {part.text}
        </div>
      );
    }

    return (
      <div key={index} className="p-2.5 rounded font-mono text-[10px] overflow-x-auto leading-normal" style={{ backgroundColor: C.termBg, color: C.termFg }}>
        <div className="flex items-center gap-2 mb-1.5 opacity-50 select-none">
          <Terminal size={10} />
          <span>probe-01 ~</span>
        </div>
        <pre className="whitespace-pre-wrap">{part.text}</pre>
      </div>
    );
  });
}

function parseBodySegments(body: string): Array<{ type: 'paragraph' | 'quote' | 'code'; text: string }> {
  const lines = body.split('\n');
  const segments: Array<{ type: 'paragraph' | 'quote' | 'code'; text: string }> = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      segments.push({ type: 'code', text: codeLines.join('\n') });
      index += 1;
      continue;
    }

    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      segments.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      !lines[index].trim().startsWith('>') &&
      !lines[index].trim().startsWith('```')
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    segments.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return segments;
}

function asErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Action failed.';
}
