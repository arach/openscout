import Foundation
import Observation
import ScoutCore

@MainActor
@Observable
final class ScoutShellViewModel {
    var selectedRoute: ScoutRoute = .home
    var sidebarExpanded = false
    var sidebarWidth: CGFloat = 52

    let modules: [ScoutModule]
    let supportPaths: ScoutSupportPaths
    let supervisor: ScoutAgentSupervisor
    let consoleURL: URL

    private var hasStarted = false

    init(
        supportPaths: ScoutSupportPaths = .default(),
        supervisor: ScoutAgentSupervisor? = nil
    ) {
        self.supportPaths = supportPaths
        self.supervisor = supervisor ?? ScoutAgentSupervisor(supportPaths: supportPaths)
        self.consoleURL = Self.resolvedConsoleURL()
        self.modules = [
            ScoutModule(
                id: "talkie",
                name: "Talkie",
                summary: "Voice capture, transcription, and spoken interaction.",
                integrationMode: .link,
                capabilities: ["Voice", "Transcription", "Conversation"]
            ),
            ScoutModule(
                id: "lattices",
                name: "Lattices",
                summary: "Workspace and session context across local computer activity.",
                integrationMode: .link,
                capabilities: ["Workspace state", "Session context", "Desktop awareness"]
            ),
            ScoutModule(
                id: "action",
                name: "Action",
                summary: "Native capture and local automation runtime.",
                integrationMode: .link,
                capabilities: ["Screen capture", "Recording", "Automation"]
            ),
            ScoutModule(
                id: "operate",
                name: "Operate",
                summary: "Workflow execution and delegated agent tasks.",
                integrationMode: .link,
                capabilities: ["Delegation", "Workflows", "Execution"]
            ),
            ScoutModule(
                id: "hudson",
                name: "Hudson",
                summary: "Multi-surface shell concepts for app composition and status-aware chrome.",
                integrationMode: .link,
                capabilities: ["Canvas ideas", "Shell slots", "Multi-app experience"]
            ),
        ]
    }

    func start() {
        guard !hasStarted else {
            return
        }

        hasStarted = true
        supervisor.startIfNeeded()
    }

    func toggleSidebar() {
        sidebarExpanded.toggle()
        sidebarWidth = sidebarExpanded ? 176 : 52
    }

    func setSidebarWidth(_ width: CGFloat) {
        let clamped = min(max(width, 52), 220)
        sidebarWidth = clamped
        sidebarExpanded = clamped > 60
    }

    private static func resolvedConsoleURL() -> URL {
        if let bundledURL = Bundle.module.url(
            forResource: "index",
            withExtension: "html",
            subdirectory: "Console"
        ) {
            return bundledURL
        }

        return URL(string: "https://openscout.app")!
    }
}
