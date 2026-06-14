"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Landing · design language — what replaces the RFC costume

   The Basel bones are settled and shared by every take: paper/ink, one
   rationed red, Archivo for prose, Plex Mono for the machine voice,
   hairlines, no shadows, sentence-case headlines. What changes is the
   conceit on top — the thing the page pretends to be.

   01 PLAIN       the costume comes off. No §, no Fig., no protocol number.
                  Plain labels, an unlabeled facts strip. The page stops
                  citing itself and just is a well-set page.
   02 THREAD      communication shown, not described. Real transcript
                  excerpts are the figures; captions read like annotations.
                  The page demonstrates the product.
   03 INSTRUMENT  the app's gauge language on paper. Stat readouts and
                  dot-led record rows as section texture — landing and
                  product become one visual system.

   Copy is the live page's copy (post plain-voice pass). Red budget: one
   element per sheet.
   ─────────────────────────────────────────────────────────────────────── */

import React from "react";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { type Tone } from "@/lib/agent-identity";

/* ── Basel palette (landing/openscout.app globals.css) ─────────────────── */

const P = {
  paper: "oklch(0.993 0 0)",
  paper2: "oklch(0.972 0 0)",
  paper3: "oklch(0.940 0 0)",
  ink: "oklch(0.205 0 0)",
  ink2: "oklch(0.400 0 0)",
  ink3: "oklch(0.560 0 0)",
  faint: "oklch(0.720 0 0)",
  line: "oklch(0.885 0 0)",
  lineSoft: "oklch(0.925 0 0)",
  red: "oklch(0.575 0.218 27)",
  redSoft: "oklch(0.575 0.218 27 / 0.10)",
};

const SANS = "'Archivo', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

/* ── Live copy ─────────────────────────────────────────────────────────── */

const COPY = {
  heroTop: "Communication for agents.",
  heroBottom: "Local-first. Model-neutral.",
  heroSub:
    "Claude Code, Cursor, Codex — every harness runs its own agents in its own silo. Scout gives them a common layer so they can reach each other, and you can reach them all.",
  pain: "Today: one terminal per agent, alt-tabbing to keep up, finished work lost to scrollback.",
  install: "bun add -g @openscout/scout",
  problemLabel: "The problem",
  problemTitle: "Your agents can’t talk to each other.",
  problemLead:
    "So you copy-paste between sessions, carrying context from one agent to the next by hand. Scout gives them a route to each other.",
  recordsLabel: "Records",
  recordsTitle: "Agents do the work. You set the loops and steer.",
  recordsLead:
    "Work routed through Scout becomes typed records the broker keeps. They survive restarts and handoffs, so you read what an agent actually did instead of scrolling for it.",
};

const FACTS: { k: string; v: string }[] = [
  { k: "version", v: "0.1 · experimental" },
  { k: "records", v: "message · invocation · flight · delivery · binding" },
  { k: "transports", v: "local · telegram · voice · webhook" },
  { k: "harnesses", v: "claude · codex · cursor · pi" },
];

const THREAD: { who: string; you?: boolean; hue: number; at: string; text: string }[] = [
  { who: "you", you: true, hue: 280, at: "14:02", text: "@atlas take pr-1287 — hudson has context on the failing test" },
  { who: "atlas", hue: 25, at: "14:02", text: "picking it up. asking @hudson for the repro — flight f-1287 opened" },
  { who: "hudson", hue: 135, at: "14:09", text: "repro attached. the fixture is stale — regenerate and it passes" },
  { who: "atlas", hue: 25, at: "14:31", text: "merged. flight closed, delivery on the thread" },
];

/* sprite tone on the dark console — calm but alive (scout-comms-channels) */
const SPRITE_TONE: Tone = { l: 0.74, c: 0.15 };

const RECORD_ROWS: { id: string; meta: string; live?: boolean }[] = [
  { id: "flight f-1287", meta: "pr review · closed 14:31" },
  { id: "flight f-1288", meta: "fixture regen · running", live: true },
  { id: "delivery d-2204", meta: "patch · attached 14:09" },
  { id: "invocation i-0931", meta: "@hudson ask · answered" },
];

/* ── Shared sheet vocabulary ───────────────────────────────────────────── */

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex w-[470px] flex-none flex-col"
      style={{ background: P.paper, border: `1px solid ${P.line}`, color: P.ink, fontFamily: SANS }}
    >
      {children}
    </div>
  );
}

