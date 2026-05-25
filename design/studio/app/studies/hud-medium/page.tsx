/**
 * HUD Medium — locked reference at the medium (680 × 640) size.
 *
 * Stacks all four tabs in one scroll. Renders from the shared component
 * library at `components/hud/`.
 */

import { HudPanel, type HudTab } from "@/components/hud";
import {
  ResearchBlock,
  ResearchHeader,
  SourceLinks,
} from "@/components/studio/research";

const TABS: HudTab[] = ["fleet", "observe", "tail", "sessions"];

export default function HudMediumPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · hud-medium
        </div>
        <h1 className="mt-1 font-sans text-[28px] font-semibold leading-none tracking-tight text-studio-ink">
          HUD Medium
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Locked reference at the medium size — a ~680px panel where
          the operator has room to see more state per item without
          drilling in. Fleet becomes a 2-up tile grid; observe widens
          its time gutter and dispatch column; tail (firehose) keeps
          its dense mono row; sessions become cards with a 3-line pane
          peek. All four tabs stacked here for one-pass review.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {TABS.map((t) => (
          <HudPanel key={t} size="medium" tab={t} />
        ))}
      </div>

      <Research />
    </main>
  );
}

function Research() {
  return (
    <section className="mt-20 w-full max-w-[920px] font-sans text-[13px] leading-relaxed text-studio-ink-muted">
      <ResearchHeader surface="hud · macos · medium" />

      <ResearchBlock eyebrow="tier notes">
        <ul className="flex flex-col gap-2">
          <li>
            <span className="text-studio-ink">Width:</span> 680 × 640 —
            the step between compact&apos;s summon column and the
            workspace-grade large tier. Density up by area, not packing.
          </li>
          <li>
            <span className="text-studio-ink">Fleet:</span> 2-up tiles
            with internal stat block. Activity pulse gets its own
            labeled row inside each tile.
          </li>
          <li>
            <span className="text-studio-ink">Observe:</span> time
            gutter stacks relative + absolute; dispatch carries byline
            + two-line summary + drilling meta row.
          </li>
          <li>
            <span className="text-studio-ink">Tail:</span> firehose row
            unchanged in structure; size bumps slightly so the raw line
            is easier to read at the wider width.
          </li>
          <li>
            <span className="text-studio-ink">Sessions:</span> 3-line
            pane preview on canvas-alt fill, hairline border. CWD
            appended to meta line.
          </li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="status">
        <p>
          Medium tier is studio-only — no SwiftUI counterpart yet.
          Compact is the shipped form; this study anchors what the
          SwiftUI port should look like when the panel grows past
          ~520px wide.
        </p>
      </ResearchBlock>

      <ResearchBlock eyebrow="source">
        <SourceLinks
          paths={[
            "design/studio/components/hud/HudPanel.tsx",
            "design/studio/components/hud/HudFleet.tsx",
            "design/studio/components/hud/HudObserve.tsx",
            "design/studio/components/hud/HudTail.tsx",
            "design/studio/components/hud/HudSessions.tsx",
            "design/studio/components/hud/tokens.ts",
          ]}
        />
      </ResearchBlock>

      <ResearchBlock eyebrow="related">
        <SourceLinks
          paths={[
            "design/studio/app/studies/hud/page.tsx",
            "design/studio/app/studies/hud-compact/page.tsx",
            "design/studio/app/studies/hud-large/page.tsx",
            "design/studio/app/studies/agent-cards/page.tsx",
          ]}
        />
      </ResearchBlock>
    </section>
  );
}
