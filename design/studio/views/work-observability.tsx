"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · Work observability

   The conversation page, re-read as an instrument.

   The complaint that produced this study is small and exact. Open a live
   thread where an agent is mid-run and the page tells you, three times, that
   it is "still working" — and nothing else. It does not say what the agent is
   doing right now, what it has changed, what it is blocked on, or what is
   supposed to happen next. Meanwhile the *chat id* gets a labelled chip of its
   own, and the operator is marked "Observing" over a composer that is fully
   armed.

   That "still working" is not a placeholder someone forgot to finish. It is
   generated: the broker writes `<display name> is still working.` into
   `flight.summary`, and the client falls back to `${agentName} is working on
   your request.` when the summary is empty (conversation-model.ts:649-661,
   743-780). So the page is faithfully rendering a fact that carries no
   information, in the most prominent slot it has, while the records that DO
   carry information sit one fetch away and unrendered.

   ── Second pass: correctness ────────────────────────────────────────────
   The first version of this study led with its best case and filed the real
   one fifth. An independent review (2026-07-25) checked every claim against
   the live broker and found the hero state was a join the broker cannot
   currently make, the staleness rule would have libelled every healthy
   claude/tmux session, and one route in the link row silently targeted
   nothing. Those are exactly the failures this surface exists to prevent, so
   they are fixed here rather than defended:

     · THE LIVE CASE LEADS. `thin records` is the second treatment, directly
       after `before`, because that is what an operator opening this thread
       actually sees today: /api/session-ref/session-mrzq3pgh-ygpw98/touched
       returns `fidelity: "synthetic"`, `counts.changedFiles: 0`, `files: []`.
       Every treatment now declares whether it is LIVE or ILLUSTRATIVE above
       the specimen. A study arguing for honest numbers has to label its own.

     · PRECEDENCE IS A RULE, NOT AN AUTHORING CHOICE. Work and flight disagree
       on the live records — `work.state: "review"` / `nextMoveOwnerId:
       "operator"` against `flight.state: "running"` — and the rail has one
       chip. See `resolveChip()` below: flight governs NOW, work governs NEXT,
       and the chip reads the operator hand-back whenever there is one.

     · STALENESS IS NOT `lastAcknowledgedAt`. On the live flight
       `startedAt === lastAcknowledgedAt` and has not moved since. A rule of
       "no ack for 8m" would flip every healthy claude/tmux flight to *No
       recent update* eight minutes after start and keep it there. Freshness
       is derived from meaningful event flow instead, and when there is no
       event stream the rail says `freshness unknown` rather than `stale` —
       "we cannot see" and "nothing is happening" are different facts and only
       one of them justifies Stop.

     · THE TERMINAL LINK IS WITHDRAWN. `/terminal?agentId=…` is not a working
       target: router.ts:634-671 reads the terminal agent from the PATH
       segment and discards `?agentId`, so the operator would land on the
       default terminal. It stays visible and struck through with the reason
       printed, which is the treatment this study prescribes for every other
       missing affordance.

   ── The proposal in one object ──────────────────────────────────────────
   A WORK RAIL replaces the chat-id row with one calm summary between the
   thread header and the transcript:

     A · identity   what work · who owns it · whose move is next
     B · status     one sentence about now, meaningful progress, and next
     C · controls   Observe · Guide · Details

   The exact session handle, evidence, secondary links, and Stop remain in a
   Details disclosure. Steer and Cue remain distinct delivery contracts, but
   become choices inside Guide instead of competing top-level actions.

   ── The action argument ─────────────────────────────────────────────────
   The five verbs are not five buttons of the same kind, and the shipping page
   collapses them into one composer. They differ on two axes — *what they
   reach* and *when they land*:

     Observe          the exact session      now          read-only*
     Steer this turn  the turn in flight     now          only where the harness has it
     Cue next turn    the invocation         next turn    durable, survives a restart
     Message          the conversation       as a message not a control at all
     Stop run         the session            now          terminal

   * with an asterisk this study is obliged to print: the shipping Observe
   surface is NOT read-only today. Its composer (SessionObserve.tsx:2793-2828)
   carries three meanings behind one box — start a new invocation, write into
   the session, or a read-only trace — which is the same undifferentiated
   write affordance indicted on the conversation composer. Observe earns the
   word "read-only" only after that box is gated or mode-labelled. See the
   handoff.

   The middle two are where the rest of the honesty lives. Codex has a real
   mid-turn steer (`transport.steerTurn(text, turnId)`,
   adapters/codex/adapter.ts:204). Claude Code does not — its adapter writes to
   stdin and the stream-json session serialises turns behind a queue, with the
   comment saying so in as many words: "Claude stream-json has no steer
   primitive; overlapping broker asks cue here." (claude-stream-json.ts:760).
   So on a Claude session, "Steer this turn" IS "Cue next turn" wearing a more
   urgent label. The rail refuses to print that label. Flip the harness control
   below and watch the verb withdraw, with the reason stated where the button
   was.
   ─────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./work-observability.module.css";

/* ══ 1 · MODEL ════════════════════════════════════════════════════════════
   Every field below names the record it is read from. The rule the rail
   enforces: a link is rendered only when the id backing it exists on a
   canonical record. Nothing is assembled from a display name — which is
   exactly how `agentName: "Session Mrzq3pgh Ygpw98"` became a sentence.   */

type Health = "fresh" | "slow" | "stale" | "ended" | "unknown";
type Fidelity = "observed" | "reported" | "synthetic" | "none";
type Harness = "claude" | "codex";

/** FlightState, minus the states this surface never renders on its own. */
type FlightState = "queued" | "waking" | "running" | "completed" | "failed" | "cancelled";
/** WorkItemState. */
type WorkState = "open" | "working" | "waiting" | "review" | "done" | "cancelled";

type ChipState = "running" | "blocked" | "stale" | "done" | "failed" | "queued";

interface ChipInput {
  /** Governs NOW. Null when there is no flight (work exists, nothing running). */
  flightState: FlightState | null;
  /** Governs NEXT. Null when there is no work item — invocation only. */
  workState: WorkState | null;
  /** work.nextMoveOwnerId === "operator". */
  nextMoveIsOperator: boolean;
  /** Derived from event flow, NOT from lastAcknowledgedAt. See FRESHNESS. */
  health: Health;
}

/* ── STATE PRECEDENCE ─────────────────────────────────────────────────────
   Two records answer two different questions and disagree on the live data —
   `work.state: "review"` while `flight.state: "running"`. With one chip and no
   rule, the same operator moment renders Running, Waiting on you or Done
   depending on which record the client happened to read first.

   The rule, in order:
     1. The operator hand-back outranks everything. If work says the next move
        is the operator, the chip says so — an agent still running does not
        make the question waiting on you any less true.
     2. Otherwise a live flight governs, because it is the fact about NOW.
     3. Freshness can only ever downgrade a running flight, never upgrade one.
     4. With no flight, work state stands alone.
   The blocked treatment's "Waiting on you" therefore falls out of the data
   instead of being authored, which is the point.                          */
function resolveChip(input: ChipInput): { state: ChipState; label: string } {
  const { flightState, workState, nextMoveIsOperator, health } = input;

  if (nextMoveIsOperator && workState !== "cancelled") {
    return workState === "review" || workState === "done"
      ? { state: "done", label: "Your review" }
      : { state: "blocked", label: "Waiting on you" };
  }
  if (flightState === "failed" || flightState === "cancelled") {
    return { state: "failed", label: flightState === "failed" ? "Failed" : "Stopped" };
  }
  if (flightState === "queued" || flightState === "waking") {
    return { state: "queued", label: flightState === "queued" ? "Queued" : "Waking" };
  }
  if (flightState === "running") {
    if (health === "stale") return { state: "stale", label: "No recent events" };
    return { state: "running", label: "Running" };
  }
  if (flightState === "completed") return { state: "done", label: "Done" };

  switch (workState) {
    case "waiting": return { state: "blocked", label: "Waiting" };
    case "review": return { state: "done", label: "In review" };
    case "done": return { state: "done", label: "Done" };
    default: return { state: "queued", label: "Open" };
  }
}

/* ── FRESHNESS ────────────────────────────────────────────────────────────
   `lastAcknowledgedAt` is a dispatch receipt, not a heartbeat: on the live
   flight it equals `startedAt` and never advances. Deriving staleness from it
   would mark every long-running claude/tmux session dead eight minutes in.

   Freshness is the age of the last MEANINGFUL EVENT — a displayState update, a
   tool start/finish, a tail event, or `work.lastMeaningfulAt`. Absence
   behaviour is explicit and is its own health, not a synonym for stale:

     fresh    last meaningful event < 2m
     slow     2m – 8m
     stale    > 8m WITH a working event stream — the surface can see, and sees
              nothing. This is the only health that promotes Observe.
     unknown  no event stream for this harness/session at all. The rail must
              not claim staleness it cannot observe.
     ended    session closed; the clock stops rather than decaying.          */
const FRESHNESS_SOURCES =
  "displayState · tool events · tail · work.lastMeaningfulAt";

interface LinkSpec {
  id: string;
  label: string;
  /** Rendered suffix — a count or a short qualifier. */
  count?: string;
  /** The canonical route this resolves to, shown on hover + in the contract. */
  route: string;
  /** Absent id, or no route that consumes it ⇒ rendered struck through, kept
   *  in the tab order, and named with its reason in the withdrawn line. */
  available: boolean;
  reason?: string;
}

