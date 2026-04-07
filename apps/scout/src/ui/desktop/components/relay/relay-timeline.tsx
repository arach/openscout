"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Check,
  CheckCheck,
  CornerUpLeft,
  Hash,
  MessageSquare,
  Network,
  Radar,
  Radio,
  Reply,
  Settings,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { C } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type {
  AppSettingsState,
  DesktopShellState,
  InterAgentAgent,
  RelayDestinationKind,
  RelayDirectThread,
  RelayMessage,
} from "@/lib/scout-desktop";
import {
  canInlineRelayReceipt,
  colorForIdentity,
  compactHomePath,
  formatRelayDayLabel,
  formatRelayTimestamp,
  highlightedMessageStyle,
  interAgentProfileKindLabel,
  messageDomId,
  messagePreviewSnippet,
  messageRefSuffix,
  normalizeLegacyAgentCopy,
  optimisticRelayConversationId,
  relayMessageMentionRecipients,
  relayPresenceDotClass,
  relayReceiptTone,
  resolveOperatorDisplayName,
  shortMessageRef,
  stableMessageRef,
  shouldRenderRole,
} from "@/components/relay/relay-utils";

export type RelayTimelineProps = {
  messages: RelayMessage[];
  showAnnotations: boolean;
  showStatusMessages: boolean;
  inkStyle: React.CSSProperties;
  mutedStyle: React.CSSProperties;
  tagStyle: React.CSSProperties;
  annotStyle: React.CSSProperties;
  agentLookup: Map<string, InterAgentAgent>;
  directThreadLookup: Map<string, RelayDirectThread>;
  onOpenAgentProfile: (agentId: string) => void;
  onOpenAgentChat: (agentId: string, draft?: string | null) => void;
  onNudgeMessage?: (message: RelayMessage) => void;
};

