"use client";

/**
 * Crown & Complications — high-fidelity, interactive interpretation of the
 * operator's Proposal C from the Mobile Chrome study. The scout hex is the
 * whole identity ("the crown"); tapping it summons the app's affordances as
 * complications (watchOS grammar, mapped onto HudsonKit's HudPhoneComplications
 * slot model: topLeft/topRight/bottomLeft/bottomRight/center + .tray/.scattered
 * /.minimal styles). The interaction model is channelled from talkie's
 * voice-pivot: a single ambient object that escalates on tap, with spring +
 * stagger summon/dismiss choreography as the soul of it.
 *
 * TWO VARIANTS, both live (real pointer + motion, not static frames):
 *
 *   T · CROWN TOP — the crown replaces the masthead, anchored top-center, no
 *       wordmark. Tap → Deck (topLeft) + Settings (topRight) spring out, and a
 *       host-filter row drops under the crown. The bottom tab row + settled
 *       status strip stay as shipped. The summoned readout is the HOST FILTER
 *       (which lived in the masthead) — NOT a fleet-count dup of the strip — so
 *       the top-center summon earns its place.
 *
 *   B · CROWN BOTTOM AS PRIMARY NAV — the radical one. No tab bar, no status
 *       strip. The crown at bottom-center IS the chrome. TAP → the six surfaces
 *       bloom in a radial arc (navigation). LONG-PRESS → a vitals card blooms
 *       (connection route, host, fleet, uptime) — where the killed status strip's
 *       content now lives, on demand. At rest the crown carries state itself: a
 *       breathing pulse ring (fleet alive) + a micro caption (LAN · host · N active).
 *
 * URL params for deterministic screenshots / deep-links:
 *   ?variant=T|B      — isolate one variant (default: both, side by side rows)
 *   ?state=resting|summoned|command  — force initial state (auto-demo off)
 *   ?demo=1           — start the auto-demo loop
 *
 * Warm-tone palette + tokens are the exact values from apps/ios/Scout/Theme.swift
 * (ScoutTone.warm) and the mobile-chrome study; the hand-drawn glyph set is the
 * faithful studio port (components/scout-ios/Glyph). Production app untouched.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Glyph } from "@/components/scout-ios";
import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ────────────────────────────────────────────────────────────────────
   Scoped phone CSS — prefixed `.cc-`, rooted at `.ccrown`.
   ──────────────────────────────────────────────────────────────────── */

