import { useCallback, useEffect, useMemo, useState } from "react";
import { useScout } from "../Provider.tsx";
import { openAgent } from "../slots/openAgent.ts";
import { openContent } from "../slots/openContent.ts";
import {
  agentStateLabel,
  isAgentOnline,
  normalizeAgentState,
} from "../../lib/agent-state.ts";
import { actorColor, stateColor } from "../../lib/colors.ts";
import { compareTimestampsDesc, timeAgo } from "../../lib/time.ts";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { queueTakeover } from "../../lib/terminal-takeover.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import type {
  Agent,
  AgentObservePayload,
  FleetAsk,
  FleetState,
  ObserveData,
  Route,
  SessionEntry,
  SessionCatalogEntry,
  SessionCatalogWithResume,
  TailDiscoveredProcess,
  TailDiscoverySnapshot,
  TailSessionPreview,
} from "../../lib/types.ts";

const GROUPED_NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const NATIVE_SESSION_ACTIVE_WINDOW_MS = 60_000;

type NativeContextSession = {
  kind: "native";
  key: string;
  label: string;
  status: "active" | "idle";
  harness: string;
  refId: string | null;
  transcriptPath: string | null;
  cwd: string | null;
  sessionId: string | null;
  process: TailDiscoveredProcess | null;
  lastActivityAt: number | null;
  preview: TailSessionPreview | null;
};

type ScoutContextSession = {
  kind: "scout";
  key: string;
  session: SessionEntry;
};

type ContextSession = NativeContextSession | ScoutContextSession;

function fmtCompactNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) < 1_000) {
    return GROUPED_NUMBER_FORMAT.format(value);
  }

  return COMPACT_NUMBER_FORMAT.format(value).toLowerCase();
}

function fmtWindowSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0s";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes >= 10 || remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

function shortHostLabel(value: string): string {
  return value.replace(/\.local$/i, "").replace(/-local-openscout$/i, "");
}

function pathLeaf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function normalizeProjectRoot(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[\\/]+$/, "") || null;
}

function normalizeSessionRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const leaf = pathLeaf(trimmed);
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

function nativeSessionProcessKey(source: string, cwd: string | null): string {
  return `${source}\0${cwd ?? ""}`;
}

function nativeSessionProcessMap(discovery: TailDiscoverySnapshot): Map<string, TailDiscoveredProcess> {
  const byCwd = new Map<string, TailDiscoveredProcess>();
  for (const process of discovery.processes ?? []) {
    const key = nativeSessionProcessKey(process.source || "unknown", process.cwd);
    const current = byCwd.get(key);
    if (!current || process.pid < current.pid) {
      byCwd.set(key, process);
    }
  }
  return byCwd;
}

function nativeContextSessionForKey(
  key: string,
  discovery: TailDiscoverySnapshot | null,
): NativeContextSession | null {
  if (!key.startsWith("native:") || !discovery) return null;

  const nativeKey = key.slice("native:".length);
  const processByCwd = nativeSessionProcessMap(discovery);

  if (nativeKey.startsWith("transcript:")) {
    const transcriptPath = nativeKey.slice("transcript:".length);
    const transcript = (discovery.transcripts ?? []).find((candidate) =>
      candidate.transcriptPath === transcriptPath
    );
    if (!transcript) return null;

    const source = transcript.source || "unknown";
    const process = processByCwd.get(nativeSessionProcessKey(source, transcript.cwd)) ?? null;
    const refId = normalizeSessionRef(transcript.sessionId)
      ?? normalizeSessionRef(transcript.transcriptPath);
    const lastActivityAt = transcript.mtimeMs || null;
    return {
      kind: "native",
      key,
      label: shortSessionId(transcript.sessionId ?? refId ?? transcript.transcriptPath),
      status: process || (lastActivityAt && Date.now() - lastActivityAt <= NATIVE_SESSION_ACTIVE_WINDOW_MS)
        ? "active"
        : "idle",
      harness: source,
      refId,
      transcriptPath: transcript.transcriptPath,
      cwd: transcript.cwd,
      sessionId: transcript.sessionId,
      process,
      lastActivityAt,
      preview: transcript.preview ?? null,
    };
  }

  if (nativeKey.startsWith("process:")) {
    const processKey = nativeKey.slice("process:".length);
    const process = (discovery.processes ?? []).find((candidate) =>
      `${candidate.source || "unknown"}:${candidate.pid}` === processKey
    );
    if (!process) return null;

    return {
      kind: "native",
      key,
      label: `pid ${process.pid}`,
      status: "active",
      harness: process.source || "unknown",
      refId: null,
      transcriptPath: null,
      cwd: process.cwd,
      sessionId: null,
      process,
      lastActivityAt: null,
      preview: null,
    };
  }

  return null;
}

