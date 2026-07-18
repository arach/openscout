"use client";

// Scout iOS — Fleet home. The web Fleet dashboard (stat band · needs-you /
// working / detected lanes · ask-the-fleet) reinterpreted as the iOS Home.
//
// One component, responsive via container queries on `.iFleet`:
//   - phone (default, ~374px): everything is a SINGLE LINE — the stat band is
//     one inline run + mini sparkline, every lane row is name · detail · age
//     with ellipsis truncation, and Ask-the-fleet is a one-line docked strip.
//   - wide (≥600px container — the iPad stage): big stat numerals + a larger
//     sparkline, and the lanes sit beside an Ask-the-fleet rail with the
//     live fleet log beneath it.
//
// Styles live in theme.ts under "Fleet home" and read only `--i-*` vars.

import { useId } from "react";
import { Glyph } from "./Glyph";
import {
  FLEET, MACHINES, INBOX, TAIL, inboxBlocking,
  type Agent, type InboxItem,
} from "./data";

// Deterministic 30-min activity pulse for the sparkline (events / interval).
const PULSE = [2, 3, 2, 4, 3, 5, 4, 4, 6, 5, 7, 6, 5, 8, 7, 9, 8, 11, 9, 12];

/** Activity pulse — thin accent stroke, soft vertical fade fill, end mark.
 *  Gradient id is unique per mount (phone + iPad stages share the page). */
