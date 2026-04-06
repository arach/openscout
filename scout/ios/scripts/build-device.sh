#!/bin/bash
# Build Scout for a physical iPhone into a stable repo-owned derived data path.
# Usage: ./scripts/build-device.sh [--release]

set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE_ID="${OPENSCOUT_IOS_DEVICE_ID:-00008110-000610240E13801E}"
CONFIG="${OPENSCOUT_IOS_CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${OPENSCOUT_IOS_DERIVED_DATA_PATH:-$(pwd)/.deriveddata/devphone}"

if [[ "${1:-}" == "--release" ]]; then
  CONFIG="Release"
fi

APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIG}-iphoneos/Scout.app"

echo "Building ScoutApp ($CONFIG) for device $DEVICE_ID..."
echo "DerivedData: $DERIVED_DATA_PATH"
echo "Output: $APP_PATH"
echo ""

xcodebuild \
  -project Scout.xcodeproj \
  -scheme ScoutApp \
  -destination "id=$DEVICE_ID" \
  -configuration "$CONFIG" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  build 2>&1 | tail -5

echo ""

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: Build output not found at $APP_PATH"
  exit 1
fi

echo "Build ready."
