#!/bin/bash
# Archive, sign, and upload Scout to App Store Connect.
# Build number and patch version are both incremented automatically.
#
# Usage:
#   ./scripts/release.sh              # bump patch + build (default)
#   ./scripts/release.sh --same-version # build number only, keep marketing version

set -euo pipefail
cd "$(dirname "$0")/.."

TEAM_ID="2U83JFPW66"
ARCHIVE_PATH=".asc/artifacts/Scout.xcarchive"
EXPORT_OPTIONS=".asc/ExportOptions.plist"
EXPORT_PATH=".asc/export"

# ── Version bump ──────────────────────────────────────────────────────────────

CURRENT_BUILD=$(xcrun agvtool what-version -terse 2>/dev/null | tr -d '[:space:]')
NEW_BUILD=$((CURRENT_BUILD + 1))

if [[ "${1:-}" != "--same-version" ]]; then
  CURRENT_VERSION=$(xcrun agvtool what-marketing-version -terse1 2>/dev/null | tr -d '[:space:]')
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
  echo "Version:  $CURRENT_VERSION → $NEW_VERSION"
  xcrun agvtool new-marketing-version "$NEW_VERSION" > /dev/null
fi

echo "Build:    $CURRENT_BUILD → $NEW_BUILD"
xcrun agvtool new-version -all "$NEW_BUILD" 2>&1 | grep "^Setting" || true

# ── Archive ───────────────────────────────────────────────────────────────────

echo ""
echo "Archiving…"
xcodebuild archive \
  -project Scout.xcodeproj \
  -scheme ScoutApp \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  2>&1 | grep -E "^(error:|.*ARCHIVE SUCCEEDED|.*ARCHIVE FAILED)" || true

echo "Archive ready."

# ── Upload ────────────────────────────────────────────────────────────────────

echo ""
echo "Uploading to App Store Connect…"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_PATH" \
  -allowProvisioningUpdates \
  2>&1 | grep -E "Progress 100%|Upload succeeded|error:" || true

echo ""
echo "✓ Build $NEW_BUILD uploaded to App Store Connect."