function scoutContextSessionForKey(key: string, sessions: SessionEntry[]): ScoutContextSession | null {
  if (!key.startsWith("scout:")) return null;
  const sessionId = key.slice("scout:".length);
  const session = sessions.find((candidate) => candidate.id === sessionId) ?? null;
  return session ? { kind: "scout", key, session } : null;
}

async function revealLocalPath(input: {
  path: string;
  basePath?: string | null;
  agentId: string;
  sessionId?: string | null;
}) {
  await api<{ ok: true; path: string }>("/api/local-path/reveal", {
    method: "POST",
    body: JSON.stringify({
      path: input.path,
      agentId: input.agentId,
      ...(input.basePath ? { basePath: input.basePath } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
  });
}

function revealPath(input: {
  path: string;
  basePath?: string | null;
  agentId: string;
  sessionId?: string | null;
}) {
  void revealLocalPath(input).catch((error) => {
    console.warn("Failed to reveal local path", error);
  });
}

export function AgentsInspector() {
  const { route, agents, navigate } = useScout();
  if (route.view !== "agents") return null;

  if (!route.agentId && route.contextSessionKey) {
    return (
      <ProjectSessionContextPanel
        sessionKey={route.contextSessionKey}
        navigate={navigate}
        route={route}
      />
    );
  }

  const contextAgentId = route.agentId ?? route.contextAgentId;
  const agent = contextAgentId
    ? agents.find((a) => a.id === contextAgentId) ?? null
    : null;

  if (!agent) {
    const working = agents.filter((a) => isAgentOnline(a.state)).length;
    return (
      <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
        <Row label="Total" value={`${agents.length}`} />
        <Row label="Working" value={`${working}`} />
        <Row label="Available" value={`${agents.length - working}`} />
        <div className="mt-2 text-[10px] font-mono uppercase tracking-[0.15em] leading-relaxed text-[var(--scout-chrome-ink-ghost)]">
          Select an agent from the roster to see its context here.
        </div>
      </div>
    );
  }

  return (
    <AgentContextPanel
      agent={agent}
      agents={agents}
      navigate={navigate}
      route={route}
      observeMode={route.tab === "observe"}
    />
  );
}

function ProjectSessionContextPanel({
  sessionKey,
  navigate,
  route,
}: {
  sessionKey: string;
  navigate: (r: Route) => void;
  route: Route;
}) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [sessionsResult, discoveryResult] = await Promise.all([
      api<SessionEntry[]>("/api/conversations").catch(() => []),
      api<TailDiscoverySnapshot>("/api/tail/discover?previews=true").catch(() => null),
    ]);
    setSessions(sessionsResult);
    setDiscovery(discoveryResult);
    setLoaded(true);
  }, []);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load, sessionKey]);
  useBrokerEvents(() => {
    void load();
  });

  const selected = useMemo<ContextSession | null>(() => {
    return scoutContextSessionForKey(sessionKey, sessions)
      ?? nativeContextSessionForKey(sessionKey, discovery);
  }, [discovery, sessionKey, sessions]);

  if (!selected) {
    return (
      <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
        <div className="border-b border-[var(--scout-chrome-border-soft)] pb-3">
          <div className="text-[13px] leading-snug text-[var(--scout-chrome-ink-strong)]">
            Session context
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--scout-chrome-ink-faint)]">
            {loaded ? "Selected session is no longer visible." : "Resolving selected session."}
          </div>
        </div>
        <Row label="Key" value={sessionKey} />
      </div>
    );
  }

  if (selected.kind === "scout") {
    const session = selected.session;
    const openConversation = () =>
      openContent(navigate, { view: "conversation", conversationId: session.id }, { returnTo: route });
    const openAgentProfile = () => {
      if (!session.agentId) return;
      navigate({ view: "agents", agentId: session.agentId });
    };

    return (
      <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
        <div className="border-b border-[var(--scout-chrome-border-soft)] pb-3">
          <div className="text-[13px] leading-snug text-[var(--scout-chrome-ink-strong)]">
            {session.title || session.agentName || shortSessionId(session.id)}
          </div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/70 mt-1">
            Scout conversation
          </div>
        </div>

        <Section label="State">
          <Row label="Kind" value={session.kind} />
          {session.harness && <Row label="Harness" value={session.harness} />}
          {session.lastMessageAt && <Row label="Last" value={timeAgo(session.lastMessageAt)} />}
        </Section>

        {(session.currentBranch || session.workspaceRoot) && (
          <Section label="Workspace">
            {session.currentBranch && <Row label="Branch" value={session.currentBranch} />}
            {session.workspaceRoot && <Row label="Root" value={session.workspaceRoot} />}
          </Section>
        )}

        {session.preview && (
          <Section label="Preview">
            <ContextPreviewPanel
              summary={session.preview}
              subtitle={session.agentName ?? session.kind}
              facts={[
                ...(session.lastMessageAt ? [{ key: "last", label: "last", value: timeAgo(session.lastMessageAt) }] : []),
                ...(session.harness ? [{ key: "harness", label: "harness", value: session.harness }] : []),
              ]}
            />
          </Section>
        )}

        <Section label="Actions">
          <div className="flex flex-col gap-1.5">
            <ContextActionButton label="Open conversation" onClick={openConversation} />
            {session.agentId && <ContextActionButton label="Open agent" onClick={openAgentProfile} />}
          </div>
        </Section>
      </div>
    );
  }

  const observeTranscript = () => {
    if (!selected.refId) return;
    openContent(navigate, { view: "sessions", sessionId: selected.refId }, { returnTo: route });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      <div className="border-b border-[var(--scout-chrome-border-soft)] pb-3">
        <div className="text-[13px] leading-snug text-[var(--scout-chrome-ink-strong)]">
          {selected.preview?.title ?? selected.label}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/70 mt-1">
          {selected.preview?.subtitle ?? "Native session"}
        </div>
      </div>

      <Section label="State">
        <Row label="Status" value={selected.status} />
        <Row label="Harness" value={selected.harness} />
        {selected.lastActivityAt && <Row label="Last" value={timeAgo(selected.lastActivityAt)} />}
      </Section>

      <Section label="Runtime">
        {selected.cwd && <Row label="Cwd" value={selected.cwd} />}
        {selected.sessionId && <Row label="Session" value={shortSessionId(selected.sessionId)} />}
        {selected.process && <Row label="Pid" value={`${selected.process.pid}`} />}
      </Section>

      {selected.transcriptPath && (
        <Section label="Transcript">
          <Row label="Path" value={selected.transcriptPath} />
        </Section>
      )}

      {selected.preview && (
        <Section label="Preview">
          <ContextPreviewPanel
            summary={selected.preview.summary}
            subtitle={selected.preview.subtitle}
            facts={selected.preview.facts}
          />
        </Section>
      )}

      <Section label="Actions">
        <div className="flex flex-col gap-1.5">
          <ContextActionButton
            label="Observe transcript"
            onClick={observeTranscript}
            disabled={!selected.refId}
          />
        </div>
      </Section>
    </div>
  );
}

