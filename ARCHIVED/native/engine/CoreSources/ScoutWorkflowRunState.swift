public enum ScoutWorkflowRunState: String, Codable, CaseIterable, Hashable, Sendable {
    case generated
    case delivered

    public var title: String {
        switch self {
        case .generated:
            return "Generated"
        case .delivered:
            return "Delivered"
        }
    }
}
