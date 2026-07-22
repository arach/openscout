#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "${SRCROOT}/../.." && pwd)"
SURFACE_ROOT="${SRCROOT}/Scout/Resources/WebSurfaces"
VALIDATOR="${REPO_ROOT}/packages/web/scripts/validate-native-surfaces.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required to validate Scout's signed web surfaces" >&2
  echo "error: install the repository toolchain, then run: bun run --cwd packages/web build:native-surfaces" >&2
  exit 1
fi

node "${VALIDATOR}" "${SURFACE_ROOT}"
