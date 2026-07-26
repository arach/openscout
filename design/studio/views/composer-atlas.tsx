"use client";

/**
 * Composer Atlas — every message-input composer treatment in the project,
 * consolidated into one reference page.
 *
 * ONE canonical grammar — TO / BODY / BAR — and one canonical action row,
 * ported from `apps/ios/Scout/ComposerKit.swift`:
 *
 *   [+]  ······················  [model token]  [mic]  [ send ]
 *
 * Every surface in the atlas is judged against that row. Sections:
 *
 *   01 CANONICAL   the grammar, in situ, with the rules that make it canon
 *   02 iOS         the five studio treatments (launch, home, concierge,
 *                  new-session, conversation-steer)
 *   03 macOS       the .composerBox idiom and its variants, plus the HUD
 *   04 WEB         the shared atom, its production twin, and the wrapper
 *   05 SPECIAL     fleet deck, steering loop, PR assign, rail actions,
 *                  observability, channels
 *   06 MATRIX      the whole atlas as one comparison table
 *   07 OBSERVATIONS  what the inventory actually shows
 *
 * Documentation page, not an app mock: framed specimen boxes with mono
 * labels. One phone shell (section 01) carries the canonical bar in situ;
 * everything else is a sketch. No screenshots.
 */

import { Fragment, type ReactNode } from "react";
import { MessageComposer, MessageComposerSelect, } from "@/components/MessageComposer";
import { DeviceShell } from "@/components/DeviceShell";

