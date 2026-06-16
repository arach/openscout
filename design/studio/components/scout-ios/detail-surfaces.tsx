"use client";

// Scout iOS — the detail / sheet surfaces, faithful to the app source:
//   Conversation  apps/ios/Scout/ConversationSurface.swift
//   Terminal      apps/ios/Scout/TerminalSurface.swift
//   New Session   apps/ios/Scout/NewSessionSurface.swift
//   Connect       apps/ios/Scout/ConnectionView.swift + PairingView.swift
//   Settings      apps/ios/Scout/AppSettingsView.swift
// Each exports a header (passed to <PhoneShell header=…>) and one or more body
// nodes (the treatments). Pushed surfaces run chrome-less (no tab bar).

import { Glyph } from "./Glyph";
import { BrailleSpinner } from "./primitives";
import { DetailHeader } from "./PhoneShell";
import {
  MACHINES, CONVERSATION, TERMINAL_LINES, TERMINAL_KEYS,
  ROUTES, CONNECT_LOG, CONN_LEVEL_COLOR,
  type ConvBlock, type ConvTurn,
} from "./data";

// ── shared bits ─────────────────────────────────────────────────────────────

function MicGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

/** Minimal inline markdown: **bold** within a line. */
function Inline({ s }: { s: string }) {
  return <>{s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>)}</>;
}
function MdText({ md }: { md: string }) {
  return <>{md.split("\n").map((line, i) =>
    line.startsWith("- ")
      ? <div key={i} className="iMdLi">•&nbsp;<Inline s={line.slice(2)} /></div>
      : <div key={i} className="iMdP"><Inline s={line} /></div>)}</>;
}

// ── Conversation ────────────────────────────────────────────────────────────

export function ConversationHeader() {
  return (
    <DetailHeader
      title="broker-smith"
      subtitle="claude · opus-4.8"
      badge={<span className="iStreamBadge">streaming</span>}
      trailing={<span className="iGear iGearSm"><Glyph kind="gear" size={16} /></span>}
    />
  );
}

