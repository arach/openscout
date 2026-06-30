// SessionInitiationCapability (SCO-061 Phase 1).
//
// The first real capability. The pure spec/result are ported from
// apps/macos/Sources/Scout/ScoutSessionService.swift; the transport call that
// lived alongside them becomes a per-platform adapter conforming to this
// protocol. The spec is Codable so it doubles as the contract fixture.

import Foundation

/// Flexible session-initiation request. Mirrors `POST /api/sessions`: every
/// modality (new conversation in a project, "same agent" fresh, continue an
/// agent's session with full context, seed-from-message) is expressed by which
/// fields are set rather than by a dedicated endpoint.
public struct SessionInitiationSpec: Codable, Sendable, Equatable {
    public enum SessionMode: String, Codable, Sendable { case new, existing, any }

    public struct Target: Codable, Sendable, Equatable {
        public var agentId: String?
        public var projectPath: String?
        public init(agentId: String? = nil, projectPath: String? = nil) {
            self.agentId = agentId
            self.projectPath = projectPath
        }
    }

    public struct Execution: Codable, Sendable, Equatable {
        public var harness: String?
        public var model: String?
        public var reasoningEffort: String?
        public var session: SessionMode?
        public var targetSessionId: String?
        public init(
            harness: String? = nil,
            model: String? = nil,
            reasoningEffort: String? = nil,
            session: SessionMode? = nil,
            targetSessionId: String? = nil
        ) {
            self.harness = harness
            self.model = model
            self.reasoningEffort = reasoningEffort
            self.session = session
            self.targetSessionId = targetSessionId
        }
    }

    public struct Agent: Codable, Sendable, Equatable {
        public var persistence: String?
        public var handle: String?
        public var displayName: String?
        public init(persistence: String? = nil, handle: String? = nil, displayName: String? = nil) {
            self.persistence = persistence
            self.handle = handle
            self.displayName = displayName
        }
    }

    public struct Seed: Codable, Sendable, Equatable {
        public var instructions: String?
        public var fromMessageId: String?
        public var fromConversationId: String?
        public var attachments: [MessageAttachment]?
        public init(instructions: String? = nil, fromMessageId: String? = nil, fromConversationId: String? = nil, attachments: [MessageAttachment]? = nil) {
            self.instructions = instructions
            self.fromMessageId = fromMessageId
            self.fromConversationId = fromConversationId
            self.attachments = attachments
        }
    }

    public var target: Target?
    public var execution: Execution?
    public var agent: Agent?
    public var seed: Seed?

    public init(target: Target? = nil, execution: Execution? = nil, agent: Agent? = nil, seed: Seed? = nil) {
        self.target = target
        self.execution = execution
        self.agent = agent
        self.seed = seed
    }
}

public struct SessionInitiationResult: Codable, Sendable, Equatable {
    public var ok: Bool?
    public var conversationId: String?
    public var agentId: String?
    public var sessionId: String?
    public var handle: String?
    public var flightId: String?
    public var messageId: String?

    public init(ok: Bool? = nil, conversationId: String? = nil, agentId: String? = nil, sessionId: String? = nil, handle: String? = nil, flightId: String? = nil, messageId: String? = nil) {
        self.ok = ok
        self.conversationId = conversationId
        self.agentId = agentId
        self.sessionId = sessionId
        self.handle = handle
        self.flightId = flightId
        self.messageId = messageId
    }
}

/// Capability: start a conversation/session in any modality. Implemented by a
/// per-platform transport adapter (macOS HTTP `POST /api/sessions`, iOS bridge
/// RPC). The shared layer and views depend on this protocol only.
public protocol SessionInitiationCapability: Sendable {
    func startSession(_ spec: SessionInitiationSpec) async throws -> SessionInitiationResult
}
