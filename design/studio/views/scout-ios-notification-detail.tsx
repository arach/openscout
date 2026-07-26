"use client";

import {
  SurfaceLab, HomeSimplified, NotificationDetail, NotificationHeader,
  NotificationBanner, NOTIFICATIONS,
} from "@/components/scout-ios";

/**
 * Scout iOS — Home simplification + the notification detail page.
 *
 * The implementation-ready lab, built on the shared `components/scout-ios` kit
 * so it sits in the same system as the other iOS surface studies (theme hub →
 * Home → Comms → Agents → Ops → the pushed details). The prose companion — IA,
 * contracts, touchpoints, acceptance criteria, delivery slices — lives in
 * `docs/design/ios-home-simplification-and-notification-detail.md`.
 *
 * The problem, stated in code. Home renders seven optional sections behind five
 * `@AppStorage` switches (`HomeSurface.swift:18-24, 103-134`), so no two
 * operators see the same Home and none of them see a hierarchy. And a push has
 * no destination of its own: a notification carrying a `conversationId`
 * force-switches the tab to Comms (`RootView.swift:407-417`); everything else
 * opens a medium-detent sheet (`RootView.swift:806`) — which is declared twice
 * on the same binding (`RootView.swift:314` and `:342`). Acknowledging an alert
 * therefore always means being taken somewhere.
 *
 * The proposal. Home answers two questions — what needs me, is the fleet moving
 * — and the notification gets a real destination: a pushed page where Act, Mark
 * read, and Dismiss are three separate verbs and only one of them navigates.
 */
