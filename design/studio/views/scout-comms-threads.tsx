"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import styles from "./scout-comms-threads.module.css";

/**
 * Scout — Comms · Threads.
 *
 * How a reply becomes an affordance and a thread becomes a place. Three
 * treatments over one conversation:
 *
 *   Current    — the shipped flat stream. `replyToMessageId` already decodes
 *                on ScoutMessage and renders as a custody caption, but a side
 *                question and its answer still split across the stream, and
 *                "New chat from this message…" mints an orphan top-level
 *                conversation.
 *   Reply-to   — phase 1. Reply is a hover action + a composer target chip;
 *                the chain gathers under its parent behind a hairline rail,
 *                one visual level deep. Client-only: the wire field exists
 *                end-to-end, the send path just never sets it.
 *   Sub-thread — phase 2. A thread is a child conversation anchored to a
 *                message (`parent_conversation_id` + `message_id`, already in
 *                the broker schema), summarized by a stub row and expanded
 *                inline. The conversation list gains no new row — and
 *                branch-from-message anchors here instead of orphaning.
 */

type Treatment = "current" | "reply" | "thread";

const TREATMENTS: { id: Treatment; label: string; caption: ReactNode }[] = [
  {
    id: "current",
    label: "Current",
    caption: (
      <>
        What ships today. The answer to Art&rsquo;s side question lands two turns later with only a
        mono <em>Reply to b7e29d10</em> caption to correlate it — the data is there, the rendering
        isn&rsquo;t. And &ldquo;New chat from this message…&rdquo; creates a disconnected top-level
        conversation (first row in the list).
      </>
    ),
  },
  {
    id: "reply",
    label: "Reply-to",
    caption: (
      <>
        Phase 1 — reply becomes an affordance. Hover a turn for <em>Reply</em>; the chain gathers
        under its parent behind a hairline rail (one level deep, no infinite nesting); the composer
        names its target. Backed by <code>replyToMessageId</code>, which already decodes on{" "}
        <code>ScoutMessage</code> — only the send path and grouping are new.
      </>
    ),
  },
  {
    id: "thread",
    label: "Sub-thread",
    caption: (
      <>
        Phase 2 — a thread is a place. The side conversation lives in a child conversation anchored
        to the message; a stub row summarizes it, expansion is inline, and the list gains no new
        row. &ldquo;New chat from this message…&rdquo; anchors here too instead of orphaning.
      </>
    ),
  },
];

/* ── List data ──────────────────────────────────────────────────────── */

type Group = "now" | "today" | "earlier";

type Conversation = {
  cId: string;
  name: string;
  channel?: boolean;
  orphan?: boolean;
  preview: string;
  time: string;
  count?: number;
  unread?: boolean;
  selected?: boolean;
  group: Group;
};

const GROUPS: { id: Group; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "today", label: "Today" },
  { id: "earlier", label: "Earlier" },
];

const ORPHAN_ROW: Conversation = {
  cId: "c1f80a2e",
  name: "Branch from message",
  orphan: true,
  preview: "Quick one on item 3 — when two rows tie on updatedAt, does parse-once change the order?",
  time: "5m",
  count: 1,
  group: "now",
};

const CONVERSATIONS: Conversation[] = [
  { cId: "ab3fd029", name: "Talkie", preview: "No — ties fall back to id, so insertion order holds and Lanes is safe.", time: "2m", count: 6, unread: true, selected: true, group: "now" },
  { cId: "90a1c2d4", name: "premotion", preview: "Can you confirm the app-scoped-design note lands before the v0-2 cut?", time: "8m", count: 2, unread: true, group: "now" },
  { cId: "fb44d2ee", name: "openscout", channel: true, preview: "feat/repo-watch — themeVars bridge landed; the embed now adopts the app palette.", time: "1h", count: 4, group: "today" },
  { cId: "8006703b", name: "Hudson", preview: "Reviewed. talkie-overlay-settings polished — moved the no-fly list inline.", time: "2h", count: 1, group: "earlier" },
];

/* ── Thread data ────────────────────────────────────────────────────── */

const ANCHOR_HTML = `<p>Three changes, highest-impact first:</p>
<ol>
<li><strong>Make Library a full-height pane</strong> — drop the nested ScrollView and the fixed frame.</li>
<li><strong>Rebuild Overview around <em>now</em></strong> — active work first, health strip only when something's degraded.</li>
<li><strong>Kill the date-parse hot path</strong> — <code>createdDate</code> allocates a fresh <code>ISO8601DateFormatter</code> inside the sort comparators. Parse once at init.</li>
</ol>`;

