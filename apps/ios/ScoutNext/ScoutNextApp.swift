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
            Group {
                switch model.phase {
                case .connect: ConnectScreen(model: model)
                case .shell:   RootView(model: model)
                }
            }
            .hudsonAppManifest(
                HudAppManifest(name: "Scout", version: "0.1.0", tint: .green, targetLabel: "Agent")
            )
            // Shared dictation controller — the composer and Settings both read
            // and drive the same on-device transcription state.
            .environment(model.dictation)
            .preferredColorScheme(.dark)
            // Pairing presents from both phases (Connect screen CTA and the
            // in-shell Connection sheet), so it lives at the app root.
            .sheet(isPresented: $model.showPairing) {
                PairingView(model: model)
            }
            // Camera-free deep-link pairing: scoutnext://pair?payload=…
            .onOpenURL { url in
                Task { await model.pairFromLink(url.absoluteString) }
            }
            .task { await model.start() }
        }
    }
}
