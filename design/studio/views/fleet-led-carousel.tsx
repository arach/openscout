"use client";

/**
 * Fleet LED — permanent-display study (crown mode, pass 5 exploration).
 *
 * Operator direction (supersedes the first draft):
 *
 *   1. The fleet display is PERMANENT — always on screen at the top, possibly
 *      minimized, never part of the summon. It does not wait for the crown.
 *   2. The summon is bottom-center only: tapping the crown opens the four
 *      corner complications + the bottom nav bar. The top display must not
 *      depend on — or collide with — those complications.
 *   3. Placement strategy: on summon, the complications come in over the
 *      canvas and LODGE into slots flanking the display — the display is the
 *      anchor, the corners dock next to it (never edge-locked, which is what
 *      made the first iPad render "completely off").
 *   4. The tabs-mode status strip returns in crown mode, SUMMON-ONLY: a thin
 *      read-only line popped up from the true bottom edge (inside the
 *      indicator band), coexisting with the corner labels via wide side
 *      insets. It never shows at rest — the resting hex owns the bottom.
 *
 * Every candidate renders at TRUE 1:1 scale inside real device shells —
 * iPhone 16 (393×852pt, Dynamic Island) and iPad 11" LANDSCAPE (1180×820pt) —
 * with mock content mirroring the operator's actual fleet. Tap the bottom hex
 * in any shell (or the SUMMON ALL button) to play rest → summoned.
 *
 *   A · SHIPPED CONTENT — today's three-fact well, in the new placement.
 *   B · CAROUSEL — one bigger well, auto-rotating pages (Hosts / Working /
 *       Quota), page dots, pauses on touch/hover, age always pinned right.
 *   C · TWO-ROW INSTRUMENT — no rotation: identity row on top, a working
 *       row + quota micro-bars below. More pixels, zero motion cost.
 *
 * URL params: ?variant=A|B|C isolates one candidate; ?summoned=1 starts
 * summoned (deterministic captures).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/* ── scoped CSS (prefixed .fl-) ─────────────────────────────────────── */

