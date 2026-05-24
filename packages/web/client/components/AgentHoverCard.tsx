import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AgentIdentity } from "@openscout/protocol";

import { api } from "../lib/api.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import { useScout } from "../scout/Provider.tsx";
import type { Agent } from "../lib/types.ts";
import { AgentDetailCard } from "./AgentDetailCard.tsx";

const HOVER_INTENT_MS = 280;
const HIDE_GRACE_MS = 120;
const CARD_WIDTH = 320;
const CARD_GUTTER = 8;

/** Cache fetches so re-hover doesn't re-fire the request. */
const agentCache = new Map<string, { agent: Agent | null; fetchedAt: number }>();
const CACHE_TTL_MS = 10_000;

function normalizedIdentityValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^@+/, "").toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function agentIdentityValues(agent: Agent): Set<string> {
  const values = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = normalizedIdentityValue(value);
    if (normalized) values.add(normalized);
  };

  add(agent.id);
  add(agent.handle);
  add(agent.name);
  add(agent.selector);
  add(agent.defaultSelector);
  add(agent.definitionId);

  if (agent.definitionId && agent.workspaceQualifier) {
    add(`${agent.definitionId}.${agent.workspaceQualifier}`);
  }
  if (agent.definitionId && agent.workspaceQualifier && agent.nodeQualifier) {
    add(`${agent.definitionId}.${agent.workspaceQualifier}.${agent.nodeQualifier}`);
    add(`${agent.definitionId}.${agent.workspaceQualifier}.node:${agent.nodeQualifier}`);
  }
  if (agent.definitionId && agent.nodeQualifier) {
    add(`${agent.definitionId}.node:${agent.nodeQualifier}`);
  }

  return values;
}

function agentMatchesIdentity(agent: Agent, identity: AgentIdentity): boolean {
  const label = normalizedIdentityValue(identity.label);
  const raw = normalizedIdentityValue(identity.raw);
  const values = agentIdentityValues(agent);
  if ((label && values.has(label)) || (raw && values.has(raw))) {
    return true;
  }

  if (identity.definitionId && normalizedIdentityValue(agent.definitionId) !== normalizedIdentityValue(identity.definitionId)) {
    return false;
  }
  if (identity.workspaceQualifier && normalizedIdentityValue(agent.workspaceQualifier) !== normalizedIdentityValue(identity.workspaceQualifier)) {
    return false;
  }
  if (identity.nodeQualifier && normalizedIdentityValue(agent.nodeQualifier) !== normalizedIdentityValue(identity.nodeQualifier)) {
    return false;
  }
  if (identity.harness && normalizedIdentityValue(agent.harness) !== normalizedIdentityValue(identity.harness)) {
    return false;
  }
  if (identity.model && normalizedIdentityValue(agent.model) !== normalizedIdentityValue(identity.model)) {
    return false;
  }

  return Boolean(identity.definitionId);
}

function agentIdentityRank(agent: Agent, identity: AgentIdentity): number {
  const label = normalizedIdentityValue(identity.label);
  const raw = normalizedIdentityValue(identity.raw);
  const values = agentIdentityValues(agent);
  const exact = (label && values.has(label)) || (raw && values.has(raw)) ? 1000 : 0;
  const specificity = [
    identity.workspaceQualifier,
    identity.nodeQualifier,
    identity.harness,
    identity.model,
    identity.profile,
  ].filter(Boolean).length * 100;
  const state = normalizeAgentState(agent.state);
  const stateRank = state === "working" ? 30 : state === "available" ? 20 : 0;
  return exact + specificity + stateRank + Math.min(agent.updatedAt ?? 0, 9_999_999_999) / 1_000_000_000;
}

function candidateFetchId(identity: AgentIdentity): string | null {
  const raw = normalizedIdentityValue(identity.raw);
  if (raw && raw.split(".").length >= 3) {
    return raw;
  }
  return null;
}

function lookupAgent(identity: AgentIdentity, agents: Agent[]): Agent | null {
  const matches = agents
    .filter((agent) => agentMatchesIdentity(agent, identity))
    .sort((left, right) => agentIdentityRank(right, identity) - agentIdentityRank(left, identity));
  if (matches[0]) {
    return matches[0];
  }
  return null;
}

async function fetchAgent(identity: AgentIdentity, agents: Agent[]): Promise<Agent | null> {
  const seed = lookupAgent(identity, agents);
  const id = seed?.id ?? candidateFetchId(identity);
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
  onRequestClose,
}: {
  identity: AgentIdentity;
  triggerEl: HTMLElement;
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

  const openAgentPage = useCallback(() => {
    if (!agent) return;
    navigate({ view: "agents", agentId: agent.id });
    onRequestClose();
  }, [agent, navigate, onRequestClose]);

  const transformOrigin = position.placement === "above" ? "bottom center" : "top center";
  const translate = position.placement === "above" ? "translateY(-100%)" : "";
  const cardStyle: CSSProperties = {
    position: "fixed",
    top: position.top,
    left: position.left,
    width: CARD_WIDTH,
    transform: translate,
    transformOrigin,
  };

  if (agent) {
    return createPortal(
      <div
        onMouseEnter={() => { /* keep open */ }}
        onMouseLeave={onRequestClose}
      >
        <AgentDetailCard
          ref={cardRef}
          agent={agent}
          pinned
          onOpen={openAgentPage}
          onClose={onRequestClose}
          style={cardStyle}
          className="agent-card--mention"
        />
      </div>,
      themeRoot,
    );
  }

  return createPortal(
    <div
      ref={cardRef}
      className="agent-card agent-card--pinned agent-card--mention"
      role="dialog"
      aria-label={`${identity.label} snapshot`}
      style={cardStyle}
      onMouseEnter={() => { /* keep open */ }}
      onMouseLeave={onRequestClose}
    >
      <div style={{ fontSize: "12px", color: "var(--dim)", padding: "4px 2px" }}>
        {loading ? "loading…" : <>No agent registered as <code>{identity.label}</code>.</>}
      </div>
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
