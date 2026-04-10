"use client";

import React from "react";
import {
  AtSign,
  Bot,
  Copy,
  ExternalLink,
  Eye,
  MessageSquare,
  Mic,
  SendHorizontal,
  Settings,
  X,
} from "lucide-react";
import { Spinner } from "@/components/primitives/spinner";
import type {
  AgentSessionInspector,
  InterAgentAgent,
  InterAgentThread,
  MessagesState,
  MessagesThread,
  RelayDestinationKind,
  RelayDirectThread,
  RelayMessage,
  RelayVoiceState,
  SessionMetadata,
} from "@/lib/scout-desktop";
import { C } from "@/lib/theme";
import type { RelayMentionCandidate } from "@web/features/messages/lib/relay-types";
import {
  cleanDisplayTitle,
  compactHomePath,
  colorForIdentity,
  messagePreviewSnippet,
  relayPresenceDotClass,
  shortMessageRef,
} from "@web/features/messages/lib/relay-utils";
import {
  InterAgentIcon,
  RelayPresenceBadge,
  RelayRailIcon,
  RelayTimeline,
  TypingDots,
} from "@web/features/messages/components/relay-timeline";

export type MessagesDetailTab = "overview" | "live" | "history";

export type MessagesViewStyles = {
  sidebar: React.CSSProperties;
  surface: React.CSSProperties;
  inkText: React.CSSProperties;
  mutedText: React.CSSProperties;
  tagBadge: React.CSSProperties;
  annotBadge: React.CSSProperties;
  activeItem: React.CSSProperties;
  activePill: React.CSSProperties;
  kbd: React.CSSProperties;
};

type RelayContextReference = {
  messageId: string;
  authorName: string;
  preview: string;
};

type RelayReplyTarget = {
  messageId: string;
  authorId: string;
  authorName: string;
  preview: string;
};

