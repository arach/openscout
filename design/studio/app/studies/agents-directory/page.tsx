"use client";

import { useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutPageHeader } from "@/components/scout/ScoutSurface";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { HarnessMark } from "@/components/HarnessMark";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Agents · Directory — the gmail model.

   Three panes, like an email client:
   • RAIL (folders) — smart views (Needs you · Working · All) over the projects,
     which are the labels. Light, scannable; counts only where they earn it.
   • LIST (the inbox of work) — a dense, triage-first list of THREADS. A thread
     is one work session; the agent (project · harness) is the sender, the task
     is the subject, the branch is the snippet. needs-you reads like unread:
     bold, an accent rule on the left edge.
   • READING PANE — the opened thread: who/where, the live action, the
     transcript, a reply box.

   Same settled model underneath — agent = (project · harness) rollup, leaf =
   session — just triaged like mail instead of browsed like a tree.
   ──────────────────────────────────────────────────────────────────────── */

type Session = { branch: string; task: string; state: "working" | "idle"; ago: string; needs?: boolean };
type Agent = { harness: string; sessions: Session[] };
type Project = { key: string; name: string; root: string; agents: Agent[] };

const HARNESS_HUE: Record<string, number> = { claude: 28, codex: 210, grok: 280 };

const PROJECTS: Project[] = [
  {
    key: "openscout",
    name: "openscout",
    root: "~/dev/openscout",
    agents: [
      {
        harness: "claude",
        sessions: [
          { branch: "feat/lane-card-resize", task: "agents directory · gmail model", state: "working", ago: "2m" },
          { branch: "codex/preserve-in-flight", task: "preserve in-flight work", state: "idle", ago: "1h" },
          { branch: "codex/integrate-broker", task: "integrate broker review fixes", state: "idle", ago: "3h" },
          { branch: "feat/lane-detail-cockpit", task: "lane detail cockpit", state: "idle", ago: "5h" },
          { branch: "main", task: "knowledge index sweep", state: "idle", ago: "1d" },
        ],
      },
      {
        harness: "codex",
        sessions: [
          { branch: "codex/preserve-in-flight", task: "IA review · directory model", state: "working", ago: "8m" },
          { branch: "feat/lane-card-resize", task: "collapse instances", state: "idle", ago: "21m" },
          { branch: "codex/integrate-broker", task: "broker review fixes", state: "idle", ago: "4h" },
          { branch: "feat/lane-detail-cockpit", task: "lane detail cockpit", state: "idle", ago: "6h" },
        ],
      },
      {
        harness: "grok",
        sessions: [
          { branch: "feat/lane-card-resize", task: "landing screenshots", state: "working", ago: "5m" },
          { branch: "feat/lane-card-resize", task: "contrast pass", state: "idle", ago: "3h" },
        ],
      },
    ],
  },
  {
    key: "hudson",
    name: "hudson",
    root: "~/dev/hudson",
    agents: [
      {
        harness: "codex",
        sessions: [
          { branch: "main", task: "confirm merge to main", state: "working", ago: "now", needs: true },
          { branch: "feat/ui-keyboard", task: "HudsonUIKeyboard", state: "idle", ago: "14m" },
          { branch: "feat/voice-gating", task: "voice gating", state: "idle", ago: "1h" },
        ],
      },
    ],
  },
  {
    key: "talkie",
    name: "talkie",
    root: "~/dev/talkie",
    agents: [
      {
        harness: "codex",
        sessions: [
          { branch: "codex/agent-controls", task: "overlay readouts", state: "working", ago: "12m" },
          { branch: "feat/ios-shell", task: "ios shell phase 0", state: "idle", ago: "1d" },
        ],
      },
      { harness: "claude", sessions: [{ branch: "main", task: "dictation mic affordance", state: "idle", ago: "14h" }] },
    ],
  },
  {
    key: "landing",
    name: "landing",
    root: "~/dev/openscout/landing",
    agents: [
      {
        harness: "claude",
        sessions: [
          { branch: "feat/landing-page", task: "layered-plain copy pass", state: "working", ago: "9m" },
          { branch: "feat/landing-page", task: "basel system", state: "idle", ago: "2h" },
        ],
      },
    ],
  },
  {
    key: "lattices",
    name: "lattices",
    root: "~/dev/lattices",
    agents: [
      { harness: "codex", sessions: [{ branch: "main", task: "merged PR #250", state: "idle", ago: "22m" }] },
      { harness: "claude", sessions: [{ branch: "feat/layers", task: "layers view behind flag", state: "idle", ago: "2h" }] },
    ],
  },
  {
    key: "dewey",
    name: "dewey",
    root: "~/dev/dewey",
    agents: [
      { harness: "codex", sessions: [{ branch: "main", task: "index rebuild", state: "idle", ago: "2d" }] },
      { harness: "claude", sessions: [{ branch: "feat/search", task: "search ranking", state: "idle", ago: "2d" }] },
    ],
  },
  {
    key: "premotion",
    name: "premotion",
    root: "~/dev/premotion",
    agents: [
      { harness: "codex", sessions: [{ branch: "main", task: "code viewer edits", state: "idle", ago: "2d" }] },
      { harness: "claude", sessions: [{ branch: "feat/editor", task: "editable surface", state: "idle", ago: "2d" }] },
    ],
  },
  {
    key: "preframe",
    name: "preframe",
    root: "~/dev/preframe",
    agents: [
      { harness: "codex", sessions: [{ branch: "main", task: "frame timeline", state: "idle", ago: "2d" }] },
      { harness: "claude", sessions: [{ branch: "feat/capture", task: "capture pipeline", state: "idle", ago: "3d" }] },
    ],
  },
  {
    key: "atelier",
    name: "atelier",
    root: "~/dev/atelier",
    agents: [{ harness: "codex", sessions: [{ branch: "codex/day-stack", task: "day-stack toolset", state: "idle", ago: "4h" }] }],
  },
  {
    key: "usetalkie",
    name: "usetalkie.com",
    root: "~/dev/usetalkie.com",
    agents: [
      { harness: "codex", sessions: [{ branch: "main", task: "pricing section", state: "idle", ago: "2d" }] },
      { harness: "claude", sessions: [{ branch: "feat/waitlist", task: "waitlist form", state: "idle", ago: "2d" }] },
    ],
  },
  {
    key: "action",
    name: "action",
    root: "~/dev/action",
    agents: [
      { harness: "codex", sessions: [{ branch: "main", task: "shortcut registry", state: "idle", ago: "2d" }] },
      { harness: "claude", sessions: [{ branch: "feat/palette", task: "command palette", state: "idle", ago: "2d" }] },
    ],
  },
  {
    key: "pomo",
    name: "pomo",
    root: "~/dev/pomo",
    agents: [{ harness: "claude", sessions: [{ branch: "master", task: "tray polish", state: "idle", ago: "5h" }] }],
  },
  {
    key: "pomo-tauri",
    name: "pomo-tauri",
    root: "~/dev/pomo-tauri",
    agents: [{ harness: "codex", sessions: [{ branch: "main", task: "tauri shell migration", state: "idle", ago: "10h" }] }],
  },
  {
    key: "iris",
    name: "iris",
    root: "~/dev/iris",
    agents: [{ harness: "claude", sessions: [{ branch: "main", task: "palette extraction", state: "idle", ago: "2d" }] }],
  },
  {
    key: "pi-scout",
    name: "pi-scout",
    root: "~/dev/pi-scout",
    agents: [{ harness: "grok", sessions: [{ branch: "main", task: "scout pi backend", state: "idle", ago: "2d" }] }],
  },
  {
    key: "arach",
    name: "arach",
    root: "~/dev/arach",
    agents: [{ harness: "claude", sessions: [{ branch: "main", task: "portfolio refresh", state: "idle", ago: "5d" }] }],
  },
  {
    key: "arc",
    name: "arc",
    root: "~/dev/arc",
    agents: [{ harness: "codex", sessions: [{ branch: "main", task: "arc graph layout", state: "idle", ago: "6d" }] }],
  },
  {
    key: "contextual",
    name: "contextual",
    root: "~/dev/contextual",
    agents: [{ harness: "claude", sessions: [{ branch: "main", task: "context window viz", state: "idle", ago: "8d" }] }],
  },
];

