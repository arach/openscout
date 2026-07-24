import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowUpRight,
  FileText,
  Loader2,
  MessageSquareText,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  MessageComposer,
  type MessageComposerDictationStatus,
} from "../../components/MessageComposer/index.ts";
import { api } from "../../lib/api.ts";
import {
  dictationBlocksContextCaptureClose,
  type ContextCaptureDraft,
} from "../../lib/context-capture-draft.ts";
import { useFocusTrap } from "../../lib/keyboard-nav.ts";
import { routeMachineId, routePath } from "../../lib/router.ts";
import {
  dataTransferMayContainFiles,
  isRoutableMediaFile,
  readTransferredFiles,
  uploadMediaFiles,
  type OutgoingAttachment,
} from "../../lib/media-blobs.ts";
import { resolveCaptureRouteContext } from "../../lib/media-route.ts";
import {
  buildProjectLaunchTargets,
  chooseInitialProjectLaunchTarget,
  routeCaptureToAgent,
  searchProjectLaunchTargets,
  startAgentSession,
  startProjectSession,
  type CaptureDeliveryMode,
  type ProjectLaunchTarget,
} from "../../lib/session-start.ts";
import type { Agent, AgentConfigurationState, Route } from "../../lib/types.ts";
import "./agents-rail.css";

type Navigate = (route: Route) => void;
type SubmitPhase = "idle" | "uploading" | "starting";

type ComposerContextItem = {
  label: string;
  value: string;
};

function previewUrl(file: File): string {
  return URL.createObjectURL(file);
}

function shortProjectPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/u, "~");
}

function projectTitleFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function isDirectProjectPath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("/") || trimmed.startsWith("~/");
}

function AttachmentPreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const url = useMemo(() => previewUrl(file), [file]);
  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  return (
    <div className="s-newchat-attachment">
      {isVideo ? (
        <video src={url} muted playsInline />
      ) : isImage ? (
        <img src={url} alt={file.name} />
      ) : (
        <div className="s-newchat-attachment-file" title={file.name}>
          <FileText size={24} aria-hidden="true" />
          <span>{file.name}</span>
        </div>
      )}
      <span className="s-newchat-attachment-badge">
        {isVideo ? "video" : isImage ? "image" : "file"}
      </span>
      <button
        type="button"
        className="s-newchat-attachment-remove"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}

function formatContextBody(message: string, context: ComposerContextItem[]): string {
  const parts: string[] = [];
  for (const item of context) {
    if (!item.value.trim()) continue;
    if (item.label === "Page" || item.label === "URL") {
      parts.push(`${item.label}: ${item.value.trim()}`);
    } else {
      parts.push(
        `${item.label}:\n${item.value
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}`,
      );
    }
  }
  const trimmedMessage = message.trim();
  if (trimmedMessage) {
    parts.push(trimmedMessage);
  }
  return parts.join("\n\n");
}

/**
 * Route a capture or start a fresh conversation. Pick the agent, choose
 * existing chat vs new session when available, attach screenshots/videos, and
 * land in the message tab with the broker delivery already sent.
 *
 * The layout mirrors the Studio Scout drawer: a context sidebar (page, URL,
 * selection, notes) beside the shared MessageComposer. Context is folded into
 * the outgoing message body so routing/session semantics stay unchanged.
 */
