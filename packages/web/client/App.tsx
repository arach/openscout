import { renderSVG } from "uqr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ── Types ── */

type PairingSnapshot = {
  qrValue?: string | null;
  expiresAt?: number;
  relay?: string | null;
} | null;

type TrustedPeer = {
  fingerprint: string;
  name: string | null;
  pairedAtLabel: string;
  lastSeenLabel: string;
};

type PairingState = {
  status: string;
  statusLabel: string;
  statusDetail: string | null;
  isRunning: boolean;
  commandLabel: string;
  pairing: PairingSnapshot;
  lastUpdatedLabel: string | null;
  relay: string | null;
  secure: boolean;
  identityFingerprint: string | null;
  connectedPeerFingerprint: string | null;
  trustedPeerCount: number;
  trustedPeers: TrustedPeer[];
};

type Agent = {
  id: string;
  name: string;
  handle: string | null;
  agentClass: string;
  harness: string | null;
  state: string | null;
  projectRoot: string | null;
  cwd: string | null;
  updatedAt: number | null;
  transport: string | null;
  selector: string | null;
  wakePolicy: string | null;
  capabilities: string[];
  project: string | null;
  branch: string | null;
  role: string | null;
};

type ActivityItem = {
  id: string;
  kind: string;
  ts: number;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
};

type Tab = "agents" | "activity" | "pair";

/* ── API helper ── */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/* ── SSE hook ── */

function useBrokerEvents(onEvent: () => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");
      es.onmessage = () => cbRef.current();
      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);
}

/* ── Time formatting ── */

