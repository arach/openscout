import AppKit
import Foundation
import SwiftUI

// HUD view selection + per-session state.
// One source of truth for which view the HUD is showing and at what size.

public enum HUDView: Int, CaseIterable, Identifiable, Sendable {
    // Five-tab remap: focus · threads · tail · scout · scoutbot.
    // Raw values match the 1–5 hotkeys and masthead key labels.
    // `scout` stays the conversational DM; `scoutbot` is the command console.
    case focus    = 1  // attention-first work screen (was agents + activity)
    case threads  = 2  // conversations (was sessions)
    case tail     = 3
    case scout    = 4  // DM-to-Scout (was assistant)
    case scoutbot = 5  // work-first fleet command console

    public static var allCases: [HUDView] {
        [.focus, .threads, .tail, .scout, .scoutbot]
    }

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .focus:    return "FOCUS"
        case .threads:  return "THREADS"
        case .tail:     return "TAIL"
        case .scout:    return "SCOUT"
        case .scoutbot: return "SCOUTBOT"
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

    // Resolved content size for `screen`. HUD tab 3 uses these same panel
    // tiers as every other tab; TailMode owns the separate attach/free overlay
    // geometry while sharing the tail render.
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

    public func contentSize(for _: HUDView, on screen: NSScreen? = NSScreen.main) -> NSSize {
        contentSize(on: screen)
    }

    public func contentSize(for _: HUDView, collapsed _: Bool, on screen: NSScreen? = NSScreen.main) -> NSSize {
        contentSize(on: screen)
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

    public func isScreenAnchored(for _: HUDView) -> Bool {
        isScreenAnchored
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
    case expanding
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
    @Published public var view: HUDView = .focus
    @Published public var size: HUDSize = .compact
    @Published public var tailCollapsed = false
    @Published public private(set) var isVisible = false

    public static let shared = HUDState()

    private init() {}

    public func setVisible(_ visible: Bool) {
        guard isVisible != visible else { return }
        isVisible = visible
    }

    public func select(_ view: HUDView) {
        guard self.view != view else {
            HUDStateFile.shared.touch()
            return
        }
        self.view = view
        HUDStateFile.shared.touch()
    }

    public func select(viewIndex raw: Int) {
        if let view = HUDView(rawValue: raw) { select(view) }
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
