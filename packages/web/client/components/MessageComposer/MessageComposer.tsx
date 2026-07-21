import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { isComposerSendShortcut } from "../../lib/compose-shortcuts.ts";
import { DictationMic, type MicStatus } from "../DictationMic.tsx";
import { VoiceWaveform } from "./VoiceWaveform.tsx";
import "./message-composer.css";

export type MessageComposerDensity = "panel" | "thread" | "compact" | "bare";

export type MessageComposerChangeMeta = {
  caret: number;
};

export type MessageComposerProps = {
  value: string;
  onChange: (value: string, meta?: MessageComposerChangeMeta) => void;
  onSend: () => void;
  placeholder?: string;
  /** Disables the textarea and actions. */
  disabled?: boolean;
  /** True while a send is in flight (disables Send). */
  sending?: boolean;
  /** Override Send enablement (defaults to non-empty trimmed value). */
  canSend?: boolean;
  /**
   * Agent-stop mode: the primary action becomes Stop agent (not mic stop).
   * Dictation still uses its own mic control.
   */
  stopMode?: boolean;
  onStop?: () => void;
  /** Standardized Send labels — prefer leaving defaults. */
  sendTitle?: string;
  sendAriaLabel?: string;
  stopAriaLabel?: string;
  showDictation?: boolean;
  /** Left toolbar: paperclip / add attachment. */
  showAttach?: boolean;
  onAttach?: () => void;
  attachTitle?: string;
  attachAriaLabel?: string;
  /**
   * Toolbar tools on the right, before mic/Send (model picker, harness, etc.).
   * Attach stays on the left.
   */
  tools?: ReactNode;
  /** Alias for tools — older call sites used `footer` for selects. */
  footer?: ReactNode;
  /** Top decoration: reply annotation, target chip, etc. */
  header?: ReactNode;
  /**
   * Replace the default textarea (e.g. AgentMentionTextarea). Parent still
   * owns `value` / `onChange` for Send enablement; this only swaps the field.
   */
  input?: ReactNode;
  /** Absolute overlay inside the shell (slash / mention menus). */
  overlay?: ReactNode;
  /** Send receipt or other feedback rendered below the toolbar. */
  status?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Extra key handling after the built-in send shortcut. Return true to stop. */
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean | void;
  onSelect?: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  density?: MessageComposerDensity;
  /** Use `div` when nested inside an outer form. */
  as?: "form" | "div";
  className?: string;
  rows?: number;
  autoResize?: boolean;
  maxHeightPx?: number;
  "aria-label"?: string;
};

/**
 * Standardized Send glyph — upright arrow.
 * Use this anywhere a composer primary Send appears (not a paper plane).
 */
export function MessageComposerSendIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function AgentStopIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.44 11.05 12.05 20.44a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48" />
    </svg>
  );
}

