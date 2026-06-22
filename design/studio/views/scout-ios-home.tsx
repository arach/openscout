"use client";

import { SurfaceLab, HomeSurface, INBOX } from "@/components/scout-ios";

export default function ScoutIOSHomeStudy() {
  // Home stays Home — the ambient survey of the swarm — but leads with a
  // "needs you" band when something is tagged to you (it takes precedence over
  // the working/agents/activity body). The reality we're building toward is
  // agents doing most of the work and the communication, with us rarely
  // solicited, so the *Ambient* treatment (no band) is the ideal default state;
  // *Needs you* is the exception when the swarm needs a steer.
  return (
    <SurfaceLab
      surface="home"
      title="Scout iOS · Home"
      blurb="Home is the ambient survey of the swarm — paired-machine rail, what's currently being worked on, which agents are running, and the activity (increasingly agents talking to each other, not to us). Anything tagged to you takes precedence: Home leads with a compact 'needs you' band of steering points — approvals and questions you can act on inline, replies, errors — with a count badge on the Home tab. It appears only when there's something; un-solicited, Home is just the calm swarm. We considered a dedicated Inbox tab and rejected it: attention is a precedence layer on Home, not a place."
      source="apps/ios/Scout/HomeSurface.swift"
      tabBadges={{ home: INBOX.length }}
      treatments={[
        {
          id: "needs-you",
          label: "Needs you",
          note: "Compact by default, high-contrast, minimal color. The exception state: the swarm needs a steer. A precedence band above the ambient body — blocked approvals (Deny/Approve inline), questions (pick a direction), replies, errors. Kind reads from the mono label; risk from contrast (HIGH is ink-bright), not a colored pill. No status dots — liveness is the accent age and ink/dim contrast. The Home tab carries a count badge.",
          body: <HomeSurface attention />,
          mods: { density: "compact" },
        },
        {
          id: "ambient",
          label: "Ambient (ideal)",
          note: "The default we're designing for: nothing tagged to you, so no band — Home is just the swarm humming. What's being worked on, which agents are running, agents talking to each other. No dots, no corner brackets, no rainbow: one emerald accent for live/primary, ink/dim contrast for everything else. You watch; you steer only when you choose to.",
          body: <HomeSurface attention={false} />,
          mods: { density: "compact" },
        },
      ]}
    />
  );
}