export function RelayPresenceBadge({ thread }: { thread: RelayDirectThread }) {
  if (thread.state === "available") {
    return null;
  }

  if (thread.state === "working") {
    return (
      <span className="inline-flex items-center gap-1 shrink-0" style={{ color: C.muted }}>
        <TypingDots />
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[9px] font-mono tracking-wide shrink-0"
      style={{ color: C.muted }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${relayPresenceDotClass(thread.state)}`}></span>
      <span>{thread.statusLabel}</span>
    </span>
  );
}

export function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-hidden="true">
      <span className="os-thinking-dot"></span>
      <span className="os-thinking-dot"></span>
      <span className="os-thinking-dot"></span>
    </span>
  );
}

export function RelayTimeline({
  messages,
  showAnnotations,
  showStatusMessages,
  inkStyle,
  mutedStyle,
  tagStyle,
  annotStyle,
  agentLookup,
  directThreadLookup,
  onOpenAgentProfile,
  onOpenAgentChat,
  onNudgeMessage,
}: RelayTimelineProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [nudgedMessageId, setNudgedMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const rows: React.ReactNode[] = [];
  let lastDayLabel = "";
  let index = 0;
  const timelineMessages = useMemo(
    () => showStatusMessages ? messages : messages.filter((message) => message.messageClass !== "status"),
    [messages, showStatusMessages],
  );
  const messageById = useMemo(
    () => new Map(timelineMessages.map((message) => [message.id, message])),
    [timelineMessages],
  );
  const latestDirectReceiptMessageId = useMemo(() => {
    let latestMessageId: string | null = null;
    for (const message of timelineMessages) {
      if (message.isOperator && message.isDirectConversation && message.receipt) {
        latestMessageId = message.id;
      }
    }
    return latestMessageId;
  }, [timelineMessages]);

  useEffect(() => {
    if (!copiedMessageId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopiedMessageId((current) => (current === copiedMessageId ? null : current));
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [copiedMessageId]);

  useEffect(() => {
    if (!nudgedMessageId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNudgedMessageId((current) => (current === nudgedMessageId ? null : current));
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [nudgedMessageId]);

  useEffect(() => {
    if (!highlightedMessageId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === highlightedMessageId ? null : current));
    }, 2200);

    return () => window.clearTimeout(timeoutId);
  }, [highlightedMessageId]);

  const handleCopyMessageRef = React.useCallback(async (messageId: string) => {
    try {
      await copyTextToClipboard(shortMessageRef(messageId));
      setCopiedMessageId(messageId);
    } catch {
      setCopiedMessageId(null);
    }
  }, []);

  const handleNudge = React.useCallback((message: RelayMessage) => {
    onNudgeMessage?.(message);
    setNudgedMessageId(message.id);
  }, [onNudgeMessage]);

  const handleJumpToMessage = React.useCallback((messageId: string) => {
    if (typeof document === "undefined") {
      return;
    }

    const target = document.getElementById(messageDomId(messageId));
    if (!target) {
      return;
    }

    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightedMessageId(messageId);
  }, []);

  while (index < timelineMessages.length) {
    const message = timelineMessages[index];
    const visibleRole = shouldRenderRole(message.authorRole) ? message.authorRole : null;
    const authorAgent = message.isOperator ? null : agentLookup.get(message.authorId) ?? null;
    const authorDirectThread = authorAgent ? directThreadLookup.get(authorAgent.id) ?? null : null;

    if (message.dayLabel !== lastDayLabel) {
      rows.push(
        <div key={`day-${message.dayLabel}`} className="flex items-center gap-3 mb-5 mt-2">
          <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
          <div className="px-2 font-mono text-[9px] tracking-widest uppercase shrink-0" style={mutedStyle}>{message.dayLabel}</div>
          <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
        </div>,
      );
      lastDayLabel = message.dayLabel;
    }

    if (message.isSystem || message.messageClass === "status") {
      rows.push(
        <div key={message.id} className="flex gap-3 mb-3 group rounded-lg px-2 py-2 -mx-2 bg-[var(--os-hover)]">
          <div className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-semibold shrink-0 mt-0.5" style={{ backgroundColor: message.avatarColor, color: "white", opacity: 0.85 }}>
            {message.avatarLabel}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between mb-0.5">
              <div className="flex items-baseline gap-2">
                {authorAgent ? (
                  <AgentIdentityInline
                    agent={authorAgent}
                    directThread={authorDirectThread}
                    visibleRole={visibleRole}
                    timestampLabel={message.timestampLabel}
                    inkStyle={inkStyle}
                    mutedStyle={mutedStyle}
                    tagStyle={tagStyle}
                    onOpenProfile={onOpenAgentProfile}
                    onOpenChat={onOpenAgentChat}
                  />
                ) : (
                  <>
                    <span className="font-semibold text-[12px]" style={inkStyle}>{message.authorName}</span>
                    <span className="text-[9px] font-mono" style={mutedStyle}>{message.timestampLabel}</span>
                  </>
                )}
              </div>
            </div>
            <div
              id={messageDomId(message.id)}
              className="group/message relative text-[12px] leading-relaxed rounded-lg px-2 py-1.5 pr-12 -mx-2"
              style={highlightedMessageId === message.id ? highlightedMessageStyle() : inkStyle}
            >
              <div className="flex items-center gap-2 px-2 py-1.5 border rounded font-mono text-[10px] w-fit" style={tagStyle}>
                <Spinner className="text-[10px]" />
                <span><span style={mutedStyle}>TASK //</span> {message.body}</span>
                <span className="ml-2 px-1 rounded" style={{ backgroundColor: "rgba(99,102,241,0.12)", color: "var(--os-accent)" }}>IN PROGRESS</span>
              </div>
              <MessageReferenceControls
                message={message}
                copied={copiedMessageId === message.id}
                nudged={nudgedMessageId === message.id}
                canNudge={Boolean(onNudgeMessage && !message.isOperator)}
                mutedStyle={mutedStyle}
                onCopyRef={handleCopyMessageRef}
                onNudge={() => handleNudge(message)}
              />
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
      cursor < timelineMessages.length &&
      timelineMessages[cursor].authorId === message.authorId &&
      timelineMessages[cursor].dayLabel === message.dayLabel &&
      !timelineMessages[cursor].isSystem &&
      timelineMessages[cursor].messageClass !== "status"
    ) {
      grouped.push(timelineMessages[cursor]);
      cursor += 1;
    }

    const isAgent = Boolean(authorAgent);

    rows.push(
      <div key={message.id} className={cn("flex gap-3 mb-4 group rounded-lg px-2 py-2 -mx-2", isAgent && "bg-[var(--os-hover)]")}>
        <div className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-semibold shrink-0 mt-0.5" style={{ backgroundColor: message.avatarColor, color: "white", opacity: 0.85 }}>
          {message.avatarLabel}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between mb-1">
            <div className="flex items-baseline gap-2">
              {authorAgent ? (
                <AgentIdentityInline
                  agent={authorAgent}
                  directThread={authorDirectThread}
                  visibleRole={visibleRole}
                  timestampLabel={message.timestampLabel}
                  inkStyle={inkStyle}
                  mutedStyle={mutedStyle}
                  tagStyle={tagStyle}
                  onOpenProfile={onOpenAgentProfile}
                  onOpenChat={onOpenAgentChat}
                />
              ) : (
                <>
                  <span className="font-semibold text-[12px]" style={inkStyle}>{message.authorName}</span>
                  {visibleRole ? (
                    <span className="text-[9px] font-mono border px-1 py-0.5 rounded" style={tagStyle}>{visibleRole}</span>
                  ) : null}
                  <span className="text-[9px] font-mono" style={mutedStyle}>{message.timestampLabel}</span>
                </>
              )}
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
            {grouped.map((entry) => {
              const replyTarget = entry.replyToMessageId ? messageById.get(entry.replyToMessageId) ?? null : null;
              const showReceipt = Boolean(
                entry.receipt && (
                  !entry.isOperator
                  || !entry.isDirectConversation
                  || latestDirectReceiptMessageId === entry.id
                )
              );
              const renderReceiptInline = showReceipt && canInlineRelayReceipt(entry.body);
              return (
                <div
                  key={entry.id}
                  id={messageDomId(entry.id)}
                  className="group/message relative text-[12px] leading-relaxed rounded-lg px-2 py-1.5 pr-12 -mx-2"
                  style={highlightedMessageId === entry.id ? highlightedMessageStyle() : inkStyle}
                >
                  {entry.replyToMessageId ? (
                    replyTarget ? (
                      <ReplyReferenceLine
                        messageId={entry.replyToMessageId}
                        preview={messagePreviewSnippet(replyTarget.body, 64)}
                        mutedStyle={mutedStyle}
                        onJump={() => handleJumpToMessage(entry.replyToMessageId!)}
                      />
                    ) : (
                      <ReplyReferenceLine
                        messageId={entry.replyToMessageId}
                        mutedStyle={mutedStyle}
                      />
                    )
                  ) : null}
                  {renderReceiptInline && entry.receipt ? (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="min-w-0 max-w-full whitespace-pre-wrap break-words" style={inkStyle}>
                        {entry.body}
                      </span>
                      <RelayReceiptInline receipt={entry.receipt} mutedStyle={mutedStyle} inline />
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2">{renderMessageBody(entry.body, inkStyle, mutedStyle, tagStyle)}</div>
                      {showReceipt && entry.receipt ? (
                        <RelayReceiptInline receipt={entry.receipt} mutedStyle={mutedStyle} />
                      ) : null}
                    </>
                  )}
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
                  <MessageReferenceControls
                    message={entry}
                    copied={copiedMessageId === entry.id}
                    nudged={nudgedMessageId === entry.id}
                    canNudge={Boolean(onNudgeMessage && !entry.isOperator)}
                    mutedStyle={mutedStyle}
                    onCopyRef={handleCopyMessageRef}
                    onNudge={() => handleNudge(entry)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>,
    );

    index = cursor;
  }

  return <>{rows}</>;
}

function MessageReferenceControls({
  message,
  copied,
  nudged,
  canNudge,
  mutedStyle,
  onCopyRef,
  onNudge,
}: {
  message: RelayMessage;
  copied: boolean;
  nudged: boolean;
  canNudge: boolean;
  mutedStyle: React.CSSProperties;
  onCopyRef: (messageId: string) => void;
  onNudge: () => void;
}) {
  return (
    <div className="absolute top-1.5 right-2 flex items-center gap-2 opacity-0 pointer-events-none transition-opacity group-hover/message:opacity-100 group-hover/message:pointer-events-auto group-focus-within/message:opacity-100 group-focus-within/message:pointer-events-auto">
      {canNudge ? (
        <button
          type="button"
          onClick={onNudge}
          className="text-[9px] font-mono lowercase tracking-wide transition-colors hover:opacity-80"
          style={nudged ? { color: C.accent } : mutedStyle}
          title={`Follow up with ${message.authorName}`}
        >
          {nudged ? "drafted" : "nudge"}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void onCopyRef(message.id)}
        className="text-[9px] font-mono lowercase tracking-wide transition-colors hover:opacity-80"
        style={copied ? { color: C.accent } : mutedStyle}
        title={stableMessageRef(message.id)}
      >
        {copied ? "copied" : messageRefSuffix(message.id)}
      </button>
    </div>
  );
}

function AgentIdentityInline({
  agent,
  directThread,
  visibleRole,
  timestampLabel,
  inkStyle,
  mutedStyle,
  tagStyle,
  onOpenProfile,
  onOpenChat,
}: {
  agent: InterAgentAgent;
  directThread: RelayDirectThread | null;
  visibleRole: string | null;
  timestampLabel: string;
  inkStyle: React.CSSProperties;
  mutedStyle: React.CSSProperties;
  tagStyle: React.CSSProperties;
  onOpenProfile: (agentId: string) => void;
  onOpenChat: (agentId: string, draft?: string | null) => void;
}) {
  const handleTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) {
      onOpenChat(agent.id);
      return;
    }
    onOpenProfile(agent.id);
  };

  return (
    <div className="relative group/agent inline-flex items-baseline gap-2 min-w-0">
      <button
        type="button"
        onClick={handleTriggerClick}
        className="inline-flex items-baseline gap-2 min-w-0 text-left hover:opacity-90 transition-opacity"
        title="Click for overview. Cmd-click to open direct chat."
      >
        <span className="font-semibold text-[12px] truncate" style={inkStyle}>{agent.title}</span>
        {visibleRole ? (
          <span className="text-[9px] font-mono border px-1 py-0.5 rounded shrink-0" style={tagStyle}>{visibleRole}</span>
        ) : null}
      </button>
      <span className="text-[9px] font-mono shrink-0" style={mutedStyle}>{timestampLabel}</span>
      <AgentHoverCard
        agent={agent}
        directThread={directThread}
        mutedStyle={mutedStyle}
        onOpenProfile={onOpenProfile}
        onOpenChat={onOpenChat}
      />
    </div>
  );
}

function AgentIdentityCard({
  agent,
  directThread = null,
  variant = "hero",
  mutedStyle = { color: C.muted },
  borderColor = C.bg,
  actions = null,
}: {
  agent: InterAgentAgent;
  directThread?: RelayDirectThread | null;
  variant?: "hero" | "hover";
  mutedStyle?: React.CSSProperties;
  borderColor?: string;
  actions?: React.ReactNode;
}) {
  const compact = variant === "hover";
  const role = normalizeLegacyAgentCopy(agent.role);
  const summary = normalizeLegacyAgentCopy(agent.summary);
  const detail = directThread?.statusDetail ?? agent.statusDetail ?? summary ?? "Available as a local relay channel.";

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div
            className={`${compact ? "w-8 h-8 text-[11px]" : "w-10 h-10 text-[13px]"} rounded text-white flex items-center justify-center font-bold ${agent.reachable ? "" : "opacity-40 grayscale"}`}
            style={{ backgroundColor: colorForIdentity(agent.id) }}
          >
            {agent.title.charAt(0).toUpperCase()}
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${relayPresenceDotClass(agent.state)}`}
            style={{ border: `1px solid ${borderColor}` }}
          ></div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={compact ? "text-[12px] font-semibold truncate" : "text-[15px] font-semibold tracking-tight"} style={{ color: C.ink }}>
              {agent.title}
            </div>
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: C.tagBg, color: C.muted }}>
              {interAgentProfileKindLabel(agent.profileKind)}
            </span>
          </div>
          {compact ? (
            <div className="text-[10px] mt-1" style={mutedStyle}>
              {detail}
            </div>
          ) : (
            <>
              {role ? (
                <div className="text-[11px] mt-1" style={{ color: C.ink }}>{role}</div>
              ) : null}
              {summary ? (
                <div className="text-[12px] leading-[1.55] mt-2" style={{ color: C.muted }}>{summary}</div>
              ) : null}
            </>
          )}
          <div className={`text-[10px] ${compact ? "mt-2 flex flex-wrap gap-x-3 gap-y-1" : "mt-3 flex items-center gap-2 flex-wrap"}`} style={mutedStyle}>
            {compact ? (
              <>
                <span>{agent.harness ?? "runtime"}</span>
                <span>{compactHomePath(agent.projectRoot ?? agent.cwd) ?? "no path"}</span>
                {agent.lastChatLabel ? <span>last chat {agent.lastChatLabel}</span> : null}
              </>
            ) : (
              <>
                <span>{agent.lastChatLabel ? `Last chat ${agent.lastChatLabel}` : "No direct chat yet."}</span>
                {agent.lastSessionLabel ? (
                  <>
                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: C.border }}></span>
                    <span>Last session {agent.lastSessionLabel}</span>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
      {actions ? (
        <div className="mt-3 flex items-center gap-2">
          {actions}
        </div>
      ) : null}
    </>
  );
}

type AgentActionButtonProps = React.ComponentProps<typeof Button> & {
  icon?: React.ReactNode;
  tone?: "neutral" | "primary";
};

export function AgentActionButton({
  children,
  icon,
  tone = "neutral",
  ...props
}: AgentActionButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 rounded-xl px-3 text-[10px] font-medium shadow-none"
      style={tone === "primary"
        ? {
            backgroundColor: C.accentBg,
            borderColor: C.accentBorder,
            color: C.accent,
          }
        : {
            backgroundColor: C.surface,
            borderColor: C.border,
            color: C.ink,
          }}
      {...props}
    >
      {icon}
      {children}
    </Button>
  );
}

