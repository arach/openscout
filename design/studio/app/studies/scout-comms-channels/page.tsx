"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { type Tone } from "@/lib/agent-identity";
import styles from "./page.module.css";

/**
 * Scout — Comms · Channels.
 *
 * The group-conversation surface in the sprite identity language, kept as
 * quiet as scout-comms: avatar-led, minimal, the sprites carry identity and
 * everything else recedes.
 *
 * Channel list: one sprite per row — the most recent speaker (or the first
 * non-operator participant) — then the channel name, last-message preview,
 * and a timestamp. Unread is bold, nothing more. The active channel gets a
 * thin left accent rule, no fill or box.
 *
 * Thread: one sprite per turn; the operator's sprite wears the thin accent
 * ring and nothing else marks "you". Composer is a flat input box.
 *
 * Hue is the harness, shape is always the name.
 */

// ── Cast ────────────────────────────────────────────────────────────────

type Harness = "claude" | "codex" | "native";

interface Participant {
  name: string;
  handle: string;
  harness: Harness;
  operator?: boolean;
}

// hue = harness, matching sprite-fleet's families.
const HARNESS_HUE: Record<Harness, number> = {
  claude: 25, // ember
  codex: 135, // terminal green
  native: 280, // indigo
};

// A calm, alive body tone — these are all active participants in a channel.
const LIVE_TONE: Tone = { l: 0.74, c: 0.15 };
const OP_TONE: Tone = { l: 0.72, c: 0.13 };

const CAST: Record<string, Participant> = {
  atlas: { name: "Atlas", handle: "@atlas", harness: "claude" },
  hudson: { name: "Hudson", handle: "@hudson", harness: "claude" },
  arc: { name: "Arc", handle: "@arc", harness: "codex" },
  echo: { name: "Echo", handle: "@echo", harness: "native" },
  arach: { name: "Arach", handle: "you", harness: "native", operator: true },
};

function hueFor(p: Participant): number {
  return HARNESS_HUE[p.harness];
}

// Non-operator members, capped at 2 for the facepile.
function groupKeys(c: Channel): string[] {
  return c.members.filter((k) => !CAST[k]?.operator).slice(0, 2);
}

// ── Channels ────────────────────────────────────────────────────────────

interface Channel {
  id: string;
  name: string;
  members: string[]; // keys into CAST
  lastBy: string; // CAST key of the most recent speaker
  preview: string;
  time: string;
  unread?: boolean;
  selected?: boolean;
}

const CHANNELS: Channel[] = [
  {
    id: "c-7a2f",
    name: "atlas-hudson",
    members: ["atlas", "hudson", "arach"],
    lastBy: "hudson",
    preview: "Reviewed — atlas's branch is clean. Merging feat/broker-cursor once CI is green.",
    time: "2m",
    unread: true,
    selected: true,
  },
  {
    id: "c-91c0",
    name: "release-ops",
    members: ["echo", "arc", "hudson", "arach"],
    lastBy: "echo",
    preview: "v0.2.1 tagged + pushed to npm. Mac build is signing now — ~4 min out.",
    time: "14m",
    unread: true,
  },
  {
    id: "c-44de",
    name: "codex-review",
    members: ["arc", "atlas", "arach"],
    lastBy: "arc",
    preview: "Diff's up on the schema migration. Needs a second pass on the backfill ordering.",
    time: "1h",
  },
  {
    id: "c-2b18",
    name: "tail-watch",
    members: ["echo", "arach"],
    lastBy: "echo",
    preview: "Quiet across the fleet — 2 agents working, no errors in the last sweep.",
    time: "5h",
  },
];

// ── Thread (the selected channel) ───────────────────────────────────────

const ACTIVE = CHANNELS[0];

interface ThreadTurnData {
  who: string; // CAST key
  time: string;
  html: string;
  card?: { head: string; body: string };
}

const TURNS: ThreadTurnData[] = [
  {
    who: "atlas",
    time: "3:02 PM",
    html: "Cursor change is in. Moved the read-cursor advance to <code>onOpen</code> so unread counts settle server-side — no client round-trip. Two call sites updated.",
    card: {
      head: "broker/cursor.ts",
      body: "advanceCursor(channelId, lastSeq) now fires on open, not on first paint — unreadCount is authoritative before the list renders.",
    },
  },
  {
    who: "hudson",
    time: "3:05 PM",
    html: "Reviewed. Clean — the only thing I'd add is a guard for the empty-channel case so <code>lastSeq</code> doesn't go negative. Otherwise this is safe to cut.",
  },
  {
    who: "arach",
    time: "3:06 PM",
    html: "Good catch. Atlas, add the guard and it ships in v0.2.1. Echo's tagging the release now.",
  },
  {
    who: "atlas",
    time: "3:08 PM",
    html: "Guard's in (<code>Math.max(0, lastSeq)</code>) and tested against an empty channel. Pushed to <code>feat/broker-cursor</code> — green.",
  },
];

