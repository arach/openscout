"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HarnessMark } from "@/components/HarnessMark";
import { cn } from "@/lib/utils";
import "./runtime-picker.css";

/**
 * RuntimePicker — one control for harness · model · effort.
 *
 * Today these are three separate form controls in the composer toolbar
 * (`MessageComposerSelect` ×2 plus a text input with a datalist in
 * `PullRequestAssignDialog`). Three controls to say one thing: which runtime
 * this message goes to. They also read as three because they look like three,
 * so the toolbar spends its whole width on configuration nobody changes most
 * of the time.
 *
 * The collapsed state is the argument: the harness is a mark, not a word —
 * once the Claude glyph is sitting there, writing "claude" beside it is
 * redundant — so the resting chip is `◈ Opus · MEDIUM ⌄` and everything else
 * lives one click away. Effort carries a tone as well as a word, because it is
 * ordinal and the eye should be able to skip reading it.
 *
 * Two panel treatments, same trigger:
 *   rail  — harness as a left rail with a travelling marker; console-dense.
 *   bands — three labelled bands; more air, larger targets.
 *
 * Data is the real thing: harnesses and efforts are `PR_REVIEW_HARNESSES` /
 * `PR_REVIEW_EFFORTS` from `packages/web/client/scout/repo-watch/
 * pull-request-actions.ts`. Model lists are curated per harness here — in
 * production models come from `modelOptionsForLaunch()` plus free text, so a
 * port keeps `""` meaning "let the harness decide".
 */

export interface RuntimeOption {
  value: string;
  label: string;
  note?: string;
}

/** Mirrors PR_REVIEW_HARNESSES. Note `pi` is labelled Grok upstream — see the
 *  study page; HarnessMark renders π for that key, not the Grok mark. */
export const RUNTIME_HARNESSES: RuntimeOption[] = [
  { value: "claude", label: "Claude", note: "Anthropic" },
  { value: "codex", label: "Codex", note: "OpenAI" },
  { value: "grok", label: "Grok", note: "xAI" },
];

/** Mirrors PR_REVIEW_EFFORTS. Ordinal — low → xhigh. */
export const RUNTIME_EFFORTS: RuntimeOption[] = [
  { value: "low", label: "Low", note: "triage" },
  { value: "medium", label: "Medium", note: "default" },
  { value: "high", label: "High", note: "deep" },
  { value: "xhigh", label: "XHigh", note: "exhaustive" },
];

export const RUNTIME_MODELS: Record<string, RuntimeOption[]> = {
  claude: [
    { value: "", label: "Default", note: "harness picks" },
    { value: "opus", label: "Opus", note: "deepest" },
    { value: "sonnet", label: "Sonnet", note: "balanced" },
    { value: "haiku", label: "Haiku", note: "fastest" },
  ],
  codex: [
    { value: "", label: "Default", note: "harness picks" },
    { value: "gpt-5.5", label: "GPT-5.5", note: "current" },
    { value: "gpt-5", label: "GPT-5", note: "prior" },
  ],
  grok: [
    { value: "", label: "Default", note: "harness picks" },
    { value: "grok", label: "Grok", note: "current" },
  ],
};

export interface RuntimeValue {
  harness: string;
  model: string;
  effort: string;
}

const EFFORT_INDEX = (effort: string) =>
  Math.max(0, RUNTIME_EFFORTS.findIndex((e) => e.value === effort));

/** Effort is ordinal, so it gets a tone as well as a word. */
const EFFORT_TONE: Record<string, string> = {
  low: "text-studio-ink-faint",
  medium: "text-studio-ink-muted",
  high: "text-studio-ink",
  xhigh: "text-scout-accent",
};

function modelLabel(harness: string, model: string): string {
  const list = RUNTIME_MODELS[harness] ?? [];
  const hit = list.find((m) => m.value === model);
  if (hit && hit.value) return hit.label;
  if (model.trim()) return model;
  return "Default";
}

