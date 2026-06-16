# SCO-040: Implementation Plan

Companion to
[sco-040-capability-registry-and-tool-boundaries.md](./sco-040-capability-registry-and-tool-boundaries.md).

## Status

Draft.

## Intent

Land the capability matrix as a series of small, useful slices. The plan starts
with a protocol spine, then layers discovery, readiness, diagnostics, routing,
and presentation on top.

The shape should scale without Scout hand-authoring every tool, model, or
runtime feature. Structured protocol metadata, adapter reports, probes, and
observed execution facts should do most of the work. Human curation should make
the experience better; it should not be required for basic discovery.

## Product Rules

1. The matrix is a Scout read model before it is an execution system.
2. Preserve raw discovered metadata with provenance before normalizing it.
3. Normalize shallowly: source, method, schema, effect, boundary, readiness,
   evidence, freshness, trust, and downgrade.
4. Treat protocol annotations as hints unless Scout verifies or enforces them.
5. `unknown` is a valid state, not a failure to hide.
6. Capability overlap with external runtimes or protocols is acceptable when
   Scout needs a clearer routing, permission, or inspection answer.
7. Do not store secret values in capability records, source snapshots, or audit
   facts.

## Slice 0: Protocol Spine

### Goal

Define the shared matrix vocabulary so runtime, broker, CLI, and UI can all
consume the same shapes.

### Deliverables

- `ScoutCapabilityMatrixSnapshot`
- `ScoutCapabilityMatrixSource`
- `ScoutCapabilityDefinition`
- source, evidence, readiness, effect, enforcement, and provenance types
- MCP tool discovery normalizer for the first structured protocol source

### Acceptance Criteria

- Protocol types compile and are exported from `@openscout/protocol`.
- MCP `tools/list` payloads can normalize into Scout capability definitions.
- MCP annotations are represented as advisory hints.
- Empty or underspecified capabilities remain `unknown` rather than invented.

### Current State

Implemented as the first code slice.

## Slice 1: Runtime Composer

### Goal

Compose protocol, harness, provider, model, probe, and annotation inputs into
one runtime-side snapshot without adding broker persistence yet.

### Deliverables

- runtime helper that accepts discovered MCP tools, harness support reports,
  provider/model catalog snippets, runtime probe reports, and annotations
- deterministic snapshot generation with one timestamp, source list,
  capabilities list, warnings, and harness support map
- duplicate capability handling with stable ids

### Acceptance Criteria

- A caller can build a capability snapshot from mixed source inputs.
- MCP-derived capabilities and non-MCP source records appear in the same
  snapshot.
- Harness feature support is keyed by harness/source id.
- The helper is pure and testable without spawning any MCP server.

### Current State

Implemented as an internal runtime helper, not as a new package surface.

## Slice 2: MCP Discovery Adapter

### Goal

Turn configured MCP servers into discovered source inputs for the runtime
composer.

### Deliverables

- read configured MCP server entries from existing project or runtime config
  surfaces
- initialize each reachable server enough to collect server capabilities
- call `tools/list`, and later `resources/list`, `resources/templates/list`,
  and `prompts/list`
- record failed or unreachable servers as degraded source records with reasons

### Acceptance Criteria

- A configured MCP server contributes raw source metadata and normalized tool
  capabilities.
- An unreachable server produces an actionable warning rather than disappearing.
- Discovery never invokes a tool.
- Secret values and raw credentials are not persisted in source records.

### Current State

Implemented as an internal discovery adapter plus optional structured
`mcp-servers.json` catalog ingestion. Reading every possible host config remains
a follow-up integration task.

## Slice 3: Harness Feature Reports

### Goal

Put lifecycle and observation support beside tool support.

### Deliverables

- project existing `HarnessFeatureSupportMap` values into capability snapshots
- add source records for adapter feature coverage
- attach evidence refs to adapter specs, runtime checks, or upstream protocol
  facts

### Acceptance Criteria

- The matrix can answer whether a harness supports start, resume, interrupt,
  trace observe, approvals, questions, subagents, MCP transports, logs, and raw
  transcript access.
- Partial support includes a reason and downgrade path.
- UI and routing code can consume this without special-casing harness reports.

### Current State

Implemented from the existing harness catalog with conservative `unknown` and
`partial` defaults where the catalog does not prove support.

## Slice 4: Readiness Probes

### Goal

Separate declared capability from current local usability.

### Deliverables

- binary-installed probes
- credential/env presence probes
- endpoint reachability probes
- workspace/resource availability probes
- MCP server launch/reachability probes
- trace-source availability probes

### Acceptance Criteria

- Each probe produces evidence with checked time and reason.
- Missing, degraded, ready, disabled, and unknown states are distinct.
- Probe records do not contain secret values.
- `scout doctor` can reuse the same readiness facts later.

### Current State

Harness readiness reports now project into runtime probe source records.

## Slice 5: Broker Read Endpoint

### Goal

Make the matrix available through Scout's control plane.

### Deliverables

- broker-side capability snapshot builder
- in-memory cache with explicit refresh path
- endpoint or RPC to read current snapshot by project/session/agent scope
- optional debug flag to include raw source records

