"use client";

import { useState } from "react";
import { StudyHeader } from "@/components/StudyHeader";
import styles from "./comms-one-rail.module.css";

/**
 * Studio: the comms one-rail direction (docs/design/comms-channel-navigation.md)
 * rendered as a working frame — under load, not as empty chrome.
 *
 * The load-bearing idea is HIERARCHY, not row states: the fleet runs hundreds
 * of sessions, and the rail stays ~13 rows because every stratum compresses —
 *
 *   needs you   flat mirrors; the precedence layer never scrolls
 *   agents      grouped BY PROJECT; sessions fold onto named identities,
 *               the unnamed churn rolls up ("…28 more"), cold projects
 *               collapse to a name + count. Rows are earned by recency,
 *               never by roster (no readiness lists).
 *   channels    flat — channels are few by construction
 *   observed    the ambient bulk behind one line
 *
 * Same collapse rule as the Agents tree (project · identity · session);
 * a rail row is a CONVERSATION with an identity, not a harness session.
 * Surfaces are neutral gray; the only green pixels are attention.
 */

type Turn = {
  who: string;
  when: string;
  body: string;
  register?: "ambient" | "ask" | "status";
  /** Direct address in a channel — renders the @you chip (D4). */
  mention?: boolean;
  /** Repo-relative pointer rendered as a chip — work is a path, not a paste. */
  artifact?: string;
};

type Conversation = {
  title: string;
  meta: string;
  turns: Turn[];
  composerHint: string;
  /** Coalesced system-notice run: identical broker notices collapse to ONE
      read unit inside the conversation, rendered after the turn at this index. */
  fold?: { after: number; label: string; count: number };
};

const CONVERSATIONS: Record<string, Conversation> = {
  openscout: {
    title: "Openscout",
    meta: "ask · needs your reply",
    turns: [
      {
        who: "Openscout",
        when: "2h",
        body: "Panel synthesis applied: one rail, needs-you mirrors, notices coalesce in-conversation. Doc v2 is on the branch.",
        artifact: "docs/design/comms-channel-navigation.md",
      },
      {
        who: "You",
        when: "1h",
        body: "Ratifying the mirror rule. Show me the Observed step-in before I call the click contract.",
      },
      {
        who: "Openscout",
        when: "6m",
        register: "ask",
        body: "Two calls left: does clicking an Observed session promote it to a watch pane with step-in, or move it to Agents? And does the compact cut keep the inline composer? Everything else is decided in the doc.",
      },
    ],
    composerHint: "Reply to the ask…",
  },
  mld: {
    title: "#message-lifecycle-design",
    meta: "5 agents · 2 working",
    turns: [
      {
        who: "drover-7",
        when: "3h",
        body: "Producer inventory posted. The clientMessageId overwrite is the only P0 left on the idempotency strand.",
      },
      {
        who: "bohr-7",
        when: "2h",
        body: "Re-checked the worktree on the submit-terminal path — the claimed P0 fixes hold under the crash-loop fixture. Journal replay is clean.",
      },
      {
        who: "You",
        when: "2h",
        body: "Hold the schema bump until the idempotency strand closes — one migration, not two.",
      },
      {
        who: "mendel-4",
        when: "2h",
        register: "status",
        body: "ready — pagination branch verified",
      },
      {
        who: "Hudson",
        when: "1h",
        body: "Rolled the delivery-journal notes into the thread doc so the next peel starts from one place.",
        artifact: "docs/eng/message-lifecycle-thread.md",
      },
      {
        who: "drover-7",
        when: "26m",
        register: "ask",
        mention: true,
        body: "the overwrite fix forks the schema: accept-first-write, or last-write-wins with journal compensation. Both are behind flags; which lands?",
      },
    ],
    composerHint: "Reply to drover-7…",
    fold: { after: 0, label: "broker work-request notices", count: 7 },
  },
  hudson: {
    title: "Hudson",
    meta: "working · openscout",
    turns: [
      {
        who: "Hudson",
        when: "6h",
        body: "Editable CodeViewer surface landed; integration notes inside. The embed keeps the read-only path untouched.",
        artifact: "packages/web/client/components/CodeViewer.tsx",
      },
      {
        who: "You",
        when: "5h",
        body: "Good — hold the write path behind the flag until the review lane clears it.",
      },
    ],
    composerHint: "Message Hudson…",
  },
};

