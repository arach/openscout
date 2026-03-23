import Foundation

public struct ScoutWorkflowTemplateSection: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var title: String
    public var guidance: String

    public init(
        id: String,
        title: String,
        guidance: String
    ) {
        self.id = id
        self.title = title
        self.guidance = guidance
    }
}
