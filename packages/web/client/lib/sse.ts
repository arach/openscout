import { useEffect, useRef } from "react";

export type BrokerEvent = {
  kind: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

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

    function connect() {
      es = new EventSource("/api/events");
      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data) as BrokerEvent;
          cbRef.current(parsed);
        } catch {
          // Non-JSON event (keepalive, etc.) — still trigger a generic refresh
          cbRef.current({ kind: "unknown" });
        }
      };
      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);
}
