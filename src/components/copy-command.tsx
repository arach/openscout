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
      className="group inline-flex h-11 items-center gap-3 rounded-full border border-[#dad6cd] bg-white px-5 font-mono text-[13px] text-[#111110] shadow-sm transition-all hover:border-[#cfcac1] hover:bg-[#faf9f4] hover:shadow-md"
    >
      <span className="text-[#8b887f]">$</span>
      <span>{command}</span>
      <span className="ml-1 text-[#8b887f] transition-colors group-hover:text-[#5f5d57]">
        {copied ? <Check className="h-3.5 w-3.5 text-[#2657c6]" /> : <Copy className="h-3.5 w-3.5" />}
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
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,24rem)_1fr]">
      <button
        onClick={copy}
        className="group flex min-h-12 items-center justify-between rounded-xl border border-[#ded9cf] bg-white px-4 py-3 font-mono text-[13px] text-[#111110] shadow-sm transition-colors hover:border-[#cfcac1] hover:bg-[#faf9f4]"
      >
        <span className="text-left leading-relaxed">
          <span className="text-[#8b887f]">$ </span>
          <span>{command}</span>
        </span>
        <span className="ml-3 shrink-0 text-[#8b887f] transition-colors group-hover:text-[#5f5d57]">
          {copied ? <Check className="h-3.5 w-3.5 text-[#2657c6]" /> : <Copy className="h-3.5 w-3.5" />}
        </span>
      </button>
      {label && <p className="pt-1 text-[13px] leading-relaxed text-[#64625c]">{label}</p>}
    </div>
  );
}
