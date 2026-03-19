# OpenScout Architecture

## Working Thesis

OpenScout is the shell and runtime substrate for a family of local-first agent tools.

It is not trying to replace every specialized product. It is trying to provide the place where those products can be invoked, composed, observed, and normalized.

The current scaffold is built around three principles:

1. The shell owns chrome.
2. Helper processes own long-running background work.
3. Workflow and action logic should default to TypeScript, not native code.

## Runtime Shape

### 1. ScoutApp

The main macOS application.

Responsibilities:

- sidebar navigation
- footer status and runtime visibility
- embedded WebKit surface for local or remote operator consoles
- module discovery and presentation
- helper process supervision

### 2. ScoutAgent

The always-on helper.

Responsibilities:

- stay alive independently of the main shell
- publish heartbeat and runtime status
- become the future home for background tasks, watchers, and transport bridges

### 3. ScoutCore

The shared contract layer.

Responsibilities:

- route and shell descriptors
- module metadata
- helper status schema
- support-path conventions

### 4. TypeScript Runtime Packages

The preferred home for workflow logic, action composition, and higher-level orchestration.

Responsibilities:

- workflow definitions and execution
- action catalogs and composition
- provider and gateway routing
- CLI and web-facing runtime logic
- protocol normalization shared across products

## Influence Map

### Talkie

Contributes the most important process lesson: split the operator-facing app from the always-on helper and keep the background role independently reliable.

### Action

Contributes the native runtime lesson: the app shell should own UI lifecycle, WebKit, and permission-facing behavior while the agent runtime owns transport and automation-facing execution.

### Hudson

Contributes the shell lesson: modules do not render or own shell chrome directly. The shell reads their descriptors and decides how to surface them.

## Native vs TypeScript Boundary

Native code should own:

- app lifecycle
- windowing and shell chrome
- WebKit embedding
- helper process lifecycle
- permissions
- capture hooks and other computer-native affordances

TypeScript should own:

- workflows
- actions
- orchestration logic
- provider abstractions
- gateway integration
- CLI and web-facing runtime layers

That keeps Scout easier to evolve and avoids hard-coding product logic into Swift.

## Initial Module Model

The scaffold treats integrations as modules rather than as imported slabs of product code.

Current placeholder modules:

- Talkie
- Lattices
- Action
- Operate
- Hudson

Each module describes:

- a name
- a summary
- an integration mode
- a list of capabilities

That gives Scout a stable way to expose linked systems before deeper embedding exists.

## Integration Modes

- `link`: Scout launches or hands off to another app, runtime, or service
- `embed`: Scout hosts a stable primitive directly inside the shell
- `copy`: temporary extraction path only; avoid by default

The scaffold defaults to `link` so the products can continue evolving independently while Scout grows a coherent shell around them.

## Near-Term Extensions

The next credible steps after this scaffold are:

1. Replace the placeholder helper heartbeat with a real local runtime bridge.
2. Move the first workflow and action primitives into `packages/workflows`.
3. Add a local command palette and command routing model.
4. Add a real embedded HUD or console web app.
5. Promote module descriptors into a formal capability registry.