function Block({ b, collapseReasoning }: { b: ConvBlock; collapseReasoning?: boolean }) {
  if (b.t === "text") return <div className="iMsg"><MdText md={b.md} /></div>;
  if (b.t === "reasoning") {
    if (collapseReasoning)
      return <div className="iReasonChip"><span className="iReasonChipDot" />thought<span className="iReasonChipCaret">›</span></div>;
    return <div className="iReason">{b.text}</div>;
  }
  if (b.t === "question") {
    return (
      <div className="iQuestion">
        <div className="iQHead">QUESTION</div>
        <div className="iQText">{b.q}</div>
        <div className="iQOpts">
          {b.options.map((o) => (
            <button key={o} className={`iQOpt ${b.answered === o ? "on" : ""}`}>{o}</button>
          ))}
        </div>
      </div>
    );
  }
  // action
  return (
    <div className="iAct">
      <div className="iActHead">
        <span className="iActIcon"><Glyph kind={b.icon} size={13} /></span>
        <span className="iActTitle">{b.title}</span>
        <span className="iSpacer" />
        <span className="iActStatus" data-s={b.status}>
          {b.status === "running" ? <BrailleSpinner /> : b.status}
        </span>
      </div>
      {b.output && <div className="iActOut">{b.output}</div>}
      {b.approval && (
        <div className="iApproval">
          <div className="iApprovalDesc">{b.approval.desc}</div>
          <div className="iApprovalRow">
            <span className="iRiskBadge" data-r={b.approval.risk}>{b.approval.risk} risk</span>
            <span className="iSpacer" />
            <button className="iBtn iBtnDeny">Deny</button>
            <button className="iBtn iBtnApprove">Approve</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Turn({ turn, collapseReasoning }: { turn: ConvTurn; collapseReasoning?: boolean }) {
  return (
    <div className="iTurn">
      <div className="iTurnLabel" data-role={turn.role}>
        <span>{turn.role === "user" ? "YOU" : "AGENT"}</span>
      </div>
      {turn.blocks.map((b, i) => <Block key={i} b={b} collapseReasoning={collapseReasoning} />)}
    </div>
  );
}

export function ConversationBody({ collapseReasoning }: { collapseReasoning?: boolean } = {}) {
  return (
    <>
      <div className="iBody iConv">
        {CONVERSATION.map((t) => <Turn key={t.id} turn={t} collapseReasoning={collapseReasoning} />)}
      </div>
      <div className="iComposer">
        <span className="iMic"><MicGlyph /></span>
        <div className="iComposerField focus">below the search — keep it collapsed<span className="iComposerCaret" /></div>
        <span className="iSend armed"><Glyph kind="arrow" size={15} /></span>
      </div>
    </>
  );
}

// ── Terminal ────────────────────────────────────────────────────────────────

export function TerminalHeader() {
  return (
    <div className="iHead">
      <div className="iTermHead">
        <span className="iTermGlyph"><Glyph kind="terminal" size={17} /></span>
        <span className="iTermTitle">Terminal</span>
        <span className="iTermEndpoint">studio · zsh</span>
      </div>
      <div className="iMastRule" />
    </div>
  );
}

export function TerminalBody() {
  return (
    <div className="iBody iTermBody">
      <div className="iTermScreen">
        {TERMINAL_LINES.map((l, i) => (
          <div key={i} className={`iTermLine iTermLine-${l.kind}`}>
            {l.kind === "prompt" && <span className="iTermSigil">$ </span>}{l.text}
          </div>
        ))}
        <div className="iTermLine"><span className="iTermSigil">$ </span><span className="iTermCursor" /></div>
      </div>
      <div className="iTermTray">
        {TERMINAL_KEYS.map((k) => <span key={k} className="iTermKey">{k}</span>)}
        <span className="iSpacer" />
        <span className="iTermKey iTermMic"><MicGlyph size={13} /></span>
      </div>
    </div>
  );
}

export function TerminalConnecting() {
  return (
    <div className="iBody iTermBody">
      <div className="iTermStatusPanel">
        <div className="iTermStatusSpin"><BrailleSpinner /></div>
        <div className="iTermStatusTitle">Authorizing this device…</div>
        <div className="iTermStatusSub">Registering your terminal key with studio</div>
      </div>
    </div>
  );
}

// ── New Session ─────────────────────────────────────────────────────────────

export function NewSessionBody({ result }: { result?: boolean }) {
  return (
    <>
      <div className="iBody iNew">
        <div className="iNewSection">
          <div className="iNewLabel">Project</div>
          <div className="iNewCard iNewProject">
            <span className="iFolder"><Glyph kind="folder" size={18} /></span>
            <div className="iNewProjText">
              <div className="iNewProjName">openscout</div>
              <div className="iNewProjPath">~/dev/openscout</div>
            </div>
            <span className="iSpacer" />
            <span className="iChev"><Glyph kind="chevron" size={14} /></span>
          </div>
        </div>

        <div className="iNewSection">
          <div className="iNewLabel">Agent</div>
          <div className="iNewCard iNewAgent">
            <span className="iChoice">claude <span className="iCaret2">⌄</span></span>
            <span className="iNewDot">·</span>
            <span className="iChoice">opus-4.8 <span className="iCaret2">⌄</span></span>
            <span className="iSpacer" />
            <span className="iTargetTok">studio</span>
          </div>
        </div>

        <div className="iNewSection">
          <div className="iNewLabel">Prompt</div>
          <div className="iNewCard iNewPrompt">
            <div className="iNewPromptText">ship the projects-first Home + machine rail; lead with projects, compress one-child repos…</div>
            <span className="iMic iMicFloat"><MicGlyph size={16} /></span>
          </div>
        </div>

        {result && (
          <div className="iNewSection">
            <div className="iResultCard">
              <div className="iResultHead">Session started</div>
              {[["conversation", "cnv_8f2a"], ["agent", "agt_19c4"], ["flight", "flt_77de"], ["message", "msg_0a31"]].map(([k, v]) => (
                <div key={k} className="iResultRow"><span className="iResultKey">{k}</span><span className="iResultVal">{v}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="iNewFooter">
        <button className="iStartBtn">{result ? "Open conversation" : "Start session"}</button>
      </div>
    </>
  );
}

// ── Connect ─────────────────────────────────────────────────────────────────

export function ConnectHeader() {
  return <DetailHeader title="Connect a Mac" subtitle="bridge · pairing" />;
}

export function ConnectionBody() {
  return (
    <div className="iBody iConn">
      <div className="iConnStatus">
        <div className="iConnStatusMain">
          <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />
          Connected to <strong>&nbsp;studio</strong>
        </div>
        <div className="iConnStatusSub">LAN · 192.168.1.24:7777 · noise XX</div>
      </div>

      <div className="iRouteLegend">
        {ROUTES.map((r, i) => (
          <span key={r} style={{ display: "inline-flex", alignItems: "center" }}>
            {i > 0 && <span className="iRouteArrow">›</span>}
            <span className={`iRouteChip ${r === "LAN" ? "on" : ""}`}>{r}</span>
          </span>
        ))}
      </div>

      <div className="iConnActions">
        <button className="iBtn iBtnGhost">Reconnect</button>
        <button className="iBtn iBtnPrimary">Pair with a Mac</button>
      </div>

      <div className="iSecLabel" style={{ padding: "12px 0 7px" }}>CONNECTION LOG</div>
      <div className="iCard">
        {CONNECT_LOG.map((row, i) => (
          <div key={i}>
            {i > 0 && <div className="iRowSep" style={{ marginLeft: 13 }} />}
            <div className="iConnLogRow">
              <span className="iConnRoute">{row.route}</span>
              <span className="iConnEvent" style={{ color: CONN_LEVEL_COLOR[row.level] }}>{row.event}</span>
              <span className="iConnMsg">{row.msg}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PairingBody() {
  return (
    <div className="iBody iPair">
      <div className="iPairInstruction">On your Mac, open Scout → Settings → Connect, then point the camera at the code shown there.</div>
      <div className="iPairFrame">
        <div className="iPairQR" />
        <span className="iPairFinder tl" /><span className="iPairFinder tr" /><span className="iPairFinder bl" />
      </div>
      <button className="iBtn iBtnGhost iPairPaste">Paste pairing link</button>
      <div className="iPairStatus"><BrailleSpinner />&nbsp; waiting for the Mac to confirm…</div>
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

export const SETTINGS_TABS = ["CONNECTION", "ROUTES", "IDENTITY", "VOICE", "ALERTS", "APPEARANCE", "ADVANCED"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function SettingsHeader() {
  return <DetailHeader title="Settings" trailing={<span className="iDoneBtn">Done</span>} />;
}

function SetRow({ label, value, control }: { label: string; value?: string; control?: React.ReactNode }) {
  return (
    <div className="iSetRow">
      <span className="iSetRowLabel">{label}</span>
      <span className="iSpacer" />
      {value && <span className="iSetRowVal">{value}</span>}
      {control}
    </div>
  );
}
function Toggle({ on }: { on?: boolean }) {
  return <span className={`iToggle ${on ? "on" : ""}`}><span className="iToggleKnob" /></span>;
}
function SetSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="iSetSection">
      <div className="iSecLabel" style={{ padding: "0 0 7px" }}>{label}</div>
      <div className="iCard">{children}</div>
    </div>
  );
}

export function SettingsBody({ tab, onTab }: { tab: SettingsTab; onTab: (t: SettingsTab) => void }) {
  return (
    <div className="iBody iSet">
      <div className="iSetTabs">
        {SETTINGS_TABS.map((t) => (
          <span key={t} className={`iSetTab ${t === tab ? "on" : ""}`} onClick={() => onTab(t)}>{t}</span>
        ))}
      </div>

      {tab === "CONNECTION" && (
        <>
          <SetSection label="MACS">
            {MACHINES.map((m, i) => (
              <div key={m.name}>
                {i > 0 && <div className="iRowSep" style={{ marginLeft: 13 }} />}
                <div className="iSetRow">
                  <span className="iDot" style={{ background: m.state === "connected" ? "var(--i-accent)" : "var(--i-dim)" }} />
                  <span className="iSetRowLabel">{m.name}</span>
                  <span className="iSpacer" />
                  <span className="iSetRowVal">{m.state === "connected" ? "LAN · linked" : "idle"}</span>
                  <span className="iForget">FORGET</span>
                </div>
              </div>
            ))}
          </SetSection>
          <SetSection label="STATUS">
            <SetRow label="Route" value="LAN" />
            <div className="iRowSep" style={{ marginLeft: 13 }} />
            <SetRow label="Status" value="connected" />
            <div className="iRowSep" style={{ marginLeft: 13 }} />
            <SetRow label="Last seen" value="now" />
          </SetSection>
        </>
      )}

      {tab === "ROUTES" && (
        <>
          <SetSection label="PRIORITY">
            <div className="iRouteLegend" style={{ padding: "10px 13px" }}>
              {ROUTES.map((r, i) => (
                <span key={r} style={{ display: "inline-flex", alignItems: "center" }}>
                  {i > 0 && <span className="iRouteArrow">›</span>}
                  <span className={`iRouteChip ${r === "LAN" ? "on" : ""}`}>{r}</span>
                </span>
              ))}
            </div>
          </SetSection>
          <SetSection label="TRANSPORTS">
            <SetRow label="LAN (Bonjour)" control={<Toggle on />} />
            <div className="iRowSep" style={{ marginLeft: 13 }} />
            <SetRow label="Tailnet" control={<Toggle on />} />
            <div className="iRowSep" style={{ marginLeft: 13 }} />
            <SetRow label="OpenScout Net" control={<Toggle />} />
          </SetSection>
        </>
      )}

      {tab === "IDENTITY" && (
        <SetSection label="THIS DEVICE">
          <SetRow label="Device name" value="iPhone" />
          <div className="iRowSep" style={{ marginLeft: 13 }} />
          <SetRow label="Public key" value="ed25519 · 7f2a…91c4" />
        </SetSection>
      )}

      {tab === "VOICE" && (
        <>
          <SetSection label="ENGINE">
            <SetRow label="Preference" value="Parakeet" control={<span className="iCaret2">⌄</span>} />
            <div className="iRowSep" style={{ marginLeft: 13 }} />
            <SetRow label="Model" value="parakeet-tdt-0.6b · warm" />
          </SetSection>
          <SetSection label="DICTATION">
            <SetRow label="On-device" control={<Toggle on />} />
            <div className="iRowSep" style={{ marginLeft: 13 }} />
            <SetRow label="Fallback to Apple" control={<Toggle on />} />
          </SetSection>
        </>
      )}

      {tab === "ALERTS" && (
        <SetSection label="NOTIFICATIONS">
          <SetRow label="Approval alerts" control={<Toggle on />} />
          <div className="iRowSep" style={{ marginLeft: 13 }} />
          <SetRow label="Mentions" control={<Toggle on />} />
        </SetSection>
      )}

      {tab === "APPEARANCE" && (
        <>
          <SetSection label="THEME">
            <SetRow label="Appearance" value="Dark (locked)" />
            <div className="iRowSep" style={{ marginLeft: 13 }} />
            <SetRow label="Accent" value="Emerald" />
          </SetSection>
          <div className="iSetNote">iOS ships dark-locked on HudPalette — no light mode or accent switching, unlike macOS.</div>
        </>
      )}

      {tab === "ADVANCED" && (
        <>
          <SetSection label="DIAGNOSTICS">
            <SetRow label="Copy connection log" control={<span className="iChev"><Glyph kind="chevron" size={13} /></span>} />
            <div className="iRowSep" style={{ marginLeft: 13 }} />
            <SetRow label="Build" value="0.4.0 (118)" />
          </SetSection>
        </>
      )}
    </div>
  );
}
