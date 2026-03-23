import Foundation

public struct ScoutWorkspaceSnapshot: Codable, Sendable {
    public var notes: [ScoutNote]
    public var drafts: [ScoutComposeDraft]
    public var agents: [ScoutAgentProfile]
    public var workflowRuns: [ScoutWorkflowRun]
    public var lastUpdatedAt: Date

    public init(
        notes: [ScoutNote] = [],
        drafts: [ScoutComposeDraft] = [],
        agents: [ScoutAgentProfile] = [],
        workflowRuns: [ScoutWorkflowRun] = [],
        lastUpdatedAt: Date = .now
    ) {
        self.notes = notes
        self.drafts = drafts
        self.agents = agents
        self.workflowRuns = workflowRuns
        self.lastUpdatedAt = lastUpdatedAt
    }
}
