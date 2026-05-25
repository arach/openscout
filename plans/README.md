# Plans

Living strategy + planning docs for OpenScout. Anything in this folder
is rendered by the studio at `/plans` (see `design/studio`).

Difference from `docs/`:

- **docs/** — reference material, architecture notes, integration
  guides. Long-lived, often-read, written once.
- **plans/** — what we're going to do and why. Each plan has a status
  (draft / in-flight / shipped / shelved / concept) and decays over
  time. A shipped plan is a record, not a TODO.

## File conventions

One plan per `.md`, kebab-case slug. Frontmatter:

```yaml
---
title: Inspector atom rollout
status: in-flight        # draft | in-flight | shipped | shelved | concept
blurb: Two-PR plan to extract shared inspector atoms.
source:                  # related code/docs paths (optional)
  - docs/inspector-bar-audit.md
order: 10                # ascending; lower floats to top of sidebar
---
```

Files starting with `_` or `.` are ignored. `README.md` (this file) is
treated as the bucket intro and exposed at `/plans` rather than as its
own entry.

## When to write one

- A multi-PR refactor whose moving pieces need to stay coherent across
  sessions.
- A direction the team needs to align on before code lands.
- A "we tried X, here's why we're not doing it" record that future-you
  will be grateful for.

When to NOT write one:

- A single-PR change. Use the PR description.
- A bug. Use the commit message.
- An audit / analysis without a recommendation. Put it in `docs/`.
