"use client";

/**
 * iOS Home · Everyday Lane — a persona-lane study.
 *
 * The shipped iOS app has one navigation personality: the summonable crown
 * (hex identity, corner complications, machined dark console — see
 * /studies/crown-complications). That is the OPERATOR lane. This study asks
 * what the SAME product content looks like for someone who just wants a very
 * well designed, completely normal iOS app — the EVERYDAY lane.
 *
 * Same sections as HomeSurface.swift (fleet vitals, currently working,
 * activity, ask-the-fleet), re-expressed in stock iOS grammar: light grouped
 * canvas, large-title header, rounded-2xl cards, a plain tab bar, and calm
 * status pills where the operator lane has hex complications. No machined
 * textures, no LED console, no summon choreography.
 *
 * The Operator lane is intentionally NOT rebuilt here — a small reference
 * thumbnail stands in for it; the crown study remains its source of truth.
 *
 * V2 — composer-first launch (the owner's "smart, beautiful default"):
 * the app launches into a LAUNCH frame — a one-line composer, the dominant
 * paired host as ambient context, and one-tap task start pre-filled with the
 * most-recent settings (harness/model/effort chips + most-recent project).
 * No cards, no pills grid, no tab bar: composer + top anchors only. The v1
 * dashboard becomes OVERVIEW (the supervision surface), reached via the
 * top-left anchor. Landing is configurable (composer recommended).
 *
 * URL params:
 *   ?lane=everyday|operator   — force the visible lane (default: everyday)
 *   ?landing=composer|overview — which frame is the presented default (default: composer)
 *   ?composer=open|closed     — Launch-frame composer expanded state (default: closed)
 */

