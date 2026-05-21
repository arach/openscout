import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AgentIdentity } from "@openscout/protocol";
import { ArrowUpRight, MessageCircle, Send } from "lucide-react";

import { api } from "../lib/api.ts";
import { agentStateLabel, normalizeAgentState } from "../lib/agent-state.ts";
import { stateColor } from "../lib/colors.ts";
import { conversationForAgent } from "../lib/router.ts";
import { useScout } from "../scout/Provider.tsx";
import type { Agent } from "../lib/types.ts";

const HOVER_INTENT_MS = 280;
const HIDE_GRACE_MS = 120;
const CARD_WIDTH = 320;
const CARD_GUTTER = 8;

/** Cache fetches so re-hover doesn't re-fire the request. */
const agentCache = new Map<string, { agent: Agent | null; fetchedAt: number }>();
const CACHE_TTL_MS = 10_000;

function lookupAgent(identity: AgentIdentity, agents: Agent[]): Agent | null {
  if (identity.definitionId) {
    const byId = agents.find((a) => a.id === identity.definitionId);
    if (byId) return byId;
  }
  const handle = identity.label.replace(/^@/, "").toLowerCase();
  return (
    agents.find((a) => (a.handle ?? "").toLowerCase() === handle) ??
    agents.find((a) => a.name.toLowerCase() === handle) ??
    null
  );
}

async function fetchAgent(identity: AgentIdentity, agents: Agent[]): Promise<Agent | null> {
  const seed = lookupAgent(identity, agents);
  const id = seed?.id ?? identity.definitionId;
  const cacheKey = id ?? identity.label;
  const cached = agentCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.agent;
  }
  if (!id) {
    agentCache.set(cacheKey, { agent: seed, fetchedAt: Date.now() });
    return seed;
  }
  try {
    const fresh = await api<Agent>(`/api/agents/${encodeURIComponent(id)}`);
    agentCache.set(cacheKey, { agent: fresh, fetchedAt: Date.now() });
    return fresh;
  } catch {
    agentCache.set(cacheKey, { agent: seed, fetchedAt: Date.now() });
    return seed;
  }
}

function shortPath(value: string | null): string | null {
  if (!value) return null;
  const home = "/Users/";
  if (value.startsWith(home)) {
    const after = value.slice(home.length);
    const slash = after.indexOf("/");
    return slash >= 0 ? `~/${after.slice(slash + 1)}` : `~/${after}`;
  }
  return value;
}

function repoLabel(agent: Agent): string | null {
  return agent.project ?? shortPath(agent.projectRoot ?? agent.cwd);
}

/** Position so the card sits above (or below) the trigger and stays in viewport. */
function computePosition(rect: DOMRect): { top: number; left: number; placement: "above" | "below" } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(
    CARD_GUTTER,
    Math.min(vw - CARD_WIDTH - CARD_GUTTER, rect.left + rect.width / 2 - CARD_WIDTH / 2),
  );
  // Prefer above; flip below if not enough room.
  const above = rect.top - CARD_GUTTER;
  if (above > 200 || rect.bottom > vh - 200) {
    return { top: above, left, placement: "above" };
  }
  return { top: rect.bottom + CARD_GUTTER, left, placement: "below" };
}

function findThemeRoot(node: Node | null): HTMLElement {
  let cur: Node | null = node;
  while (cur) {
    if (cur instanceof HTMLElement && cur.dataset.scoutTheme) {
      return cur;
    }
    cur = (cur as HTMLElement).parentElement ?? null;
  }
  return document.body;
}

