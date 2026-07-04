import Foundation
@testable import ScoutAppCore
import XCTest

@MainActor
final class TailscaleServiceScoutdIntegrationTests: XCTestCase {
    func testScoutdDaemonUpPreventsAppExecsAndDaemonDownFallsBack() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["OPENSCOUT_RUN_SCOUTD_INTEGRATION"] == "1" else {
            throw XCTSkip("set OPENSCOUT_RUN_SCOUTD_INTEGRATION=1 and OPENSCOUT_SCOUTD_BIN to run scoutd integration")
        }
        guard let scoutdBin = environment["OPENSCOUT_SCOUTD_BIN"], !scoutdBin.isEmpty else {
            throw XCTSkip("OPENSCOUT_SCOUTD_BIN is required for scoutd integration")
        }
        guard FileManager.default.isExecutableFile(atPath: scoutdBin) else {
            throw XCTSkip("OPENSCOUT_SCOUTD_BIN is not executable: \(scoutdBin)")
        }

        let dir = try makeTemporaryDirectory(prefix: "tailscale-scoutd-integration")
        defer { try? FileManager.default.removeItem(at: dir) }
        let socketURL = dir.appending(path: "scoutd-probes.sock")
        let countLogURL = dir.appending(path: "tailscale-execs.log")
        let tailscaleURL = dir.appending(path: "tailscale")
        try writeFakeTailscale(at: tailscaleURL, countLogURL: countLogURL)

        let daemon = Process()
        daemon.executableURL = URL(fileURLWithPath: scoutdBin)
        daemon.arguments = ["probes", "serve"]
        daemon.environment = environment.merging([
            "OPENSCOUT_HOME": dir.path,
            "OPENSCOUT_PROBES_SOCKET": socketURL.path,
            "OPENSCOUT_TAILSCALE_BIN": tailscaleURL.path,
        ]) { _, new in new }
        daemon.standardOutput = Pipe()
        daemon.standardError = Pipe()
        try daemon.run()
        defer { terminate(daemon) }

        let probeClient = ScoutdProbeClient(socketURL: socketURL, timeout: 0.75, capabilityCacheTTL: 60)
        try await waitForProbeServer(probeClient)

        let service = TailscaleService(
            probeClient: probeClient,
            commandRunner: { descriptor, timeout in
                try await CommandRunner.run(descriptor, timeout: timeout)
            },
            environment: ["OPENSCOUT_TAILSCALE_BIN": tailscaleURL.path],
            appURLProvider: { nil }
        )

        for _ in 0..<3 {
            let state = await service.loadState()
            XCTAssertEqual(state.statusSource, "scoutd")
            XCTAssertTrue(state.running)
        }

        let daemonUpExecs = try readExecLog(countLogURL)
        XCTAssertEqual(daemonUpExecs.count, 1)
        XCTAssertTrue(daemonUpExecs.allSatisfy { $0.contains("scoutd") }, daemonUpExecs.joined(separator: "\n"))

        terminate(daemon)
        let fallbackState = await service.loadState()
        XCTAssertEqual(fallbackState.statusSource, "local-exec")
        XCTAssertTrue(fallbackState.probeFallbackReason?.contains("scoutd probe request failed") == true)
        XCTAssertTrue(fallbackState.running)

        let daemonDownExecs = try readExecLog(countLogURL)
        XCTAssertEqual(daemonDownExecs.count, 2)
        XCTAssertTrue(daemonDownExecs[0].contains("scoutd"), daemonDownExecs.joined(separator: "\n"))
        XCTAssertFalse(daemonDownExecs[1].contains("scoutd"), daemonDownExecs.joined(separator: "\n"))
    }

    private func waitForProbeServer(_ client: ScoutdProbeClient) async throws {
        var lastError: Error?
        for _ in 0..<100 {
            do {
                if try await client.supportsProbe("tailscale.status", forceRefresh: true) {
                    return
                }
            } catch {
                lastError = error
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        if let lastError {
            throw lastError
        }
        XCTFail("scoutd probe server did not become ready")
    }
}

private func makeTemporaryDirectory(prefix: String) throws -> URL {
    // Unix-domain socket paths are capped at sockaddr_un.sun_path (104 bytes on
    // Darwin), so keep the integration fixture under /tmp rather than the much
    // longer per-user temporary directory.
    let directory = URL(fileURLWithPath: "/tmp")
        .appending(path: "\(prefix)-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}

private func writeFakeTailscale(at url: URL, countLogURL: URL) throws {
    let body = """
    #!/bin/sh
    parent="$(ps -p "$PPID" -o comm= 2>/dev/null | tr -d ' ')"
    printf '%s %s\n' "$parent" "$*" >> \(shellQuote(countLogURL.path))
    if [ "$1" = "status" ]; then
      cat <<'JSON'
    {"BackendState":"Running","Health":[],"Self":{"ID":"self-node","HostName":"workstation","DNSName":"workstation.tailnet.test.","TailscaleIPs":["100.64.0.10"],"Online":true},"Peer":{"one":{"Online":true},"two":{"Online":false}}}
    JSON
      exit 0
    fi
    exit 64
    """
    try body.write(to: url, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
}

private func readExecLog(_ url: URL) throws -> [String] {
    guard FileManager.default.fileExists(atPath: url.path) else { return [] }
    return try String(contentsOf: url, encoding: .utf8)
        .split(separator: "\n")
        .map(String.init)
}

private func terminate(_ process: Process) {
    guard process.isRunning else { return }
    process.terminate()
    let deadline = Date().addingTimeInterval(2)
    while process.isRunning, Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
    }
    if process.isRunning {
        kill(process.processIdentifier, SIGKILL)
    }
    process.waitUntilExit()
}

private func shellQuote(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}
