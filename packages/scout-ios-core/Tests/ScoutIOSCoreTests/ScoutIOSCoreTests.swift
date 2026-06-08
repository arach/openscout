import Foundation
import XCTest
@testable import ScoutIOSCore

final class ScoutIOSCoreTests: XCTestCase {
    func testTransportClassification() {
        XCTAssertEqual(classifyTransport(host: "192.168.1.10"), .lan)
        XCTAssertEqual(classifyTransport(host: "100.64.0.1"), .tailnet)
        XCTAssertEqual(classifyTransport(host: "bridge.tailnet.ts.net"), .tailnet)
        XCTAssertEqual(classifyTransport(host: "oscout.net"), .oscout)
        XCTAssertEqual(classifyTransport(host: "localhost"), .loopback)
        XCTAssertEqual(classifyTransport(host: "127.0.0.1"), .loopback)
        XCTAssertEqual(classifyTransport(host: "::1"), .loopback)
        XCTAssertEqual(transportKind(forRelayURL: "ws://10.0.0.5:8080").label, "LAN")
    }

    func testTailnetRoutingDefaultsEnabledWhenUnset() {
        let defaults = makeDefaults()

        XCTAssertTrue(BridgeRoutePreferences.tailnetRoutingEnabled(userDefaults: defaults))
        XCTAssertTrue(relayURLAllowedByRouteSettings("wss://mac.tailnet.ts.net:7889", userDefaults: defaults))
    }

    func testLANRoutingDefaultsEnabledWhenUnset() {
        let defaults = makeDefaults()

        XCTAssertTrue(BridgeRoutePreferences.lanRoutingEnabled(userDefaults: defaults))
        XCTAssertTrue(relayURLAllowedByRouteSettings("ws://192.168.1.10:7889", userDefaults: defaults))
        XCTAssertTrue(relayURLAllowedByRouteSettings("ws://mac.local:7889", userDefaults: defaults))
    }

    func testDisabledLANRoutingFiltersLANRelayUrls() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setLanRoutingEnabled(false, userDefaults: defaults)

