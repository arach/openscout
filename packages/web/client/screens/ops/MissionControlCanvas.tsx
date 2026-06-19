import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type * as React from "react";
import { ChevronDown, ChevronUp, Crosshair, Maximize2 } from "lucide-react";
import { actorColor } from "../../lib/colors.ts";
import { agentStateLabel, isAgentBusy, normalizeAgentState } from "../../lib/agent-state.ts";
import { useFocusTrap } from "../../lib/keyboard-nav.ts";
import { timeAgo } from "../../lib/time.ts";
import { statusOnHover } from "../../lib/page-status.ts";
import { summarizeObserveEvent } from "../../lib/observe.ts";
import { DictationMic } from "../../components/DictationMic.tsx";
import { type SessionObserveData } from "../sessions/SessionObserve.tsx";
import type { Agent, ObserveEvent } from "../../lib/types.ts";
import {
  KIND_COLOR,
  KIND_LABEL,
  MINIMAP_FALLBACK_W,
  MINIMAP_MAX_H,
  TILE_H,
  TILE_W,
  stateChipColor,
} from "./mission-control-model.ts";

export type CanvasLayout = {
  groups: Array<{
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    tiles: Array<{ agentId: string; x: number; y: number }>;
  }>;
  canvasW: number;
  canvasH: number;
};

/* ── Observe tile ── */

