import Foundation
#if os(macOS)
import AppKit
#endif

/// Bridges the main Scout app to its menu-bar helper (ScoutMenu). The helper
/// owns the local web/broker service lifecycle; the main app can honestly ask
/// macOS to bring it forward — or launch it if it isn't running — which is the
/// only real recovery action when the local web service is down (the app cannot
/// start the web service itself).
public enum ScoutServicesHelper {
    public static let helperBundleIdentifier = "app.openscout.scout.menu"

    /// Canonical, calm copy for the "local web service unreachable" case. Shared
    /// so every offline surface says the same honest thing.
    public static let servicesOfflineMessage =
        "Scout services are offline. Start them from the menu bar, then retry."

    /// Bring the menu-bar helper forward, launching it from the bundled
    /// LoginItems copy if it isn't already running. Best-effort and silent on
    /// failure — the caller already surfaces the offline copy regardless.
    @MainActor
    public static func openMenuBarHelper() {
        #if os(macOS)
        if let running = NSWorkspace.shared.runningApplications.first(where: {
            $0.bundleIdentifier == helperBundleIdentifier
        }) {
            running.activate(options: [.activateAllWindows])
            return
        }

        guard let helperURL = helperBundleURL(),
              FileManager.default.fileExists(atPath: helperURL.path) else {
            return
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.addsToRecentItems = false
        NSWorkspace.shared.openApplication(at: helperURL, configuration: configuration) { _, error in
            if let error {
                NSLog("Scout could not open menu bar controls: \(error.localizedDescription)")
            }
        }
        #endif
    }

    #if os(macOS)
    /// The menu-bar helper ships as a LoginItems bundle inside the main app, so
    /// the main app can launch it without knowing an install path (matches
    /// `ScoutApp.launchMenuHelperIfNeeded`).
    private static func helperBundleURL() -> URL? {
        Bundle.main.bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("LoginItems", isDirectory: true)
            .appendingPathComponent("ScoutMenu.app", isDirectory: true)
    }
    #endif
}
