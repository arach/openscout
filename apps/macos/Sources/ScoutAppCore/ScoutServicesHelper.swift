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
        guard let helperURL = helperBundleURL(),
              FileManager.default.fileExists(atPath: helperURL.path) else {
            return
        }

        let running = classifyRunningHelpers(expectedURL: helperURL)
        if let ours = running.ours {
            ours.activate(options: [.activateAllWindows])
            return
        }

        // Only helpers whose bundle is gone. A helper from a sibling checkout's
        // live bundle is reported, never terminated — it is not ours to stop.
        for stale in running.stale {
            stale.terminate()
        }
        for foreign in running.foreign {
            NSLog("Scout: leaving another checkout's menu helper alone: \(foreign.bundleURL?.path ?? "unknown bundle")")
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
    /// the main app can launch it without knowing an install path. Public so the
    /// main app resolves the helper the same way this does rather than rebuilding
    /// the path itself.
    public static func helperBundleURL() -> URL? {
        Bundle.main.bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("LoginItems", isDirectory: true)
            .appendingPathComponent("ScoutMenu.app", isDirectory: true)
    }

    private static func isSameBundle(_ candidate: URL?, _ expected: URL) -> Bool {
        guard let candidate else { return false }
        return candidate.standardizedFileURL.resolvingSymlinksInPath().path
            == expected.standardizedFileURL.resolvingSymlinksInPath().path
    }

    /// Splits the running helpers three ways: ours, stale, and foreign.
    ///
    /// Identity is the bundle *location*, not the bundle identifier. Every build
    /// of the helper shares `app.openscout.scout.menu`, so an identifier match
    /// only answers "is some ScoutMenu running" — which is not the question.
    ///
    /// The split between stale and foreign is what keeps this honest. A helper
    /// whose bundle is no longer on disk belongs to nobody: the build it came
    /// from was replaced or deleted, so terminating it reclaims the menu bar
    /// from a process that can never be rebuilt into. A helper whose bundle
    /// still exists belongs to whoever owns that bundle — on this machine, the
    /// sibling checkout — and is theirs to stop, not ours. Terminating it is the
    /// same cross-checkout kill the CLI half of this lifecycle work refuses to
    /// do; two menu bar icons is the correct, visible cost of not doing it.
    public static func classifyRunningHelpers(
        expectedURL: URL,
    ) -> (ours: NSRunningApplication?, stale: [NSRunningApplication], foreign: [NSRunningApplication]) {
        var ours: NSRunningApplication?
        var stale: [NSRunningApplication] = []
        var foreign: [NSRunningApplication] = []

        for application in NSWorkspace.shared.runningApplications
        where application.bundleIdentifier == helperBundleIdentifier {
            if isSameBundle(application.bundleURL, expectedURL) {
                // A second helper from our own bundle is a duplicate, not a
                // rival: it is ours to clean up.
                if ours == nil { ours = application } else { stale.append(application) }
                continue
            }
            if let url = application.bundleURL,
               FileManager.default.fileExists(atPath: url.path) {
                foreign.append(application)
            } else {
                stale.append(application)
            }
        }

        return (ours, stale, foreign)
    }
    #endif
}