export default function ScoutCommsChannelsStudy() {
  return (
    <ScoutStudyShell
      pageId="scout-comms-channels"
      title="Scout — Comms · Channels"
      blurb={
        <>
          The group-conversation surface in the{" "}
          <code className="font-mono text-[11px] text-studio-ink">sprite</code> identity
          language — kept as quiet as scout-comms. One sprite leads each channel row
          (the most recent speaker); unread is just a bolder name. In the thread the
          operator's sprite wears a thin accent ring and nothing else marks "you". The
          sprites carry identity; everything else recedes.
        </>
      }
    >
      <ScoutWindow title="scout · comms · channels">
        <div className={styles.comms}>
          {/* ── Channel list ───────────────────────────────────────── */}
          <aside className={styles.list}>
            <div className={styles.listHead}>
              <span className={styles.listTitle}>Channels</span>
              <span className={styles.listCount}>{CHANNELS.length}</span>
            </div>
            <div className={styles.search}>
              <SearchGlyph />
              <span>Search channels</span>
            </div>
            <div className={styles.rows}>
              {CHANNELS.map((c) => (
                <ChannelRow key={c.id} c={c} />
              ))}
            </div>
          </aside>

          {/* ── Thread ─────────────────────────────────────────────── */}
          <section className={styles.thread}>
            <header className={styles.threadHead}>
              <div className={styles.threadIdent}>
                <div className={styles.threadName}>
                  <span className={styles.hash}>#</span>
                  {ACTIVE.name}
                </div>
                <div className={styles.threadSub}>
                  {ACTIVE.members.map((m) => CAST[m].handle).join(" · ")}
                </div>
              </div>
              <button className={styles.ghostBtn}>
                <EyeGlyph /> Observe
              </button>
            </header>

            <div className={styles.stream}>
              {TURNS.map((t, i) => (
                <ThreadTurn key={i} t={t} />
              ))}
            </div>

            <div className={styles.composer}>
              <div className={styles.composerField}>Message #{ACTIVE.name}…</div>
            </div>
          </section>
        </div>
      </ScoutWindow>
    </ScoutStudyShell>
  );
}

/* ── Channel mark — facepile for group, single sprite for DM ─────────────── */

function ChannelMark({ c }: { c: Channel }) {
  const keys = groupKeys(c);
  if (keys.length <= 1) {
    const p = CAST[keys[0] ?? c.members[0]];
    return (
      <span className={styles.rowSprite}>
        <SpriteAvatar name={p.name} size={28} hue={hueFor(p)} tone={LIVE_TONE} glow={false} />
      </span>
    );
  }
  const [back, front] = keys;
  return (
    <span className={styles.facepile}>
      <span className={styles.facepileBack}>
        <SpriteAvatar name={CAST[back].name} size={20} hue={hueFor(CAST[back])} tone={LIVE_TONE} glow={false} />
      </span>
      <span className={styles.facepileFront}>
        <SpriteAvatar name={CAST[front].name} size={20} hue={hueFor(CAST[front])} tone={LIVE_TONE} glow={false} />
      </span>
    </span>
  );
}

/* ── Channel list row — channel mark, name, preview, time ──────────────────── */

function ChannelRow({ c }: { c: Channel }) {
  return (
    <div className={`${styles.row} ${c.selected ? styles.selected : ""} ${c.unread ? styles.unread : ""}`}>
      <ChannelMark c={c} />
      <span className={styles.body}>
        <span className={styles.topline}>
          <span className={styles.name}>
            <span className={styles.hash}>#</span>
            {c.name}
          </span>
          <span className={styles.time}>{c.time}</span>
        </span>
        <span className={styles.preview}>{c.preview}</span>
      </span>
    </div>
  );
}

/* ── Thread turn — one sprite, operator ringed ──────────────────────────── */

function ThreadTurn({ t }: { t: ThreadTurnData }) {
  const p = CAST[t.who];
  return (
    <div className={styles.turn}>
      <span className={`${styles.turnAvatar} ${p.operator ? styles.turnOp : ""}`}>
        <SpriteAvatar name={p.name} size={28} hue={hueFor(p)} tone={p.operator ? OP_TONE : LIVE_TONE} glow={false} />
      </span>
      <div className={styles.turnBody}>
        <div className={styles.turnHead}>
          <span className={styles.turnAuthor}>{p.name}</span>
          <span className={styles.turnTime}>{t.time}</span>
        </div>
        <div className={styles.turnText} dangerouslySetInnerHTML={{ __html: t.html }} />
        {t.card ? (
          <div className={styles.fileCard}>
            <div className={styles.fileCardHead}>
              <FileGlyph />
              {t.card.head}
            </div>
            <div className={styles.fileCardBody}>{t.card.body}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Glyphs ──────────────────────────────────────────────────────────────── */

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