const CSS = `
.castage{ --paper:#F4F1EC; --paper-hi:#FCFBF8; --sheet:#FFFFFF; --ink:#191714; --ink2:#4E4941; --ink3:#8C867C; --ink4:#B6B0A6; --hair:rgba(40,34,26,.11); --fill:rgba(60,52,40,.055); --fill2:rgba(60,52,40,.09); --accent:#0B8A5F; --accent-deep:#076B4A; --accent-soft:rgba(11,138,95,.10); --ui:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Inter Tight",system-ui,sans-serif; --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace; min-height:100vh; width:100%; background: radial-gradient(120% 80% at 22% -6%, #FDFCFA 0%, rgba(253,252,250,0) 62%), radial-gradient(90% 70% at 96% 104%, #E4DFD6 0%, rgba(228,223,214,0) 60%), linear-gradient(178deg,#F3F0EA 0%,#EDE9E1 100%); font-family:var(--ui); color:var(--ink); -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; padding:50px 56px 80px; }
.castage :where(button){background:none;border:0;padding:0;font:inherit;color:inherit; cursor:default;text-align:inherit}
.ca-wrap{max-width:1360px;margin:0 auto}

/* ── page masthead ───────────────────────────────────────────────── */
.ca-eyebrow{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:.16em; text-transform:uppercase;color:var(--ink3)}
.ca-head h1{margin:9px 0 0;font-size:37px;font-weight:600;letter-spacing:-.028em; line-height:1.03;color:var(--ink)}
.ca-head p{margin:11px 0 0;max-width:720px;font-size:14.5px;line-height:1.55;color:var(--ink2)}
.ca-head p b{font-weight:600;color:var(--ink)}
.ca-head code,.ca-secdesc code,.ca-note code{font-family:var(--mono);font-size:.86em; color:var(--ink2)}

/* ── section bands ───────────────────────────────────────────────── */
.ca-sec{margin-top:58px;padding-top:18px;border-top:.5px solid rgba(40,34,26,.18)}
.ca-sechead{display:flex;align-items:baseline;gap:14px}
.ca-secnum{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.14em; color:var(--ink4)}
.ca-sechead h2{margin:0;font-size:22px;font-weight:600;letter-spacing:-.02em;color:var(--ink)}
.ca-secdesc{margin:9px 0 0;max-width:780px;font-size:13px;line-height:1.6;color:var(--ink2)}
.ca-secdesc b{font-weight:600;color:var(--ink)}

/* ── specimen cards ──────────────────────────────────────────────── */
.ca-grid{margin-top:24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(370px,1fr)); gap:22px;align-items:stretch}
.ca-card{background:var(--sheet);border-radius:16px;padding:14px 16px 15px; box-shadow:0 0 0 .5px rgba(40,34,26,.08), 0 2px 6px rgba(40,34,26,.05), 0 18px 34px -22px rgba(40,34,26,.28); display:flex;flex-direction:column}
.ca-cardhead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.ca-cardhead h3{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em}
.ca-param{font-family:var(--mono);font-size:9.5px;font-weight:500;color:var(--accent-deep); background:var(--accent-soft);border-radius:6px;padding:2px 6px;white-space:nowrap}
.ca-file{margin-top:5px;font-family:var(--mono);font-size:9.5px;letter-spacing:-.01em; color:var(--ink4);word-break:break-all;line-height:1.5}
.ca-spec{margin-top:12px;border-radius:12px;background:var(--paper);padding:12px; box-shadow:inset 0 0 0 .5px var(--hair);display:flex;flex-direction:column;gap:10px}
.ca-note{margin-top:11px;font-size:11.5px;line-height:1.55;color:var(--ink2)}
.ca-note b{font-weight:600;color:var(--ink)}

/* ── composer sketch primitives ──────────────────────────────────── */
.ca-well{background:var(--sheet);border-radius:12px;overflow:hidden; box-shadow:inset 0 0 0 .5px var(--hair);display:flex;flex-direction:column}
.ca-wellhead{display:flex;align-items:center;gap:7px;padding:7px 10px; border-bottom:.5px solid var(--hair);background:rgba(60,52,40,.03); font-family:var(--mono);font-size:9.5px;color:var(--ink3)}
.ca-field{padding:11px 12px 9px;font-size:13px;letter-spacing:-.01em;color:var(--ink4)}
.ca-field.typed{color:var(--ink)}
.ca-field.sm{padding:8px 10px 7px;font-size:11.5px}
.ca-row{display:flex;align-items:center;gap:7px;padding:8px 10px; border-top:.5px solid var(--hair)}
.ca-row.flush{border-top:0}
.ca-spacer{flex:1}
.ca-attach{width:26px;height:26px;border-radius:50%;background:var(--fill2); color:var(--ink3);box-shadow:inset 0 0 0 .5px rgba(40,34,26,.14); display:flex;align-items:center;justify-content:center;flex:none}
.ca-mic{width:30px;height:30px;border-radius:50%;background:var(--fill2); color:var(--ink2);box-shadow:inset 0 0 0 .5px rgba(40,34,26,.14); display:flex;align-items:center;justify-content:center;flex:none}
.ca-mic.voice{width:auto;height:30px;padding:0 12px;border-radius:999px;gap:6px; color:var(--accent-deep);background:var(--accent-soft); box-shadow:inset 0 0 0 1px rgba(11,138,95,.30)}
.ca-send{width:28px;height:28px;border-radius:50%;flex:none;color:#fff; background:linear-gradient(180deg,#0F9668 0%,var(--accent) 58%,var(--accent-deep) 100%); box-shadow:0 1px 2px rgba(6,58,40,.26), inset 0 .5px 0 rgba(255,255,255,.26); display:flex;align-items:center;justify-content:center}
.ca-send.dim{opacity:.35}
.ca-send.big{width:44px;height:44px}
.ca-send.ink{background:var(--ink);box-shadow:none}
.ca-sendtext{flex:none;font-size:12.5px;font-weight:600;color:var(--accent-deep); padding:5px 10px;border-radius:8px}
.ca-sendtext.ink{color:var(--ink2)}
.ca-token{height:26px;padding:0 8px 0 10px;border-radius:9px;background:var(--sheet); border:1.5px solid rgba(25,23,20,.86);flex:none;display:flex;align-items:center;gap:5px; font-size:11.5px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.ca-token em{font-style:normal;font-size:10px;font-weight:500;color:var(--ink3)}
.ca-token .cacv{color:var(--ink3);display:flex}
.ca-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px; border-radius:8px;background:var(--fill);box-shadow:inset 0 0 0 .5px var(--hair); font-size:11px;font-weight:500;color:var(--ink2);white-space:nowrap}
.ca-chip.mono{font-family:var(--mono);font-size:10px}
.ca-chip.on{background:var(--accent-soft);box-shadow:inset 0 0 0 1px rgba(11,138,95,.34); color:var(--accent-deep)}
.ca-chip .x{color:var(--ink4);font-size:11px;line-height:1}
.ca-select{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 9px; border-radius:999px;background:rgba(25,23,20,.07);font-family:var(--mono); font-size:10px;font-weight:500;color:var(--ink2);white-space:nowrap}
.ca-hint{padding:5px 10px 6px;border-top:.5px solid var(--hair);font-size:10.5px; color:var(--ink3)}
.ca-hint kbd{font-family:var(--mono);font-size:9px;background:var(--fill); border-radius:4px;padding:1px 4px;box-shadow:inset 0 0 0 .5px var(--hair)}
.ca-wave{display:flex;align-items:center;gap:2px;height:16px;padding:0 12px 8px}
.ca-wave i{flex:1;max-width:3px;border-radius:2px;background:var(--accent);opacity:.55}
.ca-chips{display:flex;gap:6px;flex-wrap:wrap}
.ca-tag{font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.1em; text-transform:uppercase;color:var(--ink4)}
.ca-link{color:var(--accent-deep);font-weight:600;text-decoration:none; border-bottom:.5px solid rgba(7,107,74,.4)}

/* ── phone shell (canonical, in situ) — the shared <DeviceShell> draws
     bezel, island and status bar; only the cropped screen's paper stays
     local (screenHeight=560: a deliberate specimen crop, not full height) ── */
.ca-canon{margin-top:26px;display:flex;align-items:flex-start;gap:48px;flex-wrap:wrap}
.ca-screen{background:var(--paper)}
.ca-wall{position:absolute;inset:0; background: radial-gradient(78% 46% at 14% 2%, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 66%), radial-gradient(90% 50% at 50% 100%, rgba(206,198,184,.45) 0%, rgba(206,198,184,0) 66%)}
.ca-pctx{position:absolute;top:74px;left:0;right:0;padding:0 22px;display:flex; align-items:center;gap:7px;font-size:14.5px;letter-spacing:-.012em;color:var(--ink2)}
.ca-pctx b{font-weight:600;color:var(--ink)}
.ca-livedot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--accent); box-shadow:0 0 0 3.5px var(--accent-soft)}
.ca-psheet{position:absolute;left:0;right:0;bottom:0;background:var(--sheet); border-radius:24px 24px 0 0;padding:12px 18px 20px; box-shadow:0 -.5px 0 rgba(40,34,26,.09), 0 -16px 32px -18px rgba(40,34,26,.30)}
.ca-grab{width:36px;height:5px;border-radius:2.5px;background:rgba(40,34,26,.14); margin:0 auto 12px}
.ca-pfield{display:flex;padding:10px 0 0;min-height:120px}
.ca-caret{width:2px;height:25px;border-radius:1px;background:var(--accent); margin-top:1px;flex:none}
.ca-pph{margin-left:9px;font-size:23px;font-weight:600;letter-spacing:-.03em; line-height:1.18;color:#C8C2B8}
.ca-pbar{display:flex;align-items:center;gap:8px;padding-top:10px}
.ca-pattach{width:30px;height:30px;border-radius:50%;background:rgba(60,52,40,.075); color:var(--ink3);box-shadow:inset 0 0 0 .5px rgba(40,34,26,.14); display:flex;align-items:center;justify-content:center;flex:none}
.ca-ptoken{height:30px;padding:0 10px 0 12px;border-radius:9px;background:var(--sheet); border:1.5px solid rgba(25,23,20,.86);flex:none;display:flex;align-items:center;gap:5px; font-size:12.5px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.ca-ptoken em{font-style:normal;font-size:11px;font-weight:500;color:var(--ink3)}
.ca-ptoken .cacv{color:var(--ink3);display:flex}
.ca-pmic{width:36px;height:36px;border-radius:50%;background:rgba(60,52,40,.075); color:var(--ink2);box-shadow:inset 0 0 0 .5px rgba(40,34,26,.14); display:flex;align-items:center;justify-content:center;flex:none}
.ca-psend{width:32px;height:32px;border-radius:50%;flex:none;color:#fff; background:linear-gradient(180deg,#0F9668 0%,var(--accent) 58%,var(--accent-deep) 100%); box-shadow:0 1px 2px rgba(6,58,40,.26), inset 0 .5px 0 rgba(255,255,255,.26); display:flex;align-items:center;justify-content:center}
.ca-psend.dim{opacity:.35}

/* ── grammar diagram + rules ─────────────────────────────────────── */
.ca-rules{flex:1;min-width:380px;max-width:760px}
.ca-gram{display:flex;flex-direction:column;gap:8px}
.ca-gband{display:flex;gap:14px;align-items:flex-start;background:var(--sheet); border-radius:12px;box-shadow:inset 0 0 0 .5px var(--hair);padding:10px 14px}
.ca-glab{flex:none;width:46px;padding-top:1px;font-family:var(--mono);font-size:10px; font-weight:700;letter-spacing:.12em;color:var(--accent-deep)}
.ca-gbody{flex:1;font-size:12px;line-height:1.55;color:var(--ink2)}
.ca-gbody b{font-weight:600;color:var(--ink)}
.ca-rsec{margin-top:18px;padding-top:11px;border-top:.5px solid rgba(40,34,26,.16)}
.ca-rsec > h3{margin:0 0 8px;font-family:var(--mono);font-size:9.5px;font-weight:600; letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.ca-rrow{display:flex;align-items:baseline;gap:10px;padding:3px 0;font-size:11.5px; line-height:1.55;color:var(--ink2)}
.ca-rrow dt{flex:none;width:92px;font-size:11px;color:var(--ink3)}
.ca-rrow dd{margin:0;flex:1;min-width:0}
.ca-rrow dd b{font-weight:600;color:var(--ink)}

/* ── matrix ──────────────────────────────────────────────────────── */
.ca-matrixwrap{margin-top:24px;overflow-x:auto;background:var(--sheet);border-radius:14px; box-shadow:0 0 0 .5px rgba(40,34,26,.08), 0 2px 6px rgba(40,34,26,.05)}
.ca-matrix{border-collapse:collapse;width:100%;font-size:11px}
.ca-matrix th{font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.1em; text-transform:uppercase;color:var(--ink3);text-align:left;padding:10px 12px 8px; border-bottom:.5px solid rgba(40,34,26,.18);white-space:nowrap}
.ca-matrix td{padding:6.5px 12px;border-bottom:.5px solid rgba(40,34,26,.07); color:var(--ink2);vertical-align:top;line-height:1.45}
.ca-matrix tr:last-child td{border-bottom:0}
.ca-matrix td:first-child{font-weight:600;color:var(--ink);white-space:nowrap}
.ca-matrix td.ca-c{text-align:center}
.ca-yes{color:var(--accent-deep);font-weight:700}
.ca-grp td{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.12em; text-transform:uppercase;color:var(--ink4);background:rgba(60,52,40,.03);padding:5px 12px}

/* ── observations ────────────────────────────────────────────────── */
.ca-obs{margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:16px 44px; counter-reset:obs}
.ca-ob{position:relative;padding-left:36px;font-size:12.5px;line-height:1.6;color:var(--ink2)}
.ca-ob b{font-weight:600;color:var(--ink)}
.ca-ob::before{counter-increment:obs;content:counter(obs,decimal-leading-zero); position:absolute;left:0;top:2px;font-family:var(--mono);font-size:10px; font-weight:700;letter-spacing:.08em;color:var(--accent-deep)}
`;

