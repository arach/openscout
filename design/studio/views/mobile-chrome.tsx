"use client";

/**
 * Mobile Chrome — third-pass study of the Scout iOS app's top bar (masthead)
 * and bottom dock/tab bar chrome.
 *
 * Pass 1 (instrument masthead / mission strip / ticker slab / editorial
 * serif) and pass 2 (no-mast / slim / collapsible / full-reduction) were both
 * reviewed and dropped as lackluster — they rearranged or subtracted chrome
 * without making any of it more crafted. This pass keeps the layout settled
 * (masthead + dock + thin status strip) and instead gives each bar ONE
 * hero detail: a crafted object, an instrument behavior, or real depth.
 *
 * Three directions: KEYSTONE (the active tab is a physical key; identity
 * becomes an enamel jewel), DATUM (the dock becomes an instrument strip with
 * a sliding accent datum), FLOAT (both bars stop being slabs and become
 * floating objects over full-bleed content). The status strip is settled and
 * identical in every frame. Grounded in `apps/ios/Scout/RootView.swift`
 * (titleBar, dockedTabBar) and `StatusBar.swift`.
 *
 * The kit's <PhoneShell> is deliberately NOT used: the study varies exactly
 * the chrome it hardcodes. The kit's hand-drawn <Glyph> set IS reused.
 * Palette values are the exact warm tone from HudPalette.swift / Theme.swift.
 */

import type { ReactNode } from "react";
import { Glyph } from "@/components/scout-ios";
import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ────────────────────────────────────────────────────────────────────
   Scoped phone CSS — prefixed `.mc-`, rooted at `.mchrome`.
   ──────────────────────────────────────────────────────────────────── */

