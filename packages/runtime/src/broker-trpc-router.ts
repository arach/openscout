// Broker tRPC router — typed surface for cross-process consumers (bridge, web).
//
// Today: tail.events plus topology snapshots/events. Future: agent-activity,
// control events, etc. Each new firehose endpoint adds a procedure here;
// consumers get full type inference end-to-end via `BrokerRouter`.
//
// The router is mounted by broker-daemon.ts via @trpc/server/adapters/ws onto
// the existing http server's upgrade event for path /trpc.
//
// See docs/tail-firehose.md.

import { initTRPC, tracked } from "@trpc/server";
// Importing this side-effect-free type pulls the internal tRPC module path
// into our import graph, which lets `tsc --declaration` reference it without
// emitting the "inferred type cannot be named" error (TS2742).
import type {} from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import {
  snapshotRecentEvents,
  subscribeTail,
  type TailEvent,
} from "./tail/index.js";
import {
  getHarnessTopologySnapshot,
  snapshotRecentHarnessTopologyEvents,
  subscribeHarnessTopology,
  type HarnessTopologyEvent,
} from "./harness-topology/index.js";

const t = initTRPC.create();

const TAIL_BACKLOG_LIMIT = 500;
const TOPOLOGY_BACKLOG_LIMIT = 200;

const tailEventsInput = z
  .object({
    since: z.string().optional(),
    sources: z.array(z.string()).optional(),
  })
  .optional();

const topologyEventsInput = z
  .object({
    since: z.string().optional(),
    sources: z.array(z.string()).optional(),
  })
  .optional();

/**
 * Async iterable adapter over the singleton tail watcher. Each subscriber
 * registers its own listener; the underlying file watcher is shared.
 */
function tailEventIterable(
  sources: string[] | undefined,
  signal?: AbortSignal,
): AsyncIterable<TailEvent> {
  return {
    [Symbol.asyncIterator]() {
      const buffer: TailEvent[] = [];
      let resolve: (() => void) | null = null;
      let done = false;

      const filter = sources && sources.length > 0 ? new Set(sources) : null;

      const unsub = subscribeTail((event: TailEvent) => {
        if (done) return;
        if (filter && !filter.has(event.source)) return;
        buffer.push(event);
        if (resolve) {
          resolve();
          resolve = null;
        }
      });

      const cleanup = () => {
        done = true;
        unsub();
        if (resolve) {
          resolve();
          resolve = null;
        }
      };

      signal?.addEventListener("abort", cleanup, { once: true });

      return {
        async next(): Promise<IteratorResult<TailEvent>> {
          while (true) {
            if (done) return { done: true, value: undefined };
            if (buffer.length > 0) {
              return { done: false, value: buffer.shift()! };
            }
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
        },
        async return(): Promise<IteratorResult<TailEvent>> {
          cleanup();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function topologyEventIterable(
  sources: string[] | undefined,
  signal?: AbortSignal,
): AsyncIterable<HarnessTopologyEvent> {
  return {
    [Symbol.asyncIterator]() {
      const buffer: HarnessTopologyEvent[] = [];
      let resolve: (() => void) | null = null;
      let done = false;

      const filter = sources && sources.length > 0 ? new Set(sources) : null;

      const unsub = subscribeHarnessTopology((event: HarnessTopologyEvent) => {
        if (done) return;
        if (filter && !filter.has(event.source)) return;
        buffer.push(event);
        if (resolve) {
          resolve();
          resolve = null;
        }
      });

      const cleanup = () => {
        done = true;
        unsub();
        if (resolve) {
          resolve();
          resolve = null;
        }
      };

      signal?.addEventListener("abort", cleanup, { once: true });

      return {
        async next(): Promise<IteratorResult<HarnessTopologyEvent>> {
          while (true) {
            if (done) return { done: true, value: undefined };
            if (buffer.length > 0) {
              return { done: false, value: buffer.shift()! };
            }
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
        },
        async return(): Promise<IteratorResult<HarnessTopologyEvent>> {
          cleanup();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

const tailRouter = t.router({
  events: t.procedure
    .input(tailEventsInput)
    .subscription(async function* ({ input, signal }) {
      const sources = input?.sources;
      const filter = sources && sources.length > 0 ? new Set(sources) : null;

      // Replay backlog from cursor (if any) before switching to live tail.
      const backlog = snapshotRecentEvents(TAIL_BACKLOG_LIMIT);
      let startIdx = 0;
      if (input?.since) {
        const idx = backlog.findIndex((e: TailEvent) => e.id === input.since);
        if (idx >= 0) startIdx = idx + 1;
      }
      for (let i = startIdx; i < backlog.length; i++) {
        const event = backlog[i];
        if (!event) continue;
        if (filter && !filter.has(event.source)) continue;
        yield tracked(event.id, event);
      }

      // Live tail. tracked(event.id, ...) lets clients reconnect with
      // lastEventId and pick up exactly where they left off.
      for await (const event of tailEventIterable(sources, signal)) {
        yield tracked(event.id, event);
      }
    }),
});

const topologyRouter = t.router({
  snapshot: t.procedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .query(({ input }) => getHarnessTopologySnapshot(Boolean(input?.force))),
  events: t.procedure
    .input(topologyEventsInput)
    .subscription(async function* ({ input, signal }) {
      const sources = input?.sources;
      const filter = sources && sources.length > 0 ? new Set(sources) : null;

      const backlog = snapshotRecentHarnessTopologyEvents(TOPOLOGY_BACKLOG_LIMIT);
      let startIdx = 0;
      if (input?.since) {
        const idx = backlog.findIndex((e: HarnessTopologyEvent) => e.id === input.since);
        if (idx >= 0) startIdx = idx + 1;
      }
      for (let i = startIdx; i < backlog.length; i++) {
        const event = backlog[i];
        if (!event) continue;
        if (filter && !filter.has(event.source)) continue;
        yield tracked(event.id, event);
      }

      for await (const event of topologyEventIterable(sources, signal)) {
        yield tracked(event.id, event);
      }
    }),
});

export const brokerRouter = t.router({
  tail: tailRouter,
  topology: topologyRouter,
});

export type BrokerRouter = typeof brokerRouter;
