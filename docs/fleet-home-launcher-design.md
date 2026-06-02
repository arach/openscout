# Fleet Home · Zero-active launcher · Design Spec

Scope: the compact "real ask" composer that replaces the passive zero state in
`packages/web/client/screens/HomeScreen.tsx` (`ActiveAgentsLauncher`) and
`packages/web/client/screens/fleet-home.css` (`.s-active-empty*`).

The section rule `Active agents · 0` already states the situation. The launcher
is the call-to-action, not a wordy empty state — its structure ("0 agents → one
input row") carries the meaning. We want it to read as a single composer
(target chip → field → actions), not three loose form controls separated by a
hairline.

---

## What's there today (audit)

- One row, three-column grid: `[ LED · <select> ] | <textarea> | <mic> <send>`.
- LED is a static dim dot — purely decorative.
- Agent picker is a bare native `<select>` styled with mono uppercase.
- A 1px column rule separates picker from input.
- Submit is an accent-bordered round button at 12% fill; fills on hover.
- States: only `disabled` is encoded visually. No focus, sending, or error
  treatment on the form itself.
- Placeholder: `Start an ask…` (coy / generic).
- Long names: ellipsis only, no tooltip.
- Mobile (≤780px): picker becomes its own row above input.

Working, but: the form feels like three components, the LED is wasted, the
submit/disabled contrast at rest is shallow, and the placeholder doesn't teach
the target.

---

## Goals

1. Read as **one composer**: chip + field + actions.
2. Promote the LED to a **state semaphore** (idle / focus / sending / error).
3. **Concrete dynamic placeholder** so the path is obvious without prose.
4. Strong **focus** and **sending** treatments so the form feels live.
5. Handle **long agent names** without breaking the row.
6. Mobile: stack cleanly without losing the actions row.

Non-goals (v1): a custom listbox popover, recent-ask suggestions, per-agent
draft recall. Cheap follow-ups; not blocking.

---

## DOM (delta, keep current names)

```tsx
const state: "idle" | "focus" | "typed" | "sending" | "error" =
  error ? "error" : sending ? "sending" : draft.trim() ? "typed" : "idle";

const label = selectedAgent?.handle ?? selectedAgent?.name ?? selectedAgent?.id ?? "agent";
const fullName = selectedAgent?.name && selectedAgent.name !== label
  ? `${selectedAgent.name} (@${label})`
  : `@${label}`;

<form
  className="s-active-empty"
  data-state={state}
  onSubmit={…}
>
  <label className="s-active-empty-main" title={fullName}>
    <span className="s-active-empty-led" aria-hidden="true" />
    <span className="s-active-empty-at" aria-hidden="true">@</span>
    <select className="s-active-empty-agent" …>{/* unchanged options */}</select>
    <span className="s-active-empty-caret" aria-hidden="true">▾</span>
  </label>

  <textarea
    className="s-active-empty-input"
    placeholder={selectedAgent ? `Ask @${label}…` : "Start an ask…"}
    …
  />

  <div className="s-active-empty-actions">
    <DictationMic className="s-active-empty-mic" … />
    <button
      type="submit"
      className="s-active-empty-submit"
      disabled={!canSubmit}
      aria-label={selectedAgent ? `Ask @${label}` : "Ask agent"}
      title={selectedAgent ? `Ask @${label}` : "Ask agent"}
    >
      {sending
        ? <Loader2 size={14} strokeWidth={1.8} className="s-active-empty-spin" aria-hidden />
        : <Send size={14} strokeWidth={1.8} aria-hidden />}
    </button>
  </div>

  {error && (
    <p className="s-active-empty-error" role="alert">{error}</p>
  )}

  <p className="s-active-empty-hint" aria-hidden>
    <kbd>↵</kbd> send · <kbd>⇧↵</kbd> newline · <kbd>⌘K</kbd> focus
  </p>
</form>
```

Notes:
- Keep the native `<select>` as the actual control (no popover code). Style it
  as a chip; the `<label>` wraps `select + LED + caret` so the whole chip is
  click-target.
- `data-state` drives every visual state from CSS — no per-state class spam.
- Long names: `text-overflow: ellipsis` already, plus `title=` on the chip for
  the full name when truncated.

---

## CSS spec (replace the current `.s-active-empty*` block)

```css
.s-active-empty {
  min-height: 48px;
  border: 1px solid color-mix(in srgb, var(--border) 56%, transparent);
  border-radius: 8px;                      /* was 6 — matches Now-row chrome */
  background: color-mix(in srgb, var(--surface) 56%, transparent);
  display: grid;
  grid-template-columns: auto minmax(180px, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  transition:
    border-color 120ms ease,
    background    120ms ease,
    box-shadow    120ms ease;
}

/* Whole-form focus lift */
.s-active-empty:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}

.s-active-empty[data-state="error"] {
  border-color: color-mix(in srgb, var(--amber) 50%, var(--border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--amber) 22%, transparent);
}

/* Target chip ------------------------------------------------------ */
.s-active-empty-main {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  max-width: 220px;
  min-width: 0;
  cursor: pointer;
}

.s-active-empty-main:hover {
  border-color: color-mix(in srgb, var(--ink) 28%, var(--border));
}

.s-active-empty-led {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dim) 55%, transparent);
  transition: background 120ms ease, box-shadow 220ms ease;
}

.s-active-empty:focus-within .s-active-empty-led {
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.s-active-empty[data-state="sending"] .s-active-empty-led {
  background: var(--accent);
  animation: s-active-empty-pulse 1.1s ease-in-out infinite;
}

.s-active-empty[data-state="error"] .s-active-empty-led {
  background: var(--amber);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--amber) 22%, transparent);
}

@keyframes s-active-empty-pulse {
  0%, 100% { box-shadow: 0 0 0 0   color-mix(in srgb, var(--accent) 32%, transparent); }
  50%      { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent)  0%, transparent); }
}

.s-active-empty-at {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
  flex: 0 0 auto;
}

.s-active-empty-caret {
  font-size: 9px;
  color: var(--dim);
  flex: 0 0 auto;
  margin-left: 1px;
}

/* The native <select>, restyled to live inside the chip ------------ */
.s-active-empty-agent {
  appearance: none;
  -webkit-appearance: none;
  min-width: 0;
  max-width: 160px;
  border: 0;
  background: transparent;
  outline: none;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: lowercase;        /* "scoutbot" reads better than "SCOUTBOT" at 11px */
  color: var(--ink);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-active-empty-agent:disabled { color: var(--dim); cursor: not-allowed; }

/* Input ------------------------------------------------------------- */
.s-active-empty-input {
  min-width: 0;
  min-height: 30px;
  max-height: 90px;
  border: 0;                         /* drop the column rule — whitespace separates */
  background: transparent;
  color: var(--copy);
  outline: none;
  padding: 7px 4px;
  resize: none;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.35;
}

.s-active-empty-input::placeholder { color: var(--dim); }

/* Actions ---------------------------------------------------------- */
.s-active-empty-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.s-active-empty-mic.s-dictation-mic,
.s-active-empty-submit {
  width: 30px;                       /* was 32 — calmer next to a 48px row */
  height: 30px;
  flex: 0 0 auto;
  align-self: center;
  border-radius: 999px;
}

.s-active-empty-submit {
  border: 1px solid color-mix(in srgb, var(--accent) 58%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

/* Primed: filled accent when there's a draft ready ---------------- */
.s-active-empty[data-state="typed"]   .s-active-empty-submit:not(:disabled),
.s-active-empty[data-state="sending"] .s-active-empty-submit {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}

.s-active-empty-submit:not(:disabled):hover {
  background: var(--accent);
  color: var(--bg);
}

.s-active-empty-submit:disabled { cursor: not-allowed; opacity: 0.42; }

.s-active-empty[data-state="sending"] .s-active-empty-submit { cursor: progress; opacity: 1; }

.s-active-empty-spin { animation: s-active-empty-spin 0.9s linear infinite; }
@keyframes s-active-empty-spin { to { transform: rotate(360deg); } }

/* Error & hint ---------------------------------------------------- */
.s-active-empty-error {
  min-width: 0;
  grid-column: 1 / -1;
  margin: 0;
  overflow: hidden;
  color: var(--amber);
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-active-empty-hint {
  grid-column: 1 / -1;
  margin: 2px 2px 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--dim);
  letter-spacing: 0.04em;
}
.s-active-empty-hint kbd {
  font: inherit;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--copy);
}
/* Hide hint at rest — surfaces only when the operator engages */
.s-active-empty:not(:focus-within) .s-active-empty-hint { display: none; }

/* Mobile / narrow -------------------------------------------------- */
@media (max-width: 780px) {
  .s-active-empty {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "main    main"
      "input   input"
      "spacer  actions";
    row-gap: 6px;
  }
  .s-active-empty-main    { grid-area: main;    max-width: none; justify-self: start; }
  .s-active-empty-input   { grid-area: input; }
  .s-active-empty-actions { grid-area: actions; justify-self: end; }
}
```

---

## State table

| `data-state` | LED                          | Form border        | Submit                          | Mic                | Hint   |
|--------------|------------------------------|--------------------|---------------------------------|--------------------|--------|
| `idle`       | dim dot                      | 56% border         | accent border, 12% fill, **disabled** | resting     | hidden |
| `focus`      | accent dot + 22% halo        | accent 55% + ring  | accent border, 12% fill (disabled until typed) | resting | shown |
| `typed`      | accent dot                   | accent 55% + ring  | **full accent fill**, white-on-accent  | resting     | shown |
| `sending`    | accent dot, pulsing          | accent 55% + ring  | full accent fill, **spinner**, cursor-progress | disabled | shown |
| `error`      | amber dot + 22% amber halo   | **amber border** + ring | restores to typed/idle treatment | resting     | shown |

(Recording state from the mic component overlays naturally — its own
`--green` treatment plays on top without conflict.)

---

## Microcopy

- Placeholder (selected agent): `Ask @${handle}…`
- Placeholder (no agent): `Start an ask…` (current fallback — keep).
- Submit `aria-label` / `title`: `Ask @${handle}` (was generic "Ask agent").
- Hint (focus-only, single line): `↵ send · ⇧↵ newline · ⌘K focus`.
- Error text: keep short, single line, ellipsis on overflow. The amber LED +
  border carry the signal — no need to apologize in prose.

No persistent "no agents are working — start one" caption. The section rule
("Active agents · 0") + the composer's own affordances are the message.

---

## Interaction details

- **Enter** submits (current). **Shift+Enter** newline (current). Composition
  events guarded (current). Keep.
- **⌘/Ctrl+K** focuses the textarea while the launcher is mounted. One
  `useEffect` adds a `keydown` listener on `document`; check `event.target` is
  not in another editable element to avoid stealing focus from other composers.
- **Esc** in the textarea clears the draft and blurs (cheap UX win).
- **Long agent names**: prefer `agent.handle ?? agent.name` for the visible
  label (mono is denser); the chip already truncates; add `title` for the
  full handle/name pair on the chip.
- **Sending**: lock the mic and select via `disabled` (current); swap send
  glyph for a spinner; pulse the LED.
- **Error**: don't clear the draft. Show a single inline line, role=alert.
  Reset to non-error state on next keypress so retries feel responsive
  (add `onChange={…; if (error) setError(null);}`).

---

## Implementation diff summary

`HomeScreen.tsx` — `ActiveAgentsLauncher`:
1. Derive `state` and `label` once, pass `data-state` on the `<form>`.
2. Wrap LED + `@` + `<select>` + caret in a `<label>` chip (`s-active-empty-main`).
3. Dynamic placeholder + submit `aria-label`/`title`.
4. Swap `Send` for `Loader2` when `sending`; class `s-active-empty-spin`.
5. Add the `s-active-empty-hint` row.
6. Add `onChange` clearing `error` on next keystroke; `Esc` to clear draft.
7. Add `useEffect` for `⌘K` / `Ctrl+K` focus.

`fleet-home.css` — `.s-active-empty*` block: replace per spec above.

No new dependencies. No popover, no listbox, no recent-asks suggestions.
Strictly the composer.

---

## Follow-ups (not in this pass)

- Real `@`-search listbox when agent count > ~8.
- Up-arrow on empty draft → recall last ask (per-agent localStorage).
- Optional 2–3 example-ask chips below the row, generated from the operator's
  prior asks; gated behind a setting to avoid clutter.