### Acceptance Criteria

- CLI and UI can request the same normalized snapshot.
- Refresh and cache age are visible.
- The broker remains the read-model composer, not the executor for every
  capability.

### Current State

Implemented as `/v1/capabilities` through the existing broker read path with
in-memory and local file cache, plus `force=1` refresh.

## Slice 6: CLI And Doctor Surfacing

### Goal

Expose the matrix where operators already look first.

### Deliverables

- `scout capabilities` or equivalent inventory command
- `scout capabilities --project <path>`
- `scout doctor` section for capability readiness
- JSON output for automation

### Acceptance Criteria

- Operators can see available, degraded, missing, and unknown capabilities.
- Output explains why a capability is unavailable.
- Unknown/advisory states are labeled honestly.
- CLI output is useful before any polished UI work lands.

### Current State

Implemented through existing `doctor` and `runtimes` readouts rather than a new
top-level command.

## Slice 7: Routing Diagnostics

### Goal

Use the matrix to explain routing decisions before it takes over routing.

### Deliverables

- typed decision records for allow, deny, require approval, require
  environment, downgrade, and unknown
- diagnostic helper that explains missing capability, missing readiness,
  unsupported harness feature, or policy block
- compact audit facts for capability decisions

### Acceptance Criteria

- A failed or downgraded route can say exactly which matrix fact caused it.
- Decision facts do not copy raw tool outputs or secrets.
- Routing can keep existing behavior while diagnostics improve.

### Current State

Implemented as a protocol availability helper and broker read endpoint at
`/v1/capabilities/availability`.

## Slice 8: Provider And Model Catalogs

### Goal

Add provider/model capability facts without coupling them to one hosted catalog.

### Deliverables

- model input/output modality records
- streaming, tool-calling, structured-output, embedding, context-limit, and
  usage-telemetry flags
- provenance for built-in, local, configured, or fetched metadata
- freshness and override rules

### Acceptance Criteria

- Routing hints can ask for capabilities like structured output or embeddings.
- Missing or stale provider/model metadata is visible as unknown, not guessed.
- Local operation does not depend on a hosted registry.

### Current State

Implemented with an optional local `model-catalog.json` feed under the existing
catalog directory.

## Slice 9: Persistence And Refresh Policy

### Goal

Avoid rediscovering everything constantly while keeping staleness visible.

### Deliverables

- local cache for raw source records and normalized snapshots
- TTL/freshness metadata per source
- manual refresh command
- startup refresh strategy that does not block the broker

### Acceptance Criteria

- Stale data is labeled stale.
- Cache corruption or missing cache falls back to fresh discovery.
- Cache records remain bounded and secret-free.

### Current State

Partially implemented with a bounded local cache and explicit refresh. Richer
per-source stale labels remain a follow-up.

## Slice 10: Inspector And Debug Bundles

### Goal

Make capability evidence visible during run inspection.

### Deliverables

- inspector source refs for capability decisions
- debug bundle section for capability snapshot excerpts
- links from denied/degraded actions to source evidence

### Acceptance Criteria

- A run can explain which capability, readiness, or policy fact affected it.
- Debug bundles include compact evidence, not unbounded raw payloads.
- Inspector remains read-only over broker-owned records and observed source
  material.

### Current State

Prepared in the inspector/debug-surface proposal. Product UI work is deferred.

## Slice 11: UI Presentation And Result Cards

### Goal

Turn the read model into useful product surfaces after the routing and debug
spine exists.

### Deliverables

- capability inventory panels
- readiness badges backed by matrix state
- typed action/result cards for high-value repeated tool classes
- generic action block fallback for unknown or untyped tools

### Acceptance Criteria

- UI cards are projections over trace blocks, artifacts, capabilities, and
  source refs.
- A missing renderer still shows bounded readable output.
- Cards do not become a new canonical execution model.

### Current State

Approved as a later presentation direction and documented in `sco-054`; not
part of the current implementation push.

## Suggested Order

1. Finish Slice 1 runtime composer.
2. Add Slice 2 MCP discovery for configured servers.
3. Add Slice 3 harness reports.
4. Add Slice 4 readiness probes.
5. Add Slice 6 CLI readout before broader broker/UI work if it can consume a
   local snapshot directly.
6. Add Slice 5 broker endpoint once the snapshot shape has survived CLI use.
7. Add Slice 7 routing diagnostics.
8. Add Slice 8 provider/model metadata.
9. Add Slice 9 persistence and refresh policy.
10. Add Slice 10 inspector/debug bundle projection.
11. Add Slice 11 richer UI/result-card presentation.

## Done Definition

SCO-040 is done when Scout can:

- discover structured protocol capabilities without hand-authored entries
- combine protocol, harness, model/provider, readiness, and observed evidence
  in one matrix
- expose that matrix through CLI and broker read surfaces
- explain routing allow/deny/downgrade decisions from matrix facts
- keep unknown, advisory, stale, and enforced states visually and semantically
  distinct
- support richer UI cards as projections rather than a separate tool-result
  state model
