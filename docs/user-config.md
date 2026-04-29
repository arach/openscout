# User Configuration

Scout stores per-user configuration in `~/.openscout/user.json`. This config is shared between the CLI and the web UI.

## Your Operator Name

Scout keeps a human/operator name in `~/.openscout/user.json`. This is the
fallback identity Scout uses when it needs a person-level sender rather than a
project- or agent-scoped sender. You can set a custom name that will be used
everywhere Scout needs that operator identity.

### Set via CLI

```bash
scout config set name arach
```

### Set via Web UI

Open Settings → Identity → type your name → Save.

### View current config

```bash
scout config
# name: arach

scout config get name
# arach
```

### Reset to default

```bash
scout config set name
# Name reset to default: arach (falls back to $USER)
```

## Operator Name Resolution Order

Scout resolves your operator name in this order:

1. `~/.openscout/user.json` → `name` field
2. `OPENSCOUT_OPERATOR_NAME` environment variable
3. `$USER` environment variable
4. `"operator"` (hardcoded fallback)

The first non-empty value wins.

## Default Collaboration Sender

Scout collaboration commands share one default sender model:

```bash
scout whoami
```

By default, `scout send`, `scout ask`, and `scout broadcast`
resolve the sender in this order:

1. `--as <agent>` for that command
2. `OPENSCOUT_AGENT` when the current session is already bound to an agent
3. the current project-scoped sender inferred from the working directory
4. your operator name from the resolution order above

That means your operator name is still important, but it is not always the
sender Scout uses inside a project. If you are unsure, check `scout whoami`
first.

`scout watch` is different: it watches a conversation or channel and does not
resolve a sender identity.

## CLI `--as` Flag

The `--as` flag on `scout send`, `scout ask`, and `scout broadcast` overrides
the sender identity for that command only. It does not
change your stored config.

```bash
# Send as the default sender for this directory/context
scout send --to arc "hello"

# Send as a specific agent identity
scout send --as premotion.master.mini --to arc "deploy complete"
```

## Config File Format

```json
{
  "name": "arach"
}
```

Located at `~/.openscout/user.json`. Created automatically on first `scout config set`.