/* ── filled, SF-style glyph vocabulary (ported from ios-launch-craft) ── */

type GlyphProps = { size?: number };

function GPlus({ size = 15 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden><path d="M12 3.9c.6 0 1.1.5 1.1 1.1v5.9H19a1.1 1.1 0 0 1 0 2.2h-5.9V19a1.1 1.1 0 0 1-2.2 0v-5.9H5a1.1 1.1 0 0 1 0-2.2h5.9V5c0-.6.5-1.1 1.1-1.1Z" /></svg>
  );
}

function GMic({ size = 16 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <rect x="8.9" y="2.1" width="6.2" height="11.6" rx="3.1" />
      <path d="M5.6 10.2a.95.95 0 0 1 1.9 0 4.5 4.5 0 0 0 9 0 .95.95 0 0 1 1.9 0 6.45 6.45 0 0 1-5.45 6.37V20h2.15a.95.95 0 0 1 0 1.9H8.9a.95.95 0 0 1 0-1.9h2.15v-3.43A6.45 6.45 0 0 1 5.6 10.2Z" />
    </svg>
  );
}

function GArrowUp({ size = 15 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden><path d="M12 4.2c.32 0 .62.13.84.36l5.9 5.9a1.18 1.18 0 0 1-1.67 1.67L13.18 8.03V19a1.18 1.18 0 0 1-2.36 0V8.03l-3.89 3.9a1.18 1.18 0 1 1-1.67-1.67l5.9-5.9c.22-.23.52-.36.84-.36Z" /></svg>
  );
}

function GChevronDown({ size = 10 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 8.5 12 15.5 19 8.5" /></svg>
  );
}

/* SF draws the paperclip as a stroke too */
function GClip({ size = 13 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m19 11.5-7.2 7.2a4.6 4.6 0 0 1-6.5-6.5l8.2-8.2a3.1 3.1 0 0 1 4.4 4.4l-8.2 8.2a1.55 1.55 0 0 1-2.2-2.2l7.2-7.2" /></svg>
  );
}

function GStop({ size = 11 }: GlyphProps) {
  return (<svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="3" /></svg>);
}

/* deterministic dictation waveform — fixed energy envelope, capture-safe */
const WAVE = [0.3, 0.55, 0.82, 0.45, 0.92, 0.6, 0.35, 0.72, 0.95, 0.5, 0.4, 0.78, 0.55, 0.3, 0.62, 0.86, 0.44, 0.28, 0.52, 0.7, 0.38, 0.58, 0.8, 0.34];

function Wave() {
  return (<div className="ca-wave" aria-hidden>{WAVE.map((h, i) => (<i key={i} style={{ height: `${Math.round(h * 100)}%` }} />))}</div>);
}

/* ── shared sketch primitives ─────────────────────────────────────── */