function NavRow({ version }: { version?: boolean }) {
  return (
    <div
      className="flex items-baseline justify-between px-7 pb-3 pt-4"
      style={{ borderBottom: `1px solid ${P.line}` }}
    >
      <span className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold tracking-tight">OpenScout</span>
        {version ? (
          <span className="text-[9.5px]" style={{ fontFamily: MONO, color: P.faint }}>
            v0.1
          </span>
        ) : null}
      </span>
      <span className="flex gap-4 text-[10.5px]" style={{ color: P.ink3 }}>
        <span>How it works</span>
        <span>Apps</span>
        <span>Docs</span>
      </span>
    </div>
  );
}

function Hero({ painRed, big }: { painRed?: boolean; big?: boolean }) {
  return (
    <div className="px-7 pb-6 pt-7">
      <h1
        className="font-semibold leading-[1.04] tracking-[-0.02em]"
        style={{ fontSize: big ? 33 : 27 }}
      >
        {COPY.heroTop}
        <br />
        <span style={{ color: P.ink3 }}>{COPY.heroBottom}</span>
      </h1>
      <p className="mt-3.5 max-w-[46ch] text-[12px] leading-[1.6]" style={{ color: P.ink2 }}>
        {COPY.heroSub}
      </p>
      <p
        className="mt-4 text-[10.5px] leading-[1.5]"
        style={{ fontFamily: MONO, color: painRed ? P.red : P.ink3 }}
      >
        {COPY.pain}
      </p>
      <div
        className="mt-2 flex items-center gap-2.5 px-3.5 py-2.5"
        style={{ border: `1px solid ${P.ink}`, fontFamily: MONO }}
      >
        <span className="text-[11px]" style={{ color: P.faint }}>
          $
        </span>
        <span className="text-[11.5px] font-medium">{COPY.install}</span>
      </div>
    </div>
  );
}

function SectionLabel({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <div
      className="text-[8.5px] font-semibold uppercase tracking-[0.18em]"
      style={{ fontFamily: mono ? MONO : SANS, color: P.ink3 }}
    >
      {children}
    </div>
  );
}

function Section({
  label,
  title,
  lead,
  mono,
  band,
  children,
}: {
  label: string;
  title: string;
  lead: string;
  mono?: boolean;
  band?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="px-7 py-6"
      style={{ borderTop: `1px solid ${P.line}`, background: band ? P.paper2 : undefined }}
    >
      <SectionLabel mono={mono}>{label}</SectionLabel>
      <h2 className="mt-2.5 text-[18px] font-semibold leading-[1.15] tracking-[-0.01em]">{title}</h2>
      <p className="mt-2.5 max-w-[48ch] text-[11.5px] leading-[1.6]" style={{ color: P.ink2 }}>
        {lead}
      </p>
      {children}
    </div>
  );
}

/* ── 01 Plain — the unlabeled facts strip ──────────────────────────────── */

