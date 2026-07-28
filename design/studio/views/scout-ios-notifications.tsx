"use client";

import {
  SurfaceLab, DetailHeader, NotificationsSurface, NotificationDetail,
  LEDGER, ledgerOpen,
} from "@/components/scout-ios";

const OPEN = LEDGER.filter(ledgerOpen).length;
const UNSEEN = LEDGER.filter((it) => !it.seen).length;

export default function ScoutIOSNotificationsStudy() {
  // The destination behind the alerts — deliberately a PLACE, not a tab. Home's
  // needs-you band stays the precedence layer (it shows what wants you now and
  // empties when nothing does); this answers the question the band can't: what
  // did the fleet ask me, and what became of it.
  return (
    <SurfaceLab
      surface="notifications"
      title="Scout iOS · Notifications"
      blurb="A device-local ledger of every alert the paired Macs raised — approvals, questions, failures — kept after it stops being pending. Two states per entry, the pair you actually triage on: seen/unseen (a leading accent tick, cleared when you open it) and how it ended (approved · denied · answered when THIS device made the call; resolved elsewhere · cleared when it merely stopped being pending on the Mac — we never name a decision we didn't make). Reached from the masthead bell and the Home lane header, never a seventh tab: attention stays a precedence layer, history is a destination."
      source="apps/ios/Scout/NotificationsSurface.swift"
      bellCount={UNSEEN}
      header={
        <DetailHeader
          title="Notifications"
          subtitle={`${OPEN} waiting on you · ${LEDGER.length} kept`}
          trailing={
            <span style={{
              fontFamily: "var(--i-mono,monospace)", fontSize: 9.5, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--i-muted)",
            }}>
              Mark all read
            </span>
          }
        />
      }
      treatments={[
        {
          id: "ledger",
          label: "Open (triage)",
          note: "The default scope: only what still holds an agent, and the only scope with FULL cards — summary, the payload the push withheld, and the decision itself. Approvals decide inline (Deny · Approve); a question offers Answer, which hands off to the entry page because answering needs the prompt and a field; anything FYI-shaped (a failure, a session error) has exactly one action, Dismiss. Dismiss sits third-rank — text weight, pushed to the far edge — so it can never be a mis-tap on Approve. Unseen entries carry an accent tick in the leading gutter; the gutter keeps its width once seen, so titles stay aligned. Risk reads through contrast (HIGH goes ink-bright), not a second hue.",
          body: <NotificationsSurface scope="open" />,
        },
        {
          id: "all",
          label: "All (preview log)",
          note: "The history, and deliberately a DIFFERENT row form: preview summary cards, two lines each — kind · session · age over the title and its state tag. No summary, no payload, no decision controls, because a settled item has nothing left to decide and the log reads faster when every row is the same height. The full text is one tap away. State tags: approved · denied · answered · dismissed read as ours (ink-bordered); resolved elsewhere · cleared stay dim — the honest reading when an item simply stopped being pending on the Mac. The only control is the file-away button at the trailing edge.",
          body: <NotificationsSurface scope="all" />,
        },
        {
          id: "archived",
          label: "Archived",
          note: "Archive is reversible, so it gets a place rather than being a polite word for delete. The scope chip only appears once something has been filed — an empty scope is a choice you have to read and reject on every visit. Same preview row; the trailing control becomes Unarchive.",
          body: <NotificationsSurface scope="archived" />,
        },
        {
          id: "clear",
          label: "All clear",
          note: "Nothing waiting. The calm beat — not an error state and not a placeholder list. The bell in the masthead drops its count with it; the history is still one tap away under All. A ledger that has never held anything says 'No notifications yet' instead: 'every alert has been settled' is a claim, and it has to be true.",
          body: <NotificationsSurface scope="open" items={LEDGER.filter((it) => !ledgerOpen(it))} />,
        },
        {
          id: "detail",
          label: "Opened",
          note: "One notification, opened — this is where the full text lands, since the APNs alert deliberately carries only a correlation id (prompts, commands, paths, and error bodies never leave the Mac through Apple). Decision first, then a provenance readout in the Instrument voice: state, which Mac raised it, which conversation, when it arrived. 'Open conversation' is real — it pushes the session transcript.",
          body: <NotificationDetail />,
        },
        {
          id: "detail-settled",
          label: "Opened · settled",
          note: "The same page for an entry that is no longer pending: no decision controls (there is nothing to decide), the triage pair becomes Archive, and the state row names what we actually know — 'denied · from this iPhone' when we made the call, plain 'resolved elsewhere' when we didn't, and 'dismissed · not answered' when we cleared it without sending anything. This is the case the old push-landing sheet got wrong, showing only 'this notification is no longer active'.",
          body: <NotificationDetail it={LEDGER.find((it) => it.id === "L7")} />,
        },
      ]}
    />
  );
}
