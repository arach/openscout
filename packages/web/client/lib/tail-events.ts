import { useEffect, useRef } from "react";
import type { TailEvent } from "./types.ts";

type TailSubscription = (event: TailEvent) => void;

const subscribers = new Set<TailSubscription>();
let eventSource: EventSource | null = null;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

function parseTailEvent(data: string): TailEvent | null {
  try {
    return JSON.parse(data) as TailEvent;
  } catch {
    return null;
  }
}

function dispatch(event: TailEvent): void {
  for (const subscriber of [...subscribers]) {
    subscriber(event);
  }
}

function closeEventSource(): void {
  eventSource?.close();
  eventSource = null;
}

function scheduleReconnect(): void {
  if (retryTimeout || subscribers.size === 0) return;
  failures++;
  const delay = Math.min(2_000 * 2 ** (failures - 1), 30_000);
  retryTimeout = setTimeout(() => {
    retryTimeout = null;
    if (subscribers.size > 0) connect();
  }, delay);
}

function connect(): void {
  if (eventSource || subscribers.size === 0) return;
  const es = new EventSource("/api/tail/stream");
  eventSource = es;

  const forward = (msg: MessageEvent<string>) => {
    const parsed = parseTailEvent(msg.data);
    if (parsed) dispatch(parsed);
  };

  es.onopen = () => {
    failures = 0;
  };
  es.onmessage = forward;
  es.addEventListener("ready", () => {
    failures = 0;
  });

  es.onerror = () => {
    if (eventSource === es) {
      closeEventSource();
    } else {
      es.close();
    }
    scheduleReconnect();
  };
}

export function useTailEvents(onEvent: (event: TailEvent) => void): void {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    const subscriber: TailSubscription = (event) => cbRef.current(event);
    subscribers.add(subscriber);
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    connect();
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        if (retryTimeout) {
          clearTimeout(retryTimeout);
          retryTimeout = null;
        }
        failures = 0;
        closeEventSource();
      }
    };
  }, []);
}