import { useMemo, useState } from "react";
import {
  ArrowUp,
  Bell,
  ChevronDown,
  ChevronRight,
  House,
  MessageSquare,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { EyebrowLabel } from "@/components/EyebrowLabel";
import { DeviceShell } from "@/components/DeviceShell";

/* ────────────────────────────────────────────────────────────────────
   Scoped phone CSS — prefixed `.vn-`, rooted at `.vnlane`.
   Light, system-like: grouped gray canvas, white cards, hairlines,
   one restrained emerald accent (scout brand, calmed down).
   ──────────────────────────────────────────────────────────────────── */

const VN_CSS = `
.vnlane{--vn-bg:#F2F2F7;--vn-card:#FFFFFF;--vn-ink:#1C1C1E;--vn-sub:#8A8A8E;
  --vn-faint:#AEAEB2;--vn-hair:rgba(60,60,67,.12);--vn-fill:rgba(120,120,128,.12);
  --vn-fill2:rgba(120,120,128,.16);
  --vn-accent:#0B8A5F;--vn-accent-soft:rgba(11,138,95,.10);
  --vn-green:#30B454;--vn-amber:#E8A13A;
  --vn-ui:"Inter Tight","Inter",-apple-system,"SF Pro Text",sans-serif;
  --vn-mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace}
.vnlane{font-family:var(--vn-ui);-webkit-font-smoothing:antialiased}

/* Phone frame — the shared <DeviceShell> (components/DeviceShell) draws the
   bezel, Dynamic Island, status bar and home indicator; only the screen's
   canvas color stays local. Presented at ~.87 scale. */
.vn-screen{background:var(--vn-bg)}

/* Scroll content */
.vn-scroll{position:absolute;inset:0;padding:0 16px;overflow:hidden;
  display:flex;flex-direction:column}

/* Large-title header */
.vn-header{padding:56px 4px 0;display:flex;align-items:flex-end;
  justify-content:space-between}
.vn-header .vn-date{font-size: var(--text-md);font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;color:var(--vn-sub)}
.vn-header h1{margin:2px 0 0;font-size: var(--text-6xl);font-weight:700;
  letter-spacing:-.02em;color:var(--vn-ink);line-height:1.1}
.vn-header .vn-bell{position:relative;width:34px;height:34px;border-radius:50%;
  background:var(--vn-card);display:flex;align-items:center;justify-content:center;
  color:var(--vn-ink);box-shadow:0 1px 2px rgba(0,0,0,.05)}
.vn-header .vn-bell i{position:absolute;top:7px;right:8px;width:8px;height:8px;
  border-radius:50%;background:var(--vn-amber);border:1.5px solid var(--vn-bg)}

/* Calm status pills — the everyday answer to complications */
.vn-pills{display:flex;gap:6px;padding:10px 4px 0;flex-wrap:wrap}
.vn-pill{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;
  border-radius:13px;background:var(--vn-card);font-size: var(--text-sm);font-weight:500;
  color:var(--vn-sub);box-shadow:0 1px 2px rgba(0,0,0,.04)}
.vn-pill b{font-weight:600;color:var(--vn-ink)}
.vn-pill .vn-pdot{width:6px;height:6px;border-radius:50%;background:var(--vn-green)}
.vn-pill.dim .vn-pdot{background:var(--vn-faint)}

/* Section label (grouped-list idiom) */
.vn-sect{font-size: var(--text-md);font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  color:var(--vn-sub);padding:15px 8px 6px;display:flex;align-items:baseline;
  justify-content:space-between}
.vn-sect .vn-seemore{font-size: var(--text-md);font-weight:500;letter-spacing:0;
  text-transform:none;color:var(--vn-accent)}

/* Card */
.vn-card{background:var(--vn-card);border-radius:18px;
  box-shadow:0 1px 2px rgba(0,0,0,.05)}
.vn-card-pad{padding:12px 16px}

/* Fleet summary card */
.vn-fleet{display:flex;align-items:center;justify-content:space-between;gap:12px}
.vn-fleet .vn-cap{font-size: var(--text-md);font-weight:500;color:var(--vn-sub)}
.vn-fleet .vn-big{margin-top:3px;font-size: var(--text-4xl);font-weight:700;
  letter-spacing:-.01em;color:var(--vn-ink)}
.vn-fleet .vn-sub2{margin-top:3px;font-size: var(--text-md);color:var(--vn-sub)}
.vn-fleet .vn-sub2 em{font-style:normal;color:var(--vn-accent);font-weight:600}
.vn-spark{flex:none;opacity:.85}

/* Working rows — one calm line each: harness dot, name, project path, recency */
.vn-wrow{display:flex;align-items:center;gap:10px;padding:11px 16px;
  border-bottom:.5px solid var(--vn-hair)}
.vn-wrow:last-child{border-bottom:none}
.vn-hdot{width:8px;height:8px;border-radius:50%;flex:none}
.vn-wname{font-size: var(--text-lg);font-weight:600;color:var(--vn-ink);flex:none}
.vn-wharness{font-size: var(--text-sm);font-weight:500;color:var(--vn-sub);flex:none}
.vn-wpath{flex:1;min-width:0;font-family:var(--vn-mono);font-size: var(--text-xs);
  color:var(--vn-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vn-wright{display:flex;align-items:center;gap:3px;flex:none}
.vn-wage{font-size: var(--text-sm);color:var(--vn-faint);font-variant-numeric:tabular-nums}
.vn-wage.live{color:var(--vn-accent);font-weight:600}
.vn-wage.live::before{content:"";display:inline-block;width:5px;height:5px;
  border-radius:50%;background:var(--vn-green);margin-right:4px;vertical-align:1.5px}

/* Activity rows */
.vn-arow{display:flex;align-items:flex-start;gap:10px;padding:9px 16px;
  border-bottom:.5px solid var(--vn-hair)}
.vn-arow:last-child{border-bottom:none}
.vn-aicon{width:26px;height:26px;border-radius:8px;flex:none;
  display:flex;align-items:center;justify-content:center;
  background:var(--vn-accent-soft);color:var(--vn-accent);margin-top:1px}
.vn-amain{flex:1;min-width:0}
.vn-atext{font-size: var(--text-lg);line-height:1.35;color:var(--vn-ink)}
.vn-atext b{font-weight:600}
.vn-ameta{margin-top:2px;font-size: var(--text-sm);color:var(--vn-faint)}

/* Ask the fleet composer */
.vn-composer{margin:16px 0 0;display:flex;align-items:center;gap:8px;
  background:var(--vn-card);border-radius:24px;padding:6px 6px 6px 16px;
  box-shadow:0 1px 3px rgba(0,0,0,.06)}
.vn-composer .vn-ph{flex:1;font-size: var(--text-xl);color:var(--vn-faint)}
.vn-composer .vn-send{width:32px;height:32px;border-radius:50%;flex:none;
  background:var(--vn-accent);color:#fff;display:flex;align-items:center;
  justify-content:center}

/* Tab bar */
.vn-tabbar{position:absolute;left:0;right:0;bottom:0;z-index:20;
  display:flex;padding:6px 8px 24px;background:rgba(249,249,249,.94);
  border-top:.5px solid var(--vn-hair);backdrop-filter:blur(10px)}
.vn-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;
  color:var(--vn-faint);padding-top:2px}
.vn-tab.on{color:var(--vn-accent)}
.vn-tab .vn-tlabel{font-size: var(--text-xs);font-weight:500}

/* Agents frame bits */
.vn-navheader{padding:62px 4px 0;display:flex;align-items:center;
  justify-content:space-between}
.vn-navheader h1{margin:0;font-size: var(--text-3xl);font-weight:600;color:var(--vn-ink)}
.vn-navheader .vn-add{width:30px;height:30px;border-radius:50%;
  background:var(--vn-accent-soft);color:var(--vn-accent);display:flex;
  align-items:center;justify-content:center;font-size: var(--text-3xl);font-weight:500}
.vn-search{margin:12px 4px 0;display:flex;align-items:center;gap:6px;
  height:34px;border-radius:10px;background:var(--vn-fill);padding:0 10px;
  color:var(--vn-sub);font-size: var(--text-xl)}
.vn-seg{margin:12px 4px 0;display:flex;background:var(--vn-fill);
  border-radius:9px;padding:2px}
.vn-seg span{flex:1;text-align:center;font-size: var(--text-md);font-weight:500;
  color:var(--vn-sub);padding:5px 0;border-radius:7px}
.vn-seg span.on{background:var(--vn-card);color:var(--vn-ink);
  box-shadow:0 1px 3px rgba(0,0,0,.10)}
.vn-agrow{display:flex;align-items:center;gap:11px;padding:11px 16px;
  border-bottom:.5px solid var(--vn-hair)}
.vn-agrow:last-child{border-bottom:none}
.vn-avatar{width:34px;height:34px;border-radius:50%;flex:none;position:relative;
  display:flex;align-items:center;justify-content:center;font-size: var(--text-md);
  font-weight:600;color:#fff}
.vn-avatar i{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;
  border-radius:50%;border:2px solid var(--vn-card)}
.vn-agmain{flex:1;min-width:0}
.vn-agname{font-size: var(--text-xl);font-weight:600;color:var(--vn-ink)}
.vn-agpath{font-family:var(--vn-mono);font-size: var(--text-xs);color:var(--vn-faint);
  margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vn-agpill{flex:none;font-size: var(--text-xs);font-weight:600;padding:3px 8px;
  border-radius:9px}
.vn-agpill.working{color:var(--vn-accent);background:var(--vn-accent-soft)}
.vn-agpill.idle{color:var(--vn-sub);background:var(--vn-fill)}
.vn-agpill.waiting{color:#B07A1E;background:rgba(232,161,58,.16)}

/* ── Launch frame (v2) — composer-first, no tab bar ──────────────────
   Top anchors only: avatar (→ Overview) left, bell right. Dominant host as
   ambient context, fleet status as ONE calm line, most-recent settings as
   plain list rows + chips, and a bottom-pinned composer that expands on tap. */
.vn-lanchors{position:absolute;top:0;left:0;right:0;z-index:22;display:flex;
  align-items:center;justify-content:space-between;padding:60px 18px 0}
.vn-lavatar{position:relative;width:34px;height:34px;border-radius:50%;cursor:pointer;
  background:var(--vn-accent-soft);color:var(--vn-accent);display:flex;
  align-items:center;justify-content:center;font-size: var(--text-lg);font-weight:700;
  box-shadow:0 1px 2px rgba(0,0,0,.05)}
.vn-lavatar i{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;
  border-radius:50%;background:var(--vn-green);border:2px solid var(--vn-bg)}
.vn-lbell{position:relative;width:34px;height:34px;border-radius:50%;
  background:var(--vn-card);display:flex;align-items:center;justify-content:center;
  color:var(--vn-ink);box-shadow:0 1px 2px rgba(0,0,0,.05)}
.vn-lbell i{position:absolute;top:7px;right:8px;width:8px;height:8px;
  border-radius:50%;background:var(--vn-amber);border:1.5px solid var(--vn-bg)}
.vn-launch{position:absolute;inset:0;padding:116px 20px 0;display:flex;flex-direction:column}
.vn-lhost{display:flex;align-items:center;gap:6px;font-size: var(--text-md);font-weight:600;
  letter-spacing:.07em;text-transform:uppercase;color:var(--vn-sub)}
.vn-lhost .vn-pdot{width:6px;height:6px;border-radius:50%;background:var(--vn-green)}
.vn-launch h1{margin:10px 0 0;font-size: var(--text-6xl);font-weight:700;letter-spacing:-.02em;
  color:var(--vn-ink)}
.vn-lfleet{margin-top:7px;font-size: var(--text-lg);color:var(--vn-sub)}
.vn-lfleet b{font-weight:600;color:var(--vn-accent)}
.vn-lpre{margin-top:32px;border-top:.5px solid var(--vn-hair)}
.vn-lprow{display:flex;align-items:center;gap:10px;padding:12px 2px;
  border-bottom:.5px solid var(--vn-hair)}
.vn-lpmain{flex:1;min-width:0}
.vn-lplabel{font-size: var(--text-sm);font-weight:500;color:var(--vn-sub)}
.vn-lpname{margin-top:1px;font-size: var(--text-2xl);font-weight:600;color:var(--vn-ink)}
.vn-lppath{margin-top:2px;font-family:var(--vn-mono);font-size: var(--text-xs);color:var(--vn-faint)}
.vn-lchips{display:flex;gap:6px;padding:12px 2px;border-bottom:.5px solid var(--vn-hair);
  flex-wrap:wrap}
.vn-lchip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 11px;
  border-radius:14px;border:1px solid var(--vn-hair);background:var(--vn-card);
  font-size: var(--text-md);font-weight:500;color:var(--vn-ink);cursor:pointer}
.vn-lchip .vn-cdot{width:6px;height:6px;border-radius:50%}
.vn-lchip svg{color:var(--vn-faint)}
.vn-lhint{margin-top:14px;font-size: var(--text-sm);line-height:1.45;color:var(--vn-faint)}

/* Composer — bottom-pinned, one-line at rest, expands on tap */
.vn-lcomposer{position:absolute;left:16px;right:16px;bottom:30px;z-index:21;cursor:pointer}
.vn-lc-idle{display:flex;align-items:center;gap:8px;background:var(--vn-card);
  border-radius:24px;padding:6px 6px 6px 16px;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.vn-lc-idle .vn-ph{flex:1;font-size: var(--text-xl);color:var(--vn-faint)}
.vn-lc-idle .vn-send,.vn-lc-send{width:32px;height:32px;border-radius:50%;flex:none;
  background:var(--vn-accent);color:#fff;display:flex;align-items:center;justify-content:center}
.vn-lc-open{background:var(--vn-card);border-radius:20px;padding:12px 14px 10px;
  box-shadow:0 2px 12px rgba(0,0,0,.09);cursor:default}
.vn-lc-line{font-size: var(--text-xl);color:var(--vn-faint);padding:2px 2px 11px}
.vn-lc-rule{height:.5px;background:var(--vn-hair)}
.vn-lc-row{display:flex;align-items:center;gap:6px;padding-top:10px}
.vn-lc-chip{display:inline-flex;align-items:center;gap:4px;height:25px;padding:0 9px;
  border-radius:12.5px;border:1px solid var(--vn-hair);font-size: var(--text-sm);font-weight:500;
  color:var(--vn-ink);white-space:nowrap}
.vn-lc-chip .vn-cdot{width:5px;height:5px;border-radius:50%}
.vn-lc-chip svg{color:var(--vn-faint)}
.vn-lc-row .vn-lc-send{width:28px;height:28px;margin-left:auto}

/* ── Operator reference thumbnail (deliberately minimal — a stand-in,
     NOT a rebuild of the crown) ── */

.vn-opscreen{background:linear-gradient(180deg,#100E0B 0%,#0A0A0A 40%,#060504 100%)}
.vn-op-row{margin:0 34px;padding:13px 2px;border-bottom:1px solid #1a1a1a;
  display:flex;align-items:center;gap:9px}
.vn-op-row i{width:5px;height:5px;border-radius:50%;background:#10B981}
.vn-op-row.dim i{background:#5a5a5a}
.vn-op-row span{height:6px;border-radius:3px;background:#242424;flex:1}
.vn-op-corner{position:absolute;width:54px;height:54px;border-radius:50%;
  background:linear-gradient(180deg,#211C19,#171411);
  box-shadow:inset 0 1px 0 #433A30,0 5px 13px rgba(0,0,0,.55)}
.vn-op-bar{position:absolute;left:50%;bottom:27px;transform:translateX(-50%);
  width:357px;height:52px;border-radius:26px;
  background:linear-gradient(180deg,#131516,#0B0D0E);border:1px solid #3A3E3F}
.vn-op-crown{position:absolute;left:50%;bottom:25px;transform:translateX(-50%);
  width:56px;height:56px;border-radius:50%;
  background:linear-gradient(180deg,#241E1A,#120F0D);
  box-shadow:inset 0 1px 0 #433A30,0 6px 16px rgba(0,0,0,.55),0 0 0 1px rgba(16,185,129,.35);
  display:flex;align-items:center;justify-content:center}
.vn-op-tag{position:absolute;top:14px;left:14px;font-family:var(--vn-mono);
  font-size: var(--text-2xs);letter-spacing:.16em;text-transform:uppercase;color:#6b6b6b}
`;

/* ────────────────────────────────────────────────────────────────────
   Shared pieces
   ──────────────────────────────────────────────────────────────────── */

/** Calm status pills — the everyday-lane answer to corner complications. */
function StatusPills() {
  return (
    <div className="vn-pills">
      <span className="vn-pill">
        <span className="vn-pdot" />
        <b>3 active</b>&nbsp;of 6 agents
      </span>
      <span className="vn-pill">arach-mbp · LAN</span>
      <span className="vn-pill dim">
        <span className="vn-pdot" />
        Synced 12s ago
      </span>
    </div>
  );
}

/** Muted sparkline — vitals kept, drama removed. */
function Spark() {
  return (
    <svg className="vn-spark" width="86" height="34" viewBox="0 0 86 34" aria-hidden>
      <polyline
        points="0,26 10,24 20,25 30,18 40,20 50,12 60,15 70,9 86,11"
        fill="none"
        stroke="#0B8A5F"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".55"
      />
      <circle cx="86" cy="11" r="3" fill="#0B8A5F" />
    </svg>
  );
}

function TabBar({ active }: { active: "home" | "agents" | "activity" | "settings" }) {
  const tabs = [
    { id: "home", label: "Home", Icon: House },
    { id: "agents", label: "Agents", Icon: Users },
    { id: "activity", label: "Activity", Icon: MessageSquare },
    { id: "settings", label: "Settings", Icon: Settings },
  ] as const;
  return (
    <div className="vn-tabbar">
      {tabs.map(({ id, label, Icon }) => (
        <span key={id} className={id === active ? "vn-tab on" : "vn-tab"}>
          <Icon size={22} strokeWidth={id === active ? 2.1 : 1.7} />
          <span className="vn-tlabel">{label}</span>
        </span>
      ))}
    </div>
  );
}

/* ── Frame 1 · HOME ─────────────────────────────────────────────────── */

const WORKING = [
  { name: "@voltaire", harness: "Claude", dot: "#D97757", path: "~/dev/openscout · main", age: "now", live: true },
  { name: "@beatrix", harness: "Codex", dot: "#10A37F", path: "~/dev/openscout · docs", age: "now", live: true },
  { name: "@moss", harness: "Claude", dot: "#D97757", path: "~/dev/openscout · landing", age: "4m", live: false },
  { name: "@fern", harness: "Codex", dot: "#10A37F", path: "~/dev/scout-ios · audit", age: "12m", live: false },
];

const ACTIVITY = [
  { text: <><b>@voltaire</b> asked for a review on the auth-refresh diff</>, meta: "2m ago · #reviews" },
  { text: <><b>@moss</b> finished “landing-refresh” — 14 files changed</>, meta: "22m ago" },
];

function HomeFrame() {
  return (
    <DeviceShell device="iphone" scale={0.8705} screenClassName="vn-screen">
      <div className="vn-scroll">
          <div className="vn-header">
            <div>
              <span className="vn-date">Tuesday, Jul 21</span>
              <h1>Home</h1>
            </div>
            <span className="vn-bell">
              <Bell size={17} strokeWidth={1.9} />
              <i />
            </span>
          </div>

          <StatusPills />

          <div className="vn-sect"><span>Your fleet</span></div>
          <div className="vn-card vn-card-pad">
            <div className="vn-fleet">
              <div>
                <div className="vn-cap">arach-mbp · studio-mac</div>
                <div className="vn-big">3 agents working</div>
                <div className="vn-sub2">2 hosts online · <em>all clear</em></div>
              </div>
              <Spark />
            </div>
          </div>

          <div className="vn-sect"><span>Currently working</span><span className="vn-seemore">See all</span></div>
          <div className="vn-card">
            {WORKING.map((r) => (
              <div key={r.name} className="vn-wrow">
                <span className="vn-hdot" style={{ background: r.dot }} />
                <span className="vn-wname">{r.name}</span>
                <span className="vn-wharness">{r.harness}</span>
                <span className="vn-wpath">{r.path}</span>
                <div className="vn-wright">
                  <span className={r.live ? "vn-wage live" : "vn-wage"}>{r.age}</span>
                  <ChevronRight size={14} strokeWidth={2} color="#C7C7CC" />
                </div>
              </div>
            ))}
          </div>

          <div className="vn-sect"><span>Recent activity</span><span className="vn-seemore">Comms</span></div>
          <div className="vn-card">
            {ACTIVITY.map((r, i) => (
              <div key={i} className="vn-arow">
                <span className="vn-aicon">
                  <MessageSquare size={13} strokeWidth={2} />
                </span>
                <div className="vn-amain">
                  <div className="vn-atext">{r.text}</div>
                  <div className="vn-ameta">{r.meta}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="vn-composer">
            <span className="vn-ph">Ask the fleet…</span>
            <span className="vn-send">
              <ArrowUp size={16} strokeWidth={2.6} />
            </span>
          </div>
      </div>
      <TabBar active="home" />
    </DeviceShell>
  );
}

/* ── Frame 2 · AGENTS (tab-bar navigation state) ────────────────────── */

const AGENTS = [
  { name: "@voltaire", harness: "Claude", color: "#D97757", dot: "#30B454", path: "~/dev/openscout · main", pill: "working", cls: "working" },
  { name: "@beatrix", harness: "Codex", color: "#10A37F", dot: "#30B454", path: "~/dev/openscout · docs-sweep", pill: "working", cls: "working" },
  { name: "@moss", harness: "Claude", color: "#C4684A", dot: "#E8A13A", path: "~/dev/openscout · landing", pill: "waiting", cls: "waiting" },
  { name: "@fern", harness: "Codex", color: "#0E8A72", dot: "#AEAEB2", path: "~/dev/scout-ios · audit", pill: "idle", cls: "idle" },
  { name: "@sable", harness: "Claude", color: "#B06044", dot: "#AEAEB2", path: "~/dev/landing · oscout.net", pill: "idle", cls: "idle" },
  { name: "@puck", harness: "Codex", color: "#0B7A64", dot: "#AEAEB2", path: "~/dev/openscout · nightly", pill: "idle", cls: "idle" },
];

function AgentsFrame() {
  return (
    <DeviceShell device="iphone" scale={0.8705} screenClassName="vn-screen">
      <div className="vn-scroll">
          <div className="vn-navheader">
            <span style={{ width: 30 }} />
            <h1>Agents</h1>
            <span className="vn-add">+</span>
          </div>
          <div className="vn-search">
            <Search size={15} strokeWidth={2} />
            <span>Search agents or projects</span>
          </div>
          <div className="vn-seg">
            <span className="on">All hosts</span>
            <span>arach-mbp</span>
            <span>studio-mac</span>
          </div>

          <div className="vn-sect"><span>6 agents · 2 hosts</span></div>
          <div className="vn-card">
            {AGENTS.map((a) => (
              <div key={a.name} className="vn-agrow">
                <span className="vn-avatar" style={{ background: a.color }}>
                  {a.name.slice(1, 3).toUpperCase()}
                  <i style={{ background: a.dot }} />
                </span>
                <div className="vn-agmain">
                  <div className="vn-agname">
                    {a.name} <span style={{ fontWeight: 500, color: "#8A8A8E", fontSize: 12 }}>· {a.harness}</span>
                  </div>
                  <div className="vn-agpath">{a.path}</div>
                </div>
                <span className={`vn-agpill ${a.cls}`}>{a.pill}</span>
                <ChevronRight size={14} strokeWidth={2} color="#C7C7CC" />
              </div>
            ))}
          </div>
      </div>
      <TabBar active="agents" />
    </DeviceShell>
  );
}

/* ── Frame 0 · LAUNCH (v2) — composer-first, the zero-navigation default ── */

function LaunchFrame({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <DeviceShell device="iphone" scale={0.8705} screenClassName="vn-screen">
      {/* Top anchors only — no tab bar. Left avatar is the Overview complication. */}
        <div className="vn-lanchors">
          <span className="vn-lavatar">
            A<i />
          </span>
          <span className="vn-lbell">
            <Bell size={16} strokeWidth={1.9} />
            <i />
          </span>
        </div>

        <div className="vn-launch">
          <span className="vn-lhost">
            <span className="vn-pdot" />
            arach-mbp · LAN
          </span>
          <h1>Start a task</h1>
          <span className="vn-lfleet">
            <b>3 agents working</b> · all clear
          </span>

          {/* One-tap start: most-recent settings pre-filled */}
          <div className="vn-lpre">
            <div className="vn-lprow">
              <div className="vn-lpmain">
                <div className="vn-lplabel">Project · most recent</div>
                <div className="vn-lpname">openscout</div>
                <div className="vn-lppath">~/dev/openscout · main</div>
              </div>
              <ChevronRight size={15} strokeWidth={2} color="#C7C7CC" />
            </div>
            <div className="vn-lchips">
              <span className="vn-lchip">
                <span className="vn-cdot" style={{ background: "#D97757" }} />
                Claude Code
                <ChevronDown size={12} strokeWidth={2} />
              </span>
              <span className="vn-lchip">
                Sonnet 4.5
                <ChevronDown size={12} strokeWidth={2} />
              </span>
              <span className="vn-lchip">
                Medium effort
                <ChevronDown size={12} strokeWidth={2} />
              </span>
            </div>
          </div>

          <p className="vn-lhint">
            Pre-filled from your last task. Edit the chips, or just type and send.
          </p>
        </div>

        {/* The compact composer — one line at rest, full affordances on tap */}
        <div className="vn-lcomposer" onClick={open ? undefined : onToggle}>
          {open ? (
            <div className="vn-lc-open">
              <div className="vn-lc-line">Ask the fleet…</div>
              <div className="vn-lc-rule" />
              <div className="vn-lc-row">
                <span className="vn-lc-chip">
                  <span className="vn-cdot" style={{ background: "#D97757" }} />
                  Claude Code
                  <ChevronDown size={11} strokeWidth={2} />
                </span>
                <span className="vn-lc-chip">
                  Sonnet 4.5
                  <ChevronDown size={11} strokeWidth={2} />
                </span>
                <span className="vn-lc-chip">
                  Medium
                  <ChevronDown size={11} strokeWidth={2} />
                </span>
                <span className="vn-lc-send">
                  <ArrowUp size={15} strokeWidth={2.6} />
                </span>
              </div>
            </div>
          ) : (
            <div className="vn-lc-idle">
              <span className="vn-ph">Ask the fleet…</span>
              <span className="vn-send">
                <ArrowUp size={16} strokeWidth={2.6} />
              </span>
            </div>
          )}
        </div>
    </DeviceShell>
  );
}

/* ── Navigation relationship: Launch -(top-left anchor)→ Overview ───── */

function NavAnnotation() {
  return (
    <div className="hidden w-[108px] flex-none flex-col items-center gap-2 pt-[40px] lg:flex">
      <span className="text-center font-mono text-3xs uppercase tracking-[0.14em] text-studio-ink-faint">
        top-left anchor
      </span>
      <svg width="96" height="22" viewBox="0 0 96 22" aria-hidden>
        <line x1="2" y1="11" x2="82" y2="11" stroke="var(--studio-edge-strong)" strokeWidth="1" />
        <polygon points="82,5 94,11 82,17" fill="var(--studio-edge-strong)" />
      </svg>
      <span className="text-center font-mono text-3xs uppercase leading-relaxed tracking-[0.14em] text-studio-ink-faint">
        opens Overview
        <br />
        (supervision)
      </span>
    </div>
  );
}

/** Caption under a phone frame — name, role, and the landing-default badge. */
function FrameCaption({ name, role, isDefault }: { name: string; role: string; isDefault?: boolean }) {
  return (
    <div className="mt-4 flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.14em] text-studio-ink-faint">
      <span className="text-studio-ink-muted">{name}</span>
      <span>·</span>
      <span>{role}</span>
      {isDefault && (
        <span
          className="rounded-[3px] border px-1.5 py-0.5"
          style={{ borderColor: "var(--scout-accent)", color: "var(--scout-accent)" }}
        >
          default
        </span>
      )}
    </div>
  );
}

/* ── Operator lane reference (thumbnail only, not a rebuild) ────────── */

function OperatorThumb() {
  return (
    <DeviceShell
      device="iphone"
      scale={0.4508}
      tone="dark"
      statusBar={false}
      homeIndicator={false}
      screenClassName="vn-opscreen"
    >
      <span className="vn-op-tag">Operator</span>
      <div style={{ paddingTop: 120 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={i > 2 ? "vn-op-row dim" : "vn-op-row"}>
            <i />
            <span />
          </div>
        ))}
      </div>
      <span className="vn-op-corner" style={{ top: 18, left: 18 }} />
      <span className="vn-op-corner" style={{ top: 18, right: 18 }} />
      <span className="vn-op-corner" style={{ bottom: 26, left: 20 }} />
      <span className="vn-op-corner" style={{ bottom: 26, right: 20 }} />
      <span className="vn-op-bar" />
      <span className="vn-op-crown">
        <svg width="30" height="30" viewBox="0 0 48 48">
          <polygon points="24,4 41,14 41,34 24,44 7,34 7,14" fill="#1a1512" stroke="#10B981" strokeWidth="1.6" />
          <circle cx="24" cy="24" r="3.1" fill="#10B981" />
        </svg>
      </span>
    </DeviceShell>
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
    <div className="max-w-[440px] font-sans text-md leading-relaxed text-studio-ink-muted">
      <span
        className="font-mono text-2xs uppercase tracking-[0.14em]"
        style={{ color: rec ? "var(--scout-accent)" : "var(--studio-ink-faint)" }}
      >
        {tag}
      </span>
      <h2 className="mb-2 mt-1.5 font-display text-2xl font-medium tracking-tight text-studio-ink">{title}</h2>
      <div className="space-y-3 [&_b]:font-semibold [&_b]:text-studio-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-4">
        {children}
      </div>
      <div className="mt-4 space-y-1.5 border-t border-studio-edge pt-3">
        {callouts.map((c) => (
          <div key={c.text} className="flex gap-2 text-xs text-studio-ink-faint">
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

type Lane = "everyday" | "operator";
type Landing = "composer" | "overview";

export default function IosHomeVanillaStudy() {
  const params = useMemo(() => {
    if (typeof window === "undefined")
      return { lane: "everyday" as Lane, landing: "composer" as Landing, composerOpen: false };
    const p = new URLSearchParams(window.location.search);
    return {
      lane: (p.get("lane") === "operator" ? "operator" : "everyday") as Lane,
      landing: (p.get("landing") === "overview" ? "overview" : "composer") as Landing,
      composerOpen: p.get("composer") === "open",
    };
  }, []);
  const [lane, setLane] = useState<Lane>(params.lane);
  const [landing, setLanding] = useState<Landing>(params.landing);
  const [composerOpen, setComposerOpen] = useState(params.composerOpen);

  return (
    <main className="vnlane mx-auto max-w-page px-7 py-8">
      <style>{VN_CSS}</style>

      <header className="mb-7 max-w-prose">
        <EyebrowLabel size="sm">· studies · ios · persona lanes</EyebrowLabel>
        <h1 className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-studio-ink">
          Everyday Home
        </h1>
        <p className="mt-3 font-sans text-lg leading-relaxed text-studio-ink-faint">
          One product, two personalities. The <b className="font-semibold text-studio-ink">Operator lane</b>{" "}
          keeps the crown — hex identity, corner complications, machined console. The{" "}
          <b className="font-semibold text-studio-ink">Everyday lane</b> is the same fleet, the same
          sections, re-expressed as a very well designed but completely <i>normal</i> iOS app.
          <b className="font-semibold text-studio-ink"> v2:</b> the lane launches into a{" "}
          <b className="font-semibold text-studio-ink">composer-first default</b> — one line to the
          fleet, most-recent settings pre-filled, no tab bar — and the v1 dashboard becomes{" "}
          <b className="font-semibold text-studio-ink">Overview</b>, the supervision surface one tap
          away via the top-left anchor.
        </p>
      </header>

      {/* Lane switcher + landing preference */}
      <div className="mb-9 flex max-w-[840px] flex-wrap items-center gap-x-6 gap-y-2 border-y border-studio-edge py-2.5 font-mono text-xs text-studio-ink-faint">
        <span className="text-studio-ink-muted">Persona lane:</span>
        <div className="flex overflow-hidden rounded-[4px] border border-studio-edge">
          {(["everyday", "operator"] as Lane[]).map((l) => (
            <button
              key={l}
              onClick={() => setLane(l)}
              className="px-3 py-1 uppercase tracking-[0.1em]"
              style={{
                background: lane === l ? "var(--scout-accent-soft)" : "transparent",
                color: lane === l ? "var(--scout-accent)" : "var(--studio-ink-faint)",
              }}
            >
              {l === "everyday" ? "Everyday" : "Operator"}
            </button>
          ))}
        </div>
        <span className="text-studio-ink-muted">Landing:</span>
        <div className="flex overflow-hidden rounded-[4px] border border-studio-edge">
          {(["composer", "overview"] as Landing[]).map((l) => (
            <button
              key={l}
              onClick={() => setLanding(l)}
              className="px-3 py-1 uppercase tracking-[0.1em]"
              style={{
                background: landing === l ? "var(--scout-accent-soft)" : "transparent",
                color: landing === l ? "var(--scout-accent)" : "var(--studio-ink-faint)",
              }}
            >
              {l === "composer" ? "Composer" : "Overview"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setComposerOpen((o) => !o)}
          className="rounded-[4px] border px-2 py-1 uppercase tracking-[0.1em]"
          style={{
            borderColor: composerOpen ? "var(--scout-accent)" : "var(--studio-edge)",
            color: composerOpen ? "var(--scout-accent)" : "var(--studio-ink-faint)",
          }}
        >
          {composerOpen ? "Composer ▸ open" : "Composer ▸ closed"}
        </button>
        <span>
          Deep-link: <code className="text-studio-ink-muted">?lane=everyday|operator</code> ·{" "}
          <code className="text-studio-ink-muted">?landing=composer|overview</code> ·{" "}
          <code className="text-studio-ink-muted">?composer=open</code>
        </span>
      </div>

      {lane === "everyday" ? (
        <>
          {/* v2 — Launch (composer-first) + Overview (the v1 dashboard) */}
          <section className="mb-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
            <div className="flex flex-wrap items-start gap-8">
              <div className="flex-none">
                <LaunchFrame open={composerOpen} onToggle={() => setComposerOpen((o) => !o)} />
                <FrameCaption name="Launch" role="composer-first · no tab bar" isDefault={landing === "composer"} />
              </div>
              <NavAnnotation />
              <div className="flex-none">
                <HomeFrame />
                <FrameCaption name="Overview" role="supervision · tab bar" isDefault={landing === "overview"} />
              </div>
            </div>
            <Notes
              tag="Everyday lane · v2 · composer-first launch"
              rec
              title="Zero-decision launch, supervision one tap away"
              callouts={[
                { mark: "+", text: "Zero-decision launch: dominant host as ambient context, most-recent project + harness/model/effort pre-filled. Type, tap send — a task is running." },
                { mark: "+", text: "Decision budget: the defaults carry the normal user end-to-end; the deliberate user edits the chips. Same surface, no mode switch, no settings screen." },
                { mark: "−", text: "The dashboard stops being the front door — supervision becomes one tap away instead of zero. Deliberate: composing is the daily verb, the dashboard is the check-in." },
                { mark: "→", text: "Headroom, not scope: a future on-device suggestion layer (Apple Foundation Models — intent routing, smart target prediction, plain-language summaries). Suggestions, never orchestration; explicitly not part of this proposal." },
              ]}
            >
              <p>
                The owner&apos;s v2 direction: launch into a <b>smart, beautiful default</b> instead
                of a dashboard. The <b>Launch frame</b> is composer + top anchors only — no tab bar,
                no cards, no pills grid. The dominant paired host (<b>arach-mbp</b>) is ambient
                context, fleet status is reduced to <b>one calm line</b> (&ldquo;3 agents working ·
                all clear&rdquo;), and the start-a-task surface is pre-filled with the most-recent
                settings: project (<b>openscout · ~/dev/openscout</b>) and harness/model/effort as
                small chips (<b>Claude Code · Sonnet 4.5 · Medium</b>).
              </p>
              <ul>
                <li>
                  <b>The compact composer</b> is one line at rest (&ldquo;Ask the fleet…&rdquo;) and
                  expands on tap into the full affordances — chips, send — without leaving the frame.
                </li>
                <li>
                  <b>Top-left anchor → Overview.</b> The v1 home (fleet card, working, activity,
                  ask) becomes <b>Overview</b>, the supervision surface, reached from the avatar
                  complication. The tab bar lives on Overview; Launch is the zero-navigation default.
                </li>
                <li>
                  <b>Landing is configurable</b> — power users can flip the default to Overview
                  (the <b>Landing</b> switch above). Composer is the recommended default.
                </li>
              </ul>
            </Notes>
          </section>

          {/* v1 mapping — Overview destinations keep the stock grammar */}
          <section className="mb-16 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
            <div className="flex-none">
              <AgentsFrame />
              <FrameCaption name="Agents" role="tab destination · from Overview" />
            </div>
            <Notes
              tag="Everyday lane · overview grammar (v1, unchanged)"
              title="Stock grammar, scout content"
              callouts={[
                { mark: "+", text: "Everything the crown summons is already visible: fleet status as quiet pills, destinations in the tab bar. Zero-discovery-cost navigation." },
                { mark: "−", text: "Loses the crown's single-object identity; the app reads as a client, not an instrument. That's the trade the persona makes deliberately." },
              ]}
            >
              <p>
                Inside Overview the v1 mapping holds. <b>Crown → tab bar</b> (Home · Agents ·
                Activity · Settings). <b>Corner complications → ambient status pills</b>: active-agent
                count, host and route, sync freshness. <b>The Fleet LED → a plain sentence</b>:
                &ldquo;3 agents working, all clear.&rdquo;
              </p>
              <ul>
                <li>
                  <b>Agents</b> shows the navigation state: tab-bar selection, a compact title, a
                  stock search field and host segmented control, agents as a plain grouped list with
                  status pills.
                </li>
                <li>
                  One restrained accent (calmed scout emerald) on a system-gray palette; Inter for
                  UI, JetBrains Mono only where the content is genuinely a path.
                </li>
              </ul>
            </Notes>
          </section>

          <div className="mt-2 mb-4 max-w-[820px] border-l-2 border-studio-edge pl-3.5 font-sans text-sm leading-relaxed text-studio-ink-faint">
            <b className="font-mono text-2xs font-semibold uppercase tracking-[0.1em] text-studio-ink-muted">
              Lane rule
            </b>
            <p className="mt-1.5">
              The lanes are presentation, not product splits: identical broker reads, identical
              sections, identical routes — only the chrome and the identity layer differ. A lane is a
              setting, not a fork. The Everyday lane must never hide an approval or a question the
              Operator lane would surface; calm is a look, not a filter.
            </p>
          </div>
        </>
      ) : (
        <section className="mb-16 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
          <OperatorThumb />
          <Notes
            tag="Operator lane · reference only"
            title="The crown, unchanged"
            callouts={[
              { mark: "→", text: "Full study: /studies/crown-complications — variants T and B, live summon choreography, Fleet LED readout." },
            ]}
          >
            <p>
              The Operator lane is <b>not rebuilt here</b> — it already has a high-fidelity,
              interactive study. This thumbnail is a scale reference so the two lanes can be compared
              side by side: hex crown at bottom-center, four corner complications, connecting nav
              bar, dark machined console.
            </p>
            <p>
              The contrast is the deliverable: same fleet data, opposite instincts — ambient
              instrument vs. familiar app.
            </p>
          </Notes>
        </section>
      )}

      <p className="mt-2 border-t border-studio-edge pt-5 font-sans text-sm leading-relaxed text-studio-ink-faint">
        Content mirrors the shipped home (<code className="font-mono text-studio-ink-muted">apps/ios/Scout/HomeSurface.swift</code>:
        vitals · working · activity · ask) and the shipped surface list (
        <code className="font-mono text-studio-ink-muted">RootView.swift</code>). The Launch frame
        mirrors the New-composer defaults (most-recent harness/model/effort + project). Mock fleet
        data. Production app untouched; this is a persona-lane concept, not a reskin proposal for
        the operator build.
      </p>
    </main>
  );
}
