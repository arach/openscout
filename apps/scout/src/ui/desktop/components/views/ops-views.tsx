import React from 'react';
import { Calendar, Clock, FileText, LayoutGrid, Search, Tag, X } from 'lucide-react';

import MachinesView from '@/components/machines-view';
import PlansView from '@/components/plans-view';
import { colorForIdentity } from '@/components/relay/relay-utils';
import type { AppView } from '@/app-types';
import { C } from '@/lib/theme';
import type { SessionMetadata } from '@/lib/scout-desktop';

interface SearchViewStyles {
  sidebar: React.CSSProperties;
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  activeItem: React.CSSProperties;
  kbd: React.CSSProperties;
}

interface SearchViewModel {
  isCollapsed: boolean;
  sidebarWidth: number;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  styles: SearchViewStyles;
  availableAgentNames: string[];
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  filteredSessions: SessionMetadata[];
  stats: {
    totalSessions: number;
    totalMessages: number;
  };
  formatDate: (value: string) => string;
  onOpenSession: (session: SessionMetadata) => void;
}

export interface OpsViewsProps {
  activeView: AppView;
  machinesViewProps: React.ComponentProps<typeof MachinesView>;
  plansViewProps: React.ComponentProps<typeof PlansView>;
  search: SearchViewModel;
}

