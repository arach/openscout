# Agent Identity Grammar

Scout agent references are a small address grammar for targeting a concrete agent identity.

## Model

An agent identity is the combination of:

- `definitionId`: the base workspace or project identity
- `workspaceQualifier`: the non-default worktree or branch qualifier
- `profile`: the capability or persona preset
- `harness`: the execution backend
- `nodeQualifier`: the machine or host qualifier

In code, the canonical shape lives in:

- `/Users/arach/dev/openscout/packages/protocol/src/agent-identity.ts`

## Canonical Grammar

```text
@<definitionId>[.<workspaceQualifier>][.profile:<profile>][.harness:<harness>][.node:<node>]
```

Examples:

- `@arc`
- `@arc.main`
- `@arc.main.profile:dev`
- `@arc.main.profile:dev-browser.harness:claude`
- `@arc.super-refactor.profile:dev-browser.harness:claude.node:mini`

## Parsing Rules

- `@` is required in user-facing text, but internal formatting can omit it.
- One positional qualifier is allowed after the base id.
- The positional qualifier is the worktree or branch slot.
- Typed qualifiers may appear in any order during parsing.
- Formatting always normalizes back to canonical order:
  - `definitionId`
  - `workspaceQualifier`
  - `profile`
  - `harness`
  - `node`

These aliases map to the canonical dimensions:

- `branch:` and `worktree:` -> `workspaceQualifier`
- `persona:` -> `profile`
- `runtime:` -> `harness`
- `host:` -> `nodeQualifier`

## Normalization

Each segment is canonicalized to lowercase kebab-case:

- `Super Refactor` -> `super-refactor`
- `dev/browser` -> `dev-browser`
- `Mini.local` -> `mini-local`

Dots are reserved as grammar separators, so values are normalized to segment-safe tokens.

## Resolution

Resolution matches a parsed identity against concrete candidates.

- Bare identities like `@arc` can resolve through an explicit default alias.
- Partially qualified identities must resolve to exactly one candidate.
- Ambiguous identities return `null`.

This keeps short names ergonomic while making precise identities explicit when needed.
