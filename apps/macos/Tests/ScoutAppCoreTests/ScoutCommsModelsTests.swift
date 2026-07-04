import ScoutCapabilities
@testable import ScoutAppCore
import XCTest

final class ScoutCommsModelsTests: XCTestCase {
    func testMessageDecodesAttachments() throws {
        let json = """
        {
          "id": "msg-1",
          "conversationId": "c.thread",
          "actorId": "operator",
          "actorName": "Operator",
          "body": "See screenshot",
          "createdAt": 1710000000000,
          "class": "agent",
          "attachments": [
            {
              "id": "att-1",
              "mediaType": "image/png",
              "fileName": "screenshot.png",
              "url": "/api/blobs/blob-1"
            }
          ]
        }
        """

        let message = try JSONDecoder().decode(ScoutMessage.self, from: Data(json.utf8))

        XCTAssertEqual(message.attachments.count, 1)
        XCTAssertEqual(message.attachments.first?.id, "att-1")
        XCTAssertEqual(message.attachments.first?.mediaType, "image/png")
        XCTAssertEqual(message.attachments.first?.fileName, "screenshot.png")
        XCTAssertEqual(message.attachments.first?.url, "/api/blobs/blob-1")
    }

    func testReadCursorNormalizesEpochMilliseconds() throws {
        let json = """
        {
          "conversationId": "c.thread",
          "actorId": "agent.codex",
          "readerNodeId": "node-1",
          "lastReadMessageId": "msg-1",
          "lastReadSeq": 7,
          "lastReadAt": 1710000000000,
          "updatedAt": 1710000001000
        }
        """

        let cursor = try JSONDecoder().decode(ScoutReadCursor.self, from: Data(json.utf8))

        XCTAssertEqual(cursor.id, "c.thread\u{0}agent.codex")
        XCTAssertEqual(cursor.lastReadMessageId, "msg-1")
        XCTAssertEqual(cursor.lastReadSeq, 7)
        XCTAssertEqual(cursor.lastReadAt, 1710000000000)
        XCTAssertEqual(cursor.updatedAt, 1710000001000)
    }
}
