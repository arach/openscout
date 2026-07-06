@testable import ScoutAppCore
import XCTest

final class ScoutShellStateClientTests: XCTestCase {
    // Mirrors the exact `GET /api/shell-state` payload shape produced by
    // packages/web/server/runtime-summary.ts (`OpenScoutWebShellState`).
    private func decode(_ json: String) throws -> ScoutShellState {
        try JSONDecoder().decode(ScoutShellState.self, from: Data(json.utf8))
    }

    func testDecodesRunningShellState() throws {
        let state = try decode("""
        {
          "runtime": {
            "brokerReachable": true,
            "brokerHealthy": true,
            "brokerLabel": "Running",
            "agentCount": 3,
            "messageCount": 42,
            "nodeId": "node-1",
            "error": null
          }
        }
        """)
        XCTAssertTrue(state.runtime.brokerReachable)
        XCTAssertEqual(state.runtime.brokerHealthy, true)
        XCTAssertEqual(ScoutServiceHealth.from(shellState: state), .ok)
    }

    func testDecodesOfflineBrokerShellState() throws {
        let state = try decode("""
        {
          "runtime": {
            "brokerReachable": false,
            "brokerHealthy": false,
            "brokerLabel": "Offline",
            "agentCount": 0,
            "messageCount": 0,
            "nodeId": null,
            "error": "ECONNREFUSED"
          }
        }
        """)
        XCTAssertFalse(state.runtime.brokerReachable)
        XCTAssertEqual(ScoutServiceHealth.from(shellState: state), .brokerDown)
    }

    func testDecodeToleratesMissingOptionalFields() throws {
        // Only the fields the native app relies on are required; everything else
        // in the payload is ignored.
        let state = try decode("{ \"runtime\": { \"brokerReachable\": true } }")
        XCTAssertTrue(state.runtime.brokerReachable)
        XCTAssertNil(state.runtime.brokerHealthy)
        XCTAssertEqual(ScoutServiceHealth.from(shellState: state), .ok)
    }
}
