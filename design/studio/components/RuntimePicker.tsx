"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { HarnessMark } from "@/components/HarnessMark";
import {
  DEFAULT_RUNTIME,
  RUNTIME_DEFAULT_VALUE,
  SCOUT_RUNTIME_CATALOG,
  describeRuntime,
  effortsFor,
  modelsFor,
  reconcileRuntime,
  resolveModel,
  searchRuntimeOptions,
  seedRuntime,
  type RuntimeCatalog,
  type RuntimeOption,
  type RuntimeValue,
} from "@/lib/runtime-catalog";
import { cn } from "@/lib/utils";
import "./runtime-picker.css";

/**
 * RuntimePicker — one control for harness · model · effort.
 *
 * The collapsed state is the argument: the harness is a mark, not a word —
 * once the Claude glyph is sitting there, writing "claude" beside it is
 * redundant — so the resting chip is `◈ Opus 5 · MEDIUM ⌄` and everything else
 * lives one click away. Effort carries a tone as well as a word, because it is
 * ordinal and the eye should be able to skip reading it.
 *
 * Drop-in contract
 * ────────────────
 * Zero wiring is the default. `<RuntimePicker />` renders against the fixture
 * catalog and keeps its own state, so a new study gets a working runtime chip
 * on one line. Everything past that is opt-in:
 *
 *   <RuntimePicker />                                    // uncontrolled, fixture
 *   <RuntimePicker defaultValue={{ harness: "codex" }} /> // seeded
 *   <RuntimePicker value={v} onChange={setV} />           // controlled
 *   <RuntimePicker catalog={live} status="loading" />     // real data
 *
 * Data lives in `lib/runtime-catalog.ts`, never here. Harness→model→effort
 * reconciliation, effort capability and the free-text escape hatch are catalog
 * semantics; a consumer that swaps the catalog inherits all of them.
 *
 * Two panel treatments, same trigger:
 *   rail  — harness as a left rail with a travelling marker; console-dense.
 *   bands — three labelled bands; more air, larger targets.
 *
 * Keyboard: manual activation, not selection-follows-focus. Arrows move the
 * cursor, Enter/Space commits. This is deliberate — picking a harness resets
 * the model, so arrowing past `codex` on the way to `grok` must not silently
 * throw away the model you already chose.
 */

export type RuntimeVariant = "rail" | "bands";
export type RuntimeSize = "sm" | "md";
export type RuntimeStatus = "ready" | "loading" | "error";

export interface RuntimePickerProps {
  /** Controlled value. Omit to let the picker hold its own state. */
  value?: RuntimeValue;
  /** Seed for uncontrolled use. Missing fields are filled from the catalog. */
  defaultValue?: Partial<RuntimeValue>;
  onChange?: (next: RuntimeValue) => void;
  /** Defaults to the studio fixture. Pass a live one to go real. */
  catalog?: RuntimeCatalog;
  /** Panel treatment. The trigger is identical either way. */
  variant?: RuntimeVariant;
  size?: RuntimeSize;
  /** Composer toolbars sit at the foot of the screen, so the panel opens up. */
  placement?: "up" | "down";
  /** Which edge of the trigger the panel hangs from. */
  align?: "start" | "end";
  /** Catalog lifecycle. `loading` and `error` are real states for live data. */
  status?: RuntimeStatus;
  statusMessage?: string;
  onRetry?: () => void;
  disabled?: boolean;
  /**
   * Force the effort band on or off. Default follows the harness: a harness
   * with no effort transport doesn't grow a dial that goes nowhere.
   */
  showEffort?: boolean;
  /** `"auto"` shows the model filter once the list outgrows a glance. */
  searchable?: boolean | "auto";
  className?: string;
}

const SEARCH_THRESHOLD = 6;

const ROW_H = 34;
/**
 * Panel widths, needed up front to clamp the portal against the viewport.
 *
 * The panel is the editor; the chip is the readout. The editor is allowed to be
 * wider than the thing that opened it — that is the whole point of opening it —
 * and buying that width is what lets the chip stop resizing to fit its content.
 * Rail is the two-column treatment and takes the extra room in the model column,
 * where real model ids (`claude-opus-5-20991231`) actually live.
 */
const PANEL_W: Record<RuntimeVariant, number> = { rail: 460, bands: 380 };

