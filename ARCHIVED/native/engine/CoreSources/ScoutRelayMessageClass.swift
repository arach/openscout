public enum ScoutRelayMessageClass: String, Codable, CaseIterable, Hashable, Sendable {
    case agent
    case log
    case system
    case status
}
