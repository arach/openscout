#!/bin/bash
# Build and publish all OpenScout npm packages in dependency order.
# Reads NPM_TOKEN from .env (no 2FA needed).
#
# Usage:
#   ./scripts/ship-npm.sh           # build + publish all
#   ./scripts/ship-npm.sh --dry-run # build only, skip publish

set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env if present
[[ -f .env ]] && set -a && source .env && set +a

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "Dry run — skipping publish."
else
  [[ -z "${NPM_TOKEN:-}" ]] && { echo "ERROR: NPM_TOKEN is not set."; exit 1; }
  NPMRC=$(mktemp)
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "$NPMRC"
  trap 'rm -f "$NPMRC"' EXIT
fi

publish() {
  local pkg="$1"
  local dir="packages/$pkg"
  local name version

  name=$(node -p "require('./$dir/package.json').name")
  version=$(node -p "require('./$dir/package.json').version")

  echo ""
  echo "Publishing $name@$version…"

  if $DRY_RUN; then
    echo "  (dry run — skipped)"
    return
  fi

  npm publish --prefix "$dir" --access public --userconfig "$NPMRC"
  echo "  ✓ $name@$version"
}

# ── Build ──────────────────────────────────────────────────────────────────────

echo "Building packages…"

echo "  protocol…"
(cd packages/protocol && npm run build)

echo "  runtime…"
(cd packages/runtime && npm run build)

echo "  cli…"
(cd packages/cli && node ./scripts/build.mjs)

# ── Publish in dependency order ────────────────────────────────────────────────

publish protocol
publish runtime
publish cli

echo ""
echo "✓ All packages published."
