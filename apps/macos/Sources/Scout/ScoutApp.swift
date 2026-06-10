import AppKit
import HudsonShell
import HudsonUI
import ScoutAppCore
import ScoutHUD
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

@MainActor
final class ScoutAppDelegate: NSObject, NSApplicationDelegate {
    private var distributedObserverInstalled = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        launchMenuHelperIfNeeded()
        installScoutURLHandler()
        installHUDCommandObserver()
        HUDStateFile.shared.start()
        registerHUDHotkey()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        NSApp.setActivationPolicy(.accessory)
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        NSApp.setActivationPolicy(.regular)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        HotkeyManager.shared.unregister(id: 1)
        if distributedObserverInstalled {
            DistributedNotificationCenter.default().removeObserver(
                self,
                name: ScoutHUDRouter.commandNotificationName,
                object: nil
            )
        }
    }

    private func installScoutURLHandler() {
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleScoutURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }

    private func installHUDCommandObserver() {
        guard !distributedObserverInstalled else { return }
        distributedObserverInstalled = true
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(handleHUDCommandNotification(_:)),
            name: ScoutHUDRouter.commandNotificationName,
            object: nil
        )
    }

    private func registerHUDHotkey() {
        HotkeyManager.shared.register(
            id: 1,
            keyCode: CarbonKeyCode.h,
            modifiers: CarbonModifier.hyper
        ) {
            Task { @MainActor in
                ScoutHUDRouter.handle(command: "toggle")
            }
        }
    }

    @objc
    private func handleScoutURL(_ event: NSAppleEventDescriptor, withReplyEvent _: NSAppleEventDescriptor) {
        guard
            let urlString = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
            let url = URL(string: urlString)
        else { return }
        if ScoutHUDRouter.handle(url: url) {
            return
        }
        if url.host?.lowercased() == "services" {
            forwardServiceURLToHelper(url)
        } else {
            NSLog("[scout://] Scout ignored URL: %@", url.absoluteString)
        }
    }

    @objc
    private func handleHUDCommandNotification(_ notification: Notification) {
        guard let command = notification.userInfo?["command"] as? String else {
            return
        }
        let value = notification.userInfo?["value"] as? String
        if !ScoutHUDRouter.handle(command: command, value: value) {
            NSLog("[hud] Scout ignored command: %@ %@", command, value ?? "")
        }
    }

    private func forwardServiceURLToHelper(_ url: URL) {
        DistributedNotificationCenter.default().postNotificationName(
            ScoutServiceURLRelay.notificationName,
            object: nil,
            userInfo: ScoutServiceURLRelay.userInfo(url: url),
            deliverImmediately: true
        )
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
