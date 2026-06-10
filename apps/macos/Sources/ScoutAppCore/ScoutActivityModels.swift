import Foundation

public struct ScoutActivityItem: Identifiable, Sendable, Decodable, Equatable {
    public let id: String
    public let kind: String
    public let ts: TimeInterval
    public let actorName: String?
    public let title: String?
    public let summary: String?
    public let conversationId: String?
    public let workspaceRoot: String?
    public let agentId: String?
    public let agentName: String?
    public let flightId: String?
    public let invocationId: String?
    public let sessionId: String?
    public let messageId: String?
    public let recordId: String?

    public var displayName: String {
        agentName ?? actorName ?? "broker"
    }

    public var relativeTimestamp: String {
        ScoutRelativeTime.format(ts)
    }
}
