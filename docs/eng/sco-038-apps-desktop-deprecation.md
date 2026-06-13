# SCO-038: `apps/desktop` Deprecation

## Status

In progress. `apps/desktop` is a transitional source tree, not the canonical app
home.

## Boundary

- `packages/web` owns the current local web UI and Bun web server.
- `packages/cli` owns the public `@openscout/scout` package and installed
  `scout` command.
- `packages/runtime` owns shared broker/runtime/control-plane services.
- `apps/macos` owns native macOS menu bar and local shell affordances.
- `apps/desktop` may keep compatibility shims while code is moving. The target
  state is that package code does not import or bundle implementation from it.
  The current known exception is `packages/cli/src/main.ts`, which still imports
  the old `apps/desktop/src/cli/main.ts` command tree.

`packages/` is a distribution/dependency boundary. A package may expose an
executable or bundled server. The target dependency direction is: apps may
consume packages; packages should not consume apps.

## Deprecated Areas

- `apps/desktop/src/server`: retired desktop web/control-plane server path.
  Current server work belongs in `packages/web/server`.
- `apps/desktop/src/app/desktop`: old desktop shell state/model. Native-specific
  behavior should move to `apps/macos`; shared state should move to packages.
- `apps/desktop/bin/pairing-runtime-controller.ts`: transitional source wrapper.
  Package builds should use `packages/web/server/pairing-runtime-controller.ts`.

## Transitional Areas

- `apps/desktop/src/cli`: current CLI implementation until moved under
  `packages/cli/src`.
- `apps/desktop/src/core/mcp`: current MCP implementation until moved under a
  package-owned boundary.
- `apps/desktop/src/core/broker`, `pairing`, `mobile`, `setup`, and `mesh`:
  shared service logic to migrate in narrow slices.
- `apps/desktop/src/ui/terminal`: terminal presentation used by CLI flows.

## Exit Criteria

- `packages/cli/src/main.ts` no longer imports from `apps/desktop`.
- Package build scripts do not bundle files from `apps/desktop`.
- macOS and development scripts do not use `apps/desktop/bin/*` as source
  fallbacks.
- `apps/desktop/src/server` is deleted or replaced by explicit compatibility
  errors that point to `packages/web`.
- Shared service code used by web, CLI, MCP, mobile, or native shells lives in
  packages.
- `apps/desktop` is removed from root checks or reduced to a tiny compatibility
  package with no product logic.
