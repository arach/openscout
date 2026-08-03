import Foundation

/// The `g`-prefix chord state machine.
///
/// One key arms it; the next key resolves it. Kept here — pure, generic over
/// its destination type, free of AppKit — because the interesting failure is
/// a state bug, not a rendering one, and this is the layer that can be tested.
///
/// The failure it is built around: an armed-then-unknown key must clear the
/// arm and **stop**. If the unknown branch falls through into the arming
/// branch, pressing the prefix twice re-arms instead of resolving, and the
/// chord silently eats the keystroke after it. The web client logged that exact
/// defect against its own go-prefix; `handle(key:resolve:)` returns from inside
/// the armed branch so the fall-through cannot exist.
public struct ScoutChordMachine<Destination: Equatable>: Equatable {
    public enum Outcome: Equatable {
        /// Not a chord key at all — the caller keeps handling the event.
        case ignored
        /// The prefix was consumed; the next key resolves.
        case armed
        /// Armed, and the second key named a destination.
        case resolved(Destination)
        /// Armed, and the second key named nothing. The arm is spent either way.
        case cancelled
    }

    public let prefix: String
    public private(set) var isArmed: Bool

    public init(prefix: String = "g", isArmed: Bool = false) {
        self.prefix = prefix
        self.isArmed = isArmed
    }

    /// Feeds one key at the machine.
    ///
    /// `resolve` maps a second key to a destination and is only consulted while
    /// armed, so a surface can vary its chord table without the machine
    /// knowing anything about sections.
    public mutating func handle(
        key: String,
        resolve: (String) -> Destination?
    ) -> Outcome {
        let key = key.lowercased()

        if isArmed {
            // Spend the arm first, unconditionally. Every path below returns.
            isArmed = false
            guard let destination = resolve(key) else { return .cancelled }
            return .resolved(destination)
        }

        guard key == prefix else { return .ignored }
        isArmed = true
        return .armed
    }

    /// Drops a pending arm — Escape, a click, losing key-window status. Safe to
    /// call when idle.
    public mutating func disarm() {
        isArmed = false
    }
}
