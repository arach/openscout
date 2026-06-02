import SwiftUI
import HudsonUI
import ScoutCapabilities

/// ScoutNext (SCO-061) — the next-gen, Hudson-first iOS app. A clean shell that
/// consumes the shared `ScoutCapabilities` layer through a `ScoutBrokerClient`.
/// In this build the client is a fully offline `MockBrokerClient` so the app
/// runs without a paired Mac or broker.
@main
struct ScoutNextApp: App {
    /// One client instance lives for the app's lifetime and is threaded down to
    /// every surface. Swapping in a live `BridgeBrokerClient` later is a
    /// single-line change here.
    private let client: any ScoutBrokerClient = MockBrokerClient()

    var body: some Scene {
        WindowGroup {
            RootView(client: client)
                .hudsonAppManifest(
                    HudAppManifest(name: "Scout", version: "0.1.0", tint: .green, targetLabel: "Agent")
                )
                .preferredColorScheme(.dark)
        }
    }
}
