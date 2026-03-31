// RPC — JSON-RPC request/response types for the Plexus bridge protocol.
//
// Canonical source: PROTOCOL.md §3.
// Note: This is a simplified JSON-RPC dialect — no "jsonrpc" field.

import Foundation

// MARK: - Request

struct RPCRequest: Encodable, Sendable {
    let id: String
    let method: String
    let params: (any Encodable & Sendable)?

    init(method: String, params: (any Encodable & Sendable)? = nil) {
        self.id = UUID().uuidString
        self.method = method
        self.params = params
    }

    private enum CodingKeys: String, CodingKey {
        case id, method, params
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(method, forKey: .method)
        if let params {
            try container.encode(AnyEncodable(params), forKey: .params)
        }
    }
}

// MARK: - Response

struct RPCResponse: Codable, Sendable {
    let id: String
    let result: AnyCodable?
    let error: RPCError?
}

struct RPCError: Codable, Sendable {
    let code: Int
    let message: String
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

    var id: String { path }

    var isProject: Bool { !markers.isEmpty }
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

// MARK: - Type-erased Encodable wrapper

private struct AnyEncodable: Encodable, @unchecked Sendable {
    let value: any Encodable

    init(_ value: any Encodable) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}
