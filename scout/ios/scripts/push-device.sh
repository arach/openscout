#!/bin/bash
# Build Scout for a physical iPhone into the stable repo-owned derived data path,
# then install that exact app bundle on the device.

set -euo pipefail
cd "$(dirname "$0")"

bash ./build-device.sh "$@"
bash ./install-last-build.sh
