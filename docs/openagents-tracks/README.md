# OpenAgents-Inspired Tracks For OpenScout

This folder breaks the OpenAgents research into four implementation tracks that are mostly independent and can be staffed in parallel.

The important constraint is architectural: OpenScout should keep its current broker-first durable model. These tracks are not a proposal to replace `conversation`, `invocation`, `flight`, `delivery`, or `collaboration_record` semantics with a looser event-only system. They are a proposal to make the seams around that core more explicit, operable, and legible.

## Tracks

1. [Harness Catalog And Onboarding](/Users/arach/dev/openscout/docs/openagents-tracks/01-harness-catalog-and-onboarding.md)
2. [Collaboration Contract](/Users/arach/dev/openscout/docs/openagents-tracks/02-collaboration-contract.md)
3. [Shared Resources](/Users/arach/dev/openscout/docs/openagents-tracks/03-shared-resources.md)
4. [Capability-Aware Shell And Surfaces](/Users/arach/dev/openscout/docs/openagents-tracks/04-capability-aware-shell-and-surfaces.md)

## What Each Track Owns

### Track 01: Harness Catalog And Onboarding

Owns the declarative harness registry and the first-run operator path:

- runtime inventory
- install and readiness checks
- configure and repair flows
- `scout init`, `scout doctor`, and runtime inventory commands
- capability metadata for harnesses

This is the machine truth for "what is available on this box?"

### Track 02: Collaboration Contract

Owns the broker-level semantics shared by all harnesses:

- logical agent identity vs concrete endpoint identity
- mention and delegation rules
- wake rules
- durable work vs conversation boundaries
- adapter prompt contract and normalized lifecycle events

This is the semantic truth for "how do agents collaborate without harness-specific forks?"

### Track 03: Shared Resources

Owns broker-managed durable resources:

- browser sessions
- persistent browser contexts
- shared files and artifacts
- notes
- future credential handles

This is the product truth for "what objects can agents and humans reuse over time?"

### Track 04: Capability-Aware Shell And Surfaces

Owns how the shell and other surfaces render the outputs of the other tracks:

- readiness states
- harness capability visibility
- resource inventory visibility
- onboarding affordances
- native, Electron, web, and CLI/TUI presentation

This is the surface truth for "what can the operator understand and do right now?"

## Dependency Shape

These tracks are parallelizable, but they are not equally foundational.

### Hard Dependencies

- Track 04 depends on Track 01 for capability and readiness data.
- Track 04 depends on Track 03 for resource inventory and resource state.
- Track 02 should inform Track 04 where UI needs to expose ownership, wake target, and waiting/review semantics.

### Soft Dependencies

- Track 01 and Track 02 can proceed in parallel.
- Track 01 and Track 03 can proceed in parallel.
- Track 02 and Track 03 should coordinate on identity and access-control fields, but neither should block the other initially.

## Recommended Build Order

If staffing is constrained, build in this order:

1. Track 02: collaboration contract
2. Track 01: harness catalog and onboarding
3. Track 03: shared resources
4. Track 04: capability-aware shell and surfaces

Why this order:

- Track 02 freezes the semantics that adapters and broker logic need.
- Track 01 makes runtime capability and onboarding explicit, which the shell needs early.
- Track 03 creates the durable objects the product should expose.
- Track 04 is strongest once the underlying catalog and resource models are real.

If staffing is available, the practical execution pattern is:

1. Run Track 01 and Track 02 in parallel.
2. Start Track 03 once the core identity and ownership assumptions are stable enough.
3. Start Track 04 after Track 01 has a usable readiness vocabulary and Track 03 has a minimally stable resource model.

## Suggested Team Split

### Lane A: Broker Semantics

Own:

- Track 02
- the broker-facing parts of Track 03

Suggested code areas:

- [packages/runtime/src/schema.ts](/Users/arach/dev/openscout/packages/runtime/src/schema.ts)
- [packages/runtime/src/registry.ts](/Users/arach/dev/openscout/packages/runtime/src/registry.ts)
- [docs/ARCHITECTURE.md](/Users/arach/dev/openscout/docs/ARCHITECTURE.md)
- [docs/collaboration-workflows-v1.md](/Users/arach/dev/openscout/docs/collaboration-workflows-v1.md)

### Lane B: Runtime Inventory And Onboarding

Own:

- Track 01

Suggested code areas:

- [packages/runtime/src](/Users/arach/dev/openscout/packages/runtime/src)
- [docs/native-runtime.md](/Users/arach/dev/openscout/docs/native-runtime.md)
- [apps/desktop/src/app](/Users/arach/dev/openscout/apps/desktop/src/app)

### Lane C: Surfaces And Product UX

Own:

- Track 04
- shell-facing integration points from Track 01 and Track 03

Suggested code areas:

- [apps/desktop/src/ui/shell](/Users/arach/dev/openscout/apps/desktop/src/ui/shell)
- [packages/electron-app/electron](/Users/arach/dev/openscout/packages/electron-app/electron)
- [apps/desktop/src/app/electron](/Users/arach/dev/openscout/apps/desktop/src/app/electron)

## Recommended First Milestones

### Milestone 1

Freeze nouns and readiness vocabulary.

Deliverables:

- collaboration contract doc accepted
- harness readiness states accepted
- one canonical capability vocabulary accepted

### Milestone 2

Make the runtime produce normalized inventory.

Deliverables:

- harness catalog snapshot
- readiness evaluation output
- initial resource inventory snapshot

### Milestone 3

Expose the normalized inventory in one surface.

Deliverables:

- shell or CLI inventory view
- clear install vs configured vs ready distinction
- initial browser context and file resource visibility

### Milestone 4

Standardize adapter behavior.

Deliverables:

- one shared collaboration prompt contract
- broker-owned wake rules
- stable logical-agent to endpoint mapping

## Immediate Follow-Up

Finish the move to a direct agent model.

The remaining local-runtime concept is "project-scoped agent kept warm on a transport", which should be modeled directly as:

- agent definition
- harness
- transport
- endpoint
- broker-owned state

What to do next:

- remove leftover legacy registry and storage names instead of extending compatibility layers
- migrate storage and registry language to `project agents` or `local agents`
- treat tmux-backed agents as one transport in the harness catalog, not a separate ontology
- remove legacy wrapper terminology from prompts, logs, shell copy, and operator surfaces

This is not a new track. It is a cleanup pass that cuts across Track 01 and Track 04, with smaller follow-through in Track 02 where prompts and wake semantics still assume the old wrapper model.

## Root Architectural Rule

OpenScout should steal the product ideas, not the ontology.

The strongest lessons from OpenAgents are:

- make harness support declarative
- make collaboration rules explicit
- make shared resources first-class
- make onboarding and readiness obvious

The part to preserve from OpenScout is the stronger durable core:

- explicit conversations
- explicit work and invocations
- explicit flights and deliveries
- explicit ownership and recovery

If a proposal in these tracks weakens that durable control-plane story, it should be rejected or rewritten.
