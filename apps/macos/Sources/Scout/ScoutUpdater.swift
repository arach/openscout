import Combine
import Foundation
import Sparkle

/// Owns Sparkle's `SPUStandardUpdaterController` for shipped builds and degrades
/// to an inert stub everywhere else.
///
/// Sparkle needs a real, identified `.app` container: it launches the bundled
/// Autoupdate helper and the Installer/Downloader XPC services relative to the
/// app bundle, and it keys its update state off the bundle identifier. Under a
/// bare `swift run` (no bundle, no identifier) constructing the updater would
/// assert or misbehave. Local ad-hoc bundles also carry placeholder Sparkle
/// metadata, so we only build the live controller when the process is a bundled,
/// identified app with a real appcast configuration and otherwise stay a no-op with
/// `canCheckForUpdates == false`.
///
/// Automatic-update consent is deliberately left to Sparkle's own first-run
/// prompt — we never force-enable scheduled checks here.
@MainActor
final class ScoutUpdater: ObservableObject {
    static let shared = ScoutUpdater()

    /// Mirrors `SPUUpdater.canCheckForUpdates` so the menu item can disable
    /// itself while the updater is inert (dev) or momentarily busy (already
    /// checking / installing).
    @Published private(set) var canCheckForUpdates = false

    private let controller: SPUStandardUpdaterController?
    private var cancellable: AnyCancellable?

    private init() {
        guard Self.canStartSparkle else {
            controller = nil
            return
        }
        let controller = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        self.controller = controller
        cancellable = controller.updater.publisher(for: \.canCheckForUpdates)
            .receive(on: RunLoop.main)
            .sink { [weak self] value in
                self?.canCheckForUpdates = value
            }
    }

    /// Present Sparkle's update UI (or the "you're up to date" panel). No-op when
    /// the updater is inert.
    func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }

    /// True only for a real, identified `.app` bundle with release updater
    /// metadata — never for `swift run`, unbundled binaries, or local dev bundles.
    private static var canStartSparkle: Bool {
        guard Bundle.main.bundleURL.pathExtension == "app",
              Bundle.main.bundleIdentifier != nil,
              let feedURL = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String,
              let feedScheme = URL(string: feedURL.trimmingCharacters(in: .whitespacesAndNewlines))?.scheme?.lowercased(),
              feedScheme == "https",
              let publicKey = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String
        else {
            return false
        }

        let trimmedPublicKey = publicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmedPublicKey.isEmpty && trimmedPublicKey != "REPLACE-WITH-GENERATED-ED-KEY"
    }
}