const FL_CSS = `
.flled{--bg:#070908;--ink:#f2f4ef;--muted:#aab1a7;--dim:#777e75;
  --accent:#a6ef87;--accent-soft:rgba(166,239,135,.12);
  --sig-top:#131516;--sig-bottom:#0B0D0E;--sig-edge:#3A3E3F;--sig-neutral:#767C7D;
  --well:#070A09;--well-edge:#1E231F;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
.flled{font-family:var(--mono);-webkit-font-smoothing:antialiased;color:var(--ink);
  background:var(--bg);min-height:100vh;padding:34px 28px 80px;min-width:1320px}
.flled *{box-sizing:border-box}
.fl-h{font-size:10px;letter-spacing:.18em;color:var(--dim);text-transform:uppercase;margin:0 0 6px}
.fl-sub{font-size:11px;color:var(--muted);margin:0 0 8px;max-width:680px;line-height:1.6}
.fl-variant{margin:44px 0 8px;font-size:12px;letter-spacing:.1em;color:var(--ink)}
.fl-variant b{color:var(--accent);font-weight:600;margin-right:10px}
.fl-note{font-size:10.5px;color:var(--dim);margin:6px 0 18px;max-width:640px;line-height:1.6}
.fl-row{display:flex;gap:44px;flex-wrap:wrap;align-items:flex-start}
.fl-colcap{font-size:9px;letter-spacing:.14em;color:var(--dim);text-transform:uppercase;margin:0 0 10px}
.fl-summonall{font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--accent);
  background:none;border:1px solid var(--sig-edge);border-radius:6px;padding:7px 14px;cursor:pointer}
.fl-summonall:hover{border-color:var(--accent)}

/* ── device shells (1:1 pt = px) ── */
.fl-iphone{width:393px;height:852px;border-radius:56px;position:relative;flex:none;
  background:#000;padding:11px;cursor:pointer;
  box-shadow:0 0 0 2px #2b2e2c,0 0 0 5px #101211,0 30px 60px rgba(0,0,0,.55)}
.fl-iphone-screen{width:100%;height:100%;border-radius:46px;overflow:hidden;position:relative;
  background:linear-gradient(180deg,#0C0D0C 0%,#070908 30%,#060706 100%)}
.fl-ipad{width:1180px;height:820px;border-radius:26px;position:relative;flex:none;
  background:#000;padding:13px;cursor:pointer;
  box-shadow:0 0 0 2px #2b2e2c,0 0 0 5px #101211,0 30px 60px rgba(0,0,0,.55)}
.fl-ipad-screen{width:100%;height:100%;border-radius:14px;overflow:hidden;position:relative;
  background:linear-gradient(180deg,#0C0D0C 0%,#070908 34%,#060706 100%)}
.fl-island{position:absolute;top:12px;left:50%;transform:translateX(-50%);
  width:112px;height:32px;border-radius:16px;background:#000;z-index:5;
  box-shadow:inset 0 0 0 1px #101210}
.fl-homebar{position:absolute;bottom:9px;left:50%;transform:translateX(-50%);
  width:124px;height:4.5px;border-radius:3px;background:rgba(242,244,239,.32);z-index:5}
.fl-ipad-homebar{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);
  width:220px;height:4.5px;border-radius:3px;background:rgba(242,244,239,.28);z-index:5}

/* backdrop hints — abstract content so the display reads in context */
.fl-backdrop{position:absolute;inset:0;padding:142px 24px 0;opacity:.5}
.fl-sk-row{height:9px;border-radius:4px;background:#121513;margin-bottom:12px}
.fl-sk-row--short{width:58%}
.fl-sk-row--mid{width:76%}
.fl-sk-card{height:64px;border-radius:10px;background:#0e100f;border:1px solid #151816;margin:18px 0}
.fl-lanes{position:absolute;inset:0;padding:118px 28px 0;display:flex;gap:18px;opacity:.55}
.fl-lane{flex:1;border-radius:12px;background:#0e100f;border:1px solid #151816;padding:12px}
.fl-lane .fl-sk-row{margin-bottom:10px}

/* ── the permanent top strip: a FULL-BLEED solid band (the docked tab bar's
      top sibling — solid graphite, hairline, drop shadow), sized to HOST the
      complications: its height is the dial height + even padding, so a
      circle (phone) or pill (iPad) landing in it reads as a perfect fit, not
      an overlay. The display docks into its center and PERMANENTLY reserves
      the end slots, so nothing is ever covered when the complications land.
      The strip starts below the island on phones — the notch never disrupts
      it. ── */
.fl-rail{position:absolute;left:0;right:0;z-index:4;pointer-events:none;
  display:flex;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#131516 0%,#0B0D0E 100%);
  border-bottom:1px solid rgba(58,62,63,.5);
  box-shadow:0 6px 12px rgba(0,0,0,.5);
  transition:background .3s ease,border-color .3s ease,box-shadow .3s ease}
/* Per-device strip policy: the iPad keeps the strip at ALL times — the wide
   canvas has space to cover and not always enough content, so the band earns
   its keep. The iPhone goes minimal: no strip at rest (the display floats
   free below the island); on summon the strip appears FULL-BLEED FROM THE
   VERY TOP so the island punches through it — a strip that starts below the
   notch leaves an ugly dead band. Content anchors to the strip's bottom,
   clearing the island. */
.fl-iphone-screen .fl-rail{top:0;height:122px;align-items:flex-end;padding-bottom:10px;
  background:none;border-bottom-color:transparent;box-shadow:none}
.fl-iphone-screen.summon .fl-rail{
  background:linear-gradient(180deg,#131516 0%,#0B0D0E 100%);
  border-bottom-color:rgba(58,62,63,.5);
  box-shadow:0 6px 12px rgba(0,0,0,.5)}
.fl-iphone-screen .fl-tcorner{top:auto;bottom:10px;margin-top:0}
.fl-ipad-screen .fl-rail{top:0;height:64px;padding:0 160px}
/* iPhone: round dials land inside the strip ends on summon (no recessed
   dock slot — at phone size the anti-circle reads as a hole, not a seat).
   The inset matches the bottom corners' exactly: one vertical line per
   side, top dial edge to bottom corner edge. */
.fl-tcorner{width:54px;height:54px;border-radius:50%;position:absolute;top:50%;
  margin-top:-27px;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));
  box-shadow:inset 0 1px 0 rgba(58,62,63,.8),0 2px 4px rgba(0,0,0,.6),0 8px 13px rgba(0,0,0,.45);
  opacity:0;transition:opacity .3s ease,transform .42s cubic-bezier(.2,.9,.25,1.12)}
.fl-tcorner--l{left:20px;transform:translateX(100px) scale(.4)}
.fl-tcorner--r{right:20px;transform:translateX(-100px) scale(.4)}
/* iPad: the complications are HORIZONTAL — capsule pills (glyph + label
   side by side) that match the strip's own nature and leave the display's
   rows uncovered. Same 28pt inset as the bottom corners — one vertical
   line per side. */
.fl-ipad-screen .fl-tcorner{width:104px;height:40px;border-radius:20px;margin-top:-20px;
  display:flex;align-items:center;justify-content:center;gap:7px}
.fl-ipad-screen .fl-tcorner--l{left:28px;transform:translateX(140px) scale(.4)}
.fl-ipad-screen .fl-tcorner--r{right:28px;transform:translateX(-140px) scale(.4)}
.fl-ipad-screen .fl-tcorner svg{position:static;margin:0}
.fl-ipad-screen .fl-tcorner small{position:static;transform:none;font-size:8px;
  letter-spacing:.1em;color:var(--muted)}
.summon .fl-tcorner{opacity:1;transform:translateX(0) scale(1);pointer-events:auto}
.summon .fl-tcorner--l{transition-delay:.02s}
.summon .fl-tcorner--r{transition-delay:.06s}
.fl-tcorner svg{position:absolute;inset:0;margin:auto;opacity:.62}
.fl-tcorner small{position:absolute;top:54px;left:50%;transform:translateX(-50%);
  font-size:7px;letter-spacing:.06em;color:var(--dim);white-space:nowrap}
.fl-display{flex:none;transition:transform .42s cubic-bezier(.2,.9,.25,1.12)}

/* ── bottom summon cluster: resting hex → bar + corners + seats. Hugs the
      true bottom edge (into the indicator band), the pass-3 discipline — a
      floating bottom cluster reads broken. Items DISTRIBUTE across the full
      bar (space-between at the bar's own 20/28pt padding), which is how the
      app comfortably fits two seats between the hex and each corner — fixed
      center gaps are what made the study knobs look squeezed. ── */
.fl-bottom{position:absolute;bottom:28px;left:0;right:0;z-index:4;
  display:flex;align-items:center;justify-content:space-between;padding:0 20px}
/* iPad: the button row is a compact centered ISLAND (the iPhone treatment),
   not a full-width extrusion — the bar spans only the knobs. */
.fl-ipad-screen .fl-bottom{bottom:22px;left:50%;right:auto;transform:translateX(-50%);
  width:620px;padding:0}
.fl-ipad-screen .fl-bbar{left:0;right:0}
.fl-bbar{position:absolute;left:20px;right:20px;height:46px;border-radius:23px;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));
  box-shadow:inset 0 0 0 1px var(--sig-edge),0 6px 12px rgba(0,0,0,.5);
  transform:scaleX(.16);opacity:0;transform-origin:center;
  transition:transform .4s cubic-bezier(.2,.9,.25,1.08),opacity .28s ease}
.summon .fl-bbar{transform:none;opacity:1}
.fl-bseat{width:36px;height:36px;border-radius:50%;flex:none;position:relative;z-index:2;
  background:rgba(0,0,0,.22);box-shadow:inset 0 0 0 1px rgba(118,124,125,.16);
  opacity:0;transform:scale(.3);transition:all .34s cubic-bezier(.2,.9,.25,1.15)}
/* Bottom corners are the bar's END CAPS (Home left · New right), sitting on
   the same inset + diameter as the top corners — Connect/Home and
   Settings/New share one vertical line per side. */
.fl-bcorner{width:54px;height:54px;border-radius:50%;flex:none;position:relative;z-index:2;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));
  box-shadow:inset 0 1px 0 rgba(58,62,63,.8),0 2px 4px rgba(0,0,0,.6),0 8px 13px rgba(0,0,0,.45);
  opacity:0;transform:scale(.3);transition:all .34s cubic-bezier(.2,.9,.25,1.15)}
.summon .fl-bseat{opacity:1;transform:none}
.summon .fl-bcorner{opacity:1;transform:none}
.summon .fl-bitem1{transition-delay:.04s}
.summon .fl-bitem2{transition-delay:.08s}
.summon .fl-bitem3{transition-delay:.12s}
.summon .fl-bitem4{transition-delay:.16s}
.summon .fl-bitem5{transition-delay:.20s}
.summon .fl-bitem6{transition-delay:.24s}
.fl-hex{width:56px;height:56px;border-radius:50%;flex:none;position:relative;z-index:3;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));
  box-shadow:inset 0 1px 0 rgba(118,124,125,.55),0 2px 4px rgba(0,0,0,.6),0 8px 14px rgba(0,0,0,.5);
  cursor:pointer;transition:transform .3s ease}
.summon .fl-hex{transform:scale(1.06)}
.fl-hex svg{position:absolute;inset:0;margin:auto}
.fl-gap{width:14px;flex:none}
/* Bottom corner labels — they hang BELOW the circles, inside the indicator
   band, so the status line below has to coexist with them. */
.fl-bcorner small{position:absolute;top:58px;left:50%;transform:translateX(-50%);
  font-size:7px;letter-spacing:.06em;color:var(--dim);white-space:nowrap}

/* ── status line (summon-only): the tabs-mode readout strip riding the
      home-indicator band — flush to the true bottom edge, READ-ONLY, center
      left open for the indicator. Pops up from the bottom edge on summon,
      after the bar lands. Side insets clear the corner labels that share
      the band on the phone; on iPad the island corners sit 280pt in, so the
      strip can use the rail's own 28pt inset. ── */
.fl-status{position:absolute;left:0;right:0;bottom:0;z-index:3;pointer-events:none;
  display:flex;align-items:center;justify-content:space-between;
  padding:4px 72px 12px;font-size:8px;letter-spacing:.05em;color:var(--dim);
  background:linear-gradient(180deg,#0E1011,#0A0C0B);
  border-top:1px solid rgba(58,62,63,.5);
  opacity:0;transform:translateY(100%);
  transition:opacity .16s ease .05s,transform .24s cubic-bezier(.2,.9,.25,1.08) .05s}
.summon .fl-status{opacity:1;transform:none}
.fl-status-run{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.fl-status-sep{color:#3a4038}
.fl-status-active{color:var(--accent);font-weight:600}
.fl-ipad-screen .fl-status{padding-left:28px;padding-right:28px}
/* Phone width discipline: the LED already carries the host count, so the
   phone's line drops it and keeps what the top display can't show — route,
   host name, agents. The iPad has the room and keeps the fuller run. */
.fl-iphone-screen .fl-status-wide{display:none}

/* ── the wells ── */
.fl-well{display:inline-flex;align-items:center;gap:11px;background:var(--well);
  border:1px solid var(--well-edge);border-radius:9px;padding:10px 15px;
  box-shadow:0 1px 3px rgba(0,0,0,.85)}
.fl-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 2px rgba(166,239,135,.7)}
.fl-dot--off{background:#566058;box-shadow:none}
.fl-div{width:1px;height:12px;background:rgba(86,96,88,.32)}
.fl-k{font-size:10px;font-weight:600;letter-spacing:.05em;color:var(--ink)}
.fl-k--dim{color:var(--muted)}
.fl-age{font-size:9px;font-weight:500;color:rgba(119,126,117,.7)}
.fl-pips{display:inline-flex;gap:3px}
.fl-pip{width:5px;height:5px;border-radius:50%;background:#141D18}
.fl-pip--on{background:var(--accent);box-shadow:0 0 2px rgba(166,239,135,.7)}
.fl-active{font-size:11px;font-weight:700;letter-spacing:.07em;color:#3FF0B0;
  text-shadow:0 0 3px rgba(166,239,135,.5)}

/* B — carousel */
.fl-car{display:inline-flex;align-items:stretch;background:var(--well);
  border:1px solid var(--well-edge);border-radius:10px;overflow:hidden;
  box-shadow:0 1px 3px rgba(0,0,0,.85)}
.fl-car-view{padding:10px 4px 8px 14px;min-width:196px}
.fl-car-page{animation:flPageIn .34s cubic-bezier(.2,.7,.2,1)}
@keyframes flPageIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.fl-car-eyebrow{font-size:7.5px;letter-spacing:.16em;color:var(--dim);margin-bottom:3px}
.fl-car-main{font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--ink);white-space:nowrap}
.fl-car-main .fl-hl{color:#3FF0B0}
.fl-car-detail{font-size:8.5px;color:var(--muted);margin-top:2px;white-space:nowrap}
.fl-car-dots{display:flex;gap:3px;margin-top:6px}
.fl-car-dot{width:8px;height:2px;border-radius:1px;background:#23292380;transition:background .2s}
.fl-car-dot--on{background:var(--accent)}
.fl-car-side{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;
  padding:9px 12px 9px 10px;border-left:1px solid rgba(86,96,88,.18)}
.fl-car-paused{font-size:7px;letter-spacing:.12em;color:var(--dim)}

/* quota micro bar */
.fl-q{display:inline-flex;align-items:center;gap:5px}
.fl-qbar{width:34px;height:3px;border-radius:2px;background:#141D18;overflow:hidden}
.fl-qfill{height:100%;border-radius:2px;background:var(--sig-neutral)}
.fl-qfill--hot{background:var(--accent)}

/* C — two-row */
.fl-two{display:inline-flex;flex-direction:column;background:var(--well);
  border:1px solid var(--well-edge);border-radius:10px;padding:9px 14px 10px;
  box-shadow:0 1px 3px rgba(0,0,0,.85);min-width:252px}
.fl-two-top{display:flex;align-items:center;gap:9px}
.fl-two-rule{height:1px;background:rgba(86,96,88,.22);margin:7px 0}
.fl-two-bot{display:flex;align-items:center;gap:9px;justify-content:space-between}
.fl-worker{display:inline-flex;align-items:center;gap:4px;font-size:8.5px;color:var(--muted)}
.fl-worker b{color:var(--ink);font-weight:600}

/* iPad goes WIDER — the canvas can carry it, and the strip's docks stay
   free. Phone sizing is untouched. The two-row instrument stretches to fill
   the strip between the docks (the operator's markup); carousel/baseline
   stay centered but roomier. */
.fl-ipad-screen .fl-display{flex:1;display:flex;justify-content:center;position:relative;height:100%}
/* iPad two-mode display: the minimized well at rest MORPHS into the full
   instrument on summon (see MorphLED — shared elements persist, extras
   flow in around them). A/B keep the simpler scale/fade swap. The phone
   keeps its single face in both states. */
.fl-display-full{display:inline-flex}
.fl-display-min{display:none}
.fl-ipad-screen .fl-well{padding:12px 22px;gap:14px}
.fl-ipad-screen .fl-car-view{min-width:300px;padding-left:18px}
.fl-ipad-screen .fl-car-side{padding-right:16px}
.fl-ipad-screen .fl-two{min-width:0;width:100%;padding:11px 18px 12px}
.fl-ipad-screen .fl-qbar{width:52px}
/* iPhone: the summoned corners claim their 74pt dock lines, so the two-row
   face compresses — quota bars drop to bare percentages, worker chips drop
   the project (harness only), gaps tighten. No overlap in either state. */
.fl-iphone-screen .fl-two{min-width:0}
.fl-iphone-screen .fl-two-bot{gap:6px}
.fl-iphone-screen .fl-qbar{display:none}
.fl-iphone-screen .fl-worker{font-size:8px}
.fl-iphone-screen .fl-proj{display:none}

/* ── MorphLED (iPad C): ONE well, two sizes. The shared core (hosts · pips ·
   active) never unmounts and never moves — summon widens the well (explicit
   width transition) and the worker + quota wings unfold symmetrically from
   zero width beside it. Nothing disappears, nothing is replaced: the
   content visibly travels to its destination layout. No fetch-age readout
   anywhere — the operator rates it the least useful measure; staleness
   lives in the vitals sheet instead. ── */
.fl-morph{display:inline-flex;align-items:center;background:var(--well);
  border:1px solid var(--well-edge);border-radius:10px;padding:10px 0;
  box-shadow:0 1px 3px rgba(0,0,0,.85);width:212px;overflow:hidden;white-space:nowrap;
  transition:width .46s cubic-bezier(.2,.9,.25,1.06)}
.summon .fl-morph{width:100%}
.fl-morph-wing{display:inline-flex;align-items:center;gap:12px;flex:1 1 0;min-width:0;
  max-width:0;opacity:0;overflow:hidden;
  transition:max-width .46s cubic-bezier(.2,.9,.25,1.06),opacity .28s ease .12s}
.summon .fl-morph-wing{max-width:460px;opacity:1}
.fl-morph-wing--l{justify-content:flex-end}
.fl-morph-wing--r{justify-content:flex-start}
.fl-morph-core{display:inline-flex;align-items:center;gap:11px;flex:none;padding:0 15px}
.fl-morph-div{width:1px;height:12px;background:rgba(86,96,88,.32);flex:none;opacity:0;
  transition:opacity .28s ease .16s}
.summon .fl-morph-div{opacity:1}
`;

