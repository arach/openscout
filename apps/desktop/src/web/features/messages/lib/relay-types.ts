"use client";

import type { RelayDirectState } from "@/lib/scout-desktop";

export type AgentRosterFilterMode = "all" | "active";
export type AgentRosterSortMode = "chat" | "code" | "session" | "alpha";

export type RelayMentionCandidate = {
  agentId: string;
  title: string;
  subtitle: string | null;
  mentionToken: string;
  definitionId: string | null;
  workspaceQualifier: string | null;
  branch: string | null;
  harness: string | null;
  state: RelayDirectState;
  statusLabel: string;
  searchText: string;
};

export type RelayActiveMention = {
  start: number;
  end: number;
  query: string;
};
