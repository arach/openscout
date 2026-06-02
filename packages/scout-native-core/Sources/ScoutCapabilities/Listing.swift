// ListingCapability (SCO-061 Phase 3, seeded early for the ScoutNext demo).
//
// Shared summary models + a transport-agnostic listing contract. Reconciles the
// iOS `MobileSessionSummary`/`MobileAgentSummary` shapes with the macOS fleet
// shapes into one set of pure models both platforms render.

import Foundation

public struct SessionSummary: Codable, Sendable, Identifiable, Equatable {
    public enum Status: String, Codable, Sendable { case active, idle, connecting, closed, unknown }

    public var id: String
    public var title: String
    public var harness: String?
    public var preview: String?
    public var agentName: String?
    public var workspaceRoot: String?
    public var messageCount: Int?
    public var status: Status
    public var lastMessageAt: Date?

    public init(
        id: String,
        title: String,
        harness: String? = nil,
        preview: String? = nil,
        agentName: String? = nil,
        workspaceRoot: String? = nil,
        messageCount: Int? = nil,
        status: Status = .unknown,
        lastMessageAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.harness = harness
        self.preview = preview
        self.agentName = agentName
        self.workspaceRoot = workspaceRoot
        self.messageCount = messageCount
        self.status = status
        self.lastMessageAt = lastMessageAt
    }

    /// Project name derived from the workspace root (last path component).
    public var projectName: String? {
        guard let workspaceRoot, !workspaceRoot.isEmpty else { return nil }
        return (workspaceRoot as NSString).lastPathComponent
    }
}

public struct AgentSummary: Codable, Sendable, Identifiable, Equatable {
    public enum State: String, Codable, Sendable { case live, idle, offline, unknown }

    public var id: String
    public var title: String
    public var harness: String?
    public var projectName: String?
    public var statusLabel: String?
    public var state: State
    public var sessionId: String?
    public var lastActiveAt: Date?

    public init(
        id: String,
        title: String,
        harness: String? = nil,
        projectName: String? = nil,
        statusLabel: String? = nil,
        state: State = .unknown,
        sessionId: String? = nil,
        lastActiveAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.harness = harness
        self.projectName = projectName
        self.statusLabel = statusLabel
        self.state = state
        self.sessionId = sessionId
        self.lastActiveAt = lastActiveAt
    }
}

/// Capability: list sessions and agents. The query/limit semantics are the
/// app's need; the transport decides how to fulfill them.
public protocol ListingCapability: Sendable {
    func listSessions(query: String?, limit: Int) async throws -> [SessionSummary]
    func listAgents(query: String?, limit: Int) async throws -> [AgentSummary]
}
