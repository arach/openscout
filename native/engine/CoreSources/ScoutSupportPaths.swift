import Foundation

public struct ScoutSupportPaths: Sendable {
    public let applicationSupportDirectory: URL
    public let agentStatusFileURL: URL
    public let workspaceStateFileURL: URL
    public let relayHubDirectory: URL
    public let relayEventStreamURL: URL
    public let relayChannelLogURL: URL
    public let relayConfigFileURL: URL
    public let relayStateFileURL: URL
    public let relayInboxDirectory: URL

    public init(
        applicationSupportDirectory: URL,
        agentStatusFileURL: URL,
        workspaceStateFileURL: URL,
        relayHubDirectory: URL,
        relayEventStreamURL: URL,
        relayChannelLogURL: URL,
        relayConfigFileURL: URL,
        relayStateFileURL: URL,
        relayInboxDirectory: URL
    ) {
        self.applicationSupportDirectory = applicationSupportDirectory
        self.agentStatusFileURL = agentStatusFileURL
        self.workspaceStateFileURL = workspaceStateFileURL
        self.relayHubDirectory = relayHubDirectory
        self.relayEventStreamURL = relayEventStreamURL
        self.relayChannelLogURL = relayChannelLogURL
        self.relayConfigFileURL = relayConfigFileURL
        self.relayStateFileURL = relayStateFileURL
        self.relayInboxDirectory = relayInboxDirectory
    }

    public static func `default`() -> ScoutSupportPaths {
        let homeDirectory = URL.homeDirectory
        let supportDirectory = URL.applicationSupportDirectory
            .appending(path: "OpenScout", directoryHint: .isDirectory)
        let relayHubDirectory = homeDirectory
            .appending(path: ".openscout", directoryHint: .isDirectory)
            .appending(path: "relay", directoryHint: .isDirectory)

        return ScoutSupportPaths(
            applicationSupportDirectory: supportDirectory,
            agentStatusFileURL: supportDirectory.appending(path: "agent-status.json"),
            workspaceStateFileURL: supportDirectory.appending(path: "workspace-state.json"),
            relayHubDirectory: relayHubDirectory,
            relayEventStreamURL: relayHubDirectory.appending(path: "channel.jsonl"),
            relayChannelLogURL: relayHubDirectory.appending(path: "channel.log"),
            relayConfigFileURL: relayHubDirectory.appending(path: "config.json"),
            relayStateFileURL: relayHubDirectory.appending(path: "state.json"),
            relayInboxDirectory: relayHubDirectory.appending(path: "inbox", directoryHint: .isDirectory)
        )
    }
}
