import { basename } from "node:path";
import { open, stat, type FileHandle } from "node:fs/promises";

import { ClaudeSource } from "./claude-source.js";
import { CodexSource } from "./codex-source.js";
import { CursorSource } from "./cursor-source.js";
import { GrokSource } from "./grok-source.js";
import { OpenCodeSource } from "./opencode-source.js";
import type {
  DiscoveredProcess,
  DiscoveredTranscript,
  DiscoverySnapshot,
  TailDiscoveryScope,
  TailEvent,
  TranscriptSource,
} from "./types.js";

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

const TAIL_POLL_INTERVAL_MS = readPositiveIntEnv("OPENSCOUT_TAIL_POLL_INTERVAL_MS", 500);
const HOT_DISCOVERY_INTERVAL_MS = readPositiveIntEnv("OPENSCOUT_TAIL_HOT_DISCOVERY_INTERVAL_MS", 30_000);
const DISCOVERY_CACHE_MAX_AGE_MS = readPositiveIntEnv(
  "OPENSCOUT_TAIL_DISCOVERY_CACHE_MAX_AGE_MS",
  HOT_DISCOVERY_INTERVAL_MS,
);
const SHALLOW_DISCOVERY_INTERVAL_MS = readPositiveIntEnv("OPENSCOUT_TAIL_SHALLOW_DISCOVERY_INTERVAL_MS", 10 * 60_000);
const DEEP_DISCOVERY_INTERVAL_MS = readPositiveIntEnv("OPENSCOUT_TAIL_DEEP_DISCOVERY_INTERVAL_MS", 60 * 60_000);
const PER_SESSION_BUFFER_LIMIT = 2_000;
const AGGREGATE_BUFFER_LIMIT = 10_000;
const RAW_MAX_DEPTH = 5;
const RAW_MAX_STRING_LEN = 1_000;
const RAW_MAX_ARRAY_ITEMS = 25;
const RAW_MAX_OBJECT_KEYS = 50;
const RECENT_TRANSCRIPT_READ_BYTES = 512 * 1024;
const SESSION_TRANSCRIPT_READ_BYTES = 8 * 1024 * 1024;
const RECENT_TRANSCRIPT_LINES_PER_FILE = 200;
const RECENT_TRANSCRIPT_MAX_FILES = readPositiveIntEnv("OPENSCOUT_TAIL_RECENT_TRANSCRIPT_MAX_FILES", 24);
const NATIVE_TAIL_SOURCES = new Set<TranscriptSource["name"]>(["grok", "opencode", "cursor"]);

type Subscriber = (event: TailEvent) => void;

type Watcher = {
  source: TranscriptSource;
  process: DiscoveredProcess;
  transcript: DiscoveredTranscript;
  transcriptPath: string;
  offset: number;
  lineCounter: number;
  carry: string;
  emittedEventIds: Set<string>;
};

const sources: TranscriptSource[] = [GrokSource, ClaudeSource, CodexSource, CursorSource, OpenCodeSource];

const watchers = new Map<string, Watcher>(); // key = `${source}:${transcriptPath}` (one watcher per file, regardless of how many processes share it)
const aggregateBuffer: TailEvent[] = [];
const perSessionBuffer = new Map<string, TailEvent[]>();
const subscribers = new Set<Subscriber>();
const knownTranscripts = new Map<string, DiscoveredTranscript>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let hotDiscoveryTimer: ReturnType<typeof setInterval> | null = null;
let shallowDiscoveryTimer: ReturnType<typeof setInterval> | null = null;
let deepDiscoveryTimer: ReturnType<typeof setInterval> | null = null;
let discoveryInFlight: Promise<DiscoverySnapshot> | null = null;
let lastDiscovery: DiscoverySnapshot | null = null;

function watcherKey(source: string, path: string): string {
  return `${source}:${path}`;
}

function transcriptKey(transcript: DiscoveredTranscript): string {
  return watcherKey(transcript.source, transcript.transcriptPath);
}

