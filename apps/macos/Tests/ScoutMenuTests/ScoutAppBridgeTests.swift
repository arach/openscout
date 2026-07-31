import Darwin
@testable import ScoutMenu
import XCTest

@MainActor
final class ScoutAppBridgeTests: XCTestCase {
    func testProcessLivenessRejectsMissingLaunchServicesRecords() {
        XCTAssertTrue(ScoutAppBridge.isProcessAlive(getpid()))
        XCTAssertFalse(ScoutAppBridge.isProcessAlive(pid_t.max))
    }
}
