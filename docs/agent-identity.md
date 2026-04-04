# Agent Identity Grammar

Scout agent references are a small address grammar for targeting a concrete agent identity.

The system separates three layers:

- canonical identity: exact, stable, system-owned
- minimal unique identity: the shortest address that still resolves unambiguously
- alias: a human-owned shortcut that maps to one concrete identity

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

Canonical identity stays exact even when it is ugly. Human-facing surfaces should prefer a minimal unique identity or an explicit alias.

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
- Exact aliases resolve before canonical matching.

This keeps short names ergonomic while making precise identities explicit when needed.

## Minimal Unique Identity

Given a concrete candidate and a set of peers, Scout should prefer the shortest address that still resolves to exactly one candidate.

Dimension order is:

1. `workspaceQualifier`
2. `profile`
3. `harness`
4. `nodeQualifier`

Rules:

- do not include a dimension unless it actually reduces ambiguity
- prefer a configured alias if it uniquely resolves and is shorter than the canonical form
- if no shorter unique subset exists, fall back to the canonical identity

Examples:

- canonical: `@hudson.hudson-main-8012ac.node:arachs-mac-mini-local`
- minimal unique: `@hudson.node:backup-mac-mini`
- alias: `@huddy`

## Aliases

Aliases are exact, human-owned shortcuts:

- `@huddy`
- `@arc.dev`

Alias rules:

- one alias targets one concrete identity
- aliases must resolve uniquely
- if an alias becomes ambiguous, it is invalid until repaired
- aliases do not replace canonical identities; they sit on top of them
