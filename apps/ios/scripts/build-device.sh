#!/bin/bash
# Build Scout for a physical iPhone into a stable repo-owned derived data path.
# Usage: ./scripts/build-device.sh [--release]

set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE_ID="${OPENSCOUT_IOS_DEVICE_ID:-00008110-000610240E13801E}"
CONFIG="${OPENSCOUT_IOS_CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${OPENSCOUT_IOS_DERIVED_DATA_PATH:-$(pwd)/.deriveddata/devphone}"

# Keep the direct device script aligned with apps/ios/hkit.json. HudsonKit reads
# these gates when SwiftPM evaluates the local Hudson package.
export HUDSONKIT_WITH_TERMINAL="${HUDSONKIT_WITH_TERMINAL:-1}"
export HUDSONKIT_WITH_VOICE="${HUDSONKIT_WITH_VOICE:-1}"

if [[ "${1:-}" == "--release" ]]; then
  CONFIG="Release"
fi

APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIG}-iphoneos/Scout.app"

echo "Building Scout ($CONFIG) for device $DEVICE_ID..."
echo "DerivedData: $DERIVED_DATA_PATH"
echo "Output: $APP_PATH"
echo "HudsonKit: terminal=$HUDSONKIT_WITH_TERMINAL voice=$HUDSONKIT_WITH_VOICE"
echo ""

xcodebuild \
  -project Scout.xcodeproj \
  -scheme Scout \
  -destination "id=$DEVICE_ID" \
  -configuration "$CONFIG" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  build -quiet

echo ""

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: Build output not found at $APP_PATH"
  exit 1
fi

echo "Build ready."