/* ── mock fleet (the operator's real shape) ─────────────────────────── */

const MOCK = {
  hostsOnline: 2,
  hostsTotal: 3,
  route: "LAN",
  offlineHost: "air",
  offlineAge: "2h",
  agents: 4,
  working: [
    { harness: "claude", model: "opus-4.7", project: "openscout" },
    { harness: "codex", model: "gpt-5.2", project: "arc" },
  ],
  quota: [
    { label: "CLAUDE", pct: 88, reset: "resets wed 23:00" },
    { label: "CODEX", pct: 31, reset: "" },
  ],
};

/* ── shared bits ────────────────────────────────────────────────────── */

function HostsCluster() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span className={`fl-dot${MOCK.hostsOnline > 0 ? "" : " fl-dot--off"}`} />
      <span className="fl-k">
        {MOCK.hostsOnline}/{MOCK.hostsTotal} MACS
      </span>
    </span>
  );
}

function Pips() {
  const count = Math.min(Math.max(MOCK.agents, 1), 6);
  return (
    <span className="fl-pips">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`fl-pip${i < MOCK.working.length ? " fl-pip--on" : ""}`} />
      ))}
    </span>
  );
}

function QuotaMeter({ label, pct }: { label: string; pct: number }) {
  return (
    <span className="fl-q">
      <span className="fl-car-detail" style={{ marginTop: 0 }}>{label}</span>
      <span className="fl-qbar">
        <span
          className={`fl-qfill${pct >= 75 ? " fl-qfill--hot" : ""}`}
          style={{ width: `${pct}%`, display: "block" }}
        />
      </span>
      <span
        className="fl-car-detail"
        style={{ marginTop: 0, color: pct >= 75 ? "var(--accent)" : undefined }}
      >
        {pct}%
      </span>
    </span>
  );
}

