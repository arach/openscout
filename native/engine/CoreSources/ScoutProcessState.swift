public enum ScoutProcessState: String, Codable, CaseIterable, Hashable, Sendable {
    case stopped
    case launching
    case running
    case degraded
    case failed

    public var title: String {
        switch self {
        case .stopped:
            return "Stopped"
        case .launching:
            return "Launching"
        case .running:
            return "Running"
        case .degraded:
            return "Degraded"
        case .failed:
            return "Failed"
        }
    }
}
