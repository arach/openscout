// RPC — tRPC WebSocket wire format types for the Dispatch bridge protocol.
//
// Wire format: JSON-RPC 2.0 as spoken by tRPC v11 WebSocket adapter.
// See: docs/bridge-hono-trpc-migration.md

import Foundation
import SwiftUI

// MARK: - tRPC method routing

/// Maps legacy method strings (e.g. "mobile/sessions") to tRPC procedure paths and method types.
enum TRPCMethodType: String, Sendable {
    case query
    case mutation
    case subscription
}

struct TRPCRoute: Sendable {
    let path: String
    let method: TRPCMethodType
}

/// Central lookup from legacy RPC method names to tRPC routes.
/// Add new routes here as procedures are added to the bridge router.
let trpcRouteMap: [String: TRPCRoute] = [
    // Mobile surface
    "mobile/sessions":          TRPCRoute(path: "mobile.sessions",        method: .query),
    "mobile/session/snapshot":  TRPCRoute(path: "mobile.sessionSnapshot", method: .query),
    "mobile/message/send":      TRPCRoute(path: "mobile.sendMessage",     method: .mutation),
    "mobile/activity":          TRPCRoute(path: "mobile.activity",        method: .query),
    "mobile/home":              TRPCRoute(path: "mobile.home",            method: .query),
    "mobile/workspaces":        TRPCRoute(path: "mobile.workspaces",      method: .query),
    "mobile/agents":            TRPCRoute(path: "mobile.agents",          method: .query),
    "mobile/session/create":    TRPCRoute(path: "mobile.createSession",   method: .mutation),

    // Session management
    "session/list":             TRPCRoute(path: "session.list",           method: .query),
    "session/create":           TRPCRoute(path: "session.create",         method: .mutation),
    "session/close":            TRPCRoute(path: "session.close",          method: .mutation),
    "session/resume":           TRPCRoute(path: "session.resume",         method: .mutation),

    // Prompt / turn
    "turn/interrupt":           TRPCRoute(path: "prompt.interrupt",       method: .mutation),

    // Sync
    "sync/status":              TRPCRoute(path: "sync.status",            method: .query),
    "sync/replay":              TRPCRoute(path: "sync.replay",            method: .query),

    // Bridge
    "bridge/status":            TRPCRoute(path: "bridge.status",          method: .query),

    // Workspace
    "workspace/info":           TRPCRoute(path: "workspace.info",         method: .query),
    "workspace/list":           TRPCRoute(path: "workspace.list",         method: .query),
    "workspace/open":           TRPCRoute(path: "workspace.open",         method: .mutation),

    // History
    "history/discover":         TRPCRoute(path: "history.discover",       method: .query),
    "history/search":           TRPCRoute(path: "history.search",         method: .query),
    "history/read":             TRPCRoute(path: "history.session",         method: .query),
]

// MARK: - Request (tRPC wire format)

/// tRPC WebSocket request envelope.
///
/// Wire shape:
/// ```json
/// {"id": 1, "jsonrpc": "2.0", "method": "query", "params": {"path": "mobile.sessions", "input": {...}}}
/// ```
struct TRPCRequest: Encodable, Sendable {
    let id: Int
    let jsonrpc: String = "2.0"
    let method: String              // "query" | "mutation" | "subscription" | "subscription.stop"
    let params: TRPCRequestParams?

    init(id: Int, method: TRPCMethodType, path: String, input: (any Encodable & Sendable)?) {
        self.id = id
        self.method = method.rawValue
        if let input {
            self.params = TRPCRequestParams(path: path, input: AnyEncodable(input))
        } else {
            self.params = TRPCRequestParams(path: path, input: nil)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, jsonrpc, method, params
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(jsonrpc, forKey: .jsonrpc)
        try container.encode(method, forKey: .method)
        if let params {
            try container.encode(params, forKey: .params)
        }
    }
}

struct TRPCRequestParams: Encodable, Sendable {
    let path: String
    let input: AnyEncodable?

