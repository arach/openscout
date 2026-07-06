@testable import ScoutAppCore
import XCTest

final class ScoutAttentionTrackerTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    private func at(_ seconds: TimeInterval) -> Date {
        t0.addingTimeInterval(seconds)
    }

    private func agent(_ id: String, attention: Bool, cId: String? = nil, project: String? = nil) -> ScoutAgent {
        var fields = ["\"id\": \"\(id)\"", "\"state\": \"\(attention ? "needs-attention" : "working")\""]
        if let cId { fields.append("\"conversationId\": \"\(cId)\"") }
        if let project { fields.append("\"project\": \"\(project)\"") }
        let json = "{\(fields.joined(separator: ","))}"
        // swiftlint:disable:next force_try
        return try! JSONDecoder().decode(ScoutAgent.self, from: Data(json.utf8))
    }

    func testBaselineSnapshotNeverNotifies() {
        var tracker = ScoutAttentionTracker()
        let update = tracker.ingest(agents: [agent("a", attention: true)], at: at(0))
        XCTAssertTrue(update.notify.isEmpty)
        XCTAssertTrue(update.resolvedAgentIds.isEmpty)
        XCTAssertEqual(update.attentionCount, 1)
    }

    func testBaselineAgentNeverFiresAndNeverResolves() {
        var tracker = ScoutAttentionTracker()
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(0))
        let sustained = tracker.ingest(agents: [agent("a", attention: true)], at: at(100))
        XCTAssertTrue(sustained.notify.isEmpty)
        let left = tracker.ingest(agents: [agent("a", attention: false)], at: at(101))
        XCTAssertTrue(left.notify.isEmpty)
        XCTAssertTrue(left.resolvedAgentIds.isEmpty)
        XCTAssertEqual(left.attentionCount, 0)
    }

    func testSubDebounceFlapIsSilent() {
        var tracker = ScoutAttentionTracker()
        _ = tracker.ingest(agents: [], at: at(0))
        let entered = tracker.ingest(agents: [agent("a", attention: true)], at: at(0.5))
        XCTAssertTrue(entered.notify.isEmpty)
        let left = tracker.ingest(agents: [], at: at(1.0))
        XCTAssertTrue(left.notify.isEmpty)
        XCTAssertTrue(left.resolvedAgentIds.isEmpty)
    }

    func testSustainedEntryFiresOnce() {
        var tracker = ScoutAttentionTracker()
        _ = tracker.ingest(agents: [], at: at(0))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(1))
        let matured = tracker.ingest(agents: [agent("a", attention: true)], at: at(5))
        XCTAssertEqual(matured.notify.map(\.id), ["a"])
        let again = tracker.ingest(agents: [agent("a", attention: true)], at: at(7))
        XCTAssertTrue(again.notify.isEmpty)
    }

    func testReEntryWithinCooldownIsSilentButCounted() {
        var tracker = ScoutAttentionTracker()
        _ = tracker.ingest(agents: [], at: at(0))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(1))
        let matured = tracker.ingest(agents: [agent("a", attention: true)], at: at(5))
        XCTAssertEqual(matured.notify.map(\.id), ["a"])
        let left = tracker.ingest(agents: [agent("a", attention: false)], at: at(6))
        XCTAssertEqual(left.resolvedAgentIds, ["a"])
        let reentered = tracker.ingest(agents: [agent("a", attention: true)], at: at(10))
        XCTAssertTrue(reentered.notify.isEmpty)
        XCTAssertEqual(reentered.attentionCount, 1)
        let stillWaiting = tracker.ingest(agents: [agent("a", attention: true)], at: at(20))
        XCTAssertTrue(stillWaiting.notify.isEmpty)
        XCTAssertEqual(stillWaiting.attentionCount, 1)
    }

    func testReEntryAfterCooldownFiresAgain() {
        var tracker = ScoutAttentionTracker(debounce: 3.0, refireCooldown: 90)
        _ = tracker.ingest(agents: [], at: at(0))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(1))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(5))
        _ = tracker.ingest(agents: [agent("a", attention: false)], at: at(6))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(200))
        let matured = tracker.ingest(agents: [agent("a", attention: true)], at: at(210))
        XCTAssertEqual(matured.notify.map(\.id), ["a"])
    }

    func testResolveOnExit() {
        var tracker = ScoutAttentionTracker()
        _ = tracker.ingest(agents: [], at: at(0))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(1))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(5))
        let left = tracker.ingest(agents: [agent("a", attention: false)], at: at(6))
        XCTAssertEqual(left.resolvedAgentIds, ["a"])
        XCTAssertEqual(left.attentionCount, 0)
    }

    func testResolveOnDisappearance() {
        var tracker = ScoutAttentionTracker()
        _ = tracker.ingest(agents: [], at: at(0))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(1))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(5))
        let vanished = tracker.ingest(agents: [], at: at(6))
        XCTAssertEqual(vanished.resolvedAgentIds, ["a"])
        XCTAssertEqual(vanished.attentionCount, 0)
    }

    func testUnannouncedExitDoesNotResolve() {
        var tracker = ScoutAttentionTracker()
        _ = tracker.ingest(agents: [], at: at(0))
        _ = tracker.ingest(agents: [agent("a", attention: true)], at: at(1))
        let left = tracker.ingest(agents: [], at: at(2))
        XCTAssertTrue(left.resolvedAgentIds.isEmpty)
    }

    func testCoalescesAgentsMaturingTogether() {
        var tracker = ScoutAttentionTracker()
        _ = tracker.ingest(agents: [], at: at(0))
        _ = tracker.ingest(agents: [agent("a", attention: true), agent("b", attention: true)], at: at(1))
        let matured = tracker.ingest(agents: [agent("a", attention: true), agent("b", attention: true)], at: at(5))
        XCTAssertEqual(Set(matured.notify.map(\.id)), ["a", "b"])
        XCTAssertEqual(matured.notify.count, 2)
    }

    func testAttentionCountTracksLevel() {
        var tracker = ScoutAttentionTracker()
        let baseline = tracker.ingest(agents: [agent("a", attention: true), agent("b", attention: true)], at: at(0))
        XCTAssertEqual(baseline.attentionCount, 2)
        let one = tracker.ingest(agents: [agent("a", attention: true), agent("b", attention: false)], at: at(1))
        XCTAssertEqual(one.attentionCount, 1)
        let none = tracker.ingest(agents: [agent("a", attention: false), agent("b", attention: false)], at: at(2))
        XCTAssertEqual(none.attentionCount, 0)
    }
}
