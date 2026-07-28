import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { NativeScoutSurfaceClient, installScoutSurfacePushReceiver } from "../../surface-contract/native-scout-surface-client.ts";
import type {
  CodexDeckBlock,
  CodexDeckRoute,
  CodexDeckThreadSnapshot,
  FleetAgentSnapshot,
  FleetTailSnapshot,
  NativeVoiceSnapshot,
  SurfaceAgent,
  SurfaceBootstrap,
  SurfaceHost,
  SurfaceTailEvent,
} from "../../surface-contract/scout-surface-contract.ts";
import "./scout-deck.css";

type DeckLane = SurfaceAgent & {
  key: string;
  hostId: string;
  hostName: string;
  events: readonly SurfaceTailEvent[];
};

type DeckConnection = "waiting" | "ready" | "partial" | "offline" | "error";
type DeckView = "thread" | "signal";
type DeckHostScope = "all" | string;
type DeckSignalTone = "live" | "ready" | "attention" | "quiet";

/**
 * The turn lifecycle the operator actually reasons about. It merges three
 * separate truths — does this lane have a native adapter, is its thread bound,
 * and is a turn in flight — into one ordered state so the Deck never has to
 * imply progress it cannot observe.
 */
type DeckTurnPhase =
  | "unavailable"
  | "cold"
  | "linking"
  | "failed"
  | "ready"
  | "sending"
  | "running"
  | "stopping";

/** Locally-known intent awaiting host confirmation. Never rendered as fact. */
type DeckPending = { kind: "connecting" | "sending" | "stopping"; at: number };

/** How long an unconfirmed local intent may claim the lifecycle before we admit it. */
const PENDING_TIMEOUT_MS = 9_000;

const HOST_SCOPE_STORAGE_KEY = "scout.deck.hostScope";

declare global {
  interface Window {
    __scoutSurfaceBootstrap?: Partial<SurfaceBootstrap>;
  }
}

const PREVIEW_HOSTS: SurfaceHost[] = [
  { id: "air", name: "MacBook Air", state: "connected" },
  { id: "studio", name: "Studio", state: "connected" },
];

const now = Date.now();
const PREVIEW_LANES: DeckLane[] = [
  previewLane("air", "MacBook Air", "01", "OpenScout", "codex", "gpt-5.6", "active", "~/dev/openscout", [
    ["tool", "Verifying the native surface bundle", "bun run build:native-surfaces"],
    ["think", "Mapping the Deck to the Codex Desktop task", "Task state stays binary-native and host-scoped."],
    ["message", "Controller contract is live.", "Start, steer, and interrupt map directly to the selected thread."],
  ]),
  previewLane("studio", "Studio", "02", "SpeakEasy", "claude", "opus-5", "active", "~/dev/SpeakEasy", [
    ["message", "Control deck reference review", "Channel bank, focused stage, and restrained signal color."],
    ["tool", "Captured iPad landscape states", "Connected, partial, and offline."],
    ["think", "Keep harness semantics explicit", "A future Claude adapter can earn its own control vocabulary."],
  ]),
  previewLane("air", "MacBook Air", "03", "Hudson", "claude", "sonnet-5", "waiting", "~/dev/hudson", [
    ["message", "Waiting for operator review", "One navigation decision needs attention."],
    ["note", "Candidate build is ready", "No active tool call."],
  ]),
  previewLane("studio", "Studio", "04", "Release", "codex", "gpt-5.4", "idle", "~/dev/openscout", [
    ["system", "Last run completed", "Checks passed 18 minutes ago."],
  ]),
];

const PREVIEW_THREAD: CodexDeckThreadSnapshot = {
  adapter: "codex_desktop",
  agentId: "01",
  threadId: "019fa45a-scout-deck",
  turnId: "turn_8d17",
  state: "running",
  capabilities: {
    connect: true,
    start: true,
    steer: true,
    interrupt: true,
    queue: false,
    approvals: false,
  },
  capabilityNotes: {
    queue: "A Codex Desktop task runs one active turn at a time; the Deck does not invent a client-side queue.",
    approvals: "Approvals remain owned by Codex Desktop and must be resolved there.",
  },
  snapshot: {
    session: {
      id: "019fa45a-scout-deck",
      name: "Rework the Deck turn flow",
      adapterType: "codex",
      status: "active",
      cwd: "/Users/arach/dev/openscout",
      model: "gpt-5.6",
      providerMeta: { threadId: "019fa45a-scout-deck" },
    },
    currentTurnId: "turn_8d17",
    turns: [
      {
        id: "turn_8d11",
        status: "completed",
        startedAt: now - 214_000,
        endedAt: now - 176_000,
        isUserTurn: true,
        blocks: [{
          status: "completed",
          block: {
            id: "input_8d11",
            turnId: "turn_8d11",
            type: "text",
            status: "completed",
            index: 0,
            text: "Make the Deck operate on the selected Codex Desktop task directly.",
          },
        }],
      },
      {
        id: "turn_8d15",
        status: "completed",
        startedAt: now - 164_000,
        endedAt: now - 71_000,
        isUserTurn: false,
        blocks: [
          {
            status: "completed",
            block: {
              id: "reason_8d15",
              turnId: "turn_8d15",
              type: "reasoning",
              status: "completed",
              index: 0,
              text: "Tracing the trusted bridge to the Codex Desktop-owned task.",
            },
          },
          {
            status: "completed",
            block: {
              id: "tool_8d15",
              turnId: "turn_8d15",
              type: "action",
              status: "completed",
              index: 1,
              action: {
                kind: "command",
                status: "completed",
                command: "bun run build:native-surfaces",
                output: "native surfaces validated",
              },
            },
          },
          {
            status: "completed",
            block: {
              id: "text_8d15",
              turnId: "turn_8d15",
              type: "text",
              status: "completed",
              index: 2,
              text: "The control path is separated from Scout messaging and keeps Codex semantics visible.",
            },
          },
        ],
      },
      {
        id: "turn_8d17",
        status: "streaming",
        startedAt: now - 43_000,
        isUserTurn: false,
        blocks: [
          {
            status: "streaming",
            block: {
              id: "reason_8d17",
              turnId: "turn_8d17",
              type: "reasoning",
              status: "streaming",
              index: 0,
              text: "Refining the controller hierarchy for iPad landscape.",
            },
          },
          {
            status: "streaming",
            block: {
              id: "tool_8d17",
              turnId: "turn_8d17",
              type: "action",
              status: "streaming",
              index: 1,
              action: {
                kind: "command",
                status: "running",
                command: "bun test scout-surface-contract",
                output: "running focused contract checks…",
              },
            },
          },
        ],
      },
    ],
  },
};

const PREVIEW_VOICE: NativeVoiceSnapshot = {
  input: {
    state: "idle",
    partialText: "",
    finalText: "",
    finalCount: 0,
    engine: "parakeet",
    modelReady: true,
    unavailableReason: null,
  },
  output: { speaking: false },
};

