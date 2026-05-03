import XCTest

@testable import ScoutApp

final class MeshRendezvousClientTests: XCTestCase {
    override func tearDown() {
        super.tearDown()
        MeshRendezvousURLProtocol.requestHandler = nil
    }

    func testDefaultConfigurationKeepsOSNDisabled() {
        let defaults = UserDefaults(suiteName: "MeshRendezvousClientTests.default")!
        defaults.removePersistentDomain(forName: "MeshRendezvousClientTests.default")

        let configuration = MeshRendezvousConfiguration.current(userDefaults: defaults)

        XCTAssertFalse(configuration.isEnabled)
        XCTAssertEqual(configuration.baseURL.absoluteString, "https://mesh.oscout.net")
        XCTAssertEqual(configuration.meshId, "openscout")
    }

    func testDecodesRendezvousNodesAndKeepsOnlyConnectableHTTPEntrypoints() throws {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let payload = """
        {
          "v": 1,
          "meshId": "openscout",
          "nodes": [
            {
              "v": 1,
              "meshId": "openscout",
              "nodeId": "node-a",
              "nodeName": "Arts Mini",
              "issuedAt": \(now),
              "expiresAt": \(now + 60000),
              "observedAt": \(now),
              "entrypoints": [
                { "kind": "http", "url": "https://arts.mesh.oscout.net" },
                { "kind": "cloudflare_tunnel", "url": "https://arts.oscout.net" },
                {
                  "kind": "mobile_pairing",
                  "relay": "wss://relay.oscout.net",
                  "fallbackRelays": ["wss://relay.tailnet.ts.net:7889"],
                  "room": "room-1",
                  "publicKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "expiresAt": \(now + 60000)
                },
                {
                  "kind": "iroh",
                  "endpointId": "endpoint-a",
                  "endpointAddr": { "id": "endpoint-a", "addrs": [] },
                  "alpn": "openscout/mesh/0",
                  "bridgeProtocolVersion": 1
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        let list = try JSONDecoder().decode(MeshRendezvousList.self, from: payload)

        XCTAssertEqual(list.nodes.first?.nodeName, "Arts Mini")
        XCTAssertEqual(
            list.nodes.first?.connectableURLs.map(\.absoluteString),
            ["https://arts.mesh.oscout.net", "https://arts.oscout.net"]
        )
        XCTAssertEqual(list.nodes.first?.mobilePairingPayload?.relay, "wss://relay.oscout.net")
        XCTAssertEqual(list.nodes.first?.mobilePairingPayload?.fallbackRelays, ["wss://relay.tailnet.ts.net:7889"])
        XCTAssertEqual(list.nodes.first?.mobilePairingPayload?.room, "room-1")
    }

    func testFetchNodesUsesMeshQueryAndBearerToken() async throws {
        let session = URLSession(configuration: makeStubConfiguration())
        let now = Int64(Date().timeIntervalSince1970 * 1000)

        MeshRendezvousURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://mesh.oscout.net/v1/nodes?meshId=team-a")
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer osn_session_secret")

            let body = """
            {
              "v": 1,
              "meshId": "team-a",
              "nodes": [
                {
                  "v": 1,
                  "meshId": "team-a",
                  "nodeId": "node-a",
                  "nodeName": "Node A",
                  "issuedAt": \(now),
                  "expiresAt": \(now + 60000),
                  "observedAt": \(now),
                  "entrypoints": []
                }
              ]
            }
            """.data(using: .utf8)!
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                body
            )
        }

        let client = MeshRendezvousClient(
            configuration: MeshRendezvousConfiguration(
                isEnabled: true,
                baseURL: URL(string: "https://mesh.oscout.net")!,
                meshId: "team-a",
                bearerToken: "secret"
            ),
            session: session
        )

        let nodes = try await client.fetchNodes()

        XCTAssertEqual(nodes.map(\.nodeId), ["node-a"])
    }

    func testFetchSessionAndMeshesUseOSNSessionBearerToken() async throws {
        let session = URLSession(configuration: makeStubConfiguration())
        let seenURLs = LockedStrings()

        MeshRendezvousURLProtocol.requestHandler = { request in
            seenURLs.append(request.url?.absoluteString ?? "")
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer osn_session_secret")

            if request.url?.path == "/v1/auth/session" {
                let body = """
                {
                  "authenticated": true,
                  "session": {
                    "provider": "github",
                    "providerUserId": "42",
                    "login": "arach",
                    "email": "arach@example.com",
                    "expiresAt": "2026-06-01T00:00:00.000Z"
                  }
                }
                """.data(using: .utf8)!
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    body
                )
            }

            let body = """
            {
              "meshes": [
                {
                  "id": "openscout",
                  "name": "OpenScout",
                  "role": "owner",
                  "created_at": 1770000000000
                }
              ]
            }
            """.data(using: .utf8)!
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                body
            )
        }

        let client = MeshRendezvousClient(
            configuration: MeshRendezvousConfiguration(
                isEnabled: true,
                baseURL: URL(string: "https://mesh.oscout.net")!,
                bearerToken: "secret"
            ),
            session: session
        )

        let account = try await client.fetchSession()
        let meshes = try await client.fetchMeshes()

        XCTAssertEqual(account?.login, "arach")
        XCTAssertEqual(meshes.map(\.id), ["openscout"])
        XCTAssertEqual(seenURLs.values, [
            "https://mesh.oscout.net/v1/auth/session",
            "https://mesh.oscout.net/v1/meshes",
        ])
    }

    func testParsesNativeOSNAuthCallback() throws {
        let token = try OSNAuthClient.sessionToken(from: URL(string: "openscout://osn-auth?session=abc123&expires_at=1770000000000")!)

        XCTAssertEqual(token, "abc123")
        XCTAssertThrowsError(try OSNAuthClient.sessionToken(from: URL(string: "openscout://wrong?session=abc123")!))
    }

    func testFetchNodesRequiresExplicitOSNEnablement() async {
        let client = MeshRendezvousClient(configuration: MeshRendezvousConfiguration(isEnabled: false))

        do {
            _ = try await client.fetchNodes()
            XCTFail("Expected disabled OSN fetch to throw")
        } catch let error as MeshRendezvousError {
            XCTAssertEqual(error, .disabled)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}

private func makeStubConfiguration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MeshRendezvousURLProtocol.self]
    return configuration
}

private final class MeshRendezvousURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)

    nonisolated(unsafe) static var requestHandler: Handler?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let requestHandler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try requestHandler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private final class LockedStrings: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var values: [String] {
        lock.withLock { storage }
    }

    func append(_ value: String) {
        lock.withLock {
            storage.append(value)
        }
    }
}
