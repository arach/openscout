import { renderSVG } from "uqr";
import {
  ArrowUpRight,
  Check,
  Copy,
  Mic2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Tablet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pairingDeepLinks } from "../../../shared/pairing-link.js";
import { api } from "../../lib/api.ts";
import type { PairingState, Route } from "../../lib/types.ts";
import "./scout-deck-setup.css";

const PAIRING_POLL_MS = 5_000;
const DECK_PREVIEW_PORT = "43123";

function formatExpiry(expiresAt: number | undefined, now: number): string | null {
  if (!expiresAt) return null;
  const seconds = Math.max(0, Math.floor((expiresAt - now) / 1_000));
  if (seconds <= 0) return "Refreshing";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function deckPreviewHref(): string | null {
  if (typeof window === "undefined") return null;
  const configured = import.meta.env.VITE_SCOUT_DECK_PREVIEW_URL?.trim();
  if (configured) return configured;

  const hostname = window.location.hostname;
  const isLocalHost = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname.endsWith(".local")
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  if (!isLocalHost) return null;

  const url = new URL(window.location.href);
  url.port = DECK_PREVIEW_PORT;
  url.pathname = "/lanes/index.html";
  url.search = "?preview=1";
  url.hash = "";
  return url.toString();
}

function DeckMiniature() {
  return (
    <div className="s-deck-setup__device" aria-label="Scout Deck controller preview">
      <div className="s-deck-setup__device-camera" />
      <div className="s-deck-setup__mini-head">
        <div>
          <span>Scout</span>
          <strong>Deck</strong>
        </div>
        <div className="s-deck-setup__mini-live"><i /> Live</div>
        <small>2 hosts</small>
      </div>
      <div className="s-deck-setup__mini-grid">
        <div className="s-deck-setup__mini-bank">
          {["01", "02", "03", "04"].map((number, index) => (
            <div key={number} className={index === 0 ? "is-active" : ""}>
              <b>{number}</b>
              <span>{["OpenScout", "SpeakEasy", "Hudson", "Release"][index]}</span>
              <i />
            </div>
          ))}
        </div>
        <div className="s-deck-setup__mini-stage">
          <header>
            <span>01 / OpenScout</span>
            <small>Codex · active turn</small>
          </header>
          <div className="s-deck-setup__mini-thread">
            <div><i /> <span>Mapping the controller to the active thread.</span></div>
            <div><i /> <span>Native bridge connected.</span></div>
            <div><i /> <span>Voice loop is ready.</span></div>
          </div>
          <div className="s-deck-setup__mini-composer">
            <span><Mic2 size={15} strokeWidth={1.8} /></span>
            <div><b>Tap to talk</b><small>Parakeet on device</small></div>
            <i />
          </div>
        </div>
        <div className="s-deck-setup__mini-rail">
          <span>Controller</span>
          <div><small>Adapter</small><b>Codex native</b></div>
          <div><small>Voice in</small><b>Ready</b></div>
          <div><small>Voice out</small><b>Armed</b></div>
        </div>
      </div>
    </div>
  );
}

function PairingPanel({
  pairing,
  loading,
  error,
  busy,
  now,
  onRefresh,
}: {
  pairing: PairingState | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  now: number;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const qrValue = pairing?.pairing?.qrValue?.trim() ?? "";
  const qrSvg = useMemo(
    () => qrValue ? renderSVG(qrValue, { border: 2, ecc: "M", pixelSize: 8 }) : null,
    [qrValue],
  );
  const pairLinks = useMemo(() => pairingDeepLinks(qrValue), [qrValue]);
  const copyValue = pairLinks.lan ?? pairLinks.tailnet ?? pairLinks.default ?? qrValue;
  const expiry = formatExpiry(pairing?.pairing?.expiresAt, now);
  const connected = Boolean(pairing?.connectedPeerFingerprint);

  const copyLink = useCallback(() => {
    if (!copyValue) return;
    void navigator.clipboard.writeText(copyValue).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    });
  }, [copyValue]);

  return (
    <aside className={`s-deck-pair${connected ? " is-connected" : ""}`} aria-label="Pair an iPad">
      <div className="s-deck-pair__head">
        <div className="s-deck-pair__icon"><QrCode size={17} strokeWidth={1.8} /></div>
        <div>
          <span>Pair an iPad</span>
          <strong>{connected ? "Deck connected" : "Scan with Scout"}</strong>
        </div>
        <div className="s-deck-pair__status">
          <i />
          {connected ? "iPad online" : qrSvg ? "Code live" : pairing?.statusLabel ?? "Starting"}
        </div>
      </div>

      <div className="s-deck-pair__qr-wrap">
        {qrSvg ? (
          <div className="s-deck-pair__qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        ) : (
          <div className="s-deck-pair__qr-empty">
            {error ? <QrCode size={32} strokeWidth={1.2} /> : <RefreshCw size={28} strokeWidth={1.3} className="is-spinning" />}
            <span>{error ? "Pairing unavailable" : loading || busy ? "Creating secure code" : "Waiting for pairing code"}</span>
          </div>
        )}
        {connected && (
          <div className="s-deck-pair__connected-mark"><Check size={20} strokeWidth={2.2} /></div>
        )}
      </div>

      <p className="s-deck-pair__instruction">
        Open Scout on the iPad, choose <strong>Scan code</strong>, and point it here.
      </p>

      {error ? <div className="s-deck-pair__error">{error}</div> : null}

      <div className="s-deck-pair__meta">
        <span><ShieldCheck size={12} /> Noise encrypted</span>
        <span>{expiry ? `${expiry} remaining` : "Refreshing automatically"}</span>
      </div>

      <div className="s-deck-pair__actions">
        <button type="button" onClick={onRefresh} disabled={busy}>
          <RefreshCw size={13} className={busy ? "is-spinning" : ""} />
          {busy ? "Refreshing" : "New code"}
        </button>
        <button type="button" onClick={copyLink} disabled={!copyValue}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      {pairing && pairing.trustedPeerCount > 0 ? (
        <div className="s-deck-pair__trusted">
          <Tablet size={13} />
          {pairing.trustedPeerCount} trusted {pairing.trustedPeerCount === 1 ? "device" : "devices"}
        </div>
      ) : null}
    </aside>
  );
}

