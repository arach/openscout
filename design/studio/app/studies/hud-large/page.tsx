/**
 * HUD Large — locked reference at the large (900 × 720) size.
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

export default function HudLargePage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · hud-large
        </div>
        <h1 className="mt-1 font-sans text-[28px] font-semibold leading-none tracking-tight text-studio-ink">
          HUD Large
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Locked reference at the large size — a ~900px panel where the
          operator has the most horizontal room for the same vocabulary.
          Fleet returns to a single-column row layout; observe&apos;s
          time gutter widens for the stacked relative + absolute
          timestamp; tail keeps its dense mono firehose; sessions keep
          the 3-line pane peek. All four tabs stacked here for one-pass
          review.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {TABS.map((t) => (
          <HudPanel key={t} size="large" tab={t} />
        ))}
      </div>

      <Research />
    </main>
  );
}

function Research() {
  return (
    <section className="mt-20 w-full max-w-[920px] font-sans text-[13px] leading-relaxed text-studio-ink-muted">
      <ResearchHeader surface="hud · macos · large" />

      <ResearchBlock eyebrow="tier notes">
        <ul className="flex flex-col gap-2">
          <li>
            <span className="text-studio-ink">Width:</span> 900 × 720 —
            the workspace tier. Horizontal room is the unlock, not row
            packing.
          </li>
          <li>
            <span className="text-studio-ink">Fleet:</span> single-column
            rows again at full panel width. Pulse stretches; work item
            + last action get more characters before truncation.
          </li>
          <li>
            <span className="text-studio-ink">Observe:</span> wider time
            gutter holds stacked relative + absolute timestamp; dispatch
            column wins the extra room.
          </li>
          <li>
            <span className="text-studio-ink">Tail:</span> same firehose
            row; raw line gets the full width.
          </li>
          <li>
            <span className="text-studio-ink">Sessions:</span> pane peek
            stays 3 lines but card frame gets more breathing room.
          </li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="open at this tier">
        <ul className="flex flex-col gap-2">
          <li>
            <span className="text-studio-ink">
              Engage panel: inline vs side column.
            </span>{" "}
            At 900w, the engaged detail could either reveal below the
            row (consistent with compact/medium) or open a right-side
            detail column (closer to <em>hud-native</em>&apos;s
            three-column shape). Not yet decided.
          </li>
          <li>
            <span className="text-studio-ink">
              Tail correlation hints:
            </span>{" "}
            similar-line detection would shine at this width but the
            logic is hand-wavy in a mock. Likely defer.
          </li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="status">
        <p>
          Large tier is studio-only — no SwiftUI counterpart yet.
          Compact is the shipped form. This study anchors what the
          SwiftUI port should look like at workspace width.
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
            "design/studio/app/studies/hud-medium/page.tsx",
            "design/studio/app/studies/hud-native/page.tsx",
          ]}
        />
      </ResearchBlock>
    </section>
  );
}
