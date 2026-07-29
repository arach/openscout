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
import { ChevronDown, FileText, Loader2, Search, X } from "lucide-react";
import {
  MessageComposer,
  RuntimePicker,
} from "../../components/MessageComposer/index.ts";
import { api } from "../../lib/api.ts";
import {
  createClientMessageId,
  stageAcceptedConversationTurn,
} from "../../lib/client-turn-transition.ts";
import type { ContextCaptureDraft } from "../../lib/context-capture-draft.ts";
import { useFocusTrap } from "../../lib/keyboard-nav.ts";
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
  startProjectSession,
  type CaptureDeliveryMode,
  type ProjectLaunchTarget,
} from "../../lib/session-start.ts";
import type { Agent, AgentConfigurationState, Route } from "../../lib/types.ts";
import "./agents-rail.css";

type Navigate = (route: Route) => void;
type SubmitPhase = "idle" | "uploading" | "starting";

type RunnerHarnessOption = {
  id: string;
  label: string;
  description: string | null;
  state: string | null;
  ready: boolean | null;
  detail: string | null;
};

type RunnerModelOption = {
  id: string;
  label: string;
  harnesses: string[];
  source: string;
};

type RunnerEffortOption = {
  id: string;
  label: string;
  description: string;
  harnesses: string[];
};

type RunnerOptionsState = {
  defaults: {
    harness: string;
    model: string | null;
    reasoningEffort: string;
  };
  harnesses: RunnerHarnessOption[];
  models: RunnerModelOption[];
  efforts: RunnerEffortOption[];
};

const FALLBACK_HARNESSES: RunnerHarnessOption[] = [
  { id: "claude", label: "Claude Code", description: null, state: null, ready: null, detail: null },
  { id: "codex", label: "Codex", description: null, state: null, ready: null, detail: null },
];

const FALLBACK_EFFORTS: RunnerEffortOption[] = [
  { id: "low", label: "Low", description: "Quick pass", harnesses: ["claude", "codex"] },
  { id: "medium", label: "Medium", description: "Balanced default", harnesses: ["claude", "codex"] },
  { id: "high", label: "High", description: "Deeper pass", harnesses: ["claude", "codex"] },
  { id: "xhigh", label: "XHigh", description: "Highest supported", harnesses: ["claude", "codex"] },
];

/** Rows the standing project list keeps on screen; the rest live behind the foot. */
const PROJECT_STANDING_ROWS = 5;

function firstModelForHarness(options: RunnerOptionsState, harness: string): string {
  const configuredDefault = options.defaults.harness === harness
    ? options.defaults.model?.trim() ?? ""
    : "";
  if (configuredDefault && options.models.some((candidate) => (
    candidate.id === configuredDefault && candidate.harnesses.includes(harness)
  ))) {
    return configuredDefault;
  }
  return options.models.find((candidate) => candidate.harnesses.includes(harness))?.id ?? "";
}

function firstEffortForHarness(options: RunnerOptionsState, harness: string): string {
  const supported = options.efforts.filter((candidate) => candidate.harnesses.includes(harness));
  return supported.find((candidate) => candidate.id === options.defaults.reasoningEffort)?.id
    ?? supported.find((candidate) => candidate.id === "medium")?.id
    ?? supported[0]?.id
    ?? "";
}

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

