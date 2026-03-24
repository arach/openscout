import AppKit
import SwiftUI

final class ScoutApplicationDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        installApplicationIcon()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            sender.windows.first?.makeKeyAndOrderFront(nil)
        }

        sender.activate(ignoringOtherApps: true)
        return true
    }

    @MainActor
    private func installApplicationIcon() {
        guard let iconURL = Bundle.module.url(forResource: "AppIcon", withExtension: "icns"),
              let icon = NSImage(contentsOf: iconURL) else {
            return
        }

        NSApp.applicationIconImage = icon
    }
}

@main
struct ScoutApp: App {
    @NSApplicationDelegateAdaptor(ScoutApplicationDelegate.self) private var appDelegate
    @State private var viewModel = ScoutShellViewModel()

    var body: some Scene {
        WindowGroup("OpenScout") {
            ScoutChromeScene(viewModel: viewModel)
                .frame(minWidth: 1120, minHeight: 720)
        }
        .commands {
            ScoutAppCommands(viewModel: viewModel)
        }
    }
}
