"use client";

import { useState, useEffect } from "react";
import type { AgentState, CommsKind, CommsStatus } from "./data";

/** Per-state dot: live = pulsing accent, idle = muted filled, offline/unknown = hollow ring. */
export function StateDot({ state }: { state: AgentState }) {
  if (state === "live") return <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />;
  if (state === "idle") return <span className="iDot" style={{ background: "var(--i-muted)" }} />;
  return <span className="iRing" />;
}

/** Section header — HudSectionLabel: caps mono micro, optional pulsing dot + trailing "All". */
export function SectionHeader({ label, live, all }: { label: string; live?: boolean; all?: boolean }) {
  return (
    <div className="iSec">
      {live && <span className="iPulse" />}
      <span className="iSecLabel">{label}</span>
      {all && <span className="iSecAll">All</span>}
    </div>
  );
}

/** Tree connector for a nested agent leaf (vertical rail + tick; last = elbow). */
export function TreeRail({ last }: { last: boolean }) {
  return (
    <svg className="iTree" viewBox="0 0 18 40" fill="none" stroke="currentColor"
      strokeWidth={1} strokeLinecap="round" preserveAspectRatio="none">
      <path d={`M1 0V${last ? 20 : 40}M1 20H17`} />
    </svg>
  );
}

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function BrailleSpinner() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF((x) => (x + 1) % BRAILLE.length), 90);
    return () => clearInterval(id);
  }, []);
  return <span className="iBraille">{BRAILLE[f]}</span>;
}

/** Conversation-type glyph: `#` channel · `•••` group · system asterisk · DM blank. */
export function CommsTypeGlyph({ kind }: { kind: CommsKind }) {
  if (kind === "channel") {
    return (
      <svg width={15} height={15} viewBox="0 0 15 15" fill="none" stroke="currentColor"
        strokeWidth={1.4} strokeLinecap="round">
        <path d="M6.3 2.4L5.1 12.6M10.5 2.4L9.3 12.6M2.7 6h9.9M2.4 9.3h9.9" />
      </svg>
    );
  }
  if (kind === "group") return <span className="iGroupDots"><i /><i /><i /></span>;
  if (kind === "system") {
    return (
      <svg width={15} height={15} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
        <path d="M7.5 2.5v10M3.2 5l8.6 5M11.8 5l-8.6 5" />
      </svg>
    );
  }
  return null; // direct: blank
}

/** The status separator: `?` ask (accent) · braille spinner working (accent) · `›` awaiting · `·` idle. */
export function CommsStatusGlyph({ status }: { status: CommsStatus }) {
  if (status === "ask") return <span style={{ color: "var(--i-accent)" }}>?</span>;
  if (status === "working") return <BrailleSpinner />;
  if (status === "awaiting") return <span style={{ color: "var(--i-muted)" }}>›</span>;
  return <span style={{ color: "var(--i-dim)" }}>·</span>;
}

/** Labeled segmented control — the studio's mono-caps toggle. Used for the
 *  palette switch, the treatment switch, and surface sub-modes. */
export function Seg({ label, value, onChange, options }: {
  label?: string; value: string; onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {label && (
        <span style={{ fontFamily: "var(--i-mono,monospace)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a7f88" }}>{label}</span>
      )}
      <div style={{ display: "inline-flex", padding: 3, borderRadius: 9, background: "#15171a", border: "1px solid #24272c" }}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button key={o.id} onClick={() => onChange(o.id)}
              style={{
                fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 7, border: "none",
                cursor: "pointer", color: on ? "#04130d" : "#aab0ba",
                background: on ? "#10b981" : "transparent", transition: "background 0.12s",
              }}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