/* ── threads — flatten sessions into the inbox unit ──────────────────────
   A thread is one work session. The agent (project · harness) is the sender. */
type Thread = {
  id: string;
  project: string;
  projectKey: string;
  root: string;
  harness: string;
  branch: string;
  task: string;
  state: "working" | "idle";
  ago: string;
  needs?: boolean;
};

const THREADS: Thread[] = PROJECTS.flatMap((p) =>
  p.agents.flatMap((a) =>
    a.sessions.map((s, i) => ({
      id: `${p.key}-${a.harness}-${i}`,
      project: p.name,
      projectKey: p.key,
      root: p.root,
      harness: a.harness,
      branch: s.branch,
      task: s.task,
      state: s.state,
      ago: s.ago,
      needs: s.needs,
    })),
  ),
);

const rank = (t: Thread) => (t.needs ? 2 : t.state === "working" ? 1 : 0);
const byAttention = (a: Thread, b: Thread) => rank(b) - rank(a);

function threadsFor(folderId: string): Thread[] {
  let list: Thread[];
  if (folderId === "needs") list = THREADS.filter((t) => t.needs);
  else if (folderId === "working") list = THREADS.filter((t) => t.state === "working");
  else if (folderId === "all") list = THREADS;
  else if (folderId.startsWith("proj:")) list = THREADS.filter((t) => t.projectKey === folderId.slice(5));
  else list = THREADS;
  return [...list].sort(byAttention);
}

