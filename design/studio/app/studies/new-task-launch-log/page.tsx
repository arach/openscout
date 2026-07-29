"use client";

import { NewTaskLaunchLogStudy } from "@/views/new-task-launch-log";
import { StudyHeader } from "@/components/StudyHeader";

/**
 * Studio: the beat between submitting a New task and the conversation being
 * live, redesigned from a spinner into a launch ledger. Studio only until a
 * treatment is signed off and ported to the web NewChatComposer flow.
 */
export default function NewTaskLaunchLogPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="studies · web · dispatch" title="New task · launch log">
        After send, the New task modal shows a spinner, then dumps you on a{" "}
        <em>Queued</em> placeholder while eleven real pipeline stages happen invisibly. This study
        replaces that beat with a terminal-flavored launch ledger: the actual control events and
        dispatch stages, logged as they complete, fast enough to feel like one confident cascade.
        A readout — not a terminal, and never a call to action.
      </StudyHeader>

      <NewTaskLaunchLogStudy />
    </main>
  );
}
