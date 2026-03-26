---
id: PLN-8921
agent: Codex
twin: codex-twin
status: awaiting-review
updated: 2026-03-26T09:12:00-04:00
summary: Add a read-only plans inventory with markdown previews, file-backed metadata, and simple follow-up actions.
tags: shell, plans, inventory
---
# Plans Inventory Screen

## Objective
Create one place to review recent plan artifacts without turning Scout into a full editor.

## Workflow
- [x] Establish a file-backed `plans/` convention for markdown sources.
- [ ] Build a searchable inventory with status, ownership, and progress.
- [ ] Add a read-only markdown preview with commands for twin follow-up and local editing.

## Constraints
- Keep this first pass read-only inside the shell.
- Preserve the native-shell tone instead of dropping into a marketing layout.
- Prefer file paths and shell commands over custom editor integrations.

## Open Questions
1. Should the inventory stay repo-local first or merge plan files across linked workspaces?
2. Do we need version history immediately, or just the latest markdown snapshot for each plan?
