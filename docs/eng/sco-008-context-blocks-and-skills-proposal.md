# SCO-008: Context Blocks and Skills

## Status

Proposed.

## Proposal ID

`sco-008`

## Intent

Define a broker-owned context plane for OpenScout so instructions, learned
memory, reusable reference material, and on-demand skills stop living as
scattered prompt fragments.

OpenScout already has:

- broker-owned collaboration state
- broker-owned shared resources
- harness prompts and runtime context injection
- repo-local skill files in some flows

What it does not have is a first-class broker primitive for
"context intended to shape agent reasoning over time."

SCO-008 proposes:

- **context blocks** as durable broker-owned prompt context units
- **skills** as load-on-demand context bundles
- **loadouts** as stable block assemblies for agents, work, or sessions

This proposal is about prompt-facing memory and instructions, not a new
chat model and not a generic knowledge platform.

## Problem

Today context is scattered across too many places:

- generated harness prompts
- workspace files
- ad hoc runtime context assembly
- notes and artifacts that are durable but not prompt-native
- repo-local skill documents that are real, useful, and not broker-owned

That creates four failures:

1. **Prompt context is not a first-class durable object.**
   The broker knows about work, resources, and identity, but not about the
   context blocks agents repeatedly need.
2. **Shared resources are not the same thing as prompt context.**
   A file or note may be useful input to an agent, but we do not yet have a
   canonical prompt-facing projection over those resources.
3. **Memory and skills drift by harness.**
   One runtime may get a large generated prompt, another may get a skill
   path, and a third may reconstruct context from scratch.
4. **There is no clean write-back model for learned facts.**
   If an agent or operator discovers stable information that should persist,
   there is no canonical durable place for "small prompt memory" short of
   editing files or stuffing it into freeform notes.

The missing primitive is not "more prompt text." It is a broker-owned
context model that can be assembled consistently across harnesses.

## Decision

OpenScout SHOULD add first-class **context blocks** and **skills**, with
stable broker-owned bindings into agents, work, and sessions.

The architectural rule is:

- resources remain the durable source objects
- context blocks are prompt-facing projections over resources or inline
  content
- skills are load-on-demand context blocks with stronger reuse semantics
- loadouts are stable assemblies of blocks applied to a target scope

The broker MUST remain the source of truth for:

- block identity and scope
- access policy
- mutation rules
- provenance
- freshness
- prompt projection mode

Harnesses MAY render or load context differently, but they MUST NOT invent
their own durable context ontology.

## Design Principles

1. Context is a broker primitive, not a prompt side effect.
2. Resources and prompt context are related but distinct.
3. Not all useful context should be injected inline every turn.
4. Read-only instructions and writable memory need different rules.
5. Skills should be cheap to advertise and explicit to load.
6. Context provenance matters as much as content.
7. The same context model should work across Claude, Codex, and future
   harnesses.

## Goals

- make prompt-facing context durable and broker-owned
- support short writable memory without abusing chat history
- support reusable load-on-demand skills
- let shared resources back context blocks cleanly
- reduce harness-specific prompt drift
- make context scope, policy, and freshness inspectable

## Non-Goals

- building a full vector database product
- replacing shared files, notes, or artifacts
- making every file on disk a context block
- building autonomous memory writing with no broker policy
- forcing all context into one giant system prompt

## Terminology

| Term | Meaning |
|---|---|
| **Context block** | A durable prompt-facing unit of context |
| **Skill** | A load-on-demand context block intended for reuse |
| **Loadout** | A stable assembly of context blocks attached to a scope |
| **Projection mode** | How a block should be exposed to an agent: inline, summary, loadable, or searchable |
| **Source resource** | A file, note, artifact, or other durable object that a block is derived from |

## Proposed Model

### Context Block

A context block is the core primitive.

Suggested fields:

- `id`
- `kind`: `instruction`, `memory`, `reference`, `skill`
- `title`
- `scope`: `global`, `workspace`, `agent`, `conversation`, `work_item`,
  `session`
- `projection_mode`: `inline`, `summary`, `loadable`, `searchable`
- `mutability`: `readonly`, `broker_writable`, `append_only`
- `owner_id`
- `source_resource_id`
- `token_budget`
- `freshness_policy`
- `body`
- `summary`
- `metadata`

### Skill

A skill is a specialized context block with:

- `kind = skill`
- `projection_mode = loadable`
- human-readable description
- optional usage hints
- optional declared inputs or preconditions

Skills SHOULD be easy to enumerate without loading their full bodies.

