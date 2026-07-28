/**
 * ASCII Render Lab — study route.
 *
 * The instrument for the scout.local portal ornament. See
 * `views/ascii-render-lab.tsx` for the pipeline and why it renders artwork
 * rather than constructing shapes in ASCII.
 */

import { AsciiRenderLab } from "@/views/ascii-render-lab";
import { StudyHeader } from "@/components/StudyHeader";

export default function AsciiRenderLabPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader
        eyebrow="studies · web · ascii-render-lab"
        title="ASCII render lab"
      >
        The ornament is a <b>render of real artwork</b>, never a shape
        constructed inside ASCII constraints:{" "}
        <code className="font-mono text-sm text-studio-ink">
          svg → rasterise → sample per cell → filter → shimmer → quantise
        </code>
        . Source paths come from{" "}
        <code className="font-mono text-sm text-studio-ink">
          design/logo-attempts/focused-03-wire-cube-mark.svg
        </code>
        . Because step one rasterises, isometric and 30° edges antialias for
        free — no edge angle is off-limits the way it is when placing glyphs by
        hand. Every param lives in the URL hash, so any render is a shareable
        link.
      </StudyHeader>

      <AsciiRenderLab />

      <section className="mt-10 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · baked in, not exposed
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Two rules are findings rather than preferences, both inherited from{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            design/portal-studies/README.md
          </code>
          . The shimmer modulates <b>coverage before quantisation</b>, never
          brightness after — modulating the field makes structure travel, while
          modulating the output just eats holes in the thing it is meant to
          animate. And the dither is <b>ordered, not random</b>: a regular
          threshold lattice holds dots on their grid while the field moves
          underneath, where random thresholding boils.
        </p>
      </section>
    </main>
  );
}
