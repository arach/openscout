import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { FileText, Loader2 } from "lucide-react";
import { MessageComposer } from "../../components/MessageComposer/index.ts";
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
  routeCaptureToAgent,
  startAgentSession,
  type CaptureDeliveryMode,
} from "../../lib/session-start.ts";
import type { Agent, Route } from "../../lib/types.ts";
import "./agents-rail.css";

type Navigate = (route: Route) => void;
type SubmitPhase = "idle" | "uploading" | "starting";

function previewUrl(file: File): string {
  return URL.createObjectURL(file);
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
  defaultMode,
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
  defaultMode?: CaptureDeliveryMode;
}) {
  const routeContext = useMemo(() => resolveCaptureRouteContext(route, agents), [route, agents]);
  const sorted = useMemo(
    () => [...agents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [agents],
  );
  const [agentId, setAgentId] = useState(
    () => initialAgentId ?? routeContext.agentId ?? sorted[0]?.id ?? "",
  );
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
  const [dragDepth, setDragDepth] = useState(0);
  const { ref, onKeyDown } = useFocusTrap<HTMLDivElement>(true);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const agent = sorted.find((candidate) => candidate.id === agentId) ?? null;
  const hasAttachments = files.length > 0;
  const isStarting = state === "starting";
  const isDraggingFiles = dragDepth > 0;
  const canUseExistingChat = Boolean(agent?.conversationId || initialConversationId || routeContext.conversationId);
  const title = hasAttachments ? "Route capture" : "New chat";
  const committedMessage = message.trim();
  const phaseLabel = phase === "uploading"
    ? "Uploading capture"
    : hasAttachments
      ? "Routing capture"
      : "Sending message";
  const progressDetail = hasAttachments
    ? "Submitted. Opening the chat when the broker returns it."
    : committedMessage
      ? "Submitting your first message to Scout."
      : "Starting a new chat with Scout.";

  const requestClose = useCallback(() => {
    if (isStarting) return;
    onClose();
  }, [isStarting, onClose]);

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
    textRef.current?.focus();
  }, []);

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

  const start = async () => {
    if (!agent || isStarting) return;
    setState("starting");
    setPhase(files.length > 0 ? "uploading" : "starting");
    setError(null);
    try {
      let attachments: OutgoingAttachment[] = [];
      if (files.length > 0) {
        attachments = await uploadMediaFiles(files);
        setPhase("starting");
      }

      if (hasAttachments) {
        const resolvedMode = mode === "existing-chat" && canUseExistingChat
          ? "existing-chat"
          : "new-session";
        const result = await routeCaptureToAgent(agent, {
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
        onClose();
        return;
      }

      const result = await startAgentSession(agent, committedMessage ? { instructions: committedMessage } : undefined);
      const conversationId = result.conversationId?.trim();
      if (!conversationId) {
        throw new Error("Message sent, but no Chat was returned.");
      }
      navigate({
        view: "conversation",
        conversationId,
      });
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
      onClick={requestClose}
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
          <button
            type="button"
            className="s-newchat-close"
            onClick={requestClose}
            disabled={isStarting}
            aria-label="Close (Esc)"
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
          <label className="s-newchat-field">
            <span className="s-newchat-field-label">Agent</span>
            <select
              className="s-newchat-select"
              value={agentId}
              disabled={isStarting}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {sorted.length === 0 ? (
                <option value="">No agents available</option>
              ) : (
                sorted.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                    {candidate.project ? ` · ${candidate.project}` : ""}
                  </option>
                ))
              )}
            </select>
          </label>

          {agent && (
            <div className="s-newchat-target">
              {agent.project && <span className="s-newchat-chip">{agent.project}</span>}
              {agent.harness && <span className="s-newchat-chip">{agent.harness}</span>}
              {agent.model && <span className="s-newchat-chip">{agent.model}</span>}
            </div>
          )}

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
            disabled={isStarting || !agent}
            sending={isStarting}
            canSend={Boolean(agent) && !isStarting}
            showAttach
            onAttach={() => fileInputRef.current?.click()}
            attachTitle="Attach file"
            attachAriaLabel="Attach file"
            sendTitle={hasAttachments ? "Route (Cmd+Enter)" : "Start chat (Cmd+Enter)"}
            sendAriaLabel={hasAttachments ? "Route capture" : "Start chat"}
            tools={(
              <span className="s-newchat-hint">
                {isStarting
                  ? phase === "uploading"
                    ? "Uploading…"
                    : hasAttachments
                      ? "Routing…"
                      : "Sending…"
                  : hasAttachments
                    ? "⌘↵ to route · paste or drop captures"
                    : "⌘↵ to start · paste or drop captures"}
              </span>
            )}
          />
        </div>
      </div>
    </div>
  );
}