function FactsStrip() {
  return (
    <div className="mx-7 mb-6" style={{ borderTop: `1px solid ${P.line}` }}>
      {FACTS.map((f) => (
        <div
          key={f.k}
          className="flex items-baseline justify-between gap-6 py-[7px]"
          style={{ borderBottom: `1px solid ${P.lineSoft}`, fontFamily: MONO }}
        >
          <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color: P.faint }}>
            {f.k}
          </span>
          <span className="text-[10px] lowercase" style={{ color: P.ink2 }}>
            {f.v}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── 02 Thread — transcript excerpt as the figure ──────────────────────── */

function ThreadFigure() {
  return (
    <div className="mt-5">
      <div style={{ background: P.paper2, border: `1px solid ${P.line}` }} className="px-4 py-3.5">
        {THREAD.map((t, i) => (
          <div key={i} className="flex gap-2.5" style={{ marginTop: i ? 10 : 0 }}>
            <span
              className="mt-[1px] flex h-[17px] w-[17px] flex-none items-center justify-center text-[8px] font-semibold uppercase"
              style={{
                fontFamily: MONO,
                background: t.you ? P.paper : P.paper3,
                border: `1px solid ${t.you ? P.ink : P.line}`,
                color: P.ink2,
              }}
            >
              {t.who.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2" style={{ fontFamily: MONO }}>
                <span className="text-[9.5px] font-semibold lowercase" style={{ color: P.ink }}>
                  {t.who}
                </span>
                <span className="text-[8.5px] tabular-nums" style={{ color: P.faint }}>
                  {t.at}
                </span>
              </div>
              <p className="mt-[2px] text-[11px] leading-[1.5]" style={{ color: P.ink2 }}>
                {t.text}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div
        className="mt-2.5 flex flex-col gap-[3px] pt-2"
        style={{ borderTop: `1px dashed ${P.line}`, fontFamily: MONO }}
      >
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: P.red }}>
          Thread · flight f-1287
        </span>
        <span className="text-[9.5px] lowercase leading-[1.5]" style={{ color: P.ink3 }}>
          four turns, one handoff, a record of all of it. no copy-paste.
        </span>
      </div>
    </div>
  );
}

/* ── 04 Layered — the dark console artifact, sprites carrying life ─────── */

const CONSOLE = {
  bg: "oklch(0.185 0.006 80)",
  edge: "oklch(0.30 0.008 80)",
  edgeSoft: "oklch(0.24 0.008 80)",
  text: "oklch(0.93 0 0)",
  muted: "oklch(0.66 0 0)",
  faint: "oklch(0.50 0 0)",
};

function DarkConsole() {
  return (
    <div className="px-7 pb-6">
      {/* dot-grid mat the console sits on — depth without decoration */}
      <div
        className="p-3.5"
        style={{
          backgroundImage: `radial-gradient(${P.line} 1px, transparent 1px)`,
          backgroundSize: "11px 11px",
        }}
      >
        <div style={{ background: CONSOLE.bg, border: `1px solid ${CONSOLE.edge}` }}>
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: `1px solid ${CONSOLE.edgeSoft}`, fontFamily: MONO }}
          >
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: CONSOLE.muted }}>
              scout · #pr-1287
            </span>
            <span className="flex items-center gap-1.5 text-[8.5px] uppercase tracking-[0.12em]" style={{ color: CONSOLE.faint }}>
              <span className="h-[5px] w-[5px] rounded-full" style={{ background: P.red }} />
              live
            </span>
          </div>
          <div className="px-4 py-3.5">
            {THREAD.map((t, i) => (
              <div key={i} className="flex gap-2.5" style={{ marginTop: i ? 11 : 0 }}>
                <SpriteAvatar
                  name={t.who === "you" ? "arach" : t.who}
                  size={20}
                  hue={t.hue}
                  tone={SPRITE_TONE}
                  glow={false}
                  className="mt-[1px] flex-none"
                />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2" style={{ fontFamily: MONO }}>
                    <span className="text-[9.5px] font-semibold lowercase" style={{ color: CONSOLE.text }}>
                      {t.who}
                    </span>
                    <span className="text-[8.5px] tabular-nums" style={{ color: CONSOLE.faint }}>
                      {t.at}
                    </span>
                  </div>
                  <p className="mt-[2px] text-[11px] leading-[1.5]" style={{ color: CONSOLE.muted }}>
                    {t.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div
        className="mt-1 flex flex-col gap-[3px] pt-2"
        style={{ borderTop: `1px dashed ${P.line}`, fontFamily: MONO }}
      >
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: P.red }}>
          Thread · flight f-1287
        </span>
        <span className="text-[9.5px] lowercase leading-[1.5]" style={{ color: P.ink3 }}>
          four turns, one handoff, a record of all of it. no copy-paste.
        </span>
      </div>
    </div>
  );
}

/* ── 03 Instrument — readouts + dot-led record rows ────────────────────── */

function StatStrip() {
  const stats = [
    { k: "record types", v: "5" },
    { k: "transports", v: "4" },
    { k: "harnesses", v: "4" },
    { k: "open flights", v: "2", live: true },
  ];
  return (
    <div className="mx-7 mb-6 flex" style={{ borderTop: `1px solid ${P.line}`, paddingTop: 14 }}>
      {stats.map((s, i) => (
        <div
          key={s.k}
          className="flex flex-1 flex-col gap-1.5"
          style={{ paddingLeft: i ? 14 : 0, marginLeft: i ? 14 : 0, borderLeft: i ? `1px solid ${P.lineSoft}` : undefined }}
        >
          <span
            className="text-[7.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ fontFamily: MONO, color: P.faint }}
          >
            {s.k}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[19px] leading-none tabular-nums" style={{ fontFamily: MONO, color: P.ink }}>
              {s.v}
            </span>
            {s.live ? <span className="h-[5px] w-[5px] rounded-full" style={{ background: P.red }} /> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function RecordRows() {
  return (
    <div className="mt-4" style={{ borderTop: `1px solid ${P.line}` }}>
      {RECORD_ROWS.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-2.5 py-[7px]"
          style={{ borderBottom: `1px solid ${P.lineSoft}`, fontFamily: MONO }}
        >
          <span
            className="h-[5px] w-[5px] flex-none rounded-full"
            style={{ background: r.live ? P.red : P.line }}
          />
          <span className="text-[10px] font-medium lowercase" style={{ color: P.ink }}>
            {r.id}
          </span>
          <span className="ml-auto text-[9.5px] lowercase" style={{ color: P.ink3 }}>
            {r.meta}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── 05 The web page — the layered language at desktop width ───────────── */

function FullPage() {
  return (
    <div
      className="w-full max-w-[1180px]"
      style={{ background: P.paper, border: `1px solid ${P.line}`, color: P.ink, fontFamily: SANS }}
    >
      {/* nav */}
      <div
        className="flex items-baseline justify-between px-10 pb-3.5 pt-5"
        style={{ borderBottom: `1px solid ${P.line}` }}
      >
        <span className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold tracking-tight">OpenScout</span>
          <span className="text-[10px]" style={{ fontFamily: MONO, color: P.faint }}>
            v0.1
          </span>
        </span>
        <span className="flex gap-6 text-[11.5px]" style={{ color: P.ink3 }}>
          <span>How it works</span>
          <span>Features</span>
          <span>Apps</span>
          <span>Docs</span>
          <span style={{ color: P.ink }}>Get started</span>
        </span>
      </div>

      {/* hero: editorial column beside the console artifact */}
      <div className="grid grid-cols-[1fr_440px] gap-12 px-10 pb-9 pt-10">
        <div>
          <h1 className="text-[46px] font-semibold leading-[1.02] tracking-[-0.025em]">
            {COPY.heroTop}
            <br />
            <span style={{ color: P.ink3 }}>{COPY.heroBottom}</span>
          </h1>
          <p className="mt-5 max-w-[52ch] text-[13.5px] leading-[1.65]" style={{ color: P.ink2 }}>
            {COPY.heroSub}
          </p>
          <p className="mt-6 text-[11px] leading-[1.5]" style={{ fontFamily: MONO, color: P.ink3 }}>
            {COPY.pain}
          </p>
          <div
            className="mt-2.5 inline-flex items-center gap-3 px-4 py-3"
            style={{ border: `1px solid ${P.ink}`, fontFamily: MONO }}
          >
            <span className="text-[12px]" style={{ color: P.faint }}>
              $
            </span>
            <span className="text-[12.5px] font-medium">{COPY.install}</span>
          </div>
          <p className="mt-3 text-[10.5px]" style={{ fontFamily: MONO, color: P.faint }}>
            macOS · Linux — Mac and iPhone apps are optional surfaces over the same runtime
          </p>
        </div>

        <div>
          <div
            className="p-3.5"
            style={{
              backgroundImage: `radial-gradient(${P.line} 1px, transparent 1px)`,
              backgroundSize: "11px 11px",
            }}
          >
            <div style={{ background: CONSOLE.bg, border: `1px solid ${CONSOLE.edge}` }}>
              <div
                className="flex items-center justify-between px-4 py-2"
                style={{ borderBottom: `1px solid ${CONSOLE.edgeSoft}`, fontFamily: MONO }}
              >
                <span
                  className="text-[9px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: CONSOLE.muted }}
                >
                  scout · #pr-1287
                </span>
                <span
                  className="flex items-center gap-1.5 text-[8.5px] uppercase tracking-[0.12em]"
                  style={{ color: CONSOLE.faint }}
                >
                  <span className="h-[5px] w-[5px] rounded-full" style={{ background: P.red }} />
                  live
                </span>
              </div>
              <div className="px-4 py-4">
                {THREAD.map((t, i) => (
                  <div key={i} className="flex gap-2.5" style={{ marginTop: i ? 12 : 0 }}>
                    <SpriteAvatar
                      name={t.who === "you" ? "arach" : t.who}
                      size={20}
                      hue={t.hue}
                      tone={SPRITE_TONE}
                      glow={false}
                      className="mt-[1px] flex-none"
                    />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2" style={{ fontFamily: MONO }}>
                        <span
                          className="text-[9.5px] font-semibold lowercase"
                          style={{ color: CONSOLE.text }}
                        >
                          {t.who}
                        </span>
                        <span className="text-[8.5px] tabular-nums" style={{ color: CONSOLE.faint }}>
                          {t.at}
                        </span>
                      </div>
                      <p className="mt-[2px] text-[11px] leading-[1.55]" style={{ color: CONSOLE.muted }}>
                        {t.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div
            className="mt-1 flex items-baseline justify-between gap-4 pt-2"
            style={{ borderTop: `1px dashed ${P.line}`, fontFamily: MONO }}
          >
            <span
              className="flex-none text-[8.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: P.red }}
            >
              Thread · flight f-1287
            </span>
            <span className="text-[9.5px] lowercase" style={{ color: P.ink3 }}>
              four turns, one handoff, a record of all of it
            </span>
          </div>
        </div>
      </div>

      {/* readouts across the fold */}
      <div className="px-10 pb-9">
        <div className="flex" style={{ borderTop: `1px solid ${P.line}`, paddingTop: 18 }}>
          {[
            { k: "record types", v: "5", d: "message · invocation · flight · delivery · binding" },
            { k: "transports", v: "4", d: "local · telegram · voice · webhook" },
            { k: "harnesses", v: "4", d: "claude · codex · cursor · pi" },
            { k: "open flights", v: "2", d: "live on this broker", live: true },
          ].map((s, i) => (
            <div
              key={s.k}
              className="flex flex-1 flex-col gap-2"
              style={{
                paddingLeft: i ? 24 : 0,
                marginLeft: i ? 24 : 0,
                borderLeft: i ? `1px solid ${P.lineSoft}` : undefined,
              }}
            >
              <span
                className="text-[8px] font-semibold uppercase tracking-[0.14em]"
                style={{ fontFamily: MONO, color: P.faint }}
              >
                {s.k}
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="text-[30px] leading-none tabular-nums"
                  style={{ fontFamily: MONO, color: P.ink }}
                >
                  {s.v}
                </span>
                {s.live ? (
                  <span className="h-[6px] w-[6px] rounded-full" style={{ background: P.red }} />
                ) : null}
              </span>
              <span className="text-[9.5px] lowercase" style={{ fontFamily: MONO, color: P.ink3 }}>
                {s.d}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* sections in two columns */}
      <div
        className="grid grid-cols-2 gap-12 px-10 py-9"
        style={{ borderTop: `1px solid ${P.line}`, background: P.paper2 }}
      >
        <div>
          <SectionLabel>{COPY.problemLabel}</SectionLabel>
          <h2 className="mt-3 text-[24px] font-semibold leading-[1.12] tracking-[-0.015em]">
            {COPY.problemTitle}
          </h2>
          <p className="mt-3 max-w-[50ch] text-[12.5px] leading-[1.65]" style={{ color: P.ink2 }}>
            {COPY.problemLead}
          </p>
        </div>
        <div>
          <SectionLabel>{COPY.recordsLabel}</SectionLabel>
          <h2 className="mt-3 text-[24px] font-semibold leading-[1.12] tracking-[-0.015em]">
            {COPY.recordsTitle}
          </h2>
          <p className="mt-3 max-w-[50ch] text-[12.5px] leading-[1.65]" style={{ color: P.ink2 }}>
            {COPY.recordsLead}
          </p>
          <RecordRows />
        </div>
      </div>

      {/* footer rule */}
      <div
        className="flex items-baseline justify-between px-10 py-4"
        style={{ borderTop: `1px solid ${P.line}`, fontFamily: MONO }}
      >
        <span className="text-[9.5px] lowercase" style={{ color: P.faint }}>
          openscout — local-first, model-neutral
        </span>
        <span className="text-[9.5px] lowercase" style={{ color: P.faint }}>
          github · docs · v0.1
        </span>
      </div>
    </div>
  );
}

/* ── Take chrome (studio canvas, outside the sheets) ───────────────────── */

function Take({
  num,
  name,
  thesis,
  children,
}: {
  num: string;
  name: string;
  thesis: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-[470px] flex-none flex-col gap-3">
      <div>
        <div className="flex items-baseline gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]">
          <span className="text-studio-ink-faint">{num}</span>
          <span className="text-studio-ink">{name}</span>
        </div>
        <p className="mt-1.5 font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">{thesis}</p>
      </div>
      {children}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function LandingLanguagePage() {
  return (
    <main className="mx-auto max-w-[1560px] px-7 py-8">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
      />
      <header className="mb-7 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · landing-language
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Landing · Design language
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The Basel bones stay in every take — paper/ink, one rationed red, Archivo + Plex Mono,
          hairlines, no shadows. What changes is the conceit the page wears instead of the RFC
          costume: nothing, the product&rsquo;s own threads, or the app&rsquo;s instrument language.
          01–03 isolated the variables and landed too bare; 04 layers them back together — depth
          from the dark console, life from the sprites, scale from the readouts — and 05 is that
          language at actual desktop width.
        </p>
      </header>

      <div className="flex flex-wrap gap-9">
        <Take
          num="01"
          name="Plain"
          thesis="The costume comes off. No §, no Fig., no protocol number — plain labels, sentence-case headlines, an unlabeled facts strip. The page stops citing itself."
        >
          <Sheet>
            <NavRow version />
            <Hero />
            <FactsStrip />
            <Section label={COPY.problemLabel} title={COPY.problemTitle} lead={COPY.problemLead} />
            <Section label={COPY.recordsLabel} title={COPY.recordsTitle} lead={COPY.recordsLead} />
          </Sheet>
        </Take>

        <Take
          num="02"
          name="Thread"
          thesis="Communication shown, not described. Real transcript excerpts are the figures; captions read like annotations. The page demonstrates the product."
        >
          <Sheet>
            <NavRow />
            <Hero />
            <Section label={COPY.problemLabel} title={COPY.problemTitle} lead={COPY.problemLead}>
              <ThreadFigure />
            </Section>
            <Section label={COPY.recordsLabel} title={COPY.recordsTitle} lead={COPY.recordsLead} />
          </Sheet>
        </Take>

        <Take
          num="03"
          name="Instrument"
          thesis="The app's gauge language on paper. Stat readouts and dot-led record rows as section texture — landing and product become one visual system."
        >
          <Sheet>
            <NavRow />
            <Hero />
            <StatStrip />
            <Section
              label={COPY.problemLabel}
              title={COPY.problemTitle}
              lead={COPY.problemLead}
              mono
            />
            <Section label={COPY.recordsLabel} title={COPY.recordsTitle} lead={COPY.recordsLead} mono>
              <RecordRows />
            </Section>
          </Sheet>
        </Take>

        <Take
          num="04"
          name="Layered"
          thesis="01's voice with the depth put back — the dark console as the page's one artifact, sprites carrying life, scale jumps in the readouts, red holding two jobs. Clean, not bare."
        >
          <Sheet>
            <NavRow version />
            <Hero big />
            <DarkConsole />
            <StatStrip />
            <Section label={COPY.problemLabel} title={COPY.problemTitle} lead={COPY.problemLead} band />
            <Section label={COPY.recordsLabel} title={COPY.recordsTitle} lead={COPY.recordsLead}>
              <RecordRows />
            </Section>
          </Sheet>
        </Take>
      </div>

      {/* ── The actual web page — 04 at desktop width ──────────────────── */}
      <div className="mt-12">
        <div className="flex items-baseline gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]">
          <span className="text-studio-ink-faint">05</span>
          <span className="text-studio-ink">The web page</span>
        </div>
        <p className="mt-1.5 max-w-prose font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">
          The layered language at real desktop proportions — editorial column beside the dark
          console, readouts across the fold, sections in two columns underneath.
        </p>
        <div className="mt-4">
          <FullPage />
        </div>
      </div>

      <div className="mt-8 max-w-prose border-t border-studio-line pt-4">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          Shared bones
        </div>
        <p className="mt-2 font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">
          Paper/ink with one rationed red per view · Archivo for prose, Plex Mono for the machine
          voice · hairline dividers, zero shadows · sentence-case headlines in the plain dev
          voice. The takes compose: 01 is the floor, 02 + 03 are ingredients, 04 is the blend —
          and the lesson of 01–03 is that bones alone read bare. The page needs one dark
          artifact, one alive thing (the sprites), and one scale jump per fold.
        </p>
      </div>
    </main>
  );
}
