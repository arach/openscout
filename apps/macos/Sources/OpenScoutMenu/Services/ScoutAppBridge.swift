import AppKit
import Foundation
import ScoutHUD

@MainActor
enum ScoutAppBridge {
    private static let scoutBundleIdentifier = "com.openscout.scout"

    static func openScout() {
        launchScoutIfNeeded(activates: true, arguments: []) {}
    }

    static func openHUD(command: String, value: String? = nil) {
        launchScoutIfNeeded(activates: false, arguments: ["--hud"]) {
            postHUDCommand(command: command, value: value)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                postHUDCommand(command: command, value: value)
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
        configuration.arguments = arguments

        NSWorkspace.shared.openApplication(at: scoutURL, configuration: configuration) { _, error in
            if let error {
                NSLog("[hud] could not launch Scout.app: %@", error.localizedDescription)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                Task { @MainActor in
                    completion()
                }
            }
        }
    }

    private static var runningScoutApp: NSRunningApplication? {
        NSWorkspace.shared.runningApplications.first {
            $0.bundleIdentifier == scoutBundleIdentifier
        }
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
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: scoutBundleIdentifier) {
            return url
        }

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

        return nil
    }
}
