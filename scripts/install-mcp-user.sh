#!/bin/bash
# install-mcp-user.sh
# Idempotently registers the Scout MCP server in the Claude Code user-level config (~/.claude.json).
# Safe to run multiple times. Called by SessionStart hook to auto-heal on every new session.
set -euo pipefail

CLAUDE_JSON="$HOME/.claude.json"
SCOUT_CWD="/Users/arach/dev/openscout/plugins/scout"
SCOUT_SCRIPT="./scripts/run-scout-mcp.sh"

if [[ ! -f "$CLAUDE_JSON" ]]; then
  echo "[scout-mcp] ~/.claude.json not found, skipping" >&2
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[scout-mcp] jq not found, skipping" >&2
  exit 0
fi

# Check if scout is already registered
existing=$(jq -r '.mcpServers.scout // empty' "$CLAUDE_JSON" 2>/dev/null)
if [[ -n "$existing" ]]; then
  # Already present — nothing to do
  exit 0
fi

# Add scout entry to top-level mcpServers
tmp=$(mktemp)
jq --arg cwd "$SCOUT_CWD" --arg script "$SCOUT_SCRIPT" '
  .mcpServers.scout = {
    "type": "stdio",
    "command": "/bin/bash",
    "args": [$script],
    "cwd": $cwd
  }
' "$CLAUDE_JSON" > "$tmp"

# Atomic replace
mv "$tmp" "$CLAUDE_JSON"
echo "[scout-mcp] Registered scout MCP server in ~/.claude.json" >&2
