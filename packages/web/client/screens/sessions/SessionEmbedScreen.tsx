/**
 * Session Embed (tail "load session") — the standalone, chrome-free route.
 *
 * Hosted by the macOS app in a WKWebView (a bottom sheet) when you open a tail
 * row's full session. Reads the tail event's `sessionId` from the query string
 * (`/embed/session?ref=<sessionId>&theme=<dark|light>`) and resolves it through
 * the same `/api/session-ref/:id` endpoint the web Sessions view uses.
 *
 * Renders ONLY the resolved session full-bleed — no app shell, no nav, no
 * toolbar:
 *   - `observe`      → SessionObserve (history/live trace; rail hidden)
 *   - `conversation` → ConversationScreen (embedded, no back nav)
 *
 * Wrapped in `scoutApp.Provider` upstream in main.tsx (supplies the
 * `[data-scout-theme]` token scope, theme honored via `?theme=`). Mirrors
 * ObserveEmbedScreen + RepoDiffEmbedScreen.
 */

import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import type { AgentObservePayload, ObserveData, SessionEntry } from "../../lib/types.ts";
import { ConversationScreen } from "../chat/ConversationScreen.tsx";
import { SessionObserve } from "./SessionObserve.tsx";

// Mirrors the SessionRefLookup union returned by /api/session-ref/:id
// (see SessionRefScreen.tsx — kept local to avoid exporting the big union).
type SessionRefObservePayload =
  | ({ kind: "agent"; refId: string; agentId: string } & Omit<AgentObservePayload, "agentId">)
  | {
      kind: "pairing" | "history";
      refId: string;
      agentId: null;
      source: string;
      fidelity: string;
      historyPath: string | null;
      sessionId: string;
      updatedAt: number;
      data: ObserveData;
    };

type SessionRefLookup =
  | { kind: "conversation"; refId: string; conversationId: string; session: SessionEntry }
  | { kind: "observe"; refId: string; session: SessionEntry | null; observe: SessionRefObservePayload };

const EMBED_REFRESH_INTERVAL_MS = 2_500;

function shortSessionId(value: string | null | undefined): string {
  if (!value) return "no session";
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function EmbedShell({ children }: { children: React.ReactNode }) {
  return <div className="s-observe-embed-page">{children}</div>;
}

function EmbedNotice({ title, detail }: { title: string; detail?: string }) {
  return (
    <EmbedShell>
      <div className="s-observe-embed-empty">
        <div className="s-observe-embed-empty-title">{title}</div>
        {detail && <div className="s-observe-embed-empty-detail">{detail}</div>}
      </div>
    </EmbedShell>
  );
}

export function SessionEmbedScreen() {
  const ref =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("ref")?.trim() ?? "";

  const [lookup, setLookup] = useState<SessionRefLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (background = false) => {
      if (!ref) {
        setLoading(false);
        return;
      }
      if (!background) setLoading(true);
      setError(null);
      try {
        const result = await api<SessionRefLookup>(
          `/api/session-ref/${encodeURIComponent(ref)}`,
        );
        setLookup(result);
      } catch (err) {
        if (!background) setLookup(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [ref],
  );

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load(true);
    }, EMBED_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  useBrokerEvents(() => {
    void load(true);
  });

  if (!ref) {
    return (
      <EmbedNotice
        title="No session reference"
        detail="This embed needs a ?ref=<sessionId> query parameter."
      />
    );
  }

  if (error && !lookup) {
    return <EmbedNotice title="Session unavailable" detail={error} />;
  }

  if (loading && !lookup) {
    return <EmbedNotice title="Resolving session" detail={ref} />;
  }

  if (!lookup) {
    return (
      <EmbedNotice
        title="Session not found"
        detail="This session may have ended or its archive is not on this machine."
      />
    );
  }

  if (lookup.kind === "conversation") {
    return (
      <EmbedShell>
        <ConversationScreen
          conversationId={lookup.conversationId}
          navigate={() => {}}
          embedded
          showBackNav={false}
        />
      </EmbedShell>
    );
  }

  return (
    <EmbedShell>
      <div className="s-observe-embed-status">
        <span className="s-observe-embed-status-source">{lookup.observe.source}</span>
        <span>{lookup.observe.fidelity}</span>
        <span title={lookup.observe.sessionId ?? undefined}>
          {shortSessionId(lookup.observe.sessionId ?? lookup.observe.refId)}
        </span>
        <span>{lookup.observe.data.events.length} events</span>
        {lookup.observe.data.live && <span className="s-observe-embed-status-live">Live</span>}
      </div>
      <SessionObserve
        data={lookup.observe.data}
        agentId={lookup.observe.agentId ?? lookup.session?.agentId ?? undefined}
        sessionId={lookup.observe.sessionId ?? lookup.observe.refId}
        showRail={false}
      />
    </EmbedShell>
  );
}

export default SessionEmbedScreen;
