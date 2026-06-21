import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { api } from "../../lib/api.ts";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import { resolveActiveSessionId, resolveSelectedSessionId, sortSessionsByRecency } from "../../lib/session-catalog.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { BackToPicker } from "../../scout/slots/BackToPicker.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { useScout } from "../../scout/Provider.tsx";
import { ConversationScreen } from "../chat/ConversationScreen.tsx";
import { SessionObserve } from "../sessions/SessionObserve.tsx";
import type {
  Agent,
  AgentObservePayload,
  AgentTab,
  LocalAgentContextState,
  Route,
  SessionCatalogEntry,
  SessionCatalogWithResume,
} from "../../lib/types.ts";
import {
  agentLabel,
  newSessionPayloadForAgent,
  pathLeaf,
  shortSessionId,
  type SessionInitiationResult,
} from "./model.ts";

function formatContextAge(ms: number | null): string {
  if (ms === null) return "age unknown";
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m old` : `${hours}h old`;
}

function contextTurnLabel(context: LocalAgentContextState): string {
  return `${context.turnCount} turn${context.turnCount === 1 ? "" : "s"}`;
}

function shortCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  return cwd.startsWith("/Users/")
    ? "~/" + cwd.split("/").slice(3).join("/")
    : cwd;
}

function shortSessionLabel(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) {
    return id;
  }
  // Human session ids (e.g. "relay-hu") read fine; long hashes get elided.
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function compactSurfaceSessionLabel(id: string): string {
  return id
    .replace(/^relay-/u, "")
    .replace(/-arts-mac-mini-local-(claude|codex)$/u, "");
}

// Tiny monochrome line-glyphs (geometric, not emoji) for the essentials grid —
// folder · branch · host · chip. Kept bit-for-bit with the studio rebalance
// treatment (design/studio/.../agent-profile-rebalance) so the ports don't drift.
function IcoFolder() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <path d="M2 4h4l1.4 1.6H14v6.4H2z" strokeLinejoin="round" />
    </svg>
  );
}
function IcoBranch() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M4.5 11c0-3 7-1.4 7-4" strokeLinecap="round" />
    </svg>
  );
}
function IcoChip() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2" strokeLinecap="round" />
    </svg>
  );
}
function IcoHost() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <rect x="2.5" y="3.5" width="11" height="7" rx="1" />
      <path d="M6 13h4M8 10.5V13" strokeLinecap="round" />
    </svg>
  );
}

// One essentials cell: a faint line-glyph + its value, truncating. Grouped into
// two columns (location: path / host · work: branch / harness·model) so the
// composition reads without word labels.
function EssentialCell({ ico, v }: { ico: ReactNode; v: string }) {
  return (
    <span className="s-sess-glyph-cell" title={v}>
      <span className="s-sess-glyph-ico">{ico}</span>
      <span className="s-sess-glyph-v">{v}</span>
    </span>
  );
}

function HeaderFact({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <span className="s-sess-fact" title={title ?? value}>
      <span className="s-sess-fact-label">{label}</span>
      <span className="s-sess-fact-value">{value}</span>
    </span>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

function fmtCompactNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (Math.abs(value) < 1_000) return `${Math.round(value)}`;
  if (Math.abs(value) < 1_000_000) {
    return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function fmtWindowSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes >= 10 || secs === 0) return `${minutes}m`;
  return `${minutes}m ${secs}s`;
}

// Bin trace events into intensity buckets across the session window, so the
// sparkline reads the session's rhythm (warm-up · bursts · idle).
function binEvents(events: { t: number }[], n = 32): number[] {
  if (events.length === 0) return [];
  const last = events[events.length - 1]!.t || 1;
  const buckets = new Array<number>(n).fill(0);
  for (const e of events) {
    const idx = Math.min(n - 1, Math.max(0, Math.floor((e.t / last) * n)));
    buckets[idx] += 1;
  }
  return buckets;
}

function isWorkTraceEvent(event: { kind: string }): boolean {
  return event.kind !== "boot" && event.kind !== "system";
}

// A little chart of the session's rhythm — intensity bars, brighter where busier
// (single accent, opacity = intensity). Matches the studio rebalance treatment.
function ActivitySparkline({
  buckets,
  emptyTitle,
  emptyDetail,
}: {
  buckets: number[];
  emptyTitle: string;
  emptyDetail: string;
}) {
  if (buckets.length === 0) {
    return (
      <div className="s-sum-observed-empty">
        <span>{emptyTitle}</span>
        <strong>{emptyDetail}</strong>
      </div>
    );
  }
  const max = Math.max(...buckets, 1);
  const W = 240;
  const H = 20;
  const gap = 1;
  const bw = (W - gap * (buckets.length - 1)) / buckets.length;
  return (
    <div className="s-sum-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="s-sum-spark-svg" aria-hidden>
        {buckets.map((v, i) => {
          const h = Math.max(1, (v / max) * H);
          return (
            <rect
              key={i}
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h}
              fill="var(--accent)"
              opacity={0.22 + 0.62 * (v / max)}
            />
          );
        })}
      </svg>
      <div className="s-sum-spark-axis">
        <span>session start</span>
        <span>now</span>
      </div>
    </div>
  );
}

// The center summary band for the focused session: the rhythm chart + key stats +
// quantifiable context, then the primary action. Kept shallow on purpose — the
// file detail and the rest live in the rail. Mirrors the studio SessionSummary.

function SessionSummary({
  agentId,
  session,
  active,
  onPrimary,
  primaryLabel,
  primaryTitle,
}: {
  agentId: string;
  session: SessionCatalogEntry;
  active: boolean;
  onPrimary: () => void;
  primaryLabel: string;
  primaryTitle: string;
}) {
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);
  const [ctx, setCtx] = useState<LocalAgentContextState | null>(null);

  const load = useCallback(async () => {
    const [o, c] = await Promise.all([
      api<AgentObservePayload>(`/api/agents/${encodeURIComponent(agentId)}/observe`).catch(() => null),
      api<LocalAgentContextState>(`/api/agents/${encodeURIComponent(agentId)}/session/context`).catch(() => null),
    ]);
    setObserve(o);
    setCtx(c);
  }, [agentId]);
  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  const data = observe?.data;
  const events = data?.events ?? [];
  const workEvents = events.filter(isWorkTraceEvent);
  const toolEvents = workEvents.filter((e) => e.kind === "tool");
  const editEvents = toolEvents.filter((e) => e.tool === "edit" || e.tool === "write");
  const readEvents = toolEvents.filter((e) => e.tool === "read");
  const fileCount = data?.files.length ?? 0;
  const hasObservedWork = workEvents.length > 0 || fileCount > 0;
  const traceState =
    !observe
      ? "loading"
      : observe.source === "unavailable"
        ? "unavailable"
        : hasObservedWork
          ? "observed"
          : "waiting";
  const traceEmptyTitle =
    traceState === "loading"
      ? "Loading trace"
      : traceState === "unavailable"
        ? "No trace source"
        : "Session created";
  const traceEmptyDetail =
    traceState === "loading"
      ? "checking for terminal or transcript activity"
      : traceState === "unavailable"
        ? "this relay has no observable transcript attached"
        : "no agent work has been recorded yet";
  const stats: Array<{ k: string; v: string }> = [
    { k: "turns", v: fmtCompactNumber(ctx?.turnCount ?? data?.metadata?.session?.turnCount ?? 0) },
    { k: "tools", v: fmtCompactNumber(toolEvents.length) },
    { k: "edits", v: fmtCompactNumber(editEvents.length) },
    { k: "reads", v: fmtCompactNumber(readEvents.length) },
    { k: "files", v: fmtCompactNumber(fileCount) },
    { k: "window", v: fmtWindowSpan(workEvents.length > 0 ? workEvents[workEvents.length - 1]!.t : 0) },
  ];

  // Context, quantifiable only when the harness reports a real token window.
  // Turn policy is useful session bookkeeping, but it is not context usage.
  const usage = data?.metadata?.usage;
  const win = usage?.contextWindowTokens ?? 0;
  const used = usage?.totalTokens ?? usage?.inputTokens ?? 0;
  const tokenPct = win > 0 ? Math.min(100, Math.round((used / win) * 100)) : null;
  const ctxHead =
    tokenPct !== null
      ? `${fmtTokens(used)} / ${fmtTokens(win)} ctx`
      : ctx
        ? contextTurnLabel(ctx)
        : "context";
  const ctxPctLabel = tokenPct !== null ? `${tokenPct}%` : "tokens unavailable";
  // When the gauge already shows tokens, the runway adds turns + age. When the
  // head already shows turns, the runway is just age, so don't print the turns twice.
  const ctxAge = ctx && ctx.sessionAgeMs !== null ? formatContextAge(ctx.sessionAgeMs) : null;
  const ctxRunway =
    tokenPct !== null && ctx
      ? `${contextTurnLabel(ctx)}${ctxAge ? ` · ${ctxAge}` : ""}`
      : ctxAge;
  const observedSessionId =
    observe?.sessionId?.trim()
    || observe?.data.metadata?.session?.externalSessionId?.trim()
    || observe?.data.metadata?.session?.threadId?.trim()
    || null;
  const displaySessionId = active && observedSessionId ? observedSessionId : session.id;
  const profileSessionId = displaySessionId !== session.id ? session.id : null;
  const workspaceLabel = session.cwd ? pathLeaf(session.cwd) : "workspace";

  return (
    <div className="s-sum">
      <div className="s-sum-session-state">
        <span className={`s-sum-session-dot${active ? " s-sum-session-dot--active" : ""}`} />
        <span className="s-sum-session-copy">
          <strong>{active ? "Session attached" : "Previous session"}</strong>
          <span className="s-sum-session-ref" title={displaySessionId}>
            <span>session</span>
            <code>{shortSessionLabel(displaySessionId)}</code>
          </span>
          {profileSessionId && (
            <span className="s-sum-session-profile" title={profileSessionId}>
              profile {shortSessionLabel(profileSessionId)}
            </span>
          )}
          <small title={session.cwd || undefined}>{workspaceLabel}</small>
        </span>
        <span className={`s-sum-trace-pill s-sum-trace-pill--${traceState}`}>
          {traceState === "observed"
            ? "observing work"
            : traceState === "waiting"
              ? "waiting for work"
              : traceState === "loading"
                ? "checking trace"
                : "no trace"}
        </span>
      </div>
      <div className="s-sum-cols">
        <div className="s-sum-col s-sum-col--activity">
          <div className="s-sum-label">Observed work</div>
          <ActivitySparkline
            buckets={binEvents(workEvents)}
            emptyTitle={traceEmptyTitle}
            emptyDetail={traceEmptyDetail}
          />
        </div>
        <div className="s-sum-col s-sum-col--context">
          <div className="s-sum-label">Context</div>
          <div className="s-sum-ctx-head">
            <span className="s-sum-ctx-size">{ctxHead}</span>
            <span className="s-sum-ctx-pct">{ctxPctLabel}</span>
          </div>
          {tokenPct !== null ? (
            <div className="s-sum-gauge" aria-label={`Context ${tokenPct}%`}>
              <div className="s-sum-gauge-fill" style={{ width: `${tokenPct}%` }} />
            </div>
          ) : (
            <div className="s-sum-ctx-unavailable">No token-window usage yet</div>
          )}
          {ctxRunway && <div className="s-sum-ctx-runway">{ctxRunway}</div>}
        </div>
      </div>
      <div className="s-sum-foot">
        {hasObservedWork ? (
          <div className="s-sum-stats">
            {stats.map((m, i) => (
              <span key={m.k} className="s-sum-stat">
                {i > 0 && <span className="s-sum-stat-sep">·</span>}
                <span className="s-sum-stat-v">{m.v}</span>
                <span className="s-sum-stat-k">{m.k}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="s-sum-status-note">
            {active
              ? "The relay exists, but no turn/tool/file activity has reached Scout yet."
              : "This prior session has no observable work trace."}
          </div>
        )}
        <button type="button" className="s-sess-explore-primary" onClick={onPrimary} title={primaryTitle}>
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

// Sessions-first center (Hybrid): a compact essentials header (state · cwd ·
// branch · harness · model · host), then the agent's sessions by recency (active
// first). Clicking a session selects it (shared with the rail) and expands a
// light "exploring" strip with the one most-likely action — Continue (message
// into the conversation) or Resume — inline, right where the eye is. The
// secondary ways to engage (Observe / Take over / Trace) live in the rail, which
// follows the same selection. Selecting never jumps straight into a terminal.
function ModularProfileCenter({
  agent,
  name,
  sessionCatalog,
  conversationId,
  navigate,
  route,
}: {
  agent: Agent;
  name: string;
  sessionCatalog: SessionCatalogWithResume | null;
  conversationId: string | null;
  navigate: (r: Route) => void;
  route: Route;
}) {
  const { focusedSession, focusSession } = useScout();
  const activeSessionId = resolveActiveSessionId(agent, sessionCatalog);

  // Essentials as a 2×2 glyph grid (Tiered+): left column is location (path /
  // host), right column is work (branch / harness·model), one faint line-glyph
  // per cell. Format carries meaning, so no word labels. Model drops a redundant
  // harness prefix (claude-opus-4-8 → opus-4-8).
  const modelShort =
    agent.model && agent.harness && agent.model.startsWith(`${agent.harness}-`)
      ? agent.model.slice(agent.harness.length + 1)
      : agent.model ?? null;
  const cwdShort = agent.cwd ? (shortCwd(agent.cwd) ?? agent.cwd) : null;
  const hostShort = agent.homeNodeName
    ? agent.homeNodeName.replace(/\.local$/i, "")
    : null;
  const chip =
    [agent.harness, modelShort]
      .filter((v): v is string => Boolean(v))
      .join(" · ") || null;
  const hasEssentials = Boolean(cwdShort || agent.branch || hostShort || chip);

  const sessions = useMemo(
    () => sortSessionsByRecency(sessionCatalog?.sessions ?? [], activeSessionId),
    [sessionCatalog?.sessions, activeSessionId],
  );
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const handleLabel = agent.handle ? `@${agent.handle.replace(/^@+/, "")}` : null;
  const selectorLabel = agent.selector ?? agent.defaultSelector ?? null;
  const cwdFull = agent.cwd ?? agent.projectRoot ?? null;
  const cwdFact = cwdFull;
  const liveSessionModel = activeSession?.model ?? null;
  const hasDistinctSessionModel = Boolean(liveSessionModel && liveSessionModel !== agent.model);
  const [startState, setStartState] = useState<"idle" | "starting">("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [chatState, setChatState] = useState<"idle" | "opening">("idle");
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    setStartState("idle");
    setStartError(null);
    setChatState("idle");
    setChatError(null);
  }, [agent.id]);

  // Selection is shared with the rail (Provider): it defaults to the active (or
  // most recent) session, and clicking a row only re-points it — never jumps.
  const selectedSessionId = resolveSelectedSessionId(
    agent.id,
    focusedSession,
    activeSessionId,
    sessions,
  );

  const openMessage = async () => {
    if (chatState === "opening") return;
    setChatState("opening");
    setChatError(null);
    try {
      const chatId = await ensureAgentChat({ ...agent, conversationId });
      navigate({
        view: "agents",
        agentId: agent.id,
        conversationId: chatId,
        tab: "message",
      });
    } catch (caught) {
      setChatError(caught instanceof Error ? caught.message : "Could not open chat.");
    } finally {
      setChatState("idle");
    }
  };
  const startNewSession = async () => {
    if (startState === "starting") return;
    setStartState("starting");
    setStartError(null);
    try {
      const result = await api<SessionInitiationResult>("/api/sessions", {
        method: "POST",
        body: JSON.stringify(newSessionPayloadForAgent(agent)),
      });
      const conversationId = result.conversationId?.trim();
      if (!conversationId) {
        throw new Error("Session started, but no conversation was returned.");
      }
      navigate({
        view: "agents",
        agentId: result.agentId?.trim() || agent.id,
        conversationId,
        tab: "message",
      });
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start a new session.");
    } finally {
      setStartState("idle");
    }
  };
  const resumeSession = (s: SessionCatalogEntry) =>
    openContent(navigate, { view: "sessions", sessionId: s.id }, { returnTo: route });

  return (
    <div className="s-sess-root">
      <header className="s-sess-head">
        <div className="s-sess-id">
          <span className="s-sess-avatar">
            <AgentAvatar agent={agent} size={54} tile presence={false} />
          </span>
          <div className="s-sess-id-copy">
            <div className="s-sess-name-row">
              <span className="s-sess-name">{name}</span>
              {agent.handle && (
                <span className="s-sess-handle">@{agent.handle.replace(/^@+/, "")}</span>
              )}
            </div>
            {hasEssentials && (
              <div className="s-sess-glyph">
                <div className="s-sess-glyph-col">
                  {cwdShort && <EssentialCell ico={<IcoFolder />} v={cwdShort} />}
                  {hostShort && <EssentialCell ico={<IcoHost />} v={hostShort} />}
                </div>
                <div className="s-sess-glyph-col">
                  {agent.branch && <EssentialCell ico={<IcoBranch />} v={agent.branch} />}
                  {chip && <EssentialCell ico={<IcoChip />} v={chip} />}
                </div>
              </div>
            )}
            <div className="s-sess-facts" aria-label="Agent identity and runtime facts">
              {handleLabel && <HeaderFact label="Handle" value={handleLabel} />}
              {cwdFact && <HeaderFact label="Path" value={cwdFact} title={cwdFull ?? cwdFact} />}
              {hasDistinctSessionModel && liveSessionModel && (
                <HeaderFact label="Session model" value={liveSessionModel} />
              )}
              {(agent.harness || agent.model) && (
                <HeaderFact
                  label="Model"
                  value={agent.model ?? `${agent.harness ?? "harness"} default`}
                />
              )}
              {selectorLabel && <HeaderFact label="Selector" value={selectorLabel} />}
            </div>
          </div>
        </div>
        {/* Header CTA mirrors the studio: "+ New session" (start fresh) — a
            distinct action from per-session Continue and the Message tab, so
            "Message" isn't duplicated across the tab, the header, and Continue. */}
        <div className="s-sess-head-actions">
          <button
            type="button"
            className="s-sess-action"
            onClick={() => navigate({ view: "settings", section: "agents", agentId: agent.id })}
          >
            Edit config
          </button>
          <button
            type="button"
            className="s-sess-action"
            disabled={startState === "starting"}
            onClick={startNewSession}
          >
            {startState === "starting" ? "Starting..." : "+ New session"}
          </button>
          {startError && <div className="s-sess-action-error">{startError}</div>}
          {chatError && <div className="s-sess-action-error">{chatError}</div>}
        </div>
      </header>

      <section className="s-sess-band">
        <header className="s-sess-band-head">
          <span className="s-sess-band-label">Recent sessions</span>
          {sessions.length > 0 && (
            <span className="s-sess-band-meta">{sessions.length} sessions</span>
          )}
        </header>
        <div className="s-sess-list">
          {sessions.length === 0 ? (
            <div className="s-sess-empty">No sessions yet — start a new session for {name}.</div>
          ) : (
            sessions.map((s) => {
              const active = s.id === activeSessionId;
              const selected = s.id === selectedSessionId;
              const rowHarness = s.harness ?? agent.harness ?? "session";
              const rowModelRaw = s.model ?? agent.model;
              const rowModel =
                rowModelRaw && rowHarness && rowModelRaw.startsWith(`${rowHarness}-`)
                  ? rowModelRaw.slice(rowHarness.length + 1)
                  : rowModelRaw;
              const engineLabel = [rowHarness, rowModel]
                .filter((value): value is string => Boolean(value))
                .join(" · ");
              const surfaceLabel = s.surfaceSessionId
                ? `${s.transport ?? agent.transport ?? "terminal"} surface ${compactSurfaceSessionLabel(s.surfaceSessionId)}`
                : s.transport && s.transport !== rowHarness
                  ? `${s.transport} surface`
                  : null;
              // No status words (active/ready/live) — the live session reads as
              // `now` in the accent; ended ones show how long ago, dim.
              const when = active
                ? "now"
                : s.endedAt
                  ? `ended · ${timeAgo(s.endedAt) || "recent"}`
                  : timeAgo(s.startedAt) || "recent";
              return (
                <div key={s.id} className={`s-sess-item${selected ? " s-sess-item--selected" : ""}`}>
                  <button
                    type="button"
                    className={`s-sess-row${active ? " s-sess-row--active" : ""}${selected ? " s-sess-row--selected" : ""}`}
                    onClick={() => focusSession(agent.id, s.id)}
                    aria-expanded={selected}
                  >
                    <span
                      className="s-mod-dot s-sess-row-dot"
                      style={{
                        background: active ? "var(--accent)" : "var(--dim)",
                        opacity: active ? 1 : 0.55,
                      }}
                    />
                    <span className="s-sess-row-main">
                      <span className="s-sess-row-top">
                        <span className="s-sess-row-id" title={s.id}>{shortSessionLabel(s.id)}</span>
                        <span className="s-sess-row-tag">{engineLabel}</span>
                      </span>
                      <span className="s-sess-row-sub" title={surfaceLabel ?? undefined}>
                        {s.cwd ? pathLeaf(s.cwd) : "workspace"}
                        {surfaceLabel ? ` · ${surfaceLabel}` : ""}
                      </span>
                    </span>
                    <span
                      className={`s-sess-row-when${active ? " s-sess-row-when--active" : ""}`}
                    >
                      {when}
                    </span>
                  </button>
                  {selected && (
                    <SessionSummary
                      agentId={agent.id}
                      session={s}
                      active={active}
                      onPrimary={() => (active ? void openMessage() : resumeSession(s))}
                      primaryLabel={active ? "Continue" : "Resume"}
                      primaryTitle={
                        active
                          ? "Send a message into this conversation"
                          : "Reopen this conversation and message it"
                      }
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

export function AgentDetailWithRail({
  agent,
  allAgents,
  conversationId,
  navigate,
  activeTab,
}: {
  agent: Agent;
  allAgents: Agent[];
  conversationId: string | null;
  navigate: (r: Route) => void;
  activeTab: AgentTab;
}) {
  const { name } = agentLabel(agent, allAgents);
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);
  const [observeLoading, setObserveLoading] = useState(false);
  const [sessionCatalog, setSessionCatalog] = useState<SessionCatalogWithResume | null>(null);
  const { route } = useScout();

  const load = useCallback(async () => {
    const catalogResult = await api<SessionCatalogWithResume>(
      `/api/agents/${encodeURIComponent(agent.id)}/session-catalog`,
    ).catch(() => null);
    setSessionCatalog(catalogResult);
  }, [agent.id]);

  const loadObserve = useCallback(async () => {
    setObserveLoading(true);
    try {
      const result = await api<AgentObservePayload>(
        `/api/agents/${encodeURIComponent(agent.id)}/observe`,
      );
      setObserve(result);
    } catch {
      setObserve({
        agentId: agent.id,
        source: "unavailable",
        fidelity: "synthetic",
        historyPath: null,
        sessionId: null,
        updatedAt: Date.now(),
        data: {
          events: [
            {
              id: `${agent.id}:observe-error`,
              t: 0,
              kind: "system",
              text: "Observer data is temporarily unavailable.",
              detail: "Retrying will resume once the session source becomes reachable.",
            },
          ],
          files: [],
          contextUsage: [],
          live: false,
        },
      });
    } finally {
      setObserveLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    setSessionCatalog(null);
    void load();
    const retry = window.setTimeout(() => {
      void load();
    }, 3000);
    return () => window.clearTimeout(retry);
  }, [load]);

  useEffect(() => {
    setObserve(null);
    setObserveLoading(false);
  }, [agent.id]);

  useEffect(() => {
    if (activeTab !== "observe") {
      return;
    }
    void loadObserve();
  }, [activeTab, loadObserve]);

  useBrokerEvents(() => {
    void load();
    if (activeTab === "observe") {
      void loadObserve();
    }
  });

  useEffect(() => {
    if (activeTab !== "observe" || !observe?.data.live) {
      return;
    }
    const timer = setInterval(() => {
      void loadObserve();
    }, 2500);
    return () => clearInterval(timer);
  }, [activeTab, observe?.data.live, loadObserve]);

  return (
    <div
      className={`s-profile-center${
        activeTab !== "profile" ? " s-profile-center--tabbed" : " s-profile-center--modular"
      }`}
    >
      {activeTab === "profile" && (
        <ModularProfileCenter
          agent={agent}
          name={name}
          sessionCatalog={sessionCatalog}
          conversationId={conversationId}
          navigate={navigate}
          route={route}
        />
      )}

      {activeTab === "observe" && (
        <div className="s-profile-tab-conversation">
          {observeLoading && !observe ? (
            <div className="s-profile-activity-empty">
              <div className="s-profile-activity-empty-title">Loading trace</div>
              <div className="s-profile-activity-empty-detail">
                Resolving the best available live or history-backed session stream for this agent.
              </div>
            </div>
          ) : (
            <SessionObserve
              data={observe?.data}
              agentId={agent.id}
              sessionId={observe?.sessionId}
              showRail={false}
            />
          )}
        </div>
      )}

      {activeTab === "message" && (
        conversationId ? (
          <div className="s-profile-tab-conversation">
            <ConversationScreen
              conversationId={conversationId}
              navigate={navigate}
              embedded
            />
          </div>
        ) : (
          <StartAgentChatPane
            agent={agent}
            navigate={navigate}
          />
        )
      )}
    </div>
  );
}

function StartAgentChatPane({
  agent,
  navigate,
}: {
  agent: Agent;
  navigate: (r: Route) => void;
}) {
  const [state, setState] = useState<"idle" | "opening">("idle");
  const [error, setError] = useState<string | null>(null);

  const openChat = async () => {
    if (state === "opening") return;
    setState("opening");
    setError(null);
    try {
      const conversationId = await ensureAgentChat(agent);
      navigate({
        view: "agents",
        agentId: agent.id,
        conversationId,
        tab: "message",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open chat.");
    } finally {
      setState("idle");
    }
  };

  return (
    <div className="s-profile-tab-conversation">
      <div className="s-profile-activity-empty">
        <div className="s-profile-activity-empty-title">No chat yet</div>
        <div className="s-profile-activity-empty-detail">
          Open a direct chat with {agent.name}. The broker will create a real chat ID and keep routing by this agent identity.
        </div>
        {error && <div className="s-sess-action-error">{error}</div>}
        <button
          type="button"
          className="s-sess-action"
          disabled={state === "opening"}
          onClick={() => void openChat()}
        >
          {state === "opening" ? "Opening..." : "Open chat"}
        </button>
      </div>
    </div>
  );
}

export function AgentProfileBar({
  agent,
  conversationId,
  activeTab,
  navigate,
}: {
  agent: Agent;
  conversationId: string | null;
  activeTab: AgentTab;
  navigate: (r: Route) => void;
}) {
  const tabs: { key: AgentTab; label: string; disabled?: boolean }[] = [
    { key: "profile", label: "Profile" },
    // "Trace" = the parsed turn/tool feed (route stays `observe`). "Observe" is
    // reserved for watching the live terminal (the rail's Terminal action), so
    // the two surfaces no longer share a word.
    { key: "observe", label: "Trace" },
    { key: "message", label: "Message" },
  ];
  const navigateToTab = (tab: AgentTab) =>
    navigate({
      view: "agents",
      agentId: agent.id,
      ...(conversationId ? { conversationId } : {}),
      tab,
    });
  return (
    <div className="s-agent-bar">
      <BackToPicker
        slot="agents"
        fallback={{ view: "agents" }}
        navigate={navigate}
        className="s-agent-bar-back"
      />
      <nav className="s-profile-tabs s-agent-bar-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`s-profile-tab${activeTab === t.key ? " s-profile-tab--active" : ""}`}
            disabled={t.disabled}
            onClick={() => navigateToTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