    private enum CodingKeys: String, CodingKey {
        case path, input
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        if let input {
            try container.encode(input, forKey: .input)
        }
    }
}

// MARK: - Response (tRPC wire format)

/// tRPC WebSocket response envelope.
///
/// Success: `{"id": 1, "jsonrpc": "2.0", "result": {"type": "data", "data": ...}}`
/// Error:   `{"id": 1, "jsonrpc": "2.0", "error": {"code": -32004, "message": "...", "data": {"code": "NOT_FOUND"}}}`
struct TRPCResponse: Codable, Sendable {
    let id: Int
    let result: TRPCResult?
    let error: TRPCError?
}

struct TRPCResult: Codable, Sendable {
    let type: String            // "data" | "started" | "stopped"
    let data: AnyCodable?
    /// Event ID for tracked subscription data — used for reconnect recovery via lastEventId.
    let id: String?
}

struct TRPCError: Codable, Sendable {
    let code: Int
    let message: String
    let data: TRPCErrorData?
}

struct TRPCErrorData: Codable, Sendable {
    let code: String?           // e.g. "NOT_FOUND", "BAD_REQUEST"
}

// MARK: - Typed request params

struct CreateSessionParams: Codable, Sendable {
    let adapterType: String
    var name: String?
    var cwd: String?
    var options: [String: AnyCodable]?
}

struct SessionIdParams: Codable, Sendable {
    let sessionId: String
}

struct ReplayParams: Codable, Sendable {
    let lastSeq: Int
}

struct SyncStatusResponse: Codable, Sendable {
    let currentSeq: Int
    let oldestBufferedSeq: Int
    let sessionCount: Int
}

struct BridgeStatusResponse: Codable, Sendable {
    let sessions: [SessionSummary]
}

struct ReplayResponse: Codable, Sendable {
    let events: [SequencedEvent]
}

// MARK: - Workspace types

struct WorkspaceInfoResponse: Codable, Sendable {
    let configured: Bool
    let root: String?
}

struct WorkspaceListParams: Codable, Sendable {
    let path: String?
}

struct DirectoryEntry: Codable, Identifiable, Sendable {
    let name: String
    let path: String
    let markers: [String]
    let currentBranch: String?

    var id: String { path }

    var isProject: Bool { !markers.isEmpty }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        path = try container.decode(String.self, forKey: .path)
        markers = try container.decode([String].self, forKey: .markers)
        currentBranch = try container.decodeIfPresent(String.self, forKey: .currentBranch)
    }

    private enum CodingKeys: String, CodingKey {
        case name, path, markers, currentBranch
    }
}

struct WorkspaceListResponse: Codable, Sendable {
    let root: String
    let path: String
    let entries: [DirectoryEntry]
}

struct WorkspaceOpenParams: Codable, Sendable {
    let path: String
    var adapter: String?
    var name: String?
}

struct SessionResumeParams: Codable, Sendable {
    let sessionPath: String
    var adapterType: String?
    var name: String?
}

struct MobileListParams: Codable, Sendable {
    var query: String?
    var limit: Int?
}

struct MobileCreateSessionParams: Codable, Sendable {
    let workspaceId: String
    var harness: String?
    var agentName: String?
    var worktree: String?
    var profile: String?
    var branch: String?
    var model: String?
    var forceNew: Bool?
}

struct MobileSessionSnapshotParams: Codable, Sendable {
    let conversationId: String
    var beforeTurnId: String?
    var limit: Int?
}

struct MobileSendMessageParams: Codable, Sendable {
    let agentId: String
    let body: String
    var clientMessageId: String?
    var replyToMessageId: String?
    var referenceMessageIds: [String]?
    var harness: String?
}

struct MobileWorkspaceHarnessSummary: Codable, Sendable {
    let harness: String
    let source: String
    let detail: String
    let readinessState: String?
    let readinessDetail: String?
}

