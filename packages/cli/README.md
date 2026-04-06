# scout

Published CLI package for Scout.

Install:

```bash
npm install -g @openscout/cli
scout --help
```

`@openscout/cli` is the npm package name. It installs the `scout` command.

## Canonical Flow

```bash
scout setup
scout doctor
scout runtimes
scout @dewey can you review our docs?
```

`scout setup` is the canonical onboarding entry point. It creates or updates:

- `~/Library/Application Support/OpenScout/settings.json`
- `~/Library/Application Support/OpenScout/relay-agents.json`
- `.openscout/project.json` for the current repo when needed

It also discovers relay agents from your configured workspace roots, installs the broker service, and attempts to start it.

`scout init` is still accepted as a deprecated compatibility alias for `scout setup`.

When the input is not a known subcommand and includes exactly one `@agent` mention, Scout treats it as an implicit `ask` and waits for the reply. For example:

```bash
scout @dewey can you review our docs?
scout hey @hudson please inspect the failing test
scout --as vox --timeout 900 @talkie take another pass on the keyboard port
```

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
