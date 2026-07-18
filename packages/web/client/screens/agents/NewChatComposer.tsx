import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFocusTrap } from "../../lib/keyboard-nav.ts";
import {
  isRoutableMediaFile,
  uploadMediaFiles,
  type OutgoingAttachment,
} from "../../lib/media-blobs.ts";
import { resolveCaptureRouteContext } from "../../lib/media-route.ts";
import {
  composeCaptureMessage,
  type CaptureContextItem,
} from "../../lib/context-capture-message.ts";
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
  const [url, setUrl] = useState(() => previewUrl(file));
  useEffect(() => {
    const next = previewUrl(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const isVideo = file.type.startsWith("video/");
  return (
    <div className="s-newchat-attachment">
      {isVideo ? (
        <video src={url} muted playsInline />
      ) : (
        <img src={url} alt={file.name} />
      )}
      <span className="s-newchat-attachment-badge">{isVideo ? "video" : "image"}</span>
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
  defaultMode,
  contextItems = [],
  embedded = false,
}: {
  agents: Agent[];
  navigate: Navigate;
  onClose: () => void;
  route: Route;
  initialAgentId?: string;
  initialConversationId?: string;
  initialMessage?: string;
  initialFiles?: File[];
  defaultMode?: CaptureDeliveryMode;
  contextItems?: CaptureContextItem[];
  embedded?: boolean;
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
  const { ref, onKeyDown } = useFocusTrap<HTMLDivElement>(true);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agent = sorted.find((candidate) => candidate.id === agentId) ?? null;
  const hasAttachments = files.length > 0;
  const isStarting = state === "starting";
  const canUseExistingChat = Boolean(agent?.conversationId || initialConversationId || routeContext.conversationId);
  const title = hasAttachments ? "Route capture" : "New chat";
  const committedMessage = composeCaptureMessage(message, contextItems);
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
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded, requestClose]);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const addFiles = (incoming: File[]) => {
    const next = incoming.filter(isRoutableMediaFile);
    if (next.length === 0) return;
    setFiles((current) => [...current, ...next]);
  };

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
          view: "agents",
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

  const panel = (
    <div
        ref={ref}
        className={`s-newchat-panel${embedded ? " s-newchat-panel--embedded" : ""}${isStarting ? " s-newchat-panel--starting" : ""}`}
        role="dialog"
        aria-modal={embedded ? undefined : true}
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <header className="s-newchat-head">
          <span className="s-newchat-title">{title}</span>
          {!embedded ? (
            <button
              type="button"
              className="s-newchat-close"
              onClick={requestClose}
              disabled={isStarting}
              aria-label="Close (Esc)"
            >
              ✕
            </button>
          ) : null}
        </header>

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

          {contextItems.length > 0 ? (
            <div className="s-newchat-context" aria-label="Attached context">
              <span className="s-newchat-field-label">Context</span>
              <div className="s-newchat-context-list">
                {contextItems.map((item, index) => (
                  <div className="s-newchat-context-item" key={`${item.label}:${index}`}>
                    <span>{item.label}</span>
                    <p>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
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
            accept="image/*,video/*"
            multiple
            hidden
            disabled={isStarting}
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="s-newchat-attach-btn"
            disabled={isStarting}
            onClick={() => fileInputRef.current?.click()}
          >
            Attach image or video
          </button>

          <textarea
            ref={textRef}
            className="s-newchat-well"
            placeholder={hasAttachments ? "What should the agent do with this?" : "First message…"}
            value={message}
            disabled={isStarting}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void start();
              }
            }}
          />

          {error && <div className="s-newchat-error">{error}</div>}
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

          <div className="s-newchat-foot">
            <span className="s-newchat-hint">
              {hasAttachments ? "⌘↵ to route" : "⌘↵ to start chat"} · paste or drop captures anywhere
            </span>
            <button
              type="button"
              className="s-newchat-start"
              disabled={!agent || isStarting}
              onClick={() => void start()}
            >
              {isStarting ? (
                <>
                  <Loader2 size={14} className="s-newchat-start-spinner" aria-hidden="true" />
                  {phase === "uploading" ? "Uploading..." : hasAttachments ? "Routing..." : "Sending..."}
                </>
              ) : hasAttachments ? (
                "Route"
              ) : (
                "Start chat"
              )}
            </button>
          </div>
        </div>
    </div>
  );

  if (embedded) return <div className="s-newchat-embed">{panel}</div>;
  return (
    <div className="s-newchat-backdrop" onClick={requestClose} role="presentation">
      {panel}
    </div>
  );
}
