// TailCapability (SCO-061 Phase 3, seeded early for the ScoutNext demo).
//
// Shared activity-firehose model + a streaming contract. Mirrors the wire shape
// in packages/web/server/core/tail/types.ts and unifies the iOS `TailEvent` /
// macOS `ScoutTailStore` shapes.

import Foundation

public struct TailEvent: Codable, Sendable, Identifiable, Equatable {
    /// Which runner produced the event (e.g. "claude", "codex").
    public typealias Source = String

    /// Who manages the harness the event came from.
    public enum Harness: String, Codable, Sendable {
        case scoutManaged
        case hudsonManaged
        case unattributed
    }

    public enum Kind: String, Codable, Sendable {
        case user, assistant, tool, toolResult, system, other
    }

    public var id: String
    public var tsMs: Int64
    public var source: Source
    public var harness: Harness
    public var kind: Kind
    public var summary: String
    /// The conversation/session this event belongs to, when known — lets a row
    /// tap through to where it happened. nil for events with no thread linkage.
    public var conversationId: String?

    public init(
        id: String,
        tsMs: Int64,
        source: Source,
        harness: Harness = .unattributed,
        kind: Kind = .other,
        summary: String,
        conversationId: String? = nil
    ) {
        self.id = id
        self.tsMs = tsMs
        self.source = source
        self.harness = harness
        self.kind = kind
        self.summary = summary
        self.conversationId = conversationId
    }
}

/// Capability: subscribe to the activity firehose. `since` is an optional
/// cursor (ms epoch); the transport delivers events as they arrive.
public protocol TailCapability: Sendable {
    func tailEvents(since: Int64?) -> AsyncStream<TailEvent>

    /// Recent activity history (newest-first), for *seeding* a view before the
    /// live `tailEvents` stream takes over. `tailEvents` only delivers events
    /// that arrive after subscription, so a freshly-opened surface shows nothing
    /// without this backfill. Conformers without a history source get the
    /// default empty list.
    func recentActivity(limit: Int) async throws -> [TailEvent]
}

public extension TailCapability {
    func recentActivity(limit: Int) async throws -> [TailEvent] { [] }
}