        XCTAssertEqual(
            relayURLsAllowedByRouteSettings(
                [
                    "ws://192.168.1.10:7889",
                    "ws://mac.local:7889",
                    "wss://mac.tailnet.ts.net:7889",
                ],
                userDefaults: defaults
            ),
            ["wss://mac.tailnet.ts.net:7889"]
        )
    }

    func testDisabledTailnetRoutingFiltersTailnetRelayUrls() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setTailnetRoutingEnabled(false, userDefaults: defaults)

        XCTAssertEqual(
            relayURLsAllowedByRouteSettings(
                [
                    "ws://192.168.1.10:7889",
                    "wss://mac.tailnet.ts.net:7889",
                    "ws://100.96.12.4:7889",
                ],
                userDefaults: defaults
            ),
            ["ws://192.168.1.10:7889"]
        )
    }

    func testRelayCandidatesPreferDiscoveredLanBeforeSavedTailnetAndOSN() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(true, userDefaults: defaults)

        XCTAssertEqual(
            orderedRelayCandidates(
                discoveredRelayURLs: [
                    "ws://mac.local:7889",
                    "ws://mac.local:7889",
                ],
                storedRelayURLs: [
                    "wss://mac.tailnet.ts.net:7889",
                    "wss://mesh.oscout.net",
                ],
                userDefaults: defaults
            ),
            [
                "ws://mac.local:7889",
                "wss://mac.tailnet.ts.net:7889",
                "wss://mesh.oscout.net",
            ]
        )
    }

    func testRelayCandidatesSkipDiscoveredLanWhenLANRoutingDisabled() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setLanRoutingEnabled(false, userDefaults: defaults)
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(true, userDefaults: defaults)

        XCTAssertEqual(
            orderedRelayCandidates(
                discoveredRelayURLs: [
                    "ws://mac.local:7889",
                    "ws://192.168.1.10:7889",
                ],
                storedRelayURLs: [
                    "wss://mac.tailnet.ts.net:7889",
                    "wss://mesh.oscout.net",
                ],
                userDefaults: defaults
            ),
            [
                "wss://mac.tailnet.ts.net:7889",
                "wss://mesh.oscout.net",
            ]
        )
    }

    func testRelayCandidatesHonorRoutePreferencesAcrossCascade() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setTailnetRoutingEnabled(false, userDefaults: defaults)
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(false, userDefaults: defaults)

        XCTAssertEqual(
            orderedRelayCandidates(
                discoveredRelayURLs: ["ws://192.168.1.10:7889"],
                storedRelayURLs: [
                    "wss://mac.tailnet.ts.net:7889",
                    "wss://mesh.oscout.net",
                ],
                userDefaults: defaults
            ),
            ["ws://192.168.1.10:7889"]
        )
    }

    func testRouteSummaryReportsSavedAndAllowedTailnetRoutes() {
        let defaults = makeDefaults()
        let relays = [
            "ws://192.168.1.10:7889",
            "wss://mac.tailnet.ts.net:7889",
            "wss://mesh.oscout.net",
        ]

        var summary = BridgeRouteSummary(relayURLs: relays, userDefaults: defaults)

        XCTAssertEqual(summary.routeCounts[.tailnet], 1)
        XCTAssertEqual(summary.routeCounts[.lan], 1)
        XCTAssertTrue(summary.hasLANRelay)
        XCTAssertTrue(summary.hasAllowedLANRelay)
        XCTAssertTrue(summary.hasTailnetRelay)
        XCTAssertTrue(summary.hasAllowedTailnetRelay)
        XCTAssertEqual(summary.routeCounts[.oscout], 1)
        XCTAssertFalse(summary.hasAllowedOpenScoutNetworkRelay)

        BridgeRoutePreferences.setLanRoutingEnabled(false, userDefaults: defaults)
        summary = BridgeRouteSummary(relayURLs: relays, userDefaults: defaults)

        XCTAssertTrue(summary.hasLANRelay)
        XCTAssertFalse(summary.hasAllowedLANRelay)

        BridgeRoutePreferences.setTailnetRoutingEnabled(false, userDefaults: defaults)
        summary = BridgeRouteSummary(relayURLs: relays, userDefaults: defaults)

        XCTAssertTrue(summary.hasTailnetRelay)
        XCTAssertFalse(summary.hasAllowedTailnetRelay)
    }

    func testTailscaleRouteNetworkFailuresAreRecognized() {
        XCTAssertTrue(isTailscaleRouteNetworkFailure(URLError(.cannotFindHost)))
        XCTAssertTrue(isTailscaleRouteNetworkFailure(URLError(.timedOut)))
        XCTAssertFalse(isTailscaleRouteNetworkFailure(URLError(.badServerResponse)))
    }

    @MainActor
    func testPinnedConnectionReadsOnlyItsBridgeConnectionInfo() {
        let defaults = makeDefaults()
        let keyA = String(repeating: "a", count: 64)
        let keyB = String(repeating: "b", count: 64)
        BridgeConnectionInfo(
            relayURL: "wss://mac-a.tailnet.ts.net:7889",
            roomId: "room-a",
            publicKeyHex: keyA
        ).save(userDefaults: defaults, promoteActive: true)
        BridgeConnectionInfo(
            relayURL: "ws://192.168.55.10:7889",
            roomId: "room-b",
            publicKeyHex: keyB
        ).save(userDefaults: defaults, promoteActive: false)

        XCTAssertEqual(BridgeConnectionInfo.loadActive(userDefaults: defaults)?.publicKeyHex, keyA)
        XCTAssertEqual(BridgeConnectionInfo.activePublicKeyHex(userDefaults: defaults), keyA)

        let log = ConnectionLog()
        let pinnedToB = BridgeConnection(
            target: BridgeConnectionTarget(publicKeyHex: keyB),
            connectionLog: ConnectionLogHandle(log),
            userDefaults: defaults
        )

        let summary = pinnedToB.savedRouteSummary()
        XCTAssertEqual(summary.relayCount, 1)
        XCTAssertTrue(summary.hasLANRelay)
        XCTAssertFalse(summary.hasTailnetRelay)
    }

    @MainActor
    func testConnectionLogStoresEventKind() {
        let log = ConnectionLog()

        log.log("Resolving route", event: .resolve, route: .tailnet)

        XCTAssertEqual(log.entries.first?.event, .resolve)
        XCTAssertEqual(log.entries.first?.event.label, "RESOLVE")
        XCTAssertEqual(log.entries.first?.route, .tailnet)
        XCTAssertEqual(ConnectionLogEvent.reconnect.label, "RECONNECT")
        XCTAssertEqual(ConnectionLogEvent.network.label, "NETWORK")
    }

    private func makeDefaults() -> UserDefaults {
        let suiteName = "ScoutIOSCoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }
}
