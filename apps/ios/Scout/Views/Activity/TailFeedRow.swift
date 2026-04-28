// TailFeedRow — unified row model for the three-source firehose merge.
//
//   • activity — broker control events (existing mobile/activity polling)
//   • tail     — machine-wide harness transcript events (Lane A subscription)
//   • turn     — projected Scout in-app conversation events
//
// All three carry a millisecond timestamp; the view sorts by ts descending.
// See docs/tail-firehose.md.

import Foundation

enum TailFeedRow: Identifiable, Sendable {
    case activity(ActivityItem)
    case tail(TailEvent)
    case turn(TurnProjection)

    var id: String {
        switch self {
        case .activity(let item): "act:\(item.id)"
        case .tail(let event): "tail:\(event.id)"
        case .turn(let proj): "turn:\(proj.id)"
        }
    }

    var tsMs: Int {
        switch self {
        case .activity(let item): item.tsMs
        case .tail(let event): event.ts
        case .turn(let proj): proj.tsMs
        }
    }

    /// Engine identifier for the tag column ("claude", "codex", "scout").
    /// nil hides the column for that row.
    var engine: String? {
        switch self {
        case .activity: "scout"
        case .tail(let event): event.source
        case .turn: "scout"
        }
    }

    /// Attribution category — drives the leading dot color.
    var attribution: TailEvent.Harness {
        switch self {
        case .activity: .scoutManaged
        case .tail(let event): event.harness
        case .turn: .scoutManaged
        }
    }

    /// True if the row is a transient status that shouldn't appear in the feed.
    var isNoise: Bool {
        switch self {
        case .activity(let item): item.isNoise
        case .tail: false
        case .turn: false
        }
    }
}

/// Lightweight projection of a Scout in-app turn event for the firehose row.
/// Built from `ScoutEvent.turnStart` / `.turnEnd` arriving via
/// `ConnectionManager.subscribeToEvents()`.
struct TurnProjection: Identifiable, Sendable {
    enum Phase: Sendable {
        case start
        case end
    }

    let id: String
    let turnId: String
    let sessionId: String
    let tsMs: Int
    let phase: Phase
    let isUserTurn: Bool
    let snippet: String
}
