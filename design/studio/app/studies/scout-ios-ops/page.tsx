"use client";

import { useState } from "react";
import { SurfaceLab, OpsSurface } from "@/components/scout-ios";

export default function ScoutIOSOpsStudy() {
  // Ops folds Tail + Terminal into one "raw truth" destination: defaults to
  // Tail (the live firehose), with a Terminal toggle. New is contextual, so the
  // masthead compose "+" is absent here — "new" means nothing on Ops.
  const [view, setView] = useState<"tail" | "terminal">("tail");
  return (
    <SurfaceLab
      surface="ops"
      title="Scout iOS · Ops"
      blurb="Tail and Terminal fold into one destination — both are where you drop when the abstraction stops being trustworthy. Ops opens on Tail (the live firehose); the TERMINAL toggle drops into the shell. Note the bar: Home · Comms · Agents · Ops — four places you go. New isn't a tab; it's the persistent compose '+' in the masthead, which is hidden here because 'new' is meaningless on Ops."
      source="apps/ios/Scout/TailSurface.swift + TerminalSurface.swift (merge target)"
      treatments={[
        {
          id: "ops",
          label: "Ops",
          note: "Defaults to Tail — the monochrome firehose, attribution as dim mono. The TERMINAL toggle (top-right) drops into the shell, one tap away. One destination for both raw-truth surfaces; Terminal no longer needs its own tab.",
          body: <OpsSurface view={view} onView={setView} />,
        },
      ]}
    />
  );
}
