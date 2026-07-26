"use client";

// Scout iOS — Home · simplified + the Notification detail page.
//
// Two surfaces, one argument. Today Home renders seven optional sections behind
// five @AppStorage switches (apps/ios/Scout/HomeSurface.swift:18-24, 103-134),
// and a push has no destination of its own: a notification carrying a
// conversationId force-switches the tab to Comms
// (apps/ios/Scout/RootView.swift:407-417), everything else opens a medium-detent
// sheet (RootView.swift:806). Opening an alert therefore always means opening
// something else — you cannot acknowledge without being taken somewhere.
//
// This study:
//   Home        → three zones, zero toggles: NEEDS YOU · one flat ACTIVITY log
//                 (the Working lane folds in as the accent-edged "now" rows) ·
//                 the Ask dock. Every needs-you row lands on ↓
//   Detail      → a PUSHED page, the real destination of a push. It resolves the
//                 opaque itemId against the paired Mac, lets you ACT inline
//                 (approve / deny / answer), and carries a triage bar —
//                 Mark read · Dismiss · Open ↗ — where the first two never touch
//                 the agent and never navigate.
//
// Styles live in theme.ts under "Home · simplified" and "Notification detail".

import { Glyph } from "./Glyph";
import { DetailHeader } from "./PhoneShell";
import {
  ACTIVITY, NOTIFICATIONS, NOTIF_KIND_LABEL, notifBlocking,
  type NotifDetail,
} from "./data";

// ── Home · simplified ───────────────────────────────────────────────────────

/** Zone head — the one heading grammar Home uses now: caps label, an optional
 *  count (attention) or meta (live), and a hairline running out to the edge. */
function Zone({ label, count, meta, live, attn }: {
  label: string; count?: number; meta?: string; live?: boolean; attn?: boolean;
}) {
  return (
    <div className="iZone">
      <span className="iZoneLabel" data-attn={attn ? "" : undefined}>{label}</span>
      {count != null && <span className="iZoneCount">{count}</span>}
      <span className="iZoneRule" />
      {meta && <span className="iZoneMeta" data-live={live ? "" : undefined}>{meta}</span>}
    </div>
  );
}

/** One needs-you row. Vertical, full-width, 44pt minimum — a triage queue you
 *  can see all of, not a horizontal card rail that hides its tail (the shipped
 *  `NeedCard` scroller, HomeSurface.swift:304-320). Kind is a mono TEXT tag;
 *  only BLOCKING kinds take the single amber. Read rows recede; they don't
 *  disappear — disappearing is what Dismiss is for. */
export function NeedRow({ n, onOpen }: { n: NotifDetail; onOpen?: () => void }) {
  const read = n.readAt != null;
  const blocking = notifBlocking(n);
  return (
    <div className="iNeed2" data-read={read ? "" : undefined} onClick={onOpen}
      role="button" tabIndex={0}
      aria-label={`${NOTIF_KIND_LABEL[n.kind]} from ${n.agent} in ${n.project}, ${n.age} ago. ${n.title}. ${read ? "Read" : "Unread"}.`}>
      <span className="iNeed2Bar" aria-hidden />
      <div className="iNeed2Body">
        <div className="iNeed2Top">
          <span className="iNeed2Agent">{n.agent}</span>
          <span className="iNeed2Proj">{n.project}</span>
          <span className="iNeed2Kind" data-block={blocking ? "" : undefined}>
            {NOTIF_KIND_LABEL[n.kind]}
          </span>
          <span className="iNeed2Age">{n.age}</span>
        </div>
        <div className="iNeed2Text">{n.title}</div>
      </div>
      <span className="iNeed2Chev" aria-hidden><Glyph kind="chevron" size={13} /></span>
    </div>
  );
}

const isNow = (age: string) => age === "now";

/**
 * Home, simplified. Three zones and no switches.
 *
 * `needs` = the queue (empty → the zone is omitted entirely, no inbox-zero
 * ceremony). `quiet` shows the all-clear emblem when there is genuinely nothing
 * to report — the one state Home is allowed to celebrate.
 */
