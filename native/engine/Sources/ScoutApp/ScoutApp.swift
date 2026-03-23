import AppKit
import SwiftUI

final class ScoutApplicationDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
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
