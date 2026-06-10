import Foundation

@MainActor
public enum ScoutHUDRouter {
    public static let commandNotificationName = Notification.Name("com.openscout.hud.command")

    public static func handle(url: URL) -> Bool {
        guard url.scheme?.lowercased() == "scout",
              url.host?.lowercased() == "hud" else {
            return false
        }

        let parts = url.pathComponents.filter { $0 != "/" }
        guard let head = parts.first?.lowercased() else { return false }
        let value = parts.dropFirst().first
        return handle(command: head, value: value)
    }

    public static func handle(command: String, value: String? = nil) -> Bool {
        switch command.lowercased() {
        case "show":
            HUDController.shared.show()
            return true
        case "hide":
            HUDController.shared.dismiss()
            return true
        case "toggle":
            HUDController.shared.toggle()
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
              url.host?.lowercased() == "hud" else {
            return nil
        }

        let parts = url.pathComponents.filter { $0 != "/" }
        guard let command = parts.first?.lowercased() else { return nil }
        return distributedUserInfo(command: command, value: parts.dropFirst().first)
    }

    private static func parseView(_ raw: String) -> HUDView? {
        switch raw.lowercased() {
        case "agents": return .agents
        case "activity": return .activity
        case "tail": return .tail
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
}