type RailRow = {
  id: string;
  kind: "channel" | "agent" | "discover" | "observed";
  name: string;
  presence?: string;
  /** Items addressed to the operator (asks/mentions) — never raw traffic.
      Agent-to-agent churn is ambient and expressed by sort recency alone. */
  addressed?: number;
  needsYou?: boolean;
  convo?: string;
  /** Provenance suffix shown only on needs-you mirrors. */
  origin?: string;
};

/** The hierarchy: project → named identities (recent conversations) → roll-up.
    Sessions collapse onto identity; cold projects collapse to name + count. */
type ProjectGroup = {
  name: string;
  sessions: number;
  open?: boolean;
  rows?: RailRow[];
  rolled?: number;
};

const PROJECTS: ProjectGroup[] = [
  {
    name: "openscout",
    sessions: 31,
    open: true,
    rows: [
      { id: "openscout", kind: "agent", name: "Openscout", needsYou: true, convo: "openscout" },
      { id: "hudson", kind: "agent", name: "Hudson", presence: "working", convo: "hudson" },
      { id: "drover", kind: "agent", name: "drover-7", presence: "working" },
    ],
    rolled: 28,
  },
  { name: "talkie", sessions: 12 },
  { name: "herdr", sessions: 7 },
];

/** Mirrors — origins never leave their section; provenance rides along. */
const NEEDS_YOU: RailRow[] = [
  { id: "ny-openscout", kind: "agent", name: "Openscout", needsYou: true, convo: "openscout", origin: "openscout" },
  { id: "ny-mld", kind: "channel", name: "message-lifecycle-design", addressed: 1, convo: "mld" },
];

const CHANNELS: RailRow[] = [
  { id: "mld", kind: "channel", name: "message-lifecycle-design", addressed: 1, convo: "mld" },
  { id: "scout-web", kind: "channel", name: "scout-web" },
  { id: "fleet-ops", kind: "channel", name: "fleet-ops" },
];

const OBSERVED = ["openscout-bohr-7", "openscout-mendel-4", "openscout-tolstoy-4"];

function Avatar({ name }: { name: string }) {
  return <span className={styles.avatar}>{name.slice(0, 1).toUpperCase()}</span>;
}

