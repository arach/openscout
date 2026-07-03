import { useSyncExternalStore } from "react";
import type { AgentDisplayState } from "../../lib/agent-state.ts";

/**
 * One deck lane, projected to the plain display data the lanes-mode left rail
 * needs — no model helpers required downstream. The deck publishes these in the
 * exact order it renders its columns (pinned-left → main → pinned-right), so the
 * rail is a 1:1 mirror of the strip on screen rather than a re-derived roster
 * that can drift in count/order from what the user is actually looking at.
 */
export type LaneRosterEntry = {
  /** Deck column anchor — matches the `data-lane-id` the column renders. */
  id: string;
  /** Column title (lanePrimaryLabel). */
  label: string;
  /** Hover/status text (laneStatusLabel), typically the harness. */
  statusLabel: string;
  /** Dot tone, normalized the same way the card derives its working state. */
  tone: AgentDisplayState;
  /**
   * Registered agent id for the profile fallback. Absent for native/terminal
   * lanes with no scout agent — their column is the only place to land, so a
   * missing column is a no-op rather than a broken navigate.
   */
  agentId?: string;
  /** Last substantive activity (lane.lastActiveAt) for the row's time meta. */
  updatedAt?: number;
};

let roster: LaneRosterEntry[] | null = null;
const listeners = new Set<() => void>();

function entriesEqual(a: LaneRosterEntry, b: LaneRosterEntry): boolean {
  return a.id === b.id
    && a.label === b.label
    && a.statusLabel === b.statusLabel
    && a.tone === b.tone
    && a.agentId === b.agentId
    && a.updatedAt === b.updatedAt;
}

function rostersEqual(a: LaneRosterEntry[] | null, b: LaneRosterEntry[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return a.every((entry, index) => entriesEqual(entry, b[index]));
}

/**
 * Deck → rail publish. Keeps the stored reference stable when the projection is
 * unchanged so `useSyncExternalStore` neither churns nor loops; only re-emits
 * when a lane's label/tone/order/activity actually moves. Pass `null` on unmount
 * so a stale roster never lingers after the deck leaves the view.
 */
export function publishLaneRoster(next: LaneRosterEntry[] | null): void {
  if (rostersEqual(roster, next)) return;
  roster = next;
  for (const listener of listeners) listener();
}

export function subscribeLaneRoster(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLaneRosterSnapshot(): LaneRosterEntry[] | null {
  return roster;
}

/**
 * Rail hook: the deck's rendered roster, or `null` when no deck has published
 * yet (rail mounted a beat before the deck settled, or the deck has unmounted).
 */
export function useLaneRoster(): LaneRosterEntry[] | null {
  return useSyncExternalStore(subscribeLaneRoster, getLaneRosterSnapshot, getLaneRosterSnapshot);
}