export function NewChatComposer({
  agents,
  route,
  navigate,
  onClose,
  initialAgentId,
  initialConversationId,
  initialMessage,
  initialFiles,
  initialAttachmentFeedback,
  initialProjectPath,
  initialProjectQuery,
  defaultMode,
  draftRestored = false,
  onDraftChange,
  onDraftConsumed,
}: {
  agents: Agent[];
  navigate: Navigate;
  onClose: () => void;
  route: Route;
  initialAgentId?: string;
  initialConversationId?: string;
  initialMessage?: string;
  initialFiles?: File[];
  initialAttachmentFeedback?: string;
  initialProjectPath?: string;
  initialProjectQuery?: string;
  defaultMode?: CaptureDeliveryMode;
  draftRestored?: boolean;
  onDraftChange?: (draft: ContextCaptureDraft) => void;
  onDraftConsumed?: () => void;
}) {
  const routeContext = useMemo(() => resolveCaptureRouteContext(route, agents), [route, agents]);
  const sorted = useMemo(
    () => [...agents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [agents],
  );
  const routeAgentId = initialAgentId ?? routeContext.agentId ?? null;
  const routeAgent = sorted.find((candidate) => candidate.id === routeAgentId) ?? null;
  const preferredProjectRoot = routeAgent?.projectRoot ?? routeAgent?.cwd ?? null;
  const [configuration, setConfiguration] = useState<AgentConfigurationState | null>(null);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState(() => initialProjectPath || preferredProjectRoot || "");
  const [projectQuery, setProjectQuery] = useState(() => initialProjectQuery || routeAgent?.project || "");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [activeProjectIndex, setActiveProjectIndex] = useState(0);
  const [message, setMessage] = useState(() => initialMessage ?? "");
  const [files, setFiles] = useState<File[]>(() => [...(initialFiles ?? [])]);
  const [mode, setMode] = useState<CaptureDeliveryMode>(() => {
    if (defaultMode) return defaultMode;
    if (initialConversationId || routeContext.canUseExistingChat) return "existing-chat";
    return "new-session";
  });
  const [state, setState] = useState<"idle" | "starting">("idle");
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attachmentFeedback, setAttachmentFeedback] = useState<string | null>(
    () => initialAttachmentFeedback ?? null,
  );
  const [dictationStatus, setDictationStatus] = useState<MessageComposerDictationStatus | null>(null);
  const [preservationNotice, setPreservationNotice] = useState<string | null>(
    () => draftRestored ? "Restored your unsent draft." : null,
  );
  const [dragDepth, setDragDepth] = useState(0);
  const { ref, onKeyDown } = useFocusTrap<HTMLDivElement>(true);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const projectSelectionTouchedRef = useRef(Boolean(initialProjectPath));

  // Studio-style context stays additive to project-based routing: the
  // selected page, browser selection, and operator notes are folded into the
  // first message without changing the broker's launch semantics.
  const [selection, setSelection] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [pageTitle] = useState(() =>
    typeof document !== "undefined" ? document.title || "OpenScout" : "OpenScout"
  );
  const [pageUrl, setPageUrl] = useState(() =>
    typeof window !== "undefined" ? window.location.href : ""
  );
  const [appliedContext, setAppliedContext] = useState<ComposerContextItem[]>([]);

  useEffect(() => {
    const rememberSelection = () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      const next = window.getSelection()?.toString().trim() ?? "";
      if (next) setSelection(next.slice(0, 1_200));
    };
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, []);

  const draftContext = useMemo<ComposerContextItem[]>(() => {
    const items: ComposerContextItem[] = [
      { label: "Page", value: pageTitle },
      { label: "URL", value: pageUrl },
    ];
    if (selection) items.push({ label: "Selection", value: selection });
    notes.forEach((note, index) => items.push({ label: `Note ${index + 1}`, value: note }));
    return items.filter((item) => item.value);
  }, [notes, pageTitle, pageUrl, selection]);

  const contextChanged = JSON.stringify(draftContext) !== JSON.stringify(appliedContext);

  useEffect(() => {
    setAppliedContext(draftContext);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPopState = () => setPageUrl(window.location.href);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const applyContextUpdate = useCallback(() => {
    setAppliedContext(draftContext);
  }, [draftContext]);

  const projectTargets = useMemo(
    () => buildProjectLaunchTargets(
      configuration?.projects ?? [],
      agents,
      configuration?.context.defaultHarness ?? "claude",
    ),
    [agents, configuration],
  );
  const knownSelectedProject = projectTargets.find((candidate) => candidate.root === projectPath) ?? null;
  const selectedProject: ProjectLaunchTarget | null = knownSelectedProject ?? (projectPath
    ? {
        id: `direct:${projectPath}`,
        title: projectTitleFromPath(projectPath),
        root: projectPath,
        defaultHarness: configuration?.context.defaultHarness ?? routeAgent?.harness ?? "claude",
        source: "agent",
        registrationKind: null,
      }
    : null);
  const filteredProjects = useMemo(
    () => searchProjectLaunchTargets(projectTargets, projectQuery).slice(0, 40),
    [projectQuery, projectTargets],
  );
  const directPathCandidate = isDirectProjectPath(projectQuery)
    && !projectTargets.some((candidate) => candidate.root === projectQuery.trim())
    ? projectQuery.trim()
    : null;
  const projectOptionCount = filteredProjects.length + (directPathCandidate ? 1 : 0);
  const projectMatchesRouteAgent = Boolean(
    routeAgent
    && selectedProject
    && [routeAgent.projectRoot, routeAgent.cwd].some((root) => root?.trim() === selectedProject.root),
  );
  const hasAttachments = files.length > 0;
  const isStarting = state === "starting";
  const isDraggingFiles = dragDepth > 0;
  const canUseExistingChat = projectMatchesRouteAgent
    && Boolean(routeAgent?.conversationId || initialConversationId || routeContext.conversationId);
  const machineId = routeMachineId(route);
  const agentConversationRoute: Route | null = routeAgent?.conversationId
    ? {
        view: "conversation",
        conversationId: routeAgent.conversationId,
        ...(machineId ? { machineId } : {}),
      }
    : null;
  const title = hasAttachments ? "Route capture" : "New message";
  const committedMessage = message.trim();
  const phaseLabel = phase === "uploading"
    ? "Uploading capture"
    : hasAttachments
      ? "Routing capture"
      : "Sending message";
  const progressDetail = hasAttachments
    ? `Submitted to ${selectedProject?.title ?? routeAgent?.name ?? "Scout"}. Opening the chat when the broker returns it.`
    : committedMessage
      ? `Routing your first message through /${selectedProject?.title ?? routeAgent?.name ?? "project"}.`
      : `Starting a project-routed chat in /${selectedProject?.title ?? routeAgent?.name ?? "project"}.`;
  const dictationCloseReason = dictationBlocksContextCaptureClose(dictationStatus?.state)
    ? dictationStatus?.state === "recording"
      ? "Voice is recording. Stop the mic before closing."
      : "Finishing your transcript. This draft will stay open until it lands."
    : null;

  const requestClose = useCallback(() => {
    if (isStarting) return;
    if (dictationBlocksContextCaptureClose(dictationStatus?.state)) return;
    onClose();
  }, [dictationStatus?.state, isStarting, onClose]);

  const retainOnBackdropClick = useCallback(() => {
    setPreservationNotice("Draft kept open. Use Esc or × when you are ready to close it.");
    requestAnimationFrame(() => textRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  useEffect(() => {
    if (!preservationNotice) return;
    const timeout = window.setTimeout(() => setPreservationNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [preservationNotice]);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api<AgentConfigurationState>("/api/agent-config/snapshot")
      .then((snapshot) => {
        if (cancelled) return;
        setConfiguration(snapshot);
        setProjectLoadError(null);
      })
      .catch((caught) => {
        if (cancelled) return;
        setProjectLoadError(caught instanceof Error ? caught.message : "Could not load projects.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (projectSelectionTouchedRef.current || projectTargets.length === 0) return;
    const initial = chooseInitialProjectLaunchTarget(projectTargets, {
      preferredRoot: preferredProjectRoot,
      currentDirectory: configuration?.context.currentDirectory,
    });
    if (!initial) return;
    setProjectPath(initial.root);
    setProjectQuery(initial.title);
  }, [configuration?.context.currentDirectory, preferredProjectRoot, projectTargets]);

  useEffect(() => {
    if (projectPickerOpen || !selectedProject) return;
    setProjectQuery(selectedProject.title);
  }, [projectPickerOpen, selectedProject]);

  useLayoutEffect(() => {
    onDraftChange?.({
      ...(routeAgentId ? { agentId: routeAgentId } : {}),
      ...(initialConversationId ?? routeContext.conversationId
        ? { conversationId: initialConversationId ?? routeContext.conversationId ?? undefined }
        : {}),
      message,
      files,
      attachmentFeedback,
      mode,
      projectPath,
      projectQuery: selectedProject?.title ?? projectQuery,
    });
  }, [
    attachmentFeedback,
    files,
    initialConversationId,
    message,
    mode,
    onDraftChange,
    projectPath,
    projectQuery,
    routeAgentId,
    routeContext.conversationId,
    selectedProject?.title,
  ]);

  const addFiles = useCallback((incoming: File[], action = "Added") => {
    if (isStarting) return;
    const accepted = incoming.filter(isRoutableMediaFile);
    const rejected = incoming.filter((file) => !isRoutableMediaFile(file));

    if (accepted.length > 0) {
      setFiles((current) => [...current, ...accepted]);
      setAttachmentFeedback(
        accepted.length === 1
          ? `${action} ${accepted[0]?.name ?? "1 attachment"}.`
          : `${action} ${accepted.length} attachments.`,
      );
    }

    if (rejected.length > 0) {
      const rejectedLabel = rejected.length === 1
        ? rejected[0]?.name ?? "That file"
        : `${rejected.length} files`;
      setError(
        `${rejectedLabel} ${rejected.length === 1 ? "is" : "are"} not supported. Attach markdown, code, an image, or a video clip.`,
      );
    } else if (accepted.length > 0) {
      setError(null);
    }
  }, [isStarting]);

  const acceptTransfer = useCallback((dataTransfer: DataTransfer, action: string) => {
    const incoming = readTransferredFiles(dataTransfer);
    if (incoming.length === 0) {
      setError("Scout could not read that file. Try the attachment picker instead.");
      return;
    }
    addFiles(incoming, action);
  }, [addFiles]);

  const handleDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (isStarting || !dataTransferMayContainFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDragDepth(dragDepthRef.current);
  }, [isStarting]);

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (isStarting || !dataTransferMayContainFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, [isStarting]);

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    setDragDepth(dragDepthRef.current);
  }, []);

  const handleDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!dataTransferMayContainFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragDepth(0);
    acceptTransfer(event.dataTransfer, "Added");
  }, [acceptTransfer]);

  const handlePaste = useCallback((event: ReactClipboardEvent<HTMLElement>) => {
    if (isStarting || !dataTransferMayContainFiles(event.clipboardData)) return;
    event.preventDefault();
    event.stopPropagation();
    acceptTransfer(event.clipboardData, "Pasted");
  }, [acceptTransfer, isStarting]);

  const selectProject = (project: ProjectLaunchTarget) => {
    projectSelectionTouchedRef.current = true;
    setProjectPath(project.root);
    setProjectQuery(project.title);
    setProjectPickerOpen(false);
    setActiveProjectIndex(0);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const selectDirectPath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    projectSelectionTouchedRef.current = true;
    setProjectPath(trimmed);
    setProjectQuery(projectTitleFromPath(trimmed));
    setProjectPickerOpen(false);
    setActiveProjectIndex(0);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const handleProjectKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setProjectPickerOpen(true);
      setActiveProjectIndex((current) => {
        if (projectOptionCount === 0) return 0;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (current + delta + projectOptionCount) % projectOptionCount;
      });
      return;
    }
    if (event.key === "Enter" && projectPickerOpen) {
      event.preventDefault();
      const project = filteredProjects[activeProjectIndex];
      if (project) selectProject(project);
      else if (directPathCandidate && activeProjectIndex === filteredProjects.length) {
        selectDirectPath(directPathCandidate);
      }
      return;
    }
    if (event.key === "Escape" && projectPickerOpen) {
      event.preventDefault();
      event.stopPropagation();
      setProjectPickerOpen(false);
      if (selectedProject) setProjectQuery(selectedProject.title);
    }
  };

  function addNote() {
    const note = noteDraft.trim();
    if (!note || notes.length >= 8) return;
    setNotes((current) => [...current, note.slice(0, 2_000)]);
    setNoteDraft("");
  }

  const start = async () => {
    if ((!selectedProject && !routeAgent) || isStarting) return;
    setState("starting");
    setPhase(files.length > 0 ? "uploading" : "starting");
    setError(null);
    try {
      let attachments: OutgoingAttachment[] = [];
      if (files.length > 0) {
        attachments = await uploadMediaFiles(files);
        setPhase("starting");
      }

      const body = formatContextBody(message, appliedContext);

      if (hasAttachments && routeAgent && canUseExistingChat && mode === "existing-chat") {
        const resolvedMode = mode === "existing-chat" && canUseExistingChat
          ? "existing-chat"
          : "new-session";
        const result = await routeCaptureToAgent(routeAgent, {
          mode: resolvedMode,
          message: body,
          attachments,
        });
        navigate({
          view: "agents-v2",
          agentId: result.agentId,
          conversationId: result.conversationId,
          tab: "message",
        });
        onDraftConsumed?.();
        onClose();
        return;
      }

      const result = selectedProject
        ? await startProjectSession({
            projectPath: selectedProject.root,
            harness: selectedProject.defaultHarness,
            ...(body
              ? { instructions: body }
              : hasAttachments
                ? { instructions: "Shared capture for context." }
                : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
          })
        : await startAgentSession(
            routeAgent!,
            body || attachments.length > 0
              ? {
                  ...(body ? { instructions: body } : {}),
                  ...(attachments.length > 0 ? { attachments } : {}),
                }
              : undefined,
          );
      const conversationId = result.conversationId?.trim();
      if (!conversationId) {
        throw new Error("Message sent, but no Chat was returned.");
      }
      navigate({
        view: "conversation",
        conversationId,
      });
      onDraftConsumed?.();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : hasAttachments
            ? "Could not route capture."
            : "Could not send message.",
      );
      setState("idle");
      setPhase("idle");
    }
  };

  return (
    <div
      className="s-newchat-backdrop"
      onClick={retainOnBackdropClick}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      role="presentation"
    >
      <div
        ref={ref}
        className={`s-newchat-panel${isStarting ? " s-newchat-panel--starting" : ""}${isDraggingFiles ? " s-newchat-panel--dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <header className="s-newchat-head">
          <div className="s-newchat-head-ident">
            <MessageSquareText size={15} aria-hidden="true" />
            <div>
              <span className="s-newchat-title">{title}</span>
              <span className="s-newchat-subtitle">
                {selectedProject ? `/${selectedProject.title}` : routeAgent?.name ?? "Pick a project"}
              </span>
            </div>
          </div>
          <div className="s-newchat-head-status">
            <span role="status" aria-live="polite">
              {dictationCloseReason ? "" : preservationNotice}
            </span>
            <span role="alert">{dictationCloseReason}</span>
          </div>
          <div className="s-newchat-head-actions">
            {agentConversationRoute ? (
              <a
                href={routePath(agentConversationRoute)}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(agentConversationRoute);
                  onClose();
                }}
                className="s-newchat-head-link"
                aria-label="Open agent chat"
              >
                <ArrowUpRight size={14} />
              </a>
            ) : null}
            <button
              type="button"
              className="s-newchat-close"
              onClick={requestClose}
              disabled={isStarting}
              aria-disabled={Boolean(dictationCloseReason) || undefined}
              aria-label={dictationCloseReason ?? "Close (Esc)"}
              title={dictationCloseReason ?? "Close (Esc)"}
            >
              <X size={15} />
            </button>
          </div>
        </header>

        {isDraggingFiles ? (
          <div className="s-newchat-drop-prompt" role="status" aria-live="polite">
            Drop to attach markdown, code, images, or video
          </div>
        ) : null}

        <div className="s-newchat-body">
          <section className="s-newchat-routing">
            <div className="s-newchat-field">
            <label className="s-newchat-field-label" htmlFor="s-newchat-project-search">Project</label>
            <div className="s-newchat-project-picker">
              <Search size={13} aria-hidden="true" className="s-newchat-project-search-icon" />
              <input
                ref={projectInputRef}
                id="s-newchat-project-search"
                className="s-newchat-project-search"
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={projectPickerOpen}
                aria-controls="s-newchat-project-results"
                aria-activedescendant={projectPickerOpen && projectOptionCount > 0
                  ? `s-newchat-project-option-${activeProjectIndex}`
                  : undefined}
                value={projectQuery}
                placeholder={configuration ? "Search projects or enter a path…" : "Loading projects…"}
                disabled={isStarting}
                spellCheck={false}
                autoComplete="off"
                onFocus={() => {
                  setProjectPickerOpen(true);
                  setProjectQuery("");
                  setActiveProjectIndex(0);
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setProjectPickerOpen(false);
                    if (selectedProject) setProjectQuery(selectedProject.title);
                  }, 120);
                }}
                onChange={(event) => {
                  setProjectQuery(event.currentTarget.value);
                  setProjectPickerOpen(true);
                  setActiveProjectIndex(0);
                }}
                onKeyDown={handleProjectKeyDown}
              />
              {projectPickerOpen ? (
                <div id="s-newchat-project-results" className="s-newchat-project-results" role="listbox">
                  {filteredProjects.map((project, index) => (
                    <button
                      key={project.root}
                      id={`s-newchat-project-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={project.root === projectPath}
                      className="s-newchat-project-option"
                      data-active={index === activeProjectIndex || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveProjectIndex(index)}
                      onClick={() => selectProject(project)}
                    >
                      <span className="s-newchat-project-option-title">/{project.title}</span>
                      <span className="s-newchat-project-option-path">{shortProjectPath(project.root)}</span>
                    </button>
                  ))}
                  {directPathCandidate ? (
                    <button
                      id={`s-newchat-project-option-${filteredProjects.length}`}
                      type="button"
                      role="option"
                      aria-selected={directPathCandidate === projectPath}
                      className="s-newchat-project-option s-newchat-project-option--path"
                      data-active={activeProjectIndex === filteredProjects.length || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveProjectIndex(filteredProjects.length)}
                      onClick={() => selectDirectPath(directPathCandidate)}
                    >
                      <span className="s-newchat-project-option-title">Use this project path</span>
                      <span className="s-newchat-project-option-path">{shortProjectPath(directPathCandidate)}</span>
                    </button>
                  ) : null}
                  {filteredProjects.length === 0 && !directPathCandidate ? (
                    <div className="s-newchat-project-empty">
                      No project matched. Enter an absolute path such as ~/dev/my-project.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {selectedProject && (
            <div className="s-newchat-target">
              <span className="s-newchat-chip">/{selectedProject.title}</span>
              <span className="s-newchat-chip" title={selectedProject.root}>{shortProjectPath(selectedProject.root)}</span>
              <span className="s-newchat-chip">{selectedProject.defaultHarness}</span>
              <span className="s-newchat-chip">new worker</span>
            </div>
          )}

          </section>

          {/* Studio-style attached context */}
          <section className="s-newchat-context">
            <div className="s-newchat-context-eyebrow">Attached context</div>
            <div className="s-newchat-context-list">
              {draftContext.map((item, index) => {
                const noteIndex = item.label.startsWith("Note ")
                  ? Number.parseInt(item.label.slice(5), 10) - 1
                  : -1;
                return (
                  <div key={`${item.label}:${index}`} className="s-newchat-context-card">
                    <div className="s-newchat-context-card-head">
                      <span>{item.label}</span>
                      {item.label === "Selection" || noteIndex >= 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (item.label === "Selection") setSelection("");
                            else setNotes((current) => current.filter((_, candidate) => candidate !== noteIndex));
                          }}
                          aria-label={item.label === "Selection" ? "Remove selected text" : `Remove ${item.label.toLowerCase()}`}
                        >
                          <Trash2 size={11} />
                        </button>
                      ) : null}
                    </div>
                    <p>{item.value}</p>
                  </div>
                );
              })}
            </div>

            <div className="s-newchat-context-note">
              <label htmlFor="newchat-context-note">
                <Quote size={10} aria-hidden="true" /> Add a note
              </label>
              <textarea
                id="newchat-context-note"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    addNote();
                  }
                }}
                rows={3}
                maxLength={2_000}
                placeholder="Decision, constraint, or question…"
                disabled={isStarting}
              />
              <button
                type="button"
                onClick={addNote}
                disabled={!noteDraft.trim() || notes.length >= 8 || isStarting}
              >
                <Plus size={10} aria-hidden="true" /> Add note
              </button>
            </div>

            {contextChanged ? (
              <button
                type="button"
                onClick={applyContextUpdate}
                className="s-newchat-context-update"
                disabled={isStarting}
              >
                <RefreshCw size={10} aria-hidden="true" /> Update context
              </button>
            ) : null}
          </section>

          {/* Composer */}
          <section className="s-newchat-composer">
            {projectLoadError && projectTargets.length === 0 ? (
              <div className="s-newchat-error" role="alert">{projectLoadError}</div>
            ) : null}

            {hasAttachments && canUseExistingChat ? (
              <div className="s-newchat-mode" role="group" aria-label="Delivery mode">
                <button
                  type="button"
                  className={`s-newchat-mode-btn${mode === "existing-chat" ? " s-newchat-mode-btn--on" : ""}`}
                  disabled={isStarting}
                  onClick={() => setMode("existing-chat")}
                >
                  Existing chat
                </button>
                <button
                  type="button"
                  className={`s-newchat-mode-btn${mode === "new-session" ? " s-newchat-mode-btn--on" : ""}`}
                  disabled={isStarting}
                  onClick={() => setMode("new-session")}
                >
                  New chat
                </button>
              </div>
            ) : null}

            {files.length > 0 ? (
              <div className="s-newchat-attachments" aria-label="Attached captures">
                {files.map((file, index) => (
                  <AttachmentPreview
                    key={`${file.name}:${file.size}:${index}`}
                    file={file}
                    onRemove={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  />
                ))}
              </div>
            ) : null}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              disabled={isStarting}
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            {attachmentFeedback ? (
              <div className="s-newchat-attachment-feedback" role="status" aria-live="polite">
                {attachmentFeedback}
              </div>
            ) : null}

            {error && <div className="s-newchat-error" role="alert">{error}</div>}
            {isStarting && (
              <div className="s-newchat-progress" role="status" aria-live="polite">
                <Loader2 size={14} className="s-newchat-progress-spinner" aria-hidden="true" />
                <div className="s-newchat-progress-copy">
                  <span className="s-newchat-progress-title">{phaseLabel}</span>
                  <span className="s-newchat-progress-detail">{progressDetail}</span>
                  {committedMessage && (
                    <span className="s-newchat-progress-message">{committedMessage}</span>
                  )}
                </div>
              </div>
            )}

            <MessageComposer
              density="panel"
              value={message}
              onChange={setMessage}
              onSend={() => void start()}
              textareaRef={textRef}
              placeholder={hasAttachments ? "What should the agent do with this?" : "First message…"}
              disabled={isStarting || (!selectedProject && !routeAgent)}
              sending={isStarting}
              canSend={Boolean(selectedProject || routeAgent) && !isStarting}
              onDictationStatusChange={setDictationStatus}
              showAttach
              onAttach={() => fileInputRef.current?.click()}
              attachTitle="Attach file — or paste / drop"
              attachAriaLabel="Attach file"
              sendTitle={hasAttachments ? "Route (Cmd+Enter)" : "Start chat (Cmd+Enter)"}
              sendAriaLabel={hasAttachments ? "Route capture" : "Start chat"}
              tools={(
                <span className="s-msg-compose-tools-hint" aria-hidden="true">⌘↵</span>
              )}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