function Row({
  row,
  active,
  onSelect,
  child,
}: {
  row: RailRow;
  active: boolean;
  onSelect: (id: string) => void;
  child?: boolean;
}) {
  if (row.kind === "discover") {
    return (
      <div className={`${styles.row} ${styles.rowDiscover}`} role="button" tabIndex={0}>
        <span className={styles.glyph}>+</span>
        <span className={styles.rowName}>{row.name}</span>
        <span className={styles.rowJoin}>open</span>
      </div>
    );
  }
  const emphasized = Boolean(row.addressed) || row.needsYou;
  return (
    <div
      className={`${styles.row}${child ? ` ${styles.rowChild}` : ""}`}
      data-on={active || undefined}
      data-unread={emphasized || undefined}
      role="button"
      tabIndex={0}
      onClick={() => row.convo && onSelect(row.convo)}
    >
      {row.kind === "channel" ? <span className={styles.glyph}>#</span> : <Avatar name={row.name} />}
      <span className={styles.rowName}>{row.name}</span>
      {row.origin && <span className={styles.rowOrigin}>{row.origin}</span>}
      {row.presence === "working" && !row.needsYou && (
        <span className={styles.rowPresence}>{row.presence}</span>
      )}
      {row.needsYou && <span className={styles.rowDot} />}
      {row.addressed ? <span className={styles.rowCount}>{row.addressed}</span> : null}
    </div>
  );
}

/** One turn in any register. The ask register is the steering atom: the only
    carded, only accented unit in the flow — everything ambient stays flat. */
function TurnView({ turn }: { turn: Turn }) {
  if (turn.register === "status") {
    return (
      <div className={styles.turnStatus}>
        <span className={styles.turnStatusWho}>{turn.who}</span>
        <span>{turn.body}</span>
        <span className={styles.turnWhen}>{turn.when}</span>
      </div>
    );
  }
  const body = (
    <>
      <div className={styles.turnHead}>
        <span className={styles.turnWho}>{turn.who}</span>
        {turn.register === "ask" && <span className={styles.askTag}>ask · needs your reply</span>}
        <span className={styles.turnWhen}>{turn.when}</span>
      </div>
      <p className={styles.turnText}>
        {turn.mention && <span className={styles.mention}>@you</span>} {turn.body}
      </p>
      {turn.artifact && <span className={styles.artifact}>{turn.artifact}</span>}
    </>
  );
  return (
    <div className={styles.turn}>
      <Avatar name={turn.who} />
      {turn.register === "ask" ? (
        <div className={`${styles.turnBody} ${styles.askCard}`}>{body}</div>
      ) : (
        <div className={styles.turnBody}>{body}</div>
      )}
    </div>
  );
}

function ChannelBrowser({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.browser}>
      <div className={styles.browserHead}>
        <span>Channels</span>
        <button type="button" className={styles.browserClose} onClick={onClose}>
          ×
        </button>
      </div>
      <div className={styles.browserSearch}>Search channels…</div>
      {/* The browser lists what EXISTS — no template pseudo-rows. Follow/pin is
          visibility (the operator already sees all broker traffic), not
          membership; "join" is Slack grammar Scout doesn't have. */}
      <div className={styles.browserSection}>In your rail</div>
      <div className={styles.browserRow}>
        <span className={styles.glyph}>#</span> message-lifecycle-design
        <span className={styles.browserMeta}>5 agents · 2 working</span>
      </div>
      <div className={styles.browserRow}>
        <span className={styles.glyph}>#</span> scout-web
        <span className={styles.browserMeta}>3 agents · quiet</span>
      </div>
      <div className={styles.browserSection}>All channels</div>
      <div className={styles.browserRow}>
        <span className={styles.glyph}>#</span> fleet-ops
        <span className={styles.browserMeta}>follow · adds to rail</span>
      </div>
      <div className={styles.browserFoot}>New channel…</div>
    </div>
  );
}

