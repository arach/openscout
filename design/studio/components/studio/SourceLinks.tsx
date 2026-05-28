"use client";

/**
 * SourceLinks — list of repo-relative file paths that open the
 * SourceFileViewer drawer on click. Replaces the old cursor:// anchor
 * list as the default affordance. Cursor jump-out still lives inside
 * the drawer chrome.
 */

import { useState } from "react";
import { SourceFileViewer } from "./SourceFileViewer";

export function SourceLinks({ paths }: { paths: string[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-1 font-mono text-[11px] leading-relaxed text-studio-ink-faint">
        {paths.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => setOpen(p)}
              className="text-left underline decoration-studio-edge underline-offset-2 transition-colors hover:text-studio-ink hover:decoration-scout-accent"
            >
              {p}
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <SourceFileViewer path={open} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
