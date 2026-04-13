"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { trackCommandCopy } from "@/lib/analytics";

type TerminalStep = {
  command: string;
  label: string;
};

export function TerminalSession({
  analyticsLocation = "terminal_session",
  steps,
}: {
  analyticsLocation?: string;
  steps: TerminalStep[];
}) {
  const [copied, setCopied] = useState(false);

  const copyAll = () => {
    const text = steps.map((s) => s.command).join("\n");
    navigator.clipboard.writeText(text);
    trackCommandCopy({
      command: steps[0]?.command ?? "terminal_session",
      commandCount: steps.length,
      location: analyticsLocation,
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group/terminal relative overflow-hidden rounded-xl border border-[#232320] bg-[#111110] shadow-lg">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-[#232320] px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a36]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a36]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a36]" />
        </div>
        <button
          type="button"
          onClick={copyAll}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium tracking-wide text-[#6b6963] transition-colors hover:bg-[#1e1e1c] hover:text-[#a09d95]"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy all</span>
            </>
          )}
        </button>
      </div>

      {/* Terminal body */}
      <div className="overflow-x-auto">
        <div className="space-y-0 px-5 py-5 font-[family-name:var(--font-geist-mono)] text-[13px] leading-relaxed min-w-max">
          {steps.map((step, i) => (
            <div key={step.command} className={i > 0 ? "mt-4" : ""}>
              {/* Comment line */}
              <div className="select-none text-[#5a5751]">
                <span className="text-[#4a4844]">#</span> {step.label}
              </div>
              {/* Command line */}
              <div className="text-[#e8e5de]">
                <span className="select-none text-[#6b6963]">$ </span>
                {step.command}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
