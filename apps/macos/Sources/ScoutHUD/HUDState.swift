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

    public static var allCases: [HUDView] {
        [.agents, .activity, .sessions, .assistant]
    }

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
        switch self {
        case .agents: return "1"
        case .activity: return "2"
        case .sessions: return "3"
        case .assistant: return "4"
        case .tail: return "T"
        }
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

    // Resolved content size for `screen`. The normal HUD keeps the existing
    // compact/workbench/top-dock tiers. Tail gets a portrait overlay geometry:
    // narrow enough to live beside real work, tall enough to read as a stream.
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

    public func contentSize(for view: HUDView, on screen: NSScreen? = NSScreen.main) -> NSSize {
        contentSize(for: view, collapsed: false, on: screen)
    }

    public func contentSize(for view: HUDView, collapsed: Bool, on screen: NSScreen? = NSScreen.main) -> NSSize {
        guard view == .tail else { return contentSize(on: screen) }
        let frame = screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        if collapsed {
            return HUDTailCollapsedGeometry.verticalSize(in: frame)
        }
        switch self {
        case .compact:
            return NSSize(width: 460, height: floor(frame.height * tailEdgeCoverage))
        case .medium:
            return NSSize(width: 540, height: floor(frame.height * tailEdgeCoverage))
        case .large:
            // Wide "deck": the firehose keeps the main column and the native
            // active-agents rail rides the right edge, so the panel claims
            // roughly half the screen. Never below 860 so the split still fits
            // on smaller displays.
            let width = min(frame.width, max(860, floor(frame.width * 0.5)))
            return NSSize(width: width, height: frame.height)
        }
    }

    var tailEdgeCoverage: CGFloat {
        switch self {
        case .compact: return 0.30
        case .medium: return 0.60
        case .large: return 1.0
        }
    }

    /// Whether this size requires explicit screen-relative positioning by
    /// the caller (vs. the default center-anchored resize). Today only the
    /// new .large tier does — it docks to the top half of the active screen.
    public var isScreenAnchored: Bool {
        self == .large
    }

    public func isScreenAnchored(for view: HUDView) -> Bool {
        view == .tail || isScreenAnchored
    }
}

enum HUDTailCollapsedGeometry {
    static let verticalThickness: CGFloat = 42
    static let horizontalThickness: CGFloat = 26

    private static let minimumLength: CGFloat = 156
    private static let maximumLength: CGFloat = 220

    static func size(isHorizontal: Bool, in visible: NSRect) -> NSSize {
        if isHorizontal {
            return NSSize(width: horizontalLength(in: visible), height: horizontalThickness)
        }
        return verticalSize(in: visible)
    }

    static func verticalSize(in visible: NSRect) -> NSSize {
        NSSize(width: verticalThickness, height: verticalLength(in: visible))
    }

    private static func horizontalLength(in visible: NSRect) -> CGFloat {
        min(maximumLength, max(minimumLength, floor(visible.width * 0.055)))
    }

    private static func verticalLength(in visible: NSRect) -> CGFloat {
        min(maximumLength, max(minimumLength, floor(visible.height * 0.14)))
    }
}

public enum HUDMotionPhase: Equatable, Sendable {
    case idle
    case warming
    case collapsing
    case moving
}

@MainActor
public final class HUDMotionState: ObservableObject {
    public static let shared = HUDMotionState()

    @Published public private(set) var phase: HUDMotionPhase = .idle
    @Published public private(set) var modifierLift = false

    private var generation = 0

    public var isActive: Bool {
        phase != .idle
    }

    private init() {}

    @discardableResult
    public func begin(_ phase: HUDMotionPhase, fallbackSettleAfter delay: TimeInterval = 0.8) -> Int {
        generation += 1
        self.phase = phase
        let token = generation
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard token == generation else { return }
            self.phase = .idle
        }
        return token
    }

    public func settle(after delay: TimeInterval = 0) {
        let token = generation
        Task { @MainActor in
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            guard token == generation else { return }
            phase = .idle
        }
    }

    public func finish(token: Int? = nil) {
        if let token, token != generation { return }
        generation += 1
        phase = .idle
    }

    public func setModifierLift(_ lifted: Bool) {
        guard modifierLift != lifted else { return }
        modifierLift = lifted
    }
}

@MainActor
public final class HUDState: ObservableObject {
    @Published public var view: HUDView = .agents
    @Published public var size: HUDSize = .compact
    @Published public var tailCollapsed = false

    public static let shared = HUDState()

    private init() {}

    public func select(_ view: HUDView) {
        guard self.view != view else {
            HUDStateFile.shared.touch()
            return
        }
        self.view = view
        HUDStateFile.shared.touch()
    }

    public func select(viewIndex raw: Int) {
        switch raw {
        case 1: select(.agents)
        case 2: select(.activity)
        case 3: select(.sessions)
        case 4: select(.assistant)
        default: break
        }
    }

    public func setSize(_ size: HUDSize) {
        guard self.size != size else {
            HUDStateFile.shared.touch()
            return
        }
        HUDMotionState.shared.begin(.moving)
        self.size = size
        HUDStateFile.shared.touch()
    }

    public func setTailCollapsed(_ collapsed: Bool) {
        guard tailCollapsed != collapsed else {
            HUDStateFile.shared.touch()
            return
        }
        HUDMotionState.shared.begin(collapsed ? .collapsing : .moving)
        tailCollapsed = collapsed
        HUDStateFile.shared.touch()
    }

    public func toggleTailCollapsed() {
        setTailCollapsed(!tailCollapsed)
    }

    // Step the size in `direction` (-1 = down, +1 = up). Clamps at ends —
    // hotkey can hold and won't wrap; the user always knows what's at
    // the edges. Wrapping reads as "lost the toggle."
    public func stepSize(_ direction: Int) {
        let next = size.rawValue + direction
        if let v = HUDSize(rawValue: next) { setSize(v) }
    }
}
