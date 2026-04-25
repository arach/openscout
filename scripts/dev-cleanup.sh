#!/usr/bin/env bash

set -u
set -o pipefail

DRY_RUN=0
VERBOSE=0
FAILURES=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOME_DIR="${HOME:?HOME is required}"
USER_ID="$(id -u)"

SCOUT_PAIRING_PID_FILE="${HOME_DIR}/.scout/pairing/runtime.pid"

declare -a SCOUT_COMMAND=()
declare -a RUNTIME_COMMAND=()
declare -a GLOBAL_NODE_MODULE_ROOTS=()
declare -a GLOBAL_BIN_DIRS=()
declare -a PROCESS_TARGETS=()

log() {
  printf '%s\n' "$*"
}

debug() {
  if [ "${VERBOSE}" -eq 1 ]; then
    log "$*"
  fi
}

warn() {
  printf 'warn: %s\n' "$*" >&2
}

record_failure() {
  warn "$*"
  FAILURES=$((FAILURES + 1))
}

usage() {
  cat <<'EOF'
Usage: scripts/dev-cleanup.sh [--dry-run] [--verbose]

Removes installed OpenScout state without deleting the repo checkout.
EOF
}

expand_home() {
  case "${1}" in
    "~")
      printf '%s\n' "${HOME_DIR}"
      ;;
    "~/"*)
      printf '%s/%s\n' "${HOME_DIR}" "${1#~/}"
      ;;
    *)
      printf '%s\n' "${1}"
      ;;
  esac
}

resolve_command_path() {
  local raw="${1:-}"
  local expanded=""
  local resolved=""

  if [ -z "${raw}" ]; then
    return 1
  fi

  expanded="$(expand_home "${raw}")"
  if [ -x "${expanded}" ]; then
    printf '%s\n' "${expanded}"
    return 0
  fi

  resolved="$(command -v "${raw}" 2>/dev/null || true)"
  if [ -n "${resolved}" ] && [ -x "${resolved}" ]; then
    printf '%s\n' "${resolved}"
    return 0
  fi

  return 1
}

resolve_first_env_executable() {
  local key=""
  local value=""
  local resolved=""

  for key in "$@"; do
    value="${!key-}"
    if [ -z "${value}" ]; then
      continue
    fi

    resolved="$(resolve_command_path "${value}" || true)"
    if [ -n "${resolved}" ]; then
      printf '%s\n' "${resolved}"
      return 0
    fi
  done

  return 1
}

resolve_bun_bin() {
  local resolved=""

  resolved="$(resolve_first_env_executable OPENSCOUT_BUN_BIN SCOUT_BUN_BIN BUN_BIN || true)"
  if [ -n "${resolved}" ]; then
    printf '%s\n' "${resolved}"
    return 0
  fi

  resolved="$(resolve_command_path bun || true)"
  if [ -n "${resolved}" ]; then
    printf '%s\n' "${resolved}"
    return 0
  fi

  for resolved in \
    "${HOME_DIR}/.bun/bin/bun" \
    "/opt/homebrew/bin/bun" \
    "/usr/local/bin/bun"
  do
    if [ -x "${resolved}" ]; then
      printf '%s\n' "${resolved}"
      return 0
    fi
  done

  return 1
}

resolve_js_runtime_bin() {
  local resolved=""

  resolved="$(resolve_first_env_executable OPENSCOUT_RUNTIME_NODE_BIN || true)"
  if [ -n "${resolved}" ]; then
    printf '%s\n' "${resolved}"
    return 0
  fi

  resolved="$(resolve_command_path node || true)"
  if [ -n "${resolved}" ]; then
    printf '%s\n' "${resolved}"
    return 0
  fi

  resolved="$(resolve_bun_bin || true)"
  if [ -n "${resolved}" ]; then
    printf '%s\n' "${resolved}"
    return 0
  fi

  return 1
}

resolve_repo_root() {
  if [ -f "${REPO_ROOT}/apps/desktop/bin/scout.ts" ] && [ -f "${REPO_ROOT}/packages/runtime/bin/openscout-runtime.mjs" ]; then
    printf '%s\n' "${REPO_ROOT}"
    return 0
  fi

  return 1
}