struct MobileWorkspaceSummary: Codable, Identifiable, Sendable {
    let id: String
    let title: String
    let projectName: String
    let root: String
    let sourceRoot: String
    let relativePath: String
    let registrationKind: String
    let defaultHarness: String
    let harnesses: [MobileWorkspaceHarnessSummary]
}

struct MobileSessionSummary: Codable, Identifiable, Sendable {
    let id: String
    let kind: String
    let title: String
    let participantIds: [String]
    let agentId: String?
    let agentName: String?
    let harness: String?
    let currentBranch: String?
    let preview: String?
    let messageCount: Int
    let lastMessageAt: Int?
    let workspaceRoot: String?
}

struct MobileSessionHandleConversation: Codable, Sendable {
    let conversationId: String
    let title: String
    let existed: Bool
}

struct MobileSessionHandle: Codable, Sendable {
    let workspace: MobileWorkspaceSummary
    let agent: MobileAgentSummary
    let session: MobileSessionHandleConversation
    let unsupported: [String]
}

struct MobileAgentSummary: Codable, Sendable {
    let id: String
    let title: String
    let selector: String?
    let defaultSelector: String?
    let workspaceRoot: String?
    let harness: String?
    let transport: String?
    let state: String
    let statusLabel: String
    let sessionId: String?
    let lastActiveAt: Int?
}

// MARK: - Activity Feed

struct MobileActivityParams: Codable, Sendable {
    var agentId: String?
    var actorId: String?
    var conversationId: String?
    var limit: Int?
}

struct ActivityItem: Codable, Identifiable, Sendable {
    let id: String
    let kind: String
    let ts: Int
    var conversationId: String?
    var messageId: String?
    var invocationId: String?
    var flightId: String?
    var recordId: String?
    var actorId: String?
    var counterpartId: String?
    var agentId: String?
    var workspaceRoot: String?
    var sessionId: String?
    var title: String?
    var summary: String?
    var payload: [String: AnyCodable]?

    /// Normalized timestamp in milliseconds — broker sends mixed seconds/milliseconds.
    var tsMs: Int {
        ts > 10_000_000_000 ? ts : ts * 1000
    }

    var date: Date {
        Date(timeIntervalSince1970: Double(tsMs) / 1000.0)
    }

    var projectName: String? {
        guard let root = workspaceRoot?.trimmedNonEmpty else { return nil }
        return URL(fileURLWithPath: root).lastPathComponent
    }

    /// True for transient status updates that shouldn't appear in the feed.
    var isNoise: Bool {
        switch kind {
        case "status_message", "ask_working": true
        default: false
        }
    }

    var kindLabel: String {
        switch kind {
        case "message_posted": "Message"
        case "agent_message": "Agent"
        case "ask_opened": "Asked"
        case "ask_replied": "Replied"
        case "ask_failed": "Failed"
        case "handoff_sent": "Handoff"
        case "invocation_recorded": "Task"
        case "flight_updated": "Flight"
        case "collaboration_event": "Event"
        default: kind
        }
    }

    var kindIcon: String {
        switch kind {
        case "message_posted": "bubble.left"
        case "agent_message": "cpu"
        case "ask_opened": "paperplane"
        case "ask_replied": "checkmark.bubble"
        case "ask_failed": "exclamationmark.triangle"
        case "handoff_sent": "arrow.right.arrow.left"
        case "invocation_recorded": "play.circle"
        case "flight_updated": "airplane.departure"
        case "collaboration_event": "person.2"
        default: "bolt"
        }
    }

    var kindColor: Color {
        switch kind {
        case "ask_replied": ScoutColors.statusActive
        case "ask_failed": ScoutColors.statusError
        case "flight_updated": ScoutColors.statusStreaming
        case "agent_message": ScoutColors.accent
        case "ask_opened", "invocation_recorded": ScoutColors.accent
        case "message_posted": ScoutColors.textPrimary
        default: ScoutColors.textSecondary
        }
    }
}

// MARK: - Type-erased Encodable wrapper

struct AnyEncodable: Encodable, @unchecked Sendable {
    let value: any Encodable

    init(_ value: any Encodable) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}
