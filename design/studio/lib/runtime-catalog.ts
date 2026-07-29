/**
 * Runtime catalog — the data half of the RuntimePicker atom.
 *
 * This file exists because the picker used to carry its own lists as module
 * constants. That made it a study rather than a component: a surface that
 * wanted to drop it in with a real catalog (or a different set of harnesses,
 * or a model that isn't in any list) had to fork it, and the fork stopped
 * receiving improvements. Data lives here, behaviour lives in the component,
 * and the two meet at `RuntimeCatalog`.
 *
 * The default catalog below is a fixture, not a source of truth. Production
 * builds one from `modelOptionsForLaunch()` plus the installed harnesses; a
 * study that wants the real thing passes `catalog=` and gets every behaviour
 * for free.
 *
 * The rules that are NOT the caller's problem live here too — reconciliation
 * when the harness changes, effort capability, the custom-model escape hatch.
 * Those are catalog semantics, and every consumer would otherwise reimplement
 * them slightly differently.
 */

export interface RuntimeOption {
  value: string;
  label: string;
  /** Trailing micro-caption on the row. One or two words, never a sentence. */
  note?: string;
  /** Listed but unselectable. A harness that isn't installed is information. */
  disabled?: boolean;
}

export interface RuntimeHarness extends RuntimeOption {
  models: RuntimeOption[];
  /**
   * `null` means this harness has no effort concept at all — not "use the
   * default". Grok and Kimi reject effort until their ACP transports expose
   * the control, so the picker drops the band rather than showing a dial that
   * goes nowhere. `undefined` falls back to the catalog ladder.
   */
  efforts?: RuntimeOption[] | null;
}

export interface RuntimeCatalog {
  harnesses: RuntimeHarness[];
  /** Fallback ladder for harnesses that don't name their own. Ordinal. */
  efforts: RuntimeOption[];
}

export interface RuntimeValue {
  harness: string;
  model: string;
  effort: string;
}

/** `""` keeps its production meaning throughout: let the harness decide. */
export const RUNTIME_DEFAULT_VALUE = "";

/**
 * The ladder is ordinal, which is why the panel draws it as a filling meter
 * rather than a list. Notes name the intent, not the token spend.
 */
export const RUNTIME_EFFORTS: RuntimeOption[] = [
  { value: "low", label: "Low", note: "triage" },
  { value: "medium", label: "Medium", note: "default" },
  { value: "high", label: "High", note: "deep" },
  { value: "xhigh", label: "XHigh", note: "exhaustive" },
];

const CODEX_EFFORTS: RuntimeOption[] = [
  { value: "low", label: "Low", note: "triage" },
  { value: "medium", label: "Medium", note: "default" },
  { value: "high", label: "High", note: "deep" },
];

/**
 * Fixture catalog. Model values are real ids and labels are the display names,
 * deliberately: a chip that renders the raw id next to the harness mark spells
 * "claude" twice, and keeping the two apart in the fixture is what stops that
 * bug from being reintroduced downstream.
 */
export const SCOUT_RUNTIME_CATALOG: RuntimeCatalog = {
  efforts: RUNTIME_EFFORTS,
  harnesses: [
    {
      value: "claude",
      label: "Claude",
      note: "Anthropic",
      efforts: RUNTIME_EFFORTS,
      models: [
        { value: RUNTIME_DEFAULT_VALUE, label: "Default", note: "harness picks" },
        { value: "claude-opus-5", label: "Opus 5", note: "deepest" },
        { value: "claude-sonnet-5", label: "Sonnet 5", note: "balanced" },
        { value: "claude-haiku-4-5", label: "Haiku 4.5", note: "fastest" },
      ],
    },
    {
      value: "codex",
      label: "Codex",
      note: "OpenAI",
      efforts: CODEX_EFFORTS,
      models: [
        { value: RUNTIME_DEFAULT_VALUE, label: "Default", note: "harness picks" },
        { value: "gpt-5.5-codex", label: "GPT-5.5 Codex", note: "current" },
        { value: "gpt-5.5", label: "GPT-5.5" },
        { value: "gpt-5", label: "GPT-5", note: "prior" },
      ],
    },
    {
      value: "grok",
      label: "Grok",
      note: "xAI",
      // Not a ladder set to its default — no effort control exists on this
      // transport, so there is nothing to show.
      efforts: null,
      models: [
        { value: RUNTIME_DEFAULT_VALUE, label: "Default", note: "harness picks" },
        { value: "grok-4.5", label: "Grok 4.5", note: "current" },
      ],
    },
    {
      value: "gemini",
      label: "Gemini",
      note: "not installed",
      disabled: true,
      models: [{ value: RUNTIME_DEFAULT_VALUE, label: "Default" }],
    },
  ],
};

export const DEFAULT_RUNTIME: RuntimeValue = {
  harness: "claude",
  model: "claude-opus-5",
  effort: "medium",
};

// ── Lookups ──────────────────────────────────────────────────────────────────

export function harnessFor(
  catalog: RuntimeCatalog,
  harness: string,
): RuntimeHarness | undefined {
  return catalog.harnesses.find((entry) => entry.value === harness);
}

export function modelsFor(catalog: RuntimeCatalog, harness: string): RuntimeOption[] {
  return harnessFor(catalog, harness)?.models ?? [];
}