/* ── A · shipped content ────────────────────────────────────────────── */

function BaselineLED() {
  return (
    <span className="fl-well">
      <HostsCluster />
      <span className="fl-div" />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <Pips />
        <span className="fl-active">{MOCK.working.length} ACTIVE</span>
      </span>
    </span>
  );
}

/* ── B · carousel ───────────────────────────────────────────────────── */

type CarouselPage = { eyebrow: string; main: React.ReactNode; detail?: React.ReactNode };

function CarouselLED({ intervalMs = 3600 }: { intervalMs?: number }) {
  const pages = useMemo<CarouselPage[]>(
    () => [
      {
        eyebrow: "HOSTS",
        main: (
          <>
            {MOCK.hostsOnline}/{MOCK.hostsTotal} MACS <span className="fl-hl">· {MOCK.route}</span>
          </>
        ),
        detail: `${MOCK.offlineHost} offline · last seen ${MOCK.offlineAge}`,
      },
      {
        eyebrow: "WORKING",
        main: (
          <>
            <span className="fl-hl">{MOCK.working.length} WORKING</span> / {MOCK.agents} AGENTS
          </>
        ),
        detail: MOCK.working.map((w) => `${w.harness} ${w.model} · ${w.project}`).join("  +  "),
      },
      {
        eyebrow: "QUOTA",
        main: (
          <span style={{ display: "inline-flex", gap: 12 }}>
            {MOCK.quota.map((q) => (
              <QuotaMeter key={q.label} label={q.label} pct={q.pct} />
            ))}
          </span>
        ),
        detail: `claude ${MOCK.quota[0]!.reset}`,
      },
    ],
    [],
  );

  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (paused) return;
    timer.current = window.setInterval(() => setPage((p) => (p + 1) % pages.length), intervalMs);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [paused, intervalMs, pages.length]);

  const current = pages[page]!;
  return (
    <span
      className="fl-car"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onPointerDown={(e) => {
        e.stopPropagation();
        setPaused((v) => !v);
      }}
      role="group"
      aria-label="Fleet vitals carousel"
    >
      <span className="fl-car-view">
        <span className="fl-car-page" key={page} style={{ display: "block" }}>
          <span className="fl-car-eyebrow" style={{ display: "block" }}>{current.eyebrow}</span>
          <span className="fl-car-main" style={{ display: "block" }}>{current.main}</span>
          {current.detail ? (
            <span className="fl-car-detail" style={{ display: "block" }}>{current.detail}</span>
          ) : null}
        </span>
        <span className="fl-car-dots">
          {pages.map((p, i) => (
            <span key={p.eyebrow} className={`fl-car-dot${i === page ? " fl-car-dot--on" : ""}`} />
          ))}
        </span>
      </span>
      <span className="fl-car-side">
        <span className="fl-car-paused">{paused ? "HELD" : ""}</span>
      </span>
    </span>
  );
}

