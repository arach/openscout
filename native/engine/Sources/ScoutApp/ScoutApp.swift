import AppKit
import ScoutCore
import SwiftUI

final class ScoutApplicationDelegate: NSObject, NSApplicationDelegate {
    var onTerminate: (() -> Void)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        installApplicationIcon()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        ScoutDiagnosticsLogger.log("ScoutApp launched (pid \(ProcessInfo.processInfo.processIdentifier)).")
    }

    func applicationWillTerminate(_ notification: Notification) {
        ScoutDiagnosticsLogger.log("ScoutApp will terminate.")
        onTerminate?()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            sender.windows.first?.makeKeyAndOrderFront(nil)
        }

        ScoutDiagnosticsLogger.log("ScoutApp reopen requested.")
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
                .onAppear {
                    appDelegate.onTerminate = {
                        viewModel.shutdown()
                    }
                }
        }
        .commands {
            ScoutAppCommands(viewModel: viewModel)
        }
    }
}
