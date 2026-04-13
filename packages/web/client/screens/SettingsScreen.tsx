import { renderSVG } from "uqr";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import type { PairingState, Route } from "../lib/types.ts";

export function SettingsScreen({ navigate }: { navigate: (r: Route) => void }) {
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
      <h2 className="s-section-title">Settings</h2>

      <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pairing</h3>

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
