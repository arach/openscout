"use client";

// Scout iOS — Notifications. The destination behind the alerts.
//
// Home's needs-you band is a precedence layer: it shows what wants you NOW and
// empties the second an agent stops waiting. That leaves no answer to "what did
// it ask me an hour ago, and what happened to it?" — so this is a place, not a
// tab: a device-local ledger of every alert the paired Macs raised, reachable
// from the masthead bell and from the Home lane header, never competing for a
// tab slot (attention stays a layer; history is a destination).
//
// Two independent states per row, exactly the pair you triage on:
//   seen / unseen  — a leading accent tick, cleared when you open the item.
//   how it ended   — a mono tag: approved · denied · answered (ours, sent from
//                    this device) · dismissed (cleared from your queue here,
//                    nothing sent) vs resolved elsewhere · cleared (it merely
//                    stopped being pending on the Mac). We never name a decision
//                    we didn't make.
//
// Scope decides the ROW FORM, which is the important half of this design:
//   Open     — full cards. Every row carries its own decision, because clearing
//              the queue from here is the whole point of the destination.
//   All      — preview summary cards. Two lines, no payload, no controls: it is
//              a log you scan, and a settled item has nothing left to decide.
//   Archived — the same preview, with Unarchive. Only appears once something is
//              archived, so the scope row stays at two chips until it earns a third.
//
// Styles live in theme.ts under "Notifications destination".

import { useState } from "react";
import { Glyph } from "./Glyph";
import {
  LEDGER, LEDGER_KIND_LABEL, ledgerDecidable, ledgerOpen, ledgerStateLabel,
  type LedgerItem,
} from "./data";

export type NotifScope = "open" | "all" | "archived";

/** Leading gutter: an accent tick for unseen, a hairline stub once seen — the
 *  column stays the same width either way so titles align down the list. */
function SeenTick({ seen }: { seen: boolean }) {
  return <span className="iLedTick" data-unseen={seen ? undefined : ""} />;
}

/** Risk reads through contrast, not hue: HIGH goes ink-bright, everything else
 *  stays dim. (One accent in this app; a risk rainbow would spend it.) */
function RiskTag({ risk }: { risk?: LedgerItem["risk"] }) {
  if (!risk) return null;
  return <span className="iLedRisk" data-high={risk === "high" ? "" : undefined}>{risk}</span>;
}

/** How it ended, in one mono tag. Ours (sent or cleared from this device) takes
 *  the ink; an outcome we only inferred stays dim and unnamed. */
function StateTag({ it }: { it: LedgerItem }) {
  const label = ledgerStateLabel(it);
  if (!label) return null;
  return (
    <span className="iLedStateTag" data-ours={it.here ? "" : undefined}>{label}</span>
  );
}

/** OPEN row — the full card. Approvals decide inline; questions hand off to the
 *  entry page (answering needs the prompt and a field); everything else is
 *  FYI-shaped, so its one action is Dismiss. */