/* ── C · two-row instrument ─────────────────────────────────────────── */

function TwoRowLED() {
  return (
    <span className="fl-two">
      <span className="fl-two-top">
        <HostsCluster />
        <span className="fl-div" />
        <span className="fl-k fl-k--dim">{MOCK.route}</span>
      </span>
      <span className="fl-two-rule" />
      <span className="fl-two-bot">
        <span style={{ display: "inline-flex", gap: 10 }}>
          {MOCK.working.map((w) => (
            <span key={w.harness} className="fl-worker">
              <span className="fl-dot" style={{ width: 4, height: 4 }} />
              <b>{w.harness}</b> <span className="fl-proj">{w.project}</span>
            </span>
          ))}
        </span>
        <span style={{ display: "inline-flex", gap: 10 }}>
          {MOCK.quota.map((q) => (
            <QuotaMeter key={q.label} label={q.label} pct={q.pct} />
          ))}
        </span>
      </span>
    </span>
  );
}

/* ── C on iPad · the morphing well ────────────────────────────────────
   ONE element, two sizes: the shared core (hosts · pips · active) never
   unmounts and never moves; summon widens the well and the worker + quota
   wings unfold from zero width beside it. Nothing is replaced — the
   content visibly travels to its destination layout. */
function MorphLED() {
  return (
    <span className="fl-morph">
      <span className="fl-morph-wing fl-morph-wing--l">
        {MOCK.working.map((w) => (
          <span key={w.harness} className="fl-worker">
            <span className="fl-dot" style={{ width: 4, height: 4 }} />
            <b>{w.harness}</b> <span className="fl-proj">{w.project}</span>
          </span>
        ))}
      </span>
      <span className="fl-morph-div" />
      <span className="fl-morph-core">
        <HostsCluster />
        <span className="fl-div" />
        <Pips />
        <span className="fl-active">{MOCK.working.length} ACTIVE</span>
      </span>
      <span className="fl-morph-div" />
      <span className="fl-morph-wing fl-morph-wing--r">
        {MOCK.quota.map((q) => (
          <QuotaMeter key={q.label} label={q.label} pct={q.pct} />
        ))}
      </span>
    </span>
  );
}

