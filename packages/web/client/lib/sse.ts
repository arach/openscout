import { useEffect, useRef } from "react";

export type BrokerEvent = {
  kind: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

const BROKER_EVENT_NAMES = [
  "hello",
  "node.upserted",
  "actor.registered",
  "agent.registered",
  "agent.endpoint.upserted",
  "conversation.upserted",
  "binding.upserted",
  "message.posted",
  "invocation.requested",
  "flight.updated",
  "delivery.planned",
  "delivery.attempted",
  "delivery.state.changed",
  "collaboration.upserted",
  "collaboration.event.appended",
  "scout.dispatched",
] as const;

type BrokerEventSubscription = (event: BrokerEvent) => void;

const subscribers = new Set<BrokerEventSubscription>();

let eventSource: EventSource | null = null;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

function parseBrokerEvent(data: string): BrokerEvent {
  try {
    return JSON.parse(data) as BrokerEvent;
  } catch {
    return { kind: "unknown" };
  }
}

function closeEventSource(): void {
  eventSource?.close();
  eventSource = null;
}

function scheduleReconnect(): void {
  if (retryTimeout || subscribers.size === 0) {
    return;
  }
  failures++;
  const delay = Math.min(3000 * 2 ** (failures - 1), 60_000);
  retryTimeout = setTimeout(() => {
    retryTimeout = null;
    if (subscribers.size > 0) {
      connectToBrokerEvents();
    }
  }, delay);
}

function dispatchBrokerEvent(event: BrokerEvent): void {
  for (const subscriber of [...subscribers]) {
    subscriber(event);
  }
}

function connectToBrokerEvents(): void {
  if (eventSource || subscribers.size === 0) {
    return;
  }

  const es = new EventSource("/api/events");
  eventSource = es;

  const forward = (event: MessageEvent<string>) => {
    dispatchBrokerEvent(parseBrokerEvent(event.data));
  };

  es.onopen = () => {
    failures = 0;
  };
  es.onmessage = forward;
  for (const eventName of BROKER_EVENT_NAMES) {
    es.addEventListener(eventName, forward as EventListener);
  }

  es.onerror = () => {
    if (eventSource === es) {
      closeEventSource();
    } else {
      es.close();
    }
    scheduleReconnect();
  };
}

function subscribeBrokerEvents(handler: BrokerEventSubscription): () => void {
  subscribers.add(handler);
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  connectToBrokerEvents();

  return () => {
    subscribers.delete(handler);
    if (subscribers.size > 0) {
      return;
    }
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    failures = 0;
    closeEventSource();
  };
}

/**
 * Subscribe to the broker SSE event stream.
 * Calls `onEvent` with the parsed event whenever the broker emits one.
 * Auto-reconnects on error with a 3-second delay.
 */
export function useBrokerEvents(onEvent: (event: BrokerEvent) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    return subscribeBrokerEvents((event) => {
      cbRef.current(event);
    });
  }, []);
}
