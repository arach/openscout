"use client";

import { DispatchAskComposerStudy } from "@/views/dispatch-ask-composer";
import { StudyHeader } from "@/components/StudyHeader";

/**
 * Studio: the Dispatch inspector's "Ask another agent" composer, re-cut.
 * Production BrokerScreen still ships the crowded single-row footer — port
 * only after a treatment is signed off.
 */
export default function DispatchAskComposerPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="studies · web · dispatch" title="Dispatch · Ask another agent">
        The inspector&apos;s ask module puts a context marker, a{" "}
        <strong className="font-medium text-studio-ink">Send to</strong> label, four routing selects,
        a mic and Send on one row at 520px — and clips all four selects to make it fit. Baseline plus
        three treatments, each at 520px and 380px. Studio only.
      </StudyHeader>

      <DispatchAskComposerStudy />
    </main>
  );
}
