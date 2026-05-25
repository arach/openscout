import Foundation
import SwiftUI

// Native port of design/studio/components/hud/useHudEngage.ts.
//
// Standardizes the tap/engage pattern across all four HUD tabs:
//   · toggle(id) — click a row. If it's already engaged, close. If
//                  another row is engaged, swap to this one. Else open.
//   · select(id) — direct setter (used at large where the side pane
//                  always shows something).
//   · clear()    — drop the engaged row (Esc, tab switch).
//
// Each tab instantiates its own @StateObject HUDEngageState so the
// engage scope is per-tab; switching tabs resets to closed because the
// owning view is torn down.

@MainActor
final class HUDEngageState: ObservableObject {
    @Published private(set) var selectedId: String?

    init(initial: String? = nil) {
        self.selectedId = initial
    }

    func toggle(_ id: String) {
        selectedId = selectedId == id ? nil : id
    }

    func select(_ id: String?) {
        selectedId = id
    }

    func clear() {
        selectedId = nil
    }

    func isSelected(_ id: String) -> Bool {
        selectedId == id
    }
}