function SendBtn({ dim, big, ink }: { dim?: boolean; big?: boolean; ink?: boolean }) {
  return (
    <span className={`ca-send${dim ? " dim" : ""}${big ? " big" : ""}${ink ? " ink" : ""}`} role="img" aria-label={dim ? "Send (dimmed until submittable)" : "Send"}><GArrowUp size={big ? 19 : 13} /></span>
  );
}

function MicBtn() {
  return (<span className="ca-mic"><GMic size={13} /></span>);
}

function AttachBtn() {
  return (<span className="ca-attach"><GPlus size={12} /></span>);
}

function Token({ family, effort }: { family: string; effort: string }) {
  return (<span className="ca-token">{family}<em>{effort}</em><span className="cacv"><GChevronDown size={8} /></span></span>);
}

function Sel({ children }: { children: ReactNode }) {
  return (<span className="ca-select">{children}<GChevronDown size={7} /></span>);
}

/* one specimen card: surface label, file path, params, sketch, note */
function Spec({ title, params, file, note, children, }: { title: string; params?: string; file: string; note: ReactNode; children: ReactNode; }) {
  return (
    <div className="ca-card">
      <div className="ca-cardhead"><h3>{title}</h3>{params ? <span className="ca-param">{params}</span> : null}</div>
      <div className="ca-file">{file}</div>
      <div className="ca-spec">{children}</div>
      <div className="ca-note">{note}</div>
    </div>
  );
}

function SectionHead({ n, title, children, }: { n: string; title: string; children: ReactNode; }) {
  return (
    <>
      <div className="ca-sechead"><span className="ca-secnum">{n}</span><h2>{title}</h2></div>
      <p className="ca-secdesc">{children}</p>
    </>
  );
}

/* ── 01 · CANONICAL ──────────────────────────────────────────────── */

function CanonicalPhone() {
  return (
    <DeviceShell
      device="iphone"
      screenHeight={560}
      homeIndicator={false}
      screenClassName="ca-screen"
    >
      <div className="ca-wall" />
      <div className="ca-pctx"><span className="ca-livedot" /><span><b>3 agents working</b> · all clear</span></div>
      <div className="ca-psheet">
        <div className="ca-grab" />
        <div className="ca-pfield"><span className="ca-caret" /><span className="ca-pph">Describe the task…</span></div>
        <div className="ca-pbar">
          <span className="ca-pattach"><GPlus size={14} /></span>
          <span style={{ flex: 1 }} />
          <span className="ca-ptoken">Opus 5<em>Medium</em><span className="cacv"><GChevronDown size={9} /></span></span>
          <span className="ca-pmic"><GMic size={15} /></span>
          <span className="ca-psend dim"><GArrowUp size={15} /></span>
        </div>
      </div>
    </DeviceShell>
  );
}

