import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { NativeScoutSurfaceClient, installScoutSurfacePushReceiver } from "../../surface-contract/native-scout-surface-client.ts";
import type {
  FleetAgentSnapshot,
  FleetTailSnapshot,
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
    ["think", "Mapping the deck shell to the iPad bridge", "Selection stays explicit and host-scoped."],
    ["message", "Automatic grid now protects lane identity.", "Ready for visual review."],
  ]),
  previewLane("studio", "Studio", "02", "SpeakEasy", "claude", "opus-5", "active", "~/dev/SpeakEasy", [
    ["message", "Control deck reference review", "Channel bank, focused stage, and restrained signal color."],
    ["tool", "Captured Pad landscape states", "Connected, partial, and offline."],
    ["think", "Keep transport controls out of Scout", "Carry the physical hierarchy, not the voice contract."],
  ]),
  previewLane("air", "MacBook Air", "03", "Hudson", "claude", "sonnet-5", "waiting", "~/dev/hudson", [
    ["message", "Waiting for operator review", "One navigation decision needs attention."],
    ["note", "Candidate build is ready", "No active tool call."],
  ]),
  previewLane("studio", "Studio", "04", "Release", "codex", "gpt-5.4", "idle", "~/dev/openscout", [
    ["system", "Last run completed", "Checks passed 18 minutes ago."],
  ]),
];

