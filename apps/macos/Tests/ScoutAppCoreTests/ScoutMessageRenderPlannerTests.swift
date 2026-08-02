import Foundation
@testable import ScoutAppCore
import XCTest

final class ScoutMessageRenderPlannerTests: XCTestCase {
    func testAdjacentReplyStaysInline() throws {
        let items = ScoutMessageRenderPlanner.items(for: try messages([
            ("root", nil, "agent"),
            ("reply", "root", "agent"),
        ]))

        XCTAssertEqual(itemShapes(items), ["inline:root", "inline:reply"])
    }

    func testNonAdjacentReplyGathersUnderParent() throws {
        let items = ScoutMessageRenderPlanner.items(for: try messages([
            ("root", nil, "agent"),
            ("later", nil, "agent"),
            ("reply", "root", "agent"),
        ]))

        XCTAssertEqual(itemShapes(items), ["chain:root[reply]", "inline:later"])
    }

    func testNestedLateRepliesFlattenUnderStreamVisibleAncestor() throws {
        let items = ScoutMessageRenderPlanner.items(for: try messages([
            ("root", nil, "agent"),
            ("middle", nil, "agent"),
            ("reply", "root", "agent"),
            ("later", nil, "agent"),
            ("nested", "reply", "agent"),
        ]))

        XCTAssertEqual(
            itemShapes(items),
            ["chain:root[reply,nested]", "inline:middle", "inline:later"]
        )
    }

    func testMissingParentKeepsReplyInline() throws {
        let items = ScoutMessageRenderPlanner.items(for: try messages([
            ("root", nil, "agent"),
            ("reply", "outside-loaded-window", "agent"),
        ]))

        XCTAssertEqual(itemShapes(items), ["inline:root", "inline:reply"])
    }

    func testStatusAndSystemMessagesNeverGather() throws {
        let items = ScoutMessageRenderPlanner.items(for: try messages([
            ("root", nil, "agent"),
            ("middle", nil, "agent"),
            ("status", "root", "status"),
            ("system", "root", "system"),
            ("reply-to-status", "status", "agent"),
        ]))

        XCTAssertEqual(
            itemShapes(items),
            [
                "inline:root",
                "inline:middle",
                "inline:status",
                "inline:system",
                "inline:reply-to-status",
            ]
        )
    }

    func testReplyCycleKeepsMessagesInline() throws {
        let items = ScoutMessageRenderPlanner.items(for: try messages([
            ("first", "second", "agent"),
            ("middle", nil, "agent"),
            ("second", "first", "agent"),
        ]))

        XCTAssertEqual(itemShapes(items), ["inline:first", "inline:middle", "inline:second"])
    }

    private func messages(_ specs: [(String, String?, String)]) throws -> [ScoutMessage] {
        let payload = specs.enumerated().map { index, spec in
            let (id, replyTo, messageClass) = spec
            var message: [String: Any] = [
                "id": id,
                "conversationId": "conversation",
                "actorId": "agent",
                "actorName": "Agent",
                "body": id,
                "createdAt": 1_710_000_000_000 + index,
                "class": messageClass,
            ]
            if let replyTo {
                message["replyToMessageId"] = replyTo
            }
            return message
        }
        let data = try JSONSerialization.data(withJSONObject: payload)
        return try JSONDecoder().decode([ScoutMessage].self, from: data)
    }

    private func itemShapes(_ items: [ScoutMessageRenderItem]) -> [String] {
        items.map { item in
            switch item {
            case .inline(let message):
                return "inline:\(message.id)"
            case .chain(let block):
                let replies = block.replies.map(\.id).joined(separator: ",")
                return "chain:\(block.root.id)[\(replies)]"
            }
        }
    }
}
