import type {
  Agent,
  SessionCatalogEntry,
  SessionCatalogWithResume,
} from "./types.ts";

// Shared session-catalog selection logic for the agent profile. The center
// (session list) and the rail (session-focused context) are decoupled slots
// that each fetch the catalog independently — they must agree on which session
// is "the one being explored", so they both resolve selection through here.

/** The session the agent is "in" right now — the catalog's active id, or for a
 *  tmux agent its harness session id when the catalog hasn't named one. */
export function resolveActiveSessionId(
  agent: Agent,
  catalog: SessionCatalogWithResume | null,
): string | null {
  return (
    catalog?.activeSessionId ??
    (agent.transport === "tmux" ? agent.harnessSessionId ?? null : null)
  );
}

/** Sessions ordered for the profile spine: the active one first, then by recency
 *  (most recent end/start first). */
export function sortSessionsByRecency(
  sessions: SessionCatalogEntry[],
  activeSessionId: string | null,
): SessionCatalogEntry[] {
  return [...sessions].sort((a, b) => {
    const aActive = a.id === activeSessionId ? 1 : 0;
    const bActive = b.id === activeSessionId ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt);
  });
}

/** A center session selection, scoped to the agent it was made on so it
 *  auto-invalidates when the focused agent changes. */
export type FocusedSession = { agentId: string; sessionId: string };

/** The session the profile is exploring: an explicit center selection (when it
 *  still belongs to this agent and exists) wins, else the active session, else
 *  the most recent. `sorted` is the output of {@link sortSessionsByRecency}. */
export function resolveSelectedSessionId(
  agentId: string,
  focusedSession: FocusedSession | null,
  activeSessionId: string | null,
  sorted: SessionCatalogEntry[],
): string | null {
  const focused =
    focusedSession?.agentId === agentId ? focusedSession.sessionId : null;
  if (focused && sorted.some((s) => s.id === focused)) return focused;
  return activeSessionId ?? sorted[0]?.id ?? null;
}

/** Per-session engage capabilities. The catalog flags *enable* a surface; the
 *  transport adds the cases the flags may miss — a tmux pane is always
 *  observable and takeoverable (you grab the live pane; no resume command
 *  needed), and any resume command makes a session takeoverable. We OR these
 *  rather than letting a stale `false` flag veto a tmux session, which matches
 *  what the takeover handler can actually do. Only a live session qualifies. */
export function sessionEngage(
  agent: Agent,
  catalog: SessionCatalogWithResume | null,
  session: SessionCatalogEntry,
  active: boolean,
): { canObserve: boolean; canTakeover: boolean } {
  const isTmux = agent.transport === "tmux";
  const canObserve = active && (Boolean(session.canObserve) || isTmux);
  const canTakeover =
    active && (Boolean(session.canTakeover) || isTmux || Boolean(catalog?.resumeCommand));
  return { canObserve, canTakeover };
}
