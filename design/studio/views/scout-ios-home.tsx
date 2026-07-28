"use client";

import {
  SurfaceLab, HomeSurface, FleetSurface, FleetLogSurface,
  EntrySurface, EntryFirstRun, EntryMast, EntryPlacesSheet, INBOX,
} from "@/components/scout-ios";

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
          id: "entry",
          label: "Entry (composer-first)",
          note: "SHIPPED to iOS (apps/ios/Scout/HomeSurface.swift, `scout.home.style` = entry). v2, after review on device: the greeting headline, the fleet stat line and the needs-you lane are all GONE. A headline you have to read before you can type is a tax on the one thing this screen is for, and attention already lives in the masthead bell / Notifications and in the classic Fleet Home — duplicating it here bought nothing and spent the air. So the resting body is: air, then RECENTS (five muted one-liners — recency is the shortest path back, not the page), then the composer. The dock is the full sandwich, never folded: the draft line is its own line in a step-larger, calmer type, and the base row runs attach ⊕ bottom-left, then the runtime chip · mic · send bottom-right, with Send legible-but-disabled at rest rather than recessed to invisible. The runtime chip is REAL — official Anthropic/OpenAI/Gemini/xAI marks (not approximations), model, a hairline divider, effort — and it opens the machined model plate; the pick rides the seeded session onto SessionInitiationSpec.Execution (harness · model · reasoningEffort). Below the composer sits OUR accessory line where the system QuickType strip used to be (the field declares predictions:false, so the system bar is gone): smart-action PILLS scrolling on one left rail with the draft line and attach, fading out before a pinned keyboard TOGGLE — down while the keyboard is up, up while it isn't, so the row can bring back what it dismissed. The keyboard covers the tab bar, standard iOS. Top-left is the way OUT: a machined Places disc opens the map below. The masthead discs are now ONE complication family — places leading, bell + gear trailing (native; the studio mast carries places + gear), all cut from the crown study's machined plate at the crown's own seat scale (36pt: top-lit graphite face, rim light bright at the crown and gone by the waist, hairline silhouette, fine grain), calmer than the crown only in the shadow (one contact shadow, not the crown's floating pair) and never carrying the accent. And the SCOUT wordmark is gone from this variant's masthead: on a composer-first front door the app's own name is the one thing on the row that answers no question you have, so the row is complications plus the host you're steering — the Fleet home, read at arm's length, keeps the wordmark. Their sibling is the bottom chrome: see *Entry · Resting* for the floating liquid-glass bar that seats the current tab on the same plate.",
          body: <EntrySurface />,
          header: <EntryMast />,
          showChrome: false,
          defaultVariant: "paper",
        },
        {
          id: "entry-resting",
          label: "Entry · Resting (glass bar)",
          note: "SHIPPED to iOS alongside the treatment above — the same front door with the keyboard DOWN, which is where the app's bottom chrome shows. Tied to the Entry variant only (`scout.home.style` = entry): a floating liquid-glass capsule inset from every edge, real iOS 26 glass natively (`.glassEffect(.regular, in: .capsule)` through HudsonKit's `hudLiquidBarMaterial`; only Reduce Transparency drops it to a solid plate), backdrop-filter here. The classic Fleet home keeps its docked bar + cockpit status strip untouched. The current tab is seated on the SAME machined plate the masthead complications are cut from — a graphite instrument sitting in a glass rail — and the rail wears their rim light and hairline, which is what makes top-left and bottom read as one system rather than two materials sharing a screen. The seat hugs its tab (Apple's shape); the accent stays exactly as rationed on the docked bar, glyph + label, nothing else green. The cockpit status strip is ABSORBED: a floating bar wants clear air under it, route + host already live on the masthead chip, and fleet counts live on Home and Agents — what the strip alone could tell you (connection dropped, or data quietly gone stale past three minutes) comes back as one dim mono line above the bar, and only while it is true. Keyboard up, the keys cover the bar exactly as they cover the docked one.",
          body: <EntrySurface resting />,
          header: <EntryMast />,
          showChrome: false,
          defaultVariant: "paper",
        },
        {
          id: "entry-places",
          label: "Entry · Places",
          note: "What the top-left disc opens — the new user's map. 'As a new user I'm like what can I do here? I don't want to go through these threads, I don't want to talk to anything, I just want to go around.' A calm sheet of the app's important destinations, each with the one line that says what you'd go there to do: Agents · Comms · Tail · New session · Terminal · Notifications · Settings. Rows, not tiles — a name and a verb read faster than a grid of glyphs. Every row is REAL navigation the shell already performs (tab selection, the bell's route, the gear's sheet); Mission Control's lanes/deck/dispatch are deliberately absent — a power surface, not one of the places a new operator is looking for. Sized so the whole map is on screen at rest.",
          body: <><EntrySurface /><EntryPlacesSheet /></>,
          header: <EntryMast />,
          showChrome: false,
          defaultVariant: "paper",
        },
        {
          id: "entry-needs",
          label: "Entry · Needs you",
          note: "NOT SHIPPED — kept as the documented exception-state study, and as the record of what we chose against. The same front door with attention taking the headline ('3 agents are paused on you.') and only the BLOCKING items interrupting. On device this read as too much air spent before you could type, so the shipped Entry keeps attention in the masthead bell / Notifications and in the classic Fleet Home instead. Worth keeping for the interrupt grammar itself: approvals and questions settled inline, verbatim command + risk kept, FYI items waiting in Notifications ('2 more'), and no ambiguous Clear — deciding, or letting it wait, are the honest exits.",
          body: <EntrySurface attention />,
          header: <EntryMast />,
          showChrome: false,
          defaultVariant: "paper",
        },
        {
          id: "entry-first",
          label: "Entry · First run",
          note: "The screen every new user actually sees — designed, not a native fallback card: one promise sentence, one action (Connect your Mac — the one-tap LAN pairing that already ships), one hint that it's painless. No composer yet (nothing to ask until a Mac is paired), no badges, no jargon anywhere on the glass. This is where ChatGPT-vs-hacker-tool is actually won.",
          body: <EntryFirstRun />,
          header: <EntryMast />,
          showChrome: false,
          defaultVariant: "paper",
        },
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