interface Cell {
  label: string;
  primary: string;
  /** Italic + dimmed when the record simply does not carry this yet. */
  unknown?: boolean;
  secondary?: string;
  /** Where the number came from, printed under it. */
  evidence?: string;
  fidelity?: Fidelity;
  steps?: { done: number; total: number };
  freshness?: { text: string; health: Health };
}

interface WorkView {
  key: string;
  /** Whether this state is one the live broker returns today. */
  fixture: "live" | "illustrative";
  fixtureNote: string;

  /* The two records, kept apart so the chip can be derived rather than set. */
  flightState: FlightState | null;
  workState: WorkState | null;

  /* Row A — from WorkItemRecord (/api/work) when one exists. */
  workId: string | null;
  title: string;
  ownerName: string;
  nextMoveName: string;
  nextMoveIsOperator: boolean;

  /* The execution handle — flight.sessions[] (FlightSessionTraceEntry). */
  session: {
    id: string;
    harness: Harness;
    transport: string;
    nodeId: string;
    strategy: string;
  } | null;
  priorSessions: number;

  /* Row B. */
  now: Cell;
  progress: Cell;
  next: Cell;
  health: Health;

  /* At most one band, and it never repeats a verb from the row. */
  band?: {
    tone: "attention" | "quiet" | "receipt";
    mark: string;
    text: string;
    meta: string;
    /** Only verbs the row does not have. Zero is a valid answer. */
    actions?: { id: string; label: string; promoted?: boolean }[];
  };

  /* Row C. One promotion per state, chosen by the state — never two, and
     never while running. */
  promote: "observe" | "answer" | "accept" | null;
  observe: LinkSpec;
  canStop: boolean;
  closed: boolean;
  links: LinkSpec[];

  invocationId: string | null;
  conversationId: string;
  /** The one-sentence spoken form; see .srOnly in the stylesheet. */
  spoken: string;
}

/* ══ 2 · FIXTURES ═════════════════════════════════════════════════════════
   Ids, shapes and vocabulary are lifted from the live broker on this machine.
   Two of the states below are what it returns RIGHT NOW; the rest are states
   it can produce but is not producing on this thread, and they say so above
   the specimen.                                                            */

const CONVERSATION_ID = "chn-d13f9c0ebaaa4b48b6ed69d214a4a24f";
const INVOCATION_ID = "inv-mrzqicv3-9bvpl9";
const FLIGHT_ID = "flt-mrzqicv4-887pgd";
const SESSION_ID = "session-mrzq3pgh-ygpw98";
const WORK_ID = "work-mrz6yfrb-ssezi2";

const LIVE_SESSION = {
  id: SESSION_ID,
  harness: "claude" as Harness,
  transport: "tmux",
  nodeId: "arts-mac-mini-local-openscout",
  strategy: "steer",
};

/* The observer route is real and already addressable:
   /flights/:flightId/observe?session=:sessionId (router.ts:469, :774). Today it
   is reachable only by going out to the flight, so the rail surfaces it where
   the session is named. */
function observeLink(sessionId: string | null, flightId: string | null): LinkSpec {
  if (!flightId) {
    return {
      id: "observe",
      label: "Observe",
      route: "—",
      available: false,
      reason: "no flight record on this invocation yet",
    };
  }
  return {
    id: "observe",
    label: "Observe",
    route: sessionId
      ? `/flights/${flightId}/observe?session=${sessionId}`
      : `/flights/${flightId}/observe`,
    available: true,
    reason: sessionId ? undefined : "flight-level view — no session pinned yet",
  };
}

const SECONDARY_LINKS = (o: {
  files?: number;
  work?: boolean;
  pr?: string | null;
}): LinkSpec[] => [
  {
    id: "project",
    label: "project",
    count: "openscout",
    route: "/repos?root=/Users/art/dev/openscout",
    available: true,
  },
  {
    id: "diff",
    label: "diff",
    count: o.files ? `${o.files}` : undefined,
    route: `/repo-diff?path=/Users/art/dev/openscout&sessionId=${SESSION_ID}`,
    available: Boolean(o.files),
    reason: o.files ? undefined : "touched/v1 is synthetic with 0 files for this session",
  },
  { id: "logs", label: "logs", route: "/activity", available: true },
  {
    /* Withdrawn everywhere, not conditionally: there is no route that takes a
       session to its pane. `/terminal?agentId=…` looks like one and is not —
       router.ts:634-671 parses the terminal agent out of the path segment and
       drops the query param, so the operator lands on the default terminal.
       (It would also be passing a SESSION id into a parameter named agentId.)
       Withdraw it until a canonical route exists, rather than shipping the one
       failure mode this whole surface argues against. */
    id: "terminal",
    label: "terminal",
    route: "—",
    available: false,
    reason: "no canonical route — /terminal reads its agent from the path, not ?agentId (router.ts:634-671)",
  },
  { id: "session", label: "session", route: `/sessions/${SESSION_ID}`, available: true },
  {
    id: "work",
    label: "work",
    route: `/work/${WORK_ID}`,
    available: o.work !== false,
    reason: o.work === false ? "no work item — invocation only" : undefined,
  },
  {
    id: "pr",
    label: o.pr ?? "PR",
    route: o.pr ? `https://github.com/…/pull/${o.pr.replace("#", "")}` : "—",
    available: Boolean(o.pr),
    reason: o.pr ? undefined : "no artifact recorded on this work item",
  },
];

/* ── The live case. This is what the reference thread renders today. ───── */
const THIN: WorkView = {
  key: "thin",
  fixture: "live",
  fixtureNote:
    "Matches the broker on this machine right now: flight flt-mrzqicv4-887pgd is `running` with collaborationRecordId: null, and /api/session-ref/session-mrzq3pgh-ygpw98/touched returns fidelity: \"synthetic\", changedFiles: 0, files: [].",
  flightState: "running",
  workState: null,
  workId: null,
  title: "Wire the alias dereference into the CLI resolver",
  ownerName: "openscout-turing-6",
  nextMoveName: "openscout-turing-6",
  nextMoveIsOperator: false,
  session: LIVE_SESSION,
  priorSessions: 1,
  health: "unknown",
  now: {
    label: "Now",
    primary: "Working",
    unknown: true,
    secondary: "harness emits no display state",
    freshness: { text: "freshness unknown — no event stream", health: "unknown" },
    evidence: "sessionTrace only · no events.displayState",
    fidelity: "reported",
  },
  progress: {
    label: "Progress",
    primary: "Not measured",
    unknown: true,
    secondary: "0 files recorded",
    evidence: "touched/v1 · fidelity synthetic",
    fidelity: "synthetic",
  },
  next: {
    label: "Next",
    primary: "Not declared",
    unknown: true,
    secondary: "no work item, no task list",
    evidence: "flight.collaborationRecordId is null",
    fidelity: "none",
  },
  band: {
    tone: "quiet",
    mark: "Thin",
    text: "This invocation has no work item, so there is no declared next step and no acceptance to hand back. The title is the invocation task.",
    meta: "flight.collaborationRecordId: null · inventory confidence: low · the join has to be written at dispatch, not inferred here",
  },
  promote: null,
  observe: observeLink(SESSION_ID, FLIGHT_ID),
  canStop: true,
  closed: false,
  links: SECONDARY_LINKS({ files: 0, pr: null, work: false }),
  invocationId: INVOCATION_ID,
  conversationId: CONVERSATION_ID,
  spoken:
    "Running. Wire the alias dereference into the CLI resolver, from the invocation task — no work item. Freshness unknown: this harness emits no event stream. Progress is not measured and no next step is declared.",
};

/* ── The illustrative best case: every record populated. ────────────────── */
const RUNNING: WorkView = {
  key: "running",
  fixture: "illustrative",
  fixtureNote:
    "Authored. Requires a join the broker does not make today (flight.collaborationRecordId is null on the reference flight) and a touched/v1 record with fidelity: \"observed\", which this session does not have. Shown to specify the target, not to report the present.",
  flightState: "running",
  workState: "working",
  workId: WORK_ID,
  title: "Independent review of PR #453",
  ownerName: "openscout-turing-6",
  nextMoveName: "openscout-turing-6",
  nextMoveIsOperator: false,
  session: LIVE_SESSION,
  priorSessions: 1,
  health: "fresh",
  now: {
    label: "Now",
    primary: "Reading the branch diff",
    secondary: "Bash · git diff d8dcb9b…HEAD",
    freshness: { text: "last event 12s ago", health: "fresh" },
    evidence: "displayState.activeTools · phase running",
    fidelity: "observed",
  },
  progress: {
    label: "Progress",
    primary: "7 files read · 0 written",
    secondary: "checks 2/4 green",
    evidence: "touched/v1 · fidelity observed",
    fidelity: "observed",
    steps: { done: 2, total: 5 },
  },
  next: {
    label: "Next",
    primary: "Post review verdict",
    secondary: "step 3 of 5 · then → you",
    evidence: "displayState.tasks[in_progress]",
    fidelity: "reported",
  },
  promote: null,
  observe: observeLink(SESSION_ID, FLIGHT_ID),
  canStop: true,
  closed: false,
  links: SECONDARY_LINKS({ files: 7, pr: "#453" }),
  invocationId: INVOCATION_ID,
  conversationId: CONVERSATION_ID,
  spoken:
    "Running. Independent review of PR #453, owned by openscout-turing-6 on session-mrzq3pgh-ygpw98. Now reading the branch diff, last event 12 seconds ago. 7 files read, 2 of 4 checks green. Next: post review verdict, step 3 of 5.",
};