export function MessagesView({
  sidebarWidth,
  messagesDetailWidth,
  isCollapsed,
  onResizeStart,
  onMessagesDetailResizeStart,
  styles,
  messagesState,
  messageThreads,
  selectedMessagesThread,
  onSelectMessageThread,
  showAnnotations,
  setShowAnnotations,
  onRefresh,
  loadingWorkspace,
  selectedMessagesInternalThread,
  selectedMessagesInternalMessages,
  selectedMessagesInternalTarget,
  selectedMessagesDetailAgentId,
  selectedMessagesDetailAgent,
  selectedMessagesSessions,
  selectedSession,
  setSelectedSession,
  formatDate,
  interAgentAgents,
  interAgentAgentLookup,
  relayDirectLookup,
  openAgentProfile,
  openAgentDirectMessage,
  onNudgeMessage,
  messagesDetailOpen,
  setMessagesDetailOpen,
  messagesDetailTab,
  setMessagesDetailTab,
  selectedRelayKind,
  selectedRelayId,
  relayThreadTitle,
  relayThreadSubtitle,
  relayThreadCount,
  selectedRelayDirectThread,
  relayVoiceState,
  visibleRelayMessages,
  relayTimelineViewportRef,
  onRelayTimelineScroll,
  relayReplyTarget,
  setRelayReplyTarget,
  relayContextReferences,
  relayContextMessageIds,
  setRelayContextMessageIds,
  relayComposerRef,
  relayDraft,
  setRelayDraft,
  relaySending,
  relayFeedback,
  relayComposerSelectionStart,
  setRelayComposerSelectionStart,
  mergedRelayMessages,
  relayMentionMenuOpen,
  relayMentionSuggestions,
  relayMentionSelectionIndex,
  setRelayMentionSelectionIndex,
  relayMentionDuplicateTitleCounts,
  applyRelayMentionSuggestion,
  onRelaySend,
  onToggleVoiceCapture,
  onSetVoiceRepliesEnabled,
  visibleAgentSession,
  agentSessionPending,
  agentSessionFeedback,
  agentSessionCopied,
  onCopyAgentSessionCommand,
  onOpenAgentSession,
  onPeekAgentSession,
  onOpenAgentSettings,
  desktopVoiceEnabled,
}: {
  sidebarWidth: number;
  messagesDetailWidth: number;
  isCollapsed: boolean;
  onResizeStart: React.MouseEventHandler<HTMLDivElement>;
  onMessagesDetailResizeStart: React.MouseEventHandler<HTMLDivElement>;
  styles: MessagesViewStyles;
  messagesState: MessagesState | null;
  messageThreads: MessagesThread[];
  selectedMessagesThread: MessagesThread | null;
  onSelectMessageThread: (thread: MessagesThread) => void;
  showAnnotations: boolean;
  setShowAnnotations: React.Dispatch<React.SetStateAction<boolean>>;
  onRefresh: () => void | Promise<void>;
  loadingWorkspace: boolean;
  selectedMessagesInternalThread: InterAgentThread | null;
  selectedMessagesInternalMessages: RelayMessage[];
  selectedMessagesInternalTarget: InterAgentAgent | null;
  selectedMessagesDetailAgentId: string | null;
  selectedMessagesDetailAgent: InterAgentAgent | null;
  selectedMessagesSessions: SessionMetadata[];
  selectedSession: SessionMetadata | null;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionMetadata | null>>;
  formatDate: (value: string) => string;
  interAgentAgents: InterAgentAgent[];
  interAgentAgentLookup: Map<string, InterAgentAgent>;
  relayDirectLookup: Map<string, RelayDirectThread>;
  openAgentProfile: (agentId: string) => void;
  openAgentDirectMessage: (agentId: string, draft?: string | null) => void;
  onNudgeMessage: (message: RelayMessage) => void;
  messagesDetailOpen: boolean;
  setMessagesDetailOpen: React.Dispatch<React.SetStateAction<boolean>>;
  messagesDetailTab: MessagesDetailTab;
  setMessagesDetailTab: React.Dispatch<React.SetStateAction<MessagesDetailTab>>;
  selectedRelayKind: RelayDestinationKind;
  selectedRelayId: string;
  relayThreadTitle: string;
  relayThreadSubtitle: string | null;
  relayThreadCount: number | null;
  selectedRelayDirectThread: RelayDirectThread | null;
  relayVoiceState: RelayVoiceState | null | undefined;
  visibleRelayMessages: RelayMessage[];
  relayTimelineViewportRef: React.RefObject<HTMLDivElement | null>;
  onRelayTimelineScroll: React.UIEventHandler<HTMLDivElement>;
  relayReplyTarget: RelayReplyTarget | null;
  setRelayReplyTarget: React.Dispatch<React.SetStateAction<RelayReplyTarget | null>>;
  relayContextReferences: RelayContextReference[];
  relayContextMessageIds: string[];
  setRelayContextMessageIds: React.Dispatch<React.SetStateAction<string[]>>;
  relayComposerRef: React.RefObject<HTMLTextAreaElement | null>;
  relayDraft: string;
  setRelayDraft: React.Dispatch<React.SetStateAction<string>>;
  relaySending: boolean;
  relayFeedback: string | null;
  relayComposerSelectionStart: number;
  setRelayComposerSelectionStart: React.Dispatch<React.SetStateAction<number>>;
  mergedRelayMessages: RelayMessage[];
  relayMentionMenuOpen: boolean;
  relayMentionSuggestions: RelayMentionCandidate[];
  relayMentionSelectionIndex: number;
  setRelayMentionSelectionIndex: React.Dispatch<React.SetStateAction<number>>;
  relayMentionDuplicateTitleCounts: Map<string, number>;
  applyRelayMentionSuggestion: (candidate: RelayMentionCandidate) => void;
  onRelaySend: () => void | Promise<void>;
  onToggleVoiceCapture: () => void | Promise<void>;
  onSetVoiceRepliesEnabled: (enabled: boolean) => void | Promise<void>;
  visibleAgentSession: AgentSessionInspector | null;
  agentSessionPending: boolean;
  agentSessionFeedback: string | null;
  agentSessionCopied: boolean;
  onCopyAgentSessionCommand: () => void | Promise<void>;
  onOpenAgentSession: () => void | Promise<void>;
  onPeekAgentSession: () => void;
  onOpenAgentSettings: (agentId: string, isProjectAgent: boolean) => void;
  desktopVoiceEnabled: boolean;
}) {
  return (
    <>
      {!isCollapsed ? (
        <MessagesSidebar
          sidebarWidth={sidebarWidth}
          styles={styles}
          messagesState={messagesState}
          messageThreads={messageThreads}
          selectedMessagesThread={selectedMessagesThread}
          onResizeStart={onResizeStart}
          onSelectMessageThread={onSelectMessageThread}
        />
      ) : null}

      <div className="flex-1 flex flex-col relative min-w-0" style={styles.surface}>
        {selectedMessagesThread?.kind === "internal" ? (
          <InternalThreadPane
            styles={styles}
            selectedMessagesThread={selectedMessagesThread}
            selectedMessagesInternalThread={selectedMessagesInternalThread}
            selectedMessagesInternalMessages={selectedMessagesInternalMessages}
            selectedMessagesInternalTarget={selectedMessagesInternalTarget}
            showAnnotations={showAnnotations}
            setShowAnnotations={setShowAnnotations}
            setMessagesDetailOpen={setMessagesDetailOpen}
            messagesDetailOpen={messagesDetailOpen}
            onRefresh={onRefresh}
            interAgentAgentLookup={interAgentAgentLookup}
            relayDirectLookup={relayDirectLookup}
            openAgentProfile={openAgentProfile}
            openAgentDirectMessage={openAgentDirectMessage}
            onNudgeMessage={onNudgeMessage}
          />
        ) : (
          <RelayThreadPane
            styles={styles}
            selectedRelayKind={selectedRelayKind}
            selectedRelayId={selectedRelayId}
            relayThreadTitle={relayThreadTitle}
            relayThreadSubtitle={relayThreadSubtitle}
            relayThreadCount={relayThreadCount}
            selectedRelayDirectThread={selectedRelayDirectThread}
            relayVoiceState={relayVoiceState}
            visibleRelayMessages={visibleRelayMessages}
            relayTimelineViewportRef={relayTimelineViewportRef}
            onRelayTimelineScroll={onRelayTimelineScroll}
            relayReplyTarget={relayReplyTarget}
            setRelayReplyTarget={setRelayReplyTarget}
            relayContextReferences={relayContextReferences}
            relayContextMessageIds={relayContextMessageIds}
            setRelayContextMessageIds={setRelayContextMessageIds}
            relayComposerRef={relayComposerRef}
            relayDraft={relayDraft}
            setRelayDraft={setRelayDraft}
            relaySending={relaySending}
            relayFeedback={relayFeedback}
            relayComposerSelectionStart={relayComposerSelectionStart}
            setRelayComposerSelectionStart={setRelayComposerSelectionStart}
            mergedRelayMessages={mergedRelayMessages}
            relayMentionMenuOpen={relayMentionMenuOpen}
            relayMentionSuggestions={relayMentionSuggestions}
            relayMentionSelectionIndex={relayMentionSelectionIndex}
            setRelayMentionSelectionIndex={setRelayMentionSelectionIndex}
            relayMentionDuplicateTitleCounts={relayMentionDuplicateTitleCounts}
            applyRelayMentionSuggestion={applyRelayMentionSuggestion}
            showAnnotations={showAnnotations}
            setShowAnnotations={setShowAnnotations}
            setMessagesDetailOpen={setMessagesDetailOpen}
            messagesDetailOpen={messagesDetailOpen}
            onRefresh={onRefresh}
            loadingWorkspace={loadingWorkspace}
            onRelaySend={onRelaySend}
            onToggleVoiceCapture={onToggleVoiceCapture}
            onSetVoiceRepliesEnabled={onSetVoiceRepliesEnabled}
            interAgentAgentLookup={interAgentAgentLookup}
            relayDirectLookup={relayDirectLookup}
            openAgentProfile={openAgentProfile}
            openAgentDirectMessage={openAgentDirectMessage}
            onNudgeMessage={onNudgeMessage}
            desktopVoiceEnabled={desktopVoiceEnabled}
          />
        )}
      </div>

      {messagesDetailOpen && selectedMessagesThread ? (
        <MessagesDetailDrawer
          styles={styles}
          messagesDetailWidth={messagesDetailWidth}
          selectedMessagesThread={selectedMessagesThread}
          selectedMessagesInternalThread={selectedMessagesInternalThread}
          selectedMessagesDetailAgentId={selectedMessagesDetailAgentId}
          selectedMessagesDetailAgent={selectedMessagesDetailAgent}
          selectedMessagesSessions={selectedMessagesSessions}
          selectedSession={selectedSession}
          setSelectedSession={setSelectedSession}
          formatDate={formatDate}
          interAgentAgents={interAgentAgents}
          messagesDetailTab={messagesDetailTab}
          setMessagesDetailTab={setMessagesDetailTab}
          setMessagesDetailOpen={setMessagesDetailOpen}
          onResizeStart={onMessagesDetailResizeStart}
          openAgentProfile={openAgentProfile}
          openAgentDirectMessage={openAgentDirectMessage}
          visibleAgentSession={visibleAgentSession}
          agentSessionPending={agentSessionPending}
          agentSessionFeedback={agentSessionFeedback}
          agentSessionCopied={agentSessionCopied}
          onCopyAgentSessionCommand={onCopyAgentSessionCommand}
          onOpenAgentSession={onOpenAgentSession}
          onPeekAgentSession={onPeekAgentSession}
          onOpenAgentSettings={onOpenAgentSettings}
        />
      ) : null}
    </>
  );
}