const CC_CSS = `
.ccrown{--bg:#0A0A0A;--chrome:#060606;--ink:#E5E5E5;--muted:#B8B8B8;--dim:#969696;
  --faint:#6b6b6b;--border:#272727;--hairline:#262626;
  --accent:#10B981;--teal:#0BC5A5;
  --canvas-top:#100E0B;--canvas-floor:#060504;
  --card-top:#211C19;--card-bottom:#171411;--card-edge:#433A30;
  --inset:#161310;--raised:#1C1915;
  --sig-top:#131516;--sig-bottom:#0B0D0E;--sig-edge:#3A3E3F;--sig-rule:#2A2E2F;--sig-neutral:#767C7D;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --ui:"Inter Tight","Inter",-apple-system,sans-serif}
.ccrown{font-family:var(--mono);line-height:1.55;-webkit-font-smoothing:antialiased}

/* Phone frame (393pt canvas, scaled up for an interactive hero) */
.cc-framebox{width:362px;height:785px;position:relative;flex:none}
.cc-phone{width:393px;height:852px;transform:scale(.921);transform-origin:top left;
  border-radius:46px;overflow:hidden;position:relative;
  outline:1px solid #2c2c2c;outline-offset:6px;
  background:linear-gradient(180deg,var(--canvas-top) 0%,var(--bg) 36%,var(--canvas-floor) 100%)}
.cc-phone::before{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(360px 260px at 50% 0%,rgba(255,240,219,.055),transparent 70%)}

/* Dynamic Island — hardware, rendered in every frame. ~126×37pt, fully
   rounded, 11pt below the top edge, centered. Always on top (z hardware). */
.cc-island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:126px;height:37px;
  border-radius:19px;background:#000;z-index:20;box-shadow:0 0 0 1px rgba(0,0,0,.55),0 1px 3px rgba(0,0,0,.6)}
.cc-island::after{content:"";position:absolute;right:11px;top:50%;transform:translateY(-50%);
  width:9px;height:9px;border-radius:50%;background:#080808;box-shadow:inset 0 0 2px rgba(48,48,48,.7)}

/* Pendant tether (Variant T) — the crown hangs from the island on the shared
   vertical axis; the seam lights on summon (a live-activity bloom nod). */
.cc-pendant{position:absolute;top:47px;left:50%;transform:translateX(-50%);width:2px;height:9px;z-index:5;
  background:var(--sig-edge);transition:background .3s ease,box-shadow .3s ease,height .3s ease}
.cc-pendant.lit{background:var(--accent);box-shadow:0 0 6px rgba(16,185,129,.6)}

/* Fake content so the chrome has a real subject to float over */
.cc-content{position:absolute;left:0;right:0;display:flex;flex-direction:column;gap:13px;
  padding:0 24px}
.cc-content.tvar{top:120px;bottom:118px}
.cc-content.bvar{top:64px;bottom:64px}
.cc-eyebrow{font-size:9px;letter-spacing:.16em;color:var(--faint);text-transform:uppercase}
.cc-card{border-radius:8px;padding:14px;border:1px solid transparent;
  background:linear-gradient(180deg,var(--card-top),var(--card-bottom));
  border-image:linear-gradient(180deg,var(--card-edge),var(--border)) 1;
  box-shadow:0 3px 9px rgba(0,0,0,.33)}
.cc-card .cc-t{font-size:11px;color:var(--ink);font-weight:500}
.cc-card .cc-s{font-size:9px;color:var(--faint);margin-top:4px}
.cc-row{display:flex;align-items:center;gap:8px;padding:10px 2px;border-bottom:1px solid #1a1a1a;
  font-size:10px;color:var(--muted)}
.cc-row .cc-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);flex:none}
.cc-row.dim .cc-dot{background:var(--faint)}

/* Chamfered graphite readout cell (SignalPanelShape, cut=5) */
.cc-cell{position:relative;display:inline-flex;align-items:center;gap:6px;
  font-size:9.5px;font-weight:500;color:var(--muted);padding:4px 10px;background:var(--sig-edge);
  clip-path:polygon(5px 0,calc(100% - 5px) 0,100% 5px,100% calc(100% - 5px),calc(100% - 5px) 100%,5px 100%,0 calc(100% - 5px),0 5px)}
.cc-cell::before{content:"";position:absolute;inset:1px;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));
  clip-path:polygon(4px 0,calc(100% - 4px) 0,100% 4px,100% calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,0 calc(100% - 4px),0 4px)}
.cc-cell>*{position:relative;z-index:1}
.cc-cell .cc-cdot{width:5px;height:5px;border-radius:50%;background:var(--accent)}
.cc-cell.on{color:var(--ink)}
.cc-cell.off .cc-cdot{background:var(--dim)}

/* ── The crown ──────────────────────────────────────────────────────
   A raised warm plate housing the scout hex; identity is the hex alone.
   State lives in the hex core (dot), the rim glow, and a breathing pulse
   ring. Lifts + halos when active. */
.cc-crown-slot{position:absolute;left:50%;transform:translateX(-50%);z-index:6}
.cc-crown-slot.top{top:56px}
/* Crown center sits on the shared bar centerline (852-25-28 ≈ 799 = bar center) */
.cc-crown-slot.bottom{bottom:25px}
.cc-crown{position:relative;width:56px;height:56px;border-radius:50%;border:none;padding:0;cursor:pointer;
  background:linear-gradient(180deg,var(--card-top),var(--card-bottom));
  box-shadow:inset 0 1px 0 var(--card-edge),0 6px 16px rgba(0,0,0,.55);
  display:flex;align-items:center;justify-content:center;
  transition:transform .34s cubic-bezier(.34,1.4,.5,1),box-shadow .34s ease}
.cc-crown:active{transform:scale(.96)}
.cc-crown.is-active{transform:scale(1.07);
  box-shadow:inset 0 1px 0 var(--card-edge),0 0 0 1px rgba(16,185,129,.4),0 12px 28px rgba(0,0,0,.62)}
.cc-crown-halo{position:absolute;inset:-3px;border-radius:50%;border:1px solid rgba(16,185,129,0);
  transition:inset .42s cubic-bezier(.34,1.56,.64,1),border-color .42s ease,box-shadow .42s ease;pointer-events:none}
.cc-crown.is-active .cc-crown-halo{inset:-9px;border-color:rgba(16,185,129,.42);box-shadow:0 0 20px rgba(16,185,129,.24)}
.cc-crown-pulse{position:absolute;inset:2px;border-radius:50%;pointer-events:none}
.cc-crown-pulse.on{animation:cc-breathe 2.6s ease-in-out infinite}
@keyframes cc-breathe{0%{box-shadow:0 0 0 0 rgba(16,185,129,.34)}70%{box-shadow:0 0 0 10px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
.cc-hex-face{fill:url(#cc-hex-fill);stroke:url(#cc-hex-rim);stroke-width:1.6;
  transition:stroke-width .3s ease}
.cc-crown.is-active .cc-hex-face{stroke-width:2}
.cc-hex-facet{fill:none;stroke:rgba(120,124,125,.22);stroke-width:1}
.cc-hex-core{fill:#0e5f4a;transition:fill .3s ease}
.cc-hex-core.lit{fill:var(--accent);filter:drop-shadow(0 0 3px rgba(16,185,129,.85))}

/* ── Complications orbit ─────────────────────────────────────────────
   A zero-size anchor at the crown's center; children spring FROM it to
   their slot (translate + scale, staggered). */
.cc-orbit{position:absolute;left:50%;width:0;height:0;z-index:5}
.cc-comp{position:absolute;left:0;top:0;margin:-22px 0 0 -22px;
  display:flex;flex-direction:column;align-items:center;gap:4px;
  transform:translate(0,0) scale(0);opacity:0;pointer-events:none;
  transition:transform .5s cubic-bezier(.34,1.56,.64,1),opacity .3s ease}
.cc-comp.show{opacity:1;pointer-events:auto}
.cc-chip{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:var(--muted);cursor:pointer;
  background:linear-gradient(180deg,var(--card-top),var(--card-bottom));
  box-shadow:inset 0 1px 0 var(--card-edge),0 4px 11px rgba(0,0,0,.5)}
.cc-comp.on .cc-chip{color:var(--accent);
  box-shadow:inset 0 1px 0 var(--card-edge),0 0 0 1px rgba(16,185,129,.42),0 4px 12px rgba(0,0,0,.5)}
.cc-comp-label{font-size:7.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);white-space:nowrap}
.cc-comp.on .cc-comp-label{color:var(--dim)}

/* Host-filter row (Variant T summon — earns its place vs the strip) */
.cc-hostrow{position:absolute;top:124px;left:50%;transform:translateX(-50%) translateY(-10px);
  display:flex;gap:6px;opacity:0;pointer-events:none;z-index:4;
  transition:transform .42s cubic-bezier(.34,1.4,.5,1) .1s,opacity .34s ease .1s}
.cc-hostrow.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}

/* ── Variant B slot model (operator direction, r2) ──────────────────
   Model = summon + complications, nothing else. FOUR big corner circles
   (Deck · Settings top; Home · New bottom) as primary affordances, plus a
   CONNECTING NAV BAR at the bottom that unites the crown with the four inner
   surfaces (Agents · Tail | crown | Comms · Term) — inner slots are tab-like,
   not circles. Top-middle carries the live Fleet active indicator. */

/* Big corner buttons — primary affordances. The element IS the 54px circle so
   its center is the anchor; the label is absolute at a UNIFORM offset below the
   shared centerline (center + 40), matching the inner seats exactly. */
.cc-corner{position:absolute;z-index:5;width:54px;height:54px;
  opacity:0;transform:scale(.4);transform-origin:center;pointer-events:none;
  transition:transform .46s cubic-bezier(.34,1.56,.64,1),opacity .3s ease}
.cc-corner.show{opacity:1;transform:scale(1);pointer-events:auto}
.cc-corner.tl{top:18px;left:18px}
.cc-corner.tr{top:18px;right:18px}
/* Bottom corner CENTERS land on the bar centerline (852-26-27 = 799 = bar center) */
.cc-corner.bl{bottom:26px;left:20px}
.cc-corner.br{bottom:26px;right:20px}
.cc-cbtn{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:var(--muted);cursor:pointer;
  background:linear-gradient(180deg,var(--card-top),var(--card-bottom));
  box-shadow:inset 0 1px 0 var(--card-edge),0 5px 13px rgba(0,0,0,.55)}
.cc-corner.on .cc-cbtn{color:var(--accent);
  box-shadow:inset 0 1px 0 var(--card-edge),0 0 0 1px rgba(16,185,129,.42),0 5px 14px rgba(0,0,0,.55)}
.cc-corner-label{position:absolute;top:calc(100% + 13px);left:50%;transform:translateX(-50%);
  font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);white-space:nowrap}

/* Connecting nav bar — ONE continuous element that runs edge-to-edge UNDER the
   Home/New corner circles, so they sit fused ON it (no air). The whole bottom
   reads as a single joined unit: [Home]====[Agents·Tail·crown·Comms·Term]====[New]. */
.cc-navbar{position:absolute;left:50%;bottom:27px;width:357px;height:52px;z-index:3;border-radius:26px;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));border:1px solid var(--sig-edge);
  box-shadow:0 8px 20px rgba(0,0,0,.5),inset 0 1px 0 rgba(120,124,125,.14);
  opacity:0;transform:translateX(-50%) scaleX(.16);transform-origin:center;pointer-events:none;
  transition:transform .5s cubic-bezier(.34,1.5,.55,1),opacity .3s ease}
.cc-navbar.show{opacity:1;transform:translateX(-50%) scaleX(1);pointer-events:auto}

/* Inner nav items — distinct ROUND button targets seated in the bar, glyph +
   micro label. Not loose pills: a faint circular seat keeps them part of the bar. */
/* The element IS the 38px seat, margin-centered on the orbit point (the shared
   centerline). Label absolute at the SAME center+40 offset as the corners. */
.cc-navitem{position:absolute;left:0;top:0;width:38px;height:38px;margin:-19px 0 0 -19px;
  color:var(--dim);cursor:pointer;
  transform:translate(0,0) scale(0);opacity:0;pointer-events:none;
  transition:transform .5s cubic-bezier(.34,1.56,.64,1),opacity .3s ease}
.cc-navitem.show{opacity:1;pointer-events:auto}
.cc-navbtn{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.025);box-shadow:inset 0 0 0 1px rgba(120,124,125,.17)}
.cc-navitem.on .cc-navbtn{background:rgba(16,185,129,.08);box-shadow:inset 0 0 0 1px rgba(16,185,129,.5)}
.cc-navitem-label{position:absolute;top:calc(100% + 21px);left:50%;transform:translateX(-50%);
  font-size:7px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);white-space:nowrap}
.cc-navitem.on{color:var(--accent)}
.cc-navitem.on .cc-navitem-label{color:var(--dim)}

/* ── Fleet LED readout — top-middle, first-class (operator loves it) ──
   An inset instrument well: recessed dark housing, a pip meter (lit = active
   agents of total), a tightly-glowing count, and a dim freshness age that
   sinks rather than alarms (the shipped FETCHED relative-age discipline, no
   yellow warn tint). Glow is disciplined — a tight halo, never neon. */
.cc-led{position:absolute;top:56px;left:50%;z-index:4;display:inline-flex;align-items:center;gap:9px;
  padding:6px 13px 7px;border-radius:8px;background:#070a09;border:1px solid #1e231f;
  box-shadow:inset 0 1px 4px rgba(0,0,0,.9),inset 0 0 11px rgba(0,0,0,.55),0 1px 0 rgba(120,124,125,.07);
  opacity:0;transform:translateX(-50%) translateY(-9px);pointer-events:none;
  transition:opacity .3s ease,transform .42s cubic-bezier(.34,1.56,.64,1)}
.cc-led.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
.cc-led-label{font-size:7px;letter-spacing:.18em;color:#566058;text-transform:uppercase}
.cc-led-pips{display:inline-flex;gap:3px;align-items:center}
.cc-pip{width:5px;height:5px;border-radius:50%;background:#141d18;box-shadow:inset 0 0 2px rgba(0,0,0,.8)}
.cc-pip.lit{background:var(--accent);box-shadow:0 0 3px rgba(16,185,129,.75),0 0 1px rgba(16,185,129,.95)}
.cc-pip.lit.breathe{animation:cc-led-breathe 2.6s ease-in-out infinite}
.cc-led-count{font-size:9px;font-weight:700;letter-spacing:.1em;color:#3ff0b0;text-shadow:0 0 4px rgba(16,185,129,.5)}
.cc-led-age{font-size:8px;letter-spacing:.05em;color:var(--faint)}
@keyframes cc-led-breathe{0%,100%{opacity:1}50%{opacity:.5}}

/* Resting tap-hint (both variants) */
.cc-hint{position:absolute;left:50%;transform:translateX(-50%);z-index:4;
  font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);
  transition:opacity .3s ease;pointer-events:none}
.cc-hint.top{top:116px}
.cc-hint.bottom{bottom:16px}

/* Dismiss scrim */
.cc-scrim{position:absolute;inset:0;z-index:3;background:rgba(6,5,4,0);pointer-events:none;
  transition:background .32s ease}
.cc-scrim.show{background:rgba(6,5,4,.5);pointer-events:auto;cursor:pointer}

/* ── Bottom chrome kept as shipped for Variant T ───────────────────── */
.cc-dock{position:absolute;left:0;right:0;bottom:0;z-index:2}
.cc-inst-dock{position:relative;display:flex;padding:7px 8px 5px;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));border-top:1px solid var(--sig-edge)}
.cc-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:0;color:var(--dim);
  font-size:0;font-weight:500;padding:5px 0 4px}
.cc-tab.on{color:var(--accent);font-size:8px;gap:3px}
.cc-tab-mark{position:absolute;top:-1px;width:22px;height:2px;transform:translateX(-50%);
  background:var(--accent);box-shadow:0 0 6px rgba(16,185,129,.5)}
.cc-statusbar{background:var(--chrome);border-top:1px solid var(--hairline);
  display:flex;align-items:center;gap:10px;padding:6px 40px 14px;font-size:9px;font-weight:500;
  letter-spacing:.4px;color:var(--muted);min-height:30px}
.cc-statusbar .cc-grow{flex:1}
.cc-statusbar .cc-sep{color:var(--faint);font-weight:700}
.cc-statusbar .cc-acc{color:var(--accent)}
.cc-statusbar .cc-pulse2{width:5px;height:5px;border-radius:50%;background:var(--accent);display:inline-block;vertical-align:1px}
.cc-homeind{position:absolute;bottom:5px;left:50%;transform:translateX(-50%);width:120px;height:4px;border-radius:2px;background:#3a3a3a;z-index:1}
`;

