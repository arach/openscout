import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import {
  engageScoutVoiceDictation,
  ensureScoutVoiceAutoProbe,
  formatScoutVoiceIssue,
  getSharedScoutVoiceClient,
  subscribeScoutVoiceProbe,
  type ScoutVoiceIssue,
  type ScoutVoiceLiveHandle,
  type ScoutVoiceSessionState,
} from "../lib/scout-voice.ts";

import "./dictation-mic.css";

export type MicSessionState = "idle" | "starting" | "recording" | "processing";

type MicProbeState = "probing" | "idle" | "launching";

export type MicStatus = {
  state: MicSessionState;
  partial: string;
  message: string | null;
};

function sessionStateFromVoice(state: ScoutVoiceSessionState): MicSessionState {
  switch (state) {
    case "starting":
      return "starting";
    case "recording":
      return "recording";
    case "processing":
      return "processing";
    default:
      return "idle";
  }
}

function statusMessageForState(
  state: MicSessionState,
  partial: string,
  fallback: string | null,
): string | null {
  if (fallback) return fallback;
  switch (state) {
    case "starting":
      return "Starting voice…";
    case "recording":
      return partial.trim() ? partial.trim() : "Listening…";
    case "processing":
      return "Transcribing…";
    default:
      return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function DictationMic({
  onAppend,
  onError,
  onStatus,
  disabled,
  className,
}: {
  onAppend: (text: string) => void;
  onError?: (message: string) => void;
  onStatus?: (status: MicStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  const clientRef = useRef(getSharedScoutVoiceClient());
  const liveRef = useRef<ScoutVoiceLiveHandle | null>(null);
  const [sessionState, setSessionState] = useState<MicSessionState>("idle");
  const [partialText, setPartialText] = useState("");
  const [probeState, setProbeState] = useState<MicProbeState>("probing");
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [engageIssue, setEngageIssue] = useState<ScoutVoiceIssue | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const reportError = useCallback((message: string) => {
    setLastError(message);
    onError?.(message);
  }, [onError]);

  const emitStatus = useCallback((state: MicSessionState, partial: string, message: string | null) => {
    onStatus?.({
      state,
      partial,
      message: statusMessageForState(state, partial, message),
    });
  }, [onStatus]);

  useEffect(() => {
    emitStatus(sessionState, partialText, lastError);
  }, [emitStatus, lastError, partialText, sessionState]);

  const probeVoice = useCallback(async (force = false) => {
    const client = clientRef.current;
    setProbeState((state) => (state === "launching" ? state : "probing"));
    const ok = await client.probe(force ? { force: true } : undefined);
    setVoiceReady(ok);
    setEngageIssue(null);
    setProbeState("idle");
    return ok;
  }, []);

  useEffect(() => {
    ensureScoutVoiceAutoProbe();
    const client = clientRef.current;

    const unsubscribe = subscribeScoutVoiceProbe((snapshot) => {
      setVoiceReady(snapshot.ok);
      setEngageIssue(null);
      setProbeState("idle");
    });

    if (client.connectionState === "unknown") {
      void probeVoice();
    } else {
      setVoiceReady(client.connectionState === "connected");
      setEngageIssue(null);
      setProbeState("idle");
    }

    return () => {
      unsubscribe();
      const live = liveRef.current;
      if (live) {
        void live.cancel().catch(() => undefined);
        liveRef.current = null;
      }
    };
  }, [probeVoice]);

  const startRecording = useCallback(async () => {
    const client = clientRef.current;
    setLastError(null);
    setPartialText("");
    setSessionState("starting");

    let engagement = await engageScoutVoiceDictation({
      surface: "chat-composer",
      requestPermissions: true,
    });

    if (!engagement.ready && engagement.issue?.code === "microphone_not_requested") {
      await wait(1800);
      engagement = await engageScoutVoiceDictation({ surface: "chat-composer" });
    }

    const canAttemptCapture = engagement.ready
      || engagement.issue?.code === "microphone_not_requested";

    if (!canAttemptCapture) {
      setSessionState("idle");
      const issue = engagement.issue;
      if (issue) {
        setEngageIssue(issue);
        reportError(formatScoutVoiceIssue(issue));
      } else {
        reportError("Scout voice is not ready.");
      }
      void probeVoice(true);
      return;
    }

    setEngageIssue(null);
    setVoiceReady(true);

    let live: ScoutVoiceLiveHandle | null = null;
    try {
      live = await client.startLive({
        onState: (state) => setSessionState(sessionStateFromVoice(state)),
        onPartial: (text) => setPartialText(text),
      });
      liveRef.current = live;
      setSessionState("recording");
      const final = await live.result;
      liveRef.current = null;
      setSessionState("idle");
      setPartialText("");
      setLastError(null);
      const text = final.text?.trim();
      if (text) {
        onAppend(text);
      } else {
        reportError("No speech was detected. Check your microphone in Settings → Voice.");
      }
      void probeVoice(true);
    } catch (error) {
      liveRef.current = null;
      setSessionState("idle");
      setPartialText("");
      const message = error instanceof Error ? error.message : "Scout voice recording failed.";
      if (error instanceof Error && error.name === "AbortError") return;
      reportError(message);
      void probeVoice(true);
    }
  }, [onAppend, probeVoice, reportError]);

  const stopRecording = useCallback(async () => {
    const live = liveRef.current;
    if (!live) return;
    setSessionState("processing");
    try {
      await live.stop();
    } catch (error) {
      try { await live.cancel(); } catch { /* swallow */ }
      liveRef.current = null;
      setSessionState("idle");
      setPartialText("");
      const message = error instanceof Error ? error.message : "Scout voice recording did not finish.";
      reportError(message);
    }
  }, [reportError]);

  const onClick = useCallback(() => {
    if (sessionState === "recording") {
      void stopRecording();
      return;
    }
    if (sessionState === "processing" || sessionState === "starting") return;
    void startRecording();
  }, [sessionState, startRecording, stopRecording]);

  const isRecording = sessionState === "recording";
  const isBusy =
    probeState === "launching"
    || sessionState === "starting"
    || sessionState === "processing";
  const needsPermission = (
    clientRef.current.canRequestMicrophone
    || engageIssue?.action === "request_microphone"
    || engageIssue?.action === "request_speech"
  ) && !isRecording && !isBusy;
  const hardDenied = (
    clientRef.current.isMicrophoneHardDenied
    || engageIssue?.action === "open_microphone_settings"
  ) && !isRecording && !isBusy;
  const showUnavailable = (voiceReady === false || engageIssue !== null) && !needsPermission && !hardDenied && !isRecording && !isBusy;

  const title = lastError
    ? lastError
    : engageIssue
      ? engageIssue.title
      : hardDenied
        ? "Microphone blocked. Open Privacy & Security → Microphone to change it."
      : needsPermission
        ? "Allow microphone access"
      : showUnavailable
      ? "Scout voice is not ready"
      : probeState === "probing"
        ? "Checking voice…"
        : isRecording
          ? "Stop dictation"
          : sessionState === "processing"
            ? "Transcribing…"
            : sessionState === "starting"
              ? "Starting voice…"
              : "Dictate";

  const stateClass =
    lastError ? "s-dictation-mic--error"
    : isRecording ? "s-dictation-mic--recording"
    : hardDenied ? "s-dictation-mic--error"
    : needsPermission ? "s-dictation-mic--needs-permission"
    : showUnavailable ? "s-dictation-mic--unavailable"
    : isBusy ? "s-dictation-mic--busy"
    : "";

  const Icon = isBusy ? Loader2 : isRecording ? Square : Mic;
  const iconSize = isRecording ? 12 : 14;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={isRecording}
      onClick={onClick}
      disabled={disabled || sessionState === "processing"}
      className={["s-dictation-mic", stateClass, className].filter(Boolean).join(" ")}
    >
      <Icon
        size={iconSize}
        className={isBusy ? "s-dictation-mic-spin" : isRecording ? "fill-current" : ""}
      />
    </button>
  );
}
