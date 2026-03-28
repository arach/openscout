# scout

User-facing CLI for OpenScout.

This package is separate from `scout-dev`:

- `scout` is the long-term product CLI
- `scout-dev` is the repo-local native developer wrapper

## Primary Flow

```bash
scout init
scout doctor
```

`scout init` is the canonical onboarding entry point. It creates or updates:

- `~/Library/Application Support/OpenScout/settings.json`
- `~/Library/Application Support/OpenScout/relay-agents.json`
- `.openscout/project.json` for the current repo when needed

It also discovers relay agents from your configured workspace roots, installs the broker service, and attempts to start it.

## Current Commands

```bash
scout --help
scout version
scout doctor
scout init
scout dev help
scout dev build app
scout dev build agent
scout dev launch app
scout dev launch agent
scout app build
scout app launch
scout app relaunch
scout app relaunch --rebuild
scout app status
scout agent build
scout agent launch
scout agent status
```