/** `null` when the harness has no effort concept — see `RuntimeHarness.efforts`. */
export function effortsFor(
  catalog: RuntimeCatalog,
  harness: string,
): RuntimeOption[] | null {
  const entry = harnessFor(catalog, harness);
  if (!entry) return catalog.efforts;
  if (entry.efforts === null) return null;
  return entry.efforts ?? catalog.efforts;
}

export function supportsEffort(catalog: RuntimeCatalog, harness: string): boolean {
  return effortsFor(catalog, harness) !== null;
}

/**
 * The model in `value` may not be in the catalog: production accepts free text
 * so an operator can name a model the snapshot hasn't seen yet. Rather than
 * silently showing "Default" — which would be a lie about what is about to
 * run — an unknown id comes back as its own option, marked.
 */
export function resolveModel(
  catalog: RuntimeCatalog,
  value: RuntimeValue,
): RuntimeOption {
  const models = modelsFor(catalog, value.harness);
  const hit = models.find((model) => model.value === value.model);
  if (hit) return hit;
  if (value.model.trim()) {
    return { value: value.model, label: value.model, note: "custom" };
  }
  return { value: RUNTIME_DEFAULT_VALUE, label: "Default", note: "harness picks" };
}

export interface RuntimeDescription {
  harness: RuntimeOption | undefined;
  harnessLabel: string;
  model: RuntimeOption;
  modelLabel: string;
  effort: RuntimeOption | undefined;
  effortLabel: string;
  supportsEffort: boolean;
  /** Ready-made for `aria-label` on a collapsed trigger. */
  summary: string;
}

export function describeRuntime(
  catalog: RuntimeCatalog,
  value: RuntimeValue,
): RuntimeDescription {
  const harness = harnessFor(catalog, value.harness);
  const harnessLabel = harness?.label ?? value.harness ?? "Default";
  const model = resolveModel(catalog, value);
  const efforts = effortsFor(catalog, value.harness);
  const effort = efforts?.find((step) => step.value === value.effort);
  const effortLabel = effort?.label ?? value.effort;
  const summary = efforts
    ? `Runtime: ${harnessLabel}, model ${model.label}, effort ${effortLabel}`
    : `Runtime: ${harnessLabel}, model ${model.label}`;
  return {
    harness,
    harnessLabel,
    model,
    modelLabel: model.label,
    effort,
    effortLabel,
    supportsEffort: efforts !== null,
    summary,
  };
}

// ── Reconciliation ───────────────────────────────────────────────────────────

/**
 * Apply a patch and repair whatever it invalidated.
 *
 * Changing harness resets the model to Default rather than guessing a
 * cross-vendor equivalent — carrying `claude-opus-5` over to Codex would be a
 * silent lie about what runs. Effort survives when the new harness has the same
 * rung, clamps to the top of a shorter ladder, and empties when the new harness
 * has no effort control at all.
 *
 * Every consumer needs this and none of them should be writing it.
 */
export function reconcileRuntime(
  catalog: RuntimeCatalog,
  value: RuntimeValue,
  patch: Partial<RuntimeValue>,
): RuntimeValue {
  const next: RuntimeValue = { ...value, ...patch };
  if (patch.harness === undefined || patch.harness === value.harness) return next;

  next.model = patch.model ?? RUNTIME_DEFAULT_VALUE;

  const efforts = effortsFor(catalog, next.harness);
  if (!efforts) {
    next.effort = RUNTIME_DEFAULT_VALUE;
    return next;
  }
  if (efforts.some((step) => step.value === next.effort)) return next;

  // Same rung by position, clamped — "high" on a 3-rung ladder stays the top
  // rung rather than falling back to the middle.
  const previous = effortsFor(catalog, value.harness) ?? catalog.efforts;
  const index = previous.findIndex((step) => step.value === value.effort);
  const clamped = Math.min(Math.max(index, 0), efforts.length - 1);
  next.effort = efforts[clamped]?.value ?? efforts[0]?.value ?? RUNTIME_DEFAULT_VALUE;
  return next;
}

/** Seed an uncontrolled picker without demanding all three fields. */
export function seedRuntime(
  catalog: RuntimeCatalog,
  seed?: Partial<RuntimeValue>,
): RuntimeValue {
  const harness =
    seed?.harness ?? catalog.harnesses.find((entry) => !entry.disabled)?.value ?? "";
  const efforts = effortsFor(catalog, harness);
  const fallbackEffort =
    efforts?.find((step) => step.note === "default")?.value ??
    efforts?.[Math.floor((efforts.length - 1) / 2)]?.value ??
    RUNTIME_DEFAULT_VALUE;
  return {
    harness,
    model: seed?.model ?? modelsFor(catalog, harness)[1]?.value ?? RUNTIME_DEFAULT_VALUE,
    effort: efforts ? (seed?.effort ?? fallbackEffort) : RUNTIME_DEFAULT_VALUE,
  };
}

// ── Filtering ────────────────────────────────────────────────────────────────

/**
 * Substring match across label, value and note. Not fuzzy: a model list is
 * short and precise, and fuzzy matching on ids like `gpt-5` vs `gpt-5.5`
 * reorders the two in ways that read as a bug.
 */
export function searchRuntimeOptions(
  options: RuntimeOption[],
  query: string,
): RuntimeOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) =>
    `${option.label} ${option.value} ${option.note ?? ""}`.toLowerCase().includes(needle),
  );
}
