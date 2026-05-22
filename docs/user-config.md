# User Configuration

Scout stores per-user configuration in `~/.openscout/user.json`. This config is shared between the CLI and the web UI.

## Your Operator Name And Handle

Scout keeps a human/operator name and optional handle in
`~/.openscout/user.json`. The name is the fallback sender identity Scout uses
when it needs a person-level sender rather than a project- or agent-scoped
sender. The handle is the human-facing alias, without requiring the leading
`@` in config.

### Set via CLI

```bash
scout config set name Alice
scout config set handle @alice
```

### Set via Web UI

Open Settings → Identity → type your name → Save.

### View current config

```bash
scout config
# name: Alice
# handle: @alice

scout config get name
# Alice

scout config get handle
# alice
```

### Reset to default

```bash
scout config set name
# Name reset to default: <your $USER>
```

## Operator Name Resolution Order

Scout resolves your operator name in this order:

1. `~/.openscout/user.json` → `name` field
2. `OPENSCOUT_OPERATOR_NAME` environment variable
3. `$USER` environment variable
4. `"operator"` (hardcoded fallback)

The first non-empty value wins.

## Operator Handle Resolution Order

Scout resolves your operator handle in this order:

1. `~/.openscout/user.json` → `handle` field, with leading `@` removed
2. `OPENSCOUT_OPERATOR_HANDLE` environment variable
3. `~/.openscout/user.json` → `name` field
4. `OPENSCOUT_OPERATOR_NAME` environment variable
5. `$USER` environment variable
6. `"operator"` (hardcoded fallback)

The handle is used for human-facing aliases and compatibility with direct DM
ids during the structural conversation-id transition.

## Operator Augment Agent

Scout can create a long-lived AI counterpart for the human operator. Start an
agent named after your operator handle plus `-ai`:

```bash
scout up "$HOME" --name "$(scout config get handle)-ai" --harness codex --model gpt-5.5
```

For a handle of `@alice`, this creates `@alice-ai`. The generated system prompt
keeps the stock Scout routing contract and adds the human-in-the-loop rules:
the augment keeps longer-running conversations in the same venue, maintains
continuity, and invokes the human operator only for concrete decisions,
approvals, or unblock questions.
Use a project root instead of `$HOME` when the augment should be scoped to one
codebase.

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
  "name": "Alice",
  "handle": "@alice"
}
```

Located at `~/.openscout/user.json`. Created automatically on first `scout config set`.