resolve_scout_command() {
  local resolved=""
  local repo_root=""
  local bun_bin=""

  resolved="$(resolve_first_env_executable OPENSCOUT_CLI_BIN SCOUT_CLI_BIN OPENSCOUT_SCOUT_BIN SCOUT_BIN || true)"
  if [ -n "${resolved}" ]; then
    SCOUT_COMMAND=("${resolved}")
    return 0
  fi

  resolved="$(resolve_command_path scout || true)"
  if [ -n "${resolved}" ]; then
    SCOUT_COMMAND=("${resolved}")
    return 0
  fi

  repo_root="$(resolve_repo_root || true)"
  bun_bin="$(resolve_bun_bin || true)"
  if [ -n "${repo_root}" ] && [ -n "${bun_bin}" ] && [ -f "${repo_root}/apps/desktop/bin/scout.ts" ]; then
    SCOUT_COMMAND=("${bun_bin}" "${repo_root}/apps/desktop/bin/scout.ts")
    return 0
  fi

  SCOUT_COMMAND=()
  return 1
}

resolve_runtime_command() {
  local resolved=""
  local repo_root=""
  local js_runtime=""

  resolved="$(resolve_first_env_executable OPENSCOUT_RUNTIME_BIN || true)"
  if [ -n "${resolved}" ]; then
    RUNTIME_COMMAND=("${resolved}")
    return 0
  fi

  resolved="$(resolve_command_path openscout-runtime || true)"
  if [ -n "${resolved}" ]; then
    RUNTIME_COMMAND=("${resolved}")
    return 0
  fi

  repo_root="$(resolve_repo_root || true)"
  js_runtime="$(resolve_js_runtime_bin || true)"
  if [ -n "${repo_root}" ] && [ -n "${js_runtime}" ] && [ -f "${repo_root}/packages/runtime/bin/openscout-runtime.mjs" ]; then
    RUNTIME_COMMAND=("${js_runtime}" "${repo_root}/packages/runtime/bin/openscout-runtime.mjs")
    return 0
  fi

  RUNTIME_COMMAND=()
  return 1
}

append_unique() {
  local value="${1:-}"
  local existing=""

  if [ -z "${value}" ]; then
    return 0
  fi

  for existing in "${GLOBAL_NODE_MODULE_ROOTS[@]:-}"; do
    if [ "${existing}" = "${value}" ]; then
      return 0
    fi
  done

  GLOBAL_NODE_MODULE_ROOTS+=("${value}")
}

append_unique_bin_dir() {
  local value="${1:-}"
  local existing=""

  if [ -z "${value}" ]; then
    return 0
  fi

  for existing in "${GLOBAL_BIN_DIRS[@]:-}"; do
    if [ "${existing}" = "${value}" ]; then
      return 0
    fi
  done

  GLOBAL_BIN_DIRS+=("${value}")
}

discover_global_roots() {
  local npm_root=""
  local npm_prefix=""
  local bun_install_root=""

  if command -v npm >/dev/null 2>&1; then
    npm_root="$(npm root -g 2>/dev/null || true)"
    if [ -d "${npm_root}" ]; then
      append_unique "${npm_root}"
    fi

    npm_prefix="$(npm prefix -g 2>/dev/null || true)"
    if [ -d "${npm_prefix}/lib/node_modules" ]; then
      append_unique "${npm_prefix}/lib/node_modules"
    fi
    if [ -d "${npm_prefix}/bin" ]; then
      append_unique_bin_dir "${npm_prefix}/bin"
    fi
  fi

  bun_install_root="${BUN_INSTALL:-${HOME_DIR}/.bun}"
  if [ -d "${bun_install_root}/install/global/node_modules" ]; then
    append_unique "${bun_install_root}/install/global/node_modules"
  fi
  if [ -d "${bun_install_root}/node_modules" ]; then
    append_unique "${bun_install_root}/node_modules"
  fi
  if [ -d "${bun_install_root}/bin" ]; then
    append_unique_bin_dir "${bun_install_root}/bin"
  fi
}

append_process_target_if_exists() {
  local candidate="${1:-}"
  local existing=""

  if [ -z "${candidate}" ] || [ ! -e "${candidate}" ]; then
    return 0
  fi

  for existing in "${PROCESS_TARGETS[@]:-}"; do
    if [ "${existing}" = "${candidate}" ]; then
      return 0
    fi
  done

  PROCESS_TARGETS+=("${candidate}")
}