export function ScoutDeckSurface() {
  const search = new URLSearchParams(window.location.search);
  const preview = search.has("preview") || (import.meta.env.DEV && !search.has("offline"));
  const initialVoice = preview && search.get("voice") === "listening"
    ? {
      ...PREVIEW_VOICE,
      input: {
        ...PREVIEW_VOICE.input,
        state: "listening" as const,
        partialText: "Make voice the fastest path into this active turn.",
      },
    }
    : PREVIEW_VOICE;
  const [bootstrap, setBootstrap] = useState<Partial<SurfaceBootstrap> | null>(
    () => window.__scoutSurfaceBootstrap ?? null,
  );
  const [lanes, setLanes] = useState<DeckLane[]>(preview ? PREVIEW_LANES : []);
  const [hostScope, setHostScope] = useState<DeckHostScope>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(preview ? PREVIEW_LANES[0]?.key ?? null : null);
  const [connection, setConnection] = useState<DeckConnection>(preview ? "ready" : "waiting");
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<CodexDeckThreadSnapshot | null>(preview ? PREVIEW_THREAD : null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<DeckPending | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [view, setView] = useState<DeckView>("thread");
  const [voice, setVoice] = useState<NativeVoiceSnapshot>(initialVoice);
  const [voiceHydrated, setVoiceHydrated] = useState(preview);
  const [voiceOutEnabled, setVoiceOutEnabled] = useState(() => localStorage.getItem("scout.deck.voiceOut") !== "off");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const clientRef = useRef<NativeScoutSurfaceClient | null>(null);
  const seenFinalCountRef = useRef<number | null>(preview ? 0 : null);
  const spokenBlockRef = useRef<string | null>(null);
  const previewVoiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Dictation started from the primary key sends itself; typed dictation does not. */
  const autoSendRef = useRef(false);
  const listeningSinceRef = useRef<number | null>(null);
  const submitRef = useRef<(text: string) => Promise<void>>(async () => {});

  useEffect(() => {
    installScoutSurfacePushReceiver();
    if (!window.webkit?.messageHandlers?.scoutSurface) return;

    const client = new NativeScoutSurfaceClient("deck", () => ({
      hostIds: (window.__scoutSurfaceBootstrap?.selectedHostIds ?? []) as [string, ...string[]],
    }));
    clientRef.current = client;
    let cancelled = false;
    let fleetTimer: ReturnType<typeof setInterval> | null = null;
    let refreshingFleet = false;

    void client.bootstrap()
      .then(async (value) => {
        if (cancelled) return;
        window.__scoutSurfaceBootstrap = value;
        setBootstrap(value);
        const hostIds = value.selectedHostIds as [string, ...string[]];
        if (hostIds.length === 0) {
          setConnection("offline");
          setLanes([]);
          return;
        }
        const connectedHostIds = new Set(value.hosts.filter((host) => host.state === "connected").map((host) => host.id));
        const rememberedScope = localStorage.getItem(HOST_SCOPE_STORAGE_KEY);
        const nextScope = rememberedScope === "all" || (rememberedScope && connectedHostIds.has(rememberedScope))
          ? rememberedScope
          : value.focusedHostId && connectedHostIds.has(value.focusedHostId)
            ? value.focusedHostId
            : hostIds[0] ?? "all";
        setHostScope(nextScope);
        const scope = { hostIds };
        const refreshFleet = async () => {
          if (refreshingFleet) return;
          refreshingFleet = true;
          try {
            const [agents, tail] = await Promise.all([
              client.agents.list(scope),
              client.tail.recent(scope),
            ]);
            if (cancelled) return;
            const next = buildDeckLanes(value.hosts, agents, tail);
            setLanes(next);
            setSelectedKey((current) => next.some((lane) => lane.key === current) ? current : next[0]?.key ?? null);
            const failures = agents.hosts.filter((host) => !host.ready).length
              + tail.hosts.filter((host) => !host.ready).length;
            setError(null);
            setConnection(failures > 0 ? "partial" : "ready");
          } catch (cause) {
            if (cancelled) return;
            setError(cause instanceof Error ? cause.message : String(cause));
            setConnection("partial");
          } finally {
            refreshingFleet = false;
          }
        };
        await refreshFleet();
        if (!cancelled) fleetTimer = setInterval(() => void refreshFleet(), 3_000);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setConnection("error");
      });

    return () => {
      cancelled = true;
      if (fleetTimer) clearInterval(fleetTimer);
      clientRef.current = null;
    };
  }, []);

  const hosts = preview ? PREVIEW_HOSTS : bootstrap?.hosts ?? [];
  const scopedLanes = hostScope === "all" ? lanes : lanes.filter((lane) => lane.hostId === hostScope);
  const selected = scopedLanes.find((lane) => lane.key === selectedKey) ?? scopedLanes[0] ?? null;
  const selectedRoute = selected ? { hostId: selected.hostId, agentId: selected.id } satisfies CodexDeckRoute : null;
  const adapterAvailable = Boolean(
    selected?.transport === "codex_app_server"
    && (preview || bootstrap?.capabilities?.includes("codex.thread.snapshot")),
  );
  const voiceAvailable = preview || Boolean(bootstrap?.capabilities?.includes("native.voice.snapshot"));

  useEffect(() => {
    if (!selected) {
      setThread(null);
      return;
    }
    setCommand("");
    setThreadError(null);
    setNotice(null);
    setPending(null);
    autoSendRef.current = false;
    setView(selected.transport === "codex_app_server" ? "thread" : "signal");
    spokenBlockRef.current = null;

    if (preview) {
      setThread(previewThreadFor(selected));
      return;
    }

    const client = clientRef.current;
    if (!client) return;
    setThread(null);
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      await client.native.setLaneSelection({
        hostId: selected.hostId,
        agentId: selected.id,
        ...(selected.conversationId ? { conversationId: selected.conversationId } : {}),
        ...(selected.sessionId ? { sessionId: selected.sessionId } : {}),
      });
      if (cancelled) return;
      if (!adapterAvailable) {
        setThread(null);
        return;
      }

      const refresh = async (connectIfNeeded = false) => {
        try {
          let value = await client.codex.snapshot({ hostId: selected.hostId, agentId: selected.id });
          if (connectIfNeeded && value.state === "disconnected") {
            setPending({ kind: "connecting", at: Date.now() });
            value = await client.codex.connect({ hostId: selected.hostId, agentId: selected.id });
          }
          if (cancelled) return;
          setThread(value);
          setThreadError(null);
        } catch (cause) {
          if (cancelled) return;
          setThreadError(cause instanceof Error ? cause.message : String(cause));
        }
      };
      await refresh(true);
      if (!cancelled) timer = setInterval(() => void refresh(), 2_000);
    })().catch((cause) => {
      if (cancelled) return;
      setThreadError(cause instanceof Error ? cause.message : String(cause));
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [selected?.key, adapterAvailable, preview]);

  useEffect(() => {
    if (preview || !voiceAvailable) return;
    const client = clientRef.current;
    if (!client) return;
    let cancelled = false;

    const refreshVoice = async () => {
      try {
        const next = await client.native.voice.snapshot();
        if (!cancelled) {
          setVoice(next);
          setVoiceHydrated(true);
          setVoiceError(null);
        }
      } catch (cause) {
        if (!cancelled) setVoiceError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void refreshVoice();
    const timer = setInterval(() => void refreshVoice(), 320);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [preview, voiceAvailable]);

  useEffect(() => {
    if (!voiceHydrated) return;
    const count = voice.input.finalCount;
    if (seenFinalCountRef.current == null) {
      seenFinalCountRef.current = count;
      return;
    }
    if (count <= seenFinalCountRef.current) return;
    seenFinalCountRef.current = count;
    const finalText = voice.input.finalText.trim();
    const autoSend = autoSendRef.current;
    autoSendRef.current = false;
    if (!finalText) {
      if (autoSend) setNotice("Nothing was transcribed — the turn was not sent.");
      return;
    }
    // Stopping dictation from the primary key is the send gesture. Anything
    // already typed rides along so the operator never loses partial input.
    const merged = appendDictation(command, finalText);
    // Always land the transcript in the composer first. submitTurn clears it
    // only once the send is actually accepted, so a refused or in-flight submit
    // leaves the text on screen instead of dropping it.
    setCommand(merged);
    if (autoSend) void submitRef.current(merged);
  }, [voice.input.finalCount, voice.input.finalText, voiceHydrated, command]);

  useEffect(() => {
    const candidate = latestSpeakableBlock(thread);
    if (!candidate) return;
    if (spokenBlockRef.current == null) {
      spokenBlockRef.current = candidate.id;
      return;
    }
    if (spokenBlockRef.current === candidate.id) return;
    if (!voiceOutEnabled) {
      spokenBlockRef.current = candidate.id;
      return;
    }
    if (voice.input.state === "listening" || voice.input.state === "transcribing") return;

    spokenBlockRef.current = candidate.id;
    if (preview) {
      setVoice((current) => ({ ...current, output: { speaking: true } }));
      if (previewVoiceTimerRef.current) clearTimeout(previewVoiceTimerRef.current);
      previewVoiceTimerRef.current = setTimeout(() => {
        setVoice((current) => ({ ...current, output: { speaking: false } }));
      }, 1_600);
      return;
    }
    void clientRef.current?.native.voice.speak(candidate.text)
      .then(setVoice)
      .catch((cause) => setVoiceError(cause instanceof Error ? cause.message : String(cause)));
  }, [thread, voice.input.state, voiceOutEnabled, preview]);

  useEffect(() => () => {
    if (previewVoiceTimerRef.current) clearTimeout(previewVoiceTimerRef.current);
  }, []);

  const attention = useMemo(
    () => scopedLanes.filter((lane) => lane.state === "waiting" || lane.state === "blocked" || lane.state === "error"),
    [scopedLanes],
  );
  const active = scopedLanes.filter((lane) => isLiveLaneState(lane.state)).length;
  const selectedActivity = activityBins(selected?.events ?? []);
  const voiceInputActive = voice.input.state === "listening" || voice.input.state === "transcribing";

  // A local intent only speaks for the lifecycle until the host either confirms
  // it or the window lapses; after that the snapshot is the only source left.
  const livePending = pending && clock - pending.at < PENDING_TIMEOUT_MS ? pending : null;
  const phase = turnPhase({ adapterAvailable, thread, threadError, pending: livePending });
  const phaseTone = turnPhaseTone(phase);
  const turnStartedAt = activeTurnStartedAt(thread);
  const canTalk = Boolean(voiceAvailable && !threadBusy && (phase === "ready" || phase === "running"));
  const canCompose = Boolean(adapterAvailable && thread && thread.state !== "disconnected" && !threadBusy);
  const canInterrupt = Boolean(adapterAvailable && (phase === "running" || phase === "stopping"));

  useEffect(() => {
    if (!pending) return;
    // Stop claiming the intent as soon as the snapshot agrees, or the deadline passes.
    const settled = pending.kind === "sending"
      ? thread?.state === "running"
      : pending.kind === "stopping"
        ? thread?.state === "idle"
        : thread?.state === "idle" || thread?.state === "running";
    if (settled) setPending(null);
  }, [pending, thread?.state]);

  const ticking = phase === "running" || phase === "sending" || phase === "stopping" || phase === "linking"
    || voiceInputActive;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    setClock(Date.now());
    return () => clearInterval(timer);
  }, [ticking]);

  const selectLane = (lane: DeckLane) => setSelectedKey(lane.key);

  const selectHostScope = (scope: DeckHostScope) => {
    setHostScope(scope);
    setSelectedKey(null);
    localStorage.setItem(HOST_SCOPE_STORAGE_KEY, scope);
  };

  const refreshThread = async () => {
    if (preview || !selectedRoute || !clientRef.current) return;
    setThread(await clientRef.current.codex.snapshot(selectedRoute));
  };

  const connectThread = async () => {
    if (!selectedRoute || threadBusy) return;
    setThreadBusy(true);
    setThreadError(null);
    setNotice(null);
    setPending({ kind: "connecting", at: Date.now() });
    try {
      if (preview) {
        setThread({ ...PREVIEW_THREAD, agentId: selectedRoute.agentId, state: "idle", turnId: null });
      } else if (clientRef.current) {
        setThread(await clientRef.current.codex.connect(selectedRoute));
      }
    } catch (cause) {
      setPending(null);
      setThreadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setThreadBusy(false);
    }
  };

  const submitTurn = async (value: string) => {
    const text = value.trim();
    if (!text) return;
    // Refusing is never silent: the text stays in the composer and the operator
    // is told why, so a dictated transcript can always be re-sent by hand.
    if (!selectedRoute || !thread) {
      setNotice("No task is bound — the transcript is still in the composer.");
      return;
    }
    if (threadBusy) {
      setNotice("A turn is already being sent — the transcript is still in the composer.");
      return;
    }
    setThreadBusy(true);
    setThreadError(null);
    setNotice(null);
    setPending({ kind: "sending", at: Date.now() });
    try {
      const mode = thread.state === "running" ? "steer" : "start";
      if (preview) {
        setThread(applyPreviewCommand(thread, text, mode));
      } else if (clientRef.current) {
        if (mode === "steer") await clientRef.current.codex.steer(selectedRoute, text);
        else await clientRef.current.codex.start(selectedRoute, text);
        await new Promise((resolve) => setTimeout(resolve, 180));
        await refreshThread();
      }
      setCommand("");
    } catch (cause) {
      setPending(null);
      setCommand(text);
      setThreadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setThreadBusy(false);
    }
  };
  submitRef.current = submitTurn;

  const onComposerSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    void submitTurn(command);
  };

  const interruptThread = async () => {
    if (!selectedRoute || !thread || threadBusy) return;
    setThreadBusy(true);
    setThreadError(null);
    setNotice(null);
    setPending({ kind: "stopping", at: Date.now() });
    try {
      if (preview) {
        setThread(applyPreviewInterrupt(thread));
      } else if (clientRef.current) {
        await clientRef.current.codex.interrupt(selectedRoute);
        await new Promise((resolve) => setTimeout(resolve, 180));
        await refreshThread();
      }
    } catch (cause) {
      setPending(null);
      setThreadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setThreadBusy(false);
    }
  };

  /**
   * The one voice gesture: tap to talk, tap to send. Stopping dictation is the
   * send, so the operator never has to find a separate submit control.
   */
  const toggleVoiceInput = async () => {
    if (!voiceAvailable) return;
    setVoiceError(null);
    setNotice(null);
    if (voice.input.state === "listening") {
      autoSendRef.current = true;
      listeningSinceRef.current = null;
    } else if (voice.input.state === "transcribing") {
      autoSendRef.current = false;
    } else {
      autoSendRef.current = false;
      listeningSinceRef.current = Date.now();
      setClock(Date.now());
    }
    if (preview) {
      if (previewVoiceTimerRef.current) clearTimeout(previewVoiceTimerRef.current);
      if (voice.input.state === "listening") {
        const finalText = voice.input.partialText || "Make the voice loop feel immediate and obvious.";
        setVoice((current) => ({
          ...current,
          input: { ...current.input, state: "transcribing", partialText: "" },
          output: { speaking: false },
        }));
        previewVoiceTimerRef.current = setTimeout(() => {
          setVoice((current) => ({
            ...current,
            input: {
              ...current.input,
              state: "idle",
              finalText,
              finalCount: current.input.finalCount + 1,
            },
          }));
        }, 520);
      } else if (voice.input.state === "transcribing") {
        setVoice((current) => ({ ...current, input: { ...current.input, state: "idle", partialText: "" } }));
      } else {
        setVoice((current) => ({
          ...current,
          input: {
            ...current.input,
            state: "listening",
            partialText: "Make the voice loop feel immediate and obvious.",
            unavailableReason: null,
          },
          output: { speaking: false },
        }));
      }
      return;
    }

    try {
      const next = await clientRef.current?.native.voice.toggleInput();
      if (next) setVoice(next);
    } catch (cause) {
      setVoiceError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleVoiceOutput = async () => {
    const next = !voiceOutEnabled;
    setVoiceOutEnabled(next);
    localStorage.setItem("scout.deck.voiceOut", next ? "on" : "off");
    if (!next) {
      if (previewVoiceTimerRef.current) clearTimeout(previewVoiceTimerRef.current);
      setVoice((current) => ({ ...current, output: { speaking: false } }));
      if (!preview) {
        try {
          const value = await clientRef.current?.native.voice.stopOutput();
          if (value) setVoice(value);
        } catch (cause) {
          setVoiceError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitTurn(command);
    }
  };

  /** The primary key always holds the single most useful next action. */
  const primaryAction = phase === "cold" || phase === "failed" ? "connect" : "talk";
  const onPrimary = () => {
    if (primaryAction === "connect") return void connectThread();
    void toggleVoiceInput();
  };

  return (
    <main className="scout-deck" data-connection={connection} data-preview={preview || undefined}>
      <header className="scout-deck__masthead">
        <div className="scout-deck__brand">
          <span className="scout-deck__mark" aria-hidden="true">S</span>
          <div>
            <span className="scout-deck__eyebrow">Scout / field console</span>
            <h1>Deck</h1>
          </div>
          {preview ? (
            <span className="scout-deck__sim" title="Every lane, thread, and turn on screen is local sample data. No host is attached.">
              Sample data
            </span>
          ) : null}
        </div>
        <div className="scout-deck__telemetry" aria-label="Deck status">
          <span className="scout-deck__telemetry-item"><i className="scout-deck__lamp" />{connectionLabel(connection)}</span>
          <span>{active.toString().padStart(2, "0")} active</span>
          <span>{hosts.filter((host) => host.state === "connected").length.toString().padStart(2, "0")} hosts</span>
        </div>
        <div className="scout-deck__hosts" aria-label="Agent lane scope">
          {hosts.length > 1 ? (
            <button
              type="button"
              className="scout-deck__host scout-deck__host--all"
              data-active={hostScope === "all" || undefined}
              onClick={() => selectHostScope("all")}
              aria-pressed={hostScope === "all"}
            >
              <i />All
            </button>
          ) : null}
          {hosts.map((host) => (
            <button
              type="button"
              className="scout-deck__host"
              data-state={host.state}
              data-active={hostScope === host.id || undefined}
              key={host.id}
              onClick={() => selectHostScope(host.id)}
              disabled={host.state !== "connected"}
              aria-pressed={hostScope === host.id}
            >
              <i />{host.name}
            </button>
          ))}
        </div>
      </header>

      <div className="scout-deck__workbench">
        <aside className="scout-deck__bank" aria-label="Agent channels">
          <div className="scout-deck__panel-label"><span>Channel bank</span><span>01—{String(scopedLanes.length).padStart(2, "0")}</span></div>
          <div className="scout-deck__keys">
            {scopedLanes.map((lane, index) => (
              <button
                type="button"
                className="scout-deck__key"
                data-active={lane.key === selected?.key || undefined}
                data-tone={lane.key === selected?.key && phaseTone !== "quiet" ? phaseTone : laneTone(lane)}
                key={lane.key}
                onClick={() => selectLane(lane)}
                aria-pressed={lane.key === selected?.key}
              >
                <span className="scout-deck__key-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="scout-deck__key-signal" aria-hidden="true" />
                <strong>{lane.name}</strong>
                <small>{lane.harness ?? "agent"} · {lane.hostName}</small>
              </button>
            ))}
          </div>
          <div className="scout-deck__bank-footer"><span>Select</span><span>Host scoped</span></div>
        </aside>

        <section className="scout-deck__stage">
          {selected ? (
            <>
              <div className="scout-deck__stage-head">
                <div>
                  <span className="scout-deck__stage-index">{String(scopedLanes.indexOf(selected) + 1).padStart(2, "0")}</span>
                  <span className="scout-deck__stage-label">Focused lane</span>
                </div>
                <span className="scout-deck__route">{selected.hostName} / {selected.id}</span>
              </div>
              <div className="scout-deck__identity">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.projectRoot ?? "Project unavailable"}</p>
                </div>
                <div className="scout-deck__identity-meta">
                  <span>{selected.harness ?? "unknown harness"}</span>
                  <strong>{selected.model ?? "default model"}</strong>
                  <em>{transportLabel(selected.transport)}</em>
                </div>
              </div>
              <div className="scout-deck__turn" data-tone={phaseTone} data-phase={phase}>
                <span className="scout-deck__turn-state" aria-live="polite">
                  <i className="scout-deck__lamp" />
                  {turnPhaseLabel(phase, selected.state)}
                </span>
                <span className="scout-deck__turn-detail" aria-live="polite">
                  {turnPhaseDetail(phase, thread, threadError, notice, selected)}
                </span>
                <span className="scout-deck__turn-clock" aria-hidden="true" data-live={phase === "running" || undefined}>
                  {turnElapsed(phase, turnStartedAt, livePending, clock)}
                </span>
                <div className="scout-deck__meter" aria-label="Lane activity over the last five minutes">
                  <small>5m</small>
                  <div aria-hidden="true">
                    {selectedActivity.map((level, index) => <i key={index} style={{ "--level": level } as CSSProperties} />)}
                  </div>
                  <small>now</small>
                </div>
                {canInterrupt ? (
                  <button
                    type="button"
                    className="scout-deck__stop"
                    onClick={interruptThread}
                    disabled={threadBusy || phase === "stopping"}
                  >
                    {phase === "stopping" ? "Stopping" : "Stop turn"}
                  </button>
                ) : null}
              </div>

              <form
                className="scout-deck__console"
                data-phase={phase}
                data-voice-state={voice.input.state}
                onSubmit={onComposerSubmit}
                aria-label={`Voice console for ${selected.name}`}
                aria-busy={threadBusy || undefined}
              >
                <div className="scout-deck__console-body">
                  <button
                    type="button"
                    className="scout-deck__primary"
                    data-action={primaryAction}
                    data-state={primaryAction === "connect" ? "connect" : voice.input.state}
                    onClick={onPrimary}
                    disabled={primaryAction === "connect" ? threadBusy : !canTalk}
                    aria-label={primaryKeyDescription(primaryAction, phase, voice.input.state)}
                    aria-pressed={voice.input.state === "listening"}
                    title={primaryKeyDescription(primaryAction, phase, voice.input.state)}
                  >
                    {primaryAction === "connect" ? <VoiceLinkIcon /> : <VoiceMicIcon />}
                    <small>{primaryKeyLabel(primaryAction, phase, voice.input.state)}</small>
                  </button>
                  <div className="scout-deck__console-input">
                    <div className="scout-deck__caption" data-active={voiceInputActive || undefined} data-error={Boolean(voiceError) || undefined}>
                      <i aria-hidden="true" />
                      <span>{voiceError ?? consoleCaption(voice, voiceAvailable, phase, listeningSinceRef.current, clock)}</span>
                    </div>
                    <textarea
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      onKeyDown={onComposerKeyDown}
                      placeholder={composerPlaceholder(phase, voice.input.state)}
                      disabled={!canCompose}
                      rows={2}
                      aria-label={phase === "running" ? "Steer the active Codex turn" : "Start a Codex turn"}
                    />
                  </div>
                  {command.trim() && voice.input.state !== "listening" ? (
                    <button className="scout-deck__send" type="submit" disabled={!canCompose}>
                      {phase === "running" ? "Steer" : "Send"}
                      <span>⌘↵</span>
                    </button>
                  ) : null}
                </div>
                <div className="scout-deck__console-foot">
                  <span className="scout-deck__binding" data-bound={Boolean(thread?.threadId) || undefined}>
                    {thread?.threadId ? (
                      <>
                        <strong title={taskTitle(thread) ?? undefined}>{taskTitle(thread) ?? "Untitled task"}</strong>
                        <em>task {shortId(thread.threadId)}</em>
                      </>
                    ) : "no task bound"}
                  </span>
                  <button
                    type="button"
                    className="scout-deck__voice-out"
                    data-active={voiceOutEnabled || undefined}
                    data-speaking={voice.output.speaking || undefined}
                    onClick={toggleVoiceOutput}
                    disabled={!voiceAvailable}
                    aria-pressed={voiceOutEnabled}
                  >
                    <VoiceSpeakerIcon />
                    <span>{voice.output.speaking ? "Speaking" : `Voice out ${voiceOutEnabled ? "on" : "off"}`}</span>
                  </button>
                </div>
              </form>

              <section className="scout-deck__activity" aria-label={`${selected.name} controller view`}>
                <div className="scout-deck__panel-label scout-deck__panel-label--tabs">
                  <span>{view === "thread" ? "Codex Desktop task" : "Live signal"}</span>
                  <div className="scout-deck__tabs" role="tablist" aria-label="Lane view">
                    <button type="button" role="tab" aria-selected={view === "thread"} onClick={() => setView("thread")} disabled={!adapterAvailable}>Thread</button>
                    <button type="button" role="tab" aria-selected={view === "signal"} onClick={() => setView("signal")}>Signal</button>
                  </div>
                </div>
                {view === "thread" ? (
                  <ThreadViewport thread={thread} available={adapterAvailable} busy={threadBusy} error={threadError} onConnect={connectThread} />
                ) : (
                  <SignalViewport lane={selected} />
                )}
              </section>
            </>
          ) : (
            <DeckEmpty connection={connection} error={error} />
          )}
        </section>

        <aside className="scout-deck__rail" aria-label="Fleet and controller overview">
          <section className="scout-deck__control">
            <div className="scout-deck__panel-label"><span>Link</span><span>{preview ? "Sample" : adapterAvailable ? "Native" : "—"}</span></div>
            <div className="scout-deck__adapter" data-state={threadError ? "error" : thread?.state ?? "unavailable"}>
              <span className="scout-deck__adapter-mark">{adapterAvailable ? "CX" : "—"}</span>
              <div>
                <strong>{adapterAvailable ? "Codex Desktop task" : "No native adapter"}</strong>
                <small>{threadError ? "binding failed" : thread?.state ?? (selected ? transportLabel(selected.transport) : "no selected lane")}</small>
              </div>
              <i />
            </div>
            {adapterAvailable && thread?.threadId ? (
              <p className="scout-deck__task-title" title={taskTitle(thread) ?? undefined}>
                {taskTitle(thread) ?? "Untitled task"}
              </p>
            ) : null}
            <dl className="scout-deck__readout">
              <div><dt>Source</dt><dd>{preview ? "sample data" : "paired host"}</dd></div>
              <div><dt>Bridge</dt><dd>{connectionReadout(connection)}</dd></div>
              <div><dt>Task</dt><dd>{thread?.threadId ? shortId(thread.threadId) : "unbound"}</dd></div>
              <div><dt>Turn</dt><dd>{thread?.turnId ? shortId(thread.turnId) : "none"}</dd></div>
              <div><dt>Voice in</dt><dd>{voiceAvailable ? voiceReadout(voice.input.state) : "—"}</dd></div>
              <div><dt>Voice out</dt><dd>{voiceAvailable ? voice.output.speaking ? "speaking" : voiceOutEnabled ? "armed" : "off" : "—"}</dd></div>
              <div><dt>Queue</dt><dd title={thread?.capabilityNotes.queue}>{adapterAvailable ? "off" : "—"}</dd></div>
              <div><dt>Approval</dt><dd title={thread?.capabilityNotes.approvals}>{adapterAvailable ? "off" : "—"}</dd></div>
            </dl>
          </section>
          <section>
            <div className="scout-deck__panel-label"><span>Attention</span><span>{String(attention.length).padStart(2, "0")}</span></div>
            {attention.length > 0 ? attention.map((lane) => (
              <button className="scout-deck__attention" type="button" key={lane.key} onClick={() => selectLane(lane)}>
                <i />
                <span><strong>{lane.name}</strong><small>{lane.events[0]?.text ?? "Needs review"}</small></span>
              </button>
            )) : <p className="scout-deck__rail-empty">No lanes need intervention.</p>}
          </section>
          <section>
            <div className="scout-deck__panel-label"><span>Fleet</span><span>{String(hosts.length).padStart(2, "0")}</span></div>
            <div className="scout-deck__fleet-list">
              {hosts.map((host) => (
                <div className="scout-deck__fleet-host" key={host.id}>
                  <i data-state={host.state} />
                  <span><strong>{host.name}</strong><small>{lanes.filter((lane) => lane.hostId === host.id).length} lanes · {hostScope === host.id ? "scoped" : "available"}</small></span>
                  <em>{host.state}</em>
                </div>
              ))}
            </div>
          </section>
          <div className="scout-deck__rail-spacer" />
        </aside>
      </div>
    </main>
  );
}

function VoiceMicIcon() {
  return (
    <svg className="scout-deck__mic-icon" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="11" y="4" width="10" height="16" rx="5" />
      <path d="M7.5 15.5v.8a8.5 8.5 0 0 0 17 0v-.8M16 24.8V29M11.5 29h9" />
    </svg>
  );
}

function VoiceSpeakerIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 8h3l4-3.2v10.4L6.5 12h-3zM13.3 7.2a4 4 0 0 1 0 5.6M15.6 5a7 7 0 0 1 0 10" />
    </svg>
  );
}

function VoiceLinkIcon() {
  return (
    <svg className="scout-deck__mic-icon" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M13 19l6-6M11.5 14.5 9 17a4.6 4.6 0 0 0 6.5 6.5l2.5-2.5M20.5 17.5 23 15a4.6 4.6 0 0 0-6.5-6.5L14 11" />
    </svg>
  );
}

function primaryKeyLabel(
  action: "connect" | "talk",
  phase: DeckTurnPhase,
  state: NativeVoiceSnapshot["input"]["state"],
): string {
  if (action === "connect") return phase === "failed" ? "retry" : "connect";
  if (state === "listening") return "send";
  if (state === "transcribing") return "…";
  if (state === "preparing") return "warming";
  if (state === "unavailable") return "voice off";
  if (phase === "linking") return "linking";
  if (phase === "sending") return "sending";
  if (phase === "stopping") return "stopping";
  return phase === "running" ? "steer" : "talk";
}

function primaryKeyDescription(
  action: "connect" | "talk",
  phase: DeckTurnPhase,
  state: NativeVoiceSnapshot["input"]["state"],
): string {
  if (action === "connect") return "Bind this lane to its Codex Desktop task";
  if (state === "listening") return "Stop dictation and send the turn";
  if (state === "transcribing") return "Transcribing dictation";
  return phase === "running" ? "Speak to steer the active turn" : "Speak to start a turn";
}

function consoleCaption(
  voice: NativeVoiceSnapshot,
  available: boolean,
  phase: DeckTurnPhase,
  listeningSince: number | null,
  clock: number,
): string {
  if (!available) return "Native voice becomes available inside the Scout iPad app.";
  if (voice.input.state === "listening") {
    const elapsed = listeningSince ? ` · ${formatElapsed(clock - listeningSince)}` : "";
    return `${voice.input.partialText || "Listening — speak naturally."}${elapsed}`;
  }
  if (voice.input.state === "transcribing") return "Transcribing on device, then sending…";
  if (voice.input.state === "preparing") return "Warming Parakeet; Apple Speech remains available as fallback.";
  if (voice.input.state === "unavailable") return voice.input.unavailableReason || "Microphone access is unavailable.";
  if (phase === "unavailable") return "This lane has no native controller to talk to.";
  if (phase === "cold" || phase === "failed") return "Bind the task before talking to it.";
  if (phase === "running") return "Tap to talk, tap again to steer the running turn.";
  return "Tap to talk, tap again to send.";
}

function voiceReadout(state: NativeVoiceSnapshot["input"]["state"]): string {
  if (state === "listening") return "listening";
  if (state === "transcribing") return "processing";
  if (state === "preparing") return "warming";
  if (state === "unavailable") return "blocked";
  return "ready";
}

function composerPlaceholder(
  phase: DeckTurnPhase,
  voiceState: NativeVoiceSnapshot["input"]["state"],
): string {
  if (phase === "unavailable") return "This lane needs its own native adapter before it can be controlled.";
  if (phase === "cold" || phase === "failed") return "Bind the task to enable typing.";
  if (voiceState === "listening") return "Speaking… the transcript sends when you tap send.";
  if (voiceState === "transcribing") return "Finishing your transcript…";
  return phase === "running" ? "Or type a redirect for this active turn…" : "Or type what this task should do next…";
}

/**
 * Collapses adapter availability, thread binding, and turn state into the one
 * ordered lifecycle the operator sees. Local intent outranks the last snapshot
 * only while it is still within its confirmation window.
 */
function turnPhase({
  adapterAvailable,
  thread,
  threadError,
  pending,
}: {
  adapterAvailable: boolean;
  thread: CodexDeckThreadSnapshot | null;
  threadError: string | null;
  pending: DeckPending | null;
}): DeckTurnPhase {
  if (!adapterAvailable) return "unavailable";
  if (threadError) return "failed";
  if (pending?.kind === "sending") return "sending";
  if (pending?.kind === "stopping") return "stopping";
  if (pending?.kind === "connecting") return "linking";
  if (!thread) return "linking";
  if (thread.state === "disconnected") return "cold";
  return thread.state === "running" ? "running" : "ready";
}

function turnPhaseTone(phase: DeckTurnPhase): DeckSignalTone {
  if (phase === "running" || phase === "sending") return "live";
  if (phase === "ready") return "ready";
  if (phase === "cold" || phase === "failed") return "attention";
  return "quiet";
}

function turnPhaseLabel(phase: DeckTurnPhase, laneState: string | null): string {
  if (phase === "unavailable") return laneStateLabel(laneState);
  if (phase === "cold") return "Task unbound";
  if (phase === "linking") return "Linking";
  if (phase === "failed") return "Link failed";
  if (phase === "sending") return "Sending";
  if (phase === "stopping") return "Stopping";
  if (phase === "running") return "Turn running";
  return "Ready";
}

function turnPhaseDetail(
  phase: DeckTurnPhase,
  thread: CodexDeckThreadSnapshot | null,
  threadError: string | null,
  notice: string | null,
  lane: DeckLane,
): string {
  if (notice) return notice;
  if (phase === "unavailable") return `${transportLabel(lane.transport)} · observable only`;
  if (phase === "failed") return threadError ?? "The host did not answer.";
  if (phase === "cold") return "Connect binds this lane to its Codex Desktop task.";
  if (phase === "linking") return "Binding the Codex Desktop task…";
  if (phase === "sending") return "Waiting for Codex Desktop to accept the turn…";
  if (phase === "stopping") return "Interrupt sent; waiting for the turn to end…";
  if (phase === "running") return turnActivityDetail(thread);
  const last = lastCompletedTurnEndedAt(thread);
  return last ? `Idle · last turn ended ${relativeTime(last)} ago` : "Idle · no turns yet on this task";
}

/** Describes what the running turn is doing right now, straight from the snapshot. */
function turnActivityDetail(thread: CodexDeckThreadSnapshot | null): string {
  const turn = activeTurn(thread);
  if (!turn) return "Streaming…";
  for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
    const state = turn.blocks[index];
    if (!state || state.status !== "streaming") continue;
    if (state.block.type === "action") {
      const label = state.block.action?.command ?? state.block.action?.toolName ?? state.block.action?.path;
      return label ? `Running ${label}` : "Running an action";
    }
    if (state.block.type === "reasoning") return "Thinking";
    if (state.block.type === "text") return "Writing a reply";
  }
  return "Streaming…";
}

function activeTurn(thread: CodexDeckThreadSnapshot | null) {
  const turns = thread?.snapshot?.turns ?? [];
  return turns.find((turn) => turn.id === thread?.turnId) ?? null;
}

function activeTurnStartedAt(thread: CodexDeckThreadSnapshot | null): number | null {
  return activeTurn(thread)?.startedAt ?? null;
}

function lastCompletedTurnEndedAt(thread: CodexDeckThreadSnapshot | null): number | null {
  const turns = thread?.snapshot?.turns ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const endedAt = turns[index]?.endedAt;
    if (endedAt) return endedAt;
  }
  return null;
}

function turnElapsed(
  phase: DeckTurnPhase,
  turnStartedAt: number | null,
  pending: DeckPending | null,
  clock: number,
): string {
  if (phase === "sending" && pending) return formatElapsed(clock - pending.at);
  if ((phase === "running" || phase === "stopping") && turnStartedAt) return formatElapsed(clock - turnStartedAt);
  return "";
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function appendDictation(current: string, phrase: string): string {
  const next = phrase.trim();
  if (!next) return current;
  if (!current.trim()) return next;
  return `${current}${/\s$/.test(current) ? "" : " "}${next}`;
}

function latestSpeakableBlock(thread: CodexDeckThreadSnapshot | null): { id: string; text: string } | null {
  const turns = thread?.snapshot?.turns ?? [];
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn || turn.isUserTurn || turn.status !== "completed") continue;
    for (let blockIndex = turn.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const state = turn.blocks[blockIndex];
      const text = state?.block.type === "text" ? blockTitle(state.block) : "";
      if (state?.status === "completed" && text) return { id: state.block.id, text };
    }
  }
  return null;
}

