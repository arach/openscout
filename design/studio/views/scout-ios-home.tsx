"use client";

import { SurfaceLab, HomeSurface, FleetSurface, FleetLogSurface, INBOX } from "@/components/scout-ios";

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
          id: "log",
          label: "Log (new)",
          note: "A calmer Home. The top carries only the two glance-values that actually help — the activity chart, and how much of each subscription window you've spent (Claude · Codex quotas), a thin meter that reads amber when you're near the cap. Below, the swarm's work is ONE flat Activity log: no cards, no Working/Detected lanes, no dividing section — a single continuous stream, freshest first, with a single accent edge on what's happening right now. Attribution reads from the mono source tag, recency from the age (accent when live). Same component opens on the wide stage: chart + quotas split into a two-column top band, the flat log runs full width with more air.",
          body: <FleetLogSurface />,
          wide: <FleetLogSurface />,
        },
        {
          id: "fleet",
          label: "Fleet (new)",
          note: "The web Fleet dashboard folded into Home. One responsive component, no forked markup: on iPhone every element holds to a single line — the stat band is one inline run (live · agents · machines) with a mini sparkline, each Needs-you / Working / Detected row is name · detail · age with ellipsis truncation, and Ask-the-fleet docks as a one-line strip. On the wide stage below, container queries open the same component into the dashboard: big numerals, a larger sparkline, and the lanes sit beside the Ask-the-fleet rail (route + harness pickers, input well) with the live fleet log under it.",
          body: <FleetSurface />,
          wide: <FleetSurface />,
        },
        {
          id: "fleet-crisp",
          label: "Fleet · Crisp",
          note: "The same Fleet layout in a quieter design language, kept as a comparison variant (the baseline treatment above is untouched). Less rounded: cards 16→6, chrome buttons → soft squares, pills → square tags. One weight-stop lighter throughout, with presence recovered via tracking, not re-bolding. Quietly lifted rather than merely flat: 1px hairlines + a whisper of ink-tinted shadow on Paper. Clarity pass on top of the pretty pass: (1) a legibility floor — micro-caps (lane labels, stat captions) step up to muted at ≥9px so they resolve on Paper; (2) the demand KIND now surfaces as a legible square tag on the phone too, not just wide — approval/question read ink-bright, reply/errored muted, so the attention lane keeps its 'what does it want from me' signal exactly where you triage; (3) a three-tier hierarchy without color — Needs you (ink, biggest label) ≫ Working (muted, live action mono) > Detected (dim label + dim, smaller location mono), with extra air above the working/detected heads; the two mono voices no longer compete. Spacing beats: band → lanes → rail. One emerald accent only. Palette toggle stays live — flip to Shipped to judge the geometry on dark.",
          body: <FleetSurface />,
          wide: <FleetSurface />,
          mods: { lang: "crisp" },
          defaultVariant: "paper",
        },
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
