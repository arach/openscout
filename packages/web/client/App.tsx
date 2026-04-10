import { renderSVG } from "uqr";
import { useCallback, useEffect, useMemo, useState } from "react";

type PairingSnapshot = {
  qrValue?: string | null;
  expiresAt?: number;
  relay?: string | null;
} | null;

type PairingState = {
  status: string;
  statusLabel: string;
  statusDetail: string | null;
  isRunning: boolean;
  commandLabel: string;
  pairing: PairingSnapshot;
  lastUpdatedLabel: string | null;
};

type RelayMessage = {
  id: string;
  authorName: string;
  authorId: string;
  body: string;
  timestampLabel: string;
  routingSummary: string | null;
  isSystem: boolean;
};

type ShellState = {
  relay: {
    title: string;
    subtitle: string;
    messages: RelayMessage[];
    lastUpdatedLabel: string | null;
  };
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string; detail?: string };
      if (j.error) msg = j.detail ? `${j.error}: ${j.detail}` : j.error;
    } catch {
      /* keep */
    }
    throw new Error(msg);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function App() {
  const [tab, setTab] = useState<"pairing" | "activity">("pairing");

  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [pairingErr, setPairingErr] = useState<string | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);

  const [shell, setShell] = useState<ShellState | null>(null);
  const [shellErr, setShellErr] = useState<string | null>(null);

  const loadPairing = useCallback(async () => {
    setPairingErr(null);
    try {
      const s = await apiJson<PairingState>("/api/pairing-state/refresh");
      setPairing(s);
    } catch (e) {
      setPairingErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadShell = useCallback(async () => {
    setShellErr(null);
    try {
      const s = await apiJson<ShellState>("/api/shell-state/refresh");
      setShell(s);
    } catch (e) {
      setShellErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (tab !== "pairing") return;
    void loadPairing();
    const t = window.setInterval(() => void loadPairing(), 5000);
    return () => window.clearInterval(t);
  }, [tab, loadPairing]);

  useEffect(() => {
    if (tab !== "activity") return;
    void loadShell();
    const t = window.setInterval(() => void loadShell(), 4000);
    return () => window.clearInterval(t);
  }, [tab, loadShell]);

  const qrSvg = useMemo(() => {
    const v = pairing?.pairing?.qrValue?.trim();
    if (!v) return null;
    return renderSVG(v, {
      border: 2,
      ecc: "M",
      pixelSize: 6,
      blackColor: "#111111",
      whiteColor: "#ffffff",
    });
  }, [pairing?.pairing?.qrValue]);

  const controlPairing = async (action: "start" | "stop" | "restart") => {
    setPairingBusy(true);
    setPairingErr(null);
    try {
      const s = await apiJson<PairingState>("/api/pairing/control", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setPairing(s);
    } catch (e) {
      setPairingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPairingBusy(false);
    }
  };

  const messages = shell?.relay.messages ?? [];
  const recent = [...messages].slice(-80);

  return (
    <div className="osw">
      <h1>OpenScout web</h1>
      <p className="sub">
        Pairing QR and the current activity stream. Run <code>scout server control-plane start</code> (or <code>openscout-web</code>) with this UI,
        then open this page.
      </p>

      <div className="osw-tabs">
        <button type="button" data-active={tab === "pairing"} onClick={() => setTab("pairing")}>
          Pairing
        </button>
        <button type="button" data-active={tab === "activity"} onClick={() => setTab("activity")}>
          Activity
        </button>
      </div>

      {tab === "pairing" && (
        <section className="osw-card">
          <h2>Pairing</h2>
          {pairingErr ? <p className="osw-err">{pairingErr}</p> : null}
          <div className="osw-row">
            <button type="button" className="osw-btn" disabled={pairingBusy} onClick={() => void loadPairing()}>
              Refresh
            </button>
            <button type="button" className="osw-btn osw-btn-primary" disabled={pairingBusy} onClick={() => void controlPairing("start")}>
              Start
            </button>
            <button type="button" className="osw-btn" disabled={pairingBusy} onClick={() => void controlPairing("stop")}>
              Stop
            </button>
            <button type="button" className="osw-btn" disabled={pairingBusy} onClick={() => void controlPairing("restart")}>
              Restart
            </button>
          </div>
          {pairing ? (
            <>
              <p className="osw-meta">
                {pairing.statusLabel}
                {pairing.statusDetail ? ` — ${pairing.statusDetail}` : ""}
                {pairing.lastUpdatedLabel ? ` · ${pairing.lastUpdatedLabel}` : ""}
              </p>
              <p className="osw-meta">
                CLI: <code>{pairing.commandLabel}</code>
              </p>
              {qrSvg ? (
                <div className="osw-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              ) : (
                <p className="osw-meta">No pairing QR yet (start the pairing service and refresh).</p>
              )}
            </>
          ) : (
            <p className="osw-meta">Loading…</p>
          )}
        </section>
      )}

      {tab === "activity" && (
        <section className="osw-card">
          <h2>Activity</h2>
          {shellErr ? <p className="osw-err">{shellErr}</p> : null}
          <div className="osw-row">
            <button type="button" className="osw-btn" onClick={() => void loadShell()}>
              Refresh now
            </button>
            <span className="osw-meta">{shell?.relay.lastUpdatedLabel ?? "—"}</span>
          </div>
          <div className="osw-msgs">
            {recent.length === 0 ? (
              <p className="osw-meta">No messages yet (agents must be set up).</p>
            ) : (
              recent.map((m) => (
                <div key={m.id} className="osw-msg">
                  <div className="who">
                    {m.authorName}
                    {m.isSystem ? " · system" : ""}
                    <span className="osw-meta"> · {m.timestampLabel}</span>
                  </div>
                  {m.routingSummary ? <div className="osw-meta">{m.routingSummary}</div> : null}
                  <div className="body">{m.body}</div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
