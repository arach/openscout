import Foundation
import XCTest
import ScoutCapabilities
@testable import ScoutIOSCore

/// The ledger is the only place in the app that infers state from ABSENCE — an
/// item missing from a Mac's live inbox is what settles a pending entry. These
/// cover the inferences that would be expensive to get wrong: mass-settling a
/// live queue, duplicating a pushed alert, resurrecting a decision we made, or
/// naming an outcome we never witnessed.
@MainActor
final class NotificationsLedgerTests: XCTestCase {

    private func makeStore() -> NotificationsStore {
        // No file URL — the ledger runs entirely in memory for tests, so a run
        // never touches (or inherits) the real device ledger.
        NotificationsStore(fileURL: nil)
    }

    private func item(
        id: String,
        kind: String = "approval",
        sessionId: String = "s1",
        turnId: String? = "t1",
        blockId: String? = "b1",
        version: Int? = 1,
        createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        title: String = "Run rm -rf .build",
        description: String = "Delete resolved checkouts.",
        detail: String? = "rm -rf .build"
    ) -> MobileNotificationItem {
        MobileNotificationItem(
            id: id,
            kind: kind,
            createdAt: createdAt,
            sessionId: sessionId,
            sessionName: "broker-smith",
            adapterType: "claude-code",
            turnId: turnId,
            blockId: blockId,
            version: version,
            risk: "medium",
            title: title,
            description: description,
            detail: detail
        )
    }

    // MARK: - Ingest

