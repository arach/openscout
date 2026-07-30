import Foundation
@testable import ScoutAppCore
import XCTest

final class ScoutServerLogStoreTests: XCTestCase {
    func testSupportDirectoryRespectsExplicitEnvironment() {
        let resolved = ScoutSupportDirectory.url(
            environment: ["OPENSCOUT_SUPPORT_DIRECTORY": "/tmp/scout-support"],
            homeDirectory: URL(fileURLWithPath: "/tmp/home")
        )

        XCTAssertEqual(resolved.path, "/tmp/scout-support")
    }

    func testBrokerLogReaderOnlyUsesCanonicalBrokerFiles() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-server-log-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let broker = root
            .appendingPathComponent("logs", isDirectory: true)
            .appendingPathComponent("broker", isDirectory: true)
        try FileManager.default.createDirectory(at: broker, withIntermediateDirectories: true)
        try Data("ready\nserving\n".utf8).write(to: broker.appendingPathComponent("stdout.log"))
        try Data("failed to bind\n".utf8).write(to: broker.appendingPathComponent("stderr.log"))

        let output = try ScoutServerLogReader.read(stream: .output, supportDirectory: root)
        let errors = try ScoutServerLogReader.read(stream: .errors, supportDirectory: root)

        XCTAssertEqual(output.fileURL.path, broker.appendingPathComponent("stdout.log").path)
        XCTAssertEqual(output.lines.map(\.text), ["ready", "serving"])
        XCTAssertEqual(errors.lines.map(\.text), ["failed to bind"])
        XCTAssertEqual(errors.lines.first?.level, .error)
    }

    func testBoundedDecodeDropsPartialLeadingLineAndKeepsAbsoluteOffsets() {
        let lines = ScoutServerLogReader.decodeLines(
            Data("partial\nfirst\nsecond\n".utf8),
            stream: .output,
            startOffset: 100,
            startsMidFile: true,
            maxLines: 10
        )

        XCTAssertEqual(lines.map(\.text), ["first", "second"])
        XCTAssertEqual(lines.map(\.offset), [108, 114])
        XCTAssertEqual(lines.map(\.id), ["output:108", "output:114"])
    }

    func testDecodeKeepsOnlyRequestedTailLines() {
        let lines = ScoutServerLogReader.decodeLines(
            Data("one\ntwo\nthree\n".utf8),
            stream: .output,
            startOffset: 0,
            startsMidFile: false,
            maxLines: 2
        )

        XCTAssertEqual(lines.map(\.text), ["two", "three"])
    }
}