// Watchers are keyed by file path so each rotated transcript gets its own tail
// reader. The public snapshot, however, should expose one entry per logical
// session — otherwise a session that rotates files inflates the tile count in
// downstream UIs like /ops/control. Pick the newest file as the representative.
function dedupTranscriptsBySession(
  transcripts: DiscoveredTranscript[],
): DiscoveredTranscript[] {
  const winnersBySession = new Map<string, DiscoveredTranscript>();
  const pathOnly: DiscoveredTranscript[] = [];
  for (const transcript of transcripts) {
    const sessionId = transcript.sessionId?.trim();
    if (!sessionId) {
      pathOnly.push(transcript);
      continue;
    }
    const key = `${transcript.source}:${sessionId}`;
    const existing = winnersBySession.get(key);
    if (!existing || transcript.mtimeMs > existing.mtimeMs) {
      winnersBySession.set(key, transcript);
    }
  }
  return [...winnersBySession.values(), ...pathOnly];
}

const ATTRIBUTION_RANK: Record<DiscoveredProcess["harness"], number> = {
  "scout-managed": 3,
  "hudson-managed": 2,
  unattributed: 1,
};

/**
 * Pick the best-attributed process to represent a transcript file.
 * Prefer Scout-managed > Hudson-managed > native; tie-break by lowest pid
 * (typically the earliest/root process in a fanout).
 */
function pickPrimaryProcess(procs: DiscoveredProcess[]): DiscoveredProcess {
  return procs.reduce((best, candidate) => {
    const bestRank = ATTRIBUTION_RANK[best.harness] ?? 0;
    const candRank = ATTRIBUTION_RANK[candidate.harness] ?? 0;
    if (candRank > bestRank) return candidate;
    if (candRank === bestRank && candidate.pid < best.pid) return candidate;
    return best;
  });
}

function virtualPidForPath(path: string): number {
  let hash = 2166136261;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return -((hash >>> 0) % 900_000 + 1_000);
}

function processForTranscript(
  transcript: DiscoveredTranscript,
  processes: DiscoveredProcess[],
): DiscoveredProcess {
  const cwd = transcript.cwd?.trim();
  if (cwd) {
    const matches = processes.filter((proc) => proc.source === transcript.source && proc.cwd === cwd);
    if (matches.length > 0) {
      return pickPrimaryProcess(matches);
    }
  }

  return {
    pid: virtualPidForPath(transcript.transcriptPath),
    ppid: 0,
    command: `${transcript.source} transcript`,
    etime: "0",
    cwd: transcript.cwd,
    harness: transcript.harness,
    parentChain: [],
    source: transcript.source,
  };
}

function trimRawString(value: string): string {
  if (value.length <= RAW_MAX_STRING_LEN) return value;
  return `${value.slice(0, RAW_MAX_STRING_LEN)}... [truncated ${value.length - RAW_MAX_STRING_LEN} chars]`;
}

function compactRawValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return trimRawString(value);
  if (value == null || typeof value !== "object") return value;
  if (depth >= RAW_MAX_DEPTH) return "[truncated depth]";

  if (Array.isArray(value)) {
    const out = value.slice(0, RAW_MAX_ARRAY_ITEMS).map((entry) => compactRawValue(entry, depth + 1));
    if (value.length > RAW_MAX_ARRAY_ITEMS) {
      out.push(`[truncated ${value.length - RAW_MAX_ARRAY_ITEMS} items]`);
    }
    return out;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of entries.slice(0, RAW_MAX_OBJECT_KEYS)) {
    out[key] = compactRawValue(entry, depth + 1);
  }
  if (entries.length > RAW_MAX_OBJECT_KEYS) {
    out.__truncatedKeys = entries.length - RAW_MAX_OBJECT_KEYS;
  }
  return out;
}

function compactEvent(event: TailEvent): TailEvent {
  if (!event.raw) return event;
  return {
    ...event,
    raw: compactRawValue(event.raw),
  };
}

function parsedEventsToArray(events: TailEvent | TailEvent[] | null): TailEvent[] {
  if (!events) return [];
  return Array.isArray(events) ? events : [events];
}

