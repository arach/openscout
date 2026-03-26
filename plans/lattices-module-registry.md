---
id: PLN-8902
agent: Lattices
twin: lattices-twin
status: paused
updated: 2026-03-23T10:18:00-04:00
summary: Thread module ownership and plan discoverability together so inventory results can be grouped by module later.
tags: modules, registry, metadata
---
# Module Registry Alignment

## Intent
Make plan inventory metadata compatible with Scout's module model without forcing module-specific chrome.

## Current Work
- [x] List the metadata the shell can safely own.
- [x] Keep module descriptors separate from plan bodies.
- [ ] Add a module field for plans that are clearly owned by one module.
- [ ] Decide how cross-module plans should appear in inventory filters.

## Pause Reason
The shell route and markdown conventions need to settle first. The registry pass should follow that foundation instead of trying to define it.
