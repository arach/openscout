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
    /// The project (repo) the event came from, when known. nil when absent.
    public var project: String?
    /// The working directory the event came from, when known — surfaces render a
    /// compact `/project-rooted-path:session` handle from it. nil when absent.
    public var cwd: String?

    public init(
        id: String,
        tsMs: Int64,
        source: Source,
        harness: Harness = .unattributed,
        kind: Kind = .other,
        summary: String,
        conversationId: String? = nil,
        project: String? = nil,
        cwd: String? = nil
    ) {
        self.id = id
        self.tsMs = tsMs
        self.source = source
        self.harness = harness
        self.kind = kind
        self.summary = summary
        self.conversationId = conversationId
        self.project = project
        self.cwd = cwd
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

    /// Recent harness-firehose snapshot (the cross-agent Tail surface), newest
    /// arbitrary order — the caller sorts. Unlike `tailEvents`, this is a plain
    /// request/response query meant to be *polled* on a slow cadence: mobile
    /// clients don't need low-latency streaming for "a sense of what's going on",
    /// and polling keeps the firehose off the cellular link except while the Tail
    /// view is open. Conformers without a tail source get the default empty list.
    func recentTail(limit: Int) async throws -> [TailEvent]
}

public extension TailCapability {
    func recentActivity(limit: Int) async throws -> [TailEvent] { [] }
    func recentTail(limit: Int) async throws -> [TailEvent] { [] }
}
