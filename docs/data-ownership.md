# Data Ownership

OpenScout is a control plane, not a transcript warehouse. Its storage model starts with a simple boundary: Scout owns the records it creates or routes, and observes external harness records without importing them wholesale.

This matters for product scope, operator trust, and system design. The broker should make agent coordination durable without pretending to become the canonical database for every model turn written by Claude Code, Codex, or any future harness.

## What Scout Owns

Scout owns first-party control-plane records:

- nodes, actors, agents, endpoints, and bindings registered with the broker
- conversations, messages, forwards, and replies created through Scout
- invocations, flights, deliveries, delivery attempts, and dispatch records
- collaboration records such as questions and work items when they are created through Scout
- local read models and activity projections derived from those first-party records

These records are broker-owned facts. They can be persisted, replayed, projected into SQLite, forwarded across mesh peers, and shown consistently across CLI, desktop, mobile, and agent tools.

## What Scout Observes

Scout observes external harness source material:

- Claude Code transcript JSONL
- Codex session JSONL
- harness-specific logs, turn streams, and file-backed history
- process and filesystem signals that help explain what is running now

These sources are not Scout-owned conversation state. Scout may discover them, tail them, summarize them, link to them, index lightweight metadata, or expose live views over them. Scout should not bulk-copy external transcript turns into its control-plane database and treat them as first-party messages.

## Current Posture

The intentional split today is:

- the broker journal records Scout-owned control-plane facts
- SQLite stores query projections of Scout-owned facts for local surfaces
- tail adapters read external harness transcripts from their original files
- tail views keep bounded live/backlog buffers rather than becoming durable transcript replicas

If a surface needs raw harness detail, it should prefer the original harness material through an adapter, cursor, or link. If a workflow needs durable coordination, it should create a Scout-owned message, invocation, flight, delivery, or work item.

## Design Rules

1. Do not make Scout the canonical store for external harness transcripts.
2. Do not persist every observed harness turn as a Scout `message`.
3. Do persist Scout-originated and Scout-routed coordination records.
4. Do use lightweight metadata, cursors, summaries, and links when external source material needs to appear in Scout surfaces.
5. Do keep the boundary visible in docs and APIs: `message` means a Scout conversation record, while `TailEvent` means an observed harness event.

This is an intentional product and architecture boundary, not just a current implementation shortcut. Scout may grow better indexing and replay tools over time, but those should preserve the distinction between owned coordination state and observed harness source material.
