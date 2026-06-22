/**
 * HUD Compact — locked reference at the compact (420 × 520) size.
 *
 * Stacks all four tabs in one scroll so reviewers can read the whole
 * vocabulary in one pass instead of clicking through the interactive
 * playground at `/studies/hud`. Renders from the shared component
 * library at `components/hud/`.
 */

import { HudPanel, type HudTab } from "@/components/hud";
import {
  ResearchBlock,
  ResearchHeader,
  SourceLinks,
} from "@/components/studio/research";

const TABS: HudTab[] = ["agents", "activity", "tail", "sessions"];

export default function HudCompactPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · hud-compact
        </div>
        <h1 className="mt-1 font-sans text-[28px] font-semibold leading-none tracking-tight text-studio-ink">
          HUD Compact
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Locked reference at the compact size — a ~420px column the
          operator summons over any window. All four tabs (agents ·
          activity · tail · sessions) stacked here for one-pass review.
          The interactive playground with size + tab switching lives at{" "}
          <em>/studies/hud</em>.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {TABS.map((t) => (
          <HudPanel key={t} size="compact" tab={t} />
        ))}
      </div>

      <Research />
    </main>
  );
}

function Research() {
  return (
    <section className="mt-20 w-full max-w-[920px] font-sans text-[13px] leading-relaxed text-studio-ink-muted">
      <ResearchHeader surface="hud · macos · compact" />

      <ResearchBlock eyebrow="tier notes">
        <ul className="flex flex-col gap-2">
          <li>
            <span className="text-studio-ink">Width:</span> 420 × 520 —
            the summon target. Fits over any window without crowding.
          </li>
          <li>
            <span className="text-studio-ink">Masthead 4-tab fit:</span>{" "}
            measured — mark + four tabs + three separators + attention
            pip occupy ~336 / 388 inner pixels with ~52px slack. No
            abbreviation needed at this size.
          </li>
          <li>
            <span className="text-studio-ink">Scout link visibility:</span>{" "}
            trailing ↗ chip hides until row hover to preserve horizontal
            real estate.
          </li>
          <li>
            <span className="text-studio-ink">Engage panel:</span> inline
            reveal below the engaged row. Detail depth at this tier is
            the shallowest of the three — see the matrix on{" "}
            <em>/studies/hud</em>.
          </li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="source">
        <SourceLinks
          paths={[
            "design/studio/components/hud/HudPanel.tsx",
            "design/studio/components/hud/HudAgents.tsx",
            "design/studio/components/hud/HudActivity.tsx",
            "design/studio/components/hud/HudTail.tsx",
            "design/studio/components/hud/HudSessions.tsx",
            "design/studio/components/hud/tokens.ts",
          ]}
        />
      </ResearchBlock>

      <ResearchBlock eyebrow="native hud (swift)">
        <p className="mb-3">
          Compact is the shipped form. Native HUD source:
        </p>
        <SourceLinks
          paths={[
            "apps/macos/Sources/HUD/HUDStatusView.swift",
            "apps/macos/Sources/HUD/HUDTailView.swift",
            "apps/macos/Sources/HUD/HUDSessionsView.swift",
            "apps/macos/Sources/HUD/HUDChrome.swift",
          ]}
        />
      </ResearchBlock>

      <ResearchBlock eyebrow="related">
        <SourceLinks
          paths={[
            "design/studio/app/studies/hud/page.tsx",
            "design/studio/app/studies/hud-medium/page.tsx",
            "design/studio/app/studies/hud-large/page.tsx",
          ]}
        />
      </ResearchBlock>
    </section>
  );
}