build_process_targets() {
  local repo_root=""
  local node_root=""

  repo_root="$(resolve_repo_root || true)"
  if [ -n "${repo_root}" ]; then
    append_process_target_if_exists "${repo_root}/packages/web/server/index.ts"
    append_process_target_if_exists "${repo_root}/packages/cli/dist/scout-control-plane-web.mjs"
    append_process_target_if_exists "${repo_root}/packages/web/dist/openscout-web-server.mjs"
    append_process_target_if_exists "${repo_root}/apps/desktop/bin/pair-supervisor.ts"
    append_process_target_if_exists "${repo_root}/packages/cli/dist/pair-supervisor.mjs"
    append_process_target_if_exists "${repo_root}/packages/web/dist/pair-supervisor.mjs"
  fi

  for node_root in "${GLOBAL_NODE_MODULE_ROOTS[@]:-}"; do
    append_process_target_if_exists "${node_root}/@openscout/scout/dist/scout-control-plane-web.mjs"
    append_process_target_if_exists "${node_root}/@openscout/web/dist/openscout-web-server.mjs"
    append_process_target_if_exists "${node_root}/@openscout/scout/dist/pair-supervisor.mjs"
    append_process_target_if_exists "${node_root}/@openscout/web/dist/pair-supervisor.mjs"
  done
}

run_step() {
  local description="${1}"
  shift

  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] ${description}: $*"
    return 0
  fi

  debug "run: ${description}: $*"
  if "$@"; then
    return 0
  fi

  record_failure "${description} failed"
  return 1
}

run_best_effort() {
  local description="${1}"
  shift

  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] ${description}: $*"
    return 0
  fi

  debug "run: ${description}: $*"
  if "$@" >/dev/null 2>&1; then
    return 0
  fi

  warn "${description} did not complete cleanly"
  return 0
}

remove_path() {
  local target="${1:-}"

  if [ -z "${target}" ] || [ ! -e "${target}" ]; then
    return 0
  fi

  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] rm -rf ${target}"
    return 0
  fi

  if rm -rf "${target}"; then
    return 0
  fi

  record_failure "failed to remove ${target}"
  return 1
}

kill_pid() {
  local pid="${1:-}"
  local description="${2:-process}"

  if [ -z "${pid}" ] || ! [[ "${pid}" =~ ^[0-9]+$ ]]; then
    return 0
  fi

  if [ "${pid}" = "$$" ]; then
    return 0
  fi

  if ! kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi

  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] kill ${pid} (${description})"
    return 0
  fi

  if ! kill "${pid}" 2>/dev/null; then
    record_failure "failed to terminate ${description} pid ${pid}"
    return 1
  fi

  sleep 0.2
  if kill -0 "${pid}" 2>/dev/null; then
    if ! kill -9 "${pid}" 2>/dev/null; then
      record_failure "failed to force kill ${description} pid ${pid}"
      return 1
    fi
  fi

  return 0
}

kill_processes_matching_literal() {
  local literal="${1:-}"
  local pid=""
  local command_line=""
  local matched=0

  if [ -z "${literal}" ]; then
    return 0
  fi

  while IFS=$'\t' read -r pid command_line; do
    if [ -z "${pid}" ]; then
      continue
    fi
    matched=1
    kill_pid "${pid}" "${literal}"
  done < <(ps -axo pid=,command= | awk -v needle="${literal}" '
    index($0, needle) > 0 {
      pid = $1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0)
      printf "%s\t%s\n", pid, $0
    }
  ')

  if [ "${matched}" -eq 1 ]; then
    debug "terminated processes matching ${literal}"
  fi
}

kill_port_listener() {
  local port="${1:-}"
  local pid=""

  if [ -z "${port}" ] || ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r pid; do
    kill_pid "${pid}" "listener on tcp:${port}"
  done < <(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
}

quit_menu_app() {
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] quit OpenScoutMenu"
  else
    osascript -e 'tell application "OpenScoutMenu" to quit' >/dev/null 2>&1 || true
  fi

  if command -v pgrep >/dev/null 2>&1 && pgrep -x OpenScoutMenu >/dev/null 2>&1; then
    if [ "${DRY_RUN}" -eq 1 ]; then
      log "[dry-run] pkill -x OpenScoutMenu"
    else
      pkill -x OpenScoutMenu >/dev/null 2>&1 || record_failure "failed to terminate OpenScoutMenu"
    fi
  fi
}