function pushEvent(rawEvent: TailEvent): void {
  const event = compactEvent(rawEvent);
  aggregateBuffer.push(event);
  if (aggregateBuffer.length > AGGREGATE_BUFFER_LIMIT) {
    aggregateBuffer.splice(0, aggregateBuffer.length - AGGREGATE_BUFFER_LIMIT);
  }
  let bucket = perSessionBuffer.get(event.sessionId);
  if (!bucket) {
    bucket = [];
    perSessionBuffer.set(event.sessionId, bucket);
  }
  bucket.push(event);
  if (bucket.length > PER_SESSION_BUFFER_LIMIT) {
    bucket.splice(0, bucket.length - PER_SESSION_BUFFER_LIMIT);
  }
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(event);
    } catch {
      /* swallow subscriber errors */
    }
  }
}

async function readNew(
  handle: FileHandle,
  fromOffset: number,
  fileSize: number,
): Promise<{ text: string; nextOffset: number }> {
  if (fileSize <= fromOffset) {
    return { text: "", nextOffset: fromOffset };
  }
  const length = fileSize - fromOffset;
  const buffer = Buffer.alloc(length);
  await handle.read(buffer, 0, length, fromOffset);
  return { text: buffer.toString("utf8"), nextOffset: fileSize };
}

async function readTranscriptText(path: string, maxBytes = RECENT_TRANSCRIPT_READ_BYTES): Promise<string> {
  let handle: FileHandle | null = null;
  try {
    const stats = await stat(path);
    if (stats.size <= 0) return "";
    const start = Math.max(0, stats.size - maxBytes);
    const length = stats.size - start;
    const buffer = Buffer.alloc(length);
    handle = await open(path, "r");
    await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function pumpWatcher(watcher: Watcher): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    const stats = await stat(watcher.transcriptPath);
    if (stats.size < watcher.offset) {
      // File was rotated/truncated; reset.
      watcher.offset = 0;
      watcher.carry = "";
      watcher.emittedEventIds.clear();
    }
    if (stats.size <= watcher.offset) return;
    if (watcher.source.parseFile) {
      const text = await readTranscriptText(watcher.transcriptPath);
      watcher.offset = stats.size;
      if (!text) return;
      const events = parsedEventsToArray(watcher.source.parseFile(text, {
        process: watcher.process,
        transcript: watcher.transcript,
        transcriptPath: watcher.transcriptPath,
        lineOffset: watcher.lineCounter,
      }));
      watcher.lineCounter += Math.max(1, events.length);
      for (const event of events) {
        if (watcher.emittedEventIds.has(event.id)) continue;
        watcher.emittedEventIds.add(event.id);
        pushEvent(event);
      }
      return;
    }
    handle = await open(watcher.transcriptPath, "r");
    const { text, nextOffset } = await readNew(handle, watcher.offset, stats.size);
    watcher.offset = nextOffset;
    if (!text) return;
    const combined = watcher.carry + text;
    const lines = combined.split("\n");
    watcher.carry = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const event = watcher.source.parseLine(line, {
        process: watcher.process,
        transcript: watcher.transcript,
        transcriptPath: watcher.transcriptPath,
        lineOffset: watcher.lineCounter,
      });
      watcher.lineCounter++;
      if (event) pushEvent(event);
    }
  } catch {
    // File may be missing momentarily — skip this tick.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function pumpAllWatchers(): Promise<void> {
  await Promise.all([...watchers.values()].map(pumpWatcher));
}

async function seedTail(watcher: Watcher): Promise<void> {
  // Seed the offset to the current end of the file so we don't replay a giant
  // historical transcript. We'll start tailing from "now".
  try {
    const stats = await stat(watcher.transcriptPath);
    watcher.offset = watcher.source.parseFile ? 0 : stats.size;
  } catch {
    watcher.offset = 0;
  }
}

