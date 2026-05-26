import Combine
import Foundation
import SwiftUI

/// Owns the universal message dock's editable state — the text buffer,
/// the routing target (an agent handle or nil = default channel), and
/// the focus signal. The dock itself binds to this; views fire actions
/// (engage SEND, row Enter, etc.) into it.
///
/// Sending happens through `HudFleetService.shared.send` which posts to
/// the broker `/api/send` endpoint. The broker parses `@-mentions` in
/// the body, so when a target is set we prepend `@<handle> ` to the
/// outgoing body and clear the chip after submit.
@MainActor
final class HUDDockState: ObservableObject {
    static let shared = HUDDockState()

    @Published var text: String = ""
    @Published var targetHandle: String? = nil   // "@hudson" (display + routing)
    @Published var targetLabel: String? = nil    // "Hudson"  (visible chip text)
    @Published var focusRequested: Int = 0       // bump → dock takes firstResponder
    @Published var lastError: String? = nil
    @Published var isSending: Bool = false

    private init() {}

    /// Bring keyboard focus to the dock's TextField. Use after engaging
    /// a row or hitting the SEND chip — the operator's next keystroke
    /// should land in the input.
    func focus() {
        focusRequested &+= 1
    }

    /// Stage a target without focusing — e.g. row hover. The chip
    /// appears in the dock to telegraph routing.
    func setTarget(handle: String?, label: String?) {
        if let handle, !handle.isEmpty {
            targetHandle = handle.hasPrefix("@") ? handle : "@" + handle
            targetLabel = label ?? handle
        } else {
            targetHandle = nil
            targetLabel = nil
        }
    }

    /// Walk back through the dock's commit stack. Returns true when
    /// Esc was absorbed here; false means there was nothing for the
    /// dock to undo and the caller should keep cascading (e.g. row
    /// unengage, HUD dismiss).
    ///
    /// Stages, in order:
    ///   1. Non-empty text → clear text (keep target chip)
    ///   2. Target chip set → clear target
    ///   3. (caller handles focus + engaged-row + dismiss)
    @discardableResult
    func escapePressed() -> Bool {
        if !text.isEmpty {
            text = ""
            return true
        }
        if targetHandle != nil {
            targetHandle = nil
            targetLabel = nil
            return true
        }
        return false
    }

    /// Drop keyboard focus from the dock. The TextField listens for a
    /// bump on this counter and lowers `@FocusState`. Used by the Esc
    /// cascade between "clear target" and "unengage row."
    @Published var blurRequested: Int = 0
    func blur() { blurRequested &+= 1 }

    /// Submit the current buffer via the broker. No-op on empty text.
    func send() async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let body: String = {
            if let handle = targetHandle, !trimmed.contains(handle) {
                return "\(handle) \(trimmed)"
            }
            return trimmed
        }()
        isSending = true
        defer { isSending = false }
        do {
            try await HudFleetService.shared.send(body: body)
            text = ""
            lastError = nil
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
