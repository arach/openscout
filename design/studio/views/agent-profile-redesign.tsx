"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Scout · Agent Profile — redesign directions  (one page, switchable)

   The live profile is a mess: ballooning facet grid, dead canvas, and a rail
   that re-prints the center's facts. Three serious takes, all in the Instrument
   language, switchable in place so there's no page-hopping to compare:

     Before   — the real screen capture, for reference
     Cockpit  — leads with live state; identity demoted        (../agent-profile-cockpit)
     Dossier  — composed editorial page; facts as def-lists     (../agent-profile-dossier)
     Modular  — dense module bands that fill the canvas          (../agent-profile-modular)

   Each direction's window is reused from its own study via the exported `Frame`.
   ─────────────────────────────────────────────────────────────────────────── */

import React from "react";
import { Frame as CockpitFrame } from "./agent-profile-cockpit";
import { Frame as DossierFrame } from "./agent-profile-dossier";
import { Frame as ModularFrame } from "./agent-profile-modular";

type Tab = "before" | "cockpit" | "dossier" | "modular";

const TABS: Array<{ id: Tab; label: string; note: string }> = [
  { id: "cockpit", label: "Cockpit", note: "Leads with what the agent is doing — live state band, context gauge, last-activity pulse. Identity demoted to a strip." },
  { id: "dossier", label: "Dossier", note: "The profile as a composed page — masthead, facts as aligned definition lists under hairline rules, a foot-pinned status line." },
  { id: "modular", label: "Modular", note: "Dense control surface — compact header, one metadata strip, then module bands (Now · Recent work · Conversations · Presence) that fill the canvas." },
  { id: "before", label: "Before", note: "The live profile today — ballooning facet grid, dead canvas below, rail repeating State · Identity · Project." },
];

export default function AgentProfileRedesignPage() {
  const [tab, setTab] = React.useState<Tab>("cockpit");
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-profile-redesign
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent Profile · redesign directions
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Three serious takes on the Agents → profile surface, switchable in place. All kill the
          ballooning grid + dead canvas and split the panes cleanly (center owns the facts, the rail
          is a live Instrument — no duplication). Flip between them; no page-hopping.
        </p>
      </header>

      {/* switcher */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-[5px] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                on
                  ? "bg-studio-surface text-studio-ink"
                  : "text-studio-ink-faint hover:text-studio-ink"
              }`}
              style={on ? { border: "1px solid var(--scout-accent)" } : { border: "1px solid transparent" }}
            >
              {t.label}
            </button>
          );
        })}
        <a
          href={tab === "before" ? undefined : `/studies/agent-profile-${tab}`}
          className={`ml-auto font-mono text-[9px] uppercase tracking-[0.12em] ${
            tab === "before" ? "pointer-events-none opacity-30" : "text-studio-ink-faint hover:text-studio-ink"
          }`}
        >
          open standalone ↗
        </a>
      </div>

      <p className="mb-4 max-w-prose font-sans text-[12px] leading-relaxed text-studio-ink-faint">
        {active.note}
      </p>

      {/* stage */}
      <div>
        {tab === "before" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/studies/agent-profile-before.png"
            alt="Live Agents → profile capture, before the redesign"
            className="block w-full rounded-lg"
            style={{ border: "1px solid oklch(0.27 0.008 80)" }}
          />
        ) : tab === "cockpit" ? (
          <CockpitFrame />
        ) : tab === "dossier" ? (
          <DossierFrame />
        ) : (
          <ModularFrame />
        )}
      </div>

      <section className="mt-9 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-studio-ink-faint">
          Recommendation
        </div>
        <p className="font-sans text-[12px] leading-relaxed text-studio-ink-faint">
          Build on <span style={{ color: "var(--studio-ink)" }}>Cockpit</span> — a profile for a live
          agent should answer &ldquo;what&apos;s happening&rdquo; before &ldquo;who is this,&rdquo; and
          it&apos;s the most aligned with Scout&apos;s steering / calm-ambient philosophy. Graft
          <span style={{ color: "var(--studio-ink)" }}> Dossier&apos;s</span> definition-list discipline
          + foot-pinned status line for a legible identity band, and
          <span style={{ color: "var(--studio-ink)" }}> Modular&apos;s</span> full-width bands so it
          never voids on a sparse agent.
        </p>
      </section>
    </main>
  );
}
