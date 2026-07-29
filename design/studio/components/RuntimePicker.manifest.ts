import type { ComponentManifest } from "@/lib/design-system/manifest";

/**
 * RuntimePicker's manifest — and the reference specimen for the schema.
 *
 * If you are writing the second manifest, copy this one and delete what does
 * not apply. Note what it does NOT do: it never restates the source. Props
 * carry what a prop's *name and type cannot* say, states are the ones a port
 * gets wrong, and `port.drift` names both sides of every divergence so the
 * next person to touch either copy knows what they are walking into.
 */
export const runtimePickerManifest: ComponentManifest = {
  id: "runtime-picker",
  name: "RuntimePicker",
  status: "graduated",
  summary:
    "Collapses harness, model and reasoning effort into one composer chip that opens a panel, replacing two select pills and a free-text model field.",
  keywords: [
    "runtime",
    "model",
    "model picker",
    "model selector",
    "harness",
    "effort",
    "reasoning effort",
    "token picker",
    "composer",
    "toolbar",
    "chip",
    "dropdown",
    "popover",
    "select",
  ],
  whenToUse: [
    "A composer or dialog where the operator can change which runtime a message goes to.",
    "Any surface currently spending toolbar width on separate harness and model selects.",
    "Places that need the choice visible at rest but not editable at rest.",
  ],
  whenNotToUse: [
    "Read-only displays of what a session already ran on — use a static chip; this control implies the value can change.",
    "Routing a message to a different agent. Routing is the steering loop's correction grammar, not a permanent toolbar control.",
    "Surfaces where the harness is fixed by context and cannot be changed, which should show nothing rather than a one-option picker.",
  ],
  import: {
    from: "@/components/RuntimePicker",
    symbols: ["RuntimePicker", "RuntimeValue", "RuntimeCatalog", "SCOUT_RUNTIME_CATALOG"],
  },
  props: [
    {
      name: "value",
      type: "RuntimeValue",
      summary: "Controlled value. Omit entirely to let the picker hold its own state.",
    },
    {
      name: "defaultValue",
      type: "Partial<RuntimeValue>",
      summary:
        "Seed for uncontrolled use; missing fields are filled from the catalog rather than left blank.",
    },
    {
      name: "onChange",
      type: "(next: RuntimeValue) => void",
      summary:
        "Fires with the reconciled value, so the harness switch has already reset the model before you see it.",
    },
    {
      name: "catalog",
      type: "RuntimeCatalog",
      default: "SCOUT_RUNTIME_CATALOG",
      summary: "Swap in live data. Every behaviour below follows the catalog, not the component.",
    },
    {
      name: "variant",
      type: '"rail" | "bands"',
      default: '"rail"',
      summary:
        "Panel treatment only — the trigger is identical. Rail is console-dense; bands has larger targets.",
    },
    {
      name: "size",
      type: '"sm" | "md"',
      default: '"md"',
      summary: "Trigger density. `sm` fits a 28px phone toolbar row.",
    },
    {
      name: "placement",
      type: '"up" | "down"',
      default: '"up"',
      summary: "Preferred side. Flips automatically when that side cannot hold the panel.",
    },
    {
      name: "align",
      type: '"start" | "end"',
      default: '"start"',
      summary: "Which trigger edge the panel hangs from; use `end` for a right-aligned toolbar.",
    },
    {
      name: "status",
      type: '"ready" | "loading" | "error"',
      default: '"ready"',
      summary: "Catalog lifecycle. Drives the skeleton and the error slot inside the model band.",
    },
    {
      name: "statusMessage",
      type: "string",
      default: '"Model catalog unavailable."',
      summary: "Replaces the default error copy when the caller knows more.",
    },
    {
      name: "onRetry",
      type: "() => void",
      summary: "Adds a Retry action to the error state. Omit and no action is offered.",
    },
    {
      name: "disabled",
      type: "boolean",
      default: "false",
      summary: "Dims the chip and force-closes an open panel, so it cannot become a trap.",
    },
    {
      name: "showEffort",
      type: "boolean",
      default: "undefined",
      summary:
        "Force the effort band on or off. Left undefined it follows the harness, so one with no effort transport shows none.",
    },
    {
      name: "searchable",
      type: 'boolean | "auto"',
      default: '"auto"',
      summary: "Auto shows the model filter once the list passes six entries.",
    },
    {
      name: "className",
      type: "string",
      summary: "Applied to the trigger wrapper only; the panel is portalled and unaffected.",
    },
  ],
  states: [
    {
      name: "Loading catalog",
      trigger: 'status="loading"',
      behavior:
        "Model band shows three pulsing rows at real row height, so the panel does not resize when data lands.",
    },
    {
      name: "Catalog error",
      trigger: 'status="error"',
      behavior:
        "Model band becomes an alert with the message and, if onRetry is given, a Retry action. Harness and effort stay usable.",
    },
    {
      name: "No models",
      trigger: "A harness whose catalog entry has an empty model list",
      behavior: 'Reads "No models listed." rather than rendering an empty box.',
    },
    {
      name: "Filtered to nothing",
      trigger: "Type a query matching no model",
      behavior: "Names the query back so it is obvious the filter caused it, not the catalog.",
    },
    {
      name: "Unknown model",
      trigger: "A value.model the catalog has never seen (production accepts free text)",
      behavior:
        'Joins the list as its own row marked "custom" instead of being silently displayed as Default.',
    },
    {
      name: "Harness without effort",
      trigger: 'A catalog harness with efforts: null (Grok, Kimi)',
      behavior:
        "Chip drops the effort run and the band is replaced by one line naming why, rather than a dial that goes nowhere.",
    },
    {
      name: "Uninstalled harness",
      trigger: "A catalog harness with disabled: true",
      behavior:
        "Stays listed, aria-disabled, still reachable by keyboard so it is announced, but declines the click.",
    },
    {
      name: "Disabled control",
      trigger: "disabled",
      behavior: "Chip dims, panel force-closes.",
    },
  ],
  keyboard: [
    { keys: "Enter / Space", action: "Open the panel, and commit the focused option once open" },
    { keys: "Escape", action: "Close and return focus to the chip", scope: "panel" },
    { keys: "Escape", action: "Clear the filter first; a second press closes", scope: "filter" },
    { keys: "Tab / Shift+Tab", action: "Move between harness, model and effort groups" },
    { keys: "↑ / ↓", action: "Move within a vertical group (rail: harness, model)" },
    { keys: "← / →", action: "Move within a horizontal group, or cross to the neighbouring group" },
    { keys: "Home / End", action: "First / last option in the group" },
    { keys: "↓", action: "Move from the filter into the model list", scope: "filter" },
    { keys: "Enter", action: "Commit when the filter has narrowed to one model", scope: "filter" },
  ],
  a11y: [
    "Manual activation, not selection-follows-focus: arrows move the cursor and Enter commits, because choosing a harness resets the model and arrowing past one must not discard it.",
    "One tab stop per group via roving tabindex, so the panel costs three tab stops rather than fifteen.",
    "Unselectable options carry aria-disabled rather than the disabled attribute — a disabled button leaves the focus order, putting a hole in the roving cursor and never announcing why the option is unavailable.",
    "The trigger's aria-label is the full runtime summary from describeRuntime(), so the collapsed chip reads completely without opening.",
    "Panel is a role=dialog in a portal; harness and effort are radiogroups, model is a listbox.",
    "All motion is disabled under prefers-reduced-motion, including the loading pulse.",
  ],
  data: {
    module: "design/studio/lib/runtime-catalog.ts",
    summary:
      "Harness→model→effort catalog plus the rules that go with it: reconciliation on harness change, effort capability, the free-text escape hatch, and option search.",
    production:
      "modelOptionsForLaunch() plus the installed harness list; the shipped catalog here is a fixture with real ids so the label/value split stays honest.",
  },
  dependencies: {
    components: ["HarnessMark"],
    tokens: [
      "--studio-ink",
      "--studio-ink-muted",
      "--studio-ink-faint",
      "--studio-surface",
      "--studio-edge",
      "--scout-accent",
    ],
    packages: ["react-dom (createPortal)"],
  },
  examples: [
    {
      title: "Drop-in",
      summary: "Uncontrolled, fixture catalog, no wiring. This is the whole adoption cost.",
      code: `<RuntimePicker />`,
    },
    {
      title: "In a composer toolbar",
      summary: "The intended home — the tools slot, right cluster, before mic and Send.",
      code: `<MessageComposer
  showAttach
  tools={<RuntimePicker defaultValue={{ harness: "codex" }} />}
/>`,
    },
    {
      title: "Controlled",
      code: `const [runtime, setRuntime] = useState<RuntimeValue>(DEFAULT_RUNTIME);

<RuntimePicker value={runtime} onChange={setRuntime} />`,
    },
    {
      title: "Live catalog",
      summary: "Every state above is driven by these three props and nothing else.",
      code: `<RuntimePicker
  catalog={catalog}
  status={query.isLoading ? "loading" : query.error ? "error" : "ready"}
  onRetry={query.refetch}
  value={runtime}
  onChange={setRuntime}
/>`,
    },
    {
      title: "Phone density",
      code: `<RuntimePicker size="sm" variant="bands" align="end" />`,
    },
  ],
  atom: "/atoms/runtime-picker",
  source: [
    "design/studio/components/RuntimePicker.tsx",
    "design/studio/components/runtime-picker.css",
    "design/studio/lib/runtime-catalog.ts",
    "design/studio/app/atoms/runtime-picker/page.tsx",
  ],
  port: {
    target: "packages/web/client/components/MessageComposer/RuntimePicker.tsx",
    status: "drifted",
    drift: [
      "Value shape: studio takes one `value: RuntimeValue` plus `onChange`; web takes `harness`/`model`/`effort` as three props with three separate callbacks.",
      "Option shape: studio options are `{ value, label, note?, disabled? }` objects; web takes flat `readonly string[]` lists (effort aside, which is `{ value, label }[]`), so web options carry no notes and no per-option disabled state.",
      "Catalog: studio is catalog-driven with per-harness model lists; web takes two flat lists that are deliberately NOT filtered by harness, because its callers' builders are not harness-aware.",
      "Effort ladder: studio is per-harness and can be absent entirely; web ships a fixed eight-rung list and gates the whole band behind `showEffort`.",
      "Reconciliation: studio resets the model and clamps effort when the harness changes; web leaves both to the caller.",
      "Keyboard: studio has roving arrow-key navigation; web relies on plain tab order through every option button.",
      "Unselectable options: studio supports them — aria-disabled, still focusable so they are announced; web has no per-option disabled concept at all, only the whole control can be disabled.",
      "Styling: studio is Tailwind utilities plus `.rp-*` CSS; web is pure CSS under `.s-rt-*`. Token names differ (`--studio-ink` vs `--ink`).",
    ],
    notes:
      "The web copy is in production behind the New task composer and the Home screen; do not sync it by overwrite. The studio contract is the target shape — port it deliberately, starting with reconciliation and roving focus, which are behaviour the web copy is missing rather than styling it does differently.",
    // Regenerate with `bun run ds hashes runtime-picker` whenever the drift
    // list is re-checked. `ds verify` warns when either file has moved past
    // these, which is the only way anyone finds out that editing the
    // production copy silently invalidated a studio sidecar.
    verifiedAgainst: {
      "design/studio/components/RuntimePicker.tsx": "8ba42e3daf3c",
      "packages/web/client/components/MessageComposer/RuntimePicker.tsx": "29fb0088748b",
    },
  },
};
