import type { ReactNode } from "react";
import type { CommandRun } from "@/lib/studio/command";

/**
 * Chrome around a single command run.
 *
 * Owns: copyable shell line, ran/cached/duration/error badge, output frame,
 * optional footnote. Does NOT own the output body — the consumer provides JSX
 * (or uses a renderer from `lib/studio/renderers`).
 */
export function CommandSurface({
  shell,
  run,
  body,
  footnote,
  rerunHref,
}: {
  shell: string;
  run: Pick<CommandRun<unknown>, "durationMs" | "cached" | "error">;
  body: ReactNode;
  footnote?: ReactNode;
  /** When provided, renders a "re-run" link that navigates to this URL. */
  rerunHref?: string;
}) {
  const badge = run.error
    ? { label: "● error", tone: "text-status-error-fg" }
    : run.cached
      ? { label: "● cached", tone: "text-studio-ink-faint" }
      : { label: `● ran ${run.durationMs} ms`, tone: "text-status-ok-fg" };

  return (
    <div className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
      <div className="flex items-center justify-between gap-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          command
        </span>
        <span className="flex items-center gap-2">
          {rerunHref ? (
            <a
              href={rerunHref}
              className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint underline-offset-4 hover:text-studio-ink hover:underline"
              title="Force re-run, bypassing the cache"
            >
              re-run ↻
            </a>
          ) : null}
          <span className={`font-mono text-[9px] uppercase tracking-eyebrow ${badge.tone}`}>
            {badge.label}
          </span>
        </span>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-studio-ink">
        $ {shell}
      </pre>

      <div className="border-t border-studio-edge bg-studio-canvas-alt px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        output
      </div>
      {run.error ? (
        <pre className="overflow-x-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-status-error-fg">
          {run.error}
        </pre>
      ) : (
        body
      )}

      {footnote ? (
        <div className="border-t border-studio-edge bg-studio-canvas-alt px-3 py-2 font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}
