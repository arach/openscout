#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Run a live same-machine Codex <-> Claude broker pass against a fresh local broker.

This helper:
1. builds the CLI/runtime unless OPENSCOUT_SKIP_BUILD=1
2. starts an isolated broker on a random localhost port
3. starts one Codex-backed agent in the repo root
4. starts one Claude-backed agent from a detached worktree
5. runs one real broker-routed ask in each direction
6. saves snapshot/event artifacts for inspection

Usage:
  bash scripts/run-live-local-agent-pass.sh

Useful environment overrides:
  OPENSCOUT_SKIP_BUILD=1
  OPENSCOUT_KEEP_LIVE_PASS=1
  OPENSCOUT_LIVE_PASS_ROOT=/tmp/custom-live-pass
  OPENSCOUT_BROKER_PORT=37800
  OPENSCOUT_CLAUDE_BIN=/Users/you/.local/bin/claude
  OPENSCOUT_BUN_BIN=/Users/you/.bun/bin/bun
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

find_bin() {
  local override="$1"
  local fallback="$2"
  local common_path="${3:-}"
  if [[ -n "$override" ]]; then
    printf '%s\n' "$override"
    return 0
  fi
  if command -v "$fallback" >/dev/null 2>&1; then
    command -v "$fallback"
    return 0
  fi
  if [[ -n "$common_path" && -x "$common_path" ]]; then
    printf '%s\n' "$common_path"
    return 0
  fi
  return 1
}

BUN_BIN="$(find_bin "${OPENSCOUT_BUN_BIN:-}" bun "$HOME/.bun/bin/bun" || true)"
CLAUDE_BIN="$(find_bin "${OPENSCOUT_CLAUDE_BIN:-}" claude "$HOME/.local/bin/claude" || true)"
GIT_BIN="$(find_bin "" git || true)"
CURL_BIN="$(find_bin "" curl || true)"

if [[ -z "$BUN_BIN" ]]; then
  echo "Missing Bun. Install Bun or set OPENSCOUT_BUN_BIN." >&2
  exit 1
fi
if [[ -z "$CLAUDE_BIN" ]]; then
  echo "Missing Claude CLI. Install it or set OPENSCOUT_CLAUDE_BIN." >&2
  exit 1
fi
if [[ -z "$GIT_BIN" || -z "$CURL_BIN" ]]; then
  echo "Missing required dependency: git and curl must be on PATH." >&2
  exit 1
fi

export PATH
PATH="$(dirname "$CLAUDE_BIN"):$(dirname "$BUN_BIN"):$PATH"

if [[ "${OPENSCOUT_SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> Building CLI/runtime"
  (
    cd "$ROOT_DIR" &&
    "$BUN_BIN" run --cwd packages/protocol build >/dev/null &&
    "$BUN_BIN" run --cwd packages/agent-sessions build >/dev/null &&
    rm -rf packages/runtime/dist &&
    "$BUN_BIN" x tsc -p packages/runtime/tsconfig.json >/dev/null
  )
fi

if [[ ! -f "$ROOT_DIR/packages/cli/dist/main.mjs" ]]; then
  echo "Missing packages/cli/dist/main.mjs. Build the CLI first or run bun install." >&2
  exit 1
fi

if [[ -n "${OPENSCOUT_BROKER_PORT:-}" ]]; then
  BROKER_PORT="$OPENSCOUT_BROKER_PORT"
else
  BROKER_PORT="$("$BUN_BIN" -e 'import net from "node:net"; const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") process.exit(1); console.log(address.port); server.close(); });')"
fi

TMP_ROOT="${OPENSCOUT_LIVE_PASS_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/openscout-live-agent-pass.XXXXXX")}"
CLAUDE_WORKTREE="${OPENSCOUT_LIVE_CLAUDE_WORKTREE:-$(mktemp -d "${TMPDIR:-/tmp}/openscout-live-claude-wt.XXXXXX")}"
DEFAULT_NODE_QUALIFIER="live-pass-$("$BUN_BIN" -e 'console.log(Math.random().toString(36).slice(2, 8))')"

