"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="group inline-flex h-10 items-center gap-3 rounded-md border border-border-strong bg-surface px-4 font-mono text-[13px] transition-all hover:border-accent/30 hover:bg-surface-elevated"
    >
      <span className="text-muted">$</span>
      <span className="text-foreground">{command}</span>
      <span className="ml-1 text-muted transition-colors group-hover:text-secondary">
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

export function CopyCommandBlock({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid items-center gap-3 sm:grid-cols-[420px_1fr]">
      <button
        onClick={copy}
        className="group flex items-center justify-between rounded-md border border-border-strong bg-surface px-4 py-2.5 font-mono text-[13px] transition-all hover:border-accent/30 hover:bg-surface-elevated"
      >
        <span className="text-left">
          <span className="text-muted">$ </span>
          <span className="text-foreground">{command}</span>
        </span>
        <span className="ml-3 shrink-0 text-muted transition-colors group-hover:text-secondary">
          {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
        </span>
      </button>
      {label && <p className="text-[13px] text-muted">{label}</p>}
    </div>
  );
}
