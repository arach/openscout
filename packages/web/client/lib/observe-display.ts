import { formatBashLine } from "./bash-format.ts";
import type { ObserveEvent } from "./types.ts";

const LANE_BASH_TOOL_NAMES = new Set([
  "bash", "shell", "terminal", "exec", "run", "command",
  "exec_command", "shell_command", "local_shell", "container_exec", "container.exec",
]);

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
  const preview = completed.stream?.join("\n") ?? "";
  const text = command
    ? (preview.trim()
      ? `${tool} · ${command} · ${preview}`
      : outcome
        ? `${tool} · ${command} · ${outcome}`
        : `${tool} · ${command}`)
    : (completed.text.trim()
      || (outcome ? `${tool} completed · ${outcome}` : `${tool} completed`));

  return {
    ...completed,
    tool,
    arg: command ?? "completed",
    text,
    stream: completed.stream ?? started.stream,
    diff: completed.diff ?? started.diff,
    detail: completed.detail ?? started.detail,
    live: completed.live ?? started.live,
  };
}

function isShellInvocation(event: ObserveEvent): boolean {
  if (event.kind !== "tool" || !event.tool) return false;
  const toolKey = normalized(event.tool).toLowerCase();
  if (!LANE_BASH_TOOL_NAMES.has(toolKey)) return false;
  const arg = normalized(event.arg);
  return arg.length > 0 && arg !== "started" && arg !== "completed";
}

function isShellResult(event: ObserveEvent): boolean {
  if (event.kind !== "tool") return false;
  const toolKey = normalized(event.tool).toLowerCase();
  if (toolKey === "res") {
    return Boolean(normalized(event.arg) || (event.stream?.length ?? 0) > 0);
  }
  if (!LANE_BASH_TOOL_NAMES.has(toolKey)) return false;
  return (event.stream?.length ?? 0) > 0;
}

function shellResultPreview(event: ObserveEvent): string {
  if ((event.stream?.length ?? 0) > 0) {
    return event.stream!.join("\n");
  }
  if (normalized(event.tool).toLowerCase() === "res") {
    return event.arg ?? "";
  }
  return "";
}

function mergeShellResultPair(invocation: ObserveEvent, result: ObserveEvent): ObserveEvent {
  const preview = shellResultPreview(result);
  const command = normalized(invocation.arg);
  const tool = invocation.tool ?? result.tool;
  const text = preview.trim()
    ? `${tool} · ${command} · ${preview}`
    : invocation.text;

  return {
    ...invocation,
    id: result.id,
    t: result.t,
    at: result.at,
    result: result.result ?? invocation.result,
    stream: preview.trim() ? [preview] : result.stream ?? invocation.stream,
    diff: result.diff ?? invocation.diff,
    detail: result.detail ?? invocation.detail,
    text,
    live: result.live ?? invocation.live,
  };
}

/** A single-token shell invocation (node, pgrep, /usr/bin/log) with no diff/stream. */
export function isSimpleLaneToolEvent(event: ObserveEvent): boolean {
  if (event.kind !== "tool") return false;
  if (event.diff || (event.stream?.length ?? 0) > 0) return false;

  const tool = (event.tool ?? "").trim();
  const arg = (event.arg ?? "").trim();
  if (!tool) return false;
  if (arg === "started" || arg === "completed") return false;

  const outcome = event.result?.outcome;
  if (outcome != null && outcome !== "success" && outcome !== 0) return false;
  if (event.result && Object.keys(event.result).length > 1) return false;

  const toolKey = tool.toLowerCase();
  if (LANE_BASH_TOOL_NAMES.has(toolKey)) {
    if (!arg || arg.startsWith("{") || arg.startsWith("[")) return false;
    const { dir, spans } = formatBashLine(arg);
    if (dir) return false;
    const progSpans = spans.filter((span) => span.tier === "prog");
    return progSpans.length === 1 && spans.length === 1 && progSpans[0]!.text.length <= 64;
  }

  if (arg && arg !== tool) return false;
  if (/\s/u.test(tool)) return false;
  return tool.length <= 64;
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

    if (
      next
      && isShellInvocation(current)
      && isShellResult(next)
      && (current.stream?.length ?? 0) === 0
    ) {
      const merged = mergeShellResultPair(current, next);
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
