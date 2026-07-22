"use client";

/**
 * HUD Redesign — the HUD screens re-evaluated around one thesis: the
 * object is WORK (a titled unit), agent + project are facets, attention
 * is the precedence layer, and the default target is where you are.
 *
 * Simplified pass (fewer screens, fewer lines):
 *   · focus + recent MERGED into one tab — ON YOU on top, RECENT below.
 *     "Recent" was never a separate screen; it's a section of focus.
 *   · focus rows cut to two lines (title + attribution). No detail line,
 *     no steer chip — the row itself is the steer target.
 *   · tail left as the established raw stream — no extra framing.
 *   · the top-right "on you" pip removed — the ON YOU header already
 *     carries the count; a second copy in the corner was just noise.
 *   · Scout kept as-is.
 *
 * Four tabs: focus · threads · tail · scout. Self-contained (data
 * reshaped from components/hud/mock.ts) so it reads as a proposal.
 */

import {
  ResearchBlock,
  ResearchHeader,
  SourceLinks,
} from "@/components/studio/research";
import { MessageComposer } from "@/components/MessageComposer";
import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────
// Model — WORK is the noun. Agent + project are facets on the row.
// ─────────────────────────────────────────────────────────────────────

type Lane = "on-you" | "moving" | "quiet";

interface Work {
  id: string;
  title: string; // work-as-title — the headline the operator reads first
  agent: string; // attribution facet
  project: string; // grouping facet
  ago: string;
  lane: Lane;
  live?: boolean;
  awaiting?: string; // what it's waiting on, when it isn't you
}

// Ordered by recency — on-you items get pulled to the top by the view.
const WORKS: Work[] = [
  { id: "w-qb", title: "Push 0c8fee to staging?", agent: "@qb", project: "control-plane", ago: "1m", lane: "on-you" },
  { id: "w-pike", title: "macOS build failed — missing entitlement", agent: "@pike", project: "openscout", ago: "37m", lane: "on-you" },
  { id: "w-hudson", title: "Inspector atom rollout — PR #214", agent: "@hudson", project: "openscout", ago: "12s", lane: "moving", live: true },
  { id: "w-atlas", title: "Audit trail across both schemas", agent: "@atlas", project: "control-plane", ago: "4m", lane: "moving", awaiting: "@drover" },
  { id: "w-scout", title: "Index refresh — 14 files", agent: "@scout", project: "openscout", ago: "4m", lane: "quiet" },
  { id: "w-drover", title: "Migration sweep — 6 files", agent: "@drover", project: "control-plane", ago: "32m", lane: "quiet" },
  { id: "w-cobalt", title: "Atlas iconography sweep", agent: "@cobalt", project: "design/studio", ago: "2h", lane: "quiet" },
];

// ─── Tail — the established raw stream, unchanged.
type Tail = { at: string; kind: string; attn?: boolean; source: string; line: string };
const TAIL: Tail[] = [
  { at: "14:32:14", kind: "EDT", source: "hudson", line: "atoms/agent-row.tsx · +42 -18" },
  { at: "14:32:02", kind: "TUR", source: "hudson", line: "Pulled AgentRow into a shared atom." },
  { at: "14:31:48", kind: "BRK", source: "broker", line: "ping · 14 agents · 3 live · rtt 9ms" },
  { at: "14:31:31", kind: "ASK", attn: true, source: "qb", line: "Push 0c8fee to staging? Migration runs on deploy." },
  { at: "14:30:41", kind: "TUR", source: "scout", line: "Indexed 14 new files under scout/inspector." },
  { at: "14:29:33", kind: "TOL", source: "drover", line: "Bash(swift build -c release)" },
  { at: "14:26:31", kind: "ERR", attn: true, source: "pike", line: "exit 65 · code signing failed — entitlements missing" },
  { at: "14:24:22", kind: "EDT", source: "drover", line: "atoms/inspector-section/header.tsx · +18 -4" },
  { at: "14:23:11", kind: "MSG", source: "qb", line: "→ @hudson: on the deploy or held?" },
];

