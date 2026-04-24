import XCTest

@testable import ScoutApp

final class ConnectionStatusPresentationTests: XCTestCase {
    func testConnectedStateTreatsOfflineHealthAsHealthyForDisplay() {
        XCTAssertEqual(
            normalizedConnectionDisplayHealth(state: .connected, health: .offline),
            .healthy
        )
    }

    func testReconnectingStateTreatsOfflineHealthAsSuspectForDisplay() {
        XCTAssertEqual(
            normalizedConnectionDisplayHealth(state: .reconnecting(attempt: 2), health: .offline),
            .suspect
        )
    }

    func testDisconnectedStateKeepsOfflineHealthForDisplay() {
        XCTAssertEqual(
            normalizedConnectionDisplayHealth(state: .disconnected, health: .offline),
            .offline
        )
    }
}
