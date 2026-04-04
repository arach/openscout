import Foundation

public struct ScoutWorkflowRun: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public var workflowID: String
    public var workflowName: String
    public var draftID: UUID
    public var title: String
    public var targetAgentIDs: [String]
    public var packet: String
    public var steps: [ScoutWorkflowRunStep]
    public var state: ScoutWorkflowRunState
    public var createdAt: Date

    public init(
        id: UUID = UUID(),
        workflowID: String,
        workflowName: String,
        draftID: UUID,
        title: String,
        targetAgentIDs: [String],
        packet: String,
        steps: [ScoutWorkflowRunStep],
        state: ScoutWorkflowRunState = .generated,
        createdAt: Date = .now
    ) {
        self.id = id
        self.workflowID = workflowID
        self.workflowName = workflowName
        self.draftID = draftID
        self.title = title
        self.targetAgentIDs = targetAgentIDs
        self.packet = packet
        self.steps = steps
        self.state = state
        self.createdAt = createdAt
    }
}
