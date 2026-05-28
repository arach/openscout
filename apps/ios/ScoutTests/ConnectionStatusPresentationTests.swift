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

    func testLocalOnlyRelayUrlIsNotReportedAsTailscaleDependent() {
        XCTAssertTrue(relayURLIndicatesLocalOnlyTailscaleRoute("ws://127.0.0.1:7889"))
        XCTAssertTrue(relayURLIndicatesLocalOnlyTailscaleRoute("ws://localhost:7889"))
        XCTAssertFalse(relayURLDependsOnTailscale("ws://127.0.0.1:7889"))
    }

    func testTailnetRelayUrlIsReportedAsTailscaleDependent() {
        XCTAssertTrue(relayURLUsesTailnetRoute("wss://relay.example.ts.net:7889"))
        XCTAssertTrue(relayURLUsesTailnetRoute("ws://100.96.12.4:7889"))
        XCTAssertTrue(relayURLDependsOnTailscale("wss://relay.example.ts.net:7889"))
    }

    func testOpenScoutNetworkRelayUrlIsRecognizedSeparately() {
        XCTAssertTrue(relayURLUsesOpenScoutNetworkRoute("wss://mesh.oscout.net"))
        XCTAssertTrue(relayURLUsesOpenScoutNetworkRoute("https://arts.mesh.oscout.net"))
        XCTAssertFalse(relayURLUsesOpenScoutNetworkRoute("wss://relay.example.ts.net:7889"))
    }

    func testTransportLabelsUseRouteModeVocabulary() {
        XCTAssertEqual(TransportKind.lan.label, "LAN")
        XCTAssertEqual(TransportKind.tailnet.label, "TSN")
        XCTAssertEqual(TransportKind.oscout.label, "OSN")
        XCTAssertEqual(TransportKind.remote.label, "WAN")
    }

    func testOrdinaryRelayUrlIsNotReportedAsTailscaleDependent() {
        XCTAssertFalse(relayURLDependsOnTailscale("wss://relay.example.com:443"))
        XCTAssertFalse(relayURLDependsOnTailscale("ws://192.168.1.10:7889"))
    }

    func testOrderedRelayUrlsPreferPrimaryAndDeduplicateFallbacks() {
        XCTAssertEqual(
            deduplicatedRelayURLs(
                primary: " ws://192.168.1.10:7889 ",
                fallbacks: [
                    "wss://mac.tailnet.ts.net:7889",
                    "ws://192.168.1.10:7889",
                    "",
                    "wss://mac.tailnet.ts.net:7889"
                ]
            ),
            [
                "ws://192.168.1.10:7889",
                "wss://mac.tailnet.ts.net:7889"
            ]
        )
    }

    func testSuccessfulRelayIsPromotedForFutureReconnects() {
        XCTAssertEqual(
            relayURLsPromotingSuccessfulRelay(
                "wss://mac.tailnet.ts.net:7889",
                within: [
                    "ws://192.168.1.10:7889",
                    "wss://mac.tailnet.ts.net:7889"
                ]
            ),
            [
                "wss://mac.tailnet.ts.net:7889",
                "ws://192.168.1.10:7889"
            ]
        )
    }

    func testBonjourAdvertisementIncludesTailnetFallbackRelays() {
        let publicKey = String(repeating: "ab", count: 32)

        XCTAssertEqual(
            relayURLsFromBonjourAdvertisement(
                port: 7889,
                hostName: "mac.local.",
                txt: [
                    "pk": publicKey,
                    "scheme": "wss",
                    "fallbackRelays": "wss://mac.tailnet.ts.net:7889|ws://100.96.12.4:7889|not-a-url"
                ],
                targetPublicKeyHex: publicKey
            ),
            [
                "wss://mac.local:7889",
                "wss://mac.tailnet.ts.net:7889",
                "ws://100.96.12.4:7889"
            ]
        )
    }

    func testBonjourAdvertisementIgnoresFallbackRelaysForOtherBridge() {
        XCTAssertEqual(
            relayURLsFromBonjourAdvertisement(
                port: 7889,
                hostName: "mac.local.",
                txt: [
                    "pk": String(repeating: "ab", count: 32),
                    "scheme": "wss",
                    "fallbackRelays": "wss://mac.tailnet.ts.net:7889"
                ],
                targetPublicKeyHex: String(repeating: "cd", count: 32)
            ),
            []
        )
    }

    func testTailnetRoutingDefaultsEnabledWhenUnset() {
        let defaults = makeRouteSettingsDefaults()
        XCTAssertTrue(tailnetRoutingEnabled(userDefaults: defaults))
        XCTAssertTrue(relayURLAllowedByRouteSettings("wss://relay.example.ts.net:7889", userDefaults: defaults))
    }

    func testDisabledTailnetRoutingFiltersTailnetRelayUrls() {
        let defaults = makeRouteSettingsDefaults()
        defaults.set(false, forKey: "scout.tsn.enabled")

        XCTAssertEqual(
            relayURLsAllowedByRouteSettings(
                [
                    "ws://192.168.1.10:7889",
                    "wss://relay.example.ts.net:7889",
                    "ws://100.96.12.4:7889"
                ],
                userDefaults: defaults
            ),
            ["ws://192.168.1.10:7889"]
        )
    }

    func testOpenScoutNetworkRoutingDefaultsDisabled() {
        let defaults = makeRouteSettingsDefaults()

        XCTAssertFalse(openScoutNetworkRoutingEnabled(userDefaults: defaults))
        XCTAssertFalse(relayURLAllowedByRouteSettings("wss://mesh.oscout.net", userDefaults: defaults))
    }

    func testEnabledOpenScoutNetworkRoutingAllowsOpenScoutRelayUrls() {
        let defaults = makeRouteSettingsDefaults()
        defaults.set(true, forKey: "scout.osn.enabled")

        XCTAssertTrue(openScoutNetworkRoutingEnabled(userDefaults: defaults))
        XCTAssertEqual(
            relayURLsAllowedByRouteSettings(
                [
                    "ws://192.168.1.10:7889",
                    "wss://mesh.oscout.net",
                    "wss://arts.mesh.oscout.net"
                ],
                userDefaults: defaults
            ),
            [
                "ws://192.168.1.10:7889",
                "wss://mesh.oscout.net",
                "wss://arts.mesh.oscout.net"
            ]
        )
    }

    func testCommonTailnetTransportFailuresAreRecognized() {
        XCTAssertTrue(isTailscaleRouteNetworkFailure(URLError(.cannotFindHost)))
        XCTAssertTrue(isTailscaleRouteNetworkFailure(URLError(.timedOut)))
        XCTAssertFalse(isTailscaleRouteNetworkFailure(URLError(.badServerResponse)))
    }

    private func makeRouteSettingsDefaults() -> UserDefaults {
        let suiteName = "ConnectionStatusPresentationTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }
}
