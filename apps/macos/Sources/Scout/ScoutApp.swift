import AppKit
import HudsonShell
import HudsonUI
import SwiftUI

@main
struct ScoutApp: App {
    @NSApplicationDelegateAdaptor(ScoutAppDelegate.self) private var delegate
    @StateObject private var appearance = ScoutAppearance.shared

    init() {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some Scene {
        WindowGroup("Scout") {
            ScoutRootView()
                .frame(minWidth: 1040, minHeight: 680)
                .preferredColorScheme(appearance.themeMode.colorScheme)
        }
        .hudChromeWindow()
        .commands {
            CommandGroup(replacing: .newItem) {}
            ScoutCommands()
        }
    }
}

final class ScoutAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        launchMenuHelperIfNeeded()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func launchMenuHelperIfNeeded() {
        let helperBundleIdentifier = "com.openscout.menu"
        let helperAlreadyRunning = NSWorkspace.shared.runningApplications.contains {
            $0.bundleIdentifier == helperBundleIdentifier
        }
        guard !helperAlreadyRunning else {
            return
        }

        let helperURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("LoginItems", isDirectory: true)
            .appendingPathComponent("OpenScout Menu.app", isDirectory: true)

        guard FileManager.default.fileExists(atPath: helperURL.path) else {
            return
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false

        NSWorkspace.shared.openApplication(at: helperURL, configuration: configuration) { _, error in
            if let error {
                NSLog("OpenScout could not launch menu helper: \(error.localizedDescription)")
            }
        }
    }
}