function Sparkline() {
  const gid = `iSparkFill-${useId().replace(/:/g, "")}`;
  const w = 100, h = 28, max = Math.max(...PULSE);
  const pts = PULSE.map((v, i) => [
    (i / (PULSE.length - 1)) * w,
    h - 2.5 - (v / max) * (h - 7),
  ] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className="iFleetSpark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--i-accent)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--i-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="iFleetSparkBase" x1="0" y1={h - 0.5} x2={w} y2={h - 0.5}
        stroke="var(--i-hairline)" strokeWidth="1" />
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gid})`} stroke="none" />
      <polyline className="iFleetSparkLine" points={line} fill="none" stroke="var(--i-accent)"
        strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="iFleetSparkEnd" cx={ex} cy={ey} r="1.8" fill="var(--i-accent)" />
    </svg>
  );
}

/** Lane header — caps mono label + count, ink-bright for the attention lane.
 *  `tone` ("quiet" for the Detected lane) is inert for the baseline (no CSS keys
 *  off it there); the crisp language uses it to step the quietest lane down. */
function LaneHead({ label, count, hot, tone }: { label: string; count: number; hot?: boolean; tone?: "quiet" }) {
  return (
    <div className={`iFleetLaneHead${tone ? ` tone-${tone}` : ""}`}>
      <span className="iFleetLaneLabel" style={hot ? { color: "var(--i-ink)" } : undefined}>{label}</span>
      <span className="iFleetLaneCount" style={hot ? { color: "var(--i-accent)" } : undefined}>{count}</span>
    </div>
  );
}

/** Needs-you row — single line: agent · demand · KIND · age. The demand column
 *  truncates; kind reads from the mono token, urgency from ink contrast. */
function NeedRow({ it }: { it: InboxItem }) {
  const blocking = inboxBlocking(it);
  return (
    <div className="iFleetRow">
      <span className={`iFleetName ${blocking ? "" : "dim"}`}>{it.agent}</span>
      <span className="iFleetDetail">{it.summary}</span>
      {/* KIND token. `kind` + `blocking?` modifiers are inert for the baseline
          (no CSS keys off them there); the crisp language uses them to surface
          the demand-kind on phone and lift the blocking ones (approval/question). */}
      <span className={`iFleetTok kind ${blocking ? "blocking" : ""}`}>{it.kind.toUpperCase()}</span>
      <span className="iFleetAge live">{it.age}</span>
    </div>
  );
}

/** Working row — single line: name · current action (mono) · age. */
function WorkRow({ a }: { a: Agent }) {
  return (
    <div className="iFleetRow">
      <span className="iFleetName">{a.title}</span>
      <span className="iFleetDetail mono">{a.action ?? "working"}<span className="iCaret" /></span>
      <span className="iFleetTok">{a.harness}</span>
      <span className="iFleetAge live">{a.age}</span>
    </div>
  );
}

/** Detected row — dim single line: name · project ⎇ branch · age. Agents the
 *  bridge can see but that aren't doing anything right now. */
function DetectedRow({ a }: { a: Agent }) {
  const where = [a.project, a.branch ? `⎇ ${a.branch}` : null].filter(Boolean).join(" · ");
  return (
    <div className="iFleetRow dim">
      <span className="iFleetName dim">{a.title}</span>
      <span className="iFleetDetail mono">{where}</span>
      <span className="iFleetTok">{a.harness}</span>
      <span className="iFleetAge">{a.age}</span>
    </div>
  );
}

/** Ask-the-fleet — the steering input. Wide: a rail panel (route + harness
 *  pickers, a well, mic/send). Phone: folded to a one-line docked strip. */
function AskTheFleet() {
  return (
    <div className="iFleetAsk">
      <div className="iFleetAskHead">
        <span className="iFleetLaneLabel">Ask the fleet</span>
      </div>
      <div className="iFleetAskPickers">
        <span className="iFleetPicker on">Broadcast<i>▾</i></span>
        <span className="iFleetPicker">claude<i>▾</i></span>
      </div>
      <div className="iFleetAskWell">Type or speak — goes to every live agent…</div>
      <div className="iFleetAskRow">
        <span className="iMic">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3" />
          </svg>
        </span>
        <span className="iFleetAskHint">Ask the fleet…</span>
        <span className="iSend">
          <Glyph kind="arrow" size={15} rotate={-90} />
        </span>
      </div>
    </div>
  );
}

/** The live fleet log — wide-only rail under Ask-the-fleet (phone has Ops). */
function FleetLog() {
  return (
    <div className="iFleetLog">
      <div className="iFleetLaneHead">
        <span className="iFleetLaneLabel">Fleet log</span>
        <span className="iLiveInd"><span>live</span></span>
      </div>
      {TAIL.map((e) => (
        <div className="iFleetLogRow" key={e.id}>
          <span className="iFleetLogTime">{e.time}</span>
          <span className="iFleetLogSrc">{e.source}</span>
          <span className="iFleetLogText">{e.summary}</span>
        </div>
      ))}
    </div>
  );
}

export function FleetSurface() {
  const live = FLEET.filter((a) => a.state === "live");
  const detected = FLEET.filter((a) => a.state !== "live");
  const online = MACHINES.filter((m) => m.state === "connected").length;

  return (
    <div className="iBody">
      <div className="iFleet">
        {/* Stat band — phone: one inline run + mini sparkline; wide: numerals.
            Hairline seps (iFleetStatSep) only show under the crisp language;
            baseline treats them as inert (no CSS). */}
        <div className="iFleetStats">
          <div className="iFleetStat hot">
            <span className="iFleetNum">{live.length}</span>
            <span className="iFleetStatCap">live · working now</span>
          </div>
          <span className="iFleetStatSep" aria-hidden />
          <div className="iFleetStat">
            <span className="iFleetNum">{FLEET.length}</span>
            <span className="iFleetStatCap">agents</span>
          </div>
          <span className="iFleetStatSep" aria-hidden />
          <div className="iFleetStat">
            <span className="iFleetNum">{online}/{MACHINES.length}</span>
            <span className="iFleetStatCap">machines</span>
          </div>
          <Sparkline />
        </div>

        <div className="iFleetGrid">
          {/* Lanes */}
          <div className="iFleetLanes">
            <LaneHead label="Needs you" count={INBOX.length} hot />
            <div className="iCard iFleetCard hot">
              {INBOX.map((it, i) => (
                <div key={it.id}>
                  {i > 0 && <div className="iRowSep" />}
                  <NeedRow it={it} />
                </div>
              ))}
            </div>

            <LaneHead label="Working" count={live.length} />
            <div className="iCard iFleetCard">
              {live.map((a, i) => (
                <div key={a.id}>
                  {i > 0 && <div className="iRowSep" />}
                  <WorkRow a={a} />
                </div>
              ))}
            </div>

            <LaneHead label="Detected" count={detected.length} tone="quiet" />
            <div className="iCard iFleetCard">
              {detected.map((a, i) => (
                <div key={a.id}>
                  {i > 0 && <div className="iRowSep" />}
                  <DetectedRow a={a} />
                </div>
              ))}
            </div>
          </div>

          {/* Steering rail — beside the lanes when wide, docked strip on phone */}
          <div className="iFleetRail">
            <AskTheFleet />
            <FleetLog />
          </div>
        </div>
      </div>
    </div>
  );
}
