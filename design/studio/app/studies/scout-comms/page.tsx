"use client";

import { Fragment, useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import styles from "./page.module.css";

/**
 * Scout — Comms.
 *
 * The implementation spec for the Comms surface (`ScoutCommsView` list +
 * `ScoutRootView` thread/composer). Brings the flat list up to: recency groups,
 * labeled filters, unread emphasis, ask answered/pending chips, cId-on-selected,
 * expanded thread header, a pinned originating Ask, collapsible long turns, a
 * file card, and a composer hint bar. The list also carries the data contract
 * the native side needs (unreadCount, askState) — see the strip below.
 */

type Group = "now" | "today" | "earlier";
type AskState = "answered" | "pending";

type Conversation = {
  cId: string;
  name: string;
  avatar: string;
  channel?: boolean;
  ask?: AskState;
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

const CONVERSATIONS: Conversation[] = [
  { cId: "ab3fd029", name: "Talkie", avatar: "T", ask: "answered", preview: "Render before send — moved resolveStartupTheme() ahead of the composer mount; no skin flash on cold open.", time: "2m", count: 6, unread: true, selected: true, group: "now" },
  { cId: "90a1c2d4", name: "premotion", avatar: "P", ask: "pending", preview: "Can you confirm the app-scoped-design note lands before the v0-2 cut?", time: "8m", count: 2, unread: true, group: "now" },
  { cId: "a4d433a9", name: "Art", avatar: "A", ask: "answered", preview: "Done — the inspector renders Talkie's own library presentation with the resolved skin badge.", time: "22m", count: 2, group: "today" },
  { cId: "fb44d2ee", name: "openscout", avatar: "#", channel: true, preview: "feat/repo-watch — themeVars bridge landed; the embed now adopts the app palette.", time: "1h", count: 4, group: "today" },
  { cId: "8006703b", name: "Hudson", avatar: "H", ask: "answered", preview: "Reviewed. talkie-overlay-settings polished — moved the no-fly list inline.", time: "2h", count: 1, group: "today" },
  { cId: "71d0ee20", name: "scoutbot", avatar: "S", preview: "Daily digest — 4 repos dirty, 2 agents live, 14 worktrees across the fleet.", time: "5h", count: 1, group: "earlier" },
  { cId: "6fdde021", name: "openscout-feature-flags", avatar: "#", channel: true, preview: "@hudson — does a single-@ mention route any differently in-channel than a DM?", time: "1d", count: 4, group: "earlier" },
  { cId: "5215a166", name: "Lattices", avatar: "L", preview: "Rebased main onto origin — 2 ahead, clean. Ready for the lattice-snap pass.", time: "1d", count: 3, group: "earlier" },
];

const FILTERS = ["Inbox", "DMs", "Channels"] as const;

const ASK = {
  id: "ask:f-mq8ubzy0-8qm0",
  from: "Art",
  text: "Review AgentHomeShellView / AgentHomeActivityStore — should overlay settings render before send, or stay deferred? Flag any perf traps while you're in there.",
};

type Message = {
  me: boolean;
  author: string;
  time: string;
  long?: boolean;
  html: string;
  card?: { head: string; body: string };
};

const MESSAGES: Message[] = [
  {
    me: false,
    author: "Talkie",
    time: "2:15 PM",
    long: true,
    html: `<p>Three changes, highest-impact first:</p>
<ol>
<li><strong>Make Library a full-height, first-class pane.</strong> Today <code>ScopeLibraryList</code> nests its own ScrollView inside a fixed <code>.frame(height: 460)</code> — a double scroll with a clipped value. Drop the wrapper and let the list fill the content area.</li>
<li><strong>Rebuild Overview around <em>now</em>, not inventory.</strong> Replace the static hero with active work, the latest completed turn, and a health strip that only surfaces when something's degraded.</li>
<li><strong>Kill the date-parse hot path.</strong> <code>createdDate</code>/<code>updatedDate</code> allocate a fresh <code>ISO8601DateFormatter</code> on every call, inside the sort comparators — O(n log n) allocations per tick. Parse once at init.</li>
</ol>
<p>Items 1–2 are view-layer; 3 is store-layer. Happy to take either.</p>`,
  },
  {
    me: true,
    author: "Art",
    time: "2:17 PM",
    html: "Great breakdown. Take both — and surface the active theme in the inspector while you're in the view layer, so I can see which skin a session opened with.",
  },
  {
    me: false,
    author: "Talkie",
    time: "2:18 PM",
    html: "On it. Moved <code>resolveStartupTheme()</code> ahead of the composer mount, and the inspector now shows the resolved skin badge. Pushed to <code>master</code>.",
    card: {
      head: "Talkie/AgentHomeShellView.swift",
      body: "Applies overlay settings on appear, before the first send — no skin flash on cold open.",
    },
  },
];

export default function ScoutCommsStudy() {
  const unread = CONVERSATIONS.filter((c) => c.unread).length;

  return (
    <ScoutStudyShell
      pageId="scout-comms"
      title="Scout — Comms"
      blurb={
        <>
          The conversation surface, brought up from a flat scroll: recency groups,
          labeled filters, unread emphasis, ask answered/pending chips, a pinned
          originating Ask, collapsible long turns, and a composer hint bar. The
          list also defines the new data the native side needs —{" "}
          <code className="font-mono text-[11px] text-studio-ink">unreadCount</code>{" "}
          and <code className="font-mono text-[11px] text-studio-ink">askState</code>.
        </>
      }
    >
      <ScoutWindow title="scout · comms">
        <div className={styles.comms}>
          {/* ── List ─────────────────────────────────────────────── */}
          <aside className={styles.list}>
            <div className={styles.listHead}>
              <span className={styles.listTitle}>Conversations</span>
              <span className={styles.listCount}>
                {CONVERSATIONS.length} · {unread} unread
              </span>
            </div>
            <div className={styles.filters}>
              {FILTERS.map((f, i) => (
                <span key={f} className={`${styles.filter} ${i === 0 ? styles.active : ""}`}>
                  {f}
                </span>
              ))}
            </div>
            <div className={styles.search}>
              <SearchGlyph />
              <span>Search the fleet</span>
            </div>
            <div className={styles.rows}>
              {GROUPS.map((g) => {
                const rows = CONVERSATIONS.filter((c) => c.group === g.id);
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

          {/* ── Thread ───────────────────────────────────────────── */}
          <section className={styles.thread}>
            <header className={styles.threadHead}>
              <span className={styles.threadAvatar}>T</span>
              <div className={styles.threadIdent}>
                <div className={styles.threadName}>Talkie</div>
                <div className={styles.threadSub}>talkie · master · ~/dev/talkie · c.ab3fd029</div>
              </div>
              <div className={styles.threadActions}>
                <button className={styles.ghostBtn}>
                  <EyeGlyph /> Observe
                </button>
                <button className={styles.primaryBtn}>Message</button>
              </div>
            </header>

            <PinnedAsk state="answered" />

            <div className={styles.stream}>
              {MESSAGES.map((m, i) => (
                <Turn key={i} m={m} />
              ))}
            </div>

            <div className={styles.composer}>
              <div className={styles.composerBox}>
                <div className={styles.composerField}>Message Talkie…</div>
                <div className={styles.composerBar}>
                  <span className={styles.composerHint}>
                    Type <kbd>/</kbd> for commands · <kbd>@</kbd> for agents ·{" "}
                    <kbd>session:</kbd> for sessions
                  </span>
                  <button className={styles.primaryBtn}>Send</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </ScoutWindow>

      {/* Data contract — the native fields this surface introduces */}
      <DataContract />
    </ScoutStudyShell>
  );
}

function ConversationRow({ c }: { c: Conversation }) {
  return (
    <div className={`${styles.row} ${c.selected ? styles.selected : ""} ${c.unread ? styles.unread : ""}`}>
      <span className={`${styles.avatar} ${c.channel ? styles.channel : ""}`}>{c.avatar}</span>
      <span className={styles.body}>
        <span className={styles.topline}>
          {c.unread ? <span className={styles.unreadDot} /> : null}
          <span className={styles.name}>{c.name}</span>
          {/* Only pending asks get a marker — "answered" is resolved, so a chip
              there is noise. Keeps the list quiet; flags only what needs you. */}
          {c.ask === "pending" ? (
            <span className={`${styles.askChip} ${styles.pending}`}>pending</span>
          ) : null}
          <span className={styles.time}>{c.time}</span>
        </span>
        <span className={styles.preview}>{c.preview}</span>
        {c.selected ? <span className={styles.cid}>cId {c.cId}</span> : null}
      </span>
      {c.count ? (
        <span className={`${styles.countBadge} ${c.unread ? styles.countUnread : ""}`}>{c.count}</span>
      ) : null}
    </div>
  );
}

function PinnedAsk({ state }: { state: AskState }) {
  // The design-system treatment: a flat band with a sharp accent inset edge —
  // no rounded callout, no state-colored border. Only a pending ask shows a
  // chip (an answered one is resolved; the answer is right below).
  return (
    <div className={styles.pinned}>
      <div className={styles.pinnedBar}>
        <PinGlyph />
        <span className={styles.pinnedLabel}>Ask</span>
        <span className={styles.pinnedId}>{ASK.id}</span>
        {state === "pending" ? (
          <span className={`${styles.askChip} ${styles.pending}`}>pending</span>
        ) : null}
        <span className={styles.pinnedFrom}>from {ASK.from}</span>
      </div>
      <div className={styles.pinnedText}>{ASK.text}</div>
    </div>
  );
}

function Turn({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);
  const clamped = m.long && !open;
  return (
    <div className={styles.turn}>
      <span className={`${styles.turnAvatar} ${m.me ? styles.turnMe : styles.turnAgent}`}>
        {m.author[0]}
      </span>
      <div className={styles.turnBody}>
        <div className={styles.turnHead}>
          <span className={styles.turnAuthor}>{m.author}</span>
          <span className={styles.turnTime}>{m.time}</span>
        </div>
        <div
          className={`${styles.turnText} ${clamped ? styles.clamped : ""}`}
          dangerouslySetInnerHTML={{ __html: m.html }}
        />
        {m.long ? (
          <button type="button" className={styles.more} onClick={() => setOpen((o) => !o)}>
            {open ? "Show less" : "Show more"}
          </button>
        ) : null}
        {m.card ? (
          <div className={styles.fileCard}>
            <div className={styles.fileCardHead}>
              <FileGlyph />
              {m.card.head}
            </div>
            <div className={styles.fileCardBody}>{m.card.body}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DataContract() {
  const rows: { field: string; type: string; source: string }[] = [
    {
      field: "unreadCount",
      type: "Int",
      source: "broker read-cursor (lastReadSeq) vs latest message seq, computed server-side — reuse mobile/service.ts unreadCount; advance the cursor on open.",
    },
    {
      field: "askState",
      type: "answered | pending | none",
      source: "harness question-block status (observe/service questionStatus) + ScoutAgent.pendingAsk, surfaced per-conversation on the channels payload.",
    },
  ];
  return (
    <div className={styles.contract}>
      <div className={styles.contractHead}>data contract · new fields on ScoutChannel</div>
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

function SearchGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function EyeGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" />
      <path d="M12 16v4" />
    </svg>
  );
}
