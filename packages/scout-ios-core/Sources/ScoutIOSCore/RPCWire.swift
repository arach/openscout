// RPCWire — tRPC WebSocket wire format, distilled from
// apps/ios/Scout/Models/RPC.swift.
//
// Keeps only the envelope encoding (TRPCRequest/TRPCResponse), the route map for
// the methods this distill speaks, and the epoch-normalization helper. Dropped:
// every donor request/response struct tied to inbox/push/history/workspace/agent
// detail and all SwiftUI-coupled ActivityItem rendering helpers.
//
// The wire shape is byte-identical to the donor so it interops with the bridge.

import Foundation
import ScoutCapabilities

// MARK: - Epoch helpers (ported)

func scoutEpochMilliseconds(_ value: Int) -> Int {
    Int(ScoutTimestamp.epochMilliseconds(TimeInterval(value)) ?? 0)
}

// MARK: - tRPC routing

enum TRPCMethodType: String, Sendable {
    case query
    case mutation
    case subscription
}

struct TRPCRoute: Sendable {
    let path: String
    let method: TRPCMethodType
}

/// Method-name map for the distilled core loop. A subset of the donor's
/// `trpcRouteMap` — only the procedures the capability methods invoke.
let trpcRouteMap: [String: TRPCRoute] = [
    "mobile/sessions":         TRPCRoute(path: "mobile.sessions",        method: .query),
    "mobile/agents":           TRPCRoute(path: "mobile.agents",          method: .query),
    "mobile/workspaces":       TRPCRoute(path: "mobile.workspaces",      method: .query),
    "mobile/activity":         TRPCRoute(path: "mobile.activity",        method: .query),
    "mobile/tail":             TRPCRoute(path: "mobile.tail",            method: .query),
    "mobile/endpoints":        TRPCRoute(path: "mobile.endpoints",       method: .query),
    "mobile/session/snapshot": TRPCRoute(path: "mobile.sessionSnapshot", method: .query),
    "mobile/message/send":     TRPCRoute(path: "mobile.sendMessage",     method: .mutation),
    "mobile/session/create":   TRPCRoute(path: "mobile.createSession",   method: .mutation),
    "question/answer":         TRPCRoute(path: "questionAnswer",         method: .mutation),
    "action/decide":           TRPCRoute(path: "actionDecide",           method: .mutation),
    "turn/interrupt":          TRPCRoute(path: "turnInterrupt",          method: .mutation),
    "mobile/comms/conversations": TRPCRoute(path: "mobile.commsConversations", method: .query),
    "mobile/comms/messages":      TRPCRoute(path: "mobile.commsMessages",      method: .query),
    "mobile/comms/send":          TRPCRoute(path: "mobile.commsSend",          method: .mutation),
    "mobile/attachments/upload":  TRPCRoute(path: "mobile.attachmentUpload",   method: .mutation),
    "mobile/comms/read":          TRPCRoute(path: "mobile.commsMarkRead",      method: .mutation),
    "mobile/terminal/provision":  TRPCRoute(path: "mobile.terminalProvision",  method: .mutation),
    "mobile/terminal/status":     TRPCRoute(path: "mobile.terminalStatus",     method: .query),
    "mobile/mesh/status":         TRPCRoute(path: "mobile.meshStatus",         method: .query),
]

// MARK: - Request envelope (ported byte-for-byte)

/// `{"id": 1, "jsonrpc": "2.0", "method": "query", "params": {"path": "...", "input": {...}}}`
struct TRPCRequest: Encodable, Sendable {
    let id: Int
    let jsonrpc: String = "2.0"
    let method: String
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

    private enum CodingKeys: String, CodingKey { case id, jsonrpc, method, params }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(jsonrpc, forKey: .jsonrpc)
        try container.encode(method, forKey: .method)
        if let params { try container.encode(params, forKey: .params) }
    }
}

struct TRPCRequestParams: Encodable, Sendable {
    let path: String
    let input: AnyEncodable?

    private enum CodingKeys: String, CodingKey { case path, input }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        if let input { try container.encode(input, forKey: .input) }
    }
}

// MARK: - Response envelope (ported byte-for-byte)

/// Success: `{"id": 1, "jsonrpc": "2.0", "result": {"type": "data", "data": ...}}`
/// Error:   `{"id": 1, "jsonrpc": "2.0", "error": {"code": -32004, "message": "..."}}`
struct TRPCResponse: Codable, Sendable {
    let id: Int
    let result: TRPCResult?
    let error: TRPCError?
}

struct TRPCResult: Codable, Sendable {
    let type: String            // "data" | "started" | "stopped"
    let data: AnyCodable?
    let id: String?
}

struct TRPCError: Codable, Sendable {
    let code: Int
    let message: String
}

// MARK: - Type-erased Encodable wrapper (ported)

struct AnyEncodable: Encodable, @unchecked Sendable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}