/* ── crown chrome: permanent display + summoned complications ───────── */

function CornerGlyph({ kind }: { kind: "signal" | "gear" }) {
  // Minimal stand-ins for the hand-drawn corner glyphs — presence, not fidelity.
  return kind === "signal" ? (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#aab1a7" strokeWidth="1.4">
      <path d="M3 12c4-4 10-4 14 0" strokeLinecap="round" />
      <path d="M6 15c2.4-2.4 5.6-2.4 8 0" strokeLinecap="round" />
      <circle cx="10" cy="17.4" r="1" fill="#aab1a7" stroke="none" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#aab1a7" strokeWidth="1.4">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 3v2.4M10 14.6V17M3 10h2.4M14.6 10H17M5 5l1.7 1.7M13.3 13.3L15 15M15 5l-1.7 1.7M6.7 13.3L5 15" strokeLinecap="round" />
    </svg>
  );
}

function HexMark() {
  return (
    <svg width="26" height="30" viewBox="0 0 26 30" fill="none">
      <path
        d="M13 1 L24 8.25 V21.75 L13 29 L2 21.75 V8.25 Z"
        stroke="#767C7D"
        strokeWidth="1.4"
        fill="#0B0D0E"
      />
      <circle cx="13" cy="15" r="2.6" fill="#f2f4ef" opacity=".85" />
    </svg>
  );
}

