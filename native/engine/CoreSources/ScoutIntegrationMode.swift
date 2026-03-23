public enum ScoutIntegrationMode: String, Codable, CaseIterable, Hashable, Sendable {
    case link
    case embed
    case copy

    public var title: String {
        switch self {
        case .link:
            return "Link"
        case .embed:
            return "Embed"
        case .copy:
            return "Copy"
        }
    }
}
