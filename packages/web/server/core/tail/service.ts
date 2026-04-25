import { open, stat, type FileHandle } from "node:fs/promises";

import { ClaudeSource } from "./claude-source.ts";
import type {
  DiscoveredProcess,
  DiscoverySnapshot,
  TailEvent,
  TranscriptSource,
} from "./types.ts";

const POLL_INTERVAL_MS = 500;
const DISCOVERY_INTERVAL_MS = 5_000;
const PER_SESSION_BUFFER_LIMIT = 2_000;
const AGGREGATE_BUFFER_LIMIT = 10_000;

type Subscriber = (event: TailEvent) => void;

type Watcher = {
  source: TranscriptSource;
  process: DiscoveredProcess;
  transcriptPath: string;
  offset: number;
  lineCounter: number;
  carry: string;
};

const sources: TranscriptSource[] = [ClaudeSource];

const watchers = new Map<string, Watcher>(); // key = `${source}:${pid}:${transcriptPath}`
const aggregateBuffer: TailEvent[] = [];
const perSessionBuffer = new Map<string, TailEvent[]>();
const subscribers = new Set<Subscriber>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let discoveryTimer: ReturnType<typeof setInterval> | null = null;
let lastDiscovery: DiscoverySnapshot | null = null;

function watcherKey(source: string, pid: number, path: string): string {
  return `${source}:${pid}:${path}`;
}

function pushEvent(event: TailEvent): void {
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

async function readNew(handle: FileHandle, fromOffset: number): Promise<{ text: string; nextOffset: number }> {
  const stats = await handle.stat();
  if (stats.size <= fromOffset) {
    return { text: "", nextOffset: fromOffset };
  }
  const length = stats.size - fromOffset;
  const buffer = Buffer.alloc(length);
  await handle.read(buffer, 0, length, fromOffset);
  return { text: buffer.toString("utf8"), nextOffset: stats.size };
}

async function pumpWatcher(watcher: Watcher): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(watcher.transcriptPath, "r");
    const stats = await handle.stat();
    if (stats.size < watcher.offset) {
      // File was rotated/truncated; reset.
      watcher.offset = 0;
      watcher.carry = "";
    }
    const { text, nextOffset } = await readNew(handle, watcher.offset);
    watcher.offset = nextOffset;
    if (!text) return;
    const combined = watcher.carry + text;
    const lines = combined.split("\n");
    watcher.carry = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const event = watcher.source.parseLine(line, {
        process: watcher.process,
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
    watcher.offset = stats.size;
  } catch {
    watcher.offset = 0;
  }
}

async function refreshDiscovery(): Promise<DiscoverySnapshot> {
  const allProcesses: DiscoveredProcess[] = [];
  const seenKeys = new Set<string>();

  for (const source of sources) {
    let processes: DiscoveredProcess[] = [];
    try {
      processes = await source.discoverProcesses();
    } catch {
      processes = [];
    }
    for (const proc of processes) {
      allProcesses.push(proc);
      const transcriptPath = source.resolveTranscriptPath(proc);
      if (!transcriptPath) continue;
      const key = watcherKey(source.name, proc.pid, transcriptPath);
      seenKeys.add(key);
      if (!watchers.has(key)) {
        const watcher: Watcher = {
          source,
          process: proc,
          transcriptPath,
          offset: 0,
          lineCounter: 0,
          carry: "",
        };
        await seedTail(watcher);
        watchers.set(key, watcher);
      } else {
        // Update process info in case ppid/etime changed
        const existing = watchers.get(key)!;
        existing.process = proc;
      }
    }
  }

  // Drop watchers whose process is no longer running.
  for (const [key] of watchers) {
    if (!seenKeys.has(key)) {
      watchers.delete(key);
    }
  }

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
    totals: {
      total: allProcesses.length,
      scoutManaged,
      hudsonManaged,
      unattributed,
    },
  };
  lastDiscovery = snapshot;
  return snapshot;
}

function ensureLoopRunning(): void {
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void pumpAllWatchers();
    }, POLL_INTERVAL_MS);
  }
  if (!discoveryTimer) {
    discoveryTimer = setInterval(() => {
      void refreshDiscovery();
    }, DISCOVERY_INTERVAL_MS);
  }
}

function stopLoopIfIdle(): void {
  if (subscribers.size > 0) return;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
  watchers.clear();
}

export async function getTailDiscovery(force = false): Promise<DiscoverySnapshot> {
  if (!force && lastDiscovery && Date.now() - lastDiscovery.generatedAt < 2_000) {
    return lastDiscovery;
  }
  return refreshDiscovery();
}

export function subscribeTail(handler: Subscriber): () => void {
  subscribers.add(handler);
  ensureLoopRunning();
  // Kick discovery + first pump immediately so the new subscriber is live.
  void refreshDiscovery().then(() => pumpAllWatchers());
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
