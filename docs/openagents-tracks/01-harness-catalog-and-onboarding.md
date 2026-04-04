# Track 01: Harness Catalog And Onboarding

## Why This Track Exists

OpenScout already has the right architectural direction in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`packages/runtime/README.md`](../../packages/runtime/README.md): the runtime is the source of truth, the shell is presentation, and harness-specific behavior should stay behind adapters. This track makes that concrete by turning "what runtimes exist on this machine?" into a declarative catalog with explicit readiness, install, and configure states.

The point is not just listing agents. The point is to remove guesswork for operators:

- what harnesses are available
- which ones are installed
- which ones are configured enough to run
- which ones are discoverable but missing dependencies
- how to install or repair them from one place

## Goals

- Define a declarative harness catalog that can describe local runtimes, their support level, and their readiness state.
- Make runtime discovery layered and deterministic instead of scattered across ad hoc scans.
- Give the CLI, broker, and desktop shell one shared vocabulary for install, configure, and ready states.
- Replace legacy wrapper-specific registry concepts with direct agent, harness, and transport inventory.
- Make `scout init` and `scout doctor` useful as onboarding commands instead of thin wrappers.
- Surface harness capabilities in the shell so an operator can see what each runtime can actually do.

## Non-Goals

- Do not redesign the OpenScout protocol or durable work model here. That belongs to the control-plane track.
- Do not hard-code every agent adapter into the shell. The catalog should describe capabilities, not become a second adapter implementation.
- Do not require network access for basic discovery. Remote metadata can enrich the catalog, but local operation must work offline.
- Do not make the catalog the source of truth for broker state. It is a registry of harnesses and their readiness, not a work ledger.

## Implementation Shape

The cleanest shape is a layered catalog:

- Built-in catalog entries shipped with the repo for known harnesses.
- Machine-local overrides in the OpenScout support directory.
- Repo-local manifests for project-specific harnesses.
- Optional remote metadata for labels, install docs, or featured ordering.

This matches the existing split between machine settings, repo manifests, and discovered agents described in [`packages/runtime/README.md`](../../packages/runtime/README.md).

### Proposed Data Model

The catalog entry should be explicit about identity, install behavior, and readiness. A single entry should answer:

- what this harness is called
- how the shell should display it
- how to detect it locally
- how to install it
- how to check if it is ready
- what capabilities it supports
- whether it is shell-only, broker-backed, or both

Suggested shape:

```ts
type HarnessSupport = {
  install: boolean;
  workspace: boolean;
  collaboration: boolean;
  browser?: boolean;
  files?: boolean;
  tunnels?: boolean;
};

type HarnessReadiness = {
  installed: boolean;
  configured: boolean;
  ready: boolean;
  detail: string;
  missing: string[];
};

type HarnessCatalogEntry = {
  name: string;
  label: string;
  description: string;
  homepage?: string;
  tags: string[];
  featured?: boolean;
  order?: number;
  support: HarnessSupport;
  install?: {
    binary?: string;
    macos?: string;
    linux?: string;
    windows?: string;
    requires?: string[];
    verify?: string;
    verifyWin?: string;
  };
  readiness?: {
    envVars?: string[];
    savedEnvKey?: string;
    credsFile?: string;
    credsKey?: string | null;
    loginCommand?: string | null;
    notReadyMessage?: string;
  };
  launch?: {
    args?: string[];
  };
  resolveEnv?: Array<{ from: string; to: string }>;
  capabilities?: string[];
};
```

The catalog should be serializable to JSON so it can live in both the runtime and desktop layers without custom parsing logic.

## Discovery Rules

Discovery should be deterministic and layered:

1. Load built-in entries from the repo or packaged runtime.
2. Merge machine-local overrides from the OpenScout support directory.
3. Merge repo-local manifests from `.openscout/project.json` when a workspace defines project-backed agents.
4. Optionally enrich with remote registry metadata when online.

The important rule is that discovery never hides the local truth. If a runtime is installed but missing credentials, that is a local fact and must remain visible even if remote metadata says the harness is supported.

## CLI Commands

The onboarding surface should be built around a small, obvious command set:

