"use client";

import { useState } from "react";
import { SurfaceLab, SettingsHeader, SettingsBody, type SettingsTab } from "@/components/scout-ios";

export default function ScoutIOSSettingsStudy() {
  const [tab, setTab] = useState<SettingsTab>("CONNECTION");
  return (
    <SurfaceLab
      surface="settings"
      title="Scout iOS · Settings"
      blurb="The HudInspectorSettings sheet — a 7-tab inspector (Connection · Routes · Identity · Voice · Alerts · Appearance · Advanced). Tap the rail in the phone. Pushed sheet: custom header, no tab bar."
      source="apps/ios/Scout/AppSettingsView.swift"
      header={<SettingsHeader />}
      showChrome={false}
      treatments={[
        {
          id: "source",
          label: "Source",
          note: "Tab rail + per-tab inspector content — Macs list, transport toggles, voice engine, and the dark-locked appearance note.",
          body: <SettingsBody tab={tab} onTab={setTab} />,
        },
      ]}
    />
  );
}
