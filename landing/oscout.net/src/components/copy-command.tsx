"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { trackCommandCopy } from "@/lib/analytics";

export function CopyCommand({
  analyticsLocation = "copy_command",
  command,
}: {
  analyticsLocation?: string;
  command: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    trackCommandCopy({
      command,
      location: analyticsLocation,
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="group inline-flex h-11 max-w-full items-center gap-3 overflow-hidden rounded-full border border-[var(--site-border)] bg-[var(--site-surface-strong)] px-4 font-mono text-[13px] text-[var(--site-ink)] shadow-sm transition-all hover:border-[var(--site-border-strong)] hover:bg-[var(--site-panel)] hover:shadow-md"
    >
      <span className="shrink-0 text-[var(--site-muted)]">$</span>
      <span className="truncate">{command}</span>
      <span className="ml-1 shrink-0 text-[var(--site-muted)] transition-colors group-hover:text-[var(--site-copy)]">
        {copied ? <Check className="h-3.5 w-3.5 text-[var(--site-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

export function CopyCommandBlock({
  analyticsLocation = "copy_command_block",
  command,
  label,
}: {
  analyticsLocation?: string;
  command: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    trackCommandCopy({
      command,
      location: analyticsLocation,
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,24rem)_1fr]">
      <button
        onClick={copy}
        className="group flex min-h-12 items-center justify-between rounded-xl border border-[var(--site-border)] bg-[var(--site-surface-strong)] px-4 py-3 font-mono text-[13px] text-[var(--site-ink)] shadow-sm transition-colors hover:border-[var(--site-border-strong)] hover:bg-[var(--site-panel)]"
      >
        <span className="text-left leading-relaxed">
          <span className="text-[var(--site-muted)]">$ </span>
          <span>{command}</span>
        </span>
        <span className="ml-3 shrink-0 text-[var(--site-muted)] transition-colors group-hover:text-[var(--site-copy)]">
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--site-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
        </span>
      </button>
      {label && <p className="pt-1 text-[13px] leading-relaxed text-[var(--site-copy)]">{label}</p>}
    </div>
  );
}