export OPENSCOUT_SUPPORT_DIRECTORY="$TMP_ROOT/support"
export OPENSCOUT_CONTROL_HOME="$TMP_ROOT/control"
export OPENSCOUT_RELAY_HUB="$TMP_ROOT/relay"
export OPENSCOUT_NODE_QUALIFIER="${OPENSCOUT_NODE_QUALIFIER:-$DEFAULT_NODE_QUALIFIER}"
export OPENSCOUT_BROKER_HOST="${OPENSCOUT_BROKER_HOST:-127.0.0.1}"
export OPENSCOUT_BROKER_PORT="$BROKER_PORT"
export OPENSCOUT_SKIP_USER_PROJECT_HINTS="${OPENSCOUT_SKIP_USER_PROJECT_HINTS:-1}"

BROKER_URL="http://${OPENSCOUT_BROKER_HOST}:${OPENSCOUT_BROKER_PORT}"
SCOUT_CMD=("$BUN_BIN" "$ROOT_DIR/packages/cli/bin/scout.mjs")
BROKER_CMD=("$BUN_BIN" "$ROOT_DIR/packages/runtime/dist/broker-daemon.js")

BROKER_PID=""
STARTED_AGENTS=0

cleanup() {
  local exit_code="$1"
  if [[ "$STARTED_AGENTS" == "1" ]]; then
    "${SCOUT_CMD[@]}" down --all >/dev/null 2>&1 || true
  fi
  if [[ -n "$BROKER_PID" ]] && kill -0 "$BROKER_PID" >/dev/null 2>&1; then
    kill "$BROKER_PID" >/dev/null 2>&1 || true
    wait "$BROKER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -d "$CLAUDE_WORKTREE" ]]; then
    "$GIT_BIN" -C "$ROOT_DIR" worktree remove --force "$CLAUDE_WORKTREE" >/dev/null 2>&1 || true
  fi
  if [[ "$exit_code" == "0" && "${OPENSCOUT_KEEP_LIVE_PASS:-0}" != "1" ]]; then
    rm -rf "$TMP_ROOT"
    return
  fi
  echo
  echo "Artifacts preserved at: $TMP_ROOT"
}

trap 'cleanup "$?"' EXIT

wait_for_broker() {
  local attempt=0
  while (( attempt < 60 )); do
    if "$CURL_BIN" -fsS "$BROKER_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "Broker did not become healthy at $BROKER_URL within 60s." >&2
  return 1
}

extract_started_agent_id() {
  sed -n 's/^Started //p' | tail -n 1
}

wait_for_agent_route() {
  local agent_id="$1"
  for _ in $(seq 1 60); do
    if "$CURL_BIN" -fsS "$BROKER_URL/v1/snapshot" | "$BUN_BIN" -e '
      const agentId = process.argv[1];
      const input = await Bun.stdin.text();
      const snapshot = JSON.parse(input);
      const endpoints = Object.values(snapshot.endpoints ?? {});
      const isRoutable = endpoints.some((endpoint) => {
        return endpoint
          && typeof endpoint === "object"
          && endpoint.agentId === agentId
          && endpoint.state !== "offline";
      });
      process.exit(isRoutable ? 0 : 1);
    ' "$agent_id" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_agent_via_scout() {
  local project_path="$1"
  local agent_name="$2"
  local harness="$3"
  local log_path="$4"
  local scout_pid=""
  local agent_id=""

  "${SCOUT_CMD[@]}" up "$project_path" --name "$agent_name" --harness "$harness" </dev/null >"$log_path" 2>&1 &
  scout_pid="$!"

  for _ in $(seq 1 120); do
    if [[ -f "$log_path" ]]; then
      agent_id="$(extract_started_agent_id <"$log_path")"
      if [[ -n "$agent_id" ]]; then
        break
      fi
    fi
    if ! kill -0 "$scout_pid" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if [[ -n "$agent_id" ]]; then
    if ! wait_for_agent_route "$agent_id"; then
      agent_id=""
    fi
  fi

  if kill -0 "$scout_pid" >/dev/null 2>&1; then
    kill "$scout_pid" >/dev/null 2>&1 || true
    wait "$scout_pid" >/dev/null 2>&1 || true
  fi

  if [[ -f "$log_path" ]]; then
    cat "$log_path" >&2
  fi

  if [[ -z "$agent_id" ]]; then
    return 1
  fi

  printf '%s\n' "$agent_id"
}