/* ────────────────────────────────────────────────────────────────────
   Shared pieces
   ──────────────────────────────────────────────────────────────────── */

type SurfaceKind = "home" | "agent" | "pulse" | "comms" | "terminal" | "plus";
const SURFACES: { kind: SurfaceKind; label: string }[] = [
  { kind: "home", label: "Home" },
  { kind: "agent", label: "Agents" },
  { kind: "pulse", label: "Tail" },
  { kind: "comms", label: "Comms" },
  { kind: "terminal", label: "Term" },
  { kind: "plus", label: "New" },
];

/** The scout hex — dark warm jewel, emerald rim, a state core. */
function CrownHex({ size, lit }: { size: number; lit: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: "block" }}>
      <polygon className="cc-hex-face" points="24,4 41,14 41,34 24,44 7,34 7,14" />
      <polygon className="cc-hex-facet" points="24,13 32.6,18 32.6,30 24,35 15.4,30 15.4,18" />
      <circle className={lit ? "cc-hex-core lit" : "cc-hex-core"} cx="24" cy="24" r="3.1" />
    </svg>
  );
}

/** The crown button. Tap → onTap; hold ≥350ms → onHold (if provided). */
function Crown({
  anchor,
  active,
  alive,
  onTap,
  onHold,
}: {
  anchor: "top" | "bottom";
  active: boolean;
  alive: boolean;
  onTap: () => void;
  onHold?: () => void;
}) {
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const onDown = () => {
    held.current = false;
    if (onHold) {
      holdTimer.current = window.setTimeout(() => {
        held.current = true;
        onHold();
      }, 350);
    }
  };
  const onUp = () => {
    clearHold();
    if (!held.current) onTap();
  };

  return (
    <div className={`cc-crown-slot ${anchor}`}>
      <button
        className={`cc-crown${active ? " is-active" : ""}`}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
        aria-label="Scout crown — tap to summon"
        aria-expanded={active}
      >
        <span className={`cc-crown-pulse${alive && !active ? " on" : ""}`} />
        <span className="cc-crown-halo" />
        <CrownHex size={30} lit={active || alive} />
      </button>
    </div>
  );
}

