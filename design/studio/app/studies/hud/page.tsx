/**
 * HUD — canonical interactive playground.
 *
 * Top: just the tool. Size toggle + panel, centered, no header chrome,
 * no floating about-aside. Bottom: research surface — engage preview
 * matrix, rules, codebase refs, engineering docs. The research section
 * is where the ongoing design discussion accretes; new material lands
 * here rather than in a sidebar.
 *
 * Geometry:
 *   compact → 420 × 520
 *   medium  → 680 × 640
 *   large   → 900 × 720
 */

"use client";

import { useState } from "react";
import {
  HudPanel,
  HudSizeToggle,
  type HudSize,
  type HudTab,
} from "@/components/hud";
import {
  ResearchBlock,
  ResearchHeader,
  SourceLinks,
} from "@/components/studio/research";

export default function HudStudyPage() {
  const [size, setSize] = useState<HudSize>("compact");
  const [tab, setTab] = useState<HudTab>("fleet");

  return (
    <main className="flex min-h-screen flex-col items-center gap-7 px-7 pt-16 pb-24">
      <HudSizeToggle size={size} onChange={setSize} />
      <div className="flex items-start justify-center">
        <HudPanel
          size={size}
          tab={tab}
          onTabChange={setTab}
          onSizeChange={setSize}
        />
      </div>

      <Research />
    </main>
  );
}

