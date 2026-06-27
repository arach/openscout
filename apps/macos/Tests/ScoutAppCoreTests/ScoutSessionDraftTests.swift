import Foundation
import ScoutCapabilities
@testable import ScoutAppCore
import XCTest

final class ScoutSessionDraftTests: XCTestCase {
    func testProjectDraftDefaultsToStickyWithoutAlias() {
        let draft = ScoutSessionDraft(
            title: "New conversation",
            target: .project,
            projectPath: "  /Users/art/dev/openscout  ",
            mode: .fresh,
            instructions: "  Investigate startup flow.  "
        )

        let spec = draft.spec()

        XCTAssertEqual(spec.target?.projectPath, "/Users/art/dev/openscout")
        XCTAssertNil(spec.target?.agentId)
        XCTAssertEqual(spec.execution?.session, .new)
        XCTAssertNil(spec.execution?.targetSessionId)
        XCTAssertEqual(spec.agent?.persistence, "sticky")
        XCTAssertNil(spec.agent?.handle)
        XCTAssertNil(spec.agent?.displayName)
        XCTAssertEqual(spec.seed?.instructions, "Investigate startup flow.")
    }

    func testProjectDraftSendsAliasWhenProvided() {
        let draft = ScoutSessionDraft(
            title: "New conversation",
            target: .project,
            projectPath: "/repo",
            agentName: "  build-runner  ",
            displayName: "  Build Runner  "
        )

        let spec = draft.spec()

        XCTAssertEqual(spec.agent?.persistence, "sticky")
        XCTAssertEqual(spec.agent?.handle, "build-runner")
        XCTAssertEqual(spec.agent?.displayName, "Build Runner")
    }

    func testAgentContinueUsesExistingSessionTarget() {
        let agent = makeAgent(
            id: "agent.codex.openscout",
            name: "Codex",
            harness: "codex",
            harnessSessionId: "session-123"
        )
        let draft = ScoutSessionDraft(
            title: "Continue conversation",
            target: .agent(agent),
            projectPath: "/repo",
            mode: .continueContext,
            instructions: "  Keep going  ",
            fromMessageId: "m.1",
            fromConversationId: "c.1",
            harness: " codex ",
            model: " gpt-5 "
        )

        let spec = draft.spec()

        XCTAssertEqual(spec.target?.agentId, "agent.codex.openscout")
        XCTAssertNil(spec.target?.projectPath)
        XCTAssertEqual(spec.execution?.session, .existing)
        XCTAssertEqual(spec.execution?.targetSessionId, "session-123")
        XCTAssertEqual(spec.execution?.harness, "codex")
        XCTAssertEqual(spec.execution?.model, "gpt-5")
        XCTAssertNil(spec.agent)
        XCTAssertEqual(spec.seed?.instructions, "Keep going")
        XCTAssertEqual(spec.seed?.fromMessageId, "m.1")
        XCTAssertEqual(spec.seed?.fromConversationId, "c.1")
    }

    func testAgentFreshNeverSendsTargetSessionId() {
        let agent = makeAgent(
            id: "agent.claude.openscout",
            name: "Claude",
            harness: "claude",
            harnessSessionId: "session-keep-out"
        )
        let draft = ScoutSessionDraft(
            title: "New conversation",
            target: .agent(agent),
            projectPath: "/repo",
            mode: .fresh
        )

        let spec = draft.spec()

        XCTAssertEqual(spec.execution?.session, .new)
        XCTAssertNil(spec.execution?.targetSessionId)
    }

    private func makeAgent(
        id: String,
        name: String,
        harness: String,
        harnessSessionId: String?
    ) -> ScoutAgent {
        var payload: [String: Any] = [
            "id": id,
            "name": name,
            "harness": harness,
            "state": "available",
        ]
        if let harnessSessionId {
            payload["harnessSessionId"] = harnessSessionId
        }
        let data = try! JSONSerialization.data(withJSONObject: payload)
        return try! JSONDecoder().decode(ScoutAgent.self, from: data)
    }
}