export function OpsViews({
  activeView,
  machinesViewProps,
  plansViewProps,
  search,
}: OpsViewsProps) {
  if (activeView === 'machines') {
    return <MachinesView {...machinesViewProps} />;
  }

  if (activeView === 'plans') {
    return <PlansView {...plansViewProps} />;
  }

  if (activeView !== 'search') {
    return null;
  }

  return (
    <>
      {!search.isCollapsed && (
        <div style={{ width: search.sidebarWidth, ...search.styles.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
          <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={search.onResizeStart} />
          <div className="px-3 py-2.5 flex items-center justify-between border-b" style={{ borderBottomColor: C.border }}>
            <div>
              <h1 className="text-[13px] font-semibold tracking-tight" style={search.styles.inkText}>Search</h1>
              <div className="text-[10px] font-mono mt-0.5" style={search.styles.mutedText}>Full-text search</div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            <div className="mb-3 px-1.5">
              <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={search.styles.mutedText}>Scope</div>
              <div className="flex flex-col gap-px">
                <button className="flex items-center gap-2 px-1.5 py-1 shadow-sm border rounded text-[12px]" style={search.styles.activeItem}>
                  <LayoutGrid size={12} style={{ color: C.accent }} />
                  <span className="font-medium flex-1 truncate text-left">All Sessions</span>
                </button>
                {[['Content Only', <FileText size={12} />], ['Tags Only', <Tag size={12} />]].map(([label, icon]) => (
                  <button key={label as string} className="flex items-center gap-2 px-1.5 py-1 rounded text-[12px] hover:opacity-80 transition-opacity" style={search.styles.mutedText}>
                    {icon as React.ReactNode}
                    <span className="font-medium flex-1 truncate text-left">{label as string}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3 px-1.5">
              <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={search.styles.mutedText}>Time Range</div>
              <div className="flex flex-col gap-px">
                <button className="flex items-center gap-2 px-1.5 py-1 shadow-sm border rounded text-[12px]" style={search.styles.activeItem}>
                  <Calendar size={12} style={{ color: C.accent }} />
                  <span className="font-medium flex-1 truncate text-left">All Time</span>
                </button>
                {['Last 7 Days', 'Last 30 Days'].map((label) => (
                  <button key={label} className="flex items-center gap-2 px-1.5 py-1 rounded text-[12px] hover:opacity-80 transition-opacity" style={search.styles.mutedText}>
                    <Clock size={12} />
                    <span className="font-medium flex-1 truncate text-left">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3 px-1.5">
              <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={search.styles.mutedText}>Agents</div>
              <div className="flex flex-col gap-px">
                {search.availableAgentNames.map((agent) => (
                  <label key={agent} className="flex items-center gap-2 px-1.5 py-1 rounded text-[12px] hover:opacity-80 transition-opacity cursor-pointer" style={search.styles.mutedText}>
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

            <div className="px-1.5">
              <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={search.styles.mutedText}>Quick Filters</div>
              <div className="flex flex-wrap gap-1 px-1.5">
                {['code-review', 'debugging', 'docs', 'architecture', 'performance', 'testing'].map((tag) => (
                  <button key={tag} className="text-[9px] font-mono border px-1.5 py-0.5 rounded hover:opacity-70 transition-opacity" style={search.styles.tagBadge}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col relative min-w-0" style={search.styles.surface}>
        <div className="border-b shrink-0 p-4" style={{ ...search.styles.surface, borderBottomColor: C.border }}>
          <div className="flex items-center gap-3 border rounded-lg px-3 py-2 transition-all focus-within:ring-1" style={{ backgroundColor: C.bg, borderColor: C.border }}>
            <Search size={16} className="shrink-0" style={search.styles.mutedText} />
            <input
              type="text"
              placeholder="Search across all sessions, messages, and metadata..."
              value={search.searchQuery}
              onChange={(event) => search.setSearchQuery(event.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-[13px]"
              style={{ color: C.ink }}
            />
            {search.searchQuery && (
              <button onClick={() => search.setSearchQuery('')} className="p-1 hover:opacity-70" style={search.styles.mutedText}>
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2 text-[10px] font-mono" style={search.styles.mutedText}>
              <span>Press</span>
              <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-medium" style={search.styles.kbd}>Enter</kbd>
              <span>to search</span>
            </div>
            <div className="text-[10px] font-mono" style={search.styles.mutedText}>
              {search.searchQuery ? `${search.filteredSessions.length} results` : `${search.stats.totalSessions} sessions indexed`}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!search.searchQuery ? (
            <div className="p-6">
              <div className="font-mono text-[9px] tracking-widest uppercase mb-3" style={search.styles.mutedText}>Recent Searches</div>
              <div className="flex flex-col gap-2">
                {['authentication refactor', 'database migration', 'API performance'].map((term, index) => (
                  <button key={index} onClick={() => search.setSearchQuery(term)} className="flex items-center gap-2 text-left text-[12px] hover:opacity-70 transition-opacity" style={search.styles.mutedText}>
                    <Clock size={12} />
                    <span>{term}</span>
                  </button>
                ))}
              </div>
              <div className="font-mono text-[9px] tracking-widest uppercase mb-3 mt-8" style={search.styles.mutedText}>Popular Tags</div>
              <div className="flex flex-wrap gap-2">
                {['code-review', 'auth', 'security', 'database', 'migration', 'api', 'performance', 'testing', 'docs'].map((tag) => (
                  <button key={tag} onClick={() => search.setSearchQuery(tag)} className="text-[11px] font-mono border px-2 py-1 rounded hover:opacity-70 transition-opacity" style={search.styles.tagBadge}>
                    #{tag}
                  </button>
                ))}
              </div>
              <div className="font-mono text-[9px] tracking-widest uppercase mb-3 mt-8" style={search.styles.mutedText}>Search Tips</div>
              <div className="text-[12px] space-y-2" style={search.styles.mutedText}>
                {[
                  ['project:openscout-core', 'Search within a project'],
                  ['agent:claude', 'Filter by agent'],
                  ['tag:security', 'Search by tag'],
                  ['"exact phrase"', 'Match exact phrase'],
                ].map(([code, description]) => (
                  <p key={code}><code className="border rounded px-1 font-mono text-[10px]" style={search.styles.tagBadge}>{code}</code>{' -- '}{description}</p>
                ))}
              </div>
            </div>
          ) : search.filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
                <Search size={24} style={{ color: C.accent }} />
              </div>
              <h3 className="text-[15px] font-medium mb-1" style={search.styles.inkText}>No results found</h3>
              <p className="text-[13px] max-w-sm" style={search.styles.mutedText}>Try different keywords or adjust your filters</p>
            </div>
          ) : (
            <div style={{ borderColor: C.border }} className="divide-y">
              {search.filteredSessions.map((session) => (
                <div
                  key={session.id}
                  className="px-4 py-4 cursor-pointer transition-opacity hover:opacity-90"
                  style={{ borderBottomColor: C.border }}
                  onClick={() => search.onOpenSession(session)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded text-white flex items-center justify-center text-[9px] font-bold"
                        style={{ backgroundColor: colorForIdentity(session.agent) }}
                      >
                        {session.agent.charAt(0)}
                      </div>
                      <span className="text-[13px] font-medium" style={search.styles.inkText}>{session.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[9px] font-mono border px-1.5 py-0.5 rounded" style={search.styles.tagBadge}>{session.project}</span>
                      <span className="text-[10px] font-mono" style={search.styles.mutedText}>{search.formatDate(session.lastModified)}</span>
                    </div>
                  </div>
                  <div className="text-[12px] mb-2 pl-7 leading-relaxed" style={search.styles.mutedText}>
                    {session.preview.split(new RegExp(`(${search.searchQuery})`, 'gi')).map((part, index) =>
                      part.toLowerCase() === search.searchQuery.toLowerCase() ? (
                        <mark key={index} className="px-0.5 rounded" style={{ backgroundColor: C.markBg, color: C.markFg }}>{part}</mark>
                      ) : (
                        <span key={index}>{part}</span>
                      ),
                    )}
                  </div>
                  <div className="flex items-center gap-3 pl-7">
                    <span className="text-[10px]" style={search.styles.mutedText}>{session.messageCount} messages</span>
                    {session.tokens ? <span className="text-[10px]" style={search.styles.mutedText}>{(session.tokens / 1000).toFixed(1)}k tokens</span> : null}
                    {session.model ? <span className="text-[9px] font-mono text-indigo-400 bg-indigo-950/30 px-1.5 py-0.5 rounded">{session.model}</span> : null}
                  </div>
                  {session.tags && session.tags.length > 0 ? (
                    <div className="flex items-center gap-1.5 mt-2 pl-7">
                      {session.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[9px] font-mono border px-1.5 py-0.5 rounded"
                          style={
                            tag.toLowerCase().includes(search.searchQuery.toLowerCase())
                              ? { backgroundColor: C.markBg, borderColor: C.border, color: C.markFg }
                              : search.styles.tagBadge
                          }
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-7 border-t flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
          <span className="text-[9px] font-mono" style={search.styles.mutedText}>Indexed: {search.stats.totalSessions} sessions / {search.stats.totalMessages} messages</span>
          <span className="text-[9px] font-mono uppercase tracking-widest" style={search.styles.mutedText}>Index Ready</span>
        </div>
      </div>
    </>
  );
}
