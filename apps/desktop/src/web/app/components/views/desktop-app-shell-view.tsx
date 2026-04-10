import React from 'react';
import {
  Bot,
  BookOpen,
  Copy,
  FileJson,
  FolderOpen,
  LayoutGrid,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  SendHorizontal,
  Settings,
  Settings2,
  Sun,
  X,
} from 'lucide-react';

import { ProductSurfaceLogo, PairingSurfacePlaceholder, describePairingSurfaceBadge } from '@/components/pairing-surface-placeholder';
import { Button } from '@/components/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/primitives/dialog';
import { Input } from '@/components/primitives/input';
import { Spinner } from '@/components/primitives/spinner';
import { Textarea } from '@/components/primitives/textarea';
import { normalizeCreateAgentHarness } from '@/app-utils';
import type { AppView, CreateAgentDraft, NavViewItem, ProductSurface } from '@/app-types';
import { compactHomePath } from '@web/features/messages/lib/relay-utils';
import { C } from '@/lib/theme';
import type {
  AgentSessionInspector,
  DesktopFeatureFlags,
  DesktopFeedbackBundle,
  DesktopFeedbackSubmission,
  DesktopShellState,
  InterAgentAgent,
  SetupProjectSummary,
} from '@/lib/scout-desktop';

type RenderLocalPathValue = (
  filePath: string | null | undefined,
  options?: { compact?: boolean; className?: string; style?: React.CSSProperties },
) => React.ReactNode;

type ShellStyles = {
  root: React.CSSProperties;
  topBar: React.CSSProperties;
  navBar: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  activePill: React.CSSProperties;
};

interface AgentSessionPeekDialogProps {
  open: boolean;
  selectedInterAgent: InterAgentAgent | null;
  visibleAgentSession: AgentSessionInspector | null;
  agentSessionPending: boolean;
  agentSessionLoading: boolean;
  agentSessionFeedback: string | null;
  agentSessionCopied: boolean;
  agentSessionPeekViewportRef: React.MutableRefObject<HTMLElement | null>;
  handlePeekAgentSessionScroll: React.UIEventHandler<HTMLElement>;
  handleCopyAgentSessionCommand: () => void;
  handleOpenAgentSession: () => void;
  closeAgentSessionPeek: () => void;
  renderLocalPathValue: RenderLocalPathValue;
  s: ShellStyles;
}

interface CreateAgentDialogProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  agentableProjects: SetupProjectSummary[];
  createAgentDraft: CreateAgentDraft;
  setCreateAgentDraft: React.Dispatch<React.SetStateAction<CreateAgentDraft>>;
  createAgentDefaults: CreateAgentDraft;
  createAgentSubmitting: boolean;
  createAgentFeedback: string | null;
  setCreateAgentFeedback: React.Dispatch<React.SetStateAction<string | null>>;
  handleBrowseCreateAgentProject: () => void;
  handleCreateAgent: () => void;
  availableAgentHarnesses: readonly CreateAgentDraft['harness'][];
  s: ShellStyles;
}

interface FeedbackDialogProps {
  open: boolean;
  handleFeedbackDialogOpenChange: (open: boolean) => void;
  feedbackDraft: string;
  setFeedbackDraft: React.Dispatch<React.SetStateAction<string>>;
  feedbackSubmission: DesktopFeedbackSubmission | null;
  feedbackActionPending: 'copy' | 'refresh' | 'repair' | 'submit' | null;
  feedbackBundleLoading: boolean;
  feedbackBundle: DesktopFeedbackBundle | null;
  feedbackBundleError: string | null;
  feedbackActionMessage: string | null;
  handleSubmitFeedbackReport: () => void;
  handleRefreshFeedbackBundle: () => void;
  handleRepairSetup: () => void;
  handleCopyFeedbackBundle: () => void;
  s: ShellStyles;
}

