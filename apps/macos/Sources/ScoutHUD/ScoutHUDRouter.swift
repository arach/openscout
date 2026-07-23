import Foundation
import ScoutAppCore

@MainActor
public enum ScoutHUDRouter {
    public static let commandNotificationName = Notification.Name("app.openscout.scout.hud")

    public static var shouldDeferTaskCapture: Bool {
        HUDRunnerState.shared.isSubmitting
    }

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
            prepareHUDTail(size: value.flatMap(parseSize))
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
        case "compose", "input", "command-box", "commandbox", "capture", "quick-capture", "task", "new-task":
            prepareCommandBox(value: value)
            let runner = HUDRunnerState.shared
            let opensFreshDraft = !runner.isPresented
            runner.open(
                closesHUDOnDismiss: true,
                freshDraft: opensFreshDraft,
                requiresProjectSelection: true
            )
            if opensFreshDraft {
                runner.toggleProjectChoices()
            }
            HUDController.shared.show(captureAnchor: HUDCaptureAnchor(argument: value))
            return true
        case "task-capture":
            prepareCommandBox(value: nil)
            guard let value else { return false }
            do {
                let payload = try ScoutCapturePayloadStore.read(token: value)
                HUDRunnerState.shared.open(
                    closesHUDOnDismiss: true,
                    freshDraft: !HUDRunnerState.shared.isPresented
                )
                HUDRunnerState.shared.stageCapture(payload)
                let anchor = HUDCaptureCorner(argument: payload.corner).map {
                    HUDCaptureAnchor(corner: $0, displayID: payload.displayID)
                }
                HUDController.shared.show(captureAnchor: anchor)
            } catch {
                HUDRunnerState.shared.open(
                    closesHUDOnDismiss: true,
                    freshDraft: !HUDRunnerState.shared.isPresented
                )
                HUDRunnerState.shared.lastError = error.localizedDescription
                HUDController.shared.show()
            }
            return true
        case "task-error":
            prepareCommandBox(value: nil)
            HUDRunnerState.shared.open(
                closesHUDOnDismiss: true,
                freshDraft: !HUDRunnerState.shared.isPresented
            )
            HUDRunnerState.shared.lastError = value ?? "The capture could not be staged."
            HUDController.shared.show()
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
            HUDState.shared.select(.focus)
        }
        HUDState.shared.setTailCollapsed(false)
    }

    private static func prepareCommandBox(value: String?) {
        HUDState.shared.select(.focus)
        if let value, let size = parseSize(value) {
            HUDState.shared.setSize(size)
        } else {
            HUDState.shared.setSize(.compact)
        }
        HUDState.shared.setTailCollapsed(false)
    }

    private static func prepareHUDTail(size: HUDSize?) {
        prepareGenericHUD()
        HUDState.shared.select(.tail)
        if let size {
            HUDState.shared.setSize(size)
        }
        HUDState.shared.setTailCollapsed(false)
        HUDController.shared.show()
    }

    private static func parseView(_ raw: String) -> HUDView? {
        // Canonical names + backward-compat aliases for scout://hud/tab/…
        switch raw.lowercased() {
        case "focus", "agents", "activity": return .focus
        case "threads", "sessions": return .threads
        case "tail": return .tail
        case "scout", "assistant": return .scout
        case "scoutbot": return .scoutbot
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