async function refreshDiscovery(
  scope: TailDiscoveryScope = "shallow",
  options: { pruneMissing: boolean } = { pruneMissing: scope !== "hot" },
): Promise<DiscoverySnapshot> {
  const allProcesses: DiscoveredProcess[] = [];
  const cachedProcesses = lastDiscovery?.processes ?? [];
  const seenKeys = new Set<string>();

  for (const source of sources) {
    let processes: DiscoveredProcess[] = [];
    if (scope === "hot" && cachedProcesses.length > 0) {
      processes = cachedProcesses.filter((proc) => proc.source === source.name);
    } else {
      try {
        processes = await source.discoverProcesses();
      } catch {
        processes = [];
      }
    }
    allProcesses.push(...processes);

    let transcripts: DiscoveredTranscript[] = [];
    try {
      transcripts = await source.discoverTranscripts(processes, scope);
    } catch {
      transcripts = [];
    }

    for (const transcript of transcripts) {
      const primary = processForTranscript(transcript, processes);
      const transcriptPath = transcript.transcriptPath;
      const key = transcriptKey(transcript);
      seenKeys.add(key);
      knownTranscripts.set(key, transcript);
      if (!watchers.has(key)) {
        const watcher: Watcher = {
          source,
          process: primary,
          transcript,
          transcriptPath,
          offset: 0,
          lineCounter: 0,
          carry: "",
          emittedEventIds: new Set(),
        };
        await seedTail(watcher);
        watchers.set(key, watcher);
      } else {
        // Refresh attribution in case a better-ranked process now owns this transcript.
        const existing = watchers.get(key)!;
        existing.process = primary;
        existing.transcript = transcript;
      }
    }
  }

  if (options.pruneMissing) {
    // Drop watchers whose transcript is no longer in the latest full-enough file inventory.
    for (const [key] of watchers) {
      if (!seenKeys.has(key)) {
        watchers.delete(key);
        knownTranscripts.delete(key);
      }
    }
  }

  const allTranscripts = dedupTranscriptsBySession([...knownTranscripts.values()])
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let scoutManaged = 0;
  let hudsonManaged = 0;
  let unattributed = 0;
  for (const proc of allProcesses) {
    if (proc.harness === "scout-managed") scoutManaged++;
    else if (proc.harness === "hudson-managed") hudsonManaged++;
    else unattributed++;
  }

  const snapshot: DiscoverySnapshot = {
    generatedAt: Date.now(),
    processes: allProcesses,
    transcripts: allTranscripts,
    totals: {
      total: allProcesses.length,
      scoutManaged,
      hudsonManaged,
      unattributed,
      transcripts: allTranscripts.length,
    },
  };
  lastDiscovery = snapshot;
  return snapshot;
}

function runDiscovery(
  scope: TailDiscoveryScope,
  options: { pruneMissing: boolean } = { pruneMissing: scope !== "hot" },
): Promise<DiscoverySnapshot> {
  if (discoveryInFlight) return discoveryInFlight;
  discoveryInFlight = refreshDiscovery(scope, options)
    .finally(() => {
      discoveryInFlight = null;
    });
  return discoveryInFlight;
}

function ensureLoopRunning(): void {
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void pumpAllWatchers();
    }, TAIL_POLL_INTERVAL_MS);
  }
  if (!hotDiscoveryTimer) {
    hotDiscoveryTimer = setInterval(() => {
      void runDiscovery("hot", { pruneMissing: false });
    }, HOT_DISCOVERY_INTERVAL_MS);
  }
  if (!shallowDiscoveryTimer) {
    shallowDiscoveryTimer = setInterval(() => {
      void runDiscovery("shallow", { pruneMissing: true });
    }, SHALLOW_DISCOVERY_INTERVAL_MS);
  }
  if (!deepDiscoveryTimer) {
    deepDiscoveryTimer = setInterval(() => {
      void runDiscovery("deep", { pruneMissing: true });
    }, DEEP_DISCOVERY_INTERVAL_MS);
  }
}