const BLOCKED: WorkView = {
  ...RUNNING,
  key: "blocked",
  fixture: "illustrative",
  fixtureNote:
    "Authored, but the chip is not: with work.nextMoveOwnerId = \"operator\" and work.state = \"waiting\", resolveChip() returns \"Waiting on you\" from the records alone, even though the flight is still running.",
  workState: "waiting",
  nextMoveName: "Arach",
  nextMoveIsOperator: true,
  health: "slow",
  now: {
    label: "Now",
    primary: "Paused — asked a question",
    secondary: "no active tool",
    freshness: { text: "no events for 4m — waiting", health: "slow" },
    evidence: "displayState.attention[question]",
    fidelity: "observed",
  },
  progress: {
    ...RUNNING.progress,
    primary: "7 files read · 1 written",
    secondary: "checks 2/4 green · held",
  },
  next: {
    label: "Next",
    primary: "Your answer unblocks step 4",
    secondary: "then → openscout-turing-6",
    evidence: "collaboration.waitingOn{kind: actor}",
    fidelity: "reported",
  },
  band: {
    tone: "attention",
    mark: "Blocked",
    text: "Should the profile-in-leading-position case fall back to the reserved namespace, or hard-fail? Both are defensible; the tests assume the first.",
    meta: "question · asked 4m ago · work-mrz6yfrb-ssezi2 · nothing else is queued behind this",
    /* Answer is genuinely a fifth verb, and Hand off is a sixth. "Defer to next
       turn" was Cue wearing another name and is gone: the band carries what the
       row cannot, and nothing else. */
    actions: [
      { id: "answer", label: "Answer", promoted: true },
      { id: "handoff", label: "Hand to another agent" },
    ],
  },
  promote: "answer",
  spoken:
    "Waiting on you. Independent review of PR #453 paused four minutes ago on a question about namespace fallback. Answering unblocks step 4.",
};

const STALE: WorkView = {
  ...RUNNING,
  key: "stale",
  fixture: "illustrative",
  fixtureNote:
    "Authored, and only reachable once event flow exists: this health requires a WORKING event stream that has gone quiet. A session with no stream at all is `unknown`, not stale — see the thin records treatment.",
  health: "stale",
  now: {
    label: "Now",
    primary: "Unknown",
    unknown: true,
    secondary: "last seen: Bash · bun test packages/protocol",
    freshness: { text: "no events for 14m", health: "stale" },
    evidence: `${FRESHNESS_SOURCES} — all quiet`,
    fidelity: "reported",
  },
  progress: {
    label: "Progress",
    primary: "7 files read · 1 written",
    secondary: "checks 2/4 green",
    evidence: "as of 14m ago — not current",
    fidelity: "reported",
    steps: { done: 2, total: 5 },
  },
  next: {
    label: "Next",
    primary: "Unknown",
    unknown: true,
    secondary: "last known: run the protocol suite",
    evidence: "no task update since 14m",
    fidelity: "none",
  },
  band: {
    tone: "quiet",
    mark: "Quiet",
    /* No buttons. Observe and Stop are both already in the row directly below,
       and promoting Observe in two places at once is two lime primaries for one
       action. The band explains; the row acts. */
    text: "The event stream is alive but has produced nothing for 14 minutes. That is different from a session Scout cannot see: this one it can, and there is nothing there.",
    meta: "flight still `running` · last meaningful event 14m ago · Observe is promoted in the row below",
  },
  promote: "observe",
  spoken:
    "No recent events. The stream has been quiet for fourteen minutes; current action is unknown. Last seen running the protocol test suite.",
};

const COMPLETED: WorkView = {
  ...RUNNING,
  key: "completed",
  fixture: "illustrative",
  fixtureNote:
    "Authored. Note the chip: work.state = \"review\" with acceptanceState \"pending\" and nextMoveOwnerId \"operator\", so resolveChip() reads the hand-back rather than the flight's `completed`.",
  flightState: "completed",
  workState: "review",
  nextMoveName: "Arach",
  nextMoveIsOperator: true,
  health: "ended",
  now: {
    label: "Ran for",
    primary: "18m 42s",
    secondary: "ended 6m ago",
    freshness: { text: "session closed", health: "ended" },
    evidence: "sessionTrace.startedAt → endedAt",
    fidelity: "observed",
  },
  progress: {
    label: "Produced",
    primary: "9 files · +214 / −38",
    secondary: "checks 4/4 green",
    evidence: "touched/v1 · fidelity observed",
    fidelity: "observed",
    steps: { done: 5, total: 5 },
  },
  next: {
    label: "Next",
    primary: "Your review",
    secondary: "acceptance pending since 6m",
    evidence: "work.acceptanceState pending",
    fidelity: "observed",
  },
  band: {
    tone: "receipt",
    mark: "Result",
    text: "Reviewed PR #453 against merge-base d8dcb9b. Three findings, one blocking: the reserved-profile namespace collapses onto a guessed --to label. No file edits — @codex holds this tree.",
    meta: "invocation completed · 18m 42s · output 4.1 kB · work state review, acceptance pending",
  },
  promote: "accept",
  canStop: false,
  closed: true,
  links: SECONDARY_LINKS({ files: 9, pr: "#453" }),
  spoken:
    "Your review. Independent review of PR #453 finished 6 minutes ago after 18 minutes 42 seconds. 9 files, all 4 checks green. Awaiting your acceptance.",
};

const VIEWS: Record<string, WorkView> = {
  thin: THIN,
  running: RUNNING,
  blocked: BLOCKED,
  stale: STALE,
  completed: COMPLETED,
};

/* ══ 3 · TREATMENTS ═══════════════════════════════════════════════════════ */

interface Treatment {
  id: string;
  label: string;
  note: React.ReactNode;
}

const TREATMENTS: Treatment[] = [
  {
    id: "before",
    label: "Before · shipping",
    note: (
      <>
        <strong>The control, reproduced from the shipping components and the
        live thread.</strong> Three identity chips and zero work facts: an agent
        pill, a <em>session</em> pill, an <em>Observing</em> marker
        (ConversationHeader.tsx:111-207), and under them a row whose label is the
        literal string <code>&quot;Chat ID&quot;</code> —{" "}
        <code>conversationIdentityLabel()</code> returns it unconditionally
        (conversation-model.ts:827-829). Then the presence strip:{" "}
        <code>label: &quot;Working&quot;</code> plus{" "}
        <code>flight.summary</code>, which the broker filled with{" "}
        <code>&quot;Session Mrzq3pgh Ygpw98 is still working.&quot;</code>; the
        transcript&apos;s working card says it again; and{" "}
        <code>showTyping: true</code> says it a third time. Three restatements of
        one bit, three spellings of one identity, and not one fact about the
        work. The operator is marked <em>Observing</em> while the composer stays
        fully armed, so the page asserts a role it does not enforce. Nothing here
        is broken; it is all rendering correctly. It just answers no question an
        operator has.
      </>
    ),
  },
  {
    id: "thin",
    label: "After · thin records (live)",
    note: (
      <>
        <strong>This is what the reference thread actually renders today, and it
        leads for that reason.</strong> No work item — so the title falls back to{" "}
        <code>invocation.task</code> and the rail says so; a harness with no{" "}
        <code>events.displayState</code>; and{" "}
        <code>touched/v1</code> returning <code>fidelity: &quot;synthetic&quot;</code>{" "}
        with zero files. All three are live responses from this machine.
        <br />
        The rail keeps its shape and empties the cells rather than collapsing to a
        spinner: <em>not measured</em>, <em>not declared</em>, each with the
        reason underneath. Freshness reads <em>unknown</em>, not <em>stale</em> —
        the surface cannot see this session, which is a different claim from
        seeing it idle, and only the second one would justify Stop. Withdrawn
        links stay visible, struck through, and are named with their reasons in
        the line below the row, so a missing affordance is debuggable rather than
        absent. What survives is what is always true: the session id is known, so{" "}
        <em>Observe</em> works.
      </>
    ),
  },
  {
    id: "running",
    label: "After · running (illustrative)",
    note: (
      <>
        <strong>The target, once the records are populated.</strong> It is filed
        after the live case deliberately: it needs a work↔flight join the broker
        does not make today (<code>collaborationRecordId</code> is{" "}
        <code>null</code> on the reference flight) and a touched record with{" "}
        <code>fidelity: observed</code>. Read top-down and the five-second pass
        lands: <em>what</em> (the work title, from <code>work.title</code> — not
        the chat id, which moves to a copy affordance on the session strip),{" "}
        <em>who</em>, <em>where</em> (the exact session, harness, transport,
        node), <em>now</em> / <em>progress</em> / <em>next</em> as three parallel
        cells, then the verbs. Each cell prints its own provenance so a number can
        be distrusted specifically rather than the page distrusted generally. The
        accent is spent once, on the live pulse: no verb is promoted while an
        agent is running, because a running agent is not a reason to nudge the
        operator toward a control.
      </>
    ),
  },
  {
    id: "blocked",
    label: "After · blocked",
    note: (
      <>
        <strong>The only state allowed to raise its voice — and the chip is
        derived, not authored.</strong> <code>work.nextMoveOwnerId ===
        &quot;operator&quot;</code> outranks the still-running flight in{" "}
        <code>resolveChip()</code>, so <em>Waiting on you</em> falls out of the
        records. The band carries the actual question — not &quot;agent has a
        question&quot; — plus what it costs (<em>answering unblocks step 4</em>)
        and what it does not (<em>nothing else is queued behind this</em>). It
        offers only verbs the row lacks: <em>Answer</em> and <em>Hand to another
        agent</em>. <em>Defer to next turn</em> was Cue under another name and is
        gone. One promotion, and it is Answer.
      </>
    ),
  },
  {
    id: "stale",
    label: "After · quiet stream",
    note: (
      <>
        <strong>Renamed, and re-grounded.</strong> The first version keyed this
        off <code>lastAcknowledgedAt</code>, which on the live flight equals{" "}
        <code>startedAt</code> and never advances — a rule that would have flipped
        every healthy claude/tmux session to &quot;No recent update&quot; eight
        minutes after start and left it there, promoting Observe and muttering
        about a dead tmux pane at a session that was fine. Staleness now comes
        from meaningful event flow, and it requires a stream that <em>exists</em>:
        no stream is <code>unknown</code> (the thin treatment), a quiet stream is{" "}
        <code>stale</code> (this one). PROGRESS keeps its numbers but stamps them{" "}
        <em>as of 14m ago — not current</em>. The band has no buttons: Observe is
        promoted once, in the row, rather than cloned in lime twice.
      </>
    ),
  },
  {
    id: "completed",
    label: "After · done",
    note: (
      <>
        <strong>The rail becomes a receipt and stays put.</strong> The three cells
        re-label rather than empty — <em>ran for</em> / <em>produced</em> /{" "}
        <em>next</em> — so the same geometry reads as history. Live verbs withdraw
        and are replaced by the ones that still mean something. The chip reads{" "}
        <em>Your review</em> rather than <em>Done</em>, because{" "}
        <code>acceptanceState: &quot;pending&quot;</code> with the next move on the
        operator is the fact that outranks the flight&apos;s completion — losing
        track of that is the failure this surface is for. Accent discipline on a
        surface where nothing is live: the chip dot and <em>next you</em> are
        neutral, and the single lime goes to <em>Accept</em>.
      </>
    ),
  },
];

