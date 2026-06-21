import Foundation
@testable import ScoutAppCore
import XCTest

final class ScoutTailEventMetadataTests: XCTestCase {
    func testGrokStreamingTextIsLowSignalMetadata() {
        XCTAssertTrue(event(source: "grok", kind: .system, summary: "phase · streaming_text").isLowSignalMetadata)
        XCTAssertTrue(event(source: "grok", kind: .system, summary: "phase · streaming_reasoning").isLowSignalMetadata)
        XCTAssertTrue(event(source: "grok", kind: .system, summary: "phase · tool_execution").isLowSignalMetadata)
        XCTAssertTrue(event(source: "grok", kind: .system, summary: "first token").isLowSignalMetadata)
        XCTAssertTrue(event(source: "grok", kind: .system, summary: "loop 12").isLowSignalMetadata)
    }

    func testGrokWorkEventsStayVisible() {
        XCTAssertFalse(event(source: "grok", kind: .tool, summary: "Read started").isLowSignalMetadata)
        XCTAssertFalse(event(source: "grok", kind: .assistant, summary: "Updated the implementation").isLowSignalMetadata)
    }

    func testCodexQuietRowsAreLowSignalMetadata() {
        XCTAssertTrue(event(source: "codex", kind: .system, summary: "user_message").isLowSignalMetadata)
        XCTAssertTrue(event(source: "codex", kind: .system, summary: "agent_message").isLowSignalMetadata)
        XCTAssertTrue(event(source: "codex", kind: .system, summary: "turn context · gpt-5.5 · xhigh").isLowSignalMetadata)
        XCTAssertTrue(event(source: "codex", kind: .system, summary: "tokens · 104453775").isLowSignalMetadata)
        XCTAssertTrue(event(source: "codex", kind: .system, summary: "session 019ee5f2 · /Users/arach/dev/openscout").isLowSignalMetadata)
        XCTAssertTrue(event(source: "codex", kind: .toolResult, summary: "-> Chunk ID: abc\nWall time: 0.1 seconds").isLowSignalMetadata)
    }

    func testCodexSubstantiveRowsStayVisible() {
        XCTAssertFalse(event(source: "codex", kind: .user, summary: "do we have a solution?").isLowSignalMetadata)
        XCTAssertFalse(event(source: "codex", kind: .assistant, summary: "I found the issue.").isLowSignalMetadata)
        XCTAssertFalse(event(source: "codex", kind: .tool, summary: #"exec_command({"cmd":"git status"})"#).isLowSignalMetadata)
        XCTAssertFalse(event(source: "codex", kind: .system, summary: "task started").isLowSignalMetadata)
    }

    private func event(
        source: String,
        kind: ScoutTailEventKind,
        summary: String
    ) -> ScoutTailEvent {
        ScoutTailEvent(
            id: UUID().uuidString,
            ts: 1_781_991_912_000,
            source: source,
            sessionId: "session-1",
            pid: 123,
            parentPid: nil,
            project: "openscout",
            cwd: "/Users/arach/dev/openscout",
            harness: "unattributed",
            kind: kind,
            summary: summary
        )
    }
}
