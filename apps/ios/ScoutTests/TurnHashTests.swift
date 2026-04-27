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

    func testDroppingTrailingLocalOnlyUserTurnsRepairsFailedOptimisticSend() {
        let bridgeTurn = TurnState(
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
                        text: "Bridge state"
                    ),
                    status: .completed
                ),
            ],
            startedAt: 1
        )
        let failedLocalTurn = TurnState(
            id: "user-failed-send",
            status: .completed,
            blocks: [
                BlockState(
                    block: Block(
                        id: "block-local",
                        turnId: "user-failed-send",
                        type: .text,
                        status: .completed,
                        index: 0,
                        text: "testing 1, 2, 1, 2"
                    ),
                    status: .completed
                ),
            ],
            startedAt: 2,
            isUserTurn: true
        )
        let local = SessionState(
            session: Session(id: "session-1", name: "Test", adapterType: "codex", status: .active),
            turns: [bridgeTurn, failedLocalTurn],
            currentTurnId: nil
        )
        let remote = SessionState(
            session: Session(id: "session-1", name: "Test", adapterType: "codex", status: .active),
            turns: [bridgeTurn],
            currentTurnId: nil
        )

        let repairedLocal = TurnHash.droppingTrailingLocalOnlyUserTurns(from: local)

        XCTAssertTrue(TurnHash.latestTurnsMatch(local: repairedLocal, remote: remote))
    }
}

final class ScoutMarkdownParserTests: XCTestCase {
    func testParsesCommonChatMarkdownBlocks() {
        let markdown = """
        ## Plan

        - [x] Ship parser
          - [ ] Follow up
        1. Verify

        > Keep this readable
        > on mobile

        ~~~swift
        let value = 1
        ~~~

        | Name | State |
        | --- | :---: |
        | Parser | **Done** |
        """

        XCTAssertEqual(ScoutMarkdownParser.parse(markdown), [
            .heading(level: 2, text: "Plan"),
            .list([
                .init(level: 0, marker: .unordered, taskState: .checked, text: "Ship parser"),
                .init(level: 1, marker: .unordered, taskState: .unchecked, text: "Follow up"),
                .init(level: 0, marker: .ordered(1), taskState: nil, text: "Verify"),
            ]),
            .blockquote("Keep this readable\non mobile"),
            .codeBlock(language: "swift", code: "let value = 1"),
            .table(
                header: ["Name", "State"],
                rows: [["Parser", "**Done**"]]
            ),
        ])
    }

    func testHeadingRequiresWhitespaceAfterMarker() {
        XCTAssertEqual(ScoutMarkdownParser.parse("#tag"), [.text("#tag")])
        XCTAssertEqual(ScoutMarkdownParser.parse("### Heading ###"), [.heading(level: 3, text: "Heading")])
    }

    func testRulesAllowSpacesBetweenMarkers() {
        XCTAssertEqual(ScoutMarkdownParser.parse("- - -"), [.rule])
    }

    func testPromotesPlanHeadingAndListToPlanSurface() {
        let parts = ScoutMarkdownParser.parse("""
        Before.

        ## Implementation Plan
        Keep the scope mobile-native.
        - [ ] Detect plan
        - [x] Render surface

        After.
        """)

        XCTAssertEqual(ScoutMarkdownPresentation.sections(from: parts), [
            .markdown(.text("Before.")),
            .plan(.init(
                title: "Implementation Plan",
                summary: "Keep the scope mobile-native.",
                items: [
                    .init(level: 0, marker: .unordered, taskState: .unchecked, text: "Detect plan"),
                    .init(level: 0, marker: .unordered, taskState: .checked, text: "Render surface"),
                ]
            )),
            .markdown(.text("After.")),
        ])
    }

    func testPromotesPlanIntroAndListToPlanSurface() {
        let parts = ScoutMarkdownParser.parse("""
        Here's the plan:

        1. Inspect
        2. Build
        """)

        XCTAssertEqual(ScoutMarkdownPresentation.sections(from: parts), [
            .plan(.init(
                title: "Plan",
                summary: nil,
                items: [
                    .init(level: 0, marker: .ordered(1), taskState: nil, text: "Inspect"),
                    .init(level: 0, marker: .ordered(2), taskState: nil, text: "Build"),
                ]
            )),
        ])
    }

    func testLeavesOrdinaryListsAsMarkdown() {
        let parts = ScoutMarkdownParser.parse("""
        Things I saw:

        - One
        - Two
        """)

        XCTAssertEqual(ScoutMarkdownPresentation.sections(from: parts), [
            .markdown(.text("Things I saw:")),
            .markdown(.list([
                .init(level: 0, marker: .unordered, taskState: nil, text: "One"),
                .init(level: 0, marker: .unordered, taskState: nil, text: "Two"),
            ])),
        ])
    }
}
