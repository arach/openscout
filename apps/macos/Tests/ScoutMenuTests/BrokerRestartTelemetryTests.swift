import Foundation
@testable import ScoutMenu
import XCTest

final class BrokerRestartTelemetryTests: XCTestCase {
    func testRunningRuntimeWithDormantBackoffDoesNotWarn() throws {
        let telemetry = try decodeTelemetry("""
        {
          "baseState": "running",
          "restartCount": 0,
          "restartBackoffMs": 1000,
          "lastChildExit": null
        }
        """)

        XCTAssertFalse(telemetry.shouldWarn)
        XCTAssertFalse(telemetry.hasActiveBackoff)
        XCTAssertNil(telemetry.backoffLabel())
        XCTAssertEqual(telemetry.compactWarning(reachable: true), "Runtime restarted 0x")
    }

    func testExitedRuntimeWithBackoffWarns() throws {
        let telemetry = try decodeTelemetry("""
        {
          "baseState": "exited",
          "restartCount": 1,
          "restartBackoffMs": 1000
        }
        """)

        XCTAssertTrue(telemetry.shouldWarn)
        XCTAssertTrue(telemetry.hasActiveBackoff)
        XCTAssertEqual(telemetry.backoffLabel(), "1s")
        XCTAssertEqual(telemetry.compactWarning(reachable: true), "Runtime restarted 1x; backoff 1s")
    }

    func testRepeatedRestartsWarnWithoutDormantBackoff() throws {
        let telemetry = try decodeTelemetry("""
        {
          "baseState": "running",
          "restartCount": 3,
          "restartBackoffMs": 1000
        }
        """)

        XCTAssertTrue(telemetry.shouldWarn)
        XCTAssertFalse(telemetry.hasActiveBackoff)
        XCTAssertEqual(telemetry.compactWarning(reachable: true), "Runtime restarted 3x")
    }

    private func decodeTelemetry(_ json: String) throws -> BrokerRestartTelemetry {
        let data = Data(json.utf8)
        return try JSONDecoder().decode(BrokerRestartTelemetry.self, from: data)
    }
}