function ThreadViewport({
  thread,
  available,
  busy,
  error,
  onConnect,
}: {
  thread: CodexDeckThreadSnapshot | null;
  available: boolean;
  busy: boolean;
  error: string | null;
  onConnect: () => void;
}) {
  if (!available) {
    return (
      <div className="scout-deck__thread-empty">
        <span className="scout-deck__thread-glyph">—</span>
        <strong>No native controller for this lane</strong>
        <p>The lane stays observable. A future harness adapter can add its own direct controls without pretending to be a Codex Desktop task.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="scout-deck__thread-empty" data-state="error">
        <span className="scout-deck__thread-glyph">!</span>
        <strong>Task binding failed</strong>
        <p>{error}</p>
        <button type="button" onClick={onConnect} disabled={busy}>Retry controller</button>
      </div>
    );
  }
  if (!thread) {
    return (
      <div className="scout-deck__thread-empty">
        <span className="scout-deck__thread-glyph">···</span>
        <strong>Reading the Codex Desktop task</strong>
        <p>Nothing is shown until the host returns a snapshot.</p>
      </div>
    );
  }
  if (thread.state === "disconnected") {
    return (
      <div className="scout-deck__thread-empty">
        <span className="scout-deck__thread-glyph">CX</span>
        <strong>Task is unbound</strong>
        <p>No turns are readable until the Deck binds to a Codex Desktop-owned task. Connect attaches to that exact task on the host.</p>
        <button type="button" onClick={onConnect} disabled={busy}>Bind task</button>
      </div>
    );
  }

  const rows = threadRows(thread);
  return (
    <div className="scout-deck__thread-list">
      {rows.length > 0 ? rows.map((row) => (
        <article className="scout-deck__thread-row" data-role={row.role} data-type={row.block.type} key={row.block.id}>
          <div className="scout-deck__thread-meta">
            <span>{row.role === "operator" ? "YOU" : row.block.type === "action" ? "RUN" : row.block.type === "reasoning" ? "THINK" : "CX"}</span>
            <time>{relativeTime(row.at)}</time>
          </div>
          <div className="scout-deck__thread-content">
            <strong>{blockTitle(row.block)}</strong>
            {blockDetail(row.block) ? <p>{blockDetail(row.block)}</p> : null}
          </div>
          <span className="scout-deck__thread-state">{row.status === "streaming" ? "live" : row.status}</span>
        </article>
      )) : (
        <div className="scout-deck__thread-empty" data-state="connected">
          <span className="scout-deck__thread-glyph">●</span>
          <strong>Task bound</strong>
          <p>{thread.threadId ? `Task ${shortId(thread.threadId)} is ready. Start its first turn from the console above.` : "The task is bound. Start its first turn from the console above."}</p>
        </div>
      )}
    </div>
  );
}