function Cell({ label, on, off }: { label: string; on?: boolean; off?: boolean }) {
  return (
    <span className={["cc-cell", on ? "on" : "", off ? "off" : ""].filter(Boolean).join(" ")}>
      <span className="cc-cdot" />
      {label}
    </span>
  );
}

function Content({ variant, top, bottom }: { variant: "tvar" | "bvar"; top?: number; bottom?: number }) {
  const rows = [
    { t: "fix-auth-refresh — claude · running", dim: false },
    { t: "docs-sweep — codex · waiting", dim: false },
    { t: "nightly-rebase — claude · idle", dim: true },
    ...(variant === "bvar"
      ? [
          { t: "mesh-latency-probe — codex · running", dim: false },
          { t: "landing-refresh — claude · idle", dim: true },
          { t: "ios-profile-audit — gemini · waiting", dim: false },
        ]
      : []),
  ];
  const style =
    top != null || bottom != null
      ? { ...(top != null ? { top } : {}), ...(bottom != null ? { bottom } : {}) }
      : undefined;
  return (
    <div className={`cc-content ${variant}`} style={style}>
      <span className="cc-eyebrow">Fleet</span>
      <div className="cc-card">
        <div className="cc-t">6 agents · 3 active</div>
        <div className="cc-s">2 hosts online · last sync just now</div>
      </div>
      {rows.map((r) => (
        <div key={r.t} className={r.dim ? "cc-row dim" : "cc-row"}>
          <span className="cc-dot" />
          {r.t}
        </div>
      ))}
    </div>
  );
}

