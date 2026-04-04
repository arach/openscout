import Foundation

public struct ScoutAgentStatus: Codable, Equatable, Sendable {
    public var state: ScoutProcessState
    public var heartbeat: Date
    public var pid: Int32
    public var detail: String

    public init(
        state: ScoutProcessState,
        heartbeat: Date,
        pid: Int32,
        detail: String
    ) {
        self.state = state
        self.heartbeat = heartbeat
        self.pid = pid
        self.detail = detail
    }
}
