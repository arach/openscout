import Foundation

public struct ScoutSupportPaths: Sendable {
    public let applicationSupportDirectory: URL
    public let agentStatusFileURL: URL

    public init(
        applicationSupportDirectory: URL,
        agentStatusFileURL: URL
    ) {
        self.applicationSupportDirectory = applicationSupportDirectory
        self.agentStatusFileURL = agentStatusFileURL
    }

    public static func `default`() -> ScoutSupportPaths {
        let supportDirectory = URL.applicationSupportDirectory
            .appending(path: "OpenScout", directoryHint: .isDirectory)

        return ScoutSupportPaths(
            applicationSupportDirectory: supportDirectory,
            agentStatusFileURL: supportDirectory.appending(path: "agent-status.json")
        )
    }
}
