public enum ScoutRoute: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case home
    case sessions
    case console
    case integrations
    case workers
    case settings

    public var id: String {
        rawValue
    }

    public var title: String {
        switch self {
        case .home:
            return "Home"
        case .sessions:
            return "Notes"
        case .console:
            return "Compose"
        case .integrations:
            return "Workflows"
        case .workers:
            return "Relay"
        case .settings:
            return "Settings"
        }
    }

    public var systemImage: String {
        switch self {
        case .home:
            return "square.grid.2x2"
        case .sessions:
            return "note.text"
        case .console:
            return "square.and.pencil"
        case .integrations:
            return "bolt.horizontal.circle"
        case .workers:
            return "bubble.left.and.bubble.right"
        case .settings:
            return "gearshape"
        }
    }

    public var summary: String {
        switch self {
        case .home:
            return "Primary shell overview and module entry points."
        case .sessions:
            return "Persistent notes, prompts, and attached context."
        case .console:
            return "Prompt composition, workflow framing, and agent-ready packets."
        case .integrations:
            return "Prompt-centric workflow templates and generated runs."
        case .workers:
            return "Live relay chat, roster state, and channel delivery."
        case .settings:
            return "Local preferences, paths, and environment state."
        }
    }
}
