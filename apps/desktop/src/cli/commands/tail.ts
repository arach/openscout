import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import {
  readScoutTailEvents,
  watchScoutTailEvents,
  type TailEvent,
  type TailEventKind,
} from "../../core/tail/service.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);
const TAIL_EVENT_KINDS = new Set<TailEventKind>([
  "user",
  "assistant",
  "tool",
  "tool-result",
  "system",
  "other",
]);

export type ScoutTailCommandOptions = {
  limit: number;
  sources?: string[];
  kinds?: TailEventKind[];
  sessionId?: string;
  project?: string;
  cwd?: string;
  query?: string;
  since?: string;
  once: boolean;
  transcripts: boolean;
  raw: boolean;
};

export function renderTailCommandHelp(): string {
  return [
    "Usage: scout tail [options]",
    "",
    "Stream observed harness events from the broker tail firehose.",
    "",
    "Filters:",
    "  --source <name>                   Runtime source such as claude or codex; repeatable",
    "  --kind <kind>                     user, assistant, tool, tool-result, system, or other; repeatable",
    "  --session <id>                    Limit to one harness session id",
    "  --project <text>                  Match project name",
    "  --cwd <path>                      Match working directory text",
    "  --query <text>                    Match source, kind, session, project, cwd, origin, or summary",
    "",
    "Output:",
    "  --limit <count>                   Initial backlog count (default 80)",
    "  --since <event-id>                Resume live streaming after a TailEvent id cursor",
    "  --once                            Print the backlog and exit",
    "  --transcripts                     Include recent file-backed transcript events in the initial backlog",
    "  --raw                             Show bounded raw payload JSON in plain output",
    "  --json                            Emit JSON (streaming mode uses NDJSON)",
    "",
    "Examples:",
    "  scout tail",
    "  scout tail --source codex --kind tool-result",
    "  scout tail --project openscout --query permission --once",
    "  scout tail --transcripts --limit 200 --json",
  ].join("\n");
}

export function parseTailCommandOptions(args: string[]): ScoutTailCommandOptions {
  let limit = 80;
  const sources: string[] = [];
  const kinds: TailEventKind[] = [];
  let sessionId: string | undefined;
  let project: string | undefined;
  let cwd: string | undefined;
  let query: string | undefined;
  let since: string | undefined;
  let once = false;
  let transcripts = false;
  let raw = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--once") {
      once = true;
      continue;
    }
    if (arg === "--follow" || arg === "-f") {
      once = false;
      continue;
    }
    if (arg === "--transcripts") {
      transcripts = true;
      continue;
    }
    if (arg === "--no-transcripts") {
      transcripts = false;
      continue;
    }
    if (arg === "--raw") {
      raw = true;
      continue;
    }
    if (arg === "--source") {
      sources.push(...parseCsvFlag(args[++index], "--source"));
      continue;
    }
    if (arg.startsWith("--source=")) {
      sources.push(...parseCsvFlag(arg.slice("--source=".length), "--source"));
      continue;
    }
    if (arg === "--kind") {
      kinds.push(...parseKindFlag(args[++index]));
      continue;
    }
    if (arg.startsWith("--kind=")) {
      kinds.push(...parseKindFlag(arg.slice("--kind=".length)));
      continue;
    }
    if (arg === "--session" || arg === "--session-id") {
      sessionId = parseStringFlag(args[++index], arg);
      continue;
    }
    if (arg.startsWith("--session=")) {
      sessionId = parseStringFlag(arg.slice("--session=".length), "--session");
      continue;
    }
    if (arg.startsWith("--session-id=")) {
      sessionId = parseStringFlag(arg.slice("--session-id=".length), "--session-id");
      continue;
    }
    if (arg === "--project") {
      project = parseStringFlag(args[++index], "--project");
      continue;
    }
    if (arg.startsWith("--project=")) {
      project = parseStringFlag(arg.slice("--project=".length), "--project");
      continue;
    }
    if (arg === "--cwd") {
      cwd = parseStringFlag(args[++index], "--cwd");
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      cwd = parseStringFlag(arg.slice("--cwd=".length), "--cwd");
      continue;
    }
    if (arg === "--query" || arg === "-q") {
      query = parseStringFlag(args[++index], arg);
      continue;
    }
    if (arg.startsWith("--query=")) {
      query = parseStringFlag(arg.slice("--query=".length), "--query");
      continue;
    }
    if (arg === "--since") {
      since = parseStringFlag(args[++index], "--since");
      continue;
    }
    if (arg.startsWith("--since=")) {
      since = parseStringFlag(arg.slice("--since=".length), "--since");
      continue;
    }
    if (arg === "--limit") {
      limit = parseLimit(args[++index]);
      continue;
    }
    if (arg.startsWith("--limit=")) {
      limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ScoutCliError(`unknown tail option: ${arg}`);
    }
    query = [query, arg].filter(Boolean).join(" ");
  }

  return {
    limit,
    ...(sources.length > 0 ? { sources: unique(sources) } : {}),
    ...(kinds.length > 0 ? { kinds: unique(kinds) } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(project ? { project } : {}),
    ...(cwd ? { cwd } : {}),
    ...(query ? { query } : {}),
    ...(since ? { since } : {}),
    once,
    transcripts,
    raw,
  };
}

