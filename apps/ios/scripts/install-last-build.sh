#!/bin/bash
# Install the last Scout iPhone build from the stable repo-owned derived data path.

set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE_ID="${OPENSCOUT_IOS_DEVICE_ID:-00008110-000610240E13801E}"
CONFIG="${OPENSCOUT_IOS_CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${OPENSCOUT_IOS_DERIVED_DATA_PATH:-$(pwd)/.deriveddata/devphone}"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIG}-iphoneos/Scout.app"

if [[ ! -d "$DERIVED_DATA_PATH" ]]; then
  echo "ERROR: Stable iPhone DerivedData path not found at $DERIVED_DATA_PATH"
  echo "Run 'npm run ios:build' or './scripts/build-device.sh' first."
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: No built app found at $APP_PATH"
  echo "Run 'npm run ios:build' or './scripts/build-device.sh' first."
  exit 1
fi

echo "Installing existing build on device $DEVICE_ID..."
echo "DerivedData: $DERIVED_DATA_PATH"
echo "App: $APP_PATH"
echo ""

xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
echo "Done."
