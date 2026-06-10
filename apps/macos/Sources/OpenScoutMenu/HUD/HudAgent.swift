import Foundation
import ScoutAppCore

typealias HudAgent = ScoutAgent
typealias HudAgentState = ScoutAgentState

struct HudActivityItem: Identifiable, Sendable, Decodable {
    let id: String
    let kind: String
    let ts: TimeInterval
    let actorName: String?
    let title: String?
    let summary: String?
    let conversationId: String?
    let workspaceRoot: String?
    let agentId: String?
    let agentName: String?
    let flightId: String?
    let invocationId: String?
    let sessionId: String?
    let messageId: String?
    let recordId: String?

    var displayName: String {
        agentName ?? actorName ?? "broker"
    }

    var relativeTimestamp: String {
        HudAgent.formatAgo(sinceMs: ts)
    }
}
