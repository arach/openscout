# Scout Compatibility App

This directory exists for stale prompts, scripts, and local habits that still
refer to the old `apps/scout` path. The only source entrypoint is
[`bin/scout.ts`](./bin/scout.ts), which forwards to the public CLI package.

New desktop and CLI work belongs in:

- [`../desktop`](../desktop) for app and CLI command handlers
- [`../../packages/cli`](../../packages/cli) for the public `@openscout/scout`
  package
- [`../../packages/runtime`](../../packages/runtime) for broker/runtime behavior

Do not add new product implementation here unless it is part of a deliberate
compatibility migration.