// Gmail-style scannability: the live work pins to the top (Needs you · Working),
// the idle tail buckets by recency so a long list reads as structure, not a dump.
function agoBucket(ago: string): string {
  if (ago === "now") return "Today";
  const m = ago.match(/^(\d+)\s*(s|m|h|d|w)$/);
  if (!m) return "Earlier";
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "s" || unit === "m" || unit === "h") return "Today";
  if (unit === "d") return n === 1 ? "Yesterday" : n <= 6 ? "This week" : "Earlier";
  return "Earlier";
}

const SECTION_ORDER = ["Needs you", "Working", "Today", "Yesterday", "This week", "Earlier"];

function sectionsFor(threads: Thread[]): Array<{ label: string; threads: Thread[] }> {
  const buckets = new Map<string, Thread[]>();
  const push = (label: string, t: Thread) => {
    const list = buckets.get(label) ?? [];
    list.push(t);
    buckets.set(label, list);
  };
  for (const t of threads) {
    if (t.needs) push("Needs you", t);
    else if (t.state === "working") push("Working", t);
    else push(agoBucket(t.ago), t);
  }
  return SECTION_ORDER.filter((l) => buckets.has(l)).map((label) => ({ label, threads: buckets.get(label)! }));
}

const NEEDS_COUNT = THREADS.filter((t) => t.needs).length;
const WORKING_COUNT = THREADS.filter((t) => t.state === "working").length;

const projWorking = (key: string) => THREADS.filter((t) => t.projectKey === key && t.state === "working").length;
const projNeeds = (key: string) => THREADS.some((t) => t.projectKey === key && t.needs);
const projRank = (key: string) => (projNeeds(key) ? 2 : projWorking(key) > 0 ? 1 : 0);
const ORDERED_PROJECTS = [...PROJECTS].sort((a, b) => projRank(b.key) - projRank(a.key));

/* ── rail · folders ──────────────────────────────────────────────────── */

function FolderRow({
  name,
  selected,
  onSelect,
  state,
  count,
  countTone,
}: {
  name: string;
  selected: boolean;
  onSelect: () => void;
  state: "needs" | "working" | "idle";
  count?: number;
  countTone?: "accent" | "dim";
}) {
  return (
    <button type="button" className={styles.fold} data-selected={selected || undefined} data-state={state} onClick={onSelect}>
      <span className={styles.foldPip} aria-hidden />
      <span className={styles.foldName}>{name}</span>
      {count && count > 0 ? (
        <span className={`${styles.foldCount}${countTone === "dim" ? ` ${styles.foldCountDim}` : ""}`}>{count}</span>
      ) : null}
    </button>
  );
}

/* ── list · the inbox of work ────────────────────────────────────────── */

