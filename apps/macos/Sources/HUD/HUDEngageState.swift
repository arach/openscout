import Foundation
import SwiftUI

// Native port of design/studio/components/hud/useHudEngage.ts.
//
// Two-layer selection for progressive disclosure:
//
//   · cursoredId — keyboard cursor position (j/k moves this). Visual is
//                  subtle: a hairline lime edge bar, no background shift.
//                  Reads as "you're looking at this," not "you've opened
//                  this." Mouse hover does NOT move the cursor.
//   · engagedId  — committed engagement (tap, or Enter on cursored).
//                  Visual is loud: row background lifts, inline detail
//                  expands, lime bar gets thicker. Reads as "you've
//                  committed to this row."
//
// One row can be cursored, another engaged; the cursor floats freely
// during j/k navigation while the engaged row's detail stays open.
//
// Each tab instantiates its own @StateObject so state resets on tab
// teardown.

@MainActor
final class HUDEngageState: ObservableObject {
    @Published private(set) var cursoredId: String?
    @Published private(set) var engagedId: String?

    init(initial: String? = nil) {
        self.cursoredId = initial
        self.engagedId = initial
    }

    // MARK: - Cursor (j/k)

    /// Move the cursor to `id` (or clear it with nil).
    func cursor(_ id: String?) {
        cursoredId = id
    }

    func isCursored(_ id: String) -> Bool {
        cursoredId == id
    }

    // MARK: - Engagement (Enter / tap)

    /// Toggle engagement on `id`. If already engaged, drop it. If
    /// another row is engaged, swap. Same idiom as the old `toggle`.
    func toggle(_ id: String) {
        engagedId = engagedId == id ? nil : id
        cursoredId = id
    }

    /// Direct setter — used when the engaged row should always reflect
    /// the cursor (large-tier side pane).
    func select(_ id: String?) {
        engagedId = id
        cursoredId = id
    }

    /// Collapse engagement without touching the cursor. Used by the
    /// Esc cascade so the operator's cursor position doesn't reset
    /// just because they undid an expansion.
    func unengage() {
        engagedId = nil
    }

    func clear() {
        engagedId = nil
        cursoredId = nil
    }

    func isEngaged(_ id: String) -> Bool {
        engagedId == id
    }

    // MARK: - Back-compat shim
    // Older callers asked "isSelected" when they meant "isEngaged".
    // Keep the shim so we can migrate views incrementally.
    func isSelected(_ id: String) -> Bool {
        engagedId == id
    }

    var selectedId: String? { engagedId }
}
