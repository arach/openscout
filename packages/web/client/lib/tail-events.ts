// Web client subscription to the broker's tail.events firehose via tRPC over
// WebSocket. Single shared connection across all React subscribers.
//
// See docs/tail-firehose.md.

import { useEffect, useRef } from "react";
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { BrokerRouter } from "@openscout/runtime/broker-trpc-router";

import type { TailEvent } from "./types.ts";

type TailSubscription = (event: TailEvent) => void;

const subscribers = new Set<TailSubscription>();
let wsClient: ReturnType<typeof createWSClient> | null = null;
let trpc: ReturnType<typeof createTRPCClient<BrokerRouter>> | null = null;
let activeSub: { unsubscribe: () => void } | null = null;

function brokerWsUrl(): string {
  // Broker runs on a well-known port (65535). The web app may be served from
  // a different origin (vite dev, or the bundled web server), but the broker
  // is always reachable on the same hostname.
  const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
  const port = 65535;
  return `ws://${host}:${port}/trpc`;
}

function dispatch(event: TailEvent): void {
  for (const subscriber of [...subscribers]) {
    subscriber(event);
  }
}

function ensureSubscribed(): void {
  if (activeSub) return;
  if (!wsClient) {
    wsClient = createWSClient({ url: brokerWsUrl() });
    trpc = createTRPCClient<BrokerRouter>({ links: [wsLink({ client: wsClient })] });
  }
  activeSub = trpc!.tail.events.subscribe(undefined, {
    onData: (data) => {
      // tRPC `tracked` envelope: { id, data }.
      const event = (data as { data: TailEvent }).data;
      if (event) dispatch(event);
    },
  });
}

function teardown(): void {
  activeSub?.unsubscribe();
  activeSub = null;
  // Keep wsClient open across re-mounts; tRPC handles reconnection.
}

export function useTailEvents(onEvent: (event: TailEvent) => void): void {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    const subscriber: TailSubscription = (event) => cbRef.current(event);
    subscribers.add(subscriber);
    ensureSubscribed();
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        teardown();
      }
    };
  }, []);
}