function AgentHoverCard({
  agent,
  directThread,
  mutedStyle,
  onOpenProfile,
  onOpenChat,
}: {
  agent: InterAgentAgent;
  directThread: RelayDirectThread | null;
  mutedStyle: React.CSSProperties;
  onOpenProfile: (agentId: string) => void;
  onOpenChat: (agentId: string, draft?: string | null) => void;
}) {
  return (
    <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border p-3 shadow-lg opacity-0 pointer-events-none translate-y-1 transition-all duration-150 group-hover/agent:opacity-100 group-hover/agent:pointer-events-auto group-hover/agent:translate-y-0 group-focus-within/agent:opacity-100 group-focus-within/agent:pointer-events-auto group-focus-within/agent:translate-y-0" style={{ borderColor: C.border, backgroundColor: C.surface }}>
      <AgentIdentityCard
        agent={agent}
        directThread={directThread}
        variant="hover"
        mutedStyle={mutedStyle}
        borderColor={C.surface}
        actions={(
          <>
            <button
              type="button"
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
              style={{ color: C.ink }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenChat(agent.id);
              }}
            >
              Message
            </button>
            <button
              type="button"
              className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
              style={{ color: C.ink }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenProfile(agent.id);
              }}
            >
              Overview
            </button>
            <span className="ml-auto text-[9px] font-mono" style={mutedStyle}>Cmd-click to DM</span>
          </>
        )}
      />
    </div>
  );
}

