import Foundation

public struct ScoutModule: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let summary: String
    public let integrationMode: ScoutIntegrationMode
    public let capabilities: [String]

    public init(
        id: String,
        name: String,
        summary: String,
        integrationMode: ScoutIntegrationMode,
        capabilities: [String]
    ) {
        self.id = id
        self.name = name
        self.summary = summary
        self.integrationMode = integrationMode
        self.capabilities = capabilities
    }
}