// ─── Threads — conversations. Subject = work, sender = agent, two lines.
type Thread = { subject: string; agent: string; ago: string; status: string; tone: "attn" | "live" | "quiet"; last: string };
const THREADS: Thread[] = [
  { subject: "Deploy 0c8fee", agent: "@qb", ago: "1m", status: "awaiting you", tone: "attn", last: "Migration runs on deploy — hold or roll it?" },
  { subject: "macOS build", agent: "@pike", ago: "37m", status: "failed", tone: "attn", last: "Missing entitlement for screen capture." },
  { subject: "Inspector atom rollout", agent: "@hudson", ago: "12s", status: "working", tone: "live", last: "Pulled AgentRow into a shared atom." },
  { subject: "Broker link", agent: "@atlas", ago: "11m", status: "awaiting @drover", tone: "quiet", last: "Holding for the migration file." },
  { subject: "Migration sweep", agent: "@drover", ago: "32m", status: "wound down", tone: "quiet", last: "Six files rewritten, diff handed back." },
  { subject: "Iconography", agent: "@cobalt", ago: "2h", status: "wound down", tone: "quiet", last: "Three glyphs left to redraw." },
];

// ─────────────────────────────────────────────────────────────────────
// Frame
// ─────────────────────────────────────────────────────────────────────

type Tab = "focus" | "threads" | "tail" | "scout";

const TABS: { key: Tab; num: string; label: string; robot?: boolean }[] = [
  { key: "focus", num: "1", label: "focus" },
  { key: "threads", num: "2", label: "threads" },
  { key: "tail", num: "3", label: "tail" },
  { key: "scout", num: "4", label: "scout", robot: true },
];

const ACCENT = "var(--scout-accent)";
// Wider than compact (420) so titles + attribution stay one-liners.
// Taller to give the universal MessageComposer room at the bottom.
const PANEL_W = 620;
const PANEL_H = 560;

function Panel({ tab, place, startDockOpen, children }: { tab: Tab; place: string; startDockOpen?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-[10px] border border-studio-edge bg-studio-canvas shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]"
      style={{ width: PANEL_W, height: PANEL_H }}
    >
      <Masthead active={tab} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <Dock place={place} startOpen={startDockOpen} />
    </div>
  );
}

function Masthead({ active }: { active: Tab }) {
  return (
    <header className="border-b border-studio-edge px-4 pt-2.5 pb-2">
      <div className="flex items-end gap-0">
        <span
          aria-hidden
          className="grid h-3.5 w-3.5 shrink-0 translate-y-[-1px] self-end place-items-center rounded-full border border-studio-edge-strong"
        >
          <span className="h-[3px] w-[3px] rounded-full" style={{ background: ACCENT }} />
        </span>
        <span className="mx-3" />
        {TABS.map((t, i) => (
          <span key={t.key} className="flex items-end">
            {i > 0 ? <span className="mx-2 self-end pb-[3px] font-mono text-[10px] text-studio-ink-faint">·</span> : null}
            <span className="flex flex-col items-start">
              <span className="flex items-baseline gap-1">
                {t.robot ? (
                  <span className="translate-y-[1px] font-mono text-[10px]" style={{ color: active === t.key ? ACCENT : "var(--studio-ink-faint)" }}>
                    ▟
                  </span>
                ) : null}
                <span className="font-mono text-[10px] font-bold" style={{ color: active === t.key ? ACCENT : "var(--studio-ink-faint)" }}>
                  {t.num}
                </span>
                <span
                  className={
                    active === t.key
                      ? "font-sans text-[12px] font-semibold lowercase text-studio-ink"
                      : "font-sans text-[12px] lowercase text-studio-ink-faint"
                  }
                >
                  {t.label}
                </span>
              </span>
              <span aria-hidden className="mt-[2px] block h-[1.5px] w-full" style={{ background: active === t.key ? ACCENT : "transparent" }} />
            </span>
          </span>
        ))}
      </div>
    </header>
  );
}

