"use client";

import { SurfaceLab, TailSurface } from "@/components/scout-ios";

export default function ScoutIOSTailStudy() {
  return (
    <SurfaceLab
      surface="tail"
      title="Scout iOS · Tail"
      blurb="The live cross-agent firehose — a 'Tail' header + live indicator, then event rows: attribution badge (scout / hudson / unattributed) · source · kind · time, then the summary. Baseline renders inset cards; Hairline flattens them into a continuous stream."
      source="apps/ios/Scout/TailSurface.swift"
      treatments={[
        {
          id: "source",
          label: "Source",
          note: "As shipped: each event in an inset card with a hairline border, attribution-colored badge, mono summary.",
          body: <TailSurface />,
        },
        {
          id: "hairline",
          label: "Hairline",
          note: "Flat firehose — strip the card chrome to hairline-separated rows so more events fit and the eye scans the time column.",
          body: <TailSurface />,
          mods: { layout: "hairline" },
        },
        {
          id: "kindtone",
          label: "Kind-tone",
          note: "The KIND token becomes a crisp colored chip per type — tool/result amber, assistant emerald, system blue, user neutral. Mirrors the macOS Tail tone vocabulary so the firehose is scannable by kind.",
          body: <TailSurface />,
          mods: { tone: "kind" },
        },
      ]}
    />
  );
}