function ContextPreviewPanel({
  summary,
  subtitle,
  facts,
}: {
  summary: string | null;
  subtitle: string | null;
  facts: TailSessionPreview["facts"];
}) {
  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--accent)_30%,var(--scout-chrome-border-soft))] bg-[color-mix(in_srgb,var(--accent)_6%,var(--scout-chrome-hover))] p-3 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--scout-chrome-ink)_7%,transparent)]">
      {subtitle && (
        <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.13em] text-cyan-400/70">
          {subtitle}
        </div>
      )}
      <div className="text-[12px] leading-relaxed text-[var(--scout-chrome-ink-strong)]">
        {summary ?? "No readable preview yet."}
      </div>
      <ContextPreviewFacts facts={facts} />
    </div>
  );
}

function ContextPreviewFacts({ facts }: { facts: TailSessionPreview["facts"] }) {
  const visible = facts.filter((fact) => fact.value !== "-").slice(0, 5);
  if (visible.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {visible.map((fact) => (
        <span
          key={fact.key}
          title={fact.title}
          className="rounded-sm bg-[var(--scout-chrome-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--scout-chrome-ink-soft)]"
        >
          {fact.value} {fact.label}
        </span>
      ))}
    </div>
  );
}

function ContextActionButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--scout-chrome-ink)] disabled:cursor-default disabled:opacity-45"
    >
      {label}
    </button>
  );
}