/* ══ 4 · THE RAIL ═════════════════════════════════════════════════════════ */

function MeterCell({ cell }: { cell: Cell }) {
  return (
    <div className={styles.cell}>
      <div className={styles.cellLabel}>{cell.label}</div>
      <div className={styles.cellPrimary} data-unknown={cell.unknown ? "true" : undefined}>
        {cell.primary}
      </div>
      {cell.secondary ? <div className={styles.cellSecondary}>{cell.secondary}</div> : null}
      {cell.steps ? (
        <div
          className={styles.steps}
          role="img"
          aria-label={`step ${Math.min(cell.steps.done + 1, cell.steps.total)} of ${cell.steps.total}`}
        >
          {Array.from({ length: cell.steps.total }, (_, i) => (
            <span
              key={i}
              className={styles.step}
              data-done={i < cell.steps!.done ? "true" : undefined}
              data-current={i === cell.steps!.done ? "true" : undefined}
            />
          ))}
        </div>
      ) : null}
      {cell.freshness ? (
        <div className={styles.freshness} data-health={cell.freshness.health}>
          <span className={styles.liveDot} aria-hidden="true" />
          {cell.freshness.text}
        </div>
      ) : null}
      {cell.evidence ? (
        <div className={styles.evidence} data-fidelity={cell.fidelity}>
          {cell.evidence}
        </div>
      ) : null}
    </div>
  );
}

function Verb({
  label,
  glyph,
  keyHint,
  keyShortcut,
  promoted,
  danger,
  withdrawn,
  title,
  describedBy,
  expanded,
  onActivate,
}: {
  label: string;
  glyph: string;
  keyHint?: string;
  keyShortcut?: string;
  promoted?: boolean;
  danger?: boolean;
  withdrawn?: boolean;
  title?: string;
  describedBy?: string;
  expanded?: boolean;
  onActivate?: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.verb}
      data-variant={promoted ? "primary" : danger ? "danger" : undefined}
      /* aria-disabled, not disabled: a withdrawn verb stays focusable so its
         reason is reachable by keyboard. */
      aria-disabled={withdrawn || undefined}
      aria-keyshortcuts={keyShortcut}
      aria-describedby={describedBy}
      aria-expanded={expanded}
      title={title}
      onClick={withdrawn ? undefined : onActivate}
    >
      <span className={styles.verbGlyph} aria-hidden="true">
        {glyph}
      </span>
      {label}
      {keyHint ? (
        <span className={styles.verbKey} aria-hidden="true">
          {keyHint}
        </span>
      ) : null}
    </button>
  );
}

