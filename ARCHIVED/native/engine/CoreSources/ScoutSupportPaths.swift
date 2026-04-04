import Foundation

public struct ScoutSupportPaths: Sendable {
    public let applicationSupportDirectory: URL
    public let diagnosticsLogURL: URL
    public let agentStatusFileURL: URL
    public let workspaceStateFileURL: URL
    public let controlPlaneDirectory: URL
    public let controlPlaneDatabaseURL: URL

    public init(
        applicationSupportDirectory: URL,
        diagnosticsLogURL: URL,
        agentStatusFileURL: URL,
        workspaceStateFileURL: URL,
        controlPlaneDirectory: URL,
        controlPlaneDatabaseURL: URL
    ) {
        self.applicationSupportDirectory = applicationSupportDirectory
        self.diagnosticsLogURL = diagnosticsLogURL
        self.agentStatusFileURL = agentStatusFileURL
        self.workspaceStateFileURL = workspaceStateFileURL
        self.controlPlaneDirectory = controlPlaneDirectory
        self.controlPlaneDatabaseURL = controlPlaneDatabaseURL
    }

    public static func `default`() -> ScoutSupportPaths {
        let homeDirectory = URL.homeDirectory
        let supportDirectory = URL.applicationSupportDirectory
            .appending(path: "OpenScout", directoryHint: .isDirectory)
        let controlPlaneDirectory = homeDirectory
            .appending(path: ".openscout", directoryHint: .isDirectory)
            .appending(path: "control-plane", directoryHint: .isDirectory)

        return ScoutSupportPaths(
            applicationSupportDirectory: supportDirectory,
            diagnosticsLogURL: supportDirectory.appending(path: "diagnostics.log"),
            agentStatusFileURL: supportDirectory.appending(path: "agent-status.json"),
            workspaceStateFileURL: supportDirectory.appending(path: "workspace-state.json"),
            controlPlaneDirectory: controlPlaneDirectory,
            controlPlaneDatabaseURL: controlPlaneDirectory.appending(path: "control-plane.sqlite")
        )
    }
}
