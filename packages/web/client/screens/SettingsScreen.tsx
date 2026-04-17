import { renderSVG } from "uqr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { timeAgo } from "../lib/time.ts";
import type { PairingState, Route } from "../lib/types.ts";
import "./system-surfaces-redesign.css";

function relayHostLabel(input: string | null): string | null {
  if (!input) return null;
  return input.replace(/^wss?:\/\//, "").replace(/:\d+$/, "");
}

function shortFingerprint(input: string | null): string | null {
  if (!input) return null;
  if (input.length <= 18) return input;
  return `${input.slice(0, 10)}...${input.slice(-6)}`;
}

function pairingTone(pairing: PairingState | null): "success" | "warning" | "danger" {
  if (!pairing) return "warning";
  if (pairing.status === "paired" || pairing.status === "connected") return "success";
  if (pairing.status === "error" || pairing.status === "closed") return "danger";
  return "warning";
}

function pairingSnapshotTitle(pairing: PairingState | null, hasQr: boolean, connectedPeerName: string | null): string {
  if (!pairing) return "Loading pairing state";
  if (hasQr) return "Scan to pair";
  if (connectedPeerName) return "Device connected";
  if (pairing.isRunning) return "Pairing relay is running";
  if (pairing.status === "unconfigured") return "Pairing is not configured";
  return "Pairing is stopped";
}

function pairingSnapshotBody(pairing: PairingState | null, hasQr: boolean, connectedPeerName: string | null): string {
  if (!pairing) {
    return "Fetching the latest pairing status and trusted peer information.";
  }
  if (hasQr) {
    return "Use the QR code below to link a phone or another client to this broker.";
  }
  if (connectedPeerName) {
    return `${connectedPeerName} is currently linked to this broker. Trusted peer details are listed alongside the live relay status.`;
  }
  return pairing.statusDetail
    ?? (pairing.isRunning
      ? "The relay is up. A QR code should appear when a fresh pairing payload is available."
      : "Start pairing to launch the relay and issue a fresh QR code.");
}

function formatExpiresIn(expiresAt: number | undefined, now: number): string | null {
  if (!expiresAt) return null;
  const diffSeconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
  if (diffSeconds === 0) return "expired";
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function SettingsScreen({ navigate: _navigate }: { navigate: (r: Route) => void }) {
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [userName, setUserName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [controlBusy, setControlBusy] = useState<"start" | "stop" | "restart" | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pairingRef = useRef<PairingState | null>(null);
  const pairingRequestIdRef = useRef(0);
  const controlBusyRef = useRef<"start" | "stop" | "restart" | null>(null);

  useEffect(() => {
    pairingRef.current = pairing;
  }, [pairing]);

  useEffect(() => {
    controlBusyRef.current = controlBusy;
  }, [controlBusy]);

  const loadPairing = useCallback(async (mode: "initial" | "background" | "manual" = "initial") => {
    if (mode === "background" && controlBusyRef.current) {
      return;
    }

    const requestId = ++pairingRequestIdRef.current;
    const hasSnapshot = pairingRef.current !== null;

    if (!hasSnapshot && mode !== "background") {
      setLoading(true);
      setPairingError(null);
    } else {
      setRefreshing(true);
    }

    try {
      const nextPairing = await api<PairingState>(
        mode === "manual" ? "/api/pairing-state/refresh" : "/api/pairing-state",
      );
      if (requestId !== pairingRequestIdRef.current) return;
      setPairing(nextPairing);
      setPairingError(null);
      setLastLoadedAt(Date.now());
    } catch (loadError) {
      if (requestId !== pairingRequestIdRef.current) return;
      setPairingError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (requestId === pairingRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadUser = useCallback(async () => {
    try {
      const user = await api<{ name: string }>("/api/user");
      setSavedName(user.name);
      setUserName(user.name);
      setIdentityError(null);
    } catch (loadError) {
      setIdentityError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void loadPairing("initial");
    void loadUser();
  }, [loadPairing, loadUser]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadPairing("background");
    }, 10_000);
    return () => clearInterval(timer);
  }, [loadPairing]);

  useEffect(() => {
    if (!pairing?.pairing?.expiresAt) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => clearInterval(timer);
  }, [pairing?.pairing?.expiresAt]);

  const saveName = useCallback(async () => {
    setSavingName(true);
    setIdentityError(null);
    try {
      const result = await api<{ name: string }>("/api/user", {
        method: "POST",
        body: JSON.stringify({ name: userName }),
      });
      setSavedName(result.name);
      setUserName(result.name);
    } catch (saveError) {
      setIdentityError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingName(false);
    }
  }, [userName]);

  const control = useCallback(async (action: "start" | "stop" | "restart") => {
    const requestId = ++pairingRequestIdRef.current;
    setControlBusy(action);
    setPairingError(null);
    try {
      const nextPairing = await api<PairingState>("/api/pairing/control", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      if (requestId !== pairingRequestIdRef.current) return;
      setPairing(nextPairing);
      setLastLoadedAt(Date.now());
    } catch (controlError) {
      if (requestId !== pairingRequestIdRef.current) return;
      setPairingError(controlError instanceof Error ? controlError.message : String(controlError));
    } finally {
      if (requestId === pairingRequestIdRef.current) {
        setControlBusy(null);
      }
    }
  }, []);

  const qrSvg = useMemo(() => {
    const value = pairing?.pairing?.qrValue?.trim();
    if (!value) return null;
    return renderSVG(value, { border: 2, ecc: "M", pixelSize: 8 });
  }, [pairing?.pairing?.qrValue]);

  const relayHost = relayHostLabel(pairing?.pairing?.relay ?? pairing?.relay ?? null);
  const expiresIn = formatExpiresIn(pairing?.pairing?.expiresAt, now);
  const connectedPeer = pairing?.trustedPeers.find((peer) => peer.fingerprint === pairing.connectedPeerFingerprint) ?? null;
  const connectedPeerName = connectedPeer?.name ?? shortFingerprint(pairing?.connectedPeerFingerprint ?? null);
  const tone = pairingTone(pairing);
  const nameDirty = userName.trim() !== savedName;

  const summaryCards = useMemo(() => {
    if (!pairing) return [];
    return [
      {
        label: "Status",
        value: pairing.statusLabel,
        detail: pairing.isRunning ? "Relay process is running" : "Relay process is stopped",
      },
      {
        label: "Relay",
        value: relayHost ?? "Not configured",
        detail: pairing.pairing?.relay ? "Active QR relay" : "Configured endpoint",
      },
      {
        label: "Trusted peers",
        value: `${pairing.trustedPeerCount}`,
        detail: connectedPeerName ? `${connectedPeerName} is connected` : "Saved trust relationships",
      },
    ];
  }, [connectedPeerName, pairing, relayHost]);

  const showInitialError = !loading && !pairing && Boolean(pairingError);

  return (
    <div className="sys-surface-page">
      <div className="sys-page-head">
        <div className="sys-page-title-group">
          <h2 className="sys-page-title">Settings</h2>
          <p className="sys-page-subtitle">
            Operator identity, pairing controls, and trusted device state.
          </p>
        </div>
        <div className="sys-page-actions">
          {pairing && <span className={`sys-chip sys-chip-${tone}`}>{pairing.statusLabel}</span>}
          <div className="sys-sync-note">
            {loading
              ? "Loading pairing status..."
              : pairingError && pairing
                ? `Showing last confirmed snapshot from ${lastLoadedAt ? timeAgo(lastLoadedAt) : "earlier"}`
                : lastLoadedAt
                  ? `Updated ${timeAgo(lastLoadedAt)}`
                  : "Waiting for first snapshot"}
          </div>
          <button
            type="button"
            className="s-btn"
            disabled={loading || refreshing || Boolean(controlBusy)}
            onClick={() => void loadPairing("manual")}
          >
            {refreshing ? "Refreshing..." : "Refresh status"}
          </button>
        </div>
      </div>

      {pairingError && pairing && (
        <div className="sys-banner sys-banner-warning">
          <strong>Status refresh failed.</strong>
          <span>{pairingError}</span>
        </div>
      )}

      {identityError && (
        <div className="sys-banner sys-banner-warning">
          <strong>Identity update failed.</strong>
          <span>{identityError}</span>
        </div>
      )}

      {loading && !pairing && (
        <div className="sys-panel sys-state-card">
          <h3 className="sys-state-title">Loading settings</h3>
          <p className="sys-state-body">
            Checking relay status, QR availability, and trusted peers.
          </p>
        </div>
      )}

      {showInitialError && (
        <div className="sys-panel sys-state-card sys-state-card-error">
          <h3 className="sys-state-title">Pairing status is unavailable</h3>
          <p className="sys-state-body">{pairingError}</p>
          <div className="sys-inline-actions">
            <button type="button" className="s-btn" onClick={() => void loadPairing("manual")}>
              Try again
            </button>
          </div>
        </div>
      )}

      <div className="sys-settings-grid">
        <section className="sys-panel">
          <div className="sys-section-head">
            <div>
              <h3 className="sys-section-title">Identity</h3>
              <p className="sys-section-subtitle">
                Used for operator-authored activity and message records.
              </p>
            </div>
          </div>

          <div className="sys-input-row">
            <input
              className="sys-input"
              type="text"
              placeholder="Your name"
              value={userName}
              onChange={(event) => setUserName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && nameDirty && !savingName) {
                  void saveName();
                }
              }}
            />
            <button
              type="button"
              className="s-btn s-btn-primary"
              disabled={!nameDirty || savingName}
              onClick={() => void saveName()}
            >
              {savingName ? "Saving..." : "Save"}
            </button>
          </div>

          <div className="sys-detail-grid">
            <div className="sys-detail-card">
              <span className="sys-detail-label">Current name</span>
              <span className="sys-detail-value">{savedName || "Not set"}</span>
            </div>
            <div className="sys-detail-card">
              <span className="sys-detail-label">Identity fingerprint</span>
              <code className="sys-detail-value">{pairing?.identityFingerprint ?? "Unavailable"}</code>
            </div>
          </div>
        </section>

        <section className="sys-panel">
          <div className="sys-section-head">
            <div>
              <h3 className="sys-section-title">Pairing control</h3>
              <p className="sys-section-subtitle">
                Relay lifecycle and current linked device state.
              </p>
            </div>
          </div>

          {pairing && (
            <div className="sys-stat-grid">
              {summaryCards.map((card) => (
                <div key={card.label} className="sys-stat-card">
                  <span className="sys-stat-label">{card.label}</span>
                  <strong className="sys-stat-value">{card.value}</strong>
                  <span className="sys-stat-detail">{card.detail}</span>
                </div>
              ))}
            </div>
          )}

          {pairing?.statusDetail && (
            <div className="sys-banner sys-banner-muted">
              <strong>Status detail.</strong>
              <span>{pairing.statusDetail}</span>
            </div>
          )}

          {pairing && (
            <div className="sys-inline-actions">
              {pairing.isRunning ? (
                <>
                  <button
                    type="button"
                    className="s-btn"
                    disabled={Boolean(controlBusy)}
                    onClick={() => void control("restart")}
                  >
                    {controlBusy === "restart" ? "Restarting..." : "Restart"}
                  </button>
                  <button
                    type="button"
                    className="s-btn"
                    disabled={Boolean(controlBusy)}
                    onClick={() => void control("stop")}
                  >
                    {controlBusy === "stop" ? "Stopping..." : "Stop"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="s-btn s-btn-primary"
                  disabled={Boolean(controlBusy)}
                  onClick={() => void control("start")}
                >
                  {controlBusy === "start" ? "Starting..." : "Start pairing"}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {pairing && (
        <div className="sys-settings-grid">
          <section className="sys-panel">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Pairing snapshot</h3>
                <p className="sys-section-subtitle">
                  QR issuance and live relay details for device linking.
                </p>
              </div>
            </div>

            <div className="sys-qr-stage">
              {qrSvg ? (
                <div className="sys-qr-block">
                  <div className="s-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                  <div className="sys-qr-meta">
                    <h4>{pairingSnapshotTitle(pairing, Boolean(qrSvg), connectedPeerName)}</h4>
                    <p>{pairingSnapshotBody(pairing, Boolean(qrSvg), connectedPeerName)}</p>
                    <div className="sys-chip-row">
                      {expiresIn && <span className="sys-chip sys-chip-warning">Expires {expiresIn}</span>}
                      {relayHost && <span className="sys-chip sys-chip-neutral">{relayHost}</span>}
                      {pairing.secure && <span className="sys-chip sys-chip-success">Noise XX</span>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="sys-list-empty">
                  <h3>{pairingSnapshotTitle(pairing, false, connectedPeerName)}</h3>
                  <p>{pairingSnapshotBody(pairing, false, connectedPeerName)}</p>
                </div>
              )}
            </div>

            <div className="sys-detail-grid">
              <div className="sys-detail-card">
                <span className="sys-detail-label">Relay</span>
                <span className="sys-detail-value">{relayHost ?? "Not configured"}</span>
              </div>
              <div className="sys-detail-card">
                <span className="sys-detail-label">Connected peer</span>
                <span className="sys-detail-value">{connectedPeerName ?? "None connected"}</span>
              </div>
              <div className="sys-detail-card">
                <span className="sys-detail-label">Last updated</span>
                <span className="sys-detail-value">{pairing.lastUpdatedLabel ?? "Unavailable"}</span>
              </div>
              <div className="sys-detail-card">
                <span className="sys-detail-label">Trust store</span>
                <span className="sys-detail-value">
                  {pairing.trustedPeerCount} peer{pairing.trustedPeerCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </section>

          <section className="sys-panel">
            <div className="sys-section-head">
              <div>
                <h3 className="sys-section-title">Trusted peers</h3>
                <p className="sys-section-subtitle">
                  Devices that have already completed pairing with this broker.
                </p>
              </div>
            </div>

            {pairing.trustedPeers.length === 0 ? (
              <div className="sys-list-empty">
                <h3>No trusted peers yet</h3>
                <p>Once a device completes pairing it will appear here with last-seen details.</p>
              </div>
            ) : (
              <div className="sys-trust-list">
                {pairing.trustedPeers.map((peer) => {
                  const isConnected = peer.fingerprint === pairing.connectedPeerFingerprint;
                  return (
                    <article key={peer.fingerprint} className="sys-trust-row">
                      <div className="sys-trust-main">
                        <div className="sys-list-card-head">
                          <h3 className="sys-list-card-title">{peer.name ?? shortFingerprint(peer.fingerprint) ?? "Trusted peer"}</h3>
                          {isConnected && <span className="sys-chip sys-chip-success">Connected</span>}
                        </div>
                        <code className="sys-detail-value">{peer.fingerprint}</code>
                      </div>
                      <div className="sys-trust-meta">
                        <span>Paired {peer.pairedAtLabel}</span>
                        <span>Seen {peer.lastSeenLabel}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
