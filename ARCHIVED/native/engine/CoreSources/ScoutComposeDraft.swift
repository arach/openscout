import Foundation

public struct ScoutComposeDraft: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public var title: String
    public var request: String
    public var context: String
    public var deliverable: String
    public var selectedWorkflowID: String
    public var targetAgentIDs: [String]
    public var linkedNoteIDs: [UUID]
    public var state: ScoutComposeDraftState
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        title: String,
        request: String,
        context: String = "",
        deliverable: String = "",
        selectedWorkflowID: String,
        targetAgentIDs: [String],
        linkedNoteIDs: [UUID] = [],
        state: ScoutComposeDraftState = .draft,
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.request = request
        self.context = context
        self.deliverable = deliverable
        self.selectedWorkflowID = selectedWorkflowID
        self.targetAgentIDs = targetAgentIDs
        self.linkedNoteIDs = linkedNoteIDs
        self.state = state
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
