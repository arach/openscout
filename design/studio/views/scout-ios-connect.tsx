"use client";

import { SurfaceLab, ConnectHeader, ConnectionBody, PairingBody } from "@/components/scout-ios";

export default function ScoutIOSConnectStudy() {
  return (
    <SurfaceLab
      surface="connect"
      title="Scout iOS · Connect"
      blurb="Bridging to a Mac — the route inspector (LAN → TSN → OSN priority + a color-coded connection log) and the QR pairing flow (Noise handshake). Pushed sheet: custom header, no tab bar."
      source="apps/ios/Scout/ConnectionView.swift + PairingView.swift"
      header={<ConnectHeader />}
      showChrome={false}
      treatments={[
        {
          id: "connection",
          label: "Connection",
          note: "Route inspector — status, the LAN / TSN / OSN legend, Reconnect · Pair, and the color-coded log.",
          body: <ConnectionBody />,
        },
        {
          id: "pairing",
          label: "Pairing",
          note: "QR scanner viewport + a paste-link fallback while it waits for the Noise handshake to confirm.",
          body: <PairingBody />,
        },
      ]}
    />
  );
}
