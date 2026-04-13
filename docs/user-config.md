# User Configuration

Scout stores per-user configuration in `~/.openscout/user.json`. This config is shared between the CLI and the web UI.

## Your Name

By default, messages you send from the web UI or CLI are attributed to your system username (`$USER`). You can set a custom name that will be used everywhere.

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

## Resolution Order

Scout resolves your operator name in this order:

1. `~/.openscout/user.json` → `name` field
2. `OPENSCOUT_OPERATOR_NAME` environment variable
3. `$USER` environment variable
4. `"operator"` (hardcoded fallback)

The first non-empty value wins.

## CLI `--as` Flag

The `--as` flag on `scout send`, `scout ask`, `scout broadcast`, and `scout watch` overrides the sender identity for that command only. It does not change your stored config.

```bash
# Send as yourself (uses config name)
scout send "hello @arc"

# Send as a specific agent identity
scout send --as openscout "deploy complete"
```

## Config File Format

```json
{
  "name": "arach"
}
```

Located at `~/.openscout/user.json`. Created automatically on first `scout config set`.
