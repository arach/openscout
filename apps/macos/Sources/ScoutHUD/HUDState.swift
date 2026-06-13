import AppKit
import Foundation
import SwiftUI

// HUD view selection + per-session state.
// One source of truth for which view the HUD is showing and at what size.

public enum HUDView: Int, CaseIterable, Identifiable, Sendable {
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

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .agents:    return "AGENTS"
        case .activity:  return "ACTIVITY"
        case .tail:      return "TAIL"
        case .sessions:  return "SESSIONS"
        case .assistant: return "ASSISTANT"
        }
    }

    public var keyLabel: String {
        String(rawValue)
    }
}

public enum HUDSize: Int, CaseIterable, Identifiable, Sendable {
    case compact = 0
    case medium  = 1
    case large   = 2

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .compact: return "S"
        case .medium:  return "M"
        case .large:   return "L"
        }
    }

    // Resolved content size for `screen`. The .compact and .medium tiers
    // are fixed presets (panel floats and is center-anchored on resize).
    // The .large tier is screen-relative: full width × half height of the
    // visible frame, intended to dock to the top half of the active
    // display. Caller (HUDController) is responsible for positioning .large
    // at the top of the screen rather than center-anchoring.
    //
    // WHY this shape (S vs M vs L):
    //   S 560x520     compact single-column overlay — at-a-glance HUD
    //   M 1280x920    two-pane wide layout — operator workbench
    //   L screen/top  full-width half-screen dock — context room
    public func contentSize(on screen: NSScreen? = NSScreen.main) -> NSSize {
        switch self {
        case .compact:
            return NSSize(width: 560, height: 520)
        case .medium:
            return NSSize(width: 1280, height: 920)
        case .large:
            let frame = screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            return NSSize(width: frame.width, height: floor(frame.height / 2))
        }
    }

    /// Whether this size requires explicit screen-relative positioning by
    /// the caller (vs. the default center-anchored resize). Today only the
    /// new .large tier does — it docks to the top half of the active screen.
    public var isScreenAnchored: Bool {
        self == .large
    }
}

@MainActor
public final class HUDState: ObservableObject {
    @Published public var view: HUDView = .agents
    @Published public var size: HUDSize = .compact

    public static let shared = HUDState()

    private init() {}

    public func select(_ view: HUDView) {
        guard self.view != view else { return }
        self.view = view
    }

    public func select(viewIndex raw: Int) {
        if let v = HUDView(rawValue: raw) { select(v) }
    }

    public func setSize(_ size: HUDSize) {
        guard self.size != size else { return }
        self.size = size
    }

    // Step the size in `direction` (-1 = down, +1 = up). Clamps at ends —
    // hotkey can hold and won't wrap; the user always knows what's at
    // the edges. Wrapping reads as "lost the toggle."
    public func stepSize(_ direction: Int) {
        let next = size.rawValue + direction
        if let v = HUDSize(rawValue: next) { setSize(v) }
    }
}
