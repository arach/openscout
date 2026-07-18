"use client";

// Scout iOS — Fleet home · Log. A calmer take on Home. The top is a compact
// strip of the two glance-values that actually help: a mini activity chart, and
// each subscription's spent windows (Claude · Codex, each with its short 5h and
// long weekly cap). The whole body below is ONE flat Activity log — no cards, no
// Working/Detected lanes, no dividing section: a single continuous stream,
// freshest first, with a single accent edge on what's happening right now.
//
// One component, responsive via container queries on `.iLog`:
//   - phone (default): the strip fits three segments across; the flat log runs
//     beneath it.
//   - wide (≥600px container — the iPad stage): the strip gets more air (bigger
//     chart, per-window reset times) and the flat log runs full width.
//
// Styles live in theme.ts under "Fleet home · Log" and read only `--i-*` vars.

import { useId } from "react";
import { Glyph } from "./Glyph";
import {
  ACTIVITY, QUOTAS, NOTIFS, TERMINALS_RECENT,
  type ActEvent, type Quota, type Notif, type TermSession,
} from "./data";

const isFresh = (age: string) => /^(now|[12]m)$/.test(age);

// Deterministic 30-min activity pulse for the chart (events / interval).
const PULSE = [2, 3, 2, 4, 3, 5, 4, 4, 6, 5, 7, 6, 5, 8, 7, 9, 8, 11, 9, 12];

/** Mini activity chart — a compact strip segment, not a full-width hero. Thin
 *  accent stroke, soft vertical fade fill, end mark. Gradient id unique/mount. */
function MiniChart() {
  const gid = `iChartFill-${useId().replace(/:/g, "")}`;
  const w = 100, h = 34, max = Math.max(...PULSE);
  const pts = PULSE.map((v, i) => [
    (i / (PULSE.length - 1)) * w,
    h - 2.5 - (v / max) * (h - 6),
  ] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className="iChartSpark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--i-accent)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--i-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="iChartBase" x1="0" y1={h - 0.5} x2={w} y2={h - 0.5}
        stroke="var(--i-hairline)" strokeWidth="1" />
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gid})`} stroke="none" />
      <polyline className="iChartLine" points={line} fill="none" stroke="var(--i-accent)"
        strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="iChartEnd" cx={ex} cy={ey} r="2" fill="var(--i-accent)" />
    </svg>
  );
}

/** A subscription segment — the plan name, then its short (5h) and long (weekly)
 *  windows, each a labelled thin meter + percent. Amber once a window is nearly
 *  spent (≥80%), else the single accent. Per-window reset shows on the wide stage. */
function QuotaSeg({ q }: { q: Quota }) {
  return (
    <div className="iStripSeg">
      <div className="iStripHead">
        <span className="iStripLabel">{q.label}</span>
        <span className="iStripPlan">{q.plan}</span>
      </div>
      <div className="iWins">
        {q.windows.map((w) => {
          const pct = Math.round(w.used * 100);
          const hot = w.used >= 0.8 ? "" : undefined;
          return (
            <div className="iWin" key={w.label}>
              <span className="iWinLabel">{w.label}</span>
              <div className="iWinTrack">
                <div className="iWinFill" data-hot={hot} style={{ width: `${pct}%` }} />
              </div>
              <span className="iWinPct" data-hot={hot}>{pct}%</span>
              <span className="iWinReset">{w.reset}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A recent-notification chip — agent · age up top, kind tag + text below. The
 *  freshest carry an accent edge; approval/error read amber ("act on it"). */
function NotifChip({ n }: { n: Notif }) {
  const hot = n.kind === "approval" || n.kind === "error" ? "" : undefined;
  return (
    <div className="iNotif" data-fresh={isFresh(n.age) ? "" : undefined}>
      <div className="iNotifTop">
        <span className="iNotifAgent">{n.agent}</span>
        <span className={`iNotifAge${n.age === "now" ? " live" : ""}`}>{n.age}</span>
      </div>
      <div className="iNotifBody">
        <span className="iNotifKind" data-hot={hot}>{n.kind}</span>
        <span className="iNotifText">{n.text}</span>
      </div>
    </div>
  );
}

/** A recent-terminal tile — cwd · age, the command on a prompt line, last output
 *  beneath. Terminal-styled (mono, darker well); running reads live. */
function TermTile({ t }: { t: TermSession }) {
  return (
    <div className="iTerm" data-run={t.running ? "" : undefined}>
      <div className="iTermTop">
        <span className="iTermCwd">{t.cwd}</span>
        <span className={`iTermAge${t.running ? " live" : ""}`}>{t.running ? "running" : t.age}</span>
      </div>
      <div className="iTermCmd"><span className="iTermCaret">❯</span>{t.cmd}</div>
      <div className="iTermLast">{t.last}</div>
    </div>
  );
}

/** One flat log row — summary · source · age. No card, no kind dot: the
 *  freshest ("now") rows carry the ink weight + a single accent edge, older
 *  rows recede to muted. Attribution reads from the mono source tag. */
function LogRow({ e }: { e: ActEvent }) {
  const now = e.age === "now" ? "" : undefined;
  return (
    <div className="iLogRow" data-now={now}>
      <span className="iLogText">{e.summary}</span>
      <span className="iLogSrc">{e.source}</span>
      <span className={`iLogAge${e.age === "now" ? " live" : ""}`}>{e.age}</span>
    </div>
  );
}

export function FleetLogSurface() {
  return (
    <div className="iBody">
      <div className="iLog">
        {/* top — a compact strip: activity chart · Claude · Codex */}
        <div className="iStrip">
          <div className="iStripSeg iStripSeg--chart">
            <div className="iStripHead">
              <span className="iStripLabel">Activity</span>
              <span className="iStripPlan">30 min</span>
            </div>
            <MiniChart />
          </div>
          {QUOTAS.map((q) => <QuotaSeg key={q.id} q={q} />)}
        </div>

        {/* notifications — a shelf of recent alerts, just under the strip */}
        <div className="iShelf iShelf--notifs">
          <div className="iShelfHead">
            <Glyph kind="inbox" size={12} />
            <span className="iShelfLabel">Notifications</span>
            <span className="iShelfCount">{NOTIFS.length}</span>
          </div>
          <div className="iShelfRow">
            {NOTIFS.map((n) => <NotifChip key={n.id} n={n} />)}
          </div>
        </div>

        {/* body — one flat activity log, no dividing sections */}
        <div className="iLogHead">
          <span className="iFleetLaneLabel">Activity log</span>
          <span className="iLiveInd"><span>live</span></span>
        </div>
        <div className="iLogList">
          {ACTIVITY.map((e) => <LogRow key={e.id} e={e} />)}
        </div>

        {/* terminals — a shelf of recent PTY sessions, docked at the bottom */}
        <div className="iShelf iShelf--terms">
          <div className="iShelfHead">
            <Glyph kind="terminal" size={12} />
            <span className="iShelfLabel">Terminals</span>
            <span className="iShelfCount">{TERMINALS_RECENT.length}</span>
          </div>
          <div className="iShelfRow">
            {TERMINALS_RECENT.map((t) => <TermTile key={t.id} t={t} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
