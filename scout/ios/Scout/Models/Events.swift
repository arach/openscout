// Events — Dispatch event parsing.
//
// Canonical source: PROTOCOL.md §4.
// Events arrive as { seq: number, event: { event: "<discriminator>", ... } }

import Foundation

// MARK: - Sequenced event wrapper

struct SequencedEvent: Codable, Sendable {
    let seq: Int
    let event: ScoutEvent
}

// MARK: - ScoutEvent — discriminated union on "event" field

enum ScoutEvent: Sendable {
    case sessionUpdate(session: Session)
    case sessionClosed(sessionId: String)
    case turnStart(sessionId: String, turn: Turn)
    case turnEnd(sessionId: String, turnId: String, status: TurnStatus)
    case turnError(sessionId: String, turnId: String, message: String)
    case blockStart(sessionId: String, turnId: String, block: Block)
    case blockDelta(sessionId: String, turnId: String, blockId: String, text: String)
    case blockActionOutput(sessionId: String, turnId: String, blockId: String, output: String)
    case blockActionStatus(sessionId: String, turnId: String, blockId: String, status: ActionStatus, meta: [String: AnyCodable]?)
    case blockEnd(sessionId: String, turnId: String, blockId: String, status: BlockStatus)
    case unknown(discriminator: String)
}

extension ScoutEvent: Codable {

    private enum CodingKeys: String, CodingKey {
        case event
        case session, sessionId
        case turn, turnId
        case block, blockId
        case status, text, output, message, meta
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let discriminator = try container.decode(String.self, forKey: .event)

        switch discriminator {
        case "session:update":
            let session = try container.decode(Session.self, forKey: .session)
            self = .sessionUpdate(session: session)

        case "session:closed":
            let sid = try container.decode(String.self, forKey: .sessionId)
            self = .sessionClosed(sessionId: sid)

        case "turn:start":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let turn = try container.decode(Turn.self, forKey: .turn)
            self = .turnStart(sessionId: sid, turn: turn)

        case "turn:end":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let tid = try container.decode(String.self, forKey: .turnId)
            let status = try container.decode(TurnStatus.self, forKey: .status)
            self = .turnEnd(sessionId: sid, turnId: tid, status: status)

        case "turn:error":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let tid = try container.decode(String.self, forKey: .turnId)
            let msg = try container.decode(String.self, forKey: .message)
            self = .turnError(sessionId: sid, turnId: tid, message: msg)

        case "block:start":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let tid = try container.decode(String.self, forKey: .turnId)
            let block = try container.decode(Block.self, forKey: .block)
            self = .blockStart(sessionId: sid, turnId: tid, block: block)

        case "block:delta":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let tid = try container.decode(String.self, forKey: .turnId)
            let bid = try container.decode(String.self, forKey: .blockId)
            let text = try container.decode(String.self, forKey: .text)
            self = .blockDelta(sessionId: sid, turnId: tid, blockId: bid, text: text)

        case "block:action:output":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let tid = try container.decode(String.self, forKey: .turnId)
            let bid = try container.decode(String.self, forKey: .blockId)
            let output = try container.decode(String.self, forKey: .output)
            self = .blockActionOutput(sessionId: sid, turnId: tid, blockId: bid, output: output)

        case "block:action:status":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let tid = try container.decode(String.self, forKey: .turnId)
            let bid = try container.decode(String.self, forKey: .blockId)
            let status = try container.decode(ActionStatus.self, forKey: .status)
            let meta = try container.decodeIfPresent([String: AnyCodable].self, forKey: .meta)
            self = .blockActionStatus(sessionId: sid, turnId: tid, blockId: bid, status: status, meta: meta)

        case "block:end":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let tid = try container.decode(String.self, forKey: .turnId)
            let bid = try container.decode(String.self, forKey: .blockId)
            let status = try container.decode(BlockStatus.self, forKey: .status)
            self = .blockEnd(sessionId: sid, turnId: tid, blockId: bid, status: status)

        default:
            self = .unknown(discriminator: discriminator)
        }
    }

    func encode(to encoder: Encoder) throws {
        // Encoding not needed for the iOS client (it only receives events).
        // Stub to satisfy Codable conformance.
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .unknown(let d):
            try container.encode(d, forKey: .event)
        default:
            break
        }
    }
}
