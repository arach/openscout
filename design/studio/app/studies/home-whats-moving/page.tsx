"use client";

import { HomeWhatsMovingStudy } from "@/views/home-whats-moving";
import { StudyHeader } from "@/components/StudyHeader";

/**
 * Studio-only exploration of the Home "What's Moving" strip.
 * No packages/web wiring yet — pick a take here first.
 */
export default function HomeWhatsMovingPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader
        eyebrow="studies · web · home"
        title={<>Home · What&apos;s Moving</>}
      >
        Chosen direction: <strong className="text-studio-ink font-medium">signal first, groupable</strong>.
        The row is the live action; agent demotes; one Observe. The existing
        Recent / Grouped control stays — Recent is a flat recency stream,
        Grouped wraps the same rows under project bands. Control remains as
        the problem-flagged shipped strip for contrast. Studio only until we
        port it.
      </StudyHeader>

      <HomeWhatsMovingStudy />
    </main>
  );
}
