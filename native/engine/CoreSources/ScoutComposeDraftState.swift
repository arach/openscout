public enum ScoutComposeDraftState: String, Codable, CaseIterable, Hashable, Sendable {
    case draft
    case ready
    case sent

    public var title: String {
        switch self {
        case .draft:
            return "Draft"
        case .ready:
            return "Ready"
        case .sent:
            return "Sent"
        }
    }
}