function CanonicalSection() {
  return (
    <section className="ca-sec">
      <SectionHead n="01" title="Canonical — the grammar">
        One composer grammar for the whole system: <b>TO / BODY / BAR</b>. TO is the optional routing band (reply target, agent, session). BODY is the prompt, with attachments riding directly above the field. BAR is the action row — and its order is fixed: <b>+ attach · spacer · model token · mic · send</b>. Every specimen below is judged against this row.
      </SectionHead>
      <div className="ca-canon">
        <CanonicalPhone />
        <div className="ca-rules">
          <div className="ca-gram">
            <div className="ca-gband"><span className="ca-glab">TO</span><span className="ca-gbody"><b>Optional.</b> Reply target, <b>@agent</b>, <b>#project</b>,{" "}<b>session:</b>. A band above the body — never a control inside the action row.</span></div>
            <div className="ca-gband"><span className="ca-glab">BODY</span><span className="ca-gbody"><b>The prompt.</b> The caret is the focus state — no ring, no glow. Attachments ride directly above the field, inside the well.</span></div>
            <div className="ca-gband"><span className="ca-glab">BAR</span><span className="ca-gbody"><b>+ attach · spacer · model token · mic · send.</b> Dictation sits <b>immediately left of send</b>, always. Send carries the accent fill at all times, <b>dimmed until submittable</b> — it never pops gray→green a beat late.</span></div>
          </div>

          <div className="ca-rsec">
            <h3>Token grammar — the model capsule</h3>
            <dl className="ca-rrow"><dt>Type</dt><dd><b>family semibold + effort secondary + one caret</b> —{" "}<code>Opus 5</code> <code>Medium</code> ⌄. One caret per row, and it lives here.</dd></dl>
            <dl className="ca-rrow"><dt>Material</dt><dd><b>r9 bordered capsule</b> — paper fill,{" "}<b>dark hairline stroke (1.5px ink)</b>, never a gray fill. It is the one drawn control in the row, so it is drawn, not tinted.</dd></dl>
            <dl className="ca-rrow"><dt>Raises</dt><dd><code>ModelPickerPopover</code> — three numbered stops: harness → family → effort.</dd></dl>
          </div>

          <div className="ca-rsec">
            <h3>Sources</h3>
            <dl className="ca-rrow"><dt>Kit</dt><dd><code>apps/ios/Scout/ComposerKit.swift</code></dd></dl>
            <dl className="ca-rrow"><dt>Token</dt><dd><code>apps/ios/Scout/NewSessionSurface.swift</code> —{" "}<code>modelToken</code></dd></dl>
            <dl className="ca-rrow"><dt>Picker</dt><dd><code>apps/ios/Scout/ModelPickerPopover.swift</code></dd></dl>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 02 · iOS STUDIO TREATMENTS ──────────────────────────────────── */

function IosSection() {
  return (
    <section className="ca-sec">
      <SectionHead n="02" title="iOS studio treatments">
        Five studio surfaces, five answers to the same question: where does the pre-loaded configuration live? The action row is held nearly constant — placement is the variable.
      </SectionHead>
      <div className="ca-grid">
        <Spec
          title="ios-launch-craft — Sentence / Masthead / Manifest"
          params="?treatment=1|2|3"
          file="design/studio/views/ios-launch-craft.tsx"
          note={<>Three organizing principles for config — <b>prose</b> on the paper, a <b>masthead</b> above the sheet, or a single{" "}<b>route strip</b> at the sheet&apos;s head. The action row is the ComposerKit port, verbatim and constant across all three.</>}
        >
          <div className="ca-chips"><span className="ca-chip on">01 · prose</span><span className="ca-chip">02 · masthead</span><span className="ca-chip">03 · strip</span></div>
          <div className="ca-well">
            <div className="ca-field">Describe the task…</div>
            <div className="ca-row"><AttachBtn /><span className="ca-spacer" /><Token family="Opus 5" effort="Medium" /><MicBtn /><SendBtn dim /></div>
          </div>
        </Spec>

        <Spec
          title="ios-home-vanilla — expand-on-tap one-liner"
          params="?composer=open|closed"
          file="design/studio/views/ios-home-vanilla.tsx"
          note={<>Closed, it is a one-liner. Tapped, it expands and the{" "}<b>chips live inside the expanded composer</b>. No attach, no mic — the lightest grammar in the atlas.</>}
        >
          <div className="ca-well">
            <div className="ca-row flush"><div className="ca-field sm" style={{ padding: 0, border: 0 }}>Ask Scout anything…</div><span className="ca-spacer" /><SendBtn dim /></div>
          </div>
          <div className="ca-well">
            <div className="ca-field sm typed">restart the broker on studio-mac</div>
            <div className="ca-row"><div className="ca-chips"><span className="ca-chip mono">@fable</span><span className="ca-chip mono">#openscout</span><span className="ca-chip mono">opus 5</span></div><span className="ca-spacer" /><SendBtn /></div>
          </div>
        </Spec>

        <Spec
          title="ios-concierge — voice-first pill"
          params="?frame=chat"
          file="design/studio/views/ios-concierge.tsx"
          note={<>Voice-first: the mic is the primary input, pill-scale. Suggestion chips float above; <b>mutation gates land as chat artifacts, not chrome</b> — confirmations are messages, never modal UI.</>}
        >
          <div className="ca-chips"><span className="ca-chip">what&apos;s failing?</span><span className="ca-chip">summarize @fable</span><span className="ca-chip">hand off to codex</span></div>
          <div className="ca-well">
            <div className="ca-row flush"><span className="ca-mic voice"><GMic size={13} /><span style={{ fontSize: 11, fontWeight: 600 }}>Listening…</span></span><span className="ca-spacer" /><SendBtn /></div>
          </div>
        </Spec>

        <Spec
          title="scout-ios-new — SurfaceLab compose"
          file="design/studio/views/scout-ios-new.tsx"
          note={<>A vertical decision stack: <b>project card → harness/model menus → prompt with a floating mic → Start footer</b>. Config is a sequence of menus above the well, not a token inside it.</>}
        >
          <div className="ca-well">
            <div className="ca-row flush"><span className="ca-chip mono">~/dev/openscout</span><span className="ca-spacer" /><GChevronDown size={9} /></div>
            <div className="ca-row"><Sel>claude</Sel><Sel>opus 5</Sel><span className="ca-spacer" /></div>
            <div className="ca-field sm">Describe the task…</div>
            <div className="ca-row"><span className="ca-spacer" /><MicBtn /><span className="ca-sendtext">Start</span></div>
          </div>
        </Spec>

        <Spec
          title="scout-ios-conversation — the steer bar"
          file="design/studio/views/scout-ios-conversation.tsx"
          note={<>The steer composer is <b>pinned to the bottom and held constant across every transcript-density treatment</b> — the densities change what&apos;s above it, never the bar itself.</>}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="ca-chip" style={{ alignSelf: "flex-start", opacity: 0.45 }}>fable · running checks…</span>
            <span className="ca-chip" style={{ alignSelf: "flex-end", opacity: 0.7 }}>bump the timeout and retry</span>
          </div>
          <div className="ca-well">
            <div className="ca-row flush"><div className="ca-field sm" style={{ padding: 0 }}>Steer @fable…</div><span className="ca-spacer" /><MicBtn /><SendBtn dim /></div>
          </div>
        </Spec>
      </div>
    </section>
  );
}

/* ── 03 · macOS ──────────────────────────────────────────────────── */

function MacosSection() {
  return (
    <section className="ca-sec">
      <SectionHead n="03" title="macOS">
        The desktop idiom predates the kit: a boxed field with a hint bar and a text Send, mic parked in a toolbar cluster. The HUD runner is the one macOS surface that already speaks ComposerKit fluently.
      </SectionHead>
      <div className="ca-grid">
        <Spec
          title="scout-comms · scout-shell · scout-one-system — the .composerBox idiom"
          file="design/studio/views/scout-comms.tsx (+ scout-shell.tsx, scout-one-system.tsx) · shipped: apps/macos/Sources/Scout/ScoutRootView.swift"
          note={<>Field + hint bar (<code>Type / commands · @ agents · session:</code>) + <b>text Send button</b>. The shipped version adds the REPLYING-TO band, suggestion popover, inline dictation waveform, and a hairline toolbar: status left, paperclip · mic · send right.</>}
        >
          <div className="ca-well">
            <div className="ca-wellhead">replying to <span className="ca-chip mono">@fable · broker flaps<span className="x">✕</span></span></div>
            <div className="ca-field sm">Type a message…</div>
            <Wave />
            <div className="ca-hint">Type <kbd>/</kbd> commands · <kbd>@</kbd> agents · <kbd>session:</kbd> for sessions</div>
            <div className="ca-row"><span className="ca-tag">idle</span><span className="ca-spacer" /><span className="ca-attach"><GClip size={12} /></span><MicBtn /><span className="ca-sendtext ink">Send</span></div>
          </div>
        </Spec>

        <Spec
          title="scout-comms-threads — reply target + mini composer"
          params="?treatment=reply|thread"
          file="design/studio/views/scout-comms-threads.tsx"
          note={<>A <b>clearable reply-target chip</b> rides in the composer header; sub-threads get a <b>mini composer</b> of the same idiom at reduced density. TO as a chip, dismissed with one tap.</>}
        >
          <div className="ca-well">
            <div className="ca-wellhead"><span className="ca-chip mono on">↩ @fable · broker flaps<span className="x">✕</span></span></div>
            <div className="ca-field sm">Reply in thread…</div>
            <div className="ca-row"><span className="ca-spacer" /><span className="ca-sendtext ink">Send</span></div>
          </div>
          <div className="ca-well" style={{ width: "78%", alignSelf: "flex-end" }}>
            <div className="ca-row flush"><div className="ca-field sm" style={{ padding: 0 }}>mini · sub-thread…</div><span className="ca-spacer" /><span className="ca-sendtext ink">Send</span></div>
          </div>
        </Spec>

        <Spec
          title="scout-new-conversation — ScoutSessionComposer sheet"
          file="design/studio/views/scout-new-conversation.tsx"
          note={<>A <b>two-zone sheet</b>: targeting above (agent combobox + linked Harness/Model selects), body below. The footer carries{" "}<b>[Cancel] [⌘↵ guide] [mic] [send]</b>.</>}
        >
          <div className="ca-well">
            <div className="ca-row flush"><Sel>@fable</Sel><Sel>claude</Sel><Sel>opus 5</Sel></div>
            <div className="ca-field sm">What should this session do?</div>
            <div className="ca-row"><span className="ca-sendtext ink">Cancel</span><span className="ca-spacer" /><span className="ca-tag">⌘↵ to start</span><MicBtn /><SendBtn /></div>
          </div>
        </Spec>

        <Spec
          title="scout-macos-control — native field vs recessed ❯"
          file="design/studio/views/scout-macos-control.tsx"
          note={<>An A/B on the existing surface: the <b>shipped native text field</b> against a <b>recessed ❯ prompt proposal</b> — terminal muscle memory instead of a boxed well.</>}
        >
          <div className="ca-well">
            <div className="ca-row flush"><div className="ca-field sm" style={{ padding: 0 }}>Message…</div><span className="ca-spacer" /><span className="ca-sendtext ink">Send</span></div>
          </div>
          <div className="ca-well" style={{ background: "rgba(25,23,20,.05)" }}>
            <div className="ca-row flush"><span className="ca-tag" style={{ color: "var(--accent-deep)", fontSize: 12 }}>❯</span><div className="ca-field sm" style={{ padding: 0 }}>recessed prompt…</div></div>
          </div>
        </Spec>

        <Spec
          title="hud-redesign — shared atom in the Dock"
          file="design/studio/views/hud-redesign.tsx"
          note={<>The <b>shared web atom at density=compact</b>, living in a collapsible Dock. Place-default grammar:{" "}<code>@work</code> / <code>#project</code> tokens pre-fill the routing, not the body.</>}
        >
          <div className="ca-chips"><span className="ca-chip mono">@work</span><span className="ca-chip mono">#openscout</span></div>
          <div className="ca-well">
            <div className="ca-field sm">Quick dispatch…</div>
            <div className="ca-row"><span className="ca-attach"><GClip size={12} /></span><span className="ca-spacer" /><MicBtn /><SendBtn ink dim /></div>
          </div>
          <span className="ca-tag">dock · collapsible</span>
        </Spec>

        <Spec
          title="HUD runner — the shipped HUD composer"
          file="apps/macos/Sources/ScoutHUD/HUDRunnerComposerView.swift"
          note={<><b>editor → capture strip → toolbar.</b> Toolbar: [+ attach] [mic/voice capsule] ··· [runtime preset chip] [44pt circular send] — the biggest, most canonical send target on the desktop.</>}
        >
          <div className="ca-well">
            <div className="ca-field sm typed">tail scoutd and summarize the flaps</div>
            <div className="ca-row"><span className="ca-chip mono">shot-1.png ✕</span><span className="ca-chip mono">broker.ts ✕</span></div>
            <div className="ca-row"><AttachBtn /><span className="ca-mic voice"><GMic size={12} /></span><span className="ca-spacer" /><span className="ca-chip mono">opus · medium</span><SendBtn big /></div>
          </div>
        </Spec>
      </div>
    </section>
  );
}

/* ── 04 · WEB ────────────────────────────────────────────────────── */

function WebSection() {
  return (
    <section className="ca-sec">
      <SectionHead n="04" title="Web">
        The only place the composer is <b>shared code</b>{" "}rather than a per-surface port: one studio atom, one production twin, one chat wrapper. The atom&apos;s layout is the sandwich — header → textarea with speech-energy waveform → toolbar.
      </SectionHead>
      <div className="ca-grid">
        <Spec
          title="MessageComposer — the studio atom, live"
          file="design/studio/components/MessageComposer.tsx"
          note={<>Rendered here, not drawn: <b>header → textarea (dictation waveform from speech energy) → toolbar [attach] ··· [tools] [mic] [Send/Stop]</b>. Densities: <code>panel · thread · compact</code>. The toolbar keeps the kit&apos;s adjacency — tools, then mic, then send.</>}
        >
          <MessageComposer
            placeholder="Message @fable…"
            defaultValue="queue the retry once checks pass"
            showAttach
            density="panel"
            tools={<MessageComposerSelect label="Model" value="opus" onChange={() => {}} options={[{ value: "opus", label: "opus 5" }, { value: "sonnet", label: "sonnet 4.6" },]} />}
          />
        </Spec>

        <Spec
          title="Production twin + ConversationComposer wrapper"
          file="packages/web/client/components/MessageComposer/MessageComposer.tsx · packages/web/client/screens/chat/ConversationComposer.tsx"
          note={<>The twin ships in chat behind the wrapper: <b>slash + @ overlays</b>, a <b>queue-vs-steer secondaryAction</b> while the agent runs, <b>stop-mode</b> (send becomes a red stop), and send receipts. Same sandwich, more states.</>}
        >
          <div className="ca-well">
            <div className="ca-wellhead"><span className="ca-chip mono">/model</span><span className="ca-chip mono">@fable</span><span className="ca-tag">slash + @ overlays</span></div>
            <div className="ca-field sm typed">steer: bump the timeout first</div>
            <div className="ca-row"><span className="ca-attach"><GClip size={12} /></span><span className="ca-spacer" /><Sel>opus 5</Sel><MicBtn /><SendBtn ink /></div>
          </div>
          <div className="ca-well">
            <div className="ca-row flush"><span className="ca-tag">running · queue vs steer</span><span className="ca-spacer" /><span className="ca-chip">queue</span><span className="ca-send ink" style={{ background: "#B3402F" }}><GStop size={10} /></span></div>
          </div>
        </Spec>

        <Spec
          title="Atoms gallery — the variant panels"
          file="design/studio — /atoms/message-composer"
          note={<>The gallery carries <b>8 variant panels</b> of the atom — every density, dictation live, stop-mode, header states. Linked here,{" "}<b>deliberately not duplicated</b>:{" "}<a className="ca-link" href="/atoms/message-composer">/atoms/message-composer</a>.</>}
        >
          <div className="ca-chips"><span className="ca-chip">panel</span><span className="ca-chip">thread</span><span className="ca-chip">compact</span><span className="ca-chip">dictating</span><span className="ca-chip">stop-mode</span><span className="ca-chip">reply header</span><span className="ca-chip">tools</span><span className="ca-chip">disabled</span></div>
        </Spec>
      </div>
    </section>
  );
}

/* ── 05 · SPECIAL CONTEXTS ───────────────────────────────────────── */

function SpecialSection() {
  return (
    <section className="ca-sec">
      <SectionHead n="05" title="Special contexts">
        Six surfaces where the composer is answering a question beyond &ldquo;type and send&rdquo; — placement, gating, targeting, or observability is itself the study.
      </SectionHead>
      <div className="ca-grid">
        <Spec
          title="fleet-deck — placement is the study"
          file="design/studio/views/fleet-deck.tsx"
          note={<>One input, two scopes: a <b>deck-level universal composer</b> vs a{" "}<b>host-scoped</b> one. A target chip states the addressee; an{" "}<b>offline queue</b> holds sends until the host is reachable.</>}
        >
          <div className="ca-well">
            <div className="ca-row flush"><span className="ca-chip mono on">deck · any host</span><span className="ca-spacer" /><SendBtn dim /></div>
          </div>
          <div className="ca-well">
            <div className="ca-row flush"><span className="ca-chip mono">studio-mac</span><div className="ca-field sm" style={{ padding: 0 }}>Scoped dispatch…</div><span className="ca-spacer" /><SendBtn /></div>
          </div>
          <span className="ca-tag">2 queued · host offline</span>
        </Spec>

        <Spec
          title="scout-steering-loop — the DISPATCH sheet"
          file="design/studio/views/scout-steering-loop.tsx"
          note={<>Intent-first: mic and the accent send live <b>inside the well</b>, not in a toolbar. Below the well, a <b>routing preview</b> shows where the intent will land before it is sent.</>}
        >
          <div className="ca-well">
            <div className="ca-field sm">get the broker green again</div>
            <div className="ca-row"><span className="ca-spacer" /><MicBtn /><SendBtn /></div>
          </div>
          <span className="ca-tag">→ routes to @fable · #broker · running session</span>
        </Spec>

        <Spec
          title="pr-assign-review — atom + PR header"
          file="design/studio/views/pr-assign-review.tsx"
          note={<>The shared atom under a <b>PR header chip row</b>; harness · model · effort are <b>toolbar selects</b> in the atom&apos;s tools slot, not a separate form.</>}
        >
          <div className="ca-chips"><span className="ca-chip mono">#316</span><span className="ca-chip">auth refactor</span><span className="ca-chip mono">+412 −88</span></div>
          <div className="ca-well">
            <div className="ca-field sm">Review instructions…</div>
            <div className="ca-row"><span className="ca-attach"><GClip size={12} /></span><span className="ca-spacer" /><Sel>claude</Sel><Sel>opus 5</Sel><Sel>high</Sel><MicBtn /><SendBtn ink /></div>
          </div>
        </Spec>

        <Spec
          title="agents-rail-actions — New chat overlay"
          file="design/studio/views/agents-rail-actions.tsx"
          note={<>A rail action raises an overlay: <b>target chips → well → [Start ↵]</b>. Targeting is a chip choice made before the field ever gets focus.</>}
        >
          <div className="ca-chips"><span className="ca-chip mono on">@fable</span><span className="ca-chip mono">@codex</span><span className="ca-chip mono">+ new</span></div>
          <div className="ca-well">
            <div className="ca-field sm">Start a chat…</div>
            <div className="ca-row"><span className="ca-spacer" /><span className="ca-sendtext">Start ↵</span></div>
          </div>
        </Spec>

        <Spec
          title="work-observability — armed while observing?"
          file="design/studio/views/work-observability.tsx"
          note={<>The open critique: a composer that is <b>armed while you are only observing</b> invites accidental steers. The proposal is a{" "}<b>mode line</b> — observe by default, arm explicitly.</>}
        >
          <div className="ca-well">
            <div className="ca-row flush"><div className="ca-field sm" style={{ padding: 0 }}>armed · type to steer…</div><span className="ca-spacer" /><SendBtn /></div>
          </div>
          <div className="ca-well">
            <div className="ca-row flush"><span className="ca-tag">observing · press ⏎ to arm</span><span className="ca-spacer" /><SendBtn dim /></div>
          </div>
        </Spec>

        <Spec
          title="scout-comms-channels — flat single field"
          file="design/studio/views/scout-comms-channels.tsx"
          note={<>Channel context does the addressing, so the composer collapses to a <b>flat single field</b> — the <b>participant rail above</b>{" "}carries who is here, and there is nothing left for the bar to say.</>}
        >
          <div className="ca-chips"><span className="ca-chip mono">you</span><span className="ca-chip mono">@fable</span><span className="ca-chip mono">@codex</span><span className="ca-tag">#broker · 3 present</span></div>
          <div className="ca-well">
            <div className="ca-row flush"><div className="ca-field sm" style={{ padding: 0 }}>Message #broker…</div><span className="ca-spacer" /><SendBtn dim /></div>
          </div>
        </Spec>
      </div>
    </section>
  );
}

/* ── 06 · MATRIX ─────────────────────────────────────────────────── */

type MatrixRow = [string, string, string, string, string, string, string];

const MATRIX: Array<{ group: string; rows: MatrixRow[] }> = [
  { group: "Reference", rows: [
    ["ComposerKit (iOS canonical)", "token in action row", "✓", "outlined capsule", "left of send", "accent circle · dimmed", "the grammar itself"],
  ], },
  { group: "iOS studio", rows: [
    ["launch-craft 01 Sentence", "prose on paper", "✓", "in row", "✓", "accent circle", "config as stated prose"],
    ["launch-craft 02 Masthead", "masthead + row", "✓", "in row", "✓", "accent circle", "place = identity, engine = execution"],
    ["launch-craft 03 Manifest", "route strip", "✓", "in strip", "✓", "accent circle", "one line, one tap"],
    ["ios-home-vanilla", "chips in expanded well", "—", "chip", "—", "accent circle", "expand-on-tap one-liner"],
    ["ios-concierge", "chat artifacts", "—", "—", "voice-first pill", "accent circle", "gates as messages, not chrome"],
    ["scout-ios-new", "menus above prompt", "—", "menu", "floating", "Start footer", "vertical decision stack"],
    ["scout-ios-conversation", "—", "—", "—", "✓", "accent circle", "pinned steer bar, constant"],
  ], },
  { group: "macOS", rows: [
    ["scout-comms idiom", "hint bar", "popover", "—", "toolbar right", "text Send", ".composerBox + hint grammar"],
    ["scout-comms-threads", "reply chip", "—", "—", "—", "text Send", "clearable target chip"],
    ["scout-new-conversation", "selects zone", "—", "linked selects", "footer", "accent circle", "two-zone sheet"],
    ["scout-macos-control", "—", "—", "—", "—", "❯ / native", "recessed prompt proposal"],
    ["hud-redesign", "place-default tokens", "✓", "—", "✓", "ink circle", "atom compact in Dock"],
    ["HUDRunnerComposer", "preset chip", "✓", "preset chip", "voice capsule", "44pt accent circle", "editor → capture → toolbar"],
  ], },
  { group: "Web", rows: [
    ["MessageComposer (atom)", "toolbar tools slot", "✓", "tools slot", "toolbar right", "ink circle · stop-mode", "the shared atom"],
    ["twin + ConversationComposer", "overlays + tools", "✓", "tools slot", "toolbar right", "ink circle + secondary", "queue vs steer · receipts"],
  ], },
  { group: "Special contexts", rows: [
    ["fleet-deck", "target chip", "—", "—", "—", "accent circle", "placement itself is the study"],
    ["scout-steering-loop", "routing preview", "—", "—", "in well", "accent in well", "intent-first dispatch"],
    ["pr-assign-review", "toolbar selects", "✓", "selects", "✓", "ink circle", "atom + PR header chips"],
    ["agents-rail-actions", "target chips", "—", "—", "—", "Start ↵", "rail-action overlay"],
    ["work-observability", "mode line", "—", "—", "—", "—", "armed-while-observing debate"],
    ["scout-comms-channels", "participant rail", "—", "—", "—", "accent circle", "flat single field"],
  ], },
];

function MatrixSection() {
  return (
    <section className="ca-sec">
      <SectionHead n="06" title="Matrix">
        The whole atlas on one table. Cells are deliberately terse —{" "}<b>✓</b> present, <b>—</b> absent, a few words otherwise.
      </SectionHead>
      <div className="ca-matrixwrap">
        <table className="ca-matrix">
          <thead>
            <tr><th>Surface</th><th>Config placement</th><th>Attach</th><th>Model token</th><th>Mic</th><th>Send style</th><th>Distinct trait</th></tr>
          </thead>
          <tbody>
            {MATRIX.map((g) => (
              <Fragment key={g.group}>
                <tr className="ca-grp"><td colSpan={7}>{g.group}</td></tr>
                {g.rows.map((r) => (
                  <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td className="ca-c">{r[2] === "✓" ? <span className="ca-yes">✓</span> : r[2]}</td><td>{r[3]}</td><td className="ca-c">{r[4] === "✓" ? <span className="ca-yes">✓</span> : r[4]}</td><td>{r[5]}</td><td>{r[6]}</td></tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── 07 · OBSERVATIONS ───────────────────────────────────────────── */

function ObservationsSection() {
  return (
    <section className="ca-sec">
      <SectionHead n="07" title="Observations">
        What the inventory shows when every treatment is laid side by side.
      </SectionHead>
      <div className="ca-obs">
        <div className="ca-ob"><b>The action-row order has converged.</b> + · spacer · token · mic · send holds on every recent surface; the exceptions are the early web/macOS idioms, which still park mic and attach in a toolbar cluster.</div>
        <div className="ca-ob"><b>Config placement is the real open axis.</b> Prose (Sentence), masthead, route strip, chips in the well, selects in a toolbar — five live answers, no winner yet. Everything else has standardized.</div>
        <div className="ca-ob"><b>Mic-adjacent-to-send is canonical but not universal.</b> The iOS kit and launch treatments hold it; the web atom, the .composerBox idiom, and pr-assign-review keep mic one slot earlier in the toolbar.</div>
        <div className="ca-ob"><b>Two send materials ship in one system.</b> The iOS kit&apos;s always-accent-filled, dimmed-until-submittable circle versus the macOS idiom&apos;s text button and the web atom&apos;s ink circle. The HUD runner proves the accent circle works on desktop.</div>
        <div className="ca-ob"><b>Only one composer is shared code.</b> The studio atom and its web production twin are the single cross-surface implementation; every other treatment re-implements the grammar per surface — which is why the matrix drifts.</div>
        <div className="ca-ob"><b>The token is drawn wrong in half the sketches.</b> The reference is an outlined capsule — paper fill, dark hairline stroke, r9 — but several treatments still render the model as a filled gray chip.</div>
      </div>
    </section>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */

export default function ComposerAtlas() {
  return (
    <div className="castage">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ca-wrap">
        <header className="ca-head">
          <div className="ca-eyebrow">Scout design studio · reference atlas · composer</div>
          <h1>Composer Atlas</h1>
          <p>
            Every message-input composer treatment in the project, on one page, judged against one canonical grammar — <b>TO / BODY / BAR</b> — and one canonical action row from ComposerKit:{" "}<b>+ attach · spacer · model token · mic · send</b>. Specimens are sketches with mono labels, not screenshots; each card names its surface, its file, and its URL params.
          </p>
        </header>

        <CanonicalSection />
        <IosSection />
        <MacosSection />
        <WebSection />
        <SpecialSection />
        <MatrixSection />
        <ObservationsSection />
      </div>
    </div>
  );
}
