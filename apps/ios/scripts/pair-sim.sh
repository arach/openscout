#!/usr/bin/env bash
# Camera-free pairing for the iOS Simulator (which has no camera).
#
# The simulator can't scan a QR, so this hands Scout the Mac's live pairing
# payload two ways: it copies the payload to the sim clipboard (tap "Paste
# pairing link" in the app) and prints the scout:// deep link.
#
# Prereq: click "Start pairing" in Scout on your Mac so a fresh, non-expired
# room exists. Then:  apps/ios/scripts/pair-sim.sh ["iPhone 17 Pro Max"]
set -euo pipefail

DEVICE="${1:-iPhone 17 Pro Max}"
RUNTIME="$HOME/.scout/pairing/runtime.json"

[ -f "$RUNTIME" ] || { echo "No $RUNTIME — start pairing in Scout on your Mac first."; exit 1; }

QV="$(python3 - "$RUNTIME" <<'PY'
import json, sys, time
d = json.load(open(sys.argv[1]))
p = d.get("pairing") or {}
qv = p.get("qrValue")
if not qv:
    sys.exit("no qrValue in runtime.json — start a fresh pairing on the Mac")
exp = p.get("expiresAt") or 0
if exp and int(time.time() * 1000) > exp:
    sys.stderr.write("⚠️  pairing QR is EXPIRED — click Start Pairing on the Mac for a fresh one\n")
sys.stdout.write(qv)
PY
)"

printf '%s' "$QV" | xcrun simctl pbcopy "$DEVICE"
echo "✅ payload copied to \"$DEVICE\" clipboard — tap 'Paste pairing link' in Scout"

LINK="$(QV="$QV" python3 -c 'import os,urllib.parse; print("scout://pair?payload="+urllib.parse.quote(os.environ["QV"],safe=""))')"
echo "🔗 deep link (or: xcrun simctl openurl \"$DEVICE\" '<link>'):"
echo "   $LINK"
