import Foundation

public struct ScoutWorkflowRunStep: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var title: String
    public var output: String

    public init(
        id: String,
        title: String,
        output: String
    ) {
        self.id = id
        self.title = title
        self.output = output
    }
}
