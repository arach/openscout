"use client";

import { SurfaceLab, NewSessionBody } from "@/components/scout-ios";

export default function ScoutIOSNewStudy() {
  return (
    <SurfaceLab
      surface="new"
      title="Scout iOS · New Session"
      blurb="The project + harness + model + prompt composer — start a session on any paired machine. Tab surface; flip to the started state to see the returned ids."
      source="apps/ios/Scout/NewSessionSurface.swift"
      treatments={[
        {
          id: "compose",
          label: "Compose",
          note: "Project card, harness · model menus + target token, prompt with a floating mic, and the Start footer.",
          body: <NewSessionBody />,
        },
        {
          id: "started",
          label: "Started",
          note: "After launch — the success card with conversation / agent / flight / message ids.",
          body: <NewSessionBody result />,
        },
      ]}
    />
  );
}