function BottomCluster() {
  return (
    <div className="fl-bottom">
      <div className="fl-bbar" />
      <div className="fl-bcorner fl-bitem1">
        <small>HOME</small>
      </div>
      <div className="fl-bseat fl-bitem2" />
      <div className="fl-bseat fl-bitem3" />
      <div className="fl-hex">
        <HexMark />
      </div>
      <div className="fl-bseat fl-bitem4" />
      <div className="fl-bseat fl-bitem5" />
      <div className="fl-bcorner fl-bitem6">
        <small>NEW</small>
      </div>
    </div>
  );
}

/* The summon-only status line: the tabs-mode strip (route + host left, fleet
   rollup right) popped up from the bottom edge. Read-only telemetry; the
   center stays open for the home indicator. */
function StatusLine() {
  return (
    <div className="fl-status">
      <span className="fl-status-run">
        <span className="fl-dot" style={{ width: 4, height: 4 }} />
        <span style={{ color: "var(--muted)", fontWeight: 600 }}>{MOCK.route}</span>
        <span className="fl-status-sep">·</span>
        STUDIO-MAC
      </span>
      <span className="fl-status-run">
        <span className="fl-status-wide">
          {MOCK.hostsOnline}/{MOCK.hostsTotal} ONLINE
          <span className="fl-status-sep"> · </span>
        </span>
        {MOCK.agents} AGENTS
        <span className="fl-status-sep">·</span>
        <span className="fl-status-active">{MOCK.working.length} ACTIVE</span>
      </span>
    </div>
  );
}

function IPhoneBackdrop() {
  return (
    <div className="fl-backdrop">
      <div className="fl-sk-row fl-sk-row--short" />
      <div className="fl-sk-row fl-sk-row--mid" />
      <div className="fl-sk-card" />
      <div className="fl-sk-row" />
      <div className="fl-sk-row fl-sk-row--mid" />
      <div className="fl-sk-row fl-sk-row--short" />
      <div className="fl-sk-card" />
      <div className="fl-sk-row fl-sk-row--mid" />
      <div className="fl-sk-row fl-sk-row--short" />
    </div>
  );
}

function IPadBackdrop() {
  return (
    <div className="fl-lanes">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="fl-lane">
          <div className="fl-sk-row fl-sk-row--short" />
          <div className="fl-sk-row" />
          <div className="fl-sk-row fl-sk-row--mid" />
          <div className="fl-sk-row fl-sk-row--short" />
        </div>
      ))}
    </div>
  );
}

