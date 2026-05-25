import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import { VoxBrowserClient, type VoxLiveHandle } from "../lib/vox.ts";

import "./dictation-mic.css";

type MicState = "probing" | "idle" | "starting" | "recording" | "processing" | "unavailable";

export function DictationMic({
  onAppend,
  disabled,
  className,
}: {
  onAppend: (text: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const clientRef = useRef<VoxBrowserClient | null>(null);
  const liveRef = useRef<VoxLiveHandle | null>(null);
  const [state, setState] = useState<MicState>("probing");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = new VoxBrowserClient();
    clientRef.current = client;
    void client.probe().then((ok) => {
      if (cancelled) return;
      if (ok) {
        setState("idle");
        setUnavailableReason(null);
      } else {
        setState("unavailable");
        setUnavailableReason(client.lastUnavailableReason ?? "Voice unavailable — open Ranger to launch Vox.");
      }
    });
    return () => {
      cancelled = true;
      const live = liveRef.current;
      if (live) {
        void live.cancel().catch(() => undefined);
        liveRef.current = null;
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setState("starting");
    let live: VoxLiveHandle | null = null;
    try {
      live = await client.startLive({
        onState: () => undefined,
        onPartial: () => undefined,
      });
      liveRef.current = live;
      setState("recording");
      const final = await live.result;
      liveRef.current = null;
      setState("idle");
      const text = final.text?.trim();
      if (text) onAppend(text);
    } catch {
      liveRef.current = null;
      setState("idle");
    }
  }, [onAppend]);

  const stopRecording = useCallback(async () => {
    const live = liveRef.current;
    if (!live) return;
    setState("processing");
    try {
      await live.stop();
    } catch {
      try { await live.cancel(); } catch { /* swallow */ }
      liveRef.current = null;
      setState("idle");
    }
  }, []);

  const onClick = useCallback(() => {
    if (state === "recording") void stopRecording();
    else if (state === "idle") void startRecording();
  }, [state, startRecording, stopRecording]);

  const isBusy = state === "starting" || state === "processing";
  const isUnavailable = state === "unavailable" || state === "probing";
  const title =
    state === "unavailable" ? (unavailableReason ?? "Voice unavailable")
    : state === "probing" ? "Checking voice…"
    : state === "recording" ? "Stop dictation"
    : isBusy ? "Working…"
    : "Dictate";

  const stateClass =
    state === "recording" ? "s-dictation-mic--recording"
    : isBusy ? "s-dictation-mic--busy"
    : "";

  const Icon = isBusy ? Loader2 : state === "recording" ? Square : Mic;
  const iconSize = state === "recording" ? 12 : 14;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={state === "recording"}
      onClick={onClick}
      disabled={disabled || isUnavailable || isBusy}
      className={["s-dictation-mic", stateClass, className].filter(Boolean).join(" ")}
    >
      <Icon
        size={iconSize}
        className={isBusy ? "s-dictation-mic-spin" : state === "recording" ? "fill-current" : ""}
      />
    </button>
  );
}
