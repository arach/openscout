import AppKit
import HudsonObservability
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

    static let openCodeLinkNotificationName = Notification.Name("app.openscout.scout.open-code-link")
    private static var pendingCodeLinkURL: URL?

    static func openCodeLink(_ url: URL) {
        pendingCodeLinkURL = url
        NotificationCenter.default.post(
            name: openCodeLinkNotificationName,
            object: nil,
            userInfo: ["url": url]
        )
    }

    static func takePendingCodeLinkURL() -> URL? {
        defer { pendingCodeLinkURL = nil }
        return pendingCodeLinkURL
    }

    static let openTerminalLinkNotificationName = Notification.Name("app.openscout.scout.open-terminal-link")
    private static var pendingTerminalLinkURL: URL?

    static func openTerminalLink(_ url: URL) {
        pendingTerminalLinkURL = url
        NotificationCenter.default.post(
            name: openTerminalLinkNotificationName,
            object: nil,
            userInfo: ["url": url]
        )
    }

    static func takePendingTerminalLinkURL() -> URL? {
        defer { pendingTerminalLinkURL = nil }
        return pendingTerminalLinkURL
    }
}

@main
struct ScoutApp: App {
    @NSApplicationDelegateAdaptor(ScoutAppDelegate.self) private var delegate
    @StateObject private var appearance = ScoutAppearance.shared