function Frame() {
  const [selected, setSelected] = useState("mld");
  const [observedOpen, setObservedOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ openscout: true });
  const convo = CONVERSATIONS[selected]!;

  return (
    <div className={styles.frame}>
      <div className={styles.rail}>
        <div className={styles.railHead}>
          <button type="button" className={styles.newChat}>
            + New chat
          </button>
          <span className={styles.railStat}>2 need a reply</span>
        </div>
        <div className={styles.filter}>Filter conversations…</div>

        <div className={styles.section}>
          <span>Needs you</span>
        </div>
        {NEEDS_YOU.map((row) => (
          <Row key={row.id} row={row} active={selected === row.convo} onSelect={setSelected} />
        ))}

        <div className={styles.section}>
          <span>Agents · by project</span>
        </div>
        {/* Sessions fold onto identity; cold projects fold to a count. Rows are
            earned by recent conversation, never by roster. */}
        {PROJECTS.map((group) => {
          const open = openGroups[group.name] ?? false;
          return (
            <div key={group.name}>
              <div
                className={styles.rowGroup}
                role="button"
                tabIndex={0}
                onClick={() => setOpenGroups((v) => ({ ...v, [group.name]: !open }))}
              >
                <span className={styles.rowGroupName}>{group.name}</span>
                <span className={styles.rowGroupCount}>· {group.sessions}</span>
                <span className={styles.rowGroupChevron}>{open ? "▾" : "▸"}</span>
              </div>
              {open &&
                group.rows?.map((row) => (
                  <Row key={row.id} row={row} active={selected === row.convo} onSelect={setSelected} child />
                ))}
              {open && group.rolled ? (
                <div className={`${styles.row} ${styles.rowChild} ${styles.rowRollup}`}>
                  <span className={styles.rowName}>…{group.rolled} more</span>
                </div>
              ) : null}
            </div>
          );
        })}

        <div className={styles.section}>
          <span>Channels</span>
          <button
            type="button"
            className={styles.sectionAct}
            onClick={() => setBrowserOpen((v) => !v)}
          >
            +
          </button>
        </div>
        {CHANNELS.map((row) => (
          <Row key={row.id} row={row} active={selected === row.convo} onSelect={setSelected} />
        ))}

        <div
          className={`${styles.section} ${styles.sectionObserved}`}
          role="button"
          tabIndex={0}
          onClick={() => setObservedOpen((v) => !v)}
        >
          <span>Observed · 112</span>
          <span className={styles.sectionChevron}>{observedOpen ? "▾" : "▸"}</span>
        </div>
        {observedOpen && (
          <>
            {OBSERVED.map((name) => (
              <div key={name} className={`${styles.row} ${styles.rowObserved}`}>
                <span className={styles.rowName}>{name}</span>
                <span className={styles.rowPresence}>watching</span>
              </div>
            ))}
            <div className={`${styles.row} ${styles.rowObserved} ${styles.rowObservedMore}`}>
              <span className={styles.rowName}>…109 more</span>
            </div>
          </>
        )}
      </div>

      <div className={styles.pane}>
        <div className={styles.paneHead}>
          <span className={styles.paneTitle}>
            {convo.title.startsWith("#") ? (
              <>
                <span className={styles.glyph}>#</span>
                {convo.title.slice(1)}
              </>
            ) : (
              convo.title
            )}
          </span>
          <span className={styles.paneMeta}>{convo.meta}</span>
        </div>
        <div className={styles.turns}>
          <div className={styles.divider}>
            <span>Today</span>
          </div>
          {convo.turns.map((turn, index) => (
            <div key={index}>
              <TurnView turn={turn} />
              {convo.fold?.after === index && (
                <>
                  <div
                    className={styles.noticeFold}
                    role="button"
                    tabIndex={0}
                    onClick={() => setFoldOpen((v) => !v)}
                  >
                    <span className={styles.noticeCount}>{convo.fold.count}</span>
                    {convo.fold.label}
                    <span className={styles.noticeChevron}>{foldOpen ? "▾" : "▸"}</span>
                  </div>
                  {foldOpen &&
                    ["drover-7", "bohr-7", "mendel-4"].map((agent) => (
                      <div key={agent} className={styles.turnStatus}>
                        <span className={styles.turnStatusWho}>broker</span>
                        <span>work request for openscout-{agent}</span>
                        <span className={styles.turnWhen}>2h</span>
                      </div>
                    ))}
                </>
              )}
            </div>
          ))}
        </div>
        <div className={styles.composer}>
          <span className={styles.composerHint}>{convo.composerHint}</span>
          <button type="button" className={styles.composerSend}>
            Send
          </button>
        </div>
        {browserOpen && <ChannelBrowser onClose={() => setBrowserOpen(false)} />}
      </div>
    </div>
  );
}

/** The compression, stated as arithmetic — the rail's row count is
    load-invariant while the session count grows. */
const LEDGER: Array<{ count: string; term: string; note: string }> = [
  { count: "2 rows", term: "needs you", note: "flat mirrors — the precedence layer never scrolls" },
  {
    count: "7 rows",
    term: "agents",
    note: "50 sessions across 3 projects; sessions fold onto named identities, the churn rolls up",
  },
  { count: "3 rows", term: "channels", note: "flat — channels are few by construction" },
  { count: "1 row", term: "observed", note: "112 ambient sessions behind one line" },
  { count: "13 rows", term: "total", note: "162 sessions — and the row count barely moves at 500" },
];

function MindfulMath() {
  return (
    <div className={styles.ledger}>
      {LEDGER.map((row) => (
        <div key={row.term} className={styles.ledgerRow} data-total={row.term === "total" || undefined}>
          <span className={styles.ledgerCount}>{row.count}</span>
          <span className={styles.ledgerTerm}>{row.term}</span>
          <span className={styles.ledgerNote}>{row.note}</span>
        </div>
      ))}
    </div>
  );
}

