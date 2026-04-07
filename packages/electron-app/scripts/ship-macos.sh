#!/bin/bash
# Build, sign, notarize, tag, and publish Scout for macOS.
# Patch version is bumped automatically (use --same-version to skip).
#
# Usage:
#   ./scripts/ship-macos.sh                # bump patch + build + sign + notarize + tag + upload
#   ./scripts/ship-macos.sh --same-version # keep version, bump nothing
#   ./scripts/ship-macos.sh --skip-build   # skip build, re-tag/upload existing DMG

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Version bump ──────────────────────────────────────────────────────────────

if [[ "${1:-}" != "--same-version" && "${1:-}" != "--skip-build" ]]; then
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

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "Building, signing, and notarizing…"

  # Build each package directly — bun's nested npm --prefix resolution is unreliable
  echo "  runtime…"
  (cd ../runtime && npm run build)
  echo "  cli…"
  (cd ../cli && node ./scripts/build.mjs)
  echo "  electron…"
  npm run build
  npm run build:electron

  # Package, sign, notarize — skip the build steps already done above
  echo "  packaging…"
  node scripts/package-macos-app.mjs
else
  echo "Skipping build — using existing DMG."
fi

if [[ ! -f "$DMG_PATH" ]]; then
  echo "ERROR: DMG not found at $DMG_PATH"
  exit 1
fi

RELEASE_ASSETS=("$DMG_PATH" dist/macos/*.zip dist/macos/*.yml dist/macos/*.blockmap)

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