    init() {
        ScoutTerminalLaunchCommand.clearInheritedClaudeSessionFromCurrentProcess()
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
    private var hudCommandHandlingReady = false
    private var hudStartupTask: Task<Void, Never>?
    private var hudInboxRetryTask: Task<Void, Never>?

    func applicationDidFinishLaunching(_ notification: Notification) {
        HudLoggerSinks.install(HudLogStore.shared)
        HudLogger(category: "scout").info("Scout app booted", metadata: ["state": "ready"])
        launchMenuHelperIfNeeded()
        installScoutURLHandler()
        installHUDCommandObserver()
        HUDStateFile.shared.start()
        TailModeStateFile.shared.start()
        registerHUDHotkey()
        ScoutAttentionCenter.shared.start { [weak self] cId in
            if let cId = cId?.nilIfEmpty {
                _ = self?.handleAppCommand(command: "channel", value: cId)
            } else {
                _ = self?.handleAppCommand(command: "open", value: nil)
            }
        }
        scheduleInitialHUDCommandHandling()
        if let channelId = ScoutLaunchOptions.channelId?.nilIfEmpty {
            ScoutExternalCommand.openChannel(channelId)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        NSApp.setActivationPolicy(.accessory)
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindows()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        hudStartupTask?.cancel()
        hudStartupTask = nil
        hudInboxRetryTask?.cancel()
        hudInboxRetryTask = nil
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
        if !hudCommandHandlingReady,
           let userInfo = ScoutHUDRouter.distributedUserInfo(url: url),
           let command = userInfo["command"] as? String {
            let value = userInfo["value"] as? String
            do {
                try ScoutHUDCommandInbox.enqueue(command: command, value: value)
            } catch {
                NSLog("[hud] could not defer startup URL: %@", error.localizedDescription)
            }
            return
        }
        if ScoutHUDRouter.handle(url: url) {
            return
        }
        if handleOpenScoutNetworkAuth(url) {
            return
        }
        if url.host?.lowercased() == "terminal" {
            ScoutExternalCommand.openTerminalLink(url)
            showMainWindows()
            return
        }
        // scout://{path}, scout:///abs, scout://code/... — any parseable code link.
        if ScoutCodeDeepLink.parse(url) != nil {
            ScoutExternalCommand.openCodeLink(url)
            showMainWindows()
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
        guard hudCommandHandlingReady else {
            // The helper has already persisted its command. Let the bounded
            // startup task drain it after SwiftUI's initial window lifecycle
            // settles; presenting a non-activating panel before then lets the
            // scene bootstrap order it out again.
            if command != "drain-inbox" {
                let value = notification.userInfo?["value"] as? String
                _ = try? ScoutHUDCommandInbox.enqueue(command: command, value: value)
            }
            return
        }
        if command == "drain-inbox" {
            drainHUDCommandInbox()
            return
        }
        let value = notification.userInfo?["value"] as? String
        if command == "task-capture", ScoutHUDRouter.shouldDeferTaskCapture {
            do {
                try ScoutHUDCommandInbox.enqueue(command: command, value: value)
                scheduleHUDCommandInboxRetry()
            } catch {
                NSLog("[hud] could not defer capture command: %@", error.localizedDescription)
            }
            return
        }
        if !dispatchHUDCommand(command: command, value: value) {
            NSLog("[hud] Scout ignored command: %@ %@", command, value ?? "")
        }
    }

    private func dispatchHUDCommand(
        command: String,
        value: String?,
        finalizeCapture: Bool = true
    ) -> Bool {
        let handled = handleAppCommand(command: command, value: value)
            || ScoutHUDRouter.handle(command: command, value: value)
        if handled, finalizeCapture, command == "task-capture", let value {
            try? ScoutCapturePayloadStore.discard(token: value)
        }
        return handled
    }

    private func drainHUDCommandInbox() {
        do {
            try ScoutCapturePayloadStore.cleanupExpired()
            for pending in try ScoutHUDCommandInbox.pending() {
                if pending.command == "task-capture",
                   ScoutHUDRouter.shouldDeferTaskCapture {
                    scheduleHUDCommandInboxRetry()
                    return
                }
                let handled = dispatchHUDCommand(
                    command: pending.command,
                    value: pending.value,
                    finalizeCapture: false
                )
                if !handled {
                    NSLog("[hud] Scout ignored queued command: %@ %@", pending.command, pending.value ?? "")
                }
                try ScoutHUDCommandInbox.acknowledge(pending.id)
                if handled, pending.command == "task-capture", let token = pending.value {
                    try? ScoutCapturePayloadStore.discard(token: token)
                }
            }
            hudInboxRetryTask?.cancel()
            hudInboxRetryTask = nil
        } catch {
            NSLog("[hud] could not drain command inbox: %@", error.localizedDescription)
        }
    }

    private func scheduleHUDCommandInboxRetry() {
        guard hudInboxRetryTask == nil else { return }
        hudInboxRetryTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled, let self else { return }
            self.hudInboxRetryTask = nil
            self.drainHUDCommandInbox()
        }
    }

    private func scheduleInitialHUDCommandHandling() {
        hudStartupTask?.cancel()
        hudStartupTask = Task { @MainActor [weak self] in
            // A single main-queue turn is too early for a cold SwiftUI launch:
            // the WindowGroup can still order out a panel created during app
            // bootstrap. Keep the durable command queued until that settles.
            try? await Task.sleep(for: .milliseconds(650))
            guard !Task.isCancelled, let self else { return }
            self.hudStartupTask = nil
            self.hudCommandHandlingReady = true
            if ScoutLaunchOptions.hudRequested {
                self.showHUDFromLaunchArguments()
            } else {
                self.drainHUDCommandInbox()
            }
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
        case "open", "open-app", "show-app", "reopen":
            showMainWindows()
            return true
        case "channel", "open-channel":
            showMainWindows()
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
        hideMainWindowsForHUDLaunch()
        let command = ScoutLaunchOptions.hudCommand?.lowercased() ?? "show"
        if command == "drain-inbox" {
            drainHUDCommandInbox()
            return
        }
        if command == "hide" {
            HUDController.shared.dismiss()
            drainHUDCommandInbox()
            return
        }
        if command == "tail" || command.hasPrefix("tail-") {
            _ = ScoutHUDRouter.handle(command: command, value: ScoutLaunchOptions.hudValue)
        } else if command == "show" || command == "toggle" {
            _ = ScoutHUDRouter.handle(command: command, value: ScoutLaunchOptions.hudValue)
        } else {
            _ = ScoutHUDRouter.handle(command: "show")
            _ = dispatchHUDCommand(
                command: command,
                value: ScoutLaunchOptions.hudValue
            )
        }
        drainHUDCommandInbox()
    }

    private func hideMainWindowsForHUDLaunch() {
        NSApp.setActivationPolicy(.accessory)
        for window in NSApp.windows where !(window is NSPanel) {
            window.orderOut(nil)
        }
    }

    private func showMainWindows() {
        NSApp.setActivationPolicy(.regular)
        NSApp.unhide(nil)
        for window in NSApp.windows where !(window is NSPanel) {
            window.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    private func launchMenuHelperIfNeeded() {
        guard let helperURL = ScoutServicesHelper.helperBundleURL(),
              FileManager.default.fileExists(atPath: helperURL.path) else {
            return
        }

        // Match on where the helper was launched from, not on its bundle
        // identifier. Every build shares the identifier, so an identifier check
        // reports "a ScoutMenu is running" and we would adopt whichever one that
        // is — a helper from an older bundle, or from a sibling checkout — and
        // never start our own. That is how a menu survives a rebuild and then
        // outranks the build that replaced it.
        let running = ScoutServicesHelper.classifyRunningHelpers(expectedURL: helperURL)
        for stale in running.stale {
            stale.terminate()
        }
        guard running.ours == nil else {
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
