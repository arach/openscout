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
            return "Sessions"
        case .console:
            return "Workspace"
        case .integrations:
            return "Integrations"
        case .workers:
            return "Workers"
        case .settings:
            return "Settings"
        }
    }

    public var systemImage: String {
        switch self {
        case .home:
            return "square.grid.2x2"
        case .sessions:
            return "clock.arrow.trianglehead.counterclockwise.rotate.90"
        case .console:
            return "globe"
        case .integrations:
            return "point.3.connected.trianglepath.dotted"
        case .workers:
            return "cpu"
        case .settings:
            return "gearshape"
        }
    }

    public var summary: String {
        switch self {
        case .home:
            return "Primary shell overview and module entry points."
        case .sessions:
            return "Shared session history and runtime context."
        case .console:
            return "Embedded workspace surface for dashboards, tools, and local web content."
        case .integrations:
            return "Linked and embedded capabilities across the app family."
        case .workers:
            return "Helper process health and runtime supervision."
        case .settings:
            return "Local preferences, paths, and environment state."
        }
    }
}
