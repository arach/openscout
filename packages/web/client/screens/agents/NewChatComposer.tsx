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
import { ChevronDown, FileText, Loader2, Search } from "lucide-react";
import {
  MessageComposer,
  type MessageComposerDictationStatus,
} from "../../components/MessageComposer/index.ts";
import { api } from "../../lib/api.ts";
import {
  createClientMessageId,
  stageAcceptedConversationTurn,
} from "../../lib/client-turn-transition.ts";
import {
  dictationBlocksContextCaptureClose,
  type ContextCaptureDraft,
} from "../../lib/context-capture-draft.ts";
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
  startAgentSession,
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

type RuntimeSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
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

function RuntimeSelect({
  label,
  value,
  displayValue,
  options,
  disabled,
  onChange,
  wide = false,
}: {
  label: string;
  value: string;
  displayValue: string;
  options: RuntimeSelectOption[];
  disabled: boolean;
  onChange: (value: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={`s-newchat-runtime-field${wide ? " s-newchat-runtime-field--wide" : ""}`}>
      <span className="s-newchat-runtime-field-label">{label}</span>
      <span className="s-newchat-runtime-control">
        <span className="s-newchat-runtime-value">{displayValue}</span>
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={option.value || "__default__"} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" />
      </span>
    </label>
  );
}

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
  const [runnerOptions, setRunnerOptions] = useState<RunnerOptionsState | null>(null);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [runnerLoadError, setRunnerLoadError] = useState<string | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const harnessSelectOptions: RuntimeSelectOption[] = [
    ...harnesses.map((candidate) => ({
      value: candidate.id,
      label: candidate.ready === false ? `${candidate.label} — unavailable` : candidate.label,
      disabled: candidate.ready === false,
    })),
    ...(!harnesses.some((candidate) => candidate.id === harness) && harness
      ? [{ value: harness, label: harness }]
      : []),
  ];
  const modelSelectOptions: RuntimeSelectOption[] = [
    { value: "", label: "Harness default" },
    ...models.map((candidate) => ({
      value: candidate.id,
      label: candidate.label === candidate.id
        ? candidate.label
        : `${candidate.label} · ${candidate.id}`,
    })),
    ...(!models.some((candidate) => candidate.id === model) && model
      ? [{ value: model, label: model }]
      : []),
  ];
  const effortSelectOptions: RuntimeSelectOption[] = [
    ...(!efforts.some((candidate) => candidate.id === reasoningEffort) && reasoningEffort
      ? [{ value: reasoningEffort, label: reasoningEffort }]
      : []),
    ...efforts.map((candidate) => ({
      value: candidate.id,
      label: `${candidate.label} — ${candidate.description}`,
    })),
  ];
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
    setProjectPath(initial.root);
    setProjectQuery(initial.title);
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

  const start = async () => {
    if ((!selectedProject && !routeAgent) || isStarting || runtimeBlocked) return;
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

      const result = selectedProject
        ? await startProjectSession({
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
          })
        : await startAgentSession(
            routeAgent!,
            committedMessage || attachments.length > 0
              ? {
                  ...(committedMessage ? { instructions: committedMessage } : {}),
                  ...(attachments.length > 0 ? { attachments } : {}),
                  clientMessageId,
                }
              : undefined,
          );
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
            <span role="status" aria-live="polite">
              {dictationCloseReason ? "" : preservationNotice}
            </span>
            <span role="alert">{dictationCloseReason}</span>
          </div>
          <button
            type="button"
            className="s-newchat-close"
            onClick={requestClose}
            disabled={isStarting}
            aria-disabled={Boolean(dictationCloseReason) || undefined}
            aria-label={dictationCloseReason ?? "Close (Esc)"}
            title={dictationCloseReason ?? "Close (Esc)"}
          >
            ✕
          </button>
        </header>

        {isDraggingFiles ? (
          <div className="s-newchat-drop-prompt" role="status" aria-live="polite">
            Drop to attach markdown, code, images, or video
          </div>
        ) : null}

        <div className="s-newchat-body">
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
              <span className="s-newchat-chip">new worker</span>
            </div>
          )}

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

          {usesNewWorker ? (
            <section className="s-newchat-runtime" aria-labelledby="s-newchat-runtime-title">
              <div className="s-newchat-runtime-head">
                <div>
                  <h3 id="s-newchat-runtime-title">Run with</h3>
                  <p>Choose the harness, model, and thinking depth for this worker.</p>
                </div>
                {runnerLoading ? (
                  <span className="s-newchat-runtime-readiness" data-loading="true">
                    <Loader2 size={11} aria-hidden="true" />
                    Loading models
                  </span>
                ) : selectedHarness?.ready !== null && selectedHarness?.ready !== undefined ? (
                  <span
                    className="s-newchat-runtime-readiness"
                    data-ready={selectedHarness.ready ? "true" : "false"}
                  >
                    <span aria-hidden="true" />
                    {selectedHarness.ready ? "Ready" : "Unavailable"}
                  </span>
                ) : null}
              </div>
              <div className="s-newchat-runtime-grid">
                <RuntimeSelect
                  label="Harness"
                  value={harness}
                  displayValue={selectedHarness?.label ?? harness}
                  options={harnessSelectOptions}
                  disabled={isStarting || runnerLoading}
                  onChange={selectHarness}
                />
                <RuntimeSelect
                  label="Model"
                  value={model}
                  displayValue={runnerLoading
                    ? "Loading models…"
                    : (models.find((candidate) => candidate.id === model)?.label ?? model) || "Harness default"}
                  options={modelSelectOptions}
                  disabled={isStarting || runnerLoading}
                  wide
                  onChange={(nextModel) => {
                    runtimeSelectionTouchedRef.current = true;
                    setModel(nextModel);
                  }}
                />
                <RuntimeSelect
                  label="Effort"
                  value={reasoningEffort}
                  displayValue={(efforts.find((candidate) => candidate.id === reasoningEffort)?.label ?? reasoningEffort) || "Harness default"}
                  options={effortSelectOptions}
                  disabled={isStarting || runnerLoading || effortSelectOptions.length === 0}
                  onChange={(nextEffort) => {
                    runtimeSelectionTouchedRef.current = true;
                    setReasoningEffort(nextEffort);
                  }}
                />
              </div>
              {selectedHarness?.detail || runnerLoadError ? (
                <p
                  className="s-newchat-runtime-note"
                  data-warning={selectedHarness?.ready === false || Boolean(runnerLoadError) || undefined}
                  role={selectedHarness?.ready === false ? "alert" : undefined}
                >
                  {selectedHarness?.detail || runnerLoadError}
                </p>
              ) : null}
            </section>
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
            sendOnEnter
            textareaRef={textRef}
            placeholder={hasAttachments ? "What should the agent do with this?" : "Describe the task…"}
            disabled={isStarting || (!selectedProject && !routeAgent)}
            sending={isStarting}
            canSend={Boolean(selectedProject || routeAgent) && !isStarting && !runtimeBlocked}
            onDictationStatusChange={setDictationStatus}
            showAttach
            onAttach={() => fileInputRef.current?.click()}
            attachTitle="Attach file — or paste / drop"
            attachAriaLabel="Attach file"
            sendTitle={hasAttachments ? "Route (Enter)" : "Start task (Enter)"}
            sendAriaLabel={hasAttachments ? "Route capture" : "Start task"}
            tools={(
              <span className="s-msg-compose-tools-hint" aria-hidden="true">↵ send · ⇧↵ line</span>
            )}
          />
        </div>
      </div>
    </div>
  );
}