function AgentContextPanel({
  agent,
  agents,
  navigate,
  route,
  observeMode,
}: {
  agent: Agent;
  agents: Agent[];
  navigate: (r: Route) => void;
  route: Route;
  observeMode: boolean;
}) {
  const online = isAgentOnline(agent.state);
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [sessionCatalog, setSessionCatalog] = useState<SessionCatalogWithResume | null>(null);

  const load = useCallback(async () => {
    const [fleetResult, catalogResult] = await Promise.all([
      api<FleetState>("/api/fleet").catch(() => null),
      api<SessionCatalogWithResume>(
        `/api/agents/${encodeURIComponent(agent.id)}/session-catalog`,
      ).catch(() => null),
    ]);
    if (fleetResult) setFleet(fleetResult);
    setSessionCatalog(catalogResult);
  }, [agent.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setSessionCatalog(null);
  }, [agent.id]);
  useBrokerEvents(() => {
    void load();
  });

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      {/* Identity */}
      <div className="flex items-center gap-3 border-b border-[var(--scout-chrome-border-soft)] pb-3">
        <div
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-mono text-[var(--scout-chrome-avatar-ink)]"
          style={{ background: actorColor(agent.name) }}
        >
          {agent.name[0]?.toUpperCase() ?? "?"}
          {online && (
            <span
              className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--hud-bg)]"
              style={{
                background: stateColor(agent.state),
                opacity: normalizeAgentState(agent.state) === "working" ? 0.85 : 0.6,
              }}
            />
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate text-[13px] text-[var(--scout-chrome-ink-strong)]">
            {agent.name}
          </span>
          {agent.handle && (
            <span className="text-[10px] font-mono text-cyan-400/70">
              @{agent.handle}
            </span>
          )}
        </div>
      </div>

      {/* State */}
      <Section label="State">
        <div className="flex items-baseline gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: stateColor(agent.state),
              opacity: online ? 1 : 0.4,
            }}
          />
          <span className="text-[12px] capitalize text-[var(--scout-chrome-ink)]">
            {agentStateLabel(agent.state)}
          </span>
        </div>
        {agent.updatedAt && (
          <div className="mt-1 text-[10px] font-mono text-[var(--scout-chrome-ink-faint)]">
            Updated {timeAgo(agent.updatedAt)}
          </div>
        )}
      </Section>

      {/* Presence mesh */}
      <Section label="Presence">
        <InspectorMesh
          focusAgent={agent}
          agents={agents}
          onOpenAgent={(target) =>
            openAgent(navigate, target, { from: "inspector", returnTo: route })
          }
        />
      </Section>

      {observeMode && <ObserveContext agentId={agent.id} />}

      {/* Incoming asks */}
      {fleet && (
        <InspectorAsks
          asks={fleet.activeAsks}
          agentId={agent.id}
          navigate={navigate}
        />
      )}

      {/* Identity detail */}
      <Section label="Identity">
        <Row label="Class" value={agent.agentClass} />
        {agent.role && <Row label="Role" value={agent.role} />}
        {agent.harness && <Row label="Harness" value={agent.harness} />}
        {agent.transport && <Row label="Transport" value={agent.transport} />}
        {(agent.homeNodeName || agent.homeNodeId) && (
          <Row label="Host" value={shortHostLabel(agent.homeNodeName ?? agent.homeNodeId ?? "")} />
        )}
      </Section>

      {/* Project */}
      {(agent.project || agent.branch || agent.cwd) && (
        <Section label="Project">
          {agent.project && <Row label="Name" value={agent.project} />}
          {agent.branch && <Row label="Branch" value={agent.branch} />}
          {agent.cwd && <Row label="Cwd" value={agent.cwd} />}
        </Section>
      )}

      {/* Capabilities */}
      {agent.capabilities.length > 0 && (
        <Section label={`Capabilities · ${agent.capabilities.length}`}>
          <div className="flex flex-wrap gap-1">
            {agent.capabilities.map((cap) => (
              <span
                key={cap}
                className="rounded-sm bg-[var(--scout-chrome-hover)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--scout-chrome-ink-soft)]"
              >
                {cap}
              </span>
            ))}
          </div>
        </Section>
      )}

      <RunningSessions
        agent={agent}
        catalog={sessionCatalog}
        navigate={navigate}
        returnTo={route}
      />
    </div>
  );
}