/**
 * Route a capture or start a fresh conversation. Pick the agent, choose
 * existing chat vs new session when available, attach screenshots/videos, and
 * land in the message tab with the broker delivery already sent.
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
  const [runnerOptions, setRunnerOptions] = useState<RunnerOptionsState | null>(null);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [runnerLoadError, setRunnerLoadError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState(() => initialProjectPath || preferredProjectRoot || "");
  // A filter, not the selected value — empty means "show the standing list".
  // Deliberately NOT seeded from the draft: the draft preserves the selection
  // (`projectPath`), and restoring filter text would narrow the standing list to
  // whatever was last typed. Worse, the draft is rewritten on mount, so a stale
  // title would keep re-persisting itself and never clear.
  const [projectQuery, setProjectQuery] = useState("");
  const [activeProjectIndex, setActiveProjectIndex] = useState(0);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectReminder, setProjectReminder] = useState<string | null>(null);
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
  const [harness, setHarness] = useState(() => routeAgent?.harness?.trim() || "claude");
  const [model, setModel] = useState(() => routeAgent?.model?.trim() || "");
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [preservationNotice, setPreservationNotice] = useState<string | null>(
    () => draftRestored ? "Restored your unsent draft." : null,
  );
  const [dragDepth, setDragDepth] = useState(0);
  const { ref, onKeyDown } = useFocusTrap<HTMLDivElement>(true);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const projectSelectionTouchedRef = useRef(Boolean(initialProjectPath));
  const runtimeSelectionTouchedRef = useRef(false);

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
  const harnesses = runnerOptions?.harnesses ?? FALLBACK_HARNESSES;
  const models = runnerOptions?.models.filter((candidate) => candidate.harnesses.includes(harness)) ?? [];
  const efforts = (runnerOptions?.efforts ?? FALLBACK_EFFORTS)
    .filter((candidate) => candidate.harnesses.includes(harness));
  const selectedHarness = harnesses.find((candidate) => candidate.id === harness) ?? null;
  const runnerLoading = !runnerOptions && !runnerLoadError;
  // RuntimePicker takes flat id lists and prepends its own "Default" entry, so
  // the harness reads as its mark rather than a repeated word. A current value
  // the catalog doesn't know (route agent pinned to something unlisted) is
  // appended so selecting it stays possible instead of silently resetting.
  const harnessOptions = [
    // Unready harnesses stay listed but unselectable — the old select disabled
    // them, and dropping that would let the operator pick a dead runtime.
    ...harnesses.map((candidate) => ({
      value: candidate.id,
      label: candidate.label,
      disabled: candidate.ready === false,
    })),
    ...(harness && !harnesses.some((candidate) => candidate.id === harness)
      ? [{ value: harness, label: harness }]
      : []),
  ];
  const modelOptions = [
    ...models.map((candidate) => ({ value: candidate.id, label: candidate.label })),
    ...(model && !models.some((candidate) => candidate.id === model)
      ? [{ value: model, label: model }]
      : []),
  ];
  const effortOptions = [
    ...efforts.map((candidate) => ({ value: candidate.id, label: candidate.label })),
    ...(reasoningEffort && !efforts.some((candidate) => candidate.id === reasoningEffort)
      ? [{ value: reasoningEffort, label: reasoningEffort }]
      : []),
  ];
  // Uncapped: only PROJECT_STANDING_ROWS are ever rendered, and the foot needs a
  // truthful match count to report what it is holding back.
  const filteredProjects = useMemo(
    () => searchProjectLaunchTargets(projectTargets, projectQuery),
    [projectQuery, projectTargets],
  );
  // The list stands in normal flow rather than opening over the panel, so typing
  // replaces these rows in place — nothing moves, nothing opens.
  const visibleProjects = useMemo(() => {
    const rows = filteredProjects.slice(0, PROJECT_STANDING_ROWS);
    if (!projectPath || rows.some((candidate) => candidate.root === projectPath)) return rows;
    // An active row you cannot see is worse than one fewer alternative.
    const selected = filteredProjects.find((candidate) => candidate.root === projectPath);
    return selected ? [selected, ...rows.slice(0, PROJECT_STANDING_ROWS - 1)] : rows;
  }, [filteredProjects, projectPath]);
  const directPathCandidate = isDirectProjectPath(projectQuery)
    && !projectTargets.some((candidate) => candidate.root === projectQuery.trim())
    ? projectQuery.trim()
    : null;
  const projectOptionCount = visibleProjects.length + (directPathCandidate ? 1 : 0);
  // Count the real inventory when unfiltered; the match set once the user types.
  const projectsHeldBack = Math.max(
    0,
    (projectQuery.trim() ? filteredProjects.length : projectTargets.length) - visibleProjects.length,
  );
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
  const usesNewWorker = !hasAttachments || !canUseExistingChat || mode === "new-session";
  const runtimeBlocked = usesNewWorker && (runnerLoading || selectedHarness?.ready === false);
  const title = hasAttachments ? "Route capture" : "New task";
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
  const showDeliveryMode = hasAttachments && canUseExistingChat;
  const showRuntimeStatus = usesNewWorker
    && (runnerLoading || Boolean(runnerLoadError) || selectedHarness?.ready === false);
  const showConfig = showDeliveryMode || showRuntimeStatus;

  const requestClose = useCallback(() => {
    if (isStarting) return;
    onClose();
  }, [isStarting, onClose]);

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
    let cancelled = false;
    void api<RunnerOptionsState>("/api/runner/options")
      .then((snapshot) => {
        if (cancelled) return;
        setRunnerOptions(snapshot);
        setRunnerLoadError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setRunnerLoadError("Model catalog unavailable. Harness defaults are still available.");
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
    // Selection only. Typing the resolved project's title into the filter would
    // open the dialog with the standing list already narrowed to one row — the
    // choice was made for the operator, so it should be shown as the active row,
    // not as a search term they have to clear.
    setProjectPath(initial.root);
  }, [configuration?.context.currentDirectory, preferredProjectRoot, projectTargets]);

  useEffect(() => {
    if (runtimeSelectionTouchedRef.current) return;
    const nextHarness = selectedProject?.defaultHarness?.trim()
      || routeAgent?.harness?.trim()
      || runnerOptions?.defaults.harness
      || "claude";
    setHarness(nextHarness);
    if (!runnerOptions) return;
    const routeModel = routeAgent?.model?.trim() ?? "";
    const routeModelSupported = runnerOptions.models.some((candidate) => (
      candidate.id === routeModel && candidate.harnesses.includes(nextHarness)
    ));
    setModel(routeModelSupported ? routeModel : firstModelForHarness(runnerOptions, nextHarness));
    setReasoningEffort(firstEffortForHarness(runnerOptions, nextHarness));
  }, [routeAgent?.harness, routeAgent?.model, runnerOptions, selectedProject?.defaultHarness, selectedProject?.root]);

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
      // The filter, not the selection. `projectPath` already carries which project
      // is chosen; storing the title here used to be how the field remembered its
      // value, and restoring it now would pre-filter the standing list down to the
      // single row the operator had already picked.
      projectQuery,
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
      setError("Scout could not read that file. Try dropping or pasting it again.");
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

  // The input is a FILTER, not a value holder — the selection shows as the active
  // row plus the path line, so committing clears the filter and the standing list
  // returns to the full set with the new choice marked.
  const selectProject = (project: ProjectLaunchTarget) => {
    projectSelectionTouchedRef.current = true;
    setProjectPath(project.root);
    setProjectQuery("");
    setActiveProjectIndex(0);
    setProjectPickerOpen(false);
    setProjectReminder(null);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const selectDirectPath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    projectSelectionTouchedRef.current = true;
    setProjectPath(trimmed);
    setProjectQuery("");
    setActiveProjectIndex(0);
    setProjectPickerOpen(false);
    setProjectReminder(null);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const clearProject = () => {
    projectSelectionTouchedRef.current = true;
    setProjectPath("");
    setProjectQuery("");
    setActiveProjectIndex(0);
    setProjectPickerOpen(false);
    setProjectReminder(null);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const handleProjectKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveProjectIndex((current) => {
        if (projectOptionCount === 0) return 0;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (current + delta + projectOptionCount) % projectOptionCount;
      });
      return;
    }
    // The listbox is always visible, so Enter always commits the active row.
    if (event.key === "Enter") {
      event.preventDefault();
      const project = visibleProjects[activeProjectIndex];
      if (project) selectProject(project);
      else if (directPathCandidate && activeProjectIndex === visibleProjects.length) {
        selectDirectPath(directPathCandidate);
      }
      return;
    }
    // Escape clears a filter in progress before it closes the dialog; with no
    // filter to clear it falls through to the panel's own Esc handler.
    if (event.key === "Escape" && projectPickerOpen && projectQuery) {
      event.preventDefault();
      event.stopPropagation();
      setProjectQuery("");
      setActiveProjectIndex(0);
    }
  };

  const selectHarness = (nextHarness: string) => {
    runtimeSelectionTouchedRef.current = true;
    setHarness(nextHarness);
    if (!runnerOptions) {
      setModel("");
      return;
    }
    const currentModelSupported = runnerOptions.models.some((candidate) => (
      candidate.id === model && candidate.harnesses.includes(nextHarness)
    ));
    if (!currentModelSupported) {
      setModel(firstModelForHarness(runnerOptions, nextHarness));
    }
    const currentEffortSupported = runnerOptions.efforts.some((candidate) => (
      candidate.id === reasoningEffort && candidate.harnesses.includes(nextHarness)
    ));
    if (!currentEffortSupported) {
      setReasoningEffort(firstEffortForHarness(runnerOptions, nextHarness));
    }
  };

  const insertSlashCommand = useCallback(() => {
    if (isStarting) return;
    setMessage((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}/`);
    requestAnimationFrame(() => textRef.current?.focus());
  }, [isStarting]);

  const start = async () => {
    if (isStarting) return;
    if (!selectedProject) {
      setError(null);
      setProjectReminder("Choose a project before starting this task.");
      setProjectPickerOpen(true);
      requestAnimationFrame(() => projectInputRef.current?.focus());
      return;
    }
    if (runtimeBlocked) return;
    setState("starting");
    setPhase(files.length > 0 ? "uploading" : "starting");
    setError(null);
    const clientMessageId = createClientMessageId();
    const submittedAt = Date.now();
    try {
      let attachments: OutgoingAttachment[] = [];
      if (files.length > 0) {
        attachments = await uploadMediaFiles(files);
        setPhase("starting");
      }

      if (hasAttachments && routeAgent && canUseExistingChat && mode === "existing-chat") {
        const resolvedMode = mode === "existing-chat" && canUseExistingChat
          ? "existing-chat"
          : "new-session";
        const result = await routeCaptureToAgent(routeAgent, {
          mode: resolvedMode,
          message: committedMessage,
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

      const result = await startProjectSession({
        projectPath: selectedProject.root,
        harness,
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(committedMessage
          ? { instructions: committedMessage }
          : hasAttachments
            ? { instructions: "Shared capture for context." }
            : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        clientMessageId,
      });
      const conversationId = result.conversationId?.trim();
      if (!conversationId) {
        throw new Error("Message sent, but no Chat was returned.");
      }
      const messageId = result.messageId?.trim();
      if (messageId) {
        stageAcceptedConversationTurn({
          conversationId,
          messageId,
          clientMessageId,
          body: committedMessage || (attachments.length > 0 ? "Shared capture for context." : "New session started."),
          attachments,
          agentId: result.agentId,
          flightId: result.flightId,
          invocationId: result.invocationId,
          createdAt: submittedAt,
        });
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
          <span className="s-newchat-title">{title}</span>
          <div className="s-newchat-head-status">
            <span role="status" aria-live="polite">{preservationNotice}</span>
          </div>
          <button
            type="button"
            className="s-newchat-close"
            onClick={requestClose}
            disabled={isStarting}
            aria-label="Close (Esc)"
            title="Close (Esc)"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        {isDraggingFiles ? (
          <div className="s-newchat-drop-prompt" role="status" aria-live="polite">
            Drop to attach markdown, code, images, or video
          </div>
        ) : null}

        <div className="s-newchat-body">
          <div className="s-newchat-lead">
            <div className="s-newchat-project-bar">
              <span className="label-md s-newchat-project-label">Project</span>
              <button
                type="button"
                className="s-newchat-project-summary"
                data-empty={selectedProject ? undefined : "true"}
                aria-expanded={projectPickerOpen}
                aria-controls="s-newchat-project-panel"
                aria-describedby={projectReminder ? "s-newchat-project-reminder" : undefined}
                disabled={isStarting}
                onClick={() => {
                  const nextOpen = !projectPickerOpen;
                  setProjectPickerOpen(nextOpen);
                  if (nextOpen) requestAnimationFrame(() => projectInputRef.current?.focus());
                  else requestAnimationFrame(() => textRef.current?.focus());
                }}
              >
                <span className="s-newchat-project-summary-title">
                  {selectedProject ? `/${selectedProject.title}` : "Choose a project"}
                </span>
                {selectedProject ? (
                  <span className="s-newchat-project-summary-path" title={selectedProject.root}>
                    {shortProjectPath(selectedProject.root)}
                  </span>
                ) : (
                  <span className="s-newchat-project-summary-path">Required when you send</span>
                )}
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            </div>

            {projectReminder ? (
              <p id="s-newchat-project-reminder" className="s-newchat-project-reminder" role="alert">
                {projectReminder}
              </p>
            ) : null}

            {projectPickerOpen ? (
              <div id="s-newchat-project-panel" className="s-newchat-project-panel">
                <div className="s-newchat-project-picker">
                  <Search size={13} aria-hidden="true" className="s-newchat-project-search-icon" />
                  <input
                    ref={projectInputRef}
                    id="s-newchat-project-search"
                    className="s-newchat-project-search"
                    type="search"
                    role="combobox"
                    aria-label="Filter projects or enter a project path"
                    aria-autocomplete="list"
                    aria-expanded="true"
                    aria-controls="s-newchat-project-results"
                    aria-activedescendant={projectOptionCount > 0
                      ? `s-newchat-project-option-${activeProjectIndex}`
                      : undefined}
                    value={projectQuery}
                    placeholder={configuration ? "Filter projects, or type a path…" : "Loading projects…"}
                    disabled={isStarting}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => {
                      setProjectQuery(event.currentTarget.value);
                      setActiveProjectIndex(0);
                    }}
                    onKeyDown={handleProjectKeyDown}
                  />
                </div>

                <div
                  id="s-newchat-project-results"
                  className="s-newchat-project-results"
                  role="listbox"
                  aria-label="Projects"
                >
                  {visibleProjects.map((project, index) => (
                    <div
                      key={project.root}
                      id={`s-newchat-project-option-${index}`}
                      role="option"
                      aria-selected={project.root === projectPath}
                      aria-disabled={isStarting || undefined}
                      className="s-newchat-project-option"
                      data-active={index === activeProjectIndex || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveProjectIndex(index)}
                      onClick={() => {
                        if (isStarting) return;
                        selectProject(project);
                      }}
                    >
                      <span className="s-newchat-project-option-title">/{project.title}</span>
                      <span className="s-newchat-project-option-path">{shortProjectPath(project.root)}</span>
                    </div>
                  ))}
                  {directPathCandidate ? (
                    <div
                      id={`s-newchat-project-option-${visibleProjects.length}`}
                      role="option"
                      aria-selected={directPathCandidate === projectPath}
                      aria-disabled={isStarting || undefined}
                      className="s-newchat-project-option s-newchat-project-option--path"
                      data-active={activeProjectIndex === visibleProjects.length || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveProjectIndex(visibleProjects.length)}
                      onClick={() => {
                        if (isStarting) return;
                        selectDirectPath(directPathCandidate);
                      }}
                    >
                      <span className="s-newchat-project-option-title">Use this project path</span>
                      <span className="s-newchat-project-option-path">{shortProjectPath(directPathCandidate)}</span>
                    </div>
                  ) : null}
                  {visibleProjects.length === 0 && !directPathCandidate ? (
                    <p className="s-newchat-project-empty">
                      No project matched. Type an absolute path such as ~/dev/my-project.
                    </p>
                  ) : null}
                </div>

                <div className="s-newchat-project-panel-foot">
                  {projectsHeldBack > 0 ? (
                    <p className="s-newchat-project-foot">
                      {visibleProjects.length} of{" "}
                      {projectQuery.trim() ? filteredProjects.length : projectTargets.length}
                      {projectQuery.trim() ? " matches" : " projects"} · type to narrow
                    </p>
                  ) : <span />}
                  {selectedProject ? (
                    <button type="button" className="s-newchat-project-clear" onClick={clearProject}>
                      Clear project
                    </button>
                  ) : null}
                </div>

                {projectLoadError && projectTargets.length === 0 ? (
                  <div className="s-newchat-error" role="alert">{projectLoadError}</div>
                ) : null}
              </div>
            ) : null}

            <MessageComposer
              density="panel"
              value={message}
              onChange={setMessage}
              onSend={() => void start()}
              sendOnEnter
              textareaRef={textRef}
              placeholder={hasAttachments
                ? "What should the agent do with this?"
                : "Describe the task, or leave blank…"}
              disabled={isStarting}
              sending={isStarting}
              canSend={!isStarting && !runtimeBlocked}
              showDictation={false}
              rows={7}
              maxHeightPx={280}
              sendTitle={hasAttachments ? "Route (Enter)" : "Start task (Enter)"}
              sendAriaLabel={hasAttachments ? "Route capture" : "Start task"}
              leadingTools={(
                <button
                  type="button"
                  className="s-newchat-command-trigger"
                  disabled={isStarting}
                  onClick={insertSlashCommand}
                >
                  / Commands
                </button>
              )}
              tools={(
                <RuntimePicker
                  harness={harness}
                  model={model}
                  effort={reasoningEffort}
                  onHarnessChange={selectHarness}
                  onModelChange={(nextModel) => {
                    runtimeSelectionTouchedRef.current = true;
                    setModel(nextModel);
                  }}
                  onEffortChange={(nextEffort) => {
                    runtimeSelectionTouchedRef.current = true;
                    setReasoningEffort(nextEffort);
                  }}
                  harnessOptions={harnessOptions}
                  modelOptions={modelOptions}
                  effortOptions={effortOptions}
                  showEffort
                  disabled={isStarting || runnerLoading || !usesNewWorker}
                />
              )}
            />

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
                  <span className="label-md s-newchat-progress-title">{phaseLabel}</span>
                  <span className="s-newchat-progress-detail">{progressDetail}</span>
                  {committedMessage && (
                    <span className="s-newchat-progress-message">{committedMessage}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {showConfig ? (
            <div className="s-newchat-config">
              {showDeliveryMode ? (
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

              {usesNewWorker && runnerLoading ? (
                <p className="s-newchat-runtime-note" data-pending="true" role="status">
                  <Loader2 size={11} className="s-newchat-runtime-note-spinner" aria-hidden="true" />
                  Loading the model catalog…
                </p>
              ) : usesNewWorker && (runnerLoadError || selectedHarness?.ready === false) ? (
                <p className="s-newchat-runtime-note" role="alert">
                  {selectedHarness?.ready === false
                    ? (selectedHarness.detail || `${selectedHarness.label} is unavailable.`)
                    : runnerLoadError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
