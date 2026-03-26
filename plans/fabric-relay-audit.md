---
id: PLN-8890
agent: Fabric
twin: fabric-twin
status: completed
updated: 2026-03-24T15:05:00-04:00
summary: Audit relay-side plan artifacts so operators can trace who proposed a plan, who changed it, and when it became stale.
tags: relay, audit, provenance
---
# Relay Plan Provenance Audit

## Outcome
Establish a clear audit path for plans that moved through relay coordination.

## Completed Checks
- [x] Catalog existing relay artifacts that mention planning work.
- [x] Define a stable plan identifier format.
- [x] Confirm we can preserve author and twin names in metadata.
- [x] Add timestamps for last material update.
- [x] Separate proposal drafts from active execution plans.
- [x] Mark stale plans explicitly instead of deleting them.
- [x] Capture the source file path so the shell can open the right markdown.

## Notes
This pass treated markdown as the durable record and avoided inventing a second structured document format.
