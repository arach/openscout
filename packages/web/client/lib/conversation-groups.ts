/**
 * Chat-rail conversation grouping. DMs and observed directs collapse into one
 * rail section per repo when the server resolved a canonical `repoKey` for
 * the agent's checkout (side checkouts of the same repo — PR checkouts,
 * worktrees, clones — share a key); otherwise grouping falls back to the
 * project label, then to the agent/conversation name.
 */

import { agentStateRank, normalizeAgentState, type AgentDisplayState } from "./agent-state.ts";
import { conversationDisplayTitle, isGroupConversation } from "./conversations.ts";
import { isUnread, type LastViewedMap } from "./sessionRead.ts";
import type { Agent, MessagesSort, SessionEntry } from "./types.ts";

export type ConversationGroup = {
  key: string;
  label: string;
  isChannel: boolean;
  conversations: SessionEntry[];
  bestState: AgentDisplayState;
  latestUpdate: number;
  unreadCount: number;
  /**
   * The checkout treated as the group's home root. Rows whose agent runs from
   * a different root get a worktree indicator. Null outside repo groups.
   */
  canonicalRoot: string | null;
};

export type RepoGroupMember = {
  project: string | null;
  projectRoot: string | null;
  lastActivityAt: number;
};

/** Repo name (last path segment) from a canonical `host/org/repo` key. */
export function repoNameFromKey(repoKey: string): string {
  const segments = repoKey.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? repoKey;
}

export function pathBasename(path: string): string {
  const segments = path.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] ?? path;
}

/**
 * Choose a repo group's label and canonical root. The label prefers the
 * project label of a member whose projectRoot basename matches the repo name
 * from the URL (i.e. the "main" checkout); otherwise the label of the member
 * with the latest activity. The canonical root is that member's root, with
 * ties broken toward the most common root, then latest activity.
 */
export function resolveRepoGroupIdentity(
  members: RepoGroupMember[],
  repoKey: string,
): { label: string; canonicalRoot: string | null } {
  const repoName = repoNameFromKey(repoKey).toLowerCase();
  const rooted = members.filter(
    (member): member is RepoGroupMember & { projectRoot: string } => Boolean(member.projectRoot),
  );
  const matching = rooted.filter(
    (member) => pathBasename(member.projectRoot).toLowerCase() === repoName,
  );
  const pool = matching.length > 0 ? matching : rooted;
  const canonicalRoot = mostCommonRoot(pool);
  if (!canonicalRoot) {
    return { label: repoNameFromKey(repoKey), canonicalRoot: null };
  }
  const labelSource = matching.length > 0
    ? pool.find((member) => member.projectRoot === canonicalRoot)
    : [...pool].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
  return { label: labelSource?.project ?? repoNameFromKey(repoKey), canonicalRoot };
}

function mostCommonRoot(members: Array<RepoGroupMember & { projectRoot: string }>): string | null {
  const byRoot = new Map<string, { count: number; latest: number }>();
  for (const member of members) {
    const entry = byRoot.get(member.projectRoot) ?? { count: 0, latest: 0 };
    entry.count += 1;
    entry.latest = Math.max(entry.latest, member.lastActivityAt);
    byRoot.set(member.projectRoot, entry);
  }
  let best: string | null = null;
  let bestCount = -1;
  let bestLatest = -1;
  for (const [root, entry] of byRoot) {
    if (entry.count > bestCount || (entry.count === bestCount && entry.latest > bestLatest)) {
      best = root;
      bestCount = entry.count;
      bestLatest = entry.latest;
    }
  }
  return best;
}

export function buildConversationGroups(
  sessions: SessionEntry[],
  agentById: Map<string, Agent>,
  lastViewed: LastViewedMap,
  sort: MessagesSort,
): ConversationGroup[] {
  const buckets = new Map<string, ConversationGroup>();

  for (const s of sessions) {
    const channel = isGroupConversation(s);
    let key: string;
    let label: string;
    if (channel) {
      key = `channel:${s.id}`;
      label = conversationDisplayTitle(s);
    } else {
      const agent = s.agentId ? agentById.get(s.agentId) : undefined;
      const repoKey = agent?.repoKey ?? null;
      const project = agent?.project ?? null;
      if (repoKey) {
        key = `repo:${repoKey.toLowerCase()}`;
        label = repoNameFromKey(repoKey);
      } else if (project) {
        key = `project:${project.toLowerCase()}`;
        label = project;
      } else {
        // Fall back to grouping by agent name / display title so DMs that share
        // an agent collapse even when project metadata is missing.
        const groupName = (s.agentName ?? conversationDisplayTitle(s)).trim();
        if (groupName) {
          key = `name:${groupName.toLowerCase()}`;
          label = groupName;
        } else {
          key = `dm:${s.id}`;
          label = conversationDisplayTitle(s);
        }
      }
    }

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        label,
        isChannel: channel,
        conversations: [],
        bestState: "blocked",
        latestUpdate: 0,
        unreadCount: 0,
        canonicalRoot: null,
      };
      buckets.set(key, bucket);
    }
    bucket.conversations.push(s);
    bucket.latestUpdate = Math.max(bucket.latestUpdate, s.lastMessageAt ?? 0);
    if (isUnread(s.lastMessageAt, s.id, lastViewed)) {
      bucket.unreadCount += 1;
    }
    if (!channel) {
      const agent = s.agentId ? agentById.get(s.agentId) : undefined;
      if (agent) {
        const state = normalizeAgentState(agent.state);
        if (agentStateRank(state) < agentStateRank(bucket.bestState)) {
          bucket.bestState = state;
        }
      }
    }
  }

  // Repo buckets get a proper label + canonical root once all members are known.
  for (const bucket of buckets.values()) {
    if (!bucket.key.startsWith("repo:")) continue;
    const repoKey = bucket.key.slice("repo:".length);
    const members: RepoGroupMember[] = bucket.conversations.map((s) => {
      const agent = s.agentId ? agentById.get(s.agentId) : undefined;
      return {
        project: agent?.project ?? null,
        projectRoot: agent?.projectRoot ?? null,
        lastActivityAt: s.lastMessageAt ?? 0,
      };
    });
    const identity = resolveRepoGroupIdentity(members, repoKey);
    bucket.label = identity.label;
    bucket.canonicalRoot = identity.canonicalRoot;
  }

  for (const b of buckets.values()) {
    b.conversations.sort((a, c) => (c.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  }

  const list = Array.from(buckets.values());
  switch (sort) {
    case "name":
      list.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
      break;
    case "unread":
      list.sort((a, b) => {
        if ((a.unreadCount > 0) !== (b.unreadCount > 0)) return a.unreadCount > 0 ? -1 : 1;
        return b.latestUpdate - a.latestUpdate;
      });
      break;
    case "recent":
    default:
      list.sort((a, b) => b.latestUpdate - a.latestUpdate);
      break;
  }
  return list;
}