function timeAgo(ts: number): string {
  // Normalize: seconds (< 1e12) vs milliseconds
  const tsMs = ts < 1e12 ? ts * 1000 : ts;
  const diffMs = Date.now() - tsMs;
  const diff = Math.floor(diffMs / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/* ── Kind label ── */

const KIND_LABELS: Record<string, string> = {
  ask_sent: "asked",
  ask_replied: "replied",
  ask_failed: "failed",
  ask_working: "working",
  flight_created: "flight",
  flight_updated: "updated",
  message_sent: "sent",
  message_received: "received",
  agent_online: "online",
  agent_offline: "offline",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function kindColor(kind: string): string {
  if (kind.includes("fail")) return "var(--red)";
  if (kind.includes("repli") || kind.includes("online")) return "var(--green)";
  if (kind.includes("working") || kind.includes("sent")) return "var(--accent)";
  return "var(--muted)";
}

/* ── State dot ── */

function StateDot({ state }: { state: string | null }) {
  const color =
    state === "active"
      ? "var(--green)"
      : state === "listening"
        ? "var(--accent)"
        : "var(--dim)";
  return <span className="s-dot" style={{ background: color }} />;
}

/* ── Pair view ── */

function PairView() {
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPairing(await api<PairingState>("/api/pairing-state/refresh"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const control = async (action: "start" | "stop" | "restart") => {
    setBusy(true);
    setError(null);
    try {
      setPairing(
        await api<PairingState>("/api/pairing/control", {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const qrSvg = useMemo(() => {
    const v = pairing?.pairing?.qrValue?.trim();
    if (!v) return null;
    return renderSVG(v, { border: 2, ecc: "M", pixelSize: 8 });
  }, [pairing?.pairing?.qrValue]);

  const expiresIn = useMemo(() => {
    const exp = pairing?.pairing?.expiresAt;
    if (!exp) return null;
    const diff = Math.floor((exp - Date.now()) / 1000);
    if (diff <= 0) return "expired";
    if (diff < 60) return `${diff}s`;
    return `${Math.floor(diff / 60)}m`;
  }, [pairing?.pairing?.expiresAt]);

  const relayHost = pairing?.relay
    ? pairing.relay.replace(/^wss?:\/\//, "").replace(/:\d+$/, "")
    : null;

  return (
    <div>
      {error && <p className="s-error">{error}</p>}

      <div className="s-actions">
        {pairing?.isRunning ? (
          <>
            <button type="button" className="s-btn" disabled={busy} onClick={() => void control("restart")}>
              Restart
            </button>
            <button type="button" className="s-btn" disabled={busy} onClick={() => void control("stop")}>
              Stop
            </button>
          </>
        ) : (
          <button type="button" className="s-btn s-btn-primary" disabled={busy} onClick={() => void control("start")}>
            Start pairing
          </button>
        )}
      </div>

      {qrSvg ? (
        <>
          <div className="s-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="s-pair-meta">
            <div className="s-pair-row">
              <span className="s-pair-label">Status</span>
              <span className="s-pair-value">
                <span className="s-dot" style={{
                  background: pairing?.status === "paired" ? "var(--green)" : "var(--accent)",
                  marginRight: 6,
                }} />
                {pairing?.statusLabel}
              </span>
            </div>
            {relayHost && (
              <div className="s-pair-row">
                <span className="s-pair-label">Relay</span>
                <span className="s-pair-value s-pair-mono">{relayHost}</span>
              </div>
            )}
            {pairing?.identityFingerprint && (
              <div className="s-pair-row">
                <span className="s-pair-label">Identity</span>
                <span className="s-pair-value s-pair-mono">{pairing.identityFingerprint}</span>
              </div>
            )}
            {pairing?.connectedPeerFingerprint && (
              <div className="s-pair-row">
                <span className="s-pair-label">Peer</span>
                <span className="s-pair-value s-pair-mono">{pairing.connectedPeerFingerprint}</span>
              </div>
            )}
            {expiresIn && (
              <div className="s-pair-row">
                <span className="s-pair-label">Expires</span>
                <span className="s-pair-value">{expiresIn}</span>
              </div>
            )}
            {pairing?.secure && (
              <div className="s-pair-row">
                <span className="s-pair-label">Encryption</span>
                <span className="s-pair-value">Noise XX</span>
              </div>
            )}
            {(pairing?.trustedPeerCount ?? 0) > 0 && (
              <div className="s-pair-row">
                <span className="s-pair-label">Trusted</span>
                <span className="s-pair-value">{pairing!.trustedPeerCount} peer{pairing!.trustedPeerCount !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </>
      ) : pairing ? (
        <div className="s-empty">
          <p>No QR code</p>
          <p>Start pairing to generate a code</p>
        </div>
      ) : (
        <div className="s-empty">
          <p className="s-meta">Loading...</p>
        </div>
      )}
    </div>
  );
}

/* ── Agent detail row ── */

function AgentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="s-detail-row">
      <span className="s-detail-label">{label}</span>
      <span className="s-detail-value">{value}</span>
    </div>
  );
}

/* ── Agents view ── */

function AgentsView() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAgents(await api<Agent[]>("/api/agents"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents(load);

  const toggle = (id: string) =>
    setExpanded((prev) => (prev === id ? null : id));

  return (
    <div>
      {error && <p className="s-error">{error}</p>}

      {agents.length === 0 ? (
        <div className="s-empty">
          <p>No agents</p>
          <p>Agents appear here when they connect to the broker</p>
        </div>
      ) : (
        <div className="s-list">
          {agents.map((agent) => {
            const open = expanded === agent.id;
            return (
              <div
                key={agent.id}
                className={`s-card s-card-expand${open ? " s-card-open" : ""}`}
                onClick={() => toggle(agent.id)}
              >
                <div className="s-card-row">
                  <StateDot state={agent.state} />
                  <span className="s-card-name">{agent.name}</span>
                  {agent.handle && (
                    <span className="s-card-handle">@{agent.handle}</span>
                  )}
                  <span className="s-spacer" />
                  {agent.harness && <span className="s-badge">{agent.harness}</span>}
                  {agent.updatedAt && (
                    <span className="s-time">{timeAgo(agent.updatedAt)}</span>
                  )}
                  <span className={`s-chevron${open ? " s-chevron-open" : ""}`} />
                </div>
                {!open && agent.projectRoot && (
                  <p className="s-card-sub">{agent.projectRoot}</p>
                )}
                {open && (
                  <div className="s-detail" onClick={(e) => e.stopPropagation()}>
                    {agent.project && <AgentDetail label="Project" value={agent.project} />}
                    {agent.branch && <AgentDetail label="Branch" value={agent.branch} />}
                    {agent.projectRoot && <AgentDetail label="Path" value={agent.projectRoot} />}
                    {agent.selector && <AgentDetail label="Selector" value={agent.selector} />}
                    {agent.transport && <AgentDetail label="Transport" value={agent.transport.replace(/_/g, " ")} />}
                    {agent.agentClass && <AgentDetail label="Class" value={agent.agentClass} />}
                    {agent.wakePolicy && <AgentDetail label="Wake" value={agent.wakePolicy.replace(/_/g, " ")} />}
                    {agent.capabilities?.length > 0 && (
                      <AgentDetail label="Capabilities" value={agent.capabilities.join(", ")} />
                    )}
                    {agent.role && <AgentDetail label="Role" value={agent.role} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Activity view ── */

function ActivityView() {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setActivity(await api<ActivityItem[]>("/api/activity"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents(load);

  return (
    <div>
      {error && <p className="s-error">{error}</p>}

      {activity.length === 0 ? (
        <div className="s-empty">
          <p>No activity</p>
          <p>Events stream here in real time</p>
        </div>
      ) : (
        <div className="s-list">
          {activity.map((item) => (
            <div key={item.id} className="s-card">
              <div className="s-card-row">
                <span className="s-card-name">{item.actorName ?? "system"}</span>
                <span className="s-kind" style={{ color: kindColor(item.kind) }}>
                  {kindLabel(item.kind)}
                </span>
                <span className="s-spacer" />
                <span className="s-time">{timeAgo(item.ts)}</span>
              </div>
              {item.title && <p className="s-card-body">{item.title}</p>}
              {item.summary && <p className="s-card-sub">{item.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── App shell ── */

const TABS: { id: Tab; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "activity", label: "Activity" },
  { id: "pair", label: "Pair" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("agents");

  return (
    <div className="s-app">
      <header className="s-header">
        <h1 className="s-logo">Scout</h1>
        <nav className="s-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`s-tab ${tab === t.id ? "s-tab-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="s-main">
        {tab === "agents" && <AgentsView />}
        {tab === "activity" && <ActivityView />}
        {tab === "pair" && <PairView />}
      </main>
    </div>
  );
}
