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

    func testMessageCompletesPendingConversationByReplyMessageId() throws {
        let json = """
        {
          "id": "msg-reply",
          "conversationId": "chn-1",
          "actorId": "session-1",
          "actorName": "openscout-haydn",
          "body": "ok",
          "createdAt": 1710000000000,
          "class": "agent",
          "replyToMessageId": "msg-seed"
        }
        """

        let message = try JSONDecoder().decode(ScoutMessage.self, from: Data(json.utf8))

        XCTAssertTrue(message.completesPendingConversation(messageId: "msg-seed", flightId: nil))
        XCTAssertFalse(message.completesPendingConversation(messageId: "msg-other", flightId: nil))
    }

    func testMessageCompletesPendingConversationByFlightIdWithoutSeedMessageId() throws {
        let json = """
        {
          "id": "msg-reply",
          "conversationId": "chn-1",
          "actorId": "session-1",
          "actorName": "openscout-haydn",
          "body": "ok",
          "createdAt": 1710000000000,
          "class": "agent",
          "metadata": {
            "flightId": "flt-session"
          }
        }
        """

        let message = try JSONDecoder().decode(ScoutMessage.self, from: Data(json.utf8))

        XCTAssertTrue(message.completesPendingConversation(messageId: nil, flightId: "flt-session"))
        XCTAssertFalse(message.completesPendingConversation(messageId: nil, flightId: "flt-other"))
    }

    func testStatusAndOperatorMessagesDoNotCompletePendingConversationByFlightId() throws {
        let json = """
        [
          {
            "id": "msg-status",
            "conversationId": "chn-1",
            "actorId": "session-1",
            "actorName": "openscout-haydn",
            "body": "running",
            "createdAt": 1710000000000,
            "class": "status",
            "metadata": {
              "flightId": "flt-session"
            }
          },
          {
            "id": "msg-operator",
            "conversationId": "chn-1",
            "actorId": "operator",
            "actorName": "Operator",
            "body": "start",
            "createdAt": 1710000000001,
            "class": "operator",
            "metadata": {
              "flightId": "flt-session"
            }
          }
        ]
        """

        let messages = try JSONDecoder().decode([ScoutMessage].self, from: Data(json.utf8))

        XCTAssertEqual(messages.count, 2)
        XCTAssertFalse(messages[0].completesPendingConversation(messageId: nil, flightId: "flt-session"))
        XCTAssertFalse(messages[1].completesPendingConversation(messageId: nil, flightId: "flt-session"))
    }
}