Examples:

- "Deploy checklist"
- "Scout relay etiquette"
- "How to update the iOS bridge safely"

### Loadout

A loadout is the binding layer.

It describes which blocks should be available to:

- an agent definition
- a workspace
- a work item
- a live session

Suggested fields:

- `id`
- `target_kind`
- `target_id`
- `context_block_id`
- `priority`
- `enabled`
- `mode_override`
- `metadata`

This lets the broker answer:

- what context should this agent always see?
- what context is visible but load-on-demand?
- what work-specific memory is attached to this task?

## Projection Modes

The broker should distinguish at least four projection modes.

### Inline

Inject the block body directly each turn.

Best for:

- agent identity
- hard operational rules
- short, stable instructions

### Summary

Inject only broker-maintained summary text and metadata.

Best for:

- large reference docs
- evolving notes
- compact memory that should stay visible without full payload cost

### Loadable

Advertise the block by title and description until explicitly loaded.

Best for:

- skills
- long procedures
- reference manuals

### Searchable

Expose only discovery affordances until queried.

Best for:

- larger collections of small entries
- broker-owned note clusters
- issue or artifact indexes that are too large to inline

## Mutation Rules

Writable context needs stronger rules than ordinary prompt text.

Recommended policy:

- `instruction` blocks are readonly by default
- `memory` blocks may be broker-writable or append-only
- skill bodies are readonly unless explicitly configured otherwise
- harnesses may propose updates, but the broker decides whether and how
  they persist

This matters because "agent memory" without provenance becomes prompt
pollution quickly.

## Relationship To Shared Resources

Shared resources from Track 03 remain real resources:

- files
- notes
- artifacts
- browser resources

Context blocks are not replacements for those records.

Instead, they are prompt-native projections over them.

Examples:

- a note becomes a short `memory` block
- a Markdown playbook becomes a `skill`
- a large spec becomes a `reference` block with `summary` projection

This keeps the resource model and the prompt model separate, which is
important.

## Relationship To Existing Prompt Contracts

Prompt contracts already exist at the runtime edge.

SCO-008 does not remove them. It gives them a cleaner upstream input.

Recommended rule:

- runtime prompt generators should assemble from loadouts and context
  blocks rather than bespoke prompt fragments wherever possible

That keeps semantic ownership in the broker while letting each harness
render the final prompt in its own syntax.

## Suggested Tables

- `context_blocks`
- `context_block_versions`
- `context_loadouts`
- `context_events`
- `context_search_entries`

These tables should sit near:

- `resources`
- `collaboration_records`
- `agents`
- `agent_endpoints`

## Product Implications

### CLI

Recommended commands:

- `scout context list`
- `scout context show <id>`
- `scout skills list`
- `scout skills load <id>`
- `scout memory add --scope <target> ...`

### Surfaces

Surfaces should be able to answer:

- what instructions are shaping this agent?
- what memory is attached to this work?
- what reusable skills exist in this workspace?
- which blocks are inline versus load-on-demand?

## Rollout Phases

### Phase 1: Core Block Model

- add `context_blocks`
- add read-only block inventory
- allow agent and workspace loadouts

### Phase 2: Resource Projections

- project notes, files, and docs into block form
- add summary and loadable projection modes

### Phase 3: Writable Memory

- add narrow broker-approved memory writes
- preserve provenance and mutation events

### Phase 4: Searchable Collections

- add searchable block collections
- expose them uniformly to harnesses

## Risks

- If blocks overlap too much with notes, the model will get muddy.
- If writable memory is too easy, prompts will accumulate stale junk.
- If skills stay filesystem-only, broker surfaces will remain blind to
  them.
- If projection modes are ignored, agents will get giant prompts and poor
  ergonomics.

## Open Questions

- Should skills continue to live on disk with broker indexing, or move into
  broker storage directly?
- What is the minimum safe writable-memory policy for v1?
- Should session-scoped context blocks persist after the session ends, or
  always compact into a broader scope?
- Which search primitive is enough for v1: keyword, tag, or richer semantic
  lookup?
- How should context block ACLs align with resource ACLs when a block is
  derived from a resource?

## Summary

OpenScout has durable work and durable resources, but not yet durable
prompt context.

SCO-008 adds:

- context blocks for prompt-native durable context
- skills for reusable load-on-demand guidance
- loadouts for consistent broker-owned context assembly

That gives the broker a real memory and instruction plane without turning
files, notes, or prompts into the same thing.