function SignalViewport({ lane }: { lane: DeckLane }) {
  return (
    <div className="scout-deck__event-list">
      {lane.events.length > 0 ? lane.events.slice(0, 7).map((event) => (
        <article className="scout-deck__event" data-kind={event.kind} key={event.id}>
          <time>{relativeTime(event.at)}</time>
          <i aria-hidden="true" />
          <div><strong>{event.text}</strong>{event.detail ? <p>{event.detail}</p> : null}</div>
        </article>
      )) : (
        <div className="scout-deck__quiet">No recent activity on this lane.</div>
      )}
    </div>
  );
}

function DeckEmpty({ connection, error }: { connection: DeckConnection; error: string | null }) {
  return (
    <div className="scout-deck__empty">
      <i className="scout-deck__lamp" />
      <span className="scout-deck__eyebrow">Deck standing by</span>
      <h2>{connection === "error" ? "Bridge unavailable" : "Waiting for a connected host"}</h2>
      <p>{error ?? "The bundled surface is loaded. Select a paired Mac to populate live lanes."}</p>
    </div>
  );
}

export function buildDeckLanes(
  hosts: readonly SurfaceHost[],
  agents: FleetAgentSnapshot,
  tail: FleetTailSnapshot,
): DeckLane[] {
  const hostNames = new Map(hosts.map((host) => [host.id, host.name]));
  const events = new Map<string, SurfaceTailEvent[]>();
  for (const outcome of tail.hosts) {
    if (!outcome.ready) continue;
    for (const event of outcome.value.events) {
      if (!event.agentId) continue;
      const key = `${outcome.hostId}:${event.agentId}`;
      events.set(key, [...(events.get(key) ?? []), event]);
    }
  }
  return agents.hosts.flatMap((outcome) => {
    if (!outcome.ready) return [];
    return outcome.value.agents.map((agent) => ({
      ...agent,
      key: `${outcome.hostId}:${agent.id}`,
      hostId: outcome.hostId,
      hostName: hostNames.get(outcome.hostId) ?? outcome.hostId,
      events: (events.get(`${outcome.hostId}:${agent.id}`) ?? []).sort((a, b) => b.at - a.at),
    }));
  }).sort((a, b) => {
    const priority = deckLanePriority(b) - deckLanePriority(a);
    return priority || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}

function deckLanePriority(lane: DeckLane): number {
  const controllable = lane.transport === "codex_app_server";
  const live = isLiveLaneState(lane.state);
  const attention = lane.state === "waiting" || lane.state === "blocked" || lane.state === "error";
  if (controllable && live) return 5;
  if (controllable && attention) return 4;
  if (controllable) return 3;
  if (attention) return 2;
  if (live) return 1;
  return 0;
}

function previewLane(
  hostId: string,
  hostName: string,
  id: string,
  name: string,
  harness: string,
  model: string,
  state: string,
  projectRoot: string,
  eventSeeds: Array<[SurfaceTailEvent["kind"], string, string]>,
): DeckLane {
  return {
    key: `${hostId}:${id}`,
    hostId,
    hostName,
    id,
    name,
    handle: name.toLowerCase(),
    harness,
    transport: harness === "codex" ? "codex_app_server" : "claude_stream_json",
    model,
    state,
    projectRoot,
    conversationId: `conversation-${id}`,
    sessionId: `session-${id}`,
    updatedAt: now - Number(id) * 43_000,
    events: eventSeeds.map(([kind, text, detail], index) => ({
      id: `${id}-${index}`,
      at: now - index * 68_000 - Number(id) * 12_000,
      agentId: id,
      sessionId: `session-${id}`,
      kind,
      text,
      detail,
    })),
  };
}

function previewThreadFor(lane: DeckLane): CodexDeckThreadSnapshot | null {
  if (lane.transport !== "codex_app_server") return null;
  if (lane.id === "04") {
    return {
      ...PREVIEW_THREAD,
      agentId: lane.id,
      threadId: "019fa45a-release",
      turnId: null,
      state: "idle",
      snapshot: PREVIEW_THREAD.snapshot ? { ...PREVIEW_THREAD.snapshot, currentTurnId: null, turns: PREVIEW_THREAD.snapshot.turns.slice(0, 2) } : null,
    };
  }
  return PREVIEW_THREAD;
}

function applyPreviewCommand(
  thread: CodexDeckThreadSnapshot,
  text: string,
  mode: "start" | "steer",
): CodexDeckThreadSnapshot {
  const turnId = mode === "steer" ? thread.turnId ?? `turn_${Date.now()}` : `turn_${Date.now()}`;
  const snapshot = thread.snapshot;
  if (!snapshot) return thread;
  const block: CodexDeckBlock = {
    id: `${mode}_${Date.now()}`,
    turnId,
    type: mode === "steer" ? "reasoning" : "text",
    status: "streaming",
    index: 99,
    text: mode === "steer" ? `Steer received: ${text}` : text,
  };
  const turns = mode === "steer"
    ? snapshot.turns.map((turn) => turn.id === turnId
      ? { ...turn, blocks: [...turn.blocks, { status: "streaming", block }] }
      : turn)
    : [...snapshot.turns, {
      id: turnId,
      status: "streaming" as const,
      blocks: [{ status: "streaming", block }],
      startedAt: Date.now(),
      isUserTurn: true,
    }];
  return { ...thread, state: "running", turnId, snapshot: { ...snapshot, currentTurnId: turnId, turns } };
}

function applyPreviewInterrupt(thread: CodexDeckThreadSnapshot): CodexDeckThreadSnapshot {
  if (!thread.snapshot || !thread.turnId) return { ...thread, state: "idle", turnId: null };
  const turns = thread.snapshot.turns.map((turn) => turn.id === thread.turnId
    ? {
      ...turn,
      status: "interrupted" as const,
      endedAt: Date.now(),
      blocks: turn.blocks.map((state) => ({
        ...state,
        status: "completed" as const,
        block: { ...state.block, status: state.block.status === "streaming" ? "completed" : state.block.status },
      })),
    }
    : turn);
  return { ...thread, state: "idle", turnId: null, snapshot: { ...thread.snapshot, currentTurnId: null, turns } };
}

function threadRows(thread: CodexDeckThreadSnapshot) {
  return (thread.snapshot?.turns ?? []).flatMap((turn) => turn.blocks.map((state) => ({
    role: turn.isUserTurn ? "operator" as const : "codex" as const,
    at: turn.startedAt,
    status: state.status,
    block: state.block,
  }))).filter((row) => Boolean(blockTitle(row.block))).slice(-9);
}

function blockTitle(block: CodexDeckBlock): string {
  if (block.type === "action") {
    return block.action?.command
      ?? block.action?.toolName
      ?? block.action?.path
      ?? block.action?.agentName
      ?? "Codex action";
  }
  return block.text?.trim() || block.message?.trim() || "";
}

function blockDetail(block: CodexDeckBlock): string {
  if (block.type !== "action") return "";
  return block.action?.output?.trim()
    || (block.action?.kind ? `${block.action.kind.replaceAll("_", " ")} · ${block.action.status}` : "");
}

function connectionLabel(connection: DeckConnection): string {
  if (connection === "ready") return "Bridge online";
  if (connection === "partial") return "Bridge degraded";
  if (connection === "error") return "Bridge error";
  if (connection === "offline") return "Bridge offline";
  return "Bridge connecting";
}

/**
 * Display-only vocabulary for the agent transport. The backend enum still reads
 * `codex_app_server`; the binding it now names is a Codex Desktop-owned task, so
 * the Deck says that. Matching predicates keep using the raw backend value.
 */
function transportLabel(transport: string | null | undefined): string {
  if (!transport) return "transport unreported";
  if (transport === "codex_app_server") return "codex desktop task";
  return transport;
}

/** The exact Codex Desktop task title the host reports for this binding. */
function taskTitle(thread: CodexDeckThreadSnapshot | null): string | null {
  const name = thread?.snapshot?.session?.name?.trim();
  return name ? name : null;
}

function connectionReadout(connection: DeckConnection): string {
  if (connection === "ready") return "online";
  if (connection === "partial") return "degraded";
  if (connection === "error") return "error";
  if (connection === "offline") return "offline";
  return "connecting";
}

function laneTone(lane: DeckLane): DeckSignalTone {
  if (lane.state === "waiting" || lane.state === "blocked" || lane.state === "error") return "attention";
  if (isLiveLaneState(lane.state)) return "live";
  return "quiet";
}

function laneStateLabel(state: string | null): string {
  if (isLiveLaneState(state)) return "Live signal";
  if (state === "waiting" || state === "blocked") return "Needs attention";
  if (state === "error") return "Signal error";
  if (state === "idle" || state === "available") return "Controller ready";
  return state ? state.replaceAll("_", " ") : "Standing by";
}

function isLiveLaneState(state: string | null): boolean {
  return state === "live" || state === "working" || state === "active" || state === "running" || state === "in_flight";
}

function relativeTime(at: number | null): string {
  if (!at) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

function activityBins(events: readonly SurfaceTailEvent[], count = 28, windowMs = 5 * 60_000): number[] {
  const end = Date.now();
  const start = end - windowMs;
  const bins = Array.from({ length: count }, () => 0);
  for (const event of events) {
    if (event.at < start || event.at > end) continue;
    const index = Math.min(count - 1, Math.floor(((event.at - start) / windowMs) * count));
    bins[index] += event.kind === "message" || event.kind === "ask" ? 2 : 1;
  }
  return bins.map((value) => Math.min(6, value));
}