export function ScoutDeckSurface() {
  const search = new URLSearchParams(window.location.search);
  const preview = search.has("preview") || (import.meta.env.DEV && !search.has("offline"));
  const [bootstrap, setBootstrap] = useState<Partial<SurfaceBootstrap> | null>(
    () => window.__scoutSurfaceBootstrap ?? null,
  );
  const [lanes, setLanes] = useState<DeckLane[]>(preview ? PREVIEW_LANES : []);
  const [selectedKey, setSelectedKey] = useState<string | null>(preview ? PREVIEW_LANES[0]?.key ?? null : null);
  const [connection, setConnection] = useState<DeckConnection>(preview ? "ready" : "waiting");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<NativeScoutSurfaceClient | null>(null);

  useEffect(() => {
    installScoutSurfacePushReceiver();
    if (!window.webkit?.messageHandlers?.scoutSurface) return;

    const client = new NativeScoutSurfaceClient("lanes", () => ({
      hostIds: (window.__scoutSurfaceBootstrap?.selectedHostIds ?? []) as [string, ...string[]],
    }));
    clientRef.current = client;
    let cancelled = false;

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
        const scope = { hostIds };
        const [agents, tail] = await Promise.all([
          client.agents.list(scope),
          client.tail.recent(scope),
        ]);
        if (cancelled) return;
        const next = buildDeckLanes(value.hosts, agents, tail);
        setLanes(next);
        setSelectedKey((current) => next.some((lane) => lane.key === current) ? current : next[0]?.key ?? null);
        const failures = agents.hosts.filter((host) => !host.ready).length;
        setConnection(failures > 0 ? "partial" : "ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setConnection("error");
      });

    return () => {
      cancelled = true;
      clientRef.current = null;
    };
  }, []);

  const hosts = preview ? PREVIEW_HOSTS : bootstrap?.hosts ?? [];
  const selected = lanes.find((lane) => lane.key === selectedKey) ?? lanes[0] ?? null;
  const attention = useMemo(
    () => lanes.filter((lane) => lane.state === "waiting" || lane.state === "blocked" || lane.state === "error"),
    [lanes],
  );
  const active = lanes.filter((lane) => lane.state === "active" || lane.state === "running").length;
  const selectedActivity = activityBins(selected?.events ?? []);

  const selectLane = (lane: DeckLane) => {
    setSelectedKey(lane.key);
    void clientRef.current?.native.setLaneSelection({
      hostId: lane.hostId,
      agentId: lane.id,
      ...(lane.conversationId ? { conversationId: lane.conversationId } : {}),
      ...(lane.sessionId ? { sessionId: lane.sessionId } : {}),
    });
  };

  return (
    <main className="scout-deck" data-connection={connection}>
      <header className="scout-deck__masthead">
        <div className="scout-deck__brand">
          <span className="scout-deck__mark" aria-hidden="true">S</span>
          <div>
            <span className="scout-deck__eyebrow">Scout / field console</span>
            <h1>Deck</h1>
          </div>
        </div>
        <div className="scout-deck__telemetry" aria-label="Deck status">
          <span className="scout-deck__telemetry-item"><i className="scout-deck__lamp" />{connectionLabel(connection)}</span>
          <span>{active.toString().padStart(2, "0")} active</span>
          <span>{hosts.filter((host) => host.state === "connected").length.toString().padStart(2, "0")} hosts</span>
        </div>
        <div className="scout-deck__hosts" aria-label="Selected hosts">
          {hosts.map((host) => (
            <span className="scout-deck__host" data-state={host.state} key={host.id}>
              <i />{host.name}
            </span>
          ))}
        </div>
      </header>

      <div className="scout-deck__workbench">
        <aside className="scout-deck__bank" aria-label="Agent channels">
          <div className="scout-deck__panel-label"><span>Channel bank</span><span>01—{String(lanes.length).padStart(2, "0")}</span></div>
          <div className="scout-deck__keys">
            {lanes.map((lane, index) => (
              <button
                type="button"
                className="scout-deck__key"
                data-active={lane.key === selected?.key || undefined}
                data-tone={laneTone(lane)}
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

        <section className="scout-deck__stage" aria-live="polite">
          {selected ? (
            <>
              <div className="scout-deck__stage-head">
                <div>
                  <span className="scout-deck__stage-index">{String(lanes.indexOf(selected) + 1).padStart(2, "0")}</span>
                  <span className="scout-deck__stage-label">Focused lane</span>
                </div>
                <span className="scout-deck__route">{selected.hostName} / explicit route</span>
              </div>
              <div className="scout-deck__identity">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.projectRoot ?? "Project unavailable"}</p>
                </div>
                <div className="scout-deck__identity-meta">
                  <span>{selected.harness ?? "unknown harness"}</span>
                  <strong>{selected.model ?? "default model"}</strong>
                </div>
              </div>
              <div className="scout-deck__live-line">
                <span><i className="scout-deck__lamp" />{laneStateLabel(selected.state)}</span>
                <div className="scout-deck__meter" aria-label="Activity over the last five minutes">
                  <small>5m</small>
                  <div aria-hidden="true">
                    {selectedActivity.map((level, index) => <i key={index} style={{ "--level": level } as CSSProperties} />)}
                  </div>
                  <small>now</small>
                </div>
                <span>{relativeTime(selected.updatedAt)}</span>
              </div>
              <section className="scout-deck__activity" aria-label={`${selected.name} recent activity`}>
                <div className="scout-deck__panel-label"><span>Live activity</span><span>Recent signal</span></div>
                <div className="scout-deck__event-list">
                  {selected.events.length > 0 ? selected.events.slice(0, 5).map((event) => (
                    <article className="scout-deck__event" data-kind={event.kind} key={event.id}>
                      <time>{relativeTime(event.at)}</time>
                      <i aria-hidden="true" />
                      <div><strong>{event.text}</strong>{event.detail ? <p>{event.detail}</p> : null}</div>
                    </article>
                  )) : (
                    <div className="scout-deck__quiet">No recent activity on this lane.</div>
                  )}
                </div>
              </section>
              <footer className="scout-deck__selection">
                <span>Selected target</span>
                <strong>{selected.name}</strong>
                <span className="scout-deck__selection-route">{selected.hostName} · {selected.harness ?? "agent"}</span>
                <span className="scout-deck__selection-note">Native composer routes here</span>
              </footer>
            </>
          ) : (
            <DeckEmpty connection={connection} error={error} />
          )}
        </section>

        <aside className="scout-deck__rail" aria-label="Fleet overview">
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
                  <span><strong>{host.name}</strong><small>{lanes.filter((lane) => lane.hostId === host.id).length} lanes</small></span>
                  <em>{host.state}</em>
                </div>
              ))}
            </div>
          </section>
          <div className="scout-deck__rail-spacer" />
          <section className="scout-deck__legend">
            <span><i data-tone="live" />Live</span>
            <span><i data-tone="attention" />Attention</span>
            <span><i data-tone="quiet" />Quiet</span>
          </section>
        </aside>
      </div>
    </main>
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
  }).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
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

function connectionLabel(connection: DeckConnection): string {
  if (connection === "ready") return "Link ready";
  if (connection === "partial") return "Partial link";
  if (connection === "error") return "Link error";
  if (connection === "offline") return "Offline";
  return "Connecting";
}

function laneTone(lane: DeckLane): "live" | "attention" | "quiet" {
  if (lane.state === "waiting" || lane.state === "blocked" || lane.state === "error") return "attention";
  if (lane.state === "active" || lane.state === "running") return "live";
  return "quiet";
}

function laneStateLabel(state: string | null): string {
  if (state === "active" || state === "running") return "Live signal";
  if (state === "waiting" || state === "blocked") return "Needs attention";
  if (state === "error") return "Signal error";
  return state ? state.replaceAll("_", " ") : "Standing by";
}

function relativeTime(at: number | null): string {
  if (!at) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
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