/* ── Bottom chrome kept for Variant T ─────────────────────────────── */
function ShippedDock() {
  return (
    <div className="cc-inst-dock">
      <i className="cc-tab-mark" style={{ left: "8.333%" }} />
      {SURFACES.map((s, i) => (
        <span key={s.label} className={i === 0 ? "cc-tab on" : "cc-tab"}>
          <Glyph kind={s.kind} size={15} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function StatusStrip() {
  return (
    <div className="cc-statusbar">
      <span>
        <Glyph kind="signal" size={11} /> LAN
      </span>
      <span className="cc-sep">·</span>
      <span>
        <span className="cc-pulse2" /> arach-mbp
      </span>
      <span className="cc-grow" />
      <span>FETCHED 12s</span>
      <span className="cc-sep">·</span>
      <span>6 agents</span>
      <span className="cc-sep">·</span>
      <span className="cc-acc">3 active</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   VARIANT T — crown top, complications summon, bottom chrome as shipped
   ──────────────────────────────────────────────────────────────────── */

type TState = "resting" | "summoned";

function VariantT({ forced, demoTick }: { forced?: TState; demoTick: number }) {
  const [state, setState] = useState<TState>(forced ?? "resting");
  useEffect(() => {
    if (forced) setState(forced);
  }, [forced]);
  useEffect(() => {
    if (demoTick > 0 && !forced) setState((s) => (s === "resting" ? "summoned" : "resting"));
  }, [demoTick, forced]);

  const summoned = state === "summoned";
  // Deck / Settings fly UP from the pendant crown to flank the Dynamic Island,
  // clearing its 126pt width (island spans x≈133–259; targets land at x≈40/353).
  const tabs: { kind: "home" | "gear"; label: string; dx: number; dy: number }[] = [
    { kind: "home", label: "Deck", dx: -156, dy: -50 },
    { kind: "gear", label: "Settings", dx: 157, dy: -50 },
  ];

  return (
    <div className="cc-framebox">
      <div className="cc-phone">
        <div className="cc-island" />
        <Content variant="tvar" />

        <div className={`cc-scrim${summoned ? " show" : ""}`} onClick={() => setState("resting")} />

        {/* Host-filter row — the summoned readout that earns its place */}
        <div className={`cc-hostrow${summoned ? " show" : ""}`}>
          <Cell label="All" on />
          <Cell label="arach-mbp" />
          <Cell label="studio-mac" off />
        </div>

        {/* Deck + Settings springing up from the crown to flank the island */}
        <div className="cc-orbit" style={{ top: 84 }}>
          {tabs.map((t, i) => (
            <div
              key={t.label}
              className="cc-comp show"
              style={{
                transform: summoned
                  ? `translate(${t.dx}px, ${t.dy}px) scale(1)`
                  : "translate(0,0) scale(0)",
                opacity: summoned ? 1 : 0,
                transitionDelay: `${(summoned ? i : tabs.length - 1 - i) * 46}ms`,
              }}
            >
              <span className="cc-chip">
                <Glyph kind={t.kind} size={18} />
              </span>
              <span className="cc-comp-label">{t.label}</span>
            </div>
          ))}
        </div>

        <span className={`cc-hint top`} style={{ opacity: summoned ? 0 : 1 }}>
          Tap
        </span>

        {/* The crown hangs from the island as a pendant; the tether lights on summon */}
        <i className={`cc-pendant${summoned ? " lit" : ""}`} />
        <Crown anchor="top" active={summoned} alive onTap={() => setState(summoned ? "resting" : "summoned")} />

        {/* Bottom chrome — shipped, untouched */}
        <div className="cc-dock">
          <ShippedDock />
          <StatusStrip />
          <div className="cc-homeind" />
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   VARIANT B — the crown anchors a full slot model. TOP TRIO (Deck · Fleet
   · Settings) + a BOTTOM NAV BAR (six surfaces flanking the crown 3-and-3).
   The whole chrome assembles out of / collapses into the crown — the summon
   choreography preserved as a focus toggle. No status strip, nothing floats.
   ──────────────────────────────────────────────────────────────────── */

type BState = "collapsed" | "assembled";

/** Four big corner circles — Deck/Settings top, Home/New bottom. */
// Home lives once in the bottom bar (grid glyph); the two top corners host the
// app's real top-level sheets — Connect and Settings — so there is no duplicate
// grid glyph (resolves the Deck/Home collision, matching the native build).
const B_CORNERS: { corner: "tl" | "tr" | "bl" | "br"; kind: SurfaceKind | "gear" | "signal"; label: string; stagger: number }[] = [
  { corner: "bl", kind: "home", label: "Home", stagger: 1 },
  { corner: "br", kind: "plus", label: "New", stagger: 2 },
  { corner: "tl", kind: "signal", label: "Connect", stagger: 3 },
  { corner: "tr", kind: "gear", label: "Settings", stagger: 4 },
];

/** Four inner round button targets seated in the connecting bar, two each side. */
const B_INNER: { kind: SurfaceKind; label: string; dx: number }[] = [
  { kind: "agent", label: "Agents", dx: -94 },
  { kind: "pulse", label: "Tail", dx: -50 },
  { kind: "comms", label: "Comms", dx: 50 },
  { kind: "terminal", label: "Term", dx: 94 },
];

function VariantB({ forced, demoTick }: { forced?: BState; demoTick: number }) {
  const [state, setState] = useState<BState>(forced ?? "assembled");
  const [active, setActive] = useState("Home");
  useEffect(() => {
    if (forced) setState(forced);
  }, [forced]);
  useEffect(() => {
    if (demoTick > 0 && !forced) setState((s) => (s === "assembled" ? "collapsed" : "assembled"));
  }, [demoTick, forced]);

  const on = state === "assembled";

  return (
    <div className="cc-framebox">
      <div className="cc-phone">
        <div className="cc-island" />
        <Content variant="bvar" top={on ? 100 : 64} bottom={on ? 96 : 20} />

        {/* Four big floating corner buttons */}
        {B_CORNERS.map((c) => (
          <div
            key={c.label}
            className={`cc-corner ${c.corner}${on ? " show" : ""}${active === c.label ? " on" : ""}`}
            onClick={() => setActive(c.label)}
            style={{ transitionDelay: `${(on ? c.stagger : 0) * 38}ms` }}
          >
            <span className="cc-cbtn">
              <Glyph kind={c.kind} size={22} />
            </span>
            <span className="cc-corner-label">{c.label}</span>
          </div>
        ))}

        {/* Top-middle live Fleet LED readout — first-class element */}
        <span className={`cc-led${on ? " show" : ""}`}>
          <span className="cc-led-label">Fleet</span>
          <span className="cc-led-pips">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={i < 3 ? (i === 2 ? "cc-pip lit breathe" : "cc-pip lit") : "cc-pip"} />
            ))}
          </span>
          <span className="cc-led-count">3 ACTIVE</span>
          <span className="cc-led-age">12s</span>
        </span>

        {/* Connecting nav bar — extrudes from the crown */}
        <div className={`cc-navbar${on ? " show" : ""}`} />

        {/* Inner round seats springing from the crown onto the shared centerline */}
        <div className="cc-orbit" style={{ top: 799 }}>
          {B_INNER.map((it, i) => (
            <div
              key={it.label}
              className={`cc-navitem${on ? " show" : ""}${active === it.label ? " on" : ""}`}
              onClick={() => setActive(it.label)}
              style={{
                transform: on ? `translate(${it.dx}px, 0px) scale(1)` : "translate(0,0) scale(0)",
                opacity: on ? 1 : 0,
                transitionDelay: `${(on ? i : B_INNER.length - 1 - i) * 34}ms`,
              }}
            >
              <span className="cc-navbtn">
                <Glyph kind={it.kind} size={16} />
              </span>
              <span className="cc-navitem-label">{it.label}</span>
            </div>
          ))}
        </div>

        <span className="cc-hint bottom" style={{ opacity: on ? 0 : 1 }}>
          Tap to open
        </span>

        <Crown anchor="bottom" active={on} alive onTap={() => setState(on ? "collapsed" : "assembled")} />

        <div className="cc-homeind" />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Notes column
   ──────────────────────────────────────────────────────────────────── */

function Notes({
  tag,
  rec,
  title,
  children,
  callouts,
}: {
  tag: string;
  rec?: boolean;
  title: string;
  children: React.ReactNode;
  callouts: { mark: string; text: string }[];
}) {
  return (
    <div className="max-w-[440px] font-sans text-[12px] leading-relaxed text-studio-ink-muted">
      <span
        className="font-mono text-[9px] uppercase tracking-[0.14em]"
        style={{ color: rec ? "var(--scout-accent)" : "var(--studio-ink-faint)" }}
      >
        {tag}
      </span>
      <h2 className="mb-2 mt-1.5 font-display text-[16px] font-medium tracking-tight text-studio-ink">{title}</h2>
      <div className="space-y-3 [&_b]:font-semibold [&_b]:text-studio-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-4">
        {children}
      </div>
      <div className="mt-4 space-y-1.5 border-t border-studio-edge pt-3">
        {callouts.map((c) => (
          <div key={c.text} className="flex gap-2 text-[10.5px] text-studio-ink-faint">
            <span className="w-4 flex-none not-italic" style={{ color: "var(--scout-accent)" }}>
              {c.mark}
            </span>
            <span>{c.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export default function CrownComplicationsStudy() {
  const params = useMemo(() => {
    if (typeof window === "undefined") return { variant: null as string | null, state: null as string | null, demo: false };
    const p = new URLSearchParams(window.location.search);
    return { variant: p.get("variant"), state: p.get("state"), demo: p.get("demo") === "1" };
  }, []);

  const forcedT = params.state === "summoned" ? ("summoned" as TState) : params.state === "resting" ? ("resting" as TState) : undefined;
  const forcedB =
    params.state === "summoned" || params.state === "assembled"
      ? ("assembled" as BState)
      : params.state === "resting" || params.state === "collapsed"
        ? ("collapsed" as BState)
        : undefined;

  const [demo, setDemo] = useState(params.demo && !params.state);
  const [demoTick, setDemoTick] = useState(0);
  useEffect(() => {
    if (!demo) return;
    const id = window.setInterval(() => setDemoTick((t) => t + 1), 2600);
    return () => window.clearInterval(id);
  }, [demo]);

  const showT = params.variant !== "B";
  const showB = params.variant !== "T";

  return (
    <main className="ccrown mx-auto max-w-page px-7 py-8">
      <style>{CC_CSS}</style>

      {/* shared gradients for the hex crown */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <linearGradient id="cc-hex-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#241E1A" />
            <stop offset="1" stopColor="#120F0D" />
          </linearGradient>
          <linearGradient id="cc-hex-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3ddc97" />
            <stop offset="1" stopColor="#0BC5A5" />
          </linearGradient>
        </defs>
      </svg>

      <header className="mb-7 max-w-prose">
        <EyebrowLabel size="sm">· studies · ios · chrome</EyebrowLabel>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Crown &amp; Complications
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Proposal C, taken to fidelity and made live. The scout hex is the whole identity — no
          wordmark. Tapping the <b className="font-semibold text-studio-ink">crown</b> summons the
          app&apos;s affordances as complications, with the tap → spring → stagger choreography
          channelled from talkie&apos;s voice-pivot. Two variants, both interactive:{" "}
          <b className="font-semibold text-studio-ink">crown-top</b> (masthead replacement, bottom
          chrome as shipped) and <b className="font-semibold text-studio-ink">crown-bottom as
          primary navigation</b> (no tab bar, no status strip — the crown is everything).
        </p>
      </header>

      {/* control strip */}
      <div className="mb-9 flex max-w-[840px] flex-wrap items-center gap-x-6 gap-y-2 border-y border-studio-edge py-2.5 font-mono text-[10px] text-studio-ink-faint">
        <span className="text-studio-ink-muted">
          Live · tap the crown. Outside / crown again dismisses.
        </span>
        <button
          onClick={() => {
            setDemo((d) => !d);
            setDemoTick(0);
          }}
          className="rounded-[4px] border px-2 py-1 uppercase tracking-[0.1em]"
          style={{
            borderColor: demo ? "var(--scout-accent)" : "var(--studio-edge)",
            color: demo ? "var(--scout-accent)" : "var(--studio-ink-faint)",
          }}
        >
          {demo ? "Auto-demo ▸ on" : "Auto-demo ▸ off"}
        </button>
        <span>
          Deep-link:{" "}
          <code className="text-studio-ink-muted">?variant=T|B</code> ·{" "}
          <code className="text-studio-ink-muted">?state=collapsed|assembled</code> ·{" "}
          <code className="text-studio-ink-muted">?demo=1</code>
        </span>
      </div>

      {showT && (
        <section className="mb-16 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
          <VariantT forced={forcedT} demoTick={demoTick} />
          <Notes
            tag="Variant T · crown top"
            title="A pendant hung from the island"
            callouts={[
              { mark: "+", text: "The island collision becomes the concept: the crown hangs from it on the shared axis, and the tether lights on summon." },
              { mark: "+", text: "On summon Deck + Settings fly UP to flank the island (clearing its 126pt width), the host filter drops below." },
              { mark: "−", text: "The pendant pushes content down a band; the top is busier than Variant B's." },
            ]}
          >
            <p>
              The crown can&apos;t sit top-center — that&apos;s where the <b>Dynamic Island</b> lives.
              So the collision becomes the idea: the crown <b>hangs from the island as a pendant</b>,
              sharing its vertical axis, joined by a short tether. <b>Tap</b> and Deck + Settings fly
              up to <b>flank the island</b> at the top corners (clearing its width), the tether{" "}
              <b>lights emerald</b> (a live-activity bloom nod), and the host-filter row drops in below.
            </p>
            <ul>
              <li>
                <b>It earns the summon</b> by bringing back the host filter — the masthead&apos;s real
                job — rather than re-printing the fleet counts the settled strip already carries.
              </li>
              <li>The bottom tab row + status strip stay exactly as shipped.</li>
              <li>Dismiss by tapping the scrim or the crown again; everything retracts into the hex.</li>
            </ul>
          </Notes>
        </section>
      )}

      {showB && (
        <section className="mb-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
          <VariantB forced={forcedB} demoTick={demoTick} />
          <Notes
            tag="Variant B · crown = slot model"
            rec
            title="Corners + a connecting nav bar"
            callouts={[
              { mark: "+", text: "The whole bottom is ONE unit: a continuous bar whose ends meet the Home/New end-caps, four round inner targets seated inside, crown centered." },
              { mark: "+", text: "The Fleet LED is a first-class element — an inset well, pip meter, tight glow. Candidate to repurpose the whole bottom status strip." },
              { mark: "−", text: "Deck and Home both read as the dashboard grid — Deck needs a distinct glyph before the native port." },
            ]}
          >
            <p>
              The operator&apos;s direction: the model is just <b>summon + complications</b>. Four{" "}
              <b>big corner circles</b> are the primary affordances — Deck · Settings up, Home · New
              down. The bottom is <b>one continuous nav bar</b>: it extrudes from the crown and its
              rounded ends <b>meet the Home/New circles as end-caps</b>, so the whole assembly reads
              as a single unit. The four inner surfaces (<b>Agents · Tail | crown | Comms · Term</b>)
              are <b>distinct round button targets seated inside the bar</b> with micro labels — not
              loose pills. No status strip, no separate container.
            </p>
            <ul>
              <li>
                <b>The Fleet LED readout is the surprise hit</b> — top-middle, an inset instrument
                well with a pip meter (lit = active of total), a tightly-glowing count, and a dim
                age that sinks rather than alarms (the shipped FETCHED relative-age discipline, no
                yellow warn). Glow is disciplined, never neon.
              </li>
              <li>
                <b>The summon choreography is preserved as a focus toggle</b> — tap the crown and the
                whole interface collapses into it; tap again and the bar extrudes and the corners pop
                back, staggered.
              </li>
              <li>Active destination is the accent slot; tap any corner or inner slot to switch.</li>
            </ul>
            <p className="text-studio-ink-faint">
              Convergence note: the LED language is a strong candidate for how the bottom status strip
              eventually gets repurposed — from a text one-liner into a &ldquo;showcase the active
              fleet&rdquo; LED bar, the same grammar top and bottom.
            </p>
          </Notes>
        </section>
      )}

      <div className="mt-2 mb-4 max-w-[820px] border-l-2 border-studio-edge pl-3.5 font-sans text-[11px] leading-relaxed text-studio-ink-faint">
        <b className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-studio-ink-muted">
          Island-adaptive rule
        </b>
        <p className="mt-1.5">
          The Dynamic Island is rendered in every frame (~126×37pt, 11pt from the top). But it is{" "}
          <b className="font-semibold text-studio-ink">not universal</b>: iPad and older notched
          phones have no island. So the geometry must derive from the{" "}
          <b className="font-semibold text-studio-ink">safe area</b>, not hardcoded island metrics —
          the pendant offset (T) and the LED drop-below (B) key off the top inset. Where there is no
          island, the crown reclaims true top-center (T) and the LED rises into the freed band (B).
        </p>
      </div>

      <p className="mt-2 border-t border-studio-edge pt-5 font-sans text-[11px] leading-relaxed text-studio-ink-faint">
        Static-free study — real pointer + motion. Springs are cubic-bezier(.34,1.56,.64,1) with
        per-item stagger, channelled from talkie&apos;s voice-pivot (response .34–.42, damping .72,
        long-press 350ms). Slot vocabulary is HudPhoneComplications (topLeft / topRight / center,
        tray vs minimal). Palette + glyphs are the faithful Scout warm-tone port; production app
        untouched. Native port target: RootView.swift titleBar / dockedTabBar via{" "}
        <code className="font-mono text-studio-ink-muted">.hudComplications</code> on HudPhoneAppShell.
      </p>
    </main>
  );
}
