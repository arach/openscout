import Foundation
import XCTest

@testable import ScoutApp

final class TurnHashTests: XCTestCase {
    func testHashMatchesForEquivalentBlockContent() {
        let lhs = TurnState(
            id: "turn-a",
            status: .completed,
            blocks: [
                BlockState(
                    block: Block(
                        id: "block-a",
                        turnId: "turn-a",
                        type: .text,
                        status: .completed,
                        index: 0,
                        text: "Ship it"
                    ),
                    status: .completed
                ),
            ],
            startedAt: 1
        )

        let rhs = TurnState(
            id: "turn-b",
            status: .completed,
            blocks: [
                BlockState(
                    block: Block(
                        id: "block-b",
                        turnId: "turn-b",
                        type: .text,
                        status: .completed,
                        index: 99,
                        text: "Ship it"
                    ),
                    status: .completed
                ),
            ],
            startedAt: 2
        )

        XCTAssertEqual(TurnHash.compute(for: lhs), TurnHash.compute(for: rhs))
    }

    func testHashChangesWhenBlockContentChanges() {
        let lhs = TurnState(
            id: "turn-a",
            status: .completed,
            blocks: [
                BlockState(
                    block: Block(
                        id: "block-a",
                        turnId: "turn-a",
                        type: .text,
                        status: .completed,
                        index: 0,
                        text: "Old text"
                    ),
                    status: .completed
                ),
            ],
            startedAt: 1
        )

        let rhs = TurnState(
            id: "turn-a",
            status: .completed,
            blocks: [
                BlockState(
                    block: Block(
                        id: "block-a",
                        turnId: "turn-a",
                        type: .text,
                        status: .completed,
                        index: 0,
                        text: "New text"
                    ),
                    status: .completed
                ),
            ],
            startedAt: 1
        )

        XCTAssertNotEqual(TurnHash.compute(for: lhs), TurnHash.compute(for: rhs))
    }

    func testLatestTurnComparisonUsesTurnIdentityAndHash() {
        let turn = TurnState(
            id: "turn-a",
            status: .completed,
            blocks: [
                BlockState(
                    block: Block(
                        id: "block-a",
                        turnId: "turn-a",
                        type: .text,
                        status: .completed,
                        index: 0,
                        text: "Still synced"
                    ),
                    status: .completed
                ),
            ],
            startedAt: 1
        )

        let local = SessionState(
            session: Session(id: "session-1", name: "Test", adapterType: "codex", status: .active),
            turns: [turn],
            currentTurnId: nil
        )

        let sameRemote = SessionState(
            session: Session(id: "session-1", name: "Test", adapterType: "codex", status: .active),
            turns: [turn],
            currentTurnId: nil
        )

        let differentRemote = SessionState(
            session: Session(id: "session-1", name: "Test", adapterType: "codex", status: .active),
            turns: [
                TurnState(
                    id: "turn-b",
                    status: .completed,
                    blocks: turn.blocks,
                    startedAt: 1
                ),
            ],
            currentTurnId: nil
        )

        XCTAssertTrue(TurnHash.latestTurnsMatch(local: local, remote: sameRemote))
        XCTAssertFalse(TurnHash.latestTurnsMatch(local: local, remote: differentRemote))
    }
}
