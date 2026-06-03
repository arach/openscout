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
        }
    }
}

final class ScoutAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