export function HomeSimplified({
  needs = NOTIFICATIONS, quiet = false, cap = 4, onOpen,
}: {
  needs?: NotifDetail[]; quiet?: boolean; cap?: number;
  onOpen?: (n: NotifDetail) => void;
} = {}) {
  const open = needs.filter((n) => n.dismissedAt == null);
  const shown = open.slice(0, cap);
  const unread = open.filter((n) => n.readAt == null).length;
  const live = ACTIVITY.filter((e) => isNow(e.age)).length;

  if (quiet) {
    return (
      <div className="iBody">
        <div className="iHomeS">
          <div className="iQuiet">
            <Glyph kind="home" size={62} />
            <div className="iQuietRule"><i /><b /></div>
            <div className="iQuietLabel">All clear — the fleet is quiet.</div>
          </div>
          <div className="iAskDock">
            <span className="iAskDockText">Ask the fleet…</span>
            <span className="iAskDockSend">↑</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="iBody">
      <div className="iHomeS">
        {/* 1 — NEEDS YOU. Only when non-empty. The count is UNREAD, because
            that is the number the tab badge and the app badge carry. */}
        {open.length > 0 && (
          <>
            <Zone label="Needs you" count={unread} attn />
            <div>
              {shown.map((n) => <NeedRow key={n.id} n={n} onOpen={() => onOpen?.(n)} />)}
              {open.length > shown.length && (
                <div className="iNeedMore">{open.length - shown.length} more</div>
              )}
            </div>
          </>
        )}

        {/* 2 — ACTIVITY. One flat log. The Working lane is gone: live agents are
            the accent-edged "now" rows, and the live count is the lane header's
            single glance-value. */}
        <div className="iHomeLog">
          <Zone label="Activity" meta={live > 0 ? `${live} live` : "quiet"} live={live > 0} />
          <div className="iHomeLogList">
            {ACTIVITY.slice(0, 12).map((e) => (
              <div className="iHomeLogRow" key={e.id} data-now={isNow(e.age) ? "" : undefined}>
                <span className="iHomeLogText">{e.summary}</span>
                <span className="iHomeLogSrc">{e.source}</span>
                <span className={`iHomeLogAge${isNow(e.age) ? " live" : ""}`}>{e.age}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 3 — ASK. Unchanged; it is the one thing Home does besides report. */}
        <div className="iAskDock">
          <span className="iAskDockText">Ask the fleet…</span>
          <span className="iAskDockSend">↑</span>
        </div>
      </div>
    </div>
  );
}

// ── Notification detail — header + page ─────────────────────────────────────

/** The pushed header. Back returns to whatever you were on — the page never
 *  owned the tab. The ⋯ carries the low-frequency moves (mute this agent,
 *  open on the Mac) so the triage bar stays three verbs wide. */
export function NotificationHeader({ n }: { n?: NotifDetail }) {
  return (
    <DetailHeader
      title="Notification"
      subtitle={n ? `${n.agent} · ${n.project}` : "resolving…"}
      trailing={<span className="iGear iGearSm"><Glyph kind="gear" size={16} /></span>}
    />
  );
}

/** The triage bar — pinned, always present, and structurally separate from the
 *  Act block above it. Mark read and Dismiss do NOT act on the agent and do NOT
 *  navigate; Open is the only verb that takes you anywhere, and only on request.
 *  `offline` disables nothing here on purpose: triage must work without the Mac
 *  (it queues), while Act cannot. */
export function TriageBar({ read = false, dismissed = false, canOpen = true }: {
  read?: boolean; dismissed?: boolean; canOpen?: boolean;
}) {
  return (
    <div className="iNDTriage" role="toolbar" aria-label="Triage">
      <div className="iNDTri" data-on={read ? "" : undefined}
        role="button" tabIndex={0} aria-pressed={read}
        aria-label={read ? "Marked read" : "Mark read"}>
        <span className="iNDTriLabel">{read ? "Read" : "Mark read"}</span>
        <span className="iNDTriSub">badge −1</span>
      </div>
      <span className="iNDTriSep" aria-hidden />
      <div className="iNDTri" data-on={dismissed ? "" : undefined}
        role="button" tabIndex={0} aria-label="Dismiss — hides this from Needs you; the agent keeps waiting">
        <span className="iNDTriLabel">{dismissed ? "Dismissed" : "Dismiss"}</span>
        <span className="iNDTriSub">agent keeps waiting</span>
      </div>
      <span className="iNDTriSep" aria-hidden />
      <div className="iNDTri" data-off={canOpen ? undefined : ""}
        role="button" tabIndex={0} aria-label="Open the conversation">
        <span className="iNDTriLabel">Open ↗</span>
        <span className="iNDTriSub">transcript</span>
      </div>
    </div>
  );
}

function Notice({ tone, mark, children }: {
  tone: "ok" | "warn" | "err" | "flat"; mark: string; children: React.ReactNode;
}) {
  return (
    <div className="iNDNotice"
      data-ok={tone === "ok" ? "" : undefined}
      data-warn={tone === "warn" ? "" : undefined}
      data-err={tone === "err" ? "" : undefined}>
      <span className="iNDNoticeMark">{mark}</span>
      <span>{children}</span>
    </div>
  );
}

/** The Act block — the whole point of the page. Approvals decide, questions
 *  answer, failures retry. Resolving here means the transcript stays closed. */
function ActBlock({ n, state }: { n: NotifDetail; state: DetailState }) {
  const off = state === "offline";
  if (n.kind === "approval") {
    return (
      <div className="iNDAct">
        <span className="iNDActLabel">Act</span>
        <div className="iNDBtnRow">
          <span className="iNDBtn" data-off={off ? "" : undefined}>Deny</span>
          <span className="iNDBtn" data-primary data-off={off ? "" : undefined}>Approve</span>
        </div>
        {off && <div className="iNDProv">Connect to studio to approve — triage still works offline.</div>}
      </div>
    );
  }
  if (n.kind === "question") {
    return (
      <div className="iNDAct">
        <span className="iNDActLabel">Act</span>
        <div className="iNDOpts">
          {(n.options ?? []).map((o) => (
            <span className="iNDOpt" key={o} data-off={off ? "" : undefined}>{o}</span>
          ))}
        </div>
        <div className="iNDAnswer">…or answer in your own words</div>
      </div>
    );
  }
  return (
    <div className="iNDAct">
      <span className="iNDActLabel">Act</span>
      <div className="iNDBtnRow">
        <span className="iNDBtn" data-off={off ? "" : undefined}>Retry</span>
        <span className="iNDBtn" data-off={off ? "" : undefined}>Open log</span>
      </div>
    </div>
  );
}

/** Every state the page has to hold. */
export type DetailState =
  | "resolved"      // the happy path — item found on the Mac
  | "resolving"     // the opaque id is being matched against the bridge
  | "acted"         // you approved / answered — receipt, page stays put
  | "handled"       // resolved somewhere else (the Mac, another device)
  | "offline"       // no readable bridge; triage still works, Act doesn't
  | "failed"        // the decision call itself failed
  | "dismissed";    // triaged away, with an undo

/**
 * The notification detail page.
 *
 * Content order is deliberate: WHO → WHAT → EVIDENCE → ACT → (notice) →
 * provenance, then the pinned triage bar. The demand is legible before any
 * control, so an operator glancing at a banner-launched page knows what is being
 * asked before deciding whether to engage at all.
 */
export function NotificationDetail({
  n = NOTIFICATIONS[0], state = "resolved",
}: { n?: NotifDetail | null; state?: DetailState } = {}) {
  if (state === "resolving") {
    return (
      <div className="iBody">
        <div className="iND">
          <div className="iNDScroll">
            <div className="iNDSkel" style={{ height: 12, width: "44%" }} />
            <div className="iNDSkel" style={{ height: 20, width: "88%" }} />
            <div className="iNDSkel" style={{ height: 40 }} />
            <div className="iNDSkel" style={{ height: 44 }} />
            <div className="iNDProv">Resolving att_9f31 on studio…</div>
          </div>
          <TriageBar canOpen={false} />
        </div>
      </div>
    );
  }

  // Unresolved: the push landed but nothing could read it back. The alert is all
  // we have, and the alert is deliberately generic — so say exactly that, and
  // keep triage working anyway.
  if (!n) {
    return (
      <div className="iBody">
        <div className="iND">
          <div className="iNDState">
            <Glyph kind="signal" size={26} />
            <div className="iNDStateTitle">Can’t reach studio</div>
            <div className="iNDStateBody">
              Scout has the alert but not its contents — the details live on your Mac, never in
              the push. Mark read and Dismiss still work; they’ll sync when you reconnect.
            </div>
            <span className="iNDBtn" style={{ maxWidth: 160 }}>Retry</span>
          </div>
          <TriageBar canOpen={false} />
        </div>
      </div>
    );
  }

  const blocking = notifBlocking(n);
  const acted = state === "acted";
  const dismissed = state === "dismissed";

  return (
    <div className="iBody">
      <div className="iND">
        <div className="iNDScroll">
          {/* WHO */}
          <div className="iNDWho">
            <span className="iNDKind" data-block={blocking ? "" : undefined}>
              {NOTIF_KIND_LABEL[n.kind]}
            </span>
            <span className="iNDAgent">{n.agent}</span>
            <span className="iNDMeta">{n.project}</span>
            <span className="iNDAge">{n.age}</span>
          </div>
          <div className="iNDMeta">{n.harness} · {n.sessionName}</div>

          {/* WHAT */}
          <div>
            <div className="iNDTitle">{n.title}</div>
            <div className="iNDSummary" style={{ marginTop: 6 }}>{n.summary}</div>
          </div>

          {/* EVIDENCE */}
          {n.detail && <div className="iNDEvidence">{n.detail}</div>}
          {n.risk && (
            <div className="iNDRisk">
              <span className="iNDRiskLabel">Risk</span>
              <span className="iNDRiskVal" data-high={n.risk === "high" ? "" : undefined}>
                {n.risk}
              </span>
              <span className="iZoneRule" />
            </div>
          )}

          {/* ACT + outcome */}
          {state === "resolved" || state === "offline" ? (
            <ActBlock n={n} state={state} />
          ) : null}

          {acted && (
            <Notice tone="ok" mark="Sent">
              Approved 2s ago — {n.agent} resumed. Nothing else opened.
            </Notice>
          )}
          {state === "handled" && (
            <Notice tone="warn" mark="Done">
              Already handled — approved on studio 2m ago. Nothing left to do here.
            </Notice>
          )}
          {state === "failed" && (
            <Notice tone="err" mark="Failed">
              The decision didn’t reach studio. Your choice is kept — retry when the bridge is back.
            </Notice>
          )}
          {dismissed && (
            <Notice tone="flat" mark="Hidden">
              Dismissed from Needs you. <strong>{n.agent} is still waiting</strong> — this hid the
              alert, it didn’t answer it.
              <span className="iNDUndo">Undo</span>
            </Notice>
          )}

          {/* PROVENANCE */}
          <div className="iNDProv">
            <span>{state === "offline" ? "last read 4m ago" : "resolved from studio · 2s ago"}</span>
            <span className="iNDProvAct">Refresh</span>
          </div>
        </div>

        <TriageBar read={acted || n.readAt != null} dismissed={dismissed} canOpen={state !== "offline"} />
      </div>
    </div>
  );
}

// ── Banner exhibit — triage without launching the app ───────────────────────

/** The lock-screen / banner form. With a `UNNotificationCategory` registered and
 *  `aps.category` passed through the relay, Mark read and Dismiss resolve from
 *  here and the app never opens — the purest expression of "don't force the
 *  destination open". Tapping the body (not an action) lands on the detail page. */
export function NotificationBanner() {
  return (
    <div className="iBody" style={{ padding: "18px 12px", justifyContent: "flex-start" }}>
      <div className="iBanner">
        <div className="iBannerTop">
          <span className="iBannerIcon">S</span>
          <div className="iBannerBody">
            <span className="iBannerTitle">Scout</span>
            <span className="iBannerText">A local agent needs your approval.</span>
          </div>
          <span className="iBannerAge">now</span>
        </div>
        <div className="iBannerActs">
          <span className="iBannerAct">Mark read</span>
          <span className="iBannerAct">Dismiss</span>
          <span className="iBannerAct">Open</span>
        </div>
      </div>
      <p style={{ fontSize: 11, lineHeight: 1.5, color: "var(--i-dim)", margin: "14px 4px 0",
        fontFamily: "var(--i-mono)" }}>
        The body carries no prompt, no command, no path — the payload is correlation
        ids only. “A local agent needs your approval” is generated by the relay
        (apps/mesh-front-door/src/push-relay.ts:778). The specifics resolve on-device.
      </p>
    </div>
  );
}

// ── Flow exhibit — the state machine, on the stage ──────────────────────────

const FLOW: { mark: string; title: string; note: string }[] = [
  { mark: "1", title: "Push lands", note: "Opaque payload: destination + itemId + kind + session/turn/block ids. Nothing readable." },
  { mark: "2", title: "Operator taps the banner", note: "The detail page PUSHES onto the current tab. No tab switch, no conversation opened, back returns you exactly where you were." },
  { mark: "3", title: "Resolve", note: "The page matches itemId against mobile.inbox on every readable Mac. Skeleton while it resolves; a truthful offline state if none answer." },
  { mark: "4a", title: "Act", note: "Approve / Deny / Answer inline. The agent unblocks; the page becomes a receipt and stays put." },
  { mark: "4b", title: "Mark read", note: "Clears unread + decrements the badge. The item stays in Needs you, recessed. The agent is untouched." },
  { mark: "4c", title: "Dismiss", note: "Removes it from Needs you with an Undo. The agent is untouched and STILL BLOCKED — the copy says so." },
  { mark: "4d", title: "Open ↗", note: "The only verb that navigates. Pushes the conversation on top of the detail page; back returns here, then to where you started." },
];

export function NotificationFlow() {
  return (
    <div className="iFlow">
      {FLOW.map((s) => (
        <div className="iFlowStep" key={s.mark}>
          <span className="iFlowMark">{s.mark}</span>
          <div className="iFlowBody">
            <div className="iFlowTitle">{s.title}</div>
            <div className="iFlowNote">{s.note}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
