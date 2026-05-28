/**
 * HUD Assistant — study for slot 5.
 *
 * Slot 5 is the desktop conversation surface for the same Scout that
 * lives on iOS (project-hud-slot5-scout-surface). This study locks the
 * panel to the `assistant` tab and stacks the three tiers (S / M / L)
 * so a single scroll reads the surface end-to-end before we port to
 * Swift.
 *
 * Inline rendering exercised by the seeded thread:
 *   · /command chips
 *   · @mention in scout-accent
 *   · file path in path-hue
 *   · `code span` in ink + medium weight
 *
 * Large adds a 300px context rail on the right — quick commands,
 * on-you mentions, recent asks. Routes that become real once the
 * dock is wired.
 */

import { HudPanel } from "@/components/hud";

export default function HudAssistantPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · hud-assistant
        </div>
        <h1 className="mt-1 font-sans text-[28px] font-semibold leading-none tracking-tight text-studio-ink">
          HUD Assistant
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Slot 5 — a desktop view of the same Scout that lives on iOS.
          One persistent thread, context-aware dock routing, and the
          natural home for `/` commands and `@` agent completion. The
          tab label stays neutral (&ldquo;assistant&rdquo;); the robot
          glyph carries the brand identity inside the masthead and on
          every message Scout files. Three tiers stacked below for
          one-pass review before the Swift port.
        </p>
      </header>

      <div className="flex flex-col gap-7">
        <Tier label="compact · 420×520" size="compact" />
        <Tier label="medium · 680×640" size="medium" />
        <Tier label="large · 1280×920" size="large" />
      </div>
    </main>
  );
}

function Tier({
  label,
  size,
}: {
  label: string;
  size: "compact" | "medium" | "large";
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </div>
      <HudPanel size={size} tab="assistant" />
    </section>
  );
}
