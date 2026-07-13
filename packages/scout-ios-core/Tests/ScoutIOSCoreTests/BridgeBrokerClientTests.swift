import Foundation
import XCTest
import ScoutCapabilities
@testable import ScoutIOSCore

final class BridgeBrokerClientTests: XCTestCase {

    // MARK: - Conformance

    @MainActor
    func testConformsToScoutBrokerClient() {
        // Compile-time proof that BridgeBrokerClient satisfies the composed
        // capability contract. (No live bridge — construction only.)
        let log = ConnectionLog()
        let client: any ScoutBrokerClient = BridgeBrokerClient(
            connectionLog: ConnectionLogHandle(log),
            userDefaults: UserDefaults(suiteName: "test.conformance")!
        )
        XCTAssertNotNil(client)
    }

    // MARK: - tRPC envelope encoding (byte-shape interop)

    func testTRPCRequestEnvelopeShape() throws {
        let req = TRPCRequest(
            id: 7,
            method: .query,
            path: "mobile.sessions",
            input: MobileListParams(query: "vox", limit: 20)
        )
        let data = try JSONEncoder().encode(req)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["id"] as? Int, 7)
        XCTAssertEqual(json["jsonrpc"] as? String, "2.0")
        XCTAssertEqual(json["method"] as? String, "query")
        let params = json["params"] as! [String: Any]
        XCTAssertEqual(params["path"] as? String, "mobile.sessions")
        let input = params["input"] as! [String: Any]
        XCTAssertEqual(input["query"] as? String, "vox")
        XCTAssertEqual(input["limit"] as? Int, 20)
    }

    func testRouteMapCoversCapabilityMethods() {
        for method in [
            "mobile/sessions", "mobile/agents", "mobile/workspaces",
            "mobile/activity", "mobile/endpoints", "mobile/session/snapshot",
            "mobile/message/send", "mobile/session/create",
            "mobile/comms/conversations", "mobile/comms/messages",
            "mobile/comms/send", "mobile/comms/read", "mobile/attachments/upload",
            "mobile/terminal/provision", "mobile/terminal/status",
            "question/answer", "action/decide", "turn/interrupt",
        ] {
            XCTAssertNotNil(trpcRouteMap[method], "missing route for \(method)")
        }
    }

    // MARK: - Metadata-only request observability

    @MainActor
    func testBrokerRequestLogIsBoundedAndTracksOnlySuccessfulReads() {
        let log = BrokerRequestLog(capacity: 2)
        let start = Date(timeIntervalSince1970: 1_000)

        log.record(
            startedAt: start,
            completedAt: start.addingTimeInterval(0.1),
            operation: "mobile/comms/send",
            kind: "mutation",
            outcome: .success,
            route: .lan
        )
        XCTAssertNil(log.lastSuccessfulReadAt)

        log.record(
            startedAt: start,
            completedAt: start.addingTimeInterval(0.2),
            operation: "mobile/agents",
            kind: "query",
            outcome: .failure,
            route: .tailnet,
            failureCategory: "Timeout"
        )
        XCTAssertNil(log.lastSuccessfulReadAt)

        let successfulReadAt = start.addingTimeInterval(0.3)
        log.record(
            startedAt: start,
            completedAt: successfulReadAt,
            operation: "mobile/tail",
            kind: "query",
            outcome: .success,
            route: .oscout
        )

        XCTAssertEqual(log.entries.count, 2)
        XCTAssertEqual(log.entries.map(\.operation), ["mobile/agents", "mobile/tail"])
        XCTAssertEqual(log.lastSuccessfulReadAt, successfulReadAt)

        log.clear()
        XCTAssertTrue(log.entries.isEmpty)
        XCTAssertEqual(log.lastSuccessfulReadAt, successfulReadAt)
    }

    func testBrokerRequestFailureCategoryNeverCopiesServerMessage() {
        let sensitiveMessage = "denied for /Users/person/private with bearer secret"
        let category = brokerRequestFailureCategory(
            BridgeConnectionError.rpcError(code: 403, message: sensitiveMessage)
        )

        XCTAssertEqual(category, "RPC 403")
        XCTAssertFalse(category.contains(sensitiveMessage))
        XCTAssertEqual(
            brokerRequestFailureCategory(BridgeConnectionError.decodingFailed(sensitiveMessage)),
            "Decode"
        )
        XCTAssertEqual(brokerRequestFailureCategory(URLError(.notConnectedToInternet)), "Network -1009")
    }

    // MARK: - Listing wire → contract mapping

    func testMobileSessionSummaryMapping() throws {
        let wireJSON = """
        {
          "id": "conv-1", "kind": "agent", "title": "Refactor broker",
          "agentName": "vox", "harness": "claude", "preview": "WIP",
          "messageCount": 12, "lastMessageAt": 1700000000, "workspaceRoot": "/Users/x/dev/openscout"
        }
        """.data(using: .utf8)!
        let wire = try JSONDecoder().decode(MobileSessionSummary.self, from: wireJSON)
        let summary = wire.toSummary()
        XCTAssertEqual(summary.id, "conv-1")
        XCTAssertEqual(summary.title, "Refactor broker")
        XCTAssertEqual(summary.agentName, "vox")
        XCTAssertEqual(summary.harness, "claude")
        XCTAssertEqual(summary.messageCount, 12)
        XCTAssertEqual(summary.projectName, "openscout")
        XCTAssertNotNil(summary.lastMessageAt)
    }

    func testMobileAgentSummaryStateMapping() throws {
        let wireJSON = """
        {
          "id": "agent-1", "title": "Vox", "state": "live",
          "statusLabel": "Working", "harness": "codex",
          "workspaceRoot": "/Users/x/dev/scout", "sessionId": "sess-9", "lastActiveAt": 1700000000
        }
        """.data(using: .utf8)!
        let wire = try JSONDecoder().decode(MobileAgentSummary.self, from: wireJSON)
        let summary = wire.toSummary()
        XCTAssertEqual(summary.id, "agent-1")
        XCTAssertEqual(summary.state, .live)
        XCTAssertEqual(summary.statusLabel, "Working")
        XCTAssertEqual(summary.projectName, "scout")
        XCTAssertEqual(summary.sessionId, "sess-9")
    }

    // MARK: - SessionInitiationSpec → create params

    func testStartSessionParamMapping() throws {
        // Exercise the spec → MobileCreateSessionParams shaping directly.
        let spec = SessionInitiationSpec(
            target: .init(projectPath: "/Users/x/dev/openscout"),
            execution: .init(harness: "claude", model: "opus", session: .new),
            agent: .init(handle: "vox"),
            seed: .init(instructions: "check status")
        )
        let params = MobileCreateSessionParams(
            workspaceId: spec.target?.projectPath ?? "",
            harness: spec.execution?.harness,
            agentName: spec.agent?.handle,
            worktree: nil, profile: nil, branch: nil,
            model: spec.execution?.model,
            forceNew: (spec.execution?.session == .new) ? true : nil,
            seed: spec.seed
        )
        XCTAssertEqual(params.workspaceId, "/Users/x/dev/openscout")
        XCTAssertEqual(params.harness, "claude")
        XCTAssertEqual(params.model, "opus")
        XCTAssertEqual(params.agentName, "vox")
        XCTAssertEqual(params.forceNew, true)

        let data = try JSONEncoder().encode(params)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let seed = json["seed"] as! [String: Any]
        XCTAssertEqual(seed["instructions"] as? String, "check status")
    }

    func testPromptSendKeepsOpaqueConversationIdOutOfAgentTarget() throws {
        let params = mobilePromptSendParams(
            PromptSpec(
                conversationId: "c.b2929f46-9b0c-4609-beb6-466e5cc2eae3",
                text: "continue"
            ),
            clientMessageId: "client-1"
        )
        let data = try JSONEncoder().encode(params)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["conversationId"] as? String, "c.b2929f46-9b0c-4609-beb6-466e5cc2eae3")
        XCTAssertNil(json["agentId"])
        XCTAssertEqual(json["body"] as? String, "continue")
        XCTAssertEqual(json["clientMessageId"] as? String, "client-1")
    }

    func testPromptSendPrefersCallerClientMessageId() throws {
        let params = mobilePromptSendParams(
            PromptSpec(
                conversationId: "c.1",
                text: "again",
                clientMessageId: "ios-client-1"
            ),
            clientMessageId: "fallback-client-1"
        )
        let data = try JSONEncoder().encode(params)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["clientMessageId"] as? String, "ios-client-1")
    }
}