export async function runTailCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderTailCommandHelp());
    return;
  }

  const options = parseTailCommandOptions(args);
  const initial = options.since && !options.once
    ? { generatedAt: Date.now(), limit: options.limit, cursor: options.since, events: [] }
    : await readScoutTailEvents({
      limit: options.limit,
      sources: options.sources,
      kinds: options.kinds,
      sessionId: options.sessionId,
      project: options.project,
      cwd: options.cwd,
      query: options.query,
      transcripts: options.transcripts,
    });

  if (options.once) {
    context.output.writeValue(initial, (value) =>
      value.events.length === 0
        ? "No tail events found."
        : renderTailEvents(value.events, { raw: options.raw }),
    );
    return;
  }

  const emitEvent = (event: TailEvent) => {
    if (!tailEventMatches(event, options)) return;
    if (context.output.mode === "json") {
      context.stdout(JSON.stringify(event));
      return;
    }
    context.stdout(renderTailEvent(event, { raw: options.raw }));
  };

  for (const event of initial.events) {
    emitEvent(event);
  }

  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.on("SIGINT", shutdown);

  try {
    if (context.output.mode === "plain") {
      const sourceText = options.sources?.length ? options.sources.join(",") : "all sources";
      context.stderr(`Following tail (${sourceText})`);
    }
    await watchScoutTailEvents({
      since: options.since ?? initial.cursor ?? undefined,
      sources: options.sources,
      signal: controller.signal,
      onEvent: emitEvent,
    });
  } finally {
    process.off("SIGINT", shutdown);
  }
}

export function renderTailEvents(events: TailEvent[], options: { raw?: boolean } = {}): string {
  return events.map((event) => renderTailEvent(event, options)).join("\n");
}

export function renderTailEvent(event: TailEvent, options: { raw?: boolean } = {}): string {
  const parts = [
    formatClock(event.ts),
    event.source.padEnd(6, " ").slice(0, 6),
    event.kind.padEnd(11, " ").slice(0, 11),
    compact(event.project || shortCwd(event.cwd), 18).padEnd(18, " "),
    compact(event.summary, 140),
  ];
  const line = parts.join("  ");
  if (!options.raw || event.raw === undefined) {
    return line;
  }
  return `${line}\n${JSON.stringify(event.raw, null, 2)}`;
}

function tailEventMatches(event: TailEvent, options: ScoutTailCommandOptions): boolean {
  if (options.sources?.length && !options.sources.includes(event.source)) return false;
  if (options.kinds?.length && !options.kinds.includes(event.kind)) return false;
  if (options.sessionId && event.sessionId !== options.sessionId) return false;
  if (options.project && !event.project.toLowerCase().includes(options.project.toLowerCase())) return false;
  if (options.cwd && !event.cwd.toLowerCase().includes(options.cwd.toLowerCase())) return false;
  if (options.query) {
    const query = options.query.toLowerCase();
    const haystack = [
      event.source,
      event.kind,
      event.sessionId,
      event.project,
      event.cwd,
      event.harness,
      event.summary,
    ].join("\n").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function parseCsvFlag(value: string | undefined, flag: string): string[] {
  const trimmed = parseStringFlag(value, flag);
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseKindFlag(value: string | undefined): TailEventKind[] {
  return parseCsvFlag(value, "--kind").map((kind) => {
    if (!TAIL_EVENT_KINDS.has(kind as TailEventKind)) {
      throw new ScoutCliError(`unknown tail kind "${kind}". Use one of: ${[...TAIL_EVENT_KINDS].join(", ")}`);
    }
    return kind as TailEventKind;
  });
}

function parseStringFlag(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new ScoutCliError(`${flag} requires a value`);
  }
  return trimmed;
}

function parseLimit(value: string | undefined): number {
  const raw = parseStringFlag(value, "--limit");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1_000) {
    throw new ScoutCliError("--limit must be a number between 1 and 1000");
  }
  return parsed;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.at(-1) ?? cwd;
}