function MessagesSidebar({
  sidebarWidth,
  styles,
  messagesState,
  messageThreads,
  selectedMessagesThread,
  onResizeStart,
  onSelectMessageThread,
}: {
  sidebarWidth: number;
  styles: MessagesViewStyles;
  messagesState: MessagesState | null;
  messageThreads: MessagesThread[];
  selectedMessagesThread: MessagesThread | null;
  onResizeStart: React.MouseEventHandler<HTMLDivElement>;
  onSelectMessageThread: (thread: MessagesThread) => void;
}) {
  return (
    <div style={{ width: sidebarWidth, ...styles.sidebar }} className="relative flex flex-col h-full border-r shrink-0 z-10 overflow-hidden">
      <div className="absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={onResizeStart} />
      <div className="px-3 py-2.5 flex items-center justify-between">
        <div>
          <h1 className="text-[13px] font-semibold tracking-tight" style={styles.inkText}>{messagesState?.title ?? "Messages"}</h1>
          <div className="text-[10px] font-mono mt-0.5" style={styles.mutedText}>
            {messagesState?.subtitle ?? "Broker unavailable"}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {([
          ["inbox", "Inbox"],
          ["channels", "Channels"],
          ["agents", "Agents"],
          ["internal", "Internal"],
        ] as const).map(([groupId, label]) => {
          const threads = messageThreads.filter((thread) => thread.group === groupId);
          if (threads.length === 0) {
            return null;
          }

          return (
            <div key={groupId} className="mb-3 px-1.5">
              <div className="font-mono text-[9px] tracking-widest uppercase mb-1 px-1.5" style={styles.mutedText}>{label}</div>
              <div className="flex flex-col gap-px">
                {threads.map((thread) => {
                  const active = selectedMessagesThread?.id === thread.id;
                  const isDirectRelayThread = thread.kind === "relay" && thread.relayDestinationKind === "direct";
                  return (
                    <button
                      key={thread.id}
                      className={`os-rail-row flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer w-full text-left${active ? " os-rail-row-active" : ""}`}
                      style={active ? styles.activeItem : styles.mutedText}
                      onClick={() => onSelectMessageThread(thread)}
                    >
                      {thread.kind === "internal" ? (
                        <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                          <InterAgentIcon size={12} style={active ? { color: C.accent } : styles.mutedText} />
                        </div>
                      ) : isDirectRelayThread ? (
                        <div className="relative shrink-0">
                          <div
                            className={`os-rail-avatar w-4 h-4 rounded text-white flex items-center justify-center font-bold text-[8px] ${thread.reachable ? "" : "opacity-40 grayscale"}`}
                            style={{ backgroundColor: colorForIdentity(thread.relayDestinationId ?? thread.id) }}
                          >
                            {thread.title.charAt(0).toUpperCase()}
                          </div>
                          {thread.state ? (
                            <div
                              className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${relayPresenceDotClass(thread.state)}`}
                              style={{ border: `1px solid ${C.bg}` }}
                            ></div>
                          ) : null}
                        </div>
                      ) : (
                        <RelayRailIcon id={thread.relayDestinationId ?? thread.id} active={active} />
                      )}
                      <div className={`flex-1 min-w-0 ${thread.reachable ? "" : "opacity-50"}`}>
                        <div className="flex items-center gap-1.5">
                          <div className="font-medium text-[12px] truncate">{cleanDisplayTitle(thread.title)}</div>
                          {thread.state === "working" ? <TypingDots className="text-[var(--os-accent)]" /> : null}
                        </div>
                        <div className="text-[10px] truncate" style={styles.mutedText}>
                          {thread.preview ?? thread.subtitle ?? ""}
                        </div>
                      </div>
                      {typeof thread.count === "number" && thread.count > 0 ? (
                        <span className="os-row-count text-[9px] font-mono px-1 rounded" style={active ? styles.activePill : styles.tagBadge}>
                          {thread.count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InternalThreadPane({
  styles,
  selectedMessagesThread,
  selectedMessagesInternalThread,
  selectedMessagesInternalMessages,
  selectedMessagesInternalTarget,
  showAnnotations,
  setShowAnnotations,
  setMessagesDetailOpen,
  messagesDetailOpen,
  onRefresh,
  interAgentAgentLookup,
  relayDirectLookup,
  openAgentProfile,
  openAgentDirectMessage,
  onNudgeMessage,
}: {
  styles: MessagesViewStyles;
  selectedMessagesThread: MessagesThread;
  selectedMessagesInternalThread: InterAgentThread | null;
  selectedMessagesInternalMessages: RelayMessage[];
  selectedMessagesInternalTarget: InterAgentAgent | null;
  showAnnotations: boolean;
  setShowAnnotations: React.Dispatch<React.SetStateAction<boolean>>;
  setMessagesDetailOpen: React.Dispatch<React.SetStateAction<boolean>>;
  messagesDetailOpen: boolean;
  onRefresh: () => void | Promise<void>;
  interAgentAgentLookup: Map<string, InterAgentAgent>;
  relayDirectLookup: Map<string, RelayDirectThread>;
  openAgentProfile: (agentId: string) => void;
  openAgentDirectMessage: (agentId: string, draft?: string | null) => void;
  onNudgeMessage: (message: RelayMessage) => void;
}) {
  return (
    <>
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0 gap-4" style={{ ...styles.surface, borderBottomColor: C.border }}>
        <div className="flex items-center gap-2 min-w-0">
          <InterAgentIcon size={14} style={styles.mutedText} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-[13px] font-semibold tracking-tight truncate" style={styles.inkText}>
                {selectedMessagesInternalThread?.title ?? selectedMessagesThread.title ?? "Internal"}
              </h2>
              {selectedMessagesInternalThread ? (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={styles.tagBadge}>
                  {selectedMessagesInternalThread.messageCount}
                </span>
              ) : null}
            </div>
            <div className="text-[10px] truncate mt-0.5" style={styles.mutedText}>
              {selectedMessagesInternalThread?.subtitle ?? selectedMessagesThread.subtitle ?? "Agent-to-agent coordination"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedMessagesInternalTarget ? (
            <button
              className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ color: C.ink }}
              onClick={() => openAgentDirectMessage(selectedMessagesInternalTarget.id)}
            >
              <MessageSquare size={11} />
              <span>Message Agent</span>
            </button>
          ) : null}
          <button
            onClick={() => setShowAnnotations(!showAnnotations)}
            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
            style={showAnnotations ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
          >
            Annotations <span className="font-mono uppercase">{showAnnotations ? "On" : "Off"}</span>
          </button>
          <button className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded" style={{ color: C.ink }} onClick={() => void onRefresh()}>
            Sync
          </button>
          <button
            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
            style={messagesDetailOpen ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
            onClick={() => setMessagesDetailOpen((current) => !current)}
          >
            Details
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
        {selectedMessagesInternalMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
              <InterAgentIcon size={24} style={{ color: C.accent }} />
            </div>
            <h3 className="text-[15px] font-medium mb-1" style={styles.inkText}>No internal traffic yet</h3>
            <p className="text-[13px] max-w-sm" style={styles.mutedText}>
              This thread exists, but no visible agent-to-agent messages have been captured yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <RelayTimeline
              messages={selectedMessagesInternalMessages}
              showAnnotations={showAnnotations}
              showStatusMessages={false}
              inkStyle={styles.inkText}
              mutedStyle={styles.mutedText}
              tagStyle={styles.tagBadge}
              annotStyle={styles.annotBadge}
              agentLookup={interAgentAgentLookup}
              directThreadLookup={relayDirectLookup}
              onOpenAgentProfile={openAgentProfile}
              onOpenAgentChat={openAgentDirectMessage}
              onNudgeMessage={onNudgeMessage}
            />
          </div>
        )}
      </div>

      <div className="px-4 py-3 shrink-0" style={styles.surface}>
        <div className="rounded-lg border px-3 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <div className="text-[9px] font-mono uppercase tracking-widest" style={styles.mutedText}>Internal Thread</div>
          <div className="text-[11px] mt-1 leading-[1.6]" style={styles.mutedText}>
            Internal coordination is read-only here. Open a direct conversation with an agent if you want to intervene.
          </div>
          {selectedMessagesInternalTarget ? (
            <button
              type="button"
              onClick={() => openAgentDirectMessage(selectedMessagesInternalTarget.id)}
              className="mt-3 os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded"
              style={{ color: C.ink }}
            >
              <AtSign size={11} />
              Open Direct Message
            </button>
          ) : null}
        </div>
      </div>

      <div className="h-7 border-t flex items-center px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
        <span className="text-[9px] font-mono" style={styles.mutedText}>Read-only internal coordination thread inside Messages</span>
      </div>
    </>
  );
}

function RelayThreadPane({
  styles,
  selectedRelayKind,
  selectedRelayId,
  relayThreadTitle,
  relayThreadSubtitle,
  relayThreadCount,
  selectedRelayDirectThread,
  relayVoiceState,
  visibleRelayMessages,
  relayTimelineViewportRef,
  onRelayTimelineScroll,
  relayReplyTarget,
  setRelayReplyTarget,
  relayContextReferences,
  relayContextMessageIds,
  setRelayContextMessageIds,
  relayComposerRef,
  relayDraft,
  setRelayDraft,
  relaySending,
  relayFeedback,
  relayComposerSelectionStart,
  setRelayComposerSelectionStart,
  mergedRelayMessages,
  relayMentionMenuOpen,
  relayMentionSuggestions,
  relayMentionSelectionIndex,
  setRelayMentionSelectionIndex,
  relayMentionDuplicateTitleCounts,
  applyRelayMentionSuggestion,
  showAnnotations,
  setShowAnnotations,
  setMessagesDetailOpen,
  messagesDetailOpen,
  onRefresh,
  loadingWorkspace,
  onRelaySend,
  onToggleVoiceCapture,
  onSetVoiceRepliesEnabled,
  interAgentAgentLookup,
  relayDirectLookup,
  openAgentProfile,
  openAgentDirectMessage,
  onNudgeMessage,
  desktopVoiceEnabled,
}: {
  styles: MessagesViewStyles;
  selectedRelayKind: RelayDestinationKind;
  selectedRelayId: string;
  relayThreadTitle: string;
  relayThreadSubtitle: string | null;
  relayThreadCount: number | null;
  selectedRelayDirectThread: RelayDirectThread | null;
  relayVoiceState: RelayVoiceState | null | undefined;
  visibleRelayMessages: RelayMessage[];
  relayTimelineViewportRef: React.RefObject<HTMLDivElement | null>;
  onRelayTimelineScroll: React.UIEventHandler<HTMLDivElement>;
  relayReplyTarget: RelayReplyTarget | null;
  setRelayReplyTarget: React.Dispatch<React.SetStateAction<RelayReplyTarget | null>>;
  relayContextReferences: RelayContextReference[];
  relayContextMessageIds: string[];
  setRelayContextMessageIds: React.Dispatch<React.SetStateAction<string[]>>;
  relayComposerRef: React.RefObject<HTMLTextAreaElement | null>;
  relayDraft: string;
  setRelayDraft: React.Dispatch<React.SetStateAction<string>>;
  relaySending: boolean;
  relayFeedback: string | null;
  relayComposerSelectionStart: number;
  setRelayComposerSelectionStart: React.Dispatch<React.SetStateAction<number>>;
  mergedRelayMessages: RelayMessage[];
  relayMentionMenuOpen: boolean;
  relayMentionSuggestions: RelayMentionCandidate[];
  relayMentionSelectionIndex: number;
  setRelayMentionSelectionIndex: React.Dispatch<React.SetStateAction<number>>;
  relayMentionDuplicateTitleCounts: Map<string, number>;
  applyRelayMentionSuggestion: (candidate: RelayMentionCandidate) => void;
  showAnnotations: boolean;
  setShowAnnotations: React.Dispatch<React.SetStateAction<boolean>>;
  setMessagesDetailOpen: React.Dispatch<React.SetStateAction<boolean>>;
  messagesDetailOpen: boolean;
  onRefresh: () => void | Promise<void>;
  loadingWorkspace: boolean;
  onRelaySend: () => void | Promise<void>;
  onToggleVoiceCapture: () => void | Promise<void>;
  onSetVoiceRepliesEnabled: (enabled: boolean) => void | Promise<void>;
  interAgentAgentLookup: Map<string, InterAgentAgent>;
  relayDirectLookup: Map<string, RelayDirectThread>;
  openAgentProfile: (agentId: string) => void;
  openAgentDirectMessage: (agentId: string, draft?: string | null) => void;
  onNudgeMessage: (message: RelayMessage) => void;
  desktopVoiceEnabled: boolean;
}) {
  const lastVisibleMessageAt = visibleRelayMessages.at(-1)?.createdAt ?? null;
  const [workingIndicatorNow, setWorkingIndicatorNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (selectedRelayDirectThread?.state !== "working") {
      return;
    }

    setWorkingIndicatorNow(Date.now());
    const intervalId = window.setInterval(() => {
      setWorkingIndicatorNow(Date.now());
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [
    lastVisibleMessageAt,
    selectedRelayDirectThread?.activeTask,
    selectedRelayDirectThread?.id,
    selectedRelayDirectThread?.state,
    selectedRelayDirectThread?.statusDetail,
  ]);

  const workingSilenceMs = selectedRelayDirectThread?.state === "working" && lastVisibleMessageAt
    ? Math.max(0, workingIndicatorNow - lastVisibleMessageAt)
    : 0;
  const workingSilenceLabel = workingSilenceMs > 0 ? formatWorkingSilence(workingSilenceMs) : null;
  const showStallHint = workingSilenceMs >= 90_000;
  const workingDetail = selectedRelayDirectThread?.activeTask
    ?? selectedRelayDirectThread?.statusDetail
    ?? relayThreadSubtitle
    ?? "Agent is still working.";
  const showDirectThreadWaitingState = !loadingWorkspace
    && visibleRelayMessages.length === 0
    && selectedRelayKind === "direct";
  const emptyStateTitle = loadingWorkspace
    ? "Loading relay workspace"
    : showDirectThreadWaitingState
      ? "Waiting for first relay message"
      : "No relay traffic yet";
  const emptyStateDetail = loadingWorkspace
    ? "Fetching threads, messages, and agent state for this workspace."
    : showDirectThreadWaitingState
      ? selectedRelayDirectThread?.activeTask
        ?? selectedRelayDirectThread?.statusDetail
        ?? "This direct lane is open. Send a message or wait for the agent to speak first."
      : "Send a message into this lane to wake an agent or start a broker-backed conversation.";

  return (
    <>
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0 gap-4" style={{ ...styles.surface, borderBottomColor: C.border }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0">
            {selectedRelayKind === "direct" ? (
              <AtSign size={14} style={styles.mutedText} />
            ) : (
              <RelayRailIcon id={selectedRelayId} active={false} size={14} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-[13px] font-semibold tracking-tight truncate" style={styles.inkText}>{relayThreadTitle}</h2>
              {relayThreadCount ? (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0" style={styles.tagBadge}>
                  {relayThreadCount}
                </span>
              ) : null}
              {selectedRelayDirectThread ? <RelayPresenceBadge thread={selectedRelayDirectThread} /> : null}
            </div>
            {relayThreadSubtitle ? (
              <div className="text-[10px] truncate mt-0.5" style={styles.mutedText}>
                {relayThreadSubtitle}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedRelayDirectThread ? (
            <button
              className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ color: C.ink }}
              onClick={() => openAgentProfile(selectedRelayDirectThread.id)}
            >
              <Bot size={11} />
              <span>Agent</span>
            </button>
          ) : null}
          <button
            onClick={() => setShowAnnotations(!showAnnotations)}
            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
            style={showAnnotations ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
          >
            Annotations <span className="font-mono uppercase">{showAnnotations ? "On" : "Off"}</span>
          </button>
          {desktopVoiceEnabled ? (
            <>
              <button
                className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
                style={relayVoiceState?.isCapturing ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
                onClick={() => void onToggleVoiceCapture()}
                title={relayVoiceState?.detail ?? undefined}
              >
                {relayVoiceState?.captureTitle ?? "Capture"} <span className="font-mono uppercase" style={{ color: C.accent }}>{relayVoiceState?.captureState ?? "Off"}</span>
              </button>
              <button
                className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
                style={relayVoiceState?.repliesEnabled ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
                onClick={() => void onSetVoiceRepliesEnabled(!(relayVoiceState?.repliesEnabled ?? false))}
                title={relayVoiceState?.detail ?? undefined}
              >
                Playback <span className="font-mono uppercase" style={{ color: C.accent }}>{relayVoiceState?.speaking ? "Speaking" : relayVoiceState?.repliesEnabled ? "On" : "Off"}</span>
              </button>
            </>
          ) : null}
          <button className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded" style={{ color: C.ink }} onClick={() => void onRefresh()}>
            Sync
          </button>
          <button
            className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
            style={messagesDetailOpen ? { backgroundColor: C.accentBg, color: C.accent } : { color: C.ink }}
            onClick={() => setMessagesDetailOpen((current) => !current)}
          >
            Details
          </button>
        </div>
      </div>

      <div
        ref={relayTimelineViewportRef}
        className="flex-1 overflow-y-auto px-4 py-3 pb-6"
        onScroll={onRelayTimelineScroll}
      >
        {visibleRelayMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: C.accentBg }}>
              {loadingWorkspace || showDirectThreadWaitingState ? (
                <Spinner className="text-[22px]" style={{ color: C.accent }} />
              ) : (
                <MessageSquare size={24} style={{ color: C.accent }} />
              )}
            </div>
            <h3 className="text-[15px] font-medium mb-1" style={styles.inkText}>{emptyStateTitle}</h3>
            <p className="text-[13px] max-w-sm" style={styles.mutedText}>
              {emptyStateDetail}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <RelayTimeline
              messages={visibleRelayMessages}
              showAnnotations={showAnnotations}
              showStatusMessages={selectedRelayKind === "channel" && selectedRelayId === "system"}
              inkStyle={styles.inkText}
              mutedStyle={styles.mutedText}
              tagStyle={styles.tagBadge}
              annotStyle={styles.annotBadge}
              agentLookup={interAgentAgentLookup}
              directThreadLookup={relayDirectLookup}
              onOpenAgentProfile={openAgentProfile}
              onOpenAgentChat={openAgentDirectMessage}
              onNudgeMessage={onNudgeMessage}
            />
          </div>
        )}
      </div>

      {selectedRelayDirectThread?.state === "working" ? (
        <div className="px-4 pb-1 shrink-0" style={styles.surface}>
          <div
            className="rounded-xl border px-3 py-2.5 flex items-start justify-between gap-3"
            style={{
              borderColor: showStallHint ? "rgba(245,158,11,0.32)" : C.border,
              backgroundColor: showStallHint ? "rgba(245,158,11,0.08)" : C.bg,
            }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <TypingDots className="text-[var(--os-accent)] shrink-0" />
                <span className="text-[11px] font-medium truncate" style={styles.inkText}>
                  {showStallHint ? "Still working" : "Working"}
                </span>
                {workingSilenceLabel ? (
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                    style={showStallHint ? {
                      color: "#b45309",
                      backgroundColor: "rgba(245,158,11,0.14)",
                    } : styles.tagBadge}
                  >
                    {showStallHint ? `No update for ${workingSilenceLabel}` : `${workingSilenceLabel} ago`}
                  </span>
                ) : null}
              </div>
              <div className="text-[10px] mt-1 truncate" style={styles.mutedText}>
                {workingDetail}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <RelayComposer
        styles={styles}
        selectedRelayKind={selectedRelayKind}
        selectedRelayId={selectedRelayId}
        relayVoiceState={relayVoiceState}
        relayReplyTarget={relayReplyTarget}
        setRelayReplyTarget={setRelayReplyTarget}
        relayContextReferences={relayContextReferences}
        relayContextMessageIds={relayContextMessageIds}
        setRelayContextMessageIds={setRelayContextMessageIds}
        relayComposerRef={relayComposerRef}
        relayDraft={relayDraft}
        setRelayDraft={setRelayDraft}
        relaySending={relaySending}
        relayComposerSelectionStart={relayComposerSelectionStart}
        setRelayComposerSelectionStart={setRelayComposerSelectionStart}
        mergedRelayMessages={mergedRelayMessages}
        relayMentionMenuOpen={relayMentionMenuOpen}
        relayMentionSuggestions={relayMentionSuggestions}
        relayMentionSelectionIndex={relayMentionSelectionIndex}
        setRelayMentionSelectionIndex={setRelayMentionSelectionIndex}
        relayMentionDuplicateTitleCounts={relayMentionDuplicateTitleCounts}
        applyRelayMentionSuggestion={applyRelayMentionSuggestion}
        onRelaySend={onRelaySend}
        desktopVoiceEnabled={desktopVoiceEnabled}
      />

      <div className="h-7 border-t flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: C.bg, borderTopColor: C.border }}>
        <div className="flex items-center gap-3 text-[9px] font-mono" style={styles.mutedText}>
          <span className="flex items-center gap-1"><span style={styles.inkText}>@</span> mention agents</span>
          {relayMentionMenuOpen ? (
            <>
              <span className="w-px h-3" style={{ backgroundColor: C.border }}></span>
              <span>↑↓ select · ↵ or Tab insert</span>
            </>
          ) : null}
          <span className="w-px h-3" style={{ backgroundColor: C.border }}></span>
          <span className="flex items-center gap-1">
            <kbd className="font-sans px-1 py-0.5 rounded border text-[9px] font-medium leading-none shadow-sm" style={styles.kbd}>Cmd+Enter</kbd> send
          </span>
          {relayFeedback ? (
            <>
              <span className="w-px h-3" style={{ backgroundColor: C.border }}></span>
              <span>{relayFeedback}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-widest" style={styles.mutedText}>
          {selectedRelayDirectThread?.state === "offline" ? (
            <span>{selectedRelayDirectThread.statusLabel}</span>
          ) : null}
        </div>
      </div>
    </>
  );
}

function RelayComposer({
  styles,
  selectedRelayKind,
  selectedRelayId,
  relayVoiceState,
  relayReplyTarget,
  setRelayReplyTarget,
  relayContextReferences,
  relayContextMessageIds,
  setRelayContextMessageIds,
  relayComposerRef,
  relayDraft,
  setRelayDraft,
  relaySending,
  relayComposerSelectionStart,
  setRelayComposerSelectionStart,
  mergedRelayMessages,
  relayMentionMenuOpen,
  relayMentionSuggestions,
  relayMentionSelectionIndex,
  setRelayMentionSelectionIndex,
  relayMentionDuplicateTitleCounts,
  applyRelayMentionSuggestion,
  onRelaySend,
  desktopVoiceEnabled,
}: {
  styles: MessagesViewStyles;
  selectedRelayKind: RelayDestinationKind;
  selectedRelayId: string;
  relayVoiceState: RelayVoiceState | null | undefined;
  relayReplyTarget: RelayReplyTarget | null;
  setRelayReplyTarget: React.Dispatch<React.SetStateAction<RelayReplyTarget | null>>;
  relayContextReferences: RelayContextReference[];
  relayContextMessageIds: string[];
  setRelayContextMessageIds: React.Dispatch<React.SetStateAction<string[]>>;
  relayComposerRef: React.RefObject<HTMLTextAreaElement | null>;
  relayDraft: string;
  setRelayDraft: React.Dispatch<React.SetStateAction<string>>;
  relaySending: boolean;
  relayComposerSelectionStart: number;
  setRelayComposerSelectionStart: React.Dispatch<React.SetStateAction<number>>;
  mergedRelayMessages: RelayMessage[];
  relayMentionMenuOpen: boolean;
  relayMentionSuggestions: RelayMentionCandidate[];
  relayMentionSelectionIndex: number;
  setRelayMentionSelectionIndex: React.Dispatch<React.SetStateAction<number>>;
  relayMentionDuplicateTitleCounts: Map<string, number>;
  applyRelayMentionSuggestion: (candidate: RelayMentionCandidate) => void;
  onRelaySend: () => void | Promise<void>;
  desktopVoiceEnabled: boolean;
}) {
  return (
    <div className="px-4 py-3 shrink-0" style={styles.surface}>
      {relayReplyTarget ? (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <div className="min-w-0">
            <div className="text-[9px] font-mono uppercase tracking-widest" style={styles.mutedText}>
              Replying to {relayReplyTarget.authorName} · {shortMessageRef(relayReplyTarget.messageId)}
            </div>
            <div className="text-[11px] truncate mt-1" style={styles.mutedText}>{relayReplyTarget.preview}</div>
          </div>
          <button
            type="button"
            onClick={() => setRelayReplyTarget(null)}
            className="shrink-0 rounded p-1 transition-opacity hover:opacity-70"
            style={styles.mutedText}
            title="Clear reply context"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
      {relayContextReferences.length > 0 ? (
        <div className="mb-2 space-y-2">
          {relayContextReferences.map((reference) => (
            <div
              key={reference.messageId}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              style={{ borderColor: C.border, backgroundColor: C.bg }}
            >
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={styles.mutedText}>
                  Context · {reference.authorName} · {shortMessageRef(reference.messageId)}
                </div>
                <div className="text-[11px] truncate mt-1" style={styles.mutedText}>{reference.preview}</div>
              </div>
              <button
                type="button"
                onClick={() => setRelayContextMessageIds((current) => current.filter((messageId) => messageId !== reference.messageId))}
                className="shrink-0 rounded p-1 transition-opacity hover:opacity-70"
                style={styles.mutedText}
                title="Clear referenced context"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="relative">
        {relayMentionMenuOpen ? (
          <div
            className="absolute inset-x-0 bottom-full mb-2 rounded-xl border shadow-lg overflow-hidden z-20"
            style={{ backgroundColor: C.surface, borderColor: C.border, boxShadow: C.shadowLg }}
          >
            <div className="px-3 py-2 border-b text-[9px] font-mono uppercase tracking-widest" style={{ ...styles.mutedText, borderColor: C.border }}>
              Mention an agent
            </div>
            <div className="max-h-64 overflow-y-auto">
              {relayMentionSuggestions.map((candidate, index) => {
                const active = index === relayMentionSelectionIndex;
                const workspaceLabel = mentionWorkspaceLabel(candidate);
                const worktreeLabel = mentionWorktreeLabel(candidate);
                const duplicateTitle = (relayMentionDuplicateTitleCounts.get(candidate.title) ?? 0) > 1;
                const showWorkspace = duplicateTitle || Boolean(candidate.harness) || Boolean(worktreeLabel);
                const showWorktree = Boolean(worktreeLabel && worktreeLabel !== workspaceLabel);
                return (
                  <button
                    key={candidate.agentId}
                    type="button"
                    className="w-full flex items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors"
                    style={{
                      backgroundColor: active ? C.bg : "transparent",
                      color: C.ink,
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyRelayMentionSuggestion(candidate);
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="text-[11px] font-medium truncate">{candidate.title}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={styles.tagBadge}>
                          {candidate.statusLabel}
                        </span>
                        {showWorkspace && workspaceLabel ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={styles.tagBadge}>
                            {workspaceLabel}
                          </span>
                        ) : null}
                        {candidate.harness ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={styles.tagBadge}>
                            {candidate.harness}
                          </span>
                        ) : null}
                        {showWorktree && worktreeLabel ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={styles.tagBadge}>
                            {worktreeLabel}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] mt-1 truncate" style={styles.mutedText}>
                        {candidate.mentionToken}
                        {duplicateTitle && candidate.subtitle ? ` · ${compactHomePath(candidate.subtitle) ?? candidate.subtitle}` : ""}
                      </div>
                    </div>
                    <span className="text-[9px] font-mono shrink-0" style={styles.mutedText}>
                      {active ? "↵" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="border rounded flex items-center px-2 py-1 transition-all focus-within:ring-1" style={{ backgroundColor: C.bg, borderColor: C.border }}>
          <textarea
            ref={relayComposerRef}
            className="flex-1 bg-transparent outline-none resize-none h-[20px] min-h-[20px] max-h-[80px] text-[12px] leading-tight py-0.5"
            style={{ color: C.ink }}
            placeholder={placeholderForDestination(selectedRelayKind, selectedRelayId)}
            rows={1}
            value={relayDraft}
            onChange={(event) => {
              const nextDraft = ingestRelayMessageRefs(
                event.currentTarget.value,
                mergedRelayMessages,
                relayContextMessageIds,
              );
              setRelayDraft(nextDraft.body);
              setRelayComposerSelectionStart(event.currentTarget.selectionStart ?? nextDraft.body.length);
              if (nextDraft.nextReferenceMessageIds !== relayContextMessageIds) {
                setRelayContextMessageIds(nextDraft.nextReferenceMessageIds);
              }
            }}
            onClick={(event) => setRelayComposerSelectionStart(event.currentTarget.selectionStart ?? relayDraft.length)}
            onKeyUp={(event) => setRelayComposerSelectionStart(event.currentTarget.selectionStart ?? relayDraft.length)}
            onSelect={(event) => setRelayComposerSelectionStart(event.currentTarget.selectionStart ?? relayDraft.length)}
            onKeyDown={(event) => {
              if (relayMentionMenuOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setRelayMentionSelectionIndex((current) => (
                    relayMentionSuggestions.length === 0 ? 0 : (current + 1) % relayMentionSuggestions.length
                  ));
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setRelayMentionSelectionIndex((current) => (
                    relayMentionSuggestions.length === 0
                      ? 0
                      : (current - 1 + relayMentionSuggestions.length) % relayMentionSuggestions.length
                  ));
                  return;
                }
                if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey) || event.key === "Tab") {
                  event.preventDefault();
                  const candidate = relayMentionSuggestions[relayMentionSelectionIndex] ?? relayMentionSuggestions[0];
                  if (candidate) {
                    applyRelayMentionSuggestion(candidate);
                  }
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRelayComposerSelectionStart(relayDraft.length);
                  return;
                }
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void onRelaySend();
              }
            }}
          />
          <div className="shrink-0 flex items-center gap-1 ml-2">
            {desktopVoiceEnabled ? (
              <button className="p-1 opacity-50 cursor-default transition-opacity" style={styles.mutedText} title={relayVoiceState?.detail ?? "Voice unavailable in Electron"}>
                <Mic size={12} />
              </button>
            ) : null}
            <button
              type="button"
              className="shrink-0 flex h-[26px] w-[26px] items-center justify-center rounded-md border transition-opacity hover:opacity-85 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: C.border, backgroundColor: C.surface, color: C.ink }}
              onClick={() => void onRelaySend()}
              disabled={relaySending || !relayDraft.trim()}
              title="Send"
              aria-label="Send message"
            >
              <SendHorizontal size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessagesDetailDrawer({
  styles,
  messagesDetailWidth,
  selectedMessagesThread,
  selectedMessagesInternalThread,
  selectedMessagesDetailAgentId,
  selectedMessagesDetailAgent,
  selectedMessagesSessions,
  selectedSession,
  setSelectedSession,
  formatDate,
  interAgentAgents,
  messagesDetailTab,
  setMessagesDetailTab,
  setMessagesDetailOpen,
  onResizeStart,
  openAgentProfile,
  openAgentDirectMessage,
  visibleAgentSession,
  agentSessionPending,
  agentSessionFeedback,
  agentSessionCopied,
  onCopyAgentSessionCommand,
  onOpenAgentSession,
  onPeekAgentSession,
  onOpenAgentSettings,
}: {
  styles: MessagesViewStyles;
  messagesDetailWidth: number;
  selectedMessagesThread: MessagesThread;
  selectedMessagesInternalThread: InterAgentThread | null;
  selectedMessagesDetailAgentId: string | null;
  selectedMessagesDetailAgent: InterAgentAgent | null;
  selectedMessagesSessions: SessionMetadata[];
  selectedSession: SessionMetadata | null;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionMetadata | null>>;
  formatDate: (value: string) => string;
  interAgentAgents: InterAgentAgent[];
  messagesDetailTab: MessagesDetailTab;
  setMessagesDetailTab: React.Dispatch<React.SetStateAction<MessagesDetailTab>>;
  setMessagesDetailOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onResizeStart: React.MouseEventHandler<HTMLDivElement>;
  openAgentProfile: (agentId: string) => void;
  openAgentDirectMessage: (agentId: string, draft?: string | null) => void;
  visibleAgentSession: AgentSessionInspector | null;
  agentSessionPending: boolean;
  agentSessionFeedback: string | null;
  agentSessionCopied: boolean;
  onCopyAgentSessionCommand: () => void | Promise<void>;
  onOpenAgentSession: () => void | Promise<void>;
  onPeekAgentSession: () => void;
  onOpenAgentSettings: (agentId: string, isProjectAgent: boolean) => void;
}) {
  return (
    <div
      className="relative border-l shrink-0 overflow-y-auto flex flex-col"
      style={{ width: messagesDetailWidth, ...styles.surface, borderLeftColor: C.border }}
    >
      <div className="absolute left-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 transition-colors" onMouseDown={onResizeStart} />
      <div className="px-4 py-3 border-b" style={{ borderBottomColor: C.border }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono tracking-widest uppercase" style={styles.mutedText}>Thread Details</div>
            <div className="text-[13px] font-semibold mt-1 truncate" style={styles.inkText}>
              {selectedMessagesThread.kind === "internal"
                ? (selectedMessagesInternalThread?.title ?? selectedMessagesThread.title)
                : cleanDisplayTitle(selectedMessagesThread.title)}
            </div>
            <div className="text-[10px] mt-1 line-clamp-2" style={styles.mutedText}>
              {selectedMessagesThread.preview ?? selectedMessagesThread.subtitle ?? "Context for the selected thread."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMessagesDetailOpen(false)}
            className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded shrink-0"
            style={{ color: C.ink }}
            title="Hide details"
          >
            <X size={11} />
            <span>Hide</span>
          </button>
        </div>
        <div className="flex items-center gap-1 mt-3">
          {([
            ["overview", "Overview"],
            ["live", "Live"],
            ["history", "History"],
          ] as const).filter(([id]) => id !== "live" || Boolean(selectedMessagesDetailAgentId)).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors"
              style={messagesDetailTab === id ? styles.activeItem : styles.mutedText}
              onClick={() => setMessagesDetailTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 flex-1 space-y-4">
        {messagesDetailTab === "overview" ? (
          <>
            {selectedMessagesDetailAgent ? (
              <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg text-white flex items-center justify-center text-[13px] font-bold"
                    style={{ backgroundColor: colorForIdentity(selectedMessagesDetailAgent.id) }}
                  >
                    {selectedMessagesDetailAgent.title.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-[13px] font-semibold truncate" style={styles.inkText}>{selectedMessagesDetailAgent.title}</div>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={selectedMessagesDetailAgent.state === "working" ? styles.activePill : styles.tagBadge}>
                        {selectedMessagesDetailAgent.statusLabel}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1 line-clamp-2" style={styles.mutedText}>
                      {selectedMessagesDetailAgent.summary ?? selectedMessagesDetailAgent.statusDetail ?? "No summary yet."}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
                  <div>
                    <div style={styles.mutedText}>Harness</div>
                    <div style={styles.inkText}>{selectedMessagesDetailAgent.harness ?? "Unknown"}</div>
                  </div>
                  <div>
                    <div style={styles.mutedText}>Threads</div>
                    <div style={styles.inkText}>{selectedMessagesDetailAgent.threadCount}</div>
                  </div>
                  <div>
                    <div style={styles.mutedText}>Workspace</div>
                    <div className="truncate" style={styles.inkText}>{selectedMessagesDetailAgent.projectRoot ?? selectedMessagesDetailAgent.cwd ?? "Unbound"}</div>
                  </div>
                  <div>
                    <div style={styles.mutedText}>Last Chat</div>
                    <div style={styles.inkText}>{selectedMessagesDetailAgent.lastChatLabel ?? "No recent chat"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => openAgentDirectMessage(selectedMessagesDetailAgent.id)}
                    className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded"
                    style={{ color: C.ink }}
                  >
                    <MessageSquare size={11} />
                    Message
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMessagesDetailTab("live");
                      onPeekAgentSession();
                    }}
                    className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded"
                    style={{ color: C.ink }}
                  >
                    <Eye size={11} />
                    Peek
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAgentSettings(selectedMessagesDetailAgent.id, selectedMessagesDetailAgent.profileKind === "project")}
                    className="os-toolbar-button flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded"
                    style={{ color: C.ink }}
                  >
                    <Settings size={11} />
                    Settings
                  </button>
                </div>
              </section>
            ) : null}

            {selectedMessagesThread.kind === "internal" && selectedMessagesInternalThread ? (
              <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <div className="text-[10px] font-mono tracking-widest uppercase" style={styles.mutedText}>Participants</div>
                <div className="flex flex-col gap-2 mt-3">
                  {selectedMessagesInternalThread.participants.map((participant) => (
                    <div key={participant.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium truncate" style={styles.inkText}>{participant.title}</div>
                        <div className="text-[10px] truncate" style={styles.mutedText}>{participant.role ?? participant.id}</div>
                      </div>
                      {interAgentAgents.some((agent) => agent.id === participant.id) ? (
                        <button
                          type="button"
                          onClick={() => openAgentProfile(participant.id)}
                          className="text-[10px] font-medium hover:opacity-80"
                          style={{ color: C.accent }}
                        >
                          Open
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {messagesDetailTab === "live" ? (
          <section className="rounded-xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <div className="px-3 py-3 border-b flex items-center justify-between gap-2" style={{ borderBottomColor: C.border }}>
              <div>
                <div className="text-[10px] font-mono tracking-widest uppercase" style={styles.mutedText}>Live Session</div>
                <div className="text-[11px] mt-1" style={styles.mutedText}>Runtime, tmux, or log tail for the selected agent.</div>
              </div>
              <div className="flex items-center gap-2">
                {visibleAgentSession?.commandLabel ? (
                  <button
                    type="button"
                    onClick={() => void onCopyAgentSessionCommand()}
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                    style={{ color: C.ink }}
                  >
                    <Copy size={11} />
                    {agentSessionCopied ? "Copied" : "Copy"}
                  </button>
                ) : null}
                {selectedMessagesDetailAgentId ? (
                  <button
                    type="button"
                    onClick={() => void onOpenAgentSession()}
                    className="os-toolbar-button flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                    style={{ color: C.ink }}
                  >
                    <ExternalLink size={11} />
                    Open
                  </button>
                ) : null}
              </div>
            </div>
            <div className="p-3">
              {agentSessionPending ? (
                <div className="flex items-center gap-2 text-[11px]" style={styles.mutedText}>
                  <Spinner className="text-[12px]" />
                  Loading live session…
                </div>
              ) : visibleAgentSession?.body ? (
                <pre className="max-h-[280px] overflow-y-auto text-[11px] leading-[1.55] whitespace-pre-wrap break-words font-mono" style={{ color: C.termFg, backgroundColor: C.termBg, padding: "12px", borderRadius: C.radiusMd as string }}>
                  {visibleAgentSession.body}
                </pre>
              ) : (
                <div className="text-[11px] leading-[1.6]" style={styles.mutedText}>
                  {agentSessionFeedback ?? "No live session output is available for this thread yet."}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {messagesDetailTab === "history" ? (
          <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono tracking-widest uppercase" style={styles.mutedText}>Recent History</div>
                <div className="text-[11px] mt-1" style={styles.mutedText}>Recent sessions tied to this thread or agent.</div>
              </div>
              {selectedSession ? (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={styles.tagBadge}>selected</span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {selectedMessagesSessions.length > 0 ? selectedMessagesSessions.slice(0, 8).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedSession(session)}
                  className="w-full rounded-lg border px-3 py-3 text-left transition-opacity hover:opacity-90"
                  style={{ borderColor: C.border, backgroundColor: selectedSession?.id === session.id ? C.surface : C.bg }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium truncate" style={styles.inkText}>{session.title}</div>
                      <div className="text-[10px] mt-1" style={styles.mutedText}>{session.project} · {session.messageCount} messages</div>
                      <div className="text-[10px] mt-2 line-clamp-2" style={styles.mutedText}>{session.preview}</div>
                    </div>
                    <span className="text-[10px] font-mono shrink-0" style={styles.mutedText}>{formatDate(session.lastModified)}</span>
                  </div>
                </button>
              )) : (
                <div className="text-[11px] leading-[1.6]" style={styles.mutedText}>
                  No recent session history is linked to this thread yet.
                </div>
              )}
            </div>
          </section>
        ) : null}

        {selectedSession ? (
          <section className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <div className="text-[10px] font-mono tracking-widest uppercase" style={styles.mutedText}>Selected Session</div>
            <div className="text-[12px] font-medium mt-2" style={styles.inkText}>{selectedSession.title}</div>
            <div className="text-[10px] mt-1" style={styles.mutedText}>{selectedSession.project} · {selectedSession.agent}</div>
            <div className="text-[11px] mt-2 leading-[1.6]" style={styles.mutedText}>{selectedSession.preview}</div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function formatWorkingSilence(durationMs: number) {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes >= 1) {
    return `${minutes}m`;
  }

  const seconds = Math.max(1, Math.floor(durationMs / 1000));
  return `${seconds}s`;
}

function placeholderForDestination(kind: RelayDestinationKind, id: string) {
  if (kind === "direct") {
    return "Message direct thread...";
  }
  if (kind === "filter" && id === "coordination") {
    return "Message #shared-channel or @agent...";
  }
  if (kind === "channel" && id === "voice") {
    return "Message #voice...";
  }
  if (kind === "channel" && id === "system") {
    return "Message #system...";
  }
  return "Message #shared-channel...";
}

function mentionWorkspaceLabel(candidate: RelayMentionCandidate) {
  return pathLeaf(candidate.subtitle) ?? candidate.workspaceQualifier ?? null;
}

function mentionWorktreeLabel(candidate: RelayMentionCandidate) {
  const branch = candidate.branch?.trim();
  if (branch && branch !== "HEAD") {
    return branch;
  }
  return candidate.workspaceQualifier?.trim() || null;
}

function pathLeaf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? null;
}

function messageRefTokenPattern() {
  return /\b(?:message:[a-zA-Z0-9._:-]+|m:[a-z0-9]{4,12})\b/gi;
}

function normalizedMessageRefKey(messageId: string) {
  return messageId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function resolveRelayMessageRefToken(token: string, messages: RelayMessage[]) {
  const normalizedToken = token.trim().toLowerCase();
  if (!normalizedToken) {
    return null;
  }

  if (normalizedToken.startsWith("message:")) {
    const messageId = token.slice(token.indexOf(":") + 1).trim();
    return messages.find((message) => message.id === messageId) ?? null;
  }

  if (!normalizedToken.startsWith("m:")) {
    return null;
  }

  const suffix = normalizedToken.slice(2);
  if (!suffix) {
    return null;
  }

  const matches = messages.filter((message) => normalizedMessageRefKey(message.id).endsWith(suffix));
  return matches.length === 1 ? matches[0] : null;
}

function stripResolvedRelayRefTokens(body: string, resolvedTokens: string[]) {
  if (resolvedTokens.length === 0) {
    return body;
  }

  const tokenSet = new Set(resolvedTokens.map((token) => token.toLowerCase()));
  const withoutTokens = body.replace(messageRefTokenPattern(), (match) => (
    tokenSet.has(match.toLowerCase()) ? " " : match
  ));

  return withoutTokens
    .split(/\r?\n/g)
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
    .join("\n")
    .trim();
}

function arraysEqual(values: string[], other: string[]) {
  if (values.length !== other.length) {
    return false;
  }

  return values.every((value, index) => value === other[index]);
}

function ingestRelayMessageRefs(
  body: string,
  messages: RelayMessage[],
  currentReferenceMessageIds: string[],
) {
  const tokens = body.match(messageRefTokenPattern()) ?? [];
  if (tokens.length === 0) {
    return {
      body,
      nextReferenceMessageIds: currentReferenceMessageIds,
    };
  }

  const nextReferenceMessageIds = [...currentReferenceMessageIds];
  const resolvedTokens: string[] = [];
  for (const token of tokens) {
    const match = resolveRelayMessageRefToken(token, messages);
    if (!match) {
      continue;
    }
    resolvedTokens.push(token);
    if (!nextReferenceMessageIds.includes(match.id)) {
      nextReferenceMessageIds.push(match.id);
    }
  }

  const cleanedBody = stripResolvedRelayRefTokens(body, resolvedTokens);
  return {
    body: cleanedBody,
    nextReferenceMessageIds: arraysEqual(nextReferenceMessageIds, currentReferenceMessageIds)
      ? currentReferenceMessageIds
      : nextReferenceMessageIds,
  };
}
