/**
 * RuntimePicker — harness · model · (effort) as a single composer chip.
 *
 * Replaces the pair of `MessageComposerToolSelect`s in the toolbar's right
 * cluster. Those said one thing between them — which runtime this message goes
 * to — while costing two controls and reading as two decisions.
 *
 * Collapsed, the harness is a mark rather than a word: once the Claude glyph is
 * there, writing "claude" beside it is redundant, which is what keeps the chip
 * short. Effort is opt-in (`showEffort`) because most composers have no effort
 * concept today; surfaces that do — the PR assign dialog, the broker — turn it
 * on rather than every composer silently growing a new setting.
 *
 * Options arrive as flat string lists, matching `buildHarnessOptions()` /
 * `buildModelOptions()` and `modelOptionsForLaunch()`. `""` keeps its existing
 * meaning: let the harness decide. Note the model list is NOT filtered by
 * harness — the callers' builders aren't harness-aware, and inventing that
 * filtering here would hide models the caller deliberately offered.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { HarnessMark, harnessLabel } from "../HarnessMark.tsx";
import "./runtime-picker.css";

export const RUNTIME_EFFORTS = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
] as const;

const PANEL_W = 320;
const PANEL_H_ESTIMATE = 260;
const GAP = 8;

/**
 * A bare string is its own value AND its own display text — the original shape,
 * still accepted. The object form separates them so a caller with a real catalog
 * can show "Opus 5" while the value stays the round-tripping id `claude-opus-5`,
 * and can mark an option unselectable without dropping it from the list.
 */
export type RuntimeOption =
  | string
  | { value: string; label?: string; disabled?: boolean };

type NormalizedOption = { value: string; label: string; disabled: boolean };

function normalizeOption(option: RuntimeOption): NormalizedOption {
  if (typeof option === "string") {
    return { value: option, label: option, disabled: false };
  }
  return {
    value: option.value,
    label: option.label ?? option.value,
    disabled: option.disabled ?? false,
  };
}

export type RuntimePickerProps = {
  harness: string;
  model: string;
  /** Only read when `showEffort` is set. */
  effort?: string;
  onHarnessChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onEffortChange?: (value: string) => void;
  /** Flat lists, as the callers already build them. `""` is added as Default. */
  harnessOptions: readonly RuntimeOption[];
  modelOptions: readonly RuntimeOption[];
  /** Capability-filtered values for the selected harness/model. */
  effortOptions?: readonly { value: string; label: string }[];
  /** Off by default — see the note above. */
  showEffort?: boolean;
  disabled?: boolean;
  className?: string;
};