// The universal MessageComposer (shared atom; production twin at
// packages/web/client/components/MessageComposer), collapsed at rest and
// grown into on engage. Resting = a slim place chip + grammar hint; click
// or focus expands it into the full composer (height grows via grid-rows).
// Esc or blur-when-empty collapses it back. Place-default addressing rides
// in the header slot; the @work/#project grammar is the placeholder.
function Dock({ place, startOpen = false }: { place: string; startOpen?: boolean }) {
  const [engaged, setEngaged] = useState(startOpen);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={ref}
      className="border-t border-studio-edge bg-studio-canvas"
      onBlur={(e) => {
        // collapse when focus leaves the whole dock with no draft in flight
        if (!e.currentTarget.contains(e.relatedTarget as Node) && !text.trim()) {
          setEngaged(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setText("");
          setEngaged(false);
          (document.activeElement as HTMLElement | null)?.blur();
        }
      }}
    >
      {engaged ? (
        <DockComposer place={place} text={text} setText={setText} containerRef={ref} />
      ) : (
        <div className="p-2">
          <button
            type="button"
            onClick={() => setEngaged(true)}
            className="group flex w-full items-center gap-2 rounded-[14px] border border-studio-edge bg-studio-surface px-3.5 py-2.5 text-left transition-colors hover:border-studio-ink/35"
          >
            <span aria-hidden className="font-mono text-[10px]" style={{ color: ACCENT }}>▸</span>
            <span className="font-mono text-[10px] text-studio-ink-muted">{place}</span>
            <span aria-hidden className="mx-0.5 h-2.5 w-px bg-studio-edge" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-studio-ink-faint">
              steer here · <span className="text-studio-ink-muted">@work</span> · <span className="text-studio-ink-muted">#project</span> · /
            </span>
            <MicGlyph />
          </button>
        </div>
      )}
    </div>
  );
}

function DockComposer({
  place,
  text,
  setText,
  containerRef,
}: {
  place: string;
  text: string;
  setText: (v: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Mount at 0fr, flip to 1fr next frame so the height animates open. The
  // textarea takes focus so the collapsed→engaged handoff is one gesture.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(true);
    containerRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }, [containerRef]);

  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">
        <MessageComposer
          density="compact"
          rows={1}
          showAttach
          value={text}
          onChange={setText}
          placeholder="steer here · @work to reach · #project to scope · / for commands"
          header={
            <div className="flex items-center gap-1.5 font-mono text-[10px]">
              <span aria-hidden style={{ color: ACCENT }}>▸</span>
              <span className="text-studio-ink-muted">{place}</span>
              <span className="text-studio-ink-faint">— steering here</span>
            </div>
          }
        />
      </div>
    </div>
  );
}

