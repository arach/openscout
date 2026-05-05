# Host Integrations

OpenScout's core broker, runtime, protocol, CLI, desktop app, and mobile app live
in this repository. Host-specific integrations can live beside this repo when
they are independently installable packages for another host's plugin or
extension system.

This keeps the OpenScout root focused on the product control plane while still
making the integration surface discoverable.

## Current Integrations

| Host | Repository | Purpose |
| --- | --- | --- |
| pi | [`arach/pi-scout`](https://github.com/arach/pi-scout) | pi extension for Scout `send`, `ask`, `who`, and broker-backed coordination from pi sessions. |
| Claude Code | [`arach/claude-scout`](https://github.com/arach/claude-scout) | Claude Code plugin with `/scout:*` commands and Scout channel integration. |
| Codex | repo-local [`plugins/scout`](../plugins/scout/README.md) | Codex plugin wrapper for Scout MCP. This is still repo-local while the Codex plugin packaging path is incubating. |

## Relationship To This Repo

Use links and install docs rather than git submodules by default.

Submodules are useful when this repo must build, test, or vendor another
repository at an exact commit. The current Scout host integrations do not need
that coupling: they shell out to the installed `scout` CLI or talk to the local
broker, and their compatibility boundary is the published Scout protocol and CLI
behavior.

Keep integration source in a separate repository when:

- the host has its own plugin marketplace or install flow
- the integration can be installed without cloning OpenScout
- the package should have its own release cadence
- the integration depends on Scout's public CLI/protocol surface rather than
  private app internals

Keep integration source in this repository when:

- it depends on unreleased internal code
- it is still shaping the core protocol or broker API
- local product development needs cross-package changes in one commit

## Local Development

Recommended sibling checkout layout:

```text
~/dev/
├── openscout/
├── pi-scout/
└── claude-scout/
```

That layout keeps the product repo clean while making related host integrations
easy to work on side by side.