const MC_CSS = `
.mchrome{--bg:#0A0A0A;--chrome:#060606;--ink:#E5E5E5;--muted:#B8B8B8;--dim:#969696;
  --faint:#6b6b6b;--border:#272727;--hairline:#262626;
  --accent:#10B981;--teal:#0BC5A5;
  --canvas-top:#100E0B;--canvas-floor:#060504;
  --card-top:#211C19;--card-bottom:#171411;--card-edge:#433A30;
  --inset:#161310;--raised:#1C1915;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --ui:"Inter Tight","Inter",-apple-system,sans-serif}
.mchrome{font-family:var(--mono);line-height:1.6;-webkit-font-smoothing:antialiased}

/* Phone frame (393pt canvas, scaled) */
.mc-framebox{width:300px;height:650px;position:relative;flex:none}
.mc-phone{width:393px;height:852px;transform:scale(.763);transform-origin:top left;
  border-radius:46px;overflow:hidden;position:relative;
  outline:1px solid #2c2c2c;outline-offset:6px;
  background:linear-gradient(180deg,var(--canvas-top) 0%,var(--bg) 36%,var(--canvas-floor) 100%)}
.mc-phone::before{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(360px 260px at 50% 0%,rgba(255,240,219,.055),transparent 70%)}

/* Masthead */
.mc-mast{padding:14px 24px 0;position:relative}
.mc-mast-row{display:flex;align-items:center;gap:10px}
.mc-wordmark{font-family:var(--ui);font-weight:300;font-size:12.5px;letter-spacing:2.5px;white-space:nowrap;
  color:#49504f;text-shadow:0 .7px 0 rgba(0,0,0,.8),0 -0.5px 0 rgba(150,150,150,.2)}
.mc-mast-spacer{flex:1;display:flex;align-items:center;gap:6px;min-width:0}
.mc-gear{width:30px;height:30px;border-radius:50%;background:var(--inset);
  border:1px solid var(--hairline);display:flex;align-items:center;justify-content:center;color:var(--muted);flex:none}
.mc-hairline{height:1px;background:var(--hairline);margin-top:10px}

/* Host chip — the shipped plate */
.mc-chip{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:500;color:var(--muted);
  background:var(--inset);border:1px solid var(--hairline);border-radius:5px;padding:3px 9px;white-space:nowrap}
.mc-chip .mc-dot{width:5px;height:5px;border-radius:50%;background:var(--accent)}
.mc-chip.on{background:var(--raised);color:var(--ink);border-color:var(--dim)}
.mc-chip.off .mc-dot{background:var(--dim)}

/* Fake content so chrome has context */
.mc-content{padding:22px 24px;display:flex;flex-direction:column;gap:14px}
.mc-eyebrow{font-size:9px;letter-spacing:.16em;color:var(--faint);text-transform:uppercase}
.mc-fake-card{border-radius:8px;padding:14px;border:1px solid transparent;
  background:linear-gradient(180deg,var(--card-top),var(--card-bottom));
  border-image:linear-gradient(180deg,var(--card-edge),var(--border)) 1;
  box-shadow:0 3px 9px rgba(0,0,0,.33)}
.mc-fake-card .mc-t{font-size:11px;color:var(--ink);font-weight:500}
.mc-fake-card .mc-s{font-size:9px;color:var(--faint);margin-top:4px}
.mc-fake-row{display:flex;align-items:center;gap:8px;padding:10px 2px;border-bottom:1px solid #1a1a1a;font-size:10px;color:var(--muted)}
.mc-fake-row .mc-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);flex:none}
.mc-fake-row.dim .mc-dot{background:var(--faint)}

/* Tab bar — docked slab with lit lip (baseline) */
.mc-dock{position:absolute;left:0;right:0;bottom:0}
.mc-tabs{background:var(--bg);border-top:1.5px solid var(--card-edge);
  box-shadow:0 -6px 11px rgba(0,0,0,.6);display:flex;padding:6px 8px 0;position:relative}
.mc-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--muted);
  font-size:9px;font-weight:500;padding:6px 0 4px}
.mc-tab.on{color:var(--accent)}

/* KEYSTONE — the active tab is a physical key: raised plate, lit top edge,
   accent glyph, sitting proud of the slab. */
.mc-tab .mc-key{display:flex;flex-direction:column;align-items:center;gap:3px;
  padding:4px 10px;border-radius:7px;
  background:linear-gradient(180deg,var(--card-top),var(--card-bottom));
  box-shadow:inset 0 1px 0 var(--card-edge),0 2px 6px rgba(0,0,0,.45)}

/* DATUM — glyph-only instrument strip. The active tab alone speaks its
   label; a short accent datum on the lip marks position (ghost = the
   position it just slid from). */
.mc-tabs.datum .mc-tab{font-size:0;gap:0;padding:7px 0 6px}
.mc-tabs.datum .mc-tab.on{font-size:8.5px;gap:3px}
.mc-datum{position:absolute;top:-1px;width:24px;height:2px;transform:translateX(-50%);
  background:var(--accent);box-shadow:0 0 6px rgba(16,185,129,.5)}
.mc-datum.ghost{opacity:.16;box-shadow:none}

/* FLOAT — chrome as objects over full-bleed content. */
.mc-float-top{position:absolute;top:14px;left:16px;z-index:2;display:flex;align-items:center;gap:8px;
  background:linear-gradient(180deg,var(--card-top),var(--card-bottom));border-radius:9px;
  padding:6px 11px;font-size:10px;font-weight:500;color:var(--muted);
  box-shadow:inset 0 1px 0 var(--card-edge),0 6px 18px rgba(0,0,0,.5)}
.mc-float-top .mc-dot{width:5px;height:5px;border-radius:50%;background:var(--accent)}
.mc-vdiv{width:1px;height:12px;background:var(--hairline)}
.mc-occluder{position:absolute;left:0;right:0;bottom:0;height:150px;pointer-events:none;
  background:linear-gradient(180deg,rgba(6,5,4,0),rgba(6,5,4,.9) 60%,var(--canvas-floor))}
.mc-float-dock{position:absolute;left:50%;bottom:40px;transform:translateX(-50%);z-index:2}
.mc-float-tabs{display:flex;gap:1px;border-radius:12px;padding:6px;
  background:linear-gradient(180deg,#26211c,#171310);
  box-shadow:inset 0 1px 0 var(--card-edge),0 12px 28px rgba(0,0,0,.6)}
.mc-float-tabs .mc-tab{font-size:8px;padding:5px 8px;border-radius:8px;flex:none}

/* Status strip — SETTLED. Thin one-liner over the home-indicator zone. */
.mc-statusbar{background:var(--chrome);border-top:1px solid var(--hairline);
  display:flex;align-items:center;gap:10px;padding:6px 42px 14px;font-size:9px;font-weight:500;
  letter-spacing:.4px;color:var(--muted);min-height:30px}
.mc-statusbar .mc-grow{flex:1}
.mc-statusbar .mc-sep{color:var(--faint);font-weight:700}
.mc-statusbar .mc-accent{color:var(--accent)}
.mc-pulse{width:5px;height:5px;border-radius:50%;background:var(--accent);display:inline-block;
  vertical-align:1px;box-shadow:0 0 0 0 rgba(16,185,129,.5);animation:mc-p 2.4s infinite}
@keyframes mc-p{0%{box-shadow:0 0 0 0 rgba(16,185,129,.45)}70%{box-shadow:0 0 0 6px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
.mc-homeind{position:absolute;bottom:5px;left:50%;transform:translateX(-50%);width:120px;height:4px;border-radius:2px;background:#3a3a3a}

/* ────────────────────────────────────────────────────────────────────
   INSTRUMENT (Proposal A) — the chrome is milled from the same sheet as
   Home's signal panels: neutral graphite bezels over the warm canvas,
   L-bracket registration reticles, the panel datum line, chamfered
   readout cells. Tokens are the exact ScoutSignalSurface values from
   Theme.swift (top/bottom/edge/rule + neutralSignal).
   ──────────────────────────────────────────────────────────────────── */
.mchrome{--sig-top:#131516;--sig-bottom:#0B0D0E;--sig-edge:#3A3E3F;--sig-rule:#2A2E2F;--sig-neutral:#767C7D}

/* L-bracket registration mark (cf. SignalCornerMark) */
.mc-reticle{position:absolute;width:9px;height:9px;pointer-events:none;opacity:.82}
.mc-reticle.tl{border-top:1px solid var(--sig-neutral);border-left:1px solid var(--sig-neutral)}
.mc-reticle.tr{border-top:1px solid var(--sig-neutral);border-right:1px solid var(--sig-neutral)}
.mc-reticle.bl{border-bottom:1px solid var(--sig-neutral);border-left:1px solid var(--sig-neutral)}
.mc-reticle.br{border-bottom:1px solid var(--sig-neutral);border-right:1px solid var(--sig-neutral)}

/* Graphite masthead bezel — neutral even over the warm canvas, exactly the
   signal-panel rule. Single edge rule at the bottom, datum line at the lip. */
.mc-inst-mast{position:relative;padding:14px 22px 12px;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));border-bottom:1px solid var(--sig-edge)}
.mc-inst-mast>.mc-reticle.tl{top:7px;left:11px}
.mc-inst-mast>.mc-reticle.tr{top:7px;right:11px}
.mc-inst-mast-row{display:flex;align-items:center;gap:10px}
.mc-inst-datum{position:absolute;left:22px;bottom:-1px;width:30px;height:1px;background:var(--accent);
  box-shadow:0 0 5px rgba(16,185,129,.45)}

/* Chamfered readout cell (cf. SignalPanelShape, cut=6) — graphite fill, a 1px
   edge faked by a two-layer clip so the cut corners keep a crisp stroke. */
.mc-cell{position:relative;display:inline-flex;align-items:center;gap:6px;
  font-size:10px;font-weight:500;color:var(--muted);padding:4px 10px;background:var(--sig-edge);
  clip-path:polygon(5px 0,calc(100% - 5px) 0,100% 5px,100% calc(100% - 5px),calc(100% - 5px) 100%,5px 100%,0 calc(100% - 5px),0 5px)}
.mc-cell::before{content:"";position:absolute;inset:1px;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));
  clip-path:polygon(4px 0,calc(100% - 4px) 0,100% 4px,100% calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,0 calc(100% - 4px),0 4px)}
.mc-cell>*{position:relative;z-index:1}
.mc-cell .mc-dot{width:5px;height:5px;border-radius:50%;background:var(--accent)}
.mc-cell.on{color:var(--ink)}
.mc-cell.off .mc-dot{background:var(--dim)}

/* Content framed as a viewport under observation — warm canvas, inner reticles. */
.mc-inst-view{position:relative}
.mc-inst-view>.mc-reticle.tl{top:9px;left:14px}
.mc-inst-view>.mc-reticle.tr{top:9px;right:14px}

/* Instrument dock — graphite bezel, hairline top rule (not a lit lip),
   glyph-forward tabs (inactive glyph-only → shorter bar), sliding datum. */
.mc-inst-dock{position:relative;display:flex;padding:7px 8px 5px;
  background:linear-gradient(180deg,var(--sig-top),var(--sig-bottom));border-top:1px solid var(--sig-edge)}
.mc-inst-dock>.mc-reticle.bl{bottom:7px;left:12px}
.mc-inst-dock>.mc-reticle.br{bottom:7px;right:12px}
.mc-inst-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:0;color:var(--dim);
  font-size:0;font-weight:500;padding:5px 0 4px}
.mc-inst-tab.on{color:var(--accent);font-size:8px;gap:3px}
.mc-inst-mark{position:absolute;top:-1px;width:22px;height:2px;transform:translateX(-50%);
  background:var(--accent);box-shadow:0 0 6px rgba(16,185,129,.5)}

/* ────────────────────────────────────────────────────────────────────
   VIEWPORT (Proposal B) — no persistent brand mast. Identity shrinks to a
   fixed corner mark; the rest of the top band is page-contextual. Host
   filter is one cut cell. Shortened instrument dock. This is the operator's
   "maybe the top bar isn't needed" instinct, rendered without going naked.
   ──────────────────────────────────────────────────────────────────── */
.mc-vp-top{position:relative;display:flex;align-items:center;gap:10px;padding:14px 20px 10px}
.mc-vp-id{position:relative;display:flex;align-items:center;gap:7px;padding-left:12px}
.mc-vp-id>.mc-reticle.tl{top:-1px;left:0}
.mc-vp-mark{font-family:var(--ui);font-weight:300;font-size:11px;letter-spacing:2px;color:#5b615f;white-space:nowrap}
.mc-vp-ctx{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:10px;color:var(--muted);white-space:nowrap}
.mc-vp-ctx .mc-eyebrow{font-size:8.5px}
.mc-vp-ctx .mc-accent{color:var(--accent)}
.mc-vp-hair{height:1px;background:var(--sig-rule);margin:0 20px}

/* ────────────────────────────────────────────────────────────────────
   CROWN & COMPLICATIONS (Proposal C — operator direction) — mapped onto
   the real HudsonKit primitive (HudPhoneComplications, talkie-derived):
   topLeft = Deck, topRight = Settings, center = the hex crown. No
   wordmark anywhere. The reference renderer anchors 'center' at the
   bottom (talkie's FAB), so the crown is rendered notched into the
   dock's top edge; bottomLeft/bottomRight stay free slots. The fleet
   readout deliberately stays in the settled status strip instead of a
   top-center cell (dedup). Styles shown: .minimal (crown only) and
   .tray-adapted (full chrome, tab row kept per the operator).
   ──────────────────────────────────────────────────────────────────── */
.mc-comp-band{position:relative;display:flex;align-items:center;justify-content:space-between;
  padding:14px 20px 12px}
.mc-comp-band .mc-cell{font-size:9px;letter-spacing:.08em;text-transform:uppercase;gap:5px;padding:4px 9px}
.mc-dock-crown{position:absolute;left:50%;top:-22px;transform:translateX(-50%);z-index:3;
  width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(180deg,var(--card-top),var(--card-bottom));
  box-shadow:inset 0 1px 0 var(--card-edge),0 6px 14px rgba(0,0,0,.55)}
`;

