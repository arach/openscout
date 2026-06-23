"use client";

import { useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import { HarnessMark } from "@/components/HarnessMark";
import styles from "./screen-headers.module.css";

/**
 * Screen headers — one treatment, shown in a real window.
 *
 * One header language across Tail, Agents, and Repos, in an actual app window
 * (chrome + left nav + full page layout). The locked treatment is *minimal*:
 *
 *   · Grotesk title (Space Grotesk — the lattices face), NO glyph, NO lead dot.
 *   · A quiet mono status line (sentence case, recedes behind the title).
 *   · One row of chrome — soft search + icon-only controls + a single
 *     segmented toggle. Everything else is the stream.
 *
 * Tail renders as the dense firehose it is — provider mark badges the path,
 * kind glyph leads the event, two-tone paths.
 */

type ScreenKey = "tail" | "agents" | "repos";
type KindKey = "read" | "edit" | "git" | "grep" | "session" | "build" | "run" | "tool";
type Tone = "live" | "dim";

type TailRow = {
  time: string;
  repo: string;
  ref: string;
  harness: string;
  kind: KindKey;
  event: string;
  tone?: Tone;
};

const TAIL: TailRow[] = [
  { time: "09:42:58", repo: "lattices", ref: "/4f8a16d2:5120", harness: "claude", kind: "build", event: "bundle built in 4.2s · 0 warnings", tone: "live" },
  { time: "09:42:55", repo: "openscout", ref: "/a60911d5:6575", harness: "claude", kind: "edit", event: "Edit broker/service.ts" },
  { time: "09:42:53", repo: "openscout", ref: "/a60911d5:6575", harness: "claude", kind: "read", event: "Read views/scout-tail.tsx" },
  { time: "09:42:52", repo: "openscout", ref: "/7f10c3aa:4894", harness: "codex", kind: "session", event: "session relay-openscout-codex started", tone: "live" },
  { time: "09:42:49", repo: "hudson", ref: "/9b2e7c14:4821", harness: "gemini", kind: "grep", event: "Grep data-scout-skin · 14 hits", tone: "dim" },
  { time: "09:42:47", repo: "narrative-studio", ref: "/2c83de01:5331", harness: "cursor", kind: "edit", event: "Edit timeline/Track.tsx" },
  { time: "09:42:44", repo: "openscout", ref: "/a60911d5:6575", harness: "claude", kind: "git", event: "rebased main onto origin — 2 ahead, clean" },
  { time: "09:42:41", repo: "talkie", ref: "/d51a7b90:3309", harness: "codex", kind: "run", event: "bun test packages/runtime · 218 passed", tone: "dim" },
  { time: "09:42:38", repo: "hudson", ref: "/9b2e7c14:4821", harness: "gemini", kind: "read", event: "Read app/shell/WorkspaceShell.tsx" },
  { time: "09:42:36", repo: "openscout", ref: "/a60911d5:6575", harness: "claude", kind: "tool", event: "puppeteer · captured studio-tail.png" },
  { time: "09:42:33", repo: "lattices", ref: "/4f8a16d2:5120", harness: "claude", kind: "edit", event: "Edit tokens/typography.css" },
  { time: "09:42:31", repo: "narrative-studio", ref: "/2c83de01:5331", harness: "cursor", kind: "git", event: "commit 7d4cfa8 — lane-card resize", tone: "dim" },
  { time: "09:42:29", repo: "openscout", ref: "/7f10c3aa:4894", harness: "codex", kind: "edit", event: "Edit packages/protocol/scout-delivery.ts" },
  { time: "09:42:26", repo: "grok-probe", ref: "/be1102fa:7740", harness: "grok", kind: "session", event: "session grok-probe-01 started", tone: "live" },
  { time: "09:42:24", repo: "hudson", ref: "/9b2e7c14:4821", harness: "gemini", kind: "build", event: "bundle built in 2.1s · 0 warnings", tone: "dim" },
  { time: "09:42:21", repo: "openscout", ref: "/a60911d5:6575", harness: "claude", kind: "read", event: "Read packages/runtime/broker-delivery.ts" },
  { time: "09:42:18", repo: "talkie", ref: "/d51a7b90:3309", harness: "codex", kind: "grep", event: "Grep useHudInspector · 6 hits", tone: "dim" },
  { time: "09:42:15", repo: "lattices", ref: "/4f8a16d2:5120", harness: "claude", kind: "edit", event: "Edit components/Lattice.tsx" },
  { time: "09:42:12", repo: "narrative-studio", ref: "/2c83de01:5331", harness: "cursor", kind: "run", event: "vite build · 1.9s", tone: "dim" },
  { time: "09:42:09", repo: "openscout", ref: "/a60911d5:6575", harness: "claude", kind: "git", event: "branch feat/tail-header pushed" },
];

/** Kinds that mark a milestone get the one accent; routine ops stay neutral. */
const MILESTONE: Record<KindKey, boolean> = {
  git: true, build: true, session: true, read: false, edit: false, grep: false, run: false, tool: false,
};

const STATUS = "25 logs · 22 procs · 3 sessions";

type Col = { label: string; align?: "end" };
type Row = { cells: string[]; dim?: boolean };

const LISTS: Record<
  "agents" | "repos",
  { title: string; counts: string; grid: string; cols: Col[]; rows: Row[] }
> = {
  agents: {
    title: "Agents",
    counts: "115 agents · 3 live",
    grid: styles.gAgents,
    cols: [{ label: "Agent" }, { label: "Path" }, { label: "Harness" }, { label: "Updated", align: "end" }],
    rows: [
      { cells: ["Action", "~/dev/action", "claude", "2h ago"] },
      { cells: ["Atelier", "~/dev/atelier", "claude", "4h ago"] },
      { cells: ["Fill Region Tooling", "~/dev/atelier", "codex", "2h ago"], dim: true },
      { cells: ["Contextual", "~/dev/contextual", "gemini", "2h ago"] },
      { cells: ["Devbar", "~/dev/devbar", "claude", "2h ago"], dim: true },
      { cells: ["Grok Logo Primer", "~/dev/atelier", "grok", "3h ago"] },
      { cells: ["Hudson Shell", "~/dev/hudson", "claude", "12m ago"] },
      { cells: ["Lattices Tokens", "~/dev/lattices", "claude", "1h ago"] },
      { cells: ["Narrative Timeline", "~/dev/narrative-studio", "cursor", "5h ago"], dim: true },
      { cells: ["Protocol Delivery", "~/dev/openscout", "codex", "8m ago"] },
      { cells: ["Relay Bridge", "~/dev/openscout", "claude", "3m ago"] },
      { cells: ["Talkie Voice", "~/dev/talkie", "codex", "6h ago"], dim: true },
      { cells: ["Scout iOS Core", "~/dev/openscout", "claude", "22m ago"] },
      { cells: ["Studio Pages", "~/dev/openscout", "gemini", "40m ago"], dim: true },
    ],
  },
  repos: {
    title: "Repos",
    counts: "9 repos · 2 live",
    grid: styles.gRepos,
    cols: [
      { label: "Repo / Branch" },
      { label: "Churn", align: "end" },
      { label: "Files", align: "end" },
      { label: "Agents", align: "end" },
    ],
    rows: [
      { cells: ["openscout · main", "+160 −62", "9", "2 live"] },
      { cells: ["hudson · main", "+19 −6", "9", "1 live"] },
      { cells: ["talkie · main", "+1.4k −214", "18", "17 idle"], dim: true },
      { cells: ["narrative-studio · main", "+80 −12", "688", "1 live"] },
      { cells: ["lattices · main", "—", "—", "16 idle"], dim: true },
      { cells: ["atelier · main", "+44 −9", "12", "3 idle"] },
      { cells: ["action · main", "+7 −2", "4", "1 idle"], dim: true },
      { cells: ["contextual · main", "+210 −88", "31", "1 idle"] },
      { cells: ["grok-probe · main", "+12 −0", "2", "1 live"] },
    ],
  },
};

export default function ScreenHeadersStudy() {
  const [screen, setScreen] = useState<ScreenKey>("tail");

  return (
    <ScoutStudyShell
      pageId="screen-headers"
      title="Screen headers — one treatment"
      blurb={
        <>
          One header language across <b>Tail</b>, <b>Agents</b>, and{" "}
          <b>Repos</b>, in a real window — chrome, left nav, full layout. The
          locked treatment is <b>minimal</b>: grotesk title, a quiet status line,
          one row of chrome, and the stream gets the rest. Click the nav to
          switch screens. Type: Space Grotesk + JetBrains Mono.
        </>
      }
    >
      <ScoutWindow title={`scout · ${screen}`} rail={<NavRail active={screen} onSelect={setScreen} />}>
        <div className={styles.screen}>
          {screen === "tail" ? (
            <TailScreen />
          ) : (
            <ListScreen screen={screen} data={LISTS[screen]} />
          )}
        </div>
      </ScoutWindow>
    </ScoutStudyShell>
  );
}

/* ── Tail — minimal header + the dense firehose ────────────────────────── */
function TailScreen() {
  return (
    <>
      <header className={styles.toolbar}>
        <span className={styles.titleCluster}>
          <h2 className={styles.title}>Tail</h2>
        </span>
        <span className={styles.status}>{STATUS}</span>
        <span className={styles.spring} />
        <GhostSearch placeholder="Search…" compact />
        <IconBtn label="Sources"><FilterGlyph /></IconBtn>
        <IconBtn label="View"><ColumnsGlyph /></IconBtn>
        <span className={styles.vrule} />
        <FollowSeg />
      </header>

      <div className={`${styles.colhead} ${styles.gTail}`}>
        <span>Time</span>
        <span>Path</span>
        <span>Event</span>
      </div>

      <div className={styles.rows}>
        {TAIL.map((r, i) => (
          <div key={i} className={`${styles.row} ${styles.gTail} ${r.tone === "dim" ? styles.rowDim : ""}`}>
            <span className={`${styles.cell} ${styles.time}`}>{r.time}</span>
            <span className={`${styles.cell} ${styles.pathCell}`}>
              <HarnessMark harness={r.harness} size={15} title={null} className={styles.providerMark} />
              <span className={styles.path}>
                <span className={styles.repo}>{r.repo}</span>
                <span className={styles.ref}>{r.ref}</span>
              </span>
            </span>
            <span className={`${styles.cell} ${styles.eventCell}`}>
              <span className={`${styles.kindGlyph} ${MILESTONE[r.kind] ? styles.kindOn : ""}`}>
                <KindMark kind={r.kind} />
              </span>
              <span className={`${styles.msg} ${r.tone === "live" ? styles.msgLive : ""}`}>{r.event}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Agents / Repos — same minimal header language ─────────────────────── */
function ListScreen({
  screen,
  data,
}: {
  screen: "agents" | "repos";
  data: (typeof LISTS)[keyof typeof LISTS];
}) {
  return (
    <>
      <header className={styles.toolbar}>
        <span className={styles.titleCluster}>
          <h2 className={styles.title}>{data.title}</h2>
        </span>
        <span className={styles.status}>{data.counts}</span>
        <span className={styles.spring} />
        {screen === "agents" ? (
          <>
            <GhostSearch placeholder="Filter agents" compact />
            <IconBtn label="Expand"><ColumnsGlyph /></IconBtn>
            <span className={styles.vrule} />
            <Segmented options={["All", "Live"]} active={0} />
          </>
        ) : (
          <IconBtn label="Refresh"><Refresh /></IconBtn>
        )}
      </header>

      <div className={`${styles.colhead} ${data.grid}`}>
        {data.cols.map((c, i) => (
          <span key={i} className={c.align === "end" ? styles.end : undefined}>{c.label}</span>
        ))}
      </div>

      <div className={styles.rows}>
        {data.rows.map((r, i) => (
          <div key={i} className={`${styles.row} ${data.grid} ${r.dim ? styles.rowDim : ""}`}>
            {r.cells.map((cell, j) => {
              const isHarness = screen === "agents" && j === 2;
              const alignEnd = data.cols[j]?.align === "end";
              return (
                <span key={j} className={`${styles.cell} ${alignEnd ? styles.end : ""} ${isHarness ? styles.provider : ""}`}>
                  {isHarness ? (
                    <>
                      <HarnessMark harness={cell} size={13} title={null} />
                      <span className={styles.harnessName}>{cell}</span>
                    </>
                  ) : (
                    cell
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Left nav rail — the app sidebar; click to switch the screen ───────── */
function NavRail({ active, onSelect }: { active: ScreenKey; onSelect: (k: ScreenKey) => void }) {
  return (
    <nav className={styles.nav}>
      <NavItem label="Comms"><ChatGlyph /></NavItem>
      <NavItem label="Agents" on={active === "agents"} onClick={() => onSelect("agents")}><AgentsGlyph /></NavItem>
      <NavItem label="Repos" on={active === "repos"} onClick={() => onSelect("repos")}><BranchGlyph /></NavItem>
      <NavItem label="Tail" on={active === "tail"} onClick={() => onSelect("tail")}><EcgGlyph /></NavItem>
      <span className={styles.navSpring} />
      <NavItem label="Settings"><GearGlyph /></NavItem>
    </nav>
  );
}

function NavItem({ children, label, on, onClick }: { children: React.ReactNode; label: string; on?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.navItem} ${on ? styles.navOn : ""} ${onClick ? "" : styles.navInert}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

/* ── Refined chrome atoms ──────────────────────────────────────────────── */
function GhostSearch({ placeholder, compact }: { placeholder: string; compact?: boolean }) {
  return (
    <span className={`${styles.search} ${compact ? styles.searchCompact : ""}`}>
      <SearchGlyph /> <span className={styles.searchText}>{placeholder}</span>
    </span>
  );
}
function Segmented({ options, active }: { options: string[]; active: number }) {
  return (
    <span className={styles.seg}>
      {options.map((o, i) => (
        <span key={o} className={`${styles.segItem} ${i === active ? styles.segOn : ""}`}>{o}</span>
      ))}
    </span>
  );
}
function FollowSeg() {
  return (
    <span className={styles.seg}>
      <span className={`${styles.segItem} ${styles.segOn} ${styles.segLive}`}><Play /> Follow</span>
      <span className={styles.segItem}><Pause /> Pause</span>
    </span>
  );
}
function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return <span className={styles.iconBtn} title={label} aria-label={label}>{children}</span>;
}

/* ── Kind glyphs — small hand-drawn line marks per event type ───────────── */
function KindMark({ kind }: { kind: KindKey }) {
  const p = { width: 13, height: 13, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "read":
      return <svg {...p}><path d="M2 8s2.2-3.7 6-3.7S14 8 14 8s-2.2 3.7-6 3.7S2 8 2 8Z" /><circle cx="8" cy="8" r="1.6" /></svg>;
    case "edit":
      return <svg {...p}><path d="M11 2.5 13.5 5 6 12.5l-3 .8.8-3z" /></svg>;
    case "git":
      return <svg {...p}><circle cx="4.5" cy="4" r="1.6" /><circle cx="4.5" cy="12" r="1.6" /><circle cx="11.5" cy="6" r="1.6" /><path d="M4.5 5.6v4.8M4.5 8h4.2a2 2 0 0 0 2-2" /></svg>;
    case "grep":
      return <svg {...p}><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></svg>;
    case "session":
      return <svg {...p}><path d="M8 2.5v5" /><path d="M4.6 4.6a4.6 4.6 0 1 0 6.8 0" /></svg>;
    case "build":
      return <svg {...p}><path d="M8 2 13.5 5v6L8 14 2.5 11V5z" /><path d="M2.7 5 8 8l5.3-3M8 8v6" /></svg>;
    case "run":
      return <svg {...p}><path d="M3 8h8" /><path d="M8 5l3 3-3 3" /></svg>;
    case "tool":
      return <svg {...p}><path d="M10.5 3.5a2.8 2.8 0 0 1-3.6 3.6L3.5 10.5a1.5 1.5 0 0 0 2 2l3.4-3.4a2.8 2.8 0 0 1 3.6-3.6L10.8 5l-1.3-1.3z" /></svg>;
  }
}

function SearchGlyph() {
  return <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}
function Play() {
  return <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4 2.5l9 5.5-9 5.5z" /></svg>;
}
function Pause() {
  return <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>;
}
function Refresh() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>;
}
function FilterGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 5h18l-7 8v5l-4 2v-7z" /></svg>;
}
function ColumnsGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3.5" y="4.5" width="17" height="15" rx="1.6" /><path d="M9 4.5v15M15 4.5v15" /></svg>;
}

/* nav glyphs */
function ChatGlyph() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 5h16v11H8l-4 3z" /></svg>;
}
function AgentsGlyph() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3.5" y="4" width="17" height="7" rx="1.6" /><rect x="3.5" y="14" width="17" height="6" rx="1.6" /></svg>;
}
function BranchGlyph() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="7" cy="6" r="2.4" /><circle cx="7" cy="18" r="2.4" /><circle cx="17" cy="9" r="2.4" /><path d="M7 8.4v7.2M7 12h6a2 2 0 0 0 2-2v-.4" /></svg>;
}
function EcgGlyph() {
  return <svg width="18" height="13" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 7h4.2l2-4.5 3 9 2.4-6 1.6 3H21" /></svg>;
}
function GearGlyph() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></svg>;
}
