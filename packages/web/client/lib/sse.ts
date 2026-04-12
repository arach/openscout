import { useEffect, useRef } from "react";

/**
 * Subscribe to the broker SSE event stream.
 * Calls `onEvent` whenever the broker emits any event.
 * Auto-reconnects on error with a 5-second delay.
 */
export function useBrokerEvents(onEvent: () => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");
      es.onmessage = () => cbRef.current();
      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);
}
