import React from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type RelayDestinationKind = "channel" | "filter" | "direct";

type RelayNavItem = {
  kind: RelayDestinationKind;
  id: string;
  title: string;
  subtitle: string;
  count: number;
};

type RelayDirectThread = {
  kind: "direct";
  id: string;
  title: string;
  subtitle: string;
  preview: string | null;
  timestampLabel: string | null;
  state: string;
  reachable: boolean;
};

type RelayVoiceState = {
  captureState: string;
  captureTitle: string;
  repliesEnabled: boolean;
  detail: string | null;
  isCapturing: boolean;
};

type RelayMessage = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string | null;
  body: string;
  timestampLabel: string;
  dayLabel: string;
  normalizedChannel: string | null;
  recipients: string[];
  isDirectConversation: boolean;
  isSystem: boolean;
  isVoice: boolean;
  messageClass: string | null;
  routingSummary: string | null;
  provenanceSummary: string | null;
  provenanceDetail: string | null;
  isOperator: boolean;
  avatarLabel: string;
  avatarColor: string;
};

type RelayState = {
  title: string;
  subtitle: string;
  transportTitle: string;
  meshTitle: string;
  syncLine: string;
  operatorId: string;
  channels: RelayNavItem[];
  views: RelayNavItem[];
  directs: RelayDirectThread[];
  messages: RelayMessage[];
  voice: RelayVoiceState;
  lastUpdatedLabel: string | null;
};

type NativeMessage =
  | { type: "state"; state: RelayState }
  | { type: "actionResult"; requestId: string; ok: boolean; error?: string | null };

type NativeAction =
  | { type: "ready" }
  | { type: "refresh"; requestId: string }
  | { type: "toggleVoiceCapture"; requestId: string }
  | { type: "setVoiceRepliesEnabled"; requestId: string; enabled: boolean }
  | {
      type: "sendMessage";
      requestId: string;
      destinationKind: RelayDestinationKind;
      destinationId: string;
      body: string;
    };

type NativeRequestAction =
  | { type: "refresh" }
  | { type: "toggleVoiceCapture" }
  | { type: "setVoiceRepliesEnabled"; enabled: boolean }
  | {
      type: "sendMessage";
      destinationKind: RelayDestinationKind;
      destinationId: string;
      body: string;
    };

declare global {
  interface Window {
    __scoutRelayReceive?: (message: NativeMessage) => void;
    webkit?: {
      messageHandlers?: {
        scoutRelayBridge?: {
          postMessage: (message: NativeAction) => void;
        };
      };
    };
  }
}

const pendingRequests = new Map<
  string,
  {
    resolve: () => void;
    reject: (error: Error) => void;
  }
>();

function sendNative(action: NativeAction) {
  window.webkit?.messageHandlers?.scoutRelayBridge?.postMessage(action);
}

function requestNative(action: NativeRequestAction) {
  const requestId = crypto.randomUUID();

  return new Promise<void>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    sendNative({ ...action, requestId } as NativeAction);
  });
}

function receiveNative(message: NativeMessage, setState: React.Dispatch<React.SetStateAction<RelayState | null>>) {
  if (message.type === "state") {
    setState(message.state);
    return;
  }

  const pending = pendingRequests.get(message.requestId);
  if (!pending) {
    return;
  }

  pendingRequests.delete(message.requestId);
  if (message.ok) {
    pending.resolve();
  } else {
    pending.reject(new Error(message.error ?? "Action failed."));
  }
}