const ROW_SPECIMENS: Array<{ label: string; row: RailRow }> = [
  {
    label: "channel · addressed (ask/mention for you)",
    row: { id: "s1", kind: "channel", name: "message-lifecycle-design", addressed: 1 },
  },
  { label: "channel · ambient (agent traffic, recency only)", row: { id: "s2", kind: "channel", name: "scout-web" } },
  { label: "agent · needs you", row: { id: "s4", kind: "agent", name: "Openscout", needsYou: true } },
  { label: "agent · working", row: { id: "s5", kind: "agent", name: "Hudson", presence: "working" } },
  { label: "agent · idle (no verb — absence is the default)", row: { id: "s6", kind: "agent", name: "Action", presence: "idle" } },
];

function RowSpecimens() {
  return (
    <div className={styles.specimens}>
      {ROW_SPECIMENS.map(({ label, row }) => (
        <div key={row.id} className={styles.specimen}>
          <span className={styles.specimenLabel}>{label}</span>
          <div className={styles.specimenRow}>
            <Row row={row} active={false} onSelect={() => {}} />
          </div>
        </div>
      ))}
      <div className={styles.specimen}>
        <span className={styles.specimenLabel}>observed · watching</span>
        <div className={styles.specimenRow}>
          <div className={`${styles.row} ${styles.rowObserved}`}>
            <span className={styles.rowName}>openscout-bohr-7</span>
            <span className={styles.rowPresence}>watching</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const TURN_SPECIMENS: Array<{ label: string; turn: Turn }> = [
  {
    label: "turn · ambient + artifact chip (work is a path, not a paste)",
    turn: {
      who: "Hudson",
      when: "1h",
      body: "Rolled the delivery-journal notes into the thread doc.",
      artifact: "docs/eng/message-lifecycle-thread.md",
    },
  },
  {
    label: "turn · ask (the steering atom — only carded, only accented unit)",
    turn: {
      who: "drover-7",
      when: "26m",
      register: "ask",
      mention: true,
      body: "accept-first-write, or last-write-wins with compensation?",
    },
  },
  {
    label: "turn · status signal (compact mono — not a full turn)",
    turn: { who: "mendel-4", when: "2h", register: "status", body: "ready — pagination branch verified" },
  },
];

function TurnSpecimens() {
  return (
    <div className={styles.specimensWide}>
      {TURN_SPECIMENS.map(({ label, turn }) => (
        <div key={label} className={styles.specimen}>
          <span className={styles.specimenLabel}>{label}</span>
          <div className={`${styles.specimenRow} ${styles.specimenTurn}`}>
            <TurnView turn={turn} />
          </div>
        </div>
      ))}
      <div className={styles.specimen}>
        <span className={styles.specimenLabel}>notices · 7 identical broker posts = one read unit</span>
        <div className={`${styles.specimenRow} ${styles.specimenTurn}`}>
          <div className={`${styles.noticeFold} ${styles.noticeFoldSpecimen}`}>
            <span className={styles.noticeCount}>7</span>
            broker work-request notices
            <span className={styles.noticeChevron}>▸</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CommsOneRailStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="studies · web · comms" title="Comms · one rail, land in a conversation">
        Direction v3, hierarchy-first: the fleet runs hundreds of sessions, so the
        rail is a compression scheme — needs-you mirrors on top, agents grouped by
        project with sessions folded onto named identities (churn rolls up, cold
        projects collapse to a count), channels flat, the ambient bulk behind one
        Observed line. Same collapse rule as the Agents tree; a rail row is a
        conversation with an identity, not a harness session. The pane opens on a
        busy channel so the turn grammar earns it: one carded ask amid ambient
        traffic, status signals as mono lines, notices folded to one read unit.
        Click rows, groups, Observed, the fold, the browser. Studio only until
        sign-off.
      </StudyHeader>

      <section className="mt-8 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          The frame — hierarchy in the rail; a busy channel in the pane
        </h2>
        <Frame />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          The mindful math — the rail is a compression scheme, not a roster
        </h2>
        <MindfulMath />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          Turn grammar — registers inside a conversation
        </h2>
        <TurnSpecimens />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          Row grammar — one grammar for channels and agents; observed is a register, not a color
        </h2>
        <RowSpecimens />
      </section>
    </main>
  );
}
