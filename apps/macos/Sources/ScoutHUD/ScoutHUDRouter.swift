import Foundation

@MainActor
public enum ScoutHUDRouter {
    public static let commandNotificationName = Notification.Name("app.openscout.scout.hud")

    public static func handle(url: URL) -> Bool {
        guard url.scheme?.lowercased() == "scout",
              let host = url.host?.lowercased(),
              host == "hud" || host == "tail" else {
            return false
        }

        let parts = url.pathComponents.filter { $0 != "/" }
        guard let head = parts.first?.lowercased() else { return false }
        let value = parts.dropFirst().first
        if host == "tail" {
            return handleTail(command: head, value: value)
        }
        return handle(command: head, value: value)
    }

    public static func handle(command: String, value: String? = nil) -> Bool {
        switch command.lowercased() {
        case "show":
            prepareGenericHUD()
            HUDController.shared.show()
            return true
        case "hide":
            HUDController.shared.dismiss()
            return true
        case "toggle":
            if HUDController.shared.isVisible {
                HUDController.shared.dismiss()
            } else {
                prepareGenericHUD()
                HUDController.shared.show()
            }
            return true
        case "tail":
            TailModeController.shared.show(size: value.flatMap(parseSize), expand: true)
            return true
        case "tail-show":
            TailModeController.shared.show(size: value.flatMap(parseSize), expand: true)
            return true
        case "tail-hide":
            TailModeController.shared.hide()
            return true
        case "tail-toggle":
            if let value, let size = parseSize(value) {
                TailModeState.shared.setSize(size)
            }
            TailModeController.shared.toggle()
            return true
        case "tail-size":
            guard let value, let size = parseSize(value) else { return false }
            TailModeState.shared.setSize(size)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "tail-attach", "tail-attached", "tail-edge":
            TailModeState.shared.setPlacement(.attached)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "tail-float", "tail-floating", "tail-free":
            TailModeState.shared.setPlacement(.floating)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "tail-collapse":
            TailModeState.shared.setCollapsed(true)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "tail-expand":
            TailModeState.shared.setCollapsed(false)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "tab":
            guard let value, let view = parseView(value) else { return false }
            HUDState.shared.select(view)
            return true
        case "size":
            guard let value, let size = parseSize(value) else { return false }
            HUDState.shared.setSize(size)
            return true
        default:
            return false
        }
    }

    public static func distributedUserInfo(command: String, value: String? = nil) -> [AnyHashable: Any] {
        var userInfo: [AnyHashable: Any] = ["command": command]
        if let value {
            userInfo["value"] = value
        }
        return userInfo
    }

    public static func distributedUserInfo(url: URL) -> [AnyHashable: Any]? {
        guard url.scheme?.lowercased() == "scout",
              let host = url.host?.lowercased(),
              host == "hud" || host == "tail" else {
            return nil
        }

        let parts = url.pathComponents.filter { $0 != "/" }
        guard let command = parts.first?.lowercased() else { return nil }
        if host == "tail" {
            return distributedUserInfo(command: "tail-\(command)", value: parts.dropFirst().first)
        }
        return distributedUserInfo(command: command, value: parts.dropFirst().first)
    }

    private static func prepareGenericHUD() {
        if HUDState.shared.view == .tail {
            HUDState.shared.select(.agents)
        }
        HUDState.shared.setTailCollapsed(false)
    }

    private static func parseView(_ raw: String) -> HUDView? {
        switch raw.lowercased() {
        case "agents": return .agents
        case "activity": return .activity
        case "sessions": return .sessions
        case "assistant": return .assistant
        default: return nil
        }
    }

    private static func parseSize(_ raw: String) -> HUDSize? {
        switch raw.lowercased() {
        case "compact", "s", "small": return .compact
        case "medium", "m": return .medium
        case "large", "l": return .large
        default: return nil
        }
    }

    private static func handleTail(command: String, value: String?) -> Bool {
        switch command.lowercased() {
        case "show":
            TailModeController.shared.show(size: value.flatMap(parseSize), expand: true)
            return true
        case "hide":
            TailModeController.shared.hide()
            return true
        case "toggle":
            if let value, let size = parseSize(value) {
                TailModeState.shared.setSize(size)
            }
            TailModeController.shared.toggle()
            return true
        case "attach", "attached", "edge":
            TailModeState.shared.setPlacement(.attached)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "float", "floating", "free":
            TailModeState.shared.setPlacement(.floating)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "size":
            guard let value, let size = parseSize(value) else { return false }
            TailModeState.shared.setSize(size)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "collapse":
            TailModeState.shared.setCollapsed(true)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "expand":
            TailModeState.shared.setCollapsed(false)
            if !TailModeController.shared.isVisible {
                TailModeController.shared.show(expand: false)
            }
            return true
        case "compact", "medium", "large", "s", "m", "l":
            guard let size = parseSize(command) else { return false }
            TailModeController.shared.show(size: size, expand: true)
            return true
        default:
            return false
        }
    }
}
