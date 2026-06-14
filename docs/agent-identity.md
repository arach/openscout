# Agent Identity And Addressing

This doc explains how Scout turns a human-friendly handle like `@hudson` into one exact Scout address for routing. Read it after [`quickstart.md`](./quickstart.md) when you want to understand what an agent name represents, why short names sometimes work, and when Scout needs more qualifiers.

Every agent Scout can address has a name. When there is only one matching agent on one machine, the name is simple — `@arc` or `@hudson`. But agents multiply. The same project might run on two machines. The same workspace might have a main branch and a feature branch, each with its own agent. A project might use Claude for one task and Codex for another.

The identity grammar exists to keep every target unambiguously addressable while still letting humans type the shortest useful name. The default target is the base project/workspace identity. Harness, model, node, and session details describe the concrete instance Scout routes to; they are not a different base agent unless the caller intentionally chooses a specialized profile.

## Base Agent Vs Instance

A **base agent** is the vanilla project/workspace identity that agents should
use when they do not care about a specific runtime. In practice this is the
thing represented by a project path, such as `../talkie`, or by a short handle,
such as `@talkie`.

An **agent instance** is the concrete attachment Scout routes to for that base
identity: a Claude or Codex harness, a model choice, a machine/node, and
optionally an explicit session id. Asking for a specific instance should refine
the route, not create the impression that `talkie#codex` and `talkie#claude`
are separate base agents.

Default rule: if the project is known but the exact agent/session is not, use
project routing and let Scout pick or create the concrete instance. Add a
harness/capability constraint when that matters:

```bash
scout ask --project ../talkie --harness claude "Review this."
```

```ts
ask({ projectPath: "../talkie", harness: "claude", body: "Review this." })
```

Do not guess generic names such as `claude.main` just because you need a Claude
review. Scout should return durable follow-up handles and, when possible, a
friendly mnemonic handle for the routed worker. Promote that worker to a named
long-lived sibling only after the route is known good.

When routing by an agent card, label, or exact agent id, Scout treats the target
as a fresh-session request. Use `session:<id>` or MCP `targetSessionId` only
when the caller intentionally wants to continue one concrete prior harness
session. Historical session records and reachability diagnostics are for that
explicit session path, not fallback candidates for normal card routing.

Specialized profiles may become first-class over time. For example,
`@scout.profile:investigator` could name a profile with a dedicated tool set
and instructions. That is a specialization layered onto the project identity,
not the default routing model.

## Three Layers

Scout separates identity into three layers, each serving a different audience:

- **Canonical identity** is exact, stable, and system-owned. It includes every dimension needed to distinguish one agent from all others. Humans rarely type it, but the broker always stores it.

- **Minimal unique identity** is the shortest address that still resolves to exactly one agent. Scout computes it automatically from the current set of online agents. When there is only one `hudson`, `@hudson` is enough. When two exist on different machines, `@hudson.node:mini` disambiguates.

- **Alias** is a human-owned shortcut. `@huddy` maps to one specific identity. If the mapping becomes ambiguous, the alias is invalid until repaired.

## The Six Dimensions

An agent identity combines up to six dimensions:

| Dimension | What it captures | Example |
|---|---|---|
| `definitionId` | The base project or workspace | `arc`, `hudson` |
| `workspaceQualifier` | A non-default worktree or branch | `super-refactor`, `main` |
| `profile` | Optional specialization/persona, not the default route | `dev`, `investigator` |
| `harness` | Instance execution backend | `claude`, `codex` |
| `model` | Instance model family or concrete model | `sonnet`, `gpt-5-5` |
| `node` | Instance machine or host | `mini`, `macbook` |

The canonical form strings them together with dots:

```bash
@<definitionId>[.<workspaceQualifier>][.profile:<profile>][.harness:<harness>][.model:<model>][.node:<node>]
```

In practice, most of these dimensions are omitted. You only include what is needed to resolve unambiguously.

## Examples

From shortest to most qualified:

| Address | What it resolves |
|---|---|
| `@arc` | The only `arc` agent currently online |
| `@arc.main` | The `arc` agent on the `main` branch |
| `@arc.super-refactor` | The `arc` agent on a feature worktree |
| `@arc.main.harness:claude` | The Claude instance of `arc` on main |
| `@lattices#codex?5.5` | Compatibility shorthand for the Codex instance of `lattices` on a 5.5 model |
| `@lattices#claude?sonnet` | Compatibility shorthand for the Claude instance of `lattices` on Sonnet |
| `@arc.super-refactor.harness:claude.node:mini` | Fully qualified: project, branch, harness, machine |

## Parsing and Normalization

- `@` is required for body-mention compatibility in user-facing text. Internal
  systems can omit it, and Scout-aware composers may use the `>>` route
  operator instead, such as `/scout:ask >> hudson Review this.`
- One positional qualifier (without a type prefix) is allowed after the definition ID — it is always treated as the workspace qualifier.
- Typed qualifiers (`profile:`, `harness:`, `model:`, `node:`) may appear in any order during input. Scout normalizes them to canonical order on storage.
- Shorthand `#<harness>` maps to `harness:<harness>`, and `?<model>` maps to `model:<model>`.
- Segments are lowercased and kebab-cased: `Super Refactor` becomes `super-refactor`, `Mini.local` becomes `mini-local`. Dots are reserved as separators.

These aliases are accepted during parsing and map to canonical dimensions:

| Alias | Maps to |
|---|---|
| `branch:`, `worktree:` | `workspaceQualifier` |
| `persona:` | `profile` |
| `runtime:` | `harness` |
| `#codex` | `harness:codex` |
| `?sonnet` | `model:sonnet` |
| `host:` | `node` |

## Resolution

When you type `@hudson`, Scout resolves it against all known agents:

1. Check for an exact alias match first.
2. Match the parsed identity against registered candidates.
3. If exactly one candidate matches, resolve to it.
4. If zero or more than one match, return nothing — the name is either unknown or ambiguous.

This keeps short names fast and ergonomic while requiring precision only when the situation demands it.

## Minimal Unique Identity

Given a specific agent and its peers, Scout prefers the shortest address that uniquely identifies it. Dimensions are dropped in this order until removing the next one would create ambiguity:

1. `workspaceQualifier`
2. `profile`
3. `harness`
4. `model`
5. `node`

If a configured alias is shorter than the minimal canonical form and resolves uniquely, Scout prefers it.

**Example:**

- Canonical: `@hudson.hudson-main-8012ac.node:arachs-mac-mini-local`
- Minimal unique: `@hudson` (if only one hudson is online)
- Alias: `@huddy`