export function ObserveTile({
  agent,
  observe,
  x,
  y,
  selected = false,
  canvasFocused = false,
  onToggleSelected,
  onClick,
}: {
  agent: Agent;
  observe: SessionObserveData | null;
  x: number;
  y: number;
  selected?: boolean;
  canvasFocused?: boolean;
  onToggleSelected: () => void;
  onClick: (e: ReactMouseEvent) => void;
}) {
  const streamRef = useRef<HTMLDivElement>(null);
  const state = normalizeAgentState(agent.state);
  const color = actorColor(agent.name);
  const events = observe?.events ?? [];
  const tail = events.slice(-8);
  const isLive = observe?.live === true;
  const hasAsk = events.some((e) => e.kind === "ask" && !e.answer);

  const ctxUsage = observe?.contextUsage;
  const ctxPct = ctxUsage && ctxUsage.length > 0
    ? Math.round(ctxUsage[ctxUsage.length - 1] * 100)
    : null;

  const toolCount = events.filter((e) => e.kind === "tool").length;
  const editCount = events.filter((e) => e.kind === "tool" && e.tool === "edit").length;

  const hoverHandlers = statusOnHover({
    label: `Focus ${agent.handle ?? agent.name}`,
    route: `/ops/control · ${agent.id}`,
  });

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div
      className={[
        "s-mission-tile",
        state === "in_turn" || state === "in_flight" ? "s-mission-tile--working" : null,
        hasAsk ? "s-mission-tile--asking" : null,
        selected ? "s-mission-tile--selected" : null,
        canvasFocused ? "s-mission-tile--canvas-focused" : null,
      ].filter(Boolean).join(" ")}
      style={{ left: x, top: y, height: TILE_H }}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onPointerEnter={hoverHandlers.onPointerEnter}
      onPointerLeave={hoverHandlers.onPointerLeave}
    >
      <div className="s-mission-tile-header">
        <button
          type="button"
          className={`s-mission-select${selected ? " s-mission-select--selected" : ""}`}
          aria-pressed={selected}
          title={selected ? "Remove from selection" : "Select for batch actions"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected();
          }}
        />
        <div
          className="s-ops-avatar"
          style={{ "--size": "22px", background: color } as React.CSSProperties}
        >
          {agent.name[0]?.toUpperCase()}
        </div>
        <div className="s-mission-tile-identity">
          <div className="s-mission-tile-name">
            {agent.name}
            <span className="s-mission-tile-handle">
              {agent.handle ? `@${agent.handle}` : ""}
            </span>
          </div>
          <div className="s-mission-tile-meta">
            {agent.project ?? "—"} · {agent.branch ?? "main"}
          </div>
        </div>
        <span className="s-ops-state-chip" style={{ color: stateChipColor(state) }}>
          {agentStateLabel(agent.state).toUpperCase()}
        </span>
      </div>

      <div className="s-mission-tile-stream" ref={streamRef}>
        {tail.length === 0 ? (
          <div className="s-mission-tile-stream-inner">
            <div className="s-mission-evt">
              <span className="s-mission-evt-bead" style={{ background: "var(--dim)" }} />
              <span className="s-mission-evt-text" style={{ color: "var(--dim)" }}>
                {state === "blocked" ? "No session data" : "Waiting for events…"}
              </span>
            </div>
          </div>
        ) : (
          <div className="s-mission-tile-stream-inner">
            {tail.map((evt) => (
              <div key={evt.id} className="s-mission-evt">
                <span
                  className="s-mission-evt-bead"
                  style={{ background: KIND_COLOR[evt.kind] ?? "var(--dim)" }}
                />
                <span className="s-mission-evt-kind">
                  {KIND_LABEL[evt.kind] ?? evt.kind}
                </span>
                <span className={`s-mission-evt-text s-mission-evt-text--${evt.kind}`}>
                  {summarizeObserveEvent(evt)}
                  {evt.live && <span className="s-observe-cursor" />}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="s-mission-tile-footer">
        {ctxPct !== null && (
          <div className="s-mission-tile-ctx" title={`Context: ${ctxPct}%`}>
            <div className="s-mission-tile-ctx-fill" style={{ width: `${ctxPct}%` }} />
          </div>
        )}
        <div className="s-mission-tile-stats">
          {toolCount > 0 && <span>{toolCount} tools</span>}
          {editCount > 0 && <span>{editCount} edits</span>}
        </div>
        {isLive && (
          <span className="s-mission-tile-live">
            <span className="s-mission-tile-live-dot" />
            LIVE
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Focus overlay — full SessionObserve ── */

type FocusTab = "profile" | "activity" | "message";

export function FocusOverlay({
  agent,
  observe,
  onClose,
  onSend,
  onOpenConversation,
  onTail,
  onProfile,
}: {
  agent: Agent;
  observe: SessionObserveData | null;
  onClose: () => void;
  onSend: (body: string, mode: "tell" | "ask") => Promise<void>;
  onOpenConversation: () => void;
  onTail: () => void;
  onProfile: () => void;
}) {
  const color = actorColor(agent.name);
  const { ref: dialogRef, onKeyDown: onTrapKeyDown } = useFocusTrap<HTMLDivElement>();
  const [tab, setTab] = useState<FocusTab>("profile");

  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onTrapKeyDown(e);
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    const inEditable = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || (target?.isContentEditable ?? false);
    if (inEditable) return;
    if (e.key === "1") { e.preventDefault(); setTab("profile"); }
    else if (e.key === "2") { e.preventDefault(); setTab("activity"); }
    else if (e.key === "3") { e.preventDefault(); setTab("message"); }
  };

  return (
    <div className="s-mission-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-overlay-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        tabIndex={-1}
        className="s-mission-overlay-dialog"
      >
        <div className="s-mission-overlay-header">
          <div
            className="s-ops-avatar"
            style={{ "--size": "28px", background: color } as React.CSSProperties}
          >
            {agent.name[0]?.toUpperCase()}
          </div>
          <div className="s-mission-overlay-identity">
            <div className="s-mission-overlay-name" id="mission-overlay-title">
              {agent.name}{" "}
              <span className="s-mission-overlay-handle">
                {agent.handle ? `@${agent.handle}` : ""}
              </span>
            </div>
            <div className="s-mission-overlay-meta">
              {agent.project ?? "—"} · {agent.branch ?? "main"} · {agentStateLabel(agent.state)}
            </div>
          </div>
          <button
            className="s-mission-overlay-close"
            onClick={onClose}
            aria-label="Close (Esc)"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="s-mission-overlay-tabs" role="tablist">
          <div className="s-mission-overlay-tabs-group">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "profile"}
              className={`s-mission-overlay-tab${tab === "profile" ? " s-mission-overlay-tab--active" : ""}`}
              onClick={() => setTab("profile")}
            >
              Profile
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "activity"}
              className={`s-mission-overlay-tab${tab === "activity" ? " s-mission-overlay-tab--active" : ""}`}
              onClick={() => setTab("activity")}
            >
              Activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "message"}
              className={`s-mission-overlay-tab${tab === "message" ? " s-mission-overlay-tab--active" : ""}`}
              onClick={() => setTab("message")}
            >
              Message
            </button>
          </div>
          <div className="s-mission-overlay-tabs-action">
            {tab === "profile" && (
              <button
                type="button"
                className="s-mission-overlay-jump"
                onClick={onProfile}
                {...statusOnHover({
                  label: `Open profile · ${agent.handle ?? agent.name}`,
                  route: `/agents/${agent.id}`,
                })}
              >
                Open profile ↗
              </button>
            )}
            {tab === "activity" && (
              <button
                type="button"
                className="s-mission-overlay-jump"
                onClick={onTail}
                {...statusOnHover({
                  label: `Tail · ${agent.handle ?? agent.name}`,
                  route: `/ops/tail?q=${encodeURIComponent(agent.handle ?? agent.name)}`,
                })}
              >
                Open in Tail ↗
              </button>
            )}
            {tab === "message" && (
              <button
                type="button"
                className="s-mission-overlay-jump"
                onClick={onOpenConversation}
                {...statusOnHover({
                  label: `Open conversation with ${agent.handle ?? agent.name}`,
                  route: `/c/${agent.conversationId}`,
                })}
              >
                Open conversation ↗
              </button>
            )}
          </div>
        </div>

        <div className="s-mission-overlay-body">
          {tab === "profile" && <FocusProfileTab agent={agent} />}
          {tab === "activity" && (
            <FocusActivityTab
              agent={agent}
              observe={observe}
              onOpenConversation={onOpenConversation}
              onMessage={() => setTab("message")}
            />
          )}
          {tab === "message" && (
            <FocusMessageTab
              agent={agent}
              onSend={onSend}
              onOpenConversation={onOpenConversation}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FocusProfileTab({ agent }: { agent: Agent }) {
  const rows: Array<[string, string]> = [
    ["MODEL", [agent.harness, agent.model].filter(Boolean).join("/") || "—"],
    ["AT", [agent.project, agent.branch].filter(Boolean).join("/") || "—"],
    ["CWD", agent.cwd || agent.projectRoot || "—"],
    ["AGENT", agent.agentClass || "—"],
    ["ROLE", agent.role || agent.transport || "—"],
    ["MACHINE", agent.authorityNodeName ?? agent.homeNodeName ?? agent.authorityNodeId ?? agent.homeNodeId ?? "—"],
    ["OWNER", agent.ownerHandle ?? agent.ownerName ?? agent.ownerId ?? "—"],
    ["SPAWNED", agent.createdAt ? timeAgo(agent.createdAt) : "—"],
    ["STATE", agentStateLabel(agent.state)],
  ];
  return (
    <div className="s-focus-tab">
      <dl className="s-focus-spec">
        {rows.map(([k, v]) => (
          <div key={k} className="s-focus-spec-row">
            <dt className="s-focus-spec-label">{k}</dt>
            <dd className="s-focus-spec-value" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const ACTIVITY_PREVIEW_LIMIT = 14;

const KIND_GLYPH: Record<string, string> = {
  tool: "▸",
  think: "·",
  ask: "?",
  message: "✉",
  note: "•",
  system: "◇",
  boot: "↑",
};

function formatEventAge(secondsFromStart: number, sessionStart?: number | null): string {
  if (sessionStart) {
    const ms = Date.now() - (sessionStart + secondsFromStart * 1000);
    if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
    return `${Math.round(ms / 86_400_000)}d`;
  }
  const s = Math.max(0, Math.round(secondsFromStart));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function eventSummary(event: ObserveEvent): string {
  if (event.kind === "tool") {
    const head = event.tool ?? "tool";
    return event.arg ? `${head} · ${event.arg}` : head;
  }
  if (event.kind === "ask") {
    return event.text || "asked something";
  }
  return event.text || event.detail || KIND_LABEL[event.kind] || event.kind;
}

function FocusActivityTab({
  agent,
  observe,
  onOpenConversation,
  onMessage,
}: {
  agent: Agent;
  observe: SessionObserveData | null;
  onOpenConversation: () => void;
  onMessage: () => void;
}) {
  const events = observe?.events ?? [];
  const usage = observe?.metadata?.usage;
  const sessionStart = typeof (observe?.metadata?.session as Record<string, unknown> | undefined)?.["sessionStart"] === "number"
    ? ((observe?.metadata?.session as Record<string, unknown>)["sessionStart"] as number)
    : null;

  const recent = events.slice(-ACTIVITY_PREVIEW_LIMIT).reverse();

  const turnCount = usage?.assistantMessages ?? events.filter((e) => e.kind === "message").length;
  const toolCount = events.filter((e) => e.kind === "tool").length;
  const editCount = events.filter(
    (e) => e.kind === "tool" && (e.tool === "edit" || e.tool === "write"),
  ).length;
  const ctxPct = observe?.contextUsage && observe.contextUsage.length > 0
    ? Math.round(observe.contextUsage[observe.contextUsage.length - 1] * 100)
    : null;
  const ctxLabel = ctxPct !== null
    ? `${ctxPct}%`
    : usage?.contextWindowTokens && usage?.totalTokens
      ? `${Math.round((usage.totalTokens / usage.contextWindowTokens) * 100)}%`
      : "—";

  return (
    <div className="s-focus-tab s-focus-tab--activity-preview">
      <dl className="s-focus-stats">
        <Stat label="Turns" value={turnCount || "—"} />
        <Stat label="Tools" value={toolCount || "—"} />
        <Stat label="Edits" value={editCount || "—"} />
        <Stat label="Context" value={ctxLabel} />
      </dl>

      {recent.length === 0 ? (
        <FocusActivityEmpty
          agent={agent}
          onOpenConversation={onOpenConversation}
          onMessage={onMessage}
        />
      ) : (
        <ul className="s-focus-activity-list">
          {recent.map((event) => (
            <li key={event.id} className={`s-focus-activity-row s-focus-activity-row--${event.kind}`}>
              <span className="s-focus-activity-time">{formatEventAge(event.t, sessionStart)}</span>
              <span className="s-focus-activity-glyph" aria-hidden>
                {KIND_GLYPH[event.kind] ?? "·"}
              </span>
              <span className="s-focus-activity-kind">{KIND_LABEL[event.kind] ?? event.kind}</span>
              <span className="s-focus-activity-text">{eventSummary(event)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FocusActivityEmpty({
  agent,
  onOpenConversation,
  onMessage,
}: {
  agent: Agent;
  onOpenConversation: () => void;
  onMessage: () => void;
}) {
  const role = agent.role?.trim();
  const harness = [agent.harness, agent.model].filter(Boolean).join("/");
  const where = [agent.project, agent.branch].filter(Boolean).join("/");
  const state = normalizeAgentState(agent.state);
  const stateLabel = agentStateLabel(state);
  const spawned = agent.createdAt ? timeAgo(agent.createdAt) : null;
  const lastSeen = agent.updatedAt ? timeAgo(agent.updatedAt) : null;
  const home = agent.homeNodeName ?? agent.homeNodeId;

  const owner = agent.ownerHandle ?? agent.ownerName ?? agent.ownerId;

  const facts: { label: string; value: string }[] = [];
  if (role) facts.push({ label: "Role", value: role });
  if (harness) facts.push({ label: "Stack", value: harness });
  if (where) facts.push({ label: "At", value: where });
  if (home) facts.push({ label: "Home", value: home });
  if (owner) facts.push({ label: "Owner", value: owner });
  if (spawned) facts.push({ label: "Spawned", value: spawned });
  facts.push({ label: "State", value: stateLabel });
  if (lastSeen) facts.push({ label: "Last seen", value: lastSeen });

  return (
    <div className="s-focus-activity-empty s-focus-activity-empty--rich">
      <div className="s-focus-activity-empty-head">
        <span className="s-focus-activity-empty-eyebrow">No tool or turn events recorded</span>
        <span className="s-focus-activity-empty-title">{agent.handle ?? agent.name}</span>
      </div>
      <dl className="s-focus-activity-empty-facts">
        {facts.map((f) => (
          <div key={f.label} className="s-focus-activity-empty-fact">
            <dt>{f.label}</dt>
            <dd title={f.value}>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="s-focus-activity-empty-actions">
        <button
          type="button"
          className="s-focus-activity-empty-btn"
          onClick={onOpenConversation}
          {...statusOnHover({
            label: `Open conversation with ${agent.handle ?? agent.name}`,
            route: `/c/${agent.conversationId}`,
          })}
        >
          Open conversation ↗
        </button>
        <button
          type="button"
          className="s-focus-activity-empty-btn s-focus-activity-empty-btn--primary"
          onClick={onMessage}
          {...statusOnHover({
            label: `Compose message · ${agent.handle ?? agent.name}`,
          })}
        >
          Send a message
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="s-focus-stat">
      <dt className="s-focus-stat-label">{label}</dt>
      <dd className="s-focus-stat-value">{value}</dd>
    </div>
  );
}

function FocusMessageTab({
  agent,
  onSend,
  onOpenConversation,
}: {
  agent: Agent;
  onSend: (body: string, mode: "tell" | "ask") => Promise<void>;
  onOpenConversation: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<"tell" | "ask" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const send = async (mode: "tell" | "ask") => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(body, mode);
      setDraft("");
      setSent(mode);
      setTimeout(() => setSent(null), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) void send("ask");
      else void send("tell");
    }
  };

  const name = agent.handle ?? agent.name;
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <div className="s-focus-tab">
      <div className="s-focus-compose">
        <label className="s-focus-compose-label" htmlFor="s-focus-compose-input">
          Message <span className="s-focus-compose-target">@{name}</span>
        </label>
        <textarea
          id="s-focus-compose-input"
          ref={textareaRef}
          className="s-focus-compose-input"
          placeholder={`Steer @${name}…   (⌘↩ to Steer · ⌘⇧↩ to Ask)`}
          rows={6}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
        />
        <div className="s-focus-compose-foot">
          <div className="s-focus-compose-hint">
            {error ? (
              <span className="s-focus-compose-error">Send failed: {error}</span>
            ) : sent === "tell" ? (
              <span className="s-focus-compose-ok">Steered ↗ <button type="button" className="s-focus-compose-link" onClick={onOpenConversation}>Open thread</button></span>
            ) : sent === "ask" ? (
              <span className="s-focus-compose-ok">Asked ↗ <button type="button" className="s-focus-compose-link" onClick={onOpenConversation}>Open thread</button></span>
            ) : (
              <>
                <strong>Steer</strong> redirects what they're doing. <strong>Ask</strong> waits for a structured answer.
              </>
            )}
          </div>
          <div className="s-focus-compose-actions">
            <DictationMic
              onAppend={(text) =>
                setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
              }
            />
            <button
              type="button"
              className="s-ops-btn"
              onClick={() => void send("ask")}
              disabled={!canSend}
            >
              Ask
            </button>
            <button
              type="button"
              className="s-ops-btn s-ops-btn--primary"
              onClick={() => void send("tell")}
              disabled={!canSend}
            >
              Steer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Minimap ── */

export function Minimap({
  layout,
  agents,
  pan,
  zoom,
  viewportRef,
  isCollapsed,
  onToggleCollapse,
  onFitAll,
  onHome,
  onClick,
}: {
  layout: CanvasLayout;
  agents: Agent[];
  pan: { x: number; y: number };
  zoom: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onFitAll: () => void;
  onHome: () => void;
  onClick: (point: { x: number; y: number }) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [measuredMapW, setMeasuredMapW] = useState(0);
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;

    const updateWidth = () => setMeasuredMapW(element.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (layout.canvasW === 0) return null;

  const mapW = measuredMapW || MINIMAP_FALLBACK_W;
  const mmScale = Math.min(mapW / layout.canvasW, MINIMAP_MAX_H / layout.canvasH);
  const mmW = layout.canvasW * mmScale;
  const mmH = layout.canvasH * mmScale;
  const mapOffsetX = Math.max(0, (mapW - mmW) / 2);

  const vp = viewportRef.current;
  const vpW = vp?.clientWidth ?? 0;
  const vpH = vp?.clientHeight ?? 0;
  const vx = (-pan.x / zoom) * mmScale;
  const vy = (-pan.y / zoom) * mmScale;
  const vw = (vpW / zoom) * mmScale;
  const vh = (vpH / zoom) * mmScale;
  const handleCanvasClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = Math.max(0, Math.min(mmW, e.clientX - rect.left - mapOffsetX));
      const my = Math.max(0, Math.min(mmH, e.clientY - rect.top));
      onClick({ x: mx / mmScale, y: my / mmScale });
    },
    [mapOffsetX, mmH, mmScale, mmW, onClick],
  );

  if (isCollapsed) {
    return (
      <div className="s-mission-minimap s-mission-minimap--collapsed">
        <div className="s-mission-minimap-header">
          <span className="s-mission-minimap-title">
            <span className="s-mission-minimap-title-mark" aria-hidden />
            MAP
          </span>
          <button
            type="button"
            className="s-mission-minimap-action"
            title="Expand map"
            aria-label="Expand map"
            onClick={onToggleCollapse}
          >
            <ChevronUp size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="s-mission-minimap">
      <div className="s-mission-minimap-header">
        <span className="s-mission-minimap-title">
          <span className="s-mission-minimap-title-mark" aria-hidden />
          MAP
        </span>
        <div className="s-mission-minimap-actions">
          <button
            type="button"
            className="s-mission-minimap-action"
            title="Fit all"
            aria-label="Fit all"
            onClick={onFitAll}
          >
            <Maximize2 size={12} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="s-mission-minimap-action"
            title="Recenter"
            aria-label="Recenter"
            onClick={onHome}
          >
            <Crosshair size={12} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="s-mission-minimap-action"
            title="Minimize map"
            aria-label="Minimize map"
            onClick={onToggleCollapse}
          >
            <ChevronDown size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div ref={mapRef} className="s-mission-minimap-canvas" style={{ height: mmH }} onClick={handleCanvasClick} aria-hidden="true">
        {layout.groups.flatMap((g) =>
          g.tiles.map((t) => {
            const agent = agents.find((a) => a.id === t.agentId);
            return (
              <div
                key={t.agentId}
                className="s-mission-minimap-tile"
                style={{
                  left: mapOffsetX + t.x * mmScale,
                  top: t.y * mmScale,
                  width: TILE_W * mmScale,
                  height: TILE_H * mmScale,
                  background: agent ? actorColor(agent.name) : "var(--dim)",
                  opacity: agent && isAgentBusy(agent.state) ? 0.8 : 0.35,
                }}
              />
            );
          }),
        )}
        <div
          className="s-mission-minimap-viewport"
          style={{
            left: mapOffsetX + Math.max(0, vx),
            top: Math.max(0, vy),
            width: Math.min(vw, mmW),
            height: Math.min(vh, mmH),
          }}
        >
        </div>
      </div>
    </div>
  );
}
