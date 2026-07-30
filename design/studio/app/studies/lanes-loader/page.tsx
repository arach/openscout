"use client";

import { LanesLoaderStudy } from "@/views/lanes-loader";
import { StudyHeader } from "@/components/StudyHeader";

/**
 * Studio: the beat before the Agent Lanes deck exists. Four treatments of the
 * loading state, played against real load-phase timelines. Studio only until a
 * take is signed off and ported to AgentLanesView's loading state.
 */
export default function LanesLoaderPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="studies · web · lanes" title="Agent Lanes · loader">
        Opening <code>/ops/lanes</code> costs two requests — a transcript scan and a tail replay —
        and the wait is currently a console card whose three rows say the same thing at 80ms as they
        do at 2.4s. These takes make the beat report: measured phase timings, counters that tick,
        discovered identities landing as they resolve, and — in the back two — the deck drawn before
        it has anything to put in it. Every number is a field the client already holds; the four
        places where no signal exists are named rather than filled.
      </StudyHeader>

      <LanesLoaderStudy />
    </main>
  );
}