    func testIngestCapturesLiveItemsAsUnseenAndOpen() {
        let store = makeStore()
        store.ingest([item(id: "a1"), item(id: "a2")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries.count, 2)
        XCTAssertEqual(store.openCount, 2)
        XCTAssertEqual(store.unseenCount, 2)
        XCTAssertTrue(store.entries.allSatisfy { $0.machineName == "studio" })
    }

    func testIngestRefreshesContentWithoutLosingReadState() {
        let store = makeStore()
        store.ingest([item(id: "a1", title: "Run bun test")], machineId: "mac1", machineName: "studio")
        let id = store.entries[0].id
        store.markSeen(id: id)

        store.ingest([item(id: "a1", title: "Run bun test --coverage")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries[0].title, "Run bun test --coverage")
        XCTAssertFalse(store.entries[0].isUnseen)
    }

    /// The whole point of the ledger: an item the Mac stops reporting is KEPT,
    /// marked with how it ended rather than deleted.
    func testAbsentItemSettlesInsteadOfDisappearing() {
        let store = makeStore()
        store.ingest([item(id: "a1"), item(id: "a2", kind: "failed_action", version: nil)],
                     machineId: "mac1", machineName: "studio")

        store.ingest([], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries.count, 2)
        XCTAssertEqual(store.openCount, 0)
        // An approval that vanished was settled by someone else — never claimed
        // as our decision. A failure that stopped being reported just cleared.
        XCTAssertEqual(store.entry(matchingItemId: "a1")?.state, .resolved)
        XCTAssertEqual(store.entry(matchingItemId: "a2")?.state, .cleared)
        XCTAssertNotNil(store.entry(matchingItemId: "a1")?.settledAt)
    }

    /// A second Mac's read must not settle the first Mac's queue.
    func testIngestOnlySettlesTheMachineItPolled() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        store.ingest([item(id: "b1", sessionId: "s2")], machineId: "mac2", machineName: "mini")

        store.ingest([], machineId: "mac2", machineName: "mini")

        XCTAssertEqual(store.entry(matchingItemId: "a1")?.state, .pending)
        XCTAssertEqual(store.entry(matchingItemId: "b1")?.state, .resolved)
    }

    func testSameItemIdOnTwoMachinesStaysTwoEntries() {
        let store = makeStore()
        store.ingest([item(id: "shared")], machineId: "mac1", machineName: "studio")
        store.ingest([item(id: "shared")], machineId: "mac2", machineName: "mini")

        XCTAssertEqual(store.entries.count, 2)
        XCTAssertEqual(Set(store.entries.map(\.machineId)), ["mac1", "mac2"])
    }

    // MARK: - Outcomes

    func testDecisionMadeHereIsNamedAndSurvivesTheNextPoll() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        let id = store.entries[0].id

        store.record(.approved, id: id)
        // The Mac still reports it for one more poll (the decision is in flight).
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entry(id: id)?.state, .approved)
        XCTAssertTrue(store.entry(id: id)?.state.isOurDecision == true)
        XCTAssertFalse(store.entry(id: id)?.isUnseen == true)
    }

    /// An entry we merely INFERRED settled goes back in the queue when the Mac
    /// proves it is still pending — the inference was ours, so it yields.
    func testInferredSettleIsReversedByAliveItem() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        store.ingest([], machineId: "mac1", machineName: "studio")
        XCTAssertEqual(store.entry(matchingItemId: "a1")?.state, .resolved)

        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entry(matchingItemId: "a1")?.state, .pending)
        XCTAssertNil(store.entry(matchingItemId: "a1")?.settledAt)
    }

    func testOnlyDecisionsWeMadeCanBeRecorded() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        let id = store.entries[0].id

        store.record(.resolved, id: id)

        XCTAssertEqual(store.entry(id: id)?.state, .pending)
    }

    // MARK: - Push stubs

    func testPushStubIsAdoptedByTheMachineThatReportsItLive() {
        let store = makeStore()
        store.recordPush(kind: "approval", itemId: "a1", sessionId: "s1", turnId: "t1", blockId: "b1")
        let stubId = store.entries[0].id
        store.markSeen(id: stubId)
        let arrived = store.entries[0].arrivedAt

        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries.count, 1, "the stub must be adopted, not duplicated")
        let entry = try! XCTUnwrap(store.entry(matchingItemId: "a1"))
        XCTAssertEqual(entry.machineId, "mac1")
        XCTAssertEqual(entry.title, "Run rm -rf .build", "content fills in from the Mac")
        XCTAssertEqual(entry.arrivedAt, arrived, "when it reached the phone is preserved")
        XCTAssertFalse(entry.isUnseen, "read state is preserved")
    }

    func testPushIsNotRecordedTwice() {
        let store = makeStore()
        store.recordPush(kind: "approval", itemId: "a1", sessionId: "s1", turnId: "t1", blockId: "b1")
        store.recordPush(kind: "approval", itemId: "a1", sessionId: "s1", turnId: "t1", blockId: "b1")

        XCTAssertEqual(store.entries.count, 1)
    }

    /// A stub inside the grace window is racing the poll, not gone — settling it
    /// there would flip an alert to "resolved" seconds after it arrived.
    func testUnclaimedStubIsSpotedThenSettledAfterGrace() {
        let store = makeStore()
        let arrival = Date()
        store.recordPush(kind: "approval", itemId: "a1", sessionId: "s1", turnId: "t1", blockId: "b1", now: arrival)

        store.settleUnclaimedStubs(now: arrival.addingTimeInterval(10))
        XCTAssertEqual(store.entries[0].state, .pending)

        store.settleUnclaimedStubs(now: arrival.addingTimeInterval(120))
        XCTAssertEqual(store.entries[0].state, .resolved)
    }

    // MARK: - Read state

    func testMarkAllSeenClearsTheUnreadCount() {
        let store = makeStore()
        store.ingest([item(id: "a1"), item(id: "a2")], machineId: "mac1", machineName: "studio")
        XCTAssertEqual(store.unseenCount, 2)

        store.markAllSeen()

        XCTAssertEqual(store.unseenCount, 0)
    }

    func testScopesSplitOpenFromHistory() {
        let store = makeStore()
        store.ingest([item(id: "a1"), item(id: "a2")], machineId: "mac1", machineName: "studio")
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries(.open).count, 1)
        XCTAssertEqual(store.entries(.all).count, 2)
        XCTAssertEqual(store.entries(.archived).count, 0)
    }

    // MARK: - Agent attention (the channel Home reads)

    private func agent(
        id: String = "ag1",
        title: String = "broker-smith",
        conversationId: String? = "dm.operator.ag1",
        needsAttention: Bool = true,
        ask: PendingAsk? = PendingAsk(kind: .question, prompt: "which branch should I land on?")
    ) -> AgentSummary {
        AgentSummary(
            id: id,
            title: title,
            harness: "claude",
            state: .live,
            conversationId: conversationId,
            lastActiveAt: Date(),
            needsAttention: needsAttention,
            pendingAsk: ask
        )
    }

    /// The bug this closes: a collaboration ask shows on Home (which reads
    /// `needsAttention`) but never appears in `mobile/inbox`, so a ledger fed
    /// only by the inbox would be missing an alert the operator can see.
    func testFlaggedAgentsBecomeLedgerEntries() {
        let store = makeStore()
        store.ingestAgentAttention([agent()], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.openCount, 1)
        let entry = try! XCTUnwrap(store.entries.first)
        XCTAssertEqual(entry.source, .attention)
        XCTAssertEqual(entry.kind, "ask")
        XCTAssertTrue(entry.isConversationAsk, "its action is opening the thread")
        XCTAssertEqual(entry.sessionId, "dm.operator.ag1")
        XCTAssertEqual(entry.summary, "which branch should I land on?")
    }

    func testAgentsWithoutAttentionAreNotRecorded() {
        let store = makeStore()
        store.ingestAgentAttention(
            [agent(needsAttention: false, ask: nil)],
            machineId: "mac1",
            machineName: "studio"
        )

        XCTAssertTrue(store.entries.isEmpty)
    }

    /// A rephrased ask is the same demand — one row, not a new row per poll.
    func testRephrasedAskUpdatesInPlace() {
        let store = makeStore()
        store.ingestAgentAttention([agent()], machineId: "mac1", machineName: "studio")
        store.ingestAgentAttention(
            [agent(ask: PendingAsk(kind: .permission, prompt: "ok to force-push?"))],
            machineId: "mac1",
            machineName: "studio"
        )

        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries[0].summary, "ok to force-push?")
        XCTAssertEqual(store.entries[0].title, "broker-smith needs permission")
    }

    func testAgentThatStopsAskingSettlesUnnamed() {
        let store = makeStore()
        store.ingestAgentAttention([agent()], machineId: "mac1", machineName: "studio")

        store.ingestAgentAttention([], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries[0].state, .resolved)
        XCTAssertFalse(store.entries[0].state.isOurDecision)
    }

    /// The trap in reading two channels: an inbox poll knows nothing about an
    /// attention-sourced ask (and vice versa), so neither may settle the
    /// other's entries — that would clear live alerts every 30 seconds.
    func testChannelsDoNotSettleEachOther() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        store.ingestAgentAttention([agent()], machineId: "mac1", machineName: "studio")
        XCTAssertEqual(store.openCount, 2)

        // A full round where each channel reports only its own item.
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        store.ingestAgentAttention([agent()], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.openCount, 2)
        XCTAssertEqual(store.entry(matchingItemId: "a1")?.state, .pending)
        XCTAssertEqual(store.entry(matchingItemId: "agent-attention:ag1")?.state, .pending)
    }

    func testDismissedAskStaysDismissedWhileTheAgentKeepsAsking() {
        let store = makeStore()
        store.ingestAgentAttention([agent()], machineId: "mac1", machineName: "studio")
        store.dismiss(id: store.entries[0].id)

        store.ingestAgentAttention([agent()], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries[0].state, .dismissed)
        XCTAssertEqual(store.openCount, 0)
    }

    // MARK: - Dismiss

    /// Dismiss is triage, not an answer: it clears your queue and sends nothing,
    /// so it must never be labelled as a decision.
    func testDismissSettlesLocallyWithoutClaimingADecision() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        let id = store.entries[0].id

        store.dismiss(id: id)

        let entry = try! XCTUnwrap(store.entry(id: id))
        XCTAssertEqual(entry.state, .dismissed)
        XCTAssertFalse(entry.state.isOurDecision)
        XCTAssertTrue(entry.state.isOurs)
        XCTAssertEqual(NotificationsStore.stateQualifier(entry), "not answered")
        XCTAssertEqual(store.openCount, 0)
    }

    /// The failure that would make Dismiss useless: the Mac still reports the
    /// item every 30s, so a dismissal that doesn't stick means the alert climbs
    /// back into the queue forever.
    func testDismissedEntryDoesNotClimbBackIntoTheQueue() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        store.dismiss(id: store.entries[0].id)

        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entry(matchingItemId: "a1")?.state, .dismissed)
        XCTAssertEqual(store.openCount, 0)
    }

    // MARK: - Archive

    func testArchiveMovesAnEntryOutOfTheLogAndBack() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        store.ingest([], machineId: "mac1", machineName: "studio")
        let id = store.entries[0].id

        store.archive(id: id)

        XCTAssertEqual(store.entries(.all).count, 0)
        XCTAssertEqual(store.entries(.archived).count, 1)
        XCTAssertEqual(store.keptCount, 0)

        store.unarchive(id: id)

        XCTAssertEqual(store.entries(.all).count, 1)
        XCTAssertEqual(store.entries(.archived).count, 0)
    }

    /// Filing away something that is still waiting on you would hide a live
    /// demand — the exact failure this destination exists to prevent.
    func testOpenEntriesCannotBeArchived() {
        let store = makeStore()
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")

        store.archive(id: store.entries[0].id)

        XCTAssertFalse(store.entries[0].isArchived)
        XCTAssertEqual(store.openCount, 1)
    }

    func testArchivedEntriesNeverBadgeTheBell() {
        let store = makeStore()
        store.ingest([item(id: "a1"), item(id: "a2")], machineId: "mac1", machineName: "studio")
        store.ingest([], machineId: "mac1", machineName: "studio")
        XCTAssertEqual(store.unseenCount, 2)

        store.archive(id: store.entries[0].id)

        XCTAssertEqual(store.unseenCount, 1)
    }

    // MARK: - Retention

    func testSettledEntriesFallOutOfTheRetentionWindow() {
        let store = makeStore()
        let longAgo = Date().addingTimeInterval(-60 * 24 * 60 * 60)
        store.ingest([item(id: "stale")], machineId: "mac1", machineName: "studio", now: longAgo)
        store.ingest([], machineId: "mac1", machineName: "studio", now: longAgo.addingTimeInterval(60))
        XCTAssertEqual(store.entries.count, 1, "a settled entry stays until it ages out")

        store.ingest([item(id: "fresh")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries.map(\.itemId), ["fresh"])
    }

    /// Retention must never take something that is still waiting on you, no
    /// matter how long ago the turn behind it started.
    func testOpenEntriesAreNeverPruned() {
        let store = makeStore()
        let longAgo = Date().addingTimeInterval(-60 * 24 * 60 * 60)
        store.ingest([item(id: "ancient")], machineId: "mac1", machineName: "studio", now: longAgo)

        store.ingest([item(id: "ancient"), item(id: "fresh")], machineId: "mac1", machineName: "studio")

        XCTAssertEqual(store.entries.count, 2)
        XCTAssertEqual(store.entry(matchingItemId: "ancient")?.state, .pending)
    }

    // MARK: - Persistence

    func testLedgerSurvivesARelaunch() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("scout-ledger-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }

        let store = NotificationsStore(fileURL: url)
        store.ingest([item(id: "a1")], machineId: "mac1", machineName: "studio")
        store.markAllSeen()

        let reopened = NotificationsStore(fileURL: url)

        XCTAssertEqual(reopened.entries.count, 1)
        XCTAssertEqual(reopened.entries[0].itemId, "a1")
        XCTAssertEqual(reopened.unseenCount, 0)
    }
}
