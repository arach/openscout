"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-run link that uses a React transition so the previous UI stays
 * mounted while the new render streams in, and pulses while it's pending.
 *
 * Used by the workbench's three re-run affordances (header "re-run all",
 * in-CommandSurface re-run, per-trace-row re-run).
 */
export function RerunLink({
  href,
  className,
  pendingClassName = "animate-pulse text-status-info-fg",
  title,
  children,
  pendingLabel,
}: {
  href: string;
  className?: string;
  pendingClassName?: string;
  title?: string;
  children: ReactNode;
  /** Optional swap-in label while the navigation is pending. */
  pendingLabel?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick(e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  }

  return (
    <a
      href={href}
      onClick={onClick}
      title={title}
      className={[className, isPending ? pendingClassName : ""]
        .filter(Boolean)
        .join(" ")}
      aria-busy={isPending || undefined}
    >
      {isPending && pendingLabel ? pendingLabel : children}
    </a>
  );
}