function MicGlyph() {
  return (
    <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center text-studio-ink-faint">
      <svg width={11} height={11} viewBox="0 0 14 14" fill="none">
        <rect x={5} y={2} width={4} height={6.5} rx={2} stroke="currentColor" strokeWidth={1} />
        <path d="M3.5 7.5 A3.5 3.5 0 0 0 10.5 7.5" stroke="currentColor" strokeWidth={1} strokeLinecap="round" />
        <line x1={7} y1={10.5} x2={7} y2={12} stroke="currentColor" strokeWidth={1} strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SectionHead({ label, accent, dim }: { label: string; accent?: boolean; dim?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-studio-edge bg-studio-canvas px-4 pt-3 pb-1.5">
      {accent ? <span className="h-[5px] w-[5px] rounded-full" style={{ background: ACCENT }} /> : null}
      <span
        className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow"
        style={{ color: accent ? ACCENT : dim ? "var(--studio-ink-faint)" : "var(--studio-ink-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 1 · FOCUS — attention-first, and "recent" folded in as a section.
//     Two-line rows: title + attribution. The row is the steer target.
// ─────────────────────────────────────────────────────────────────────

function FocusBody() {
  const onYou = WORKS.filter((w) => w.lane === "on-you");
  const rest = WORKS.filter((w) => w.lane !== "on-you");
  return (
    <div>
      <SectionHead label={`ON YOU · ${onYou.length}`} accent />
      <ul>
        {onYou.map((w) => (
          <WorkRow key={w.id} work={w} emphasize />
        ))}
      </ul>
      <SectionHead label="RECENT" />
      <ul>
        {rest.map((w) => (
          <WorkRow key={w.id} work={w} muted={w.lane === "quiet"} />
        ))}
      </ul>
    </div>
  );
}

function WorkRow({ work, emphasize, muted }: { work: Work; emphasize?: boolean; muted?: boolean }) {
  return (
    <li className={`relative border-b border-studio-edge ${muted ? "opacity-70" : ""}`}>
      {emphasize ? <span aria-hidden className="absolute inset-y-0 left-0 w-[1.5px]" style={{ background: ACCENT }} /> : null}
      <button type="button" className="group w-full px-4 py-2.5 text-left transition-colors hover:bg-studio-canvas-alt">
        <div className="flex items-baseline gap-2">
          {work.live ? <span className="translate-y-[-1px] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: ACCENT }} /> : null}
          <span className="min-w-0 flex-1 truncate font-sans text-[13px] font-medium text-studio-ink">{work.title}</span>
          <span className="shrink-0 pl-2 font-mono text-[10px] tabular-nums text-studio-ink-faint">{work.ago}</span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5 font-mono text-[10px] text-studio-ink-faint">
          <span className="text-studio-ink-muted">{work.agent}</span>
          <span aria-hidden>·</span>
          <span>#{work.project}</span>
          {work.awaiting ? (
            <>
              <span aria-hidden>·</span>
              <span>awaiting {work.awaiting}</span>
            </>
          ) : null}
        </div>
      </button>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2 · THREADS — conversations. Subject line + preview, two lines.
// ─────────────────────────────────────────────────────────────────────

function ThreadsBody() {
  return (
    <ul>
      {THREADS.map((t, i) => {
        const attn = t.tone === "attn";
        return (
          <li key={i} className="relative border-b border-studio-edge">
            {attn ? <span aria-hidden className="absolute inset-y-0 left-0 w-[1.5px]" style={{ background: ACCENT }} /> : null}
            <button type="button" className="group w-full px-4 py-2.5 text-left transition-colors hover:bg-studio-canvas-alt">
              <div className="flex items-baseline gap-2">
                {t.tone === "live" ? <span className="translate-y-[-1px] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: ACCENT }} /> : null}
                <span className="min-w-0 shrink-0 truncate font-sans text-[13px] font-medium leading-none text-studio-ink">{t.subject}</span>
                <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-eyebrow" style={{ color: attn ? ACCENT : "var(--studio-ink-faint)" }}>
                  {t.status}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-studio-ink-faint">{t.ago}</span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5 font-mono text-[10px] text-studio-ink-faint">
                <span className="shrink-0 text-studio-ink-muted">{t.agent}</span>
                <span aria-hidden>·</span>
                <span className="min-w-0 flex-1 truncate">{t.last}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3 · TAIL — the established raw stream, left as-is.
// ─────────────────────────────────────────────────────────────────────

function TailBody() {
  return (
    <ul className="px-4 py-2">
      {TAIL.map((t, i) => (
        <li key={i} className="flex items-baseline gap-2 py-[3px] font-mono text-[10px] leading-snug">
          <span className="shrink-0 tabular-nums text-studio-ink-faint">{t.at}</span>
          <span className="w-[26px] shrink-0 font-semibold" style={{ color: t.attn ? ACCENT : "var(--studio-ink-faint)" }}>
            {t.kind}
          </span>
          <span className="shrink-0 text-studio-ink-muted">{t.source}</span>
          <span className="min-w-0 flex-1 truncate text-studio-ink">{t.line}</span>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 4 · SCOUT — the DM + the refreshed command surface (kept as-is).
// ─────────────────────────────────────────────────────────────────────

function ScoutBody() {
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <ScoutMsg at="14:32">
        Morning — <b className="font-semibold text-studio-ink">2 on you</b>: <Mention>@qb</Mention> wants a deploy call, <Mention>@pike</Mention> failed the build.
      </ScoutMsg>

      <OpMsg>
        <Cmd>/status</Cmd>
      </OpMsg>

      <ScoutMsg at="14:32">
        <div className="flex flex-col gap-1.5">
          <StatusLine accent label="on you" value="2" note="qb · deploy 0c8fee   ·   pike · build failed" />
          <StatusLine label="moving" value="2" note="hudson · PR #214   ·   atlas · audit trail" />
          <StatusLine label="quiet" value="3" note="scout · drover · cobalt" />
        </div>
      </ScoutMsg>

      <OpMsg>
        <Cmd>#openscout</Cmd>
      </OpMsg>

      <ScoutMsg at="14:33">
        In <Path>#openscout</Path>: <Mention>@hudson</Mention> moving on PR #214, <Mention>@pike</Mention> failed the build. Nothing here is waiting on you — the deploy call is in <Path>#control-plane</Path>.
      </ScoutMsg>
    </div>
  );
}

function ScoutMsg({ at, children }: { at: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">scout · {at}</div>
      <div className="font-sans text-[12px] leading-snug text-studio-ink">{children}</div>
    </div>
  );
}

function OpMsg({ children }: { children: React.ReactNode }) {
  return <div className="self-end">{children}</div>;
}

function StatusLine({ label, value, note, accent }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[52px] shrink-0 font-mono text-[10px] font-semibold uppercase tracking-eyebrow" style={{ color: accent ? ACCENT : "var(--studio-ink-faint)" }}>
        {label}
      </span>
      <span className="font-mono text-[11px] font-semibold tabular-nums text-studio-ink">{value}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-studio-ink-muted">{note}</span>
    </div>
  );
}

function Mention({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px]" style={{ color: ACCENT }}>{children}</span>;
}
function Cmd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[3px] border px-1.5 py-[1px] font-mono text-[11px]" style={{ borderColor: ACCENT, color: ACCENT }}>
      {children}
    </span>
  );
}
function Path({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-studio-ink-muted">{children}</span>;
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────

export default function HudRedesignPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · hud-redesign
        </div>
        <h1 className="mt-1 font-sans text-[28px] font-semibold leading-none tracking-tight text-studio-ink">
          HUD Redesign
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The HUD re-evaluated around one thesis: the object is{" "}
          <span className="text-studio-ink">work</span>, agent and project are facets, and
          attention is the precedence layer. Simplified pass — four tabs, two-line rows.
          <em> Focus</em> leads with what needs you, then folds recent activity in as a
          section (it was never a separate screen). Tail is left as the established raw
          stream; Scout keeps its treatment. Wider default, stacked for one-pass review.
        </p>
      </header>

      <div className="flex flex-wrap gap-6">
        <Labeled caption="1 · focus — what needs you, then recent activity below; two-line rows, tap to steer">
          <Panel tab="focus" place="fleet">
            <FocusBody />
          </Panel>
        </Labeled>
        <Labeled caption="2 · threads — conversations; subject = work, sender = agent, status by attention">
          <Panel tab="threads" place="openscout / PR #214">
            <ThreadsBody />
          </Panel>
        </Labeled>
        <Labeled caption="3 · tail — the established raw stream, left as-is">
          <Panel tab="tail" place="fleet">
            <TailBody />
          </Panel>
        </Labeled>
        <Labeled caption="4 · scout — the DM + refreshed command surface (dock shown engaged; list tabs show it at rest)">
          <Panel tab="scout" place="scout" startDockOpen>
            <ScoutBody />
          </Panel>
        </Labeled>
      </div>

      <Research />
    </main>
  );
}

function Labeled({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      {children}
      <figcaption className="max-w-[620px] font-sans text-[11px] leading-snug text-studio-ink-faint">{caption}</figcaption>
    </figure>
  );
}

function Research() {
  return (
    <section className="mt-20 w-full max-w-[920px] font-sans text-[13px] leading-relaxed text-studio-ink-muted">
      <ResearchHeader surface="hud · macos · redesign" />

      <ResearchBlock eyebrow="thesis">
        <p>
          The shipped HUD is built on the broker's <em>entity</em> model — agents keyed by
          presence, activity as raw wire primitives, sessions keyed by harness, slash
          commands that answer <span className="text-studio-ink">"N endpoints online"</span>. This
          keeps the cockpit but swaps the worldview: <span className="text-studio-ink">work is the
          noun</span>, agent and project are facets, <span className="text-studio-ink">attention pulls
          rank</span>, and every row is a launch point for steering.
        </p>
      </ResearchBlock>

      <ResearchBlock eyebrow="screen remap">
        <ul className="flex flex-col gap-2">
          <li><span className="text-studio-ink">agents + activity → focus.</span> The presence roster dissolves. <span className="text-studio-ink">ON YOU</span> (blocked-on-operator work) leads; <span className="text-studio-ink">RECENT</span> follows as a section, not a separate tab. Two-line rows: work title + <code className="font-mono">@agent · #project</code>.</li>
          <li><span className="text-studio-ink">sessions → threads.</span> Conversations, not sessions. Subject = work, sender = agent (Gmail shape). RUNNING/IDLE/ENDED → awaiting you / working / wound down.</li>
          <li><span className="text-studio-ink">tail → tail.</span> Left alone — the established raw stream, the one place entity/wire vocabulary is correct.</li>
          <li><span className="text-studio-ink">assistant → scout.</span> The DM plus the refreshed command surface, shown in use.</li>
          <li><span className="text-studio-ink">dropped:</span> the standalone <em>recent</em> tab (folded into focus) and the top-right <em>on you</em> pip (the ON YOU header already carries the count).</li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="the commands">
        <ul className="flex flex-col gap-2">
          <li><span className="text-studio-ink">/status → focus.</span> Was <em>"N endpoints online"</em> + flight-ids. Now on-you first, then recent. Presence is plumbing, never the headline.</li>
          <li><span className="text-studio-ink">/recent → the RECENT section.</span> No longer a screen or an <code className="font-mono">@agent</code>-required message dump; it's fleet activity under focus.</li>
          <li><span className="text-studio-ink">/agents → dissolves.</span> The <code className="font-mono">transport:state</code> roster stops being top-level; hands are an attribute of a work.</li>
          <li><span className="text-studio-ink">vocab:</span> <em>flight</em> → task/work, <em>session</em> → conversation, drop <em>endpoint</em>.</li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="addressing — place default">
        <p>
          The dock stops asking you to name an agent. Default target is{" "}
          <span className="text-studio-ink">where you are</span> (the chip shows the place). Typed
          addressing is the exception: <span className="text-studio-ink">@work</span> reaches across
          contexts (a titled unit whose project + hands are already bound),{" "}
          <span className="text-studio-ink">#project</span> scopes.
        </p>
      </ResearchBlock>

      <ResearchBlock eyebrow="what this leans on (open)">
        <ul className="flex flex-col gap-2">
          <li><span className="text-studio-ink">Widened prefilter input.</span> <code className="font-mono">scoutbot/prefilter.ts</code> only sees the broker snapshot today; attention-first needs the <code className="font-mono">core/attention</code> index + a project rollup passed in.</li>
          <li><span className="text-studio-ink">A directly-responsible-agent.</span> <code className="font-mono">@work</code> and steer-from-a-row need the work to resolve its hands actively (DRI → recent → spawn).</li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="source">
        <SourceLinks
          paths={[
            "design/studio/views/hud-redesign.tsx",
            "design/studio/components/hud/HudPanel.tsx",
            "apps/macos/Sources/ScoutHUD/HUDDockState.swift",
            "packages/web/server/scoutbot/prefilter.ts",
          ]}
        />
      </ResearchBlock>
    </section>
  );
}
