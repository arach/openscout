"use client";

import { PrAssignReviewStudy } from "@/views/pr-assign-review";

/**
 * Studio: Assign for review as a MessageComposer with PR context.
 * Production PullRequestAssignDialog is still the old form — port after sign-off.
 */
export default function PrAssignReviewPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · repos
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Repos · Assign for review
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Second take: drop the custom dark form. This is a{" "}
          <a
            href="/atoms/message-composer"
            className="font-medium text-studio-ink underline decoration-studio-edge underline-offset-2 hover:decoration-studio-ink/50"
          >
            MessageComposer
          </a>
          {" "}with PR context in the header, runtime in the toolbar, and the review brief as the body.
          Defaults stay quiet. Studio only.
        </p>
      </header>

      <PrAssignReviewStudy />
    </main>
  );
}
