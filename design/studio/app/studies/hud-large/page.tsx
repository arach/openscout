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

const TABS: HudTab[] = ["agents", "activity", "tail", "sessions"];

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
          At this tier every tab adopts a two-pane treatment: list on
          the left, detail panel pinned on the right. Click a row to
          swap the detail; Esc closes back to the previous selection.
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
            <span className="text-studio-ink">Agents:</span> three
            panes — roster (A), context (B), last turn (C). Selection
            in A swaps B + C.
          </li>
          <li>
            <span className="text-studio-ink">Activity:</span> two
            panes — time-bucketed ledger left, event detail right.
            Detail surfaces category, kind, full body, byline, and
            drill links (open thread / follow execution / agent
            profile).
          </li>
          <li>
            <span className="text-studio-ink">Tail:</span> two panes —
            firehose stream left, raw-line + ±1 neighbors right. The
            stream stays single-line mono; the detail unpacks the
            current line.
          </li>
          <li>
            <span className="text-studio-ink">Sessions:</span> two
            panes — session ledger left, session detail right. Detail
            shows lifecycle grid, last turn, harness + model.
          </li>
        </ul>
      </ResearchBlock>

      <ResearchBlock eyebrow="open at this tier">
        <ul className="flex flex-col gap-2">
          <li>
            <span className="text-studio-ink">
              Tail correlation hints:
            </span>{" "}
            similar-line detection would shine at this width but the
            logic is hand-wavy in a mock. Likely defer.
          </li>
          <li>
            <span className="text-studio-ink">
              Sessions ledger sort order:
            </span>{" "}
            currently most-recently-active first. Group by status
            (running / idle / ended) is a real candidate at large.
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
            "design/studio/components/hud/HudAgents.tsx",
            "design/studio/components/hud/HudActivity.tsx",
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