function DeviceShell({
  kind,
  summoned,
  onToggle,
  minimized,
  twoMode = true,
  children,
}: {
  kind: "iphone" | "ipad";
  summoned: boolean;
  onToggle: () => void;
  /// iPad-only rest face — a clean minimized well that summon expands into
  /// the full display. Ignored on the phone (single face in both states).
  minimized?: React.ReactNode;
  /// iPad-only: when false, children render directly (the morphing well
  /// manages its own two states instead of a min/full swap).
  twoMode?: boolean;
  children: React.ReactNode;
}) {
  const screen = (
    <>
      {kind === "iphone" ? <div className="fl-island" /> : null}
      {kind === "iphone" ? <IPhoneBackdrop /> : <IPadBackdrop />}
      {/* The rail is PERMANENT decoration; the display docks into its center
          and never unmounts. The corner complications only exist when
          summoned, lodging into the rail's end slots — the rail is what makes
          them read as placed, not floating, on both devices. */}
      <div className="fl-rail">
        <div className="fl-tcorner fl-tcorner--l">
          <CornerGlyph kind="signal" />
          <small>CONNECT</small>
        </div>
        {twoMode ? (
          <div className="fl-display">
            <span className="fl-display-min">{minimized ?? children}</span>
            <span className="fl-display-full">{children}</span>
          </div>
        ) : (
          <div className="fl-display">{children}</div>
        )}
        <div className="fl-tcorner fl-tcorner--r">
          <CornerGlyph kind="gear" />
          <small>SETTINGS</small>
        </div>
      </div>
      <StatusLine />
      <BottomCluster />
      <div className={kind === "iphone" ? "fl-homebar" : "fl-ipad-homebar"} />
    </>
  );
  return (
    <div
      className={kind === "iphone" ? "fl-iphone" : "fl-ipad"}
      onClick={onToggle}
      role="button"
      aria-label={summoned ? "Dismiss crown" : "Summon crown"}
      aria-pressed={summoned}
    >
      <div className={`${kind === "iphone" ? "fl-iphone-screen" : "fl-ipad-screen"}${summoned ? " summon" : ""}`}>
        {screen}
      </div>
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────────────── */

export default function FleetLedCarouselStudy() {
  const params = useSearchParams();
  const variant = (params.get("variant") ?? "").toUpperCase();
  const [summoned, setSummoned] = useState(params.get("summoned") === "1");
  const show = (v: string) => !variant || variant === v;

  const sections: {
    key: string;
    title: string;
    note: string;
    display: React.ReactNode;
    /// iPad override: replaces the min/full two-mode with a self-morphing face.
    ipadDisplay?: React.ReactNode;
  }[] = [
    {
      key: "A",
      title: "SHIPPED CONTENT — new placement",
      note: "Today's well (hosts · pips + active) living in the new strip placement, for reference. At rest the strip carries it alone; on summon the complications lodge into the strip's ends.",
      display: <BaselineLED />,
    },
    {
      key: "B",
      title: "CAROUSEL — rotating pages",
      note: "One bigger well, three rotating pages (HOSTS / WORKING / QUOTA) with page dots. Rotates every ~3.6s; hover or tap the well to hold a page. Tap the shell anywhere else to summon/dismiss.",
      display: <CarouselLED />,
    },
    {
      key: "C",
      title: "TWO-ROW INSTRUMENT — morphing on iPad",
      note: "iPhone: everything on one static two-row face. iPad: ONE well that morphs — the hosts · active core stays mounted and stationary at rest, and on summon the well widens while the worker + quota wings unfold beside it. Nothing disappears, nothing is replaced.",
      display: <TwoRowLED />,
      ipadDisplay: <MorphLED />,
    },
  ];

  return (
    <div className="flled">
      <style>{FL_CSS}</style>
      <h1 className="fl-h">Fleet LED — permanent display · top rail · true-scale shells</h1>
      <p className="fl-sub">
        A permanent top rail anchors the layout: the display docks into its center and never
        unmounts; the crown summon (bottom hex) lodges the corner complications into the
        rail&rsquo;s end slots, so the layout reads intentional with AND without complications.
        The rail starts below the island on phones — the notch never disrupts anything. iPhone
        16 (393×852pt) and iPad 11&Prime; landscape (1180×820pt), both at 100% — the page
        scrolls horizontally before it lies about size. Mock content mirrors the real fleet:
        2/3 Macs on LAN (air offline 2h), claude opus-4.7 · openscout + codex gpt-5.2 · arc
        working, Claude 88% / Codex 31% weekly quota.
      </p>
      <button className="fl-summonall" onClick={() => setSummoned((v) => !v)}>
        {summoned ? "DISMISS ALL" : "SUMMON ALL"}
      </button>

      {sections
        .filter((s) => show(s.key))
        .map((s) => (
          <section key={s.key}>
            <h2 className="fl-variant">
              <b>{s.key}</b>
              {s.title}
            </h2>
            <p className="fl-note">{s.note}</p>
            <div className="fl-row">
              <div>
                <p className="fl-colcap">iPhone 16 · 393pt · 1:1 · tap to summon</p>
                <DeviceShell kind="iphone" summoned={summoned} onToggle={() => setSummoned((v) => !v)}>
                  {s.display}
                </DeviceShell>
              </div>
              <div>
                <p className="fl-colcap">iPad 11&Prime; landscape · 1180pt · 1:1 · tap to summon</p>
                <DeviceShell
                  kind="ipad"
                  summoned={summoned}
                  onToggle={() => setSummoned((v) => !v)}
                  minimized={<BaselineLED />}
                  twoMode={!s.ipadDisplay}
                >
                  {s.ipadDisplay ?? s.display}
                </DeviceShell>
              </div>
            </div>
          </section>
        ))}

      <p className="fl-note" style={{ marginTop: 48 }}>
        Data bindings if picked: WORKING page = agents where state == live (harness · model ·
        project, from the same fleet rollup the Home strip reads); QUOTA page = merged
        serviceBudgets windows; HOSTS detail = per-host last-seen. All three are already fetched
        for Home — the display adds no new RPCs. Permanence note: the display never unmounts on
        summon/dismiss, so the carousel rotation and fetch age keep running through the
        choreography.
      </p>
    </div>
  );
}
