import AppKit
import Foundation

/// Routes `scout://` URLs to HUD actions. Wired from AppDelegate's
/// NSAppleEventManager kAEGetURL handler.
///
/// Supported paths (host = `hud`):
///   scout://hud/show          — present the panel
///   scout://hud/hide          — dismiss
///   scout://hud/toggle        — flip current state
///   scout://hud/tab/<name>    — agents | activity | tail | sessions
///   scout://hud/size/<name>   — compact | medium | large  (also accepts s | m | l)
///
/// All actions are fire-and-forget; current state is mirrored to
/// `/tmp/openscout-hud-state.json` by HUDStateFile so callers can read
/// it without a round trip.
@MainActor
enum HUDURLRouter {
    static func handle(url: URL) {
        guard url.scheme?.lowercased() == "scout" else { return }
        guard url.host?.lowercased() == "hud" else { return }

        let parts = url.pathComponents.filter { $0 != "/" }
        guard let head = parts.first?.lowercased() else { return }
        let tail = Array(parts.dropFirst())
        NSLog("[scout://] %@/%@", head, tail.joined(separator: "/"))

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

    private static func parseView(_ raw: String) -> HUDView? {
        switch raw.lowercased() {
        case "agents":   return .agents
        case "activity": return .activity
        case "tail":     return .tail
        case "sessions": return .sessions
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
