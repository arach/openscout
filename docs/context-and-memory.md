# Context and Memory

OpenScout treats memory as constructive state: durable facts, decisions,
constraints, preferences, procedures, artifacts, open loops, and working state
that can help future work. It does not use “history” as the product model.

The implementation has three distinct layers:

1. **Observed session evidence** is a bounded read of harness-owned source
   material. It remains external evidence and carries a source reference.
2. **Memory** is a reviewed, broker-owned context block derived from an
   operator statement or observed evidence.
3. **A context pack** is a task-specific, token-bounded assembly of active
   memory and optional recent evidence. It is the transport used for handoff.

This distinction keeps memory useful and editable without turning the broker
into a transcript warehouse.

## Ownership and provenance

The broker is the canonical writer for `ContextBlock` and `ContextPack`
records. Both are appended to the broker journal and projected into SQLite.
Memory derived from a session must carry at least one `sourceRef`; the reference
names the session observation and may include its digest, capture time, source
path, and decoder diagnostics.

The raw provider transcript is not copied into Scout messages. A distiller may
quote or summarize bounded evidence inside a proposed memory, but the original
file remains owned by its harness. Recording a context pack likewise does not
create conversation messages. Only the later handoff creates a Scout
invocation and its normal coordination records.

## The adapter boundary

There is no dependable universal import/export library for agent sessions.
Providers expose different JSONL records, event names, tool shapes, session
identifiers, and lifecycle semantics. OpenScout therefore keeps the
format-specific work behind observation decoders in
`@openscout/agent-sessions` and converts supported sources into one
`SessionState` read model.

The portable seam is not the provider file format. It is:

```text
harness-owned source
  -> format decoder
  -> SessionState
  -> SessionEvidence (source reference + limitations)
  -> proposed MemoryCandidate
  -> reviewed ContextBlock
  -> bounded ContextPack
  -> new or synthesized-fork execution session
```

Claude Code, Codex, and pi decoding is necessarily format-specific. The
distiller, memory schema, pack assembler, broker persistence, and handoff path
are shared. Supporting another harness should require a decoder into
`SessionState`, not a new memory system.

The existing file decoders may use “history” internally as a technical read
model because they reconstruct prior events from a file. That internal term
must not leak into memory IDs, CLI nouns, or product semantics.

## Memory lifecycle

Memory blocks have one of four states:

- `proposed`: generated from evidence and awaiting review
- `active`: eligible for context-pack assembly
- `superseded`: replaced by a newer version
- `archived`: retained for audit but no longer assembled

Explicit operator-created memory starts active. Automated distillation starts
proposed. `scout memory promote <id>` is the initial review action.

Scopes are explicit: `global`, `workspace`, `agent`, `conversation`,
`work_item`, or `session`. The assembler includes only active, unexpired blocks
that apply to the target. Workspace-scoped blocks must match the target project
path; global blocks may apply everywhere.

## Context-pack assembly

Assembly is deterministic and inspectable. A pack contains:

- a task frame
- applicable active memory, ordered by constructive priority
- optional bounded recent session evidence
- limitations, including source-decoder gaps or token truncation
- all context-block IDs and source references used
- the configured and estimated token budget
- a deterministic content hash

Memory is not itself transport. A context pack is. This means a memory block
can remain concise and reusable while each task receives only the relevant,
bounded combination.

## Synthesized forks and handoff

`scout context handoff` records the assembled pack, renders it into the target
prompt, and dispatches an invocation with:

```json
{
  "session": "fork",
  "forkFromStateId": "ctxpack...",
  "lineage": {
    "forkSourceKind": "scout_state_snapshot",
    "forkSourceId": "ctxpack..."
  }
}
```

This is a synthesized fork, not a claim that every provider can clone a native
thread. The target receives a new execution session seeded with the pack. The
pack ID provides lineage, while the rendered prompt applies the actual bounded
context. Harness-owned turns are evidence, not silently re-authored Scout
messages.

## CLI

```bash
# Add explicit, active constructive memory for the current workspace
scout memory add --kind decision "Keep external transcripts outside Scout messages"

# Decode a supported provider session and propose reviewable memory
scout memory distill --from ~/.codex/sessions/example.jsonl --adapter codex
scout memory list --state proposed
scout memory promote memory.abc123

# Inspect exactly what a target would receive
scout context preview --project . --harness claude \
  --task "Continue the broker implementation"

# Record the pack and dispatch a new execution session with fork lineage
scout context handoff --project . --harness codex \
  --from ~/.codex/sessions/example.jsonl \
  --task "Continue from the reviewed decisions and open loops"
```

The broker exposes `GET/POST /v1/context/blocks` and
`GET/POST /v1/context/packs`. Writes still pass through broker commands and
validation; clients must not write the SQLite projection directly.

## Deliberate v1 limits

- Distillation is conservative and deterministic. It recognizes explicit
  decision/constraint/etc. statements, artifacts, failed actions, unanswered
  questions, and bounded working state. It does not pretend to infer a perfect
  personal memory graph.
- Source decoders cover supported harness formats, not arbitrary chat exports.
- Promotion is an explicit CLI review step. Rich merge, conflict, decay, and
  UI review workflows can build on the same record lifecycle later.
- Context packs are local broker records. Mesh-wide memory replication is not
  implied by the existing mesh coordination model.