export interface DesktopAppShellViewProps {
  children: React.ReactNode;
  dark: boolean;
  setDark: React.Dispatch<React.SetStateAction<boolean>>;
  C: typeof C;
  s: ShellStyles;
  productSurface: ProductSurface;
  setProductSurface: React.Dispatch<React.SetStateAction<ProductSurface>>;
  activeView: AppView;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  desktopFeatures: DesktopFeatureFlags;
  pairingSurfaceBadge: ReturnType<typeof describePairingSurfaceBadge>;
  openRelayDiagnostics: () => void;
  relayStatusTitle: string;
  relayRuntimeBooting: boolean;
  relayStatusDotClassName: string;
  relayStatusLabel: string;
  runtime: DesktopShellState['runtime'] | null;
  headerAgentCount: number;
  appReloadPending: boolean;
  handleReloadApp: () => void;
  handleQuitApp: () => void;
  navViews: NavViewItem[];
  collapsibleViews: Set<AppView>;
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  pairingSurfaceProps: React.ComponentProps<typeof PairingSurfacePlaceholder>;
  isAgentSessionPeekOpen: boolean;
  selectedInterAgent: InterAgentAgent | null;
  visibleAgentSession: AgentSessionInspector | null;
  agentSessionPending: boolean;
  agentSessionLoading: boolean;
  agentSessionFeedback: string | null;
  agentSessionCopied: boolean;
  agentSessionPeekViewportRef: React.MutableRefObject<HTMLElement | null>;
  handlePeekAgentSessionScroll: React.UIEventHandler<HTMLElement>;
  closeAgentSessionPeek: () => void;
  handleCopyAgentSessionCommand: () => void;
  handleOpenAgentSession: () => void;
  renderLocalPathValue: RenderLocalPathValue;
  isCreateAgentDialogOpen: boolean;
  setIsCreateAgentDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  agentableProjects: SetupProjectSummary[];
  createAgentDraft: CreateAgentDraft;
  setCreateAgentDraft: React.Dispatch<React.SetStateAction<CreateAgentDraft>>;
  createAgentDefaults: CreateAgentDraft;
  createAgentSubmitting: boolean;
  createAgentFeedback: string | null;
  setCreateAgentFeedback: React.Dispatch<React.SetStateAction<string | null>>;
  handleBrowseCreateAgentProject: () => void;
  handleCreateAgent: () => void;
  availableAgentHarnesses: readonly CreateAgentDraft['harness'][];
  isFeedbackDialogOpen: boolean;
  handleFeedbackDialogOpenChange: (open: boolean) => void;
  feedbackDraft: string;
  setFeedbackDraft: React.Dispatch<React.SetStateAction<string>>;
  feedbackSubmission: DesktopFeedbackSubmission | null;
  feedbackActionPending: 'copy' | 'refresh' | 'repair' | 'submit' | null;
  feedbackBundleLoading: boolean;
  feedbackBundle: DesktopFeedbackBundle | null;
  feedbackBundleError: string | null;
  feedbackActionMessage: string | null;
  handleSubmitFeedbackReport: () => void;
  handleRefreshFeedbackBundle: () => void;
  handleRepairSetup: () => void;
  handleCopyFeedbackBundle: () => void;
  openFeedbackDialog: () => void;
  openKnowledgeBase: () => void;
  logsAttentionLevel: 'error' | 'warning' | null;
  logsButtonTitle: string;
  footerTimeLabel: string;
}

function AgentSessionPeekDialog({
  open,
  selectedInterAgent,
  visibleAgentSession,
  agentSessionPending,
  agentSessionLoading,
  agentSessionFeedback,
  agentSessionCopied,
  agentSessionPeekViewportRef,
  handlePeekAgentSessionScroll,
  handleCopyAgentSessionCommand,
  handleOpenAgentSession,
  closeAgentSessionPeek,
  renderLocalPathValue,
  s,
}: AgentSessionPeekDialogProps) {
  if (!open || !selectedInterAgent) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(244, 240, 232, 0.72)', backdropFilter: 'blur(6px)' }}
      onClick={closeAgentSessionPeek}
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
                onClick={handleCopyAgentSessionCommand}
              >
                {agentSessionCopied ? 'Copied' : 'Copy Attach'}
              </button>
            ) : null}
            {visibleAgentSession && visibleAgentSession.mode !== 'none' ? (
              <button
                className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                style={{ color: C.ink }}
                onClick={handleOpenAgentSession}
              >
                {visibleAgentSession.mode === 'tmux' ? 'Open TMUX' : 'Open Logs'}
              </button>
            ) : null}
            <button
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ color: C.ink }}
              onClick={closeAgentSessionPeek}
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
              onScroll={handlePeekAgentSessionScroll}
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
  );
}

