import Foundation

public struct ScoutMessageRenderBlock: Identifiable, Equatable {
    public let root: ScoutMessage
    public let replies: [ScoutMessage]

    public var id: String { root.id }
}

public enum ScoutMessageRenderItem: Identifiable, Equatable {
    case inline(ScoutMessage)
    case chain(ScoutMessageRenderBlock)

    public var id: String {
        switch self {
        case .inline(let message):
            return "inline:\(message.id)"
        case .chain(let block):
            return "chain:\(block.root.id)"
        }
    }
}

public enum ScoutMessageRenderPlanner {
    public static func items(for messages: [ScoutMessage]) -> [ScoutMessageRenderItem] {
        var messagesById: [String: ScoutMessage] = [:]
        var indexById: [String: Int] = [:]
        for (index, message) in messages.enumerated() {
            messagesById[message.id] = message
            indexById[message.id] = index
        }

        // Adjacent replies stay in the chronological stream; only late replies
        // gather under a parent rail.
        var wantsGather = Set<String>()
        for message in messages {
            guard isReplyGatherCandidate(message),
                  let parentId = message.replyToMessageId,
                  !parentId.isEmpty,
                  let parent = messagesById[parentId],
                  isReplyGatherCandidate(parent),
                  let messageIndex = indexById[message.id],
                  let parentIndex = indexById[parentId],
                  parentIndex != messageIndex - 1 else {
                continue
            }
            wantsGather.insert(message.id)
        }

        // Deep replies flatten under the nearest ancestor that remains visible
        // in the chronological stream, preserving one visual rail level.
        var gatheredIds = Set<String>()
        var repliesByRoot: [String: [ScoutMessage]] = [:]

        for message in messages where wantsGather.contains(message.id) {
            guard let rootId = streamVisibleChainRoot(
                for: message,
                messagesById: messagesById,
                wantsGather: wantsGather
            ), rootId != message.id else {
                continue
            }
            gatheredIds.insert(message.id)
            repliesByRoot[rootId, default: []].append(message)
        }

        for rootId in repliesByRoot.keys {
            repliesByRoot[rootId]?.sort {
                (indexById[$0.id] ?? Int.max) < (indexById[$1.id] ?? Int.max)
            }
        }

        return messages.compactMap { message in
            if gatheredIds.contains(message.id) {
                return nil
            }
            if let replies = repliesByRoot[message.id], !replies.isEmpty {
                return .chain(ScoutMessageRenderBlock(root: message, replies: replies))
            }
            return .inline(message)
        }
    }

    public static func isReplyGatherCandidate(_ message: ScoutMessage) -> Bool {
        let messageClass = message.messageClass
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return messageClass != "status" && messageClass != "system"
    }

    private static func streamVisibleChainRoot(
        for message: ScoutMessage,
        messagesById: [String: ScoutMessage],
        wantsGather: Set<String>
    ) -> String? {
        var current = message
        var visited = Set([message.id])

        while let parentId = current.replyToMessageId, !parentId.isEmpty {
            guard let parent = messagesById[parentId],
                  !visited.contains(parent.id),
                  isReplyGatherCandidate(parent) else {
                return nil
            }
            visited.insert(parent.id)
            if !wantsGather.contains(parent.id) {
                return parent.id
            }
            current = parent
        }

        return nil
    }
}
