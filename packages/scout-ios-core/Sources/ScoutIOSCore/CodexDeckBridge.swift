import Foundation
import ScoutCapabilities

/// Harness-specific bridge projection for the Scout Deck. This intentionally
/// names Codex app-server instead of widening ScoutBrokerClient with semantics
/// that other harnesses may not actually support.
public struct CodexDeckThreadSnapshot: Codable, Sendable {
    public struct Capabilities: Codable, Sendable {
        public let connect: Bool
        public let start: Bool
        public let steer: Bool
        public let interrupt: Bool
        public let queue: Bool
        public let approvals: Bool
    }

    public struct CapabilityNotes: Codable, Sendable {
        public let queue: String
        public let approvals: String
    }

    public let adapter: String
    public let agentId: String
    public let threadId: String?
    public let turnId: String?
    public let state: String
    public let capabilities: Capabilities
    public let capabilityNotes: CapabilityNotes
    public let snapshot: SessionState?
}

public struct CodexDeckActionReceipt: Codable, Sendable {
    public let accepted: Bool
    public let agentId: String
    public let threadId: String?
    public let mode: String
}

