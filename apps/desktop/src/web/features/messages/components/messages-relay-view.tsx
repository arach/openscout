import React from 'react';

import type { AppView } from '@/app-types';
import { MessagesView } from '@web/features/messages/components/messages-view';
import type { RelayMentionCandidate } from '@web/features/messages/lib/relay-types';

type MessagesViewProps = React.ComponentProps<typeof MessagesView>;

export interface MessagesRelayLayoutProps extends Pick<
  MessagesViewProps,
  'sidebarWidth'
  | 'messagesDetailWidth'
  | 'isCollapsed'
  | 'onResizeStart'
  | 'onMessagesDetailResizeStart'
  | 'styles'
> {}

export interface MessagesRelayThreadingProps extends Pick<
  MessagesViewProps,
  'messagesState'
  | 'messageThreads'
  | 'selectedMessagesThread'
  | 'onSelectMessageThread'
  | 'showAnnotations'
  | 'setShowAnnotations'
  | 'onRefresh'
  | 'loadingWorkspace'
  | 'selectedMessagesInternalThread'
  | 'selectedMessagesInternalMessages'
  | 'selectedMessagesInternalTarget'
  | 'selectedMessagesDetailAgentId'
  | 'selectedMessagesDetailAgent'
  | 'selectedMessagesSessions'
  | 'selectedSession'
  | 'setSelectedSession'
  | 'formatDate'
  | 'interAgentAgents'
  | 'interAgentAgentLookup'
  | 'relayDirectLookup'
  | 'openAgentProfile'
  | 'openAgentDirectMessage'
  | 'onNudgeMessage'
  | 'messagesDetailOpen'
  | 'setMessagesDetailOpen'
  | 'messagesDetailTab'
  | 'setMessagesDetailTab'
> {}

type MessagesRelayComposerPropsBase = Pick<
  MessagesViewProps,
  | 'selectedRelayKind'
  | 'selectedRelayId'
  | 'relayThreadTitle'
  | 'relayThreadSubtitle'
  | 'relayThreadCount'
  | 'selectedRelayDirectThread'
  | 'relayVoiceState'
  | 'visibleRelayMessages'
  | 'relayTimelineViewportRef'
  | 'onRelayTimelineScroll'
  | 'relayReplyTarget'
  | 'setRelayReplyTarget'
  | 'relayContextReferences'
  | 'relayContextMessageIds'
  | 'setRelayContextMessageIds'
  | 'relayComposerRef'
  | 'relayDraft'
  | 'setRelayDraft'
  | 'relaySending'
  | 'relayFeedback'
  | 'relayComposerSelectionStart'
  | 'setRelayComposerSelectionStart'
  | 'mergedRelayMessages'
  | 'relayMentionMenuOpen'
  | 'relayMentionSelectionIndex'
  | 'setRelayMentionSelectionIndex'
  | 'relayMentionDuplicateTitleCounts'
  | 'onRelaySend'
  | 'onToggleVoiceCapture'
  | 'onSetVoiceRepliesEnabled'
>;

/** Mention fields use canonical `RelayMentionCandidate` (same as scoring in `app.tsx`). */
export type MessagesRelayComposerProps = MessagesRelayComposerPropsBase & {
  relayMentionSuggestions: RelayMentionCandidate[];
  applyRelayMentionSuggestion: (candidate: RelayMentionCandidate) => void;
};

export interface MessagesRelayAgentSessionProps extends Pick<
  MessagesViewProps,
  'visibleAgentSession'
  | 'agentSessionPending'
  | 'agentSessionFeedback'
  | 'agentSessionCopied'
  | 'onCopyAgentSessionCommand'
  | 'onOpenAgentSession'
  | 'onPeekAgentSession'
  | 'onOpenAgentSettings'
  | 'desktopVoiceEnabled'
> {}

export interface MessagesRelayViewProps {
  activeView: AppView;
  layout: MessagesRelayLayoutProps;
  threading: MessagesRelayThreadingProps;
  composer: MessagesRelayComposerProps;
  agentSession: MessagesRelayAgentSessionProps;
}

export function MessagesRelayView({
  activeView,
  layout,
  threading,
  composer,
  agentSession,
}: MessagesRelayViewProps) {
  if (activeView !== 'messages' && activeView !== 'relay') {
    return null;
  }

  return (
    <MessagesView
      {...layout}
      {...threading}
      {...composer}
      {...agentSession}
    />
  );
}
