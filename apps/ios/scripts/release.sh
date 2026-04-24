#!/bin/bash
# Sync Scout's iOS version to the repo npm version, then archive/upload with asc.

set -euo pipefail
cd "$(dirname "$0")/.."

APP_ID="${OPENSCOUT_ASC_APP_ID:-6761672978}"
ASC_BIN="${OPENSCOUT_ASC_BIN:-asc}"
ROOT_PACKAGE_JSON="$(cd ../.. && pwd)/package.json"
PROJECT_YML="project.yml"
PROJECT="Scout.xcodeproj"
SCHEME="ScoutApp"
TARGET="ScoutApp"
ARCHIVE_PATH=".asc/artifacts/Scout.xcarchive"
IPA_PATH=".asc/artifacts/Scout.ipa"
EXPORT_OPTIONS=".asc/ExportOptions.plist"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $1" >&2
    exit 1
  fi
}

json_field() {
  local field="$1"
  ruby -rjson -e 'value = JSON.parse(STDIN.read); field = ARGV[0].split("."); field.each { |key| value = value[key] unless value.nil? }; puts(value.nil? ? "" : value)' "$field"
}

package_version() {
  node -p "require(process.argv[1]).version" "$ROOT_PACKAGE_JSON"
}

project_value() {
  local key="$1"
  ruby -e '
    path = ARGV[0]
    key = ARGV[1]
    line = File.readlines(path).find { |entry| entry.include?(key) }
    abort("Missing #{key} in #{path}") unless line
    match = line.match(/"([^"]+)"/)
    abort("Malformed #{key} in #{path}: #{line}") unless match
    puts match[1]
  ' "$PROJECT_YML" "$key"
}

update_project_versions() {
  local version="$1"
  local build="$2"
  ruby -e '
    path, version, build = ARGV
    text = File.read(path)
    text.sub!(/MARKETING_VERSION: "[^"]+"/, %{MARKETING_VERSION: "#{version}"}) or abort("Failed to update MARKETING_VERSION")
    text.sub!(/CURRENT_PROJECT_VERSION: "[^"]+"/, %{CURRENT_PROJECT_VERSION: "#{build}"}) or abort("Failed to update CURRENT_PROJECT_VERSION")
    File.write(path, text)
  ' "$PROJECT_YML" "$version" "$build"
}

next_build_number() {
  local version="$1"
  "$ASC_BIN" builds next-build-number \
    --app "$APP_ID" \
    --version "$version" \
    --platform IOS \
    --output json | json_field "nextBuildNumber"
}

align_draft_version() {
  local target_version="$1"
  local status_json version_id version state

  status_json="$("$ASC_BIN" status --app "$APP_ID" --include appstore --output json)"
  version_id="$(printf '%s' "$status_json" | json_field "appstore.versionId")"
  version="$(printf '%s' "$status_json" | json_field "appstore.version")"
  state="$(printf '%s' "$status_json" | json_field "appstore.state")"

  if [[ -z "$version_id" || -z "$state" ]]; then
    return
  fi

  if [[ "$state" != "PREPARE_FOR_SUBMISSION" ]]; then
    echo "ERROR: Existing App Store version is in state $state; refusing to retarget it automatically." >&2
    exit 1
  fi

  if [[ "$version" == "$target_version" ]]; then
    return
  fi

  echo "Aligning App Store draft version: $version -> $target_version"
  "$ASC_BIN" versions update \
    --version-id "$version_id" \
    --version "$target_version" \
    --output json >/dev/null
}

require_cmd "$ASC_BIN"
require_cmd node
require_cmd ruby
require_cmd xcodegen

NPM_VERSION="$(package_version)"
CURRENT_VERSION="$(project_value "MARKETING_VERSION:")"
CURRENT_BUILD="$(project_value "CURRENT_PROJECT_VERSION:")"
NEW_VERSION="$NPM_VERSION"
NEW_BUILD="$(next_build_number "$NEW_VERSION")"

echo "Version:  $CURRENT_VERSION -> $NEW_VERSION"
echo "Build:    $CURRENT_BUILD -> $NEW_BUILD"

update_project_versions "$NEW_VERSION" "$NEW_BUILD"

echo ""
echo "Regenerating Xcode project..."
xcodegen generate >/dev/null

SYNC_JSON="$("$ASC_BIN" xcode version view --project "$PROJECT" --target "$TARGET" --output json)"
SYNCED_VERSION="$(printf '%s' "$SYNC_JSON" | json_field "version")"
SYNCED_BUILD="$(printf '%s' "$SYNC_JSON" | json_field "buildNumber")"

if [[ "$SYNCED_VERSION" != "$NEW_VERSION" || "$SYNCED_BUILD" != "$NEW_BUILD" ]]; then
  echo "ERROR: Xcode project reports version $SYNCED_VERSION ($SYNCED_BUILD), expected $NEW_VERSION ($NEW_BUILD)." >&2
  exit 1
fi

align_draft_version "$NEW_VERSION"

echo ""
echo "Archiving, uploading, and attaching with asc..."
mkdir -p "$(dirname "$ARCHIVE_PATH")"
rm -rf "$ARCHIVE_PATH" "$IPA_PATH"

"$ASC_BIN" publish appstore \
  --app "$APP_ID" \
  --project "$PROJECT" \
  --scheme "$SCHEME" \
  --configuration Release \
  --version "$NEW_VERSION" \
  --build-number "$NEW_BUILD" \
  --archive-path "$ARCHIVE_PATH" \
  --ipa-path "$IPA_PATH" \
  --export-options "$EXPORT_OPTIONS" \
  --archive-xcodebuild-flag=-allowProvisioningUpdates \
  --export-xcodebuild-flag=-allowProvisioningUpdates \
  --wait \
  --output json --pretty

echo ""
echo "Validating App Store readiness..."
"$ASC_BIN" validate \
  --app "$APP_ID" \
  --version "$NEW_VERSION" \
  --platform IOS \
  --output table
