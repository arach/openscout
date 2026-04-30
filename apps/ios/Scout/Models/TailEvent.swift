// TailEvent — machine-wide firehose of harness transcript activity.
//
// Mirrors packages/web/server/core/tail/types.ts on the producer side.
// Two attribution dimensions:
//   - source:  runtime harness identifier ("claude", "codex", future "quad")
//   - harness: launch attribution (scout-managed | hudson-managed | unattributed/native)
//
// See docs/tail-firehose.md for the contract and lane split.

import Foundation

struct TailEvent: Codable, Identifiable, Sendable {
    enum Harness: String, Codable, Sendable {
        case scoutManaged = "scout-managed"
        case hudsonManaged = "hudson-managed"
        case unattributed
    }

    enum Kind: String, Codable, Sendable {
        case user
        case assistant
        case tool
        case toolResult = "tool-result"
        case system
        case other
    }

    let id: String
    let ts: Int
    let source: String
    let sessionId: String
    let pid: Int
    let parentPid: Int?
    let project: String
    let cwd: String
    let harness: Harness
    let kind: Kind
    let summary: String

    var date: Date {
        Date(timeIntervalSince1970: Double(ts) / 1000.0)
    }
}