/**
 * Character width reserved for the model name in the collapsed chip.
 *
 * The chip is mono, so `ch` is exact: reserving the longest label in the
 * current harness's list means moving through Default → Opus 5 → Haiku 4.5
 * never moves the divider, the effort word, the caret, or anything to the right
 * of the chip in a toolbar. Clamped at both ends — never narrower than a short
 * name looks deliberate at, never wider than a pasted model id would demand.
 */
const MODEL_CH_MIN = 7;
const MODEL_CH_MAX = 14;
/** Enough headroom to open upward; below this the panel flips down. */
const PANEL_H_ESTIMATE = 300;
const GAP = 8;

/** Effort is ordinal, so it gets a tone as well as a word. */
const EFFORT_TONE: Record<string, string> = {
  low: "text-studio-ink-faint",
  medium: "text-studio-ink-muted",
  high: "text-studio-ink",
  xhigh: "text-scout-accent",
};

// ── Roving focus ─────────────────────────────────────────────────────────────

type Group = "harness" | "model" | "effort";
const GROUP_ORDER: Group[] = ["harness", "model", "effort"];

/**
 * Arrows move along a group's own axis and cross to the neighbouring group on
 * the perpendicular axis. The axis differs by treatment — the rail stacks
 * harnesses in a column, the bands lay them in a row — so the same key means
 * "next option" in one and "next group" in the other.
 */
const ORIENTATION: Record<RuntimeVariant, Record<Group, "vertical" | "horizontal">> = {
  rail: { harness: "vertical", model: "vertical", effort: "horizontal" },
  bands: { harness: "horizontal", model: "horizontal", effort: "horizontal" },
};

