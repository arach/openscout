"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

export function QueryForm({
  paramName,
  basePath = "/studies/data",
  defaultValue,
  placeholder,
  multiline,
  submitLabel = "run ↻",
  alsoClear = ["force"],
}: {
  /** Which URL search param this form writes. */
  paramName: string;
  basePath?: string;
  defaultValue: string;
  placeholder: string;
  multiline?: boolean;
  submitLabel?: string;
  /** Other params to clear when this form submits (default: clear `force`). */
  alsoClear?: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [isPending, startTransition] = useTransition();

  // Sync local state when the URL-driven defaultValue changes from the outside
  // (e.g. clicking a shortcut). Does not interfere with in-flight typing —
  // submits set URL = local state, so the effect is a no-op then.
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  function buildHref(next: string): string {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const k of alsoClear) params.delete(k);
    if (next.trim()) params.set(paramName, next);
    else params.delete(paramName);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    startTransition(() => {
      router.push(buildHref(value), { scroll: false });
    });
  }

  const inputCls =
    "flex-1 rounded border border-studio-edge bg-studio-canvas px-2 py-1 font-mono text-[11px] text-studio-ink placeholder:text-studio-ink-faint focus:outline-none focus:ring-1 focus:ring-studio-ink-faint";

  return (
    <form
      onSubmit={submit}
      aria-busy={isPending}
      className={`flex ${multiline ? "flex-col" : "flex-row items-center"} gap-2 bg-studio-canvas-alt px-3 py-2`}
    >
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={`${inputCls} resize-y`}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              submit(e as unknown as FormEvent);
            }
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className={inputCls}
        />
      )}
      <div className={multiline ? "flex justify-end" : ""}>
        <button
          type="submit"
          disabled={isPending}
          className={`rounded border border-studio-edge bg-studio-canvas px-2 py-1 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink hover:bg-studio-canvas-alt disabled:opacity-50 ${isPending ? "animate-pulse" : ""}`}
        >
          {isPending ? "running ↻" : submitLabel}
        </button>
      </div>
    </form>
  );
}