/* ────────────────────────────────────────────────────────────────────
   Phone internals
   ──────────────────────────────────────────────────────────────────── */

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="mc-framebox">
      <div className="mc-phone">{children}</div>
    </div>
  );
}

/** The enamel identity jewel: gradient hex, dark core, one glint. */
function Jewel({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ flex: "none" }}>
      <polygon
        points="10,3.4 15.3,6.7 15.3,13.3 10,16.6 4.7,13.3 4.7,6.7"
        fill="url(#mc-jewel-grad)"
      />
      <polygon points="10,7 12.4,8.4 12.4,10.6 10,12 7.6,10.6 7.6,8.4" fill="rgba(5,9,8,.55)" />
      <circle cx="7.2" cy="5.4" r=".8" fill="#fff" opacity=".8" />
    </svg>
  );
}

function HostChip({ label, on, off }: { label: string; on?: boolean; off?: boolean }) {
  return (
    <span className={["mc-chip", on ? "on" : "", off ? "off" : ""].filter(Boolean).join(" ")}>
      <span className="mc-dot" />
      {label}
    </span>
  );
}

function HostChips() {
  return (
    <>
      <HostChip label="All" on />
      <HostChip label="arach-mbp" />
      <HostChip label="studio-mac" off />
    </>
  );
}

