"use client";

import { PrAssignReviewStudy } from "@/views/pr-assign-review";
import { StudyHeader } from "@/components/StudyHeader";

/**
 * Studio: Assign for review as a MessageComposer with PR context.
 * Production PullRequestAssignDialog is still the old form — port after sign-off.
 */
export default function PrAssignReviewPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="studies · web · repos" title="Repos · Assign for review">
        Second take: drop the custom dark form. This is a{" "}
        <a
          href="/atoms/message-composer"
          className="font-medium text-studio-ink underline decoration-studio-edge underline-offset-2 hover:decoration-studio-ink/50"
        >
          MessageComposer
        </a>
        {" "}with PR context in the header, runtime in the toolbar, and the review brief as the body.
        Defaults stay quiet. Studio only.
      </StudyHeader>

      <PrAssignReviewStudy />
    </main>
  );
}
