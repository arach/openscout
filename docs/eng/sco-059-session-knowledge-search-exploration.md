# SCO-059: Session Knowledge Search Exploration

## Status

Concept.

## Proposal ID

`sco-059`

## Intent

Explore the shape of Scout session/history search as an idea-navigation problem
before committing to the in-product search surface. The goal is to separate
the Studio exploration space from the shipped OpenScout web UI: Studio is where
we compare concepts, vocabulary, budgets, and workflows; the product Search
surface is where a chosen model eventually becomes operational.

## Context

Recent discussion mixed two surfaces:

- **Studio**: an internal exploration app for navigating ideas, product
  concepts, and design decisions.
- **Search**: an in-product OpenScout surface for session knowledge, fuzzy
  retrieval, and raw-log drilldown.

The current prototype belongs to Search, not Studio. It describes an indexable
knowledge workflow over observed harness transcripts. The Studio should host
the exploration around whether that workflow is the right one, what it should
feel like, and how much work/cost it implies for a heavy local user.

This doc anchors that exploration with a concrete seven-day sample from the
local machine.

## Local Sample

Seven-day observed footprint on this machine:

| Source | Files | Raw size |
| --- | ---: | ---: |
| Codex sessions | 78 | 191 MiB |
| Claude main sessions | 72 | 228 MiB |
| Claude subagent logs | 114 | 56 MiB |
| Claude history | 1 | 13 MiB |
| **All observed** | **266** | **489 MiB** |

Representative session spread:

| Harness | Tier | Size | Events | Modified |
| --- | --- | ---: | ---: | --- |
| Codex | large | 13.0 MiB | 4,220 | 2026-05-29 23:29 |
| Codex | normal | 1.1 MiB | 494 | 2026-05-25 15:45 |
| Codex | small | 34 KiB | 12 | 2026-05-29 00:16 |
| Claude | large | 52.9 MiB | 12,009 | 2026-05-26 02:49 |
| Claude | normal | 745 KiB | 252 | 2026-05-23 13:11 |
| Claude | small | 2.1 KiB | 5 | 2026-05-24 21:57 |

## Product Shape To Explore

The strongest shape is a two-speed system:

1. **Mechanical index first.** Discover files, parse JSONL, normalize events,
   produce QMD-style markdown chunks, build FTS/fuzzy indexes, and preserve
   source anchors. This should finish in minutes for a heavy week.
2. **LLM enrichment later.** Summarize selected chunks into decisions, files,
   problems, unresolved threads, and useful session labels. This must be
   bounded, resumable, and optional.

The user should be able to start searching before enrichment is complete.

## Budget Sketch

For a week around 489 MiB raw JSONL:

| Stage | Input | Output | Expected timing |
| --- | --- | --- | --- |
| Inventory | 266 files | session manifest | 1-5s |
| Mechanical extraction | raw JSONL | 25-100 MiB markdown | 30-120s |
| FTS/fuzzy index | derived markdown | 75-300 MiB SQLite | 30-180s |
| First useful query | local index | ranked hits + source refs | under 100ms |
| LLM enrichment | selected chunks | decisions/files/problems | 10-60m async |

These are working estimates, not guarantees. The important architecture
constraint is that search must not wait for full LLM enrichment.

## Search Questions

Studio should help compare answers to questions like:

- Which recent sessions touched this area of the codebase?
- What was I working on when this decision happened?
- Which session had the useful plan, error, or file path?
- Was this conversation a Codex thread, a Claude main session, or a Claude
  subagent side quest?
- Do I need the raw transcript, or is the derived knowledge enough?

## Surface Boundary

The product Search surface can be action-oriented:

- select a date range
- choose harnesses
- build or refresh the local index
- inspect freshness and cost
- search derived knowledge
- drill into raw source spans

The Studio exploration should remain idea-oriented:

- compare workflows
- tune vocabulary
- show sizing and cost models
- map data ownership boundaries
- decide what becomes product UI

## Data Ownership Rule

External harness transcripts remain observed source material. Scout should not
bulk-import Codex or Claude transcript lines as Scout-owned messages. Scout can
own derived knowledge records, index metadata, source references, user-created
collections, and broker-owned coordination records.

## Open Decisions

- Should the first product version index Claude subagent logs by default, or
  keep them behind an advanced toggle?
- Should "normal" sessions be selected by file size, event count, duration, or
  inferred task continuity?
- How much LLM enrichment should run automatically versus only after a user
  marks sessions as interesting?
- Should the search index live per machine, per project, or per explicit
  session collection?
- What is the smallest derived document format that still supports good
  conversation and exact raw drilldown?
