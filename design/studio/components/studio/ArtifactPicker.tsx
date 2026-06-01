"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export interface ArtifactPickerFile {
  name: string;
  bytes: number;
  content: string;
}

/**
 * Client-side artifact list + preview swap.
 *
 * The server pre-reads every file's content and hands the array down. Switching
 * files is instant — local state flips the preview body. The URL stays in sync
 * via router.replace so the link is still shareable, but no server round-trip
 * happens on click.
 */
export function ArtifactPicker({
  files,
  initialSelected,
  emptyMessage,
}: {
  files: ArtifactPickerFile[];
  initialSelected?: string;
  emptyMessage?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const initial =
    files.find((f) => f.name === initialSelected)?.name ?? files[0]?.name ?? "";
  const [selectedName, setSelectedName] = useState(initial);

  if (files.length === 0) {
    return (
      <pre className="px-3 py-2 font-mono text-[10.5px] text-studio-ink-faint">
        {emptyMessage ?? "no files"}
      </pre>
    );
  }

  const selected = files.find((f) => f.name === selectedName) ?? files[0]!;

  function select(name: string) {
    setSelectedName(name);
    startTransition(() => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("artifact", name);
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="grid grid-cols-1 gap-px bg-studio-edge md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <ul className="divide-y divide-studio-edge bg-studio-canvas font-mono text-[10.5px]">
        <li className="grid grid-cols-[minmax(0,1fr)_64px] gap-2 border-b border-studio-edge px-3 py-1.5 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          <span>file</span>
          <span className="text-right">bytes</span>
        </li>
        {files.map((f) => {
          const active = selected.name === f.name;
          return (
            <li key={f.name}>
              <button
                type="button"
                onClick={() => select(f.name)}
                aria-current={active ? "true" : undefined}
                className={[
                  "grid w-full grid-cols-[minmax(0,1fr)_64px] items-baseline gap-2 px-3 py-1.5 text-left transition-colors",
                  active
                    ? "bg-scout-accent-soft shadow-[inset_2px_0_0_var(--scout-accent)]"
                    : "hover:bg-studio-canvas-alt",
                ].join(" ")}
              >
                <span className="truncate text-studio-ink">{f.name}</span>
                <span className="text-right tabular-nums text-studio-ink-faint">
                  {formatBytes(f.bytes)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="bg-studio-canvas">
        <div className="border-b border-studio-edge px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          preview · {selected.name}
        </div>
        <pre className="max-h-[420px] overflow-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-studio-ink">
          {selected.content || "(empty)"}
        </pre>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (bytes >= 1024) {
    const value = bytes / 1024;
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)} KiB`;
  }
  return `${bytes} B`;
}
