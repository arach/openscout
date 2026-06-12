"use client";

import { SurfaceLab, ConversationHeader, ConversationBody } from "@/components/scout-ios";

export default function ScoutIOSConversationStudy() {
  return (
    <SurfaceLab
      surface="conversation"
      title="Scout iOS · Conversation"
      blurb="The agent session transcript + composer — typed blocks (text, reasoning, tool actions with an approval gate, a pending question), a streaming turn, and the steer-the-agent composer. Pushed surface: custom header, no tab bar."
      source="apps/ios/Scout/ConversationSurface.swift"
      header={<ConversationHeader />}
      showChrome={false}
      treatments={[
        {
          id: "source",
          label: "Source",
          note: "Faithful BlockView port — text / reasoning / action / question blocks, approval Deny·Approve with a risk badge, mic + composer pinned to the bottom.",
          body: <ConversationBody />,
        },
        {
          id: "compact",
          label: "Compact",
          note: "Tighter blocks + turn spacing for a long session — same blocks, more transcript above the fold.",
          body: <ConversationBody />,
          mods: { density: "compact" },
        },
        {
          id: "reasoning",
          label: "Collapsed reasoning",
          note: "Fold each reasoning block to a tappable 'thought' chip instead of always-expanded italic — keeps the transcript about what the agent did, not what it was thinking, until you ask.",
          body: <ConversationBody collapseReasoning />,
        },
      ]}
    />
  );
}