function stopLoopIfIdle(): void {
  if (subscribers.size > 0) return;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (hotDiscoveryTimer) {
    clearInterval(hotDiscoveryTimer);
    hotDiscoveryTimer = null;
  }
  if (shallowDiscoveryTimer) {
    clearInterval(shallowDiscoveryTimer);
    shallowDiscoveryTimer = null;
  }
  if (deepDiscoveryTimer) {
    clearInterval(deepDiscoveryTimer);
    deepDiscoveryTimer = null;
  }
  watchers.clear();
}

export async function getTailDiscovery(force = false): Promise<DiscoverySnapshot> {
  if (force) {
    return runDiscovery("deep", { pruneMissing: true });
  }
  if (lastDiscovery && Date.now() - lastDiscovery.generatedAt <= DISCOVERY_CACHE_MAX_AGE_MS) {
    return lastDiscovery;
  }
  return runDiscovery("shallow", { pruneMissing: true });
}

export function subscribeTail(handler: Subscriber): () => void {
  subscribers.add(handler);
  ensureLoopRunning();
  // Kick one moderate inventory pass immediately so the new subscriber is live;
  // after that, slower timers discover new movers.
  if (watchers.size === 0) {
    void runDiscovery("shallow", { pruneMissing: true }).then(() => pumpAllWatchers());
  } else {
    void pumpAllWatchers();
  }
  return () => {
    subscribers.delete(handler);
    if (subscribers.size === 0) {
      stopLoopIfIdle();
    }
  };
}

export function snapshotRecentEvents(limit = 500): TailEvent[] {
  return aggregateBuffer.slice(-limit);
}

export async function readRecentLiveEvents(limit = 500): Promise<TailEvent[]> {
  if (watchers.size === 0) {
    await runDiscovery("shallow", { pruneMissing: true });
  } else if (!lastDiscovery || Date.now() - lastDiscovery.generatedAt > DISCOVERY_CACHE_MAX_AGE_MS) {
    await runDiscovery("hot", { pruneMissing: false });
  }
  await pumpAllWatchers();
  return snapshotRecentEvents(limit);
}