export function ScoutDeckSetupView({ navigate }: { navigate: (route: Route) => void }) {
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const autoStartedRef = useRef(false);
  const previewHref = useMemo(deckPreviewHref, []);

  const load = useCallback(async (refresh = false) => {
    try {
      const next = await api<PairingState>(refresh ? "/api/pairing-state/refresh" : "/api/pairing-state");
      setPairing(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const startOrRefresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api<PairingState>("/api/pairing/control", {
        method: "POST",
        body: JSON.stringify({ action: pairing?.isRunning ? "restart" : "start" }),
      });
      setPairing(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [pairing?.isRunning]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), PAIRING_POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [load]);

  useEffect(() => {
    if (!pairing || pairing.isRunning || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void startOrRefresh();
  }, [pairing, startOrRefresh]);

  return (
    <div className="s-deck-setup">
      <section className="s-deck-setup__hero">
        <div className="s-deck-setup__intro">
          <div className="s-deck-setup__eyebrow"><span>New surface</span> iPad command deck</div>
          <h1><span>Your agents,</span><span>within reach.</span></h1>
          <p>
            Scout Deck is the tactile, voice-first view of the agents already running on this Mac.
            Pair once, choose a lane, and speak directly into the active thread.
          </p>
          <div className="s-deck-setup__hero-actions">
            {previewHref ? (
              <a href={previewHref} target="_blank" rel="noreferrer" className="s-deck-setup__primary-action">
                Open web preview <ArrowUpRight size={14} />
              </a>
            ) : null}
            <button type="button" onClick={() => navigate({ view: "ops", mode: "lanes" })}>
              View agent lanes
            </button>
          </div>
        </div>
        <PairingPanel
          pairing={pairing}
          loading={loading}
          error={error}
          busy={busy}
          now={now}
          onRefresh={() => void startOrRefresh()}
        />
      </section>

      <section className="s-deck-setup__preview-section">
        <div className="s-deck-setup__preview-copy">
          <span className="s-deck-setup__section-index">01 / THE SURFACE</span>
          <h2>A controller, not a tiny desktop.</h2>
          <p>
            The Deck keeps lane switching, live thread state, dictation, steering, and interruption under your hands.
            Dense fleet management stays here in the web app.
          </p>
        </div>
        <DeckMiniature />
      </section>

      <section className="s-deck-setup__steps" aria-label="Connect Scout Deck">
        <article>
          <span>01</span>
          <Tablet size={17} strokeWidth={1.6} />
          <div><strong>Open Scout on iPad</strong><p>Choose “Pair a Mac” from the first-run screen or Settings.</p></div>
        </article>
        <article>
          <span>02</span>
          <QrCode size={17} strokeWidth={1.6} />
          <div><strong>Scan the live code</strong><p>The code carries the short-lived relay room and this Mac’s public key.</p></div>
        </article>
        <article>
          <span>03</span>
          <ShieldCheck size={17} strokeWidth={1.6} />
          <div><strong>Approve and enter Deck</strong><p>Scout remembers the trusted device and reconnects without another scan.</p></div>
        </article>
      </section>
    </div>
  );
}