cleanup_support_state() {
  remove_path "${HOME_DIR}/Library/Application Support/OpenScout"
  remove_path "${HOME_DIR}/.openscout"
  remove_path "${HOME_DIR}/.scout"
}

cleanup_menu_bundles() {
  remove_path "${REPO_ROOT}/apps/macos/dist/OpenScoutMenu.app"
  remove_path "${HOME_DIR}/Applications/OpenScoutMenu.app"
  remove_path "/Applications/OpenScoutMenu.app"
}

cleanup_launch_agents() {
  local label=""
  local plist_path=""

  for label in "dev.openscout.broker" "com.openscout.broker" "com.openscout.broker.custom"; do
    if [ "${DRY_RUN}" -eq 1 ]; then
      log "[dry-run] launchctl bootout gui/${USER_ID}/${label}"
    else
      launchctl bootout "gui/${USER_ID}/${label}" >/dev/null 2>&1 || true
    fi

    plist_path="${HOME_DIR}/Library/LaunchAgents/${label}.plist"
    remove_path "${plist_path}"
  done
}

cleanup_global_installs() {
  local node_root=""
  local bin_dir=""

  if command -v npm >/dev/null 2>&1; then
    run_best_effort "npm uninstall globals" npm uninstall -g @openscout/scout @openscout/runtime @openscout/web
  fi

  if command -v bun >/dev/null 2>&1; then
    run_best_effort "bun remove globals" bun remove -g @openscout/scout @openscout/runtime @openscout/web
  fi

  for node_root in "${GLOBAL_NODE_MODULE_ROOTS[@]:-}"; do
    remove_path "${node_root}/@openscout/scout"
    remove_path "${node_root}/@openscout/runtime"
    remove_path "${node_root}/@openscout/web"
  done

  for bin_dir in "${GLOBAL_BIN_DIRS[@]:-}"; do
    remove_path "${bin_dir}/scout"
    remove_path "${bin_dir}/openscout-runtime"
    remove_path "${bin_dir}/openscout-web"
    remove_path "${bin_dir}/pair-supervisor"
  done
}

stop_local_agents() {
  if resolve_scout_command; then
    run_best_effort "stop local agents" "${SCOUT_COMMAND[@]}" down --all
  else
    debug "no scout command resolved; skipping local agent shutdown"
  fi
}

stop_broker_service() {
  if resolve_runtime_command; then
    run_best_effort "stop broker service" "${RUNTIME_COMMAND[@]}" service stop --json
    run_best_effort "uninstall broker service" "${RUNTIME_COMMAND[@]}" service uninstall --json
  else
    debug "no openscout-runtime command resolved; skipping broker service shutdown"
  fi
}

stop_pairing_runtime() {
  local pid=""

  if [ -f "${SCOUT_PAIRING_PID_FILE}" ]; then
    pid="$(tr -d '[:space:]' < "${SCOUT_PAIRING_PID_FILE}" 2>/dev/null || true)"
    kill_pid "${pid}" "pair supervisor pid file"
  fi
}

stop_known_processes() {
  local target=""

  for target in "${PROCESS_TARGETS[@]:-}"; do
    kill_processes_matching_literal "${target}"
  done

  kill_port_listener 3200
  kill_port_listener 65535
  kill_port_listener 7888
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        ;;
      --verbose)
        VERBOSE=1
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown option: %s\n' "$1" >&2
        usage >&2
        exit 1
        ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"
  discover_global_roots
  build_process_targets

  stop_local_agents
  quit_menu_app
  stop_broker_service
  cleanup_launch_agents
  stop_pairing_runtime
  stop_known_processes
  cleanup_support_state
  cleanup_menu_bundles
  cleanup_global_installs

  if [ "${FAILURES}" -gt 0 ]; then
    warn "cleanup completed with ${FAILURES} failure(s)"
    exit 1
  fi

  log "OpenScout installed state cleaned up."
}

main "$@"
