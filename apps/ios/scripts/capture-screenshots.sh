#!/bin/bash
# Build Scout for Simulator, launch screenshot scenarios, and save App Store-sized screenshots.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="Scout.xcodeproj"
SCHEME="ScoutApp"
BUNDLE_ID="com.openscout.scout"
CONFIGURATION="${OPENSCOUT_IOS_SCREENSHOT_CONFIGURATION:-Release}"
DERIVED_DATA_PATH="${OPENSCOUT_IOS_SCREENSHOT_DERIVED_DATA_PATH:-$(pwd)/.deriveddata/screenshots}"
OUTPUT_ROOT="${OPENSCOUT_IOS_SCREENSHOT_OUTPUT_DIR:-$(pwd)/.artifacts/app-store-screenshots}"
RUNTIME_ID="${OPENSCOUT_IOS_SCREENSHOT_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-26-4}"

IPHONE_SIM_NAME="${OPENSCOUT_IOS_SCREENSHOT_IPHONE_SIM_NAME:-OpenScout Screenshot iPhone 12 Pro Max}"
IPHONE_DEVICE_TYPE="${OPENSCOUT_IOS_SCREENSHOT_IPHONE_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-12-Pro-Max}"
IPAD_SIM_NAME="${OPENSCOUT_IOS_SCREENSHOT_IPAD_SIM_NAME:-OpenScout Screenshot iPad Pro 12.9}"
IPAD_DEVICE_TYPE="${OPENSCOUT_IOS_SCREENSHOT_IPAD_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPad-Pro-12-9-inch-6th-generation-8GB}"

SCENARIOS=(onboarding home sessions timeline)
IPHONE_OUTPUT_DIR="$OUTPUT_ROOT/iphone-65"
IPAD_OUTPUT_DIR="$OUTPUT_ROOT/ipad-pro-129"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $1" >&2
    exit 1
  fi
}

ensure_simulator() {
  local name="$1"
  local device_type="$2"
  local existing

  existing="$(xcrun simctl list devices available | awk -v name="$name" '
    index($0, name " (") { sub(/^.*\(/, "", $0); sub(/\).*/, "", $0); print; exit }
  ')"

  if [[ -n "$existing" ]]; then
    printf '%s\n' "$existing"
    return
  fi

  xcrun simctl create "$name" "$device_type" "$RUNTIME_ID"
}

boot_and_prepare() {
  local udid="$1"

  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl ui "$udid" appearance light >/dev/null 2>&1 || true
  xcrun simctl status_bar "$udid" override \
    --time "9:41" \
    --dataNetwork wifi \
    --wifiBars 3 \
    --cellularMode active \
    --batteryState charged \
    --batteryLevel 100 >/dev/null 2>&1 || true
}

capture_set() {
  local udid="$1"
  local output_dir="$2"
  local app_path="$3"

  mkdir -p "$output_dir"
  rm -f "$output_dir"/*.png

  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$app_path" >/dev/null

  local index=1
  local scenario
  for scenario in "${SCENARIOS[@]}"; do
    local padded_index
    printf -v padded_index "%02d" "$index"
    local path="$output_dir/${padded_index}-${scenario}.png"

    xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" \
      -ScoutScreenshotScenario "$scenario" \
      -AppleLanguages "(en-US)" \
      -AppleLocale "en_US" >/dev/null

    sleep 2
    xcrun simctl io "$udid" screenshot "$path" >/dev/null
    index=$((index + 1))
  done
}

validate_output() {
  local path="$1"
  local device_type="$2"
  asc-at-125 screenshots validate --path "$path" --device-type "$device_type"
}

require_cmd xcodebuild
require_cmd xcrun
require_cmd asc-at-125

echo "Building ScoutApp ($CONFIGURATION) for Simulator..."
echo "DerivedData: $DERIVED_DATA_PATH"
echo "Output root: $OUTPUT_ROOT"
echo ""

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  SDKROOT=iphonesimulator \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build >/dev/null

APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-iphonesimulator/Scout.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: Build output not found at $APP_PATH" >&2
  exit 1
fi

IPHONE_UDID="$(ensure_simulator "$IPHONE_SIM_NAME" "$IPHONE_DEVICE_TYPE")"
IPAD_UDID="$(ensure_simulator "$IPAD_SIM_NAME" "$IPAD_DEVICE_TYPE")"

boot_and_prepare "$IPHONE_UDID"
boot_and_prepare "$IPAD_UDID"

echo "Capturing iPhone screenshots..."
capture_set "$IPHONE_UDID" "$IPHONE_OUTPUT_DIR" "$APP_PATH"

echo "Capturing iPad screenshots..."
capture_set "$IPAD_UDID" "$IPAD_OUTPUT_DIR" "$APP_PATH"

echo "Validating screenshot sizes..."
validate_output "$IPHONE_OUTPUT_DIR" "IPHONE_65"
validate_output "$IPAD_OUTPUT_DIR" "IPAD_PRO_3GEN_129"

echo ""
echo "Saved screenshots:"
echo "  $IPHONE_OUTPUT_DIR"
echo "  $IPAD_OUTPUT_DIR"
