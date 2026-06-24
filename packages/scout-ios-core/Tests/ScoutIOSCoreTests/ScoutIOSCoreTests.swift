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

    func testBridgeMachineHostSkipsSharedRelayFrontDoors() {
        XCTAssertNil(bridgeMachineHost(from: "wss://mesh.oscout.net/v1/relay"))
        XCTAssertEqual(
            bridgeMachineHost(from: "ws://arts-mac-mini.local:43131"),
            "arts-mac-mini.local"
        )
        XCTAssertEqual(
            bridgeMachineHost(from: "wss://arts-mac-mini.tail1e8e67.ts.net:43131"),
            "arts-mac-mini.tail1e8e67.ts.net"
        )
    }

    func testTailnetRoutingDefaultsEnabledWhenUnset() {
        let defaults = makeDefaults()

        XCTAssertTrue(BridgeRoutePreferences.tailnetRoutingEnabled(userDefaults: defaults))
        XCTAssertTrue(relayURLAllowedByRouteSettings("wss://mac.tailnet.ts.net:43131", userDefaults: defaults))
    }

    func testLANRoutingDefaultsEnabledWhenUnset() {
        let defaults = makeDefaults()

        XCTAssertTrue(BridgeRoutePreferences.lanRoutingEnabled(userDefaults: defaults))
        XCTAssertTrue(relayURLAllowedByRouteSettings("ws://192.168.1.10:43131", userDefaults: defaults))
        XCTAssertTrue(relayURLAllowedByRouteSettings("ws://mac.local:43131", userDefaults: defaults))
    }

    func testOpenScoutNetworkRoutingTracksExplicitPreference() {
        let defaults = makeDefaults()

        XCTAssertFalse(BridgeRoutePreferences.hasExplicitOpenScoutNetworkRoutingPreference(userDefaults: defaults))
        XCTAssertFalse(BridgeRoutePreferences.openScoutNetworkRoutingEnabled(userDefaults: defaults))
        XCTAssertFalse(relayURLAllowedByRouteSettings("wss://mesh.oscout.net/v1/relay", userDefaults: defaults))

        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(true, userDefaults: defaults)

        XCTAssertTrue(BridgeRoutePreferences.hasExplicitOpenScoutNetworkRoutingPreference(userDefaults: defaults))
        XCTAssertTrue(BridgeRoutePreferences.openScoutNetworkRoutingEnabled(userDefaults: defaults))
        XCTAssertTrue(relayURLAllowedByRouteSettings("wss://mesh.oscout.net/v1/relay", userDefaults: defaults))
    }

    func testDisabledLANRoutingFiltersLANRelayUrls() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setLanRoutingEnabled(false, userDefaults: defaults)

        XCTAssertEqual(
            relayURLsAllowedByRouteSettings(
                [
                    "ws://192.168.1.10:43131",
                    "ws://mac.local:43131",
                    "wss://mac.tailnet.ts.net:43131",
                ],
                userDefaults: defaults
            ),
            ["wss://mac.tailnet.ts.net:43131"]
        )
    }

    func testDisabledTailnetRoutingFiltersTailnetRelayUrls() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setTailnetRoutingEnabled(false, userDefaults: defaults)

        XCTAssertEqual(
            relayURLsAllowedByRouteSettings(
                [
                    "ws://192.168.1.10:43131",
                    "wss://mac.tailnet.ts.net:43131",
                    "ws://100.96.12.4:43131",
                ],
                userDefaults: defaults
            ),
            ["ws://192.168.1.10:43131"]
        )
    }

    func testRelayCandidatesPreferDiscoveredLanBeforeSavedTailnetAndOSN() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(true, userDefaults: defaults)

        XCTAssertEqual(
            orderedRelayCandidates(
                discoveredRelayURLs: [
                    "ws://mac.local:43131",
                    "ws://mac.local:43131",
                ],
                storedRelayURLs: [
                    "wss://mac.tailnet.ts.net:43131",
                    "wss://mesh.oscout.net",
                ],
                userDefaults: defaults
            ),
            [
                "ws://mac.local:43131",
                "wss://mac.tailnet.ts.net:43131",
                "ws://mac.tailnet.ts.net:43131",
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
                    "ws://mac.local:43131",
                    "ws://192.168.1.10:43131",
                ],
                storedRelayURLs: [
                    "wss://mac.tailnet.ts.net:43131",
                    "wss://mesh.oscout.net",
                ],
                userDefaults: defaults
            ),
            [
                "wss://mac.tailnet.ts.net:43131",
                "ws://mac.tailnet.ts.net:43131",
                "wss://mesh.oscout.net",
            ]
        )
    }

    func testRelayCandidatesAddInsecureFallbackAfterLegacyLocalTLSRelayUrls() {
        let defaults = makeDefaults()

        XCTAssertEqual(
            orderedRelayCandidates(
                discoveredRelayURLs: [],
                storedRelayURLs: [
                    "wss://192.168.1.10:43131",
                    "wss://mac.tailnet.ts.net:43131",
                    "wss://mesh.oscout.net",
                    "wss://example.com",
                ],
                userDefaults: defaults
            ),
            [
                "wss://192.168.1.10:43131",
                "ws://192.168.1.10:43131",
                "wss://mac.tailnet.ts.net:43131",
                "ws://mac.tailnet.ts.net:43131",
                "wss://example.com",
            ]
        )
    }

    func testRelayCandidatesHonorRoutePreferencesAcrossCascade() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setTailnetRoutingEnabled(false, userDefaults: defaults)
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(false, userDefaults: defaults)

        XCTAssertEqual(
            orderedRelayCandidates(
                discoveredRelayURLs: ["ws://192.168.1.10:43131"],
                storedRelayURLs: [
                    "wss://mac.tailnet.ts.net:43131",
                    "wss://mesh.oscout.net",
                ],
                userDefaults: defaults
            ),
            ["ws://192.168.1.10:43131"]
        )
    }

    func testPairingRelayCandidatesPreservePayloadRelaysWhenRoutePreferenceDisabled() {
        let defaults = makeDefaults()
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(false, userDefaults: defaults)

        XCTAssertEqual(
            orderedPairingRelayCandidates(
                discoveredRelayURLs: ["ws://mac.local:7889"],
                payloadRelayURLs: ["wss://mesh.oscout.net/v1/relay"],
                userDefaults: defaults
            ),
            [
                "ws://mac.local:7889",
                "wss://mesh.oscout.net/v1/relay",
            ]
        )
    }

    func testDiscoveryOnlyBonjourAdvertisementIsNotARelayCandidate() {
        XCTAssertEqual(
            relayURLsFromBonjourAdvertisement(
                port: 7889,
                hostName: "mac.local.",
                txt: [
                    "pk": String(repeating: "a", count: 64),
                    "mode": "discovery",
                    "scheme": "ws",
                ],
                targetPublicKeyHex: String(repeating: "a", count: 64)
            ),
            []
        )
    }

    func testRouteSummaryReportsSavedAndAllowedTailnetRoutes() {
        let defaults = makeDefaults()
        let relays = [
            "ws://192.168.1.10:43131",
            "wss://mac.tailnet.ts.net:43131",
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
            relayURL: "wss://mac-a.tailnet.ts.net:43131",
            roomId: "room-a",
            publicKeyHex: keyA
        ).save(userDefaults: defaults, promoteActive: true)
        BridgeConnectionInfo(
            relayURL: "ws://192.168.55.10:43131",
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
        XCTAssertEqual(ConnectionLogEvent.auth.label, "AUTH")
    }

    func testOpenScoutNetworkRendezvousExtractsLiveMobilePairingCandidates() throws {
        let nowMs: Int64 = 10_000
        let payload = """
        {
          "v": 1,
          "meshId": "openscout",
          "nodes": [
            {
              "meshId": "openscout",
              "nodeId": "mac-a",
              "nodeName": "Mac A",
              "expiresAt": 70000,
              "observedAt": 12000,
              "entrypoints": [
                {
                  "kind": "mobile_pairing",
                  "relay": "wss://mesh.oscout.net/v1/relay",
                  "fallbackRelays": ["wss://mac.tailnet.ts.net:43131"],
                  "room": "room-a",
                  "publicKey": "\(String(repeating: "a", count: 64))",
                  "expiresAt": 70000,
                  "lastSeenAt": 11000
                },
                {
                  "kind": "http",
                  "url": "https://ignored.example"
                }
              ]
            },
            {
              "meshId": "openscout",
              "nodeId": "mac-b",
              "nodeName": "Mac B",
              "expiresAt": 9000,
              "observedAt": 13000,
              "entrypoints": [
                {
                  "kind": "mobile_pairing",
                  "relay": "wss://mesh.oscout.net/v1/relay",
                  "room": "room-b",
                  "publicKey": "\(String(repeating: "b", count: 64))",
                  "expiresAt": 9000
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        let list = try JSONDecoder().decode(OpenScoutMeshRendezvousList.self, from: payload)
        let candidates = openScoutNetworkPairingCandidates(
            from: list,
            now: Date(timeIntervalSince1970: Double(nowMs) / 1_000)
        )

        XCTAssertEqual(candidates.map(\.nodeId), ["mac-a"])
        XCTAssertEqual(candidates[0].qrPayload.relay, "wss://mesh.oscout.net/v1/relay")
        XCTAssertEqual(candidates[0].qrPayload.fallbackRelays, ["wss://mac.tailnet.ts.net:43131"])
        XCTAssertEqual(candidates[0].qrPayload.room, "room-a")
    }

    func testOpenScoutNetworkPairingPayloadCanRefreshSavedConnectionInfo() {
        let defaults = makeDefaults()
        let key = String(repeating: "a", count: 64)
        BridgeConnectionInfo(
            relayURL: "ws://192.168.1.10:43131",
            roomId: "old-room",
            publicKeyHex: key
        ).save(userDefaults: defaults, promoteActive: true)

        BridgeBrokerClient.savePairingConnectionInfo(
            qrPayload: QRPayload(
                v: 1,
                relay: "wss://mesh.oscout.net/v1/relay",
                fallbackRelays: ["wss://mac.tailnet.ts.net:43131"],
                room: "osn-room",
                publicKey: key,
                expiresAt: 70_000
            ),
            promoteActive: true,
            userDefaults: defaults
        )

        let refreshed = BridgeConnectionInfo.load(publicKeyHex: key, userDefaults: defaults)
        XCTAssertEqual(refreshed?.relayURL, "wss://mesh.oscout.net/v1/relay")
        XCTAssertEqual(refreshed?.roomId, "osn-room")
        XCTAssertEqual(refreshed?.fallbackRelayURLs, ["wss://mac.tailnet.ts.net:43131"])
        XCTAssertEqual(BridgeConnectionInfo.activePublicKeyHex(userDefaults: defaults), key)
    }

    private func makeDefaults() -> UserDefaults {
        let suiteName = "ScoutIOSCoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }
}