// ── Trigger ──────────────────────────────────────────────────────────────────

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className="rp-caret shrink-0"
      data-open={open}
      width="8"
      height="5"
      viewBox="0 0 8 5"
      aria-hidden
    >
      <path
        d="M1 1.2 4 4 7 1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Effort ladder ────────────────────────────────────────────────────────────

function EffortLadder({
  value,
  onChange,
  size = "md",
}: {
  value: string;
  onChange: (next: string) => void;
  size?: "sm" | "md";
}) {
  const active = EFFORT_INDEX(value);
  return (
    <div
      role="radiogroup"
      aria-label="Reasoning effort"
      className={cn("flex w-full gap-1", size === "sm" ? "h-6" : "h-7")}
    >
      {RUNTIME_EFFORTS.map((effort, i) => {
        const filled = i <= active;
        const isActive = i === active;
        return (
          <button
            key={effort.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(effort.value)}
            title={effort.note}
            className={cn(
              "group relative flex-1 rounded-[3px] outline-none",
              "focus-visible:ring-2 focus-visible:ring-scout-accent focus-visible:ring-offset-1",
              "focus-visible:ring-offset-studio-surface",
            )}
          >
            <span
              data-state={isActive ? "current" : filled ? "filled" : "empty"}
              className="rp-seg block h-1 w-full rounded-full"
            />
            <span
              className={cn(
                "mt-1.5 block text-2xs uppercase tracking-caps",
                isActive
                  ? "font-semibold text-studio-ink"
                  : "text-studio-ink-faint group-hover:text-studio-ink-muted",
              )}
            >
              {effort.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Model list ───────────────────────────────────────────────────────────────

function ModelRow({
  option,
  selected,
  onSelect,
}: {
  option: RuntimeOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      data-on={selected}
      className={cn(
        "rp-row flex w-full items-baseline gap-2 rounded-[3px] px-2 py-1.5 text-left outline-none",
        "transition-colors",
        selected ? "text-studio-ink" : "text-studio-ink-muted hover:text-studio-ink",
        "focus-visible:ring-2 focus-visible:ring-scout-accent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full",
          selected ? "bg-scout-accent" : "bg-transparent",
        )}
      />
      <span className="flex-1 truncate text-md font-medium">{option.label}</span>
      {option.note ? (
        <span className="shrink-0 text-2xs uppercase tracking-caps text-studio-ink-faint">
          {option.note}
        </span>
      ) : null}
    </button>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────────

const ROW_H = 34;

/** Panel widths, needed up front to clamp the portal against the viewport. */
const PANEL_W = { rail: 380, bands: 340 } as const;
/** Enough headroom to open upward; below this the panel flips down. */
const PANEL_H_ESTIMATE = 300;
const GAP = 8;

function RailPanel({
  value,
  set,
}: {
  value: RuntimeValue;
  set: (patch: Partial<RuntimeValue>) => void;
}) {
  const activeHarness = Math.max(
    0,
    RUNTIME_HARNESSES.findIndex((h) => h.value === value.harness),
  );
  const models = RUNTIME_MODELS[value.harness] ?? [];

  return (
    <div className="flex w-[380px] flex-col">
      <div className="flex">
        {/* Harness rail — one marker travels, rows don't each grow a border. */}
        <div
          className="relative shrink-0 border-r border-studio-edge py-1.5 pl-1.5 pr-2"
          role="radiogroup"
          aria-label="Harness"
        >
          <span
            aria-hidden
            className="rp-marker absolute left-0 top-1.5 w-[2px] rounded-full bg-scout-accent"
            style={{
              height: ROW_H - 10,
              transform: `translateY(${activeHarness * ROW_H + 5}px)`,
            }}
          />
          {RUNTIME_HARNESSES.map((harness) => {
            const on = harness.value === value.harness;
            return (
              <button
                key={harness.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ harness: harness.value, model: "" })}
                style={{ height: ROW_H }}
                data-on={on}
                className={cn(
                  "rp-row flex w-[112px] items-center gap-2 rounded-[3px] px-2 outline-none transition-colors",
                  on ? "text-studio-ink" : "text-studio-ink-faint hover:text-studio-ink-muted",
                  "focus-visible:ring-2 focus-visible:ring-scout-accent",
                )}
              >
                <HarnessMark harness={harness.value} size={14} title={null} />
                <span className="flex-1 truncate text-left text-md font-medium">
                  {harness.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Models — re-keyed on harness so the swap animates. */}
        <div
          key={value.harness}
          role="listbox"
          aria-label="Model"
          className="rp-swap flex min-w-0 flex-1 flex-col gap-px p-1.5"
        >
          {models.map((model) => (
            <ModelRow
              key={model.value || "default"}
              option={model}
              selected={model.value === value.model}
              onSelect={() => set({ model: model.value })}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-studio-edge px-3 pb-2.5 pt-2">
        <EffortLadder
          value={value.effort}
          onChange={(effort) => set({ effort })}
          size="sm"
        />
      </div>
    </div>
  );
}

function BandsPanel({
  value,
  set,
}: {
  value: RuntimeValue;
  set: (patch: Partial<RuntimeValue>) => void;
}) {
  const models = RUNTIME_MODELS[value.harness] ?? [];

  return (
    <div className="flex w-[340px] flex-col">
      <section className="rp-stagger px-3 pb-3 pt-2.5" style={{ animationDelay: "20ms" }}>
        <Band>Harness</Band>
        <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Harness">
          {RUNTIME_HARNESSES.map((harness) => {
            const on = harness.value === value.harness;
            return (
              <button
                key={harness.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ harness: harness.value, model: "" })}
                data-on={on}
                className={cn(
                  "rp-tile flex flex-col items-center gap-1.5 rounded-[4px] border px-2 py-2.5 outline-none",
                  "transition-colors",
                  on
                    ? "text-studio-ink"
                    : "border-studio-edge text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink-muted",
                  "focus-visible:ring-2 focus-visible:ring-scout-accent",
                )}
              >
                <HarnessMark harness={harness.value} size={17} title={null} />
                <span className="text-2xs uppercase tracking-caps">{harness.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section
        className="rp-stagger border-t border-studio-edge px-3 py-2.5"
        style={{ animationDelay: "45ms" }}
      >
        <Band>Model</Band>
        <div
          key={value.harness}
          role="listbox"
          aria-label="Model"
          className="rp-swap mt-1.5 flex flex-wrap gap-1.5"
        >
          {models.map((model) => {
            const on = model.value === value.model;
            return (
              <button
                key={model.value || "default"}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => set({ model: model.value })}
                data-on={on}
                className={cn(
                  "rp-tile rounded-full border px-2.5 py-1 text-md font-medium outline-none transition-colors",
                  on
                    ? "text-studio-ink"
                    : "border-studio-edge text-studio-ink-muted hover:border-studio-edge-strong hover:text-studio-ink",
                  "focus-visible:ring-2 focus-visible:ring-scout-accent",
                )}
              >
                {model.label}
              </button>
            );
          })}
        </div>
      </section>

      <section
        className="rp-stagger border-t border-studio-edge px-3 pb-3 pt-2.5"
        style={{ animationDelay: "70ms" }}
      >
        <Band>Effort</Band>
        <div className="mt-2">
          <EffortLadder value={value.effort} onChange={(effort) => set({ effort })} />
        </div>
      </section>
    </div>
  );
}

function Band({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export interface RuntimePickerProps {
  value: RuntimeValue;
  onChange: (next: RuntimeValue) => void;
  /** Panel treatment. The trigger is identical either way. */
  variant?: "rail" | "bands";
  /** Composer toolbars sit at the foot of the screen, so the panel opens up. */
  placement?: "up" | "down";
  className?: string;
}

export function RuntimePicker({
  value,
  onChange,
  variant = "rail",
  placement = "up",
  className,
}: RuntimePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  /**
   * The panel renders in a portal on `position: fixed`.
   *
   * It has to: the composer shell is `overflow-hidden rounded-[14px]`
   * (MessageComposer.tsx:302) so it can clip the textarea and waveform to its
   * corners, and this control lives in that shell's `tools` slot. An absolutely
   * positioned panel inside it gets cut off at the composer's edge — which is
   * invisible in a standalone stage and obvious the moment it sits in the real
   * toolbar. Portalling also means the picker doesn't care what it's dropped
   * into later.
   */
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    placement: "up" | "down";
  } | null>(null);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = PANEL_W[variant];
    // Prefer the caller's placement, but flip if that side can't hold it.
    const roomAbove = rect.top;
    const roomBelow = window.innerHeight - rect.bottom;
    const resolved: "up" | "down" =
      placement === "up"
        ? roomAbove >= PANEL_H_ESTIMATE || roomAbove >= roomBelow
          ? "up"
          : "down"
        : roomBelow >= PANEL_H_ESTIMATE || roomBelow >= roomAbove
          ? "down"
          : "up";
    const left = Math.min(
      Math.max(GAP, rect.left),
      Math.max(GAP, window.innerWidth - width - GAP),
    );
    const top = resolved === "up" ? rect.top - GAP : rect.bottom + GAP;
    setAnchor({ left, top, placement: resolved });
  }, [placement, variant]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onScroll = () => measure();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, measure]);

  const set = useCallback(
    (patch: Partial<RuntimeValue>) => onChange({ ...value, ...patch }),
    [onChange, value],
  );

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The panel is portalled, so it is not inside rootRef — check both.
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Move focus into the panel so keyboard users land where the eye does.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const effortLabel =
    RUNTIME_EFFORTS.find((e) => e.value === value.effort)?.label ?? value.effort;

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-open={open}
        className={cn(
          "rp-chip inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 outline-none",
          "transition-colors focus-visible:ring-2 focus-visible:ring-scout-accent",
        )}
      >
        <HarnessMark harness={value.harness} size={13} title={null} />
        {/* Model and effort share a baseline, not a centre line. They are 12px
         *  mixed-case against 9px all-caps, so centring their line boxes leaves
         *  the caps visibly floating — the two runs have different cap heights
         *  and x-heights. The mark and caret stay centred; only the type sits
         *  on the baseline. */}
        <span className="inline-flex min-w-0 items-baseline gap-1.5">
          <span className="max-w-[104px] truncate font-mono text-md font-medium text-studio-ink">
            {modelLabel(value.harness, value.model)}
          </span>
          <span aria-hidden className="rp-divider h-2.5 w-px shrink-0 self-center" />
          <span
            className={cn(
              "shrink-0 text-2xs font-semibold uppercase tracking-caps",
              EFFORT_TONE[value.effort] ?? "text-studio-ink-muted",
            )}
          >
            {effortLabel}
          </span>
        </span>
        <span className="text-studio-ink-faint">
          <Caret open={open} />
        </span>
      </button>

      {open && anchor
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label="Runtime"
              tabIndex={-1}
              data-placement={anchor.placement}
              style={{
                position: "fixed",
                left: anchor.left,
                ...(anchor.placement === "up"
                  ? { bottom: window.innerHeight - anchor.top }
                  : { top: anchor.top }),
              }}
              className={cn(
                "rp-panel z-50 overflow-hidden rounded-[6px] outline-none",
                "border border-studio-edge bg-studio-surface",
                "shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)]",
              )}
            >
              {variant === "bands" ? (
                <BandsPanel value={value} set={set} />
              ) : (
                <RailPanel value={value} set={set} />
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
