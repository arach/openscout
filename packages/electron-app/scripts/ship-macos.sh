#!/bin/bash
# Build, sign, notarize, tag, and publish Scout for macOS.
# Patch version is bumped automatically (use --same-version to skip).
#
# Usage:
#   ./scripts/ship-macos.sh                # bump patch + build + sign + notarize + tag + upload (with update artifacts)
#   ./scripts/ship-macos.sh --same-version # keep version, skip patch bump
#   ./scripts/ship-macos.sh --skip-build   # skip build, re-tag/upload existing assets
#   ./scripts/ship-macos.sh --no-update    # skip update zip/yml/blockmap — DMG only (patch releases)

set -euo pipefail
cd "$(dirname "$0")/.."

# Parse flags
SKIP_BUILD=false
SAME_VERSION=false
BUILD_UPDATES=true
for arg in "$@"; do
  case "$arg" in
    --skip-build)   SKIP_BUILD=true ;;
    --same-version) SAME_VERSION=true ;;
    --no-update)    BUILD_UPDATES=false ;;
  esac
done

# ── Version bump ──────────────────────────────────────────────────────────────

if [[ "$SAME_VERSION" == "false" && "$SKIP_BUILD" == "false" ]]; then
  CURRENT=$(node -p "require('./package.json').version")
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
  echo "Version:  $CURRENT → $NEW_VERSION"
  # Bump all workspace packages in sync
  for pkg_json in package.json ../cli/package.json ../protocol/package.json ../runtime/package.json ../../package.json; do
    [[ -f "$pkg_json" ]] && node -e "
      const fs = require('fs');
      const p = fs.readFileSync('$pkg_json', 'utf8');
      fs.writeFileSync('$pkg_json', p.replace(/\"version\": \"$CURRENT\"/, '\"version\": \"$NEW_VERSION\"'));
    "
  done
fi

DMG_PATH="dist/macos/Scout.dmg"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
RELEASE_TITLE="OpenScout $TAG"
shopt -s nullglob

# ── Build, sign, notarize ──────────────────────────────────────────────────────

if [[ "$SKIP_BUILD" == "false" ]]; then
  echo "Building, signing, and notarizing…"

  echo "  electron…"
  npm run build
  npm run build:electron

  # Package, sign, notarize — skip the build steps already done above
  echo "  packaging…"
  SCOUT_BUILD_UPDATES=$([[ "$BUILD_UPDATES" == "true" ]] && echo "1" || echo "0") \
    node scripts/package-macos-app.mjs
else
  echo "Skipping build — using existing assets."
fi

if [[ ! -f "$DMG_PATH" ]]; then
  echo "ERROR: DMG not found at $DMG_PATH"
  exit 1
fi

if [[ "$BUILD_UPDATES" == "true" ]]; then
  RELEASE_ASSETS=("$DMG_PATH" dist/macos/*.zip dist/macos/*.yml dist/macos/*.blockmap)
else
  RELEASE_ASSETS=("$DMG_PATH")
  echo "Skipping update artifacts (--no-update)."
fi

echo ""
echo "Release assets ready:"
for asset in "${RELEASE_ASSETS[@]}"; do
  echo "  - $asset"
done

# ── Git tag ────────────────────────────────────────────────────────────────────

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists — skipping tag creation."
else
  echo "Tagging ${TAG}…"
  git tag "$TAG"
  git push origin "$TAG"
fi

# ── GitHub release ─────────────────────────────────────────────────────────────

echo ""
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Release $TAG exists — uploading assets…"
  gh release upload "$TAG" "${RELEASE_ASSETS[@]}" --clobber
else
  echo "Creating release ${TAG}…"
  gh release create "$TAG" "${RELEASE_ASSETS[@]}" \
    --title "$RELEASE_TITLE" \
    --notes "Scout for macOS $VERSION"
fi

echo ""
echo "✓ ${TAG} — $(gh release view "$TAG" --json url -q .url)"
