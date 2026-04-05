#!/bin/bash
# Build and deploy Scout to Arach's iPhone.
# Usage: ./iphone.sh

set -e

XCODE_DEST="id=00008110-000610240E13801E"
DEVICE_ID="1E273304-29B6-5B10-BEC2-F4361F1CA25B"
APP_PATH=$(find "$HOME/Library/Developer/Xcode/DerivedData" -maxdepth 1 -name "Scout-*" -type d | head -1)/Build/Products/Debug-iphoneos/Scout.app

echo "⠋ Building..."
xcodebuild build -project Scout.xcodeproj -scheme ScoutApp -destination "$XCODE_DEST" -quiet 2>&1 | grep "error:" && exit 1

echo "⠿ Installing..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH" 2>&1 | grep -q "installed" && echo "✓ Deployed" || { echo "✗ Install failed"; exit 1; }

# Pass --log to stream device logs after deploy
if [[ "$1" == "--log" ]]; then
    echo "⠿ Streaming logs (Ctrl-C to stop)..."
    xcrun devicectl device process launch --device "$DEVICE_ID" --console com.openscout.scout 2>&1
fi