function WorkRail({
  view,
  harness,
  open,
  setOpen,
  echo,
  onEcho,
}: {
  view: WorkView;
  harness: Harness;
  open: boolean;
  setOpen: (v: boolean) => void;
  echo: { verb: string; target: string } | null;
  onEcho: (verb: string, target: string) => void;
}) {
  /* The steer gate. `session.steer` in HarnessFeatureSupportMap is the
     declared contract; codex/adapter.ts:204 and claude-stream-json.ts:760 are
     the implementations behind it. A harness with no mid-turn primitive must
     not be offered a button that silently becomes a queue. */
  const canSteerNow = harness === "codex";
  const [guideOpen, setGuideOpen] = useState(
    () => seed("guide", ["0", "1"] as const, "0") === "1",
  );
  const [guideDelivery, setGuideDelivery] = useState<"this" | "next">("next");

  useEffect(() => {
    if (!canSteerNow) setGuideDelivery("next");
  }, [canSteerNow]);

  const chip = resolveChip({
    flightState: view.flightState,
    workState: view.workState,
    nextMoveIsOperator: view.nextMoveIsOperator,
    health: view.health,
  });

  const withdrawnLinks = view.links.filter((l) => !l.available);
  const attention = view.band?.tone === "attention";

  return (
    <section
      className={styles.rail}
      aria-label="Work status"
      data-treatment={view.key}
      data-open={open ? "true" : "false"}
      data-attention={attention ? "true" : undefined}
    >
      <p className={styles.srOnly}>{view.spoken}</p>

      {/* ── A · identity — never collapses ───────────────────────────── */}
      <div className={styles.railIdentity}>
        <span className={styles.stateChip} data-state={chip.state}>
          <span className={styles.pulse} aria-hidden="true" />
          {chip.label}
        </span>
        <div className={styles.identityText}>
          <h2 className={styles.workTitle} data-derived={view.workId ? undefined : "task"}>
            {view.title}
            {view.workId ? null : <span className={styles.titleSource}>from task</span>}
          </h2>
          <div className={styles.ownership}>
            <button type="button" className={styles.ownerChip}>
              {view.ownerName}
            </button>
            <span className={styles.sep}>owns it</span>
            {/* The hand-back is only worth a slot when it is a hand-back. An
                agent that owns the next move as well as the work is the
                default case, and printing its name twice would be the same
                mistake as saying "still working" three times. */}
            {view.nextMoveIsOperator || view.nextMoveName !== view.ownerName ? (
              <>
                <span className={styles.sep}>·</span>
                <span
                  className={styles.nextMove}
                  data-you={view.nextMoveIsOperator ? "true" : undefined}
                  data-blocking={chip.state === "blocked" ? "true" : undefined}
                >
                  <span className={styles.arrow} aria-hidden="true">
                    next
                  </span>
                  {view.nextMoveIsOperator ? "you" : view.nextMoveName}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* One sentence in the default view. Unknown fields do not earn slots. */}
      <div className={styles.statusSentence}>
        <strong>{view.now.primary}</strong>
        {view.now.freshness ? <span>{view.now.freshness.text}</span> : null}
        {!view.progress.unknown ? <span>{view.progress.primary}</span> : null}
        {!view.next.unknown ? <span>Next: {view.next.primary}</span> : null}
      </div>

      {/* ── At most ONE band. It carries only what the row cannot. ───── */}
      {view.band ? (
        <div className={view.band.tone === "receipt" ? styles.receipt : styles.blocker}>
          <span
            className={
              view.band.tone === "receipt" ? styles.receiptMark : styles.blockerMark
            }
            data-tone={view.band.tone}
          >
            {view.band.mark}
          </span>
          <div className={styles.blockerBody}>
            <p className={styles.blockerText}>{view.band.text}</p>
            <div className={styles.blockerMeta}>{view.band.meta}</div>
            {view.band.actions?.length ? (
              <div className={styles.blockerActions}>
                {view.band.actions.map((a) => (
                  <Verb
                    key={a.id}
                    label={a.label}
                    glyph="→"
                    promoted={a.promoted}
                    onActivate={() => onEcho(a.label, `work/${WORK_ID}`)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── C · three concepts, not a row of transport primitives ────── */}
      <div className={styles.actionBar}>
        <div className={styles.verbs}>
          <Verb
            label="Observe"
            glyph="◉"
            keyHint="O"
            keyShortcut="o"
            promoted={view.promote === "observe"}
            withdrawn={!view.observe.available}
            describedBy={!view.observe.available ? `${view.key}-observe-why` : undefined}
            title={view.observe.available ? view.observe.route : view.observe.reason}
            onActivate={() => onEcho("Observe", view.observe.route)}
          />
          {!view.closed ? (
            <Verb
              label="Guide"
              glyph="↗"
              expanded={guideOpen}
              title="Give the agent direction, with an explicit delivery time"
              onActivate={() => setGuideOpen(!guideOpen)}
            />
          ) : (
            <>
              <Verb
                label="Accept"
                glyph="✓"
                promoted={view.promote === "accept"}
                onActivate={() => onEcho("Accept", `work/${WORK_ID} · acceptanceState → accepted`)}
              />
              <Verb
                label="Reopen"
                glyph="↺"
                onActivate={() => onEcho("Reopen", `work/${WORK_ID} · state → working`)}
              />
            </>
          )}
        </div>
        <button
          type="button"
          className={styles.detailsButton}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Details <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
      </div>

      {guideOpen && !view.closed ? (
        <div className={styles.guidePanel}>
          <div className={styles.guideInput}>Give the agent a clear direction…</div>
          <div className={styles.guideDelivery} aria-label="Guide delivery">
            {canSteerNow ? (
              <button
                type="button"
                aria-pressed={guideDelivery === "this"}
                onClick={() => setGuideDelivery("this")}
              >
                This turn
              </button>
            ) : null}
            <button
              type="button"
              aria-pressed={guideDelivery === "next"}
              onClick={() => setGuideDelivery("next")}
            >
              Next turn
            </button>
          </div>
          <button
            type="button"
            className={styles.guideSend}
            onClick={() =>
              onEcho(
                guideDelivery === "this" ? "Guide this turn" : "Guide next turn",
                guideDelivery === "this"
                  ? `session ${SESSION_ID} · live turn`
                  : `invocation ${INVOCATION_ID}`,
              )
            }
          >
            Send
          </button>
          <p className={styles.guideNote}>
            {canSteerNow
              ? guideDelivery === "this"
                ? "Delivered to the turn in progress."
                : "Queued durably for the next turn."
              : "Claude delivers guidance at the next turn boundary."}
          </p>
        </div>
      ) : null}

      {open ? (
        <div className={styles.detailsPanel}>
          <div className={styles.meter}>
            <MeterCell cell={view.now} />
            <MeterCell cell={view.progress} />
            <MeterCell cell={view.next} />
          </div>

          {view.session ? (
            <div className={styles.sessionStrip}>
              <button
                type="button"
                className={styles.sessionId}
                title="Copy session id"
                onClick={() => onEcho("Copy session id", view.session!.id)}
              >
                {view.session.id}
              </button>
              <span className={styles.sessionFact}>
                <em>{harness}</em> · {view.session.transport} @ {view.session.nodeId}
              </span>
              <span className={styles.sessionFact}>
                dispatch <em>{view.session.strategy}</em>
              </span>
              {view.priorSessions > 0 ? (
                <span className={styles.sessionPrior}>
                  +{view.priorSessions} earlier session
                  {view.priorSessions === 1 ? "" : "s"} on this work
                </span>
              ) : null}
            </div>
          ) : null}

          <div className={styles.detailActions}>
            <div className={styles.links}>
              {view.links.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={styles.link}
                  aria-disabled={!l.available || undefined}
                  aria-describedby={!l.available ? `${view.key}-${l.id}-why` : undefined}
                  title={l.available ? l.route : l.reason}
                  onClick={l.available ? () => onEcho(l.label, l.route) : undefined}
                >
                  {l.label}
                  {l.count ? <span className={styles.linkCount}>{l.count}</span> : null}
                </button>
              ))}
            </div>
            {view.canStop ? (
              <Verb
                label="Stop run"
                glyph="■"
                keyHint="⌥."
                keyShortcut="Alt+."
                danger
                title="Ends this invocation — resolves to `cancelled`, not idle"
                onActivate={() =>
                  onEcho("Stop run", `invocation ${INVOCATION_ID} → cancelled`)
                }
              />
            ) : null}
            {withdrawnLinks.length ? (
              <p className={styles.withdrawn}>
                Withdrawn —{" "}
                {withdrawnLinks.map((l, i) => (
                  <span key={l.id} id={`${view.key}-${l.id}-why`}>
                    <b>{l.label}</b>: {l.reason}
                    {i < withdrawnLinks.length - 1 ? " · " : ""}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The keyboard echo — proof the printed chips are bound. */}
      {echo ? (
        <div className={styles.keyEcho} role="status">
          <span className={styles.keyEchoVerb}>{echo.verb}</span>
          <span className={styles.keyEchoTarget}>→ {echo.target}</span>
        </div>
      ) : null}

    </section>
  );
}

/* ══ 5 · THE BEFORE SPECIMEN ══════════════════════════════════════════════
   Corrected against the live thread: the shipping header carries an agent
   pill, a SESSION pill and the Observing marker — three spellings of identity
   — above the Chat ID row. The real page is a stronger version of the same
   argument than the first draft of this specimen gave it.                  */

function BeforeSurface() {
  return (
    <>
      <div className={styles.beforeHeader}>
        <span className={styles.beforeTitle}>Session Mrzq3pgh Ygpw98</span>
        <div className={styles.beforeParticipants}>
          <span className={styles.beforePill}>
            <span className={styles.turnAvatar} style={{ width: 16, height: 16 }}>
              O
            </span>
            Openscout
            <span style={{ opacity: 0.6, marginLeft: 4 }}>claude</span>
          </span>
          <span className={`${styles.beforePill} ${styles.beforePillMono}`}>
            session-ms0xy5r0-sz3q3y
          </span>
          <span className={styles.beforeObserver}>
            ◉ Observing
            <span className={styles.flag}>role not enforced</span>
          </span>
        </div>
      </div>

      <div className={styles.beforeIdRow}>
        <span className={styles.beforeIdLabel}>Chat ID</span>
        <span className={styles.beforeIdChip}>chn-d75d07…670670d</span>
        <span className={styles.flag}>3rd identity · 0 work facts</span>
      </div>

      <div className={styles.beforeStatus}>
        <span className={styles.beforeStatusLabel}>Working</span>
        <span className={styles.beforeStatusDetail}>
          Session Mrzq3pgh Ygpw98 is still working.
        </span>
        <span className={styles.flag}>says it 1 / 3</span>
      </div>

      <div className={styles.transcript}>
        <div className={styles.turn}>
          <div className={styles.turnAvatar}>A</div>
          <div className={styles.turnBody}>
            <div className={styles.turnHead}>
              <span className={styles.turnName}>Arach</span>
              <span className={styles.turnTime}>19:34</span>
            </div>
            <p className={styles.turnText}>
              Review PR #453 against the merge base — I care most about the
              routing semantics.
            </p>
          </div>
        </div>
        <div className={styles.turn}>
          <div className={styles.turnAvatar}>S</div>
          <div className={styles.turnBody}>
            <div className={styles.workingCard}>
              <div className={styles.workingKind}>
                Working
                <span className={styles.flag}>says it 2 / 3</span>
              </div>
              <p className={styles.workingText}>
                Session Mrzq3pgh Ygpw98 is still working.
              </p>
            </div>
            {/* `showTyping: true` on every working presence tone
                (conversation-model.ts:743-780) — so the same bit gets a third
                animated restatement under the card that just stated it. */}
            <div className={styles.typing}>
              <span className={styles.typingDots} aria-hidden="true">
                • • •
              </span>
              Session Mrzq3pgh Ygpw98 is typing
              <span className={styles.flag}>says it 3 / 3</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.composer}>
        <div className={styles.composerBox}>
          <span className={styles.composerInput}>
            Message Session Mrzq3pgh Ygpw98…
          </span>
          <span className={styles.flag}>armed while &quot;observing&quot;</span>
          <span className={styles.composerSend}>Send</span>
        </div>
      </div>
    </>
  );
}

/* ══ 6 · THE AFTER SPECIMEN ═══════════════════════════════════════════════ */

function AfterSurface({
  view,
  harness,
  open,
  setOpen,
  echo,
  onEcho,
}: {
  view: WorkView;
  harness: Harness;
  open: boolean;
  setOpen: (v: boolean) => void;
  echo: { verb: string; target: string } | null;
  onEcho: (verb: string, target: string) => void;
}) {
  return (
    <>
      <div className={styles.appTop}>
        <span className={styles.appBack}>‹</span>
        <span className={styles.appCrumb}>openscout · #453 review</span>
        <span className={styles.appSpacer} />
        <span className={styles.appBack}>⋯</span>
      </div>

      <WorkRail
        view={view}
        harness={harness}
        open={open}
        setOpen={setOpen}
        echo={echo}
        onEcho={onEcho}
      />

      <div className={styles.transcript}>
        <div className={styles.turn}>
          <div className={styles.turnAvatar}>A</div>
          <div className={styles.turnBody}>
            <div className={styles.turnHead}>
              <span className={styles.turnName}>Arach</span>
              <span className={styles.turnTime}>19:34</span>
            </div>
            {/* The ask lives HERE, as the first message, which is
                why the rail does not repeat it. See the provenance section. */}
            <p className={styles.turnText}>
              Review PR #453 against the merge base — I care most about the
              routing semantics.
            </p>
          </div>
        </div>
        <div className={styles.turn}>
          <div className={styles.turnAvatar}>T</div>
          <div className={styles.turnBody}>
            <div className={styles.turnHead}>
              <span className={styles.turnName}>openscout-turing-6</span>
              <span className={styles.turnTime}>19:37</span>
            </div>
            <p className={styles.turnText}>
              Fetched the branch, not checking out — codex holds this tree. Two
              namespaces that must not collapse into a guessed <code>--to</code>{" "}
              label; walking the resolver now.
            </p>
          </div>
        </div>
      </div>

      <div className={styles.composer}>
        <div className={styles.composerMode}>
          <span className={styles.composerModeTag}>Message</span>
          <span className={styles.composerModeHint}>
            {view.closed
              ? "goes to the thread — the session is closed"
              : "goes to the thread, not to the run. To reach the run, use Guide above."}
          </span>
        </div>
        <div className={styles.composerBox}>
          <span className={styles.composerInput}>Message the thread…</span>
          <span className={styles.composerSend}>Send</span>
        </div>
      </div>
    </>
  );
}

/* ══ 7 · PAGE ═════════════════════════════════════════════════════════════ */

/** Treatments are deep-linkable — `?t=blocked&theme=light&harness=codex&w=narrow`
 *  — matching the `?skin=` convention the macOS scout studies already use. It
 *  makes a specific state citable in a review thread, and screenshottable
 *  without a click script. */
function seed<T extends string>(param: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const v = new URLSearchParams(window.location.search).get(param);
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export default function WorkObservabilityStudy() {
  const [treatment, setTreatment] = useState(() =>
    seed("t", TREATMENTS.map((t) => t.id), "thin"),
  );
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    seed("theme", ["dark", "light"] as const, "dark"),
  );
  const [harness, setHarness] = useState<Harness>(() =>
    seed("harness", ["claude", "codex"] as const, "claude"),
  );
  const [width, setWidth] = useState<"full" | "narrow">(() =>
    seed("w", ["full", "narrow"] as const, "full"),
  );
  const [open, setOpen] = useState(() => seed("open", ["0", "1"] as const, "0") === "1");
  const [echo, setEcho] = useState<{ verb: string; target: string } | null>(null);

  const active = useMemo(
    () => TREATMENTS.find((t) => t.id === treatment) ?? TREATMENTS[1]!,
    [treatment],
  );
  const view = VIEWS[treatment];

  const onEcho = useCallback((verb: string, target: string) => {
    setEcho({ verb, target });
  }, []);

  /* The printed key chips are bound. A shortcut rendered on a control that
     does not respond to it is the same class of dishonesty this study is
     arguing against — so the binding lands with the chip, and shows the
     canonical target it would have addressed. */
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (e.altKey && e.key === ".") {
        if (view.canStop) onEcho("Stop run", `invocation ${INVOCATION_ID} → cancelled`);
        return;
      }
      if (e.altKey) return;
      if (k === "o" && view.observe.available) onEcho("Observe", view.observe.route);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, onEcho]);

  useEffect(() => setEcho(null), [treatment, harness]);

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>· studies · web · work-observability</div>
      <h1 className={styles.title}>Work observability</h1>
      <p className={styles.lede}>
        A live conversation page currently says <strong>&quot;still
        working&quot;</strong> three times and nothing else — no current action,
        no changed files, no blocker, no next step — while three different
        spellings of <em>identity</em> (agent, session, chat id) take the top of
        the page. This study replaces that row with a <strong>work rail</strong>
        that is useful before it is exhaustive: identity, one current-status
        sentence, and three concepts — Observe, Guide, Details. Exact session
        handles, evidence, secondary routes, and destructive controls remain
        available after disclosure without competing with the conversation.{" "}
        <strong>The live case leads</strong> — the reference session reports{" "}
        <code>fidelity: synthetic</code> with zero files, so that is the second
        treatment, and every state declares whether it is live or illustrative
        above the specimen.
      </p>

      {/* ── Controls ───────────────────────────────────────────────── */}
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Treatment</span>
          <div className={styles.segmented} role="group" aria-label="Treatment">
            {TREATMENTS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={styles.seg}
                aria-pressed={treatment === t.id}
                onClick={() => setTreatment(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Harness</span>
          <div className={styles.segmented} role="group" aria-label="Harness">
            {(["claude", "codex"] as Harness[]).map((h) => (
              <button
                key={h}
                type="button"
                className={styles.seg}
                aria-pressed={harness === h}
                onClick={() => setHarness(h)}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Theme</span>
          <div className={styles.segmented} role="group" aria-label="Theme">
            {(["dark", "light"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={styles.seg}
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Width</span>
          <div className={styles.segmented} role="group" aria-label="Width">
            {(["full", "narrow"] as const).map((w) => (
              <button
                key={w}
                type="button"
                className={styles.seg}
                aria-pressed={width === w}
                onClick={() => setWidth(w)}
              >
                {w === "narrow" ? "430px" : "full"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Fixture provenance ─────────────────────────────────────── */}
      {view ? (
        <div className={styles.fixtureBar} data-kind={view.fixture}>
          <span className={styles.fixtureTag}>
            {view.fixture === "live" ? "Live record" : "Illustrative"}
          </span>
          <span>{view.fixtureNote}</span>
        </div>
      ) : (
        <div className={styles.fixtureBar} data-kind="live">
          <span className={styles.fixtureTag}>Live record</span>
          <span>
            Reproduced from the shipping components and the live thread
            chn-d75d07…670670d — three identity chips, three restatements of
            &quot;still working&quot;, zero work facts.
          </span>
        </div>
      )}

      {/* ── Specimen ───────────────────────────────────────────────── */}
      <div className={styles.spec} data-theme={theme} data-width={width}>
        <div className={styles.specBody}>
          {treatment === "before" || !view ? (
            <BeforeSurface />
          ) : (
            <AfterSurface
              view={view}
              harness={harness}
              open={open}
              setOpen={setOpen}
              echo={echo}
              onEcho={onEcho}
            />
          )}
        </div>
      </div>

      <p className={styles.note}>{active.note}</p>

      {/* ── State precedence ───────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>State precedence</h2>
          <span className={styles.sectionNote}>two records, one chip</span>
        </div>
        <p className={styles.prose}>
          Work and flight answer different questions and disagree on the live
          data — <code>work.state: &quot;review&quot;</code> with{" "}
          <code>nextMoveOwnerId: &quot;operator&quot;</code> against{" "}
          <code>flight.state: &quot;running&quot;</code>. With one chip and no
          rule, the same operator moment renders <em>Running</em>,{" "}
          <em>Waiting on you</em> or <em>Done</em> depending on which record the
          client read first. The rule is in{" "}
          <code>resolveChip()</code>, and the blocked and done treatments derive
          their chips from it rather than declaring them:
        </p>
        <ol className={styles.list}>
          <li>
            <strong>Flight governs NOW.</strong> The current action, the running
            tool, the pulse — all read from the flight and its session trace. A
            work record cannot tell you what is happening this second.
          </li>
          <li>
            <strong>Work governs NEXT.</strong> The declared next step, the
            hand-back, acceptance. A flight cannot tell you whose move it is
            after this one.
          </li>
          <li>
            <strong>The operator hand-back outranks both.</strong> If{" "}
            <code>nextMoveOwnerId === &quot;operator&quot;</code>, the chip says
            so — a still-running flight does not make the question waiting on you
            any less true. This is the one case where NEXT wins the chip.
          </li>
          <li>
            <strong>Freshness can only downgrade.</strong> A quiet stream turns{" "}
            <em>Running</em> into <em>No recent events</em>; it never turns
            anything into <em>Running</em>.
          </li>
          <li>
            <strong>No flight ⇒ work state stands alone</strong>; no work item ⇒
            flight state stands alone, and NEXT reads <em>not declared</em>.
          </li>
        </ol>
      </section>

      {/* ── Information hierarchy ──────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Information hierarchy</h2>
          <span className={styles.sectionNote}>five seconds, top to bottom</span>
        </div>
        <p className={styles.prose}>
          One question per line, in the order an operator asks them. A line only
          exists because it changes a decision; a line that could be answered
          &quot;the agent is working&quot; is not a line.
        </p>
        <ol className={styles.list}>
          <li>
            <strong>What work is this?</strong> The work title, human-authored.
            When there is no work item the invocation task stands in, labelled{" "}
            <code>FROM TASK</code> so the demotion is visible. The chat id is not
            an answer to any question and moves to a copy affordance.
          </li>
          <li>
            <strong>Who owns it, and whose move is next?</strong> Printed only
            when the next move differs from the owner. When it is you, that is
            the single most important word on the page.
          </li>
          <li>
            <strong>Which exact session?</strong> Not the agent — the session.
            An agent id can span branches, worktrees and restarts; the session id
            is what Observe, Steer and Stop actually address.
          </li>
          <li>
            <strong>What is it doing right now, and is that fresh?</strong> The
            running tool with its argument, plus the age of the last meaningful
            event — and <em>unknown</em> when there is no stream to read.
          </li>
          <li>
            <strong>What has it produced?</strong> Files, checks, steps — the
            things that would survive a stop.
          </li>
          <li>
            <strong>What happens next, and when does it come back to me?</strong>
          </li>
          <li>
            <strong>How do I intervene?</strong> Three browsing verbs, a gap, the
            destructive one; then the links, with the withdrawn ones named.
          </li>
        </ol>
        <p className={styles.prose}>
          At 430px, 1–2 stay and 3–7 collapse behind a disclosure, so the
          conversation stays above the fold — with one exception: an attention
          band never collapses. Hiding a question behind a chevron would be the
          same failure as a dismiss that reads like an answer.
        </p>
      </section>

      {/* ── Action semantics ───────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Action semantics</h2>
          <span className={styles.sectionNote}>reach · timing · availability</span>
        </div>
        <p className={styles.prose}>
          The shipping surface has one input box and therefore one semantic. The
          rail has four, and they are not interchangeable — a durable cue that
          survives a session restart is a different promise from an injection
          into the turn in flight, and only one of the two exists on every
          harness. One promotion per state, chosen by the state, never two:{" "}
          <em>Answer</em> when blocked, <em>Observe</em> when quiet,{" "}
          <em>Accept</em> when done, <strong>nothing</strong> while running.
        </p>
        <div className={styles.tblWrap}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Verb</th>
                <th>Reaches</th>
                <th>Lands</th>
                <th>Addressed by</th>
                <th>claude</th>
                <th>codex</th>
                <th>When unavailable</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Observe</td>
                <td>
                  the exact session — read-only <em>once the product is</em>
                </td>
                <td>immediately</td>
                <td className="mono">
                  <code>/flights/:flightId/observe?session=:sessionId</code>
                </td>
                <td className={`${styles.mark} ${styles.markYes}`}>yes</td>
                <td className={`${styles.mark} ${styles.markYes}`}>yes</td>
                <td>
                  No flight yet → falls back to the session view. <strong>Open
                  gap:</strong> the shipping Observe surface has a write-capable
                  composer (SessionObserve.tsx:2793-2828) with three meanings
                  behind one box, so &quot;read-only&quot; is a target, not a
                  description. See the handoff.
                </td>
              </tr>
              <tr>
                <td>Steer this turn</td>
                <td>the turn in flight</td>
                <td>mid-turn</td>
                <td className="mono">
                  <code>sessionId</code> + live <code>turnId</code>
                </td>
                <td className={`${styles.mark} ${styles.markNo}`}>no</td>
                <td className={`${styles.mark} ${styles.markYes}`}>
                  yes · steerTurn
                </td>
                <td>
                  Withdrawn with the reason printed. It must not silently become
                  a queue — that is Cue next turn, and it should say so.
                </td>
              </tr>
              <tr>
                <td>Cue next turn</td>
                <td>the invocation</td>
                <td>next turn boundary</td>
                <td className="mono">
                  <code>invocationId</code>
                </td>
                <td className={`${styles.mark} ${styles.markYes}`}>yes</td>
                <td className={`${styles.mark} ${styles.markYes}`}>yes</td>
                <td>
                  Only when the invocation is terminal. Durable: survives a
                  session swap, which Steer does not.
                </td>
              </tr>
              <tr>
                <td>Message</td>
                <td>the conversation</td>
                <td>as a message</td>
                <td className="mono">
                  <code>conversationId</code>
                </td>
                <td className={`${styles.mark} ${styles.markYes}`}>yes</td>
                <td className={`${styles.mark} ${styles.markYes}`}>yes</td>
                <td>
                  Always available. Deliberately not a control — it lives in the
                  composer, under a mode line saying where it goes, and never
                  appears in the verb row.
                </td>
              </tr>
              <tr>
                <td>Stop run</td>
                <td>the session / current turn</td>
                <td>immediately</td>
                <td className="mono">
                  <code>sessionId</code>
                </td>
                <td className={`${styles.mark} ${styles.markYes}`}>
                  yes · SIGINT
                </td>
                <td className={`${styles.mark} ${styles.markYes}`}>
                  yes · interruptTurn
                </td>
                <td>
                  Terminal states only. Sits after a spacer, away from the
                  browsing verbs, and must resolve to an explicit{" "}
                  <code>cancelled</code> — not a silent return to idle.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.prose}>
          Implementations behind that table:{" "}
          <code>adapters/codex/adapter.ts:204</code> (steerTurn) and{" "}
          <code>:224</code> (interruptTurn);{" "}
          <code>adapters/claude-code/adapter.ts:215</code> (SIGINT) and{" "}
          <code>runtime/claude-stream-json.ts:760</code> (&quot;no steer
          primitive; overlapping broker asks cue here&quot;). The declared
          contract they should be read through is{" "}
          <code>HarnessFeatureSupportMap.session.steer</code> —{" "}
          <code>isHarnessFeatureUsable()</code> is the gate, so the rail reads
          capability rather than hard-coding harness names.
        </p>
      </section>

      {/* ── Data contract ──────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Canonical data contract</h2>
          <span className={styles.sectionNote}>every field, one record</span>
        </div>
        <p className={styles.prose}>
          No new endpoints, but two preconditions that are not met today, marked{" "}
          <strong>gap</strong>. Each row was checked against the broker running
          on this machine.
        </p>
        <div className={styles.tblWrap}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Rail field</th>
                <th>Record · endpoint</th>
                <th>Field</th>
                <th>Absent ⇒</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Work ↔ flight join</td>
                <td className="mono">Invocation · /api/flights</td>
                <td className="mono">collaborationRecordId</td>
                <td>
                  <strong>gap</strong> — null on the reference flight, and the
                  two records&apos; <code>conversationId</code>s differ. Must be
                  written at dispatch; the rail must never infer it from a title.
                </td>
              </tr>
              <tr>
                <td>Work title</td>
                <td className="mono">WorkItemRecord · /api/work</td>
                <td className="mono">title</td>
                <td>
                  fall back to <code>invocation.task</code>, label{" "}
                  <code>FROM TASK</code>
                </td>
              </tr>
              <tr>
                <td>Owner / next move</td>
                <td className="mono">WorkItemRecord · /api/work</td>
                <td className="mono">ownerName · nextMoveOwnerName</td>
                <td>
                  owner ← <code>invocation.targetAgentId</code>; next move
                  omitted, never guessed
                </td>
              </tr>
              <tr>
                <td>State chip</td>
                <td className="mono">both — see State precedence</td>
                <td className="mono">flight.state · work.state · nextMoveOwnerId</td>
                <td>whichever record exists; never both flattened into one word</td>
              </tr>
              <tr>
                <td>Session identity</td>
                <td className="mono">
                  FlightSessionTraceEntry · /api/flights[].sessions[]
                </td>
                <td className="mono">
                  sessionId · harness · transport · nodeId · strategy
                </td>
                <td>Observe degrades to flight-level; Steer/Stop withdrawn</td>
              </tr>
              <tr>
                <td>Freshness</td>
                <td className="mono">
                  displayState · tool events · tail · work record
                </td>
                <td className="mono">
                  last meaningful event at · work.lastMeaningfulAt
                </td>
                <td>
                  health <code>unknown</code> — NOT stale. <strong>Note:</strong>{" "}
                  <code>lastAcknowledgedAt</code> is a dispatch receipt that never
                  advances (<code>=== startedAt</code> on the live flight) and
                  must not be used as the clock.
                </td>
              </tr>
              <tr>
                <td>Current action</td>
                <td className="mono">ScoutSessionDisplayState</td>
                <td className="mono">phase · activeTools · currentMessage</td>
                <td>
                  <code>work.lastMeaningfulSummary</code>, stamped with its age;
                  else <em>unknown</em>
                </td>
              </tr>
              <tr>
                <td>Changed files</td>
                <td className="mono">
                  openscout.session.touched/v1 · /api/session-ref/:id/touched
                </td>
                <td className="mono">counts.changedFiles · files[] · fidelity</td>
                <td>
                  <strong>gap</strong> — returns <code>synthetic</code> / 0 files
                  on the reference session, so the rail prints{" "}
                  <em>not measured</em> and withdraws the diff link
                </td>
              </tr>
              <tr>
                <td>Progress / steps</td>
                <td className="mono">
                  CollaborationProgress · ScoutDisplayTask[]
                </td>
                <td className="mono">
                  completedSteps/totalSteps · checkpoint · tasks[]
                </td>
                <td>step meter omitted; the row does not fake a denominator</td>
              </tr>
              <tr>
                <td>Blocker</td>
                <td className="mono">
                  CollaborationWaitingOn · ScoutDisplayAttentionItem
                </td>
                <td className="mono">waitingOn.kind/label · attention[kind]</td>
                <td>band not rendered — and there is never more than one</td>
              </tr>
              <tr>
                <td>Next milestone</td>
                <td className="mono">ScoutDisplayTask[] · work record</td>
                <td className="mono">
                  tasks[in_progress|pending] · nextMoveOwnerId
                </td>
                <td>
                  <em>not declared</em> — an honest gap, and a prompt to write one
                </td>
              </tr>
              <tr>
                <td>Terminal</td>
                <td className="mono">router.ts:634-671</td>
                <td className="mono">path segment, not ?agentId</td>
                <td>
                  <strong>gap</strong> — no route takes a session to its pane, so
                  the link is withdrawn with that reason rather than pointed at a
                  target that silently drops the id
                </td>
              </tr>
              <tr>
                <td>Verified routes</td>
                <td className="mono">Route · client/lib/types.ts:1272</td>
                <td className="mono">
                  /flights/:id/observe?session= · /sessions/:id · /repos?root= ·
                  /repo-diff?path=&amp;sessionId= · /activity · /work/:id
                </td>
                <td>
                  all confirmed against router.ts:469, 479, 505, 512, 587, 589
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── States ─────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>State transitions</h2>
          <span className={styles.sectionNote}>what the rail does at each edge</span>
        </div>
        <div className={styles.tblWrap}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>State</th>
                <th>Entered when</th>
                <th>Rail changes</th>
                <th>Promoted verb</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>queued / waking</td>
                <td className="mono">flight ∈ {"{queued, waking}"}</td>
                <td>
                  NOW reads <em>not started</em>; no pulse. Session strip shows
                  the endpoint being woken.
                </td>
                <td>none</td>
              </tr>
              <tr>
                <td>running</td>
                <td className="mono">flight = running, last event &lt; 2m</td>
                <td>Pulse on; three cells live; evidence per cell.</td>
                <td>
                  <strong>none</strong> — a running agent is not a reason to nudge
                </td>
              </tr>
              <tr>
                <td>freshness unknown</td>
                <td className="mono">flight = running, no event stream</td>
                <td>
                  NOW <em>unknown</em>; freshness reads{" "}
                  <em>no event stream</em>. Never says stale, never promotes
                  Observe on a session it cannot see.
                </td>
                <td>none</td>
              </tr>
              <tr>
                <td>blocked</td>
                <td className="mono">nextMoveOwnerId = operator</td>
                <td>
                  Attention band appears and never collapses; chip reads{" "}
                  <em>Waiting on you</em> even while the flight runs; NOW stops
                  animating.
                </td>
                <td>Answer (in the band)</td>
              </tr>
              <tr>
                <td>quiet stream</td>
                <td className="mono">
                  running, stream alive, last meaningful event &gt; 8m
                </td>
                <td>
                  NOW → <em>unknown</em>; PROGRESS stamped <em>as of …</em>; band
                  explains and carries no buttons.
                </td>
                <td>Observe (in the row)</td>
              </tr>
              <tr>
                <td>done</td>
                <td className="mono">flight = completed</td>
                <td>
                  Cells re-label to ran-for / produced / next; receipt carries the
                  invocation output; chip reads the acceptance hand-back.
                </td>
                <td>Accept</td>
              </tr>
              <tr>
                <td>failed / cancelled</td>
                <td className="mono">flight ∈ {"{failed, cancelled}"}</td>
                <td>
                  Receipt carries <code>error</code> verbatim and what survived —
                  a stop must never look like a completion.
                </td>
                <td>Retry</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Provenance ─────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Provenance across Conversation and Observe</h2>
          <span className={styles.sectionNote}>coordinate the component, differentiate the content</span>
        </div>
        <p className={styles.prose}>
          Both surfaces are tempted to show the ask. Only one should,
          and it is not this one.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Conversation → the work rail is forward-looking.</strong> Now
            / progress / next; the operator is deciding whether to intervene. The
            ask is <em>already the first message in the transcript</em>,
            six lines below — the After specimen shows it. Repeating it in the
            rail would be the new &quot;still working ×3&quot;, by this study&apos;s
            own standard.
          </li>
          <li>
            <strong>Observe → run provenance is backward-looking.</strong> The
            operator arrived from a deep link at a raw event stream with no idea
            why the run exists. <em>Ask · requester · time · origin ·
            flight</em> belongs there, and nowhere else.
          </li>
          <li>
            <strong>Coordinate exactly one thing: the identity line.</strong> Work
            title · owner · exact session should be a single shared component at
            two densities, so the two surfaces cannot drift on what the session id
            is or how it is spelled. That is also the answer to the earlier open
            question about where the rail lives —{" "}
            <em>share the identity primitive, not the whole rail.</em>
          </li>
          <li>
            <strong>Two notes on the shipped provenance panel</strong>, from the
            review: the lime <code>INITIATING ASK</code> kicker currently fires on
            the <em>absent</em> case, so the most saturated colour on the page
            marks a missing record — invert it and render unknown in{" "}
            <code>--dim</code>. And the byline should carry the requester&apos;s
            relationship alongside the name; on a fleet where most requesters are
            agents, &quot;Arach&quot; and &quot;openscout-turing-6&quot; read
            identically.
          </li>
        </ul>
      </section>

      {/* ── Handoff ────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Implementation handoff</h2>
          <span className={styles.sectionNote}>study only — nothing here is wired</span>
        </div>
        <ol className={styles.list}>
          <li>
            <strong>Precondition — write the join.</strong>{" "}
            <code>flight.collaborationRecordId</code> is null on the reference
            flight, so slice 2 has nothing to resolve against. Populate it at
            dispatch. Until then the rail renders the thin treatment, which is
            honest and still useful — it is the state that leads this study.
          </li>
          <li>
            <strong>Slice 1 — kill the triplication, add identity.</strong>{" "}
            Replace <code>ConversationIdentityRow</code>{" "}
            (ConversationHeader.tsx:225) with row A. Delete{" "}
            <code>conversationIdentityLabel()</code>&apos;s unconditional{" "}
            <code>&quot;Chat ID&quot;</code> and move the id to a copy button.
            Suppress the transcript working card and the typing indicator
            whenever the rail is present — one statement of liveness per surface.
          </li>
          <li>
            <strong>Slice 2 — the meter, plus the freshness input.</strong> NOW
            and NEXT need <code>ScoutSessionDisplayState</code> on the
            conversation route; today it is reachable per-agent
            (<code>/api/agents/:id/observe</code>). The same join delivers the
            freshness clock: <strong>do not ship the stale state until meaningful
            event flow exists</strong> — on <code>lastAcknowledgedAt</code> it
            would libel every healthy claude/tmux session. Interim: read{" "}
            <code>work.lastMeaningfulAt</code>, and render <em>unknown</em> where
            there is nothing.
          </li>
          <li>
            <strong>Slice 3 — the verbs, and settle Observe.</strong> Observe is
            pure routing and can land immediately, but the word{" "}
            <em>read-only</em> cannot until{" "}
            <code>SessionObserve.tsx:2793-2828</code> is resolved: its composer
            carries new-invocation, write-into-session and read-only-trace
            meanings behind one box. Either gate it to read-only on this entry
            point, or give it this study&apos;s own mode line. Steer/Cue need the
            capability read (<code>session.steer</code>,{" "}
            <code>session.followUps</code>) plumbed to the client so the button is
            gated on declared support rather than a harness string. Stop needs a
            broker route that reports the resulting state back, not
            fire-and-forget.
          </li>
          <li>
            <strong>Slice 4 — bind the keys with the chips.</strong>{" "}
            <code>o</code> / <code>s</code> / <code>c</code> / <code>⌥.</code> are
            bound in this study and echo their canonical target. They must land
            with the printed chip in the port, or the chip must not ship.
          </li>
          <li>
            <strong>Open — the 8-minute threshold.</strong> Still a guess, but now
            a guess about the right input. It should be a function of the last
            tool&apos;s expected duration: a <code>bun test</code> that takes 6
            minutes is not quiet at minute 5, and a <code>Read</code> that takes
            40 seconds is.
          </li>
          <li>
            <strong>Not in scope.</strong> No production edits, no server or
            protocol changes. The palettes, ids, endpoint shapes, route parses and
            adapter line references above are read from the repo and the local
            broker; the prose in the illustrative fixtures is authored and
            labelled as such.
          </li>
        </ol>
      </section>

      {/* ── Accessibility ──────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Keyboard, narrow, non-visual</h2>
        </div>
        <ul className={styles.list}>
          <li>
            <strong>Contrast.</strong> The shipping light palette puts{" "}
            <code>--dim</code> at 2.42:1 and <code>--warn</code> at 3.59:1 on{" "}
            <code>--surface</code> — so on the shipped tokens alone, every element
            this rail added <em>for honesty</em> would be the least legible thing
            on the page, in the theme where it fails worst. The palettes stay
            verbatim; the honesty layer is lifted off them onto measured inks
            (light 5.42:1 / 5.78:1, dark 5.68:1 / 8.8:1). Disabled text no longer
            uses opacity, which had taken withdrawn controls to 1.67:1.
          </li>
          <li>
            <strong>Withdrawn affordances keep their reason, reachably.</strong>{" "}
            They render <code>aria-disabled</code> rather than{" "}
            <code>disabled</code>, so they stay in the tab order, carry{" "}
            <code>aria-describedby</code>, and every reason is also printed as
            visible text in the <em>Withdrawn —</em> line. Pointer, keyboard,
            screen reader and screenshot all get the same sentence.
          </li>
          <li>
            <strong>The keys are bound.</strong> <code>o</code> / <code>s</code> /{" "}
            <code>c</code> / <code>⌥.</code> fire and echo the canonical target
            they would address, and carry <code>aria-keyshortcuts</code>. Press{" "}
            <code>s</code> on claude to see a withdrawn verb explain itself.
          </li>
          <li>
            <strong>Spoken form.</strong> The rail is a grid, which reads badly
            cell-by-cell, so it opens with a visually-hidden sentence carrying the
            same facts in order.
          </li>
          <li>
            <strong>Colour is never the signal.</strong> Freshness prints{" "}
            <em>last event 12s ago</em> / <em>no events for 14m</em> /{" "}
            <em>freshness unknown</em>; the dot only reinforces, and the unknown
            dot is a ring rather than a fill. The state chip carries a word.
          </li>
          <li>
            <strong>Narrow.</strong> Below 520px the rail collapses to identity +
            one NOW line + a disclosure, so the conversation stays above the fold;
            an attention band is the one thing that never collapses. The specimen
            is a real CSS container, so the 430px control exercises the actual
            breakpoint.
          </li>
          <li>
            <strong>Motion.</strong> The one animation (the live pulse) is
            suppressed under <code>prefers-reduced-motion</code>.
          </li>
        </ul>
      </section>
    </main>
  );
}
