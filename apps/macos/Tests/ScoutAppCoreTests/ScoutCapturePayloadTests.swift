import Foundation
@testable import ScoutAppCore
import XCTest

final class ScoutCapturePayloadTests: XCTestCase {
    func testPayloadRoundTripsOnce() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-capture-payload-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let payload = ScoutCapturePayload(
            corner: "bottom-left",
            displayID: 42,
            filePaths: ["/repo/README.md", "/repo/Sources"],
            attachments: [
                .init(data: Data([0x89, 0x50, 0x4E, 0x47]), mediaType: "image/png", fileName: "shot.png"),
            ],
            text: "Fix the highlighted regression"
        )

        let token = try ScoutCapturePayloadStore.save(payload, directory: directory)
        XCTAssertNotNil(UUID(uuidString: token))
        XCTAssertEqual(try ScoutCapturePayloadStore.take(token: token, directory: directory), payload)
        XCTAssertThrowsError(try ScoutCapturePayloadStore.take(token: token, directory: directory)) { error in
            XCTAssertEqual(error as? ScoutCapturePayloadStoreError, .missingPayload)
        }
    }

    func testPayloadStoreRejectsPathLikeToken() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-capture-payload-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        XCTAssertThrowsError(try ScoutCapturePayloadStore.take(token: "../payload", directory: directory)) { error in
            XCTAssertEqual(error as? ScoutCapturePayloadStoreError, .invalidToken)
        }
    }

    func testPayloadReadSurvivesUntilAcknowledgedDiscard() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-capture-payload-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let payload = ScoutCapturePayload(text: "survive launch handoff")
        let token = try ScoutCapturePayloadStore.save(payload, directory: directory)
        XCTAssertEqual(try ScoutCapturePayloadStore.read(token: token, directory: directory), payload)
        XCTAssertEqual(try ScoutCapturePayloadStore.read(token: token, directory: directory), payload)
        try ScoutCapturePayloadStore.discard(token: token, directory: directory)
        XCTAssertThrowsError(try ScoutCapturePayloadStore.read(token: token, directory: directory)) { error in
            XCTAssertEqual(error as? ScoutCapturePayloadStoreError, .missingPayload)
        }
    }

    func testExpiredAndMalformedPayloadsCannotReplay() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-capture-payload-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let expired = ScoutCapturePayload(
            createdAt: Date().addingTimeInterval(-(25 * 60 * 60)),
            text: "old"
        )
        let expiredToken = try ScoutCapturePayloadStore.save(expired, directory: directory)
        XCTAssertThrowsError(try ScoutCapturePayloadStore.take(token: expiredToken, directory: directory)) { error in
            XCTAssertEqual(error as? ScoutCapturePayloadStoreError, .missingPayload)
        }
        XCTAssertThrowsError(try ScoutCapturePayloadStore.take(token: expiredToken, directory: directory)) { error in
            XCTAssertEqual(error as? ScoutCapturePayloadStoreError, .missingPayload)
        }

        let malformedToken = UUID().uuidString.lowercased()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not json".utf8).write(
            to: directory.appendingPathComponent(malformedToken).appendingPathExtension("json")
        )
        XCTAssertThrowsError(try ScoutCapturePayloadStore.take(token: malformedToken, directory: directory))
        XCTAssertThrowsError(try ScoutCapturePayloadStore.take(token: malformedToken, directory: directory)) { error in
            XCTAssertEqual(error as? ScoutCapturePayloadStoreError, .missingPayload)
        }
    }

    func testPayloadStoreRejectsOversizedText() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-capture-payload-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let payload = ScoutCapturePayload(
            text: String(repeating: "x", count: ScoutCapturePayloadStore.maximumTextBytes + 1)
        )
        XCTAssertThrowsError(try ScoutCapturePayloadStore.save(payload, directory: directory)) { error in
            XCTAssertEqual(error as? ScoutCapturePayloadStoreError, .payloadTooLarge)
        }
    }

    func testPromiseStagingDirectoryIsPrivateAndExpires() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-promise-staging-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let destination = try ScoutCapturePayloadStore.makePromiseStagingDirectory(directory: root)
        XCTAssertEqual(destination.deletingLastPathComponent(), root)
        XCTAssertEqual(destination.pathExtension, "promise")
        let attributes = try FileManager.default.attributesOfItem(atPath: destination.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o700)

        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(-(8 * 24 * 60 * 60))],
            ofItemAtPath: destination.path
        )
        try ScoutCapturePayloadStore.cleanupExpired(directory: root)
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
    }

    func testHUDCommandInboxPersistsUntilAcknowledged() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-hud-inbox-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let firstDate = Date().addingTimeInterval(-1)
        let firstID = try ScoutHUDCommandInbox.enqueue(
            command: "task",
            value: "bottom-left@42",
            directory: directory,
            now: firstDate
        )
        let secondID = try ScoutHUDCommandInbox.enqueue(
            command: "task-capture",
            value: "token",
            directory: directory
        )

        let pending = try ScoutHUDCommandInbox.pending(directory: directory)
        XCTAssertEqual(pending.map(\.id), [firstID, secondID])
        XCTAssertEqual(pending.first?.value, "bottom-left@42")

        try ScoutHUDCommandInbox.acknowledge(firstID, directory: directory)
        XCTAssertEqual(try ScoutHUDCommandInbox.pending(directory: directory).map(\.id), [secondID])
        try ScoutHUDCommandInbox.acknowledge(secondID, directory: directory)
        XCTAssertTrue(try ScoutHUDCommandInbox.pending(directory: directory).isEmpty)
    }

    func testDeferredCaptureKeepsItsPayloadThroughInboxAcknowledgement() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-deferred-capture-tests-\(UUID().uuidString)", isDirectory: true)
        let payloadDirectory = root.appendingPathComponent("payloads", isDirectory: true)
        let inboxDirectory = root.appendingPathComponent("inbox", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let payload = ScoutCapturePayload(text: "queued while another task is submitting")
        let token = try ScoutCapturePayloadStore.save(payload, directory: payloadDirectory)
        let commandID = try ScoutHUDCommandInbox.enqueue(
            command: "task-capture",
            value: token,
            directory: inboxDirectory
        )

        // A deferred drain is non-destructive: both the command and its payload
        // remain available for the next retry.
        XCTAssertEqual(try ScoutHUDCommandInbox.pending(directory: inboxDirectory).map(\.id), [commandID])
        XCTAssertEqual(try ScoutCapturePayloadStore.read(token: token, directory: payloadDirectory), payload)
        XCTAssertEqual(try ScoutHUDCommandInbox.pending(directory: inboxDirectory).map(\.id), [commandID])
        XCTAssertEqual(try ScoutCapturePayloadStore.read(token: token, directory: payloadDirectory), payload)

        // Acknowledge the durable command first. The payload remains readable
        // across that boundary until the consumer explicitly finalizes it.
        try ScoutHUDCommandInbox.acknowledge(commandID, directory: inboxDirectory)
        XCTAssertTrue(try ScoutHUDCommandInbox.pending(directory: inboxDirectory).isEmpty)
        XCTAssertEqual(try ScoutCapturePayloadStore.read(token: token, directory: payloadDirectory), payload)

        try ScoutCapturePayloadStore.discard(token: token, directory: payloadDirectory)
        XCTAssertThrowsError(try ScoutCapturePayloadStore.read(token: token, directory: payloadDirectory)) { error in
            XCTAssertEqual(error as? ScoutCapturePayloadStoreError, .missingPayload)
        }
    }
}
