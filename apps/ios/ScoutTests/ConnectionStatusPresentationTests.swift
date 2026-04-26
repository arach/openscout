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

    func testLocalOnlyRelayUrlIsReportedAsTailscaleDependent() {
        XCTAssertTrue(relayURLIndicatesLocalOnlyTailscaleRoute("ws://127.0.0.1:7889"))
        XCTAssertTrue(relayURLIndicatesLocalOnlyTailscaleRoute("ws://localhost:7889"))
        XCTAssertTrue(relayURLDependsOnTailscale("ws://127.0.0.1:7889"))
    }

    func testTailnetRelayUrlIsReportedAsTailscaleDependent() {
        XCTAssertTrue(relayURLUsesTailnetRoute("wss://relay.example.ts.net:7889"))
        XCTAssertTrue(relayURLUsesTailnetRoute("ws://100.96.12.4:7889"))
        XCTAssertTrue(relayURLDependsOnTailscale("wss://relay.example.ts.net:7889"))
    }

    func testOrdinaryRelayUrlIsNotReportedAsTailscaleDependent() {
        XCTAssertFalse(relayURLDependsOnTailscale("wss://relay.example.com:443"))
        XCTAssertFalse(relayURLDependsOnTailscale("ws://192.168.1.10:7889"))
    }

    func testCommonTailnetTransportFailuresAreRecognized() {
        XCTAssertTrue(isTailscaleRouteNetworkFailure(URLError(.cannotFindHost)))
        XCTAssertTrue(isTailscaleRouteNetworkFailure(URLError(.timedOut)))
        XCTAssertFalse(isTailscaleRouteNetworkFailure(URLError(.badServerResponse)))
    }
}