async function readRecentTranscriptLines(
  path: string,
  maxLines = RECENT_TRANSCRIPT_LINES_PER_FILE,
  maxBytes = RECENT_TRANSCRIPT_READ_BYTES,
): Promise<string[]> {
  let handle: FileHandle | null = null;
  try {
    const stats = await stat(path);
    if (stats.size <= 0) return [];
    const start = Math.max(0, stats.size - maxBytes);
    const length = stats.size - start;
    const buffer = Buffer.alloc(length);
    handle = await open(path, "r");
    await handle.read(buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) {
      lines.shift();
    }
    return lines.filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function readRecentTranscriptEvents(
  limit = 50,
  options?: {
    discovery?: DiscoverySnapshot | null;
    perTranscriptLineLimit?: number;
  },
): Promise<TailEvent[]> {
  const discovery = options?.discovery ?? await getTailDiscovery();
  const events: TailEvent[] = [];
  const seenTranscripts = new Set<string>();
  const seenEvents = new Set<string>();

  const transcriptReadLimit = Math.min(RECENT_TRANSCRIPT_MAX_FILES, Math.max(12, limit));
  for (const transcript of discovery.transcripts.slice(0, transcriptReadLimit)) {
    const key = transcriptKey(transcript);
    if (seenTranscripts.has(key)) continue;
    seenTranscripts.add(key);
    const source = sources.find((candidate) => candidate.name === transcript.source);
    if (!source) continue;
    const process = processForTranscript(transcript, discovery.processes);
    if (source.parseFile) {
      const text = await readTranscriptText(transcript.transcriptPath);
      if (!text) continue;
      const parsed = parsedEventsToArray(source.parseFile(text, {
        process,
        transcript,
        transcriptPath: transcript.transcriptPath,
        lineOffset: 0,
      }));
      for (const event of parsed) {
        const compacted = compactEvent(event);
        if (!seenEvents.has(compacted.id)) {
          seenEvents.add(compacted.id);
          events.push(compacted);
        }
      }
      continue;
    }
    const lines = await readRecentTranscriptLines(
      transcript.transcriptPath,
      options?.perTranscriptLineLimit,
    );
    lines.forEach((line, index) => {
      const event = source.parseLine(line, {
        process,
        transcript,
        transcriptPath: transcript.transcriptPath,
        lineOffset: index,
      });
      if (event) {
        const compacted = compactEvent(event);
        const eventKey = [
          compacted.source,
          compacted.sessionId,
          compacted.kind,
          compacted.summary,
        ].join("\u0000");
        if (!seenEvents.has(eventKey)) {
          seenEvents.add(eventKey);
          events.push(compacted);
        }
      }
    });
  }

  return events
    .sort((left, right) => right.ts - left.ts)
    .slice(0, limit);
}

function normalizeTailSessionRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const leaf = basename(trimmed);
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

function transcriptMatchesSessionRef(
  transcript: DiscoveredTranscript,
  normalizedRef: string,
): boolean {
  const refs = [
    normalizeTailSessionRef(transcript.sessionId),
    normalizeTailSessionRef(transcript.transcriptPath),
  ].filter((ref): ref is string => Boolean(ref));
  return refs.includes(normalizedRef);
}

function snapshotSessionEvents(sessionId: string, limit: number): TailEvent[] {
  const bucket = perSessionBuffer.get(sessionId);
  if (bucket?.length) {
    return bucket.slice(-limit);
  }
  return aggregateBuffer
    .filter((event) => event.sessionId === sessionId)
    .slice(-limit);
}

async function parseTranscriptSessionEvents(
  transcript: DiscoveredTranscript,
  processes: DiscoveredProcess[],
  limit: number,
): Promise<TailEvent[]> {
  const source = sources.find((candidate) => candidate.name === transcript.source);
  if (!source) return [];

  const process = processForTranscript(transcript, processes);
  const ctxBase = {
    process,
    transcript,
    transcriptPath: transcript.transcriptPath,
    lineOffset: 0,
  };

  if (source.parseFile) {
    const text = await readTranscriptText(transcript.transcriptPath, SESSION_TRANSCRIPT_READ_BYTES);
    if (!text) return [];
    return parsedEventsToArray(source.parseFile(text, ctxBase))
      .sort((left, right) => left.ts - right.ts)
      .slice(-limit);
  }

  const lineBudget = Math.max(limit, RECENT_TRANSCRIPT_LINES_PER_FILE);
  const lines = await readRecentTranscriptLines(
    transcript.transcriptPath,
    lineBudget,
    SESSION_TRANSCRIPT_READ_BYTES,
  );
  const events: TailEvent[] = [];
  lines.forEach((line, index) => {
    const event = source.parseLine(line, {
      ...ctxBase,
      lineOffset: index,
    });
    if (event) {
      events.push(compactEvent(event));
    }
  });
  return events
    .sort((left, right) => left.ts - right.ts)
    .slice(-limit);
}

export async function readTailEventsForSession(
  sessionRef: string,
  options?: {
    discovery?: DiscoverySnapshot;
    limit?: number;
    forceDiscovery?: boolean;
  },
): Promise<{ transcript: DiscoveredTranscript; events: TailEvent[] } | null> {
  const normalizedRef = normalizeTailSessionRef(sessionRef);
  if (!normalizedRef) return null;

  const discovery = options?.discovery
    ?? await getTailDiscovery(options?.forceDiscovery ?? false);
  const transcript = discovery.transcripts.find(
    (candidate) => NATIVE_TAIL_SOURCES.has(candidate.source)
      && transcriptMatchesSessionRef(candidate, normalizedRef),
  );
  if (!transcript) return null;

  const limit = options?.limit ?? 2_000;
  const sessionId = transcript.sessionId?.trim() || normalizedRef;
  let events = snapshotSessionEvents(sessionId, limit);
  if (events.length === 0) {
    events = await parseTranscriptSessionEvents(transcript, discovery.processes, limit);
  }

  return { transcript, events };
}