function Chevron() {
  return (
    <svg
      className="s-rt-chip-chevron"
      width="9"
      height="6"
      viewBox="0 0 9 6"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1 1.4 4.5 4.6 8 1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function withDefault(options: readonly RuntimeOption[]): NormalizedOption[] {
  const normalized = options.map(normalizeOption);
  if (normalized.some((option) => option.value === "")) return normalized;
  return [{ value: "", label: "default", disabled: false }, ...normalized];
}

export function RuntimePicker({
  harness,
  model,
  effort = "medium",
  onHarnessChange,
  onModelChange,
  onEffortChange,
  harnessOptions,
  modelOptions,
  effortOptions = RUNTIME_EFFORTS,
  showEffort = false,
  disabled = false,
  className,
}: RuntimePickerProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    placement: "up" | "down";
  } | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const roomAbove = rect.top;
    const roomBelow = window.innerHeight - rect.bottom;
    // Composer toolbars sit at the foot of the screen, so prefer upward.
    const placement: "up" | "down" =
      roomAbove >= PANEL_H_ESTIMATE || roomAbove >= roomBelow ? "up" : "down";
    const left = Math.min(
      Math.max(GAP, rect.left),
      Math.max(GAP, window.innerWidth - PANEL_W - GAP),
    );
    setAnchor({
      left,
      top: placement === "up" ? rect.top - GAP : rect.bottom + GAP,
      placement,
    });
  }, []);

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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The panel is portalled, so it isn't inside rootRef — check both.
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // A disabled control that still opens is a trap; close if it goes disabled.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const harnesses = withDefault(harnessOptions);
  const models = withDefault(modelOptions);
  const modelLabel = models.find((option) => option.value === model)?.label ?? model;
  const activeEffort = Math.max(
    0,
    effortOptions.findIndex((e) => e.value === effort),
  );
  const effortLabel =
    effortOptions.find((e) => e.value === effort)?.label ?? effort;

  return (
    <div
      ref={rootRef}
      className={className ? `s-rt-root ${className}` : "s-rt-root"}
      style={{ position: "relative", display: "inline-flex" }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`s-rt-chip${disabled ? " s-rt-chip--disabled" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Runtime: ${harnessLabel(harness) || "default"}, model ${modelLabel || "default"}${showEffort ? `, effort ${effortLabel}` : ""}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <HarnessMark
          harness={harness || "unknown"}
          size={13}
          className="s-rt-chip-mark"
          title={null}
        />
        <span className="s-rt-chip-type">
          {/* Display the catalog label when there is one — beside the harness mark,
              a raw id like "claude-opus-5" spells "claude" a second time. */}
          <span className="s-rt-chip-model">{modelLabel.trim() || "default"}</span>
          {showEffort ? (
            <>
              <span aria-hidden className="s-rt-chip-divider" />
              <span className="s-rt-chip-effort" data-effort={effort}>
                {effortLabel}
              </span>
            </>
          ) : null}
        </span>
        <Chevron />
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
              className="s-rt-panel"
              style={{
                left: anchor.left,
                width: PANEL_W,
                ...(anchor.placement === "up"
                  ? { bottom: window.innerHeight - anchor.top }
                  : { top: anchor.top }),
              }}
            >
              <section className="s-rt-band" style={{ animationDelay: "20ms" }}>
                <div className="s-rt-label">Harness</div>
                <div className="s-rt-options" role="radiogroup" aria-label="Harness">
                  {harnesses.map((option) => (
                    <button
                      key={option.value || "default"}
                      type="button"
                      role="radio"
                      aria-checked={option.value === harness}
                      className="s-rt-opt"
                      /* Kept in the list but unselectable — a harness that is not
                         installed is information, not something to hide. */
                      disabled={option.disabled}
                      onClick={() => onHarnessChange(option.value)}
                    >
                      {option.value ? (
                        <HarnessMark
                          harness={option.value}
                          size={13}
                          className="s-rt-opt-mark"
                          title={null}
                        />
                      ) : null}
                      {option.label || "default"}
                    </button>
                  ))}
                </div>
              </section>

              <section className="s-rt-band" style={{ animationDelay: "45ms" }}>
                <div className="s-rt-label">Model</div>
                <div className="s-rt-options" role="listbox" aria-label="Model">
                  {models.map((option) => (
                    <button
                      key={option.value || "default"}
                      type="button"
                      role="option"
                      aria-selected={option.value === model}
                      className="s-rt-opt"
                      disabled={option.disabled}
                      onClick={() => onModelChange(option.value)}
                    >
                      {option.label || "default"}
                    </button>
                  ))}
                </div>
              </section>

              {showEffort && onEffortChange ? (
                <section className="s-rt-band" style={{ animationDelay: "70ms" }}>
                  <div className="s-rt-label">Effort</div>
                  <div
                    className="s-rt-ladder"
                    role="radiogroup"
                    aria-label="Reasoning effort"
                  >
                    {effortOptions.map((step, i) => {
                      const isCurrent = i === activeEffort;
                      return (
                        <button
                          key={step.value}
                          type="button"
                          role="radio"
                          aria-checked={isCurrent}
                          className="s-rt-step"
                          onClick={() => onEffortChange(step.value)}
                        >
                          <span
                            className="s-rt-step-bar"
                            data-state={
                              isCurrent
                                ? "current"
                                : i < activeEffort
                                  ? "filled"
                                  : "empty"
                            }
                          />
                          <span className="s-rt-step-label">{step.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