function ThreadRow({
  t,
  crossProject,
  selected,
  onSelect,
  onOpen,
}: {
  t: Thread;
  crossProject: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const working = t.state === "working";
  return (
    <button
      type="button"
      className={styles.thread}
      data-selected={selected || undefined}
      data-needs={t.needs || undefined}
      onClick={onSelect}
    >
      <span className={`${styles.threadAv}${working ? ` ${styles.avLive}` : ""}`}>
        <SpriteAvatar
          name={`${t.projectKey}-${t.harness}`}
          size={30}
          hue={HARNESS_HUE[t.harness]}
          tile
          corner={working ? "var(--s-accent)" : "var(--s-dim)"}
          cornerPulse={working}
        />
      </span>
      <span className={styles.threadBody}>
        <span className={styles.threadTop}>
          <span className={styles.threadFrom}>{crossProject ? `${t.project} · ${t.harness}` : t.harness}</span>
          <span className={styles.threadHmark} aria-hidden>
            <HarnessMark harness={t.harness} size={11} />
          </span>
          <span className={styles.threadAgo}>{t.ago}</span>
        </span>
        <span className={styles.threadSub}>
          {working ? <span className={styles.nowArrow} aria-hidden>❯ </span> : null}
          {t.task}
        </span>
        <span className={styles.threadSnip}>
          <span className={styles.threadBranch}>{t.branch}</span>
          {t.needs ? (
            <span className={styles.threadNeeds}>needs you</span>
          ) : working ? (
            <span className={styles.threadLive}>live</span>
          ) : null}
        </span>
      </span>
      <span className={styles.threadActions}>
        <span
          className={styles.threadAct}
          role="button"
          title={working ? "Open session" : "Reopen"}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <IcoOpen />
        </span>
        <span
          className={styles.threadAct}
          role="button"
          title="Archive — dismiss from inbox"
          onClick={(e) => e.stopPropagation()}
        >
          <IcoArchive />
        </span>
      </span>
    </button>
  );
}

/* ── reading pane · the opened thread ────────────────────────────────── */

// Identity readout for the header — model name + a stable short commit hash.
const MODEL_FOR: Record<string, string> = { claude: "opus-4.8", codex: "gpt-5.1-codex", grok: "grok-4.3" };

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function cockpitFor(t: Thread) {
  const h = hash(t.id + t.task);
  return {
    model: MODEL_FOR[t.harness] ?? t.harness,
    commit: h.toString(16).slice(0, 7),
  };
}

function diffFor(t: Thread) {
  const h = (t.task.length * 37 + t.branch.length * 11) >>> 0;
  return [
    { ref: t.branch, title: t.task, add: 12 + (h % 160), del: h % 50, ago: t.ago },
    { ref: t.branch, title: "wire actions · tab content", add: 24 + (h % 90), del: 6 + (h % 22), ago: "1h" },
  ];
}

function ReadingPane({
  t,
  expanded,
  onExpand,
  onCollapse,
}: {
  t: Thread | undefined;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  if (!t) return <div className={styles.readerEmpty}>Select a thread</div>;
  const working = t.state === "working";
  const tone = t.needs ? "needs" : working ? "live" : "idle";
  const ck = cockpitFor(t);

  return (
    <>
      <header className={styles.readHead}>
        {expanded ? (
          <button type="button" className={styles.readBack} title="Back to inbox" onClick={onCollapse}>
            <IcoBack />
          </button>
        ) : null}
        <span className={working ? styles.avLive : undefined}>
          <SpriteAvatar
            name={`${t.projectKey}-${t.harness}`}
            size={40}
            hue={HARNESS_HUE[t.harness]}
            tile
            corner={working ? "var(--s-accent)" : "var(--s-dim)"}
            cornerPulse={working}
          />
        </span>
        <div className={styles.readIdent}>
          <div className={styles.readTop}>
            <span className={styles.readName}>{t.harness}</span>
            <span className={styles.readHmark} aria-hidden>
              <HarnessMark harness={t.harness} size={13} />
            </span>
            <span className={styles.readProj}>{t.project}</span>
          </div>
          <div className={styles.readSub}>
            <span className={styles.readBranch}>{t.branch}</span>
            <span className={styles.readMeta}>{ck.model}</span>
            <span className={styles.readMeta} data-dim>{ck.commit}</span>
            <span className={styles.readStatus} data-tone={tone}>
              {tone === "needs" ? "needs you" : tone === "live" ? <><span className={styles.livePip} aria-hidden /> live</> : "idle"}
            </span>
          </div>
        </div>
        <div className={styles.readActions}>
          {!expanded ? (
            <button type="button" className={styles.readActBtn} title="Open session — expand" onClick={onExpand}>
              <IcoOpen />
            </button>
          ) : null}
          <button type="button" className={styles.readActBtn} title="More — rename · mute · new session · close">
            <IcoMore />
          </button>
        </div>
      </header>

      {/* GLANCE-BRIEF — only what helps you pick the right agent + steer it.
          Profile · chat · trace · takeover are full surfaces; route OUT to them. */}
      <div className={styles.readBody}>
        <div className={styles.brief}>
          <h2 className={styles.briefHeadline}>{t.task}</h2>
          <div className={styles.briefStatus}>
            {t.needs ? (
              <><span className={styles.briefDot} data-tone="needs" aria-hidden /> waiting on your go-ahead</>
            ) : working ? (
              <><span className={styles.briefDot} data-tone="live" aria-hidden /> <span className={styles.nowArrow} aria-hidden>❯ </span> working now · {t.ago}</>
            ) : (
              <>wrapped {t.ago} ago · ready for review</>
            )}
          </div>
          <div className={styles.briefActions}>
            {t.needs ? (
              <>
                <button type="button" className={`${styles.steerBtn} ${styles.steerBtnPrimary}`}>Approve &amp; continue</button>
                <button type="button" className={styles.steerBtn}>Redirect…</button>
              </>
            ) : working ? (
              <button type="button" className={styles.steerBtn}>Redirect…</button>
            ) : (
              <button type="button" className={styles.steerBtn}>Resume · new direction</button>
            )}
          </div>
        </div>

        {/* produced — its output in one line, so you know what it made */}
        <div className={styles.steerSection}>
          <div className={styles.steerSectionHead}>Produced</div>
          {diffFor(t).map((c, i) => (
            <div key={i} className={styles.rchange}>
              <span className={styles.rchangeMark} style={{ background: `hsl(${HARNESS_HUE[t.harness] ?? 220} 55% 60%)` }} aria-hidden />
              <div className={styles.rchangeBody}>
                <div className={styles.rchangeTop}>
                  <span className={styles.rchangeRef}>{c.ref}</span>
                  <span className={styles.rchangeAgo}>{c.ago}</span>
                </div>
                <div className={styles.rchangeBottom}>
                  <span className={styles.rchangeTitle}>{c.title}</span>
                  <span className={styles.rchangeDiff}>
                    <span className={styles.rchangeAdd}>+{c.add}</span>
                    <span className={styles.rchangeDel}>−{c.del}</span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* route-out — the deep surfaces live elsewhere; this is the dispatcher */}
        <div className={styles.routeOut}>
          {["Conversation", "Trace", "Profile", "Take over"].map((label) => (
            <button key={label} type="button" className={styles.routeBtn}>
              {label} <span className={styles.routeArrow} aria-hidden>↗</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.readFoot}>
        <span className={styles.readReply}>Steer {t.harness} — a directive…</span>
        <button type="button" className={`${styles.readBtn} ${styles.readBtnPrimary}`}>Send</button>
      </div>
    </>
  );
}

/* ── icons ───────────────────────────────────────────────────────────── */
function IcoSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IcoOpen() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M9 3h4v4M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IcoArchive() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="3" width="11" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 6v6.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V6M6.5 9h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IcoMore() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="8" r="1.1" fill="currentColor" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}
function IcoGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IcoBack() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function AgentsDirectoryStudy() {
  const [folder, setFolder] = useState("all");
  const [selectedId, setSelectedId] = useState<string | undefined>(threadsFor("all").sort(byAttention)[0]?.id);
  const [expanded, setExpanded] = useState(false);

  const threads = threadsFor(folder);
  const selected = THREADS.find((t) => t.id === selectedId);
  const crossProject = !folder.startsWith("proj:");

  const folderName =
    folder === "needs" ? "Needs you" : folder === "working" ? "Working" : folder === "all" ? "All" : PROJECTS.find((p) => p.key === folder.slice(5))?.name ?? "All";

  const selectFolder = (id: string) => {
    setFolder(id);
    setExpanded(false);
    const first = threadsFor(id)[0];
    if (first) setSelectedId(first.id);
  };

  const openThread = (id: string) => {
    setSelectedId(id);
    setExpanded(true);
  };

  return (
    <ScoutStudyShell
      pageId="agents-directory"
      title="Agents · Directory"
      initialSkin="graphite"
      blurb={
        <>
          The gmail model. <strong>Folders</strong> (rail) = smart views over the projects —
          your projects are the labels. <strong>The inbox</strong> = a triage-first list of
          work <em>threads</em>; the agent <code>(project · harness)</code> is the sender, the
          task is the subject, and <strong>needs-you</strong> reads like unread. <strong>Reading
          pane</strong> opens the thread — live action, transcript, reply. Same settled model
          (agent rollup → session), triaged like mail.
        </>
      }
    >
      <div className={styles.surface}>
        <ScoutPageHeader
          title="agents"
          live
          counts={[
            { n: PROJECTS.length, label: "projects" },
            { n: WORKING_COUNT, label: "working", tone: "accent" },
            { n: NEEDS_COUNT, label: "need you", tone: "accent" },
          ]}
        />
        <div className={styles.mail} data-expanded={expanded || undefined}>
          {/* RAIL — folders */}
          <nav className={styles.rail} aria-label="Folders">
            <div className={styles.railHead}>
              <button type="button" className={styles.railNew}>
                <span className={styles.railPlus} aria-hidden>＋</span> New chat
              </button>
            </div>

            <div className={styles.railBody}>
              <div className={styles.railGroup}>
                <div className={styles.railLabel}>Views</div>
                <FolderRow
                  name="Needs you"
                  selected={folder === "needs"}
                  onSelect={() => selectFolder("needs")}
                  state={NEEDS_COUNT > 0 ? "needs" : "idle"}
                  count={NEEDS_COUNT}
                  countTone="accent"
                />
                <FolderRow
                  name="Working"
                  selected={folder === "working"}
                  onSelect={() => selectFolder("working")}
                  state={WORKING_COUNT > 0 ? "working" : "idle"}
                  count={WORKING_COUNT}
                  countTone="accent"
                />
                <FolderRow
                  name="All"
                  selected={folder === "all"}
                  onSelect={() => selectFolder("all")}
                  state="idle"
                  count={THREADS.length}
                  countTone="dim"
                />
              </div>

              <div className={styles.railGroup}>
                <div className={styles.railLabel}>Projects</div>
                {ORDERED_PROJECTS.map((p) => {
                  const working = projWorking(p.key);
                  const needs = projNeeds(p.key);
                  return (
                    <FolderRow
                      key={p.key}
                      name={p.name}
                      selected={folder === `proj:${p.key}`}
                      onSelect={() => selectFolder(`proj:${p.key}`)}
                      state={needs ? "needs" : working > 0 ? "working" : "idle"}
                      count={working}
                      countTone="accent"
                    />
                  );
                })}
              </div>
            </div>

            <div className={styles.railFoot}>
              <button type="button" className={styles.railFootBtn}>
                <span className={styles.railFootIco} aria-hidden>
                  <IcoGear />
                </span>
                Settings
              </button>
            </div>
          </nav>

          {/* LIST — the inbox of work */}
          <div className={styles.list}>
            <div className={styles.listHead}>
              <span className={styles.listTitle}>{folderName}</span>
              <span className={styles.listCount}>{threads.length}</span>
              <button type="button" className={styles.listSearch} aria-label="Search">
                <IcoSearch />
              </button>
            </div>
            <div className={styles.threads}>
              {sectionsFor(threads).map((section) => (
                <div key={section.label} className={styles.threadSection}>
                  <div className={styles.threadSectionHead} data-tone={section.label === "Needs you" ? "needs" : section.label === "Working" ? "live" : "idle"}>
                    <span className={styles.threadSectionLabel}>{section.label}</span>
                    <span className={styles.threadSectionCount}>{section.threads.length}</span>
                  </div>
                  {section.threads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      t={t}
                      crossProject={crossProject}
                      selected={t.id === selectedId}
                      onSelect={() => setSelectedId(t.id)}
                      onOpen={() => openThread(t.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* READING PANE */}
          <div className={styles.reader}>
            <ReadingPane
              t={selected}
              expanded={expanded}
              onExpand={() => setExpanded(true)}
              onCollapse={() => setExpanded(false)}
            />
          </div>
        </div>
      </div>
    </ScoutStudyShell>
  );
}