export default function ScoutIOSNotificationDetailStudy() {
  const approval = NOTIFICATIONS[0];
  const question = NOTIFICATIONS[1];
  const failure = NOTIFICATIONS[3];

  return (
    <SurfaceLab
      surface="notification"
      title="Scout iOS · Home simplification + notification detail"
      blurb="Two surfaces, one argument. Home drops from seven switchable sections to three fixed zones — Needs you · one flat Activity log · the Ask dock — and every needs-you row lands on a real destination: a pushed notification page that resolves the opaque APNs id against the paired Mac. There you ACT (approve · answer · retry) without ever opening the transcript, and triage with Mark read / Dismiss — neither of which touches the agent, and neither of which forces the conversation open. Dismiss says so out loud: the agent keeps waiting."
      source="apps/ios/Scout/HomeSurface.swift · apps/ios/Scout/RootView.swift:806"
      tabBadges={{ home: NOTIFICATIONS.filter((n) => n.readAt == null).length }}
      controls={
        <div style={{ maxWidth: 430, fontSize: 11.5, lineHeight: 1.55, color: "#7a7f88" }}>
          <strong style={{ color: "#9aa0aa" }}>Three verbs.</strong> Act resolves the agent ·
          Mark read clears the badge · Dismiss hides the row. Only <em>Open&nbsp;↗</em> navigates.
          Spec: <code style={{ fontFamily: "var(--i-mono,monospace)" }}>docs/design/ios-home-simplification-and-notification-detail.md</code>
        </div>
      }
      treatments={[
        {
          id: "home",
          label: "Home · simplified",
          note: "Three zones, zero toggles. (1) NEEDS YOU — a VERTICAL queue, not the shipped horizontal NeedCard rail (HomeSurface.swift:304-320): triage has to show its whole queue at a glance, and a rail hides its tail. The count is unread, because that is the number the tab badge and the app badge carry. Kind is a mono text tag; only blocking kinds (approval · question — an agent is literally paused) take the single amber. Read rows recede but stay: disappearing is what Dismiss is for. (2) ACTIVITY — one flat log; the Working lane folds in as the accent-edged “now” rows and its only surviving glance-value is the live count in the header. (3) The Ask dock, unchanged — it is the one thing Home does besides report. Cut from Home: the vitals sparkline (it already has a home in CrownVitalsPanel), the Terminals shelf and the Tail module (both belong to Ops). Five @AppStorage switches → none.",
          body: <HomeSimplified />,
        },
        {
          id: "home-compact",
          label: "Home · compact",
          note: "The same surface at compact density — the treatment hook the other iOS labs already use. Worth judging on its own: the simplification only pays off if the two zones still read as a hierarchy once the rows tighten. Needs you keeps its 44pt targets and its amber edge; Activity gets denser but keeps the accent edge on live rows.",
          body: <HomeSimplified />,
          mods: { density: "compact" },
        },
        {
          id: "home-quiet",
          label: "Home · all clear",
          note: "The state we are actually designing toward: nothing tagged to you. Needs you is omitted entirely — no inbox-zero ceremony, no empty card — and the shipped ALL CLEAR emblem carries the surface. This is the one moment Home is allowed to celebrate, and it only fires under the shipped guard (HomeSurface.swift:200-207): the bridge online, every lane empty, AND the activity read genuinely succeeded. A failed read must never masquerade as calm.",
          body: <HomeSimplified quiet />,
        },
        {
          id: "detail",
          label: "Detail · approval",
          note: "The destination of a push, as a PAGE — it pushes onto the tab you were on, and Back returns you exactly there. Order is deliberate: WHO → WHAT → EVIDENCE → ACT → provenance, so a banner-launched page tells you what is being asked before it offers a control. Approve/Deny resolve the agent from here; the transcript never opens. Below, the triage bar is structurally separate from Act: Mark read and Dismiss neither act on the agent nor navigate, and Open ↗ is the only verb that moves you. Each triage verb carries a mono sub-label naming its real effect (“badge −1”, “agent keeps waiting”) so nothing is mistaken for a decision.",
          body: <NotificationDetail n={approval} state="resolved" />,
          header: <NotificationHeader n={approval} />,
          showChrome: false,
        },
        {
          id: "detail-question",
          label: "Detail · question",
          note: "The same page, question kind: the agent’s offered directions become chips, plus a free-text well for the case where neither option is right. Answering here posts through the same `answerQuestion` seam the sheet already uses (RootView.swift:999-1018) — the change is the surface, not the capability.",
          body: <NotificationDetail n={question} state="resolved" />,
          header: <NotificationHeader n={question} />,
          showChrome: false,
        },
        {
          id: "detail-acted",
          label: "Detail · acted",
          note: "After acting the page STAYS. It becomes a receipt — “Approved 2s ago — broker-smith resumed. Nothing else opened.” — and the triage bar flips Mark read on, because acting implies having seen it. Auto-dismissing here would be the same mistake as auto-opening the conversation: deciding the operator’s next move for them.",
          body: <NotificationDetail n={approval} state="acted" />,
          header: <NotificationHeader n={approval} />,
          showChrome: false,
        },
        {
          id: "detail-dismissed",
          label: "Detail · dismissed",
          note: "The honesty case, and the guardrail the whole design exists to provide. Dismiss hides the alert; it does not answer it. The notice says so in as many words — “broker-smith is still waiting” — with an Undo. On a non-blocking kind (an error, an idle agent) Dismiss is a plain clear; on a blocking kind it always carries this line. A triage control that reads like a decision is the one failure mode that would make push notifications unsafe to act on.",
          body: <NotificationDetail n={approval} state="dismissed" />,
          header: <NotificationHeader n={approval} />,
          showChrome: false,
        },
        {
          id: "detail-resolving",
          label: "Detail · resolving",
          note: "The push carries correlation ids only — no prompt, no command, no path (`sanitizeCustomPayload`, apps/mesh-front-door/src/push-relay.ts:796). So the page opens knowing nothing and resolves `itemId` against `mobile.inbox` across every readable Mac. A shaped skeleton, not a spinner, and the id is named in the provenance line so a stuck resolve is debuggable rather than mysterious. Triage is already live here: Mark read works before the content arrives.",
          body: <NotificationDetail state="resolving" />,
          header: <NotificationHeader />,
          showChrome: false,
        },
        {
          id: "detail-offline",
          label: "Detail · offline",
          note: "The bridge is gone but the item was cached from an earlier read. The critical call: triage works offline, Act does not. Mark read and Dismiss queue locally and sync on reconnect — acknowledging an alert must never require a Mac to be awake. Approve/Deny dim with a stated reason rather than failing silently, and the provenance line degrades to “last read 4m ago” instead of implying freshness.",
          body: <NotificationDetail n={approval} state="offline" />,
          header: <NotificationHeader n={approval} />,
          showChrome: false,
        },
        {
          id: "detail-unreachable",
          label: "Detail · unreachable",
          note: "The harder offline case: the push landed and nothing could read it back, so Scout has the alert and nothing else. The payload is deliberately generic (“A local agent needs your approval”), so the page must not pretend to know more. It names the constraint as the design decision it is — the details live on your Mac, never in the push — offers Retry, and keeps triage alive so the alert can still be acknowledged from a plane.",
          body: <NotificationDetail n={null} state="offline" />,
          header: <NotificationHeader />,
          showChrome: false,
        },
        {
          id: "detail-handled",
          label: "Detail · handled elsewhere",
          note: "You approved it on the Mac two minutes ago, then tapped the phone banner. Today this renders as “This notification is no longer active on the paired Mac” (RootView.swift:835) — vague enough to read as an error. It should read as a resolution: what happened, where, when. Act is withdrawn (there is nothing left to decide), triage stays, Open ↗ still works if you want the transcript.",
          body: <NotificationDetail n={approval} state="handled" />,
          header: <NotificationHeader n={approval} />,
          showChrome: false,
        },
        {
          id: "detail-failed",
          label: "Detail · send failed",
          note: "The decision call itself failed. The page keeps your choice, states plainly that it did not reach studio, and leaves the buttons live for a retry. What it must never do is clear the item or imply success — an approval that silently did not land is worse than one that visibly did not.",
          body: <NotificationDetail n={failure} state="failed" />,
          header: <NotificationHeader n={failure} />,
          showChrome: false,
        },
        {
          id: "banner",
          label: "Banner · OS triage",
          note: "The strongest form of “don’t force the destination open”: resolve from the lock screen and never launch the app. Needs a `UNNotificationCategory(\"SCOUT_ATTENTION\")` registered at launch (ScoutApp.swift:23-29) and `aps.category` passed through the relay — push-relay.ts:737-746 builds the aps dict today and carries only what it is told to. Mark read and Dismiss are non-foreground actions; Open is the foreground one and lands on the detail page. Delivery slice 4 — everything above ships without it.",
          body: <NotificationBanner />,
          header: <NotificationHeader />,
          showChrome: false,
        },
      ]}
    />
  );
}
