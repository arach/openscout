"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Key,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Terminal,
} from "lucide-react";
import { renderSVG } from "uqr";
import { LogPanel } from "@/components/log-panel";
import { PairingTraceSurface } from "@/components/pairing-trace-surface";
import { Button } from "@/components/primitives/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/primitives/collapsible";
import { C } from "@/lib/theme";
import type { PairingState, UpdatePairingConfigInput } from "@/lib/scout-desktop";

export type PairingSurfacePlaceholderProps = {
  pairingControlPending: boolean;
  pairingApprovalPendingId: string | null;
  pairingConfigFeedback: string | null;
  pairingConfigPending: boolean;
  pairingError: string | null;
  pairingLoading: boolean;
  pairingState: PairingState | null;
  onControlPairing: (action: "start" | "stop" | "restart") => void;
  onDecideApproval: (approval: NonNullable<PairingState>["pendingApprovals"][number], decision: "approve" | "deny") => void;
  onOpenFeedback: () => void;
  onOpenFullLogs: () => void;
  onUpdateConfig: (input: UpdatePairingConfigInput) => Promise<void>;
  onRefresh: () => void;
  onRevealPath?: (path: string) => void;
};

export function PairingSurfacePlaceholder({
  pairingControlPending,
  pairingApprovalPendingId,
  pairingConfigFeedback,
  pairingConfigPending,
  pairingError,
  pairingLoading,
  pairingState,
  onControlPairing,
  onDecideApproval,
  onOpenFeedback,
  onOpenFullLogs,
  onUpdateConfig,
  onRefresh,
  onRevealPath,
}: PairingSurfacePlaceholderProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [relayDraft, setRelayDraft] = useState("");
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [workspaceEditing, setWorkspaceEditing] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [qrExpanded, setQrExpanded] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [pairingLogsExpanded, setPairingLogsExpanded] = useState(false);
  const logsRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const pairingPairingSvg = useMemo(() => {
    const qrValue = pairingState?.pairing?.qrValue;
    if (!qrValue) {
      return null;
    }
    return renderSVG(qrValue, {
      border: 2,
      ecc: "M",
      pixelSize: qrExpanded ? 12 : 6,
      blackColor: "#111111",
      whiteColor: "#ffffff",
    });
  }, [pairingState?.pairing?.qrValue, qrExpanded]);
  const expiresIn = pairingState?.pairing
    ? Math.max(0, Math.floor((pairingState.pairing.expiresAt - countdownNow) / 1000))
    : null;
  const serviceIsRunning = Boolean(pairingState?.isRunning);
  const trustedPeers = pairingState?.trustedPeers ?? [];
  const pendingApprovals = pairingState?.pendingApprovals ?? [];
  const connectedPeer = trustedPeers.find((peer) => peer.fingerprint === pairingState?.connectedPeerFingerprint) ?? null;
  const hasConnectedPeer = pairingState?.status === "paired" && Boolean(pairingState?.connectedPeerFingerprint);
  const activeRelay = pairingState?.pairing?.relay ?? pairingState?.relay ?? null;
  const dashboardTone = pairingState?.status === "paired" || pairingState?.status === "connected" || pairingState?.status === "connecting"
    ? { label: "Relay Active", backgroundColor: "#ecfdf3", borderColor: "#bbf7d0", color: "#15803d" }
    : pairingState?.status === "error" || pairingState?.status === "closed"
      ? { label: "Attention", backgroundColor: "#fff1f2", borderColor: "#fecdd3", color: "#be123c" }
      : { label: "Ready", backgroundColor: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" };
  const connectionTone = pairingState?.status === "paired"
    ? { backgroundColor: "#ecfdf3", borderColor: "#bbf7d0", color: "#15803d" }
    : pairingState?.status === "error" || pairingState?.status === "closed"
      ? { backgroundColor: "#fff1f2", borderColor: "#fecdd3", color: "#be123c" }
      : { backgroundColor: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" };
  const cardStyle = {
    backgroundColor: "#ffffff",
    borderColor: "rgba(15, 23, 42, 0.08)",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  } as const;
  const subtlePanelStyle = {
    backgroundColor: "#f7f8fb",
    borderColor: "rgba(15, 23, 42, 0.08)",
  } as const;
  const simpleTableStyle = {
    backgroundColor: "#fbfbfd",
    borderColor: "rgba(15, 23, 42, 0.06)",
  } as const;
  const pairCommand = pairingState?.commandLabel ?? "scout pair";
  const connectionLabel = hasConnectedPeer
    ? "Device Connected"
    : pairingState?.pairing
      ? "Pairing Ready"
      : pairingState?.status === "error" || pairingState?.status === "closed"
        ? pairingState.statusLabel
        : serviceIsRunning
          ? pairingState?.statusLabel ?? "Running"
          : "Ready to Start";
  const connectionDetail = pairingError
    ?? (hasConnectedPeer
      ? `${formatPairingTrustedPeerLabel(connectedPeer)} is connected through the pairing relay.`
      : null)
    ?? pairingState?.statusDetail
    ?? "Start Pairing to launch a local pairing relay, generate a fresh QR code, and wait for your phone to connect.";
  const runtimeRows = [
    ["Expires In", expiresIn !== null ? formatDurationShort(expiresIn) : "—"],
    ["Secure Mode", pairingState?.secure ? "Yes" : "No"],
    ["Active Sessions", `${pairingState?.sessionCount ?? 0}`],
    ["Trusted Peers", `${pairingState?.trustedPeerCount ?? 0}`],
    ["Last Updated", pairingState?.lastUpdatedLabel ?? "—"],
  ] as const;
  const statusRows = [
    ["Relay", activeRelay ?? "Not set"],
    ["Client ID", pairingState?.identityFingerprint ?? "Not created"],
    ["Room", pairingState?.pairing?.room ?? "Pending"],
    ["Connected Device", hasConnectedPeer ? formatPairingTrustedPeerLabel(connectedPeer) : "None"],
  ] as const;
  const topActions = (
    <>
      <span
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-medium"
        style={dashboardTone}
      >
        <span className={`block h-1.5 w-1.5 rounded-full ${serviceIsRunning ? "bg-emerald-500" : pairingState?.status === "error" ? "bg-rose-500" : "bg-zinc-400"}`} />
        {dashboardTone.label}
      </span>
      <button
        type="button"
        onClick={onOpenFeedback}
        className="text-[12px] font-medium transition-opacity hover:opacity-70"
        style={{ color: C.muted }}
      >
        Feedback
      </button>
      <button
        type="button"
        onClick={() => {
          setPairingLogsExpanded(true);
          window.setTimeout(() => {
            logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 0);
        }}
        className="text-[12px] font-medium transition-opacity hover:opacity-70"
        style={{ color: C.muted }}
      >
        Logs
      </button>
      <button
        type="button"
        onClick={() => {
          setShowAdvancedSettings(true);
          window.setTimeout(() => {
            settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 0);
        }}
        className="text-[12px] font-medium transition-opacity hover:opacity-70"
        style={{ color: C.muted }}
      >
        Advanced
      </button>
    </>
  );

  const handleCopy = React.useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => {
        setCopied((current) => current === label ? null : current);
      }, 1_200);
    } catch {
      setCopied(null);
    }
  }, []);

  const savePairingConfig = React.useCallback(async () => {
    try {
      await onUpdateConfig({
        relay: relayDraft,
        workspaceRoot: workspaceDraft || null,
      });
      setConfigDirty(false);
      setWorkspaceEditing(false);
    } catch {
      // Feedback is surfaced via pairingConfigFeedback.
    }
  }, [onUpdateConfig, relayDraft, workspaceDraft]);

  useEffect(() => {
    if (configDirty) {
      return;
    }

    setRelayDraft(pairingState?.configuredRelay ?? "");
    setWorkspaceDraft(pairingState?.workspaceRoot ?? "");
  }, [configDirty, pairingState?.configuredRelay, pairingState?.workspaceRoot]);

  const onControlPairingRef = useRef(onControlPairing);
  useEffect(() => { onControlPairingRef.current = onControlPairing; }, [onControlPairing]);

  const autoRefreshFiredRef = useRef(false);

  useEffect(() => {
    if (!pairingState?.pairing?.expiresAt) {
      return;
    }

    autoRefreshFiredRef.current = false;
    setCountdownNow(Date.now());

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setCountdownNow(now);
      if (!autoRefreshFiredRef.current && now >= pairingState.pairing!.expiresAt) {
        autoRefreshFiredRef.current = true;
        onControlPairingRef.current("restart");
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pairingState?.pairing?.expiresAt]);

  return (
    <div className="flex flex-1 overflow-hidden os-fade-in" style={{ backgroundColor: C.bg }}>
      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-10" style={{ backgroundColor: "#FAFAFA" }}>
          <div className="mx-auto flex max-w-[980px] flex-col gap-8">
            <div className="sticky top-0 z-10 -mx-8 flex items-center justify-between gap-6 border-b px-8 py-4 backdrop-blur" style={{ borderBottomColor: C.border, backgroundColor: "rgba(250,250,250,0.92)" }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ backgroundColor: "#4f46e5", color: "#ffffff" }}
                >
                  <Activity size={15} strokeWidth={1.6} />
                </div>
                <div className="text-[18px] font-medium tracking-tight" style={{ color: C.ink }}>
                  Pairing Relay
                </div>
              </div>
              <div className="flex items-center gap-4">
                {topActions}
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_320px] items-start">
              <div className="flex flex-col gap-5">
                <section className="rounded-[20px] border p-5" style={cardStyle}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-2 text-[17px] font-medium tracking-tight" style={{ color: C.ink }}>
                          <Server size={15} style={{ color: "#9ca3af" }} strokeWidth={1.5} />
                          Pairing Status
                        </span>
                        <span
                          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-normal uppercase tracking-wide"
                          style={connectionTone}
                        >
                          {!serviceIsRunning && (pairingState?.status === "error" || pairingState?.status === "closed") ? <AlertCircle size={13} strokeWidth={1.5} /> : null}
                          {connectionLabel}
                        </span>
                      </div>
                      <p className="mt-3 text-[15px] leading-[1.75] font-light" style={{ color: C.muted }}>
                        {connectionDetail}
                      </p>
                      {pairingState?.statusDetail && (pairingState.status === "error" || pairingState.status === "closed") ? (
                        <div
                          className="mt-4 rounded-2xl border px-4 py-3 text-[12px] leading-[1.7] font-mono whitespace-pre-wrap break-words"
                          style={{ backgroundColor: "#fff1f2", borderColor: "#fecdd3", color: "#9f1239" }}
                        >
                          {pairingState.statusDetail}
                        </div>
                      ) : null}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={pairingControlPending || pairingLoading}>
                      <RefreshCw size={14} />
                      Refresh
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {runtimeRows.map(([label, value]) => (
                      <div key={label} className="rounded-2xl border px-3 py-3" style={subtlePanelStyle}>
                        <div className="text-[9px] font-mono uppercase tracking-[0.16em]" style={{ color: C.muted }}>
                          {label}
                        </div>
                        <div className="mt-2 text-[14px] font-medium tracking-tight" style={{ color: C.ink }}>
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[20px] border p-5" style={cardStyle}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>
                        Bridge Details
                      </div>
                      <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                        Relay identity, room state, workspace binding, and control actions.
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAdvancedSettings(true);
                        window.setTimeout(() => {
                          settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }, 0);
                      }}
                    >
                      <Settings size={14} />
                      Advanced
                    </Button>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border" style={simpleTableStyle}>
                    {statusRows.map(([label, value], index) => (
                      <div
                        key={label}
                        className="grid gap-2 px-3 py-2.5 md:grid-cols-[112px_minmax(0,1fr)] md:items-start"
                        style={index === 0 ? undefined : { borderTop: `1px solid ${C.border}` }}
                      >
                        <div className="text-[9px] font-mono uppercase tracking-[0.16em]" style={{ color: C.muted }}>
                          {label}:
                        </div>
                        <div className="text-[12px] leading-[1.5] break-words" style={{ color: C.ink }}>
                          {value}
                        </div>
                      </div>
                    ))}
                    <div
                      className="grid gap-2 px-3 py-2.5 md:grid-cols-[112px_minmax(0,1fr)_auto] md:items-center"
                      style={{ borderTop: `1px solid ${C.border}` }}
                    >
                      <div className="text-[9px] font-mono uppercase tracking-[0.16em]" style={{ color: C.muted }}>
                        Workspace:
                      </div>
                      {workspaceEditing ? (
                        <input
                          type="text"
                          value={workspaceDraft}
                          onChange={(event) => {
                            setWorkspaceDraft(event.target.value);
                            setConfigDirty(true);
                          }}
                          placeholder="/Users/arach/dev/openscout"
                          className="w-full rounded-lg border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
                          style={{ borderColor: C.border, color: C.ink }}
                        />
                      ) : (
                        <div className="text-[12px] leading-[1.5] break-words" style={{ color: C.ink }}>
                          {pairingState?.workspaceRoot || "Not set"}
                        </div>
                      )}
                      <div className="flex items-center gap-2 md:justify-end">
                        {workspaceEditing ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                void savePairingConfig();
                              }}
                              disabled={pairingConfigPending}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setWorkspaceDraft(pairingState?.workspaceRoot ?? "");
                                setConfigDirty(false);
                                setWorkspaceEditing(false);
                              }}
                              disabled={pairingConfigPending}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setWorkspaceDraft(pairingState?.workspaceRoot ?? "");
                              setWorkspaceEditing(true);
                            }}
                            className="text-[12px] font-medium transition-opacity hover:opacity-70"
                            style={{ color: C.muted }}
                          >
                            [edit]
                          </button>
                        )}
                      </div>
                    </div>
                    {pairingConfigFeedback ? (
                      <div
                        className="px-4 py-3 text-[11px] leading-[1.6]"
                        style={{ borderTop: `1px solid ${C.border}`, color: C.ink }}
                      >
                        {pairingConfigFeedback}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onControlPairing(serviceIsRunning ? "stop" : "start")}
                      disabled={pairingControlPending}
                    >
                      {serviceIsRunning ? "Stop Pairing" : "Start Pairing"}
                    </Button>
                    {serviceIsRunning ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onControlPairing("restart")}
                        disabled={pairingControlPending}
                      >
                        Restart
                      </Button>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-[20px] border p-5" style={cardStyle}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>
                        Live Trace
                      </div>
                      <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                        Shared trace cards for live approvals on this node.
                      </div>
                    </div>
                    <span
                      className="rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap"
                      style={pendingApprovals.length > 0
                        ? { backgroundColor: "#fff7ed", borderColor: "#fed7aa", color: "#c2410c" }
                        : { backgroundColor: "#f8fafc", borderColor: "#e2e8f0", color: "#475569" }}
                    >
                      {pendingApprovals.length} queued
                    </span>
                  </div>

                  <div className="mt-4">
                    <PairingTraceSurface
                      pendingApprovals={pendingApprovals}
                      pairingApprovalPendingId={pairingApprovalPendingId}
                      onDecideApproval={onDecideApproval}
                    />
                  </div>
                </section>
              </div>

              <div>
                {pairingPairingSvg ? (
                  <section className="rounded-[20px] border p-5" style={cardStyle}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>Scan QR Code</div>
                        <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                          Point Pairing on your phone at this code.
                        </div>
                      </div>
                      <span
                        className="rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap"
                        style={{ backgroundColor: "#ecfdf3", borderColor: "#bbf7d0", color: "#15803d" }}
                      >
                        Ready to Pair
                      </span>
                    </div>
                    <div className="mt-5 rounded-[22px] border p-4" style={{ backgroundColor: "#ffffff", borderColor: "rgba(15, 23, 42, 0.08)" }}>
                      <div
                        aria-label="Pairing pairing QR code"
                        className={`mx-auto w-full ${qrExpanded ? "max-w-[480px]" : "max-w-[248px]"}`}
                        dangerouslySetInnerHTML={{ __html: pairingPairingSvg }}
                      />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 text-[11px] leading-[1.65] font-light" style={{ color: C.muted }}>
                      <div className="flex items-center gap-2">
                        {expiresIn === 0 ? (
                          <>
                            <span style={{ color: "#be123c" }}>Expired</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onControlPairing("restart")}
                              disabled={pairingControlPending || pairingLoading}
                              className="flex items-center gap-1"
                            >
                              <RefreshCw size={11} />
                              Refresh
                            </Button>
                          </>
                        ) : (
                          <>Refreshes in <span style={{ color: C.ink }}>{expiresIn !== null ? formatDurationShort(expiresIn) : "—"}</span></>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setQrExpanded((current) => !current)}
                      >
                        {qrExpanded ? "Compact QR" : "Larger QR"}
                      </Button>
                    </div>
                  </section>
                ) : (
                  <section className="rounded-[20px] border bg-[rgba(250,250,250,0.65)] p-5" style={cardStyle}>
                    <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-3" style={{ color: C.muted }}>
                      CLI Equivalent
                    </div>
                    <div className="rounded-2xl border px-3 py-3 flex items-center gap-3" style={subtlePanelStyle}>
                      <code className="min-w-0 flex-1 truncate text-[11px]" style={{ color: C.ink }}>
                        {pairCommand}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() => void handleCopy("command", pairCommand)}
                      >
                        {copied === "command" ? <Check size={14} /> : <Copy size={14} />}
                      </Button>
                    </div>
                    <div className="mt-4 text-[11px] leading-[1.6] font-light" style={{ color: C.muted }}>
                      <div className="inline-flex items-center gap-1.5">
                        <Key size={13} strokeWidth={1.5} />
                        Same backend as the command line, with QR rotation and log access.
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>

            <section className="rounded-[20px] border p-5" style={cardStyle}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>Trusted Devices</div>
                  <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                    Saved phone identities that have paired with this bridge.
                  </div>
                </div>
                <span
                  className="rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap"
                  style={hasConnectedPeer
                    ? { backgroundColor: "#ecfdf3", borderColor: "#bbf7d0", color: "#15803d" }
                    : { backgroundColor: "#f8fafc", borderColor: "#e2e8f0", color: "#475569" }}
                >
                  {trustedPeers.length} saved
                </span>
              </div>
              {trustedPeers.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-xl border" style={simpleTableStyle}>
                  <div
                    className="hidden gap-3 px-4 py-2 text-[9px] font-mono uppercase tracking-[0.16em] md:grid md:grid-cols-[minmax(0,1.8fr)_140px_140px_140px]"
                    style={{ color: C.muted }}
                  >
                    <div>Device</div>
                    <div>Status</div>
                    <div>Last Seen</div>
                    <div>Paired</div>
                  </div>
                  {trustedPeers.map((peer, index) => {
                    const peerConnected = peer.fingerprint === pairingState?.connectedPeerFingerprint;
                    return (
                      <div
                        key={peer.publicKey}
                        className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.8fr)_140px_140px_140px] md:items-center"
                        style={index === 0 ? undefined : { borderTop: `1px solid ${C.border}` }}
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium tracking-tight" style={{ color: C.ink }}>
                            {formatPairingTrustedPeerLabel(peer)}
                          </div>
                          <div className="mt-1 truncate text-[11px] font-mono" style={{ color: C.muted }}>
                            {formatPairingTrustedPeerKey(peer.publicKey)}
                          </div>
                        </div>
                        <div>
                          <span
                            className="inline-flex rounded-full border px-2 py-1 text-[10px] font-medium whitespace-nowrap"
                            style={peerConnected
                              ? { backgroundColor: "#ecfdf3", borderColor: "#bbf7d0", color: "#15803d" }
                              : { backgroundColor: "#f8fafc", borderColor: "#e2e8f0", color: "#475569" }}
                          >
                            {peerConnected ? "Connected now" : "Trusted"}
                          </span>
                        </div>
                        <div className="text-[12px]" style={{ color: C.ink }}>
                          {peer.lastSeenLabel ?? "Unknown"}
                        </div>
                        <div className="text-[12px]" style={{ color: C.ink }}>
                          {peer.pairedAtLabel ?? "Unknown"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border px-4 py-4 text-[12px] leading-[1.7]" style={subtlePanelStyle}>
                  No trusted devices yet. Start Pairing and scan the QR code from your phone to add one.
                </div>
              )}
            </section>

            <div className={`grid gap-5 items-start ${showAdvancedSettings ? "lg:grid-cols-[minmax(0,1.5fr)_320px]" : "lg:grid-cols-1"}`}>
              <section id="pairing-live-logs" ref={logsRef}>
                <Collapsible open={pairingLogsExpanded} onOpenChange={setPairingLogsExpanded}>
                  <div className="rounded-[20px] border overflow-hidden" style={cardStyle}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="w-full px-5 py-4 border-b flex items-center justify-between gap-3 text-left hover:opacity-95 transition-opacity"
                        style={{ borderBottomColor: pairingLogsExpanded ? C.border : "transparent", backgroundColor: "#ffffff" }}
                      >
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>
                            <Terminal size={15} style={{ color: "#9ca3af" }} strokeWidth={1.5} />
                            Pairing Logs
                          </div>
                          <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                            {pairingLogsExpanded
                              ? "Live bridge output and runtime diagnostics."
                              : "Hidden by default. Expand only when debugging pairing."}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {pairingState?.logUpdatedAtLabel ? (
                            <span className="text-[10px] font-mono" style={{ color: C.muted }}>
                              {pairingState.logUpdatedAtLabel}
                            </span>
                          ) : null}
                          <ChevronRight
                            size={14}
                            className="transition-transform duration-150"
                            style={{ color: C.muted, transform: pairingLogsExpanded ? "rotate(90deg)" : undefined }}
                          />
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-5 pt-4 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-light" style={{ color: C.muted }}>
                          Open the full Logs view if you want the broader app and relay log catalog.
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={onOpenFullLogs}
                        >
                          Open Full Logs
                        </Button>
                      </div>
                      <div className="px-5 pb-5 pt-4">
                        <LogPanel
                          title="Pairing"
                          pathLabel={pairingState?.logPath ?? null}
                          body={pairingState?.logTail ?? null}
                          truncated={pairingState?.logTruncated}
                          missing={pairingState?.logMissing}
                          loading={!pairingState}
                          updatedAtLabel={pairingState?.logUpdatedAtLabel}
                          maxHeight={320}
                          minHeight={160}
                          onRevealPath={onRevealPath}
                        />
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </section>

              {showAdvancedSettings ? (
                <section id="pairing-settings-card" ref={settingsRef} className="rounded-[20px] border overflow-hidden" style={cardStyle}>
                  <div className="px-5 py-4 border-b flex items-center justify-between gap-3" style={{ borderBottomColor: C.border }}>
                    <div>
                      <div className="inline-flex items-center gap-2 text-[15px] font-medium tracking-tight" style={{ color: C.ink }}>
                        <Settings size={15} style={{ color: "#9ca3af" }} strokeWidth={1.5} />
                        Advanced Settings
                      </div>
                      <div className="mt-1 text-[11px] font-light" style={{ color: C.muted }}>
                        You usually do not need these. Pairing can auto-launch a local relay for pairing.
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy("config", pairingState?.configPath ?? "")} disabled={!pairingState?.configPath}>
                      {copied === "config" ? <Check size={14} /> : <Copy size={14} />}
                      Config Path
                    </Button>
                  </div>
                  <div className="divide-y" style={{ borderColor: C.border }}>
                    <div className="px-5 py-4 space-y-3">
                      {runtimeRows.map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-3 text-[12px]">
                          <span className="font-light" style={{ color: C.muted }}>
                            {label === "Secure Mode" ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Shield size={13} strokeWidth={1.5} />
                                {label}
                              </span>
                            ) : label === "Last Updated" ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Clock size={13} strokeWidth={1.5} />
                                {label}
                              </span>
                            ) : label}
                          </span>
                          <span className="text-right break-words font-normal" style={{ color: C.ink }}>{value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-5 py-4 space-y-4">
                      <label className="block">
                        <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-2" style={{ color: C.muted }}>
                          Custom Pairing Relay URL
                        </div>
                        <input
                          type="text"
                          value={relayDraft}
                          onChange={(event) => {
                            setRelayDraft(event.target.value);
                            setConfigDirty(true);
                          }}
                          placeholder="Leave blank to auto-select a local relay"
                          className="w-full rounded-xl border px-3 py-2 text-[13px] bg-transparent outline-none"
                          style={{ borderColor: C.border, color: C.ink }}
                        />
                      </label>
                      <label className="block">
                        <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-2" style={{ color: C.muted }}>
                          Workspace Root
                        </div>
                        <input
                          type="text"
                          value={workspaceDraft}
                          onChange={(event) => {
                            setWorkspaceDraft(event.target.value);
                            setConfigDirty(true);
                          }}
                          placeholder="/Users/arach/dev/openscout"
                          className="w-full rounded-xl border px-3 py-2 text-[13px] bg-transparent outline-none"
                          style={{ borderColor: C.border, color: C.ink }}
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            void savePairingConfig();
                          }}
                          disabled={pairingConfigPending}
                        >
                          Save
                        </Button>
                      </div>
                      {pairingConfigFeedback ? (
                        <div className="text-[11px] leading-[1.6]" style={{ color: C.ink }}>
                          {pairingConfigFeedback}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function formatPairingTrustedPeerLabel(peer: PairingState["trustedPeers"][number] | null | undefined) {
  if (!peer) {
    return "Unknown device";
  }

  return peer.name ?? `Device ${peer.fingerprint}`;
}

export function formatPairingTrustedPeerKey(publicKey: string) {
  if (publicKey.length <= 16) {
    return publicKey;
  }

  return `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`;
}

export function describePairingSurfaceBadge(
  pairingState: PairingState | null,
  pairingLoading: boolean,
  pairingError: string | null,
) {
  if (pairingError) {
    return {
      label: "Error",
      backgroundColor: "#fff1f2",
      borderColor: "#fecdd3",
      color: "#be123c",
    };
  }

  if (pairingLoading && !pairingState) {
    return {
      label: "Loading",
      backgroundColor: "#f8fafc",
      borderColor: "#e2e8f0",
      color: "#475569",
    };
  }

  if (pairingState?.status === "paired" && pairingState.connectedPeerFingerprint) {
    return {
      label: "Connected",
      backgroundColor: "#ecfdf3",
      borderColor: "#bbf7d0",
      color: "#15803d",
    };
  }

  if (pairingState?.isRunning && pairingState?.pairing) {
    return {
      label: "Waiting",
      backgroundColor: "#eff6ff",
      borderColor: "#bfdbfe",
      color: "#1d4ed8",
    };
  }

  if ((pairingState?.trustedPeerCount ?? 0) > 0) {
    return {
      label: `${pairingState!.trustedPeerCount} trusted`,
      backgroundColor: "#f8fafc",
      borderColor: "#e2e8f0",
      color: "#475569",
    };
  }

  return null;
}

type ProductSurfaceLogoProps = {
  active: boolean;
  surface: "relay" | "pairing";
};

export function ProductSurfaceLogo({ active, surface }: ProductSurfaceLogoProps) {
  if (surface === "relay") {
    return (
      <div
        className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-mono font-bold"
        style={active
          ? { backgroundColor: C.ink, color: "#fff" }
          : { backgroundColor: C.surface, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.border}` }}
      >
        {">_"}
      </div>
    );
  }

  return (
    <div
      className="w-5 h-5 rounded-full flex items-center justify-center"
      style={active
        ? { backgroundColor: C.accentBg, boxShadow: `inset 0 0 0 1px ${C.accentBorder}` }
        : { backgroundColor: C.tagBg, boxShadow: `inset 0 0 0 1px ${C.border}` }}
    >
      <span
        className="block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: active ? C.accent : C.muted }}
      />
    </div>
  );
}

function formatDurationShort(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
