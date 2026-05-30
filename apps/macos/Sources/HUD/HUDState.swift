import AppKit
import Foundation
import HudsonShell
import SwiftUI

// HUD view selection + per-session state.
// One source of truth for which view the HUD is showing and at what size.

typealias HUDSize = HudOverlaySize

enum HUDView: Int, CaseIterable, Identifiable, Sendable {
    case agents    = 1
    case activity  = 2
    case tail      = 3
    case sessions  = 4
    // Slot 5 — assistant. Desktop conversation surface for the same
    // Scout that lives on iOS (project-hud-slot5-scout-surface). UI
    // label stays neutral per feedback_meta_agent_naming_neutral; the
    // brand identity is carried by the robot-head glyph beside the
    // tab and on every Scout message.
    case assistant = 5

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .agents:    return "AGENTS"
        case .activity:  return "ACTIVITY"
        case .tail:      return "TAIL"
        case .sessions:  return "SESSIONS"
        case .assistant: return "ASSISTANT"
        }
    }

    var keyLabel: String {
        String(rawValue)
    }
}

@MainActor
final class HUDState: ObservableObject {
    @Published var view: HUDView = .agents
    @Published var size: HUDSize = .compact

    static let shared = HUDState()

    private init() {}

    func select(_ view: HUDView) {
        guard self.view != view else { return }
        self.view = view
    }

    func select(viewIndex raw: Int) {
        if let v = HUDView(rawValue: raw) { select(v) }
    }

    func setSize(_ size: HUDSize) {
        guard self.size != size else { return }
        self.size = size
    }

    // Step the size in `direction` (-1 = down, +1 = up). Clamps at ends —
    // hotkey can hold and won't wrap; the user always knows what's at
    // the edges. Wrapping reads as "lost the toggle."
    func stepSize(_ direction: Int) {
        let next = size.rawValue + direction
        if let v = HUDSize(rawValue: next) { setSize(v) }
    }
}
