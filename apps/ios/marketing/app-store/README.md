# Scout App Store creative set

First-pass iPhone product-page creative direction for Scout. The exports use
Apple's accepted 6.9-inch portrait canvas size: 1320 × 2868 pixels.

## Render

From the repository root:

```bash
node apps/ios/marketing/app-store/render.mjs
```

The renderer uses the checked-in Scout iPhone screenshots and app icon. It does
not redraw or invent app UI. Exports are written to `iphone-69/`.

## Creative sequence

1. **Your agents. In your pocket.** — opening promise and full Home surface.
2. **Read progress. Reply from anywhere.** — conversation and voice response.
3. **Every project. One calm view.** — detail crops for project/activity scan.
4. **Local-first. Human-controlled.** — pairing, route state, and response loop.

The first two are the strongest iPhone submission candidates because each is
anchored by a complete device screenshot. The detail-led third and fourth
frames are supporting product-story assets.

The deterministic capture script produces current iPhone 6.9-inch and iPad
12.9-inch sets for onboarding, Home, Comms, and Tail. Non-onboarding captures
use the simulator's real pairing and broker APIs; there is no synthetic fleet or
conversation mode. Pair the capture simulator before running the script.

## Metadata and upload

Canonical English metadata lives under `metadata/`. Validate it offline before
applying it to App Store Connect:

```bash
asc metadata validate --dir apps/ios/marketing/app-store/metadata
asc metadata apply --app 6761672978 --version 0.2.73 \
  --dir apps/ios/marketing/app-store/metadata
```

Capture and validate the raw device screenshots with:

```bash
bash apps/ios/scripts/capture-screenshots.sh
```

After reviewing the real-data captures, replace the English screenshot sets with:

```bash
asc screenshots upload --version-localization "$VERSION_LOCALIZATION_ID" \
  --path apps/ios/.artifacts/app-store-screenshots/iphone-69 \
  --device-type IPHONE_69 --replace
asc screenshots upload --version-localization "$VERSION_LOCALIZATION_ID" \
  --path apps/ios/.artifacts/app-store-screenshots/ipad-pro-129 \
  --device-type IPAD_PRO_3GEN_129 --replace
```

App Store Connect currently rejects `whatsNew` for Scout's first unreleased
version even though the CLI readiness report recommends it. Keep release notes
out of canonical metadata until Apple enables that field after the first release.