interface PanelCtx {
  value: RuntimeValue;
  set: (patch: Partial<RuntimeValue>) => void;
  variant: RuntimeVariant;
  size: RuntimeSize;
  status: RuntimeStatus;
  statusMessage?: string;
  onRetry?: () => void;
  harnesses: RuntimeOption[];
  models: RuntimeOption[];
  efforts: RuntimeOption[] | null;
  harnessLabel: string;
  searchable: boolean;
  query: string;
  setQuery: (next: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  cell: (group: Group, index: number) => CellProps;
  onSearchKeyDown: (event: React.KeyboardEvent) => void;
}

interface CellProps {
  ref: (el: HTMLElement | null) => void;
  tabIndex: number;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFocus: () => void;
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

function EffortLadder({ ctx }: { ctx: PanelCtx }) {
  const { efforts, value, set, size } = ctx;
  if (!efforts) return null;
  const active = Math.max(
    0,
    efforts.findIndex((step) => step.value === value.effort),
  );
  return (
    <div
      role="radiogroup"
      aria-label="Reasoning effort"
      className={cn("flex w-full gap-1", size === "sm" ? "h-6" : "h-7")}
    >
      {efforts.map((effort, i) => {
        const filled = i <= active;
        const isActive = i === active;
        return (
          <button
            key={effort.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => set({ effort: effort.value })}
            title={effort.note}
            {...ctx.cell("effort", i)}
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

/**
 * Named, not hidden. A harness with no effort transport gets one line saying
 * so — an absent control with no explanation reads as a bug in the picker.
 */
function EffortAbsent({ harnessLabel }: { harnessLabel: string }) {
  return (
    <p className="text-2xs leading-relaxed text-studio-ink-faint">
      {harnessLabel} has no effort control.
    </p>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function ModelRow({
  option,
  selected,
  index,
  ctx,
}: {
  option: RuntimeOption;
  selected: boolean;
  index: number;
  ctx: PanelCtx;
}) {
  const disabled = option.disabled ?? false;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) ctx.set({ model: option.value });
      }}
      data-on={selected}
      data-disabled={disabled || undefined}
      {...ctx.cell("model", index)}
      // Capped so a long catalog does not end with rows still arriving after
      // the pointer has already reached them.
      style={{ animationDelay: `${Math.min(index, 6) * 16}ms` }}
      className={cn(
        "rp-row rp-list-row flex w-full items-baseline gap-2 rounded-[3px] px-2 py-1.5 text-left outline-none",
        "transition-colors",
        selected ? "text-studio-ink" : "text-studio-ink-muted hover:text-studio-ink",
        "focus-visible:ring-2 focus-visible:ring-scout-accent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "rp-dot mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full",
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

/** Filter, not a combobox: the list it filters is always on screen. */
function SearchField({ ctx }: { ctx: PanelCtx }) {
  return (
    <div className="rp-search flex items-center gap-1.5 px-2 py-1.5">
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="shrink-0 text-studio-ink-faint">
        <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M7.6 7.6 10.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <input
        ref={ctx.searchRef}
        type="text"
        value={ctx.query}
        onChange={(event) => ctx.setQuery(event.target.value)}
        onKeyDown={ctx.onSearchKeyDown}
        placeholder="Filter models"
        aria-label="Filter models"
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-md text-studio-ink outline-none",
          "placeholder:text-studio-ink-faint",
        )}
      />
      {ctx.query ? (
        <button
          type="button"
          onClick={() => {
            ctx.setQuery("");
            ctx.searchRef.current?.focus();
          }}
          aria-label="Clear filter"
          className="shrink-0 rounded px-1 text-2xs uppercase tracking-caps text-studio-ink-faint outline-none hover:text-studio-ink focus-visible:ring-2 focus-visible:ring-scout-accent"
        >
          clear
        </button>
      ) : null}
    </div>
  );
}

/** Loading, error and empty share one slot so the panel never changes height. */
function ModelStatus({ ctx }: { ctx: PanelCtx }) {
  if (ctx.status === "loading") {
    return (
      <div className="flex flex-col gap-1 p-1.5" aria-busy role="status">
        <span className="sr-only">Loading models</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="rp-skel h-[26px] rounded-[3px]"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    );
  }
  if (ctx.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-1.5 px-2.5 py-3">
        <span className="text-md text-studio-ink">
          {ctx.statusMessage ?? "Model catalog unavailable."}
        </span>
        {ctx.onRetry ? (
          <button
            type="button"
            onClick={ctx.onRetry}
            className="rounded-[3px] px-1.5 py-0.5 text-2xs uppercase tracking-caps text-scout-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-scout-accent"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <p className="px-2.5 py-3 text-md text-studio-ink-faint">
      {ctx.query.trim() ? `No model matches “${ctx.query.trim()}”.` : "No models listed."}
    </p>
  );
}

function ModelList({ ctx }: { ctx: PanelCtx }) {
  if (ctx.status !== "ready" || ctx.models.length === 0) return <ModelStatus ctx={ctx} />;
  return (
    <div
      key={ctx.value.harness}
      role="listbox"
      aria-label="Model"
      className="rp-models rp-swap flex min-w-0 flex-1 flex-col gap-px p-1.5"
    >
      {ctx.models.map((model, index) => (
        <ModelRow
          key={model.value || "default"}
          option={model}
          index={index}
          selected={model.value === ctx.value.model}
          ctx={ctx}
        />
      ))}
    </div>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────────

function RailPanel({ ctx }: { ctx: PanelCtx }) {
  const { harnesses, value } = ctx;
  const activeHarness = Math.max(
    0,
    harnesses.findIndex((harness) => harness.value === value.harness),
  );

  return (
    <div className="flex flex-col" style={{ width: PANEL_W.rail }}>
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
          {harnesses.map((harness, index) => {
            const on = harness.value === value.harness;
            const disabled = harness.disabled ?? false;
            return (
              <button
                key={harness.value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={disabled || undefined}
                onClick={() => {
                  if (!disabled) ctx.set({ harness: harness.value });
                }}
                style={{ height: ROW_H }}
                data-on={on}
                data-disabled={disabled || undefined}
                title={disabled ? harness.note : undefined}
                {...ctx.cell("harness", index)}
                className={cn(
                  "rp-row flex w-[124px] items-center gap-2 rounded-[3px] px-2 outline-none transition-colors",
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
        <div className="flex min-w-0 flex-1 flex-col">
          {ctx.searchable ? <SearchField ctx={ctx} /> : null}
          <ModelList ctx={ctx} />
        </div>
      </div>

      <div className="border-t border-studio-edge px-3 pb-2.5 pt-2">
        {ctx.efforts ? (
          <EffortLadder ctx={ctx} />
        ) : (
          <EffortAbsent harnessLabel={ctx.harnessLabel} />
        )}
      </div>
    </div>
  );
}

function BandsPanel({ ctx }: { ctx: PanelCtx }) {
  const { harnesses, value, models } = ctx;

  return (
    <div className="flex flex-col" style={{ width: PANEL_W.bands }}>
      <section className="rp-stagger px-3 pb-3 pt-2.5" style={{ animationDelay: "20ms" }}>
        <Band>Harness</Band>
        <div className="mt-2 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Harness">
          {harnesses.map((harness, index) => {
            const on = harness.value === value.harness;
            const disabled = harness.disabled ?? false;
            return (
              <button
                key={harness.value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={disabled || undefined}
                onClick={() => {
                  if (!disabled) ctx.set({ harness: harness.value });
                }}
                data-on={on}
                data-disabled={disabled || undefined}
                title={disabled ? harness.note : undefined}
                {...ctx.cell("harness", index)}
                className={cn(
                  "rp-tile flex flex-col items-center gap-1.5 rounded-[4px] border px-1.5 py-2.5 outline-none",
                  "transition-colors",
                  on
                    ? "text-studio-ink"
                    : "border-studio-edge text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink-muted",
                  "focus-visible:ring-2 focus-visible:ring-scout-accent",
                )}
              >
                <HarnessMark harness={harness.value} size={17} title={null} />
                <span className="w-full truncate text-2xs uppercase tracking-caps">
                  {harness.label}
                </span>
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
        {ctx.searchable ? (
          <div className="mt-1.5 rounded-[4px] border border-studio-edge">
            <SearchField ctx={ctx} />
          </div>
        ) : null}
        {ctx.status !== "ready" || models.length === 0 ? (
          <ModelStatus ctx={ctx} />
        ) : (
          <div
            key={value.harness}
            role="listbox"
            aria-label="Model"
            className="rp-swap mt-1.5 flex flex-wrap gap-1.5"
          >
            {models.map((model, index) => {
              const on = model.value === value.model;
              const disabled = model.disabled ?? false;
              return (
                <button
                  key={model.value || "default"}
                  type="button"
                  role="option"
                  aria-selected={on}
                  aria-disabled={disabled || undefined}
                  onClick={() => {
                    if (!disabled) ctx.set({ model: model.value });
                  }}
                  data-on={on}
                  data-disabled={disabled || undefined}
                  {...ctx.cell("model", index)}
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
        )}
      </section>

      <section
        className="rp-stagger border-t border-studio-edge px-3 pb-3 pt-2.5"
        style={{ animationDelay: "70ms" }}
      >
        <Band>Effort</Band>
        <div className="mt-2">
          {ctx.efforts ? (
            <EffortLadder ctx={ctx} />
          ) : (
            <EffortAbsent harnessLabel={ctx.harnessLabel} />
          )}
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

export function RuntimePicker({
  value: controlledValue,
  defaultValue,
  onChange,
  catalog = SCOUT_RUNTIME_CATALOG,
  variant = "rail",
  size = "md",
  placement = "up",
  align = "start",
  status = "ready",
  statusMessage,
  onRetry,
  disabled = false,
  showEffort,
  searchable = "auto",
  className,
}: RuntimePickerProps = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [uncontrolled, setUncontrolled] = useState<RuntimeValue>(() =>
    defaultValue ? seedRuntime(catalog, defaultValue) : DEFAULT_RUNTIME,
  );
  const value = controlledValue ?? uncontrolled;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  const set = useCallback(
    (patch: Partial<RuntimeValue>) => {
      const next = reconcileRuntime(catalog, value, patch);
      if (controlledValue === undefined) setUncontrolled(next);
      onChange?.(next);
      // A new harness means a new list; a stale filter would hide all of it.
      if (patch.harness !== undefined && patch.harness !== value.harness) setQuery("");
    },
    [catalog, controlledValue, onChange, value],
  );

  const harnesses = catalog.harnesses;
  const allModels = useMemo(
    () => modelsFor(catalog, value.harness),
    [catalog, value.harness],
  );
  /**
   * A model the catalog has never heard of is still about to run, so it joins
   * the list rather than being silently replaced by "Default" on screen.
   */
  const withCustom = useMemo(() => {
    const custom = resolveModel(catalog, value);
    if (custom.note !== "custom") return allModels;
    return [...allModels, custom];
  }, [allModels, catalog, value]);
  const models = useMemo(
    () => searchRuntimeOptions(withCustom, query),
    [withCustom, query],
  );
  const catalogEfforts = effortsFor(catalog, value.harness);
  const efforts = showEffort === false ? null : showEffort === true
    ? (catalogEfforts ?? catalog.efforts)
    : catalogEfforts;
  const isSearchable =
    searchable === "auto" ? withCustom.length > SEARCH_THRESHOLD : searchable;

  const description = describeRuntime(catalog, value);

  /**
   * Width the chip holds open for the model name — the longest label this
   * harness can produce, so cycling through its models never resizes the pill.
   * It changes only when the harness does, and the CSS eases that.
   */
  const reservedCh = useMemo(() => {
    const longest = withCustom.reduce(
      (max, option) => Math.max(max, option.label.length),
      0,
    );
    return Math.min(Math.max(longest, MODEL_CH_MIN), MODEL_CH_MAX);
  }, [withCustom]);

  // ── Roving focus ───────────────────────────────────────────────────────────

  const cells = useRef(new Map<string, HTMLElement>());
  const [cursor, setCursor] = useState<{ group: Group; index: number }>({
    group: "model",
    index: 0,
  });

  const counts = useMemo<Record<Group, number>>(
    () => ({
      harness: harnesses.length,
      model: status === "ready" ? models.length : 0,
      effort: efforts?.length ?? 0,
    }),
    [efforts?.length, harnesses.length, models.length, status],
  );

  const selectedIndex = useCallback(
    (group: Group) => {
      if (group === "harness") {
        return Math.max(0, harnesses.findIndex((h) => h.value === value.harness));
      }
      if (group === "model") {
        return Math.max(0, models.findIndex((m) => m.value === value.model));
      }
      return Math.max(0, efforts?.findIndex((e) => e.value === value.effort) ?? 0);
    },
    [efforts, harnesses, models, value],
  );

  const focusCell = useCallback((group: Group, index: number) => {
    setCursor({ group, index });
    cells.current.get(`${group}:${index}`)?.focus();
  }, []);

  const focusGroup = useCallback(
    (from: Group, direction: 1 | -1) => {
      const start = GROUP_ORDER.indexOf(from);
      for (let i = start + direction; i >= 0 && i < GROUP_ORDER.length; i += direction) {
        const group = GROUP_ORDER[i];
        if (counts[group] > 0) {
          focusCell(group, Math.min(selectedIndex(group), counts[group] - 1));
          return true;
        }
      }
      return false;
    },
    [counts, focusCell, selectedIndex],
  );

  const cell = useCallback(
    (group: Group, index: number): CellProps => ({
      ref: (el: HTMLElement | null) => {
        const key = `${group}:${index}`;
        if (el) cells.current.set(key, el);
        else cells.current.delete(key);
      },
      // Exactly one stop per group, so Tab walks groups and arrows walk options.
      tabIndex: cursor.group === group && cursor.index === index ? 0 : -1,
      onFocus: () => setCursor({ group, index }),
      onKeyDown: (event: React.KeyboardEvent) => {
        const orientation = ORIENTATION[variant][group];
        const vertical = orientation === "vertical";
        const nextKey = vertical ? "ArrowDown" : "ArrowRight";
        const prevKey = vertical ? "ArrowUp" : "ArrowLeft";
        const nextGroupKey = vertical ? "ArrowRight" : "ArrowDown";
        const prevGroupKey = vertical ? "ArrowLeft" : "ArrowUp";
        const count = counts[group];
        if (count === 0) return;

        if (event.key === nextKey) {
          event.preventDefault();
          focusCell(group, (index + 1) % count);
        } else if (event.key === prevKey) {
          event.preventDefault();
          // With a filter above the list, Up from the first row belongs to it.
          if (group === "model" && index === 0 && isSearchable) {
            setCursor({ group, index: 0 });
            searchRef.current?.focus();
            return;
          }
          focusCell(group, (index - 1 + count) % count);
        } else if (event.key === nextGroupKey) {
          event.preventDefault();
          focusGroup(group, 1);
        } else if (event.key === prevGroupKey) {
          event.preventDefault();
          focusGroup(group, -1);
        } else if (event.key === "Home") {
          event.preventDefault();
          focusCell(group, 0);
        } else if (event.key === "End") {
          event.preventDefault();
          focusCell(group, count - 1);
        }
      },
    }),
    [counts, cursor, focusCell, focusGroup, isSearchable, variant],
  );

  const onSearchKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown" && counts.model > 0) {
        event.preventDefault();
        focusCell("model", 0);
      } else if (event.key === "Enter" && counts.model === 1) {
        // One survivor means the filter already made the choice.
        event.preventDefault();
        const only = models[0];
        if (!only.disabled) set({ model: only.value });
      } else if (event.key === "Escape" && query) {
        // Stage one clears the filter; an empty filter lets the panel close.
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
      }
    },
    [counts.model, focusCell, models, query, set],
  );

  // ── Placement ──────────────────────────────────────────────────────────────

  /**
   * The panel renders in a portal on `position: fixed`.
   *
   * It has to: the composer shell is `overflow-hidden rounded-[14px]` so it can
   * clip the textarea and waveform to its corners, and this control lives in
   * that shell's `tools` slot. An absolutely positioned panel inside it gets
   * cut off at the composer's edge — invisible in a standalone stage and
   * obvious the moment it sits in a real toolbar. Portalling also means the
   * picker doesn't care what it is dropped into later.
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
    const preferred = align === "end" ? rect.right - width : rect.left;
    const left = Math.min(
      Math.max(GAP, preferred),
      Math.max(GAP, window.innerWidth - width - GAP),
    );
    const top = resolved === "up" ? rect.top - GAP : rect.bottom + GAP;
    setAnchor({ left, top, placement: resolved });
  }, [align, placement, variant]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onReflow = () => measure();
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, measure]);

  // ── Open / close ───────────────────────────────────────────────────────────

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

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

  /**
   * Land on the model, not on the panel container. Model is what changes;
   * harness and effort are usually already right. Focusing the box itself
   * would make the first arrow press do nothing.
   */
  useEffect(() => {
    if (!open) return;
    const group: Group = counts.model > 0 ? "model" : "harness";
    const index = Math.min(selectedIndex(group), Math.max(0, counts[group] - 1));
    setCursor({ group, index });
    const frame = requestAnimationFrame(() => {
      const target = cells.current.get(`${group}:${index}`);
      if (target) target.focus();
      else panelRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // Deliberately keyed on `open` alone — re-running as the list filters would
    // yank focus out of the search field on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset the filter between openings; a stale one hides the list on reopen.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // A disabled control that still has a panel open is a trap.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const ctx: PanelCtx = {
    value,
    set,
    variant,
    size,
    status,
    statusMessage,
    onRetry,
    harnesses,
    models,
    efforts,
    harnessLabel: description.harnessLabel,
    searchable: isSearchable,
    query,
    setQuery,
    searchRef,
    cell,
    onSearchKeyDown,
  };

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={description.summary}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-open={open}
        data-size={size}
        data-status={status}
        className={cn(
          "rp-chip inline-flex items-center gap-1.5 rounded-full outline-none",
          size === "sm" ? "min-h-6 px-2" : "min-h-7 px-2.5",
          "transition-colors focus-visible:ring-2 focus-visible:ring-scout-accent",
          disabled && "rp-chip--disabled",
        )}
      >
        <HarnessMark harness={value.harness || "unknown"} size={size === "sm" ? 12 : 13} title={null} />
        {/* Model and effort share a baseline, not a centre line. They are 12px
         *  mixed-case against 9px all-caps, so centring their line boxes leaves
         *  the caps visibly floating — the two runs have different cap heights
         *  and x-heights. The mark and caret stay centred; only the type sits
         *  on the baseline. */}
        <span className="inline-flex min-w-0 items-baseline gap-1.5">
          <span
            className="rp-chip-model truncate font-mono text-md font-medium text-studio-ink"
            style={{ minWidth: `${reservedCh}ch`, maxWidth: `${MODEL_CH_MAX}ch` }}
          >
            {/* Keyed so a changed model cross-fades in place rather than
             *  swapping between two frames. The box it fades inside was already
             *  reserved above, so nothing around it moves. */}
            <span key={description.modelLabel} className="rp-chip-model-text">
              {description.modelLabel}
            </span>
          </span>
          {efforts && description.effortLabel ? (
            <>
              <span aria-hidden className="rp-divider h-2.5 w-px shrink-0 self-center" />
              <span
                className={cn(
                  "shrink-0 text-2xs font-semibold uppercase tracking-caps",
                  EFFORT_TONE[value.effort] ?? "text-studio-ink-muted",
                )}
              >
                {description.effortLabel}
              </span>
            </>
          ) : null}
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
              {variant === "bands" ? <BandsPanel ctx={ctx} /> : <RailPanel ctx={ctx} />}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// ── Re-exports ───────────────────────────────────────────────────────────────
//
// The catalog is the atom's other half. Re-exporting it here means a consumer
// has one import path to remember, and `import { RuntimePicker } from
// "@/components/RuntimePicker"` keeps working as it always did.

export {
  DEFAULT_RUNTIME,
  RUNTIME_DEFAULT_VALUE,
  RUNTIME_EFFORTS,
  SCOUT_RUNTIME_CATALOG,
  describeRuntime,
  effortsFor,
  modelsFor,
  reconcileRuntime,
  resolveModel,
  searchRuntimeOptions,
  seedRuntime,
  supportsEffort,
} from "@/lib/runtime-catalog";
export type {
  RuntimeCatalog,
  RuntimeDescription,
  RuntimeHarness,
  RuntimeOption,
  RuntimeValue,
} from "@/lib/runtime-catalog";
