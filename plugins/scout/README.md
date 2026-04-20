# Scout Codex Plugin

This repo-local plugin packages Scout for Codex as a first-class plugin instead of requiring users to hand-enter a manual MCP server command.

What it provides:

- a real Codex plugin manifest so Scout can show up in the plugin catalog
- an MCP manifest that launches `scout mcp`
- a bundled Scout coordination skill so Codex knows when to search, resolve, send, and ask

Launch behavior:

- prefers a locally installed `scout` CLI
- falls back to `bunx @openscout/scout`
- defaults `OPENSCOUT_SETUP_CWD` to `$HOME` when the host has not already set a Scout context root

Advanced overrides:

- set `OPENSCOUT_SETUP_CWD` to force Scout's default workspace root
- set `OPENSCOUT_MCP_BIN` to force a specific Scout executable
