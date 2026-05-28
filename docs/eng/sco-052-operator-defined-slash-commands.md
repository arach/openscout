# SCO-052 — Operator-defined slash commands

## Proposal ID

`sco-052`

## Intent

Extend the HUD's slash-command prefilter (introduced in [`sco-050`](./sco-050-scoutbot-as-fleet-agent.md)) so the operator can define their own commands. The built-in set (`/agents`, `/status`, `/recent @x`, …) is the floor; the operator's own commands sit alongside and override on name collision.

## Why

Two recent moves make this the natural next step.

1. **Keyboard nav into the dock is fast.** `i` focuses the dock, `/` focuses and seeds a slash — a hotkey commits the operator to "I'm about to type a command." Today the only thing on the other side is whatever the built-in prefilter knows about.
2. **Every operator has their own muscle memory.** The built-in commands answer fleet questions ("what is @hudson doing"). The commands that would actually save an operator keystrokes are personal: their standard handoff prelude, the URL they open every morning, the dispatch to the one agent they spin up daily. Those don't belong in the built-in set.

The shape is small, the surface is constrained (single text expansion or one-shot action), and it leans on infrastructure that already exists. The hard problem (round-tripping operator messages through the prefilter and the runner) is solved; this adds a second source of commands above the same plumbing.

## Proposal

A single JSON file on disk defines the operator's commands. The runner reads it at boot and on change; the dock autocompletes from it; the cheatsheet surfaces it.

### Storage

`~/Library/Application Support/OpenScout/commands.json` (or the platform equivalent via `resolveOpenScoutSupportPaths()` — same directory as `scoutbot-threads.json`).

```jsonc
{
  "version": 1,
  "commands": [
    {
      "name": "dox",
      "kind": "insert",
      "body": "Heads up — about to ship the {{topic}} patch. Pinging if it breaks."
    },
    {
      "name": "h",
      "kind": "send",
      "to": "@hudson",
      "body": "{{rest}}"
    },
    {
      "name": "docs",
      "kind": "open",
      "url": "https://docs.openscout.dev/{{rest}}"
    }
  ]
}
```

A command is identified by `name` (no leading slash; the dock adds it). The `kind` discriminates behavior. v1 ships three kinds:

- **`insert`** — replaces the dock buffer with `body`. The operator edits it before pressing return. Cursor lands at the first `{{` placeholder when present, or end of buffer.
- **`send`** — one-shot. Routes `body` (with template vars expanded) to `to` immediately. No dock landing; the operator types `/h status check` and the message goes.
- **`open`** — opens `url` (with `{{rest}}` expanded) in the default browser. No dock landing.

### Template variables

Two are reserved:

- `{{rest}}` — everything the operator typed after the command name, trimmed. `/h foo bar` → `rest = "foo bar"`.
- `{{N}}` for N = 1, 2, 3, … — positional args split by whitespace. `/h foo bar` → `1 = "foo"`, `2 = "bar"`.

Operator-named placeholders (`{{topic}}` in the `dox` example) prompt inline before send — an `insert` command lands in the dock with `{{topic}}` still visible so the operator fills it. For `send`/`open`, unfilled placeholders abort with a quiet inline warning ("commands: missing {{topic}}").

### Discovery

- **Autocomplete in the dock.** Typing `/` opens an inline suggestion strip combining built-in and operator commands. Operator entries get a subtle marker (`·` chip or pill color) so it's clear where they came from.
- **Cheatsheet.** A new "Custom" section in `HUDCheatsheet` lists the operator's commands with their body/destination. Empty by default; appears once the file has entries.
- **`/help` extends.** The built-in `/help` reply (currently lists prefilter commands) appends the operator's set under a "Custom" heading.

### Precedence

On name collision, the operator wins. If `/agents` is redefined by the operator, the operator's version runs and the built-in is shadowed (with a note in `/help` so the operator can see what they overrode). No conflict prompt — the operator chose the name, that's the signal.

### Editing

v1: edit the JSON file directly. Future: a studio panel at `/eng/commands` (or similar) that reads/writes the same file. Studio editing is **not** part of v1 — file-edit-and-hot-reload is enough to validate the shape.

### Hot reload

The runner watches the file (`fs.watch` or polling at boot/refresh) and replaces its in-memory command map on change. No HUD restart needed.

## Non-goals (v1)

- **Scripted commands.** No shell-out, no multi-step pipelines, no conditional logic. A command is one of three concrete shapes.
- **Per-project commands.** Single global file. Per-project scoping is a stage-2 extension via a project-local override file.
- **Sync across machines.** The file is local. Reading from a cloud-synced path (Dropbox, iCloud Drive) works incidentally but isn't supported.
- **Capability tokens / sandboxing.** The operator wrote the file; the operator owns the consequences. (See "Security posture" below.)
- **Programmatic addition from agents.** Agents can't write new commands. Only the operator can, by editing the file.

## Security posture

This is per the same operator-on-their-own-machine framing as SCO-050: the file lives in the operator's support directory, only the operator writes to it, every command kind has a constrained shape (text expansion, one-shot send to a routable target, URL open). No shell execution; no arbitrary code; no eval. `open` is restricted to `http://`, `https://`, and `scout://` schemes — no `file://`, no `javascript:`, no shell URLs.

## Open questions

- **Argument hygiene for `send`.** Should `{{rest}}` be passed verbatim or mention-stripped before send? Today `HudComposeService` strips embedded `@` tokens before posting to the broker (see [[feedback_scout_in_body_at_strip]]) — so passing raw user input through is safe, but the operator may expect their literal `@x` to land. Lean: pass through; the existing strip happens downstream.
- **Conflict UI.** If the operator shadows a built-in, do we surface that anywhere besides `/help`? Maybe a subtle marker in the autocomplete strip (e.g., a strikethrough on the shadowed built-in). Defer until we see whether anyone actually collides.
- **Scoping when SCO-051 lands multi-thread.** Are commands per-thread, per-runner, or global? Probably global — the operator's macros aren't thread-scoped.
- **Per-tab activation.** Today `/` works from any HUD tab. Should a command like `/spin` (start a new agent) only work in the agents tab? Lean: no scoping; commands work everywhere because the operator's intent isn't tab-bound.

## Status

Proposal. Not implemented. No companion implementation plan yet.

When the implementation plan is written, it lives at `docs/eng/sco-052-implementation-plan.md` and this doc gets an `## Implementation` section linking to it (per the convention in `docs/eng/README.md`).

## Relationship to other proposals

- [`sco-050`](./sco-050-scoutbot-as-fleet-agent.md) — established the deterministic prefilter and the runner shim that routes operator messages. Operator commands extend the prefilter's command registry; no new transport.
- [`sco-051`](./sco-051-scoutbot-thread-model.md) — thread model. Operator commands aren't thread-scoped (current lean), so they live above the thread map.