function Research() {
  return (
    <section className="mt-20 w-full max-w-[920px] font-sans text-[13px] leading-relaxed text-studio-ink-muted">
      <ResearchHeader surface="hud · macos · interactive" />

      <ResearchBlock eyebrow="engage preview matrix">
        <p className="mb-4">
          Every row across every tab carries a preview-engage scaffold.
          Click the row to expand inline; the engaged panel reveals more
          context without leaving the HUD. Detail depth scales by size.
        </p>
        <EngageMatrix />
      </ResearchBlock>

      <ResearchBlock eyebrow="open questions">
        <ul className="flex flex-col gap-2">
          <li>
            <span className="text-studio-ink">Engage panel at large:</span>{" "}
            inline-below (vertical reveal) vs right-side detail column
            (like hud-native three-column). Choice still open.
          </li>
          <li>
            <span className="text-studio-ink">Tail correlation hints:</span>{" "}
            useful at large, but needs &ldquo;similar line&rdquo;
            detection that&rsquo;s hand-wavy in a mock. May defer.
          </li>
          <li>
            <span className="text-studio-ink">
              Scout-link visibility at compact:
            </span>{" "}
            always visible (eats horizontal space) vs hover-reveal only.
          </li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="rules">
        <ul className="flex flex-col gap-2">
          <li>
            <span className="text-studio-ink">Type:</span> sans for
            everything readable, mono for chrome (eyebrows, counts,
            times, hotkeys). No serif. No display font. Inter + JBM.
          </li>
          <li>
            <span className="text-studio-ink">Accent:</span> single lime
            (
            <code className="font-mono text-[11px] text-studio-ink">
              --scout-accent
            </code>
            ) carries live · attention · selected. No per-kind hue. No
            warn/error/ok/info rainbow.
          </li>
          <li>
            <span className="text-studio-ink">Hairlines:</span> solid{" "}
            <code className="font-mono text-[11px] text-studio-ink">
              border-studio-edge
            </code>
            . No gradients. No paper grain. No glass specular.
          </li>
          <li>
            <span className="text-studio-ink">Density:</span> ladder
            collapses to 10 / 11 / 12 / 13 / 15. Five sizes total.
          </li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="source (studio library)">
        <SourceLinks
          paths={[
            "design/studio/components/hud/HudPanel.tsx",
            "design/studio/components/hud/HudFleet.tsx",
            "design/studio/components/hud/HudObserve.tsx",
            "design/studio/components/hud/HudTail.tsx",
            "design/studio/components/hud/HudSessions.tsx",
            "design/studio/components/hud/HudMasthead.tsx",
            "design/studio/components/hud/HudScoutLink.tsx",
            "design/studio/components/hud/HudActivityPulse.tsx",
            "design/studio/components/hud/mock.ts",
            "design/studio/components/hud/tokens.ts",
            "design/studio/components/hud/types.ts",
          ]}
        />
      </ResearchBlock>

      <ResearchBlock eyebrow="native hud (swift)">
        <p className="mb-3">
          The SwiftUI implementation the studio tracks. Round-trips
          land here after the studio design settles.
        </p>
        <SourceLinks
          paths={[
            "apps/macos/Sources/HUD/HUDStatusView.swift",
            "apps/macos/Sources/HUD/HUDTailView.swift",
            "apps/macos/Sources/HUD/HUDSessionsView.swift",
            "apps/macos/Sources/HUD/HUDChrome.swift",
            "apps/macos/Sources/HUD/HUDController.swift",
            "apps/macos/Sources/Services/SessionScanner.swift",
            "apps/macos/Sources/Services/HudFleetService.swift",
          ]}
        />
      </ResearchBlock>

      <ResearchBlock eyebrow="related studies">
        <SourceLinks
          paths={[
            "design/studio/app/studies/hud-compact/page.tsx",
            "design/studio/app/studies/hud-medium/page.tsx",
            "design/studio/app/studies/hud-large/page.tsx",
            "design/studio/app/studies/agent-cards/page.tsx",
            "design/studio/app/studies/hud-native/page.tsx",
            "design/studio/app/studies/standing-watch/page.tsx",
          ]}
        />
      </ResearchBlock>

      <ResearchBlock eyebrow="engineering docs">
        <SourceLinks
          paths={[
            "CLAUDE.md",
            "AGENTS.md",
            "apps/macos/docs/hud-roadmap-next.md",
            "design/studio/app/studies/hud-compact/PROPOSALS.md",
          ]}
        />
      </ResearchBlock>

      <ResearchBlock eyebrow="references">
        <p>
          Lattices type system at{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            /Users/arach/dev/lattices/apps/mac/Sources/UI/Theme.swift
          </code>{" "}
          — same Inter + JBM ladder; informed the size-collapse to
          10/11/12/13/15. The lattices palette is cool-neutral with
          multi-color action accents; OpenScout deliberately diverges
          to warm canvas + single lime.
        </p>
      </ResearchBlock>
    </section>
  );
}

// ─── Engage preview matrix ──────────────────────────────────────────

const MATRIX_COLS: { size: HudSize; label: string; sub: string }[] = [
  { size: "compact", label: "compact", sub: "~80–120pt detail" },
  { size: "medium", label: "medium", sub: "~140–200pt detail" },
  { size: "large", label: "large", sub: "~220–300pt detail" },
];

const MATRIX_ROWS: {
  tab: HudTab;
  label: string;
  cells: [string, string, string];
}[] = [
  {
    tab: "fleet",
    label: "Fleet",
    cells: [
      "full work item · last 3 actions w/ ago · current state w/ duration",
      "+ capabilities · 24-step activity pulse · branch · cwd · linked flight chip",
      "+ last 3 message excerpts · recent files touched · selector · prominent scout link",
    ],
  },
  {
    tab: "observe",
    label: "Observe",
    cells: [
      "full title · summary · source agent · kind · flight id",
      "+ related events (2 nearby in same flight) · turn buffer position",
      "+ 3-turn conversation context (this/prev/next) · related agents · drill-into-thread chip",
    ],
  },
  {
    tab: "tail",
    label: "Tail",
    cells: [
      "full raw line · ±1 surrounding lines (ink-faint) · source agent",
      "+ ±2 surrounding lines · kind detail · scout link anchored at timestamp",
      "+ ±5 lines · correlation hints (similar lines, related flight id)",
    ],
  },
  {
    tab: "sessions",
    label: "Sessions",
    cells: [
      "8-line pane preview · CWD · last command",
      "+ attached client · uptime · 3–5 recent commands",
      "+ window/pane breakdown · activity timeline · tmux-attach chip · last 10 commands",
    ],
  },
];

function EngageMatrix() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-studio-edge">
            <th className="w-[90px] py-2 align-bottom font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              · entity
            </th>
            {MATRIX_COLS.map((c) => (
              <th
                key={c.size}
                className="py-2 align-bottom font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint"
              >
                <div className="text-studio-ink">{c.label}</div>
                <div className="mt-0.5 font-normal normal-case tracking-normal text-studio-ink-faint">
                  {c.sub}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX_ROWS.map((row) => (
            <tr
              key={row.tab}
              className="border-b border-studio-edge align-top"
            >
              <td className="py-3 pr-3 font-sans text-[13px] font-semibold text-studio-ink">
                {row.label}
              </td>
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className="py-3 pr-4 text-studio-ink-muted"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