function OpenRow({ it, onOpen }: { it: LedgerItem; onOpen?: () => void }) {
  return (
    <div className="iLedRow" data-open="" onClick={onOpen}>
      <SeenTick seen={it.seen} />
      <div className="iLedBody">
        <div className="iLedTop">
          <span className="iLedKind">{LEDGER_KIND_LABEL[it.kind]}</span>
          <span className="iLedSession">{it.session}</span>
          <span className="iLedAge">{it.age}</span>
        </div>
        <div className="iLedTitle">{it.title}</div>
        <div className="iLedSummary">{it.summary}</div>

        {it.detail && (
          <div className="iLedPayload">
            <span className="iLedPayloadText">{it.detail.split("\n")[0]}</span>
            <RiskTag risk={it.risk} />
          </div>
        )}

        <div className="iLedActions">
          {ledgerDecidable(it) ? (
            <>
              <button className="iNeedBtn deny">Deny</button>
              <button className="iNeedBtn approve">Approve</button>
              <button className="iLedGhostBtn">Dismiss</button>
            </>
          ) : it.kind === "question" ? (
            <>
              <button className="iNeedBtn approve">Answer</button>
              <button className="iLedGhostBtn">Dismiss</button>
            </>
          ) : (
            <button className="iLedGhostBtn">Dismiss</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** ALL / ARCHIVED row — the preview summary card. Two lines and a state tag:
 *  kind · session · age over the title. No summary, no payload, no decision
 *  controls — a settled item has nothing left to decide, and the log reads
 *  faster when every row is the same two lines. The full text is one tap away.
 *  The only control is the file-away action at the trailing edge. */
function PreviewRow({ it, archived, onOpen }: {
  it: LedgerItem; archived?: boolean; onOpen?: () => void;
}) {
  return (
    // Still-pending entries keep the ink even in the log: All is a MIXED list,
    // and "this one is still waiting on you" has to survive the compression.
    // Their state column is simply empty — nothing has settled yet.
    <div className="iLedRow iLedRow--preview" data-open={ledgerOpen(it) ? "" : undefined}
      onClick={onOpen}>
      <SeenTick seen={it.seen} />
      <div className="iLedBody">
        <div className="iLedTop">
          <span className="iLedKind">{LEDGER_KIND_LABEL[it.kind]}</span>
          <span className="iLedSession">{it.session}</span>
          <span className="iLedAge">{it.age}</span>
        </div>
        <div className="iLedPreviewLine">
          <span className="iLedTitle">{it.title}</span>
          <StateTag it={it} />
        </div>
      </div>
      <button className="iLedFileBtn" title={archived ? "Unarchive" : "Archive"}
        onClick={(e) => e.stopPropagation()}>
        <Glyph kind={archived ? "arrow" : "inbox"} size={13} rotate={archived ? -90 : 0} />
      </button>
    </div>
  );
}

export function NotificationsSurface({
  scope, onScope, items = LEDGER,
}: {
  /** Controlled scope. Omit to let the surface hold its own (the lab's default,
   *  so the chips are live inside the phone frame). */
  scope?: NotifScope;
  onScope?: (s: NotifScope) => void;
  items?: LedgerItem[];
} = {}) {
  const [ownScope, setOwnScope] = useState<NotifScope>(scope ?? "open");
  const active = scope ?? ownScope;
  const setScope = (s: NotifScope) => { setOwnScope(s); onScope?.(s); };

  const live = items.filter((it) => !it.archived);
  const openItems = live.filter(ledgerOpen);
  const archivedItems = items.filter((it) => it.archived);
  const shown = active === "open" ? openItems : active === "all" ? live : archivedItems;

  const scopes: { id: NotifScope; label: string; count: number }[] = [
    { id: "open", label: "Open", count: openItems.length },
    { id: "all", label: "All", count: live.length },
    // The third chip only exists once something has been filed — an empty
    // scope is a choice you have to read and reject on every visit.
    ...(archivedItems.length
      ? [{ id: "archived" as NotifScope, label: "Archived", count: archivedItems.length }]
      : []),
  ];

  return (
    <div className="iBody">
      <div className="iLedFilter">
        {scopes.map((s) => (
          <button key={s.id} className="iLedFilterBtn" data-on={s.id === active ? "" : undefined}
            onClick={() => setScope(s.id)}>
            {s.label}
            <span className="iLedFilterCount">{s.count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="iAllClear">
          <span className="iAllClearMark">
            <Glyph kind={active === "open" && live.length > 0 ? "check" : "inbox"} size={18} />
          </span>
          <span className="iAllClearTitle">
            {active === "archived"
              ? "Nothing archived"
              : active === "open" && live.length > 0
                ? "Nothing waiting on you"
                : "No notifications yet"}
          </span>
          <span className="iAllClearSub">
            {active === "archived"
              ? "filed alerts land here"
              : active === "open" && live.length > 0
                ? "every alert has been settled"
                : "alerts your Macs raise land here"}
          </span>
        </div>
      ) : (
        <div className="iCard iLedList">
          {shown.map((it, i) => (
            <div key={it.id}>
              {i > 0 && <div className="iRowSep" />}
              {active === "open"
                ? <OpenRow it={it} />
                : <PreviewRow it={it} archived={active === "archived"} />}
            </div>
          ))}
        </div>
      )}

      {active !== "open" && shown.length > 0 && (
        <div className="iLedFoot">Kept on this iPhone · 30 days</div>
      )}
    </div>
  );
}

/** One notification, opened. The full text the push deliberately withheld (the
 *  APNs alert carries only a correlation id), every action that applies to it,
 *  and a truthful provenance footer — which Mac raised it, when, how it ended. */
export function NotificationDetail({ it = LEDGER[0] }: { it?: LedgerItem } = {}) {
  const open = ledgerOpen(it);
  const state = ledgerStateLabel(it);
  return (
    <div className="iBody">
      <div className="iLedDetail">
        <div className="iLedTop">
          <span className="iLedKind">{LEDGER_KIND_LABEL[it.kind]}</span>
          <span className="iLedSession">{it.session}</span>
          <span className="iLedAge">{it.age}</span>
        </div>
        <div className="iLedDetailTitle">{it.title}</div>
        <div className="iLedDetailSummary">{it.summary}</div>

        {it.detail && (
          <div className="iLedDetailWell">
            {it.detail}
            {it.risk && <div className="iLedDetailRisk"><RiskTag risk={it.risk} /></div>}
          </div>
        )}

        {open && ledgerDecidable(it) && (
          <div className="iLedActions">
            <button className="iNeedBtn deny">Deny</button>
            <button className="iNeedBtn approve">Approve</button>
          </div>
        )}
        {open && it.kind === "question" && (
          <>
            <div className="iLedActions">
              {(it.options ?? []).map((o) => <button className="iNeedOpt" key={o}>{o}</button>)}
            </div>
            <div className="iComposer iLedAnswer">
              <div className="iComposerField">
                <span className="iComposerCaret" />
                <span>Answer…</span>
              </div>
              <span className="iSend"><Glyph kind="arrow" size={15} /></span>
            </div>
          </>
        )}

        {/* The triage pair, kept away from the decision controls so a Dismiss is
            never a mis-tap on an Approve. Dismiss says exactly what it does: it
            clears YOUR queue and sends the agent nothing. */}
        <div className="iLedTriage">
          {open ? (
            <>
              <button className="iLedGhostBtn">Dismiss</button>
              <span className="iLedTriageNote">clears your queue · sends nothing</span>
            </>
          ) : (
            <>
              <button className="iLedGhostBtn">
                {it.archived ? "Unarchive" : "Archive"}
              </button>
              <span className="iLedTriageNote">
                {it.archived ? "back into the log" : "out of the log, still recoverable"}
              </span>
            </>
          )}
        </div>

        <div className="iLedProv">
          <div className="iLedProvRow"><span>state</span>
            <span className="iLedProvVal" data-open={open ? "" : undefined}>
              {open ? "waiting on you" : state}
              {!open && it.here ? (it.state === "dismissed" ? " · not answered" : " · from this iPhone") : ""}
            </span>
          </div>
          <div className="iLedProvRow"><span>raised by</span><span className="iLedProvVal">{it.machine}</span></div>
          <div className="iLedProvRow"><span>conversation</span><span className="iLedProvVal">{it.session}</span></div>
          <div className="iLedProvRow"><span>arrived</span><span className="iLedProvVal">{it.age} ago</span></div>
        </div>

        <button className="iLedOpenConv">
          Open conversation <Glyph kind="chevron" size={12} />
        </button>
      </div>
    </div>
  );
}