function ReplyReferenceLine({
  messageId,
  preview,
  mutedStyle,
  onJump,
}: {
  messageId: string;
  preview?: string | null;
  mutedStyle: React.CSSProperties;
  onJump?: () => void;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-[9px] leading-none min-w-0" style={{ ...mutedStyle, opacity: 0.7 }}>
      <CornerUpLeft size={9} className="shrink-0" />
      {onJump ? (
        <button
          type="button"
          onClick={onJump}
          className="hover:underline underline-offset-2 truncate min-w-0"
          title={stableMessageRef(messageId)}
        >
          {preview || shortMessageRef(messageId)}
        </button>
      ) : (
        <span className="font-mono shrink-0">{shortMessageRef(messageId)}</span>
      )}
    </div>
  );
}

function RelayReceiptInline({
  receipt,
  mutedStyle,
  inline = false,
}: {
  receipt: NonNullable<RelayMessage["receipt"]>;
  mutedStyle: React.CSSProperties;
  inline?: boolean;
}) {
  const tone = relayReceiptTone(receipt.state);
  return (
    <div
      className={`${inline ? "" : "mt-1.5 "}inline-flex items-center gap-1.5 text-[10px] leading-none shrink-0`}
      style={{ ...mutedStyle, color: tone.color }}
      title={receipt.detail ?? receipt.label}
    >
      <RelayReceiptIcon state={receipt.state} />
      <span className="font-mono uppercase tracking-[0.14em]">{receipt.label}</span>
      {receipt.state === "replied" && receipt.detail ? (
        <span style={mutedStyle}>{receipt.detail}</span>
      ) : null}
    </div>
  );
}

