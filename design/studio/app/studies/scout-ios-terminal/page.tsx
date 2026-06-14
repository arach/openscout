"use client";

import { SurfaceLab, TerminalHeader, TerminalBody, TerminalConnecting } from "@/components/scout-ios";

export default function ScoutIOSTerminalStudy() {
  return (
    <SurfaceLab
      surface="terminal"
      title="Scout iOS · Terminal"
      blurb="SSH PTY into a paired Mac — a Ghostty-style screen plus a terminal quick-key tray with dictation. Tab surface with its own header; flip to the authorizing state."
      source="apps/ios/Scout/TerminalSurface.swift"
      header={<TerminalHeader />}
      treatments={[
        {
          id: "live",
          label: "Live",
          note: "Connected PTY — build output + prompt cursor, and the quick-key tray (esc / tab / ctrl / … / mic).",
          body: <TerminalBody />,
        },
        {
          id: "connecting",
          label: "Connecting",
          note: "Authorizing the device — registering the terminal key with the Mac before the PTY opens.",
          body: <TerminalConnecting />,
        },
      ]}
    />
  );
}
