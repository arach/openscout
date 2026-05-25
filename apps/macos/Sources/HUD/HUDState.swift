import Foundation
import SwiftUI

// HUD view selection + per-session state.
// One source of truth for which view the HUD is showing.

enum HUDView: Int, CaseIterable, Identifiable, Sendable {
    case fleet    = 1
    case tail     = 2
    case sessions = 3

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .fleet:    return "FLEET"
        case .tail:     return "TAIL"
        case .sessions: return "SESSIONS"
        }
    }

    var keyLabel: String {
        String(rawValue)
    }
}

@MainActor
final class HUDState: ObservableObject {
    @Published var view: HUDView = .fleet

    static let shared = HUDState()

    private init() {}

    func select(_ view: HUDView) {
        guard self.view != view else { return }
        self.view = view
    }

    func select(viewIndex raw: Int) {
        if let v = HUDView(rawValue: raw) { select(v) }
    }
}
