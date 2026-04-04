# scout

User-facing CLI for Scout.

## Canonical Flow

```bash
scout setup
scout doctor
scout runtimes
```

`scout setup` is the canonical onboarding entry point. It creates or updates:

- `~/Library/Application Support/OpenScout/settings.json`
- `~/Library/Application Support/OpenScout/relay-agents.json`
- `.openscout/project.json` for the current repo when needed

It also discovers relay agents from your configured workspace roots, installs the broker service, and attempts to start it.

`scout init` is still accepted as a deprecated compatibility alias for `scout setup`.

## Current Commands

```bash
scout --help
scout version
scout doctor
scout setup
scout runtimes
scout send
scout speak
scout ask
scout watch
scout who
scout enroll
scout broadcast
scout up
scout down
scout ps
scout restart
scout pair
scout tui
```
