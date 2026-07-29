"use client";

/**
 * iOS Concierge · Everyday Lane — a conversational meta-interface study.
 *
 * Sibling study to /studies/ios-home-vanilla: same Everyday-lane grammar
 * (system grouped canvas, white rounded cards, one calm emerald accent),
 * asking what happens when the app gets a conversational interface over its
 * OWN functions and state. Not an agent orchestrator — a concierge.
 *
 * The concierge answers questions and performs bounded actions against the
 * app's data model via tool calls: "what's going on at studio-mac?" →
 * fetch_host_status(studio-mac) → plain-language summary → present.
 *
 * The rules made visible:
 *   · Reads are free — fetch/status/summarize run with no confirmation.
 *   · Mutations are gated — the concierge PROPOSES send/ask/approve, the
 *     user confirms. Approval gates and confirm-before-send are first-class
 *     chat artifacts, not dialogs.
 *   · Retrieval, not context-stuffing — every answer is grounded in a
 *     bounded tool query, shown as a subtle monospace tool row.
 *   · The tool surface is the durable asset; the model is swappable
 *     (BYOK → BYOC → mesh-local → on-device, the privacy ladder).
 *
 * URL params:
 *   ?frame=chat|entry|ladder   — show one frame only (default: all three)
 */

import { useMemo } from "react";
import {
  ArrowUp,
  AudioWaveform,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  KeyRound,
  Mic,
  Pencil,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { EyebrowLabel } from "@/components/EyebrowLabel";
import { DeviceShell } from "@/components/DeviceShell";

/* ────────────────────────────────────────────────────────────────────
   Scoped phone CSS — prefixed `.cg-`, rooted at `.cglane`.
   Same palette/grammar as the vanilla study (.vn-): grouped gray canvas,
   white cards, hairlines, one restrained emerald accent.
   ──────────────────────────────────────────────────────────────────── */

const CG_CSS = `
.cglane{--cg-bg:#F2F2F7;--cg-card:#FFFFFF;--cg-ink:#1C1C1E;--cg-sub:#8A8A8E;
  --cg-faint:#AEAEB2;--cg-hair:rgba(60,60,67,.12);--cg-fill:rgba(120,120,128,.12);
  --cg-accent:#0B8A5F;--cg-accent-soft:rgba(11,138,95,.10);
  --cg-green:#30B454;--cg-amber:#E8A13A;--cg-amber-soft:rgba(232,161,58,.14);
  --cg-ui:"Inter Tight","Inter",-apple-system,"SF Pro Text",sans-serif;
  --cg-mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace}
.cglane{font-family:var(--cg-ui);-webkit-font-smoothing:antialiased}

/* Phone frame — the shared <DeviceShell> (components/DeviceShell) draws the
   bezel, Dynamic Island, status bar and home indicator; only the screen's
   canvas color stays local. Presented at ~.87 scale. */
.cg-screen{background:var(--cg-bg)}

/* Sheet-style nav header (the concierge is presented, not tabbed) */
.cg-nav{position:absolute;top:0;left:0;right:0;z-index:22;
  padding:56px 16px 8px;display:flex;align-items:center;gap:10px;
  background:linear-gradient(180deg,var(--cg-bg) 78%,rgba(242,242,247,0))}
.cg-nav .cg-grabber{position:absolute;top:8px;left:50%;transform:translateX(-50%);
  width:36px;height:5px;border-radius:2.5px;background:var(--cg-fill)}
.cg-navdismiss{width:30px;height:30px;border-radius:50%;flex:none;
  background:var(--cg-fill);color:var(--cg-sub);display:flex;align-items:center;
  justify-content:center}
.cg-navmain{flex:1;min-width:0;text-align:center}
.cg-navtitle{font-size: var(--text-2xl);font-weight:600;color:var(--cg-ink)}
.cg-navctx{margin-top:1px;font-size: var(--text-xs);color:var(--cg-faint)}
.cg-navctx b{font-weight:600;color:var(--cg-sub)}
.cg-navtalk{width:30px;height:30px;border-radius:50%;flex:none;
  background:var(--cg-accent-soft);color:var(--cg-accent);display:flex;
  align-items:center;justify-content:center}

/* Chat thread */
.cg-thread{position:absolute;inset:0;padding:104px 16px 90px;display:flex;
  flex-direction:column;gap:8px;overflow:hidden}

/* User bubble — right-aligned, calm accent tint */
.cg-user{align-self:flex-end;max-width:78%;background:var(--cg-accent-soft);
  color:var(--cg-ink);font-size: var(--text-lg);line-height:1.35;padding:9px 13px;
  border-radius:18px 18px 4px 18px}

/* Tool-call row — the grounding, deliberately quiet */
.cg-tool{display:flex;align-items:center;gap:7px;padding:0 2px;
  font-family:var(--cg-mono);font-size: var(--text-xs);color:var(--cg-faint)}
.cg-tool svg{flex:none;color:var(--cg-faint)}
.cg-tool .cg-tname{color:var(--cg-sub)}
.cg-tool .cg-tdur{margin-left:auto;font-variant-numeric:tabular-nums}
.cg-tool.gated .cg-tname{color:#B07A1E}
.cg-tool.gated svg{color:#B07A1E}
.cg-tool .cg-tflag{margin-left:auto;font-family:var(--cg-ui);font-size: var(--text-2xs);
  font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#B07A1E}

/* Concierge reply card */
.cg-reply{display:flex;gap:9px;align-self:stretch}
.cg-avatar{width:26px;height:26px;border-radius:50%;flex:none;margin-top:2px;
  background:var(--cg-accent);color:#fff;display:flex;align-items:center;
  justify-content:center}
.cg-rcard{flex:1;min-width:0;background:var(--cg-card);border-radius:4px 18px 18px 18px;
  padding:10px 13px;box-shadow:0 1px 2px rgba(0,0,0,.05);
  font-size: var(--text-lg);line-height:1.4;color:var(--cg-ink)}
.cg-rcard b{font-weight:600}
.cg-rcard .cg-attn{color:#B07A1E;font-weight:600}

/* Approval gate — a mutation proposal, visually distinct */
.cg-gate{align-self:stretch;background:var(--cg-card);border-radius:16px;
  box-shadow:0 1px 2px rgba(0,0,0,.05);overflow:hidden;
  border:1px solid rgba(232,161,58,.45)}
.cg-gatehead{display:flex;align-items:center;gap:6px;padding:9px 13px;
  background:var(--cg-amber-soft);
  font-size: var(--text-xs);font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  color:#B07A1E}
.cg-gatehead .cg-gfrom{margin-left:auto;font-weight:500;letter-spacing:0;
  text-transform:none;color:#B07A1E;opacity:.85}
.cg-gatebody{padding:10px 13px 11px}
.cg-gatelabel{font-size: var(--text-xs);font-weight:500;color:var(--cg-sub)}
.cg-gateact{margin-top:4px;display:flex;align-items:center;gap:8px}
.cg-gateact .cg-cmd{font-family:var(--cg-mono);font-size: var(--text-sm);
  color:var(--cg-ink);background:var(--cg-fill);border-radius:7px;padding:5px 8px}
.cg-gatenote{margin-top:7px;font-size: var(--text-sm);line-height:1.4;color:var(--cg-sub)}
.cg-gatebtns{display:flex;gap:8px;margin-top:9px}
.cg-btn{flex:1;height:32px;border-radius:16px;display:flex;align-items:center;
  justify-content:center;gap:5px;font-size: var(--text-lg);font-weight:600;cursor:pointer}
.cg-btn.primary{background:var(--cg-accent);color:#fff}
.cg-btn.ghost{background:var(--cg-fill);color:var(--cg-ink)}
.cg-btn.danger{background:transparent;border:1px solid var(--cg-hair);color:var(--cg-sub)}

/* Confirm-before-send card */
.cg-confirm{align-self:stretch;background:var(--cg-card);border-radius:16px;
  box-shadow:0 1px 2px rgba(0,0,0,.05);padding:10px 13px 11px;
  border:1px solid var(--cg-hair)}
.cg-confhead{display:flex;align-items:center;gap:6px;
  font-size: var(--text-xs);font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  color:var(--cg-sub)}
.cg-confhead .cg-cstate{margin-left:auto;font-weight:500;letter-spacing:0;
  text-transform:none;color:var(--cg-accent)}
.cg-bubble{margin-top:9px;background:var(--cg-bg);border-radius:12px;
  padding:9px 11px;font-size: var(--text-md);line-height:1.4;color:var(--cg-ink)}
.cg-bubble .cg-to{display:block;margin-bottom:2px;font-size: var(--text-xs);
  font-weight:600;color:var(--cg-accent)}

/* Composer — chat composer with mic */
.cg-composer{position:absolute;left:16px;right:16px;bottom:30px;z-index:21;
  display:flex;align-items:center;gap:8px;background:var(--cg-card);
  border-radius:24px;padding:6px 6px 6px 16px;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.cg-composer .cg-ph{flex:1;font-size: var(--text-xl);color:var(--cg-faint)}
.cg-cmic{width:32px;height:32px;border-radius:50%;flex:none;color:var(--cg-sub);
  display:flex;align-items:center;justify-content:center}
.cg-csend{width:32px;height:32px;border-radius:50%;flex:none;
  background:var(--cg-accent);color:#fff;display:flex;align-items:center;
  justify-content:center}

/* ── Entry frame: concierge sheet over the Launch frame ── */
.cg-launch{position:absolute;inset:0;padding:116px 20px 0;display:flex;
  flex-direction:column}
.cg-lhost{display:flex;align-items:center;gap:6px;font-size: var(--text-md);font-weight:600;
  letter-spacing:.07em;text-transform:uppercase;color:var(--cg-sub)}
.cg-lhost .cg-pdot{width:6px;height:6px;border-radius:50%;background:var(--cg-green)}
.cg-launch h1{margin:10px 0 0;font-size: var(--text-6xl);font-weight:700;letter-spacing:-.02em;
  color:var(--cg-ink)}
.cg-lfleet{margin-top:7px;font-size: var(--text-lg);color:var(--cg-sub)}
.cg-lfleet b{font-weight:600;color:var(--cg-accent)}
.cg-lpre{margin-top:30px;border-top:.5px solid var(--cg-hair)}
.cg-lprow{display:flex;align-items:center;gap:10px;padding:12px 2px;
  border-bottom:.5px solid var(--cg-hair)}
.cg-lpmain{flex:1;min-width:0}
.cg-lplabel{font-size: var(--text-sm);font-weight:500;color:var(--cg-sub)}
.cg-lpname{margin-top:1px;font-size: var(--text-2xl);font-weight:600;color:var(--cg-ink)}
.cg-lppath{margin-top:2px;font-family:var(--cg-mono);font-size: var(--text-xs);color:var(--cg-faint)}
.cg-lchips{display:flex;gap:6px;padding:12px 2px;border-bottom:.5px solid var(--cg-hair)}
.cg-lchip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 11px;
  border-radius:14px;border:1px solid var(--cg-hair);background:var(--cg-card);
  font-size: var(--text-md);font-weight:500;color:var(--cg-ink)}
.cg-lchip .cg-cdot{width:6px;height:6px;border-radius:50%}
.cg-lchip svg{color:var(--cg-faint)}

/* Scrim + sheet */
.cg-scrim{position:absolute;inset:0;z-index:23;background:rgba(28,28,30,.30)}
.cg-sheet{position:absolute;left:0;right:0;bottom:0;z-index:24;height:56%;
  background:var(--cg-bg);border-radius:22px 22px 0 0;
  box-shadow:0 -8px 30px rgba(0,0,0,.18);padding:10px 18px 0;
  display:flex;flex-direction:column}
.cg-sheetgrab{align-self:center;width:36px;height:5px;border-radius:2.5px;
  background:var(--cg-fill);flex:none}
.cg-shethead{display:flex;align-items:center;gap:10px;margin-top:12px}
.cg-shettitle{font-size: var(--text-4xl);font-weight:700;letter-spacing:-.01em;color:var(--cg-ink)}
.cg-shetbadge{margin-left:auto;display:inline-flex;align-items:center;gap:6px;
  height:30px;padding:0 13px;border-radius:15px;background:var(--cg-accent);
  color:#fff;font-size: var(--text-md);font-weight:600;cursor:pointer}
.cg-greet{margin-top:10px;font-size: var(--text-lg);line-height:1.45;color:var(--cg-sub)}
.cg-greet b{font-weight:600;color:var(--cg-ink)}
.cg-greet .cg-attn{color:#B07A1E;font-weight:600}
.cg-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}
.cg-chip{display:inline-flex;align-items:center;height:32px;padding:0 13px;
  border-radius:16px;background:var(--cg-card);border:1px solid var(--cg-hair);
  font-size: var(--text-md);font-weight:500;color:var(--cg-ink);cursor:pointer;
  box-shadow:0 1px 2px rgba(0,0,0,.04)}
.cg-sheetcomposer{margin-top:auto;margin-bottom:26px;display:flex;align-items:center;
  gap:8px;background:var(--cg-card);border-radius:24px;padding:6px 6px 6px 16px;
  box-shadow:0 1px 3px rgba(0,0,0,.07)}

/* ── Privacy ladder frame ── */
.cg-lscroll{position:absolute;inset:0;padding:112px 16px 0;display:flex;
  flex-direction:column}
.cg-lsect{font-size: var(--text-md);font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  color:var(--cg-sub);padding:0 8px 6px}
.cg-lcard{background:var(--cg-card);border-radius:18px;
  box-shadow:0 1px 2px rgba(0,0,0,.05)}
.cg-lrow{display:flex;align-items:flex-start;gap:11px;padding:12px 14px;
  border-bottom:.5px solid var(--cg-hair)}
.cg-lrow:last-child{border-bottom:none}
.cg-lrow.off{opacity:.42}
.cg-licon{width:30px;height:30px;border-radius:8px;flex:none;margin-top:1px;
  display:flex;align-items:center;justify-content:center;
  background:var(--cg-fill);color:var(--cg-sub)}
.cg-lrow.on .cg-licon{background:var(--cg-accent-soft);color:var(--cg-accent)}
.cg-lmain{flex:1;min-width:0}
.cg-lname{font-size: var(--text-xl);font-weight:600;color:var(--cg-ink);display:flex;
  align-items:center;gap:6px}
.cg-ltag{font-size: var(--text-2xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  padding:2px 6px;border-radius:5px;background:var(--cg-fill);color:var(--cg-sub)}
.cg-ltag.default{background:var(--cg-accent-soft);color:var(--cg-accent)}
.cg-lsub{margin-top:1px;font-size: var(--text-sm);color:var(--cg-sub)}
.cg-lcons{margin-top:4px;font-size: var(--text-sm);line-height:1.35;color:var(--cg-faint)}
.cg-lradio{width:20px;height:20px;border-radius:50%;flex:none;margin-top:5px;
  border:1.5px solid var(--cg-faint)}
.cg-lrow.on .cg-lradio{border:none;background:var(--cg-accent);color:#fff;
  display:flex;align-items:center;justify-content:center}
.cg-lfoot{margin:12px 8px 0;font-size: var(--text-sm);line-height:1.45;color:var(--cg-faint)}
.cg-lfoot b{font-weight:600;color:var(--cg-sub)}
`;

/* ────────────────────────────────────────────────────────────────────
   Shared pieces
   ──────────────────────────────────────────────────────────────────── */

function SheetNav({ ctx, talk }: { ctx: React.ReactNode; talk?: boolean }) {
  return (
    <div className="cg-nav">
      <span className="cg-navdismiss">
        <ChevronDown size={17} strokeWidth={2.2} />
      </span>
      <div className="cg-navmain">
        <div className="cg-navtitle">Concierge</div>
        <div className="cg-navctx">{ctx}</div>
      </div>
      <span className="cg-navtalk">
        {talk ? <AudioWaveform size={14} strokeWidth={2.2} /> : <Mic size={14} strokeWidth={2.2} />}
      </span>
    </div>
  );
}

function ToolRow({ call, dur, gated, flag }: { call: string; dur?: string; gated?: boolean; flag?: string }) {
  return (
    <div className={gated ? "cg-tool gated" : "cg-tool"}>
      <Wrench size={10} strokeWidth={2.2} />
      <span className="cg-tname">{call}</span>
      {flag ? <span className="cg-tflag">{flag}</span> : dur ? <span className="cg-tdur">{dur}</span> : null}
    </div>
  );
}

function Composer({ placeholder }: { placeholder: string }) {
  return (
    <div className="cg-composer">
      <span className="cg-ph">{placeholder}</span>
      <span className="cg-cmic">
        <Mic size={17} strokeWidth={2} />
      </span>
      <span className="cg-csend">
        <ArrowUp size={16} strokeWidth={2.6} />
      </span>
    </div>
  );
}

/* ── Frame 1 · THE CONVERSATION — reads free, mutations gated ───────── */

function ChatFrame() {
  return (
    <DeviceShell device="iphone" scale={0.8705} screenClassName="cg-screen">
      <SheetNav ctx={<><b>studio-mac</b> · grounded in live state</>} />

        <div className="cg-thread">
          {/* Read path: question → bounded tool query → summary */}
          <div className="cg-user">What&apos;s happening on studio-mac?</div>
          <ToolRow call="fetch_host_status(studio-mac)" dur="0.4s" />
          <div className="cg-reply">
            <span className="cg-avatar">
              <Sparkles size={13} strokeWidth={2.2} />
            </span>
            <div className="cg-rcard">
              <b>2 agents working:</b> @voltaire on openscout (Claude Code, 12m),
              @beatrix idle. <span className="cg-attn">One thing needs you:</span> a
              permission request on the auth-refresh task.
            </div>
          </div>

          {/* Mutation path, kind 1: an approval gate, inline */}
          <div className="cg-gate">
            <div className="cg-gatehead">
              <ShieldCheck size={12} strokeWidth={2.2} />
              Approval needed
              <span className="cg-gfrom">@moss · auth-refresh</span>
            </div>
            <div className="cg-gatebody">
              <div className="cg-gatelabel">Proposed action</div>
              <div className="cg-gateact">
                <span className="cg-cmd">Approve: install lodash</span>
              </div>
              <div className="cg-gatenote">
                @moss wants to add lodash to <b style={{ fontWeight: 600 }}>packages/runtime</b>.
                Nothing runs until you say so.
              </div>              <div className="cg-gatebtns">
                <span className="cg-btn primary">
                  <Check size={14} strokeWidth={2.6} />
                  Approve
                </span>
                <span className="cg-btn danger">
                  <X size={14} strokeWidth={2.4} />
                  Deny
                </span>
              </div>
            </div>
          </div>

          {/* Mutation path, kind 2: confirm-before-send */}
          <div className="cg-user">Thanks — tell voltaire to keep going</div>
          <ToolRow call="send_message(@voltaire, …)" gated flag="needs confirmation" />
          <div className="cg-confirm">
            <div className="cg-confhead">
              Proposed message
              <span className="cg-cstate">draft · not sent</span>
            </div>
            <div className="cg-bubble">
              <span className="cg-to">To @voltaire · #reviews</span>
              Keep going on auth-refresh — lodash approved. I&apos;ll review the diff when
              you&apos;re done.
            </div>
            <div className="cg-gatebtns">
              <span className="cg-btn primary">
                <ArrowUp size={14} strokeWidth={2.6} />
                Send
              </span>
              <span className="cg-btn ghost">
                <Pencil size={13} strokeWidth={2.2} />
                Edit
              </span>
              <span className="cg-btn danger">Cancel</span>
            </div>
          </div>
        </div>

        <Composer placeholder="Ask about your fleet…" />
    </DeviceShell>
  );
}

/* ── Frame 2 · ENTRY + POSTURE — sheet over Launch, voice-first ─────── */

function EntryFrame() {
  return (
    <DeviceShell device="iphone" scale={0.8705} screenClassName="cg-screen">
      {/* The Launch frame (vanilla study, v2) underneath */}
        <div className="cg-launch">
          <span className="cg-lhost">
            <span className="cg-pdot" />
            arach-mbp · LAN
          </span>
          <h1>Start a task</h1>
          <span className="cg-lfleet">
            <b>3 agents working</b> · all clear
          </span>
          <div className="cg-lpre">
            <div className="cg-lprow">
              <div className="cg-lpmain">
                <div className="cg-lplabel">Project · most recent</div>
                <div className="cg-lpname">openscout</div>
                <div className="cg-lppath">~/dev/openscout · main</div>
              </div>
              <ChevronRight size={15} strokeWidth={2} color="#C7C7CC" />
            </div>
            <div className="cg-lchips">
              <span className="cg-lchip">
                <span className="cg-cdot" style={{ background: "#D97757" }} />
                Claude Code
                <ChevronDown size={12} strokeWidth={2} />
              </span>
              <span className="cg-lchip">
                Sonnet 4.5
                <ChevronDown size={12} strokeWidth={2} />
              </span>
            </div>
          </div>
        </div>

        {/* Concierge presented as a sheet */}
        <div className="cg-scrim" />
        <div className="cg-sheet">
          <span className="cg-sheetgrab" />
          <div className="cg-shethead">
            <span className="cg-avatar" style={{ width: 30, height: 30, marginTop: 0 }}>
              <Sparkles size={14} strokeWidth={2.2} />
            </span>
            <span className="cg-shettitle">Concierge</span>
            <span className="cg-shetbadge">
              <AudioWaveform size={14} strokeWidth={2.2} />
              Talk
            </span>
          </div>
          <p className="cg-greet">
            <b>Good evening.</b> 3 agents working across 2 hosts —{" "}
            <span className="cg-attn">one thing is waiting on you.</span>
          </p>
          <div className="cg-chips">
            <span className="cg-chip">What needs my attention?</span>
            <span className="cg-chip">Catch me up on openscout</span>
            <span className="cg-chip">Anything waiting on me?</span>
          </div>
          <div className="cg-sheetcomposer">
            <span className="cg-ph" style={{ flex: 1, fontSize: 14.5, color: "var(--cg-faint)" }}>
              Ask, or hold to talk…
            </span>
            <span className="cg-cmic">
              <Mic size={17} strokeWidth={2} />
            </span>
            <span className="cg-csend">
              <ArrowUp size={16} strokeWidth={2.6} />
            </span>
          </div>
        </div>
    </DeviceShell>
  );
}

/* ── Frame 3 · THE PRIVACY LADDER — swappable inference backends ────── */

const LADDER = [
  {
    icon: Smartphone,
    name: "On-device",
    tag: "Coming later",
    sub: "Apple Foundation Models",
    cons: "Nothing leaves this phone.",
    off: true,
    on: false,
  },
  {
    icon: Server,
    name: "Mesh-local",
    tag: null,
    sub: "A model on your own hardware",
    cons: "Nothing leaves the mesh.",
    off: false,
    on: false,
  },
  {
    icon: Cloud,
    name: "Your cloud",
    tag: null,
    sub: "BYOC · Cloudflare / AWS / e2b / exe.dev",
    cons: "Runs in your own tenancy, under your credentials.",
    off: false,
    on: false,
  },
  {
    icon: KeyRound,
    name: "Your provider key",
    tag: "Default",
    sub: "BYOK · Anthropic / OpenAI",
    cons: "Requests go to your model provider, on your key.",
    off: false,
    on: true,
  },
];

function LadderFrame() {
  return (
    <DeviceShell device="iphone" scale={0.8705} screenClassName="cg-screen">
      <SheetNav ctx={<><b>settings</b> · inference</>} />

        <div className="cg-lscroll">
          <div className="cg-lsect">Where the concierge thinks</div>
          <div className="cg-lcard">
            {LADDER.map((r) => {
              const Icon = r.icon;
              return (
                <div key={r.name} className={`cg-lrow${r.off ? " off" : ""}${r.on ? " on" : ""}`}>
                  <span className="cg-licon">
                    <Icon size={15} strokeWidth={2} />
                  </span>
                  <div className="cg-lmain">
                    <div className="cg-lname">
                      {r.name}
                      {r.tag && (
                        <span className={r.tag === "Default" ? "cg-ltag default" : "cg-ltag"}>{r.tag}</span>
                      )}
                    </div>
                    <div className="cg-lsub">{r.sub}</div>
                    <div className="cg-lcons">{r.cons}</div>
                  </div>
                  <span className="cg-lradio">
                    {r.on && <Check size={12} strokeWidth={3} />}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="cg-lfoot">
            Same concierge, same tools — only the inference backend changes.{" "}
            <b>The tool surface is the durable asset; the model is swappable.</b>
          </p>
        </div>
    </DeviceShell>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Notes column (same idiom as the vanilla study)
   ──────────────────────────────────────────────────────────────────── */

function FrameCaption({ name, role }: { name: string; role: string }) {
  return (
    <div className="mt-4 flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.14em] text-studio-ink-faint">
      <span className="text-studio-ink-muted">{name}</span>
      <span>·</span>
      <span>{role}</span>
    </div>
  );
}

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

type FrameId = "chat" | "entry" | "ladder";

export default function IosConciergeStudy() {
  const frame = useMemo<FrameId | "all">(() => {
    if (typeof window === "undefined") return "all";
    const p = new URLSearchParams(window.location.search).get("frame");
    return p === "chat" || p === "entry" || p === "ladder" ? p : "all";
  }, []);

  const show = (id: FrameId) => frame === "all" || frame === id;

  return (
    <main className="cglane mx-auto max-w-page px-7 py-8">
      <style>{CG_CSS}</style>

      <header className="mb-7 max-w-prose">
        <EyebrowLabel size="sm">· studies · ios · everyday lane</EyebrowLabel>
        <h1 className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-studio-ink">
          The Concierge
        </h1>
        <p className="mt-3 font-sans text-lg leading-relaxed text-studio-ink-faint">
          A conversational interface over the app&apos;s <b className="font-semibold text-studio-ink">own
          functions and state</b> — not an agent orchestrator. The concierge answers questions and
          performs bounded actions against the data model via tool calls.{" "}
          <b className="font-semibold text-studio-ink">Reads are free</b> (fetch, status, summarize — no
          confirmation); <b className="font-semibold text-studio-ink">mutations are gated</b> (it proposes
          send/ask/approve, you confirm). Interim inference is cloud via{" "}
          <b className="font-semibold text-studio-ink">BYOK</b> or <b className="font-semibold text-studio-ink">BYOC</b>;
          long-term it migrates on-device. The tool surface is the durable asset; the model is swappable.
        </p>
      </header>

      <div className="mb-9 flex max-w-[840px] flex-wrap items-center gap-x-6 gap-y-2 border-y border-studio-edge py-2.5 font-mono text-xs text-studio-ink-faint">
        <span className="text-studio-ink-muted">Deep-link:</span>
        <span>
          <code className="text-studio-ink-muted">?frame=chat</code> ·{" "}
          <code className="text-studio-ink-muted">?frame=entry</code> ·{" "}
          <code className="text-studio-ink-muted">?frame=ladder</code> (default: all three)
        </span>
        <span>
          Sibling study: <code className="text-studio-ink-muted">/studies/ios-home-vanilla</code>
        </span>
      </div>

      {/* Frame 1 — the conversation */}
      {show("chat") && (
        <section className="mb-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
          <div className="flex-none">
            <ChatFrame />
            <FrameCaption name="Conversation" role="reads free · mutations gated" />
          </div>
          <Notes
            tag="Everyday lane · concierge · core loop"
            rec
            title="The gate is a chat artifact, not a dialog"
            callouts={[
              { mark: "+", text: "Reads are free: fetch_host_status ran with no ceremony — the only trace is one quiet monospace row. Questions should never feel like operations." },
              { mark: "+", text: "Mutations are gated twice, visibly: the approval gate (amber, Approve/Deny) and the confirm-before-send draft (Send/Edit/Cancel). The concierge proposes; the user disposes." },
              { mark: "−", text: "Two gated turns in a row is heavy for chat. Real flows interleave free reads; the density here is for demonstration, not the expected cadence." },
              { mark: "→", text: "Gate state must survive the lane: the same approval appears in Overview and the Operator crown. Calm is a look, not a filter." },
            ]}
          >
            <p>
              The core frame is one continuous thread that shows the whole contract in a single
              screen. A question (<b>&ldquo;what&apos;s happening on studio-mac?&rdquo;</b>) is grounded by a
              bounded tool call — <b>fetch_host_status(studio-mac) · 0.4s</b> — shown as a subtle
              monospace row, then answered in plain language with the one thing that needs a human
              called out.
            </p>
            <ul>
              <li>
                <b>Approval gate.</b> The permission request on the auth-refresh task arrives as an
                amber-bordered card with <b>Approve / Deny</b> — the mutation gate made tangible,
                visually distinct from ordinary replies.
              </li>
              <li>
                <b>Confirm-before-send.</b> &ldquo;Tell voltaire to keep going&rdquo; produces a{" "}
                <b>send_message(@voltaire, …)</b> tool row flagged <i>needs confirmation</i>, plus the
                exact proposed message as a draft bubble with <b>Send / Edit / Cancel</b>. Nothing
                leaves the app unreviewed.
              </li>
              <li>
                <b>Retrieval, not context-stuffing.</b> Every claim in a reply traces to a bounded
                tool query. The thread shows its work without turning into a log.
              </li>
            </ul>
          </Notes>
        </section>
      )}

      {/* Frame 2 — entry + posture */}
      {show("entry") && (
        <section className="mb-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
          <div className="flex-none">
            <EntryFrame />
            <FrameCaption name="Entry" role="sheet over Launch · voice-first" />
          </div>
          <Notes
            tag="Everyday lane · concierge · entry + posture"
            title="A sheet, not a destination"
            callouts={[
              { mark: "+", text: "Entry is a sheet over wherever you are — Launch here. The concierge overlays the app because it speaks FOR the app; it is not a fifth tab." },
              { mark: "+", text: "At rest it leads with the answer, not the box: a one-line greeting with the one thing waiting, then suggestion chips for the three questions people actually ask." },
              { mark: "→", text: "Voice-first posture: the Talk affordance (hold-to-talk, waveform when live) is primary, sized for walking-away-from-the-desk triage. Text stays fully capable." },
            ]}
          >
            <p>
              The concierge is reached as a <b>sheet over the Launch frame</b> — the composer-first
              home from the vanilla study stays underneath, scrimmed. At rest the sheet shows a
              greeting with the day&apos;s posture, three suggestion chips (
              <b>&ldquo;What needs my attention?&rdquo;</b>, <b>&ldquo;Catch me up on openscout&rdquo;</b>,{" "}
              <b>&ldquo;Anything waiting on me?&rdquo;</b>), and a composer with a mic.
            </p>
            <ul>
              <li>
                <b>Positioning: concierge, not reviewer.</b> It triages, summarizes, and carries
                bounded instructions. It does not review diffs, rank approaches, or second-guess
                agents — that stays with the human and the harnesses.
              </li>
              <li>
                <b>Talk mode</b> is the calm-lane read of the same product: ask what needs you while
                away from the desk, hear the answer, approve with a word.
              </li>
            </ul>
          </Notes>
        </section>
      )}

      {/* Frame 3 — the privacy ladder */}
      {show("ladder") && (
        <section className="mb-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
          <div className="flex-none">
            <LadderFrame />
            <FrameCaption name="Privacy ladder" role="swappable inference backends" />
          </div>
          <Notes
            tag="Everyday lane · concierge · the privacy ladder"
            title="The tool surface outlives the model"
            callouts={[
              { mark: "+", text: "Each rung states its consequence in one line — 'nothing leaves the mesh', 'runs in your own tenancy'. Privacy as legible trade-offs, not policy prose." },
              { mark: "+", text: "BYOK is the honest default today; on-device is shown ghosted, not hidden — the roadmap is part of the artifact." },
              { mark: "→", text: "Voice roadmap: speech pairs with the on-device rung last. Interim voice rides the same backend as text — no separate audio pipeline to trust." },
            ]}
          >
            <p>
              Four inference backends as a selectable list, in <b>descending privacy order</b>:{" "}
              <b>On-device</b> (Apple Foundation Models — coming later, ghosted), <b>Mesh-local</b>{" "}
              (your own hardware), <b>Your cloud</b> (BYOC — Cloudflare / AWS / e2b / exe.dev), and{" "}
              <b>Your provider key</b> (BYOK — the default). Each option carries a one-line
              consequence.
            </p>
            <ul>
              <li>
                <b>The durable asset is the tool surface.</b> fetch_host_status, send_message,
                approve — these are Scout&apos;s own functions, stable across every rung. The model
                behind them is swappable: the same concierge, the same gates, a different brain.
              </li>
              <li>
                <b>This is a design artifact of the ladder</b>, not a settings spec — copy,
                ordering, and consequence lines are the deliverable.
              </li>
            </ul>
          </Notes>
        </section>
      )}

      <p className="mt-2 border-t border-studio-edge pt-5 font-sans text-sm leading-relaxed text-studio-ink-faint">
        Grammar and palette mirror <code className="font-mono text-studio-ink-muted">/studies/ios-home-vanilla</code>{" "}
        (grouped #F2F2F7 canvas, white cards, one emerald accent); the Launch frame underneath the
        sheet is that study&apos;s v2 composer-first home. Fleet content matches the vanilla study
        (@voltaire, studio-mac / arach-mbp, ~/dev/openscout, Claude Code / Codex). Mock data;
        production app untouched.
      </p>
    </main>
  );
}
