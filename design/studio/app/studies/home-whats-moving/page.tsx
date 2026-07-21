"use client";

import { HomeWhatsMovingStudy } from "@/views/home-whats-moving";

/**
 * Studio-only exploration of the Home "What's Moving" strip.
 * No packages/web wiring yet — pick a take here first.
 */
export default function HomeWhatsMovingPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · home
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Home · What&apos;s Moving
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Chosen direction: <strong className="text-studio-ink font-medium">signal first, groupable</strong>.
          The row is the live action; agent demotes; one Observe. The existing
          Recent / Grouped control stays — Recent is a flat recency stream,
          Grouped wraps the same rows under project bands. Control remains as
          the problem-flagged shipped strip for contrast. Studio only until we
          port it.
        </p>
      </header>

      <HomeWhatsMovingStudy />
    </main>
  );
}
