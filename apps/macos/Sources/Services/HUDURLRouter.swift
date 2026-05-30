import AppKit
import Foundation

/// Routes `scout://` URLs to HUD actions. Wired from AppDelegate's
/// NSAppleEventManager kAEGetURL handler.
///
/// Supported paths:
///   scout://hud/show          — present the panel
///   scout://hud/hide          — dismiss
///   scout://hud/toggle        — flip current state
///   scout://hud/tab/<name>    — agents | activity | tail | sessions | assistant
///   scout://hud/size/<name>   — compact | medium | large  (also accepts s | m | l)
///   scout://settings          — open the control center
///   scout://settings/<name>   — diagnostics | voice | about | advanced | appearance
///
/// All actions are fire-and-forget; current state is mirrored to
/// `/tmp/openscout-hud-state.json` by HUDStateFile so callers can read
/// it without a round trip.
@MainActor
enum HUDURLRouter {
    static func handle(url: URL, controller: OpenScoutAppController) {
        guard url.scheme?.lowercased() == "scout" else { return }
        guard let host = url.host?.lowercased() else { return }

        let parts = url.pathComponents.filter { $0 != "/" }
        NSLog("[scout://] %@/%@", host, parts.joined(separator: "/"))

        switch host {
        case "hud":
            handleHUD(parts)
        case "settings":
            handleSettings(parts, controller: controller)
        default:
            NSLog("[scout://] unhandled host: %@", host)
        }
    }

    private static func handleHUD(_ parts: [String]) {
        guard let head = parts.first?.lowercased() else { return }
        let tail = Array(parts.dropFirst())

        switch head {
        case "show":
            HUDController.shared.show()
        case "hide":
            HUDController.shared.dismiss()
        case "toggle":
            HUDController.shared.toggle()
        case "tab":
            if let raw = tail.first, let view = parseView(raw) {
                HUDState.shared.select(view)
            } else {
                NSLog("[scout://] tab: unrecognized %@", tail.first ?? "(empty)")
            }
        case "size":
            if let raw = tail.first, let size = parseSize(raw) {
                HUDState.shared.setSize(size)
            } else {
                NSLog("[scout://] size: unrecognized %@", tail.first ?? "(empty)")
            }
        default:
            NSLog("[scout://] unhandled head: %@", head)
        }
    }

    private static func handleSettings(_ parts: [String], controller: OpenScoutAppController) {
        let selectedTab = parts.first.flatMap { SettingsTab(rawValue: $0.lowercased()) }
        SettingsWindowController.shared.show(controller: controller, selectedTab: selectedTab ?? .diagnostics)
    }

    private static func parseView(_ raw: String) -> HUDView? {
        switch raw.lowercased() {
        case "agents":   return .agents
        case "activity": return .activity
        case "tail":     return .tail
        case "sessions": return .sessions
        case "assistant": return .assistant
        default:         return nil
        }
    }

    private static func parseSize(_ raw: String) -> HUDSize? {
        switch raw.lowercased() {
        case "compact", "s", "small":  return .compact
        case "medium",  "m":            return .medium
        case "large",   "l":            return .large
        default:                        return nil
        }
    }
}
