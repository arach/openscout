import type { ObserveEvent } from "./types.ts";

export type ObserveDisplayRow = {
  event: ObserveEvent;
  repeatCount: number;
};

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Stable merge key for consecutive observe rows. */
export function observeEventSignature(event: ObserveEvent): string {
  return [
    event.kind,
    normalized(event.tool),
    normalized(event.arg),
    normalized(event.text),
    normalized(event.detail),
  ].join("|");
}

function isToolLifecycleStart(event: ObserveEvent): boolean {
  if (event.kind !== "tool" || !event.tool || event.result) return false;
  const arg = normalized(event.arg).toLowerCase();
  return arg === "started" || (arg.length > 0 && arg !== "completed");
}

function isToolLifecycleComplete(event: ObserveEvent): boolean {
  if (event.kind !== "tool" || !event.tool) return false;
  const arg = normalized(event.arg).toLowerCase();
  return arg === "completed" || Boolean(event.result?.outcome);
}

const PERMISSION_REQUESTED = /^permission requested · ([A-Za-z][\w-]*)$/i;
const PERMISSION_RESOLVED = /^permission ([a-z_]+) · ([A-Za-z][\w-]*)$/i;

function isPermissionRequested(event: ObserveEvent): boolean {
  return event.kind === "system" && PERMISSION_REQUESTED.test(event.text.trim());
}

function isPermissionResolved(event: ObserveEvent): boolean {
  return event.kind === "system" && PERMISSION_RESOLVED.test(event.text.trim());
}

function permissionToolName(event: ObserveEvent): string | null {
  const text = event.text.trim();
  const requested = text.match(PERMISSION_REQUESTED);
  if (requested?.[1]) return requested[1];
  const resolved = text.match(PERMISSION_RESOLVED);
  if (resolved?.[2]) return resolved[2];
  return null;
}

function mergeThinkRun(latest: ObserveEvent, repeatCount: number): ObserveEvent {
  const text = latest.text.trim();
  return {
    ...latest,
    text: repeatCount > 1 ? `${text}\n\n(${repeatCount} reasoning updates)` : text,
  };
}

function mergeToolLifecyclePair(started: ObserveEvent, completed: ObserveEvent): ObserveEvent {
  const tool = completed.tool ?? started.tool;
  const outcome = completed.result?.outcome;
  const command = started.arg
    && started.arg !== "started"
    && started.arg !== "completed"
    ? started.arg
    : (completed.arg && completed.arg !== "completed" ? completed.arg : undefined);
  const text = command
    ? (outcome ? `${tool} · ${command} · ${outcome}` : `${tool} · ${command}`)
    : (completed.text.trim()
      || (outcome ? `${tool} completed · ${outcome}` : `${tool} completed`));

  return {
    ...completed,
    tool,
    arg: command ?? "completed",
    text,
    live: completed.live ?? started.live,
  };
}

/**
 * Collapse consecutive observe events for lane/session traces.
 * - Merges grok-style tool started → completed pairs into one row
 * - Collapses consecutive identical signatures (notes, permissions, repeated tools)
 */
export function collapseObserveDisplayRows(events: ObserveEvent[]): ObserveDisplayRow[] {
  const out: ObserveDisplayRow[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const current = events[index];
    if (!current) continue;

    const next = events[index + 1];

    if (
      next
      && isPermissionRequested(current)
      && isPermissionResolved(next)
      && normalized(permissionToolName(current)).toLowerCase() === normalized(permissionToolName(next)).toLowerCase()
    ) {
      const merged = { ...next, live: next.live ?? current.live };
      const signature = observeEventSignature(merged);
      const prev = out[out.length - 1];
      if (prev && observeEventSignature(prev.event) === signature) {
        prev.repeatCount += 1;
        prev.event = merged;
      } else {
        out.push({ event: merged, repeatCount: 1 });
      }
      index += 1;
      continue;
    }

    if (
      next
      && isToolLifecycleStart(current)
      && isToolLifecycleComplete(next)
      && normalized(current.tool).toLowerCase() === normalized(next.tool).toLowerCase()
    ) {
      const merged = mergeToolLifecyclePair(current, next);
      const signature = observeEventSignature(merged);
      const prev = out[out.length - 1];
      if (prev && observeEventSignature(prev.event) === signature) {
        prev.repeatCount += 1;
        prev.event = merged;
      } else {
        out.push({ event: merged, repeatCount: 1 });
      }
      index += 1;
      continue;
    }

    if (current.kind === "think") {
      let latest = current;
      let repeatCount = 1;
      while (events[index + repeatCount]?.kind === "think") {
        const candidate = events[index + repeatCount];
        if (!candidate) break;
        latest = candidate;
        repeatCount += 1;
      }
      const merged = mergeThinkRun(latest, repeatCount);
      out.push({ event: merged, repeatCount });
      index += repeatCount - 1;
      continue;
    }

    // Authored, human-facing turns (messages to a channel, asks) always render
    // as themselves — never merged into a "×N" badge. Repeat-collapse earns its
    // keep on noisy machine output (reasoning streams, repeated tool calls), but
    // on a real message the badge is cryptic and implies the agent "said it
    // twice" when it's just feed repetition.
    if (current.kind !== "message" && current.kind !== "ask") {
      const signature = observeEventSignature(current);
      const prev = out[out.length - 1];
      if (prev && observeEventSignature(prev.event) === signature) {
        prev.repeatCount += 1;
        prev.event = current;
        continue;
      }
    }

    out.push({ event: current, repeatCount: 1 });
  }

  return out;
}
