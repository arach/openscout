import Foundation
@testable import ScoutAppCore
import XCTest

@MainActor
final class TailscaleServiceProbeTests: XCTestCase {
    func testScoutdSnapshotServesStatusWithoutLocalExec() async throws {
        let probe = FakeTailscaleProbeClient(
            snapshots: [try makeSnapshot(value: summaryStatusJSON, generatedAt: 42)]
        )
        var localExecCount = 0
        let service = TailscaleService(
            probeClient: probe,
            commandRunner: { _, _ in
                localExecCount += 1
                return CommandResult(exitCode: 64, stdout: "", stderr: "should not run")
            },
            appURLProvider: { nil },
            cliURLProvider: { URL(fileURLWithPath: "/tmp/fake-tailscale") }
        )

        let state = await service.loadState()

        XCTAssertEqual(localExecCount, 0)
        XCTAssertEqual(state.statusSource, "scoutd")
        XCTAssertNil(state.probeFallbackReason)
        XCTAssertEqual(state.probeSocketPath, probe.socketPath)
        XCTAssertEqual(state.probeDaemonVersion, "testd")
        XCTAssertEqual(state.probeGeneratedAtMs, 42)
        XCTAssertTrue(state.running)
        XCTAssertEqual(state.peerCount, 2)
        XCTAssertEqual(state.onlinePeerCount, 1)
        XCTAssertEqual(state.dnsName, "mac.tailnet.test")
        XCTAssertEqual(probe.maxAgeRequests, [30_000])
    }

    func testSocketFailureFallsBackToExistingExecPath() async throws {
        let probe = FakeTailscaleProbeClient(socketExists: false)
        var descriptors: [CommandDescriptor] = []
        let service = TailscaleService(
            probeClient: probe,
            commandRunner: { descriptor, _ in
                descriptors.append(descriptor)
                return CommandResult(exitCode: 0, stdout: cliStatusJSON, stderr: "")
            },
            appURLProvider: { nil },
            cliURLProvider: { URL(fileURLWithPath: "/tmp/fake-tailscale") }
        )

        let state = await service.loadState()

        XCTAssertEqual(descriptors.count, 1)
        XCTAssertEqual(descriptors.first?.executableURL.path, "/tmp/fake-tailscale")
        XCTAssertEqual(descriptors.first?.arguments, ["status", "--json"])
        XCTAssertEqual(state.statusSource, "local-exec")
        XCTAssertTrue(state.probeFallbackReason?.contains("socket not found") == true)
        XCTAssertTrue(state.running)
        XCTAssertEqual(state.peerCount, 2)
        XCTAssertEqual(state.onlinePeerCount, 1)
    }

    func testOpenAppInvalidatesNextProbeRead() async throws {
        let probe = FakeTailscaleProbeClient(
            snapshots: [try makeSnapshot(value: summaryStatusJSON, generatedAt: 100)]
        )
        var opened = false
        let service = TailscaleService(
            probeClient: probe,
            commandRunner: { descriptor, _ in
                if descriptor.executableURL.path == "/usr/bin/open" {
                    opened = true
                    return CommandResult(exitCode: 0, stdout: "", stderr: "")
                }
                XCTFail("unexpected local exec: \(descriptor.displayString)")
                return CommandResult(exitCode: 64, stdout: "", stderr: "unexpected")
            },
            appURLProvider: { URL(fileURLWithPath: "/Applications/Tailscale.app") },
            cliURLProvider: { URL(fileURLWithPath: "/tmp/fake-tailscale") }
        )

        let state = try await service.openApp()

        XCTAssertTrue(opened)
        XCTAssertTrue(state.running)
        XCTAssertEqual(probe.maxAgeRequests, [0])
    }

    func testProbeSnapshotErrorDoesNotLocalExec() async throws {
        let snapshot = ScoutdProbeSnapshot(
            probeId: "tailscale.status",
            generatedAt: 321,
            ttlMs: 30_000,
            valueData: nil,
            error: ScoutdProbeError(code: "timeout", message: "daemon probe timed out", timedOut: true),
            daemonVersion: "testd"
        )
        let probe = FakeTailscaleProbeClient(snapshots: [snapshot])
        var localExecCount = 0
        let service = TailscaleService(
            probeClient: probe,
            commandRunner: { _, _ in
                localExecCount += 1
                return CommandResult(exitCode: 0, stdout: cliStatusJSON, stderr: "")
            },
            appURLProvider: { nil },
            cliURLProvider: { URL(fileURLWithPath: "/tmp/fake-tailscale") }
        )

        let state = await service.loadState()

        XCTAssertEqual(localExecCount, 0)
        XCTAssertEqual(state.statusSource, "scoutd")
        XCTAssertNil(state.probeFallbackReason)
        XCTAssertFalse(state.available)
        XCTAssertEqual(state.statusDetail, "daemon probe timed out")
    }
}

private final class FakeTailscaleProbeClient: TailscaleStatusProbeClient, @unchecked Sendable {
    let socketPath: String
    private let socketExistsValue: Bool
    private let supportsValue: Bool
    private let supportError: Error?
    private var snapshots: [ScoutdProbeSnapshot]
    private var recordedMaxAgeRequests: [UInt64] = []

    init(
        socketPath: String = "/tmp/scoutd-probes.sock",
        socketExists: Bool = true,
        supports: Bool = true,
        supportError: Error? = nil,
        snapshots: [ScoutdProbeSnapshot] = []
    ) {
        self.socketPath = socketPath
        self.socketExistsValue = socketExists
        self.supportsValue = supports
        self.supportError = supportError
        self.snapshots = snapshots
    }

    var maxAgeRequests: [UInt64] {
        recordedMaxAgeRequests
    }

    func socketExists() -> Bool {
        socketExistsValue
    }

    func supportsProbe(_ probeId: String, forceRefresh: Bool) async throws -> Bool {
        if let supportError {
            throw supportError
        }
        return supportsValue
    }

    func snapshot(probeId: String, key: String?, maxAgeMs: UInt64) async throws -> ScoutdProbeSnapshot {
        recordedMaxAgeRequests.append(maxAgeMs)
        let snapshot = snapshots.isEmpty
            ? ScoutdProbeSnapshot(probeId: probeId, generatedAt: 0, ttlMs: 30_000, valueData: nil, daemonVersion: "testd")
            : snapshots.removeFirst()
        return snapshot
    }
}

private func makeSnapshot(value: String, generatedAt: UInt64) throws -> ScoutdProbeSnapshot {
    ScoutdProbeSnapshot(
        probeId: "tailscale.status",
        generatedAt: generatedAt,
        ttlMs: 30_000,
        valueData: Data(value.utf8),
        daemonVersion: "testd"
    )
}

private let summaryStatusJSON = #"{"backendState":"Running","running":true,"health":[],"self":{"dnsName":"mac.tailnet.test.","addresses":["100.64.0.10"],"hostName":"mac"},"peers":[{"online":true},{"online":false}]}"#

private let cliStatusJSON = #"{"BackendState":"Running","Health":[],"Self":{"DNSName":"mac.tailnet.test.","TailscaleIPs":["100.64.0.10"]},"Peer":{"one":{"Online":true},"two":{"Online":false}}}"#
