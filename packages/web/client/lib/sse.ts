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

function parseBrokerEvent(data: string): BrokerEvent {
  try {
    return JSON.parse(data) as BrokerEvent;
  } catch {
    return { kind: "unknown" };
  }
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
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    function connect() {
      es = new EventSource("/api/events");

      const forward = (event: MessageEvent<string>) => {
        cbRef.current(parseBrokerEvent(event.data));
      };

      es.onopen = () => { failures = 0; };
      es.onmessage = forward;
      for (const eventName of BROKER_EVENT_NAMES) {
        es.addEventListener(eventName, forward as EventListener);
      }

      es.onerror = () => {
        es?.close();
        failures++;
        const delay = Math.min(3000 * 2 ** (failures - 1), 60_000);
        retryTimeout = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);
}
