"use client";

import { useState } from "react";
import { SurfaceLab, AgentsSurface } from "@/components/scout-ios";

export default function ScoutIOSAgentsStudy() {
  // Agents = the directory / inventory — the "contacts" half of Slack's
  // chat-vs-contacts split. The project·agent·session tree of who/what exists,
  // NOT the chats (that's Comms, its own tab now). The earlier "Conversations
  // lens" merge was retired. A PROJECT|RECENT sort organizes the directory; the
  // persistent masthead compose "+" is the contextual New (start a session).
  const [sort, setSort] = useState<"project" | "recent">("project");
  return (
    <SurfaceLab
      surface="agents"
      title="Scout iOS · Agents"
      blurb="Agents is the directory — the inventory of who/what exists (project · agent · session), the 'contacts' to Comms' 'chats'. No conversations lens; that lives in Comms now. Live agents read from contrast (ink name + accent age), not dots. The persistent compose '+' in the masthead is the contextual New here — start a session — and it's shown because Agents is a place where 'new' means something."
      source="apps/ios/Scout/AgentsSurface.swift"
      treatments={[
        {
          id: "directory",
          label: "Directory",
          note: "The project·agent·session tree, grouped by repo. Toggle PROJECT|RECENT in the phone. This is structure, not messaging — the thing you browse to find an agent; the chat with it lives in Comms.",
          body: <AgentsSurface sort={sort} onSort={setSort} />,
          mods: { density: "compact" },
        },
      ]}
    />
  );
}
