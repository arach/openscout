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

## Rewrite workspace:* references to real versions before publishing.
## Modifies package.json in place; callers should restore after publish.
rewrite_workspace_deps() {
  local dir="$1"
  node -e "
    const fs = require('fs'), path = require('path');
    const pkgPath = path.resolve('$dir', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Collect versions from all workspace packages
    const versions = {};
    for (const d of fs.readdirSync('packages')) {
      const p = path.join('packages', d, 'package.json');
      if (!fs.existsSync(p)) continue;
      const ws = JSON.parse(fs.readFileSync(p, 'utf8'));
      versions[ws.name] = ws.version;
    }

    // Replace workspace:* with resolved version
    let changed = false;
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (!pkg[section]) continue;
      for (const [dep, range] of Object.entries(pkg[section])) {
        if (typeof range === 'string' && range.startsWith('workspace:') && versions[dep]) {
          pkg[section][dep] = versions[dep];
          changed = true;
        }
      }
    }
    if (changed) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  "
}

publish() {
  local pkg="$1"
  local dir="packages/$pkg"
  local name version

  name=$(node -p "require('./$dir/package.json').name")
  version=$(node -p "require('./$dir/package.json').version")

  echo ""
  echo "Publishing ${name}@${version}…"

  if $DRY_RUN; then
    echo "  (dry run — skipped)"
    return
  fi

  # Rewrite workspace deps, publish, then restore
  cp "$dir/package.json" "$dir/package.json.bak"
  rewrite_workspace_deps "$dir"
  (cd "$dir" && npm publish --access public --userconfig "$NPMRC")
  mv "$dir/package.json.bak" "$dir/package.json"
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

echo "  web…"
(cd packages/web && npm run build)

# ── Publish in dependency order ────────────────────────────────────────────────

publish protocol
publish runtime
publish cli
publish web

echo ""
echo "✓ All packages published."