function RelayReceiptIcon({ state }: { state: NonNullable<RelayMessage["receipt"]>["state"] }) {
  switch (state) {
    case "replied":
      return <Reply size={11} />;
    case "working":
      return <TypingDots className="text-[var(--os-accent)]" />;
    case "seen":
      return <CheckCheck size={11} />;
    case "delivered":
      return <CheckCheck size={11} />;
    case "sent":
    default:
      return <Check size={11} />;
  }
}

export function InterAgentIcon({
  size = 16,
  strokeWidth = 1.35,
  style,
}: {
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  return <Network size={size} strokeWidth={strokeWidth} className="shrink-0" style={style} aria-hidden="true" />;
}

export function RelayRailIcon({ id, active, size = 12 }: { id: string; active: boolean; size?: number }) {
  const iconStyle = active ? { color: C.accent } : undefined;

  if (id === "voice") {
    return <Radio size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  if (id === "system") {
    return <Settings size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  if (id === "mentions") {
    return <AtSign size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  if (id === "coordination") {
    return <MessageSquare size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  if (id === "all-traffic") {
    return <Radar size={size} className="os-row-icon shrink-0" style={iconStyle} />;
  }
  return <Hash size={size} className="os-row-icon shrink-0" style={iconStyle} />;
}

export function buildOptimisticRelayMessage({
  relayState,
  appSettings,
  destinationKind,
  destinationId,
  body,
  replyToMessageId,
  clientMessageId,
}: {
  relayState: DesktopShellState["relay"] | null;
  appSettings: AppSettingsState | null;
  destinationKind: RelayDestinationKind;
  destinationId: string;
  body: string;
  replyToMessageId: string | null;
  clientMessageId: string;
}): RelayMessage {
  const createdAt = Date.now();
  const operatorId = relayState?.operatorId ?? "operator";
  const operatorName = resolveOperatorDisplayName(relayState, appSettings);
  const recipients = destinationKind === "direct"
    ? Array.from(new Set([destinationId, ...relayMessageMentionRecipients(body)]))
    : relayMessageMentionRecipients(body);
  const normalizedChannel = destinationKind === "channel"
    ? destinationId
    : destinationKind === "direct"
      ? null
      : "shared";
  const isVoice = destinationKind === "channel" && destinationId === "voice";
  const isSystem = destinationKind === "channel" && destinationId === "system";

  return {
    id: `pending-${clientMessageId}`,
    clientMessageId,
    conversationId: optimisticRelayConversationId(destinationKind, destinationId),
    createdAt,
    replyToMessageId,
    authorId: operatorId,
    authorName: operatorName,
    authorRole: null,
    body,
    timestampLabel: formatRelayTimestamp(createdAt),
    dayLabel: formatRelayDayLabel(createdAt),
    normalizedChannel,
    recipients,
    isDirectConversation: destinationKind === "direct",
    isSystem,
    isVoice,
    messageClass: isSystem ? "system" : "agent",
    routingSummary: recipients.length > 0 ? `Targets ${recipients.join(", ")}` : null,
    provenanceSummary: "via electron · sending",
    provenanceDetail: null,
    isOperator: true,
    avatarLabel: operatorName.slice(0, 1).toUpperCase() || "A",
    avatarColor: colorForIdentity(operatorId),
    receipt: {
      state: "sent",
      label: "Sending…",
      detail: null,
    },
  };
}

function renderMessageBody(
  body: string,
  inkStyle: React.CSSProperties,
  mutedStyle: React.CSSProperties,
  tagStyle: React.CSSProperties,
) {
  const markdownStyle = {
    "--os-markdown-ink": String(inkStyle.color ?? C.ink),
    "--os-markdown-muted": String(mutedStyle.color ?? C.muted),
    "--os-markdown-link": C.accent,
    "--os-markdown-border": C.border,
    "--os-markdown-surface": String(tagStyle.backgroundColor ?? C.tagBg),
    "--os-markdown-inline-border": String(tagStyle.borderColor ?? C.border),
    "--os-markdown-code-bg": C.termBg,
    "--os-markdown-code-fg": C.termFg,
  } as React.CSSProperties;

  return (
    <div className="os-markdown" style={markdownStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote>{children}</blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
            const value = String(children).replace(/\n$/, "");
            const isInline = !language && !value.includes("\n");

            if (isInline) {
              return (
                <code className="os-markdown-inline-code" {...props}>
                  {value}
                </code>
              );
            }

            return (
              <div className="os-markdown-code-block">
                <div className="os-markdown-code-header">
                  <span>{language ?? "code"}</span>
                </div>
                <pre className="os-markdown-pre">
                  <code className={className} {...props}>
                    {value}
                  </code>
                </pre>
              </div>
            );
          },
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,
          hr: () => <hr />,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="os-markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (copied) {
      return;
    }
  }

  throw new Error("Clipboard unavailable.");
}

export function generateClientMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `client-${crypto.randomUUID()}`;
  }

  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
