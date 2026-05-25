import Foundation
import SwiftUI

// HUD view selection + per-session state.
// One source of truth for which view the HUD is showing and at what size.

enum HUDView: Int, CaseIterable, Identifiable, Sendable {
    case agents   = 1
    case activity = 2
    case tail     = 3
    case sessions = 4

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .agents:   return "AGENTS"
        case .activity: return "ACTIVITY"
        case .tail:     return "TAIL"
        case .sessions: return "SESSIONS"
        }
    }

    var keyLabel: String {
        String(rawValue)
    }
}

enum HUDSize: Int, CaseIterable, Identifiable, Sendable {
    case compact = 0
    case medium  = 1
    case large   = 2

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .compact: return "S"
        case .medium:  return "M"
        case .large:   return "L"
        }
    }

    var contentSize: NSSize {
        switch self {
        case .compact: return NSSize(width: 420, height: 520)
        case .medium:  return NSSize(width: 680, height: 640)
        case .large:   return NSSize(width: 900, height: 720)
        }
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
