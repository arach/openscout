import HudsonObservability
import SwiftUI
import HudsonUI

/// Scout (SCO-061) — the next-gen, Hudson-first iOS app. Surfaces consume
/// the shared `ScoutCapabilities` layer through a `ScoutBrokerClient`. The
/// default source is the live encrypted `BridgeBrokerClient` (reusing the Mac
/// pairing already in the keychain); a Mock source remains for offline UI work.
@main
struct ScoutApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        HudLoggerSinks.install(HudLogStore.shared)
        HudLogger(category: "scout-ios").info("Scout iOS booted", metadata: ["state": "ready"])
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch model.phase {
                case .connect: ConnectScreen(model: model)
                case .shell:   RootView(model: model)
                }
            }
            .hudsonAppManifest(
                HudAppManifest(name: "Scout", version: "0.2.70", tint: .green, targetLabel: "Agent")
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
            // Camera-free pairing and native auth: scout://pair?payload=…
            // and scout://osn-auth?session=…
            .onOpenURL { url in
                Task { await model.handleDeepLink(url) }
            }
            .onChange(of: scenePhase) { _, phase in
                model.setScenePhase(phase)
            }
            .task { await model.start() }
        }
    }
}
