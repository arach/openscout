import Foundation

public struct ScoutNote: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public var title: String
    public var body: String
    public var tags: [String]
    public var linkedAgentIDs: [String]
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        title: String,
        body: String = "",
        tags: [String] = [],
        linkedAgentIDs: [String] = [],
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.body = body
        self.tags = tags
        self.linkedAgentIDs = linkedAgentIDs
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