function AgentHoverCardPopover({
  identity,
  triggerEl,
  color,
  onRequestClose,
}: {
  identity: AgentIdentity;
  triggerEl: HTMLElement;
  color: string;
  onRequestClose: () => void;
}) {
  const { agents, navigate } = useScout();
  const [agent, setAgent] = useState<Agent | null>(() => lookupAgent(identity, agents));
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState(() => computePosition(triggerEl.getBoundingClientRect()));
  const cardRef = useRef<HTMLDivElement>(null);
  const themeRoot = findThemeRoot(triggerEl);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAgent(identity, agents).then((next) => {
      if (cancelled) return;
      setAgent(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [identity, agents]);

  useEffect(() => {
    const onScrollOrResize = () => {
      setPosition(computePosition(triggerEl.getBoundingClientRect()));
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [triggerEl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onRequestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRequestClose]);

  const onCardEnter = () => { /* keep open */ };
  const onCardLeave = () => onRequestClose();

  const state = normalizeAgentState(agent?.state ?? null);
  const stateLabel = agentStateLabel(agent?.state ?? null);
  const stateDot = stateColor(agent?.state ?? null);
  const stateBg = state === "working"
    ? "color-mix(in srgb, var(--accent) 18%, transparent)"
    : state === "available"
      ? "color-mix(in srgb, " + stateDot + " 18%, transparent)"
      : "color-mix(in srgb, var(--ink) 8%, transparent)";
  const stateColorText = state === "offline" ? "var(--dim)" : stateDot;

  const repo = agent ? repoLabel(agent) : null;
  const branch = agent?.branch ?? null;
  const harness = agent?.harness ?? null;
  const model = agent?.model ?? null;

  const openDm = () => {
    if (!agent) return;
    navigate({ view: "conversation", conversationId: conversationForAgent(agent.id) });
    onRequestClose();
  };
  const openInFleet = () => {
    if (!agent) return;
    navigate({ view: "agent-info", conversationId: conversationForAgent(agent.id) });
    onRequestClose();
  };
  const ping = () => {
    if (!agent) return;
    navigate({
      view: "conversation",
      conversationId: conversationForAgent(agent.id),
      composeMode: "ask",
    });
    onRequestClose();
  };

  const transformOrigin = position.placement === "above" ? "bottom center" : "top center";
  const translate = position.placement === "above" ? "translateY(-100%)" : "";
  const cardStyle: CSSProperties = {
    top: position.top,
    left: position.left,
    transform: translate,
    transformOrigin,
  };

  return createPortal(
    <div
      ref={cardRef}
      className="s-agent-hover-card"
      role="dialog"
      aria-label={`${identity.label} snapshot`}
      style={cardStyle}
      onMouseEnter={onCardEnter}
      onMouseLeave={onCardLeave}
    >
      <div className="s-agent-hover-card-row">
        <div className="s-agent-hover-card-avatar" style={{ background: color }}>
          {(agent?.name?.[0] ?? identity.label[1] ?? "?").toUpperCase()}
          <span className="s-agent-hover-card-dot" style={{ background: stateDot }} />
        </div>
        <div className="s-agent-hover-card-identity">
          <span className="s-agent-hover-card-name">
            {agent?.name ?? identity.label.replace(/^@/, "")}
          </span>
          <span className="s-agent-hover-card-handle">
            {identity.label.startsWith("@") ? identity.label : `@${identity.label}`}
          </span>
        </div>
        <span
          className="s-agent-hover-card-state"
          style={{ background: stateBg, color: stateColorText }}
        >
          {stateLabel}
        </span>
      </div>

      {agent ? (
        <>
          {(repo || branch || harness || model) && (
            <div className="s-agent-hover-card-where">
              {repo && (
                <span className="s-agent-hover-card-where-token">
                  <span className="s-agent-hover-card-where-label">repo</span>
                  <span className="s-agent-hover-card-where-value">{repo}</span>
                </span>
              )}
              {branch && (
                <span className="s-agent-hover-card-where-token">
                  <span className="s-agent-hover-card-where-label">branch</span>
                  <span className="s-agent-hover-card-where-value">{branch}</span>
                </span>
              )}
              {harness && (
                <span className="s-agent-hover-card-where-token">
                  <span className="s-agent-hover-card-where-label">harness</span>
                  <span className="s-agent-hover-card-where-value">{harness}</span>
                </span>
              )}
              {model && (
                <span className="s-agent-hover-card-where-token">
                  <span className="s-agent-hover-card-where-label">model</span>
                  <span className="s-agent-hover-card-where-value">{model}</span>
                </span>
              )}
            </div>
          )}
          {agent.role && (
            <div className="s-agent-hover-card-activity">{agent.role}</div>
          )}
          <div className="s-agent-hover-card-actions">
            <button
              type="button"
              className="s-agent-hover-card-action s-agent-hover-card-action--primary"
              onClick={openDm}
            >
              <MessageCircle size={12} strokeWidth={1.8} aria-hidden />
              DM
            </button>
            <button
              type="button"
              className="s-agent-hover-card-action"
              onClick={ping}
              title="Open a fresh ask thread"
            >
              <Send size={12} strokeWidth={1.8} aria-hidden />
              Ping
            </button>
            <button
              type="button"
              className="s-agent-hover-card-action"
              onClick={openInFleet}
              title="View this agent's detail"
            >
              <ArrowUpRight size={12} strokeWidth={1.8} aria-hidden />
              Fleet
            </button>
          </div>
        </>
      ) : loading ? (
        <div className="s-agent-hover-card-skeleton">loading…</div>
      ) : (
        <div className="s-agent-hover-card-empty">
          No agent registered as <code>{identity.label}</code>.
        </div>
      )}
    </div>,
    themeRoot,
  );
}

/** Mention text that opens an agent hovercard on hover, click pins it. */
export function AgentMention({
  identity,
  color,
}: {
  identity: AgentIdentity;
  color: string;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const requestOpen = useCallback(() => {
    if (open) return;
    clearTimers();
    openTimer.current = window.setTimeout(() => setOpen(true), HOVER_INTENT_MS);
  }, [open]);

  const requestClose = useCallback(() => {
    if (pinned) return;
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), HIDE_GRACE_MS);
  }, [pinned]);

  const forceClose = useCallback(() => {
    clearTimers();
    setOpen(false);
    setPinned(false);
  }, []);

  useEffect(() => () => clearTimers(), []);

  const onClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (open && pinned) {
      forceClose();
      return;
    }
    clearTimers();
    setPinned(true);
    setOpen(true);
  };

  return (
    <>
      <span
        ref={triggerRef}
        className="s-mention"
        role="button"
        tabIndex={0}
        data-hover-open={open ? "true" : undefined}
        style={{ "--mention-color": color } as CSSProperties}
        onMouseEnter={requestOpen}
        onMouseLeave={requestClose}
        onFocus={requestOpen}
        onBlur={requestClose}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        {identity.label}
      </span>
      {open && triggerRef.current && (
        <AgentHoverCardPopover
          identity={identity}
          color={color}
          triggerEl={triggerRef.current}
          onRequestClose={() => {
            if (pinned) {
              forceClose();
            } else {
              requestClose();
            }
          }}
        />
      )}
    </>
  );
}