function RunningSessions({
  agent,
  catalog,
  navigate,
  returnTo,
}: {
  agent: Agent;
  catalog: SessionCatalogWithResume | null;
  navigate: (r: Route) => void;
  returnTo: Route;
}) {
  const showContextMenu = useContextMenu();
  const activeSessionId = catalog?.activeSessionId
    ?? (agent.transport === "tmux" ? agent.harnessSessionId : null);
  const sessions = useMemo(
    () => buildRunningSessions(agent, catalog, activeSessionId),
    [agent, catalog, activeSessionId],
  );
  const running = sessions.filter((session) =>
    session.id === activeSessionId || !session.endedAt
  );
  const visible = running.slice(0, 5);
  if (visible.length === 0) return null;
  const openTerminal = (mode: "observe" | "takeover") =>
    openContent(navigate, { view: "terminal", agentId: agent.id, mode }, { returnTo });
  const runTakeover = () => {
    if (agent.transport === "tmux") {
      openTerminal("takeover");
      return;
    }
    if (!catalog?.resumeCommand) return;
    void queueTakeover({
      command: catalog.resumeCommand,
      cwd: catalog.resumeCwd,
      agentId: agent.id,
    }).then(() => openTerminal("takeover"));
  };
  const openSessionDetail = (sessionId: string) =>
    openContent(navigate, { view: "sessions", sessionId }, { returnTo });
  const sessionMenuItems = (
    session: SessionCatalogEntry,
    canObserveTerminal: boolean,
    canTakeover: boolean,
  ): MenuItem[] => {
    const items: MenuItem[] = [];
    if (canObserveTerminal) {
      items.push({
        kind: "action",
        label: "Observe in terminal",
        onSelect: () => openTerminal("observe"),
      });
    }
    if (canTakeover) {
      items.push({
        kind: "action",
        label: "Takeover terminal",
        onSelect: runTakeover,
      });
    }
    if (items.length > 0) {
      items.push({ kind: "separator" });
    }
    items.push({
      kind: "action",
      label: "Open session detail",
      onSelect: () => openSessionDetail(session.id),
    });
    items.push({
      kind: "action",
      label: "Open agent profile",
      onSelect: () => openAgent(navigate, agent, { from: "inspector", returnTo }),
    });
    return items;
  };

  return (
    <Section label={`Running sessions · ${running.length}`}>
      <div className="flex flex-col gap-1.5">
        {visible.map((session) => {
          const active = session.id === activeSessionId;
          const canObserveTerminal = active && agent.transport === "tmux";
          const canTakeover = active && (agent.transport === "tmux" || Boolean(catalog?.resumeCommand));
          const age = timeAgo(session.startedAt) || "recent";
          const harnessLabel = session.transport ?? session.harness ?? agent.transport ?? agent.harness ?? "session";
          const lowerMeta = active
            ? age
            : session.endedAt
              ? `${timeAgo(session.endedAt) || age} ended`
              : harnessLabel;
          const menuItems = sessionMenuItems(session, canObserveTerminal, canTakeover);
          return (
            <div
              key={session.id}
              onContextMenu={(event) => showContextMenu(event, menuItems)}
              className={`rounded border px-2 py-1.5 transition-colors ${
                active
                  ? "border-cyan-400/40 bg-cyan-400/[0.08]"
                  : "border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)]"
              }`}
            >
              <div className="flex min-w-0 items-start gap-2">
                <button
                  type="button"
                  title={canObserveTerminal
                    ? `Observe tmux terminal ${session.id}`
                    : `Open session ${session.id}`}
                  onClick={() =>
                    canObserveTerminal
                      ? openTerminal("observe")
                      : openSessionDetail(session.id)
                  }
                  className="min-w-0 flex-1 bg-transparent p-0 text-left"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {active && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                    )}
                    <span className="truncate font-mono text-[10.5px] text-[var(--scout-chrome-ink)]">
                      {shortSessionId(session.id)}
                    </span>
                    <span className="shrink-0 rounded-sm bg-[var(--scout-chrome-hover)] px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-faint)]">
                      {harnessLabel}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {canObserveTerminal && (
                    <SessionInlineAction label="observe" onClick={() => openTerminal("observe")} />
                  )}
                  {canTakeover && (
                    <SessionInlineAction label="takeover" onClick={runTakeover} />
                  )}
                  <SessionInlineAction label="detail" onClick={() => openSessionDetail(session.id)} />
                </div>
              </div>
              <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
                <span className="truncate font-mono text-[9px] text-[var(--scout-chrome-ink-faint)]">
                  {session.cwd ? pathLeaf(session.cwd) : "workspace"}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-mono text-[9px] text-[var(--scout-chrome-ink-ghost)]">
                  <span className="uppercase tracking-[0.12em] text-cyan-400/70">
                    {active ? "active" : "running"}
                  </span>
                  <span className="max-w-[58px] truncate">
                    {lowerMeta}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
        {running.length > visible.length && (
          <div className="px-1 pt-0.5 font-mono text-[9px] text-[var(--scout-chrome-ink-ghost)]">
            {running.length - visible.length} more running
          </div>
        )}
      </div>
    </Section>
  );
}

function SessionInlineAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-5 rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-1.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-[var(--scout-chrome-active)] hover:text-[var(--scout-chrome-ink)]"
    >
      {label}
    </button>
  );
}

function buildRunningSessions(
  agent: Agent,
  catalog: SessionCatalogWithResume | null,
  activeSessionId: string | null,
): SessionCatalogEntry[] {
  const sessions = [...(catalog?.sessions ?? [])];
  if (
    agent.transport === "tmux" &&
    activeSessionId &&
    !sessions.some((session) => session.id === activeSessionId)
  ) {
    sessions.unshift({
      id: activeSessionId,
      startedAt: agent.createdAt ?? agent.updatedAt ?? Date.now(),
      cwd: agent.cwd ?? agent.projectRoot ?? ".",
      ...(agent.harness ? { harness: agent.harness } : {}),
      ...(agent.transport ? { transport: agent.transport } : {}),
      model: agent.model,
    });
  }

  return sessions.sort((a, b) => {
    const left = a.endedAt ?? a.startedAt;
    const right = b.endedAt ?? b.startedAt;
    return compareTimestampsDesc(left, right);
  });
}

function shortSessionId(value: string): string {
  const compact = value.replace(/^session[_:-]?/i, "");
  return compact.length > 10 ? compact.slice(0, 8) : compact;
}

function ObserveContext({ agentId }: { agentId: string }) {
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);

  const load = useCallback(async () => {
    const result = await api<AgentObservePayload>(
      `/api/agents/${encodeURIComponent(agentId)}/observe`,
    ).catch(() => null);
    setObserve(result);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  if (!observe?.data) {
    return (
      <Section label="Trace">
        <div className="text-[10px] leading-relaxed text-[var(--scout-chrome-ink-faint)]">
          Resolving session trace.
        </div>
      </Section>
    );
  }

  return <ObserveStats agentId={agentId} data={observe.data} sessionId={observe.sessionId} />;
}

function ObserveStats({
  agentId,
  data,
  sessionId,
}: {
  agentId: string;
  data: ObserveData;
  sessionId: string | null;
}) {
  const sessionMeta = data.metadata?.session;
  const events = data.events;
  const files = data.files;
  const toolCount = events.filter((e) => e.kind === "tool").length;
  const thinkCount = events.filter((e) => e.kind === "think").length;
  const askCount = events.filter((e) => e.kind === "ask").length;
  const readCount = events.filter(
    (e) => e.kind === "tool" && e.tool === "read",
  ).length;
  const editCount = events.filter(
    (e) => e.kind === "tool" && (e.tool === "edit" || e.tool === "write"),
  ).length;
  const observedWindowSeconds = events.length > 0 ? events[events.length - 1]!.t : 0;
  const sourcePath = sessionMeta?.threadPath;

  return (
    <>
      <Section label="Session">
        {sessionId && <Row label="Active" value={sessionId.slice(0, 8)} />}
        {sourcePath && (
          <PathRow
            label="Source"
            path={sourcePath}
            basePath={sessionMeta?.cwd ?? null}
            value={pathLeaf(sourcePath)}
            agentId={agentId}
            sessionId={sessionId}
          />
        )}
        {sessionMeta?.cwd && (
          <PathRow
            label="Workspace"
            path={sessionMeta.cwd}
            value={sessionMeta.cwd}
            agentId={agentId}
            sessionId={sessionId}
          />
        )}
      </Section>

      <Section label="Trace stats">
        <div className="grid grid-cols-2 gap-1.5">
          <TraceMetric label="Turns" value={fmtCompactNumber(sessionMeta?.turnCount ?? 0)} />
          <TraceMetric label="Tools" value={fmtCompactNumber(toolCount)} />
          <TraceMetric label="Thinks" value={fmtCompactNumber(thinkCount)} />
          <TraceMetric label="Asks" value={fmtCompactNumber(askCount)} />
          <TraceMetric label="Reads" value={fmtCompactNumber(readCount)} />
          <TraceMetric label="Edits" value={fmtCompactNumber(editCount)} />
          <TraceMetric label="Files" value={fmtCompactNumber(files.length)} />
          <TraceMetric label="Window" value={fmtWindowSpan(observedWindowSeconds)} />
        </div>
      </Section>

      {files.length > 0 && (
        <Section label={`Files touched · ${files.length}`}>
          <div className="flex flex-col gap-1">
            {files.slice(0, 8).map((file) => (
              <button
                type="button"
                key={file.path}
                title={file.path}
                onClick={() => revealPath({
                  path: file.path,
                  basePath: sessionMeta?.cwd ?? null,
                  agentId,
                  sessionId,
                })}
                className="flex items-center justify-between gap-2 rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-2 py-1 text-left hover:border-[var(--accent)]"
              >
                <span className="min-w-0 truncate font-mono text-[10px] text-[var(--scout-chrome-ink-soft)]">
                  {file.path}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-[var(--scout-chrome-ink-faint)]">
                  x{file.touches}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function PathRow({
  label,
  path,
  basePath,
  value,
  agentId,
  sessionId,
}: {
  label: string;
  path: string;
  basePath?: string | null;
  value: string;
  agentId: string;
  sessionId?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-[var(--scout-chrome-ink-faint)]">
        {label}
      </span>
      <button
        type="button"
        title={`Reveal ${path}`}
        onClick={() => revealPath({ path, basePath, agentId, sessionId })}
        className="min-w-0 truncate bg-transparent p-0 text-right font-mono text-[11px] text-cyan-400/80 hover:text-[var(--scout-chrome-ink)] hover:underline"
      >
        {value}
      </button>
    </div>
  );
}

function TraceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-2 py-1.5">
      <div className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[12px] text-[var(--scout-chrome-ink)]">
        {value}
      </div>
    </div>
  );
}

function InspectorMesh({
  focusAgent,
  agents,
  onOpenAgent,
}: {
  focusAgent: Agent;
  agents: Agent[];
  onOpenAgent: (agent: Agent) => void;
}) {
  const W = 232;
  const H = 88;
  const CX = W / 2;
  const CY = 52;
  const R = 25;
  const presence = useMemo(() => {
    const focusProject = normalizeProjectRoot(focusAgent.projectRoot ?? focusAgent.cwd);
    const focusHost = focusAgent.homeNodeId ?? focusAgent.homeNodeName ?? null;
    const peers = agents
      .filter((agent) => agent.id !== focusAgent.id)
      .map((agent) => ({
        agent,
        sameProject: Boolean(
          focusProject &&
          normalizeProjectRoot(agent.projectRoot ?? agent.cwd) === focusProject,
        ),
        sameHost: Boolean(
          focusHost &&
          (agent.homeNodeId === focusHost || agent.homeNodeName === focusHost),
        ),
        state: normalizeAgentState(agent.state),
      }));
    return {
      total: peers.length,
      sameProject: peers.filter((peer) => peer.sameProject).length,
      sameHost: peers.filter((peer) => peer.sameHost).length,
      working: peers.filter((peer) => peer.state === "working").length,
      available: peers.filter((peer) => peer.state === "available").length,
      offline: peers.filter((peer) => peer.state === "offline").length,
    };
  }, [agents, focusAgent]);

  const collaborators = useMemo(() => {
    const focusProject = normalizeProjectRoot(focusAgent.projectRoot ?? focusAgent.cwd);
    const focusHost = focusAgent.homeNodeId ?? focusAgent.homeNodeName ?? null;
    return agents
      .filter((agent) => agent.id !== focusAgent.id)
      .map((agent) => {
        const sameProject = Boolean(
          focusProject &&
          normalizeProjectRoot(agent.projectRoot ?? agent.cwd) === focusProject,
        );
        const sameHost = Boolean(
          focusHost &&
          (agent.homeNodeId === focusHost || agent.homeNodeName === focusHost),
        );
        const state = normalizeAgentState(agent.state);
        const score =
          (sameProject ? 8 : 0) +
          (sameHost ? 4 : 0) +
          (state === "working" ? 3 : state === "available" ? 2 : 0);
        return { agent, sameProject, sameHost, state, score };
      })
      .sort((left, right) =>
        right.score - left.score || compareTimestampsDesc(left.agent.updatedAt, right.agent.updatedAt)
      )
      .slice(0, 7);
  }, [agents, focusAgent]);

  if (presence.total === 0) {
    return (
      <div className="rounded-md border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] px-2.5 py-2 text-[10px] text-[var(--scout-chrome-ink-faint)]">
        No nearby agents in the current scope.
      </div>
    );
  }

  const nodes = [
    { agent: focusAgent, x: CX, y: CY, focused: true, state: normalizeAgentState(focusAgent.state) },
    ...collaborators.map((collaborator, index) => {
      const angle = (2 * Math.PI * index) / Math.max(collaborators.length, 1) - Math.PI / 2;
      const stagger = index % 2 === 0 ? 0 : 4;
      return {
        ...collaborator,
        x: CX + (R + stagger) * Math.cos(angle),
        y: CY + (R - stagger * 0.4) * Math.sin(angle),
        focused: false,
      };
    }),
  ];

  return (
    <div className="overflow-hidden rounded-md border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-[88px] w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="inspMeshMiniGlow" cx="50%" cy="52%" r="56%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.12" />
            <stop offset="62%" stopColor="var(--accent)" stopOpacity="0.035" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#inspMeshMiniGlow)" />
        <text
          x="10"
          y="15"
          fontFamily="var(--font-mono)"
          fontSize="10"
          fill="var(--scout-chrome-ink)"
        >
          Collaborators
        </text>
        <text
          x="10"
          y="27"
          fontFamily="var(--font-mono)"
          fontSize="8"
          letterSpacing="0.4"
          fill="var(--scout-chrome-ink-faint)"
        >
          {presence.sameProject} project · {presence.sameHost} host
        </text>
        <text
          x={W - 10}
          y="16"
          textAnchor="end"
          fontFamily="var(--font-mono)"
          fontSize="8"
          fill="var(--scout-chrome-ink-faint)"
        >
          {presence.working}w · {presence.available}a · {presence.offline}o
        </text>
        <circle
          cx={CX}
          cy={CY}
          r={R + 9}
          fill="none"
          stroke="var(--scout-chrome-border-soft)"
          strokeDasharray="2 7"
          opacity={0.65}
        />
        {nodes.slice(1).map((node) => (
          <line
            key={`edge-${node.agent.id}`}
            x1={CX}
            y1={CY}
            x2={node.x}
            y2={node.y}
            stroke={node.sameProject ? "var(--accent)" : "var(--scout-chrome-border-soft)"}
            strokeWidth={node.sameProject ? 1.05 : 0.8}
            opacity={node.sameProject ? 0.68 : 0.32}
          />
        ))}
        {nodes.map((node) => {
          const active = node.state === "working" || node.state === "available";
          const radius = node.focused ? 12 : 8;
          return (
            <g
              key={node.agent.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenAgent(node.agent)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenAgent(node.agent);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <title>{node.agent.name}</title>
              {active && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius + 3}
                  fill="none"
                  stroke={stateColor(node.agent.state)}
                  strokeWidth={0.8}
                  opacity={node.focused ? 0.32 : 0.2}
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={actorColor(node.agent.name)}
                stroke={node.focused ? "var(--accent)" : "var(--hud-bg)"}
                strokeWidth={node.focused ? 1.8 : 1.2}
              />
              <circle
                cx={node.x + radius * 0.55}
                cy={node.y + radius * 0.52}
                r={node.focused ? 2.2 : 1.7}
                fill={stateColor(node.agent.state)}
                opacity={node.state === "offline" ? 0.45 : 0.95}
              />
              <text
                x={node.x}
                y={node.y}
                dy="0.35em"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize={node.focused ? 9 : 7}
                fontWeight={700}
                fill="var(--scout-chrome-avatar-ink)"
              >
                {node.agent.name[0]?.toUpperCase() ?? "?"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function InspectorAsks({
  asks,
  agentId,
  navigate,
}: {
  asks: FleetAsk[];
  agentId: string;
  navigate: (r: Route) => void;
}) {
  const relevant = asks.filter(
    (a) =>
      a.agentId === agentId &&
      (a.status === "needs_attention" || a.status === "queued"),
  );
  if (relevant.length === 0) return null;

  return (
    <Section label={`Incoming asks · ${relevant.length}`}>
      <div className="flex flex-col gap-2">
        {relevant.map((ask) => (
          <div
            key={ask.invocationId}
            className="p-2.5 rounded-md border border-amber-500/30 bg-amber-500/[0.04] cursor-pointer hover:bg-amber-500/[0.08] transition-colors"
            onClick={() => {
              if (ask.conversationId) {
                navigate({
                  view: "agents",
                  agentId,
                  conversationId: ask.conversationId,
                });
              }
            }}
          >
            <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-amber-500/80 mb-1">
              awaiting
            </div>
            <div className="line-clamp-2 text-[11px] leading-relaxed text-[var(--scout-chrome-ink)]">
              {ask.summary ?? ask.task}
            </div>
            <div className="mt-1.5 text-[9px] font-mono text-[var(--scout-chrome-ink-ghost)]">
              {ask.harness ?? "operator"} &rarr; {ask.agentName ?? "agent"}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-[var(--scout-chrome-ink-faint)]">
        {label}
      </span>
      <span className="truncate text-[11px] font-mono text-[var(--scout-chrome-ink)]">
        {value}
      </span>
    </div>
  );
}