function CreateAgentDialog({
  open,
  setOpen,
  agentableProjects,
  createAgentDraft,
  setCreateAgentDraft,
  createAgentDefaults,
  createAgentSubmitting,
  createAgentFeedback,
  setCreateAgentFeedback,
  handleBrowseCreateAgentProject,
  handleCreateAgent,
  availableAgentHarnesses,
  s,
}: CreateAgentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
                placeholder={createAgentDefaults.projectPath || '/path/to/project'}
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
                {availableAgentHarnesses.map((harness) => (
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
            onClick={() => setOpen(false)}
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
  );
}

function FeedbackDialog({
  open,
  handleFeedbackDialogOpenChange,
  feedbackDraft,
  setFeedbackDraft,
  feedbackSubmission,
  feedbackActionPending,
  feedbackBundleLoading,
  feedbackBundle,
  feedbackBundleError,
  feedbackActionMessage,
  handleSubmitFeedbackReport,
  handleRefreshFeedbackBundle,
  handleRepairSetup,
  handleCopyFeedbackBundle,
  s,
}: FeedbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={handleFeedbackDialogOpenChange}>
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
  );
}

export function DesktopAppShellView({
  children,
  dark,
  setDark,
  C: colors,
  s,
  productSurface,
  setProductSurface,
  activeView,
  setActiveView,
  desktopFeatures,
  pairingSurfaceBadge,
  openRelayDiagnostics,
  relayStatusTitle,
  relayRuntimeBooting,
  relayStatusDotClassName,
  relayStatusLabel,
  runtime,
  headerAgentCount,
  appReloadPending,
  handleReloadApp,
  handleQuitApp,
  navViews,
  collapsibleViews,
  isCollapsed,
  setIsCollapsed,
  pairingSurfaceProps,
  isAgentSessionPeekOpen,
  selectedInterAgent,
  visibleAgentSession,
  agentSessionPending,
  agentSessionLoading,
  agentSessionFeedback,
  agentSessionCopied,
  agentSessionPeekViewportRef,
  handlePeekAgentSessionScroll,
  closeAgentSessionPeek,
  handleCopyAgentSessionCommand,
  handleOpenAgentSession,
  renderLocalPathValue,
  isCreateAgentDialogOpen,
  setIsCreateAgentDialogOpen,
  agentableProjects,
  createAgentDraft,
  setCreateAgentDraft,
  createAgentDefaults,
  createAgentSubmitting,
  createAgentFeedback,
  setCreateAgentFeedback,
  handleBrowseCreateAgentProject,
  handleCreateAgent,
  availableAgentHarnesses,
  isFeedbackDialogOpen,
  handleFeedbackDialogOpenChange,
  feedbackDraft,
  setFeedbackDraft,
  feedbackSubmission,
  feedbackActionPending,
  feedbackBundleLoading,
  feedbackBundle,
  feedbackBundleError,
  feedbackActionMessage,
  handleSubmitFeedbackReport,
  handleRefreshFeedbackBundle,
  handleRepairSetup,
  handleCopyFeedbackBundle,
  openFeedbackDialog,
  openKnowledgeBase,
  logsAttentionLevel,
  logsButtonTitle,
  footerTimeLabel,
}: DesktopAppShellViewProps) {
  return (
    <div
      className={`flex flex-col h-screen w-full font-sans overflow-hidden${dark ? ' dark' : ''}`}
      style={s.root}
    >
      <div className="scout-window-bar h-12 border-b flex items-center px-3 shrink-0 z-10 gap-3" style={s.topBar}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="w-5 h-5 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--os-hover)]"
            style={{ WebkitAppRegion: 'no-drag', color: colors.muted } as React.CSSProperties}
            onClick={handleQuitApp}
            aria-label="Quit"
            title="Quit"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1l-6 6" /></svg>
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
                      ? { backgroundColor: colors.surface, borderColor: colors.border, color: colors.ink, boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }
                      : { backgroundColor: colors.bg, borderColor: colors.border, color: colors.muted }}
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
              style={{ borderColor: colors.border }}
              title={relayStatusTitle}
            >
              Relay
              {relayRuntimeBooting ? (
                <Spinner
                  className="text-[11px]"
                  style={{ color: colors.muted }}
                  aria-label="Syncing relay status"
                />
              ) : (
                <>
                  <div className={`w-1.5 h-1.5 rounded-full ${relayStatusDotClassName}`} />
                  <span className="font-medium" style={s.inkText}>{relayStatusLabel}</span>
                </>
              )}
            </button>
            <div className="flex items-center gap-1.5">
              Agents <span className="font-medium" style={s.inkText}>{headerAgentCount}</span>
            </div>
          </div>
          <div className="flex items-center gap-2" style={s.mutedText}>
            <button
              onClick={() => setDark((current) => !current)}
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
                {collapsibleViews.has(activeView) ? (
                  <button
                    onClick={() => setIsCollapsed((current) => !current)}
                    className="p-1.5 rounded flex items-center justify-center transition-opacity hover:opacity-70"
                    style={s.mutedText}
                    title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
                  >
                    {isCollapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
                  </button>
                ) : null}
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

            {children}
          </div>

          <AgentSessionPeekDialog
            open={isAgentSessionPeekOpen}
            selectedInterAgent={selectedInterAgent}
            visibleAgentSession={visibleAgentSession}
            agentSessionPending={agentSessionPending}
            agentSessionLoading={agentSessionLoading}
            agentSessionFeedback={agentSessionFeedback}
            agentSessionCopied={agentSessionCopied}
            agentSessionPeekViewportRef={agentSessionPeekViewportRef}
            handlePeekAgentSessionScroll={handlePeekAgentSessionScroll}
            handleCopyAgentSessionCommand={handleCopyAgentSessionCommand}
            handleOpenAgentSession={handleOpenAgentSession}
            closeAgentSessionPeek={closeAgentSessionPeek}
            renderLocalPathValue={renderLocalPathValue}
            s={s}
          />
        </>
      ) : (
        <PairingSurfacePlaceholder {...pairingSurfaceProps} />
      )}

      <CreateAgentDialog
        open={isCreateAgentDialogOpen}
        setOpen={setIsCreateAgentDialogOpen}
        agentableProjects={agentableProjects}
        createAgentDraft={createAgentDraft}
        setCreateAgentDraft={setCreateAgentDraft}
        createAgentDefaults={createAgentDefaults}
        createAgentSubmitting={createAgentSubmitting}
        createAgentFeedback={createAgentFeedback}
        setCreateAgentFeedback={setCreateAgentFeedback}
        handleBrowseCreateAgentProject={handleBrowseCreateAgentProject}
        handleCreateAgent={handleCreateAgent}
        availableAgentHarnesses={availableAgentHarnesses}
        s={s}
      />

      <FeedbackDialog
        open={isFeedbackDialogOpen}
        handleFeedbackDialogOpenChange={handleFeedbackDialogOpenChange}
        feedbackDraft={feedbackDraft}
        setFeedbackDraft={setFeedbackDraft}
        feedbackSubmission={feedbackSubmission}
        feedbackActionPending={feedbackActionPending}
        feedbackBundleLoading={feedbackBundleLoading}
        feedbackBundle={feedbackBundle}
        feedbackBundleError={feedbackBundleError}
        feedbackActionMessage={feedbackActionMessage}
        handleSubmitFeedbackReport={handleSubmitFeedbackReport}
        handleRefreshFeedbackBundle={handleRefreshFeedbackBundle}
        handleRepairSetup={handleRepairSetup}
        handleCopyFeedbackBundle={handleCopyFeedbackBundle}
        s={s}
      />

      <div className="h-6 border-t flex items-center justify-between px-3 shrink-0 text-[9px] font-mono uppercase tracking-widest" style={{ backgroundColor: colors.bg, borderTopColor: colors.border, color: colors.muted }}>
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
          <span className="w-px h-3" style={{ backgroundColor: colors.border }} />
          <span style={s.inkText}>{footerTimeLabel}</span>
        </div>
      </div>
    </div>
  );
}