/** Masthead — etched wordmark (or jewel + wordmark), host plates, gear. */
function Masthead({ jewel }: { jewel?: boolean }) {
  return (
    <div className="mc-mast">
      <div className="mc-mast-row">
        {jewel && <Jewel size={17} />}
        <span className="mc-wordmark">SCOUT</span>
        <span className="mc-mast-spacer">
          <HostChips />
        </span>
        <span className="mc-gear">
          <Glyph kind="gear" size={16} />
        </span>
      </div>
      <div className="mc-hairline" />
    </div>
  );
}

const TABS: { kind: "home" | "agent" | "pulse" | "comms" | "terminal" | "plus"; label: string }[] = [
  { kind: "home", label: "Home" },
  { kind: "agent", label: "Agents" },
  { kind: "pulse", label: "Tail" },
  { kind: "comms", label: "Comms" },
  { kind: "terminal", label: "Term" },
  { kind: "plus", label: "New" },
];

/** Docked tab bar. `variant`: default slab · "key" (active = raised key) ·
 *  "datum" (glyph-only instrument strip + sliding datum). */
function Tabs({ variant }: { variant?: "key" | "datum" }) {
  const datum = variant === "datum";
  return (
    <div className={datum ? "mc-tabs datum" : "mc-tabs"}>
      {datum && (
        <>
          <i className="mc-datum" style={{ left: "8.333%" }} />
          <i className="mc-datum ghost" style={{ left: "25%" }} />
        </>
      )}
      {TABS.map((t, i) => {
        const on = i === 0;
        const inner = (
          <>
            <Glyph kind={t.kind} size={datum ? 15 : 16.5} />
            {t.label}
          </>
        );
        return (
          <span key={t.label} className={on ? "mc-tab on" : "mc-tab"}>
            {variant === "key" && on ? <span className="mc-key">{inner}</span> : inner}
          </span>
        );
      })}
    </div>
  );
}

/** SETTLED — thin one-liner over the home-indicator zone. Identical in
 *  every frame: LAN route, machine, FETCHED 12s, 6 agents, 3 active. */
function StatusStrip() {
  return (
    <div className="mc-statusbar">
      <span>
        <Glyph kind="signal" size={11} /> LAN
      </span>
      <span className="mc-sep">·</span>
      <span>
        <span className="mc-pulse" /> arach-mbp
      </span>
      <span className="mc-grow" />
      <span>FETCHED 12s</span>
      <span className="mc-sep">·</span>
      <span>6 agents</span>
      <span className="mc-sep">·</span>
      <span className="mc-accent">3 active</span>
    </div>
  );
}

/** Fake Home body so the chrome has context. `tall` adds rows so the Float
 *  frame can show content sliding under the occluder. */