function App() {
  const [state, setState] = React.useState<RelayState | null>(null);
  const [selectedKind, setSelectedKind] = React.useState<RelayDestinationKind>("channel");
  const [selectedId, setSelectedId] = React.useState("shared");
  const [draft, setDraft] = React.useState("");
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [showAnnotations, setShowAnnotations] = React.useState(false);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    window.__scoutRelayReceive = (message) => receiveNative(message, setState);
    sendNative({ type: "ready" });

    return () => {
      delete window.__scoutRelayReceive;
      pendingRequests.clear();
    };
  }, []);

  React.useEffect(() => {
    if (!state) {
      return;
    }

    const availableViews = ensureOverviewView(state.views, state.messages);
    const selectionStillExists =
      state.channels.some((item) => item.id === selectedId && selectedKind === item.kind) ||
      availableViews.some((item) => item.id === selectedId && selectedKind === item.kind) ||
      state.directs.some((item) => item.id === selectedId && selectedKind === item.kind);

    if (!selectionStillExists) {
      setSelectedKind("channel");
      setSelectedId("shared");
    }
  }, [state, selectedId, selectedKind]);

  React.useLayoutEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }

    const maxHeight = 120;
    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  if (!state) {
    return (
      <div className="empty-state">
        <div className="empty-copy">Waiting for the native shell to attach the Relay workspace.</div>
      </div>
    );
  }

  const activeState = state;
  const viewItems = ensureOverviewView(activeState.views, activeState.messages);

  const currentDestination = resolveDestination(activeState, viewItems, selectedKind, selectedId);
  const visibleMessages = filterMessages(activeState.messages, selectedKind, selectedId);
  const threadTitle = currentDestination?.title ?? "# shared-channel";
  const threadSubtitle = currentDestination?.subtitle ?? "Broker-backed workspace chat.";
  const composerTitle =
    selectedKind === "direct" ? `Message ${threadTitle}` : `Post to ${threadTitle}`;
  const sidebarSummary = `${activeState.messages.length} messages · ${activeState.directs.length} agents`;
  const activityLabel =
    selectedKind === "direct" ? "Direct active" : selectedKind === "filter" ? "View active" : "Channel active";

  async function handleRefresh() {
    setFeedback("Refreshing broker and mesh state…");
    try {
      await requestNative({ type: "refresh" });
      setFeedback("Workspace refreshed.");
    } catch (error) {
      setFeedback(asErrorMessage(error));
    }
  }

  async function handleToggleMic() {
    try {
      await requestNative({ type: "toggleVoiceCapture" });
    } catch (error) {
      setFeedback(asErrorMessage(error));
    }
  }

  async function handleTogglePlayback() {
    try {
      await requestNative({
        type: "setVoiceRepliesEnabled",
        enabled: !activeState.voice.repliesEnabled,
      });
    } catch (error) {
      setFeedback(asErrorMessage(error));
    }
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) {
      return;
    }

    setSending(true);
    setFeedback("Sending…");
    try {
      await requestNative({
        type: "sendMessage",
        destinationKind: selectedKind,
        destinationId: selectedId,
        body,
      });
      setDraft("");
      setFeedback("Sent.");
    } catch (error) {
      setFeedback(asErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`relay-shell${sidebarCollapsed ? " rail-collapsed" : ""}`}>
      {!sidebarCollapsed ? (
        <aside className="workspace-rail">
          <div className="workspace-rail-scroll">
            <div className="workspace-rail-header">
              <div className="workspace-header-row">
                <div>
                  <div className="workspace-title">{activeState.title}</div>
                  <div className="workspace-sync-line">{activeState.syncLine}</div>
                </div>
              </div>
            </div>

            <NavSection
              label="Channels"
              items={activeState.channels}
              selectedKind={selectedKind}
              selectedId={selectedId}
              onSelect={(kind, id) => {
                setSelectedKind(kind);
                setSelectedId(id);
              }}
            />

            <NavSection
              label="Views"
              items={viewItems}
              selectedKind={selectedKind}
              selectedId={selectedId}
              onSelect={(kind, id) => {
                setSelectedKind(kind);
                setSelectedId(id);
              }}
            />

            <div className="nav-section">
              <div className="nav-section-label">Agents</div>
              {activeState.directs.map((direct) => {
                const isActive = selectedKind === "direct" && selectedId === direct.id;
                return (
                  <button
                    key={direct.id}
                    className={`direct-thread-row${isActive ? " active" : ""}`}
                    onClick={() => {
                      setSelectedKind("direct");
                      setSelectedId(direct.id);
                    }}
                  >
                    <div
                      className="thread-avatar"
                      style={{ background: avatarFill(colorForIdentity(direct.id)) }}
                    >
                      {direct.title.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="direct-thread-copy">
                      <div className="direct-thread-head">
                        <div className="direct-thread-title">{direct.title}</div>
                        <div className={`presence-dot${direct.reachable ? " online" : ""}`} />
                        {direct.timestampLabel ? <div className="thread-timestamp">{direct.timestampLabel}</div> : null}
                      </div>
                      <div className="direct-thread-subtitle">{direct.subtitle}</div>
                      <div className={`direct-thread-state${direct.reachable ? " online" : ""}`}>
                        {direct.reachable ? "ON" : "OFF"}
                      </div>
                      {direct.preview ? <div className="direct-thread-preview">{direct.preview}</div> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="workspace-rail-footer">
            <div className="workspace-footer-copy">
              {activeState.lastUpdatedLabel ? `Updated ${activeState.lastUpdatedLabel}.` : "Broker-backed workspace."}
            </div>
          </div>
        </aside>
      ) : null}

      <main className="thread-shell">
        <header className="thread-toolbar">
          <div className="thread-toolbar-copy">
            <button
              className="thread-sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? "Show agent rail" : "Hide agent rail"}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {sidebarCollapsed ? "▸" : "◂"}
            </button>
            <div className="thread-glyph">{destinationGlyph(selectedKind, selectedId)}</div>
            <div className="thread-title-line">
              <div className="thread-title">{threadTitle}</div>
              <div className="thread-count">{`${visibleMessages.length} message${visibleMessages.length === 1 ? "" : "s"}`}</div>
            </div>
          </div>

          <div className="thread-actions">
            <div className="thread-control-row">
              <button
                className={`thread-control${activeState.voice.isCapturing ? " active" : ""}`}
                onClick={handleToggleMic}
              >
                <span>Capture</span>
                <span className="thread-control-state">{activeState.voice.isCapturing ? "On" : "Off"}</span>
              </button>
              <button
                className={`thread-control${showAnnotations ? " active" : ""}`}
                onClick={() => setShowAnnotations((value) => !value)}
              >
                <span>Annotations</span>
                <span className="thread-control-state">{showAnnotations ? "On" : "Off"}</span>
              </button>
              <button
                className={`thread-control${activeState.voice.repliesEnabled ? " active" : ""}`}
                onClick={handleTogglePlayback}
              >
                <span>Playback</span>
                <span className="thread-control-state">{activeState.voice.repliesEnabled ? "On" : "Off"}</span>
              </button>
            </div>
            <button className="thread-sync-button" onClick={handleRefresh}>
              Sync
            </button>
          </div>
        </header>

        <div className="messages-scroll">
          <div className="messages-column">
            <Timeline messages={visibleMessages} showAnnotations={showAnnotations} />
          </div>
        </div>

        <div className="composer-shell">
          <div className="composer-column">
            <div className="composer-inline-bar">
              <textarea
                ref={composerRef}
                className="composer-field composer-field-inline"
                placeholder={`Message ${threadTitle}...`}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />

              <div className="composer-inline-actions">
                <button
                  className={`composer-icon-button${activeState.voice.isCapturing ? " active" : ""}`}
                  type="button"
                  aria-label={activeState.voice.isCapturing ? "Stop capture" : "Start capture"}
                  onClick={handleToggleMic}
                >
                  <MicGlyph />
                </button>
                <button
                  className="composer-icon-button"
                  type="button"
                  aria-label={sending ? "Sending" : "Send message"}
                  disabled={sending || !draft.trim()}
                  onClick={handleSend}
                >
                  <MailGlyph />
                </button>
              </div>
            </div>

            <div className="composer-status-strip">
              <div className="composer-status-left">
                <div className="composer-status-segment">
                  <div className="composer-caption">@ mention agents</div>
                </div>
                <div className="composer-status-segment">
                  <kbd className="kbd">⌘ ↵</kbd>
                  <div className="composer-hint">send</div>
                </div>
                {feedback ? (
                  <div className="composer-status-segment">
                    <div className="composer-hint">{feedback}</div>
                  </div>
                ) : null}
              </div>
              <div className="composer-activity">
                <span className="composer-activity-dot" />
                <span>{activityLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.5a1.75 1.75 0 0 1 1.75 1.75v3.5a1.75 1.75 0 1 1-3.5 0v-3.5A1.75 1.75 0 0 1 8 2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.75 7.25a3.25 3.25 0 0 0 6.5 0M8 10.5v2.5M6.25 13h3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 5.75h12a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m4 7 5.17 4.1a1.35 1.35 0 0 0 1.66 0L16 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m4.8 13.6 3.9-3.45M15.2 13.6l-3.9-3.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.78"
      />
    </svg>
  );
}

function NavSection({
  label,
  items,
  selectedKind,
  selectedId,
  onSelect,
}: {
  label: string;
  items: RelayNavItem[];
  selectedKind: RelayDestinationKind;
  selectedId: string;
  onSelect: (kind: RelayDestinationKind, id: string) => void;
}) {
  return (
    <div className="nav-section">
      <div className="nav-section-label">{label}</div>
      {items.map((item) => {
        const isActive = selectedKind === item.kind && selectedId === item.id;
        return (
          <button
            key={`${item.kind}-${item.id}`}
            className={`nav-lane-row${isActive ? " active" : ""}`}
            onClick={() => onSelect(item.kind, item.id)}
          >
            <div className="lane-icon">{destinationGlyph(item.kind, item.id)}</div>
            <div className="lane-copy">
              <div className="lane-title">{item.title}</div>
              <div className="lane-subtitle">{item.subtitle}</div>
            </div>
            {item.count > 0 ? <div className="lane-count">{item.count}</div> : <div />}
          </button>
        );
      })}
    </div>
  );
}

function Timeline({ messages, showAnnotations }: { messages: RelayMessage[]; showAnnotations: boolean }) {
  if (!messages.length) {
    return (
      <div className="empty-state">
        <div className="empty-copy">
          This lane is quiet right now. Send a broker-backed message or open a direct thread to start the conversation.
        </div>
      </div>
    );
  }

  const rows: React.ReactNode[] = [];
  let lastDayLabel = "";
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    const visibleRole = shouldRenderRole(message.authorRole) ? message.authorRole : null;

    if (message.dayLabel !== lastDayLabel) {
      rows.push(
        <div className="day-divider" key={`day-${message.dayLabel}`}>
          <span>{message.dayLabel}</span>
        </div>
      );
      lastDayLabel = message.dayLabel;
    }

    if (message.isSystem || message.messageClass === "status") {
      rows.push(
        <div className="status-row" key={message.id}>
          <div className="message-avatar status-avatar" style={{ background: avatarFill(message.avatarColor) }}>
            {message.avatarLabel}
          </div>
          <div className="status-copy">
            <div className="status-author-row">
              <div className="status-author">{message.authorName}</div>
              <div className="message-time">{message.timestampLabel}</div>
            </div>
            <div className="status-task-pill">
              <span className="status-task-spinner" />
              <span className="status-task-prefix">TASK //</span>
              <span className="status-task-body">{message.body}</span>
              <span className="status-task-state">IN PROGRESS</span>
            </div>
          </div>
        </div>
      );
      index += 1;
      continue;
    }

    const grouped: RelayMessage[] = [message];
    let cursor = index + 1;
    while (
      cursor < messages.length &&
      messages[cursor].authorId === message.authorId &&
      !messages[cursor].isSystem &&
      messages[cursor].messageClass !== "status"
    ) {
      grouped.push(messages[cursor]);
      cursor += 1;
    }

    rows.push(
      <div className="message-block" key={message.id}>
        <div
          className="message-avatar"
          style={{ background: avatarFill(message.avatarColor) }}
          title={visibleRole ?? undefined}
        >
          {message.avatarLabel}
        </div>
        <div className="message-content">
          <div className="message-head">
            <div className="message-author">{message.authorName}</div>
            {visibleRole ? <div className="message-role">{visibleRole}</div> : null}
            <div className="message-time">{message.timestampLabel}</div>
            {showAnnotations && (message.routingSummary || message.provenanceSummary) ? (
              <div className="message-annotations-inline">
                {message.routingSummary ? <div className="message-annotation-pill">{message.routingSummary}</div> : null}
                {message.provenanceSummary ? <div className="message-annotation-pill">{message.provenanceSummary}</div> : null}
              </div>
            ) : null}
          </div>

          {grouped.map((entry) => (
            <div key={entry.id} className={`message-entry${entry.isOperator ? " operator" : ""}`}>
              <div className="message-body">{renderMessageBody(entry.body)}</div>
              {showAnnotations && (entry.routingSummary || entry.provenanceSummary || entry.provenanceDetail) ? (
                <div className="message-notes">
                  {entry.routingSummary ? <div className="message-routing-chip">{entry.routingSummary}</div> : null}
                  {entry.provenanceSummary ? <div className="message-provenance">{entry.provenanceSummary}</div> : null}
                  {entry.provenanceDetail ? <div className="message-context">{entry.provenanceDetail}</div> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );

    index = cursor;
  }

  return <>{rows}</>;
}

function shouldRenderRole(role: string | null) {
  if (!role) {
    return false;
  }

  return role.trim().toLowerCase() !== "operator";
}

function resolveDestination(state: RelayState, views: RelayNavItem[], kind: RelayDestinationKind, id: string) {
  if (kind === "channel") {
    return state.channels.find((item) => item.id === id);
  }
  if (kind === "filter") {
    return views.find((item) => item.id === id);
  }
  return state.directs.find((item) => item.id === id);
}

function filterMessages(messages: RelayMessage[], kind: RelayDestinationKind, id: string) {
  if (kind === "direct") {
    return messages.filter(
      (message) =>
        message.isDirectConversation &&
        (message.authorId === id || message.recipients.includes(id))
    );
  }

  if (kind === "filter" && id === "overview") {
    return messages.filter((message) => !message.isVoice);
  }

  if (kind === "filter" && id === "mentions") {
    return messages.filter(
      (message) =>
        !message.isDirectConversation &&
        !message.isSystem &&
        !message.isVoice &&
        message.recipients.length > 0
    );
  }

  if (kind === "channel" && id === "voice") {
    return messages.filter((message) => message.isVoice);
  }

  if (kind === "channel" && id === "system") {
    return messages.filter((message) => message.isSystem);
  }

  return messages.filter(
    (message) =>
      !message.isDirectConversation &&
      !message.isSystem &&
      !message.isVoice &&
      (!message.normalizedChannel || message.normalizedChannel === "shared")
  );
}

function ensureOverviewView(views: RelayNavItem[], messages: RelayMessage[]) {
  if (views.some((view) => view.id === "overview")) {
    return views;
  }

  const overviewItem: RelayNavItem = {
    kind: "filter",
    id: "overview",
    title: "Overview",
    subtitle: "Cross-agent activity and workspace traffic.",
    count: messages.filter((message) => !message.isVoice).length,
  };

  return [overviewItem, ...views];
}

function destinationGlyph(kind: RelayDestinationKind, id: string) {
  if (kind === "direct") {
    return "@";
  }
  if (id === "voice") {
    return "≋";
  }
  if (id === "system") {
    return "⚙";
  }
  if (id === "mentions") {
    return "@";
  }
  return "#";
}

function placeholderForDestination(kind: RelayDestinationKind, id: string) {
  if (kind === "filter" && id === "overview") {
    return "Message #shared-channel...";
  }
  if (kind === "direct") {
    return "Ask a direct question, hand over context, or request a concrete action.";
  }
  if (kind === "channel" && id === "voice") {
    return "Post a voice-related note, transcript, or spoken update.";
  }
  if (kind === "channel" && id === "system") {
    return "Post a system or infrastructure update.";
  }
  return "Share context, ask a question, or route work with @mentions.";
}

function asErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Action failed.";
}

function colorForIdentity(identity: string) {
  const palette = ["#3b82f6", "#14b8a6", "#fb923c", "#f43f5e", "#8b5cf6", "#10b981"];
  let seed = 0;
  for (const character of identity) {
    seed += character.charCodeAt(0);
  }

  return palette[seed % palette.length];
}

function avatarFill(color: string) {
  return color;
}

function renderMessageBody(body: string) {
  const parts = parseBodySegments(body);
  return parts.map((part, index) => {
    if (part.type === "paragraph") {
      return (
        <p key={index} className="message-paragraph">
          {part.text}
        </p>
      );
    }

    if (part.type === "quote") {
      return (
        <blockquote key={index} className="message-quote">
          {part.text}
        </blockquote>
      );
    }

    return (
      <div key={index} className="message-terminal">
        <div className="message-terminal-header">probe-01 ~</div>
        <pre>{part.text}</pre>
      </div>
    );
  });
}

function parseBodySegments(body: string): Array<{ type: "paragraph" | "quote" | "code"; text: string }> {
  const lines = body.split("\n");
  const segments: Array<{ type: "paragraph" | "quote" | "code"; text: string }> = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      segments.push({ type: "code", text: codeLines.join("\n") });
      index += 1;
      continue;
    }

    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      segments.push({ type: "quote", text: quoteLines.join(" ") });
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
      !lines[index].trim().startsWith(">") &&
      !lines[index].trim().startsWith("```")
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    segments.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return segments;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
