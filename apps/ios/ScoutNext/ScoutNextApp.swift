import SwiftUI
import HudsonUI

/// ScoutNext (SCO-061) — the next-gen, Hudson-first iOS app. Surfaces consume
/// the shared `ScoutCapabilities` layer through a `ScoutBrokerClient`. The
/// default source is the live encrypted `BridgeBrokerClient` (reusing the Mac
/// pairing already in the keychain); a Mock source remains for offline UI work.
@main
struct ScoutNextApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .hudsonAppManifest(
                    HudAppManifest(name: "Scout", version: "0.1.0", tint: .green, targetLabel: "Agent")
                )
                .preferredColorScheme(.dark)
                .task { await model.connectIfNeeded() }
        }
    }
}
