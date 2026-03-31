// HistoryRPC — Request/response types for history/* bridge RPCs.
//
// Matches the bridge's history/discover, history/search, history/read methods.

import Foundation

// MARK: - history/discover

struct HistoryDiscoverParams: Codable, Sendable {
    var maxAge: Int?   // days, default 14
    var limit: Int?    // max results, default 100
    var project: String? // filter by project name
}

struct DiscoveredSession: Codable, Identifiable, Sendable {
    let path: String
    let project: String
    let agent: String       // "claude-code" | "codex" | "aider" | "unknown"
    let modifiedAt: Double  // epoch ms
    let sizeBytes: Int
    let lineCount: Int

    var id: String { path }

    var modifiedDate: Date {
        Date(timeIntervalSince1970: modifiedAt / 1000.0)
    }
}

struct HistoryDiscoverResponse: Codable, Sendable {
    let sessions: [DiscoveredSession]
}

// MARK: - history/search

struct HistorySearchParams: Codable, Sendable {
    let query: String
    var maxAge: Int?
    var limit: Int?
}

struct SearchMatch: Codable, Identifiable, Sendable {
    let path: String
    let project: String
    let agent: String
    let matchCount: Int
    let preview: [String]

    var id: String { path }
}

struct HistorySearchResponse: Codable, Sendable {
    let query: String
    let matches: [SearchMatch]
}

// MARK: - history/read

struct HistoryReadParams: Codable, Sendable {
    let path: String
}

struct HistoryReadResponse: Codable, Sendable {
    let path: String
    let lineCount: Int
    let lines: [String]
}
