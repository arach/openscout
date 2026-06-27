import Combine
import Foundation
import SwiftUI

/// Lightweight bridge between HUDController's keymonitor and whatever
/// view is currently on screen. Each tab view registers closures on
/// appear (cycle next/prev/top/bottom + engage), HUDController dispatches
/// j/k/g/G/Enter into the registered ones.
///
/// Why a bus and not a per-view monitor: the panel's onKeyDown lives
/// outside the SwiftUI view graph (it's owned by HUDController), so
/// the dispatch has to go through a singleton. The bus also serves as
/// a single place to add `f` (follow), `/` (filter), etc. later.
@MainActor
final class HUDNavBus: ObservableObject {
    static let shared = HUDNavBus()

    /// Move the active view's selection forward (j).
    var cycleNext: (() -> Void)?
    /// Move the active view's selection backward (k).
    var cyclePrev: (() -> Void)?
    /// Move to the first row (g).
    var jumpTop: (() -> Void)?
    /// Move to the last row (G).
    var jumpBottom: (() -> Void)?
    /// Commit the selection — usually means "focus dock + prefill target,"
    /// driven by Return on a row.
    var engageSelected: (() -> Void)?

    /// Reverse of engageSelected: collapse whatever row is currently
    /// engaged back to cursored-only. Driven by Esc when the dock has
    /// nothing to undo. Returns true if there was something to collapse;
    /// false means the cascade should keep walking back to dismiss.
    var unengageSelected: (() -> Bool)?

    /// Toggle live-follow mode for stream-shaped views (tail). When
    /// follow is on, new rows scroll the view to the latest; when off,
    /// the cursor anchors the visible window and rows pile up below.
    var toggleFollow: (() -> Void)?

    /// Cycle the current surface's visual treatment. Tail uses this to switch
    /// between the native firehose and the agent-latest embed without changing
    /// tabs.
    var cycleTreatment: (() -> Void)?

    /// Create a new item from the current surface. Agents uses this for
    /// Command-N to open the runner without routing that policy through
    /// HUDController.
    var createNew: (() -> Void)?

    private init() {}

    /// Drop all closures — call from a view's onDisappear so a torn-down
    /// view doesn't keep capturing the keymonitor.
    func clear() {
        cycleNext = nil
        cyclePrev = nil
        jumpTop = nil
        jumpBottom = nil
        engageSelected = nil
        unengageSelected = nil
        toggleFollow = nil
        cycleTreatment = nil
        createNew = nil
    }
}
