// TurnHash — Canonical turn-content hashing for sync checks.
//
// Hashes a turn's block content as canonical JSON using MD5. This is only a
// lightweight "are phone and bridge seeing the same last turn?" check before
// sending from cached state. It is not security-sensitive.

import CryptoKit
import Foundation

enum TurnHash {
    static func normalize(_ snapshot: SessionState) -> SessionState {
        var normalized = snapshot
        normalized.turns = snapshot.turns.map(normalize)
        return normalized
    }

    static func normalize(_ turn: TurnState) -> TurnState {
        var normalized = turn
        normalized.turnHash = compute(for: turn)
        return normalized
    }

    static func compute(for turn: TurnState) -> String? {
        let payload = turn.blocks.map { canonicalBlockPayload(for: $0.block) }
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
            return nil
        }

        let digest = Insecure.MD5.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func latestTurnsMatch(local: SessionState?, remote: SessionState) -> Bool {
        let localTurn = local?.turns.last.map(normalize)
        let remoteTurn = remote.turns.last.map(normalize)

        switch (localTurn, remoteTurn) {
        case (nil, nil):
            return true
        case let (lhs?, rhs?):
            return lhs.id == rhs.id && lhs.turnHash == rhs.turnHash
        default:
            return false
        }
    }

    private static func canonicalBlockPayload(for block: Block) -> [String: Any] {
        var payload: [String: Any] = [
            "type": block.type.rawValue,
            "status": block.status.rawValue,
        ]

        if let text = block.text {
            payload["text"] = text
        }

        if let action = block.action {
            payload["action"] = canonicalActionPayload(for: action)
        }

        if let mimeType = block.mimeType {
            payload["mimeType"] = mimeType
        }

        if let name = block.name {
            payload["name"] = name
        }

        if let data = block.data {
            payload["data"] = data
        }

        if let message = block.message {
            payload["message"] = message
        }

        if let code = block.code {
            payload["code"] = code
        }

        return payload
    }

    private static func canonicalActionPayload(for action: Action) -> [String: Any] {
        var payload: [String: Any] = [
            "kind": action.kind.rawValue,
            "status": action.status.rawValue,
            "output": action.output,
        ]

        if let path = action.path {
            payload["path"] = path
        }

        if let diff = action.diff {
            payload["diff"] = diff
        }

        if let command = action.command {
            payload["command"] = command
        }

        if let exitCode = action.exitCode {
            payload["exitCode"] = exitCode
        }

        if let toolName = action.toolName {
            payload["toolName"] = toolName
        }

        if let toolCallId = action.toolCallId {
            payload["toolCallId"] = toolCallId
        }

        if let input = action.input?.value {
            payload["input"] = canonicalJSONValue(input)
        }

        if let result = action.result?.value {
            payload["result"] = canonicalJSONValue(result)
        }

        if let agentId = action.agentId {
            payload["agentId"] = agentId
        }

        if let agentName = action.agentName {
            payload["agentName"] = agentName
        }

        if let prompt = action.prompt {
            payload["prompt"] = prompt
        }

        return payload
    }

    private static func canonicalJSONValue(_ value: Any) -> Any {
        switch value {
        case is NSNull:
            return NSNull()
        case let bool as Bool:
            return bool
        case let int as Int:
            return int
        case let double as Double:
            return double
        case let string as String:
            return string
        case let array as [Any]:
            return array.map(canonicalJSONValue)
        case let dictionary as [String: Any]:
            return dictionary.mapValues(canonicalJSONValue)
        case let codableArray as [AnyCodable]:
            return codableArray.map { canonicalJSONValue($0.value) }
        case let codableDictionary as [String: AnyCodable]:
            return codableDictionary.mapValues { canonicalJSONValue($0.value) }
        default:
            return String(describing: value)
        }
    }
}