echo "==> Starting isolated broker at $BROKER_URL"
mkdir -p "$TMP_ROOT"
"${BROKER_CMD[@]}" >"$TMP_ROOT/broker.log" 2>&1 &
BROKER_PID="$!"
wait_for_broker

echo "==> Preparing detached worktree for Claude"
"$GIT_BIN" -C "$ROOT_DIR" worktree add --detach "$CLAUDE_WORKTREE" HEAD >/dev/null

echo "==> Starting Codex agent"
CODEX_AGENT_ID="$(start_agent_via_scout "$ROOT_DIR" "livecodex" "codex" "$TMP_ROOT/codex-up.log")"
if [[ -z "$CODEX_AGENT_ID" ]]; then
  echo "Unable to determine Codex agent id from scout up output." >&2
  exit 1
fi

echo "==> Starting Claude agent"
CLAUDE_AGENT_ID="$(start_agent_via_scout "$CLAUDE_WORKTREE" "liveclaude" "claude" "$TMP_ROOT/claude-up.log")"
if [[ -z "$CLAUDE_AGENT_ID" ]]; then
  echo "Unable to determine Claude agent id from scout up output." >&2
  exit 1
fi

STARTED_AGENTS=1

PROMPT_CODEX_TO_CLAUDE="${OPENSCOUT_LIVE_PROMPT_CODEX_TO_CLAUDE:-Review docs/architecture.md and tell me one concrete place where the local direct transport vs remote broker distinction could be clearer. Keep it under 120 words and do not edit files.}"
PROMPT_CLAUDE_TO_CODEX="${OPENSCOUT_LIVE_PROMPT_CLAUDE_TO_CODEX:-Review packages/runtime/src/scenario-suite.test.ts and suggest one next high-value live/manual scenario to add. Keep it under 120 words and do not edit files.}"

echo "==> Codex -> Claude"
"${SCOUT_CMD[@]}" ask --as "$CODEX_AGENT_ID" --to liveclaude "$PROMPT_CODEX_TO_CLAUDE" </dev/null >"$TMP_ROOT/codex-to-claude.log" 2>&1
cat "$TMP_ROOT/codex-to-claude.log"

echo "==> Claude -> Codex"
"${SCOUT_CMD[@]}" ask --as "$CLAUDE_AGENT_ID" --to livecodex "$PROMPT_CLAUDE_TO_CODEX" </dev/null >"$TMP_ROOT/claude-to-codex.log" 2>&1
cat "$TMP_ROOT/claude-to-codex.log"

echo "==> Capturing broker artifacts"
"$CURL_BIN" -fsS "$BROKER_URL/v1/snapshot" >"$TMP_ROOT/snapshot.json"
"$CURL_BIN" -fsS "$BROKER_URL/v1/events?limit=50" >"$TMP_ROOT/events.json"
"${SCOUT_CMD[@]}" who --json >"$TMP_ROOT/who.json"

echo
echo "Live pass completed."
echo "  Broker:       $BROKER_URL"
echo "  Codex agent:  $CODEX_AGENT_ID"
echo "  Claude agent: $CLAUDE_AGENT_ID"
if [[ "${OPENSCOUT_KEEP_LIVE_PASS:-0}" == "1" ]]; then
  echo "  Artifacts:    $TMP_ROOT"
fi
