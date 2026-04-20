#!/bin/bash
set -euo pipefail

if [[ -z "${OPENSCOUT_SETUP_CWD:-}" && -n "${HOME:-}" ]]; then
  export OPENSCOUT_SETUP_CWD="${HOME}"
fi

if [[ -n "${OPENSCOUT_MCP_BIN:-}" ]]; then
  exec "${OPENSCOUT_MCP_BIN}" mcp "$@"
fi

if command -v scout >/dev/null 2>&1; then
  exec scout mcp "$@"
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx @openscout/scout mcp "$@"
fi

if command -v bun >/dev/null 2>&1; then
  exec bun x @openscout/scout mcp "$@"
fi

cat >&2 <<'EOF'
Scout MCP could not start because neither `scout` nor Bun was found on PATH.

Recommended setup:
  bun add -g @openscout/scout
  scout setup

Fallback:
  install Bun from https://bun.sh and rerun Codex so this plugin can launch
  `bunx @openscout/scout mcp` automatically.
EOF

exit 1