function Content({ tall }: { tall?: boolean }) {
  const rows = [
    { t: "fix-auth-refresh — claude · running", dim: false },
    { t: "docs-sweep — codex · waiting", dim: false },
    { t: "nightly-rebase — claude · idle", dim: true },
    ...(tall
      ? [
          { t: "mesh-latency-probe — codex · running", dim: false },
          { t: "landing-refresh — claude · idle", dim: true },
          { t: "ios-profile-audit — gemini · waiting", dim: false },
        ]
      : []),
  ];
  return (
    <div className="mc-content">
      <span className="mc-eyebrow">Fleet</span>
      <div className="mc-fake-card">
        <div className="mc-t">6 agents · 3 active</div>
        <div className="mc-s">2 hosts online · last sync just now</div>
      </div>
      {rows.map((r) => (
        <div key={r.t} className={r.dim ? "mc-fake-row dim" : "mc-fake-row"}>
          <span className="mc-dot" />
          {r.t}
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   The frames
   ──────────────────────────────────────────────────────────────────── */

function BaselineFrame() {
  return (
    <Phone>
      <Masthead />
      <Content />
      <div className="mc-dock">
        <Tabs />
        <StatusStrip />
        <div className="mc-homeind" />
      </div>
    </Phone>
  );
}

function KeystoneFrame() {
  return (
    <Phone>
      <Masthead jewel />
      <Content />
      <div className="mc-dock">
        <Tabs variant="key" />
        <StatusStrip />
        <div className="mc-homeind" />
      </div>
    </Phone>
  );
}

function DatumFrame() {
  return (
    <Phone>
      <Masthead />
      <Content />
      <div className="mc-dock">
        <Tabs variant="datum" />
        <StatusStrip />
        <div className="mc-homeind" />
      </div>
    </Phone>
  );
}

function FloatFrame() {
  return (
    <Phone>
      <div className="mc-float-top">
        <Jewel size={14} />
        <span className="mc-dot" />
        arach-mbp
        <span className="mc-vdiv" />
        <Glyph kind="gear" size={13} />
      </div>
      <Content tall />
      <div className="mc-occluder" />
      <div className="mc-float-dock">
        <div className="mc-float-tabs">
          {TABS.map((t, i) => (
            <span key={t.label} className={i === 0 ? "mc-tab on" : "mc-tab"}>
              <Glyph kind={t.kind} size={15} />
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <div className="mc-dock">
        <StatusStrip />
        <div className="mc-homeind" />
      </div>
    </Phone>
  );
}

/** L-bracket registration mark — the signal panel's corner reticle. */
function Reticle({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  return <i className={`mc-reticle ${corner}`} />;
}

/** Chamfered graphite readout cell — the host chip re-cut in signal grammar. */
function CutCell({ label, on, off }: { label: string; on?: boolean; off?: boolean }) {
  return (
    <span className={["mc-cell", on ? "on" : "", off ? "off" : ""].filter(Boolean).join(" ")}>
      <span className="mc-dot" />
      {label}
    </span>
  );
}

/** Instrument dock — graphite bezel, corner reticles, sliding accent datum,
 *  glyph-forward tabs (inactive glyph-only → the bar loses height). Shared by
 *  both proposals. */
function InstrumentDock() {
  return (
    <div className="mc-inst-dock">
      <Reticle corner="bl" />
      <Reticle corner="br" />
      <i className="mc-inst-mark" style={{ left: "8.333%" }} />
      {TABS.map((t, i) => (
        <span key={t.label} className={i === 0 ? "mc-inst-tab on" : "mc-inst-tab"}>
          <Glyph kind={t.kind} size={15} />
          {t.label}
        </span>
      ))}
    </div>
  );
}

function InstrumentFrame() {
  return (
    <Phone>
      <div className="mc-inst-mast">
        <Reticle corner="tl" />
        <Reticle corner="tr" />
        <div className="mc-inst-mast-row">
          <span className="mc-wordmark">SCOUT</span>
          <span className="mc-mast-spacer">
            <CutCell label="All" on />
            <CutCell label="arach-mbp" />
            <CutCell label="studio-mac" off />
          </span>
          <span className="mc-gear">
            <Glyph kind="gear" size={16} />
          </span>
        </div>
        <i className="mc-inst-datum" />
      </div>
      <div className="mc-inst-view">
        <Reticle corner="tl" />
        <Reticle corner="tr" />
        <Content />
      </div>
      <div className="mc-dock">
        <InstrumentDock />
        <StatusStrip />
        <div className="mc-homeind" />
      </div>
    </Phone>
  );
}

function ViewportFrame() {
  return (
    <Phone>
      <div className="mc-vp-top">
        <span className="mc-vp-id">
          <Reticle corner="tl" />
          <span className="mc-vp-mark">SCOUT</span>
        </span>
        <span className="mc-vp-ctx">
          <span className="mc-eyebrow">Fleet</span>
          <CutCell label="arach-mbp" on />
          <span>
            <span className="mc-accent">3</span> active
          </span>
        </span>
      </div>
      <div className="mc-vp-hair" />
      <Content />
      <div className="mc-dock">
        <InstrumentDock />
        <StatusStrip />
        <div className="mc-homeind" />
      </div>
    </Phone>
  );
}

/** CROWN & COMPLICATIONS (Proposal C) — the operator's direction mapped
 *  onto HudPhoneComplications. minimal: the center crown is the only
 *  chrome Hudson renders (focus mode; tab row hidden). tray-adapted:
 *  topLeft = Deck, topRight = Settings attached to the top chrome; the
 *  center crown notched into the dock; the tab row kept per the operator. */
function CrownFrame({ state }: { state: "minimal" | "tray" }) {
  return (
    <Phone>
      {state === "tray" && (
        <div className="mc-comp-band">
          <span className="mc-cell">
            <Glyph kind="home" size={11} />
            <span>Deck</span>
          </span>
          <span className="mc-cell">
            <Glyph kind="gear" size={11} />
            <span>Settings</span>
          </span>
        </div>
      )}
      <Content />
      <div className="mc-dock">
        <span className="mc-dock-crown">
          <Jewel size={18} />
        </span>
        {state === "tray" && <InstrumentDock />}
        <StatusStrip />
        <div className="mc-homeind" />
      </div>
    </Phone>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Study row — frame + notes panel
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
  children: ReactNode;
  callouts: { mark: string; text: string }[];
}) {
  return (
    <div className="max-w-[430px] font-sans text-[12px] leading-relaxed text-studio-ink-muted">
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

function StudyRow({ frame, notes }: { frame: ReactNode; notes: ReactNode }) {
  return (
    <section className="mb-16 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
      {frame}
      {notes}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

const LEGEND: { color: string; label: string }[] = [
  { color: "#0A0A0A", label: "bg" },
  { color: "#060606", label: "chrome" },
  { color: "#161310", label: "inset (warm)" },
  { color: "#433A30", label: "lit lip" },
  { color: "#10B981", label: "accent emerald" },
  { color: "#B8B8B8", label: "ScoutInk.muted" },
];

export default function MobileChromeStudy() {
  return (
    <main className="mchrome mx-auto max-w-page px-7 py-8">
      <style>{MC_CSS}</style>

      {/* shared gradient for the identity jewel */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <linearGradient id="mc-jewel-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3ddc97" />
            <stop offset="1" stopColor="#0BC5A5" />
          </linearGradient>
        </defs>
      </svg>

      <header className="mb-10 max-w-prose">
        <EyebrowLabel size="sm">· studies · ios · chrome</EyebrowLabel>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Scout iOS · Mobile Chrome
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Third pass. The earlier passes rearranged and subtracted chrome; none of it looked{" "}
          <em>better</em>. This pass keeps the layout settled and instead gives each bar{" "}
          <b className="font-semibold text-studio-ink">one hero detail</b> — a crafted object
          (Keystone), an instrument behavior (Datum), or real depth (Float). Every frame keeps the
          settled status strip and shows Home with 2 paired hosts. Grounded in{" "}
          <b className="font-semibold text-studio-ink">apps/ios/Scout/RootView.swift</b> and{" "}
          <b className="font-semibold text-studio-ink">StatusBar.swift</b>.
        </p>
      </header>

      {/* settled */}
      <div
        className="mb-10 flex max-w-[820px] items-baseline gap-2 border border-studio-edge py-2.5 pl-3.5 pr-3.5 text-[11px] text-studio-ink-faint"
        style={{ borderLeft: "2px solid var(--scout-accent)" }}
      >
        <b className="flex-none font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-studio-ink-muted">
          Settled
        </b>
        <span>
          Status strip stays a thin one-liner at the bottom — layout untouched. Its content pass
          already shipped: relative-age FETCHED that counts up live, no yellow warn tint (fresh
          muted → dim only after a real stall).
        </span>
      </div>

      {/* legend */}
      <div className="mb-12 flex max-w-[820px] flex-wrap items-center gap-x-5 gap-y-1.5 border-y border-studio-edge py-2.5 font-mono text-[10px] text-studio-ink-faint">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center">
            <span
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] align-[-1px] outline outline-1 outline-studio-edge-strong"
              style={{ background: l.color }}
            />
            {l.label}
          </span>
        ))}
        <span>type: Inter Tight (wordmark) · JetBrains Mono (readouts)</span>
      </div>

      {/* ═══════════ BASELINE ═══════════ */}
      <StudyRow
        frame={<BaselineFrame />}
        notes={
          <Notes
            tag="Baseline"
            title="As shipped today"
            callouts={[
              {
                mark: "—",
                text: "Nothing here is wrong — but nothing is anyone's favorite part of the app either.",
              },
            ]}
          >
            <p>
              Reference frame. Etched wordmark, host plates, circled gear, full-height dock with
              accent-colored active tab, settled status strip.
            </p>
            <p className="text-studio-ink-faint">
              The honest diagnosis after two passes: the chrome is competent and flat. Every
              element is the same weight, the same depth, the same temperature. What the surfaces
              have that the chrome doesn't is <em>one moment of craft</em> — Home has its signal
              panels and datum, the canvas has grain and key-light. The bars have nothing
              equivalent.
            </p>
          </Notes>
        }
      />

      {/* ═══════════ KEYSTONE ═══════════ */}
      <StudyRow
        frame={<KeystoneFrame />}
        notes={
          <Notes
            tag="Direction 1"
            title="Keystone"
            callouts={[
              { mark: "+", text: "Craft without restructuring — both bars keep their exact layout." },
              { mark: "−", text: "More pixels per element, not fewer; bets the problem was flatness, not size." },
            ]}
          >
            <p>
              Each bar gets one physical object. In the dock, the active tab is a{" "}
              <b>raised key</b> — a small plate with a lit top edge and its own shadow, accent
              glyph pressed into it; the other five tabs stay flat ink. In the masthead, identity
              becomes an <b>enamel jewel</b> — the scout hex rendered as a gradient-lit stone with
              a dark core and one glint — next to the existing letterpress wordmark.
            </p>
            <ul>
              <li>
                <b>The key does wayfinding the accent alone can't</b> — you can find the active
                tab in peripheral vision, and tab switches get a physical press/settle motion.
              </li>
              <li>
                The jewel gives the wordmark back its presence at 12.5pt without making it bigger
                — the eye reads the pair as one mark.
              </li>
              <li>Everything else — host plates, gear, hairline, strip — untouched.</li>
            </ul>
            <p className="text-studio-ink-faint">
              Risk: two new crafted objects is one too many if they compete. The jewel is small
              and static; the key is the one that moves. If either reads as decoration rather than
              state, cut it.
            </p>
          </Notes>
        }
      />

      {/* ═══════════ DATUM ═══════════ */}
      <StudyRow
        frame={<DatumFrame />}
        notes={
          <Notes
            tag="Direction 2"
            title="Datum"
            callouts={[
              { mark: "+", text: "The dock becomes an instrument — same grammar as Home's signal panels." },
              { mark: "−", text: "Glyph-only tabs need the motion prototype to judge; static mocks flatter it." },
            ]}
          >
            <p>
              The dock becomes an instrument strip. Tabs go <b>glyph-only</b>; the active tab
              alone speaks its label. Position is marked by a short <b>accent datum on the lit
              lip</b> — a needle, not a highlight — that slides with a spring when you switch.
              The ghost in the frame is the position it just left: the motion <em>is</em> the
              wayfinding.
            </p>
            <ul>
              <li>
                <b>Same grammar as Home's signal panels</b> — the datum line, the restraint, state
                carried by one small accent element instead of a full re-tint.
              </li>
              <li>
                Glyph-only buys back label width forever: six tabs stop negotiating truncation,
                and iPad's eight fit without the mini-scale dance.
              </li>
              <li>Masthead untouched — this direction spends its entire budget on the dock.</li>
            </ul>
            <p className="text-studio-ink-faint">
              Risk: learnability. The hand-drawn glyphs are distinctive but not self-naming; the
              active-tab label and the sliding datum have to carry recognition until muscle memory
              forms. This one lives or dies in the prototype, not the mock.
            </p>
          </Notes>
        }
      />

      {/* ═══════════ FLOAT ═══════════ */}
      <StudyRow
        frame={<FloatFrame />}
        notes={
          <Notes
            tag="Direction 3"
            title="Float"
            callouts={[
              { mark: "+", text: "Maximum canvas; chrome becomes two crafted objects instead of two slabs." },
              { mark: "−", text: "Occlusion discipline per surface; the biggest visual change of the three." },
            ]}
          >
            <p>
              Both bars stop being slabs. Content goes full-bleed; the chrome becomes{" "}
              <b>two floating objects</b> with real depth. Top-left: one compact plate — jewel,
              active host, gear — the whole "app layer" in a single glanceable object. Bottom: a{" "}
              <b>floating tab plate</b> over a gradient occluder, so content slides under and
              dissolves instead of hitting a hard edge. The status strip stays pinned thin at the
              bottom — settled, untouched.
            </p>
            <ul>
              <li>
                <b>The host filter becomes the host readout</b> — the plate shows where you are;
                switching hosts moves into the plate's tap target (a menu), not a chip row.
              </li>
              <li>
                Depth is earned by light: the plate casts, the occluder fades, the canvas grain
                keeps moving behind both.
              </li>
              <li>Multi-host filtering (the chip row's real job) needs a home — the plate menu.</li>
            </ul>
            <p className="text-studio-ink-faint">
              Risk: floating chrome over scrolling content is a per-surface contract — Terminal
              and Tail need their own occlusion rules, and the host filter demotion from a
              one-tap row to a menu is a real UX downgrade when you're flipping between Macs
              often. This is the direction to prototype second, not first.
            </p>
          </Notes>
        }
      />

      {/* divider — appended proposals */}
      <div className="mb-10 mt-2 flex max-w-[820px] items-baseline gap-2 border-t border-studio-edge pt-6">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-studio-ink-faint">
          Appended · session-mrv2layk-fy5de0
        </span>
      </div>
      <p className="mb-12 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
        The diagnosis under all three passes: the chrome has never spoken the app&apos;s own craft
        language. Home&apos;s panels are built from a real proprietary grammar —{" "}
        <b className="font-semibold text-studio-ink">SignalPanelShape</b> chamfered corners,{" "}
        <b className="font-semibold text-studio-ink">SignalCornerMark</b> registration reticles, the
        datum line, neutral graphite that stays neutral over the warm canvas. Keystone and Float
        invent <em>new</em> craft (jewelry, floating slabs); only Datum borrows the app&apos;s DNA.
        These two proposals don&apos;t add a hero detail — they mill the chrome from the same sheet as
        the panels.
      </p>

      {/* ═══════════ INSTRUMENT ═══════════ */}
      <StudyRow
        frame={<InstrumentFrame />}
        notes={
          <Notes
            tag="Proposal A · recommended"
            rec
            title="Instrument"
            callouts={[
              { mark: "+", text: "Zero new vocabulary — the chrome becomes the same manufactured part as Home." },
              { mark: "+", text: "Neutral graphite over warm canvas is already the signal-panel rule, not a new exception." },
              { mark: "−", text: "Registration reticles are a strong signature; overuse would turn technical into busy." },
            ]}
          >
            <p>
              Both bars stop being iOS chrome and become the <b>housing of one instrument</b>. The
              masthead and dock are neutral <b>graphite bezels</b> (ScoutSignalSurface tokens), each
              carrying a single hairline edge rule — no glowing lit lip. The four corners of the live
              area get the same <b>L-bracket registration marks</b> as the signal panels, so the
              content reads as a viewport under observation. The active tab is marked by the{" "}
              <b>panel datum</b> — the exact accent line from <code>signalPanel</code> — sliding on
              the dock&apos;s top rule.
            </p>
            <ul>
              <li>
                <b>Host chips become chamfered readout cells</b> — cut corners matching
                SignalPanelShape, graphite fill, so the filter row is instrumentation, not bubbly
                plates.
              </li>
              <li>
                Dock goes glyph-forward (inactive = glyph only), which <b>sheds the height</b> the
                operator flagged while the datum carries wayfinding.
              </li>
              <li>
                Nothing is invented: every element here already exists in Theme.swift. This is
                coherence, not decoration.
              </li>
            </ul>
            <p className="text-studio-ink-faint">
              This is the answer to &ldquo;rearranging isn&apos;t making it better&rdquo;: the bars
              look better because they finally <em>belong</em> to the app they frame.
            </p>
          </Notes>
        }
      />

      {/* ═══════════ VIEWPORT ═══════════ */}
      <StudyRow
        frame={<ViewportFrame />}
        notes={
          <Notes
            tag="Proposal B"
            title="Viewport"
            callouts={[
              { mark: "+", text: "Renders the operator's own instinct — no persistent mast, page-contextual top." },
              { mark: "+", text: "Reclaims a full band of vertical space for content." },
              { mark: "−", text: "Every surface must author its own top line; empty states need a defined fallback." },
            ]}
          >
            <p>
              Takes seriously &ldquo;maybe the top bar isn&apos;t needed &mdash; just page-level
              contextual stuff.&rdquo; The persistent brand mast is gone. Identity survives as a{" "}
              <b>single fixed corner mark</b> — one registration bracket + a small SCOUT — so the app
              is never faceless (pass 2&apos;s failure was going naked). The rest of the band is{" "}
              <b>owned by the surface</b>: Home shows its fleet count and active tally as a datum
              readout; Agents would show a filter, Terminal the host.
            </p>
            <ul>
              <li>
                <b>The host filter keeps a one-tap home</b> — a single chamfered cell inline in the
                context line, so multi-Mac switching never gets demoted to a buried menu (Float&apos;s
                mistake).
              </li>
              <li>Bottom is the same shortened instrument dock — one coherent bezel language.</li>
              <li>
                The top costs one thin line instead of a full masthead + hairline; the canvas breathes
                a band taller.
              </li>
            </ul>
            <p className="text-studio-ink-faint">
              Pairs with Instrument rather than competing: A fixes what the chrome is <em>made of</em>;
              B decides how much of the top the app keeps. Ship A&apos;s bezel language first, then
              decide B per-surface.
            </p>
          </Notes>
        }
      />

      {/* ═══════════ CROWN & COMPLICATIONS ═══════════ */}
      <div className="mb-10 mt-2 flex max-w-[820px] items-baseline gap-2 border-t border-studio-edge pt-6">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-studio-ink-faint">
          Operator direction · pass 4
        </span>
      </div>
      <StudyRow
        frame={
          <div className="flex flex-wrap gap-6">
            <CrownFrame state="minimal" />
            <CrownFrame state="tray" />
          </div>
        }
        notes={
          <Notes
            tag="Proposal C · operator direction"
            rec
            title="Crown & Complications"
            callouts={[
              { mark: "+", text: "The primitive already exists in HudsonKit — Scout's RootView already uses HudPhoneAppShell, so the port is .hudComplications per surface, not new chrome." },
              { mark: "+", text: "The whole brand is one hex — no wordmark, no mast, nothing to make smaller ever again." },
              { mark: "−", text: "Center anchors bottom in the reference renderer — a top-anchored crown would need a renderer variant." },
            ]}
          >
            <p>
              The operator&apos;s direction, aligned to the reference implementation:{" "}
              <code>HudPhoneComplications</code> (
              <code>hudson/…/HudsonUI/Primitives/HudPhoneComplications.swift</code>, talkie-derived;
              talkie&apos;s hand-rolled original lives in{" "}
              <code>talkie/…/Views/Next</code>). Five slots, pages publish via{" "}
              <code>.hudComplications(_:)</code>, the shell renders via a swappable style. Mapping:{" "}
              <b>topLeft = Deck</b> (home glyph), <b>topRight = Settings</b>,{" "}
              <b>center = the scout hex crown</b> — identity is the hex alone, no wordmark.
            </p>
            <ul>
              <li>
                <b>Left frame: .minimal</b> — center-only render style (Hudson&apos;s focus mode).
                The crown is the entire chrome; tab row hidden, status strip stays.
              </li>
              <li>
                <b>Right frame: .tray-adapted</b> — the reference renderer anchors{" "}
                <code>center</code> at the bottom (talkie&apos;s FAB), so the crown is rendered{" "}
                <b>notched into the dock</b> rather than top-center; the whole tab row stays per
                the operator. bottomLeft/bottomRight remain free slots (New / Terminal are the
                candidates).
              </li>
              <li>
                <b>No top-center fleet cell</b> — the fleet readout already lives in the settled
                status strip; duplicating it up top was the one weak spot of the first sketch.
              </li>
            </ul>
            <p className="text-studio-ink-faint">
              Port path when this lands: RootView.swift already wraps every surface in{" "}
              <code>HudPhoneAppShell</code>, which reads the complications preference — each surface
              publishes its slots, the shell picks the style (<code>.tray</code> /{" "}
              <code>.scattered</code> / <code>.minimal</code>). Slots carry icon, role, optional
              label, a secondary chip, and long-press modes. A top-anchored crown (the
              operator&apos;s original sketch) is one renderer variant away if the bottom notch
              reads wrong on device.
            </p>
          </Notes>
        }
      />

      <p className="mt-2 border-t border-studio-edge pt-5 font-sans text-[11px] leading-relaxed text-studio-ink-faint">
        Static study only — no production code changed. Mock type/glyphs are approximations of
        Glyphs.swift and HudFont; palette values are exact from HudPalette.swift / Theme.swift
        (warm tone). Pass 1 (instrument masthead / mission strip / ticker slab / editorial serif)
        and pass 2 (no-mast / slim / collapsible / full-reduction) were reviewed and dropped; the
        pass-2 static original remains at{" "}
        <code className="font-mono text-studio-ink-muted">design/mobile-chrome-study/index.html</code>.
      </p>
    </main>
  );
}
