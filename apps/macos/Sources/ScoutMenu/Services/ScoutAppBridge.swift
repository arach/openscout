import AppKit
import Darwin
import Foundation
import ScoutAppCore
import ScoutHUD

@MainActor
enum ScoutAppBridge {
    private static let scoutBundleIdentifier = "app.openscout.scout"
    private static var directLaunchInFlight = false

    static func openScout(channelId: String? = nil) {
        if runningScoutApp == nil {
            launchScoutIfNeeded(activates: true, arguments: appLaunchArguments(channelId: channelId)) {}
            return
        }

        reopenScoutApp {
            postHUDCommand(command: "open-app", value: nil)
            if let channelId {
                postHUDCommand(command: "channel", value: channelId)
            }
        }
    }

    @discardableResult
    static func openHUD(command: String, value: String? = nil) -> Bool {
        let appWasRunning = runningScoutApp != nil
        if !appWasRunning && (command == "hide" || command == "tail-hide") {
            return false
        }
        guard appWasRunning || scoutApplicationURL() != nil else {
            return false
        }

        do {
            try ScoutHUDCommandInbox.enqueue(command: command, value: value)
        } catch {
            NSLog("[hud] could not persist command inbox entry: %@", error.localizedDescription)
            guard appWasRunning || scoutApplicationURL() != nil else { return false }
            if appWasRunning {
                postHUDCommand(command: command, value: value)
            } else {
                launchScoutIfNeeded(
                    activates: false,
                    arguments: hudLaunchArguments(command: command, value: value)
                ) {}
            }
            return true
        }

        let arguments = appWasRunning
            ? []
            : hudLaunchArguments(command: "drain-inbox", value: nil)
        launchScoutIfNeeded(activates: false, arguments: arguments) {
            postHUDCommand(command: "drain-inbox", value: nil)
        }
        return true
    }

    private static func reopenScoutApp(completion: @MainActor @escaping @Sendable () -> Void) {
        guard let scoutURL = scoutApplicationURL() else {
            if let app = runningScoutApp {
                app.activate(options: [.activateAllWindows])
            }
            completion()
            return
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.addsToRecentItems = false

        NSWorkspace.shared.openApplication(at: scoutURL, configuration: configuration) { app, error in
            if let error {
                NSLog("[hud] could not reopen Scout.app: %@", error.localizedDescription)
                DispatchQueue.main.async {
                    if let app = runningScoutApp {
                        app.activate(options: [.activateAllWindows])
                    }
                    Task { @MainActor in completion() }
                }
                return
            }
            if let app {
                app.activate(options: [.activateAllWindows])
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.20) {
                Task { @MainActor in completion() }
            }
        }
    }

    private static func launchScoutIfNeeded(
        activates: Bool,
        arguments: [String],
        completion: @MainActor @escaping @Sendable () -> Void
    ) {
        if let app = runningScoutApp {
            if activates {
                app.activate(options: [.activateAllWindows])
            }
            completion()
            return
        }

        guard let scoutURL = scoutApplicationURL() else {
            NSLog("[hud] could not locate Scout.app to forward HUD command")
            return
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = activates
        configuration.addsToRecentItems = false
        configuration.createsNewApplicationInstance = true
        configuration.arguments = arguments

        // A legacy OpenScout.app can share Scout's bundle identifier. Do not
        // let LaunchServices redirect this explicit embedded-app launch to that
        // stale registration.
        for app in runningScoutApplications where app.bundleURL?.standardizedFileURL != scoutURL.standardizedFileURL {
            app.terminate()
        }

        NSWorkspace.shared.openApplication(at: scoutURL, configuration: configuration) { _, error in
            if let error {
                NSLog("[hud] could not launch Scout.app: %@", error.localizedDescription)
                DispatchQueue.main.async {
                    Task { @MainActor in
                        launchScoutExecutable(
                            at: scoutURL,
                            activates: activates,
                            arguments: arguments,
                            completion: completion
                        )
                    }
                }
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                Task { @MainActor in
                    completion()
                }
            }
        }
    }

    /// Development builds can be perfectly executable while LaunchServices
    /// rejects their freshly ad-hoc-signed bundle. The helper already has an
    /// exact path to the enclosing Scout.app, so fall back to that bundle's
    /// fixed executable instead of dropping an acknowledged ask command.
    private static func launchScoutExecutable(
        at scoutURL: URL,
        activates: Bool,
        arguments: [String],
        completion: @MainActor @escaping @Sendable () -> Void
    ) {
        if directLaunchInFlight {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.50) {
                Task { @MainActor in completion() }
            }
            return
        }

        let executableURL = scoutURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("MacOS", isDirectory: true)
            .appendingPathComponent("Scout", isDirectory: false)
        guard FileManager.default.isExecutableFile(atPath: executableURL.path) else {
            NSLog("[hud] Scout executable is missing or not executable: %@", executableURL.path)
            return
        }

        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            directLaunchInFlight = true
            try process.run()
        } catch {
            directLaunchInFlight = false
            NSLog("[hud] could not launch Scout executable directly: %@", error.localizedDescription)
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.50) {
            directLaunchInFlight = false
            if activates, let app = runningScoutApp {
                app.activate(options: [.activateAllWindows])
            }
            Task { @MainActor in completion() }
        }
    }

    private static var runningScoutApp: NSRunningApplication? {
        guard let scoutURL = scoutApplicationURL()?.standardizedFileURL else { return nil }
        return runningScoutApplications.first {
            $0.bundleURL?.standardizedFileURL == scoutURL
        }
    }

    private static var runningScoutApplications: [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter {
            $0.bundleIdentifier == scoutBundleIdentifier
                && !$0.isTerminated
                && isProcessAlive($0.processIdentifier)
        }
    }

    static func isProcessAlive(_ pid: pid_t) -> Bool {
        guard pid > 0 else { return false }
        if kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }

    private static func hudLaunchArguments(command: String, value: String?) -> [String] {
        var arguments = ["--hud", "--hud-command", command]
        if let value {
            arguments += ["--hud-value", value]
        }
        return arguments
    }

    private static func appLaunchArguments(channelId: String?) -> [String] {
        guard let channelId else { return [] }
        return ["--channel", channelId]
    }

    private static func postHUDCommand(command: String, value: String?) {
        DistributedNotificationCenter.default().postNotificationName(
            ScoutHUDRouter.commandNotificationName,
            object: nil,
            userInfo: ScoutHUDRouter.distributedUserInfo(command: command, value: value),
            deliverImmediately: true
        )
    }

    private static func scoutApplicationURL() -> URL? {
        let bundleURL = Bundle.main.bundleURL
        let fileManager = FileManager.default
        let embeddedMainApp = bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        if embeddedMainApp.pathExtension == "app",
           fileManager.fileExists(atPath: embeddedMainApp.path) {
            return embeddedMainApp
        }

        let appDirectory = bundleURL.deletingLastPathComponent()
        for name in ["Scout.app", "OpenScout.app"] {
            let sibling = appDirectory.appendingPathComponent(name, isDirectory: true)
            if fileManager.fileExists(atPath: sibling.path) {
                return sibling
            }
        }

        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: scoutBundleIdentifier) {
            return url
        }

        return nil
    }
}