function resizeTextarea(el: HTMLTextAreaElement, maxHeightPx: number) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`;
}

function voiceLabel(status: MicStatus): string {
  if (status.tone === "error") return "Voice";
  if (status.state === "recording") return "Listening";
  if (status.state === "processing") return "Transcribing";
  if (status.state === "starting") return "Starting";
  return "Voice";
}

/**
 * Classic message composer — sandwich layout.
 *
 * 1. Header — reply / annotation decoration (optional)
 * 2. Body — message input; live dictation partials appear here
 * 3. Toolbar — attach (left) · tools/model · mic · Send (right)
 *
 * Mic only starts/stops recording. Final transcript lands in the draft so
 * the operator can edit, then hit Send — or hit Send anytime the draft is
 * ready. Send never stops the mic; the mic never sends.
 */
export function MessageComposer({
  value,
  onChange,
  onSend,
  placeholder = "Type a message…",
  disabled = false,
  sending = false,
  canSend,
  stopMode = false,
  onStop,
  sendTitle = "Send (Cmd+Enter)",
  sendAriaLabel = "Send message (Cmd+Enter)",
  stopAriaLabel = "Stop agent",
  showDictation = true,
  showAttach = false,
  onAttach,
  attachTitle = "Add attachment",
  attachAriaLabel = "Add attachment",
  tools,
  footer,
  header,
  input,
  overlay,
  status,
  textareaRef,
  onKeyDown,
  onSelect,
  onBlur,
  density = "panel",
  as = "form",
  className,
  rows = 1,
  autoResize = true,
  maxHeightPx = 160,
  "aria-label": ariaLabel = "Message",
}: MessageComposerProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<MicStatus | null>(null);

  const setTextareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      localRef.current = node;
      if (textareaRef) {
        (textareaRef as { current: HTMLTextAreaElement | null }).current = node;
      }
    },
    [textareaRef],
  );

  useEffect(() => {
    if (!autoResize) return;
    const el = localRef.current;
    if (!el) return;
    resizeTextarea(el, maxHeightPx);
  }, [value, autoResize, maxHeightPx]);

  const sendEnabled = (canSend ?? value.trim().length > 0) && !sending && !disabled;
  const toolsSlot = tools ?? footer;
  const recording = voiceStatus?.state === "recording" || voiceStatus?.state === "starting";
  const processing = voiceStatus?.state === "processing";
  const showVoiceLine = Boolean(
    voiceStatus
    && (
      voiceStatus.tone === "error"
      || recording
      || processing
      || (voiceStatus.partial && voiceStatus.partial.trim())
    ),
  );

  const trySend = useCallback(() => {
    // Send always means commit the draft — independent of mic state.
    if (stopMode) return;
    if (!(canSend ?? value.trim().length > 0) || sending || disabled) return;
    onSend();
  }, [canSend, disabled, onSend, sending, stopMode, value]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    trySend();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposerSendShortcut(event)) {
      event.preventDefault();
      trySend();
      return;
    }
    if (onKeyDown?.(event)) {
      event.preventDefault();
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    onChange(next, { caret: event.target.selectionStart ?? next.length });
    if (autoResize) {
      resizeTextarea(event.target, maxHeightPx);
    }
  };

  const handleDictationAppend = (text: string) => {
    // Final transcript lands in the draft so the operator can edit before Send.
    const next = value.trim() ? `${value.trimEnd()} ${text}` : text;
    onChange(next, { caret: next.length });
    // Focus the field after stop so editing is immediate.
    requestAnimationFrame(() => localRef.current?.focus());
  };

  const rootClass = [
    "s-msg-compose",
    `s-msg-compose--${density}`,
    density === "thread" ? "s-thread-compose" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const shellClass = [
    "s-msg-compose-shell",
    density === "thread" ? "s-thread-compose-shell" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inputClass = [
    "s-msg-compose-input",
    density === "thread" ? "s-thread-compose-input" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sendClass = [
    "s-msg-compose-send",
    density === "thread" ? "s-thread-compose-send" : "",
    stopMode ? "s-msg-compose-send--agent-stop s-thread-compose-send--stop" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const voiceClass = [
    "s-msg-compose-voice",
    voiceStatus?.tone === "recording" || recording
      ? "s-msg-compose-voice--recording"
      : "",
    voiceStatus?.tone === "processing" || processing
      ? "s-msg-compose-voice--processing"
      : "",
    voiceStatus?.tone === "error" ? "s-msg-compose-voice--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const isError = voiceStatus?.tone === "error";
  const partialText = voiceStatus?.partial?.trim() || null;
  const statusCopy = isError
    ? voiceStatus?.message
    : processing
      ? "Finalizing transcript…"
      : partialText;

  const content = (
    <div className={shellClass}>
      {overlay}

      {header ? <div className="s-msg-compose-header">{header}</div> : null}

      <div className="s-msg-compose-body">
        {input ?? (
          <textarea
            ref={setTextareaRef}
            className={inputClass}
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            rows={rows}
            aria-label={ariaLabel}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={onSelect}
            onBlur={onBlur}
          />
        )}

        {showVoiceLine ? (
          <div
            className={voiceClass}
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
          >
            {/* Waveform owns the horizontal band while live; toolbar stays free. */}
            {!isError && (recording || processing) ? (
              <VoiceWaveform
                samples={voiceStatus?.levels}
                active={recording}
                processing={processing}
              />
            ) : null}
            <div className="s-msg-compose-voice-meta">
              <span className="s-msg-compose-voice-label">
                {voiceStatus ? voiceLabel(voiceStatus) : "Voice"}
              </span>
              {statusCopy ? (
                <span className="s-msg-compose-voice-text">{statusCopy}</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={[
          "s-msg-compose-toolbar",
          density === "thread" ? "s-thread-compose-footer" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Left: attach only */}
        <div className="s-msg-compose-toolbar-start">
          {showAttach ? (
            <button
              type="button"
              className="s-msg-compose-icon-btn"
              title={attachTitle}
              aria-label={attachAriaLabel}
              disabled={disabled || sending}
              onClick={onAttach}
            >
              <AttachIcon />
            </button>
          ) : (
            <span className="s-msg-compose-toolbar-spacer" aria-hidden="true" />
          )}
        </div>

        {/* Right: model/tools · mic · Send (flush end) */}
        <div className="s-msg-compose-toolbar-end">
          {toolsSlot ? (
            <div className="s-msg-compose-tools">{toolsSlot}</div>
          ) : null}

          {showDictation ? (
            <DictationMic
              onAppend={handleDictationAppend}
              onStatus={setVoiceStatus}
              disabled={disabled || sending}
            />
          ) : null}

          {stopMode ? (
            <button
              type="button"
              className={sendClass}
              onClick={onStop}
              title={stopAriaLabel}
              aria-label={stopAriaLabel}
            >
              <AgentStopIcon />
            </button>
          ) : (
            <button
              type={as === "form" ? "submit" : "button"}
              className={sendClass}
              disabled={!sendEnabled}
              title={sendTitle}
              aria-label={sendAriaLabel}
              data-action="send"
              onClick={as === "div" ? () => trySend() : undefined}
            >
              <MessageComposerSendIcon />
            </button>
          )}
        </div>
      </div>

      {status}
    </div>
  );

  if (as === "div") {
    return <div className={rootClass}>{content}</div>;
  }

  return (
    <form className={rootClass} onSubmit={handleSubmit}>
      {content}
    </form>
  );
}
