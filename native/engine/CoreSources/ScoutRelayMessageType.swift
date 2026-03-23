public enum ScoutRelayMessageType: String, Codable, CaseIterable, Hashable, Sendable {
    case msg = "MSG"
    case ack = "ACK"
    case sys = "SYS"
}
