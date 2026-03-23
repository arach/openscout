import Foundation

public struct ScoutWorkflowTemplate: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var summary: String
    public var systemImage: String
    public var category: String
    public var defaultTargetAgentIDs: [String]
    public var sections: [ScoutWorkflowTemplateSection]
    public var outputGuidance: [String]

    public init(
        id: String,
        name: String,
        summary: String,
        systemImage: String,
        category: String,
        defaultTargetAgentIDs: [String],
        sections: [ScoutWorkflowTemplateSection],
        outputGuidance: [String]
    ) {
        self.id = id
        self.name = name
        self.summary = summary
        self.systemImage = systemImage
        self.category = category
        self.defaultTargetAgentIDs = defaultTargetAgentIDs
        self.sections = sections
        self.outputGuidance = outputGuidance
    }
}
