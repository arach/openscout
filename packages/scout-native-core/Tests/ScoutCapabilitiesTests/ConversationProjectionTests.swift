// ConversationProjection contract fixtures (SCO-061 Phase 2).
//
// Recorded event streams → expected projection states. These are the guardrail
// that keeps the macOS and iOS reductions from drifting: any adapter that
// decodes the wire into `ScoutEvent` and feeds this reducer must land on the
// same `SessionState`.

import XCTest
@testable import ScoutCapabilities

final class ConversationProjectionTests: XCTestCase {

    private func session(_ id: String = "s.1") -> Session {
        Session(id: id, name: "Demo", adapterType: "claude", status: .active)
    }

    // A full turn reduces to a completed turn with concatenated text deltas.
    func testStreamingTextTurnReduces() {
        var p = ConversationProjection()
        p.apply(.sessionUpdate(session: session()))
        p.apply(.turnStart(sessionId: "s.1", turn: Turn(id: "t1", sessionId: "s.1", status: .streaming, startedAt: "100", isUserTurn: false)))
        p.apply(.blockStart(sessionId: "s.1", turnId: "t1", block: Block(id: "b1", turnId: "t1", type: .text, status: .streaming, index: 0, text: "")))
        p.apply(.blockDelta(sessionId: "s.1", turnId: "t1", blockId: "b1", text: "Hello"))
        p.apply(.blockDelta(sessionId: "s.1", turnId: "t1", blockId: "b1", text: ", world"))
        p.apply(.blockEnd(sessionId: "s.1", turnId: "t1", blockId: "b1", status: .completed))
        p.apply(.turnEnd(sessionId: "s.1", turnId: "t1", status: .completed))

        let state = try! XCTUnwrap(p.state)
        XCTAssertEqual(state.turns.count, 1)
        XCTAssertEqual(state.turns[0].status, .completed)
        XCTAssertNil(state.currentTurnId)
        XCTAssertEqual(state.turns[0].blocks.count, 1)
        XCTAssertEqual(state.turns[0].blocks[0].block.text, "Hello, world")
        XCTAssertEqual(state.turns[0].blocks[0].status, .completed)
    }

    // Action output accumulates and status flips are applied in place.
    func testActionOutputAndStatus() {
        var p = ConversationProjection()
        p.apply(.sessionUpdate(session: session()))
        p.apply(.turnStart(sessionId: "s.1", turn: Turn(id: "t1", sessionId: "s.1", status: .streaming, startedAt: "0")))
        let action = Action(kind: .command, status: .running, command: "ls")
        p.apply(.blockStart(sessionId: "s.1", turnId: "t1", block: Block(id: "b1", turnId: "t1", type: .action, status: .streaming, index: 0, action: action)))
        p.apply(.blockActionOutput(sessionId: "s.1", turnId: "t1", blockId: "b1", output: "a\n"))
        p.apply(.blockActionOutput(sessionId: "s.1", turnId: "t1", blockId: "b1", output: "b\n"))
        p.apply(.blockActionStatus(sessionId: "s.1", turnId: "t1", blockId: "b1", status: .completed, meta: nil))

        let block = try! XCTUnwrap(p.state?.turns.first?.blocks.first?.block)
        XCTAssertEqual(block.action?.output, "a\nb\n")
        XCTAssertEqual(block.action?.status, .completed)
    }

    // Seq tracking: replay events advance lastAppliedSeq; seq 0 pushes do not.
    func testSeqCursorAdvances() {
        var p = ConversationProjection()
        p.apply(SequencedEvent(seq: 0, event: .sessionUpdate(session: session())))
        XCTAssertEqual(p.lastAppliedSeq, 0)
        p.apply(SequencedEvent(seq: 5, event: .turnStart(sessionId: "s.1", turn: Turn(id: "t1", sessionId: "s.1", status: .streaming, startedAt: "0"))))
        XCTAssertEqual(p.lastAppliedSeq, 5)
        // A stale, lower seq must not roll the cursor back.
        p.apply(SequencedEvent(seq: 3, event: .turnEnd(sessionId: "s.1", turnId: "t1", status: .completed)))
        XCTAssertEqual(p.lastAppliedSeq, 5)
    }

    // Snapshot recovery replaces the projection wholesale, then live events
    // continue to reduce on top of it.
    func testSnapshotRecoveryThenLiveEvents() {
        var p = ConversationProjection()
        let recovered = SessionState(
            session: session(),
            turns: [TurnState(id: "old", status: .completed, blocks: [], startedAt: 0)],
            currentTurnId: nil
        )
        p.applySnapshot(recovered)
        XCTAssertEqual(p.state?.turns.count, 1)

        p.apply(.turnStart(sessionId: "s.1", turn: Turn(id: "new", sessionId: "s.1", status: .streaming, startedAt: "10")))
        XCTAssertEqual(p.state?.turns.count, 2)
        XCTAssertEqual(p.state?.currentTurnId, "new")
    }

    // Unknown discriminators are ignored (forward compatibility).
    func testUnknownEventIgnored() {
        var p = ConversationProjection()
        p.apply(.sessionUpdate(session: session()))
        p.apply(.unknown(discriminator: "block:future:thing"))
        XCTAssertNotNil(p.state)
        XCTAssertEqual(p.state?.turns.count, 0)
    }

    // The event wire format round-trips through Codable (adapter contract).
    func testEventRoundTrips() throws {
        let events: [ScoutEvent] = [
            .turnStart(sessionId: "s", turn: Turn(id: "t", sessionId: "s", status: .streaming, startedAt: "1")),
            .blockDelta(sessionId: "s", turnId: "t", blockId: "b", text: "hi"),
            .turnEnd(sessionId: "s", turnId: "t", status: .completed),
        ]
        let enc = JSONEncoder()
        let dec = JSONDecoder()
        for event in events {
            let data = try enc.encode(SequencedEvent(seq: 1, event: event))
            let back = try dec.decode(SequencedEvent.self, from: data)
            // Reduce both and compare resulting state to assert semantic equality.
            var a = ConversationProjection(); a.apply(.sessionUpdate(session: session("s"))); a.apply(event)
            var b = ConversationProjection(); b.apply(.sessionUpdate(session: session("s"))); b.apply(back.event)
            XCTAssertEqual(a.state, b.state)
        }
    }
}
