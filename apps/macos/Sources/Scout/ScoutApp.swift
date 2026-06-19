import AppKit
import HudsonShell
import HudsonUI
import ScoutAppCore
import ScoutHUD
import SwiftUI

private enum ScoutLaunchOptions {
    static let hudRequested = CommandLine.arguments.contains("--hud")
    static let hudCommand = value(after: "--hud-command")
    static let hudValue = value(after: "--hud-value")
    static let channelId = value(after: "--channel")

    private static func value(after flag: String) -> String? {
        guard let index = CommandLine.arguments.firstIndex(of: flag) else {
            return nil
        }
        let nextIndex = CommandLine.arguments.index(after: index)
        guard CommandLine.arguments.indices.contains(nextIndex) else {
            return nil
        }
        return CommandLine.arguments[nextIndex]
    }
}

@MainActor
enum ScoutExternalCommand {
    static let openChannelNotificationName = Notification.Name("app.openscout.scout.open-channel")
    private static var pendingChannelId: String?

    static func openChannel(_ cId: String) {
        pendingChannelId = cId
        NotificationCenter.default.post(
            name: openChannelNotificationName,
            object: nil,
            userInfo: ["cId": cId]
        )
    }

    static func takePendingChannelId() -> String? {
        defer { pendingChannelId = nil }
        return pendingChannelId
    }

    static func clearPendingChannelId(_ cId: String) {
        if pendingChannelId == cId {
            pendingChannelId = nil
        }
    }
}

@main
struct ScoutApp: App {
    @NSApplicationDelegateAdaptor(ScoutAppDelegate.self) private var delegate
    @StateObject private var appearance = ScoutAppearance.shared

    init() {
        if ScoutLaunchOptions.hudRequested {
            NSApplication.shared.setActivationPolicy(.accessory)
        } else {
            NSApplication.shared.setActivationPolicy(.regular)
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
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
        if ScoutLaunchOptions.hudRequested {
            showHUDFromLaunchArguments()
        }
        if let channelId = ScoutLaunchOptions.channelId?.nilIfEmpty {
            ScoutExternalCommand.openChannel(channelId)
        }
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
        if handleOpenScoutNetworkAuth(url) {
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
        if handleAppCommand(command: command, value: value) {
            return
        }
        if !ScoutHUDRouter.handle(command: command, value: value) {
            NSLog("[hud] Scout ignored command: %@ %@", command, value ?? "")
        }
    }

    private func handleOpenScoutNetworkAuth(_ url: URL) -> Bool {
        let host = url.host?.lowercased()
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        guard host == "osn-auth" || path == "osn-auth" else {
            return false
        }

        do {
            try OpenScoutNetworkSessionStore.saveSession(from: url)
            NSLog("[scout://] Scout saved OpenScout Network session")
            DistributedNotificationCenter.default().post(
                name: ScoutServiceURLRelay.openScoutNetworkAuthSavedNotificationName,
                object: nil
            )
        } catch {
            NSLog("[scout://] Scout OpenScout Network auth failed: %@", error.localizedDescription)
        }
        return true
    }

    private func handleAppCommand(command: String, value: String?) -> Bool {
        switch command.lowercased() {
        case "channel", "open-channel":
            guard let cId = value?.nilIfEmpty else { return false }
            ScoutExternalCommand.openChannel(cId)
            return true
        default:
            return false
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

    private func showHUDFromLaunchArguments() {
        DispatchQueue.main.async { [weak self] in
            self?.hideMainWindowsForHUDLaunch()
            let command = ScoutLaunchOptions.hudCommand?.lowercased() ?? "show"
            if command == "hide" {
                HUDController.shared.dismiss()
                return
            }
            HUDController.shared.show()
            if command != "show", command != "toggle" {
                _ = ScoutHUDRouter.handle(command: command, value: ScoutLaunchOptions.hudValue)
            }
        }
    }

    private func hideMainWindowsForHUDLaunch() {
        NSApp.setActivationPolicy(.accessory)
        for window in NSApp.windows where !(window is NSPanel) {
            window.orderOut(nil)
        }
    }

    private func launchMenuHelperIfNeeded() {
        let helperBundleIdentifier = "app.openscout.scout.menu"
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
            .appendingPathComponent("ScoutMenu.app", isDirectory: true)

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
