import { AsciiOrb } from "@/components/AsciiOrb";
import { ScoutMark } from "@/components/ScoutMark";

/**
 * LandingIdentity — the studio home masthead.
 *
 * Gives the overview page a product face: wire-cube mark, wordmark, a short
 * lede, and a shimmering ASCII orb so the top of the page feels authored
 * rather than like a bare inventory index.
 */
export function LandingIdentity() {
  return (
    <header className="landing-id mb-10 border-b border-studio-edge pb-7">
      <div className="landing-id__grid">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="landing-id__mark" aria-hidden>
              <ScoutMark size={36} />
            </span>
            <div className="min-w-0">
              <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                · openscout · studio
              </div>
              <h1 className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-studio-ink">
                Overview
              </h1>
            </div>
          </div>

          <p className="mt-4 max-w-prose font-sans text-lg leading-relaxed text-studio-ink-faint">
            A planning + design surface that sits next to the codebase.
            Markdown plans render here; design studies live as routes; the
            atoms gallery shows shared web primitives in isolation.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="landing-id__pulse" aria-hidden />
              local
            </span>
            <span aria-hidden>·</span>
            <span>plans · studies · atoms</span>
            <span aria-hidden>·</span>
            <span>next to the code</span>
          </div>
        </div>

        <div className="landing-id__orb">
          <AsciiOrb />
        </div>
      </div>
    </header>
  );
}