- `scout init` should discover workspace roots, write machine-local settings, materialize project manifests when needed, and populate the harness catalog cache.
- `scout doctor` should report broker reachability, support paths, catalog health, and per-harness readiness.
- `scout runtimes` should list catalog entries with support and readiness state.
- `scout runtimes install <name>` should install or update one harness.
- `scout runtimes configure <name>` should open the minimal configuration flow for missing credentials or env vars.
- `scout runtimes info <name>` should explain install status, readiness requirements, and capability flags.
- `scout runtimes refresh` should re-run discovery and remote enrichment.

The track should explicitly reuse the onboarding commands now owned by the Scout app and CLI, and the support-directory model described in [`docs/native-runtime.md`](../native-runtime.md).

## Broker And Runtime Responsibilities

The broker/runtime layer should own:

- the canonical catalog cache
- readiness evaluation
- installation side effects
- path resolution for support files
- per-harness capability projection for CLI and UI

The shell should not shell out to rediscover harnesses on every render. It should request a normalized catalog snapshot from the runtime and render that snapshot.

Suggested runtime responsibilities:

- `catalog.load()`
- `catalog.refresh()`
- `catalog.evaluateReadiness(name)`
- `catalog.install(name)`
- `catalog.configure(name)`
- `catalog.listVisibleCapabilities()`

As part of this track, the runtime should model a tmux-backed project agent directly as an agent endpoint using a harness and transport, not as a separate legacy object class.

The runtime should also track why a harness is not ready, not just whether it is not ready. A single boolean is not enough for onboarding.

## Desktop UI Implications

The current desktop shell should expose broker and helper health in the same spirit as the earlier native prototype, but now through Scout-owned app and desktop modules. This track should add a harness-focused panel that:

- show installed, configured, ready, and failed states side by side
- show missing requirements as actionable text, not just a red dot
- show the install command or configure action inline
- show capabilities with short labels such as `workspace`, `collaboration`, `browser`, `files`
- keep broker and harness statuses visually distinct so operators do not confuse "broker up" with "harness ready"

The shell should answer three questions at a glance:

- is the broker healthy
- which harnesses are available
- what do I need to do to make one usable

## Rollout Phases

### Phase 1

- Define the catalog schema in TypeScript and mirror it in any native model that needs it.
- Add a built-in registry for the current supported harnesses.
- Implement local readiness checks for installed/configured/ready states.
- Wire `scout doctor` to report catalog state.

### Phase 2

- Add install and configure flows for one or two harnesses end to end.
- Add a catalog view to the desktop shell.
- Cache the catalog in the OpenScout support directory and refresh it on demand.
- Remove leftover legacy registry files and transport-specific operator copy instead of extending compatibility-backed migration paths.

### Phase 3

- Add remote registry enrichment for labels, feature ordering, and docs links.
- Add project-local overrides for repo-backed harnesses.
- Add support-aware surfacing in the shell and CLI.

## Testing And Verification

- Add unit tests for merge order, local override precedence, and remote fallback behavior.
- Add readiness tests for missing binary, missing env var, missing credentials file, and fully configured cases.
- Add CLI tests for `scout init`, `scout doctor`, and the runtime list/install/configure commands.
- Add shell tests or snapshot coverage for installed vs ready display states.
- Verify the catalog is stable offline and does not depend on the remote registry for basic operation.

## Risks

- A single boolean readiness state will be too coarse and will hide useful onboarding detail.
- Remote registry data can drift from local reality if merge precedence is not strict.
- If install logic becomes shell-specific instead of runtime-owned, the onboarding path will fragment.
- If the shell reimplements catalog discovery, the same logic will diverge across native, CLI, and web surfaces.

## Open Questions

- Should the canonical local cache live beside the existing OpenScout support files or under a dedicated `catalog/` subdirectory?
- Should project-local harness manifests reuse `.openscout/project.json` or introduce a separate `harnesses.json` file?
- Which harness capabilities are required for a runtime to be considered "workspace-capable" versus merely "installed"?
- Should configuration repair be interactive in the shell, or should it primarily open the minimal external auth/login flow?
- Which commands belong in the product CLI versus the relay compatibility CLI?

## Source Anchors

- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`docs/native-runtime.md`](../native-runtime.md)
- [`packages/runtime/README.md`](../../packages/runtime/README.md)
- [`apps/scout/src/app/electron/settings.ts`](../../apps/scout/src/app/electron/settings.ts)
- [`apps/scout/src/ui/desktop/app.tsx`](../../apps/scout/src/ui/desktop/app.tsx)
