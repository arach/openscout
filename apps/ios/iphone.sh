#!/bin/bash
# Build and deploy Scout to a physical iPhone using the repo-owned DerivedData path.
# Usage: ./iphone.sh [--release] [--log]

set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${OPENSCOUT_IOS_CONFIGURATION:-Debug}"
LOG_AFTER_INSTALL=0

for arg in "$@"; do
  case "$arg" in
    --release)
      CONFIG="Release"
      ;;
    --log)
      LOG_AFTER_INSTALL=1
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: ./iphone.sh [--release] [--log]"
      exit 2
      ;;
  esac
done

export OPENSCOUT_IOS_CONFIGURATION="$CONFIG"

if [[ "$CONFIG" == "Release" ]]; then
  bash ./scripts/build-device.sh --release
else
  bash ./scripts/build-device.sh
fi

bash ./scripts/install-last-build.sh

if [[ "$LOG_AFTER_INSTALL" -eq 1 ]]; then
  DEVICE_ID="${OPENSCOUT_IOS_DEVICE_ID:-1E273304-29B6-5B10-BEC2-F4361F1CA25B}"
  echo ""
  echo "Streaming logs (Ctrl-C to stop)..."
  xcrun devicectl device process launch --device "$DEVICE_ID" --console com.openscout.scout 2>&1
fi
