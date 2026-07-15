import Foundation
@testable import ScoutAppCore
import XCTest

final class ScoutdProbeClientTests: XCTestCase {
    func testCapabilitiesAreCachedWithinTTL() async throws {
        let transport = FakeProbeTransport { _ in
            return Data(#"{"schema":"openscout.probe.capabilities/v1","daemonVersion":"testd","families":[{"probeId":"tailscale.status","schemaVersion":1,"ttlMs":30000}],"verbs":[]}"#.utf8)
        }
        let client = ScoutdProbeClient(
            socketURL: URL(fileURLWithPath: "/tmp/scoutd-probes.sock"),
            transport: transport,
            timeout: 0.1,
            capabilityCacheTTL: 60
        )

        let firstSupported = try await client.supportsProbe("tailscale.status")
        let secondSupported = try await client.supportsProbe("tailscale.status")
        XCTAssertTrue(firstSupported)
        XCTAssertTrue(secondSupported)
        XCTAssertEqual(transport.requestCount, 1)
    }

    func testSnapshotDecodeKeepsValueAndErrorFields() throws {
        let data = Data(#"{"schema":"openscout.probe.snapshot/v1","probeId":"tailscale.status","key":null,"generatedAt":1234,"ttlMs":30000,"value":{"backendState":"Running","running":true},"error":null,"daemonVersion":"testd"}"#.utf8)

        let snapshot = try ScoutdProbeClient.decodeSnapshot(data, expectedProbeId: "tailscale.status")

        XCTAssertEqual(snapshot.probeId, "tailscale.status")
        XCTAssertEqual(snapshot.generatedAt, 1234)
        XCTAssertEqual(snapshot.ttlMs, 30_000)
        XCTAssertEqual(snapshot.daemonVersion, "testd")
        XCTAssertNil(snapshot.error)
        let value = try XCTUnwrap(snapshot.valueData)
        let valueObject = try JSONSerialization.jsonObject(with: value) as? [String: Any]
        XCTAssertEqual(valueObject?["backendState"] as? String, "Running")
        XCTAssertEqual(valueObject?["running"] as? Bool, true)
    }

    func testSnapshotDecodeRejectsMismatchedProbe() throws {
        let data = Data(#"{"schema":"openscout.probe.snapshot/v1","probeId":"git.buildInfo","key":null,"generatedAt":1234,"ttlMs":60000,"value":{},"error":null,"daemonVersion":"testd"}"#.utf8)

        XCTAssertThrowsError(try ScoutdProbeClient.decodeSnapshot(data, expectedProbeId: "tailscale.status")) { error in
            XCTAssertTrue(error.localizedDescription.contains("probeId mismatch"))
        }
    }

    func testTransportTimeoutIsSurfaced() async throws {
        let transport = FakeProbeTransport { _ in
            throw ScoutdProbeClientError.timeout("timed out in fake transport")
        }
        let client = ScoutdProbeClient(
            socketURL: URL(fileURLWithPath: "/tmp/scoutd-probes.sock"),
            transport: transport,
            timeout: 0.1,
            capabilityCacheTTL: 60
        )

        do {
            _ = try await client.capabilities()
            XCTFail("capabilities should have thrown")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("timed out"))
        }
    }

    func testNativeReadSnapshotDecodesTypedAgents() throws {
        let data = Data(#"{"schema":"openscout.native.read.snapshot/v1","type":"agents.snapshot","requestId":"req-1","sequence":42,"generatedAt":1784042000000,"sourceUpdatedAt":1784041999000,"source":"broker-journal","agents":[{"id":"vox-zeno","name":"Vox Zeno","handle":"vox-zeno","agentClass":"builder","harness":"codex","state":"working","projectRoot":"/Users/art/dev/openscout","project":"OpenScout","transport":"codex_app_server","capabilities":["chat","invoke"],"updatedAt":1784041998000}],"hasMore":true}"#.utf8)

        let snapshot = try XCTUnwrap(ScoutNativeReadClient.decodeFrame(data))

        XCTAssertEqual(snapshot.sequence, 42)
        XCTAssertEqual(snapshot.sourceUpdatedAt, 1_784_041_999_000)
        XCTAssertTrue(snapshot.hasMore)
        XCTAssertEqual(snapshot.agents.map(\.id), ["vox-zeno"])
        XCTAssertEqual(snapshot.agents[0].state, .working)
        XCTAssertEqual(snapshot.agents[0].projectRoot, "/Users/art/dev/openscout")
    }

    func testNativeReadHeartbeatDoesNotPublishAgentState() throws {
        let data = Data(#"{"schema":"openscout.native.read.event/v1","type":"heartbeat","requestId":"req-1","sequence":42,"generatedAt":1784042000000}"#.utf8)

        XCTAssertNil(try ScoutNativeReadClient.decodeFrame(data))
    }
}

private final class FakeProbeTransport: ScoutdProbeTransport, @unchecked Sendable {
    private let handler: @Sendable (String) throws -> Data
    private var requests: [String] = []

    init(handler: @escaping @Sendable (String) throws -> Data) {
        self.handler = handler
    }

    var requestCount: Int {
        requests.count
    }

    func roundTrip(socketPath: String, request: Data, timeout: TimeInterval) async throws -> Data {
        let body = String(decoding: request, as: UTF8.self)
        requests.append(body)
        return try handler(body)
    }
}