const QUESTION_HTML = `<p>Quick one on item 3 — when two rows tie on <code>updatedAt</code>, does parse-once change the order? Lanes assumes insertion order for ties today.</p>`;

const ANSWER_HTML = `<p>No — ties fall back to <code>id</code>, so insertion order holds and Lanes is safe. Added a regression test for the tie case anyway.</p>`;

const MAINLINE_HTML = `<p>View-layer changes are in — Library is a full-height pane, Overview leads with active work. Pushed to <code>master</code>.</p>`;

/* ── Study ──────────────────────────────────────────────────────────── */

export default function ScoutCommsThreadsStudy() {
  const [treatment, setTreatment] = useState<Treatment>("reply");
  const active = TREATMENTS.find((t) => t.id === treatment)!;
  const listRows = treatment === "current" ? [ORPHAN_ROW, ...CONVERSATIONS] : CONVERSATIONS;

  return (
    <ScoutStudyShell
      pageId="scout-comms-threads"
      title="Scout — Comms · Threads"
      blurb={
        <>
          Reply and thread as first-class moves in the macOS conversation surface. The broker
          already carries both primitives —{" "}
          <code className="font-mono text-[11px] text-studio-ink">reply_to_message_id</code> on
          messages and{" "}
          <code className="font-mono text-[11px] text-studio-ink">parent_conversation_id</code>{" "}
          on conversations — and <code className="font-mono text-[11px] text-studio-ink">ScoutMessage</code>{" "}
          decodes the reply field today. This study gives the data a shape: a Reply affordance with
          grouped rendering (phase 1, client-only), then anchored sub-threads that also give
          &ldquo;New chat from this message…&rdquo; a home (phase 2, needs server population).
        </>
      }
    >
      <div className={styles.toggleRow}>
        <div className={styles.toggle} role="tablist" aria-label="Treatment">
          {TREATMENTS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === treatment}
              className={`${styles.toggleSeg} ${t.id === treatment ? styles.toggleActive : ""}`}
              onClick={() => setTreatment(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className={styles.caption}>{active.caption}</p>
      </div>

      <ScoutWindow title="scout · comms">
        <div className={styles.comms}>
          {/* ── List ─────────────────────────────────────────────── */}
          <aside className={styles.list}>
            <div className={styles.listHead}>
              <span className={styles.listTitle}>Conversations</span>
              <span className={styles.listCount}>{listRows.length} · 2 unread</span>
            </div>
            <div className={styles.rows}>
              {GROUPS.map((g) => {
                const rows = listRows.filter((c) => c.group === g.id);
                if (!rows.length) return null;
                return (
                  <Fragment key={g.id}>
                    <div className={styles.group}>{g.label}</div>
                    {rows.map((c) => (
                      <ConversationRow key={c.cId} c={c} />
                    ))}
                  </Fragment>
                );
              })}
            </div>
          </aside>

          {/* ── Thread pane ──────────────────────────────────────── */}
          <section className={styles.thread}>
            <header className={styles.threadHead}>
              <SpriteAvatar name="Talkie" size={34} tile />
              <div className={styles.threadIdent}>
                <div className={styles.threadName}>Talkie</div>
                <div className={styles.threadSub}>talkie · master · ~/dev/talkie · c.ab3fd029</div>
              </div>
              <div className={styles.threadActions}>
                <button className={styles.ghostBtn}>Observe</button>
                <button className={styles.primaryBtn}>Message</button>
              </div>
            </header>

            <div className={styles.stream}>
              {treatment === "current" && <CurrentStream />}
              {treatment === "reply" && <ReplyStream />}
              {treatment === "thread" && <ThreadStream />}
            </div>

            <div className={styles.composer}>
              <div className={styles.composerBox}>
                {treatment === "reply" ? (
                  <div className={styles.replyChip}>
                    <ReplyGlyph />
                    <span className={styles.replyChipLabel}>Replying to</span>
                    <span className={styles.replyChipTarget}>Talkie — &ldquo;Three changes, highest-impact first…&rdquo;</span>
                    <button className={styles.replyChipClear} aria-label="Clear reply target">×</button>
                  </div>
                ) : null}
                <div className={styles.composerField}>Message Talkie…</div>
                <div className={styles.composerBar}>
                  <span className={styles.composerHint}>
                    Type <kbd>/</kbd> for commands · <kbd>@</kbd> for agents
                  </span>
                  <button className={styles.primaryBtn}>Send</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </ScoutWindow>

      <Deltas />
      <DataContract />
    </ScoutStudyShell>
  );
}

/* ── Streams per treatment ──────────────────────────────────────────── */

function CurrentStream() {
  return (
    <>
      <Turn author="Talkie" time="2:15 PM" html={ANCHOR_HTML} />
      <Turn author="Art" me time="2:17 PM" html={QUESTION_HTML} />
      <Turn author="Talkie" time="2:19 PM" html={MAINLINE_HTML} />
      {/* Today's whole threading story: a mono caption pointing at a hex id,
          two turns away from the question it answers. */}
      <Turn author="Talkie" time="2:21 PM" html={ANSWER_HTML} custody="Reply to b7e29d10" />
    </>
  );
}

function ReplyStream() {
  return (
    <>
      <Turn author="Talkie" time="2:15 PM" html={ANCHOR_HTML} action="reply" />
      {/* The chain gathers under its parent — flat within the rail, one visual
          level deep regardless of reply depth (answer→question→anchor). */}
      <div className={styles.chain}>
        <Turn author="Art" me time="2:17 PM" html={QUESTION_HTML} compact action="reply" />
        <Turn author="Talkie" time="2:21 PM" html={ANSWER_HTML} compact action="reply" />
      </div>
      <Turn author="Talkie" time="2:19 PM" html={MAINLINE_HTML} action="reply" />
    </>
  );
}

function ThreadStream() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className={styles.anchorBlock}>
        <Turn author="Talkie" time="2:15 PM" html={ANCHOR_HTML} action="thread" />
        <button type="button" className={styles.stub} onClick={() => setOpen((o) => !o)}>
          <span className={styles.stubFaces}>
            <span className={styles.stubMe}>A</span>
            <SpriteAvatar name="Talkie" size={16} />
          </span>
          <span className={styles.stubCount}>2 replies</span>
          <span className={styles.stubMeta}>· Art, Talkie · last 2m</span>
          <span className={styles.stubDisclose}>{open ? "collapse" : "expand"}</span>
        </button>
        {open ? (
          <div className={styles.rail}>
            <Turn author="Art" me time="2:17 PM" html={QUESTION_HTML} compact />
            <Turn author="Talkie" time="2:21 PM" html={ANSWER_HTML} compact />
            <div className={styles.miniComposer}>
              <span className={styles.miniField}>Reply in thread…</span>
              <button className={styles.miniSend}>Send</button>
            </div>
          </div>
        ) : null}
      </div>
      <Turn author="Talkie" time="2:19 PM" html={MAINLINE_HTML} action="thread" />
    </>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────── */

function ConversationRow({ c }: { c: Conversation }) {
  return (
    <div className={`${styles.row} ${c.selected ? styles.selected : ""} ${c.unread ? styles.unread : ""} ${c.orphan ? styles.orphan : ""}`}>
      <span className={styles.rowAvatar}>
        {c.channel ? <span className={styles.channelChip}>#</span> : <SpriteAvatar name={c.name} size={28} tile />}
      </span>
      <span className={styles.body}>
        <span className={styles.topline}>
          {c.unread ? <span className={styles.unreadDot} /> : null}
          <span className={styles.name}>{c.name}</span>
          <span className={styles.time}>{c.time}</span>
        </span>
        <span className={styles.preview}>{c.preview}</span>
        {c.orphan ? <span className={styles.orphanNote}>seeded from c.ab3fd029 · no anchor back</span> : null}
        {c.selected ? <span className={styles.cid}>cId {c.cId}</span> : null}
      </span>
      {c.count ? (
        <span className={`${styles.countBadge} ${c.unread ? styles.countUnread : ""}`}>{c.count}</span>
      ) : null}
    </div>
  );
}

function Turn({
  author,
  time,
  html,
  me,
  compact,
  custody,
  action,
}: {
  author: string;
  time: string;
  html: string;
  me?: boolean;
  compact?: boolean;
  custody?: string;
  action?: "reply" | "thread";
}) {
  const size = compact ? 20 : 26;
  return (
    <div className={`${styles.turn} ${compact ? styles.turnCompact : ""}`}>
      {me ? (
        <span className={styles.turnMe} style={{ width: size, height: size, fontSize: size * 0.44 }}>
          {author[0]}
        </span>
      ) : (
        <SpriteAvatar name={author} size={size} />
      )}
      <div className={styles.turnBody}>
        <div className={styles.turnHead}>
          <span className={styles.turnAuthor}>{author}</span>
          <span className={styles.turnTime}>{time}</span>
        </div>
        {custody ? <div className={styles.custody}>{custody}</div> : null}
        <div className={styles.turnText} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {action ? (
        <div className={styles.turnActs}>
          <button className={styles.turnAct}>
            <ReplyGlyph />
            {action === "reply" ? "Reply" : "Thread"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── Deltas ─────────────────────────────────────────────────────────── */

function Deltas() {
  const rows: { mark: string; head: string; body: ReactNode }[] = [
    {
      mark: "①",
      head: "Reply is an affordance, not a caption",
      body: (
        <>
          Hover a turn for <em>Reply</em>; the composer takes a clearable target chip; the send
          payload carries <code>replyToMessageId</code>. Rendering gathers a chain under its parent
          behind a hairline rail — flat within the rail, one visual level regardless of reply
          depth. The custody caption (&ldquo;Reply to b7e2…&rdquo;) retires; the grouping is the
          correlation.
        </>
      ),
    },
    {
      mark: "②",
      head: "A thread is an anchored child conversation",
      body: (
        <>
          Not a rendering trick: the side conversation is a real conversation with{" "}
          <code>parent_conversation_id</code> + <code>message_id</code> pointing at its anchor. A
          stub row (faces · count · recency) summarizes it; expansion is inline with its own
          composer; the conversation list gains no top-level row. Because it&rsquo;s a
          conversation, it can carry its own agent session — a scoped side question that
          doesn&rsquo;t derail the main context.
        </>
      ),
    },
    {
      mark: "③",
      head: "Branch-from-message folds in",
      body: (
        <>
          &ldquo;New chat from this message…&rdquo; keeps its seeding behavior but anchors the new
          conversation as a sub-thread instead of minting the orphan top-level row the Current
          treatment shows. One less disconnected object; the escape hatch becomes the same move as
          starting a thread.
        </>
      ),
    },
  ];
  return (
    <div className="mt-6 max-w-[92ch]">
      <div className="mb-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-studio-ink-faint">
        deltas
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.mark} className="flex gap-3">
            <span className="font-mono text-[13px] leading-[1.5] text-studio-ink">{r.mark}</span>
            <p className="text-[13px] leading-relaxed text-studio-ink-muted">
              <strong className="font-semibold text-studio-ink">{r.head}.</strong> {r.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Data contract ──────────────────────────────────────────────────── */

function DataContract() {
  const rows: { field: string; type: string; source: string }[] = [
    {
      field: "send.replyToMessageId",
      type: "String?",
      source:
        "Phase 1, client + one route param. ScoutMessage already decodes it; sendScoutConversationMessage already accepts it server-side. Add it to the POST api/send payload and to ScoutCommsStore.send.",
    },
    {
      field: "message.threadConversationId",
      type: "String?",
      source:
        "Phase 2. messages.thread_conversation_id exists in the broker schema and decodes through WebMessage — server must start populating it when a turn lands in a sub-thread.",
    },
    {
      field: "channel.parentConversationId + anchorMessageId",
      type: "String? · String?",
      source:
        "Phase 2. conversations.parent_conversation_id + message_id exist in the broker schema; expose both on the channels payload so the client anchors the thread and suppresses the top-level row.",
    },
    {
      field: "message.threadSummary",
      type: "{ count, participants, lastActiveAt }?",
      source:
        "Phase 2, net-new. Computed server-side per anchor message for the stub row — count + participant handles + recency; avoids the client fetching every child conversation to draw a stub.",
    },
  ];
  return (
    <div className={styles.contract}>
      <div className={styles.contractHead}>data contract · reply (phase 1) vs sub-thread (phase 2)</div>
      <table className={styles.contractTable}>
        <thead>
          <tr>
            <th>field</th>
            <th>type</th>
            <th>source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.field}>
              <td className={styles.contractField}>{r.field}</td>
              <td className={styles.contractType}>{r.type}</td>
              <td className={styles.contractSource}>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Glyphs ─────────────────────────────────────────────────────────── */

function ReplyGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 17 4 12 9 7" />
      <path d="M4 12h11a4 4 0 0 1 4 4v2" />
    </svg>
  );
}
