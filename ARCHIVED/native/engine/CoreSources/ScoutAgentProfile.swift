import Foundation

public struct ScoutAgentProfile: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var role: String
    public var summary: String
    public var systemImage: String

    public init(
        id: String,
        name: String,
        role: String,
        summary: String,
        systemImage: String
    ) {
        self.id = id
        self.name = name
        self.role = role
        self.summary = summary
        self.systemImage = systemImage
    }
}
