import Foundation
import ScoutCapabilities
import XCTest
@testable import ScoutIOSCore

final class OutboundDraftStoreTests: XCTestCase {
    func testPersistsAttachmentBytesAndStableClientId() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-outbox-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = OutboundDraftStore(directoryURL: directory)
        let draft = OutboundDraftRecord(
            id: "ios-stable-id",
            conversationId: "conversation-1",
            body: "Please continue",
            attachments: [
                AttachmentUpload(
                    data: Data([0x00, 0x7f, 0xff]),
                    mediaType: "image/jpeg",
                    fileName: "photo.jpg"
                ),
            ],
            createdAt: Date(timeIntervalSince1970: 123)
        )

        try await store.save(draft)

        let restored = try await store.latest(conversationId: "conversation-1")
        XCTAssertEqual(restored, draft)

        try await store.remove(id: draft.id)
        let removed = try await store.latest(conversationId: "conversation-1")
        XCTAssertNil(removed)
    }

    func testIgnoresCorruptDraftFiles() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-outbox-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not a plist".utf8).write(
            to: directory.appendingPathComponent("corrupt.outbound")
        )

        let drafts = try await OutboundDraftStore(directoryURL: directory).all()
        XCTAssertTrue(drafts.isEmpty)
    }
}
